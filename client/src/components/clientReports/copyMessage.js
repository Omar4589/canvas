import { formatCivil, formatPeriod } from './reportDates.js';
import { shareUrl } from './linkState.js';

// The copy-ready message (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G6, owner ruling 10-23): what the
// operator pastes into their own email or text when a report goes up. Built from the SHAPED report's
// numbers (the ones the client sees) and the campaign type, it names the scope and the dates, gives the
// report's own link — and NEVER contains the password, which is sent separately.
//
//   "The Volunteer team report for Oct 13 – Oct 19 is up: 3,412 doors knocked so far (+412 in that
//    period) and 1,980 surveys (+260). Open it here: https://…/r/… — use the password I sent you."
//
// The address is the link's short /r/<token>: every link Share hands out is a report's own, and its
// page opens that report (docs/PROPOSAL_CLIENT_REPORT_LINKS.md §D1). The ending says which password, by
// what Share just did (§D1, the owner's final rule): a password made up or typed there — "I'll send you
// its password separately"; right after Change password — "I'll send you the new password separately";
// Same as …, or a link opened again later — "use the password I sent you". A legacy link with no
// password says nothing about one.

const n = (v) => Number(v || 0).toLocaleString('en-US');
const signed = (v) => `${Number(v || 0) >= 0 ? '+' : '−'}${n(Math.abs(Number(v || 0)))}`;

/** 'The Volunteer team report' — or plainly 'The report' for the whole campaign. */
const subjectOf = (scope) => {
  const label = scope?.seriesLabel || scope?.label || '';
  if (!scope?.kind || scope.kind === 'campaign' || !label) return 'The report';
  return `The ${label} report`;
};

/** The message's last words, by `ending`: 'new' (made up or typed in Share), 'changed', or 'sent'. */
const ENDINGS = {
  new: ' — I’ll send you its password separately',
  changed: ' — I’ll send you the new password separately',
  sent: ' — use the password I sent you',
};
const passwordEnding = (link, ending) => (link.hasPassword === false ? '' : ENDINGS[ending] || ENDINGS.sent);

/**
 * The message for one report on its link. `report` carries weekStart, weekEnd, campaignType, scope and
 * the two windows' totals (`cumulative`, `period` — a list row's headline or a shaped report's
 * stats.*.totals). `link` is a share row (its token, whether it has a password). `ending` is what Share
 * just did with the password (above) — 'sent' unless it made one up, took a typed one, or changed it.
 */
export const copyMessageFor = ({ report, link, origin, ending = 'sent' }) => {
  const c = report?.cumulative || {};
  const p = report?.period || {};
  const lit = report?.campaignType === 'lit_drop';
  const second = lit
    ? `${n(c.litKnocks)} lit dropped (${signed(p.litKnocks)})`
    : `${n(c.surveysTaken)} ${Number(c.surveysTaken) === 1 ? 'survey' : 'surveys'} (${signed(p.surveysTaken)})`;
  const url = shareUrl(origin, link.token);
  // An all-time report (Latest progress, SIMPLIFY §N) has nothing new to quote, only its totals: "The
  // report through Oct 28 is up: 3,412 doors knocked so far and 1,980 surveys. Open it here: …"
  if (report.allTime) {
    const total = lit ? `${n(c.litKnocks)} lit dropped` : `${n(c.surveysTaken)} ${Number(c.surveysTaken) === 1 ? 'survey' : 'surveys'}`;
    return (
      `${subjectOf(report.scope)} through ${formatCivil(report.weekEnd)} is up: ${n(c.doorsKnocked)} doors knocked so far and ${total}. ` +
      `Open it here: ${url}${passwordEnding(link, ending)}.`
    );
  }
  return (
    `${subjectOf(report.scope)} for ${formatPeriod(report.weekStart, report.weekEnd)} is up: ` +
    `${n(c.doorsKnocked)} doors knocked so far (${signed(p.doorsKnocked)} in that period) and ${second}. ` +
    `Open it here: ${url}${passwordEnding(link, ending)}.`
  );
};

/**
 * A list row or a shaped report, as copyMessageFor reads it — and Share's Same as … with it: the tab it
 * is on, by its series (seriesId) and, for a report from before series, the old series key (contract K11).
 */
export const messageReportOf = (r) => ({
  id: r.id || (r._id ? String(r._id) : ''),
  weekStart: r.weekStart,
  weekEnd: r.weekEnd,
  allTime: !!r.allTime,
  campaignType: r.campaignType || null,
  seriesId: r.seriesId ? String(r.seriesId) : null,
  seriesKey: r.seriesKey || r.scope?.seriesKey || null,
  scope: r.scope ? { ...r.scope, seriesLabel: r.seriesLabel || r.scope.seriesLabel || r.scope.label } : null,
  cumulative: r.headline?.cumulative || r.stats?.cumulative?.totals || {},
  period: r.headline?.period || r.stats?.period?.totals || {},
});
