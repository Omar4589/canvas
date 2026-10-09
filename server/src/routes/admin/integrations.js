import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { FbTimeConnection } from '../../models/FbTimeConnection.js';
import { FbTimePersonLink } from '../../models/FbTimePersonLink.js';
import { FbTimeShift } from '../../models/FbTimeShift.js';
import { IntegrationEvent } from '../../models/IntegrationEvent.js';
import { User } from '../../models/User.js';
import { Membership } from '../../models/Membership.js';
import { Organization } from '../../models/Organization.js';
import { sealSecret, openSecret, sealedSecretConfigured } from '../../utils/sealedSecret.js';
import { ping, listAllPeople, getShifts, FbtimeApiError } from '../../services/fbtime/client.js';
import { getQueue, QUEUE_NAMES } from '../../queues/index.js';
import { FBTIME_ORG_JOB, windowFor } from '../../services/fbtime/sync.js';
import {
  doorCountsAvailable,
  doorsStatus,
  firstPassWaiting,
  normPersonId,
  SCOPE_DOORS_WRITE,
  FEATURE_REPORTED_WINS,
} from '../../services/fbtime/doorCounts.js';
import { otherReporterAhead } from '../../services/fbtime/doorPush.js';
import { loadShiftOwners, reassignPersonShifts, cutKeptAccounts } from '../../services/fbtime/shiftOwner.js';
import { hydrateCanvassers } from '../../services/reports/canvasserIdentity.js';

// The FbTime integration, managed by the org's OWN admin. Connecting is the
// act of consent — nobody at Doorline can wire a customer's timesheets up on
// their behalf — which is what makes this a customer integration rather than a
// disclosure (see docs/FBTIME_INTEGRATION.md and the DPA §6 listing).
//
// ADMIN ONLY, org-wide: the connection reads the whole org's hours, so the
// location-scoped lead tier deliberately cannot create or see it.
//
// THE KEY NEVER LEAVES. It arrives once in a request body, is sealed
// immediately (utils/sealedSecret.js), and no response, event, or log ever
// carries more than the display prefix.
//
// DOOR COUNTS are the one thing the connection SENDS: with the release var on
// (FBTIME_DOOR_COUNTS) and an admin's switch on, the worker sends each linked
// canvasser's doors per day to FbTime (services/fbtime/doorPush.js). Turning it
// on is refused to staff under a support grant — the customer's own admin turning
// it on is the customer's instruction (DPA §2). Design and rulings:
// docs/PROPOSAL_FBTIME_DOOR_COUNTS.md.
const router = Router();
router.use(requireAuth, orgContext, requireOrgRole('admin'));

const orgIdOf = (req) => req.activeOrg?._id;

const keySchema = z.object({
  apiKey: z.string().trim().min(20).max(200).startsWith('fbt_', 'Not an FbTime API key'),
});

const hex24 = z.string().regex(/^[0-9a-f]{24}$/i, 'Must be a 24-hex id');

// The mapping screen's trailing window for recent project labels. 7 (the cron's
// RECENT_WINDOW_DAYS) leaves half a seasonal roster blank; 120 shows labels three
// months stale. The timeout is well under Heroku's 30s router limit, because this
// route can page and the default per-request budget is 30s on its own.
const PROJECT_WINDOW_DAYS = Number(process.env.FBTIME_PROJECT_WINDOW_DAYS || 30);
const PROJECT_TIMEOUT_MS = Number(process.env.FBTIME_PROJECT_TIMEOUT_MS || 8000);
const PROJECTS_PER_PERSON = 3;

const audit = (organizationId, byUserId, type, detail = null) =>
  IntegrationEvent.create({ organizationId, byUserId, type, detail }).catch((err) =>
    console.error('[integrations] audit write failed:', err?.message)
  );

// Provider refusals surface as 4xx with the provider's own machine code, so
// the admin pasting a revoked key is told exactly that rather than "500".
const sendProviderError = (res, err) => {
  if (err instanceof FbtimeApiError) {
    return res.status(err.status && err.status < 500 ? err.status : 502).json({
      error: err.message,
      code: err.code || 'FBTIME_ERROR',
    });
  }
  throw err;
};

// Fire-and-forget, with the queue's own bounded wait, like every enqueue on the
// request path — completion is read off the connection's stamps, never the job.
const enqueueOrgSync = (organizationId, why) =>
  getQueue(QUEUE_NAMES.MAINTENANCE)
    .add(FBTIME_ORG_JOB, { organizationId: String(organizationId) }, { removeOnComplete: true, removeOnFail: true })
    .catch((err) => console.error(`[integrations] ${why} enqueue failed:`, err?.message));

const scopesOf = (pinged) => (Array.isArray(pinged?.key?.scopes) ? pinged.key.scopes.map(String) : []);
const featuresOf = (pinged) => (Array.isArray(pinged?.features) ? pinged.features.map(String) : []);

// ── Door-count helpers ───────────────────────────────────────────────────────

// Turn on and Turn off both start the card's failure state over (§H).
const DOORS_FAILURE_UNSET = {
  'doors.failCode': '',
  'doors.failPhase': '',
  'doors.failDetail': '',
  'doors.lastError': '',
  'doors.transientStreak': '',
};
const DOORS_CLEARS_UNSET = {
  'doors.clearPersons': '',
  'doors.clearAll': '',
  'doors.clearAllDone': '',
  'doors.clearAllConfirmAfter': '',
};

// "No first pass of a clear is waiting" as a filter — Disconnect and an organization
// change are refused while one is (a pending confirm pass alone is simply dropped).
const NO_FIRST_PASS_WAITING = {
  $nor: [
    { 'doors.clearPersons': { $elemMatch: { confirmAfter: null } } },
    { 'doors.clearAll': true, 'doors.clearAllConfirmAfter': null },
  ],
};

const fullName = (p) => (p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() || null : null);

// A person's link or kept account changed: the next door run sends everyone 120 days.
// Only while door counts are on — an org that never uses them is never written.
const markDeepDue = (organizationId) =>
  FbTimeConnection.updateOne({ organizationId, 'doors.enabled': true }, { $set: { 'doors.deepDueAt': new Date() } });

/** fbtimePersonId → { name, fbtimeName } for the card's notices (links, kept accounts, clears). */
const doorNames = async (organizationId, connection) => {
  const links = await FbTimePersonLink.find({ organizationId }).select('userId fbtimePersonId fbtimeName').lean();
  const userOf = new Map();
  const fbtimeNameOf = new Map();
  for (const l of links) {
    const pid = normPersonId(l.fbtimePersonId);
    if (!pid) continue;
    userOf.set(pid, String(l.userId));
    if (l.fbtimeName) fbtimeNameOf.set(pid, l.fbtimeName);
  }
  for (const k of connection?.keptAccounts || []) {
    const pid = normPersonId(k.fbtimePersonId);
    if (pid && !userOf.has(pid)) userOf.set(pid, String(k.userId));
  }
  for (const c of connection?.doors?.clearPersons || []) {
    const pid = normPersonId(c.fbtimePersonId);
    if (pid && !userOf.has(pid) && c.fromUserId) userOf.set(pid, String(c.fromUserId));
  }
  const people = await hydrateCanvassers([...userOf.values()], organizationId);
  const names = new Map();
  for (const pid of new Set([...userOf.keys(), ...fbtimeNameOf.keys()])) {
    names.set(pid, { name: fullName(people.get(userOf.get(pid))), fbtimeName: fbtimeNameOf.get(pid) || null });
  }
  return names;
};

