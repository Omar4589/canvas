import { test, before, after } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';

// Homes a vendor stamped with one shared coordinate, placed by address at import — end to end over the
// REAL import pipeline and a throwaway mongod, with Geocodio answered by a fake fetch (no network):
//   cd server && npm run test:int -- test/importPlaceholderPins.int.test.js
// Locks (docs/PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md): only this file's homes on a shared spot are looked
// up; only a rooftop or point answer in the address's ZIP and state, claimed by no other address, is
// placed; a building's units are never looked up and a stray on its own building's spot is refused;
// homes it can't place stay flagged and counted; a re-import keeps placed pins and a vendor change
// wins; lookups off, a provider failure and a held lease each mark only; the ceiling; a person's pin is
// never looked up; one home's two records count once (a re-keyed stray).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-placeholderpins';
process.env.GEOCODIO_API_KEY = 'test-key-not-real';

const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');
const { PIN_PASS_BUSY, PIN_PASS_FAILED } = await import('../src/services/households/placeStackedPins.js');
const { buildingKeyForCoords } = await import('../src/utils/buildingKey.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { Household } = await import('../src/models/Household.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { GeocodeCache } = await import('../src/models/GeocodeCache.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { OrgDeletionRequest } = await import('../src/models/OrgDeletionRequest.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const ctx = {};

// ── Geocodio, faked: answers by the exact address string resolve() sends. ──
const realFetch = globalThis.fetch;
const geo = { answers: new Map(), mode: 'ok', calls: 0, sent: [] };
const answer = (address, lat, lng, type = 'rooftop') => geo.answers.set(address, { lat, lng, type });
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.geocod.io/')) return realFetch(url, init);
  geo.calls += 1;
  if (geo.mode === '401') return new Response('{"error":"Invalid API key: test-key-not-real"}', { status: 401 });
  const body = JSON.parse(init.body);
  const results = {};
  for (const [k, address] of Object.entries(body)) {
    geo.sent.push(address);
    const a = geo.answers.get(address);
    results[k] = {
      response: {
        results: a ? [{ location: { lat: a.lat, lng: a.lng }, accuracy: 1, accuracy_type: a.type, formatted_address: address }] : [],
      },
    };
  }
  return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const resetGeo = () => Object.assign(geo, { mode: 'ok', calls: 0, sent: [] });

// ── Files: Pahrump, NV. S and B are shared spots; the answers are each home's own rooftop. ──
const S = [36.21, -115.95];
const B = [36.22, -115.96];
const CSV_HEADER = 'State Voter ID,First Name,Last Name,Phone,Party,Address,City,Registered State,Zip Code,p_Latitude,p_Longitude';
const row = (svid, address, [lat, lng] = S) => ({ svid, address, lat, lng });
const csvOf = (rows) =>
  Buffer.from(
    [CSV_HEADER, ...rows.map((r) => [r.svid, 'Pat', r.svid, '', '', r.address, 'Pahrump', 'NV', '89061', r.lat.toFixed(6), r.lng.toFixed(6)].join(','))].join('\n'),
    'utf8'
  );
const sentAs = (address) => `${address}, Pahrump, NV 89061`;
const keyOf = ([lat, lng]) => buildingKeyForCoords([lng, lat]);

const newCampaign = (name) =>
  Campaign.create({ organizationId: ctx.org._id, name, type: 'survey', state: 'NV', isActive: true, surveyTemplateId: ctx.template._id });

async function runFile(campaign, rows) {
  const job = await ImportJob.create({
    organizationId: ctx.org._id,
    campaignId: campaign._id,
    filename: 'pins.csv',
    kind: 'apply',
    status: 'pending',
    fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, 'pins.csv', csvOf(rows));
  await processImportJob({ id: `pp-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return ImportJob.findById(job._id).lean();
}
const door = (campaign, address) => Household.findOne({ campaignId: campaign._id, addressLine1: address }).lean();

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes(), Person.syncIndexes(), GeocodeCache.syncIndexes()]);
  for (const M of [Organization, Subscription, User, Membership, Campaign, SurveyTemplate, ImportJob, Household, Voter, Person, GeocodeCache, Effort, Pass, Turf, OrgDeletionRequest]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'Pins Org', slug: 'pins-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Pins Survey', questions: [], isActive: true });
  Object.assign(ctx, { org, template });
  process.env.GEOCODE_ENABLED = 'true';
});

after(async () => {
  globalThis.fetch = realFetch;
  if (URI) await mongoose.disconnect();
});

test('1. houses sharing one spot are each looked up and placed at their own rooftop', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Monte Penne');
  answer(sentAs('5001 E Monte Penne Way'), 36.215, -115.94);
  answer(sentAs('5011 E Monte Penne Way'), 36.216, -115.939);
  answer(sentAs('5016 E Monte Penne Way'), 36.217, -115.938);
  const rows = [
    row('MP1', '5001 E Monte Penne Way'),
    row('MP2', '5011 E Monte Penne Way'),
    row('MP3', '5016 E Monte Penne Way'),
    row('MP4', '4896 E Monte Penne Way', [36.205, -115.945]), // its own coordinate: never looked up
  ];
  const job = await runFile(c, rows);
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.placeholderPinDoors, 3, 'the preview counted the three');
  assert.strictEqual(job.pinsPlacedExact, 3);
  assert.strictEqual(job.pinsStillUnplaced, 0);
  assert.strictEqual(job.pinLookupsNew, 3);
  assert.strictEqual(job.pinPassError, null);
  assert.deepStrictEqual([...geo.sent].sort(), ['5001', '5011', '5016'].map((n) => sentAs(`${n} E Monte Penne Way`)).sort());
  const d = await door(c, '5001 E Monte Penne Way');
  assert.strictEqual(d.coordSource, 'geocodio');
  assert.strictEqual(d.coordConfidence, 'exact');
  assert.deepStrictEqual(d.location.coordinates, [-115.94, 36.215]);
  assert.strictEqual(d.pinPlacement.by, 'lookup');
  assert.deepStrictEqual(d.pinPlacement.from, [S[1], S[0]]);
  assert.strictEqual(d.pinPlacement.stackSize, 2);
  assert.strictEqual(d.pinSuspect, undefined);
  const lone = await door(c, '4896 E Monte Penne Way');
  assert.strictEqual(lone.coordSource, 'file');
  assert.strictEqual(lone.pinPlacement, undefined);
  ctx.mp = { c, rows };
});

test('2. a building is never looked up; a stray is placed, unless its rooftop is its own building', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Building');
  answer(sentAs('12 Pine St'), 36.225, -115.955);
  answer(sentAs('14 Pine St'), B[0], B[1]); // the building's own spot
  const job = await runFile(c, [
    row('BL1', '100 Main St Apt 1', B),
    row('BL2', '100 Main St Apt 2', B),
    row('BL3', '100 Main St Apt 3', B),
    row('BL4', '12 Pine St', B),
    row('BL5', '14 Pine St', B),
  ]);
  assert.strictEqual(job.strayPinDoors, 2);
  assert.deepStrictEqual([...geo.sent].sort(), [sentAs('12 Pine St'), sentAs('14 Pine St')].sort(), 'the units are never sent');
  for (const n of [1, 2, 3]) {
    const u = await door(c, `100 Main St Apt ${n}`);
    assert.strictEqual(u.pinSuspect, undefined, `unit ${n} unflagged`);
    assert.strictEqual(u.coordSource, 'file');
  }
  assert.strictEqual((await door(c, '12 Pine St')).coordSource, 'geocodio');
  const own = await door(c, '14 Pine St');
  assert.strictEqual(own.pinSuspect, 'stray', 'refused: its answer is another address\'s building');
  assert.deepStrictEqual(own.pinDistrustedKeys, [keyOf(B)]);
  assert.strictEqual(job.pinsPlacedExact, 1);
  assert.strictEqual(job.pinsStillUnplaced, 1);
});

test('3. no match, a nearest-rooftop guess, and two addresses on one answer all stay flagged', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Refusals');
  const P = [36.231, -115.931];
  answer(sentAs('20 Ash St'), 36.232, -115.932, 'nearest_rooftop_match');
  answer(sentAs('22 Ash St'), P[0], P[1]);
  answer(sentAs('24 Ash St'), P[0], P[1]);
  const job = await runFile(c, [row('RA1', '18 Ash St'), row('RA2', '20 Ash St'), row('RA3', '22 Ash St'), row('RA4', '24 Ash St')]);
  assert.strictEqual(job.pinsPlacedExact, 0);
  assert.strictEqual(job.pinsStillUnplaced, 4);
  // The provider bills every address it answers, matched or not: 18 Ash St had no match and still counts.
  assert.strictEqual(geo.sent.length, 4);
  assert.strictEqual(job.pinLookupsNew, 4);
  for (const a of ['18', '20', '22', '24']) {
    const d = await door(c, `${a} Ash St`);
    assert.strictEqual(d.pinSuspect, 'placeholder', `${a} flagged`);
    assert.strictEqual(d.coordSource, 'file', `${a} not moved`);
  }
  assert.deepStrictEqual((await door(c, '22 Ash St')).pinDistrustedKeys, [keyOf(P)]);
  assert.deepStrictEqual((await door(c, '24 Ash St')).pinDistrustedKeys, [keyOf(P)]);
  assert.strictEqual((await door(c, '20 Ash St')).pinDistrustedKeys, undefined, 'a guess claims nothing');
});

test('4. importing the same file again keeps the placed pins and looks nothing up', { skip }, async () => {
  resetGeo();
  const { c, rows } = ctx.mp;
  const job = await runFile(c, rows);
  assert.strictEqual(job.keptPlacements, 3);
  assert.strictEqual(geo.calls, 0);
  assert.strictEqual(job.pinsPlacedExact, 0, 'nothing new placed by this import');
  assert.strictEqual(job.pinsStillUnplaced, 0);
  const d = await door(c, '5001 E Monte Penne Way');
  assert.strictEqual(d.coordSource, 'geocodio');
  assert.deepStrictEqual(d.location.coordinates, [-115.94, 36.215]);
});

test('5. a vendor change wins, and the placement is released', { skip }, async () => {
  resetGeo();
  const { c, rows } = ctx.mp;
  const V = [36.241, -115.921];
  const job = await runFile(c, rows.map((r) => (r.svid === 'MP1' ? row('MP1', r.address, V) : r)));
  assert.strictEqual(job.keptPlacements, 2);
  const d = await door(c, '5001 E Monte Penne Way');
  assert.strictEqual(d.coordSource, 'file');
  assert.deepStrictEqual(d.location.coordinates, [V[1], V[0]]);
  assert.ok(d.pinPlacement.releasedAt, 'released');
  assert.strictEqual(d.pinSuspect, undefined);
});

test('6. with lookups off, the homes are marked and nothing is sent', { skip }, async () => {
  resetGeo();
  process.env.GEOCODE_ENABLED = 'false';
  try {
    const c = await newCampaign('Lookups off');
    const job = await runFile(c, [row('LO1', '30 Elm St'), row('LO2', '32 Elm St'), row('LO3', '34 Elm St')]);
    assert.strictEqual(geo.calls, 0);
    assert.strictEqual(job.pinsStillUnplaced, 3);
    assert.strictEqual(job.pinPassError, null);
    assert.strictEqual((await door(c, '30 Elm St')).pinSuspect, 'placeholder');
    ctx.off = c;
  } finally {
    process.env.GEOCODE_ENABLED = 'true';
  }
});

test('7. a person\'s pin is never looked up', { skip }, async () => {
  resetGeo();
  const c = ctx.off;
  // A lead moved 30 Elm St onto its house (a person's move clears the flag and records the spot it left).
  await Household.updateOne(
    { campaignId: c._id, addressLine1: '30 Elm St' },
    {
      $set: {
        location: { type: 'Point', coordinates: [-115.99, 36.25] },
        coordSource: 'corrected',
        pinPlacement: { from: [S[1], S[0]], to: [-115.99, 36.25], at: new Date(), kind: 'placeholder', by: 'person' },
      },
      $unset: { pinSuspect: 1 },
    }
  );
  answer(sentAs('32 Elm St'), 36.26, -115.98);
  answer(sentAs('34 Elm St'), 36.27, -115.97);
  const job = await runFile(c, [row('LO1', '30 Elm St'), row('LO2', '32 Elm St'), row('LO3', '34 Elm St')]);
  assert.deepStrictEqual([...geo.sent].sort(), [sentAs('32 Elm St'), sentAs('34 Elm St')].sort());
  assert.strictEqual(job.keptPins, 1, 'the shield kept the person\'s pin');
  assert.strictEqual(job.pinsPlacedExact, 2);
  assert.strictEqual((await door(c, '30 Elm St')).coordSource, 'corrected');
});

test('8. a provider failure places nothing and says so, without leaking the cause to the organization', { skip }, async () => {
  resetGeo();
  geo.mode = '401';
  const c = await newCampaign('Outage');
  const job = await runFile(c, [row('OU1', '40 Fir St'), row('OU2', '42 Fir St'), row('OU3', '44 Fir St')]);
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.pinPassError, PIN_PASS_FAILED);
  assert.strictEqual(job.pinPassCause, 'HTTP 401');
  assert.strictEqual(job.lastError, null);
  assert.strictEqual(job.pinsPlacedExact, 0);
  assert.strictEqual(job.pinsStillUnplaced, 3);
  assert.strictEqual(geo.calls, 1, 'stopped after the first failed chunk');
});

test('9. a lease another import holds marks only; a silent one is taken over', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Busy');
  await Campaign.updateOne({ _id: c._id }, { $set: { pinPass: { owner: 'someone-else', heartbeatAt: new Date() } } });
  answer(sentAs('50 Oak St'), 36.281, -115.961);
  answer(sentAs('52 Oak St'), 36.282, -115.962);
  const rows = [row('BU1', '50 Oak St'), row('BU2', '52 Oak St')];
  const busy = await runFile(c, rows);
  assert.strictEqual(busy.pinPassError, PIN_PASS_BUSY);
  assert.strictEqual(busy.pinsStillUnplaced, 2);
  assert.strictEqual(geo.calls, 0);
  await Campaign.updateOne({ _id: c._id }, { $set: { 'pinPass.heartbeatAt': new Date(Date.now() - 120_000) } });
  const retry = await runFile(c, rows);
  assert.strictEqual(retry.pinsPlacedExact, 2);
  assert.strictEqual(retry.pinPassError, null);
  assert.strictEqual((await Campaign.findById(c._id).lean()).pinPass, undefined, 'released');
});

test('10. the ceiling looks up exactly the first N homes', { skip }, async () => {
  resetGeo();
  process.env.PIN_PLACEMENT_MAX_HOMES = '1';
  try {
    const c = await newCampaign('Ceiling');
    for (const n of [60, 62, 64]) answer(sentAs(`${n} Elm Ct`), 36.29 + n / 10000, -115.97);
    const job = await runFile(c, [row('CE1', '60 Elm Ct'), row('CE2', '62 Elm Ct'), row('CE3', '64 Elm Ct')]);
    assert.strictEqual(job.pinsPlacedExact, 1);
    assert.strictEqual(job.pinLookupsOverCap, 2);
    assert.strictEqual(job.pinProbedIds.length, 1);
    assert.strictEqual(job.pinsStillUnplaced, 2);
  } finally {
    delete process.env.PIN_PLACEMENT_MAX_HOMES;
  }
});

test('11. a re-spelled stray is one home: its new door is placed, and the duplex never flips', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Re-keyed');
  const R = [36.301, -115.981];
  answer(sentAs('16 Birch St'), R[0], R[1]);
  const first = await runFile(c, [row('RK1', '200 Oak St Apt A'), row('RK2', '200 Oak St Apt B'), row('RK3', '16 Birch St')]);
  assert.strictEqual(first.pinsPlacedExact, 1);
  // A refresh spells the stray "Street": a new door on the vendor's spot, the old one emptied.
  resetGeo();
  const second = await runFile(c, [row('RK1', '200 Oak St Apt A'), row('RK2', '200 Oak St Apt B'), row('RK3', '16 Birch Street')]);
  assert.strictEqual(geo.calls, 0, 'the St/Street spelling shares one cache entry');
  const fresh = await door(c, '16 Birch Street');
  assert.strictEqual(fresh.coordSource, 'geocodio', 'placed again, at its own rooftop');
  assert.deepStrictEqual(fresh.location.coordinates, [R[1], R[0]]);
  for (const apt of ['A', 'B']) assert.strictEqual((await door(c, `200 Oak St Apt ${apt}`)).pinSuspect, undefined, `Apt ${apt} unflagged`);
  assert.strictEqual(second.pinsPlacedExact, 1);
});

test('12. a unit a later file adds to a flagged address on the spot is flagged with it, and looked up', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Later unit');
  const Q = [36.311, -115.991];
  answer(sentAs('70 Cedar St'), 36.312, -115.992);
  const first = await runFile(c, [row('LU1', '70 Cedar St', Q), row('LU2', '72 Cedar St', Q)]);
  assert.strictEqual(first.pinsPlacedExact, 1, '70 placed; 72 has no answer');
  assert.strictEqual((await door(c, '72 Cedar St')).pinSuspect, 'placeholder');
  // A later file adds a unit of 72's address on the vendor's spot. 70 left the spot, so the spot has
  // history: 72's address now holds the majority but its flag stands, and the new unit inherits it.
  resetGeo();
  const second = await runFile(c, [row('LU1', '70 Cedar St', Q), row('LU2', '72 Cedar St', Q), row('LU3', '72 Cedar St Apt 2', Q)]);
  const unit = await door(c, '72 Cedar St Apt 2');
  assert.strictEqual(unit.pinSuspect, 'placeholder', 'flagged with its address');
  assert.ok(geo.sent.includes(sentAs('72 Cedar St Apt 2')), 'and looked up by its own address');
  assert.strictEqual((await door(c, '72 Cedar St')).pinSuspect, 'placeholder');
  assert.strictEqual((await door(c, '70 Cedar St')).coordSource, 'geocodio', 'the placed home stays placed');
  assert.strictEqual(second.keptPlacements, 1);
  assert.strictEqual(second.pinsStillUnplaced, 2);
});

test('13. a placement redraws the outline of a live book that holds the moved homes', { skip }, async () => {
  resetGeo();
  process.env.GEOCODE_ENABLED = 'false';
  const c = await newCampaign('Outline');
  const T = [36.321, -116.001];
  const rows = [row('OL1', '80 Spruce St', T), row('OL2', '82 Spruce St', T)];
  await runFile(c, rows); // lookups off: the doors exist, marked, on the vendor's spot
  const docs = await Household.find({ campaignId: c._id }).lean();
  const effort = await Effort.create({ organizationId: ctx.org._id, campaignId: c._id, name: 'E' });
  const pass = await Pass.create({ organizationId: ctx.org._id, campaignId: c._id, effortId: effort._id, roundNumber: 1, name: 'R1', status: 'active', activatedAt: new Date() });
  const book = await Turf.create({
    organizationId: ctx.org._id, campaignId: c._id, passId: pass._id, name: 'Book 1', mode: 'geometric', status: 'published',
    householdIds: docs.map((d) => d._id), doorCount: docs.length, centroid: { type: 'Point', coordinates: [T[1], T[0]] },
  });
  process.env.GEOCODE_ENABLED = 'true';
  answer(sentAs('80 Spruce St'), 36.3221, -116.0021);
  answer(sentAs('82 Spruce St'), 36.3231, -116.0031);
  const job = await runFile(c, rows);
  assert.strictEqual(job.pinsPlacedExact, 2);
  const after = await Turf.findById(book._id).lean();
  assert.notDeepStrictEqual(after.centroid.coordinates, [T[1], T[0]], 'the book was redrawn around the placed homes');
  assert.ok(Math.abs(after.centroid.coordinates[1] - 36.3226) < 1e-6, 'its centre is the placed homes');
});

test('14. a filed organization deletion request stops the buying; the marks stay', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Deleting');
  answer(sentAs('90 Larch St'), 36.331, -116.011);
  const request = await OrgDeletionRequest.create({ organizationId: ctx.org._id, scheduledFor: new Date(Date.now() + 86400e3), status: 'scheduled' });
  try {
    const job = await runFile(c, [row('DL1', '90 Larch St'), row('DL2', '92 Larch St')]);
    assert.strictEqual(job.status, 'completed');
    assert.strictEqual(geo.calls, 0, 'nothing bought once deletion was asked for');
    assert.strictEqual(job.pinsPlacedExact, 0);
    assert.strictEqual(job.pinsStillUnplaced, 2, 'the marks stay, so Pin Fixes still lists them');
  } finally {
    await OrgDeletionRequest.deleteOne({ _id: request._id });
  }
});
