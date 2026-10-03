import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVisibleIf, ruleClause, buildConditionIndex, optionText, quote } from './surveyConditionText.js';
import { buildSurveyPrintModel } from './packet/surveyPrintModel.js';
import { asciiSafe } from './pdfText.js';

// One wording for a survey condition on paper, in the builder and in the preview. The two
// failures pinned here: a screen that inherits paper's asciiSafe blanks every non-Latin label
// (asciiSafe DROPS what cp1252 cannot hold), and a lift that changes one byte the packet prints.

const SUPPORT = {
  key: 'support', label: 'Can he count on your support?', type: 'single_choice', otherOption: true,
  options: [
    { id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }, { id: 'und', text: 'Undecided' },
    { id: 'dk', text: 'Don’t know — “maybe”' },
  ],
};
const LANG = {
  key: 'lang', label: 'Idioma — язык', type: 'single_choice',
  options: [{ id: 'es', text: 'Español' }, { id: 'ru', text: 'Русский' }, { id: 'zh', text: '中文' }],
};
const WHY = { key: 'why', label: 'Why?', type: 'text', options: [] };

// The print model's own index: every printed question numbered in order.
const paperIndex = (qs) => ({
  byKey: new Map(qs.map((q) => [q.key, q])),
  numberByKey: new Map(qs.map((q, i) => [q.key, i + 1])),
});
const INDEX = paperIndex([SUPPORT, LANG, WHY]);

const rule = (questionKey, op, optionIds = []) => ({ questionKey, op, optionIds });
const gated = (logic, ...rules) => ({ key: 'gated', label: 'Gated', type: 'text', visibleIf: { logic, rules } });

const MIXED = gated('any', rule('support', 'any_of', ['dk', '__other__']), rule('lang', 'any_of', ['ru', 'zh']));

test('a screen keeps smart punctuation and non-Latin text exactly as typed', () => {
  assert.equal(formatVisibleIf(MIXED, INDEX), 'Only if Q1 = “Don’t know — “maybe”” or “Other” or Q2 = “Русский” or “中文”');
  // Named by label when unnumbered — the label is typed text too.
  const unnumbered = { byKey: INDEX.byKey, numberByKey: new Map() };
  assert.equal(formatVisibleIf(gated('all', rule('lang', 'is', ['ru'])), unnumbered), 'Only if “Idioma — язык” = “Русский”');
});

test('paper (asciiSafe) prints exactly what the packet printed before the lift', () => {
  // These strings are the output of the formatter as it lived in surveyPrintModel.js, captured
  // before it moved. Any change here is a change to printed packets.
  const paper = (q, index = INDEX) => formatVisibleIf(q, index, { transform: asciiSafe });
  assert.equal(paper(MIXED), 'Only if Q1 = "Don\'t know - "maybe"" or "Other" or Q2 = "" or ""');
  assert.equal(paper(gated('all', rule('lang', 'is_not', ['es']), rule('why', 'answered'))), 'Only if Q2 is not "Español" and Q3 answered');
  assert.equal(paper(gated('all', rule('gone', 'not_answered'))), 'Only if "gone" not answered');
  const unnumbered = { byKey: INDEX.byKey, numberByKey: new Map() };
  assert.equal(paper(gated('all', rule('lang', 'is', ['ru'])), unnumbered), 'Only if "Idioma - " = ""');
});

test('the print model hands paper asciiSafe, and the same gate on a screen does not drop a word', () => {
  const where = { ...gated('all', rule('lang', 'any_of', ['es', 'ru'])), key: 'where', label: 'Where?' };
  const model = buildSurveyPrintModel({ id: 's', questions: [SUPPORT, LANG, where] });
  assert.equal(model.questions[2].gate, 'Only if Q2 = "Español" or ""');
  assert.equal(formatVisibleIf(where, paperIndex([SUPPORT, LANG, where])), 'Only if Q2 = “Español” or “Русский”');
});