/** The `doors` block of GET /fbtime — doorsStatus() is the one owner of what it means. */
const doorsBlock = async (organizationId, connection) => {
  const doors = connection.doors || {};
  const available = doorCountsAvailable();
  const otherReporter =
    connection.status !== 'disconnected' ? Boolean(await otherReporterAhead(connection)) : false;
  const [names, enabledBy] = await Promise.all([
    doorNames(organizationId, connection),
    doors.enabledByUserId ? hydrateCanvassers([doors.enabledByUserId], organizationId) : new Map(),
  ]);
  const everSent = (doors.reported || []).length > 0;
  // A clear-all could run right now: the var, a working key that may write, an FbTime
  // that applies "Doorline decides", nobody else reporting — and none already waiting.
  const canClearAll =
    everSent &&
    available &&
    connection.status === 'connected' &&
    (connection.keyScopes || []).includes(SCOPE_DOORS_WRITE) &&
    (connection.fbtimeFeatures || []).includes(FEATURE_REPORTED_WINS) &&
    !otherReporter &&
    doors.clearAll !== true;
  return doorsStatus(connection, {
    available,
    otherReporter,
    enabledByName: doors.enabledByUserId ? fullName(enabledBy.get(String(doors.enabledByUserId))) : null,
    names,
    canClearAll,
  });
};

/** The 409 DOORS_CLEAR_PENDING body: which first passes are still waiting. */
const clearPendingBody = async (organizationId, connection) => {
  const doors = connection?.doors || {};
  const names = await doorNames(organizationId, connection);
  return {
    error:
      'Doorline is still clearing door counts it sent to FbTime. Wait for the clear to finish, or go ahead and abandon it.',
    code: 'DOORS_CLEAR_PENDING',
    all: doors.clearAll === true && !doors.clearAllConfirmAfter,
    persons: (doors.clearPersons || [])
      .filter((c) => !c.confirmAfter)
      .map((c) => {
        const n = names.get(normPersonId(c.fbtimePersonId));
        return { fbtimePersonId: c.fbtimePersonId, name: n?.name || n?.fbtimeName || null };
      }),
  };
};

const connectionChanged = () => ({
  error: 'The FbTime connection changed while this was being saved. Reload the page and try again.',
  code: 'CONNECTION_CHANGED',
});

// What a dropped set of clears amounts to, for the doors-clears-abandoned event.
const waitingClears = (doors) => ({
  count: (doors?.clearPersons || []).length,
  all: doors?.clearAll === true,
});

