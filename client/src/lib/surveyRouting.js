// MIRROR of server/src/services/surveys/routing.js — keep the body (everything
// below the marker) BYTE-IDENTICAL. Do not edit here without editing the canonical.
// A server drift-guard test (routing.test.js) fails CI if these diverge.
// ==== BEGIN MIRRORED BODY ====

// Why compile rather than walk a path on the phone: the arrows become the `visibleIf` rules the
// evaluator (visibility.js) already reads, so the evaluator stays byte-for-byte unchanged, every
// reader of stored answers keeps working, and a phone on an older bundle routes correctly — the
// compiled rules use only `any_of`, an op it already evaluates.
//
// A compiled condition says exactly "the conversation reached this block". The evaluator
// withholds a hidden block's answer from every later rule, so "Q4 is any of […]" already carries
// "and Q4 was reached", and a block reached several ways is a flat `any` of positive atoms with no
// nesting. Only `any_of` is ever emitted: `is_not` and `not_answered` are TRUE on a block that was
// never reached, and would leak a closing onto a branch that never asked the question.

// Where a route ends the conversation: the default closing (`template.closing`) is the last
// screen. Never a real key: every key generator strips leading underscores, and the save check
// refuses a hand-sent key or option id that starts with `__`.
export const END_KEY = '__end__';

// The synthetic "Other (specify)" pick: OTHER_OPTION_ID in otherOption.js, repeated rather than
// imported because this body takes no imports (routing.test.js pins the two equal).
export const OTHER_ID = '__other__';

export const isStatement = (q) => !!q && q.type === 'statement';

// Every block that is not a statement records an answer: single choice, multiple choice, text.
export const isAnswerable = (q) => !!q && q.type !== 'statement';

export const isChoice = (q) => !!q && (q.type === 'single_choice' || q.type === 'multiple_choice');

// `role` has no schema default and means nothing on a question, so the type is checked first.
export const isClosingBlock = (q) => isStatement(q) && q.role === 'closing';

// The live blocks in list order: the very filter visibility.js applies, so a position here is the
// position the evaluator sees.
const liveBlocks = (questions) =>
  (Array.isArray(questions) ? questions : []).filter((q) => q && !q.retired);

const liveOptions = (q) => (Array.isArray(q.options) ? q.options : []).filter((o) => o && !o.retired);

// A stored route: null (continue to the following live block), a later block's key, or END_KEY.
// An empty string is what a cleared select sends, so it reads as no route, never as a jump to a
// block that does not exist.
const routeOf = (value) => (value == null || value === '' ? null : value);

const NAME_LENGTH = 60;

const oneLine = (text) => (text == null ? '' : String(text).replace(/\s+/g, ' ').trim());

// Cut by characters, not UTF-16 units, so an emoji at the cut never splits into a broken glyph.
const clip = (text) => {
  const chars = Array.from(oneLine(text));
  if (chars.length <= NAME_LENGTH) return chars.join('');
  return `${chars.slice(0, NAME_LENGTH).join('').trimEnd()}…`;
};

// The short name every message, "then go to" select and "Continues to" line uses for a block:
// its title when it has one ("Close 2"), else the start of its text on one line. Never the full
// body: a statement's read-aloud text runs to 5000 characters. A block with neither (a card still
// being typed in the builder) reads as "Untitled …" rather than an empty pair of quotes.
export const blockName = (q) => {
  const title = oneLine(q && q.title);
  if (title) return title;
  const text = clip(q && q.label);
  if (text) return text;
  if (isClosingBlock(q)) return 'Untitled closing';
  return isStatement(q) ? 'Untitled statement' : 'Untitled question';
};

// A choice question BRANCHES when any live answer carries an arrow (END_KEY included), or Other
// (specify) does while it is on. It then needs an answer to know where to go: each picked answer
// routes, and an unanswered one routes nowhere. A PLAIN choice question (no arrows at all) behaves
// like today's linear surveys — the block after it is reached whenever it was reached, answered or
// not — which is why an optional question in the middle of a script never ends the conversation
// when skipped. Retired answers never count, and `otherGoTo` counts only while Other is on.
export const isBranching = (q) =>
  isChoice(q) &&
  (liveOptions(q).some((o) => routeOf(o.goTo) != null) ||
    (!!q.otherOption && routeOf(q.otherGoTo) != null));

// Does any live block carry an arrow the compiler follows? A question-level goTo on a choice
// question is not one: it is an error (compileRouting reports it), never a route.
export const hasActiveRoutes = (questions) =>
  liveBlocks(questions).some((q) => (isChoice(q) ? isBranching(q) : routeOf(q.goTo) != null));

