import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Homes on a shared map spot, through the REAL Express app + throwaway mongod:
//   cd server && npm run test:int -- test/placeholderPinWriters.int.test.js
// Locks (docs/PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md): Pin Fixes lists unplaced homes and the badge
// counts them; Looks right vouches for one (keeping the flag under the stamp) and Undo restores it; a
// confirm refuses a pin that changed since the page loaded (409 PIN_CHANGED, before the eligibility
// guard); a save onto an unplaced home's own pin, a no-drag "Whole building" beside a flagged unit, and
// a save back onto the spot a placed home left all move nothing (moved: 0, flag kept) — but a home
// placed in place can be dragged back; building Undo restores only the units its confirm stamped;
// Remove apartments' preview counts are what the button takes, and separate houses on one spot are
// never taken; the pass's lookup counters never reach organizations.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-placeholder-writers';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { Organization } = await import('../src/models/Organization.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { ImportJob } = await import('../src/models/ImportJob.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

let server;
let base;
const ctx = {};

// Pahrump, NV. S is a vendor's shared spot; P a placed home's rooftop.
const S = [-115.95, 36.21];
const P = [-115.94, 36.215];
const far = (c, d = 0.001) => ({ lng: c[0] + d, lat: c[1] + d }); // ~140 m off

const home = (n, coords, extra = {}) => ({
  organizationId: ctx.org._id,
  campaignId: ctx.camp._id,
  effortId: ctx.effort._id,
  addressLine1: extra.addressLine1 || `${n} E Monte Penne Way`,
  city: 'Pahrump',
  state: 'NV',
  zipCode: '89061',
  normalizedAddress: `${extra.addressLine1 || `${n} E MONTE PENNE WAY`}|PAHRUMP|NV|89061`.toUpperCase(),
  location: { type: 'Point', coordinates: coords },
  coordSource: 'file',
  isActive: true,
  status: 'unknocked',
  ...extra,
});

async function call(method, path, { body, token = ctx.adminTok } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Org-Id': String(ctx.org._id) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}
const hhPath = (id, tail) => `/admin/campaigns/${ctx.camp._id}/households/${id}/${tail}`;
const patchPin = (id, point, scope = 'unit') => call('PATCH', hhPath(id, 'location'), { body: { ...point, scope } });
const postPin = (id, point, scope = 'unit') => call('POST', `/mobile/households/${id}/location`, { body: { ...point, scope, source: 'drag', accuracy: 5 } });
const confirm = (id, body = {}) => call('POST', hhPath(id, 'confirm-location'), { body });
const queue = () => call('GET', `/admin/campaigns/${ctx.camp._id}/households/pin-fixes`);
const doc = (id) => Household.findById(id).lean();

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await Household.syncIndexes();
  for (const M of [Organization, User, Membership, Campaign, Household, HouseholdLocationChange, Subscription, Effort, Pass, ImportJob]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Writers Org', slug: 'writers-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'pw@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  const camp = await Campaign.create({ organizationId: org._id, name: 'Writers C', type: 'survey', state: 'NV', isActive: true });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'All' });
  const pass = await Pass.create({ organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active' });
  Object.assign(ctx, { org, admin, camp, effort, pass, adminTok: signUserToken(admin) });

  const app = createApp();
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

test('1. Pin Fixes lists homes without an exact spot, with their flag; the badge counts them', { skip }, async () => {
  const [a, b, vouched] = await Household.insertMany([
    home(5001, S, { pinSuspect: 'placeholder' }),
    home(5011, S, { pinSuspect: 'placeholder' }),
    home(5016, S, { pinSuspect: 'placeholder', locationConfirmedAt: new Date(), locationConfirmedBy: ctx.admin._id }),
  ]);
  Object.assign(ctx, { a, b, vouched });
  const q = await queue();
  assert.strictEqual(q.status, 200);
  assert.deepStrictEqual(q.json.households.map((h) => h.id).sort(), [a._id, b._id].map(String).sort(), 'the vouched home is out');
  assert.ok(q.json.households.every((h) => h.pinSuspect === 'placeholder'));
  const r = await call('GET', '/admin/campaigns');
  assert.strictEqual(r.json.campaigns.find((c) => String(c._id) === String(ctx.camp._id)).pinsToFix, 2);
});

test('2. a save onto an unplaced home\'s own pin moves nothing, on the web and the phone', { skip }, async () => {
  const onTheSpot = { lng: S[0] + 0.000001, lat: S[1] }; // ~0.1 m: a tap, not a drag
  for (const send of [patchPin, postPin]) {
    const r = await send(ctx.a._id, onTheSpot);
    assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.json));
    assert.strictEqual(r.json.moved, 0);
    assert.strictEqual(r.json.household.pinSuspect, 'placeholder', 'still flagged');
  }
  const d = await doc(ctx.a._id);
  assert.strictEqual(d.coordSource, 'file');
  assert.strictEqual(d.pinSuspect, 'placeholder');
  assert.strictEqual(await HouseholdLocationChange.countDocuments({ householdId: ctx.a._id }), 0, 'no audit row for nothing');
});

test('3. a real move clears the flag in the same write and records the spot it left', { skip }, async () => {
  const r = await patchPin(ctx.a._id, far(S));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.moved, 1);
  assert.strictEqual(r.json.household.pinSuspect, undefined);
  const d = await doc(ctx.a._id);
  assert.strictEqual(d.coordSource, 'corrected');
  assert.strictEqual(d.pinSuspect, undefined);
  assert.strictEqual(d.pinPlacement.by, 'person');
  assert.deepStrictEqual(d.pinPlacement.from, S);
  assert.strictEqual(String(d.correctedBy), String(ctx.admin._id), 'cast to an ObjectId');
});

test('4. Looks right vouches for an unplaced home and keeps its flag under the stamp; Undo restores it', { skip }, async () => {
  const r = await confirm(ctx.b._id, { expectedCoordinates: S });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.updated, 1);
  let d = await doc(ctx.b._id);
  assert.ok(d.locationConfirmedAt);
  assert.strictEqual(d.pinSuspect, 'placeholder', 'kept under the vouch');
  assert.strictEqual((await queue()).json.total, 0);
  const u = await confirm(ctx.b._id, { confirmed: false });
  assert.strictEqual(u.json.updated, 1);
  d = await doc(ctx.b._id);
  assert.strictEqual(d.locationConfirmedAt, null);
  assert.strictEqual((await queue()).json.total, 1, 'back in the queue');
});

