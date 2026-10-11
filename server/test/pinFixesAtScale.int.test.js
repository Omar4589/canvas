import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import mongoose from 'mongoose';

// Pin Fixes at scale, end to end over the REAL import pipeline, the placement pass, the routes and a throwaway
// mongod, with Geocodio answered by a fake fetch (no network):
//   cd server && npm run test:int -- test/pinFixesAtScale.int.test.js
// Locks (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S11): refused file coordinates (0,0) are looked up or parked,
// never placed in the ocean; a holding spot is one per ZIP and reused; the answer ladder (a neighbour's roof is
// approximate, another town parks, the same city across a ZIP line places); the far rule (looked up, confirmed
// in place within 250 m, recomputed when the street fills in, frozen while set aside); condo complexes (formed,
// joined by a later file, formed despite release 1's distrusted keys); the bare-unit pair; the file-less
// Look up by address job; Set aside / Bring back and Re-include; the spot vouch; the badge; the cut toggle's
// clause; and both knock writers' frozen pin stamp.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-pinfixes-at-scale';
process.env.GEOCODIO_API_KEY = 'test-key-not-real';
process.env.QUEUE_ENQUEUE_TIMEOUT_MS = '300';

const { createApp } = await import('../src/app.js');
const { signUserToken } = await import('../src/services/auth/tokens.js');
const { processImportJob } = await import('../src/services/import/importProcessor.js');
const { saveRawImport } = await import('../src/services/import/rawImportStore.js');
const { DEFAULT_PROFILE_MAPPING } = await import('../src/services/import/canonicalFields.js');
const { setAsidePins } = await import('../src/services/households/setAsidePin.js');
const { cutExclusionFilter } = await import('../src/services/turf/generateTurf.js');
const { KNOCKABLE_DOOR_FILTER } = await import('../src/services/canvass/knockableDoorFilter.js');
const { NEEDS_PIN_FIX } = await import('../src/services/households/confirmHouseholdLocation.js');
const { buildingKeyForCoords } = await import('../src/utils/buildingKey.js');
const { haversineMeters, normalizeAddress } = await import('../src/utils/normalizeAddress.js');
const { Organization } = await import('../src/models/Organization.js');
const { Subscription } = await import('../src/models/Subscription.js');
const { User } = await import('../src/models/User.js');
const { Membership } = await import('../src/models/Membership.js');
const { Campaign } = await import('../src/models/Campaign.js');
const { CampaignManager } = await import('../src/models/CampaignManager.js');
const { CampaignAssignment } = await import('../src/models/CampaignAssignment.js');
const { SurveyTemplate } = await import('../src/models/SurveyTemplate.js');
const { ImportJob } = await import('../src/models/ImportJob.js');
const { Household } = await import('../src/models/Household.js');
const { HouseholdLocationChange } = await import('../src/models/HouseholdLocationChange.js');
const { Voter } = await import('../src/models/Voter.js');
const { Person } = await import('../src/models/Person.js');
const { GeocodeCache } = await import('../src/models/GeocodeCache.js');
const { Effort } = await import('../src/models/Effort.js');
const { Pass } = await import('../src/models/Pass.js');
const { Turf } = await import('../src/models/Turf.js');
const { TurfAssignment } = await import('../src/models/TurfAssignment.js');
const { CanvassActivity } = await import('../src/models/CanvassActivity.js');
const { SurveyResponse } = await import('../src/models/SurveyResponse.js');
const { OrgDeletionRequest } = await import('../src/models/OrgDeletionRequest.js');

const URI = process.env.MONGODB_URI_TEST;
const skip = URI ? false : 'set MONGODB_URI_TEST to run (needs a throwaway mongod)';
const ctx = {};
let server;
let base;

