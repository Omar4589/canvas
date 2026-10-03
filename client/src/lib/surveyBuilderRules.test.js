import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flowOf,
  presentationOf,
  stripCompiled,
  questionsForEditing,
  displayNum,
  countLabel,
  targetLabel,
  ruleError,
  HAND_RULE_ERROR,
  handRuleError,
  scriptTextError,
  plainTextError,
  MAX_LINKS,
  linkError,
  blockHasRoute,
  hasAnyRoute,
  entersScript,
  autoPresentation,
  DUPLICATE_IN_LIST,
  routesLockedHint,
  routeTargets,
  defaultTargetAt,
  continueLabel,
  continuesToName,
  hasImplicitExit,
  staleRouteLabel,
  previewRouting,
  reachedWhen,
  SKIP_ENDS_WARNING,
  branchingWarning,
  repointRoutes,
  switchBackUndoes,
  switchBack,
  blankStatement,
  cleanBlock,
  blocksAsSaved,
  NO_ANSWERABLE,
  surveyIssues,
  emptyIssues,
  hasBlockingIssues,
} from './surveyBuilderRules.js';
import { END_KEY, OTHER_ID, compileRouting, resolveDefaultTarget } from './surveyRouting.js';
import { makeCell, visibleQuestionKeys } from './surveyVisibility.js';

// The builder's rules (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §G, §L). What goes wrong without each
// pin: a condition aimed at a statement (always false or always true on the phone), a route error
// painted on the wrong card, a "Switch back" that changes what the phone shows, a removed block
// leaving a jump to nowhere, braces reaching a phone, and a Save that sends compiled rules or a
// statement with options.

const choice = (key, label, options, extra = {}) => ({
  key,
  label,
  type: 'single_choice',
  required: true,
  options: options.map(([id, text, goTo = null]) => ({ id, text, goTo })),
  ...extra,
});
const text = (key, label, extra = {}) => ({ key, label, type: 'text', options: [], ...extra });
const statement = (key, label, extra = {}) => ({ key, label, type: 'statement', role: 'statement', options: [], ...extra });
const closingBlock = (key, title, label, goTo) => statement(key, label, { role: 'closing', title, goTo });
const rule = (questionKey, op, optionIds = []) => ({ questionKey, op, optionIds });
const any = (...rules) => ({ logic: 'any', rules });

// The Burton script as authored (Part 1, "The Burton survey"): five questions, five read-aloud
// blocks, every closing with an explicit exit.
const BURTON = [
  choice('q1', 'Can he count on your support?', [
    ['yes', 'Yes', 'q4'],
    ['no', 'No', 'q2'],
    ['undecided', 'Undecided', 's1_pitch'],
    ['already_voted', 'Already voted', 'q3'],
  ]),
  text('q2', 'Is there a particular reason?'),
  statement('s_q2_opponent', 'Are you aware of how much legal and financial trouble his opponent is in?', { goTo: END_KEY }),
  choice('q3', 'Did you vote for Paul Burton?', [
    ['yes', 'Yes', 'close_3'],
    ['no', 'No', END_KEY],
    ['declined_to_say', 'Declined to say', END_KEY],
  ]),
  statement('s1_pitch', 'That’s completely understandable… Common sense, right?', { title: 'Statement 1' }),
  choice('s1_question', 'Having heard that, can Paul count on your support?', [
    ['yes', 'Yes', 'q4'],
    ['still_undecided', 'Still undecided', 'close_4'],
    ['no', 'No', END_KEY],
  ]),
  choice('q4', 'Do you plan to vote on election day, vote early, or vote by mail?', [
    ['election_day', 'Election Day', 'close_2'],
    ['voting_early', 'Voting early', 'close_2'],
    ['by_mail', 'Vote by mail', 'close_2'],
    ['unsure', 'Unsure', 'close_2'],
    ['declined_to_answer', 'Declined to answer', 'close_2'],
    ['not_voting', 'Not voting', END_KEY],
  ]),
  closingBlock('close_2', 'Close 2', 'Every vote matters… make a plan to vote.', 'close_4'),
  closingBlock('close_3', 'Close 3', 'Great! Do you know anyone else that would want to vote for Paul?', 'close_4'),
  closingBlock('close_4', 'Close 4', 'For more information… Have a great day!', END_KEY),
];
const at = (questions, key) => questions.findIndex((q) => q.key === key);

// ---- Loading -----------------------------------------------------------------------------------

test('an older template opens as a Show-only-if survey on a single page', () => {
  assert.equal(flowOf({}), 'list');
  assert.equal(flowOf(null), 'list');
  assert.equal(flowOf({ flow: 'script' }), 'script');
  assert.equal(presentationOf({}), 'scroll');
  assert.equal(presentationOf({ presentation: 'steps' }), 'steps');
});

test('a Script-flow template opens without its compiled conditions; a List one keeps its own', () => {
  const compiled = compileRouting(BURTON).questions;
  const opened = questionsForEditing({ flow: 'script', questions: compiled });
  assert.ok(opened.every((q) => q.visibleIf === null));
  assert.deepEqual(opened[at(opened, 'q4')].options, compiled[at(compiled, 'q4')].options);
  assert.ok(compiled.some((q) => q.visibleIf), 'the stored copy is not mutated');

  const hand = [text('a', 'A'), text('b', 'B', { visibleIf: { logic: 'all', rules: [rule('a', 'answered')] } })];
  assert.deepEqual(questionsForEditing({ flow: 'list', questions: hand }), hand);
  assert.equal(questionsForEditing({ flow: 'list', questions: hand })[1], hand[1], 'untouched blocks pass through');
  assert.deepEqual(questionsForEditing({ questions: hand }), hand);
  assert.deepEqual(questionsForEditing(null), []);
  assert.deepEqual(stripCompiled([null, text('x', 'X')]), [null, text('x', 'X')]);
});

