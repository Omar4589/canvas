// The words and decisions behind the admin map's count chip — a hand-mirrored subset of
// client/src/lib/mapCounts.js (same sentences, same "in view" rule), so web and mobile say the
// same thing about the same numbers. Keep the two in step when either changes.
//
//   matching — doors matching EVERY filter, campaign-wide (/admin/households/map/counts, never
//              the viewport). The chip's primary number.
//   universe — every active door with a map pin in the campaign (or the selected walk list),
//              regardless of filters — the "/ N" denominator. Includes doors excluded from books
//              and do-not-knock doors, because the map shows them.
//   in view  — what is actually drawn: the /map payload (viewport-bounded, 50k-capped). Shown
//              only when it is smaller than matching, with the reason.

// Mirrors MAP_HOUSEHOLD_CAP in server/src/routes/admin/households.js (the /map payload also
// ships it as `cap`; this is the fallback before that payload lands).
export const MAP_HOUSEHOLD_CAP = 50000;

export const fmtCount = (n) =>
  n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString();

export const pluralize = (n, one, many = `${one}s`) => (n === 1 ? one : many);

export const universeLabel = (effortName) => (effortName ? `in ${effortName}` : 'in campaign');

const PRESET_PHRASE = {
  today: 'today',
  yesterday: 'yesterday',
  '7d': 'in the last 7 days',
  '30d': 'in the last 30 days',
};

// 'YYYY-MM-DD' → 'Jun 10, 2026' (device locale), the same shape the web helper prints.
function fmtDay(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return ymd || '';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const joinOr = (items) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

// One plain sentence, no trailing period, for what "match" means under the current filters.
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
  else if (from && to) when = from === to ? `on ${fmtDay(from)}` : `between ${fmtDay(from)} and ${fmtDay(to)}`;
  else if (from) when = `since ${fmtDay(from)}`;
  else if (to) when = `up to ${fmtDay(to)}`;

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

// null = nothing clips what's drawn. Otherwise { shown, byViewport, byHide, byCap }.
export function inViewClip({ matchingTotal, shownCount, payloadCount, excludedVis, truncated }) {
  if (matchingTotal == null || shownCount == null) return null;
  const byCap = !!truncated;
  const byHide = excludedVis === 'hide' && payloadCount != null && shownCount < payloadCount;
  const byViewport = !byCap && payloadCount != null && payloadCount < matchingTotal;
  if (!byCap && !byHide && !byViewport) return null;
  return { shown: shownCount, byViewport, byHide, byCap };
}

// The tap-to-explain rows, in the web popover's order.
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
    if (clip.byHide) why.push('you have hidden the doors excluded from books');
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
    rows.push(`Of the matching doors, ${parts.join(' and ')} — they are on the map and stay counted.`);
  }
  return rows;
}
