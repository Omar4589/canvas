import { useCallback, useEffect, useRef, useState } from 'react';
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
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { loadCurrentUser, loadMemberships, loadActiveOrgId } from '../../../../lib/cache';
import { formatDate, formatRelative as sharedFormatRelative } from '../../../../lib/dates';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../../../../lib/validators';
import {
  DELETED_ACCOUNT_LABEL,
  accountDeletedText,
  goneNotice,
  displayName,
  deleteAccountBlurb,
  deletionLine,
  mayOfferDelete,
  mayOfferRemove,
  removeConfirm,
  touchedByDeletion,
  viewerHasBillingAccess,
} from '../../../../lib/memberDeletion';
import { leaveDeletionNotice } from '../../../../lib/deletionNotice';
import { usePausedList, invalidatePaceCaches } from '../../../../lib/pacePauses';
import { pausedUserIds } from '../../../../lib/pace';
import { standing } from '../../../../lib/rosterView';
import { isAdminRole, personAccess, personButtons, recentLimit, nextRecentSkip, recentRows } from '../../../../lib/personActions';
import { formatInTz } from '../../../../lib/datetime';
import PasswordInput from '../../../../components/PasswordInput';
import DeleteMemberSheet from '../../../../components/DeleteMemberSheet';
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

// The tab navigator keeps ONE instance of this screen and hands it the next person's id (users/[id] is a
// Tabs.Screen, admin/_layout.jsx), so everything held per person — a half-typed temporary password, More
// options, the frozen view a deletion leaves behind — would carry over to whoever is opened next. Keyed
// on the id, each person gets a fresh screen.
const AdminUserDetail = () => {
  const { id } = useLocalSearchParams();
  return <AdminUserProfile key={String(Array.isArray(id) ? id[0] : id)} />;
};
export default AdminUserDetail;

