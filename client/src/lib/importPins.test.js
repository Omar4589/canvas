import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importPinLine, isCheckingPins, PINS_STAGE_LABEL, pinCheckBadge } from './importPins.js';

// The import list's map-pin line: three outcome parts, zero parts left out, Pin Fixes linked only
// when homes are left without an exact spot, and the busy/failed sentence shown as-is.

test('all three parts, in order, with the Pin Fixes link', () => {
  assert.deepEqual(importPinLine({ pinsPlacedExact: 412, pinsConfirmedInPlace: 9, pinsStillUnplaced: 60 }), {
    text: 'Map pins: 412 placed by address · 9 confirmed at their spot · 60 without an exact spot',
    pinFixes: true,
    failed: false,
  });
});

test('zero parts are left out; no link when nothing is left to fix', () => {
  assert.deepEqual(importPinLine({ pinsPlacedExact: 3, pinsConfirmedInPlace: 0, pinsStillUnplaced: 0 }), {
    text: 'Map pins: 3 placed by address',
    pinFixes: false,
    failed: false,
  });
  assert.equal(importPinLine({ pinsPlacedExact: 0, pinsConfirmedInPlace: 1, pinsStillUnplaced: 2 }).text,
    'Map pins: 1 confirmed at its spot · 2 without an exact spot');
  assert.equal(importPinLine({ pinsPlacedExact: 1200, pinsStillUnplaced: 0 }).text, 'Map pins: 1,200 placed by address');
});

test('nothing to say: no shared spots, an older job, or no job', () => {
  assert.equal(importPinLine({ pinsPlacedExact: 0, pinsConfirmedInPlace: 0, pinsStillUnplaced: 0 }), null);
  assert.equal(importPinLine({ filename: 'old.csv' }), null);
  assert.equal(importPinLine(null), null);
});

test('a busy or failed pass shows its sentence instead of counts', () => {
  const busy =
    "Map pins weren't placed: another import was placing pins in this campaign. Import the file again to place them.";
  assert.deepEqual(importPinLine({ pinPassError: busy, pinsStillUnplaced: 0 }), { text: busy, pinFixes: false, failed: true });
  assert.equal(importPinLine({ pinPassError: "Map pins weren't checked this time. Import the file again to try again." }).failed, true);
});

test('the Checking map pins stage shows only while the job is running', () => {
  assert.equal(PINS_STAGE_LABEL, 'Checking map pins');
  assert.equal(isCheckingPins({ phase: 'pins', status: 'importing' }), true);
  assert.equal(isCheckingPins({ phase: 'pins', status: 'completed' }), false);
  assert.equal(isCheckingPins({ phase: 'pins', status: 'failed' }), false);
  assert.equal(isCheckingPins({ phase: 'importing', status: 'importing' }), false);
});

test('super-admin badge: busy, failed with its cause, over the ceiling, or nothing', () => {
  assert.deepEqual(
    pinCheckBadge({ pinPassError: 'x', pinPassCause: 'busy: another pin check is running in this campaign' }),
    { label: 'pins busy', title: 'busy: another pin check is running in this campaign' }
  );
  assert.deepEqual(pinCheckBadge({ pinPassError: 'x', pinPassCause: 'HTTP 401' }), { label: 'pins failed', title: 'HTTP 401' });
  assert.deepEqual(pinCheckBadge({ pinPassError: 'generic', pinPassCause: null }), { label: 'pins failed', title: 'generic' });
  assert.equal(pinCheckBadge({ pinLookupsOverCap: 1200 }).label, 'pin cap');
  assert.match(pinCheckBadge({ pinLookupsOverCap: 1200 }).title, /^1,200 homes were not looked up/);
  assert.equal(pinCheckBadge({ pinLookupsOverCap: 0, pinPassError: null }), null);
  assert.equal(pinCheckBadge(null), null);
});

// ── The pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.7) ──
import { isPinLookupJob, pinLookupLabel } from './importPins.js';

test('the new parts: on the street, complexes, the holding spot inside "without an exact spot", far marks', () => {
  assert.deepEqual(
    importPinLine({ pinsPlacedExact: 520, pinsPlacedApprox: 41, pinsConfirmedInPlace: 28, pinsComplex: 212, pinsStillUnplaced: 18, pinsUnlocated: 5, pinsFarMarked: 130 }),
    {
      text: 'Map pins: 520 placed by address · 41 placed on the street (check them) · 28 confirmed at their spot · 212 in complexes · 18 without an exact spot, 5 of them kept at a holding spot · 130 flagged far from their street — look them up',
      pinFixes: true,
      failed: false,
    }
  );
  assert.equal(importPinLine({ pinsComplex: 1 }).text, 'Map pins: 1 in a complex');
  assert.equal(importPinLine({ pinsComplex: 3 }).pinFixes, false, 'a complex is a place, not something to fix');
  assert.equal(importPinLine({ pinsPlacedApprox: 1 }).pinFixes, true, 'approximate pins are worth a check');
});

test('a Pin Fixes lookup row', () => {
  assert.equal(isPinLookupJob({ kind: 'pin_lookup' }), true);
  assert.equal(isPinLookupJob({ kind: 'apply' }), false);
  assert.equal(pinLookupLabel({ totalRows: 76 }), 'Pin lookup · 76 homes');
  assert.equal(pinLookupLabel({ totalRows: 1 }), 'Pin lookup · 1 home');
});
