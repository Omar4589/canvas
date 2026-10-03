// CANONICAL door-runner core: everything a screen needs to walk a survey template with a voter.
// Which blocks show, which of them record an answer, numbering, progress, the Save gate, the
// POST rows, where the default closing goes, and the one-block-per-screen stepper.
// Mirrored BYTE-FOR-BYTE (everything below the marker) into:
//   client/src/lib/surveyRunner.js   (the web preview's "Try it" walks the same code)
// Edit here, then copy the body. client/src/lib/surveyRunner.test.js is the drift guard (CI's
// client unit job runs it); mobile/lib/surveyRunner.test.js pins the behaviour (npm run test:mobile).
// Design: docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md Part 2 §H.
//
// The import sits ABOVE the marker on purpose: each copy reads its own sibling mirror of the
// evaluator. Explicit .js extension: node's test runner resolves it as real ESM, and Metro and
// Vite are fine with it too.
import { makeCell, visibleQuestionKeys } from './surveyVisibility.js';
// ==== BEGIN MIRRORED BODY ====

// Why this exists: the survey screen used to compute all of this inline. Scripted surveys add
// STATEMENTS (type 'statement': a read-aloud block that takes no answer; role 'closing' marks a
// goodbye) and a second presentation, one block per screen, on the phone and in the web preview.
// Without one shared module, each presentation on each platform would decide for itself what a
// canvasser was shown and what gets saved.
//
// The invariants:
// - ONE routing engine. What shows is the evaluator's visible set over the template's stored
//   visibleIf, the same thing the server re-runs at save (normalizeAndFilterAnswers). "Then go to"
//   routes are compiled INTO visibleIf when the template is saved, so nothing here follows goTo:
//   the stepper is a cursor over the visible list, never a second path walker. (isScripted reads
//   routes only to say whether a survey is a script.)
// - A statement records nothing. It never takes a question number, never counts toward progress,
//   never posts a row and never blocks Save. That holds even for one stored `required: true`,
//   which on the old screen blocked Save forever.
// - For a survey with no statements, every function returns exactly what the old screen computed
//   inline: the cell build, isAnsweredNow, progress, validate() and the POST rows moved here
//   unchanged. mobile/lib/surveyRunner.test.js keeps a frozen copy of that code as its oracle.
// - Pure data in, data out: no React, no react-native. `answers` and `otherTexts` are the
//   screen's own state shapes and are never mutated.
//
// Shapes:
//   survey     the template { questions, intro, closing, flow, presentation }. flow/presentation
//              are ABSENT on lean reads of older templates; absent means 'list'/'scroll', which is
//              why every check is written `=== 'script'`, never `!== 'list'`.
//   answers    { [key]: optionId (single choice) | optionId[] (multiple choice) | string (text) }
//   otherTexts { [key]: string }, the typed "Other (specify)" text
//   blocks     template questions, normally visibleBlocks(survey, answers)

const OTHER = '__other__';

const hasText = (s) => typeof s === 'string' && s.trim().length > 0;

// ---- Block kinds -------------------------------------------------------------------------------

// A read-aloud block that takes no answer. Readers check the TYPE: `role` means something only on
// a statement, and it has no schema default, so it is never trusted on its own.
export const isStatement = (q) => !!q && q.type === 'statement';

// A block that records an answer: anything but a statement. Deliberately not a whitelist of
// today's three types: the server's backstop (normalizeAndFilterAnswers, PROPOSAL §I) drops
// answer rows for statements and only statements, and this has to agree with it.
export const isAnswerable = (q) => !!q && !isStatement(q);

// A statement with role 'closing': the goodbye for the path that reaches it.
export const isClosingBlock = (q) => isStatement(q) && q.role === 'closing';

// ---- Visibility --------------------------------------------------------------------------------

// The template's non-retired blocks in authoring order, which is the order the evaluator walks.
export const activeBlocks = (survey) =>
  ((survey && survey.questions) || []).filter((q) => q && !q.retired);

