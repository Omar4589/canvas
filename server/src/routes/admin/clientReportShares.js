import { Router } from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireOrgRole } from '../../middleware/auth.js';
import { orgContext } from '../../middleware/orgContext.js';
import { canManageCampaign } from '../../services/authz/campaignManagement.js';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { ClientReport } from '../../models/ClientReport.js';
import { Campaign } from '../../models/Campaign.js';
import { NOT_DELETING } from '../../services/campaigns/deletionState.js';
import { writeLinkHistory, LINK_FIELDS } from '../../services/reports/clientReportHistory.js';
import { currentSeriesLabels } from '../../services/reports/clientReportRead.js';
import { scopeOf } from '../../services/reports/reportVisibility.js';
import {
  DAY_MS,
  SHARE_DEFAULT_DAYS,
  SHARE_MAX_DAYS,
  SHARE_PASSWORD_MIN,
  CLEARED_BUDGET,
  CLEARED_FOR_NEW_ADDRESS,
  newShareToken,
  generateSharePassword,
  shareRow,
  isExpired,
  lockOf,
  failuresOf,
  plusOne,
} from '../../services/reports/shareLinks.js';

// Client links — the Client Reports tab's link panel (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 as
// overridden by §O7, G7). Public, revocable per-campaign links to the campaign's published reports —
// all of them, or just one (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D) — (routes/public/share.js).
// Mounted at /admin/client-reports/shares AHEAD of the client-reports router
// (routes/index.js), so its `/:id` routes never see `:id = "shares"`.
//
// What every write here keeps true:
//   · A password is 12+ characters when the operator sets it, and is never removed (the policy says
//     report links "are protected by a password").
//   · Every credential change — a password change (a legacy open link's FIRST password included),
//     rotate, renew, disable — bumps credentialVersion in the same atomic write, which signs out every
//     device holding a share token.
//   · A link lives at most a year from when it was made (lifetimeStart); Extend never shortens it and
//     an EXPIRED link is renewed, never extended: a new address, so a URL forwarded long ago stays dead.
//   · Every write is one atomic update (pipelines where a counter can be null), never a whole-document
//     save, so a guess reserving a slot in the failure budget at the same moment is never lost.
//   · History rows for every link change, never holding the URL token, a password or its hash.
const router = Router();
// Leads may manage links on the campaigns they manage (owner ruling 10-23: full control, as today);
// each handler authorizes the specific campaign. Only revoke-legacy is admin-only (it is org-wide).
router.use(requireAuth, orgContext, requireOrgRole('admin', 'lead'));

const activeOrgId = (req) => req.activeOrg?._id;
const ensureOrgScoped = (req, res) => {
  if (activeOrgId(req)) return true;
  res.status(400).json({ error: 'Active organization required (X-Org-Id header)' });
  return false;
};
// True if the requester may manage `campaignId`; otherwise writes 403 and returns false.
const manages = async (req, res, campaignId) => {
  if (await canManageCampaign(req, campaignId)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
};
const zodFail = (res, next) => (err) => {
  if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid input', issues: err.issues });
  return next(err);
};

const TOO_SHORT = {
  error: `A link password needs at least ${SHARE_PASSWORD_MIN} characters.`,
  code: 'SHARE_PASSWORD_TOO_SHORT',
};

const days = z.number().int().min(1).max(SHARE_MAX_DAYS);
const shareCreateSchema = z.object({
  campaignId: z.string(),
  label: z.string().max(120).optional(),
  // Still optional in the API — the route GENERATES one when it's absent, never an open link.
  password: z.string().max(200).optional(),
  // The picker offers 30, 90, 180 or 365 days (default 90).
  expiresInDays: days.optional(),
  // A link to just this report (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D); absent or null = every
  // published report of the campaign. Set here, never changed.
  reportId: z.string().nullable().optional(),
});
const shareUpdateSchema = z.object({
  label: z.string().max(120).optional(),
  // A string sets or replaces the password; omitted = unchanged. REMOVAL IS NOT SUPPORTED: a link
  // that can be quietly un-passworded after creation would falsify the policy's sentence. Null is
  // still accepted by the schema so the guard below returns a specific error, not a generic 400.
  password: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
});
const extendSchema = z.object({ expiresInDays: days });
const renewSchema = z.object({ expiresInDays: days.optional() });

const lit = (v) => ({ $literal: v });
const labelOnly = (link) => ({ label: link.label || '' });

// The link, lean, in the active org and on a campaign the requester manages — or a response sent.
const loadShareInOrg = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  const share = await ReportShareLink.findOne({ _id: req.params.id, organizationId: activeOrgId(req) }).lean();
  if (!share) {
    res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    return null;
  }
  if (!(await manages(req, res, share.campaignId))) return null;
  return share;
};

