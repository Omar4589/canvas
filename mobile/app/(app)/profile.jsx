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
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Updates from 'expo-updates';
import { api } from '../../lib/api';
import { loadCurrentUser, saveCurrentUser, saveMemberships } from '../../lib/cache';
import PasswordInput from '../../components/PasswordInput';
import { radius, spacing } from '../../lib/theme';
import { useTheme } from '../../lib/ThemeContext';
import { useThemedStyles } from '../../lib/useThemedStyles';

// Self-service profile: edit name + phone (email is read-only, admin-managed) and
// change password inline. Reachable from the canvasser drawer's account card and
// the admin "More" tab. Both sections call requireAuth-only endpoints, so this
// works regardless of active org.
export default function ProfileScreen() {
  const router = useRouter();
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
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    setSavingPw(true);
    try {
      const res = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      if (res.user) await saveCurrentUser(res.user);
      if (res.memberships) await saveMemberships(res.memberships);
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
  // update id + when it was published. (Constants from expo-updates; safe to read.)
  const buildInfo = (() => {
    const rt = Updates.runtimeVersion || '—';
    const channel = Updates.channel ? ` · ${Updates.channel}` : '';
    if (Updates.isEmbeddedLaunch || !Updates.updateId) return `v${rt}${channel} · embedded build`;
    const id = Updates.updateId.slice(0, 8);
    const when = Updates.createdAt ? ` · ${new Date(Updates.createdAt).toLocaleString()}` : '';
    return `v${rt}${channel} · update ${id}${when}`;
  })();

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

            <Text style={[styles.label, { marginTop: spacing.md }]}>New password (min 8 chars)</Text>
            <PasswordInput
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setPwSaved(false);
              }}
              autoComplete="new-password"
              placeholder="••••••••"
            />

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

          <Text style={styles.buildStamp}>{buildInfo}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
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

    buildStamp: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  });
}
