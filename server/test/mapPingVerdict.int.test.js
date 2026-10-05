import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Every ping on the admin map carries the audit's OWN far verdict (GET /admin/households/map →
// farKpiForRows → farAssessment), so a ping panel can never call far what the audit lowered or
// cleared (docs/PROPOSAL_GPS_UPGRADES.md §H.2). Five doors, one per path: a plain far, a pin a lead
// corrected after the knock (forgiven), the same pin moved by the canvasser themselves (never
// forgiven), a knock inside its own accuracy, and an honest correction. Over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/map_ping_verdict node --test test/mapPingVerdict.int.test.js
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-map-ping-verdict';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};
const WIRE_KEYS = ['meters', 'effectiveMeters', 'accuracy', 'downgraded', 'pinCorrectedMeters', 'pinCorrectedAt', 'pinDowngraded', 'pinMovedBySelf'];

// Door n sits along a street; S(n) is a stamp ~3 m north of where a corrected pin will land.
const pin = (n) => ({ lat: 38.2, lng: -85.7 + n * 0.001 });
const stamp = (n, accuracy) => ({ lat: pin(n).lat + 0.0001, lng: pin(n).lng, accuracy });

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Household, CanvassActivity, Subscription]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Ping Org', slug: 'ping-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pa@t.co', passwordHash: 'x', isActive: true });
  const gil = await User.create({ firstName: 'Gil', lastName: 'Walker', email: 'pg@t.co', passwordHash: 'x', isActive: true });
  const lee = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'pl@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: gil._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Ping C', type: 'survey', state: 'KY', isActive: true });

  const now = Date.now();
  const knockedAt = new Date(now - 60 * 60 * 1000);
  const correctedAt = new Date(now - 10 * 60 * 1000);
  const door = (n, extra = {}) => ({
    organizationId: org._id, campaignId: camp._id, addressLine1: `${n} Ping St`, city: 'Town', state: 'KY', zipCode: '40202',
    normalizedAddress: `${n} PING ST|TOWN|KY|40202`, location: { type: 'Point', coordinates: [pin(n).lng, pin(n).lat] },
    isActive: true, status: 'not_home', ...extra,
  });
  const corrected = (n, by) => ({ location: { type: 'Point', coordinates: [stamp(n).lng, stamp(n).lat - 0.00003] }, coordSource: 'corrected', correctedAt, correctedBy: by });
  const [hA, hB, hC, hD, hE] = await Household.insertMany([
    door(1), door(2, corrected(2, lee._id)), door(3, corrected(3, gil._id)), door(4), door(5),
  ]);
  const act = (h, n, distance, accuracy, extra = {}) => ({
    organizationId: org._id, campaignId: camp._id, householdId: h._id, userId: gil._id, actionType: 'not_home',
    timestamp: knockedAt, location: stamp(n, accuracy), distanceFromHouseMeters: distance, ...extra,
  });
  const nearAt = new Date(knockedAt.getTime() - 2 * 60 * 1000);
  const rows = await CanvassActivity.insertMany([
    act(hA, 1, 120, 10),
    act(hB, 2, 300, 5),
    act(hC, 3, 300, 5),
    act(hD, 4, 90, 40),
    act(hE, 5, 200, 5, { replaced: { actionType: 'not_home', timestamp: nearAt, location: stamp(5, 5), distanceFromHouseMeters: 10, nearest: { distanceFromHouseMeters: 10, accuracy: 5, timestamp: nearAt } } }),
  ]);

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, camp, adminTok: signUserToken(admin), lee, gil,
    ids: { A: String(rows[0]._id), B: String(rows[1]._id), C: String(rows[2]._id), D: String(rows[3]._id), E: String(rows[4]._id) },
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const get = async (path) => {
  const res = await fetch(`${base}/api${path}`, { headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id) } });
  assert.strictEqual(res.status, 200, path);
  return { json: await res.json(), text: '' };
};
const mapPings = async () => {
  const { json } = await get(`/admin/households/map?campaignId=${ctx.camp._id}&includeActivities=1`);
  return { json, byId: new Map(json.activities.map((a) => [a.id, a])) };
};

test('every ping\'s far verdict equals the audit\'s for the same entry', { skip }, async () => {
  const { byId } = await mapPings();
  const { json: flags } = await get(`/admin/reports/flags?campaignId=${ctx.camp._id}`);
  const auditFar = (id) => flags.entries.find((e) => e.actionId === id)?.reasons.find((r) => r.type === 'far')?.severity ?? null;
  const expected = { A: 'med', B: 'low', C: 'high', D: null, E: 'low' };
  for (const [k, id] of Object.entries(ctx.ids)) {
    const ping = byId.get(id);
    assert.ok(ping && 'far' in ping, `ping ${k} carries the verdict key`);
    assert.strictEqual(ping.far?.severity ?? null, auditFar(id), `ping ${k} agrees with the audit`);
    assert.strictEqual(ping.far?.severity ?? null, expected[k], `ping ${k}`);
  }
  assert.strictEqual(byId.get(ctx.ids.B).far.detail.pinDowngraded, true, 'a lead\'s correction forgives');
  assert.strictEqual(byId.get(ctx.ids.E).far.detail.downgraded, true, 'an honest correction is lowered');
});

test('a canvasser\'s own pin move is not forgiven on the map', { skip }, async () => {
  const { byId } = await mapPings();
  const c = byId.get(ctx.ids.C).far;
  assert.strictEqual(c.severity, 'high');
  assert.strictEqual(c.detail.pinMovedBySelf, true, 'fails if the route passes a populated userId into the far rule');
  assert.strictEqual(c.detail.pinDowngraded, undefined);
});

test('the ping wire carries no replaced snapshot and no staff id', { skip }, async () => {
  const { json } = await mapPings();
  for (const a of json.activities) {
    assert.ok(!('replaced' in a), 'the snapshot is read server-side only');
    for (const key of Object.keys(a.far?.detail || {})) assert.ok(WIRE_KEYS.includes(key), `unexpected far.detail key ${key}`);
  }
  const text = JSON.stringify(json);
  assert.ok(!text.includes('correctedBy'), 'no correctedBy anywhere in the response');
  assert.ok(!text.includes(String(ctx.lee._id)), 'the correcting lead\'s id never ships');
});

test('a ping inside its own accuracy is far: null', { skip }, async () => {
  const { byId } = await mapPings();
  assert.strictEqual(byId.get(ctx.ids.D).far, null, '90 m at ±40 m leaves 50 m, inside FAR_WARN_M');
});