// The evaluator's cells (key → { optionIds, text }) from the screen's answer state, one per
// non-retired block. makeCell's contract applies: a choice cell never carries text, so
// `answered`/`is_not` read the same here as on the server. The '__other__' pick is an ordinary
// id, so a rule can target it as soon as it is picked, before anything is typed. A statement has
// no state and always gets an empty cell, whatever the state holds.
export const buildCells = (blocks, answers) => {
  const state = answers || {};
  const cells = {};
  for (const q of blocks || []) {
    if (!q || q.retired) continue;
    const v = state[q.key];
    let ids = [];
    let text = null;
    if (isStatement(q)) {
      // no answer state, by definition
    } else if (q.type === 'multiple_choice') {
      ids = Array.isArray(v) ? v : [];
    } else if (q.type === 'text') {
      text = v;
    } else {
      ids = v != null ? [v] : [];
    }
    cells[q.key] = makeCell(q.type, ids, text);
  }
  return cells;
};

// The blocks that show for these answers, in list order. A block that goes hidden keeps its
// answer in state, so changing the earlier answer back restores it. Meanwhile the evaluator
// withholds that answer from every later rule, and buildSubmitRows never posts it.
export const visibleBlocks = (survey, answers) => {
  const questions = (survey && survey.questions) || [];
  const vis = visibleQuestionKeys(questions, buildCells(questions, answers));
  return questions.filter((q) => q && !q.retired && vis.has(q.key));
};

// ---- Answers, numbering, progress, the POST ----------------------------------------------------

// Answered, as the canvasser sees it. An "Other (specify)" pick counts only once its typed text
// is non-blank (whitespace-only is blank); on a multiple-choice question, any real option picked
// alongside it already counts. A statement is never answered.
export const isAnswered = (q, answers, otherTexts) => {
  if (!q || isStatement(q)) return false;
  const v = (answers || {})[q.key];
  const otherTyped = () => hasText((otherTexts || {})[q.key]);
  if (q.type === 'multiple_choice') {
    const arr = Array.isArray(v) ? v : [];
    if (arr.length === 0) return false;
    if (arr.includes(OTHER) && arr.length === 1) return otherTyped();
    return true;
  }
  if (q.type === 'text') return hasText(v);
  if (v === OTHER) return otherTyped();
  return v != null && v !== '';
};

// The blocks that record an answer, in order.
export const answerableQuestions = (blocks) => (blocks || []).filter(isAnswerable);

// key → the 1-based number a question shows. Only answerable blocks are counted, so a statement
// never takes a number. Numbering runs over the VISIBLE list, as the phone has always done, so a
// number follows the path. The builder and paper number every active question, shown or not, so
// the two can differ on a conditional path, as they always have.
export const questionNumbers = (blocks) => {
  const numbers = new Map();
  for (const q of answerableQuestions(blocks)) numbers.set(q.key, numbers.size + 1);
  return numbers;
};

// The first visible required question still unanswered, or null. This is the old validate()
// returned as data, so the caller words it ("Please answer: …", or "Answer Question N to finish").
export const requiredPending = (blocks, answers, otherTexts) =>
  answerableQuestions(blocks).find((q) => q.required && !isAnswered(q, answers, otherTexts)) || null;

// Every visible required question is answered. Save may go, and a guarded survey's default
// closing may show.
export const pathComplete = (blocks, answers, otherTexts) =>
  !requiredPending(blocks, answers, otherTexts);

// { answered, total, percent } over the visible answerable questions; 100% when there are none,
// as the screen has always shown.
export const progress = (blocks, answers, otherTexts) => {
  const questions = answerableQuestions(blocks);
  const total = questions.length;
  const answered = questions.filter((q) => isAnswered(q, answers, otherTexts)).length;
  return { answered, total, percent: total === 0 ? 100 : Math.round((answered / total) * 100) };
};

