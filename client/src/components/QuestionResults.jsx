function OptionRow({ option, count, percent }) {
  const width = Math.max(0, Math.min(100, percent || 0));
  return (
    <div className="grid grid-cols-12 items-center gap-3 py-1.5 text-sm">
      <div className="col-span-4 truncate text-gray-700" title={option}>
        {option}
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
    </div>
  );
}

function TextAnswers({ options }) {
  if (!options.length) {
    return <div className="text-sm text-gray-500">No responses yet.</div>;
  }
  return (
    <ul className="space-y-1">
      {options.map((o, i) => (
        <li key={i} className="flex items-start justify-between gap-3 border-b border-gray-100 py-1.5 text-sm last:border-b-0">
          <span className="text-gray-800">{o.option}</span>
          <span className="shrink-0 text-xs text-gray-500">{o.count}×</span>
        </li>
      ))}
    </ul>
  );
}

export default function QuestionResults({ question }) {
  const { label, type, options = [] } = question;
  const totalAnswered = options.reduce((sum, o) => sum + (o.count || 0), 0);

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
          {options.map((o) => (
            <OptionRow key={o.option} {...o} />
          ))}
        </div>
      )}
    </div>
  );
}
