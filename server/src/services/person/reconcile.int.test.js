import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { reconcileIdentityFromImport } from './reconcileIdentityFromImport.js';
import { Person } from '../../models/Person.js';
import { Voter } from '../../models/Voter.js';
import { PersonEditProposal } from '../../models/PersonEditProposal.js';
import { PersonMergeCandidate } from '../../models/PersonMergeCandidate.js';

// Integration tests for the batched import reconciliation (the shared-voter dedup/ownership
// core). Requires a throwaway mongod — set MONGODB_URI_TEST, e.g.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/recon_test node --test src/services/person/reconcile.int.test.js
// These lock the matching tree, ownership state machine, identity propagation, proposals,
// and merge-candidate behavior so the bulk path can never silently drift.
const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const orgA = new mongoose.Types.ObjectId();
const orgB = new mongoose.Types.ObjectId();
const V = (svid, extra = {}) => ({
  voter: { stateVoterId: svid, registeredState: 'FL', firstName: 'F' + svid, lastName: 'L' + svid, party: 'REP', ...extra },
  household: { state: 'FL' },
});
const seedVoter = (org, svid, name, personId) =>
  Voter.create({ organizationId: org, stateVoterId: svid, registeredState: 'FL', firstName: name, lastName: name, fullName: name + ' ' + name, party: 'REP', personId, householdId: new mongoose.Types.ObjectId() });

before(async () => { if (URI) { await mongoose.connect(URI); await Person.syncIndexes(); await Voter.syncIndexes(); } });
after(async () => { if (URI) await mongoose.disconnect(); });
beforeEach(async () => {
  if (!URI) return;
  for (const M of [Person, Voter, PersonEditProposal, PersonMergeCandidate]) await M.deleteMany({});
});

test('new org, all-new persons → created + provisionally owned, identity stamped, no proposals', { skip }, async () => {
  const rows = [V('S1'), V('S2'), V('S3')];
  const res = await reconcileIdentityFromImport(rows, { orgId: orgA });
  assert.deepStrictEqual(res, { linked: 3, personsTouched: 3, proposals: 0 });
  const persons = await Person.find({}).lean();
  assert.strictEqual(persons.length, 3);
  for (const p of persons) {
    assert.strictEqual(String(p.identityOwnerOrgId), String(orgA));
    assert.strictEqual(p.ownerProvisional, true);
    assert.strictEqual(p.identityVersion, 1);          // create(0) + canonical write(→1)
    assert.ok(p.fieldProvenance.firstName);            // provenance stamped
    assert.strictEqual(p.fieldProvenance.firstName.source, 'import');
  }
  // each row got a personId
  assert.ok(rows.every((r) => r.voter.personId));
});

test('returning org → existing identity propagated to canonical + voter cache, new person added, no proposals', { skip }, async () => {
  const p1 = await Person.create({ svidKeys: [{ registeredState: 'FL', stateVoterId: 'S1', source: 'import' }], firstName: 'OldF', lastName: 'OldL', fullName: 'OldF OldL', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
  await seedVoter(orgA, 'S1', 'OldF', p1._id);
  const rows = [V('S1', { firstName: 'NewF' }), V('S2')];
  const res = await reconcileIdentityFromImport(rows, { orgId: orgA });
  assert.strictEqual(res.proposals, 0);
  const reloaded = await Person.findById(p1._id).lean();
  assert.strictEqual(reloaded.firstName, 'NewF');                 // canonical updated
  const voter = await Voter.findOne({ organizationId: orgA, stateVoterId: 'S1' }).lean();
  assert.strictEqual(voter.firstName, 'NewF');                    // fan-out to existing voter cache
  assert.strictEqual(await Person.countDocuments({}), 2);        // S2 added
});

test('multi-org: 2nd org links to a provisional owner → ownership collapses, proposal raised', { skip }, async () => {
  const p1 = await Person.create({ svidKeys: [{ registeredState: 'FL', stateVoterId: 'S1', source: 'import' }], firstName: 'AName', lastName: 'AL', fullName: 'AName AL', party: 'REP', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
  await seedVoter(orgA, 'S1', 'AName', p1._id);
  const res = await reconcileIdentityFromImport([V('S1', { firstName: 'BName', party: 'DEM' })], { orgId: orgB });
  assert.strictEqual(res.proposals, 1);
  const reloaded = await Person.findById(p1._id).lean();
  assert.strictEqual(reloaded.identityOwnerOrgId, null);          // collapsed
  assert.strictEqual(reloaded.ownerProvisional, false);
  assert.strictEqual(reloaded.firstName, 'AName');               // canonical NOT clobbered
  const prop = await PersonEditProposal.findOne({ personId: p1._id, orgId: orgB }).lean();
  assert.ok(prop && prop.fields.firstName === 'BName' && prop.status === 'pending');
});

test('uid + svid pointing at different persons → uid wins, merge candidate raised', { skip }, async () => {
  const pu = await Person.create({ uidKeys: [{ uidSource: 'i360', uid: 'U1', source: 'import' }], firstName: 'UidF', lastName: 'UidL', matchConfidence: 'exact_uid' });
  await Person.create({ svidKeys: [{ registeredState: 'FL', stateVoterId: 'S9', source: 'import' }], firstName: 'SvidF', lastName: 'SvidL', matchConfidence: 'fallback_svid' });
  const rows = [V('S9', { uid: 'U1' })];
  await reconcileIdentityFromImport(rows, { orgId: orgA, uidSource: 'i360' });
  assert.strictEqual(String(rows[0].voter.personId), String(pu._id)); // linked to the uid match
  const cand = await PersonMergeCandidate.findOne({ reason: 'uid_svid_conflict' }).lean();
  assert.ok(cand, 'expected a uid_svid_conflict merge candidate');
});

test('dual-key new row → one person carrying both keys', { skip }, async () => {
  await reconcileIdentityFromImport([V('S5', { uid: 'U2' })], { orgId: orgA, uidSource: 'i360' });
  const persons = await Person.find({}).lean();
  assert.strictEqual(persons.length, 1);
  assert.strictEqual(persons[0].uidKeys.length, 1);
  assert.strictEqual(persons[0].svidKeys.length, 1);
  assert.strictEqual(persons[0].matchConfidence, 'exact_uid');
});

test('two rows sharing a key → one person (in-batch sharing)', { skip }, async () => {
  const rows = [V('S7'), V('S7', { firstName: 'Dup' })];
  const res = await reconcileIdentityFromImport(rows, { orgId: orgA });
  assert.strictEqual(res.personsTouched, 1);
  assert.strictEqual(await Person.countDocuments({}), 1);
  assert.strictEqual(String(rows[0].voter.personId), String(rows[1].voter.personId));
});

test('uid-only person + row with that uid and a new svid → svid promoted onto it', { skip }, async () => {
  const p = await Person.create({ uidKeys: [{ uidSource: 'i360', uid: 'U3', source: 'import' }], firstName: 'PromF', lastName: 'PromL', matchConfidence: 'exact_uid' });
  await reconcileIdentityFromImport([V('S8', { uid: 'U3' })], { orgId: orgA, uidSource: 'i360' });
  assert.strictEqual(await Person.countDocuments({}), 1);          // no new person
  const reloaded = await Person.findById(p._id).lean();
  assert.strictEqual(reloaded.svidKeys.length, 1);                 // gained the svid
  assert.strictEqual(reloaded.svidKeys[0].stateVoterId, 'S8');
});
