import mongoose from 'mongoose';
import { CanvassActivity } from '../../models/CanvassActivity.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { KNOCK_ACTIONS, NOT_BULK } from '../reports/aggregations.js';
import { US_TIMEZONES } from '../../utils/usStateTimeZone.js';
import { zonedDayRange, zonedDayStr } from '../../utils/timezone.js';
import { addDays } from '../reports/goalProgress.js';
import { normPersonId } from './shiftOwner.js';

// DOOR COUNTS TO FBTIME — the count, the request plan, the clear slices and the status
// model. Pure helpers plus one aggregation, so the arithmetic is unit-testable; the I/O
// and the state machine live in doorPush.js. The design, the owner's rulings and four
// review rounds are in docs/PROPOSAL_FBTIME_DOOR_COUNTS.md; the provider's contract is
// FbTimeApp/docs/PARTNER_API.md ("PUT /doors", "Sending door counts").
//
// THE NUMBER IS THE TIMELINE'S (owner ruling): per canvasser per local day, every row
// with actionType in KNOCK_ACTIONS or 'restricted', NOT_BULK, a row counting unless it is
// 'restricted' — the canvasser-timeline aggregation in routes/admin/reports.js, in its
// org-wide form (no campaign filter, so no knock can fall out because of a campaign
// lookup). Never knocksPipeline: it dedupes doors ACROSS canvassers for billing.

export { normPersonId };

export const DOORS_RECENT_DAYS = 7;
export const DOORS_DEEP_DAYS = 120; // FbTime's per-request maximum
if (DOORS_DEEP_DAYS > 120) throw new Error('DOORS_DEEP_DAYS must stay ≤ 120 (FbTime refuses longer windows)');
export const DOORS_MAX_PER_DAY = 2000; // FbTime refuses a bigger person-day
export const PERSON_DAYS_PER_REQUEST = 5000; // keeps every request far inside FbTime's 30s router limit
export const MAX_PEOPLE_PER_REQUEST = 500;
export const CLEAR_SLICE_DAYS = 120;
export const CLEAR_FLOOR_DAYS = 729; // never refused by FbTime's "≥ 2 years back" check
export const CONFIRM_AFTER_MS = 15 * 60 * 1000;
export const STUCK_AFTER_RUNS = 8; // ~2 hours of 15-minute runs — FbTime's own "overdue" threshold

export const SCOPE_DOORS_WRITE = 'doors:write';
export const FEATURE_REPORTED_WINS = 'doors:reported-wins';
// The flag an EXPLICIT clear carries, so FbTime brings back the numbers people had typed
// on those days (owner ruling 14). Window-replace sends never carry it.
export const EXPLICIT_CLEAR_FLAG = 'restoreTyped';

// The release var, read at call time like OPT_IN_OUTCOMES — a change in the Heroku
// dashboard restarts the dynos and takes effect with no deploy. Unset = door counts don't
// exist anywhere; unsetting it later is the Doorline-wide kill switch.
export const doorCountsAvailable = (raw = process.env.FBTIME_DOOR_COUNTS) =>
  ['on', 'true', '1'].includes(String(raw ?? '').trim().toLowerCase());

export class DoorCountError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'DoorCountError';
    this.code = code;
    this.detail = detail;
  }
}

const CURATED_ZONES = new Set(US_TIMEZONES.map((z) => z.value));
export const isCuratedZone = (tz) => CURATED_ZONES.has(tz);

/**
 * The org's zone and every campaign's, from ONE resolver mirroring the Timeline's
 * fallback (campaign → org → America/New_York), each checked against the server's
 * curated US list. Intl alone is not enough: it accepts "america/chicago", "us/eastern"
 * and "utc", which MongoDB's $dateToString rejects (error 40485) — one such campaign
 * would stop every count for the org with an unnamed error. Here it is named.
 * → { orgTz, all: string[], byZone: Map<tz, ObjectId[]> }
 */
