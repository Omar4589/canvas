import crypto from 'node:crypto';
import { evaluateVisibleIf, makeCell } from '../surveys/visibility.js';
import { OTHER_OPTION_ID } from '../surveys/otherOption.js';

// What a client report may show, enforced on the SERVER (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md
// §F1, as amended by §O1 and §O6). Before this, every privacy switch on the builder only hid things
// in the browser: the map, hidden questions and their internal keys still rode the payload (B1-B3,
// B8), and a follow-up question on the map showed which homes gave the answer to a question the
// operator had hidden (B9).
//
// Three rules, in one place so every reader and writer agrees:
//   · Empty means NONE, for visible questions and map questions alike, on every report.
//   · A follow-up reaches the map only with every question it depends on — the dependencies frozen
//     with the snapshot (questionDeps), taken from the survey's monotone depsEver record.
//   · Readers serve the INTERSECTION of the report's current settings and its live snapshot's
//     inputs, so neither side alone can put something in front of the client.
//
// Old documents lack every snapshot field. JavaScript reads go through the helpers below, each
// with an explicit fallback, and never trust a Mongoose default (a missing snapshotInputs would
// hydrate as "nothing on the map" — or worse, as whatever the defaults say).

// ── Follow-up dependencies (§F1, §O6) ──────────────────────────────────────────────────────────

const isChoiceType = (type) => type === 'single_choice' || type === 'multiple_choice';

// Every pick a parent question can record today: its live answers, and Other (specify) when it is
// on — the same set the Script-flow compiler gates on (routing.js), so a script block whose rule
// lists every branch of its parent stays mappable (§O6).
const pickableIds = (parent) => {
  const ids = (parent.options || []).filter((o) => o && !o.retired).map((o) => o.id);
  if (parent.otherOption) ids.push(OTHER_OPTION_ID);
  return ids;
};

/**
 * Does this visibleIf rule make its question depend on the parent's answer? A rule that accepts
 * EVERY pick of its parent carries no information about which one was picked, so it isn't a
 * dependency (§O6). A text parent always is: its follow-ups can never be mapped. An unknown parent
 * is treated as one (fail closed).
 */
export const ruleIsDependency = (rule, parent) => {
  if (!parent || !isChoiceType(parent.type)) return true;
  const ids = pickableIds(parent);
  if (!ids.length) return true;
  const one = { logic: 'all', rules: [rule] };
  return !ids.every((id) => evaluateVisibleIf(one, { [parent.key]: makeCell(parent.type, [id], null) }));
};

/** question key → Set of the keys its CURRENT visibleIf depends on (retired questions included). */
export const directDepsOf = (questions = []) => {
  const byKey = new Map((questions || []).filter(Boolean).map((q) => [q.key, q]));
  const out = new Map();
  for (const q of questions || []) {
    for (const rule of q?.visibleIf?.rules || []) {
      if (!ruleIsDependency(rule, byKey.get(rule.questionKey))) continue;
      if (!out.has(q.key)) out.set(q.key, new Set());
      out.get(q.key).add(rule.questionKey);
    }
  }
  return out;
};

const edgeId = (e) => JSON.stringify([e.q, e.on]);

/** The edges a set of questions depends on today, as SurveyTemplate.depsEver stores them. */
export const depEdgesOf = (questions = []) => {
  const edges = [];
  for (const [q, parents] of directDepsOf(questions)) for (const on of parents) edges.push({ q, on });
  return edges.sort((a, b) => edgeId(a).localeCompare(edgeId(b)));
};

/** depsEver ∪ more edges — a union, never a removal (§O6: the record is monotone). */
export const unionDepEdges = (existing = [], more = []) => {
  const seen = new Map();
  for (const e of [...(existing || []), ...(more || [])]) {
    if (!e?.q || !e?.on) continue;
    const plain = { q: String(e.q), on: String(e.on) };
    seen.set(edgeId(plain), plain);
  }
  return [...seen.values()].sort((a, b) => edgeId(a).localeCompare(edgeId(b)));
};

/**
 * The transitive dependencies of every question of a survey — or of several surveys, united — as a
 * snapshot freezes them: [[questionKey, [keys it depends on, directly or through another follow-up]],
 * …], sorted. Built from depsEver (every dependency ever recorded) united with today's visibleIf, so a
 * survey not yet seeded by the migration — or one whose record is behind — still covers today's
 * conditions. Several surveys: a report from before snapshots, whose answers can have come from any
 * survey the campaign ever used (legacyTemplatesFor, clientReportMap.js).
 */
