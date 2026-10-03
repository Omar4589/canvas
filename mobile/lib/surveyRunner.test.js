import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell, visibleQuestionKeys } from './surveyVisibility.js';
import {
  isStatement,
  isAnswerable,
  isClosingBlock,
  activeBlocks,
  buildCells,
  visibleBlocks,
  isAnswered,
  answerableQuestions,
  questionNumbers,
  requiredPending,
  pathComplete,
  progress,
  buildSubmitRows,
  closingReached,
  isScripted,
  needsClosingGuard,
  showDefaultClosing,
  INTRO_SCREEN_ID,
  END_SCREEN_ID,
  screens,
  saveScreenId,
  screenKind,
  clampScreenId,
  canAdvance,
  canSkip,
  nextScreenId,
  prevScreenId,
  skipAnswer,
} from './surveyRunner.js';

const INTRO = INTRO_SCREEN_ID;
const END = END_SCREEN_ID;
const keys = (blocks) => blocks.map((q) => q.key);
const ids = (list) => list.map((s) => s.id);

// ---- The oracle: the survey screen's own code from before the runner existed --------------------
// Copied from mobile/app/(app)/voter/[id]/survey.jsx at 6d3ca94: the visibleQuestions memo,
// isAnsweredNow, validate(), the progress numbers and the POST rows. The bodies are verbatim; only
// the wrapping changed (the closures became arrow functions over survey/answers/otherTexts). It is
// FROZEN: for a survey without statements the runner must agree with it exactly. Never edit it to
// make a test pass.
const legacyScreen = (survey, answers, otherTexts) => {
  let rawAnswersByKey = {};
  const visibleQuestions = (() => {
    if (!survey) return [];
    rawAnswersByKey = {};
    for (const q of survey.questions) {
      if (q.retired) continue;
      const v = answers[q.key];
      let ids = [];
      let textFromState = null;
      if (q.type === 'multiple_choice') {
        ids = Array.isArray(v) ? v : [];
      } else if (q.type === 'text') {
        ids = [];
        textFromState = v;
      } else {
        ids = v != null ? [v] : [];
      }
      rawAnswersByKey[q.key] = makeCell(q.type, ids, textFromState);
    }
    const vis = visibleQuestionKeys(survey.questions, rawAnswersByKey);
    return survey.questions.filter((q) => !q.retired && vis.has(q.key));
  })();

  const isAnsweredNow = (q) => {
    const v = answers[q.key];
    if (q.type === 'multiple_choice') {
      const arr = Array.isArray(v) ? v : [];
      if (arr.length === 0) return false;
      if (arr.includes('__other__')) {
        const t = otherTexts[q.key];
        const otherOk = typeof t === 'string' && t.trim().length > 0;
        // Other-only selection requires its text; any real option also counts.
        if (arr.length === 1) return otherOk;
        return true;
      }
      return true;
    }
    if (q.type === 'text') return typeof v === 'string' && v.trim().length > 0;
    if (v === '__other__') {
      const t = otherTexts[q.key];
      return typeof t === 'string' && t.trim().length > 0;
    }
    return v != null && v !== '';
  };

  const validate = () => {
    for (const q of visibleQuestions) {
      if (!q.required) continue;
      if (!isAnsweredNow(q)) {
        return `Please answer: ${q.label}`;
      }
    }
    return null;
  };

  const totalQuestions = visibleQuestions.length;
  const answeredCount = visibleQuestions.filter((q) => isAnsweredNow(q)).length;
  const percent =
    totalQuestions === 0 ? 100 : Math.round((answeredCount / totalQuestions) * 100);

  const rows = visibleQuestions.map((q) => {
    const v = answers[q.key];
    if (q.type === 'text') {
      // Always emit otherText (null here) to match the answer schema.
      return { questionKey: q.key, questionLabel: q.label, answer: v ?? null, optionIds: [], otherText: null };
    }
    // Choice: answer state holds option id(s) — incl. the '__other__'
    // sentinel when picked. Send the ids + a text snapshot.
    const ids = q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v != null ? [v] : [];
    const hasOther = ids.includes('__other__');
    const otherText = hasOther ? (otherTexts[q.key] ?? null) : null;
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    // Map real ids to their labels; the '__other__' sentinel snapshots its
    // free-text (fallback 'Other') since it has no real option label.
    const texts = ids
      .map((id) => (id === '__other__' ? (otherTexts[q.key] || 'Other') : byId.get(id)))
      .filter((t) => t != null);
    const answer = q.type === 'multiple_choice' ? texts : texts[0] ?? null;
    return { questionKey: q.key, questionLabel: q.label, answer, optionIds: ids, otherText };
  });

  return { rawAnswersByKey, visibleQuestions, isAnsweredNow, validate, totalQuestions, answeredCount, percent, rows };
};

