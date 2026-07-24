import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { collectRevisitHomes } from './collectRevisitHomes.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { SavedSearch } from '../../models/SavedSearch.js';

// Integration tests for the import "revisit list" detection. Requires a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/revisit_test node --test --test-force-exit src/services/import/collectRevisitHomes.int.test.js
// Locks: only ALREADY-WORKED existing homes that gained a NEW voter go into the saved
// search; brand-new homes and not-yet-worked homes are excluded; opt-in + idempotent.
const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const O = () => new mongoose.Types.ObjectId();
const orgId = O();
const campaign = { _id: O(), organizationId: orgId };

before(async () => { if (URI) await mongoose.connect(URI); });
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Household, Voter, SavedSearch]) await M.deleteMany({});
});

// Seed a home with a given status + an existing voter, then a newly-inserted voter B at it.
async function seed({ homeStatus, homeIsNew = false }) {
  const home = O();
  const existingVoter = O();
  const newVoter = O();
  await Household.collection.insertOne({
    _id: home, campaignId: campaign._id, organizationId: orgId, normalizedAddress: 'a1', status: homeStatus, isActive: true,
  });
  await Voter.collection.insertMany([
    { _id: existingVoter, organizationId: orgId, campaignId: campaign._id, stateVoterId: 's-old', householdId: home },
    { _id: newVoter, organizationId: orgId, campaignId: campaign._id, stateVoterId: 's-new', householdId: home },
  ]);
  return { home, newVoter, homeIsNew };
}

function job(overrides = {}) {
  return { _id: O(), filename: 'HD54.csv', uploadedBy: O(), revisitNewVoters: true, revisitSavedSearchId: null, insertedVoterIds: [], insertedHouseholdIds: [], ...overrides };
}

test('worked home that gained a new voter → creates the saved search', { skip }, async () => {
  const { home, newVoter } = await seed({ homeStatus: 'surveyed' });
  const res = await collectRevisitHomes(
    job(),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [] }
  );
  assert.ok(res, 'returns a result');
  assert.strictEqual(res.householdCount, 1);
  const lists = await SavedSearch.find({ campaignId: campaign._id }).lean();
  assert.strictEqual(lists.length, 1);
  assert.strictEqual(lists[0].source, 'import');
  assert.deepStrictEqual(lists[0].householdIds.map(String), [String(home)]);
  assert.deepStrictEqual(lists[0].voterIds.map(String), [String(newVoter)]);
  assert.strictEqual(String(res.savedSearchId), String(lists[0]._id));
});

test('toggle off → nothing created', { skip }, async () => {
  const { newVoter } = await seed({ homeStatus: 'surveyed' });
  const res = await collectRevisitHomes(
    job({ revisitNewVoters: false }),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [] }
  );
  assert.strictEqual(res, null);
  assert.strictEqual(await SavedSearch.countDocuments({ source: 'import' }), 0);
});

test('new-address voter → excluded (home is in insertedHouseholdIds)', { skip }, async () => {
  const { home, newVoter } = await seed({ homeStatus: 'surveyed' });
  const res = await collectRevisitHomes(
    job(),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [home] } // the home is brand-new this import
  );
  assert.strictEqual(res, null);
  assert.strictEqual(await SavedSearch.countDocuments({ source: 'import' }), 0);
});

test('existing but NOT-yet-worked home → excluded', { skip }, async () => {
  const { newVoter } = await seed({ homeStatus: 'unknocked' });
  const res = await collectRevisitHomes(
    job(),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [] }
  );
  assert.strictEqual(res, null);
  assert.strictEqual(await SavedSearch.countDocuments({ source: 'import' }), 0);
});

test('idempotent — a job with revisitSavedSearchId already set does nothing', { skip }, async () => {
  const { newVoter } = await seed({ homeStatus: 'surveyed' });
  const res = await collectRevisitHomes(
    job({ revisitSavedSearchId: O() }),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [] }
  );
  assert.strictEqual(res, null);
  assert.strictEqual(await SavedSearch.countDocuments({ source: 'import' }), 0);
});

test('idempotent by importJobId — a retry that lost revisitSavedSearchId does not duplicate', { skip }, async () => {
  const { newVoter } = await seed({ homeStatus: 'surveyed' });
  const j = job(); // revisitSavedSearchId still null (crash before the final update persisted it)
  const counts = { insertedVoterIds: [newVoter], insertedHouseholdIds: [] };
  const first = await collectRevisitHomes(j, campaign, counts);
  assert.ok(first);
  // Same job re-runs (BullMQ retry) — revisitSavedSearchId is STILL null, but the list
  // already exists (found by sourceMeta.importJobId), so no duplicate is created.
  const second = await collectRevisitHomes(j, campaign, counts);
  assert.ok(second);
  assert.strictEqual(String(second.savedSearchId), String(first.savedSearchId));
  assert.strictEqual(await SavedSearch.countDocuments({ source: 'import' }), 1);
});

test('lit-drop: a lit_dropped home that gained a new voter → included', { skip }, async () => {
  const { home, newVoter } = await seed({ homeStatus: 'lit_dropped' });
  const res = await collectRevisitHomes(
    job(),
    campaign,
    { insertedVoterIds: [newVoter], insertedHouseholdIds: [] }
  );
  assert.ok(res);
  assert.strictEqual(res.householdCount, 1);
  const list = await SavedSearch.findOne({ source: 'import' }).lean();
  assert.deepStrictEqual(list.householdIds.map(String), [String(home)]);
});

test('retry-safe — falls back to importJob.insertedVoterIds when counts are empty', { skip }, async () => {
  const { home, newVoter } = await seed({ homeStatus: 'surveyed' });
  const res = await collectRevisitHomes(
    job({ insertedVoterIds: [newVoter] }), // persisted from a prior attempt
    campaign,
    { insertedVoterIds: [], insertedHouseholdIds: [] } // this retry inserted nothing
  );
  assert.ok(res);
  assert.deepStrictEqual((await SavedSearch.findOne({ source: 'import' }).lean()).householdIds.map(String), [String(home)]);
});
