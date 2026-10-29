import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// One link per report — docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C2, contract K2 — against the real app and a
// throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/onelink node --test test/clientReportOneLink.int.test.js
//
//   · a new link names its report (REPORT_REQUIRED without one), and the raw document carries
//     oneLinkGuard: true;
//   · a second Share on the report answers 409 REPORT_HAS_LINK with the report's primary link — the newest
//     that works, else the newest — a legacy unguarded link included, and before REPORT_NOT_SHOWN;
//   · 20 Shares at the same instant leave exactly one link, every other answering 409 with the winner;
//   · a lost race whose winner went with its report answers 404; one whose winner went alone tries once more;
//   · report_one_link_guard heals itself (the later of two guarded links leaves the guard), is declared on
//     the schema (so build-indexes --sync never drops it), is built at boot and nightly, and is never
//     confused with a token collision;
//   · the link's History rows name its report (clientReportId, seriesId, periodLabel).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-one-link';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
delete process.env.RETIRE_ALL_REPORTS_LINKS;

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { ClientReportSeries } = await import('../src/models/ClientReportSeries.js');
const { ReportShareLink, REPORT_ONE_LINK_GUARD } = await import('../src/models/ReportShareLink.js');
const { CampaignChange } = await import('../src/models/CampaignChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { ensureOneLinkGuard, isOneLinkGuardError, isReportPeriodGuardError, syncClientReportIndexes } = await import('../src/services/reports/clientReportIndexes.js');
const bcrypt = (await import('bcryptjs')).default;

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'one-link-password';

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
  return { status: res.status, json, text };
};
const share = (body, as) => call('POST', '/admin/client-reports/shares', { as, body: { campaignId: String(ctx.camp._id), password: PASSWORD, ...body } });
let weekN = 0;
// A published report of its own week (direct, no build: nothing here reads its numbers).
const report = async (extra = {}) => {
  weekN += 1;
  const start = new Date(Date.UTC(2026, 6, 6) + weekN * 7 * DAY);
  const day = (d) => d.toISOString().slice(0, 10);
  return ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, status: 'published', publishedAt: new Date(),
    weekStart: day(start), weekEnd: day(new Date(start.getTime() + 6 * DAY)), timeZone: 'America/Chicago',
    rangeStartUtc: start, rangeEndUtc: new Date(start.getTime() + 7 * DAY), seriesId: ctx.series._id,
    scope: { kind: 'campaign', label: 'Whole campaign' },
    ...extra,
  });
};
// A link as one made before one link per report looks: no guard flag, no sealed copy.
const rawLink = async (reportId, extra = {}) => {
  const now = new Date();
  const { insertedId } = await ReportShareLink.collection.insertOne({
    organizationId: ctx.org._id, campaignId: ctx.camp._id, token: `raw-${new ObjectId()}`, label: 'Board',
    passwordHash: await bcrypt.hash(PASSWORD, 4), expiresAt: new Date(now.getTime() + 30 * DAY), isActive: true,
    reportId, createdAt: now, updatedAt: now, ...extra,
  });
  return insertedId;
};
const quietLogs = async (fn) => {
  const lines = [];
  const saved = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = (...a) => lines.push(a.map(String).join(' '));
  try {
    await fn(lines);
  } finally {
    [console.log, console.warn, console.error] = saved;
  }
  return lines;
};
const guardIndex = async () => (await ReportShareLink.collection.indexes()).find((i) => i.name === REPORT_ONE_LINK_GUARD.options.name);

