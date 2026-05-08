import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import PasswordInput from '../../../components/PasswordInput';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

const SORT_OPTIONS = [
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'recent-joined', label: 'Recently joined' },
  { key: 'recent-active', label: 'Recently active' },
];

function compareName(a, b, dir) {
  const an = `${a.lastName} ${a.firstName}`.toLowerCase();
  const bn = `${b.lastName} ${b.firstName}`.toLowerCase();
  if (an < bn) return dir === 'asc' ? -1 : 1;
  if (an > bn) return dir === 'asc' ? 1 : -1;
  return 0;
}

function compareDate(a, b, key) {
  const av = a[key] ? new Date(a[key]).getTime() : 0;
  const bv = b[key] ? new Date(b[key]).getTime() : 0;
  if (av === 0 && bv === 0) return 0;
  if (av === 0) return 1;
  if (bv === 0) return -1;
  return bv - av;
}

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function UserCard({ user, onPress }) {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.userCard, pressed && { opacity: 0.85 }]}
    >
      <View
        style={[
          styles.userAvatar,
          user.role === 'admin' && { backgroundColor: colors.brandTint },
        ]}
      >
        <Text
          style={[
            styles.userAvatarText,
            user.role === 'admin' && { color: colors.brand },
          ]}
        >
          {initials(name) || '?'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.userName}>{name || user.email}</Text>
        <Text style={styles.userEmail} numberOfLines={1}>
          {user.email}
        </Text>
        <View style={styles.userPills}>
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
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function FilterPill({ active, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.filterPill, active && styles.filterPillActive]}
    >
      <Text
        style={[
          styles.filterPillText,
          active && styles.filterPillTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function AdminUsers() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name-asc');
  const [sortPickerOpen, setSortPickerOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api('/admin/users'),
  });

  const createUser = useMutation({
    mutationFn: (body) => api('/admin/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setShowCreate(false);
    },
  });

  const users = usersQ.data?.users || [];

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'inactive' && u.isActive) return false;
      if (term) {
        const hay = `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    list = list.slice();
    if (sortMode === 'name-asc') list.sort((a, b) => compareName(a, b, 'asc'));
    else if (sortMode === 'name-desc')
      list.sort((a, b) => compareName(a, b, 'desc'));
    else if (sortMode === 'recent-joined')
      list.sort((a, b) => compareDate(a, b, 'createdAt'));
    else if (sortMode === 'recent-active')
      list.sort((a, b) => compareDate(a, b, 'lastLoginAt'));
    return list;
  }, [users, search, roleFilter, statusFilter, sortMode]);

  const sortLabel = SORT_OPTIONS.find((s) => s.key === sortMode)?.label;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Users</Text>
        <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
          <Text style={styles.headerAction}>+ New</Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <FilterPill
            active={roleFilter === 'all'}
            label="All roles"
            onPress={() => setRoleFilter('all')}
          />
          <FilterPill
            active={roleFilter === 'admin'}
            label="Admins"
            onPress={() => setRoleFilter('admin')}
          />
          <FilterPill
            active={roleFilter === 'user'}
            label="Canvassers"
            onPress={() => setRoleFilter('user')}
          />
          <View style={styles.filterDivider} />
          <FilterPill
            active={statusFilter === 'all'}
            label="All status"
            onPress={() => setStatusFilter('all')}
          />
          <FilterPill
            active={statusFilter === 'active'}
            label="Active"
            onPress={() => setStatusFilter('active')}
          />
          <FilterPill
            active={statusFilter === 'inactive'}
            label="Inactive"
            onPress={() => setStatusFilter('inactive')}
          />
        </ScrollView>
        <View style={styles.sortRow}>
          <Pressable
            onPress={() => setSortPickerOpen(true)}
            style={styles.sortButton}
          >
            <Text style={styles.sortButtonText}>Sort: {sortLabel}</Text>
            <Text style={styles.sortChevron}>▾</Text>
          </Pressable>
          <Text style={styles.countText}>
            {visibleUsers.length} of {users.length}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      >
        {usersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : visibleUsers.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {users.length === 0
                ? 'No users yet. Tap "+ New" to add one.'
                : 'No users match your filters.'}
            </Text>
          </View>
        ) : (
          visibleUsers.map((u) => (
            <UserCard
              key={u.id}
              user={u}
              onPress={() => router.push(`/(app)/admin/users/${u.id}`)}
            />
          ))
        )}
      </ScrollView>

      {/* Sort picker */}
      <Modal
        transparent
        visible={sortPickerOpen}
        animationType="fade"
        onRequestClose={() => setSortPickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setSortPickerOpen(false)}
        >
          <Pressable
            style={styles.actionSheet}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={styles.actionSheetTitle}>Sort users</Text>
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortMode;
              return (
                <Pressable
                  key={opt.key}
                  style={styles.actionItem}
                  onPress={() => {
                    setSortMode(opt.key);
                    setSortPickerOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.actionItemText,
                      active && {
                        color: colors.brand,
                        fontWeight: '700',
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.actionItem, styles.actionCancel]}
              onPress={() => setSortPickerOpen(false)}
            >
              <Text style={[styles.actionItemText, { fontWeight: '600' }]}>
                Cancel
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create user modal */}
      <Modal
        transparent
        visible={showCreate}
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setShowCreate(false)}
          >
            <Pressable
              style={styles.formSheet}
              onPress={(e) => e.stopPropagation()}
            >
              <CreateUserForm
                onSubmit={(form) => createUser.mutate(form)}
                onCancel={() => setShowCreate(false)}
                submitting={createUser.isPending}
                error={createUser.error}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

function CreateUserForm({ onSubmit, onCancel, submitting, error }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');

  const valid =
    firstName.trim() && lastName.trim() && email.trim() && password.length >= 8;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.formTitle}>New user</Text>

      <Text style={styles.formLabel}>First name</Text>
      <TextInput
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        placeholder="Jane"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Last name</Text>
      <TextInput
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        placeholder="Doe"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="jane@example.com"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>
        Phone <Text style={{ color: colors.textMuted }}>(optional)</Text>
      </Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="(555) 123-4567"
        placeholderTextColor={colors.textMuted}
        style={styles.textInput}
      />

      <Text style={styles.formLabel}>Password (min 8 chars)</Text>
      <PasswordInput
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        placeholder="••••••••"
      />

      <Text style={styles.formLabel}>Role</Text>
      <View style={styles.roleRow}>
        {[
          { v: 'user', l: 'Canvasser' },
          { v: 'admin', l: 'Admin' },
        ].map((opt) => {
          const active = role === opt.v;
          return (
            <Pressable
              key={opt.v}
              onPress={() => setRole(opt.v)}
              style={[styles.roleOption, active && styles.roleOptionActive]}
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

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error.message}</Text>
        </View>
      )}

      <View style={styles.formButtons}>
        <Pressable
          onPress={onCancel}
          style={[styles.formBtn, styles.formBtnSecondary]}
        >
          <Text style={styles.formBtnSecondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            onSubmit({
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: email.trim(),
              phone: phone.trim() || undefined,
              password,
              role,
            })
          }
          disabled={!valid || submitting}
          style={[
            styles.formBtn,
            styles.formBtnPrimary,
            { opacity: valid && !submitting ? 1 : 0.5 },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.formBtnPrimaryText}>Create</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
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
  headerAction: { color: colors.brand, fontWeight: '700', fontSize: 14 },

  controls: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
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
    alignItems: 'center',
    gap: spacing.xs,
    paddingRight: spacing.lg,
  },
  filterDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs + 2,
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  filterPillActive: {
    backgroundColor: colors.brandTint,
    borderColor: colors.brand,
  },
  filterPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  filterPillTextActive: { color: colors.brand },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sortButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sortChevron: { fontSize: 11, color: colors.textSecondary },
  countText: { ...type.caption },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...type.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  userCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarText: {
    color: colors.textSecondary,
    fontWeight: '800',
    fontSize: 14,
  },
  userName: { ...type.bodyStrong, fontSize: 15 },
  userEmail: { ...type.caption, marginTop: 1 },
  userPills: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs },
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
  chevron: { fontSize: 24, color: colors.textMuted },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.xl,
  },
  actionSheetTitle: {
    ...type.caption,
    textAlign: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItem: {
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionItemText: {
    color: colors.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  actionCancel: { borderBottomWidth: 0, marginTop: spacing.xs },

  formSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxHeight: '90%',
  },
  formTitle: { ...type.h2, fontSize: 18, marginBottom: 4 },
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
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.card,
  },
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

  errorBox: {
    marginTop: spacing.md,
    backgroundColor: colors.dangerBg,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: { color: colors.danger, fontSize: 14 },

  formButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  formBtn: {
    flex: 1,
    paddingVertical: spacing.md + 2,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  formBtnPrimary: { backgroundColor: colors.brand },
  formBtnPrimaryText: {
    color: colors.textInverse,
    fontWeight: '700',
    fontSize: 15,
  },
  formBtnSecondary: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formBtnSecondaryText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
});
