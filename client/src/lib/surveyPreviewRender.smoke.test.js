import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

// RENDER smoke test for the survey preview (library quick view, campaign Survey tab) and its
// "Try it" rehearsal (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §G). renderToString executes every
// component body, so an ordering bug or a bad import fails here instead of in the console.
//
// The harness is a single renderToString, so it pins what a first render shows: the static
// preview, and the FIRST screen of Try it. The stepping itself (Next, Back, Skip, clamping) is the
// shared runner's, pinned by surveyRunner.test.js here and mobile/lib/surveyRunner.test.js.

const here = fileURLToPath(new URL('.', import.meta.url));
const PREVIEW = join(here, '../components/SurveyPreview.jsx');
const COMPOSER = join(here, '../components/outcomes/SurveyAnswerComposer.jsx');
const CHOICES = join(here, 'surveyChoices.js');

// FROZEN: SurveyPreview.jsx as it was before scripted surveys existed. A survey with no
// statements, conditions, option scripts, notes, links or placeholders must still render exactly
// this markup, byte for byte. Never edit it to make a test pass.
const LEGACY_PREVIEW = `import { choicesFor } from '${CHOICES}';

// Read-only render of a survey template (intro · questions · closing). Used by the
// in-campaign Survey screen to preview the attached template without pulling in the
// editable builder (QuestionCard is module-local to SurveysPage). Question shape:
// { key, label, type: 'single_choice'|'multiple_choice'|'text', options[], required, order }.

const TYPE_HINT = {
  single_choice: 'Pick one',
  multiple_choice: 'Pick many',
  text: 'Type a response',
};

export default function SurveyPreview({ survey }) {
  if (!survey) return null;
  // Retired questions are hidden in the field, so the preview hides them too
  // (mirrors the retired-option filter below).
  const questions = (survey.questions || [])
    .filter((q) => !q.retired)
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="space-y-4">
      {survey.intro ? (
        <p className="rounded-md bg-sunken px-3 py-2 text-sm italic text-fg-muted">{survey.intro}</p>
      ) : null}

      <ol className="space-y-3">
        {questions.map((q, i) => {
          const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
          return (
            <li key={q.key || i} className="rounded-md border border-border bg-card p-3">
              <div className="text-sm font-medium text-fg">
                <span className="mr-2 text-fg-subtle">{i + 1}.</span>
                {q.label || <span className="text-fg-subtle">Untitled question</span>}
                {q.required ? <span className="ml-1 text-danger" title="Required">*</span> : null}
              </div>
              <div className="mt-0.5 text-xs text-fg-subtle">{TYPE_HINT[q.type] || q.type}</div>

              {/* choicesFor appends the synthetic "Other (specify)" write-in, which is a question
                  FLAG rather than a row in options[] — without it this preview showed a shorter
                  survey than the one the phone actually asks. */}
              {isChoice && choicesFor(q).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {choicesFor(q).map((opt, oi) => (
                    <li key={opt.id || oi} className="flex items-center gap-2 text-sm text-fg-muted">
                      <span
                        className={
                          'inline-block h-3 w-3 shrink-0 border border-border-strong ' +
                          (q.type === 'single_choice' ? 'rounded-full' : 'rounded-sm')
                        }
                      />
                      {opt.text || <span className="text-fg-subtle">(empty option)</span>}
                      {opt.isOther && <span className="text-fg-subtle">— write-in</span>}
                    </li>
                  ))}
                </ul>
              )}
              {q.type === 'text' && (
                <div className="mt-2 rounded border border-dashed border-border-strong px-3 py-2 text-xs text-fg-subtle">
                  Free-text answer
                </div>
              )}
            </li>
          );
        })}
        {!questions.length && (
          <li className="text-sm text-fg-muted">This survey has no questions yet.</li>
        )}
      </ol>

      {survey.closing ? (
        <p className="rounded-md bg-sunken px-3 py-2 text-sm italic text-fg-muted">{survey.closing}</p>
      ) : null}
    </div>
  );
}
`;

