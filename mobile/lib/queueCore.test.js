import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineQueue, QUEUE_KEY, NOT_SAVED_KEY, DELETED_KEY, NOTICES_KEY } from './queueCore.js';
import { reasonText } from './queueRules.js';
import { doorResultPath, surveyPath } from './doorPaths.js';

// The offline queue's engine under plain node (docs/PROPOSAL_OFFLINE_QUEUE.md §C, §F, §O): storage, the
// server, the session's token, the kill switch and the clock are all fakes the test controls, the way
// sessionStore.test.js drives the session store.

const DAY = 24 * 60 * 60 * 1000;
const H1 = '1'.repeat(24);
const H2 = '2'.repeat(24);

// A token shaped like the server's (only `sub` is ever read, unverified — lib/sessionEnd.js tokenSub).
const tokenFor = (sub) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
const answer = (status, data = {}) => Object.assign(new Error(data.error || 'x'), { status, data: { error: 'x', ...data } });

// `failGet` / `failSet`: keys whose next read or write fails once (an I/O error, Android's row limit).
const memoryStorage = () => {
  const map = new Map();
  const failGet = new Set();
  const failSet = new Set();
  return {
    map,
    failGet,
    failSet,
    getItem: async (k) => {
      if (failGet.delete(k)) throw new Error('read failed');
      return map.has(k) ? map.get(k) : null;
    },
    setItem: async (k, v) => {
      if (failSet.delete(k)) throw new Error('write failed');
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
};

// One phone: who's signed in, the switch, the clock and what the server answers are settable.
const phone = ({ hold = true, start = Date.UTC(2026, 10, 1, 15) } = {}) => {
  const storage = memoryStorage();
  const state = { token: null, hold, t: start, calls: [], respond: async () => ({ ok: true }) };
  const api = async (path, opts) => {
    state.calls.push({ path, ...opts });
    return state.respond(path, opts);
  };
  const q = createOfflineQueue({
    storage,
    api,
    getToken: () => state.token,
    loadHold: async () => state.hold,
    loadActiveOrgId: async () => 'org1',
    now: () => state.t,
  });
  const read = async (key, fallback) => {
    const raw = await storage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  };
  return {
    q,
    state,
    storage,
    signIn: (sub) => {
      state.token = sub ? tokenFor(sub) : null;
    },
    queue: () => read(QUEUE_KEY, []),
    notSaved: () => read(NOT_SAVED_KEY, []),
    deleted: () => read(DELETED_KEY, []),
    notices: () => read(NOTICES_KEY, null),
  };
};

const stampFor = (sub, name, householdId = H1) => ({ recordedBy: sub, recorderName: name, tapAt: '2026-11-01T15:00:00.000Z', householdId, campaignId: 'c1' });

test('an item uploads only while its recorder is signed in, with the token read for it', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), { turfId: 't1' }, stampFor('A', 'Ann A.'));
  p.signIn('B');
  const r1 = await p.q.flushQueue();
  assert.equal(p.state.calls.length, 0, "never sent under B's session");
  assert.equal(r1.remaining, 1);
  assert.equal(await p.q.getPendingCount(), 0, "B's badge doesn't count Ann's item");
  assert.deepEqual((await p.q.getWaiting()).others, [{ recordedBy: 'A', name: 'Ann A.', count: 1 }]);
  assert.equal((await p.queue())[0].heldSince, p.state.t, 'first seen waiting while B was signed in');

  p.signIn('A');
  assert.equal(await p.q.getPendingCount(), 1);
  const r2 = await p.q.flushQueue();
  assert.equal(r2.sent, 1);
  assert.equal(p.state.calls.length, 1);
  const call = p.state.calls[0];
  assert.equal(call.token, tokenFor('A'));
  assert.equal(call.orgId, 'org1', 'pinned to the org it was recorded in');
  assert.equal(call.body.wasOfflineSubmission, true);
  assert.equal(typeof call.body.queueItemId, 'string');
  assert.equal(call.body.turfId, 't1');
  assert.deepEqual(await p.queue(), []);
});

test('a sign-in during a flush never moves an item to the new person', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  p.state.respond = async () => {
    p.signIn('B'); // B signs in while A's first item is in the air
    return { ok: true };
  };
  await p.q.flushQueue();
  assert.equal(p.state.calls.length, 1, "A's second item is held, not sent with B's token");
  assert.equal(p.state.calls[0].token, tokenFor('A'));
  assert.equal((await p.queue()).length, 1);
});

