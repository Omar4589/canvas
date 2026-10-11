import crypto from 'node:crypto';
import { Household } from '../../models/Household.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { OrgDeletionRequest } from '../../models/OrgDeletionRequest.js';
import { ImportJob } from '../../models/ImportJob.js';
import { Pass } from '../../models/Pass.js';
import { Turf } from '../../models/Turf.js';
import { classifyStackedPins } from '../../utils/stackedPins.js';
import { buildingKeyForCoords } from '../../utils/buildingKey.js';
import { homeKeyOf, baseFamily, streetOfBase } from '../../utils/streetName.js';
import { fileCoordRefusal } from '../../utils/stateBounds.js';
import { buildCohorts, isCohortOutlier } from '../../utils/pinCohorts.js';
import { resolve as geocodeResolve, geocodeCacheKey } from '../import/geocode/geocodeService.js';
import { geocodeBatch as geocodioBatch } from '../import/geocode/geocodioProvider.js';
import { lookupPolicy, pinClass, answerClass, zipOfMatched, cityOfMatched } from './pinTrust.js';
import { isPinUnplaced } from './pinState.js';
import { recomputePassTerritories } from '../turf/generateTurf.js';

// Homes a voter-file vendor stamped with one shared coordinate (it couldn't place them, so it gave
// them the middle of their ZIP+4 block): find them, mark them, look each one up by its OWN address,
// and place the ones whose answer can be trusted. Runs at the end of every apply import
// (importProcessor.js), after recomputeHouseholdActive. Release 1 of docs/PROPOSAL_PLACEHOLDER_PINS.md
// — see docs/PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md for what is built and what waits.
//
// The order: lease → load → classify → 2b far → marks → look up → gate → write → outlines → tally.
//
// The pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S6) adds, in this file:
//   · a holding spot ('holding', pinSuspect 'unlocated') and a refused file coordinate (0,0) are class 0 —
//     any trusted answer beats them; neither is ever evidence of where a street is;
//   · step 2b marks 'far' — a door far from its street's (or its ZIP's) other homes — RECOMPUTED every pass
//     from the cohort, never sticky; a spot verdict outranks it;
//   · the precedence ladder: a stored 'unlocated' or 'complex', or a set-aside door, keeps its kind whatever
//     its spot's verdict; a person's move or vouch beats everything;
//   · the gate is pinTrust.js's lookupPolicy: one answer ladder, and condo COMPLEXES (several addresses whose
//     exact answers are one point) recognised instead of refused;
//   · same-street-address comparisons use baseFamily, so "533 Black Rock Tpke 3" is the same address as
//     "533 Black Rock Tpke".
//   · The whole campaign is classified and marked; only THIS file's homes are looked up (and paid for).
//   · A spot is judged by its HOMES, not its door records (homeKeyOf): two records of one home — a
//     re-spelled address, a unit moved between line 1 and line 2 — count once, an emptied door votes as
//     if it were still occupied, and a home that was moved off the spot leaves a departure there that
//     never votes and proves its street address wrong on that spot. See the reference §E step 1.
//   · Nothing is placed on suspicion: pinTrust.js's lookupPolicy is the gate, and a home it can't place
//     stays where it is, flagged, for a person in Pin Fixes.
//   · Idempotent: a retry re-runs from the start, the probed-id ledger stops it paying twice, and a
//     placed door is never a candidate again.

export const PIN_PLACEMENT_MAX_HOMES = () => Number(process.env.PIN_PLACEMENT_MAX_HOMES) || 25000;
const LOOKUP_CHUNK = () => Number(process.env.GEOCODE_BATCH_SIZE) || 1000;
const LEASE_BEAT_MS = 30_000;
const LEASE_STALE_MS = 90_000;
const WRITE_BATCH = 1000;
const ID_CHUNK = 5000;

// The org-visible lines (ImportJob.pinPassError). Never a provider message, never an address.
export const PIN_PASS_BUSY =
  "Map pins weren't placed: another import was placing pins in this campaign. Import the file again to place them.";
export const PIN_PASS_FAILED = "Map pins weren't checked this time. Import the file again to try again.";

