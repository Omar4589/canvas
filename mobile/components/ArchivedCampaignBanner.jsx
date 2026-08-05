import { View, Text, StyleSheet } from 'react-native';
import { useCampaignArchived } from '../lib/useCampaignArchived';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// "This campaign is finished, so the buttons are gone" — the sentence that keeps a read-only
// screen from reading as a broken one.
//
// Self-nulling like EntitlementBanner: it resolves the archive state itself and renders nothing
// unless the campaign is archived, so the false-until-resolved rule is applied identically at
// every call site and can't be forgotten at one of them. Ten instances share one deduped query.
//
// `extra` is a second line for a screen whose behaviour differs from the banner's blanket claim —
// today only Exports, which stays fully enabled.
export default function ArchivedCampaignBanner({ campaignId, extra, style }) {
  const styles = useThemedStyles(makeStyles);
  const { isArchived } = useCampaignArchived(campaignId);
  if (!isArchived) return null;

  return (
    <View style={[styles.banner, style]}>
      {/* Same sentence the campaign screen has always shown, so archived reads identically
          wherever you meet it. */}
      <Text style={styles.text}>
        This campaign is archived — data is read-only. Reactivate it from the web to resume canvassing.
      </Text>
      {extra ? <Text style={[styles.text, styles.extra]}>{extra}</Text> : null}
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    banner: {
      backgroundColor: t.colors.warnBg,
      borderColor: t.colors.warnBorder,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    // warnFg, not warn: the raw tint fails contrast at caption size (see theme.js).
    text: { ...t.type.caption, color: t.colors.warnFg, fontWeight: '600' },
    extra: { marginTop: spacing.xs, fontWeight: '500' },
  });
}