// ── Geocodio, faked: answers by the exact address string resolve() sends. ──
const realFetch = globalThis.fetch;
const geo = { answers: new Map(), calls: 0, sent: [] };
const answer = (address, lat, lng, type = 'rooftop', { accuracy = 1, matched = address } = {}) =>
  geo.answers.set(address, { lat, lng, type, accuracy, matched });
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.geocod.io/')) return realFetch(url, init);
  geo.calls += 1;
  const body = JSON.parse(init.body);
  const results = {};
  for (const [k, address] of Object.entries(body)) {
    geo.sent.push(address);
    const a = geo.answers.get(address);
    results[k] = {
      response: {
        results: a ? [{ location: { lat: a.lat, lng: a.lng }, accuracy: a.accuracy, accuracy_type: a.type, formatted_address: a.matched }] : [],
      },
    };
  }
  return new Response(JSON.stringify({ results }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const resetGeo = () => Object.assign(geo, { calls: 0, sent: [] });

// ── Files: Pahrump, NV 89061. ──
const CSV_HEADER = 'State Voter ID,First Name,Last Name,Phone,Party,Address,City,Registered State,Zip Code,p_Latitude,p_Longitude';
let svidSeq = 0;
const row = (address, lat, lng) => ({ svid: `PF${(svidSeq += 1)}`, address, lat, lng });
const csvOf = (rows) =>
  Buffer.from(
    [
      CSV_HEADER,
      ...rows.map((r) =>
        [r.svid, 'Pat', r.svid, '', '', r.address, 'Pahrump', 'NV', '89061', r.lat == null ? '' : r.lat.toFixed(6), r.lng == null ? '' : r.lng.toFixed(6)].join(',')
      ),
    ].join('\n'),
    'utf8'
  );
const sentAs = (address) => `${address}, Pahrump, NV 89061`;
const keyOf = ([lat, lng]) => buildingKeyForCoords([lng, lat]);
const street = (name, n, [lat, lng], step = 0.0005, first = 10) =>
  Array.from({ length: n }, (_, i) => row(`${first + i * 2} ${name}`, lat + i * step, lng));

const newCampaign = async (name, { grantLead = false } = {}) => {
  const c = await Campaign.create({ organizationId: ctx.org._id, name, type: 'survey', state: 'NV', isActive: true, surveyTemplateId: ctx.template._id });
  if (grantLead) await CampaignManager.create({ campaignId: c._id, userId: ctx.lead._id, organizationId: ctx.org._id, grantedBy: ctx.admin._id });
  return c;
};
async function runFile(campaign, rows) {
  const job = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: campaign._id, filename: 'pins.csv', kind: 'apply', status: 'pending', fieldMapping: DEFAULT_PROFILE_MAPPING,
  });
  await saveRawImport(job._id, 'pins.csv', csvOf(rows));
  await processImportJob({ id: `pf-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return ImportJob.findById(job._id).lean();
}
async function runLookup(campaign, ids) {
  const job = await ImportJob.create({
    organizationId: ctx.org._id, campaignId: campaign._id, kind: 'pin_lookup', status: 'pending', pinLookupTargets: ids.map(String), totalRows: ids.length,
  });
  await processImportJob({ id: `pl-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  return ImportJob.findById(job._id).lean();
}
const door = (campaign, address) => Household.findOne({ campaignId: campaign._id, addressLine1: address }).lean();
const loc = (d) => d.location.coordinates;
const metersBetween = ([lng1, lat1], [lng2, lat2]) => haversineMeters(lat1, lng1, lat2, lng2);

async function call(method, path, { token = ctx.adminTok, body } = {}) {
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

before(async () => {
  if (!URI) return;
  await mongoose.connect(URI);
  await Promise.all([Voter.syncIndexes(), Household.syncIndexes(), Person.syncIndexes(), GeocodeCache.syncIndexes()]);
  for (const M of [Organization, Subscription, User, Membership, Campaign, CampaignManager, CampaignAssignment, SurveyTemplate, ImportJob, Household, HouseholdLocationChange, Voter, Person, GeocodeCache, Effort, Pass, Turf, TurfAssignment, CanvassActivity, SurveyResponse, OrgDeletionRequest]) {
    await M.deleteMany({});
  }
  const org = await Organization.create({ name: 'At Scale Org', slug: 'at-scale-org', isActive: true });
  await Subscription.create({ organizationId: org._id, status: 'internal' });
  const template = await SurveyTemplate.create({ organizationId: org._id, name: 'Scale Survey', questions: [], isActive: true });
  const admin = await User.create({ firstName: 'Ada', lastName: 'Admin', email: 'sa@t.co', passwordHash: 'x', isActive: true });
  const lead = await User.create({ firstName: 'Lee', lastName: 'Lead', email: 'sl@t.co', passwordHash: 'x', isActive: true });
  const canv = await User.create({ firstName: 'Cal', lastName: 'Walker', email: 'sc@t.co', passwordHash: 'x', isActive: true });
  await Membership.create({ userId: admin._id, organizationId: org._id, role: 'admin', isActive: true });
  await Membership.create({ userId: lead._id, organizationId: org._id, role: 'lead', isActive: true });
  await Membership.create({ userId: canv._id, organizationId: org._id, role: 'canvasser', isActive: true });
  Object.assign(ctx, { org, template, admin, lead, canv, adminTok: signUserToken(admin), leadTok: signUserToken(lead), canvTok: signUserToken(canv) });
  process.env.GEOCODE_ENABLED = 'true';
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  if (server) await new Promise((r) => server.close(r));
  if (URI) await mongoose.disconnect();
});

// ── Refused file coordinates and the holding spot ───────────────────────────────────────────────────

test('1. a 0,0 row: a rooftop places it, an estimate places it as approximate, no answer parks it at the ZIP\'s holding spot', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Zeroes');
  answer(sentAs('10 Zero Rd'), 36.2012, -116.0012);
  answer(sentAs('12 Zero Rd'), 36.2016, -116.0016, 'range_interpolation', { accuracy: 0.6 });
  const oak = street('Oak St', 6, [36.2, -116.0]);
  const job = await runFile(c, [...oak, row('10 Zero Rd', 0, 0), row('12 Zero Rd', 0, 0), row('14 Zero Rd', 0, 0)]);
  assert.strictEqual(job.status, 'completed', JSON.stringify(job.errors));
  assert.strictEqual(job.offWorldDoors, 3, 'the preview counted the three zeros');
  assert.strictEqual(job.errorCount, 0, 'nothing was dropped');
  const z1 = await door(c, '10 Zero Rd');
  assert.deepStrictEqual([z1.coordSource, z1.coordConfidence, z1.pinSuspect], ['geocodio', 'exact', undefined]);
  assert.deepStrictEqual(loc(z1), [-116.0012, 36.2012]);
  const z2 = await door(c, '12 Zero Rd');
  assert.strictEqual(z2.coordConfidence, 'interpolated', 'a 0.6 estimate fills a home with no location');
  assert.ok(await Household.exists({ _id: z2._id, ...NEEDS_PIN_FIX }), 'listed as approximate');
  const z3 = await door(c, '14 Zero Rd');
  assert.strictEqual(z3.coordSource, 'holding');
  assert.strictEqual(z3.pinSuspect, 'unlocated', 'kept unlocated through the same import\'s pass');
  assert.ok(metersBetween(loc(z3), [-116.0, 36.20125]) < 1000, 'parked in the middle of the ZIP\'s homes, not the ocean');
  assert.strictEqual(job.pinsUnlocated, 1);
  assert.strictEqual(job.pinsStillUnplaced, 1);
  ctx.zero = { c, holding: loc(z3) };
});

test('2. a second file reuses the ZIP\'s holding spot; a still-unplaceable home stays parked; a now-placeable one is placed by the file', { skip }, async () => {
  resetGeo();
  const { c, holding } = ctx.zero;
  const again = await runFile(c, [row('14 Zero Rd', 0, 0), row('16 Zero Rd', 0, 0)]);
  assert.strictEqual(again.status, 'completed', JSON.stringify(again.errors));
  assert.deepStrictEqual(loc(await door(c, '16 Zero Rd')), holding, 'one holding spot per ZIP per campaign');
  const z3 = await door(c, '14 Zero Rd');
  assert.deepStrictEqual([z3.coordSource, z3.pinSuspect], ['holding', 'unlocated']);
  assert.deepStrictEqual(loc(z3), holding);
  // Thirty days on, the address resolves.
  await GeocodeCache.deleteMany({});
  answer(sentAs('14 Zero Rd'), 36.2021, -116.0021);
  const placed = await runFile(c, [row('14 Zero Rd', 0, 0)]);
  assert.strictEqual(placed.status, 'completed');
  const after = await door(c, '14 Zero Rd');
  assert.deepStrictEqual([after.coordSource, after.pinSuspect], ['geocodio', undefined]);
  assert.deepStrictEqual(loc(after), [-116.0021, 36.2021]);
  assert.strictEqual(after.pinPlacement.kind, 'unlocated');
});

test('3. coordinate-less rows: a neighbour\'s roof imports as approximate; another town parks; the same city across a ZIP line places', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('No coords');
  answer(sentAs('1 Roof Ln'), 36.2505, -116.0205, 'nearest_rooftop_match');
  answer(sentAs('2 Town Rd'), 36.17, -115.14, 'rooftop', { matched: '2 Town Rd, Las Vegas, NV 89101' });
  answer(sentAs('3 Line Rd'), 36.2508, -116.0208, 'rooftop', { matched: '3 Line Rd, Pahrump, NV 89048' });
  const job = await runFile(c, [
    ...street('Birch St', 3, [36.25, -116.02]),
    row('1 Roof Ln', null, null),
    row('2 Town Rd', null, null),
    row('3 Line Rd', null, null),
  ]);
  assert.strictEqual(job.status, 'completed', JSON.stringify(job.errors));
  const roof = await door(c, '1 Roof Ln');
  assert.deepStrictEqual([roof.coordSource, roof.coordConfidence], ['geocodio', 'interpolated']);
  const town = await door(c, '2 Town Rd');
  assert.deepStrictEqual([town.coordSource, town.pinSuspect], ['holding', 'unlocated']);
  const line = await door(c, '3 Line Rd');
  assert.deepStrictEqual([line.coordSource, line.coordConfidence, line.pinSuspect], ['geocodio', 'exact', undefined]);
});

// ── Far from its street ─────────────────────────────────────────────────────────────────────────────

const ELM = [36.3, -116.1];
const alongElm = (n, first) => Array.from({ length: n }, (_, i) => {
  const t = (i + 1) / (n + 1);
  return row(`${first + i * 2} Elm St`, 36.3 + t * 0.16, -116.1 - t * 0.16);
});

test('4. far: looked up and placed; a rooftop within 250 m confirms the pin where it is; no answer stays far', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Far');
  answer(sentAs('99 Elm St'), 36.3032, -116.1);
  answer(sentAs('101 Elm St'), 36.4605, -116.2605);
  const job = await runFile(c, [...street('Elm St', 6, ELM), row('99 Elm St', 36.45, -116.25), row('101 Elm St', 36.46, -116.26), row('103 Elm St', 36.47, -116.27)]);
  assert.strictEqual(job.status, 'completed', JSON.stringify(job.errors));
  assert.strictEqual(job.farPinDoors, 3, 'the preview counted three homes far from their street');
  assert.strictEqual(job.pinsFarMarked, 3);
  const f1 = await door(c, '99 Elm St');
  assert.deepStrictEqual([f1.coordSource, f1.pinSuspect, f1.pinPlacement.kind, f1.pinPlacement.answer], ['geocodio', undefined, 'far', 'exact']);
  assert.deepStrictEqual(loc(f1), [-116.1, 36.3032]);
  const f2 = await door(c, '101 Elm St');
  assert.deepStrictEqual(loc(f2), [-116.26, 36.46], 'confirmed in place: the pin stands');
  assert.deepStrictEqual([f2.coordSource, f2.pinSuspect], ['geocodio', undefined]);
  const f3 = await door(c, '103 Elm St');
  assert.deepStrictEqual([f3.coordSource, f3.pinSuspect], ['file', 'far']);
  assert.strictEqual(job.pinsPlacedExact, 1);
  assert.strictEqual(job.pinsConfirmedInPlace, 1);
  assert.strictEqual(job.pinsStillUnplaced, 1);
  ctx.far = { c };
});

