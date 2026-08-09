import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import ActivityRow from './ActivityRow';
import PasswordInput from './PasswordInput';
import { isValidTempPassword, tempPasswordProblem } from '../lib/validators';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The member sheet — the one people-surface panel, shared by the Users hub for any rostered
// member. Replaces the campaign Team page's MemberPanel (that page merged into Users):
// identity header, campaign KPIs, a Coordinator DROPDOWN (renamed from "Crew" — it always
// was the coordinator), tappable recent doors, and role-gated account actions.
//
// Capability rules (server-enforced; the UI just doesn't offer dead buttons):
//   - assign/unassign + remove-from-campaign: org admins only (leads' creations auto-assign)
//   - temp password / deactivate / reactivate: admins for anyone; a LEAD only for CANVASSER
//    targets on their campaigns
//   - coordinator: canvasser targets, campaign context required
function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function MemberSheet({
  member, // { role, isActive, status, coordinatorId, coordinatorName, assigned, user: {id,firstName,lastName,email} }
  campaign, // { id, name, type } — the selected campaign context (required)
  coordinators, // [{ id, name }] active admins+leads, for the dropdown
  viewerRole, // 'super' | 'admin' | 'lead'
  onClose,
  onChanged, // invalidate caller queries after any write
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const u = member.user;
  const cId = campaign?.id;
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
  const isCanvasser = member.role === 'canvasser';
  const isAdminViewer = viewerRole === 'admin' || viewerRole === 'super';
  // A lead manages canvassers only; admins manage anyone (self-demotion guards live server-side).
  const canManageAccount = isAdminViewer || isCanvasser;

  // Coordinator dropdown (canvasser targets): staged pick + move preview + confirm.
  const [coordOpen, setCoordOpen] = useState(false);
  const [pending, setPending] = useState(null); // staged coordinatorId ('' = none); null = nothing staged
  const isPendingChange = pending !== null && pending !== (member.coordinatorId || '');

  // Temp password: collapsed by default; expands to an inline form.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');

  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', cId, u.id],
    queryFn: () => api(`/admin/reports/canvassers/${u.id}/summary?campaignId=${cId}`),
    enabled: !!cId,
  });
  const activityQ = useQuery({
    queryKey: ['admin', 'campaign-member-activity', cId, u.id],
    queryFn: () => api(`/admin/reports/canvassers/${u.id}/activities?campaignId=${cId}&limit=5`),
    enabled: !!cId,
  });
  const previewQ = useQuery({
    queryKey: ['admin', 'coordinator-preview', cId, u.id, pending],
    queryFn: () => api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator-preview?coordinatorId=${pending || 'none'}`),
    enabled: !!cId && isPendingChange,
  });
  // Which campaigns an org-wide account switch reaches. /crews names EVERY campaign the person
  // is rostered on — including ones this viewer doesn't manage — which is exactly the point of
  // the disclosure. (Never resolve ids against /admin/campaigns: that list is lead-scoped and
  // would drop the campaigns the warning exists to name.) Loaded eagerly so the names are
  // ready when the confirm opens; if it hasn't settled, the confirms fall back to their
  // generic org-wide sentence rather than blocking the action.
  const crewsQ = useQuery({
    queryKey: ['admin', 'member-crews', u.id],
    queryFn: () => api(`/admin/memberships/${u.id}/crews`),
  });

  const settle = () => onChanged?.();

  const setCoordMut = useMutation({
    mutationFn: (cid) =>
      api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator`, { method: 'PATCH', body: { coordinatorId: cid || null } }),
    onSuccess: () => {
      settle();
      setPending(null);
      setCoordOpen(false);
    },
    onError: (e) => {
      setPending(null);
      Alert.alert('Could not change coordinator', e?.message || 'Please try again.');
    },
  });

  // Org-level account switches — the lead-scoped memberships routes (a lead passes only for
  // canvasser targets on their campaigns; the server is the authority).
  const statusMut = useMutation({
    mutationFn: (action) => api(`/admin/memberships/${u.id}/${action}`, { method: 'PATCH', body: {} }),
    onSuccess: () => {
      settle();
      onClose();
    },
    onError: (e) => Alert.alert('Could not change access', e?.message || 'Please try again.'),
  });
  const pwMut = useMutation({
    mutationFn: (password) => api(`/admin/memberships/${u.id}/password`, { method: 'PATCH', body: { password } }),
    onSuccess: () => {
      setPwOpen(false);
      setPw('');
      Alert.alert('Temporary password set', `${name} must change it at their next sign-in.`);
    },
    onError: (e) => Alert.alert('Could not set password', e?.message || 'Please try again.'),
  });
  // Re-send the set-password invite. Only ever offered to someone who has never signed in: the
  // invite goes out once at account creation and the temp password beside it dies after 72h, so
  // anyone who missed that window had no way in that an admin could trigger.
  const inviteMut = useMutation({
    mutationFn: () => api(`/admin/memberships/${u.id}/resend-invite`, { method: 'POST' }),
    onSuccess: (res) =>
      Alert.alert(
        res?.sent ? 'Invite sent' : 'Invite not sent',
        res?.sent
          ? `${u.email} can set a password for the next ${res.expiresInHours} hours.`
          : 'The email could not be sent. Check the mail settings.'
      ),
    onError: (e) => Alert.alert('Could not resend invite', e?.message || 'Please try again.'),
  });

  // Campaign roster toggles — admin only.
  const assignMut = useMutation({
    mutationFn: () => api(`/admin/campaigns/${cId}/assignments`, { method: 'POST', body: { userIds: [u.id] } }),
    onSuccess: settle,
    onError: (e) => Alert.alert('Could not assign', e?.message || 'Please try again.'),
  });
  const unassignMut = useMutation({
    mutationFn: () => api(`/admin/campaigns/${cId}/assignments/${u.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      settle();
      onClose();
    },
    onError: (e) => Alert.alert('Could not remove', e?.message || 'Please try again.'),
  });

  const kpi = summaryQ.data?.kpi;
  const isSurvey = campaign?.type !== 'lit_drop';
  const activities = activityQ.data?.activities || [];
  const currentCoordName = member.coordinatorName || 'No coordinator';

  // First ~5 campaign names the switch reaches (minus excludeId), or null when the list isn't
  // usable — not loaded, errored, or empty after the exclusion.
  const reachNames = (excludeId) => {
    const names = (crewsQ.data?.crews || [])
      .filter((c) => String(c.campaignId) !== String(excludeId || ''))
      .map((c) => c.campaignName)
      .filter(Boolean);
    if (!names.length) return null;
    const shown = names.slice(0, 5).join(', ');
    return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
  };

  function confirmDeactivate() {
    const also = reachNames(cId);
    const scope = also
      ? `They lose access to this organization everywhere — this also takes them out of: ${also}.`
      : crewsQ.data
        ? `They lose access to this organization everywhere. ${campaign?.name || 'This campaign'} is the only campaign they're on.`
        : `They lose access to this organization everywhere — not just ${campaign?.name || 'this campaign'}.`;
    Alert.alert(
      `Deactivate ${name}?`,
      `${scope}\n\nTheir books stay theirs and every door they knocked still counts. You can switch them back on from here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Deactivate', style: 'destructive', onPress: () => statusMut.mutate('deactivate') },
      ]
    );
  }
  function confirmReactivate() {
    const all = reachNames(null);
    Alert.alert(
      `Reactivate ${name}?`,
      all
        ? `Access comes back for the whole organization — they rejoin: ${all}.`
        : 'Access comes back for the whole organization.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reactivate', onPress: () => statusMut.mutate('reactivate') },
      ]
    );
  }
  function confirmUnassign() {
    Alert.alert(
      `Remove ${name} from ${campaign?.name || 'this campaign'}?`,
      'Any books they hold here go back to the pool. Their work is kept — every door they knocked still counts toward this campaign.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => unassignMut.mutate() },
      ]
    );
  }

  function openDoorOnMap(a) {
    if (!a.household?.id) return;
    onClose();
    // The map's focus contract (see notes.jsx): household + a per-tap nonce + the door's campaign.
    router.push(`/(app)/admin/map?household=${a.household.id}&focusAt=${Date.now()}&hcid=${cId}`);
  }

  const pwProblem = pw.length > 0 ? tempPasswordProblem(pw) : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        {/* Android's system nav bar overlaps a bottom sheet without the inset. */}
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          {/* Identity */}
          <View style={styles.head}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(name) || '?'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{name}</Text>
                <View style={[styles.rolePill, member.role === 'canvasser' ? styles.rolePillNeutral : styles.rolePillBrand]}>
                  <Text style={[styles.rolePillText, member.role !== 'canvasser' && { color: colors.brand }]}>
                    {member.role === 'lead' ? 'team lead' : member.role}
                  </Text>
                </View>
              </View>
              <Text style={styles.sub} numberOfLines={1}>
                {u.email}
                {member.status === 'deactivated' ? ' · Deactivated' : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {/* KPIs in this campaign */}
            <Text style={styles.label}>In {campaign?.name || 'this campaign'}</Text>
            {summaryQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ alignSelf: 'flex-start' }} />
            ) : !kpi ? (
              <Text style={styles.muted}>No activity in this campaign yet.</Text>
            ) : (
              <View style={styles.kpiRow}>
                <View style={styles.kpiTile}>
                  <Text style={styles.kpiValue}>{(kpi.homesKnocked ?? 0).toLocaleString()}</Text>
                  <Text style={styles.kpiLabel}>doors</Text>
                </View>
                <View style={styles.kpiTile}>
                  <Text style={styles.kpiValue}>
                    {isSurvey
                      ? (kpi.surveyDoors ?? kpi.surveysSubmitted ?? 0).toLocaleString()
                      : (kpi.litDropped ?? 0).toLocaleString()}
                  </Text>
                  <Text style={styles.kpiLabel}>{isSurvey ? 'survey doors' : 'lit drops'}</Text>
                </View>
                <View style={styles.kpiTile}>
                  <Text style={styles.kpiValue}>{kpi.connectionRatePct ?? 0}%</Text>
                  <Text style={styles.kpiLabel}>conn</Text>
                </View>
                <View style={styles.kpiTile}>
                  <Text style={styles.kpiValue}>{(kpi.daysActive ?? 0).toLocaleString()}</Text>
                  <Text style={styles.kpiLabel}>days</Text>
                </View>
              </View>
            )}

            {/* Coordinator — a DROPDOWN (was a radio list labeled "Crew"). */}
            {isCanvasser && member.assigned ? (
              <>
                <Text style={styles.label}>Coordinator</Text>
                <Pressable style={styles.dropdown} onPress={() => setCoordOpen((v) => !v)}>
                  <Text style={styles.dropdownText}>
                    {pending !== null
                      ? (pending ? coordinators.find((c) => c.id === pending)?.name || '…' : 'No coordinator')
                      : currentCoordName}
                  </Text>
                  <Text style={styles.dropdownChevron}>{coordOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {coordOpen ? (
                  <View style={styles.dropdownList}>
                    {[{ id: '', name: 'No coordinator' }, ...coordinators.filter((c) => c.id !== u.id)].map((c) => {
                      const current = (pending ?? member.coordinatorId ?? '') === c.id;
                      return (
                        <Pressable
                          key={c.id || 'none'}
                          onPress={() => setPending(c.id)}
                          disabled={setCoordMut.isPending}
                          style={[styles.dropdownItem, current && styles.dropdownItemOn]}
                        >
                          <Text style={[styles.dropdownItemText, current && { color: colors.brand, fontWeight: '700' }]}>
                            {c.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {isPendingChange ? (
                  <View style={styles.confirmBox}>
                    {previewQ.isLoading ? (
                      <Text style={styles.muted}>Checking what would move…</Text>
                    ) : previewQ.error ? (
                      <Text style={styles.error}>Couldn't check what would move.</Text>
                    ) : (
                      <Text style={styles.confirmText}>
                        {previewQ.data?.doors
                          ? `Move ${previewQ.data.doors.toLocaleString()} door${previewQ.data.doors === 1 ? '' : 's'}` +
                            (previewQ.data.surveys ? ` and ${previewQ.data.surveys.toLocaleString()} survey${previewQ.data.surveys === 1 ? '' : 's'}` : '') +
                            ` ${previewQ.data.from ? `from ${previewQ.data.from.name}` : 'from no coordinator'}` +
                            ` ${previewQ.data.to ? `to ${previewQ.data.to.name}?` : 'to no coordinator?'}` +
                            `\nThis campaign only, all time.`
                          : `${name} has no past doors to move.`}
                        {previewQ.data?.subjectRunsCrew
                          ? `\n\n${name} runs a crew. Their own doors move; their crew's doors stay with them.`
                          : ''}
                      </Text>
                    )}
                    <View style={styles.confirmRow}>
                      <Pressable onPress={() => setPending(null)} style={styles.btnGhost} disabled={setCoordMut.isPending}>
                        <Text style={styles.btnGhostText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setCoordMut.mutate(pending)}
                        style={[styles.btnPrimary, (previewQ.isLoading || setCoordMut.isPending) && { opacity: 0.5 }]}
                        disabled={previewQ.isLoading || setCoordMut.isPending}
                      >
                        <Text style={styles.btnPrimaryText}>
                          {setCoordMut.isPending ? 'Moving…' : previewQ.data?.doors ? 'Move them' : 'Save'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            {/* Recent doors — every row opens that door on the live map. */}
            <Text style={styles.label}>Recent doors</Text>
            {activityQ.isLoading ? (
              <ActivityIndicator color={colors.brand} style={{ alignSelf: 'flex-start' }} />
            ) : activities.length === 0 ? (
              <Text style={styles.muted}>Nothing yet in this campaign.</Text>
            ) : (
              activities.map((a) => (
                <Pressable key={a.id} onPress={() => openDoorOnMap(a)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
                  <ActivityRow activity={a} showDate />
                </Pressable>
              ))
            )}
            {activities.length > 0 ? (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push({
                    pathname: `/(app)/admin/canvasser/${u.id}/activity`,
                    params: { campaignId: cId },
                  });
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>See all activity ›</Text>
              </Pressable>
            ) : null}

            {/* Temp password — admins for anyone; leads for canvassers on their campaigns. */}
            {canManageAccount && member.status !== 'deactivated' ? (
              <>
                <Pressable onPress={() => setPwOpen((v) => !v)} style={styles.link}>
                  <Text style={styles.linkText}>{pwOpen ? 'Cancel temporary password' : 'Set a temporary password…'}</Text>
                </Pressable>
                {pwOpen ? (
                  <View style={styles.pwBox}>
                    <PasswordInput value={pw} onChangeText={setPw} autoComplete="new-password" placeholder="New temporary password" />
                    {pwProblem ? <Text style={styles.error}>{pwProblem}</Text> : null}
                    <Text style={styles.mutedSmall}>They'll be required to change it at their next sign-in.</Text>
                    <Pressable
                      onPress={() => isValidTempPassword(pw) && pwMut.mutate(pw)}
                      style={[styles.btnPrimary, (!isValidTempPassword(pw) || pwMut.isPending) && { opacity: 0.5 }]}
                      disabled={!isValidTempPassword(pw) || pwMut.isPending}
                    >
                      <Text style={styles.btnPrimaryText}>{pwMut.isPending ? 'Setting…' : 'Set password'}</Text>
                    </Pressable>
                  </View>
                ) : null}
                {/* Never-signed-in only. lastLoginAt is written in exactly one place (a successful
                    login), so null is unambiguous — and resending kills any link they already
                    have, which would be gratuitous for someone already using the app. */}
                {!u.lastLoginAt ? (
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Resend invite?',
                        `Email ${u.email} a new set-password link.\n\nThis replaces any earlier invite or reset link — if they still have one, it will stop working.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Send', onPress: () => inviteMut.mutate() },
                        ]
                      )
                    }
                    style={styles.link}
                    disabled={inviteMut.isPending}
                  >
                    <Text style={styles.linkText}>
                      {inviteMut.isPending ? 'Sending invite…' : 'Resend invite…'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {/* Full drilldown (canvasser analytics screens). */}
            <Pressable
              onPress={() => {
                onClose();
                router.push({ pathname: `/(app)/admin/canvasser/${u.id}`, params: { campaignId: cId } });
              }}
              style={styles.link}
            >
              <Text style={styles.linkText}>Full canvasser view ›</Text>
            </Pressable>

            {/* The full profile page (identity, password, status). A lead can edit their
                canvassers' name/email/phone there (2026-08-09 ruling) — until this link existed
                the page was reachable only from the flat org view, which leads never see. */}
            {canManageAccount ? (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push(`/(app)/admin/users/${u.id}`);
                }}
                style={styles.link}
              >
                <Text style={styles.linkText}>Manage profile ›</Text>
              </Pressable>
            ) : null}

            {/* Campaign roster — admin only (a lead's people are auto-assigned on create). */}
            {isAdminViewer && cId ? (
              member.assigned ? (
                <Pressable onPress={confirmUnassign} style={styles.danger} disabled={unassignMut.isPending}>
                  <Text style={styles.dangerText}>Remove from this campaign</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => assignMut.mutate()} style={styles.btnPrimary} disabled={assignMut.isPending}>
                  <Text style={styles.btnPrimaryText}>{assignMut.isPending ? 'Assigning…' : 'Assign to this campaign'}</Text>
                </Pressable>
              )
            ) : null}

            {/* Account switch — org-wide by design; disclosed in the confirm. */}
            {canManageAccount ? (
              member.status === 'deactivated' || !member.isActive ? (
                <Pressable onPress={confirmReactivate} style={styles.link}>
                  <Text style={styles.linkText}>Reactivate account</Text>
                </Pressable>
              ) : (
                <Pressable onPress={confirmDeactivate} style={styles.danger}>
                  <Text style={styles.dangerText}>Deactivate account</Text>
                </Pressable>
              )
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    modalRoot: { flex: 1, justifyContent: 'flex-end' },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      maxHeight: '86%',
      ...shadow.card,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandTint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.brand, fontWeight: '800', fontSize: 16 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { ...type.h3, color: colors.textPrimary, flexShrink: 1 },
    rolePill: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: 1,
    },
    rolePillNeutral: { borderColor: colors.border, backgroundColor: colors.bg },
    rolePillBrand: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    rolePillText: { fontSize: 10, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
    sub: { ...type.caption, color: colors.textMuted },
    close: { fontSize: 26, color: colors.textMuted, paddingHorizontal: spacing.sm },
    label: {
      ...type.caption,
      color: colors.textMuted,
      textTransform: 'uppercase',
      fontWeight: '700',
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    muted: { ...type.caption, color: colors.textMuted },
    mutedSmall: { fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
    error: { ...type.caption, color: colors.danger, marginTop: spacing.xs },
    kpiRow: { flexDirection: 'row', gap: spacing.sm },
    kpiTile: {
      flex: 1,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      alignItems: 'center',
    },
    kpiValue: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    kpiLabel: { fontSize: 10, color: colors.textMuted, marginTop: 1 },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.bg,
    },
    dropdownText: { color: colors.textPrimary, fontWeight: '600' },
    dropdownChevron: { color: colors.textMuted },
    dropdownList: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      marginTop: spacing.xs,
      overflow: 'hidden',
    },
    dropdownItem: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    dropdownItemOn: { backgroundColor: colors.brandTint },
    dropdownItemText: { color: colors.textPrimary },
    confirmBox: {
      marginTop: spacing.sm,
      backgroundColor: colors.bg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
    },
    confirmText: { ...type.caption, color: colors.textPrimary },
    confirmRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
    pwBox: { marginTop: spacing.xs, gap: spacing.sm },
    btnPrimary: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    btnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
    btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    btnGhostText: { color: colors.textMuted, fontWeight: '600' },
    link: { paddingVertical: spacing.sm, marginTop: spacing.xs },
    linkText: { color: colors.brand, fontWeight: '700' },
    danger: { paddingVertical: spacing.sm, marginTop: spacing.xs },
    dangerText: { color: colors.danger, fontWeight: '700' },
  });
}
