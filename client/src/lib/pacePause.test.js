import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarySentence, alertLine, statusLine, markLabel, secondsText, mphText, distanceLine, pausedUserIds } from './pacePause.js';
// Cross-tree on purpose: the web badge and the phone's must agree on who is paused.
import { pausedUserIds as phonePausedUserIds } from '../../../mobile/lib/pace.js';

test('the summary sentence names what kind of fast it was', () => {
  assert.equal(
    summarySentence({ fails: 8, vehicle: 6, still: 1, walking: 1, minMph: 7.3, maxMph: 10.9 }),
    '6 of the 8 too-fast doors were at vehicle speed (7–11 mph), 1 was saved from one spot — usually several doors saved at once — and 1 at walking pace.'
  );
  assert.equal(summarySentence({ fails: 8, vehicle: 8, still: 0, walking: 0, minMph: 9, maxMph: 9.2 }), 'All 8 too-fast doors were at vehicle speed (9 mph).');
  assert.equal(summarySentence({ fails: 9, vehicle: 0, still: 9, walking: 0 }), 'All 9 too-fast doors were saved from one spot — usually several doors saved at once.');
  assert.equal(summarySentence({ fails: 8, vehicle: 2, still: 6, walking: 0, minMph: 12, maxMph: 20 }), '2 of the 8 too-fast doors were at vehicle speed (12–20 mph), and 6 were saved from one spot — usually several doors saved at once.');
  assert.equal(summarySentence({ fails: 8, vehicle: 0, still: 7, walking: 1 }), '7 of the 8 too-fast doors were saved from one spot — usually several doors saved at once — and 1 at walking pace.');
  assert.equal(summarySentence({ fails: 0 }), 'None of these doors were too fast.');
});

test('the alert line, the status line and the marks', () => {
  assert.equal(alertLine({ status: 'pending' }), 'Sending the email…');
  assert.match(alertLine({ status: 'done', sent: 2, failed: 0, at: '2026-10-22T20:10:05Z' }, 'America/Los_Angeles'), /^Emailed 2 people at 1:10 PM PDT$/);
  assert.equal(alertLine({ status: 'done', sent: 0, failed: 1 }), "The email didn't go out");
  assert.equal(statusLine({ status: 'paused', blocking: true, memberActive: true }), 'Paused — can’t record');
  assert.equal(statusLine({ status: 'paused', blocking: false, memberActive: true }), 'Not blocking — automatic pause is switched off');
  assert.equal(statusLine({ status: 'paused', blocking: false, memberActive: false }), 'Member no longer active');
  assert.match(statusLine({ status: 'resolved', resolvedVia: 'unpause', resolvedByName: 'Lee Alpha' }), /^Unpaused by Lee Alpha/);
  assert.match(statusLine({ status: 'resolved', resolvedVia: 'setting_off' }), /^Lifted when automatic pause was turned off/);
  assert.equal(markLabel('pause'), 'Part of the pause');
  assert.equal(markLabel('not_judged', 'unit'), 'Not judged — apartment or unit');
  assert.equal(secondsText(64), '1 min 4 s');
  assert.equal(secondsText(8.4), '8 s');
  assert.equal(mphText(10.6), '11 mph');
  assert.equal(distanceLine(null, String), null);
  assert.match(distanceLine(28, (m) => `${m} m`), /median 28 m from each house/);
});

test('who is paused right now: blocking pauses, and a team lead’s roster lines — the phone agrees', () => {
  const data = {
    pauses: [
      { userId: 'u1', status: 'paused', blocking: true },
      { userId: 'u2', status: 'paused', blocking: false },
      { userId: 'u3', status: 'resolved', blocking: false },
    ],
    rosterLines: [{ userId: 'u4', paused: true, elsewhere: true }],
  };
  assert.deepEqual([...pausedUserIds(data)].sort(), ['u1', 'u4']);
  assert.deepEqual([...pausedUserIds(data)].sort(), [...phonePausedUserIds(data)].sort());
  assert.equal(pausedUserIds(undefined).size, 0);
});
