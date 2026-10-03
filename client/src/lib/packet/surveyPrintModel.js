import { asciiSafe } from '../pdfText.js';
import { buildConditionIndex, formatVisibleIf, optionText, quote } from '../surveyConditionText.js';
import { fillScript } from '../surveyScriptText.js';
import {
  END_KEY, blockName, isAnswerable, isBranching, isChoice, isClosingBlock, isStatement, resolveDefaultTarget,
} from '../surveyRouting.js';

// Turns a survey template into something a person can fill in with a pen.
//
// Conditional logic is printable at all because validateVisibleIfIntegrity (routes/admin/surveys.js) guarantees every
// visibleIf rule points at a STRICTLY EARLIER non-retired question. That makes the condition
// graph a DAG in authoring order, so the form is one top-to-bottom column and a skip
// instruction can only ever point FORWARD — never back up the page.
//
// The pen verbs diverge from SurveyPreview.jsx's on-screen hints on purpose: a screen says
// what a control does ("select one"), paper says what to DO with the pen ("Circle one").
//
// A scripted survey adds blocks a canvasser reads instead of asks: statements and closings
// (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §I). None of them prints beside a door. Each prints ONCE
// on the "What to say" page with its "Only if" gate, and the door questions are numbered over
// the answerable blocks only, as the builder numbers them, so a statement never takes a Q number
// the phone would not show. In Script flow each answer prints the arrow it follows ("-> Q5",
// "-> Close 2", "-> End"), and those only point forward too: the compiler refuses a route to an
// earlier block. A canvasser note never prints (ruling 10), so nothing here reads one, whatever
// a payload carries.

export const PEN_VERB = {
  single_choice: 'Circle one',
  multiple_choice: 'Check all that apply',
  text: 'Write in',
};

// The "Only if Q2 = "Definitely" or "Probably"" label printed above a gated block is worded
// by surveyConditionText.js, shared with the builder and the preview so no two surfaces word one
// gate differently. Paper passes asciiSafe; the screens must not (it drops non-Latin text).

// The negation, for the "→ If …, skip to Qn" line printed under the PARENT question. The
// option ids in a rule belong to the PARENT's option list, so that is what resolves them.
const negate = (rule, parent) => {
  const opts = (rule.optionIds || []).map((id) => quote(optionText(parent, id), asciiSafe));
  switch (rule.op) {
    case 'is':
    case 'any_of':
      return opts.length ? `If not ${opts.join(' or ')}` : null;
    case 'is_not':
      return opts.length ? `If ${opts.join(' or ')}` : null;
    case 'answered':
      return 'If unanswered';
    case 'not_answered':
      return 'If answered';
    default:
      return null;
  }
};

const sameGate = (a, b) => JSON.stringify(a?.visibleIf || null) === JSON.stringify(b?.visibleIf || null);

// Script text is filled with NO name: a packet is not personal to one canvasser and never prints
// a canvasser's name (docs/WALK_PACKETS.md), so `{{canvasser}}` prints as the blank line and the
// volunteer says their own. Script text only: a question's label and an answer's text may hold no
// placeholder at all, so those are folded and never filled.
const paperScript = (text) => asciiSafe(fillScript(text, { canvasserFirstName: null }));

// A stored route: null and '' both mean "continue to the following block", the way
// surveyRouting.js reads them (a cleared select sends '').
const routeOf = (value) => (value == null || value === '' ? null : value);

const liveOptions = (q) => (Array.isArray(q.options) ? q.options : []).filter((o) => o && !o.retired);

