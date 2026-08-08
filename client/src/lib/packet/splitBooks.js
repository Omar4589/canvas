// Split big books into small printed packets — at PRINT TIME only. A 150-door book becomes
// "Book 33 · 1 of 4" … "· 4 of 4": contiguous runs of the walk order the server already
// computed, each rendered as its own packet with its own cover, map, street list, and page
// numbering. Nothing is written anywhere — Turf.householdIds is untouched, the phone still
// walks the whole book, and the /data payload in the query cache is never mutated (every
// door that changes is copied). This is the civilized replacement for the workflow the
// header band describes: "one book routinely gets torn in half and handed to two volunteers".
//
// Each part is an ordinary book-object to the renderer. Three fields are load-bearing:
//   id      — DISTINCT per part ("<bookId>#2of4"): the cover-map cache, the manifest's page
//             ranges, and the per-packet "Page n of N" pass all key on book.id, so parts
//             sharing the parent id would share one map, one range, one page count.
//   seq     — RE-STAMPED 1..n per part. The street bands number doors by position within the
//             book they're in, so a part keeping the parent's global numbers would carry a
//             door badge saying 39 under a band saying "doors 1-15".
//   colorIndex — INHERITED. A book's colour is its position within its pass (the colour
//             rule in buildPacket.js); parts inventing their own would put a stripe on paper
//             that contradicts the picker and the Turf Cutting map.
//
// `omitted` rides on part 1 only (the others get an empty shell) so totals.omitted and the
// apartments warning count each held-back door exactly once. The renderer never prints it —
// this is bookkeeping for the on-screen totals, not the page.

// Below this the knob is treated as OFF — a 5-door packet is a sticky note, and near the
// 1,200-door cap it would mean hundreds of covers (each with a Mapbox fetch).
export const MIN_DOORS_PER_PACKET = 10;

// A book only a little over target stays whole: nobody wants a 35-door packet plus a
// 3-door orphan. ceil(1.3 × target) — at 35 that means books up to 46 print as one packet.
const hardMaxFor = (target) => Math.ceil(target * 1.3);

// How far a cut may drift from its balanced ideal to land on a street boundary.
const windowFor = (target) => Math.max(3, Math.round(target * 0.2));

// The server's streetSummary, replicated on a slice: count by the door's own `street`
// (stamped server-side so band and grouping agree by construction), alphabetical and
// numeric-aware — "2ND ST" before "10TH ST" — because a volunteer scans this list for a name.
const streetsOf = (doors) => {
  const counts = new Map();
  for (const d of doors) {
    const s = d.street || '';
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
};

// Cut one book's final print order into parts. BALANCED, then street-aware: the part count
// comes first (round(len/target), bumped until every part fits under hardMax), and each cut
// then slides within a small window to the street boundary nearest its ideal. Balancing
// before cutting is what prevents runt tails — 82 doors at target 35 becomes 41 + 41, not
// 35 + 35 + 12. A cut with no usable street change in its window (one long street) falls
// back to the clamped ideal; two walkers on one street beats a 60-door packet.
//
// Every cut is CLAMPED so this part — and everything still owed after it — stays within
// [minPart, hardMax]. Without the clamp, slides compound: an ordinary two-street 87-door
// book at target 35, cut on its one street boundary, produced parts of 37 and 50 — a
// packet BIGGER than the 46-door book the same knob deliberately leaves whole.
const splitDoors = (doors, target) => {
  const len = doors.length;
  const hardMax = hardMaxFor(target);
  if (len <= hardMax) return [doors];

  let partCount = Math.max(2, Math.round(len / target));
  while (Math.ceil(len / partCount) > hardMax) partCount += 1;

  // The floor a part may not shrink under. Bends only when the book is small enough that
  // even balanced parts sit under MIN_DOORS_PER_PACKET.
  const minPart = Math.min(MIN_DOORS_PER_PACKET, Math.floor(len / partCount));

  const win = windowFor(target);
  const cuts = [];
  let prev = 0;
  for (let k = 1; k < partCount; k++) {
    const ideal = Math.round((len * k) / partCount);
    const remaining = partCount - k; // parts still owed after this cut
    // Feasibility: this part within [minPart, hardMax], AND what's left coverable by the
    // remaining parts within the same bounds. By induction these bounds never cross.
    const cLo = Math.max(prev + minPart, len - remaining * hardMax);
    const cHi = Math.min(prev + hardMax, len - remaining * minPart);
    // A boundary at index c means the street changes between doors[c-1] and doors[c].
    const lo = Math.max(ideal - win, cLo);
    const hi = Math.min(ideal + win, cHi);
    let best = null;
    for (let c = lo; c <= hi; c++) {
      if ((doors[c - 1].street || '') !== (doors[c].street || '')) {
        if (best === null || Math.abs(c - ideal) < Math.abs(best - ideal)) best = c;
      }
    }
    const cut = best ?? Math.min(Math.max(ideal, cLo), cHi);
    cuts.push(cut);
    prev = cut;
  }

  const parts = [];
  let start = 0;
  for (const c of [...cuts, len]) {
    if (c > start) parts.push(doors.slice(start, c));
    start = c;
  }
  return parts;
};

// The whole payload, split. Returns the SAME object when there is nothing to do (knob off,
// too low, or no book big enough) so a memoized caller re-renders nothing.
export const splitBooks = (payload, doorsPerPacket) => {
  const target = Math.floor(Number(doorsPerPacket) || 0);
  if (!payload || target < MIN_DOORS_PER_PACKET) return payload;

  let changed = false;
  const books = (payload.books || []).flatMap((book) => {
    const slices = splitDoors(book.doors || [], target);
    if (slices.length < 2) return [book];
    changed = true;
    const m = slices.length;
    return slices.map((slice, idx) => ({
      ...book,
      id: `${book.id}#${idx + 1}of${m}`,
      name: `${book.name} · ${idx + 1} of ${m}`,
      // Copies, never mutation — the parent payload lives in the query cache.
      doors: slice.map((d, i) => ({ ...d, seq: i + 1 })),
      doorCount: slice.length,
      voterCount: slice.reduce((n, d) => n + (d.voters?.length || 0), 0),
      streets: streetsOf(slice),
      omitted: idx === 0 ? book.omitted : { total: 0, reasons: {} },
      // Provenance for the filename and the "N books → M packets" count.
      partIndex: idx + 1,
      partCount: m,
      sourceBookId: book.id,
      sourceName: book.name,
    }));
  });
  if (!changed) return payload;

  return {
    ...payload,
    books,
    // totals.books feeds the manifest header's "N packets" line, so it counts PARTS. The
    // other three are invariant — parts exactly partition their book — but are re-summed
    // here rather than trusted, so a partition bug would surface as a wrong doors total on
    // the hand-out header instead of silently lost paper.
    totals: {
      books: books.length,
      doors: books.reduce((n, b) => n + b.doorCount, 0),
      voters: books.reduce((n, b) => n + b.voterCount, 0),
      omitted: books.reduce((n, b) => n + (b.omitted?.total || 0), 0),
    },
  };
};