// A survey that reads as a script: any live statement (closings are statements) or any live
// arrow. The builder turns on one block per screen (`presentation: 'steps'`) when this first
// becomes true. Whether the survey is in Script flow is `template.flow`, never this.
export const isScripted = (questions) =>
  liveBlocks(questions).some(isStatement) || hasActiveRoutes(questions);

// Where a block's fall-through goes, for the builder's grey "Continues to" line: the next LIVE
// block after it (retired blocks are skipped), or END_KEY after the last one. null when `key` is
// not a live block — a retired block routes nowhere.
export const resolveDefaultTarget = (questions, key) => {
  const live = liveBlocks(questions);
  const i = live.findIndex((q) => q.key === key);
  if (i === -1) return null;
  return i + 1 < live.length ? live[i + 1].key : END_KEY;
};

const quote = (text) => `"${text}"`;

// Who a route belongs to, as the subject of a message: the block itself, one of its answers, or
// its Other (specify) pick, named the way the builder shows them.
const routeSubject = (q, option) => {
  const block = quote(blockName(q));
  if (!option) return block;
  if (option.id === OTHER_ID) return `The "Other (specify)" answer on ${block}`;
  const text = clip(option.text);
  return text ? `The answer ${quote(text)} on ${block}` : `An answer on ${block}`;
};

const errorAt = (q, option, message) =>
  option ? { key: q.key, optionId: option.id, message } : { key: q.key, message };

// OR together everything that reaches a block (rule 5). An answer adds its id to its question's
// atom. A continue passes on the condition that reached its source — sound because that
// condition reads only questions before the source, whose answers can no longer change by the
// time the conversation gets here — and merges atom by atom with any direct route from the same
// question. One unconditional source makes the whole condition unconditional. Never returns an
// empty Map: every edge adds an atom, passes a non-empty one, or returns null.
const combine = (edges, reach) => {
  const atoms = new Map(); // question position -> Set of answer ids
  const add = (from, ids) => {
    if (!atoms.has(from)) atoms.set(from, new Set());
    for (const id of ids) atoms.get(from).add(id);
  };
  for (const edge of edges) {
    if (edge.via === 'answer') {
      add(edge.from, [edge.id]);
      continue;
    }
    const passed = reach[edge.from];
    if (passed == null) return null;
    for (const [from, ids] of passed) add(from, ids);
  }
  return atoms;
};

// Rule 5's stated order — atoms by their question's list position, ids by that question's answer
// order with Other last — is what makes an unchanged survey compile to byte-identical rules on
// every save, and the builder's live copy match the stored document.
const toVisibleIf = (atoms, live) => {
  if (atoms == null) return null;
  const rules = [...atoms.keys()]
    .sort((a, b) => a - b)
    .map((from) => {
      const q = live[from];
      const picked = atoms.get(from);
      const order = new Set([...liveOptions(q).map((o) => o.id).filter((id) => id !== OTHER_ID), OTHER_ID]);
      return { questionKey: q.key, op: 'any_of', optionIds: [...order].filter((id) => picked.has(id)) };
    });
  return { logic: 'any', rules };
};

