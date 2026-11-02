// The offline queue's engine (docs/PROPOSAL_OFFLINE_QUEUE.md §C, §O).
//
// PLAIN MODULE — storage, the request function, the session's token and the kill switch are injected —
// so lib/queueCore.test.js drives every race under plain node, the sessionStore.js pattern.
// lib/offlineQueue.js wires it to AsyncStorage, api(), authState and the cached switch.
//
// Four stores, one lock:
//   canvass.offlineQueue     items waiting to upload. Each names who recorded it (`recordedBy`, the
//                            session's account id at the tap) and the house by id — never an address.
//   canvass.notSaved         what the server turned down: the line's fields only (what, when, why) — no
//                            survey answers, no address, no name. Only its recorder sees it; 30 days.
//   canvass.deletedAccounts  accounts the phone learned were deleted, 30 days: their items go at once.
//   canvass.queueNotices     the lines owed to the next person at the sign-in screen (a deleted
//                            account's items removed, someone's items that waited 30 days).
//
// The rules (lib/queueRules.js): an item uploads only while its recorder is signed in, with that
// session's token; a turned-down item moves to Not saved, never vanishes; with the kill switch off
// (MOBILE_QUEUE_HOLD) everything behaves as before: whoever is signed in uploads it.
import {
  classify,
  shouldQueue,
  isMine,
  heldStale,
  pruneNotSaved,
  groupWaiting,
  describePath,
} from './queueRules.js';
import { tokenSub } from './sessionEnd.js';

