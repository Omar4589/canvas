import { haversineMeters } from '../../utils/normalizeAddress.js';
import { isUnitAddress } from '../../utils/streetName.js';

// Automatic pause — the ONE pace rule (docs/PROPOSAL_PACE_PAUSE.md §B). Pure: no DB, no clock, no req.
// The live check on the mobile write paths, the review screens and the console replay all call these
// functions, so they can never disagree about what a visit is or whether it failed.
//
// The rule in one sentence: a canvasser's saves at one door no more than PACE_SAME_VISIT_SEC apart are one
// VISIT; each visit is judged once, from the latest entry before it at a DIFFERENT door, and fails when there
// wasn't time to drive there at PACE_TRAVEL_MPS and still spend PACE_DOOR_SEC at the door (PACE_SURVEY_SEC
// for a survey); 8 fails in any 20 judged visits of a day pause the canvasser.

export const PACE_DEFAULTS = Object.freeze({
  doorSec: 15, // seconds at a door
  surveySec: 45, // seconds at a door for a survey
  travelMps: 11.2, // 25 mph
  window: 20, // judged visits per window
  failsToPause: 8,
  sameVisitSec: 600, // entries at one door no more than this far apart are one visit
  stillM: 20, // label only: moved less than this = "saved from one spot"
  vehicleMph: 5, // label only: at or above = "vehicle speed"
});

const ENV_NAMES = {
  doorSec: 'PACE_DOOR_SEC',
  surveySec: 'PACE_SURVEY_SEC',
  travelMps: 'PACE_TRAVEL_MPS',
  window: 'PACE_WINDOW',
  failsToPause: 'PACE_FAILS_TO_PAUSE',
  sameVisitSec: 'PACE_SAME_VISIT_SEC',
  stillM: 'PACE_STILL_M',
  vehicleMph: 'PACE_VEHICLE_MPH',
};
const WHOLE = new Set(['window', 'failsToPause']);