test('a Show-only-if survey opens with no routes, so a Restore can never switch it to Go to', () => {
  const retired = { ...statement('old_close', 'Bye', { role: 'closing', goTo: END_KEY }), retired: true };
  const oldAnswer = { id: 'gone', text: 'Gone', retired: true, goTo: 'old_close' };
  const q1 = { ...choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]) };
  q1.options = [...q1.options, oldAnswer];
  const opened = questionsForEditing({ flow: 'list', questions: [q1, text('q2', 'Why?'), retired] });
  assert.equal(hasAnyRoute(opened), false);
  assert.equal(opened[2].retired, true);
  assert.equal(entersScript('list', { ...opened[2], retired: false }), false, 'restoring it stays Show only if');
  // A Go to survey keeps every route, retired ones included: they are its own.
  const script = questionsForEditing({ flow: 'script', questions: [q1, text('q2', 'Why?'), retired] });
  assert.equal(script[2].goTo, END_KEY);
  assert.equal(script[0].options[2].goTo, 'old_close');
});

test('a route on a choice question itself is dropped on load: no control could ever clear it', () => {
  const q = choice('q1', 'Support?', [['yes', 'Yes', 'q2'], ['no', 'No']], { goTo: 'q2' });
  const [opened] = questionsForEditing({ flow: 'script', questions: [q, text('q2', 'Why?')] });
  assert.equal(opened.goTo, null);
  assert.equal(opened.options[0].goTo, 'q2', 'its answers keep their routes');
  assert.equal(questionsForEditing({ flow: 'script', questions: [text('t', 'T', { goTo: END_KEY })] })[0].goTo, END_KEY);
});

// ---- Numbering and names -----------------------------------------------------------------------

test('displayNum counts answerable blocks only, so statements take no Q number', () => {
  const nums = BURTON.map((_, i) => displayNum(BURTON, i));
  assert.deepEqual(nums, [1, 2, null, 3, null, 4, 5, null, null, null]);
  // Retired blocks are skipped; a card still being typed (no key) is still numbered.
  const qs = [text('a', 'A'), { ...text('b', 'B'), retired: true }, text('', ''), text('c', 'C')];
  assert.deepEqual(qs.map((_, i) => displayNum(qs, i)), [1, null, 2, 3]);
});

test('the header reads "N questions · M statements", and as before with no statements', () => {
  assert.equal(countLabel(BURTON), '5 questions · 5 statements');
  assert.equal(countLabel([text('a', 'A')]), '1 question');
  assert.equal(countLabel([]), '0 questions');
  assert.equal(countLabel([text('a', 'A'), statement('s', 'Hi'), { ...statement('t', 'Old'), retired: true }]), '1 question · 1 statement');
});

test('a block is named by Q number and label, a statement by its title or first words', () => {
  // Clipped to sixty characters, the compiler's own naming: a select can't carry a paragraph.
  assert.equal(targetLabel(BURTON, at(BURTON, 'q4')), 'Q5 · Do you plan to vote on election day, vote early, or vote by…');
  assert.equal(targetLabel(BURTON, at(BURTON, 'q2')), 'Q2 · Is there a particular reason?');
  assert.equal(targetLabel(BURTON, at(BURTON, 'close_2')), 'Close 2');
  assert.equal(
    targetLabel(BURTON, at(BURTON, 's_q2_opponent')),
    'Are you aware of how much legal and financial trouble his op…'
  );
});

// ---- Hand conditions ---------------------------------------------------------------------------

test('ruleError never lets a condition read a statement', () => {
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]),
    statement('s1', 'Thanks for that.'),
    text('q2', 'Why?', { visibleIf: { logic: 'all', rules: [rule('s1', 'answered')] } }),
  ];
  assert.match(ruleError(qs[2], 2, qs), /points at a statement/);
  const onQuestion = { ...qs[2], visibleIf: { logic: 'all', rules: [rule('q1', 'is', ['no'])] } };
  assert.equal(ruleError(onQuestion, 2, qs), null);
});

test('ruleError keeps every check it had before it moved', () => {
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']], { otherOption: true }),
    text('q2', 'Why?'),
    text('q3', 'Anything else?'),
  ];
  const with3 = (...rules) => ({ ...qs[2], visibleIf: { logic: 'all', rules } });
  assert.equal(ruleError({ ...qs[2], visibleIf: null }, 2, qs), null);
  assert.match(ruleError({ ...qs[1], visibleIf: { logic: 'all', rules: [rule('q3', 'answered')] } }, 1, qs), /does not come before/);
  assert.match(ruleError(with3(rule('q2', 'is', ['x'])), 2, qs), /operator that doesn’t fit “Why\?”/);
  assert.match(ruleError(with3(rule('q1', 'is', [])), 2, qs), /missing its answer/);
  assert.match(ruleError(with3(rule('q1', 'is', ['yes', 'no'])), 2, qs), /exactly one/);
  assert.match(ruleError(with3(rule('q1', 'any_of', ['gone'])), 2, qs), /no longer exists/);
  assert.equal(ruleError(with3(rule('q1', 'any_of', ['no', OTHER_ID])), 2, qs), null);
  const noOther = [{ ...qs[0], otherOption: false }, qs[1], qs[2]];
  assert.match(ruleError(with3(rule('q1', 'any_of', [OTHER_ID])), 2, noOther), /no longer exists/);
  const retiredRef = [{ ...qs[0], retired: true }, qs[1], qs[2]];
  assert.match(ruleError(with3(rule('q1', 'answered')), 2, retiredRef), /does not come before/);
});

test('a hand condition left in Script flow is an error until it is re-expressed or removed', () => {
  const handIf = { logic: 'all', rules: [rule('q1', 'is_not', ['yes'])] };
  const q = text('q2', 'Why?', { visibleIf: handIf });
  assert.equal(handRuleError(q, 'script'), HAND_RULE_ERROR);
  assert.match(HAND_RULE_ERROR, /re-express this as a route, or remove it/i);
  assert.equal(handRuleError(q, 'list'), null);
  assert.equal(handRuleError({ ...q, retired: true }, 'script'), null);
  assert.equal(handRuleError({ ...q, visibleIf: { logic: 'all', rules: [] } }, 'script'), null);
  assert.equal(handRuleError({ ...q, visibleIf: null }, 'script'), null);

  // Each flow reports only its own kind of condition problem.
  const qs = [choice('q1', 'Support?', [['yes', 'Yes', 'q2'], ['no', 'No']]), q];
  assert.equal(surveyIssues({ questions: qs, flow: 'script' }).blocks[1].condition, HAND_RULE_ERROR);
  const listQs = [qs[0], statement('s', 'Hello'), text('q3', 'Q3', { visibleIf: { logic: 'all', rules: [rule('s', 'answered')] } })];
  assert.match(surveyIssues({ questions: listQs, flow: 'list' }).blocks[2].condition, /statement/);
  assert.equal(surveyIssues({ questions: listQs, flow: 'script' }).blocks[2].condition, HAND_RULE_ERROR);
});

