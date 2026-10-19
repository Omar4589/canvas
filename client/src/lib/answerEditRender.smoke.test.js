import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke tests for Door Outcomes → Edit answers… (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md): the
// form, the review, the run card, the one-person walkthrough, the per-person editor the voter
// profile shares, and the page's "Survey answer changes" list. renderToString EXECUTES each
// component body, so a const read before its declaration (the TDZ class doorOutcomesRender pins)
// or a branch that throws on a real payload fails here, in `npm test`, instead of in the field.
// The fixtures are the yard-sign case the feature was built for: Volunteer Request and Candidate
// Follow-Up taken out of "Could you help us by taking a yard sign?", Yard Sign Delivered kept.
//
// Overlay is stubbed (it portals to document.body, which the server renderer refuses) and so is
// auth (SSR has no session); everything else is the real component.

const here = fileURLToPath(new URL('.', import.meta.url));
// Inside the client tree on purpose: dependencies stay external to the bundle, so node resolves
// react/react-dom from the bundle's own location (the doorOutcomesRender smoke test's rule).
const dir = mkdtempSync(join(here, '../../.smoke-answer-edit-'));
after(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(
  join(dir, 'overlayStub.jsx'),
  `const Overlay = ({ className = '', children }) => <div data-testid="panel" className={className}>{children}</div>;
   export default Overlay;`
);
writeFileSync(
  join(dir, 'authStub.jsx'),
  `export const useAuth = () => ({ homePath: '/', isOrgAdmin: true, isSuperAdmin: false, user: { id: 'u1' } });
   export const useOrgTimeZone = () => 'America/Chicago';`
);

let built = 0;
const build = async (entry) => {
  const name = `entry${++built}`;
  writeFileSync(join(dir, `${name}.jsx`), entry);
  const out = join(dir, `${name}.mjs`);
  await esbuild.build({
    entryPoints: [join(dir, `${name}.jsx`)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    logLevel: 'silent',
    packages: 'external',
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          // esbuild matches the import specifier as WRITTEN — Modal imports './Overlay.jsx'.
          b.onResolve({ filter: /(^|\/)Overlay\.jsx$/ }, () => ({ path: join(dir, 'overlayStub.jsx') }));
          b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
        },
      },
    ],
  });
  return import(pathToFileURL(out).href);
};

const src = (p) => join(here, '..', p);

// What a reader sees: tags out, React's text-node separators out, entities decoded, spaces folded.
const text = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

// Is the <button> whose text includes `label` disabled?
const buttonDisabled = (html, label) => {
  const m = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].find((b) => text(b[2]).includes(label));
  assert.ok(m, `no button reading ${label}`);
  return /\sdisabled=""/.test(m[1]);
};

const YARD_SIGN = {
  key: 'yard_sign',
  label: 'Could you help us by taking a yard sign?',
  type: 'multiple_choice',
  retired: false,
  visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['yes'] }] },
  otherOption: false,
  options: [
    { id: 'yard_sign_delivered', text: 'Yard Sign Delivered', retired: false },
    { id: 'candidate_follow_up', text: 'Candidate Follow-Up', retired: false },
    { id: 'volunteer_request', text: 'Volunteer Request', retired: false },
  ],
};

// The dry run's questions: the template's answerable questions with their counts over the selection.
const DRY_QUESTIONS = [
  {
    key: 'support', label: 'Do you support Jane Doe?', type: 'single_choice', retired: false, visibleIf: null, otherOption: false,
    options: [{ id: 'yes', text: 'Yes', retired: false }, { id: 'no', text: 'No', retired: false }],
    answered: 300,
    picks: [{ id: 'yes', label: 'Yes', count: 248 }, { id: 'no', label: 'No', count: 52 }],
  },
  {
    ...YARD_SIGN,
    answered: 248,
    picks: [
      { id: 'volunteer_request', label: 'Volunteer Request', count: 139 },
      { id: 'candidate_follow_up', label: 'Candidate Follow-Up', count: 97 },
      { id: 'yard_sign_delivered', label: 'Yard Sign Delivered', count: 12 },
      { id: null, label: 'Volunteer interest', legacy: true, count: 3 },
    ],
  },
  { key: 'comments', label: 'Anything else?', type: 'text', retired: false, visibleIf: null, options: [], answered: 41, picks: [] },
  {
    key: 'old_q', label: 'Which issue matters most?', type: 'single_choice', retired: true, visibleIf: null,
    options: [{ id: 'roads', text: 'Roads', retired: false }], answered: 5, picks: [{ id: 'roads', label: 'Roads', count: 5 }],
  },
];

