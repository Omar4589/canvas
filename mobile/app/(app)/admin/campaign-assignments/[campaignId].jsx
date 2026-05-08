import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';

export default function CampaignAssignmentsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;
  const [search, setSearch] = useState('');

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });

  const membersQ = useQuery({
    queryKey: ['admin', 'memberships'],
    queryFn: () => api('/admin/memberships'),
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

  const campaign = (campaignsQ.data?.campaigns || []).find(
    (c) => String(c._id) === String(cId)
  );

  const canvassers = useMemo(
    () =>
      (membersQ.data?.members || []).filter(
        (m) => m.role === 'canvasser' && m.user.isActive && m.isActive
      ),
    [membersQ.data]
  );

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
        <View style={{ width: 60 }} />
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
                  </Text>
                  <Text style={styles.rowEmail} numberOfLines={1}>
                    {u.email}
                  </Text>
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
    </SafeAreaView>
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
    borderColor: '#FCA5A5',
    backgroundColor: colors.dangerBg,
  },
  actionText: { fontSize: 12, fontWeight: '700' },
  actionTextAssign: { color: colors.brand },
  actionTextUnassign: { color: colors.danger },
});
