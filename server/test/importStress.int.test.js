import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { processImportJob } from '../src/services/import/importProcessor.js';
import { saveRawImport } from '../src/services/import/rawImportStore.js';
import { undoFileImport } from '../src/services/import/undoImport.js';
import { DEFAULT_PROFILE_MAPPING } from '../src/services/import/canonicalFields.js';
import { Organization } from '../src/models/Organization.js';
import { Campaign } from '../src/models/Campaign.js';
import { ImportJob } from '../src/models/ImportJob.js';
import { Household } from '../src/models/Household.js';
import { Voter } from '../src/models/Voter.js';
import { Person } from '../src/models/Person.js';

// Stress + robustness test for the voter-import pipeline: drive the REAL worker path
// (processImportJob) with a large, messy CSV and assert it completes without crashing, gets the
// counts right (incl. the chunked address->id resolution in csvImporter.js), populates
// householdsWithFileCoords, is idempotent on re-run, and undoes cleanly. Bad rows (coordinate-less
// with geocoding OFF, and missing-required) must be skipped gracefully — never choke the import.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/import_stress node --test test/importStress.int.test.js
// Crank the size for a real stress run: STRESS_IMPORT_HOUSEHOLDS=100000 npm run test:int
const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const O = () => new mongoose.Types.ObjectId();

const H = Number(process.env.STRESS_IMPORT_HOUSEHOLDS || 6000); // households, all with coords; 2 voters each
const COORDLESS_HH = 200; // households with NO coords → bad_coords errors (geocoding off), skipped
const MALFORMED = 25; // missing-required rows → errors, skipped
const DUP_ROWS = 10; // exact-duplicate voter rows → deduped
const BAD_ROWS = 2 * COORDLESS_HH + MALFORMED;

const CSV_HEADER =
  'State Voter ID,First Name,Last Name,Address,City,Registered State,Zip Code,p_Latitude,p_Longitude,Party,uid';

function coordsFor(i) {
  return [(40 + (i % 900) / 100000).toFixed(6), (-89 - (i % 900) / 100000).toFixed(6)];
}

function buildCsv() {
  const lines = [CSV_HEADER];
  let svid = 0;
  // H households WITH coords, 2 voters each (two rows sharing an address → household dedup).
  for (let i = 0; i < H; i++) {
    const addr = `${100 + i} Main St`;
    const [lat, lng] = coordsFor(i);
    for (let k = 0; k < 2; k++) {
      svid += 1;
      lines.push([`S${svid}`, `First${svid}`, `Last${svid}`, addr, 'Springfield', 'IL', '62704', lat, lng, k === 0 ? 'D' : 'R', ''].join(','));
    }
  }
  // Coordinate-less households → bad_coords errors with geocoding OFF: must skip, not crash.
  for (let i = 0; i < COORDLESS_HH; i++) {
    const addr = `${50000 + i} Elm St`;
    for (let k = 0; k < 2; k++) {
      svid += 1;
      lines.push([`C${svid}`, `First${svid}`, `Last${svid}`, addr, 'Springfield', 'IL', '62704', '', '', 'D', ''].join(','));
    }
  }
  // Exact-duplicate voter rows (same svid S1, with coords) → deduped, not counted twice.
  const [lat0, lng0] = coordsFor(0);
  for (let d = 0; d < DUP_ROWS; d++) {
    lines.push(['S1', 'First1', 'Last1', '100 Main St', 'Springfield', 'IL', '62704', lat0, lng0, 'D', ''].join(','));
  }
  // Malformed: missing Last Name (required) → row errors.
  for (let m = 0; m < MALFORMED; m++) {
    lines.push([`BAD${m}`, 'NoLast', '', `${9000 + m} Nowhere Rd`, 'Springfield', 'IL', '62704', '10.0', '10.0', '', ''].join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

const orgId = O();
const campaignId = O();

async function runFile(filename) {
  const job = await ImportJob.create({
    organizationId: orgId,
    campaignId,
    filename,
    kind: 'apply',
    status: 'pending',
    fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, filename, buildCsv());
  await processImportJob({ id: `stress-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return ImportJob.findById(job._id).lean();
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  // Unique indexes matter for the dedup/upsert correctness this test exercises.
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes(), Person.syncIndexes()]);
});
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Organization, Campaign, ImportJob, Household, Voter, Person]) await M.deleteMany({});
  await Organization.collection.insertOne({ _id: orgId, name: 'StressOrg', slug: 'stress-org', isActive: true });
  await Campaign.collection.insertOne({ _id: campaignId, organizationId: orgId, name: 'Stress', type: 'candidate', state: 'IL', isActive: true });
});

test('large messy import completes with correct counts + chunked address resolution', { skip }, async () => {
  const job = await runFile('bigfile.csv');

  assert.strictEqual(job.status, 'completed', 'import completed without failing');
  assert.strictEqual(job.uniqueVoters, 2 * H, 'unique voters = 2 per household (dupes collapsed, bad rows skipped)');
  assert.strictEqual(job.uniqueHouseholds, H, 'unique households (2 voters share an address)');
  assert.strictEqual(job.newVoters, 2 * H, 'all valid voters new on first import');
  assert.strictEqual(job.newHouseholds, H, 'all households new on first import');
  assert.strictEqual(job.householdsWithFileCoords, H, 'arrived-with-coords count is exact');
  assert.ok(job.errorCount >= BAD_ROWS, `bad rows counted as errors (got ${job.errorCount}, expected >= ${BAD_ROWS})`);

  // The chunked normalizedAddress->_id resolution (csvImporter.js) must map EVERY voter to a
  // household — a broken wide $in would leave voters with a null householdId.
  const voterCount = await Voter.countDocuments({ organizationId: orgId });
  const orphanVoters = await Voter.countDocuments({ organizationId: orgId, householdId: null });
  const hhCount = await Household.countDocuments({ campaignId });
  assert.strictEqual(voterCount, 2 * H, 'every valid voter persisted');
  assert.strictEqual(orphanVoters, 0, 'no voter left without a household (chunked $in worked)');
  assert.strictEqual(hhCount, H, 'households persisted + deduped');
  assert.strictEqual((job.insertedHouseholdIds || []).length, H, 'inserted-household ids tracked for undo');
});

test('re-running the same file is idempotent (no duplicates)', { skip }, async () => {
  await runFile('bigfile.csv');
  const job2 = await runFile('bigfile.csv');

  assert.strictEqual(job2.status, 'completed');
  assert.strictEqual(job2.newVoters, 0, 're-run inserts no new voters');
  assert.strictEqual(job2.newHouseholds, 0, 're-run inserts no new households');
  assert.strictEqual(job2.uniqueVoters, 2 * H, 're-run still sees all voters');
  assert.strictEqual(await Voter.countDocuments({ organizationId: orgId }), 2 * H, 'no duplicate voters');
  assert.strictEqual(await Household.countDocuments({ campaignId }), H, 'no duplicate households');
});

test('undo restores (deletes the file\'s net-new records)', { skip }, async () => {
  const job = await runFile('bigfile.csv');
  const r = await undoFileImport(job, orgId, O());

  assert.ok(r.doorsDeleted > 0, 'undo deleted doors');
  assert.strictEqual(await Household.countDocuments({ campaignId }), 0, 'all imported households removed');
  assert.strictEqual(await Voter.countDocuments({ organizationId: orgId }), 0, 'all imported voters removed');
});