function AdminUserProfile() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const ACTION_DOT_COLOR = {
    survey_submitted: colors.status.surveyed,
    not_home: colors.status.not_home,
    wrong_address: colors.status.wrong_address,
    refused: colors.status.refused,
    restricted: colors.status.restricted,
    no_soliciting: colors.status.no_soliciting,
    not_target: colors.status.not_target,
    lit_dropped: colors.status.lit_dropped,
  };
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams();
  const userId = Array.isArray(id) ? id[0] : id;
  // Lead capabilities on this page: read, and for CANVASSER targets on their campaigns the
  // identity fields, temp password, invite and deactivate (server-enforced). Role editing and
  // the Campaigns list stay admin-only, so those sections don't render for a lead at all, and a
  // lead's totals cover only the campaigns they manage (item 40).
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
  // Paused for review (automatic pause, docs/PROPOSAL_PACE_PAUSE.md §G.4): this person's open pause, from the
  // same list the GPS audit shows — or, for a team lead, the roster line saying they're paused on a campaign the
  // lead doesn't manage.
  const pausedQ = usePausedList();
  const pausedHere = (pausedQ.data?.pauses || []).find((p) => String(p.userId) === String(userId) && p.status === 'paused' && p.blocking);
  const pausedElsewhere = (pausedQ.data?.rosterLines || []).some((l) => String(l.userId) === String(userId) && l.paused);
  const pausedIds = pausedUserIds(pausedQ.data);

  // Set once this person's account is deleted, or they are removed from the org, from here: the
  // screen pops at once and, until it is gone, keeps drawing them as they were. The refetched list no longer holds an unused account
  // ("User not found") and turns a used one into a deleted row; neither should flash on the way out.
  const frozenMemberRef = useRef(null);
  // One confirm at a time, and the screen leaves once: a double tap could otherwise stack two Remove
  // confirms on Android, and a second success would pop a second screen, past the Users list.
  const removeAskingRef = useRef(false);
  const leftRef = useRef(false);
  const member =
    frozenMemberRef.current || (usersQ.data?.members || []).find((m) => m.user.id === userId);
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
  // PATCH exactly like the web person panel's profile form (client/src/components/people/PersonProfileForm.jsx).
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

  // The newest 5 doors, then 10 per Show more. Written inline, with a literal path, rather than through
  // lib/useInfinitePaged: that helper builds its URL inside itself, which hides the endpoint from
  // `npm run audit:mobile-api`, and it expects a `total` this route doesn't send. So Show more stops on
  // a page that comes back short or adds no new ids (lib/personActions.js nextRecentSkip).
  const activityQ = useInfiniteQuery({
    queryKey: ['admin', 'membership-recent-activity', userId, 'paged'],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api(`/admin/memberships/${userId}/recent-activity?limit=${recentLimit(pageParam)}&skip=${pageParam}`, { signal }),
    getNextPageParam: (_lastPage, allPages) => nextRecentSkip(allPages),
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
          : 'Could not send the invite — check the mail settings.'
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

  // Remove from org (DELETE /admin/memberships/:userId) — the web's action, on the phone too. Every
  // cache it touches is refreshed here, so even if the screen is gone by the time it answers the
  // Users list catches up; leaving the profile happens per call (onRemove), once it succeeds.
  const removeFromOrg = useMutation({
    mutationFn: () => api(`/admin/memberships/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      // Freeze first: the refresh below must never redraw this screen without the person on it.
      if (!frozenMemberRef.current && member) frozenMemberRef.current = member;
      qc.invalidateQueries({ predicate: (q) => touchedByDeletion(q.queryKey) });
    },
    onError: (err) => flash('error', err.message),
  });

  // The campaigns this person is on — read-only here. Assigning and unassigning happen on Users with
  // that campaign picked, where the member sheet asks for the crew and says what moves first (plan §G):
  // an Assign here would join them with no crew and move a returning person's doors unseen.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const userCampaignsQ = useQuery({
    queryKey: ['admin', 'membership-campaigns', userId],
    queryFn: () => api(`/admin/memberships/${userId}/campaigns`),
    enabled: !!userId,
  });
  // Campaign NAMES for the activate/deactivate confirm. /crews names every campaign the switch
  // reaches, for every reader, so the disclosure is whole — the Campaigns list above keeps its own
  // /campaigns id list (different query, different invalidation).
  const crewsQ = useQuery({
    queryKey: ['admin', 'member-crews', userId],
    queryFn: () => api(`/admin/memberships/${userId}/crews`),
    enabled: !!userId,
  });
  // Unpause, from the state buttons (the pause notice's Review opens the pause itself).
  const unpause = useMutation({
    mutationFn: (pauseId) => api(`/admin/pace-pauses/${pauseId}/unpause`, { method: 'POST' }),
    onSuccess: () => {
      invalidatePaceCaches(qc);
      flash('success', 'Unpaused. They can record again.');
    },
    onError: (err) => {
      invalidatePaceCaches(qc);
      flash('error', err.message);
    },
  });

  // Delete account (docs/PROPOSAL_ADMIN_ACCOUNT_DELETION.md §E1). The viewer's own membership here
  // decides whether a billing admin's profile offers it: only to a viewer with billing access too.
  const [viewerMembership, setViewerMembership] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([loadMemberships(), loadActiveOrgId()])
      .then(([memberships, orgId]) => {
        if (!alive) return;
        setViewerMembership(
          (memberships || []).find((m) => String(m.organizationId) === String(orgId)) || null
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // More options folds away whenever the screen is left, so it never greets the next visit open —
  // except on the way out after a deletion, when the frozen screen shouldn't change as it pops.
  useFocusEffect(
    useCallback(
      () => () => {
        if (!frozenMemberRef.current) setMoreOpen(false);
      },
      []
    )
  );

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

  // The person has left this organization (deleted, removed, or found already gone): freeze this
  // screen on them as they were, leave the Users list its notice, pop back to it, and refresh what
  // their leaving changed — the list itself, the rosters and crews they came off, the books they
  // released. Refreshed straight away, not after InteractionManager.runAfterInteractions: React
  // Native 0.81 ships InteractionManager deprecated and stubbed to a setImmediate, so it never waited
  // for the pop — the frozen screen is what keeps the person from flashing as it leaves.
  const leaveProfile = (notice) => {
    if (leftRef.current) return;
    leftRef.current = true;
    frozenMemberRef.current = member;
    leaveDeletionNotice(notice);
    setDeleteOpen(false);
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/admin/users');
    qc.invalidateQueries({ predicate: (q) => touchedByDeletion(q.queryKey) });
  };

  // A display gate only, the web's rule: the server decides (billing access, the last admin).
  const offerRemove = mayOfferRemove({
    viewerRole,
    isSelf,
    user,
    billingAccess: !!member.billingAccess,
    viewerHasBilling: viewerHasBillingAccess(currentUser, viewerMembership),
  });

  // Cancel first, as every confirm in the app. A refusal (billing access, the last admin) comes back
  // as the server's words in the feedback strip.
  const onRemove = () => {
    if (removeAskingRef.current || removeFromOrg.isPending) return;
    removeAskingRef.current = true;
    const answered = () => {
      removeAskingRef.current = false;
    };
    const { title, body } = removeConfirm(user);
    Alert.alert(
      title,
      body,
      [
        { text: 'Cancel', style: 'cancel', onPress: answered },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            answered();
            removeFromOrg.mutate(undefined, {
              onSuccess: () =>
                leaveProfile(user.isDeleted ? `${DELETED_ACCOUNT_LABEL} removed.` : goneNotice(displayName(user))),
            });
          },
        },
      ],
      { cancelable: true, onDismiss: answered }
    );
  };

  // A deleted account whose row stays (a used one) has nothing left to change but its row: the
  // header, who deleted it, and Remove from org to tidy it away. Never its email, which is the
  // tombstone address.
  if (user.isDeleted) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials('Deleted', 'account')}</Text>
            </View>
            <Text style={styles.headerName}>{DELETED_ACCOUNT_LABEL}</Text>
            {member.deletion ? (
              <Text style={styles.headerEmail}>{deletionLine(member.deletion)}</Text>
            ) : null}
          </View>
          {feedback?.type === 'error' ? (
            <View style={[styles.feedback, { backgroundColor: colors.dangerBg }]} accessibilityLiveRegion="polite">
              <Text style={{ color: colors.dangerFg }}>{feedback.text}</Text>
            </View>
          ) : null}
          {offerRemove ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Account</Text>
              <Text style={styles.deleteText}>Remove from org tidies this row away. Nothing on your reports changes.</Text>
              <RemoveFromOrgButton onPress={onRemove} pending={removeFromOrg.isPending} />
            </View>
          ) : null}
        </ScrollView>
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
    // The switch is org-wide (Membership has no campaignId) — say which campaigns it reaches.
    // If /crews hasn't settled, fall back to the org-wide sentence; never block on the fetch.
    const names = (crewsQ.data?.crews || []).map((c) => c.campaignName).filter(Boolean);
    const shown =
      names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ');
    const body = user.isActive
      ? names.length
        ? `They lose access to this whole organization — including: ${shown}.`
        : 'They lose access to this whole organization.'
      : names.length
        ? `Access comes back for the whole organization — they rejoin: ${shown}.`
        : 'Access comes back for the whole organization.';
    Alert.alert(`${verb} ${user.email}?`, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb,
        style: user.isActive ? 'destructive' : 'default',
        onPress: () => toggleActive.mutate(),
      },
    ]);
  }

  // A display gate only: the server decides who can be deleted (the review says why not).
  const offerDelete = mayOfferDelete({
    viewerRole,
    isSelf,
    user,
    billingAccess: !!member.billingAccess,
    viewerHasBilling: viewerHasBillingAccess(currentUser, viewerMembership),
  });

  // The account is gone: 'deleted' (this delete, or one whose answer was lost) or 'gone' (no longer
  // in this organization — the sheet can't tell that from someone else removing them, so the notice
  // stays neutral). Freeze this screen on the person as they were, leave the Users list its notice,
  // pop back to it, and refresh what the deletion changed: the list itself, the rosters and crews
  // they came off, and the books they released. Refreshed straight away, not after
  // InteractionManager.runAfterInteractions: React Native 0.81 ships InteractionManager deprecated
  // and stubbed to a setImmediate, so it never waited for the pop — the frozen screen is what keeps
  // the person from flashing as it leaves.
  const onAccountDeleted = (outcome) =>
    leaveProfile(outcome === 'gone' ? goneNotice(displayName(user)) : accountDeletedText(user));

  // Where they stand (rosterView.standing, the Team page's rule) and the buttons for it, near the top
  // (lib/personActions.js, Part 1's table): Reactivate, Resend invite, Set temporary password or Unpause.
  // Deactivate stays in the danger zone at the bottom, beside what folds away under More options.
  const accountStatus = user.isActive ? 'active' : 'deactivated';
  const st = standing(
    { userId: String(userId), status: accountStatus, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt },
    pausedIds
  );
  // Never signed in (an account made since sign-ins were recorded) or No sign-in recorded (older).
  const signedIn = standing({ userId: '', status: 'active', lastLoginAt: user.lastLoginAt, createdAt: user.createdAt });
  const access = personAccess({
    viewerRole,
    viewerId: currentUser?.id,
    target: { userId: String(userId), role: user.role, status: accountStatus, isSuperAdmin: !!user.isSuperAdmin, lastLoginAt: user.lastLoginAt },
  });
  // The open pause this viewer may lift: the blocking one, or for an org admin one that isn't blocking
  // right now (plan §D.5; the web panel's rule), which personButtons puts under More options.
  const openPause =
    pausedHere ||
    (isAdminRole(viewerRole)
      ? (pausedQ.data?.pauses || []).find((p) => String(p.userId) === String(userId) && p.status === 'paused')
      : null) ||
    null;
  const buttons = personButtons({ st, access, canUnpause: !!openPause });
  const moreActions = buttons.more.filter((k) => k === 'resend' || k === 'temp-password' || k === 'unpause');

  // Cancel first, as every confirm in the app (Android lays the buttons out in array order).
  const confirmResend = () =>
    Alert.alert(
      'Resend invite?',
      `Email ${user.email} a new set-password link.\n\nThis replaces any earlier invite or reset link — if they still have one, it will stop working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => resendInvite.mutate() },
      ]
    );
  const confirmUnpause = () => {
    if (!openPause) return;
    Alert.alert(
      `Unpause ${displayName(user)}?`,
      'They can record again right away, and their count starts over. Nothing they saved is changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpause', onPress: () => unpause.mutate(openPause.id) },
      ],
      { cancelable: true }
    );
  };

  // One button per state action, wherever personButtons puts it.
  const stateButton = (key) => {
    if (key === 'reactivate') {
      return (
        <Pressable
          key={key}
          onPress={onToggleActive}
          disabled={toggleActive.isPending}
          style={[styles.secondaryBtn, { backgroundColor: colors.successBg, borderColor: colors.successBorder }]}
        >
          <Text style={[styles.secondaryBtnText, { color: colors.successFg }]}>Reactivate account</Text>
        </Pressable>
      );
    }
    if (key === 'resend') {
      return (
        <Pressable key={key} onPress={confirmResend} disabled={resendInvite.isPending} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>{resendInvite.isPending ? 'Sending…' : 'Resend invite'}</Text>
        </Pressable>
      );
    }
    if (key === 'temp-password') {
      return (
        <Pressable key={key} onPress={() => setShowResetPw((s) => !s)} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>{showResetPw ? 'Cancel' : 'Set temporary password'}</Text>
        </Pressable>
      );
    }
    if (key === 'unpause') {
      return (
        <Pressable key={key} onPress={confirmUnpause} disabled={unpause.isPending} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>{unpause.isPending ? 'Unpausing…' : 'Unpause'}</Text>
        </Pressable>
      );
    }
    return null;
  };

  const resetPwForm = showResetPw ? (
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
  ) : null;

  const stats = statsQ.data;
  const activities = recentRows(activityQ.data?.pages);
  // A team lead's totals cover only the campaigns they manage (item 40), so they say so — and leave
  // out miles, which join one campaign's doors to the next in a straight line and read wrong once
  // the other campaigns are gone.
  const leadTotals = viewerRole === 'lead';

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
            {/* Before 2026-05-15 Doorline didn't record sign-ins, so an older account with none on
                record reads "No sign-in recorded", never "Never". */}
            <Text style={styles.headerMeta}>
              {signedIn === 'never-signed-in'
                ? 'Never signed in'
                : signedIn === 'no-sign-in-recorded'
                  ? 'No sign-in recorded'
                  : `Last password login ${formatRelative(user.lastLoginAt)}`}
            </Text>
            {access.staff ? <Text style={styles.headerMeta}>Managed by Doorline staff</Text> : null}
          </View>

          {/* The buttons for where they stand, near the top. */}
          {buttons.top.length ? (
            <View style={[styles.card, styles.stateCard]}>
              {buttons.top.map(stateButton)}
              {buttons.top.includes('temp-password') ? resetPwForm : null}
            </View>
          ) : null}

          {pausedHere ? (
            <Pressable
              onPress={() => router.push(`/(app)/admin/pause/${pausedHere.id}`)}
              style={({ pressed }) => [styles.feedback, { backgroundColor: colors.dangerBg, opacity: pressed ? 0.85 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.dangerFg, fontWeight: '600' }}>
                Paused for review on {pausedHere.campaignName || 'a campaign'} since{' '}
                {formatInTz(pausedHere.firedAt, pausedHere.timeZone)} · Review ›
              </Text>
            </Pressable>
          ) : pausedElsewhere ? (
            <View style={[styles.feedback, { backgroundColor: colors.dangerBg }]}>
              <Text style={{ color: colors.dangerFg, fontWeight: '600' }}>
                Paused for review on another campaign — an org admin can unpause.
              </Text>
            </View>
          ) : null}

          {/* Profile form — identity edits follow the server's wall: an admin edits anyone; a LEAD
              edits their CANVASSERS (2026-08-09 ruling — same boundary as the temp-password power
              they already hold). Role + grants stay admin-only and are gated separately below. */}
          {(isAdminViewer || user.role === 'canvasser') && (
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

            {isAdminViewer && (
            <>
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
            </>
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

          {/* Campaigns — the ones they're on, read-only. Assigning and unassigning happen on Users
              with that campaign picked, where the member sheet asks for the crew and shows what moves
              first; each row goes there. Admin-only, as the list always was. */}
          {isAdminViewer && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Campaigns</Text>
            {campaignsQ.isLoading || userCampaignsQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.sm }} />
            ) : (
              (() => {
                const assigned = new Set((userCampaignsQ.data?.campaignIds || []).map(String));
                const campaigns = (campaignsQ.data?.campaigns || []).filter(
                  (c) => c.isActive && assigned.has(String(c._id))
                );
                if (campaigns.length === 0) {
                  return <Text style={styles.campaignEmpty}>Not on any active campaign.</Text>;
                }
                return campaigns.map((c) => {
                  const cid = String(c._id);
                  return (
                    <Pressable
                      key={cid}
                      onPress={() => router.push(`/(app)/admin/users?campaignId=${cid}`)}
                      accessibilityRole="button"
                      accessibilityHint="Opens Users on this campaign"
                      style={({ pressed }) => [styles.campaignRow, pressed && { opacity: 0.7 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.campaignName}>{c.name}</Text>
                        <Text style={styles.campaignMeta}>
                          {c.state}
                          {c.type === 'lit_drop' ? ' · Lit drop' : ' · Survey'}
                        </Text>
                      </View>
                      <Text style={styles.campaignChevron}>›</Text>
                    </Pressable>
                  );
                });
              })()
            )}
            <Text style={styles.campaignFooter}>Assign or unassign from Users on that campaign.</Text>
          </View>
          )}

          {/* Totals: lifetime for an org admin; for a team lead, the campaigns they manage only
              (item 40), so they say so and leave out miles. */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>{leadTotals ? 'On your campaigns' : 'Activity (lifetime)'}</Text>
            {statsQ.isLoading || !viewerRole ? (
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
                  {leadTotals ? null : (
                    <StatCell
                      label="Miles walked"
                      value={metersToMiles(stats.distanceMeters)}
                    />
                  )}
                </View>
                <Text style={styles.statMeta}>
                  {leadTotals
                    ? `${(stats.campaignsWorked || 0).toLocaleString()} of your campaigns`
                    : `${stats.campaignsWorked || 0} ${stats.campaignsWorked === 1 ? 'campaign' : 'campaigns'} worked`}
                  {stats.lastActivityAt
                    ? ` · Last activity ${formatRelative(stats.lastActivityAt)}`
                    : ''}
                </Text>
              </>
            ) : null}
          </View>

          {/* Recent activity — the newest 5, then Show more adds 10. */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Recent activity</Text>
            {activityQ.isLoading ? (
              <ActivityIndicator color={colors.brand} />
            ) : activityQ.error && !activities.length ? (
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
            {activityQ.hasNextPage ? (
              <Pressable
                onPress={() => activityQ.fetchNextPage()}
                disabled={activityQ.isFetchingNextPage}
                style={[styles.secondaryBtn, { marginTop: spacing.md }, activityQ.isFetchingNextPage && { opacity: 0.6 }]}
              >
                <Text style={styles.secondaryBtnText}>
                  {activityQ.isFetchingNextPage ? 'Loading…' : 'Show more'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Account actions — Deactivate lives at the bottom (danger zone), with Remove from org and
              More options: there, the rarer state actions (Resend invite for an account with no
              sign-in on record, a temporary password for someone paused) and Delete account. A lead
              may switch only canvasser accounts (their crew); the server enforces the same boundary. */}
          {buttons.more.includes('deactivate') || offerRemove || offerDelete || moreActions.length ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Account</Text>
              {buttons.more.includes('deactivate') ? (
                <Pressable
                  onPress={onToggleActive}
                  disabled={toggleActive.isPending}
                  style={[styles.secondaryBtn, { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>Deactivate</Text>
                </Pressable>
              ) : null}

              {offerRemove && <RemoveFromOrgButton onPress={onRemove} pending={removeFromOrg.isPending} />}

              {/* Tucked behind More options so they're hard to reach by accident; Delete then asks
                  twice in its sheet. */}
              {offerDelete || moreActions.length ? (
                <>
                  <Pressable
                    onPress={() => setMoreOpen((v) => !v)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: moreOpen }}
                    hitSlop={8}
                    style={styles.moreToggle}
                  >
                    <Text style={styles.moreToggleText}>More options {moreOpen ? '▾' : '▸'}</Text>
                  </Pressable>
                  {moreOpen && moreActions.length ? (
                    <View style={styles.moreActions}>
                      {moreActions.map(stateButton)}
                      {moreActions.includes('temp-password') ? resetPwForm : null}
                    </View>
                  ) : null}
                  {moreOpen && offerDelete && (
                    <View style={styles.deleteBox}>
                      <Text style={styles.deleteTitle}>Delete account</Text>
                      <Text style={styles.deleteText}>{deleteAccountBlurb(user)}</Text>
                      <Pressable
                        onPress={() => setDeleteOpen(true)}
                        accessibilityRole="button"
                        style={[
                          styles.secondaryBtn,
                          { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
                        ]}
                      >
                        <Text style={[styles.secondaryBtnText, { color: colors.dangerFg }]}>
                          Delete account…
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {deleteOpen ? (
        <DeleteMemberSheet
          userId={userId}
          person={{ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }}
          onClose={() => setDeleteOpen(false)}
          onDeleted={onAccountDeleted}
        />
      ) : null}
    </SafeAreaView>
  );
}

// Remove from org: the danger-outline button the web uses, on the profile and on a deleted row.
const RemoveFromOrgButton = ({ onPress, pending }) => {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={pending}
      accessibilityRole="button"
      accessibilityLabel={pending ? 'Removing from org' : 'Remove from org'}
      accessibilityState={{ disabled: pending, busy: pending }}
      style={[styles.secondaryBtn, styles.removeBtn, { borderColor: colors.dangerBorder }, pending && { opacity: 0.6 }]}
    >
      <Text style={[styles.secondaryBtnText, { color: colors.danger }]}>
        {pending ? 'Removing…' : 'Remove from org'}
      </Text>
    </Pressable>
  );
};

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
  campaignChevron: { ...type.body, color: colors.textMuted },
  campaignFooter: { ...type.caption, marginTop: spacing.sm },
  stateCard: { gap: spacing.sm },
  moreActions: { marginTop: spacing.sm, gap: spacing.sm },
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
  removeBtn: { marginTop: spacing.sm },
  moreToggle: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: spacing.xs,
  },
  moreToggleText: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  deleteBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  deleteTitle: { ...type.bodyStrong, fontSize: 14 },
  deleteText: { ...type.caption },

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
