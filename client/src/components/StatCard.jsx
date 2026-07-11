import Card from './ui/Card.jsx';
import InfoHint from './InfoHint.jsx';

// Token-based accents (flip automatically in dark mode). `text` colors the value; `rail` is the
// left accent stripe used only in the `prominent` (client-report) treatment.
const ACCENT = {
  green: { text: 'text-success', rail: 'bg-success' },
  red: { text: 'text-danger', rail: 'bg-danger' },
  amber: { text: 'text-warning', rail: 'bg-warning' },
  blue: { text: 'text-info', rail: 'bg-info' },
  brand: { text: 'text-brand-accent', rail: 'bg-brand-600' },
};

// A KPI card. The default look (label / 2xl value / muted hint) is unchanged and shared by the admin
// dashboards. The client report opts into a richer treatment via `prominent` (3xl value + a colored
// left rail) and `delta`/`deltaTone` (a "+N this week" pill instead of the plain hint). `compact`
// shortens the card (tighter padding + xl value) for dense KPI rows like the Overview. All extra
// props are additive — omitting them renders exactly as before. `help` adds an "(i)" tooltip next
// to the label explaining what the number counts (used by the client report).
export default function StatCard({ label, value, hint, accent, delta, deltaTone, prominent = false, compact = false, help }) {
  const a = ACCENT[accent] || {};
  const valueSize = prominent ? 'text-3xl' : compact ? 'text-xl' : 'text-2xl';
  return (
    <Card className={`relative overflow-hidden ${compact ? 'p-3' : 'p-4'}${prominent ? ' pl-5' : ''}`}>
      {prominent && (
        <span className={`absolute inset-y-0 left-0 w-1 ${a.rail || 'bg-border'}`} aria-hidden="true" />
      )}
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-fg-muted">
        <span>{label}</span>
        {help && <InfoHint label={`What "${label}" counts`}>{help}</InfoHint>}
      </div>
      <div
        className={`mt-1 ${valueSize} font-semibold tabular-nums ${a.text || 'text-fg'}`}
      >
        {value ?? '—'}
      </div>
      {delta ? (
        <span
          className={
            'mt-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ' +
            (deltaTone === 'up' ? 'bg-success-tint text-success' : 'bg-sunken text-fg-muted')
          }
        >
          {delta}
        </span>
      ) : (
        hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>
      )}
    </Card>
  );
}
