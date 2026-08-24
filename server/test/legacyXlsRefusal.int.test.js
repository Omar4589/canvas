import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Legacy .xls refusal, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/legacyxls_test node --test test/legacyXlsRefusal.int.test.js
// Locks the content-not-name rule end to end: a genuine Excel 97–2003 workbook is refused with
// `code: 'legacy-xls'` and the Save-As remedy, on the parse route (preview-headers), on the
// stash-and-enqueue route (/csv — where the refusal must land BEFORE any ImportJob or GridFS blob
// exists), and on the shared Voter-ID list parser (/admin/dnc/preview). The negative case matters
// just as much: delimited TEXT named `.xls` — what several state exports actually ship — still
// imports, with its commas-inside-fields and leading zeros intact.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-legacy-xls';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ImportJob } = await import('../src/models/ImportJob.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

// The 8 bytes leading every OLE2 Compound File — the container Excel 97–2003 wrote.
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const LEGACY_XLS = Buffer.concat([OLE2, Buffer.alloc(1024, 0), Buffer.from('Workbook')]);

// A vendor "xls" that is really tab-delimited text: commas inside a field, leading zeros.
const TAB_TEXT = Buffer.from(
  [
    ['State Voter ID', 'First Name', 'Last Name', 'Address', 'City', 'State', 'Zip Code', 'Mail Line'].join('\t'),
    ['FL-0001', 'Melissa', 'Vega', '11 Palm St', 'Town', 'FL', '00214', 'HOUSTON, TX 77002'].join('\t'),
    ['FL-0002', 'Andre', 'Boyd', '12 Palm St', 'Town', 'FL', '00069', 'MIAMI, FL 33101'].join('\t'),
  ].join('\n') + '\n',
  'utf8'
);

let server;
let base;
const ctx = {};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Subscription, Campaign, ImportJob]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Xls Org', slug: 'xls-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Xan', lastName: 'Admin', email: 'xa@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const campaign = await Campaign.create({ organizationId: org._id, name: 'Xls Camp', type: 'survey', state: 'FL', isActive: true });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, admin, campaign, adminTok: signUserToken(admin) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// Real multipart upload (field name 'file'), exactly as the web console sends it.
async function upload(path, buffer, filename, fields = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/octet-stream' }), filename);
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) },
    body: fd,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

test('preview-headers refuses a real .xls with a coded 400 and the Save-As remedy', { skip }, async () => {
  const r = await upload('/admin/imports/preview-headers', LEGACY_XLS, 'voters.xls');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'legacy-xls');
  assert.match(r.json.error, /old-format Excel file/);
  assert.match(r.json.error, /\.xlsx/); // the remedy, not just the diagnosis
});

test('preview-headers refuses a real .xls RENAMED .xlsx (used to be a bare FILE_ENDED 500)', { skip }, async () => {
  const r = await upload('/admin/imports/preview-headers', LEGACY_XLS, 'voters.xlsx');
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'legacy-xls');
});

test('preview-headers still reads a .xls that is really TAB-delimited text', { skip }, async () => {
  const r = await upload('/admin/imports/preview-headers', TAB_TEXT, 'fl-export.xls');
  assert.strictEqual(r.status, 200);
  // Tabs win over the commas sitting inside Mail Line — the delimiter is sniffed, not assumed.
  assert.deepStrictEqual(r.json.columns, [
    'State Voter ID', 'First Name', 'Last Name', 'Address', 'City', 'State', 'Zip Code', 'Mail Line',
  ]);
  assert.strictEqual(r.json.sample.length, 2);
  assert.strictEqual(r.json.sample[0]['Mail Line'], 'HOUSTON, TX 77002');
  assert.strictEqual(r.json.sample[0]['Zip Code'], '00214'); // text in, text out: leading zero survives
  // A file this ordinary also gets its columns auto-mapped, so the refusal isn't hiding a half-read file.
  assert.strictEqual(r.json.suggestedMapping.stateVoterId, 'State Voter ID');
});

test('POST /csv refuses a real .xls BEFORE any ImportJob or raw upload is written', { skip }, async () => {
  const before = await ImportJob.countDocuments({});
  const r = await upload('/admin/imports/csv', LEGACY_XLS, 'voters.xls', { campaignId: String(ctx.campaign._id) });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.json.code, 'legacy-xls');
  // The whole point of sniffing in the route: nothing is stashed for a worker that could only fail it.
  assert.strictEqual(await ImportJob.countDocuments({}), before);
});

test('the shared Voter-ID list parser refuses a real .xls too (do-not-contact upload)', { skip }, async () => {
  const r = await upload('/admin/dnc/preview', LEGACY_XLS, 'dnc-list.xls');
  assert.strictEqual(r.status, 400);
  assert.match(r.json.error, /old-format Excel file/);
  assert.match(r.json.error, /\.xlsx/);
});
