import { useState } from 'react';

// Sticky action bar for bulk flag review (Audit page). Appears once ≥1 entry is selected;
// applies ONE decision (+ optional shared note) to the whole target set. Big or scope-wide
// actions confirm inline (CoordinatorConfirm's pattern — no modal), naming the exact count.
// The parent owns the target set and the POST; this component owns the choreography.
const ACTIONS = [
  { status: 'reviewed', label: 'Mark reviewed', confirm: (n) => `Mark ${n.toLocaleString()} reviewed` },
  { status: 'dismissed', label: 'Dismiss', confirm: (n) => `Dismiss ${n.toLocaleString()}` },
  {
    status: 'confirmed',
    label: 'Confirm issue',
    confirm: (n) => `Confirm ${n.toLocaleString()} as issues`,
    danger: true,
  },
  { status: 'open', label: 'Reopen', confirm: (n) => `Reopen ${n.toLocaleString()}` },
];

// Anything bigger than a screenful gets an explicit "yes, that many" step.
const CONFIRM_OVER = 25;

export default function BulkReviewBar({
  count,
  scopeMode = false, // acting on "all matching the filters", not a checkbox selection
  scopeCountLoading = false,
  note,
  onNoteChange,
  busy = null, // status currently posting, or null
  onAction,
  onClear,
  showReopen = false,
  // Offers "act on every flag matching the filters" (shown when the fetched list is capped,
  // so the checkboxes can't reach everything). The exact count arrives via the parent's dry
  // run once scope mode is entered — the link deliberately carries no number of its own.
  canSelectAllMatching = false,
  onSelectAllMatching,
}) {
  const [pending, setPending] = useState(null); // action awaiting inline confirmation

  function request(action) {
    if (busy) return;
    if (scopeMode || count > CONFIRM_OVER) {
      setPending(action);
    } else {
      onAction(action.status);
    }
  }

  function confirmPending() {
    if (!pending || busy) return;
    onAction(pending.status);
    setPending(null);
  }

  const actions = ACTIONS.filter((a) => a.status !== 'open' || showReopen);
  const headline = scopeMode
    ? scopeCountLoading
      ? 'Counting matching flags…'
      : `All ${count.toLocaleString()} matching the filters`
    : `${count.toLocaleString()} selected`;

  return (
    <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="w-full max-w-3xl rounded-lg border border-border bg-card p-3 shadow-lg">
        {pending ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg">
              {pending.confirm(count)} flag{count === 1 ? '' : 's'}?
              {scopeMode && (
                <span className="ml-1 text-fg-muted">This covers every flag matching the current filters.</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmPending}
                disabled={!!busy || scopeCountLoading}
                className={
                  'rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-50 ' +
                  (pending.danger ? 'bg-danger hover:opacity-90' : 'bg-brand-600 hover:bg-brand-700')
                }
              >
                {busy ? 'Saving…' : pending.confirm(count)}
              </button>
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={!!busy}
                className="rounded-md border border-border-strong bg-card px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-surface disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">{headline}</span>
            {!scopeMode && canSelectAllMatching && onSelectAllMatching && (
              <button
                type="button"
                onClick={onSelectAllMatching}
                className="text-xs font-medium text-brand-accent hover:underline"
              >
                Act on every flag matching the filters instead
              </button>
            )}
            <input
              type="text"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Add a shared note (optional)…"
              className="min-w-[10rem] flex-1 rounded border border-border bg-card px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <div className="flex flex-wrap gap-1.5">
              {actions.map((a) => (
                <button
                  key={a.status}
                  type="button"
                  disabled={!!busy || count === 0 || scopeCountLoading}
                  onClick={() => request(a)}
                  className={
                    'rounded border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ' +
                    (a.danger
                      ? 'border-danger bg-danger-tint text-danger hover:opacity-90'
                      : 'border-border bg-card text-fg hover:bg-sunken')
                  }
                >
                  {busy === a.status ? 'Saving…' : a.label}
                </button>
              ))}
              <button
                type="button"
                onClick={onClear}
                disabled={!!busy}
                className="rounded border border-transparent px-2 py-1.5 text-xs font-medium text-brand-accent hover:underline disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
