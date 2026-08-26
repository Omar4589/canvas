import mongoose from 'mongoose';
import { answerSchema } from './SurveyResponse.js';

// One survey-conversion run — the Door Outcomes page's Surveyed direction, both ways:
//   'to_survey'   — door outcomes → Surveyed, with the admin supplying the answers.
//   'from_survey' — Surveyed → a door outcome, archiving the answers (fraud cleanup).
//
// This is the sibling of ReclassifyRun, and the split is deliberate: a plain reclassify is a pure
// actionType flip with no second ledger, which is what makes it provably rate-neutral, unbounded,
// and revertible in four lines. A survey conversion also writes N SurveyResponse rows per door,
// Voter.surveyStatus, Campaign.stats.surveyCount and the platform counters — so it is priced, it
// is capped, and it runs on the worker.
//
// WHAT IS NOT HERE: a manifest of the rows touched. 25k entries at ~2 voters/door is ~50k
// responses, and an id list on one doc is megabytes of BSON. Every artifact instead carries THIS
// run's id — CanvassActivity.reclassified.runId, SurveyResponse.deskEntry.runId,
// SurveyResponseArchive.conversionRunId — so revert is a sweep by stamp: exact by construction,
// bounded in memory, and correct even for a job that only half finished.
const surveyConversionRunSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    direction: { type: String, enum: ['to_survey', 'from_survey'], required: true },
    // 'bulk'  — one answer set applied to the whole selection, run on the worker.
    // 'single'— one door, entered and applied synchronously.
    // 'queue' — a bulk selection stepped through door by door, each door applied synchronously.
    //           A queue run stays `open` between steps; its remaining doors are DERIVED (the
    //           frozen actionIds minus the rows already stamped with this runId), never stored,
    //           so an abandoned session can be resumed or reverted without a cursor to corrupt.
    mode: { type: String, enum: ['bulk', 'single', 'queue'], required: true },

    // The distinct origin outcomes in the selection, and the target. Plain strings (not the
    // reclassify enums) because one side is always a completion action.
    sources: { type: [String], default: [] },
    to: { type: String, required: true },

    // to_survey only. The ONE template every door in the selection resolves to — a selection
    // spanning two effective templates is refused at preview, because writing a response under a
    // template the mobile route itself 400s for that door would manufacture data the field path
    // forbids.
    surveyTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyTemplate', default: null },
    surveyTemplateVersion: { type: Number, default: null },
    // The bulk answer set, replayed by the worker for every eligible voter. Empty for
    // single/queue, where each door carries its own answers in the request.
    answers: { type: [answerSchema], default: [] },
    note: { type: String, default: null },

    // Frozen, validated request snapshot (the ExportJob.params precedent) — the worker has no req.
    // `byIds` records whether the admin hand-ticked rows or wrote by filter alone.
    selection: {
      scope: { type: mongoose.Schema.Types.Mixed, default: {} },
      actionIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
      byIds: { type: Boolean, default: false },
    },
    // One human line for the filter, frozen at creation (services/canvass/scopeSummary.js) so it
    // names what the admin SAW, not what the options are called now. Null = no filter.
    scopeSummary: { type: String, default: null },

    status: {
      type: String,
      enum: ['open', 'pending', 'running', 'completed', 'failed', 'reverting', 'reverted'],
      default: 'pending',
      index: true,
    },
    progress: {
      phase: { type: String, default: null }, // 'converting' | 'recomputing' | 'reverting'
      pct: { type: Number, default: 0 },
      doorsDone: { type: Number, default: 0 },
      doorsTotal: { type: Number, default: 0 },
    },

    // Every number the result card shows. The skip buckets are separate on purpose: "we didn't
    // touch this voter" has three very different reasons and an admin needs to tell them apart.
    counts: {
      entriesTargeted: { type: Number, default: 0 },
      doorsTargeted: { type: Number, default: 0 },
      entriesConverted: { type: Number, default: 0 },
      responsesCreated: { type: Number, default: 0 },
      responsesArchived: { type: Number, default: 0 },
      // Revert could not put an archived response back: the {voterId,passId} slot was refilled by
      // a later field submit. We never clobber that — the row stays archived and is listed.
      responsesNotRestored: { type: Number, default: 0 },
      votersSkippedAlreadyAnswered: { type: Number, default: 0 },
      votersSkippedDnc: { type: Number, default: 0 },
      doorsNoVoters: { type: Number, default: 0 },
      doorsAllAlreadyAnswered: { type: Number, default: 0 },
      entriesNoResponses: { type: Number, default: 0 },
    },

    // Named examples behind the counts, capped — an admin acts on names, not totals.
    samples: {
      type: [
        {
          _id: false,
          voterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Voter' },
          voterName: String,
          reason: { type: String }, // 'already_answered' | 'dnc' | 'not_restored'
        },
      ],
      default: [],
    },
    samplesTruncated: { type: Boolean, default: false },
    samplesTotal: { type: Number, default: 0 },

    // bumpLive is the one write here that is NOT idempotent, so a stall redelivery must not
    // double-count it. CAS'd exactly once at the end of a run.
    liveBumped: { type: Boolean, default: false },

    error: { type: String, default: null },
    queueJobId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // null = still in effect. A reverted run is kept, not deleted (the ReclassifyRun rule).
    revertedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The runs list on the Door Outcomes page — newest first.
surveyConversionRunSchema.index({ campaignId: 1, createdAt: -1 });
// "Is one already open or running for this org?" — the ExportJob throttle precedent.
surveyConversionRunSchema.index({ organizationId: 1, status: 1 });

export const SurveyConversionRun = mongoose.model('SurveyConversionRun', surveyConversionRunSchema);
