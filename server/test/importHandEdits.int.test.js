import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Import hand-edit protection, end to end over the REAL pipeline + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/handedits_test node --test --test-force-exit test/importHandEdits.int.test.js
// Locks: the PATCH route's arm-on-change precision (only fields that actually changed enter
// locallyEditedFields — arming unchanged fields would freeze the record against voter files
// forever), the preview's handEditConflicts scan (armed + differing only), applyImport's default
// keep (strip-to-$setOnInsert, so shielded rows still re-house), the overwrite mode ($set wins,
// $pull disarms ALL shielded fields), the fullName coherence stitch for legacy firstName-only
// arms, the $max retry idempotency on the job counts, and the no-shield fast path.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-handedits';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { buildImportRows } = await import('../src/services/import/csvImporter.js');
const { computeImportDiff } = await import('../src/services/import/computeImportDiff.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { PersonEditProposal } = await import('../src/models/PersonEditProposal.js');
const { VoterNote } = await import('../src/models/VoterNote.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// ── CSV fixture (DEFAULT_PROFILE_MAPPING headers; household `state` reads the
// `Registered State` column). Coords included so rows validate with geocoding OFF. ──
const CSV_HEADER =
  'State Voter ID,First Name,Last Name,Phone,Party,Address,City,Registered State,Zip Code,p_Latitude,p_Longitude';

function csvOf(rows) {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push([
      r.svid, r.first, r.last, r.phone ?? '', r.party ?? '',
      r.address, r.city ?? 'Springfield', r.state ?? 'IL', r.zip ?? '62704', r.lat, r.lng,
    ].join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

// Three voters, three doors; svids distinct and never substrings of one another.
const rowV = (over = {}) => ({
  svid: 'HEV1', first: 'Vera', last: 'Voter', phone: '111', party: 'D',
  address: '100 Main St', lat: '40.100000', lng: '-89.100000', ...over,
});
const rowW = (over = {}) => ({
  svid: 'HEW1', first: 'Wanda', last: 'Walker', phone: '777', party: 'R',
  address: '200 Oak St', lat: '40.200000', lng: '-89.200000', ...over,
});
const rowX = (over = {}) => ({
  svid: 'HEX1', first: 'Xen', last: 'Xylo', phone: '888', party: 'G',
  address: '300 Pine St', lat: '40.300000', lng: '-89.300000', ...over,
});
// v2: V hand-kept name, NEW phone + party, and a NEW address (the re-housing probe).
const v2Row = () => rowV({
  first: 'Verified', phone: '333', party: 'R',
  address: '110 Elm St', lat: '40.110000', lng: '-89.110000',
});

// Drive the REAL worker path, exactly like an enqueued job: create the ImportJob (kind
// 'apply', carrying the overwrite flag), stash the raw CSV, run processImportJob.
async function runFile(rows, { overwriteHandEdits = false } = {}) {
  const buffer = csvOf(rows);
  const job = await ImportJob.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    filename: 'handedits.csv',
    kind: 'apply',
    status: 'pending',
    overwriteHandEdits,
    fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, 'handedits.csv', buffer);
  await processImportJob({ id: `he-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return { job: await ImportJob.findById(job._id).lean(), jobId: job._id, buffer };
}

const getVoter = (svid) => Voter.findOne({ organizationId: ctx.org._id, stateVoterId: svid }).lean();

async function call(method, path, { token, orgId, body } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const asAdmin = () => ({ token: ctx.adminTok, orgId: ctx.org._id });

// The web profile form submits EVERY identity + org-local field on save; the route's
// identityEq diff is what keeps unchanged fields from arming. Base = V's imported values.
function vPatchBody(over = {}) {
  return {
    firstName: 'Vera', lastName: 'Voter',
    phone: '111', phoneType: null, cellPhone: null,
    party: 'D', gender: null, dateOfBirth: null, registrationStatus: null,
    registeredState: 'IL',
    congressionalDistrict: null, stateSenateDistrict: null, stateHouseDistrict: null,
    precinct: null,
    ...over,
  };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // Unique indexes matter for the upsert/dedup paths this test exercises.
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes(), Person.syncIndexes()]);
  for (const M of [Organization, Subscription, User, Membership, Campaign, SurveyTemplate, ImportJob, Household, Voter, Person, PersonEditProposal, VoterNote]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'HandEdit Org', slug: 'handedit-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ha@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'HE Survey', questions: [], isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'HandEdit C', type: 'survey', state: 'IL', isActive: true,
    surveyTemplateId: template._id,
  });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, admin, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('1. arming precision: PATCH arms exactly the fields that actually changed', { skip }, async () => {
  const { job } = await runFile([rowV(), rowW(), rowX()]); // v1
  assert.strictEqual(job.status, 'completed', 'v1 import completed');
  assert.strictEqual(job.newVoters, 3, 'v1 inserted all three voters');

  const v1 = await getVoter('HEV1');
  assert.strictEqual(v1.phone, '111');
  assert.deepStrictEqual(v1.locallyEditedFields || [], [], 'imported voter starts unarmed');

  // Full-form submit with ONLY phone changed → arms exactly 'phone'.
  const r1 = await call('PATCH', `/admin/voters/${v1._id}`, { ...asAdmin(), body: vPatchBody({ phone: '222' }) });
  assert.strictEqual(r1.status, 200);
  const afterPhone = await getVoter('HEV1');
  assert.strictEqual(afterPhone.phone, '222');
  assert.deepStrictEqual(afterPhone.locallyEditedFields, ['phone'], 'only the changed field armed — resubmitted-but-unchanged fields stay free');

  // Second full-form submit changing firstName → adds exactly firstName + the derived fullName.
  const r2 = await call('PATCH', `/admin/voters/${v1._id}`, {
    ...asAdmin(), body: vPatchBody({ phone: '222', firstName: 'Verified' }),
  });
  assert.strictEqual(r2.status, 200);
  const afterName = await getVoter('HEV1');
  assert.strictEqual(afterName.firstName, 'Verified');
  assert.strictEqual(afterName.fullName, 'Verified Voter');
  assert.deepStrictEqual(
    [...afterName.locallyEditedFields].sort(),
    ['firstName', 'fullName', 'phone'],
    'arms accumulate as a set: phone + firstName + derived fullName'
  );
  ctx.voterId = v1._id;
});

test('2. preview reports the conflict: armed + differing fields only', { skip }, async () => {
  // v2 carries the hand-kept name (no conflict), a new phone (conflict: phone is armed),
  // and a new party (differs, but party is UNARMED — must not count).
  const parsed = await buildImportRows(csvOf([v2Row()]), 'preview.csv', DEFAULT_PROFILE_MAPPING);
  assert.strictEqual(parsed.validRows.length, 1, 'v2 row validates');
  const diff = await computeImportDiff(ctx.camp, {
    validRows: parsed.validRows,
    householdMap: parsed.householdMap,
    errors: parsed.errors,
    dupSvids: parsed.dupSvids,
    totalRows: parsed.totalRows,
  });

  const c = diff.handEditConflicts;
  assert.strictEqual(c.voters, 1, 'one voter in conflict');
  assert.strictEqual(c.fields, 1, 'one (voter, field) conflict — unarmed party does not count');
  assert.deepStrictEqual(c.byField, { phone: 1 }, 'the conflict is phone, and only phone');
  assert.strictEqual(c.sample.length, 1);
  assert.strictEqual(c.sample[0].stateVoterId, 'HEV1');
  assert.strictEqual(c.sample[0].field, 'phone');
  assert.strictEqual(c.sample[0].keptValue, '222', 'preview shows the hand-edited value that would be kept');
  assert.strictEqual(c.sample[0].fileValue, '333', 'and the file value it would ignore');
});

test('3. default apply keeps hand edits, updates unarmed fields, still re-houses', { skip }, async () => {
  const before3 = await getVoter('HEV1');
  const { job, jobId, buffer } = await runFile([v2Row()]);
  assert.strictEqual(job.status, 'completed');

  const v = await getVoter('HEV1');
  assert.strictEqual(v.phone, '222', 'armed phone keeps the hand edit — file 333 ignored');
  assert.strictEqual(v.firstName, 'Verified', 'armed name untouched (file agrees anyway)');
  assert.strictEqual(v.party, 'R', 'unarmed party takes the file value');
  assert.ok((v.locallyEditedFields || []).includes('phone'), 'shield stays armed after a default apply');
  assert.deepStrictEqual([...v.locallyEditedFields].sort(), ['firstName', 'fullName', 'phone'], 'no arm lost');
  assert.strictEqual(job.keptHandEdits, 1, 'exactly one (voter, field) kept — phone; the agreeing name fields do not count');

  // The re-housing contract: shielding identity fields must never pin the voter to the old
  // door — householdId is not an identity field, so the move still applies.
  assert.notStrictEqual(String(v.householdId), String(before3.householdId), 'voter moved doors');
  const newHome = await Household.findById(v.householdId).lean();
  assert.strictEqual(newHome.addressLine1, '110 Elm St', 'housed at the file\'s new address');

  Object.assign(ctx, { job3Id: jobId, v2Buffer: buffer, hhAfter3: String(v.householdId) });
});

// Declared here — out of numeric order — on purpose: a real BullMQ retry re-runs while the DB
// still holds the first attempt's state (shield armed, phone 222). Running it after the
// overwrite test would be retrying against a state no real retry ever sees.
test('6. retry idempotency: re-running case 3\'s job changes nothing; $max keeps the counts', { skip }, async () => {
  // The completed job deleted its raw file; a retry only exists while the file does — restore it.
  await saveRawImport(ctx.job3Id, 'handedits.csv', ctx.v2Buffer);
  await processImportJob({ id: `retry-${ctx.job3Id}`, data: { importJobId: ctx.job3Id }, updateProgress: async () => {} });

  const job = await ImportJob.findById(ctx.job3Id).lean();
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.keptHandEdits, 1, '$max holds the first-attempt truth');
  assert.strictEqual(job.newVoters, 0, 'retry inserted nothing');

  const v = await getVoter('HEV1');
  assert.strictEqual(v.phone, '222', 'hand edit still kept on retry');
  assert.strictEqual(v.firstName, 'Verified');
  assert.strictEqual(v.fullName, 'Verified Voter');
  assert.strictEqual(String(v.householdId), ctx.hhAfter3, 'no re-housing churn');
  assert.deepStrictEqual([...v.locallyEditedFields].sort(), ['firstName', 'fullName', 'phone'], 'shield unchanged');
});

test('4. overwriteHandEdits: the file wins and ALL shielded arms are cleared', { skip }, async () => {
  const v3 = rowV({ first: 'Verified', phone: '444', party: 'R', address: '110 Elm St', lat: '40.110000', lng: '-89.110000' });
  const { job } = await runFile([v3], { overwriteHandEdits: true });
  assert.strictEqual(job.status, 'completed');

  const v = await getVoter('HEV1');
  assert.strictEqual(v.phone, '444', 'overwrite mode: the file value wins over the hand edit');
  // The $pull targets EVERY shielded field, not just the ones the file disagreed with — so the
  // firstName/fullName arms from case 1 clear too, even though the file matched their values.
  assert.deepStrictEqual(v.locallyEditedFields, [], 'fully disarmed: $pull covers all shielded fields');
  // Only actually-differing (voter, field) pairs are counted: phone differed; the name arms agreed.
  assert.strictEqual(job.overwrittenHandEdits, 1, 'counts value-changing overwrites only (>= 1 per spec; exactly 1 here)');
  assert.strictEqual(job.keptHandEdits, 0, 'nothing kept in overwrite mode');

  // Disarmed → a later default import updates the field like any other.
  const v4 = rowV({ first: 'Verified', phone: '555', party: 'R', address: '110 Elm St', lat: '40.110000', lng: '-89.110000' });
  const { job: job4 } = await runFile([v4]);
  assert.strictEqual(job4.status, 'completed');
  assert.strictEqual((await getVoter('HEV1')).phone, '555', 'no longer armed — the file updates phone normally');
  assert.strictEqual(job4.keptHandEdits, 0, 'no shield left to keep');
});

test('5. fullName coherence: a legacy firstName-only arm never yields a stitched-wrong fullName', { skip }, async () => {
  // DB-arm W the legacy way: hand-set firstName, only 'firstName' in the shield (older edits
  // armed the part but not the derived fullName).
  const w = await getVoter('HEW1');
  await Voter.updateOne(
    { _id: w._id },
    { $set: { firstName: 'Wilhelmina', fullName: 'Wilhelmina Walker', locallyEditedFields: ['firstName'] } }
  );

  const { job } = await runFile([rowW({ first: 'Winifred', last: 'Ward' })]);
  assert.strictEqual(job.status, 'completed');

  const after = await getVoter('HEW1');
  assert.strictEqual(after.firstName, 'Wilhelmina', 'armed first name kept');
  assert.strictEqual(after.lastName, 'Ward', 'unarmed last name takes the file');
  assert.strictEqual(after.fullName, 'Wilhelmina Ward', 'fullName recomposed from kept first + file last — never the file\'s own fullName');
  assert.strictEqual(job.keptHandEdits, 1, 'the differing firstName counted as kept');
});

test('7. no-shield fast path: a never-edited voter takes every field from the file', { skip }, async () => {
  const before7 = await getVoter('HEX1');
  assert.deepStrictEqual(before7.locallyEditedFields || [], [], 'precondition: X was never hand-edited');

  const { job } = await runFile([rowX({
    first: 'Xander', last: 'Xu', phone: '999', party: 'I',
    address: '310 Pine St', lat: '40.310000', lng: '-89.310000',
  })]);
  assert.strictEqual(job.status, 'completed');

  const v = await getVoter('HEX1');
  assert.strictEqual(v.firstName, 'Xander');
  assert.strictEqual(v.lastName, 'Xu');
  assert.strictEqual(v.fullName, 'Xander Xu');
  assert.strictEqual(v.phone, '999');
  assert.strictEqual(v.party, 'I');
  assert.notStrictEqual(String(v.householdId), String(before7.householdId), 're-housed like any import');
  assert.strictEqual(job.keptHandEdits, 0, 'nothing counted for an unarmed voter');
  assert.strictEqual(job.overwrittenHandEdits, 0);
});
