import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
  StyleSheet,
} from 'react-native';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { WEB_URL } from '../lib/config';
import { signIn, useAuthToken, getSessionState } from '../lib/authState';
import { flushQueue, clearNotices } from '../lib/offlineQueue';
import { signedOutNote } from '../lib/sessionEnd';
import { QueueLines } from '../components/NotSaved';
import {
  saveCurrentUser,
  saveMemberships,
  saveActiveOrgId,
  clearActiveOrgId,
  clearActiveCampaign,
  saveServerMeta,
} from '../lib/cache';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

export default function Login() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Why the last deliberate sign-out happened (password changed elsewhere, account deleted), held
  // in memory until the next sign-in — see lib/sessionStore.js. Read once: it can't change while
  // this screen is up.
  const [notice] = useState(() => getSessionState().notice);
  const [email, setEmail] = useState(() => notice?.email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (token) return <Redirect href="/" />;

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      if (res.user) {
        await saveCurrentUser(res.user);
      }
      // Cache the server's min supported client version so the routing layer can
      // gate a too-old bundle on every launch, not just right after login.
      await saveServerMeta({ minClientApiVersion: res.minClientApiVersion ?? 1 });
      const memberships = res.memberships || [];
      await saveMemberships(memberships);
      await clearActiveOrgId();
      await clearActiveCampaign();
      if (memberships.length === 1 && !res.user?.isSuperAdmin) {
        await saveActiveOrgId(memberships[0].organizationId);
      }
      // Nothing cached by the last session may paint under this one. Cleared here, at sign-in,
      // rather than when the last session ended: clearing while its screens were still mounted
      // made them refetch, and the cache-only door screens flashed "Household not found". The
      // store-update check is the one exception: it belongs to the phone, not the session, and
      // UpdateGate (mounted above this screen) would blink its banner off and fetch it again.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'build-status' });
      qc.getMutationCache().clear();
      await signIn(res.token);
      // The lines owed to the next person (a deleted account's saves removed, saves that waited 30 days)
      // were on this screen; they're read.
      clearNotices().catch(() => {});
      // Knocks held through an auth outage (queue survives sign-out) drain on re-auth itself,
      // not only when a map screen happens to mount — an admin who signs back in to check
      // dashboards must not leave field work parked all day. Fire-and-forget; each queued
      // item flushes under the org it was recorded in (its pinned orgId), so the cleared
      // active org above doesn't matter.
      flushQueue();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <View style={styles.brandBlock}>
          <Logo size={44} />
          <Text style={styles.tagline}>Door-to-door canvassing made easy.</Text>
        </View>

        <View style={styles.card}>
          {notice && (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>{signedOutNote(notice.reason)}</Text>
            </View>
          )}
          {/* Saves on this phone and whose they are (components/NotSaved.jsx): they upload only when
              the person who recorded them signs in here, so anyone may sign in over them. Shown with
              or without a note — and the lines owed after a removal (a deleted account's saves,
              someone's that waited 30 days) until the next sign-in. */}
          <QueueLines style={styles.queueLines} />
          <Text style={styles.label}>Email address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>Password</Text>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            autoComplete="current-password"
            placeholder="••••••••"
          />

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            disabled={loading}
            onPress={onSubmit}
            style={({ pressed }) => [
              styles.button,
              { opacity: loading || pressed ? 0.85 : 1 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          {/* Reset is a browser-only flow (token links land on the web). Open it in the
              system browser rather than rebuild the form natively. */}
          <Pressable
            onPress={() => Linking.openURL(`${WEB_URL}/forgot-password`).catch(() => {})}
            hitSlop={8}
            style={styles.forgotWrap}
          >
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  tagline: {
    ...type.caption,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  label: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    backgroundColor: colors.card,
    color: colors.textPrimary,
  },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  // The deliberate-sign-out note: info tint, readable info text (infoFg on infoBg is 7.15:1).
  noteBox: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoBg,
  },
  noteText: { color: colors.infoFg, fontSize: 14 },
  // Saves waiting on this phone (QueueLines): above the email box, under the note when there is one.
  queueLines: { marginBottom: spacing.lg },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 16,
  },
  forgotWrap: { alignItems: 'center', marginTop: spacing.lg },
  forgot: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  });
}
