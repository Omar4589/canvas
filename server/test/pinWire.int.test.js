import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// The pin facts every map and phone payload ships (placeholder pins, release 2), over the REAL Express app:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/pinwire node --test test/pinWire.int.test.js
//
// One helper (services/households/pinState.js pinWireFields) and one phone projection decide what leaves the
// server. Proves: `pinSuspect` ships only while a door is unplaced now (a vouched home never reaches a client
// flagged) on the admin map, the Turf doors, the Turf drill, the phone bootstrap and every /changes door;
// `pinPlaced` ships only while the address lookup's placement stands, with `inPlace` and `stackSize`; the door
// activity route's `sameAddress` counts the units of the door's street address on its pin (the set a
// scope:'building' move carries) and says whether any is unplaced; a door with no shared-spot facts ships none.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pin-wire';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { Household } = await import('../src/models/Household.js');
const { Subscription } = await import('../src/models/Subscription.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Pahrump, NV. S: a vendor's shared spot. B: a real building. Each other door has its own spot.
const S = [-116.0201, 36.2201];
const B = [-116.0301, 36.2301];
const PLACED_AT = new Date('2026-10-05T18:30:00Z');

const door = (orgId, campaignId, effortId, line1, coords, extra = {}) => ({
  organizationId: orgId,
  campaignId,
  effortId,
  addressLine1: line1,
  city: 'Pahrump',
  state: 'NV',
  zipCode: '89061',
  normalizedAddress: `${line1.toUpperCase()}|PAHRUMP|NV|89061`,
  location: { type: 'Point', coordinates: coords },
  coordSource: 'file',
  isActive: true,
  status: 'unknocked',
  ...extra,
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, User, Membership, Campaign, CampaignAssignment, Effort, Pass, Turf, TurfAssignment, Household, Subscription]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Wire Org', slug: 'wire-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'wa@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Canvasser', email: 'wc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Nye', type: 'survey', state: 'NV', isActive: true });
  await CampaignAssignment.create({ organizationId: org._id, campaignId: camp._id, userId: canv._id });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'E' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date(),
  });

  const d = (line1, coords, extra) => door(org._id, camp._id, effort._id, line1, coords, extra);
  const docs = await Household.insertMany([
    d('10 Pine St', S, { pinSuspect: 'placeholder' }),
    d('12 Pine St', S, { pinSuspect: 'stray' }),
    // Vouched: still carries the flag under the stamp, so Undo restores it — but never ships flagged.
    d('14 Pine St', S, { pinSuspect: 'placeholder', locationConfirmedAt: new Date(), locationConfirmedBy: admin._id }),
    d('100 Main St Apt 1', B),
    d('100 Main St Apt 2', B),
    d('100 Main St Apt 3', B, { pinSuspect: 'placeholder' }),
    d('7 Other Rd', B), // a different address on the building's spot: never counted with its units
    // Placed by the lookup off S, its old spot shared with two other homes.
    d('20 Oak St', [-116.0101, 36.2101], {
      coordSource: 'geocodio', coordConfidence: 'exact',
      pinPlacement: { from: S, to: [-116.0101, 36.2101], at: PLACED_AT, kind: 'placeholder', by: 'lookup', accuracyType: 'rooftop', stackSize: 2 },
    }),
    // The lookup found it on the spot it already had.
    d('30 Elm St', [-116.0401, 36.2401], {
      coordSource: 'geocodio', coordConfidence: 'exact',
      pinPlacement: { from: [-116.0401, 36.2401], to: [-116.0401, 36.2401], at: PLACED_AT, kind: 'placeholder', by: 'lookup', accuracyType: 'rooftop', stackSize: 1 },
    }),
    // Placed, then a person moved it: the placement no longer stands.
    d('40 Ash St', [-116.0501, 36.2501], {
      coordSource: 'corrected', correctedAt: new Date(),
      pinPlacement: { from: S, to: [-116.0502, 36.2502], at: PLACED_AT, kind: 'placeholder', by: 'lookup', accuracyType: 'rooftop', stackSize: 2 },
    }),
    d('50 Lone Way', [-116.0601, 36.2601]),
  ]);
  const byLine = new Map(docs.map((h) => [h.addressLine1, h]));
  const turf = await Turf.create({
    organizationId: org._id, campaignId: camp._id, passId: pass._id, name: 'Book 1', mode: 'geometric',
    status: 'published', householdIds: docs.map((h) => h._id), doorCount: docs.length,
  });
  await Household.updateMany({ _id: { $in: docs.map((h) => h._id) } }, { $set: { turfId: turf._id } });
  await TurfAssignment.create({ organizationId: org._id, campaignId: camp._id, passId: pass._id, turfId: turf._id, userId: canv._id });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  Object.assign(ctx, { org, camp, pass, byLine, adminTok: signUserToken(admin), canvTok: signUserToken(canv) });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

const call = async (path, token) => {
  const res = await fetch(`${base}/api${path}`, { headers: { Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) } });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const idOf = (line) => String(ctx.byLine.get(line)._id);