test('the prefix is the leading words, and an empty prefix leaves the bare clauses', () => {
  const q = gated('all', rule('support', 'is', ['yes']));
  assert.equal(formatVisibleIf(q, INDEX), 'Only if Q1 = “Yes”');
  assert.equal(formatVisibleIf(q, INDEX, { prefix: 'Reached when' }), 'Reached when Q1 = “Yes”');
  assert.equal(formatVisibleIf(q, INDEX, { prefix: 'Shown when' }), 'Shown when Q1 = “Yes”');
  assert.equal(formatVisibleIf(q, INDEX, { prefix: '' }), 'Q1 = “Yes”');
  assert.equal(formatVisibleIf(q, INDEX, { prefix: 'Shown when', transform: asciiSafe }), 'Shown when Q1 = "Yes"');
});

test('"any" joins clauses with or; anything else with and, as the evaluator reads it', () => {
  const two = (logic) => gated(logic, rule('support', 'is', ['yes']), rule('why', 'answered'));
  assert.equal(formatVisibleIf(two('any'), INDEX), 'Only if Q1 = “Yes” or Q3 answered');
  assert.equal(formatVisibleIf(two('all'), INDEX), 'Only if Q1 = “Yes” and Q3 answered');
  assert.equal(formatVisibleIf(two(undefined), INDEX), 'Only if Q1 = “Yes” and Q3 answered');
});

test('all five ops read as plain English', () => {
  const one = (op, optionIds) =>
    formatVisibleIf(gated('all', { questionKey: 'support', op, optionIds }), INDEX, { prefix: '' });
  assert.equal(one('is', ['yes']), 'Q1 = “Yes”');
  assert.equal(one('is', ['yes', 'no']), 'Q1 = “Yes”'); // the evaluator reads only the first id
  assert.equal(one('is_not', ['no']), 'Q1 is not “No”');
  assert.equal(one('any_of', ['yes', 'und', '__other__']), 'Q1 = “Yes” or “Undecided” or “Other”');
  assert.equal(one('answered', []), 'Q1 answered');
  assert.equal(one('not_answered', []), 'Q1 not answered');
  // A rule saved without its answers still reads, rather than throwing or printing nothing.
  assert.equal(one('is', []), 'Q1 = …');
  assert.equal(one('any_of', undefined), 'Q1 = …');
  assert.equal(one('is_not', []), 'Q1 is not …');
  // An op the formatter does not know names the question and claims nothing about it.
  assert.equal(one('between', ['yes']), 'Q1');
});

test('no condition, no line', () => {
  assert.equal(formatVisibleIf({ key: 'a', visibleIf: null }, INDEX), null);
  assert.equal(formatVisibleIf({ key: 'a', visibleIf: { logic: 'all', rules: [] } }, INDEX), null);
  assert.equal(formatVisibleIf({ key: 'a' }, INDEX), null);
  assert.equal(formatVisibleIf(undefined, INDEX), null);
});

test('a clause with no Q number names the question, and a missing question by its stored key', () => {
  assert.equal(ruleClause(rule('lang', 'is', ['ru']), LANG, undefined), '“Idioma — язык” = “Русский”');
  assert.equal(ruleClause(rule('lang', 'is', ['ru']), LANG, 2), 'Q2 = “Русский”');
  assert.equal(ruleClause(rule('gone', 'answered'), undefined, undefined), '“gone” answered');
  // With no question to resolve them, option ids name themselves.
  assert.equal(ruleClause(rule('gone', 'any_of', ['a', 'b']), undefined, undefined), '“gone” = “a” or “b”');
  assert.equal(ruleClause(rule('lang', 'is_not', ['es']), LANG, undefined, { transform: asciiSafe }), '"Idioma - " is not "Español"');
});

test('a statement is named by its title, else the opening of its text, never the whole body', () => {
  // A rule may not target a statement; this is the hand-made-data case. A closing can run to
  // 5000 characters, and the builder renders this line live.
  const body = 'That’s completely understandable.\n\nPaul has spent twenty years fixing roads and parks. '.repeat(10);
  const titled = { key: 's1', type: 'statement', role: 'statement', title: 'Statement 1', label: body };
  assert.equal(ruleClause(rule('s1', 'answered'), titled, undefined), '“Statement 1” answered');
  const untitled = { ...titled, title: null };
  assert.equal(
    ruleClause(rule('s1', 'answered'), untitled, undefined),
    '“That’s completely understandable. Paul has spent twenty year…” answered'
  );
  const short = { ...untitled, label: '  Every vote\nmatters.  ' };
  assert.equal(ruleClause(rule('s1', 'answered'), short, undefined), '“Every vote matters.” answered');
});

