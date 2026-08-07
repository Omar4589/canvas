import { Badge, EmptyState, SkeletonRows } from '../ui/index.js';
import { BOOK_COLOR_HEX } from '../../lib/packet/packetTheme.js';

// What gets printed. A campaign runs several WALK LISTS in parallel, each with its own
// rounds, so books are grouped walk list → round → book — a bare "Pass 3" doesn't say which
// operation it belongs to, and with three walk lists there are three simultaneous Pass 3s.
//
// Book colour comes from the SERVER (`colorIndex`), never from this list's array position:
// the same number drives the swatch here, the fill on the map, and the stripe on the paper.

// Preserve the server's ordering (walk list by creation, then round) while collapsing
// consecutive rounds of the same walk list into one group.
const groupByWalkList = (rounds) => {
  const groups = [];
  for (const r of rounds) {
    const last = groups[groups.length - 1];
    if (last && last.effortId === r.effortId) last.rounds.push(r);
    else groups.push({ effortId: r.effortId, effortName: r.effortName, rounds: [r] });
  }
  return groups;
};

export default function SourcePicker({
  sources, loading, selection, onToggleBook, onSelectRound, onSelectWalkList,
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (!sources) return null;

  const { rounds = [], walkLists = [] } = sources;
  const groups = groupByWalkList(rounds.filter((r) => r.books.length));
  const picked = (id) => selection.kind === 'books' && selection.turfIds.includes(id);

  return (
    <div className="space-y-6">
      {!groups.length && !walkLists.length && (
        <EmptyState
          title="Nothing to print yet"
          description="Cut books on the Turf Cutting page, or save a search, and they'll show up here."
        />
      )}

      {groups.map((group) => {
        const groupIds = group.rounds.flatMap((r) => r.books.map((b) => b.id));
        const allOn = groupIds.every(picked);
        return (
          <div key={group.effortId || 'none'}>
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <h3 className="text-sm font-semibold text-fg truncate" title={group.effortName}>
                {group.effortName}
              </h3>
              <button
                type="button"
                onClick={() => onSelectWalkList(groupIds, allOn)}
                className="text-xs text-brand hover:underline shrink-0"
              >
                {allOn ? 'Clear' : 'All'}
              </button>
            </div>

            {group.rounds.map((round) => {
              const ids = round.books.map((b) => b.id);
              const roundOn = ids.every(picked);
              return (
                <div key={round.id} className="mb-3 last:mb-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1 pl-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-medium text-muted-fg truncate">
                        Pass {round.roundNumber} · {round.name}
                      </span>
                      {round.status !== 'active' && <Badge tone="muted">{round.status}</Badge>}
                    </div>
                    {group.rounds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onSelectRound(ids, roundOn)}
                        className="text-[11px] text-brand hover:underline shrink-0"
                      >
                        {roundOn ? 'Clear' : 'All'}
                      </button>
                    )}
                  </div>

                  <div className="space-y-1">
                    {round.books.map((book) => {
                      const on = picked(book.id);
                      return (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => onToggleBook(book.id)}
                          aria-pressed={on}
                          title={book.assignedTo ? `In the app: ${book.assignedTo}` : undefined}
                          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md border text-left transition-colors ${
                            on ? 'border-brand bg-brand-tint' : 'border-border bg-card hover:bg-muted'
                          }`}
                        >
                          <span
                            className="w-1 h-5 rounded-sm shrink-0"
                            style={{ background: BOOK_COLOR_HEX[book.colorIndex % BOOK_COLOR_HEX.length] }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-fg truncate">{book.name}</span>
                            {book.assignedTo && (
                              // Not printed on the paper — but worth seeing here, because a book
                              // someone is walking in the app is a double-walk risk on paper.
                              <span className="block text-[11px] text-muted-fg truncate">
                                In the app: {book.assignedTo}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-fg tabular-nums shrink-0">{book.doorCount}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
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
                  onClick={() => onToggleBook(w.id, { walkList: true })}
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
