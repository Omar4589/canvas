import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Remove apartments over the REAL Express app + throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/aptstacks node --test test/apartmentStacks.int.test.js
//
// One rule (services/turf/apartmentStacks.js, docs/PROPOSAL_PLACEHOLDER_PINS.md §H): at threshold N a
// door is taken when N or more doors on its map spot share its street address, or when its address
// names a unit and its spot holds N or more doors. Proves: the preview GET's shape (parallel arrays);
// counting the preview at N gives exactly what the POST at N takes; separate houses a vendor stamped
// with one shared coordinate (the Nye "Monte Penne" case) are never taken at any threshold; the
// population is the pass's effort's active, located doors; the threshold clamps to 2; Re-include
// clears the marks.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-apt-stacks';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Household } = await import('../src/models/Household.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Four spots in Pahrump, NV, plus a lone house. Each spot is one exact coordinate (5-decimal key).
const TOWER = [-116.0101, 36.2101]; // 5 units of one street address
const MONTE = [-116.0201, 36.2201]; // 6 separate houses, one coordinate (vendor placeholder)
const MIXED = [-116.0301, 36.2301]; // 2 unit-addressed doors + 4 separate houses
const DUPLEX = [-116.0401, 36.2401]; // one street address written twice, no unit
const LONE = [-116.0501, 36.2501];

