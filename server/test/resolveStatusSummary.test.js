import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolveStatus,
  resolveStatusFromSummary,
  ACTION_TO_STATUS,
} from '../src/utils/statusPrecedence.js';

// resolveStatusFromSummary is the aggregation-shaped twin of resolveStatus: a per-door $group
// cannot ship whole rows, and handing the grouped document to resolveStatus returns 'unknocked'
// for every door (it reads actionType/timestamp off each ELEMENT). This file is the gate that
// keeps the twin honest.
//
// `summarize` emulates the $group the builder runs — $addToSet of actionType plus a
// $max: {at, action} composite, which Mongo compares element-wise, so instant first and
// actionType second. The REAL pipeline is pinned separately in the export's int suite; what is
// pinned here is the ladder, which is where the arithmetic lives.
const summarize = (rows) => {
  const kept = rows.filter((r) => r.actionType !== 'note_added');
  const latest = kept.reduce((best, r) => {
    if (!best) return r;
    const at = new Date(r.timestamp).getTime();
    const bestAt = new Date(best.timestamp).getTime();
    if (at !== bestAt) return at > bestAt ? r : best;
    return r.actionType > best.actionType ? r : best; // the composite's second element
  }, null);
  return {
    actions: [...new Set(kept.map((r) => r.actionType))],
    latestActionType: latest ? latest.actionType : null,
  };
};

const T = (h) => new Date(`2026-07-0${h}T12:00:00Z`);

// Every shape the door aggregation can produce, with DISTINCT instants — the case where the two
// forms must agree exactly. The desk-restricted rows are the load-bearing ones: a door knocked
// and later restricted from the desk reads 'restricted' on the map, the Books page and Door
// Outcomes, so it must read 'Restricted' in a client-sendable CSV too.
const MATRIX = [
  [],
  [{ actionType: 'not_home', timestamp: T(1) }],
  [{ actionType: 'restricted', timestamp: T(1) }],
  [{ actionType: 'note_added', timestamp: T(1) }],
  [{ actionType: 'note_added', timestamp: T(2) }, { actionType: 'not_home', timestamp: T(1) }],
  [{ actionType: 'not_home', timestamp: T(1) }, { actionType: 'survey_submitted', timestamp: T(2) }],
  [{ actionType: 'survey_submitted', timestamp: T(1) }, { actionType: 'not_home', timestamp: T(2) }],
  [{ actionType: 'not_home', timestamp: T(1) }, { actionType: 'restricted', timestamp: T(2) }],
  [{ actionType: 'restricted', timestamp: T(1) }, { actionType: 'not_home', timestamp: T(2) }],
  [{ actionType: 'lit_dropped', timestamp: T(1) }, { actionType: 'not_home', timestamp: T(2) }],
  [{ actionType: 'refused', timestamp: T(1) }, { actionType: 'no_soliciting', timestamp: T(2) }],
  [{ actionType: 'wrong_address', timestamp: T(3) }, { actionType: 'not_home', timestamp: T(1) }],
];

for (const campaignType of ['survey', 'lit_drop']) {
  test(`aggregated ladder matches resolveStatus on distinct instants (${campaignType})`, () => {
    for (const rows of MATRIX) {
      assert.strictEqual(
        resolveStatusFromSummary(campaignType, summarize(rows)),
        resolveStatus(campaignType, rows),
        `disagreed on ${JSON.stringify(rows.map((r) => r.actionType))}`
      );
    }
  });
}

test('a knocked-then-desk-restricted door reads restricted, not the knock', () => {
  const rows = [
    { actionType: 'not_home', timestamp: T(1) },
    { actionType: 'restricted', timestamp: T(2) },
  ];
  assert.strictEqual(resolveStatusFromSummary('survey', summarize(rows)), 'restricted');
});

test('completion stays sticky through a later non-completion row', () => {
  const rows = [
    { actionType: 'survey_submitted', timestamp: T(1) },
    { actionType: 'not_home', timestamp: T(3) },
  ];
  assert.strictEqual(resolveStatusFromSummary('survey', summarize(rows)), 'surveyed');
  // ...and is NOT sticky on a lit-drop campaign, where surveying is not the completion.
  assert.strictEqual(resolveStatusFromSummary('lit_drop', summarize(rows)), 'not_home');
});

test('notes alone never make a door look worked', () => {
  const s = summarize([{ actionType: 'note_added', timestamp: T(1) }]);
  assert.deepStrictEqual(s.actions, []);
  assert.strictEqual(resolveStatusFromSummary('survey', s), 'unknocked');
  // Defensive: even if a caller forgets STATUS_ROW_MATCH and lets notes into the set.
  assert.strictEqual(
    resolveStatusFromSummary('survey', { actions: ['note_added'], latestActionType: 'note_added' }),
    'unknocked'
  );
});

// The one place the two forms DIVERGE, on purpose. At equal instants resolveStatus keeps whichever
// row the array happened to hold first (strict `>` at statusPrecedence.js:48), so it answers two
// different ways for the same door depending on scan order. The composite breaks the tie on
// actionType instead, so the aggregated form is stable — which is the whole reason the builder
// must not $push rows back in and re-inherit the coin flip.
test('at equal instants resolveStatus is order-dependent and the summary form is not', () => {
  const a = { actionType: 'not_home', timestamp: T(1) };
  const b = { actionType: 'refused', timestamp: T(1) };
  assert.strictEqual(resolveStatus('survey', [a, b]), 'not_home');
  assert.strictEqual(resolveStatus('survey', [b, a]), 'refused', 'the coin flip this twin avoids');

  const forward = resolveStatusFromSummary('survey', summarize([a, b]));
  const reversed = resolveStatusFromSummary('survey', summarize([b, a]));
  assert.strictEqual(forward, reversed);
  assert.strictEqual(forward, 'refused', 'the composite resolves the tie on actionType');
});

test('every status the ladder can return has a door-status label', async () => {
  const { DOOR_STATUS_LABELS } = await import('../src/utils/statusPrecedence.js');
  for (const status of ['unknocked', ...Object.values(ACTION_TO_STATUS)]) {
    assert.ok(DOOR_STATUS_LABELS[status], `no label for '${status}'`);
  }
});
