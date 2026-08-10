import Card from './ui/Card.jsx';
import InfoHint from './InfoHint.jsx';

// The "Voter groups" (tags) section of a client report — voter counts, NOT shares. Its own
// component rather than ReportBreakdown because that one unconditionally derives percents,
// and "400 identified · 380 still current" are overlapping people, not slices of a whole.
// `current` may be null (a report frozen before the current unit existed) — render identified
// alone rather than a fake "0 still current".
export default function ReportTagList({ title, subtitle, help, items = [] }) {
  if (!items.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3">
        <div className="flex items-center gap-1 text-sm font-semibold text-fg">
          <span>{title}</span>
          {help && <InfoHint label={`About ${title}`}>{help}</InfoHint>}
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-fg-muted">{subtitle}</div>}
      </div>
      <div className="divide-y divide-border">
        {items.map((t) => (
          <div key={t.label} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="truncate font-medium text-fg" title={t.label}>
              {t.label}
            </span>
            <span className="shrink-0 tabular-nums text-fg">
              <strong className="font-semibold">{t.identified.toLocaleString()}</strong>{' '}
              <span className="text-fg-muted">identified</span>
              {t.current != null && (
                <span className="text-fg-muted">
                  {' · '}
                  <strong className="font-semibold text-fg">{t.current.toLocaleString()}</strong>{' '}
                  still current
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
