import { useQuery } from '@tanstack/react-query';
import { api, getActiveOrgId } from '../api/client.js';
import NextStepBanner from './NextStepBanner.jsx';

const CONTACT = 'mailto:hello@doorline.app?subject=Doorline%20account';

// Global entitlement banner, mounted in the Layout next to AddedToOrgBanner.
// Renders nothing for healthy orgs; shows the trial countdown only inside the
// final 3 days so a fresh trial isn't nagged from minute one. The endpoint is
// org-admin-only, so canvasser/lead sessions just get a quiet 403 → null.
export default function BillingBanner() {
  const orgId = getActiveOrgId();
  const billingQ = useQuery({
    queryKey: ['admin', 'billing', orgId],
    queryFn: () => api('/admin/billing'),
    enabled: Boolean(orgId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // A canceled org's reads 402 before the endpoint answers — still tell them why.
  if (billingQ.error?.status === 402) {
    return (
      <NextStepBanner
        tone="danger"
        title="This organization's subscription has ended."
        className="mb-4"
        action={{ label: 'Contact Doorline', onClick: () => window.location.assign(CONTACT) }}
      >
        Your data is retained. Reach out to reactivate.
      </NextStepBanner>
    );
  }

  const ent = billingQ.data?.entitlement;
  if (!ent?.banner) return null;
  if (ent.banner === 'trial' && (ent.trialDaysLeft == null || ent.trialDaysLeft > 3)) return null;

  const contact = { label: 'Contact Doorline', onClick: () => window.location.assign(CONTACT) };

  if (ent.banner === 'trial') {
    return (
      <NextStepBanner
        tone="info"
        title={`Free trial — ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'} left.`}
        className="mb-4"
        action={contact}
      >
        Ready to activate, or need more time? We can help.
      </NextStepBanner>
    );
  }
  if (ent.banner === 'trial_expired') {
    return (
      <NextStepBanner tone="danger" title="Your trial has ended — this account is read-only." className="mb-4" action={contact}>
        Everything you built is safe. Activate to keep canvassing.
      </NextStepBanner>
    );
  }
  if (ent.banner === 'past_due') {
    return (
      <NextStepBanner tone="warning" title="An invoice is past due." className="mb-4" action={contact}>
        Please reach out to keep full access.
      </NextStepBanner>
    );
  }
  if (ent.banner === 'suspended') {
    return (
      <NextStepBanner tone="danger" title="This account is paused — read-only." className="mb-4" action={contact}>
        Recording and edits are disabled; your data is safe.
      </NextStepBanner>
    );
  }
  return null;
}
