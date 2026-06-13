// Normalize the cross-org match keys identically EVERYWHERE they are compared —
// resolvePerson, resolvePersonsBatch, the importer, and the migration.
//
// Mongoose schema setters (uppercase/trim) only fire on document save, NOT on
// query filters, so a raw CSV value like "fl" would miss an existing "FL" key
// unless we normalize the lookup value ourselves. Empty strings collapse to null
// so a blank column never counts as a usable key.
export function normalizePersonKeys({ uid, uidSource, registeredState, stateVoterId } = {}) {
  const s = (v) => {
    if (v == null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  };
  const st = s(registeredState);
  return {
    uid: s(uid),
    uidSource: s(uidSource),
    registeredState: st ? st.toUpperCase() : null,
    stateVoterId: s(stateVoterId),
  };
}
