function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

export function rangeFromId(id) {
  const now = new Date();
  if (id === 'today') {
    return { from: startOfDay(now).toISOString(), to: null };
  }
  if (id === '7d') {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString(), to: null };
  }
  if (id === '30d') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: null };
  }
  return { from: null, to: null };
}

export default function DateRangeSelector({ value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm shadow-sm">
      {RANGE_PRESETS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={
              'rounded px-3 py-1 transition-colors ' +
              (active
                ? 'bg-brand-600 text-white'
                : 'text-gray-700 hover:bg-gray-100')
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
