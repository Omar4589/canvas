import { formatPeriod } from './reportDates.js';
import { reportUrl, shareUrl } from './linkState.js';

// The copy-ready message (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G6, owner ruling 10-23): what the
// operator pastes into their own email or text when a report goes up. Built from the SHAPED report's
// numbers (the ones the client sees) and the campaign type, it names the scope and the dates, deep
// links to the report — and NEVER contains the password, which is sent separately.
//
//   "The Volunteer team report for Oct 13 – Oct 19 is up: 3,412 doors knocked so far (+412 in that
//    period) and 1,980 surveys (+260). Open it here: https://…/r/…/reports/… — use the password I
//    sent you."
//
// The ending says which password, by the link it uses (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D):
// a link to all your reports — "use the password I sent you"; a link made just now, in Share —
// "I'll send you its password separately"; a link to just this report, made before — "use the
// password I sent you for this report". A legacy link with no password says nothing about one.

const n = (v) => Number(v || 0).toLocaleString('en-US');
const signed = (v) => `${Number(v || 0) >= 0 ? '+' : '−'}${n(Math.abs(Number(v || 0)))}`;

/** 'The Volunteer team report' — or plainly 'The report' for the whole campaign. */
const subjectOf = (scope) => {
  const label = scope?.seriesLabel || scope?.label || '';
  if (!scope?.kind || scope.kind === 'campaign' || !label) return 'The report';
  return `The ${label} report`;
};

/** The message's last words: which password to use, by the link (above). */
const passwordEnding = (link, justMade) => {
  if (link.hasPassword === false) return '';
  if (justMade) return ' — I’ll send you its password separately';
  return link.reportId ? ' — use the password I sent you for this report' : ' — use the password I sent you';
};

/**
 * The message for one report on one link. `report` carries weekStart, weekEnd, campaignType, scope
 * and the two windows' totals (`cumulative`, `period` — a list row's headline or a shaped report's
 * stats.*.totals). `link` is a share row (its token, whether it has a password, and the report it
 * opens — reportId, null for all of them). `justMade`: the link was made a moment ago, in Share, so
 * its password hasn't been sent yet.
 */
export const copyMessageFor = ({ report, link, origin, justMade = false }) => {
  const c = report?.cumulative || {};
  const p = report?.period || {};
  const lit = report?.campaignType === 'lit_drop';
  const second = lit
    ? `${n(c.litKnocks)} lit dropped (${signed(p.litKnocks)})`
    : `${n(c.surveysTaken)} ${Number(c.surveysTaken) === 1 ? 'survey' : 'surveys'} (${signed(p.surveysTaken)})`;
  const url = reportUrl(origin, link.token, report.id);
  return (
    `${subjectOf(report.scope)} for ${formatPeriod(report.weekStart, report.weekEnd)} is up: ` +
    `${n(c.doorsKnocked)} doors knocked so far (${signed(p.doorsKnocked)} in that period) and ${second}. ` +
    `Open it here: ${url}${passwordEnding(link, justMade)}.`
  );
};

/**
 * The new link's message (the Link ready dialog): the link's own address, never a password. A link
 * to one report says so ("…to this report", §D); a link to all of them, "…to our reports".
 */
export const linkMessageFor = ({ link, origin }) =>
  `Here's the link to ${link.reportId ? 'this report' : 'our reports'}: ${shareUrl(origin, link.token)}${link.hasPassword === false ? '' : ' — I’ll send the password separately'}.`;

/** A list row or a shaped report, as copyMessageFor reads it. */
export const messageReportOf = (r) => ({
  id: r.id || (r._id ? String(r._id) : ''),
  weekStart: r.weekStart,
  weekEnd: r.weekEnd,
  campaignType: r.campaignType || null,
  scope: r.scope ? { ...r.scope, seriesLabel: r.seriesLabel || r.scope.seriesLabel || r.scope.label } : null,
  cumulative: r.headline?.cumulative || r.stats?.cumulative?.totals || {},
  period: r.headline?.period || r.stats?.period?.totals || {},
});
