// Table shell: card-wrapped, sticky frosted header, token dividers, row hover.
// Columns/rows stay per-page; this just standardizes the chrome.
//   <DataTable head={<><th>…</th></>}>{rows}</DataTable>
export default function DataTable({ head, children, className = '' }) {
  return (
    <div className={`overflow-hidden rounded-card border border-border bg-card shadow-card ${className}`}>
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 z-10 bg-sunken/90 backdrop-blur">
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            {head}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}