export const QUEUE_KEY = 'canvass.offlineQueue';
export const NOT_SAVED_KEY = 'canvass.notSaved';
export const DELETED_KEY = 'canvass.deletedAccounts';
export const NOTICES_KEY = 'canvass.queueNotices';
const DELETED_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export const createOfflineQueue = ({ storage, api, getToken, loadHold, loadActiveOrgId, now = () => Date.now() }) => {
  // A failed READ rejects (today's readQueue did too): falling back to [] would let the next write save
  // that empty list over every item. Only a missing or unparseable value reads as the fallback.
  const readJson = async (key, fallback) => {
    const raw = await storage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const writeJson = (key, value) => storage.setItem(key, JSON.stringify(value));

  const readQueue = async () => {
    const q = await readJson(QUEUE_KEY, []);
    return Array.isArray(q) ? q : [];
  };
  const readNotSavedRaw = async () => {
    const l = await readJson(NOT_SAVED_KEY, []);
    return Array.isArray(l) ? l : [];
  };
  const readDeleted = async () => {
    const d = await readJson(DELETED_KEY, []);
    const t = now();
    return (Array.isArray(d) ? d : []).filter((e) => e?.sub && Number.isFinite(e.at) && t - e.at <= DELETED_KEEP_MS);
  };
  const readNoticesRaw = async () => {
    const n = await readJson(NOTICES_KEY, null);
    return { deleted: n?.deleted?.count > 0 ? n.deleted : null, waited: Array.isArray(n?.waited) ? n.waited : [] };
  };

  // Who is signed in, from the session held in memory (never a cache a sign-out clears).
  const currentSub = () => {
    const token = getToken();
    return typeof token === 'string' ? tokenSub(token) : null;
  };
  const holdOn = async () => {
    try {
      return (await loadHold()) !== false;
    } catch {
      return true; // the switch only ever turns the hold OFF on purpose
    }
  };

  // Serialize every read-modify-write against the four stores. An enqueue that interleaved a flush's
  // removal could resurrect a just-sent item (double-POST) or drop the newly queued one.
  let chain = Promise.resolve();
  const withLock = (fn) => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  };

  const listeners = new Set();
  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // a screen's listener must never break the queue
      }
    }
  };
  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const addNotice = (notices, kind, value) => {
    if (kind === 'deleted') {
      notices.deleted = { count: (notices.deleted?.count || 0) + value, at: now() };
    } else {
      for (const { name, count } of value) {
        const row = notices.waited.find((w) => w.name === name);
        if (row) row.count += count;
        else notices.waited.push({ name, count });
      }
    }
    return notices;
  };

  /**
   * Queue a save. `stamp` is taken at the tap (lib/recordAction.js optimisticSubmit): who recorded it,
   * their short name for the waiting line, when, and the house. The org is pinned here as before.
   */
  const enqueue = (path, body, stamp = {}) =>
    withLock(async () => {
      const queue = await readQueue();
      const orgId = await loadActiveOrgId();
      const id = `${now()}-${Math.random().toString(36).slice(2, 8)}`;
      queue.push({
        id,
        path,
        // queueItemId lets the server file one row per item, however many times it's resent.
        body: { ...body, wasOfflineSubmission: true, queueItemId: id },
        ...(orgId ? { orgId } : {}),
        enqueuedAt: new Date(now()).toISOString(),
        v: 2,
        recordedBy: stamp.recordedBy || null,
        recorderName: stamp.recorderName || null,
        tapAt: stamp.tapAt || null,
        householdId: stamp.householdId || describePath(path).householdId || null,
        campaignId: stamp.campaignId || null,
      });
      await writeJson(QUEUE_KEY, queue);
      emit();
      return queue.length;
    });

  // The items the signed-in person can send: theirs, plus pre-update items (no recorder yet), which the
  // next flush stamps as theirs. With the hold off: everything, as before.
  const mineFilter = (sub, hold) => (it) => isMine(it, sub, hold) || (hold && !!sub && !it.recordedBy);

  const getPending = async () => {
    const hold = await holdOn();
    return (await readQueue()).filter(mineFilter(currentSub(), hold));
  };
  const getPendingCount = async () => (await getPending()).length;

  /** Someone else's items on this phone, and items from before the update (the waiting lines). */
  const getWaiting = async () => groupWaiting(await readQueue(), currentSub(), await holdOn());

  /** The signed-in person's Not saved entries, newest first. Nobody else ever sees them. */
  const getNotSaved = async () => {
    const sub = currentSub();
    if (!sub) return [];
    return pruneNotSaved(await readNotSavedRaw(), now())
      .filter((e) => e.recordedBy === sub)
      .sort((a, b) => String(b.refusedAt).localeCompare(String(a.refusedAt)));
  };

  const removeNotSaved = (id) =>
    withLock(async () => {
      const sub = currentSub();
      const list = await readNotSavedRaw();
      const next = list.filter((e) => !(e.id === id && e.recordedBy === sub));
      if (next.length !== list.length) {
        await writeJson(NOT_SAVED_KEY, next);
        emit();
      }
    });

  const readNotices = () => readNoticesRaw();
  // A sign-in reads the lines once (the sign-in screen showed them); clear them for the next person.
  const clearNotices = () =>
    withLock(async () => {
      await storage.removeItem(NOTICES_KEY);
      emit();
    });

  // A deleted account (§E2): remember it 30 days, and remove its queued items and Not saved entries.
  // Called by the session store's sign-out for reason 'deleted', at app start, and after a person
  // deletes their own account. Counted into the sign-in screen's line. With the kill switch off the
  // phone behaves as before the fix — the items stay and go up under whoever signs in next — but the
  // account is still remembered, so the flush removes them if the switch comes back on.
  const cleanupDeletedAccount = (sub) =>
    withLock(async () => {
      if (!sub) return 0;
      const deleted = await readDeleted();
      if (!deleted.some((d) => d.sub === sub)) deleted.push({ sub, at: now() });
      await writeJson(DELETED_KEY, deleted);
      if (!(await holdOn())) {
        emit();
        return 0;
      }
      const queue = await readQueue();
      const kept = queue.filter((it) => it.recordedBy !== sub);
      const removed = queue.length - kept.length;
      if (removed) {
        await writeJson(QUEUE_KEY, kept);
        await writeJson(NOTICES_KEY, addNotice(await readNoticesRaw(), 'deleted', removed));
      }
      const list = await readNotSavedRaw();
      const keptEntries = list.filter((e) => e.recordedBy !== sub);
      if (keptEntries.length !== list.length) await writeJson(NOT_SAVED_KEY, keptEntries);
      emit();
      return removed;
    });

  // Steps 1–3 of a flush, ONE locked write that reads the session inside the lock (§O):
  //   1. stamp every pre-update item with the signed-in person;
  //   2. remove a deleted account's items;
  //   3. remove someone else's items once they've waited 30 days (heldSince first stamped here).
  // Plus every recorder's Not saved entries past 30 days, and deleted accounts past theirs. With the hold
  // off, none of 1–3 runs.
  const prepare = (hold) =>
    withLock(async () => {
      const sub = currentSub();
      const t = now();
      let queue = await readQueue();
      let changed = false;
      let notices = null;
      if (hold) {
        if (sub) {
          for (const it of queue) {
            if (!it.recordedBy) {
              it.recordedBy = sub;
              it.v = 2;
              changed = true;
            }
          }
        }
        const dead = new Set((await readDeleted()).map((d) => d.sub));
        if (dead.size) {
          const kept = queue.filter((it) => !(it.recordedBy && dead.has(it.recordedBy)));
          if (kept.length !== queue.length) {
            notices = addNotice(notices || (await readNoticesRaw()), 'deleted', queue.length - kept.length);
            queue = kept;
            changed = true;
          }
        }
        if (sub) {
          for (const it of queue) {
            if (it.recordedBy && it.recordedBy !== sub && !it.heldSince) {
              it.heldSince = t;
              changed = true;
            } else if (it.recordedBy === sub && it.heldSince) {
              // The recorder is back: the 30 days count only while someone else holds the phone.
              delete it.heldSince;
              changed = true;
            }
          }
          const stale = queue.filter((it) => it.recordedBy && it.recordedBy !== sub && heldStale(it, t));
          if (stale.length) {
            const byName = new Map();
            for (const it of stale) {
              const name = it.recorderName || null;
              byName.set(name, (byName.get(name) || 0) + 1);
            }
            notices = addNotice(notices || (await readNoticesRaw()), 'waited', [...byName].map(([name, count]) => ({ name, count })));
            const staleIds = new Set(stale.map((it) => it.id));
            queue = queue.filter((it) => !staleIds.has(it.id));
            changed = true;
          }
        }
      }
      if (changed) await writeJson(QUEUE_KEY, queue);
      if (notices) await writeJson(NOTICES_KEY, notices);
      const list = await readNotSavedRaw();
      const pruned = pruneNotSaved(list, t);
      if (pruned.length !== list.length) await writeJson(NOT_SAVED_KEY, pruned);
      // A deleted account is forgotten after its 30 days: readDeleted already skips it, this drops its
      // id from the phone.
      const remembered = await readJson(DELETED_KEY, []);
      const live = await readDeleted();
      if (!Array.isArray(remembered) || remembered.length !== live.length) await writeJson(DELETED_KEY, live);
      if (changed || notices || pruned.length !== list.length) emit();
    });

  // Remove a sent item by id against a fresh read, so items queued meanwhile are never clobbered.
  const removeItem = (id) =>
    withLock(async () => {
      const fresh = await readQueue();
      await writeJson(QUEUE_KEY, fresh.filter((it) => it.id !== id));
      emit();
    });

  // A turned-down item leaves the queue for Not saved — the line's fields only, never the body. Not saved
  // is written FIRST: if the second write fails the item is still queued, and its resend is refused again
  // and lands here once (the id is skipped if it's already listed), instead of vanishing from both.
  const refuse = (item, err, sub) =>
    withLock(async () => {
      const { kind, actionType, householdId } = describePath(item.path);
      const list = await readNotSavedRaw();
      if (!list.some((e) => e.id === item.id)) {
        list.push({
          id: item.id,
          recordedBy: item.recordedBy || sub || null,
          tapAt: item.tapAt || item.enqueuedAt || null,
          refusedAt: new Date(now()).toISOString(),
          kind,
          actionType,
          householdId: item.householdId || householdId || null,
          status: err?.status ?? null,
          code: err?.data?.code ?? null,
          message: err?.data?.error ?? err?.message ?? null,
          // Only possible with the hold off: it went up under someone else and was refused for them.
          sentAsOther: !!(item.recordedBy && sub && item.recordedBy !== sub),
        });
        await writeJson(NOT_SAVED_KEY, list);
      }
      const fresh = await readQueue();
      await writeJson(QUEUE_KEY, fresh.filter((it) => it.id !== item.id));
      emit();
    });

  // Who hears each uploaded write's automatic-pause answer (docs/PROPOSAL_PACE_PAUSE.md §E.2), and who
  // hears a refusal — registered in app/_layout.jsx, which owns the cached state this module can't
  // import. A refusal clears that door's pending marks (onItem) and the bootstrap is refetched ONCE per
  // pass (onPass): a survey switch can refuse dozens at once, and each refetch is the whole roster.
  let paceSink = null;
  const setFlushPaceSink = (fn) => {
    paceSink = fn;
  };
  let refusalSink = null;
  const setFlushRefusalSink = (sink) => {
    refusalSink = sink;
  };

  const doFlush = async () => {
    const hold = await holdOn();
    await prepare(hold);
    let sent = 0;
    let refusedAny = false;
    const errors = [];
    // Sends run OUTSIDE the lock (a send can take 20 s); each removal takes it.
    while (true) {
      const token = getToken();
      if (typeof token !== 'string') break;
      const sub = tokenSub(token);
      const queue = await readQueue();
      const item = queue.find((it) => isMine(it, sub, hold));
      if (!item) break;
      try {
        // The token read for THIS item is the one it's sent with: a sign-in mid-flush can't move it.
        const response = await api(item.path, {
          method: 'POST',
          body: item.body,
          token,
          ...(item.orgId ? { orgId: item.orgId } : {}),
        });
        sent += 1;
        await removeItem(item.id);
        // The pause answer is about the account it was sent as: never into a session that began meanwhile.
        if (paceSink && response?.pace && getToken() === token) {
          Promise.resolve().then(() => paceSink(response.pace, item)).catch(() => {});
        }
      } catch (err) {
        const verdict = classify(err);
        if (verdict === 'refused') {
          await refuse(item, err, sub);
          refusedAny = true;
          try {
            refusalSink?.onItem?.(item);
          } catch {
            // the screen's cleanup must never stop the flush
          }
          continue;
        }
        errors.push({ id: item.id, reason: err?.message, ...(verdict === 'hold' ? { authBlocked: true } : {}) });
        break;
      }
    }
    if (refusedAny) {
      try {
        refusalSink?.onPass?.();
      } catch {
        // as above
      }
    }
    return { sent, remaining: (await readQueue()).length, errors };
  };

  // Concurrent callers share one in-flight flush (the map triggers it from mount, AppState 'active' and
  // NetInfo); a call that arrives during a flush runs one more pass after it.
  let flushing = null;
  let flushAgain = false;
  const flushQueue = () => {
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
  };

  /**
   * Try the save online; queue it if the failure isn't a verdict on the door. Returns { ok, queued,
   * response, error, held }. If the session changed since the tap (someone else signed in during the
   * GPS wait or a prompt), it's never sent under the new person: it's queued, held for its recorder.
   */
  const submitOrQueue = async (path, body, stamp = {}) => {
    const hold = await holdOn();
    const token = getToken();
    const sub = typeof token === 'string' ? tokenSub(token) : null;
    if (hold && stamp.recordedBy && sub !== stamp.recordedBy) {
      await enqueue(path, body, stamp);
      return { ok: false, queued: true, held: true };
    }
    try {
      const response = await api(path, { method: 'POST', body, ...(typeof token === 'string' ? { token } : {}) });
      return { ok: true, queued: false, response };
    } catch (err) {
      if (shouldQueue(err)) {
        await enqueue(path, body, stamp);
        return { ok: false, queued: true, error: err };
      }
      return { ok: false, queued: false, error: err };
    }
  };

  /**
   * Steps 1–3 of a flush, without sending — run by every sign-out before the session is cleared
   * (app/_layout.jsx), so pre-update items are stamped as the ending account's and can't go up under
   * whoever signs in next.
   */
  const prepareQueue = async () => prepare(await holdOn());

  /** At app start: prune Not saved, and finish any deleted account's cleanup (it survives a restart). */
  const startupCleanup = async () => {
    const deleted = await readDeleted();
    for (const { sub } of deleted) await cleanupDeletedAccount(sub);
    await prepare(await holdOn());
  };

  return {
    enqueue,
    submitOrQueue,
    flushQueue,
    getPending,
    getPendingCount,
    getWaiting,
    getNotSaved,
    removeNotSaved,
    readNotices,
    clearNotices,
    cleanupDeletedAccount,
    prepareQueue,
    startupCleanup,
    setFlushPaceSink,
    setFlushRefusalSink,
    subscribe,
  };
};
