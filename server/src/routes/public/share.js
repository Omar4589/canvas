import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { ReportShareLink } from '../../models/ReportShareLink.js';
import { ClientReport } from '../../models/ClientReport.js';
import { Campaign } from '../../models/Campaign.js';
import { Organization } from '../../models/Organization.js';
import { OrgBranding } from '../../models/OrgBranding.js';
import { signShareToken, shareTokenNamesLink, verifyToken } from '../../services/auth/tokens.js';
import { shareLinksBlocked } from '../../services/billing/entitlement.js';
import {
  credentialVersionOf,
  reserveUnlockSlot,
  refundUnlockSlot,
  recordWrongPassword,
  notePasswordRule,
  stampLinkAccess,
} from '../../services/reports/shareLinks.js';
import { recordReportOpen } from '../../services/reports/reportOpens.js';
import { logoBytesOf } from '../../services/branding/orgLogo.js';
import {
  shapeReportForClient,
  shapeReportListRow,
  mapFilterSurvey,
} from '../../services/reports/clientReportView.js';
import {
  MapError,
  mapContextFor,
  legacyTemplatesFor,
  checkMapRequest,
  sendMapPayload,
  doorsPayload,
  parseRows,
} from '../../services/reports/clientReportMap.js';
import { earlierTotalsLine, seriesNav, currentSeriesLabels } from '../../services/reports/clientReportRead.js';

// PUBLIC report sharing — no login. A capability token in the URL (the SPA's /r/:token → /share/:token
// here) opens a campaign's PUBLISHED report hub (latest + history). An optional per-link password is
// exchanged for a short-lived share JWT that authorizes the reads. Mounted before the requireAuth gate.
// See docs/CLIENT_PORTAL.md; hardened in docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §F6 / §O7.
const router = Router();

// Every /share response, the logo included: never cached (a shared or borrowed device must not replay
// a report, or the password screen's answer, from a cache), and never indexed. robots.txt no longer
// blocks /r/: a crawler that robots.txt keeps out never sees a noindex, and can still list a forwarded
// link's bare URL — so the pages say noindex themselves (app.js sets it on the /r/ HTML).
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

async function loadShare(req, res, next) {
  try {
    const share = await ReportShareLink.findOne({ token: req.params.token, isActive: true });
    // A coded 404, so the page can tell a dead link (drop the remembered session) from a report
    // that was taken down (keep it) — the two used to read the same.
    if (!share) return res.status(404).json({ error: 'This report link is not available.', code: 'SHARE_NOT_FOUND' });
    // Expiry. A published report pins survey answers to street addresses, so a link that lives
    // forever is a forever-liability: it outlives the campaign, the staffer who sent it, and the
    // client relationship, and it keeps working from any inbox it was ever forwarded to.
    // Legacy rows have expiresAt: null and are treated as unexpired — the migration sunsets them
    // on notice rather than breaking a client's live URL without warning.
    if (share.expiresAt && share.expiresAt <= new Date()) {
      return res.status(410).json({
        error: 'This report link has expired. Ask your campaign contact for a new one.',
        code: 'SHARE_EXPIRED',
      });
    }
    // Billing: share links survive past_due but die with the org's access
    // (suspended/canceled) — the published report is the leverage.
    if (await shareLinksBlocked(share.organizationId)) {
      return res.status(410).json({ error: 'This report is no longer available.', code: 'SHARE_UNAVAILABLE' });
    }
    req.share = share;
    // No "last opened" stamp here: reaching the password screen, or guessing wrong, is not an open
    // (B7). It is stamped where access is GRANTED — requireShareAccess and a successful unlock.
    next();
  } catch (err) {
    next(err);
  }
}

// Open link → allowed. Password link → require a valid share JWT (X-Share-Token) for THIS share, issued
// under the link's CURRENT credential version — so a password change, rotate, renew or disable signs
// every device out at once (B5). The parentheses are load-bearing: `a ?? 0 === b ?? 0` would compare
// `0 === b` first. A lock is never read here, so devices already signed in keep working through one.
// The token names its link by an opaque key, no id (PRIV-2); one issued before that names it by id
// and still works until it expires (shareTokenNamesLink).
function requireShareAccess(req, res, next) {
  if (!req.share.passwordHash) {
    stampLinkAccess(req.share).catch(() => {});
    return next();
  }
  const raw = req.headers['x-share-token'];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (token) {
    try {
      const payload = verifyToken(token);
      if (shareTokenNamesLink(payload, req.share) && (payload.cv ?? 0) === credentialVersionOf(req.share)) {
        stampLinkAccess(req.share).catch(() => {});
        return next();
      }
    } catch {
      /* fall through to 401 */
    }
  }
  return res.status(401).json({ error: 'Password required', code: 'password-required' });
}

// Every report a link reaches: its campaign's PUBLISHED reports, never one taken down (§F3).
const reportScope = (req) => ({
  organizationId: req.share.organizationId,
  campaignId: req.share.campaignId,
  status: 'published',
  takenDownAt: null,
});

