import { REASON_META } from '../lib/flags.js';
import FlagLegend from './FlagLegend.jsx';
import Segmented from './ui/Segmented.jsx';

const DEFAULT_STATUSES = ['surveyed', 'refused', 'restricted', 'no_soliciting', 'lit_dropped', 'not_home', 'wrong_address', 'unknocked'];

const REVIEW_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'all', label: 'All' },
];

// One decision for every flag matching the current flag filters (bulk review).
const BULK_ACTIONS = [
  { status: 'reviewed', label: 'Mark reviewed' },
  { status: 'dismissed', label: 'Dismiss' },
  { status: 'confirmed', label: 'Confirm issue', danger: true },
  { status: 'open', label: 'Reopen', reopenOnly: true },
];

function StatusChip({ status, active, count, onClick, color, label, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={
        'flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-brand-600 bg-brand-tint text-brand-accent'
          : 'border-border bg-card text-fg-muted hover:bg-sunken')
      }
    >
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      {count != null && <span className="text-xs tabular-nums text-fg-muted">{Number(count).toLocaleString()}</span>}
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">
      {children}
    </div>
  );
}

export default function MapFilters({
  statusFilter = [],
  onStatusChange,
  canvassers = [],
  canvasserId,
  onCanvasserChange,
  survey,
  answerFilter,
  onAnswerChange,
  statusColors,
  statusLabels,
  // Doors sharing one geocode, drawn as building glyphs. 0 hides the note entirely.
  buildingCount = 0,
  stackedDoorCount = 0,
  showCanvasserPins = false,
  onShowCanvasserPinsChange,
  // Amber approximate-location rings (interpolated geocodes). Default ON; the checkbox lets a
  // congested All-Time view switch them off. Pure layer visibility — MapPage owns the effect.
  showApproxRings = true,
  onShowApproxRingsChange,
  // Overlap overlay (admin map only): doors worked by 2+ canvassers in the same pass.
  showOverlaps = false,
  onShowOverlapsChange,
  overlapCount = 0,
  // Doors held back from books (Household.excludedFromTurf). 'show' | 'dim' | 'hide'.
  // 0 count hides the control entirely.
  excludedVis = 'show',
  onExcludedVisChange,
  excludedCount = 0,
  // Campaign-wide figures from /map/counts (null until loaded; the read-only client map never
  // passes them). statusCounts feeds each chip: doors per status under every OTHER filter,
  // across the whole campaign — never the viewport. The two excluded figures sit under the
  // Layers chip, whose own badge stays "in view" (that is what Dim / Hide act on).
  statusCounts = null,
  excludedCampaignCount = null,
  excludedUniverseCount = null,
  // GPS-audit flags overlay (admin map only).
  showFlags = false,
  onShowFlagsChange,
  flagReasonFilter = [],
  onFlagReasonToggle,
  reviewStatus = 'open',
  onReviewStatusChange,
  flagCounts = null,
  // Bulk review over the map's current flag scope — MapPage owns the state + the POST; this
  // renders the button and the armed inline confirm (count comes from the page's dry run).
  // { show, armed, count, note, busy, showReopen, onArm, onCancel, onNote, onAction } | null.
  flagBulk = null,
  // The read-only client map has no canvasser identity — hide the Layers toggle + the
  // canvasser dropdown entirely.
  hideCanvassers = false,
  // Which status chips to offer (the client map drops Unknocked, and Lit dropped for survey
  // campaigns). Defaults to the full admin set.
  statuses = DEFAULT_STATUSES,
}) {
  function toggleStatus(s) {
    if (statusFilter.includes(s)) onStatusChange(statusFilter.filter((x) => x !== s));
    else onStatusChange([...statusFilter, s]);
  }

  const choiceQuestions =
    survey?.questions?.filter((q) => q.type === 'single_choice' || q.type === 'multiple_choice') ||
    [];

  function setAnswer(questionKey, option, optionId) {
    // Same-chip test by id where there is one (see the chip's `active` above): keyed on the
    // label, clicking "Other" while a real option also named "Other" was selected read as a
    // toggle-off instead of a switch.
    const sameChip = optionId
      ? answerFilter?.optionId === optionId
      : answerFilter?.option === option && !answerFilter?.optionId;
    if (answerFilter?.questionKey === questionKey && sameChip) {
      onAnswerChange({ questionKey: '', option: '', optionId: '', templateId: '' });
    } else {
      // Pin the filter to the template these chips came from — question keys / option ids
      // are unique only WITHIN one template, so a same-named option in another survey on
      // this campaign must never leak into the pin set.
      onAnswerChange({
        questionKey,
        option,
        optionId: optionId || '',
        templateId: survey?.surveyTemplate?.id || '',
      });
    }
  }

  function clearAll() {
    onStatusChange([]);
    onCanvasserChange?.('');
    onAnswerChange({ questionKey: '', option: '', optionId: '', templateId: '' });
  }

  const hasActiveFilters =
    statusFilter.length > 0 ||
    (!hideCanvassers && canvasserId) ||
    (answerFilter?.questionKey && answerFilter?.option);

  return (
    <div className="space-y-5">
      {!hideCanvassers && (
        <div>
          <SectionLabel>Layers</SectionLabel>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showCanvasserPins}
              onChange={(e) => onShowCanvasserPinsChange?.(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
            />
            <span className="text-fg">Show canvasser locations</span>
          </label>
          <div className="mt-1 text-xs text-fg-muted">
            Where each survey, not-home, or wrong-address was submitted from, labeled
            with the canvasser&apos;s initials.
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showApproxRings}
              onChange={(e) => onShowApproxRingsChange?.(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
            />
            <span className="text-fg">Approximate location rings</span>
          </label>
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2"
              style={{ borderColor: '#f59e0b', borderStyle: 'dashed' }}
            />
            Pins placed from the street address, not the exact building — fix or confirm them
            on the Pin Fixes page.
          </div>

          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showOverlaps}
              onChange={(e) => onShowOverlapsChange?.(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
            />
            <span className="text-fg">Show overlaps</span>
            {overlapCount > 0 && (
              <span className="ml-auto rounded-full bg-warning-tint px-1.5 text-xs font-medium text-warning-fg">
                {overlapCount}
              </span>
            )}
          </label>
          <div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2"
              style={{ borderColor: '#f59e0b' }}
            />
            Doors worked by two or more canvassers in the same pass — a turf collision or
            possible double-count.
          </div>

          {/* Only offered when there is something to see. Tri-state, so it uses Segmented
              rather than a checkbox — "dim" is the useful middle setting and a boolean
              can't express it. Never a server filter: see lib/excludedDoors.js. */}
          {(excludedCount > 0 || excludedUniverseCount > 0) && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="text-fg">Doors excluded from books</span>
                <span
                  title="Excluded doors currently loaded on your screen — what Dim / Hide will act on. The campaign-wide figures are in the note below."
                  className="ml-auto rounded-full bg-warning-tint px-1.5 text-xs font-medium text-warning-fg"
                >
                  {excludedCount.toLocaleString()} in view
                </span>
              </div>
              <Segmented
                size="sm"
                value={excludedVis}
                onChange={onExcludedVisChange}
                options={[
                  { value: 'show', label: 'Show' },
                  { value: 'dim', label: 'Dim' },
                  { value: 'hide', label: 'Hide' },
                ]}
              />
              <div className="mt-1 text-xs text-fg-muted">
                {excludedCampaignCount != null && (
                  <>
                    {excludedCampaignCount.toLocaleString()} match your current filters across the campaign
                    {excludedUniverseCount != null
                      ? `; ${excludedUniverseCount.toLocaleString()} in the campaign overall`
                      : ''}
                    .{' '}
                  </>
                )}
                Held back by <strong className="font-medium text-fg-muted">Remove apartments</strong> when
                turf was cut — not cut into books, not sent to phones, not printed, anywhere in this
                campaign. They stay on this map because it is the record of what exists and what was
                worked. Clear it from Turf Cutting on the walk list that owns the door.
              </div>
            </div>
          )}
        </div>
      )}

      {!hideCanvassers && (
        <div>
          <SectionLabel>
            GPS audit <FlagLegend />
          </SectionLabel>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showFlags}
              onChange={(e) => onShowFlagsChange?.(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
            />
            <span className="text-fg">Show flagged entries</span>
            {flagCounts?.open > 0 && (
              <span className="ml-auto rounded-full bg-danger-tint px-1.5 text-xs font-medium text-danger">
                {flagCounts.open}
              </span>
            )}
          </label>
          {showFlags && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-1">
                {REASON_META.map((r) => {
                  const active = flagReasonFilter.includes(r.key);
                  const count = flagCounts?.[r.countKey] ?? 0;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => onFlagReasonToggle?.(r.key)}
                      title={r.hint}
                      className={
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                        (active
                          ? 'border-brand-600 bg-brand-tint text-brand-accent'
                          : 'border-border bg-card text-fg-muted hover:bg-sunken')
                      }
                    >
                      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} />
                      {r.short}
                      <span className="text-fg-subtle">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-fg-muted">Review status</div>
                <select
                  value={reviewStatus}
                  onChange={(e) => onReviewStatusChange?.(e.target.value)}
                  className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {REVIEW_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              {flagBulk?.show &&
                (!flagBulk.armed ? (
                  <button
                    type="button"
                    onClick={flagBulk.onArm}
                    className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm font-medium text-brand-accent hover:bg-sunken"
                  >
                    Review all matching…
                  </button>
                ) : (
                  <div className="space-y-2 rounded-md border border-brand-600 bg-brand-tint p-2.5">
                    <p className="text-xs text-fg">
                      {flagBulk.count == null ? (
                        'Counting matching flags…'
                      ) : (
                        <>
                          One decision for all <strong>{flagBulk.count.toLocaleString()}</strong>{' '}
                          flag{flagBulk.count === 1 ? '' : 's'} matching the current flag filters.
                        </>
                      )}
                    </p>
                    <input
                      type="text"
                      value={flagBulk.note}
                      onChange={(e) => flagBulk.onNote(e.target.value)}
                      placeholder="Add a shared note (optional)…"
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {BULK_ACTIONS.filter((a) => !a.reopenOnly || flagBulk.showReopen).map((a) => (
                        <button
                          key={a.status}
                          type="button"
                          disabled={!!flagBulk.busy || flagBulk.count == null || flagBulk.count === 0}
                          onClick={() => flagBulk.onAction(a.status)}
                          className={
                            'rounded border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ' +
                            (a.danger
                              ? 'border-danger bg-danger-tint text-danger hover:opacity-90'
                              : 'border-border bg-card text-fg hover:bg-sunken')
                          }
                        >
                          {flagBulk.busy === a.status ? 'Saving…' : a.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={!!flagBulk.busy}
                        onClick={flagBulk.onCancel}
                        className="rounded border border-transparent px-2 py-1 text-xs font-medium text-brand-accent hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              <p className="text-xs text-fg-subtle">
                Counts show open (unresolved) flags; use the status filter to view reviewed or
                dismissed ones.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Filters</h3>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brand-accent hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <SectionLabel>Status</SectionLabel>
        <div className="space-y-1.5">
          {statuses.map((s) => (
            <StatusChip
              key={s}
              status={s}
              active={statusFilter.includes(s)}
              onClick={() => toggleStatus(s)}
              color={statusColors[s]}
              label={statusLabels[s]}
              count={statusCounts ? statusCounts[s] ?? 0 : null}
              title={
                statusCounts
                  ? `${(statusCounts[s] ?? 0).toLocaleString()} doors with this status under your other filters (dates, canvasser, answer, walk list) — across the whole campaign, not just the area on screen`
                  : undefined
              }
            />
          ))}
        </div>
        {/* Zeros show once the counts exist — "0" says a click yields nothing; no number means
            "not loaded yet". Same convention as the flag-reason chips above. */}
        {statusCounts && (
          <p className="mt-1 text-[11px] text-fg-subtle">
            Counts are campaign-wide under your other filters — not just the doors on screen.
          </p>
        )}
        {/* Not a filter — an explanation. Doors sharing one geocode can't each have
            their own dot, so they're drawn as a building. Without this the map looks
            like it lost them. */}
        {buildingCount > 0 && (
          <p className="mt-2 rounded border border-border bg-sunken px-2 py-1.5 text-[11px] leading-snug text-fg-muted">
            🏢 <strong className="text-fg">{buildingCount.toLocaleString()}</strong> building
            {buildingCount === 1 ? '' : 's'} on screen hold{' '}
            <strong className="text-fg">{stackedDoorCount.toLocaleString()}</strong> doors on shared pins. Click one to
            see every door in it.
          </p>
        )}
      </div>

      {!hideCanvassers && (
        <div>
          <SectionLabel>Canvasser</SectionLabel>
          <select
            value={canvasserId}
            onChange={(e) => onCanvasserChange(e.target.value)}
            className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="">Any canvasser</option>
            {canvassers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </div>
      )}

      {choiceQuestions.length > 0 && (
        <div>
          <SectionLabel>Survey answer</SectionLabel>
          {/* The pill numbers are RESPONSES (one voter's answer), not doors — a household with
              three voters can carry three. Say so, or they look like they disagree with the
              door counts above. */}
          <p className="-mt-1 mb-2 text-[11px] text-fg-subtle">Counts are survey responses, not doors.</p>
          <div className="space-y-3">
            {choiceQuestions.map((q) => (
              <div key={q.key}>
                <div className="mb-1 text-xs font-medium text-fg-muted">{q.label}</div>
                <div className="flex flex-wrap gap-1">
                  {q.options.filter((opt) => !opt.retired).map((opt) => {
                    // Match on the stable id when there is one: the write-in chip reads "Other",
                    // and a real option can be named "Other" too — keyed on the label, both chips
                    // would highlight together and collide as React keys.
                    const active =
                      answerFilter?.questionKey === q.key &&
                      (opt.id != null
                        ? answerFilter?.optionId === opt.id
                        : answerFilter?.option === opt.option);
                    return (
                      <button
                        key={opt.id ?? `legacy:${opt.option}`}
                        type="button"
                        onClick={() => setAnswer(q.key, opt.option, opt.id)}
                        className={
                          'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                          (active
                            ? 'bg-brand-600 text-white'
                            : 'border border-border bg-card text-fg-muted hover:bg-sunken')
                        }
                        title={`${opt.count} responses (a door can have several)`}
                      >
                        {opt.option}
                        <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-fg-muted'}>
                          {opt.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
