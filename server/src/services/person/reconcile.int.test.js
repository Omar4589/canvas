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
const seedVoter = (org, svid, name, personId, extra = {}) =>
  Voter.create({ organizationId: org, stateVoterId: svid, registeredState: 'FL', firstName: name, lastName: name, fullName: name + ' ' + name, party: 'REP', personId, householdId: new mongoose.Types.ObjectId(), ...extra });

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
  const p1 = await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S1', source: 'import' }], firstName: 'OldF', lastName: 'OldL', fullName: 'OldF OldL', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
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

// REPLACES: 'multi-org: 2nd org links to a provisional owner → ownership collapses, proposal raised'.
//
// That test locked in the behaviour we removed. A Person was global, so a second org importing the
// same human LINKED to the first org's record — and everything downstream (ownership collapse, edit
// proposals, a super-admin arbitrating between two customers) existed only to manage the fallout of
// two customers sharing one row. Persons are org-scoped now: the second org simply gets its own.
test('multi-org: a 2nd org importing the same human gets its OWN Person — nothing is shared', { skip }, async () => {
  const p1 = await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S1', source: 'import' }], firstName: 'AName', lastName: 'AL', fullName: 'AName AL', party: 'REP', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
  await seedVoter(orgA, 'S1', 'AName', p1._id);

  const res = await reconcileIdentityFromImport([V('S1', { firstName: 'BName', party: 'DEM' })], { orgId: orgB });

  // No proposal: there is nothing to propose to. Org B is not editing anyone else's record.
  assert.strictEqual(res.proposals, 0);
  assert.strictEqual(await PersonEditProposal.countDocuments({}), 0);

  // Two Persons for the same human — one per org.
  assert.strictEqual(await Person.countDocuments({}), 2);
  const pB = await Person.findOne({ organizationId: orgB }).lean();
  assert.ok(pB && String(pB._id) !== String(p1._id), 'Org B got a NEW Person, not Org A\'s');
  assert.strictEqual(pB.firstName, 'BName', 'Org B\'s own import value');

  // And Org A's record is exactly as it was. This is the whole point.
  const a = await Person.findById(p1._id).lean();
  assert.strictEqual(a.firstName, 'AName', 'Org A\'s canonical identity is untouched by Org B');
  assert.strictEqual(String(a.identityOwnerOrgId), String(orgA), 'ownership does not collapse — there is no sharing to arbitrate');
});

test('uid + svid pointing at different persons → uid wins, merge candidate raised', { skip }, async () => {
  const pu = await Person.create({ organizationId: orgA, uidKeys: [{ uidSource: 'i360', uid: 'U1', source: 'import' }], firstName: 'UidF', lastName: 'UidL', matchConfidence: 'exact_uid' });
  await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S9', source: 'import' }], firstName: 'SvidF', lastName: 'SvidL', matchConfidence: 'fallback_svid' });
  const rows = [V('S9', { uid: 'U1' })];
  await reconcileIdentityFromImport(rows, { orgId: orgA, uidSource: 'i360' });
  assert.strictEqual(String(rows[0].voter.personId), String(pu._id)); // linked to the uid match
  const cand = await PersonMergeCandidate.findOne({ reason: 'uid_svid_conflict' }).lean();
  assert.ok(cand, 'expected a uid_svid_conflict merge candidate');
  // Batch 3: the candidate carries its org, so the review endpoint can filter/page in the DB
  // (the old shape fetched platform-wide and filtered in JS — silently truncatable).
  assert.strictEqual(String(cand.organizationId), String(orgA), 'candidate is stamped with its org');
});