test('5. a confirm of a pin that changed since the page loaded is refused, before the eligibility guard', { skip }, async () => {
  // Placed by address after the page loaded: no longer flagged, no longer on S.
  const placed = await Household.create(
    home(5021, P, { coordSource: 'geocodio', coordConfidence: 'exact', pinPlacement: { from: S, to: P, at: new Date(), kind: 'placeholder', by: 'lookup' } })
  );
  const r = await confirm(placed._id, { expectedCoordinates: S });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.json.code, 'PIN_CHANGED');
  assert.strictEqual((await doc(placed._id)).locationConfirmedAt, null);
  ctx.placed = placed;
});

test('6. a save back onto the spot a placed home left moves nothing; one placed in place can be dragged back', { skip }, async () => {
  const r = await postPin(ctx.placed._id, { lng: S[0], lat: S[1] });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.json.moved, 0, 'an old phone\'s stale save does not put it back on the shared spot');
  assert.deepStrictEqual((await doc(ctx.placed._id)).location.coordinates, P);

  // Placed in place (from and to on one key), moved away by a lead, then dragged back onto its rooftop.
  const inPlace = await Household.create(
    home(5031, [S[0] + 0.03, S[1]], { coordSource: 'corrected', pinPlacement: { from: [S[0] + 0.02, S[1]], to: [S[0] + 0.020001, S[1]], at: new Date(), kind: 'placeholder', by: 'lookup' } })
  );
  const back = await patchPin(inPlace._id, { lng: S[0] + 0.02, lat: S[1] });
  assert.strictEqual(back.json.moved, 1, 'its `from` is the verified house');
});

test('7. a no-drag "Whole building" beside a flagged unit moves nothing; a real one moves only that address', { skip }, async () => {
  const B = [-115.96, 36.22];
  const [u1, u2, other] = await Household.insertMany([
    home(0, B, { addressLine1: '100 Main St Apt 1' }),
    home(0, B, { addressLine1: '100 Main St Apt 2', pinSuspect: 'placeholder' }),
    home(0, B, { addressLine1: '102 Main St', pinSuspect: 'placeholder' }),
  ]);
  const noDrag = await patchPin(u1._id, { lng: B[0], lat: B[1] }, 'building');
  assert.strictEqual(noDrag.json.moved, 0);
  assert.strictEqual((await doc(u2._id)).coordSource, 'file', 'the flagged unit was not carried onto the spot as hand-corrected');
  const real = await patchPin(u1._id, far(B), 'building');
  assert.strictEqual(real.json.moved, 2);
  assert.strictEqual((await doc(u2._id)).coordSource, 'corrected');
  assert.deepStrictEqual((await doc(other._id)).location.coordinates, B, 'another street address stays put');
});