before(async () => {
  if (!URI) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  // The token's unique index, as production has it (Model.init is memoized, so nothing rebuilds it after
  // the drop) — then the deploy: no guard yet, until the boot build makes it, as the web dyno and the
  // worker do.
  await ReportShareLink.syncIndexes();
  await ReportShareLink.collection.dropIndex(REPORT_ONE_LINK_GUARD.options.name);
  await quietLogs(() => syncClientReportIndexes('test'));

  const org = await Organization.create({ name: 'One Link Org', slug: 'one-link-org', isActive: true });
  const elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'one-link-elsewhere', isActive: true });
  for (const o of [org, elsewhere]) await Subscription.create({ organizationId: o._id, status: 'active' });
  const mk = async (first, o, role) => {
    const u = await User.create({ firstName: first, lastName: 'One', email: `${first.toLowerCase()}@onelink.t.co`, passwordHash: 'x', isActive: true });
    await Membership.create({ userId: u._id, organizationId: o._id, role, isActive: true });
    return u;
  };
  const adminUser = await mk('Ada', org, 'admin');
  const otherAdmin = await mk('Oz', elsewhere, 'admin');
  const camp = await Campaign.create({ organizationId: org._id, name: 'Fall', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/Chicago' });
  const series = await ClientReportSeries.create({ organizationId: org._id, campaignId: camp._id, kind: 'campaign', label: 'Whole campaign' });
  Object.assign(ctx, {
    org, elsewhere, camp, series, adminUser,
    admin: { token: signUserToken(adminUser), orgId: org._id },
    otherAdmin: { token: signUserToken(otherAdmin), orgId: elsewhere._id },
  });

  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('a link names its report — REPORT_REQUIRED without one — and the raw document is in the guard', { skip }, async () => {
  for (const body of [{}, { reportId: null }]) {
    const res = await share(body);
    assert.deepStrictEqual([res.status, res.json.code], [400, 'REPORT_REQUIRED'], JSON.stringify(body));
  }
  assert.strictEqual(await ReportShareLink.countDocuments({}), 0, 'nothing made');
  const r = await report();
  const made = await share({ reportId: String(r._id) });
  assert.strictEqual(made.status, 201, JSON.stringify(made.json));
  assert.strictEqual(made.json.share.reportId, String(r._id));
  assert.strictEqual(made.json.share.allReports, false);
  assert.deepStrictEqual(made.json.share.report, {
    id: String(r._id), weekStart: r.weekStart, weekEnd: r.weekEnd, scopeLabel: 'Whole campaign', takenDown: false, seriesId: String(ctx.series._id),
  });
  const raw = await ReportShareLink.collection.findOne({ _id: new ObjectId(made.json.share.id) });
  assert.strictEqual(raw.oneLinkGuard, true, 'stored, not dropped: the field is declared');
  assert.strictEqual(String(raw.reportId), String(r._id));
  assert.ok(raw.passwordHash && raw.passwordHash !== PASSWORD);
  ctx.first = { report: r, link: made.json.share };
});

test('a second Share answers 409 REPORT_HAS_LINK with the primary link — before any hashing — and the link’s History names its report', { skip }, async () => {
  const { report: r, link } = ctx.first;
  const hashes = bcrypt.hash;
  let hashed = 0;
  bcrypt.hash = async (...a) => {
    hashed += 1;
    return hashes.apply(bcrypt, a);
  };
  let again;
  try {
    again = await share({ reportId: String(r._id), password: 'a-different-password' });
  } finally {
    bcrypt.hash = hashes;
  }
  assert.strictEqual(again.status, 409, JSON.stringify(again.json));
  assert.strictEqual(again.json.code, 'REPORT_HAS_LINK');
  assert.strictEqual(again.json.share.id, link.id, 'the link it already has');
  assert.strictEqual(again.json.share.token, link.token);
  assert.strictEqual(hashed, 0, 'looked first: no bcrypt run');
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: r._id }), 1);
  for (const k of ['passwordHash', 'passwordSealed', 'oneLinkGuard']) assert.ok(!(k in again.json.share), `no ${k} in a row`);

  const [created] = await CampaignChange.find({ shareLinkId: new ObjectId(link.id) }).lean();
  assert.strictEqual(created.field, 'reportLink.created');
  assert.strictEqual(String(created.clientReportId), String(r._id));
  assert.strictEqual(String(created.seriesId), String(ctx.series._id));
  assert.ok(/^Jul \d+ – Jul \d+, 2026$/.test(created.periodLabel), created.periodLabel);
  assert.deepStrictEqual(Object.keys(created.toValue).sort(), ['expiresAt', 'label'], 'no token, password or hash');
});

