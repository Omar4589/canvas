import { View, Text } from 'react-native';

// Billing-entitlement notice for the field app. Renders nothing for healthy
// orgs; trial shows only inside its last 3 days. Colors are fixed soft tints
// (light grounds, dark text) so they read fine in both themes. The server's
// entitlement gate is the real enforcement — this is the courteous heads-up.
const TONES = {
  trial: { bg: '#DBEAFE', fg: '#1E40AF' },
  trial_expired: { bg: '#FEE2E2', fg: '#991B1B' },
  past_due: { bg: '#FEF3C7', fg: '#92400E' },
  suspended: { bg: '#FEE2E2', fg: '#991B1B' },
  canceled: { bg: '#FEE2E2', fg: '#991B1B' },
};

function copyFor(entitlement) {
  switch (entitlement.banner) {
    case 'trial':
      return `Free trial — ${entitlement.trialDaysLeft} day${entitlement.trialDaysLeft === 1 ? '' : 's'} left.`;
    case 'trial_expired':
      return 'The free trial has ended — canvassing is paused. Your recorded work is safe.';
    case 'past_due':
      return 'An invoice is past due — ask your admin to contact Doorline.';
    case 'suspended':
    case 'canceled':
      return 'This account is paused — canvassing is disabled. Your recorded work is safe.';
    default:
      return null;
  }
}

export default function EntitlementBanner({ entitlement }) {
  const banner = entitlement?.banner;
  if (!banner) return null;
  if (banner === 'trial' && (entitlement.trialDaysLeft == null || entitlement.trialDaysLeft > 3)) return null;
  const tone = TONES[banner] || TONES.suspended;
  const text = copyFor(entitlement);
  if (!text) return null;
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