// ---- A survey of today's shape: no statements, List flow, fields absent as on a lean read -------
const PLAIN = {
  intro: 'Hi, I am with the campaign.',
  closing: 'Thanks for your time!',
  questions: [
    {
      key: 'color',
      label: 'Favourite colour?',
      type: 'single_choice',
      required: true,
      otherOption: true,
      options: [
        { id: 'red', text: 'Red', script: 'Red is bold.' },
        { id: 'blue', text: 'Blue' },
        { id: 'green', text: 'Green', retired: true },
      ],
    },
    {
      key: 'shade',
      label: 'Which red?',
      type: 'single_choice',
      required: true,
      options: [
        { id: 'crimson', text: 'Crimson' },
        { id: 'scarlet', text: 'Scarlet' },
      ],
      visibleIf: { logic: 'all', rules: [{ questionKey: 'color', op: 'is', optionIds: ['red'] }] },
    },
    {
      key: 'toppings',
      label: 'Toppings?',
      type: 'multiple_choice',
      otherOption: true,
      options: [
        { id: 'a', text: 'Anchovy' },
        { id: 'b', text: 'Basil' },
      ],
    },
    { key: 'old', label: 'A retired question', type: 'text', retired: true },
    { key: 'why', label: 'Why?', type: 'text' },
    {
      key: 'followup',
      label: 'Can we follow up?',
      type: 'single_choice',
      options: [{ id: 'yes', text: 'Yes' }],
      visibleIf: { logic: 'all', rules: [{ questionKey: 'why', op: 'answered', optionIds: [] }] },
    },
  ],
};

// Every combination of these per-question states, a stray answer on the retired question in each.
const product = (axes) =>
  axes.reduce((acc, [key, values]) => acc.flatMap((s) => values.map((v) => ({ ...s, [key]: v }))), [{}]);
const PLAIN_STATES = product([
  ['color', [undefined, 'red', 'blue', 'green', '__other__']],
  ['colorOther', [undefined, '', '   ', 'Teal']],
  ['shade', [undefined, 'crimson']],
  ['toppings', [undefined, [], ['a'], ['a', 'b'], ['__other__'], ['b', '__other__']]],
  ['toppingsOther', [undefined, ' ', 'Olive']],
  ['why', [undefined, '', '   ', 'Because']],
  ['followup', [undefined, 'yes']],
]).map((s) => {
  const answers = { old: 'stale' };
  const otherTexts = {};
  for (const k of ['color', 'shade', 'toppings', 'why', 'followup']) if (s[k] !== undefined) answers[k] = s[k];
  if (s.colorOther !== undefined) otherTexts.color = s.colorOther;
  if (s.toppingsOther !== undefined) otherTexts.toppings = s.toppingsOther;
  return { answers, otherTexts };
});

test('a survey without statements: every function agrees with the old screen code, state by state', () => {
  assert.ok(PLAIN_STATES.length > 5000, 'the state space is the point of this test');
  for (const { answers, otherTexts } of PLAIN_STATES) {
    const at = JSON.stringify({ answers, otherTexts });
    const old = legacyScreen(PLAIN, answers, otherTexts);
    const blocks = visibleBlocks(PLAIN, answers);

    assert.deepEqual(buildCells(PLAIN.questions, answers), old.rawAnswersByKey, `cells ${at}`);
    assert.deepEqual(keys(blocks), keys(old.visibleQuestions), `visible ${at}`);
    for (const q of blocks) assert.equal(isAnswered(q, answers, otherTexts), old.isAnsweredNow(q), `${q.key} ${at}`);
    assert.deepEqual(
      progress(blocks, answers, otherTexts),
      { answered: old.answeredCount, total: old.totalQuestions, percent: old.percent },
      `progress ${at}`
    );
    const pending = requiredPending(blocks, answers, otherTexts);
    assert.equal(pending ? `Please answer: ${pending.label}` : null, old.validate(), `validate ${at}`);
    assert.equal(pathComplete(blocks, answers, otherTexts), old.validate() === null, `pathComplete ${at}`);
    // Byte for byte, field order included: this is what the offline queue freezes.
    assert.equal(JSON.stringify(buildSubmitRows(blocks, answers, otherTexts)), JSON.stringify(old.rows), `rows ${at}`);
    assert.deepEqual([...questionNumbers(blocks)], old.visibleQuestions.map((q, i) => [q.key, i + 1]), `numbers ${at}`);
    // The closing field rendered unconditionally whenever it had text, a blank required question or not.
    assert.equal(showDefaultClosing(PLAIN, blocks, answers, otherTexts), true, `closing ${at}`);
  }
});

test('isAnswered: Other counts only with typed text, and whitespace is blank', () => {
  const single = PLAIN.questions[0];
  const multi = PLAIN.questions[2];
  const text = PLAIN.questions[4];
  assert.equal(isAnswered(single, {}, {}), false);
  assert.equal(isAnswered(single, { color: 'blue' }, {}), true);
  assert.equal(isAnswered(single, { color: '__other__' }, {}), false);
  assert.equal(isAnswered(single, { color: '__other__' }, { color: '  \n ' }), false);
  assert.equal(isAnswered(single, { color: '__other__' }, { color: 'Teal' }), true);
  assert.equal(isAnswered(multi, { toppings: [] }, {}), false);
  assert.equal(isAnswered(multi, { toppings: ['__other__'] }, { toppings: ' ' }), false);
  assert.equal(isAnswered(multi, { toppings: ['__other__'] }, { toppings: 'Olive' }), true);
  assert.equal(isAnswered(multi, { toppings: ['a', '__other__'] }, {}), true, 'a real option alongside Other already counts');
  assert.equal(isAnswered(text, { why: '   ' }, {}), false);
  assert.equal(isAnswered(text, { why: 'Because' }), true, 'otherTexts may be omitted');
});

