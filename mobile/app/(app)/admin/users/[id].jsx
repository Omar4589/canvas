import { useEffect, useRef, useState } from 'react';
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
import { formatDate, formatRelative as sharedFormatRelative } from '../../../../lib/dates';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../../../../lib/validators';
import PasswordInput from '../../../../components/PasswordInput';
import { radius, spacing, ACTION_LABELS } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useConsoleRole } from '../../../../lib/useConsoleRole';
import { useThemedStyles } from '../../../../lib/useThemedStyles';


function initials(first, last) {
  return ((first?.[0] || '') + (last?.[0] || '')).toUpperCase() || '?';
}

// Shared helpers (lib/dates); this surface's 7-day relative→absolute cutoff is deliberate UX.
const formatRelative = (d) => sharedFormatRelative(d, { cutoffDays: 7 });

function metersToMiles(m) {
  return ((m || 0) * 0.000621371).toFixed(1);
}

function StatCell({ label, value }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function AdminUserDetail() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACTION_DOT_COLOR = {
    survey_submitted: colors.status.surveyed,
    not_home: colors.status.not_home,
    wrong_address: colors.status.wrong_address,
    refused: colors.status.refused,
    restricted: colors.status.restricted,
    lit_dropped: colors.status.lit_dropped,
  };
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  // Lead capabilities on this page: read + temp password + deactivate for CANVASSER
  // targets on their campaigns (server-enforced). Identity/role editing and campaign
  // assignment stay admin-only, so those sections don't render for a lead at all.
  const viewerRole = useConsoleRole();
  const isAdminViewer = viewerRole !== 'lead';


  const [currentUser, setCurrentUser] = useState(null);
  useEffect(() => {
    loadCurrentUser().then((u) => setCurrentUser(u));
  }, []);

  const usersQ = useQuery({
    queryKey: ['admin', 'memberships'],
    queryFn: () => api('/admin/memberships'),
  });

  const member = (usersQ.data?.members || []).find((m) => m.user.id === userId);
  const user = member
    ? {
        ...member.user,
        role: member.role,
        isActive: member.isActive && member.user.isActive,
        addedAt: member.addedAt,
      }
    : null;
  const isSelf = currentUser?.id === userId;
  // Login email is shared across every org this user belongs to — lock it for
  // multi-org users (only the user or a super-admin may change it). Mirrors web.
  const emailLocked = !!user?.isMultiOrg && !currentUser?.isSuperAdmin && !isSelf;

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'canvasser',
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role || 'canvasser',
    });
  }, [user?.id, user?.firstName, user?.lastName, user?.email, user?.phone, user?.role]);

  // Team-lead campaign grants. Lives in CampaignManager server-side; GET
  // /admin/memberships back-joins it as managedCampaignIds. Sent with the role
  // PATCH exactly like the web's UserProfileModal.
  const managedFromServer = (member?.managedCampaignIds || []).map(String);
  const [managedIds, setManagedIds] = useState(() => new Set());
  useEffect(() => {
    setManagedIds(new Set(managedFromServer));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, managedFromServer.join(',')]);

  const [showResetPw, setShowResetPw] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [feedback, setFeedback] = useState(null);

  const flashTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);
  function flash(type, text) {
    setFeedback({ type, text });
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFeedback(null), 4000);
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const statsQ = useQuery({
    queryKey: ['admin', 'membership-stats', userId, tz],
    queryFn: () =>
      api(`/admin/memberships/${userId}/stats?tz=${encodeURIComponent(tz)}`),
    enabled: !!userId,
  });

  const activityQ = useQuery({
    queryKey: ['admin', 'membership-recent-activity', userId],
    queryFn: () => api(`/admin/memberships/${userId}/recent-activity?limit=20`),
    enabled: !!userId,
  });

  const saveProfile = useMutation({
    mutationFn: (body) =>
      api(`/admin/memberships/${userId}/user`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
      flash('success', 'Profile updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const saveRole = useMutation({
    // Leads carry their campaign grants with the role; any other role clears
    // all grants server-side (memberships.js reconciliation).
    mutationFn: ({ role, managedCampaignIds }) =>
      api(`/admin/memberships/${userId}`, {
        method: 'PATCH',
        body: role === 'lead' ? { role, managedCampaignIds } : { role },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
      flash('success', 'Role updated.');
    },
    onError: (err) => flash('error', err.message),
  });

  const resetPw = useMutation({
    mutationFn: (password) =>
      api(`/admin/memberships/${userId}/password`, {
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

  // Re-send the set-password invite. Offered only to someone who has never signed in — the invite
  // is sent once at account creation and the temp password beside it expires after 72h.
  const resendInvite = useMutation({
    mutationFn: () => api(`/admin/memberships/${userId}/resend-invite`, { method: 'POST' }),
    onSuccess: (res) =>
      flash(
        res?.sent ? 'success' : 'error',
        res?.sent
          ? `Invite sent. The link works for ${res.expiresInHours} hours.`
          : 'Could not send the invite \u2014 check the mail settings.'
      ),
    onError: (err) => flash('error', err.message),
  });

  const toggleActive = useMutation({
    mutationFn: () =>
      api(
        `/admin/memberships/${userId}/${user?.isActive ? 'deactivate' : 'reactivate'}`,
        { method: 'PATCH' }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
      flash('success', user?.isActive ? 'Membership deactivated.' : 'Membership reactivated.');
    },
    onError: (err) => flash('error', err.message),
  });

  // Campaign roster membership — assign this person to campaigns from their own profile.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const userCampaignsQ = useQuery({
    queryKey: ['admin', 'membership-campaigns', userId],
    queryFn: () => api(`/admin/memberships/${userId}/campaigns`),
    enabled: !!userId,
  });
  const assignCampaign = useMutation({
    mutationFn: (campaignId) =>
      api(`/admin/campaigns/${campaignId}/assignments`, { method: 'POST', body: { userIds: [userId] } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'membership-campaigns', userId] });
      flash('success', 'Added to campaign.');
    },
    onError: (err) => flash('error', err.message),
  });
  const unassignCampaign = useMutation({
    mutationFn: (campaignId) =>
      api(`/admin/campaigns/${campaignId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'membership-campaigns', userId] });
      flash('success', 'Removed from campaign.');
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

  const isProfileDirty =
    form.firstName !== (user.firstName || '') ||
    form.lastName !== (user.lastName || '') ||
    (!emailLocked && form.email !== (user.email || '')) ||
    form.phone !== (user.phone || '');
  const managedDirty =
    form.role === 'lead' &&
    [...managedIds].sort().join(',') !== [...managedFromServer].sort().join(',');
  const isRoleDirty = form.role !== (user.role || 'canvasser') || managedDirty;
  const isDirty = isProfileDirty || isRoleDirty;

  function onSave() {
    if (!isDirty) return;
    if (isProfileDirty) {
      const body = {};
      if (form.firstName !== user.firstName) body.firstName = form.firstName;
      if (form.lastName !== user.lastName) body.lastName = form.lastName;
      if (!emailLocked && form.email !== user.email) body.email = form.email;
      if (form.phone !== (user.phone || '')) body.phone = form.phone;
      saveProfile.mutate(body);
    }
    if (isRoleDirty) {
      saveRole.mutate({ role: form.role, managedCampaignIds: [...managedIds] });
    }
  }

  function onResetPw() {
    const problem = tempPasswordProblem(newPassword);
    if (problem) {
      flash('error', problem);
      return;
    }
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
                  user.role === 'admin'
                    ? styles.pillBrand
                    : user.role === 'lead'
                      ? styles.pillLead
                      : styles.pillNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    user.role === 'admin'
                      ? { color: colors.brand }
                      : user.role === 'lead'
                        ? { color: colors.accentPurple }
                        : { color: colors.textSecondary },
                  ]}
                >
                  {user.role === 'lead' ? 'team lead' : user.role === 'admin' ? 'admin' : 'canvasser'}
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
              Last login {formatRelative(user.lastLoginAt)}
            </Text>
          </View>

          {/* Profile form — identity + role editing is admin-only. */}
          {isAdminViewer && (
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
              editable={!emailLocked}
              style={[
                styles.textInput,
                emailLocked && { backgroundColor: colors.bg, color: colors.textMuted },
              ]}
            />
            {emailLocked && (
              <Text
                style={{
                  ...type.caption,
                  color: colors.textMuted,
                  marginTop: spacing.xs,
                  fontStyle: 'italic',
                }}
              >
                This user belongs to multiple organizations; their login email can
                only be changed by the user or a super-admin.
              </Text>
            )}

            <Text style={styles.formLabel}>
              Phone <Text style={{ color: colors.textMuted }}>(optional)</Text>
            </Text>
            <TextInput
              value={form.phone}
              onChangeText={(v) => setForm((f) => ({ ...f, phone: formatUsPhoneInput(v) }))}
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
                  { v: 'canvasser', l: 'Canvasser' },
                  { v: 'lead', l: 'Team lead' },
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

            {/* Team-lead campaign grants — a lead acts as an admin ONLY inside
                the campaigns checked here (docs/ROLES.md). Saved with the role. */}
            {!isSelf && form.role === 'lead' && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.formLabel}>Managed campaigns</Text>
                <Text
                  style={{
                    ...type.caption,
                    color: colors.textMuted,
                    marginBottom: spacing.xs,
                  }}
                >
                  A team lead can run only the campaigns checked below.
                </Text>
                {(campaignsQ.data?.campaigns || [])
                  .filter((c) => c.isActive)
                  .map((c) => {
                    const id = String(c._id);
                    const on = managedIds.has(id);
                    return (
                      <Pressable
                        key={id}
                        onPress={() =>
                          setManagedIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(id)) next.delete(id);
                            else next.add(id);
                            return next;
                          })
                        }
                        style={styles.leadCampaignRow}
                      >
                        <View style={[styles.leadCheck, on && styles.leadCheckOn]}>
                          {on ? <Text style={styles.leadCheckMark}>✓</Text> : null}
                        </View>
                        <Text style={styles.leadCampaignName} numberOfLines={1}>
                          {c.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                {form.role === 'lead' && managedIds.size === 0 && (
                  <Text style={{ ...type.caption, color: colors.warn, marginTop: spacing.xs }}>
                    No campaigns checked — this lead won&apos;t be able to manage anything yet.
                  </Text>
                )}
              </View>
            )}

            <Pressable
              onPress={onSave}
              disabled={!isDirty || saveProfile.isPending || saveRole.isPending}
              style={[
                styles.saveBtn,
                {
                  opacity:
                    isDirty && !saveProfile.isPending && !saveRole.isPending ? 1 : 0.5,
                },
              ]}
            >
              {saveProfile.isPending || saveRole.isPending ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={styles.saveBtnText}>Save changes</Text>
              )}
            </Pressable>
          </View>
          )}

          {/* Password — right under the profile/role section for quick access.
              A lead may set one only for canvasser accounts (their crew). */}
          {(isAdminViewer || user.role === 'canvasser') && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Password</Text>
            <Pressable
              onPress={() => setShowResetPw((s) => !s)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {showResetPw ? 'Cancel' : 'Set temporary password'}
              </Text>
            </Pressable>

            {/* Never-signed-in only \u2014 lastLoginAt is written in exactly one place, so null is
                unambiguous, and a resend kills any link they already hold. */}
            {!user.lastLoginAt && (
              <Pressable
                onPress={() =>
                  Alert.alert(
                    'Resend invite?',
                    `Email ${user.email} a new set-password link.\n\nThis replaces any earlier invite or reset link \u2014 if they still have one, it will stop working.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Send', onPress: () => resendInvite.mutate() },
                    ]
                  )
                }
                disabled={resendInvite.isPending}
                style={styles.secondaryBtn}
              >
                <Text style={styles.secondaryBtnText}>
                  {resendInvite.isPending ? 'Sending\u2026' : 'Resend invite'}
                </Text>
              </Pressable>
            )}

            {showResetPw && (
              <View style={styles.resetPwBox}>
                <Text style={styles.formLabel}>Temporary password (min 8 chars)</Text>
                <Text
                  style={{
                    ...type.caption,
                    color: colors.textMuted,
                    marginBottom: spacing.sm,
                  }}
                >
                  The user will be required to choose a new password the next time
                  they log in.
                </Text>
                <PasswordInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <Pressable
                  onPress={onResetPw}
                  disabled={!isValidTempPassword(newPassword) || resetPw.isPending}
                  style={[
                    styles.saveBtn,
                    {
                      marginTop: spacing.md,
                      opacity:
                        isValidTempPassword(newPassword) && !resetPw.isPending ? 1 : 0.5,
                    },
                  ]}
                >
                  {resetPw.isPending ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={styles.saveBtnText}>Set password</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
          )}

          {/* Campaigns — assign from the profile. Admin-only: a lead's creations are
              auto-assigned, and leads never (un)assign (owner decision, item A5-C). */}
          {isAdminViewer && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Campaigns</Text>
            {campaignsQ.isLoading || userCampaignsQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.sm }} />
            ) : (
              (() => {
                const assigned = new Set(userCampaignsQ.data?.campaignIds || []);
                const campaigns = (campaignsQ.data?.campaigns || []).filter((c) => c.isActive);
                if (campaigns.length === 0) {
                  return <Text style={styles.campaignEmpty}>No active campaigns.</Text>;
                }
                const pendingId = assignCampaign.isPending
                  ? assignCampaign.variables
                  : unassignCampaign.isPending
                    ? unassignCampaign.variables
                    : null;
                return campaigns.map((c) => {
                  const cid = String(c._id);
                  const on = assigned.has(cid);
                  const busy = pendingId === cid;
                  return (
                    <View key={cid} style={styles.campaignRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.campaignName}>{c.name}</Text>
                        <Text style={styles.campaignMeta}>
                          {c.state}
                          {c.type === 'lit_drop' ? ' · Lit drop' : ' · Survey'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => (on ? unassignCampaign.mutate(cid) : assignCampaign.mutate(cid))}
                        disabled={busy}
                        style={[styles.campaignBtn, on ? styles.campaignBtnOn : styles.campaignBtnOff, busy && { opacity: 0.5 }]}
                      >
                        <Text style={[styles.campaignBtnText, on ? styles.campaignBtnTextOn : styles.campaignBtnTextOff]}>
                          {busy ? '…' : on ? 'Unassign' : 'Assign'}
                        </Text>
                      </Pressable>
                    </View>
                  );
                });
              })()
            )}
          </View>
          )}

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
                    label="Surveys taken"
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
                        {ACTION_LABELS[a.actionType] || a.actionType}
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

          {/* Account actions — deactivate/reactivate lives at the bottom (danger zone).
              A lead may switch only canvasser accounts (their crew); the server enforces
              the same boundary. */}
          {!isSelf && (isAdminViewer || user.role === 'canvasser') && (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Account</Text>
              <Pressable
                onPress={onToggleActive}
                disabled={toggleActive.isPending}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: user.isActive
                      ? colors.dangerBg
                      : colors.successBg,
                    borderColor: user.isActive
                      ? colors.dangerBorder
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
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Header({ onBack }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ Users</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
  campaignEmpty: { ...type.caption, color: colors.textSecondary },
  campaignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  campaignName: { ...type.bodyStrong, fontSize: 14 },
  campaignMeta: { ...type.caption, marginTop: 1 },
  campaignBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: 88,
    alignItems: 'center',
  },
  campaignBtnOn: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
  campaignBtnOff: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  campaignBtnText: { fontSize: 12, fontWeight: '700' },
  campaignBtnTextOn: { color: colors.danger },
  campaignBtnTextOff: { color: colors.brand },
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
  pillLead: { backgroundColor: colors.accentPurpleBg, borderColor: colors.accentPurple },
  pillNeutral: { backgroundColor: colors.bg, borderColor: colors.border },
  leadCampaignRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  leadCheck: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leadCheckOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  leadCheckMark: { color: colors.textInverse, fontSize: 12, fontWeight: '800' },
  leadCampaignName: { ...type.body, fontSize: 14, flex: 1 },
  pillSuccess: {
    backgroundColor: colors.successBg,
    borderColor: colors.successBorder,
  },
  pillDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  pillText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  });
}
