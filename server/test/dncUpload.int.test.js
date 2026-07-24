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

// Real multipart upload (field name 'file'), exactly as the web console sends it.
async function uploadCsv(path, csv) {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'dnc-list.csv');
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
