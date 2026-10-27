import { test } from 'node:test';
import assert from 'node:assert';
import { KNOCKABLE_DOOR_FILTER, KNOCKABLE_DOOR_FLAGS } from '../src/services/canvass/knockableDoorFilter.js';
import { isSuppressedDoor } from '../../mobile/lib/deltaFold.js';

// The phone's copy of the knockable-door rule (mobile/lib/deltaFold.js isSuppressedDoor) against the server's
// (KNOCKABLE_DOOR_FILTER), flag by flag. An open phone drops a door the rule rejects and pulls a fresh bootstrap
// for a door it lacks that the rule accepts, so a flag the phone doesn't know would leave suppressed doors on open
// phones AND read each one as a door that came back, reloading on every poll that carries it. A 6th server flag
// fails here until the phone learns it (an OTA); KNOCKABLE_DOOR_FLAGS already ships it on /changes.

// The value that breaks one filter clause: `true` → false, `{ $ne: true }` → true. Any other shape is a rule
// the phone's one-line check can't be assumed to mirror.
const violating = (clause) => {
  if (clause === true) return false;
  if (clause && typeof clause === 'object' && Object.keys(clause).length === 1 && clause.$ne === true) return true;
  throw new Error(`KNOCKABLE_DOOR_FILTER clause ${JSON.stringify(clause)} has a shape this test doesn't know: teach isSuppressedDoor and this test`);
};
const openDoor = () => Object.fromEntries(Object.entries(KNOCKABLE_DOOR_FILTER).map(([k, c]) => [k, !violating(c)]));

test('every server flag rides the /changes delta', () => {
  assert.deepStrictEqual(Object.keys(KNOCKABLE_DOOR_FLAGS).sort(), Object.keys(KNOCKABLE_DOOR_FILTER).sort());
  assert.ok(Object.values(KNOCKABLE_DOOR_FLAGS).every((v) => v === 1));
});

test('a door passing every server flag is not suppressed on the phone', () => {
  assert.strictEqual(isSuppressedDoor(openDoor()), false);
});

test('breaking any single server flag suppresses the door on the phone', () => {
  for (const [flag, clause] of Object.entries(KNOCKABLE_DOOR_FILTER)) {
    assert.strictEqual(isSuppressedDoor({ ...openDoor(), [flag]: violating(clause) }), true, `${flag} must suppress on the phone`);
  }
});
