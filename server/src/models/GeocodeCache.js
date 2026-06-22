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
    raw: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

geocodeCacheSchema.index({ cacheKey: 1, provider: 1 }, { unique: true });
geocodeCacheSchema.index({ status: 1, updatedAt: 1 }); // negative-cache staleness sweep

export const GeocodeCache = mongoose.model('GeocodeCache', geocodeCacheSchema);