export const questionDepsOf = (templateOrList) => {
  const templates = (Array.isArray(templateOrList) ? templateOrList : [templateOrList]).filter(Boolean);
  const direct = new Map();
  const add = (q, on) => {
    if (!direct.has(q)) direct.set(q, new Set());
    direct.get(q).add(on);
  };
  for (const template of templates) {
    // Each survey's rules name questions of that same survey, so its direct edges come from its own.
    for (const [q, parents] of directDepsOf(template.questions || [])) for (const on of parents) add(q, on);
    for (const e of template.depsEver || []) if (e?.q && e?.on) add(String(e.q), String(e.on));
  }
  const closure = new Map();
  const visit = (key, trail) => {
    if (closure.has(key)) return closure.get(key);
    const all = new Set();
    for (const parent of direct.get(key) || []) {
      all.add(parent);
      // A cycle can't be authored (a rule must reference an EARLIER question), but depsEver spans
      // every version of a survey, so guard rather than recurse forever.
      if (trail.has(parent)) continue;
      for (const up of visit(parent, new Set([...trail, parent]))) all.add(up);
    }
    closure.set(key, all);
    return all;
  };
  for (const key of direct.keys()) visit(key, new Set([key]));
  return [...closure.entries()]
    .filter(([, deps]) => deps.size)
    .map(([key, deps]) => [key, [...deps].sort()])
    .sort((a, b) => a[0].localeCompare(b[0]));
};

/** questionDeps entries → Map<key, Set<dep>>. Tolerates absence (a snapshot from before deps). */
export const depsMap = (questionDeps) => {
  const out = new Map();
  for (const entry of Array.isArray(questionDeps) ? questionDeps : []) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    out.set(String(entry[0]), new Set((entry[1] || []).map(String)));
  }
  return out;
};

/**
 * Keep only the keys whose every dependency is also kept — to a fixpoint, so a follow-up of a
 * follow-up drops with its middle question. Order preserved.
 */
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

// ── What a report shows ────────────────────────────────────────────────────────────────────────

/** The keys of the report's frozen survey breakdowns, in their frozen order. */
export const breakdownKeysOf = (report) =>
  (report?.stats?.cumulative?.surveyBreakdowns || []).map((b) => b.questionKey).filter(Boolean);

/** visibleQuestionKeys ∩ the frozen breakdown keys. Empty means none (§F1). */
export const visibleKeysFor = (report) => {
  const wanted = new Set(report?.visibility?.visibleQuestionKeys || []);
  return breakdownKeysOf(report).filter((k) => wanted.has(k));
};

/**
 * The map questions the report's CURRENT settings allow: mapAnswerKeys ∩ visibleKeysFor, each with
 * every dependency in the set too — or none when the map is off. `questionDeps` is the live
 * snapshot's frozen record (liveInputs).
 */
export const mapKeysFor = (report, questionDeps = []) => {
  if (report?.visibility?.showMap === false) return [];
  const visible = new Set(visibleKeysFor(report));
  const candidates = [...new Set(report?.visibility?.mapAnswerKeys || [])].filter((k) => visible.has(k));
  return closeUnderDeps(candidates, depsMap(questionDeps));
};

/** The choice questions of a survey, by key. */
export const choiceKeysOf = (template) =>
  (template?.questions || []).filter((q) => q && isChoiceType(q.type)).map((q) => q.key);

/**
 * The map keys a NEW build should produce from on-screen settings, before it has numbers to
 * intersect with: mapAnswerKeys ∩ visibleQuestionKeys ∩ the survey's choice questions, closed under
 * the dependencies the build will freeze.
 */
export const buildMapKeysFor = (visibility, template, questionDeps) => {
  if (visibility?.showMap === false) return [];
  const visible = new Set(visibility?.visibleQuestionKeys || []);
  const choice = new Set(choiceKeysOf(template));
  const candidates = [...new Set(visibility?.mapAnswerKeys || [])].filter((k) => visible.has(k) && choice.has(k));
  return closeUnderDeps(candidates, depsMap(questionDeps));
};

// A report with nothing live: no snapshot of its own, and nothing published before snapshots either.
const nothingLive = () => ({ showMap: false, mapMode: 'pins', areaSize: 'small', mapKeys: [], questionDeps: [], coordinatorIds: [] });

/**
 * Published before snapshots: no snapshotInputs, and published (taken down included). A report read
 * WITHOUT its status (a caller's narrow projection — every stored report has one) takes the same
 * fail-closed fallback rather than "nothing live", so a check scanning the other published reports
 * of a link can never miss one's served map.
 */
export const isLegacyPublished = (report) =>
  !(report?.snapshotInputs && typeof report.snapshotInputs === 'object') && (report?.status === 'published' || report?.status == null);

