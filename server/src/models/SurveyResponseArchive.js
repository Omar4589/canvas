import mongoose from 'mongoose';
import { answerSchema, locationSchema } from './SurveyResponse.js';

// Full snapshot of a SurveyResponse that a LATER write replaced or removed. Three producers:
//   'submit'  — a DIFFERENT canvasser's field submission overwrote it (canvass.js). A
//               same-canvasser re-submit is the designed self-heal and archives nothing.
//   'restore' — an admin restore made an archived response current again; the response it
//               displaced lands here, so the swap is lossless in both directions.
//   'outcome_convert' — an admin converted a Surveyed door back to a door outcome
//               (services/canvass/surveyConversion.js), typically fraud cleanup. The answers
//               are the EVIDENCE, so they are archived rather than deleted; `conversionRunId`
//               links them to the run, which is what Revert reads to put them back.
// Provenance is stamped server-side ONLY — never accepted from a request body (the
// CanvassActivity.replaced rule, so a client can't forge history).
//
// Deliberately a SEPARATE collection (the HouseholdLocationChange precedent), so an
// overwritten response can never be mistaken for a current one by surveyedVotersFromDoorPass,
// recomputeSurveyStatus, computeCampaignStats, or any export/report — by construction, not by
// auditing every reader. Restore DELETES the row it promotes, so every row here is
// currently-archived: no `restored` filter exists anywhere and a second restore of the same row
// is an honest 404.
//
// GROWTH: bounded for 'submit'/'restore' because restore consumes rows. NOT bounded for
// 'outcome_convert' — a conversion nobody reverts leaves its archive rows in place indefinitely,
// which IS the "recoverable" promise, not a leak. Tenant deletion still reaches them
// (deleteCampaign.js, deleteOrganization.js); see docs/PRIVACY_VERIFICATION.md §B6.
const surveyResponseArchiveSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true,
    },
    voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter', required: true },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },

    // ---- verbatim snapshot of the replaced SurveyResponse ----
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', required: true },
    surveyTemplateVersion: { type: Number, required: true },
    answers: { type: [answerSchema], default: [] },
    note: { type: String, default: null },
    location: { type: locationSchema, required: true },
    distanceFromHouseMeters: { type: Number, default: null },
    submittedAt: { type: Date, required: true },
    syncedAt: { type: Date, default: null },
    wasOfflineSubmission: { type: Boolean, default: false },
    passId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pass', default: null },
    turfId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turf', default: null },
    effortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Effort', default: null },
    coordinatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    editedAt: { type: Date, default: null },

    // The desk-entry stamp travels with the snapshot: an archived row must still say whether the
    // response it holds was collected in the field or typed at a desk.
    deskEntry: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // ---- replacement provenance (server-stamped) ----
    overwrittenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    overwrittenVia: { type: String, enum: ['submit', 'restore', 'outcome_convert'], required: true },
    overwrittenAt: { type: Date, required: true, default: () => new Date() },
    // Set only by 'outcome_convert'. Revert of that run reads it to restore these rows.
    conversionRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SurveyConversionRun',
      default: null,
    },
  },
  { timestamps: true }
);

// Deliberately NOT unique on {voterId, passId} — restore flip-flops legitimately leave
// multiple archived rows per key.
surveyResponseArchiveSchema.index({ voterId: 1, passId: 1 }); // profile join + restore lookup
surveyResponseArchiveSchema.index({ householdId: 1, passId: 1 }); // overlaps annotation
surveyResponseArchiveSchema.index({ campaignId: 1, overwrittenAt: -1 }); // report + cascades
// Reverting a Surveyed→outcome run restores exactly the rows THAT run archived. Partial, same
// distinct-key-shape rule as the SurveyResponse.deskEntry index.
surveyResponseArchiveSchema.index(
  { conversionRunId: 1 },
  { partialFilterExpression: { conversionRunId: { $exists: true } } }
);

export const SurveyResponseArchive = mongoose.model(
  'SurveyResponseArchive',
  surveyResponseArchiveSchema
);
