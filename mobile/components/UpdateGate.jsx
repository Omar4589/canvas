import { useState } from 'react';
import { View, Text, Pressable, Linking, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Updates from 'expo-updates';
import { api } from '../lib/api';
import { STORE_URL } from '../lib/config';
import Logo from './Logo';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/useThemedStyles';

// Tells people on a superseded NATIVE BUILD to update from the store. This is the one update
// case an OTA can never fix: under the fingerprint runtimeVersion policy, a superseded binary
// silently stops receiving updates — EAS gives it the same "no update" answer a current build
// gets — so without this surface, those phones would just drift out of date forever.
//
// The server is the sole authority (GET /build-status, public, env-driven — see
// server/src/routes/public/buildStatus.js). This component sends the binary's runtimeVersion
// and draws whatever comes back:
//   · soft → a dismissible top banner (dismissal lasts the session; it returns next launch);
//   · hard → a full-screen wall ABOVE the navigator, not a route — there is nothing to
//     navigate around, and no redirect loop is possible.
//
// Mounted once in app/_layout.jsx as a sibling of the root <Stack>, so it covers the login
// screen and the whole logged-in app alike.
//
// FAILS OPEN, ALWAYS: no runtimeVersion (dev), fetch error, timeout, 429, or a malformed
// response all render nothing. A wrong wall would lock the whole fleet out of a working app,
// which is strictly worse than a missed nag. The related contract gate (CLIENT_API_VERSION vs
// minClientApiVersion in index.jsx) stays separate: that one is about the JS bundle and is
// OTA-fixable; this one is about the binary and is not.
export default function UpdateGate() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);
  const [dismissed, setDismissed] = useState(false);

  // The BINARY's runtimeVersion — constant per install, unaffected by OTAs. Absent in
  // plain `expo start`, which is one of the fail-open paths.
  const runtimeVersion = Updates.runtimeVersion || '';

  const { data, refetch } = useQuery({
    queryKey: ['build-status', runtimeVersion],
    queryFn: () =>
      api(
        `/build-status?platform=${Platform.OS}&runtimeVersion=${encodeURIComponent(runtimeVersion)}`
      ),
    enabled: !!runtimeVersion,
    staleTime: 60 * 1000,
    // Re-ask a few times a day so a flip reaches long-running sessions; the global
    // focusManager wiring pauses this while the app is backgrounded.
    refetchInterval: 4 * 60 * 60 * 1000,
  });

  if (!data || data.status !== 'outdated') return null;

  async function openStore() {
    try {
      // Server override first: during the TestFlight-only era the public App Store page
      // doesn't exist yet, so the server can point iOS at TestFlight instead.
      await Linking.openURL(data.storeUrl || STORE_URL);
    } catch {
      // No store app — nothing more we can do here.
    }
  }

  if (data.mode === 'hard') {
    return (
      <View style={styles.wall}>
        <View style={styles.wallBody}>
          <View style={styles.brandBlock}>
            <Logo size={44} />
          </View>
          <View style={styles.card}>
            <Text style={styles.title}>Update Doorline</Text>
            <Text style={styles.subtitle}>
              {data.note ||
                'A newer version of the app is required. Please update from the store to keep going.'}
            </Text>
            <Pressable
              onPress={openStore}
              style={({ pressed }) => [styles.button, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.buttonText}>Get the update</Text>
            </Pressable>
            {/* Ops escape valve: if the gate was raised by mistake, a corrected server
                answers "ok" here without waiting out the refetch interval. */}
            <Pressable onPress={() => refetch()} hitSlop={8} style={styles.recheckWrap}>
              <Text style={styles.recheck}>I've updated — check again</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (dismissed) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
      <View style={styles.banner}>
        <Text style={styles.text}>
          {data.note || 'A new version of Doorline is available.'}
        </Text>
        <Pressable
          onPress={openStore}
          hitSlop={8}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.actionText}>Update</Text>
        </Pressable>
        <Pressable
          onPress={() => setDismissed(true)}
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Text style={styles.dismissText}>Later</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    // Hard wall — an opaque absolute fill above the navigator. Default pointerEvents
    // swallow every touch, so nothing beneath is reachable.
    wall: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bg,
      zIndex: 1000,
      elevation: 1000,
    },
    wallBody: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
    brandBlock: { alignItems: 'center', marginBottom: spacing.xxl },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    title: { ...type.title, textAlign: 'center' },
    subtitle: {
      ...type.caption,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.lg,
    },
    button: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
    },
    buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    recheckWrap: { alignItems: 'center', marginTop: spacing.lg },
    recheck: { color: colors.brand, fontWeight: '600', fontSize: 14 },

    // Soft banner — same shell as AddedToOrgBanner so the two nags read as one family.
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingHorizontal: spacing.md,
      zIndex: 1000,
      elevation: 1000,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      backgroundColor: colors.brandTint,
      borderWidth: 1,
      borderColor: colors.brand,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      ...shadow.card,
    },
    text: { ...type.caption, color: colors.brandDark, flex: 1 },
    action: {
      backgroundColor: colors.brand,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    actionText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
    dismiss: {
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
    },
    dismissText: { ...type.caption, color: colors.brand, fontWeight: '700' },
  });
}