// A provider throw, reduced to a cause safe to store. The provider's message embeds up to 200
// characters of the response body, and its request URL carries the API key, so neither is kept.
export const causeOf = (err) => {
  const m = /^Geocodio HTTP (\d{3})/.exec(String(err?.message || ''));
  if (m) return `HTTP ${m[1]}`;
  if (err?.name === 'AbortError') return 'timeout';
  if (err?.name === 'TypeError' && err?.cause) return `network: ${err.cause.code || 'unknown'}`;
  if (err?.name === 'SyntaxError') return 'bad response (not JSON)';
  return err?.name || 'Error';
};

const keyOfCoords = (c) => buildingKeyForCoords(c);
const baseOf = (hk) => hk.slice(0, hk.indexOf('|'));
const humanOwned = (d) => d.cs === 'corrected' || !!d.conf;
const placedByLookup = (d) => d.pp?.by === 'lookup' && !d.pp.rel && d.cs === 'geocodio';
// 'holding' is a Doorline-derived spot for a home the lookup couldn't find: like a file pin, it may be
// looked up again; unlike one, it is never evidence of where its street is (see step 2b).
const fileish = (d) => d.cs === 'file' || d.cs == null || d.cs === 'holding';
// Same-street-address family (memoised: the pass compares the same few thousand addresses many times).
const famMemo = new Map();
const famOf = (hk) => {
  const base = baseOf(hk);
  let f = famMemo.get(base);
  if (f === undefined) {
    f = baseFamily(base);
    if (famMemo.size > 200000) famMemo.clear();
    famMemo.set(base, f);
  }
  return f;
};
// A pin flag that came from the spot's verdict. 'far' never does: it is the cohort's, recomputed in step 2b.
const spotFlag = (v) => (v && v !== 'far' ? v : null);

// The compact record each loaded door is kept as (a 250k-door campaign must fit beside the import).
const compact = (h, inScope) => {
  const loc = h.location?.coordinates;
  const pp = h.pinPlacement?.at
    ? {
        from: h.pinPlacement.from,
        fk: keyOfCoords(h.pinPlacement.from),
        tk: keyOfCoords(h.pinPlacement.to),
        by: h.pinPlacement.by,
        kind: h.pinPlacement.kind || null,
        rel: !!h.pinPlacement.releasedAt,
      }
    : null;
  return {
    id: String(h._id),
    loc,
    k: keyOfCoords(loc),
    hk: homeKeyOf(h),
    cs: h.coordSource ?? null,
    conf: h.locationConfirmedAt || null,
    ps: h.pinSuspect || null,
    pp,
    dk: h.pinDistrustedKeys?.length ? h.pinDistrustedKeys : null,
    inScope,
    z5: String(h.zipCode ?? '').trim().slice(0, 5),
    cc: h.coordConfidence || null,
    sa: !!h.pinSetAside?.at,
    ck: h.pinComplexKey || null,
    // A refused coordinate (0,0, or outside the home's state): class 0, and never cohort evidence.
    off: Array.isArray(loc) && loc.length === 2 ? !!fileCoordRefusal({ lat: loc[1], lng: loc[0], state: h.state }) : false,
  };
};

// One spot's homes (or nothing), judged. Present and emptied homes vote for their street address;
// departed homes never vote. An address with a departure is proven wrong on the spot: its homes are
// suspects, and a "building" whose own address is proven wrong is no building there. History (a
// departed home, or an address proven wrong) means the spot was shared, so the sort never clears a
// stored flag on it.
const judge = (key, g) => {
  const homes = new Map();
  const homeFor = (hk) => {
    let h = homes.get(hk);
    if (!h) homes.set(hk, (h = { hk, base: famOf(hk), active: [], inactive: [], departures: 0 }));
    return h;
  };
  for (const d of g.active) homeFor(d.hk).active.push(d);
  for (const d of g.inactive) homeFor(d.hk).inactive.push(d);
  for (const hk of g.deps) homeFor(hk).departures += 1;
  const list = [...homes.values()];
  const provenWrong = new Set(list.filter((h) => h.departures).map((h) => h.base));
  for (const h of list) h.votes = !!h.active.length || !h.departures;
  const { suspects } = classifyStackedPins(list.map((h) => ({ id: h.hk, street: h.votes ? h.base : `~departed~${h.hk}`, pinKey: key })));
  const freq = new Map();
  for (const h of list) if (h.votes) freq.set(h.base, (freq.get(h.base) || 0) + 1);
  let majority = null;
  for (const [b, n] of freq) if (n / list.length > 0.5) majority = b;
  const nulled = !!majority && provenWrong.has(majority);
  if (nulled) majority = null;
  for (const h of list) {
    if (list.length < 2) h.verdict = 'none';
    else if (nulled) h.verdict = 'placeholder';
    else if (provenWrong.has(h.base)) h.verdict = majority ? 'stray' : 'placeholder';
    else h.verdict = suspects.get(h.hk)?.kind || 'majority';
  }
  const history = provenWrong.size > 0 || list.some((h) => !h.votes);
  return { size: list.length, homes, history };
};

