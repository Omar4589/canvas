import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

function formatDate(d, tz) {
  if (!d) return '';
  return formatInTz(d, tz, { month: 'short', day: 'numeric' }, false);
}

function VoterRow({ v, tz }) {
  return (
    <li className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="truncate text-fg">
          {v.voter?.fullName || 'Unknown'}
          {v.voter?.party && (
            <span className="ml-1.5 rounded bg-sunken px-1 py-0.5 text-xs text-fg-muted">
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
          <div className="truncate">
            {v.canvasser.firstName} {v.canvasser.lastName[0]}.
          </div>
        )}
        <div>{formatDate(v.submittedAt, tz)}</div>
      </div>
    </li>
  );
}

function OptionCard({ option, count, voters = [], onSeeAll, tz }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-border pb-2">
        <div className="truncate font-medium text-fg" title={option}>
          {option}
        </div>
        <span className="shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand-accent">
          {count}
        </span>
      </div>
      {voters.length === 0 ? (
        <div className="py-2 text-xs text-fg-muted">No voters yet.</div>
      ) : (
        <ul className="divide-y divide-border">
          {voters.map((v) => (
            <VoterRow key={v.responseId} v={v} tz={tz} />
          ))}
        </ul>
      )}
      {count > voters.length && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 self-start text-xs text-brand-accent hover:underline"
        >
          See all {count} →
        </button>
      )}
    </div>
  );
}

export default function VoterHighlights({ surveyResults, onSeeAll, tz }) {
  const orgTz = useOrgTimeZone();
  const zone = tz || orgTz;
  const questions = (surveyResults?.questions || []).filter(
    (q) => q.type === 'multiple_choice' && q.options.length > 0
  );

  if (!questions.length) return null;

  return (
    <div className="space-y-5">
      {questions.map((q) => (
        <div key={q.key}>
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-fg">{q.label}</h3>
            <p className="text-xs text-fg-muted">
              Latest voters per option — for follow-up calls, yard-sign drops, etc.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {q.options.map((opt) => (
              <OptionCard
                key={opt.option}
                option={opt.option}
                count={opt.count}
                voters={opt.voters || []}
                onSeeAll={() => onSeeAll?.(q.key, opt.option)}
                tz={zone}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
