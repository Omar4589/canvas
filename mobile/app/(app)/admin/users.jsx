import { useEffect, useMemo, useState } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import PasswordInput from '../../../components/PasswordInput';
import SectionHeader from '../../../components/SectionHeader';
import MemberSheet from '../../../components/MemberSheet';
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  InsetNoteRow,
} from '../../../components/InsetGroup';
import CreateCanvasserSheet from '../../../components/CreateCanvasserSheet';
import { useConsoleRole, useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import { formatUsPhoneInput, isValidTempPassword, tempPasswordProblem } from '../../../lib/validators';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useBottomInset } from '../../../lib/useBottomInset';

const SORT_OPTIONS = [
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'recent-joined', label: 'Recently joined' },
  { key: 'recent-signin', label: 'Recently signed in' },
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

// The initials circle, for the row's `leading` slot — admins get the brand tint.
const Avatar = ({ name, role }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.userAvatar, role === 'admin' && { backgroundColor: colors.brandTint }]}>
      <Text style={[styles.userAvatarText, role === 'admin' && { color: colors.brand }]}>
        {initials(name) || '?'}
      </Text>
    </View>
  );
};

// The old pill strip (role / assigned / coordinator / active) collapsed into one quiet meta
// line — the grammar allows ONE badge, and it's reserved for the exceptional state (inactive).
// No 'assigned' / 'not assigned' word: campaign-scoped rows now live under a section header that
// already says which side they are on, and restating it on every row is exactly the noise this
// single line was written to kill.
const userMeta = ({ role, coordinatorName }) =>
  [
    role === 'admin' ? 'admin' : role === 'lead' ? 'team lead' : 'canvasser',
    coordinatorName || null,
  ]
    .filter(Boolean)
    .join(' · ');

