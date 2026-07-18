import mongoose from 'mongoose';

// A record that the retention purge actually ran — and what it did.
//
// Why this exists. We tell every user, in the app and in the privacy policy, that when they delete
// their account we keep their name for 180 days for fraud attribution and then remove it for good.
// The purge that keeps that promise used to be a dry-run-by-default CLI that NOTHING in the codebase
// ever called. Its only trigger was a Heroku Scheduler entry someone had typed into a web dashboard.
// No test covered it. No code referenced it. If that add-on were removed, renamed, or lost in a
// migration to another host, the purge would simply stop — and NOTHING would fail. No error, no alert,
// no red build. We would go on holding people's names indefinitely while publicly promising we did
// not, and we would not find out until somebody asked.
//
// That is the actual defect. Not "the job wasn't running" — it was — but "the promise was enforced by
// something invisible to the code, so it could stop being kept without anyone noticing."
//
// So: the purge is now a repeatable job on the worker dyno (services/retention/), and every run writes
// one of these. `GET /super-admin/health/retention` reads the newest and goes RED when the last
// success is older than STALE_AFTER_HOURS. Silence is now a failure state instead of the default.
const retentionRunSchema = new mongoose.Schema(
  {
    job: { type: String, required: true, index: true }, // 'purge-deleted-identities' | ...
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, default: false },
    // What it actually did, so a run that "succeeded" while doing nothing is still legible.
    purged: { type: Number, default: 0 },
    scanned: { type: Number, default: 0 },
    // Deletion warnings delivered this run (wind-down + dormancy) — the "we warned before we
    // deleted" half of the promise, countable next to the deletions themselves.
    warned: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

retentionRunSchema.index({ job: 1, startedAt: -1 });

export const RetentionRun = mongoose.model('RetentionRun', retentionRunSchema);
