import { Router } from 'express';
import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { Organization } from '../../models/Organization.js';
import { Membership } from '../../models/Membership.js';
import { User } from '../../models/User.js';
import { Campaign } from '../../models/Campaign.js';
import { requireAuth, requireSuperAdmin, requireBreakGlass } from '../../middleware/auth.js';
import { slugSchema, emailSchema, nameSchema, passwordSchema } from '../../utils/validators.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { currentUsage, currentMonth } from '../../services/billing/statement.js';
import { idleZeroDollarOrgs } from '../../services/billing/idleOrgs.js';
import { createOrgMember, MemberError } from '../../services/memberships/createMember.js';
import { bumpLive } from '../../services/platform/platformStats.js';
import { deleteOrganization } from '../../services/platform/deleteOrganization.js';

const router = Router();
router.use(requireAuth, requireSuperAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema.optional(),
  isActive: z.boolean().optional(),
  // Trial length in days (default 7). The clock runs from creation.
  trialDays: z.number().int().min(1).max(90).optional(),
  // Optional: seat the client's first admin in the same step. When present, the super admin
  // may TYPE a temp password (a simple one is fine) or leave it blank to auto-generate; either
  // way it's returned ONCE for out-of-band hand-off and the admin is forced to choose a strong
  // password on first login. This admin gets billingAccess (they're the bill-payer).
  admin: z
    .object({
      firstName: nameSchema,
      lastName: nameSchema,
      email: emailSchema,
      password: passwordSchema.optional(),
    })
    .optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slugSchema.optional(),
  isActive: z.boolean().optional(),
});

