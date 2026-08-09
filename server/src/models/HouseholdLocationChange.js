import mongoose from 'mongoose';

// GeoJSON point (same convention as Household.js).
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined }, // [lng, lat]
  },
  { _id: false }
);

// Audit trail of pin corrections — one row per move, so we keep a full history of
// who moved which door's pin, from where, to where, and how. The Household itself
// caches only the LATEST correction (correctedBy/correctedAt/previousLocation); this
// collection is the complete log. Deliberately SEPARATE from CanvassActivity so a pin
// move is never mistaken for a knock by the status/knock/report aggregations.
const householdLocationChangeSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who moved it
    // 'import_repair' = repair:import-pins, the offline script that adjudicates doors whose
    // import rows disagreed on a pin. Its own value rather than 'admin_drag' — nobody dragged
    // anything, and mislabeling it would put a lie in a permanent audit log.
    source: { type: String, enum: ['gps', 'drag', 'admin_drag', 'import_repair'], required: true },
    scope: { type: String, enum: ['unit', 'building'], default: 'unit' },
    accuracy: { type: Number, default: null }, // GPS accuracy (m) when source === 'gps'
    from: { type: pointSchema, default: null }, // pre-move point (null if the door had none)
    to: { type: pointSchema, required: true }, // the corrected point
  },
  { timestamps: true }
);

householdLocationChangeSchema.index({ householdId: 1, createdAt: -1 });

export const HouseholdLocationChange = mongoose.model('HouseholdLocationChange', householdLocationChangeSchema);