/** Status + counts for the Integrations page. {connected:false} when absent. */
router.get('/fbtime', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId }).lean();
    if (!connection || connection.status === 'disconnected') {
      // doorsAvailable: the connect card's Test result may say "It can also fill in door counts".
      return res.json({ connected: false, configured: sealedSecretConfigured(), doorsAvailable: doorCountsAvailable() });
    }

    const [linkCount, unmatchedWithHours, doors] = await Promise.all([
      FbTimePersonLink.countDocuments({ organizationId }),
      FbTimeShift.distinct('fbtimePersonId', { organizationId, userId: null }),
      doorsBlock(organizationId, connection),
    ]);

    res.json({
      connected: true,
      configured: sealedSecretConfigured(),
      status: connection.status,
      keyPrefix: connection.keyPrefix,
      fbtimeOrgName: connection.fbtimeOrgName,
      hourFigure: connection.hourFigure,
      connectedAt: connection.connectedAt,
      lastSyncAt: connection.lastSyncAt,
      lastSyncError: connection.lastSyncError,
      lastErrorAt: connection.lastErrorAt,
      linkCount,
      // Distinct FbTime people with cached hours no Doorline user is mapped to —
      // the mapping screen's "unmatched hours exist" badge.
      unmatchedWithHours: unmatchedWithHours.length,
      // What the key may do and what FbTime supports, from the last /ping.
      keyScopes: connection.keyScopes || null,
      fbtimeFeatures: connection.fbtimeFeatures || null,
      doors,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Validate a key WITHOUT storing it — the wrong-customer-key guard. The admin
 * sees the FbTime organization's name and confirms it is theirs before
 * Connect; pasting another customer's key is caught here as a name that reads
 * wrong, not weeks later as a report full of strangers' hours.
 */
router.post('/fbtime/test', async (req, res, next) => {
  try {
    const { apiKey } = keySchema.parse(req.body);
    const body = await ping({ apiKey });
    res.json({
      ok: true,
      organization: body.organization,
      key: body.key,
      // Server-wide (FbTime's build), beside key.scopes (this key) — the Replace-key form
      // says "It can also fill in door counts" from the pair.
      features: featuresOf(body),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    try {
      return sendProviderError(res, err);
    } catch {
      next(err);
    }
  }
});

/**
 * Connect (or rotate the key of) the org's FbTime integration.
 *
 * Re-pings before storing, so a key that stopped working between Test and
 * Connect never lands. A rotate whose ping resolves a DIFFERENT FbTime org
 * than the stored one requires confirmOrgChange:true — that shape is almost
 * always a paste of the wrong customer's key.
 *
 * Door counts belong to the FbTime organization they were sent to. An
 * ORGANIZATION CHANGE — the ping naming a different org than a stored one, at any
 * status (a rotate, or a reconnect of a disconnected row) — resets them: refused
 * with 409 DOORS_CLEAR_PENDING while a clear's first pass waits, unless
 * leaveDoorCounts:true abandons it. The SAME organization (Replace key) keeps them,
 * clears included, and the email auto-match does not run — it runs only on a
 * first connect or an org change, so an admin's unlink stays unlinked.
 */
router.post('/fbtime/connect', async (req, res, next) => {
  try {
    if (!sealedSecretConfigured()) {
      return res.status(503).json({
        error: 'Secret sealing is not configured on this server (CREDENTIAL_SEAL_KEY).',
        code: 'SEALING_UNCONFIGURED',
      });
    }
    const { apiKey, confirmOrgChange, leaveDoorCounts } = keySchema
      .extend({ confirmOrgChange: z.boolean().optional(), leaveDoorCounts: z.boolean().optional() })
      .parse(req.body);

    const organizationId = orgIdOf(req);
    const pinged = await ping({ apiKey });
    const pingOrg = String(pinged.organization?.id || '');

    const existing = await FbTimeConnection.findOne({ organizationId }).lean();
    const rotating = Boolean(existing && existing.status !== 'disconnected' && existing.keyCiphertext);
    const storedOrg = existing?.fbtimeOrgId || '';
    const orgChange = Boolean(storedOrg && pingOrg !== storedOrg);
    if (rotating && orgChange && confirmOrgChange !== true) {
      return res.status(409).json({
        error: `This key reads a different FbTime organization ("${pinged.organization?.name}") than the connected one ("${existing.fbtimeOrgName}"). Confirm the change to proceed.`,
        code: 'ORG_CHANGE_CONFIRM',
        organization: pinged.organization,
      });
    }
    if (orgChange && firstPassWaiting(existing.doors) && leaveDoorCounts !== true) {
      return res.status(409).json(await clearPendingBody(organizationId, existing));
    }

    const keyPrefix = apiKey.slice(0, 17); // "fbt_live_" + 8 display chars, the provider's own rule
    const now = new Date();
    const doorsWereOn = existing?.doors?.enabled === true;
    const set = {
      status: 'connected',
      keyCiphertext: sealSecret(apiKey),
      keyPrefix,
      fbtimeOrgId: pingOrg,
      fbtimeOrgName: pinged.organization?.name || null,
      connectedByUserId: req.user._id,
      connectedAt: now,
      lastSyncError: null,
      keyScopes: scopesOf(pinged),
      fbtimeFeatures: featuresOf(pinged),
    };

    let connection;
    if (!existing) {
      try {
        connection = (await FbTimeConnection.create({ organizationId, ...set })).toObject();
      } catch (err) {
        if (err?.code === 11000) return res.status(409).json(connectionChanged()); // a racing first connect
        throw err;
      }
    } else {
      const update = { $set: set };
      if (orgChange) update.$unset = { doors: '' };
      else if (!rotating && existing.doors) set['doors.enabled'] = false; // a reconnect starts with door counts off
      else if (rotating && doorsWereOn) set['doors.deepDueAt'] = now; // a new key: the next run sends 120 days

      // Filtered on the key as read: a Disconnect, another connect or a Turn on that
      // landed since is never overwritten blind.
      const filter = { _id: existing._id, keyCiphertext: existing.keyCiphertext ?? null };
      if (orgChange && leaveDoorCounts !== true) Object.assign(filter, NO_FIRST_PASS_WAITING);
      connection = await FbTimeConnection.findOneAndUpdate(filter, update, { new: true }).lean();
      if (!connection) {
        const fresh = await FbTimeConnection.findById(existing._id).lean();
        if (orgChange && firstPassWaiting(fresh?.doors) && leaveDoorCounts !== true) {
          return res.status(409).json(await clearPendingBody(organizationId, fresh));
        }
        return res.status(409).json(connectionChanged());
      }
    }

    await audit(organizationId, req.user._id, rotating ? 'key-rotated' : 'connected', {
      keyPrefix,
      fbtimeOrgName: connection.fbtimeOrgName,
    });
    if (existing && orgChange) {
      if (doorsWereOn) await audit(organizationId, req.user._id, 'doors-disabled', { reason: 'org-changed' });
      const dropped = waitingClears(existing.doors);
      if (dropped.count || dropped.all) await audit(organizationId, req.user._id, 'doors-clears-abandoned', dropped);
    }

    // The auto-match pass — an explicit act, audited with its count, never a
    // background sweep (an admin's later unlink stays unlinked). Only when the
    // roster is new to this org: a first connect, or a different FbTime org.
    let autoMatched = 0;
    if (!existing || !storedOrg || orgChange) {
      try {
        autoMatched = await autoMatchByEmail(organizationId, apiKey, req.user._id);
      } catch (err) {
        // Roster fetch failing must not fail the connect; the mapping screen has
        // its own button to retry.
        console.error('[integrations] auto-match at connect failed:', err?.message);
      }
    }

    // Seed the hours cache now rather than at the next cron tick.
    enqueueOrgSync(organizationId, 'initial sync');

    res.status(rotating ? 200 : 201).json({
      connected: true,
      status: 'connected',
      keyPrefix,
      fbtimeOrgName: connection.fbtimeOrgName,
      hourFigure: connection.hourFigure,
      autoMatched,
      orgChanged: Boolean(existing && orgChange),
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    try {
      return sendProviderError(res, err);
    } catch {
      next(err);
    }
  }
});

// One manual refresh a minute per org is plenty: the pull itself takes seconds,
// and anything faster is just hammering the provider with identical questions.
const MANUAL_SYNC_COOLDOWN_MS = 60_000;

/**
 * Pull the deep window from FbTime NOW — the "I just fixed a timesheet" button.
 * The cron pair already keeps the cache honest (15-minute recent window,
 * nightly deep re-pull); this exists so an admin who corrects a weeks-old
 * shift in FbTime sees the fix on the next report load instead of tomorrow
 * morning. Enqueued rather than inline — the deep pull is seconds of provider
 * paging that does not belong on a request — so the client watches
 * lastSyncAt / lastErrorAt move past `requestedAt` on the status poll.
 * 'errored' connections are allowed through on purpose: a manual refresh is
 * exactly when a human retries a fixed key, and the job self-heals it.
 */
router.post('/fbtime/sync', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId, status: { $ne: 'disconnected' } });
    if (!connection?.keyCiphertext) return res.status(404).json({ error: 'FbTime is not connected.' });

    const now = new Date();
    if (connection.manualSyncRequestedAt && now - connection.manualSyncRequestedAt < MANUAL_SYNC_COOLDOWN_MS) {
      return res.status(429).json({
        error: 'Hours were just refreshed. Try again in a minute.',
        code: 'SYNC_COOLDOWN',
      });
    }
    // One field, atomically — never connection.save(), which would write the whole
    // loaded document back over a Turn on or a clear that landed in between.
    await FbTimeConnection.updateOne({ _id: connection._id }, { $set: { manualSyncRequestedAt: now } });

    // Completion is read off the connection's sync stamps (and, door counts on,
    // doors.lastFinishedAt), never off the job.
    enqueueOrgSync(organizationId, 'manual sync');

    res.status(202).json({ queued: true, requestedAt: now.toISOString() });
  } catch (err) {
    next(err);
  }
});

const figureSchema = z.object({
  hourFigure: z.enum(['grossHours', 'adjustedHours', 'workedHours']),
});

/** Which of the three wire figures divides doors-per-hour. */
router.patch('/fbtime/settings', async (req, res, next) => {
  try {
    const { hourFigure } = figureSchema.parse(req.body);
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId, status: { $ne: 'disconnected' } });
    if (!connection) return res.status(404).json({ error: 'FbTime is not connected.' });

    if (connection.hourFigure !== hourFigure) {
      const from = connection.hourFigure;
      connection.hourFigure = hourFigure;
      await connection.save();
      await audit(organizationId, req.user._id, 'figure-changed', { from, to: hourFigure });
    }
    res.json({ hourFigure });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

const DOORS_PING_TIMEOUT_MS = 8000;

const doorsRefusal = {
  notAvailable: () => ({ error: "Door counts to FbTime aren't available yet.", code: 'DOORS_NOT_AVAILABLE' }),
  notConnected: (connection) => ({
    error:
      connection && connection.status === 'errored'
        ? 'The FbTime connection needs attention first — the status bar says why.'
        : 'Connect FbTime first.',
    code: 'DOORS_NOT_CONNECTED',
  }),
  orgUnknown: () => ({
    error: "This key's FbTime organization doesn't match the connected one. Replace the key in Settings, then try again.",
    code: 'DOORS_ORG_UNKNOWN',
  }),
  reporterTaken: () => ({
    error:
      "This FbTime organization already gets door counts from another Doorline organization. Only one can send them — contact Doorline support if that's unexpected.",
    code: 'DOORS_REPORTER_TAKEN',
  }),
  scopeMissing: () => ({
    error:
      'This key reads hours only. In FbTime, create a key with "Also let it fill in door counts" ticked, then Replace key in Settings.',
    code: 'DOORS_SCOPE_MISSING',
  }),
  outdated: () => ({
    error: 'FbTime needs an update before Doorline can send or clear door counts.',
    code: 'DOORS_FBTIME_OUTDATED',
  }),
};

// What stops a clear from being asked for now — the stored scopes and features
// (a clear waits for the worker, which pings again before it sends anything).
const clearRefusalFor = async (connection) => {
  if (!doorCountsAvailable()) return doorsRefusal.notAvailable();
  if (!connection || connection.status !== 'connected' || !connection.keyCiphertext) {
    return doorsRefusal.notConnected(connection);
  }
  if (!(connection.keyScopes || []).includes(SCOPE_DOORS_WRITE)) return doorsRefusal.scopeMissing();
  if (!(connection.fbtimeFeatures || []).includes(FEATURE_REPORTED_WINS)) return doorsRefusal.outdated();
  if (await otherReporterAhead(connection)) return doorsRefusal.reporterTaken();
  return null;
};

const respondDoors = async (res, organizationId, connectionId) => {
  const fresh = await FbTimeConnection.findById(connectionId).lean();
  return res.json({ doors: fresh ? await doorsBlock(organizationId, fresh) : null });
};

// Turn on: the checks run in this order, and nothing is written until all pass.
const turnDoorsOn = async (req, res, organizationId, connection) => {
  if (req.supportGrant) {
    return res.status(403).json({
      error: "Only the organization's own admin can turn on door counts. Staff can turn them off.",
      code: 'DOORS_STAFF_FORBIDDEN',
    });
  }
  if (!doorCountsAvailable()) return res.status(409).json(doorsRefusal.notAvailable());
  if (!connection || connection.status !== 'connected' || !connection.keyCiphertext) {
    return res.status(409).json(doorsRefusal.notConnected(connection));
  }
  if (connection.doors?.enabled === true) return respondDoors(res, organizationId, connection._id);

  const usedKey = connection.keyCiphertext;
  let pinged;
  try {
    pinged = await ping({ apiKey: openSecret(usedKey), timeoutMs: DOORS_PING_TIMEOUT_MS });
  } catch (err) {
    return sendProviderError(res, err); // nothing written
  }
  const pingOrg = String(pinged?.organization?.id || '');
  const storedOrg = connection.fbtimeOrgId || '';
  if (!pingOrg || (storedOrg && pingOrg !== storedOrg)) return res.status(409).json(doorsRefusal.orgUnknown());
  const taken = await FbTimeConnection.exists({
    _id: { $ne: connection._id },
    fbtimeOrgId: pingOrg,
    status: { $ne: 'disconnected' },
    'doors.enabled': true,
  });
  if (taken) return res.status(409).json(doorsRefusal.reporterTaken());
  const keyScopes = scopesOf(pinged);
  const fbtimeFeatures = featuresOf(pinged);
  if (!keyScopes.includes(SCOPE_DOORS_WRITE) || !fbtimeFeatures.includes(FEATURE_REPORTED_WINS)) {
    // Keep what the ping said, so the card's hint is right on the next load.
    await FbTimeConnection.updateOne({ _id: connection._id, keyCiphertext: usedKey }, { $set: { keyScopes, fbtimeFeatures } });
    return res
      .status(409)
      .json(keyScopes.includes(SCOPE_DOORS_WRITE) ? doorsRefusal.outdated() : doorsRefusal.scopeMissing());
  }

  const now = new Date();
  const set = {
    keyScopes,
    fbtimeFeatures,
    'doors.enabled': true,
    'doors.enabledAt': now,
    'doors.enabledByUserId': req.user._id,
    'doors.deepDueAt': now,
  };
  if (!storedOrg) set.fbtimeOrgId = pingOrg;
  // Turning on cancels a waiting clear-all (the first send restates the last 120 days);
  // per-person clears stay.
  const before = await FbTimeConnection.findOneAndUpdate(
    { _id: connection._id, status: 'connected', keyCiphertext: usedKey, 'doors.enabled': { $ne: true } },
    {
      $set: set,
      $unset: {
        ...DOORS_FAILURE_UNSET,
        'doors.replacedTyped': '',
        'doors.clearAll': '',
        'doors.clearAllDone': '',
        'doors.clearAllConfirmAfter': '',
      },
    },
    { new: false }
  ).lean();
  if (!before) {
    const fresh = await FbTimeConnection.findById(connection._id).lean();
    if (fresh?.doors?.enabled === true) return respondDoors(res, organizationId, connection._id);
    return res.status(409).json(connectionChanged());
  }
  const clearCancelled = before.doors?.clearAll === true;
  await audit(organizationId, req.user._id, 'doors-enabled', clearCancelled ? { clearCancelled: true } : null);
  enqueueOrgSync(organizationId, 'door counts turn-on');
  return respondDoors(res, organizationId, connection._id);
};

// Turn off, optionally clearing what Doorline sent; also the Off card's clear.
const turnDoorsOff = async (req, res, organizationId, connection, clear) => {
  if (!connection) return res.status(404).json({ error: 'FbTime is not connected.' });
  const wasOn = connection.doors?.enabled === true;
  const willClear = clear && (connection.doors?.reported || []).length > 0;
  if (willClear) {
    const refusal = await clearRefusalFor(connection);
    if (refusal) return res.status(409).json(refusal);
  }
  if (!wasOn && !willClear) return respondDoors(res, organizationId, connection._id);

  const set = {};
  if (wasOn) set['doors.enabled'] = false;
  if (willClear) set['doors.clearAll'] = true; // never lowers a waiting clear-all's progress
  const filter = willClear
    ? { _id: connection._id, status: 'connected', keyCiphertext: connection.keyCiphertext }
    : { _id: connection._id };
  const done = await FbTimeConnection.updateOne(filter, { $set: set, $unset: { ...DOORS_FAILURE_UNSET } });
  if (done.matchedCount === 0) return res.status(409).json(connectionChanged());

  if (wasOn) await audit(organizationId, req.user._id, 'doors-disabled', { reason: 'admin', clear: willClear });
  else await audit(organizationId, req.user._id, 'doors-clear-requested', { all: true });
  if (willClear) enqueueOrgSync(organizationId, 'door counts clear');
  return respondDoors(res, organizationId, connection._id);
};

// "Clear the numbers Doorline sent for <person>" — an FbTime person Doorline sent
// counts for who is not linked now (a linked person's clear is Unlink → "No").
const clearOnePerson = async (req, res, organizationId, connection, pid) => {
  const refusal = await clearRefusalFor(connection);
  if (refusal) return res.status(409).json(refusal);
  const reported = new Set((connection.doors?.reported || []).map(normPersonId));
  if (!reported.has(pid)) {
    return res.status(409).json({ error: "Doorline hasn't sent door counts for that person.", code: 'DOORS_NOT_SENT' });
  }
  const linked = await FbTimePersonLink.exists({ organizationId, fbtimePersonId: new RegExp(`^${pid}$`, 'i') });
  if (linked) {
    return res.status(409).json({
      error: 'That person is linked. Unlink them and choose "No — the link was wrong" to clear.',
      code: 'DOORS_PERSON_LINKED',
    });
  }
  const done = await FbTimeConnection.updateOne(
    {
      _id: connection._id,
      keyCiphertext: connection.keyCiphertext,
      'doors.clearPersons.fbtimePersonId': { $ne: pid },
    },
    { $push: { 'doors.clearPersons': { fbtimePersonId: pid, fromUserId: null } } }
  );
  if (done.matchedCount === 0) {
    const fresh = await FbTimeConnection.findById(connection._id).lean();
    const waiting = (fresh?.doors?.clearPersons || []).some((c) => normPersonId(c.fbtimePersonId) === pid);
    if (!waiting) return res.status(409).json(connectionChanged());
    return respondDoors(res, organizationId, connection._id); // already waiting
  }
  await audit(organizationId, req.user._id, 'doors-clear-requested', { fbtimePersonId: pid });
  enqueueOrgSync(organizationId, 'door counts clear');
  return respondDoors(res, organizationId, connection._id);
};

// Cancel: every waiting clear, confirm pass and clear-all progress goes.
const cancelDoorClears = async (req, res, organizationId, connection) => {
  if (!connection) return res.status(404).json({ error: 'FbTime is not connected.' });
  const dropped = waitingClears(connection.doors);
  if (!dropped.count && !dropped.all) return respondDoors(res, organizationId, connection._id);
  await FbTimeConnection.updateOne({ _id: connection._id }, { $unset: { ...DOORS_CLEARS_UNSET } });
  await audit(organizationId, req.user._id, 'doors-clears-abandoned', dropped);
  return respondDoors(res, organizationId, connection._id);
};

const doorsSchema = z
  .object({
    enabled: z.boolean().optional(),
    clear: z.boolean().optional(),
    clearPerson: hex24.optional(),
    cancelClears: z.literal(true).optional(),
  })
  .strict();

/**
 * Door counts to FbTime — the org admin's switch and the explicit clears.
 *
 *   { enabled: true }                turn on (the customer's own admin only)
 *   { enabled: false, clear? }       turn off; clear:true also clears what Doorline sent
 *   { clear: true }                  while off: clear what Doorline sent
 *   { clearPerson: fbtimePersonId }  clear what Doorline sent for one person not linked now
 *   { cancelClears: true }           drop every waiting clear
 *
 * A clear is never a request to FbTime from here — it is recorded and the worker
 * runs it (services/fbtime/doorPush.js), with FbTime bringing back typed numbers.
 */
router.patch('/fbtime/doors', async (req, res, next) => {
  try {
    const body = doorsSchema.parse(req.body);
    const asked = [
      body.enabled !== undefined,
      body.enabled === undefined && body.clear === true,
      body.clearPerson !== undefined,
      body.cancelClears === true,
    ].filter(Boolean).length;
    if (asked !== 1 || (body.enabled === true && body.clear !== undefined)) {
      return res.status(400).json({
        error: 'Send exactly one of: enabled, clear, clearPerson or cancelClears.',
        code: 'INVALID_INPUT',
      });
    }
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId }).lean();

    if (body.enabled === true) return await turnDoorsOn(req, res, organizationId, connection);
    if (body.enabled === false) return await turnDoorsOff(req, res, organizationId, connection, body.clear === true);
    if (body.clear === true) {
      if (connection?.doors?.enabled === true) {
        return res.status(409).json({
          error: 'Turn door counts off first — the same step can clear what Doorline sent.',
          code: 'DOORS_ENABLED',
        });
      }
      return await turnDoorsOff(req, res, organizationId, connection, true);
    }
    if (body.clearPerson) return await clearOnePerson(req, res, organizationId, connection, normPersonId(body.clearPerson));
    return await cancelDoorClears(req, res, organizationId, connection);
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

/**
 * Disconnect. The ciphertext is cleared (a disconnected row must not hold a
 * working credential) and the HOURS CACHE IS DELETED — reports revert to span
 * math instantly, so a disconnected org is indistinguishable from one that
 * never connected. Links and history survive: they are the org's own labor
 * and audit trail, and reconnecting finds the roster already mapped.
 *
 * Door counts turn off. A clear whose first pass is still waiting refuses the
 * Disconnect (409 DOORS_CLEAR_PENDING) unless the JSON body says
 * leaveDoorCounts:true; a pending confirm pass alone is dropped. The ledger,
 * rejected pairs and kept accounts stay for a reconnect to the same FbTime org.
 */
router.delete('/fbtime', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const leaveDoorCounts = req.body?.leaveDoorCounts === true;
    const connection = await FbTimeConnection.findOne({ organizationId }).lean();
    if (!connection || connection.status === 'disconnected') {
      return res.status(404).json({ error: 'FbTime is not connected.' });
    }
    if (firstPassWaiting(connection.doors) && !leaveDoorCounts) {
      return res.status(409).json(await clearPendingBody(organizationId, connection));
    }

    const update = {
      $set: { status: 'disconnected', keyCiphertext: null, lastSyncError: null },
      $unset: { ...DOORS_CLEARS_UNSET },
    };
    if (connection.doors) update.$set['doors.enabled'] = false;
    const filter = { _id: connection._id, keyCiphertext: connection.keyCiphertext ?? null };
    if (!leaveDoorCounts) Object.assign(filter, NO_FIRST_PASS_WAITING);
    const done = await FbTimeConnection.updateOne(filter, update);
    if (done.matchedCount === 0) {
      const fresh = await FbTimeConnection.findById(connection._id).lean();
      if (!fresh || fresh.status === 'disconnected') return res.status(404).json({ error: 'FbTime is not connected.' });
      if (firstPassWaiting(fresh.doors) && !leaveDoorCounts) {
        return res.status(409).json(await clearPendingBody(organizationId, fresh));
      }
      return res.status(409).json(connectionChanged());
    }

    await FbTimeShift.deleteMany({ organizationId });
    await audit(organizationId, req.user._id, 'disconnected', { keyPrefix: connection.keyPrefix });
    if (connection.doors?.enabled === true) {
      await audit(organizationId, req.user._id, 'doors-disabled', { reason: 'disconnected' });
    }
    const dropped = waitingClears(connection.doors);
    if (dropped.count || dropped.all) await audit(organizationId, req.user._id, 'doors-clears-abandoned', dropped);

    res.json({ connected: false });
  } catch (err) {
    next(err);
  }
});

/**
 * The FbTime roster beside our own, for the mapping screen. Proxied — the
 * consumer's browser never holds the API key — and paged to exhaustion
 * server-side (the roster is an org's staff, hundreds at most).
 */
router.get('/fbtime/people', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId, status: { $ne: 'disconnected' } });
    if (!connection?.keyCiphertext) return res.status(404).json({ error: 'FbTime is not connected.' });

    const [people, links, unmatchedIds] = await Promise.all([
      listAllPeople({ apiKey: openSecret(connection.keyCiphertext), includeInactive: true }),
      FbTimePersonLink.find({ organizationId }).lean(),
      FbTimeShift.distinct('fbtimePersonId', { organizationId, userId: null }),
    ]);
    const linkByPerson = new Map(links.map((l) => [normPersonId(l.fbtimePersonId) || l.fbtimePersonId, l]));
    const hasHours = new Set(unmatchedIds);

    // Door counts, per FbTime person: sent (in the ledger), a clear waiting, kept
    // earlier accounts ("also counts"), and wrong-link pairs never to suggest again.
    const doors = connection.doors || {};
    const sent = new Set((doors.reported || []).map(normPersonId).filter(Boolean));
    const clearWaitingFor = new Set((doors.clearPersons || []).map((c) => normPersonId(c.fbtimePersonId)));
    const rejected = new Set((doors.rejected || []).map((r) => `${normPersonId(r.fbtimePersonId)}|${String(r.userId)}`));
    const keptByPerson = new Map();
    for (const k of connection.keptAccounts || []) {
      const pid = normPersonId(k.fbtimePersonId);
      if (!pid) continue;
      if (!keptByPerson.has(pid)) keptByPerson.set(pid, []);
      keptByPerson.get(pid).push(k);
    }
    const standing = await hydrateCanvassers(
      [...links.map((l) => l.userId), ...(connection.keptAccounts || []).map((k) => k.userId)],
      organizationId
    );
    const doorFields = (pid, linkedUserId) => {
      const who = linkedUserId ? standing.get(String(linkedUserId)) : null;
      return {
        doorsSent: sent.has(pid),
        clearWaiting: clearWaitingFor.has(pid),
        canClearSent: sent.has(pid) && !linkedUserId && !clearWaitingFor.has(pid),
        linkedStatus: who?.status || null,
        deleted: who?.status === 'deleted',
        alsoCounts: (keptByPerson.get(pid) || []).map((k) => {
          const kept = standing.get(String(k.userId));
          return {
            userId: String(k.userId),
            name: fullName(kept),
            deleted: kept?.status === 'deleted',
            until: k.until || null,
          };
        }),
      };
    };

    // Suggestions: same lowercase email on both rosters, not yet linked either way,
    // and never a pair an admin said was wrong.
    const memberships = await Membership.find({ organizationId, isActive: true }, 'userId').lean();
    const users = await User.find(
      { _id: { $in: memberships.map((m) => m.userId) } },
      'firstName lastName email'
    ).lean();
    const linkedUserIds = new Set(links.map((l) => String(l.userId)));
    const userByEmail = new Map(
      users.filter((u) => !linkedUserIds.has(String(u._id))).map((u) => [String(u.email).toLowerCase(), u])
    );

    const suggestions = [];
    for (const p of people) {
      const pid = normPersonId(p.id) || String(p.id);
      if (linkByPerson.has(pid)) continue;
      const match = p.email && userByEmail.get(String(p.email).toLowerCase());
      if (match && !rejected.has(`${pid}|${String(match._id)}`)) {
        suggestions.push({ fbtimePersonId: pid, userId: String(match._id) });
      }
    }

    // Two sets the roster proxy alone cannot express, and the mapping screen must:
    //
    //  · orphanLinks — a link whose FbTime person is no longer on /people. It
    //    still attributes cached hours, so it has to be visible and unlinkable,
    //    and its denormalized name/email is the only identity left to show.
    //  · ghostPersonIds — unlinked person ids that HAVE cached hours but are off
    //    the roster. GET /fbtime counts these in unmatchedWithHours (a distinct
    //    over our own cache, independent of the provider's roster), so without
    //    them the warning banner counts rows the table structurally cannot show.
    const rosterIds = new Set(people.map((p) => normPersonId(p.id) || String(p.id)));
    const orphanLinks = links
      .filter((l) => !rosterIds.has(normPersonId(l.fbtimePersonId) || l.fbtimePersonId))
      .map((l) => {
        const pid = normPersonId(l.fbtimePersonId) || l.fbtimePersonId;
        return {
          fbtimePersonId: pid,
          userId: String(l.userId),
          fbtimeName: l.fbtimeName || null,
          fbtimeEmail: l.fbtimeEmail || null,
          source: l.source || null,
          linkedAt: l.linkedAt || null,
          ...doorFields(pid, l.userId),
        };
      });
    // userId:null on a shift means unlinked (link creation backfills it), so a
    // ghost can never also be an orphanLink.
    const ghostPersonIds = unmatchedIds.map(String).filter((id) => !rosterIds.has(id));

    res.json({
      people: people.map((p) => {
        const pid = normPersonId(p.id) || String(p.id);
        const link = linkByPerson.get(pid);
        return {
          fbtimePersonId: pid,
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          email: p.email || null,
          isActive: p.isActive !== false,
          linkedUserId: link ? String(link.userId) : null,
          linkSource: link?.source || null,
          hasUnmatchedHours: !link && hasHours.has(pid),
          ...doorFields(pid, link?.userId),
        };
      }),
      suggestions,
      orphanLinks,
      ghostPersonIds,
    });
  } catch (err) {
    try {
      return sendProviderError(res, err);
    } catch {
      next(err);
    }
  }
});