test('every raised candidate carries organizationId (multi-candidate conflict scenario)', { skip }, async () => {
  // Both matchers hit different persons → the direct conflict raise. (promote()'s E11000 branch is
  // a CONCURRENCY guard — the unique indexes include uidSource, so it is not reachable
  // single-threaded; its person.organizationId stamping is covered by review, not by this test.)
  await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S8', source: 'import' }], firstName: 'A', lastName: 'A' });
  await Person.create({ organizationId: orgA, uidKeys: [{ uidSource: 'i360', uid: 'U8', source: 'import' }], svidKeys: [{ registeredState: 'FL', stateVoterId: 'SX', source: 'import' }], firstName: 'B', lastName: 'B' });
  await reconcileIdentityFromImport([V('S8', { uid: 'U8' })], { orgId: orgA, uidSource: 'i360' });
  const cands = await PersonMergeCandidate.find({ reason: 'uid_svid_conflict' }).lean();
  assert.ok(cands.length >= 1, 'the conflict raised a candidate');
  for (const c of cands) {
    assert.strictEqual(String(c.organizationId), String(orgA), 'every candidate carries the org');
  }
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
  const p = await Person.create({ organizationId: orgA, uidKeys: [{ uidSource: 'i360', uid: 'U3', source: 'import' }], firstName: 'PromF', lastName: 'PromL', matchConfidence: 'exact_uid' });
  await reconcileIdentityFromImport([V('S8', { uid: 'U3' })], { orgId: orgA, uidSource: 'i360' });
  assert.strictEqual(await Person.countDocuments({}), 1);          // no new person
  const reloaded = await Person.findById(p._id).lean();
  assert.strictEqual(reloaded.svidKeys.length, 1);                 // gained the svid
  assert.strictEqual(reloaded.svidKeys[0].stateVoterId, 'S8');
});

// REPLACES: 're-import fans the new identity to the canonical Person AND every org's voter cache'.
//
// Read that old title again — "every org's voter cache" was the ASSERTION. This test used to seed a
// voter row in a second org, pointed at the same Person, and then demand that Org A's import rewrite
// it. It was the bug, encoded as a requirement, passing green.
test('re-import fans the new identity to THIS org\'s voter cache only — never another org\'s', { skip }, async () => {
  const p = await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S1', source: 'import' }], firstName: 'OldF', lastName: 'OldL', fullName: 'OldF OldL', party: 'REP', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
  await seedVoter(orgA, 'S1', 'OldF', p._id);
  // A voter row in ANOTHER org pointed at Org A's Person. This should be impossible now — but if a
  // bug ever re-created the link, the org filter in the fan-out is what stops it becoming a write.
  await seedVoter(orgB, 'S1', 'OldF', p._id);

  await reconcileIdentityFromImport([V('S1', { firstName: 'NewF', lastName: 'NewL' })], { orgId: orgA });

  assert.strictEqual((await Person.findById(p._id).lean()).firstName, 'NewF'); // canonical

  const a = await Voter.findOne({ organizationId: orgA, stateVoterId: 'S1' }).lean();
  assert.strictEqual(a.firstName, 'NewF', 'fan-out reached the importing org');
  assert.ok(a.identityBackup, 'identityBackup snapshotted once');

  const b = await Voter.findOne({ organizationId: orgB, stateVoterId: 'S1' }).lean();
  assert.strictEqual(b.firstName, 'OldF', '*** Org B\'s row MUST NOT be touched by Org A\'s import ***');
});

test('fan-out honors a locally-edited voter field (preserves it; still updates the rest)', { skip }, async () => {
  const p = await Person.create({ organizationId: orgA, svidKeys: [{ registeredState: 'FL', stateVoterId: 'S2', source: 'import' }], firstName: 'OldF', lastName: 'OldL', fullName: 'OldF OldL', party: 'REP', identityOwnerOrgId: orgA, ownerProvisional: true, identityVersion: 1 });
  await seedVoter(orgA, 'S2', 'KeepF', p._id, { locallyEditedFields: ['firstName'] });
  await reconcileIdentityFromImport([V('S2', { firstName: 'NewF', lastName: 'NewL' })], { orgId: orgA });
  const v = await Voter.findOne({ organizationId: orgA, stateVoterId: 'S2' }).lean();
  assert.strictEqual(v.firstName, 'KeepF'); // locked → preserved
  assert.strictEqual(v.lastName, 'NewL');   // unlocked → updated
});
