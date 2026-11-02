import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HELD_LIMIT_MS,
  NOT_SAVED_LIMIT_MS,
  describePath,
  recorderNameOf,
  isMine,
  classify,
  shouldQueue,
  heldStale,
  pruneNotSaved,
  groupWaiting,
  reasonKey,
  reasonText,
  signOutQuestion,
  waitingLine,
  otherAccountSignOutLine,
  preUpdateLine,
  waitedLine,
  deletedAccountLine,
  notSavedBanner,
  kindLabel,
} from './queueRules.js';
import { doorResultPath, addVoterPath, surveyPath, ACTION_PATHS } from './doorPaths.js';

// The offline queue's rules and words (docs/PROPOSAL_OFFLINE_QUEUE.md §B, §E, §O). The engine that applies
// them is pinned in queueCore.test.js.

const DAY = 24 * 60 * 60 * 1000;
const H = 'a'.repeat(24);
// An error shaped like lib/api.js throws for an answer from Doorline's server.
const answer = (status, data = {}) => Object.assign(new Error(data.error || 'x'), { status, data: { error: 'x', ...data } });

test('describePath names every queued kind from the paths the phone really sends', () => {
  const results = {
    not_home: 'not_home',
    wrong_address: 'wrong_address',
    lit_dropped: 'lit_dropped',
    refused: 'refused',
    restricted: 'restricted',
    no_soliciting: 'no_soliciting',
    not_target: 'not_target',
  };
  for (const action of Object.keys(ACTION_PATHS)) {
    const d = describePath(doorResultPath(H, action));
    assert.deepEqual(d, { kind: 'result', actionType: results[action], householdId: H }, action);
  }
  assert.deepEqual(describePath(addVoterPath(H)), { kind: 'add_person', actionType: null, householdId: H });
  assert.deepEqual(describePath(`/mobile/households/${H}/location`), { kind: 'pin_move', actionType: null, householdId: H });
  assert.deepEqual(describePath(surveyPath('v1')), { kind: 'survey', actionType: null, householdId: null });
  assert.equal(describePath('/mobile/voters/v1/notes').kind, null, 'notes are never queued as a door');
  assert.equal(describePath('/admin/anything').kind, null);
  assert.equal(describePath(undefined).kind, null);
});

test('recorderNameOf: first name and last initial, never more', () => {
  assert.equal(recorderNameOf({ firstName: 'Jane', lastName: 'doe' }), 'Jane D.');
  assert.equal(recorderNameOf({ firstName: ' Jane ' }), 'Jane');
  assert.equal(recorderNameOf({ lastName: 'Doe' }), null);
  assert.equal(recorderNameOf(null), null);
});

test('isMine: the recorder only, while the hold is on; everyone with the kill switch off', () => {
  assert.equal(isMine({ recordedBy: 'A' }, 'A', true), true);
  assert.equal(isMine({ recordedBy: 'A' }, 'B', true), false);
  assert.equal(isMine({ recordedBy: null }, 'B', true), false, 'a pre-update item is stamped first, then sent');
  assert.equal(isMine({ recordedBy: 'A' }, null, true), false);
  assert.equal(isMine({ recordedBy: 'A' }, 'B', false), true);
});

test('classify: a no from Doorline is refused; the sign-in is held; everything else is retried', () => {
  assert.equal(classify(Object.assign(new Error('Network request failed'), {})), 'retry', 'no answer');
  assert.equal(classify(answer(500)), 'retry');
  assert.equal(classify(answer(503)), 'retry');
  assert.equal(classify(answer(429)), 'retry', 'a throttle is temporary');
  assert.equal(classify({ status: 403, data: null }), 'retry', "a captive portal's page is not our answer");
  assert.equal(classify({ status: 401, data: '<html>' }), 'retry');
  assert.equal(classify(answer(401, { code: 'SESSION_REVOKED' })), 'hold');
  assert.equal(classify(answer(403, { code: 'PASSWORD_CHANGE_REQUIRED' })), 'hold');
  for (const [status, code] of [
    [403, 'NOT_ASSIGNED'],
    [403, 'ORG_CONTEXT'],
    [404, 'HOUSEHOLD_NOT_FOUND'],
    [402, 'subscription-inactive'],
    [409, 'campaign-deleting'],
    [400, 'INVALID_INPUT'],
  ]) {
    assert.equal(classify(answer(status, { code })), 'refused', `${status} ${code}`);
  }
});

test('shouldQueue: never a deleted account’s save, never a refusal; holds and retries queue', () => {
  assert.equal(shouldQueue(Object.assign(answer(401, { code: 'SESSION_REVOKED' }), { reason: 'deleted' })), false);
  assert.equal(shouldQueue(Object.assign(answer(401, { code: 'SESSION_REVOKED' }), { reason: 'expired' })), true);
  assert.equal(shouldQueue(answer(403, { code: 'NOT_ASSIGNED' })), false);
  assert.equal(shouldQueue(answer(500)), true);
  assert.equal(shouldQueue(new Error('timeout')), true);
});

test('heldStale: 30 days from when the phone first saw it waiting, never from a wrong clock', () => {
  const now = Date.UTC(2026, 10, 1);
  const iso = (t) => new Date(t).toISOString();
  assert.equal(heldStale({ enqueuedAt: iso(now - 40 * DAY) }, now), false, 'never seen waiting: not stale');
  assert.equal(heldStale({ enqueuedAt: iso(now - 40 * DAY), heldSince: now - 31 * DAY }, now), true);
  assert.equal(heldStale({ enqueuedAt: iso(now - 40 * DAY), heldSince: now - 29 * DAY }, now), false);
  assert.equal(
    heldStale({ enqueuedAt: iso(now - 40 * DAY), heldSince: now - DAY }, now),
    false,
    'a phone 40 days behind at the tap keeps the door once its clock corrects'
  );
  assert.equal(heldStale({ enqueuedAt: iso(now + 10 * DAY), heldSince: now - 31 * DAY }, now), false, 'a future date is never stale');
  assert.equal(heldStale({ heldSince: now + DAY }, now), false);
  assert.equal(heldStale({ heldSince: now - HELD_LIMIT_MS }, now), false, 'exactly 30 days is not past 30 days');
  assert.equal(heldStale({ heldSince: 'soon' }, now), false);
});

