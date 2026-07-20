// WHICH MONTHS DOES A CAMPAIGN BILL? — the whole rule, as pure string math.
//
// Pulled out of statement.js (which owns the queries) so the rule itself can be unit-tested at
// every calendar boundary without a database: 28/29/30/31-day months, leap years, December
// rollover, and the grace edges below. statement.js supplies the facts; this module decides.
//
// Everything here works on 'YYYY-MM-DD' / 'YYYY-MM' strings already resolved in the CAMPAIGN'S OWN
// timezone (utils/timezone.js `zonedDayStr`). That is not a shortcut — it is exactly equivalent to
// the Date comparisons this replaced (`firstKnockAt < window.$lt`, `archivedAt < window.$gte`),
// because that window came from `zonedDayRange` over the same month. Strings compare
// lexicographically for both formats, which is why 'YYYY-MM' < 'YYYY-MM' is a legal month test.
//
// THE RULES (owner decision, Jul 2026 — RULES_VERSION 3 in statement.js):
//
//   Start grace  A first field visit in the LAST 7 DAYS of a month makes that month free; billing
//                starts the 1st of the next month. Someone who knocks their first door on Jan 28
//                should not owe all of January.
//
//   End grace    A campaign archived in the FIRST 3 DAYS of a month, WITH ZERO FIELD VISITS THAT
//                MONTH, does not owe that month. The zero-visit condition is what keeps this
//                honest: knocking Nov 1-2 and archiving Nov 3 is real work and still bills.
//
//   Floor        A campaign that has knocked at least once ALWAYS bills at least one month. Both
//                graces can fire on the same short campaign (first visit Oct 29, archived Nov 2,
//                nobody out in November) and would otherwise net to free. The first-visit month
//                bills instead. There is no such thing as a free campaign that went to the field.
//
// Deliberately NOT prorated, either edge. Billing stays `billable ? rate : 0` — a boolean times a
// flat rate — so a statement line is explainable in one sentence and a frozen statement stays
// simple. Proration was considered and rejected: a two-week GOTV blitz is the common shape of this
// business, and day-counting would bill the most intense fortnight we ever serve at half price.
//
// The two-phase API (`needsStartMonthVisitCount` then `decideMonth`) exists because the floor can
// need a fact about a DIFFERENT month than the one being evaluated — see that function.

export const START_GRACE_DAYS = 7;
export const END_GRACE_DAYS = 3;

// Every value `decideMonth` can return in `reason`. Surfaced per statement line so the UI can say
// WHY a campaign is or isn't on the invoice, and frozen into issued statements so a two-year-old
// statement can still explain itself after the rules have moved on.
export const REASONS = [
  'no-field-visit', // never been to the field — a setup-only campaign, free forever
  'start-grace', // first visit landed in the last 7 days of this month
  'before-start', // this month precedes the billing start month
  'archived-earlier', // archived before this month began
  'end-grace', // archived in the first 3 days with nobody out this month
  'floor', // both graces fired; this is the one month that bills anyway
  'billable', // ordinary billable month
];

// 'YYYY-MM-DD' → 'YYYY-MM'
export function monthOf(dayStr) {
  return String(dayStr).slice(0, 7);
}

// 'YYYY-MM-DD' → 28..31
export function dayOfMonth(dayStr) {
  return Number(String(dayStr).slice(8, 10));
}

