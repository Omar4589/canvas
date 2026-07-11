import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { loadRoleContext } from '../lib/role';

// Billing-entitlement notice for the field app. Renders nothing for healthy orgs.
//
// Role-aware on purpose: only ADMINS see billing warnings (the trial countdown and the
// past-due invoice nag). Canvassers and team leads don't handle the bill, so they only get
// the operational "canvassing is paused" notice when the account is actually read-only —
// enough to explain why recording is off, with no mention of trials or money. The server's
// entitlement gate is the real enforcement; this is the courteous heads-up.

// States where canvassing is actually blocked (read-only). Everyone gets the "paused" notice
// for these; trial + past_due (full-access nags) are admin-only.
const PAUSED = new Set(['trial_expired', 'suspended', 'canceled']);

const PAUSED_COPY = 'This account is paused — canvassing is disabled. Your recorded work is safe.';

// Fixed soft tints (light grounds, dark text) so they read fine in both themes.
const TONES = {
  trial: { bg: '#DBEAFE', fg: '#1E40AF' },
  trial_expired: { bg: '#FEE2E2', fg: '#991B1B' },
  past_due: { bg: '#FEF3C7', fg: '#92400E' },
  suspended: { bg: '#FEE2E2', fg: '#991B1B' },
  canceled: { bg: '#FEE2E2', fg: '#991B1B' },
};

// Full billing copy — admins only.
function adminCopy(entitlement) {
  switch (entitlement.banner) {
    case 'trial':
      return `Free trial — ${entitlement.trialDaysLeft} day${entitlement.trialDaysLeft === 1 ? '' : 's'} left.`;
    case 'trial_expired':
      return 'The free trial has ended — canvassing is paused. Your recorded work is safe.';
    case 'past_due':
      return 'An invoice is past due — please contact Doorline to keep access.';
    case 'suspended':
    case 'canceled':
      return 'This account is paused — canvassing is disabled. Your recorded work is safe.';
    default:
      return null;
  }
}

export default function EntitlementBanner({ entitlement }) {
  // Default false = treat the viewer as a canvasser until the cached role loads, so billing
  // warnings are never briefly exposed to a non-admin during the (near-instant) cache read.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRoleContext()
      .then((ctx) => {
        if (alive) setIsAdmin(!!ctx.isOrgAdmin);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const banner = entitlement?.banner;
  if (!banner) return null;

  const paused = PAUSED.has(banner);
  // Non-admins only ever see the operational "paused" notice — never trial/past-due.
  if (!isAdmin && !paused) return null;
  // Admins keep the "trial only shows in its last 3 days" rule.
  if (isAdmin && banner === 'trial' && (entitlement.trialDaysLeft == null || entitlement.trialDaysLeft > 3)) {
    return null;
  }

  const text = isAdmin ? adminCopy(entitlement) : PAUSED_COPY;
  if (!text) return null;
  const tone = TONES[banner] || TONES.suspended;

  return (
    <View
      style={{
        backgroundColor: tone.bg,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 7,
        marginHorizontal: 12,
        marginTop: 6,
      }}
    >
      <Text style={{ color: tone.fg, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
