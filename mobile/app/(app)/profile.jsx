import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { api } from '../../lib/api';
import { buildLine } from '../../lib/buildInfo';
import { rotateToken } from '../../lib/authState';
import { loadCurrentUser, saveCurrentUser, saveMemberships } from '../../lib/cache';
import PasswordInput from '../../components/PasswordInput';
import PasswordRequirements from '../../components/PasswordRequirements';
import DeleteAccountSheet from '../../components/DeleteAccountSheet';
import { isStrongPassword, passwordProblem } from '../../lib/validators';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

// Self-service profile: edit name + phone (email is read-only, admin-managed) and
// change password inline. Reachable from the canvasser drawer's account card and
// the admin "More" tab. Both sections call requireAuth-only endpoints, so this
// works regardless of active org.
export default function ProfileScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [user, setUser] = useState(null);

  // Profile-info form.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // Password form.
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwSaved, setPwSaved] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  // Staging builds only: a long-press on the build line shows the error-recovery test rows.
  const [testsOpen, setTestsOpen] = useState(false);

  useEffect(() => {
    loadCurrentUser().then((u) => {
      if (!u) return;
      setUser(u);
      setFirstName(u.firstName || '');
      setLastName(u.lastName || '');
      setPhone(u.phone || '');
    });
  }, []);

  const dirty =
    !!user &&
    (firstName.trim() !== (user.firstName || '') ||
      lastName.trim() !== (user.lastName || '') ||
      phone.trim() !== (user.phone || ''));

  async function onSaveProfile() {
    setProfileError(null);
    setProfileSaved(false);
    if (!firstName.trim() || !lastName.trim()) {
      setProfileError('First and last name are required.');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await api('/auth/me', {
        method: 'PATCH',
        body: { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() },
      });
      if (res.user) {
        await saveCurrentUser(res.user);
        setUser(res.user);
      }
      if (res.memberships) await saveMemberships(res.memberships);
      setProfileSaved(true);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword() {
    setPwError(null);
    setPwSaved(false);
    if (!isStrongPassword(newPassword)) {
      setPwError(passwordProblem(newPassword));
      return;
    }
    if (newPassword !== confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    setSavingPw(true);
    try {
      // The change revokes every session issued before it — including this device's token.
      // rotateToken adopts the fresh one under the session lock, so the map's next poll can't
      // 401 into a sign-out seconds after the user successfully changed their own password
      // (lib/sessionStore.js). Only the bare api() call goes inside.
      const res = await rotateToken(() =>
        api('/auth/change-password', {
          method: 'POST',
          body: { currentPassword, newPassword },
        })
      );
      if (res.user) await saveCurrentUser(res.user);
      if (res.memberships) await saveMemberships(res.memberships);
      // Anything that left with the old token while the change was in flight failed with a 401
      // that is not retried: run it again with the new one.
      qc.invalidateQueries({ predicate: (q) => q.state.status === 'error' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setPwSaved(true);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setSavingPw(false);
    }
  }

  const pwIncomplete = !currentPassword || !newPassword || !confirm;

  // Which JS bundle is actually running — so "is my latest fix live?" is a glance,
  // not a guess. `embedded` = the build's baked-in bundle; otherwise it's the OTA
  // update id + when it was published. Shared with the error screens (lib/buildInfo.js).
  const buildInfo = buildLine(Updates);

  // The error-recovery test rows (docs/PROPOSAL_ERROR_RECOVERY.md §B11) exist only on the staging
  // channel (TestFlight and Play internal). On a store build the long-press isn't attached and the
  // component is never loaded — required here, inside the staging branch, not imported at the top.
  const staging = Updates.channel === 'staging';
  const ErrorRecoveryTests =
    staging && testsOpen ? require('../../components/ErrorRecoveryTests').default : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.headerSide}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerSide} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>Your info</Text>
          <View style={styles.card}>
            <Text style={styles.label}>First name</Text>
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={(t) => {
                setFirstName(t);
                setProfileSaved(false);
              }}
              placeholder="First name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>Last name</Text>
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={(t) => {
                setLastName(t);
                setProfileSaved(false);
              }}
              placeholder="Last name"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>Phone</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                setProfileSaved(false);
              }}
              placeholder="Optional"
              placeholderTextColor={colors.textMuted}
              keyboardType="phone-pad"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>Email</Text>
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>{user?.email || ''}</Text>
            </View>
            <Text style={styles.hint}>Email is managed by your admin.</Text>

            {profileError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{profileError}</Text>
              </View>
            )}
            {profileSaved && (
              <View style={styles.successBox}>
                <Text style={styles.successText}>Profile updated.</Text>
              </View>
            )}

            <Pressable
              disabled={savingProfile || !dirty}
              onPress={onSaveProfile}
              style={({ pressed }) => [
                styles.button,
                (savingProfile || !dirty) && styles.buttonDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              {savingProfile ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.buttonText}>Save changes</Text>
              )}
            </Pressable>
          </View>

          <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Password</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Current password</Text>
            <PasswordInput
              value={currentPassword}
              onChangeText={(t) => {
                setCurrentPassword(t);
                setPwSaved(false);
              }}
              autoComplete="current-password"
              placeholder="••••••••"
            />

            <Text style={[styles.label, { marginTop: spacing.md }]}>New password</Text>
            <PasswordInput
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPwSaved(false);
              }}
              autoComplete="new-password"
              placeholder="••••••••"
            />
            <PasswordRequirements password={newPassword} />

            <Text style={[styles.label, { marginTop: spacing.md }]}>Confirm new password</Text>
            <PasswordInput
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                setPwSaved(false);
              }}
              autoComplete="new-password"
              placeholder="••••••••"
            />

            {pwError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{pwError}</Text>
              </View>
            )}
            {pwSaved && (
              <View style={styles.successBox}>
                <Text style={styles.successText}>Password changed.</Text>
              </View>
            )}

            <Pressable
              disabled={savingPw || pwIncomplete}
              onPress={onChangePassword}
              style={({ pressed }) => [
                styles.button,
                (savingPw || pwIncomplete) && styles.buttonDisabled,
                pressed && { opacity: 0.85 },
              ]}
            >
              {savingPw ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.buttonText}>Change password</Text>
              )}
            </Pressable>
          </View>

          {/* Required by App Store 5.1.1(v) and Play's account-deletion policy — both demand a
              self-serve path inside the app, and both reject "ask your admin" as a substitute.
              The sheet syncs any unsent doors and checks with the server before it offers the
              button, so nobody deletes their way into losing field work or bricking their org. */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>Delete account</Text>
          <View style={styles.card}>
            <Text style={styles.hint}>
              Permanently delete your login and personal details. This can’t be undone.
            </Text>
            <Pressable
              onPress={() => setDeleteOpen(true)}
              style={({ pressed }) => [styles.dangerButton, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.dangerButtonText}>Delete my account</Text>
            </Pressable>
          </View>

          {staging ? (
            <Text style={styles.buildStamp} onLongPress={() => setTestsOpen((open) => !open)}>
              {buildInfo}
            </Text>
          ) : (
            <Text style={styles.buildStamp}>{buildInfo}</Text>
          )}
          {ErrorRecoveryTests ? <ErrorRecoveryTests /> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <DeleteAccountSheet visible={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    headerSide: { width: 64 },
    back: { color: colors.brand, fontWeight: '700', fontSize: 16 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },

    sectionLabel: { ...type.micro, marginBottom: spacing.sm, marginLeft: spacing.xs },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
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
    readonlyField: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      backgroundColor: colors.sunken,
    },
    readonlyText: { fontSize: 16, color: colors.textSecondary },
    hint: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs },

    errorBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.dangerBg },
    errorText: { color: colors.danger, fontSize: 14 },
    successBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successBg },
    successText: { color: colors.success, fontSize: 14, fontWeight: '600' },

    button: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },

    // Outlined, not filled: destructive but not the thing we're steering anyone toward.
    dangerButton: {
      borderWidth: 1,
      borderColor: colors.danger,
      borderRadius: radius.md,
      paddingVertical: spacing.md + 2,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    dangerButtonText: { color: colors.danger, fontWeight: '700', fontSize: 16 },

    buildStamp: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  });
}
