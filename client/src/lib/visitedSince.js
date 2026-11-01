import { shiftDays } from './datePresets.js';
import { civilDaysBetween, shortDate } from './reportDerive.js';
import { STATUS_LABELS } from './statusColors.js';

// "Visited in the last N days" — Turf Cutting's Exclude doors line — and the "This round was last cut
// with …" offer that keeps a round's conditions from being dropped by a re-cut
// (docs/PROPOSAL_RECENT_VISITS.md). Pure: `today` comes in from todayInTz(the campaign's zone), so
// nothing here reads a clock, and the server applies the same civil day in the same zone.

export const DEFAULT_VISITED_DAYS = 7;
// The earliest day the row accepts: keeps a half-typed year (a native date input reports 0002 while you
// type 2026) from ever becoming the filter.
export const VISITED_FLOOR = '2020-01-01';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isCivilDay = (v) => typeof v === 'string' && DAY_RE.test(v) && shiftDays(v, 0) === v;

// undefined / null / '' are "no line" here and on the server.
export const hasVisitedLine = (side) => !!side && side.visitedSince != null && side.visitedSince !== '';

// "Last N days" is today plus the N-1 days before it — exactly the dashboards' "7 days" button.
export const daysToSince = (days, today) => shiftDays(today, -(Math.max(1, Math.round(days)) - 1));
export const sinceToDays = (day, today) => {
  const n = civilDaysBetween(day, today);
  return n == null ? null : n + 1;
};
export const maxDays = (today) => (civilDaysBetween(VISITED_FLOOR, today) ?? 0) + 1;
export const acceptableSince = (day, today) => isCivilDay(day) && day >= VISITED_FLOOR && day <= today;
export const sinceLabel = (day) => shortDate(day);

// One side of the panels holds a condition (statuses, answers, or the visited line).
export const sideHasConditions = (side) =>
  !!side && ((side.priorPassStatuses?.length || 0) > 0 || (side.answerFilters?.length || 0) > 0 || hasVisitedLine(side));
export const conditionsOn = (f) => sideHasConditions(f) || sideHasConditions(f?.exclude);

const list = (v) => (Array.isArray(v) ? v : []);
const cleanAnswers = (v) =>
  list(v)
    .filter((af) => af && typeof af.questionKey === 'string' && af.questionKey)
    .map((af) => ({ questionKey: af.questionKey, values: list(af.values), texts: list(af.texts) }))
    .filter((af) => af.values.length || af.texts.length);

// A round's stored conditions (Pass.targetFilter, or null) → the panels' state shape. Only the keys
// the panels can show survive; a missing `combine` becomes 'and', the resolver's default, so the meaning
// is kept; an empty Exclude side becomes null; a stored date is kept as it is (even one past "today":
// the admin's clock may be the wrong one).
export const targetFilterForPanels = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {};
  const ex = s.exclude && typeof s.exclude === 'object' ? s.exclude : {};
  const exclude = {
    priorPassStatuses: list(ex.priorPassStatuses).filter((x) => typeof x === 'string'),
    answerFilters: cleanAnswers(ex.answerFilters),
    ...(hasVisitedLine(ex) && typeof ex.visitedSince === 'string' ? { visitedSince: ex.visitedSince } : {}),
  };
  return {
    priorPassStatuses: list(s.priorPassStatuses).filter((x) => typeof x === 'string'),
    answerFilters: cleanAnswers(s.answerFilters),
    combine: s.combine === 'or' ? 'or' : 'and',
    exclude: sideHasConditions(exclude) ? exclude : null,
  };
};

const sortedJoin = (arr) => [...arr].map(String).sort().join('\u0001');
const answersKey = (afs) =>
  sortedJoin(afs.map((af) => `${af.questionKey}\u0002${sortedJoin(af.values)}\u0002${sortedJoin(af.texts)}`));

// Do two filters ask for the same doors? Order-insensitive. `combine` counts whenever the target side has
// two or more predicate sets — the statuses (one set) plus each answer question — because the resolver
// applies it across all of them (resolveWalkList.js), not only between statuses and answers.
export const sameConditions = (a, b) => {
  const x = targetFilterForPanels(a);
  const y = targetFilterForPanels(b);
  const sets = (f) => (f.priorPassStatuses.length ? 1 : 0) + f.answerFilters.length;
  if (sortedJoin(x.priorPassStatuses) !== sortedJoin(y.priorPassStatuses)) return false;
  if (answersKey(x.answerFilters) !== answersKey(y.answerFilters)) return false;
  if (sets(x) >= 2 && x.combine !== y.combine) return false;
  const xe = x.exclude || { priorPassStatuses: [], answerFilters: [] };
  const ye = y.exclude || { priorPassStatuses: [], answerFilters: [] };
  if (sortedJoin(xe.priorPassStatuses) !== sortedJoin(ye.priorPassStatuses)) return false;
  if (answersKey(xe.answerFilters) !== answersKey(ye.answerFilters)) return false;
  return (xe.visitedSince || null) === (ye.visitedSince || null);
};

// ── Survey answers the current survey no longer has ──────────────────────────────────────────────
// `questions` are the survey-results questions the panels list ([{ key, label, options }]); AnswerFilters
// selects by option id, or by text for an option without one. A stored answer whose question — or whose
// option — isn't among them still counts in a cut, but no chip shows it, and AnswerFilters rebuilds its
// value from the options it knows, so the next click would drop it. `questions` is null until the
// survey has loaded — nothing is judged then; an empty list means it loaded and has none.
const optionKey = (o) => (typeof o === 'string' ? o : o?.id != null ? o.id : o?.option);
const knownKeys = (questions) =>
  new Map(list(questions).map((q) => [q.key, new Set(list(q.options).map(optionKey).filter((k) => k != null))]));

