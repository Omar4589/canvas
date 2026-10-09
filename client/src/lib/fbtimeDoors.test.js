import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOORS_POLL_MS,
  clearHow,
  clearWho,
  clearsWaiting,
  doorsCompact,
  doorsPollInterval,
  keyCanFillDoors,
  keyCanWriteDoors,
  nameList,
  replaceKeyFlags,
  withPeriod,
  sendSummary,
  showDoorsCard,
  syncDoneNote,
  syncFailedNote,
  syncOutcome,
  transitionNote,
} from './fbtimeDoors.js';

// The screen's own decisions about the server's `doors` block. The block itself is
// the server's (doorsStatus) and is never re-derived — these pin only what the web
// still has to decide, starting with the one that can hide a failure: Sync now.

const NO_CLEARS = { all: false, persons: [], confirmPending: false, blockedBy: null };
const block = (over = {}) => ({
  available: true,
  enabled: false,
  state: 'off',
  reason: null,
  canWrite: true,
  reportedWins: true,
  everSent: false,
  canClearAll: false,
  pendingClears: NO_CLEARS,
  ...over,
});

const T = Date.parse('2026-10-09T15:00:00Z'); // requestedAt
const before = '2026-10-09T14:59:00Z';
const after = '2026-10-09T15:00:05Z';

test('Sync now: a failure is checked FIRST, so a tick that moved lastSyncAt cannot hide it', () => {
  // The trap: a 15-minute cron tick lands lastSyncAt past the request while the
  // requested run itself fails. Checked done-first, this read as "Hours refreshed."
  const data = { status: 'connected', lastSyncAt: after, lastErrorAt: after, doors: null };
  assert.equal(syncOutcome(data, { at: T }), 'failed');

  const doorsFailed = {
    status: 'connected',
    lastSyncAt: after,
    lastErrorAt: before,
    doors: { enabled: true, lastFinishedAt: after, lastErrorAt: after },
  };
  assert.equal(syncOutcome(doorsFailed, { at: T }), 'failed', 'a door-count error is a failure too');
});

test('Sync now: a connection that turns errored has failed; one already errored is a retry', () => {
  const errored = { status: 'errored', lastSyncAt: before, lastErrorAt: before, doors: null };
  assert.equal(syncOutcome(errored, { at: T }), 'failed', 'connected at the click, errored now');
  // Retrying an errored key: the first poll still shows the OLD errored status before
  // the run starts — that must keep waiting, not end the wait.
  assert.equal(syncOutcome(errored, { at: T, erroredBefore: true }), null);
  assert.equal(
    syncOutcome({ ...errored, lastErrorAt: after }, { at: T, erroredBefore: true }),
    'failed',
    'the retry failing again stamps a fresh error'
  );
  assert.equal(
    syncOutcome({ status: 'connected', lastSyncAt: after, lastErrorAt: before, doors: null }, { at: T, erroredBefore: true }),
    'done',
    'the retry healing the connection'
  );
});

test('Sync now: done needs the hours AND, with door counts on, the door step past the request', () => {
  const hoursOnly = { status: 'connected', lastSyncAt: after, lastErrorAt: null, doors: { enabled: false } };
  assert.equal(syncOutcome(hoursOnly, { at: T }), 'done', 'door counts off: hours alone');

  const on = { status: 'connected', lastSyncAt: after, lastErrorAt: null, doors: { enabled: true, lastFinishedAt: before } };
  assert.equal(syncOutcome(on, { at: T }), null, 'hours done, door step not yet');
  assert.equal(syncOutcome({ ...on, doors: { enabled: true, lastFinishedAt: after } }, { at: T }), 'done');

  assert.equal(syncOutcome({ status: 'connected', lastSyncAt: before, doors: null }, { at: T }), null, 'still running');
  assert.equal(syncOutcome({ status: 'connected', lastSyncAt: T, doors: null }, { at: T }), null, 'LATER than, not equal');
  assert.equal(syncOutcome(null, { at: T }), null);
});