test('look-first beats REPORT_NOT_SHOWN, and finds a legacy unguarded link — the newest that works, else the newest', { skip }, async () => {
  // Taken down, with a link: the link is the answer, not "put it back up".
  const down = await report({ takenDownAt: new Date() });
  const downLink = await rawLink(down._id);
  let res = await share({ reportId: String(down._id) });
  assert.deepStrictEqual([res.status, res.json.code, res.json.share.id], [409, 'REPORT_HAS_LINK', String(downLink)]);
  assert.strictEqual(res.json.share.report.takenDown, true);
  // Taken down, no link: REPORT_NOT_SHOWN as before.
  const bare = await report({ takenDownAt: new Date() });
  res = await share({ reportId: String(bare._id) });
  assert.deepStrictEqual([res.status, res.json.code], [409, 'REPORT_NOT_SHOWN']);

  // Two links from before (no guard): the newer works — it is the answer; then it's turned off, so the
  // older (still working) is; then both off — the newest.
  const two = await report();
  const older = await rawLink(two._id, { label: 'Older', createdAt: new Date(Date.now() - 2 * DAY) });
  const newer = await rawLink(two._id, { label: 'Newer', createdAt: new Date(Date.now() - DAY) });
  res = await share({ reportId: String(two._id) });
  assert.deepStrictEqual([res.status, res.json.share.id], [409, String(newer)]);
  await ReportShareLink.updateOne({ _id: newer }, { $set: { isActive: false } });
  assert.strictEqual((await share({ reportId: String(two._id) })).json.share.id, String(older), 'the newest that works');
  await ReportShareLink.updateOne({ _id: older }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.strictEqual((await share({ reportId: String(two._id) })).json.share.id, String(newer), 'none works: the newest');
  const locked = Array.from({ length: 50 }, (_, i) => ({ at: new Date(Date.now() - 1000 * (i + 1)), id: `l${i}` }));
  await ReportShareLink.updateOne({ _id: newer }, { $set: { isActive: true, failedUnlockAt: locked } });
  assert.strictEqual((await share({ reportId: String(two._id) })).json.share.id, String(newer), 'locked and expired: still the newest');
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: two._id }), 2, 'nothing made, nothing touched');

  // Another organization's admin naming this report: 404, never its link.
  res = await call('POST', '/admin/client-reports/shares', { as: ctx.otherAdmin, body: { campaignId: String(ctx.camp._id), reportId: String(two._id) } });
  assert.strictEqual(res.status, 404);
  assert.ok(!JSON.stringify(res.json).includes(String(newer)));
});

test('20 Shares at the same instant leave exactly one link; every other answers 409 with it', { skip }, async () => {
  const r = await report();
  // Count the inserts: more than one reaching the database means the guard, not the look-first, decided.
  const realCreate = ReportShareLink.create;
  let inserts = 0;
  ReportShareLink.create = async function (...args) {
    inserts += 1;
    return realCreate.apply(this, args);
  };
  let results;
  try {
    results = await Promise.all(Array.from({ length: 20 }, (_, i) => share({ reportId: String(r._id), password: `racing-password-${String(i).padStart(2, '0')}` })));
  } finally {
    ReportShareLink.create = realCreate;
  }
  assert.ok(inserts > 1, `several Shares passed the look-first and met the guard (${inserts} inserts)`);
  const made = results.filter((x) => x.status === 201);
  const lost = results.filter((x) => x.status === 409);
  assert.strictEqual(made.length, 1, results.map((x) => `${x.status} ${x.json?.code}`).join(', '));
  assert.strictEqual(lost.length, 19);
  for (const x of lost) {
    assert.strictEqual(x.json.code, 'REPORT_HAS_LINK');
    assert.strictEqual(x.json.share.id, made[0].json.share.id, 'the winner');
  }
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: r._id }), 1);
  assert.strictEqual(await CampaignChange.countDocuments({ field: 'reportLink.created', clientReportId: r._id }), 1, 'one History row');
});

test('a lost race: 404 when the winner went with its report; one more try when the winner went alone', { skip }, async () => {
  const guardError = () => Object.assign(new Error(`E11000 duplicate key error collection: x index: ${REPORT_ONE_LINK_GUARD.options.name} dup key`), { code: 11000, keyPattern: { reportId: 1 } });
  const realCreate = ReportShareLink.create;
  const once = (fn) => {
    ReportShareLink.create = async function (...args) {
      ReportShareLink.create = realCreate;
      return fn.call(this, args);
    };
  };
  // The winner and its report deleted between this insert and its look for the winner.
  const gone = await report();
  once(async () => {
    await ClientReport.deleteOne({ _id: gone._id });
    throw guardError();
  });
  let res;
  try {
    res = await share({ reportId: String(gone._id) });
  } finally {
    ReportShareLink.create = realCreate;
  }
  assert.deepStrictEqual([res.status, res.json.code], [404, 'REPORT_NOT_FOUND']);
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: gone._id }), 0);

  // The winner deleted alone (Delete link): the key is free again — the second try makes the link.
  const free = await report();
  once(async () => {
    throw guardError();
  });
  try {
    res = await share({ reportId: String(free._id) });
  } finally {
    ReportShareLink.create = realCreate;
  }
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: free._id, oneLinkGuard: true }), 1);
});