const DRY = {
  dryRun: true,
  mode: 'bulk',
  entries: 300,
  doors: 280,
  responses: 300,
  notMatched: 9,
  outsideDates: 0,
  heldByRuns: 2,
  surveys: [{ id: 't1', name: 'Fall survey', responses: 300 }, { id: 't2', name: 'Spring survey', responses: 40 }],
  template: { id: 't1', name: 'Fall survey', version: 3, flow: 'list' },
  scopeSummary: 'Canvasser: Cara Canvasser',
  questions: DRY_QUESTIONS,
  limits: { maxResponses: 50000, maxQueue: 500, tooMany: false, tooManyForQueue: false },
};

const formEntry = (props) => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import AnswerEditForm from '${src('components/outcomes/AnswerEditForm.jsx')}';
  import { LEAVE } from '${src('lib/answerEditPlan.js')}';
  const noop = () => {};
  export const render = (p) => renderToString(
    <AnswerEditForm answerFilters={[]} form={{}} setForm={noop} mode="bulk" setMode={noop} busy={false} error={null}
      onCancel={noop} onReview={noop} onStart={noop} onChooseSurvey={noop} {...p} />
  );
  export { LEAVE };
  export const DRY = ${JSON.stringify(DRY)};
  ${props || ''}`;

test('AnswerEditForm: the yard-sign case — counts over the selection, the filter becomes one Take out button', async () => {
  const { render, DRY: dry } = await build(formEntry());
  const html = render({
    dry,
    answerFilters: [{ questionKey: 'yard_sign', values: ['candidate_follow_up', 'volunteer_request'] }],
  });
  const t = text(html);
  assert.match(t, /Edit survey answers/);
  assert.match(t, /300 surveys matched your filter at the 300 entries you selected/);
  assert.match(t, /Fall survey · Filtered to: Canvasser: Cara Canvasser/);
  assert.match(t, /9 other people surveyed at these visits didn’t match and stay as they are/);
  assert.match(t, /These entries hold answers from 2 surveys/);
  assert.match(t, /2 entries an earlier change converted aren’t included/);
  assert.match(t, /answered on 248 of 300/);
  assert.match(t, /asked only after Yes/);
  assert.match(
    t,
    /Now on these surveys: Volunteer Request 139 · Candidate Follow-Up 97 · Yard Sign Delivered 12 · old answer: “Volunteer interest” 3/
  );
  assert.match(t, /Take out just Candidate Follow-Up and Volunteer Request/, 'the answer filter is offered as one button');
  assert.match(t, /Retired questions \(1\)/, 'retired questions fold away');
  assert.doesNotMatch(t, /Which issue matters most/, '…until opened');
  assert.equal(buttonDisabled(html, 'Review changes'), true, 'nothing to review until a question is set');
});

test('AnswerEditForm: Take out keeps the genuine picks; Clear on a pick-several warns in red', async () => {
  const { render, DRY: dry, LEAVE } = await build(formEntry());
  const taking = render({
    dry,
    answerFilters: [{ questionKey: 'yard_sign', values: ['candidate_follow_up', 'volunteer_request'] }],
    form: { yard_sign: { ...LEAVE, mode: 'takeOut', take: ['candidate_follow_up', 'volunteer_request'], replaceWith: '' } },
  });
  const t = text(taking);
  const pressed = [...taking.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]).trim());
  assert.deepEqual(pressed, ['✓ Volunteer Request 139', '✓ Candidate Follow-Up 97']);
  assert.match(t, /A survey left with no picks reads exactly as if the question was skipped/);
  assert.match(t, /Yard Sign Delivered, old answer "Volunteer interest" stays on the surveys that have it/);
  assert.doesNotMatch(t, /Take out just/, 'the suggestion hides once it is what the form says');
  assert.match(t, /Replace them with/);
  assert.equal(buttonDisabled(taking, 'Review changes'), false);

  const clearing = text(render({ dry, form: { yard_sign: { ...LEAVE, mode: 'clear' } } }));
  assert.match(clearing, /Clearing removes every pick on these surveys: Volunteer Request 139 .* To keep some of them, use Take out picks\./);
});

test('AnswerEditForm: One person at a time names its own limit', async () => {
  const { render, DRY: dry } = await build(formEntry());
  const html = render({ dry: { ...dry, limits: { ...dry.limits, tooManyForQueue: true } }, mode: 'queue' });
  assert.match(text(html), /One person at a time takes up to 500 surveys — narrow the selection, or use the same change for everyone\./);
  assert.equal(buttonDisabled(html, 'Start'), true);
  assert.doesNotMatch(text(html), /answered on/, 'no question blocks in queue mode');
});

const PRICE = {
  surveysChanged: 214,
  unchanged: { not_answered: 52, same_answer: 34 },
  byQuestion: [{
    questionKey: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    surveys: 214,
    leftBlank: 202,
    multi: 22,
    removed: [
      { id: 'volunteer_request', label: 'Volunteer Request', surveys: 139 },
      { id: 'candidate_follow_up', label: 'Candidate Follow-Up', surveys: 97 },
    ],
    added: [],
    kept: [{ id: 'yard_sign_delivered', label: 'Yard Sign Delivered', surveys: 12 }],
    setTo: [],
  }],
  skippedByQuestion: [],
  dropped: [],
  endsScript: 0,
  textCleared: [],
  results: [{
    questionKey: 'yard_sign',
    label: 'Could you help us by taking a yard sign?',
    options: [
      { id: 'yard_sign_delivered', label: 'Yard Sign Delivered', before: 40, after: 40 },
      { id: 'candidate_follow_up', label: 'Candidate Follow-Up', before: 97, after: 0 },
      { id: 'volunteer_request', label: 'Volunteer Request', before: 139, after: 0 },
    ],
    totalBefore: 276,
    totalAfter: 40,
  }],
  tags: [{ tag: 'Volunteer', identified: { before: 150, after: 11 }, current: { before: 140, after: 11 } }],
  tagsUnavailable: false,
  recordedBy: [{ userId: 'u9', name: 'Cara Canvasser', surveys: 214 }],
  manifest: [{
    responseId: 'r1',
    voterName: 'Pat Voter',
    address: '12 Elm St',
    submittedAt: '2026-10-01T15:00:00Z',
    recordedBy: 'Cara Canvasser',
    changes: [{ questionKey: 'yard_sign', label: 'Could you help us by taking a yard sign?', kind: 'adjust', before: 'Volunteer Request, Candidate Follow-Up', after: '' }],
  }],
  manifestTotal: 214,
};

const reviewEntry = () => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import AnswerEditReviewModal from '${src('components/outcomes/AnswerEditReviewModal.jsx')}';
  const noop = () => {};
  export const render = (preview) => renderToString(
    <AnswerEditReviewModal preview={preview} tz="America/Chicago" busy={false} onBack={noop} onConfirm={noop} />
  );`;

