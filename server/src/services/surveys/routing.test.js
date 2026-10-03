import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  END_KEY,
  OTHER_ID,
  isStatement,
  isAnswerable,
  isChoice,
  isClosingBlock,
  blockName,
  isBranching,
  hasActiveRoutes,
  isScripted,
  resolveDefaultTarget,
  compileRouting,
  clearRoutes,
  switchToList,
} from './routing.js';
import { makeCell, visibleQuestionKeys } from './visibility.js';
import { OTHER_OPTION_ID } from './otherOption.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, '__fixtures__/routing.fixtures.json'), 'utf8'));
const fixture = (name) => {
  const f = fixtures.find((x) => x.name === name);
  assert.ok(f, `fixture "${name}" is missing`);
  return f.questions;
};
const burton = fixture('Burton, final graph (Part 1 table)');

const live = (questions) => questions.filter((q) => q && !q.retired);
const isChoiceType = (q) => q.type === 'single_choice' || q.type === 'multiple_choice';

// Fixture answers as evaluator cells: an array is the picked option ids, a string is typed text.
const cellsFor = (answers) =>
  Object.fromEntries(
    Object.entries(answers || {}).map(([key, v]) => [
      key,
      Array.isArray(v) ? makeCell('single_choice', v, null) : makeCell('text', [], v),
    ])
  );

// The live blocks the REAL evaluator shows for these answers, in list order.
const shownKeys = (questions, answers) => {
  const shown = visibleQuestionKeys(questions, cellsFor(answers));
  return live(questions).filter((q) => shown.has(q.key)).map((q) => q.key);
};

for (const f of fixtures) {
  test(`compileRouting fixture — ${f.name}`, () => {
    const { questions, errors } = compileRouting(f.questions);
    assert.deepEqual(errors, f.expectedErrors, 'errors');
    const got = Object.fromEntries(live(questions).map((q) => [q.key, q.visibleIf]));
    assert.deepEqual(got, f.expectedVisibleIf, 'visibleIf of every live block');
    // Byte for byte too: the builder's live copy and the stored document are compared as JSON.
    for (const key of Object.keys(f.expectedVisibleIf)) {
      assert.equal(JSON.stringify(got[key]), JSON.stringify(f.expectedVisibleIf[key]), `${key} serializes identically`);
    }
    f.questions.forEach((q, i) => {
      if (q.retired) assert.equal(questions[i], q, `retired ${q.key} passes through untouched, in place`);
    });
    for (const p of f.paths || []) {
      assert.deepEqual(shownKeys(questions, p.answers), p.expectedVisibleKeys, p.name);
    }
  });
}

// What the server's integrity check and the evaluator demand of a compiled rule, plus rule 5's
// stated order: an `any` of `any_of` atoms, each on a strictly EARLIER live choice question (never
// a text question, never a statement), naming only that question's live answers (Other only while
// it is on), atoms in list order, ids in answer order with Other last, never an empty rule list.
const assertWellFormed = (questions, label) => {
  const blocks = live(questions);
  blocks.forEach((q, i) => {
    if (i === 0) assert.equal(q.visibleIf, null, `${label}: the first live block is unconditional`);
    if (q.visibleIf == null) return;
    assert.equal(q.visibleIf.logic, 'any', `${label}: ${q.key} logic`);
    assert.ok(q.visibleIf.rules.length > 0, `${label}: ${q.key} has an empty rule list`);
    let previous = -1;
    for (const rule of q.visibleIf.rules) {
      const at = blocks.findIndex((b) => b.key === rule.questionKey);
      assert.ok(at >= 0 && at < i, `${label}: ${q.key} names ${rule.questionKey}, not an earlier live block`);
      assert.ok(at > previous, `${label}: ${q.key} atoms out of list order, or repeated`);
      previous = at;
      const source = blocks[at];
      assert.ok(isChoiceType(source), `${label}: ${q.key} names ${source.key}, which is not a choice question`);
      assert.equal(rule.op, 'any_of', `${label}: ${q.key} op`);
      const order = [
        ...(source.options || []).filter((o) => !o.retired).map((o) => o.id),
        ...(source.otherOption ? [OTHER_ID] : []),
      ];
      const ranks = rule.optionIds.map((id) => order.indexOf(id));
      assert.ok(ranks.length > 0 && ranks.every((r) => r >= 0), `${label}: ${q.key} names an answer not live on ${source.key}`);
      assert.ok(ranks.every((r, k) => k === 0 || r > ranks[k - 1]), `${label}: ${q.key} ids out of answer order, or repeated`);
    }
  });
};