export const orphanAnswers = (answerFilters, questions) => {
  if (questions == null) return [];
  const known = knownKeys(questions);
  return cleanAnswers(answerFilters)
    .map((af) => {
      const keys = known.get(af.questionKey) || new Set();
      return { questionKey: af.questionKey, values: af.values.filter((v) => !keys.has(v)), texts: af.texts.filter((t) => !keys.has(t)) };
    })
    .filter((af) => af.values.length || af.texts.length);
};
export const orphanCount = (answerFilters, questions) =>
  orphanAnswers(answerFilters, questions).reduce((n, af) => n + af.values.length + af.texts.filter((t) => !af.values.includes(t)).length, 0);

// AnswerFilters' next value, with the previous value's orphans put back (until the owner removes them).
export const withOrphans = (next, prev, questions) => {
  const orphans = orphanAnswers(prev, questions);
  if (!orphans.length) return next;
  const out = cleanAnswers(next).map((af) => ({ ...af }));
  for (const o of orphans) {
    const at = out.find((af) => af.questionKey === o.questionKey);
    if (at) {
      at.values = [...new Set([...at.values, ...o.values])];
      at.texts = [...new Set([...at.texts, ...o.texts])];
    } else out.push(o);
  }
  return out;
};
export const withoutOrphans = (answerFilters, questions) => {
  if (questions == null) return cleanAnswers(answerFilters);
  const known = knownKeys(questions);
  return cleanAnswers(answerFilters)
    .map((af) => {
      const keys = known.get(af.questionKey) || new Set();
      return { ...af, values: af.values.filter((v) => keys.has(v)), texts: af.texts.filter((t) => keys.has(t)) };
    })
    .filter((af) => af.values.length || af.texts.length);
};

// ── What a set of conditions says, in the owner's words ──────────────────────────────────────────
const statusWords = (statuses) => statuses.map((s) => STATUS_LABELS[s] || s).join(' or ');
const answerWords = (af, questions) => {
  const q = list(questions).find((x) => x.key === af.questionKey);
  if (!q) return 'a survey answer';
  const byKey = new Map(list(q.options).map((o) => [optionKey(o), typeof o === 'string' ? o : o?.option]));
  const picked = [...new Set([...af.values, ...af.texts])].map((k) => byKey.get(k)).filter(Boolean);
  return picked.length ? `${q.label}: ${picked.join(' or ')}` : 'a survey answer';
};
const andList = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// → { target, exclude } phrases (either may be null). Answers are named by their survey words once
// `questions` has loaded — two different answers must never read the same — else "a survey answer".
export const describeConditions = (filter, questions) => {
  const f = targetFilterForPanels(filter);
  const parts = [
    ...(f.priorPassStatuses.length ? [statusWords(f.priorPassStatuses)] : []),
    ...f.answerFilters.map((af) => answerWords(af, questions)),
  ];
  let target = null;
  if (parts.length === 1) target = parts[0];
  else if (parts.length > 1) target = `${f.combine === 'and' ? 'all' : 'any'} of: ${parts.join('; ')}`;
  let exclude = null;
  if (f.exclude) {
    const items = [
      ...(f.exclude.priorPassStatuses.length ? [`${statusWords(f.exclude.priorPassStatuses)} doors`] : []),
      ...f.exclude.answerFilters.map((af) => `doors answering ${answerWords(af, questions)}`),
      ...(hasVisitedLine(f.exclude) ? [`doors visited since ${sinceLabel(f.exclude.visitedSince)}`] : []),
    ];
    exclude = items.length ? andList(items) : null;
  }
  return { target, exclude };
};

// "This round was last cut with Not home, leaving out doors visited since Oct 25."
export const lastCutSentence = ({ target, exclude }) => {
  if (target && exclude) return `This round was last cut with ${target}, leaving out ${exclude}.`;
  if (target) return `This round was last cut with ${target}.`;
  if (exclude) return `This round was last cut leaving out ${exclude}.`;
  return 'This round was last cut with no conditions.';
};
// "Ticked now: Not home." — or null when both panels are empty.
export const tickedSentence = ({ target, exclude }) => {
  if (target && exclude) return `Ticked now: ${target}, leaving out ${exclude}.`;
  if (target) return `Ticked now: ${target}.`;
  if (exclude) return `Ticked now: leaving out ${exclude}.`;
  return null;
};

// ── The offer ────────────────────────────────────────────────────────────────────────────────────
// The line above the panels: the round is editable, it was last cut with conditions, and the panels
// hold different ones. A standing reminder — it stays while the owner edits.
export const lastConditionsDiffer = ({ editable, stored, panels }) =>
  !!editable && conditionsOn(targetFilterForPanels(stored)) && !sameConditions(stored, panels);

// Generate's question: the same, unless the owner has already answered it (or used "Use them again") on
// this round, against these same stored conditions. Keyed to the stored filter, so a restore of a
// different cut — or another admin's cut — asks again by itself, and nothing has to reset it.
export const askBeforeGenerate = ({ editable, stored, panels, acknowledged, roundKey }) =>
  lastConditionsDiffer({ editable, stored, panels }) &&
  !(acknowledged && acknowledged.round === roundKey && sameConditions(acknowledged.stored, stored));
