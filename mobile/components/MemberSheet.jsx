import { useEffect, useState } from 'react';
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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { loadCurrentUser } from '../lib/cache';
import ActivityRow from './ActivityRow';
import PasswordInput from './PasswordInput';
import { isValidTempPassword, tempPasswordProblem } from '../lib/validators';
import { DELETED_ACCOUNT_LABEL, deletionLine } from '../lib/memberDeletion';
import { standing } from '../lib/rosterView';
import {
  STATE_WORDS,
  isAdminRole,
  personAccess,
  personButtons,
  crewCheckLine,
  crewChangeLines,
  assignOneLine,
  crewConflictLine,
  RECENT_DOOR_ACTIONS,
} from '../lib/personActions';
import { usePausedList, invalidatePaceCaches } from '../lib/pacePauses';
import { pausedUserIds } from '../lib/pace';
import { useCampaignArchived } from '../lib/useCampaignArchived';
import { formatInTz } from '../lib/datetime';
import { radius, spacing } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';

// The member sheet — the one people-surface panel, shared by the Users hub for anyone on (or being put
// on) the chosen campaign. Replaces the campaign Team page's MemberPanel (that page merged into Users).
// From the top (docs/PROPOSAL_PEOPLE_PAGES.md §G, Part 1 "The person panel"):
//   - who they are, and where they stand (Deactivated, Paused for review, Never signed in…);
//   - the buttons for that state (lib/personActions.js personButtons) — Unpause asks first;
//   - the pause notice, with Review;
//   - this campaign's KPIs and their Coordinator (the phone keeps that word until the terms sweep,
//     plan §I). Opening the sheet checks their CURRENT crew (the coordinator preview with the crew
//     they have), so a change that didn't finish, or doors still counted for another team, offers
//     Finish it — with the count first. Every crew change sends the crew it previewed as
//     `fromCoordinatorId`, and a 409 (someone else changed it, or another change is still finishing)
//     checks again instead of overriding them;
//   - recent doors (the door outcomes and restricted only, never notes);
//   - Assign to this campaign (org admins), with a coordinator and what their earlier doors here do;
//   - More options ▸: Deactivate account, and Remove from this campaign — for a team lead, canvassers,
//     people no longer in the organization, and themselves (item 41).
// Capability rules are the server's; lib/personActions.js mirrors them so no dead button shows. A
// DELETED account gets none of the account actions, and never its email: that's the tombstone
// address. Its work stays viewable.
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
  member, // { role, status, coordinatorId, coordinatorName, assigned, user: {id,firstName,lastName,email,lastLoginAt,createdAt,isDeleted,isSuperAdmin,deletion} }
  campaign, // { id, name, type } — the selected campaign context (required)
  // Has this campaign used the off-by-default "Not a target voter" outcome? Resolved by the caller
  // (lib/useOutcomeInUse.js) — this sheet's { id, name, type } campaign does not carry the fields.
  notTargetInUse = false,
  coordinators, // [{ id, name }] who can run a crew: GET …/crew's `coordinators`
  coordinatorsStatus = 'success', // that query's status: 'pending' | 'error' | 'success'
  crewSize = 0, // how many people on this campaign have THIS person as their coordinator
  viewerRole, // 'super' | 'admin' | 'lead'
  onClose,
  onChanged, // invalidate caller queries after any write
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const u = member.user;
  const cId = campaign?.id;
  const isDeleted = !!u.isDeleted;
  const name = isDeleted
    ? DELETED_ACCOUNT_LABEL
    : `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
  const isAdminViewer = isAdminRole(viewerRole);
  const { canWrite } = useCampaignArchived(cId);

  // Who is looking: no temporary password, Deactivate or Unpause on your own sheet, and a team lead
  // may take themselves off the campaign.
  const [viewerId, setViewerId] = useState(null);
  useEffect(() => {
    let alive = true;
    loadCurrentUser().then((me) => {
      if (alive) setViewerId(me?.id ? String(me.id) : null);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Where they stand, and what this viewer may do about it.
  const pausedQ = usePausedList();
  const pausedIds = pausedUserIds(pausedQ.data);
  const st = standing({ userId: String(u.id), status: member.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt }, pausedIds);
  const target = { userId: String(u.id), role: member.role, status: member.status, isSuperAdmin: !!u.isSuperAdmin, lastLoginAt: u.lastLoginAt };
  const access = personAccess({ viewerRole, viewerId, target, onCampaign: !!member.assigned, campaignWritable: canWrite });
  // The pause this viewer can see and lift (a lead sees their own campaigns' pauses), or the roster line
  // for one on a campaign they don't manage, which names nothing about that campaign.
  const pausedHere = (pausedQ.data?.pauses || []).find(
    (p) => String(p.userId) === String(u.id) && p.status === 'paused' && p.blocking
  );
  const pausedElsewhere = !pausedHere && (pausedQ.data?.rosterLines || []).some((l) => String(l.userId) === String(u.id) && l.paused);
  // The open pause this viewer may lift: the blocking one, or for an org admin one that isn't blocking
  // right now (plan §D.5; the web panel's rule) — offered under More options.
  const openPause =
    pausedHere ||
    (isAdminViewer
      ? (pausedQ.data?.pauses || []).find((p) => String(p.userId) === String(u.id) && p.status === 'paused')
      : null) ||
    null;
  const buttons = personButtons({ st, access, canUnpause: !!openPause });
  const gone = st === 'deleted' || st === 'left';

  // Coordinator dropdown: staged pick + move preview + confirm. Finish it re-runs their current crew.
  // The crew they have NOW: the roster's, until a change here (or a 409's `now`) says otherwise — the
  // roster prop only catches up after its refetch, and the open-time check must never re-ask about
  // the crew they just left (the server would take that as a new pick, and refuse one who can't lead).
  const rosterCrew = member.coordinatorId || null;
  const [crewNow, setCrewNow] = useState({ roster: rosterCrew, id: rosterCrew });
  if (crewNow.roster !== rosterCrew) setCrewNow({ roster: rosterCrew, id: rosterCrew });
  const curId = crewNow.roster === rosterCrew ? crewNow.id : rosterCrew;
  const [coordOpen, setCoordOpen] = useState(false);
  const [pending, setPending] = useState(null); // staged coordinatorId ('' = none); null = nothing staged
  const isPendingChange = pending !== null && pending !== (curId || '');
  const [finishing, setFinishing] = useState(false);
  const [crewNote, setCrewNote] = useState(null);

  // Temp password: collapsed by default; expands to an inline form.
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  // Assign to this campaign (admins): a coordinator to join, and what their earlier doors here do.
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPick, setAssignPick] = useState('');
  const [assignListOpen, setAssignListOpen] = useState(false);
  const [assignNote, setAssignNote] = useState(null);

  const summaryQ = useQuery({
    queryKey: ['admin', 'campaign-member-summary', cId, u.id],
    queryFn: ({ signal }) => api(`/admin/reports/canvassers/${u.id}/summary?campaignId=${cId}`, { signal }),
    enabled: !!cId,
  });
  // The door outcomes and restricted only: without the list this read counts a note as a door.
  const activityQ = useQuery({
    queryKey: ['admin', 'campaign-member-activity', cId, u.id],
    queryFn: ({ signal }) =>
      api(`/admin/reports/canvassers/${u.id}/activities?campaignId=${cId}&actionType=${RECENT_DOOR_ACTIONS}&limit=5`, { signal }),
    enabled: !!cId,
  });
  // Opening someone checks their CURRENT crew: `unfinished`, `busy` and the rows still off it decide
  // whether Finish it shows (`finishIt`). The current crew is never validated, so a switched-off
  // coordinator's crew still checks.
  const currentQ = useQuery({
    queryKey: ['admin', 'coordinator-preview', cId, u.id, 'current', curId || 'none'],
    queryFn: ({ signal }) =>
      api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator-preview?coordinatorId=${curId || 'none'}`, { signal }),
    enabled: !!cId && access.crew,
    retry: false,
  });
  const previewQ = useQuery({
    queryKey: ['admin', 'coordinator-preview', cId, u.id, pending],
    queryFn: ({ signal }) =>
      api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator-preview?coordinatorId=${pending || 'none'}`, { signal }),
    enabled: !!cId && isPendingChange,
    retry: false,
  });
  // One person's check before Assign: the bulk preview, which (for an org admin) reads someone not on
  // the campaign yet. The single preview only answers for people already on it.
  const assignPreviewQ = useQuery({
    queryKey: ['admin', 'crew-bulk-preview', cId, u.id, assignPick || 'none'],
    queryFn: ({ signal }) =>
      api(`/admin/campaigns/${cId}/crew/coordinator-bulk/preview`, {
        method: 'POST',
        body: { userIds: [String(u.id)], coordinatorId: assignPick || null, intent: 'join' },
        signal,
      }),
    enabled: !!cId && assignOpen && access.assign,
    retry: false,
  });
  // Which campaigns an org-wide account switch reaches. /crews names EVERY campaign the person
  // is rostered on — including ones this viewer doesn't manage — which is exactly the point of
  // the disclosure. (Never resolve ids against /admin/campaigns: that list is lead-scoped and
  // would drop the campaigns the warning exists to name.) Loaded eagerly so the names are
  // ready when the confirm opens; if it hasn't settled, the confirms fall back to their
  // generic org-wide sentence rather than blocking the action.
  const crewsQ = useQuery({
    queryKey: ['admin', 'member-crews', u.id],
    queryFn: ({ signal }) => api(`/admin/memberships/${u.id}/crews`, { signal }),
    enabled: !gone,
  });

  const settle = () => onChanged?.();
  const recheckCrew = () => qc.invalidateQueries({ queryKey: ['admin', 'coordinator-preview', cId, u.id] });

  // `from` is the crew the check showed: the change goes through only if it is still that.
  // The lists and crew checks refresh from the mutation itself, so they still do if the sheet has gone
  // by the time the answer comes (mutate()'s own callbacks don't run once it has).
  const setCoordMut = useMutation({
    mutationFn: ({ to, from }) =>
      api(`/admin/campaigns/${cId}/crew/${u.id}/coordinator`, {
        method: 'PATCH',
        body: { coordinatorId: to || null, fromCoordinatorId: from || null },
      }),
    onSettled: () => {
      settle();
      recheckCrew();
    },
  });
  const saveCrew = ({ to, from, finish = false }) => {
    setCrewNote(null);
    setCoordMut.mutate(
      { to, from },
      {
        onSuccess: (res) => {
          setCrewNow((c) => ({ ...c, id: res?.coordinatorId ? String(res.coordinatorId) : null }));
          setPending(null);
          setFinishing(false);
          setCoordOpen(false);
          if (res?.restamp?.error) setCrewNote("Their doors didn't finish moving. Choose Finish it to complete it.");
          else if (finish) setCrewNote('Finished. Their doors here count for this coordinator now.');
        },
        onError: (e) => {
          // Someone else changed it, or another change for them is still finishing: check again and
          // show the new numbers rather than overriding them. The staged pick stays staged.
          const conflict = crewConflictLine(e, name);
          if (conflict) {
            if (e?.data?.code === 'changed-meanwhile') {
              setCrewNow((c) => ({ ...c, id: e.data.now ? String(e.data.now) : null }));
            }
            setCrewNote(conflict);
            return;
          }
          setPending(null);
          setFinishing(false);
          Alert.alert('Could not change coordinator', e?.message || 'Please try again.');
        },
      }
    );
  };

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
  // Re-send the set-password invite: someone who never signed in, or (under More options) an older
  // account with no sign-in on record. Each new link replaces any earlier one.
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
  const unpauseMut = useMutation({
    mutationFn: (pauseId) => api(`/admin/pace-pauses/${pauseId}/unpause`, { method: 'POST' }),
    onSuccess: () => {
      invalidatePaceCaches(qc);
      Alert.alert('Unpaused', `${name} can record again.`);
    },
    onError: (e) => {
      invalidatePaceCaches(qc);
      Alert.alert('Could not unpause', e?.message || 'Please try again.');
    },
  });

  // Campaign roster: Assign (admins), with the coordinator picked; Remove (admins; a lead for
  // canvassers, people no longer in the org, and themselves).
  const assignMut = useMutation({
    mutationFn: (coordinatorId) =>
      api(`/admin/campaigns/${cId}/assignments`, { method: 'POST', body: { userIds: [String(u.id)], coordinatorId } }),
    onSettled: () => settle(),
  });
  const assign = () =>
    assignMut.mutate(assignPick || null, {
      onSuccess: (res) => {
        const skip = (res?.crew?.skipped || []).find((s) => String(s.userId) === String(u.id));
        setAssignOpen(false);
        setAssignNote(
          skip?.reason === 'already-on-campaign'
            ? 'Already on this campaign: someone else added them.'
            : skip?.reason === 'unfinished'
              ? "Added. Their earlier doors didn't finish moving: choose Finish it."
              : skip?.reason === 'error'
                ? `Couldn't add them: ${skip.error || 'please try again.'}`
                : null
        );
      },
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
  // A coordinator who was switched off (or changed role) keeps their crew but can't be picked: the
  // dropdown shows them as the current choice, labelled, rather than "No coordinator" beside a Finish it.
  // Only once the list has loaded can "not in it" mean "can't be picked".
  const coordinatorsReady = coordinatorsStatus === 'success';
  const currentPickable = !curId || !coordinatorsReady || coordinators.some((c) => c.id === curId);
  const curName = curId === rosterCrew ? member.coordinatorName : coordinators.find((c) => c.id === curId)?.name;
  const currentCoordName = curId
    ? `${curName || 'Unknown'}${currentPickable ? '' : ', switched off'}`
    : 'No coordinator';
  // A check that failed to refresh says nothing, rather than an answer from before the last change.
  const checkLine = currentQ.isError ? null : crewCheckLine(currentQ.data, name);
  const assignRow = (assignPreviewQ.data?.people || []).find((p) => String(p.userId) === String(u.id));
  const assignPickName = assignPick ? coordinators.find((c) => c.id === assignPick)?.name || null : null;

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

  // Every confirm here puts Cancel FIRST: Android lays the buttons out in array order.
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
    // Taking a coordinator off leaves their crew with no coordinator; their past doors stay put.
    const crewLine =
      crewSize > 0
        ? `\n\n${name} runs a crew here: ${crewSize.toLocaleString()} ${crewSize === 1 ? 'person' : 'people'} will have no coordinator. Their past doors stay on ${name}'s team.`
        : '';
    Alert.alert(
      `Remove ${name} from ${campaign?.name || 'this campaign'}?`,
      `Any books they hold here go back to the pool. Their work is kept — every door they knocked still counts toward this campaign.${crewLine}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => unassignMut.mutate() },
      ]
    );
  }
  function confirmResend() {
    Alert.alert(
      'Resend invite?',
      `Email ${u.email} a new set-password link.\n\nThis replaces any earlier invite or reset link — if they still have one, it will stop working.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send', onPress: () => inviteMut.mutate() },
      ]
    );
  }
  function confirmUnpause() {
    if (!openPause) return;
    Alert.alert(
      `Unpause ${name}?`,
      'They can record again right away, and their count starts over. Nothing they saved is changed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Unpause', onPress: () => unpauseMut.mutate(openPause.id) },
      ],
      { cancelable: true }
    );
  }

  // A crew save or an add still out keeps the sheet open, whichever way out is tapped: its answer (the
  // note, the error) lands here. The save takes about 2 s (its second pass catches doors saved meanwhile).
  const saving = setCoordMut.isPending || assignMut.isPending;
  const leave = (then) => {
    if (saving) return;
    onClose();
    then?.();
  };

  function openDoorOnMap(a) {
    if (!a.household?.id) return;
    // The map's focus contract (see notes.jsx): household + a per-tap nonce + the door's campaign.
    leave(() => router.push(`/(app)/admin/map?household=${a.household.id}&focusAt=${Date.now()}&hcid=${cId}`));
  }

  const pwProblem = pw.length > 0 ? tempPasswordProblem(pw) : null;

  // One button per action key, wherever personButtons puts it.
  const TOP = {
    reactivate: { label: 'Reactivate account', onPress: confirmReactivate, busy: statusMut.isPending },
    resend: { label: inviteMut.isPending ? 'Sending invite…' : 'Resend invite', onPress: confirmResend, busy: inviteMut.isPending },
    'temp-password': { label: pwOpen ? 'Cancel temporary password' : 'Set temporary password', onPress: () => setPwOpen((v) => !v) },
    unpause: { label: unpauseMut.isPending ? 'Unpausing…' : 'Unpause', onPress: confirmUnpause, busy: unpauseMut.isPending },
  };
  const MORE = {
    unpause: { label: unpauseMut.isPending ? 'Unpausing…' : 'Unpause…', onPress: confirmUnpause, busy: unpauseMut.isPending },
    resend: { label: inviteMut.isPending ? 'Sending invite…' : 'Resend invite…', onPress: confirmResend, busy: inviteMut.isPending },
    'temp-password': { label: pwOpen ? 'Cancel temporary password' : 'Set a temporary password…', onPress: () => setPwOpen((v) => !v) },
    deactivate: { label: 'Deactivate account', onPress: confirmDeactivate, danger: true, busy: statusMut.isPending },
    remove: { label: unassignMut.isPending ? 'Removing…' : 'Remove from this campaign', onPress: confirmUnassign, danger: true, busy: unassignMut.isPending },
  };

  const pwForm = pwOpen ? (
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
  ) : null;

  const stateWord = STATE_WORDS[st];
  const closeSheet = () => leave();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={closeSheet}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={closeSheet} />
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
              {isDeleted ? (
                u.deletion ? (
                  <Text style={styles.sub} numberOfLines={2}>
                    {deletionLine(u.deletion)}
                  </Text>
                ) : null
              ) : (
                <Text style={styles.sub} numberOfLines={1}>
                  {u.email}
                  {stateWord ? ` · ${stateWord}` : ''}
                </Text>
              )}
            </View>
            <Pressable onPress={closeSheet} hitSlop={8} disabled={saving}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
            {/* The buttons for where they stand, at the top. */}
            {buttons.top.length ? (
              <View style={styles.stateRow}>
                {buttons.top.map((key, i) => {
                  const b = TOP[key];
                  return (
                    <Pressable
                      key={key}
                      onPress={b.onPress}
                      disabled={b.busy}
                      style={[i === 0 ? styles.stateBtnPrimary : styles.stateBtn, b.busy && { opacity: 0.6 }]}
                    >
                      <Text style={i === 0 ? styles.stateBtnPrimaryText : styles.stateBtnText}>{b.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {buttons.top.includes('temp-password') ? pwForm : null}
            {access.staff ? <Text style={styles.muted}>Managed by Doorline staff.</Text> : null}

            {/* Paused for review: since when, where, and Review. A pause on a campaign this viewer
                doesn't manage shows only the shipped line. */}
            {pausedHere ? (
              <Pressable
                onPress={() => leave(() => router.push(`/(app)/admin/pause/${pausedHere.id}`))}
                style={({ pressed }) => [styles.pauseBox, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
              >
                <Text style={styles.pauseText}>
                  Paused for review on {pausedHere.campaignName || 'a campaign'} since{' '}
                  {formatInTz(pausedHere.firedAt, pausedHere.timeZone)} · Review ›
                </Text>
              </Pressable>
            ) : pausedElsewhere ? (
              <View style={styles.pauseBox}>
                <Text style={styles.pauseText}>Paused for review — an org admin can unpause.</Text>
              </View>
            ) : null}

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
                {isSurvey && notTargetInUse ? (
                  <View style={styles.kpiTile}>
                    <Text style={styles.kpiValue}>{(kpi.notTarget ?? 0).toLocaleString()}</Text>
                    <Text style={styles.kpiLabel}>not target</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Coordinator — a DROPDOWN, for anyone on the team. On an archived campaign it reads only. */}
            {access.crew ? (
              <>
                <Text style={styles.label}>Coordinator</Text>
                {access.crewWritable ? (
                  <Pressable style={styles.dropdown} onPress={() => setCoordOpen((v) => !v)} disabled={setCoordMut.isPending}>
                    <Text style={styles.dropdownText}>
                      {pending !== null
                        ? (pending ? coordinators.find((c) => c.id === pending)?.name || '…' : 'No coordinator')
                        : currentCoordName}
                    </Text>
                    <Text style={styles.dropdownChevron}>{coordOpen ? '▴' : '▾'}</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.dropdownText}>{currentCoordName}</Text>
                )}
                {coordOpen && access.crewWritable ? (
                  <View style={styles.dropdownList}>
                    {curId && !currentPickable ? (
                      <View style={[styles.dropdownItem, styles.dropdownItemOn]}>
                        <Text style={[styles.dropdownItemText, { color: colors.textMuted }]}>{currentCoordName}</Text>
                      </View>
                    ) : null}
                    {[{ id: '', name: 'No coordinator' }, ...coordinators.filter((c) => c.id !== String(u.id))].map((c) => {
                      const current = (pending ?? curId ?? '') === c.id;
                      return (
                        <Pressable
                          key={c.id || 'none'}
                          onPress={() => {
                            setFinishing(false);
                            setCrewNote(null);
                            setPending(c.id);
                          }}
                          disabled={setCoordMut.isPending}
                          style={[styles.dropdownItem, current && styles.dropdownItemOn]}
                        >
                          <Text style={[styles.dropdownItemText, current && { color: colors.brand, fontWeight: '700' }]}>
                            {c.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {coordinatorsStatus === 'pending' ? (
                      <View style={styles.dropdownItem}>
                        <Text style={[styles.dropdownItemText, { color: colors.textMuted }]}>Loading who can run a crew…</Text>
                      </View>
                    ) : coordinatorsStatus === 'error' ? (
                      <View style={styles.dropdownItem}>
                        <Text style={[styles.dropdownItemText, { color: colors.danger }]}>Couldn't load who can run a crew.</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* The open-time check: a change that didn't finish, doors still on another team, or
                    another change still running. Finish it shows the count first. */}
                {checkLine && !isPendingChange ? (
                  <View style={styles.checkBox}>
                    <Text style={styles.checkText}>{checkLine}</Text>
                    {currentQ.data?.finishIt && access.crewWritable && !finishing ? (
                      <Pressable onPress={() => setFinishing(true)} style={styles.btnOutline}>
                        <Text style={styles.btnOutlineText}>Finish it</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {finishing && currentQ.data?.finishIt && !isPendingChange ? (
                  <View style={styles.confirmBox}>
                    {crewChangeLines(currentQ.data, { name, finishing: true }).map((line, i) => (
                      <Text key={i} style={[styles.confirmText, i > 0 && { marginTop: spacing.xs }]}>{line}</Text>
                    ))}
                    <View style={styles.confirmRow}>
                      <Pressable onPress={() => setFinishing(false)} style={styles.btnGhost} disabled={setCoordMut.isPending}>
                        <Text style={styles.btnGhostText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          // The current crew as both the pick and `from`.
                          const cur = currentQ.data.from?.id ?? null;
                          saveCrew({ to: cur, from: cur, finish: true });
                        }}
                        style={[styles.btnPrimary, setCoordMut.isPending && { opacity: 0.5 }]}
                        disabled={setCoordMut.isPending}
                      >
                        <Text style={styles.btnPrimaryText}>{setCoordMut.isPending ? 'Saving…' : 'Finish it'}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {isPendingChange ? (
                  <View style={styles.confirmBox}>
                    {previewQ.isLoading ? (
                      <Text style={styles.muted}>Checking what would move…</Text>
                    ) : previewQ.error ? (
                      <Text style={styles.error}>{previewQ.error.message || "Couldn't check what would move."}</Text>
                    ) : (
                      crewChangeLines(previewQ.data, { name }).map((line, i) => (
                        <Text key={i} style={[styles.confirmText, i > 0 && { marginTop: spacing.xs }]}>{line}</Text>
                      ))
                    )}
                    {crewNote ? <Text style={styles.error}>{crewNote}</Text> : null}
                    <View style={styles.confirmRow}>
                      <Pressable
                        onPress={() => {
                          setPending(null);
                          setCrewNote(null);
                        }}
                        style={styles.btnGhost}
                        disabled={setCoordMut.isPending}
                      >
                        <Text style={styles.btnGhostText}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        // The crew the check showed, as `from`: the change goes through only if it's still that.
                        onPress={() => saveCrew({ to: pending, from: previewQ.data?.from?.id ?? null })}
                        style={[styles.btnPrimary, (!previewQ.data || setCoordMut.isPending) && { opacity: 0.5 }]}
                        disabled={!previewQ.data || setCoordMut.isPending}
                      >
                        <Text style={styles.btnPrimaryText}>
                          {setCoordMut.isPending ? 'Moving…' : previewQ.data?.doors ? 'Move them' : 'Save'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : crewNote ? (
                  <Text style={styles.note}>{crewNote}</Text>
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
                onPress={() =>
                  leave(() =>
                    router.push({
                      pathname: `/(app)/admin/canvasser/${u.id}/activity`,
                      params: { campaignId: cId },
                    })
                  )
                }
                style={styles.link}
              >
                <Text style={styles.linkText}>See all activity ›</Text>
              </Pressable>
            ) : null}

            {/* Full drilldown (canvasser analytics screens). */}
            <Pressable
              onPress={() => leave(() => router.push({ pathname: `/(app)/admin/canvasser/${u.id}`, params: { campaignId: cId } }))}
              style={styles.link}
            >
              <Text style={styles.linkText}>Full canvasser view ›</Text>
            </Pressable>

            {/* The full profile page (identity, password, status). A lead can edit their
                canvassers' name/email/phone there (2026-08-09 ruling) — until this link existed
                the page was reachable only from the flat org view, which leads never see. Someone
                no longer in the organization has no profile to open. */}
            {(isAdminViewer || access.manage) && st !== 'left' ? (
              <Pressable onPress={() => leave(() => router.push(`/(app)/admin/users/${u.id}`))} style={styles.link}>
                <Text style={styles.linkText}>Manage profile ›</Text>
              </Pressable>
            ) : null}

            {/* Assign to this campaign — org admins, with the coordinator they join and what their
                earlier doors here do (doors follow the person: they move to that crew, or to No team). */}
            {access.assign ? (
              assignOpen ? (
                <View style={styles.confirmBox}>
                  <Text style={styles.confirmText}>Coordinator on {campaign?.name || 'this campaign'}</Text>
                  <Pressable style={[styles.dropdown, { marginTop: spacing.xs }]} onPress={() => setAssignListOpen((v) => !v)} disabled={assignMut.isPending}>
                    <Text style={styles.dropdownText}>{assignPickName || 'No coordinator'}</Text>
                    <Text style={styles.dropdownChevron}>{assignListOpen ? '▴' : '▾'}</Text>
                  </Pressable>
                  {assignListOpen ? (
                    <View style={styles.dropdownList}>
                      {[{ id: '', name: 'No coordinator' }, ...coordinators.filter((c) => c.id !== String(u.id))].map((c) => {
                        const on = assignPick === c.id;
                        return (
                          <Pressable
                            key={c.id || 'none'}
                            onPress={() => {
                              setAssignPick(c.id);
                              setAssignListOpen(false);
                            }}
                            style={[styles.dropdownItem, on && styles.dropdownItemOn]}
                          >
                            <Text style={[styles.dropdownItemText, on && { color: colors.brand, fontWeight: '700' }]}>{c.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {assignPreviewQ.isLoading ? (
                    <Text style={[styles.muted, { marginTop: spacing.sm }]}>Checking their doors here…</Text>
                  ) : assignPreviewQ.error ? (
                    <Text style={styles.error}>{assignPreviewQ.error.message || "Couldn't check their doors here."}</Text>
                  ) : assignRow ? (
                    <Text style={[styles.confirmText, { marginTop: spacing.sm }]}>{assignOneLine(assignRow, assignPickName)}</Text>
                  ) : null}
                  <View style={styles.confirmRow}>
                    <Pressable onPress={() => setAssignOpen(false)} style={styles.btnGhost} disabled={assignMut.isPending}>
                      <Text style={styles.btnGhostText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={assign}
                      style={[styles.btnPrimary, (assignMut.isPending || assignPreviewQ.isLoading) && { opacity: 0.5 }]}
                      disabled={assignMut.isPending || assignPreviewQ.isLoading}
                    >
                      <Text style={styles.btnPrimaryText}>{assignMut.isPending ? 'Assigning…' : 'Assign'}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    setAssignNote(null);
                    setAssignOpen(true);
                  }}
                  style={styles.btnPrimary}
                >
                  <Text style={styles.btnPrimaryText}>Assign to this campaign</Text>
                </Pressable>
              )
            ) : null}
            {assignNote ? <Text style={styles.note}>{assignNote}</Text> : null}

            {/* More options ▸ — an inline fold-out, not a menu: the rarer actions, Deactivate and
                Remove among them, out of the way of a stray tap. */}
            {buttons.more.length ? (
              <>
                <Pressable
                  onPress={() => setMoreOpen((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: moreOpen }}
                  hitSlop={8}
                  style={styles.link}
                >
                  <Text style={styles.linkText}>More options {moreOpen ? '▾' : '▸'}</Text>
                </Pressable>
                {moreOpen
                  ? buttons.more.map((key) => {
                      const b = MORE[key];
                      return (
                        <Pressable key={key} onPress={b.onPress} disabled={b.busy} style={styles.link}>
                          <Text style={b.danger ? styles.dangerText : styles.linkText}>{b.label}</Text>
                        </Pressable>
                      );
                    })
                  : null}
                {moreOpen && buttons.more.includes('temp-password') ? pwForm : null}
              </>
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
    stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xs },
    stateBtnPrimary: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    stateBtnPrimaryText: { color: colors.textInverse, fontWeight: '700' },
    stateBtn: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    stateBtnText: { color: colors.textPrimary, fontWeight: '600' },
    pauseBox: {
      marginTop: spacing.sm,
      backgroundColor: colors.dangerBg,
      borderRadius: radius.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    pauseText: { ...type.caption, color: colors.dangerFg, fontWeight: '600' },
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
    note: { ...type.caption, color: colors.textSecondary, marginTop: spacing.xs },
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
    dropdownText: { color: colors.textPrimary, fontWeight: '600', flexShrink: 1 },
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
    checkBox: {
      marginTop: spacing.sm,
      backgroundColor: colors.warnBg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      padding: spacing.md,
      gap: spacing.sm,
    },
    checkText: { ...type.caption, color: colors.warnFg, fontWeight: '600' },
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
    btnOutline: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: colors.warnFg,
      borderRadius: radius.md,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
    },
    btnOutlineText: { color: colors.warnFg, fontWeight: '700' },
    btnGhost: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    btnGhostText: { color: colors.textMuted, fontWeight: '600' },
    link: { paddingVertical: spacing.sm, marginTop: spacing.xs },
    linkText: { color: colors.brand, fontWeight: '700' },
    dangerText: { color: colors.danger, fontWeight: '700' },
  });
}
