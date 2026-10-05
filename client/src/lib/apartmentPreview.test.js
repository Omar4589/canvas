import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apartmentPreviewCounts, apartmentPreviewLine } from './apartmentPreview.js';

// The Remove apartments line counts what the button takes at the chosen threshold, from the
// server's one-read preview (takenUpTo / spot parallel arrays).

// Spot 0: a 5-unit building (each unit taken up to 5). Spot 1: a duplex at one address (up to 2).
// Spot 2: two unit-addressed doors on a spot of 6 (taken up to 6) — the other four there are
// separate houses, which never appear in the preview.
const candidates = {
  ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'd1', 'd2', 'u1', 'u2'],
  takenUpTo: [5, 5, 5, 5, 5, 2, 2, 6, 6],
  spot: [0, 0, 0, 0, 0, 1, 1, 2, 2],
};

test('a door is taken iff the threshold is at most its takenUpTo', () => {
  assert.deepEqual(apartmentPreviewCounts(candidates, 2), { doors: 9, spots: 3 });
  assert.deepEqual(apartmentPreviewCounts(candidates, 4), { doors: 7, spots: 2 });
  assert.deepEqual(apartmentPreviewCounts(candidates, 5), { doors: 7, spots: 2 });
  assert.deepEqual(apartmentPreviewCounts(candidates, 6), { doors: 2, spots: 1 });
  assert.deepEqual(apartmentPreviewCounts(candidates, 7), { doors: 0, spots: 0 });
});

test('the threshold clamps like the routes (min 2, default 4); no data counts nothing', () => {
  assert.deepEqual(apartmentPreviewCounts(candidates, 1), apartmentPreviewCounts(candidates, 2));
  assert.deepEqual(apartmentPreviewCounts(candidates, ''), apartmentPreviewCounts(candidates, 4));
  assert.deepEqual(apartmentPreviewCounts(undefined, 4), { doors: 0, spots: 0 });
});

test('the line names the rule at the chosen threshold', () => {
  assert.equal(
    apartmentPreviewLine({ doors: 441, spots: 61 }, 4),
    'Holds out 441 homes on 61 spots (4+ units at one address, or a unit address on a spot of 4+)'
  );
  assert.equal(
    apartmentPreviewLine({ doors: 1, spots: 1 }, 3),
    'Holds out 1 home on 1 spot (3+ units at one address, or a unit address on a spot of 3+)'
  );
  assert.equal(apartmentPreviewLine({ doors: 0, spots: 0 }, 4), 'None found');
});
