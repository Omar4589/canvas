function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function CanvasserTable({ rows = [], onRowClick }) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        No canvasser activity in this range.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-2 font-medium">Canvasser</th>
            <th className="px-4 py-2 text-right font-medium">Surveys</th>
            <th className="px-4 py-2 text-right font-medium">Lit drops</th>
            <th className="px-4 py-2 text-right font-medium">Not home</th>
            <th className="px-4 py-2 text-right font-medium">Wrong addr</th>
            <th className="px-4 py-2 text-right font-medium">Homes knocked</th>
            <th className="px-4 py-2 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr
              key={r.userId}
              onClick={() => onRowClick?.(r)}
              className="cursor-pointer transition-colors hover:bg-gray-50"
            >
              <td className="px-4 py-2">
                <div className="font-medium text-gray-900">
                  {r.firstName} {r.lastName}
                  {!r.isActive && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{r.email}</div>
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                {r.surveysSubmitted}
              </td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{r.litDropped || 0}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{r.notHome}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{r.wrongAddress}</td>
              <td className="px-4 py-2 text-right tabular-nums text-gray-700">{r.homesKnocked}</td>
              <td className="px-4 py-2 text-right text-xs text-gray-500">
                {formatDate(r.lastActivityAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
