// Bulk "move doors to another book" — the pure half the Turf Cutting page's two surfaces
// share (the door lasso's "Move to book…" and the book panel's "Move doors to…"): who can be
// a target, what the selection is leaving, which merge survivor honors the born-live rule,
// the toast grammar, and which donors the server says a move emptied. No React, no api here —
// `node --test src/` pins it all (moveTargets.test.js).

import { pluralize } from './mapCounts.js';

// The books the picker offers. `excludeIds` drops the books being moved themselves (the book
// flavor); `donorCounts` (Map<turfIdStr, selected-doors-in-it>) annotates each row with how
// much of the selection it already holds, and `holdsAll` disables the row that holds all of
// it — a move there would be a no-op. Doors shown = the eligible count when the list carries
// one (the same `eligibleDoorCount ?? doorCount` fallback the page's own tallies use).
export const moveTargetCandidates = (turfs, colorByTurf, { excludeIds = null, donorCounts = null, selectionSize = 0 } = {}) =>
  (turfs || [])
    .filter((t) => t.status !== 'archived')
    .filter((t) => !excludeIds || !excludeIds.has(String(t._id)))
    .map((t) => {
      const holdsSome = donorCounts?.get(String(t._id)) || 0;
      return {
        id: String(t._id),
        name: t.name,
        color: colorByTurf?.get(String(t._id)) || null,
        doors: t.eligibleDoorCount ?? t.doorCount ?? 0,
        draft: t.status !== 'published',
        holdsSome,
        holdsAll: selectionSize > 0 && holdsSome >= selectionSize,
      };
    });

// What a lasso selection is leaving, per donor book — judged by PASS membership, never
// `turfId != null` (the cutMapDoors rule: a targeted second cut leaves skipped doors carrying
// a prior round's book id, and those are LOOSE here, not booked).
export const planLassoMove = (selectedRows, passTurfIds) => {
  const donors = new Map();
  let looseCount = 0;
  for (const d of selectedRows || []) {
    const tid = String(d.turfId);
    if (passTurfIds?.has(tid)) donors.set(tid, (donors.get(tid) || 0) + 1);
    else looseCount += 1;
  }
  return { total: (selectedRows || []).length, donors, looseCount };
};

const listJoin = (parts) =>
  parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

// "They leave “Book 2” (25) and “Book 5” (8) · 4 aren't in any book yet" — the modal's
// source disclosure. Empty string when the whole selection is loose-only AND nothing leaves
// a book is still worth saying, so loose-only prints just its own clause.
export const moveSourceLine = ({ donors, looseCount } = {}, nameOf = () => null) => {
  const bits = [];
  if (donors?.size) {
    const parts = [...donors.entries()].map(([id, c]) => `“${nameOf(id) || 'a book'}” (${c.toLocaleString()})`);
    bits.push(`They leave ${listJoin(parts)}`);
  }
  if (looseCount > 0) {
    bits.push(`${looseCount.toLocaleString()} ${looseCount === 1 ? "isn't" : "aren't"} in any book yet`);
  }
  return bits.join(' · ');
};

// Survivor for a books→NEW-book merge (the client merges the selection, then renames the
// survivor). A published book survives when the selection holds one, so a mid-round merge
// stays live and assignable — the same born-live rule the server applies to a lasso's new
// book; an all-draft selection stays draft.
export const pickMergePrimary = (selectedTurfs) => {
  const list = selectedTurfs || [];
  const pub = list.find((t) => t.status === 'published');
  return String((pub || list[0])?._id || '');
};

export const moveDoorsToast = ({ moved, toName, isNew }) =>
  `Moved ${(moved || 0).toLocaleString()} ${pluralize(moved || 0, 'door')} to ${isNew ? 'new book ' : ''}“${toName}”.`;

export const moveBooksToast = ({ doors, mergedCount, toName, isNew }) =>
  isNew
    ? `Merged ${mergedCount} ${pluralize(mergedCount, 'book')} into new book “${toName}”.`
    : `Moved ${(doors || 0).toLocaleString()} ${pluralize(doors || 0, 'door')} into “${toName}” — ${mergedCount} ${pluralize(mergedCount, 'book')} merged away.`;

// The donors a move-doors response says are now empty — what the "delete them?" prompt lists.
export const emptiedDonors = (res) => (res?.from || []).filter((d) => d.emptied);
