import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Do-not-contact LIST UPLOADS, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/dncupload_test node --test test/dncUpload.int.test.js
// Locks: the org-wide preview (spans campaigns, already-flagged voters counted separately,
// per-campaign door-drop breakdown), apply attribution (source:'upload' + uploadId; an
// admin-set flag is NEVER re-stamped), undo (only the upload's own rows revert, pendings die,
// 409 on a second undo), sticky-DNC graduation via reapplyDncLists, and undoImport's
// keep-guards (a DNC voter and its fully-DNC door survive an import undo).
// Uploads are real multipart bodies (Node 20 FormData/Blob) through multer.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-dnc-upload';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { DncUpload } = await import('../src/models/DncUpload.js');
const { DncPendingId } = await import('../src/models/DncPendingId.js');
const { recomputeFullyDnc } = await import('../src/services/dnc/recomputeFullyDnc.js');
const { reapplyDncLists } = await import('../src/services/dnc/reapplyDncLists.js');
const { undoImport } = await import('../src/services/import/undoImport.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

let doorNo = 0;
function hh(orgId, campaignId, extra = {}) {
  doorNo += 1;
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${doorNo} Upload Ave`,
    city: 'Town',
    state: 'FL',
    zipCode: '34741',
    normalizedAddress: `${doorNo} UPLOAD AVE|TOWN|FL|34741`,
    location: { type: 'Point', coordinates: [-81.4 + doorNo * 0.001, 28.3] },
    isActive: true,
    status: 'unknocked',
    ...extra,
  };
}
function voter(orgId, campaignId, householdId, svid, name) {
  return { organizationId: orgId, campaignId, householdId, stateVoterId: svid, firstName: name, lastName: 'Uploaded', fullName: `${name} Uploaded` };
}

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Household, Voter, DncUpload, DncPendingId]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Upload Org', slug: 'upload-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Uma', lastName: 'Admin', email: 'ua@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  // TWO campaigns — the upload is org-wide and must span both.
  const campA = await Campaign.create({ organizationId: org._id, name: 'Camp A', type: 'survey', state: 'FL', isActive: true });
  const campB = await Campaign.create({ organizationId: org._id, name: 'Camp B', type: 'survey', state: 'FL', isActive: true });

  // Campaign A: dA1 (single voter — will fully drop), dA2 (two voters — untouched control),
  // dPre (single voter, ADMIN-flagged before any upload). Campaign B: dB1 (single voter — will
  // fully drop). Unique svids, none a substring of another.
  const [dA1, dA2, dPre] = await Household.insertMany([hh(org._id, campA._id), hh(org._id, campA._id), hh(org._id, campA._id)]);
  const [dB1] = await Household.insertMany([hh(org._id, campB._id)]);
  const [vA1, , , vPre, vB1] = await Voter.insertMany([
    voter(org._id, campA._id, dA1._id, 'UP-A1', 'Ann'),
    voter(org._id, campA._id, dA2._id, 'UP-A2', 'Abe'),
    voter(org._id, campA._id, dA2._id, 'UP-A3', 'Amy'),
    voter(org._id, campA._id, dPre._id, 'UP-PRE', 'Pat'),
    voter(org._id, campB._id, dB1._id, 'UP-B1', 'Bob'),
  ]);
  // Numeric IDs for the leading-zero cases (tests 14+): a padded Floridian, an unpadded one whose
  // digits a GEORGIA voter shares, and a Georgia-only voter. Their doors are their own, so the
  // door-drop counts in tests 9-13 are untouched.
  const campG = await Campaign.create({ organizationId: org._id, name: 'Camp G', type: 'survey', state: 'GA', isActive: true });
  const [dNum, dFlo] = await Household.insertMany([hh(org._id, campA._id), hh(org._id, campA._id)]);
  const [dGa1, dGa2] = await Household.insertMany([hh(org._id, campG._id, { state: 'GA' }), hh(org._id, campG._id, { state: 'GA' })]);
  await Voter.insertMany([
    voter(org._id, campA._id, dNum._id, '00097985', 'Brian'),
    voter(org._id, campA._id, dFlo._id, '1234', 'Flo'),
    voter(org._id, campG._id, dGa1._id, '0001234', 'Alice'),
    voter(org._id, campG._id, dGa2._id, '55555', 'Gus'),
  ]);
  Object.assign(ctx, { campG });

  // The pre-existing ADMIN flag (uploadId null) the upload must count as alreadyFlagged and
  // whose stamp apply/undo must never touch.
  const preStamp = new Date(Date.now() - 86400000);
  await Voter.updateOne(
    { _id: vPre._id },
    { $set: { doNotContact: { flagged: true, at: preStamp, byUserId: admin._id, reason: 'Admin flagged long ago', source: 'admin', uploadId: null } } }
  );
  await recomputeFullyDnc([dPre._id]); // dPre is fully DNC before the upload — preview must skip it

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, campA, campB, dA1, dA2, dPre, dB1, vA1, vPre, vB1, preStamp, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

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

// Real multipart upload (field name 'file'), exactly as the web console sends it. A do-not-contact
// list is declared for ONE state (both seeded campaigns are in Florida).
async function uploadCsv(path, csv, fields = { state: 'FL' }) {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'dnc-list.csv');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

// svids spanning BOTH campaigns + the pre-flagged voter + one unknown id.
const CSV = 'Voter ID\nUP-A1\nUP-B1\nUP-PRE\nUP-NOPE\n';

test('9. org-wide preview: spans campaigns, splits already-flagged, per-campaign drops, no writes', { skip }, async () => {
  const r = await uploadCsv('/admin/dnc/preview', CSV);
  assert.strictEqual(r.status, 200);

  assert.strictEqual(r.json.matched, 3, 'UP-A1 + UP-B1 + UP-PRE — both campaigns matched');
  assert.strictEqual(r.json.willFlag, 2, 'the two not-yet-flagged voters');
  assert.strictEqual(r.json.alreadyFlagged, 1, 'the admin-flagged voter counts here, not in willFlag');
  assert.strictEqual(r.json.notFound, 1);
  assert.deepStrictEqual(r.json.notFoundIds, ['UP-NOPE']);

  // Doors that would fully drop: dA1 (campaign A) and dB1 (campaign B). dPre is ALREADY
  // fully-DNC so it is not a new drop; dA2 has unflagged residents.
  assert.strictEqual(r.json.doorsWillDrop, 2);
  assert.strictEqual(r.json.dropsByCampaign.length, 2, 'both campaigns listed');
  const dropA = r.json.dropsByCampaign.find((d) => d.campaignId === String(ctx.campA._id));
  const dropB = r.json.dropsByCampaign.find((d) => d.campaignId === String(ctx.campB._id));
  assert.strictEqual(dropA?.doors, 1);
  assert.strictEqual(dropA?.name, 'Camp A');
  assert.strictEqual(dropB?.doors, 1);
  assert.strictEqual(dropB?.name, 'Camp B');

  // Dry run: nothing was written.
  assert.strictEqual(await DncUpload.countDocuments({}), 0);
  assert.strictEqual(await DncPendingId.countDocuments({}), 0);
  assert.strictEqual(await Voter.countDocuments({ 'doNotContact.flagged': true }), 1, 'still only the admin flag');
});

test('10. apply: upload attribution on new flags, admin stamp untouched, pendings recorded', { skip }, async () => {
  const r = await uploadCsv('/admin/dnc/import', CSV);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.matched, 3);
  assert.strictEqual(r.json.flagged, 2);
  assert.strictEqual(r.json.alreadyFlagged, 1);
  assert.strictEqual(r.json.notFound, 1);
  assert.strictEqual(r.json.doorsDropped, 2, 'dA1 + dB1 became fully DNC');
  ctx.uploadId = r.json.uploadId;

  for (const v of [ctx.vA1, ctx.vB1]) {
    const sub = (await Voter.findById(v._id).lean()).doNotContact;
    assert.strictEqual(sub.flagged, true);
    assert.strictEqual(sub.source, 'upload');
    assert.strictEqual(String(sub.uploadId), ctx.uploadId, 'flag attributed to THIS upload');
  }

  // The pre-flagged admin voter keeps its original stamp — the upload never claims it.
  const pre = (await Voter.findById(ctx.vPre._id).lean()).doNotContact;
  assert.strictEqual(pre.flagged, true);
  assert.strictEqual(pre.source, 'admin');
  assert.strictEqual(pre.uploadId, null);
  assert.strictEqual(new Date(pre.at).getTime(), ctx.preStamp.getTime(), 'original at survives the upload');

  assert.strictEqual((await Household.findById(ctx.dA1._id).lean()).fullyDnc, true);
  assert.strictEqual((await Household.findById(ctx.dB1._id).lean()).fullyDnc, true);
  assert.strictEqual((await Household.findById(ctx.dA2._id).lean()).fullyDnc, false, 'control door untouched');

  // The unknown id became a sticky pending row for this upload.
  const pending = await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'UP-NOPE' }).lean();
  assert.ok(pending, 'unmatched id recorded as DncPendingId');
  assert.strictEqual(String(pending.uploadId), ctx.uploadId);

  const doc = await DncUpload.findById(ctx.uploadId).lean();
  assert.strictEqual(doc.matched, 2);
  assert.strictEqual(doc.alreadyFlagged, 1);
  assert.strictEqual(doc.notFound, 1);
  assert.strictEqual(doc.doorsDropped, 2);
});

test('11. undo: only the upload\'s own rows revert; pendings die; second undo 409', { skip }, async () => {
  const r = await call('POST', '/admin/dnc/undo', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { uploadId: ctx.uploadId },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.unflagged, 2);

  for (const v of [ctx.vA1, ctx.vB1]) {
    const sub = (await Voter.findById(v._id).lean()).doNotContact;
    assert.strictEqual(sub.flagged, false, 'upload-flagged voter reverted');
    assert.strictEqual(String(sub.uploadId), ctx.uploadId, 'stamp kept for history — only the flag flips');
  }
  const pre = (await Voter.findById(ctx.vPre._id).lean()).doNotContact;
  assert.strictEqual(pre.flagged, true, 'the admin-set flag is never touched by an upload\'s undo');

  assert.strictEqual((await Household.findById(ctx.dA1._id).lean()).fullyDnc, false, 'door reopened');
  assert.strictEqual((await Household.findById(ctx.dB1._id).lean()).fullyDnc, false, 'door reopened');
  assert.strictEqual((await Household.findById(ctx.dPre._id).lean()).fullyDnc, true, 'the admin-flagged door stays suppressed');

  assert.strictEqual(await DncPendingId.countDocuments({ uploadId: ctx.uploadId }), 0, 'pendings deleted');
  assert.strictEqual((await DncUpload.findById(ctx.uploadId).lean()).undone, true);

  const again = await call('POST', '/admin/dnc/undo', {
    token: ctx.adminTok, orgId: ctx.org._id, body: { uploadId: ctx.uploadId },
  });
  assert.strictEqual(again.status, 409, 'an upload can only be undone once');
});

test('12. graduation: a pending id flags the voter when they later enter the universe', { skip }, async () => {
  // A fresh upload whose only id has no voter anywhere in the org yet.
  const up = await uploadCsv('/admin/dnc/import', 'Voter ID\nUP-GRAD\n');
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.json.notFound, 1);
  const upload2 = up.json.uploadId;
  assert.ok(await DncPendingId.findOne({ organizationId: ctx.org._id, stateVoterId: 'UP-GRAD' }).lean());

  // The voter later arrives (as a universe import would insert them) — single-voter door.
  const [dG] = await Household.insertMany([hh(ctx.org._id, ctx.campB._id)]);
  const [vG] = await Voter.insertMany([voter(ctx.org._id, ctx.campB._id, dG._id, 'UP-GRAD', 'Grace')]);

  const result = await reapplyDncLists(ctx.org._id);
  assert.strictEqual(result.flagged, 1);
  assert.deepStrictEqual(result.householdIds, [String(dG._id)], 'the affected door comes back for recompute');

  const sub = (await Voter.findById(vG._id).lean()).doNotContact;
  assert.strictEqual(sub.flagged, true, 'the pre-arrival request is honored');
  assert.strictEqual(sub.source, 'upload');
  assert.strictEqual(String(sub.uploadId), upload2, 'attributed to the upload that asked');
  assert.strictEqual(sub.byUserId, null, 'graduation is system-applied, no user stamp');

  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: 'UP-GRAD' }), 0, 'pending row graduated away');
  assert.strictEqual((await DncUpload.findById(upload2).lean()).matched, 1, 'the upload\'s matched count catches up');

  // The caller's contract: recomputeFullyDnc(returned householdIds) suppresses the door.
  await recomputeFullyDnc(result.householdIds);
  assert.strictEqual((await Household.findById(dG._id).lean()).fullyDnc, true);
});

test('13. undoImport keep-guards: DNC voters and fully-DNC doors survive an import undo', { skip }, async () => {
  // Simulate an import's inserted rows (undoImport reads campaignId + insertedVoterIds +
  // insertedHouseholdIds off the job): dU — single voter, flagged DNC after the import, so the
  // door itself is fully DNC; dV — two voters, one flagged, one clean.
  const [dU, dV] = await Household.insertMany([hh(ctx.org._id, ctx.campA._id), hh(ctx.org._id, ctx.campA._id)]);
  const [vU, vV1, vV2] = await Voter.insertMany([
    voter(ctx.org._id, ctx.campA._id, dU._id, 'UP-U1', 'Uri'),
    voter(ctx.org._id, ctx.campA._id, dV._id, 'UP-V1', 'Vin'),
    voter(ctx.org._id, ctx.campA._id, dV._id, 'UP-V2', 'Wes'),
  ]);
  const stamp = { flagged: true, at: new Date(), byUserId: ctx.admin._id, reason: 'Do not contact', source: 'admin', uploadId: null };
  await Voter.updateMany({ _id: { $in: [vU._id, vV1._id] } }, { $set: { doNotContact: stamp } });
  await recomputeFullyDnc([dU._id, dV._id]);
  assert.strictEqual((await Household.findById(dU._id).lean()).fullyDnc, true);
  assert.strictEqual((await Household.findById(dV._id).lean()).fullyDnc, false);

  const result = await undoImport({
    campaignId: ctx.campA._id,
    insertedVoterIds: [vU._id, vV1._id, vV2._id],
    insertedHouseholdIds: [dU._id, dV._id],
  });

  // A DNC flag is a suppression record — undoing the import must never destroy the request.
  assert.ok(await Voter.findById(vU._id), 'DNC voter survives');
  assert.ok(await Voter.findById(vV1._id), 'DNC voter at the mixed door survives');
  assert.strictEqual(await Voter.countDocuments({ _id: vV2._id }), 0, 'the clean inserted voter IS undone');
  assert.ok(await Household.findById(dU._id), 'fully-DNC door survives');
  assert.ok(await Household.findById(dV._id), 'the mixed door survives (still occupied by its kept voter)');

  assert.strictEqual(result.doorsDeleted, 0);
  assert.strictEqual(result.votersDeleted, 1);
  assert.strictEqual(result.doorsSkipped, 2);
  assert.strictEqual(result.votersSkipped, 2);
  assert.strictEqual(result.skipReasons['fully do-not-contact'], 1, 'the fully-DNC door records its keep reason');
});

// ── Leading zeros and the state scope (2026-09-30) ─────────────────────────────────────────────
// The lookup ignores leading zeros in both directions but runs INSIDE the declared state's
// campaigns only: a stripped Georgia 1234 and a genuine Florida 1234 are the same bytes, so the
// upload says which state it is for. Outside-state matches are reported, never flagged.

test('14. the state is required, and the 400 lists the states the picker should offer', { skip }, async () => {
  const r = await uploadCsv('/admin/dnc/preview', 'Voter ID\n97985\n', {});
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'STATE_REQUIRED');
  assert.deepStrictEqual(r.json.states, ['FL', 'GA']);
  const bad = await uploadCsv('/admin/dnc/preview', 'Voter ID\n97985\n', { state: 'TX' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.json.code, 'STATE_UNKNOWN');
  const hist = await call('GET', '/admin/dnc', { token: ctx.adminTok, orgId: ctx.org._id });
  assert.deepStrictEqual(hist.json.states, ['FL', 'GA'], 'the history payload carries the states too');
});

test('15. inside the state, a stripped ID matches the padded voter; outside-state hits are reported, not flagged', { skip }, async () => {
  // 97985 → Brian (FL, stored 00097985) by zeros. 1234 → Flo (FL, exact) AND Alice (GA, 0001234):
  // reported as outside-state, also-in-state. 55555 → Gus (GA only): not in FL, reported, parked for
  // FL like any unmatched id (the admin declared the list Floridian). 0 → no ID.
  const r = await uploadCsv('/admin/dnc/preview', 'Voter ID\n97985\n1234\n55555\n0\n');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.state, 'FL');
  assert.strictEqual(r.json.noId, 1);
  assert.strictEqual(r.json.idsInFile, 3);
  assert.strictEqual(r.json.matched, 2, 'Brian and Flo');
  assert.strictEqual(r.json.matchedViaZeros, 1);
  assert.deepStrictEqual(r.json.zeroMatchExample, { file: '97985', stored: '00097985' });
  assert.strictEqual(r.json.notFound, 1);
  assert.deepStrictEqual(r.json.notFoundIds, ['55555']);
  assert.strictEqual(r.json.idsInFile, r.json.matched + r.json.notFound);
  assert.strictEqual(r.json.outsideState.count, 2);
  const byId = Object.fromEntries(r.json.outsideState.samples.map((s) => [s.id, s]));
  assert.deepStrictEqual(byId['1234'], { id: '1234', states: ['GA'], exact: false, alsoInState: true });
  assert.deepStrictEqual(byId['55555'], { id: '55555', states: ['GA'], exact: true, alsoInState: false });
  assert.deepStrictEqual(r.json.outsideState.ids.sort(), ['1234', '55555']);

  const applied = await uploadCsv('/admin/dnc/import', 'Voter ID\n97985\n1234\n55555\n0\n');
  assert.strictEqual(applied.status, 200, JSON.stringify(applied.json));
  assert.strictEqual(applied.json.flagged, 2);
  assert.strictEqual(await Voter.countDocuments({ stateVoterId: { $in: ['00097985', '1234'] }, 'doNotContact.flagged': true }), 2);
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.campG._id, 'doNotContact.flagged': true }), 0, 'nothing outside the state was flagged');
  const upl = await DncUpload.findOne({ _id: applied.json.uploadId }).lean();
  assert.deepStrictEqual(
    { state: upl.state, outsideState: upl.outsideState, idColumn: upl.idColumn, matchedViaZeros: upl.matchedViaZeros },
    { state: 'FL', outsideState: 2, idColumn: 'Voter ID', matchedViaZeros: 1 },
    'read back from the record'
  );
  const parked = await DncPendingId.findOne({ stateVoterId: '55555' }).lean();
  assert.strictEqual(parked.state, 'FL', 'parked for the declared state');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '0' }), 0, 'an all-zero value is never parked');
});

test('16. parked IDs are cleared by canonical ID, but only for the declared state (or legacy rows without one)', { skip }, async () => {
  await DncPendingId.insertMany([
    { organizationId: ctx.org._id, uploadId: null, stateVoterId: '000123456', state: 'GA' }, // Georgia's own parking of these digits
    { organizationId: ctx.org._id, uploadId: null, stateVoterId: '0123456', state: null }, // parked before states were recorded
  ]);
  const d = await Household.create(hh(ctx.org._id, ctx.campA._id));
  await Voter.create(voter(ctx.org._id, ctx.campA._id, d._id, '123456', 'Six'));
  const r = await uploadCsv('/admin/dnc/import', 'Voter ID\n00123456\n');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.flagged, 1, 'the Floridian, matched by zeros from a padded list');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '0123456' }), 0, 'the legacy parking of the same digits is cleared');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '000123456', state: 'GA' }), 1, 'Georgia\'s parking survives an FL upload');
  await DncPendingId.deleteMany({ stateVoterId: '000123456' });
});

test('17. the sticky job stays exact but honors the declared state; spellings still do not graduate', { skip }, async () => {
  // Test 15 parked 55555 for FLORIDA. Georgia's Gus holds 55555 exactly. The org-wide job must
  // NOT flag him — that would be the wrong state's voter, the very thing the state scope forbids.
  const first = await reapplyDncLists(ctx.org._id);
  assert.strictEqual(first.flagged, 0, 'a Florida parking never graduates onto a Georgia voter');
  assert.strictEqual(await Voter.countDocuments({ campaignId: ctx.campG._id, 'doNotContact.flagged': true }), 0);
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '55555', state: 'FL' }), 1, 'still parked, still waiting for a Floridian');

  // Exact only, on purpose: a padded voter does not graduate a stripped parking.
  const r = await uploadCsv('/admin/dnc/import', 'Voter ID\n88888\n');
  assert.strictEqual(r.json.notFound, 1);
  const d = await Household.create(hh(ctx.org._id, ctx.campA._id));
  await Voter.create(voter(ctx.org._id, ctx.campA._id, d._id, '00088888', 'Eight'));
  const g = await reapplyDncLists(ctx.org._id);
  assert.strictEqual(g.flagged, 0, 'exact only: the padded voter does not graduate the stripped parking');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '88888' }), 1);
  // The recovery the help text describes: re-upload the list after the import, and it matches.
  const again = await uploadCsv('/admin/dnc/import', 'Voter ID\n88888\n');
  assert.strictEqual(again.json.flagged, 1);
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '88888' }), 0, 'and the old parking is cleared');

  // An UNSTAMPED parking (an admin flag preserved across a campaign delete, or a row parked before
  // states were recorded) graduates anywhere, as it always has — and only it is cleared.
  await DncPendingId.create({ organizationId: ctx.org._id, uploadId: null, stateVoterId: '55555', state: null, reason: 'asked at the door' });
  const legacy = await reapplyDncLists(ctx.org._id);
  assert.strictEqual(legacy.flagged, 1, 'Gus, via the unstamped parking');
  const gus = await Voter.findOne({ campaignId: ctx.campG._id, stateVoterId: '55555' }).lean();
  assert.strictEqual(gus.doNotContact.reason, 'asked at the door');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '55555', state: null }), 0, 'the unstamped parking graduated');
  assert.strictEqual(await DncPendingId.countDocuments({ stateVoterId: '55555', state: 'FL' }), 1, 'the Florida parking is untouched');
});