// Paper cannot be tapped, so a link prints as its address, after the label the author gave it.
// http(s) only, the save check's own rule, so no payload can put another scheme on paper.
const paperLinks = (links) =>
  (Array.isArray(links) ? links : [])
    .filter((l) => l && /^https?:\/\//i.test(String(l.url || '')))
    .map((l) => ({ label: l.label ? asciiSafe(l.label) : null, url: asciiSafe(l.url) }));

const hasTitle = (q) => String(q?.title ?? '').trim() !== '';

// Where an arrow lands, named the way paper can find it: a question by its printed number, a
// statement or closing by its title, else by the opening words of its text in quotes (blockName,
// never the whole body), so a bare excerpt never reads as an instruction of its own; and the end
// of the conversation as End. null for a key that names no printed block: the save check refuses
// such a route, and no arrow beats a wrong one.
const arrowTo = (key, index) => {
  if (key === END_KEY) return 'End';
  const block = index.byKey.get(key);
  if (!block || block.retired) return null;
  if (isStatement(block)) return hasTitle(block) ? asciiSafe(blockName(block)) : quote(blockName(block), asciiSafe);
  const n = index.numberByKey.get(key);
  return n ? `Q${n}` : null;
};

// payload survey -> printable questions, each carrying its printed number, pen verb, option
// labels and gate label, plus either a forward-skip instruction on the parent (List flow) or
// arrows saying where the conversation goes next (Script flow); and the "What to say" sequence.
export const buildSurveyPrintModel = (survey) => {
  // Retired blocks never reach paper (buildPacket.js drops them), and statements never print
  // beside a door, so the door form is the answerable blocks alone.
  const blocks = (survey?.questions || []).filter((q) => q && !q.retired);
  const questions = blocks.filter(isAnswerable);
  if (!questions.length) return null;

  // A payload from before Script flow carries no flow, which reads as List flow.
  const scripted = survey.flow === 'script';
  // Numbers the answerable blocks 1..N, the builder's numbering (a statement takes none); byKey
  // keeps the statements, so an arrow (or a stray rule) that names one still reads by name.
  const index = buildConditionIndex(blocks);
  const paperGate = (q) => formatVisibleIf(q, index, { transform: asciiSafe, prefix: 'Only if' });
  // Where a route from block q lands: its own target, else the block after it.
  const landing = (q, route) => routeOf(route) ?? resolveDefaultTarget(blocks, q.key);

  const out = questions.map((q, i) => {
    // Script flow, a BRANCHING question: every answer prints the arrow it follows, a
    // fall-through one included, because a row where some answers point somewhere and the rest
    // say nothing reads as unfinished. Other (specify) follows otherGoTo. The legacy Refused
    // bubble routes nowhere (the app cannot record it), so it never gets one.
    const branching = scripted && isBranching(q);
    const withArrow = (option, route) =>
      (branching ? { ...option, arrow: arrowTo(landing(q, route), index) } : option);
    const options = liveOptions(q).map((o) => withArrow({ id: o.id, text: asciiSafe(o.text) }, o.goTo));
    // otherOption and refusalOption are stored as flags, not as rows in `options` — they
    // have to be materialised or the paper is missing choices the app offers.
    if (q.otherOption) options.push(withArrow({ id: '__other__', text: 'Other:', writeIn: true }, q.otherGoTo));
    if (q.refusalOption) options.push({ id: '__refused__', text: 'Refused', muted: true });

    // Script flow, any other question goes one way whatever the answer: a text question to its
    // own goTo, a plain choice question to the block after it (a goTo on a choice question is
    // refused at save and never followed). That earns a line only when it is not simply the
    // next question down the page.
    let arrow = null;
    if (scripted && !branching) {
      const to = isChoice(q) ? landing(q, null) : landing(q, q.goTo);
      if (to !== (questions[i + 1]?.key ?? END_KEY)) arrow = arrowTo(to, index);
    }

    return {
      key: q.key,
      number: i + 1,
      label: asciiSafe(q.label),
      type: q.type,
      verb: PEN_VERB[q.type] || 'Answer',
      options,
      gate: paperGate(q),
      skipHint: null,
      arrow,
    };
  });

  // A gated RUN is 2+ consecutive questions sharing one condition. Worth a skip
  // instruction; a single gated question is not — the "Only if …" label already says it.
  // List flow only: in Script flow the arrows above already say where every answer goes.
  for (let i = 0; i < questions.length && !scripted; i++) {
    const q = questions[i];
    if (!q.visibleIf?.rules?.length) continue;
    if (i > 0 && sameGate(questions[i - 1], q)) continue; // mid-run, not the head

    let end = i;
    while (end + 1 < questions.length && sameGate(questions[end + 1], q)) end += 1;
    const runLength = end - i + 1;
    if (runLength < 2) continue;

    // Only when the question directly above the run is the one the rule references —
    // otherwise "if not" is ambiguous about which answer it means.
    const rules = q.visibleIf.rules;
    const prev = questions[i - 1];
    if (!prev || rules.length !== 1 || rules[0].questionKey !== prev.key) continue;

    const phrase = negate(rules[0], prev);
    if (!phrase) continue;
    const target = out[end + 1];
    out[i - 1].skipHint = target
      ? `${phrase}, skip to Q${target.number}`
      : `${phrase}, you're done with this person`;
  }

  // The "What to say" page, in the order the conversation runs: the opening; then, block by
  // block, a statement or closing with its gate, its links and (Script flow) where it goes next,
  // or the read-aloud lines under a question's answers; then the template's own closing. Script
  // belongs on ONE reference page, not repeated beside every voter — the same words 200 times is
  // what turns a packet into a phone book. Only what has something to print joins, so the page
  // has content exactly when this is non-empty.
  const intro = paperScript(survey.intro);
  const closing = paperScript(survey.closing);
  const script = [];
  if (intro) script.push({ kind: 'opening', text: intro });
  for (const q of blocks) {
    if (isStatement(q)) {
      const text = paperScript(q.label);
      const links = paperLinks(q.links);
      if (!text && !links.length) continue;
      script.push({
        kind: isClosingBlock(q) ? 'closing' : 'statement',
        key: q.key,
        title: hasTitle(q) ? asciiSafe(blockName(q)) : null,
        text,
        gate: paperGate(q),
        links,
        arrow: scripted ? arrowTo(landing(q, q.goTo), index) : null,
      });
      continue;
    }
    for (const o of liveOptions(q)) {
      if (!o.script) continue;
      script.push({ kind: 'option', question: asciiSafe(q.label), option: asciiSafe(o.text), text: paperScript(o.script) });
    }
  }
  if (closing) script.push({ kind: 'default-closing', text: closing });

  return {
    id: survey.id,
    name: asciiSafe(survey.name || ''),
    flow: scripted ? 'script' : 'list',
    intro,
    closing,
    // Once any closing block exists the template's closing is the FALLBACK, read only on a path
    // that reached none of them, and paper has to say so or a volunteer reads two goodbyes.
    closingIsFallback: blocks.some(isClosingBlock),
    questions: out,
    // The answers' read-aloud lines alone, in the shape this model has always had.
    scripts: script
      .filter((e) => e.kind === 'option')
      .map((e) => ({ question: e.question, option: e.option, script: e.text })),
    script,
  };
};