test('compileRouting — every fixture compiles to well-formed rules', () => {
  for (const f of fixtures) assertWellFormed(compileRouting(f.questions).questions, f.name);
});

test('compileRouting — deterministic, idempotent, pure, and changes nothing but visibleIf', () => {
  for (const f of fixtures) {
    const snapshot = structuredClone(f.questions);
    const first = compileRouting(f.questions);
    assert.deepEqual(f.questions, snapshot, `${f.name}: the input was mutated`);
    assert.equal(JSON.stringify(compileRouting(f.questions)), JSON.stringify(first), `${f.name}: not deterministic`);
    const again = compileRouting(first.questions);
    assert.deepEqual(
      again.questions.map((q) => q.visibleIf),
      first.questions.map((q) => q.visibleIf),
      `${f.name}: compiling the output changed a condition`
    );
    assert.deepEqual(again.errors, first.errors, `${f.name}: compiling the output changed the errors`);
    first.questions.forEach((q, i) => {
      const { visibleIf: _compiled, ...rest } = q;
      const { visibleIf: _incoming, ...original } = f.questions[i];
      assert.deepEqual(rest, original, `${f.name}: ${q.key} changed beyond visibleIf`);
    });
  }
});

test('compileRouting — empty and degenerate input', () => {
  assert.deepEqual(compileRouting([]), { questions: [], errors: [] });
  assert.deepEqual(compileRouting(null), { questions: [], errors: [] });
  const r = compileRouting([
    null,
    { key: 't', type: 'text', label: 'Name?', goTo: '' },
    { key: 's', type: 'statement', role: 'closing', label: 'Bye', goTo: null },
  ]);
  assert.deepEqual(r.errors, [], 'an emptied select continues; it never reads as a removed block');
  assert.equal(r.questions[0], null);
  assert.equal(r.questions[1].visibleIf, null);
  assert.equal(r.questions[2].visibleIf, null);
});

test('compileRouting — messages name blocks and answers the way the builder shows them', () => {
  const { errors } = compileRouting([
    {
      key: 'src',
      type: 'single_choice',
      label: 'How did you hear about Paul?',
      otherOption: true,
      otherGoTo: 'gone',
      options: [
        { id: 'opt', text: '', goTo: 'gone' },
        { id: 'mail', text: 'A mailer that came to the house last week, with a picture of Paul on the front', goTo: 'gone' },
        { id: 'tv', text: 'TV', goTo: END_KEY },
      ],
    },
  ]);
  assert.deepEqual(errors, [
    { key: 'src', optionId: 'opt', message: 'An answer on "How did you hear about Paul?" goes to a block that has been removed — pick another target.' },
    {
      key: 'src',
      optionId: 'mail',
      message: 'The answer "A mailer that came to the house last week, with a picture of…" on "How did you hear about Paul?" goes to a block that has been removed — pick another target.',
    },
    {
      key: 'src',
      optionId: '__other__',
      message: 'The "Other (specify)" answer on "How did you hear about Paul?" goes to a block that has been removed — pick another target.',
    },
  ]);
});

