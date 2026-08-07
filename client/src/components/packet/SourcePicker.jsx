import { Badge, EmptyState, SkeletonRows } from '../ui/index.js';
import { BOOK_COLORS } from '../../lib/packet/packetTheme.js';

const stripe = (i) => {
  const [r, g, b] = BOOK_COLORS[i % BOOK_COLORS.length];
  return `rgb(${r} ${g} ${b})`;
};

// What gets printed. Books first (they carry a real walk order), saved searches after
// (their order is computed for the printout and not stored — the label says so).
export default function SourcePicker({ sources, loading, selection, onChange }) {
  if (loading) return <SkeletonRows rows={6} />;
  if (!sources) return null;

  const { rounds = [], walkLists = [] } = sources;
  const hasBooks = rounds.some((r) => r.books.length);

  const toggleBook = (id) => {
    if (selection.kind === 'walklist') return onChange({ kind: 'books', turfIds: [id] });
    const next = selection.turfIds.includes(id)
      ? selection.turfIds.filter((t) => t !== id)
      : [...selection.turfIds, id];
    onChange({ kind: 'books', turfIds: next });
  };

  const selectRound = (round) => {
    const ids = round.books.map((b) => b.id);
    const allOn = selection.kind === 'books' && ids.every((id) => selection.turfIds.includes(id));
    onChange({
      kind: 'books',
      turfIds: allOn
        ? selection.turfIds.filter((id) => !ids.includes(id))
        : [...new Set([...(selection.kind === 'books' ? selection.turfIds : []), ...ids])],
    });
  };

  return (
    <div className="space-y-5">
      {!hasBooks && !walkLists.length && (
        <EmptyState
          title="Nothing to print yet"
          description="Cut books on the Turf Cutting page, or save a search, and they'll show up here."
        />
      )}

      {rounds.filter((r) => r.books.length).map((round) => {
        const ids = round.books.map((b) => b.id);
        const allOn = selection.kind === 'books' && ids.every((id) => selection.turfIds.includes(id));
        return (
          <div key={round.id}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-semibold text-fg truncate">{round.name}</h3>
                {round.status !== 'active' && <Badge tone="muted">{round.status}</Badge>}
              </div>
              <button
                type="button"
                onClick={() => selectRound(round)}
                className="text-xs text-brand hover:underline shrink-0"
              >
                {allOn ? 'Clear' : 'All'}
              </button>
            </div>
            <div className="space-y-1">
              {round.books.map((book, i) => {
                const on = selection.kind === 'books' && selection.turfIds.includes(book.id);
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => toggleBook(book.id)}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border text-left transition-colors ${
                      on ? 'border-brand bg-brand-tint' : 'border-border bg-card hover:bg-muted'
                    }`}
                  >
                    <span className="w-1 h-5 rounded-sm shrink-0" style={{ background: stripe(i) }} />
                    <span className="text-sm text-fg truncate flex-1">{book.name}</span>
                    <span className="text-xs text-muted-fg tabular-nums shrink-0">{book.doorCount}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {walkLists.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-fg mb-1">Saved searches</h3>
          <p className="text-xs text-muted-fg mb-2">
            Walk order is worked out for this printout and isn&apos;t saved, so a reprint can order
            neighbouring units differently.
          </p>
          <div className="space-y-1">
            {walkLists.map((w) => {
              const on = selection.kind === 'walklist' && selection.walkListId === w.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => onChange({ kind: 'walklist', walkListId: w.id })}
                  aria-pressed={on}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border text-left transition-colors ${
                    on ? 'border-brand bg-brand-tint' : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  <span className="text-sm text-fg truncate flex-1">{w.name}</span>
                  <span className="text-xs text-muted-fg tabular-nums shrink-0">{w.doorCount}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