test('pruneNotSaved drops entries past 30 days and keeps future or unreadable dates', () => {
  const now = Date.UTC(2026, 10, 1);
  const at = (t) => ({ refusedAt: new Date(t).toISOString() });
  const kept = pruneNotSaved(
    [at(now - 31 * DAY), at(now - 29 * DAY), at(now - NOT_SAVED_LIMIT_MS), at(now + DAY), { refusedAt: 'x' }],
    now
  );
  assert.equal(kept.length, 4);
  assert.deepEqual(pruneNotSaved(null, now), []);
});

test('groupWaiting: someone else’s items by recorder; pre-update items only while signed out', () => {
  const queue = [
    { recordedBy: 'A', recorderName: 'Ann A.' },
    { recordedBy: 'A', recorderName: 'Ann A.' },
    { recordedBy: 'C' },
    { recordedBy: 'B' },
    { recordedBy: null },
  ];
  assert.deepEqual(groupWaiting(queue, 'B', true), {
    others: [
      { recordedBy: 'A', name: 'Ann A.', count: 2 },
      { recordedBy: 'C', name: null, count: 1 },
    ],
    unstamped: 0,
  });
  const out = groupWaiting(queue, null, true);
  assert.equal(out.unstamped, 1);
  assert.equal(out.others.length, 3, 'signed out, every recorder waits');
  assert.deepEqual(groupWaiting(queue, 'B', false), { others: [], unstamped: 0 }, 'hidden with the kill switch off');
});

test('reasons are chosen by code, kind and message', () => {
  const pinRole = { status: 403, code: 'FORBIDDEN_ROLE', message: 'Only leads and admins can move a pin', kind: 'pin_move' };
  assert.equal(reasonKey(pinRole), 'pin_role');
  assert.equal(reasonKey({ ...pinRole, message: 'No active org membership' }), 'no_membership');
  assert.equal(reasonKey({ ...pinRole, kind: 'result' }), 'no_membership');
  assert.equal(reasonKey({ code: 'VOTER_NOT_FOUND', kind: 'survey' }), 'person_missing');
  assert.equal(reasonKey({ code: 'VOTER_NOT_FOUND', kind: 'result' }), 'house_gone');
  assert.equal(reasonKey({ status: 402 }), 'account_paused');
  assert.equal(reasonKey({ code: 'NOT_ASSIGNED', sentAsOther: true }), 'sent_as_other');
  assert.equal(reasonText({ code: 'NOT_ASSIGNED' }), "You were no longer on this campaign's team when it uploaded.");
  assert.equal(reasonText({ code: 'ORG_CONTEXT' }), 'You were no longer in this organization when it uploaded.');
  assert.equal(reasonText({ code: 'NOT_ASSIGNED', sentAsOther: true }), 'It uploaded while someone else was signed in.');
  assert.equal(reasonText({ code: 'OUTCOME_DISABLED', message: '"Not a target" is turned off for this campaign.' }), '"Not a target" is turned off for this campaign.', "an unmapped code reads the server's words");
  assert.equal(reasonText({}), "Doorline couldn't save this.");
});

test('the words: sign out, waiting, before the update, removals, the banner', () => {
  assert.equal(signOutQuestion(1, true), "1 saved item hasn't uploaded yet. It'll stay on this phone and upload the next time you sign in here.");
  assert.equal(signOutQuestion(3, true), "3 saved items haven't uploaded yet. They'll stay on this phone and upload the next time you sign in here.");
  assert.equal(signOutQuestion(2, false), "2 saved items haven't uploaded yet. They'll upload with the next person who signs in on this phone.");
  assert.equal(waitingLine({ count: 3, name: 'Ann A.' }), "3 saved items from Ann A. are waiting on this phone. They'll upload when Ann signs in here.");
  assert.equal(waitingLine({ count: 1, name: null }), "1 saved item from another account is waiting on this phone. It'll upload when that person signs in here.");
  assert.equal(otherAccountSignOutLine({ count: 2, name: 'Ann A.' }), '2 saved items from Ann A. stay on this phone and upload when Ann signs in here. Sign out?');
  assert.equal(otherAccountSignOutLine({ count: 1, name: null }), '1 saved item from the account signed in here stays on this phone and uploads when that person signs in here. Sign out?');
  assert.equal(preUpdateLine(2), '2 saved items from before the app update will upload under the next person who signs in.');
  assert.equal(waitedLine({ count: 1, name: 'Ann A.' }), '1 saved item from Ann A. waited 30 days and was removed from this phone.');
  assert.equal(waitedLine({ count: 4, name: null }), '4 saved items from another account waited 30 days and were removed from this phone.');
  assert.equal(deletedAccountLine(2), '2 saved items from a deleted account were removed from this phone.');
  assert.equal(notSavedBanner(1), "1 item wasn't saved — tap to see why");
  assert.equal(notSavedBanner(5), "5 items weren't saved — tap to see why");
  assert.equal(kindLabel({ kind: 'result', actionType: 'lit_dropped' }), 'Lit dropped');
  assert.equal(kindLabel({ kind: 'survey' }), 'Survey');
  assert.equal(kindLabel({ kind: null }), 'Door result');
});
