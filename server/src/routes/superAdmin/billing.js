import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireSuperAdmin } from '../../middleware/auth.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { Statement } from '../../models/Statement.js';
import { Subscription } from '../../models/Subscription.js';
import { SubscriptionEvent } from '../../models/SubscriptionEvent.js';
import { entitlementFor } from '../../services/billing/entitlement.js';
import { resolveRateCents } from '../../services/billing/rate.js';
import { statementDrift } from '../../services/billing/statementDrift.js';
import {
  BILLING_HISTORY_MAX_MONTHS,
  currentMonth,
  monthlyStatement,
  monthlyStatementRange,
} from '../../services/billing/statement.js';
import { ISSUE_STATUS_BY_CODE, issueStatementForMonth } from '../../services/billing/issueStatement.js';
import { addMonths as addMonthsSafe } from '../../services/billing/billingMonths.js';

// The account-manager surface: /super-admin/organizations/:orgId/billing.
// Super-admin only — org admins get the read-mostly /admin/billing instead.
const router = Router({ mergeParams: true });
router.use(requireAuth, requireSuperAdmin);

const BILLING_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'canceled', 'internal'];

const patchSchema = z.object({
  pricePerCampaignCents: z.number().int().min(0).max(10_000_000).optional(),
  billingContact: z
    .object({ name: z.string().max(200).optional(), email: z.string().max(200).optional() })
    .optional(),
  notes: z.string().max(5000).optional(),
});

const statusSchema = z.object({
  to: z.enum(BILLING_STATUSES),
  reason: z.string().max(2000).optional(),
});

const extendSchema = z.object({
  days: z.number().int().min(1).max(90).optional(),
  until: z.string().datetime().optional(),
});

// Load org + its subscription, creating a default record for orgs that predate
// the billing migration (status 'active' — identical to entitlementFor(null)'s
// fail-open resolution, so materializing it changes nothing about access).
async function loadOrgSub(req, res) {
  const { orgId } = req.params;
  if (!mongoose.isValidObjectId(orgId)) {
    res.status(400).json({ error: 'Invalid organization id' });
    return null;
  }
  const org = await Organization.findById(orgId).lean();
  if (!org) {
    res.status(404).json({ error: 'Organization not found' });
    return null;
  }
  let sub = await Subscription.findOne({ organizationId: org._id });
  if (!sub) {
    // An internal org's missing sub backfills as 'internal' — the status must follow the
    // born-immutable flag, or the coupling guard below would wedge the org on 'active'.
    const status = org.isInternal ? 'internal' : 'active';
    sub = await Subscription.create({
      organizationId: org._id,
      status,
      statusChangedAt: new Date(),
    });
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      toStatus: status,
      reason: 'Backfilled — org predates billing',
    });
  }
  return { org, sub };
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    // History is paged (eventsSkip/eventsLimit + exact eventsTotal) so a busy org's older audit
    // events stay reachable; the parameterless call keeps the original newest-50 shape.
    const eventsLimit = Math.min(Math.max(Number(req.query.eventsLimit) || 50, 1), 200);
    const eventsSkip = Math.max(Number(req.query.eventsSkip) || 0, 0);
    const [eventsTotal, events] = await Promise.all([
      SubscriptionEvent.countDocuments({ organizationId: org._id }),
      SubscriptionEvent.find({ organizationId: org._id })
        .sort({ createdAt: -1 })
        .skip(eventsSkip)
        .limit(eventsLimit)
        .populate('byUserId', 'firstName lastName')
        .lean(),
    ]);
    res.json({
      organization: { id: String(org._id), name: org.name, slug: org.slug, isActive: org.isActive, isInternal: !!org.isInternal },
      subscription: sub.toObject(),
      entitlement: entitlementFor(sub),
      events,
      eventsTotal,
    });
  } catch (err) {
    next(err);
  }
});

