import Card from './ui/Card.jsx';

// A labeled horizontal-bar breakdown (used for support / survey-answer / voter-contact
// breakdowns on client reports). items: [{ label, count, color? }]. Percent is ALWAYS derived
// here from the share of this group's total count — so every chart sums to ~100% and is
// consistent with the counts shown (and old frozen reports self-heal without a republish). Bars
// scale to the largest count. Pass `emphasis` to make it the headline (support) card.
export default function ReportBreakdown({ title, subtitle, items = [], emphasis = false }) {
  const max = Math.max(1, ...items.map((i) => i.count || 0));
  const total = items.reduce((s, i) => s + (i.count || 0), 0);
  const pct = (count) => (total ? Math.round(((count || 0) / total) * 1000) / 10 : 0);
  return (
    <Card className={emphasis ? 'p-5 ring-1 ring-brand-600/30' : 'p-4'}>
      <div className="mb-3">
        <div className="text-sm font-semibold text-fg">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-fg-muted">{subtitle}</div>}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-fg-muted">No responses yet.</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((i) => (
            <div key={i.label}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-fg-muted">
                  {i.color && (
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: i.color }}
                    />
                  )}
                  {i.label}
                </span>
                <span className="tabular-nums font-semibold text-fg">
                  {(i.count || 0).toLocaleString()}
                  <span className="ml-1 font-normal text-fg-subtle">({pct(i.count)}%)</span>
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-sunken">
                <div
                  className={'h-full rounded-full ' + (i.color ? '' : 'bg-brand-600')}
                  style={{
                    width: `${Math.max(2, ((i.count || 0) / max) * 100)}%`,
                    ...(i.color ? { backgroundColor: i.color } : {}),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
