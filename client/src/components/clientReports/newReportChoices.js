import {
  CATCH_UP_MAX_DAYS,
  addDays,
  catchUpPeriod,
  dayOfWeek,
  formatCivil,
  formatPeriod,
  lastWeek,
  nextPeriod,
  periodDays,
  suggestPeriod,
  thisWeek,
  wholeMonthsOf,
} from './reportDates.js';

// New report's date choices (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §C "The choices"): a vertical
// radio list with dates, the first choice selected —
//
//   (•) Oct 14 – Oct 25 · 12 days — from the day after your last report to the end of last week, so
//       your next report covers a full Monday – Sunday week
//   ( ) Last week · Oct 19 – Oct 25
//   ( ) This week, not over yet · Oct 26 – Nov 1 — refresh it once the week ends
//   ( ) Pick dates
//
// The first choice is suggestPeriod's (reportDates.js, contract K1 — the week math the server's Next
// report runs too), labelled by its kind and branch; then Last week unless it is already first, and
// This week unless it equals the first. A long-gap choice says no "after your last report" and names
// the days no report covers. The week-mismatch nudge and its Move this tab catch-up are worked out here
// too, and the duplicate prompt's words (§E). Pure, so every label is tested without React
// (clientReportsLogic.test.js).

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The week that starts on weekday `s` (0 Sunday … 6 Saturday): "Monday – Sunday". */
export const weekName = (s) => `${WEEKDAYS[s]} – ${WEEKDAYS[(s + 6) % 7]}`;

const yearOf = (ymd) => String(ymd || '').slice(0, 4);

/** A period as the dialog writes it: "Oct 19 – Oct 25", with its year when it isn't this year's. */
export const periodLabel = (start, end, today) =>
  yearOf(start) === yearOf(end) && yearOf(start) !== yearOf(today) ? `${formatPeriod(start, end)}, ${yearOf(start)}` : formatPeriod(start, end);

/** One day: "Oct 7" — "Oct 7, 2025" in another year. */
export const dayLabel = (ymd, today) => formatCivil(ymd, { year: yearOf(ymd) !== yearOf(today) });

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Whole calendar months: "November", "October – December" — with the year when it isn't this year's. */
export const monthsLabel = (start, end, today) => {
  const [sy, sm] = String(start).split('-').map(Number);
  const [ey, em] = String(end).split('-').map(Number);
  const year = (y) => (String(y) !== yearOf(today) ? ` ${y}` : '');
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]}${year(sy)}`;
  if (sy === ey) return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]}${year(sy)}`;
  return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
};

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const inWords = (n) => WORDS[n] || String(n);
const dayCount = (start, end) => {
  const n = periodDays(start, end);
  return `${n} ${n === 1 ? 'day' : 'days'}`;
};
const same = (a, b) => !!a && !!b && a.weekStart === b.weekStart && a.weekEnd === b.weekEnd;

const THIS_WEEK_TAIL = '— refresh it once the week ends';

/**
 * A suggested period's label (suggestPeriod's shape) as { head, tail }: the head names the dates, the
 * tail says why — none on a long-gap choice, which isn't "after your last report".
 */
export const choiceLabel = (p, { s, today }) => {
  const period = periodLabel(p.weekStart, p.weekEnd, today);
  const days = periodDays(p.weekStart, p.weekEnd);
  const weeks = p.weeks || (days % 7 === 0 ? days / 7 : 0);
  const months = p.months || wholeMonthsOf(p.weekStart, p.weekEnd);
  if (p.longGap) {
    if (p.equalsLastWeek) return { head: `Last week · ${period}`, tail: '' };
    if (p.kind === 'months') return { head: monthsLabel(p.weekStart, p.weekEnd, today), tail: '' };
    if (weeks > 1) return { head: `${period} · ${weeks} weeks`, tail: '' };
    return { head: period, tail: '' };
  }
  if (p.kind === 'this_week') return { head: `This week, not over yet · ${period}`, tail: THIS_WEEK_TAIL };
  if (p.kind === 'last_week') return { head: `Last week · ${period}`, tail: '' };
  if (p.kind === 'months') {
    return {
      head: monthsLabel(p.weekStart, p.weekEnd, today),
      tail: months > 1 ? `— the ${inWords(months)} months after your last report` : '— the month after your last report',
    };
  }
  if (p.kind === 'catch_up') {
    return {
      head: `${period} · ${dayCount(p.weekStart, p.weekEnd)}`,
      tail: `— from the day after your last report to the end of ${p.branch === 'this_week' ? 'this' : 'last'} week, so your next report covers a full ${weekName(s)} week`,
    };
  }
  if (weeks > 1) return { head: `${period} · ${weeks} weeks`, tail: `— the ${inWords(weeks)} weeks after your last report` };
  return { head: p.equalsLastWeek ? `Last week · ${period}` : period, tail: '— the week after your last report' };
};

/** A choice's whole label, as one line: "Last week · Oct 19 – Oct 25 — the week after your last report". */
export const choiceText = (c) => (c.tail ? `${c.head} ${c.tail}` : c.head);

const choiceOf = (key, p, opts) => ({ key, kind: p.kind, weekStart: p.weekStart, weekEnd: p.weekEnd, ...choiceLabel(p, opts), skipped: p.longGap ? p.skipped || null : null });

