import { useEffect, useState } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { loadCurrentUser } from '../../../../lib/cache';
import PasswordInput from '../../../../components/PasswordInput';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const ACTION_DOT_COLOR = {
  survey_submitted: colors.status.surveyed,
  not_home: colors.status.not_home,
  wrong_address: colors.status.wrong_address,
  lit_dropped: colors.status.lit_dropped,
};

function initials(first, last) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?';
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRelative(d) {
  if (!d) return 'Never';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(d);
}

function metersToMiles(m) {
  return ((m || 0) * 0.000621371).toFixed(1);
}

function StatCell({ label, value }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AdminUserDetail() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;

  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => {
    loadCurrentUser().then((u) => setCurrentUser(u));
  }, []);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api('/admin/users'),
  });

  const user = (usersQ.data?.users || []).find((u) => u.id === userId);
  const isSelf = currentUser?.id === userId;

  // Form state — populated from user once loaded.
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'user',
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'user',
    });
  }, [user?.id, user?.firstName, user?.lastName, user?.email, user?.phone, user?.role]);

  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [feedback, setFeedback] = useState(null);

  function flash(type, text) {
    setFeedback({ type, text });
    setTimeout(() => setFeedback(null), 4000);
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const statsQ = useQuery({
    queryKey: ['admin', 'user-stats', userId, tz],
    queryFn: () =>
      api(`/admin/users/${userId}/stats?tz=${encodeURIComponent(tz)}`),
    enabled: !!userId,
  });

  const activityQ = useQuery({
    queryKey: ['admin', 'user-recent-activity', userId],
    queryFn: () => api(`/admin/users/${userId}/recent-activity?limit=20`),
    enabled: !!userId,
  });

  const saveProfile = useMutation({
    mutationFn: (body) =>
      api(`/admin/users/${userId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      flash('success', 'Profile updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const resetPw = useMutation({
    mutationFn: (password) =>
      api(`/admin/users/${userId}/password`, {
        method: 'PATCH',
        body: { password },
      }),
    onSuccess: () => {
      setShowResetPw(false);
      setNewPassword('');
      flash('success', 'Password reset.');
    },
    onError: (err) => flash('error', err.message),
  });

  const toggleActive = useMutation({
    mutationFn: () =>
      api(
        `/admin/users/${userId}/${user?.isActive ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      flash('success', user?.isActive ? 'Deactivated.' : 'Reactivated.');
    },
    onError: (err) => flash('error', err.message),
  });

  if (usersQ.isLoading || !currentUser) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.errorText}>User not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isDirty =
    form.firstName !== (user.firstName || '') ||
    form.lastName !== (user.lastName || '') ||
    form.email !== (user.email || '') ||
    form.phone !== (user.phone || '') ||
    form.role !== (user.role || 'user');

  function onSave() {
    if (!isDirty) return;
    const body = {};
    if (form.firstName !== user.firstName) body.firstName = form.firstName;
    if (form.lastName !== user.lastName) body.lastName = form.lastName;
    if (form.email !== user.email) body.email = form.email;
    if (form.phone !== (user.phone || '')) body.phone = form.phone;
    if (form.role !== user.role) body.role = form.role;
    saveProfile.mutate(body);
  }

  function onResetPw() {
    if (newPassword.length < 8) return;
    resetPw.mutate(newPassword);
  }

  function onToggleActive() {
    const verb = user.isActive ? 'Deactivate' : 'Reactivate';
    Alert.alert(`${verb} ${user.email}?`, '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: user.isActive ? 'destructive' : 'default',
        onPress: () => toggleActive.mutate(),
      },
    ]);
  }

  const stats = statsQ.data;
  const activities = activityQ.data?.activities || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {feedback && (
            <View
              style={[
                styles.feedback,
                feedback.type === 'success'
                  ? { backgroundColor: colors.successBg }
                  : { backgroundColor: colors.dangerBg },
              ]}
            >
              <Text
                style={{
                  color:
                    feedback.type === 'success' ? colors.success : colors.danger,
                  fontWeight: '600',
                }}
              >
                {feedback.text}
              </Text>
            </View>
          )}

          {/* Profile header card */}
          <View style={styles.headerCard}>
            <View
              style={[
                styles.avatar,
                user.role === 'admin' && { backgroundColor: colors.brandTint },
              ]}
            >
              <Text
                style={[
                  styles.avatarText,
                  user.role === 'admin' && { color: colors.brand },
                ]}
              >
                {initials(user.firstName, user.lastName)}
              </Text>
            </View>
            <Text style={styles.headerName}>
              {user.firstName} {user.lastName}
            </Text>
            <Text style={styles.headerEmail} numberOfLines={1}>
              {user.email}
            </Text>
            <View style={styles.headerBadges}>
              <View
                style={[
                  styles.pill,
                  user.role === 'admin' ? styles.pillBrand : styles.pillNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    user.role === 'admin'
                      ? { color: colors.brand }
                      : { color: colors.textSecondary },
                  ]}
                >
                  {user.role === 'admin' ? 'admin' : 'canvasser'}
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
                    user.isActive
                      ? { color: colors.success }
                      : { color: colors.danger },
                  ]}
                >
                  {user.isActive ? 'active' : 'inactive'}
                </Text>
              </View>
            </View>
            <Text style={styles.headerMeta}>
              Member since {formatDate(user.createdAt)}
            </Text>
            <Text style={styles.headerMeta}>
              Last seen {formatRelative(user.lastLoginAt)}
            </Text>
          </View>

          {/* Profile form */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Profile</Text>

            <Text style={styles.formLabel}>First name</Text>
            <TextInput
              value={form.firstName}
              onChangeText={(v) => setForm((f) => ({ ...f, firstName: v }))}
              autoCapitalize="words"
              style={styles.textInput}
            />

            <Text style={styles.formLabel}>Last name</Text>
            <TextInput
              value={form.lastName}
              onChangeText={(v) => setForm((f) => ({ ...f, lastName: v }))}
              autoCapitalize="words"
              style={styles.textInput}
            />

            <Text style={styles.formLabel}>Email</Text>
            <TextInput
              value={form.email}
              onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.textInput}
            />

            <Text style={styles.formLabel}>
              Phone <Text style={{ color: colors.textMuted }}>(optional)</Text>
            </Text>
            <TextInput
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
              keyboardType="phone-pad"
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.textMuted}
              style={styles.textInput}
            />

            <Text style={styles.formLabel}>Role</Text>
            {isSelf ? (
              <View style={styles.selfNote}>
                <Text style={styles.selfNoteText}>
                  You can&apos;t change your own role. Ask another admin.
                </Text>
              </View>
            ) : (
              <View style={styles.roleRow}>
                {[
                  { v: 'user', l: 'Canvasser' },
                  { v: 'admin', l: 'Admin' },
                ].map((opt) => {
                  const active = form.role === opt.v;
                  return (
                    <Pressable
                      key={opt.v}
                      onPress={() =>
                        setForm((f) => ({ ...f, role: opt.v }))
                      }
                      style={[
                        styles.roleOption,
                        active && styles.roleOptionActive,
                      ]}
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
            )}

            <Pressable
              onPress={onSave}
              disabled={!isDirty || saveProfile.isPending}
              style={[
                styles.saveBtn,
                {
                  opacity:
                    isDirty && !saveProfile.isPending ? 1 : 0.5,
                },
              ]}
            >
              {saveProfile.isPending ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.saveBtnText}>Save changes</Text>
              )}
            </Pressable>
          </View>

          {/* Lifetime stats */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Activity (lifetime)</Text>
            {statsQ.isLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : statsQ.error ? (
              <Text style={styles.errorText}>{statsQ.error.message}</Text>
            ) : stats ? (
              <>
                <View style={styles.statGrid}>
                  <StatCell
                    label="Doors knocked"
                    value={(stats.doorsKnocked ?? 0).toLocaleString()}
                  />
                  <StatCell
                    label="Surveys"
                    value={(stats.surveysSubmitted ?? 0).toLocaleString()}
                  />
                  <StatCell
                    label="Lit drops"
                    value={(stats.litDropped ?? 0).toLocaleString()}
                  />
                  <StatCell
                    label="Miles walked"
                    value={metersToMiles(stats.distanceMeters)}
                  />
                </View>
                <Text style={styles.statMeta}>
                  {stats.campaignsWorked || 0}{' '}
                  {stats.campaignsWorked === 1 ? 'campaign' : 'campaigns'} worked
                  {stats.lastActivityAt
                    ? ` · Last activity ${formatRelative(stats.lastActivityAt)}`
                    : ''}
                </Text>
              </>
            ) : null}
          </View>

          {/* Recent activity */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Recent activity</Text>
            {activityQ.isLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : activityQ.error ? (
              <Text style={styles.errorText}>{activityQ.error.message}</Text>
            ) : activities.length === 0 ? (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyText}>No activity yet.</Text>
              </View>
            ) : (
              <View style={styles.activityList}>
                {activities.map((a) => (
                  <View key={a.id} style={styles.activityRow}>
                    <View
                      style={[
                        styles.activityDot,
                        {
                          backgroundColor:
                            ACTION_DOT_COLOR[a.actionType] || colors.textMuted,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityAction}>
                        {ACTION_LABEL[a.actionType] || a.actionType}
                      </Text>
                      <Text style={styles.activitySub} numberOfLines={1}>
                        {a.household
                          ? `${a.household.addressLine1}${
                              a.household.city ? ', ' + a.household.city : ''
                            }`
                          : 'Address unavailable'}
                        {a.campaign?.name ? ` · ${a.campaign.name}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.activityTime}>
                      {formatRelative(a.timestamp)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Account actions */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Account</Text>
            <Pressable
              onPress={() => setShowResetPw((s) => !s)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {showResetPw ? 'Cancel reset' : 'Reset password'}
              </Text>
            </Pressable>

            {showResetPw && (
              <View style={styles.resetPwBox}>
                <Text style={styles.formLabel}>New password (min 8 chars)</Text>
                <PasswordInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <Pressable
                  onPress={onResetPw}
                  disabled={newPassword.length < 8 || resetPw.isPending}
                  style={[
                    styles.saveBtn,
                    {
                      marginTop: spacing.md,
                      opacity:
                        newPassword.length >= 8 && !resetPw.isPending ? 1 : 0.5,
                    },
                  ]}
                >
                  {resetPw.isPending ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={styles.saveBtnText}>Save password</Text>
                  )}
                </Pressable>
              </View>
            )}

            {!isSelf && (
              <Pressable
                onPress={onToggleActive}
                disabled={toggleActive.isPending}
                style={[
                  styles.secondaryBtn,
                  {
                    marginTop: spacing.sm,
                    backgroundColor: user.isActive
                      ? colors.dangerBg
                      : colors.successBg,
                    borderColor: user.isActive
                      ? '#FCA5A5'
                      : colors.successBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryBtnText,
                    {
                      color: user.isActive ? colors.danger : colors.success,
                    },
                  ]}
                >
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Users</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16 },

  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },

  feedback: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },

  headerCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadow.card,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 22,
  },
  headerName: { ...type.h2, fontSize: 20 },
  headerEmail: { ...type.caption, marginTop: 2 },
  headerBadges: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  headerMeta: {
    ...type.caption,
    fontSize: 12,
    marginTop: 2,
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow.card,
  },
  sectionLabel: {
    ...type.micro,
    marginBottom: spacing.md,
  },
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
    paddingVertical: spacing.md - 2,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },

  selfNote: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selfNoteText: { ...type.caption, fontStyle: 'italic' },

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

  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveBtnText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 15,
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
    columnGap: spacing.sm,
  },
  statCell: {
    width: '48%',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  statValue: {
    ...type.title,
    fontSize: 22,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { ...type.caption, marginTop: 1 },
  statMeta: {
    ...type.caption,
    fontSize: 12,
    marginTop: spacing.md,
  },

  activityList: { gap: spacing.sm },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  activityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  activityAction: { ...type.bodyStrong, fontSize: 14 },
  activitySub: { ...type.caption, fontSize: 12, marginTop: 1 },
  activityTime: {
    ...type.caption,
    fontSize: 11,
  },
  emptyInline: {
    padding: spacing.md,
    alignItems: 'center',
  },
  emptyText: {
    ...type.caption,
  },

  secondaryBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  resetPwBox: {
    marginTop: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
  },

  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },

  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillBrand: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  pillNeutral: { backgroundColor: colors.bg, borderColor: colors.border },
  pillSuccess: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  pillDanger: { backgroundColor: colors.dangerBg, borderColor: '#FCA5A5' },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
