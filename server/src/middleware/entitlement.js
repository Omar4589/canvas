import mongoose from 'mongoose';
import { Membership } from '../models/Membership.js';
import { Subscription } from '../models/Subscription.js';
import { entitlementFor } from '../services/billing/entitlement.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Mirror orgContext's org resolution without its extra queries: the X-Org-Id
// header when present (every mobile call and the web api() wrapper send it),
// else the single-active-membership auto-pick. Null = no org scope resolvable;
// the downstream gates 400/403 those requests anyway.
async function resolveOrgId(req) {
  const headerVal = req.headers['x-org-id'];
  const orgIdRaw = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (orgIdRaw && mongoose.isValidObjectId(orgIdRaw)) return orgIdRaw;
  if (!req.user || req.user.isSuperAdmin) return null;
  const memberships = await Membership.find(
    { userId: req.user._id, isActive: true },
    { organizationId: 1 }
  ).lean();
  return memberships.length === 1 ? memberships[0].organizationId : null;
}

// The entitlement gate for /admin + /mobile (super-admin surfaces are exempt at
// the mount). Reads always pass — a paused OR ended org is READ-ONLY, its data is
// never held hostage — while writes need canWrite. Carve-outs:
//   - super admins bypass entirely (they're the account managers);
//   - sync-boundary grace: a /mobile submission whose body.timestamp predates
//     the suspension instant (statusChangedAt) is accepted, so a canvasser's
//     offline queue recorded while the org was entitled always flushes. The
//     grace is mobile-only — an admin write can't smuggle an old timestamp.
//
// `canceled` used to close the org COMPLETELY, reads included — which meant the
// 60-day post-termination wind-down (services/retention/triggers.js) was a
// promise we couldn't keep: the customer's data was scheduled for deletion in a
// window during which we wouldn't let them export it. `canceled` is now
// READ-ONLY, like suspended: reads and every export route pass, writes/knocks are
// blocked, and the wind-down deletes at 60 days. So the wind-down is a real
// export window. (An INSTANT hard lockout — fraud/abuse — remains available as a
// deliberate manual action, e.g. deactivating the org or 'suspended'-style
// handling; it is just no longer what ordinary termination does.) Public share
// links stay blocked for both suspended and canceled (see shareLinksBlocked).
// Blocked writes get 402 { code: 'subscription-inactive' }, the one code both
// clients map to friendly copy. Attaches req.entitlement (+ req.subscription).
export async function requireEntitlement(req, res, next) {
  try {
    if (req.user?.isSuperAdmin) return next();
    const orgId = await resolveOrgId(req);
    if (!orgId) return next();
    const sub = await Subscription.findOne({ organizationId: orgId }).lean();
    const ent = entitlementFor(sub);
    req.entitlement = ent;
    req.subscription = sub;

    if (!WRITE_METHODS.has(req.method)) return next();
    if (ent.canWrite) return next();

    const isMobile = `${req.baseUrl}${req.path}`.includes('/mobile');
    const stampedAt = req.body?.timestamp ? Date.parse(req.body.timestamp) : NaN;
    if (
      isMobile &&
      Number.isFinite(stampedAt) &&
      sub?.statusChangedAt &&
      stampedAt < new Date(sub.statusChangedAt).getTime()
    ) {
      return next();
    }

    const message =
      ent.banner === 'trial_expired'
        ? 'The free trial has ended — the account is read-only until it’s activated.'
        : ent.effective === 'canceled'
          ? 'This subscription has ended. Your data is read-only and available to export during the wind-down period.'
          : 'This account is paused — recording and edits are disabled, existing data is safe.';
    return res.status(402).json({ error: message, code: 'subscription-inactive', status: ent.effective });
  } catch (err) {
    next(err);
  }
}
