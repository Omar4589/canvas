import InfoHint from './InfoHint.jsx';
import { fmtCount, headerCounts, inViewClip, explainCounts, MAP_HOUSEHOLD_CAP } from '../lib/mapCounts.js';

// The admin map's header count, in honest numbers: doors MATCHING the filters (campaign-wide,
// from /map/counts — never the viewport), the filter-independent universe it's "of", what is
// actually IN VIEW when the viewport / Hide / the cap clip it, and an ⓘ that spells each out.
// Presentational — MapPage owns both queries. Every string comes from lib/mapCounts.js so the
// wording is unit-tested and the mobile admin map can mirror it.
//
//   counts      — the /map/counts body, or null while pending / on error
//   countsState — { pending, error, placeholder, retry }; `placeholder` is true while EITHER
//                 query shows a previous key's data (a filter just changed) — the in-view pill
//                 is suppressed then so a transiently mismatched pair never prints a false number
//   shownCount  — doors actually drawn (the payload minus Hide); payloadCount — the raw payload
export default function MapDoorCount({
  loading,
  counts,
  countsState,
  shownCount,
  payloadCount,
  excludedVis,
  truncated,
  cap,
  effortName,
  isAllTime,
  matchFacts,
}) {
  const capN = cap || MAP_HOUSEHOLD_CAP;
  const placeholder = !!countsState?.placeholder;
  const h = headerCounts({
    loading, counts, shownCount, payloadCount, excludedVis, truncated, effortName, placeholder, isAllTime,
  });
  const clip =
    !counts || placeholder
      ? null
      : inViewClip({ matchingTotal: counts.matching?.total, shownCount, payloadCount, excludedVis, truncated });

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>
        {h.primary.n != null && (
          <strong className="font-semibold tabular-nums text-fg">{fmtCount(h.primary.n)}</strong>
        )}
        {h.primary.n != null ? ' ' : ''}
        {h.primary.label}
      </span>
      {h.secondary && <span>· {h.secondary}</span>}
      {clip && (
        <span
          title="Doors drawn on the map right now — the map only loads the area on screen (and Hide removes excluded doors). The matching count is campaign-wide."
          className="rounded-full bg-sunken px-2 py-0.5 font-medium tabular-nums text-fg-muted"
        >
          {fmtCount(clip.shown)} in view
        </span>
      )}
      {h.emptyHint && <span className="text-fg-subtle">— {h.emptyHint}</span>}
      {counts && (
        <InfoHint label="What is this counting?" width="w-80">
          <ul className="space-y-1.5">
            {explainCounts({ counts, clip, facts: matchFacts, effortName, cap: capN }).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </InfoHint>
      )}
      {!counts && countsState?.error && (
        <button type="button" onClick={countsState.retry} className="text-brand-accent hover:underline">
          Retry totals
        </button>
      )}
      {truncated && (
        <span
          title={`The map loads at most ${fmtCount(capN)} doors per pull and this area has more, so some doors are not drawn. Zoom in to see every door in an area.`}
          className="inline-flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 font-medium text-warning-fg"
        >
          ⚠ Map capped at {fmtCount(capN)} doors — zoom in
        </span>
      )}
    </span>
  );
}
