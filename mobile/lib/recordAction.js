import { Alert, Linking, Platform } from 'react-native';
import { getCurrentLocation, getCanvassLocation, promptEnableServices } from './location';
import { submitOrQueue, flushQueue } from './offlineQueue';
import { saveBootstrap } from './cache';

const ACTION_PATHS = { not_home: 'not-home', wrong_address: 'wrong-address', lit_dropped: 'lit-drop', refused: 'refused', restricted: 'restricted' };

// Patch the ['bootstrap'] cache and persist it. The React Query update is
// synchronous, so every screen reading ['bootstrap'] (the map's pins, the
// building unit list, the household detail) re-renders this same frame. The
// AsyncStorage write is fire-and-forget so it never blocks that re-render.
function writeBootstrap(qc, updater) {
  qc.setQueryData(['bootstrap'], (prev) => {
    if (!prev) return prev;
    const next = updater(prev);
    if (next && next !== prev) saveBootstrap(next);
    return next;
  });
}

function setHouseholdStatus(prev, householdId, status) {
  return {
    ...prev,
    households: (prev.households || []).map((h) =>
      String(h._id) === String(householdId)
        ? { ...h, status, lastActionAt: new Date().toISOString() }
        : h
    ),
  };
}

// Patch a household's coordinates in the bootstrap cache (pin-correction optimistic move).
// coords are [lng, lat].
function setHouseholdLocation(prev, householdId, coords) {
  return {
    ...prev,
    households: (prev.households || []).map((h) =>
      String(h._id) === String(householdId)
        ? { ...h, location: { type: 'Point', coordinates: coords }, coordSource: 'corrected', coordConfidence: null }
        : h
    ),
  };
}

// --- Pending optimistic statuses (the un-clobberable guarantee) -------------
// An optimistic recolor lives in the ['bootstrap'] cache, but a server-sourced
// write to that cache — a full bootstrap refetch, or the 30s `changes` delta —
// can resolve with PRE-action data and revert the pin (the blue→grey→blue / "goes
// black" flicker). To make that impossible, we keep a registry of statuses the
// canvasser has set but the server hasn't confirmed yet, and EVERY server-sourced
// bootstrap write runs its households through reconcilePendingHouseholds(), which
// re-applies the pending status and clears each entry once the server's own data
// agrees (or a safety TTL elapses). map.jsx wires this into both server writers.
const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingHouseholds = new Map(); // id -> { status, at }

export function markPendingHousehold(id, status) {
  pendingHouseholds.set(String(id), { status, at: Date.now() });
}

export function clearPendingHousehold(id) {
  pendingHouseholds.delete(String(id));
}

// Overlay unconfirmed optimistic statuses onto a server-sourced households array,
// clearing entries the server has caught up to (or that have aged past the TTL).
export function reconcilePendingHouseholds(households) {
  if (!pendingHouseholds.size || !Array.isArray(households)) return households;
  const now = Date.now();
  return households.map((h) => {
    const p = pendingHouseholds.get(String(h._id));
    if (!p) return h;
    if (now - p.at > PENDING_TTL_MS) {
      pendingHouseholds.delete(String(h._id)); // give up; let the server win
      return h;
    }
    if (h.status === p.status) {
      pendingHouseholds.delete(String(h._id)); // server caught up — stop overlaying
      return h;
    }
    return { ...h, status: p.status }; // server is stale for this door — hold the optimistic color
  });
}

// --- Pending optimistic LOCATIONS (the pin-fix analog of pendingHouseholds) ---------
// A pin correction is optimistic just like a status change, so a server-sourced
// bootstrap write (a refetch or the 30s `changes` delta) that arrives BEFORE the
// queued fix syncs would snap the pin back to the old geocode. Same fix as statuses:
// hold the canvasser's unconfirmed coordinate and re-apply it on every server write
// until the server's own coords agree (or a TTL elapses). map.jsx wires
// reconcilePendingLocations into the same two server writers as reconcilePendingHouseholds.
const PENDING_LOC_TTL_MS = 5 * 60 * 1000;
const pendingLocations = new Map(); // id -> { coords:[lng,lat], at }