test('the POST rows: Other snapshots its typed text, or "Other" when nothing was typed', () => {
  const blocks = visibleBlocks(PLAIN, { color: '__other__', toppings: ['b', '__other__'] });
  assert.deepEqual(buildSubmitRows(blocks, { color: '__other__', toppings: ['b', '__other__'] }, { color: 'Teal' }), [
    { questionKey: 'color', questionLabel: 'Favourite colour?', answer: 'Teal', optionIds: ['__other__'], otherText: 'Teal' },
    { questionKey: 'toppings', questionLabel: 'Toppings?', answer: ['Basil', 'Other'], optionIds: ['b', '__other__'], otherText: null },
    { questionKey: 'why', questionLabel: 'Why?', answer: null, optionIds: [], otherText: null },
  ]);
});

// ---- Statements --------------------------------------------------------------------------------
const WITH_STATEMENTS = {
  intro: '',
  closing: 'Bye now.',
  questions: [
    { key: 'opening_line', type: 'statement', role: 'statement', label: 'Read this first.' },
    {
      key: 'q1',
      type: 'single_choice',
      label: 'Support?',
      required: true,
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
      ],
    },
    // Stored required by an old API call: the server coerces this now, but the runner must not
    // let it block Save (on the old screen it blocked Save forever).
    { key: 'pitch', type: 'statement', label: 'The pitch, read aloud.', required: true },
    { key: 'q2', type: 'text', label: 'Why?' },
    { key: 'retired_statement', type: 'statement', role: 'closing', label: 'Old goodbye', retired: true },
  ],
};

test('block kinds: a statement is decided by its type, never by role alone', () => {
  const [opening, q1, pitch] = WITH_STATEMENTS.questions;
  assert.equal(isStatement(opening), true);
  assert.equal(isAnswerable(opening), false);
  assert.equal(isStatement(q1), false);
  assert.equal(isAnswerable(q1), true);
  assert.equal(isClosingBlock(pitch), false, 'a statement with no role is a plain statement');
  assert.equal(isClosingBlock({ type: 'statement', role: 'closing' }), true);
  assert.equal(isClosingBlock({ type: 'single_choice', role: 'closing' }), false, 'role only means something on a statement');
  assert.equal(isStatement(null), false);
  assert.equal(isAnswerable(undefined), false);
  assert.deepEqual(keys(activeBlocks(WITH_STATEMENTS)), ['opening_line', 'q1', 'pitch', 'q2']);
});

test('statements take no number, no progress, no POST row, and never block Save', () => {
  const answers = { q1: 'yes', pitch: 'stray', opening_line: ['stray'] };
  const blocks = visibleBlocks(WITH_STATEMENTS, answers);
  assert.deepEqual(keys(blocks), ['opening_line', 'q1', 'pitch', 'q2']);
  assert.deepEqual(keys(answerableQuestions(blocks)), ['q1', 'q2']);
  assert.deepEqual([...questionNumbers(blocks)], [['q1', 1], ['q2', 2]]);
  assert.deepEqual(progress(blocks, answers, {}), { answered: 1, total: 2, percent: 50 });
  assert.equal(requiredPending(blocks, answers, {}), null, 'the required statement is not pending');
  assert.equal(pathComplete(blocks, answers, {}), true);
  assert.deepEqual(buildSubmitRows(blocks, answers, {}).map((r) => r.questionKey), ['q1', 'q2']);
  assert.equal(isAnswered(WITH_STATEMENTS.questions[2], answers, {}), false, 'stray state never answers a statement');
  // A statement's cell is empty whatever the state holds.
  const cells = buildCells(WITH_STATEMENTS.questions, answers);
  assert.deepEqual(cells.pitch, { optionIds: [], text: null });
  assert.deepEqual(cells.opening_line, { optionIds: [], text: null });
  assert.equal('retired_statement' in cells, false);
  // An unanswered required question is still caught.
  assert.equal(requiredPending(visibleBlocks(WITH_STATEMENTS, {}), {}, {}).key, 'q1');
});

