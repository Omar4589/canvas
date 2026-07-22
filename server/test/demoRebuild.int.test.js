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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-demo-rebuild';

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
const { DEMO_ORG_SLUG } = await import('../src/utils/demoData/namePools.js');

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
