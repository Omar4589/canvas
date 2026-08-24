import { useEffect, useState } from 'react';

// The shared "where do these doors go" picker for the Turf Cutting page's two bulk surfaces:
// the door lasso's "Move to book…" and the book panel's "Move doors to…". One deliberate step
// heavier than the panel's plain Merge (an explicit target choice + consequence copy before a
// bulk write) and deliberately NOT a typed gate — a move is re-doable door-for-door, unlike a
// desk restrict. Presentational: the page owns the selection, the mutation and the toast; on
// error the modal stays open with the server's sentence inline.
//
// Esc closes the modal and nothing else — capture phase + stopPropagation, because the page
// also listens for Esc to leave select mode / fullscreen (the RestrictDoorsModal rule).

const n = (v) => (v || 0).toLocaleString();
const s = (count, word, plural) => (count === 1 ? word : plural || `${word}s`);
const NEW_BOOK = '__new__';
const SEARCH_OVER = 6; // the sidebar's own list-search threshold

export default function MoveTargetModal({
  kind, // 'doors' (lasso selection) | 'books' (whole selected books → merge)
  count, // doors moving
  sourceLine = null, // "They leave “Book 2” (25) · 4 aren't in any book yet" (lib/moveTargets.js)
  note = null, // kind-specific consequence footnote, page-built
  candidates, // moveTargetCandidates() rows: { id, name, color, doors, draft, holdsSome, holdsAll }
  allowNew = true, // offer "New book…" (books flavor: only when >= 2 selected)
  passLabel = null, // "Walk list · Round N" — the round is never implicit
  pending = false,
  error = null,
  onCancel,
  onConfirm, // ({ toTurfId }) | ({ newName })
}) {
  // Nothing to pick from → the only possible target is a new book; pre-select it.
  const noCandidates = candidates.length === 0;
  const [choice, setChoice] = useState(noCandidates && allowNew ? NEW_BOOK : null);
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const q = search.trim().toLowerCase();
  const shown = q ? candidates.filter((c) => (c.name || '').toLowerCase().includes(q)) : candidates;
  const chosen = choice && choice !== NEW_BOOK ? candidates.find((c) => c.id === choice) : null;
  const name = newName.trim();
  const ready = choice === NEW_BOOK ? !!name : !!chosen;

  const confirmLabel = pending
    ? kind === 'books'
      ? 'Merging…'
      : 'Moving…'
    : choice === NEW_BOOK
    ? kind === 'books'
      ? `Create ${name ? `“${name}”` : 'new book'}`
      : `Move ${n(count)} to ${name ? `“${name}”` : 'a new book'}`
    : kind === 'books'
    ? `Merge into ${chosen ? `“${chosen.name}”` : '…'}`
    : `Move ${n(count)} ${s(count, 'door')}`;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-fg">
          Move {n(count)} {s(count, 'door')} to another book?
        </h3>
        {sourceLine && <p className="mt-2 text-sm text-fg-muted">{sourceLine}.</p>}
        {noCandidates && allowNew && (
          <p className="mt-2 text-sm text-fg-muted">This round has no other book — the doors go into a new one.</p>
        )}
        {noCandidates && !allowNew && (
          <p className="mt-2 text-sm text-fg-muted">
            There's no other book in this round to move these doors into.
          </p>
        )}

        {candidates.length > SEARCH_OVER && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a book…"
            className="mt-3 w-full rounded border border-border-strong bg-card px-3 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
          />
        )}

        {candidates.length > 0 && (
          <div className="mt-3 max-h-56 divide-y divide-border overflow-auto rounded-md border border-border">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-fg-subtle">No book matches “{search.trim()}”.</p>}
            {shown.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 px-3 py-2 text-sm ${
                  c.holdsAll ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-sunken'
                }`}
              >
                <input
                  type="radio"
                  name="move-target"
                  checked={choice === c.id}
                  disabled={c.holdsAll}
                  onChange={() => setChoice(c.id)}
                />
                {c.color && <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.color }} />}
                <span className="min-w-0 flex-1 truncate font-medium text-fg">{c.name}</span>
                {c.draft && (
                  <span className="shrink-0 rounded bg-sunken px-1 text-[9px] font-semibold uppercase text-fg-muted">
                    draft
                  </span>
                )}
                <span className="shrink-0 text-xs tabular-nums text-fg-muted">
                  {c.holdsAll
                    ? 'already holds all of these'
                    : c.holdsSome > 0
                    ? `${n(c.doors)} doors · holds ${n(c.holdsSome)} of these`
                    : `${n(c.doors)} ${s(c.doors, 'door')}`}
                </span>
              </label>
            ))}
          </div>
        )}

        {allowNew && !noCandidates && (
          <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 py-2 text-sm hover:bg-sunken">
            <input type="radio" name="move-target" checked={choice === NEW_BOOK} onChange={() => setChoice(NEW_BOOK)} />
            <span className="font-medium text-fg">New book…</span>
          </label>
        )}
        {choice === NEW_BOOK && (
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name the new book"
            autoFocus
            className="mt-2 w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
          />
        )}

        {note && <p className="mt-2 text-xs text-fg-subtle">{note}</p>}
        {passLabel && <p className="mt-1 text-xs text-fg-subtle">In {passLabel}.</p>}
        {error && <p className="mt-2 text-sm text-danger">{error.message}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-semibold text-fg-muted hover:bg-sunken">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(choice === NEW_BOOK ? { newName: name } : { toTurfId: choice })}
            disabled={pending || !ready}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
