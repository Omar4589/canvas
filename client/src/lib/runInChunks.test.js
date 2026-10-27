import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInChunks, runPreviewed, previewThenRun, stopsTheRun, mergeRun } from './runInChunks.js';
import { joinClassify } from './crewChange.js';

const refusal = (status, code, message = 'No') => Object.assign(new Error(message), { status, code });
const ids = (n) => Array.from({ length: n }, (_, i) => `u${i}`);

test('chunks of `size`, one request at a time by default, everyone done', async () => {
  const seen = [];
  let inFlight = 0;
  let most = 0;
  const r = await runInChunks(ids(25), { size: 10 }, async (chunk) => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    seen.push(chunk.length);
    await new Promise((res) => setTimeout(res, 1));
    inFlight -= 1;
  });
  assert.deepEqual(seen, [10, 10, 5]);
  assert.equal(most, 1, 'one request at a time');
  assert.equal(r.done.length, 25);
  assert.equal(r.stopped, null);
});

test('three at a time when asked', async () => {
  let inFlight = 0;
  let most = 0;
  await runInChunks(ids(9), { size: 1, concurrency: 3 }, async () => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((res) => setTimeout(res, 2));
    inFlight -= 1;
  });
  assert.equal(most, 3);
});

test('one person’s 403, 409 or 429 is listed and the run carries on', async () => {
  const r = await runInChunks(ids(4), { size: 1 }, async ([id]) => {
    if (id === 'u1') throw refusal(429, 'INVITE_COOLDOWN', 'An invite was just sent to this person.');
    if (id === 'u2') throw refusal(403, null, 'You can only resend invites for canvassers on your campaigns.');
  });
  assert.deepEqual(r.done, ['u0', 'u3']);
  assert.deepEqual(r.failed.map((f) => [f.id, f.reason]), [
    ['u1', 'An invite was just sent to this person.'],
    ['u2', 'You can only resend invites for canvassers on your campaigns.'],
  ]);
  assert.equal(r.stopped, null);
});

test('a 402 or a refusal of the whole action stops the run; the rest are not started', async () => {
  for (const err of [refusal(402, 'subscription-inactive', 'Your account is read-only.'), refusal(409, 'campaign-archived'), refusal(403, 'FORBIDDEN_ROLE')]) {
    assert.equal(stopsTheRun(err), true);
    const calls = [];
    const r = await runInChunks(ids(30), { size: 10 }, async (chunk) => {
      calls.push(chunk[0]);
      if (chunk[0] === 'u10') throw err;
    });
    assert.deepEqual(calls, ['u0', 'u10'], 'nothing sent after the refusal');
    assert.equal(r.done.length, 10);
    assert.equal(r.notStarted.length, 20, 'the refused chunk and the one never sent');
    assert.equal(r.stopped.status, err.status);
  }
  assert.equal(stopsTheRun(refusal(409, 'changed-meanwhile')), false);
});

test('Stop sends nothing new, counts the request already out, and lists the rest for Continue', async () => {
  const stop = new AbortController();
  const r = await runInChunks(ids(30), { size: 10, signal: stop.signal }, async (chunk) => {
    if (chunk[0] === 'u0') stop.abort(); // pressed while the first request is out
    await new Promise((res) => setTimeout(res, 1));
  });
  assert.equal(r.done.length, 10, 'the request already out finished and counts');
  assert.equal(r.notStarted.length, 20);
  assert.equal(r.stopped.reason, 'stopped');
  // Continue: the not-started people, run again.
  const more = await runInChunks(r.notStarted, { size: 10 }, async () => {});
  assert.equal(more.done.length, 20);
  assert.equal(more.stopped, null);
});

test('per-person answers inside a chunk: done, skipped and failed', async () => {
  const r = await runInChunks(['a', 'b', 'c'], { size: 3 }, async () => [
    { id: 'a', outcome: 'done' },
    { id: 'b', outcome: 'skipped', reason: 'already on that crew' },
  ]);
  assert.deepEqual(r.done, ['a']);
  assert.deepEqual(r.skipped, [{ id: 'b', reason: 'already on that crew' }]);
  assert.equal(r.failed[0].id, 'c', 'no answer for them');
});

