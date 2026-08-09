import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { User } from '../models/User.js';
import { Household } from '../models/Household.js';
import { CanvassActivity } from '../models/CanvassActivity.js';
import { haversineMeters } from '../utils/normalizeAddress.js';
import { inStateBounds } from '../utils/stateBounds.js';
import { streetOf } from '../utils/streetName.js';
import { buildingKeyForCoords } from '../utils/buildingKey.js';
import { resolve as geocodeResolve, geocodeCostCents } from '../services/import/geocode/geocodeService.js';
import { updateHouseholdLocation } from '../services/households/updateHouseholdLocation.js';

// Find — and optionally fix — doors that an import pinned in the wrong place.
//
// WHY THESE EXIST. Several voters share an address, so several CSV rows collapse into one
// Household. They are supposed to carry the same pin, but files disagree, and the importer
// used to keep whichever row it saw first, silently. One bad row that sorted first pinned the
// door miles away with no error and no counter — and the geocoder never re-checks a door that
// already HAS coordinates, so nothing downstream ever caught it. The importer now decides by
// majority vote and state bounds (see services/import/csvImporter.js resolveCoordConflicts),
// but that only helps NEW imports, and it deliberately cannot settle a 1-vs-1 tie from the
// file alone. This script is what settles those, and what cleans up doors imported before the
// fix. The original CSV is NOT recoverable — the raw upload is deleted on a successful import
// — so this re-derives the truth from the door's neighbours and from the address itself.
//
//   npm run repair:import-pins                                   # dry run, cache-only — report, no writes
//   npm run repair:import-pins -- --campaign=<id>                # one campaign
//   npm run repair:import-pins -- --org=<slug>                   # one org
//   npm run repair:import-pins -- --geocode                      # allow PAID Geocodio lookups
//   npm run repair:import-pins -- --apply --user=<userId>        # fix confirmed doors
//   npm run repair:import-pins -- --min-meters=250               # confirm threshold (default 250)
//
// HOW A DOOR IS SHORTLISTED (any one signal is enough — all three are only suspicion):
//   1. Out of state       — the pin isn't inside its own state's bounding box.
//   2. Street outlier     — far from the medoid of the other doors on its street + ZIP.
//   3. Knock evidence     — two or more canvassers logged a knock far from the pin. They were
//                           standing at the real house; the pin is what's wrong.
// Nothing is repaired on suspicion. A shortlisted door is then ADJUDICATED against the address
// itself via the geocoder (cache-first, so it is usually free), and repaired only when the
// geocoder is confident AND disagrees with the stored pin by more than --min-meters.
//
// What it will NEVER touch:
//   · Doors whose coordSource is 'corrected' or 'geocodio'. Only 'file' pins have this bug, and
//     a human-placed pin is field-verified truth — overwriting one is the exact regression the
//     re-import pin shield exists to prevent.
//   · Book / turf membership, walkOrder, status, or any knock. updateHouseholdLocation moves the
//     coordinate and its provenance, nothing else. A repaired door therefore stays in the book
//     that was cut around its WRONG location until you re-cut that pass.
//   · Anything, at all, without --apply.
//
// KNOWN AFTER-EFFECTS of --apply, stated out loud because they change numbers you may be
// watching: a repaired door gets coordSource 'corrected', which (a) makes its pin immune to
// future re-imports, and (b) downgrades past "far from house" GPS flags at that door — the
// canvasser really was at the house, so the flag was ours, not theirs. The Audit page's
// historical counts will drop accordingly.
const APPLY = process.argv.includes('--apply');
const ALLOW_GEOCODE = process.argv.includes('--geocode');
const ORG_SLUG = (process.argv.find((a) => a.startsWith('--org=')) || '').split('=')[1] || null;
const CAMPAIGN_ID = (process.argv.find((a) => a.startsWith('--campaign=')) || '').split('=')[1] || null;
const USER_ID = (process.argv.find((a) => a.startsWith('--user=')) || '').split('=')[1] || null;
const MIN_METERS = Number((process.argv.find((a) => a.startsWith('--min-meters=')) || '').split('=')[1]) || 250;

// A cohort needs enough doors to have an opinion, and an outlier has to be well clear of the
// cohort's own spread — the same street name recurs miles apart on rural routes, which is what
// makes a fixed distance threshold useless here.
const MIN_COHORT = 3;
const OUTLIER_FACTOR = 4;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The member minimising summed distance to the others. A medoid, never a mean: an outlier
// drags a mean toward itself and can end up looking central.
const medoidOf = (points) => {
  let best = points[0];
  let bestSum = Infinity;
  for (const p of points) {
    let sum = 0;
    for (const q of points) sum += haversineMeters(p.lat, p.lng, q.lat, q.lng);
    if (sum < bestSum) {
      bestSum = sum;
      best = p;
    }
  }
  return best;
};

