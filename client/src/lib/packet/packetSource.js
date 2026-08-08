// Which round (or saved search) the studio is printing. One choice, read by both the picker
// and the map — they used to keep separate round state and could disagree.
//
// Pure and here rather than inside SourcePicker.jsx because it decides WHICH DOORS get
// printed: landing on the wrong round sends volunteers to the wrong streets, so it is worth
// testing without a DOM.

export const ROUND_KEY = (id) => `p:${id}`;
export const LIST_KEY = (id) => `w:${id}`;

// Rounds with nothing published are not offered — a round whose books are still drafts
// cannot be printed, so an option that yields an empty list would just look broken.
export const printableRounds = (sources) => (sources?.rounds || []).filter((r) => r.books?.length);

export const roundForKey = (sources, key) =>
  String(key || '').startsWith('p:')
    ? printableRounds(sources).find((r) => r.id === key.slice(2)) || null
    : null;

export const listForKey = (sources, key) =>
  String(key || '').startsWith('w:')
    ? (sources?.walkLists || []).find((w) => w.id === key.slice(2)) || null
    : null;

// Where the picker lands before anyone touches it: the round holding the current selection
// (so a `?turfIds=` deep link opens on its own round rather than resetting it), else the
// live round, else the first thing there is.
export const defaultSourceKey = (sources, selection) => {
  const rounds = printableRounds(sources);
  const lists = sources?.walkLists || [];
  if (selection?.kind === 'walklist' && selection.walkListId) return LIST_KEY(selection.walkListId);
  if (selection?.kind === 'books' && selection.turfIds?.length) {
    const holding = rounds.find((r) => r.books.some((b) => selection.turfIds.includes(b.id)));
    if (holding) return ROUND_KEY(holding.id);
  }
  const live = rounds.find((r) => r.status === 'active');
  if (live) return ROUND_KEY(live.id);
  if (rounds.length) return ROUND_KEY(rounds[0].id);
  return lists.length ? LIST_KEY(lists[0].id) : '';
};

// Preserve the server's ordering (walk list by creation, then round) while collapsing
// consecutive rounds of the same walk list into one group.
export const groupByWalkList = (rounds) => {
  const groups = [];
  for (const r of rounds) {
    const last = groups[groups.length - 1];
    if (last && last.effortId === r.effortId) last.rounds.push(r);
    else groups.push({ effortId: r.effortId, effortName: r.effortName, rounds: [r] });
  }
  return groups;
};