// The lease (Campaign.pinPass): one placing pass per campaign at a time, on its own timer.
const takeLease = async (campaignId, owner) => {
  const now = new Date();
  const res = await Campaign.updateOne(
    { _id: campaignId, $or: [{ pinPass: null }, { 'pinPass.heartbeatAt': { $lt: new Date(now.getTime() - LEASE_STALE_MS) } }] },
    { $set: { pinPass: { owner, heartbeatAt: now } } },
    { timestamps: false }
  );
  return res.modifiedCount === 1;
};

const deletionRequested = async (campaign) =>
  !!(await Campaign.exists({ _id: campaign._id, 'deletion.requestedAt': { $ne: null } })) ||
  !!(await Organization.exists({ _id: campaign.organizationId, 'deletion.requestedAt': { $ne: null } })) ||
  !!(await OrgDeletionRequest.exists({ organizationId: campaign.organizationId, status: 'scheduled' }));

/**
 * @param campaign    the campaign doc ({ _id, organizationId })
 * @param importJob   the ImportJob doc ({ _id, createdAt, pinProbedIds })
 * @param paidScope   Set of this file's normalizedAddress values — the only homes looked up
 * @param tallyIds    this file's household ids — the homes the outcome counts describe
 * @param allowPaid   GEOCODE_ENABLED and a key: may this pass look homes up at all?
 * @param geocodeBatch the provider (injectable for tests; defaults to Geocodio)
 * @returns the ImportJob fields to $set: pinsPlacedExact, pinsConfirmedInPlace, pinsStillUnplaced,
 *          pinLookupsCached, pinLookupsOverCap, pinPassError, pinPassCause (plus counts for logs)
 */
