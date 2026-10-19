import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// clearParkedByCanonical, on a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/clear_parked_test node --test test/clearParkedByCanonical.int.test.js
//
// The helper used to load every parked row in scope and fold them in memory; during early voting that
// is over a million rows per campaign (a cumulative county list parks the same IDs on every upload),
// on the web dyno for every voted-list / do-not-contact upload and on the worker for every import that
// graduates an ID. It now deletes by spelling on the index. These tests pin that it removes EXACTLY
// what the old fold removed (a copy of the old body is the oracle), that the caller's scope always
// holds — another campaign's parked IDs, and another organization's or another state's do-not-contact
// requests, survive — and that it never reads the pile into memory.

const { VotedPendingId } = await import('../src/models/VotedPendingId.js');
const { DncPendingId } = await import('../src/models/DncPendingId.js');
const { clearParkedByCanonical } = await import('../src/services/voters/voterIdLookup.js');
const { canonicalVoterId } = await import('../src/utils/voterIdKey.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const O = () => new mongoose.Types.ObjectId();
const ctx = {};

// The pre-change body, kept as the oracle: which rows in `filter` would the in-memory fold delete?
async function oldFoldIds(Model, filter, canonicals) {
  const wanted = canonicals instanceof Set ? canonicals : new Set(canonicals);
  if (!wanted.size) return [];
  const rows = await Model.find(filter, { stateVoterId: 1 }).lean();
  return rows.filter((r) => wanted.has(canonicalVoterId(r.stateVoterId))).map((r) => String(r._id)).sort();
}
const remainingIds = async (Model, filter) => (await Model.find(filter, { _id: 1 }).lean()).map((r) => String(r._id)).sort();

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await Promise.all([VotedPendingId.syncIndexes(), DncPendingId.syncIndexes()]);
  Object.assign(ctx, { orgA: O(), orgB: O(), campA: O(), campB: O(), upload: O() });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

const parkVoted = (campaignId, ids, organizationId = ctx.orgA) =>
  VotedPendingId.insertMany(ids.map((stateVoterId) => ({ organizationId, campaignId, uploadId: ctx.upload, stateVoterId })));
const parkDnc = (organizationId, rows) =>
  DncPendingId.insertMany(rows.map(([stateVoterId, state]) => ({ organizationId, stateVoterId, state })));

test('voted: deletes exactly what the old fold deleted, every spelling, inside the campaign only', { skip }, async () => {
  await VotedPendingId.deleteMany({});
  // Campaign A parks one ID under three spellings — padded to 8 (the state's file), Excel-stripped, and
  // padded to 10 (wider than any voter, from a list padded differently) — plus a letter ID, an
  // unrelated ID, and an all-zero placeholder. Campaign B parks the same digits.
  await parkVoted(ctx.campA, ['08719967', '8719967', '0008719967', '12345', 'TX-ABC', '00000000', 'tx-abc']);
  await parkVoted(ctx.campB, ['8719967', '08719967', 'TX-ABC'], ctx.orgB);
  const filter = { campaignId: ctx.campA };
  const canonicals = ['8719967', 'TX-ABC'];
  const expected = await oldFoldIds(VotedPendingId, filter, canonicals);
  const before = await remainingIds(VotedPendingId, filter);

  const n = await clearParkedByCanonical(VotedPendingId, filter, canonicals);

  const after = await remainingIds(VotedPendingId, filter);
  assert.strictEqual(n, expected.length, 'returns the number of rows the old fold would have deleted');
  assert.deepStrictEqual(after, before.filter((id) => !expected.includes(id)), 'same rows left as the old fold');
  const left = (await VotedPendingId.find(filter, { stateVoterId: 1 }).lean()).map((r) => r.stateVoterId).sort();
  assert.deepStrictEqual(left, ['00000000', '12345', 'tx-abc'], 'letter IDs match only themselves (case kept); all-zero is no ID');
  assert.strictEqual(await VotedPendingId.countDocuments({ campaignId: ctx.campB }), 3, "another campaign's parked IDs are untouched");
});

test('do-not-contact: the organization and state scope holds — no other org, no sibling state', { skip }, async () => {
  await DncPendingId.deleteMany({});
  await parkDnc(ctx.orgA, [['05187273', 'GA'], ['5187273', null], ['05187273', 'NE'], ['77777777', 'GA']]);
  await parkDnc(ctx.orgB, [['05187273', 'GA'], ['5187273', null]]);
  const filter = { organizationId: ctx.orgA, $or: [{ state: 'GA' }, { state: null }] };
  const expected = await oldFoldIds(DncPendingId, filter, ['5187273']);

  const n = await clearParkedByCanonical(DncPendingId, filter, ['5187273']);

  assert.strictEqual(n, 2);
  assert.strictEqual(expected.length, 2, 'the oracle agrees: the GA and the unstamped parking');
  const orgALeft = (await DncPendingId.find({ organizationId: ctx.orgA }, { stateVoterId: 1, state: 1 }).lean())
    .map((r) => `${r.stateVoterId}/${r.state}`).sort();
  assert.deepStrictEqual(orgALeft, ['05187273/NE', '77777777/GA'], "a sibling state's request and other IDs survive");
  assert.strictEqual(await DncPendingId.countDocuments({ organizationId: ctx.orgB }), 2, "another organization's requests survive");
});

test('never reads the parked pile into memory', { skip }, async (t) => {
  await VotedPendingId.deleteMany({});
  await parkVoted(ctx.campA, Array.from({ length: 300 }, (_, i) => String(20000000 + i).padStart(9, '0')));
  const find = t.mock.method(VotedPendingId, 'find');
  const n = await clearParkedByCanonical(VotedPendingId, { campaignId: ctx.campA }, ['20000001', '20000002']);
  assert.strictEqual(n, 2);
  assert.strictEqual(find.mock.callCount(), 0, 'no find over the scope — width by aggregate, deletes by index');
});

test('chunks thousands of IDs without splitting one ID across deletes, and matches the oracle', { skip }, async () => {
  await VotedPendingId.deleteMany({});
  // 6,000 IDs, each parked padded and stripped, plus 500 that are not being cleared.
  const ids = Array.from({ length: 6500 }, (_, i) => String(3000000 + i));
  await parkVoted(ctx.campA, ids.flatMap((id) => [id, id.padStart(8, '0')]));
  const filter = { campaignId: ctx.campA };
  const canonicals = new Set(ids.slice(0, 6000));
  const expected = await oldFoldIds(VotedPendingId, filter, canonicals);

  const n = await clearParkedByCanonical(VotedPendingId, filter, canonicals);

  assert.strictEqual(n, 12000);
  assert.strictEqual(expected.length, 12000);
  assert.strictEqual(await VotedPendingId.countDocuments(filter), 1000, 'the 500 IDs not asked for keep both spellings');
});

test('nothing to clear: empty, null and non-canonical inputs delete nothing (as before)', { skip }, async () => {
  await VotedPendingId.deleteMany({});
  await parkVoted(ctx.campA, ['08719967', '8719967']);
  const filter = { campaignId: ctx.campA };
  assert.strictEqual(await clearParkedByCanonical(VotedPendingId, filter, []), 0);
  assert.strictEqual(await clearParkedByCanonical(VotedPendingId, filter, new Set([null])), 0);
  // '08719967' is a spelling, not a canonical ID: the old fold compared canonical forms and matched nothing.
  assert.deepStrictEqual(await oldFoldIds(VotedPendingId, filter, ['08719967']), []);
  assert.strictEqual(await clearParkedByCanonical(VotedPendingId, filter, ['08719967']), 0);
  assert.strictEqual(await VotedPendingId.countDocuments(filter), 2);
});
