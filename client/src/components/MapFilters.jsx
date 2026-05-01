const STATUSES = ['surveyed', 'lit_dropped', 'not_home', 'wrong_address', 'unknocked'];

function StatusChip({ status, active, count, onClick, color, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-sm transition-colors ' +
        (active
          ? 'border-brand-600 bg-brand-50 text-brand-700'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50')
      }
    >
      <span className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {label}
      </span>
      {count != null && <span className="text-xs text-gray-500">{count}</span>}
    </button>
  );
}

function SectionLabel({ children }) {
  return (
    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
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
  showCanvasserPins = false,
  onShowCanvasserPinsChange,
}) {
  function toggleStatus(s) {
    if (statusFilter.includes(s)) onStatusChange(statusFilter.filter((x) => x !== s));
    else onStatusChange([...statusFilter, s]);
  }

  const choiceQuestions =
    survey?.questions?.filter((q) => q.type === 'single_choice' || q.type === 'multiple_choice') ||
    [];

  function setAnswer(questionKey, option) {
    if (
      answerFilter?.questionKey === questionKey &&
      answerFilter?.option === option
    ) {
      onAnswerChange({ questionKey: '', option: '' });
    } else {
      onAnswerChange({ questionKey, option });
    }
  }

  function clearAll() {
    onStatusChange([]);
    onCanvasserChange('');
    onAnswerChange({ questionKey: '', option: '' });
  }

  const hasActiveFilters =
    statusFilter.length > 0 ||
    canvasserId ||
    (answerFilter?.questionKey && answerFilter?.option);

  return (
    <div className="space-y-5">
      <div>
        <SectionLabel>Layers</SectionLabel>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showCanvasserPins}
            onChange={(e) => onShowCanvasserPinsChange?.(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
          />
          <span className="text-gray-800">Show canvasser locations</span>
        </label>
        <div className="mt-1 text-xs text-gray-500">
          Where each survey, not-home, or wrong-address was submitted from.
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-brand-600 hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <div>
        <SectionLabel>Status</SectionLabel>
        <div className="space-y-1.5">
          {STATUSES.map((s) => (
            <StatusChip
              key={s}
              status={s}
              active={statusFilter.includes(s)}
              onClick={() => toggleStatus(s)}
              color={statusColors[s]}
              label={statusLabels[s]}
            />
          ))}
        </div>
      </div>

      <div>
        <SectionLabel>Canvasser</SectionLabel>
        <select
          value={canvasserId}
          onChange={(e) => onCanvasserChange(e.target.value)}
          className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
        >
          <option value="">Any canvasser</option>
          {canvassers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
      </div>

      {choiceQuestions.length > 0 && (
        <div>
          <SectionLabel>Survey answer</SectionLabel>
          <div className="space-y-3">
            {choiceQuestions.map((q) => (
              <div key={q.key}>
                <div className="mb-1 text-xs font-medium text-gray-700">{q.label}</div>
                <div className="flex flex-wrap gap-1">
                  {q.options.map((opt) => {
                    const active =
                      answerFilter?.questionKey === q.key && answerFilter?.option === opt.option;
                    return (
                      <button
                        key={opt.option}
                        type="button"
                        onClick={() => setAnswer(q.key, opt.option)}
                        className={
                          'rounded-full px-2.5 py-1 text-xs transition-colors ' +
                          (active
                            ? 'bg-brand-600 text-white'
                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50')
                        }
                        title={`${opt.count} responses`}
                      >
                        {opt.option}
                        <span className={active ? 'ml-1 opacity-80' : 'ml-1 text-gray-500'}>
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
