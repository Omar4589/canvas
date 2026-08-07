import { asciiSafe } from '../pdfText.js';

// Turns a survey template into something a person can fill in with a pen.
//
// Conditional logic is printable at all because routes/admin/surveys.js:157 guarantees every
// visibleIf rule points at a STRICTLY EARLIER non-retired question. That makes the condition
// graph a DAG in authoring order, so the form is one top-to-bottom column and a skip
// instruction can only ever point FORWARD — never back up the page.
//
// The pen verbs diverge from SurveyPreview.jsx's on-screen hints on purpose: a screen says
// what a control does ("select one"), paper says what to DO with the pen ("Circle one").

export const PEN_VERB = {
  single_choice: 'Circle one',
  multiple_choice: 'Check all that apply',
  text: 'Write in',
};

const quote = (s) => `"${asciiSafe(s)}"`;

const optionText = (question, id) => {
  if (id === '__other__') return 'Other';
  const o = (question?.options || []).find((x) => x.id === id);
  return o ? o.text : id;
};

// One rule as a clause. `ref` is the referenced question; when it has been filtered out of
// the printed set (retired), fall back to its label so the sentence still reads.
const ruleClause = (rule, ref, refNumber) => {
  const name = refNumber ? `Q${refNumber}` : quote(ref?.label || rule.questionKey);
  const opts = (rule.optionIds || []).map((id) => quote(optionText(ref, id)));
  switch (rule.op) {
    case 'is':
      return `${name} = ${opts[0] || '…'}`;
    case 'is_not':
      return `${name} is not ${opts[0] || '…'}`;
    case 'any_of':
      return `${name} = ${opts.join(' or ') || '…'}`;
    case 'answered':
      return `${name} answered`;
    case 'not_answered':
      return `${name} not answered`;
    default:
      return name;
  }
};

// "Only if Q2 = "Definitely" or "Probably"" — the label printed above a gated block.
export const formatVisibleIf = (question, index) => {
  const rules = question?.visibleIf?.rules || [];
  if (!rules.length) return null;
  const join = question.visibleIf.logic === 'any' ? ' or ' : ' and ';
  const clauses = rules.map((r) => ruleClause(r, index.byKey.get(r.questionKey), index.numberByKey.get(r.questionKey)));
  return `Only if ${clauses.join(join)}`;
};

// The negation, for the "→ If …, skip to Qn" line printed under the PARENT question. The
// option ids in a rule belong to the PARENT's option list, so that is what resolves them.
const negate = (rule, parent) => {
  const opts = (rule.optionIds || []).map((id) => quote(optionText(parent, id)));
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

// payload survey -> printable questions, each carrying its printed number, pen verb,
// option labels, gate label, and (on the parent) a forward-skip instruction.
export const buildSurveyPrintModel = (survey) => {
  const questions = (survey?.questions || []).filter(Boolean);
  if (!questions.length) return null;

  const byKey = new Map(questions.map((q) => [q.key, q]));
  const numberByKey = new Map(questions.map((q, i) => [q.key, i + 1]));
  const index = { byKey, numberByKey };

  const out = questions.map((q, i) => {
    const options = (q.options || []).map((o) => ({ id: o.id, text: asciiSafe(o.text) }));
    // otherOption and refusalOption are stored as flags, not as rows in `options` — they
    // have to be materialised or the paper is missing choices the app offers.
    if (q.otherOption) options.push({ id: '__other__', text: 'Other:', writeIn: true });
    if (q.refusalOption) options.push({ id: '__refused__', text: 'Refused', muted: true });
    return {
      key: q.key,
      number: i + 1,
      label: asciiSafe(q.label),
      type: q.type,
      verb: PEN_VERB[q.type] || 'Answer',
      options,
      gate: formatVisibleIf(q, index),
      skipHint: null,
    };
  });

  // A gated RUN is 2+ consecutive questions sharing one condition. Worth a skip
  // instruction; a single gated question is not — the "Only if …" label already says it.
  for (let i = 0; i < questions.length; i++) {
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

  return {
    id: survey.id,
    name: asciiSafe(survey.name || ''),
    intro: asciiSafe(survey.intro || ''),
    closing: asciiSafe(survey.closing || ''),
    questions: out,
    // Option scripts belong on ONE reference page, not repeated beside every voter — the
    // same words 200 times is what turns a packet into a phone book.
    scripts: (survey.questions || [])
      .flatMap((q) =>
        (q.options || [])
          .filter((o) => o.script)
          .map((o) => ({
            question: asciiSafe(q.label),
            option: asciiSafe(o.text),
            script: asciiSafe(o.script),
          }))
      ),
  };
};