export const resolveZones = async (organizationId) => {
  const org = await Organization.findById(organizationId).select('timeZone').lean();
  const orgTz = org?.timeZone || 'America/New_York';
  if (!isCuratedZone(orgTz)) {
    throw new DoorCountError('INVALID_TIMEZONE', { organization: true, timeZone: orgTz });
  }
  const campaigns = await Campaign.find({ organizationId }).select('_id name timeZone').lean();
  const byZone = new Map();
  for (const c of campaigns) {
    const tz = c.timeZone || orgTz;
    if (!isCuratedZone(tz)) {
      throw new DoorCountError('INVALID_TIMEZONE', {
        campaignId: String(c._id),
        campaignName: c.name,
        timeZone: tz,
      });
    }
    if (!byZone.has(tz)) byZone.set(tz, []);
    byZone.get(tz).push(new mongoose.Types.ObjectId(String(c._id)));
  }
  return { orgTz, all: [...new Set([orgTz, ...byZone.keys()])], byZone };
};

/** The send window: `windowDays` days ending at the LATEST local today across the zones. */
export const doorsWindow = (zones, windowDays, now = new Date()) => {
  const endDate = zones.map((tz) => zonedDayStr(now, tz)).sort().at(-1);
  return { startDate: addDays(endDate, -(windowDays - 1)), endDate };
};

/**
 * The accounts door counts are about — ONE owner for the count, the requests, the clears,
 * the per-request re-check and the card. Every link (person ids lower-cased, 24 hex,
 * de-duplicated), plus each kept account (decision 9) whose PERSON is linked, whose
 * ACCOUNT has no link of its own now, and whose person has no first-pass clear waiting.
 * Accounts are de-duplicated by userId (zero double counts in every interleaving of these
 * reads against the link routes' writes — round 4).
 * → { accounts: [{ userId, fbtimePersonId, until? }], personIds: string[] (sorted) }
 */
export const loadDoorAccounts = async (organizationId, connection) => {
  const links = await FbTimePersonLink.find({ organizationId }).select('userId fbtimePersonId').lean();
  const waitingFirstPass = new Set(
    (connection?.doors?.clearPersons || [])
      .filter((c) => !c.confirmAfter)
      .map((c) => normPersonId(c.fbtimePersonId))
      .filter(Boolean)
  );
  const accounts = [];
  const persons = new Set();
  const users = new Set();
  for (const l of links) {
    const pid = normPersonId(l.fbtimePersonId);
    const uid = String(l.userId);
    if (!pid || users.has(uid)) continue;
    users.add(uid);
    persons.add(pid);
    accounts.push({ userId: uid, fbtimePersonId: pid });
  }
  for (const k of connection?.keptAccounts || []) {
    const pid = normPersonId(k.fbtimePersonId);
    const uid = String(k.userId);
    if (!pid || !persons.has(pid) || users.has(uid) || waitingFirstPass.has(pid)) continue;
    users.add(uid);
    accounts.push({ userId: uid, fbtimePersonId: pid, until: k.until ? new Date(k.until) : null });
  }
  return { accounts, personIds: [...persons].sort() };
};

/** Each person's set of accounts, as a comparable signature (the per-request re-check). */
export const accountSignatures = (accounts) => {
  const by = new Map();
  for (const a of accounts) {
    if (!by.has(a.fbtimePersonId)) by.set(a.fbtimePersonId, []);
    by.get(a.fbtimePersonId).push(`${a.userId}@${a.until ? new Date(a.until).getTime() : ''}`);
  }
  const out = new Map();
  for (const [pid, list] of by) out.set(pid, list.sort().join(','));
  return out;
};

/**
 * The count. `accounts` must not be empty (the caller skips the count when nobody is
 * linked — an empty $or is a MongoDB BadValue). All or nothing: any throw fails the send
 * before a single send request (a partial count would read as "nobody worked", and FbTime
 * would clear those days).
 * → { startDate, endDate, cells: Map<"personId|YYYY-MM-DD", knocks> } — the window travels
 *   WITH the cells, so a request can never be built over cells of another window.
 */
