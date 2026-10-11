import { GeocodeCache } from '../../../models/GeocodeCache.js';
import { looseAddressKey } from '../../../utils/normalizeAddress.js';
import { inStateBounds } from '../../../utils/stateBounds.js';
import { geocodeBatch as geocodioBatch } from './geocodioProvider.js';
import { GEOCODE_MIN_ACCURACY } from './geocodeFloors.js';
import { answerClass, zipMatches, zipOfMatched, cityOfMatched } from '../../households/pinTrust.js';

// Resolves missing-coordinate households to lat/long via Geocodio, cache-first.
// Mutates each MATCHED household's { latitude, longitude, coordSource, coordConfidence }
// in place and returns the set of households that could NOT be placed (so the caller
// can drop them + their voters before insert — every imported door keeps a walkable pin).

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
// Default 1000 — well under Geocodio's 10000 hard cap. Smaller batches return within the
// per-batch timeout (a full 10k batch can take ~10 min server-side), keep retries cheap, and
// cache incrementally so a mid-run failure never wastes earlier batches. The worker has no
// platform request timeout, so the 180s ceiling is generous on purpose.
const BATCH_SIZE = () => num(process.env.GEOCODE_BATCH_SIZE, 1000);
const TIMEOUT_MS = () => num(process.env.GEOCODE_BATCH_TIMEOUT_MS, 180000);
const NEG_TTL_DAYS = () => num(process.env.GEOCODE_NEGCACHE_TTL_DAYS, 30);
const NEG_MAX_ATTEMPTS = () => num(process.env.GEOCODE_NEGCACHE_MAX_ATTEMPTS, 4);