// ---- Closings ----------------------------------------------------------------------------------
test('the closing guard: an existing survey shows its closing as today; a scripted one waits', () => {
  const blank = visibleBlocks(PLAIN, {});
  assert.equal(needsClosingGuard(PLAIN), false);
  assert.equal(requiredPending(blank, {}, {}).key, 'color');
  assert.equal(showDefaultClosing(PLAIN, blank, {}, {}), true, 'plain: shown even with a blank required question');

  const scripted = { ...PLAIN, flow: 'script' };
  assert.equal(needsClosingGuard(scripted), true);
  assert.equal(showDefaultClosing(scripted, blank, {}, {}), false, 'scripted: withheld while a required question is blank');
  const done = { color: 'blue' };
  assert.equal(showDefaultClosing(scripted, visibleBlocks(scripted, done), done, {}), true);
  const otherBlank = { color: '__other__' };
  assert.equal(
    showDefaultClosing(scripted, visibleBlocks(scripted, otherBlank), otherBlank, { color: ' ' }),
    false,
    'an Other pick with no typed text is not an answer'
  );

  // A statement on its own never moves the goodbye; a closing block does, even in List flow.
  assert.equal(needsClosingGuard(WITH_STATEMENTS), false, 'the only closing block is retired');
  const withClosing = {
    ...WITH_STATEMENTS,
    questions: [...WITH_STATEMENTS.questions, { key: 'bye', type: 'statement', role: 'closing', label: 'Goodbye' }],
  };
  assert.equal(needsClosingGuard(withClosing), true);

  // An explicit closing on the path replaces the default one.
  const reached = visibleBlocks(withClosing, { q1: 'yes' });
  assert.equal(closingReached(reached), true);
  assert.equal(showDefaultClosing(withClosing, reached, { q1: 'yes' }, {}), false);

  // No text, no default closing (whitespace alone counts as none).
  for (const closing of ['', '  \n ', null, undefined]) {
    assert.equal(showDefaultClosing({ ...PLAIN, closing }, blank, {}, {}), false, JSON.stringify(closing));
  }
});

test('isScripted: a statement, a closing, a live route, or Script flow', () => {
  const withQ = (patch) => ({ ...PLAIN, questions: PLAIN.questions.map((q, i) => (i === 0 ? { ...q, ...patch(q) } : q)) });
  assert.equal(isScripted(PLAIN), false);
  assert.equal(isScripted(null), false);
  assert.equal(isScripted({ ...PLAIN, flow: 'script' }), true);
  assert.equal(isScripted({ ...PLAIN, flow: 'list' }), false);
  assert.equal(isScripted(WITH_STATEMENTS), true);
  assert.equal(isScripted({ ...PLAIN, questions: [...PLAIN.questions, { key: 's', type: 'statement', label: 'x', retired: true }] }), false);
  assert.equal(isScripted(withQ((q) => ({ options: q.options.map((o) => (o.id === 'red' ? { ...o, goTo: 'why' } : o)) }))), true);
  assert.equal(
    isScripted(withQ((q) => ({ options: q.options.map((o) => (o.id === 'green' ? { ...o, goTo: 'why' } : o)) }))),
    false,
    'a route on a retired option never fires'
  );
  assert.equal(isScripted(withQ(() => ({ otherGoTo: 'why' }))), true);
  assert.equal(isScripted(withQ(() => ({ otherOption: false, otherGoTo: 'why' }))), false, 'no Other pick, no Other route');
  assert.equal(isScripted({ ...PLAIN, questions: PLAIN.questions.map((q) => (q.key === 'why' ? { ...q, goTo: '__end__' } : q)) }), true);
  assert.equal(isScripted(withQ(() => ({ goTo: null, otherGoTo: '' }))), false);
});

