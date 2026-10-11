import 'dotenv/config';
import mongoose from 'mongoose';

// How far off are Geocodio's street-level estimates, on THIS campaign's own known-good vendor rooftops?
// Run once per deployment to set PIN_INTERP_MIN_ACCURACY (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S9.1,
// S13.3): the floor a 'range_interpolation' answer needs before it may REPLACE a roughly-right spot.
//
//   npm run pins:measure-estimates -- --campaign=<id>                 # 300 homes (the default)
//   npm run pins:measure-estimates -- --campaign=<id> --sample=500 --seed=7
//
// It samples active doors whose pin came from the file and that carry no pin flag and no vouch (the
// vendor's ordinary pins), looks each address up through the import's own geocode service (cached
// answers are free; new ones are bought at the usual internal rate — the price is printed first), and
// prints, per answer class, the median and 90th-percentile distance between Geocodio's answer and the
// vendor's pin; for range_interpolation, the same over the answers at or above the current floor (the
// number the rule reads), the share at or above it, and the share the street test would refuse.
//
// The rule: if the 90th percentile for range_interpolation at accuracy ≥ the floor is under ~60 m, the
// default (0.8) stands; otherwise raise PIN_INTERP_MIN_ACCURACY in the Heroku dashboard and run again.
//
// Writes no household. Two side effects, as repair:import-pins has: new answers land in GeocodeCache
// (the shared, name-free address cache), and reading a cached answer refreshes its lastUsedAt.
// The design sampled "6-decimal" vendor pins; coordinates are floats once imported, so that filter cannot
// be applied here — the sample is simply unflagged, unvouched vendor pins.

