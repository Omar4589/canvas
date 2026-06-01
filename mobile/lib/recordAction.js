import { getCurrentLocation } from './location';
import { submitOrQueue, flushQueue } from './offlineQueue';
import { saveBootstrap } from './cache';

const ACTION_PATHS = { not_home: 'not-home', wrong_address: 'wrong-address', lit_dropped: 'lit-drop' };

// Record a single-household action (not_home / wrong_address / lit_dropped) —
// online or queued offline — and optimistically patch the ['bootstrap'] cache so
// the unit's status + any building aggregate update immediately. Returns the
// submitOrQueue result ({ ok, queued, response, error }).
export async function recordHouseholdAction(qc, householdId, action) {
  const path = ACTION_PATHS[action];
  if (!path) throw new Error(`Unknown action: ${action}`);
  const location = await getCurrentLocation();
  const result = await submitOrQueue(`/mobile/households/${householdId}/${path}`, {
    note: null,
    location,
    timestamp: new Date().toISOString(),
  });
  if (!result.ok && !result.queued) return result; // caller surfaces the error

  const updatedStatus = result.response?.household?.status ?? action;
  qc.setQueryData(['bootstrap'], (prev) => {
    if (!prev) return prev;
    const next = {
      ...prev,
      households: (prev.households || []).map((h) =>
        String(h._id) === String(householdId)
          ? { ...h, status: updatedStatus, lastActionAt: new Date().toISOString() }
          : h
      ),
    };
    saveBootstrap(next);
    return next;
  });
  flushQueue().catch(() => {});
  return result;
}
