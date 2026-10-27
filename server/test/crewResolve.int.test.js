import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// The Team page's "who owns this email?" lookup (POST .../crew/resolve): its two limits per person —
// 60 an hour for lookups that find nobody, 30 for lookups that name somebody (owner ruling 2026-10-26)
// — and what a named answer carries.
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/resolve node --import ./scripts/testIndexPreload.mjs --test test/crewResolve.int.test.js
//
// The limiters keep their counts in memory per process, keyed on the person looking up, so each test
// uses its own looker.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-crew-resolve';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { OUTSIDE_LOOKUPS_PER_HOUR, NAMED_LOOKUPS_PER_HOUR } = await import('../src/middleware/crewResolveLimit.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const { ObjectId } = mongoose.Types;

let server;
let base;
const ctx = {};
let seq = 0;

const mkPerson = async (first, role = 'canvasser', orgId = ctx.org._id) => {
  const u = await User.create({ firstName: first, lastName: `R${++seq}`, email: `${first.toLowerCase()}${seq}@resolve.t.co`, passwordHash: 'x', isActive: true });
  await Membership.create({ userId: u._id, organizationId: orgId, role, isActive: true });
  return u;
};
const lookup = async (looker, email) => {
  const res = await fetch(`${base}/api/admin/campaigns/${ctx.camp._id}/crew/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signUserToken(looker)}`, 'X-Org-Id': String(ctx.org._id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return { status: res.status, text: await res.text() };
};

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await mongoose.connection.db.dropDatabase();
  ctx.org = await Organization.create({ name: 'Resolve Org', slug: 'resolve-org', isActive: true });
  await Subscription.create({ organizationId: ctx.org._id, status: 'active' });
  ctx.camp = await Campaign.create({ organizationId: ctx.org._id, name: 'Spring', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' });
  ctx.colleague = await mkPerson('Colleague');
  ctx.dana = await mkPerson('Dana', 'lead');
  server = (await import('node:http')).createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('lookups that find nobody: 60 an hour; the next one waits, and says how long', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  for (let i = 0; i < OUTSIDE_LOOKUPS_PER_HOUR; i++) {
    const r = await lookup(looker, `nobody${i}@nowhere.t.co`);
    assert.strictEqual(r.status, 200, `lookup ${i + 1}`);
  }
  const over = await lookup(looker, 'one-more@nowhere.t.co');
  assert.strictEqual(over.status, 429);
  const body = JSON.parse(over.text);
  assert.strictEqual(body.code, 'rate-limited');
  assert.ok(body.retryAfterSeconds > 3000 && body.retryAfterSeconds <= 3600, String(body.retryAfterSeconds));
  const named = await lookup(looker, ctx.colleague.email);
  assert.strictEqual(named.status, 429, 'once either limit is reached, every lookup waits');
});

test('lookups that name somebody: 30 an hour, then every lookup waits — refusing only named ones would say who is here', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  for (let i = 0; i < NAMED_LOOKUPS_PER_HOUR; i++) {
    const r = await lookup(looker, ctx.colleague.email);
    assert.strictEqual(r.status, 200, `named lookup ${i + 1}`);
  }
  assert.strictEqual((await lookup(looker, ctx.colleague.email)).status, 429);
  assert.strictEqual((await lookup(looker, 'stranger@nowhere.t.co')).status, 429);
});

test('a mistyped address counts toward neither limit', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  for (let i = 0; i < NAMED_LOOKUPS_PER_HOUR + 5; i++) {
    const r = await lookup(looker, 'not-an-email');
    assert.strictEqual(r.status, 400);
  }
  assert.strictEqual((await lookup(looker, ctx.colleague.email)).status, 200);
});

test('the answer for an address outside the organization is byte-identical whether or not it has an account elsewhere', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  const elsewhere = await Organization.create({ name: 'Elsewhere', slug: 'resolve-elsewhere', isActive: true });
  const stranger = await mkPerson('Stranger', 'canvasser', elsewhere._id);
  const a = await lookup(looker, stranger.email);
  const b = await lookup(looker, 'never-seen@nowhere.t.co');
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.text, b.text);
  assert.strictEqual(a.text, JSON.stringify({ outcome: 'outside', person: null }));
});

test('a named answer carries this campaign\'s history, newest team first, and whether its coordinator can still lead', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  const pat = await mkPerson('Pat');
  const old = await mkPerson('Old', 'lead');
  await Membership.updateOne({ userId: old._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const at = (d) => new Date(`2026-10-${d}T15:00:00Z`);
  const row = (coordinatorId, when) => ({
    _id: new ObjectId(), organizationId: ctx.org._id, campaignId: ctx.camp._id, passId: new ObjectId(), householdId: new ObjectId(),
    userId: pat._id, coordinatorId, actionType: 'not_home', location: { lat: 28, lng: -81 }, timestamp: when, createdAt: when, updatedAt: when,
  });
  await CanvassActivity.collection.insertMany([row(old._id, at('01')), row(old._id, at('02')), row(ctx.dana._id, at('09')), { ...row(ctx.dana._id, at('09')), via: 'bulk' }]);
  const r = await lookup(looker, pat.email);
  assert.strictEqual(r.status, 200);
  const body = JSON.parse(r.text);
  assert.strictEqual(body.outcome, 'in-org');
  assert.strictEqual(body.history.doors, 3, 'desk marks left out');
  assert.deepStrictEqual(body.history.sources.map((s) => [s.coordinatorId, s.doors, s.canLead]), [
    [String(ctx.dana._id), 1, true],
    [String(old._id), 2, false],
  ]);
});

test('a switched-off person says whether they are already on this campaign', { skip }, async () => {
  const looker = await mkPerson('Looker', 'admin');
  const pat = await mkPerson('Pat');
  await Membership.updateOne({ userId: pat._id, organizationId: ctx.org._id }, { $set: { isActive: false } });
  const off = JSON.parse((await lookup(looker, pat.email)).text);
  assert.deepStrictEqual([off.outcome, off.onCampaign], ['in-org-inactive', false]);
  await CampaignAssignment.create({ campaignId: ctx.camp._id, userId: pat._id, organizationId: ctx.org._id });
  const on = JSON.parse((await lookup(looker, pat.email)).text);
  assert.deepStrictEqual([on.outcome, on.onCampaign], ['in-org-inactive', true]);
});
