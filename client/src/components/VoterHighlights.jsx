function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function VoterRow({ v }) {
  return (
    <li className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="truncate text-gray-900">
          {v.voter?.fullName || 'Unknown'}
          {v.voter?.party && (
            <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 text-xs text-gray-600">
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
          <div className="truncate">
            {v.canvasser.firstName} {v.canvasser.lastName[0]}.
          </div>
        )}
        <div>{formatDate(v.submittedAt)}</div>
      </div>
    </li>
  );
}

function OptionCard({ option, count, voters = [], onSeeAll }) {
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-gray-100 pb-2">
        <div className="truncate font-medium text-gray-900" title={option}>
          {option}
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {count}
        </span>
      </div>
      {voters.length === 0 ? (
        <div className="py-2 text-xs text-gray-500">No voters yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {voters.map((v) => (
            <VoterRow key={v.responseId} v={v} />
          ))}
        </ul>
      )}
      {count > voters.length && (
        <button
          type="button"
          onClick={onSeeAll}
          className="mt-2 self-start text-xs text-brand-600 hover:underline"
        >
          See all {count} →
        </button>
      )}
    </div>
  );
}

export default function VoterHighlights({ surveyResults, onSeeAll }) {
  const questions = (surveyResults?.questions || []).filter(
    (q) => q.type === 'multiple_choice' && q.options.length > 0
  );

  if (!questions.length) return null;

  return (
    <div className="space-y-5">
      {questions.map((q) => (
        <div key={q.key}>
          <div className="mb-2">
            <h3 className="text-sm font-semibold text-gray-900">{q.label}</h3>
            <p className="text-xs text-gray-500">
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
