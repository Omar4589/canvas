import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASS_COUNTS,
  isQuietPass,
  sumPasses,
  foldPasses,
  quietWhen,
  quietPhrase,
  foldLabel,
  morePasses,
  quietCount,
  quietActive,
  quietTally,
} from './byPassFold.js';

// Mirror of client/src/lib/byPassFold.test.js — the shared rules pinned on the mobile copy too, so
// a drift between the two mirrors fails a test instead of shipping a pass that shows on one
// platform and folds on the other. The campaign screen's By pass card folds the passes with nothing
// in the range, caps the rest, and sums what the cap hides — so a fifty-precinct campaign fits on a
// phone and what is on screen still adds up to the Knocks headline.

// A knocks-by-pass row as the server sends it (server/src/services/reports/knocksByPass.js).
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
const worked = (name, knocks, surveyed = 0, over = {}) =>
  pass(name, {
    knocks,
    surveyedKnocks: surveyed,
    surveysTaken: surveyed,
    coverageGained: knocks,
    connectionRate: knocks ? Math.round((surveyed / knocks) * 100) : 0,
    ...over,
  });
const names = (rows) => rows.map((r) => r.effortName);
const table = (nWorked, nQuiet) => [
  ...Array.from({ length: nWorked }, (_, i) => worked(`W${String(i).padStart(2, '0')}`, 10 + i)),
  ...Array.from({ length: nQuiet }, (_, i) => pass(`Q${String(i).padStart(2, '0')}`)),
];

test('a pass folds only when every number its row can show is 0', () => {
  assert.equal(isQuietPass(pass('A')), true);
  for (const k of PASS_COUNTS) assert.equal(isQuietPass(pass('A', { [k]: 1 })), false, k);
  // Forms in range with no knocks in range (the response ledger runs on submittedAt) — a real
  // number on the row, so it stays open.
  assert.equal(isQuietPass(pass('A', { surveysTaken: 3 })), false);
  // Neither By pass table shows restricted doors, so a restricted-only pass has nothing to show.
  assert.equal(isQuietPass(pass('A', { restrictedDoors: 4, billableDoors: 4 })), true);
  // A field an older server never sent reads as 0.
  assert.equal(isQuietPass({ passId: 'x' }), true);
});

test('nothing folds when folding would save no room', () => {
  const rows = [worked('A', 10, 2), pass('B'), worked('C', 5, 1)];
  const f = foldPasses(rows, 10);
  assert.equal(f.foldable, false);
  assert.deepEqual(f.open, rows, 'every row, in the order it came — the table as it always read');
  assert.deepEqual([f.worked, f.quiet, f.hiddenWorked, f.hiddenSum], [[], [], [], null]);

  // The cap lets ONE extra numbered row through rather than fold it on its own…
  assert.equal(foldPasses(table(11, 0), 10).foldable, false);
  assert.equal(foldPasses(table(11, 0), 10).open.length, 11);
  // …and one quiet row beside them doesn't tip it over either.
  assert.equal(foldPasses(table(11, 1), 10).foldable, false);
  assert.equal(foldPasses(table(11, 1), 10).open.length, 12);

  assert.deepEqual(foldPasses([], 10).open, []);
});

test('quiet passes fold; the passes with numbers stay open, in order', () => {
  const rows = [pass('A'), worked('B', 412, 96), pass('C'), worked('D', 380, 80), pass('E')];
  const f = foldPasses(rows, 10);
  assert.equal(f.foldable, true);
  assert.deepEqual(names(f.open), ['B', 'D']);
  assert.deepEqual(names(f.worked), ['B', 'D']);
  assert.deepEqual(names(f.quiet), ['A', 'C', 'E']);
  assert.deepEqual(f.hiddenWorked, []);
  assert.equal(f.hiddenSum, null, 'nothing with a number is hidden, so the fold line carries none');
  assert.equal(f.total, 5);
  assert.equal(foldLabel(f, { preset: 'today' }), 'Show 3 passes with no knocks today (3 active)');
  assert.equal(quietCount(f, { preset: 'today' }), '3 with no knocks today (3 active)');
});

