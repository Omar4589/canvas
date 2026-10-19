import mongoose from 'mongoose';
import { answerSchema, locationSchema } from './SurveyResponse.js';

// Full snapshot of a SurveyResponse that a LATER write replaced or removed. Five producers:
//   'submit'  — a DIFFERENT canvasser's field submission overwrote it (canvass.js), or the same
//               canvasser re-surveyed over answers an admin desk-entered. A same-canvasser
//               re-submit over their own field answers is the designed self-heal and archives
//               nothing.
//   'restore' — an admin restore made an archived response current again; the response it
//               displaced lands here, so the swap is lossless in both directions.
//   'outcome_convert' — an admin converted a Surveyed door back to a door outcome
//               (services/canvass/surveyConversion.js), typically fraud cleanup. The answers
//               are the EVIDENCE, so they are archived rather than deleted; `conversionRunId`
//               links them to the run, which is what Revert reads to put them back.
//   'unknock' — an admin struck the visit itself from the record (services/canvass/unknock.js);
//               `unknockRunId` links the copy to that run's revert.
//   'answer_edit' — an admin changed some ANSWERS on a survey that stays surveyed (Door Outcomes
//               "Edit answers…", its one-person walkthrough, or the profile's Edit —
//               services/canvass/answerEditWriter.js). The copy is the survey as it was before;
//               `answerEditRunId` + `responseId` link it to the run and the live survey, and
//               `appliedHash` fingerprints what the edit wrote, which is how the undo tells "this
//               edit is what's on file" from "someone changed it since".
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
// 'outcome_convert', 'unknock' or 'answer_edit' — a change nobody undoes leaves its archive rows in
// place indefinitely, which IS the "recoverable" promise, not a leak; each row is individually
// erasable from the profile. Tenant deletion still reaches them (deleteCampaign.js,
// deleteOrganization.js); see docs/PRIVACY_VERIFICATION.md §B6.
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
    // The response's own note stamp and landing marks travel with the snapshot (SurveyResponse.js);
    // absent on rows copied before they existed, which is what their absence means there too.
    noteEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: undefined },
    noteEditedAt: { type: Date, default: undefined },
    answerEditMarks: { type: [mongoose.Schema.Types.ObjectId], default: undefined },

    // The desk-entry stamp travels with the snapshot: an archived row must still say whether the
    // response it holds was collected in the field or typed at a desk.
    deskEntry: { type: mongoose.Schema.Types.Mixed, default: undefined },

    // ---- replacement provenance (server-stamped) ----
    overwrittenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    overwrittenVia: {
      type: String,
      enum: ['submit', 'restore', 'outcome_convert', 'unknock', 'answer_edit'],
      required: true,
    },
    overwrittenAt: { type: Date, required: true, default: () => new Date() },
    // Set only by 'outcome_convert'. Revert of that run reads it to restore these rows.
    conversionRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SurveyConversionRun',
      default: null,
    },
    // Set only by 'unknock' — the twin of conversionRunId for the run model that REMOVES the
    // entry rather than relabelling it. A separate field rather than a shared "runId" because the
    // ref differs and a reader must be able to tell which kind of run took these answers without
    // guessing from `overwrittenVia`.
    unknockRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UnknockRun',
      default: null,
    },
    // Set only by 'answer_edit'. NO default, unlike the two run ids above: their null defaults put
    // every archive row into their "partial" indexes (a null passes $exists). Absent here means the
    // index below really holds only answer-edit rows.
    answerEditRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnswerEditRun' },
    // The live survey this copy came from (its slot is {voterId, passId}; the id is how the run's
    // own Details join back while the survey keeps it — a revert elsewhere can re-create it under a
    // new id, so the writer and the undo always find the live survey by slot).
    responseId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyResponse' },
    // fingerprint() of the survey as this edit wrote it (services/canvass/answerEdit.js).
    appliedHash: { type: String },
    // Stamped by the undo just before its put-back, so a pass that died between the put-back and
    // deleting this row can tell "put back already" from "changed since" on the next pass.
    undoStartedAt: { type: Date },
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
// Same shape, same reason, for an unknock run's revert. DISTINCT key shape from every index
// above — buildIndexes.js diffs by key shape alone, so a partial reusing an existing shape is
// silently reported as already-present and never built.
surveyResponseArchiveSchema.index(
  { unknockRunId: 1 },
  { partialFilterExpression: { unknockRunId: { $exists: true } } }
);
// An answer-edit run's copies: its undo and redelivery look them up by (run, survey), and its
// Details page lists them newest first. Two shapes, both distinct from every index above
// (buildIndexes.js diffs by key shape alone). Truly partial: answerEditRunId has no default.
surveyResponseArchiveSchema.index(
  { answerEditRunId: 1, responseId: 1 },
  { partialFilterExpression: { answerEditRunId: { $exists: true } } }
);
surveyResponseArchiveSchema.index(
  { answerEditRunId: 1, overwrittenAt: -1 },
  { partialFilterExpression: { answerEditRunId: { $exists: true } } }
);

export const SurveyResponseArchive = mongoose.model(
  'SurveyResponseArchive',
  surveyResponseArchiveSchema
);
