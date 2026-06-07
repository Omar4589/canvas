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
// Left = logo + "Doorline", plus an optional Refresh button. Right = an optional
// Switch campaign link, then the hamburger (always, far right — it opens the
// right-side drawer). Everything else lives in the drawer. `children` renders
// extra right-side controls before Switch campaign.
export default function CanvasserHeader({
  variant = 'solid',
  onRefresh,
  refreshing = false,
  onSwitchCampaign,
  children,
}) {
  const { openDrawer } = useDrawer();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const floating = variant === 'floating';

  return (
    <View style={[styles.header, floating ? styles.headerFloating : styles.headerSolid]}>
      <View style={styles.left}>
        <Logo size={floating ? 24 : 26} />
        {onRefresh && (
          <Pressable onPress={onRefresh} hitSlop={8} disabled={refreshing} style={styles.iconButton}>
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.brand} />
            ) : (
              <Text style={styles.iconButtonText}>↻</Text>
            )}
          </Pressable>
        )}
      </View>

      <View style={styles.right}>
        {children}
        {onSwitchCampaign && (
          <Pressable onPress={onSwitchCampaign} hitSlop={8}>
            <Text style={styles.switch}>Switch campaign</Text>
          </Pressable>
        )}
        <Pressable onPress={openDrawer} hitSlop={10} style={styles.menuButton} accessibilityLabel="Open menu">
          <HamburgerIcon size={22} color={colors.textPrimary} />
        </Pressable>
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
