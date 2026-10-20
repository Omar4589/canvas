import mongoose from 'mongoose';

// The VISITS a Surveyed → door-outcome conversion took answers from — written by each chunk of the
// conversion before it changes anything (services/canvass/surveyConversion.js). It is the run's
// own durable record of what it struck, the conversion's counterpart of UnknockRunChunk.visitKeys.
//
// WHY IT EXISTS: Restore must hold every kept copy of a struck visit's answers — the conversion's
// own copy, a teammate's earlier overwrite, an answer edit's earlier version — to the strike while
// the conversion stands (services/surveys/restoreGuard.js). The conversion's other traces don't
// last: the canvasser re-recording the door deletes the converted entry (routes/mobile/canvass.js
// replaces her rows at the door), and the conversion's own copy can be erased on the profile. Read
// from those alone, the struck answers became restorable again the moment the canvasser came back
// to the door (code review 2026-10-19, round 2). Undoing the conversion lifts the strike wherever
// the undo put the visit's entry back (the run's `revertedAt`); where it couldn't, it says so in
// `notRestoredKeys` and the strike stands there.
//
// Pseudonymous bookkeeping: run, tenant, the visit keys (door | round | canvasser ids — a canvasser's
// user id, as every ledger row carries), the entry ids and two times. No answers, no names.
const conversionStrikeSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'SurveyConversionRun', required: true },
    // Denormalized so the delete cascades sweep by campaign without joining the run.
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // `${householdId}|${passId ?? 'null'}|${userId}` — the doorKey format, as UnknockRunChunk.
    visitKeys: { type: [String], default: [] },
    // The converted entries themselves: the undo reads, from what is on file, which visits' entries
    // came back (round 3: read from the stamps, a retry after they came off counted none).
    entryIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
    // When the chunk began (written before it archived or flipped anything) and when it finished.
    // A copy made up to `doneAt` holds the struck answers; one made after is later work.
    at: { type: Date, required: true },
    doneAt: { type: Date, default: null },
    // 'backfill' for a conversion made before this record existed (migrations/backfillRemovalStrikes.js).
    source: { type: String, enum: ['run', 'backfill'], default: 'run' },
    // Written by the conversion's undo: the visits whose entries it could NOT put back (the canvasser
    // re-recorded the door since). The strike stands there after the undo (restoreGuard.js).
    notRestoredKeys: { type: [String], default: undefined },
  },
  { timestamps: true }
);

// "Did a standing conversion strike this visit?" — Restore's probe. Distinct key shape from the
// tenant indexes (buildIndexes.js diffs by key shape).
conversionStrikeSchema.index({ campaignId: 1, visitKeys: 1 });
conversionStrikeSchema.index({ runId: 1 });

export const ConversionStrike = mongoose.model('ConversionStrike', conversionStrikeSchema);
