import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: { type: Number, default: null },
  },
  { _id: false }
);

const canvassActivitySchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    actionType: {
      type: String,
      enum: ['not_home', 'wrong_address', 'survey_submitted', 'note_added', 'lit_dropped'],
      required: true,
      index: true,
    },

    note: { type: String, default: null },

    location: { type: locationSchema, required: true },
    distanceFromHouseMeters: { type: Number, default: null },

    timestamp: { type: Date, required: true, index: true },
    wasOfflineSubmission: { type: Boolean, default: false },
  },
  { timestamps: true }
);

canvassActivitySchema.index({ userId: 1, timestamp: -1 });
canvassActivitySchema.index({ householdId: 1, timestamp: -1 });
canvassActivitySchema.index({ campaignId: 1, timestamp: -1 });

export const CanvassActivity = mongoose.model('CanvassActivity', canvassActivitySchema);
