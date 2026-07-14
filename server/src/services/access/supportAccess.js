import { SupportAccessGrant } from '../../models/SupportAccessGrant.js';
import { AccessLog } from '../../models/AccessLog.js';

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

// Which routes hand back a customer's voter content? These are the ones worth logging — logging every
// metadata read would bury the signal in noise, and the signal is the point.
//
// Matched against the mounted path prefix. Deliberately broad: a route that returns households also
// returns their addresses and GPS pings, and a report contains survey answers.
const VOTER_CONTENT_ROUTES = [
  ['/admin/voters', 'voters'],
  ['/admin/households', 'map'],
  ['/admin/reports', 'reports'],
  ['/admin/activities', 'activity'],
  ['/admin/notes', 'notes'],
  ['/admin/surveys', 'surveys'],
  ['/admin/client-reports', 'client-reports'],
  ['/admin/turfs', 'turf'],
  ['/admin/walklists', 'walklists'],
  ['/mobile', 'mobile'],
];

/** The resource class a path reads, or null if it isn't voter content. */
export function voterContentResource(path) {
  for (const [prefix, resource] of VOTER_CONTENT_ROUTES) {
    if (path.startsWith(prefix)) return resource;
  }
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
