import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useInfinitePaged } from '../../../lib/useInfinitePaged';
import { loadCurrentUser } from '../../../lib/cache';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

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

// Filter pills → server query params: the phone no longer downloads the whole user table.
const FILTERS = [
  { v: 'all', l: 'All', params: {} },
  { v: 'super', l: 'Super admins', params: { super: '1' } },
  { v: 'active', l: 'Active', params: { active: '1' } },
  { v: 'inactive', l: 'Inactive', params: { active: '0' } },
  { v: 'deleted', l: 'Deleted', params: { deleted: '1' } },
];

export default function SuperAdminUsersScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [me, setMe] = useState(null);
  const [clearedId, setClearedId] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setMe(u));
  }, []);

  // Debounced server search — the query param, not a client filter over a full download.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const usersQ = useInfinitePaged(
    ['super-admin', 'users', 'list', q, filter],
    '/super-admin/users',
    { q, ...(FILTERS.find((f) => f.v === filter)?.params || {}) },
    { limit: 50, itemsKey: 'users' }
  );

  const promoteMut = useMutation({
    mutationFn: (userId) => api(`/super-admin/users/${userId}/promote`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-admin', 'users'] }),
    // Surface refusals (break-glass required, last-break-glass guard) instead of swallowing them.
    onError: (err) => Alert.alert('Could not change super-admin', err.message),
  });

  const clearLockoutMut = useMutation({
    mutationFn: (userId) => api(`/super-admin/users/${userId}/clear-lockout`, { method: 'POST' }),
    onSuccess: (_data, userId) => {
      setClearedId(userId);
      setTimeout(() => setClearedId((id) => (id === userId ? null : id)), 2500);
    },
    onError: (err) => Alert.alert('Could not clear lockout', err.message),
  });

  const visible = usersQ.items;
  const lastPage = usersQ.data?.pages?.[usersQ.data.pages.length - 1];
  const deletedCount = lastPage?.deletedCount || 0;
  // Promote is break-glass-gated server-side; hide it from support-tier supers (an older cached
  // profile may predate platformRole — then the button stays and the server still refuses).
  const canPromote = me?.platformRole !== 'support';

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
          {FILTERS.map((opt) => {
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
        {!usersQ.isLoading && (
          <Text style={styles.countLine}>
            {/* Deleted tombstones counted apart so they never inflate the headline. */}
            {filter === 'deleted'
              ? `${usersQ.total} deleted account${usersQ.total === 1 ? '' : 's'}`
              : `${(usersQ.total - deletedCount).toLocaleString()} account${usersQ.total - deletedCount === 1 ? '' : 's'}${deletedCount ? ` · ${deletedCount} deleted` : ''}`}
          </Text>
        )}
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
                        <Text style={styles.superTag}>  {u.platformRole === 'break_glass' ? 'break-glass' : 'support'}</Text>
                      )}
                      {u.deletedAt && <Text style={styles.deletedTag}>  deleted</Text>}
                    </Text>
                    <Text style={styles.userEmail}>{u.email}</Text>
                    <Text style={styles.userMeta}>
                      Last login {formatRelative(u.lastLoginAt)}
                      {u.lastActivityAt ? ` · canvassed ${formatRelative(u.lastActivityAt)}` : ''}
                      {!u.isActive && ' · inactive'}
                    </Text>
                  </View>
                  {canPromote && !u.deletedAt && (
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
                  )}
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
                {!u.deletedAt && (
                  <Pressable
                    onPress={() => clearLockoutMut.mutate(u.id)}
                    disabled={clearLockoutMut.isPending}
                    style={styles.lockoutBtn}
                    hitSlop={6}
                  >
                    <Text style={styles.lockoutBtnText}>
                      {clearedId === u.id ? 'Lockout cleared ✓' : 'Clear login lockout'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
        {usersQ.hasNextPage && (
          <Pressable
            onPress={() => usersQ.fetchNextPage()}
            disabled={usersQ.isFetchingNextPage}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreText}>
              {usersQ.isFetchingNextPage ? 'Loading…' : `Load more (${visible.length} of ${usersQ.total})`}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
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
    color: colors.warnFg,
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
  promoteBtnRemove: { borderColor: colors.warnBorder, backgroundColor: colors.warnBg },
  promoteBtnText: { fontSize: 11, fontWeight: '700' },
  promoteBtnTextAdd: { color: colors.textPrimary },
  promoteBtnTextRemove: { color: colors.warnFg },

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

  countLine: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm },
  deletedTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  lockoutBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  lockoutBtnText: { fontSize: 11, fontWeight: '700', color: colors.brand },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    marginTop: spacing.xs,
  },
  loadMoreText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  });
}