// An independent reading of the arrows, written from §F's rules rather than from the compiler:
// start at the first live block and mark every block the conversation reaches. Compiling and then
// evaluating must agree with it on every answer set.
const walkArrows = (questions, answers) => {
  const blocks = live(questions);
  const position = new Map(blocks.map((q, i) => [q.key, i]));
  const land = (i, route) => (route == null ? i + 1 : route === END_KEY ? -1 : position.get(route));
  const reached = new Set([0]);
  blocks.forEach((q, i) => {
    if (!reached.has(i)) return;
    if (!isChoiceType(q)) {
      reached.add(land(i, q.goTo));
      return;
    }
    const options = (q.options || []).filter((o) => !o.retired);
    const arrows = options.some((o) => o.goTo != null) || (q.otherOption && q.otherGoTo != null);
    if (!arrows) {
      reached.add(i + 1);
      return;
    }
    const picked = answers[q.key] || [];
    for (const o of options) if (picked.includes(o.id)) reached.add(land(i, o.goTo));
    if (q.otherOption && picked.includes(OTHER_ID)) reached.add(land(i, q.otherGoTo));
  });
  return blocks.filter((_, i) => reached.has(i)).map((q) => q.key);
};

// The live blocks no live route lands on, in list order: exactly what rule 7 must report.
const strandedKeys = (questions) => {
  const blocks = live(questions);
  const position = new Map(blocks.map((q, i) => [q.key, i]));
  const land = (i, route) => (route == null ? i + 1 : route === END_KEY ? -1 : position.get(route));
  const landed = new Set();
  blocks.forEach((q, i) => {
    if (!isChoiceType(q)) {
      landed.add(land(i, q.goTo));
      return;
    }
    const options = (q.options || []).filter((o) => !o.retired);
    const arrows = options.some((o) => o.goTo != null) || (q.otherOption && q.otherGoTo != null);
    if (!arrows) {
      landed.add(i + 1);
      return;
    }
    for (const o of options) landed.add(land(i, o.goTo));
    if (q.otherOption) landed.add(land(i, q.otherGoTo));
  });
  return blocks.filter((_, i) => i > 0 && !landed.has(i)).map((q) => q.key);
};

// mulberry32: a small seeded generator, so a failure reproduces exactly.
const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// A random survey whose live routes are all valid (forward, End, or continue), with the things
// that must be IGNORED mixed in: retired blocks and retired answers carrying backward or dangling
// routes, a dangling otherGoTo while Other is off, and stale incoming conditions on live blocks.
const randomSurvey = (rand) => {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const n = 2 + Math.floor(rand() * 7);
  const keys = Array.from({ length: n }, (_, i) => `b${i}`);
  const route = (i) => {
    const r = rand();
    if (r < 0.45) return null;
    if (r < 0.6 || i === n - 1) return END_KEY;
    return pick(keys.slice(i + 1));
  };
  const junk = () => pick([null, END_KEY, 'gone', ...keys]);
  const survey = [];
  keys.forEach((key, i) => {
    if (rand() < 0.15) {
      survey.push({
        key: `retired_${i}`,
        type: pick(['text', 'statement', 'single_choice']),
        label: 'Retired',
        retired: true,
        goTo: junk(),
        options: [{ id: 'z', text: 'Z', goTo: junk() }],
        visibleIf: { logic: 'all', rules: [{ questionKey: 'b0', op: 'answered', optionIds: [] }] },
      });
    }
    const label = `Block ${i}`;
    const visibleIf = rand() < 0.3 ? { logic: 'all', rules: [{ questionKey: 'nowhere', op: 'is', optionIds: ['x'] }] } : null;
    const kind = rand();
    if (kind < 0.25) {
      survey.push({ key, type: 'statement', role: pick(['statement', 'closing']), label, options: [], visibleIf, goTo: route(i) });
      return;
    }
    if (kind < 0.45) {
      survey.push({ key, type: 'text', label, options: [], visibleIf, goTo: route(i) });
      return;
    }
    const branching = rand() < 0.6;
    const options = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, k) => {
      const retired = rand() < 0.15;
      return { id: `o${k}`, text: `Answer ${k}`, retired, goTo: retired ? junk() : branching ? route(i) : null };
    });
    const otherOption = rand() < 0.3;
    survey.push({
      key,
      type: rand() < 0.6 ? 'single_choice' : 'multiple_choice',
      label,
      options,
      otherOption,
      otherGoTo: otherOption ? (branching ? route(i) : null) : junk(),
      visibleIf,
    });
  });
  return survey;
};