// Rate / contact / notes edits. Status moves through POST /status only, so every
// transition is forced through the reason + statusChangedAt bookkeeping.
router.patch('/', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = patchSchema.parse(req.body);
    const changes = {};
    if (data.pricePerCampaignCents !== undefined && data.pricePerCampaignCents !== sub.pricePerCampaignCents) {
      changes.pricePerCampaignCents = { from: sub.pricePerCampaignCents, to: data.pricePerCampaignCents };
      sub.pricePerCampaignCents = data.pricePerCampaignCents;
    }
    if (data.billingContact !== undefined) {
      const next_ = {
        name: data.billingContact.name ?? sub.billingContact?.name ?? '',
        email: data.billingContact.email ?? sub.billingContact?.email ?? '',
      };
      if (next_.name !== (sub.billingContact?.name || '') || next_.email !== (sub.billingContact?.email || '')) {
        changes.billingContact = { from: sub.billingContact, to: next_ };
        sub.billingContact = next_;
      }
    }
    if (data.notes !== undefined && data.notes !== sub.notes) {
      changes.notes = { updated: true }; // don't duplicate free text into the log
      sub.notes = data.notes;
    }
    if (Object.keys(changes).length) {
      await sub.save();
      await SubscriptionEvent.create({
        organizationId: org._id,
        byUserId: req.user._id,
        changes,
      });
    }
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// The status chokepoint. Any → any (the account manager is trusted); suspend and
// cancel REQUIRE a reason — future-you reads the History to learn why. A manual
// transition also reclaims `source` so a later Stripe webhook can't override it.
router.post('/status', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = statusSchema.parse(req.body);
    // 'internal' billing status is COUPLED to the born-immutable Organization.isInternal flag,
    // both ways. Without the flag, 'internal' is unreachable — closing the hole where any
    // support-tier staffer could silently zero out a customer's billing (and exempt them from
    // the retention sweeps). With the flag, the status can never leave 'internal' — an internal
    // org is permanently non-billable. Ordering: the flag check runs BEFORE the same-status
    // check so a flagged org whose sub drifted can be healed with to:'internal'.
    if (data.to === 'internal' && !org.isInternal) {
      return res.status(403).json({
        error: "Only an organization created as internal can hold 'internal' billing status.",
        code: 'INTERNAL_FLAG_REQUIRED',
      });
    }
    if (org.isInternal && data.to !== 'internal') {
      return res.status(403).json({
        error: 'An internal organization is permanently non-billable; its status cannot leave internal.',
        code: 'INTERNAL_LOCKED',
      });
    }
    if (data.to === sub.status) {
      return res.status(400).json({ error: `Already ${sub.status}.` });
    }
    if (['suspended', 'canceled'].includes(data.to) && !data.reason?.trim()) {
      return res.status(400).json({ error: 'A reason is required to suspend or cancel.' });
    }
    const from = sub.status;
    sub.status = data.to;
    sub.statusChangedAt = new Date();
    sub.source = 'manual';
    // ANY status change voids outstanding deletion warnings — BOTH kinds. The wind-down clock
    // re-anchors on statusChangedAt, so its warning is stale by construction; and a dormancy
    // warning sent while the org was canceled must not survive a comped reactivation, or a
    // later re-cancellation would purge on the strength of a warning emailed to a then-paying
    // customer. Any FUTURE status writer (e.g. a Stripe webhook) must route through this
    // chokepoint or replicate these clears.
    sub.windDownWarnedAt = null;
    sub.windDownDeleteNotBefore = null;
    if (data.to === 'trial' && !sub.trialEndsAt) {
      sub.trialEndsAt = new Date(Date.now() + 7 * 86400000);
    }
    await sub.save();
    await Organization.updateOne(
      { _id: org._id },
      { $set: { dormancyWarnedAt: null, dormancyDeleteNotBefore: null } }
    );
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      fromStatus: from,
      toStatus: data.to,
      reason: data.reason?.trim() || '',
    });
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// Extend (or revive) a trial: +N days from whichever is later (now vs current
// end), or an explicit date. Only meaningful while status is 'trial' — an
// expired trial is still status 'trial' (suspension is computed), so extending
// it un-suspends the org with no separate reactivation step.
router.post('/extend-trial', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    if (sub.status !== 'trial') {
      return res.status(400).json({ error: 'Only a trialing org can have its trial extended.' });
    }
    const data = extendSchema.parse(req.body);
    const from = sub.trialEndsAt;
    if (data.until) {
      sub.trialEndsAt = new Date(data.until);
    } else {
      const days = data.days ?? 7;
      const base = Math.max(Date.now(), sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0);
      sub.trialEndsAt = new Date(base + days * 86400000);
    }
    await sub.save();
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      changes: { trialEndsAt: { from, to: sub.trialEndsAt } },
      reason: 'Trial extended',
    });
    res.json({ subscription: sub.toObject(), entitlement: entitlementFor(sub) });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// ── Per-campaign rates ────────────────────────────────────────────────────────────────────────
// The negotiated price for ONE race, so a firm running a governor's race and a school-board race
// can be billed differently inside a single org. Lives here, behind requireSuperAdmin, and
// deliberately NOT on routes/admin/campaigns.js — org admins and team leads reach that router and
// would be able to read (and set) their own price. `Campaign.pricePerCampaignCents` is
// `select: false` so it can't leak through the campaign routes' lean-doc spreads either.

const campaignRateSchema = z.object({
  // .nullable() is the whole point: null restores "inherit the org rate", which a plain number
  // makes unexpressible from the UI. Same tri-state discipline as billRestrictedDoors.
  pricePerCampaignCents: z.number().int().min(0).max(10_000_000).nullable(),
});

