// The pure half of Door Outcomes → Edit answers… (docs/PROPOSAL_SURVEY_ANSWER_EDITS.md): the form's
// state → the plan the server validates, the "Take out just …" shortcut an answer filter implies,
// the review's sentences and the run row's state. No React, no fetch — pinned by
// answerEditPlan.test.js. The server re-validates every plan (services/canvass/answerEdit.js), so
// nothing here is the safety; it is what makes the screens say exactly what the server will do.

export const OTHER_OPTION_ID = '__other__';

// One question's choice on the form.
//   mode 'leave'   — Leave as recorded (the default)
//   mode 'clear'   — Clear the answer / Clear every pick
//   mode 'set'     — Change it to … (pick one): setTo is one live option id
//   mode 'takeOut' — Take out picks (pick several): take is the picks' keys (an option id, or
//                    `text:<old answer>` for an old answer that matches no option); replaceWith is
//                    one live option id or ''
export const LEAVE = { mode: 'leave', setTo: '', take: [], replaceWith: '' };

const TEXT_KEY = 'text:';
/** The form's key for one pick the dry run reported: its option id, or its old text. */
export const pickKey = (pick) => (pick.id ? pick.id : `${TEXT_KEY}${pick.label}`);

/** Is this question's choice complete enough to send? */
export const choiceReady = (q, c) => {
  if (!c || c.mode === 'leave') return false;
  if (c.mode === 'clear') return true;
  if (c.mode === 'set') return q.type === 'single_choice' && !!c.setTo;
  if (c.mode === 'takeOut') return q.type === 'multiple_choice' && (c.take || []).length > 0;
  return false;
};

/** Review changes stays disabled until some question is set to something other than Leave. */
export const canReview = (questions, form) =>
  (questions || []).some((q) => choiceReady(q, form?.[q.key])) &&
  (questions || []).every((q) => {
    const c = form?.[q.key];
    return !c || c.mode === 'leave' || choiceReady(q, c);
  });

/** The bulk plan the create call sends: one entry per question not left as recorded. */
export const planFromForm = (questions, form) => {
  const plan = [];
  for (const q of questions || []) {
    const c = form?.[q.key];
    if (!choiceReady(q, c)) continue;
    if (c.mode === 'clear') plan.push({ questionKey: q.key, op: 'clear' });
    else if (c.mode === 'set') plan.push({ questionKey: q.key, op: 'set', optionIds: [c.setTo] });
    else {
      const take = c.take || [];
      plan.push({
        questionKey: q.key,
        op: 'adjust',
        remove: take.filter((k) => !k.startsWith(TEXT_KEY)),
        removeTexts: take.filter((k) => k.startsWith(TEXT_KEY)).map((k) => k.slice(TEXT_KEY.length)),
        replaceWith: !q.retired && c.replaceWith ? [c.replaceWith] : [],
      });
    }
  }
  return plan;
};

/**
 * What the page's answer filter says to take out: for each pick-several question it filters, the
 * picks it names that these surveys actually hold. The Survey Explorer's "Correct in Door Outcomes"
 * link arrives this way, so the form can offer one button: "Take out just Candidate Follow-Up and
 * Volunteer Request".
 */
export const suggestedTakeOut = (questions, answerFilters) => {
  const out = [];
  for (const f of answerFilters || []) {
    const q = (questions || []).find((x) => x.key === f.questionKey);
    if (!q || q.type !== 'multiple_choice') continue;
    const held = new Set((q.picks || []).map(pickKey));
    const wanted = [...new Set([...(f.values || []), ...(f.texts || []).map((t) => `${TEXT_KEY}${t}`)])].filter((k) => held.has(k));
    if (wanted.length) out.push({ questionKey: q.key, take: wanted });
  }
  return out;
};

const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const n = (x) => Number(x || 0).toLocaleString();
const surveys = (x) => `${n(x)} ${x === 1 ? 'survey' : 'surveys'}`;

/** The label of a pick for one question: its option text, the write-in, or `old answer "…"`. */
export const pickLabel = (q, key) => {
  if (key.startsWith(TEXT_KEY)) return `old answer "${key.slice(TEXT_KEY.length)}"`;
  if (key === OTHER_OPTION_ID) return 'Other';
  return (q?.options || []).find((o) => o.id === key)?.text || key;
};

