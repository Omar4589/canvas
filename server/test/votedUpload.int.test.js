import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Early-voting (and walk-list-from-CSV) uploads over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/voted_upload_test node --test test/votedUpload.int.test.js
// Locks the leading-zero matching in BOTH directions (a stripped list against a padded Georgia
// campaign; a padded list against an unpadded Nebraska campaign), letters never zero-matching, the
// no-ID accounting (idsInFile = matched + notFound), the column override honored by preview AND
// apply, un-mark by either spelling, parked-ID clearing by canonical ID, the sticky job graduating
// a parked stripped ID onto a padded voter, the walk-list-from-CSV route's provenance, and the
// 50 MB refusal (a 413 that says what to do) on all four upload routes.
// Uploads are real multipart bodies (Node 20 FormData/Blob) through multer.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-voted-upload';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { VotedVoter } = await import('../src/models/VotedVoter.js');
const { VotedUpload } = await import('../src/models/VotedUpload.js');
const { VotedPendingId } = await import('../src/models/VotedPendingId.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { reapplyVotedLists } = await import('../src/services/voted/reapplyVotedLists.js');
const { ID_LIST_MAX_BYTES, ID_LIST_TOO_LARGE } = await import('../src/middleware/idListUpload.js');
const { workbook, sheetXml, is, num, row } = await import('./support/xlsxBuild.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

let doorNo = 0;
function hh(orgId, campaignId, state) {
  doorNo += 1;
  return {
    organizationId: orgId,
    campaignId,
    addressLine1: `${doorNo} Zero Ave`,
    city: 'Town',
    state,
    zipCode: '30342',
    normalizedAddress: `${doorNo} ZERO AVE||TOWN|${state}|30342`,
    location: { type: 'Point', coordinates: [-84.4 + doorNo * 0.001, 33.8] },
    isActive: true,
    status: 'unknocked',
  };
}
const voter = (orgId, campaignId, householdId, svid, first) => ({
  organizationId: orgId,
  campaignId,
  householdId,
  stateVoterId: svid,
  firstName: first,
  lastName: 'Voter',
  fullName: `${first} Voter`,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, Household, Voter, VotedVoter, VotedUpload, VotedPendingId, SavedSearch]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Zero Org', slug: 'zero-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Zed', lastName: 'Admin', email: 'zed@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });

  // Georgia: 8-digit IDs padded with zeros (the production L2 shape). Nebraska: plain numbers.
  const ga = await Campaign.create({ organizationId: org._id, name: 'GA Padded', type: 'survey', state: 'GA', isActive: true });
  const ne = await Campaign.create({ organizationId: org._id, name: 'NE Unpadded', type: 'survey', state: 'NE', isActive: true });
  const [dMartin, dNancy, dAle, dBrian, dWalk] = await Household.insertMany([hh(org._id, ga._id, 'GA'), hh(org._id, ga._id, 'GA'), hh(org._id, ga._id, 'GA'), hh(org._id, ga._id, 'GA'), hh(org._id, ga._id, 'GA')]);
  const [dBob, dBig] = await Household.insertMany([hh(org._id, ne._id, 'NE'), hh(org._id, ne._id, 'NE')]);
  await Voter.insertMany([
    voter(org._id, ga._id, dMartin._id, '08719967', 'Martin'),
    voter(org._id, ga._id, dNancy._id, '05187273', 'Nancy'),
    voter(org._id, ga._id, dAle._id, '12453551', 'Alejandro'),
    voter(org._id, ga._id, dBrian._id, '00097985', 'Brian'),
    voter(org._id, ga._id, dWalk._id, 'manual:66f1a2b3c4d5e6f7a8b9c0d1', 'Walkup'),
    voter(org._id, ne._id, dBob._id, '1234567', 'Bob'),
    voter(org._id, ne._id, dBig._id, '234567', 'Big'),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, ga, ne, dMartin, tok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

async function upload(path, csv, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'list.csv');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
async function post(path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const voted = (p) => `/admin/campaigns/${ctx.ga._id}/voted${p}`;

test('a stripped list matches a padded campaign; the no-ID and not-found accounting adds up', { skip }, async () => {
  const r = await upload(voted('/preview'), 'Voter ID\n8719967\n5187273\n12453551\n97985\n99999999\n0\n');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  const j = r.json;
  assert.strictEqual(j.idColumn, 'Voter ID');
  assert.deepStrictEqual(j.sampleIds, ['8719967', '5187273', '12453551']);
  assert.strictEqual(j.spellings, 6, 'six distinct raw values, including the all-zero one');
  assert.strictEqual(j.noId, 1, '0 carries no ID');
  assert.strictEqual(j.idsInFile, 5);
  assert.strictEqual(j.matched, 4, 'three padded voters found by zeros, one exact');
  assert.strictEqual(j.matchedViaZeros, 3);
  assert.deepStrictEqual(j.zeroMatchExample, { file: '8719967', stored: '08719967' });
  assert.strictEqual(j.willMark, 4);
  assert.strictEqual(j.notFound, 1);
  assert.deepStrictEqual(j.notFoundIds, ['99999999'], 'kept in the file\'s own spelling');
  assert.strictEqual(j.idsInFile, j.matched + j.notFound, 'the preview\'s numbers reconcile');
  assert.strictEqual(await VotedUpload.countDocuments({}), 0, 'a preview writes nothing');
});

test('a padded list matches an unpadded campaign (the Nebraska direction)', { skip }, async () => {
  const r = await upload(`/admin/campaigns/${ctx.ne._id}/voted/preview`, 'Voter ID\n0001234567\n00234567\n');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.matched, 2);
  assert.strictEqual(r.json.matchedViaZeros, 2);
  assert.deepStrictEqual(r.json.zeroMatchExample, { file: '0001234567', stored: '1234567' });
  assert.strictEqual(r.json.notFound, 0);
});

test('an ID with letters is only ever itself; both spellings of one ID in a file count once', { skip }, async () => {
  const r = await upload(voted('/preview'), 'Voter ID\nmanual:66f1a2b3c4d5e6f7a8b9c0d1\n0manual:66f1a2b3c4d5e6f7a8b9c0d1\n8719967\n08719967\n');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.spellings, 4);
  assert.strictEqual(r.json.idsInFile, 3, 'the two spellings of 8719967 are one ID');
  assert.strictEqual(r.json.matched, 2, 'the manual id exactly, Martin once');
  assert.strictEqual(r.json.matchedViaZeros, 0, 'the file also carried the stored spelling, so no zero match');
  assert.deepStrictEqual(r.json.notFoundIds, ['0manual:66f1a2b3c4d5e6f7a8b9c0d1']);
});

test('the column override is honored by the preview and by the apply', { skip }, async () => {
  const csv = 'LALVOTERID,Voters_StateVoterID\nLALGA399157167,08719967\n';
  const auto = await upload(voted('/preview'), csv);
  assert.strictEqual(auto.status, 200);
  assert.strictEqual(auto.json.idColumn, 'Voters_StateVoterID', 'the suggester picks the state\'s number');
  assert.strictEqual(auto.json.matched, 1);

  const over = await upload(voted('/preview'), csv, { idColumn: 'LALVOTERID' });
  assert.strictEqual(over.json.idColumn, 'LALVOTERID');
  assert.strictEqual(over.json.matched, 0);
  assert.deepStrictEqual(over.json.notFoundIds, ['LALGA399157167']);

  const applied = await upload(voted('/import'), csv, { idColumn: 'LALVOTERID' });
  assert.strictEqual(applied.status, 200);
  assert.strictEqual(applied.json.marked, 0, 'apply matched on the overridden column, not the detected one');
  const doc = await VotedUpload.findOne({ campaignId: ctx.ga._id }).sort({ createdAt: -1 }).lean();
  assert.strictEqual(doc.idColumn, 'LALVOTERID');
  assert.strictEqual(await VotedPendingId.countDocuments({ campaignId: ctx.ga._id, stateVoterId: 'LALGA399157167' }), 1, 'parked under the file\'s spelling');
  // Leave no parked rows behind for the tests below.
  await VotedPendingId.deleteMany({});
  await VotedUpload.deleteMany({});
});

test('apply marks by zeros, records the column and the count, and un-mark accepts either spelling', { skip }, async () => {
  const r = await upload(voted('/import'), 'Voter ID\n8719967\n99999999\n');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(r.json.matchedViaZeros, 1);
  assert.strictEqual(r.json.notFound, 1);
  const upl = await VotedUpload.findOne({ _id: r.json.uploadId }).lean();
  assert.strictEqual(upl.idColumn, 'Voter ID');
  assert.strictEqual(upl.matchedViaZeros, 1, 'read back from the record, not the response');
  const mark = await VotedVoter.findOne({ campaignId: ctx.ga._id }).lean();
  assert.strictEqual(mark.stateVoterId, '08719967', 'the mark carries the STORED spelling');
  assert.strictEqual(await Household.countDocuments({ _id: ctx.dMartin._id, fullyVoted: true }), 1, 'Martin lives alone: the door dropped');

  // Un-mark typed without the zero.
  const un = await post(voted('/unmark'), { stateVoterId: '8719967' });
  assert.strictEqual(un.status, 200, JSON.stringify(un.json));
  assert.deepStrictEqual({ removed: un.json.removed, reopened: un.json.reopened }, { removed: 1, reopened: true });
  assert.strictEqual(await VotedVoter.countDocuments({ campaignId: ctx.ga._id }), 0);

  // Mark again, un-mark typed with the zero.
  await upload(voted('/import'), 'Voter ID\n08719967\n');
  const un2 = await post(voted('/unmark'), { stateVoterId: '08719967' });
  assert.strictEqual(un2.status, 200);
  assert.strictEqual(un2.json.removed, 1);
  const missing = await post(voted('/unmark'), { stateVoterId: '42' });
  assert.strictEqual(missing.status, 404);
});

test('a parked stripped ID graduates when the padded voter is imported later (the sticky job)', { skip }, async () => {
  const r = await upload(voted('/import'), 'Voter ID\n55555\n');
  assert.strictEqual(r.json.notFound, 1);
  assert.strictEqual(await VotedPendingId.countDocuments({ campaignId: ctx.ga._id, stateVoterId: '55555' }), 1);

  // Nothing to graduate yet.
  assert.strictEqual((await reapplyVotedLists(ctx.ga._id)).marked, 0);

  // The padded voter arrives (what a Georgia import writes).
  const d = await Household.create(hh(ctx.org._id, ctx.ga._id, 'GA'));
  await Voter.create(voter(ctx.org._id, ctx.ga._id, d._id, '00055555', 'Late'));
  const g = await reapplyVotedLists(ctx.ga._id);
  assert.strictEqual(g.marked, 1);
  const mark = await VotedVoter.findOne({ campaignId: ctx.ga._id, stateVoterId: '00055555' }).lean();
  assert.ok(mark, 'marked under the stored spelling');
  assert.strictEqual(String(mark.uploadId), String(r.json.uploadId), 'attributed to the upload that parked it');
  assert.strictEqual(await VotedPendingId.countDocuments({ campaignId: ctx.ga._id, stateVoterId: '55555' }), 0, 'the parked row is cleared, whatever spelling it used');
  const upl = await VotedUpload.findOne({ _id: r.json.uploadId }).lean();
  assert.strictEqual(upl.matched, 1, 'the upload\'s count was kept honest');
});

test('applying a list clears earlier parkings of the same IDs under another spelling', { skip }, async () => {
  await upload(voted('/import'), 'Voter ID\n77777\n'); // parked, stripped
  const d = await Household.create(hh(ctx.org._id, ctx.ga._id, 'GA'));
  await Voter.create(voter(ctx.org._id, ctx.ga._id, d._id, '00077777', 'Later'));
  const r = await upload(voted('/import'), 'Voter ID\n00077777\n'); // matched exactly now
  assert.strictEqual(r.json.marked, 1);
  assert.strictEqual(await VotedPendingId.countDocuments({ campaignId: ctx.ga._id, stateVoterId: '77777' }), 0);
});

test('walk list from CSV matches by zeros and records the count in the saved search', { skip }, async () => {
  const wl = (p) => `/admin/campaigns/${ctx.ga._id}/walklists${p}`;
  const pv = await upload(wl('/from-csv/preview'), 'Voter ID\n5187273\n');
  assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
  assert.strictEqual(pv.json.matched, 1);
  assert.strictEqual(pv.json.matchedViaZeros, 1);
  assert.strictEqual(pv.json.householdCount, 1);
  const saved = await upload(wl('/from-csv'), 'Voter ID\n5187273\n', { name: 'Nancy only' });
  assert.strictEqual(saved.status, 201, JSON.stringify(saved.json));
  const doc = await SavedSearch.findOne({ campaignId: ctx.ga._id, name: 'Nancy only' }).lean();
  assert.strictEqual(doc.sourceMeta.matchedViaZeros, 1, 'declared on the strict sub-schema, so it survives the save');
  assert.strictEqual(doc.householdCount, 1);
});

test('a file that reaches 50 MB is refused on all four upload routes, says what to do, and writes nothing', { skip }, async () => {
  const wl = (p) => `/admin/campaigns/${ctx.ga._id}/walklists${p}`;
  const big = Buffer.alloc(ID_LIST_MAX_BYTES, 'a');
  const uploads = await VotedUpload.countDocuments();
  const searches = await SavedSearch.countDocuments();
  for (const [path, fields] of [[voted('/preview')], [voted('/import')], [wl('/from-csv/preview')], [wl('/from-csv'), { name: 'Too big' }]]) {
    const r = await upload(path, big, fields);
    assert.strictEqual(r.status, 413, path);
    assert.deepStrictEqual(r.json, { error: ID_LIST_TOO_LARGE, code: 'file-too-large' }, path);
  }
  assert.strictEqual(await VotedUpload.countDocuments(), uploads);
  assert.strictEqual(await SavedSearch.countDocuments(), searches);
});

// ── Excel (.xlsx) lists — docs/PROPOSAL_ID_LIST_EXCEL.md ─────────────────────────────────────────────
// Their own Nebraska-shaped campaign, so the marks above and below never meet.
async function uploadXlsx(path, buf, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'returns.xlsx');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const RETURNS = [
  ['Registrant_ID', 'Ballot_Status'],
  [2235089, 'ACCE'],
  [2215451, 'REJE'],
  [334675, 'ACCE'],
  [9999999, 'ACCE'],
];
const returnsXlsx = (rows = RETURNS, { tabs = [], hidden = [] } = {}) =>
  workbook({
    sheets: [
      {
        name: 'CD-2 Records',
        xml: sheetXml(
          rows
            .map((cells, r) =>
              row(
                r + 1,
                cells.map((v, i) => (typeof v === 'number' ? num(`${'AB'[i]}${r + 1}`, v) : is(`${'AB'[i]}${r + 1}`, v))),
                hidden.includes(r + 1) ? 'hidden="1"' : ''
              )
            )
            .join('')
        ),
      },
      ...tabs.map((name) => ({ name, xml: sheetXml('') })),
    ],
  });
let neX;
const vx = (p) => `/admin/campaigns/${neX._id}/voted${p}`;
const seedNebraska = async () => {
  if (neX) return;
  neX = await Campaign.create({ organizationId: ctx.org._id, name: 'NE Excel', type: 'survey', state: 'NE', isActive: true });
  const doors = await Household.insertMany([hh(ctx.org._id, neX._id, 'NE'), hh(ctx.org._id, neX._id, 'NE'), hh(ctx.org._id, neX._id, 'NE')]);
  await Voter.insertMany([
    voter(ctx.org._id, neX._id, doors[0]._id, '2235089', 'Jer'),
    voter(ctx.org._id, neX._id, doors[1]._id, '2215451', 'Kar'),
    voter(ctx.org._id, neX._id, doors[2]._id, '334675', 'Kei'),
  ]);
};

test('an Excel list previews and applies like its CSV twin, matched on Registrant_ID; Undo reverts it', { skip }, async () => {
  await seedNebraska();
  const pv = await uploadXlsx(vx('/preview'), await returnsXlsx(RETURNS, { tabs: ['Summary', 'README'] }));
  assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
  const twin = await upload(vx('/preview'), RETURNS.map((r) => r.join(',')).join('\n') + '\n');
  for (const k of ['idColumn', 'columns', 'totalRows', 'idsInFile', 'matched', 'willMark', 'notFound', 'doorsWillDrop', 'sampleIds']) {
    assert.deepStrictEqual(pv.json[k], twin.json[k], k);
  }
  assert.strictEqual(pv.json.idColumn, 'Registrant_ID');
  assert.strictEqual(pv.json.matched, 3);
  assert.strictEqual(pv.json.sheetName, 'CD-2 Records');
  assert.deepStrictEqual(pv.json.otherSheets, ['Summary', 'README']);
  assert.strictEqual(twin.json.sheetName, null);

  const ap = await uploadXlsx(vx('/import'), await returnsXlsx(), { idColumn: pv.json.idColumn });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  assert.strictEqual(ap.json.marked, 3);
  const upl = await VotedUpload.findOne({ _id: ap.json.uploadId }).lean();
  assert.strictEqual(upl.fileName, 'returns.xlsx');
  assert.strictEqual(upl.keepColumn, null, 'nothing was left out');
  const undo = await post(vx('/undo'), { uploadId: ap.json.uploadId });
  assert.strictEqual(undo.status, 200, JSON.stringify(undo.json));
  assert.strictEqual(await VotedVoter.countDocuments({ campaignId: neX._id }), 0);
  // Its CSV twin applies to the same marks.
  const apCsv = await upload(vx('/import'), RETURNS.map((r) => r.join(',')).join('\n') + '\n');
  for (const k of ['marked', 'notFound', 'doorsDropped', 'matched', 'totalRows']) assert.strictEqual(apCsv.json[k], ap.json[k], k);
  await post(vx('/undo'), { uploadId: apCsv.json.uploadId });
  await VotedPendingId.deleteMany({ campaignId: neX._id });
});

test('Count only rows where: values before filtering; apply marks and parks only the kept rows; the record keeps the column and the count, never the values', { skip }, async () => {
  await seedNebraska();
  const listed = await uploadXlsx(vx('/preview'), await returnsXlsx(), { keepColumn: 'Ballot_Status' });
  assert.strictEqual(listed.status, 200, JSON.stringify(listed.json));
  assert.deepStrictEqual(listed.json.keep.values, [
    { value: 'ACCE', rows: 3 },
    { value: 'REJE', rows: 1 },
  ]);
  assert.deepStrictEqual(listed.json.keep.selected, ['ACCE', 'REJE']);
  assert.strictEqual(listed.json.willMark, 3);

  const fields = { idColumn: 'Registrant_ID', keepColumn: 'Ballot_Status', keepSelected: JSON.stringify(['ACCE']) };
  const counted = await uploadXlsx(vx('/preview'), await returnsXlsx(), fields);
  assert.strictEqual(counted.json.willMark, 2, 'the REJE ballot is left out');
  assert.strictEqual(counted.json.keptRows, 3);
  assert.strictEqual(counted.json.totalRows, 4);
  assert.strictEqual(counted.json.notFound, 1);
  assert.strictEqual(counted.json.keep.values.length, 2, 'the unticked value stays listed');

  const ap = await uploadXlsx(vx('/import'), await returnsXlsx(), fields);
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.json));
  assert.strictEqual(ap.json.marked, 2);
  assert.strictEqual(ap.json.keptRows, 3);
  const marked = (await VotedVoter.find({ campaignId: neX._id }).lean()).map((m) => m.stateVoterId).sort();
  assert.deepStrictEqual(marked, ['2235089', '334675']);
  const parked = (await VotedPendingId.find({ campaignId: neX._id }).lean()).map((p) => p.stateVoterId);
  assert.deepStrictEqual(parked, ['9999999'], 'only a kept row is remembered');
  const upl = await VotedUpload.findOne({ _id: ap.json.uploadId }).lean();
  assert.strictEqual(upl.keepColumn, 'Ballot_Status');
  assert.strictEqual(upl.keptRows, 3);
  assert.ok(!JSON.stringify(upl).includes('ACCE'), 'the ticked values are not stored');
  const hist = await fetch(`${base}/api${vx('')}`, { headers: { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) } }).then((r) => r.json());
  assert.strictEqual(hist.uploads[0].keepColumn, 'Ballot_Status');

  const bad = await uploadXlsx(vx('/preview'), await returnsXlsx(), { keepColumn: 'Ballot_Status', keepSelected: 'ACCE' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.json.code, 'keep-selected');
  const missing = await uploadXlsx(vx('/preview'), await returnsXlsx(), { keepColumn: 'Nope' });
  assert.strictEqual(missing.status, 400);
  assert.strictEqual(missing.json.code, 'keep-column');
  await post(vx('/undo'), { uploadId: ap.json.uploadId });
});

