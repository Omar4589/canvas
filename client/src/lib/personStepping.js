// The person panel's ‹ › (docs/PROPOSAL_PEOPLE_PAGES.md §D.3). Pure, so it is tested directly
// (personStepping.test.js); components/people/PersonPanel.jsx holds the snapshot.
//
// Opening the panel snapshots the list's ids as they were, so fixing someone (giving them a crew
// while No crew is filtered) never knocks you out of the list. Someone opened from a link is placed
// where they sort. The arrows skip anyone who has left the data since, and the list behind turns
// its page to the person you're on.

const idOf = (v) => (v == null ? null : String(v));

// The ids the arrows walk. `ids` is the list in order; when it doesn't hold `personId`, `place(id)`
// gives the list with them sorted in (or null when they aren't in the page's data at all).
export const openSnapshot = (ids, personId, place) => {
  const list = ids.map(String);
  const id = idOf(personId);
  if (!id || list.includes(id)) return list;
  const placed = place ? place(id) : null;
  return placed ? placed.map(String) : list;
};

// The nearest person in `dir` (-1 back, +1 on) from `currentId` who is still in the data. Someone
// who isn't in the snapshot (opened by a link to a person this list doesn't hold) steps on to the
// first person in it.
export const neighbour = (snapshot, currentId, dir, inData) => {
  const at = snapshot.indexOf(idOf(currentId));
  if (at < 0) return dir > 0 ? snapshot.find((id) => inData(id)) || null : null;
  for (let i = at + dir; i >= 0 && i < snapshot.length; i += dir) {
    if (inData(snapshot[i])) return snapshot[i];
  }
  return null;
};

// "3 of 45", over the people still in the data; null when the current person isn't one of them.
export const position = (snapshot, currentId, inData) => {
  const present = snapshot.filter((id) => inData(id));
  const at = present.indexOf(idOf(currentId));
  return at < 0 ? null : { index: at + 1, total: present.length };
};

// The page the list behind should show once the panel is on `id`: theirs, when the list as it is now
// holds them, else the page it is on.
export const pageFor = (liveIds, id, pageSize, currentPage) => {
  const at = liveIds.map(String).indexOf(idOf(id));
  return at < 0 ? currentPage : Math.floor(at / pageSize) + 1;
};