// 'YYYY-MM' → how many days it has. `Date.UTC(y, mo, 0)` is day zero of the FOLLOWING month, i.e.
// the last day of this one — the same leap-safe trick monthDayBounds uses in statement.js.
export function daysInMonth(month) {
  const y = Number(String(month).slice(0, 4));
  const mo = Number(String(month).slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

// 'YYYY-MM' + n → 'YYYY-MM'. Handles year rollover in both directions.
export function addMonths(month, n) {
  const y = Number(String(month).slice(0, 4));
  const mo = Number(String(month).slice(5, 7));
  const total = y * 12 + (mo - 1) + n;
  const y2 = Math.floor(total / 12);
  const mo2 = total - y2 * 12 + 1;
  return `${String(y2).padStart(4, '0')}-${String(mo2).padStart(2, '0')}`;
}

// Did the first field visit land in the last START_GRACE_DAYS days of its month? The comparison is
// strictly `>`, so on a 31-day month days 25..31 qualify (7 days) and day 24 does not.
export function startGraceApplies(firstVisitDay) {
  if (!firstVisitDay) return false;
  const month = monthOf(firstVisitDay);
  return dayOfMonth(firstVisitDay) > daysInMonth(month) - START_GRACE_DAYS;
}

// The first month this campaign can bill: the first-visit month, or the one after it when the
// start grace applies. Null when the campaign has never been to the field.
export function billingStartMonth(firstVisitDay) {
  if (!firstVisitDay) return null;
  const month = monthOf(firstVisitDay);
  return startGraceApplies(firstVisitDay) ? addMonths(month, 1) : month;
}

// Would this campaign, across ALL time, bill zero months under the two graces? That is the
// condition the floor exists to correct. Split out because it is the one piece of the decision
// that reaches outside the month being evaluated.
function wouldBillNothing({ firstVisitDay, archivedDay, visitsInStartMonth }) {
  // Never archived → it bills from its start month onward, forever. Never empty.
  if (!archivedDay) return false;
  const F = monthOf(firstVisitDay);
  const S = billingStartMonth(firstVisitDay);
  const A = monthOf(archivedDay);
  if (A < S) return true; // archived before billing would even have begun
  if (A > S) return false; // at least the start month bills
  // A === S: the only way out is the end grace firing on the start month itself.
  // When S === F that is impossible by construction — the first visit is IN F, so F can never
  // have zero visits. This is why the extra fact below is only ever needed after a start grace.
  if (S === F) return false;
  if (dayOfMonth(archivedDay) > END_GRACE_DAYS) return false;
  if (visitsInStartMonth === undefined || visitsInStartMonth === null) {
    throw new Error('billingMonths: visitsInStartMonth is required here — call needsStartMonthVisitCount first');
  }
  return visitsInStartMonth === 0;
}

// Does deciding `month` require knowing the visit count of a DIFFERENT month? Returns that month
// ('YYYY-MM') or null.
//
// This is the awkward corner of the rules and the reason for the two-phase API. The floor is only
// ever applied to the first-visit month F, but establishing whether the floor is needed can depend
// on whether anyone went out in F+1 (the start-grace-shifted start month). statement.js cannot know
// to fetch that without being told, and this module must not touch the database — so it asks.
//
// Narrow by design: this returns non-null only for a campaign that got a start grace AND was
// archived within the first 3 days of the very next month. Everything else is decided from dates
// alone, so the extra query almost never runs.
export function needsStartMonthVisitCount({ month, firstVisitDay, archivedDay }) {
  if (!firstVisitDay || !archivedDay) return null;
  const F = monthOf(firstVisitDay);
  if (month !== F) return null; // the floor only ever applies to F
  const S = billingStartMonth(firstVisitDay);
  if (S === F) return null; // no start grace → the S === F short-circuit above decides it
  if (monthOf(archivedDay) !== S) return null;
  if (dayOfMonth(archivedDay) > END_GRACE_DAYS) return null;
  return S;
}

// The decision. `facts`:
//   month             'YYYY-MM' being evaluated
//   firstVisitDay     'YYYY-MM-DD' of the first field visit, or null (campaign tz)
//   archivedDay       'YYYY-MM-DD' the campaign was archived, or null (campaign tz)
//   visitsThisMonth   distinct field-visited doors in `month` — knocks AND non-bulk restricted
//                     marks. Must be flag-independent: a month whose only activity was restricted
//                     marks is a month someone walked, and must not win the end grace.
//   visitsInStartMonth  only when needsStartMonthVisitCount() asked for it
//
// Returns { billable, reason, startMonth, floorMonth }.
export function decideMonth(facts) {
  const { month, firstVisitDay, archivedDay, visitsThisMonth } = facts;
  if (!firstVisitDay) {
    return { billable: false, reason: 'no-field-visit', startMonth: null, floorMonth: null };
  }
  if (typeof visitsThisMonth !== 'number') {
    throw new Error('billingMonths: visitsThisMonth must be a number');
  }
  const F = monthOf(firstVisitDay);
  const S = billingStartMonth(firstVisitDay);
  const A = archivedDay ? monthOf(archivedDay) : null;
  const out = { startMonth: S, floorMonth: F };

  // The floor is checked FIRST and deliberately outranks the graces: it exists precisely to
  // overturn a decision the graces would otherwise have made.
  if (month === F && wouldBillNothing(facts)) {
    return { ...out, billable: true, reason: 'floor' };
  }
  if (month < S) {
    return { ...out, billable: false, reason: month === F ? 'start-grace' : 'before-start' };
  }
  if (A && month > A) {
    return { ...out, billable: false, reason: 'archived-earlier' };
  }
  if (A && month === A && dayOfMonth(archivedDay) <= END_GRACE_DAYS && visitsThisMonth === 0) {
    return { ...out, billable: false, reason: 'end-grace' };
  }
  return { ...out, billable: true, reason: 'billable' };
}
