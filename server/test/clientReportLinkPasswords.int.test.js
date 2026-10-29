import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Link passwords that can be shown again — docs/PROPOSAL_CLIENT_REPORT_LINKS.md §B, §C3, contracts K2–K4
// and K10 — against the real app and a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/linkpw node --test test/clientReportLinkPasswords.int.test.js
//
//   · a password made up, typed or copied (Same as …) is sealed beside its hash; Show gives it back to the
//     campaign's admins and leads (no-store), and a copied link unlocks with its source's password — its
//     hash and sealed copy copied verbatim, no bcrypt run;
//   · Same as … stays inside its campaign and organization (404 SOURCE_NOT_FOUND), and copies only a
//     password that can be opened and checked (409 PASSWORD_NOT_VIEWABLE);
//   · no key, a malformed key: links still work, nothing is kept, Show says why; a change then nulls the
//     sealed copy. A replaced key, a stale copy, a value sealed for something else, a copy that doesn't
//     match its hash: 409 with a reason, never a 500;
//   · a lone surrogate never reaches bcrypt (400 on POST and PATCH, a wrong password on the unlock);
//   · no password, hash or sealed copy in a row, History, an error body or a public response.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-link-passwords';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
const KEY = Buffer.alloc(32, 3).toString('base64');
process.env.CREDENTIAL_SEAL_KEY = KEY;
delete process.env.RETIRE_ALL_REPORTS_LINKS;

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
const { sealSecret } = await import('../src/utils/sealedSecret.js');
const { sealLinkPassword, openLinkPassword } = await import('../src/services/reports/shareLinks.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const DAY = 24 * 60 * 60 * 1000;
const LONE = 'Abcdefgh1234!\ud800';

let server;
let base;
const ctx = {};
// Every response body this suite sees, so the last test can look for a secret in any of them.
const seen = [];

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
  seen.push({ path, status: res.status, text });
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text, headers: res.headers };
};
const admin = (method, path, body, as) => call(method, `/admin/client-reports/shares${path}`, { body, as });
const make = async (report, body = {}, as) => {
  const res = await admin('POST', '', { campaignId: String(report.campaignId), reportId: String(report._id), ...body }, as);
  return res;
};
const show = (id, as) => admin('GET', `/${id}/password`, null, as);
let ipN = 0;
const unlock = (token, password) => {
  ipN += 1;
  return call('POST', `/share/${token}/unlock`, { as: null, body: { password }, headers: { 'X-Forwarded-For': `10.5.${ipN >> 8}.${ipN & 255}` } });
};
let weekN = 0;
const report = async (camp = ctx.camp, extra = {}) => {
  weekN += 1;
  const start = new Date(Date.UTC(2026, 6, 6) + weekN * 7 * DAY);
  const day = (d) => d.toISOString().slice(0, 10);
  return ClientReport.create({
    organizationId: camp.organizationId, campaignId: camp._id, status: 'published', publishedAt: new Date(),
    weekStart: day(start), weekEnd: day(new Date(start.getTime() + 6 * DAY)), timeZone: 'America/Chicago',
    rangeStartUtc: start, rangeEndUtc: new Date(start.getTime() + 7 * DAY), ...extra,
  });
};
const raw = (id) => ReportShareLink.collection.findOne({ _id: new ObjectId(String(id)) });
const withKey = async (value, fn) => {
  const saved = process.env.CREDENTIAL_SEAL_KEY;
  if (value === undefined) delete process.env.CREDENTIAL_SEAL_KEY;
  else process.env.CREDENTIAL_SEAL_KEY = value;
  try {
    return await fn();
  } finally {
    process.env.CREDENTIAL_SEAL_KEY = saved;
  }
};
// New hashes made (a salt-rounds number) — not the hash bcryptjs's own compare runs with a stored salt.
const countHashes = async (fn) => {
  const real = bcrypt.hash;
  let n = 0;
  bcrypt.hash = function (...a) {
    if (typeof a[1] === 'number') n += 1;
    return real.apply(bcrypt, a);
  };
  try {
    await fn();
  } finally {
    bcrypt.hash = real;
  }
  return n;
};

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  await ReportShareLink.syncIndexes();
  const org = await Organization.create({ name: 'Passwords Org', slug: 'passwords-org', isActive: true });
  const elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'passwords-elsewhere', isActive: true });
  for (const o of [org, elsewhere]) await Subscription.create({ organizationId: o._id, status: 'active' });
  const mk = async (first, o, role) => {
    const u = await User.create({ firstName: first, lastName: 'P', email: `${first.toLowerCase()}@linkpw.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: o._id, role, isActive: true });
    return u;
  };
  const adminUser = await mk('Ada', org, 'admin');
  const leadUser = await mk('Lea', org, 'lead');
  const otherLead = await mk('Olu', org, 'lead');
  const canvasser = await mk('Cal', org, 'canvasser');
  const foreignAdmin = await mk('Oz', elsewhere, 'admin');
  const campaign = (o, name) => Campaign.create({ organizationId: o._id, name, type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const camp = await campaign(org, 'Fall');
  const other = await campaign(org, 'Not this one');
  const foreign = await campaign(elsewhere, 'Foreign');
  await CampaignManager.create({ campaignId: camp._id, userId: leadUser._id, organizationId: org._id, grantedBy: adminUser._id });
  await CampaignManager.create({ campaignId: other._id, userId: otherLead._id, organizationId: org._id, grantedBy: adminUser._id });
  Object.assign(ctx, {
    org, elsewhere, camp, other, foreign,
    admin: { token: signUserToken(adminUser), orgId: org._id },
    lead: { token: signUserToken(leadUser), orgId: org._id },
    otherLead: { token: signUserToken(otherLead), orgId: org._id },
    canvasser: { token: signUserToken(canvasser), orgId: org._id },
    foreignAdmin: { token: signUserToken(foreignAdmin), orgId: elsewhere._id },
  });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('made up, typed and copied: each is kept sealed and Shows; a copied link takes its source’s hash and sealed copy verbatim', { skip }, async () => {
  const [r1, r2, r3] = [await report(), await report(), await report()];
  const gen = await make(r1);
  assert.strictEqual(gen.status, 201, JSON.stringify(gen.json));
  assert.strictEqual(gen.json.generatedPassword.length, 12);
  assert.strictEqual(gen.headers.get('cache-control'), 'no-store', 'a response carrying a password is never cached');
  assert.deepStrictEqual(
    [gen.json.share.passwordCopyable, gen.json.share.passwordViewable, gen.json.share.passwordHiddenReason],
    [true, true, null]
  );
  let res = await show(gen.json.share.id);
  assert.deepStrictEqual([res.status, res.json], [200, { password: gen.json.generatedPassword }]);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');

  const typed = await make(r2, { password: 'typed-season-password' });
  assert.strictEqual(typed.status, 201);
  assert.ok(!('generatedPassword' in typed.json), 'a typed password is never sent back');
  assert.strictEqual((await show(typed.json.share.id)).json.password, 'typed-season-password');

  let copied;
  const hashes = await countHashes(async () => {
    copied = await make(r3, { passwordFrom: gen.json.share.id });
  });
  assert.strictEqual(copied.status, 201, JSON.stringify(copied.json));
  assert.strictEqual(hashes, 0, 'no bcrypt run: copied verbatim');
  assert.ok(!('generatedPassword' in copied.json), 'Same as …: the client has it already');
  const [src, dst] = [await raw(gen.json.share.id), await raw(copied.json.share.id)];
  assert.strictEqual(dst.passwordHash, src.passwordHash);
  assert.strictEqual(dst.passwordSealed, src.passwordSealed);
  assert.strictEqual(dst.passwordMeetsRule, true);
  assert.strictEqual((await show(copied.json.share.id)).json.password, gen.json.generatedPassword);
  assert.strictEqual((await unlock(copied.json.share.token, gen.json.generatedPassword)).status, 200, 'the copied link unlocks with the source’s password');
  // The campaign's lead may Show too.
  assert.strictEqual((await show(gen.json.share.id, ctx.lead)).json.password, gen.json.generatedPassword);
  // The sealed copy is not the password, and is bound to the hash (K10).
  assert.notStrictEqual(src.passwordSealed, gen.json.generatedPassword);
  assert.match(src.passwordSealed, /^v1:/);
  assert.strictEqual(openLinkPassword(src.passwordSealed, src.passwordHash), gen.json.generatedPassword);
  assert.strictEqual(openLinkPassword(src.passwordSealed, dst.passwordHash.replace(/.$/, 'x')), null);
  Object.assign(ctx, { gen: { ...gen.json.share, password: gen.json.generatedPassword }, typed: typed.json.share, r1, r2, r3 });
});

test('a change Shows the new password: typed, or made up and sent back once as `password`', { skip }, async () => {
  const id = ctx.typed.id;
  let res = await admin('PATCH', `/${id}`, { password: 'a-brand-new-password' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.ok(!('password' in res.json), 'a typed one is never sent back');
  assert.strictEqual((await show(id)).json.password, 'a-brand-new-password');
  assert.strictEqual((await unlock(ctx.typed.token, 'typed-season-password')).status, 401, 'the old one is over');
  res = await admin('PATCH', `/${id}`, { generatePassword: true });
  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.password.length, 12);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.strictEqual((await show(id)).json.password, res.json.password);
  assert.strictEqual((await unlock(ctx.typed.token, res.json.password)).status, 200);
  assert.deepStrictEqual((await raw(id)).passwordMeetsRule, true);
  res = await admin('PATCH', `/${id}`, { password: 'both-at-once-password', generatePassword: true });
  assert.deepStrictEqual([res.status, res.json.code], [400, 'PASSWORD_AND_SOURCE']);
  for (const password of ['short', '']) assert.ok([400].includes((await admin('PATCH', `/${id}`, { password })).status));
});

test('Same as … stays inside its campaign and organization, and copies only a password that opens and checks', { skip }, async () => {
  const target = await report();
  const otherReport = await report(ctx.other);
  const theirs = await make(otherReport, { password: 'other-campaign-pass' });
  assert.strictEqual(theirs.status, 201);
  const foreignLink = await ReportShareLink.create({
    organizationId: ctx.elsewhere._id, campaignId: ctx.foreign._id, token: 'foreign-pw-link', reportId: new ObjectId(),
    passwordHash: await bcrypt.hash('foreign-password-1', 4), passwordSealed: null, expiresAt: new Date(Date.now() + DAY), isActive: true,
  });
  for (const from of [theirs.json.share.id, String(foreignLink._id), String(new ObjectId()), 'not-an-id']) {
    const res = await make(target, { passwordFrom: from });
    assert.deepStrictEqual([res.status, res.json.code], [404, 'SOURCE_NOT_FOUND'], from);
  }
  // In this campaign, but nothing to copy: a link to all your reports, one made before (no sealed copy),
  // one whose copy went stale, one sealed without its link's associated data.
  const legacyHash = await bcrypt.hash('legacy-pass-word', 4);
  const mkRaw = async (extra) => (await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: `src-${new ObjectId()}`, passwordHash: legacyHash,
    expiresAt: new Date(Date.now() + DAY), isActive: true, createdAt: new Date(), updatedAt: new Date(), ...extra,
  })).insertedId;
  const sources = {
    'all your reports': await mkRaw({ passwordSealed: sealLinkPassword('legacy-pass-word', legacyHash) }),
    'made before (no copy)': await mkRaw({ reportId: new ObjectId() }),
    'stale copy': await mkRaw({ reportId: new ObjectId(), passwordSealed: sealLinkPassword('legacy-pass-word', await bcrypt.hash('legacy-pass-word', 4)) }),
    'no associated data': await mkRaw({ reportId: new ObjectId(), passwordSealed: sealSecret('legacy-pass-word') }),
  };
  for (const [name, id] of Object.entries(sources)) {
    const res = await make(target, { passwordFrom: String(id) });
    assert.deepStrictEqual([res.status, res.json.code], [409, 'PASSWORD_NOT_VIEWABLE'], name);
  }
  let res = await make(target, { password: 'typed-and-copied-1', passwordFrom: ctx.gen.id });
  assert.deepStrictEqual([res.status, res.json.code], [400, 'PASSWORD_AND_SOURCE']);
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: target._id }), 0, 'no refusal left a link behind');
  // A lead of another campaign can't reach this one at all.
  res = await make(target, { passwordFrom: ctx.gen.id }, ctx.otherLead);
  assert.strictEqual(res.status, 403);
  res = await make(target, { passwordFrom: ctx.gen.id });
  assert.strictEqual(res.status, 201, 'and the right one works');
});

test('no key, or a malformed one: links still work and nothing is kept; Show says why; a change nulls the sealed copy', { skip }, async () => {
  for (const key of [undefined, 'not-32-bytes']) {
    await withKey(key, async () => {
      const r = await report();
      const made = await make(r);
      assert.strictEqual(made.status, 201, JSON.stringify(made.json));
      assert.strictEqual(made.json.generatedPassword.length, 12, 'shown once, right after, even with no key');
      assert.strictEqual((await raw(made.json.share.id)).passwordSealed, null);
      assert.deepStrictEqual(
        [made.json.share.passwordCopyable, made.json.share.passwordViewable, made.json.share.passwordHiddenReason],
        [false, false, 'unavailable']
      );
      const res = await show(made.json.share.id);
      assert.deepStrictEqual([res.status, res.json.code, res.json.reason], [409, 'PASSWORD_NOT_VIEWABLE', 'not_kept']);
      assert.strictEqual((await unlock(made.json.share.token, made.json.generatedPassword)).status, 200, 'the link works');
      // A link sealed while there was a key: can't be opened now.
      const sealed = await show(ctx.gen.id);
      assert.deepStrictEqual([sealed.status, sealed.json.reason], [409, 'no_key']);
      // Same as … from it: nothing to copy now.
      assert.strictEqual((await make(await report(), { passwordFrom: ctx.gen.id })).json.code, 'PASSWORD_NOT_VIEWABLE');
    });
  }
  // A link sealed with the key, changed without it: its sealed copy is nulled, never left stale.
  const r = await report();
  const made = await make(r, { password: 'kept-then-changed-1' });
  assert.ok((await raw(made.json.share.id)).passwordSealed);
  await withKey(undefined, async () => {
    const res = await admin('PATCH', `/${made.json.share.id}`, { password: 'changed-without-key' });
    assert.strictEqual(res.status, 200);
  });
  assert.strictEqual((await raw(made.json.share.id)).passwordSealed, null);
  assert.strictEqual((await show(made.json.share.id)).json.reason, 'not_kept', 'the key back: still nothing to show');
});

test('a replaced key, a stale copy, a value sealed for something else, a copy that doesn’t match: 409 with a reason, never a 500', { skip }, async () => {
  const id = ctx.gen.id;
  const replaced = await withKey(Buffer.alloc(32, 9).toString('base64'), () => show(id));
  assert.deepStrictEqual([replaced.status, replaced.json.code, replaced.json.reason], [409, 'PASSWORD_NOT_VIEWABLE', 'unreadable']);
  const row = (await admin('GET', `?campaignId=${ctx.camp._id}`)).json.shares.find((s) => s.id === id);
  assert.strictEqual(row.passwordViewable, true, 'and the right key again: viewable');

  const r = await report();
  const made = await make(r, { password: 'stale-copy-password' });
  const linkId = made.json.share.id;
  const doc = await raw(linkId);
  // The hash changed by code that didn't know the field: the copy stays bound to the old hash.
  await ReportShareLink.collection.updateOne({ _id: doc._id }, { $set: { passwordHash: await bcrypt.hash('some-other-password', 4) } });
  let res = await show(linkId);
  assert.deepStrictEqual([res.status, res.json.reason], [409, 'unreadable']);
  // Sealed with no associated data (as FbTime's keys are).
  await ReportShareLink.collection.updateOne({ _id: doc._id }, { $set: { passwordHash: doc.passwordHash, passwordSealed: sealSecret('stale-copy-password') } });
  res = await show(linkId);
  assert.deepStrictEqual([res.status, res.json.reason], [409, 'unreadable']);
  // Another link's copy, bound to its own hash.
  await ReportShareLink.collection.updateOne({ _id: doc._id }, { $set: { passwordSealed: (await raw(ctx.gen.id)).passwordSealed } });
  res = await show(linkId);
  assert.deepStrictEqual([res.status, res.json.reason], [409, 'unreadable']);
  // Opens under this hash but isn't its password (written by hand): the bcrypt check catches it.
  await ReportShareLink.collection.updateOne({ _id: doc._id }, { $set: { passwordSealed: sealLinkPassword('not-the-password', doc.passwordHash) } });
  res = await show(linkId);
  assert.deepStrictEqual([res.status, res.json.reason], [409, 'mismatch']);
  // Garbage.
  await ReportShareLink.collection.updateOne({ _id: doc._id }, { $set: { passwordSealed: 'v1:@@:##:$$' } });
  res = await show(linkId);
  assert.deepStrictEqual([res.status, res.json.reason], [409, 'unreadable']);
  for (const x of [replaced, res]) assert.deepStrictEqual(Object.keys(x.json).sort(), ['code', 'error', 'reason'], 'never an error message from the open');
});

test('a lone surrogate never reaches bcrypt: 400 on POST and PATCH, a wrong password on the unlock — and the server stays up', { skip }, async () => {
  const r = await report();
  let res = await make(r, { password: LONE });
  assert.deepStrictEqual([res.status, res.json.code], [400, 'SHARE_PASSWORD_INVALID']);
  res = await admin('PATCH', `/${ctx.gen.id}`, { password: LONE });
  assert.deepStrictEqual([res.status, res.json.code], [400, 'SHARE_PASSWORD_INVALID']);
  res = await unlock(ctx.gen.token, LONE);
  assert.deepStrictEqual([res.status, res.json.code], [401, 'SHARE_PASSWORD_WRONG']);
  assert.strictEqual((await unlock(ctx.gen.token, ctx.gen.password)).status, 200, 'the same server answers the next one');
  assert.strictEqual((await show(ctx.gen.id)).json.password, ctx.gen.password, 'and the password is unchanged');
});

test('who may Show: the campaign’s admins and leads — another campaign’s lead 403, a canvasser 403, another organization 404', { skip }, async () => {
  assert.strictEqual((await show(ctx.gen.id, ctx.otherLead)).status, 403);
  assert.strictEqual((await show(ctx.gen.id, ctx.canvasser)).status, 403);
  const foreign = await show(ctx.gen.id, ctx.foreignAdmin);
  assert.deepStrictEqual([foreign.status, foreign.json.code], [404, 'SHARE_NOT_FOUND']);
  assert.strictEqual((await show('not-an-id')).status, 400);
  for (const res of [foreign]) assert.ok(!('password' in res.json));
});

test('no password, hash or sealed copy in any row, History row, error body or public response', { skip }, async () => {
  // A few public reads on top of everything above.
  const access = (await unlock(ctx.gen.token, ctx.gen.password)).json.accessToken;
  await call('GET', `/share/${ctx.gen.token}`, { as: null });
  await call('GET', `/share/${ctx.gen.token}/reports`, { as: null, headers: { 'X-Share-Token': access } });
  await call('GET', `/share/${ctx.gen.token}/reports/${ctx.r1._id}`, { as: null, headers: { 'X-Share-Token': access } });
  const list = await admin('GET', `?campaignId=${ctx.camp._id}`);
  const links = await ReportShareLink.find({}).select('+passwordSealed').lean();
  const hashes = links.map((l) => l.passwordHash).filter(Boolean);
  const sealed = links.map((l) => l.passwordSealed).filter(Boolean);
  assert.ok(sealed.length >= 3 && hashes.length >= 5);
  for (const row of list.json.shares) {
    for (const k of ['passwordHash', 'passwordSealed', 'password', 'oneLinkGuard']) assert.ok(!(k in row), `no ${k} in a row`);
  }
  const history = JSON.stringify(await CampaignChange.find({}).lean());
  // Show's answers carry a password — on purpose, to whoever may Show. Everything else carries none.
  const notShow = seen.filter((s) => !/\/password$/.test(s.path) && !/"generatedPassword"|"password":/.test(s.text));
  const blobs = [history, ...notShow.map((s) => s.text)];
  for (const secret of [...hashes, ...sealed, ctx.gen.password, 'typed-season-password', 'a-brand-new-password', 'kept-then-changed-1']) {
    for (const blob of blobs) assert.ok(!blob.includes(secret), `a secret leaked: ${secret.slice(0, 8)}…`);
  }
  // And the responses that do carry one carry nothing else secret.
  for (const s of seen.filter((x) => /"generatedPassword"|"password":/.test(x.text))) {
    for (const secret of [...hashes, ...sealed]) assert.ok(!s.text.includes(secret), `${s.path}: no hash or sealed copy`);
  }
});
