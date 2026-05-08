import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadCurrentUser } from '../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function formatRelative(d) {
  if (!d) return 'Never';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default function SuperAdminUsersScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [me, setMe] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setMe(u));
  }, []);

  const usersQ = useQuery({
    queryKey: ['super-admin', 'users'],
    queryFn: () => api('/super-admin/users'),
  });

  const promoteMut = useMutation({
    mutationFn: (userId) => api(`/super-admin/users/${userId}/promote`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin', 'users'] }),
  });

  const users = usersQ.data?.users || [];
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'super' && !u.isSuperAdmin) return false;
      if (filter === 'active' && !u.isActive) return false;
      if (filter === 'inactive' && u.isActive) return false;
      if (term) {
        const hay = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [users, search, filter]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Control Room</Text>
        </Pressable>
        <Text style={styles.headerTitle}>All users</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.controls}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {[
            { v: 'all', l: 'All' },
            { v: 'super', l: 'Super admins' },
            { v: 'active', l: 'Active' },
            { v: 'inactive', l: 'Inactive' },
          ].map((opt) => {
            const active = filter === opt.v;
            return (
              <Pressable
                key={opt.v}
                onPress={() => setFilter(opt.v)}
                style={[styles.filterPill, active && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                  {opt.l}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {usersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No users match.</Text>
          </View>
        ) : (
          visible.map((u) => {
            const isSelf = me?.id === u.id;
            return (
              <View key={u.id} style={styles.userCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.userName}>
                      {u.firstName} {u.lastName}
                      {u.isSuperAdmin && (
                        <Text style={styles.superTag}>  super</Text>
                      )}
                    </Text>
                    <Text style={styles.userEmail}>{u.email}</Text>
                    <Text style={styles.userMeta}>
                      Last seen {formatRelative(u.lastLoginAt)}
                      {!u.isActive && ' · inactive'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => promoteMut.mutate(u.id)}
                    disabled={isSelf || promoteMut.isPending}
                    style={[
                      styles.promoteBtn,
                      u.isSuperAdmin ? styles.promoteBtnRemove : styles.promoteBtnAdd,
                      isSelf && { opacity: 0.4 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.promoteBtnText,
                        u.isSuperAdmin ? styles.promoteBtnTextRemove : styles.promoteBtnTextAdd,
                      ]}
                    >
                      {u.isSuperAdmin ? 'Remove super' : 'Make super'}
                    </Text>
                  </Pressable>
                </View>
                {u.memberships?.length ? (
                  <View style={styles.membershipsRow}>
                    {u.memberships.map((m) => (
                      <View
                        key={m.organizationId}
                        style={[
                          styles.membershipPill,
                          m.role === 'admin' ? styles.membershipPillAdmin : styles.membershipPillCanvasser,
                        ]}
                      >
                        <Text
                          style={[
                            styles.membershipPillText,
                            m.role === 'admin' ? styles.membershipPillTextAdmin : styles.membershipPillTextCanvasser,
                          ]}
                        >
                          {m.organizationName} · {m.role}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noMemberships}>No org memberships</Text>
                )}
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
  back: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  headerTitle: { ...type.h3 },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    gap: spacing.sm,
  },
  search: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.textPrimary,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingRight: spacing.lg,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterPillActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  filterPillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  filterPillTextActive: { color: colors.brand },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },

  userCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  userName: { ...type.bodyStrong, fontSize: 15 },
  superTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400E',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  userEmail: { ...type.caption, fontSize: 12, marginTop: 1 },
  userMeta: { ...type.caption, fontSize: 11, marginTop: 2, color: colors.textMuted },

  promoteBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  promoteBtnAdd: { borderColor: colors.border, backgroundColor: colors.bg },
  promoteBtnRemove: { borderColor: '#FCD34D', backgroundColor: '#FEF3C7' },
  promoteBtnText: { fontSize: 11, fontWeight: '700' },
  promoteBtnTextAdd: { color: colors.textPrimary },
  promoteBtnTextRemove: { color: '#92400E' },

  membershipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  membershipPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  membershipPillAdmin: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  membershipPillCanvasser: { backgroundColor: colors.bg, borderColor: colors.border },
  membershipPillText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  membershipPillTextAdmin: { color: colors.brand },
  membershipPillTextCanvasser: { color: colors.textSecondary },
  noMemberships: { ...type.caption, fontSize: 11, marginTop: spacing.sm, fontStyle: 'italic' },
});
