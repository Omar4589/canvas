import { SupportAccessGrant } from '../../models/SupportAccessGrant.js';
import { AccessLog } from '../../models/AccessLog.js';
import { Organization } from '../../models/Organization.js';

// Vendor access to a customer's data: bounded, reasoned, recorded.
//
// The rule is one sentence: **platform staff may not enter a customer organization without a live
// grant, and every read of voter content under one is logged.** That is the whole of it. It does not
// reduce what an operator can do for a customer — it makes the doing attributable.

// A grant lasts long enough for a real support session and not long enough to become a standing
// permission you forget you left open.
export const DEFAULT_GRANT_HOURS = Number(process.env.SUPPORT_GRANT_HOURS || 4);
export const MAX_GRANT_HOURS = Number(process.env.SUPPORT_GRANT_MAX_HOURS || 24);

/** The live grant for (actor, org), or null. */
export async function activeGrant(actorUserId, organizationId) {
  return SupportAccessGrant.findOne({
    actorUserId,
    organizationId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ expiresAt: -1 });
}

export async function createGrant({ actorUserId, organizationId, reason, kind = 'support', hours }) {
  const h = Math.min(Number(hours) || DEFAULT_GRANT_HOURS, MAX_GRANT_HOURS);
  // Re-use a live grant rather than stacking them, so "how long have they been in there" stays a
  // question with one answer.
  const existing = await activeGrant(actorUserId, organizationId);
  if (existing) return existing;

  return SupportAccessGrant.create({
    actorUserId,
    organizationId,
    reason: String(reason || '').trim(),
    kind,
    expiresAt: new Date(Date.now() + h * 3_600_000),
  });
}

export async function revokeGrant(grantId, actorUserId) {
  return SupportAccessGrant.findOneAndUpdate(
    { _id: grantId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedBy: actorUserId } },
    { new: true }
  );
}

// FAIL CLOSED. Vendor access (a support grant) to ANY /admin or /mobile route is audited — UNLESS the
// path is on the short allowlist below of routes that carry no customer voter content.
//
// The previous design did the exact opposite: it logged only paths that matched a hand-maintained list
// of ten content prefixes. THREE of those ten were dead strings that could never match a real mount
// (`/admin/turfs`, `/admin/walklists`, `/admin/notes` — the real mounts are nested under
// `/admin/campaigns/:id/...` or don't exist), so the walk-list CSV export of names, addresses and phone
// numbers wrote ZERO audit rows. A list you must remember to extend is a list that silently rots. This
// one rots SAFE: a new or moved voter-data route is logged by default the day it ships; only an
// explicit, reviewed exemption is ever unlogged. The structural test (test/accessLogCoverage.int.test.js)
// exists to keep it that way.
const AUDIT_EXEMPT = [
  /^\/admin\/config(\/|$)/, // client feature flags / org config — no voter content
  /\/setup-status(\/|$)/, // campaign-wizard progress booleans
  /^\/admin\/campaigns\/[^/]+\/passes(\/|$)/, // round/pass structure — no voter content
];

// The audit list is served, per prefix, by the reasoning "a route that returns households also returns
// their addresses and GPS pings, and a report contains survey answers." These labels are for the human
// reading the log; an UNRECOGNIZED vendor route is still logged, classified 'other', because the failure
// we cannot tolerate is an unlogged read, not a mislabeled one.
const RESOURCE_LABELS = [
  [/^\/admin\/voters/, 'voters'],
  [/\/households/, 'map'],
  [/^\/admin\/reports/, 'reports'],
  [/^\/admin\/activities/, 'activity'],
  [/^\/admin\/surveys/, 'surveys'],
  [/^\/admin\/client-reports/, 'client-reports'],
  [/\/walklists/, 'walklists'],
  [/\/turfs/, 'turf'],
  [/\/voted/, 'voted'],
  [/^\/admin\/imports/, 'imports'],
  [/^\/mobile/, 'mobile'],
];

/** True if a vendor request to this path need NOT be audited (metadata only). Everything else is. */
export function isAuditExempt(path) {
  return AUDIT_EXEMPT.some((rx) => rx.test(path));
}

/** Human label for the audit row. Never null — an unrecognized vendor route is logged as 'other'. */
export function classifyResource(path) {
  for (const [rx, label] of RESOURCE_LABELS) if (rx.test(path)) return label;
  return 'other';
}

/**
 * Require a live support grant for `organizationId`, or 403 with SUPPORT_ACCESS_REQUIRED (which the web
 * client turns into the grant modal). Returns the grant on success, or null after sending the 403 — the
 * caller must `return` when it gets null. Used by the platform person-identity console, which reaches
 * customer PII outside the /admin routers and so is not covered by orgContext.
 */
export async function requirePersonOrgGrant(req, res, organizationId) {
  if (!organizationId) {
    res.status(409).json({ error: 'This identity record is not scoped to an organization.' });
    return null;
  }
  const grant = await activeGrant(req.user._id, organizationId);
  if (grant) return grant;
  const org = await Organization.findById(organizationId, 'name').lean();
  res.status(403).json({
    error:
      'Viewing a voter identity record requires a support access grant for that customer. Start one ' +
      'with a reason — it is time-limited and every record you open is logged.',
    code: 'SUPPORT_ACCESS_REQUIRED',
    organizationId: String(organizationId),
    organizationName: org?.name || null,
  });
  return null;
}

/**
 * Record one staff read of customer voter content. Best-effort: an audit write must never take down
 * the request it is auditing — but it must also never silently vanish, so a failure is logged loudly.
 */
export async function recordAccess({ actorUserId, organizationId, grantId, method, route, resource }) {
  try {
    await AccessLog.create({ actorUserId, organizationId, grantId, method, route, resource });
    if (grantId) {
      await SupportAccessGrant.updateOne(
        { _id: grantId },
        { $inc: { accessCount: 1 }, $set: { lastAccessAt: new Date() } }
      );
    }
  } catch (err) {
    console.error('[accessLog] FAILED TO RECORD VENDOR ACCESS —', err?.message || err, {
      actorUserId: String(actorUserId), organizationId: String(organizationId), route,
    });
  }
}
