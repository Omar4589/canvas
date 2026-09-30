import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The import ZERO GATE, driven through the REAL worker path (processImportJob) on a throwaway
// mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/import_zero_gate_test node --test test/importZeroGate.int.test.js
//
// A voter file whose IDs match voters this campaign already holds only after ignoring leading
// zeros (the file went through Excel, or the reverse: an unpadded campaign receiving the state's
// padded file) would be inserted a SECOND time by the exact upsert — every door gets its residents
// twice, and undo cannot cleanly reverse it once anything is touched. So the preview reports the
// count with an example pair, and the worker REFUSES the apply outright (no "import anyway": inside
// one campaign the same digits are always the same person). Both directions are pinned, plus the
// cases that must NOT fire: a plain re-import, an all-new file, and a letter-ID campaign.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-zero-gate';

const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const ctx = {};

// Rows in the built-in vendor profile's columns; coordinates included so no geocoding runs.
const HEADER = ['State Voter ID', 'First Name', 'Last Name', 'Address', 'City', 'Registered State', 'Zip Code', 'p_Latitude', 'p_Longitude'];
const csvOf = (rows) =>
  Buffer.from(
    [HEADER.join(',')].concat(rows.map((r, i) => [r.id, r.first || `F${i}`, r.last || 'Gate', r.address || `${100 + i} Gate St`, 'Atlanta', r.state || 'GA', '30342', (33.8 + i * 0.0001).toFixed(6), (-84.4).toFixed(6)].join(','))).join('\n') + '\n'
  );

// Drive the REAL worker exactly like an enqueued job: create the ImportJob (kind 'apply' or
// 'preview'), stash the raw CSV, run processImportJob, read the job back.
async function runFile(campaign, rows, kind = 'apply') {
  const job = await ImportJob.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    filename: `${kind}.csv`,
    kind,
    status: 'pending',
    fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, `${kind}.csv`, csvOf(rows));
  try {
    await processImportJob({ id: `zg-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  } catch (err) {
    // The worker rethrows so BullMQ records the failure; the ImportJob carries the message.
    ctx.lastError = err;
  }
  return ImportJob.findById(job._id).lean();
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Subscription, Campaign, Household, Voter, ImportJob]) await M.deleteMany({});
  const org = await Organization.create({ name: 'Gate Org', slug: 'gate-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const ga = await Campaign.create({ organizationId: org._id, name: 'GA Gate', type: 'survey', state: 'GA', isActive: true });
  const ne = await Campaign.create({ organizationId: org._id, name: 'NE Gate', type: 'survey', state: 'NE', isActive: true });
  const oh = await Campaign.create({ organizationId: org._id, name: 'OH Gate', type: 'survey', state: 'OH', isActive: true });
  Object.assign(ctx, { org, ga, ne, oh });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

const PADDED = [{ id: '08719967', first: 'Martin' }, { id: '05187273', first: 'Nancy' }, { id: '12453551', first: 'Alejandro' }];
const STRIPPED = [{ id: '8719967', first: 'Martin' }, { id: '5187273', first: 'Nancy' }, { id: '12453551', first: 'Alejandro' }];

test('the first import of a padded file lands; a plain re-import of the same file updates, not doubles', { skip }, async () => {
  const first = await runFile(ctx.ga, PADDED);
  assert.strictEqual(first.status, 'completed', JSON.stringify(first.errors));
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ga._id }), 3);
  const again = await runFile(ctx.ga, PADDED);
  assert.strictEqual(again.status, 'completed');
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ga._id }), 3, 'same spelling: upserts in place');
});

test('the preview of a zero-stripped re-export counts the zero-only matches with a directional example', { skip }, async () => {
  const pv = await runFile(ctx.ga, STRIPPED, 'preview');
  assert.strictEqual(pv.status, 'completed', JSON.stringify(pv.errors));
  assert.strictEqual(pv.diff.totals.zeroOnlyMatches, 2, '8719967 and 5187273; 12453551 matches exactly');
  assert.strictEqual(pv.diff.totals.newVoters, 2, 'the exact forecast still calls them new — the callout reconciles the two');
  assert.deepStrictEqual(pv.diff.samples.zeroOnly[0], { file: '8719967', stored: '08719967' });
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ga._id }), 3, 'a preview writes nothing');
});

test('the worker refuses to apply a zero-stripped re-export, naming the count and the pair', { skip }, async () => {
  const before = await Voter.countDocuments({ campaignId: ctx.ga._id });
  const job = await runFile(ctx.ga, STRIPPED);
  assert.strictEqual(job.status, 'failed');
  assert.strictEqual(job.errors[0].code, 'ZERO_ONLY_MATCHES');
  assert.match(job.errors[0].reason, /2 of this file's voter IDs match voters already in this campaign only after ignoring leading zeros/);
  assert.match(job.errors[0].reason, /file 8719967 → stored 08719967: the file lost leading zeros the campaign has/);
  assert.match(job.errors[0].reason, /second time/);
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ga._id }), before, 'nothing was written');
  assert.strictEqual(ctx.lastError?.name, 'UnrecoverableError', 'no BullMQ retry: the file will not change on its own');
});

test('the other direction: an unpadded campaign refuses the state\'s padded file, and says which side has the zeros', { skip }, async () => {
  const seeded = await runFile(ctx.ne, [{ id: '1234567', first: 'Bob', state: 'NE' }, { id: '234567', first: 'Big', state: 'NE' }]);
  assert.strictEqual(seeded.status, 'completed', JSON.stringify(seeded.errors));
  const job = await runFile(ctx.ne, [{ id: '0001234567', first: 'Bob', state: 'NE' }, { id: '0000234567', first: 'Big', state: 'NE' }]);
  assert.strictEqual(job.status, 'failed');
  assert.strictEqual(job.errors[0].code, 'ZERO_ONLY_MATCHES');
  assert.match(job.errors[0].reason, /file 0001234567 → stored 1234567: the file carries leading zeros the campaign does not/);
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ne._id }), 2);
});

test('an all-new file and a letter-ID campaign never trip the gate', { skip }, async () => {
  const fresh = await runFile(ctx.ga, [{ id: '00011111', first: 'New' }, { id: '22222222', first: 'Newer' }]);
  assert.strictEqual(fresh.status, 'completed', JSON.stringify(fresh.errors));
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.ga._id }), 5);

  const letters = await runFile(ctx.oh, [{ id: 'OH0012345678', first: 'Buck', state: 'OH' }]);
  assert.strictEqual(letters.status, 'completed', JSON.stringify(letters.errors));
  const numeric = await runFile(ctx.oh, [{ id: '12345678', first: 'Eye', state: 'OH' }]);
  assert.strictEqual(numeric.status, 'completed', 'a numeric ID against a letter-ID campaign has no zero-only match; it is simply new');
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.oh._id }), 2);
});