export function markPendingLocation(id, coords) {
  pendingLocations.set(String(id), { coords, at: Date.now() });
}
export function clearPendingLocation(id) {
  pendingLocations.delete(String(id));
}

export function reconcilePendingLocations(households) {
  if (!pendingLocations.size || !Array.isArray(households)) return households;
  const now = Date.now();
  return households.map((h) => {
    const p = pendingLocations.get(String(h._id));
    if (!p) return h;
    if (now - p.at > PENDING_LOC_TTL_MS) {
      pendingLocations.delete(String(h._id)); // give up; let the server win
      return h;
    }
    const c = h.location?.coordinates;
    if (c && Math.abs(c[0] - p.coords[0]) < 1e-6 && Math.abs(c[1] - p.coords[1]) < 1e-6) {
      pendingLocations.delete(String(h._id)); // server caught up — stop overlaying
      return h;
    }
    return { ...h, location: { type: 'Point', coordinates: p.coords }, coordSource: 'corrected', coordConfidence: null };
  });
}

// In-flight de-dup: request paths currently being submitted, so a rapid double-fire to the SAME
// target (a double-tap, or an offline-queue flush racing a live submit) collapses to one request.
// The server's unique (voter, pass) index is the final backstop; this just avoids the wasted second
// call + benign duplicate activity row. Cleared when the submit settles.
const inFlightPaths = new Set();

// Per-code "you're blocked" alert for a failed location gate. Cancel resolves the
// caller's blocked result; Try again re-enters the same submit. Deliberately NO copy
// for mock locations — mock detection is recorded silently server-side, never shown here.
function locationBlockedAlert(err, { onCancel, onRetry }) {
  const code = err?.code || 'NO_FIX';
  const cancel = { text: 'Cancel', style: 'cancel', onPress: onCancel };
  const retry = { text: 'Try again', onPress: onRetry };
  const openSettings = {
    text: 'Open Settings',
    onPress: () => {
      Linking.openSettings().catch(() => {});
      onCancel();
    },
  };

  if (code === 'PERMISSION_DENIED') {
    const canAskAgain = err.canAskAgain !== false;
    Alert.alert(
      'Location needed to canvass',
      'Doorline records a GPS stamp with every door so your work can be verified. Allow location access to record this door.' +
        (canAskAgain ? '' : ' Enable it for Doorline in Settings, then try again.'),
      canAskAgain ? [cancel, retry] : [cancel, openSettings, retry]
    );
  } else if (code === 'SERVICES_OFF') {
    const enable =
      Platform.OS === 'android'
        ? { text: 'Turn on', onPress: () => promptEnableServices().then(onRetry, onCancel) }
        : openSettings;
    Alert.alert(
      'Location is off',
      "Turn on your phone's location to record this door. Nothing was recorded.",
      [cancel, enable, retry]
    );
  } else if (code === 'PRECISE_OFF') {
    Alert.alert(
      'Precise location required',
      'Doorline only has your approximate location. In Settings, turn on Precise Location for Doorline, then try again.',
      [cancel, openSettings, retry]
    );
  } else {
    Alert.alert(
      'No GPS signal',
      "Couldn't get a location fix. Step away from buildings and try again — nothing was recorded.",
      [cancel, retry]
    );
  }
}

