// The Turf Cutting page's crew summary: how many canvassers hold a book, how many books they
// hold, and how many books nobody holds. Each is named for the unit it counts, because the
// page shipped three surfaces that quietly disagreed about the word "assigned" — the header
// strip's headline was CANVASSERS, the filter pill beside it was BOOKS, and the map's "Crew
// load" pill printed the pass's ENTIRE book count as the crew's load. All three now come from
// one walk over the book list, so they cannot drift apart again.
//
// Deriving the canvasser count from the BOOKS (rather than from the raw assignment rows, which
// is what the strip used to do) also closes a latent split: /turfs hides archived books while
// /turfs/assignments never joins Turf, so an assignment row naming a book the list doesn't
// carry used to count a canvasser the crew pill — which has always walked the books — did not.
//
// `assignedByTurf` is the page's Map of turfId -> [user], the same one the status chips read.
export const crewCounts = (turfs, assignedByTurf) => {
  const canvassers = new Set();
  let assignedBooks = 0;
  for (const t of turfs) {
    const crew = assignedByTurf.get(String(t._id)) || [];
    if (!crew.length) continue;
    assignedBooks += 1;
    for (const u of crew) canvassers.add(u.id);
  }
  return { canvassers: canvassers.size, assignedBooks, unassignedBooks: turfs.length - assignedBooks };
};
