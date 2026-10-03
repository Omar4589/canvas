import { isOtherOptionId } from './surveyChoices.js';

// One plain-English wording for a survey condition, shared by every surface that shows one: the
// walk packet ("Only if …" above a gated question), the builder ("Reached when …" under a block
// in Script flow) and the preview ("Shown when …"). Three surfaces wording one gate three ways is
// how an author, a client and a canvasser end up disagreeing about what a survey does, so the
// words live here once and a surface picks only two things:
//
//   transform — applied to every piece of typed text: question labels, option labels, and the
//     quote marks around them. Paper passes asciiSafe (pdfText.js) because jsPDF's built-in faces
//     are cp1252-only. asciiSafe DROPS what it cannot fold, so a screen must never get it: a
//     Cyrillic or CJK option label would come out blank.
//   prefix — the leading words: 'Only if' on paper, 'Reached when' in the builder, 'Shown when'
//     in the preview. An empty prefix returns the bare clauses.
//
// Quote marks are typographic, the way the builder already quotes a label in its own messages,
// and asciiSafe folds them to straight ones, so the packet prints exactly the strings it printed
// before this module existed (packetPdf.test.js pins one).
//
// The wording follows the evaluator (surveyVisibility.js), not the builder's controls: logic
// 'any' reads as "or" and anything else as "and", and is / is_not name only the FIRST option id,
// because that is the only one the evaluator looks at.

const identity = (s) => s;
const str = (v) => (v == null ? '' : String(v));

// A typed name in quotes. The marks pass through the transform too; that is what turns them
// straight on paper.
export const quote = (text, transform = identity) => `${transform('“')}${transform(str(text))}${transform('”')}`;

// An option's label by id. Other (specify) is a flag on the question, not a row in `options`
// (surveyChoices.js), so it is named here. An id that no longer resolves names itself rather
// than dropping the clause.
export const optionText = (question, id) => {
  if (isOtherOptionId(id)) return 'Other';
  const o = (question?.options || []).find((x) => x && x.id === id);
  return o ? o.text : id;
};

// A block with no Q number is named instead: a question by its label; a statement by its title,
// else the opening of its read-aloud text, never the whole body, which can run to 5000
// characters. A rule may not target a statement, so that branch only meets hand-made or legacy
// data, but the builder renders this live and must not paint a page of script into one line.
const STATEMENT_NAME_CHARS = 60;
const blockName = (ref) => {
  if (ref?.type !== 'statement') return ref?.label;
  if (ref.title) return ref.title;
  const text = str(ref.label).replace(/\s+/g, ' ').trim();
  return text.length > STATEMENT_NAME_CHARS ? `${text.slice(0, STATEMENT_NAME_CHARS).trimEnd()}…` : text;
};

// One rule as a clause. `ref` is the question the rule reads and `refNumber` its Q number. With
// no number (retired, filtered out of the printed set) the clause names the question instead,
// and with no `ref` at all it falls back to the stored key, so the sentence still reads.
export const ruleClause = (rule, ref, refNumber, { transform = identity } = {}) => {
  const name = refNumber ? `Q${refNumber}` : quote(blockName(ref) || rule.questionKey, transform);
  const opts = (rule.optionIds || []).map((id) => quote(optionText(ref, id), transform));
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

// The whole gate as one line — Only if Q2 = “Definitely” or “Probably” — or null when the block
// has no condition. `index` is { byKey, numberByKey }, normally from buildConditionIndex.
export const formatVisibleIf = (question, index, { transform = identity, prefix = 'Only if' } = {}) => {
  const rules = (question?.visibleIf?.rules || []).filter(Boolean);
  if (!rules.length) return null;
  const join = question.visibleIf.logic === 'any' ? ' or ' : ' and ';
  const clauses = rules.map((r) =>
    ruleClause(r, index?.byKey?.get(r.questionKey), index?.numberByKey?.get(r.questionKey), { transform })
  );
  const text = clauses.join(join);
  return prefix ? `${prefix} ${text}` : text;
};

// The index formatVisibleIf reads. byKey holds EVERY keyed block, retired ones and statements
// included, so a rule pointing at one still reads by name. numberByKey numbers active blocks
// 1-based in list order — by default only the ones a canvasser answers, the scripted-survey
// numbering where a statement never takes a Q number (docs/PROPOSAL_SURVEY_SCRIPT_FLOW.md §G,
// §I); `numberAnswerableOnly: false` numbers statements too, the way every block was numbered
// before statements existed. A block with no key yet (a builder card whose label is still blank)
// cannot be referenced but still takes its number, or every later "Q3" would name the card
// after the one it means.
export const buildConditionIndex = (questions, { numberAnswerableOnly = true } = {}) => {
  const byKey = new Map();
  const numberByKey = new Map();
  let n = 0;
  for (const q of questions || []) {
    if (!q) continue;
    if (q.key) byKey.set(q.key, q);
    if (q.retired) continue;
    if (numberAnswerableOnly && q.type === 'statement') continue;
    n += 1;
    if (q.key) numberByKey.set(q.key, n);
  }
  return { byKey, numberByKey };
};
