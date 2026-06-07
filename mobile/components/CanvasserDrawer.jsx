import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import Animated, { useAnimatedStyle, withTiming, Easing, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { signOut } from '../lib/authState';
import { loadRoleContext } from '../lib/role';
import {
  loadActiveCampaign,
  saveActiveCampaign,
  clearBootstrap,
  clearSelectedBooks,
  clearCurrentEffort,
  clearActiveOrgId,
} from '../lib/cache';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import { useDrawer } from '../lib/DrawerContext';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

const DRAWER_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

// A single tappable settings row — mirrors the admin "More" tab pattern so the
// drawer and that screen read the same. `last` drops the divider on the final
// row so it sits flush with the rounded card edge.
function Row({ icon, label, sub, onPress, danger, last }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      <Text style={styles.rowChevron}>›</Text>
    </Pressable>
  );
}

// The canvasser slide-out drawer: the home for occasional actions (stats,
// voters, appearance, org/account) so the per-screen headers can stay lean.
// Mounted once in (app)/_layout.jsx; opens by tap from the shared header.
// Renders nothing while closed, so the map underneath keeps every gesture.
export default function CanvasserDrawer() {
  const { isOpen, closeDrawer, progress } = useDrawer();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(360, width * 0.86);

  const [user, setUser] = useState(null);
  const [ctx, setCtx] = useState({ isOrgAdmin: false, isSuperAdmin: false, memberships: [] });
  const [activeCampaign, setActiveCampaign] = useState(null);

  // Refresh the drawer's data every time it opens, so role / campaign / account
  // are always current (they can change between opens).
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    Promise.all([loadRoleContext(), loadActiveCampaign()]).then(([rc, c]) => {
      if (!mounted) return;
      setCtx(rc);
      setUser(rc.user);
      setActiveCampaign(c);
    });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -panelWidth * (1 - progress.value) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  // Swipe the open panel leftward to dismiss. Bound to the panel only (the map
  // is covered by the backdrop while open), so it never competes with Mapbox's
  // pan. activeOffsetX(-12) means only a left drag captures; vertical scrolls of
  // the body pass through to the ScrollView (failOffsetY).
  const pan = Gesture.Pan()
    .activeOffsetX(-12)
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      const next = 1 + e.translationX / panelWidth;
      progress.value = Math.max(0, Math.min(1, next));
    })
    .onEnd((e) => {
      if (progress.value < 0.5 || e.velocityX < -500) {
        runOnJS(closeDrawer)();
      } else {
        progress.value = withTiming(1, DRAWER_TIMING);
      }
    });

  if (!isOpen) return null;

  function go(path) {
    closeDrawer();
    router.push(path);
  }

  async function onSwitchOrg() {
    closeDrawer();
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/select-org');
  }

  async function onPlatformView() {
    closeDrawer();
    qc.clear();
    await clearActiveOrgId();
    await saveActiveCampaign(null);
    await clearBootstrap();
    router.replace('/(app)/super-admin');
  }

  function onAdminDashboard() {
    closeDrawer();
    router.replace('/(app)/admin');
  }

  async function onLogout() {
    closeDrawer();
    qc.clear();
    await signOut();
  }

  const canSwitchOrg = ctx.isSuperAdmin || (ctx.memberships?.length || 0) > 1;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} accessibilityLabel="Close menu" />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.panel, { width: panelWidth }, panelStyle]}>
          <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
            <View style={styles.panelHeader}>
              <Logo size={26} />
              <Pressable onPress={closeDrawer} hitSlop={10} style={styles.closeButton}>
                <Text style={styles.closeText}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.accountCard}>
                <Text style={styles.accountName}>
                  {(user?.firstName || '') + (user?.lastName ? ` ${user.lastName}` : '') || 'Account'}
                </Text>
                <Text style={styles.accountEmail}>{user?.email || ''}</Text>
              </View>

              {activeCampaign && (
                <>
                  <Text style={styles.sectionLabel}>Navigate</Text>
                  <View style={styles.group}>
                    <Row icon="📊" label="My stats" onPress={() => go('/(app)/stats')} />
                    <Row icon="👥" label="Voters" onPress={() => go('/(app)/voters')} last />
                  </View>
                </>
              )}

              <Text style={styles.sectionLabel}>Appearance</Text>
              <View style={styles.appearanceGroup}>
                <ThemeToggle />
              </View>

              <Text style={styles.sectionLabel}>Account</Text>
              <View style={styles.group}>
                {ctx.isSuperAdmin && (
                  <Row icon="🌐" label="Platform view" sub="All organizations" onPress={onPlatformView} />
                )}
                {ctx.isOrgAdmin && (
                  <Row icon="🛠" label="Admin dashboard" onPress={onAdminDashboard} />
                )}
                {canSwitchOrg && (
                  <Row icon="🔁" label="Switch organization" onPress={onSwitchOrg} />
                )}
                <Row icon="↩︎" label="Sign out" onPress={onLogout} danger last />
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: t.colors.backdrop },
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: t.colors.bg,
      borderRightWidth: 1,
      borderRightColor: t.colors.border,
      ...t.shadow.raised,
    },
    panelHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.colors.card,
      borderWidth: 1,
      borderColor: t.colors.border,
    },
    closeText: { fontSize: 15, color: t.colors.textSecondary, fontWeight: '700' },

    accountCard: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      marginTop: spacing.xs,
      marginBottom: spacing.lg,
    },
    accountName: { ...t.type.h3 },
    accountEmail: { ...t.type.caption, marginTop: 2 },

    sectionLabel: { ...t.type.micro, marginBottom: spacing.sm, marginLeft: spacing.xs },
    group: {
      backgroundColor: t.colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: t.colors.border,
      ...t.shadow.card,
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    appearanceGroup: { marginBottom: spacing.lg },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      gap: spacing.md,
    },
    rowLast: { borderBottomWidth: 0 },
    rowIcon: { fontSize: 18, width: 24, textAlign: 'center' },
    rowLabel: { ...t.type.bodyStrong, fontSize: 15 },
    rowSub: { ...t.type.caption, marginTop: 1 },
    rowChevron: { fontSize: 20, color: t.colors.textMuted },
  });
}