/**
 * Recent FbTime project labels per person, for the mapping screen.
 *
 * A LABEL, NEVER A KEY. The provider's /people deliberately withholds location —
 * its own contract calls that projection "the privacy boundary" — so the label is
 * only reachable as `project: { id, name }` riding shift rows. It is derived here
 * IN MEMORY and discarded: models/FbTimeShift.js says "DELIBERATELY NOT STORED"
 * and nothing in this handler writes it anywhere, which keeps that literally true.
 *
 * It must never become an attribution input. Hours attach to campaigns by the
 * KNOCK LEDGER (services/reports/hoursSource.js → unionDayAllowed), because an
 * FbTime location is an honor-system dropdown a canvasser forgets to switch and
 * would silently move hours between campaigns' rates. Owner-ruled 2026-08-16; the
 * projectLocation-mapping idea is DEAD — do not re-propose.
 *
 * Deliberately a SEPARATE route from /fbtime/people. That one already pages the
 * provider's whole roster on every page load and is the request the table cannot
 * render without; getShifts pages to exhaustion too, so stacking both in one
 * handler would put a multi-page pull on the critical path. Split, a slow or
 * failing pull costs an em-dash in one column instead of the page.
 */
router.get('/fbtime/projects', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({
      organizationId,
      status: { $ne: 'disconnected' },
    });
    if (!connection?.keyCiphertext) return res.status(404).json({ error: 'FbTime is not connected.' });

    const asked = parseInt(req.query.days, 10);
    const windowDays = Math.min(
      120,
      Math.max(7, Number.isFinite(asked) ? asked : PROJECT_WINDOW_DAYS)
    );
    const org = await Organization.findById(organizationId).select('timeZone').lean();
    const timeZone = org?.timeZone || 'America/New_York';
    const { startDate, endDate } = windowFor(timeZone, windowDays);

    // ONLY the provider call is guarded, and deliberately NOT via
    // sendProviderError: a 4xx here would paint an error over a working table.
    // This column is decoration; it degrades, it never fails the request.
    let shifts = [];
    let degraded = false;
    let reason = null;
    try {
      shifts = await getShifts({
        apiKey: openSecret(connection.keyCiphertext),
        startDate,
        endDate,
        timeZone,
        timeoutMs: PROJECT_TIMEOUT_MS,
      });
    } catch (err) {
      if (!(err instanceof FbtimeApiError)) throw err;
      degraded = true;
      reason = err.code || 'UNAVAILABLE';
    }

    const byPerson = new Map();
    for (const s of shifts) {
      const name = s?.project?.name;
      if (!s?.userId || !s.clockIn || !name) continue;
      const at = new Date(s.clockIn);
      if (Number.isNaN(at.getTime())) continue;
      const pid = String(s.userId);
      let projects = byPerson.get(pid);
      if (!projects) byPerson.set(pid, (projects = new Map()));
      const id = String(s.project.id ?? name);
      const seen = projects.get(id);
      if (!seen) projects.set(id, { id, name, lastAt: at, shifts: 1 });
      else {
        seen.shifts += 1;
        if (at > seen.lastAt) seen.lastAt = at;
      }
    }

    const projects = [...byPerson.entries()].map(([fbtimePersonId, byProject]) => {
      const rows = [...byProject.values()].sort(
        (a, b) => b.lastAt - a.lastAt || b.shifts - a.shifts || a.name.localeCompare(b.name)
      );
      return {
        fbtimePersonId,
        lastShiftAt: rows[0].lastAt,
        // Capped: one label would hide the split-week case, which is exactly
        // when a location column earns its place.
        projects: rows.slice(0, PROJECTS_PER_PERSON),
      };
    });

    res.json({ windowDays, startDate, endDate, timeZone, projects, degraded, reason });
  } catch (err) {
    next(err);
  }
});

