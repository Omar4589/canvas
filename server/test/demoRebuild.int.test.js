import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The Control Room "Rebuild demo day" button, over the REAL Express app + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/demorebuild_test node --test test/demoRebuild.int.test.js
//
// The button used to call an activity-only refresh service that resolved each book to ONE owner
// through a lossy Map over the MANY-TO-MANY TurfAssignment table. One extra assignment row on the
// app-review account silently re-attributed every field canvasser's knocks to it — reproduced in
// the field, and the reason that service is gone. The button now runs the SEED, whose per-round
// deleteMany + insertMany is the only thing that actually heals drifted assignments.
//
// Asserts: the engine module is INERT on import (the hazard that made this refactor necessary);
// a bad password env throws at call time rather than crashing the dyno at boot; the request-path
// floors refuse rather than half-build; and the rebuild both repairs injected drift and leaves the
// review accounts' books unwalked.
//
// And the demo's ONE client link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C5): Rebuild demo day points
// the same link at the new report (same _id, address and password — a viewer stays signed in); which
// link is the demo's; the one-time replacement of a link to all the reports; a plain apply leaving it
// as it is; a report that already has a link of its own; no shown report; the env password sealed when
// it matches; the password refusal before any write; and --rebuild's new link on the new campaign.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-demo-rebuild';
// A dead port, as every other integration suite pins it: queues/connection.js otherwise defaults to
// 127.0.0.1:6379, and this suite must never reach a developer's own Redis.
process.env.REDIS_URL = 'redis://127.0.0.1:1';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { seedDemoOrg } = await import('../src/services/platform/seedDemoOrg.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { archiveWalkList } = await import('../src/services/passes/passLifecycle.js');
const { ReportShareLink } = await import('../src/models/ReportShareLink.js');
const { ClientReport } = await import('../src/models/ClientReport.js');
const { openLinkPassword, sealLinkPassword } = await import('../src/services/reports/shareLinks.js');
const { DEMO_ORG_SLUG } = await import('../src/utils/demoData/namePools.js');
const { default: bcrypt } = await import('bcryptjs');
const { randomBytes } = await import('node:crypto');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

const post = (path, token, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const req = http.request(
    `${base}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
      },
    },
    (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    }
  );
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});

// ONE before() hook for the whole file (repo convention), and the full demo build happens here
// once — the runner gives each test file its own database, so a real seed is safe.
before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);

  // The engine must be importable without connecting, writing, or self-executing. Before the
  // extraction, importing it ran main() and then called mongoose.disconnect() — at server boot.
  ctx.readyStateAfterImport = mongoose.connection.readyState;
  ctx.orgsBeforeSeed = await Organization.countDocuments({});

  await seedDemoOrg({ apply: true, log: () => {} });

  ctx.org = await Organization.findOne({ slug: DEMO_ORG_SLUG });
  ctx.campaign = await Campaign.findOne({ organizationId: ctx.org._id, isActive: true });

  const breakGlass = await User.create({
    firstName: 'Break', lastName: 'Glass', email: 'breakglass@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'break_glass',
  });
  const support = await User.create({
    firstName: 'Sup', lastName: 'Port', email: 'support@doorline.app',
    passwordHash: 'x', isActive: true, isSuperAdmin: true, platformRole: 'support',
  });
  ctx.token = signUserToken(breakGlass);
  ctx.supportToken = signUserToken(support);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!URI) return;
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

test('importing the engine is inert — no connection change, no writes', { skip }, async () => {
  assert.equal(ctx.readyStateAfterImport, 1, 'import must not disconnect the shared connection');
  assert.equal(ctx.orgsBeforeSeed, 0, 'import must not write anything');
});

test('a mismatched password env throws at call time, not at import', { skip }, async () => {
  const prevEmail = process.env.SEED_DEMO_ADMIN_EMAIL;
  const prevPw = process.env.SEED_DEMO_ADMIN_PASSWORD;
  process.env.SEED_DEMO_ADMIN_EMAIL = 'a@x.com,b@x.com';
  process.env.SEED_DEMO_ADMIN_PASSWORD = 'p1,p2,p3';
  try {
    await assert.rejects(
      () => seedDemoOrg({ apply: true, log: () => {} }),
      (e) => e.code === 'SEED_PASSWORD_COUNT' && /SEED_DEMO_ADMIN_PASSWORD/.test(e.message)
    );
  } finally {
    if (prevEmail === undefined) delete process.env.SEED_DEMO_ADMIN_EMAIL;
    else process.env.SEED_DEMO_ADMIN_EMAIL = prevEmail;
    if (prevPw === undefined) delete process.env.SEED_DEMO_ADMIN_PASSWORD;
    else process.env.SEED_DEMO_ADMIN_PASSWORD = prevPw;
  }
});

test('requireExisting refuses a cold database instead of half-building it', { skip }, async () => {
  const realSlug = ctx.org.slug;
  await Organization.updateOne({ _id: ctx.org._id }, { $set: { slug: 'temporarily-renamed' } });
  try {
    await assert.rejects(
      () => seedDemoOrg({ apply: true, reset: true, requireExisting: true, log: () => {} }),
      (e) => e.status === 409 && e.code === 'DEMO_NOT_BUILT'
    );
  } finally {
    await Organization.updateOne({ _id: ctx.org._id }, { $set: { slug: realSlug } });
  }
});

test('a bodyless POST from a stale bundle is refused', { skip }, async () => {
  const res = await post('/super-admin/demo/refresh-day', ctx.token);
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'confirm-required');
});

test('support-tier staff cannot rebuild the demo org', { skip }, async () => {
  const res = await post('/super-admin/demo/refresh-day', ctx.supportToken, { confirm: 'rebuild' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'BREAK_GLASS_REQUIRED');
});

test('the rebuild heals drifted assignments and never walks a review book', { skip }, async () => {
  // Reproduce the production drift EXACTLY: give the review account a SECOND, unmarked
  // assignment row on every field book. Its rows sort last, so the old lossy Map resolved every
  // book to it and staged the whole day under the review account.
  const reviewer = await User.findOne({ email: 'demo-canvasser@doorline.app' });
  const rows = await TurfAssignment.find({ campaignId: ctx.campaign._id }).lean();
  const dupes = rows
    .filter((r) => String(r.userId) !== String(reviewer._id) && !r.isReviewerBook)
    .map((r) => ({
      turfId: r.turfId, userId: reviewer._id, organizationId: ctx.org._id,
      campaignId: ctx.campaign._id, passId: r.passId, assignedBy: reviewer._id,
      assignedAt: new Date(), isReviewerBook: false,
    }));
  assert.ok(dupes.length > 0, 'fixture must actually inject drift');
  await TurfAssignment.insertMany(dupes);

  const res = await post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // The duplicate rows are gone — one row per book per round, which is what the seed rebuilds.
  const perTurf = await TurfAssignment.aggregate([
    { $match: { campaignId: ctx.campaign._id } },
    { $group: { _id: '$turfId', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  assert.equal(perTurf.length, 0, 'rebuild must leave exactly one assignment row per book');

  // Attribution is spread across the field canvassers, not collapsed onto one account.
  const byUser = await CanvassActivity.aggregate([
    { $match: { campaignId: ctx.campaign._id } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  assert.ok(byUser.length >= 4, `expected >=4 canvassers with knocks, got ${byUser.length}`);

  // The review accounts' reserved books stay unwalked — the whole point of isReviewerBook.
  const reviewerTurfIds = (await TurfAssignment.find(
    { campaignId: ctx.campaign._id, isReviewerBook: true }, 'turfId'
  ).lean()).map((r) => String(r.turfId));
  assert.ok(reviewerTurfIds.length > 0, 'seed must mark a reviewer book in every round');
  const knocksOnReviewerBooks = await CanvassActivity.countDocuments({
    campaignId: ctx.campaign._id, turfId: { $in: reviewerTurfIds },
  });
  assert.equal(knocksOnReviewerBooks, 0, 'a review account\'s book must never be staged');
});

test('the rebuild reopens a demo walk list someone archived — never "Archived · Pass 2 still live"', { skip }, async () => {
  const effort = await Effort.findOne({ campaignId: ctx.campaign._id, name: 'Beaverdale' }).lean();
  const live = await Pass.findOne({ effortId: effort._id, status: 'active' }).lean();
  assert.ok(live, 'the demo has a live pass');
  await archiveWalkList({ campaign: ctx.campaign, effortId: effort._id, userId: null, confirm: true });
  assert.equal((await Effort.findById(effort._id).lean()).status, 'archived');

  const res = await post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const after = await Effort.findById(effort._id).lean();
  assert.equal(after.status, 'active');
  assert.equal(after.archivedAt, null);
  assert.equal(after.endedPassId, null);
  assert.equal((await Pass.findById(live._id).lean()).status, 'active', 'the same pass is live again');
});

test('the rebuild does not touch review-account passwords', { skip }, async () => {
  const before = await User.findOne({ email: 'demo-canvasser@doorline.app' }, 'passwordHash').lean();
  const prev = process.env.SEED_DEMO_CANVASSER_PASSWORD;
  // Even with the env pointing at a DIFFERENT password, the button must leave the stored hash
  // alone — a stray click must not lock out a store reviewer mid-review.
  process.env.SEED_DEMO_CANVASSER_PASSWORD = 'CompletelyDifferent99!';
  try {
    const res = await post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.accounts.passwordsSynced, [], 'button must sync no passwords');
    const after = await User.findOne({ email: 'demo-canvasser@doorline.app' }, 'passwordHash').lean();
    assert.equal(after.passwordHash, before.passwordHash, 'review password must be unchanged');
  } finally {
    if (prev === undefined) delete process.env.SEED_DEMO_CANVASSER_PASSWORD;
    else process.env.SEED_DEMO_CANVASSER_PASSWORD = prev;
  }
});

test('the response carries no credentials', { skip }, async () => {
  const res = await post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
  assert.equal(res.status, 200);
  const serialized = JSON.stringify(res.body);
  assert.ok(!/admin1234!|Victory26!/.test(serialized), 'no password may cross the API boundary');
  assert.equal(res.body.accounts.created.every((a) => a.credentialSource && !a.password), true);
  // The staged counts the web bundle dereferences unconditionally must always be present.
  assert.equal(typeof res.body.staged.todayKnocks, 'number');
  assert.equal(typeof res.body.staged.activities, 'number');
  assert.equal(typeof res.body.staged.surveys, 'number');
});

test('the demo link follows the hardened link rules: its fields, its one-year life on reset, a renewal when the life is up', { skip }, async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const reset = () => seedDemoOrg({ apply: true, reset: true, allowImport: false, syncPasswords: false, requireExisting: true, log: () => {} });
  const link = await ReportShareLink.findOne({ campaignId: ctx.campaign._id, isActive: true }).lean();
  // The demo report's own link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C5), never one to all the reports.
  assert.strictEqual(link.label, 'Client demo link');
  assert.ok(link.reportId && (await ClientReport.exists({ _id: link.reportId, status: 'published' })), 'it opens the demo report');
  assert.strictEqual(link.oneLinkGuard, true, 'in the one-link guard, as every new link is');
  assert.ok(link.lifetimeStartAt, 'a one-year life from when it was made');
  assert.equal(link.credentialVersion, 0);
  assert.equal(link.passwordMeetsRule, true, 'the generated password is 12 characters');
  assert.deepEqual(link.failedUnlockAt, []);
  assert.equal(link.failedUnlocksTotal, 0);
  assert.ok(+link.expiresAt <= +link.lifetimeStartAt + 365 * DAY);

  // A reset well inside the life: the expiry moves out 90 days; the life, the address and every
  // device's sign-in stay.
  const start = new Date(Date.now() - 200 * DAY);
  await ReportShareLink.updateOne({ _id: link._id }, { $set: { lifetimeStartAt: start, expiresAt: new Date(Date.now() + 5 * DAY) } });
  await reset();
  let after = await ReportShareLink.findById(link._id).lean();
  assert.equal(after.token, link.token);
  assert.equal(+after.lifetimeStartAt, +start);
  assert.ok(Math.abs(+after.expiresAt - (Date.now() + 90 * DAY)) < 60 * 60 * 1000, 'about 90 days out');
  assert.equal(after.credentialVersion, 0);

  // A life that can't cover another 90 days never runs past its end: the reset renews it, as the
  // panel's Renew does — a new address, a new life, the version bumped, the failure budget cleared.
  await ReportShareLink.updateOne(
    { _id: link._id },
    { $set: { lifetimeStartAt: new Date(Date.now() - 300 * DAY), failedUnlockAt: [{ at: new Date(), id: 'x' }] } }
  );
  await reset();
  after = await ReportShareLink.findById(link._id).lean();
  assert.notEqual(after.token, link.token, 'a new address');
  assert.ok(Date.now() - after.lifetimeStartAt < 10 * 60 * 1000, 'a new life');
  assert.ok(+after.expiresAt <= +after.lifetimeStartAt + 365 * DAY);
  assert.equal(after.credentialVersion, 1, 'every token the old address issued is signed out');
  assert.deepEqual(after.failedUnlockAt, []);

  // An open link gaining its password: the version bumps, and an env password shorter than 12 is
  // flagged rather than claimed to meet the rule.
  await ReportShareLink.updateOne({ _id: link._id }, { $set: { passwordHash: null }, $unset: { passwordMeetsRule: 1 } });
  const prev = process.env.SEED_DEMO_SHARE_PASSWORD;
  process.env.SEED_DEMO_SHARE_PASSWORD = 'short-pw';
  try {
    await reset();
  } finally {
    if (prev === undefined) delete process.env.SEED_DEMO_SHARE_PASSWORD;
    else process.env.SEED_DEMO_SHARE_PASSWORD = prev;
  }
  after = await ReportShareLink.findById(link._id).lean();
  assert.ok(after.passwordHash && after.passwordHash.startsWith('$2'), 'a bcrypt hash, stored as itself');
  assert.equal(after.passwordMeetsRule, false);
  assert.equal(after.credentialVersion, 2);
});

// ── The demo's one client link (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C5) ───────────────────────────
// The tests below run in order on the one demo campaign; each leaves one demo link with a known password.

const DAY = 86400e3;
const PW = 'demo-link-password';
const SEAL_KEY = randomBytes(32).toString('base64');
// Config vars for one step, put back as they were after it.
const withEnv = async (vars, fn) => {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const put = (entries) => entries.forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  put(Object.entries(vars));
  try {
    return await fn();
  } finally {
    put(Object.entries(prev));
  }
};
// The CLI's reset (true) or plain apply (false), on the button's floors, its log kept.
const seed = (reset, lines = []) =>
  seedDemoOrg({ apply: true, reset, allowImport: false, syncPasswords: false, requireExisting: true, log: (l) => lines.push(l) });
const campaignLinks = () => ReportShareLink.find({ campaignId: ctx.campaign._id }).select('+passwordSealed').sort({ createdAt: 1, _id: 1 }).lean();
const theDemoLink = async () => {
  const links = await campaignLinks();
  assert.strictEqual(links.length, 1, `one link on the demo campaign: ${JSON.stringify(links.map((l) => l.token))}`);
  return links[0];
};
const shownReports = () => ClientReport.find({ campaignId: ctx.campaign._id, status: 'published', takenDownAt: null }).lean();
const setPassword = async (id, pw = PW) => {
  const passwordHash = await bcrypt.hash(pw, 4);
  await ReportShareLink.updateOne({ _id: id }, { $set: { passwordHash, passwordSealed: null } });
  return passwordHash;
};
const shareCall = async (method, path, { body, access } = {}) => {
  const res = await fetch(`${base}/share/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(access ? { 'X-Share-Token': access } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const unlock = async (token, password = PW) => {
  const res = await shareCall('POST', `${token}/unlock`, { body: { password } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body.accessToken;
};
const extraLink = (fields) =>
  ReportShareLink.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, passwordHash: 'x', expiresAt: new Date(Date.now() + 5 * DAY), isActive: true, ...fields,
  });
const reportLike = (r, extra = {}) =>
  ClientReport.create({
    organizationId: ctx.org._id, campaignId: ctx.campaign._id, seriesId: r.seriesId, weekStart: r.weekStart, weekEnd: r.weekEnd,
    timeZone: r.timeZone, rangeStartUtc: r.rangeStartUtc, rangeEndUtc: r.rangeEndUtc, status: 'published', publishedAt: new Date(), ...extra,
  });

test('Rebuild demo day points the same link at the new report — same _id, address and password — and a viewer stays signed in', { skip }, async () => {
  const demo = await theDemoLink();
  const hash = await setPassword(demo._id);
  const [report] = await shownReports();
  assert.strictEqual(String(demo.reportId), String(report._id), 'it opens the demo report');
  const access = await unlock(demo.token);
  // Beside it: a report made during a pitch with its own link from Share, and an old link to all the reports.
  const pitch = await reportLike(report);
  await extraLink({ token: 'demo-pitch-link', reportId: pitch._id, oneLinkGuard: true });
  await extraLink({ token: 'demo-board-link', label: 'Board' });

  const res = await post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const after = await theDemoLink(); // the reset took every other link with the reports
  const [fresh] = await shownReports();
  assert.ok(![String(report._id), String(pitch._id)].includes(String(fresh._id)), 'a new report');
  assert.deepStrictEqual(
    [String(after._id), after.token, after.passwordHash, after.credentialVersion, String(after.reportId), after.oneLinkGuard],
    [String(demo._id), demo.token, hash, demo.credentialVersion, String(fresh._id), true]
  );
  assert.deepStrictEqual([res.body.share.reportId, res.body.share.url, res.body.share.note], [String(fresh._id), `/r/${demo.token}`, null]);
  // The viewer who signed in before is still signed in — on the new report.
  const page = await shareCall('GET', `${demo.token}/reports/${fresh._id}`, { access });
  assert.strictEqual(page.status, 200, JSON.stringify(page.body));
  assert.deepStrictEqual((await shareCall('GET', `${demo.token}/reports`, { access })).body.reports.map((r) => r.id), [String(fresh._id)]);
});

test('which link is the demo’s: SEED_DEMO_SHARE_TOKEN, else the newest active “Client demo link”, else the newest so labelled', { skip }, async () => {
  const demo = await theDemoLink();
  const labelled = (token, fields = {}) => extraLink({ token, label: 'Client demo link', passwordHash: demo.passwordHash, ...fields });

  // A newer one that's turned off isn't it while an active one is labelled so — the reset takes it.
  await labelled('tie-off', { isActive: false });
  await seed(true);
  assert.strictEqual(String((await theDemoLink())._id), String(demo._id));

  // A newer active one is — here an old link to all the reports, so it's replaced at its own address.
  await labelled('tie-newer');
  await seed(true);
  let left = await theDemoLink();
  assert.strictEqual(left.token, 'tie-newer');
  assert.strictEqual(String(left.reportId), String((await shownReports())[0]._id));

  // SEED_DEMO_SHARE_TOKEN pins it, however new the others are.
  await labelled('tie-pinned');
  await labelled('tie-newest');
  await withEnv({ SEED_DEMO_SHARE_TOKEN: 'tie-pinned' }, async () => {
    await seed(true);
    left = await theDemoLink();
    assert.strictEqual(left.token, 'tie-pinned');
    // Given a New address in the app, it no longer matches the token, and its label still finds it.
    await ReportShareLink.updateOne({ _id: left._id }, { $set: { token: 'rotated-in-app' } });
    await seed(false);
    const rotated = await theDemoLink();
    assert.deepStrictEqual([String(rotated._id), rotated.token], [String(left._id), 'rotated-in-app']);
  });

  // None active: the newest so labelled — still the demo link, still turned off, and the log says so.
  await ReportShareLink.updateOne({ _id: left._id }, { $set: { isActive: false } });
  const lines = [];
  const summary = await seed(false, lines);
  const off = await theDemoLink();
  assert.deepStrictEqual([String(off._id), off.isActive, summary.share.isActive], [String(left._id), false, false]);
  assert.ok(lines.some((l) => /client portal: .*turned off — turn it on in Share/.test(l)), lines.join('\n'));
  await ReportShareLink.updateOne({ _id: left._id }, { $set: { isActive: true } });
});

test('the first run after the deploy replaces a link to all the reports with the report’s own link — same address, password and sealed copy; then a plain apply leaves it as it is', { skip }, async () => {
  await withEnv({ CREDENTIAL_SEAL_KEY: SEAL_KEY }, async () => {
    const demo = await theDemoLink();
    const passwordHash = await bcrypt.hash(PW, 4);
    const passwordSealed = sealLinkPassword(PW, passwordHash);
    assert.ok(passwordSealed);
    await ReportShareLink.updateOne({ _id: demo._id }, { $set: { reportId: null, passwordHash, passwordSealed }, $unset: { oneLinkGuard: 1 } });
    const access = await unlock(demo.token);

    const lines = [];
    await seed(false, lines); // nothing published: it's the run, not the reset, that replaces it
    const [report] = await shownReports();
    const after = await theDemoLink();
    assert.notStrictEqual(String(after._id), String(demo._id), 'a new link');
    assert.deepStrictEqual(
      [after.token, after.passwordHash, after.passwordSealed, after.label, String(after.reportId), after.oneLinkGuard],
      [demo.token, passwordHash, passwordSealed, 'Client demo link', String(report._id), true]
    );
    assert.strictEqual(openLinkPassword(after.passwordSealed, after.passwordHash), PW, 'Share can show the same password');
    assert.strictEqual(await ReportShareLink.exists({ campaignId: ctx.campaign._id, reportId: null }), null, 'no link to all the reports survives');
    assert.ok(lines.some((l) => /demo link replaced/.test(l)), lines.join('\n'));
    // Its viewers sign in once more, with the same password at the same address.
    assert.strictEqual((await shareCall('GET', `${demo.token}/reports/${report._id}`, { access })).status, 401);
    const again = await unlock(demo.token);
    assert.strictEqual((await shareCall('GET', `${demo.token}/reports/${report._id}`, { access: again })).status, 200);

    // From then on a plain apply leaves it as it is.
    await seed(false);
    const kept = await theDemoLink();
    const same = (l) => [String(l._id), l.token, String(l.reportId), l.passwordHash, l.passwordSealed, l.credentialVersion, l.isActive];
    assert.deepStrictEqual(same(kept), same(after));
  });
});

test('a report that already has a link made in the app keeps the demo link where it is', { skip }, async () => {
  const demo = await theDemoLink();
  const own = await ClientReport.findById(demo.reportId).lean();
  // A report made during a pitch, with its own link from Share; the demo's report taken down.
  const pitch = await reportLike(own);
  await extraLink({ token: 'demo-pitch-share', reportId: pitch._id, oneLinkGuard: true });
  await ClientReport.updateOne({ _id: own._id }, { $set: { takenDownAt: new Date() } });
  try {
    const lines = [];
    const summary = await seed(false, lines);
    assert.strictEqual(String((await ReportShareLink.findById(demo._id).lean()).reportId), String(own._id), 'it stays where it is');
    assert.match(summary.share.note, /already has a link made in the app, so the demo link stays where it is/);
    assert.ok(lines.some((l) => /client portal: .*already has a link made in the app/.test(l)), lines.join('\n'));
  } finally {
    await ReportShareLink.deleteOne({ token: 'demo-pitch-share' });
    await ClientReport.deleteOne({ _id: pitch._id });
    await ClientReport.updateOne({ _id: own._id }, { $set: { takenDownAt: null } });
  }
});

test('no shown report: the demo link isn’t touched, and the summary says so', { skip }, async () => {
  const demo = await theDemoLink();
  await ClientReport.updateMany({ campaignId: ctx.campaign._id }, { $set: { takenDownAt: new Date() } });
  try {
    const lines = [];
    const summary = await seed(false, lines);
    assert.deepStrictEqual(await theDemoLink(), demo, 'not even its expiry moved');
    assert.deepStrictEqual(
      [summary.share.url, summary.share.note, summary.report],
      [`/r/${demo.token}`, 'no report is shown, so the demo link was left as it is', null]
    );
    assert.ok(lines.some((l) => /client portal: .*no report is shown/.test(l)), lines.join('\n'));
  } finally {
    await ClientReport.updateMany({ campaignId: ctx.campaign._id }, { $set: { takenDownAt: null } });
  }
});

test('SEED_DEMO_SHARE_PASSWORD never replaces the link’s own password — and when it matches, it’s sealed so Share can show it', { skip }, async () => {
  const demo = await theDemoLink();
  const hash = await setPassword(demo._id);
  await withEnv({ CREDENTIAL_SEAL_KEY: SEAL_KEY, SEED_DEMO_SHARE_PASSWORD: 'a-different-password' }, () => seed(false));
  let after = await theDemoLink();
  assert.deepStrictEqual([after.passwordHash, after.passwordSealed], [hash, null], 'another password: the link keeps its own, nothing sealed');
  await withEnv({ CREDENTIAL_SEAL_KEY: SEAL_KEY, SEED_DEMO_SHARE_PASSWORD: PW }, async () => {
    await seed(false);
    after = await theDemoLink();
    assert.strictEqual(after.passwordHash, hash, 'the same hash');
    assert.strictEqual(openLinkPassword(after.passwordSealed, after.passwordHash), PW);
  });
});

test('no demo link password, no SEED_DEMO_SHARE_PASSWORD and no seal key: Rebuild demo day refuses before any write', { skip }, async () => {
  const demo = await theDemoLink();
  const state = async () => ({
    reports: (await ClientReport.find({ campaignId: ctx.campaign._id }, '_id').lean()).map((r) => String(r._id)).sort(),
    activities: await CanvassActivity.countDocuments({ campaignId: ctx.campaign._id }),
    assignments: await TurfAssignment.countDocuments({ campaignId: ctx.campaign._id }),
    links: (await campaignLinks()).map((l) => [String(l._id), l.passwordHash ?? null, String(l.reportId), +l.expiresAt]),
  });
  const press = () => post('/super-admin/demo/refresh-day', ctx.token, { confirm: 'rebuild' });
  await withEnv({ SEED_DEMO_SHARE_PASSWORD: undefined, CREDENTIAL_SEAL_KEY: undefined }, async () => {
    // A demo link without a password …
    await ReportShareLink.updateOne({ _id: demo._id }, { $set: { passwordHash: null, passwordSealed: null } });
    let before = await state();
    let res = await press();
    assert.deepStrictEqual([res.status, res.body.code], [409, 'SHARE_PASSWORD_UNSET'], JSON.stringify(res.body));
    assert.deepStrictEqual(await state(), before, 'nothing wiped, nothing restaged');
    // … or none at all.
    await ReportShareLink.deleteOne({ _id: demo._id });
    before = await state();
    res = await press();
    assert.deepStrictEqual([res.status, res.body.code], [409, 'SHARE_PASSWORD_UNSET']);
    assert.deepStrictEqual(await state(), before);
  });
  // With a seal key a generated password is kept where Share can show it, so there's no refusal.
  await withEnv({ SEED_DEMO_SHARE_PASSWORD: undefined, CREDENTIAL_SEAL_KEY: SEAL_KEY }, async () => {
    const res = await press();
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const made = await theDemoLink();
    const [report] = await shownReports();
    assert.deepStrictEqual([made.label, String(made.reportId), made.oneLinkGuard], ['Client demo link', String(report._id), true]);
    const pw = openLinkPassword(made.passwordSealed, made.passwordHash);
    assert.ok(pw && (await bcrypt.compare(pw, made.passwordHash)), 'its generated password can be shown');
    assert.ok(!JSON.stringify(res.body).includes(pw), 'and never crosses the API boundary');
  });
});

test('--rebuild deletes the campaign through the shared cascade, and the seed makes a new demo link on the new campaign', { skip }, async () => {
  const old = await theDemoLink();
  await withEnv({ SEED_DEMO_SHARE_TOKEN: 'demo-pinned-address', SEED_DEMO_SHARE_PASSWORD: PW }, async () => {
    const summary = await seedDemoOrg({ apply: true, rebuild: true, log: () => {} });
    const campaign = await Campaign.findOne({ organizationId: ctx.org._id, isActive: true });
    assert.notStrictEqual(String(campaign._id), String(ctx.campaign._id), 'a new campaign');
    assert.strictEqual(await ReportShareLink.exists({ _id: old._id }), null, 'the old link went with its campaign');
    const links = await ReportShareLink.find({ organizationId: ctx.org._id }).lean();
    const [report] = await ClientReport.find({ campaignId: campaign._id, status: 'published' }).lean();
    assert.deepStrictEqual(
      links.map((l) => [l.token, l.label, String(l.campaignId), String(l.reportId), l.oneLinkGuard]),
      [['demo-pinned-address', 'Client demo link', String(campaign._id), String(report._id), true]]
    );
    assert.ok(await bcrypt.compare(PW, links[0].passwordHash), 'the env password');
    assert.deepStrictEqual([summary.share.url, summary.share.reportId], ['/r/demo-pinned-address', String(report._id)]);
  });
});
