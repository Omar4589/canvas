import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import Logo from './Logo';
import HamburgerIcon from './icons/HamburgerIcon';
import { useDrawer } from '../lib/DrawerContext';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

// The shared canvasser header. One component, two variants:
//   variant="solid"    — for the card screens (select-org, campaigns): logo +
//                        wordmark on the screen background.
//   variant="floating" — for the full-bleed map screens (books, map): a
//                        translucent chrome bar; rendered inside the screen's own
//                        SafeAreaView map overlay, so it adds no inset itself.
// Left is always the hamburger (opens the drawer). Right holds only the quick
// actions a screen passes in — Refresh, Switch campaign, an offline-pending
// badge — everything else lives in the drawer. `children` renders extra
// right-side controls (e.g. a screen-specific chip) before Switch campaign.
export default function CanvasserHeader({
  variant = 'solid',
  onRefresh,
  refreshing = false,
  onSwitchCampaign,
  pendingCount = 0,
  children,
}) {
  const { openDrawer } = useDrawer();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const floating = variant === 'floating';

  return (
    <View style={[styles.header, floating ? styles.headerFloating : styles.headerSolid]}>
      <View style={styles.left}>
        <Pressable onPress={openDrawer} hitSlop={10} style={styles.menuButton} accessibilityLabel="Open menu">
          <HamburgerIcon size={22} color={colors.textPrimary} />
        </Pressable>
        <Logo size={floating ? 24 : 26} hideText={floating} />
      </View>

      <View style={styles.right}>
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
          </View>
        )}
        {onRefresh && (
          <Pressable onPress={onRefresh} hitSlop={8} disabled={refreshing} style={styles.iconButton}>
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Text style={styles.iconButtonText}>↻</Text>
            )}
          </Pressable>
        )}
        {children}
        {onSwitchCampaign && (
          <Pressable onPress={onSwitchCampaign} hitSlop={8}>
            <Text style={styles.switch}>Switch campaign</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function makeStyles(t) {
  const { colors } = t;
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerFloating: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.chromeBar,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerSolid: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    left: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    menuButton: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    right: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    switch: { color: colors.brand, fontWeight: '600', fontSize: 14 },
    pendingBadge: {
      backgroundColor: colors.warnBg,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
    },
    pendingBadgeText: { color: colors.warnFg, fontWeight: '700', fontSize: 12 },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    iconButtonText: { color: colors.textPrimary, fontSize: 18, fontWeight: '600' },
  });
}