test('5. far is recomputed, never sticky: when the street evidence that made a home far is gone, the mark goes', { skip }, async () => {
  resetGeo();
  const { c } = ctx.far;
  // The cluster that made 103 Elm St an outlier leaves the campaign (its residents moved away).
  const cluster = (await Household.find({ campaignId: c._id, addressLine1: { $in: ['10 Elm St', '12 Elm St', '14 Elm St', '16 Elm St', '18 Elm St', '20 Elm St', '99 Elm St'] } }, { _id: 1 }).lean()).map((d) => d._id);
  await Household.updateMany({ _id: { $in: cluster } }, { $set: { isActive: false } });
  const f3 = await door(c, '103 Elm St');
  const job = await runLookup(c, [f3._id]);
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.pinsFarMarked, 0);
  assert.strictEqual((await door(c, '103 Elm St')).pinSuspect, undefined, 'no cohort, no opinion: the mark is cleared');
});

test('6. a set-aside far home keeps its flag through a pass, and stays out of cuts', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Far aside');
  await runFile(c, [...street('Elm St', 6, ELM), row('103 Elm St', 36.47, -116.27)]);
  const f = await door(c, '103 Elm St');
  assert.strictEqual(f.pinSuspect, 'far');
  assert.strictEqual((await setAsidePins({ campaignId: c._id, householdIds: [f._id], byUserId: ctx.admin._id })).updated, 1);
  await runFile(c, alongElm(6, 150));
  const after = await door(c, '103 Elm St');
  assert.strictEqual(after.pinSuspect, 'far', 'set aside: frozen');
  assert.strictEqual(after.excludedFromTurf, true);
  assert.ok(after.pinSetAside?.at);
});

