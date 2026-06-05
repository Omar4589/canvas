import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function formatDate(d, tz) {
  if (!d) return '';
  return formatInTz(d, tz, { month: 'short', day: 'numeric' }, false);
}

const PAGE_SIZE = 25;

function VoterList({ questionKey, option, surveyTemplateId, dateRange, campaignId, tz }) {
  const [skip, setSkip] = useState(0);
  const [accumulated, setAccumulated] = useState([]);

  // Reset when filters change.
  useEffect(() => {
    setSkip(0);
    setAccumulated([]);
  }, [questionKey, option, surveyTemplateId, dateRange?.from, dateRange?.to, campaignId]);

  const queryString = buildQuery({
    questionKey,
    option,
    surveyTemplateId,
    campaignId,
    from: dateRange?.from,
    to: dateRange?.to,
    limit: PAGE_SIZE,
    skip,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'reports',
      'voters-by-answer',
      questionKey,
      option,
      surveyTemplateId,
      campaignId,
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
          <li key={v.responseId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate text-fg">
                {v.voter?.fullName || 'Unknown'}
                {v.voter?.party && (
                  <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                    {v.voter.party}
                  </span>
                )}
              </div>
              {v.household && (
                <div className="truncate text-xs text-fg-muted">
                  {v.household.addressLine1}, {v.household.city}
                </div>
              )}
            </div>
            <div className="shrink-0 text-right text-xs text-fg-muted">
              {v.canvasser && (
                <div>
                  {v.canvasser.firstName} {v.canvasser.lastName}
                </div>
              )}
              <div>{formatDate(v.submittedAt, tz)}</div>
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

function OptionRow({
  option,
  count,
  percent,
  expanded,
  onToggle,
  expandable,
}) {
  const width = Math.max(0, Math.min(100, percent || 0));
  return (
    <button
      type="button"
      onClick={expandable ? onToggle : undefined}
      disabled={!expandable}
      className={
        'grid w-full grid-cols-12 items-center gap-3 py-1.5 text-left text-sm ' +
        (expandable ? 'cursor-pointer rounded px-1 hover:bg-sunken' : 'px-1')
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
  tz,
}) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const { key, label, type, options = [] } = question;
  const totalAnswered = options.reduce((sum, o) => sum + (o.count || 0), 0);
  const [expandedOption, setExpandedOption] = useState(null);
  const expandable = type === 'single_choice' || type === 'multiple_choice';

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-fg">{label}</h3>
        <span className="shrink-0 text-xs uppercase tracking-wide text-fg-muted">
          {type.replace('_', ' ')} · {totalAnswered} answered
        </span>
      </div>
      {type === 'text' ? (
        <TextAnswers options={options} />
      ) : options.length === 0 ? (
        <div className="text-sm text-fg-muted">No responses yet.</div>
      ) : (
        <div>
          {options.map((o) => {
            const isOpen = expandedOption === o.option;
            return (
              <div key={o.option}>
                <OptionRow
                  {...o}
                  expandable={expandable}
                  expanded={isOpen}
                  onToggle={() => setExpandedOption(isOpen ? null : o.option)}
                />
                {isOpen && (
                  <div className="mt-1 mb-2 rounded-md border border-border bg-sunken">
                    <VoterList
                      questionKey={key}
                      option={o.option}
                      surveyTemplateId={surveyTemplateId}
                      dateRange={dateRange}
                      campaignId={campaignId}
                      tz={zone}
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
    </div>
  );
}