// Meta — drives the password gate, and nothing else: before the password, a link reveals neither the
// campaign, the organization nor its private label (B7). The names ride GET /:token/reports.
router.get('/:token', loadShare, (req, res) => {
  res.json({ requiresPassword: !!req.share.passwordHash });
});

// `remember` is read on its own (only a literal true counts), so a malformed one never reads as a
// missing password.
const unlockSchema = z.object({ password: z.string().min(1).max(200) });

// Throttle password guessing on a share link. Keyed by IP + token so guessing one link
// can't lock the IP out of others; only FAILED attempts count (a legit viewer unlocks in
// a try or two). `trust proxy` (app.js) makes req.ip the real client behind Heroku.
// It stays beside the per-LINK failure budget below, which no number of addresses can get past.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}:${req.params.token}`,
  message: { error: 'Too many attempts. Try again in a few minutes.', code: 'rate-limited' },
});

// Exchange the password for a share JWT: 24 hours, or 30 days with `remember` ("Keep me signed in on
// this device", opt-in). Every guess first RESERVES a slot in the link's failure budget (§O7) — one
// atomic update that drops entries older than 24 hours and adds one only if fewer than 50 remain —
// and only a reserved guess reaches bcrypt, so however many arrive at once, no link ever checks more
// than 50 wrong passwords in any 24 hours. No slot → 429 SHARE_LOCKED with no compare at all. The
// password is checked against the reservation's own post-image, and the token signed with ITS
// credential version, so a password changed mid-flight can't mint a token for the new one. A correct
// password takes its reservation back.
router.post('/:token/unlock', unlockLimiter, loadShare, async (req, res, next) => {
  try {
    const remember = req.body?.remember === true;
    const issue = (link) =>
      res.json({
        accessToken: signShareToken({ shareId: link._id, cv: credentialVersionOf(link), remember }),
      });
    if (!req.share.passwordHash) {
      // A legacy open link — uniform client flow. Access is granted, so it counts as opened.
      stampLinkAccess(req.share).catch(() => {});
      return issue(req.share);
    }
    const { password } = unlockSchema.parse(req.body);
    const slot = await reserveUnlockSlot({ linkId: req.share._id, token: req.params.token });
    if (!slot) return res.status(404).json({ error: 'This report link is not available.', code: 'SHARE_NOT_FOUND' });
    if (!slot.reserved) {
      return res.status(429).json({
        error: 'This link is locked after too many wrong passwords. Try again later, or ask the person who sent it.',
        code: 'SHARE_LOCKED',
      });
    }
    const ok = await bcrypt.compare(password, slot.link.passwordHash || '');
    if (ok) {
      await refundUnlockSlot({ linkId: slot.link._id, entryId: slot.entryId });
      notePasswordRule({ link: slot.link, password }).catch(() => {});
      stampLinkAccess(slot.link).catch(() => {});
      return issue(slot.link);
    }
    await recordWrongPassword({ slot });
    return res.status(401).json({ error: 'Incorrect password', code: 'SHARE_PASSWORD_WRONG' });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Password required', code: 'SHARE_PASSWORD_MISSING' });
    next(err);
  }
});

// The hub: the campaign's shown reports, newest first, with the names the page's header needs — the
// campaign and the organization ride HERE, behind the password, rather than on the meta call — and
// whether the organization has a logo (GET /:token/logo serves it). Rows carry civil dates only.
router.get('/:token/reports', loadShare, requireShareAccess, async (req, res, next) => {
  try {
    const reports = await ClientReport.find(reportScope(req))
      .sort({ weekStart: -1, publishedAt: -1 })
      .lean();
    const [campaign, org, labels, logo] = await Promise.all([
      Campaign.findById(req.share.campaignId, { name: 1 }).lean(),
      Organization.findById(req.share.organizationId, { name: 1 }).lean(),
      currentSeriesLabels(reports),
      OrgBranding.exists({ organizationId: req.share.organizationId }),
    ]);
    // One survey read for every report that predates snapshots (their map questions' dependencies).
    const legacy = reports.some((r) => !(r.snapshotInputs && typeof r.snapshotInputs === 'object'))
      ? await legacyTemplatesFor({ organizationId: req.share.organizationId, campaignId: req.share.campaignId })
      : [];
    const rows = [];
    for (const r of reports) {
      const { inputs } = await mapContextFor(r, { templates: legacy });
      rows.push(shapeReportListRow(r, { inputs, seriesLabel: r.seriesId ? labels.get(String(r.seriesId)) : null }));
    }
    res.json({
      campaignName: campaign?.name || 'Campaign',
      orgName: org?.name || '',
      hasLogo: !!logo,
      reports: rows,
    });
  } catch (err) {
    next(err);
  }
});

