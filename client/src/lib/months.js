// 'YYYY-MM' arithmetic and labels, with NO wall-clock reads.
//
// Three private copies of this math existed (OrgBillingPanel's `monthsAgo`, MonthClosePage's own
// `monthsAgo`, and `currentMonthStr`), and the last of those read the BROWSER's month while every
// server gate reads UTC — so for a few hours around each month boundary an account manager in the
// US could be offered a month the server would refuse to issue. Nothing here knows what day it is;
// the current month always arrives from a server response.
//
// Mirrors server/src/services/billing/billingMonths.js for the shared pieces (addMonths, monthOf),
// deliberately: 'YYYY-MM' strings compare lexicographically, which is what makes month math safe
// without a date library.

import { formatDate } from './dates.js';
import { formatDateLabel } from './electionDates.js';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonthStr = (s) => MONTH_RE.test(String(s || ''));

// 'YYYY-MM' + n → 'YYYY-MM'. Handles year rollover in both directions. Null on bad input rather
// than a plausible-looking wrong month.
export const addMonths = (month, n) => {
  if (!isMonthStr(month)) return null;
  const y = Number(month.slice(0, 4));
  const mo = Number(month.slice(5, 7));
  const total = y * 12 + (mo - 1) + n;
  const y2 = Math.floor(total / 12);
  const mo2 = total - y2 * 12 + 1;
  return `${String(y2).padStart(4, '0')}-${String(mo2).padStart(2, '0')}`;
};

// Inclusive list from..to, oldest first. Empty when either end is malformed or the range inverts.
export const monthsBetween = (from, to) => {
  if (!isMonthStr(from) || !isMonthStr(to) || from > to) return [];
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// '2026-07' → 'July 2026'
export const monthLabel = (month) => {
  if (!isMonthStr(month)) return '—';
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
};

// '2026-07' → 'Jul 2026' — for table cells and chips, where the full name does not fit.
export const shortMonthLabel = (month) => {
  if (!isMonthStr(month)) return '—';
  return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3)} ${month.slice(0, 4)}`;
};

// The last calendar day of a month, as a Date at UTC midnight. `Date.UTC(y, mo, 0)` is day zero of
// the FOLLOWING month, i.e. the last day of this one — leap-safe, the same trick the server uses.
export const lastDayOf = (month) => {
  if (!isMonthStr(month)) return null;
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
};

// When a month stops accumulating and becomes issuable: 00:00 UTC on the 1st of the next month.
// UTC because that is the clock the server's MONTH_NOT_ENDED gate reads.
export const closesAt = (month) => {
  if (!isMonthStr(month)) return null;
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
};

// ---- days on the campaign's own calendar (billing rules v4) ---------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A campaign-calendar day ('YYYY-MM-DD' — a statement line's firstVisitDay, archivedDay or
// renewalDay) → 'Nov 15, 2026'. Printed from its parts, never through a Date in the viewer's zone,
// which reads a date-only string as UTC midnight and shows the day before anywhere in the US. Rows
// computed before the day fields existed (statements issued under rules v3 and earlier) pass the
// instant instead, formatted the way it always was.
export const campaignDayLabel = (day, instant) => {
  if (DAY_RE.test(String(day || ''))) return formatDateLabel(day, { year: 'numeric' });
  return instant ? formatDate(instant) : '—';
};

// 'YYYY-MM-DD' + n days → 'YYYY-MM-DD', on a plain calendar (mirrors billingMonths.addDays).
export const addDays = (day, n) => {
  if (!DAY_RE.test(String(day || ''))) return null;
  const t = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + n));
  return t.toISOString().slice(0, 10);
};

// The last day a renewal can still turn free: the renewal day and the two after it (the server's
// END_GRACE_DAYS, billingMonths.renewalGraceEnd).
export const renewalGraceEnd = (renewalDay) => addDays(renewalDay, 2);

// 1 → '1st', 2 → '2nd', 3 → '3rd', 11 → '11th', 22 → '22nd'.
export const ordinal = (n) => {
  const v = Number(n);
  if (!Number.isInteger(v) || v < 1) return '';
  const tens = v % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
  return `${v}${suffix}`;
};

// A monthly-renewal campaign's renewal, from its first-visit day: 'renews on the 15th'. A 29th–31st
// start renews on the last day of shorter months (billingMonths.renewalDayIn), which the label says
// rather than leave February looking wrong.
export const renewsOnLabel = (firstVisitDay) => {
  if (!DAY_RE.test(String(firstVisitDay || ''))) return '';
  const day = Number(firstVisitDay.slice(8, 10));
  return day >= 29 ? `renews on the ${ordinal(day)} (or the month’s last day)` : `renews on the ${ordinal(day)}`;
};

// A statement line's rule. Lines frozen before rules v4 have no `billingRule` key at all; one with a
// first visit was billed by calendar month, one without never went out.
export const lineBillingRule = (l) => l?.billingRule ?? (l?.firstKnockAt ? 'calendar' : null);
