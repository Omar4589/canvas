import mongoose from 'mongoose';

// First-party visit counts for the public marketing pages: one row per (day, page, source) holding a
// running count, bumped by services/site/siteVisits.js as the page is served. It stores NO personal
// information — no IP address, no cookie, no user agent, no full referring URL: just the day, the
// path, a short source label (a ?src= tag, the referring site's host, or "direct") and a number. Read
// on /super-admin/website, so the Nov 17 AAPC spike (the printed ad's QR code carries no tag) shows up.
//
// The unique index keeps one row per key; without it (prod autoIndex is off until
// `migrate:build-indexes --apply`) two first visits racing can split a day into two rows, which the
// reader sums anyway — so it is tidy-up, not correctness.
const siteVisitDaySchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD in OWNER_TIME_ZONE
    path: { type: String, required: true },
    source: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { bufferCommands: false }
);

siteVisitDaySchema.index({ day: 1, path: 1, source: 1 }, { unique: true });

export const SiteVisitDay = mongoose.model('SiteVisitDay', siteVisitDaySchema);
