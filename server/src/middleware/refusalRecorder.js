import { RefusedUpload, REFUSED_UPLOAD_RETENTION_DAYS } from '../models/RefusedUpload.js';
import { Household } from '../models/Household.js';
import { Voter } from '../models/Voter.js';
import { Turf } from '../models/Turf.js';
import { Campaign } from '../models/Campaign.js';
import { Organization } from '../models/Organization.js';
import { orgCarriesUser } from '../services/reports/canvasserIdentity.js';
import { zonedDayStr } from '../utils/timezone.js';

// Doors not saved (docs/PROPOSAL_OFFLINE_QUEUE.md §D, §O). A phone saves a door without signal and sends
// it when signal comes back; if the server turns it down by then (taken off the campaign, the walk list's
// survey changed, the house gone, the account paused…), the phone used to delete it without a word. This
// records each such refusal for the Audit page, for every phone from the day it deploys, because the
// server is the one refusing.
//
// Mounted ONCE (routes/index.js), after requireAuth + blockIfMustChangePassword — so the 401 and the
// temp-password 403 never reach it — and BEFORE requireEntitlement, so it sees the 402 and the
// org-context refusals as well as the routes' own. At finish, req.params is empty for a refusal a
// middleware answered, so the kind and the door are read from req.path when the request ARRIVES.
//
// The web dyno has no unhandledRejection or uncaughtException handler, and Node 20 exits on either.
// So nothing here may throw or reject out: the matcher and the res.json capture run in try/catch, the
// real res.json is always called, and record() is awaited whole and caught, its logger guarded too. The
// order of `.catch` and the tracking matters (track below): reversed, the first failed write exits.

// ── The matcher ─────────────────────────────────────────────────────────────────────────────────────
// The four queued writes, by the paths mobile/lib/offlineQueue.js replays (routes/mobile/canvass.js).
// A Map, not an object: an object literal would answer `constructor` or `__proto__` from its prototype.
const DOOR_RESULTS = new Map([
  ['not-home', 'not_home'],
  ['wrong-address', 'wrong_address'],
  ['lit-drop', 'lit_dropped'],
  ['refused', 'refused'],
  ['restricted', 'restricted'],
  ['no-soliciting', 'no_soliciting'],
  ['not-target', 'not_target'],
]);
const HEX24 = /^[0-9a-f]{24}$/i;
// Express's own routing is case-insensitive and non-strict (a trailing slash matches), and it routes an
// id it can't cast too (the handler answers 500). Matched on req.path at the mount — the query string and
// the /api/mobile prefix already gone — which agreed with Express's dispatch on every real /mobile route
// and 41 request variants (review round 3). req.originalUrl did not: it keeps a doubled slash and an
// absolute-form target. The only other /mobile POST, /voters/:id/notes, is not a queued write and doesn't
// match.
const QUEUED_PATH = /^\/(households|voters)\/([^/]+)\/([^/]+)\/?$/i;

/**
 * Which queued write is this request? `{ kind, actionType, householdId, voterId }`, or null for anything
 * else. A malformed id still matches, with the id null (filing then falls back to the book); a malformed
 * escape doesn't — Express answers that 400 itself before any handler, and no phone sends one.
 */
export const matchQueuedWrite = (method, path) => {
  if (method !== 'POST' || typeof path !== 'string') return null;
  const m = QUEUED_PATH.exec(path);
  if (!m) return null;
  let id;
  try {
    id = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  id = HEX24.test(id) ? id.toLowerCase() : null;
  const collection = m[1].toLowerCase();
  const action = m[3].toLowerCase();
  if (collection === 'voters') {
    return action === 'survey' ? { kind: 'survey', actionType: null, householdId: null, voterId: id } : null;
  }
  if (DOOR_RESULTS.has(action)) return { kind: 'result', actionType: DOOR_RESULTS.get(action), householdId: id, voterId: null };
  if (action === 'voters') return { kind: 'add_person', actionType: null, householdId: id, voterId: null };
  if (action === 'location') return { kind: 'pin_move', actionType: null, householdId: id, voterId: null };
  return null;
};

// ── What the body may put in a row ──────────────────────────────────────────────────────────────────
// A refusal that matters answers before zod runs, so these fields come from a body of up to 2 MB
// (app.js). Kept only when sane, else null — the daily cap counts rows, and without this a removed
// canvasser's token could store megabytes a row (review round 3). The phone's queue item id is
// `${Date.now()}-${6 characters}` (mobile/lib/offlineQueue.js).
export const QUEUE_ITEM_ID_MAX = 64;
export const cleanQueueItemId = (v) => (typeof v === 'string' && v.length > 0 && v.length <= QUEUE_ITEM_ID_MAX ? v : null);
export const cleanObjectId = (v) => (typeof v === 'string' && HEX24.test(v) ? v.toLowerCase() : null);
// The tap time, only as a real date. An ISO stamp is ~24 characters; the length check keeps Date.parse
// off a megabyte string.
export const cleanRecordedAt = (v) => {
  if (typeof v !== 'string' || v.length > 64) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
};
// The refusal's own words come from this server, but a thrown error's message can quote the request.
const clip = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);

