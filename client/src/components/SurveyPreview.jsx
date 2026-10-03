import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Button, Input, Segmented, Textarea } from './ui';
import { choicesFor } from '../lib/surveyChoices.js';
import { buildConditionIndex, formatVisibleIf } from '../lib/surveyConditionText.js';
import { fillScript } from '../lib/surveyScriptText.js';
import {
  canAdvance,
  canSkip,
  clampScreenId,
  isClosingBlock,
  isStatement,
  nextScreenId,
  prevScreenId,
  progress,
  questionNumbers,
  requiredPending,
  screenKind,
  screens,
  showDefaultClosing,
  skipAnswer,
  visibleBlocks,
} from '../lib/surveyRunner.js';

// Read-only render of a survey template (intro · questions · closing). Used by the
// in-campaign Survey screen to preview the attached template without pulling in the
// editable builder (QuestionCard is module-local to SurveysPage). Question shape:
// { key, label, type: 'single_choice'|'multiple_choice'|'text'|'statement', options[], required,
//   order, visibleIf, note, links[]; on a statement also role ('statement'|'closing') and title }.
//
// Scripted surveys (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §G): a STATEMENT is read aloud and never
// answered, so it renders as the same read-aloud paragraph as the opening and never takes a
// question number (Q numbers here match the phone's and paper's). A closing block replaces the
// default closing on the path that reaches it. A survey with no statements, conditions, option
// scripts, notes or links renders exactly as it did before any of that existed;
// surveyPreviewRender.smoke.test.js pins it against a frozen copy of the old render.
//
// "Try it" rehearses the template with surveyRunner.js, the module the phone's survey screen runs:
// one block per screen for presentation 'steps', the live single page otherwise. So the web
// rehearsal cannot branch, number or close differently from the door. Nothing is ever saved: the
// answers live in component state and are gone when Try it is turned off.

const TYPE_HINT = {
  single_choice: 'Pick one',
  multiple_choice: 'Pick many',
  text: 'Type a response',
};

const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
const hasText = (s) => typeof s === 'string' && s.trim() !== '';

// The read-aloud paragraph: the opening, a statement, a closing. pre-line keeps the author's line
// breaks, the way the phone's <Text> does. It is added only when the text has one, so a one-line
// opening or closing renders byte-for-byte as it always has.
const READ_ALOUD = 'rounded-md bg-sunken px-3 py-2 text-sm italic text-fg-muted';
const readAloudClass = (text) => (String(text).includes('\n') ? `${READ_ALOUD} whitespace-pre-line` : READ_ALOUD);

// A small label over a block ("Statement · Close 2"). The title is optional; without one, the
// paragraph under it speaks for itself.
const Caption = ({ title, children }) => (
  <div className="mb-1 text-xs font-medium text-fg-muted">
    {children}
    {hasText(title) ? <span className="font-normal text-fg-subtle"> · {title}</span> : null}
  </div>
);

// "Shown when Q1 = “Undecided”": the block's gate in the wording the builder and paper share
// (surveyConditionText.js), numbered over answerable questions like the Q numbers on this page.
const GateCaption = ({ text }) => (text ? <div className="mb-1 text-xs text-fg-subtle">{text}</div> : null);

// http(s) only: the rule the server enforces at save, re-checked here because this is where a
// stored URL becomes a live anchor in the console. Anything else stays plain text.
const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url.trim());

// Option id → its read-aloud script. choicesFor projects options without it.
const optionScripts = (q) =>
  new Map((q.options || []).filter((o) => o && typeof o === 'object').map((o) => [o.id, o.script]));

