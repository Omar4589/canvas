// The builder's auto-save (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G3, §C5). Plain JavaScript, no
// React, so its timing is tested with fake timers (lib/clientReportAutoSave.test.js) and the hook that
// mounts it stays thin:
//
//   · 800 ms after the last change, ONE targeted PATCH of only the fields that changed (the server's
//     PATCH writes exactly what it is sent — a targeted $set — so a build committing at the same
//     moment can't be lost, and neither can a field nobody touched);
//   · one request in flight at a time; a change made meanwhile is sent when it lands;
//   · "Saving…", "Saved · just now", "Couldn't save — Retry";
//   · flush() for Publish and the builder's own links — it keeps sending until nothing is left, so a
//     change typed while a save was out is the next save, never a failure (ADMINUX-11); detach() on
//     unmount sends whatever is still unsaved with fetch keepalive, so closing the page mid-debounce
//     keeps the edit (attach() undoes it, because React's StrictMode unmounts and remounts every
//     effect once in development);
//   · every save is pinned to the version the screen was built on (contract C8, sent by the hook): a
//     refusal because the report changed elsewhere parks the saver until the page has merged three
//     ways (mergeSettings) and rebased, then what is still yours goes again;
//   · hold() while the page asks whether to keep a change the report moved under (both sides changed
//     the same thing, ADMINUX-1): nothing is sent until release(). Leaving meanwhile keeps the change
//     on this device (onDetach) before the keepalive tries it, so a refused one is offered back;
//   · `dirty` drives the beforeunload guard: true while a change waits, is saving, or failed.

/** The fields the builder edits, as one plain object. Visibility subkeys are sent one by one. */
export const VISIBILITY_KEYS = ['visibleQuestionKeys', 'mapAnswerKeys', 'showMap', 'visibleTags', 'showGoal', 'mapMode', 'areaSize'];
const SET_KEYS = new Set(['visibleQuestionKeys', 'mapAnswerKeys', 'visibleTags']);

/** A report's editable settings, with explicit fallbacks (old documents lack fields — never trust a default). */
export const settingsOf = (report) => {
  const v = report?.visibility || {};
  return {
    title: report?.title || '',
    observations: (report?.observations || []).map((s) => ({ heading: s.heading || '', body: s.body || '' })),
    supportQuestionKey: report?.supportQuestionKey || null,
    copiedNotesReviewed: report?.copiedNotesReviewed ?? null,
    visibility: {
      visibleQuestionKeys: [...(v.visibleQuestionKeys || [])],
      mapAnswerKeys: [...(v.mapAnswerKeys || [])],
      showMap: v.showMap !== false,
      visibleTags: [...(v.visibleTags || [])],
      showGoal: !!v.showGoal,
      mapMode: v.mapMode === 'area' ? 'area' : 'pins',
      areaSize: v.areaSize === 'large' ? 'large' : 'small',
    },
  };
};

// A section with no heading isn't sent (the server requires one); it stays on screen until it has one.
export const sendableObservations = (obs) =>
  (obs || []).filter((s) => String(s.heading || '').trim()).map((s) => ({ heading: s.heading, body: s.body || '' }));