// ── Condo complexes ─────────────────────────────────────────────────────────────────────────────────

const S5 = [36.35, -116.05];
const P5 = [36.351, -116.051];

test('7. three addresses on one vendor spot whose rooftops are one point form a complex on that point', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Complex', { grantLead: true });
  for (const n of [10, 11, 12]) answer(sentAs(`${n} Woods Dr`), P5[0], P5[1]);
  const job = await runFile(c, [10, 11, 12].map((n) => row(`${n} Woods Dr`, S5[0], S5[1])));
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.pinsComplex, 3);
  assert.strictEqual(job.pinsPlacedExact, 0);
  for (const n of [10, 11, 12]) {
    const d = await door(c, `${n} Woods Dr`);
    assert.deepStrictEqual([d.pinSuspect, d.pinComplexKey, d.coordSource, d.coordConfidence], ['complex', keyOf(P5), 'geocodio', 'exact']);
    assert.deepStrictEqual(loc(d), [P5[1], P5[0]]);
    assert.strictEqual(d.pinDistrustedKeys, undefined);
  }
  ctx.cx = { c };
});

test('8. a later file\'s home whose exact answer is the complex\'s point joins it; nobody is reverted', { skip }, async () => {
  resetGeo();
  const { c } = ctx.cx;
  answer(sentAs('13 Woods Dr'), P5[0], P5[1]);
  const job = await runFile(c, [row('13 Woods Dr', 0, 0)]);
  assert.strictEqual(job.status, 'completed');
  const joined = await door(c, '13 Woods Dr');
  assert.deepStrictEqual([joined.pinSuspect, joined.pinComplexKey], ['complex', keyOf(P5)]);
  for (const n of [10, 11, 12]) {
    const d = await door(c, `${n} Woods Dr`);
    assert.deepStrictEqual([d.pinSuspect, d.coordSource], ['complex', 'geocodio']);
    assert.deepStrictEqual(loc(d), [P5[1], P5[0]]);
    assert.strictEqual(d.pinDistrustedKeys, undefined);
  }
});

