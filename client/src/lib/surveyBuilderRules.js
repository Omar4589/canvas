import {
  END_KEY,
  OTHER_ID,
  isStatement,
  isAnswerable,
  isChoice,
  isClosingBlock,
  blockName,
  isBranching,
  isScripted,
  resolveDefaultTarget,
  compileRouting,
  clearRoutes,
  switchToList,
} from './surveyRouting.js';
import { fillScript, unknownPlaceholders, hasPlaceholderSyntax } from './surveyScriptText.js';
import { formatVisibleIf, buildConditionIndex } from './surveyConditionText.js';

// The survey builder's rules, kept out of SurveyBuilder.jsx so they are pure and pinned by
// node --test (surveyBuilderRules.test.js): what a card may hold, how blocks are numbered and
// named, what the author is told about the flow as they type, and what Save sends. The server
// (routes/admin/surveys.js) enforces the same rules as plain-English 400s, so these are the
// author's early warning, never the guarantee. Design: docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §G.
//
// Two authoring styles, one per survey, stored as `flow`:
//   'list'   — "Show only if": a block shows when its hand-written condition holds.
//   'script' — "then go to" arrows on answers and blocks. The server compiles them into every
//              block's visibleIf at each save, so in Script flow visibleIf is never author data:
//              the builder drops the stored copy on load (questionsForEditing), previews the
//              compiled result live (previewRouting) and sends null.
// The author never picks a style. The first arrow turns List into Script (entersScript), and the
// banner's "Switch back" (switchBack) is the only way back.

// What a cleared select stores ('') and an unset field holds (null) both mean "no route": continue
// to the following block. The compiler reads them the same way.
const routeOf = (value) => (value == null || value === '' ? null : value);

const hasRules = (visibleIf) =>
  !!visibleIf && Array.isArray(visibleIf.rules) && visibleIf.rules.length > 0;

const liveBlocks = (questions) => (questions || []).filter((q) => q && !q.retired);

// ---- Loading a template ------------------------------------------------------------------------

// Lean reads of a template saved before Script flow carry neither field: absent reads as the
// default, so an older survey opens exactly as it always did.
export const flowOf = (template) => (template?.flow === 'script' ? 'script' : 'list');
export const presentationOf = (template) => (template?.presentation === 'steps' ? 'steps' : 'scroll');

// A Script-flow template's stored visibleIf is the compiler's output, not the author's, so the
// builder drops it: whatever then carries a visibleIf in Script flow was written by hand
// (handRuleError), and the "Reached when" lines come from compiling the routes as they stand, never
// from a stale stored copy. The server recompiles on every save.
export const stripCompiled = (questions) =>
  (questions || []).map((q) => (q && q.visibleIf != null ? { ...q, visibleIf: null } : q));

// A choice question routes only through its answers. A route on the question itself is refused by
// the server and never followed, and the card has no control for one, so if one ever arrives it is
// dropped here rather than left as an error the author has no way to clear.
const dropChoiceRoute = (questions) =>
  questions.map((q) => (isChoice(q) && routeOf(q.goTo) != null ? { ...q, goTo: null } : q));

// A Show-only-if survey carries no routes: the server refuses one there, and none is ever followed.
// One can still sit on a retired block the server put back from an earlier Go to version, where a
// Restore would bring it to life and quietly switch the survey to Go to (entersScript), so a
// Show-only-if survey opens with none — the rule Switch back already applies to retired blocks.
const withoutRoutes = (questions) =>
  questions.some((q) => blockHasRoute(q)) ? clearRoutes(questions) : questions;

export const questionsForEditing = (template) => {
  const questions = dropChoiceRoute(template?.questions || []);
  return flowOf(template) === 'script' ? stripCompiled(questions) : withoutRoutes(questions);
};

// ---- Numbering and names -----------------------------------------------------------------------