test('AnswerEditReviewModal: the price, word for word, before anything is written', async () => {
  const { render } = await build(reviewEntry());
  const preview = { ...DRY, price: PRICE };
  const html = render(preview);
  const t = text(html);
  assert.match(t, /Change answers on 214 surveys/);
  assert.match(t, /Survey answers only · Fall survey/);
  assert.match(t, /No door, knock or billing number changes\./);
  assert.match(
    t,
    /Taking out Volunteer Request from 139 surveys and Candidate Follow-Up from 97\. That's 214 surveys: 22 had both\. 202 are left with no answer, as if skipped; 12 keep Yard Sign Delivered\./
  );
  assert.match(t, /Recorded by: Cara Canvasser \(214\)\./);
  assert.match(t, /Your survey results, whole campaign/);
  assert.match(t, /Volunteer Request 139 → 0 \(−139\)/);
  assert.match(t, /Yard Sign Delivered 40 · unchanged/);
  assert.match(t, /All picks 276 → 40 \(−236\)/);
  assert.match(t, /Tag “Volunteer” Identified 150 → 11 \(−139\) Current 140 → 11 \(−129\)/);
  assert.match(t, /Left as they are/);
  assert.match(t, /9 people/, 'the ones the filter left out are named among what stays');
  assert.match(t, /Who changes \(214\) · the earlier answers stay on each voter’s record/);
  assert.match(t, /Pat Voter/);
  assert.match(t, /Could you help us by taking a yard sign\?: Volunteer Request, Candidate Follow-Up → blank/);
  assert.match(t, /Showing 1 of 214\./);
  assert.equal(buttonDisabled(html, 'Change 214 surveys'), false);
});