// The `answers` rows of the survey POST, for visible ANSWERABLE questions only. The old inline
// map posted an empty row for every visible statement. Field order is part of the contract: rows
// are frozen verbatim into the offline queue and replayed days later. A choice row carries the
// option ids (the '__other__' sentinel included) plus a text snapshot, and Other snapshots its
// typed text, or 'Other' when nothing was typed. The server re-derives visibility at save and
// drops rows for hidden questions anyway.
export const buildSubmitRows = (blocks, answers, otherTexts) => {
  const state = answers || {};
  const others = otherTexts || {};
  return answerableQuestions(blocks).map((q) => {
    const v = state[q.key];
    if (q.type === 'text') {
      // Always emit otherText (null here) to match the answer schema.
      return { questionKey: q.key, questionLabel: q.label, answer: v ?? null, optionIds: [], otherText: null };
    }
    const ids = q.type === 'multiple_choice' ? (Array.isArray(v) ? v : []) : v != null ? [v] : [];
    const otherText = ids.includes(OTHER) ? (others[q.key] ?? null) : null;
    const byId = new Map((q.options || []).map((o) => [o.id, o.text]));
    const texts = ids
      .map((id) => (id === OTHER ? others[q.key] || 'Other' : byId.get(id)))
      .filter((t) => t != null);
    const answer = q.type === 'multiple_choice' ? texts : texts[0] ?? null;
    return { questionKey: q.key, questionLabel: q.label, answer, optionIds: ids, otherText };
  });
};

// ---- Closings ----------------------------------------------------------------------------------

// A visible closing block exists, meaning the path reached an explicit goodbye.
export const closingReached = (blocks) => (blocks || []).some(isClosingBlock);

const routed = (target) => target != null && target !== '';
const carriesRoute = (q) =>
  routed(q.goTo) ||
  (!!q.otherOption && routed(q.otherGoTo)) ||
  (q.options || []).some((o) => !!o && !o.retired && routed(o.goTo));

// A script: a survey with a statement, a closing block or a "then go to" route on an active
// block, or one already stored in Script flow. It is the trigger for turning on one block per
// screen (PROPOSAL §G), and it never decides what is recorded.
export const isScripted = (survey) =>
  !!survey &&
  (survey.flow === 'script' || activeBlocks(survey).some((q) => isStatement(q) || carriesRoute(q)));

// Does the default closing wait until the path is complete? Only in Script flow or when the
// survey has a closing block. That is narrower than isScripted on purpose: a statement on its own
// never changes where the goodbye renders, and every existing survey must render exactly as it
// does today.
export const needsClosingGuard = (survey) =>
  !!survey && (survey.flow === 'script' || activeBlocks(survey).some(isClosingBlock));

// Show the template's `closing` field, the DEFAULT closing? Only when it has text (whitespace
// alone counts as none; the old screen drew an empty Closing box for it) and no explicit closing
// is visible. On a guarded survey it also waits until every visible required question is answered,
// so nobody reads "Thank you for your time" above a question they are still asking. A plain
// survey keeps the old rule: shown whenever it has text.
export const showDefaultClosing = (survey, blocks, answers, otherTexts) =>
  hasText(survey && survey.closing) &&
  !closingReached(blocks) &&
  (!needsClosingGuard(survey) || pathComplete(blocks, answers, otherTexts));

// ---- One block per screen (presentation: 'steps') ----------------------------------------------
//
// The caller holds a cursor, a screen id. Every function below recomputes the screen list from
// the answers it is given, so the cursor can only resolve to a block that shows. Rules (§H2): a
// tap SELECTS and never moves the cursor (the read-aloud line under the picked answer and the
// "Please specify" box have to stay on screen); Next advances; Skip, on optional questions, clears
// the answer and advances; Back steps back, and on the first screen it means leave the survey.
//
// HANDLERS PASS THE NEW ANSWERS. A handler that changes an answer and moves in one go (Skip) calls
// nextScreenId with the answers it is about to store, never with the render's memoized list.
// Otherwise a Skip that hides the following blocks advances into one of them.

// Ids of the two screens that are not blocks. They use reserved '__' names because a block key is
// a slug of its label, so a question labelled "End" is keyed 'end'. No generated key can start
// with '__' (every key generator strips underscores), and PROPOSAL §E1 has the server refuse a
// hand-supplied one. That is the same argument that protects '__other__'. '__end__' is also the
// routing END sentinel; both mean the end of the conversation.
export const INTRO_SCREEN_ID = '__intro__';
export const END_SCREEN_ID = '__end__';

