// The ONE definition of when a canceled subscription's data is deleted: cancellation instant
// (statusChangedAt) + the wind-down window.
//
// The banner the customer READS ("export before March 14") and the JOB that DELETES their data both
// call this function, so the date a customer is shown is provably the date the deletion fires. A banner
// that says one date while the job deletes on another is exactly the words-vs-code drift this whole
// effort exists to kill — and it is unforgivable when the banner is the ONLY warning a customer ever
// gets (there is no email/SMS anywhere in the system). The tie is enforced by test, not by hope: see
// test/retentionTriggers.int.test.js ("banner date == wind-down deletion boundary").
export const WIND_DOWN_DAYS = Number(process.env.RETENTION_WIND_DOWN_DAYS || 60);
const DAY = 86_400_000;

/**
 * When this subscription's data will be deleted, or null if there is no wind-down anchor (no
 * cancellation timestamp). Callers decide whether it applies (only `canceled` subscriptions wind down).
 */
export function windDownDeletionDate(statusChangedAt) {
  if (!statusChangedAt) return null;
  const t = new Date(statusChangedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + WIND_DOWN_DAYS * DAY);
}

/**
 * Whole days from `now` until deletion, floored at 0. Derived from the SAME date as above, so the
 * countdown can never disagree with the displayed date.
 */
export function windDownDaysLeft(statusChangedAt, now = Date.now()) {
  const d = windDownDeletionDate(statusChangedAt);
  if (!d) return null;
  return Math.max(0, Math.ceil((d.getTime() - now) / DAY));
}