test('AnswerEditReviewModal: nothing to change, and the follow-ups, written answers and tags it names', async () => {
  const { render } = await build(reviewEntry());
  const none = render({ ...DRY, price: { ...PRICE, surveysChanged: 0, byQuestion: [], results: [], tags: [], manifest: [], manifestTotal: 0 } });
  assert.match(text(none), /Nothing here would change — every selected survey already reads that way\./);
  assert.equal(buttonDisabled(none, 'Change 0 surveys'), true);

  const more = text(render({
    ...DRY,
    price: {
      ...PRICE,
      tags: [],
      tagsUnavailable: true,
      dropped: [{ questionKey: 'when', label: 'When can we deliver it?', answers: 30 }],
      endsScript: 4,
      textCleared: [{ questionKey: 'comments', label: 'Anything else?', answers: 7 }],
    },
  }));
  assert.match(more, /Tag counts can’t be previewed right now; they move with the answers\./);
  assert.match(more, /Later answers that go too \(no longer asked\) When can we deliver it\? · 30 answers removed/);
  assert.match(more, /On 4 surveys a blank answer ends the script/);
  assert.match(more, /Anything else\?: 7 written answers cleared on these surveys\./);
});

const runCardEntry = () => `
  import React from 'react';
  import { renderToString } from 'react-dom/server';
  import AnswerEditRunCard from '${src('components/outcomes/AnswerEditRunCard.jsx')}';
  const noop = () => {};
  export const render = (run, extra = {}) => renderToString(<AnswerEditRunCard run={run} busy={false} onAction={noop} onDismiss={noop} {...extra} />);`;

const RUN = {
  id: 'a1',
  kind: 'answerEdit',
  mode: 'bulk',
  status: 'completed',
  planSummary: 'Could you help us by taking a yard sign?: took out Volunteer Request, Candidate Follow-Up',
  scopeSummary: 'Canvasser: Cara Canvasser',
  counts: {
    surveysTargeted: 216,
    surveysChanged: 214,
    byOption: [
      { label: 'Volunteer Request', removed: 139, added: 0 },
      { label: 'Candidate Follow-Up', removed: 97, added: 0 },
    ],
  },
  progress: { done: 216, total: 216 },
  cursor: 0,
  undo: { status: null, summary: null },
  samples: [{ voterId: 'v1', voterName: 'Sam Changed', reason: 'changed_since_review' }],
  samplesTotal: 2,
};

