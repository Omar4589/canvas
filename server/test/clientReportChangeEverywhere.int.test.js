import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// "Also change it on the other links that use this password" — docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C3,
// contracts K1, K3 and K8 — against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/everywhere node --test test/clientReportChangeEverywhere.int.test.js
//
//   · the rows count the campaign's other links that use a link's password — copied with Same as …, typed
//     again by hand, or sharing its hash with nothing to open — and name their tabs; never a link to all
//     your reports, a link from before (nothing kept, its own hash), or another campaign's;
//   · PATCH with alsoChanged changes exactly those links: one bcrypt run and one seal, each by its own
//     compare-and-set, each version bumped (its devices signed out), each with its own History row
//     (changedTogether), the hand-changed one saying how many (alsoChanged); { changed, skipped };
//   · a link someone else changed meanwhile is skipped — never overwritten — and the answer says so;
//   · with no key, copied links are still found by their hash.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-change-everywhere';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
const KEY = Buffer.alloc(32, 11).toString('base64');
process.env.CREDENTIAL_SEAL_KEY = KEY;
delete process.env.RETIRE_ALL_REPORTS_LINKS;

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const DAY = 24 * 60 * 60 * 1000;
const SEASON = 'season-password-one';
const NEW_SEASON = 'season-password-two';

let server;
let base;
const ctx = {};

