import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Filtered voters of an uploaded or import list (docs/PROPOSAL_RECENT_VISITS.md gap G1), over the real
// export processor:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/frozenlists node --test test/filteredVotersFrozen.int.test.js
//
// Those lists keep no conditions (filter: {}); the export used to re-resolve {} — the whole campaign. It
// now exports the list's own saved voters (the same people as the Saved Searches page's Download CSV),
// minus do-not-contact, counted the way the voter-file import branch counts them, estimate == build.
// A filter-built search stays live, exactly as before.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-frozen-lists';

const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { ExportJob } = await import('../src/models/ExportJob.js');
const { EXPORT_TYPES } = await import('../src/services/export/exportTypes.js');
const { loadDncVoterIdSet } = await import('../src/services/export/exportScope.js');
const { processExportJob } = await import('../src/services/export/exportProcessor.js');
const { openArtifactDownloadStream } = await import('../src/services/export/exportArtifactStore.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const TZ = 'America/Chicago';
const ctx = {};

const fakeQueueJob = (id) => ({ data: { exportJobId: String(id) }, id: `t-${id}`, attemptsMade: 1, opts: { attempts: 3 } });

const readArtifact = (jobId) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const s = openArtifactDownloadStream(jobId);
    s.on('data', (c) => chunks.push(c));
    s.on('error', reject);
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const scope = () => ({ organizationId: ctx.org._id, campaignId: ctx.camp._id });

async function exportList(search) {
  const params = await EXPORT_TYPES['voters-filtered'].validateParams({ savedSearchId: String(search._id) }, scope());
  const job = await ExportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, type: 'voters-filtered',
    params: { ...params, anchorTz: TZ }, requestedBy: ctx.user._id,
  });
  await processExportJob(fakeQueueJob(job._id)).catch(() => {});
  const doc = await ExportJob.findById(job._id).lean();
  const text = doc.status === 'completed' ? await readArtifact(job._id) : '';
  return { params, doc, text };
}

const estimate = async (params) =>
  EXPORT_TYPES['voters-filtered'].estimate({
    ...scope(),
    campaign: await Campaign.findById(ctx.camp._id).lean(),
    params,
    anchorTz: TZ,
    dnc: await loadDncVoterIdSet(ctx.org._id),
  });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ctx.org = await Organization.create({ name: 'Frozen Org', slug: 'frozen', isActive: true });
  ctx.user = await User.create({ firstName: 'Fro', lastName: 'Zen', email: 'fro@t.co', passwordHash: 'h', isActive: true });
  await Membership.create({ userId: ctx.user._id, organizationId: ctx.org._id, role: 'admin', isActive: true });
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Frozen', type: 'survey', state: 'NE', timeZone: TZ });

  const home = (n) => Household.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id,
    addressLine1: `${n} Frozen Rd`, city: 'Omaha', state: 'NE', zipCode: '68102',
    normalizedAddress: `${n} FROZEN RD|OMAHA|NE|68102`,
    location: { type: 'Point', coordinates: [-95.9 + n * 0.001, 41.2] },
  });
  const [h1, h2, h3] = [await home(1), await home(2), await home(3)];
  let seq = 0;
  const voter = (h, extra = {}) => Voter.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, householdId: h._id,
    stateVoterId: `FZ${++seq}`, firstName: `Name${seq}`, lastName: 'Frozen', fullName: `Name${seq} Frozen`,
    ...extra,
  });
  // The uploaded list matched Uma at h1; a list keeps everyone at its homes, so her housemate Hal and
  // her do-not-contact housemate Dee are on it too. Six other voters live elsewhere in the campaign.
  ctx.uma = await voter(h1, { firstName: 'Uma', party: 'DEM' });
  ctx.hal = await voter(h1, { firstName: 'Hal', party: 'REP' });
  ctx.dee = await voter(h1, { firstName: 'Dee', party: 'DEM', doNotContact: { flagged: true } });
  ctx.newbie = await voter(h2, { firstName: 'Newbie', party: 'DEM' });
  for (const h of [h2, h2, h3, h3, h3]) await voter(h, { party: 'DEM' });

  ctx.uploaded = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Uploaded list', filter: {}, source: 'csv',
    householdIds: [h1._id], voterIds: [ctx.uma._id, ctx.hal._id, ctx.dee._id], householdCount: 1, voterCount: 3,
  });
  ctx.imported = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'New voters — file.csv', filter: {}, source: 'import',
    householdIds: [h2._id], voterIds: [ctx.newbie._id], householdCount: 1, voterCount: 1,
  });
  ctx.byFilter = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Democrats', filter: { parties: ['DEM'] }, source: 'filter',
    householdIds: [], voterIds: [], householdCount: 0, voterCount: 0,
  });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('1. an uploaded list exports its own people, minus do-not-contact — not the campaign', { skip }, async () => {
  const { params, doc, text } = await exportList(ctx.uploaded);
  assert.equal(params.frozen, true);
  assert.equal(doc.status, 'completed', doc.error);
  assert.equal(doc.rowCount, 2, 'Uma and Hal — not the 9 voters in the campaign');
  assert.ok(text.includes('Uma') && text.includes('Hal'));
  assert.ok(!text.includes('Dee'), 'the do-not-contact housemate never ships');
  assert.equal(doc.excludedDncCount, 1, 'and is counted as held back');
  const est = await estimate(params);
  assert.equal(est.rows, doc.rowCount, 'estimate equals build');
  assert.equal(est.dncWithheld, doc.excludedDncCount);
});

test('2. an import "New voters" list exports only its new voters', { skip }, async () => {
  const { params, doc, text } = await exportList(ctx.imported);
  assert.equal(params.frozen, true);
  assert.equal(doc.rowCount, 1);
  assert.ok(text.includes('Newbie'));
  assert.equal((await estimate(params)).rows, 1);
});

test('3. a filter-built search stays live, as before', { skip }, async () => {
  const { params, doc } = await exportList(ctx.byFilter);
  assert.equal(params.frozen, false);
  assert.equal(doc.rowCount, 7, 'every Democrat now, minus do-not-contact Dee — resolved on export day');
});

test('4. a list deleted after the request fails with a plain sentence', { skip }, async () => {
  const temp = await SavedSearch.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, name: 'Gone soon', filter: {}, source: 'csv',
    householdIds: [], voterIds: [ctx.uma._id], householdCount: 1, voterCount: 1,
  });
  const params = await EXPORT_TYPES['voters-filtered'].validateParams({ savedSearchId: String(temp._id) }, scope());
  await SavedSearch.deleteOne({ _id: temp._id });
  const job = await ExportJob.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, type: 'voters-filtered',
    params: { ...params, anchorTz: TZ }, requestedBy: ctx.user._id,
  });
  await processExportJob(fakeQueueJob(job._id)).catch(() => {});
  const doc = await ExportJob.findById(job._id).lean();
  assert.equal(doc.status, 'failed');
  assert.equal(doc.error, 'That saved search was deleted.');
});
