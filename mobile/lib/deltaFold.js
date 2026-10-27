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

// The server's knockable-door rule (server/src/services/canvass/knockableDoorFilter.js), read off a delta row,
// which carries every one of its flags: true when a fresh bootstrap would leave this door out — gone from the
// campaign's active doors, everyone there voted early, everyone there asked not to be contacted, the address
// asked that nobody come back, or the office took it out of books. server/test/knockableDoorParity.test.js
// holds this to the server's list, so a new flag there fails CI until the phone learns it too.
export const isSuppressedDoor = (h) =>
  h.isActive === false ||
  h.fullyVoted === true ||
  h.fullyDnc === true ||
  h.doNotKnock === true ||
  h.excludedFromTurf === true;

// Delta doors this phone doesn't hold but should be showing: knockable, with a pin, and in the canvasser's books
// (the server only sends their doors). A door comes back this way when an early-voting upload is undone or a
// voter un-marked, when an import or a teammate adds someone who hasn't voted, when a do-not-contact flag
// clears, or when an emptied door is refilled. A delta row has no address or book to draw it with, so the
// caller pulls a fresh bootstrap (map.jsx) — before this, the door stayed off the phone until a manual refresh.
// The pin check matches the bootstrap's own, so a door the bootstrap would still leave out can't loop.
export const returningDoorIds = (prevHouseholds, deltaHouseholds) => {
  const known = new Set((prevHouseholds || []).map((h) => String(h._id)));
  return (deltaHouseholds || [])
    .filter((h) => !known.has(String(h._id)) && !isSuppressedDoor(h) && Array.isArray(h.location?.coordinates))
    .map((h) => String(h._id));
};

// The household half of the same fold. A delta door the bootstrap would now leave out (isSuppressedDoor) is
// DROPPED — that is how a door suppressed mid-shift leaves a running phone (the server bumps updatedAt on every
// recompute, so the delta always carries it). Otherwise the
// delta's status, last visit, restricted provenance, confirm stamp and shared-spot flag replace the cached ones
// — each copied on every fold, because a stale value lies: an absent `pinSuspect` means the home has an exact
// map spot now — and its pin when the delta carries one. Doors not in the delta are untouched; a delta door the
// phone doesn't hold is returningDoorIds' business, not this fold's. The pending-action overlays (map.jsx
// reconcilePendingHouseholds / reconcilePendingLocations) wrap this result.
export const foldDeltaHouseholds = (prevHouseholds, deltaHouseholds) => {
  const prev = prevHouseholds || [];
  const delta = deltaHouseholds || [];
  if (!delta.length) return prev;
  const hMap = new Map(delta.map((h) => [String(h._id), h]));
  return prev
    .map((h) => {
      const c = hMap.get(String(h._id));
      if (!c) return h;
      if (isSuppressedDoor(c)) return null;
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