test('Sync now notes say what happened, and stay quiet when the bar already does', () => {
  assert.equal(syncDoneNote({ doors: { enabled: false } }), 'Hours refreshed.');
  assert.match(syncDoneNote({ doors: { enabled: true } }), /door counts card shows the latest send/);
  assert.equal(syncFailedNote({ status: 'errored' }, T), null, 'the errored bar prints its own error');
  assert.match(
    syncFailedNote({ status: 'connected', lastErrorAt: after, lastSyncError: 'TIMEOUT: slow' }, T),
    /Couldn’t refresh hours — TIMEOUT: slow/
  );
  assert.match(
    syncFailedNote({ status: 'connected', lastErrorAt: before, doors: { lastError: 'HTTP_503: down' } }, T),
    /Hours refreshed, but door counts hit an error — HTTP_503: down/
  );
});

test('the card is drawn when released, when on, or while a clear waits — and is compact only when idle', () => {
  assert.equal(showDoorsCard(null), false);
  assert.equal(showDoorsCard(block()), true);
  assert.equal(showDoorsCard(block({ available: false })), false, 'unreleased and idle: no card at all');
  assert.equal(showDoorsCard(block({ available: false, enabled: true, state: 'paused' })), true, 'on, even with the var off');
  assert.equal(
    showDoorsCard(block({ available: false, pendingClears: { ...NO_CLEARS, persons: [{ fbtimePersonId: 'p1' }] } })),
    true,
    'a waiting clear is drawn whatever the var'
  );

  assert.equal(doorsCompact(block()), true);
  assert.equal(doorsCompact(block({ pendingClears: { ...NO_CLEARS, all: true, blockedBy: 'needs-permission' } })), false);
  assert.equal(doorsCompact(block({ enabled: true, state: 'sending' })), false);
  assert.equal(clearsWaiting(block()), false);
});

test('the status polls while a send or a clear is under way, and only then', () => {
  assert.equal(doorsPollInterval({ doors: { state: 'starting' } }), DOORS_POLL_MS);
  assert.equal(doorsPollInterval({ doors: { state: 'clearing' } }), DOORS_POLL_MS);
  for (const state of ['off', 'sending', 'attention', 'paused']) {
    assert.equal(doorsPollInterval({ doors: { state } }), false, state);
  }
  assert.equal(doorsPollInterval({ connected: false }), false);
  assert.equal(doorsPollInterval(undefined), false);
});

test('a key fills in door counts only with doors:write AND FbTime’s doors:reported-wins', () => {
  const tested = (scopes, features) => ({ key: { scopes }, features });
  assert.equal(keyCanFillDoors(tested(['hours:read', 'doors:write'], ['doors:reported-wins'])), true);
  assert.equal(keyCanFillDoors(tested(['hours:read'], ['doors:reported-wins'])), false, 'an hours-only key');
  assert.equal(keyCanFillDoors(tested(['doors:write'], [])), false, 'an FbTime without "Doorline decides"');
  assert.equal(keyCanFillDoors(tested(['doors:write'], ['doors:keep-typed'])), false, '8c52b5d alone is refused');
  assert.equal(keyCanWriteDoors(tested(['doors:write'], [])), true);
  assert.equal(keyCanFillDoors({ key: {} }), false, 'an older ping with no scopes');
});

test('the last send reads per window group, and a run with nobody linked reads as nobody', () => {
  const s = sendSummary([
    { windowDays: 120, people: 2, applied: 30 },
    { windowDays: 7, people: 40, applied: 200 },
  ]);
  assert.equal(s.people, 42);
  assert.deepEqual(s.groups.map((g) => g.windowDays), [7, 120], 'the short window first');
  assert.deepEqual(sendSummary([{ windowDays: 7, people: 0 }]), { people: 0, groups: [] });
  assert.deepEqual(sendSummary(undefined), { people: 0, groups: [] });
});

