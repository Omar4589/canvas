import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { loadActiveOrgId } from './cache';

const QUEUE_KEY = 'canvass.offlineQueue';

async function readQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeQueue(queue) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// Serialize every read-modify-write against the stored queue. enqueue() and a
// flush's removeItem() are both read-then-write, so without this an enqueue that
// interleaves a removeItem could resurrect a just-sent item (double-POST) or
// drop the newly-queued one. All mutations run one-at-a-time through this chain.
let mutationChain = Promise.resolve();
function withQueueLock(fn) {
  const run = mutationChain.then(fn, fn);
  mutationChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

/**
 * Enqueue a submission for offline retry.
 * Submission shape: { id, path, body, orgId, enqueuedAt }
 *
 * orgId is captured at RECORD time and pinned to the item: a multi-org user can sign back in
 * (a session revoke clears the active org) and pick a different org before the flush runs, and
 * without the pin their held knocks would flush under the wrong X-Org-Id — a 4xx the flush
 * loop treats as a bad submission and DROPS. Items enqueued before this field existed flush
 * under the active org, exactly as before.
 */
export function enqueue(path, body) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const orgId = await loadActiveOrgId();
    queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      path,
      body: { ...body, wasOfflineSubmission: true },
      ...(orgId ? { orgId } : {}),
      enqueuedAt: new Date().toISOString(),
    });
    await writeQueue(queue);
    return queue.length;
  });
}

export async function getPendingCount() {
  const queue = await readQueue();
  return queue.length;
}

export async function getPending() {
  return readQueue();
}

// Remove a flushed item by id against a fresh read (under the mutation lock), so
// submissions enqueued while the POST was in flight are never clobbered.
function removeItem(id) {
  return withQueueLock(async () => {
    const fresh = await readQueue();
    await writeQueue(fresh.filter((it) => it.id !== id));
  });
}

// "The credentials are dead, not the door." Any 401 (revoked/expired token), plus the
// temp-password gate's 403 (an admin reset this user mid-session — passwordGate.js). These are
// OUR auth lifecycle, never a verdict on the submission itself, so they must never drop a knock.
function isAuthFailure(err) {
  if (err.status === 401) return true;
  return err.status === 403 && err.data?.code === 'PASSWORD_CHANGE_REQUIRED';
}

async function doFlush() {
  let sent = 0;
  const errors = [];

  while (true) {
    const queue = await readQueue();
    if (queue.length === 0) break;
    const item = queue[0];
    try {
      // Pinned org header (see enqueue) — legacy items without one use the active org.
      await api(item.path, {
        method: 'POST',
        body: item.body,
        ...(item.orgId ? { orgId: item.orgId } : {}),
      });
      sent++;
      await removeItem(item.id);
    } catch (err) {
      // Network error: stop and try again later
      if (!err.status) {
        errors.push({ id: item.id, reason: err.message });
        break;
      }
      // AUTH failure: the SESSION is broken, not the submission. A 401 (token revoked by a
      // password reset, or expired) or the temp-password gate's 403 means every item behind
      // this one would fail identically — and dropping them would bin billable knocks a
      // canvasser already walked. HOLD everything and stop; the queue survives sign-out, so
      // the knocks flush on the first trigger after the user is signed back in (or completes
      // the forced password change, which hands this device a fresh token).
      if (isAuthFailure(err)) {
        errors.push({ id: item.id, reason: err.message, authBlocked: true });
        break;
      }
      // Other 4xx: drop the bad submission so it doesn't block the queue forever
      if (err.status >= 400 && err.status < 500) {
        errors.push({ id: item.id, reason: err.message, dropped: true });
        await removeItem(item.id);
        continue;
      }
      // 5xx: bail and retry later
      errors.push({ id: item.id, reason: err.message });
      break;
    }
  }

  return { sent, remaining: (await readQueue()).length, errors };
}

/**
 * Try to flush all pending submissions. Stops on the first network error.
 * Returns { sent, remaining, errors }.
 *
 * Concurrent callers share one in-flight flush — the map screen triggers this
 * from mount, AppState 'active', and NetInfo (which emits immediately on
 * subscribe), and overlapping flushes would double-POST the queue head.
 *
 * A call that arrives while a flush is running sets `flushAgain` so the loop
 * runs one more pass after the current one finishes. That closes two gaps:
 * (1) an item enqueued after doFlush's final empty read still gets sent (its
 * enqueuer's flushQueue call schedules the rerun), and (2) a flush that began
 * on a dead connection and bailed is retried when NetInfo/AppState fires during
 * it, instead of leaving the knocks stuck until the next unrelated trigger.
 */
let flushing = null;
let flushAgain = false;
export function flushQueue() {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    let result;
    do {
      flushAgain = false;
      result = await doFlush();
    } while (flushAgain);
    return result;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/**
 * Try the action online. If the failure is the server's fault, queue it.
 * Returns { ok, queued, response, error }.
 *
 * Queue on a transport error (no status) OR a 5xx — the same policy doFlush already applies above,
 * where a 5xx breaks out to retry later and only a 4xx is dropped. The two halves used to disagree:
 * intake queued transport errors only, so a 5xx was never enqueued at all, and the caller alerted
 * "Action not saved" and reverted the pin. The knock had already happened — the canvasser walked to
 * the door, spoke to a voter, and walked away — and it was gone. Billable work, unrecoverable.
 *
 * This bites hardest during a deploy: Heroku's maintenance page is a 503 with an HTML body, so a
 * phone WITH signal lost every knock and survey while a phone with NO signal queued them perfectly.
 *
 * A 4xx still surfaces. That one means the submission itself is invalid, and retrying it forever
 * would jam the queue behind a door that can never be recorded.
 */
export async function submitOrQueue(path, body) {
  try {
    const response = await api(path, { method: 'POST', body });
    return { ok: true, queued: false, response };
  } catch (err) {
    // Auth failures queue too: the knock HAPPENED — the canvasser is standing at the door —
    // and a revoked session (password reset elsewhere, admin temp reset mid-shift) is our
    // lifecycle problem, not the door's. The pin keeps its optimistic color with the pending
    // overlay, and the item flushes after re-auth. Only a true verdict on the submission
    // itself (any other 4xx) surfaces as a rejection.
    if (!err.status || err.status >= 500 || isAuthFailure(err)) {
      await enqueue(path, body);
      return { ok: false, queued: true, error: err };
    }
    return { ok: false, queued: false, error: err };
  }
}