test('9. Look up by address runs with no file: release 1\'s distrusted keys do not stop a complex, and a second run buys nothing', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Legacy complex');
  const S = [36.4, -116.2];
  const P = [36.401, -116.201];
  const docs = await Household.insertMany([20, 21, 22].map((n) => ({
    organizationId: ctx.org._id, campaignId: c._id, addressLine1: `${n} Glenrock`, city: 'Pahrump', state: 'NV', zipCode: '89061',
    normalizedAddress: `${n} GLENROCK|PAHRUMP|NV|89061`, location: { type: 'Point', coordinates: [S[1], S[0]] },
    coordSource: 'file', pinSuspect: 'placeholder', pinDistrustedKeys: [keyOf(P)], isActive: true, status: 'unknocked',
  })));
  for (const n of [20, 21, 22]) answer(sentAs(`${n} Glenrock`), P[0], P[1]);
  const job = await runLookup(c, docs.map((d) => d._id));
  assert.strictEqual(job.status, 'completed', job.lastError || '');
  assert.strictEqual(job.pinsComplex, 3);
  for (const d of await Household.find({ _id: { $in: docs.map((x) => x._id) } }).lean()) {
    assert.deepStrictEqual([d.pinSuspect, d.pinComplexKey], ['complex', keyOf(P)]);
  }
  resetGeo();
  const again = await runLookup(c, docs.map((d) => d._id));
  assert.strictEqual(again.status, 'completed');
  assert.strictEqual(geo.calls, 0, 'cached: nothing bought');
});

test('10. a bare unit number glued to the street line is one address: the pair places, no complex', { skip }, async () => {
  resetGeo();
  const c = await newCampaign('Bare unit');
  const S6 = [36.45, -116.3];
  const Q = [36.4512, -116.3012];
  answer(sentAs('533 Black Rock Tpke'), Q[0], Q[1]);
  answer(sentAs('533 Black Rock Tpke 3'), Q[0], Q[1]);
  answer(sentAs('20 Pine St'), 36.4521, -116.3021);
  answer(sentAs('22 Pine St'), 36.4522, -116.3022);
  const job = await runFile(c, ['533 Black Rock Tpke', '533 Black Rock Tpke 3', '20 Pine St', '22 Pine St'].map((a) => row(a, S6[0], S6[1])));
  assert.strictEqual(job.status, 'completed');
  assert.strictEqual(job.pinsComplex, 0);
  for (const a of ['533 Black Rock Tpke', '533 Black Rock Tpke 3']) {
    const d = await door(c, a);
    assert.deepStrictEqual([d.coordSource, d.pinSuspect], ['geocodio', undefined], a);
    assert.deepStrictEqual(loc(d), [Q[1], Q[0]]);
  }
});

// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────