const linkSchema = z.object({
  userId: hex24,
  fbtimePersonId: hex24,
  // Display labels, denormalized onto the link. FbTimePersonLink carries them so
  // a row "still means something if the person later disappears from /people" —
  // but only autoMatchByEmail ever wrote them, so every HAND-MADE link was blank
  // in exactly the case the fields exist for. Optional: an older client that
  // omits them leaves whatever is already stored untouched.
  fbtimeName: z.string().trim().max(200).nullish(),
  fbtimeEmail: z.string().trim().toLowerCase().max(320).nullish(),
});

const LINK_TAKEN = {
  error: 'That FbTime person is already linked to another user. Unlink them first.',
  code: 'LINK_TAKEN',
};
const LINK_CHANGE = {
  error: 'That canvasser is linked to a different FbTime person. Unlink them first.',
  code: 'LINK_CHANGE',
};

// An account was just linked (by hand or by the auto pass): any kept entry FOR that
// account ends — it is linked again (§G) — and the kept-account cut runs for the
// person it now belongs to. Returns the persons whose kept entries ended, whose
// shifts must re-resolve too.
const settleKeptOnLink = async (organizationId, fbtimePersonId, userId) => {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const before = await FbTimeConnection.findOneAndUpdate(
    { organizationId, 'keptAccounts.userId': uid },
    { $pull: { keptAccounts: { userId: uid } } },
    { new: false, projection: { keptAccounts: 1 } }
  ).lean();
  const ended = (before?.keptAccounts || [])
    .filter((k) => String(k.userId) === String(uid))
    .map((k) => normPersonId(k.fbtimePersonId))
    .filter(Boolean);
  await cutKeptAccounts(organizationId, fbtimePersonId, uid);
  return ended;
};

