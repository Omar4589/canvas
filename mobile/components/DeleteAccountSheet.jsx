import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../lib/api';
import { flushQueue, getPendingCount } from '../lib/offlineQueue';
import { signOut } from '../lib/authState';
import PasswordInput from './PasswordInput';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// Self-serve account deletion. Required by App Store guideline 5.1.1(v) and Google Play's
// account-deletion policy — both are triggered because this app can CREATE accounts (the
// admin "add canvasser" forms), and both explicitly refuse "email your admin" as a substitute.
//
// Three things have to happen before the button is even offered:
//
//  1. FLUSH THE OFFLINE QUEUE. offlineQueue drops any 4xx so a bad submission can't wedge the
//     queue forever — which means that the moment the account dies, every unsynced knock 401s
//     and is silently thrown away. That is real, billable field work. So we flush first and
//     refuse to delete while anything is still pending.
//  2. ASK THE SERVER WHAT WOULD BREAK. A sole admin deleting themselves would brick their org;
//     a sole bill-payer would drive it read-only when the subscription lapsed. The server owns
//     those rules (services/users/deleteAccount.js) — we just render them.
//  3. SAY WHAT SURVIVES. Both stores require the user be told what is retained and why. The
//     copy comes from the server so the app, the web deletion page and the privacy policy can
//     never drift apart.
export default function DeleteAccountSheet({ visible, onClose }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Android's system nav bar overlaps bottom sheets without this inset (item D8).
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [check, setCheck] = useState(null);
  const [pending, setPending] = useState(0);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setChecking(true);
      setError(null);
      setPassword('');
      try {
        // Get their work off the device before anything else — see (1) above.
        await flushQueue().catch(() => {});
        const stillPending = await getPendingCount();
        const res = await api('/auth/account/deletion-check');
        if (cancelled) return;
        setPending(stillPending);
        setCheck(res);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  async function onDelete() {
    setError(null);
    setDeleting(true);
    try {
      await api('/auth/account', { method: 'DELETE', body: { currentPassword: password } });
      // The token is dead server-side the moment this returns (requireAuth refuses a deleted
      // user on every request), so drop the local session rather than leaving a zombie one.
      await signOut();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  }

  const blockers = check?.blockers || [];
  const hasUnsynced = pending > 0;
  const canDelete = !!check?.canDelete && !hasUnsynced;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Delete your account</Text>

            {checking ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.brand} />
                <Text style={styles.loadingText}>Syncing your work…</Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingBottom: spacing.md }}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={styles.body}>
                  This permanently deletes your login and your personal details — your name,
                  email and phone number. It can’t be undone, and an admin can’t bring it back.
                </Text>

                {check?.retained?.summary ? (
                  <View style={styles.noteBox}>
                    <Text style={styles.noteTitle}>What stays with your organization</Text>
                    <Text style={styles.noteText}>{check.retained.summary}</Text>
                  </View>
                ) : null}

                {hasUnsynced && (
                  <View style={styles.blockBox}>
                    <Text style={styles.blockTitle}>
                      {pending} {pending === 1 ? 'door hasn’t' : 'doors haven’t'} synced yet
                    </Text>
                    <Text style={styles.blockText}>
                      Get back online so your work reaches your campaign. If you delete now it
                      would be lost.
                    </Text>
                  </View>
                )}

                {blockers.map((b) => (
                  <View key={b.code} style={styles.blockBox}>
                    <Text style={styles.blockText}>{b.message}</Text>
                  </View>
                ))}

                {canDelete && (
                  <View style={{ marginTop: spacing.lg }}>
                    <Text style={styles.label}>Confirm your password</Text>
                    <PasswordInput
                      value={password}
                      onChangeText={setPassword}
                      autoComplete="current-password"
                      placeholder="••••••••"
                    />
                  </View>
                )}

                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.actions}>
              <Pressable
                onPress={onClose}
                disabled={deleting}
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.secondaryText}>Keep my account</Text>
              </Pressable>

              {!checking && canDelete && (
                <Pressable
                  onPress={onDelete}
                  disabled={deleting || !password}
                  style={({ pressed }) => [
                    styles.danger,
                    (deleting || !password) && styles.disabled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {deleting ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={styles.dangerText}>Delete account</Text>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheetWrap: { justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: spacing.md,
    },
    title: { ...type.h3, marginBottom: spacing.sm },
    body: { ...type.body, color: colors.textSecondary },

    loading: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
    loadingText: { ...type.caption, color: colors.textMuted },

    noteBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.sunken,
    },
    noteTitle: { ...type.caption, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
    noteText: { ...type.caption, color: colors.textSecondary },

    blockBox: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.dangerBg,
    },
    blockTitle: { ...type.caption, fontWeight: '700', color: colors.danger, marginBottom: spacing.xs },
    blockText: { ...type.caption, color: colors.danger },

    label: { ...type.caption, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.xs },

    errorBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
    errorText: { color: colors.danger, fontSize: 14 },

    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
    },
    secondaryText: { color: colors.textPrimary, fontWeight: '700', fontSize: 16 },
    danger: {
      flex: 1,
      backgroundColor: colors.danger,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
    },
    dangerText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
    disabled: { opacity: 0.5 },
  });
}