export const countDoorsByPersonDay = async ({ organizationId, accounts, startDate, endDate, zones }) => {
  if (!accounts.length) throw new Error('countDoorsByPersonDay needs at least one account');
  const orgId = new mongoose.Types.ObjectId(String(organizationId));
  const gte = new Date(Math.min(...zones.all.map((tz) => zonedDayRange(startDate, startDate, tz).$gte.getTime())));
  const lt = new Date(Math.max(...zones.all.map((tz) => zonedDayRange(endDate, endDate, tz).$lt.getTime())));
  // A Number in an aggregate $match matches NOTHING, silently — aggregates are never cast.
  if (!(gte instanceof Date) || !(lt instanceof Date) || Number.isNaN(gte.getTime()) || Number.isNaN(lt.getTime())) {
    throw new Error('door count window did not resolve to Dates');
  }
  const personOf = new Map(accounts.map((a) => [String(a.userId), a.fbtimePersonId]));
  const who = accounts.map((a) => ({
    userId: new mongoose.Types.ObjectId(String(a.userId)),
    ...(a.until ? { timestamp: { $lt: new Date(a.until) } } : {}), // a kept account counts only before `until`
  }));
  const others = [...zones.byZone].filter(([tz]) => tz !== zones.orgTz);
  const tzExpr = others.length
    ? {
        $switch: {
          branches: others.map(([tz, ids]) => ({ case: { $in: ['$campaignId', ids] }, then: tz })),
          default: zones.orgTz,
        },
      }
    : zones.orgTz; // never a zero-branch $switch (MongoDB error 40068)

  let rows;
  try {
    rows = await CanvassActivity.aggregate([
      {
        $match: {
          organizationId: orgId,
          timestamp: { $gte: gte, $lt: lt },
          actionType: { $in: [...KNOCK_ACTIONS, 'restricted'] },
          ...NOT_BULK,
          $or: who,
        },
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: tzExpr } },
          },
          knocks: { $sum: { $cond: [{ $eq: ['$actionType', 'restricted'] }, 0, 1] } },
        },
      },
    ]);
  } catch (err) {
    // A zone MongoDB doesn't know (resolveZones should have caught it) — name it the same way.
    if (err?.code === 40485) throw new DoorCountError('INVALID_TIMEZONE', { message: err.message });
    throw err;
  }

  const cells = new Map();
  for (const r of rows) {
    const day = r._id.day;
    if (!day || day < startDate || day > endDate) continue; // the union window's edges belong to other zones' days
    const pid = personOf.get(String(r._id.userId));
    if (!pid) continue;
    const key = `${pid}|${day}`;
    cells.set(key, (cells.get(key) || 0) + r.knocks); // two accounts of one person: summed
  }
  return { startDate, endDate, cells };
};

export const peoplePerRequest = (windowDays) =>
  Math.max(1, Math.min(MAX_PEOPLE_PER_REQUEST, Math.floor(PERSON_DAYS_PER_REQUEST / windowDays)));

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * Plan the send requests. `count` is countDoorsByPersonDay's result; `groups` is
 * [{ windowDays, startDate, endDate, personIds }]. Every group's window must lie inside
 * the count's (asserted). People per request are bounded by person-days; a cell over
 * FbTime's 2,000 is left out (FbTime clears that day) and reported back.
 * → { requests: [{ windowDays, personIds, body }], overCap: [{ fbtimePersonId, date, knocks }] }
 */
export const planDoorRequests = (count, groups) => {
  const requests = [];
  const overCap = [];
  for (const g of groups) {
    if (!g.personIds.length) continue;
    if (g.startDate < count.startDate || g.endDate > count.endDate) {
      throw new Error(`door request window ${g.startDate}..${g.endDate} lies outside the count's ${count.startDate}..${count.endDate}`);
    }
    for (const people of chunk([...g.personIds].sort(), peoplePerRequest(g.windowDays))) {
      const counts = [];
      for (const pid of people) {
        for (let d = g.startDate; d <= g.endDate; d = addDays(d, 1)) {
          const knocks = count.cells.get(`${pid}|${d}`);
          if (knocks === undefined) continue; // no activity that day → no count (never a zero)
          if (knocks > DOORS_MAX_PER_DAY) {
            overCap.push({ fbtimePersonId: pid, date: d, knocks });
            continue;
          }
          counts.push({ userId: pid, date: d, doors: knocks });
        }
      }
      requests.push({
        windowDays: g.windowDays,
        personIds: people,
        body: { startDate: g.startDate, endDate: g.endDate, userIds: people, counts },
      });
    }
  }
  return { requests, overCap };
};

