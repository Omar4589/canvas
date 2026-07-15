import mongoose from 'mongoose';

// GeoJSON point (same convention as Household.js — kept local since that one isn't exported).
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  { _id: false }
);

// A persistent address→coordinate cache so we never pay to geocode the same physical
// address twice — across re-imports, overlapping files, and every campaign/org
// (coordinates for an address are universal, so this is intentionally org/campaign-agnostic).
// Keyed on `looseAddressKey` (formatting-drift-tolerant) so vendor spelling variants
// collapse to one geocode. `status:'unmatched'` is a NEGATIVE cache (don't re-hammer the
// provider), re-tried only when stale (see geocodeService).
const geocodeCacheSchema = new mongoose.Schema(
  {
    cacheKey: { type: String, required: true }, // looseAddressKey(address)
    unitlessKey: { type: String, default: null, index: true }, // looseAddressKey without the unit, for tower reuse
    provider: { type: String, enum: ['geocodio'], required: true },
    accuracyType: { type: String, default: null }, // e.g. 'rooftop' | 'range_interpolation' | 'place'
    accuracy: { type: Number, default: null }, // 0–1 provider score
    status: { type: String, enum: ['matched', 'unmatched'], required: true },
    confidence: { type: String, enum: ['exact', 'interpolated', 'none'], default: 'none' },
    location: { type: pointSchema, default: null }, // null when unmatched
    matchedAddress: { type: String, default: null }, // provider's standardized address
    attempts: { type: Number, default: 1 }, // negative-cache retry budget
    // NOTE: the full provider `raw` response is deliberately NOT stored — it was written but never
    // read (every read projects it out), and the useful signal (accuracyType/accuracy/confidence)
    // is already promoted to the fields above. Dropping it cuts each entry ~5-6×. A one-time
    // migration ($unset raw) reclaims it on existing docs. See migrations/stripGeocodeRaw.js.

    // Sliding retention. This cache is intentionally org-agnostic (an address→coordinate is universal
    // and shared across every customer, so org-attributing it would defeat the dedup and force paying
    // to re-geocode the same address). But "shared forever" is its own problem: it would otherwise hold
    // every street address the platform has ever imported, indefinitely, including for deleted
    // customers. `lastUsedAt` is refreshed every time an import reads the entry, and the TTL index below
    // deletes entries untouched for the window — so the cache retains only addresses still in active
    // use, not a permanent record of everywhere anyone ever canvassed. It carries no name or person
    // link — only address→coordinate — so this is the least identifying address copy in the system.
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

geocodeCacheSchema.index({ cacheKey: 1, provider: 1 }, { unique: true });
geocodeCacheSchema.index({ status: 1, updatedAt: 1 }); // negative-cache staleness sweep
// TTL: expire entries not used within the window (default 18 months — a full election cycle plus
// slack). Refreshed on every cache hit (see geocodeService), so hot addresses never expire and
// abandoned ones age out on their own. autoIndex is off in prod: build via migrate:build-indexes.
geocodeCacheSchema.index(
  { lastUsedAt: 1 },
  { expireAfterSeconds: Number(process.env.GEOCODE_CACHE_TTL_DAYS || 540) * 86_400 }
);

export const GeocodeCache = mongoose.model('GeocodeCache', geocodeCacheSchema);
