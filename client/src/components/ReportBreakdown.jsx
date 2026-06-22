import Card from './ui/Card.jsx';
import { percentsTo100 } from '../lib/percent.js';

// A labeled breakdown (support / survey-answer / voter-contact) on a client report. items:
// [{ label, count, color? }]. Percent is ALWAYS derived here from each option's share of the
// group total (percentsTo100), so every chart sums to ~100% and old frozen reports self-heal
// without a republish. Two looks:
//   variant="bars"      — one mini track per option (default; used for plain survey questions)
//   variant="segmented" — a single stacked bar + a legend (used for the colored contact/support
//                         breakdowns, where the parts-of-a-whole reads better)
// Pass `emphasis` to ring it as the headline (support) card.

function Legend({ items, percents }) {
  return (
    <div className="space-y-1.5">
      {items.map((i, idx) => (
        <div key={i.label} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 text-fg-muted">
            <span
              className={'inline-block h-2.5 w-2.5 shrink-0 rounded-full ' + (i.color ? '' : 'bg-brand-600')}
              style={i.color ? { backgroundColor: i.color } : undefined}
            />
            {i.label}
          </span>
          <span className="tabular-nums font-semibold text-fg">
            {(i.count || 0).toLocaleString()}
            <span className="ml-1 font-normal text-fg-subtle">({percents[idx]}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SegmentedBar({ items, percents }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken">
        {items.map((i, idx) =>
          percents[idx] > 0 ? (
            <div
              key={i.label}
              className={'h-full ' + (i.color ? '' : 'bg-brand-600')}
              style={{ width: `${percents[idx]}%`, ...(i.color ? { backgroundColor: i.color } : {}) }}
              title={`${i.label}: ${percents[idx]}%`}
            />
          ) : null
        )}
      </div>
      <div className="mt-3">
        <Legend items={items} percents={percents} />
      </div>
    </div>
  );
}

function Bars({ items, percents }) {
  const max = Math.max(1, ...items.map((i) => i.count || 0));
  return (
    <div className="space-y-2.5">
      {items.map((i, idx) => (
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
              <span className="ml-1 font-normal text-fg-subtle">({percents[idx]}%)</span>
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
  );
}

export default function ReportBreakdown({ title, subtitle, items = [], emphasis = false, variant = 'bars' }) {
  const percents = percentsTo100(items.map((i) => i.count || 0));
  const total = items.reduce((s, i) => s + (i.count || 0), 0);
  const isEmpty = items.length === 0 || total === 0;
  return (
    <Card className={emphasis ? 'p-5 ring-1 ring-brand-600/30' : 'p-4'}>
      <div className="mb-3">
        <div className="text-sm font-semibold text-fg">{title}</div>
        {subtitle && <div className="mt-0.5 text-xs text-fg-muted">{subtitle}</div>}
      </div>
      {isEmpty ? (
        <div>
          <div className="h-3 w-full rounded-full bg-sunken" />
          <div className="mt-2 text-sm text-fg-muted">No responses yet.</div>
        </div>
      ) : variant === 'segmented' ? (
        <SegmentedBar items={items} percents={percents} />
      ) : (
        <Bars items={items} percents={percents} />
      )}
    </Card>
  );
}
