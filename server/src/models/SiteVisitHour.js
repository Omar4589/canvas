import mongoose from 'mongoose';

// When, and on what kind of device, people arrive on the public marketing pages: one row per (day, hour,
// device) holding a running count, bumped by services/site/siteVisits.js beside SiteVisitDay as the page is
// served. Like SiteVisitDay it stores NO personal information — no IP address, no cookie, no user agent (the
// device class is read from it at that moment and the string is dropped): just the day, the hour, phone /
// tablet / computer and a number. Arrivals only — never a move between our own pages, never the canvasser
// app page — and on purpose neither the page nor the source: kept apart from SiteVisitDay, no row ties one
// visit's hour and device to the site it came from. Read on /super-admin/website (by the hour, on phones).
//
// The unique index is built at boot (server.js → syncSiteVisitIndexes), so there is no build-indexes step.
// Two first visits racing before it exists could split a key across two rows; the reader sums them anyway.
const siteVisitHourSchema = new mongoose.Schema(
  {
    day: { type: String, required: true }, // YYYY-MM-DD in OWNER_TIME_ZONE
    hour: { type: Number, required: true }, // 0–23 in OWNER_TIME_ZONE
    device: { type: String, required: true }, // phone | tablet | computer
    count: { type: Number, default: 0 },
  },
  { bufferCommands: false }
);

siteVisitHourSchema.index({ day: 1, hour: 1, device: 1 }, { unique: true });

export const SiteVisitHour = mongoose.model('SiteVisitHour', siteVisitHourSchema);