test('isOneLinkGuardError: the guard, never a token collision or a report guard', { skip }, async () => {
  const r = await report();
  await ReportShareLink.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'guard-a', reportId: r._id, oneLinkGuard: true });
  const dupGuard = await ReportShareLink.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'guard-b', reportId: r._id, oneLinkGuard: true }).then(() => null, (e) => e);
  assert.ok(isOneLinkGuardError(dupGuard), 'the guard');
  assert.ok(!isReportPeriodGuardError(dupGuard), 'never a report guard');
  const dupToken = await ReportShareLink.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'guard-a', reportId: new ObjectId() }).then(() => null, (e) => e);
  assert.strictEqual(dupToken?.code, 11000);
  assert.ok(!isOneLinkGuardError(dupToken), 'a token E11000 is not a second link');
  // An unguarded second link (from before) sits outside it.
  await ReportShareLink.collection.insertOne({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token: 'guard-c', reportId: r._id });
  assert.strictEqual(await ReportShareLink.countDocuments({ reportId: r._id }), 2);
});

test('declared on the schema, so build-indexes --sync keeps it; built at boot and in the nightly job', { skip }, async () => {
  const declared = ReportShareLink.schema.indexes().find(([, o]) => o?.name === REPORT_ONE_LINK_GUARD.options.name);
  assert.ok(declared, 'declared');
  assert.deepStrictEqual(declared[0], { reportId: 1 });
  assert.deepStrictEqual(declared[1].partialFilterExpression, { oneLinkGuard: true });
  assert.strictEqual(declared[1].unique, true);
  const idx = await guardIndex();
  assert.ok(idx?.unique && idx.partialFilterExpression?.oneLinkGuard === true, 'built at boot (syncClientReportIndexes)');
  // syncIndexes keeps it — what --sync runs per model.
  await ReportShareLink.syncIndexes();
  assert.ok(await guardIndex(), 'still there after syncIndexes');
  const { readFileSync } = await import('node:fs');
  const scheduler = readFileSync(new URL('../src/services/retention/scheduler.js', import.meta.url), 'utf8');
  assert.match(scheduler, /await ensureOneLinkGuard\('maintenance'\)/, 'the nightly job checks it too');
});

test('the guard heals itself: the later of two guarded links of a report leaves the guard, the first keeps it, and it builds', { skip }, async () => {
  await ReportShareLink.collection.dropIndex(REPORT_ONE_LINK_GUARD.options.name);
  const r1 = await report();
  const r2 = await report();
  const at = (s) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));
  const doc = (reportId, createdAt, token) => ({ organizationId: ctx.org._id, campaignId: ctx.camp._id, token, reportId, oneLinkGuard: true, isActive: true, createdAt });
  const ids = Object.values((await ReportShareLink.collection.insertMany([
    doc(r1._id, at(2), 'heal-1-second'),
    doc(r1._id, at(1), 'heal-1-first'),
    doc(r2._id, at(3), 'heal-2-only'),
  ])).insertedIds);
  const [secondOfR1, firstOfR1, onlyOfR2] = ids;
  let results;
  const lines = await quietLogs(async () => {
    results = await Promise.all([ensureOneLinkGuard('test-web'), ensureOneLinkGuard('test-worker')]);
  });
  assert.deepStrictEqual(results, [true, true], lines.join('\n'));
  assert.ok(lines.some((l) => /ReportShareLink report_one_link_guard: a duplicate key failed the build; 1 link\(s\) sharing a report with an earlier one now sit outside the guard, as second links/.test(l)), lines.join('\n'));
  assert.ok((await guardIndex())?.unique, 'built');
  const raw = new Map((await ReportShareLink.collection.find({ _id: { $in: ids } }).toArray()).map((x) => [String(x._id), x]));
  assert.strictEqual(raw.size, 3, 'every link is still there');
  assert.strictEqual(raw.get(String(firstOfR1)).oneLinkGuard, true, 'the first made keeps the guard');
  assert.strictEqual(raw.get(String(onlyOfR2)).oneLinkGuard, true);
  assert.ok(!('oneLinkGuard' in raw.get(String(secondOfR1))), 'an ordinary second link: no flag at all');
  // Share still looks first and finds them; a new guarded double is refused again.
  const res = await share({ reportId: String(r1._id) });
  assert.deepStrictEqual([res.status, res.json.code], [409, 'REPORT_HAS_LINK']);
  const err = await ReportShareLink.collection.insertOne(doc(r2._id, new Date(), 'heal-2-double')).then(() => null, (e) => e);
  assert.ok(isOneLinkGuardError(err));
  // Healed, the next boot is quiet.
  const again = await quietLogs(async () => assert.strictEqual(await ensureOneLinkGuard('test-again'), true));
  assert.deepStrictEqual(again, []);
});