// ---- Text checks -------------------------------------------------------------------------------

test('read-aloud text takes {{canvasser}} and no other braces', () => {
  assert.equal(scriptTextError('My name is {{canvasser}}.'), null);
  assert.equal(scriptTextError('My name is {{ canvasser }}.'), null);
  assert.equal(scriptTextError(''), null);
  assert.equal(scriptTextError(null), null);
  assert.equal(scriptTextError('Braces } alone {are} fine'), null);
  assert.match(scriptTextError('Hi, I am {{name}}'), /^\{\{name\}\} is not a placeholder/);
  assert.match(scriptTextError('Hi, I am {{Canvasser}}'), /\{\{Canvasser\}\} is not a placeholder/);
  assert.match(scriptTextError('Hi {{}} there'), /empty \{\{\}\}/);
  assert.match(scriptTextError('Hi {{canvasser'), /no closing/);
  assert.match(scriptTextError('{{ {{canvasser}}'), /no closing/);
});

test('a question label, an answer, a title and a link label may hold no "{{" at all', () => {
  assert.match(plainTextError('Do you know {{canvasser}}?', 'A question'), /^A question can’t contain “\{\{”/);
  assert.equal(plainTextError('Plain words', 'A question'), null);
  assert.equal(plainTextError(null, 'A title'), null);

  const qs = [
    choice('q1', 'Hi {{canvasser}}', [['a', '{{x}} yes'], ['b', 'No']], { required: false }),
    statement('s', 'Hello {{canvasser}}', { title: 'Close {{x}}', note: 'Say {{nme}}' }),
  ];
  qs[0].options[1].script = 'Read {{ canvasser }} aloud';
  qs[0].options[0].script = 'Read {{oops}}';
  const issues = surveyIssues({ questions: qs, flow: 'list' });
  assert.match(issues.blocks[0].label, /A question can’t contain/);
  assert.match(issues.blocks[0].option.a.text, /An answer can’t contain/);
  assert.match(issues.blocks[0].option.a.script, /\{\{oops\}\} is not a placeholder/);
  assert.equal(issues.blocks[0].option.b, undefined);
  assert.equal(issues.blocks[1].label, undefined, 'a statement is read aloud, so {{canvasser}} is fine');
  assert.match(issues.blocks[1].title, /A title can’t contain/);
  assert.match(issues.blocks[1].note, /\{\{nme\}\} is not a placeholder/);

  const page = surveyIssues({ intro: 'I am {{canvasser}}', closing: 'Bye {{', questions: [], flow: 'list' });
  assert.equal(page.intro, null);
  assert.match(page.closing, /no closing/);
});

// ---- Links -------------------------------------------------------------------------------------

test('a link must be a full http(s) address; a wholly blank row is no error', () => {
  assert.equal(MAX_LINKS, 5);
  assert.equal(linkError({ label: 'Polling place', url: 'https://example.org/find' }), null);
  assert.equal(linkError({ label: '', url: 'http://example.org' }), null);
  // Any case, as the server's and the phone's checks read it: an address pasted from a document.
  assert.equal(linkError({ label: '', url: 'HTTPS://example.org/vote' }), null);
  assert.equal(linkError({ label: '', url: 'Https://example.org' }), null);
  assert.equal(linkError({ label: '', url: 'HTTP://EXAMPLE.ORG' }), null);
  assert.match(linkError({ label: '', url: 'JAVASCRIPT:alert(1)' }), /https:\/\//);
  assert.equal(linkError({ label: '', url: '  https://example.org  ' }), null);
  assert.equal(linkError({ label: '', url: '' }), null);
  assert.equal(linkError(null), null);
  assert.match(linkError({ label: 'Site', url: '' }), /Add the web address/);
  assert.match(linkError({ label: '', url: 'javascript:alert(1)' }), /https:\/\//);
  assert.match(linkError({ label: '', url: 'ftp://example.org' }), /https:\/\//);
  assert.match(linkError({ label: '', url: 'example.org' }), /https:\/\//);
  assert.match(linkError({ label: '', url: 'https://' }), /https:\/\//);
  assert.match(linkError({ label: '', url: 'https://exa mple.org' }), /no spaces/);
  assert.match(linkError({ label: '{{canvasser}}', url: 'https://example.org' }), /A link label can’t contain/);

  const qs = [statement('s', 'See this', { links: [{ label: 'ok', url: 'https://a.org' }, { label: '', url: 'nope' }] })];
  assert.deepEqual(surveyIssues({ questions: qs, flow: 'list' }).blocks[0].links, [null, linkError({ url: 'nope' })]);
});

// ---- Routes: the first arrow, presentation -----------------------------------------------------

test('the first route of any kind turns a survey into Script flow, and nothing else does', () => {
  const plain = choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]);
  const withArrow = { ...plain, options: [{ ...plain.options[0], goTo: 'q2' }, plain.options[1]] };
  assert.equal(entersScript('list', withArrow), true);
  assert.equal(entersScript(undefined, withArrow), true);
  assert.equal(entersScript('script', withArrow), false);
  assert.equal(entersScript('list', plain), false);
  assert.equal(entersScript('list', { ...plain, options: [{ ...plain.options[0], goTo: '' }] }), false, '"" is Continue');
  // Every route field counts, as in the server's List-flow check: Other's while Other is off, a
  // retired answer's, a block's own.
  assert.equal(entersScript('list', { ...plain, otherOption: false, otherGoTo: 'q2' }), true);
  assert.equal(entersScript('list', { ...plain, options: [{ id: 'old', text: 'Old', retired: true, goTo: END_KEY }] }), true);
  assert.equal(entersScript('list', statement('s', 'Hi', { goTo: END_KEY })), true);
  assert.equal(blockHasRoute(null), false);
  assert.equal(hasAnyRoute([plain, text('q2', 'Why')]), false);
  assert.equal(hasAnyRoute([plain, withArrow]), true);
});

test('one block per screen follows the survey as Save sends it until the admin picks: an edit taken back takes it back', () => {
  const plain = [choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]), text('q2', 'Why?')];
  // An existing single-page survey, saved before presentation existed.
  const opened = { _id: 'p', questions: plain };
  const withStatement = [...plain, statement('s', 'Thanks')];
  const withArrow = [{ ...plain[0], options: [{ id: 'yes', text: 'Yes', goTo: END_KEY }, plain[0].options[1]] }, plain[1]];
  const withClosing = [...plain, closingBlock('c', 'Close', 'Bye', null)];
  const auto = (questions, extra = {}) => autoPresentation({ loaded: opened, questions, flow: 'list', ...extra });
  assert.equal(auto(plain), 'scroll');
  assert.equal(auto(withStatement), 'steps');
  assert.equal(auto(withArrow, { flow: 'script' }), 'steps');
  assert.equal(auto(withClosing), 'steps');
  // Worked out from the list, never latched: the statement removed again, or the arrow set back to
  // Continue, leaves the survey exactly as it was, so it saves on its single page.
  assert.equal(auto([...withStatement.slice(0, 2)]), 'scroll');
  const backToContinue = [{ ...withArrow[0], options: [{ id: 'yes', text: 'Yes', goTo: '' }, plain[0].options[1]] }, plain[1]];
  assert.equal(auto(backToContinue, { flow: 'script' }), 'scroll');
  // A statement still being typed counts (it is on the list Save sends); a retired one doesn't.
  assert.equal(auto([...plain, statement('', '')]), 'steps');
  assert.equal(auto([...plain, { ...statement('s', 'Old'), retired: true }]), 'scroll');
  // An arrow on an answer with no text yet is one Save drops, so it is no arrow.
  const blankArrow = [{ ...plain[0], options: [...plain[0].options, { id: 'opt', text: ' ', goTo: END_KEY }] }, plain[1]];
  assert.equal(auto(blankArrow, { flow: 'script' }), 'scroll');
  // The admin's own tick or untick stands, whatever the survey becomes.
  assert.equal(auto(withStatement, { choice: 'scroll' }), 'scroll');
  assert.equal(auto(plain, { choice: 'steps' }), 'steps');
  // A survey opened as a script keeps what was stored: an admin who unticked it keeps it unticked,
  // and one stored on steps stays there when its statements go. So does a single page ticked by hand.
  const scripted = (presentation) => ({ _id: 's', questions: withStatement, presentation });
  assert.equal(autoPresentation({ loaded: scripted('scroll'), questions: [...withStatement, statement('t', 'More')], flow: 'list' }), 'scroll');
  assert.equal(autoPresentation({ loaded: scripted('steps'), questions: plain, flow: 'list' }), 'steps');
  assert.equal(autoPresentation({ loaded: { _id: 'p', questions: plain, presentation: 'steps' }, questions: plain, flow: 'list' }), 'steps');
  // A new survey (nothing opened): steps exactly while it reads as a script.
  assert.equal(autoPresentation({ loaded: null, questions: plain, flow: 'list' }), 'scroll');
  assert.equal(autoPresentation({ loaded: null, questions: withStatement, flow: 'list' }), 'steps');
});

test('the greyed-out Go to hint says where this page offers Duplicate', () => {
  assert.equal(
    routesLockedHint(),
    'This survey has responses, so it can’t switch to Go to routing. Use Duplicate from the survey list to build the scripted version.'
  );
  assert.equal(routesLockedHint(DUPLICATE_IN_LIST), routesLockedHint());
  assert.match(routesLockedHint('at the top of this page'), /Use Duplicate at the top of this page to build the scripted version\.$/);
});

// ---- Routes: targets, Continue, the grey line --------------------------------------------------

test('a "then go to" offers later live blocks only, and Continue names where it goes', () => {
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]),
    { ...text('gone', 'Retired'), retired: true },
    text('', ''), // a card still being typed
    closingBlock('close', 'Close 2', 'Bye now', null),
    text('q2', 'Anything else?'),
  ];
  assert.deepEqual(routeTargets(qs, 0), [
    { value: 'close', label: 'Close 2' },
    { value: 'q2', label: 'Q3 · Anything else?' },
  ]);
  assert.deepEqual(routeTargets(qs, 3), [{ value: 'q2', label: 'Q3 · Anything else?' }]);
  assert.deepEqual(routeTargets(qs, 4), []);

  // The fall-through skips the retired block and still names the keyless card.
  assert.equal(defaultTargetAt(qs, 0), 2);
  assert.equal(continueLabel(qs, 0), 'Continue to next block (Q2 · Untitled question)');
  assert.equal(continueLabel(qs, 2), 'Continue to next block (Close 2)');
  assert.equal(defaultTargetAt(qs, 4), END_KEY);
  assert.equal(continueLabel(qs, 4), 'Continue (the conversation ends here)');
  assert.equal(continuesToName(qs, 3), 'Q3 · Anything else?');
  assert.equal(continuesToName(qs, 4), 'the end of the conversation');
  assert.equal(defaultTargetAt(qs, 1), null, 'a retired block routes nowhere');
  assert.equal(continuesToName(qs, 1), null);

  // On a fully keyed survey it is exactly resolveDefaultTarget.
  BURTON.forEach((q, i) => {
    const to = defaultTargetAt(BURTON, i);
    assert.equal(to === END_KEY ? END_KEY : BURTON[to].key, resolveDefaultTarget(BURTON, q.key));
  });
});

