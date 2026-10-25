import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import mongoose from 'mongoose';

// Report branding — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F8 and §O9's PNG note, the §K "Branding"
// bullets — against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/brand node --test test/clientReportBranding.int.test.js
//
// A valid PNG is accepted and stored as a FRESH PNG (the upload's chunk bytes never are), round-trips
// through the checker and decodes in jsPDF (the client's PDF library). JPEG, SVG, oversize files, a
// huge IHDR, an inflation bomb, a second zlib stream, a second IHDR, a bad filter byte, a misplaced
// tRNS, an IDAT after IEND, a bad CRC, a zero width and the other malformed headers are all refused.
// Admins write, leads read; the client's /share/:token/logo needs the link's access and answers 204
// when there is none; the org cascade covers the collection (orgDelete.int.test.js stubs ORG_SCOPED).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-branding';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { OrgBranding } = await import('../src/models/OrgBranding.js');
const { checkPng } = await import('../src/services/branding/png.js');
const { ORG_SCOPED } = await import('../src/services/platform/deleteOrganization.js');
const { NEW_REPORT_COLLECTIONS } = await import('../src/services/reports/clientReportIndexes.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// ── PNG building blocks: every attack file is a real PNG with one thing wrong ──────────────────────
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (type, data = Buffer.alloc(0), { badCrc = false } = {}) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((zlib.crc32(Buffer.concat([head.subarray(4), data])) ^ (badCrc ? 1 : 0)) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
};
const ihdr = (w, h, { colorType = 6, bitDepth = 8, compression = 0, filter = 0, interlace = 0 } = {}) => {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  Object.assign(b, { 8: bitDepth, 9: colorType, 10: compression, 11: filter, 12: interlace });
  return b;
};
// Scanlines with every filter type in use, so the re-encode must keep them exactly.
const rows = (w, h, bpp, filterOf = (y) => y % 5) => {
  const out = [];
  for (let y = 0; y < h; y += 1) {
    const r = Buffer.alloc(1 + w * bpp);
    r[0] = filterOf(y);
    for (let i = 1; i < r.length; i += 1) r[i] = (i * 31 + y * 17) & 255;
    out.push(r);
  }
  return Buffer.concat(out);
};
const png = (parts) => Buffer.concat([SIG, ...parts]);
const W = 40;
const H = 16;
const good = (extra = []) => png([chunk('IHDR', ihdr(W, H)), ...extra, chunk('IDAT', zlib.deflateSync(rows(W, H, 4))), chunk('IEND')]);

const upload = async (bytes, { as = ctx.admin, field = 'logo', filename = 'logo.png', type = 'image/png', extraField = false, twice = false } = {}) => {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), filename);
  if (twice) form.append(field, new Blob([bytes], { type }), 'again.png');
  if (extraField) form.append('note', 'hello');
  const res = await fetch(`${base}/api/admin/branding/logo`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${as.token}`, 'X-Org-Id': String(ctx.org._id) },
    body: form,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
};
const get = async (path, as = ctx.admin) => {
  const res = await fetch(`${base}/api${path}`, { headers: { Authorization: `Bearer ${as.token}`, 'X-Org-Id': String(ctx.org._id) } });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* bytes */ }
  return { status: res.status, buf, json, headers: res.headers };
};
const share = async (path, access) => {
  const res = await fetch(`${base}/api/share/${ctx.link.token}${path}`, { headers: access ? { 'X-Share-Token': access } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* bytes */ }
  return { status: res.status, buf, json, headers: res.headers };
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await OrgBranding.syncIndexes();
  const org = await Organization.create({ name: 'Brand Org', slug: 'brand-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, role) => {
    const u = await User.create({ firstName: first, lastName: 'B', email: `${first.toLowerCase()}@brand.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return { user: u, token: signUserToken(u) };
  };
  const camp = await Campaign.create({ organizationId: org._id, name: 'Brand', type: 'survey', state: 'FL', isActive: true });
  await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, status: 'published', publishedAt: new Date(),
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
  });
  await ReportShareLink.create({
    organizationId: org._id, campaignId: camp._id, token: 'brand-link',
    passwordHash: await bcrypt.hash('brand-link-password', 4), expiresAt: new Date(Date.now() + 86400e3), isActive: true,
  });
  Object.assign(ctx, { org, camp, link: { token: 'brand-link' }, admin: await mk('Ada', 'admin'), lead: await mk('Lea', 'lead'), canvasser: await mk('Cal', 'canvasser') });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/share/brand-link/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'brand-link-password' }) });
  ctx.access = (await res.json()).accessToken;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('no logo yet: the card says so, and the client’s /logo answers 204', { skip }, async () => {
  const card = await get('/admin/branding');
  assert.strictEqual(card.status, 200);
  assert.deepStrictEqual(card.json, { hasLogo: false, width: null, height: null, bytes: null, updatedAt: null });
  assert.strictEqual((await get('/admin/branding/logo')).status, 204);
  const pub = await share('/logo', ctx.access);
  assert.strictEqual(pub.status, 204);
  assert.strictEqual(pub.headers.get('cache-control'), 'no-store');
  assert.strictEqual((await share('/reports', ctx.access)).json.hasLogo, false);
});

