import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { Household } from '../models/Household.js';
import { DoNotKnockAddress } from '../models/DoNotKnockAddress.js';
import { Pass } from '../models/Pass.js';
import { SavedSearch } from '../models/SavedSearch.js';
import { normalizeAddress, looseAddressKey } from '../utils/normalizeAddress.js';
import { recomputeDoNotKnock } from '../services/dnc/recomputeDoNotKnock.js';
import { UNPLACED_PIN, COMPLEX_TO_REVIEW, NEEDS_PIN_FIX } from '../services/households/confirmHouseholdLocation.js';

// Put a door's real city back when a voter file's city column held a vendor code.
//
// WHY THIS EXISTS. The Texas HD 37 GOTV file (2026_10_14_tx_hd37_highest_roi_gotv_9khh_canvass.csv)
// has a column named plain `city` holding the vendor's city-by-address CODE — "HARLINGEN_addr",
// "SOUTH PADRE ISLAND_addr" — and the real city in RegistrationAddressCity. The mapping suggester
// took `city` (an exact header match outranks every other alias; canonicalFields.js now ranks
// RegistrationAddressCity first), so every door of that import was stored with the suffix: on the
// phones, the packets, the exports and the city filter, and in the address the pin lookup sends to
// Geocodio.
//
// WHY NOT RE-IMPORT THE FILE WITH THE RIGHT COLUMN. The city is part of a door's identity
// (Household.normalizedAddress = line 1|line 2|city|state|ZIP, unique per campaign), so the importer
// would read every corrected address as a NEW door: every voter re-housed onto it, the new doors in
// Intake, and the doors already cut into books, knocked and worked in Pin Fixes emptied and
// deactivated. This script renames the doors IN PLACE: same _id, so books, knocks, notes, surveys and
// pins stay exactly where they are.
//
//   npm run repair:city-suffix                                  # dry run: every campaign holding the suffix
//   npm run repair:city-suffix -- --campaign=<id>               # dry run: what --apply would change there
//   npm run repair:city-suffix -- --campaign=<id> --apply       # rename that campaign's doors
//
// --apply needs --campaign: one campaign per run. Re-running is safe — a renamed door no longer
// matches. --json prints the report as JSON (the tests read it).
//
// What --apply writes, for each door whose city ends in "_addr" (case ignored), inactive doors too:
//   · Household: city and cityValue lose the suffix; normalizedAddress is rebuilt from the corrected
//     fields by the importer's own rule (utils/normalizeAddress.js), so a later file with the right
//     column lands on these doors instead of beside them. updatedAt moves, and that is how phones pick
//     up the corrected city on their next sync (the mobile delta keys on it).
//   · Do-not-knock requests (org-wide, keyed by the EXACT normalizedAddress): each request on a renamed
//     door is copied to the corrected key BEFORE the door moves, so the door is never unsuppressed for
//     a moment; the old record is removed only once no door in the organization still holds the old key
//     (a sibling campaign imported from the same file keeps its own until it is repaired too). The copy
//     keeps the request's reason, who, when and createdAt — only the address changes. Then
//     Household.doNotKnock is recomputed for every renamed door, which also suppresses a door whose
//     corrected address already carried a request.
//   · City filters that are read again: a round's target filter (Pass.targetFilter, re-resolved on
//     every re-cut, so a stale "HARLINGEN_addr" would find no doors) and saved searches' filters
//     (frozen; kept for reference), include and exclude sides.
//
// What it never touches: pins and pin flags, books and walk order, statuses, knocks, voters (they
// carry no address), published client reports (frozen on purpose — re-publish one to refresh its map
// labels), book NAMES (a book cut by city keeps the name it was given), and the geocode cache (its
// old entries age out).
//
// A door it can't rename is left alone and counted: another door in the campaign already stands under
// the corrected address (two doors can't share a key — merging them is a person's call), or nothing is
// left once the suffix is gone.
//
// AFTER --apply: Pin Fixes → "Look up by address" on each card asks Geocodio again with the real
// city. The import's lookup asked with the suffix, and an answer from the next ZIP over — which the
// same-city rule normally accepts (pinTrust.js zipMatches) — could never match "harlingen_addr". The
// flags themselves come from the vendor's shared coordinates and the far-from-its-street check, and
// neither reads the city, so expect some cards to shrink, not to empty.
//
// Counts and city names only: no address, name or id of a person is printed.