test('the grey "Continues to" line marks every block that falls through', () => {
  const branching = choice('q1', 'Support?', [['yes', 'Yes', END_KEY], ['no', 'No']]);
  const plain = choice('q2', 'Plain?', [['a', 'A'], ['b', 'B']]);
  assert.equal(hasImplicitExit(branching), false, 'each answer names its own fall-through');
  assert.equal(hasImplicitExit(plain), true);
  assert.equal(hasImplicitExit(statement('s', 'Hi')), true);
  assert.equal(hasImplicitExit(statement('s', 'Hi', { goTo: '' })), true);
  assert.equal(hasImplicitExit(statement('s', 'Hi', { goTo: END_KEY })), false);
  assert.equal(hasImplicitExit(text('t', 'T', { goTo: 'x' })), false);
  assert.equal(hasImplicitExit({ ...statement('s', 'Hi'), retired: true }), false);
});

test('a stored route the select no longer offers is shown as what it is', () => {
  const qs = [text('q1', 'First?'), text('q2', 'Second?', { goTo: 'q1' })];
  assert.equal(staleRouteLabel(qs, 1, 'q1'), 'Q1 · First? (comes earlier: pick another)');
  assert.equal(staleRouteLabel(qs, 1, 'q2'), 'This block itself (pick another)');
  assert.equal(staleRouteLabel(qs, 1, 'gone'), 'A removed block (pick another)');
  assert.equal(staleRouteLabel([{ ...qs[0], retired: true }, qs[1]], 1, 'q1'), 'A removed block (pick another)');
});