/**
 * What the live snapshot was built with. snapshotInputs when the report has one. A report PUBLISHED
 * before this change has none, and its rows are still served: its current settings stand in (its
 * rows were built from them), with the dependencies of every survey its answers can have come from —
 * `templates` (legacyTemplatesFor, clientReportMap.js), or the one `template` given. Only that
 * fallback reads them. It fails closed: a map question that is no question of any of those surveys
 * has unknowable dependencies, so it is never served — and with no survey at all, no map question is.
 * It holds while a Refresh of such a report runs (the build object is no test: the legacy rows stay
 * live until Apply). Any OTHER report without snapshotInputs — a draft whose first build hasn't
 * committed, or a draft from before this change — has nothing live (its old rows, if any, are never
 * served; its first build maps only its current survey, §O6): no map, no map questions.
 */
export const liveInputs = (report, { template = null, templates = null } = {}) => {
  const si = report?.snapshotInputs;
  if (si && typeof si === 'object') {
    return {
      showMap: si.showMap === true,
      mapMode: si.mapMode === 'area' ? 'area' : 'pins',
      areaSize: si.areaSize === 'large' ? 'large' : 'small',
      mapKeys: Array.isArray(si.mapKeys) ? si.mapKeys.map(String) : [],
      questionDeps: Array.isArray(si.questionDeps) ? si.questionDeps : [],
      coordinatorIds: Array.isArray(si.coordinatorIds) ? si.coordinatorIds : [],
    };
  }
  if (!isLegacyPublished(report)) return nothingLive();
  const surveys = (templates ?? [template]).filter(Boolean);
  const questionDeps = questionDepsOf(surveys);
  const known = new Set(surveys.flatMap((t) => (t.questions || []).map((q) => q?.key).filter(Boolean)));
  // Closed again after the unknown keys go: a follow-up never outlives a parent dropped here.
  const mapKeys = closeUnderDeps(mapKeysFor(report, questionDeps).filter((k) => known.has(k)), depsMap(questionDeps));
  return {
    showMap: report?.visibility?.showMap !== false,
    // Every report frozen before area view existed is a pins report, whatever a later draft edit
    // set on screen.
    mapMode: 'pins',
    areaSize: 'small',
    mapKeys,
    questionDeps,
    coordinatorIds: [],
  };
};

/** Is the map served at all? Both sides must say yes (§O1). */
export const mapServed = (report, inputs) => report?.visibility?.showMap !== false && !!inputs?.showMap;

/** The map questions a reader may serve: mapKeysFor ∩ the live snapshot's mapKeys (§O1). */
export const servedMapKeys = (report, inputs) => {
  if (!mapServed(report, inputs)) return [];
  const built = new Set(inputs.mapKeys || []);
  return mapKeysFor(report, inputs.questionDeps).filter((k) => built.has(k));
};

/** The live snapshot's cut-off (§O3): statsComputedAt, or publishedAt for a report from before it. */
export const numbersCutOff = (report) => report?.statsComputedAt || report?.publishedAt || null;

// A key the client can group by without learning an id or a time: an HMAC of the series id (or, for
// a report not yet in a series, of its campaign or walk list), salted with the server's secret.
export const opaqueKey = (value) =>
  crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'doorline-client-reports')
    .update(String(value))
    .digest('base64url')
    .slice(0, 16);

/** The client's tab key for a report's series (§F0): seriesId, else legacy:<walk list or campaign>. */
export const seriesKeyOf = (report) =>
  opaqueKey(report?.seriesId ? `series:${report.seriesId}` : `legacy:${report?.effortId || report?.campaignId}`);

/** The report's frozen scope, with the fallback a report from before series reads as. */
export const scopeOf = (report) => {
  if (report?.scope?.kind) return { kind: report.scope.kind, label: report.scope.label || '' };
  if (report?.effortId) return { kind: 'walk_list', label: report.effortName || 'Walk list' };
  return { kind: 'campaign', label: 'Whole campaign' };
};

export const isTeamScope = (kind) => kind === 'team' || kind === 'team_walk_list';

// "Oct 13 – Oct 19, 2026" from two civil dates — History rows name a report's period, never its
// title. No time zone: the strings already mean days in the report's own zone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const civil = (day) => {
  const [y, m, d] = String(day || '').split('-').map(Number);
  return { y, label: m && d ? `${MONTHS[m - 1]} ${d}` : String(day || '') };
};
export const periodLabelOf = (report) => {
  const a = civil(report?.weekStart);
  const b = civil(report?.weekEnd);
  return a.y === b.y ? `${a.label} – ${b.label}, ${b.y}` : `${a.label}, ${a.y} – ${b.label}, ${b.y}`;
};
