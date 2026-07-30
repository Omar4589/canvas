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
  loadActiveOrgName,
  saveActiveCampaign,
  clearBootstrap,
  clearSelectedBooks,
  clearCurrentEffort,
  clearActiveOrgId,
} from '../lib/cache';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import InsetGroup, { InsetNavRow, InsetActionRow, RowEmoji } from './InsetGroup';
import SectionHeader from './SectionHeader';
import { useDrawer } from '../lib/DrawerContext';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { radius, spacing } from '../lib/theme';

const DRAWER_TIMING = { duration: 240, easing: Easing.out(Easing.cubic) };

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
  const [ctx, setCtx] = useState({
    isOrgAdmin: false,
    isLead: false,
    isConsoleUser: false,
    isSuperAdmin: false,
    memberships: [],
  });
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [orgName, setOrgName] = useState(null);

  // Refresh the drawer's data every time it opens, so role / campaign / account
  // are always current (they can change between opens).
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    Promise.all([loadRoleContext(), loadActiveCampaign(), loadActiveOrgName()]).then(([rc, c, on]) => {
      if (!mounted) return;
      setCtx(rc);
      setUser(rc.user);
      setActiveCampaign(c);
      // Prefer the org name cached at selection (covers super admins, who enter
      // orgs they aren't members of); fall back to the membership's name.
      setOrgName(on || rc.activeMembership?.organizationName || null);
    });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panelWidth * (1 - progress.value) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  // Swipe the open (right-side) panel rightward to dismiss. Bound to the panel
  // only (the map is covered by the backdrop while open), so it never competes
  // with Mapbox's pan. activeOffsetX(12) means only a right drag captures;
  // vertical scrolls of the body pass through to the ScrollView (failOffsetY).
  const pan = Gesture.Pan()
    .activeOffsetX(12)
    .failOffsetY([-16, 16])
    .onUpdate((e) => {
      const next = 1 - e.translationX / panelWidth;
      progress.value = Math.max(0, Math.min(1, next));
    })
    .onEnd((e) => {
      if (progress.value < 0.5 || e.velocityX > 500) {
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
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

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
              {/* The org name was a brand micro-line INSIDE the old account card; it is a caption,
                  so the shared caption slot holds it and the row keeps one job. */}
              {orgName ? <SectionHeader caption title={orgName} /> : <View style={{ marginTop: spacing.xs }} />}
              <InsetGroup>
                <InsetNavRow
                  emphasis="hero"
                  label={fullName || user?.email || 'Your account'}
                  sub={fullName ? user?.email : null}
                  hint="Opens your profile"
                  onPress={() => go('/(app)/profile')}
                />
              </InsetGroup>

              <SectionHeader caption title="Navigate" />
              <InsetGroup>
                {/* Voter lookup intentionally omitted for canvassers — they work
                    the doors assigned to them and see each household's voters at
                    the door. Voter search remains an admin-only tool. */}
                {activeCampaign && (
                  <InsetNavRow emphasis="menu" leading={<RowEmoji>📊</RowEmoji>} label="My stats" onPress={() => go('/(app)/stats')} />
                )}
                <InsetNavRow emphasis="menu" leading={<RowEmoji>❓</RowEmoji>} label="Help center" sub="Guides, FAQ & tips" onPress={() => go('/(app)/help')} />
              </InsetGroup>

              <SectionHeader caption title="Appearance" />
              <View style={styles.appearanceWrap}>
                <ThemeToggle />
              </View>

              <SectionHeader caption title="Account" />
              <InsetGroup>
                {ctx.isSuperAdmin && (
                  <InsetNavRow emphasis="menu" leading={<RowEmoji>🌐</RowEmoji>} label="Platform view" sub="All organizations" onPress={onPlatformView} />
                )}
                {/* isConsoleUser, NOT isOrgAdmin — a team lead reaches the admin tab too
                    (admin/_layout.jsx admits them). Gating on isOrgAdmin hid this row from
                    leads, so a lead who tapped "Switch to canvass mode" was stuck in the
                    canvasser flow until they restarted the app. */}
                {ctx.isConsoleUser && (
                  <InsetNavRow emphasis="menu" leading={<RowEmoji>🛠</RowEmoji>} label="Admin dashboard" onPress={onAdminDashboard} />
                )}
                {canSwitchOrg && (
                  <InsetNavRow emphasis="menu" leading={<RowEmoji>🔁</RowEmoji>} label="Switch organization" onPress={onSwitchOrg} />
                )}
                <InsetActionRow tone="danger" leading={<RowEmoji>↩︎</RowEmoji>} label="Sign out" onPress={onLogout} />
              </InsetGroup>
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
      right: 0,
      backgroundColor: t.colors.bg,
      borderLeftWidth: 1,
      borderLeftColor: t.colors.border,
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

    // The card, hairlines, row typography and the account row all come from InsetGroup now — the
    // local Row (and its 14 styles) was a verbatim fork of the admin More's, which is exactly how
    // the two drifted apart. `rowLast` went with it: InsetGroup interleaves separators BETWEEN
    // children, so a trailing hairline is structurally impossible.
    appearanceWrap: { marginBottom: spacing.lg },
  });
}
