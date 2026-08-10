import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { percentsTo100 } from '../lib/percent.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { Badge, IconChevronRight, Segmented } from './ui/index.js';
import AnswerCanvasserTable from './AnswerCanvasserTable.jsx';
import InfoHint from './InfoHint.jsx';
import ResponseDetailDrawer from './ResponseDetailDrawer.jsx';
import TagTeamTable from './TagTeamTable.jsx';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function formatDateTime(d, tz) {
  if (!d) return '';
  return formatInTz(
    d,
    tz,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' },
    true
  );
}

const PAGE_SIZE = 25;

function VoterList({
  questionKey,
  optionId,
  option,
  tag,
  surveyTemplateId,
  dateRange,
  campaignId,
  effortId,
  passId,
  coordinatorId,
  userId,
  tz,
  onOpenResponse,
}) {
  const [skip, setSkip] = useState(0);
  const [accumulated, setAccumulated] = useState([]);

  // A tag query is cross-question: it sends `tag` + `surveyTemplateId` instead of
  // questionKey/optionId/option.
  // Callers key <VoterList> on the identifying props (incl. userId/effortId/coordinatorId),
  // so a filter change remounts with fresh skip/accumulated state.
  const byTag = !!tag;

  const queryString = buildQuery(
    byTag
      ? {
          tag,
          surveyTemplateId,
          campaignId,
          effortId,
          passId,
          coordinatorId,
          userId,
          from: dateRange?.from,
          to: dateRange?.to,
          limit: PAGE_SIZE,
          skip,
        }
      : {
          questionKey,
          optionId,
          option,
          surveyTemplateId,
          campaignId,
          effortId,
          passId,
          coordinatorId,
          userId,
          from: dateRange?.from,
          to: dateRange?.to,
          limit: PAGE_SIZE,
          skip,
        }
  );
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'reports',
      'voters-by-answer',
      questionKey,
      optionId,
      option,
      tag,
      surveyTemplateId,
      campaignId,
      effortId,
      passId,
      coordinatorId,
      userId,
      dateRange?.from,
      dateRange?.to,
      skip,
    ],
    queryFn: () => api(`/admin/reports/voters-by-answer${queryString}`),
  });

  useEffect(() => {
    if (!data?.voters) return;
    setAccumulated((prev) => {
      if (skip === 0) return data.voters;
      const seen = new Set(prev.map((v) => v.responseId));
      return [...prev, ...data.voters.filter((v) => !seen.has(v.responseId))];
    });
  }, [data, skip]);

  if (isLoading && skip === 0) {
    return <div className="px-3 py-2 text-xs text-fg-muted">Loading…</div>;
  }
  if (error) {
    return <div className="px-3 py-2 text-xs text-danger">Error: {error.message}</div>;
  }
  if (!accumulated.length) {
    return <div className="px-3 py-2 text-xs text-fg-muted">No voters.</div>;
  }

  const total = data?.total ?? accumulated.length;
  const remaining = Math.max(total - accumulated.length, 0);

  return (
    <div>
      {/* The unit line — this list is ENTRIES, not people, and the difference is exactly what
          the tag bar above it counts differently. Without this line the tag drill reads
          "Showing 4" under a bar reading 3 and looks broken instead of honest. */}
      <div className="border-b border-border px-3 py-1.5 text-xs text-fg-subtle">
        {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'} — one per round; a voter
        surveyed in two rounds appears twice.
      </div>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {accumulated.map((v) => (
          <li
            key={v.responseId}
            onClick={() => onOpenResponse?.(v.responseId)}
            className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-card"
          >
            <div className="min-w-0">
              {/* The name is a real button so the drawer is reachable by keyboard — the row's
                  own onClick is a mouse affordance only and fires nothing on Enter. The party
                  chip and Offline badge are siblings now: inside the truncating name line they
                  were silently clipped off the end of a long name. */}
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenResponse?.(v.responseId);
                  }}
                  className="min-w-0 truncate text-left text-fg hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {v.voter?.fullName || 'Unknown'}
                </button>
                {v.voter?.party && (
                  <span className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                    {v.voter.party}
                  </span>
                )}
                {v.wasOfflineSubmission && (
                  <span className="shrink-0">
                    <Badge variant="info">Offline</Badge>
                  </span>
                )}
              </div>
              {v.household && (
                <div className="truncate text-xs text-fg-muted">
                  {v.household.addressLine1}, {v.household.city}
                </div>
              )}
              {/* What they actually answered. Load-bearing for the write-in bucket, where the
                  answer IS the typed text — a list of names alone said nothing about it. */}
              {v.answer && (
                <div className="truncate text-xs text-fg-muted" title={v.answer}>
                  {v.answer}
                </div>
              )}
              {v.note && (
                <div className="truncate text-xs italic text-fg-subtle" title={v.note}>
                  “{v.note}”
                </div>
              )}
            </div>
            <div className="shrink-0 text-right text-xs text-fg-muted">
              {v.canvasser && (
                <div>
                  {v.canvasser.firstName} {v.canvasser.lastName}
                </div>
              )}
              <div className="tabular-nums">{formatDateTime(v.submittedAt, tz)}</div>
              {v.household && (
                <Link
                  to={`/campaigns/${campaignId}/map?household=${v.household.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-brand-accent hover:underline"
                >
                  Map →
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
        <span className="text-fg-muted">
          Showing {accumulated.length} of {total} {total === 1 ? 'entry' : 'entries'}
        </span>
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setSkip(skip + PAGE_SIZE)}
            disabled={isLoading}
            className="rounded border border-border bg-card px-2 py-1 text-fg-muted hover:bg-sunken disabled:opacity-50"
          >
            {isLoading ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, remaining)} more`}
          </button>
        )}
      </div>
    </div>
  );
}

// Small canvasser <select> shared by the option/tag drills. `allMembers`, not `members`:
// the filter must list whoever RECORDED responses, even someone since deactivated.
function CanvasserSelect({ campaignId, value, onChange }) {
  const { allMembers } = useCampaignTeam(campaignId);
  const options = useMemo(
    () =>
      (allMembers || [])
        .map((m) => ({
          id: String(m.user.id),
          name: `${m.user.firstName || ''} ${m.user.lastName || ''}`.trim() || m.user.email,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allMembers]
  );
  if (!options.length) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Filter by canvasser"
      className="rounded border border-border bg-card px-2 py-1 text-xs text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <option value="">All canvassers</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

// The expanded-option drill: canvasser filter + Voters/By-canvasser toggle + the full-view
// link. Callers key this on the identifying filters, so local userId/view state resets when
// the surrounding filters change; userId is ALSO in the VoterList remount key below.
function OptionDrill({
  questionKey,
  optionId,
  option,
  surveyTemplateId,
  dateRange,
  campaignId,
  effortId,
  passId,
  coordinatorId,
  tz,
  onOpenResponse,
}) {
  const [userId, setUserId] = useState('');
  const [view, setView] = useState('voters');

  const fullViewHref = `/campaigns/${campaignId}/explorer${buildQuery({
    survey: surveyTemplateId,
    q: questionKey,
    optionId,
    option,
    from: dateRange?.from,
    to: dateRange?.to,
    // All time has no bounds — mark it, or the explorer defaults the link to Today.
    range: dateRange && !dateRange.from && !dateRange.to ? 'all' : '',
    userId,
    effortId,
    pass: passId,
    coordinatorId,
  })}`;

  const canvassersQ = useQuery({
    queryKey: [
      'reports',
      'answer-canvassers',
      campaignId,
      questionKey,
      optionId,
      option,
      surveyTemplateId,
      effortId,
      passId,
      coordinatorId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () =>
      api(
        `/admin/reports/answer-canvassers${buildQuery({
          questionKey,
          optionId,
          option,
          surveyTemplateId,
          campaignId,
          effortId,
          passId,
          coordinatorId,
          from: dateRange?.from,
          to: dateRange?.to,
        })}`
      ),
    enabled: view === 'canvassers',
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <CanvasserSelect campaignId={campaignId} value={userId} onChange={setUserId} />
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'voters', label: 'Voters' },
              { value: 'canvassers', label: 'By canvasser' },
            ]}
          />
        </div>
        <Link to={fullViewHref} className="text-xs font-medium text-brand-accent hover:underline">
          Open full view →
        </Link>
      </div>
      {view === 'canvassers' ? (
        <div className="p-2">
          {canvassersQ.isLoading ? (
            <div className="px-1 py-2 text-xs text-fg-muted">Loading…</div>
          ) : canvassersQ.error ? (
            <div className="px-1 py-2 text-xs text-danger">Error: {canvassersQ.error.message}</div>
          ) : (
            <AnswerCanvasserTable
              rows={canvassersQ.data?.rows || []}
              selectedUserId={userId}
              onSelect={(id) => {
                setUserId(id);
                setView('voters');
              }}
              tz={tz}
            />
          )}
        </div>
      ) : (
        <VoterList
          key={userId}
          questionKey={questionKey}
          optionId={optionId}
          option={option}
          surveyTemplateId={surveyTemplateId}
          dateRange={dateRange}
          campaignId={campaignId}
          effortId={effortId}
          passId={passId}
          coordinatorId={coordinatorId}
          userId={userId}
          tz={tz}
          onOpenResponse={onOpenResponse}
        />
      )}
    </div>
  );
}

// The expanded-tag drill: canvasser filter + full-view link, but NO by-canvasser toggle —
// tag counts are distinct voters across questions, which have no per-canvasser sum. The
// BY-TEAM table is the sanctioned split instead: first-finder attribution gives each voter
// exactly one team, so it partitions where a per-canvasser column could not. The drill's
// local canvasser filter deliberately does NOT feed the team table — narrowing a team split
// to one person would re-create the per-canvasser lie through the side door.
function TagDrill({ tag, surveyTemplateId, dateRange, campaignId, effortId, passId, coordinatorId, tz, onOpenResponse }) {
  const [userId, setUserId] = useState('');

  const fullViewHref = `/campaigns/${campaignId}/explorer${buildQuery({
    tag,
    survey: surveyTemplateId,
    from: dateRange?.from,
    to: dateRange?.to,
    // All time has no bounds — mark it, or the explorer defaults the link to Today.
    range: dateRange && !dateRange.from && !dateRange.to ? 'all' : '',
    userId,
    effortId,
    pass: passId,
    coordinatorId,
  })}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <CanvasserSelect campaignId={campaignId} value={userId} onChange={setUserId} />
        <Link to={fullViewHref} className="text-xs font-medium text-brand-accent hover:underline">
          Open full view →
        </Link>
      </div>
      <TagTeamTable
        campaignId={campaignId}
        tag={tag}
        surveyTemplateId={surveyTemplateId}
        effortId={effortId}
        passId={passId}
        coordinatorId={coordinatorId}
        dateRange={dateRange}
      />
      <VoterList
        key={userId}
        tag={tag}
        surveyTemplateId={surveyTemplateId}
        dateRange={dateRange}
        campaignId={campaignId}
        effortId={effortId}
        passId={passId}
        coordinatorId={coordinatorId}
        userId={userId}
        tz={tz}
        onOpenResponse={onOpenResponse}
      />
    </div>
  );
}

// One line, intrinsic widths. This is NOT the old `grid-cols-12` split (4 label / 6 bar / 2
// numbers): that failed because the tracks were fixed PROPORTIONS and the eleven `gap-3` gutters
// cost a flat 132px at every width, so a 568px card left the label ~168px — about 22 characters,
// hard-truncated — while the numbers overflowed their own 78px cell onto the bar. Here the label
// is the only `flex-1`, so it absorbs every spare pixel and everything else is intrinsic; the bar
// and number block therefore land on the same x in every row of a card, which is what makes the
// percentages read as a column.
//
// The bar is a fixed 96px column rather than a full-width band on its own line. That halves the
// row (50px → 32px) and follows the existing house idiom for a bar that accompanies a printed
// number: CampaignsTable's `h-1.5 w-16` beside the knocked count, CoverageBar's and PassManager's
// `h-2 w-40` beside their text. (Mobile's opposite rule — RowBar always full-width — is an
// inset-group idiom for ~44px touch rows; a web results card is scanned in bulk.) `h-2` costs
// nothing vertically: at `items-center` the 20px text line box governs the row height.
// Children are spans, not divs: a <button>'s content model is phrasing content.
function OptionRow({
  option,
  count,
  percent,
  expanded,
  onToggle,
  expandable,
  retired,
}) {
  const width = Math.max(0, Math.min(100, percent || 0));
  return (
    <button
      type="button"
      onClick={expandable ? onToggle : undefined}
      disabled={!expandable}
      aria-expanded={expandable ? expanded : undefined}
      className={
        'block w-full rounded px-2 py-1.5 text-left text-sm ' +
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ' +
        (expandable ? 'cursor-pointer hover:bg-sunken' : '')
      }
    >
      <span className="flex items-center gap-3">
        {expandable && (
          <IconChevronRight
            size={14}
            className={
              'shrink-0 text-fg-subtle transition-transform ' + (expanded ? 'rotate-90' : '')
            }
          />
        )}
        {/* No `truncate` — a label that outgrows its share WRAPS, growing this row alone to two
            lines, and line-clamp-2 is only the ceiling behind `title`. At a 780px card the label
            gets ~460px (≈66 characters), so every real option fits on one line.
            The label keeps full-strength color even when retired: the row used to carry
            opacity-50, which dropped the label to 1.98:1 and the chip to 1.50:1. The Badge is
            what marks the state now — a legible label with a badge beats an illegible one. */}
        <span className="line-clamp-2 min-w-0 flex-1 text-fg-muted" title={option}>
          {option}
        </span>
        {retired && (
          // Badge destructures {variant, dot, className, children} with no ...rest, so a title
          // handed to it is dropped — it has to live on the wrapper.
          <span className="shrink-0" title="This option is no longer asked">
            <Badge variant="neutral">Retired</Badge>
          </span>
        )}
        {/* bg-border, not bg-sunken: docs/THEMING.md measures sunken-on-card at 1.10:1 light and
            1.04:1 dark, so a short bar had no visible track to be read against. */}
        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-border">
          <span
            // A retired option's bar goes neutral rather than brand — fg-muted, not fg-subtle,
            // which would sit at ~1.9:1 against the track and read as an empty bar.
            className={'block h-full rounded-full ' + (retired ? 'bg-fg-muted' : 'bg-brand-600')}
            // A px floor, not a percentage floor: 1.5% of a 300px card and 1.5% of a 750px card
            // are different marks, 3px is not. Conditioned on a real count, so a true zero still
            // paints nothing — a 0.1% answer used to round sub-pixel and rounded-full clipped it.
            style={{ width: `${width}%`, minWidth: count > 0 ? '3px' : 0 }}
          />
        </span>
        {/* Fixed tabular tracks: `justify-end` used to anchor the trailing (count), so a
            3-digit count shoved the percent left of a 2-digit one and no column edge existed.
            3.5rem clears "100.0%" at 14px semibold. These are min-widths, not widths: a wider
            value grows its own track rather than overflowing, losing the shared edge on that one
            row instead of printing outside the card the way the old fixed cell did. */}
        <span className="min-w-[3.5rem] shrink-0 text-right font-semibold tabular-nums text-fg">
          {width.toFixed(1)}%
        </span>
        <span className="min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums text-fg-muted">
          ({(count || 0).toLocaleString()})
        </span>
      </span>
    </button>
  );
}

// Same one-line grammar as OptionRow, with the "N voters · M current" cluster standing in for the
// two number tracks — it is the widest text on this surface, which is exactly why a fixed
// proportional cell never fitted it.
function TagRow({ tag, voterCount, currentVoterCount, percent, expanded, onToggle }) {
  const width = Math.max(0, Math.min(100, percent || 0));
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm hover:bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      <span className="flex items-center gap-3">
        <IconChevronRight
          size={14}
          className={'shrink-0 text-fg-subtle transition-transform ' + (expanded ? 'rotate-90' : '')}
        />
        <span className="line-clamp-2 min-w-0 flex-1 font-medium text-fg" title={tag}>
          {tag}
        </span>
        {/* The bar stays scaled to IDENTIFIED; current is text only — a second bar (or a percent)
            would assert a share these voter counts don't have. */}
        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-brand-600"
            style={{ width: `${width}%`, minWidth: voterCount > 0 ? '3px' : 0 }}
          />
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          <span className="font-semibold text-fg">{voterCount.toLocaleString()}</span>
          <span className="ml-1 text-xs text-fg-muted">voters</span>
          {/* Absent on an old server — render nothing rather than a fake "0 current". */}
          {currentVoterCount != null && (
            <span className="ml-1 text-xs text-fg-muted">
              · {currentVoterCount.toLocaleString()} current
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function TagResults({ tags = [], surveyTemplateId, dateRange, campaignId, effortId, passId, coordinatorId, tz, onTagClick }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const [expandedTag, setExpandedTag] = useState(null);
  const [detailId, setDetailId] = useState(null);

  if (!tags.length) return null;

  // Scale bars against the most-reached tag so they're visually comparable.
  const maxCount = Math.max(...tags.map((t) => t.voterCount || 0), 1);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">Tags</h3>
        <span className="shrink-0 text-xs uppercase tracking-wide text-fg-muted">
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
        </span>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Tags group answers across questions. <strong className="text-fg-muted">Voters</strong>{' '}
        counts everyone who ever gave a tagged answer — each person once.{' '}
        <strong className="text-fg-muted">Current</strong> counts the people whose most recent
        answer still carries the tag.
      </p>
      <div>
        {tags.map((t) => {
          const isOpen = expandedTag === t.tag;
          const percent = (100 * (t.voterCount || 0)) / maxCount;
          return (
            <div key={t.tag}>
              <TagRow
                tag={t.tag}
                voterCount={t.voterCount || 0}
                currentVoterCount={t.currentVoterCount ?? null}
                percent={percent}
                expanded={isOpen}
                onToggle={() =>
                  onTagClick ? onTagClick(t.tag) : setExpandedTag(isOpen ? null : t.tag)
                }
              />
              {/* ml-8 / pr-2 land on the row's own text origin (px-2 + a 14px chevron + gap-2)
                  and its right inset, so the sub-list is a true indent of the label above it. */}
              {(t.options || []).length > 0 && (
                <ul className="mb-1 ml-8 space-y-0.5 pr-2 text-xs text-fg-muted">
                  {t.options.map((o) => (
                    <li
                      key={`${o.questionKey}:${o.optionId}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="truncate" title={o.text}>{o.text}</span>
                      {/* Response-unit on purpose — a two-round voter's answer counts twice
                          here while the bar above counts them once. Say so. */}
                      <span className="shrink-0 text-fg-muted">
                        ({o.count} {o.count === 1 ? 'answer' : 'answers'})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {isOpen && !onTagClick && (
                <div className="mt-1 mb-2 rounded-md border border-border bg-sunken">
                  <TagDrill
                    key={`${t.tag}|${surveyTemplateId ?? ''}|${campaignId ?? ''}|${effortId ?? ''}|${passId ?? ''}|${coordinatorId ?? ''}|${dateRange?.from ?? ''}|${dateRange?.to ?? ''}`}
                    tag={t.tag}
                    surveyTemplateId={surveyTemplateId}
                    dateRange={dateRange}
                    campaignId={campaignId}
                    effortId={effortId}
                    passId={passId}
                    coordinatorId={coordinatorId}
                    tz={zone}
                    onOpenResponse={setDetailId}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* fg-muted, not fg-subtle: subtle measures 2.54:1 on card in light — under the 4.5:1
          floor for body-size instructional copy. */}
      <div className="mt-2 text-xs text-fg-muted">
        {onTagClick ? 'Click any tag to drill into it.' : 'Click any tag to see its voters and the by-team split.'}
      </div>
      {detailId && (
        <ResponseDetailDrawer
          responseId={detailId}
          campaignId={campaignId}
          tz={zone}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function TextAnswers({ options }) {
  if (!options.length) {
    return <div className="text-sm text-fg-muted">No responses yet.</div>;
  }
  return (
    <ul>
      {options.map((o, i) => (
        <li
          key={i}
          // px-2 matches the choice rows' inset, so a text card and a choice card sitting side
          // by side in the grid start their labels on the same line.
          className="flex items-start justify-between gap-3 border-b border-border px-2 py-2 text-sm last:border-b-0"
        >
          {/* min-w-0 + break-words: one unbroken write-in token used to run past the card edge. */}
          <span className="min-w-0 break-words text-fg">{o.option}</span>
          <span className="shrink-0 text-xs tabular-nums text-fg-muted">
            {(o.count || 0).toLocaleString()}×
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function QuestionResults({
  question,
  surveyTemplateId,
  dateRange,
  campaignId,
  effortId,
  passId,
  coordinatorId,
  tz,
}) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const { key, label, type, options = [] } = question;
  const isText = type === 'text';
  // Σ of the option counts — i.e. SELECTIONS, not people. On a multiple-choice question one
  // respondent picking three options adds three, so this exceeds the number of responses and each
  // percentage is a share of picks rather than a share of people. Same number the percentages
  // divide by, so the bars stay internally consistent either way.
  const totalAnswered = options.reduce((sum, o) => sum + (o.count || 0), 0);
  const multi = type === 'multiple_choice';
  // A text question's `options` are the server's TOP TEN distinct answers — reports.js caps that
  // aggregation at `$limit: 10` — so summing them and labelling it "answered" stated a number
  // that is simply wrong on any question with more than ten distinct write-ins. Describe the rows
  // we actually have instead, and say which case we're in.
  const textSummary =
    options.length >= 10
      ? 'top 10 answers'
      : `${options.length} distinct ${options.length === 1 ? 'answer' : 'answers'}`;
  // Round so the question's options total exactly 100.0% (largest-remainder, from the counts).
  const percents = percentsTo100(options.map((o) => o.count || 0));
  const [expandedOption, setExpandedOption] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const expandable = type === 'single_choice' || type === 'multiple_choice';

  return (
    // flex h-full flex-col: the card is now the grid item itself, so `stretch` reaches the
    // painted box and bottom borders line up across a row; the footer pins with mt-auto.
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-4">
      {/* One line, wrapping — not stacked. The house rule across the console is that a descriptive
          sentence stacks under its title while a short scope chip shares the line (TagResults does
          exactly that 100 lines down). Stacking cost every card a line; what actually caused the
          starving was `shrink-0` with no floor on the title, so `flex-wrap` + `basis-48` fixes it
          properly: the chip drops to its own line only when it genuinely cannot share.
          text-sm font-semibold is the console's in-card heading (ReportBreakdown, ReportTagList,
          SetupProgress, VoterHighlights, MapFilters…); the bare `font-medium` that used to be here
          was one of only two headings in client/src still inheriting 16px from body.
          InfoHint replaces a hover-only title=, unreachable by keyboard and touch; its trigger is
          16px tall, so it fits the text-xs line box without growing the row. */}
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="min-w-0 flex-1 basis-48 text-sm font-semibold text-fg">{label}</h3>
        <div className="inline-flex shrink-0 items-center gap-1 text-xs uppercase tracking-wide text-fg-muted">
          <span>
            {/* Global regex: replace('_',' ') only ever swapped the first underscore. */}
            {type.replace(/_/g, ' ')} ·{' '}
            {isText
              ? textSummary
              : `${totalAnswered.toLocaleString()} ${multi ? 'selections' : 'answered'}`}
          </span>
          <InfoHint label="What this counts">
            {isText
              ? 'The most common free-text answers, ranked by how often the same wording came back. The server returns at most ten, so this is not the number of people who answered.'
              : multi
                ? 'Counts SELECTIONS, not people — someone picking three options adds three. Percentages are a share of picks.'
                : 'Counts answers to this question. Survey the same person again in a later round and that is another answer.'}
          </InfoHint>
        </div>
      </div>
      {type === 'text' ? (
        <TextAnswers options={options} />
      ) : options.length === 0 ? (
        <div className="text-sm text-fg-muted">No responses yet.</div>
      ) : (
        <div>
          {options.map((o, idx) => {
            // Key on the stable id, not the label. Two buckets can legitimately share a label —
            // the write-in reads "Other", and nothing stops an operator naming a real option
            // "Other" too — and a label key would collide, so clicking one row expanded both,
            // mounting two drills under one heading.
            const rowKey = o.id ?? `legacy:${o.option}`;
            const isOpen = expandedOption === rowKey;
            return (
              <div key={rowKey}>
                <OptionRow
                  {...o}
                  percent={percents[idx]}
                  expandable={expandable}
                  expanded={isOpen}
                  onToggle={() => setExpandedOption(isOpen ? null : rowKey)}
                />
                {isOpen && (
                  <div className="mt-1 mb-2 rounded-md border border-border bg-sunken">
                    <OptionDrill
                      key={`${key}|${o.id ?? o.option}|${surveyTemplateId ?? ''}|${campaignId ?? ''}|${effortId ?? ''}|${passId ?? ''}|${coordinatorId ?? ''}|${dateRange?.from ?? ''}|${dateRange?.to ?? ''}`}
                      questionKey={key}
                      optionId={o.id}
                      option={o.option}
                      surveyTemplateId={surveyTemplateId}
                      dateRange={dateRange}
                      campaignId={campaignId}
                      effortId={effortId}
                      passId={passId}
                      coordinatorId={coordinatorId}
                      tz={zone}
                      onOpenResponse={setDetailId}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* mt-auto parks the hint on the card's bottom edge, so a card that stretches to a tall
          row's height reads as deliberate rather than as a card that stopped early. */}
      {expandable && (
        <div className="mt-auto pt-2 text-xs text-fg-muted">
          Click any option to see who selected it.
        </div>
      )}
      {detailId && (
        <ResponseDetailDrawer
          responseId={detailId}
          campaignId={campaignId}
          tz={zone}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