// The org list. Opt-in paging contract: without skip/limit the FULL list returns (the legacy shape
// shipped mobile builds rely on); with them, a page + the exact total. `q` searches name/slug;
// `sort` is name | created (default, newest first) | trialEnds (soonest first). Sorting happens
// after the subscription join because trialEndsAt lives on Subscription, not Organization — the
// whole set is loaded either way (it always was), so the slice is applied last and stays exact.
router.get('/', async (req, res, next) => {
  try {
    const qText = (req.query.q || '').toString().trim();
    const filter = {};
    if (qText) {
      const rx = new RegExp(qText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { slug: rx }];
    }
    const orgs = await Organization.find(filter).sort({ createdAt: -1 }).lean();
    const ids = orgs.map((o) => o._id);
    const memberCounts = await Membership.aggregate([
      { $match: { organizationId: { $in: ids }, isActive: true } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    // Split active vs archived so the two columns stop counting on different bases unlabeled
    // (members = active only; campaigns used to silently include archived).
    const campaignCounts = await Campaign.aggregate([
      { $match: { organizationId: { $in: ids } } },
      {
        $group: {
          _id: '$organizationId',
          count: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } },
        },
      },
    ]);
    const memberMap = new Map(memberCounts.map((r) => [String(r._id), r.count]));
    const campaignMap = new Map(campaignCounts.map((r) => [String(r._id), r]));
    // Billing summary per org — status pill + "needs attention" strip data.
    const subs = await Subscription.find({ organizationId: { $in: ids } }).lean();
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    let rows = orgs.map((o) => {
      const sub = subMap.get(String(o._id)) || null;
      const ent = entitlementFor(sub);
      const camp = campaignMap.get(String(o._id));
      return {
        id: String(o._id),
        name: o.name,
        slug: o.slug,
        isActive: o.isActive,
        memberCount: memberMap.get(String(o._id)) || 0,
        campaignCount: camp?.count || 0,
        campaignsActive: camp?.active || 0,
        campaignsArchived: (camp?.count || 0) - (camp?.active || 0),
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        billing: {
          status: sub?.status ?? null,
          effective: ent.effective,
          trialEndsAt: sub?.trialEndsAt ?? null,
          trialDaysLeft: ent.trialDaysLeft,
        },
      };
    });

    const sort = req.query.sort;
    if (sort === 'name') {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'trialEnds') {
      rows.sort((a, b) => {
        const at = a.billing.trialEndsAt ? new Date(a.billing.trialEndsAt).getTime() : Infinity;
        const bt = b.billing.trialEndsAt ? new Date(b.billing.trialEndsAt).getTime() : Infinity;
        return at - bt;
      });
    } // default: createdAt desc, already the query order

    const total = rows.length;
    if (req.query.skip !== undefined || req.query.limit !== undefined) {
      const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
      const skip = Math.max(Number(req.query.skip) || 0, 0);
      rows = rows.slice(skip, skip + limit);
    }
    res.json({ organizations: rows, total });
  } catch (err) {
    next(err);
  }
});

// ── This month's revenue across every customer org, in one response. ──
// Powers the Organizations page's revenue bar and per-row $ column. N+1 over orgs by design
// (each org's usage is one statement walk — same tradeoff as idle-orgs); fine at platform scale,
// revisit with a single aggregate if the org count grows past the low hundreds.
// Count contract: "billable" = statement lines where l.billable === true (first knock happened
// before the month ended AND the campaign wasn't archived before the month began — see
// services/billing/statement.js). Internal orgs are not revenue and are excluded entirely.
router.get('/billing-rollup', async (req, res, next) => {
  try {
    const orgs = await Organization.find({}, 'name slug isActive').sort({ name: 1 }).lean();
    const subs = await Subscription.find({}).lean();
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    const rows = [];
    for (const o of orgs) {
      const sub = subMap.get(String(o._id)) || null;
      if (sub?.status === 'internal') continue;
      const ent = entitlementFor(sub);
      const usage = await currentUsage(o._id);
      rows.push({
        organizationId: String(o._id),
        name: o.name,
        isActive: o.isActive,
        status: sub?.status ?? null,
        effective: ent.effective,
        trialEndsAt: sub?.trialEndsAt ?? null,
        trialDaysLeft: ent.trialDaysLeft,
        windDownEndsAt: ent.windDownEndsAt ?? null,
        rateCents: usage.rateCents,
        billableCampaigns: usage.billableCampaigns,
        totalCents: usage.totalCents,
        setupCount: usage.setupCount,
      });
    }
    rows.sort((a, b) => b.totalCents - a.totalCents);
    const byStatus = {};
    for (const r of rows) byStatus[r.effective] = (byStatus[r.effective] || 0) + 1;
    res.json({
      month: currentMonth(),
      totalCents: rows.reduce((s, r) => s + r.totalCents, 0),
      billableCampaigns: rows.reduce((s, r) => s + r.billableCampaigns, 0),
      byStatus,
      organizations: rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── The lifecycle triage list: every account a revenue owner should be chasing right now. ──
// One server-side definition (replacing the web client's old ≤2-day heuristic) shared by the
// Organizations strip and the Control Room: trials expiring within `days` (default 7), past-due
// and suspended accounts (with how long), canceled orgs in wind-down (with the deletion date),
// and idle $0 zombies (reusing the idle-orgs sweep). Internal orgs never appear.
router.get('/at-risk', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
    const [orgs, subs, idle] = await Promise.all([
      Organization.find({ isActive: true }, 'name slug').lean(),
      Subscription.find({}).lean(),
      idleZeroDollarOrgs(),
    ]);
    const subMap = new Map(subs.map((s) => [String(s.organizationId), s]));
    const items = [];
    for (const o of orgs) {
      const sub = subMap.get(String(o._id)) || null;
      if (!sub || sub.status === 'internal') continue;
      const ent = entitlementFor(sub);
      const base = { organizationId: String(o._id), name: o.name, slug: o.slug };
      if (sub.status === 'trial' && ent.trialDaysLeft !== null && ent.trialDaysLeft <= days) {
        items.push({ ...base, type: 'trial_expiring', trialDaysLeft: ent.trialDaysLeft, trialEndsAt: sub.trialEndsAt });
      } else if (sub.status === 'past_due') {
        items.push({ ...base, type: 'past_due', since: sub.statusChangedAt });
      } else if (sub.status === 'suspended') {
        items.push({ ...base, type: 'suspended', since: sub.statusChangedAt });
      } else if (sub.status === 'canceled' && ent.windDownEndsAt) {
        items.push({ ...base, type: 'wind_down', windDownEndsAt: ent.windDownEndsAt });
      }
    }
    for (const z of idle.orgs) {
      items.push({
        organizationId: z.organizationId,
        name: z.name,
        slug: z.slug,
        type: 'idle',
        monthsIdle: z.monthsIdle,
        lastActivityAt: z.lastActivityAt,
      });
    }
    res.json({ days, idleMonths: idle.months, items });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const slug = (data.slug || Organization.toSlug(data.name)).toLowerCase();
    if (!slug) return res.status(400).json({ error: 'Could not derive slug from name' });
    // Pre-check the admin email so a conflict fails BEFORE we create the org — no
    // partial "org with a trial but no admin" state on the common failure.
    if (data.admin) {
      const taken = await User.findOne({ email: data.admin.email.toLowerCase().trim() }, { _id: 1 }).lean();
      if (taken) {
        return res.status(409).json({
          error: 'An account with that admin email already exists — add them from the Users page after creating the org.',
          code: 'EMAIL_EXISTS_USE_LINK',
        });
      }
    }
    const org = await Organization.create({
      name: data.name.trim(),
      slug,
      isActive: data.isActive !== false,
      createdBy: req.user._id,
    });
    // Every new org starts a trial (default 7 days; user decision, Jul 2026). The
    // clock runs from creation — create the org right after the demo call.
    const trialDays = data.trialDays ?? 7;
    await Subscription.create({
      organizationId: org._id,
      status: 'trial',
      trialEndsAt: new Date(Date.now() + trialDays * 86400000),
      statusChangedAt: new Date(),
    });
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      toStatus: 'trial',
      reason: `Organization created — ${trialDays}-day trial started`,
    });

    // Lifetime marketing counter: a real customer org was created (new orgs start on a trial, never
    // 'internal', so this is always a countable org).
    await bumpLive('organizations', 1, { isInternal: false });

    // Optionally seat the first admin in the same step (closes the chicken-and-egg
    // gap: POST /admin/memberships needs an existing org admin). Temp password is
    // returned once for out-of-band hand-off; the admin resets it on first login.
    let admin = null;
    let tempPassword = null;
    if (data.admin) {
      // Use the typed temp password if the super admin set one; otherwise auto-generate a
      // ~12-char one (base64url satisfies passwordSchema — no whitespace/control chars).
      tempPassword = data.admin.password || randomBytes(9).toString('base64url');
      const { user } = await createOrgMember({
        orgId: org._id,
        addedBy: req.user._id,
        data: { ...data.admin, password: tempPassword },
        role: 'admin',
        mustChangePassword: true,
        billingAccess: true,
      });
      admin = { id: String(user._id), email: user.email, firstName: user.firstName, lastName: user.lastName };
    }

    res.status(201).json({ organization: org, admin, tempPassword });
  } catch (err) {
    if (err instanceof MemberError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.code === 11000) return res.status(409).json({ error: 'Slug already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

router.patch('/:orgId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid orgId' });
    }
    const data = updateSchema.parse(req.body);
    const update = {};
    if (data.name !== undefined) update.name = data.name.trim();
    if (data.slug !== undefined) update.slug = data.slug.toLowerCase().trim();
    if (data.isActive !== undefined) update.isActive = data.isActive;
    const org = await Organization.findByIdAndUpdate(req.params.orgId, update, { new: true });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: org });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Slug already exists' });
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
    next(err);
  }
});

// HARD delete — irreversible cascade across every org-scoped collection (plus
// cross-org Person hygiene; see services/platform/deleteOrganization.js). The
// caller must type the org's slug back: a mismatched confirmSlug is a 400, so
// no single stray click can destroy an org.
// Break-glass only: this destroys a customer's entire account, irreversibly.
router.delete('/:orgId', requireBreakGlass, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.orgId)) {
      return res.status(400).json({ error: 'Invalid orgId' });
    }
    const org = await Organization.findById(req.params.orgId, { slug: 1, name: 1 }).lean();
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const confirmSlug = String(req.body?.confirmSlug || '').trim().toLowerCase();
    if (confirmSlug !== org.slug) {
      return res.status(400).json({
        error: `Type the org's slug (${org.slug}) to confirm deletion.`,
        code: 'confirm-slug-mismatch',
      });
    }
    const summary = await deleteOrganization(org._id);
    console.warn(
      `[org-delete] ${req.user.email || req.user._id} deleted org '${summary.organization.name}' (${summary.organization.slug})`,
      summary.counts
    );
    res.json(summary);
  } catch (err) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

export default router;
