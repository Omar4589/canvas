import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  ActivityIndicator,
  Linking,
  Alert,
  BackHandler,
  AccessibilityInfo,
  findNodeHandle,
  StyleSheet,
} from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { WEB_URL } from '../lib/config';
import {
  getCurrentToken,
  completeReauth,
  signOut,
  allowLater,
  collapseReauth,
  touchReauth,
} from '../lib/authState';
import { loadCurrentUser, saveCurrentUser, saveMemberships, saveServerMeta } from '../lib/cache';
import { flushQueue, getPendingCount } from '../lib/offlineQueue';
import { REAUTH_TITLE, reauthBody, pendingLine, notYouConfirm, isFieldScreen, tokenSub } from '../lib/sessionEnd';
import Logo from './Logo';
import PasswordInput from './PasswordInput';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The password, in place. Shown by SessionGate when a sign-in ran out (expired, unreadable, or the
// token went missing from storage) — the app does NOT sign out: the dead token stays, the screen
// underneath (the map, a list, unsaved work) stays mounted, the phone keeps its saved houses, and
// typing the password continues exactly where the person was. That is why nothing here says
// "signed out": the privacy policy promises the saved houses are deleted when you sign out, and
// this is not that.
//
// Opaque, so nothing behind it shows. Android Back is caught (this screen never shows in the door
// flow, but Back must not pop whatever is underneath unasked). After a sign-in attempt failed for
// lack of signal: on the field screens "Later" collapses this into a notice (ReauthNotice) so a
// canvasser in a dead zone can keep knocking — saves keep queueing on the 401 — and elsewhere
// "Go back" (and Back) leave the screen the drawer opened.
//
// See docs/PROPOSAL_SESSION_EXPIRY.md section D5.
const ReauthSheet = ({ reauth, path }) => {
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [noSignal, setNoSignal] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const titleRef = useRef(null);

  const changed = reauth.reason === 'password_changed';
  const laterOk = reauth.laterAllowed && !changed;
  // On the map, books and building screens Later collapses this into a notice. Anywhere else (a
  // screen the drawer opened, say) it means "back to where I can keep working": those screens need
  // the network, and staying behind this screen with no signal would be a trap.
  const canLater = laterOk && isFieldScreen(path);
  const canGoBack = laterOk && !isFieldScreen(path) && router.canGoBack();

  // The email the app already holds — editable, so autofill can pair the saved password and an
  // address an admin changed meanwhile can be corrected.
  useEffect(() => {
    let alive = true;
    loadCurrentUser().then((u) => {
      if (alive && u?.email) setEmail((cur) => cur || u.email);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    getPendingCount()
      .then((n) => {
        if (alive) setPendingCount(n);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reauth.reason]);

  // Screen readers start on the title, not on whatever was under the cover.
  useEffect(() => {
    const tag = findNodeHandle(titleRef.current);
    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }, []);

  // Android Back: collapse when "Later" is allowed; on a non-field screen after a failed attempt,
  // let the navigator go back (this screen never shows in the door flow, so nothing typed is under
  // it); otherwise do nothing. Registered last, so it runs before SurveyForm's own listener.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canLater) {
        touchReauth();
        collapseReauth();
        return true;
      }
      if (canGoBack) touchReauth();
      return !canGoBack;
    });
    return () => sub.remove();
  }, [canLater, canGoBack]);

  const goBack = () => {
    touchReauth();
    if (router.canGoBack()) router.back();
  };

  // Ends a session this screen created but can't use, so it never lingers unstored.
  const discard = (token) => api('/auth/logout', { method: 'POST', token, quiet: true }).catch(() => {});

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    touchReauth();
    const sent = getCurrentToken();
    let res;
    try {
      res = await api('/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
        quiet: true,
      });
    } catch (err) {
      if (!err?.status) {
        setNoSignal(true);
        allowLater();
        setError("Couldn't reach Doorline. Check your signal.");
      } else {
        setError(err.message);
      }
      setLoading(false);
      return;
    }
    let adopted = false;
    try {
      // Who this phone was signed in as: the cached user, or failing that the account id inside
      // the expired token itself.
      const cached = await loadCurrentUser();
      const expectedId = cached?.id ? String(cached.id) : tokenSub(sent);
      if (!expectedId) {
        discard(res.token);
        setError("Couldn't confirm which account this phone belongs to. Try again.");
        setLoading(false);
        return;
      }
      if (expectedId !== String(res.user?.id)) {
        // A different account. Never continue the last person's screen as someone else: end the
        // session just created, and sign this phone out — after the same confirm as "Not you?"
        // when work is waiting.
        discard(res.token);
        const signOutNow = () => signOut();
        if (pendingCount > 0) {
          Alert.alert('Sign out?', notYouConfirm({ pending: pendingCount }), [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: signOutNow },
          ]);
        } else {
          signOutNow();
        }
        setLoading(false);
        return;
      }
      adopted = await completeReauth(sent, res.token);
      if (!adopted) {
        // Signed out (or someone else signed in) while this was in flight.
        discard(res.token);
        setLoading(false);
        return;
      }
    } catch {
      // The sign-in worked but this phone couldn't store it (secure storage failed).
      if (!adopted) discard(res.token);
      setError("Signed in, but this phone couldn't save it. Try again.");
      setLoading(false);
      return;
    }
    // The session is back. Refreshing the cached identity is best-effort: a storage hiccup here must
    // never throw away the session the phone now holds (the next /auth/me re-saves it anyway).
    try {
      if (res.user) await saveCurrentUser(res.user);
      await saveMemberships(res.memberships || []);
      await saveServerMeta({ minClientApiVersion: res.minClientApiVersion ?? 1 });
    } catch {
      // keep going
    }
    // Only what failed while the password was pending — never the multi-MB walk list the map
    // already holds.
    qc.invalidateQueries({ predicate: (q) => q.state.status === 'error' });
    flushQueue().catch(() => {});
    if (res.user?.mustChangePassword && path !== '/change-password') router.replace('/change-password');
    setLoading(false);
  };

  const onNotYou = () => {
    if (pendingCount === 0 && !noSignal) {
      signOut();
      return;
    }
    // Cancel first: Android shows the buttons in this order.
    Alert.alert('Sign out?', notYouConfirm({ pending: pendingCount, noSignal }), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
    ]);
  };

  const line = pendingLine(pendingCount, reauth.reason);

  return (
    <KeyboardAvoidingView
      style={styles.cover}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      accessibilityViewIsModal
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.brandBlock}>
          <Logo size={44} />
        </View>
        <View style={styles.card}>
          <Text ref={titleRef} style={styles.title} accessibilityRole="header">
            {REAUTH_TITLE}
          </Text>
          <Text style={styles.subtitle}>{reauthBody(reauth.reason)}</Text>

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
          {line && <Text style={styles.pending}>{line}</Text>}

          <Pressable
            disabled={loading || !password}
            onPress={onSubmit}
            style={({ pressed }) => [styles.button, { opacity: loading || !password || pressed ? 0.85 : 1 }]}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
          {canLater && (
            <Pressable
              onPress={() => {
                touchReauth();
                collapseReauth();
              }}
              style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Later</Text>
            </Pressable>
          )}
          {canGoBack && (
            <Pressable
              onPress={goBack}
              style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Go back</Text>
            </Pressable>
          )}

          <View style={styles.links}>
            <Pressable
              onPress={() => {
                // The reset window runs from here: coming back with the new password within half an
                // hour keeps this screen (and the phone's houses) in place.
                touchReauth();
                Linking.openURL(`${WEB_URL}/forgot-password`).catch(() => {});
              }}
              hitSlop={8}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
            <Pressable onPress={onNotYou} hitSlop={8}>
              <Text style={styles.linkMuted}>Not you? Sign out</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

export default ReauthSheet;

const makeStyles = (t) => {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    // Opaque, above the navigator, below UpdateGate's hard wall (same layer, rendered earlier).
    cover: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bg,
      zIndex: 1000,
      elevation: 1000,
    },
    body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.xl },
    brandBlock: { alignItems: 'center', marginBottom: spacing.xl },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    title: { ...type.title, fontSize: 20, marginBottom: spacing.sm },
    subtitle: { ...type.caption, marginBottom: spacing.lg },
    label: { ...type.caption, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },
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
    errorBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
    // dangerFg on dangerBg: raw `danger` is too light for small text on its own tint.
    errorText: { color: colors.dangerFg, fontSize: 14 },
    pending: { ...type.caption, marginTop: spacing.md },
    button: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    secondary: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    secondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
    links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg },
    link: { color: colors.brand, fontWeight: '600', fontSize: 14 },
    linkMuted: { color: colors.textSecondary, fontSize: 14 },
  });
};
