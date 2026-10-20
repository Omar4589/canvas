import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as web from './byPassFold.js';
// Cross-tree on purpose (same pattern and caveats as datePresets.parity.test.js): a pass that folds
// on the campaign Home must fold on the phone's campaign screen, and the two fold lines must say
// the same words and carry the same sums.
import * as mobile from '../../../mobile/lib/byPassFold.js';

const pass = (name, over = {}) => ({
  passId: `p-${name}`,
  effortName: name,
  roundLabel: 'Pass 1',
  status: 'active',
  knocks: 0,
  surveyedKnocks: 0,
  litKnocks: 0,
  surveysTaken: 0,
  notTargetKnocks: 0,
  coverageGained: 0,
  connectionRate: 0,
  ...over,
});
const worked = (name, knocks, over = {}) =>
  pass(name, { knocks, surveyedKnocks: Math.floor(knocks / 5), surveysTaken: Math.floor(knocks / 4), coverageGained: knocks, ...over });

// Every shape the fold distinguishes: nothing folds, quiet-only, cap-only, both, all quiet, a
// surveys-only row, a lit-drop row, and the legacy row (no walk list, no pass id).
const TABLES = [
  [],
  [worked('A', 10)],
  [worked('A', 10), pass('B')],
  [worked('A', 10), pass('B'), pass('C')],
  Array.from({ length: 11 }, (_, i) => worked(`W${i}`, 10 + i)),
  Array.from({ length: 13 }, (_, i) => worked(`W${i}`, 10 + i, { notTargetKnocks: i % 2 })),
  [...Array.from({ length: 12 }, (_, i) => worked(`W${i}`, 10 + i)), pass('Q1')],
  Array.from({ length: 9 }, (_, i) => pass(`Q${i}`)),
  [pass('S', { surveysTaken: 3 }), pass('Q1'), pass('Q2'), pass('L', { knocks: 9, litKnocks: 4 })],
  [worked('A', 40), pass('B', { status: 'archived' }), { ...pass('legacy'), passId: null, effortName: null, roundLabel: 'Legacy / no pass' }],
];
const CAPS = [0, 1, 6, 10];
const PRESETS = ['today', 'yesterday', '7d', '30d', 'all', 'custom', undefined];
// Every wording the fold line can take: each range, with and without a crew, live and archived.
const WORDS = PRESETS.flatMap((preset) =>
  [false, true].flatMap((crew) => [false, true].map((archived) => ({ preset, crew, archived })))
);

test('both platforms count the same fields', () => {
  assert.deepEqual(web.PASS_COUNTS, mobile.PASS_COUNTS);
});

test('both platforms fold every table the same way and say the same words', () => {
  for (const [t, rows] of TABLES.entries()) {
    for (const row of rows) assert.equal(web.isQuietPass(row), mobile.isQuietPass(row), `table ${t}`);
    assert.deepEqual(web.sumPasses(rows), mobile.sumPasses(rows), `table ${t} sum`);
    for (const cap of CAPS) {
      // The web's sum shares the fold line; the phone's takes its own row.
      for (const sumOwnRow of [false, true]) {
        const label = `table ${t}, cap ${cap}, sumOwnRow ${sumOwnRow}`;
        const a = web.foldPasses(rows, cap, { sumOwnRow });
        assert.deepEqual(a, mobile.foldPasses(rows, cap, { sumOwnRow }), label);
        if (!a.foldable) continue;
        for (const words of WORDS) {
          const w = `${label}, ${JSON.stringify(words)}`;
          assert.equal(web.foldLabel(a, words), mobile.foldLabel(a, words), w);
          assert.equal(web.quietCount(a, words), mobile.quietCount(a, words), w);
          assert.equal(web.quietActive(a, words), mobile.quietActive(a, words), w);
          assert.equal(web.quietTally(a, words), mobile.quietTally(a, words), w);
        }
        assert.equal(web.morePasses(a), mobile.morePasses(a), label);
      }
    }
  }
  for (const words of WORDS) {
    assert.equal(web.quietPhrase(words), mobile.quietPhrase(words), JSON.stringify(words));
    assert.equal(web.quietWhen(words.preset, words.archived), mobile.quietWhen(words.preset, words.archived));
  }
});