// The facts each fixture door must ship, and nothing else.
const expectFacts = (row, line, where) => {
  const flagged = { '10 Pine St': 'placeholder', '12 Pine St': 'stray', '100 Main St Apt 3': 'placeholder' };
  assert.equal(row.pinSuspect, flagged[line], `${where}: ${line} pinSuspect`);
  if (!flagged[line]) assert.equal('pinSuspect' in row, false, `${where}: ${line} ships no flag`);
};

test('admin map rows: the flag only while unplaced, the placement only while it stands', { skip }, async () => {
  const res = await call(`/admin/households/map?campaignId=${ctx.camp._id}`, ctx.adminTok);
  assert.equal(res.status, 200);
  const rows = new Map(res.body.households.map((h) => [h.addressLine1, h]));
  for (const line of ctx.byLine.keys()) expectFacts(rows.get(line), line, 'map');
  assert.deepStrictEqual(rows.get('20 Oak St').pinPlaced, { at: PLACED_AT.toISOString(), inPlace: false, stackSize: 2 });
  assert.deepStrictEqual(rows.get('30 Elm St').pinPlaced, { at: PLACED_AT.toISOString(), inPlace: true, stackSize: 1 });
  assert.equal('pinPlaced' in rows.get('40 Ash St'), false, 'a person moved it since');
  assert.equal('pinPlaced' in rows.get('50 Lone Way'), false);
  assert.equal('pinPlacement' in rows.get('20 Oak St'), false, 'the raw record never ships');
});

test('activity: sameAddress counts the units of the door\'s street address on its pin', { skip }, async () => {
  const unit = await call(`/admin/households/${idOf('100 Main St Apt 1')}/activity`, ctx.adminTok);
  assert.equal(unit.status, 200);
  assert.deepStrictEqual(unit.body.sameAddress, { count: 3, unplaced: true }, 'three units, one unplaced; 7 Other Rd is not one of them');
  const other = await call(`/admin/households/${idOf('7 Other Rd')}/activity`, ctx.adminTok);
  assert.deepStrictEqual(other.body.sameAddress, { count: 1, unplaced: false });
  const house = await call(`/admin/households/${idOf('10 Pine St')}/activity`, ctx.adminTok);
  assert.deepStrictEqual(house.body.sameAddress, { count: 1, unplaced: true }, 'separate homes on one spot are not one address');
});

test('Turf doors and the drill carry the same facts', { skip }, async () => {
  const doors = await call(`/admin/campaigns/${ctx.camp._id}/turfs/doors?passId=${ctx.pass._id}`, ctx.adminTok);
  assert.equal(doors.status, 200);
  const rows = new Map(doors.body.doors.map((d) => [d.addressLine1, d]));
  for (const line of ctx.byLine.keys()) expectFacts(rows.get(line), line, 'turf doors');
  const drill = await call(`/admin/campaigns/${ctx.camp._id}/turfs/household/${idOf('20 Oak St')}`, ctx.adminTok);
  assert.equal(drill.status, 200);
  assert.deepStrictEqual(drill.body.household.pinPlaced, { at: PLACED_AT.toISOString(), inPlace: false, stackSize: 2 });
  const flagged = await call(`/admin/campaigns/${ctx.camp._id}/turfs/household/${idOf('12 Pine St')}`, ctx.adminTok);
  assert.equal(flagged.body.household.pinSuspect, 'stray');
});

test('phone bootstrap and /changes: the effective flag, and its absence once a person fixes the pin', { skip }, async () => {
  const boot = await call(`/mobile/bootstrap?campaignId=${ctx.camp._id}`, ctx.canvTok);
  assert.equal(boot.status, 200);
  const rows = new Map(boot.body.households.map((h) => [h.addressLine1, h]));
  for (const line of ctx.byLine.keys()) expectFacts(rows.get(line), line, 'bootstrap');

  const since = new Date(Date.now() - 1000).toISOString();
  // A lead fixes 10 Pine St's pin: no round state changes, only the door — the delta must still say the
  // flag is gone (by leaving the field out).
  const moved = await fetch(`${base}/api/admin/campaigns/${ctx.camp._id}/households/${idOf('10 Pine St')}/location`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${ctx.adminTok}`, 'X-Org-Id': String(ctx.org._id), 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 36.2701, lng: -116.0701 }),
  });
  assert.equal(moved.status, 200);
  await Household.updateOne({ _id: ctx.byLine.get('12 Pine St')._id }, { $set: { pinSuspect: 'placeholder' } });
  const delta = await call(`/mobile/changes?campaignId=${ctx.camp._id}&since=${encodeURIComponent(since)}`, ctx.canvTok);
  assert.equal(delta.status, 200);
  const changed = new Map(delta.body.households.map((h) => [String(h._id), h]));
  const fixed = changed.get(idOf('10 Pine St'));
  assert.ok(fixed, 'the fixed door is in the delta');
  assert.equal('pinSuspect' in fixed, false, 'cleared');
  assert.deepStrictEqual(fixed.location.coordinates, [-116.0701, 36.2701]);
  assert.equal(changed.get(idOf('12 Pine St')).pinSuspect, 'placeholder', 'a re-flagged door carries its new flag');
});
