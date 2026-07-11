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
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { loadCurrentUser } from '../../../../lib/cache';
import PasswordInput from '../../../../components/PasswordInput';
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

  const canvassers = useMemo(() => {
    const list = (membersQ.data?.members || []).filter(
      (m) => m.role === 'canvasser' && m.user.isActive && m.isActive
    );
    const selfId = self?.id ? String(self.id) : null;
    if (selfId && !list.some((m) => String(m.user.id) === selfId)) {
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
  }, [membersQ.data, self]);

  const assignedSet = useMemo(
    () => new Set((assignmentsQ.data?.assignments || []).map((a) => a.userId)),
    [assignmentsQ.data]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return canvassers;
    return canvassers.filter((m) => {
      const hay = `${m.user.firstName} ${m.user.lastName} ${m.user.email}`.toLowerCase();
      return hay.includes(term);
    });
  }, [canvassers, search]);

  function toggle(userId) {
    if (assignedSet.has(userId)) unassignMut.mutate(userId);
    else assignMut.mutate([userId]);
  }

  function bulkAssignAll() {
    const ids = filtered.map((m) => m.user.id).filter((id) => !assignedSet.has(id));
    if (ids.length) assignMut.mutate(ids);
  }

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
            <Text style={styles.emptyText}>
              {canvassers.length === 0
                ? 'No canvassers in this org yet. Add some from Users.'
                : 'No matches.'}
            </Text>
          </View>
        ) : (
          filtered.map((m) => {
            const u = m.user;
            const assigned = assignedSet.has(u.id);
            return (
              <View key={u.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>
                    {u.firstName} {u.lastName}
                    {m.isSelf ? <Text style={styles.youTag}>  You</Text> : null}
                  </Text>
                  {u.email ? (
                    <Text style={styles.rowEmail} numberOfLines={1}>
                      {u.email}
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
              </View>
            );
          })
        )}
      </ScrollView>

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

  const valid = linkExisting
    ? !!email.trim()
    : firstName.trim() && lastName.trim() && email.trim() && isValidTempPassword(password);
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
              : 'Creates a canvasser and adds them to this campaign. Set a temporary password — they choose their own strong one at first sign-in.'}
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
                <Text style={styles.formLabel}>Temporary password (min 8)</Text>
                <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" placeholder="At least 8 characters" />
                {pwProblem ? <Text style={styles.modalError}>{pwProblem}</Text> : null}
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