test('8. building Undo restores only the units its own confirm stamped', { skip }, async () => {
  const C = [-115.97, 36.23];
  const separately = new Date(Date.now() - 60_000);
  const [x1, x2, x3] = await Household.insertMany([
    home(0, C, { addressLine1: '200 Oak St Apt 1', pinSuspect: 'placeholder' }),
    home(0, C, { addressLine1: '200 Oak St Apt 2', pinSuspect: 'placeholder' }),
    home(0, C, { addressLine1: '200 Oak St Apt 3', pinSuspect: 'placeholder', locationConfirmedAt: separately, locationConfirmedBy: ctx.admin._id }),
  ]);
  const r = await confirm(x1._id, { scope: 'building' });
  assert.strictEqual(r.json.updated, 2, 'x1 and x2; x3 was already vouched');
  const u = await confirm(x1._id, { scope: 'building', confirmed: false });
  assert.strictEqual(u.json.updated, 2);
  assert.strictEqual((await doc(x2._id)).locationConfirmedAt, null);
  assert.strictEqual(+(await doc(x3._id)).locationConfirmedAt, +separately, 'vouched separately: stays vouched');
});

test('9. Remove apartments takes real apartments only, and the preview counts what the button takes', { skip }, async () => {
  const T = [-115.98, 36.24];
  const M = [-115.99, 36.25];
  await Household.insertMany([
    ...[1, 2, 3, 4].map((n) => home(0, T, { addressLine1: `300 Elm St Apt ${n}` })), // a 4-unit building
    ...['4906', '4908', '4910', '4912', '4914'].map((n) => home(0, M, { addressLine1: `${n} E Monte Penne Way` })), // 5 houses, one spot
  ]);
  const prev = await call('GET', `/admin/campaigns/${ctx.camp._id}/turfs/apartment-preview?passId=${ctx.pass._id}`);
  assert.strictEqual(prev.status, 200, JSON.stringify(prev.json));
  const { ids, takenUpTo, spot } = prev.json.candidates;
  const at4 = ids.filter((_, i) => takenUpTo[i] >= 4);
  const spots4 = new Set(spot.filter((_, i) => takenUpTo[i] >= 4));
  const post = await call('POST', `/admin/campaigns/${ctx.camp._id}/turfs/exclude-apartments`, { body: { passId: String(ctx.pass._id), threshold: 4 } });
  assert.strictEqual(post.status, 200);
  assert.strictEqual(post.json.excluded, at4.length, 'the preview counted what the button took');
  assert.strictEqual(post.json.buildings, spots4.size);
  const houses = await Household.find({ campaignId: ctx.camp._id, addressLine1: /Monte Penne/, 'location.coordinates': M }).lean();
  assert.strictEqual(houses.length, 5);
  assert.ok(houses.every((h) => !h.excludedFromTurf), 'separate houses are never held out for sharing a spot');
  const units = await Household.find({ campaignId: ctx.camp._id, addressLine1: /^300 Elm St Apt/ }).lean();
  assert.ok(units.every((h) => h.excludedFromTurf), 'the building is');
});

test('10. the lookup counters and the probed-id ledger never reach an organization', { skip }, async () => {
  const job = await ImportJob.create({
    organizationId: ctx.org._id,
    campaignId: ctx.camp._id,
    filename: 'hidden.csv',
    kind: 'apply',
    status: 'completed',
    pinLookupsNew: 7,
    pinLookupsCached: 3,
    pinLookupsOverCap: 1,
    pinProbedIds: ['x'],
    pinPassCause: 'HTTP 401',
    pinPassError: "Map pins weren't checked this time. Import the file again to try again.",
  });
  const hidden = ['pinLookupsNew', 'pinLookupsCached', 'pinLookupsOverCap', 'pinProbedIds', 'pinPassCause'];
  const list = await call('GET', `/admin/imports?campaignId=${ctx.camp._id}`);
  const row = list.json.jobs.find((j) => String(j._id) === String(job._id));
  const detail = await call('GET', `/admin/imports/${job._id}`);
  const cancel = await call('POST', `/admin/imports/${job._id}/cancel`);
  for (const [name, j] of [['list', row], ['detail', detail.json.job], ['cancel', cancel.json.job]]) {
    assert.ok(j, `${name} returned the job`);
    for (const f of hidden) assert.strictEqual(j[f], undefined, `${name} hides ${f}`);
    assert.strictEqual(j.pinPassError, "Map pins weren't checked this time. Import the file again to try again.", `${name} keeps the generic line`);
  }
});
