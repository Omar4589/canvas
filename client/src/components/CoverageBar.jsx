import Card from './ui/Card.jsx';

// Status colors mirror mobile/lib/theme.js so admin and canvasser see the
// same color for the same status across surfaces. The vivid 500-level status
// hues read on both light and dark surfaces; only the chrome uses tokens.
const SEGMENTS = [
  { key: 'surveyed', label: 'Surveyed', color: 'bg-green-500' },
  { key: 'lit_dropped', label: 'Lit dropped', color: 'bg-purple-500' },
  { key: 'not_home', label: 'Not home', color: 'bg-blue-500' },
  { key: 'wrong_address', label: 'Wrong address', color: 'bg-red-500' },
  { key: 'voted', label: 'Voted', color: 'bg-teal-500' },
  { key: 'unknocked', label: 'Unknocked', color: 'bg-gray-400' },
];

export default function CoverageBar({ canvass = {} }) {
  const total = SEGMENTS.reduce((sum, s) => sum + (canvass[s.key] || 0), 0);

  if (total === 0) {
    return <Card className="p-4 text-sm text-fg-muted">No households yet.</Card>;
  }

  return (
    <Card className="p-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken">
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
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.color}`} />
              <span className="text-fg-muted">{s.label}</span>
              <span className="font-semibold tabular-nums text-fg">{count.toLocaleString()}</span>
              <span className="tabular-nums text-fg-subtle">({pct.toFixed(1)}%)</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