test('AnswerEditRunCard: every state shows its words and only its own buttons', async () => {
  const { render } = await build(runCardEntry());
  const buttons = (html) => [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]).trim());

  const done = render(RUN);
  const t = text(done);
  assert.match(t, /Answers edited · Could you help us by taking a yard sign\?: took out Volunteer Request, Candidate Follow-Up/);
  assert.match(t, /Filtered to: Canvasser: Cara Canvasser/);
  assert.match(t, /214 surveys changed/);
  assert.match(t, /139 Volunteer Request and 97 Candidate Follow-Up picks taken out/);
  assert.match(t, /Left as they were \(2\)/);
  assert.match(t, /Sam Changed · changed after you reviewed it — left as it was/);
  assert.deepEqual(buttons(done).filter((b) => b !== 'Left as they were (2)'), ['Details', 'Undo', 'Dismiss']);

  const running = render({ ...RUN, status: 'running', progress: { done: 120, total: 214 } });
  assert.match(text(running), /Working · 120 of 214 surveys/);
  assert.match(running, /style="width:56%"/, 'the progress bar reads done of total');
  assert.deepEqual(buttons(running), [], 'nothing to press while it runs — not even Dismiss');

  const failed = text(render({ ...RUN, status: 'failed', error: 'The database went away.', counts: { ...RUN.counts, surveysChanged: 120 } }));
  assert.match(failed, /Stopped · 120 of 216 changed/);
  assert.match(failed, /The database went away\. Every survey it already changed is correct and can be undone — or pick up where it stopped\./);
  assert.match(failed, /Pick up where it stopped/);
  assert.match(failed, /Undo what landed/);

  const undoFailed = render({ ...RUN, undo: { status: 'failed', error: 'Undo timed out.' } });
  assert.match(text(undoFailed), /Undo timed out\. Everything it already put back is correct\. Retry the undo to finish putting the rest back\./);
  assert.ok(buttons(undoFailed).includes('Retry undo'));
  assert.ok(!buttons(undoFailed).includes('Pick up where it stopped'), 'never Pick up once an undo has started');

  const partly = text(render({
    ...RUN,
    samples: [],
    undo: {
      status: 'done',
      summary: {
        putBack: 211, waiting: 3, changedSince: 0,
        names: [{ voterId: 'v2', voterName: 'Lee Waiting', reason: 'waiting', detail: 'Surveyed → Not home' }],
        namesTotal: 3,
      },
    },
  }));
  assert.match(partly, /Partly undone · 211 put back · 3 waiting on a later change/);
  assert.match(partly, /Not put back \(3\)/);
  assert.match(partly, /Lee Waiting · waiting on a later change \(Surveyed → Not home\)/);
  assert.match(partly, /Undo the later change first, then press Undo again here\./);

  const open = render({ ...RUN, mode: 'queue', status: 'open', cursor: 12, progress: { done: 0, total: 30 }, counts: { surveysChanged: 9 }, samples: [] });
  assert.match(text(open), /Unfinished — 9 changed · 12 of 30 reviewed/);
  assert.deepEqual(buttons(open), ['Resume', 'Stop here', 'Dismiss']);
});

