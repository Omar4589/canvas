import { test } from 'node:test';
import assert from 'node:assert';
import { pinBadge } from './pinBadge.js';

// The phone's pin badge order (placeholder pins, release 2) — the same chain as the web.
test('the badge chain: no exact spot > confirmed > corrected > approximate', () => {
  assert.equal(pinBadge({ pinSuspect: 'placeholder', coordSource: 'corrected' }).label, 'No exact map spot');
  assert.equal(pinBadge({ locationConfirmedAt: '2026-10-05', coordSource: 'file' }).label, 'Location confirmed');
  assert.equal(pinBadge({ coordSource: 'corrected', coordConfidence: 'interpolated' }).label, 'Pin corrected');
  assert.equal(pinBadge({ coordConfidence: 'interpolated' }).label, 'Approximate location');
  assert.equal(pinBadge({ coordSource: 'file' }), null);
  assert.equal(pinBadge(undefined), null);
  assert.equal(pinBadge({ pinSuspect: 'stray' }).tone, 'warning');
});
