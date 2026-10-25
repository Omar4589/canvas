import { SectionTitle } from './parts.jsx';

// The builder's per-question table (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3): one row per survey
// question, with Chart / Map / Headline, and Show: All · None for the charts. Every rule lives in
// questionRules.js (rowsFor and the toggles); this only draws the rows it is handed:
//   · a follow-up says what mapping it would show ("Asked only on some paths through 'Back the
//     recall?' — mapping it shows who took that path") and, while its parent is off the map, why its
//     Map box can't be ticked — leaving it off is the suggestion, never mapping the parent;
//   · a follow-up of a written answer can't be mapped, and says so;
//   · unticking a parent's Map takes its follow-ups off too, and `removedNotes` says which.

const box = 'h-4 w-4 accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40';

const QuestionTable = ({
  rows,
  emptyText = 'This report has no survey questions to show.',
  disabled = false,
  mapOn = true,
  removedNotes = {},
  onToggleChart,
  onToggleMap,
  onHeadline,
  onShowAll,
  onShowNone,
}) => {
  if (!rows.length) {
    return (
      <div>
        <SectionTitle>Survey questions</SectionTitle>
        <p className="text-sm text-fg-muted">{emptyText}</p>
      </div>
    );
  }
  const noHeadline = !rows.some((r) => r.headline);
  return (
    <div>
      <SectionTitle
        right={
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            Show:
            <button type="button" disabled={disabled} onClick={onShowAll} className="font-semibold text-brand-accent hover:underline disabled:opacity-50">
              All
            </button>
            ·
            <button type="button" disabled={disabled} onClick={onShowNone} className="font-semibold text-brand-accent hover:underline disabled:opacity-50">
              None
            </button>
          </span>
        }
      >
        Survey questions
      </SectionTitle>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-xs text-fg-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Question</th>
              <th scope="col" className="w-14 px-2 py-2 text-center font-medium">Chart</th>
              <th scope="col" className="w-14 px-2 py-2 text-center font-medium">Map</th>
              <th scope="col" className="w-20 px-2 py-2 text-center font-medium">Headline</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-fg">{r.label}</div>
                  {r.followUp && <p className="mt-0.5 text-xs text-fg-muted">{r.followUp}</p>}
                  {r.mapBlocked && r.chart && mapOn && (
                    <p className="mt-0.5 text-xs text-warning-fg">{r.mapBlocked}</p>
                  )}
                  {r.areaNote && <p className="mt-0.5 text-xs text-fg-muted">{r.areaNote}</p>}
                  {removedNotes[r.key] && <p className="mt-0.5 text-xs text-info-fg">{removedNotes[r.key]}</p>}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <input
                    type="checkbox"
                    className={box}
                    checked={r.chart}
                    disabled={disabled}
                    aria-label={`Show the chart for ${r.label}`}
                    onChange={() => onToggleChart(r.key)}
                  />
                </td>
                <td className="px-2 py-2.5 text-center">
                  {mapOn ? (
                    <input
                      type="checkbox"
                      className={box}
                      checked={r.map}
                      disabled={disabled || r.mapDisabled}
                      title={r.mapBlocked || undefined}
                      aria-label={`Use ${r.label} as a map filter`}
                      onChange={() => onToggleMap(r.key)}
                    />
                  ) : (
                    <span className="text-fg-subtle" title="The map is off">–</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <input
                    type="radio"
                    name="headline-question"
                    className={box}
                    checked={r.headline}
                    disabled={disabled || r.headlineDisabled}
                    title={r.headlineDisabled ? 'Show its chart to make it the headline.' : undefined}
                    aria-label={`Make ${r.label} the headline`}
                    onChange={() => onHeadline(r.key)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
        <input type="radio" name="headline-question" className={box} checked={noHeadline} disabled={disabled} onChange={() => onHeadline(null)} />
        No headline question
      </label>
      {!mapOn && <p className="mt-1 text-xs text-fg-muted">Turn on the map below to use questions as map filters.</p>}
    </div>
  );
};

export default QuestionTable;
