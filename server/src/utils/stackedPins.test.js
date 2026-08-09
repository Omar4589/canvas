import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStackedPins, DOMINANT_SHARE } from './stackedPins.js';

// Shapes drawn from the real FL-22 i360 file that surfaced this failure mode.

const d = (id, street, pinKey) => ({ id, street, pinKey });

test('a genuine apartment building — one street line — is never a suspect', () => {
  const r = classifyStackedPins([
    d('a', 'Lely Palms Dr', 'P1'),
    d('b', 'Lely Palms Dr', 'P1'),
    d('c', 'Lely Palms Dr', 'P1'),
  ]);
  assert.equal(r.suspects.size, 0);
  assert.equal(r.placeholderPins, 0);
  assert.equal(r.strayDoors, 0);
});

test('a placeholder pin — many streets, no dominant one — suspects every door', () => {
  // The Ft Denaud screenshot in miniature: different streets, one dot.
  const r = classifyStackedPins([
    d('a', 'Mahogony Ct', 'P1'),
    d('b', 'Gen Chesty Puller Ct', 'P1'),
    d('c', 'Gen D MacArthur Ave', 'P1'),
    d('e', 'Admiral Bull Halsey Ave', 'P1'),
  ]);
  assert.equal(r.placeholderPins, 1);
  assert.equal(r.placeholderDoors, 4);
  assert.equal(r.suspects.size, 4);
  assert.equal(r.suspects.get('a').kind, 'placeholder');
  assert.equal(r.suspects.get('a').pinDoors, 4);
});

test('the Aqua Isles case — a dominant street plus strays — keeps the park, flags the strays', () => {
  const doors = [];
  for (let i = 0; i < 87; i += 1) doors.push(d(`lot${i}`, 'Aqua Isles Blvd', 'P1'));
  doors.push(d('odd1', 'Aqua Isles Blvd Lbby K25', 'P1'));
  doors.push(d('odd2', 'Aqua Isles Blvd Lot H 25', 'P1'));
  const r = classifyStackedPins(doors);
  assert.equal(r.placeholderPins, 0, 'the park is not a placeholder');
  assert.equal(r.strayDoors, 2);
  assert.equal(r.suspects.size, 2, 'only the two badly-typed rows are checked');
  assert.equal(r.suspects.get('odd1').kind, 'stray');
  assert.ok(!r.suspects.has('lot0'), 'the 87 real lots are untouched');
});

test('dominance needs an OUTRIGHT majority — exactly half is a placeholder', () => {
  // 2 of 4 = 0.5: half the doors are strangers, so no street "owns" the pin — calling
  // Oak the building would leave a genuinely mis-pinned Oak door unchecked. All four go
  // to adjudication (which is cache-first and gated, so over-checking is cheap and safe).
  assert.equal(DOMINANT_SHARE, 0.5);
  const r = classifyStackedPins([
    d('a', 'Oak St', 'P1'),
    d('b', 'Oak St', 'P1'),
    d('c', 'Elm St', 'P1'),
    d('e', 'Pine St', 'P1'),
  ]);
  assert.equal(r.placeholderPins, 1);
  assert.equal(r.suspects.size, 4);
});

test('a strict majority IS dominant — building kept, minority checked', () => {
  // 2 of 3 > 0.5 — Oak is the building; only the Elm door gets a second look.
  const r = classifyStackedPins([
    d('a', 'Oak St', 'P1'),
    d('b', 'Oak St', 'P1'),
    d('c', 'Elm St', 'P1'),
  ]);
  assert.equal(r.placeholderPins, 0);
  assert.equal(r.strayDoors, 1);
  assert.deepEqual([...r.suspects.keys()], ['c']);
});

test('pins are independent — a placeholder never contaminates a building next door', () => {
  const r = classifyStackedPins([
    d('a', 'Oak St', 'P1'),
    d('b', 'Elm St', 'P1'),
    d('c', 'Lely Palms Dr', 'P2'),
    d('e', 'Lely Palms Dr', 'P2'),
  ]);
  assert.equal(r.suspects.size, 2);
  assert.ok(r.suspects.has('a') && r.suspects.has('b'));
  assert.ok(!r.suspects.has('c') && !r.suspects.has('e'));
});

test('lone doors and doors without a pin are ignored', () => {
  const r = classifyStackedPins([d('a', 'Oak St', 'P1'), d('b', 'Elm St', null), d('c', 'Ash St', undefined), null]);
  assert.equal(r.suspects.size, 0);
});

test('empty and null input never throw', () => {
  assert.equal(classifyStackedPins([]).suspects.size, 0);
  assert.equal(classifyStackedPins(null).suspects.size, 0);
});
