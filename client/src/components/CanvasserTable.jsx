import { ratePct } from '../lib/rates.js';
import { formatInTz } from '../lib/datetime.js';

export default function CanvasserTable({ rows = [], onRowClick, tz }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-fg-muted">
        No canvasser activity in this range.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-sunken text-left text-xs uppercase tracking-wide text-fg-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Canvasser</th>
            <th className="px-4 py-2 text-right font-medium">Surveys</th>
            <th className="px-4 py-2 text-right font-medium">Lit drops</th>
            <th className="px-4 py-2 text-right font-medium">Not home</th>
            <th className="px-4 py-2 text-right font-medium">Wrong addr</th>
            <th className="px-4 py-2 text-right font-medium">Knocks</th>
            <th className="px-4 py-2 text-right font-medium">Connection</th>
            <th className="px-4 py-2 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr
              key={r.userId}
              onClick={() => onRowClick?.(r)}
              className="cursor-pointer transition-colors hover:bg-sunken"
            >
              <td className="px-4 py-2">
                <div className="font-medium text-fg">
                  {r.firstName} {r.lastName}
                  {!r.isActive && (
                    <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-fg-muted">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-fg-muted">{r.email}</div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-fg">
                {r.surveysSubmitted}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">{r.litDropped || 0}</td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">{r.notHome}</td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">{r.wrongAddress}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-fg">
                {r.knocks ?? r.homesKnocked}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                {r.connectionRate != null ? ratePct(r.connectionRate) : '—'}
              </td>
              <td className="px-4 py-2 text-right text-xs text-fg-muted">
                {formatInTz(r.lastActivityAt, tz) || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