// Stored answers, including what the arrows must ignore: retired ids and a stray Other pick.
const randomAnswers = (rand, survey) => {
  const answers = {};
  for (const q of live(survey)) {
    if (q.type === 'statement' || rand() < 0.25) continue;
    if (q.type === 'text') {
      answers[q.key] = 'Typed';
      continue;
    }
    const ids = [...q.options.map((o) => o.id), OTHER_ID];
    answers[q.key] =
      q.type === 'single_choice' ? [ids[Math.floor(rand() * ids.length)]] : ids.filter(() => rand() < 0.4);
  }
  return answers;
};

// Every route on every block and answer, retired ones included, is null.
const assertNoRoutes = (questions, label) => {
  for (const q of questions) {
    assert.equal(q.goTo, null, `${label}: ${q.key}.goTo`);
    assert.equal(q.otherGoTo, null, `${label}: ${q.key}.otherGoTo`);
    for (const o of q.options || []) assert.equal(o.goTo, null, `${label}: ${q.key}.${o.id}.goTo`);
  }
};

test('compileRouting — agrees with walking the arrows on 500 seeded random surveys', () => {
  const rand = seeded(20261002);
  let compared = 0;
  for (let s = 0; s < 500; s++) {
    const survey = randomSurvey(rand);
    const label = `random survey ${s}`;
    const { questions, errors } = compileRouting(survey);
    assertWellFormed(questions, label);
    // Every live target here is valid, so rule 7 is the only error there can be.
    assert.deepEqual(errors.map((e) => e.key), strandedKeys(survey), `${label}: stranded blocks`);
    assert.ok(errors.every((e) => e.message.startsWith('Nothing leads to ')), `${label}: ${JSON.stringify(errors)}`);
    const again = compileRouting(questions);
    assert.deepEqual(again, { questions, errors }, `${label}: not idempotent`);
    const back = switchToList(survey);
    assert.deepEqual(back.questions.map((q) => q.visibleIf), questions.map((q) => q.visibleIf), `${label}: Switch back changed a condition`);
    assertNoRoutes(back.questions, label);
    if (errors.length) continue;
    compared += 1;
    for (let a = 0; a < 30; a++) {
      const answers = randomAnswers(rand, survey);
      assert.deepEqual(shownKeys(questions, answers), walkArrows(survey, answers), `${label} with ${JSON.stringify(answers)}`);
    }
  }
  assert.ok(compared >= 150, `only ${compared} of 500 random surveys compiled cleanly: the sample is too thin`);
});

test('the sentinels: End is reserved, Other is the id otherOption.js uses', () => {
  assert.equal(END_KEY, '__end__');
  assert.equal(OTHER_ID, OTHER_OPTION_ID);
});

test('block predicates', () => {
  const statement = { type: 'statement', role: 'statement' };
  const closing = { type: 'statement', role: 'closing' };
  assert.equal(isStatement(statement), true);
  assert.equal(isStatement(closing), true);
  assert.equal(isStatement({ type: 'text' }), false);
  assert.equal(isStatement(null), false);
  assert.equal(isAnswerable(statement), false);
  for (const type of ['single_choice', 'multiple_choice', 'text']) assert.equal(isAnswerable({ type }), true, type);
  assert.equal(isAnswerable(null), false);
  assert.equal(isChoice({ type: 'single_choice' }), true);
  assert.equal(isChoice({ type: 'multiple_choice' }), true);
  assert.equal(isChoice({ type: 'text' }), false);
  assert.equal(isChoice(statement), false);
  assert.equal(isChoice(undefined), false);
  assert.equal(isClosingBlock(closing), true);
  assert.equal(isClosingBlock(statement), false);
  assert.equal(isClosingBlock({ type: 'single_choice', role: 'closing' }), false, 'a stray role on a question means nothing');
  assert.equal(isClosingBlock(null), false);
});

