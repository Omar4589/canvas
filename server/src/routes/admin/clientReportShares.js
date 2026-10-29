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
import { isOneLinkGuardError } from '../../services/reports/clientReportIndexes.js';
import { isWellFormedText } from '../../utils/passwordText.js';
import { sealedSecretConfigured } from '../../utils/sealedSecret.js';
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
  allReportsRetired,
  isAllReportsLink,
  sealLinkPassword,
  readLinkPassword,
  sameLinkPassword,
  primaryLinkOf,
} from '../../services/reports/shareLinks.js';

// Client links — each report's link, managed from Share (docs/PROPOSAL_CLIENT_REPORT_LINKS.md, on top of
// docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 as overridden by §O7, G7). Public, revocable links to ONE
// published report each (routes/public/share.js); older links may open all of a campaign's reports, until
// RETIRE_ALL_REPORTS_LINKS turns them off. Mounted at /admin/client-reports/shares AHEAD of the
// client-reports router (routes/index.js), so its `/:id` routes never see `:id = "shares"`.
//
// What every write here keeps true:
//   · One link per report (§C2): a new link names its report, Share looks first, and the one-link guard
//     (models/ReportShareLink.js) catches two made at the same instant. A report that got two links before
//     this keeps both.
//   · A password is 12+ characters when the operator sets it, well-formed text before it reaches bcrypt
//     (utils/passwordText.js), and is never removed (the policy says report links "are protected by a
//     password").
//   · Every password write is bcrypt, then the seal (bound to that hash), then ONE atomic write of both
//     (§B) — the sealed copy is what lets the campaign's admins and leads see the password again (GET
//     /:id/password). Doorline staff under a support grant never see or type one (§C3).
//   · Every credential change — a password change (a legacy open link's FIRST password included),
//     rotate, renew, disable — bumps credentialVersion in the same atomic write, which signs out every
//     device holding a share token.
//   · A link lives at most a year from when it was made (lifetimeStart); Extend never shortens it and
//     an EXPIRED link is renewed, never extended: a new address, so a URL forwarded long ago stays dead.
//   · Every write is one atomic update (pipelines where a counter can be null), never a whole-document
//     save, so a guess reserving a slot in the failure budget at the same moment is never lost.
//   · A link to all your reports (§C1) can be deleted; until the switch, also given a new password or a
//     new address — the policy promises "a link's password can be changed, or the link rotated"; nothing
//     else (409 ALL_REPORTS_LINK).
//   · History rows for every link change, never holding the URL token, a password, its hash or its
//     sealed copy — and no response ever holds the hash or the sealed copy either.
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
// Never a lone surrogate to bcrypt — it takes the whole process down (utils/passwordText.js).
const NOT_TEXT = {
  error: 'That password has a character that can’t be used. Try another.',
  code: 'SHARE_PASSWORD_INVALID',
};
// docs/PROPOSAL_CLIENT_REPORT_LINKS.md, contracts K2–K4.
const REPORT_REQUIRED = { error: 'Each link opens one report — say which report this link is for.', code: 'REPORT_REQUIRED' };
const PASSWORD_AND_SOURCE = {
  error: 'Choose one password: type one, use another link’s, or have one made up.',
  code: 'PASSWORD_AND_SOURCE',
};
const STAFF_CANNOT_SET_PASSWORD = {
  error: 'Doorline staff can’t type a link password — make one up or use Same as …',
  code: 'STAFF_CANNOT_SET_PASSWORD',
};
// A link to all your reports never keeps its password (it is never shown or copied), so one made up
// under a support grant could be seen by nobody.
const STAFF_CANNOT_CHANGE_ALL_REPORTS = {
  error: 'Doorline staff can’t change the password of a link to all your reports — nobody could see the new one.',
  code: 'STAFF_CANNOT_SET_PASSWORD',
};
const STAFF_CANNOT_VIEW_PASSWORD = { error: 'Doorline staff can’t view link passwords.', code: 'STAFF_CANNOT_VIEW_PASSWORD' };
// Without a seal key, a password made up under a support grant could be seen by nobody (§C3) — and
// Same as … needs the same key, so the way out is the campaign's own admins and leads, who see a made-up
// password once, right after it's made.
const PASSWORDS_NOT_KEPT = {
  error: 'Doorline can’t keep link passwords right now, so nobody could see one made up here. The campaign’s admins and leads can make this link.',
  code: 'PASSWORDS_NOT_KEPT',
};
const PASSWORDS_NOT_KEPT_ON_CHANGE = {
  error: 'Doorline can’t keep link passwords right now, so nobody could see a new one. The campaign’s admins and leads can change it.',
  code: 'PASSWORDS_NOT_KEPT',
};
const CANT_COPY = 'Your last link’s password can’t be copied any more — choose Make one up for me or Type my own.';
const SOURCE_NOT_FOUND = { error: CANT_COPY, code: 'SOURCE_NOT_FOUND' };
const SOURCE_NOT_VIEWABLE = { error: CANT_COPY, code: 'PASSWORD_NOT_VIEWABLE' };
const PASSWORD_NOT_VIEWABLE = {
  error: 'This link’s password can’t be shown. To have one you can see, change it — then send your client the new password.',
  code: 'PASSWORD_NOT_VIEWABLE',
};
const REPORT_HAS_LINK = { error: 'This report already has its link.', code: 'REPORT_HAS_LINK' };
// What a link to all your reports can still do (§C1, contract K5): delete always; until the switch, also
// a new password and a new address.
const allReportsRefusal = () => ({
  error: allReportsRetired()
    ? 'Links that open all your reports can only be deleted now.'
    : 'Links that open all your reports can only get a new password or a new address, or be deleted.',
  code: 'ALL_REPORTS_LINK',
});

