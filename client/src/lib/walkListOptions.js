// How walk lists and passes are listed in pickers (docs/PROPOSAL_WALK_LIST_ARCHIVE.md §D.4). MIRRORED
// in mobile/lib/walkListOptions.js — everything below this header is byte-identical to it; change one,
// change both. Pure data in/out, so walkListOptions.parity.test.js can hold the two in step.
//
// Report filters keep archived walk lists — their history is still in every number — but mark them
// and list them after the open ones (owner ruling 7). Pickers used to do WORK (the phone's admin
// Books, print packets) call openWalkLists instead and leave them out.

export const isArchivedWalkList = (effort) => effort?.status === 'archived';

export const walkListLabel = (effort) =>
  `${effort?.name || 'Walk list'}${isArchivedWalkList(effort) ? ' (archived)' : ''}`;

// Open walk lists first, in the order given (the server's creation order), then archived ones.
export const walkListOptions = (efforts) => {
  const list = efforts || [];
  return [...list.filter((e) => !isArchivedWalkList(e)), ...list.filter(isArchivedWalkList)];
};

export const openWalkLists = (efforts) => (efforts || []).filter((e) => !isArchivedWalkList(e));

// "Pass 3 · GOTV", or just "Pass 3" when the name only repeats the number (an auto-named pass).
export const passShortLabel = (pass) => {
  const n = pass?.roundNumber;
  const base = n == null ? 'Pass' : `Pass ${n}`;
  const name = String(pass?.name || '').trim();
  return name && name !== base ? `${base} · ${name}` : base;
};

// "North · Pass 3 · GOTV" — a bare "Pass 2" names a different round in every walk list.
export const passOptionLabel = (pass, effortName) => `${effortName || 'Walk list'} · ${passShortLabel(pass)}`;
