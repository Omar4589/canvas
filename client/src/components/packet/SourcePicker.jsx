import { Badge, EmptyState, SkeletonRows, Select } from '../ui/index.js';
import { BOOK_COLOR_HEX } from '../../lib/packet/packetTheme.js';
import {
  ROUND_KEY, LIST_KEY, printableRounds, roundForKey, listForKey, groupByWalkList,
} from '../../lib/packet/packetSource.js';

// What gets printed, picked from ONE dropdown: walk list → round, then tick books.
//
// ONE ROUND AT A TIME IS THE POINT — the scrolling was only the symptom. Listing every
// round's books together invites a print run that spans the LIVE round and a draft one, and
// on paper that means volunteers sent to doors the app crew is already working. Scoping the
// list to one round makes that mix unreachable rather than merely discouraged: changing
// rounds clears the picks. The studio map is scoped by the same choice (it used to keep its
// own round state, so the two panes could disagree about which round you were printing).
//
// Book colour comes from the SERVER (`colorIndex`), never from this list's array position:
// the same number drives the swatch here, the fill on the map, and the stripe on the paper.

export default function SourcePicker({
  sources, loading, selection, sourceKey, onSourceChange, onToggleBook, onSelectAll,
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (!sources) return null;

  const rounds = printableRounds(sources);
  const walkLists = sources.walkLists || [];

  if (!rounds.length && !walkLists.length) {
    return (
      <EmptyState
        title="Nothing to print yet"
        description="Cut books on the Turf Cutting page and accept them, or save a search, and they'll show up here."
      />
    );
  }

  const round = roundForKey(sources, sourceKey);
  const list = listForKey(sources, sourceKey);
  const picked = (id) => selection.kind === 'books' && selection.turfIds.includes(id);

  const ids = round ? round.books.map((b) => b.id) : [];
  const allOn = ids.length > 0 && ids.every(picked);
  const doors = round ? round.books.reduce((n, b) => n + (b.doorCount || 0), 0) : 0;
  // Only a caution when it is actually true: a live round whose books someone is holding in
  // the app. A round nobody is assigned to is exactly what an all-paper campaign looks like.
  const inTheApp = round?.status === 'active' && round.books.some((b) => b.assignedTo);

  return (
    <div>
      <Select
        aria-label="What to print"
        value={sourceKey || ''}
        onChange={(e) => onSourceChange(e.target.value)}
        className="w-full"
      >
        {groupByWalkList(rounds).map((group) => (
          <optgroup key={group.effortId || 'none'} label={group.effortName}>
            {group.rounds.map((r) => (
              <option key={r.id} value={ROUND_KEY(r.id)}>
                Pass {r.roundNumber} · {r.name}
                {r.status !== 'active' ? ` (${r.status})` : ''}
              </option>
            ))}
          </optgroup>
        ))}
        {walkLists.length > 0 && (
          <optgroup label="Saved searches">
            {walkLists.map((w) => (
              <option key={w.id} value={LIST_KEY(w.id)}>{w.name}</option>
            ))}
          </optgroup>
        )}
      </Select>

      {round && (
        <>
          <div className="flex items-baseline justify-between gap-2 mt-3 mb-1.5">
            <span className="text-xs text-fg-muted tabular-nums">
              {round.books.length} book{round.books.length === 1 ? '' : 's'} ·{' '}
              {doors.toLocaleString()} doors
            </span>
            <button
              type="button"
              onClick={() => onSelectAll(ids, allOn)}
              className="text-xs text-brand-accent hover:underline shrink-0"
            >
              {allOn ? 'Clear' : 'All'}
            </button>
          </div>

          {inTheApp && (
            <p className="mb-2 text-xs bg-warning-tint text-fg rounded-md px-2.5 py-1.5 border-l-2 border-warning">
              This round is live in the app. Printing a book someone is already assigned sends
              two people to the same doors.
            </p>
          )}

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
                    on ? 'border-brand-accent bg-brand-tint' : 'border-border bg-card hover:bg-sunken'
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
                      <span className="block text-[11px] text-fg-muted truncate">
                        In the app: {book.assignedTo}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-fg-muted tabular-nums shrink-0">{book.doorCount}</span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-xs font-bold ${on ? 'text-brand-accent' : 'text-transparent'}`}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {list && (
        <div className="mt-3">
          <div className="rounded-md border border-brand-accent bg-brand-tint px-2.5 py-2">
            <span className="block text-sm text-fg truncate">{list.name}</span>
            <span className="block text-xs text-fg-muted tabular-nums">
              {(list.doorCount || 0).toLocaleString()} doors ·{' '}
              {(list.voterCount || 0).toLocaleString()} voters
            </span>
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            A saved search prints as one packet. Walk order is worked out for this printout and
            isn&apos;t saved, so a reprint can order neighbouring units differently.
          </p>
        </div>
      )}

      {!round && !list && (
        <p className="mt-3 text-xs text-fg-muted">Pick a round or a saved search to print.</p>
      )}

      {round?.status && round.status !== 'active' && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-fg-muted">
          <Badge tone="muted">{round.status}</Badge>
          Not live in the app — printing it changes nothing for canvassers.
        </p>
      )}
    </div>
  );
}