// ── Switches and bounds ─────────────────────────────────────────────────────────────────────────────
// REFUSAL_RECORDER=off turns the whole recorder off (no capture, no write, no close). Read per request,
// like the phone switches in routes/public/buildStatus.js; anything but "off" leaves it on.
const recorderOff = () => String(process.env.REFUSAL_RECORDER || '').trim().toLowerCase() === 'off';

// At most this many rows per person per organization per day — enough for a whole shift refused, and a
// wall for a removed canvasser's live token. Counted in memory: production runs one web dyno, so every
// restart (the daily cycle, a deploy, a config change) starts the count again, which is harmless.
export const DAILY_CAP = 500;
// The cap's day is a Central-time day (a UTC day would roll at 6 PM Central on Election Day).
const CAP_TZ = 'America/Chicago';
const DAY_MS = 24 * 60 * 60 * 1000;

let capDay = null;
const capCounts = new Map(); // `${userId}:${orgId}` -> rows written today
const capLogged = new Set();
const rollCapDay = () => {
  const today = zonedDayStr(new Date(), CAP_TZ);
  if (today !== capDay) {
    capDay = today;
    capCounts.clear();
    capLogged.clear();
  }
};
// Taken synchronously before the write and handed back if it wrote nothing, so concurrent refusals
// can't overshoot.
const takeCapSlot = (key) => {
  rollCapDay();
  const n = capCounts.get(key) || 0;
  if (n >= DAILY_CAP) {
    if (!capLogged.has(key)) {
      capLogged.add(key);
      console.warn(`[refused-uploads] ${DAILY_CAP} rows today for ${key} (user:org); later refusals today are not recorded`);
    }
    return false;
  }
  capCounts.set(key, n + 1);
  return true;
};
const giveCapSlotBack = (key) => {
  const n = capCounts.get(key) || 0;
  if (n > 0) capCounts.set(key, n - 1);
};

// "Does this organization carry this person?" — orgCarriesUser (services/reports/canvasserIdentity.js):
// a membership in any state, or their own knocks or surveys there, desk marks excluded. That second half
// is what files a REMOVED canvasser's refusals in their old org (Remove deletes the membership). Remembered
// a minute per person and org, so a phone flushing 40 refusals asks once.
const CARRIES_TTL_MS = 60_000;
const CARRIES_MAX = 10_000;
const carriesMemo = new Map(); // `${userId}:${orgId}` -> { value, at }
const carriedBy = async (key, userId, organizationId) => {
  const now = Date.now();
  const seen = carriesMemo.get(key);
  if (seen && now - seen.at < CARRIES_TTL_MS) return seen.value;
  const value = await orgCarriesUser(userId, organizationId);
  for (const [k, v] of carriesMemo) if (now - v.at >= CARRIES_TTL_MS) carriesMemo.delete(k);
  if (carriesMemo.size >= CARRIES_MAX) carriesMemo.clear();
  carriesMemo.set(key, { value, at: now });
  return value;
};

// ── Filing: server records only ─────────────────────────────────────────────────────────────────────
// The organization and campaign come from the household or voter in the URL, else from the book the
// body names — never from X-Org-Id or a body campaignId, so another organization's address can't be
// filed in front of the wrong admins. Every join must agree on one organization, or nothing is filed. A
// book in another campaign of the same organization isn't kept (the door is the record). An id that
// resolves to nothing is still kept, so the console can say the house is no longer in the campaign.
const sameId = (a, b) => String(a) === String(b);
const fileFromServerRecords = async (hit, body) => {
  let organizationId = null;
  let campaignId = null;
  let householdId = hit.householdId;
  if (hit.voterId) {
    const voter = await Voter.findById(hit.voterId, 'organizationId campaignId householdId').lean();
    if (voter) {
      organizationId = voter.organizationId;
      campaignId = voter.campaignId;
      householdId = voter.householdId ? String(voter.householdId) : null;
      const house = householdId ? await Household.findById(householdId, 'organizationId campaignId').lean() : null;
      if (house) {
        if (!sameId(house.organizationId, organizationId)) return null;
        campaignId = house.campaignId; // the survey route's own campaign is the household's
      }
    }
  } else if (hit.householdId) {
    const house = await Household.findById(hit.householdId, 'organizationId campaignId').lean();
    if (house) {
      organizationId = house.organizationId;
      campaignId = house.campaignId;
    }
  }
  let turfId = null;
  const bookId = cleanObjectId(body.turfId);
  if (bookId) {
    const book = await Turf.findById(bookId, 'organizationId campaignId').lean();
    if (book && !organizationId) {
      organizationId = book.organizationId;
      campaignId = book.campaignId;
      turfId = book._id;
    } else if (book) {
      if (!sameId(book.organizationId, organizationId)) return null;
      if (sameId(book.campaignId, campaignId)) turfId = book._id;
    }
  }
  if (!organizationId || !campaignId) return null;
  return { organizationId, campaignId, householdId, voterId: hit.voterId, turfId };
};

