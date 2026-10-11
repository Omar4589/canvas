import test from 'node:test';
import assert from 'node:assert/strict';
import { isPinUnplaced, isPinFlaggedUnvouched, effectivePinSuspect, knockPinOf, isComplex, pinWireFields } from './pinState.js';

// docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S3.2.
const at = new Date('2026-10-10T12:00:00Z');

test('isPinUnplaced: every kind but complex, until vouched', () => {
  for (const k of ['placeholder', 'stray', 'far', 'unlocated']) {
    assert.equal(isPinUnplaced({ pinSuspect: k }), true, k);
    assert.equal(isPinUnplaced({ pinSuspect: k, locationConfirmedAt: at }), false, `${k} vouched`);
  }
  assert.equal(isPinUnplaced({ pinSuspect: 'complex' }), false);
  assert.equal(isPinUnplaced({}), false);
  assert.equal(isComplex({ pinSuspect: 'complex' }), true);
});

test('isPinFlaggedUnvouched includes a complex (the server\'s "nothing moved" gates)', () => {
  assert.equal(isPinFlaggedUnvouched({ pinSuspect: 'complex' }), true);
  assert.equal(isPinFlaggedUnvouched({ pinSuspect: 'complex', locationConfirmedAt: at }), false);
  assert.equal(isPinFlaggedUnvouched({}), false);
});

test('effectivePinSuspect: complex is always sent; unplaced kinds only until vouched', () => {
  assert.equal(effectivePinSuspect({ pinSuspect: 'complex', locationConfirmedAt: at }), 'complex');
  assert.equal(effectivePinSuspect({ pinSuspect: 'far' }), 'far');
  assert.equal(effectivePinSuspect({ pinSuspect: 'far', locationConfirmedAt: at }), null);
  assert.equal(effectivePinSuspect({ pinSuspect: 'unlocated', locationConfirmedAt: at }), null);
  assert.equal(effectivePinSuspect({}), null);
});

test('knockPinOf: complex (vouched or not), an unconfirmed estimate, else nothing', () => {
  assert.equal(knockPinOf({ pinSuspect: 'complex', locationConfirmedAt: at }), 'complex');
  assert.equal(knockPinOf({ coordConfidence: 'interpolated' }), 'estimated');
  assert.equal(knockPinOf({ coordConfidence: 'interpolated', locationConfirmedAt: at }), null);
  assert.equal(knockPinOf({ coordConfidence: 'exact' }), null);
  assert.equal(knockPinOf({ pinSuspect: 'placeholder' }), null);
  assert.equal(knockPinOf(null), null);
});

test('pinWireFields: pinPlaced carries the kind the door left', () => {
  const h = {
    coordSource: 'geocodio',
    pinPlacement: { by: 'lookup', at, from: [-73.25, 41.17], to: [-73.26, 41.18], stackSize: 0, kind: 'unlocated' },
  };
  assert.deepEqual(pinWireFields(h).pinPlaced, { at, inPlace: false, stackSize: 0, kind: 'unlocated' });
  assert.deepEqual(pinWireFields({ pinSuspect: 'complex' }), { pinSuspect: 'complex' });
});
