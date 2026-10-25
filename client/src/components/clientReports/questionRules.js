// One row per survey question: show its chart, use it as a map filter, or make it the headline
// (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md Part 1 and §G3, with §O1 and §O6). Pure: the builder's
// question table renders rowsFor(), and every tick goes through the toggles below, so the rules the
// server enforces (routes/admin/clientReports.js PATCH; services/reports/reportVisibility.js) are the
// rules the screen offers:
//
//   · "None" means none: an empty chart list shows no question.
//   · A question you don't chart can't be on the map, and can't be the headline.
//   · A follow-up goes on the map only with every question it depends on (the snapshot's frozen
//     questionDeps — the transitive closure of every condition the survey ever had). Taking a parent
//     off the map takes its follow-ups off too, and the table says so.
//   · A follow-up of a written (text) question can never be mapped: text answers never reach the map.
//   · On a published report the map can only LOSE questions in place; adding one is Refresh numbers.

/** questionDeps entries ([[key, [deps…]], …]) → Map<key, Set<dep>>, tolerating absence. */
export const depsMapOf = (...lists) => {
  const out = new Map();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const key = String(entry[0]);
      if (!out.has(key)) out.set(key, new Set());
      for (const d of entry[1] || []) out.get(key).add(String(d));
    }
  }
  return out;
};

/** Keep only the keys whose every dependency is also kept, to a fixpoint (the server's closeUnderDeps). */
export const closeUnderDeps = (keys = [], deps = new Map()) => {
  const kept = new Set(keys);
  let changed = true;
  while (changed) {
    changed = false;
    for (const key of [...kept]) {
      for (const dep of deps.get(key) || []) {
        if (!kept.has(dep)) {
          kept.delete(key);
          changed = true;
          break;
        }
      }
    }
  }
  return keys.filter((k) => kept.has(k));
};

const uniq = (xs) => [...new Set(xs)];

/**
 * The table's rows. `breakdowns` are the report's frozen survey breakdowns (choice questions only —
 * a written question never has one). `settings` is the on-screen { visibility, supportQuestionKey }.
 * `liveMapKeys` is what the live snapshot's map carries, which a published report may only shrink.
 */
export const rowsFor = ({ breakdowns = [], settings, deps = new Map(), published = false, liveMapKeys = null }) => {
  const vis = settings?.visibility || {};
  const charted = new Set(vis.visibleQuestionKeys || []);
  const mapped = new Set(vis.mapAnswerKeys || []);
  const keys = new Set(breakdowns.map((b) => b.questionKey));
  const labelOf = new Map(breakdowns.map((b) => [b.questionKey, b.questionLabel || b.questionKey]));
  const mapOn = vis.showMap !== false;
  const areaMode = vis.mapMode === 'area';
  const live = liveMapKeys ? new Set(liveMapKeys) : null;

  return breakdowns.map((b) => {
    const key = b.questionKey;
    const parents = [...(deps.get(key) || [])];
    const textParent = parents.some((p) => !keys.has(p));
    const choiceParents = parents.filter((p) => keys.has(p));
    const parentsOffMap = choiceParents.filter((p) => !mapped.has(p));
    const chart = charted.has(key);
    const map = mapped.has(key);
    // The parent named in the copy: the nearest one is usually the direct one, but deps are a
    // closure, so name them all (most surveys have one).
    const parentNames = choiceParents.map((p) => `“${labelOf.get(p)}”`);

    let mapBlocked = null;
    if (!mapOn) mapBlocked = 'Turn on the map to use questions as map filters.';
    else if (!chart) mapBlocked = 'Show its chart to put it on the map.';
    else if (textParent) mapBlocked = 'Asked only after a written answer, so it can’t go on the map.';
    else if (!map && parentsOffMap.length) {
      mapBlocked = `It can go on the map only with ${parentsOffMap.map((p) => `“${labelOf.get(p)}”`).join(' and ')}, so it’s best left off.`;
    } else if (!map && published && live && !live.has(key)) mapBlocked = 'Add this with Refresh numbers.';

    let followUp = null;
    if (parents.length) {
      followUp = textParent
        ? 'Asked only after a written answer — written answers never reach the map.'
        : `Asked only on some paths through ${parentNames.join(' and ')} — mapping it shows who took that path.`;
    }

    return {
      key,
      label: b.questionLabel || key,
      type: b.type,
      chart,
      map: map && mapOn,
      headline: settings?.supportQuestionKey === key,
      isFollowUp: parents.length > 0,
      followUp,
      parents: choiceParents,
      textParent,
      // Unticking is always allowed; ticking is allowed only when nothing blocks it.
      mapDisabled: !map && !!mapBlocked,
      mapBlocked: map ? null : mapBlocked,
      headlineDisabled: !chart,
      // In area view only a single-choice question shows answers area by area (§F5).
      areaNote: areaMode && mapOn && map && b.type !== 'single_choice' ? 'Multiple choice: a map filter for exact doors only — areas show it as a chart.' : null,
    };
  });
};