function FilterPill({ active, label, onPress }) {
  const styles = useThemedStyles(makeStyles);
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The floating tab bar overlays this screen, so bottom padding must clear it.
  const bottomInset = useBottomInset();
  // Android's system nav bar overlaps bottom sheets without this inset (item D8).
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const params = useLocalSearchParams();
  const viewerRole = useConsoleRole(); // 'super' | 'admin' | 'lead'
  const roleLabel = useConsoleRoleLabel();
  const isLead = viewerRole === 'lead';
  const [showCreate, setShowCreate] = useState(false);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortMode, setSortMode] = useState('name-asc');
  const [sortPickerOpen, setSortPickerOpen] = useState(false);

  // ── The people hub's campaign filter (the old campaign Team page merged in here). ──
  // '' = all campaigns (org view). Seeded from ?campaignId= (a campaign's "Team" quick
  // action lands pre-filtered). Leads land on their first managed campaign by default so
  // create/coordinator actions are always available to them.
  const [campaignFilter, setCampaignFilter] = useState(() =>
    typeof params.campaignId === 'string' ? params.campaignId : ''
  );
  const campaignsQ = useQuery({ queryKey: ['admin', 'campaigns'], queryFn: () => api('/admin/campaigns') });
  const activeCampaigns = useMemo(
    () => (campaignsQ.data?.campaigns || []).filter((c) => c.isActive),
    [campaignsQ.data]
  );
  useEffect(() => {
    if (isLead && !campaignFilter && activeCampaigns.length) {
      setCampaignFilter(String(activeCampaigns[0]._id));
    }
  }, [isLead, campaignFilter, activeCampaigns]);
  const cId = campaignFilter || null;
  const selectedCampaign = cId
    ? (() => {
        const c = activeCampaigns.find((x) => String(x._id) === String(cId));
        return c ? { id: String(c._id), name: c.name, type: c.type } : null;
      })()
    : null;

  // /admin/memberships is now lead-scoped server-side (their campaigns' rosters, deduped).
  const usersQ = useQuery({
    queryKey: ['admin', 'memberships'],
    queryFn: () => api('/admin/memberships'),
  });

  // Campaign context: the roster (assigned state + coordinator) + who can BE a coordinator.
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  const rosterByUser = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      m.set(String(a.userId), {
        coordinatorId: a.coordinatorId ? String(a.coordinatorId) : null,
        coordinatorName: a.coordinatorName || null,
        status: a.status,
      });
    }
    return m;
  }, [assignmentsQ.data]);
  const coordinators = useMemo(
    () =>
      (usersQ.data?.members || [])
        .filter((m) => (m.role === 'admin' || m.role === 'lead') && m.user.isActive && m.isActive)
        .map((m) => ({ id: String(m.user.id), name: `${m.user.firstName} ${m.user.lastName}`.trim() })),
    [usersQ.data]
  );

  const [sheetUserId, setSheetUserId] = useState(null);
  // The "not on this campaign" section starts collapsed — see the render.
  const [offOpen, setOffOpen] = useState(false);

  const createUser = useMutation({
    mutationFn: (body) => api('/admin/memberships', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
      setShowCreate(false);
    },
  });
  // Campaign-scoped create (auto-assigns; accepts coordinatorId) — admins pass
  // requireCampaignManager too, so BOTH roles create through here when a campaign is picked.
  const createOnCampaign = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${cId}/crew`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
      qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cId] });
      setShowCreate(false);
    },
  });
  const assignAll = useMutation({
    mutationFn: (userIds) => api(`/admin/campaigns/${cId}/assignments`, { method: 'POST', body: { userIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] }),
  });

  const users = useMemo(
    () =>
      (usersQ.data?.members || []).map((m) => ({
        ...m.user,
        role: m.role,
        isActive: m.isActive && m.user.isActive,
        membershipActive: m.isActive,
        addedAt: m.addedAt,
      })),
    [usersQ.data]
  );

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
      list.sort((a, b) => compareDate(a, b, 'addedAt'));
    // Sorts lastLoginAt, and says so — it used to be labeled "Recently active", which it never was.
    // Can't be repointed either: lastSeenAt is super-admin-only and absent from /admin/memberships.
    else if (sortMode === 'recent-signin')
      list.sort((a, b) => compareDate(a, b, 'lastLoginAt'));
    return list;
  }, [users, search, roleFilter, statusFilter, sortMode]);

  // Campaign scoped → two sections: this campaign's people, then the rest of the org. ONE pass over
  // the already-sorted list, so the chosen sort still orders each section — the property the old
  // stable partition existed to protect. `rosterByUser` membership IS the answer, so no row needs an
  // `assigned` tag any more (which also drops an object copy per user per render).
  const [onCampaign, offCampaign] = useMemo(() => {
    if (!cId) return [visibleUsers, []];
    const on = [];
    const off = [];
    for (const u of visibleUsers) (rosterByUser.has(String(u.id)) ? on : off).push(u);
    return [on, off];
  }, [visibleUsers, cId, rosterByUser]);

  const sortLabel = SORT_OPTIONS.find((s) => s.key === sortMode)?.label;

  // One row renderer for both sections and for the flat org view, so a row can never drift
  // between them. Keyed on u.id, so a re-sort re-orders instead of remounting.
  const userRow = (u) => {
    const name = `${u.firstName} ${u.lastName}`.trim();
    return (
      <InsetNavRow
        key={u.id}
        leading={<Avatar name={name} role={u.role} />}
        label={name || u.email}
        sub={u.email}
        unit={userMeta({
          role: u.role,
          coordinatorName: cId ? rosterByUser.get(String(u.id))?.coordinatorName : undefined,
        })}
        badge={u.isActive ? null : { text: 'inactive' }}
        // Campaign scoped → the member sheet (campaign actions); org view → full page.
        onPress={() => (cId ? setSheetUserId(u.id) : router.push(`/(app)/admin/users/${u.id}`))}
      />
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back} numberOfLines={1}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Users</Text>
        {/* Offering "+ New" to somebody the server just refused only produces a second 403 inside
            the create sheet. A LEAD creates through a campaign (auto-assigned), so their button
            needs a campaign selected — which the default-select effect guarantees. */}
        {usersQ.error?.code === 'FORBIDDEN_ROLE' || (isLead && !cId) ? (
          <View style={{ width: 44 }} />
        ) : (
          <Pressable onPress={() => setShowCreate(true)} hitSlop={8}>
            <Text style={styles.headerAction}>+ New</Text>
          </Pressable>
        )}
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
        {/* Campaign filter — the merged Team page's scope. Admins get an org-wide "All". */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.filterRow}
        >
          {!isLead && (
            <FilterPill active={!campaignFilter} label="All campaigns" onPress={() => setCampaignFilter('')} />
          )}
          {activeCampaigns.map((c) => (
            <FilterPill
              key={String(c._id)}
              active={campaignFilter === String(c._id)}
              label={c.name}
              onPress={() => setCampaignFilter(String(c._id))}
            />
          ))}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
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
            active={roleFilter === 'lead'}
            label="Team leads"
            onPress={() => setRoleFilter('lead')}
          />
          <FilterPill
            active={roleFilter === 'canvasser'}
            label="Canvassers"
            onPress={() => setRoleFilter('canvasser')}
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
          {!usersQ.isError && (
            <Text style={styles.countText}>
              {visibleUsers.length} of {users.length}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + bottomInset }}
      >
        {usersQ.isLoading || usersQ.isError || visibleUsers.length === 0 ? (
          <InsetGroup>
            {usersQ.isLoading ? (
              <InsetNoteRow loading />
            ) : usersQ.isError ? (
              // NEVER fall through to the empty state on an error. A team lead reaching this screen
              // gets a 403 from /admin/memberships, which used to render as "No users yet" — the app
              // stating as fact that the organization is empty to somebody who is simply not allowed
              // to look. Say which of the two it is.
              <InsetNoteRow>
                {usersQ.error?.code === 'FORBIDDEN_ROLE'
                  ? 'Your account can’t view users in this organization.'
                  : 'Could not load users. Pull to retry, or check your connection.'}
              </InsetNoteRow>
            ) : (
              <InsetNoteRow>
                {users.length === 0
                  ? 'No users yet. Tap "+ New" to add one.'
                  : 'No users match your filters.'}
              </InsetNoteRow>
            )}
          </InsetGroup>
        ) : cId ? (
          /* Campaign scoped → the campaign's people lead, and the rest of the org sits behind a
             reveal. Picking a campaign should answer "who is on this campaign"; the remainder is a
             means to an end (assigning someone), not the default view. */
          <>
            <SectionHeader caption title={`On this campaign (${onCampaign.length})`} />
            <InsetGroup>
              {onCampaign.length === 0 ? (
                <InsetNoteRow>Nobody on this campaign matches these filters.</InsetNoteRow>
              ) : (
                onCampaign.map(userRow)
              )}
            </InsetGroup>

            <SectionHeader caption title={`Not on this campaign (${offCampaign.length})`} />
            <InsetGroup>
              {/* A reveal, not a navigation — action row, no chevron (same idiom as the archived
                  campaigns list on admin/index.jsx). */}
              <InsetActionRow
                label={offOpen ? 'Hide' : `Show ${offCampaign.length} not on this campaign`}
                onPress={() => setOffOpen((v) => !v)}
                disabled={offCampaign.length === 0}
              />
              {offOpen ? offCampaign.map(userRow) : null}
              {/* Bulk assign lives HERE, and only while the section is open: "all shown" must mean a
                  set the reader can actually see — it used to be able to fire against dozens of
                  people who were never on screen. Every row in this section is unassigned by
                  construction, so the section IS the predicate; no per-row filter is needed. */}
              {offOpen && !isLead && offCampaign.length > 0 ? (
                <InsetActionRow
                  label={assignAll.isPending ? 'Assigning…' : `Assign all shown (${offCampaign.length})`}
                  onPress={() => assignAll.mutate(offCampaign.map((u) => u.id))}
                  disabled={assignAll.isPending}
                />
              ) : null}
            </InsetGroup>
          </>
        ) : (
          /* Org view — one flat list, exactly as before. */
          <InsetGroup>{visibleUsers.map(userRow)}</InsetGroup>
        )}
      </ScrollView>

      {/* Member sheet — campaign-scoped actions for the tapped person. */}
      {sheetUserId && selectedCampaign
        ? (() => {
            const u = users.find((x) => String(x.id) === String(sheetUserId));
            if (!u) return null;
            const roster = rosterByUser.get(String(u.id));
            return (
              <MemberSheet
                member={{
                  role: u.role,
                  isActive: u.isActive,
                  status: roster?.status || (u.membershipActive ? 'active' : 'deactivated'),
                  coordinatorId: roster?.coordinatorId || null,
                  coordinatorName: roster?.coordinatorName || null,
                  assigned: !!roster,
                  // lastLoginAt gates the resend-invite action (never-signed-in only) — MemberSheet has no
                  // way to fetch it itself, so it has to be threaded through here.
                  user: { id: String(u.id), firstName: u.firstName, lastName: u.lastName, email: u.email, lastLoginAt: u.lastLoginAt },
                }}
                campaign={selectedCampaign}
                coordinators={coordinators}
                viewerRole={viewerRole}
                onClose={() => setSheetUserId(null)}
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
                  qc.invalidateQueries({ queryKey: ['admin', 'campaign-assignments', cId] });
                  qc.invalidateQueries({ queryKey: ['admin', 'campaign-crew', cId] });
                }}
              />
            );
          })()
        : null}

      {/* Campaign-scoped create (both roles; coordinator picker included). */}
      {showCreate && cId ? (
        <CreateCanvasserSheet
          campaignName={selectedCampaign?.name}
          coordinators={coordinators}
          onClose={() => setShowCreate(false)}
          onCreate={(body) => createOnCampaign.mutate(body)}
          submitting={createOnCampaign.isPending}
          error={createOnCampaign.error}
        />
      ) : null}

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
            style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
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

      {/* Org-level create (no campaign selected — admins only; role picker, no coordinator:
          a crew is a per-campaign fact, there is no campaign here to be on a crew of). */}
      <Modal
        transparent
        visible={showCreate && !cId}
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
              style={[styles.formSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
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
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('canvasser');
  const [linkExisting, setLinkExisting] = useState(false);

  // The email already has a global account — flip to the link path so the admin can add
  // them without a duplicate (matches the web console's auto-check on this error).
  useEffect(() => {
    if (error?.data?.code === 'EMAIL_EXISTS_USE_LINK') setLinkExisting(true);
  }, [error]);

  // The temp password is OPTIONAL. Blank → the server generates a throwaway nobody sees and the
  // new member sets their own via the emailed set-password link; only a TYPED one must pass min-8.
  const valid = linkExisting
    ? !!email.trim()
    : firstName.trim() && lastName.trim() && email.trim() && (password === '' || isValidTempPassword(password));

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.formTitle}>
        {linkExisting ? 'Link existing user' : 'New user'}
      </Text>

      <Pressable
        onPress={() => setLinkExisting((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          marginBottom: spacing.md,
        }}
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
            <Text style={{ color: colors.textInverse, fontWeight: '700', fontSize: 12 }}>
              ✓
            </Text>
          )}
        </View>
        <Text style={{ ...type.caption, color: colors.textPrimary, flex: 1 }}>
          Existing user (by email — link them to this org)
        </Text>
      </Pressable>

      {!linkExisting && (
        <>
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
        </>
      )}

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

      {!linkExisting && (
        <>
          <Text style={styles.formLabel}>
            Phone <Text style={{ color: colors.textMuted }}>(optional)</Text>
          </Text>
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatUsPhoneInput(t))}
            keyboardType="phone-pad"
            placeholder="(555) 123-4567"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
          />

          <Text style={styles.formLabel}>Temporary password (optional)</Text>
          <PasswordInput
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            placeholder="Leave blank to email an invite"
          />
          {password.length > 0 && tempPasswordProblem(password) && (
            <Text style={{ color: colors.danger, fontSize: 12, marginTop: spacing.xs }}>
              {tempPasswordProblem(password)}
            </Text>
          )}
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.xs }}>
            Leave blank to let them set their own password via the emailed invite (recommended).
            Type one only if they can’t receive email.
          </Text>
        </>
      )}

      <Text style={styles.formLabel}>Role</Text>
      <View style={styles.roleRow}>
        {[
          { v: 'canvasser', l: 'Canvasser' },
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
            onSubmit(
              linkExisting
                ? { email: email.trim(), role, linkExisting: true }
                : {
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    email: email.trim(),
                    phone: phone.trim() || undefined,
                    password,
                    role,
                    linkExisting: false,
                  }
            )
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
            <Text style={styles.formBtnPrimaryText}>
              {linkExisting ? 'Link user' : 'Create'}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
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
    marginBottom: spacing.xs,
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

  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
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
}