const fresh = (id) => ReportShareLink.findById(id).lean();

// What each link opens (docs/PROPOSAL_CLIENT_REPORTS_SIMPLIFY.md §D, contract K6): every row adds
// `reportId` — null on a link to all the campaign's reports, a link from before the field included —
// and `report`, that one report's dates and its tab's name as the tabs read now. `report: null` beside a
// reportId is a report deleted mid-race (DELETE /admin/client-reports/:id takes its links with it).
const rowsOf = async (req, links, now = new Date()) => {
  const ids = [...new Set(links.filter((l) => l.reportId).map((l) => String(l.reportId)))];
  const reports = ids.length
    ? await ClientReport.find(
        { _id: { $in: ids }, organizationId: activeOrgId(req) },
        { weekStart: 1, weekEnd: 1, seriesId: 1, scope: 1, effortId: 1, effortName: 1, takenDownAt: 1 }
      ).lean()
    : [];
  const labels = await currentSeriesLabels(reports);
  const byId = new Map(reports.map((r) => [String(r._id), r]));
  return links.map((l) => {
    const r = l.reportId ? byId.get(String(l.reportId)) : null;
    return {
      ...shareRow(l, now),
      reportId: l.reportId ? String(l.reportId) : null,
      // takenDown: the links panel says the link reads "taken down" until the report is put back up —
      // Share isn't offered on a taken-down report, so the panel is where the operator would look.
      report: r
        ? {
            id: String(r._id),
            weekStart: r.weekStart,
            weekEnd: r.weekEnd,
            scopeLabel: (r.seriesId && labels.get(String(r.seriesId))) || scopeOf(r).label,
            takenDown: !!r.takenDownAt,
          }
        : null,
    };
  });
};
const rowOf = async (req, link, now) => (await rowsOf(req, [link], now))[0];

// A link to one report needs a report the client can see now (§D): a draft has nothing to show yet,
// and a taken-down report — still status 'published' — would only ever say "taken down".
const NOT_SHOWN = (report) => ({
  error: report.takenDownAt
    ? 'This report is taken down. Put it back up, then make its link.'
    : 'This report isn’t published yet. Publish it, then make its link.',
  code: 'REPORT_NOT_SHOWN',
  status: report.status,
  takenDown: !!report.takenDownAt,
});
const REPORT_NOT_FOUND = { error: 'Report not found', code: 'REPORT_NOT_FOUND' };

router.get('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    if (!req.query.campaignId || !mongoose.isValidObjectId(req.query.campaignId)) {
      return res.status(400).json({ error: 'campaignId required' });
    }
    if (!(await manages(req, res, req.query.campaignId))) return;
    const shares = await ReportShareLink.find({ organizationId: activeOrgId(req), campaignId: req.query.campaignId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ shares: await rowsOf(req, shares) });
  } catch (err) {
    next(err);
  }
});