const sameSet = (a, b) => {
  const x = [...new Set(a || [])].sort();
  const y = [...new Set(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The PATCH body that turns `base` into `next`: only the fields that differ, visibility subkey by
 * subkey. Null when nothing differs. Key lists compare as sets (tick order isn't a change).
 */
export const diffSettings = (base, next) => {
  if (!base || !next) return null;
  const body = {};
  if ((base.title || '') !== (next.title || '')) body.title = next.title || '';
  const obsNext = sendableObservations(next.observations);
  if (!sameJson(sendableObservations(base.observations), obsNext)) body.observations = obsNext;
  if ((base.supportQuestionKey || null) !== (next.supportQuestionKey || null)) body.supportQuestionKey = next.supportQuestionKey || null;
  if (next.copiedNotesReviewed != null && base.copiedNotesReviewed !== next.copiedNotesReviewed) body.copiedNotesReviewed = next.copiedNotesReviewed;
  const vis = {};
  for (const k of VISIBILITY_KEYS) {
    const a = base.visibility?.[k];
    const b = next.visibility?.[k];
    if (SET_KEYS.has(k) ? !sameSet(a, b) : a !== b) vis[k] = SET_KEYS.has(k) ? [...new Set(b || [])] : b;
  }
  if (Object.keys(vis).length) body.visibility = vis;
  return Object.keys(body).length ? body : null;
};

/** `base` with a sent body applied — what the server now holds for those fields. */
export const applyBody = (base, body) => {
  if (!body) return base;
  const out = { ...base, visibility: { ...(base?.visibility || {}) } };
  for (const k of ['title', 'observations', 'supportQuestionKey', 'copiedNotesReviewed']) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  for (const k of Object.keys(body.visibility || {})) out.visibility[k] = body.visibility[k];
  return out;
};

// Sections as typed, heading-less ones included (those are never sent, but they are the operator's).
const typedSections = (obs) => JSON.stringify((obs || []).map((s) => ({ heading: s.heading || '', body: s.body || '' })));

/**
 * True when the screen holds anything `base` (what the server held when the screen was built) doesn't:
 * a change still to send, or a section typed without a heading yet. The "changed elsewhere" check
 * (ADMINUX-1) asks first instead of catching the screen up whenever this is true.
 */
export const hasLocalChanges = (base, screen) => !!base && !!screen && (!!diffSettings(base, screen) || typedSections(base.observations) !== typedSections(screen.observations));

/**
 * The fields two settings differ in, as diffSettings sees fields (each visibility subkey on its own; key
 * lists as sets) — except that sections compare as typed, heading-less ones included.
 */
export const changedFields = (a, b) => {
  const out = [];
  if ((a?.title || '') !== (b?.title || '')) out.push('title');
  if (typedSections(a?.observations) !== typedSections(b?.observations)) out.push('observations');
  if ((a?.supportQuestionKey || null) !== (b?.supportQuestionKey || null)) out.push('supportQuestionKey');
  if ((a?.copiedNotesReviewed ?? null) !== (b?.copiedNotesReviewed ?? null)) out.push('copiedNotesReviewed');
  for (const k of VISIBILITY_KEYS) {
    const x = a?.visibility?.[k];
    const y = b?.visibility?.[k];
    if (SET_KEYS.has(k) ? !sameSet(x, y) : x !== y) out.push(k);
  }
  return out;
};

// ── Three-way merge (contract C8, PRIV-1 / CONCUR-1) ──────────────────────────────────────────────
// base = what this page started from, theirs = the report as it stands now, mine = the screen.
// Nothing either side changed is lost without the operator choosing it, and nothing reaches the
// client that nobody saw: a removal made elsewhere stands unless this operator re-adds that very
// member, and a section someone added or deleted is never dropped or brought back quietly.

/** A key list, member by member: theirs ∪ (mine − base) − (base − mine). Never a conflict. */
export const mergeList = (base = [], theirs = [], mine = []) => {
  const b = new Set(base || []);
  const m = new Set(mine || []);
  const out = [...new Set(theirs || [])].filter((k) => !(b.has(k) && !m.has(k)));
  for (const k of mine || []) if (!b.has(k) && !out.includes(k)) out.push(k);
  return out;
};

// A section has no id: it is its exact content.
const sectionKey = (s) => JSON.stringify([s?.heading || '', s?.body || '']);
const plainSection = (s) => ({ heading: s?.heading || '', body: s?.body || '' });

const headingKey = (s) => String(s?.heading || '').trim().toLowerCase();

const bodyKey = (s) => String(s?.body || '').trim();

/**
 * Which of `other`'s sections each of `base`'s became, in any order: the same content first (a section
 * moved is still the same section), then the same heading (its text edited), then the same text (its
 * heading renamed — so text someone deleted can't come back under a new heading unasked). Per base
 * index: kept, edited (`section` is what it became) or deleted; `role[j]` is the base index other[j]
 * stands for, or null when `other` added it.
 */
const matchSections = (base, other) => {
  const byBase = base.map(() => ({ kind: 'deleted' }));
  const role = other.map(() => null);
  const pass = (kind, same) =>
    base.forEach((s, i) => {
      if (byBase[i].kind !== 'deleted') return;
      const j = other.findIndex((o, k) => role[k] == null && same(s, o));
      if (j < 0) return;
      role[j] = i;
      byBase[i] = kind === 'kept' ? { kind, at: j } : { kind, section: other[j], at: j };
    });
  pass('kept', (s, o) => sectionKey(s) === sectionKey(o));
  pass('edited', (s, o) => !!headingKey(s) && headingKey(s) === headingKey(o));
  pass('edited', (s, o) => !!bodyKey(s) && bodyKey(s) === bodyKey(o));
  return { byBase, role };
};

/**
 * The observations, three ways (C8): theirs' order; a base section I deleted goes, one I edited takes
 * my version, one I added goes in at its place. A base section both sides changed differently, or one
 * side deleted while the other edited it, is a conflict: `prefer` picks the side, and each conflict
 * says which section ({ kind: 'both' | 'theyDeleted' | 'iDeleted', heading }).
 */
const mergeSections = (base = [], theirs = [], mine = [], prefer = 'mine') => {
  const B = base || [];
  const T = theirs || [];
  const M = mine || [];
  const conflicts = [];
  if (typedSections(T) === typedSections(B)) return { sections: M.map(plainSection), conflicts };
  if (typedSections(M) === typedSections(B) || typedSections(M) === typedSections(T)) return { sections: T.map(plainSection), conflicts };
  const t = matchSections(B, T);
  const m = matchSections(B, M);
  const headingOf = (i, ...alts) => B[i]?.heading || alts.find((s) => s?.heading)?.heading || '';
  // Theirs, in their order, each base section as both sides left it.
  const entries = [];
  T.forEach((s, j) => {
    const i = t.role[j];
    if (i == null) {
      entries.push({ section: s, base: null }); // a section they added
      return;
    }
    const mc = m.byBase[i];
    const theyEdited = t.byBase[i].kind === 'edited';
    let keep = null;
    if (mc.kind === 'kept') keep = s;
    else if (mc.kind === 'edited' && (!theyEdited || sectionKey(mc.section) === sectionKey(s))) keep = mc.section;
    else if (mc.kind === 'edited') {
      conflicts.push({ kind: 'both', heading: headingOf(i, s, mc.section) });
      keep = prefer === 'theirs' ? s : mc.section;
    } else if (theyEdited) {
      // I deleted a section they edited.
      conflicts.push({ kind: 'iDeleted', heading: headingOf(i, s) });
      if (prefer === 'theirs') keep = s;
    }
    if (keep) entries.push({ section: keep, base: i });
  });
  // Mine, in my order: what I added — and a section I edited that they deleted (a conflict) — goes in
  // after the base section before it in my order, or the nearest earlier one still there.
  const inserts = new Map();
  const queue = (anchor, s) => inserts.set(anchor, [...(inserts.get(anchor) || []), s]);
  const before = new Map();
  let last = -1;
  M.forEach((s, p) => {
    const i = m.role[p];
    if (i == null) {
      queue(last, s);
      return;
    }
    before.set(i, last);
    if (t.byBase[i].kind === 'deleted' && m.byBase[i].kind === 'edited') {
      conflicts.push({ kind: 'theyDeleted', heading: headingOf(i, s) });
      if (prefer === 'mine') queue(last, s);
    }
    last = i;
  });
  const placed = new Set(entries.filter((e) => e.base != null).map((e) => e.base));
  const at = new Map();
  for (const [anchor, list] of inserts) {
    let a = anchor;
    const seen = new Set();
    while (a !== -1 && !placed.has(a) && !seen.has(a)) {
      seen.add(a);
      a = before.has(a) ? before.get(a) : -1;
    }
    at.set(placed.has(a) ? a : -1, [...(at.get(placed.has(a) ? a : -1) || []), ...list]);
  }
  const out = (at.get(-1) || []).map(plainSection);
  for (const e of entries) {
    out.push(plainSection(e.section));
    if (e.base != null) out.push(...(at.get(e.base) || []).map(plainSection));
  }
  // Theirs' order wins, so a new order of mine is lost when they changed the sections too: said, never
  // silent (VERIFY2-6) — true when I moved sections and they don't stand in my order any more.
  const mineSeq = M.map((_, p) => m.role[p]).filter((i) => i != null);
  const outSeq = entries.filter((e) => e.base != null).map((e) => e.base);
  const both = new Set(outSeq.filter((i) => mineSeq.includes(i)));
  const reordered = mineSeq.some((i, n) => n > 0 && i < mineSeq[n - 1]);
  const orderLost = reordered && JSON.stringify(mineSeq.filter((i) => both.has(i))) !== JSON.stringify(outSeq.filter((i) => both.has(i)));
  return { sections: out, conflicts, orderLost };
};

const SCALARS = [
  ['title', (s) => s?.title || ''],
  ['supportQuestionKey', (s) => s?.supportQuestionKey || null],
  ['copiedNotesReviewed', (s) => s?.copiedNotesReviewed ?? null],
];
const VISIBILITY_SCALARS = ['showMap', 'showGoal', 'mapMode', 'areaSize'];

/**
 * Three-way merge of the builder's settings (C8). Key lists member by member (never a conflict);
 * scalars — only I changed it: mine; only they: theirs; both, differently: a conflict; observations
 * section by section. Returns { merged, conflicts, lost }: each conflict { field, mine, theirs } (for
 * observations { field, kind, heading }); `lost` names a change of mine the merge couldn't keep and
 * didn't ask about — [{ field: 'observations', kind: 'order' }] when my new order of the sections
 * gave way to theirs (VERIFY2-6). `prefer` decides every conflict ('mine' keeps the screen as typed;
 * 'theirs' is Use theirs).
 */
export const mergeSettings = (base, theirs, mine, { prefer = 'mine' } = {}) => {
  const merged = { ...theirs, visibility: { ...(theirs?.visibility || {}) } };
  const conflicts = [];
  const pick = (field, b, t, m) => {
    if (m === b || m === t) return t; // only they changed it, or nobody, or both the same way
    if (t === b) return m; // only I did
    conflicts.push({ field, mine: m, theirs: t });
    return prefer === 'theirs' ? t : m;
  };
  for (const [k, read] of SCALARS) merged[k] = pick(k, read(base), read(theirs), read(mine));
  for (const k of VISIBILITY_SCALARS) merged.visibility[k] = pick(k, base?.visibility?.[k], theirs?.visibility?.[k], mine?.visibility?.[k]);
  for (const k of SET_KEYS) merged.visibility[k] = mergeList(base?.visibility?.[k], theirs?.visibility?.[k], mine?.visibility?.[k]);
  const obs = mergeSections(base?.observations, theirs?.observations, mine?.observations, prefer);
  merged.observations = obs.sections;
  for (const c of obs.conflicts) conflicts.push({ field: 'observations', ...c });
  return { merged, conflicts, lost: obs.orderLost ? [{ field: 'observations', kind: 'order' }] : [] };
};

const quoted = (s) => `“${s}”`;
const listText = (words) => (words.length <= 1 ? words[0] || '' : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const viewText = (mode, size) => (mode === 'area' ? `${size === 'large' ? 'large' : 'small'} areas` : 'exact doors');

/**
 * The words for a conflict banner: `what` names only what both sides changed ("the title and the
 * “North side” section"); `replaces` says exactly what Keep mine replaces ("their title “Week 3
 * final” and their version of “North side”"). `theirs` is the latest settings (for the map view).
 */
export const conflictWords = (conflicts = [], { labelOf = (k) => k, theirs = null } = {}) => {
  const what = [];
  const replaces = [];
  const add = (w, r) => {
    if (!what.includes(w)) what.push(w);
    if (r && !replaces.includes(r)) replaces.push(r);
  };
  for (const c of conflicts) {
    if (c.field === 'title') add('the title', c.theirs ? `their title ${quoted(c.theirs)}` : 'their empty title');
    else if (c.field === 'supportQuestionKey') add('the headline question', c.theirs ? `their headline question ${quoted(labelOf(c.theirs))}` : 'their choice of no headline question');
    else if (c.field === 'copiedNotesReviewed') add('the copied-notes check', `their ${c.theirs ? 'ticked' : 'unticked'} copied-notes check`);
    else if (c.field === 'showMap') add('the map', `their map turned ${c.theirs ? 'on' : 'off'}`);
    else if (c.field === 'showGoal') add('the door goal', `their door goal ${c.theirs ? 'shown' : 'hidden'}`);
    else if (c.field === 'mapMode' || c.field === 'areaSize') add('the map view', `their map view (${viewText(theirs?.visibility?.mapMode, theirs?.visibility?.areaSize)})`);
    else if (c.field === 'observations') {
      const h = quoted(c.heading || 'untitled');
      if (c.kind === 'theyDeleted') add(`the ${h} section, which they deleted`, `their deletion of ${h} (yours comes back)`);
      else if (c.kind === 'iDeleted') add(`the ${h} section, which you deleted`, `their edited ${h} (it stays deleted)`);
      else add(`the ${h} section`, `their version of ${h}`);
    }
  }
  return { what: listText(what), replaces: listText(replaces) };
};

// The fields a change touched, in the words the builder's notices use.
const FIELD_WORDS = {
  title: 'the title',
  observations: 'the observations',
  supportQuestionKey: 'the headline question',
  copiedNotesReviewed: 'the copied-notes check',
  visibleQuestionKeys: 'the charts shown',
  mapAnswerKeys: 'the map questions',
  showMap: 'the map',
  visibleTags: 'the voter groups',
  showGoal: 'the door goal',
  mapMode: 'the map view',
  areaSize: 'the map view',
};
/** "the title and the map questions" — what a diffSettings body (or a list of fields) changed. */
export const fieldsText = (body) => {
  if (!body) return '';
  const keys = Array.isArray(body) ? body : [...Object.keys(body).filter((k) => k !== 'visibility'), ...Object.keys(body.visibility || {})];
  const words = [...new Set(keys.map((k) => FIELD_WORDS[k]).filter(Boolean))];
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
};

/**
 * The saver. `send(body)` resolves with the server's fresh report; `sendKeepalive(body)` fires and
 * forgets. `onState({ status, error, savedAt, dirty })` reports every change; `onAdopt(settings)` hands
 * back on-screen settings the server normalized (a follow-up dropped from the map because its parent
 * left), applied only when the screen still shows exactly what was sent. `onDetach({ settings, base })`
 * runs on unmount BEFORE the keepalive leaves, while something is unsaved: the page keeps a copy on
 * this device, so a keepalive the server refuses comes back as a Restore offer (P-3).
 *
 * A save refused 409 CHANGED_ELSEWHERE (contract C8: the report moved since the version the screen
 * was built on) PARKS the saver: nothing more is sent until the page has merged against the report
 * that came back and called rebase() — then what is still yours goes, pinned to the new version.
 */
export const createAutoSaver = ({ send, sendKeepalive, delay = 800, timers = globalThis, onState, onAdopt, onDetach, now = () => Date.now() }) => {
  let base = null;
  let current = null;
  let timer = null;
  let inFlight = null;
  let status = 'idle';
  let error = null;
  let savedAt = null;
  let attached = true;
  // Held while the page asks whether a change should go over one made somewhere else (ADMINUX-1).
  let held = false;
  // Parked after a CHANGED_ELSEWHERE refusal, until the page merges and rebases (C8). A flush waiting
  // on it (Publish…, leaving) is woken when it ends — rebased, held to ask, reset or gone.
  let parked = false;
  let waiters = [];
  const wake = () => {
    const w = waiters;
    waiters = [];
    for (const resolve of w) resolve();
  };
  const unparked = (ms) =>
    new Promise((resolve) => {
      const t = timers.setTimeout(resolve, ms);
      waiters.push(() => {
        timers.clearTimeout(t);
        resolve();
      });
    });

  const pending = () => diffSettings(base, current);
  const dirty = () => status === 'error' || timer != null || inFlight != null || !!pending();
  const emit = () => onState?.({ status, error, savedAt, dirty: dirty(), held, parked });
  const clearTimer = () => {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  };

  const run = () => {
    clearTimer();
    if (!attached || held || parked) return Promise.resolve(false);
    if (inFlight) return inFlight.then(() => run());
    const body = pending();
    if (!body) {
      // Nothing differs from the server any more (a change undone, or already saved).
      if (status === 'pending' || status === 'error') {
        status = savedAt ? 'saved' : 'idle';
        error = null;
      }
      emit();
      return Promise.resolve(true);
    }
    status = 'saving';
    error = null;
    emit();
    const sent = current;
    inFlight = Promise.resolve()
      .then(() => send(body))
      .then((fresh) => {
        base = applyBody(base, body);
        // The one field the server reshapes: map questions closed under their dependencies. Taken
        // back only when the screen still shows what was sent — a newer tick stays.
        const serverMap = fresh?.visibility?.mapAnswerKeys;
        if (body.visibility?.mapAnswerKeys && Array.isArray(serverMap) && !sameSet(serverMap, body.visibility.mapAnswerKeys)) {
          base = { ...base, visibility: { ...base.visibility, mapAnswerKeys: [...serverMap] } };
          if (current === sent || sameSet(current?.visibility?.mapAnswerKeys, body.visibility.mapAnswerKeys)) {
            current = { ...current, visibility: { ...current.visibility, mapAnswerKeys: [...serverMap] } };
            onAdopt?.(current, { dropped: body.visibility.mapAnswerKeys.filter((k) => !serverMap.includes(k)) });
          }
        }
        status = 'saved';
        savedAt = now();
        return true;
      })
      .catch((e) => {
        if (e?.code === 'CHANGED_ELSEWHERE') {
          // Not a failure: the page merges against the report that came back, then rebases.
          parked = true;
          status = 'pending';
          error = null;
          return false;
        }
        status = 'error';
        error = e;
        return false;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight.then((ok) => {
      emit();
      // A change made while that request was out goes next, on its own debounce.
      if (ok && attached && !held && !parked && pending() && timer == null) schedule();
      return ok;
    });
  };

  const schedule = () => {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      run();
    }, delay);
  };

  return {
    /** Start over from the server's state (a report loaded, or a different report). */
    reset(settings) {
      clearTimer();
      base = settings;
      current = settings;
      status = 'idle';
      error = null;
      held = false;
      parked = false;
      wake();
      emit();
    },
    /**
     * The server moved under the screen and the page caught up (ADMINUX-1, C8): `serverSettings` is
     * what it holds now, `screenSettings` what the screen shows. Whatever differs is the next save; the
     * "Saved · …" line is kept when nothing does. A parked saver goes again, and a held one too: the
     * page catches up only when nothing is left to ask (the question went away — the other side put
     * their change back, say — or was answered), so saving resumes (VERIFY2-1).
     */
    rebase(serverSettings, screenSettings) {
      clearTimer();
      base = serverSettings;
      current = screenSettings;
      parked = false;
      held = false;
      if (pending()) {
        status = 'pending';
        error = null;
        if (attached && !held) schedule();
      } else if (status === 'pending' || status === 'error') {
        status = savedAt ? 'saved' : 'idle';
        error = null;
      }
      emit();
      wake();
    },
    /** The screen changed. */
    update(settings) {
      current = settings;
      if (!pending() && !inFlight) {
        // Back to what the server holds: nothing to save, and a failed change no longer exists.
        clearTimer();
        if (status === 'pending' || status === 'error') {
          status = savedAt ? 'saved' : 'idle';
          error = null;
        }
        emit();
        return;
      }
      if (status !== 'saving') status = 'pending';
      if (!held && !parked) schedule();
      emit();
    },
    /**
     * Send now, and keep sending until nothing is left: a change typed while a save was out goes next
     * instead of reading as a failure (ADMINUX-11). A save refused because the report changed elsewhere
     * (C8) waits for the page's merge, then goes again. Bounded, for a hand that never stops typing.
     * Resolves true when everything landed; false when a save failed, the saver is held (you both
     * changed the same thing), or the page is gone.
     */
    flush() {
      const round = (left) =>
        run().then((ok) => {
          if (ok) return pending() && left > 0 ? round(left - 1) : !pending();
          if (!parked || !attached || left <= 0) return false;
          return unparked(5000).then(() => (parked || held || !attached ? false : round(left - 1)));
        });
      return round(5);
    },
    retry() {
      return run();
    },
    /** Nothing goes out until release() (or the unmount flush): the page is asking which version to keep. */
    hold() {
      held = true;
      clearTimer();
      emit();
      wake();
    },
    /** The question is answered: what is left goes now. */
    release() {
      held = false;
      if (attached && pending()) run();
      else emit();
    },
    /**
     * Unmount: whatever is still unsaved leaves with keepalive (fire and forget) — after a copy is kept
     * on this device (P-3), so a keepalive refused because the report was published or changed
     * elsewhere meanwhile comes back as a Restore offer instead of vanishing.
     */
    detach() {
      clearTimer();
      attached = false;
      wake();
      const body = pending();
      if (!body) return;
      try {
        onDetach?.({ settings: current, base });
      } catch {
        /* storage blocked: the keepalive still goes */
      }
      try {
        sendKeepalive?.(body);
      } catch {
        /* the page is going away; nothing to tell */
      }
      // Sent: if this saver is ever attached again (StrictMode's remount), it starts from there.
      base = applyBody(base, body);
    },
    /** Mounted (again). */
    attach() {
      attached = true;
    },
    /** `base` is what the server held for these fields when last heard from; `busy`, a save is out. */
    get state() {
      return { status, error, savedAt, dirty: dirty(), pending: pending(), base, busy: inFlight != null, held, parked };
    },
  };
};

/** "Saved · just now" / "Saved · 3 min ago" / "Saving…" / "Couldn't save" / "Not saved yet" (held). */
export const saveLabel = ({ status, savedAt, held = false }, nowMs = Date.now()) => {
  if (held) return 'Not saved yet';
  if (status === 'saving' || status === 'pending') return 'Saving…';
  if (status === 'error') return 'Couldn’t save';
  if (status === 'saved' && savedAt) {
    const mins = Math.floor((nowMs - savedAt) / 60000);
    if (mins < 1) return 'Saved · just now';
    if (mins < 60) return `Saved · ${mins} min ago`;
    return 'Saved';
  }
  return 'All changes saved';
};
