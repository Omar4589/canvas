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

// The poll's request path, pulled out of map.jsx (which node can't load) so the encoding is
// unit-testable. doorConfigStamp is ALWAYS encodeURIComponent'd: it contains '|' and ',', and a
// raw '|' makes iOS 15/16 percent-encode the whole URL — the already-encoded `since` arrives as
// %253A, the server 400s every poll, and teammates' results, round changes and door settings all
// stop with nothing on screen. No stamp (a bootstrap from a server without the field) → no param,
// which the server reads as "never send doorConfig". campaignId is an ObjectId hex and goes in as-is.
export const changesPath = ({ campaignId, since, doorConfigStamp }) => {
  const stampParam = doorConfigStamp ? `&doorConfigStamp=${encodeURIComponent(doorConfigStamp)}` : '';
  return `/mobile/changes?campaignId=${campaignId}&since=${encodeURIComponent(since)}${stampParam}`;
};

// The household half of the same fold. A delta door that is archived, fully voted, fully do-not-contact, or
// whose address asked that nobody come back is DROPPED — that is how a door suppressed mid-shift leaves a
// running phone (the server bumps updatedAt on every recompute, so the delta always carries it). Otherwise the
// delta's status, last visit, restricted provenance, confirm stamp and shared-spot flag replace the cached ones
// — each copied on every fold, because a stale value lies: an absent `pinSuspect` means the home has an exact
// map spot now — and its pin when the delta carries one. Doors not in the delta are untouched. The pending-
// action overlays (map.jsx reconcilePendingHouseholds / reconcilePendingLocations) wrap this result.
export const foldDeltaHouseholds = (prevHouseholds, deltaHouseholds) => {
  const prev = prevHouseholds || [];
  const delta = deltaHouseholds || [];
  if (!delta.length) return prev;
  const hMap = new Map(delta.map((h) => [String(h._id), h]));
  return prev
    .map((h) => {
      const c = hMap.get(String(h._id));
      if (!c) return h;
      if (c.isActive === false || c.fullyVoted === true || c.fullyDnc === true || c.doNotKnock === true) return null;
      return {
        ...h,
        status: c.status,
        lastActionAt: c.lastActionAt,
        // Per-round provenance of a Restricted mark ('desk' = the office's).
        restrictedFrom: c.restrictedFrom ?? null,
        // A Pin Fixes confirm/undo changes the stamp without moving the pin, and the badge must follow.
        locationConfirmedAt: c.locationConfirmedAt ?? null,
        // No exact map spot ('placeholder' | 'stray'), sent only while it is true.
        pinSuspect: c.pinSuspect ?? null,
        ...(c.location ? { location: c.location, coordSource: c.coordSource, coordConfidence: c.coordConfidence } : {}),
      };
    })
    .filter(Boolean);
};

// The reconcile after a pin fix's response (lib/recordAction.js recordLocationCorrection): the server's pin
// state for that door — the pin, its provenance, the confirm stamp and the shared-spot flag — replaces the
// optimistic patch in every case. A real move keeps the cleared stamp and flag; a save the server answered
// with `moved: 0` restores everything it left as it was. Written directly, never through a helper that forces
// coordConfidence to null, or an "Approximate location" badge would vanish until the next full bootstrap.
export const reconcileLocationResponse = (prev, householdId, response) => {
  const h = response?.household;
  if (!prev || !h?.location?.coordinates) return prev;
  return {
    ...prev,
    households: (prev.households || []).map((x) =>
      String(x._id) === String(householdId)
        ? {
            ...x,
            location: h.location,
            coordSource: h.coordSource ?? x.coordSource,
            coordConfidence: h.coordConfidence ?? null,
            locationConfirmedAt: h.locationConfirmedAt ?? null,
            pinSuspect: h.pinSuspect ?? null,
          }
        : x
    ),
  };
};