// Never write into a deletion: the org cascade and the campaign cascade sweep this collection once, and a
// row landing after the sweep would outlive what it describes (the late-write sweep's missing-campaign
// path sweeps every tenant, so that pattern is banned here). Checked before the write, and again after.
const tenantStanding = async (organizationId, campaignId) => {
  const [org, campaign] = await Promise.all([
    Organization.findById(organizationId, 'isActive deletion.requestedAt').lean(),
    Campaign.findOne({ _id: campaignId, organizationId }, 'deletion.requestedAt').lean(),
  ]);
  return Boolean(org && org.isActive && !org.deletion?.requestedAt && campaign && !campaign.deletion?.requestedAt);
};
const deletionBegan = async (organizationId, campaignId) => {
  const [org, campaign] = await Promise.all([
    Organization.findById(organizationId, 'deletion.requestedAt').lean(),
    Campaign.findById(campaignId, 'deletion.requestedAt').lean(),
  ]);
  return !org || Boolean(org.deletion?.requestedAt) || !campaign || Boolean(campaign.deletion?.requestedAt);
};

// The row's door key: a survey is keyed by its voter, everything else by its household.
const doorKeyOf = (kind) => (kind === 'survey' ? 'voterId' : 'householdId');

// With a queue item id: one row per item. A resend after a lost response finds its row (and takes the
// latest refusal's words); two copies racing are held to one by the unique partial index, the loser's
// E11000 being "already recorded". The filter states `$type: 'string'` so it can use that partial index.
// Without one (old phones, which drop an item after a single refusal): a plain insert.
const writeRow = async (fields, queueItemId) => {
  if (!queueItemId) {
    const row = await RefusedUpload.create({ ...fields, queueItemId: null });
    return { id: row._id, inserted: true };
  }
  const doorKey = doorKeyOf(fields.kind);
  const { userId, kind, status, code, reason, [doorKey]: door, ...insertOnly } = fields;
  try {
    const res = await RefusedUpload.findOneAndUpdate(
      { userId, queueItemId: { $eq: queueItemId, $type: 'string' }, kind, [doorKey]: door },
      { $set: { status, code, reason }, $setOnInsert: { ...insertOnly, queueItemId } },
      { upsert: true, new: true, includeResultMetadata: true, projection: { _id: 1 } }
    );
    return { id: res.value?._id ?? null, inserted: res.lastErrorObject?.updatedExisting === false };
  } catch (err) {
    if (err?.code === 11000) return { id: null, inserted: false };
    throw err;
  }
};

// A later replay of the same queue item was accepted (any 2xx): the door went in after all, so the row
// leaves Open (savedLaterAt; the All tab says "Saved later"). Every 2xx counts — 201, the walk-up add's
// repeat 200, and `200 { superseded: true }` too: superseded means the server already holds this very tap
// or a newer result of this canvasser's at that door (or an admin struck it on purpose), so the door is
// not lost and re-entering it would be wrong. Kind and door are in the filter as well, so a different
// request carrying the same id can never close a refusal. Nearly always matches nothing, through the index.
const closeSavedLater = (userId, queueItemId, hit) => {
  const doorKey = doorKeyOf(hit.kind);
  return RefusedUpload.updateMany(
    { userId, queueItemId: { $eq: queueItemId, $type: 'string' }, kind: hit.kind, [doorKey]: hit[doorKey], savedLaterAt: null },
    { $set: { savedLaterAt: new Date() } }
  );
};

