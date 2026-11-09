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
//
// MONTHLY RENEWALS (owner decision, 2026-11-03 — RULES_VERSION 4, docs/PROPOSAL_BILLING_CYCLES.md).
// A campaign whose FIRST field visit is on or after CYCLE_BILLING_FROM (in its own timezone) does not
// bill by calendar month. Its rule is 'cycle'; every earlier campaign stays 'calendar' (the v3 rules
// above) for good:
//
//   Renewals     Billing starts on the day of the first field visit and renews on that same date every
//                month, on the last day of a shorter month for a 29th-31st start (Jan 31 → Feb 28 →
//                Mar 31). Each renewal goes on the bill for the calendar month it falls in, so there is
//                still exactly one decision per (campaign, month) and one bill per client per month.
//   Archiving    Archive before a renewal date and that renewal never happens.
//   3-day rule   Archive on a renewal day or the two days after it, with nobody out since that
//                renewal, and that renewal is free ('renewal-grace').
//   First month  Always bills. It starts with a field visit, so it needs no floor.
//
// There is no start grace: when billing renews from the first knock, nobody pays for a partial month.

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
  'archived-before-renewal', // monthly-renewal campaign archived before this month's renewal date
  'renewal-grace', // monthly-renewal campaign archived within 3 days of this month's renewal, nobody out since
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

// ---- monthly renewals (v4) ------------------------------------------------------------------

// The switch day (owner decision, 2026-11-03): a civil date, compared with each campaign's first
// field visit in the campaign's own timezone. A code constant rather than a setting because it is a
// frozen business fact, with RULES_VERSION as its audit trail. Change it only before it has passed,
// and move every Help Center sentence that names it (content/help/guides/billing.md and
// content/help/pages/page-billing.md) in the same change.
export const CYCLE_BILLING_FROM = '2026-11-05';

let cycleFromOverride = null;

// Every server caller reads the switch day through here, so an integration suite can move it with
// setCycleBillingFromForTests (a campaign on the new rules with a first visit in the past, whatever
// today's date is). Unit tests don't need it: every function below takes `cycleFrom` directly.
export const cycleBillingFrom = () => cycleFromOverride || CYCLE_BILLING_FROM;

// Refuses in production, so the seam can never move a real customer's rule. Pass null to reset.
export const setCycleBillingFromForTests = (day) => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('setCycleBillingFromForTests is for tests only');
  }
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) {
    throw new Error('setCycleBillingFromForTests: day must be YYYY-MM-DD or null');
  }
  cycleFromOverride = day;
};

// 'cycle' (renews monthly from the first visit), 'calendar' (v3), or null (never been to the field).
// `cycleFrom` defaults to the live switch day; tests pass one to pin a regime.
export const billingRuleFor = (firstVisitDay, cycleFrom) => {
  if (!firstVisitDay) return null;
  return firstVisitDay >= (cycleFrom || cycleBillingFrom()) ? 'cycle' : 'calendar';
};

// 'YYYY-MM' + the first-visit day → that month's renewal date, clamped to the month's last day
// (a 31st start renews Feb 28/29, Apr 30, then the 31st again).
export const renewalDayIn = (month, firstVisitDay) => {
  const day = Math.min(dayOfMonth(firstVisitDay), daysInMonth(month));
  return `${month}-${String(day).padStart(2, '0')}`;
};

// 'YYYY-MM-DD' + n days → 'YYYY-MM-DD'. Date.UTC arithmetic, like daysInMonth: a civil date has no
// timezone, so UTC is just a calendar here.
export const addDays = (dayStr, n) => {
  const s = String(dayStr);
  const t = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)) + n));
  return [
    String(t.getUTCFullYear()).padStart(4, '0'),
    String(t.getUTCMonth() + 1).padStart(2, '0'),
    String(t.getUTCDate()).padStart(2, '0'),
  ].join('-');
};

// The last day of a renewal's 3-day window: the renewal day and the two after it, the same three
// days "the 1st to the 3rd" are for the calendar rules' end grace.
export const renewalGraceEnd = (renewalDay) => addDays(renewalDay, END_GRACE_DAYS - 1);

// Around `day` (campaign-tz days): `last` is the latest renewal on or before it OTHER THAN the first
// visit, null until the second renewal (the first renewal IS the first visit, and always bills, so
// it can never be offered as free); `next` is the earliest renewal after it. Both null when `day`
// is before the first visit.
export const renewalsAround = (firstVisitDay, day) => {
  if (!firstVisitDay || !day || day < firstVisitDay) return { last: null, next: null };
  const month = monthOf(day);
  const here = renewalDayIn(month, firstVisitDay);
  const latest = here <= day ? here : renewalDayIn(addMonths(month, -1), firstVisitDay);
  const next = here > day ? here : renewalDayIn(addMonths(month, 1), firstVisitDay);
  return { last: latest === firstVisitDay ? null : latest, next };
};

