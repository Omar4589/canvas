// The Burton script — the client door script (Fulton County Commission District 3, election
// 2026-11-03) that Script flow was designed around — kept as a regression fixture. The blocks are
// authored exactly as docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md Part 1 "The Burton survey, as it will be
// authored" lays them out (arrows, not conditions; they live in __fixtures__/routing.fixtures.json),
// compiled by the real compiler, then walked on the REAL evaluator down twenty paths: every answer,
// both ways into Question 4, the default closing (Close 1) exactly on the paths that reach no
// explicit closing and never while a required question is still blank, and three cases where an
// earlier answer changed after later answers were given. The twenty are burton_final_proof.mjs's
// checks, unchanged (§F, §L).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compileRouting, switchToList } from './routing.js';
import { makeCell, visibleQuestionKeys } from './visibility.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '__fixtures__/routing.fixtures.json'), 'utf8'));
const authored = fixtures.find((f) => f.name === 'Burton, final graph (Part 1 table)');
if (!authored) throw new Error('routing.fixtures.json has lost its Burton entry');

const compiled = compileRouting(authored.questions);
// "Switch back to Show only if" keeps the exact conditions, so the list-style copy has to walk
// every path the same way.
const switchedBack = switchToList(authored.questions);

// The door screen's answers as evaluator cells, built the way the phone builds them: a choice
// answer is its option id, a text answer the words typed, and a statement takes no answer at all.
const cellsFor = (questions, answers) => {
  const cells = {};
  for (const q of questions) {
    const v = answers[q.key];
    const ids = q.type !== 'text' && q.type !== 'statement' && v != null ? [v] : [];
    cells[q.key] = makeCell(q.type, ids, q.type === 'text' ? (v ?? null) : null);
  }
  return cells;
};

// What the canvasser sees: the visible blocks in list order, and whether the default closing
// (template.closing, Close 1) is the goodbye — only when no closing block is visible AND no visible
// required question is still blank.
const walk = (questions, answers) => {
  const shown = visibleQuestionKeys(questions, cellsFor(questions, answers));
  const visible = questions.filter((q) => shown.has(q.key));
  const closingReached = visible.some((q) => q.type === 'statement' && q.role === 'closing');
  const requiredPending = visible.some((q) => q.type !== 'statement' && q.required && answers[q.key] == null);
  return { visible: visible.map((q) => q.key), defaultClosing: !closingReached && !requiredPending };
};

// [path, answers, visible blocks in list order, default closing is the goodbye]
const PATHS = [
  ['Yes + Election Day', { q1: 'yes', q4: 'election_day' }, ['q1', 'q4', 'close_2', 'close_4'], false],
  ['Yes + Vote by mail', { q1: 'yes', q4: 'by_mail' }, ['q1', 'q4', 'close_2', 'close_4'], false],
  ['Yes + Declined to answer', { q1: 'yes', q4: 'declined_to_answer' }, ['q1', 'q4', 'close_2', 'close_4'], false],
  ['Yes + Not voting -> Close 1', { q1: 'yes', q4: 'not_voting' }, ['q1', 'q4'], true],
  ['Yes, Q4 blank (no goodbye yet)', { q1: 'yes' }, ['q1', 'q4'], false],
  ['No, reason typed -> Close 1', { q1: 'no', q2: 'Prefers the incumbent' }, ['q1', 'q2', 's_q2_opponent'], true],
  ['No, reason blank -> Close 1', { q1: 'no' }, ['q1', 'q2', 's_q2_opponent'], true],
  ['Undecided, pitch, Q blank', { q1: 'undecided' }, ['q1', 's1_pitch', 's1_question'], false],
  [
    'Undecided -> Yes -> Q4 early',
    { q1: 'undecided', s1_question: 'yes', q4: 'voting_early' },
    ['q1', 's1_pitch', 's1_question', 'q4', 'close_2', 'close_4'],
    false,
  ],
  ['Undecided -> Yes, Q4 blank', { q1: 'undecided', s1_question: 'yes' }, ['q1', 's1_pitch', 's1_question', 'q4'], false],
  [
    'Undecided -> Still undecided',
    { q1: 'undecided', s1_question: 'still_undecided' },
    ['q1', 's1_pitch', 's1_question', 'close_4'],
    false,
  ],
  ['Undecided -> No -> Close 1', { q1: 'undecided', s1_question: 'no' }, ['q1', 's1_pitch', 's1_question'], true],
  ['Already voted + Yes', { q1: 'already_voted', q3: 'yes' }, ['q1', 'q3', 'close_3', 'close_4'], false],
  ['Already voted + No -> Close 1', { q1: 'already_voted', q3: 'no' }, ['q1', 'q3'], true],
  ['Already voted + Declined', { q1: 'already_voted', q3: 'declined_to_say' }, ['q1', 'q3'], true],
  ['Already voted, Q3 blank', { q1: 'already_voted' }, ['q1', 'q3'], false],
  ['Nothing answered yet', {}, ['q1'], false],
  ['STALE: yes->already_voted, Q4 left', { q1: 'already_voted', q4: 'election_day' }, ['q1', 'q3'], false],
  [
    'STALE: s1q yes->still_undecided, Q4 left',
    { q1: 'undecided', s1_question: 'still_undecided', q4: 'voting_early' },
    ['q1', 's1_pitch', 's1_question', 'close_4'],
    false,
  ],
  [
    'STALE: undecided->no, s1q+q4 left',
    { q1: 'no', s1_question: 'yes', q4: 'election_day' },
    ['q1', 'q2', 's_q2_opponent'],
    true,
  ],
];

test('Burton compiles cleanly, both styles', () => {
  assert.equal(PATHS.length, 20, 'the twenty checks of burton_final_proof.mjs');
  assert.deepEqual(compiled.errors, []);
  assert.deepEqual(switchedBack.errors, []);
});

for (const [name, answers, visible, defaultClosing] of PATHS) {
  test(`Burton path — ${name}`, () => {
    assert.deepEqual(walk(compiled.questions, answers), { visible, defaultClosing }, 'Go to (compiled)');
    assert.deepEqual(walk(switchedBack.questions, answers), { visible, defaultClosing }, 'switched back to Show only if');
  });
}
