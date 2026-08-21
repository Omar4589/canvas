// The words and decisions behind the admin map's header count — pure, no React, so the wording
// and the "in view" rule are unit-tested (mapCounts.test.js) and mobile can mirror them
// (mobile/lib/mapCounts.js; keep the sentences in step).
//
// Four numbers, four meanings:
//   matching — doors matching EVERY filter, campaign-wide (GET /admin/households/map/counts,
//              never the viewport). The header's primary number.
//   universe — every active door with a map pin in the campaign (or the selected walk list),
//              regardless of filters — the "of N" denominator. Includes doors excluded from
//              books and do-not-knock doors, because the map shows them.
//   in view  — what is actually drawn: the /map payload (viewport-bounded, 50k-capped), minus
//              Hide. Shown only when it is smaller than matching, with the reason.
//   byStatus — per-status counts under every filter except status (the sidebar chips).
import { formatDay } from './datePresets.js';

// Mirrors MAP_HOUSEHOLD_CAP in server/src/routes/admin/households.js. The /map payload also
// ships it as `cap`; this is the fallback for copy before that payload lands.
export const MAP_HOUSEHOLD_CAP = 50000;

export const fmtCount = (n) =>
  n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString();

export const pluralize = (n, one, many = `${one}s`) => (n === 1 ? one : many);

// "in campaign" | "in North" — the universe follows the walk-list select only; a pass /
// import / saved-search scope narrows matching and leaves the denominator alone.
export const universeLabel = (effortName) => (effortName ? `in ${effortName}` : 'in campaign');

const PRESET_PHRASE = {
  today: 'today',
  yesterday: 'yesterday',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
};

const joinOr = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

// One plain sentence, no trailing period, for what "match" means under the current filters.
// Mirrors the server: any date window, canvasser or answer filter narrows the map to doors
// with an interaction (a knock or survey) in scope; an answer filter narrows to surveys.
export function describeMatch({
  preset,
  from,
  to,
  statusLabels = [],
  canvasserName = '',
  answerOption = '',
  scopeLabel = '',
} = {}) {
  let when = '';
  if (preset && PRESET_PHRASE[preset]) when = PRESET_PHRASE[preset];
  else if (from && to) when = from === to ? `on ${formatDay(from)}` : `between ${formatDay(from)} and ${formatDay(to)}`;
  else if (from) when = `since ${formatDay(from)}`;
  else if (to) when = `up to ${formatDay(to)}`;

  let s;
  if (!when && !canvasserName && !answerOption) {
    s = 'every door';
  } else {
    s = answerOption ? 'doors surveyed' : 'doors with a knock or survey';
    if (when) s += ` ${when}`;
    if (canvasserName) s += ` by ${canvasserName}`;
    if (answerOption) s += ` with the answer "${answerOption}"`;
  }
  if (statusLabels.length) s += ` with status ${joinOr(statusLabels)}`;
  if (scopeLabel) s += `, ${scopeLabel}`;
  return s;
}

// The "in view" decision. null = nothing clips what's drawn, so say nothing. Otherwise
// { shown, byViewport, byHide, byCap } — the drawn count plus every reason it is smaller.
//   byCap      — the /map payload hit its cap (`truncated`)
//   byViewport — the payload is smaller than matching (the map only loads the area on screen)
//   byHide     — Hide removed excluded doors from the drawn set
export function inViewClip({ matchingTotal, shownCount, payloadCount, excludedVis, truncated }) {
  if (matchingTotal == null || shownCount == null) return null;
  const byCap = !!truncated;
  const byHide = excludedVis === 'hide' && payloadCount != null && shownCount < payloadCount;
  const byViewport = !byCap && payloadCount != null && payloadCount < matchingTotal;
  if (!byCap && !byHide && !byViewport) return null;
  return { shown: shownCount, byViewport, byHide, byCap };
}