// What the election-day reminder may say about a campaign on `today` (campaign-tz days):
// `nextRenewalDay`, plus `lastRenewalDay` and `graceUntilDay` only while today is inside that
// renewal's 3-day window. Everything null when the first visit is after today (a phone's clock can
// stamp the future).
export const reminderDates = (firstVisitDay, today) => {
  const { last, next } = renewalsAround(firstVisitDay, today);
  if (!next) return { nextRenewalDay: null, lastRenewalDay: null, graceUntilDay: null };
  const graceUntil = last ? renewalGraceEnd(last) : null;
  const inWindow = Boolean(graceUntil && today <= graceUntil);
  return {
    nextRenewalDay: next,
    lastRenewalDay: inWindow ? last : null,
    graceUntilDay: inWindow ? graceUntil : null,
  };
};

// The first month a campaign can bill, by its rule: the first-visit month for 'cycle', the v3 start
// month (after any start grace) for 'calendar'. Null until the campaign has been to the field.
export const startMonthFor = (firstVisitDay, cycleFrom) =>
  billingRuleFor(firstVisitDay, cycleFrom) === 'cycle' ? monthOf(firstVisitDay) : billingStartMonth(firstVisitDay);

// The cycle counterpart of needsStartMonthVisitCount: does deciding `month` need to know whether
// anyone went out since that month's renewal? Returns { from, to } (campaign-tz days, both included)
// or null. Only when an archive landed inside the renewal's 3-day window, which a campaign can do
// at most once (renewals are at least 28 days apart), so the probe almost never runs. Never for
// the first-visit month: the first renewal always bills.
export const needsRenewalVisitCount = ({ month, firstVisitDay, archivedDay, cycleFrom }) => {
  if (!firstVisitDay || !archivedDay) return null;
  if (billingRuleFor(firstVisitDay, cycleFrom) !== 'cycle') return null;
  if (month <= monthOf(firstVisitDay)) return null;
  const renewal = renewalDayIn(month, firstVisitDay);
  if (archivedDay < renewal || archivedDay > renewalGraceEnd(renewal)) return null;
  return { from: renewal, to: archivedDay };
};

// decideMonth for a 'cycle' campaign. `visitsSinceRenewal` is any field visit from the start of the
// renewal day through the end of the archive day, flag-independent like visitsThisMonth; it is
// required only when needsRenewalVisitCount asked for it.
const decideCycleMonth = ({ month, firstVisitDay, archivedDay, visitsSinceRenewal }) => {
  const F = monthOf(firstVisitDay);
  const out = { startMonth: F, floorMonth: null, billingRule: 'cycle' };
  if (month < F) return { ...out, billable: false, reason: 'before-start', renewalDay: null };
  // The first renewal is the first visit, so it always bills — even in the anomaly where the archive
  // precedes it (an offline visit uploaded after the campaign was archived).
  if (month === F) return { ...out, billable: true, reason: 'billable', renewalDay: firstVisitDay };
  const renewal = renewalDayIn(month, firstVisitDay);
  if (archivedDay && archivedDay < renewal) {
    return monthOf(archivedDay) === month
      ? { ...out, billable: false, reason: 'archived-before-renewal', renewalDay: renewal }
      : { ...out, billable: false, reason: 'archived-earlier', renewalDay: null };
  }
  if (archivedDay && archivedDay <= renewalGraceEnd(renewal)) {
    if (typeof visitsSinceRenewal !== 'number') {
      throw new Error('billingMonths: visitsSinceRenewal is required here — call needsRenewalVisitCount first');
    }
    if (visitsSinceRenewal === 0) {
      return { ...out, billable: false, reason: 'renewal-grace', renewalDay: renewal };
    }
  }
  return { ...out, billable: true, reason: 'billable', renewalDay: renewal };
};

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
export function needsStartMonthVisitCount({ month, firstVisitDay, archivedDay, cycleFrom }) {
  if (!firstVisitDay || !archivedDay) return null;
  if (billingRuleFor(firstVisitDay, cycleFrom) === 'cycle') return null; // no start grace, no floor
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
//   visitsSinceRenewal  only when needsRenewalVisitCount() asked for it
//   cycleFrom         the switch day; defaults to cycleBillingFrom()
//
// Returns { billable, reason, startMonth, floorMonth, billingRule, renewalDay }. `billingRule` is
// 'calendar' | 'cycle' (null with no field visit); `renewalDay` is the renewal date this month's
// decision is about, for a 'cycle' campaign only.
export function decideMonth(facts) {
  const { month, firstVisitDay, archivedDay, visitsThisMonth } = facts;
  if (!firstVisitDay) {
    return {
      billable: false,
      reason: 'no-field-visit',
      startMonth: null,
      floorMonth: null,
      billingRule: null,
      renewalDay: null,
    };
  }
  if (billingRuleFor(firstVisitDay, facts.cycleFrom) === 'cycle') return decideCycleMonth(facts);
  if (typeof visitsThisMonth !== 'number') {
    throw new Error('billingMonths: visitsThisMonth must be a number');
  }
  const F = monthOf(firstVisitDay);
  const S = billingStartMonth(firstVisitDay);
  const A = archivedDay ? monthOf(archivedDay) : null;
  const out = { startMonth: S, floorMonth: F, billingRule: 'calendar', renewalDay: null };

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
