import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// Client links, hardened — docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 as overridden by §O7, the §K
// "Links" bullets, and the verified defects B4, B5 and B7 asserting their fix — against the real app
// and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/links node --test test/shareLinks.int.test.js
//
// Raw-inserted legacy links (none of the new fields, and explicit nulls including the old
// `failedUnlocks: null`) go through unlock, the panel and Extend; 300 concurrent wrong guesses meet
// exactly 50 bcrypt compares; cv moves 0 → 1 → 2; the lock lasts 24 hours, survives no Unlock now that
// lands mid-compare, and never ends a remembered session; the one-year life caps Extend, which never
// shortens; Renew changes the URL; every 404 carries a code; History rows hold no secret; the sign-in
// token names its link by an opaque key, no id, and one issued before that keeps working until it
// expires (PRIV-2).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-share-links';
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { runClientReportVisibility } = await import('../src/migrations/clientReportVisibility.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const DAY = 24 * 60 * 60 * 1000;

let server;
let base;
const ctx = {};

// Every bcrypt compare the unlock route makes, counted — and, when a test sets `gate`, held until the
// test releases it, so it can act while a guess is mid-compare.
const realCompare = bcrypt.compare;
let compares = 0;
let gate = null;
const holdCompares = (when) => {
  let enter;
  let release;
  const entered = new Promise((r) => { enter = r; });
  const released = new Promise((r) => { release = r; });
  gate = { when, enter, released };
  return { entered, release: () => { gate = null; release(); } };
};

let ipN = 0;
const freshIp = () => {
  ipN += 1;
  return `10.${(ipN >> 16) & 255}.${(ipN >> 8) & 255}.${ipN & 255}`;
};

async function call(method, path, { token, orgId, body, headers = {} } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'X-Org-Id': String(orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { /* empty or not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const admin = (method, path, body) => call(method, `/admin/client-reports/shares${path}`, { ...ctx.admin, body });
// A guess from its own address unless told otherwise: the per-IP limiter (10 failures per 15 minutes
// per address and link) stays in front of the per-link budget, and is not what these tests measure.
const unlock = (token, password, { remember, ip = freshIp() } = {}) =>
  call('POST', `/share/${token}/unlock`, {
    headers: { 'X-Forwarded-For': ip },
    body: { ...(password !== undefined ? { password } : {}), ...(remember !== undefined ? { remember } : {}) },
  });
const pub = (path, access) => call('GET', `/share${path}`, { headers: access ? { 'X-Share-Token': access } : {} });
const rowOf = async (id) => (await admin('GET', `?campaignId=${ctx.camp._id}`)).json.shares.find((s) => s.id === String(id));
const linkRows = (id) => CampaignChange.find({ shareLinkId: id }).sort({ createdAt: 1, _id: 1 }).lean();
const near = (a, b, ms = 60 * 1000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < ms;

// A link the way the new code makes it, with a known password (bcrypt cost 4 keeps the suite fast).
const makeLink = async (password = 'correct-horse-battery', extra = {}) => {
  const res = await admin('POST', '', { campaignId: String(ctx.camp._id), label: extra.label || 'Candidate', password, ...(extra.expiresInDays ? { expiresInDays: extra.expiresInDays } : {}) });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  await ReportShareLink.updateOne({ _id: res.json.share.id }, { $set: { passwordHash: await bcrypt.hash(password, 4) } });
  return { ...res.json.share, password };
};
// A link inserted RAW, as one from before this change looks: none of the new fields.
const rawLink = async (doc) => {
  const now = new Date();
  const { insertedId } = await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    label: 'Old link',
    isActive: true,
    lastAccessedAt: null,
    createdAt: now,
    updatedAt: now,
    ...doc,
  });
  return ReportShareLink.findById(insertedId).lean();
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true); // as production's connectDb: an undeclared filter key is stripped
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  bcrypt.compare = async (password, hash) => {
    compares += 1;
    if (gate && gate.when(password)) {
      gate.enter();
      await gate.released;
    }
    return realCompare.call(bcrypt, password, hash);
  };

  const org = await Organization.create({ name: 'Acme Links', slug: 'acme-links', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const mk = async (first, role) => {
    const u = await User.create({ firstName: first, lastName: 'T', email: `${first.toLowerCase()}@links.t.co`, passwordHash: await User.hashPassword('Str0ng!Passw0rd'), isActive: true });
    await Membership.create({ userId: u._id, organizationId: org._id, role, isActive: true });
    return u;
  };
  const adminUser = await mk('Ada', 'admin');
  const leadUser = await mk('Lea', 'lead');
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall Links', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const other = await Campaign.create({ organizationId: org._id, name: 'Not Hers', type: 'survey', state: 'FL', isActive: true });
  await CampaignManager.create({ campaignId: camp._id, userId: leadUser._id, organizationId: org._id, grantedBy: adminUser._id });
  // One published report, so the hub has something to show behind a password.
  const report = await ClientReport.create({
    organizationId: org._id, campaignId: camp._id, title: 'Week 1', status: 'published', publishedAt: new Date('2026-07-14T12:00:00Z'),
    weekStart: '2026-07-06', weekEnd: '2026-07-12', timeZone: 'America/Chicago',
    rangeStartUtc: new Date('2026-07-06T05:00:00Z'), rangeEndUtc: new Date('2026-07-13T05:00:00Z'),
    visibility: { visibleQuestionKeys: [], mapAnswerKeys: [], showMap: false },
    stats: { cumulative: { totals: { doorsKnocked: 3 } }, period: { totals: { doorsKnocked: 3 } } },
  });
  Object.assign(ctx, {
    org, camp, other, report, adminUser,
    admin: { token: signUserToken(adminUser), orgId: org._id },
    lead: { token: signUserToken(leadUser), orgId: org._id },
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  bcrypt.compare = realCompare;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('B4 fixed: a password needs 12 or more characters, on create and on change', { skip }, async () => {
  for (const password of ['a', 'short', 'x'.repeat(11), '']) {
    const res = await admin('POST', '', { campaignId: String(ctx.camp._id), password });
    assert.strictEqual(res.status, 400, `"${password}" refused`);
    assert.strictEqual(res.json.code, 'SHARE_PASSWORD_TOO_SHORT');
  }
  const made = await admin('POST', '', { campaignId: String(ctx.camp._id), label: 'Twelve', password: 'twelve-chars' });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  const s = made.json.share;
  assert.strictEqual(made.json.generatedPassword, undefined, 'nothing generated when the operator set one');
  assert.strictEqual(s.passwordMeetsRule, true);
  assert.strictEqual(s.hasPassword, true);
  assert.ok(near(s.expiresAt, Date.now() + 90 * DAY), 'the default life is 90 days');
  assert.ok(near(s.lifetimeEndsAt, Date.now() + 365 * DAY), 'within a one-year life');
  assert.deepStrictEqual([s.isLegacyOpen, s.noPassword, s.neverExpires, s.isActive], [false, false, false, true]);
  assert.deepStrictEqual(s.lock, { locked: false, until: null });
  assert.deepStrictEqual(s.failures, { last24h: 0, since: null, last7d: 0, total: 0 });
  assert.strictEqual(s.rotateAdvice, false);

  for (const password of ['a', 'x'.repeat(11)]) {
    const res = await admin('PATCH', `/${s.id}`, { password });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.json.code, 'SHARE_PASSWORD_TOO_SHORT');
  }
  for (const password of [null, '']) {
    const res = await admin('PATCH', `/${s.id}`, { password });
    assert.strictEqual(res.json.code, 'SHARE_PASSWORD_REQUIRED', 'removal stays refused');
  }

  // A generated password is 12 characters and works.
  const gen = await admin('POST', '', { campaignId: String(ctx.camp._id), label: 'Generated', expiresInDays: 30 });
  assert.strictEqual(gen.status, 201);
  assert.strictEqual(gen.json.generatedPassword.length, 12);
  assert.ok(near(gen.json.share.expiresAt, Date.now() + 30 * DAY), 'the picker’s 30 days');
  assert.strictEqual((await unlock(gen.json.share.token, gen.json.generatedPassword)).status, 200);
  assert.strictEqual((await admin('POST', '', { campaignId: String(ctx.camp._id), expiresInDays: 400 })).status, 400, 'never past a year');
});

test('B7 fixed: before the password a link says only that it needs one; "Last opened" means access was granted', { skip }, async () => {
  const link = await makeLink('a-good-long-password', { label: 'Internal — do not forward' });
  const meta = await pub(`/${link.token}`);
  assert.strictEqual(meta.status, 200);
  assert.deepStrictEqual(meta.json, { requiresPassword: true }, 'no campaign, no organization, no label');
  assert.strictEqual(meta.headers.get('cache-control'), 'no-store');
  assert.strictEqual(meta.headers.get('x-robots-tag'), 'noindex, nofollow');

  const wrong = await unlock(link.token, 'not-the-password');
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.json.code, 'SHARE_PASSWORD_WRONG');
  assert.strictEqual((await ReportShareLink.findById(link.id).lean()).lastAccessedAt, null, 'neither the meta nor a wrong guess is an open');

  const ok = await unlock(link.token, link.password);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.headers.get('cache-control'), 'no-store');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok((await ReportShareLink.findById(link.id).lean()).lastAccessedAt, 'stamped once the password was accepted');

  const hub = await pub(`/${link.token}/reports`, ok.json.accessToken);
  assert.strictEqual(hub.status, 200, JSON.stringify(hub.json));
  assert.strictEqual(hub.json.campaignName, 'Fall Links', 'the names ride behind the password');
  assert.strictEqual(hub.json.orgName, 'Acme Links');
  assert.strictEqual(hub.json.hasLogo, false);
  assert.ok(!JSON.stringify(hub.json).includes('do not forward'), 'the label is never sent');
  assert.strictEqual(hub.headers.get('cache-control'), 'no-store');
  ctx.link = link;
  ctx.access = ok.json.accessToken;
});

test('every share 404 carries a code; an expired link is 410; /logo with no logo is 204', { skip }, async () => {
  for (const p of ['/nope', '/nope/reports', '/nope/logo', `/nope/reports/${ctx.report._id}`]) {
    const res = await pub(p);
    assert.strictEqual(res.status, 404, p);
    assert.strictEqual(res.json.code, 'SHARE_NOT_FOUND', p);
  }
  assert.strictEqual((await unlock('nope', 'whatever-password')).json.code, 'SHARE_NOT_FOUND');
  const gone = await pub(`/${ctx.link.token}/reports/${new mongoose.Types.ObjectId()}`, ctx.access);
  assert.strictEqual(gone.status, 404);
  assert.strictEqual(gone.json.code, 'REPORT_NOT_FOUND');
  const map = await pub(`/${ctx.link.token}/reports/${ctx.report._id}/map`, ctx.access);
  assert.strictEqual(map.status, 404);
  assert.strictEqual(map.json.code, 'MAP_NOT_SHARED');
  const stray = await pub(`/${ctx.link.token}/no-such-thing`, ctx.access);
  assert.strictEqual(stray.status, 404);
  assert.ok(stray.json.code, 'even an unknown path under /share is coded');
  assert.strictEqual(stray.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.strictEqual((await pub(`/${ctx.link.token}/reports/not-an-id`, ctx.access)).json.code, 'INVALID_ID');

  const logo = await pub(`/${ctx.link.token}/logo`, ctx.access);
  assert.strictEqual(logo.status, 204);
  assert.strictEqual(logo.headers.get('cache-control'), 'no-store');
  assert.strictEqual((await pub(`/${ctx.link.token}/logo`)).status, 401, 'the logo needs access like the reports');

  const expired = await makeLink('expired-link-password');
  await ReportShareLink.updateOne({ _id: expired.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  for (const res of [await pub(`/${expired.token}`), await unlock(expired.token, expired.password)]) {
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.json.code, 'SHARE_EXPIRED');
  }
});

test('B5 fixed: cv 0 → 1 → 2 — a password change and a rotate sign every device out; a fresh unlock works at each', { skip }, async () => {
  const link = await rawLink({ token: 'cv-legacy-token', passwordHash: await bcrypt.hash('legacy-password-1', 4), expiresAt: new Date(Date.now() + 30 * DAY) });
  const first = await unlock('cv-legacy-token', 'legacy-password-1');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(jwt.decode(first.json.accessToken).cv, 0, 'a link from before the field signs at 0');
  assert.strictEqual((await pub('/cv-legacy-token/reports', first.json.accessToken)).status, 200);

  const changed = await admin('PATCH', `/${link._id}`, { password: 'second-password-2' });
  assert.strictEqual(changed.status, 200, JSON.stringify(changed.json));
  assert.strictEqual((await ReportShareLink.findById(link._id).lean()).credentialVersion, 1);
  const stale = await pub('/cv-legacy-token/reports', first.json.accessToken);
  assert.strictEqual(stale.status, 401, 'the old token is over');
  assert.strictEqual(stale.json.code, 'password-required');
  const second = await unlock('cv-legacy-token', 'second-password-2');
  assert.strictEqual(jwt.decode(second.json.accessToken).cv, 1);
  assert.strictEqual((await pub('/cv-legacy-token/reports', second.json.accessToken)).status, 200);

  const rotated = await admin('POST', `/${link._id}/rotate`);
  assert.strictEqual(rotated.status, 200);
  const token = rotated.json.share.token;
  assert.notStrictEqual(token, 'cv-legacy-token');
  assert.strictEqual((await pub('/cv-legacy-token')).json.code, 'SHARE_NOT_FOUND', 'the old URL is dead');
  assert.strictEqual((await ReportShareLink.findById(link._id).lean()).credentialVersion, 2);
  assert.strictEqual((await pub(`/${token}/reports`, second.json.accessToken)).status, 401, 'a cv-1 token fails on the rotated link');
  const third = await unlock(token, 'second-password-2');
  assert.strictEqual(jwt.decode(third.json.accessToken).cv, 2, 'the password carries over');
  assert.strictEqual((await pub(`/${token}/reports`, third.json.accessToken)).status, 200);
});

test('a first password on a legacy open link bumps cv, and gives it an expiry and a one-year life (C2)', { skip }, async () => {
  const open = await rawLink({ token: 'open-legacy-token', passwordHash: null, expiresAt: null });
  const row = await rowOf(open._id);
  assert.deepStrictEqual([row.isLegacyOpen, row.noPassword, row.neverExpires, row.lifetimeEndsAt, row.passwordMeetsRule], [true, true, true, null, null]);
  const openToken = (await unlock('open-legacy-token')).json.accessToken;
  assert.strictEqual(jwt.decode(openToken).cv, 0);
  assert.strictEqual((await pub('/open-legacy-token/reports')).status, 200, 'an open link needs no token');
  await new Promise((r) => setTimeout(r, 50));
  assert.ok((await ReportShareLink.findById(open._id).lean()).lastAccessedAt, 'an open link stamps when opened');

  const res = await admin('PATCH', `/${open._id}`, { password: 'finally-locked-1' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  const s = res.json.share;
  assert.deepStrictEqual([s.hasPassword, s.isLegacyOpen, s.noPassword, s.neverExpires, s.passwordMeetsRule], [true, false, false, false, true]);
  assert.ok(near(s.expiresAt, Date.now() + 90 * DAY));
  assert.ok(near(s.lifetimeEndsAt, Date.now() + 365 * DAY), 'its life starts now, not when it was made');
  assert.strictEqual((await ReportShareLink.findById(open._id).lean()).credentialVersion, 1);
  assert.strictEqual((await pub('/open-legacy-token/reports')).status, 401);
  assert.strictEqual((await pub('/open-legacy-token/reports', openToken)).status, 401, 'the open era’s token is over');
  assert.strictEqual((await unlock('open-legacy-token', 'finally-locked-1')).status, 200);
  const sweep = await call('POST', '/admin/client-reports/shares/revoke-legacy', { ...ctx.admin });
  assert.ok(!sweep.json.links.some((l) => l.id === String(open._id)), 'it left the legacy sweep');
  const rows = await linkRows(open._id);
  assert.ok(rows.some((r) => r.field === 'reportLink.passwordChanged' && r.toValue.wasOpenLink === true && r.toValue.expiryAdded === true));
});

test('disable ends every token; enabling again does not bring them back', { skip }, async () => {
  const link = await makeLink('disable-me-please');
  const access = (await unlock(link.token, link.password)).json.accessToken;
  assert.strictEqual((await admin('PATCH', `/${link.id}`, { isActive: false })).status, 200);
  assert.strictEqual((await pub(`/${link.token}/reports`, access)).json.code, 'SHARE_NOT_FOUND');
  assert.strictEqual((await admin('PATCH', `/${link.id}`, { isActive: true })).status, 200);
  assert.strictEqual((await pub(`/${link.token}/reports`, access)).status, 401, 'the token from before the disable stays dead');
  const again = await unlock(link.token, link.password);
  assert.strictEqual((await pub(`/${link.token}/reports`, again.json.accessToken)).status, 200);
  assert.strictEqual((await ReportShareLink.findById(link.id).lean()).credentialVersion, 1, 'disable bumps; enable does not');
  const fields = (await linkRows(link.id)).map((r) => r.field);
  assert.ok(fields.includes('reportLink.disabled') && fields.includes('reportLink.enabled'));
});

test('Keep me signed in: 30 days when remembered, 24 hours otherwise', { skip }, async () => {
  const short = jwt.decode((await unlock(ctx.link.token, ctx.link.password)).json.accessToken);
  assert.strictEqual(short.exp - short.iat, 24 * 3600);
  const long = jwt.decode((await unlock(ctx.link.token, ctx.link.password, { remember: true })).json.accessToken);
  assert.strictEqual(long.exp - long.iat, 30 * 24 * 3600);
  assert.strictEqual((await unlock(ctx.link.token, undefined)).json.code, 'SHARE_PASSWORD_MISSING');
});

test('PRIV-2: a new sign-in token carries no id — its link by an opaque key; a token issued before still works until it expires', { skip }, async () => {
  const SECRET = process.env.JWT_SECRET;
  const a = await makeLink('priv-two-password-a', { label: 'A' });
  const b = await makeLink('priv-two-password-b', { label: 'B' });
  const doc = await ReportShareLink.findById(a.id).lean();
  const ids = [a.id, b.id, String(ctx.camp._id), String(ctx.org._id), String(ctx.report._id)];
  for (const remember of [false, true]) {
    const access = (await unlock(a.token, a.password, { remember })).json.accessToken;
    const claims = jwt.decode(access);
    assert.deepStrictEqual(Object.keys(claims).sort(), ['cv', 'exp', 'iat', 'kind', 'link'], 'kind, link, cv and the times — nothing else');
    const payload = Buffer.from(access.split('.')[1], 'base64url').toString('utf8');
    assert.doesNotMatch(payload, /[0-9a-f]{24}/i, 'no ObjectId anywhere in what the browser can read');
    for (const id of ids) assert.ok(!payload.includes(id));
    assert.match(claims.link, /^[A-Za-z0-9_-]{43}$/, 'an HMAC, base64url');
    assert.strictEqual((await pub(`/${a.token}/reports`, access)).status, 200);
    assert.strictEqual((await pub(`/${b.token}/reports`, access)).status, 401, 'A’s token never opens B');
  }
  assert.notStrictEqual(jwt.decode((await unlock(b.token, b.password)).json.accessToken).link, jwt.decode((await unlock(a.token, a.password)).json.accessToken).link);

  // Issued before this change: { kind, shareId, campaignId, cv } — honoured on the old check until it expires.
  const old = (extra = {}, opts = { expiresIn: '24h' }) =>
    jwt.sign({ kind: 'share', shareId: String(doc._id), campaignId: String(doc.campaignId), cv: doc.credentialVersion ?? 0, ...extra }, SECRET, opts);
  assert.strictEqual((await pub(`/${a.token}/reports`, old())).status, 200, 'an old 24-hour token still reads');
  assert.strictEqual((await pub(`/${a.token}/reports`, old({}, { expiresIn: '30d' }))).status, 200, 'a remembered one too');
  assert.strictEqual((await pub(`/${a.token}/reports/${ctx.report._id}`, old())).status, 200, 'the report as well as the hub');
  assert.strictEqual((await pub(`/${b.token}/reports`, old())).status, 401, 'never on another link');
  assert.strictEqual((await pub(`/${a.token}/reports`, old({ campaignId: String(ctx.other._id) }))).status, 401, 'nor naming another campaign');
  assert.strictEqual((await pub(`/${a.token}/reports`, old({ cv: 7 }))).status, 401, 'cv is still checked');
  const nowSec = Math.floor(Date.now() / 1000);
  assert.strictEqual((await pub(`/${a.token}/reports`, old({ iat: nowSec - 2 * 86400 }))).status, 401, 'and it ends when it expires');
  assert.strictEqual((await pub(`/${a.token}/reports`, old({ link: 'not-this-links-key' }))).status, 401, 'a token with a key is judged by the key alone');
  assert.strictEqual((await pub(`/${a.token}/reports`, jwt.sign({ kind: 'share', cv: 0 }, SECRET, { expiresIn: '1h' }))).status, 401, 'naming no link at all');

  // A password change still signs every device out, whichever kind of token it holds.
  const fresh = (await unlock(a.token, a.password)).json.accessToken;
  assert.strictEqual((await admin('PATCH', `/${a.id}`, { password: 'priv-two-password-c' })).status, 200);
  assert.strictEqual((await pub(`/${a.token}/reports`, fresh)).status, 401);
  assert.strictEqual((await pub(`/${a.token}/reports`, old())).status, 401);
});

test('passwordMeetsRule is learned at a successful unlock — never at a wrong one — and the password is never stored', { skip }, async () => {
  const short = await rawLink({ token: 'short-pw-token', passwordHash: await bcrypt.hash('eight-ch', 4), expiresAt: new Date(Date.now() + DAY) });
  const long = await rawLink({ token: 'long-pw-token', passwordHash: await bcrypt.hash('long-enough-password', 4), expiresAt: new Date(Date.now() + DAY) });
  await unlock('short-pw-token', 'wrong-guess-here');
  assert.strictEqual((await ReportShareLink.findById(short._id).lean()).passwordMeetsRule, undefined, 'unknown after a wrong guess');
  assert.strictEqual((await unlock('short-pw-token', 'eight-ch')).status, 200);
  assert.strictEqual((await unlock('long-pw-token', 'long-enough-password')).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual((await rowOf(short._id)).passwordMeetsRule, false, 'flagged: shorter than 12');
  assert.strictEqual((await rowOf(long._id)).passwordMeetsRule, true);
  const dump = JSON.stringify(await ReportShareLink.find({ _id: { $in: [short._id, long._id] } }).lean());
  assert.ok(!dump.includes('eight-ch') && !dump.includes('long-enough-password'), 'never the password itself');
});

test('legacy links with NO new fields, and with explicit nulls (the old failedUnlocks: null too), go through unlock, the panel and Extend', { skip }, async () => {
  const created = new Date(Date.now() - 100 * DAY);
  const bare = await rawLink({ token: 'bare-legacy', passwordHash: await bcrypt.hash('bare-legacy-pass', 4), expiresAt: new Date(Date.now() + 10 * DAY), createdAt: created });
  const nulls = await rawLink({
    token: 'null-legacy',
    passwordHash: await bcrypt.hash('null-legacy-pass', 4),
    expiresAt: new Date(Date.now() + 10 * DAY),
    createdAt: created,
    failedUnlocks: null,
    failedUnlockAt: null,
    failedUnlocksTotal: null,
    failedByDay: null,
    credentialVersion: null,
    lifetimeStartAt: null,
    passwordMeetsRule: null,
  });
  for (const [link, token, password] of [[bare, 'bare-legacy', 'bare-legacy-pass'], [nulls, 'null-legacy', 'null-legacy-pass']]) {
    const wrong = await unlock(token, 'a-wrong-password');
    assert.strictEqual(wrong.status, 401, `${token}: ${JSON.stringify(wrong.json)}`);
    const right = await unlock(token, password);
    assert.strictEqual(right.status, 200, `${token}: ${JSON.stringify(right.json)}`);
    assert.strictEqual((await pub(`/${token}/reports`, right.json.accessToken)).status, 200);
    const row = await rowOf(link._id);
    assert.deepStrictEqual(
      { ...row.failures, since: null },
      { last24h: 1, since: null, last7d: 1, total: 1 },
      `${token}: one wrong guess counted, the right one refunded`
    );
    assert.ok(near(row.lifetimeEndsAt, created.getTime() + 365 * DAY), `${token}: the life runs from createdAt`);
    // Extend caps at a year from createdAt: 265 days from now, not 365.
    const ext = await admin('POST', `/${link._id}/extend`, { expiresInDays: 365 });
    assert.strictEqual(ext.status, 200, JSON.stringify(ext.json));
    assert.ok(near(ext.json.share.expiresAt, created.getTime() + 365 * DAY), `${token}: capped by the one-year life`);
  }
});

test('300 concurrent wrong guesses meet exactly 50 bcrypt compares; the rest are 429 SHARE_LOCKED; a remembered device keeps working', { skip }, async () => {
  const link = await makeLink('the-real-password');
  const remembered = (await unlock(link.token, link.password, { remember: true })).json.accessToken;
  compares = 0;
  const results = await Promise.all(Array.from({ length: 300 }, () => unlock(link.token, 'a-wrong-guess-123')));
  assert.strictEqual(compares, 50, 'exactly 50 compares, however many arrived at once');
  const by = (status, code) => results.filter((r) => r.status === status && (!code || r.json?.code === code)).length;
  assert.strictEqual(by(401, 'SHARE_PASSWORD_WRONG'), 50);
  assert.strictEqual(by(429, 'SHARE_LOCKED'), 250);

  // Locked: even the right password gets no compare.
  compares = 0;
  const locked = await unlock(link.token, link.password);
  assert.strictEqual(locked.status, 429);
  assert.strictEqual(locked.json.code, 'SHARE_LOCKED');
  assert.strictEqual(compares, 0);
  // A lock never ends a session already open.
  assert.strictEqual((await pub(`/${link.token}/reports`, remembered)).status, 200, 'the remembered device still reads');

  const doc = await ReportShareLink.findById(link.id).lean();
  assert.strictEqual(doc.failedUnlockAt.length, 50);
  assert.strictEqual(doc.failedUnlocksTotal, 50);
  assert.ok(doc.lockedUntil && doc.lastLockedAt);
  const row = await rowOf(link.id);
  assert.strictEqual(row.lock.locked, true);
  const oldest = Math.min(...doc.failedUnlockAt.map((e) => new Date(e.at).getTime()));
  assert.strictEqual(new Date(row.lock.until).getTime(), oldest + DAY, 'until the oldest of the 50 is a day old');
  assert.deepStrictEqual([row.failures.last24h, row.failures.last7d, row.failures.total], [50, 50, 50]);
  assert.strictEqual(row.rotateAdvice, true, '50 wrong passwords is never the client');
  const rows = await linkRows(link.id);
  assert.strictEqual(rows.filter((r) => r.field === 'reportLink.locked').length, 1, 'one row per lock');
  assert.strictEqual(rows.filter((r) => r.field === 'reportLink.wrongPasswords').length, 1, 'one row a day once it reaches 10');
  ctx.locked = { ...link, remembered };
});

test('the lock lasts 24 hours from the oldest of the 50, then the right password works', { skip }, async () => {
  const back = async (ms) => {
    const doc = await ReportShareLink.findById(ctx.locked.id).lean();
    await ReportShareLink.updateOne(
      { _id: ctx.locked.id },
      { $set: { failedUnlockAt: doc.failedUnlockAt.map((e) => ({ ...e, at: new Date(new Date(e.at).getTime() - ms) })) } }
    );
  };
  await back(23 * 60 * 60 * 1000);
  assert.strictEqual((await unlock(ctx.locked.token, ctx.locked.password)).status, 429, 'still locked at 23 hours');
  await back(60 * 60 * 1000 + 1000);
  const ok = await unlock(ctx.locked.token, ctx.locked.password);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  const doc = await ReportShareLink.findById(ctx.locked.id).lean();
  assert.strictEqual(doc.failedUnlockAt.length, 0, 'the day-old entries dropped, and the right guess took its own back');
  assert.strictEqual(doc.failedUnlocksTotal, 50, 'the total keeps every wrong password');
});

test('Unlock now during the 50th compare is not undone, and no lock is recorded', { skip }, async () => {
  const link = await makeLink('mid-compare-password');
  const now = Date.now();
  await ReportShareLink.updateOne(
    { _id: link.id },
    { $set: { failedUnlockAt: Array.from({ length: 49 }, (_, i) => ({ at: new Date(now - 1000 * (i + 1)), id: `seed${i}` })) } }
  );
  const held = holdCompares((pw) => pw === 'the-fiftieth-guess');
  const fiftieth = unlock(link.token, 'the-fiftieth-guess');
  await held.entered;
  assert.strictEqual((await ReportShareLink.findById(link.id).lean()).failedUnlockAt.length, 50, 'the 50th slot is reserved before its compare');
  const un = await admin('POST', `/${link.id}/unlock`);
  assert.strictEqual(un.status, 200);
  assert.strictEqual(un.json.share.lock.locked, false);
  held.release();
  assert.strictEqual((await fiftieth).status, 401);
  const doc = await ReportShareLink.findById(link.id).lean();
  assert.strictEqual(doc.failedUnlockAt.length, 0, 'the Unlock now stands');
  assert.strictEqual(doc.lockedUntil, null);
  const fields = (await linkRows(link.id)).map((r) => r.field);
  assert.ok(!fields.includes('reportLink.locked'), 'no lock row for a lock that was lifted mid-compare');
  assert.ok(fields.includes('reportLink.unlocked'));
  assert.strictEqual(doc.failedUnlocksTotal, 1, 'the wrong password still counts in the totals');
  assert.strictEqual((await unlock(link.token, link.password)).status, 200);
});

test('a right password takes back only its own reservation; a refund after an Unlock now changes nothing', { skip }, async () => {
  const link = await makeLink('refund-own-only-pw');
  const held = holdCompares((pw) => pw === link.password);
  const right = unlock(link.token, link.password);
  await held.entered;
  for (let i = 0; i < 3; i += 1) assert.strictEqual((await unlock(link.token, `wrong-guess-${i}-xx`)).status, 401);
  held.release();
  assert.strictEqual((await right).status, 200);
  const doc = await ReportShareLink.findById(link.id).lean();
  assert.strictEqual(doc.failedUnlockAt.length, 3, 'the three wrong guesses stay');

  const again = holdCompares((pw) => pw === link.password);
  const second = unlock(link.token, link.password);
  await again.entered;
  await admin('POST', `/${link.id}/unlock`);
  for (let i = 0; i < 2; i += 1) await unlock(link.token, `later-wrong-${i}-xx`);
  again.release();
  assert.strictEqual((await second).status, 200);
  assert.strictEqual((await ReportShareLink.findById(link.id).lean()).failedUnlockAt.length, 2, 'its refund found nothing of its own to take');
});

test('Unlock now clears the budget but the week still advises a rotate; rotate clears both and bumps cv', { skip }, async () => {
  const link = await makeLink('advice-link-password');
  const now = Date.now();
  await ReportShareLink.updateOne(
    { _id: link.id },
    {
      $set: {
        failedUnlockAt: Array.from({ length: 50 }, (_, i) => ({ at: new Date(now - 1000 * (i + 1)), id: `x${i}` })),
        failedByDay: [{ day: new Date(now).toISOString().slice(0, 10), n: 50 }],
        failedUnlocksTotal: 50,
      },
    }
  );
  assert.strictEqual((await rowOf(link.id)).lock.locked, true);
  const un = await admin('POST', `/${link.id}/unlock`);
  assert.deepStrictEqual([un.json.share.lock.locked, un.json.share.failures.last24h, un.json.share.failures.last7d], [false, 0, 50]);
  assert.strictEqual(un.json.share.rotateAdvice, true, 'a week with 50 wrong passwords still says rotate');
  assert.strictEqual((await unlock(link.token, link.password)).status, 200);
  const rot = await admin('POST', `/${link.id}/rotate`);
  assert.deepStrictEqual([rot.json.share.failures.last7d, rot.json.share.failures.total, rot.json.share.rotateAdvice], [0, 50, false]);
  assert.strictEqual((await ReportShareLink.findById(link.id).lean()).credentialVersion, 1);
});

test('expiry: the one-year cap, Extend never shortens, an expired link renews to a NEW address', { skip }, async () => {
  const link = await makeLink('expiry-link-password', { expiresInDays: 180 });
  const start = (await ReportShareLink.findById(link.id).lean()).lifetimeStartAt;
  let res = await admin('POST', `/${link.id}/extend`, { expiresInDays: 30 });
  assert.strictEqual(res.status, 200);
  assert.ok(near(res.json.share.expiresAt, link.expiresAt, 1000), 'never shortens');
  res = await admin('POST', `/${link.id}/extend`, { expiresInDays: 365 });
  assert.strictEqual(new Date(res.json.share.expiresAt).getTime(), new Date(start).getTime() + 365 * DAY, 'up to a year from when it was made');
  res = await admin('POST', `/${link.id}/extend`, { expiresInDays: 365 });
  assert.strictEqual(new Date(res.json.share.expiresAt).getTime(), new Date(start).getTime() + 365 * DAY, 'and no further');
  assert.strictEqual((await admin('POST', `/${link.id}/extend`, { expiresInDays: 0 })).status, 400);
  assert.strictEqual((await admin('POST', `/${link.id}/renew`, {})).json.code, 'SHARE_NOT_EXPIRED');

  const access = (await unlock(link.token, link.password)).json.accessToken;
  await ReportShareLink.updateOne({ _id: link.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.strictEqual((await admin('POST', `/${link.id}/extend`, { expiresInDays: 30 })).json.code, 'SHARE_NEEDS_RENEW', 'an expired address never comes back');
  const renewed = await admin('POST', `/${link.id}/renew`, { expiresInDays: 90 });
  assert.strictEqual(renewed.status, 200, JSON.stringify(renewed.json));
  const s = renewed.json.share;
  assert.notStrictEqual(s.token, link.token, 'a new URL');
  assert.ok(near(s.expiresAt, Date.now() + 90 * DAY));
  assert.ok(near(s.lifetimeEndsAt, Date.now() + 365 * DAY), 'a new one-year life');
  assert.strictEqual((await pub(`/${link.token}`)).json.code, 'SHARE_NOT_FOUND', 'the forwarded URL stays dead');
  assert.strictEqual((await pub(`/${s.token}/reports`, access)).status, 401, 'cv moved');
  assert.strictEqual((await unlock(s.token, link.password)).status, 200, 'the password is kept');

  // A legacy link that never expires gets its first expiry from Extend, its life starting now.
  const never = await rawLink({ token: 'never-expires', passwordHash: await bcrypt.hash('never-expires-pw', 4), expiresAt: null, createdAt: new Date(Date.now() - 500 * DAY) });
  res = await admin('POST', `/${never._id}/extend`, { expiresInDays: 90 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok(near(res.json.share.expiresAt, Date.now() + 90 * DAY));
  assert.ok(near(res.json.share.lifetimeEndsAt, Date.now() + 365 * DAY));
  assert.strictEqual(res.json.share.neverExpires, false);
});

test('a lead manages links on her campaigns only; revoke-legacy stays admin-only', { skip }, async () => {
  const mine = await call('POST', '/admin/client-reports/shares', { ...ctx.lead, body: { campaignId: String(ctx.camp._id), label: 'Lead link' } });
  assert.strictEqual(mine.status, 201);
  const theirs = await call('POST', '/admin/client-reports/shares', { ...ctx.lead, body: { campaignId: String(ctx.other._id) } });
  assert.strictEqual(theirs.status, 403);
  assert.strictEqual((await call('GET', `/admin/client-reports/shares?campaignId=${ctx.other._id}`, { ...ctx.lead })).status, 403);
  assert.strictEqual((await call('POST', `/admin/client-reports/shares/${mine.json.share.id}/rotate`, { ...ctx.lead })).status, 200);
  assert.strictEqual((await call('POST', '/admin/client-reports/shares/revoke-legacy', { ...ctx.lead })).json.code, 'FORBIDDEN_ROLE');
});

test('History: every link change writes a row, kept out of the general feed, holding no token, password or hash', { skip }, async () => {
  const doomed = await makeLink('to-be-deleted-pw');
  assert.strictEqual((await admin('DELETE', `/${doomed.id}`)).status, 200);
  const rows = await CampaignChange.find({ campaignId: ctx.camp._id, shareLinkId: { $ne: null } }).lean();
  const fields = new Set(rows.map((r) => r.field));
  for (const f of ['created', 'passwordChanged', 'rotated', 'renewed', 'extended', 'disabled', 'enabled', 'wrongPasswords', 'locked', 'unlocked', 'deleted']) {
    assert.ok(fields.has(`reportLink.${f}`), `a reportLink.${f} row`);
  }
  assert.ok(rows.every((r) => r.source === 'client_report'));
  const links = await ReportShareLink.find({}).lean();
  const dump = JSON.stringify(rows);
  for (const l of links) {
    assert.ok(!dump.includes(l.token), 'no URL token');
    assert.ok(!l.passwordHash || !dump.includes(l.passwordHash), 'no hash');
  }
  for (const pw of ['the-real-password', 'second-password-2', 'finally-locked-1', 'to-be-deleted-pw', 'a-wrong-guess-123']) {
    assert.ok(!dump.includes(pw), `no password (${pw})`);
  }
  const general = await call('GET', `/admin/campaigns/${ctx.camp._id}/history`, { ...ctx.admin });
  assert.strictEqual(general.status, 200);
  assert.ok(!general.json.items.some((i) => String(i.field || '').startsWith('reportLink')), 'never in the general feed');
  const tab = await call('GET', `/admin/campaigns/${ctx.camp._id}/history?include=client_reports`, { ...ctx.admin });
  assert.ok(tab.json.items.some((i) => i.field === 'reportLink.locked' && i.shareLinkId));
});

test('the migration fills the link fields only where missing, and a second run changes nothing', { skip }, async () => {
  const created = new Date('2026-01-02T03:04:05Z');
  const expiring = await rawLink({ token: 'mig-expiring', passwordHash: 'x', expiresAt: new Date(Date.now() + DAY), createdAt: created });
  const open = await rawLink({ token: 'mig-open', passwordHash: null, expiresAt: null });
  const modern = await makeLink('a-modern-link-pw');
  const before = await ReportShareLink.findById(modern.id).lean();
  const quiet = () => {};
  const first = await runClientReportVisibility({ apply: true, log: quiet });
  assert.ok(first.links.credentialVersion >= 2);
  const e = await ReportShareLink.findById(expiring._id).lean();
  assert.strictEqual(e.credentialVersion, 0);
  assert.strictEqual(e.lifetimeStartAt.getTime(), created.getTime(), 'an expiring link’s life starts when it was made');
  assert.deepStrictEqual([e.failedUnlockAt, e.failedUnlocksTotal, e.failedByDay], [[], 0, []]);
  assert.strictEqual(e.passwordMeetsRule, undefined, 'unknown stays unknown');
  const o = await ReportShareLink.findById(open._id).lean();
  assert.strictEqual(o.lifetimeStartAt ?? null, null, 'a link that never expires has no life to start yet');
  assert.deepStrictEqual(await ReportShareLink.findById(modern.id).lean(), before, 'a link the new code wrote is untouched');
  const second = await runClientReportVisibility({ apply: true, log: quiet });
  assert.deepStrictEqual(second.links, { credentialVersion: 0, lifetimeStartAt: 0, failedUnlockAt: 0, failedUnlocksTotal: 0, failedByDay: 0 });
});

// docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, contract K6: every row says what its link opens — a link to
// all the campaign's reports (a link from before the field included) reads reportId and report null; a
// link to one report names it — from every route that returns a row.
test('every link row says what it opens: null on a link to all the reports, the report on a link to one', { skip }, async () => {
  const opensAll = (s) => assert.deepStrictEqual([s.reportId, s.report], [null, null], JSON.stringify(s));
  const link = await makeLink('a-long-rows-password', { label: 'Rows' });
  opensAll(link);
  opensAll(await rowOf(link.id));
  opensAll(await rowOf((await rawLink({ token: 'rows-legacy', passwordHash: null, expiresAt: null }))._id));
  opensAll((await admin('PATCH', `/${link.id}`, { label: 'Rows again' })).json.share);
  opensAll((await admin('POST', `/${link.id}/extend`, { expiresInDays: 30 })).json.share);
  opensAll((await admin('POST', `/${link.id}/rotate`)).json.share);
  opensAll((await admin('POST', `/${link.id}/unlock`)).json.share);
  await ReportShareLink.updateOne({ _id: link.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  opensAll((await admin('POST', `/${link.id}/renew`, { expiresInDays: 30 })).json.share);

  const one = await admin('POST', '', { campaignId: String(ctx.camp._id), label: 'Board', password: 'a-long-rows-password', reportId: String(ctx.report._id) });
  assert.strictEqual(one.status, 201, JSON.stringify(one.json));
  const named = { id: String(ctx.report._id), weekStart: '2026-07-06', weekEnd: '2026-07-12', scopeLabel: 'Whole campaign', takenDown: false };
  assert.deepStrictEqual([one.json.share.reportId, one.json.share.report], [String(ctx.report._id), named]);
  assert.deepStrictEqual((await rowOf(one.json.share.id)).report, named);
  assert.deepStrictEqual((await admin('POST', `/${one.json.share.id}/rotate`)).json.share.report, named);
  // Its History row holds the label and expiry, as every link's does — no report id, no token.
  const [created] = await linkRows(one.json.share.id);
  assert.strictEqual(created.field, 'reportLink.created');
  assert.deepStrictEqual(Object.keys(created.toValue).sort(), ['expiresAt', 'label']);
});
