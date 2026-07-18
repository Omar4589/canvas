import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { EmailLog } from '../../models/EmailLog.js';
import { Organization } from '../../models/Organization.js';

// The transactional-email log: /super-admin/emails. Metadata only (models/EmailLog.js writes
// come from the sendMail chokepoint) — rendered content and bounce forensics live in the Resend
// dashboard; this page answers "what did WE send, to whom, and did Resend accept it" without
// leaving Doorline, and doubles as the deletion-warning evidence trail (those rows never expire).
// Super-admin only: the log spans every organization.
const router = Router();
router.use(requireAuth, requireSuperAdmin);

const listSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kind: z.string().max(60).optional(),
  outcome: z.enum(['sent', 'failed', 'dormant']).optional(),
  organizationId: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const filter = {};
    if (q.kind) filter.kind = q.kind;
    if (q.outcome) filter.outcome = q.outcome;
    if (q.organizationId) {
      if (!mongoose.isValidObjectId(q.organizationId)) {
        return res.status(400).json({ error: 'Invalid organizationId' });
      }
      filter.organizationId = q.organizationId;
    }

    const dayAgo = new Date(Date.now() - 86_400_000);
    const [total, rows, kinds, sent24h, failed24h] = await Promise.all([
      EmailLog.countDocuments(filter),
      EmailLog.find(filter)
        .sort({ sentAt: -1 })
        .skip(q.skip)
        .limit(q.limit)
        .populate('organizationId', 'name slug')
        .lean(),
      // The kind list drives the filter dropdown — actual values present, not a hardcoded set.
      EmailLog.distinct('kind'),
      EmailLog.countDocuments({ outcome: 'sent', sentAt: { $gte: dayAgo } }),
      EmailLog.countDocuments({ outcome: 'failed', sentAt: { $gte: dayAgo } }),
    ]);

    res.json({
      emails: rows.map((r) => ({
        id: String(r._id),
        kind: r.kind,
        to: r.to,
        subject: r.subject,
        outcome: r.outcome,
        error: r.error || null,
        // What the inbox side reported via the Resend webhook — null until an event arrives
        // (or forever, if webhooks aren't configured). bounced/complained carry deliveryDetail.
        deliveryStatus: r.deliveryStatus || null,
        deliveryAt: r.deliveryAt || null,
        deliveryDetail: r.deliveryDetail || null,
        // Live org when it still exists; the send-time NAME SNAPSHOT when it doesn't — a
        // deletion-warning evidence row must stay legible after the org it warned is purged.
        organization: r.organizationId
          ? { id: String(r.organizationId._id), name: r.organizationId.name, slug: r.organizationId.slug }
          : r.organizationName
            ? { id: null, name: r.organizationName, slug: null, deleted: true }
            : null,
        sentAt: r.sentAt,
        // Surfaced so the UI can badge the never-expiring evidence rows (deletion warnings).
        keptForever: !r.expiresAt,
      })),
      total,
      kinds: kinds.sort(),
      last24h: { sent: sent24h, failed: failed24h },
    });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// Small helper for the org filter's dropdown/search (name → id), so the page doesn't need the
// whole org directory endpoint just to filter emails.
router.get('/orgs', async (req, res, next) => {
  try {
    const ids = await EmailLog.distinct('organizationId', { organizationId: { $ne: null } });
    const orgs = await Organization.find({ _id: { $in: ids } }).select('name slug').sort({ name: 1 }).lean();
    res.json({ orgs: orgs.map((o) => ({ id: String(o._id), name: o.name, slug: o.slug })) });
  } catch (err) {
    next(err);
  }
});

export default router;
