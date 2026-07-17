import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { SupportAccessGrant } from '../../models/SupportAccessGrant.js';
import { AccessLog } from '../../models/AccessLog.js';
import { Organization } from '../../models/Organization.js';
import { User } from '../../models/User.js';
import { createGrant, revokeGrant, activeGrant, DEFAULT_GRANT_HOURS, MAX_GRANT_HOURS } from '../../services/access/supportAccess.js';
import { retentionHealth } from '../../services/retention/purgeDeletedIdentities.js';
import { deletionRequestHealth } from '../../services/retention/triggers.js';
import { requestOrgDeletion, cancelOrgDeletion, listDeletionRequests, DeletionRequestError } from '../../services/retention/deletionRequests.js';
import { idleZeroDollarOrgs } from '../../services/billing/idleOrgs.js';
import { getPlatformStats, recomputeLive } from '../../services/platform/platformStats.js';
import { REPEATABLE_JOBS } from '../../services/retention/scheduler.js';

// Support access: the front door into a customer organization, and the record of who used it.
//
// Entering a customer org used to be free and invisible — set an X-Org-Id header and you were their
// admin. Now it costs a typed reason and expires on its own, and every request that touches voter
// data is written to AccessLog. (Request-level, deliberately: the log stores route templates and
// resource classes, never record ids — see models/AccessLog.js.) See models/SupportAccessGrant.js.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

const grantSchema = z.object({
  organizationId: z.string(),
  // The reason is the point. Enforced non-trivial so "asdf" doesn't become the house style.
  reason: z.string().trim().min(10, 'Say why, in a sentence — this is the record of why you looked.').max(500),
  kind: z.enum(['support', 'incident', 'migration', 'audit', 'other']).optional(),
  hours: z.number().int().min(1).max(MAX_GRANT_HOURS).optional(),
});

// Start a session. Idempotent: an existing live grant is returned rather than stacked, so "how long
// have they been in there" has exactly one answer.
router.post('/grants', async (req, res, next) => {
  try {
    const data = grantSchema.parse(req.body);
    if (!mongoose.isValidObjectId(data.organizationId)) {
      return res.status(400).json({ error: 'Invalid organizationId' });
    }
    const org = await Organization.findById(data.organizationId, 'name slug').lean();
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const grant = await createGrant({
      actorUserId: req.user._id,
      organizationId: org._id,
      reason: data.reason,
      kind: data.kind,
      hours: data.hours,
    });

    res.status(201).json({
      grant: {
        id: String(grant._id),
        organizationId: String(org._id),
        organizationName: org.name,
        reason: grant.reason,
        kind: grant.kind,
        expiresAt: grant.expiresAt,
      },
      // Say it out loud. An operator should never be surprised later that this was recorded.
      notice: `Access to ${org.name} is open until ${grant.expiresAt.toISOString()}. Every request you make that touches voter data is logged against your name.`,
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.issues[0]?.message || 'Invalid input', issues: err.issues });
    next(err);
  }
});