// ---- The Burton survey, as authored (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md Part 1 and §F) -----------
// visibleIf is the compiled §F listing exactly: every atom a positive any_of, in source order.
const anyOf = (...atoms) => ({
  logic: 'any',
  rules: atoms.map(([questionKey, optionIds]) => ({ questionKey, op: 'any_of', optionIds })),
});
const TO_CLOSE_2 = ['election_day', 'voting_early', 'by_mail', 'unsure', 'declined_to_answer'];
const BURTON = {
  flow: 'script',
  presentation: 'steps',
  intro: "Hi, ma'am/sir! My name is {{canvasser}} and I'm a volunteer with Paul Burton's campaign.",
  closing: 'Thank you for your time today. Not a problem. Have a good day!',
  questions: [
    {
      key: 'q1',
      type: 'single_choice',
      label: 'Can he count on your support?',
      required: true,
      visibleIf: null,
      options: [
        { id: 'yes', text: 'Yes', goTo: 'q4' },
        { id: 'no', text: 'No', goTo: 'q2' },
        { id: 'undecided', text: 'Undecided', goTo: 's1_pitch' },
        { id: 'already_voted', text: 'Already voted', goTo: 'q3', script: 'Oh great! Well thank you for participating.' },
      ],
    },
    {
      key: 'q2',
      type: 'text',
      label: 'Thank you for sharing. Is there a particular reason?',
      required: false,
      goTo: null,
      visibleIf: anyOf(['q1', ['no']]),
    },
    {
      key: 's_q2_opponent',
      type: 'statement',
      role: 'statement',
      label: 'Are you aware of how much legal and financial trouble his opponent is in?',
      note: 'Could share this with them if the situation feels appropriate.',
      links: [{ label: 'The article', url: 'https://example.org/opponent' }],
      goTo: '__end__',
      visibleIf: anyOf(['q1', ['no']]),
    },
    {
      key: 'q3',
      type: 'single_choice',
      label: "If you don't mind sharing, did you vote for Paul Burton?",
      required: true,
      options: [
        { id: 'yes', text: 'Yes', goTo: 'close_3' },
        { id: 'no', text: 'No', goTo: '__end__' },
        { id: 'declined_to_say', text: 'Declined to say', goTo: '__end__' },
      ],
      visibleIf: anyOf(['q1', ['already_voted']]),
    },
    {
      key: 's1_pitch',
      type: 'statement',
      role: 'statement',
      title: 'Statement 1',
      label: "That's completely understandable.\n\nCommon sense, right?",
      goTo: null,
      visibleIf: anyOf(['q1', ['undecided']]),
    },
    {
      key: 's1_question',
      type: 'single_choice',
      label: 'Having heard that, can Paul count on your support?',
      required: true,
      options: [
        { id: 'yes', text: 'Yes', goTo: 'q4' },
        { id: 'still_undecided', text: 'Still undecided', goTo: 'close_4' },
        { id: 'no', text: 'No', goTo: '__end__' },
      ],
      visibleIf: anyOf(['q1', ['undecided']]),
    },
    {
      key: 'q4',
      type: 'single_choice',
      label: 'The election is Tuesday, November 3rd. Do you plan to vote on election day, vote early, or vote by mail?',
      required: true,
      options: [
        { id: 'election_day', text: 'Election Day', goTo: 'close_2' },
        { id: 'voting_early', text: 'Voting early', goTo: 'close_2' },
        { id: 'by_mail', text: 'Vote by mail', goTo: 'close_2' },
        { id: 'unsure', text: 'Unsure', goTo: 'close_2' },
        { id: 'declined_to_answer', text: 'Declined to answer', goTo: 'close_2' },
        { id: 'not_voting', text: 'Not voting', goTo: '__end__' },
      ],
      visibleIf: anyOf(['q1', ['yes']], ['s1_question', ['yes']]),
    },
    {
      key: 'close_2',
      type: 'statement',
      role: 'closing',
      title: 'Close 2',
      label: 'Every vote matters. Make a plan to vote.',
      note: 'Dates are also on the push card.',
      goTo: 'close_4',
      visibleIf: anyOf(['q4', TO_CLOSE_2]),
    },
    {
      key: 'close_3',
      type: 'statement',
      role: 'closing',
      title: 'Close 3',
      label: 'Great! Do you know anyone else that would want to vote for Paul?',
      goTo: 'close_4',
      visibleIf: anyOf(['q3', ['yes']]),
    },
    {
      key: 'close_4',
      type: 'statement',
      role: 'closing',
      title: 'Close 4',
      label: 'For more information, visit the website. Have a great day!',
      note: 'Both links are also on the push card.',
      links: [
        { label: 'Website', url: 'https://example.org' },
        { label: 'Find your polling place', url: 'https://example.org/vote' },
      ],
      goTo: '__end__',
      visibleIf: anyOf(['q3', ['yes']], ['s1_question', ['still_undecided']], ['q4', TO_CLOSE_2]),
    },
  ],
};
const NO_INTRO = { ...BURTON, intro: '' };

// Walk the stepper the way a canvasser does: on a question, tap the answer the path names (a tap
// never moves the cursor), then Next; stop on the screen that carries Save.
const walk = (survey, picks) => {
  let answers = {};
  let id = clampScreenId(survey, answers, null);
  const seen = [id];
  for (let step = 0; step < 30; step += 1) {
    if (Object.hasOwn(picks, id)) {
      answers = { ...answers, [id]: picks[id] };
      assert.equal(clampScreenId(survey, answers, id), id, `the tap on ${id} moved the cursor`);
    }
    if (id === saveScreenId(survey, answers)) return { seen, answers };
    assert.equal(canAdvance(survey, answers, {}, id), true, `Next blocked on ${id}`);
    id = nextScreenId(survey, answers, id);
    seen.push(id);
  }
  throw new Error('the walk never reached the save screen');
};

const BURTON_PATHS = [
  ...TO_CLOSE_2.map((plan) => ({
    name: `Yes, ${plan}: Close 2 then Close 4, never Close 3`,
    picks: { q1: 'yes', q4: plan },
    seen: [INTRO, 'q1', 'q4', 'close_2', 'close_4'],
  })),
  { name: 'Yes, not voting', picks: { q1: 'yes', q4: 'not_voting' }, seen: [INTRO, 'q1', 'q4', END] },
  { name: 'No, reason typed', picks: { q1: 'no', q2: 'Taxes' }, seen: [INTRO, 'q1', 'q2', 's_q2_opponent', END] },
  { name: 'No, reason left blank', picks: { q1: 'no' }, seen: [INTRO, 'q1', 'q2', 's_q2_opponent', END] },
  { name: 'Already voted, for Paul', picks: { q1: 'already_voted', q3: 'yes' }, seen: [INTRO, 'q1', 'q3', 'close_3', 'close_4'] },
  { name: 'Already voted, not for Paul', picks: { q1: 'already_voted', q3: 'no' }, seen: [INTRO, 'q1', 'q3', END] },
  { name: 'Already voted, declined to say', picks: { q1: 'already_voted', q3: 'declined_to_say' }, seen: [INTRO, 'q1', 'q3', END] },
  {
    name: 'Undecided, won over, voting early',
    picks: { q1: 'undecided', s1_question: 'yes', q4: 'voting_early' },
    seen: [INTRO, 'q1', 's1_pitch', 's1_question', 'q4', 'close_2', 'close_4'],
  },
  {
    name: 'Undecided, won over, not voting',
    picks: { q1: 'undecided', s1_question: 'yes', q4: 'not_voting' },
    seen: [INTRO, 'q1', 's1_pitch', 's1_question', 'q4', END],
  },
  {
    name: 'Undecided, still undecided',
    picks: { q1: 'undecided', s1_question: 'still_undecided' },
    seen: [INTRO, 'q1', 's1_pitch', 's1_question', 'close_4'],
  },
  { name: 'Undecided, then no', picks: { q1: 'undecided', s1_question: 'no' }, seen: [INTRO, 'q1', 's1_pitch', 's1_question', END] },
];