/** The button text for a suggestion: "Take out just Candidate Follow-Up and Volunteer Request". */
export const suggestionLabel = (q, take) => `Take out just ${andList(take.map((k) => pickLabel(q, k)))}`;

/**
 * The review's plain sentences, from the priced dry run — Part 1's point 6, in numbers someone can
 * check against what they saw:
 *   "Taking out Volunteer Request from 139 surveys and Candidate Follow-Up from 97. That's 214
 *    surveys: 22 had both. 202 are left with no answer, as if skipped; 12 keep Yard Sign Delivered."
 */
export const reviewSentences = (price) => {
  const out = [];
  for (const q of price?.byQuestion || []) {
    const parts = [];
    if (q.removed?.length) {
      const [first, ...rest] = q.removed;
      const tail = rest.map((r) => `${r.label} from ${n(r.surveys)}`);
      parts.push(`Taking out ${first.label} from ${surveys(first.surveys)}${tail.length ? ` and ${andList(tail)}` : ''}.`);
      const shared = q.multi
        ? q.removed.length === 2
          ? ` ${n(q.multi)} had both.`
          : ` ${n(q.multi)} had more than one.`
        : '';
      if (q.removed.length > 1 || q.multi) parts.push(`That's ${surveys(q.surveys)}:${shared}`);
      const keep = q.surveys - q.leftBlank;
      const kept = (q.kept || []).map((k) => k.label);
      const blankLine = q.leftBlank ? `${n(q.leftBlank)} ${q.leftBlank === 1 ? 'is' : 'are'} left with no answer, as if skipped` : '';
      const keepLine = keep > 0 ? `${n(keep)} keep${keep === 1 ? 's' : ''} ${kept.length ? andList(kept) : 'their other picks'}` : '';
      const tailLine = [blankLine, keepLine].filter(Boolean).join('; ');
      if (tailLine) parts.push(`${tailLine}.`);
      for (const a of q.added || []) parts.push(`${a.label} goes in on ${surveys(a.surveys)}.`);
    } else if (q.setTo?.length) {
      parts.push(`Changing ${q.label} to ${andList(q.setTo.map((s) => `${s.label} on ${surveys(s.surveys)}`))}.`);
    } else if (q.surveys) {
      parts.push(`Clearing ${q.label} on ${surveys(q.surveys)}.`);
    }
    if (parts.length) out.push({ questionKey: q.questionKey, label: q.label, text: parts.join(' ') });
  }
  return out;
};

/** "Recorded by: Cara Canvasser (214), Otto Other (3)." */
export const recordedByLine = (price) => {
  const list = (price?.recordedBy || []).map((r) => `${r.name} (${n(r.surveys)})`);
  return list.length ? `Recorded by: ${list.join(', ')}.` : '';
};

// Why surveys are left as they are, in the review's words. Only the reasons that apply are shown.
export const LEFT_REASONS = {
  not_answered: 'no answer to change',
  already_blank: 'no answer to change',
  same_answer: 'already that answer',
  no_matching_picks: 'had none of the picks you’re taking out',
  legacy_answer: 'an old answer this tool can’t safely adjust',
};

/** The "Left as they are" lines: [{ count, text }], only the ones that apply. */
export const leftAsTheyAre = (dry) => {
  const out = [];
  const merged = {};
  for (const [reason, count] of Object.entries(dry?.price?.unchanged || {})) {
    const text = LEFT_REASONS[reason] || reason;
    merged[text] = (merged[text] || 0) + count;
  }
  for (const [text, count] of Object.entries(merged)) out.push({ count, text });
  if (dry?.notMatched) out.push({ count: dry.notMatched, text: 'people at the same visits who didn’t match your filter' });
  if (dry?.outsideDates) out.push({ count: dry.outsideDates, text: 'taken outside your dates' });
  if (dry?.otherSurvey) out.push({ count: dry.otherSurvey, text: 'recorded under another survey' });
  if (dry?.matchedNotSelected) {
    out.push({
      count: dry.matchedNotSelected,
      text: 'more surveys matched at visits whose latest survey falls after your dates — widen the dates to include them',
    });
  }
  if (dry?.heldByRuns) {
    out.push({
      count: dry.heldByRuns,
      text: `${dry.heldByRuns === 1 ? 'entry' : 'entries'} an earlier change converted aren’t included — undo that change first, or edit those surveys on the voter’s profile`,
    });
  }
  return out.filter((r) => r.count > 0);
};

