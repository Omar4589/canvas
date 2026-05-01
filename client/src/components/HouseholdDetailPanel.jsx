function formatDateTime(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatAnswer(answer) {
  if (answer == null || answer === '') return '—';
  if (Array.isArray(answer)) return answer.length ? answer.join(', ') : '—';
  return String(answer);
}

function actionLabel(t) {
  switch (t) {
    case 'not_home':
      return 'Not home';
    case 'wrong_address':
      return 'Wrong address';
    case 'survey_submitted':
      return 'Survey submitted';
    case 'lit_dropped':
      return 'Lit dropped';
    case 'note_added':
      return 'Note added';
    default:
      return t || '—';
  }
}

export default function HouseholdDetailPanel({
  household,
  onClose,
  statusColors,
  statusLabels,
}) {
  const h = household;
  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: statusColors[h.status] }}
            />
            <span className="text-xs uppercase tracking-wide text-gray-500">
              {statusLabels[h.status]}
            </span>
          </div>
          <div className="mt-1 truncate font-medium text-gray-900">{h.addressLine1}</div>
          {h.addressLine2 && (
            <div className="truncate text-sm text-gray-700">{h.addressLine2}</div>
          )}
          <div className="text-xs text-gray-500">
            {h.city}, {h.state} {h.zipCode}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
          </svg>
        </button>
      </div>

      {h.lastAction && (
        <div className="border-b border-gray-200 px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wide text-gray-500">Last action</div>
          <div className="mt-1 text-gray-900">{actionLabel(h.lastAction.actionType)}</div>
          <div className="text-xs text-gray-500">
            {formatDateTime(h.lastAction.timestamp)}
            {h.lastAction.canvasser && (
              <>
                {' · '}
                {h.lastAction.canvasser.firstName} {h.lastAction.canvasser.lastName}
              </>
            )}
          </div>
        </div>
      )}

      <div className="border-b border-gray-200 px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
          Voters ({h.voters?.length || 0})
        </div>
        {h.voters?.length ? (
          <ul className="space-y-1.5">
            {h.voters.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-gray-900">{v.fullName}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {v.party && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                      {v.party}
                    </span>
                  )}
                  {v.surveyStatus === 'surveyed' ? (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                      surveyed
                    </span>
                  ) : (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
                      not surveyed
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-gray-500">No voters on file.</div>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500">
          Surveys ({h.surveys?.length || 0})
        </div>
        {h.surveys?.length ? (
          <div className="space-y-3">
            {h.surveys.map((s) => (
              <div key={s.id} className="rounded border border-gray-200 p-3">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <div className="font-medium text-gray-900">
                    {s.voter?.fullName || 'Unknown voter'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatDateTime(s.submittedAt)}
                  </div>
                </div>
                {s.canvasser && (
                  <div className="mt-0.5 text-xs text-gray-500">
                    by {s.canvasser.firstName} {s.canvasser.lastName}
                  </div>
                )}
                {s.answers?.length > 0 && (
                  <dl className="mt-2 space-y-1">
                    {s.answers.map((a, i) => (
                      <div key={i} className="text-sm">
                        <dt className="text-xs text-gray-500">{a.questionLabel}</dt>
                        <dd className="text-gray-900">{formatAnswer(a.answer)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {s.note && (
                  <div className="mt-2 rounded bg-gray-50 px-2 py-1 text-xs italic text-gray-700">
                    “{s.note}”
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No surveys at this household yet.</div>
        )}
      </div>
    </div>
  );
}