// The header line: { primary: { n, label }, secondary, inView, emptyHint }.
//   loading           → "Loading households…"
//   counts missing    → "N doors in view" — no "match" claim until the totals exist
//   matching == universe → "N doors in campaign" (nothing is narrowing the map)
//   otherwise         → "N doors match · of U in campaign"
// `placeholder` is true while either query is showing a previous key's data (a filter just
// changed): the in-view pill is suppressed then, so a transiently mismatched pair can never
// print a false number. Mobile mirrors these branches.
export function headerCounts({
  loading,
  counts,
  shownCount,
  payloadCount,
  excludedVis,
  truncated,
  effortName,
  placeholder = false,
  isAllTime = false,
}) {
  const none = { secondary: null, inView: null, emptyHint: null };
  if (loading) return { primary: { n: null, label: 'Loading households…' }, ...none };
  const uLabel = universeLabel(effortName);
  if (!counts) {
    return { primary: { n: shownCount ?? 0, label: `${pluralize(shownCount ?? 0, 'door')} in view` }, ...none };
  }
  const m = counts.matching?.total ?? 0;
  const u = counts.universe?.total ?? 0;
  const clip = placeholder
    ? null
    : inViewClip({ matchingTotal: m, shownCount, payloadCount, excludedVis, truncated });
  const inView = clip ? `${fmtCount(clip.shown)} in view` : null;
  if (m === u) {
    return { primary: { n: m, label: `${pluralize(m, 'door')} ${uLabel}` }, secondary: null, inView, emptyHint: null };
  }
  const emptyHint =
    m === 0
      ? isAllTime
        ? 'no doors match these filters'
        : 'none touched in this date range yet — pick All time for every door'
      : null;
  return {
    primary: { n: m, label: m === 1 ? 'door matches' : 'doors match' },
    secondary: `of ${fmtCount(u)} ${uLabel}`,
    inView,
    emptyHint,
  };
}

// The ⓘ popover rows, in order: what "match" means; why "in view" is smaller (when it is); the
// universe and its two sub-counts; and, when some matching doors are held back from books or
// marked do-not-knock, that they are still counted. Plain strings so mobile can render them.
export function explainCounts({ counts, clip, facts, effortName, cap = MAP_HOUSEHOLD_CAP }) {
  const rows = [];
  const m = counts.matching?.total ?? 0;
  const u = counts.universe?.total ?? 0;
  rows.push(
    `${fmtCount(m)} ${pluralize(m, 'door')} match: ${describeMatch(facts)}. Counted across the whole campaign, not just the area on screen.`
  );
  if (clip) {
    const why = [];
    if (clip.byCap) why.push(`the map draws at most ${fmtCount(cap)} doors per pull and this area has more — zoom in to see every door in an area`);
    if (clip.byViewport) why.push('the map only loads the area on screen — pan or zoom out to load more');
    if (clip.byHide) why.push('you have hidden the doors excluded from books (Layers → Hide)');
    rows.push(`${fmtCount(clip.shown)} in view — ${why.join('; ')}.`);
  }
  const ex = counts.universe?.excludedFromTurf ?? 0;
  const dnk = counts.universe?.doNotKnock ?? 0;
  rows.push(
    `${fmtCount(u)} ${pluralize(u, 'door')} ${universeLabel(effortName)} — every active door with a map pin, regardless of filters, including ${
      ex ? `${fmtCount(ex)} excluded from books` : 'none excluded from books'
    } and ${dnk ? `${fmtCount(dnk)} do-not-knock` : 'none do-not-knock'}.`
  );
  const mEx = counts.matching?.excludedFromTurf ?? 0;
  const mDnk = counts.matching?.doNotKnock ?? 0;
  if (mEx || mDnk) {
    const parts = [];
    if (mEx) parts.push(`${fmtCount(mEx)} excluded from books`);
    if (mDnk) parts.push(`${fmtCount(mDnk)} do-not-knock`);
    rows.push(
      `Of the matching doors, ${parts.join(' and ')} — Show / Dim / Hide in Layers only changes your view; they stay counted.`
    );
  }
  return rows;
}
