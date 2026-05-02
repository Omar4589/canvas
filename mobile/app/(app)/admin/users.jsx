import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import PasswordInput from '../../../components/PasswordInput';
import { loadCurrentUser } from '../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function UserCard({ user, onPress }) {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.userCard, pressed && { opacity: 0.85 }]}
    >
      <View
        style={[
          styles.userAvatar,
          user.role === 'admin' && { backgroundColor: colors.brandTint },
        ]}
      >
        <Text
          style={[
            styles.userAvatarText,
            user.role === 'admin' && { color: colors.brand },
          ]}
        >
          {initials(name) || '?'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.userName}>{name || user.email}</Text>
        <Text style={styles.userEmail} numberOfLines={1}>
          {user.email}
        </Text>
        <View style={styles.userPills}>
          <View
            style={[
              styles.pill,
              user.role === 'admin' ? styles.pillBrand : styles.pillNeutral,
            ]}
          >
            <Text
              style={[
                styles.pillText,
                user.role === 'admin' ? { color: colors.brand } : { color: colors.textSecondary },
              ]}
            >
              {user.role}
            </Text>
          </View>
          <View
            style={[
              styles.pill,
              user.isActive ? styles.pillSuccess : styles.pillDanger,
            ]}
          >
            <Text
              style={[
                styles.pillText,
                user.isActive ? { color: colors.success } : { color: colors.danger },
              ]}
            >
              {user.isActive ? 'active' : 'inactive'}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function AdminUsers() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [actionUser, setActionUser] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setCurrentUser(u));
  }, []);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api('/admin/users'),
  });

  const createUser = useMutation({
    mutationFn: (body) => api('/admin/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setShowCreate(false);
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, action }) =>
      api(`/admin/users/${id}/${action}`, { method: 'PATCH' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setActionUser(null);
    },
  });

  const resetPasswordM = useMutation({
    mutationFn: ({ id, password }) =>
      api(`/admin/users/${id}/password`, { method: 'PATCH', body: { password } }),
    onSuccess: () => {
      Alert.alert('Password reset', 'The user can now sign in with the new password.');
      setResetUser(null);
      setResetPwd('');
    },
    onError: (err) => {
      Alert.alert('Failed', err.message || 'Could not reset password.');
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }) =>
      api(`/admin/users/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setActionUser(null);
      Alert.alert(
        'Role updated',
        vars.role === 'admin' ? 'User is now an admin.' : 'User is now a canvasser.'
      );
    },
    onError: (err) => {
      Alert.alert('Failed', err.message || 'Could not update role.');
    },
  });

  const users = useMemo(() => usersQ.data?.users || [], [usersQ.data]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Users</Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
          <Text style={styles.headerAction}>+ New</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {usersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          users.map((u) => (
            <UserCard key={u.id} user={u} onPress={() => setActionUser(u)} />
          ))
        )}
      </ScrollView>

      {/* Action sheet */}
      <Modal
        transparent
        visible={!!actionUser}
        animationType="fade"
        onRequestClose={() => setActionUser(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setActionUser(null)}>
          <Pressable style={styles.actionSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.actionSheetTitle}>{actionUser?.email}</Text>
            <Pressable
              style={styles.actionItem}
              onPress={() => {
                setResetUser(actionUser);
                setActionUser(null);
              }}
            >
              <Text style={styles.actionItemText}>Reset password</Text>
            </Pressable>
            {actionUser && currentUser?.id !== actionUser.id && (
              <Pressable
                style={styles.actionItem}
                onPress={() => {
                  const nextRole = actionUser.role === 'admin' ? 'user' : 'admin';
                  const verb =
                    nextRole === 'admin' ? 'Make admin' : 'Demote to canvasser';
                  Alert.alert(
                    verb,
                    `Are you sure you want to change ${actionUser.email}?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Confirm',
                        onPress: () =>
                          updateRole.mutate({ id: actionUser.id, role: nextRole }),
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.actionItemText}>
                  {actionUser.role === 'admin' ? 'Make canvasser' : 'Make admin'}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={styles.actionItem}
              onPress={() =>
                toggleActive.mutate({
                  id: actionUser.id,
                  action: actionUser.isActive ? 'deactivate' : 'reactivate',
                })
              }
            >
              <Text
                style={[
                  styles.actionItemText,
                  { color: actionUser?.isActive ? colors.danger : colors.success },
                ]}
              >
                {actionUser?.isActive ? 'Deactivate' : 'Reactivate'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.actionItem, styles.actionCancel]}
              onPress={() => setActionUser(null)}
            >
              <Text style={[styles.actionItemText, { fontWeight: '600' }]}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create user modal */}
      <Modal
        transparent
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setShowCreate(false)}>
            <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
              <CreateUserForm
                onSubmit={(form) => createUser.mutate(form)}
                onCancel={() => setShowCreate(false)}
                submitting={createUser.isPending}
                error={createUser.error}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Reset password modal */}
      <Modal
        transparent
        visible={!!resetUser}
        animationType="slide"
        onRequestClose={() => setResetUser(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setResetUser(null)}>
            <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.formTitle}>Reset password</Text>
              <Text style={styles.formSubtitle}>{resetUser?.email}</Text>
              <Text style={styles.formLabel}>New password (min 8 chars)</Text>
              <PasswordInput
                value={resetPwd}
                onChangeText={setResetPwd}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <View style={styles.formButtons}>
                <Pressable
                  onPress={() => setResetUser(null)}
                  style={[styles.formBtn, styles.formBtnSecondary]}
                >
                  <Text style={styles.formBtnSecondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    resetPasswordM.mutate({ id: resetUser.id, password: resetPwd })
                  }
                  disabled={resetPwd.length < 8 || resetPasswordM.isPending}
                  style={[
                    styles.formBtn,
                    styles.formBtnPrimary,
                    {
                      opacity:
                        resetPwd.length < 8 || resetPasswordM.isPending ? 0.5 : 1,
                    },
                  ]}
                >
                  {resetPasswordM.isPending ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={styles.formBtnPrimaryText}>Save</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function CreateUserForm({ onSubmit, onCancel, submitting, error }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');

  const valid =
    firstName.trim() && lastName.trim() && email.trim() && password.length >= 8;

  return (
    <View>
      <Text style={styles.formTitle}>New user</Text>

      <Text style={styles.formLabel}>First name</Text>
      <TextInput
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        placeholder="Jane"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Last name</Text>
      <TextInput
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        placeholder="Doe"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="jane@example.com"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Password (min 8 chars)</Text>
      <PasswordInput
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        placeholder="••••••••"
      />

      <Text style={styles.formLabel}>Role</Text>
      <View style={styles.roleRow}>
        {[
          { v: 'user', l: 'Canvasser' },
          { v: 'admin', l: 'Admin' },
        ].map((opt) => {
          const active = role === opt.v;
          return (
            <Pressable
              key={opt.v}
              onPress={() => setRole(opt.v)}
              style={[styles.roleOption, active && styles.roleOptionActive]}
            >
              <Text
                style={[
                  styles.roleOptionText,
                  active && styles.roleOptionTextActive,
                ]}
              >
                {opt.l}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}

      <View style={styles.formButtons}>
        <Pressable onPress={onCancel} style={[styles.formBtn, styles.formBtnSecondary]}>
          <Text style={styles.formBtnSecondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            onSubmit({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              password,
              role,
            })
          }
          disabled={!valid || submitting}
          style={[
            styles.formBtn,
            styles.formBtnPrimary,
            { opacity: valid && !submitting ? 1 : 0.5 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.formBtnPrimaryText}>Create</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },
  headerTitle: { ...type.h3 },
  headerAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  userCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 14,
  },
  userName: { ...type.bodyStrong, fontSize: 15 },
  userEmail: { ...type.caption, marginTop: 1 },
  userPills: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillBrand: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  pillNeutral: { backgroundColor: colors.bg, borderColor: colors.border },
  pillSuccess: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  pillDanger: { backgroundColor: colors.dangerBg, borderColor: '#FCA5A5' },
  pillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  chevron: { fontSize: 24, color: colors.textMuted },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  actionSheetTitle: {
    ...type.caption,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItem: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItemText: {
    color: colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  actionCancel: { borderBottomWidth: 0, marginTop: spacing.xs },

  formSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  formTitle: { ...type.h2, fontSize: 18, marginBottom: 4 },
  formSubtitle: { ...type.caption, marginBottom: spacing.md },
  formLabel: {
    ...type.caption,
    color: colors.textPrimary,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleOption: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  roleOptionActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  roleOptionText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
  roleOptionTextActive: { color: colors.brand, fontWeight: '700' },

  errorBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: { color: colors.danger, fontSize: 14 },

  formButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  formBtn: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  formBtnPrimary: { backgroundColor: colors.brand },
  formBtnPrimaryText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  formBtnSecondary: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formBtnSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
});