// Turn every arrow into the `visibleIf` of the block it points at. Pure, deterministic and
// idempotent: the incoming visibleIf of a live block is ignored and overwritten (in Script flow
// the compiled rules are authoritative), so compiling the output again yields the same rules.
//
//   1. Walk LIVE blocks in list order. The first one is always reached.
//   2. A branching choice question: each picked answer reaches its `goTo` (null: the following
//      block; END_KEY: nowhere), and Other (specify) reaches `otherGoTo` the same way. An
//      unanswered branching question reaches nothing. A plain one reaches the following block
//      whenever it was itself reached. Retired answers neither fire nor count.
//   3. Multiple choice is a union: every picked answer's route is followed.
//   4. A text question or a statement continues to its `goTo` (null: the following block)
//      whether or not anything was typed.
//   5. A block's condition is the OR of everything that reaches it (see combine and toVisibleIf).
//      Reached unconditionally: visibleIf null.
//   6. A route must point at a LATER live block, so cycles are impossible and every rule names an
//      earlier question, as the save check and the evaluator both demand. The last block falls
//      through to End.
//   7. A live block nothing reaches is an error, never compiled to "always shown".
//   8. Retired blocks pass through untouched, in place.
//
// Returns { questions, errors }. `errors` holds { key, optionId?, message } in list order, in
// plain English: team leads read them in the builder and as the server's 400. The questions
// returned beside errors are the builder's live preview only and must never be stored: a route
// that errs is dropped, and a block nothing reaches compiles as if the conversation started there.
export const compileRouting = (questions) => {
  const list = Array.isArray(questions) ? questions : [];
  const live = liveBlocks(list);
  // A later duplicate key wins, the same reading visibility.js gives one.
  const position = new Map(live.map((q, i) => [q.key, i]));
  // What reaches each block: { from, via: 'answer', id } when an answer of block `from` points at
  // it, { from, via: 'continue' } when block `from` carries on into it.
  const inbound = live.map(() => []);
  const reach = []; // per block: null (always reached) or what combine built
  const errors = [];

  const following = (i) => (i + 1 < live.length ? i + 1 : END_KEY);

  // Where a route from block i lands: a later position, END_KEY, or null for a route that is
  // reported and dropped.
  const land = (q, i, option, value) => {
    const route = routeOf(value);
    if (route == null) return following(i);
    if (route === END_KEY) return END_KEY;
    const to = position.get(route);
    if (to != null && to > i) return to;
    const subject = routeSubject(q, option);
    let message;
    if (to == null) {
      message = `${subject} goes to a block that has been removed — pick another target.`;
    } else if (to === i) {
      message =
        `${subject} can only go to a later block, not back to ${quote(blockName(q))} itself` +
        ' — pick another target.';
    } else {
      const target = quote(blockName(live[to]));
      message =
        `${subject} can only go to a later block, and ${target} comes before it` +
        ` — move ${target} down or pick another target.`;
    }
    errors.push(errorAt(q, option, message));
    return null;
  };

  const point = (to, edge) => {
    if (typeof to === 'number') inbound[to].push(edge);
  };

  live.forEach((q, i) => {
    // Every route points forward, so everything that reaches block i came from an earlier block
    // and is already recorded: i's condition is final by the time the walk gets here.
    if (i === 0) reach.push(null);
    else if (inbound[i].length === 0) {
      const message =
        `Nothing leads to ${quote(blockName(q))}.` +
        ' Route an answer to it, or move it where the flow reaches it.';
      errors.push(errorAt(q, null, message));
      reach.push(null); // the preview reading described above
    } else reach.push(combine(inbound[i], reach));

    // Where block i sends the conversation next.
    if (!isChoice(q)) {
      point(land(q, i, null, q.goTo), { from: i, via: 'continue' });
      return;
    }
    if (routeOf(q.goTo) != null) {
      const message =
        `${quote(blockName(q))} is a choice question, so its Go to belongs on each answer` +
        ' — remove the one on the question itself.';
      errors.push(errorAt(q, null, message));
    }
    if (!isBranching(q)) {
      point(following(i), { from: i, via: 'continue' });
      return;
    }
    for (const option of liveOptions(q)) {
      point(land(q, i, option, option.goTo), { from: i, via: 'answer', id: option.id });
    }
    if (q.otherOption) {
      point(land(q, i, { id: OTHER_ID }, q.otherGoTo), { from: i, via: 'answer', id: OTHER_ID });
    }
  });

  let at = 0;
  const compiled = list.map((q) => {
    if (!q || q.retired) return q;
    const visibleIf = toVisibleIf(reach[at], live);
    at += 1;
    return { ...q, visibleIf };
  });
  return { questions: compiled, errors };
};

// Copies with every route set to null: goTo and otherGoTo on every block, goTo on every answer,
// retired ones included, so a later Restore can never revive a stale arrow. Nothing else changes.
export const clearRoutes = (questions) =>
  (Array.isArray(questions) ? questions : []).map((q) => {
    if (!q) return q;
    const cleared = { ...q, goTo: null, otherGoTo: null };
    if (Array.isArray(q.options)) cleared.options = q.options.map((o) => (o ? { ...o, goTo: null } : o));
    return cleared;
  });

// The builder's "Switch back to Show only if": every live block keeps the condition its arrows
// compiled to, now as an ordinary hand-editable condition, and every route is cleared. The phone
// then evaluates the very same conditions, so recording cannot change — exactly when `errors` is
// empty. With errors the kept conditions are only compileRouting's preview, so show the errors
// rather than switching.
export const switchToList = (questions) => {
  const { questions: compiled, errors } = compileRouting(questions);
  return { questions: clearRoutes(compiled), errors };
};