test('Burton: every path walks to the closing it reached, and the end screen carries the default closing', () => {
  for (const path of BURTON_PATHS) {
    const { seen, answers } = walk(BURTON, path.picks);
    assert.deepEqual(seen, path.seen, path.name);
    const blocks = visibleBlocks(BURTON, answers);
    const last = seen[seen.length - 1];
    const endsOnEnd = last === END;
    assert.equal(screenKind(screens(BURTON, answers).at(-1)), endsOnEnd ? 'end' : 'closing', path.name);
    assert.equal(closingReached(blocks), !endsOnEnd, path.name);
    assert.equal(showDefaultClosing(BURTON, blocks, answers, {}), endsOnEnd, path.name);
    assert.equal(requiredPending(blocks, answers, {}), null, path.name);
    assert.equal(nextScreenId(BURTON, answers, last), null, `${path.name}: Save, not Next`);
    // Only the numbered questions post a row; statements and closings never do.
    assert.deepEqual(
      buildSubmitRows(blocks, answers, {}).map((r) => r.questionKey),
      keys(blocks).filter((k) => ['q1', 'q2', 'q3', 's1_question', 'q4'].includes(k)),
      path.name
    );
  }
});

test('Burton: numbering and progress skip the statements', () => {
  const answers = { q1: 'undecided', s1_question: 'yes' };
  const blocks = visibleBlocks(BURTON, answers);
  assert.deepEqual(keys(blocks), ['q1', 's1_pitch', 's1_question', 'q4']);
  assert.deepEqual([...questionNumbers(blocks)], [['q1', 1], ['s1_question', 2], ['q4', 3]]);
  assert.deepEqual(progress(blocks, answers, {}), { answered: 2, total: 3, percent: 67 });
  assert.equal(requiredPending(blocks, answers, {}).key, 'q4');
});

test('Burton: Q1 "No" then Next lands on Question 2, never the end, when given the new answers', () => {
  // The list from before the tap: nothing past Q1 is reachable yet. Advancing from that stale
  // list is the bug a handler would ship by reading the render's memoized screens.
  assert.equal(nextScreenId(BURTON, {}, 'q1'), END);
  assert.equal(nextScreenId(BURTON, { q1: 'no' }, 'q1'), 'q2');
});

test('Burton: Next is unavailable on a blank required question, and only there', () => {
  assert.equal(canAdvance(BURTON, {}, {}, 'q1'), false);
  assert.equal(canAdvance(BURTON, { q1: 'already_voted' }, {}, 'q1'), true);
  assert.equal(canAdvance(BURTON, { q1: 'already_voted' }, {}, 'q3'), false);
  assert.equal(canAdvance(BURTON, {}, {}, INTRO), true);
  assert.equal(canAdvance(BURTON, { q1: 'no' }, {}, 'q2'), true, 'Question 2 is optional');
  assert.equal(canAdvance(BURTON, { q1: 'no' }, {}, 's_q2_opponent'), true, 'a statement always has Next');
  assert.equal(canAdvance(BURTON, { q1: 'undecided' }, {}, 's1_pitch'), true);
  assert.equal(canAdvance(BURTON, { q1: 'undecided' }, {}, 's1_question'), false);
});

test('Burton: Skip on optional Question 2 clears it and advances; required questions have no Skip', () => {
  const answers = { q1: 'no', q2: 'Taxes' };
  const otherTexts = { q2: 'stray' };
  assert.equal(canSkip(BURTON, answers, 'q2'), true);
  assert.equal(canSkip(BURTON, answers, 'q1'), false, 'required');
  assert.equal(canSkip(BURTON, answers, 's_q2_opponent'), false, 'a statement has Next');
  assert.equal(canSkip(BURTON, answers, INTRO), false);
  assert.equal(canSkip(BURTON, answers, END), false);

  const skipped = skipAnswer(answers, otherTexts, 'q2');
  assert.deepEqual(skipped, { answers: { q1: 'no' }, otherTexts: {} });
  assert.deepEqual(answers, { q1: 'no', q2: 'Taxes' }, 'the inputs are not mutated');
  assert.deepEqual(otherTexts, { q2: 'stray' });
  assert.equal(nextScreenId(BURTON, skipped.answers, 'q2'), 's_q2_opponent');
  // The skipped question still posts its (empty) row, exactly as an untouched one always has.
  const blocks = visibleBlocks(BURTON, skipped.answers);
  assert.deepEqual(buildSubmitRows(blocks, skipped.answers, skipped.otherTexts)[1], {
    questionKey: 'q2',
    questionLabel: 'Thank you for sharing. Is there a particular reason?',
    answer: null,
    optionIds: [],
    otherText: null,
  });
});