// Gate-then-optimistic submit.
//
//   1. HARD GATE (requireFix, the default): acquire a fresh GPS stamp via
//      getCanvassLocation BEFORE anything visible happens. No location = no knock —
//      a blocked tap shows a typed alert (with retry) and records NOTHING: no
//      recolor, no queue, no rollback needed. The Mapbox puck keeps the fix cache
//      warm while the map is open, so the gate costs ~no latency in the common case.
//   2. Patch the bootstrap cache SYNCHRONOUSLY (the visible feedback: the pin /
//      unit dot recolors this frame) and fire onAccepted — callers navigate there.
//   3. In the background: submit — or queue — the action with the stamp from step 1.
//      On a successful online write, reconcile the cache with the server's
//      authoritative result. A network failure is queued and retried by flushQueue.
//      A hard (4xx/5xx) failure won't be retried, so we re-sync to server truth and
//      tell the user.
//
// Returns the promise; callers fire-and-forget it — they must NOT await it before
// navigating (that's what onAccepted is for), or the tap-to-feedback delay comes back.
export function optimisticSubmit(qc, opts) {
  const {
    path,
    body = {},
    optimisticPatch,
    reconcile,
    pending = [],
    // Query keys to invalidate once the server CONFIRMS the write (result.ok). Opt-in per
    // caller because this helper also powers pin corrections, which don't change these. Used
    // to refresh the canvasser's daily stats (['mobile','me']) so the Today's Progress counter
    // updates the moment a knock/survey lands, not just on the slow poll / manual refresh.
    invalidateKeys = [],
    hardFailTitle = 'Not saved',
    hardFailMessage = 'Please try again.',
    // false = best-effort stamp (pin corrections): the write is not location-gated.
    requireFix = true,
    // Fired synchronously right after the optimistic patch lands — i.e. once the action
    // is definitely happening. Callers navigate here instead of unconditionally.
    onAccepted,
  } = opts;

  // If a submit to this exact path is already in flight, ignore the duplicate outright — the
  // first call already patched the cache; a second would just race to create another row.
  if (inFlightPaths.has(path)) return Promise.resolve(null);
  inFlightPaths.add(path);
  // Single-release guard: a blocked gate releases the lock so "Try again" can re-enter
  // optimisticSubmit (which re-acquires it) — the outer finally must not free the
  // retry's lock out from under it.
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      inFlightPaths.delete(path);
    }
  };

  const submitPromise = (async () => {
    // Step 1 — the location gate, BEFORE the optimistic patch: a blocked tap must
    // leave zero trace (nothing recorded, nothing queued, nothing recolored).
    let location = null;
    if (requireFix) {
      try {
        location = await getCanvassLocation();
      } catch (err) {
        release();
        return new Promise((resolve) => {
          locationBlockedAlert(err, {
            onCancel: () => resolve({ ok: false, queued: false, blocked: err.code || 'NO_FIX' }),
            onRetry: () => resolve(optimisticSubmit(qc, opts)),
          });
        });
      }
    } else {
      try {
        location = await getCurrentLocation();
      } catch {
        location = null; // pin fixes: best-effort stamp, never blocked
      }
    }

    // Step 2 — gate passed: register the unconfirmed status(es) BEFORE the patch so any
    // concurrent or subsequent server-sourced write is overlaid (reconcilePendingHouseholds).
    for (const p of pending) markPendingHousehold(p.id, p.status);

    writeBootstrap(qc, optimisticPatch);

    // Discard any bootstrap refetch that is in flight RIGHT NOW (e.g. a manual
    // pull-to-refresh). revert:false keeps the optimistic data we just wrote instead
    // of rolling the query back to its pre-fetch state. (The pending overlay covers
    // refetches that fire later; this just avoids a wasted in-flight one.)
    qc.cancelQueries({ queryKey: ['bootstrap'] }, { revert: false });

    if (onAccepted) onAccepted();

    const result = await submitOrQueue(path, {
      ...body,
      location,
      timestamp: new Date().toISOString(),
    });
    if (result.ok) {
      if (reconcile) writeBootstrap(qc, (prev) => reconcile(prev, result.response));
      // Server has now COMMITTED the action — refetch anything derived from it (the
      // canvasser's daily counts). Only on confirmed writes: a queued/offline write hasn't
      // been counted yet, so refetching would show the pre-knock number.
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      // Re-point each pending entry at the server-authoritative status we just
      // wrote, so the next server fetch (which returns that same status) CLEARS the
      // overlay instead of the overlay fighting the server forever.
      const cur = qc.getQueryData(['bootstrap']);
      const byId = new Map((cur?.households || []).map((h) => [String(h._id), h]));
      for (const p of pending) {
        const h = byId.get(String(p.id));
        if (h) markPendingHousehold(p.id, h.status);
      }
    } else if (!result.queued) {
      // Server rejected it (not a network drop) and submitOrQueue won't retry —
      // drop the optimistic claim and pull server truth back so it can't linger.
      for (const p of pending) clearPendingHousehold(p.id);
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      if (result.error?.data?.code === 'LOCATION_REQUIRED') {
        // The server backstop for the gate above (an old client, or a gate bypass).
        Alert.alert(
          'Location required',
          'This door needs a GPS stamp. Make sure location is on, then record it again.'
        );
      } else {
        Alert.alert(hardFailTitle, result.error?.message || hardFailMessage);
      }
    }
    // result.queued: keep the pending overlay; it clears once the flushed write
    // syncs and a later server fetch returns the matching status.
    flushQueue().catch(() => {});
    return result;
  })();
  // Clear the in-flight lock once the submit settles (success, queued, blocked, or error).
  submitPromise.finally(release);
  return submitPromise;
}