// ---- Routes: the live compile ------------------------------------------------------------------

test('the Burton script compiles clean, and "Reached when" reads exactly the stored rule', () => {
  const issues = surveyIssues({ questions: BURTON, flow: 'script' });
  assert.deepEqual(issues.routing.errors, []);
  assert.ok(issues.blocks.every((b) => Object.keys(b).length === 0));
  assert.ok(issues.warnings.every((w) => w === null), 'every branching question is required');
  assert.equal(hasBlockingIssues(issues), false);

  const reached = (key) => reachedWhen(issues.routing, at(BURTON, key));
  assert.equal(reached('q1'), null);
  assert.equal(reached('q2'), 'Reached when Q1 = “No”');
  assert.equal(reached('s_q2_opponent'), 'Reached when Q1 = “No”');
  assert.equal(reached('q4'), 'Reached when Q1 = “Yes” or Q4 = “Yes”');
  assert.equal(
    reached('close_4'),
    'Reached when Q3 = “Yes” or Q4 = “Still undecided” or Q5 = “Election Day” or “Voting early” or “Vote by mail” or “Unsure” or “Declined to answer”'
  );
  // What the author reads is what the server stores: the preview IS compileRouting, run over the
  // blocks as Save sends them; with no blank answer on the list, its conditions are the list's own.
  assert.deepEqual(issues.routing.compiled, compileRouting(blocksAsSaved(BURTON, 'script')).questions);
  assert.deepEqual(
    issues.routing.compiled.map((q) => q.visibleIf),
    compileRouting(BURTON).questions.map((q) => q.visibleIf)
  );
  assert.deepEqual(issues.routing.compiled[at(BURTON, 'q4')].visibleIf, any(
    rule('q1', 'any_of', ['yes']),
    rule('s1_question', 'any_of', ['yes'])
  ));
  assert.equal(reachedWhen(null, 0), null, 'List flow has no preview');
});

test('compile errors land on the card, and on the answer or Other row, they belong to', () => {
  const qs = [
    text('t', 'Your name?'),
    choice('q1', 'First?', [['a', 'A'], ['b', 'B']], { otherOption: true, otherGoTo: 't' }),
    choice('q2', 'Second?', [['c', 'C', 'q1'], ['d', 'D', END_KEY]], { goTo: 'q3' }),
    text('q3', 'Third?', { goTo: 'q2' }),
  ];
  qs[1].options[0].goTo = 'q3';
  const issues = surveyIssues({ questions: qs, flow: 'script' });
  assert.match(issues.blocks[1].other, /^The "Other \(specify\)" answer on "First\?"/);
  assert.match(issues.blocks[2].option.c.route, /can only go to a later block/);
  assert.equal(issues.blocks[2].option.d, undefined);
  // A route on a choice question itself is one Save drops (cleanBlock), so it is no error here.
  assert.equal(issues.blocks[2].route, undefined);
  assert.equal(issues.blocks[3].route.length, 1);
  assert.match(issues.blocks[3].route[0], /"Third\?" can only go to a later block, and "Second\?" comes before it/);
  assert.deepEqual(issues.blocks[0], {});
  assert.equal(hasBlockingIssues(issues), true);
});

test('a card still being typed gets its own errors, never another card’s', () => {
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes', END_KEY], ['no', 'No', END_KEY]]),
    statement('', ''),
    statement('', ''),
  ];
  const { byIndex } = previewRouting(qs);
  assert.match(byIndex[1].block[0], /Nothing leads to "Untitled statement"/);
  assert.deepEqual(byIndex[0].block, []);
  // The second keyless card is reached by falling through the first: no error of its own.
  assert.deepEqual(byIndex[2].block, []);
  // Without stand-in keys both cards would share the key '' and blur together.
  assert.equal(previewRouting(qs).compiled[1].key.startsWith('__draft_'), true);
});

test('a move that turns a route backward is an error at once', () => {
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes', 'close'], ['no', 'No']]),
    text('why', 'Why not?', { goTo: END_KEY }),
    closingBlock('close', 'Close', 'Thanks!', END_KEY),
  ];
  assert.equal(hasBlockingIssues(surveyIssues({ questions: qs, flow: 'script' })), false);
  const moved = [qs[2], qs[0], qs[1]];
  const issues = surveyIssues({ questions: moved, flow: 'script' });
  assert.match(issues.blocks[1].option.yes.route, /comes before it/);
  assert.equal(hasBlockingIssues(issues), true);
});