test('pre-update items are all stamped with the person signed in, in one write, before anything is sent', async () => {
  const p = phone();
  const legacy = [1, 2, 3].map((i) => ({
    id: `old-${i}`,
    path: doorResultPath(H1, 'not_home'),
    body: { wasOfflineSubmission: true },
    orgId: 'org1',
    enqueuedAt: '2026-10-31T12:00:00.000Z',
  }));
  await p.storage.setItem(QUEUE_KEY, JSON.stringify(legacy));

  // Signed out: one line says what will happen to them.
  assert.equal((await p.q.getWaiting()).unstamped, 3);
  p.signIn('B');
  assert.equal((await p.q.getWaiting()).unstamped, 0);
  assert.equal(await p.q.getPendingCount(), 3, 'they count on the badge of whoever is signed in');

  p.state.respond = async () => {
    throw new Error('Network request failed'); // the first send stops the flush
  };
  await p.q.flushQueue();
  const q = await p.queue();
  assert.equal(q.length, 3);
  assert.ok(q.every((it) => it.recordedBy === 'B' && it.v === 2), 'every one stamped, not just the first');
  assert.equal(p.state.calls[0].token, tokenFor('B'));
});

test('someone else’s items go 30 days after the phone first saw them waiting', async () => {
  const p = phone();
  p.signIn('A');
  // Ann's phone clock was 40 days behind at the tap.
  p.state.t -= 40 * DAY;
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.state.t += 40 * DAY;

  // Ann's own sessions never age her items (offline, so it stays).
  p.state.respond = async () => {
    throw new Error('offline');
  };
  await p.q.flushQueue();
  assert.equal((await p.queue()).length, 1);
  assert.equal((await p.queue())[0].heldSince, undefined);

  p.signIn('B');
  p.state.respond = async () => ({ ok: true });
  await p.q.flushQueue();
  assert.equal((await p.queue()).length, 1, 'the corrected clock alone removes nothing');
  assert.equal(p.state.calls.length, 1, "only Ann's own offline try; nothing went up under B");
  p.state.t += 29 * DAY;
  await p.q.flushQueue();
  assert.equal((await p.queue()).length, 1);
  p.state.t += 2 * DAY;
  await p.q.flushQueue();
  assert.deepEqual(await p.queue(), []);
  assert.deepEqual((await p.q.readNotices()).waited, [{ name: 'Ann A.', count: 1 }]);

  await p.q.clearNotices();
  assert.deepEqual(await p.q.readNotices(), { deleted: null, waited: [] });
});

test('a refusal moves the item to Not saved with the line’s fields only, for its recorder only', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'refused'), { note: 'dog at the door', turfId: 't1' }, stampFor('A', 'Ann A.'));
  await p.q.enqueue(surveyPath('v1'), { answers: [{ q: 'support', a: 'yes' }] }, stampFor('A', 'Ann A.', H2));
  const sink = { items: [], passes: 0 };
  p.q.setFlushRefusalSink({ onItem: (it) => sink.items.push(it.id), onPass: () => (sink.passes += 1) });
  p.state.respond = async () => {
    throw answer(403, { error: 'You are not assigned to this campaign.', code: 'NOT_ASSIGNED' });
  };
  const r = await p.q.flushQueue();
  assert.equal(r.remaining, 0, 'both left the queue');
  assert.equal(sink.items.length, 2, "each refusal clears that door's marks");
  assert.equal(sink.passes, 1, 'the bootstrap is refetched once per pass, not once per refusal');

  const stored = await p.notSaved();
  assert.equal(stored.length, 2);
  for (const e of stored) {
    assert.deepEqual(
      Object.keys(e).sort(),
      ['actionType', 'code', 'householdId', 'id', 'kind', 'message', 'recordedBy', 'refusedAt', 'sentAsOther', 'status', 'tapAt'],
      'no body, no answers, no note, no address, no name'
    );
  }
  assert.ok(!JSON.stringify(stored).includes('dog at the door'));
  assert.ok(!JSON.stringify(stored).includes('support'));
  const door = stored.find((e) => e.kind === 'result');
  assert.equal(door.actionType, 'refused');
  assert.equal(door.householdId, H1);
  assert.equal(door.code, 'NOT_ASSIGNED');
  assert.equal(stored.find((e) => e.kind === 'survey').householdId, H2, "a survey's house comes from the stamp");

  assert.equal((await p.q.getNotSaved()).length, 2);
  p.signIn('B');
  assert.deepEqual(await p.q.getNotSaved(), [], 'nobody else ever sees them');
  await p.q.removeNotSaved(door.id);
  assert.equal((await p.notSaved()).length, 2, "B can't remove Ann's entry");
  p.signIn('A');
  await p.q.removeNotSaved(door.id);
  assert.equal((await p.q.getNotSaved()).length, 1);

  // 30 days on, the next flush prunes it.
  p.state.t += 31 * DAY;
  await p.q.flushQueue();
  assert.deepEqual(await p.notSaved(), []);
});