const days = z.number().int().min(1).max(SHARE_MAX_DAYS);
const shareCreateSchema = z.object({
  campaignId: z.string(),
  // Still accepted; Share sends none (new links have no label, older ones keep theirs).
  label: z.string().max(120).optional(),
  // A password typed in (12+); or `passwordFrom`, another link of this campaign whose password it copies
  // (Same as …); or neither — the route MAKES ONE UP, never an open link. Never both.
  password: z.string().max(200).optional(),
  passwordFrom: z.string().optional(),
  // The picker offers 30, 90, 180 or 365 days (default 90).
  expiresInDays: days.optional(),
  // The report this link opens — REQUIRED (one link per report, §C2): a link to every report of the
  // campaign is no longer made. Nullable in the schema only so its absence answers REPORT_REQUIRED.
  reportId: z.string().nullable().optional(),
});
const shareUpdateSchema = z.object({
  label: z.string().max(120).optional(),
  // A string sets or replaces the password; omitted = unchanged. REMOVAL IS NOT SUPPORTED: a link
  // that can be quietly un-passworded after creation would falsify the policy's sentence. Null is
  // still accepted by the schema so the guard below returns a specific error, not a generic 400.
  password: z.string().max(200).nullable().optional(),
  // Make one up instead (never beside `password`).
  generatePassword: z.boolean().optional(),
  // With a new password: change it on the campaign's other links that use the same one, too (§C3).
  alsoChanged: z.boolean().optional(),
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

// Every link of a campaign as Share and the old-links card read them (contract K1). It always reads the
// campaign's links ITSELF — with their sealed copies, which never leave this function — because each
// row's flags are worked out against all the others; so a one-row response (every PATCH, extend, renew,
// rotate, unlock and POST) is as complete as the list. A row adds to shareRow:
//   · reportId and report — what the link opens: null on a link to all your reports (a link from before
//     the field included); else its report's dates, tab (as the tabs read now) and tab id. `report: null`
//     beside a reportId is a report deleted mid-race (DELETE /admin/client-reports/:id takes its links);
//   · allReports;
//   · passwordCopyable — its sealed copy opens with today's key under its own hash, whoever is asking:
//     what Same as … needs (staff may use it, never seeing the password);
//   · passwordViewable — copyable, and the request isn't Doorline staff under a support grant; when
//     false, passwordHiddenReason 'staff' (checked first) or 'unavailable' (no sealed copy, or it
//     doesn't open);
//   · samePasswordCount / samePasswordTabs — the campaign's OTHER links (never one to all your reports)
//     that use the same password, by sameLinkPassword — the rule Change password's "also change it"
//     uses — and the tabs they're on, newest first. Compared in memory, never returned.
// Never a hash, a sealed copy or a password.
const rowsOf = async (req, campaignId, now = new Date()) => {
  const links = await ReportShareLink.find({ organizationId: activeOrgId(req), campaignId })
    .select('+passwordSealed')
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const ids = [...new Set(links.filter((l) => l.reportId).map((l) => String(l.reportId)))];
  const reports = ids.length
    ? await ClientReport.find(
        { _id: { $in: ids }, organizationId: activeOrgId(req) },
        { weekStart: 1, weekEnd: 1, seriesId: 1, scope: 1, effortId: 1, effortName: 1, takenDownAt: 1 }
      ).lean()
    : [];
  const labels = await currentSeriesLabels(reports);
  const byId = new Map(reports.map((r) => [String(r._id), r]));
  const staff = !!req.supportGrant;
  const entries = links.map((l) => {
    const r = l.reportId ? byId.get(String(l.reportId)) : null;
    const allReports = isAllReportsLink(l);
    return {
      link: l,
      allReports,
      // takenDown: Share stays on a taken-down report, and says its link reads "taken down" until the
      // report is put back up.
      report: r
        ? {
            id: String(r._id),
            weekStart: r.weekStart,
            weekEnd: r.weekEnd,
            scopeLabel: (r.seriesId && labels.get(String(r.seriesId))) || scopeOf(r).label,
            takenDown: !!r.takenDownAt,
            seriesId: r.seriesId ? String(r.seriesId) : null,
          }
        : null,
      // The key sameLinkPassword compares: the hash, and the opened password (null when it can't be).
      passwordHash: l.passwordHash || null,
      password: allReports ? null : readLinkPassword(l.passwordSealed, l.passwordHash).password,
    };
  });
  return entries.map((e) => {
    const same = e.allReports ? [] : entries.filter((o) => o !== e && !o.allReports && sameLinkPassword(e, o));
    const copyable = !e.allReports && !!e.password;
    const viewable = copyable && !staff;
    return {
      ...shareRow(e.link, now),
      reportId: e.link.reportId ? String(e.link.reportId) : null,
      report: e.report,
      allReports: e.allReports,
      passwordCopyable: copyable,
      passwordViewable: viewable,
      passwordHiddenReason: viewable ? null : staff ? 'staff' : 'unavailable',
      samePasswordCount: same.length,
      samePasswordTabs: [...new Set(same.map((o) => o.report?.scopeLabel).filter(Boolean))],
    };
  });
};
// One link's row, read with every other link of its campaign (see rowsOf).
const rowOf = async (req, link, now) => (await rowsOf(req, link.campaignId, now)).find((r) => r.id === String(link._id)) || null;

// The report's link Share shows — the newest that works now, else the newest — as a row; null when the
// report has none. Any link, guarded or not, in any state.
const reportLinkRow = async (req, campaignId, reportId, now = new Date()) => {
  const links = await ReportShareLink.find(
    { organizationId: activeOrgId(req), campaignId, reportId },
    { createdAt: 1, isActive: 1, expiresAt: 1, failedUnlockAt: 1, campaignId: 1 }
  ).lean();
  const primary = primaryLinkOf(links, now);
  return primary ? rowOf(req, primary, now) : null;
};

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
    res.json({
      shares: await rowsOf(req, req.query.campaignId),
      // The switch (§C1), so the old-links card says whether they still work; and whether this is Doorline
      // staff under a support grant, so Share leaves out what staff can't do.
      allReportsRetired: allReportsRetired(),
      staffUnderGrant: !!req.supportGrant,
    });
  } catch (err) {
    next(err);
  }
});