// The screens in order: the opening (only when the intro has text), one per visible block, then
// the end screen, unless the last visible block is a closing, in which case that closing is the
// last screen. The LAST screen always carries the Note box and Save. A closing that is not last
// gets Next like any statement: Close 2 before Close 4, or a closing that a multiple-choice union
// left above a later block.
export const screens = (survey, answers) => {
  const blocks = visibleBlocks(survey, answers);
  const list = hasText(survey && survey.intro) ? [{ id: INTRO_SCREEN_ID }] : [];
  for (const block of blocks) list.push({ id: block.key, block });
  if (!isClosingBlock(blocks[blocks.length - 1])) list.push({ id: END_SCREEN_ID });
  return list;
};

// The screen that carries Note and Save, which is always the last one.
export const saveScreenId = (survey, answers) => {
  const list = screens(survey, answers);
  return list[list.length - 1].id;
};

// 'intro' | 'question' | 'statement' | 'closing' | 'end' (null for anything else).
export const screenKind = (screen) => {
  if (!screen) return null;
  if (screen.block) {
    if (isClosingBlock(screen.block)) return 'closing';
    if (isStatement(screen.block)) return 'statement';
    return 'question';
  }
  if (screen.id === INTRO_SCREEN_ID) return 'intro';
  if (screen.id === END_SCREEN_ID) return 'end';
  return null;
};

// A screen's place in authoring order: the opening before every block, the end after them all,
// and a block at its index in survey.questions. Retired blocks keep their index there, so a block
// retired under the cursor still has a place. undefined means an unknown id.
const positionsOf = (survey) => {
  const pos = new Map([[INTRO_SCREEN_ID, -1], [END_SCREEN_ID, Infinity]]);
  ((survey && survey.questions) || []).forEach((q, i) => {
    if (q && !pos.has(q.key)) pos.set(q.key, i);
  });
  return pos;
};

// The screen list plus the index of the screen `id` resolves to (see clampScreenId).
const locate = (survey, answers, id) => {
  const list = screens(survey, answers);
  let index = list.findIndex((s) => s.id === id);
  if (index === -1) {
    const pos = positionsOf(survey);
    const p = pos.get(id);
    index = 0;
    if (p !== undefined) {
      list.forEach((s, i) => {
        if (pos.get(s.id) < p) index = i;
      });
    }
  }
  return { list, index };
};

// Where the cursor is for these answers: `id` while it is still a screen. Otherwise (the answers
// no longer reach the block, or a template refresh retired it) it is the last screen BEFORE the
// block's position, the opening counting as first and the end as last, so the canvasser lands
// on the block they came from rather than back at the start. When nothing precedes it, or the id
// is unknown, it is the first screen; pass null to start a walk.
export const clampScreenId = (survey, answers, id) => {
  const { list, index } = locate(survey, answers, id);
  return list[index].id;
};

// Next is available unless the screen is a visible required question with no answer. It is judged
// on the clamped screen, the one actually on display.
export const canAdvance = (survey, answers, otherTexts, id) => {
  const { list, index } = locate(survey, answers, id);
  const q = list[index].block;
  return !(q && isAnswerable(q) && q.required && !isAnswered(q, answers, otherTexts));
};

// Skip is offered on optional questions only. Statements and the opening have Next, and the last
// screen has Save.
export const canSkip = (survey, answers, id) => {
  const { list, index } = locate(survey, answers, id);
  const q = list[index].block;
  return !!q && isAnswerable(q) && !q.required;
};

// The screen after `id` for THESE answers, or null on the last screen (it has Save, not Next).
// It does not check canAdvance: the caller disables Next with that.
export const nextScreenId = (survey, answers, id) => {
  const { list, index } = locate(survey, answers, id);
  return index < list.length - 1 ? list[index + 1].id : null;
};

// The screen before `id`, or null on the first screen, where Back leaves the survey (the header's
// Back and Android's back button both exit there, as today).
export const prevScreenId = (survey, answers, id) => {
  const { list, index } = locate(survey, answers, id);
  return index > 0 ? list[index - 1].id : null;
};

// Skip's state change: the question's answer and its Other text removed, as if never touched.
// It returns new objects and does not mutate its inputs. Pair it with
// nextScreenId(survey, result.answers, id).
export const skipAnswer = (answers, otherTexts, key) => {
  const nextAnswers = { ...(answers || {}) };
  const nextOtherTexts = { ...(otherTexts || {}) };
  delete nextAnswers[key];
  delete nextOtherTexts[key];
  return { answers: nextAnswers, otherTexts: nextOtherTexts };
};