test('blockName — the title, else the first sixty characters on one line, never the whole body', () => {
  assert.equal(blockName({ type: 'statement', role: 'closing', title: '  Close 2 ', label: 'Every vote matters.' }), 'Close 2');
  assert.equal(blockName({ type: 'statement', title: '   ', label: 'Are you\n\n aware   of it?' }), 'Are you aware of it?');
  const sixty = 'x'.repeat(60);
  assert.equal(blockName({ type: 'text', label: sixty }), sixty, 'exactly sixty: not cut');
  assert.equal(blockName({ type: 'text', label: `${sixty}y` }), `${sixty}…`);
  assert.equal(blockName({ type: 'text', label: `${'x'.repeat(59)} and more` }), `${'x'.repeat(59)}…`, 'no space before the ellipsis');
  assert.equal(blockName({ type: 'text', label: `${'x'.repeat(59)}😀 and more` }), `${'x'.repeat(59)}😀…`, 'cut by characters: the emoji stays whole');
  const body = 'Paul has served this district for twenty years. '.repeat(100);
  assert.equal(blockName({ type: 'statement', label: body }), `${body.slice(0, 60).trimEnd()}…`);
  assert.equal(blockName({ type: 'statement', role: 'closing', label: '' }), 'Untitled closing');
  assert.equal(blockName({ type: 'statement', label: '  ' }), 'Untitled statement');
  assert.equal(blockName({ type: 'single_choice' }), 'Untitled question');
  assert.equal(blockName(null), 'Untitled question');
});

test('isBranching — live arrows only', () => {
  const choice = (options, extra = {}) => ({ key: 'q', type: 'single_choice', options, ...extra });
  assert.equal(isBranching(choice([{ id: 'a' }, { id: 'b' }])), false, 'plain');
  assert.equal(isBranching(choice([{ id: 'a', goTo: 'x' }, { id: 'b' }])), true, 'one arrow');
  assert.equal(isBranching(choice([{ id: 'a', goTo: END_KEY }])), true, 'End is an arrow');
  assert.equal(isBranching(choice([{ id: 'a' }, { id: 'b', retired: true, goTo: 'x' }])), false, 'a retired answer');
  assert.equal(isBranching(choice([{ id: 'a', goTo: '' }])), false, 'an emptied select');
  assert.equal(isBranching(choice([{ id: 'a' }], { otherOption: true, otherGoTo: 'x' })), true, 'Other');
  assert.equal(isBranching(choice([{ id: 'a' }], { otherOption: false, otherGoTo: 'x' })), false, 'Other while it is off');
  assert.equal(isBranching(choice([{ id: 'a' }], { goTo: 'x' })), false, 'a question-level goTo is an error, not an arrow');
  assert.equal(isBranching({ ...choice([{ id: 'a', goTo: 'x' }]), type: 'multiple_choice' }), true, 'multiple choice');
  assert.equal(isBranching({ key: 't', type: 'text', goTo: 'x' }), false, 'a text question routes but never branches');
});

test('hasActiveRoutes and isScripted', () => {
  const linear = fixture('a plain linear survey compiles to no conditions');
  assert.equal(hasActiveRoutes(burton), true);
  assert.equal(isScripted(burton), true);
  assert.equal(hasActiveRoutes(linear), false);
  assert.equal(isScripted(linear), false);
  assert.equal(hasActiveRoutes([{ key: 't', type: 'text', goTo: END_KEY }]), true, 'a text question routes');
  assert.equal(hasActiveRoutes([{ key: 's', type: 'statement', goTo: 'x' }]), true, 'a statement routes');
  assert.equal(hasActiveRoutes([{ key: 't', type: 'text', goTo: '' }]), false, 'an emptied select');
  assert.equal(
    hasActiveRoutes([
      { key: 'r', type: 'text', retired: true, goTo: 'x' },
      { key: 'q', type: 'single_choice', options: [{ id: 'a', retired: true, goTo: 'x' }] },
    ]),
    false,
    'retired routes'
  );
  assert.equal(hasActiveRoutes([{ key: 'q', type: 'single_choice', goTo: 'x', options: [{ id: 'a' }] }]), false, 'a question-level goTo on a choice question');
  assert.equal(isScripted([{ key: 'q', type: 'text' }, { key: 's', type: 'statement', role: 'statement' }]), true, 'a statement alone');
  assert.equal(isScripted([{ key: 'q', type: 'text' }, { key: 's', type: 'statement', retired: true }]), false, 'a retired statement');
  assert.equal(isScripted([{ key: 'q', type: 'single_choice', options: [{ id: 'a', goTo: END_KEY }] }]), true, 'an arrow alone');
  assert.equal(hasActiveRoutes(undefined), false);
  assert.equal(isScripted(null), false);
});