const coordsOf = (h) => {
  const c = h.location?.coordinates;
  return c?.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? { lng: c[0], lat: c[1] } : null;
};

// Doors on the same street + ZIP whose pin is far from where that street actually is.
// Buildings are collapsed to one point first, or a 40-unit tower outvotes the street.
function streetOutliers(households) {
  const cohorts = new Map();
  for (const h of households) {
    const c = coordsOf(h);
    if (!c) continue;
    const key = `${streetOf(h.addressLine1)}|${String(h.zipCode || '').trim().slice(0, 5)}`;
    const arr = cohorts.get(key) || [];
    arr.push({ h, ...c });
    cohorts.set(key, arr);
  }

  const flagged = new Map(); // householdId → { distance, cohortSize }
  for (const members of cohorts.values()) {
    // One point per distinct pin — an apartment tower is one opinion about where its street is.
    const byPin = new Map();
    for (const m of members) {
      const k = buildingKeyForCoords([m.lng, m.lat]);
      if (k && !byPin.has(k)) byPin.set(k, m);
    }
    const points = [...byPin.values()];
    if (points.length < MIN_COHORT) continue;

    const centre = medoidOf(points);
    const dists = points.map((p) => haversineMeters(centre.lat, centre.lng, p.lat, p.lng));
    const spread = median(dists.filter((d) => d > 0));
    const threshold = Math.max(MIN_METERS, spread * OUTLIER_FACTOR);

    for (const m of members) {
      const d = haversineMeters(centre.lat, centre.lng, m.lat, m.lng);
      if (d > threshold) flagged.set(String(m.h._id), { distance: Math.round(d), cohortSize: points.length });
    }
  }
  return flagged;
}