/** "139 Volunteer Request and 97 Candidate Follow-Up picks taken out" — the run row's second line. */
export const picksLine = (run) => {
  const removed = (run?.counts?.byOption || []).filter((o) => o.removed > 0).sort((a, b) => b.removed - a.removed);
  const added = (run?.counts?.byOption || []).filter((o) => o.added > 0).sort((a, b) => b.added - a.added);
  const parts = [];
  if (removed.length) parts.push(`${andList(removed.map((o) => `${n(o.removed)} ${o.label}`))} ${removed.length === 1 && removed[0].removed === 1 ? 'pick' : 'picks'} taken out`);
  if (added.length) parts.push(`${andList(added.map((o) => `${n(o.added)} ${o.label}`))} put in`);
  return parts.join(' · ');
};

const WAIT_MS = 10 * 60 * 1000;

/**
 * The run row's state and its buttons — Part 1's table (Design §4). One owner, so the list row and
 * the live card can't disagree. Returns { key, label, tone, actions } with actions from
 * 'startAgain' | 'details' | 'undo' | 'undoAgain' | 'retryUndo' | 'pickUp' | 'undoLanded' |
 * 'resume' | 'stopHere'.
 */
export const runState = (run, now = Date.now()) => {
  if (!run) return null;
  const c = run.counts || {};
  const undo = run.undo || {};
  const s = undo.summary;
  if (run.mode === 'queue' && run.status === 'open') {
    return { key: 'open', label: `Unfinished — ${n(c.surveysChanged)} changed · ${n(run.cursor)} of ${n(run.progress?.total)} reviewed`, tone: 'neutral', actions: ['resume', 'stopHere'] };
  }
  if (undo.status === 'pending' || undo.status === 'running') {
    if (undo.status === 'pending' && undo.waitingForWorker) return { key: 'undoWaiting', label: 'Undo waiting for the worker', tone: 'neutral', actions: ['startAgainUndo'] };
    return { key: 'undoing', label: 'Undoing…', tone: 'neutral', actions: [] };
  }
  if (undo.status === 'failed') return { key: 'undoStopped', label: 'Undo stopped', tone: 'danger', actions: ['retryUndo'] };
  if (undo.status === 'done' && s) {
    const held = (s.waiting || 0) + (s.cleared || 0);
    const kept = s.changedSince || 0;
    if (held) {
      return { key: 'partlyUndone', label: `Partly undone · ${n(s.putBack)} put back · ${n(held)} waiting on a later change`, tone: 'neutral', actions: ['details', 'undoAgain'] };
    }
    if (kept) {
      return { key: 'undoneExcept', label: `Undone · ${n(s.putBack)} put back · ${n(kept)} kept newer answers`, tone: 'neutral', actions: ['details', 'undoAgain'] };
    }
    return { key: 'undone', label: `Undone · ${n(s.putBack)} put back`, tone: 'neutral', actions: ['details'] };
  }
  if (run.status === 'pending') {
    return run.waitingForWorker || now - new Date(run.createdAt).getTime() > WAIT_MS
      ? { key: 'waitingWorker', label: 'Waiting for the worker', tone: 'neutral', actions: ['startAgain'] }
      : { key: 'waiting', label: 'Waiting to start', tone: 'neutral', actions: [] };
  }
  if (run.status === 'running') {
    return { key: 'running', label: `Working · ${n(run.progress?.done)} of ${n(run.progress?.total)} surveys`, tone: 'neutral', actions: [] };
  }
  if (run.status === 'failed') {
    return { key: 'stopped', label: `Stopped · ${n(c.surveysChanged)} of ${n(c.surveysTargeted)} changed`, tone: 'danger', actions: ['details', 'pickUp', 'undoLanded'] };
  }
  return { key: 'done', label: `${surveys(c.surveysChanged)} changed`, tone: 'success', actions: ['details', 'undo'] };
};

/** An empty pick-several reads "—" wherever an answer is printed, never as a blank. */
export const answerText = (a) => {
  const v = a?.answer;
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return v == null || v === '' ? '—' : String(v);
};

/** Has a run settled (nothing for a worker to do until the admin acts)? The poll stops there. */
export const isAnswerEditSettled = (run) =>
  !!run && !['pending', 'running'].includes(run.status) && !['pending', 'running'].includes(run.undo?.status);
