import Card from './ui/Card.jsx';

// Token-based: accent uses the semantic color tokens (flip automatically), so no
// dark: variants needed.
const ACCENT = {
  green: 'text-success',
  red: 'text-danger',
  amber: 'text-warning',
  blue: 'text-info',
  brand: 'text-brand-accent',
};

export default function StatCard({ label, value, hint, accent }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${ACCENT[accent] || 'text-fg'}`}>
        {value ?? '—'}
      </div>
      {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
    </Card>
  );
}
