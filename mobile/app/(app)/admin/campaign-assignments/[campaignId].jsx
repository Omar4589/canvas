import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { loadCurrentUser } from '../../../../lib/cache';
import PasswordInput from '../../../../components/PasswordInput';
import ActivityRow from '../../../../components/ActivityRow';
import { radius, spacing } from '../../../../lib/theme';
import { useTheme } from '../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../lib/useThemedStyles';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../../../../lib/validators';

export default function CampaignAssignmentsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [panelUserId, setPanelUserId] = useState(null);
  // Current user, so an admin/lead/super can add themselves to the campaign (they're filtered
  // out of the canvasser list by role, so we inject them, badged "You").
  const [self, setSelf] = useState(null);
  useEffect(() => {
    loadCurrentUser().then((u) => setSelf(u || null));
  }, []);

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });

  // The campaign-scoped crew endpoint (not the org-wide /admin/memberships) so this
  // screen works for team leads too, not just org admins.
  const membersQ = useQuery({
    queryKey: ['admin', 'campaign-crew', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/crew`),
    enabled: !!cId,
  });

  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });

  const assignMut = useMutation({
    mutationFn: (userIds) =>
      api(`/admin/campaigns/${cId}/assignments`, {
        method: 'POST',
        body: { userIds },
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] }),
  });

  const unassignMut = useMutation({
    mutationFn: (userId) =>
      api(`/admin/campaigns/${cId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] }),
  });

  // Create a net-new canvasser straight onto this campaign (auto-assigned by the endpoint).
  const createMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${cId}/crew`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cId] });
      setShowCreate(false);
    },
  });

  const campaign = (campaignsQ.data?.campaigns || []).find(
    (c) => String(c._id) === String(cId)
  );

  const assignedSet = useMemo(
    () => new Set((assignmentsQ.data?.assignments || []).map((a) => a.userId)),
    [assignmentsQ.data]
  );

  // WHO IS ON THIS CAMPAIGN — from the roster, not the org crew list.
  //
  // /crew filters on isActive twice on the server and once more below, so anyone DEACTIVATED
  // vanished from this screen entirely: no row, no name, no way back. And if they were the last
  // one, the empty state read "No canvassers in this org yet" — the app stating a falsehood as
  // fact, the same failure we fixed on the Users screen. /assignments keeps them, and carries the
  // `status` and the crew (coordinatorId + coordinatorName) that the panel needs anyway.
  const roster = useMemo(
    () =>
      (assignmentsQ.data?.assignments || []).map((a) => ({
        role: a.role,
        isActive: a.isActive,
        status: a.status, // 'active' | 'deactivated' | 'removed' | 'deleted'
        coordinatorId: a.coordinatorId || null,
        coordinatorName: a.coordinatorName || null,
        isSelf: self?.id ? String(a.userId) === String(self.id) : false,
        user: {
          id: String(a.userId),
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          isActive: a.isActive,
        },
      })),
    [assignmentsQ.data, self]
  );

  // Everyone NOT yet on the campaign, from the org crew list — the add picker only. Roles other
  // than canvasser are excluded, except the current user, who is injected so an admin or lead can
  // put themselves on a book.
  const addable = useMemo(() => {
    const onCampaign = new Set(roster.map((r) => r.user.id));
    const list = (membersQ.data?.members || []).filter(
      (m) => m.role === 'canvasser' && m.user.isActive && m.isActive && !onCampaign.has(String(m.user.id))
    );
    const selfId = self?.id ? String(self.id) : null;
    if (selfId && !onCampaign.has(selfId) && !list.some((m) => String(m.user.id) === selfId)) {
      return [
        {
          role: 'admin',
          isActive: true,
          isSelf: true,
          user: { id: selfId, firstName: self.firstName || 'You', lastName: self.lastName || '', email: self.email, isActive: true },
        },
        ...list,
      ];
    }
    return list;
  }, [membersQ.data, roster, self]);

  const panelMember = panelUserId ? roster.find((r) => r.user.id === panelUserId) || null : null;

  // Who may BE a crew boss: active admins and leads in this org. The server is the authority
  // (resolveCoordinatorId), this just avoids offering something it will reject.
  const coordinators = useMemo(
    () =>
      (membersQ.data?.members || [])
        .filter((m) => (m.role === 'admin' || m.role === 'lead') && m.user.isActive && m.isActive)
        .map((m) => ({ id: String(m.user.id), name: `${m.user.firstName} ${m.user.lastName}`.trim() })),
    [membersQ.data]
  );

  const matches = (m, term) =>
    `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase().includes(term);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = [...roster, ...addable];
    return term ? all.filter((m) => matches(m, term)) : all;
  }, [roster, addable, search]);

  function toggle(userId) {
    if (assignedSet.has(userId)) unassignMut.mutate(userId);
    else assignMut.mutate([userId]);
  }

  function bulkAssignAll() {
    const ids = filtered.map((m) => m.user.id).filter((id) => !assignedSet.has(id));
    if (ids.length) assignMut.mutate(ids);
  }

  // Never say the org is empty on the strength of a filtered view, and never on the strength of a
  // list that has been filtered for activity — that is how a deactivated crew turned into
  // "No canvassers in this org yet."
  const emptyText = search.trim()
    ? 'No matches.'
    : roster.length === 0 && addable.length === 0
      ? 'Nobody in this organization can be added yet. Create a canvasser with + New.'
      : 'No canvassers on this campaign yet — add someone below.';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Assignments
        </Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8} style={{ width: 60, alignItems: 'flex-end' }}>
          <Text style={styles.newBtn}>+ New</Text>
        </Pressable>
      </View>

      <View style={styles.subHeader}>
        <Text style={styles.subTitle}>{campaign?.name || 'Loading…'}</Text>
        <Text style={styles.subText}>
          Only assigned canvassers see this campaign on mobile.
        </Text>
      </View>

      <View style={styles.controls}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search canvassers"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={bulkAssignAll} style={styles.bulkBtn}>
          <Text style={styles.bulkBtnText}>Assign all visible</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      >
        {membersQ.isLoading || assignmentsQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        ) : (
          filtered.map((m) => {
            const u = m.user;
            const assigned = assignedSet.has(u.id);
            const deactivated = m.status === 'deactivated';
            return (
              <Pressable
                key={u.id}
                // Only someone actually ON the campaign has a crew, stats or a status to manage.
                onPress={assigned ? () => setPanelUserId(u.id) : undefined}
                style={({ pressed }) => [styles.row, pressed && assigned && { opacity: 0.6 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>
                    {u.firstName} {u.lastName}
                    {m.isSelf ? <Text style={styles.youTag}>  You</Text> : null}
                    {deactivated ? <Text style={styles.offTag}>  Deactivated</Text> : null}
                  </Text>
                  {u.email ? (
                    <Text style={styles.rowEmail} numberOfLines={1}>
                      {u.email}
                    </Text>
                  ) : null}
                  {assigned ? (
                    <Text style={styles.rowCrew} numberOfLines={1}>
                      {m.coordinatorName ? `${m.coordinatorName}’s crew` : 'No crew'}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => toggle(u.id)}
                  disabled={assignMut.isPending || unassignMut.isPending}
                  style={[
                    styles.action,
                    assigned ? styles.actionUnassign : styles.actionAssign,
                  ]}
                >
                  <Text
                    style={[
                      styles.actionText,
                      assigned ? styles.actionTextUnassign : styles.actionTextAssign,
                    ]}
                  >
                    {assigned ? 'Unassign' : 'Assign'}
                  </Text>
                </Pressable>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {panelMember && (
        <MemberPanel
          member={panelMember}
          campaign={campaign}
          cId={cId}
          coordinators={coordinators}
          onClose={() => setPanelUserId(null)}
          onRemoved={() => { setPanelUserId(null); unassignMut.mutate(panelMember.user.id); }}
          colors={colors}
          styles={styles}
        />
      )}

      {showCreate && (
        <CreateCanvasserModal
          onClose={() => setShowCreate(false)}
          onCreate={(body) => createMut.mutate(body)}
          onFoundExisting={(em) => { setSearch(em); setShowCreate(false); }}
          submitting={createMut.isPending}
          error={createMut.error}
          colors={colors}
          styles={styles}
        />
      )}
    </SafeAreaView>
  );
}

// One crew member, over the roster list. Stats, the crew they're on, what they've been doing, and
// the two destructive actions.
//
// The backdrop is a SIBLING of the card, matching CreateCanvasserModal below — not the
// nested-Pressable form used on the map screens. Two reasons: e.stopPropagation() is a no-op in
// React Native (the responder system already grants the touch to the deepest view, so the outer
// press never fires either way), and this file's modalBackdrop is absoluteFillObject while that
// form needs a flex container — copying it here would lay the sheet out at the top-left corner
// with no height clamp.
function MemberPanel({ member, campaign, cId, coordinators, onClose, onRemoved, colors, styles }) {
  const qc = useQueryClient();
  const router = useRouter();
  const u = member.user;
  const name = `${u.firstName} ${u.lastName}`.trim();
  const isCanvasser = member.role === 'canvasser';

  // Staged, not saved. `null` means nothing staged — distinct from '' which means "No crew".
  const [pending, setPending] = useState(null);
  const isPendingChange = pending !== null && pending !== (member.coordinatorId || '');

  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', cId, u.id],
    queryFn: () => api(`/admin/reports/canvassers/${u.id}/summary?campaignId=${cId}`),
  });
  const activityQ = useQuery({
    // No tz param: the server ignores req.query.tz on this route and returns no tz of its own, so
    // sending one would only imply a guarantee it doesn't make. Render against the campaign's zone.
    queryKey: ['admin', 'campaign-member-activity', cId, u.id],
    queryFn: () => api(`/admin/reports/canvassers/${u.id}/activities?campaignId=${cId}&limit=5`),
  });
  const previewQ = useQuery({
    queryKey: ['admin', 'coordinator-preview', cId, u.id, pending],
    queryFn: () => api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator-preview?coordinatorId=${pending || 'none'}`),
    enabled: isPendingChange,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
    qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cId] });
  };

  const setCrewMut = useMutation({
    mutationFn: (cid) =>
      api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator`, { method: 'PATCH', body: { coordinatorId: cid || null } }),
    onSuccess: () => { invalidate(); setPending(null); },
    onError: (e) => { setPending(null); Alert.alert('Could not change crew', e?.message || 'Please try again.'); },
  });

  const statusMut = useMutation({
    mutationFn: (action) => api(`/admin/campaigns/${cId}/crew/${u.id}/${action}`, { method: 'PATCH', body: {} }),
    onSuccess: (res) => {
      invalidate();
      onClose();
      const others = res?.alsoAffects || [];
      if (others.length) {
        Alert.alert(
          res.isActive ? `${name} is back on` : `${name} is switched off`,
          `This also ${res.isActive ? 'restores' : 'affects'} their access to ${others.map((c) => c.name).join(', ')}.`
        );
      }
    },
    onError: (e) => Alert.alert('Could not change access', e?.message || 'Please try again.'),
  });

  const kpi = summaryQ.data?.kpi;
  const isSurvey = campaign?.type !== 'lit_drop';
  const activities = activityQ.data?.activities || [];

  // Deactivating switches this person off for the WHOLE organization — Membership has no campaign.
  // So name the other campaigns it reaches before asking, rather than after.
  function confirmDeactivate() {
    // Membership has no campaign, so this switches them off for the WHOLE org. Say that plainly up
    // front — the exact list of other campaigns comes back on the response (`alsoAffects`) and is
    // reported straight after, because nothing the panel already holds can name them.
    Alert.alert(
      `Deactivate ${name}?`,
      `They lose access to this organization everywhere — not just ${campaign?.name || 'this campaign'}.` +
        `\n\nTheir books stay theirs and every door they knocked still counts. You can switch them back on from here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: () => statusMut.mutate('deactivate') },
      ]
    );
  }

  function confirmRemove() {
    Alert.alert(
      `Remove ${name} from ${campaign?.name || 'this campaign'}?`,
      'Any books they hold here go back to the pool. Their work is kept — every door they knocked still counts toward this campaign. This does not affect their other campaigns.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: onRemoved },
      ]
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.panelHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} numberOfLines={1}>{name}</Text>
              <Text style={styles.modalSub} numberOfLines={1}>
                {u.email}{member.status === 'deactivated' ? ' · Deactivated' : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}><Text style={styles.panelClose}>×</Text></Pressable>
          </View>

          <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {/* Stats. Guarded on the loading frame rather than rendered optimistically. */}
            <Text style={styles.panelLabel}>In this campaign</Text>
            {summaryQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ alignSelf: 'flex-start' }} />
            ) : !kpi ? (
              <Text style={styles.panelMuted}>No activity in this campaign yet.</Text>
            ) : (
              <Text style={styles.panelStats}>
                <Text style={styles.panelStatStrong}>{(kpi.homesKnocked ?? 0).toLocaleString()}</Text>
                <Text> doors · </Text>
                <Text style={styles.panelStatStrong}>
                  {isSurvey
                    ? (kpi.surveyDoors ?? kpi.surveysSubmitted ?? 0).toLocaleString()
                    : (kpi.litDropped ?? 0).toLocaleString()}
                </Text>
                <Text>{isSurvey ? ' survey doors · ' : ' lit drops · '}</Text>
                <Text style={styles.panelStatStrong}>{kpi.connectionRatePct ?? 0}%</Text>
                <Text> conn · </Text>
                <Text style={styles.panelStatStrong}>{(kpi.daysActive ?? 0).toLocaleString()}</Text>
                <Text> days</Text>
              </Text>
            )}

            {/* Crew. A plain vertical list, not TabSwitcher: the picker has to hold a PENDING
                selection while the door count loads, and TabSwitcher commits on tap. */}
            {isCanvasser ? (
              <>
                <Text style={styles.panelLabel}>Crew</Text>
                {[{ id: '', name: 'No crew' }, ...coordinators.filter((c) => c.id !== u.id)].map((c) => {
                  const current = (pending ?? member.coordinatorId ?? '') === c.id;
                  return (
                    <Pressable
                      key={c.id || 'none'}
                      onPress={() => setPending(c.id)}
                      disabled={setCrewMut.isPending}
                      style={styles.panelOption}
                    >
                      <Text style={[styles.panelOptionText, current && styles.panelOptionTextOn]}>
                        {current ? '● ' : '○ '}{c.name}
                      </Text>
                    </Pressable>
                  );
                })}

                {isPendingChange ? (
                  <View style={styles.panelConfirm}>
                    {previewQ.isLoading ? (
                      <Text style={styles.panelMuted}>Checking what would move…</Text>
                    ) : previewQ.error ? (
                      <Text style={styles.panelError}>Couldn’t check what would move.</Text>
                    ) : (
                      <Text style={styles.panelConfirmText}>
                        {previewQ.data?.doors
                          ? `Move ${previewQ.data.doors.toLocaleString()} door${previewQ.data.doors === 1 ? '' : 's'}` +
                            (previewQ.data.surveys ? ` and ${previewQ.data.surveys.toLocaleString()} survey${previewQ.data.surveys === 1 ? '' : 's'}` : '') +
                            ` ${previewQ.data.from ? `from ${previewQ.data.from.name}’s crew` : 'from no crew'}` +
                            ` ${previewQ.data.to ? `to ${previewQ.data.to.name}’s crew?` : 'to no crew?'}` +
                            `\nThis campaign only, all time.`
                          : `${name} has no past doors to move.`}
                        {previewQ.data?.subjectRunsCrew
                          ? `\n\n${name} runs a crew. Their own doors move; their crew’s doors stay with them.`
                          : ''}
                      </Text>
                    )}
                    <View style={styles.panelConfirmRow}>
                      <Pressable onPress={() => setPending(null)} style={styles.modalCancel} disabled={setCrewMut.isPending}>
                        <Text style={styles.modalCancelText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setCrewMut.mutate(pending)}
                        style={[styles.modalCreate, (previewQ.isLoading || setCrewMut.isPending) && { opacity: 0.5 }]}
                        disabled={previewQ.isLoading || setCrewMut.isPending}
                      >
                        <Text style={styles.modalCreateText}>
                          {setCrewMut.isPending ? 'Moving…' : previewQ.data?.doors ? 'Move them' : 'Save'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={styles.panelLabel}>Recent doors</Text>
            {activityQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ alignSelf: 'flex-start' }} />
            ) : activities.length === 0 ? (
              <Text style={styles.panelMuted}>Nothing yet in this campaign.</Text>
            ) : (
              activities.map((a) => <ActivityRow key={a.id} activity={a} showDate />)
            )}

            <Pressable
              onPress={() => { onClose(); router.push({ pathname: `/(app)/admin/canvasser/${u.id}` }); }}
              style={styles.panelLink}
            >
              <Text style={styles.panelLinkText}>Full canvasser view ›</Text>
            </Pressable>

            <Pressable onPress={confirmRemove} style={styles.panelDanger}>
              <Text style={styles.panelDangerText}>Remove from this campaign</Text>
            </Pressable>
            {/* Admins, leads and super-admins are not switchable from here — the server refuses
                them too, so offering it would only produce a 403. */}
            {isCanvasser ? (
              member.status === 'deactivated' ? (
                <Pressable onPress={() => statusMut.mutate('reactivate')} style={styles.panelLink}>
                  <Text style={styles.panelLinkText}>Reactivate account</Text>
                </Pressable>
              ) : (
                <Pressable onPress={confirmDeactivate} style={styles.panelDanger}>
                  <Text style={styles.panelDangerText}>Deactivate account</Text>
                </Pressable>
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CreateCanvasserModal({ onClose, onCreate, onFoundExisting, submitting, error, colors, styles }) {
  const [linkExisting, setLinkExisting] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // The email already has a Door Line account — flip to the link path so a returning
  // canvasser can still be added (a lead owns onboarding). They keep their own password.
  useEffect(() => {
    if (error?.data?.code === 'EMAIL_EXISTS_USE_LINK') setLinkExisting(true);
  }, [error]);

  // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the
  // new canvasser sets their own via the emailed set-password link; only a TYPED one must pass min-8.
  const valid = linkExisting
    ? !!email.trim()
    : firstName.trim() && lastName.trim() && email.trim() && (password === '' || isValidTempPassword(password));
  const pwProblem = !linkExisting && password.length > 0 ? tempPasswordProblem(password) : null;

  function submit() {
    if (!valid || submitting) return;
    const em = email.trim().toLowerCase();
    onCreate(
      linkExisting
        ? { email: em, linkExisting: true }
        : {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: em,
            phone: phone.trim() || undefined,
            password,
            linkExisting: false,
          }
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Add a canvasser</Text>
          <Text style={styles.modalSub}>
            {linkExisting
              ? 'Links an existing Door Line account to this org and campaign. They keep their current password.'
              : 'Creates a canvasser and adds them to this campaign. They set their own password from the emailed invite — a temporary one is optional.'}
          </Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
            <Pressable
              onPress={() => setLinkExisting((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: linkExisting ? colors.brand : colors.border,
                  backgroundColor: linkExisting ? colors.brand : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {linkExisting && (
                  <Text style={{ color: colors.textInverse, fontWeight: '700', fontSize: 12 }}>✓</Text>
                )}
              </View>
              <Text style={{ color: colors.textPrimary, fontSize: 13, flex: 1 }}>
                Existing user (by email — link them to this org)
              </Text>
            </Pressable>
            {!linkExisting && (
              <View style={styles.formRow2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>First name</Text>
                  <TextInput value={firstName} onChangeText={setFirstName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Last name</Text>
                  <TextInput value={lastName} onChangeText={setLastName} autoCapitalize="words" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                </View>
              </View>
            )}
            <Text style={styles.formLabel}>Email</Text>
            <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="jane@example.com" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
            {!linkExisting && (
              <>
                <Text style={styles.formLabel}>Phone (optional)</Text>
                <TextInput value={phone} onChangeText={(t) => setPhone(formatUsPhoneInput(t))} keyboardType="phone-pad" placeholder="(555) 123-4567" placeholderTextColor={colors.textMuted} style={styles.modalInput} />
                <Text style={styles.formLabel}>Temporary password (optional)</Text>
                <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" placeholder="Leave blank to email an invite" />
                {pwProblem ? <Text style={styles.modalError}>{pwProblem}</Text> : null}
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.xs }}>
                  Leave blank to let them set their own password via the emailed invite (recommended).
                  Type one only if they can’t receive email.
                </Text>
              </>
            )}
            {error && error.data?.code === 'ALREADY_MEMBER' ? (
              <Text style={[styles.modalSub, { marginTop: spacing.sm }]}>
                That person is already in your organization — close this and add them from the list above.
                {onFoundExisting ? ' ' : ''}
                {onFoundExisting ? (
                  <Text style={{ color: colors.brand, fontWeight: '700' }} onPress={() => onFoundExisting(email.trim().toLowerCase())}>
                    Search for “{email.trim().toLowerCase()}” →
                  </Text>
                ) : null}
              </Text>
            ) : error && error.data?.code === 'EMAIL_EXISTS_USE_LINK' ? (
              <Text style={[styles.modalSub, { marginTop: spacing.sm }]}>
                This email already has a Door Line account — we switched on “Existing user” above. Tap Link user to add them.
              </Text>
            ) : error ? (
              <Text style={styles.modalError}>{error.message}</Text>
            ) : null}
          </ScrollView>
          <View style={styles.modalActions}>
            <Pressable onPress={onClose} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!valid || submitting} style={[styles.modalCreate, (!valid || submitting) && { opacity: 0.5 }]}>
              <Text style={styles.modalCreateText}>{submitting ? 'Saving…' : linkExisting ? 'Link user' : 'Create & add'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
  subHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  subTitle: { ...type.h2, fontSize: 18 },
  subText: { ...type.caption, marginTop: 2 },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  search: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.textPrimary,
  },
  bulkBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  bulkBtnText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  rowName: { ...type.bodyStrong, fontSize: 15 },
  youTag: { fontSize: 11, fontWeight: '800', color: colors.brand },
  rowEmail: { ...type.caption, marginTop: 1 },
  action: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  actionAssign: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  actionUnassign: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerBg,
  },
  actionText: { fontSize: 12, fontWeight: '700' },
  actionTextAssign: { color: colors.brand },
  actionTextUnassign: { color: colors.danger },

  newBtn: { color: colors.brand, fontWeight: '700', fontSize: 15 },

  offTag: { ...type.caption, color: colors.warnFg, fontWeight: '700' },
  rowCrew: { ...type.caption, color: colors.textMuted, marginTop: 2 },

  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  panelClose: { ...type.h2, color: colors.textMuted, lineHeight: 24 },
  panelLabel: { ...type.micro, marginTop: spacing.lg, marginBottom: spacing.sm },
  panelMuted: { ...type.body, color: colors.textMuted },
  panelError: { ...type.body, color: colors.danger },
  panelStats: { ...type.body, color: colors.textSecondary },
  panelStatStrong: { color: colors.textPrimary, fontWeight: '700' },
  panelOption: { paddingVertical: spacing.sm },
  panelOptionText: { ...type.body, color: colors.textSecondary },
  panelOptionTextOn: { color: colors.brand, fontWeight: '700' },
  panelConfirm: {
    marginTop: spacing.sm, padding: spacing.md,
    backgroundColor: colors.sunken, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  panelConfirmText: { ...type.body, color: colors.textPrimary },
  panelConfirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
  panelLink: { paddingVertical: spacing.md },
  panelLinkText: { ...type.body, color: colors.brand, fontWeight: '600' },
  panelDanger: { paddingVertical: spacing.md },
  panelDangerText: { ...type.body, color: colors.danger, fontWeight: '600' },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
  modalCard: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl || radius.lg,
    borderTopRightRadius: radius.xl || radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { ...type.h2, fontSize: 18 },
  modalSub: { ...type.caption, marginTop: 2, marginBottom: spacing.md },
  formRow2: { flexDirection: 'row', gap: spacing.sm },
  formLabel: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  modalInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.textPrimary,
  },
  modalError: { ...type.caption, color: colors.danger, marginTop: spacing.sm },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
  modalCancel: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  modalCreate: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  modalCreateText: { fontSize: 14, fontWeight: '700', color: colors.textInverse },
  });
}
