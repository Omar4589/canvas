import mongoose from 'mongoose';

// One UNKNOCK run — the Door Outcomes page's fourth act, and the only one that REMOVES rows.
//
// The other three rewrite what an entry says (ReclassifyRun) or move answers in and out of it
// (SurveyConversionRun). This one deletes the entry, because some entries describe visits that
// never happened: a canvasser's fabricated knocks are not a mislabelled door, they are a door
// nobody went to. Relabelling them to Not home — the tool that existed before this one — leaves
// the knock counted and BILLED, and only returns the door to play in the NEXT round. An unknock
// takes the knock out of every total and returns the door to `unknocked` in the round it is
// already in, so the crew can go knock it for real and that knock bills as the first one, which
// it is.
//
// WHY A SIBLING MODEL AND NOT A FLAG ON ReclassifyRun: that model deliberately stores no manifest
// of the rows it touched — its revert is stamp-driven (`CanvassActivity.reclassified.runId`), and
// a stamp is the cheapest possible manifest. A deleted row can carry no stamp. So the rows
// themselves are frozen here, verbatim, before anything is destroyed — the TurfSnapshot rule
// (models/TurfSnapshot.js), which learned the same lesson for whole-round discards.
//
// The answers of a surveyed entry are NOT stored here: they go to SurveyResponseArchive tagged
// with this run's id, the same place and the same reason as a Surveyed→outcome conversion. In an
// investigation the answers being removed are the evidence, and the archive is where evidence
// lives and where a per-voter restore can reach it.
const unknockRunSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // 'pending' until the destruction finishes. Written BEFORE anything is deleted, so a crash
    // mid-run leaves a row that states exactly what was intended and holds the frozen originals —
    // never a deletion nobody can describe or undo. Completing a pending run is idempotent.
    status: { type: String, enum: ['pending', 'completed', 'reverted'], default: 'pending', index: true },

    // The frozen originals live in UnknockRunChunk, NOT here — 25k rows with 2,000-char notes is
    // megabytes of BSON on one document, the exact trade SurveyConversionRun's header refuses.
    // This is only the count, so a list read never touches them.
    frozenRows: { type: Number, default: 0 },

    // What produced the selection: the validated wire scope, plus the frozen human line
    // (services/canvass/scopeSummary.js) so the run list can say "Cara Canvasser · answered
    // Opposed · Aug 1 – Aug 7" and not just a count. `byIds` records a hand-ticked selection.
    selection: {
      scope: { type: mongoose.Schema.Types.Mixed, default: {} },
      byIds: { type: Boolean, default: false },
    },
    scopeSummary: { type: String, default: null },

    counts: {
      entriesRemoved: { type: Number, default: 0 },
      doorsAffected: { type: Number, default: 0 },
      responsesArchived: { type: Number, default: 0 },
      votersAffected: { type: Number, default: 0 },
      // Revert could not put a row back: the (userId, householdId, passId) visit was re-knocked
      // for real in the meantime. The newer row is the truth and is never clobbered; the frozen
      // original stays on this document and is reported.
      rowsNotRestored: { type: Number, default: 0 },
      // Same idea on the answer side: a later field submission refilled the {voterId, passId}
      // slot, so the archived answer stays archived.
      responsesNotRestored: { type: Number, default: 0 },
      // Of those, the ones its undo handed to a later unknock that struck the same visits since (that
      // run's Undo writes them back) — kept here so a retry of the undo still counts them (round 7).
      responsesHanded: { type: Number, default: 0 },
    },

    // When the strike finished (null on a run from before 2026-10-19 — Restore then reads the
    // chunks' frozenAt).
    completedAt: { type: Date, default: null },
    revertedAt: { type: Date, default: null },
    // Set while a revert runs (it runs inline, and this model has no running state), cleared when
    // it ends. An answer edit reads it to stay out of the way (one change at a time per campaign,
    // services/canvass/answerEditRuns.js); a revert that died with its request stops counting
    // after ten minutes.
    revertingAt: { type: Date, default: null },
    // Stamped just before the run removes anything (its answers first, then its entries): a run that
    // stopped after that point removed some or all of them though it still reads `pending` — Restore
    // treats its strike as standing, and its undo is allowed once the strike has stopped
    // (restoreGuard.js; routes/admin/campaigns.js).
    deletingAt: { type: Date, default: null },
    // The strike's heartbeat, beaten between every step it takes: a pending run that beat within ten
    // minutes is still removing (no Undo yet), one silent longer stopped part-way (unknockLease.js,
    // code review round 4). Each beat is a compare-and-swap on no undo having begun, so an undo of a
    // stopped strike that comes back to life stops it before its next removal.
    heartbeatAt: { type: Date, default: null },
    // When an undo of this run first began — set by the undo's claim and never cleared (a failed undo
    // clears `revertingAt`, so a strike that woke after its lease then completed over the partial
    // undo; code review round 5). The strike's beats and its completion require it absent.
    undoBegunAt: { type: Date, default: null },
    // When a strike that FAILED in process (a database error, not a dyno restart) stopped: it reads
    // stopped at once, and Restore's hold on its visits ends here — `heartbeatAt` stays its last real
    // beat (code review round 6: round 5 set the heartbeat to the epoch instead, and the hold ended in
    // 1970, so struck answers came free and a Restore put them over a real later survey).
    stoppedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// The run list on the Door Outcomes page — newest first.
unknockRunSchema.index({ campaignId: 1, createdAt: -1 });

export const UnknockRun = mongoose.model('UnknockRun', unknockRunSchema);