const call = async (method, path, { body, as = ctx.admin, headers = {} } = {}) => {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(as ? { Authorization: `Bearer ${as.token}`, 'X-Org-Id': String(as.orgId) } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text, headers: res.headers };
};
const admin = (method, path, body) => call(method, `/admin/client-reports/shares${path}`, { body });
const rows = async (campaignId = ctx.camp._id) => {
  const res = await admin('GET', `?campaignId=${campaignId}`);
  assert.strictEqual(res.status, 200);
  return new Map(res.json.shares.map((s) => [s.id, s]));
};
let ipN = 0;
const unlock = (token, password) => {
  ipN += 1;
  return call('POST', `/share/${token}/unlock`, { as: null, body: { password }, headers: { 'X-Forwarded-For': `10.8.${ipN >> 8}.${ipN & 255}` } });
};
const reads = async (token, access) => (await call('GET', `/share/${token}/reports`, { as: null, headers: { 'X-Share-Token': access } })).status;
let weekN = 0;
const report = async (label, camp = ctx.camp) => {
  weekN += 1;
  const start = new Date(Date.UTC(2026, 6, 6) + weekN * 7 * DAY);
  const day = (d) => d.toISOString().slice(0, 10);
  return ClientReport.create({
    organizationId: camp.organizationId, campaignId: camp._id, status: 'published', publishedAt: new Date(),
    weekStart: day(start), weekEnd: day(new Date(start.getTime() + 6 * DAY)), timeZone: 'America/Chicago',
    rangeStartUtc: start, rangeEndUtc: new Date(start.getTime() + 7 * DAY),
    scope: { kind: label === 'Whole campaign' ? 'campaign' : 'team', label },
  });
};
// A link through the real route: typed, or Same as another.
const link = async (label, body, camp = ctx.camp) => {
  const r = await report(label, camp);
  const res = await admin('POST', '', { campaignId: String(camp._id), reportId: String(r._id), ...body });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return { ...res.json.share, report: r };
};
const raw = (id) => ReportShareLink.collection.findOne({ _id: new ObjectId(String(id)) });
const later = () => new Promise((r) => setTimeout(r, 5)); // distinct createdAt, so "newest first" is stable

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ReportShareLink.syncIndexes();
  const org = await Organization.create({ name: 'Everywhere Org', slug: 'everywhere-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'active' });
  const adminUser = await User.create({ firstName: 'Ada', lastName: 'E', email: 'ada@everywhere.t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: adminUser._id, organizationId: org._id, role: 'admin', isActive: true });
  const campaign = (name) => Campaign.create({ organizationId: org._id, name, type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  Object.assign(ctx, { org, camp: await campaign('Fall'), other: await campaign('Spring'), admin: { token: signUserToken(adminUser), orgId: org._id } });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // The season's password, on four links: A typed it; B copied A (Same as …); C typed it again by hand;
  // H copied A and has since lost its sealed copy (only its hash says so). D has another password. E is a
  // link from before (nothing kept, its own hash) with the same text; F a link to all your reports; G
  // another campaign's — none of those three is "the same password" as far as anything can tell.
  ctx.A = await link('Whole campaign', { password: SEASON });
  await later();
  ctx.B = await link('Paid team', { passwordFrom: ctx.A.id });
  await later();
  ctx.C = await link('North walk', { password: SEASON });
  await later();
  ctx.D = await link('Whole campaign', { password: 'a-different-password' });
  await later();
  ctx.H = await link('Paid team', { passwordFrom: ctx.A.id });
  await ReportShareLink.collection.updateOne({ _id: new ObjectId(ctx.H.id) }, { $set: { passwordSealed: null } });
  const legacyHash = await bcrypt.hash(SEASON, 4);
  const now = new Date();
  const ins = async (doc) => (await ReportShareLink.collection.insertOne({
    organizationId: org._id, campaignId: ctx.camp._id, passwordHash: legacyHash, expiresAt: new Date(now.getTime() + 30 * DAY),
    isActive: true, createdAt: now, updatedAt: now, credentialVersion: 0, ...doc,
  })).insertedId;
  ctx.E = { id: String(await ins({ token: 'everywhere-legacy', reportId: (await report('Board'))._id })), token: 'everywhere-legacy' };
  ctx.F = { id: String(await ins({ token: 'everywhere-all' })), token: 'everywhere-all' };
  ctx.G = await link('Whole campaign', { password: SEASON }, ctx.other);
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('the rows count the links that use the same password — copied, typed again, or by identical hash — and name their tabs', { skip }, async () => {
  const r = await rows();
  const count = (x) => [r.get(x.id).samePasswordCount, r.get(x.id).samePasswordTabs];
  assert.deepStrictEqual(count(ctx.A), [3, ['Paid team', 'North walk']], 'B, C and H — newest first, each tab once');
  assert.deepStrictEqual(count(ctx.B), [3, ['Paid team', 'North walk', 'Whole campaign']]);
  assert.deepStrictEqual(count(ctx.C), [2, ['Paid team', 'Whole campaign']], 'A and B by text; H can’t be opened and has another hash');
  assert.deepStrictEqual(count(ctx.H), [2, ['Paid team', 'Whole campaign']], 'A and B by hash');
  assert.deepStrictEqual(count(ctx.D), [0, []]);
  assert.deepStrictEqual(count(ctx.E), [0, []], 'a link from before: nothing kept, its own hash');
  assert.deepStrictEqual(count(ctx.F), [0, []], 'never a link to all your reports');
  assert.deepStrictEqual((await rows(ctx.other._id)).get(ctx.G.id).samePasswordCount, 0, 'never another campaign');
  assert.deepStrictEqual([r.get(ctx.H.id).passwordViewable, r.get(ctx.H.id).passwordHiddenReason], [false, 'unavailable']);
});

test('alsoChanged changes exactly those links — one compare-and-set each, versions bumped, devices out — with a History row each', { skip }, async () => {
  const signedIn = {};
  for (const x of [ctx.A, ctx.B, ctx.C, ctx.H, ctx.D, ctx.E, ctx.G]) {
    const res = await unlock(x.token, x === ctx.D ? 'a-different-password' : SEASON);
    assert.strictEqual(res.status, 200, `${x.token}: ${JSON.stringify(res.json)}`);
    signedIn[x.id] = res.json.accessToken;
  }
  const before = new Map();
  for (const x of [ctx.A, ctx.B, ctx.C, ctx.D, ctx.E, ctx.F, ctx.G, ctx.H]) before.set(x.id, await raw(x.id));
  const realHash = bcrypt.hash;
  let hashes = 0;
  bcrypt.hash = function (...a) {
    if (typeof a[1] === 'number') hashes += 1;
    return realHash.apply(bcrypt, a);
  };
  let res;
  try {
    res = await admin('PATCH', `/${ctx.A.id}`, { password: NEW_SEASON, alsoChanged: true });
  } finally {
    bcrypt.hash = realHash;
  }
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual([res.json.changed, res.json.skipped], [3, 0]);
  assert.strictEqual(hashes, 1, 'one bcrypt run serves every link');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.ok(!('password' in res.json), 'a typed password is never sent back');

  const a = await raw(ctx.A.id);
  for (const x of [ctx.B, ctx.C, ctx.H]) {
    const doc = await raw(x.id);
    assert.strictEqual(doc.passwordHash, a.passwordHash, `${x.token}: the new hash`);
    assert.strictEqual(doc.passwordSealed, a.passwordSealed, `${x.token}: the one seal`);
    assert.strictEqual(doc.credentialVersion, (before.get(x.id).credentialVersion ?? 0) + 1, `${x.token}: its version bumped`);
    assert.strictEqual(await reads(x.token, signedIn[x.id]), 401, `${x.token}: devices signed out`);
    assert.strictEqual((await unlock(x.token, SEASON)).status, 401, `${x.token}: the old password is over`);
    assert.strictEqual((await unlock(x.token, NEW_SEASON)).status, 200, `${x.token}: the new one works`);
    assert.strictEqual((await admin('GET', `/${x.id}/password`)).json.password, NEW_SEASON, `${x.token}: Show gives the new one`);
  }
  for (const x of [ctx.D, ctx.E, ctx.F, ctx.G]) {
    assert.deepStrictEqual(await raw(x.id), before.get(x.id), `${x.token}: untouched`);
  }
  for (const x of [ctx.D, ctx.E, ctx.G]) assert.strictEqual(await reads(x.token, signedIn[x.id]), 200, `${x.token}: still signed in`);

  // History: the hand-changed link says how many; each other link its own row; no secret anywhere.
  const rowsOf = async (x) => CampaignChange.find({ shareLinkId: new ObjectId(x.id), field: 'reportLink.passwordChanged' }).lean();
  const [own] = await rowsOf(ctx.A);
  assert.deepStrictEqual(own.toValue, { label: '', wasOpenLink: false, alsoChanged: 3 });
  assert.strictEqual(String(own.clientReportId), String(ctx.A.report._id));
  for (const x of [ctx.B, ctx.C, ctx.H]) {
    const xs = await rowsOf(x);
    assert.strictEqual(xs.length, 1, x.token);
    assert.deepStrictEqual(xs[0].toValue, { label: '', changedTogether: true });
    assert.strictEqual(String(xs[0].clientReportId), String(x.report._id));
    assert.ok(xs[0].periodLabel);
  }
  for (const x of [ctx.D, ctx.E, ctx.F, ctx.G]) assert.strictEqual((await rowsOf(x)).length, 0, `${x.token}: no row`);
  const history = JSON.stringify(await CampaignChange.find({}).lean());
  for (const secret of [SEASON, NEW_SEASON, a.passwordHash, a.passwordSealed]) assert.ok(!history.includes(secret));

  // They use one password again: the count offered next time is the set changed this time.
  const r = await rows();
  assert.strictEqual(r.get(ctx.A.id).samePasswordCount, 3);
});

test('a link someone else changed meanwhile is skipped — never overwritten — and the answer says so', { skip }, async () => {
  const P = await link('Whole campaign', { password: 'race-password-one' });
  const Q = await link('Paid team', { passwordFrom: P.id });
  const R = await link('North walk', { passwordFrom: P.id });
  assert.strictEqual((await rows()).get(P.id).samePasswordCount, 2);
  // Someone changes Q by hand just before this change reaches it.
  const theirs = await bcrypt.hash('their-own-password', 4);
  const real = ReportShareLink.findOneAndUpdate;
  ReportShareLink.findOneAndUpdate = function (filter, ...rest) {
    if (String(filter?._id) === Q.id && filter?.passwordHash) {
      ReportShareLink.findOneAndUpdate = real;
      return {
        lean: async () => {
          await ReportShareLink.collection.updateOne({ _id: new ObjectId(Q.id) }, { $set: { passwordHash: theirs, passwordSealed: null } });
          return real.call(ReportShareLink, filter, ...rest).lean();
        },
      };
    }
    return real.call(this, filter, ...rest);
  };
  let res;
  try {
    res = await admin('PATCH', `/${P.id}`, { generatePassword: true, alsoChanged: true });
  } finally {
    ReportShareLink.findOneAndUpdate = real;
  }
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual([res.json.changed, res.json.skipped], [1, 1]);
  assert.strictEqual(res.json.password.length, 12, 'made up: sent back once');
  assert.strictEqual((await raw(Q.id)).passwordHash, theirs, 'their change stands');
  assert.strictEqual((await unlock(R.token, res.json.password)).status, 200);
  assert.strictEqual((await unlock(Q.token, 'their-own-password')).status, 200);
  assert.strictEqual(await CampaignChange.countDocuments({ shareLinkId: new ObjectId(Q.id), field: 'reportLink.passwordChanged' }), 0, 'no row for a link it didn’t change');
  const [own] = await CampaignChange.find({ shareLinkId: new ObjectId(P.id), field: 'reportLink.passwordChanged' }).lean();
  assert.strictEqual(own.toValue.alsoChanged, 1);
});

test('without alsoChanged only the link itself changes; with nothing else using it, changed 0', { skip }, async () => {
  const S = await link('Whole campaign', { password: 'solo-password-one' });
  const T = await link('Paid team', { passwordFrom: S.id });
  const before = await raw(T.id);
  let res = await admin('PATCH', `/${S.id}`, { password: 'solo-password-two' });
  assert.strictEqual(res.status, 200);
  assert.ok(!('changed' in res.json) && !('skipped' in res.json), 'only when asked');
  assert.deepStrictEqual(await raw(T.id), before, 'the copy keeps the old one');
  assert.strictEqual(res.json.share.samePasswordCount, 0, 'and they no longer match');
  res = await admin('PATCH', `/${S.id}`, { password: 'solo-password-three', alsoChanged: true });
  assert.deepStrictEqual([res.status, res.json.changed, res.json.skipped], [200, 0, 0]);
  const [own] = await CampaignChange.find({ shareLinkId: new ObjectId(S.id), field: 'reportLink.passwordChanged' }).sort({ createdAt: -1 }).lean();
  assert.ok(!('alsoChanged' in own.toValue), 'no "also changed on 0 links"');
});

test('with no key, copied links are still found by their hash — and the new password is kept nowhere', { skip }, async () => {
  const U = await link('Whole campaign', { password: 'keyless-password-1' });
  const V = await link('Paid team', { passwordFrom: U.id });
  delete process.env.CREDENTIAL_SEAL_KEY;
  let res;
  try {
    assert.strictEqual((await rows()).get(U.id).samePasswordCount, 1, 'counted by hash, nothing opened');
    res = await admin('PATCH', `/${U.id}`, { password: 'keyless-password-2', alsoChanged: true });
  } finally {
    process.env.CREDENTIAL_SEAL_KEY = KEY;
  }
  assert.deepStrictEqual([res.status, res.json.changed, res.json.skipped], [200, 1, 0]);
  for (const x of [U, V]) {
    const doc = await raw(x.id);
    assert.strictEqual(doc.passwordSealed, null, `${x.token}: not kept without a key`);
    assert.strictEqual((await unlock(x.token, 'keyless-password-2')).status, 200);
  }
});