// Doors where the canvassers who actually stood there disagree with the pin. Free evidence:
// every knock already stores its GPS fix and its distance from the pin.
async function knockOutliers(householdIds) {
  const rows = await CanvassActivity.aggregate([
    { $match: { householdId: { $in: householdIds }, distanceFromHouseMeters: { $ne: null } } },
    {
      $group: {
        _id: '$householdId',
        minDistance: { $min: '$distanceFromHouseMeters' },
        canvassers: { $addToSet: '$userId' },
        knocks: { $sum: 1 },
      },
    },
    // The CLOSEST knock still far away, from two or more people — one canvasser standing in the
    // wrong spot is a canvasser problem; two independently agreeing is a pin problem.
    { $match: { minDistance: { $gte: MIN_METERS }, $expr: { $gte: [{ $size: '$canvassers' }, 2] } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { minDistance: Math.round(r.minDistance), knocks: r.knocks }]));
}

async function auditCampaign(campaign) {
  // Only 'file' pins can have this bug: 'geocodio' came from the address, and 'corrected' is
  // field-verified by a human.
  const households = await Household.find(
    {
      campaignId: campaign._id,
      isActive: true,
      coordSource: 'file',
      'location.coordinates': { $exists: true, $ne: null },
    },
    { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, location: 1, normalizedAddress: 1 }
  ).lean();

  if (!households.length) return null;

  const suspects = new Map(); // id → reasons[]
  const addReason = (id, reason) => {
    const arr = suspects.get(id) || [];
    arr.push(reason);
    suspects.set(id, arr);
  };

  for (const h of households) {
    const c = coordsOf(h);
    if (c && !inStateBounds(h.state, c.lat, c.lng)) addReason(String(h._id), 'out-of-state');
  }
  for (const [id, info] of streetOutliers(households)) {
    addReason(id, `${info.distance}m from its street (cohort ${info.cohortSize})`);
  }
  for (const [id, info] of await knockOutliers(households.map((h) => h._id))) {
    addReason(id, `knocked from ${info.minDistance}m away, 2+ canvassers`);
  }

  return { households, suspects };
}

async function adjudicate(households, suspects) {
  const byId = new Map(households.map((h) => [String(h._id), h]));
  // geocodeService takes (and mutates) a Map<normalizedAddress, householdLike>. Feed it copies
  // with null coords so it treats them as needing a lookup, leaving the real docs untouched.
  const probe = new Map();
  const probeToId = new Map();
  for (const id of suspects.keys()) {
    const h = byId.get(id);
    if (!h?.normalizedAddress) continue;
    probe.set(h.normalizedAddress, {
      addressLine1: h.addressLine1,
      addressLine2: h.addressLine2,
      city: h.city,
      state: h.state,
      zipCode: h.zipCode,
      latitude: null,
      longitude: null,
    });
    probeToId.set(h.normalizedAddress, id);
  }
  if (!probe.size) return { confirmed: [], stats: null };

  const { stats } = await geocodeResolve(probe, { cacheOnly: !ALLOW_GEOCODE });

  const confirmed = [];
  for (const [normAddr, probed] of probe) {
    if (probed.latitude == null || probed.longitude == null) continue;
    // Only a rooftop-grade answer is allowed to overrule a stored pin.
    if (probed.coordConfidence !== 'exact') continue;
    const h = byId.get(probeToId.get(normAddr));
    const c = coordsOf(h);
    if (!c) continue;
    const gap = haversineMeters(c.lat, c.lng, probed.latitude, probed.longitude);
    if (gap < MIN_METERS) continue;
    confirmed.push({ h, to: { lat: probed.latitude, lng: probed.longitude }, gap: Math.round(gap) });
  }
  return { confirmed, stats };
}

async function main() {
  await connectDb(process.env.MONGODB_URI);

  if (APPLY && !USER_ID) {
    console.error(
      'ERROR: --apply requires --user=<userId>.\n' +
        'HouseholdLocationChange.userId is required, so without it each door would SAVE and then\n' +
        'throw on its audit row — leaving a moved pin with no trail. Use a super-admin user id.'
    );
    await mongoose.disconnect();
    process.exit(1);
  }
  if (APPLY) {
    const u = await User.findById(USER_ID).lean();
    if (!u) {
      console.error(`ERROR: no user with id ${USER_ID}.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`Repairs will be attributed to ${u.firstName} ${u.lastName} (${u.email}).\n`);
  }

  const filter = {};
  if (CAMPAIGN_ID) filter._id = new mongoose.Types.ObjectId(CAMPAIGN_ID);
  if (ORG_SLUG) {
    const org = await Organization.findOne({ slug: ORG_SLUG }).lean();
    if (!org) {
      console.error(`No organization with slug "${ORG_SLUG}".`);
      await mongoose.disconnect();
      process.exit(1);
    }
    filter.organizationId = org._id;
  }

  const campaigns = await Campaign.find(filter, { name: 1, organizationId: 1 }).lean();
  console.log(`Scanning ${campaigns.length} campaign(s) for mis-pinned imported doors.`);
  console.log(`Confirm threshold: ${MIN_METERS}m. Geocoder: ${ALLOW_GEOCODE ? 'ALLOWED (may cost money)' : 'cache-only'}.\n`);

  let totalSuspects = 0;
  let totalConfirmed = 0;
  let totalRepaired = 0;
  let totalNewLookups = 0;

  for (const campaign of campaigns) {
    const audit = await auditCampaign(campaign);
    if (!audit || !audit.suspects.size) continue;
    totalSuspects += audit.suspects.size;

    const { confirmed, stats } = await adjudicate(audit.households, audit.suspects);
    totalNewLookups += stats?.geocodedNew || 0;
    if (!confirmed.length) {
      console.log(`${campaign.name}: ${audit.suspects.size} suspect(s), none confirmed by the address.`);
      continue;
    }
    totalConfirmed += confirmed.length;

    console.log(`${campaign.name}: ${audit.suspects.size} suspect(s), ${confirmed.length} confirmed:`);
    for (const { h, to, gap } of confirmed) {
      const why = audit.suspects.get(String(h._id)).join('; ');
      console.log(
        `  · ${h.addressLine1}${h.addressLine2 ? ` ${h.addressLine2}` : ''}, ${h.city} — ${gap}m off ` +
          `→ ${to.lat.toFixed(6)}, ${to.lng.toFixed(6)}  [${why}]`
      );
      if (!APPLY) continue;
      // Hydrated, not .lean() — updateHouseholdLocation calls h.save(). Never scope 'building':
      // a wrong pin may sit on top of doors that are legitimately there.
      const doc = await Household.findById(h._id);
      if (!doc) continue;
      try {
        await updateHouseholdLocation(doc, to, { source: 'import_repair', byUserId: USER_ID, scope: 'unit' });
        totalRepaired += 1;
      } catch (err) {
        console.log(`    ! skipped: ${err.message}`);
      }
    }
  }

  console.log('');
  if (!totalSuspects) {
    console.log('Nothing to repair — no imported pin looks out of place.');
  } else {
    console.log(
      `${totalSuspects} suspect door(s); ${totalConfirmed} confirmed by the address; ` +
        `${APPLY ? `${totalRepaired} repaired.` : '0 repaired (dry run).'}`
    );
    if (totalNewLookups) {
      console.log(`Paid geocoder lookups: ${totalNewLookups} (~${(geocodeCostCents(totalNewLookups) / 100).toFixed(2)} USD).`);
    } else if (!ALLOW_GEOCODE) {
      console.log('Cache-only run — pass --geocode to let unconfirmed suspects hit the provider.');
    }
    if (APPLY && totalRepaired) {
      console.log('\nBook membership was NOT changed — a repaired door stays in the book cut around its old');
      console.log('location until you re-cut that pass. Run `npm run recompute:territories -- --apply` if a');
      console.log('book OUTLINE now looks wrong. Past "far from house" GPS flags at these doors are now');
      console.log('downgraded, so historical Audit counts will drop.');
    }
    if (!APPLY) console.log('\nRe-run with --apply --user=<userId> to commit.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