const build = async (entry, { user = { id: 'u1', firstName: 'Dana' } } = {}) => {
  // Inside the client tree on purpose: dependencies stay external to the bundle, and node must
  // resolve them from the bundle's own location.
  const dir = mkdtempSync(join(here, '../../.smoke-preview-'));
  try {
    // SSR has no session: the auth hook is stubbed with the viewer the test names.
    writeFileSync(join(dir, 'authStub.jsx'), `export const useAuth = () => (${JSON.stringify({ user })});`);
    writeFileSync(join(dir, 'legacyPreview.jsx'), LEGACY_PREVIEW);
    writeFileSync(
      join(dir, 'entry.jsx'),
      `import React from 'react';
       import { renderToString } from 'react-dom/server';
       import SurveyPreview, { SurveyTryIt } from '${PREVIEW}';
       import SurveyAnswerComposer from '${COMPOSER}';
       import LegacyPreview from './legacyPreview.jsx';
       ${entry}`
    );
    const out = join(dir, 'bundle.mjs');
    await esbuild.build({
      entryPoints: [join(dir, 'entry.jsx')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      outfile: out,
      jsx: 'automatic',
      logLevel: 'silent',
      packages: 'external',
      plugins: [
        {
          name: 'stub-auth',
          setup(b) {
            b.onResolve({ filter: /auth\/AuthContext\.jsx$/ }, () => ({ path: join(dir, 'authStub.jsx') }));
          },
        },
      ],
    });
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const json = (v) => JSON.stringify(v);
const when = (questionKey, ...optionIds) => ({ logic: 'any', rules: [{ questionKey, op: 'any_of', optionIds }] });

// A survey from before statements: nothing in it is new. Array order differs from `order` on
// purpose, because the static preview has always sorted by `order`.
const PLAIN = {
  _id: 'plain',
  intro: 'Hi, I am with the campaign.',
  closing: 'Thanks for your time!',
  questions: [
    { key: 'notes', label: '', type: 'text', order: 4 },
    {
      key: 'support',
      label: 'Can we count on your support?',
      type: 'single_choice',
      required: true,
      order: 1,
      otherOption: true,
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
        { id: 'old', text: 'Old answer', retired: true },
      ],
    },
    { key: 'gone', label: 'A retired question', type: 'text', order: 3, retired: true },
    {
      key: 'issues',
      label: 'Top issues',
      type: 'multiple_choice',
      order: 2,
      options: [
        { id: 'roads', text: 'Roads' },
        { id: 'blank', text: '' },
      ],
    },
  ],
};

// The Burton shape, cut down: statements on two branches, a closing block, a note, links, an
// option script, a multi-paragraph body, {{canvasser}}, and a retired block.
const SCRIPTED = {
  _id: 'scripted',
  flow: 'script',
  presentation: 'steps',
  intro: 'Hi, my name is {{canvasser}}.\nI am volunteering for Paul.',
  closing: 'Thank you for your time today.',
  questions: [
    {
      key: 'q1',
      type: 'single_choice',
      label: 'Can he count on your support?',
      required: true,
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
        { id: 'undecided', text: 'Undecided' },
        { id: 'already_voted', text: 'Already voted', script: 'Oh great! Well thank you for participating.' },
      ],
    },
    { key: 'q2', type: 'text', label: 'Is there a particular reason?', visibleIf: when('q1', 'no') },
    {
      key: 's_opponent',
      type: 'statement',
      role: 'statement',
      label: 'Are you aware of how much trouble his opponent is in?',
      note: 'Could share this if the situation feels appropriate.',
      links: [{ label: 'Opponent ledger', url: 'https://example.org/ledger' }],
      visibleIf: when('q1', 'no'),
      goTo: '__end__',
    },
    {
      key: 'q3',
      type: 'single_choice',
      label: "If you don't mind sharing, did you vote for Paul?",
      required: true,
      visibleIf: when('q1', 'already_voted'),
      options: [
        { id: 'yes', text: 'Yes' },
        { id: 'no', text: 'No' },
      ],
    },
    {
      key: 's1_pitch',
      type: 'statement',
      role: 'statement',
      title: 'Statement 1',
      label: "That's completely understandable.\n\nCommon sense, right?",
      visibleIf: when('q1', 'undecided'),
    },
    { key: 'old', type: 'text', label: 'A retired question', retired: true },
    {
      key: 'close_4',
      type: 'statement',
      role: 'closing',
      title: 'Close 4',
      label: 'For more information, visit the website. Have a great day!',
      note: 'Both links are also on the push card.',
      links: [
        { label: 'Website', url: 'https://example.org' },
        { label: 'Not a web link', url: 'javascript:alert(1)' },
      ],
      visibleIf: when('q3', 'yes'),
      goTo: '__end__',
    },
  ],
};

test('a survey from before statements renders exactly as it always did', async () => {
  // Try it walks the array, as the phone and the server do. The builder rewrites `order` to the
  // position on every change, so the two orders only differ in hand-made data like PLAIN's.
  const inArrayOrder = { ...PLAIN, questions: [...PLAIN.questions].sort((a, b) => a.order - b.order) };
  const { html, legacy, tryIt } = await build(`
    export const html = renderToString(<SurveyPreview survey={${json(PLAIN)}} />);
    export const legacy = renderToString(<LegacyPreview survey={${json(PLAIN)}} />);
    export const tryIt = renderToString(<SurveyTryIt survey={${json(inArrayOrder)}} canvasserFirstName="Dana" />);`);
  assert.ok(html.includes(legacy), 'the static render must contain the frozen render verbatim');
  assert.doesNotMatch(html, /Shown when|Canvasser note|Read aloud|Statement|Closing/);
  // The one addition is the Overview / Try it switch above it.
  assert.match(html, />Overview<\/button>/);
  assert.match(html, />Try it<\/button>/);
  assert.match(html, /Canvassers see one page\./);
  // Try it on a plain survey: the single page, and the closing shows at once, exactly as the
  // phone shows a survey that is not scripted (no wait for required questions).
  assert.match(tryIt, /Opening/);
  assert.match(tryIt, /Thanks for your time!/);
  assert.match(tryIt, /Answer Question 1 to finish\./);
  assert.doesNotMatch(tryIt, /A retired question|Old answer/);
});

test('statements, notes, links, gates and the default closing in the static preview', async () => {
  const { html } = await build(`export const html = renderToString(<SurveyPreview survey={${json(SCRIPTED)}} />);`);

  // Statements are captioned by kind and title, and keep their paragraph breaks.
  assert.match(html, /Statement<span class="font-normal text-fg-subtle"> · <!-- -->Statement 1<\/span>/);
  assert.match(html, /Closing<span class="font-normal text-fg-subtle"> · <!-- -->Close 4<\/span>/);
  assert.match(html, /<p class="[^"]*whitespace-pre-line">That&#x27;s completely understandable\.\n\nCommon sense, right\?<\/p>/);
  // A statement with no title gets the bare caption, never a slice of its own body.
  assert.match(html, /<div class="mb-1 text-xs font-medium text-fg-muted">Statement<\/div>/);

  // Numbering skips statements: two statements sit above Q3 and it is still 3.
  assert.match(html, /<span class="mr-2 text-fg-subtle">1<!-- -->\.<\/span>Can he count on your support\?/);
  assert.match(html, /<span class="mr-2 text-fg-subtle">2<!-- -->\.<\/span>Is there a particular reason\?/);
  assert.match(html, /<span class="mr-2 text-fg-subtle">3<!-- -->\.<\/span>If you don&#x27;t mind sharing/);
  assert.doesNotMatch(html, /A retired question/);

  // Every gated block says when it shows, numbered the same way.
  assert.match(html, /Shown when Q1 = “No”/);
  assert.match(html, /Shown when Q1 = “Already voted”/);
  assert.match(html, /Shown when Q1 = “Undecided”/);
  assert.match(html, /Shown when Q3 = “Yes”/);

  // The canvasser note is its own info box, never script styling.
  assert.match(html, /bg-info-tint[^"]*text-info-fg"><div class="font-semibold">Canvasser note/);
  assert.match(html, /Could share this if the situation feels appropriate\./);

  // Links open in a new tab without handing the page a window.opener; a non-web URL is never an anchor.
  assert.match(html, /<a href="https:\/\/example\.org\/ledger" target="_blank" rel="noopener noreferrer"[^>]*>Opponent ledger/);
  assert.match(html, /<a href="https:\/\/example\.org" target="_blank" rel="noopener noreferrer"[^>]*>Website/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Not a web link/);

  // An answer's read-aloud script sits under it.
  assert.match(html, /Read aloud:<\/span> <span class="whitespace-pre-line italic">Oh great! Well thank you for participating\.<\/span>/);

  // The closing field is the DEFAULT closing once a closing block exists.
  assert.match(html, /Closing — when no closing block applies/);
  assert.match(html, /Thank you for your time today\./);

  // {{canvasser}} reads as the viewer's first name, and the opening keeps its line break.
  assert.match(html, /<p class="[^"]*whitespace-pre-line">Hi, my name is Dana\.\nI am volunteering for Paul\.<\/p>/);
  assert.doesNotMatch(html, /\{\{/);
  assert.match(html, /Canvassers see one block per screen\./);
});

test('a viewer with no first name reads the blank, never braces', async () => {
  const { html } = await build(`export const html = renderToString(<SurveyPreview survey={${json(SCRIPTED)}} />);`, {
    user: { id: 'u1' },
  });
  assert.match(html, /Hi, my name is ______\./);
  assert.doesNotMatch(html, /\{\{/);
});

test('Try it, one block per screen: the first screen', async () => {
  const noIntro = { ...SCRIPTED, intro: '' };
  const { opening, question } = await build(`
    export const opening = renderToString(<SurveyTryIt survey={${json(SCRIPTED)}} canvasserFirstName="Dana" />);
    export const question = renderToString(<SurveyTryIt survey={${json(noIntro)}} canvasserFirstName="Dana" />);`);

  // With an opening, it is the first screen: nothing to go back to, Next open, nothing answered.
  assert.match(opening, /Opening/);
  assert.match(opening, /Hi, my name is Dana\./);
  assert.match(opening, /<button type="button" disabled=""[^>]*>‹ Back<\/button>/);
  assert.match(opening, /<button type="button" class="[^"]*">Next<\/button>/);
  assert.match(opening, /style="width:0%"/);
  assert.doesNotMatch(opening, /Can he count on your support\?/);
  assert.doesNotMatch(opening, /Done — nothing is saved/);

  // Without one, Question 1 is first: required, so Next waits for an answer and there is no Skip.
  assert.match(question, /Question <!-- -->1/);
  assert.match(question, /Can he count on your support\?/);
  assert.match(question, /<button type="button" disabled=""[^>]*>Next<\/button>/);
  assert.match(question, />Required</);
  assert.doesNotMatch(question, />Skip</);
  assert.match(question, /aria-pressed="false"[^>]*>.*Already voted/);
  // The option script stays hidden until its answer is picked, as on the phone.
  assert.doesNotMatch(question, /Oh great!/);
});

// The answer side of the same rule (PROPOSAL §I): desk entry records answers after the fact, so a
// statement is never drawn as an input and never counts in "N of M answered", while the evaluator
// still walks it in place.
test('the desk composer draws no input for a statement and counts answerable questions only', async () => {
  const template = {
    name: 'Door script',
    questions: [
      { key: 'q1', type: 'single_choice', label: 'Support?', options: [{ id: 'yes', text: 'Yes' }, { id: 'no', text: 'No' }] },
      { key: 'pitch', type: 'statement', role: 'statement', label: 'Here is why Paul is running.', required: true },
      { key: 'q2', type: 'text', label: 'Why?', visibleIf: when('q1', 'yes') },
      { key: 'bye', type: 'statement', role: 'closing', label: 'Thanks, have a great day!', visibleIf: when('q1', 'yes') },
    ],
  };
  const { blank, yes } = await build(`
    const t = ${json(template)};
    const noop = () => {};
    export const blank = renderToString(<SurveyAnswerComposer template={t} vals={{}} otherTexts={{}} onChange={noop} onOtherChange={noop} idPrefix="d" />);
    export const yes = renderToString(<SurveyAnswerComposer template={t} vals={{ q1: 'yes' }} otherTexts={{}} onChange={noop} onOtherChange={noop} idPrefix="d" />);`);
  for (const html of [blank, yes]) {
    assert.doesNotMatch(html, /Here is why Paul is running|Thanks, have a great day/);
    assert.doesNotMatch(html, /id="d-pitch"|id="d-bye"/);
  }
  assert.match(blank, /0<!-- --> of <!-- -->1<!-- --> answered/);
  assert.doesNotMatch(blank, /<input/);
  // Answering q1 reveals q2 (a real question) past the statement; the closing block stays undrawn.
  assert.match(yes, /1<!-- --> of <!-- -->2<!-- --> answered/);
  assert.match(yes, /<input id="d-q2"/);
});

test('Try it, single page: only the reached blocks, and the guarded default closing', async () => {
  const scroll = { ...SCRIPTED, presentation: 'scroll' };
  const { html } = await build(`export const html = renderToString(<SurveyTryIt survey={${json(scroll)}} canvasserFirstName="Dana" />);`);
  assert.match(html, /Can he count on your support\?/);
  // Everything after Question 1 is gated on its answer, so nothing else shows yet.
  assert.doesNotMatch(html, /Is there a particular reason|Are you aware|Statement 1|Close 4/);
  // A scripted survey holds its default closing until every required question is answered.
  assert.doesNotMatch(html, /Thank you for your time today\./);
  assert.match(html, /Answer Question 1 to finish\./);
});