// A new link: always a password and an expiry. When the operator sets no password the server mints
// one and returns it ONCE, in the clear — it is bcrypt-hashed at rest and can never be shown again.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const data = shareCreateSchema.parse(req.body);
    if (data.password !== undefined && data.password.length < SHARE_PASSWORD_MIN) return res.status(400).json(TOO_SHORT);
    if (!mongoose.isValidObjectId(data.campaignId)) return res.status(404).json({ error: 'Campaign not found in this org' });
    // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    const campaign = await Campaign.findOne({ _id: data.campaignId, organizationId: orgId, ...NOT_DELETING }, { _id: 1 }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    // A link to just this report (§D): a report of this campaign that the client can see now.
    let report = null;
    if (data.reportId != null) {
      if (!mongoose.isValidObjectId(data.reportId)) return res.status(400).json({ error: 'Invalid reportId' });
      report = await ClientReport.findOne({ _id: data.reportId, organizationId: orgId, campaignId: campaign._id }, { status: 1, takenDownAt: 1 }).lean();
      if (!report) return res.status(404).json(REPORT_NOT_FOUND);
      if (report.status !== 'published' || report.takenDownAt) return res.status(409).json(NOT_SHOWN(report));
    }
    const generated = data.password ? null : generateSharePassword();
    const now = new Date();
    const created = await ReportShareLink.create({
      organizationId: orgId,
      campaignId: campaign._id,
      token: newShareToken(),
      label: data.label || '',
      passwordHash: await bcrypt.hash(data.password || generated, 10),
      expiresAt: new Date(now.getTime() + (data.expiresInDays || SHARE_DEFAULT_DAYS) * DAY_MS),
      lifetimeStartAt: now,
      credentialVersion: 0,
      passwordMeetsRule: true,
      failedUnlockAt: [],
      failedUnlocksTotal: 0,
      failedByDay: [],
      reportId: report ? report._id : null,
      createdBy: req.user._id,
    });
    const share = created.toObject();
    await writeLinkHistory(share, LINK_FIELDS.created, { by: req.user._id, toValue: { ...labelOnly(share), expiresAt: share.expiresAt } }).catch(() => {});
    // Its report deleted while the link was being made: the delete took the report's links before this
    // one existed, so this one goes the same way, and says so — never left behind opening nothing.
    if (report && !(await ClientReport.exists({ _id: report._id }))) {
      const r = await ReportShareLink.deleteOne({ _id: share._id, organizationId: orgId });
      if (r.deletedCount) await writeLinkHistory(share, LINK_FIELDS.deleted, { by: req.user._id, toValue: { ...labelOnly(share), reportDeleted: true } }).catch(() => {});
      return res.status(404).json(REPORT_NOT_FOUND);
    }
    res.status(201).json({
      share: await rowOf(req, share, now),
      // Present only when WE generated it. Show it to the operator once, then it's gone.
      ...(generated ? { generatedPassword: generated } : {}),
    });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Kill every pre-existing OPEN link — no password, or no expiry — in one action.
//
// Deliberately NOT automatic. Auto-expiring links created before the rules changed would take a
// client's live report offline with no warning, under their feet, from a deploy they didn't know
// about. So legacy links keep working and are flagged `isLegacyOpen`; this is the operator's switch
// to kill them once they've told their customers. The decision of WHEN is a business one — an
// ORG-level one, so unlike every campaign-scoped share route, this is admin-only: it sweeps links
// across all campaigns, which a campaign-scoped lead must not reach. Disabling is a credential
// change like any other, so the swept links' versions move too.
router.post('/revoke-legacy', requireOrgRole('admin'), async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const filter = {
      organizationId: orgId,
      isActive: true,
      $or: [{ passwordHash: null }, { expiresAt: null }],
    };
    const doomed = await ReportShareLink.find(filter, 'label campaignId organizationId').lean();

    // Dry run unless explicitly confirmed — you should be able to see what you're about to break.
    if (req.body?.confirm !== true) {
      return res.json({
        dryRun: true,
        wouldRevoke: doomed.length,
        links: doomed.map((s) => ({ id: String(s._id), label: s.label, campaignId: String(s.campaignId) })),
      });
    }

    const r = await ReportShareLink.updateMany(filter, [{ $set: { isActive: false, credentialVersion: plusOne('credentialVersion') } }]);
    for (const s of doomed) {
      await writeLinkHistory(s, LINK_FIELDS.disabled, { by: req.user._id, toValue: { ...labelOnly(s), legacySweep: true } }).catch(() => {});
    }
    res.json({ revoked: r.modifiedCount || 0 });
  } catch (err) {
    next(err);
  }
});

