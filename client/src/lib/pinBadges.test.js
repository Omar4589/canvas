import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinBadge, pinLine, needsScopeQuestion } from './pinBadges.js';

// The pin badge order and the placement sentences, shared by the web door panel and the Turf pop-up.

test('the badge chain: the first that applies wins', () => {
  const at = new Date('2026-10-05T18:00:00Z');
  assert.equal(pinBadge({ pinSuspect: 'placeholder', coordConfidence: 'interpolated' }).label, 'No exact map spot');
  assert.equal(pinBadge({ locationConfirmedAt: at, coordConfidence: 'interpolated' }).label, 'Location confirmed');
  // A confirmed home on a shared spot is not interpolated, and still reads confirmed.
  assert.equal(pinBadge({ locationConfirmedAt: at, coordSource: 'file' }).label, 'Location confirmed');
  assert.deepEqual(pinBadge({ coordSource: 'corrected', correctedAt: at }), { kind: 'corrected', label: 'Pin corrected', tone: 'brand', at });
  assert.equal(pinBadge({ coordConfidence: 'interpolated' }).label, 'Approximate location');
  assert.equal(pinBadge({ coordSource: 'file', coordConfidence: 'exact' }), null);
  assert.equal(pinBadge(null), null);
});

test('the line under the badge', () => {
  const fmt = () => 'Oct 5';
  assert.equal(pinLine({ pinSuspect: 'stray' }, fmt), 'This home has no exact map spot; its coordinate was shared with other addresses.');
  assert.equal(pinLine({ pinPlaced: { at: 'x', inPlace: false, stackSize: 4 } }, fmt), 'Placed by address (Oct 5). Its earlier spot was shared with 4 other homes.');
  assert.equal(pinLine({ pinPlaced: { at: 'x', inPlace: false, stackSize: 1 } }, fmt), 'Placed by address (Oct 5). Its earlier spot was shared with 1 other home.');
  assert.equal(pinLine({ pinPlaced: { at: 'x', inPlace: false, stackSize: null } }, fmt), 'Placed by address (Oct 5). Its earlier spot was shared with other addresses.');
  assert.equal(pinLine({ pinPlaced: { at: 'x', inPlace: true, stackSize: 2 } }, fmt), 'The address lookup confirms this spot (Oct 5).');
  assert.equal(pinLine({ coordSource: 'corrected' }, fmt), null);
});

test('the scope question only when other units of the address share the pin', () => {
  assert.equal(needsScopeQuestion({ count: 3, unplaced: false }), true);
  assert.equal(needsScopeQuestion({ count: 1, unplaced: true }), false);
  assert.equal(needsScopeQuestion(undefined), false);
});
