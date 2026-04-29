import mongoose from 'mongoose';

const voterSchema = new mongoose.Schema(
  {
    householdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Household',
      required: true,
      index: true,
    },

    stateVoterId: { type: String, required: true, unique: true, index: true, trim: true },
    uid: { type: String, default: null, index: true, trim: true },

    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    fullName: { type: String, required: true, trim: true },

    phone: { type: String, default: null, trim: true },
    phoneType: { type: String, default: null, trim: true },
    cellPhone: { type: String, default: null, trim: true },

    party: { type: String, default: null, trim: true },
    gender: { type: String, default: null, trim: true },
    dateOfBirth: { type: Date, default: null },

    registrationStatus: { type: String, default: null, trim: true },
    registeredState: { type: String, default: null, trim: true, uppercase: true },

    congressionalDistrict: { type: String, default: null, trim: true },
    stateSenateDistrict: { type: String, default: null, trim: true },
    stateHouseDistrict: { type: String, default: null, trim: true },
    precinct: { type: String, default: null, trim: true },

    surveyStatus: {
      type: String,
      enum: ['not_surveyed', 'surveyed'],
      default: 'not_surveyed',
      index: true,
    },
  },
  { timestamps: true }
);

voterSchema.index({ householdId: 1, surveyStatus: 1 });

export const Voter = mongoose.model('Voter', voterSchema);