async function loadReport(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id', code: 'INVALID_ID' });
    const report = await ClientReport.findOne({ _id: req.params.id, ...reportScope(req) }).lean();
    // Taken down, deleted or never published all read the same to a link holder.
    if (!report) return res.status(404).json({ error: 'This report was taken down or removed.', code: 'REPORT_NOT_FOUND' });
    req.report = report;
    next();
  } catch (err) {
    next(err);
  }
}

// A report, shaped through the server-side visibility rules (§F1). It no longer counts an open:
// fetching is not opening (stage 2's /opened ping counts the page's visits).
router.get('/:token/reports/:id', loadShare, requireShareAccess, loadReport, async (req, res, next) => {
  try {
    const r = req.report;
    const [{ inputs }, earlierTotals, nav, labels] = await Promise.all([
      mapContextFor(r),
      earlierTotalsLine(r),
      seriesNav(r),
      currentSeriesLabels([r]),
    ]);
    res.json({
      report: shapeReportForClient(r, {
        inputs,
        earlierTotals,
        nav,
        seriesLabel: r.seriesId ? labels.get(String(r.seriesId)) : null,
      }),
      survey: mapFilterSurvey(r, inputs),
    });
  } catch (err) {
    next(err);
  }
});

const mapError = (err, res, next) =>
  err instanceof MapError ? res.status(err.status).json({ error: err.message, code: err.code }) : next(err);

// The map of the LIVE snapshot only (clientReportMap.js): 404 MAP_NOT_SHARED when the map is off,
// 409 MAP_UPDATED when the page's snapshot key or mode is out of date, in that order. Built once and
// served gzipped from the cache (sendMapPayload, PUBUX-4).
router.get('/:token/reports/:id/map', loadShare, requireShareAccess, loadReport, async (req, res, next) => {
  try {
    const mctx = await checkMapRequest(req.report, { snapshotKey: req.query.snapshotKey ?? null, mode: 'pins' });
    await sendMapPayload(req, res, req.report, mctx, 'pins');
  } catch (err) {
    mapError(err, res, next);
  }
});

// A tapped door's address and answers, by position in the live snapshot (at most 200 positions).
router.get('/:token/reports/:id/map/doors', loadShare, requireShareAccess, loadReport, async (req, res, next) => {
  try {
    if (!req.query.snapshotKey) return res.status(400).json({ error: 'snapshotKey is required', code: 'SNAPSHOT_KEY_REQUIRED' });
    const mctx = await checkMapRequest(req.report, { snapshotKey: String(req.query.snapshotKey), mode: 'pins' });
    res.json(await doorsPayload(req.report, mctx, parseRows(req.query.rows)));
  } catch (err) {
    mapError(err, res, next);
  }
});

// An area report's cells (§F5): outlines, doors and statuses, and only the answers the rule allows.
router.get('/:token/reports/:id/areas', loadShare, requireShareAccess, loadReport, async (req, res, next) => {
  try {
    const mctx = await checkMapRequest(req.report, { snapshotKey: req.query.snapshotKey ?? null, mode: 'area' });
    await sendMapPayload(req, res, req.report, mctx, 'area');
  } catch (err) {
    mapError(err, res, next);
  }
});

router.get('/:token/mapbox-token', loadShare, requireShareAccess, (req, res) => {
  const token = process.env.MAPBOX_PUBLIC_TOKEN || '';
  res.json({ token, isReady: Boolean(token && token.startsWith('pk.')) });
});

// An OPEN, counted by the page (§F7): it pings once per report per browser per day, so the panel
// reads "about N visits". 204 at once; only AFTER responding does the server look at an
// `Authorization` session token the page may send, to count a signed-in member of the organization
// (or Doorline staff) apart from the link's own visits. That lookup never grants or refuses anything,
// and a stale or ended session simply counts under the link.
router.post('/:token/reports/:id/opened', loadShare, requireShareAccess, loadReport, (req, res) => {
  res.status(204).end();
  const auth = String(req.headers.authorization || '');
  const [scheme, sessionToken] = auth.split(' ');
  recordReportOpen({
    report: req.report,
    share: req.share,
    sessionToken: scheme === 'Bearer' && sessionToken ? sessionToken : null,
  }).catch((err) => console.warn('[share] report open not recorded:', err?.message || err));
});

// The organization's logo (§F8), behind the same access as the reports: PNG bytes re-encoded by the
// server at upload (services/branding/png.js), or 204 when there is none. no-store like every /share
// response, so a revoked link's logo doesn't linger in a cache either.
router.get('/:token/logo', loadShare, requireShareAccess, async (req, res, next) => {
  try {
    const bytes = await logoBytesOf(req.share.organizationId);
    if (!bytes) return res.status(204).end();
    res.type('image/png').send(bytes);
  } catch (err) {
    next(err);
  }
});

// Anything else under /share is a coded 404 too — never a bare one the page can't tell from a dead
// link (only SHARE_NOT_FOUND tells it to drop a remembered session).
router.use((req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

export default router;
