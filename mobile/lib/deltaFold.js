// The voter half of the 30s /changes fold (map.jsx). Extracted pure so the append rule —
// the piece that lets a teammate's walk-up voter (Add person at the door) reach this phone
// without a full re-bootstrap — is unit-testable.
//
// Rules:
//  - A delta voter whose _id is already cached MERGES over the cached row (spread-whole:
//    both projections are identical and shaped by the same toWireVoter, so a delta voter is
//    never a partial view — see the server's VOTER_DELTA_PROJ comment).
//  - A delta voter whose _id is UNKNOWN is APPENDED — but only when its household is in the
//    just-folded households array. The server already scopes delta voters to this
//    canvasser's books, so an orphan here means the door was dropped this same fold
//    (suppressed mid-shift) or never in scope; appending a voter with no door would strand
//    an invisible row in the cache forever.
//
// Before this existed the fold was merge-only: a brand-new voter rode the delta from the
// server (its own updatedAt moved) and the phone silently discarded it.
export const foldDeltaVoters = (prevVoters, deltaVoters, knownHouseholdIds) => {
  const prev = prevVoters || [];
  const delta = deltaVoters || [];
  if (!delta.length) return prev;
  const vMap = new Map(delta.map((v) => [String(v._id), v]));
  const seen = new Set(prev.map((v) => String(v._id)));
  const merged = prev.map((v) => {
    const c = vMap.get(String(v._id));
    return c ? { ...v, ...c } : v;
  });
  const appended = delta.filter(
    (v) => !seen.has(String(v._id)) && knownHouseholdIds.has(String(v.householdId))
  );
  return appended.length ? [...merged, ...appended] : merged;
};
