import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Road-aware cutting end to end, over the REAL generateTurf + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/road_cut_test node --test test/roadCut.int.test.js
//
// What this pins:
//   1. With road data covering the doors, the cut measures along STREETS — proven by a
//      fixture whose two door clusters are close in a straight line but far apart on foot,
//      the Marco Island canal shape. A straight-line cut mixes them; a road cut does not.
//   2. Every fallback degrades to today's behaviour instead of failing: road data turned
//      off, and doors outside any road artifact.
//   3. Whichever path ran is REPORTED — stamped on Turf.params.road and returned by the
//      job — so the admin is never left guessing which cut they got.
//   4. Road-aware cuts are reproducible, same as straight-line ones.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-road-cut';

const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { generateTurf } = await import('../src/services/turf/generateTurf.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};

// Two clusters on opposite banks of a real Marco Island finger canal. These coordinates are
// not invented — they were found by querying the committed Collier road graph for a pair of
// addressable points that are CLOSE in a straight line and FAR along the streets:
//
//   -81.718334, 25.930386  <->  -81.716574, 25.930196
//   177 m apart in a straight line, 2,825 m on foot — 16x.
//
// An earlier version of this fixture guessed at a canal location and was simply wrong: the
// two rows were 167 m apart and ~250 m on foot, connected by ordinary cross streets, so the
// road cut correctly kept them together and the test failed for the right reason. Verify
// against the graph before changing these numbers.
const BANK_A = { lng: -81.718334, lat: 25.930386 };
const BANK_B = { lng: -81.716574, lat: 25.930196 };
// Spread each cluster along its own bank, well inside the ~180 m gap between them.
const SPREAD = 0.00018;

const doorAt = (org, camp, effort, n, lng, lat) => ({
  organizationId: org,
  campaignId: camp,
  effortId: effort,
  addressLine1: `${n} Test Ct`,
  city: 'Marco Island',
  state: 'FL',
  zipCode: '34145',
  normalizedAddress: `${n} TEST CT|MARCO ISLAND|FL|34145`,
  location: { type: 'Point', coordinates: [lng, lat] },
  isActive: true,
  status: 'unknocked',
});

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Campaign, Effort, Pass, Turf, Household, TurfAssignment]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Road Org', slug: 'road-org', isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Road C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Island' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active',
  });

  const docs = [];
  for (let i = 0; i < 40; i++) {
    docs.push(doorAt(org._id, camp._id, effort._id, i, BANK_A.lng, BANK_A.lat + (i - 20) * SPREAD * 0.1));
    docs.push(doorAt(org._id, camp._id, effort._id, 1000 + i, BANK_B.lng, BANK_B.lat + (i - 20) * SPREAD * 0.1));
  }
  await Household.insertMany(docs);

  // Far from any committed road artifact — used for the no-coverage fallback.
  const farCamp = await Campaign.create({
    organizationId: org._id, name: 'Far C', type: 'survey', state: 'MT', isActive: true, timeZone: 'America/Denver',
  });
  const farEffort = await Effort.create({ organizationId: org._id, campaignId: farCamp._id, name: 'Far' });
  const farPass = await Pass.create({
    organizationId: org._id, campaignId: farCamp._id, effortId: farEffort._id, roundNumber: 1, name: 'R1', status: 'active',
  });
  await Household.insertMany(
    Array.from({ length: 30 }, (_, i) =>
      doorAt(org._id, farCamp._id, farEffort._id, 5000 + i, -110.0 + i * 0.001, 46.5)
    )
  );

  Object.assign(ctx, { org, camp, effort, pass, farCamp, farPass });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

const cut = (campaignId, passId, params) =>
  generateTurf({ campaignId, passId, mode: 'geometric', params });

test('road data covering the doors is used, and says so', { skip }, async () => {
  const res = await cut(ctx.camp._id, ctx.pass._id, { maxDoors: 40 });
  assert.equal(res.road.applied, true, 'expected the road cut to run over Collier road data');
  assert.deepEqual(res.road.counties, ['12021'], 'expected Collier County to be the source');

  // The stamp lands on every book, so a book explains its own provenance later.
  const turfs = await Turf.find({ passId: ctx.pass._id }, { params: 1 }).lean();
  assert.ok(turfs.length > 0);
  for (const t of turfs) assert.equal(t.params.road.applied, true);
});

test('books do not straddle the canal — the whole point', { skip }, async () => {
  await cut(ctx.camp._id, ctx.pass._id, { maxDoors: 40 });
  const turfs = await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean();
  const homes = await Household.find({ campaignId: ctx.camp._id }, { location: 1 }).lean();
  const midLng = (BANK_A.lng + BANK_B.lng) / 2;
  const sideOf = new Map(
    homes.map((h) => [String(h._id), h.location.coordinates[0] < midLng ? 'a' : 'b'])
  );
  let mixed = 0;
  for (const t of turfs) {
    const sides = new Set(t.householdIds.map((id) => sideOf.get(String(id))));
    if (sides.size > 1) mixed += 1;
  }
  assert.equal(mixed, 0, `${mixed} of ${turfs.length} books span the canal`);
});

test('roadAware:false falls back to the straight-line cut and records why', { skip }, async () => {
  const res = await cut(ctx.camp._id, ctx.pass._id, { maxDoors: 40, roadAware: false });
  assert.equal(res.road.applied, false);
  assert.equal(res.road.reason, 'turned-off');
});

test('doors outside every road artifact still cut, by straight line', { skip }, async () => {
  const res = await cut(ctx.farCamp._id, ctx.farPass._id, { maxDoors: 15 });
  assert.equal(res.road.applied, false);
  assert.equal(res.road.reason, 'no-road-data-for-this-area');
  const turfs = await Turf.find({ passId: ctx.farPass._id }, { doorCount: 1 }).lean();
  assert.equal(turfs.reduce((s, t) => s + t.doorCount, 0), 30, 'every door must still land in a book');
});

test('a road-aware cut is reproducible', { skip }, async () => {
  const shape = async () => {
    await cut(ctx.camp._id, ctx.pass._id, { maxDoors: 40 });
    const turfs = await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean();
    return turfs.map((t) => t.householdIds.map(String).join(',')).sort();
  };
  const first = await shape();
  assert.deepEqual(await shape(), first);
  assert.deepEqual(await shape(), first);
});