test('a sign-in problem holds the item; no answer or a server error retries it', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.state.respond = async () => {
    throw answer(401, { code: 'SESSION_REVOKED' });
  };
  const held = await p.q.flushQueue();
  assert.equal(held.errors[0].authBlocked, true);
  assert.equal((await p.queue()).length, 1);
  for (const err of [answer(500), answer(429), new Error('Network request failed'), { status: 502, data: null }]) {
    p.state.respond = async () => {
      throw err;
    };
    await p.q.flushQueue();
    assert.equal((await p.queue()).length, 1, String(err.status || err.message));
  }
  assert.deepEqual(await p.notSaved(), []);
});

test('a deleted account: its items and Not saved entries go, it is remembered 30 days, and the next person sees a line', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  await p.storage.setItem(NOT_SAVED_KEY, JSON.stringify([{ id: 'n1', recordedBy: 'A', refusedAt: new Date(p.state.t).toISOString() }]));
  p.signIn('B');
  await p.q.enqueue(doorResultPath(H1, 'lit_dropped'), {}, stampFor('B', 'Bo B.'));

  assert.equal(await p.q.cleanupDeletedAccount('A'), 2);
  const left = await p.queue();
  assert.equal(left.length, 1);
  assert.equal(left[0].recordedBy, 'B');
  assert.deepEqual(await p.notSaved(), []);
  assert.equal((await p.q.readNotices()).deleted.count, 2);
  assert.deepEqual((await p.deleted()).map((d) => d.sub), ['A']);

  // A save of Ann's that lands after the cleanup is removed by the next flush, never sent as B.
  await p.q.enqueue(doorResultPath(H1, 'refused'), {}, stampFor('A', 'Ann A.'));
  await p.q.flushQueue();
  assert.ok(p.state.calls.every((c) => c.token === tokenFor('B')));
  assert.equal(p.state.calls.length, 1, "only B's own item went up");
  assert.deepEqual(await p.queue(), []);
  assert.equal((await p.q.readNotices()).deleted.count, 3);

  // Remembered across a restart for 30 days, then forgotten.
  await p.q.startupCleanup();
  assert.equal((await p.deleted()).length, 1);
  p.state.t += 31 * DAY;
  await p.q.startupCleanup();
  assert.deepEqual(await p.deleted(), []);
});

test('the E2 order: a save answered with the deletion is never queued, and nothing reaches the next account', async () => {
  const p = phone();
  p.signIn('A');
  // An item queued earlier, then the account is deleted.
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  const deleted401 = () => Object.assign(answer(401, { code: 'SESSION_REVOKED', reason: 'deleted' }), { reason: 'deleted' });
  p.state.respond = async () => {
    throw deleted401();
  };
  const live = await p.q.submitOrQueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  assert.deepEqual([live.ok, live.queued], [false, false], 'the door says it was not saved');
  await p.q.flushQueue();
  assert.equal((await p.queue()).length, 1, 'held, not refused, until the sign-out runs the cleanup');

  // lib/sessionStore.js signs out for reason 'deleted' and runs the cleanup with the ended token's sub.
  await p.q.cleanupDeletedAccount('A');
  p.signIn('B');
  p.state.calls.length = 0;
  p.state.respond = async () => ({ ok: true });
  await p.q.flushQueue();
  assert.equal(p.state.calls.length, 0, 'nothing of Ann’s goes up under B');
  assert.deepEqual(await p.queue(), []);
});