test('a valid PNG is accepted and stored as a FRESH PNG: same pixels, none of the upload’s other chunks', { skip }, async () => {
  const secret = 'Comment\0Photo of Maria Gonzalez, 412 Elm St';
  const bytes = good([chunk('tEXt', Buffer.from(secret, 'latin1')), chunk('PLTE', Buffer.alloc(6))]);
  const res = await upload(bytes);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.hasLogo, true);
  assert.deepStrictEqual([res.json.width, res.json.height], [W, H]);
  const stored = await OrgBranding.findOne({ organizationId: ctx.org._id }).lean();
  const logo = Buffer.from(stored.logo.buffer ?? stored.logo);
  assert.ok(!logo.equals(bytes), 'never the uploaded bytes');
  assert.ok(!logo.includes(Buffer.from('Maria')) && !logo.includes(Buffer.from('tEXt')) && !logo.includes(Buffer.from('PLTE')), 'no chunk rode along');
  const back = await checkPng(logo);
  assert.ok(back.scanlines.equals(rows(W, H, 4)), 'the checked scanlines, exactly');
  assert.strictEqual(res.json.bytes, logo.length);

  const admin = await get('/admin/branding/logo');
  assert.strictEqual(admin.status, 200);
  assert.strictEqual(admin.headers.get('content-type'), 'image/png');
  assert.ok(admin.buf.equals(logo));
  const lead = await get('/admin/branding/logo', ctx.lead);
  assert.strictEqual(lead.status, 200, 'leads see it read-only');
  assert.strictEqual((await get('/admin/branding', ctx.lead)).json.hasLogo, true);
  ctx.logo = logo;
});

test('the client’s /logo needs the link’s access, is never cached, and the hub says there is one', { skip }, async () => {
  assert.strictEqual((await share('/logo')).status, 401);
  const pub = await share('/logo', ctx.access);
  assert.strictEqual(pub.status, 200);
  assert.strictEqual(pub.headers.get('content-type'), 'image/png');
  assert.strictEqual(pub.headers.get('cache-control'), 'no-store');
  assert.strictEqual(pub.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.ok(pub.buf.equals(ctx.logo));
  assert.strictEqual((await share('/reports', ctx.access)).json.hasLogo, true);
});

// jsPDF is the CLIENT's dependency (its PDF draws the logo); the test needs client/node_modules.
const jsPDF = (() => {
  try {
    return createRequire(new URL('../../client/package.json', import.meta.url))('jspdf').jsPDF;
  } catch {
    return null;
  }
})();

test('the re-encoded PNG decodes in jsPDF — RGBA, and RGB with a transparency colour', { skip: skip || (!jsPDF && 'client/node_modules has no jspdf (npm --prefix client install)') }, async () => {
  const rgb = png([chunk('IHDR', ihdr(20, 10, { colorType: 2 })), chunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3])), chunk('IDAT', zlib.deflateSync(rows(20, 10, 3))), chunk('IEND')]);
  const res = await upload(rgb);
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const stored = (await get('/admin/branding/logo')).buf;
  assert.ok(stored.includes(Buffer.from('tRNS')), 'colour type 2 keeps its transparency colour');
  for (const bytes of [ctx.logo, stored]) {
    const doc = new jsPDF();
    doc.addImage(new Uint8Array(bytes), 'PNG', 10, 10, 40, 16);
    const pdf = Buffer.from(doc.output('arraybuffer'));
    assert.ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 1000, 'a PDF with the image in it');
  }
});

