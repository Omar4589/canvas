import { Subscription } from '../../models/Subscription.js';
import { windDownDeletionDate } from './windDown.js';

// Pure effective-state resolution — no DB, no clock writes. The one computed
// transition lives here: a `trial` past trialEndsAt IS suspended, resolved at
// read time so nothing has to flip a bit at midnight. Everything downstream
// (the gate middleware, bootstrap, banners) consumes these flags, never the raw
// status, so the rules exist in exactly one place.
//
//   canWrite   — mutating API calls allowed (false = read-only)
//   canCanvass — mobile may record new dispositions/surveys
//   banner     — which notice org-facing UIs show: null | 'trial' |
//                'trial_expired' | 'past_due' | 'suspended' | 'canceled'
export function entitlementFor(sub, now = new Date()) {
  // No record = an org created before the billing migration ran. Fail OPEN by
  // design: billing must never lock an org out because ops forgot a migration.
  if (!sub) {
    return { effective: 'active', canWrite: true, canCanvass: true, banner: null, trialDaysLeft: null };
  }
  switch (sub.status) {
    case 'internal':
      return { effective: 'internal', canWrite: true, canCanvass: true, banner: null, trialDaysLeft: null };
    case 'active':
      return { effective: 'active', canWrite: true, canCanvass: true, banner: null, trialDaysLeft: null };
    case 'trial': {
      const ends = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
      if (ends && now > ends) {
        return { effective: 'suspended', canWrite: false, canCanvass: false, banner: 'trial_expired', trialDaysLeft: 0 };
      }
      const trialDaysLeft = ends ? Math.max(0, Math.ceil((ends - now) / 86400000)) : null;
      return { effective: 'trial', canWrite: true, canCanvass: true, banner: 'trial', trialDaysLeft };
    }
    case 'past_due':
      // Full access + a persistent banner. Suspension stays a HUMAN decision
      // until the Stripe phase — no automatic grace-window math here.
      return { effective: 'past_due', canWrite: true, canCanvass: true, banner: 'past_due', trialDaysLeft: null };
    case 'suspended':
      return { effective: 'suspended', canWrite: false, canCanvass: false, banner: 'suspended', trialDaysLeft: null };
    case 'canceled':
      // windDownEndsAt is the SAME date the wind-down job deletes on (both call windDownDeletionDate),
      // so the banner's warning is provably the deletion date. null if there's no cancellation anchor.
      return {
        effective: 'canceled',
        canWrite: false,
        canCanvass: false,
        banner: 'canceled',
        trialDaysLeft: null,
        windDownEndsAt: windDownDeletionDate(sub.statusChangedAt),
      };
    default:
      // Unknown status (a future enum value reaching an old server) — fail open.
      return { effective: 'active', canWrite: true, canCanvass: true, banner: null, trialDaysLeft: null };
  }
}

export async function subscriptionForOrg(organizationId) {
  return Subscription.findOne({ organizationId }).lean();
}

// One call for "should this org's public share links resolve?" — used by the
// no-login share portal, which sits outside the authed entitlement gate.
export async function shareLinksBlocked(organizationId) {
  const ent = entitlementFor(await subscriptionForOrg(organizationId));
  return ent.effective === 'suspended' || ent.effective === 'canceled';
}