// Which answers may place a door is one ladder, owned by services/households/pinTrust.js (answerClass):
// rooftop/point are 'exact'; range_interpolation, street_center and nearest_rooftop_match (another,
// nearby address's roof) are placed as 'interpolated' — "Approximate location", listed in Pin Fixes;
// true centroids (place/county/state) never place a door. Since the pin-fixes build a
// nearest_rooftop_match is no longer 'exact' (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S2).
const UNIT_RE = /^(APT|UNIT|STE|SUITE|#|RM|ROOM|FL|FLOOR)\b/i;

export function geocodeCacheKey(h) {
  return looseAddressKey(h);
}
// Only reuse a building's geocode across units for RECOGNIZED unit markers; never
// collapse LOT/BLDG/etc onto one pin (a 200-lot park must keep distinct doors).
export function geocodeUnitlessKey(h) {
  if (!h.addressLine2 || !UNIT_RE.test(String(h.addressLine2).trim())) return null;
  return looseAddressKey({ ...h, addressLine2: null });
}
// Internal geocoding cost assumption (~$1 per 1,000 new Geocodio lookups). Single source of truth
// for the owner-only cost review — addresses that arrive with coords or hit the cache are free, so
// only NEW lookups cost. The client never sees this; it surfaces on the super-admin Imports page.
export const GEOCODE_COST_PER_1000_CENTS = 100;
export function geocodeCostCents(newLookups) {
  return Math.round(((Number(newLookups) || 0) / 1000) * GEOCODE_COST_PER_1000_CENTS);
}

export function needsGeocode(h) {
  return h.latitude == null || h.longitude == null;
}
export function zipEligible(h) {
  return /^\d{5}$/.test(String(h.zipCode ?? '').trim().slice(0, 5));
}

export function confidenceFor(accuracyType) {
  const cls = answerClass({ accuracyType });
  if (cls === 'exact') return 'exact';
  if (cls === 'none') return 'none';
  return 'interpolated';
}

// The answer's ZIP must be the address's, or the answer must be in the same city (a ZIP line running
// down a road). An answer with no matched address skips the test here, as import-time placement always
// did — the placement pass applies the strict form, where a missing matched ZIP refuses.
const zipRefusal = (matchedAddress, h) => {
  if (!matchedAddress) return null;
  const matchedZip = zipOfMatched(matchedAddress);
  if (zipMatches({ matchedZip, matchedCity: cityOfMatched(matchedAddress) }, h)) return null;
  return `Matched in ZIP ${matchedZip || 'unknown'}, but the address says ${String(h.zipCode ?? '').trim().slice(0, 5) || 'none'}.`;
};

function staleUnmatched(entry) {
  if (!entry || entry.status !== 'unmatched') return false;
  const ageMs = Date.now() - new Date(entry.updatedAt).getTime();
  return ageMs > NEG_TTL_DAYS() * 86400000 && (entry.attempts || 1) < NEG_MAX_ATTEMPTS();
}

function addressString(h) {
  // Single-line address. Unit is deliberately omitted — geocoders ignore units and the
  // noise lowers match rate; distinct units are handled by the unitlessKey reuse + the
  // household upsert keeping them separate.
  const zip = String(h.zipCode ?? '').trim().slice(0, 5);
  return [h.addressLine1, h.city, `${String(h.state || '').trim()} ${zip}`.trim()].filter(Boolean).join(', ');
}

// Apply the confidence, bounding-box and ZIP gates to one provider result.
export function evaluate(r, h) {
  if (!r || r.status !== 'matched' || r.lat == null || r.lng == null) {
    return { ok: false, code: 'geocode_no_match', detail: 'Address could not be located.' };
  }
  if (answerClass(r) === 'none' || (r.accuracy != null && r.accuracy < GEOCODE_MIN_ACCURACY())) {
    return { ok: false, code: 'geocode_low_confidence', detail: `Best match was too imprecise (${r.accuracyType || 'unknown'}).` };
  }
  if (!inStateBounds(h.state, r.lat, r.lng)) {
    return { ok: false, code: 'geocode_out_of_bounds', detail: `Geocode landed outside ${String(h.state || '').toUpperCase()} — rejected.` };
  }
  const wrongZip = zipRefusal(r.matchedAddress, h);
  if (wrongZip) return { ok: false, code: 'geocode_wrong_zip', detail: wrongZip };
  return {
    ok: true, location: [r.lng, r.lat], confidence: confidenceFor(r.accuracyType),
    accuracyType: r.accuracyType, accuracy: r.accuracy, matchedAddress: r.matchedAddress,
  };
}

// Fill a household from a cached 'matched' answer — or refuse it. Returns null when filled, else the
// refusal sentence (the cached answer fails today's ZIP rule). The confidence is recomputed from the
// answer type, so a nearest_rooftop_match cached before the pin-fixes build fills as 'interpolated',
// not the 'exact' it was stored with; a row without a type falls back to its stored confidence.
// Evidence for callers that must decide whether this answer may OVERRULE an existing pin (the placement
// pass, repair:import-pins): the raw accuracy type, score and matched address. The importer never
// persists these — household docs pick fields explicitly.
export function fillFrom(h, entry) {
  const refusal = zipRefusal(entry.matchedAddress, h);
  if (refusal) return refusal;
  const [lng, lat] = entry.location.coordinates;
  h.longitude = lng; h.latitude = lat;
  h.coordSource = 'geocodio';
  const confidence = entry.accuracyType ? confidenceFor(entry.accuracyType) : entry.confidence;
  h.coordConfidence = confidence === 'none' ? null : confidence ?? null;
  h.geocodeAccuracyType = entry.accuracyType ?? null;
  h.geocodeMatchedAddress = entry.matchedAddress ?? null;
  h.geocodeAccuracy = entry.accuracy ?? null;
  return null;
}

// Build one cache upsert op; flushed in batches per geocode batch (vs. ~15k single writes).
function cacheOp(cacheKey, unitlessKey, fields) {
  return {
    updateOne: {
      filter: { cacheKey, provider: 'geocodio' },
      update: { $set: { unitlessKey: unitlessKey ?? null, ...fields }, $inc: { attempts: 1 } },
      upsert: true,
    },
  };
}
async function flushCacheOps(ops) {
  if (!ops.length) return;
  try {
    await GeocodeCache.bulkWrite(ops, { ordered: false });
  } catch (err) {
    // Concurrent imports can race to insert the same cacheKey → 11000; ordered:false still
    // applied every other op and it's cached now. Re-throw anything that isn't a dup key.
    const errs = err?.writeErrors || [];
    const onlyDup = err?.code === 11000 || (errs.length > 0 && errs.every((e) => (e?.code ?? e?.err?.code) === 11000));
    if (!onlyDup) throw err;
  }
}

/**
 * @param householdMap Map<normalizedAddress, householdObj> (mutated in place for matches)
 * @param opts { geocodeBatch?, onProgress?, cacheOnly? } — geocodeBatch injectable for tests;
 *             cacheOnly serves whatever the GeocodeCache already knows and never calls the
 *             provider (so an audit script can run for free).
 * @returns { unmatched: Map<normalizedAddress,{code,detail}>, stats }
 */
export async function resolve(householdMap, opts = {}) {
  const geocodeBatch = opts.geocodeBatch || geocodioBatch;
  const onProgress = opts.onProgress;
  const apiKey = process.env.GEOCODIO_API_KEY;

  const stats = { geocodedNew: 0, geocodedCached: 0, geocodeUnmatched: 0, geocodeFailed: 0 };
  const unmatched = new Map();

  // 1. Households needing a geocode (null coords) that are eligible.
  const targets = [];
  for (const [normAddr, h] of householdMap) {
    if (!needsGeocode(h)) continue;
    if (!zipEligible(h)) {
      unmatched.set(normAddr, { code: 'geocode_bad_address', detail: 'Address has no valid 5-digit ZIP — cannot geocode.' });
      stats.geocodeUnmatched += 1;
      continue;
    }
    targets.push({ normAddr, h, cacheKey: geocodeCacheKey(h), unitlessKey: geocodeUnitlessKey(h) });
  }
  if (!targets.length) return { unmatched, stats };

  // 2. Cache lookup — chunk the $in (a 25k import can have ~30k keys) and PROJECT OUT the
  //    heavy `raw` blob (read but never used here), building the map directly so no large
  //    intermediate array survives.
  const allKeys = new Set();
  for (const t of targets) { allKeys.add(t.cacheKey); if (t.unitlessKey) allKeys.add(t.unitlessKey); }
  let cacheByKey = new Map();
  const keyList = [...allKeys];
  for (let i = 0; i < keyList.length; i += 5000) {
    const rows = await GeocodeCache.find(
      { provider: 'geocodio', cacheKey: { $in: keyList.slice(i, i + 5000) } },
      { raw: 0 }
    ).lean();
    for (const r of rows) cacheByKey.set(r.cacheKey, r);
  }

  // Sliding-TTL touch: reading an entry keeps it alive (see GeocodeCache.lastUsedAt). Best-effort and
  // fire-and-forget — a cache-retention bump must never slow down or fail an import.
  if (cacheByKey.size) {
    GeocodeCache.updateMany(
      { provider: 'geocodio', cacheKey: { $in: [...cacheByKey.keys()] } },
      { $set: { lastUsedAt: new Date() } }
    ).catch(() => {});
  }

  // 3. Split into cache-hits vs the unique cacheKeys to geocode.
  const toGeocode = new Map(); // cacheKey -> { h, unitlessKey, members:[target...] }
  for (const t of targets) {
    const entry = cacheByKey.get(t.cacheKey);
    if (entry?.status === 'matched' && entry.location?.coordinates?.length === 2) {
      // A cached answer that fails today's ZIP rule is not filled and not re-bought: it is Geocodio's
      // answer for that address string and won't change until the address does (a new cache key).
      const refusal = fillFrom(t.h, entry);
      if (refusal) { unmatched.set(t.normAddr, { code: 'geocode_wrong_zip', detail: refusal }); stats.geocodeUnmatched += 1; continue; }
      stats.geocodedCached += 1; continue;
    }
    if (entry?.status === 'unmatched' && !staleUnmatched(entry)) {
      unmatched.set(t.normAddr, { code: 'geocode_no_match', detail: 'Address could not be located.' });
      stats.geocodeUnmatched += 1; continue;
    }
    if (t.unitlessKey) {
      const u = cacheByKey.get(t.unitlessKey);
      if (u?.status === 'matched' && u.location?.coordinates?.length === 2) {
        // The building's answer, for a unit. A refused one is final for the unit too: the address sent
        // to the provider omits the unit, so buying the unit's own lookup would return the same answer.
        const refusal = fillFrom(t.h, u);
        if (refusal) { unmatched.set(t.normAddr, { code: 'geocode_wrong_zip', detail: refusal }); stats.geocodeUnmatched += 1; continue; }
        stats.geocodedCached += 1; continue;
      }
    }
    let g = toGeocode.get(t.cacheKey);
    if (!g) { g = { h: t.h, unitlessKey: t.unitlessKey, members: [] }; toGeocode.set(t.cacheKey, g); }
    g.members.push(t);
  }
  cacheByKey = null; // cache lookup done — release it before the geocode batches
  if (!toGeocode.size) return { unmatched, stats };

  // No key, or the caller explicitly refused to spend money (opts.cacheOnly — used by the
  // repair:import-pins audit, which must be free to run and re-run). Cache hits above have
  // already filled; everything still missing is reported, never looked up.
  if (!apiKey || opts.cacheOnly) {
    const detail = apiKey
      ? 'Cache-only run — no provider lookup was attempted.'
      : 'Geocoding is not configured (missing GEOCODIO_API_KEY).';
    for (const [, g] of toGeocode) for (const t of g.members) {
      unmatched.set(t.normAddr, { code: 'geocode_failed', detail });
      stats.geocodeFailed += 1;
    }
    return { unmatched, stats };
  }

  // 4. Geocode the unique misses in batches; cache + fill per batch.
  const entries = [...toGeocode.entries()];
  const size = BATCH_SIZE();
  let processed = 0;
  for (let i = 0; i < entries.length; i += size) {
    const chunk = entries.slice(i, i + size);
    let results;
    try {
      results = await geocodeBatch(chunk.map(([, g]) => addressString(g.h)), { apiKey, timeoutMs: TIMEOUT_MS() });
    } catch {
      // Transient batch failure → NOT cached, reported, retried cheaply on re-import.
      for (const [, g] of chunk) for (const t of g.members) {
        unmatched.set(t.normAddr, { code: 'geocode_failed', detail: 'Geocoding service error (will retry on re-import).' });
        stats.geocodeFailed += 1;
      }
      processed += chunk.length;
      if (onProgress) await onProgress(processed, entries.length);
      continue;
    }
    const cacheOps = [];
    for (let j = 0; j < chunk.length; j += 1) {
      const [cacheKey, g] = chunk[j];
      const r = results[j];
      const d = evaluate(r, g.h);
      if (d.ok) {
        cacheOps.push(cacheOp(cacheKey, g.unitlessKey, {
          status: 'matched', location: { type: 'Point', coordinates: d.location },
          accuracyType: d.accuracyType, accuracy: d.accuracy, confidence: d.confidence,
          matchedAddress: d.matchedAddress,
        }));
        for (const t of g.members) {
          t.h.longitude = d.location[0]; t.h.latitude = d.location[1];
          t.h.coordSource = 'geocodio'; t.h.coordConfidence = d.confidence === 'none' ? null : d.confidence;
          t.h.geocodeAccuracyType = d.accuracyType ?? null;
          t.h.geocodeMatchedAddress = d.matchedAddress ?? null;
          t.h.geocodeAccuracy = d.accuracy ?? null;
        }
        stats.geocodedNew += g.members.length;
      } else {
        cacheOps.push(cacheOp(cacheKey, g.unitlessKey, {
          status: 'unmatched', location: null, accuracyType: r?.accuracyType ?? null,
          accuracy: r?.accuracy ?? null, confidence: 'none', matchedAddress: r?.matchedAddress ?? null,
        }));
        for (const t of g.members) { unmatched.set(t.normAddr, { code: d.code, detail: d.detail }); stats.geocodeUnmatched += 1; }
      }
    }
    await flushCacheOps(cacheOps);
    processed += chunk.length;
    if (onProgress) await onProgress(processed, entries.length);
  }

  return { unmatched, stats };
}

// Cache-only forecast for the import PREVIEW — makes ZERO provider calls (so the
// preview stays instant + free). Reports how many addresses need geocoding, how many
// are already cached (matched / definitively-unmatched), how many are new lookups, and
// an estimated cost for the new ones.
export async function forecast(householdMap) {
  const enabled = process.env.GEOCODE_ENABLED === 'true';
  let uniqueNeedingGeocode = 0;
  let badZip = 0;
  const keys = [];
  const seen = new Set();
  for (const [, h] of householdMap) {
    if (!needsGeocode(h)) continue;
    uniqueNeedingGeocode += 1;
    if (!zipEligible(h)) { badZip += 1; continue; }
    const k = geocodeCacheKey(h);
    if (!seen.has(k)) { seen.add(k); keys.push(k); }
  }
  let cachedMatched = 0, cachedUnmatched = 0, newToGeocode = 0;
  if (keys.length) {
    const rows = await GeocodeCache.find(
      { provider: 'geocodio', cacheKey: { $in: keys } },
      { cacheKey: 1, status: 1, updatedAt: 1, attempts: 1 }
    ).lean();
    const byKey = new Map(rows.map((r) => [r.cacheKey, r]));
    for (const k of keys) {
      const e = byKey.get(k);
      if (e?.status === 'matched') cachedMatched += 1;
      else if (e?.status === 'unmatched' && !staleUnmatched(e)) cachedUnmatched += 1;
      else newToGeocode += 1;
    }
  }
  // No dollar figure here — geocoding cost is owner-only (super-admin Imports page), never sent to
  // the client. Only the placement counts (cached vs. new) surface in the admin import preview.
  return { enabled, uniqueNeedingGeocode, badZip, cachedMatched, cachedUnmatched, newToGeocode };
}