test('a range with nothing in it folds the whole table into the one line', () => {
  const f = foldPasses(table(0, 47), 10);
  assert.equal(f.foldable, true);
  assert.deepEqual(f.open, []);
  assert.equal(f.hiddenSum, null);
  assert.equal(foldLabel(f, { preset: 'today' }), 'Show 47 passes with no knocks today (47 active)');
});

test('past the cap the rest fold into a line carrying their sum: on screen + the line === TOTAL', () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, i) =>
      worked(`P${String(i).padStart(2, '0')}`, 100 + i, 20 + i, { notTargetKnocks: i % 3, litKnocks: 0 })
    ),
    pass('Q1'),
    pass('Q2'),
  ];
  const f = foldPasses(rows, 10);
  assert.equal(f.foldable, true);
  assert.equal(f.open.length, 10);
  assert.deepEqual(names(f.hiddenWorked), ['P10', 'P11'], 'the cap takes the rows in display order');
  assert.deepEqual(names(f.quiet), ['Q1', 'Q2']);
  // The server's TOTAL row is Σ rounds (knocksByPass.js) — so the sum of every row stands in for it.
  const all = sumPasses(rows);
  const onScreen = sumPasses(f.open);
  for (const k of PASS_COUNTS) assert.equal(onScreen[k] + f.hiddenSum[k], all[k], k);
  assert.equal(foldLabel(f, { preset: 'all' }), 'Show all 14 passes');
  assert.equal(morePasses(f), '2 more passes');
  assert.equal(quietCount(f, { preset: 'all' }), '2 with no knocks yet (2 active)');

  // One quiet row rides along in a fold that is happening anyway (it adds nothing to the sum).
  const g = foldPasses(rows.slice(0, 13), 10);
  assert.equal(g.foldable, true);
  assert.deepEqual(names(g.quiet), ['Q1']);
  assert.equal(quietCount(g, { preset: '7d' }), '1 with no knocks in the last 7 days (1 active)');
});

test('the phone’s sum takes its own row, so its cap folds only when that still saves a row', () => {
  const phone = { sumOwnRow: true };
  // 8 passes with numbers, cap 6: six rows + "2 more passes" + Show all is still 8 rows — no fold.
  assert.equal(foldPasses(table(8, 0), 6, phone).foldable, false);
  assert.equal(foldPasses(table(8, 0), 6, phone).open.length, 8);
  // The web's sum shares the fold line, so the same table folds there (10 shown + 1 line < 12).
  assert.equal(foldPasses(table(12, 0), 10).foldable, true);
  // One quiet pass beside them pays for the sum's row: 6 + 2 rows < 9.
  const h = foldPasses(table(8, 1), 6, phone);
  assert.equal(h.foldable, true);
  assert.equal(h.hiddenWorked.length, 2);
  assert.equal(foldPasses(table(9, 0), 6, phone).hiddenWorked.length, 3);
  // Two quiet passes fold on their own; the cap then lets the seventh numbered pass through.
  const k = foldPasses(table(7, 2), 6, phone);
  assert.deepEqual([k.foldable, k.open.length, k.hiddenWorked.length, k.quiet.length], [true, 7, 0, 2]);
});

test('every fold saves at least one row, and never folds away a single numbered row', () => {
  for (const sumOwnRow of [false, true]) {
    for (const cap of [0, 1, 6, 10]) {
      for (let w = 0; w <= 16; w++) {
        for (let q = 0; q <= 4; q++) {
          const rows = table(w, q);
          const f = foldPasses(rows, cap, { sumOwnRow });
          const label = JSON.stringify({ sumOwnRow, cap, w, q });
          if (!f.foldable) {
            assert.deepEqual(f.open, rows, label);
            continue;
          }
          const shownRows = f.open.length + 1 + (f.hiddenSum && sumOwnRow ? 1 : 0);
          assert.ok(shownRows < rows.length, `${label} saves a row`);
          assert.notEqual(f.hiddenWorked.length, 1, label);
          assert.equal(f.open.length + f.hiddenWorked.length + f.quiet.length, rows.length, label);
        }
      }
    }
  }
});