export const utcDay = (now = new Date()) => new Date(now).toISOString().slice(0, 10);

/**
 * A clear's date range: from the earliest day Doorline ever sent (never earlier than the
 * 729-day floor — always inside FbTime's 2-year limit), to tomorrow UTC, in ≤ 120-day
 * slices. No earliestDate (nothing ever sent) or an empty range → [].
 */
export const clearSlices = (earliestDate, now = new Date()) => {
  if (!earliestDate) return [];
  const today = utcDay(now);
  const floor = addDays(today, -CLEAR_FLOOR_DAYS);
  const from = earliestDate > floor ? earliestDate : floor;
  const to = addDays(today, 1);
  if (from > to) return [];
  const slices = [];
  for (let s = from; s <= to; s = addDays(s, CLEAR_SLICE_DAYS)) {
    const e = addDays(s, CLEAR_SLICE_DAYS - 1);
    slices.push({ startDate: s, endDate: e < to ? e : to });
  }
  return slices;
};

/** Clear groups: up to the 120-day request size, rotated so one failing group can't starve the rest. */
export const clearGroups = (personIds, rotation = 0) => {
  const groups = chunk([...personIds].sort(), peoplePerRequest(CLEAR_SLICE_DAYS));
  if (groups.length < 2) return groups;
  const k = ((rotation % groups.length) + groups.length) % groups.length;
  return [...groups.slice(k), ...groups.slice(0, k)];
};

// failCodes Doorline sets itself — everything else in failCode is FbTime's own 4xx code.
export const DOORLINE_FAIL_CODES = new Set(['DOORS_REPORTER_TAKEN', 'SCOPE_REQUIRED', 'INVALID_TIMEZONE', 'STUCK']);

/**
 * Is a clear due in this run (first pass, or a confirm pass whose time has come)?
 */
export const clearsDue = (doors, now = new Date()) => {
  const t = new Date(now).getTime();
  const due = (c) => !c.confirmAfter || new Date(c.confirmAfter).getTime() <= t;
  const persons = (doors?.clearPersons || []).some(due);
  const all =
    doors?.clearAll === true &&
    (!doors.clearAllConfirmAfter || new Date(doors.clearAllConfirmAfter).getTime() <= t);
  return persons || all;
};

/** Is any clear still waiting (incl. a confirm pass not yet due)? */
export const clearsWaiting = (doors) => (doors?.clearPersons || []).length > 0 || doors?.clearAll === true;

/** A first pass is waiting (Disconnect and an org change refuse while one is). */
export const firstPassWaiting = (doors) =>
  (doors?.clearPersons || []).some((c) => !c.confirmAfter) ||
  (doors?.clearAll === true && !doors.clearAllConfirmAfter);

/**
 * THE status model — one owner; web and phone render it, never re-derive.
 * `connection` is LEAN; `extras = { available, otherReporter, enabledByName, names, canClearAll }`.
 */