test('anything but a clean PNG is refused — every attack file from the plan', { skip }, async () => {
  const raw = rows(W, H, 4);
  const z = zlib.deflateSync(raw);
  const cases = {
    JPEG: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
    SVG: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    'a huge IHDR': png([chunk('IHDR', ihdr(100000, 100000)), chunk('IDAT', z), chunk('IEND')]),
    'over 4 megapixels': png([chunk('IHDR', ihdr(2000, 2001)), chunk('IDAT', z), chunk('IEND')]),
    'an inflation bomb': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', zlib.deflateSync(Buffer.alloc(20_000_000))), chunk('IEND')]),
    'a second zlib stream': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', Buffer.concat([z, zlib.deflateSync(Buffer.from('<script>more</script>'))])), chunk('IEND')]),
    'too little image data': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', zlib.deflateSync(raw.subarray(0, raw.length - 1))), chunk('IEND')]),
    'a second IHDR': png([chunk('IHDR', ihdr(W, H)), chunk('IHDR', ihdr(W, H)), chunk('IDAT', z), chunk('IEND')]),
    'IHDR not first': png([chunk('tEXt', Buffer.from('a\0b')), chunk('IHDR', ihdr(W, H)), chunk('IDAT', z), chunk('IEND')]),
    'filter byte 9': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', zlib.deflateSync(rows(W, H, 4, (y) => (y === 3 ? 9 : 0)))), chunk('IEND')]),
    'tRNS on colour type 6': png([chunk('IHDR', ihdr(W, H)), chunk('tRNS', Buffer.alloc(6)), chunk('IDAT', z), chunk('IEND')]),
    'tRNS of the wrong size': png([chunk('IHDR', ihdr(W, H, { colorType: 2 })), chunk('tRNS', Buffer.alloc(2)), chunk('IDAT', zlib.deflateSync(rows(W, H, 3))), chunk('IEND')]),
    'tRNS after the image data': png([chunk('IHDR', ihdr(W, H, { colorType: 2 })), chunk('IDAT', zlib.deflateSync(rows(W, H, 3))), chunk('tRNS', Buffer.alloc(6)), chunk('IEND')]),
    'an IDAT after IEND': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', z), chunk('IEND'), chunk('IDAT', zlib.deflateSync(Buffer.from('payload')))]),
    'bytes after IEND': Buffer.concat([good(), Buffer.from('trailing')]),
    'no IEND': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', z)]),
    'split image data': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', z.subarray(0, 10)), chunk('tEXt', Buffer.from('a\0b')), chunk('IDAT', z.subarray(10)), chunk('IEND')]),
    'a bad CRC': png([chunk('IHDR', ihdr(W, H)), chunk('IDAT', z, { badCrc: true }), chunk('IEND')]),
    'zero width': png([chunk('IHDR', ihdr(0, H)), chunk('IDAT', z), chunk('IEND')]),
    'a non-zero compression byte': png([chunk('IHDR', ihdr(W, H, { compression: 1 })), chunk('IDAT', z), chunk('IEND')]),
    'a non-zero filter-method byte': png([chunk('IHDR', ihdr(W, H, { filter: 1 })), chunk('IDAT', z), chunk('IEND')]),
    interlaced: png([chunk('IHDR', ihdr(W, H, { interlace: 1 })), chunk('IDAT', z), chunk('IEND')]),
    '16-bit': png([chunk('IHDR', ihdr(W, H, { bitDepth: 16 })), chunk('IDAT', z), chunk('IEND')]),
    'a palette image': png([chunk('IHDR', ihdr(W, H, { colorType: 3 })), chunk('PLTE', Buffer.alloc(3)), chunk('IDAT', z), chunk('IEND')]),
    'an unknown critical chunk': png([chunk('IHDR', ihdr(W, H)), chunk('XXXX', Buffer.alloc(4)), chunk('IDAT', z), chunk('IEND')]),
    'a truncated chunk': good().subarray(0, 50),
  };
  const before = await get('/admin/branding/logo');
  for (const [name, bytes] of Object.entries(cases)) {
    const res = await upload(bytes);
    assert.strictEqual(res.status, 400, `${name}: ${res.status} ${JSON.stringify(res.json)}`);
    assert.ok(['LOGO_NOT_PNG', 'LOGO_INVALID'].includes(res.json.code), `${name}: ${res.json.code}`);
  }
  assert.ok((await get('/admin/branding/logo')).buf.equals(before.buf), 'a refused upload changes nothing');
});

test('the upload’s limits: too large, two files, an extra field, no file — all refused with a code', { skip }, async () => {
  const big = Buffer.concat([good(), Buffer.alloc(300 * 1024)]);
  let res = await upload(big);
  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.json.code, 'LOGO_TOO_LARGE');
  res = await upload(good(), { twice: true });
  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.json.code, 'LOGO_UPLOAD_REFUSED');
  res = await upload(good(), { extraField: true });
  assert.strictEqual(res.status, 413);
  res = await upload(good(), { field: 'image' });
  assert.strictEqual(res.status, 413, 'only the logo field');
  const empty = await fetch(`${base}/api/admin/branding/logo`, { method: 'PUT', headers: { Authorization: `Bearer ${ctx.admin.token}`, 'X-Org-Id': String(ctx.org._id) } });
  assert.strictEqual(empty.status, 400);
  assert.strictEqual((await empty.json()).code, 'LOGO_REQUIRED');
  // A file within the upload limit whose re-encode would not fit is refused too.
  const noisy = Buffer.alloc(1 + 300 * 4);
  const noise = [];
  for (let y = 0; y < 250; y += 1) {
    const r = Buffer.from(noisy);
    for (let i = 1; i < r.length; i += 1) r[i] = (Math.random() * 256) | 0;
    noise.push(r);
  }
  const loud = png([chunk('IHDR', ihdr(300, 250)), chunk('IDAT', zlib.deflateSync(Buffer.concat(noise), { level: 0 })), chunk('IEND')]);
  assert.ok(loud.length > 256 * 1024, 'the fixture is over the limit as sent');
  res = await upload(loud);
  assert.strictEqual(res.status, 413);
  assert.strictEqual(res.json.code, 'LOGO_TOO_LARGE');
});

