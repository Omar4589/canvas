import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { undoFileImport } from './undoImport.js';
import { ImportJob } from '../../models/ImportJob.js';
import { Household } from '../../models/Household.js';
import { Voter } from '../../models/Voter.js';
import { Person } from '../../models/Person.js';

// Integration tests for the robust, cross-attempt import undo. Requires a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/undo_test node --test src/services/import/undoImport.int.test.js
// Locks the behavior that matters: undo a FILE across all its (crash-retry) upload attempts,
// delete the union of net-new records, but never touch a claimed/canvassed door.
const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const O = () => new mongoose.Types.ObjectId();
const orgId = O();
const campaignId = O();

before(async () => { if (URI) await mongoose.connect(URI); });
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [ImportJob, Household, Voter, Person]) await M.deleteMany({});
});

test('undo aggregates all of a file\'s upload attempts, deletes the union, keeps claimed doors', { skip }, async () => {
  const effortId = O();
  const [h1, h2, h3] = [O(), O(), O()];
  const [v1, v2, v3] = [O(), O(), O()];
  const [p1, p2, p3] = [O(), O(), O()];
  const [job1, job2, job3] = [O(), O(), O()];
  await Household.collection.insertMany([
    { _id: h1, campaignId, normalizedAddress: 'a1', effortId: null, turfId: null, status: 'unknocked', fullyVoted: false },
    { _id: h2, campaignId, normalizedAddress: 'a2', effortId, turfId: null, status: 'unknocked', fullyVoted: false }, // claimed
    { _id: h3, campaignId, normalizedAddress: 'a3', effortId: null, turfId: null, status: 'unknocked', fullyVoted: false },
  ]);
  await Voter.collection.insertMany([
    { _id: v1, organizationId: orgId, campaignId, stateVoterId: 's1', householdId: h1, personId: p1 },
    { _id: v2, organizationId: orgId, campaignId, stateVoterId: 's2', householdId: h2, personId: p2 },
    { _id: v3, organizationId: orgId, campaignId, stateVoterId: 's3', householdId: h3, personId: p3 },
  ]);
  await Person.collection.insertMany([{ _id: p1 }, { _id: p2 }, { _id: p3 }]);
  await ImportJob.collection.insertMany([
    { _id: job1, organizationId: orgId, campaignId, filename: 'HD54.xlsx', kind: 'apply', status: 'completed', undone: false, insertedHouseholdIds: [h1, h2], insertedVoterIds: [v1, v2], newHouseholds: 2 },
    { _id: job2, organizationId: orgId, campaignId, filename: 'HD54.xlsx', kind: 'apply', status: 'failed', undone: false, insertedHouseholdIds: [h3], insertedVoterIds: [v3] },
    { _id: job3, organizationId: orgId, campaignId, filename: 'HD54.xlsx', kind: 'apply', status: 'failed', undone: false, insertedHouseholdIds: [], insertedVoterIds: [] },
  ]);

  const r = await undoFileImport(await ImportJob.findById(job1).lean(), orgId, O());

  assert.deepStrictEqual(
    { jobsUndone: r.jobsUndone, trackedDoors: r.trackedDoors, trackedVoters: r.trackedVoters, doorsDeleted: r.doorsDeleted, doorsSkipped: r.doorsSkipped, votersDeleted: r.votersDeleted, votersSkipped: r.votersSkipped },
    { jobsUndone: 3, trackedDoors: 3, trackedVoters: 3, doorsDeleted: 2, doorsSkipped: 1, votersDeleted: 2, votersSkipped: 1 }
  );
  assert.strictEqual(r.skipReasons['claimed into an effort'], 1);
  assert.strictEqual(await Household.findById(h1).lean(), null);
  assert.ok(await Household.findById(h2).lean(), 'claimed door kept');
  assert.strictEqual(await Household.findById(h3).lean(), null);
  assert.ok(await Voter.findById(v2).lean(), 'voter in claimed door kept');
  assert.strictEqual(await Person.findById(p1).lean(), null, 'orphan person removed');
  assert.ok(await Person.findById(p2).lean(), 'person with a surviving voter kept');
  assert.strictEqual((await ImportJob.findById(job2).lean()).undone, true);
  assert.strictEqual((await ImportJob.findById(job3).lean()).undone, true);
});

test('undo a file with no insert records anywhere → zeros, nothing tracked', { skip }, async () => {
  const jNone = O();
  await ImportJob.collection.insertOne({ _id: jNone, organizationId: orgId, campaignId, filename: 'Empty.xlsx', kind: 'apply', status: 'completed', undone: false, insertedHouseholdIds: [], insertedVoterIds: [], newHouseholds: 0 });
  const r = await undoFileImport(await ImportJob.findById(jNone).lean(), orgId, O());
  assert.strictEqual(r.trackedDoors, 0);
  assert.strictEqual(r.doorsDeleted, 0);
  assert.strictEqual(r.jobsUndone, 1);
});