const withVisibility = (settings, patch) => ({ ...settings, visibility: { ...settings.visibility, ...patch } });

/**
 * Tick or untick a question's chart. Unticking also takes it (and anything that follows it) off the
 * map and clears it as the headline. Returns { settings, removedFromMap }.
 */
export const toggleChart = (settings, key, deps = new Map()) => {
  const vis = settings.visibility || {};
  const charted = new Set(vis.visibleQuestionKeys || []);
  if (charted.has(key)) {
    charted.delete(key);
    const before = vis.mapAnswerKeys || [];
    const after = closeUnderDeps(before.filter((k) => k !== key && charted.has(k)), deps);
    const next = withVisibility(settings, { visibleQuestionKeys: [...charted], mapAnswerKeys: after });
    if (next.supportQuestionKey === key) next.supportQuestionKey = null;
    return { settings: next, removedFromMap: before.filter((k) => !after.includes(k)) };
  }
  charted.add(key);
  return { settings: withVisibility(settings, { visibleQuestionKeys: [...charted] }), removedFromMap: [] };
};

/**
 * Tick or untick a question's Map box. Ticking adds it only when its chart is on and every question
 * it depends on is already mapped; unticking also removes its follow-ups. Returns { settings,
 * removedFromMap } — removedFromMap lists the follow-ups that came off with it.
 */
export const toggleMap = (settings, key, deps = new Map()) => {
  const vis = settings.visibility || {};
  const mapped = vis.mapAnswerKeys || [];
  if (mapped.includes(key)) {
    const after = closeUnderDeps(mapped.filter((k) => k !== key), deps);
    return {
      settings: withVisibility(settings, { mapAnswerKeys: after }),
      removedFromMap: mapped.filter((k) => k !== key && !after.includes(k)),
    };
  }
  const charted = new Set(vis.visibleQuestionKeys || []);
  if (!charted.has(key)) return { settings, removedFromMap: [] };
  const after = closeUnderDeps(uniq([...mapped, key]), deps);
  return { settings: withVisibility(settings, { mapAnswerKeys: after }), removedFromMap: [] };
};

/** The headline question (or none). Only a charted question can be the headline. */
export const setHeadline = (settings, key) => {
  if (key && !(settings.visibility?.visibleQuestionKeys || []).includes(key)) return settings;
  return { ...settings, supportQuestionKey: key || null };
};

/** Show: All — every question's chart. The map is left as it was. */
export const showAll = (settings, breakdowns) =>
  withVisibility(settings, { visibleQuestionKeys: uniq([...(settings.visibility?.visibleQuestionKeys || []), ...breakdowns.map((b) => b.questionKey)]) });

/**
 * Map questions that hang together the way the toggles keep them: only charted questions, closed under
 * their dependencies (the server's own rule for what a map may carry). For "Keep my changes" after a
 * change made elsewhere (ADMINUX-1), where one side's charts can meet the other side's map ticks.
 * Settings that already hang together come back with the same keys.
 */
export const coherentMapKeys = (settings, deps = new Map()) => {
  const vis = settings?.visibility || {};
  const charted = new Set(vis.visibleQuestionKeys || []);
  return { ...settings, visibility: { ...vis, mapAnswerKeys: closeUnderDeps((vis.mapAnswerKeys || []).filter((k) => charted.has(k)), deps) } };
};

/** Show: None — no chart, so nothing on the map and no headline. "None" really means none. */
export const showNone = (settings) => ({
  ...withVisibility(settings, { visibleQuestionKeys: [], mapAnswerKeys: [] }),
  supportQuestionKey: null,
});