// A report's link (contract K2): always a password and an expiry, and one link per report. In order —
// validate; load the report (in this organization and campaign, so nothing below can reveal another
// organization's link); LOOK FIRST: a link of any kind or state already on the report answers 409
// REPORT_HAS_LINK with the one Share shows, before the not-shown refusal and before any hashing; then
// REPORT_NOT_SHOWN; then the password and the create, in the one-link guard. The password is typed
// (`password`), copied from another link of the campaign (`passwordFrom`, Same as …), or made up here and
// returned in the clear right away (`generatedPassword`) — and kept sealed, so Share can show it again.
router.post('/', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const orgId = activeOrgId(req);
    const staff = !!req.supportGrant;
    const data = shareCreateSchema.parse(req.body);
    const typed = data.password !== undefined;
    const copied = data.passwordFrom !== undefined;
    if (typed && copied) return res.status(400).json(PASSWORD_AND_SOURCE);
    // Doorline staff under a support grant never type a link password (§C3): they'd know it, and could
    // keep opening the report through /share after the grant ends.
    if (typed && staff) return res.status(403).json(STAFF_CANNOT_SET_PASSWORD);
    if (typed && data.password.length < SHARE_PASSWORD_MIN) return res.status(400).json(TOO_SHORT);
    if (typed && !isWellFormedText(data.password)) return res.status(400).json(NOT_TEXT);
    if (data.reportId == null) return res.status(400).json(REPORT_REQUIRED);
    if (!mongoose.isValidObjectId(data.campaignId)) return res.status(404).json({ error: 'Campaign not found in this org' });
    // NOT_DELETING: a mid-delete campaign reads as gone (services/campaigns/deletionState.js).
    const campaign = await Campaign.findOne({ _id: data.campaignId, organizationId: orgId, ...NOT_DELETING }, { _id: 1 }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found in this org' });
    if (!(await manages(req, res, campaign._id))) return;
    if (!mongoose.isValidObjectId(data.reportId)) return res.status(400).json({ error: 'Invalid reportId' });
    // With its dates and tab: History names the link by its report.
    const report = await ClientReport.findOne(
      { _id: data.reportId, organizationId: orgId, campaignId: campaign._id },
      { status: 1, takenDownAt: 1, seriesId: 1, weekStart: 1, weekEnd: 1 }
    ).lean();
    if (!report) return res.status(404).json(REPORT_NOT_FOUND);
    const now = new Date();
    const existing = await reportLinkRow(req, campaign._id, report._id, now);
    if (existing) return res.status(409).json({ ...REPORT_HAS_LINK, share: existing });
    // The client sees it now (§D): a draft has nothing to show yet, and a taken-down report — still
    // status 'published' — would only ever say "taken down".
    if (report.status !== 'published' || report.takenDownAt) return res.status(409).json(NOT_SHOWN(report));

    // The password: copied verbatim from its source (no bcrypt run — the same sealed copy opens under the
    // same hash), or typed or made up here (bcrypt, then the seal bound to that hash).
    let credentials;
    let generated = null;
    if (copied) {
      // The organization filter is what keeps Same as … inside one organization (canManageCampaign alone
      // doesn't); the campaign's, inside this campaign.
      const source = mongoose.isValidObjectId(data.passwordFrom)
        ? await ReportShareLink.findOne(
            { _id: data.passwordFrom, organizationId: orgId, campaignId: campaign._id },
            'passwordHash passwordMeetsRule reportId +passwordSealed'
          ).lean()
        : null;
      if (!source) return res.status(404).json(SOURCE_NOT_FOUND);
      const opened = isAllReportsLink(source) ? null : readLinkPassword(source.passwordSealed, source.passwordHash).password;
      const verified = !!opened && (await bcrypt.compare(opened, source.passwordHash).catch(() => false));
      if (!verified) return res.status(409).json(SOURCE_NOT_VIEWABLE);
      credentials = { passwordHash: source.passwordHash, passwordSealed: source.passwordSealed, passwordMeetsRule: source.passwordMeetsRule };
    } else {
      // Made up under a support grant without a seal key: nobody could ever see it.
      if (!typed && staff && !sealedSecretConfigured()) return res.status(403).json(PASSWORDS_NOT_KEPT);
      generated = typed ? null : generateSharePassword();
      const plain = typed ? data.password : generated;
      const passwordHash = await bcrypt.hash(plain, 10);
      const passwordSealed = sealLinkPassword(plain, passwordHash);
      if (!typed && staff && !passwordSealed) return res.status(403).json(PASSWORDS_NOT_KEPT);
      credentials = { passwordHash, passwordSealed, passwordMeetsRule: true };
    }

    const linkDoc = () => ({
      organizationId: orgId,
      campaignId: campaign._id,
      token: newShareToken(),
      label: data.label || '',
      ...credentials,
      expiresAt: new Date(now.getTime() + (data.expiresInDays || SHARE_DEFAULT_DAYS) * DAY_MS),
      lifetimeStartAt: now,
      credentialVersion: 0,
      failedUnlockAt: [],
      failedUnlocksTotal: 0,
      failedByDay: [],
      reportId: report._id,
      oneLinkGuard: true,
      createdBy: req.user._id,
    });
    // Two Shares at the same instant both pass the look-first; the guard keeps one. The loser answers the
    // same 409 with the link that won — or 404 when the winner went with its report a moment ago; when
    // the winner went alone (deleted), the key is free again and it tries once more.
    let created = null;
    for (let attempt = 0; !created; attempt += 1) {
      try {
        created = await ReportShareLink.create(linkDoc());
      } catch (err) {
        if (!isOneLinkGuardError(err)) throw err;
        const winner = await reportLinkRow(req, campaign._id, report._id);
        if (winner) return res.status(409).json({ ...REPORT_HAS_LINK, share: winner });
        if (!(await ClientReport.exists({ _id: report._id, organizationId: orgId }))) return res.status(404).json(REPORT_NOT_FOUND);
        if (attempt >= 1) return res.status(409).json({ error: 'This report’s link just changed. Look again, then share it.', code: 'SHARE_CHANGED' });
      }
    }
    // The created document carries the sealed copy: read from, never spread into a response.
    const share = created.toObject();
    await writeLinkHistory(share, LINK_FIELDS.created, { by: req.user._id, toValue: { ...labelOnly(share), expiresAt: share.expiresAt }, report }).catch(() => {});
    // Its report deleted while the link was being made: the delete took the report's links before this
    // one existed, so this one goes the same way, and says so — never left behind opening nothing.
    if (!(await ClientReport.exists({ _id: report._id }))) {
      const r = await ReportShareLink.deleteOne({ _id: share._id, organizationId: orgId });
      if (r.deletedCount) await writeLinkHistory(share, LINK_FIELDS.deleted, { by: req.user._id, toValue: { ...labelOnly(share), reportDeleted: true }, report }).catch(() => {});
      return res.status(404).json(REPORT_NOT_FOUND);
    }
    res.set('Cache-Control', 'no-store');
    res.status(201).json({
      share: await rowOf(req, share, now),
      // Present only when WE made it up — shown to the operator right away (Share can show it again later)
      // — and never to Doorline staff under a support grant.
      ...(generated && !staff ? { generatedPassword: generated } : {}),
    });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Show (contract K4): the password, for the campaign's admins and leads — never Doorline staff under a
// support grant. Opened from its sealed copy and checked against the hash, so a stale or foreign copy is
// never shown as current; anything that can't be shown is 409 with a reason, never a 500. no-store, and
// the value is never logged.
router.get('/:id/password', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    if (req.supportGrant) return res.status(403).json(STAFF_CANNOT_VIEW_PASSWORD);
    if (isAllReportsLink(share)) return res.status(409).json(allReportsRefusal());
    const link = await ReportShareLink.findOne({ _id: share._id, organizationId: activeOrgId(req) }, 'passwordHash +passwordSealed').lean();
    if (!link) return res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    const { password, reason } = readLinkPassword(link.passwordSealed, link.passwordHash);
    if (!password) return res.status(409).json({ ...PASSWORD_NOT_VIEWABLE, reason });
    if (!(await bcrypt.compare(password, link.passwordHash).catch(() => false))) {
      return res.status(409).json({ ...PASSWORD_NOT_VIEWABLE, reason: 'mismatch' });
    }
    res.json({ password });
  } catch (err) {
    next(err);
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

// Label, password, enable/disable (contract K3). A password change (or a first password on a legacy open
// link) and a disable bump the credential version; a legacy link gaining a password also gains an expiry
// and a lifetime, so it leaves isLegacyOpen and the revoke sweep (C2).
//
// A new password is typed (`password`) or made up here (`generatePassword`, returned as `password` —
// never to Doorline staff under a support grant), then sealed beside its hash in the same write. With
// `alsoChanged`, the campaign's other links that use the same password get the new one too (§C3) — a
// leaked season password, or a manager who left, replaced in one step:
//   1. this link's own write returns its PRE-image (with its sealed copy): its hash, and its password
//      when that copy opens;
//   2. candidates: the campaign's other links, never one to all your reports, whose hash is that hash or
//      whose sealed copy opens to that password (sameLinkPassword — the rule the rows' count uses), so a
//      password copied with Same as … and one typed again by hand are both found;
//   3. each is changed by its own compare-and-set on the hash IT had when read: a result means it changed
//      (its own History row, changedTogether), none means someone changed it meanwhile — skipped, never
//      overwritten. One bcrypt run and one seal serve every link.
// The answer says how many changed and were skipped. On a link to all your reports (§C1), only a password
// change, and only until the switch: never kept sealed (it is never shown or copied), never alsoChanged,
// and never by staff under a grant — nobody could see the new one.
router.patch('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const data = shareUpdateSchema.parse(req.body);
    const staff = !!req.supportGrant;
    const typed = data.password !== undefined;
    const generate = data.generatePassword === true;
    const also = data.alsoChanged === true;
    if (typed && generate) return res.status(400).json(PASSWORD_AND_SOURCE);
    if (typed) {
      if (!data.password) {
        return res.status(400).json({
          error: 'A password cannot be removed from a link — replace it, or rotate the link.',
          code: 'SHARE_PASSWORD_REQUIRED',
        });
      }
      if (staff) return res.status(403).json(STAFF_CANNOT_SET_PASSWORD);
      if (data.password.length < SHARE_PASSWORD_MIN) return res.status(400).json(TOO_SHORT);
      if (!isWellFormedText(data.password)) return res.status(400).json(NOT_TEXT);
    }
    const allReports = isAllReportsLink(share);
    if (allReports) {
      const passwordOnly = (typed || generate) && data.label === undefined && data.isActive === undefined && !also;
      if (allReportsRetired() || !passwordOnly) return res.status(409).json(allReportsRefusal());
      if (staff) return res.status(403).json(STAFF_CANNOT_CHANGE_ALL_REPORTS);
    }
    if (generate && staff && !sealedSecretConfigured()) return res.status(403).json(PASSWORDS_NOT_KEPT_ON_CHANGE);
    const now = new Date();
    const orgId = activeOrgId(req);
    const set = {};
    if (data.label !== undefined) set.label = lit(data.label);
    let bump = false;
    let generated = null;
    let newHash = null;
    let newSealed = null;
    if (typed || generate) {
      generated = generate ? generateSharePassword() : null;
      const plain = typed ? data.password : generated;
      newHash = await bcrypt.hash(plain, 10);
      newSealed = allReports ? null : sealLinkPassword(plain, newHash);
      if (generate && staff && !newSealed) return res.status(403).json(PASSWORDS_NOT_KEPT_ON_CHANGE);
      set.passwordHash = lit(newHash);
      set.passwordSealed = lit(newSealed);
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
    const pre = await ReportShareLink.findOneAndUpdate({ _id: share._id, organizationId: orgId }, [{ $set: set }], {
      returnDocument: 'before',
      projection: '+passwordSealed',
    }).lean();
    if (!pre) return res.status(404).json({ error: 'Share link not found', code: 'SHARE_NOT_FOUND' });
    const by = req.user._id;

    // Change it everywhere: the links that used this link's password a moment ago.
    let changed = 0;
    let skipped = 0;
    if (newHash && also) {
      const was = { passwordHash: pre.passwordHash || null, password: readLinkPassword(pre.passwordSealed, pre.passwordHash).password };
      const others = await ReportShareLink.find({ organizationId: orgId, campaignId: share.campaignId, _id: { $ne: share._id }, reportId: { $ne: null } })
        .select('+passwordSealed')
        .lean();
      const same = others.filter((o) => sameLinkPassword(was, { passwordHash: o.passwordHash || null, password: readLinkPassword(o.passwordSealed, o.passwordHash).password }));
      const reports = new Map(
        (await ClientReport.find({ _id: { $in: same.map((o) => o.reportId) }, organizationId: orgId }, { seriesId: 1, weekStart: 1, weekEnd: 1 }).lean()).map((r) => [String(r._id), r])
      );
      for (const o of same) {
        const before = await ReportShareLink.findOneAndUpdate(
          { _id: o._id, organizationId: orgId, passwordHash: o.passwordHash },
          [{ $set: { passwordHash: lit(newHash), passwordSealed: lit(newSealed), passwordMeetsRule: true, credentialVersion: plusOne('credentialVersion') } }],
          { returnDocument: 'before' }
        ).lean();
        if (!before) {
          skipped += 1;
          continue;
        }
        changed += 1;
        await writeLinkHistory(before, LINK_FIELDS.passwordChanged, {
          by,
          toValue: { ...labelOnly(before), changedTogether: true },
          report: reports.get(String(o.reportId)) || null,
        }).catch(() => {});
      }
    }
    if (newHash) {
      await writeLinkHistory(pre, LINK_FIELDS.passwordChanged, {
        by,
        toValue: {
          ...labelOnly(pre),
          wasOpenLink: !pre.passwordHash,
          ...(pre.expiresAt ? {} : { expiryAdded: true }),
          ...(changed ? { alsoChanged: changed } : {}),
        },
      }).catch(() => {});
    }
    if (data.isActive !== undefined && data.isActive !== (pre.isActive === true)) {
      await writeLinkHistory(pre, data.isActive ? LINK_FIELDS.enabled : LINK_FIELDS.disabled, { by, toValue: labelOnly(pre) }).catch(() => {});
    }
    if (newHash) res.set('Cache-Control', 'no-store');
    res.json({
      share: await rowOf(req, share, now),
      ...(generated && !staff ? { password: generated } : {}),
      ...(newHash && also ? { changed, skipped } : {}),
    });
  } catch (err) {
    zodFail(res, next)(err);
  }
});

// Extend: expiresAt = max(current, now + days), capped at a year from lifetimeStart — so it NEVER
// shortens a link, and never takes it past its one-year life. A legacy link that never expires is
// given its first expiry here ("Set an expiry"), its life starting now. An expired link is renewed,
// not extended (409 SHARE_NEEDS_RENEW): extending it would bring a long-dead address back to life. Never
// a link to all your reports (§C1): it can't be extended, renewed or unlocked any more.
router.post('/:id/extend', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    if (isAllReportsLink(share)) return res.status(409).json(allReportsRefusal());
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
    if (isAllReportsLink(share)) return res.status(409).json(allReportsRefusal());
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
// The password carries over; the expiry and the one-year life don't change. A link to all your reports
// may still get a new address until the switch (§C1) — the policy promises the link can be rotated.
router.post('/:id/rotate', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    if (isAllReportsLink(share) && allReportsRetired()) return res.status(409).json(allReportsRefusal());
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
    if (isAllReportsLink(share)) return res.status(409).json(allReportsRefusal());
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

// Delete: always — a link to all your reports included, switch or not (the policy: "may revoke a link at
// any time"). Its History row says which kind it was (toValue.allReports), since older rows carry nothing
// to tell the two apart once the link is gone.
router.delete('/:id', async (req, res, next) => {
  try {
    if (!ensureOrgScoped(req, res)) return;
    const share = await loadShareInOrg(req, res);
    if (!share) return;
    const r = await ReportShareLink.deleteOne({ _id: share._id, organizationId: activeOrgId(req) });
    if (r.deletedCount) {
      await writeLinkHistory(share, LINK_FIELDS.deleted, {
        by: req.user._id,
        toValue: { ...labelOnly(share), ...(isAllReportsLink(share) ? { allReports: true } : {}) },
      }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
