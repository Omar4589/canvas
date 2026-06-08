import { Alert } from 'react-native';
import { getCurrentLocation } from './location';
import { submitOrQueue, flushQueue } from './offlineQueue';
import { saveBootstrap } from './cache';

const ACTION_PATHS = { not_home: 'not-home', wrong_address: 'wrong-address', lit_dropped: 'lit-drop' };

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

// In-flight de-dup: request paths currently being submitted, so a rapid double-fire to the SAME
// target (a double-tap, or an offline-queue flush racing a live submit) collapses to one request.
// The server's unique (voter, pass) index is the final backstop; this just avoids the wasted second
// call + benign duplicate activity row. Cleared when the submit settles.
const inFlightPaths = new Set();

// Optimistic-first submit — the heart of the "recolor instantly" fix.
//
//   1. Patch the bootstrap cache SYNCHRONOUSLY (the visible feedback: the pin /
//      unit dot recolors and the client-computed building aggregate updates this
//      frame, before any GPS or network work happens).
//   2. In the background (never awaited by the UI): capture an accurate GPS fix
//      for the audit stamp, then submit — or queue — the action. On a successful
//      online write, reconcile the cache with the server's authoritative result
//      (e.g. a normalized status). A network failure is queued and retried by
//      flushQueue, so the optimistic state simply stands until it syncs. A hard
//      (4xx/5xx) failure won't be retried, so we re-sync to server truth and tell
//      the user.
//
// Returns the background promise; callers fire-and-forget it (navigate away
// immediately) — they must NOT await it, or the delay comes right back.
export function optimisticSubmit(qc, {
  path,
  body = {},
  optimisticPatch,
  reconcile,
  pending = [],
  hardFailTitle = 'Not saved',
  hardFailMessage = 'Please try again.',
}) {
  // If a submit to this exact path is already in flight, ignore the duplicate outright — the
  // first call already patched the cache; a second would just race to create another row.
  if (inFlightPaths.has(path)) return Promise.resolve(null);
  inFlightPaths.add(path);

  // Register the unconfirmed status(es) BEFORE the patch so any concurrent or
  // subsequent server-sourced write is overlaid (see reconcilePendingHouseholds).
  for (const p of pending) markPendingHousehold(p.id, p.status);

  writeBootstrap(qc, optimisticPatch);

  // Discard any bootstrap refetch that is in flight RIGHT NOW (e.g. a manual
  // pull-to-refresh). revert:false keeps the optimistic data we just wrote instead
  // of rolling the query back to its pre-fetch state. (The pending overlay covers
  // refetches that fire later; this just avoids a wasted in-flight one.)
  qc.cancelQueries({ queryKey: ['bootstrap'] }, { revert: false });

  const submitPromise = (async () => {
    let location = null;
    try {
      location = await getCurrentLocation();
    } catch {
      location = null; // permission/availability issue — record without a stamp
    }
    const result = await submitOrQueue(path, {
      ...body,
      location,
      timestamp: new Date().toISOString(),
    });
    if (result.ok) {
      if (reconcile) writeBootstrap(qc, (prev) => reconcile(prev, result.response));
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
      Alert.alert(hardFailTitle, result.error?.message || hardFailMessage);
    }
    // result.queued: keep the pending overlay; it clears once the flushed write
    // syncs and a later server fetch returns the matching status.
    flushQueue().catch(() => {});
    return result;
  })();
  // Clear the in-flight lock once the submit settles (success, queued, or error).
  submitPromise.finally(() => inFlightPaths.delete(path));
  return submitPromise;
}

// Record a single-household action (not_home / wrong_address / lit_dropped),
// optimistically recoloring its pin (and the client-computed building aggregate)
// before the network call. Fire-and-forget: callers don't await it.
export function recordHouseholdAction(qc, householdId, action, { note = null } = {}) {
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
    hardFailTitle: 'Action not saved',
    hardFailMessage: 'Could not record this action. Please try again.',
  });
}