/**
 * The dated choices, in order: the suggestion first (key 'first'), then 'last' and 'this' unless they
 * repeat it. `last` is the tab's last report ({ weekStart, weekEnd }, newest end) or null; `s` the
 * organization's report week start; `today` the campaign zone's civil day; `knockedBeforeThisWeek` from
 * the series picker (a new campaign's first report starts at This week). "Pick dates" is the dialog's.
 */
export const dateChoices = ({ last = null, s, today, knockedBeforeThisWeek = true }) => {
  const opts = { s, today };
  const first = suggestPeriod({ last, s, today, knockedBeforeThisWeek });
  const lw = { ...lastWeek(today, s), kind: 'last_week' };
  const tw = { ...thisWeek(today, s), kind: 'this_week' };
  const choices = [choiceOf('first', first, opts)];
  if (!same(first, lw)) choices.push(choiceOf('last', lw, opts));
  if (!same(first, tw)) choices.push(choiceOf('this', tw, opts));
  return { suggestion: first, choices };
};

/**
 * The line at the top of New report's dates (§M): every total runs from the campaign's first door through
 * the last day picked, for what the report covers — the whole campaign, the tab's name (`label`: "Paid
 * team", "North"), or neither while its team or walk list isn't picked yet — and the first day only
 * decides what shows as new, in the words the client's cards use (`phrase`: "this week", "in these 14
 * days", reportDerive.js periodPhrase).
 */
export const totalsSentence = ({ wholeCampaign = false, label = '', phrase, allTime = false, through = null }) => {
  const covers = wholeCampaign ? ' for the whole campaign, from its first door' : `${label ? ` for ${label},` : ''} from the campaign’s first door`;
  // Latest progress, or Pick dates with no first day (§N): everything counts, so nothing shows as new.
  if (allTime) return `Your report shows totals${covers} through ${through || 'the last day you pick'}, with no “+412 this week” figures.`;
  return `Your report shows totals${covers} through the last day you pick. The first day only decides what shows as new, like “+412 ${phrase}”.`;
};

/**
 * Latest progress (§N): the choice for everything from the campaign's first knock through today. It
 * carries only its last day — the server works out where an all-time report starts (allTimeStartOf) —
 * and comes second in the list, whatever the first choice is.
 */
export const allTimeChoice = (today) => ({
  key: 'all_time',
  kind: 'all_time',
  allTime: true,
  weekStart: null,
  weekEnd: today,
  head: 'Latest progress · all time, through today',
  tail: null,
  skipped: null,
});

const article = (word) => (/^[aeiou]/i.test(word || '') ? 'an' : 'a');

/**
 * REPORT_EXISTS in words (§E): the report this tab already has for these dates, by its state. `d` is
 * the refusal ({ status, takenDown, archivedAt, weekStart, weekEnd, scopeLabel }); `scopeLabel` the
 * dialog's own name for the tab, should the refusal not carry one. An archived one still holds its dates
 * (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §C4) and says so — "— it’s archived." — beside Open it and
 * Unarchive, rather than send you to a list it isn't in.
 */
export const duplicateText = (d, { today, scopeLabel }) => {
  const label = d.scopeLabel || scopeLabel || 'Whole campaign';
  // An all-time report (§N) is named by its last day: "an all-time Whole campaign report through Oct 28".
  const what = d.allTime ? `all-time ${label} report through ${dayLabel(d.weekEnd, today)}` : `${label} report for ${periodLabel(d.weekStart, d.weekEnd, today)}`;
  const archived = d.archivedAt ? ' — it’s archived' : '';
  if (d.status === 'draft') return `You already have a draft ${what}${archived}.`;
  if (d.takenDown) return `You already published ${article(what)} ${what}, taken down${archived}.`;
  if (archived) return `You already published ${article(what)} ${what}${archived}.`;
  return `You already published ${article(what)} ${what}. To bring its numbers up to date, open it and press Refresh numbers.`;
};

/**
 * The week-mismatch nudge (§C), or null: only when the tab's last report ran whole weeks (rule 2 —
 * never a month that happens to be four weeks; an irregular report ending on a week end is followed by
 * an organization week already) on another weekday than the organization's. `move` is the choice Move
 * this tab selects: the rule-3b catch-up (reportDates.js catchUpPeriod) from the day after the last
 * report to the end of the last organization week (or of this one) — and, when that runs past
 * CATCH_UP_MAX_DAYS, last week with the days no report covers, New report's own rule for a long catch-up.
 */
export const weekNudge = ({ last = null, s, today }) => {
  if (!last?.weekStart || !last?.weekEnd) return null;
  const next = nextPeriod(last, s, today);
  if (next.kind !== 'weeks') return null;
  const tabDay = dayOfWeek(next.weekStart);
  if (tabDay === s) return null;
  const catchUp = catchUpPeriod(last, s, today);
  const lw = lastWeek(today, s);
  const move =
    periodDays(catchUp.weekStart, catchUp.weekEnd) <= CATCH_UP_MAX_DAYS
      ? catchUp
      : { ...lw, kind: 'last_week', longGap: true, equalsLastWeek: true, skipped: { start: catchUp.weekStart, end: addDays(lw.weekStart, -1) } };
  return { tabDay, tabWeek: weekName(tabDay), orgWeek: weekName(s), move: choiceOf('move', move, { s, today }) };
};