// The voter profile's Edit and the walkthrough's editor: the survey's own logic, live.
const PERSON_QUESTIONS = [
  { key: 'support', label: 'Do you support Jane Doe?', type: 'single_choice', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
  YARD_SIGN,
  { key: 'why_not', label: 'Why not?', type: 'text', visibleIf: { logic: 'all', rules: [{ questionKey: 'support', op: 'is', optionIds: ['no'] }] } },
  { key: 'mood', label: 'How is the neighborhood?', type: 'single_choice', options: [{ id: 'good', text: 'Good' }, { id: 'bad', text: 'Bad' }] },
  { key: 'old_q', label: 'Which issue matters most?', type: 'single_choice', retired: true, options: [{ id: 'roads', text: 'Roads' }] },
];
const PERSON_ANSWERS = [
  { questionKey: 'support', questionLabel: 'Do you support Jane Doe?', answer: 'Yes', optionIds: ['yes'] },
  { questionKey: 'yard_sign', questionLabel: YARD_SIGN.label, answer: ['Volunteer Request', 'Candidate Follow-Up'], optionIds: ['volunteer_request', 'candidate_follow_up'] },
  { questionKey: 'why_not', questionLabel: 'Why not?', answer: 'Taxes', optionIds: [] },
  { questionKey: 'mood', questionLabel: 'How is the neighborhood?', answer: 'So-so', optionIds: [] },
  { questionKey: 'old_q', questionLabel: 'Which issue matters most?', answer: 'Roads', optionIds: ['roads'] },
];

test('PerPersonAnswerEditor: follows the logic live, names what a change drops, keeps what is off the path', async () => {
  const { render, seed } = await build(`
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import PerPersonAnswerEditor, { seedEditor } from '${src('components/surveys/PerPersonAnswerEditor.jsx')}';
    const Q = ${JSON.stringify(PERSON_QUESTIONS)};
    const A = ${JSON.stringify(PERSON_ANSWERS)};
    export const seed = (answers = A) => seedEditor(Q, answers);
    export const render = (editor, answers = A) => renderToString(
      <PerPersonAnswerEditor questions={Q} answers={answers} editor={editor} onChange={() => {}} idPrefix="t" />
    );`);

  const asRecorded = render(seed());
  const t = text(asRecorded);
  assert.match(t, /Could you help us by taking a yard sign\?/, 'on this path: Support is Yes');
  const ticked = [...asRecorded.matchAll(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/?>\s*(?:<!-- -->)?([^<]*)/g)].map((m) => m[1].trim());
  assert.deepEqual(ticked.sort(), ['Candidate Follow-Up', 'Volunteer Request']);
  assert.match(t, /Old answer: “So-so” Clear/, 'an old-format answer is shown with its own Clear');
  assert.match(t, /Also on file, not asked on this path: Why not\?: Taxes/);
  assert.match(t, /Retired questions \(kept as recorded\): Which issue matters most\?: Roads/);
  assert.doesNotMatch(t, /Will be removed/);
  assert.doesNotMatch(t, /was:/, 'nothing touched, nothing to compare');

  const s = seed();
  const switched = text(render({ ...s, vals: { ...s.vals, support: 'no' }, touched: { support: true } }));
  assert.match(switched, /was: Yes/);
  assert.match(
    switched,
    /Will be removed — no longer asked after this change: Could you help us by taking a yard sign\?: Volunteer Request, Candidate Follow-Up\. The earlier answers are kept on the voter’s record\./
  );
  assert.match(switched, /Why not\?/, 'the No path asks Why not? — shown as its field');
  assert.doesNotMatch(switched, /not asked on this path/, 'an answer the change brings back onto the path is not also listed as off it');

  const cleared = text(render({ ...s, vals: { ...s.vals, mood: '' }, touched: { mood: true } }));
  assert.doesNotMatch(cleared, /Old answer: “So-so”/, 'once cleared, the old answer line goes');
  assert.match(cleared, /was: So-so/, 'clearing old text is a change even though no option id moved');

  // An old row whose texts only partly match options: the server compares the matched ids, so
  // re-picking them changes nothing and must not read as a change; emptying the field clears it.
  const mixed = PERSON_ANSWERS.map((a) =>
    a.questionKey === 'yard_sign' ? { ...a, answer: ['Volunteer Request', 'Old pledge'], optionIds: [] } : a
  );
  const m = seed(mixed);
  assert.deepEqual(m.vals.yard_sign, ['volunteer_request']);
  const same = text(render({ ...m, touched: { yard_sign: true } }, mixed));
  assert.doesNotMatch(same, /was:/);
  const emptied = text(render({ ...m, vals: { ...m.vals, yard_sign: [] }, touched: { yard_sign: true } }, mixed));
  assert.match(emptied, /was: Volunteer Request, Old pledge/);
});

test('AnswerEditWalkthrough: a survey, a survey no longer on file, and the end of the session', async () => {
  const { render } = await build(`
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import AnswerEditWalkthrough from '${src('components/outcomes/AnswerEditWalkthrough.jsx')}';
    globalThis.fetch = () => new Promise(() => {});
    export const render = (initial) => renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <AnswerEditWalkthrough campaignId="c1" run={{ id: 'q1', counts: { surveysChanged: 9 }, progress: { total: 30 } }}
          initial={initial} tz="America/Chicago" onFinishLater={() => {}} onStopped={() => {}} />
      </QueryClientProvider>
    );`);

  const step = render({
    position: 2,
    total: 30,
    responseId: 'r3',
    done: false,
    voter: { id: 'v3', name: 'Pat Voter' },
    address: '12 Elm St',
    round: 'Round 1',
    recordedBy: 'Cara Canvasser',
    submittedAt: '2026-10-01T15:00:00Z',
    deskEntry: null,
    edited: { by: 'Omar Admin', at: '2026-10-02T15:00:00Z' },
    answers: PERSON_ANSWERS,
    questions: PERSON_QUESTIONS,
    version: 'v1',
  });
  const t = text(step);
  assert.match(t, /Pat Voter/);
  assert.match(t, /12 Elm St · Round 1 · recorded by Cara Canvasser · /);
  assert.match(t, /Survey 3 of 30/);
  assert.match(t, /9 changed so far/);
  assert.match(t, /Edited .* by Omar Admin\./);
  assert.match(t, /Could you help us by taking a yard sign\?/, 'the shared editor rendered');
  assert.equal(buttonDisabled(step, 'Save & next'), false);

  const missing = text(render({ position: 5, total: 30, responseId: 'r6', done: false, missing: true }));
  assert.match(missing, /This survey is no longer on file/);
  assert.match(missing, /There is nothing to edit here — skip it\./);
  assert.doesNotMatch(missing, /Save & next/);

  const end = text(render(null));
  assert.match(end, /That’s every survey in this session/);
  assert.match(end, /9 surveys changed/);
  assert.match(end, /Stop here finishes the session/);
});

test('DoorOutcomesPage: answer edits and conversions share Survey answer changes, newest first', async () => {
  const { html } = await build(`
    import React from 'react';
    import { renderToString } from 'react-dom/server';
    import { MemoryRouter, Routes, Route } from 'react-router-dom';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import DoorOutcomesPage from '${src('pages/DoorOutcomesPage.jsx')}';
    globalThis.fetch = () => new Promise(() => {});
    const cid = '6a0000000000000000000001';
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['admin', 'campaigns'], {
      campaigns: [{ _id: cid, name: 'Ward 3', type: 'survey', state: 'FL', isActive: true, timeZone: 'America/New_York' }],
    });
    qc.setQueryData(['admin', 'campaigns', cid, 'answer-edits'], {
      runs: [
        ${JSON.stringify({ ...RUN, by: 'Omar Admin', byIds: true, createdAt: '2026-10-19T15:00:00Z' })},
        ${JSON.stringify({ ...RUN, id: 'a0', status: 'failed', planSummary: 'Do you support Jane Doe?: changed to No', counts: { ...RUN.counts, byOption: [], surveysChanged: 5 }, by: 'Omar Admin', scopeSummary: null, createdAt: '2026-10-17T15:00:00Z' })},
      ],
    });
    qc.setQueryData(['admin', 'campaigns', cid, 'survey-conversions'], {
      runs: [{
        id: 'c9', direction: 'to_survey', sources: ['not_home'], status: 'completed',
        counts: { responsesCreated: 5, entriesConverted: 5 }, by: 'Omar Admin', createdAt: '2026-10-18T15:00:00Z',
      }],
    });
    export const html = renderToString(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/campaigns/' + cid + '/outcomes']}>
          <Routes>
            <Route path="/campaigns/:campaignId/outcomes" element={<DoorOutcomesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );`);
  const t = text(html);
  assert.match(t, /Survey answer changes/);
  const yard = t.indexOf('took out Volunteer Request, Candidate Follow-Up');
  const conv = t.indexOf('Not home → Surveyed');
  const support = t.indexOf('Do you support Jane Doe?: changed to No');
  assert.ok(yard > -1 && conv > -1 && support > -1, 'all three rows rendered');
  assert.ok(yard < conv && conv < support, 'newest first, across both kinds');
  assert.match(t, /214 surveys changed · 139 Volunteer Request and 97 Candidate Follow-Up picks taken out · Omar Admin · /);
  assert.match(t, /Filtered to: Canvasser: Cara Canvasser · hand-picked rows/);
  assert.match(t, /5 surveys recorded · 5 entries · Omar Admin/, 'a conversion counts whole surveys');
  assert.match(t, /Stopped · 5 of 216 changed/);
});
