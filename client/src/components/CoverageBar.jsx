const SEGMENTS = [
  { key: 'surveyed', label: 'Surveyed', color: 'bg-green-500', dot: 'bg-green-500' },
  { key: 'lit_dropped', label: 'Lit dropped', color: 'bg-purple-500', dot: 'bg-purple-500' },
  { key: 'not_home', label: 'Not home', color: 'bg-amber-400', dot: 'bg-amber-400' },
  { key: 'wrong_address', label: 'Wrong address', color: 'bg-red-500', dot: 'bg-red-500' },
  { key: 'unknocked', label: 'Unknocked', color: 'bg-gray-300', dot: 'bg-gray-300' },
];

export default function CoverageBar({ canvass = {} }) {
  const total =
    (canvass.surveyed || 0) +
    (canvass.lit_dropped || 0) +
    (canvass.not_home || 0) +
    (canvass.wrong_address || 0) +
    (canvass.unknocked || 0);

  if (total === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500">
        No households yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
        {SEGMENTS.map((s) => {
          const count = canvass[s.key] || 0;
          const pct = (count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={s.key}
              className={s.color}
              style={{ width: `${pct}%` }}
              title={`${s.label}: ${count} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {SEGMENTS.map((s) => {
          const count = canvass[s.key] || 0;
          const pct = total ? (count / total) * 100 : 0;
          return (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.dot}`} />
              <span className="text-gray-700">{s.label}</span>
              <span className="font-semibold text-gray-900">{count.toLocaleString()}</span>
              <span className="text-gray-500">({pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