test('the live compile reads the blocks as Save sends them: an arrow on an answer with no text yet counts nowhere', () => {
  const base = [
    choice('q1', 'Support?', [['yes', 'Yes', 'q2'], ['no', 'No', END_KEY]]),
    text('q2', 'Plan?', { goTo: END_KEY }),
    closingBlock('close_a', 'Close A', 'Thanks for considering', END_KEY),
  ];
  assert.match(surveyIssues({ questions: base, flow: 'script' }).blocks[2].route[0], /Nothing leads to "Close A"/);
  // "+ Add option" on Q1, and its then-go-to set to Close A before the answer is typed.
  const routedBlank = [{ ...base[0], options: [...base[0].options, { id: 'opt', text: '  ', goTo: 'close_a' }] }, base[1], base[2]];
  const issues = surveyIssues({ questions: routedBlank, flow: 'script' });
  assert.match(issues.blocks[2].route[0], /Nothing leads to "Close A"/, 'the error stands, as the server would say');
  assert.equal(hasBlockingIssues(issues), true);
  assert.deepEqual(blocksAsSaved(routedBlank, 'script')[0].options.map((o) => o.id), ['yes', 'no'], 'Save drops the blank answer');
  assert.deepEqual(issues.routing.errors, compileRouting(blocksAsSaved(routedBlank, 'script')).errors);
  // Typed, it is a real arrow.
  const typed = [{ ...base[0], options: [...base[0].options, { id: 'opt', text: 'Maybe', goTo: 'close_a' }] }, base[1], base[2]];
  assert.equal(hasBlockingIssues(surveyIssues({ questions: typed, flow: 'script' })), false);

  // An optional question whose only arrow is on a blank answer is plain as saved: no skip warning,
  // the block after it is reached on every path, and it shows where it continues to.
  const plainAsSaved = [choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No'], ['opt', '', END_KEY]], { required: false }), text('q2', 'Why?')];
  const plainIssues = surveyIssues({ questions: plainAsSaved, flow: 'script' });
  assert.deepEqual(plainIssues.warnings, [null, null]);
  assert.equal(reachedWhen(plainIssues.routing, 1), null);
  assert.equal(hasImplicitExit(plainIssues.routing.compiled[0]), true);
  // A retired answer keeps its row on Save, and the compiler ignores its route, as before.
  const retired = [{ ...plainAsSaved[0], options: [{ id: 'yes', text: 'Yes' }, { id: 'old', text: 'Old', retired: true, goTo: END_KEY }] }, plainAsSaved[1]];
  assert.deepEqual(blocksAsSaved(retired, 'script')[0].options.map((o) => o.id), ['yes', 'old']);
  assert.deepEqual(surveyIssues({ questions: retired, flow: 'script' }).warnings, [null, null]);
});

test('only a non-required BRANCHING choice question gets the skip warning', () => {
  const q = choice('q1', 'Support?', [['yes', 'Yes', 'q2'], ['no', 'No']], { required: false });
  assert.equal(branchingWarning(q), SKIP_ENDS_WARNING);
  assert.match(SKIP_ENDS_WARNING, /Mark it Required or add a “Declined to say” answer/);
  assert.equal(branchingWarning({ ...q, required: true }), null);
  assert.equal(branchingWarning({ ...q, options: q.options.map((o) => ({ ...o, goTo: null })) }), null, 'plain');
  assert.equal(branchingWarning(text('t', 'T', { goTo: 'x' })), null);
  assert.equal(branchingWarning({ ...q, retired: true }), null);
  // Arrows only on retired answers, or on Other while it is off, leave a question plain.
  assert.equal(branchingWarning({ ...q, options: [{ id: 'old', text: 'Old', goTo: 'q2', retired: true }] }), null);
  assert.equal(
    branchingWarning({ ...q, options: q.options.map((o) => ({ ...o, goTo: null })), otherOption: false, otherGoTo: 'q2' }),
    null
  );
  // A warning never blocks Save.
  const issues = surveyIssues({ questions: [q, text('q2', 'Why?')], flow: 'script' });
  assert.equal(issues.warnings[0], SKIP_ENDS_WARNING);
  assert.equal(hasBlockingIssues(issues), false);
});

// ---- Retire / remove ---------------------------------------------------------------------------

test('retiring or removing a route target sends every route into it back to Continue', () => {
  const qs = [
    choice('q1', 'Support?', [['a', 'A', 'close'], ['b', 'B', 'q2']], { otherOption: true, otherGoTo: 'close' }),
    text('q2', 'Why?', { goTo: 'close' }),
    {
      ...choice('q3', 'Plan?', []),
      options: [{ id: 'c', text: 'C', goTo: 'close', retired: true }, { id: 'd', text: 'D', goTo: END_KEY }],
    },
    closingBlock('close', 'Close', 'Bye', END_KEY),
    closingBlock('other', 'Other close', 'So long', 'close'),
  ];
  const { questions, count } = repointRoutes(qs, 'close');
  assert.equal(count, 5);
  assert.deepEqual(questions[0].options.map((o) => o.goTo), ['', 'q2']);
  assert.equal(questions[0].otherGoTo, '');
  assert.equal(questions[1].goTo, '');
  assert.deepEqual(questions[2].options.map((o) => o.goTo), ['', END_KEY]);
  assert.equal(questions[3], qs[3], 'the target keeps its own routes');
  assert.equal(questions[4].goTo, '');
  assert.equal(qs[1].goTo, 'close', 'the input is not mutated');

  const none = repointRoutes(qs, 'q2');
  assert.equal(none.count, 1);
  assert.equal(repointRoutes(qs, '').count, 0);
  assert.equal(repointRoutes(qs, '').questions, qs);
  assert.equal(repointRoutes(qs, 'nobody').count, 0);
});

// ---- Switch back -------------------------------------------------------------------------------

test('Switch back keeps the compiled conditions as hand conditions and clears every route', () => {
  const qs = [
    {
      ...choice('q1', 'Support?', [['yes', 'Yes', 'close'], ['no', 'No']], { otherOption: true, otherGoTo: END_KEY }),
    },
    text('why', 'Why not?'),
    closingBlock('close', 'Close', 'Thanks!', END_KEY),
  ];
  qs[0].options.push({ id: 'old', text: 'Old answer', goTo: 'close', retired: true });
  const { questions, errors } = switchBack(qs);
  assert.deepEqual(errors, []);
  assert.equal(questions[0].visibleIf, null);
  assert.deepEqual(questions[1].visibleIf, any(rule('q1', 'any_of', ['no'])));
  assert.deepEqual(questions[2].visibleIf, any(rule('q1', 'any_of', ['yes', 'no'])));
  // Every route cleared, the retired answer's included, so a later Restore can't revive one.
  assert.equal(hasAnyRoute(questions), false);
  assert.deepEqual(questions[0].options.map((o) => o.goTo), [null, null, null]);
  assert.equal(questions[0].otherGoTo, null);
  assert.equal(questions[2].goTo, null);

  // Lossless: the phone shows the same blocks for every answer, before and after.
  const compiled = compileRouting(qs).questions;
  for (const pick of [[], ['yes'], ['no'], [OTHER_ID]]) {
    const cells = { q1: makeCell('single_choice', pick, null) };
    assert.deepEqual(
      [...visibleQuestionKeys(questions, cells)],
      [...visibleQuestionKeys(compiled, cells)],
      `same visible blocks for ${pick.join(',') || 'no answer'}`
    );
  }
});

test('Switch back refuses while the arrows have an error, and keeps a hand condition it finds', () => {
  const broken = [text('q1', 'First?'), text('q2', 'Second?', { goTo: 'q1' })];
  const refused = switchBack(broken);
  assert.equal(refused.questions, broken);
  assert.match(refused.errors[0].message, /can only go to a later block/);

  // A List survey that just got its first arrow, with a hand condition still on Q2.
  const hand = { logic: 'all', rules: [rule('q1', 'is_not', ['yes'])] };
  const qs = [
    choice('q1', 'Support?', [['yes', 'Yes', 'close'], ['no', 'No']]),
    text('q2', 'Why not?', { visibleIf: hand }),
    closingBlock('close', 'Close', 'Thanks!', null),
  ];
  const { questions, errors } = switchBack(qs);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions[1].visibleIf, hand, 'never silently replaced');
  assert.deepEqual(questions[2].visibleIf, any(rule('q1', 'any_of', ['yes', 'no'])));
  assert.equal(hasAnyRoute(questions), false);
});