export async function placeStackedPins({ campaign, importJob, paidScope, tallyIds, allowPaid, geocodeBatch = geocodioBatch }) {
  const campaignId = campaign._id;
  const out = {
    pinsPlacedExact: 0,
    pinsConfirmedInPlace: 0,
    pinsStillUnplaced: 0,
    pinsPlacedApprox: 0,
    pinsComplex: 0,
    pinsUnlocated: 0,
    pinsFarMarked: 0,
    pinLookupsCached: 0,
    pinLookupsOverCap: 0,
    pinPassError: null,
    pinPassCause: null,
    marked: 0,
    placed: 0,
    complexMarked: 0,
    reverted: 0,
  };

  // 0. Lease — only a pass that may place takes it; a marking-only pass neither takes nor waits.
  const owner = crypto.randomUUID();
  let leased = false;
  let lost = false;
  let beat = null;
  if (allowPaid) {
    leased = await takeLease(campaignId, owner);
    if (leased) {
      beat = setInterval(() => {
        Campaign.updateOne({ _id: campaignId, 'pinPass.owner': owner }, { $set: { 'pinPass.heartbeatAt': new Date() } }, { timestamps: false })
          .then((r) => {
            if (!r.matchedCount) lost = true;
          })
          .catch(() => {});
      }, LEASE_BEAT_MS);
      beat.unref?.();
    } else {
      out.pinPassError = PIN_PASS_BUSY;
      out.pinPassCause = 'busy: another pin check is running in this campaign';
    }
  }
  const holdsLease = async () => leased && !lost && !!(await Campaign.exists({ _id: campaignId, 'pinPass.owner': owner }));

  try {
    // 1. Load: active doors (compact), inactive doors, and departures (the `from` a door left behind).
    const byKey = new Map();
    const groupFor = (k) => {
      let g = byKey.get(k);
      if (!g) byKey.set(k, (g = { active: [], inactive: [], deps: [] }));
      return g;
    };
    const activeById = new Map();
    const projection = {
      location: 1, addressLine1: 1, addressLine2: 1, normalizedAddress: 1, coordSource: 1,
      locationConfirmedAt: 1, pinSuspect: 1, pinPlacement: 1, pinDistrustedKeys: 1,
      zipCode: 1, state: 1, coordConfidence: 1, pinSetAside: 1, pinComplexKey: 1,
    };
    const addDeparture = (d) => {
      // An in-place placement's `from` is the verified house, never a departure; nor is a `from` the
      // door has since come back to.
      if (d.pp?.fk && d.pp.fk !== d.pp.tk && d.pp.fk !== d.k) groupFor(d.pp.fk).deps.push(d.hk);
    };
    for await (const h of Household.find({ campaignId, isActive: true, location: { $ne: null } }, projection).lean().cursor({ batchSize: 2000 })) {
      const d = compact(h, !!paidScope?.has(h.normalizedAddress));
      if (!d.k) continue;
      groupFor(d.k).active.push(d);
      activeById.set(d.id, d);
      addDeparture(d);
    }
    for await (const h of Household.find({ campaignId, isActive: false, location: { $ne: null } }, projection).lean().cursor({ batchSize: 2000 })) {
      const d = compact(h, false);
      if (!d.k) continue;
      groupFor(d.k).inactive.push(d);
      addDeparture(d);
    }

    // 2–3. Classify each spot by its homes, then sort each active door. The first rule that matches decides.
    const next = new Map(); // id -> { ps, candidate }
    const facts = new Map(); // key -> { size }
    for (const [k, g] of byKey) {
      if (!g.active.length) continue;
      if (g.active.length === 1 && !g.inactive.length && !g.deps.length && !g.active[0].ps) continue; // a lone, unflagged home
      const f = judge(k, g);
      facts.set(k, { size: f.size });
      const propagate = [];
      // A spot that already holds a condo complex (its members carry pinComplexKey === this key).
      const complexHere = g.active.some((m) => m.ps === 'complex' && m.ck === k);
      for (const d of g.active) {
        const h = f.homes.get(d.hk);
        // The precedence ladder's first rules: a set-aside door keeps whatever kind it had and is never
        // looked up; a stored 'unlocated' (a holding spot is a 'placeholder' by shape) or 'complex' keeps
        // its kind whatever the spot's verdict.
        if (d.sa) {
          next.set(d.id, { ps: d.ps, candidate: false });
          continue;
        }
        if (d.ps === 'unlocated' || d.ps === 'complex') {
          next.set(d.id, { ps: d.ps, candidate: !humanOwned(d) && d.inScope });
          continue;
        }
        // A home the IMPORT geocoded (no file coordinate, or a refused one) whose exact answer for its own
        // address is this complex's point joins the complex: import-time geocoding never reaches the gate's
        // join rule, so without this it would read as a different address collapsed onto the spot.
        if (complexHere && !humanOwned(d) && !placedByLookup(d) && d.cs === 'geocodio' && d.cc === 'exact') {
          next.set(d.id, { ps: 'complex', ck: k, candidate: false });
          continue;
        }
        // A re-keyed door inherits its old door's mark: an inactive record of the same home on this spot
        // that carries an effective flag. 'far' is never a stored spot flag (step 2b owns it).
        const twin = !d.ps && !humanOwned(d) && !placedByLookup(d) ? h.inactive.find((t) => spotFlag(t.ps) && !humanOwned(t)) : null;
        const stored = spotFlag(d.ps) || spotFlag(twin?.ps) || null;
        let ps = d.ps;
        let candidate = false;
        if (placedByLookup(d)) ps = null; // never flagged; only the gate can revert it
        else if (h.verdict === 'none') {
          ps = humanOwned(d) ? d.ps : stored;
          candidate = !!ps && !humanOwned(d) && fileish(d);
        } else if (h.verdict === 'majority' && !f.history) ps = null; // positive evidence: a clean building
        else if (h.verdict === 'majority' && stored) {
          ps = humanOwned(d) ? d.ps : stored;
          candidate = !humanOwned(d) && fileish(d);
          if (!humanOwned(d)) propagate.push([h.base, stored]); // only an effective flag passes on
        } else if (h.verdict === 'majority') ps = null;
        else if (humanOwned(d)) ps = d.ps; // a person's pin or vouch: never flagged or moved by this pass
        else if (d.cs === 'geocodio') ps = h.verdict; // the geocoder's own collapse: flagged, not looked up again
        else {
          ps = h.verdict;
          candidate = true;
        }
        next.set(d.id, { ps, candidate });
      }
      // One address's units on a spot share an effective flag: a unit a later file adds to a flagged
      // building is flagged with it — but never a unit the lookup placed, or one a person owns.
      for (const [base, kind] of propagate) {
        for (const d of g.active) {
          if (famOf(d.hk) !== base || humanOwned(d) || placedByLookup(d) || d.sa) continue;
          const n = next.get(d.id);
          if (!n.ps) next.set(d.id, { ps: kind, candidate: fileish(d) });
        }
      }
    }

    // 2b. Far: a door far from the other homes on its street (or, on a street too short to judge, in its
    // ZIP) — the repair script's old street-outlier signal, on every pass. Cohorts are built ONCE, from every
    // door whose pin is evidence of where its street is (not a shared spot, not a holding spot, not a refused
    // coordinate), and also serve the gate's estimate test (cohortFor). Only a file pin nobody owns, with no
    // spot verdict this pass, may be marked; a door marked 'far' before that is no longer an outlier is
    // cleared — 'far' is the cohort's opinion now, never a sticky flag.
    const effectivePs = (d) => (next.has(d.id) ? next.get(d.id).ps : d.ps);
    const NOT_EVIDENCE = new Set(['placeholder', 'stray', 'unlocated']);
    const pointOf = (d) => ({ id: d.id, lat: d.loc[1], lng: d.loc[0], street: streetOfBase(famOf(d.hk)), zip5: d.z5, spotKey: d.k });
    const evidence = [];
    for (const d of activeById.values()) {
      if (d.off || d.cs === 'holding' || NOT_EVIDENCE.has(effectivePs(d))) continue;
      evidence.push(pointOf(d));
    }
    const cohorts = buildCohorts(evidence, { zipFallback: true });
    for (const d of activeById.values()) {
      if (!fileish(d) || d.cs === 'holding' || humanOwned(d) || placedByLookup(d) || d.sa || d.off) continue;
      const ps = effectivePs(d);
      if (ps && ps !== 'far') continue; // a spot verdict wins over the cohort
      const pt = pointOf(d);
      if (isCohortOutlier(pt, cohorts.summaryFor(pt))) {
        next.set(d.id, { ps: 'far', candidate: d.inScope });
        if (d.ps !== 'far') out.pinsFarMarked += 1;
      } else if (d.ps === 'far') {
        next.set(d.id, { ps: null, candidate: false });
      }
    }

    // 4. Marks: every flag set or cleared, filtered on the loaded state so a person's move or confirm
    // that lands mid-pass wins.
    const markOps = [];
    for (const [id, n] of next) {
      const d = activeById.get(id);
      if ((n.ps || null) === (d.ps || null)) continue;
      markOps.push({
        updateOne: {
          filter: { _id: id, 'location.coordinates': d.loc, coordSource: d.cs, locationConfirmedAt: d.conf },
          update: n.ps
            ? { $set: { pinSuspect: n.ps, ...(n.ps === 'complex' && n.ck ? { pinComplexKey: n.ck } : {}) } }
            : { $unset: { pinSuspect: 1 } },
        },
      });
    }
    for (let i = 0; i < markOps.length; i += WRITE_BATCH) {
      const r = await Household.bulkWrite(markOps.slice(i, i + WRITE_BATCH), { ordered: false });
      out.marked += r.modifiedCount || 0;
    }

    // 5. Look up this file's candidates, in a fixed order, under the ceiling, until the provider fails.
    const candidates = [];
    for (const [id, n] of next) {
      const d = activeById.get(id);
      if (n.candidate && n.ps && d.inScope) candidates.push(d);
    }
    candidates.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : 1));
    const answers = new Map();
    let degradedCause = null;
    if (leased && candidates.length) {
      const ledger = new Set((importJob.pinProbedIds || []).map(String));
      let budget = Math.max(0, PIN_PLACEMENT_MAX_HOMES() - ledger.size);
      const toProbe = [];
      for (const d of candidates) {
        if (ledger.has(d.id)) toProbe.push(d);
        else if (budget > 0) {
          toProbe.push(d);
          budget -= 1;
        } else out.pinLookupsOverCap += 1;
      }
      let firstThrow = null;
      // Addresses the provider answered — what it bills, matched or not. resolve()'s own stats count
      // matched DOORS (stats.geocodedNew), which misses every unmatched address and counts two doors
      // sharing one address twice, so the cost counter reads the sends here instead.
      let billed = 0;
      const wrapped = async (queries, opts) => {
        try {
          const res = await geocodeBatch(queries, opts);
          billed += queries.length;
          return res;
        } catch (err) {
          if (!firstThrow) firstThrow = err;
          throw err;
        }
      };
      const size = LOOKUP_CHUNK();
      for (let i = 0; i < toProbe.length; i += size) {
        if (await deletionRequested(campaign)) break; // stop buying; the marks stay
        if (!(await holdsLease())) {
          lost = true;
          break;
        }
        const chunk = toProbe.slice(i, i + size);
        const docs = await Household.find(
          { _id: { $in: chunk.map((d) => d.id) } },
          { addressLine1: 1, addressLine2: 1, city: 1, state: 1, zipCode: 1, normalizedAddress: 1 }
        ).lean();
        // Probes are COPIES with null coordinates: resolve() fills what it can and never touches a real door.
        const probes = new Map();
        const idOf = new Map();
        for (const h of docs) {
          probes.set(h.normalizedAddress, {
            addressLine1: h.addressLine1, addressLine2: h.addressLine2, city: h.city, state: h.state, zipCode: h.zipCode,
            latitude: null, longitude: null,
          });
          idOf.set(h.normalizedAddress, String(h._id));
        }
        const billedBefore = billed;
        const { unmatched, stats } = await geocodeResolve(probes, { geocodeBatch: wrapped });
        await ImportJob.updateOne(
          { _id: importJob._id },
          { $addToSet: { pinProbedIds: { $each: chunk.map((d) => d.id) } }, $inc: { pinLookupsNew: billed - billedBefore } }
        );
        out.pinLookupsCached += stats.geocodedCached || 0;
        if ([...unmatched.values()].some((u) => u.code === 'geocode_failed')) {
          degradedCause = firstThrow ? causeOf(firstThrow) : 'geocode_failed';
          break;
        }
        for (const [na, p] of probes) {
          if (p.latitude == null || p.longitude == null) continue;
          answers.set(idOf.get(na), {
            lat: p.latitude,
            lng: p.longitude,
            accuracyType: p.geocodeAccuracyType ?? null,
            matchedZip: zipOfMatched(p.geocodeMatchedAddress),
            matchedCity: cityOfMatched(p.geocodeMatchedAddress),
            accuracy: p.geocodeAccuracy ?? null,
            cacheKey: geocodeCacheKey(p),
            zipCode: p.zipCode,
            state: p.state,
            city: p.city,
          });
        }
      }
    }
    if (degradedCause) {
      // A failed provider chunk stops the run buying, and this run places nothing: the unprobed homes
      // stay flagged, and importing the file again finishes the job.
      out.pinPassError = PIN_PASS_FAILED;
      out.pinPassCause = degradedCause;
    }

    // 6–7. Gate, then write placements and reverts in batches, re-checking the lease before each.
    const moved = new Set();
    if (leased && !lost && !degradedCause && answers.size) {
      const cands = candidates
        .filter((d) => answers.has(d.id))
        .map((d) => {
          const a = answers.get(d.id);
          return {
            id: d.id,
            key: d.k,
            base: baseOf(d.hk),
            fam: famOf(d.hk),
            zipCode: a.zipCode,
            state: a.state,
            city: a.city,
            distrusted: d.dk || [],
            pinClass: pinClass({ pinSuspect: effectivePs(d), coordSource: d.cs, off: d.off }),
            loc: d.loc,
            street: streetOfBase(famOf(d.hk)),
            zip5: d.z5,
          };
        });
      const doorsOnKey = (k) =>
        (byKey.get(k)?.active || []).map((d) => {
          const n = next.get(d.id);
          return {
            id: d.id,
            base: baseOf(d.hk),
            fam: famOf(d.hk),
            placed: placedByLookup(d),
            candidate: !!(n?.candidate && n.ps && !d.conf),
            complex: effectivePs(d) === 'complex',
          };
        });
      const cohortFor = (c) => cohorts.summaryFor({ street: c.street, zip5: c.zip5 });
      const { place, complex, distrust, revert } = lookupPolicy({ cands, answers, doorsOnKey, cohortFor });
      const now = new Date();
      const ops = [];
      for (const p of place) {
        const d = activeById.get(p.id);
        const a = answers.get(p.id);
        // A far door confirmed within 250 m keeps its own pin (the answer only vouches for it); every other
        // placement writes the answer's point (an in-place one is the same spot to ~1.1 m).
        const to = p.near ? d.loc : [a.lng, a.lat];
        ops.push({
          op: {
            updateOne: {
              filter: { _id: d.id, 'location.coordinates': d.loc, coordSource: d.cs, locationConfirmedAt: null },
              update: {
                $set: {
                  location: { type: 'Point', coordinates: to },
                  coordSource: 'geocodio',
                  coordConfidence: answerClass(a) === 'exact' ? 'exact' : 'interpolated',
                  pinPlacement: {
                    from: d.loc,
                    to,
                    at: now,
                    kind: next.get(d.id).ps,
                    by: 'lookup',
                    answer: answerClass(a),
                    accuracyType: a.accuracyType,
                    stackSize: Math.max(0, (facts.get(d.k)?.size || 1) - 1),
                  },
                },
                $unset: { pinSuspect: 1, pinComplexKey: 1 },
              },
            },
          },
          id: d.id,
          movedId: p.inPlace ? null : d.id,
          kind: 'place',
        });
      }
      // Complexes: the members converge on the exact point (change #8). A member already there and already
      // marked is a no-op re-judge and gets no write — rewriting its placement on every re-import would
      // erase the vendor-spot departure its `from` records.
      for (const m of complex) {
        const d = activeById.get(m.id);
        const a = answers.get(m.id);
        if (!m.moveTo && d.ps === 'complex' && d.ck === m.key) continue;
        const to = m.moveTo ? [a.lng, a.lat] : d.loc;
        ops.push({
          op: {
            updateOne: {
              filter: { _id: d.id, 'location.coordinates': d.loc, coordSource: d.cs, locationConfirmedAt: null },
              update: {
                $set: {
                  pinSuspect: 'complex',
                  pinComplexKey: m.key,
                  pinPlacement: {
                    from: d.loc,
                    to,
                    at: now,
                    kind: next.get(d.id).ps,
                    by: 'lookup',
                    answer: 'exact',
                    accuracyType: a.accuracyType,
                    stackSize: Math.max(0, (facts.get(d.k)?.size || 1) - 1),
                  },
                  // A member that leaves its spot is a geocoded door, never a holding-spot one.
                  ...(m.moveTo ? { location: { type: 'Point', coordinates: to }, coordSource: 'geocodio', coordConfidence: 'exact' } : {}),
                },
              },
            },
          },
          id: d.id,
          movedId: m.moveTo ? d.id : null,
          kind: 'complex',
        });
      }
      for (const [id, key] of revert) {
        const d = activeById.get(id);
        if (!d?.pp?.from) continue;
        ops.push({
          op: {
            updateOne: {
              filter: { _id: id, 'location.coordinates': d.loc, coordSource: 'geocodio', locationConfirmedAt: null },
              update: {
                $set: {
                  location: { type: 'Point', coordinates: d.pp.from },
                  // A parked home the lookup placed goes back to its holding spot AS a holding-spot door, so
                  // the importer's "the geocoder filled it" rule never swallows its next successful geocode.
                  coordSource: d.pp.kind === 'unlocated' ? 'holding' : 'file',
                  coordConfidence: null,
                  pinSuspect: d.pp.kind || 'placeholder',
                  'pinPlacement.releasedAt': now,
                },
                $addToSet: { pinDistrustedKeys: key },
              },
            },
          },
          id,
          movedId: d.pp.fk === d.k ? null : id,
          kind: 'revert',
        });
      }
      for (const [id, keys] of distrust) {
        if (revert.has(id)) continue; // the revert write carries its key
        ops.push({
          op: { updateOne: { filter: { _id: id }, update: { $addToSet: { pinDistrustedKeys: { $each: [...keys] } } }, timestamps: false } },
          id,
          movedId: null,
          kind: 'distrust',
        });
      }
      for (let i = 0; i < ops.length; i += WRITE_BATCH) {
        if (!(await holdsLease())) {
          lost = true;
          break;
        }
        await Household.bulkWrite(ops.slice(i, i + WRITE_BATCH).map((b) => b.op), { ordered: false });
      }
      // Count what actually landed: a filter that matched nothing (a person moved or confirmed the door
      // mid-pass) wrote nothing, and a batch skipped for the lease never ran.
      const written = ops.filter((b) => b.kind !== 'distrust');
      const byId = new Map(written.map((b) => [b.id, b]));
      const writtenIds = [...byId.keys()];
      for (let i = 0; i < writtenIds.length; i += ID_CHUNK) {
        const docs = await Household.find({ _id: { $in: writtenIds.slice(i, i + ID_CHUNK) } }, { pinPlacement: 1 }).lean();
        for (const h of docs) {
          const b = byId.get(String(h._id));
          const landed =
            b.kind === 'revert' ? +h.pinPlacement?.releasedAt === +now : +h.pinPlacement?.at === +now;
          if (!landed) continue;
          if (b.kind === 'place') out.placed += 1;
          else if (b.kind === 'complex') out.complexMarked += 1;
          else out.reverted += 1;
          if (b.movedId) moved.add(b.movedId);
        }
      }
    }
    if (lost && !out.pinPassError) {
      out.pinPassError = PIN_PASS_BUSY;
      out.pinPassCause = 'busy: the pin check lost its campaign lease';
    }

    // 9. Outlines: a live round whose book holds a door this run moved is redrawn once. Best effort.
    if (moved.size) {
      const livePasses = await Pass.find({ campaignId, status: { $ne: 'archived' } }, { _id: 1 }).lean();
      if (livePasses.length) {
        const passIds = await Turf.distinct('passId', {
          passId: { $in: livePasses.map((p) => p._id) },
          householdIds: { $in: [...moved] },
          status: { $in: ['draft', 'published'] },
        });
        for (const passId of passIds) {
          try {
            await recomputePassTerritories(passId, { withCentroid: true });
          } catch (err) {
            console.error(`[pins] outline redraw failed for round ${passId} (run npm run recompute:territories -- --apply):`, err?.message);
          }
        }
      }
    }

    // 10. Tally THIS file's homes, from state.
    const since = importJob.createdAt ? new Date(importJob.createdAt) : new Date(0);
    const ids = [...new Set((tallyIds || []).map(String))];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const docs = await Household.find(
        { _id: { $in: ids.slice(i, i + ID_CHUNK) } },
        { coordSource: 1, coordConfidence: 1, pinSuspect: 1, locationConfirmedAt: 1, pinPlacement: 1 }
      ).lean();
      for (const h of docs) {
        const pl = h.pinPlacement;
        // A complex member first: a moved member is also lookup-placed and must not count as placed again.
        if (h.pinSuspect === 'complex' && !h.locationConfirmedAt) {
          out.pinsComplex += 1;
          continue;
        }
        if (pl?.by === 'lookup' && !pl.releasedAt && h.coordSource === 'geocodio' && pl.at && new Date(pl.at) >= since) {
          // An estimate (in place or not) sits in the approximate queue, so the line says "check them".
          if (h.coordConfidence === 'interpolated') out.pinsPlacedApprox += 1;
          else if (keyOfCoords(pl.from) === keyOfCoords(pl.to)) out.pinsConfirmedInPlace += 1;
          else out.pinsPlacedExact += 1;
          continue;
        }
        if (isPinUnplaced(h)) {
          out.pinsStillUnplaced += 1;
          if (h.pinSuspect === 'unlocated') out.pinsUnlocated += 1;
        }
      }
    }
    return out;
  } finally {
    if (beat) clearInterval(beat);
    if (leased) {
      await Campaign.updateOne({ _id: campaignId, 'pinPass.owner': owner }, { $unset: { pinPass: 1 } }, { timestamps: false }).catch(() => {});
    }
  }
}
