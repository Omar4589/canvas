import { GeocodeCache } from '../../../models/GeocodeCache.js';
import { looseAddressKey } from '../../../utils/normalizeAddress.js';
import { inStateBounds } from '../../../utils/stateBounds.js';
import { geocodeBatch as geocodioBatch } from './geocodioProvider.js';

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
const MIN_ACCURACY = () => num(process.env.GEOCODE_MIN_ACCURACY, 0.5);
const NEG_TTL_DAYS = () => num(process.env.GEOCODE_NEGCACHE_TTL_DAYS, 30);
const NEG_MAX_ATTEMPTS = () => num(process.env.GEOCODE_NEGCACHE_MAX_ATTEMPTS, 4);

// Accept rooftop/street-level matches; REJECT true centroids (place/county/state) — a
// door pin must never be a city centroid.
const ACCEPTED_TYPES = new Set(['rooftop', 'point', 'nearest_rooftop_match', 'range_interpolation', 'street_center']);
const ROOFTOP_TYPES = new Set(['rooftop', 'point', 'nearest_rooftop_match']);
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
export function needsGeocode(h) {
  return h.latitude == null || h.longitude == null;
}
export function zipEligible(h) {
  return /^\d{5}$/.test(String(h.zipCode ?? '').trim().slice(0, 5));
}

function confidenceFor(accuracyType) {
  if (ROOFTOP_TYPES.has(accuracyType)) return 'exact';
  if (ACCEPTED_TYPES.has(accuracyType)) return 'interpolated';
  return 'none';
}

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

// Apply the confidence + bounding-box gates to one provider result.
function evaluate(r, h) {
  if (!r || r.status !== 'matched' || r.lat == null || r.lng == null) {
    return { ok: false, code: 'geocode_no_match', detail: 'Address could not be located.' };
  }
  if (!ACCEPTED_TYPES.has(r.accuracyType) || (r.accuracy != null && r.accuracy < MIN_ACCURACY())) {
    return { ok: false, code: 'geocode_low_confidence', detail: `Best match was too imprecise (${r.accuracyType || 'unknown'}).` };
  }
  if (!inStateBounds(h.state, r.lat, r.lng)) {
    return { ok: false, code: 'geocode_out_of_bounds', detail: `Geocode landed outside ${String(h.state || '').toUpperCase()} — rejected.` };
  }
  return {
    ok: true, location: [r.lng, r.lat], confidence: confidenceFor(r.accuracyType),
    accuracyType: r.accuracyType, accuracy: r.accuracy, matchedAddress: r.matchedAddress,
  };
}

async function writeCache(cacheKey, unitlessKey, fields) {
  try {
    await GeocodeCache.updateOne(
      { cacheKey, provider: 'geocodio' },
      { $set: { unitlessKey: unitlessKey ?? null, ...fields }, $inc: { attempts: 1 } },
      { upsert: true }
    );
  } catch (err) {
    if (!(err && err.code === 11000)) throw err; // concurrent insert — fine, it's cached now
  }
}

/**
 * @param householdMap Map<normalizedAddress, householdObj> (mutated in place for matches)
 * @param opts { geocodeBatch?, onProgress? } — geocodeBatch injectable for tests
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

  // 2. Cache lookup (cacheKeys + unitlessKeys in one query).
  const allKeys = new Set();
  for (const t of targets) { allKeys.add(t.cacheKey); if (t.unitlessKey) allKeys.add(t.unitlessKey); }
  const cacheRows = await GeocodeCache.find({ provider: 'geocodio', cacheKey: { $in: [...allKeys] } }).lean();
  const cacheByKey = new Map(cacheRows.map((r) => [r.cacheKey, r]));

  const fillFrom = (h, entry) => {
    const [lng, lat] = entry.location.coordinates;
    h.longitude = lng; h.latitude = lat;
    h.coordSource = 'geocodio';
    h.coordConfidence = entry.confidence === 'none' ? null : entry.confidence;
  };

  // 3. Split into cache-hits vs the unique cacheKeys to geocode.
  const toGeocode = new Map(); // cacheKey -> { h, unitlessKey, members:[target...] }
  for (const t of targets) {
    const entry = cacheByKey.get(t.cacheKey);
    if (entry?.status === 'matched' && entry.location?.coordinates?.length === 2) {
      fillFrom(t.h, entry); stats.geocodedCached += 1; continue;
    }
    if (entry?.status === 'unmatched' && !staleUnmatched(entry)) {
      unmatched.set(t.normAddr, { code: 'geocode_no_match', detail: 'Address could not be located.' });
      stats.geocodeUnmatched += 1; continue;
    }
    if (t.unitlessKey) {
      const u = cacheByKey.get(t.unitlessKey);
      if (u?.status === 'matched' && u.location?.coordinates?.length === 2) {
        fillFrom(t.h, u); stats.geocodedCached += 1; continue;
      }
    }
    let g = toGeocode.get(t.cacheKey);
    if (!g) { g = { h: t.h, unitlessKey: t.unitlessKey, members: [] }; toGeocode.set(t.cacheKey, g); }
    g.members.push(t);
  }
  if (!toGeocode.size) return { unmatched, stats };

  if (!apiKey) {
    for (const [, g] of toGeocode) for (const t of g.members) {
      unmatched.set(t.normAddr, { code: 'geocode_failed', detail: 'Geocoding is not configured (missing GEOCODIO_API_KEY).' });
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
    for (let j = 0; j < chunk.length; j += 1) {
      const [cacheKey, g] = chunk[j];
      const r = results[j];
      const d = evaluate(r, g.h);
      if (d.ok) {
        await writeCache(cacheKey, g.unitlessKey, {
          status: 'matched', location: { type: 'Point', coordinates: d.location },
          accuracyType: d.accuracyType, accuracy: d.accuracy, confidence: d.confidence,
          matchedAddress: d.matchedAddress, raw: r?.raw ?? null,
        });
        for (const t of g.members) {
          t.h.longitude = d.location[0]; t.h.latitude = d.location[1];
          t.h.coordSource = 'geocodio'; t.h.coordConfidence = d.confidence === 'none' ? null : d.confidence;
        }
        stats.geocodedNew += g.members.length;
      } else {
        await writeCache(cacheKey, g.unitlessKey, {
          status: 'unmatched', location: null, accuracyType: r?.accuracyType ?? null,
          accuracy: r?.accuracy ?? null, confidence: 'none', matchedAddress: r?.matchedAddress ?? null, raw: r?.raw ?? null,
        });
        for (const t of g.members) { unmatched.set(t.normAddr, { code: d.code, detail: d.detail }); stats.geocodeUnmatched += 1; }
      }
    }
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
  const estCostUsd = Math.round((newToGeocode / 1000) * 100) / 100; // ~$1 / 1k
  return { enabled, uniqueNeedingGeocode, badZip, cachedMatched, cachedUnmatched, newToGeocode, estCostUsd };
}