const door = (orgId, campaignId, effortId, line1, coords, extra = {}) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: line1,
  city: 'Pahrump',
  state: 'NV',
  zipCode: '89061',
  normalizedAddress: [line1, extra.addressLine2, 'PAHRUMP', 'NV', '89061'].filter(Boolean).join('|').toUpperCase(),
  location: { type: 'Point', coordinates: coords },
  coordSource: 'file',
  isActive: true,
  ...extra,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, Effort, Pass, Household, Subscription]) await M.deleteMany({});

  const org = await Organization.create({ name: 'Apt Org', slug: 'apt-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'apt@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const C = await Campaign.create({ organizationId: org._id, name: 'Nye', type: 'survey', state: 'NV', isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: C._id, name: 'E' });
  const other = await Effort.create({ organizationId: org._id, campaignId: C._id, name: 'Other' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: C._id, effortId: effort._id, roundNumber: 1, name: 'R1',
    status: 'active', activatedAt: new Date(),
  });

  const d = (line1, coords, extra) => door(org._id, C._id, effort._id, line1, coords, extra);
  const tower = await Household.insertMany([1, 2, 3, 4, 5].map((n) => d(`100 Main St Apt ${n}`, TOWER)));
  const monte = await Household.insertMany(
    ['5016', '5021', '5030', '5044', '5052', '5060'].map((n) => d(`${n} E Monte Penne Way`, MONTE))
  );
  const mixedUnits = await Household.insertMany([
    d('200 Oak Ave', MIXED, { addressLine2: 'Unit A' }),
    d('200 Oak Ave #B', MIXED),
  ]);
  const mixedHouses = await Household.insertMany(['210', '220', '230', '240'].map((n) => d(`${n} Oak Ave`, MIXED)));
  const duplex = await Household.insertMany([d('300 Elm St', DUPLEX), d('300 Elm Street', DUPLEX)]);
  const lone = await Household.create(d('400 Pine Rd', LONE));
  // Outside the population: an inactive unit on the tower, and a unit of the tower in another effort.
  const inactive = await Household.create(d('100 Main St Apt 6', TOWER, { isActive: false }));
  const otherEffort = await Household.create(door(org._id, C._id, other._id, '100 Main St Apt 7', TOWER));

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, {
    org, C, pass, tower, monte, mixedUnits, mixedHouses, duplex, lone, inactive, otherEffort,
    tok: signUserToken(admin),
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (method, path, body) => {
  const res = await fetch(`${base}/api/admin/campaigns/${ctx.C._id}/turfs${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.tok}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const ids = (docs) => docs.map((h) => String(h._id));
const preview = async () => (await call('GET', `/apartment-preview?passId=${ctx.pass._id}`)).body.candidates;
// What the page computes from the preview at threshold n.
const countAt = (c, n) => {
  const taken = c.ids.filter((_, i) => c.takenUpTo[i] >= n);
  return { ids: new Set(taken), spots: new Set(c.spot.filter((_, i) => c.takenUpTo[i] >= n)).size };
};
const excludedIds = async () =>
  new Set((await Household.find({ campaignId: ctx.C._id, excludedFromTurf: true }, { _id: 1 }).lean()).map((h) => String(h._id)));

test('preview: parallel arrays, one entry per door some threshold takes, and nothing else', { skip }, async () => {
  const c = await preview();
  assert.equal(c.ids.length, c.takenUpTo.length);
  assert.equal(c.ids.length, c.spot.length);
  const byId = new Map(c.ids.map((id, i) => [id, c.takenUpTo[i]]));
  for (const id of ids(ctx.tower)) assert.equal(byId.get(id), 5, 'a unit of the 5-unit address');
  for (const id of ids(ctx.mixedUnits)) assert.equal(byId.get(id), 6, 'a unit address on a spot of 6');
  for (const id of ids(ctx.duplex)) assert.equal(byId.get(id), 2, 'two records of one street address');
  // Never candidates: separate houses on a shared coordinate, a lone house, an inactive door, another effort.
  for (const id of [...ids(ctx.monte), ...ids(ctx.mixedHouses), String(ctx.lone._id), String(ctx.inactive._id), String(ctx.otherEffort._id)]) {
    assert.equal(byId.has(id), false, `unexpected candidate ${id}`);
  }
  assert.equal(c.ids.length, 5 + 2 + 2);
  // Spots number the map spots within the response: three spots hold candidates.
  assert.equal(new Set(c.spot).size, 3);
});

test('the POST at N takes exactly what the preview counts at N', { skip }, async () => {
  const c = await preview();
  for (const n of [6, 4, 2]) {
    await call('POST', '/include-apartments', { passId: String(ctx.pass._id) });
    const want = countAt(c, n);
    const res = await call('POST', '/exclude-apartments', { passId: String(ctx.pass._id), threshold: n });
    assert.equal(res.status, 200);
    assert.equal(res.body.excluded, want.ids.size, `count at ${n}`);
    assert.equal(res.body.buildings, want.spots, `spots at ${n}`);
    assert.deepEqual(await excludedIds(), want.ids, `ids at ${n}`);
  }
  // At 4: the tower and the mixed spot's two units, not the duplex.
  assert.equal(countAt(c, 4).ids.size, 7);
  assert.equal(countAt(c, 4).spots, 2);
});

test('separate houses on one shared coordinate are never taken, at any threshold', { skip }, async () => {
  await call('POST', '/include-apartments', { passId: String(ctx.pass._id) });
  // threshold 1 clamps to 2, the loosest the rule allows.
  const res = await call('POST', '/exclude-apartments', { passId: String(ctx.pass._id), threshold: 1 });
  assert.equal(res.body.excluded, 9);
  const marked = await excludedIds();
  for (const id of [...ids(ctx.monte), ...ids(ctx.mixedHouses), String(ctx.lone._id)]) assert.equal(marked.has(id), false);
});

test('Re-include clears every mark the button set', { skip }, async () => {
  const res = await call('POST', '/include-apartments', { passId: String(ctx.pass._id) });
  assert.equal(res.status, 200);
  assert.equal((await excludedIds()).size, 0);
});

test('preview refuses a missing or foreign pass', { skip }, async () => {
  assert.equal((await call('GET', '/apartment-preview')).status, 400);
  assert.equal((await call('GET', `/apartment-preview?passId=${new mongoose.Types.ObjectId()}`)).status, 404);
});