test('Burton: a terminal closing is the last screen, with no end screen after it', () => {
  const answers = { q1: 'yes', q4: 'election_day' };
  const list = screens(BURTON, answers);
  assert.deepEqual(ids(list), [INTRO, 'q1', 'q4', 'close_2', 'close_4']);
  assert.equal(saveScreenId(BURTON, answers), 'close_4');
  assert.deepEqual(list.map(screenKind), ['intro', 'question', 'question', 'closing', 'closing']);
  assert.equal(nextScreenId(BURTON, answers, 'close_2'), 'close_4', 'Close 2 is not last, so it has Next');
  assert.equal(nextScreenId(BURTON, answers, 'close_4'), null);
  assert.equal(list[3].block.key, 'close_2', 'block screens carry their block');
});

test('Burton: the No path ends on the end screen, with the default closing', () => {
  const answers = { q1: 'no' };
  assert.deepEqual(ids(screens(BURTON, answers)), [INTRO, 'q1', 'q2', 's_q2_opponent', END]);
  assert.equal(saveScreenId(BURTON, answers), END);
  assert.equal(screenKind({ id: END }), 'end');
  assert.equal(screenKind(screens(BURTON, answers)[3]), 'statement');
  assert.equal(showDefaultClosing(BURTON, visibleBlocks(BURTON, answers), answers, {}), true);
});

test('Burton: the default closing waits while a required question on the path is blank', () => {
  const answers = { q1: 'already_voted' };
  const blocks = visibleBlocks(BURTON, answers);
  assert.deepEqual(keys(blocks), ['q1', 'q3']);
  assert.equal(showDefaultClosing(BURTON, blocks, answers, {}), false);
  const answered = { ...answers, q3: 'no' };
  assert.equal(showDefaultClosing(BURTON, visibleBlocks(BURTON, answered), answered, {}), true);
});

test('Burton: a changed earlier answer drops the stale path, and the cursor clamps back', () => {
  // Yes, Election Day, then Q1 changed to No: Q4's answer stays in state but is withheld, so
  // neither closing it led to can show, and it is never posted.
  const changed = { q1: 'no', q4: 'election_day' };
  assert.deepEqual(ids(screens(BURTON, changed)), [INTRO, 'q1', 'q2', 's_q2_opponent', END]);
  assert.equal(
    buildSubmitRows(visibleBlocks(BURTON, changed), changed, {}).some((r) => r.questionKey === 'q4'),
    false
  );
  assert.equal(clampScreenId(BURTON, changed, 'q4'), 's_q2_opponent', 'the last screen before Q4');
  assert.equal(clampScreenId(BURTON, changed, 'close_4'), 's_q2_opponent');
  assert.equal(nextScreenId(BURTON, changed, 'q4'), END, 'a vanished cursor steps from where it clamped');
  assert.equal(prevScreenId(BURTON, changed, 'q4'), 'q2');

  // Already voted, for Paul, then Q1 changed to Undecided: Close 3 and Close 4 vanish with Q3.
  const flipped = { q1: 'undecided', q3: 'yes' };
  assert.deepEqual(ids(screens(BURTON, flipped)), [INTRO, 'q1', 's1_pitch', 's1_question', END]);
  assert.equal(clampScreenId(BURTON, flipped, 'close_4'), 's1_question');
  assert.equal(canAdvance(BURTON, flipped, {}, 'close_4'), false, 'judged on the clamped screen, a blank required question');
  assert.equal(showDefaultClosing(BURTON, visibleBlocks(BURTON, flipped), flipped, {}), false);

  // Undecided, won over, by mail, then Q1 changed to Yes: Q4 is still reached, through Q1.
  const rerouted = { q1: 'yes', s1_question: 'yes', q4: 'by_mail' };
  assert.deepEqual(ids(screens(BURTON, rerouted)), [INTRO, 'q1', 'q4', 'close_2', 'close_4']);

  // Answering the question on screen never moves the cursor off it.
  for (const opt of ['yes', 'no', 'undecided', 'already_voted']) {
    assert.equal(clampScreenId(BURTON, { q1: opt }, 'q1'), 'q1', opt);
  }
});

test('Burton: a template refresh under the cursor clamps to the block before it', () => {
  const answers = { q1: 'yes', q4: 'election_day' };
  const retiredQ4 = { ...BURTON, questions: BURTON.questions.map((q) => (q.key === 'q4' ? { ...q, retired: true } : q)) };
  assert.deepEqual(ids(screens(retiredQ4, answers)), [INTRO, 'q1', END]);
  assert.equal(clampScreenId(retiredQ4, answers, 'q4'), 'q1', 'a retired block keeps its place');
  assert.equal(clampScreenId(retiredQ4, answers, 'close_2'), 'q1');
  assert.equal(clampScreenId(BURTON, answers, 'deleted_block'), INTRO, 'an unknown id goes to the first screen');
  assert.equal(clampScreenId(BURTON, answers, null), INTRO, 'null starts the walk');
  assert.equal(clampScreenId(NO_INTRO, answers, null), 'q1');
  assert.equal(clampScreenId(BURTON, answers, END), 'close_4', 'the end gave way to a closing: the last screen');
  assert.equal(clampScreenId(NO_INTRO, answers, INTRO), 'q1', 'the intro emptied: the first screen');
  assert.equal(clampScreenId(BURTON, answers, 'close_2'), 'close_2', 'a screen that still shows stays put');
});