export const doorsStatus = (connection, extras = {}) => {
  const doors = connection?.doors || {};
  const enabled = doors.enabled === true;
  const scopes = connection?.keyScopes;
  const features = connection?.fbtimeFeatures;
  const canWrite = Array.isArray(scopes) ? scopes.includes(SCOPE_DOORS_WRITE) : null;
  const reportedWins = Array.isArray(features) ? features.includes(FEATURE_REPORTED_WINS) : null;
  const available = extras.available === true;
  const errored = connection?.status === 'errored';
  const failCode = doors.failCode || null;

  let paused = null;
  if (errored) paused = 'connection';
  else if (!available) paused = 'doorline';
  else if (reportedWins === false) paused = 'fbtime-outdated';

  let attention = null;
  if (extras.otherReporter) attention = 'conflict';
  else if (canWrite === false) attention = 'needs-permission';
  else if (failCode === 'INVALID_TIMEZONE') attention = 'timezone';
  else if (failCode && !DOORLINE_FAIL_CODES.has(failCode)) attention = 'refused';
  else if (failCode === 'STUCK') attention = 'stuck';

  // What would stop a waiting clear right now, first that applies.
  let blockedBy = null;
  if (clearsWaiting(doors)) {
    if (errored) blockedBy = 'paused';
    else if (!available) blockedBy = 'unavailable';
    else if (reportedWins === false) blockedBy = 'fbtime-outdated';
    else if (extras.otherReporter) blockedBy = 'conflict';
    else if (canWrite === false) blockedBy = 'needs-permission';
    else if (failCode && !DOORLINE_FAIL_CODES.has(failCode) && doors.failPhase === 'clear') blockedBy = 'refused';
    else if (failCode === 'STUCK') blockedBy = 'stuck';
  }
  const runnableClear = clearsWaiting(doors) && !blockedBy;

  let state;
  let reason = null;
  if (enabled) {
    if (paused) [state, reason] = ['paused', paused];
    else if (attention) [state, reason] = ['attention', attention];
    else if (runnableClear) state = 'clearing';
    else if (!doors.lastSentAt || (doors.enabledAt && new Date(doors.lastSentAt) < new Date(doors.enabledAt))) state = 'starting';
    else state = 'sending';
  } else if (runnableClear) {
    state = 'clearing';
  } else {
    state = 'off';
    if (extras.otherReporter) reason = 'conflict';
    else if (canWrite === false) reason = 'hours-only-key';
    else if (canWrite === true && doors.enabledAt) reason = 'revoke-door-key';
  }

  // Results from before the latest turn-on are hidden (read-side; nothing is lost).
  const sinceOn = (at) => !doors.enabledAt || (at && new Date(at) >= new Date(doors.enabledAt));
  const names = extras.names || new Map();
  const nameOf = (pid) => names.get(pid)?.name || names.get(pid)?.fbtimeName || null;

  return {
    available,
    enabled,
    enabledAt: doors.enabledAt || null,
    enabledBy: extras.enabledByName ? { name: extras.enabledByName } : null,
    canWrite,
    reportedWins,
    state,
    reason,
    lastSentAt: doors.lastSentAt || null,
    lastResult: sinceOn(doors.lastSentAt) ? doors.lastResult || [] : [],
    lastDeepSentAt: doors.lastDeepSentAt || null,
    lastDeepResult: sinceOn(doors.lastDeepSentAt) ? doors.lastDeepResult || null : null,
    lastFinishedAt: doors.lastFinishedAt || null,
    lastSkip: doors.lastSkip || null,
    lastErrorAt: doors.lastErrorAt || null,
    lastError: doors.lastError || null,
    failCode,
    failPhase: doors.failPhase || null,
    failDetail: doors.failDetail || null,
    replacedTyped: doors.replacedTyped || 0,
    everSent: (doors.reported || []).length > 0,
    canClearAll: extras.canClearAll === true,
    unknownPeople: sinceOn(doors.lastSentAt)
      ? (doors.unknownPersonIds || []).map((pid) => ({ fbtimePersonId: pid, name: nameOf(pid) }))
      : [],
    overCap: (doors.overCap || []).slice(0, 5).map((o) => ({ name: nameOf(o.fbtimePersonId), date: o.date, knocks: o.knocks })),
    overCapCount: (doors.overCap || []).length,
    pendingClears: {
      all: doors.clearAll === true,
      persons: (doors.clearPersons || []).map((c) => ({ fbtimePersonId: c.fbtimePersonId, name: nameOf(c.fbtimePersonId) })),
      confirmPending:
        (doors.clearPersons || []).some((c) => c.confirmAfter) || Boolean(doors.clearAllConfirmAfter),
      blockedBy,
    },
  };
};
