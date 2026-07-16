import { REASON_META, SEVERITY_META } from '../lib/flags.js';

// Per-canvasser flag breakdown, worst-first. Clicking a row toggles the drill-in filter to
// that canvasser (onSelect(userId)). `rows` is summary.byCanvasser from /admin/reports/flags.
export default function AuditSummaryTable({ rows = [], selectedUserId = '', onSelect }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center text-sm text-fg-muted">
        No flags for anyone in this range. 🎉
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 font-medium">Canvasser</th>
            <th className="px-3 py-2 text-right font-medium">Flagged</th>
            {REASON_META.map((r) => (
              <th key={r.key} className="px-3 py-2 text-right font-medium" title={r.label}>
                {r.short}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Open</th>
            <th className="px-3 py-2 text-right font-medium">Worst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const active = selectedUserId === r.userId;
            const sev = r.worstSeverity ? SEVERITY_META[r.worstSeverity] : null;
            return (
              <tr
                key={r.userId}
                onClick={() => onSelect?.(active ? '' : r.userId)}
                className={
                  'cursor-pointer border-b border-border last:border-0 transition-colors ' +
                  (active ? 'bg-brand-tint' : 'hover:bg-sunken')
                }
              >
                <td className="px-3 py-2 font-medium text-fg">{r.name || 'Canvasser'}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">{r.flaggedActions}</td>
                {/* Same REASON_META the headers map over — header/value can never desync
                    (the old hardcoded 4-cell list shifted every column when mock_gps landed). */}
                {REASON_META.map((m) => (
                  <td key={m.key} className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {r[m.countKey] || 0}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.openCount || 0}</td>
                <td className="px-3 py-2 text-right">
                  {sev ? (
                    <span className={'inline-block rounded-full px-2 py-0.5 text-xs font-medium ' + sev.chip}>
                      {sev.label}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
