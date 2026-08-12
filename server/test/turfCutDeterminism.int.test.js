import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// generateTurf must cut the SAME pass into the SAME books every time, over the REAL
// generateTurf + a throwaway mongod:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:PORT/turf_cut_determinism_test node --test test/turfCutDeterminism.int.test.js
//
// Why this file exists, and why the unit tests in turfDeterminism.test.js are NOT enough:
// those pass canonically-ordered doors straight into balancedKMeans, so they prove the
// pipeline is deterministic GIVEN a canonical order — which was already true before the fix.
// They cannot fail if someone deletes a `byId(...)` wrapper in generateTurf.js, because they
// never call generateTurf. The real bug was upstream: Mongo guarantees no document order, and
// the cut picks seeds by POSITION and breaks ties by index (balancedKMeans.js), so the load
// order reaches book membership. Only a test that goes through generateTurf can pin that.
//
// The doors are inserted in DESCENDING _id order so the natural/index order the server hands
// back is the opposite of the canonical one. The assertion is exact rather than dependent on
// that: the cut's output must equal the cut of the same doors sorted by _id ascending.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-turf-cut-determinism';

const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { Household } = await import('../src/models/Household.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { generateTurf } = await import('../src/services/turf/generateTurf.js');
const { geometricCut } = await import('../src/services/turf/geometricCut.js');
const { computeWalkOrder } = await import('../src/services/turf/walkOrder.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';

const ctx = {};
const MAX_DOORS = 25;

// A spread of streets plus an APARTMENT STACK — 12 units sharing one geocode. The stack is
// the case nothing geometric can order: identical lng/lat means identical Hilbert index, x
// and y, so document identity is the only tiebreak left.
const doorSpecs = () => {
  const out = [];
  for (let n = 0; n < 90; n++) {
    const a = (n * 2654435761) % 4294967296;
    out.push({ n, lng: -81.72 + ((a % 1000) / 1000) * 0.03, lat: 25.94 + (((a / 1000) | 0) % 1000) / 1000 * 0.03 });
  }
  for (let u = 0; u < 12; u++) out.push({ n: 900 + u, lng: -81.705, lat: 25.951 });
  return out;
};

const bookShape = (turfs) =>
  turfs
    .map((t) => t.householdIds.map(String).join(','))   // walk ORDER matters, not just membership
    .sort();

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Campaign, Effort, Pass, Turf, Household, TurfAssignment]) {
    await M.deleteMany({});
  }

  const org = await Organization.create({ name: 'Cut Org', slug: 'cut-org', isActive: true });
  const camp = await Campaign.create({
    organizationId: org._id, name: 'Cut C', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York',
  });
  const effort = await Effort.create({ organizationId: org._id, campaignId: camp._id, name: 'Island' });
  const pass = await Pass.create({
    organizationId: org._id, campaignId: camp._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active',
  });

  // Explicit ascending _ids, then insert DESCENDING so the natural order fights the canonical one.
  const specs = doorSpecs();
  const ids = specs.map(() => new mongoose.Types.ObjectId());
  ids.sort((a, b) => (String(a) < String(b) ? -1 : 1));
  const docs = specs.map((s, i) => ({
    _id: ids[i],
    organizationId: org._id,
    campaignId: camp._id,
    effortId: effort._id,
    addressLine1: `${s.n} Canal Ct`,
    city: 'Marco Island',
    state: 'FL',
    zipCode: '34145',
    normalizedAddress: `${s.n} CANAL CT|MARCO ISLAND|FL|34145`,
    location: { type: 'Point', coordinates: [s.lng, s.lat] },
    isActive: true,
    status: 'unknocked',
  }));
  await Household.insertMany(docs.slice().reverse(), { ordered: true });

  Object.assign(ctx, { org, camp, effort, pass, docs });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('the cut is reproducible — a re-run produces byte-identical books', { skip }, async () => {
  const run = async () => {
    await generateTurf({
      campaignId: ctx.camp._id, passId: ctx.pass._id, mode: 'geometric', params: { maxDoors: MAX_DOORS, tolerance: 0.4 },
    });
    return bookShape(await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean());
  };
  const first = await run();
  const second = await run();
  const third = await run();
  assert.ok(first.length > 1, 'fixture should produce several books');
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('books match the cut of the SAME doors ordered by _id — load order never leaks in', { skip }, async () => {
  // This is the assertion that fails if a `byId(...)` wrapper is dropped from generateTurf:
  // the reference is computed from an explicitly _id-sorted array, while the doors were
  // INSERTED in the opposite order.
  //
  // `roadAware: false` is required, not incidental. The fixture's coordinates sit on Marco
  // Island, which the committed Collier road artifact covers, so the default path now cuts
  // along streets while the reference below is a straight-line geometricCut. Pinning the
  // straight-line path here is the point: byId runs BEFORE the road/straight dispatch, so
  // this still guards both. Road-path reproducibility is covered by roadCut.int.test.js.
  await generateTurf({
    campaignId: ctx.camp._id,
    passId: ctx.pass._id,
    mode: 'geometric',
    params: { maxDoors: MAX_DOORS, tolerance: 0.4, roadAware: false },
  });
  const actual = bookShape(await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean());

  const sorted = ctx.docs.slice().sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1));
  const expected = geometricCut(sorted, { maxDoors: MAX_DOORS, tolerance: 0.4 })
    .map((b) => computeWalkOrder(b.households, { optimize: true }).map(String).join(','))
    .sort();

  assert.deepEqual(actual, expected);
});

test('the household mirror agrees with the books it was written from', { skip }, async () => {
  await generateTurf({
    campaignId: ctx.camp._id, passId: ctx.pass._id, mode: 'geometric', params: { maxDoors: MAX_DOORS, tolerance: 0.4 },
  });
  const turfs = await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean();
  const homes = await Household.find({ campaignId: ctx.camp._id }, { turfId: 1, walkOrder: 1 }).lean();
  const mirror = new Map(homes.map((h) => [String(h._id), h]));
  for (const t of turfs) {
    t.householdIds.forEach((hid, i) => {
      const m = mirror.get(String(hid));
      assert.equal(String(m.turfId), String(t._id));
      assert.equal(m.walkOrder, i);
    });
  }
});

test('an apartment stack lands in a stable order across re-cuts', { skip }, async () => {
  // 12 units at one geocode: geometrically indistinguishable, so this is exactly where an
  // uncanonical load order would show up first.
  const stackIds = new Set(
    ctx.docs.filter((d) => d.location.coordinates[0] === -81.705 && d.location.coordinates[1] === 25.951).map((d) => String(d._id))
  );
  assert.equal(stackIds.size, 12, 'fixture should have a 12-unit stack');

  const seqOf = async () => {
    await generateTurf({
      campaignId: ctx.camp._id, passId: ctx.pass._id, mode: 'geometric', params: { maxDoors: MAX_DOORS, tolerance: 0.4 },
    });
    const turfs = await Turf.find({ passId: ctx.pass._id }, { householdIds: 1 }).lean();
    return turfs
      .map((t) => t.householdIds.map(String).filter((id) => stackIds.has(id)).join(','))
      .filter(Boolean)
      .sort();
  };
  const a = await seqOf();
  const b = await seqOf();
  assert.deepEqual(b, a);
});
