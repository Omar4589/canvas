import { formatInTz } from '../lib/datetime.js';
import InfoHint from './InfoHint.jsx';

// Per-canvasser breakdown for ONE answer option, count-first. Clicking a row toggles the
// canvasser drill-in filter (onSelect(userId)). `rows` come from /admin/reports/answer-canvassers,
// which sums exactly to the option's survey-results count for identical filters.
export default function AnswerCanvasserTable({ rows = [], selectedUserId = '', onSelect, tz }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-sunken p-8 text-center text-sm text-fg-muted">
        No entries for this answer in this range.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Canvasser</th>
            <th className="px-3 py-2 text-right font-medium">Count</th>
            <th className="px-3 py-2 text-right font-medium">% of this answer</th>
            <th className="px-3 py-2 text-right font-medium">
              <span className="inline-flex items-center gap-1">
                % of their answers
                <InfoHint label="About % of their answers">
                  Of everything this canvasser recorded on this question, the share that is THIS
                  option. A high number means this answer dominates their own entries.
                </InfoHint>
              </span>
            </th>
            <th className="px-3 py-2 text-right font-medium">Last entry</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const active = selectedUserId === r.userId;
            const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || 'Canvasser';
            return (
              <tr
                key={r.userId}
                onClick={() => onSelect?.(active ? '' : r.userId)}
                className={
                  'cursor-pointer border-b border-border last:border-0 transition-colors ' +
                  (active ? 'bg-brand-tint' : 'hover:bg-sunken')
                }
              >
                <td className="px-3 py-2 tabular-nums text-fg-muted">{i + 1}</td>
                <td className="px-3 py-2 font-medium text-fg">
                  {name}
                  {r.status && r.status !== 'active' && (
                    <span className="ml-2 text-xs font-normal text-fg-subtle">{r.status}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-fg">
                  {(r.count || 0).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {(r.share ?? 0).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                  {(r.pctOfOwnAnswers ?? 0).toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-fg-muted">
                  {formatInTz(
                    r.lastAt,
                    tz,
                    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' },
                    true
                  ) || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