test('submitOrQueue: a session that changed since the tap only queues; a refusal is not queued', async () => {
  const p = phone();
  p.signIn('B');
  const held = await p.q.submitOrQueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  assert.deepEqual(held, { ok: false, queued: true, held: true });
  assert.equal(p.state.calls.length, 0);

  const ok = await p.q.submitOrQueue(doorResultPath(H2, 'not_home'), {}, stampFor('B', 'Bo B.', H2));
  assert.equal(ok.ok, true);
  assert.equal(p.state.calls[0].token, tokenFor('B'));

  p.state.respond = async () => {
    throw new Error('Network request failed');
  };
  const offline = await p.q.submitOrQueue(doorResultPath(H2, 'refused'), {}, stampFor('B', 'Bo B.', H2));
  assert.equal(offline.queued, true);

  p.state.respond = async () => {
    throw answer(403, { code: 'NOT_ASSIGNED' });
  };
  const refused = await p.q.submitOrQueue(doorResultPath(H2, 'lit_dropped'), {}, stampFor('B', 'Bo B.', H2));
  assert.deepEqual([refused.ok, refused.queued, refused.error.status], [false, false, 403]);
  assert.equal((await p.queue()).length, 2, "Ann's held item and Bo's offline one");
});

test('the kill switch off: everything uploads under whoever is signed in, as before', async () => {
  const p = phone({ hold: false });
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  p.signIn('B');
  assert.equal(await p.q.getPendingCount(), 2);
  assert.deepEqual(await p.q.getWaiting(), { others: [], unstamped: 0 }, 'no waiting lines');

  let n = 0;
  p.state.respond = async () => {
    n += 1;
    if (n === 2) throw answer(403, { code: 'NOT_ASSIGNED' });
    return { ok: true };
  };
  await p.q.flushQueue();
  assert.equal(p.state.calls.length, 2);
  assert.ok(p.state.calls.every((c) => c.token === tokenFor('B')));
  const [entry] = await p.notSaved();
  assert.equal(entry.sentAsOther, true);
  assert.equal(entry.recordedBy, 'A', 'listed for the person who recorded it');
  assert.equal(reasonText(entry), 'It uploaded while someone else was signed in.');

  // No 30-day removal and no heldSince with the switch off.
  await p.q.enqueue(doorResultPath(H1, 'refused'), {}, stampFor('A', 'Ann A.'));
  p.state.respond = async () => {
    throw new Error('offline');
  };
  p.state.t += 60 * DAY;
  await p.q.flushQueue();
  const q = await p.queue();
  assert.equal(q.length, 1);
  assert.equal(q[0].heldSince, undefined);

  // A session that changed since the tap still sends (today's behavior).
  p.state.respond = async () => ({ ok: true });
  const r = await p.q.submitOrQueue(doorResultPath(H2, 'refused'), {}, stampFor('A', 'Ann A.', H2));
  assert.equal(r.ok, true);
});

test('the kill switch off covers the deleted-account removal too; switched back on, the flush finishes it', async () => {
  const p = phone({ hold: false });
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.state.respond = async () => {
    throw new Error('offline');
  };
  assert.equal(await p.q.cleanupDeletedAccount('A'), 0);
  assert.equal((await p.queue()).length, 1, 'kept, as before the fix');
  assert.deepEqual((await p.deleted()).map((d) => d.sub), ['A'], 'but remembered');
  assert.equal(await p.q.readNotices().then((n) => n.deleted), null);

  p.state.hold = true;
  p.signIn('B');
  await p.q.flushQueue();
  assert.deepEqual(await p.queue(), []);
  assert.equal((await p.q.readNotices()).deleted.count, 1);
});

test('an enqueue during a flush is never lost or resent; concurrent flushes share one run', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  p.state.respond = async () => {
    await gate;
    return { ok: true };
  };
  const first = p.q.flushQueue();
  const second = p.q.flushQueue();
  assert.equal(first, second, 'one in-flight flush');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  release();
  const r = await first;
  assert.equal(r.remaining, 0, 'the item queued mid-flush went up on the extra pass');
  assert.equal(p.state.calls.length, 2, 'each item sent exactly once');
  assert.notEqual(p.state.calls[0].body.queueItemId, p.state.calls[1].body.queueItemId);
});

