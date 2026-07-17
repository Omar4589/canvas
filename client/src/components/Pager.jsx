// Shared Prev/Next pager for server-paginated lists (the persons.js contract: clamped skip/limit
// plus an exact countDocuments total). Renders "N–M of total"; the parent owns the skip state.
export default function Pager({ skip, limit, total, onChange, className = '' }) {
  return (
    <div className={`flex items-center justify-between text-sm text-fg-muted ${className}`}>
      <span>
        {total === 0 ? '0' : `${skip + 1}–${Math.min(skip + limit, total)}`} of {total}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(0, skip - limit))}
          disabled={skip === 0}
          className="rounded-md border border-border-strong px-3 py-1.5 disabled:opacity-50"
        >
          ‹ Prev
        </button>
        <button
          onClick={() => onChange(skip + limit)}
          disabled={skip + limit >= total}
          className="rounded-md border border-border-strong px-3 py-1.5 disabled:opacity-50"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}