/**
 * Manually link one Doorline user to one FbTime person.
 *
 * Never re-points a linked canvasser to a different person (409 LINK_CHANGE —
 * unlink first, which asks whether the old link was right), and never links a
 * deleted account (409 ACCOUNT_DELETED). Linking the exact pair an admin just
 * unlinked as "the link was wrong" (Undo) cancels that clear if it hasn't run.
 */
router.post('/fbtime/links', async (req, res, next) => {
  try {
    const parsed = linkSchema.parse(req.body);
    const userId = parsed.userId.toLowerCase();
    const fbtimePersonId = normPersonId(parsed.fbtimePersonId);
    const { fbtimeName, fbtimeEmail } = parsed;
    const organizationId = orgIdOf(req);

    // The target must be a member of THIS org — a link is an org-scoped fact.
    const member = await Membership.findOne({ organizationId, userId }).lean();
    if (!member) return res.status(404).json({ error: 'That user is not a member of this organization.' });

    const user = await User.findById(userId, 'deletedAt').lean();
    if (!user || user.deletedAt) {
      return res.status(409).json({ error: "That account was deleted, so it can't be linked.", code: 'ACCOUNT_DELETED' });
    }
    const current = await FbTimePersonLink.findOne({ organizationId, userId }).lean();
    if (current && normPersonId(current.fbtimePersonId) !== fbtimePersonId) return res.status(409).json(LINK_CHANGE);
    // Links made before ids were lower-cased can differ only in case — still the same person.
    const takenByOther = await FbTimePersonLink.exists({
      organizationId,
      fbtimePersonId: new RegExp(`^${fbtimePersonId}$`, 'i'),
      userId: { $ne: userId },
    });
    if (takenByOther) return res.status(409).json(LINK_TAKEN);

    let link;
    try {
      link = await FbTimePersonLink.findOneAndUpdate(
        { organizationId, userId, fbtimePersonId: current ? current.fbtimePersonId : fbtimePersonId },
        {
          $set: {
            fbtimePersonId,
            source: 'manual',
            linkedByUserId: req.user._id,
            linkedAt: new Date(),
            // Only when supplied — re-linking without labels must not blank the
            // ones an earlier auto-match already stored.
            ...(fbtimeName ? { fbtimeName } : {}),
            ...(fbtimeEmail ? { fbtimeEmail } : {}),
          },
          $setOnInsert: { organizationId, userId },
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const raced = await FbTimePersonLink.findOne({ organizationId, userId }).lean();
      return res.status(409).json(raced && normPersonId(raced.fbtimePersonId) !== fbtimePersonId ? LINK_CHANGE : LINK_TAKEN);
    }

    const uid = new mongoose.Types.ObjectId(userId);
    const ended = await settleKeptOnLink(organizationId, fbtimePersonId, uid);

    // Undo of "the link was wrong": the same pair cancels its waiting clear, and an
    // admin linking the exact pair by hand takes it off the never-suggest list.
    const before = await FbTimeConnection.findOneAndUpdate(
      { organizationId },
      {
        $pull: {
          'doors.clearPersons': { fbtimePersonId, fromUserId: uid },
          'doors.rejected': { fbtimePersonId, userId: uid },
        },
      },
      { new: false, projection: { 'doors.clearPersons': 1 } }
    ).lean();
    const clearCancelled = (before?.doors?.clearPersons || []).some(
      (c) => normPersonId(c.fbtimePersonId) === fbtimePersonId && String(c.fromUserId) === userId
    );

    // Backfill the cache immediately — the join must not wait for a poll — through
    // the one owner rule, for this person and any person whose kept entry just ended.
    const owner = await loadShiftOwners(organizationId);
    for (const pid of new Set([fbtimePersonId, ...ended])) {
      await reassignPersonShifts(organizationId, pid, { owner });
    }
    await markDeepDue(organizationId);
    await audit(organizationId, req.user._id, 'link-created', {
      userId,
      fbtimePersonId,
      ...(clearCancelled ? { clearCancelled: true } : {}),
    });

    res.status(201).json({ link: { userId, fbtimePersonId, source: link.source }, clearCancelled });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (err?.code === 11000) return res.status(409).json(LINK_TAKEN);
    next(err);
  }
});

// The unlink's answer to "Was the link right?" — sent only when the row had door
// counts sent or the account was deleted; no body is a plain unlink.
const unlinkSchema = z.object({ doors: z.enum(['keep', 'clear']).optional() }).strict();

/**
 * Unlink. The cache rows re-resolve through the one owner rule (services/fbtime/
 * shiftOwner.js) — with no kept account that is "unmapped" (userId null), as
 * always; never deleted.
 *
 *   doors:'keep'  — the link was right. The account is KEPT for that FbTime person:
 *                   its shifts before `until` stay its own, and its doors are added
 *                   to a new account's (decisions 9 and 11).
 *   doors:'clear' — the link was wrong. Doorline clears every number it sent for
 *                   that person (only when it sent any), and never suggests the pair
 *                   again.
 */
router.delete('/fbtime/links/:userId', async (req, res, next) => {
  try {
    const userId = hex24.parse(req.params.userId).toLowerCase();
    const { doors: choice } = unlinkSchema.parse(req.body && typeof req.body === 'object' ? req.body : {});
    const organizationId = orgIdOf(req);
    const existing = await FbTimePersonLink.findOne({ organizationId, userId }).lean();
    if (!existing) return res.status(404).json({ error: 'No link for that user.' });
    const pid = normPersonId(existing.fbtimePersonId) || existing.fbtimePersonId;

    const connection = await FbTimeConnection.findOne({ organizationId }).lean();
    const clear = choice === 'clear' && (connection?.doors?.reported || []).map(normPersonId).includes(pid);
    if (clear && (connection.status === 'disconnected' || !connection.keyCiphertext)) {
      return res.status(409).json({
        error: 'Reconnect FbTime first — Doorline needs the connection to clear what it sent.',
        code: 'DOORS_NOT_CONNECTED',
      });
    }

    const link = await FbTimePersonLink.findOneAndDelete({ _id: existing._id });
    if (!link) return res.status(404).json({ error: 'No link for that user.' });
    const uid = new mongoose.Types.ObjectId(userId);

    let kept = false;
    if (choice === 'keep' && connection) {
      const u = await User.findById(userId, 'deletedAt').lean();
      const done = await FbTimeConnection.updateOne(
        { _id: connection._id, keptAccounts: { $not: { $elemMatch: { fbtimePersonId: pid, userId: uid } } } },
        {
          $push: {
            keptAccounts: {
              fbtimePersonId: pid,
              userId: uid,
              until: u?.deletedAt || new Date(), // its deletion, or now
              keptByUserId: req.user._id,
              keptAt: new Date(),
            },
          },
        }
      );
      kept = done.modifiedCount === 1;
    }
    if (clear) {
      await FbTimeConnection.updateOne(
        { _id: connection._id, 'doors.clearPersons': { $not: { $elemMatch: { fbtimePersonId: pid, fromUserId: uid } } } },
        { $push: { 'doors.clearPersons': { fbtimePersonId: pid, fromUserId: uid } } }
      );
      await FbTimeConnection.updateOne(
        { _id: connection._id, 'doors.rejected': { $not: { $elemMatch: { fbtimePersonId: pid, userId: uid } } } },
        { $push: { 'doors.rejected': { fbtimePersonId: pid, userId: uid } } }
      );
    }

    await reassignPersonShifts(organizationId, pid);
    await markDeepDue(organizationId);
    await audit(organizationId, req.user._id, 'link-removed', {
      userId,
      fbtimePersonId: pid,
      ...(choice ? { doors: choice } : {}),
      ...(clear ? { clear: true } : {}),
    });
    if (kept) await audit(organizationId, req.user._id, 'account-kept', { userId, fbtimePersonId: pid });
    if (clear) enqueueOrgSync(organizationId, 'door counts clear');
    res.json({ removed: true, kept, clear });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

/**
 * Stop counting a kept earlier account for an FbTime person. Its shifts return to
 * the current link (so the earlier account's past rates become estimated) and door
 * counts re-send without it.
 */
router.delete('/fbtime/kept/:fbtimePersonId/:userId', async (req, res, next) => {
  try {
    const pid = normPersonId(hex24.parse(req.params.fbtimePersonId));
    const userId = hex24.parse(req.params.userId).toLowerCase();
    const organizationId = orgIdOf(req);
    const uid = new mongoose.Types.ObjectId(userId);
    const done = await FbTimeConnection.updateOne(
      { organizationId, keptAccounts: { $elemMatch: { fbtimePersonId: pid, userId: uid } } },
      { $pull: { keptAccounts: { fbtimePersonId: pid, userId: uid } } }
    );
    if (!done.modifiedCount) {
      return res.status(404).json({ error: 'That earlier account is not counted for this person.' });
    }
    await reassignPersonShifts(organizationId, pid);
    await markDeepDue(organizationId);
    await audit(organizationId, req.user._id, 'account-kept-removed', { userId, fbtimePersonId: pid });
    res.json({ removed: true });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

/** Run the email auto-match pass on demand (also runs once at connect). */
router.post('/fbtime/links/auto', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId, status: { $ne: 'disconnected' } });
    if (!connection?.keyCiphertext) return res.status(404).json({ error: 'FbTime is not connected.' });

    const linked = await autoMatchByEmail(organizationId, openSecret(connection.keyCiphertext), req.user._id);
    res.json({ linked });
  } catch (err) {
    try {
      return sendProviderError(res, err);
    } catch {
      next(err);
    }
  }
});

/** Newest-first lifecycle history (the Billing tab's History pattern). */
router.get('/fbtime/events', async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const organizationId = orgIdOf(req);
    const rows = await IntegrationEvent.find({ organizationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    // Who did it, and whom a link event is about — names resolved at read time, so an
    // event never stores one (a deleted account shows its snapshot name until the purge).
    const hex = /^[0-9a-f]{24}$/i;
    const ids = rows
      .flatMap((r) => [r.byUserId, r.detail?.userId])
      .filter((id) => id && hex.test(String(id)))
      .map((id) => String(id).toLowerCase());
    const people = await hydrateCanvassers(ids, organizationId);
    const who = (id) => {
      const p = id && hex.test(String(id)) ? people.get(String(id).toLowerCase()) : null;
      return p ? { name: fullName(p), status: p.status } : null;
    };
    res.json({
      events: rows.map((r) => ({
        id: String(r._id),
        type: r.type,
        byUserId: r.byUserId ? String(r.byUserId) : null,
        by: r.byUserId ? who(r.byUserId) : null, // null = automatic
        subject: r.detail?.userId ? who(r.detail.userId) : null,
        detail: r.detail || null,
        at: r.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Link every FbTime person whose lowercase email matches exactly one active
 * member's, skipping anyone already linked on either side and any pair an admin
 * said was wrong. Returns the number linked; audited as one 'auto-matched' event
 * with the count. It never cancels a waiting clear (only a hand-made relink of the
 * same pair does).
 */
const autoMatchByEmail = async (organizationId, apiKey, byUserId) => {
  const [people, links, memberships, connection] = await Promise.all([
    listAllPeople({ apiKey, includeInactive: true }),
    FbTimePersonLink.find({ organizationId }).lean(),
    Membership.find({ organizationId, isActive: true }, 'userId').lean(),
    FbTimeConnection.findOne({ organizationId }).select('doors.rejected').lean(),
  ]);
  const users = await User.find(
    { _id: { $in: memberships.map((m) => m.userId) }, deletedAt: null },
    'firstName lastName email'
  ).lean();

  const rejected = new Set(
    (connection?.doors?.rejected || []).map((r) => `${normPersonId(r.fbtimePersonId)}|${String(r.userId)}`)
  );
  const linkedPersons = new Set(links.map((l) => normPersonId(l.fbtimePersonId) || l.fbtimePersonId));
  const linkedUsers = new Set(links.map((l) => String(l.userId)));
  const userByEmail = new Map();
  for (const u of users) {
    if (linkedUsers.has(String(u._id)) || !u.email) continue;
    userByEmail.set(String(u.email).toLowerCase(), u);
  }

  const linkedNow = [];
  for (const p of people) {
    const pid = normPersonId(p.id);
    if (!pid || linkedPersons.has(pid) || !p.email) continue;
    const match = userByEmail.get(String(p.email).toLowerCase());
    if (!match || rejected.has(`${pid}|${String(match._id)}`)) continue;

    try {
      await FbTimePersonLink.create({
        organizationId,
        userId: match._id,
        fbtimePersonId: pid,
        fbtimeEmail: String(p.email).toLowerCase(),
        fbtimeName: [p.firstName, p.lastName].filter(Boolean).join(' ') || null,
        source: 'auto-email',
        linkedByUserId: null, // the auto pass, not a person's choice
      });
    } catch (err) {
      if (err?.code === 11000) continue; // raced or double-linked — skip, never overwrite
      throw err;
    }
    userByEmail.delete(String(p.email).toLowerCase());
    linkedNow.push({ pid, userId: match._id });
  }

  if (linkedNow.length) {
    // Kept entries for the linked accounts end and the kept-account cut runs, then
    // the backfill through the one owner rule — the same steps as a hand-made link.
    const ended = [];
    for (const { pid, userId } of linkedNow) ended.push(...(await settleKeptOnLink(organizationId, pid, userId)));
    const owner = await loadShiftOwners(organizationId);
    for (const pid of new Set([...linkedNow.map((l) => l.pid), ...ended])) {
      await reassignPersonShifts(organizationId, pid, { owner });
    }
    await markDeepDue(organizationId);
    await audit(organizationId, byUserId, 'auto-matched', { count: linkedNow.length });
  }
  return linkedNow.length;
};

export default router;