test('a malformed Count only rows where request is refused, never read as count every row', { skip }, async () => {
  await seedNebraska();
  const before = await VotedUpload.countDocuments();
  const fd = new FormData();
  fd.append('file', new Blob([await returnsXlsx()]), 'returns.xlsx');
  fd.append('keepColumn', 'Ballot_Status');
  fd.append('keepColumn', 'Ballot_Status'); // twice: multer hands the route an array
  fd.append('keepSelected', JSON.stringify(['ACCE']));
  const twice = await fetch(`${base}/api${vx('/import')}`, { method: 'POST', headers: { Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) }, body: fd });
  assert.strictEqual(twice.status, 400);
  assert.strictEqual((await twice.json()).code, 'keep-selected');
  const orphan = await uploadXlsx(vx('/import'), await returnsXlsx(), { keepSelected: JSON.stringify(['ACCE']) });
  assert.strictEqual(orphan.status, 400, 'values with no column');
  assert.strictEqual(orphan.json.code, 'keep-selected');
  assert.strictEqual(await VotedUpload.countDocuments(), before, 'nothing marked');
});

test('refusals come back coded with no columns; the could-not-detect 400 carries the tab and the title-row line', { skip }, async () => {
  await seedNebraska();
  const before = await VotedUpload.countDocuments();
  const hidden = await uploadXlsx(vx('/import'), await returnsXlsx(RETURNS, { hidden: [3], tabs: ['Summary'] }));
  assert.strictEqual(hidden.status, 400);
  assert.strictEqual(hidden.json.code, 'hidden-rows');
  assert.deepStrictEqual(hidden.json.columns, [], 'never the column list: the page would show the picker instead');
  assert.strictEqual(hidden.json.sheetName, 'CD-2 Records');
  assert.deepStrictEqual(hidden.json.otherSheets, ['Summary']);
  assert.match(hidden.json.error, /^1 row on the CD-2 Records tab is hidden/);
  assert.strictEqual(await VotedUpload.countDocuments(), before, 'nothing written');

  const damaged = await uploadXlsx(vx('/preview'), Buffer.from('PK\x03\x04 not a workbook'));
  assert.strictEqual(damaged.json.code, 'damaged');
  const legacy = await uploadXlsx(vx('/preview'), Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]));
  assert.strictEqual(legacy.json.code, 'legacy-xls');

  const titled = await uploadXlsx(vx('/preview'), await returnsXlsx([['Douglas County Returns'], ['SOSID', 'Voter ID'], [5, 6]], { tabs: ['Summary'] }));
  assert.strictEqual(titled.status, 400);
  assert.strictEqual(titled.json.code, null);
  assert.deepStrictEqual(titled.json.columns, ['Douglas County Returns']);
  assert.strictEqual(titled.json.headerRowHint, 2);
  assert.strictEqual(titled.json.sheetName, 'CD-2 Records');
});