test('the line’s rate is rebuilt from its counts with the server’s formula, never averaged', () => {
  const s = sumPasses([worked('A', 3, 3), worked('B', 300, 30)]);
  assert.equal(s.knocks, 303);
  assert.equal(s.surveyedKnocks, 33);
  assert.equal(s.connectionRate, 11, '33 ÷ 303 — averaging 100% and 10% would say 55%');
  // aggregations.js connectionRate: (survey + lit doors) ÷ knocks, Math.round, 0 with no knocks.
  assert.equal(sumPasses([pass('L', { knocks: 10, litKnocks: 7 })]).connectionRate, 70);
  assert.equal(sumPasses([pass('H', { knocks: 8, surveyedKnocks: 1 })]).connectionRate, 13, '12.5 rounds up');
  assert.equal(sumPasses([]).connectionRate, 0);
  assert.equal(sumPasses([pass('S', { surveysTaken: 4 })]).connectionRate, 0, 'forms but no knocks');
});

test('the fold line names the range, the crew and an archived campaign in words', () => {
  assert.deepEqual(
    ['today', 'yesterday', '7d', '30d', 'all', 'custom', undefined].map((p) => quietWhen(p)),
    ['today', 'yesterday', 'in the last 7 days', 'in the last 30 days', 'yet', 'in this range', 'in this range']
  );
  // An archived campaign takes no more knocks, so all-time doesn't say "yet".
  assert.equal(quietWhen('all', true), '');
  assert.equal(quietWhen('today', true), 'today');
  assert.equal(quietPhrase({ preset: 'today' }), 'no knocks today');
  // With a crew picked, a quiet pass may well have been knocked by another crew.
  assert.equal(quietPhrase({ preset: 'today', crew: true }), 'no knocks from this crew today');
  assert.equal(quietPhrase({ preset: 'all', archived: true }), 'no knocks');
  assert.equal(quietPhrase({ preset: 'all', crew: true, archived: true }), 'no knocks from this crew');
  assert.equal(quietPhrase(), 'no knocks in this range');
  const f = foldPasses(table(2, 5), 10);
  assert.equal(foldLabel(f, { preset: '7d', crew: true }), 'Show 5 passes with no knocks from this crew in the last 7 days (5 active)');
  assert.equal(quietCount(f, { preset: 'all', archived: true }), '5 with no knocks');
});

test('the quiet line counts the live passes among them — never on an archived campaign', () => {
  const rows = [pass('A'), pass('B', { status: 'archived' }), pass('C', { status: 'draft' }), pass('D'), worked('E', 5)];
  const f = foldPasses(rows, 10);
  assert.equal(quietActive(f, { preset: 'today' }), 2, 'A and D: live passes nobody knocked today');
  assert.equal(foldLabel(f, { preset: 'today' }), 'Show 4 passes with no knocks today (2 active)');
  assert.equal(quietCount(f, { preset: 'today' }), '4 with no knocks today (2 active)');
  assert.equal(quietTally(f, { preset: 'today' }), '4 passes (2 active)');
  // With a crew picked the count still reads against that crew's quiet line.
  assert.equal(foldLabel(f, { preset: 'today', crew: true }), 'Show 4 passes with no knocks from this crew today (2 active)');
  // An archived campaign marks nothing active, so nothing is counted.
  assert.equal(quietActive(f, { preset: 'all', archived: true }), 0);
  assert.equal(foldLabel(f, { preset: 'all', archived: true }), 'Show 4 passes with no knocks');
  assert.equal(quietTally(f, { archived: true }), '4 passes');
  // No live pass among them: no "(0 active)".
  const g = foldPasses([pass('A', { status: 'archived' }), pass('B', { status: 'archived' }), worked('E', 5)], 10);
  assert.equal(foldLabel(g, { preset: 'today' }), 'Show 2 passes with no knocks today');
  assert.equal(quietTally(g, {}), '2 passes');
  assert.equal(quietTally(foldPasses([pass('A'), pass('B', { status: 'archived' }), worked('E', 5)], 10), {}), '2 passes (1 active)');
});
