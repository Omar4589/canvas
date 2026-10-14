import { test } from 'node:test';
import assert from 'node:assert';
import { indexPreview, fadeReasonOf, fadeReasonLine, fadeReasonShort, targetCountParts, targetCensus, targetDeadEnds } from './targetFade.js';

// The preview payload → one reason per drawn door, in the server's attribution order, and the
// words the page prints for it. Pins the thing the 2026-10-13 list swap exposed: a door faded by
// a BOX (not a status) must say so, and the parts of the count line must add up to the dots drawn.

const PREVIEW = {
  doorCount: 2,
  householdIds: ['k1', 'k2'],
  excludedHouseholdIds: ['x1'],
  leftOut: { restricted: ['r1'], noSoliciting: ['n1'], unplaced: ['u1', 'u2'], other: [] },
};
const DRAWN = [
  { id: 'k1', targetStatus: 'not_home' }, { id: 'k2', targetStatus: 'unknocked' },
  { id: 'x1', targetStatus: 'surveyed' }, { id: 'r1', targetStatus: 'restricted' },
  { id: 'n1', targetStatus: 'no_soliciting' }, { id: 'u1', targetStatus: 'unknocked' }, { id: 'u2', targetStatus: 'not_home' },
  { id: 's1', targetStatus: 'refused' }, // in no set: faded on its status
];

test('reasons come from the server\'s buckets; a door in no bucket and not kept failed the ticks', () => {
  const idx = indexPreview(PREVIEW);
  assert.equal(fadeReasonOf('k1', idx), null);
  assert.equal(fadeReasonOf('x1', idx), 'excluded');
  assert.equal(fadeReasonOf('r1', idx), 'restricted');
  assert.equal(fadeReasonOf('n1', idx), 'noSoliciting');
  assert.equal(fadeReasonOf('u2', idx), 'unplaced');
  assert.equal(fadeReasonOf('s1', idx), 'status');
  assert.equal(fadeReasonOf('anything', null), null, 'no preview = nothing fades');
  assert.equal(indexPreview(undefined), null);
});

test('the pop-up line names the box, or what the door failed — statuses, answers, or both', () => {
  assert.equal(fadeReasonLine(null), 'In this cut.');
  assert.equal(fadeReasonLine('status', { targetStatus: 'refused' }), 'Faded: reads Refused across all rounds, which isn\'t ticked.');
  assert.equal(fadeReasonLine('status', { targetStatus: 'refused', mode: { statusesOn: true } }), 'Faded: reads Refused across all rounds, which isn\'t ticked.');
  assert.equal(fadeReasonLine('status', { targetStatus: 'refused', mode: { answersOn: true } }), 'Faded: no matching survey answer.');
  assert.equal(fadeReasonLine('status', { targetStatus: 'refused', mode: { statusesOn: true, answersOn: true, combine: 'or' } }), 'Faded: reads Refused across all rounds, and no matching survey answer.');
  assert.match(fadeReasonLine('status', { targetStatus: 'refused', mode: { statusesOn: true, answersOn: true, combine: 'and' } }), /both the statuses and the answers/);
  assert.match(fadeReasonLine('unplaced'), /reliable map spot/);
  assert.match(fadeReasonLine('restricted'), /restricted-access/);
  assert.match(fadeReasonLine('noSoliciting'), /no-soliciting/);
  assert.match(fadeReasonLine('excluded'), /Exclude doors/);
  assert.equal(fadeReasonLine('other'), 'Faded: left out of this cut.');
  assert.equal(fadeReasonShort(null), 'in this cut');
  assert.equal(fadeReasonShort('status'), "status isn't ticked");
  assert.equal(fadeReasonShort('status', { mode: { answersOn: true } }), 'no matching answer');
  assert.equal(fadeReasonShort('status', { mode: { statusesOn: true, answersOn: true, combine: 'or' } }), 'matches neither');
  assert.match(fadeReasonShort('unplaced'), /map-spot box/);
});

