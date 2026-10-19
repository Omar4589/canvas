import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

// repair:city-suffix, run as the OPERATOR runs it (a child process over the real script, MONGODB_URI
// pointed at a throwaway mongod), against the shapes the Texas HD 37 file left behind: doors whose city
// is the vendor's "HARLINGEN_addr" code, one of them sharing its do-not-knock request with a sibling
// campaign's door imported from the same file, one whose corrected address already stands as another
// door, an inactive one, a flagged pin, one that is nothing but the suffix, and a round target filter
// and saved search naming suffixed cities. Pins that a dry run writes nothing, that --apply renames in
// place (same _id, pins and flags untouched) and never leaves a door unsuppressed, and that a second
// --apply changes nothing.
//
//   npm run test:int -- test/repairCitySuffix.int.test.js

const { Organization } = await import('../src/models/Organization.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { Household } = await import('../src/models/Household.js');
const { DoNotKnockAddress } = await import('../src/models/DoNotKnockAddress.js');
const { Pass } = await import('../src/models/Pass.js');
const { SavedSearch } = await import('../src/models/SavedSearch.js');
const { normalizeAddress, looseAddressKey } = await import('../src/utils/normalizeAddress.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const run = promisify(execFile);
const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations/repairCitySuffix.js');

const script = async (...flags) => {
  const { stdout } = await run(process.execPath, [SCRIPT, '--json', ...flags], {
    env: { ...process.env, MONGODB_URI: URI },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout);
};
const refused = async (...flags) => {
  try {
    await run(process.execPath, [SCRIPT, ...flags], { env: { ...process.env, MONGODB_URI: URI } });
  } catch (err) {
    return err;
  }
  return assert.fail(`expected "${flags.join(' ')}" to exit non-zero`);
};

const ctx = {};
let spot = 0;
const door = (org, campaign, addressLine1, city, zipCode, extra = {}) => {
  spot += 1;
  const fields = { addressLine1, addressLine2: null, city, state: 'TX', zipCode };
  return {
    organizationId: org._id,
    campaignId: campaign._id,
    ...fields,
    normalizedAddress: normalizeAddress(fields),
    cityValue: city,
    location: { type: 'Point', coordinates: [-97.7 + spot * 0.001, 26.2] },
    coordSource: 'file',
    isActive: true,
    status: 'unknocked',
    ...extra,
  };
};
const keyWith = (h, city) => normalizeAddress({ ...h, city });
const REQUESTED = new Date('2026-10-15T15:00:00Z');
const dnkRecord = (org, h, city, campaignIdAtSet) => {
  const fields = { addressLine1: h.addressLine1, addressLine2: null, city, state: 'TX', zipCode: h.zipCode };
  return {
    organizationId: org._id,
    normalizedAddress: normalizeAddress(fields),
    looseKey: looseAddressKey(fields),
    ...fields,
    reason: 'Asked us not to come back',
    source: 'lead',
    byUserId: new mongoose.Types.ObjectId(),
    at: REQUESTED,
    campaignIdAtSet,
    createdAt: REQUESTED,
    updatedAt: REQUESTED,
  };
};
const byId = async (id) => Household.findById(id).lean();
const snapshot = async () =>
  JSON.stringify(
    await Promise.all([
      Household.find({}).sort({ _id: 1 }).lean(),
      DoNotKnockAddress.find({}).sort({ _id: 1 }).lean(),
      Pass.find({}).sort({ _id: 1 }).lean(),
      SavedSearch.find({}).sort({ _id: 1 }).lean(),
    ])
  );

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  for (const M of [Organization, Campaign, Household, DoNotKnockAddress, Pass, SavedSearch]) await M.deleteMany({});
  // The unique keys the script leans on must exist before it runs.
  await Promise.all([Household.init(), DoNotKnockAddress.init()]);

  const org = await Organization.create({ name: 'Fix Org', slug: 'fix-org', isActive: true });
  const other = await Organization.create({ name: 'Other Org', slug: 'other-org', isActive: true });
  const mk = (o, name) => Campaign.create({ organizationId: o._id, name, type: 'survey', state: 'TX', isActive: true });
  const [hd37, sibling, clean, elsewhere] = [await mk(org, 'TX HD 37'), await mk(org, 'TX HD 37 Mail'), await mk(org, 'TX Clean'), await mk(other, 'Other TX')];

  const seed = {
    wilson: door(org, hd37, '15140 WILSON RD', 'HARLINGEN_addr', '78552', { doNotKnock: true }),
    aries: door(org, hd37, '128 ARIES DR', 'SOUTH PADRE ISLAND_addr', '78597', { doNotKnock: true }),
    palm: door(org, hd37, '5118 PALM VALLEY DR S', 'HARLINGEN_addr', '78552'),
    palmClean: door(org, hd37, '5118 PALM VALLEY DR S', 'Harlingen', '78552'),
    feria: door(org, hd37, '1 OLD ST', 'La Feria_ADDR', '78559', { isActive: false }),
    bare: door(org, hd37, '2 NOWHERE LN', '_addr', '78550'),
    flagged: door(org, hd37, '77 FLAG RD', 'RIO HONDO_addr', '78583', { pinSuspect: 'placeholder' }),
    river: door(org, hd37, '5 RIVER RD', 'SAN BENITO_addr', '78586'),
    plain: door(org, hd37, '9 CLEAN ST', 'HARLINGEN', '78550'),
    siblingWilson: door(org, sibling, '15140 WILSON RD', 'HARLINGEN_addr', '78552', { doNotKnock: true }),
    cleanDoor: door(org, clean, '3 MAIN ST', 'LOS FRESNOS', '78566'),
    elsewhereDoor: door(other, elsewhere, '4 BAY ST', 'PORT ISABEL_addr', '78578'),
  };
  const ids = {};
  for (const [k, h] of Object.entries(seed)) ids[k] = (await Household.create(h))._id;

  // Requests under the OLD keys (Wilson's is shared with the sibling campaign's door), and one already
  // standing under River's CORRECTED key (set from a campaign whose file had the right column).
  const dnk = DoNotKnockAddress.collection;
  const wilsonDnk = (await dnk.insertOne(dnkRecord(org, seed.wilson, 'HARLINGEN_addr', hd37._id))).insertedId;
  const ariesDnk = (await dnk.insertOne(dnkRecord(org, seed.aries, 'SOUTH PADRE ISLAND_addr', hd37._id))).insertedId;
  await dnk.insertOne(dnkRecord(org, seed.river, 'SAN BENITO', clean._id));

  const effortId = new mongoose.Types.ObjectId();
  const round = await Pass.create({
    organizationId: org._id, campaignId: hd37._id, effortId, roundNumber: 1, name: 'Round 1',
    targetFilter: { cities: ['HARLINGEN_addr', 'HARLINGEN'], exclude: { cities: ['La Feria_ADDR'] } },
  });
  const siblingRound = await Pass.create({
    organizationId: org._id, campaignId: sibling._id, effortId: new mongoose.Types.ObjectId(), roundNumber: 1, name: 'Round 1',
    targetFilter: { cities: ['HARLINGEN_addr'] },
  });
  const search = await SavedSearch.create({ organizationId: org._id, campaignId: hd37._id, name: 'Old list', filter: { cities: ['SAN BENITO_addr'] } });

  Object.assign(ctx, { org, hd37, sibling, clean, elsewhere, seed, ids, wilsonDnk, ariesDnk, round, siblingRound, search });
});

after(async () => {
  if (URI) await mongoose.disconnect();
});

test('the scan lists every campaign holding the suffix and changes nothing', { skip }, async () => {
  const before = await snapshot();
  const out = await script();
  assert.strictEqual(out.mode, 'scan');
  const row = (name) => out.campaigns.find((c) => c.name === name);
  assert.deepStrictEqual({ doors: row('TX HD 37').doors, active: row('TX HD 37').active, org: row('TX HD 37').org }, { doors: 7, active: 6, org: 'fix-org' });
  assert.strictEqual(row('TX HD 37 Mail').doors, 1);
  assert.strictEqual(row('Other TX').doors, 1);
  assert.strictEqual(row('TX Clean'), undefined);
  assert.strictEqual(await snapshot(), before);
});

test('a dry run reports what --apply would change and writes nothing', { skip }, async () => {
  const before = await snapshot();
  const out = await script(`--campaign=${ctx.hd37._id}`);
  assert.strictEqual(out.mode, 'dry-run');
  const [c] = out.campaigns;
  assert.strictEqual(c.applied, undefined);
  assert.deepStrictEqual(
    { ...c.plan, cities: undefined },
    { doors: 7, activeDoors: 6, cities: undefined, rename: 5, leftAlone: { corrected: 1, emptied: 1 }, doNotKnock: 2, roundFilters: 1, savedSearches: 1 }
  );
  assert.deepStrictEqual(c.plan.cities[0], { from: 'HARLINGEN_addr', to: 'HARLINGEN', doors: 2 });
  assert.ok(c.plan.cities.some((r) => r.from === 'La Feria_ADDR' && r.to === 'La Feria'));
  assert.strictEqual(c.pinFixes.shared, 1);
  assert.strictEqual(await snapshot(), before);
});

test('bad arguments are refused before anything runs', { skip }, async () => {
  const before = await snapshot();
  const noCampaign = await refused('--apply');
  assert.match(noCampaign.stderr, /--apply needs --campaign/);
  assert.match((await refused('--campaign=')).stderr, /missing its value/);
  assert.match((await refused('--campaign', String(ctx.hd37._id))).stderr, /missing its value/);
  assert.match((await refused('--campaign=123')).stderr, /not a valid id/);
  assert.match((await refused('--org=fix-org')).stderr, /unrecognized argument/);
  assert.strictEqual(await snapshot(), before);
});

test('--apply renames in place, carries do-not-knock, fixes the filters and touches nothing else', { skip }, async () => {
  const { ids, seed, hd37 } = ctx;
  const was = {};
  for (const k of Object.keys(ids)) was[k] = await byId(ids[k]);

  const out = await script(`--campaign=${hd37._id}`, '--apply');
  const [c] = out.campaigns;
  assert.deepStrictEqual(c.applied, {
    renamed: 5,
    notRenamed: 0,
    doNotKnock: { copied: 2, oldRemoved: 1, oldKept: 1 },
    roundFilters: 1,
    savedSearches: 1,
  });

  // Renamed: same door, real city, a key a correctly mapped file would land on. Pins and flags untouched.
  const wilson = await byId(ids.wilson);
  assert.strictEqual(wilson.city, 'HARLINGEN');
  assert.strictEqual(wilson.cityValue, 'HARLINGEN');
  assert.strictEqual(wilson.normalizedAddress, keyWith(seed.wilson, 'HARLINGEN'));
  assert.deepStrictEqual(wilson.location, was.wilson.location);
  assert.strictEqual(wilson.doNotKnock, true);
  assert.ok(wilson.updatedAt > was.wilson.updatedAt, 'updatedAt moves so phones pick up the city');
  assert.strictEqual((await Household.findOne({ campaignId: hd37._id, normalizedAddress: keyWith(seed.wilson, 'Harlingen') }).lean())._id.toString(), String(ids.wilson));

  const feria = await byId(ids.feria);
  assert.deepStrictEqual([feria.city, feria.isActive], ['La Feria', false]);
  const flagged = await byId(ids.flagged);
  assert.deepStrictEqual([flagged.city, flagged.pinSuspect, flagged.coordSource], ['RIO HONDO', 'placeholder', 'file']);
  assert.deepStrictEqual(flagged.location, was.flagged.location);
  assert.strictEqual((await byId(ids.aries)).doNotKnock, true);
  // River's corrected address already carried a request: the rename brings it under it.
  assert.strictEqual((await byId(ids.river)).doNotKnock, true);

  // Left alone: the door whose corrected address is taken, its twin, the bare suffix, a clean door,
  // the sibling campaign and the other organization.
  for (const k of ['palm', 'palmClean', 'bare', 'plain', 'siblingWilson', 'cleanDoor', 'elsewhereDoor']) {
    assert.deepStrictEqual(await byId(ids[k]), was[k], `${k} must be untouched`);
  }

  // Do-not-knock: Wilson's old record stays for the sibling's door, Aries's moved; both copies keep the
  // request's reason, who, when and createdAt.
  const oldWilson = await DoNotKnockAddress.findById(ctx.wilsonDnk).lean();
  assert.strictEqual(oldWilson.normalizedAddress, seed.wilson.normalizedAddress);
  assert.strictEqual(await DoNotKnockAddress.findById(ctx.ariesDnk).lean(), null);
  for (const [h, city] of [[seed.wilson, 'HARLINGEN'], [seed.aries, 'SOUTH PADRE ISLAND']]) {
    const copy = await DoNotKnockAddress.findOne({ organizationId: ctx.org._id, normalizedAddress: keyWith(h, city) }).lean();
    assert.ok(copy, `${h.addressLine1} carries its request`);
    assert.strictEqual(copy.city, city);
    assert.strictEqual(copy.looseKey, looseAddressKey({ ...h, city }));
    assert.strictEqual(copy.reason, 'Asked us not to come back');
    assert.deepStrictEqual([copy.at, copy.createdAt], [REQUESTED, REQUESTED]);
    assert.strictEqual(String(copy.campaignIdAtSet), String(hd37._id));
  }
  assert.strictEqual((await byId(ids.siblingWilson)).doNotKnock, true);

  // Filters: this campaign's round and saved search lose the suffix (deduplicated); the sibling's round doesn't.
  const round = await Pass.findById(ctx.round._id).lean();
  assert.deepStrictEqual(round.targetFilter, { cities: ['HARLINGEN'], exclude: { cities: ['La Feria'] } });
  assert.deepStrictEqual((await Pass.findById(ctx.siblingRound._id).lean()).targetFilter, { cities: ['HARLINGEN_addr'] });
  assert.deepStrictEqual((await SavedSearch.findById(ctx.search._id).lean()).filter.cities, ['SAN BENITO']);
});

test('a second --apply changes nothing', { skip }, async () => {
  const before = await snapshot();
  const out = await script(`--campaign=${ctx.hd37._id}`, '--apply');
  const [c] = out.campaigns;
  assert.strictEqual(c.plan.rename, 0);
  assert.deepStrictEqual(c.plan.leftAlone, { corrected: 1, emptied: 1 });
  assert.deepStrictEqual(c.applied.doNotKnock, { copied: 0, oldRemoved: 0, oldKept: 0 });
  assert.strictEqual(await snapshot(), before);
});
