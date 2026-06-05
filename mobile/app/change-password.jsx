import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { api } from '../lib/api';
import { useAuthToken } from '../lib/authState';
import { saveCurrentUser, saveMemberships } from '../lib/cache';
import Logo from '../components/Logo';
import PasswordInput from '../components/PasswordInput';
import { colors, radius, spacing, type, shadow } from '../lib/theme';

// Forced "set a new password" step after an admin issues a temporary password.
// The server 403s every other route until the flag clears, so a reset canvasser
// lands here.
export default function ChangePassword() {
  const token = useAuthToken();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!token) return <Redirect href="/login" />;

  async function onSubmit() {
    setError(null);
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      if (res.user) await saveCurrentUser(res.user);
      await saveMemberships(res.memberships || []);
      router.replace('/');
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
          <Text style={styles.tagline}>
            For security, set a new password before continuing.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Current (temporary) password</Text>
          <PasswordInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            autoComplete="current-password"
            placeholder="••••••••"
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>
            New password (min 8 chars)
          </Text>
          <PasswordInput
            value={newPassword}
            onChangeText={setNewPassword}
            autoComplete="new-password"
            placeholder="••••••••"
          />

          <Text style={[styles.label, { marginTop: spacing.md }]}>
            Confirm new password
          </Text>
          <PasswordInput
            value={confirm}
            onChangeText={setConfirm}
            autoComplete="new-password"
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
              <Text style={styles.buttonText}>Set new password</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  brandBlock: { alignItems: 'center', marginBottom: spacing.xxl },
  tagline: { ...type.caption, marginTop: spacing.sm, textAlign: 'center' },
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
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerBg,
  },
  errorText: { color: colors.danger, fontSize: 14 },
  button: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
});