test('the count line names every non-zero part of the preview\'s counts, in the page\'s order', () => {
  const counts = { drawable: 9, kept: 2, excluded: 1, restricted: 1, noSoliciting: 1, unplaced: 2, other: 0, status: 2 };
  assert.deepEqual(targetCountParts(counts, { statusesOn: true }), [
    '2 targeted doors', '1 removed by Exclude doors', '1 restricted left out', '1 no-soliciting left out',
    '2 without a reliable map spot left out', "2 don't match the ticked statuses",
  ]);
  assert.deepEqual(targetCountParts({ kept: 3, status: 4 }, { answersOn: true }), ['3 targeted doors', '4 have no matching answer']);
  assert.deepEqual(targetCountParts({ kept: 3, status: 4 }, { statusesOn: true, answersOn: true, combine: 'or' }), ['3 targeted doors', '4 match neither the ticked statuses nor the answers']);
  assert.deepEqual(targetCountParts({ kept: 3, status: 4 }, { statusesOn: true, answersOn: true, combine: 'and' }), ['3 targeted doors', "4 don't match both the ticked statuses and the answers"]);
  assert.deepEqual(targetCountParts({ kept: 1 }), ['1 targeted door']);
  assert.deepEqual(targetCountParts(), ['0 targeted doors']);
});

test('the census counts drawn doors by all-rounds status', () => {
  assert.deepEqual(targetCensus(DRAWN), { not_home: 2, unknocked: 2, surveyed: 1, restricted: 1, no_soliciting: 1, refused: 1 });
  assert.deepEqual(targetCensus([{ id: 'a' }]), { unknocked: 1 });
});

test('dead ends: a ticked status a box removes, and AND between a status and an answer', () => {
  assert.deepEqual(targetDeadEnds({ statuses: ['not_home'], boxes: { excludeRestricted: true } }), []);
  assert.equal(targetDeadEnds({ statuses: ['restricted'], boxes: { excludeRestricted: true } }).length, 1);
  assert.equal(targetDeadEnds({ statuses: ['restricted'], boxes: { excludeRestricted: false } }).length, 0);
  assert.equal(targetDeadEnds({ statuses: ['no_soliciting'], boxes: { excludeNoSoliciting: true } }).length, 1);
  assert.equal(targetDeadEnds({ statuses: ['not_home'], answersOn: true, combine: 'and' }).length, 1);
  assert.equal(targetDeadEnds({ statuses: ['surveyed'], answersOn: true, combine: 'and' }).length, 0, 'Surveyed AND an answer can match');
  assert.equal(targetDeadEnds({ statuses: ['surveyed', 'not_home'], answersOn: true, combine: 'and' }).length, 0, 'statuses are one OR set: Surveyed is still in it');
  assert.equal(targetDeadEnds({ statuses: ['restricted'], answersOn: true, combine: 'and' }).length, 0, 'a surveyed home with a mark reads Restricted, so Restricted AND an answer can match');
  assert.equal(targetDeadEnds({ statuses: [], answersOn: true, combine: 'and' }).length, 0, 'an answer alone is fine');
  assert.equal(targetDeadEnds({ statuses: ['not_home'], answersOn: true, combine: 'or' }).length, 0);
  assert.equal(targetDeadEnds({ statuses: ['restricted', 'not_home'], answersOn: true, combine: 'and', boxes: { excludeRestricted: true } }).length, 1, 'the box note only: Restricted can carry an answer');
  assert.equal(targetDeadEnds({ statuses: ['refused', 'not_home'], answersOn: true, combine: 'and', boxes: { excludeNoSoliciting: true } }).length, 1, 'the AND note only');
  assert.equal(targetDeadEnds({ statuses: ['no_soliciting', 'not_home'], answersOn: true, combine: 'and', boxes: { excludeNoSoliciting: true } }).length, 2, 'both');
});
