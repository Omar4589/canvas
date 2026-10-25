import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as phone from './pacePauseText.js';
import * as web from '../../client/src/lib/pacePause.js';

// The phone's pause wording is a MIRROR of the web's (docs/PROPOSAL_PACE_PAUSE.md §G.3): every sentence
// below must read the same on both, so a pause never says one thing in the console and another on the phone.

const TZ = 'America/Los_Angeles';
const SUMMARIES = [
  { fails: 8, vehicle: 6, still: 1, walking: 1, minMph: 7.3, maxMph: 10.9 },
  { fails: 8, vehicle: 8, still: 0, walking: 0, minMph: 9, maxMph: 9.2 },
  { fails: 9, vehicle: 0, still: 9, walking: 0 },
  { fails: 8, vehicle: 2, still: 6, walking: 0, minMph: 12, maxMph: 20 },
  { fails: 8, vehicle: 0, still: 7, walking: 1 },
  { fails: 1, vehicle: 1, still: 0, walking: 0, minMph: 30, maxMph: 30 },
  { fails: 3, vehicle: 0, still: 0, walking: 0 },
  { fails: 0 },
  null,
];
const ALERTS = [
  null,
  { status: 'pending' },
  { status: 'done', sent: 1, failed: 0, at: '2026-10-22T20:10:05Z' },
  { status: 'done', sent: 2, failed: 1 },
  { status: 'done', sent: 0, failed: 1 },
];
const PAUSES = [
  { status: 'paused', blocking: true, memberActive: true },
  { status: 'paused', blocking: false, memberActive: true },
  { status: 'paused', blocking: true, memberActive: false },
  { status: 'resolved', resolvedVia: 'unpause', resolvedByName: 'Lee Alpha', resolvedAt: '2026-10-22T21:00:00Z' },
  { status: 'resolved', resolvedVia: 'unpause', resolvedByName: '' },
  { status: 'resolved', resolvedVia: 'setting_off', resolvedAt: '2026-10-22T21:00:00Z' },
  { status: 'resolved', resolvedVia: 'switch_off' },
];
const MARKS = [['pause'], ['after'], ['failed'], ['passed'], ['not_judged', 'unit'], ['not_judged', 'result'], ['not_judged', 'first'], ['not_judged', 'other'], ['other']];

test('every sentence reads the same on the phone and the web', () => {
  for (const s of SUMMARIES) assert.equal(phone.summarySentence(s), web.summarySentence(s), JSON.stringify(s));
  for (const a of ALERTS) assert.equal(phone.alertLine(a, TZ), web.alertLine(a, TZ), JSON.stringify(a));
  for (const p of PAUSES) assert.equal(phone.statusLine(p, TZ), web.statusLine(p, TZ), JSON.stringify(p));
  for (const [m, why] of MARKS) assert.equal(phone.markLabel(m, why), web.markLabel(m, why), `${m} ${why}`);
  for (const sec of [null, 0, 8.4, 59.6, 60, 64, 3600, Number.NaN]) assert.equal(phone.secondsText(sec), web.secondsText(sec), String(sec));
  for (const mph of [null, 0, 10.6, Number.POSITIVE_INFINITY]) assert.equal(phone.mphText(mph), web.mphText(mph), String(mph));
  for (const m of [null, 28]) assert.equal(phone.distanceLine(m, String), web.distanceLine(m, String), String(m));
  assert.deepEqual(Object.keys(phone).sort(), Object.keys(web).sort(), 'the same exports');
});

test('the phone sentences themselves', () => {
  assert.equal(
    phone.summarySentence(SUMMARIES[0]),
    '6 of the 8 too-fast doors were at vehicle speed (7–11 mph), 1 was saved from one spot — usually several doors saved at once — and 1 at walking pace.'
  );
  assert.match(phone.alertLine(ALERTS[2], TZ), /^Emailed 1 person at 1:10 PM PDT$/);
  assert.equal(phone.statusLine(PAUSES[0], TZ), 'Paused — can’t record');
  assert.equal(phone.markLabel('after'), 'Saved after the pause');
});