test('11. the Pin Fixes payload lists a complex once, and the badge counts it once', { skip }, async () => {
  const { c } = ctx.cx;
  const r = await call('GET', `/admin/campaigns/${c._id}/households/pin-fixes`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.complexCount, 1);
  assert.strictEqual(r.json.complexes[0].count, 4);
  assert.strictEqual(r.json.complexes[0].key, keyOf(P5));
  assert.strictEqual(r.json.complexes[0].rows.every((x) => x.pinSuspect === 'complex' && x.complexKey === keyOf(P5)), true);
  assert.deepStrictEqual(r.json.setAside, []);
  const list = await call('GET', '/admin/campaigns');
  const mine = list.json.campaigns.find((x) => String(x._id) === String(c._id));
  assert.strictEqual(mine.pinsToFix, r.json.total + r.json.complexCount);
  assert.strictEqual(mine.complexCount, 1);
});

test('12. the spot vouch confirms every member of a complex, and its undo clears them all', { skip }, async () => {
  const { c } = ctx.cx;
  const one = await door(c, '10 Woods Dr');
  const r = await call('POST', `/admin/campaigns/${c._id}/households/${one._id}/confirm-location`, {
    token: ctx.leadTok,
    body: { scope: 'spot', expectedCoordinates: loc(one) },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.updated, 4);
  assert.strictEqual(await Household.countDocuments({ campaignId: c._id, pinSuspect: 'complex', locationConfirmedAt: { $ne: null } }), 4);
  assert.strictEqual((await call('GET', `/admin/campaigns/${c._id}/households/pin-fixes`)).json.complexCount, 0);
  const undo = await call('POST', `/admin/campaigns/${c._id}/households/${one._id}/confirm-location`, { body: { scope: 'spot', confirmed: false } });
  assert.strictEqual(undo.status, 200);
  assert.strictEqual(await Household.countDocuments({ campaignId: c._id, pinSuspect: 'complex', locationConfirmedAt: null }), 4);
});

test('13. Look up by address: 202 or 503 here (no Redis), a job with no file that runs; lookups off 409; nothing 400; no undo', { skip }, async () => {
  const { c } = ctx.zero;
  const parked = await door(c, '16 Zero Rd');
  const r = await call('POST', `/admin/campaigns/${c._id}/households/pin-lookup`, { body: { group: 'unlocated' } });
  assert.ok([202, 503].includes(r.status), `status ${r.status} ${JSON.stringify(r.json)}`);
  const job = await ImportJob.findById(r.json.jobId).lean();
  assert.deepStrictEqual([job.kind, job.filename, job.pinLookupTargets], ['pin_lookup', null, [String(parked._id)]]);
  if (r.status === 503) assert.strictEqual(job.status, 'failed', 'a job the queue refused is marked failed');
  await ImportJob.updateOne({ _id: job._id }, { $set: { status: 'pending' } });
  await processImportJob({ id: `r-${job._id}`, data: { importJobId: job._id }, updateProgress: async () => {} });
  const done = await ImportJob.findById(job._id).lean();
  assert.strictEqual(done.status, 'completed');
  assert.strictEqual(done.pinsStillUnplaced, 1);
  const undo = await call('POST', `/admin/imports/${job._id}/undo`);
  assert.deepStrictEqual([undo.status, undo.json.code], [400, 'NOTHING_TO_UNDO']);
  const none = await call('POST', `/admin/campaigns/${c._id}/households/pin-lookup`, { body: { group: 'far' } });
  assert.deepStrictEqual([none.status, none.json.code], [400, 'NOTHING_TO_LOOK_UP']);
  process.env.GEOCODE_ENABLED = 'false';
  try {
    const off = await call('POST', `/admin/campaigns/${c._id}/households/pin-lookup`, { body: { group: 'unlocated' } });
    assert.deepStrictEqual([off.status, off.json.code], [409, 'LOOKUPS_OFF']);
  } finally {
    process.env.GEOCODE_ENABLED = 'true';
  }
  const canv = await call('POST', `/admin/campaigns/${c._id}/households/pin-lookup`, { token: ctx.canvTok, body: { group: 'unlocated' } });
  assert.strictEqual(canv.status, 403);
});

// A campaign with a walk list and a round, for the set-aside, Re-include, cut and knock cases.
async function campaignWithRound(name) {
  const c = await newCampaign(name, { grantLead: true });
  const effort = await Effort.create({ organizationId: ctx.org._id, campaignId: c._id, name: 'North' });
  const pass = await Pass.create({ organizationId: ctx.org._id, campaignId: c._id, effortId: effort._id, roundNumber: 1, name: 'Round 1', status: 'active' });
  const mk = (n, lat, extra = {}) => ({
    organizationId: ctx.org._id, campaignId: c._id, effortId: effort._id, addressLine1: `${n} Round Rd`, city: 'Pahrump', state: 'NV', zipCode: '89061',
    normalizedAddress: `${n} ROUND RD|PAHRUMP|NV|89061`, location: { type: 'Point', coordinates: [-116.4, lat] }, coordSource: 'file',
    isActive: true, status: 'unknocked', ...extra,
  });
  const [plain, far, apt, complexDoor, vouched, est] = await Household.insertMany([
    mk(1, 36.5),
    mk(3, 36.501, { pinSuspect: 'far' }),
    mk(5, 36.502, { excludedFromTurf: true }),
    mk(7, 36.503, { pinSuspect: 'complex', pinComplexKey: 'K7', coordSource: 'geocodio', coordConfidence: 'exact' }),
    mk(9, 36.504, { pinSuspect: 'far', locationConfirmedAt: new Date(), locationConfirmedBy: ctx.admin._id }),
    mk(11, 36.505, { coordSource: 'geocodio', coordConfidence: 'interpolated' }),
  ]);
  return { c, effort, pass, plain, far, apt, complexDoor, vouched, est };
}

test('14. Set aside and Bring back; Re-include never sweeps a set-aside home; a move or a confirm brings it back', { skip }, async () => {
  const k = await campaignWithRound('Aside');
  const base = `/admin/campaigns/${k.c._id}/households`;
  assert.strictEqual((await call('POST', `${base}/set-aside`, { token: ctx.canvTok, body: { householdIds: [String(k.far._id)] } })).status, 403);
  const aside = await call('POST', `${base}/set-aside`, { token: ctx.leadTok, body: { householdIds: [String(k.far._id), String(k.plain._id)] } });
  assert.deepStrictEqual([aside.status, aside.json.updated], [200, 1], 'only a door the queue could show');
  const list = await call('GET', `${base}/pin-fixes`);
  assert.ok(!list.json.households.some((h) => h.id === String(k.far._id)), 'out of the queue');
  assert.deepStrictEqual(list.json.setAside.map((h) => h.id), [String(k.far._id)]);
  const turfs = await call('GET', `/admin/campaigns/${k.c._id}/turfs?passId=${k.pass._id}&slim=1`);
  assert.strictEqual(turfs.json.excludedApartmentCount, 1, 'a set-aside home is not an apartment');
  const inc = await call('POST', `/admin/campaigns/${k.c._id}/turfs/include-apartments`, { body: { passId: String(k.pass._id) } });
  assert.deepStrictEqual([inc.status, inc.json.included], [200, 1]);
  assert.strictEqual((await Household.findById(k.far._id).lean()).excludedFromTurf, true, 'Re-include left it out');
  const back = await call('POST', `${base}/bring-back`, { body: { householdIds: [String(k.far._id)] } });
  assert.strictEqual(back.json.updated, 1);
  const b = await Household.findById(k.far._id).lean();
  assert.deepStrictEqual([b.excludedFromTurf, b.pinSetAside], [false, undefined]);
  await call('POST', `${base}/set-aside`, { body: { householdIds: [String(k.far._id)] } });
  const moved = await call('PATCH', `${base}/${k.far._id}/location`, { body: { lat: 36.5011, lng: -116.4011 } });
  assert.strictEqual(moved.status, 200, JSON.stringify(moved.json));
  const m = await Household.findById(k.far._id).lean();
  assert.deepStrictEqual([m.excludedFromTurf, m.pinSetAside, m.pinSuspect, m.coordSource], [false, undefined, undefined, 'corrected']);
});

test('15. the cut toggle leaves out flagged, unvouched homes; a complex and a vouched home cut; the summary says how many', { skip }, async () => {
  const k = await campaignWithRound('Cut');
  const cut = await Household.find(
    { campaignId: k.c._id, effortId: k.effort._id, ...KNOCKABLE_DOOR_FILTER, ...(await cutExclusionFilter({ excludeUnplaced: true })) },
    { addressLine1: 1 }
  ).lean();
  assert.deepStrictEqual(cut.map((d) => d.addressLine1).sort(), ['11 Round Rd', '1 Round Rd', '7 Round Rd', '9 Round Rd'].sort());
  const all = await Household.countDocuments({ campaignId: k.c._id, effortId: k.effort._id, ...KNOCKABLE_DOOR_FILTER, ...(await cutExclusionFilter({})) });
  assert.strictEqual(all, 5, 'without the toggle, today\'s cut');
  const turfs = await call('GET', `/admin/campaigns/${k.c._id}/turfs?passId=${k.pass._id}&slim=1`);
  assert.strictEqual(turfs.json.unplacedDoorCount, 1);
  assert.strictEqual(turfs.json.supplementalUnplacedCount, 1);
});

test('16. both knock writers freeze the pin: estimated, complex, or nothing', { skip }, async () => {
  const k = await campaignWithRound('Knocks');
  await CampaignAssignment.create({ organizationId: ctx.org._id, campaignId: k.c._id, userId: ctx.canv._id });
  const turf = await Turf.create({
    organizationId: ctx.org._id, campaignId: k.c._id, passId: k.pass._id, name: 'Book', mode: 'geometric', status: 'published',
    householdIds: [k.plain._id, k.complexDoor._id, k.est._id], doorCount: 3,
  });
  await TurfAssignment.create({ organizationId: ctx.org._id, campaignId: k.c._id, passId: k.pass._id, turfId: turf._id, userId: ctx.canv._id });
  const voter = await Voter.create({ organizationId: ctx.org._id, campaignId: k.c._id, householdId: k.est._id, stateVoterId: 'KN1', firstName: 'Vi', lastName: 'Voter', fullName: 'Vi Voter' });
  let minute = 0;
  const ts = () => new Date(Date.now() - 3600_000 + (minute += 1) * 60_000).toISOString();
  const at = (d) => ({ lat: d.location.coordinates[1] + 0.00002, lng: d.location.coordinates[0], accuracy: 5 });
  for (const d of [k.plain, k.complexDoor, k.est]) {
    const r = await call('POST', `/mobile/households/${d._id}/not-home`, { token: ctx.canvTok, body: { location: at(d), timestamp: ts() } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.json));
  }
  const stamp = async (d) => (await CanvassActivity.findOne({ householdId: d._id, actionType: 'not_home' }).lean()).knockPin;
  assert.strictEqual(await stamp(k.plain), undefined);
  assert.strictEqual(await stamp(k.complexDoor), 'complex');
  assert.strictEqual(await stamp(k.est), 'estimated');
  const s = await call('POST', `/mobile/voters/${voter._id}/survey`, {
    token: ctx.canvTok,
    body: { surveyTemplateId: String(ctx.template._id), answers: [], location: at(k.est), timestamp: ts() },
  });
  assert.strictEqual(s.status, 201, JSON.stringify(s.json));
  const survey = await CanvassActivity.findOne({ householdId: k.est._id, actionType: 'survey_submitted' }).lean();
  assert.strictEqual(survey.knockPin, 'estimated');
});

// ── The Map page's camera (found by the browser check: a 0,0 door framed the Atlantic) ─────────────────

test('17. the campaign door extent the Map page frames on leaves a door at 0,0 out', { skip }, async () => {
  const c = await newCampaign('Extent');
  const mk = (addressLine1, lng, lat) => {
    const a = { addressLine1, addressLine2: null, city: 'Pahrump', state: 'NV', zipCode: '89061' };
    return { organizationId: ctx.org._id, campaignId: c._id, ...a, normalizedAddress: normalizeAddress(a), location: { type: 'Point', coordinates: [lng, lat] }, isActive: true };
  };
  await Household.insertMany([mk('1 Extent St', -116.0, 36.2), mk('3 Extent St', -116.01, 36.21), mk('5 Extent St', 0, 0)]);
  const r = await call('GET', `/admin/households/map?campaignId=${c._id}&includeBounds=1`);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.deepStrictEqual(r.json.bounds, { minLng: -116.01, minLat: 36.2, maxLng: -116.0, maxLat: 36.21 });
  assert.strictEqual(r.json.households.length, 3, 'the 0,0 door is still on the map — only the camera ignores it');
});

test('18. the import list leaves Look up by address runs out unless asked: the Exports and phone pickers never offer one', { skip }, async () => {
  const c = await newCampaign('Lookup list');
  const real = await ImportJob.create({ organizationId: ctx.org._id, campaignId: c._id, filename: 'real.csv', kind: 'apply', status: 'completed' });
  const lookup = await ImportJob.create({ organizationId: ctx.org._id, campaignId: c._id, kind: 'pin_lookup', status: 'completed', totalRows: 3, pinLookupTargets: [] });
  const plain = await call('GET', `/admin/imports?campaignId=${c._id}`);
  assert.strictEqual(plain.status, 200);
  assert.deepStrictEqual(plain.json.jobs.map((j) => String(j._id)), [String(real._id)]);
  const withLookups = await call('GET', `/admin/imports?campaignId=${c._id}&includeLookups=1`);
  assert.deepStrictEqual(withLookups.json.jobs.map((j) => String(j._id)).sort(), [String(real._id), String(lookup._id)].sort());
  assert.ok(withLookups.json.jobs.every((j) => j.pinLookupTargets === undefined), 'the target ids stay hidden');
});