test('option labels: Other is named, a retired option still reads, an unknown id names itself', () => {
  assert.equal(optionText(SUPPORT, '__other__'), 'Other');
  assert.equal(optionText(SUPPORT, 'und'), 'Undecided');
  assert.equal(optionText({ options: [{ id: 'old', text: 'Old answer', retired: true }] }, 'old'), 'Old answer');
  assert.equal(optionText(SUPPORT, 'gone'), 'gone');
  assert.equal(optionText(undefined, 'gone'), 'gone');
  assert.equal(quote('Don’t'), '“Don’t”');
  assert.equal(quote('Don’t', asciiSafe), '"Don\'t"');
  assert.equal(quote(null), '“”');
});

test('buildConditionIndex numbers the blocks a canvasser answers and still names the rest', () => {
  const blocks = [
    { key: 'q1', type: 'single_choice', label: 'Support?', options: [{ id: 'yes', text: 'Yes' }] },
    { key: 'pitch', type: 'statement', role: 'statement', label: 'The pitch' },
    { key: 'old', type: 'text', label: 'Old question', retired: true },
    { key: '', type: 'text', label: '' }, // a fresh builder card, label not typed yet
    { key: 'q4', type: 'text', label: 'Anything else?' },
    { key: 'close_2', type: 'statement', role: 'closing', title: 'Close 2', label: 'Every vote matters.' },
    null,
  ];
  const { byKey, numberByKey } = buildConditionIndex(blocks);
  // The unkeyed card is Q2, so the next question is Q3 — the number on its card.
  assert.deepEqual([...numberByKey], [['q1', 1], ['q4', 3]]);
  assert.deepEqual([...byKey.keys()], ['q1', 'pitch', 'old', 'q4', 'close_2']);

  const every = buildConditionIndex(blocks, { numberAnswerableOnly: false });
  assert.deepEqual([...every.numberByKey], [['q1', 1], ['pitch', 2], ['q4', 4], ['close_2', 5]]);

  assert.deepEqual(buildConditionIndex(undefined), { byKey: new Map(), numberByKey: new Map() });
});

test('a compiled script reads with answerable-only numbers; a retired question reads by name', () => {
  // The Burton shape in miniature: two ways into the vote-plan question, one past a statement.
  const blocks = [
    { key: 'q1', type: 'single_choice', label: 'Can he count on your support?', options: [{ id: 'yes', text: 'Yes' }, { id: 'undecided', text: 'Undecided' }] },
    { key: 's1_pitch', type: 'statement', role: 'statement', title: 'Statement 1', label: 'That’s completely understandable…',
      visibleIf: { logic: 'any', rules: [rule('q1', 'any_of', ['undecided'])] } },
    { key: 's1_question', type: 'single_choice', label: 'Having heard that, can Paul count on your support?', options: [{ id: 'yes', text: 'Yes' }],
      visibleIf: { logic: 'any', rules: [rule('q1', 'any_of', ['undecided'])] } },
    { key: 'q4', type: 'single_choice', label: 'Do you plan to vote?', options: [{ id: 'early', text: 'Voting early' }],
      visibleIf: { logic: 'any', rules: [rule('q1', 'any_of', ['yes']), rule('s1_question', 'any_of', ['yes'])] } },
    { key: 'gone', type: 'text', label: 'Retired question', retired: true },
    { key: 'late', type: 'text', label: 'Late', visibleIf: { logic: 'all', rules: [rule('gone', 'answered')] } },
  ];
  const index = buildConditionIndex(blocks);
  const reached = (key) => formatVisibleIf(blocks.find((b) => b.key === key), index, { prefix: 'Reached when' });
  assert.equal(reached('q1'), null);
  assert.equal(reached('s1_pitch'), 'Reached when Q1 = “Undecided”');
  assert.equal(reached('q4'), 'Reached when Q1 = “Yes” or Q2 = “Yes”');
  assert.equal(reached('late'), 'Reached when “Retired question” answered');
});
