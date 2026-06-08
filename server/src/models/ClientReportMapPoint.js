import mongoose from 'mongoose';

// One FROZEN household point for a published ClientReport's map. Lives in its own collection
// (not an inline array on ClientReport) so a large campaign's coverage can't blow the 16MB
// BSON limit. Built at publish time from the as-of-week-end household status + the operator-
// whitelisted survey answers. CANVASSER IDENTITY IS NEVER STORED HERE — no userId, no voter
// name, no timestamps — so the client map can't leak who knocked or who answered.

const pointAnswerSchema = new mongoose.Schema(
  {
    questionKey: { type: String, required: true },
    // String for single-choice, array for multiple-choice.
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const clientReportMapPointSchema = new mongoose.Schema(
  {
    clientReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClientReport',
      required: true,
      index: true,
    },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    // Opaque household reference — used only for de-dup at build time, never sent to the client.
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', default: null },

    lng: { type: Number, required: true },
    lat: { type: Number, required: true },
    // Coarse address (street + city/state) for the map label — no unit/voter detail.
    addressLine1: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },

    // Household status AS OF the report's rangeEndUtc (recomputed via resolveStatus, NOT live).
    status: { type: String, default: 'unknocked' },
    // Only the operator-whitelisted survey answers, for client-side map filtering.
    answers: { type: [pointAnswerSchema], default: [] },
  },
  { timestamps: false }
);

clientReportMapPointSchema.index({ clientReportId: 1 });

export const ClientReportMapPoint = mongoose.model(
  'ClientReportMapPoint',
  clientReportMapPointSchema
);
