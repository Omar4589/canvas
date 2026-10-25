import { Button } from '../ui/index.js';
import QuestionTable from './QuestionTable.jsx';
import { SectionTitle } from './parts.jsx';
import { formatPeriod } from './reportDates.js';

// The builder's left column (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3, §G4): title, observations,
// the per-question table, voter groups, the door goal and the map. Every change goes through
// `onChange(nextSettings)`; the page decides whether it auto-saves (a draft) or waits for Update
// report (an edit of a published report). On a published report the map only shrinks in place —
// additions read "Add this with Refresh numbers" — and turning the map off or switching to areas asks
// first (the page's confirm dialogs, through onMapOff / onAreas).

const field = 'w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60';
const box = 'h-4 w-4 accent-brand-accent disabled:cursor-not-allowed disabled:opacity-40';

// Area view, in the words §F5/§O5 settled on.
export const AREA_WORDING =
  'Area view never shows an address. A single-choice question shows its answers area by area only when every area has at least five answers to it. How each door went shows for every area, even one with a single home, and other reports on the same link can still narrow things down.';

const ReportSettings = ({
  report,
  settings,
  rows,
  removedNotes,
  editable,
  published,
  live,
  served,
  mapStale,
  goalReason,
  // The campaign has a door goal, but these numbers were built before it (contract C6): the reason
  // comes with the button that rebuilds them — Recompute on a draft, Refresh numbers once published.
  goalAfterBuild = false,
  onChange,
  onToggleChart,
  onToggleMap,
  onHeadline,
  onShowAll,
  onShowNone,
  onMapOff,
  onAreas,
  onRecompute,
  onRefreshFor,
  recomputeBusy,
}) => {
  const vis = settings.visibility;
  const set = (patch) => onChange({ ...settings, ...patch });
  const setVis = (patch) => onChange({ ...settings, visibility: { ...vis, ...patch } });
  const tags = report.stats?.cumulative?.tagBreakdowns || [];
  const goal = report.goalSnapshot?.target ? report.goalSnapshot : null;

  // Observations: a heading and a paragraph each; add, reorder, remove.
  const obs = settings.observations;
  const setObs = (i, patch) => set({ observations: obs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= obs.length) return;
    const next = [...obs];
    [next[i], next[j]] = [next[j], next[i]];
    set({ observations: next });
  };

  // What the map may do here. A draft: anything (it takes effect at the next Recompute). A published
  // report: only removals in place, and pins → areas as a background switch.
  const mapToggleBlocked = published && !vis.showMap && !served ? 'Add this with Refresh numbers.' : null;
  const toPinsBlocked = published && served && live.mapMode === 'area';
  const sizeBlocked = published && served && live.mapMode === 'area';

  return (
    <div className="space-y-6">
      <section>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Title</span>
          <input
            className={`${field} mt-2`}
            value={settings.title}
            disabled={!editable}
            maxLength={200}
            placeholder={formatPeriod(report.weekStart, report.weekEnd)}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
      </section>

      <section>
        <SectionTitle
          right={
            editable && (
              <Button size="sm" variant="secondary" onClick={() => set({ observations: [...obs, { heading: '', body: '' }] })}>
                + Section
              </Button>
            )
          }
        >
          Observations
        </SectionTitle>
        {/* Drafts only: the tick lives under Before you publish, which a published report doesn't have (VERIFY2-5). */}
        {!published && report.copiedFrom && settings.copiedNotesReviewed === false && (
          <p className="mb-2 rounded-md border border-warning/30 bg-warning-tint px-2.5 py-1.5 text-xs text-warning-fg">
            Copied from the {formatPeriod(report.copiedFrom.weekStart, report.copiedFrom.weekEnd)} report. Read them through, then tick “I’ve reviewed the copied
            notes” under Before you publish.
          </p>
        )}
        {obs.length === 0 && <p className="text-sm text-fg-muted">No sections yet. {editable ? 'Add one to write your observations.' : ''}</p>}
        <div className="space-y-3">
          {obs.map((s, i) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <input
                  className={field}
                  value={s.heading}
                  disabled={!editable}
                  maxLength={200}
                  aria-label={`Section ${i + 1} heading`}
                  placeholder="Section heading (e.g. Voter intent)"
                  onChange={(e) => setObs(i, { heading: e.target.value })}
                />
                {editable && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => move(i, -1)} className="rounded px-1.5 text-fg-muted hover:bg-sunken hover:text-fg" aria-label="Move up">
                      ↑
                    </button>
                    <button type="button" onClick={() => move(i, 1)} className="rounded px-1.5 text-fg-muted hover:bg-sunken hover:text-fg" aria-label="Move down">
                      ↓
                    </button>
                    <button type="button" onClick={() => set({ observations: obs.filter((_, j) => j !== i) })} className="rounded px-1.5 text-danger hover:bg-danger-tint" aria-label="Remove section">
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <textarea
                className={`${field} mt-2 min-h-[90px]`}
                value={s.body}
                disabled={!editable}
                maxLength={20000}
                aria-label={`Section ${i + 1} text`}
                placeholder="Write the observation…"
                onChange={(e) => setObs(i, { body: e.target.value })}
              />
              {editable && !s.heading.trim() && (s.body || '').trim() && <p className="mt-1 text-xs text-warning-fg">Add a heading — a section without one isn’t saved.</p>}
            </div>
          ))}
        </div>
      </section>

      <QuestionTable
        rows={rows}
        emptyText={report.snapshotId || published ? 'This report has no survey questions to show.' : 'The survey questions appear here once the numbers are built.'}
        disabled={!editable}
        mapOn={vis.showMap}
        removedNotes={removedNotes}
        onToggleChart={onToggleChart}
        onToggleMap={onToggleMap}
        onHeadline={onHeadline}
        onShowAll={onShowAll}
        onShowNone={onShowNone}
      />

      {/* Tags are OPT-IN — the opposite default of the questions: tag names are internal labels that
          would land on the client's page, so nothing shows without a tick. */}
      <section>
        <SectionTitle>Voter groups</SectionTitle>
        <p className="mb-2 text-xs text-fg-muted">Hidden until you tick them. A shown group reports voters identified, and how many still gave a tagged answer at last contact.</p>
        {tags.length === 0 ? (
          <p className="text-sm text-fg-muted">No tagged answers in these numbers.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {tags.map((t) => (
              <label key={t.tag} className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  className={box}
                  disabled={!editable}
                  checked={vis.visibleTags.includes(t.tag)}
                  onChange={(e) => setVis({ visibleTags: e.target.checked ? [...vis.visibleTags, t.tag] : vis.visibleTags.filter((x) => x !== t.tag) })}
                />
                {t.tag}
                <span className="text-xs text-fg-muted">· {(t.identifiedVoters || 0).toLocaleString()} identified</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Door goal</SectionTitle>
        <label className={`flex items-center gap-2 text-sm ${goal ? 'text-fg' : 'text-fg-subtle'}`}>
          <input type="checkbox" className={box} disabled={!editable || !goal} checked={!!vis.showGoal} onChange={(e) => setVis({ showGoal: e.target.checked })} />
          Show door-goal progress to the client
        </label>
        <p className="mt-1 text-xs text-fg-muted">
          {goal
            ? `${(goal.done ?? 0).toLocaleString()} of ${goal.target.toLocaleString()} doors as of this report’s period — progress only, never a pace or an “on track” verdict. Off by default: anyone with the link can read it.`
            : goalReason}
          {!goal && goalAfterBuild && (onRecompute || onRefreshFor) && (
            <>
              {' '}
              <button
                type="button"
                disabled={!!onRecompute && recomputeBusy}
                className="font-semibold text-brand-accent hover:underline disabled:opacity-50"
                onClick={onRecompute || onRefreshFor}
              >
                {onRecompute ? 'Recompute' : 'Refresh numbers'}
              </button>
            </>
          )}
        </p>
      </section>

      <section>
        <SectionTitle>Map</SectionTitle>
        <label className={`flex items-center gap-2 text-sm ${mapToggleBlocked ? 'text-fg-subtle' : 'text-fg'}`}>
          <input
            type="checkbox"
            className={box}
            disabled={!editable || !!mapToggleBlocked}
            checked={vis.showMap}
            onChange={(e) => (e.target.checked ? setVis({ showMap: true }) : onMapOff())}
          />
          Show the map
        </label>
        {editable && mapToggleBlocked && (
          <p className="mt-1 text-xs text-fg-muted">
            {mapToggleBlocked}{' '}
            {onRefreshFor && (
              <button type="button" className="font-semibold text-brand-accent hover:underline" onClick={onRefreshFor}>
                Refresh numbers
              </button>
            )}
          </p>
        )}
        {vis.showMap && (
          <div className="mt-2 space-y-2 pl-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" role="radiogroup" aria-label="Map view">
              <label className={`flex items-center gap-1.5 text-sm ${toPinsBlocked ? 'text-fg-subtle' : 'text-fg'}`}>
                <input
                  type="radio"
                  className={box}
                  disabled={!editable || toPinsBlocked}
                  checked={vis.mapMode !== 'area'}
                  onChange={() => setVis({ mapMode: 'pins' })}
                />
                Exact doors
              </label>
              <label className="flex items-center gap-1.5 text-sm text-fg">
                <input
                  type="radio"
                  className={box}
                  disabled={!editable}
                  checked={vis.mapMode === 'area'}
                  onChange={() => (published ? onAreas(vis.areaSize) : setVis({ mapMode: 'area' }))}
                />
                Areas
              </label>
              <select
                aria-label="Area size"
                className="rounded-lg border border-border-strong bg-card px-2 py-1 text-sm text-fg focus:border-brand-accent focus:outline-none disabled:opacity-60"
                disabled={!editable || sizeBlocked || vis.mapMode !== 'area'}
                value={vis.areaSize}
                onChange={(e) => (published ? onAreas(e.target.value) : setVis({ areaSize: e.target.value }))}
              >
                <option value="small">Small areas (about 1,100–1,400 ft across)</option>
                <option value="large">Large areas (about 0.55–0.7 mi across)</option>
              </select>
            </div>
            {published && editable && served && live.mapMode === 'area' && (
              <p className="text-xs text-fg-muted">
                Going back to exact doors or changing the area size adds to the map: use{' '}
                {onRefreshFor ? (
                  <button type="button" className="font-semibold text-brand-accent hover:underline" onClick={onRefreshFor}>
                    Refresh numbers
                  </button>
                ) : (
                  'Refresh numbers'
                )}
                .
              </p>
            )}
            {vis.mapMode === 'area' ? (
              <p className="text-xs text-fg-muted">{AREA_WORDING}</p>
            ) : (
              <p className="rounded-md border border-warning/30 bg-warning-tint px-2.5 py-1.5 text-xs text-warning-fg">
                Exact doors show your client each home’s street address and result. Areas never show an address.
              </p>
            )}
          </div>
        )}
        {mapStale && (
          <p className="mt-2 text-xs text-warning-fg">
            {mapStale}{' '}
            {onRecompute && (
              <button type="button" disabled={recomputeBusy} className="font-semibold underline underline-offset-2 hover:opacity-80" onClick={onRecompute}>
                Recompute
              </button>
            )}
          </p>
        )}
      </section>
    </div>
  );
};

export default ReportSettings;