test('Burton: Back on the first screen is null, which means leave the survey', () => {
  assert.equal(prevScreenId(BURTON, {}, INTRO), null);
  assert.equal(prevScreenId(BURTON, {}, 'q1'), INTRO);
  assert.equal(prevScreenId(NO_INTRO, {}, 'q1'), null);
  const answers = { q1: 'undecided', s1_question: 'yes', q4: 'voting_early' };
  assert.equal(prevScreenId(BURTON, answers, 'q4'), 's1_question');
  assert.equal(prevScreenId(BURTON, answers, 'close_4'), 'close_2');
});

test('Burton: no intro screen when the intro is blank', () => {
  for (const intro of ['', '   \n  ', null, undefined]) {
    const list = screens({ ...BURTON, intro }, {});
    assert.deepEqual(ids(list), ['q1', END], JSON.stringify(intro));
  }
  assert.deepEqual(ids(screens(BURTON, {})), [INTRO, 'q1', END]);
  assert.equal(screenKind(screens(BURTON, {})[0]), 'intro');
});

// ---- Stepper edges beyond Burton ---------------------------------------------------------------
test('a closing a multiple-choice union leaves above a later block shows Next, and the end screen follows', () => {
  const survey = {
    flow: 'script',
    intro: '',
    closing: 'Bye.',
    questions: [
      {
        key: 'topics',
        type: 'multiple_choice',
        label: 'Which topics?',
        required: true,
        options: [
          { id: 'a', text: 'A', goTo: 'close_a' },
          { id: 'b', text: 'B', goTo: 'more_b' },
        ],
      },
      { key: 'close_a', type: 'statement', role: 'closing', label: 'Goodbye for A.', goTo: '__end__', visibleIf: anyOf(['topics', ['a']]) },
      { key: 'more_b', type: 'text', label: 'More on B?', visibleIf: anyOf(['topics', ['b']]) },
    ],
  };
  const answers = { topics: ['a', 'b'] };
  assert.deepEqual(ids(screens(survey, answers)), ['topics', 'close_a', 'more_b', END]);
  assert.equal(saveScreenId(survey, answers), END);
  assert.equal(screenKind(screens(survey, answers)[1]), 'closing');
  assert.equal(canAdvance(survey, answers, {}, 'close_a'), true);
  assert.equal(nextScreenId(survey, answers, 'close_a'), 'more_b');
  // The end screen shows no default closing: an explicit one was reached ("Done" instead).
  assert.equal(showDefaultClosing(survey, visibleBlocks(survey, answers), answers, {}), false);
  // Picking only A makes the closing last: it becomes the save screen.
  assert.deepEqual(ids(screens(survey, { topics: ['a'] })), ['topics', 'close_a']);
});

test('Skip advances from the answers it is about to store, never the stale list', () => {
  // An optional BRANCHING question: skipping it hides where its answer pointed.
  const survey = {
    flow: 'script',
    intro: '',
    closing: '',
    questions: [
      {
        key: 'pet',
        type: 'single_choice',
        label: 'Any pets?',
        options: [
          { id: 'dog', text: 'Dog', goTo: 'dog_name' },
          { id: 'none', text: 'None', goTo: 'wrap' },
        ],
      },
      { key: 'dog_name', type: 'text', label: "Dog's name?", visibleIf: anyOf(['pet', ['dog']]) },
      { key: 'wrap', type: 'statement', role: 'closing', label: 'Thanks!', visibleIf: anyOf(['pet', ['dog', 'none']]) },
    ],
  };
  const before = { pet: 'dog' };
  assert.equal(nextScreenId(survey, before, 'pet'), 'dog_name', 'the stale list would advance into a hidden block');
  const skipped = skipAnswer(before, {}, 'pet');
  assert.equal(nextScreenId(survey, skipped.answers, 'pet'), END);
  assert.deepEqual(ids(screens(survey, skipped.answers)), ['pet', END]);
  // An empty closing field: the end screen shows no default closing.
  assert.equal(showDefaultClosing(survey, visibleBlocks(survey, skipped.answers), skipped.answers, {}), false);
});

test('skipAnswer drops the Other text with the answer and tolerates missing state', () => {
  assert.deepEqual(skipAnswer({ color: '__other__', why: 'x' }, { color: 'Teal' }, 'color'), {
    answers: { why: 'x' },
    otherTexts: {},
  });
  assert.deepEqual(skipAnswer(undefined, undefined, 'color'), { answers: {}, otherTexts: {} });
});

test('degenerate templates still give one screen to stand on', () => {
  assert.deepEqual(ids(screens(null, {})), [END]);
  assert.deepEqual(ids(screens({ intro: 'Hello', questions: [] }, {})), [INTRO, END]);
  assert.equal(prevScreenId(null, {}, END), null);
  assert.equal(nextScreenId(null, {}, END), null);
  assert.equal(canAdvance(null, {}, {}, END), true);
  assert.deepEqual(visibleBlocks(undefined, {}), []);
  assert.deepEqual(progress([], {}, {}), { answered: 0, total: 0, percent: 100 });
  assert.equal(screenKind(null), null);
});