// Refuse anything that isn't a recognized flag BEFORE touching the database (repairImportPins.js's
// rule: `--campaign= <id>` with a space must never widen a run).
const args = process.argv.slice(2);
for (const a of args) {
  if (a === '--apply' || a === '--json') continue;
  const m = /^--campaign=(.*)$/.exec(a);
  if (m && /^[0-9a-f]{24}$/i.test(m[1])) continue;
  if (m && m[1]) {
    const hint = m[1].length !== 24 ? `it is ${m[1].length} characters, not 24` : 'it contains a non-hex character';
    console.error(`ERROR: --campaign=${m[1]} is not a valid id — ${hint}. Check for a stray character when you pasted it.`);
    process.exit(1);
  }
  if (m || a === '--campaign') {
    console.error('ERROR: --campaign is missing its value — write it with no space after the = (e.g. --campaign=abc123).');
    process.exit(1);
  }
  console.error(`ERROR: unrecognized argument "${a}". Accepted: --campaign=<id>, --apply, --json.`);
  process.exit(1);
}
const APPLY = args.includes('--apply');
const JSON_OUT = args.includes('--json');
const CAMPAIGN_ID = args.find((a) => a.startsWith('--campaign='))?.slice('--campaign='.length) || null;
if (APPLY && !CAMPAIGN_ID) {
  console.error('ERROR: --apply needs --campaign=<id> — one campaign per run. Run without --apply first to list them.');
  process.exit(1);
}

const SUFFIX = /_addr$/i;
const SUFFIX_QUERY = { $regex: '_addr$', $options: 'i' };
const CHUNK = 2000;
const WRITE_BATCH = 1000;

const fixedCity = (city) => String(city ?? '').replace(SUFFIX, '').trim();
const hasSuffix = (xs) => Array.isArray(xs) && xs.some((v) => typeof v === 'string' && SUFFIX.test(v));
const fixCities = (xs) => [...new Set(xs.map((v) => (typeof v === 'string' && SUFFIX.test(v) && fixedCity(v) ? fixedCity(v) : v)))];

// The $set that takes the suffix off one filter's city values, include and exclude sides, or null.
const filterFix = (f, path) => {
  const set = {};
  if (hasSuffix(f?.cities)) set[`${path}.cities`] = fixCities(f.cities);
  if (hasSuffix(f?.exclude?.cities)) set[`${path}.exclude.cities`] = fixCities(f.exclude.cities);
  return Object.keys(set).length ? set : null;
};

const chunked = async (xs, fn) => {
  const out = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(...(await fn(xs.slice(i, i + CHUNK))));
  return out;
};

// What Pin Fixes shows for the campaign, card by card — the filters its own routes use.
const pinFixCounts = async (campaignId) => {
  const scope = { campaignId };
  const [shared, far, unlocated, complexes, approximate] = await Promise.all([
    Household.countDocuments({ ...scope, ...UNPLACED_PIN, pinSuspect: { $type: 'string', $in: ['placeholder', 'stray'] } }),
    Household.countDocuments({ ...scope, ...UNPLACED_PIN, pinSuspect: { $type: 'string', $eq: 'far' } }),
    Household.countDocuments({ ...scope, ...UNPLACED_PIN, pinSuspect: { $type: 'string', $eq: 'unlocated' } }),
    Household.countDocuments({ ...scope, ...COMPLEX_TO_REVIEW }),
    Household.countDocuments({ ...scope, ...NEEDS_PIN_FIX }),
  ]);
  return { shared, far, unlocated, complexes, approximate };
};