test('resolveDefaultTarget — the next live block, End after the last', () => {
  assert.equal(resolveDefaultTarget(burton, 'q2'), 's_q2_opponent');
  assert.equal(resolveDefaultTarget(burton, 's1_pitch'), 's1_question');
  assert.equal(resolveDefaultTarget(burton, 'close_4'), END_KEY);
  const withRetired = fixture('retired blocks pass through untouched');
  assert.equal(resolveDefaultTarget(withRetired, 'q1'), 'q2', 'skips the retired block');
  assert.equal(resolveDefaultTarget(withRetired, 'old'), null, 'a retired block routes nowhere');
  assert.equal(resolveDefaultTarget(withRetired, 'nope'), null);
  assert.equal(resolveDefaultTarget(undefined, 'q1'), null);
});

test('clearRoutes — every route on every block and answer, retired included, and nothing else', () => {
  const withoutRoutes = (q) => {
    const { goTo: _goTo, otherGoTo: _otherGoTo, ...rest } = q;
    if (Array.isArray(rest.options)) rest.options = rest.options.map(({ goTo: _g, ...o }) => o);
    return rest;
  };
  for (const f of fixtures) {
    const snapshot = structuredClone(f.questions);
    const cleared = clearRoutes(f.questions);
    assert.deepEqual(f.questions, snapshot, `${f.name}: the input was mutated`);
    assertNoRoutes(cleared, f.name);
    cleared.forEach((q, i) => assert.deepEqual(withoutRoutes(q), withoutRoutes(f.questions[i]), `${f.name}: ${q.key}`));
  }
  assert.deepEqual(clearRoutes(null), []);
  assert.deepEqual(clearRoutes([null]), [null]);
});

test('switchToList — Burton keeps the exact conditions with every route cleared', () => {
  const compiled = compileRouting(burton);
  const back = switchToList(burton);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.questions.map((q) => q.visibleIf), compiled.questions.map((q) => q.visibleIf));
  assertNoRoutes(back.questions, 'Burton');
  assert.equal(hasActiveRoutes(back.questions), false);
  assert.equal(isScripted(back.questions), true, 'its statements still make it a script');
  for (const name of ['retired blocks pass through untouched', 'retired answers neither fire nor count']) {
    const f = fixture(name);
    const r = switchToList(f);
    assert.deepEqual(r.errors, [], name);
    assertNoRoutes(r.questions, name);
    f.forEach((q, i) => {
      if (q.retired) assert.deepEqual(r.questions[i].visibleIf, q.visibleIf, `${name}: retired ${q.key} keeps its condition`);
    });
  }
});

test('two compiler copies are byte-identical (drift guard), and neither imports anything', () => {
  const MARK = '// ==== BEGIN MIRRORED BODY ====';
  const canonicalPath = join(here, 'routing.js');
  const mirrorPath = join(here, '../../../../client/src/lib/surveyRouting.js');
  const body = (p) => {
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf(MARK);
    assert.notEqual(i, -1, `marker missing in ${p}`);
    return s.slice(i + MARK.length);
  };
  assert.equal(body(mirrorPath), body(canonicalPath), 'client/src/lib/surveyRouting.js drifted from the canonical');
  for (const p of [canonicalPath, mirrorPath]) {
    assert.doesNotMatch(readFileSync(p, 'utf8'), /^\s*import\b/m, `${p} imports: a relative path resolves into two different trees`);
  }
});

test('the client mirror compiles every fixture identically', async () => {
  const mirror = await import('../../../../client/src/lib/surveyRouting.js');
  for (const f of fixtures) assert.deepEqual(mirror.compileRouting(f.questions), compileRouting(f.questions), f.name);
});