// Everything after the response, awaited step by step. `sent` is what the phone received: the status and
// { code, error } of the FIRST res.json, while the headers were still unsent.
const record = async (req, hit, sent) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || body.wasOfflineSubmission !== true) return; // replays only
  const userId = req.user?._id;
  if (!userId) return;
  const { status } = sent;
  const queueItemId = cleanQueueItemId(body.queueItemId);

  if (status >= 200 && status < 300) {
    if (queueItemId) await closeSavedLater(userId, queueItemId, hit);
    return;
  }
  // 4xx only. A 5xx is retried by the phone; 401 and the temp-password 403 are held there (and are
  // answered before this mounts anyway).
  if (!(status >= 400 && status < 500) || status === 401) return;
  if (status === 403 && sent.code === 'PASSWORD_CHANGE_REQUIRED') return;

  const where = await fileFromServerRecords(hit, body);
  if (!where) return;
  // Cheapest first: the cap (memory), then whether the org carries them (remembered a minute), then the
  // deletion check — so a capped token or a stranger costs no more than the filing lookups.
  const key = `${userId}:${where.organizationId}`;
  if (!takeCapSlot(key)) return;
  let written = null;
  try {
    if (!(await carriedBy(key, userId, where.organizationId))) return;
    if (!(await tenantStanding(where.organizationId, where.campaignId))) return;
    written = await writeRow(
      {
        organizationId: where.organizationId,
        campaignId: where.campaignId,
        userId,
        kind: hit.kind,
        actionType: hit.actionType,
        householdId: where.householdId,
        voterId: where.voterId,
        turfId: where.turfId,
        surveyTemplateId: hit.kind === 'survey' ? cleanObjectId(body.surveyTemplateId) : null,
        recordedAt: cleanRecordedAt(body.timestamp),
        status,
        code: clip(sent.code, 64),
        reason: clip(sent.error, 500),
        expiresAt: new Date(Date.now() + REFUSED_UPLOAD_RETENTION_DAYS * DAY_MS),
      },
      queueItemId
    );
  } finally {
    if (!written?.inserted) giveCapSlotBack(key);
  }
  // A deletion stamped between the check above and the write: the row takes itself back out, by _id only.
  if (written?.id && (await deletionBegan(where.organizationId, where.campaignId))) {
    await RefusedUpload.deleteOne({ _id: written.id });
  }
};

// ── Tracking, for the shutdown drain ────────────────────────────────────────────────────────────────
const inFlight = new Set();
const safeLog = (err) => {
  try {
    console.error('[refused-uploads] record failed:', err?.message || err);
  } catch {
    /* a rejection whose message getter throws must not take the dyno with it */
  }
};
// `.catch` FIRST, then track the caught promise: it can only resolve, so the `.finally` that untracks it
// can't re-reject. Tracking the raw promise and hanging `.finally` and `.catch` off it separately leaves
// the `.finally` branch rejecting with no handler, and the first failed write exits the process (review
// round 3 reproduced it).
const track = (promise) => {
  const settled = promise.catch(safeLog);
  inFlight.add(settled);
  settled.finally(() => inFlight.delete(settled));
};

/**
 * Wait for records still being written, `ms` at most. Never rejects. server.js calls it inside the
 * http server's close callback on SIGTERM — every response has finished by then, so every record() has
 * started. Returns how many it waited for.
 */
export const drainRefusalWrites = async (ms = 5000) => {
  const pending = [...inFlight];
  if (!pending.length) return 0;
  let timer = null;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
  return pending.length;
};

/**
 * Build this collection's indexes before the first request can write a row (production autoIndex is off;
 * the syncPacePauseIndexes pattern). The web dyno is the only writer, so only server.js calls it.
 * syncIndexes is idempotent; a failure is logged, never fatal.
 */
export const syncRefusedUploadIndexes = async (tag = 'boot') => {
  await RefusedUpload.syncIndexes().catch((e) => console.error(`[${tag}] RefusedUpload.syncIndexes failed`, e?.message || e));
};

// ── The middleware ──────────────────────────────────────────────────────────────────────────────────
export const refusalRecorder = (req, res, next) => {
  let hit = null;
  try {
    if (!recorderOff()) hit = matchQueuedWrite(req.method, req.path);
  } catch {
    hit = null; // a matcher bug lets the request through untouched
  }
  if (!hit) return next();

  try {
    let sent = null;
    const realJson = res.json;
    // The FIRST res.json while the headers are unsent is what the phone received; a handler calling it
    // twice must not record the second (which never left). Always the real res.json, whatever happens here.
    res.json = function recorderJson(body) {
      try {
        if (!sent && !res.headersSent) {
          sent = {
            status: res.statusCode,
            code: typeof body?.code === 'string' ? body.code : null,
            error: typeof body?.error === 'string' ? body.error : null,
          };
        }
      } catch {
        /* a capture bug never changes the response */
      }
      return realJson.call(this, body);
    };
    // 'finish' only: a phone that dropped before the answer gets no finish, only 'close', and resends.
    res.once('finish', () => {
      try {
        track(record(req, hit, sent ?? { status: res.statusCode, code: null, error: null }));
      } catch (err) {
        safeLog(err);
      }
    });
  } catch (err) {
    safeLog(err);
  }
  next();
};
