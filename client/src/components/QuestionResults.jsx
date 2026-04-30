import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function VoterList({ questionKey, option, surveyTemplateId, dateRange }) {
  const queryString = buildQuery({
    questionKey,
    option,
    surveyTemplateId,
    from: dateRange?.from,
    to: dateRange?.to,
  });
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'reports',
      'voters-by-answer',
      questionKey,
      option,
      surveyTemplateId,
      dateRange?.from,
      dateRange?.to,
    ],
    queryFn: () => api(`/admin/reports/voters-by-answer${queryString}`),
  });

  if (isLoading) {
    return <div className="px-3 py-2 text-xs text-gray-500">Loading…</div>;
  }
  if (error) {
    return <div className="px-3 py-2 text-xs text-red-600">Error: {error.message}</div>;
  }
  if (!data?.voters?.length) {
    return <div className="px-3 py-2 text-xs text-gray-500">No voters.</div>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {data.voters.map((v) => (
        <li key={v.responseId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate text-gray-900">
              {v.voter?.fullName || 'Unknown'}
              {v.voter?.party && (
                <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {v.voter.party}
                </span>
              )}
            </div>
            {v.household && (
              <div className="truncate text-xs text-gray-500">
                {v.household.addressLine1}, {v.household.city}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right text-xs text-gray-500">
            {v.canvasser && (
              <div>
                {v.canvasser.firstName} {v.canvasser.lastName}
              </div>
            )}
            <div>{formatDate(v.submittedAt)}</div>
          </div>
        </li>
      ))}
    </ul>
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
        (expandable ? 'cursor-pointer rounded px-1 hover:bg-gray-50' : 'px-1')
      }
    >
      <div className="col-span-4 flex items-center gap-1 truncate text-gray-700" title={option}>
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
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-brand-500" style={{ width: `${width}%` }} />
        </div>
      </div>
      <div className="col-span-2 flex items-baseline justify-end gap-2">
        <span className="font-semibold text-gray-900">{percent.toFixed(1)}%</span>
        <span className="text-xs text-gray-500">({count})</span>
      </div>
    </button>
  );
}

function TextAnswers({ options }) {
  if (!options.length) {
    return <div className="text-sm text-gray-500">No responses yet.</div>;
  }
  return (
    <ul className="space-y-1">
      {options.map((o, i) => (
        <li
          key={i}
          className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 text-sm last:border-b-0"
        >
          <span className="text-gray-800">{o.option}</span>
          <span className="shrink-0 text-xs text-gray-500">{o.count}×</span>
        </li>
      ))}
    </ul>
  );
}

export default function QuestionResults({
  question,
  surveyTemplateId,
  dateRange,
}) {
  const { key, label, type, options = [] } = question;
  const totalAnswered = options.reduce((sum, o) => sum + (o.count || 0), 0);
  const [expandedOption, setExpandedOption] = useState(null);
  const expandable = type === 'single_choice' || type === 'multiple_choice';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-medium text-gray-900">{label}</h3>
        <span className="shrink-0 text-xs uppercase tracking-wide text-gray-500">
          {type.replace('_', ' ')} · {totalAnswered} answered
        </span>
      </div>
      {type === 'text' ? (
        <TextAnswers options={options} />
      ) : options.length === 0 ? (
        <div className="text-sm text-gray-500">No responses yet.</div>
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
                  <div className="mt-1 mb-2 rounded-md border border-gray-100 bg-gray-50">
                    <VoterList
                      questionKey={key}
                      option={o.option}
                      surveyTemplateId={surveyTemplateId}
                      dateRange={dateRange}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {expandable && (
        <div className="mt-2 text-xs text-gray-400">
          Click any option to see who selected it.
        </div>
      )}
    </div>
  );
}
