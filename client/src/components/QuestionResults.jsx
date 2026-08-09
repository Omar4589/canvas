import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { percentsTo100 } from '../lib/percent.js';
import { useCampaignTeam } from '../lib/useCampaignTeam.js';
import { Badge, Segmented } from './ui/index.js';
import AnswerCanvasserTable from './AnswerCanvasserTable.jsx';
import ResponseDetailDrawer from './ResponseDetailDrawer.jsx';

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
  userId,
  tz,
  onOpenResponse,
}) {
  const [skip, setSkip] = useState(0);
  const [accumulated, setAccumulated] = useState([]);

  // A tag query is cross-question: it sends `tag` + `surveyTemplateId` instead of
  // questionKey/optionId/option.
  // Callers key <VoterList> on the identifying props (incl. userId/effortId), so a
  // filter change remounts with fresh skip/accumulated state.
  const byTag = !!tag;

  const queryString = buildQuery(
    byTag
      ? {
          tag,
          surveyTemplateId,
          campaignId,
          effortId,
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
      <ul className="max-h-80 divide-y divide-border overflow-y-auto">
        {accumulated.map((v) => (
          <li
            key={v.responseId}
            onClick={() => onOpenResponse?.(v.responseId)}
            className="flex cursor-pointer items-start justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-card"
          >
            <div className="min-w-0">
              <div className="truncate text-fg">
                {v.voter?.fullName || 'Unknown'}
                {v.voter?.party && (
                  <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                    {v.voter.party}
                  </span>
                )}
                {v.wasOfflineSubmission && (
                  <Badge variant="info" className="ml-2">
                    Offline
                  </Badge>
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
          Showing {accumulated.length} of {total}
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
          userId={userId}
          tz={tz}
          onOpenResponse={onOpenResponse}
        />
      )}
    </div>
  );
}

// The expanded-tag drill: canvasser filter + full-view link, but NO by-canvasser toggle —
// tag counts are distinct voters across questions, which have no per-canvasser sum.
function TagDrill({ tag, surveyTemplateId, dateRange, campaignId, effortId, tz, onOpenResponse }) {
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
  })}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <CanvasserSelect campaignId={campaignId} value={userId} onChange={setUserId} />
        <Link to={fullViewHref} className="text-xs font-medium text-brand-accent hover:underline">
          Open full view →
        </Link>
      </div>
      <VoterList
        key={userId}
        tag={tag}
        surveyTemplateId={surveyTemplateId}
        dateRange={dateRange}
        campaignId={campaignId}
        effortId={effortId}
        userId={userId}
        tz={tz}
        onOpenResponse={onOpenResponse}
      />
    </div>
  );
}

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
      className={
        'grid w-full grid-cols-12 items-center gap-3 py-1.5 text-left text-sm ' +
        (expandable ? 'cursor-pointer rounded px-1 hover:bg-sunken' : 'px-1') +
        (retired ? ' opacity-50' : '')
      }
    >
      <div className="col-span-4 flex items-center gap-1 truncate text-fg-muted" title={option}>
        {expandable && (
          <span
            className={
              'inline-block transition-transform ' + (expanded ? 'rotate-90' : '')
            }
          >
            ▸
          </span>
        )}
        <span className="truncate">{option}</span>
        {retired && (
          <span
            className="shrink-0 rounded bg-sunken px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-subtle"
            title="This option is no longer asked"
          >
            retired
          </span>
        )}
      </div>
      <div className="col-span-6">
        <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full bg-brand-500" style={{ width: `${width}%` }} />
        </div>
      </div>
      <div className="col-span-2 flex items-baseline justify-end gap-2">
        <span className="font-semibold text-fg">{percent.toFixed(1)}%</span>
        <span className="text-xs text-fg-muted">({count})</span>
      </div>
    </button>
  );
}

