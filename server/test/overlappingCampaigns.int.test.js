import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Two campaigns, one org, OVERLAPPING voter files — the per-campaign voter-row contract,
// end to end over the REAL import pipeline + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/overlap_test node --test --test-force-exit test/overlappingCampaigns.int.test.js
// Locks the four failure modes the per-campaign model exists to prevent:
//   1. Import theft — B's overlapping import must INSERT B's own rows, never re-house A's.
//   2. Status bleed — surveying a shared person in A must not mark them surveyed in B.
//   3. Delete hazard — deleting a never-walked campaign leaves the walked ones intact; a
//      flagged person losing their last row parks as a DncPendingId and re-flags on a later
//      import, while one with a surviving row is never parked and keeps the shared card.
//   4. Wrong-row joins — directory/profile resolve per-campaign; DNC set in A reaches B's
//      row and drops B's door; an import of an already-flagged person seeds the flag.
// Plus the multi-campaign server guards: /admin/reports/* and /admin/households/map demand
// campaignId (or all=1) from admins once the org has 2 campaigns.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-overlap';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');
const { recomputeSurveyStatus } = await import('../src/services/canvass/status.js');
const { deleteCampaignCascade } = await import('../src/services/campaigns/deleteCampaign.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VoterNote } = await import('../src/models/VoterNote.js');
const { Person } = await import('../src/models/Person.js');
const { DncPendingId } = await import('../src/models/DncPendingId.js');
const { DncUpload } = await import('../src/models/DncUpload.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// ── CSV fixture (DEFAULT_PROFILE_MAPPING headers; coords included so rows validate
// with geocoding OFF). Same discipline as importHandEdits.int.test.js. ──
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

// Shared people V + W, plus X only-in-A, Y only-in-B, Z (flagged in A, later imported
// into B), U (unique to the deletable campaign C), T (unique to the deletable campaign D).
// Svids never substrings of one another.
const rowV = () => ({ svid: 'OVV1', first: 'Vera', last: 'Voter', phone: '111', party: 'D', address: '100 Main St', lat: '40.100000', lng: '-89.100000' });
const rowW = () => ({ svid: 'OVW1', first: 'Wanda', last: 'Walker', phone: '222', party: 'R', address: '200 Oak St', lat: '40.200000', lng: '-89.200000' });
const rowX = () => ({ svid: 'OVX1', first: 'Xen', last: 'Xylo', phone: '333', party: 'G', address: '300 Pine St', lat: '40.300000', lng: '-89.300000' });
const rowY = () => ({ svid: 'OVY1', first: 'Yuri', last: 'Yates', phone: '444', party: 'D', address: '400 Cedar St', lat: '40.400000', lng: '-89.400000' });
const rowZ = () => ({ svid: 'OVZ1', first: 'Zoe', last: 'Zane', phone: '555', party: 'R', address: '500 Birch St', lat: '40.500000', lng: '-89.500000' });
const rowU = () => ({ svid: 'OVU1', first: 'Uma', last: 'Unique', phone: '666', party: 'D', address: '600 Elm St', lat: '40.600000', lng: '-89.600000' });
const rowT = () => ({ svid: 'OVT1', first: 'Tess', last: 'Tenant', phone: '777', party: 'R', address: '700 Ash St', lat: '40.700000', lng: '-89.700000' });

// Drive the REAL worker path into a given campaign (create job → stash CSV → process).
async function runFile(campaign, rows, name = 'overlap.csv') {
  const buffer = csvOf(rows);
  const job = await ImportJob.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    filename: name,
    kind: 'apply',
    status: 'pending',
    fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, name, buffer);
  await processImportJob({ id: `ov-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return ImportJob.findById(job._id).lean();
}

const voterIn = (campaign, svid) => Voter.findOne({ campaignId: campaign._id, stateVoterId: svid }).lean();
const doorOf = async (campaign, svid) => Household.findById((await voterIn(campaign, svid)).householdId).lean();

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

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // The per-campaign unique index is the mechanism under test — build it for real.
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes(), Person.syncIndexes()]);
  for (const M of [Organization, Subscription, User, Membership, Campaign, SurveyTemplate, SurveyResponse, ImportJob, Household, Voter, VoterNote, Person, DncPendingId, DncUpload]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Overlap Org', slug: 'overlap-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'ov@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'OV Survey', questions: [], isActive: true });
  const campA = await Campaign.create({ organizationId: org._id, name: 'Campaign A', type: 'survey', state: 'IL', isActive: true, surveyTemplateId: template._id });
  const campB = await Campaign.create({ organizationId: org._id, name: 'Campaign B', type: 'survey', state: 'IL', isActive: true, surveyTemplateId: template._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, template, campA, campB, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── 1. No theft ─────────────────────────────────────────────────────────────────

test('overlapping import into B inserts B rows and never re-houses A', { skip }, async () => {
  const jobA = await runFile(ctx.campA, [rowV(), rowW(), rowX()], 'a1.csv');
  assert.equal(jobA.status, 'completed');
  assert.equal(jobA.newVoters, 3);

  const aV = await voterIn(ctx.campA, 'OVV1');
  const aDoorBefore = String(aV.householdId);

  // B imports V + W (overlap) + Y (new person).
  const jobB = await runFile(ctx.campB, [rowV(), rowW(), rowY()], 'b1.csv');
  assert.equal(jobB.status, 'completed');
  assert.equal(jobB.newVoters, 3, 'all three are new TO CAMPAIGN B');

  // A's row untouched — same row id, same door.
  const aVAfter = await voterIn(ctx.campA, 'OVV1');
  assert.equal(String(aVAfter._id), String(aV._id));
  assert.equal(String(aVAfter.householdId), aDoorBefore, 'B\'s import must not steal A\'s voter');

  // B got its OWN row, housed in B's own copy of the door.
  const bV = await voterIn(ctx.campB, 'OVV1');
  assert.ok(bV, 'B has its own V row');
  assert.notEqual(String(bV._id), String(aV._id));
  assert.notEqual(String(bV.householdId), aDoorBefore);
  assert.equal(String((await doorOf(ctx.campB, 'OVV1')).campaignId), String(ctx.campB._id));

  // One person, two rows: sibling invariant at the data layer.
  assert.equal(await Voter.countDocuments({ organizationId: ctx.org._id, stateVoterId: 'OVV1' }), 2);
});

test('re-import into A is idempotent (updates, no new rows)', { skip }, async () => {
  const before2 = await Voter.countDocuments({ campaignId: ctx.campA._id });
  const job = await runFile(ctx.campA, [rowV(), rowW(), rowX()], 'a2.csv');
  assert.equal(job.status, 'completed');
  assert.equal(job.newVoters, 0);
  assert.equal(job.updatedVoters, 3);
  assert.equal(await Voter.countDocuments({ campaignId: ctx.campA._id }), before2);
});

// ── 2. No status bleed ──────────────────────────────────────────────────────────

test('surveying V in A leaves B\'s row not_surveyed', { skip }, async () => {
  const aV = await voterIn(ctx.campA, 'OVV1');
  await SurveyResponse.create({
    organizationId: ctx.org._id,
    campaignId: ctx.campA._id,
    voterId: aV._id,
    householdId: aV.householdId,
    userId: ctx.admin._id,
    surveyTemplateId: ctx.template._id,
    surveyTemplateVersion: 1,
    submittedAt: new Date(),
    location: { lat: 40.1, lng: -89.1 },
    answers: [],
  });
  await recomputeSurveyStatus([aV._id]);

  assert.equal((await voterIn(ctx.campA, 'OVV1')).surveyStatus, 'surveyed');
  assert.equal((await voterIn(ctx.campB, 'OVV1')).surveyStatus, 'not_surveyed', 'B must not inherit A\'s surveyed flag');
});

// ── 4a. DNC set in A reaches B's row and B's door ───────────────────────────────

test('admin DNC on A\'s row flags B\'s sibling and drops B\'s door', { skip }, async () => {
  const aW = await voterIn(ctx.campA, 'OVW1');
  const res = await call('POST', `/admin/voters/${aW._id}/dnc`, { ...asAdmin(), body: { reason: 'asked us to stop' } });
  assert.equal(res.status, 200);

  const bW = await voterIn(ctx.campB, 'OVW1');
  assert.equal(bW.doNotContact?.flagged, true, 'sibling row flags too');

  // W lives alone at 200 Oak in both campaigns → both doors fully suppress.
  assert.equal((await doorOf(ctx.campA, 'OVW1')).fullyDnc, true);
  assert.equal((await doorOf(ctx.campB, 'OVW1')).fullyDnc, true);

  // Clear from B's side — reopens both.
  const clear = await call('DELETE', `/admin/voters/${bW._id}/dnc`, asAdmin());
  assert.equal(clear.status, 200);
  assert.equal((await voterIn(ctx.campA, 'OVW1')).doNotContact?.flagged, false);
  assert.equal((await doorOf(ctx.campA, 'OVW1')).fullyDnc, false);
  assert.equal((await doorOf(ctx.campB, 'OVW1')).fullyDnc, false);
});

// ── 4b. Importing an already-flagged person seeds the flag on the new row ───────

test('import into B seeds a flag set in A (born flagged, door drops)', { skip }, async () => {
  // Z exists only in A so far; flag them there.
  const jobZ = await runFile(ctx.campA, [rowV(), rowW(), rowX(), rowZ()], 'a3.csv');
  assert.equal(jobZ.status, 'completed');
  const aZ = await voterIn(ctx.campA, 'OVZ1');
  const flag = await call('POST', `/admin/voters/${aZ._id}/dnc`, { ...asAdmin(), body: { reason: 'do not knock' } });
  assert.equal(flag.status, 200);

  // Now B imports Z. The new row must arrive flagged, with the ORIGINAL attribution.
  const jobB = await runFile(ctx.campB, [rowV(), rowW(), rowY(), rowZ()], 'b2.csv');
  assert.equal(jobB.status, 'completed');
  const bZ = await voterIn(ctx.campB, 'OVZ1');
  assert.equal(bZ.doNotContact?.flagged, true, 'seeded on insert');
  assert.equal(bZ.doNotContact?.reason, 'do not knock', 'original reason carried');
  assert.equal(bZ.doNotContact?.source, 'admin');
  // Z is alone at 500 Birch → B's copy of the door suppresses immediately.
  assert.equal((await doorOf(ctx.campB, 'OVZ1')).fullyDnc, true);
});

// ── 3. Safe delete + DNC stickiness ─────────────────────────────────────────────

test('deleting never-walked C leaves A intact and parks the last-row flag', { skip }, async () => {
  const campC = await Campaign.create({
    organizationId: ctx.org._id, name: 'Campaign C', type: 'survey', state: 'IL', isActive: true,
    surveyTemplateId: ctx.template._id,
  });
  // C overlaps A on V, and holds U (unique to C).
  const jobC = await runFile(campC, [rowV(), rowU()], 'c1.csv');
  assert.equal(jobC.status, 'completed');

  // Flag U (admin), and note V's A-side row id for the survival check.
  const cU = await voterIn(campC, 'OVU1');
  const flag = await call('POST', `/admin/voters/${cU._id}/dnc`, { ...asAdmin(), body: { reason: 'moved away, do not contact' } });
  assert.equal(flag.status, 200);
  const aVBefore = await voterIn(ctx.campA, 'OVV1');

  const counts = await deleteCampaignCascade(campC);
  assert.equal(counts.voters, 2, 'exactly C\'s two rows die');
  assert.equal(counts.dncParked, 1, 'U (last row flagged) parks; V has siblings');

  // A untouched: same V row, same door, still flagged-free.
  const aVAfter = await voterIn(ctx.campA, 'OVV1');
  assert.ok(aVAfter, 'A\'s V row survives C\'s delete');
  assert.equal(String(aVAfter._id), String(aVBefore._id));
  assert.equal(String(aVAfter.householdId), String(aVBefore.householdId));

  // U's request survives as an admin-attributed pending id …
  const pending = await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'OVU1' }).lean();
  assert.ok(pending, 'DncPendingId written for the last-row flagged person');
  assert.equal(pending.uploadId, null);
  assert.equal(pending.reason, 'moved away, do not contact');

  // … and graduates when U is imported again: the new row is born flagged.
  const jobA = await runFile(ctx.campA, [rowV(), rowW(), rowX(), rowZ(), rowU()], 'a4.csv');
  assert.equal(jobA.status, 'completed');
  const aU = await voterIn(ctx.campA, 'OVU1');
  assert.equal(aU.doNotContact?.flagged, true, 'pending id re-flags on import');
  assert.equal(aU.doNotContact?.source, 'admin');
  assert.equal(aU.doNotContact?.reason, 'moved away, do not contact');
  assert.equal(await DncPendingId.countDocuments({ organizationId: ctx.org._id, stateVoterId: 'OVU1' }), 0, 'pending consumed');
});

// The sibling half of the same contract, which C could not reach: C's only flagged person
// held their LAST row, so the skip guard in deleteCampaignCascade ("this person still has a
// row elsewhere — leave the flag on it") never ran. D flags BOTH kinds at once, so the two
// branches are told apart in one delete: T parks, Z must not. It also pins the case the
// per-campaign model exists for — deleting a never-walked campaign that overlaps a WALKED
// one (A carries a survey) must not cost A a row, a flag, or a survey.
test('deleting never-walked D leaves the walked campaigns whole and parks only the last-row flag', { skip }, async () => {
  const campD = await Campaign.create({
    organizationId: ctx.org._id, name: 'Campaign D', type: 'survey', state: 'IL', isActive: true,
    surveyTemplateId: ctx.template._id,
  });
  // D overlaps A+B on V and the already-flagged Z, and holds T alone.
  const jobD = await runFile(campD, [rowV(), rowZ(), rowT()], 'd1.csv');
  assert.equal(jobD.status, 'completed');

  const dZ = await voterIn(campD, 'OVZ1');
  assert.equal(dZ.doNotContact?.flagged, true, 'Z seeds flagged into D from its siblings');
  const dT = await voterIn(campD, 'OVT1');
  const flagT = await call('POST', `/admin/voters/${dT._id}/dnc`, { ...asAdmin(), body: { reason: 'only ever in D' } });
  assert.equal(flagT.status, 200);

  // Snapshot the walked campaigns and the identity card all three rows share.
  const aZBefore = await voterIn(ctx.campA, 'OVZ1');
  const bZBefore = await voterIn(ctx.campB, 'OVZ1');
  assert.ok(aZBefore.personId, 'A\'s Z row carries an identity card');
  assert.equal(String(dZ.personId), String(aZBefore.personId), 'one person, one card, three campaign rows');
  const aRowsBefore = await Voter.countDocuments({ campaignId: ctx.campA._id });
  const bRowsBefore = await Voter.countDocuments({ campaignId: ctx.campB._id });
  const aSurveysBefore = await SurveyResponse.countDocuments({ campaignId: ctx.campA._id });
  assert.ok(aSurveysBefore > 0, 'A is the WALKED campaign here — that is the point of the case');

  const counts = await deleteCampaignCascade(campD);
  assert.equal(counts.voters, 3, 'exactly D\'s three rows die');

  // The guard, both branches, from one delete.
  assert.equal(counts.dncParked, 1, 'T (last row) parks; Z (siblings survive) must not');
  assert.ok(await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'OVT1' }), 'T\'s request is held');
  assert.equal(
    await DncPendingId.countDocuments({ organizationId: ctx.org._id, stateVoterId: 'OVZ1' }), 0,
    'a person with a surviving row is never parked — the flag rides that row'
  );

  // The walked campaigns are whole: every row, the flag with its attribution, the history.
  assert.equal(await Voter.countDocuments({ campaignId: ctx.campA._id }), aRowsBefore, 'A keeps every row');
  assert.equal(await Voter.countDocuments({ campaignId: ctx.campB._id }), bRowsBefore, 'B keeps every row');
  const aZAfter = await voterIn(ctx.campA, 'OVZ1');
  assert.equal(String(aZAfter._id), String(aZBefore._id), 'A\'s Z row is the same document');
  assert.equal(aZAfter.doNotContact?.flagged, true, 'A\'s flag survives its sibling\'s delete');
  assert.equal(aZAfter.doNotContact?.reason, aZBefore.doNotContact?.reason, 'with its original attribution');
  assert.equal(String((await voterIn(ctx.campB, 'OVZ1'))._id), String(bZBefore._id), 'B\'s Z row too');
  assert.equal(
    await SurveyResponse.countDocuments({ campaignId: ctx.campA._id }), aSurveysBefore,
    'A\'s canvassing history is untouched'
  );
  assert.equal((await voterIn(ctx.campA, 'OVV1')).surveyStatus, 'surveyed', 'and still reads surveyed');

  // The card the survivors point at rides with them. (A card whose LAST row died — T's — is
  // currently left behind instead; purging those orphans is separate, open work. This
  // assertion is the guardrail for it: that purge must never reach a card like Z's.)
  assert.ok(await Person.findById(aZBefore.personId).lean(), 'the shared card survives');
  assert.equal(String(aZAfter.personId), String(aZBefore.personId), 'and the survivor still points at it');
});

// ── 4c. Directory + profile resolve per-campaign ────────────────────────────────

test('org directory dedupes people; ?campaignId shows that campaign\'s row', { skip }, async () => {
  const dir = await call('GET', '/admin/voters?search=Vera', asAdmin());
  assert.equal(dir.status, 200);
  const vRows = dir.json.voters.filter((v) => v.stateVoterId === 'OVV1');
  assert.equal(vRows.length, 1, 'org view dedupes V to one row');
  assert.equal(vRows[0].surveyStatus, 'surveyed', 'org view reads surveyed-in-any');
  const chipIds = (vRows[0].campaigns || []).map((c) => c.id).sort();
  assert.deepEqual(chipIds, [String(ctx.campA._id), String(ctx.campB._id)].sort(), 'both campaign chips');

  const inB = await call('GET', `/admin/voters?search=Vera&campaignId=${ctx.campB._id}`, asAdmin());
  assert.equal(inB.status, 200);
  const bRow = inB.json.voters.find((v) => v.stateVoterId === 'OVV1');
  assert.ok(bRow, 'campaign view finds B\'s row');
  assert.equal(String(bRow.household.campaignId), String(ctx.campB._id), 'resolves B\'s door, not last-imported');
  assert.equal(bRow.surveyStatus, 'not_surveyed', 'campaign view reads the row');
});

test('profile lists the sibling campaign and unions person-level history', { skip }, async () => {
  const aV = await voterIn(ctx.campA, 'OVV1');
  const prof = await call('GET', `/admin/voters/${aV._id}`, asAdmin());
  assert.equal(prof.status, 200);
  assert.equal(String(prof.json.household.campaign.id), String(ctx.campA._id));
  const others = prof.json.otherCampaigns || [];
  assert.equal(others.length, 1);
  assert.equal(String(others[0].campaignId), String(ctx.campB._id));
  assert.equal(others[0].surveyStatus, 'not_surveyed');
  // The survey submitted in A is visible from B's profile too (person-level union).
  const bV = await voterIn(ctx.campB, 'OVV1');
  const profB = await call('GET', `/admin/voters/${bV._id}`, asAdmin());
  assert.equal(profB.json.surveys.length, 1);
  assert.equal(String(profB.json.surveys[0].campaignId), String(ctx.campA._id));
});

// ── Multi-campaign server guards ────────────────────────────────────────────────

test('reports demand a campaign scope from admins once the org has 2 campaigns', { skip }, async () => {
  const bare = await call('GET', '/admin/reports/overview', asAdmin());
  assert.equal(bare.status, 400, 'unscoped overview must refuse, not silently blend');
  const scoped = await call('GET', `/admin/reports/overview?campaignId=${ctx.campA._id}`, asAdmin());
  assert.equal(scoped.status, 200);
  const all = await call('GET', '/admin/reports/overview?all=1', asAdmin());
  assert.equal(all.status, 200, 'explicit all=1 keeps the org-wide read available');
  const rollup = await call('GET', '/admin/reports/campaign-rollup', asAdmin());
  assert.equal(rollup.status, 200, 'the per-campaign rollup stays unscoped by design');
});

test('the admin map demands a campaign scope too', { skip }, async () => {
  const bare = await call('GET', '/admin/households/map', asAdmin());
  assert.equal(bare.status, 400);
  const scoped = await call('GET', `/admin/households/map?campaignId=${ctx.campA._id}`, asAdmin());
  assert.equal(scoped.status, 200);
  const all = await call('GET', '/admin/households/map?all=1', asAdmin());
  assert.equal(all.status, 200);
});