router.get('/campaigns', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const campaigns = await Campaign.find(
      { organizationId: org._id },
      { name: 1, isActive: 1, archivedAt: 1 }
    )
      .select('+pricePerCampaignCents')
      .sort({ isActive: -1, createdAt: -1 })
      .lean();
    res.json({
      orgRateCents: resolveRateCents(null, sub),
      campaigns: campaigns.map((c) => ({
        campaignId: String(c._id),
        name: c.name,
        isActive: c.isActive,
        archivedAt: c.archivedAt ?? null,
        pricePerCampaignCents: c.pricePerCampaignCents ?? null, // null = inherits
        effectiveRateCents: resolveRateCents(c, sub),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/campaigns/:campaignId', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const { campaignId } = req.params;
    if (!mongoose.isValidObjectId(campaignId)) {
      return res.status(400).json({ error: 'Invalid campaign id' });
    }
    const data = campaignRateSchema.parse(req.body);
    // Org-scoped, never findById: an unscoped lookup would let a foreign campaignId be repriced
    // through this org's URL (same rule as services/reports/billRestricted.js).
    const campaign = await Campaign.findOne({ _id: campaignId, organizationId: org._id }).select(
      '+pricePerCampaignCents'
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const from = campaign.pricePerCampaignCents ?? null;
    const to = data.pricePerCampaignCents;
    if (from !== to) {
      campaign.pricePerCampaignCents = to;
      await campaign.save();
      await SubscriptionEvent.create({
        organizationId: org._id,
        byUserId: req.user._id,
        changes: { campaignRate: { campaignId: String(campaign._id), campaignName: campaign.name, from, to } },
        reason: to === null ? 'Per-campaign rate cleared' : 'Per-campaign rate set',
      });
    }
    res.json({
      campaignId: String(campaign._id),
      name: campaign.name,
      pricePerCampaignCents: to,
      effectiveRateCents: resolveRateCents({ pricePerCampaignCents: to }, sub),
    });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// The live statement for a month, PLUS the frozen one if it's been issued, plus the diff between
// them. The live result is spread at the top level so every existing consumer keeps working.
router.get('/statement', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org } = loaded;
    const live = await monthlyStatement(org._id, req.query.month);
    const issued = await Statement.findOne({
      organizationId: org._id,
      month: req.query.month,
      status: 'issued',
    })
      .populate('issuedByUserId', 'firstName lastName')
      .lean();
    res.json({ ...live, statement: issued || null, drift: statementDrift(issued, live) });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// EVERY month in a range, in one request — the invoicing view. Frozen months read from their
// issued Statement (that is the number that was sent); un-issued months are the live recompute; an
// issued month that no longer agrees with a recompute carries its `drift` so a two-months-late
// invoice can't be built on a figure the system has quietly moved past.
//
// One monthlyStatementRange() call underneath, so this costs three queries per campaign no matter
// how long the range — see the note on that function.
router.get('/history', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org } = loaded;
    const to = String(req.query.to || currentMonth());
    const from = String(req.query.from || addMonthsSafe(to, -11)); // default: the last 12 months
    const range = await monthlyStatementRange(org._id, { from, to });
    const months = range.statements.map((s) => s.month);

    const issued = await Statement.find({
      organizationId: org._id,
      month: { $in: months },
      status: 'issued',
    })
      .populate('issuedByUserId', 'firstName lastName')
      .lean();
    const byMonth = new Map(issued.map((i) => [i.month, i]));

    res.json({
      from: range.from,
      to: range.to,
      rateCents: range.rateCents,
      rulesVersion: range.rulesVersion,
      // Newest first — a ledger is read from the present backwards.
      months: range.statements
        .map((live) => {
          const frozen = byMonth.get(live.month) || null;
          return {
            month: live.month,
            // What this month IS on an invoice: the frozen total when issued, else the live one.
            totalCents: frozen ? frozen.totalCents : live.totalCents,
            liveTotalCents: live.totalCents,
            billableCampaigns: (frozen || live).lines.filter((l) => l.billable).length,
            issued: Boolean(frozen),
            statementId: frozen ? String(frozen._id) : null,
            issuedAt: frozen?.issuedAt ?? null,
            issuedBy: frozen?.issuedByUserId
              ? `${frozen.issuedByUserId.firstName || ''} ${frozen.issuedByUserId.lastName || ''}`.trim()
              : null,
            externalRef: frozen?.externalRef || null,
            rulesVersion: frozen?.rulesVersion ?? live.rulesVersion,
            drift: statementDrift(frozen, live),
            // The lines that were (or would be) invoiced, so a combined export never has to go back
            // for them month by month.
            lines: (frozen || live).lines,
          };
        })
        .reverse(),
    });
  } catch (err) {
    if (err?.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── Issuing ───────────────────────────────────────────────────────────────────────────────────
// Freeze a month. From here on that month reads from the frozen row, not from a recompute, and any
// later divergence surfaces as drift rather than silently rewriting what you invoiced.

const issueSchema = z.object({
  externalRef: z.string().trim().max(200).optional(),
  force: z.boolean().optional(),
});

router.post('/statement/:month/issue', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = issueSchema.parse(req.body || {});
    const result = await issueStatementForMonth({
      org,
      sub,
      month: req.params.month,
      userId: req.user._id,
      externalRef: data.externalRef,
      force: data.force,
    });
    if (!result.ok) {
      const body = { error: result.error, code: result.code };
      if (result.statementId) body.statementId = result.statementId;
      return res.status(ISSUE_STATUS_BY_CODE[result.code] || 400).json(body);
    }
    res.status(201).json({ statement: result.statement.toObject() });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// ── Issuing SEVERAL months at once ────────────────────────────────────────────────────────────
// Invoicing a client for July AND August is one job, and doing it as two visits to a month picker
// is how the second month gets forgotten. Each month is still its own Statement, its own race
// guard and its own audit event — this only removes the clicking.
//
// Answers 200 with a per-month outcome list rather than failing the request: a batch where August
// is already issued must still issue July, and the account manager needs to see which did what.
// `ok` is true only when every month issued.
const issueManySchema = z.object({
  months: z.array(z.string()).min(1).max(BILLING_HISTORY_MAX_MONTHS),
  externalRef: z.string().trim().max(200).optional(),
  force: z.boolean().optional(),
});

router.post('/statements/issue', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org, sub } = loaded;
    const data = issueManySchema.parse(req.body || {});
    // Oldest first, and de-duplicated: the audit should read in calendar order, and a repeated
    // month in the payload must not produce a spurious ALREADY_ISSUED against our own write.
    const months = [...new Set(data.months)].sort();
    const results = [];
    for (const month of months) {
      // Serial on purpose — concurrent issues for one org would race each other through the very
      // guard this loop is meant to make unnecessary.
      const r = await issueStatementForMonth({
        org,
        sub,
        month,
        userId: req.user._id,
        externalRef: data.externalRef,
        force: data.force,
      });
      results.push(
        r.ok
          ? { month, ok: true, statementId: String(r.statement._id), totalCents: r.statement.totalCents }
          : { month, ok: false, code: r.code, error: r.error, statementId: r.statementId || null }
      );
    }
    res.json({
      ok: results.every((r) => r.ok),
      issuedCount: results.filter((r) => r.ok).length,
      totalCents: results.filter((r) => r.ok).reduce((sum, r) => sum + r.totalCents, 0),
      results,
    });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

const voidSchema = z.object({ reason: z.string().trim().min(1).max(2000) });

// Void an issued statement. Never an edit — the row survives so the history of what was invoiced,
// and what replaced it, stays readable. A reason is required for the same purpose it is on suspend
// and cancel: future-you reads it to learn why.
router.post('/statement/:statementId/void', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org } = loaded;
    const { statementId } = req.params;
    if (!mongoose.isValidObjectId(statementId)) {
      return res.status(400).json({ error: 'Invalid statement id' });
    }
    const data = voidSchema.parse(req.body || {});
    // Atomic claim. The organizationId in the FILTER is what stops a cross-org void; the
    // status:'issued' is what makes a double-void a clean 409 instead of a silent second write.
    const statement = await Statement.findOneAndUpdate(
      { _id: statementId, organizationId: org._id, status: 'issued' },
      {
        $set: {
          status: 'void',
          voidedAt: new Date(),
          voidedByUserId: req.user._id,
          voidReason: data.reason,
        },
      },
      { new: true }
    );
    if (!statement) {
      return res.status(409).json({
        error: 'That statement is not issued — it may already be void, or belong to another organization.',
        code: 'NOT_ISSUED',
      });
    }
    await SubscriptionEvent.create({
      organizationId: org._id,
      byUserId: req.user._id,
      changes: {
        statementVoided: {
          month: statement.month,
          totalCents: statement.totalCents,
          statementId: String(statement._id),
        },
      },
      reason: data.reason,
    });
    res.json({ statement: statement.toObject() });
  } catch (err) {
    if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input' });
    next(err);
  }
});

// Every statement ever issued or voided for this org, newest first — the paper trail.
router.get('/statements', async (req, res, next) => {
  try {
    const loaded = await loadOrgSub(req, res);
    if (!loaded) return;
    const { org } = loaded;
    const statements = await Statement.find(
      { organizationId: org._id },
      { lines: 0 } // the list doesn't need every campaign line
    )
      .sort({ month: -1, issuedAt: -1 })
      .populate('issuedByUserId', 'firstName lastName')
      .populate('voidedByUserId', 'firstName lastName')
      .limit(200)
      .lean();
    res.json({ statements });
  } catch (err) {
    next(err);
  }
});

export default router;