// A block's Q number: answerable blocks only, in list order, retired ones skipped. It is the number
// the phone shows whenever every question on the path is visible, and the one the "Reached when"
// lines use (buildConditionIndex numbers the same way). A statement takes none: null. A card still
// being typed is numbered like any other, or every later "Q3" would name the card after it.
export const displayNum = (questions, index) => {
  const list = questions || [];
  const q = list[index];
  if (!q || q.retired || !isAnswerable(q)) return null;
  let n = 0;
  for (let i = 0; i <= index; i += 1) {
    if (list[i] && !list[i].retired && isAnswerable(list[i])) n += 1;
  }
  return n;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The block list's header over live blocks, closings counted as statements. A survey with no
// statements reads as it always did: "N questions".
export const countLabel = (questions) => {
  const live = liveBlocks(questions);
  const statements = live.filter(isStatement).length;
  const asked = plural(live.length - statements, 'question', 'questions');
  return statements ? `${asked} · ${plural(statements, 'statement', 'statements')}` : asked;
};

// How a "then go to" select and a "Continues to" line name a block: Q number and name for a
// question, the name alone for a statement or closing (its title, else its first words).
export const targetLabel = (questions, index) => {
  const n = displayNum(questions, index);
  const name = blockName((questions || [])[index]);
  return n ? `Q${n} · ${name}` : name;
};

// ---- Hand conditions (List flow) ---------------------------------------------------------------

// Validate one block's "Show only if" against the blocks BEFORE it. Returns an error string (shown
// live + on save) or null. A condition may only reference an earlier, keyed, non-retired QUESTION
// — never a statement, which has no answer to test (the server refuses that too: `answered` on one
// is always false and `is_not` always true); the op must fit that question's type; and
// is/is_not target exactly one existing option, any_of at least one (retired ids + '__other__'
// allowed when that question enables Other).
export const ruleError = (q, index, questions) => {
  const vi = q.visibleIf;
  if (!vi || !(vi.rules || []).length) return null;
  const before = (questions || []).slice(0, index).filter((x) => x && !x.retired && x.key);
  const earlier = new Map(before.filter(isAnswerable).map((x) => [x.key, x]));
  const statementKeys = new Set(before.filter(isStatement).map((x) => x.key));
  for (const r of vi.rules) {
    const refQ = earlier.get(r.questionKey);
    if (!refQ) {
      return statementKeys.has(r.questionKey)
        ? 'A condition points at a statement, which takes no answer. Condition on the answers that led there instead.'
        : 'A condition references a question that does not come before this one.';
    }
    const validOps = refQ.type === 'text'
      ? ['answered', 'not_answered']
      : ['is', 'is_not', 'any_of', 'answered', 'not_answered'];
    if (!validOps.includes(r.op)) return `A condition uses an operator that doesn’t fit “${refQ.label || 'that question'}”.`;
    if (r.op === 'is' || r.op === 'is_not' || r.op === 'any_of') {
      const ids = r.optionIds || [];
      if (!ids.length) return 'A condition is missing its answer selection.';
      if ((r.op === 'is' || r.op === 'is_not') && ids.length !== 1) return 'A condition should target exactly one answer.';
      const valid = new Set([
        ...(refQ.options || []).map((o) => o.id),
        ...(refQ.otherOption ? [OTHER_ID] : []),
      ]);
      if (!ids.every((id) => valid.has(id))) return 'A condition points at an answer that no longer exists.';
    }
  }
  return null;
};

export const HAND_RULE_ERROR =
  'This block still has a Show-only-if condition, and a Go to survey builds those from its arrows. Re-express this as a route, or remove it.';

// In Script flow a live block's condition belongs to the compiler, and the stored compiled copy
// was dropped on load, so a condition here was written by hand: in practice a List survey that
// just got its first arrow. It is never silently deleted (the compiler cannot express is_not,
// not_answered or Match ALL, so dropping it would lose logic): the author re-expresses it as a
// route or removes it, and Save waits. The server refuses the same switch while one remains.
export const handRuleError = (q, flow) =>
  flow === 'script' && !!q && !q.retired && hasRules(q.visibleIf) ? HAND_RULE_ERROR : null;

// ---- Text checks -------------------------------------------------------------------------------

// Read-aloud text — the greeting, the default closing, a statement, an answer's script, a note —
// may hold {{canvasser}} and no other braces. The test is the strict one: fill the known token and
// see whether any "{{" survives, so a misspelt token and an unclosed "{{" both fail here, where the
// author can fix them, instead of reaching a phone as literal braces.
export const scriptTextError = (text) => {
  if (text == null || !hasPlaceholderSyntax(fillScript(text, { canvasserFirstName: 'x' }))) return null;
  const [unknown] = unknownPlaceholders(text);
  if (unknown === '') {
    return 'An empty {{}} is not a placeholder. Type {{canvasser}} for the canvasser’s first name, or remove the braces.';
  }
  if (unknown != null) {
    return `{{${unknown}}} is not a placeholder. The only one is {{canvasser}}, the canvasser’s first name.`;
  }
  return 'A “{{” has no closing “}}”. Finish it as {{canvasser}}, or remove it.';
};

// A question's label and an answer's text are never filled: each is copied onto every stored answer
// row and becomes a results label and a CSV cell (scriptText.js, hasPlaceholderSyntax). A title or
// a link label shows on the phone exactly as typed. So none of them may hold "{{" at all.
export const plainTextError = (text, what) =>
  hasPlaceholderSyntax(text)
    ? `${what} can’t contain “{{”. Placeholders like {{canvasser}} work only in text that is read aloud.`
    : null;

// ---- Links -------------------------------------------------------------------------------------

export const MAX_LINKS = 5;

// The server accepts http(s) addresses only (^https?://, in any case, as the phone does), so
// javascript: and ftp: never reach the phone's browser. The builder also refuses spaces, which no
// working address has.
const WEB_ADDRESS = /^https?:\/\/\S+$/i;

// One link row. A row left wholly blank is dropped on save (cleanBlock), so it is no error; a label
// with no address is, because saving would quietly lose what was typed.
export const linkError = (link) => {
  const url = (link?.url || '').trim();
  if (!url) return (link?.label || '').trim() ? 'Add the web address, or remove this link.' : null;
  if (!WEB_ADDRESS.test(url)) return 'Use a full web address with no spaces, starting with https:// (or http://).';
  return plainTextError(link.label, 'A link label');
};

// ---- Routes ------------------------------------------------------------------------------------

// Every route field a block can carry — its own, Other's, every answer's, retired ones included,
// whether or not Other is on. Stricter than the server on purpose: the server refuses only LIVE
// routes in a Show-only-if survey and clears retired ones silently, so treating any stored route as
// "this is a Go to survey" here can never send a payload the server rejects. (hasActiveRoutes in
// surveyRouting.js answers a different question: which arrows the compiler FOLLOWS.)
export const blockHasRoute = (q) =>
  !!q &&
  (routeOf(q.goTo) != null ||
    routeOf(q.otherGoTo) != null ||
    (Array.isArray(q.options) ? q.options : []).some((o) => o && routeOf(o.goTo) != null));

export const hasAnyRoute = (questions) => (questions || []).some(blockHasRoute);

// The first "then go to" an author sets is what makes a survey a Script-flow survey; nothing else
// does. `q` is the block as it is about to be stored.
export const entersScript = (flow, q) => flow !== 'script' && blockHasRoute(q);

// One block per screen, worked out from the survey as it stands, never latched on a keystroke.
// Once the admin ticks or unticks it, their `choice` stands. Until then it is on when the survey as
// Save sends it (blocksAsSaved) reads as a script — a live statement, closing or arrow — and the
// survey as opened did not; otherwise it is what was stored. So a statement added and removed
// again, or an arrow set and taken back, leaves an existing single-page survey on its single page,
// and a survey opened as a script keeps what its admin chose. `loaded` is the template as the
// builder opened it, null for a new survey.
export const autoPresentation = ({ loaded, questions, flow, choice = null }) => {
  if (choice === 'steps' || choice === 'scroll') return choice;
  return isScripted(blocksAsSaved(questions, flow)) && !isScripted(loaded?.questions)
    ? 'steps'
    : presentationOf(loaded);
};

// Where Duplicate is, for the hint below and the builder's locked banner. The org editor has none
// of its own (it is in the survey list); a campaign's builder offers it at the top of its page, and
// says so through SurveyForm's `duplicateAt`.
export const DUPLICATE_IN_LIST = 'from the survey list';

// What the server's 409 says, shown on a greyed-out "then go to" before the author tries, with
// where to find Duplicate on this page: a team lead has no survey list to go to.
export const routesLockedHint = (duplicateAt = DUPLICATE_IN_LIST) =>
  `This survey has responses, so it can’t switch to Go to routing. Use Duplicate ${duplicateAt} to build the scripted version.`;

// ---- The locked banner -------------------------------------------------------------------------

// Whether the locked banner may call changes to the Go to routes safe: only on a survey saved in Go to
// that still uses it. The server refuses ENTERING Go to once a survey has responses (the PATCH's 409
// survey-has-responses), so a survey saved in Show only if that has taken its first arrow since — the
// race a refused save ends — still needs a fresh copy for that, and the banner says so, as the refusal
// does. `loaded` is the template as the builder opened it, null for a new survey.
export const savedInGoTo = (flow, loaded) => flow === 'script' && flowOf(loaded) === 'script';

// ---- A failed save -----------------------------------------------------------------------------

// The failed save a builder page shows on its form: the last one, if it was sent for the survey now
// on the form. A page outlives a change of the survey it edits (a campaign's Duplicate swaps it in
// place, and the sidebar's campaign switcher keeps /survey/edit), while a mutation keeps its last
// error until the next attempt, so another survey's 409 survey-has-responses would lock, and speak
// for, a survey the server never refused, one with no answers anywhere included. `mutation` is the
// page's PATCH mutation, whose variables are { id, body }; null when there is nothing to show.
export const saveErrorFor = (mutation, surveyId) =>
  mutation?.error && surveyId != null && String(mutation.variables?.id) === String(surveyId)
    ? mutation.error
    : null;

// ---- Responses, as the viewer may see them -----------------------------------------------------

// How a survey's responses read to the person looking. An org admin's row counts the whole
// organization: "35 responses". A team lead's counts cover only the campaigns they manage
// (routes/admin/surveys.js narrows them), so their number says so: "10 responses in your campaigns".
// On a survey on their campaigns none of whose answers are counted in them, the server sends the bare
// yes/no alone (owner ruling 2026-10-03), so the phrase has no number — and never says "elsewhere":
// rows saved before responses carried a campaign may be this campaign's own. null when there is nothing
// to say. Lead wording is the default, so a host that forgets isOrgAdmin under-states an admin's
// total rather than passing a lead's count off as the survey's.
export const responsesPhrase = (survey, { isOrgAdmin = false } = {}) => {
  const count = survey?.responseCount || 0;
  const counted = `${count.toLocaleString()} response${count === 1 ? '' : 's'}`;
  if (isOrgAdmin) return count > 0 ? counted : null;
  if (count > 0) return `${counted} in your campaigns`;
  return survey?.hasResponses ? 'responses in your organization' : null;
};

// The Survey tab's Preview note opens with the survey's responses, worded for its reader: an org
// admin's are the survey's total ("35 responses across all campaigns"), a lead's their own or the bare
// yes/no ("This survey has 10 responses in your campaigns", "This survey has responses in your
// organization"). null = nothing to say, which is exactly when hasResponses is false: an admin's
// hasResponses is their count > 0, and a lead's narrowed count > 0 implies the yes/no.
export const responsesNoteOpening = (survey, { isOrgAdmin = false } = {}) => {
  const phrase = responsesPhrase(survey, { isOrgAdmin });
  if (!phrase) return null;
  return isOrgAdmin ? `${phrase} across all campaigns` : `This survey has ${phrase}`;
};

// A copy's name. A survey's name is at most 200 characters (the POST's and the PATCH's own limit,
// counted in UTF-16 code units), so a long one is cut to leave room for the suffix — never between
// the two halves of an emoji, whose lone first half would be stored as U+FFFD. The server's duplicate
// route caps the same way.
export const COPY_SUFFIX = ' (Copy)';
export const copyName = (name) =>
  `${String(name ?? '')
    .trim()
    .slice(0, 200 - COPY_SUFFIX.length)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd()}${COPY_SUFFIX}`;

// The survey as the builder opened it, by stored block key: each block's type, its words (a
// question's wording, a statement's read-aloud text), and its answers and their ids (retired ones
// included), in the form questionsForEditing loads them.
// What a survey with responses protects is what was SAVED, as on the server — classifyQuestionEdits
// compares stored keys only, and reconcileQuestions retires only stored items — so a block or answer
// added since stays fully editable and is removed outright. Empty for a new survey.
export const savedShape = (loaded) =>
  new Map(
    questionsForEditing(loaded)
      .filter((q) => q && q.key)
      .map((q) => [
        q.key,
        {
          type: q.type,
          label: q.label ?? '',
          options: q.options || [],
          answerIds: new Set((q.options || []).map((o) => o && o.id).filter(Boolean)),
        },
      ])
  );

// A question changing type. What the change clears stays on the card as `retyped`: a choice question's
// answers when it goes to Free text, a Free-text question's own then go to when it goes to a choice
// type (single to multiple choice and back clears nothing, so what is kept stays). A saved question
// going back to the type it was saved with gets exactly that back: the card's own answers or arrow as
// they stood just before the switch, edits included, and never the survey as saved, so an answer
// removed before the switch stays gone. Answers come back only when the card holds no typed answer (it
// came from Free text, or through blank ones), so nothing typed is ever replaced, and only once: back
// at the saved type the kept answers leave `retyped`, whether they come back or typed answers win, so
// answers blanked by hand later can't bring them back. (The kept route needs no such rule: every change
// away from Free text keeps the card's arrow afresh.) A route comes back only while the survey as it
// stands uses Go to (`flow`), and only to a block the card can still point at (`targets`, the keys its
// "then go to" selects offer, or End); any other goes back to Continue. In
// Show only if a restored arrow would switch the survey to Go to (entersScript): after Switch back,
// which clears every route on the cards but not what they keep, it would undo the switch and leave
// every condition the switch converted as a hand condition that blocks Save. Returns what to merge
// into the card, its `retyped` always plus whatever comes back, or null when the type doesn't change.
// `saved` is the block's savedShape entry (null for a block added since the survey was opened, which
// keeps but gets nothing back); `block` is the card as it stands, before the change. `retyped` never
// leaves the builder: cleanBlock drops it, and a builder opened again starts without it.
export const restoredOnRetype = (saved, block, toType, { flow = 'list', targets = [] } = {}) => {
  if (!block || block.type === toType) return null;
  const retyped = { ...block.retyped };
  if (toType === 'text' && isChoice(block)) retyped.options = block.options || [];
  if (block.type === 'text' && isChoice({ type: toType })) retyped.goTo = block.goTo ?? null;
  if (!saved || toType !== saved.type) return { retyped };
  const route = (to) =>
    flow === 'script' && to != null && (to === END_KEY || targets.includes(to)) ? to : null;
  if (toType === 'text') {
    const goTo = route(block.retyped?.goTo);
    return goTo == null ? { retyped } : { retyped, goTo };
  }
  const { options: back, ...keeps } = retyped;
  const typed = (block.options || []).some((o) => o && (o.text || '').trim());
  return typed || !back ? { retyped: keeps } : { retyped: keeps, options: back.map((o) => ({ ...o, goTo: route(o.goTo) })) };
};

// The card a type pill makes (QuestionCard's setType): `card` at `toType`, with what the change clears
// kept and whatever comes back merged on top (restoredOnRetype). Free text drops every answer. A
// Free-text question going to a choice type starts from two blank answers (`blankAnswers` mints them)
// and drops its own then go to: a choice question routes through its answers only, and the server
// refuses a question-level route there. Between the two choice types the answers stay. What comes back
// is spread last, so a restore lands over the blank answers, never under them. `route` is the card's
// routeFor object: its `flow` is the form's as it stands, and its `targets` are the { value, label }
// choices its "then go to" selects offer, matched here by value.
export const retypedCard = (saved, card, toType, route, blankAnswers) => {
  const restored = restoredOnRetype(saved, card, toType, {
    flow: route.flow,
    targets: route.targets.map((t) => t.value),
  });
  if (toType === 'text') return { ...card, type: toType, options: [], ...restored };
  if (!isChoice(card)) return { ...card, type: toType, goTo: null, options: blankAnswers(), ...restored };
  return { ...card, type: toType, ...restored };
};

// Removing an answer from a saved question on a survey with responses. An answer the survey was saved
// with retires — kept, so its past answers still report — and keeps words: the card's when it has any,
// else the saved ones, the same words the server keeps for an answer a save leaves out
// (reconcileQuestions). A retired answer still goes to the server, which refuses one with no text as a
// bare 400. An answer added since the survey was opened gets null: never saved, it simply goes.
// `saved` is the block's savedShape entry.
export const retireOption = (o, saved) => {
  if (!o || !o.id || !saved || !saved.answerIds.has(o.id)) return null;
  const savedText = saved.options.find((s) => s && s.id === o.id)?.text;
  return { ...o, text: (o.text || '').trim() ? o.text : savedText ?? o.text, retired: true };
};

// Whether Remove retires a block rather than taking it out: only while the survey is locked (it has
// responses, or a save was refused because it has), and only a block it was saved with, by stored key
// (savedShape), the server's own test (reconcileQuestions matches by key). A block added since, or a
// card still being typed (no key yet), is removed outright.
export const retiresOnRemove = (locked, savedBlocks, key) => !!locked && savedBlocks.has(key);

// Retiring a saved block on a survey with responses — a question, a statement or a closing. It stays,
// so its past answers still report, and keeps words: the card's when it has any, else the saved ones,
// the words the server keeps for a block a save leaves out (reconcileQuestions). A retired block still
// goes to the server, which refuses one with no label as a bare 400 'Invalid input', and the builder's
// own checks skip a retired block, so nothing would have warned. The server's type check covers
// retired blocks too (classifyQuestionEdits), so a question retyped before the lock came on goes back
// to the type it was saved with, as that type's pill would put it back (restoredOnRetype, as in Show
// only if): its own answers, or what its switch to Free text cleared — never the saved ones over them,
// since Restore brings the block back exactly as it was retired. Only its type has to go back for the
// server, which puts back as retired any saved answer the save leaves out (reconcileQuestions). Then
// every arrow goes: a retired block's are never followed, and one brought back by Restore in Show only
// if would switch the survey to Go to. `saved` is the block's savedShape entry; the caller retires
// only a block that has one.
export const retireBlock = (q, saved) => {
  const label = (q.label || '').trim() ? q.label : saved?.label ?? q.label;
  if (!saved || q.type === saved.type) return { ...q, retired: true, label };
  const back = { ...q, type: saved.type, ...(isChoice(saved) ? {} : { options: [] }), ...restoredOnRetype(saved, q, saved.type) };
  return {
    ...back,
    retired: true,
    label,
    options: (back.options || []).map((o) => ({ ...o, goTo: null })),
    goTo: null,
    otherGoTo: null,
  };
};

// The choices a "then go to" select offers beside Continue and End: later live blocks only. A route
// can point forward and nowhere else (the compiler's rule 6), so the select never offers a target
// the save would refuse. A card with no key yet can't be pointed at; it gets one with its text.
export const routeTargets = (questions, index) => {
  const out = [];
  (questions || []).forEach((q, i) => {
    if (i > index && q && !q.retired && q.key) out.push({ value: q.key, label: targetLabel(questions, i) });
  });
  return out;
};

// A card still being typed has no key (keys are minted from its first keystrokes), and the compiler
// names blocks by key. The live preview gives each keyless card a stand-in so its errors land on
// the right card and a rule that reads it still resolves. Never saved: Save mints the real key.
// `__` can never begin a real key, since every key generator strips underscores.
const DRAFT_KEY = '__draft_';
const withDraftKeys = (questions) =>
  (questions || []).map((q, i) => (q && !q.key ? { ...q, key: `${DRAFT_KEY}${i}` } : q));

// Where a block falls through to: resolveDefaultTarget, as a position in `questions`, or END_KEY
// after the last live block; null for a retired block. Draft keys keep a keyless card answerable.
export const defaultTargetAt = (questions, index) => {
  const keyed = withDraftKeys(questions);
  const to = resolveDefaultTarget(keyed, keyed[index]?.key);
  if (to == null || to === END_KEY) return to;
  return keyed.findIndex((q) => q && !q.retired && q.key === to);
};

export const END_LABEL = 'End the conversation';

// The select's Continue choice names where Continue goes, because a statement left on Continue
// runs into whatever follows it (the fall-through trap).
export const continueLabel = (questions, index) => {
  const to = defaultTargetAt(questions, index);
  return typeof to === 'number' && to >= 0
    ? `Continue to next block (${targetLabel(questions, to)})`
    : 'Continue (the conversation ends here)';
};

// The grey "Continues to" line's target, or null for a retired block.
export const continuesToName = (questions, index) => {
  const to = defaultTargetAt(questions, index);
  if (to == null) return null;
  return typeof to === 'number' && to >= 0 ? targetLabel(questions, to) : 'the end of the conversation';
};

// A block falls through when nothing on it says where to go: a statement or text question left on
// Continue, or a choice question with no arrows at all. A branching question names its
// fall-through on each answer's select instead.
export const hasImplicitExit = (q) =>
  !!q && !q.retired && (isChoice(q) ? !isBranching(q) : routeOf(q.goTo) == null);

// The select's label for a stored route it no longer offers — a target moved above this block, the
// block itself, a block since removed — so it shows the truth rather than its first choice. The
// compiler's message under it says what to do.
export const staleRouteLabel = (questions, index, value) => {
  const at = (questions || []).findIndex((q) => q && !q.retired && q.key === value);
  if (at === -1) return 'A removed block (pick another)';
  if (at === index) return 'This block itself (pick another)';
  return `${targetLabel(questions, at)} (comes earlier: pick another)`;
};

// The compiler's live preview: the questions as the server will store them (surveyIssues hands it
// the blocks as Save sends them, blocksAsSaved), its errors mapped to the card (position) and, for
// an answer's route, the answer (option id; Other is OTHER_ID) they belong to, and the index the
// "Reached when" lines are worded from.
export const previewRouting = (questions) => {
  const keyed = withDraftKeys(questions);
  const { questions: compiled, errors } = compileRouting(keyed);
  // A later duplicate key wins, the reading the compiler gives one.
  const indexByKey = new Map();
  keyed.forEach((q, i) => {
    if (q && !q.retired) indexByKey.set(q.key, i);
  });
  const byIndex = keyed.map(() => ({ block: [], options: new Map() }));
  for (const e of errors) {
    const at = byIndex[indexByKey.get(e.key)];
    if (!at) continue;
    if (e.optionId == null) at.block.push(e.message);
    else if (!at.options.has(e.optionId)) at.options.set(e.optionId, e.message);
  }
  return { compiled, errors, byIndex, conditionIndex: buildConditionIndex(compiled) };
};

// "Reached when Q1 = “Undecided” or …" under a gated block in Script flow: the compiled rule in the
// shared wording, so what the author reads is what the server will store. null when the block is
// reached on every path.
export const reachedWhen = (routing, index) =>
  routing
    ? formatVisibleIf(routing.compiled[index], routing.conditionIndex, { prefix: 'Reached when' })
    : null;

export const SKIP_ENDS_WARNING =
  'If the canvasser skips this question the conversation ends there. Mark it Required or add a “Declined to say” answer.';

// A BRANCHING question needs an answer to know where to go: skipped, it reaches nothing and the
// path ends at the default closing. A plain question (no arrows) never needs this: it carries on
// either way (compiler rule 2). A warning, never a block on Save.
export const branchingWarning = (q) =>
  !!q && !q.retired && !q.required && isBranching(q) ? SKIP_ENDS_WARNING : null;

// ---- Edits -------------------------------------------------------------------------------------

// Retiring or removing a block a route points at: every route into it, on any block or answer
// (retired ones and Other's included), goes back to Continue ('' — what the select stores), and the
// count lets the builder say so in one line instead of leaving a jump to nowhere. The block's own
// routes leave or retire with it.
export const repointRoutes = (questions, key) => {
  const list = questions || [];
  if (!key) return { questions: list, count: 0 };
  let count = 0;
  const into = (value) => {
    if (value !== key) return false;
    count += 1;
    return true;
  };
  const next = list.map((q) => {
    if (!q || q.key === key) return q;
    let out = q;
    if (into(q.goTo)) out = { ...out, goTo: '' };
    if (into(q.otherGoTo)) out = { ...out, otherGoTo: '' };
    if (Array.isArray(q.options) && q.options.some((o) => o && o.goTo === key)) {
      out = { ...out, options: q.options.map((o) => (o && into(o.goTo) ? { ...o, goTo: '' } : o)) };
    }
    return out;
  });
  return { questions: next, count };
};

// Switch back undoes Go to, rather than converting it, on a survey saved in Show only if: its
// arrows were never saved, so its phones still run its stored conditions, and compiling the arrows
// would turn what they implied — an optional question's skip ending the conversation included —
// into new conditions on blocks that had none. A survey saved in Go to, and a new one, convert.
export const switchBackUndoes = (loaded) => !!loaded && flowOf(loaded) !== 'script';

// The banner's "Switch back to Show only if" (§F); the caller stores flow 'list'. `loaded` is the
// template as the builder opened it, null for a new survey. Every route is cleared, retired
// answers' included, so a later Restore can't revive one, and each live block's condition becomes:
//   undo     the one it was opened with (none for a block added since), so the phone shows
//            exactly what it showed before. Nothing can stop an undo.
//   convert  the one its arrows compile to, now an ordinary editable condition, so the phone
//            evaluates the very same conditions and recording cannot change. With compile errors
//            those are only a preview, so nothing switches and the caller shows the first message.
//            The caller mints a key for every keyless card first: a condition names its question
//            by key.
// "Nothing is ever lost" has one more case either way: a block still carrying a hand condition (a
// List survey that just got its first arrow) keeps that condition.
export const switchBack = (questions, loaded = null) => {
  const list = questions || [];
  const keepHand = (switched) =>
    switched.map((q, i) =>
      q && !q.retired && hasRules(list[i]?.visibleIf) ? { ...q, visibleIf: list[i].visibleIf } : q
    );
  if (switchBackUndoes(loaded)) {
    const opened = new Map(
      (loaded.questions || []).filter((q) => q && q.key).map((q) => [q.key, q.visibleIf])
    );
    const restored = clearRoutes(list).map((q) => {
      if (!q || q.retired) return q;
      const before = q.key ? opened.get(q.key) : null;
      return { ...q, visibleIf: hasRules(before) ? before : null };
    });
    return { questions: keepHand(restored), errors: [] };
  }
  const { questions: switched, errors } = switchToList(list);
  if (errors.length) return { questions: list, errors };
  return { questions: keepHand(switched), errors };
};

// A new statement or closing card ('statement' | 'closing'). A closing is added at the END of the
// list, and in Script flow it starts on End rather than Continue: on Continue, the next block added
// after it would follow the goodbye (the fall-through trap). In List flow no block may carry a route
// at all (the server refuses one, and a route would switch the survey to Go to), so it has none.
export const blankStatement = (role, flow) => ({
  key: '',
  label: '',
  type: 'statement',
  role,
  title: null,
  note: null,
  links: [],
  goTo: role === 'closing' && flow === 'script' ? END_KEY : null,
  otherGoTo: null,
  options: [],
  required: false,
  order: 0,
  retired: false,
  visibleIf: null,
  otherOption: false,
  refusalOption: false,
});

const trimOrNull = (s) => (typeof s === 'string' && s.trim() ? s.trim() : null);

// One block as Save sends it (`key` already minted by the caller). Choice questions keep
// text-bearing and retired options, dropping brand-new blank ones; stable ids round-trip untouched
// and per-option script and tag trim to null. Routes travel as null or a key: a choice question
// routes only through its answers (a question-level route there is a 400), and Other's route only
// while Other is on. In Script flow every visibleIf goes as null: the server compiles the routes
// and its result is the one stored. A statement records nothing, so it goes with no options, never
// required, no Other; a question carries no role.
export const cleanBlock = (q, { key, flow }) => {
  const choice = isChoice(q);
  const options = choice
    ? (q.options || [])
        .map((o) => ({
          ...o,
          text: (o.text || '').trim(),
          script: trimOrNull(o.script),
          tag: trimOrNull(o.tag),
          goTo: routeOf(o.goTo),
        }))
        .filter((o) => o.text || o.retired)
    : [];
  const visibleIf = flow === 'script' ? null : hasRules(q.visibleIf) ? q.visibleIf : null;
  const links = (Array.isArray(q.links) ? q.links : [])
    .map((l) => ({ label: (l?.label || '').trim(), url: (l?.url || '').trim() }))
    .filter((l) => l.url);
  // What a type change cleared, kept on the card for going back (restoredOnRetype), is the builder's
  // alone: never sent.
  const { retyped, ...card } = q;
  const block = {
    ...card,
    key,
    options,
    visibleIf,
    title: trimOrNull(q.title),
    note: trimOrNull(q.note),
    links,
    goTo: choice ? null : routeOf(q.goTo),
    otherGoTo: choice && q.otherOption ? routeOf(q.otherGoTo) : null,
  };
  if (isStatement(q)) {
    return {
      ...block,
      role: isClosingBlock(q) ? 'closing' : 'statement',
      options: [],
      required: false,
      otherOption: false,
      refusalOption: false,
    };
  }
  const { role, ...question } = block;
  return question;
};

// The blocks exactly as Save sends them (cleanBlock), keys aside: Save mints the missing ones, and
// nothing that reads this needs a key a card doesn't have yet (previewRouting stands one in). The
// live compile, the skip warnings, the "Reached when" and "Continues to" lines and One block per
// screen all read the survey through this, so none of them can count what Save drops: above all,
// an arrow on an answer whose text hasn't been typed yet.
export const blocksAsSaved = (questions, flow) =>
  (questions || []).map((q) => (q ? cleanBlock(q, { key: q.key, flow }) : q));

// ---- Everything checked as the author types ----------------------------------------------------

export const NO_ANSWERABLE =
  'Add at least one question that records an answer. Statements and closings are read aloud and record nothing.';

// One block's live problems, keyed by where its card shows them:
//   label, title, note   a message for that field
//   links                one message (or null) per link row
//   option               { [optionId]: { text?, script?, route? } }
//   other                the Other (specify) row's route
//   route                [messages] about the block's own route or what leads to it
//   condition            the hand condition (List flow: ruleError; Script flow: handRuleError)
const blockIssues = (questions, index, flow, routing) => {
  const q = questions[index];
  const out = {};
  if (!q || q.retired) return out;
  const put = (field, message) => {
    if (message) out[field] = message;
  };
  put('label', isStatement(q) ? scriptTextError(q.label) : plainTextError(q.label, 'A question'));
  put('title', plainTextError(q.title, 'A title'));
  put('note', scriptTextError(q.note));
  const links = Array.isArray(q.links) ? q.links.map(linkError) : [];
  if (links.some(Boolean)) out.links = links;
  const routes = routing ? routing.byIndex[index] : null;
  if (isChoice(q)) {
    const option = {};
    for (const o of q.options || []) {
      if (!o || o.retired) continue;
      const e = {};
      const text = plainTextError(o.text, 'An answer');
      const script = scriptTextError(o.script);
      const route = routes ? routes.options.get(o.id) : null;
      if (text) e.text = text;
      if (script) e.script = script;
      if (route) e.route = route;
      if (Object.keys(e).length) option[o.id] = e;
    }
    if (Object.keys(option).length) out.option = option;
    if (routes && routes.options.has(OTHER_ID)) out.other = routes.options.get(OTHER_ID);
  }
  if (routes && routes.block.length) out.route = routes.block;
  put('condition', flow === 'script' ? handRuleError(q, flow) : ruleError(q, index, questions));
  return out;
};

// Everything the builder checks without waiting for Save, so the card in front of the author and
// the Save button can never disagree: per-block problems (blockIssues, aligned with `questions`),
// the greeting's and default closing's placeholders, the one-answerable-question rule, the
// branching warnings (which never block Save) and, in Script flow, the compile preview the cards'
// "Reached when" lines read. Blank text is the one thing that waits (emptyIssues). The compile and
// the warnings read the blocks as Save sends them, so an arrow on an answer with no text yet
// counts nowhere until the answer has text, exactly as on the server.
export const surveyIssues = ({ intro, closing, questions, flow }) => {
  const list = questions || [];
  const saved = blocksAsSaved(list, flow);
  const routing = flow === 'script' ? previewRouting(saved) : null;
  const live = liveBlocks(list);
  return {
    intro: scriptTextError(intro),
    closing: scriptTextError(closing),
    // The server's rule (lacksAnswerableQuestion): live blocks, and not one of them a question.
    // A survey whose every block was retired stays saveable, as it always was, and an empty list
    // has its own message.
    noAnswerable: live.length > 0 && !live.some(isAnswerable) ? NO_ANSWERABLE : null,
    blocks: list.map((q, i) => blockIssues(list, i, flow, routing)),
    warnings: saved.map(branchingWarning),
    routing,
  };
};

// The blanks Save refuses. They wait for a Save attempt instead of showing live, so a card the
// author has just added doesn't open in red: a question with no label, a choice question with no
// answer, a statement with nothing to read aloud.
export const emptyIssues = (q) => {
  const out = {};
  if (!q || q.retired) return out;
  if (isStatement(q)) {
    if (!(q.label || '').trim()) out.label = 'Type what the canvasser reads aloud.';
    return out;
  }
  if (!(q.label || '').trim()) out.label = 'This question needs a label.';
  if (isChoice(q) && !(q.options || []).some((o) => !o.retired && (o.text || '').trim())) {
    out.options = 'Add at least one answer option.';
  }
  return out;
};

export const hasBlockingIssues = (issues) =>
  !!issues &&
  !!(
    issues.intro ||
    issues.closing ||
    issues.noAnswerable ||
    (issues.blocks || []).some((b) => b && Object.keys(b).length > 0)
  );
