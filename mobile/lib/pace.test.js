import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerPace, withPace, isPaused, blocksRecording, flushAnswerApplies, pausedUserIds, PACE_MESSAGE } from './pace.js';

// The phone's automatic-pause rules (docs/PROPOSAL_PACE_PAUSE.md §E.2–E.3). Every input — the bootstrap, the
// delta, a recording response, a refusal, the banner's poll, the offline queue — goes through newerPace, so
// these cases are the whole ordering contract.

const at = (s) => `2026-10-22T20:${s}Z`;

test('the newer answer wins by the server clock; a late, older reply never undoes a newer one', () => {
  const paused = { paused: true, at: at('10:05') };
  assert.deepEqual(newerPace(null, paused), paused, 'first answer is taken');
  assert.deepEqual(newerPace(paused, { paused: false, at: at('10:30') }), { paused: false, at: at('10:30') }, 'an unpause after it wins');
  assert.equal(newerPace(paused, { paused: false, at: at('10:01') }), paused, 'an older reply is ignored');
  assert.deepEqual(newerPace(paused, { paused: false, at: at('10:05') }), { paused: false, at: at('10:05') }, 'equal times take the incoming answer');
});

test('malformed or timeless answers never beat a real one, and tipped is never kept', () => {
  const held = { paused: true, at: at('10:05') };
  assert.equal(newerPace(held, undefined), held);
  assert.equal(newerPace(held, { paused: 'yes', at: at('11:00') }), held);
  assert.equal(newerPace(held, { paused: false }), held, 'no time over a timed answer');
  assert.deepEqual(newerPace({ paused: true, at: null }, { paused: false }), { paused: false, at: null }, 'no time over no time');
  assert.equal(newerPace(undefined, null), null);
  assert.deepEqual(newerPace(null, { paused: true, tipped: true, at: at('10:05') }), { paused: true, at: at('10:05') });
});

test('withPace returns the same bootstrap when nothing changed, a new one when it did', () => {
  const data = { households: [{ _id: 'h1' }], pace: { paused: false, at: at('10:00') } };
  assert.equal(withPace(data, { paused: false, at: at('10:00') }), data, 'the same answer again');
  assert.equal(withPace(data, { paused: true, at: at('09:59') }), data, 'an older answer');
  assert.equal(withPace(data, undefined), data, 'an older server sends no pace');
  assert.equal(withPace(null, { paused: true, at: at('10:00') }), null, 'nothing cached yet');
  const next = withPace(data, { paused: true, tipped: true, at: at('10:05') });
  assert.notEqual(next, data);
  assert.deepEqual(next.pace, { paused: true, at: at('10:05') });
  assert.equal(next.households, data.households, 'the roster rides along untouched');
  const fresh = withPace({ households: [] }, { paused: false, at: at('10:00') });
  assert.deepEqual(fresh.pace, { paused: false, at: at('10:00') }, 'a bootstrap without pace gains it');
});

test('only a paused answer blocks, and pin fixes are never blocked', () => {
  const paused = { pace: { paused: true, at: at('10:05') } };
  assert.equal(isPaused(paused), true);
  assert.equal(isPaused({ pace: { paused: false, at: at('10:05') } }), false);
  assert.equal(isPaused({}), false, 'a server older than automatic pause');
  assert.equal(isPaused(undefined), false);
  assert.equal(blocksRecording(paused), true, 'door results, surveys and the walk-up add');
  assert.equal(blocksRecording(paused, { requireFix: false }), false, 'pin fixes');
  assert.equal(blocksRecording({}, { requireFix: true }), false);
});

test('a flushed answer applies only to the org it was recorded under', () => {
  assert.equal(flushAnswerApplies({ orgId: 'o1' }, 'o1'), true);
  assert.equal(flushAnswerApplies({ orgId: 'o1' }, 'o2'), false, 'recorded under another org');
  assert.equal(flushAnswerApplies({ orgId: 'o1' }, null), false, 'no active org now');
  assert.equal(flushAnswerApplies({}, 'o2'), true, 'a legacy item flushes under the active org');
});

test('the message is the one the server sends', () => {
  // server/src/services/audit/pacePause.js PACE_PAUSED.message — the phone shows the same words offline.
  assert.equal(PACE_MESSAGE, 'Recording is paused for review. Call your team lead.');
});

test('who shows as paused to an admin or lead: blocking pauses and a lead\u2019s roster lines', () => {
  const ids = pausedUserIds({
    pauses: [
      { userId: 'u1', status: 'paused', blocking: true },
      { userId: 'u2', status: 'paused', blocking: false },
      { userId: 'u3', status: 'resolved', blocking: false },
    ],
    rosterLines: [{ userId: 'u4', paused: true, elsewhere: true }],
  });
  assert.deepEqual([...ids].sort(), ['u1', 'u4']);
  assert.equal(pausedUserIds(undefined).size, 0);
});
