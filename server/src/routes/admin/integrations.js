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

/** Status + counts for the Integrations page. {connected:false} when absent. */
router.get('/fbtime', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId }).lean();
    if (!connection || connection.status === 'disconnected') {
      return res.json({ connected: false, configured: sealedSecretConfigured() });
    }

    const [linkCount, unmatchedWithHours] = await Promise.all([
      FbTimePersonLink.countDocuments({ organizationId }),
      FbTimeShift.distinct('fbtimePersonId', { organizationId, userId: null }),
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
 */
router.post('/fbtime/connect', async (req, res, next) => {
  try {
    if (!sealedSecretConfigured()) {
      return res.status(503).json({
        error: 'Secret sealing is not configured on this server (CREDENTIAL_SEAL_KEY).',
        code: 'SEALING_UNCONFIGURED',
      });
    }
    const { apiKey, confirmOrgChange } = keySchema
      .extend({ confirmOrgChange: z.boolean().optional() })
      .parse(req.body);

    const organizationId = orgIdOf(req);
    const pinged = await ping({ apiKey });

    const existing = await FbTimeConnection.findOne({ organizationId });
    const rotating = Boolean(existing && existing.status !== 'disconnected' && existing.keyCiphertext);
    if (
      rotating &&
      existing.fbtimeOrgId &&
      String(pinged.organization?.id) !== existing.fbtimeOrgId &&
      confirmOrgChange !== true
    ) {
      return res.status(409).json({
        error: `This key reads a different FbTime organization ("${pinged.organization?.name}") than the connected one ("${existing.fbtimeOrgName}"). Confirm the change to proceed.`,
        code: 'ORG_CHANGE_CONFIRM',
        organization: pinged.organization,
      });
    }

    const keyPrefix = apiKey.slice(0, 17); // "fbt_live_" + 8 display chars, the provider's own rule
    const update = {
      status: 'connected',
      keyCiphertext: sealSecret(apiKey),
      keyPrefix,
      fbtimeOrgId: String(pinged.organization?.id || ''),
      fbtimeOrgName: pinged.organization?.name || null,
      connectedByUserId: req.user._id,
      connectedAt: new Date(),
      lastSyncError: null,
    };
    const connection = await FbTimeConnection.findOneAndUpdate(
      { organizationId },
      { $set: update, $setOnInsert: { organizationId } },
      { upsert: true, new: true }
    );

    await audit(organizationId, req.user._id, rotating ? 'key-rotated' : 'connected', {
      keyPrefix,
      fbtimeOrgName: connection.fbtimeOrgName,
    });

    // First auto-match pass — an explicit act, audited with its count, never a
    // background sweep (an admin's later unlink stays unlinked).
    let autoMatched = 0;
    try {
      autoMatched = await autoMatchByEmail(organizationId, apiKey, req.user._id);
    } catch (err) {
      // Roster fetch failing must not fail the connect; the mapping screen has
      // its own button to retry.
      console.error('[integrations] auto-match at connect failed:', err?.message);
    }

    // Seed the hours cache now rather than at the next cron tick. Fire-and-forget
    // with a bounded wait, like every enqueue on the request path.
    getQueue(QUEUE_NAMES.MAINTENANCE)
      .add(FBTIME_ORG_JOB, { organizationId: String(organizationId) }, { removeOnComplete: true, removeOnFail: true })
      .catch((err) => console.error('[integrations] initial sync enqueue failed:', err?.message));

    res.status(rotating ? 200 : 201).json({
      connected: true,
      status: 'connected',
      keyPrefix,
      fbtimeOrgName: connection.fbtimeOrgName,
      hourFigure: connection.hourFigure,
      autoMatched,
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
    connection.manualSyncRequestedAt = now;
    await connection.save();

    // Fire-and-forget, like the connect route's enqueue — completion is read
    // off the connection's sync stamps, never off the job.
    getQueue(QUEUE_NAMES.MAINTENANCE)
      .add(FBTIME_ORG_JOB, { organizationId: String(organizationId) }, { removeOnComplete: true, removeOnFail: true })
      .catch((err) => console.error('[integrations] manual sync enqueue failed:', err?.message));

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

/**
 * Disconnect. The ciphertext is cleared (a disconnected row must not hold a
 * working credential) and the HOURS CACHE IS DELETED — reports revert to span
 * math instantly, so a disconnected org is indistinguishable from one that
 * never connected. Links and history survive: they are the org's own labor
 * and audit trail, and reconnecting finds the roster already mapped.
 */
router.delete('/fbtime', async (req, res, next) => {
  try {
    const organizationId = orgIdOf(req);
    const connection = await FbTimeConnection.findOne({ organizationId });
    if (!connection || connection.status === 'disconnected') {
      return res.status(404).json({ error: 'FbTime is not connected.' });
    }

    connection.status = 'disconnected';
    connection.keyCiphertext = null;
    connection.lastSyncError = null;
    await connection.save();
    await FbTimeShift.deleteMany({ organizationId });
    await audit(organizationId, req.user._id, 'disconnected', { keyPrefix: connection.keyPrefix });

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
    const linkByPerson = new Map(links.map((l) => [l.fbtimePersonId, l]));
    const hasHours = new Set(unmatchedIds);

    // Suggestions: same lowercase email on both rosters, not yet linked either way.
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
      if (linkByPerson.has(String(p.id))) continue;
      const match = p.email && userByEmail.get(String(p.email).toLowerCase());
      if (match) suggestions.push({ fbtimePersonId: String(p.id), userId: String(match._id) });
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
    const rosterIds = new Set(people.map((p) => String(p.id)));
    const orphanLinks = links
      .filter((l) => !rosterIds.has(l.fbtimePersonId))
      .map((l) => ({
        fbtimePersonId: l.fbtimePersonId,
        userId: String(l.userId),
        fbtimeName: l.fbtimeName || null,
        fbtimeEmail: l.fbtimeEmail || null,
        source: l.source || null,
        linkedAt: l.linkedAt || null,
      }));
    // userId:null on a shift means unlinked (link creation backfills it), so a
    // ghost can never also be an orphanLink.
    const ghostPersonIds = unmatchedIds.map(String).filter((id) => !rosterIds.has(id));

    res.json({
      people: people.map((p) => {
        const link = linkByPerson.get(String(p.id));
        return {
          fbtimePersonId: String(p.id),
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          email: p.email || null,
          isActive: p.isActive !== false,
          linkedUserId: link ? String(link.userId) : null,
          linkSource: link?.source || null,
          hasUnmatchedHours: !link && hasHours.has(String(p.id)),
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

/** Manually link one Doorline user to one FbTime person. */
router.post('/fbtime/links', async (req, res, next) => {
  try {
    const { userId, fbtimePersonId, fbtimeName, fbtimeEmail } = linkSchema.parse(req.body);
    const organizationId = orgIdOf(req);

    // The target must be a member of THIS org — a link is an org-scoped fact.
    const member = await Membership.findOne({ organizationId, userId }).lean();
    if (!member) return res.status(404).json({ error: 'That user is not a member of this organization.' });

    const user = await User.findById(userId, 'firstName lastName email').lean();
    const link = await FbTimePersonLink.findOneAndUpdate(
      { organizationId, userId },
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

    // Backfill the cache immediately — the join must not wait for a poll.
    await FbTimeShift.updateMany(
      { organizationId, fbtimePersonId },
      { $set: { userId: new mongoose.Types.ObjectId(userId) } }
    );
    await audit(organizationId, req.user._id, 'link-created', {
      userId,
      fbtimePersonId,
      userEmail: user?.email || null,
    });

    res.status(201).json({ link: { userId, fbtimePersonId, source: link.source } });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    if (err?.code === 11000) {
      return res.status(409).json({
        error: 'That FbTime person is already linked to another user. Unlink them first.',
        code: 'LINK_TAKEN',
      });
    }
    next(err);
  }
});

/** Unlink. The cache rows revert to unmapped (userId null), never deleted. */
router.delete('/fbtime/links/:userId', async (req, res, next) => {
  try {
    const userId = hex24.parse(req.params.userId);
    const organizationId = orgIdOf(req);
    const link = await FbTimePersonLink.findOneAndDelete({ organizationId, userId });
    if (!link) return res.status(404).json({ error: 'No link for that user.' });

    await FbTimeShift.updateMany(
      { organizationId, fbtimePersonId: link.fbtimePersonId },
      { $set: { userId: null } }
    );
    await audit(organizationId, req.user._id, 'link-removed', {
      userId,
      fbtimePersonId: link.fbtimePersonId,
    });
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
    const rows = await IntegrationEvent.find({ organizationId: orgIdOf(req) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({
      events: rows.map((r) => ({
        id: String(r._id),
        type: r.type,
        byUserId: r.byUserId ? String(r.byUserId) : null,
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
 * member's, skipping anyone already linked on either side. Returns the number
 * linked; audited as one 'auto-matched' event with the count.
 */
async function autoMatchByEmail(organizationId, apiKey, byUserId) {
  const [people, links, memberships] = await Promise.all([
    listAllPeople({ apiKey, includeInactive: true }),
    FbTimePersonLink.find({ organizationId }).lean(),
    Membership.find({ organizationId, isActive: true }, 'userId').lean(),
  ]);
  const users = await User.find(
    { _id: { $in: memberships.map((m) => m.userId) } },
    'firstName lastName email'
  ).lean();

  const linkedPersons = new Set(links.map((l) => l.fbtimePersonId));
  const linkedUsers = new Set(links.map((l) => String(l.userId)));
  const userByEmail = new Map();
  for (const u of users) {
    if (linkedUsers.has(String(u._id)) || !u.email) continue;
    userByEmail.set(String(u.email).toLowerCase(), u);
  }

  let linked = 0;
  for (const p of people) {
    const pid = String(p.id);
    if (linkedPersons.has(pid) || !p.email) continue;
    const match = userByEmail.get(String(p.email).toLowerCase());
    if (!match) continue;

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
    await FbTimeShift.updateMany(
      { organizationId, fbtimePersonId: pid },
      { $set: { userId: match._id } }
    );
    linked += 1;
  }

  if (linked > 0) await audit(organizationId, byUserId, 'auto-matched', { count: linked });
  return linked;
}

export default router;
