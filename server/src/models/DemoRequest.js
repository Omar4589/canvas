import mongoose from 'mongoose';

// One row per demo request from the public site (routes/public/demoRequest.js), saved BEFORE the
// notice email goes out, so a failed send can no longer lose the lead. These people are prospects —
// not users, not voters, not customers — and the published Privacy Policy names this category
// ("Demo requests": what we collect, why, and "up to 24 months"). Super-admins read and handle them on
// /super-admin/website, and delete one there when someone asks (docs/PRIVACY_VERIFICATION.md).
//
// Retention: `expiresAt` = submission + DEMO_REQUEST_RETENTION_DAYS (730 — the policy's 24 months),
// and the TTL index below removes the row then. Like every index it needs
// `migrate:build-indexes --apply` in prod (autoIndex is off): until that runs, nothing expires.
//
// bufferCommands is off on purpose: with no database connection a save fails at once instead of
// waiting ten seconds, so the request still emails the notice and answers quickly (the route treats
// a failed save as "not stored", never as a failed request).
export const DEMO_REQUEST_RETENTION_DAYS = 730;

const demoRequestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true },
    organization: { type: String, required: true },
    // The form's optional selects, stored as the label the person picked (routes/public/demoRequest.js
    // validates each against client/src/marketing/demoOptions.js).
    role: { type: String, default: null },
    teamSize: { type: String, default: null },
    heardAbout: { type: String, default: null },
    when: { type: String, default: null },
    // Optional, only when the form books a meeting (When?): Omar texts to set the time.
    phone: { type: String, default: null },
    message: { type: String, default: null },
    // Where it came from: the ?src= tag of the page (home-banner, aapc, …) and that page's path.
    source: { type: String, default: null },
    page: { type: String, default: null },
    // What happened to the notice email: sendMail's honest answer, never re-derived. null while the
    // send is in flight.
    emailOutcome: { type: String, enum: [null, 'sent', 'failed', 'dormant'], default: null },
    handledAt: { type: Date, default: null },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, bufferCommands: false }
);

demoRequestSchema.index({ createdAt: -1 });
demoRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const DemoRequest = mongoose.model('DemoRequest', demoRequestSchema);