// Label, password, enable/disable. A password change (or a first password on a legacy open link) and
// a disable bump the credential version; a legacy link gaining a password also gains an expiry and a
// lifetime, so it leaves isLegacyOpen and the revoke sweep (C2).
router.patch('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const data = shareUpdateSchema.parse(req.body);
    if (data.password !== undefined) {
      if (!data.password) {
        return res.status(400).json({
          error: 'A password cannot be removed from a link — replace it, or rotate the link.',
          code: 'SHARE_PASSWORD_REQUIRED',
        });
      }
      if (data.password.length < SHARE_PASSWORD_MIN) return res.status(400).json(TOO_SHORT);
    }
    const now = new Date();
    const set = {};
    if (data.label !== undefined) set.label = lit(data.label);
    let bump = false;
    if (data.password) {
      set.passwordHash = lit(await bcrypt.hash(data.password, 10));
      set.passwordMeetsRule = true;
      // A link without an expiry (a legacy one) gains the default life with its password, starting now.
      set.expiresAt = { $ifNull: ['$expiresAt', lit(new Date(now.getTime() + SHARE_DEFAULT_DAYS * DAY_MS))] };
      set.lifetimeStartAt = { $cond: [{ $eq: [{ $ifNull: ['$expiresAt', null] }, null] }, lit(now), '$lifetimeStartAt'] };
      bump = true;
    }
    if (data.isActive !== undefined) {
      set.isActive = data.isActive;
      if (data.isActive === false) bump = true;
    }
    if (bump) set.credentialVersion = plusOne('credentialVersion');
    if (!Object.keys(set).length) return res.json({ share: await rowOf(req, share, now) });
    const pre = await ReportShareLink.findOneAndUpdate({ _id: share._id, organizationId: activeOrgId(req) }, [{ $set: set }], {
      returnDocument: 'before',
    }).lean();
    if (!pre) return res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    const by = req.user._id;
    if (data.password) {
      await writeLinkHistory(pre, LINK_FIELDS.passwordChanged, {
        by,
        toValue: { ...labelOnly(pre), wasOpenLink: !pre.passwordHash, ...(pre.expiresAt ? {} : { expiryAdded: true }) },
      }).catch(() => {});
    }
    if (data.isActive !== undefined && data.isActive !== (pre.isActive === true)) {
      await writeLinkHistory(pre, data.isActive ? LINK_FIELDS.enabled : LINK_FIELDS.disabled, { by, toValue: labelOnly(pre) }).catch(() => {});
    }
    res.json({ share: await rowOf(req, await fresh(share._id), now) });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Extend: expiresAt = max(current, now + days), capped at a year from lifetimeStart — so it NEVER
// shortens a link, and never takes it past its one-year life. A legacy link that never expires is
// given its first expiry here ("Set an expiry"), its life starting now. An expired link is renewed,
// not extended (409 SHARE_NEEDS_RENEW): extending it would bring a long-dead address back to life.
router.post('/:id/extend', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const { expiresInDays } = extendSchema.parse(req.body || {});
    const now = new Date();
    if (isExpired(share, now)) {
      return res.status(409).json({ error: 'This link has expired. Renew it to give it a new address.', code: 'SHARE_NEEDS_RENEW' });
    }
    const orgId = activeOrgId(req);
    const target = new Date(now.getTime() + expiresInDays * DAY_MS);
    let pre;
    if (!share.expiresAt) {
      pre = await ReportShareLink.findOneAndUpdate(
        { _id: share._id, organizationId: orgId, expiresAt: null },
        { $set: { expiresAt: target, lifetimeStartAt: now } },
        { returnDocument: 'before' }
      ).lean();
    } else {
      // Compared in the write, so two Extends (or an Extend racing a Renew) never shorten each other.
      const start = { $ifNull: ['$lifetimeStartAt', { $ifNull: ['$createdAt', { $toDate: '$_id' }] }] };
      const cap = { $add: [start, SHARE_MAX_DAYS * DAY_MS] };
      pre = await ReportShareLink.findOneAndUpdate(
        { _id: share._id, organizationId: orgId, expiresAt: { $gt: now } },
        [{ $set: { expiresAt: { $max: ['$expiresAt', { $min: [lit(target), cap] }] } } }],
        { returnDocument: 'before' }
      ).lean();
    }
    if (!pre) return res.status(409).json({ error: 'This link just changed. Look again, then extend it.', code: 'SHARE_CHANGED' });
    const after = await fresh(share._id);
    if (String(after.expiresAt) !== String(pre.expiresAt)) {
      await writeLinkHistory(after, LINK_FIELDS.extended, {
        by: req.user._id,
        fromValue: { expiresAt: pre.expiresAt || null },
        toValue: { ...labelOnly(after), expiresAt: after.expiresAt },
      }).catch(() => {});
    }
    res.json({ share: await rowOf(req, after, now) });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Renew (expired links only): rotated — a NEW address, a new one-year life, expiresAt = now + the
// chosen days, the credential version bumped, the failure budget cleared, the password kept. The URL
// the client had stays dead, and so does every copy of it ever forwarded; send the new one.
router.post('/:id/renew', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const data = renewSchema.parse(req.body || {});
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (data.expiresInDays || SHARE_DEFAULT_DAYS) * DAY_MS);
    // $lte never matches a missing or null expiresAt: a link that never expires is not expired.
    const pre = await ReportShareLink.findOneAndUpdate(
      { _id: share._id, organizationId: activeOrgId(req), expiresAt: { $lte: now } },
      [
        {
          $set: {
            token: lit(newShareToken()),
            lifetimeStartAt: lit(now),
            expiresAt: lit(expiresAt),
            credentialVersion: plusOne('credentialVersion'),
            ...CLEARED_FOR_NEW_ADDRESS,
          },
        },
      ],
      { returnDocument: 'before' }
    ).lean();
    if (!pre) {
      return res.status(409).json({ error: 'Only an expired link is renewed. Extend this one instead.', code: 'SHARE_NOT_EXPIRED' });
    }
    const after = await fresh(share._id);
    await writeLinkHistory(after, LINK_FIELDS.renewed, {
      by: req.user._id,
      fromValue: { expiresAt: pre.expiresAt || null },
      toValue: { ...labelOnly(after), expiresAt: after.expiresAt },
    }).catch(() => {});
    res.json({ share: await rowOf(req, after, now) });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Rotate: a fresh URL that instantly kills the old one (use it if a link leaked), the credential
// version bumped, the failure budget and the week's counts cleared — they were about the old address.
// The password carries over; the expiry and the one-year life don't change.
router.post('/:id/rotate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const pre = await ReportShareLink.findOneAndUpdate(
      { _id: share._id, organizationId: activeOrgId(req) },
      [{ $set: { token: lit(newShareToken()), credentialVersion: plusOne('credentialVersion'), ...CLEARED_FOR_NEW_ADDRESS } }],
      { returnDocument: 'before' }
    ).lean();
    if (!pre) return res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    const after = await fresh(share._id);
    await writeLinkHistory(after, LINK_FIELDS.rotated, { by: req.user._id, toValue: labelOnly(after) }).catch(() => {});
    res.json({ share: await rowOf(req, after, new Date()) });
  } catch (err) {
    next(err);
  }
});

// Unlock now: clears the failure budget, so the right password works again at once. Devices already
// signed in never stopped working (a lock doesn't end sessions). Since 50 wrong passwords is never the
// client, the panel still advises a rotate for the rest of the week.
router.post('/:id/unlock', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const pre = await ReportShareLink.findOneAndUpdate(
      { _id: share._id, organizationId: activeOrgId(req) },
      [{ $set: { ...CLEARED_BUDGET } }],
      { returnDocument: 'before', timestamps: false }
    ).lean();
    if (!pre) return res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    const now = new Date();
    const cleared = failuresOf(pre, now).last24h;
    if (cleared) {
      await writeLinkHistory(pre, LINK_FIELDS.unlocked, {
        by: req.user._id,
        toValue: { ...labelOnly(pre), wasLocked: lockOf(pre, now).locked, cleared },
      }).catch(() => {});
    }
    res.json({ share: await rowOf(req, await fresh(share._id), now) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const r = await ReportShareLink.deleteOne({ _id: share._id, organizationId: activeOrgId(req) });
    if (r.deletedCount) await writeLinkHistory(share, LINK_FIELDS.deleted, { by: req.user._id, toValue: labelOnly(share) }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