// The numbers in force. `env` is process.env for the server; `overrides` are the replay's --flags. A value
// that isn't a positive finite number (or, for the two counts, a positive integer) falls back to the default
// with one warning, so a typo in a config var can never switch the rule off or make it absurd.
const warned = new Set();
export const paceConfig = (env = process.env, overrides = {}) => {
  const out = { ...PACE_DEFAULTS };
  for (const [key, name] of Object.entries(ENV_NAMES)) {
    const raw = overrides[key] ?? env?.[name];
    if (raw === undefined || raw === null || raw === '') continue;
    const n = Number(raw);
    const ok = Number.isFinite(n) && n > 0 && (!WHOLE.has(key) || Number.isInteger(n));
    if (ok) out[key] = n;
    else if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[pace] ${name}=${raw} is not usable; using ${PACE_DEFAULTS[key]}`);
    }
  }
  if (out.failsToPause > out.window) out.failsToPause = out.window;
  return out;
};

// Results a visit is judged on (decisions 4 and 14). Wrong address, No soliciting, Restricted and lit drops
// are never judged, though they still count as "the last thing saved" for the next door's timing.
export const JUDGED_RESULTS = new Set(['not_home', 'refused', 'survey_submitted', 'not_target']);
const SURVEY = 'survey_submitted';

// How many earlier saves a standing row remembers (CanvassActivity.replaced.history).
export const HISTORY_CAP = 20;

// ── The ledger's memory of re-saves (§B.2) ──────────────────────────────────────────────────────────
// "Latest wins" deletes a canvasser's earlier entry at a door before creating the new row
// (routes/mobile/canvass.js), so without this a door saved twice would leave only its second save, and a
// visit could be erased by saving the door again. buildReplacedSnapshot stamps this onto the new row from the
// pre-delete prior row — server-side only, never from the request body.
//
// `actionType` is the result as the canvasser recorded it: an admin's later conversion on Door Outcomes
// stamps `reclassified.from`, and the rule judges what happened at the door, not what it was relabelled.
export const historyEntryOf = (row) => ({
  at: row.timestamp ?? null,
  lat: row.location?.lat ?? null,
  lng: row.location?.lng ?? null,
  accuracy: row.location?.accuracy ?? null,
  actionType: row.reclassified?.from ?? row.actionType ?? null,
  createdAt: row.createdAt ?? null,
  offline: row.wasOfflineSubmission ?? null,
});

// A row written before history existed carries only the one-level snapshot; it becomes a single entry
// whose receive time and offline flag are unknown.
const legacyHistory = (snapshot) =>
  snapshot?.timestamp
    ? [{
        at: snapshot.timestamp,
        lat: snapshot.location?.lat ?? null,
        lng: snapshot.location?.lng ?? null,
        accuracy: snapshot.location?.accuracy ?? null,
        actionType: snapshot.actionType ?? null,
        createdAt: null,
        offline: null,
      }]
    : [];

// What a row remembers. A snapshot written since history exists always holds at least its prior, so an empty
// or missing list means a pre-history row (or a hydrated default), and its one-level snapshot is the history.
const rememberedBy = (row) => (row.replaced?.history?.length ? row.replaced.history : legacyHistory(row.replaced));

// The history a new row inherits from the row it replaces: everything the prior remembered, plus the prior.
export const historyFor = (prior) => [...rememberedBy(prior), historyEntryOf(prior)].slice(-HISTORY_CAP);

// ── Entries (§B.2) ──────────────────────────────────────────────────────────────────────────────────
// Every standing row's own entry plus its history, minus notes and admin desk marks (the rapid flag's
// exclusions, flagDetection.js computeReasons). `rows` are lean CanvassActivity docs; times become ms.
const ms = (v) => (v == null ? null : new Date(v).getTime());
const located = (e) => Number.isFinite(e.lat) && Number.isFinite(e.lng);

export const entriesOf = (rows) => {
  const entries = [];
  rows.forEach((row, seq) => {
    if (row.actionType === 'note_added' || row.via === 'bulk') return;
    const door = String(row.householdId);
    const base = { householdId: door, campaignId: row.campaignId ? String(row.campaignId) : null, knockPin: row.knockPin ?? null, rowId: String(row._id), seq };
    const own = historyEntryOf(row);
    for (const h of rememberedBy(row)) {
      if (h?.at == null) continue;
      entries.push({ ...base, at: ms(h.at), lat: h.lat, lng: h.lng, accuracy: h.accuracy, result: h.actionType, createdAt: ms(h.createdAt), offline: h.offline, standing: false });
    }
    entries.push({ ...base, at: ms(own.at), lat: own.lat, lng: own.lng, accuracy: own.accuracy, result: own.actionType, createdAt: ms(own.createdAt), offline: own.offline, standing: true });
  });
  // Time, then the row's order, then history before its own standing entry. Two saves at the same instant
  // at one door collapse to the later one (a duplicate delivery or a history entry equal to its row).
  entries.sort((a, b) => a.at - b.at || a.seq - b.seq || Number(a.standing) - Number(b.standing));
  const out = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.householdId === e.householdId && last.at === e.at) out[out.length - 1] = e;
    else out.push(e);
  }
  return out;
};

// ── Visits (§B.3) ───────────────────────────────────────────────────────────────────────────────────
// Per door, entries no more than sameVisitSec apart are one visit (a second voter, a correction, a Not home
// followed by a survey when someone answers); a longer gap starts a new one (a callback). Formed from times
// alone, never from links between rows, so two writes that raced to one door are still one visit.
export const visitsOf = (entries, config = PACE_DEFAULTS) => {
  const open = new Map();
  const visits = [];
  for (const e of entries) {
    const v = open.get(e.householdId);
    if (v && e.at - v.entries[v.entries.length - 1].at <= config.sameVisitSec * 1000) {
      v.entries.push(e);
    } else {
      const nv = { householdId: e.householdId, campaignId: e.campaignId, entries: [e] };
      visits.push(nv);
      open.set(e.householdId, nv);
    }
  }
  for (const v of visits) {
    v.first = v.entries[0];
    v.last = v.entries[v.entries.length - 1];
    v.result = v.last.result;
    v.campaignId = v.last.campaignId ?? v.first.campaignId;
    v.knockPin = v.last.knockPin;
    v.standingRowId = v.last.rowId;
  }
  return visits;
};

// ── Judging (§B.4) ──────────────────────────────────────────────────────────────────────────────────
// Distance left after allowing for both phones' accuracy: the far rule's effectiveMeters applied twice. A
// radius only ever discounts.
const discounted = (meters, a, b) => Math.max(0, meters - Math.max(0, a ?? 0) - Math.max(0, b ?? 0));

const hop = (from, to, allowanceSec, config) => {
  const gapSec = (to.at - from.at) / 1000;
  const meters = located(from) && located(to) ? haversineMeters(from.lat, from.lng, to.lat, to.lng) : 0;
  const effectiveMeters = discounted(meters, from.accuracy, to.accuracy);
  const neededSec = effectiveMeters / config.travelMps + allowanceSec;
  return { at: to.at, gapSec, meters, effectiveMeters, neededSec, fail: gapSec < neededSec };
};

const patternOf = (h, config) => {
  if (h.meters < config.stillM) return 'still';
  const mph = h.gapSec > 0 ? (h.meters / h.gapSec) * 2.23694 : Infinity;
  return mph >= config.vehicleMph ? 'vehicle' : 'walking';
};

// `households` maps householdId → { addressLine1, addressLine2 } for the unit test; a door with no entry is
// treated as not a unit. The canvasser-role test (decision 13) is the caller's: this only judges doors.
// Returns one verdict per visit, in visit-start order:
//   { visit, judged: false, why }                          — not judged ('result', 'unit' or 'first')
//   { visit, judged: true, fail, pattern, prev, ...hop, surveyCheck }
export const judgeVisits = (visits, entries, { households = new Map(), config = PACE_DEFAULTS } = {}) => {
  // The predecessor of every entry in one pass: the latest earlier entry at a different door is either the
  // latest entry overall (when it is at another door) or the latest entry at a door other than that one.
  const prevOf = new Map();
  let last = null;
  let lastOther = null; // latest entry at a door different from last's
  for (const e of entries) {
    prevOf.set(e, last && last.householdId !== e.householdId ? last : lastOther);
    if (last && last.householdId !== e.householdId) lastOther = last;
    last = e;
  }

  const verdicts = [];
  for (const visit of [...visits].sort((a, b) => a.first.at - b.first.at || a.first.seq - b.first.seq)) {
    if (!JUDGED_RESULTS.has(visit.result)) {
      verdicts.push({ visit, judged: false, why: 'result' });
      continue;
    }
    if (visit.knockPin === 'complex' || isUnitAddress(households.get(visit.householdId))) {
      verdicts.push({ visit, judged: false, why: 'unit' });
      continue;
    }
    const prev = prevOf.get(visit.first);
    if (!prev) {
      // The day's first door has nothing to be compared with: it counts toward the window and passes.
      verdicts.push({ visit, judged: true, fail: false, first: true, prev: null, surveyCheck: null });
      continue;
    }
    // Check 1: the visit's first entry (45 seconds when that entry is itself a survey).
    const firstIsSurvey = visit.first.result === SURVEY;
    const h1 = hop(prev, visit.first, firstIsSurvey ? config.surveySec : config.doorSec, config);
    // Check 2: a survey later in the visit, from the same predecessor — a Not home tapped after the knock
    // and a survey saved minutes later both pass; a survey saved seconds after a Not home from a car fails.
    const survey = firstIsSurvey ? null : visit.entries.find((e, i) => i > 0 && e.result === SURVEY);
    const surveyCheck = survey ? hop(prev, survey, config.surveySec, config) : null;
    verdicts.push({
      visit,
      judged: true,
      prev,
      ...h1,
      fail: h1.fail || Boolean(surveyCheck?.fail),
      pattern: patternOf(h1, config),
      surveyCheck,
    });
  }
  return verdicts;
};

// ── Counting and windows (§B.5) ─────────────────────────────────────────────────────────────────────
// A visit counts when its first entry falls after the restart point: an entry saved live is compared by its
// server receive time (createdAt), a replay or an entry of unknown origin by its tap time. Fresh writes are
// refused while a canvasser is blocked, so anything created live after an unpause is post-unpause work, and
// a phone clock set wrong can't move entries across the restart.
export const countsAfter = (verdict, restartAt) => {
  if (restartAt == null) return true;
  const f = verdict.visit.first;
  const t = f.offline === false && f.createdAt != null ? f.createdAt : f.at;
  return t > restartAt;
};

// The first run of `window` consecutive counted visits holding failsToPause fails or more, scanning in time
// order (any run, not only the latest, so a late batch from a stuck offline queue is still seen). Returns
// null, or { window: verdicts, fails, trigger } where trigger is the visit that completed the run.
export const findPause = (verdicts, { restartAt = null, config = PACE_DEFAULTS } = {}) => {
  const counted = verdicts.filter((v) => v.judged && countsAfter(v, restartAt));
  for (let i = 0; i < counted.length; i++) {
    const run = counted.slice(Math.max(0, i - config.window + 1), i + 1);
    const fails = run.filter((v) => v.fail).length;
    if (fails >= config.failsToPause) return { window: run, fails, trigger: counted[i] };
  }
  return null;
};

// The console replay: every would-be pause, each treated as lifted at once (the count restarts
// after its trigger). `worst` is the most fails any window reached, for "how close did it come".
export const replayPauses = (verdicts, config = PACE_DEFAULTS) => {
  const pauses = [];
  let restartAt = null;
  let worst = 0;
  for (;;) {
    const counted = verdicts.filter((v) => v.judged && countsAfter(v, restartAt));
    let found = null;
    for (let i = 0; i < counted.length && !found; i++) {
      const run = counted.slice(Math.max(0, i - config.window + 1), i + 1);
      const fails = run.filter((v) => v.fail).length;
      worst = Math.max(worst, fails);
      if (fails >= config.failsToPause) found = { window: run, fails, trigger: counted[i] };
    }
    if (!found) break;
    pauses.push(found);
    // Lifted at once: the next count starts after the trigger, by the same clock countsAfter reads.
    const f = found.trigger.visit.first;
    restartAt = f.offline === false && f.createdAt != null ? f.createdAt : f.at;
  }
  return { pauses, worst };
};

// The review's plain sentence, as counts: the failing visits by pattern and their speed range.
export const summarize = (window) => {
  const fails = window.filter((v) => v.fail);
  const mph = fails
    .filter((v) => v.pattern === 'vehicle' && v.gapSec > 0)
    .map((v) => (v.meters / v.gapSec) * 2.23694);
  return {
    fails: fails.length,
    vehicle: fails.filter((v) => v.pattern === 'vehicle').length,
    still: fails.filter((v) => v.pattern === 'still').length,
    walking: fails.filter((v) => v.pattern === 'walking').length,
    minMph: mph.length ? Math.min(...mph) : null,
    maxMph: mph.length ? Math.max(...mph) : null,
  };
};