// Every campaign holding a suffixed city (the run with no --campaign). One collection scan.
const scan = async () => {
  const rows = await Household.aggregate([
    { $match: { city: SUFFIX_QUERY } },
    { $group: { _id: '$campaignId', doors: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$isActive', false] }, 0, 1] } } } },
    { $sort: { doors: -1 } },
  ]);
  const campaigns = await Campaign.find({ _id: { $in: rows.map((r) => r._id) } }, { name: 1, organizationId: 1 }).lean();
  const orgs = await Organization.find({ _id: { $in: campaigns.map((c) => c.organizationId) } }, { slug: 1 }).lean();
  const byId = new Map(campaigns.map((c) => [String(c._id), c]));
  const slugOf = new Map(orgs.map((o) => [String(o._id), o.slug]));
  return rows.map((r) => {
    const c = byId.get(String(r._id));
    return {
      campaignId: String(r._id),
      name: c?.name ?? '(campaign not found)',
      org: c ? slugOf.get(String(c.organizationId)) ?? null : null,
      doors: r.doors,
      active: r.active,
    };
  });
};

// Everything --apply would do in one campaign, read-only.
const planCampaign = async (campaign) => {
  const doors = await Household.find(
    { campaignId: campaign._id, city: SUFFIX_QUERY },
    { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, normalizedAddress: 1, isActive: 1 }
  ).lean();
  const plan = [];
  let emptied = 0;
  for (const d of doors) {
    const city = fixedCity(d.city);
    if (!city) {
      emptied += 1;
      continue;
    }
    plan.push({ id: d._id, oldKey: d.normalizedAddress, newKey: normalizeAddress({ ...d, city }), from: d.city, city, active: d.isActive !== false });
  }

  // A door already standing under the corrected address, or two suffixed doors landing on one key
  // (impossible while stored keys are unique, but cheap to refuse): both stay as they are.
  const taken = new Set(
    (
      await chunked(plan.map((p) => p.newKey), (keys) =>
        Household.find({ campaignId: campaign._id, normalizedAddress: { $in: keys } }, { normalizedAddress: 1 }).lean()
      )
    ).map((r) => r.normalizedAddress)
  );
  const perKey = new Map();
  for (const p of plan) perKey.set(p.newKey, (perKey.get(p.newKey) || 0) + 1);
  const go = plan.filter((p) => !taken.has(p.newKey) && perKey.get(p.newKey) === 1);

  const byCity = new Map();
  for (const p of plan) {
    const row = byCity.get(p.from) || { from: p.from, to: p.city, doors: 0 };
    row.doors += 1;
    byCity.set(p.from, row);
  }

  const dnk = await chunked([...new Set(go.map((p) => p.oldKey))], (keys) =>
    DoNotKnockAddress.find({ organizationId: campaign.organizationId, normalizedAddress: { $in: keys } }).lean()
  );
  const passes = (await Pass.find({ campaignId: campaign._id, targetFilter: { $ne: null } }, { targetFilter: 1 }).lean())
    .map((p) => ({ id: p._id, set: filterFix(p.targetFilter, 'targetFilter') }))
    .filter((p) => p.set);
  const searches = (await SavedSearch.find({ campaignId: campaign._id }, { filter: 1 }).lean())
    .map((s) => ({ id: s._id, set: filterFix(s.filter, 'filter') }))
    .filter((s) => s.set);

  return {
    go,
    dnk,
    passes,
    searches,
    report: {
      doors: doors.length,
      activeDoors: doors.filter((d) => d.isActive !== false).length,
      cities: [...byCity.values()].sort((a, b) => b.doors - a.doors),
      rename: go.length,
      leftAlone: { corrected: plan.length - go.length, emptied },
      doNotKnock: dnk.length,
      roundFilters: passes.length,
      savedSearches: searches.length,
    },
  };
};

const applyCampaign = async (campaign, { go, dnk, passes, searches }) => {
  const byOldKey = new Map(go.map((p) => [p.oldKey, p]));

  // 1. Do-not-knock copies under the corrected key, BEFORE any door moves. The raw driver keeps the
  // request's own createdAt (the admin list sorts by it); a request already standing at the corrected
  // address is that address's request, and the copy is not needed.
  let dnkCopied = 0;
  for (const r of dnk) {
    const p = byOldKey.get(r.normalizedAddress);
    if (await DoNotKnockAddress.exists({ organizationId: r.organizationId, normalizedAddress: p.newKey })) continue;
    const { _id, __v, ...rest } = r;
    const fields = { addressLine1: r.addressLine1, addressLine2: r.addressLine2, city: p.city, state: r.state, zipCode: r.zipCode };
    try {
      await DoNotKnockAddress.collection.insertOne({
        ...rest,
        ...fields,
        normalizedAddress: p.newKey,
        looseKey: looseAddressKey(fields),
        updatedAt: new Date(),
      });
      dnkCopied += 1;
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }
  }

  // 2. The doors. Each write is filtered on the old key, so a door changed mid-run is skipped, and a door
  // created under the corrected address mid-run (a walk-up add) refuses the rename on the unique key;
  // ordered:false applies every other op. What landed is counted from the database below.
  for (let i = 0; i < go.length; i += WRITE_BATCH) {
    const ops = go.slice(i, i + WRITE_BATCH).map((p) => ({
      updateOne: {
        filter: { _id: p.id, campaignId: campaign._id, normalizedAddress: p.oldKey },
        update: { $set: { city: p.city, cityValue: p.city, normalizedAddress: p.newKey } },
      },
    }));
    try {
      await Household.bulkWrite(ops, { ordered: false });
    } catch (err) {
      const errs = err?.writeErrors || [];
      const onlyDup = err?.code === 11000 || (errs.length > 0 && errs.every((e) => (e?.code ?? e?.err?.code) === 11000));
      if (!onlyDup) throw err;
    }
  }
  const newKeyById = new Map(go.map((p) => [String(p.id), p.newKey]));
  const renamedIds = (
    await chunked(go.map((p) => p.id), (ids) => Household.find({ _id: { $in: ids } }, { normalizedAddress: 1 }).lean())
  )
    .filter((h) => h.normalizedAddress === newKeyById.get(String(h._id)))
    .map((h) => h._id);

  // 3. An old do-not-knock record goes once no door in the organization still holds its key.
  let dnkRemoved = 0;
  let dnkKept = 0;
  for (const r of dnk) {
    if (await Household.exists({ organizationId: r.organizationId, normalizedAddress: r.normalizedAddress })) {
      dnkKept += 1;
      continue;
    }
    const res = await DoNotKnockAddress.deleteOne({ _id: r._id, normalizedAddress: r.normalizedAddress });
    dnkRemoved += res.deletedCount || 0;
  }

  // 4. The mirror, for every renamed door: the same requests now sit under the new keys.
  await recomputeDoNotKnock(renamedIds);

  // 5. City filters. No timestamps: changing a filter's spelling is not an edit anyone made.
  for (const p of passes) await Pass.updateOne({ _id: p.id }, { $set: p.set }, { timestamps: false });
  for (const s of searches) await SavedSearch.updateOne({ _id: s.id }, { $set: s.set }, { timestamps: false });

  return {
    renamed: renamedIds.length,
    notRenamed: go.length - renamedIds.length,
    doNotKnock: { copied: dnkCopied, oldRemoved: dnkRemoved, oldKept: dnkKept },
    roundFilters: passes.length,
    savedSearches: searches.length,
  };
};

const n = (x) => Number(x || 0).toLocaleString('en-US');

const printCampaign = (c) => {
  console.log(`\n${c.name} (${c.org ?? 'no org'}) — campaign ${c.campaignId}`);
  const r = c.plan;
  console.log(`  Doors whose city ends in "_addr": ${n(r.doors)} (${n(r.activeDoors)} active, ${n(r.doors - r.activeDoors)} inactive)`);
  for (const row of r.cities) console.log(`    ${row.from} → ${row.to}: ${n(row.doors)}`);
  console.log(`  ${APPLY ? 'To rename' : 'Would rename'}: ${n(r.rename)}`);
  if (r.leftAlone.corrected) console.log(`  Left alone, a door already stands under the corrected address: ${n(r.leftAlone.corrected)} (merge by hand)`);
  if (r.leftAlone.emptied) console.log(`  Left alone, nothing left once "_addr" is gone: ${n(r.leftAlone.emptied)}`);
  console.log(`  Do-not-knock requests on these doors: ${n(r.doNotKnock)} (carried to the corrected address)`);
  console.log(`  Round target filters naming a suffixed city: ${n(r.roundFilters)} · saved searches: ${n(r.savedSearches)}`);
  if (c.applied) {
    const a = c.applied;
    console.log(`  APPLIED: renamed ${n(a.renamed)}${a.notRenamed ? ` · ${n(a.notRenamed)} changed or taken mid-run, not renamed (run again)` : ''}`);
    console.log(`    do-not-knock: ${n(a.doNotKnock.copied)} copied, ${n(a.doNotKnock.oldRemoved)} old removed, ${n(a.doNotKnock.oldKept)} old kept (another campaign's door still uses it)`);
    console.log(`    filters fixed: ${n(a.roundFilters)} round(s), ${n(a.savedSearches)} saved search(es)`);
  }
  const p = c.pinFixes;
  console.log(
    `  Pin Fixes now: shared spot ${n(p.shared)} · far from street ${n(p.far)} · couldn't be found ${n(p.unlocated)} · ` +
      `complex homes ${n(p.complexes)} · placed on the street ${n(p.approximate)}`
  );
};

const main = async () => {
  await connectDb(process.env.MONGODB_URI);
  const out = { mode: CAMPAIGN_ID ? (APPLY ? 'apply' : 'dry-run') : 'scan' };

  if (!CAMPAIGN_ID) {
    out.campaigns = await scan();
    if (JSON_OUT) console.log(JSON.stringify(out));
    else {
      console.log('DRY RUN — nothing is changed. Campaigns whose doors carry a city ending in "_addr":');
      if (!out.campaigns.length) console.log('  none.');
      for (const c of out.campaigns) console.log(`  ${c.campaignId}  ${c.name} (${c.org ?? 'no org'}): ${n(c.doors)} doors, ${n(c.active)} active`);
      if (out.campaigns.length) console.log('\nNext: npm run repair:city-suffix -- --campaign=<id> to see what a fix would change there.');
    }
    await mongoose.disconnect();
    return;
  }

  const campaign = await Campaign.findById(CAMPAIGN_ID, { name: 1, organizationId: 1 }).lean();
  if (!campaign) {
    console.error(`ERROR: no campaign with id ${CAMPAIGN_ID}.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const org = await Organization.findById(campaign.organizationId, { slug: 1 }).lean();
  const planned = await planCampaign(campaign);
  const result = { campaignId: String(campaign._id), name: campaign.name, org: org?.slug ?? null, plan: planned.report };
  if (APPLY) result.applied = await applyCampaign(campaign, planned);
  result.pinFixes = await pinFixCounts(campaign._id);
  out.campaigns = [result];

  if (JSON_OUT) console.log(JSON.stringify(out));
  else {
    console.log(APPLY ? 'APPLY — doors renamed in place.' : 'DRY RUN — nothing is changed. Add --apply to rename.');
    printCampaign(result);
    if (APPLY && result.applied.renamed) {
      console.log('\nNext: Pin Fixes → "Look up by address" on each card, so those homes are looked up with the real city.');
    }
  }
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