// The canvasser-only note, in a box that cannot be mistaken for words to say, then the block's
// links. Both may sit on any block.
const BlockExtras = ({ q, fill }) => {
  const links = (q.links || []).filter((l) => l && hasText(l.url));
  return (
    <>
      {hasText(q.note) ? (
        <div className="mt-2 rounded-md border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg">
          <div className="font-semibold">
            Canvasser note<span className="font-normal"> · not read aloud</span>
          </div>
          <p className="mt-0.5 whitespace-pre-line">{fill(q.note)}</p>
        </div>
      ) : null}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1">
          {links.map((l, i) => (
            <li key={i} className="text-sm">
              {isWebUrl(l.url) ? (
                <a
                  href={l.url.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-accent hover:underline"
                >
                  {l.label || l.url}
                  <span aria-hidden="true"> ↗</span>
                </a>
              ) : (
                <span className="text-fg-muted">{l.label || l.url}</span>
              )}
              {hasText(l.label) ? <div className="break-all text-xs text-fg-subtle">{l.url}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

// A statement or closing block: what it is, the words to say, then its note and links.
const ScriptBlock = ({ q, fill, gate = null }) => {
  const text = fill(q.label);
  return (
    <>
      <GateCaption text={gate} />
      <Caption title={q.title}>{isClosingBlock(q) ? 'Closing' : 'Statement'}</Caption>
      <p className={readAloudClass(text)}>{text}</p>
      <BlockExtras q={q} fill={fill} />
    </>
  );
};

// ---- Try it ------------------------------------------------------------------------------------

const PILL =
  'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

// One question to answer. `step` is the one-block-per-screen layout: a "Question N" caption over
// larger type instead of the inline number.
const TryQuestion = ({ q, number, field, step = false }) => {
  const { answers, otherTexts, pick, setText, setOther, fill } = field;
  const value = answers[q.key];
  const picked = Array.isArray(value) ? value : value != null ? [value] : [];
  const scripts = optionScripts(q);
  return (
    <>
      {step ? <Caption>Question {number}</Caption> : null}
      <div className={`${step ? 'text-base' : 'text-sm'} font-medium text-fg`}>
        {step ? null : <span className="mr-2 text-fg-subtle">{number}.</span>}
        {q.label || <span className="text-fg-subtle">Untitled question</span>}
        {q.required ? <span className="ml-1 text-danger" title="Required">*</span> : null}
      </div>
      {q.type === 'text' ? (
        <Textarea
          rows={2}
          className="mt-2"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setText(q.key, e.target.value)}
          placeholder="Type a response"
          aria-label={q.label}
        />
      ) : (
        <ul className="mt-2 space-y-1.5">
          {choicesFor(q).map((opt) => {
            const on = picked.includes(opt.id);
            const script = scripts.get(opt.id);
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(q, opt.id)}
                  className={`${PILL} ${
                    on
                      ? 'border-brand-accent bg-brand-tint font-medium text-brand-tint-fg'
                      : 'border-border-strong bg-card text-fg hover:bg-sunken'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 shrink-0 border ${
                      q.type === 'single_choice' ? 'rounded-full' : 'rounded-sm'
                    } ${on ? 'border-brand-accent bg-brand-accent' : 'border-border-strong'}`}
                  />
                  {opt.text || <span className="text-fg-subtle">(empty option)</span>}
                </button>
                {/* As on the phone, the pick shows its read-aloud line, and Other asks for the
                    write-in, right under the answer. */}
                {on && !opt.isOther && hasText(script) ? (
                  <div className="mt-1.5 rounded-md bg-sunken px-3 py-2">
                    <div className="text-xs font-medium text-fg-muted">Read aloud</div>
                    <p className="mt-0.5 whitespace-pre-line text-sm italic text-fg-muted">{fill(script)}</p>
                  </div>
                ) : null}
                {on && opt.isOther ? (
                  <Input
                    className="mt-1.5"
                    value={otherTexts[q.key] ?? ''}
                    onChange={(e) => setOther(q.key, e.target.value)}
                    placeholder="Please specify"
                    aria-label="Please specify"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <BlockExtras q={q} fill={fill} />
    </>
  );
};

// presentation 'steps': one screen at a time, as the phone shows it (§H2). The screen list is
// recomputed from the answers on every render and the cursor is clamped onto it, so Back, Next and
// Skip can only ever land on a block this path shows.
const StepsTryIt = ({ survey, field, cursor, onMove, onSkip, onStartOver }) => {
  const { answers, otherTexts, fill } = field;
  const id = clampScreenId(survey, answers, cursor);
  const list = screens(survey, answers);
  const index = list.findIndex((s) => s.id === id);
  const screen = list[index];
  const kind = screenKind(screen);
  const blocks = visibleBlocks(survey, answers);
  const last = index === list.length - 1;
  const back = prevScreenId(survey, answers, id);
  const advance = canAdvance(survey, answers, otherTexts, id);
  const intro = kind === 'intro' ? fill(survey.intro) : null;
  // The end screen reads the default closing only on a path that reached no closing block.
  const closing =
    kind === 'end' && showDefaultClosing(survey, blocks, answers, otherTexts) ? fill(survey.closing) : null;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {/* Answered ÷ answerable so far, as on the phone. No "of M": how long a path is isn't known
          until it is walked. */}
      <div className="h-1 bg-sunken">
        <div
          className="h-full bg-brand-accent transition-all"
          style={{ width: `${progress(blocks, answers, otherTexts).percent}%` }}
        />
      </div>
      <div className="space-y-3 p-4">
        {intro !== null ? (
          <div>
            <Caption>Opening</Caption>
            <p className={readAloudClass(intro)}>{intro}</p>
          </div>
        ) : null}
        {kind === 'question' ? (
          <div>
            <TryQuestion q={screen.block} number={questionNumbers(blocks).get(screen.block.key)} field={field} step />
          </div>
        ) : null}
        {kind === 'statement' || kind === 'closing' ? (
          <div>
            <ScriptBlock q={screen.block} fill={fill} />
          </div>
        ) : null}
        {closing !== null ? (
          <div>
            <Caption>Closing</Caption>
            <p className={readAloudClass(closing)}>{closing}</p>
          </div>
        ) : null}
        {last ? <p className="text-sm font-medium text-fg-muted">Done — nothing is saved.</p> : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        {/* The first screen has nowhere to go back to here; on the phone, Back there leaves the survey. */}
        <Button size="sm" variant="ghost" disabled={!back} onClick={() => onMove(back)}>
          ‹ Back
        </Button>
        {last ? (
          <Button size="sm" variant="secondary" onClick={onStartOver}>
            Start over
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {!advance ? <span className="text-xs text-fg-subtle">Required</span> : null}
            {canSkip(survey, answers, id) ? (
              <Button size="sm" variant="ghost" onClick={() => onSkip(id, screen.block.key)}>
                Skip
              </Button>
            ) : null}
            <Button size="sm" disabled={!advance} onClick={() => onMove(nextScreenId(survey, answers, id))}>
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

// presentation 'scroll': the single page, blocks appearing and vanishing as answers change. The
// default closing hides behind a closing block, and on a scripted survey it also waits for every
// required question (showDefaultClosing), exactly as on the phone.
const ScrollTryIt = ({ survey, field, onStartOver }) => {
  const { answers, otherTexts, fill } = field;
  const blocks = visibleBlocks(survey, answers);
  const numbers = questionNumbers(blocks);
  const pending = requiredPending(blocks, answers, otherTexts);
  const intro = hasText(survey.intro) ? fill(survey.intro) : null;
  const closing = showDefaultClosing(survey, blocks, answers, otherTexts) ? fill(survey.closing) : null;
  return (
    <div className="space-y-4">
      {intro !== null ? (
        <div>
          <Caption>Opening</Caption>
          <p className={readAloudClass(intro)}>{intro}</p>
        </div>
      ) : null}
      <ol className="space-y-3">
        {blocks.map((q) =>
          isStatement(q) ? (
            <li key={q.key}>
              <ScriptBlock q={q} fill={fill} />
            </li>
          ) : (
            <li key={q.key} className="rounded-md border border-border bg-card p-3">
              <TryQuestion q={q} number={numbers.get(q.key)} field={field} />
            </li>
          )
        )}
      </ol>
      {closing !== null ? (
        <div>
          <Caption>Closing</Caption>
          <p className={readAloudClass(closing)}>{closing}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-fg-muted">
          {pending ? `Answer Question ${numbers.get(pending.key)} to finish.` : 'Done — nothing is saved.'}
        </p>
        <Button size="sm" variant="secondary" onClick={onStartOver}>
          Start over
        </Button>
      </div>
    </div>
  );
};

// The rehearsal itself. SurveyPreview mounts it fresh each time Try it is turned on; it is exported
// so the render smoke test can pin its first screen.
export const SurveyTryIt = ({ survey, canvasserFirstName }) => {
  const [answers, setAnswers] = useState({});
  const [otherTexts, setOtherTexts] = useState({});
  // The steps cursor: a screen id, null for the first screen.
  const [cursor, setCursor] = useState(null);
  if (!survey) return null;
  const field = {
    answers,
    otherTexts,
    fill: (text) => fillScript(text, { canvasserFirstName }),
    // A tap SELECTS (single choice) or toggles (multiple choice) and never moves the cursor, as on
    // the phone: the read-aloud line and the write-in box have to stay on screen under the pick.
    pick: (q, optionId) =>
      setAnswers((prev) => {
        if (q.type !== 'multiple_choice') return { ...prev, [q.key]: optionId };
        const cur = Array.isArray(prev[q.key]) ? prev[q.key] : [];
        return { ...prev, [q.key]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
      }),
    setText: (key, text) => setAnswers((prev) => ({ ...prev, [key]: text })),
    setOther: (key, text) => setOtherTexts((prev) => ({ ...prev, [key]: text })),
  };
  const startOver = () => {
    setAnswers({});
    setOtherTexts({});
    setCursor(null);
  };
  if (survey.presentation !== 'steps') return <ScrollTryIt survey={survey} field={field} onStartOver={startOver} />;
  // Keep the stored cursor on the screen actually shown. A refetch that retires the current block
  // clamps the view to an earlier screen; without this sync the old cursor would jump the view
  // forward again if the block came back. The same render-time sync as the phone's survey screen;
  // a clamped id clamps to itself, so it settles in one extra pass.
  const shownId = clampScreenId(survey, answers, cursor);
  if (cursor !== shownId) setCursor(shownId);
  // Skip clears the answer and moves on in one go, so the next screen comes from the NEW answers:
  // from the old ones, a Skip that hides the following blocks would land on one of them.
  const skip = (id, key) => {
    const next = skipAnswer(answers, otherTexts, key);
    setAnswers(next.answers);
    setOtherTexts(next.otherTexts);
    setCursor(nextScreenId(survey, next.answers, id));
  };
  return (
    <StepsTryIt
      survey={survey}
      field={field}
      cursor={cursor}
      onMove={setCursor}
      onSkip={skip}
      onStartOver={startOver}
    />
  );
};

const VIEWS = [
  { value: 'overview', label: 'Overview' },
  { value: 'try', label: 'Try it' },
];

export default function SurveyPreview({ survey }) {
  const { user } = useAuth();
  const [trying, setTrying] = useState(false);
  if (!survey) return null;
  // {{canvasser}} reads as the viewer's own first name, the way it reads as each canvasser's on
  // the phone.
  const fill = (text) => fillScript(text, { canvasserFirstName: user?.firstName });
  // Retired questions are hidden in the field, so the preview hides them too
  // (mirrors the retired-option filter below). The builder rewrites `order` to the position on
  // every change, so this is the array order that Try it, the phone and the server walk.
  const questions = (survey.questions || [])
    .filter((q) => !q.retired)
    .sort(byOrder);
  // Statements take no number. The gate index sees retired blocks too, so a rule that names one
  // still reads by its label.
  const numbers = questionNumbers(questions);
  const conditionIndex = buildConditionIndex((survey.questions || []).slice().sort(byOrder));
  const hasClosingBlock = questions.some(isClosingBlock);
  const intro = survey.intro ? fill(survey.intro) : '';
  const closing = survey.closing ? fill(survey.closing) : '';

  const body = (
    <div className="space-y-4">
      {survey.intro ? (
        <p className={readAloudClass(intro)}>{intro}</p>
      ) : null}

      <ol className="space-y-3">
        {questions.map((q, i) => {
          const gate = formatVisibleIf(q, conditionIndex, { prefix: 'Shown when' });
          if (isStatement(q)) {
            return (
              <li key={q.key || i}>
                <ScriptBlock q={q} fill={fill} gate={gate} />
              </li>
            );
          }
          const isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
          const scripts = optionScripts(q);
          return (
            <li key={q.key || i} className="rounded-md border border-border bg-card p-3">
              <GateCaption text={gate} />
              <div className="text-sm font-medium text-fg">
                <span className="mr-2 text-fg-subtle">{numbers.get(q.key)}.</span>
                {q.label || <span className="text-fg-subtle">Untitled question</span>}
                {q.required ? <span className="ml-1 text-danger" title="Required">*</span> : null}
              </div>
              <div className="mt-0.5 text-xs text-fg-subtle">{TYPE_HINT[q.type] || q.type}</div>

              {/* choicesFor appends the synthetic "Other (specify)" write-in, which is a question
                  FLAG rather than a row in options[] — without it this preview showed a shorter
                  survey than the one the phone actually asks. */}
              {isChoice && choicesFor(q).length > 0 && (
                <ul className="mt-2 space-y-1">
                  {choicesFor(q).map((opt, oi) => {
                    const row = (
                      <>
                        <span
                          className={
                            'inline-block h-3 w-3 shrink-0 border border-border-strong ' +
                            (q.type === 'single_choice' ? 'rounded-full' : 'rounded-sm')
                          }
                        />
                        {opt.text || <span className="text-fg-subtle">(empty option)</span>}
                        {opt.isOther && <span className="text-fg-subtle">— write-in</span>}
                      </>
                    );
                    const script = scripts.get(opt.id);
                    // An answer's read-aloud script sits under it, small and muted; an answer
                    // without one is the single line it always was.
                    return hasText(script) ? (
                      <li key={opt.id || oi} className="text-sm text-fg-muted">
                        <div className="flex items-center gap-2">{row}</div>
                        <p className="ml-5 mt-0.5 text-xs text-fg-subtle">
                          <span className="font-medium">Read aloud:</span>{' '}
                          <span className="whitespace-pre-line italic">{fill(script)}</span>
                        </p>
                      </li>
                    ) : (
                      <li key={opt.id || oi} className="flex items-center gap-2 text-sm text-fg-muted">
                        {row}
                      </li>
                    );
                  })}
                </ul>
              )}
              {q.type === 'text' && (
                <div className="mt-2 rounded border border-dashed border-border-strong px-3 py-2 text-xs text-fg-subtle">
                  Free-text answer
                </div>
              )}
              <BlockExtras q={q} fill={fill} />
            </li>
          );
        })}
        {!questions.length && (
          <li className="text-sm text-fg-muted">This survey has no questions yet.</li>
        )}
      </ol>

      {survey.closing ? (
        hasClosingBlock ? (
          // With closing blocks in the survey this field is the DEFAULT closing, read only on a
          // path that reaches none of them, and the caption says so.
          <div>
            <Caption>Closing — when no closing block applies</Caption>
            <p className={readAloudClass(closing)}>{closing}</p>
          </div>
        ) : (
          <p className={readAloudClass(closing)}>{closing}</p>
        )
      ) : null}
    </div>
  );

  // Nothing to rehearse in an empty survey, which renders exactly as it always has.
  if (!questions.length) return body;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented size="sm" options={VIEWS} value={trying ? 'try' : 'overview'} onChange={(v) => setTrying(v === 'try')} />
        <p className="text-xs text-fg-muted">
          {trying
            ? 'Answer as a canvasser would. Nothing is saved.'
            : survey.presentation === 'steps'
              ? 'Canvassers see one block per screen.'
              : 'Canvassers see one page.'}
        </p>
      </div>
      {trying ? <SurveyTryIt key={survey._id || 'survey'} survey={survey} canvasserFirstName={user?.firstName} /> : body}
    </div>
  );
}
