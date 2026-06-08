import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Modal,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import CampaignChip from '../../../components/CampaignChip';
import EffortPicker from '../../../components/EffortPicker';
import TabSwitcher from '../../../components/TabSwitcher';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

// Admin/super-admin screen: assign & unassign the active round's BOOKS (turf) to
// canvassers. Two orientations (By book / By canvasser) over the same data, plus
// bulk distribute/everyone. All endpoints already exist under /admin/campaigns/:id/turfs*
// (same ones the web book-assignment panel uses) — no server changes.
export default function AdminBooks() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const qc = useQueryClient();

  const [campaign, setCampaign] = useState(null);
  const cId = campaign?.id || null;
  const [effortId, setEffortId] = useState(null);
  const [view, setView] = useState('book'); // 'book' | 'canvasser'
  const [search, setSearch] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [expanded, setExpanded] = useState(null); // 'book:<id>' | 'user:<id>'
  const [bulkOpen, setBulkOpen] = useState(false);

  // --- data ---
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
  });
  const effortList = useMemo(
    () =>
      (effortsQ.data?.efforts || []).map((e) => ({
        id: String(e._id),
        name: e.name,
        activeRound: e.activeRound || null,
      })),
    [effortsQ.data]
  );
  // Resolve the selected effort (default: first effort that has an active round).
  const currentEffortId =
    effortId && effortList.some((e) => e.id === effortId)
      ? effortId
      : effortList.find((e) => e.activeRound)?.id || effortList[0]?.id || null;
  const currentEffort = effortList.find((e) => e.id === currentEffortId) || null;
  const passId = currentEffort?.activeRound?._id ? String(currentEffort.activeRound._id) : null;

  const membersQ = useQuery({ queryKey: ['admin', 'memberships'], queryFn: () => api('/admin/memberships') });
  const rosterQ = useQuery({
    queryKey: ['admin', 'campaign-assignments', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/assignments`),
    enabled: !!cId,
  });
  const turfsQ = useQuery({
    queryKey: ['admin', 'turfs', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs?passId=${passId}`),
    enabled: !!cId && !!passId,
  });
  const assignmentsQ = useQuery({
    queryKey: ['admin', 'turf-assignments', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/turfs/assignments?passId=${passId}`),
    enabled: !!cId && !!passId,
  });
  const progressQ = useQuery({
    queryKey: ['admin', 'pass-progress', cId, passId],
    queryFn: () => api(`/admin/campaigns/${cId}/passes/${passId}/progress`),
    enabled: !!cId && !!passId,
  });

  // --- derived ---
  const rosterUserIds = useMemo(
    () => new Set((rosterQ.data?.assignments || []).map((a) => String(a.userId))),
    [rosterQ.data]
  );
  const roster = useMemo(
    () =>
      (membersQ.data?.members || [])
        .filter((m) => m.role === 'canvasser' && m.user?.isActive && m.isActive && rosterUserIds.has(String(m.user.id)))
        .map((m) => ({ id: String(m.user.id), firstName: m.user.firstName, lastName: m.user.lastName, email: m.user.email })),
    [membersQ.data, rosterUserIds]
  );
  const books = useMemo(
    () =>
      (turfsQ.data?.turfs || [])
        .filter((t) => t.status === 'published')
        .map((t) => ({ id: String(t._id), name: t.name, doors: t.eligibleDoorCount ?? t.doorCount ?? 0 })),
    [turfsQ.data]
  );
  const usersByBook = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      const tid = String(a.turfId);
      if (!m.has(tid)) m.set(tid, []);
      m.get(tid).push({ id: String(a.user.id), firstName: a.user.firstName, lastName: a.user.lastName });
    }
    return m;
  }, [assignmentsQ.data]);
  const bookIdsByUser = useMemo(() => {
    const m = new Map();
    for (const a of assignmentsQ.data?.assignments || []) {
      const uid = String(a.user.id);
      if (!m.has(uid)) m.set(uid, new Set());
      m.get(uid).add(String(a.turfId));
    }
    return m;
  }, [assignmentsQ.data]);

  // Reset transient UI when the scope changes.
  useEffect(() => {
    setExpanded(null);
  }, [cId, passId, view]);

  // --- mutations ---
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'turf-assignments', cId, passId] });
    qc.invalidateQueries({ queryKey: ['admin', 'efforts', cId] });
  };
  const assignMut = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments`, { method: 'POST', body: { userIds: [userId] } }),
    onSuccess: invalidate,
  });
  const unassignMut = useMutation({
    mutationFn: ({ turfId, userId }) =>
      api(`/admin/campaigns/${cId}/turfs/${turfId}/assignments/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const bulkMut = useMutation({
    mutationFn: (body) => api(`/admin/campaigns/${cId}/turfs/assign-bulk`, { method: 'POST', body }),
    onSuccess: () => {
      invalidate();
      setBulkOpen(false);
    },
  });
  const mutating = assignMut.isPending || unassignMut.isPending || bulkMut.isPending;

  function toggleAssign(turfId, userId, isAssigned) {
    if (isAssigned) unassignMut.mutate({ turfId, userId });
    else assignMut.mutate({ turfId, userId });
  }

  // --- filters ---
  const term = search.trim().toLowerCase();
  const visibleBooks = useMemo(() => {
    let list = books;
    if (unassignedOnly) list = list.filter((b) => !(usersByBook.get(b.id)?.length));
    if (term) list = list.filter((b) => b.name.toLowerCase().includes(term));
    return list;
  }, [books, unassignedOnly, term, usersByBook]);
  const visibleCanvassers = useMemo(() => {
    if (!term) return roster;
    return roster.filter((c) => `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(term));
  }, [roster, term]);

  const loading =
    effortsQ.isLoading || (!!passId && (turfsQ.isLoading || assignmentsQ.isLoading || rosterQ.isLoading || membersQ.isLoading));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Books</Text>
      </View>

      <View style={styles.context}>
        <CampaignChip value={campaign} onChange={setCampaign} />
        {effortList.length > 1 && (
          <View style={{ marginTop: spacing.sm, zIndex: 10 }}>
            <EffortPicker
              efforts={effortList.map((e) => ({ id: e.id, name: e.name }))}
              value={currentEffortId}
              onChange={setEffortId}
            />
          </View>
        )}
        {passId && progressQ.data?.total ? (
          <Text style={styles.roundLine}>
            {currentEffort?.activeRound?.name || 'Active round'} ·{' '}
            {doneFromCounts(progressQ.data.counts)} / {progressQ.data.total} doors done
          </Text>
        ) : null}
      </View>

      <TabSwitcher
        tabs={[
          { key: 'book', label: 'By book', count: books.length || undefined },
          { key: 'canvasser', label: 'By canvasser', count: roster.length || undefined },
        ]}
        activeKey={view}
        onChange={setView}
      />

      {!!passId && (
        <View style={styles.controls}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={view === 'book' ? 'Search books' : 'Search canvassers'}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {view === 'book' && (
            <Pressable
              onPress={() => setUnassignedOnly((v) => !v)}
              style={[styles.filterChip, unassignedOnly && styles.filterChipOn]}
            >
              <Text style={[styles.filterChipText, unassignedOnly && styles.filterChipTextOn]}>Unassigned</Text>
            </Pressable>
          )}
        </View>
      )}

      {view === 'book' && !!passId && roster.length > 0 && books.length > 0 && (
        <View style={styles.bulkRow}>
          <Pressable onPress={() => setBulkOpen(true)} style={styles.bulkBtn}>
            <Text style={styles.bulkBtnText}>Bulk assign {visibleBooks.length} book{visibleBooks.length === 1 ? '' : 's'} ›</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        {!cId ? (
          <Empty styles={styles}>Pick a campaign to manage book assignments.</Empty>
        ) : loading ? (
          <ActivityIndicator color={colors.brand} />
        ) : !passId ? (
          <Empty styles={styles}>
            No active round for {currentEffort?.name || 'this effort'}. Cut/activate a round on the web dashboard.
          </Empty>
        ) : books.length === 0 ? (
          <Empty styles={styles}>No published books in this round yet. Cut turf on the web dashboard.</Empty>
        ) : roster.length === 0 ? (
          <Empty styles={styles}>
            No canvassers are assigned to this campaign yet.{'\n'}
            <Text
              style={styles.link}
              onPress={() => router.push(`/(app)/admin/campaign-assignments/${cId}`)}
            >
              Assign canvassers →
            </Text>
          </Empty>
        ) : view === 'book' ? (
          visibleBooks.length === 0 ? (
            <Empty styles={styles}>No books match.</Empty>
          ) : (
            visibleBooks.map((b) => {
              const assignees = usersByBook.get(b.id) || [];
              const isOpen = expanded === `book:${b.id}`;
              return (
                <View key={b.id} style={styles.card}>
                  <Pressable
                    onPress={() => setExpanded(isOpen ? null : `book:${b.id}`)}
                    style={styles.cardHead}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{b.name}</Text>
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {b.doors} doors ·{' '}
                        {assignees.length
                          ? assignees.map((u) => `${u.firstName} ${u.lastName[0] || ''}`).join(', ')
                          : 'unassigned'}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                  </Pressable>
                  {isOpen && (
                    <View style={styles.panel}>
                      {roster.length === 0 ? (
                        <Text style={styles.panelEmpty}>No canvassers.</Text>
                      ) : (
                        roster.map((c) => {
                          const assigned = (bookIdsByUser.get(c.id) || new Set()).has(b.id);
                          return (
                            <AssignRow
                              key={c.id}
                              styles={styles}
                              title={`${c.firstName} ${c.lastName}`}
                              sub={c.email}
                              assigned={assigned}
                              disabled={mutating}
                              onToggle={() => toggleAssign(b.id, c.id, assigned)}
                            />
                          );
                        })
                      )}
                    </View>
                  )}
                </View>
              );
            })
          )
        ) : visibleCanvassers.length === 0 ? (
          <Empty styles={styles}>No canvassers match.</Empty>
        ) : (
          visibleCanvassers.map((c) => {
            const myBooks = bookIdsByUser.get(c.id) || new Set();
            const isOpen = expanded === `user:${c.id}`;
            return (
              <View key={c.id} style={styles.card}>
                <Pressable onPress={() => setExpanded(isOpen ? null : `user:${c.id}`)} style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>
                      {c.firstName} {c.lastName}
                    </Text>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      {myBooks.size} book{myBooks.size === 1 ? '' : 's'} · {c.email}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>{isOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {isOpen && (
                  <View style={styles.panel}>
                    {books.map((b) => {
                      const assigned = myBooks.has(b.id);
                      return (
                        <AssignRow
                          key={b.id}
                          styles={styles}
                          title={b.name}
                          sub={`${b.doors} doors`}
                          assigned={assigned}
                          disabled={mutating}
                          onToggle={() => toggleAssign(b.id, c.id, assigned)}
                        />
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <BulkModal
        visible={bulkOpen}
        styles={styles}
        colors={colors}
        bookCount={visibleBooks.length}
        roster={roster}
        pending={bulkMut.isPending}
        onClose={() => setBulkOpen(false)}
        onApply={({ userIds, mode, replace }) =>
          bulkMut.mutate({ turfIds: visibleBooks.map((b) => b.id), userIds, mode, replace })
        }
      />
    </SafeAreaView>
  );
}

function doneFromCounts(counts) {
  if (!counts || typeof counts !== 'object') return 0;
  // counts is a status→count map; "done" = anything not unknocked.
  const total = Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0);
  return total - (Number(counts.unknocked) || 0);
}

function Empty({ children, styles }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{children}</Text>
    </View>
  );
}

function AssignRow({ title, sub, assigned, disabled, onToggle, styles }) {
  return (
    <View style={styles.assignRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.assignName}>{title}</Text>
        {sub ? (
          <Text style={styles.assignSub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onToggle}
        disabled={disabled}
        style={[styles.action, assigned ? styles.actionUnassign : styles.actionAssign]}
      >
        <Text style={[styles.actionText, assigned ? styles.actionTextUnassign : styles.actionTextAssign]}>
          {assigned ? 'Unassign' : 'Assign'}
        </Text>
      </Pressable>
    </View>
  );
}

function BulkModal({ visible, styles, colors, bookCount, roster, pending, onClose, onApply }) {
  const [selected, setSelected] = useState(() => new Set());
  const [mode, setMode] = useState('distribute');
  const [replace, setReplace] = useState(false);

  // Reset each time it opens.
  useEffect(() => {
    if (visible) {
      setSelected(new Set());
      setMode('distribute');
      setReplace(false);
    }
  }, [visible]);

  const n = selected.size;
  const preview =
    n === 0
      ? 'Pick canvassers to assign.'
      : mode === 'distribute'
      ? `Split ${bookCount} book${bookCount === 1 ? '' : 's'} across ${n} → ~${Math.ceil(bookCount / n)} each.`
      : `Give all ${bookCount} book${bookCount === 1 ? '' : 's'} to each of ${n} → ${bookCount * n} assignments.`;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHead}>
            <Text style={styles.modalTitle}>Bulk assign · {bookCount} book{bookCount === 1 ? '' : 's'}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.modeRow}>
            {[
              { k: 'distribute', label: 'Distribute' },
              { k: 'everyone', label: 'Everyone' },
            ].map((m) => (
              <Pressable
                key={m.k}
                onPress={() => setMode(m.k)}
                style={[styles.modeBtn, mode === m.k && styles.modeBtnOn]}
              >
                <Text style={[styles.modeText, mode === m.k && styles.modeTextOn]}>{m.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingVertical: spacing.xs }}>
            {roster.map((c) => {
              const on = selected.has(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                  style={styles.pickRow}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.pickName}>
                    {c.firstName} {c.lastName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable onPress={() => setReplace((v) => !v)} style={styles.replaceRow}>
            <View style={[styles.checkbox, replace && styles.checkboxOn]}>
              {replace ? <Text style={styles.checkboxMark}>✓</Text> : null}
            </View>
            <Text style={styles.replaceText}>Replace existing assignments on these books first</Text>
          </Pressable>

          <Text style={styles.preview}>{preview}</Text>

          <Pressable
            onPress={() => onApply({ userIds: [...selected], mode, replace })}
            disabled={pending || n === 0 || bookCount === 0}
            style={[styles.applyBtn, (pending || n === 0 || bookCount === 0) && styles.applyBtnDisabled]}
          >
            {pending ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.applyText}>Apply</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    headerTitle: { ...type.h3, textAlign: 'center' },
    context: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    roundLine: { ...type.caption, color: colors.textSecondary, marginTop: spacing.sm },

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
    filterChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      justifyContent: 'center',
    },
    filterChipOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    filterChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    filterChipTextOn: { color: colors.brand },

    bulkRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, alignItems: 'flex-start' },
    bulkBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    bulkBtnText: { fontSize: 12, fontWeight: '700', color: colors.brand },

    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
      ...shadow.card,
      overflow: 'hidden',
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
    cardTitle: { ...type.bodyStrong, fontSize: 15 },
    cardMeta: { ...type.caption, marginTop: 1 },
    chevron: { fontSize: 14, color: colors.textSecondary, marginLeft: spacing.sm },

    panel: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.sunken },
    panelEmpty: { ...type.caption, padding: spacing.md, textAlign: 'center' },
    assignRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    assignName: { ...type.bodyStrong, fontSize: 14 },
    assignSub: { ...type.caption, marginTop: 1 },
    action: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
    actionAssign: { borderColor: colors.brand, backgroundColor: colors.brandTint },
    actionUnassign: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg },
    actionText: { fontSize: 12, fontWeight: '700' },
    actionTextAssign: { color: colors.brand },
    actionTextUnassign: { color: colors.danger },

    empty: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    emptyText: { ...type.body, color: colors.textSecondary, textAlign: 'center' },
    link: { color: colors.brand, fontWeight: '700' },

    // Bulk modal
    modalBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
    modalCard: {
      backgroundColor: colors.bg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
    modalTitle: { ...type.h3 },
    modalClose: { fontSize: 16, color: colors.textSecondary, fontWeight: '700' },
    modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    modeBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    modeBtnOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
    modeText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    modeTextOn: { color: colors.brand },
    pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
    checkboxMark: { color: colors.textInverse, fontSize: 13, fontWeight: '800' },
    pickName: { ...type.body },
    replaceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
    replaceText: { ...type.caption, flex: 1 },
    preview: { ...type.caption, color: colors.textSecondary, marginTop: spacing.md },
    applyBtn: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    applyBtnDisabled: { opacity: 0.5 },
    applyText: { color: colors.textInverse, fontWeight: '700', fontSize: 15 },
  });
}