test('a saved search from an Excel list; its refusals carry a code too', { skip }, async () => {
  await seedNebraska();
  const wl = (p) => `/admin/campaigns/${neX._id}/walklists${p}`;
  const pv = await uploadXlsx(wl('/from-csv/preview'), await returnsXlsx());
  assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
  assert.strictEqual(pv.json.idColumn, 'Registrant_ID');
  assert.strictEqual(pv.json.matched, 3);
  assert.strictEqual(pv.json.sheetName, 'CD-2 Records');
  const saved = await uploadXlsx(wl('/from-csv'), await returnsXlsx(), { name: 'From Excel', idColumn: pv.json.idColumn });
  assert.strictEqual(saved.status, 201, JSON.stringify(saved.json));
  const doc = await SavedSearch.findOne({ campaignId: neX._id, name: 'From Excel' }).lean();
  assert.strictEqual(doc.source, 'csv');
  assert.strictEqual(doc.sourceMeta.fileName, 'returns.xlsx');
  assert.strictEqual(doc.householdCount, 3);
  const hidden = await uploadXlsx(wl('/from-csv/preview'), await returnsXlsx(RETURNS, { hidden: [2] }));
  assert.strictEqual(hidden.status, 400);
  assert.strictEqual(hidden.json.code, 'hidden-rows');
  assert.deepStrictEqual(hidden.json.columns, []);
});