// SEC-2 (code review round 1): the check and the re-encode ran zlib SYNCHRONOUSLY in the request, and
// a crafted 2000 × 2000 RGBA upload with low-entropy rows (one random bit per byte) held the shared
// web dyno's event loop ~3.5 s in the level-9 deflate. Now both zlib steps run on the threadpool: the
// loop's longest stall while three such uploads are checked and stored stays under 100 ms. This file
// still fits after the level-6 re-encode, so it is accepted — the hostile path, not a refusal.
test('a crafted low-entropy 2000 × 2000 upload never stalls the event loop (SEC-2)', { skip }, async () => {
  const W2 = 2000;
  const H2 = 2000;
  const row = 1 + W2 * 4;
  const scan = Buffer.alloc(H2 * row);
  // 1,500,000 deterministic random bits (sha256 counter mode), the rest zeros, filter byte 0.
  for (let i = 0, c = 0; i < 1_500_000; c += 1) {
    for (const b of crypto.createHash('sha256').update(`logo-${c}`).digest()) {
      if (i >= 1_500_000) break;
      scan[i] = b & 1;
      i += 1;
    }
  }
  for (let y = 0; y < H2; y += 1) scan[y * row] = 0;
  const idat = await promisify(zlib.deflate)(scan, { level: 9, memLevel: 9 });
  const hostile = png([chunk('IHDR', ihdr(W2, H2)), chunk('IDAT', idat), chunk('IEND')]);
  assert.ok(hostile.length <= 256 * 1024, `the fixture fits the upload limit (${hostile.length} B)`);

  let worst = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 5);
  try {
    const results = await Promise.all([upload(hostile), upload(hostile), upload(hostile)]);
    for (const res of results) assert.strictEqual(res.status, 200, JSON.stringify(res.json));
    assert.deepStrictEqual([results[0].json.width, results[0].json.height], [W2, H2]);
  } finally {
    clearInterval(timer);
  }
  assert.ok(worst < 100, `the event loop stalled ${Math.round(worst)} ms`);
  const stored = (await get('/admin/branding/logo')).buf;
  assert.ok((await checkPng(stored)).scanlines.equals(scan), 'stored as a fresh PNG of the same pixels');
});

test('admins write; leads and canvassers cannot; leads read', { skip }, async () => {
  let res = await upload(good(), { as: ctx.lead });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.code, 'FORBIDDEN_ROLE');
  const del = await fetch(`${base}/api/admin/branding/logo`, { method: 'DELETE', headers: { Authorization: `Bearer ${ctx.lead.token}`, 'X-Org-Id': String(ctx.org._id) } });
  assert.strictEqual(del.status, 403);
  assert.strictEqual((await get('/admin/branding', ctx.canvasser)).status, 403, 'not a canvasser’s page');
  res = await upload(good());
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await OrgBranding.countDocuments({ organizationId: ctx.org._id }), 1, 'one document per organization, upserted');
  const removed = await fetch(`${base}/api/admin/branding/logo`, { method: 'DELETE', headers: { Authorization: `Bearer ${ctx.admin.token}`, 'X-Org-Id': String(ctx.org._id) } });
  assert.strictEqual(removed.status, 200);
  assert.strictEqual((await removed.json()).hasLogo, false);
  assert.strictEqual((await share('/logo', ctx.access)).status, 204);
});

test('OrgBranding rides the org cascade and the boot-time index list — never the campaign cascade', { skip }, async () => {
  assert.ok(ORG_SCOPED.includes(OrgBranding));
  assert.ok(NEW_REPORT_COLLECTIONS.includes(OrgBranding));
  const idx = await OrgBranding.collection.indexes();
  assert.ok(idx.some((i) => i.unique && JSON.stringify(i.key) === JSON.stringify({ organizationId: 1 })), 'unique on organizationId');
  assert.strictEqual(OrgBranding.schema.path('campaignId'), undefined, 'no campaignId, so no campaign cascade can reach it');
});