// My live grants (what am I currently inside?). `all=1` widens to everyone's grants, but only for
// break-glass operators — the response says which view it actually is via `scope`, so the UI can
// label itself honestly instead of showing a support-tier operator "nobody is inside" while
// colleagues are.
router.get('/grants', async (req, res, next) => {
  try {
    const allScope = req.query.all === '1' && req.user.platformRole === 'break_glass';
    const mine = allScope ? {} : { actorUserId: req.user._id };
    const grants = await SupportAccessGrant.find({ ...mine, revokedAt: null, expiresAt: { $gt: new Date() } })
      .populate('organizationId', 'name slug')
      .populate('actorUserId', 'firstName lastName email')
      .sort({ expiresAt: -1 })
      .lean();
    // How much was actually read under each grant — the middleware stores per-request rows/bytes;
    // summed here they separate a one-voter peek from a bulk export at a glance.
    const readAgg = grants.length
      ? await AccessLog.aggregate([
        { $match: { grantId: { $in: grants.map((g) => g._id) } } },
        {
          $group: {
            _id: '$grantId',
            requests: { $sum: 1 },
            rows: { $sum: { $ifNull: ['$rows', 0] } },
            bytes: { $sum: { $ifNull: ['$bytes', 0] } },
          },
        },
      ])
      : [];
    const readByGrant = new Map(readAgg.map((t) => [String(t._id), t]));
    res.json({
      scope: allScope ? 'all' : 'mine',
      grants: grants.map((g) => {
        const read = readByGrant.get(String(g._id));
        return {
          id: String(g._id),
          organization: g.organizationId ? { id: String(g.organizationId._id), name: g.organizationId.name } : null,
          actor: g.actorUserId ? `${g.actorUserId.firstName} ${g.actorUserId.lastName}` : null,
          reason: g.reason,
          kind: g.kind,
          expiresAt: g.expiresAt,
          accessCount: g.accessCount,
          lastAccessAt: g.lastAccessAt,
          read: { requests: read?.requests || 0, rows: read?.rows || 0, bytes: read?.bytes || 0 },
        };
      }),
      defaultHours: DEFAULT_GRANT_HOURS,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/grants/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const g = await revokeGrant(req.params.id, req.user._id);
    if (!g) return res.status(404).json({ error: 'Grant not found or already revoked' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// A bare YYYY-MM-DD is a UTC day (start or end); anything longer is parsed as given.
function parseDayBound(value, endOfDay) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(s.length === 10 ? `${s}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// The audit trail. Answers "did anyone at Doorline read this customer's data?" — a question we
// previously could not answer at all. Paged (skip/limit + exact total) so history past the first
// page stays reachable, and filterable by org, actor, grant, and date window.
router.get('/log', async (req, res, next) => {
  try {
    const q = {};
    if (req.query.organizationId && mongoose.isValidObjectId(req.query.organizationId)) {
      q.organizationId = req.query.organizationId;
    }
    if (req.query.actorUserId && mongoose.isValidObjectId(req.query.actorUserId)) {
      q.actorUserId = req.query.actorUserId;
    }
    if (req.query.grantId && mongoose.isValidObjectId(req.query.grantId)) {
      q.grantId = req.query.grantId;
    }
    const from = parseDayBound(req.query.from, false);
    const to = parseDayBound(req.query.to, true);
    if (from || to) {
      q.at = {};
      if (from) q.at.$gte = from;
      if (to) q.at.$lte = to;
    }
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const [total, rows] = await Promise.all([
      AccessLog.countDocuments(q),
      AccessLog.find(q)
        .populate('actorUserId', 'firstName lastName email')
        .populate('organizationId', 'name slug')
        .populate('grantId', 'reason kind')
        .sort({ at: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      entries: rows.map((r) => ({
        at: r.at,
        actor: r.actorUserId ? `${r.actorUserId.firstName} ${r.actorUserId.lastName} <${r.actorUserId.email}>` : 'unknown',
        organization: r.organizationId?.name || 'unknown',
        method: r.method,
        route: r.route,
        resource: r.resource,
        reason: r.grantId?.reason || null,
        // Read magnitude: rows = payload list length (null = unknown/single record), bytes =
        // uncompressed payload size. These are request-rows, NOT distinct voters.
        rows: r.rows ?? null,
        bytes: r.bytes ?? null,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

// Filter options for the log (every actor/org that appears in it), plus the log's true extent —
// total row count and oldest entry — so the visible page is never mistaken for the whole history.
router.get('/log-facets', async (req, res, next) => {
  try {
    const [actorIds, orgIds, logTotal, oldest] = await Promise.all([
      AccessLog.distinct('actorUserId'),
      AccessLog.distinct('organizationId'),
      AccessLog.estimatedDocumentCount(),
      AccessLog.findOne({}, 'at').sort({ at: 1 }).lean(),
    ]);
    const [actors, orgs] = await Promise.all([
      User.find({ _id: { $in: actorIds } }, 'firstName lastName email').lean(),
      Organization.find({ _id: { $in: orgIds } }, 'name').lean(),
    ]);
    const byName = (a, b) => a.name.localeCompare(b.name);
    res.json({
      actors: actors
        .map((u) => ({ id: String(u._id), name: `${u.firstName} ${u.lastName}`, email: u.email }))
        .sort(byName),
      organizations: orgs.map((o) => ({ id: String(o._id), name: o.name })).sort(byName),
      logTotal,
      oldestAt: oldest?.at || null,
    });
  } catch (err) {
    next(err);
  }
});

// Is retention actually being enforced right now? Goes RED when ANY retention job stops — which is
// what a silently-dead scheduled job looks like from the outside. See services/retention/.
//
// Worst job wins. This asks about every job in REPEATABLE_JOBS rather than just the identity purge,
// because the two fail independently and the one that matters most legally — `retention-triggers`,
// which deletes organizations and honours the delete-on-request SLA — is not the one the banner used
// to watch. Green here has to mean every promise is being kept, or it means nothing.
router.get('/health/retention', async (req, res, next) => {
  try {
    const [jobs, delReq] = await Promise.all([
      Promise.all(REPEATABLE_JOBS.map((j) => retentionHealth(j.name, j.label))),
      deletionRequestHealth(),
    ]);
    const broken = jobs.filter((j) => !j.healthy);
    // The banner is red if a retention JOB has gone quiet OR a customer's deletion request is stuck /
    // failed. A green "job ran fine" is not the whole promise — a request that ran and errored, or is
    // overdue, is exactly the silent failure a customer would be harmed by.
    const delMsgs = [];
    if (delReq.failed) delMsgs.push(`${delReq.failed} deletion request(s) FAILED and need a human.`);
    if (delReq.stuck) delMsgs.push(`${delReq.stuck} deletion request(s) are overdue and not yet completed.`);
    const healthy = broken.length === 0 && delReq.healthy;
    res.json({
      ...jobs[0], // the identity purge's detail fields, kept for the existing client contract
      healthy,
      message: healthy
        ? 'Retention is being enforced.'
        : [...broken.map((j) => j.message), ...delMsgs].join(' '),
      jobs,
      deletionRequests: delReq,
    });
  } catch (err) {
    next(err);
  }
});

// ── Zombie watch: $0 idle orgs the retention sweep will never catch, for a human to decide on. ──
router.get('/idle-orgs', async (req, res, next) => {
  try {
    const months = Number(req.query.months) || undefined;
    res.json(await idleZeroDollarOrgs({ months }));
  } catch (err) {
    next(err);
  }
});

// ── Platform lifetime marketing counters (total = live + captured-from-deleted; internal excluded). ──
router.get('/platform-stats', async (req, res, next) => {
  try {
    res.json(await getPlatformStats());
  } catch (err) {
    next(err);
  }
});

// Manual "Reconcile now" — the same recompute the nightly job runs (idempotent: live bucket is
// re-derived from real rows; the deleted bank is never touched), for when the operator is looking
// at a stale "last reconciled" and doesn't want to wait for 03:47 UTC.
router.post('/platform-stats/reconcile', async (req, res, next) => {
  try {
    const live = await recomputeLive({ stampBackfill: true });
    res.json({ ok: true, live, stats: await getPlatformStats() });
  } catch (err) {
    next(err);
  }
});

// ── Deletion requests: the intake behind "you may request deletion of your data." ──
// Creating one SCHEDULES the org's deletion for now + SLA (default 30 days); the retention sweep
// executes it. Cancellable until it fires. This is the producer the executor was missing.
router.get('/deletion-requests', async (req, res, next) => {
  try {
    const status = ['scheduled', 'completed', 'cancelled', 'failed'].includes(req.query.status)
      ? req.query.status
      : null;
    const limit = Math.min(Number(req.query.limit) || 200, 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);
    const { rows, total } = await listDeletionRequests({ status, skip, limit });
    const now = Date.now();
    res.json({
      requests: rows.map((r) => ({
        id: String(r._id),
        organization: r.organizationId ? { id: String(r.organizationId._id), name: r.organizationId.name, slug: r.organizationId.slug } : null,
        status: r.status,
        note: r.note || null,
        requestedByEmail: r.requestedByEmail || null,
        requestedAt: r.requestedAt,
        scheduledFor: r.scheduledFor,
        completedAt: r.completedAt,
        cancelledAt: r.cancelledAt,
        attempts: r.attempts || 0,
        error: r.error || null,
        // Still scheduled past its own deadline = the SLA is being missed right now.
        overdue: r.status === 'scheduled' && r.scheduledFor && new Date(r.scheduledFor).getTime() < now,
      })),
      total,
    });
  } catch (err) {
    next(err);
  }
});

const deletionRequestSchema = z.object({
  organizationId: z.string(),
  note: z.string().max(2000).optional(),
  requestedByEmail: z.string().email().optional(),
});

router.post('/deletion-requests', async (req, res, next) => {
  try {
    const body = deletionRequestSchema.parse(req.body);
    if (!mongoose.isValidObjectId(body.organizationId)) return res.status(400).json({ error: 'Invalid organizationId' });
    const { request, org, alreadyScheduled } = await requestOrgDeletion({
      organizationId: body.organizationId,
      requestedBy: req.user._id,
      requestedByEmail: body.requestedByEmail || null,
      note: body.note || '',
    });
    res.status(alreadyScheduled ? 200 : 201).json({
      alreadyScheduled,
      request: { id: String(request._id), status: request.status, scheduledFor: request.scheduledFor },
      organization: { id: String(org._id), name: org.name, slug: org.slug },
      notice: alreadyScheduled
        ? 'This organization already has a deletion scheduled.'
        : `Deletion scheduled for ${new Date(request.scheduledFor).toISOString().slice(0, 10)}. Cancellable until then.`,
    });
  } catch (err) {
    if (err instanceof DeletionRequestError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.post('/deletion-requests/:requestId/cancel', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.requestId)) return res.status(400).json({ error: 'Invalid requestId' });
    const request = await cancelOrgDeletion({ requestId: req.params.requestId, cancelledBy: req.user._id });
    res.json({ ok: true, request: { id: String(request._id), status: request.status } });
  } catch (err) {
    if (err instanceof DeletionRequestError) return res.status(err.status).json({ error: err.message, code: err.code });
    next(err);
  }
});

export default router;
