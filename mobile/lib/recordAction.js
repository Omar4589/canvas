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
  hardFailTitle = 'Not saved',
  hardFailMessage = 'Please try again.',
}) {
  writeBootstrap(qc, optimisticPatch);

  // Discard any bootstrap refetch that is in flight RIGHT NOW (e.g. a manual
  // pull-to-refresh, or a stale-data refetch a screen kicked off on mount). If it
  // resolved after this patch but before the background write below lands, it
  // would carry PRE-action data and clobber the recolor — the blue→grey→blue
  // flicker canvassers saw. revert:false keeps the optimistic data we just wrote
  // instead of rolling the query back to its pre-fetch (grey) state.
  qc.cancelQueries({ queryKey: ['bootstrap'] }, { revert: false });

  return (async () => {
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
    if (result.ok && reconcile) {
      writeBootstrap(qc, (prev) => reconcile(prev, result.response));
    } else if (!result.ok && !result.queued) {
      // Server rejected it (not a network drop) and submitOrQueue won't retry —
      // pull server truth back so the optimistic change can't linger as a lie.
      qc.invalidateQueries({ queryKey: ['bootstrap'] });
      Alert.alert(hardFailTitle, result.error?.message || hardFailMessage);
    }
    flushQueue().catch(() => {});
    return result;
  })();
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
    hardFailTitle: 'Action not saved',
    hardFailMessage: 'Could not record this action. Please try again.',
  });
}