test('signed out: nothing is sent, and the queue’s badge is empty', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.signIn(null);
  const r = await p.q.flushQueue();
  assert.equal(r.sent, 0);
  assert.equal(p.state.calls.length, 0);
  assert.equal(await p.q.getPendingCount(), 0);
  assert.deepEqual((await p.q.getWaiting()).others, [{ recordedBy: 'A', name: 'Ann A.', count: 1 }]);
  assert.equal((await p.queue())[0].heldSince, undefined, 'only someone else being signed in starts the 30 days');
});

test('a failed storage read never saves an empty queue over the items', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  p.storage.failGet.add(QUEUE_KEY);
  await assert.rejects(p.q.enqueue(doorResultPath(H1, 'refused'), {}, stampFor('A', 'Ann A.')));
  assert.equal((await p.queue()).length, 2, 'both earlier saves are still there');

  // The same inside a flush's removal: the item that went up is the only one that leaves.
  await p.q.enqueue(doorResultPath(H1, 'lit_dropped'), {}, stampFor('A', 'Ann A.'));
  let calls = 0;
  p.state.respond = async () => {
    calls += 1;
    if (calls === 1) p.storage.failGet.add(QUEUE_KEY); // the removal's fresh read fails
    return { ok: true };
  };
  await p.q.flushQueue().catch(() => {});
  assert.equal((await p.queue()).length, 3, 'nothing removed when the read failed (the resend is answered as the same delivery)');
});

test('a refusal whose queue write fails stays queued, and lands in Not saved once', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.state.respond = async () => {
    throw answer(403, { code: 'NOT_ASSIGNED' });
  };
  p.storage.failSet.add(QUEUE_KEY);
  await p.q.flushQueue().catch(() => {});
  assert.equal((await p.queue()).length, 1, 'still queued');
  assert.equal((await p.notSaved()).length, 1, 'already listed');
  await p.q.flushQueue();
  assert.deepEqual(await p.queue(), []);
  assert.equal((await p.notSaved()).length, 1, 'listed once, not twice');

  // Not saved's own write failing leaves the item queued, never in neither store.
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  p.storage.failSet.add(NOT_SAVED_KEY);
  await p.q.flushQueue().catch(() => {});
  assert.equal((await p.queue()).length, 1);
});

test('the 30 days start again after the recorder signs back in', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  p.state.respond = async () => {
    throw new Error('offline');
  };
  p.signIn('B');
  await p.q.flushQueue(); // day 0: held for Ann
  p.state.t += 20 * DAY;
  p.signIn('A');
  await p.q.flushQueue(); // day 20: Ann is back, still no signal
  assert.equal((await p.queue())[0].heldSince, undefined);
  p.signIn('B');
  await p.q.flushQueue(); // the 30 days start again
  p.state.t += 11 * DAY;
  await p.q.flushQueue(); // day 31 of the first wait, day 11 of this one
  assert.equal((await p.queue()).length, 1, 'kept');
});

test('prepareQueue — run by every sign-out — stamps pre-update items as the ending account’s', async () => {
  const p = phone();
  await p.storage.setItem(
    QUEUE_KEY,
    JSON.stringify([{ id: 'old-1', path: doorResultPath(H1, 'not_home'), body: {}, enqueuedAt: '2026-10-31T12:00:00.000Z' }])
  );
  p.signIn('A');
  await p.q.prepareQueue(); // A signs out
  p.signIn('B');
  await p.q.flushQueue();
  assert.equal(p.state.calls.length, 0, 'never sent under B');
  assert.equal((await p.queue())[0].recordedBy, 'A');
});

test('a pause answer is never applied to a session that began while it was being sent', async () => {
  const p = phone();
  p.signIn('A');
  await p.q.enqueue(doorResultPath(H1, 'not_home'), {}, stampFor('A', 'Ann A.'));
  await p.q.enqueue(doorResultPath(H2, 'not_home'), {}, stampFor('A', 'Ann A.', H2));
  const heard = [];
  p.q.setFlushPaceSink((pace) => heard.push(pace));
  let n = 0;
  p.state.respond = async () => {
    n += 1;
    if (n === 2) p.signIn('B'); // B signs in while Ann's second item is in the air
    return { ok: true, pace: { n } };
  };
  await p.q.flushQueue();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(heard, [{ n: 1 }]);
});