// ── Arguments first: a bad or missing --campaign prints usage and exits BEFORE any database connection,
// so the root package.json proxy can be checked from the repo root with nothing configured.
const USAGE = 'Usage: npm run pins:measure-estimates -- --campaign=<24-character campaign id> [--sample=300] [--seed=1]';
const argv = process.argv.slice(2);
for (const a of argv) {
  if (/^--(campaign|sample|seed)=.+$/.test(a)) continue;
  console.error(`ERROR: unrecognized argument "${a}".\n${USAGE}`);
  process.exit(1);
}
const argOf = (name) => (argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || null;
const CAMPAIGN_ID = argOf('campaign');
if (!CAMPAIGN_ID || !/^[0-9a-f]{24}$/i.test(CAMPAIGN_ID)) {
  console.error(CAMPAIGN_ID ? `ERROR: --campaign=${CAMPAIGN_ID} is not a 24-character id.\n${USAGE}` : USAGE);
  process.exit(1);
}
const SAMPLE = Math.max(1, Math.min(5000, Number(argOf('sample')) || 300));
const SEED = Number(argOf('seed')) || 1;

const { connectDb } = await import('../config/db.js');
const { Household } = await import('../models/Household.js');
const { Campaign } = await import('../models/Campaign.js');
const { resolve, forecast, geocodeCostCents } = await import('../services/import/geocode/geocodeService.js');
const { answerClass } = await import('../services/households/pinTrust.js');
const { PIN_INTERP_MIN_ACCURACY } = await import('../services/import/geocode/geocodeFloors.js');
const { haversineMeters } = await import('../utils/normalizeAddress.js');
const { buildingKeyForCoords } = await import('../utils/buildingKey.js');
const { stackBaseOf, baseFamily, streetOfBase } = await import('../utils/streetName.js');
const { buildCohorts, isCohortOutlier } = await import('../utils/pinCohorts.js');
const { fileCoordRefusal } = await import('../utils/stateBounds.js');

// A seeded shuffle (mulberry32), so a re-run with the same seed samples the same homes.
const rng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const m = (v) => (v == null ? '—' : `${Math.round(v)} m`);

async function main() {
  await connectDb(process.env.MONGODB_URI);
  const campaign = await Campaign.findById(CAMPAIGN_ID, { name: 1 }).lean();
  if (!campaign) {
    console.error(`ERROR: no campaign with id ${CAMPAIGN_ID}.`);
    return 1;
  }
  const floor = PIN_INTERP_MIN_ACCURACY();

  // The campaign's evidence of where its streets are (the placement pass's rule), for the street test.
  const evidence = [];
  const pointOf = (h) => {
    const c = h.location.coordinates;
    return {
      id: String(h._id),
      lat: c[1],
      lng: c[0],
      street: streetOfBase(baseFamily(stackBaseOf(h.addressLine1))),
      zip5: String(h.zipCode ?? '').trim().slice(0, 5),
      spotKey: buildingKeyForCoords(c),
    };
  };
  const pool = [];
  for await (const h of Household.find(
    { campaignId: campaign._id, isActive: true, location: { $ne: null } },
    { location: 1, addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, normalizedAddress: 1, coordSource: 1, pinSuspect: 1, locationConfirmedAt: 1 }
  ).lean().cursor({ batchSize: 2000 })) {
    const c = h.location?.coordinates;
    if (!(c?.length === 2) || fileCoordRefusal({ lat: c[1], lng: c[0], state: h.state })) continue;
    if (!['placeholder', 'stray', 'unlocated'].includes(h.pinSuspect) && h.coordSource !== 'holding') evidence.push(pointOf(h));
    if (h.coordSource === 'file' && !h.pinSuspect && !h.locationConfirmedAt) pool.push(h);
  }
  const cohorts = buildCohorts(evidence, { zipFallback: true });

  const r = rng(SEED);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const sample = pool.slice(0, SAMPLE);
  console.log(`Campaign: ${campaign.name} — ${pool.length.toLocaleString()} vendor pins eligible, sampling ${sample.length} (seed ${SEED}).`);

  const probes = new Map();
  const byKey = new Map();
  for (const h of sample) {
    probes.set(h.normalizedAddress, {
      addressLine1: h.addressLine1, addressLine2: h.addressLine2, city: h.city, state: h.state, zipCode: h.zipCode,
      latitude: null, longitude: null,
    });
    byKey.set(h.normalizedAddress, h);
  }
  const f = await forecast(probes);
  console.log(
    `Lookups: ${f.cachedMatched + f.cachedUnmatched} cached (free), ${f.newToGeocode} new ` +
      `(about $${(geocodeCostCents(f.newToGeocode) / 100).toFixed(2)} at the internal rate). Looking them up…`
  );
  if (process.env.GEOCODE_ENABLED !== 'true') console.log('Note: GEOCODE_ENABLED is not true here — only cached answers can be read.');
  await resolve(probes);

  const byClass = new Map();
  for (const [na, p] of probes) {
    if (p.latitude == null || p.longitude == null) continue;
    const h = byKey.get(na);
    const cls = answerClass({ accuracyType: p.geocodeAccuracyType });
    const [lng, lat] = h.location.coordinates;
    const d = haversineMeters(lat, lng, p.latitude, p.longitude);
    const outlier = isCohortOutlier({ lat: p.latitude, lng: p.longitude }, cohorts.summaryFor(pointOf(h)));
    const list = byClass.get(cls) || [];
    list.push({ d, accuracy: p.geocodeAccuracy ?? null, outlier, type: p.geocodeAccuracyType });
    byClass.set(cls, list);
  }

  console.log('\nDistance between Geocodio\'s answer and the vendor\'s pin, by answer class:');
  for (const cls of ['exact', 'estimate', 'street']) {
    const list = byClass.get(cls) || [];
    const ds = list.map((x) => x.d);
    console.log(`  ${cls.padEnd(9)} ${String(list.length).padStart(5)} answers   median ${m(percentile(ds, 50)).padStart(7)}   90th pct ${m(percentile(ds, 90)).padStart(7)}`);
  }
  const interp = (byClass.get('estimate') || []).filter((x) => x.type === 'range_interpolation');
  const above = interp.filter((x) => (x.accuracy ?? 1) >= floor);
  const ds = above.map((x) => x.d);
  const p90 = percentile(ds, 90);
  console.log(`\nrange_interpolation at accuracy ≥ ${floor} (the current floor): ${above.length} of ${interp.length} answers`);
  console.log(`  median ${m(percentile(ds, 50))}   90th percentile ${m(p90)}`);
  console.log(`  share at or above the floor: ${interp.length ? Math.round((100 * above.length) / interp.length) : 0}%`);
  console.log(`  share the street test would refuse: ${above.length ? Math.round((100 * above.filter((x) => x.outlier).length) / above.length) : 0}%`);
  if (p90 == null) console.log('\nNot enough street-level answers in this sample to judge — try a larger --sample.');
  else if (p90 < 60) console.log(`\nThe 90th percentile is under ~60 m: the default floor (${floor}) stands. Nothing to change.`);
  else console.log(`\nThe 90th percentile is ${Math.round(p90)} m, over ~60 m: raise PIN_INTERP_MIN_ACCURACY in the Heroku dashboard (Settings → Config Vars) and run this again.`);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('ERROR:', err?.message || err);
  code = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
process.exit(code);