// Record a single-household action (not_home / wrong_address / lit_dropped),
// optimistically recoloring its pin (and the client-computed building aggregate)
// before the network call. Fire-and-forget: callers don't await it.
export function recordHouseholdAction(qc, householdId, action, { note = null, onAccepted } = {}) {
  const path = ACTION_PATHS[action];
  if (!path) throw new Error(`Unknown action: ${action}`);
  return optimisticSubmit(qc, {
    path: `/mobile/households/${householdId}/${path}`,
    body: { note },
    optimisticPatch: (prev) => setHouseholdStatus(prev, householdId, action),
    reconcile: (prev, response) => {
      const status = response?.household?.status;
      return status ? setHouseholdStatus(prev, householdId, status) : prev;
    },
    pending: [{ id: householdId, status: action }],
    // Refresh the canvasser's Today's Progress counts once the knock is recorded.
    invalidateKeys: [['mobile', 'me']],
    hardFailTitle: 'Action not saved',
    hardFailMessage: 'Could not record this action. Please try again.',
    onAccepted,
  });
}

// Correct a household's pin (canvasser). Optimistically moves it (held un-clobberable
// by pendingLocations until synced), offline-safe via the shared queue. coords in
// { lat, lng }; the endpoint is POST so flushQueue can replay a queued fix verbatim.
export function recordLocationCorrection(qc, householdId, { lat, lng, source, accuracy = null, scope = 'unit' }) {
  markPendingLocation(householdId, [lng, lat]);
  const p = optimisticSubmit(qc, {
    path: `/mobile/households/${householdId}/location`,
    body: { lat, lng, source, accuracy, scope },
    optimisticPatch: (prev) => setHouseholdLocation(prev, householdId, [lng, lat]),
    reconcile: (prev, response) => {
      const coords = response?.household?.location?.coordinates;
      return coords ? setHouseholdLocation(prev, householdId, coords) : prev;
    },
    pending: [], // location overlay is handled by pendingLocations, not the status overlay
    hardFailTitle: 'Pin not saved',
    hardFailMessage: 'Could not move this pin. Please try again.',
    // The moved coordinate comes from the map drag — the GPS stamp here is best-effort
    // provenance, so pin fixes are never location-gated (map hygiene must stay possible).
    requireFix: false,
  });
  // On a hard reject (not queued), drop the optimistic move so the invalidate that
  // optimisticSubmit fires restores the server's real (un-moved) coordinate.
  p.then((result) => {
    if (result && !result.ok && !result.queued) clearPendingLocation(householdId);
  }).catch(() => {});
  return p;
}