test('names: a short list in full, a long one cut with a count', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['Ann']), 'Ann');
  assert.equal(nameList(['Ann', 'Bo']), 'Ann and Bo');
  assert.equal(nameList(['Ann', 'Bo', 'Cy']), 'Ann, Bo and Cy');
  assert.equal(nameList(['Ann', 'Bo', 'Cy', 'Di', 'Ed']), 'Ann, Bo, Cy and 2 more');
  assert.equal(nameList([null]), 'an FbTime person', 'an unresolvable name still reads');
  assert.equal(clearWho({ all: true, persons: [{ name: 'Ann' }] }), 'everyone');
  // FbTime names are often initials: a sentence ending on one must not end "D..".
  assert.equal(withPeriod('Doorline is still clearing the numbers it sent for Maria D.'), 'Doorline is still clearing the numbers it sent for Maria D.');
  assert.equal(withPeriod('Unlinking Ann from Bo'), 'Unlinking Ann from Bo.');
  assert.equal(clearWho({ all: false, persons: [{ name: 'Ann' }, { name: 'Bo' }] }), 'Ann and Bo');
});

test('off with numbers sent but no clear on offer: the card explains how, unless something else already does', () => {
  const sentOff = (over) => block({ everSent: true, canClearAll: false, ...over });
  assert.equal(clearHow(block({ everSent: true, canClearAll: true }), 'connected'), null, 'the clear is offered');
  assert.equal(clearHow(block({ everSent: false }), 'connected'), null, 'nothing was sent');
  assert.equal(clearHow(sentOff({ canWrite: false, reason: 'hours-only-key' }), 'connected'), 'hours-only-key');
  assert.equal(clearHow(sentOff({ reportedWins: false }), 'connected'), 'fbtime-outdated');
  assert.equal(clearHow(sentOff({}), 'errored'), 'connection');
  assert.equal(clearHow(sentOff({ reason: 'conflict' }), 'connected'), null, 'the off hint already says who sends');
  assert.equal(
    clearHow(sentOff({ pendingClears: { ...NO_CLEARS, all: true, blockedBy: 'needs-permission' } }), 'connected'),
    null,
    'a clear already waits — its notice says why it can’t run'
  );
  assert.equal(clearHow(sentOff({ enabled: true, state: 'sending' }), 'connected'), null, 'only while off');
});

test('completion is announced for the first send and a finished clear — nothing else', () => {
  assert.equal(transitionNote('starting', 'sending', block()), 'Door counts sent to FbTime.');
  assert.match(transitionNote('clearing', 'off', block()), /finished clearing/);
  assert.match(transitionNote('clearing', 'sending', block({ enabled: true })), /finished clearing/);
  assert.equal(
    transitionNote('clearing', 'off', block({ pendingClears: { ...NO_CLEARS, all: true, blockedBy: 'paused' } })),
    null,
    'a clear that stopped (blocked), not one that finished'
  );
  assert.equal(transitionNote('sending', 'attention', block()), null);
  assert.equal(transitionNote('off', 'starting', block()), null);
});

test('Replace key: the confirmed retry carries every flag, in one request', () => {
  const waiting = block({ pendingClears: { ...NO_CLEARS, persons: [{ fbtimePersonId: 'p1', name: 'Ann' }] } });
  assert.deepEqual(replaceKeyFlags(null, waiting), {}, 'the first attempt asks nothing');
  assert.deepEqual(replaceKeyFlags({ orgChange: { organization: {} } }, block()), { confirmOrgChange: true });
  assert.deepEqual(
    replaceKeyFlags({ orgChange: { organization: {} } }, waiting),
    { confirmOrgChange: true, leaveDoorCounts: true },
    'an org change with a clear waiting abandons it in the same request'
  );
  assert.deepEqual(
    replaceKeyFlags({ orgChange: { organization: {} }, clearPending: { all: true, persons: [] } }, block()),
    { confirmOrgChange: true, leaveDoorCounts: true },
    'a DOORS_CLEAR_PENDING the card had not seen yet'
  );
});