function TagRow({ tag, voterCount, percent, expanded, onToggle }) {
  const width = Math.max(0, Math.min(100, percent || 0));
  return (
    <button
      type="button"
      onClick={onToggle}
      className="grid w-full grid-cols-12 items-center gap-3 py-1.5 text-left text-sm cursor-pointer rounded px-1 hover:bg-sunken"
    >
      <div className="col-span-4 flex items-center gap-1 truncate text-fg" title={tag}>
        <span className={'inline-block transition-transform ' + (expanded ? 'rotate-90' : '')}>
          ▸
        </span>
        <span className="truncate font-medium">{tag}</span>
      </div>
      <div className="col-span-6">
        <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
          <div className="h-full bg-brand-500" style={{ width: `${width}%` }} />
        </div>
      </div>
      <div className="col-span-2 flex items-baseline justify-end gap-2">
        <span className="font-semibold text-fg">{voterCount.toLocaleString()}</span>
      </div>
    </button>
  );
}

export function TagResults({ tags = [], surveyTemplateId, dateRange, campaignId, effortId, tz }) {
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
        <h3 className="font-medium text-fg">Tags</h3>
        <span className="shrink-0 text-xs uppercase tracking-wide text-fg-muted">
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'}
        </span>
      </div>
      <p className="mb-3 text-xs text-fg-muted">
        Tags group answers across questions. Counts are distinct voters reached.
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
                percent={percent}
                expanded={isOpen}
                onToggle={() => setExpandedTag(isOpen ? null : t.tag)}
              />
              {(t.options || []).length > 0 && (
                <ul className="mb-1 ml-6 space-y-0.5 text-xs text-fg-subtle">
                  {t.options.map((o) => (
                    <li
                      key={`${o.questionKey}:${o.optionId}`}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="truncate" title={o.text}>{o.text}</span>
                      <span className="shrink-0 text-fg-muted">({o.count})</span>
                    </li>
                  ))}
                </ul>
              )}
              {isOpen && (
                <div className="mt-1 mb-2 rounded-md border border-border bg-sunken">
                  <TagDrill
                    key={`${t.tag}|${surveyTemplateId ?? ''}|${campaignId ?? ''}|${effortId ?? ''}|${dateRange?.from ?? ''}|${dateRange?.to ?? ''}`}
                    tag={t.tag}
                    surveyTemplateId={surveyTemplateId}
                    dateRange={dateRange}
                    campaignId={campaignId}
                    effortId={effortId}
                    tz={zone}
                    onOpenResponse={setDetailId}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-fg-subtle">
        Click any tag to see the voters reached.
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
    <ul className="space-y-1">
      {options.map((o, i) => (
        <li
          key={i}
          className="flex items-start justify-between gap-3 border-b border-border py-1.5 text-sm last:border-b-0"
        >
          <span className="text-fg">{o.option}</span>
          <span className="shrink-0 text-xs text-fg-muted">{o.count}×</span>
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
  tz,
}) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const { key, label, type, options = [] } = question;
  // Σ of the option counts — i.e. SELECTIONS, not people. On a multiple-choice question one
  // respondent picking three options adds three, so this exceeds the number of responses and each
  // percentage is a share of picks rather than a share of people. Same number the percentages
  // divide by, so the bars stay internally consistent either way.
  const totalAnswered = options.reduce((sum, o) => sum + (o.count || 0), 0);
  const multi = type === 'multiple_choice';
  // Round so the question's options total exactly 100.0% (largest-remainder, from the counts).
  const percents = percentsTo100(options.map((o) => o.count || 0));
  const [expandedOption, setExpandedOption] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const expandable = type === 'single_choice' || type === 'multiple_choice';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-fg">{label}</h3>
        <span
          className="shrink-0 text-xs uppercase tracking-wide text-fg-muted"
          title={
            multi
              ? 'Counts SELECTIONS, not people — someone picking three options adds three. Percentages are a share of picks.'
              : 'Counts answers to this question. Survey the same person again in a later round and that is another answer.'
          }
        >
          {type.replace('_', ' ')} · {totalAnswered} {multi ? 'selections' : 'answered'}
        </span>
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
                      key={`${key}|${o.id ?? o.option}|${surveyTemplateId ?? ''}|${campaignId ?? ''}|${effortId ?? ''}|${dateRange?.from ?? ''}|${dateRange?.to ?? ''}`}
                      questionKey={key}
                      optionId={o.id}
                      option={o.option}
                      surveyTemplateId={surveyTemplateId}
                      dateRange={dateRange}
                      campaignId={campaignId}
                      effortId={effortId}
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
      {expandable && (
        <div className="mt-2 text-xs text-fg-subtle">
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