test('Switch back on a survey saved in Show only if is an undo: the conditions it opened with, nothing new', () => {
  // Q1 optional and no conditions anywhere, so skipping Q1 shows Q2 and Q3.
  const opened = {
    _id: 'p',
    flow: 'list',
    questions: [choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']], { required: false }), text('q2', 'Why?'), text('q3', 'Plan?')],
  };
  assert.equal(switchBackUndoes(opened), true);
  assert.equal(switchBackUndoes({ _id: 'old', questions: [] }), true, 'no stored flow reads as Show only if');
  assert.equal(switchBackUndoes({ ...opened, flow: 'script' }), false, 'a survey saved in Go to converts');
  assert.equal(switchBackUndoes(null), false, 'so does a new one: its arrows are all the branching it has');

  // Its first arrow, never saved: Yes → Q3. Then Switch back.
  const tried = [
    { ...opened.questions[0], options: [{ id: 'yes', text: 'Yes', goTo: 'q3' }, { id: 'no', text: 'No', goTo: null }] },
    opened.questions[1],
    opened.questions[2],
  ];
  const skipped = { q1: makeCell('single_choice', [], null) };
  const undone = switchBack(tried, opened);
  assert.deepEqual(undone.errors, []);
  assert.equal(hasAnyRoute(undone.questions), false);
  assert.deepEqual(undone.questions.map((q) => q.visibleIf), [null, null, null]);
  assert.deepEqual([...visibleQuestionKeys(undone.questions, skipped)], ['q1', 'q2', 'q3'], 'skipping Q1 shows what it always did');
  // Converting instead would have kept what the arrow implied, the skip ending the conversation included.
  const converted = switchBack(tried, null);
  assert.deepEqual(converted.questions[1].visibleIf, any(rule('q1', 'any_of', ['no'])));
  assert.deepEqual([...visibleQuestionKeys(converted.questions, skipped)], ['q1']);
});

test('an undo brings back a condition removed under Go to, keeps one still on its block, and is never refused', () => {
  const hand = { logic: 'all', rules: [rule('q1', 'is', ['yes'])] };
  const edited = { logic: 'all', rules: [rule('q1', 'is_not', ['no'])] };
  const opened = {
    _id: 'p',
    flow: 'list',
    questions: [
      choice('q1', 'Support?', [['yes', 'Yes'], ['no', 'No']]),
      text('q2', 'Why?', { visibleIf: hand }),
      text('q3', 'Plan?', { visibleIf: hand }),
      { ...text('q4', 'Old'), retired: true, visibleIf: hand },
    ],
  };
  const now = [
    // An arrow in error: No goes back to Q1 itself.
    { ...opened.questions[0], options: [{ id: 'yes', text: 'Yes', goTo: 'q2' }, { id: 'no', text: 'No', goTo: 'q1' }] },
    { ...opened.questions[1], visibleIf: null }, // its hand condition removed under Go to
    { ...opened.questions[2], visibleIf: edited }, // rewritten by hand before the first arrow
    opened.questions[3],
    statement('', 'Added this session', { goTo: END_KEY }),
  ];
  const { questions, errors } = switchBack(now, opened);
  assert.deepEqual(errors, [], 'nothing can stop an undo');
  assert.deepEqual(questions.map((q) => q.visibleIf), [null, hand, edited, hand, null]);
  assert.equal(hasAnyRoute(questions), false);
  assert.equal(questions[3].retired, true);
});

// ---- New blocks and Save -----------------------------------------------------------------------

test('a new closing starts on End in Script flow, and with no route in List flow', () => {
  assert.equal(blankStatement('closing', 'script').goTo, END_KEY);
  assert.equal(blankStatement('closing', 'list').goTo, null);
  assert.equal(blankStatement('statement', 'script').goTo, null);
  const s = blankStatement('statement', 'list');
  assert.equal(s.type, 'statement');
  assert.equal(s.role, 'statement');
  assert.deepEqual(s.options, []);
  assert.equal(s.required, false);
  assert.equal(s.key, '');
  assert.equal(entersScript('list', blankStatement('closing', 'list')), false, 'adding a closing never switches the style');
});

test('Save sends a statement with no options, never required, title and note trimmed, blank links dropped', () => {
  const s = statement('close_2', 'Every vote matters.', {
    role: 'closing',
    title: '  Close 2 ',
    note: '   ',
    required: true,
    otherOption: true,
    refusalOption: true,
    options: [{ id: 'x', text: 'Stray' }],
    links: [{ label: ' Site ', url: ' https://example.org ' }, { label: '', url: '' }, { label: 'x', url: '  ' }],
    goTo: '',
    visibleIf: any(rule('q1', 'any_of', ['yes'])),
  });
  const sent = cleanBlock(s, { key: 'close_2', flow: 'list' });
  assert.deepEqual(sent.options, []);
  assert.equal(sent.required, false);
  assert.equal(sent.otherOption, false);
  assert.equal(sent.refusalOption, false);
  assert.equal(sent.role, 'closing');
  assert.equal(sent.title, 'Close 2');
  assert.equal(sent.note, null);
  assert.deepEqual(sent.links, [{ label: 'Site', url: 'https://example.org' }]);
  assert.equal(sent.goTo, null);
  assert.deepEqual(sent.visibleIf, s.visibleIf, 'a List-flow condition goes as written');
  assert.equal(cleanBlock({ ...s, role: undefined }, { key: 'k', flow: 'list' }).role, 'statement');
});

test('Save sends routes as null or a key, and no visibleIf at all in Script flow', () => {
  const q = choice('q1', 'Support?', [['yes', 'Yes', 'close'], ['no', 'No', ''], ['blank', '']], {
    goTo: 'close', // a stale question-level route: a choice question routes only through its answers
    otherOption: false,
    otherGoTo: 'close',
    role: 'statement',
    visibleIf: any(rule('q0', 'any_of', ['a'])),
  });
  q.options.push({ id: 'old', text: 'Old', retired: true, goTo: '' });
  q.options[0].script = '  ';
  q.options[0].tag = ' Supporter ';
  const sent = cleanBlock(q, { key: 'q1', flow: 'script' });
  assert.deepEqual(sent.options.map((o) => [o.id, o.goTo]), [['yes', 'close'], ['no', null], ['old', null]]);
  assert.equal(sent.options[0].script, null);
  assert.equal(sent.options[0].tag, 'Supporter');
  assert.equal(sent.goTo, null);
  assert.equal(sent.otherGoTo, null, 'Other is off');
  assert.equal(sent.visibleIf, null);
  assert.equal('role' in sent, false, 'a question carries no role');
  assert.equal(sent.title, null);
  assert.equal(sent.note, null);
  assert.deepEqual(sent.links, []);

  assert.equal(cleanBlock({ ...q, otherOption: true }, { key: 'q1', flow: 'script' }).otherGoTo, 'close');
  assert.equal(cleanBlock(text('t', 'T', { goTo: 'close' }), { key: 't', flow: 'script' }).goTo, 'close');
  assert.equal(cleanBlock(text('t', 'T', { goTo: '' }), { key: 't', flow: 'script' }).goTo, null);
  assert.equal(cleanBlock(text('t', 'T', { visibleIf: { logic: 'all', rules: [] } }), { key: 't', flow: 'list' }).visibleIf, null);
  assert.equal(cleanBlock(text('', 'T'), { key: 'minted', flow: 'list' }).key, 'minted');
});

// ---- Save gates --------------------------------------------------------------------------------

test('a survey needs one question that records an answer; statements alone record nothing', () => {
  assert.equal(surveyIssues({ questions: [statement('s', 'Hi')], flow: 'list' }).noAnswerable, NO_ANSWERABLE);
  assert.equal(surveyIssues({ questions: [statement('s', 'Hi'), text('q', 'Q')], flow: 'list' }).noAnswerable, null);
  assert.equal(surveyIssues({ questions: [], flow: 'list' }).noAnswerable, null, 'the empty list has its own message');
  // The server's rule: live blocks, none of them a question. A retired question doesn't count...
  assert.equal(
    surveyIssues({ questions: [{ ...text('q', 'Q'), retired: true }, statement('s', 'Hi')], flow: 'list' }).noAnswerable,
    NO_ANSWERABLE
  );
  // ...and a survey whose every block was retired has nothing live to refuse: it stays saveable
  // (to rename it, say), as it always was.
  const allRetired = surveyIssues({
    questions: [{ ...text('q', 'Q'), retired: true }, { ...statement('s', 'Hi'), retired: true }],
    flow: 'list',
  });
  assert.equal(allRetired.noAnswerable, null);
  assert.equal(hasBlockingIssues(allRetired), false);
  assert.equal(hasBlockingIssues(surveyIssues({ questions: [statement('s', 'Hi')], flow: 'list' })), true);
});

test('blank text waits for Save: an empty statement, label or answer list', () => {
  assert.deepEqual(emptyIssues(statement('s', '  ')), { label: 'Type what the canvasser reads aloud.' });
  assert.deepEqual(emptyIssues(statement('s', 'Read me')), {});
  assert.deepEqual(emptyIssues(text('t', '')), { label: 'This question needs a label.' });
  assert.deepEqual(
    emptyIssues({ ...choice('q', 'Q', [['a', ' ']]), options: [{ id: 'a', text: ' ' }, { id: 'b', text: 'B', retired: true }] }),
    { options: 'Add at least one answer option.' }
  );
  assert.deepEqual(emptyIssues({ ...text('t', ''), retired: true }), {});
  // Never shown live: a card just added is not an error.
  assert.deepEqual(surveyIssues({ questions: [text('q', 'Q'), statement('', '')], flow: 'list' }).blocks[1], {});
});

test('hasBlockingIssues: any live error blocks Save; warnings never do', () => {
  assert.equal(hasBlockingIssues(null), false);
  assert.equal(hasBlockingIssues({ blocks: [{}, {}], warnings: [SKIP_ENDS_WARNING] }), false);
  assert.equal(hasBlockingIssues({ intro: 'x', blocks: [] }), true);
  assert.equal(hasBlockingIssues({ closing: 'x', blocks: [] }), true);
  assert.equal(hasBlockingIssues({ blocks: [{}, { note: 'x' }] }), true);
});
