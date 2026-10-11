import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unplacedToggleCopy, unplacedLeftOutLine, unassignedDoorCount } from './turfUnplacedToggle.js';

test('the toggle and the after-cut line', () => {
  assert.equal(unplacedToggleCopy(32).label, 'Leave out 32 homes without a reliable map spot');
  assert.equal(unplacedToggleCopy(1).label, 'Leave out 1 home without a reliable map spot');
  assert.equal(unplacedLeftOutLine(32), '32 homes left out — fix their pins in Pin Fixes, then Add as new book.');
  assert.equal(unplacedLeftOutLine(1), '1 home left out — fix its pin in Pin Fixes, then Add as new book.');
});

test('not in any book: each ticked toggle subtracts its slice, the overlaps counted once', () => {
  const s = {
    supplementalDoorCount: 100,
    supplementalRestrictedCount: 10,
    supplementalNoSolicitingCount: 5,
    supplementalUnplacedCount: 8,
    supplementalUnplacedRestrictedCount: 2,
    supplementalUnplacedNoSolicitingCount: 1,
  };
  assert.equal(unassignedDoorCount(s), 100);
  assert.equal(unassignedDoorCount(s, { excludeRestricted: true }), 90);
  assert.equal(unassignedDoorCount(s, { excludeUnplaced: true }), 92);
  assert.equal(unassignedDoorCount(s, { excludeRestricted: true, excludeNoSoliciting: true, excludeUnplaced: true }), 100 - 10 - 5 - (8 - 2 - 1));
  assert.equal(unassignedDoorCount({}), 0);
});