test('Move to crew… writes each person with their preview’s from; busy ones wait for Retry', async () => {
  const checked = {
    people: [
      { userId: 'a', from: 'y1' },
      { userId: 'b', from: null },
      { userId: 'c', skip: 'same-crew' },
      { userId: 'd', skip: 'busy', retryAfterSeconds: 40 },
    ],
  };
  const sent = [];
  const r = await runPreviewed(checked, ['a', 'b', 'c', 'd'], {
    size: 10,
    write: async (people) => {
      sent.push(people.map((p) => [p.userId, p.from]));
      return people.map((p) => ({ id: p.userId, outcome: 'done' }));
    },
  });
  assert.deepEqual(sent, [[['a', 'y1'], ['b', null]]]);
  assert.deepEqual(r.done, ['a', 'b']);
  assert.deepEqual(r.skipped.map((s) => s.id), ['c']);
  assert.deepEqual(r.failed.map((f) => f.id), ['d']);
});

test('Retry failed checks the people again first, and writes with the fresh from', async () => {
  const asked = [];
  const sent = [];
  const r = await previewThenRun(['a'], {
    preview: async (people) => {
      asked.push(people);
      return { people: [{ userId: 'a', from: 'z9' }] }; // someone moved them meanwhile
    },
    write: async (people) => {
      sent.push(people.map((p) => p.from));
      return [{ id: 'a', outcome: 'done' }];
    },
  });
  assert.deepEqual(asked, [['a']], 'the preview runs first, for the failed people only');
  assert.deepEqual(sent, [['z9']], 'the write carries what the fresh check saw');
  assert.deepEqual(r.done, ['a']);
  const refused = await previewThenRun(['a', 'b'], { preview: async () => { throw refusal(402, 'subscription-inactive'); }, write: async () => [] });
  assert.equal(refused.stopped.status, 402);
  assert.deepEqual(refused.notStarted, ['a', 'b']);
});

test('Retry failed and Continue update the summary in place', () => {
  const first = {
    done: ['a'],
    skipped: [{ id: 'b', reason: 'already on that crew' }],
    failed: [{ id: 'c', reason: 'busy' }],
    notStarted: ['d', 'e'],
    stopped: { reason: 'stopped' },
  };
  const retried = mergeRun(first, ['c'], { done: ['c'], skipped: [], failed: [], notStarted: [], stopped: null });
  assert.deepEqual(retried.done, ['a', 'c']);
  assert.deepEqual(retried.failed, []);
  assert.deepEqual(retried.notStarted, ['d', 'e'], 'not touched by a retry');
  const continued = mergeRun(retried, ['d', 'e'], { done: ['d'], skipped: [], failed: [{ id: 'e', reason: 'no' }], notStarted: [], stopped: null });
  assert.deepEqual(continued.done, ['a', 'c', 'd']);
  assert.deepEqual(continued.failed.map((f) => f.id), ['e']);
  assert.deepEqual(continued.notStarted, []);
  assert.equal(continued.stopped, null);
  assert.equal(mergeRun(null, ['x'], first), first, 'the first run is the summary');
});

test('Add from your organization: the preview’s skips are never sent, and Retry checks again first', async () => {
  const checked = {
    people: [
      { userId: 'a', onCampaign: false },
      { userId: 'b', onCampaign: false, skip: 'switched-off' },
      { userId: 'c', onCampaign: false, skip: 'deleted' },
      { userId: 'd', onCampaign: true },
    ],
  };
  const sent = [];
  const write = async (people) => {
    sent.push(people.map((p) => p.userId));
    return people.map((p) => ({ id: p.userId, outcome: 'done' }));
  };
  const r = await runPreviewed(checked, ['a', 'b', 'c', 'd'], { write, classify: joinClassify, size: 25 });
  assert.deepEqual(sent, [['a']], 'one switched-off member would refuse the whole request');
  assert.deepEqual(r.skipped.map((x) => [x.id, x.reason]), [['b', 'switched off'], ['c', 'account deleted'], ['d', 'already on this campaign']]);
  // Someone switched off after the first check: Retry finds it and leaves them out.
  const again = await previewThenRun(['e'], {
    preview: async () => ({ people: [{ userId: 'e', onCampaign: false, skip: 'switched-off' }] }),
    write,
    classify: joinClassify,
    size: 25,
  });
  assert.deepEqual(sent, [['a']], 'nothing sent');
  assert.deepEqual(again.skipped, [{ id: 'e', reason: 'switched off' }]);
});
