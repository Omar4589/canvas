import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Switch,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { formatRange } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';
import { rangeFor, deviceTimezone } from '../../../lib/dateRanges';
import DateRangeBar from '../../../components/DateRangeBar';
import { downloadCsv } from '../../../lib/csv';

const SORT_OPTIONS = [
  { key: 'surveys', label: 'Surveys' },
  { key: 'doors', label: 'Doors knocked' },
  { key: 'connection', label: 'Connection rate' },
  { key: 'hours', label: 'Hours on doors' },
  { key: 'doorsPerHour', label: 'Doors / hour' },
  { key: 'surveysPerHour', label: 'Surveys / hour' },
];

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function rowDerived(r) {
  const homesKnocked = r.homesKnocked ?? 0;
  const hours =
    r.firstActivityAt && r.lastActivityAt
      ? (new Date(r.lastActivityAt) - new Date(r.firstActivityAt)) / 3600000
      : 0;
  const surveys = r.surveysSubmitted || 0;
  return {
    ...r,
    hours,
    connection: homesKnocked > 0 ? surveys / homesKnocked : 0,
    doorsPerHour: hours > 0 ? homesKnocked / hours : 0,
    surveysPerHour: hours > 0 ? surveys / hours : 0,
  };
}

export default function AdminCanvassers() {
  const router = useRouter();
  const [campaign, setCampaign] = useState(undefined);

  const [range, setRange] = useState(() => {
    const r = rangeFor('today');
    return { preset: 'today', from: r.from, to: r.to };
  });

  const [sortKey, setSortKey] = useState('surveys');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hideInactive, setHideInactive] = useState(false);

  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const cId = campaign?.id;

  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, range.from, range.to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cId) params.set('campaignId', cId);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      return api(`/admin/reports/canvassers?${params.toString()}`);
    },
    enabled: !!cId,
  });

  const overlapsQ = useQuery({
    queryKey: ['admin', 'reports', 'overlaps', cId, range.from, range.to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (cId) p.set('campaignId', cId);
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
      return api(`/admin/reports/overlaps?${p.toString()}`);
    },
    enabled: !!cId,
  });

  const isLitDrop = campaign?.type === 'lit_drop';

  const filteredSorted = useMemo(() => {
    let rows = (canvassersQ.data || []).map(rowDerived);
    if (hideInactive) rows = rows.filter((r) => r.isActive);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const name = `${r.firstName || ''} ${r.lastName || ''} ${r.email || ''}`.toLowerCase();
        return name.includes(q);
      });
    }
    rows.sort((a, b) => {
      switch (sortKey) {
        case 'doors':
          return (b.homesKnocked || 0) - (a.homesKnocked || 0);
        case 'connection':
          return (b.connection || 0) - (a.connection || 0);
        case 'hours':
          return (b.hours || 0) - (a.hours || 0);
        case 'doorsPerHour':
          return (b.doorsPerHour || 0) - (a.doorsPerHour || 0);
        case 'surveysPerHour':
          return (b.surveysPerHour || 0) - (a.surveysPerHour || 0);
        case 'surveys':
        default:
          return (
            (b.surveysSubmitted || 0) - (a.surveysSubmitted || 0) ||
            (b.homesKnocked || 0) - (a.homesKnocked || 0)
          );
      }
    });
    return rows;
  }, [canvassersQ.data, hideInactive, search, sortKey]);

  const totals = useMemo(() => {
    return filteredSorted.reduce(
      (acc, r) => {
        acc.houses += r.homesKnocked || 0;
        acc.surveys += r.surveysSubmitted || 0;
        acc.litDrops += r.litDropped || 0;
        acc.notHome += r.notHome || 0;
        acc.wrongAddr += r.wrongAddress || 0;
        return acc;
      },
      { houses: 0, surveys: 0, litDrops: 0, notHome: 0, wrongAddr: 0 }
    );
  }, [filteredSorted]);

  function toggleSelected(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 5) next.add(id);
      else Alert.alert('Limit reached', 'Compare up to 5 canvassers at a time.');
      return next;
    });
  }

  function openCompare() {
    if (selectedIds.size < 2) {
      Alert.alert('Pick at least 2', 'Select 2–5 canvassers to compare.');
      return;
    }
    router.push({
      pathname: '/(app)/admin/canvasser/compare',
      params: {
        ids: Array.from(selectedIds).join(','),
        from: range.from || '',
        to: range.to || '',
        preset: range.preset,
      },
    });
  }

  function rowOnPress(r) {
    if (compareMode) {
      toggleSelected(r.userId);
      return;
    }
    router.push({
      pathname: `/(app)/admin/canvasser/${r.userId}`,
      params: {
        from: range.from || '',
        to: range.to || '',
        preset: range.preset,
      },
    });
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (cId) params.set('campaignId', cId);
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    params.set('tz', deviceTimezone());
    const name = `canvassers-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(`/admin/reports/canvassers.csv?${params.toString()}`, name);
  }

  const activeSortLabel =
    SORT_OPTIONS.find((s) => s.key === sortKey)?.label || 'Sort';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Canvassers</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <View style={styles.filterRow}>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="Search name or email"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Text style={styles.clear}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setSortMenuOpen(true)}
          style={styles.sortBtn}
        >
          <Text style={styles.sortBtnText} numberOfLines={1}>
            {activeSortLabel} ▾
          </Text>
        </Pressable>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.toggleItem}>
          <Switch
            value={hideInactive}
            onValueChange={setHideInactive}
            trackColor={{ true: colors.brand, false: colors.border }}
            thumbColor={colors.card}
          />
          <Text style={styles.toggleLabel}>Hide inactive</Text>
        </View>
        <Pressable
          onPress={() => {
            setCompareMode((v) => !v);
            setSelectedIds(new Set());
          }}
          style={[styles.actionBtn, compareMode && styles.actionBtnActive]}
        >
          <Text
            style={[styles.actionBtnText, compareMode && styles.actionBtnTextActive]}
          >
            {compareMode ? 'Cancel' : 'Compare'}
          </Text>
        </Pressable>
        <Pressable onPress={exportCsv} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Export CSV</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + 60 }}
      >
        {overlapsQ.data?.total > 0 && !compareMode && (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(app)/admin/overlaps',
                params: { preset: range.preset },
              })
            }
            style={({ pressed }) => [
              styles.overlapBanner,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.overlapBannerIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.overlapBannerTitle}>
                {overlapsQ.data.total}{' '}
                {overlapsQ.data.total === 1 ? 'house' : 'houses'} hit by 2+ canvassers
              </Text>
              <Text style={styles.overlapBannerSub}>Tap to review overlap</Text>
            </View>
            <Text style={styles.overlapBannerChevron}>›</Text>
          </Pressable>
        )}

        <View style={styles.totalsCard}>
          <Text style={styles.totalsTitle}>
            Totals · {filteredSorted.length}{' '}
            {filteredSorted.length === 1 ? 'canvasser' : 'canvassers'}
          </Text>
          <View style={styles.totalsRow}>
            <View style={styles.totalsCol}>
              <Text style={styles.totalsValue}>{totals.houses.toLocaleString()}</Text>
              <Text style={styles.totalsLabel}>Houses</Text>
            </View>
            <View style={styles.totalsDivider} />
            {isLitDrop ? (
              <View style={styles.totalsCol}>
                <Text style={styles.totalsValue}>{totals.litDrops.toLocaleString()}</Text>
                <Text style={styles.totalsLabel}>Lit drops</Text>
              </View>
            ) : (
              <View style={styles.totalsCol}>
                <Text style={styles.totalsValue}>{totals.surveys.toLocaleString()}</Text>
                <Text style={styles.totalsLabel}>Surveys</Text>
              </View>
            )}
            <View style={styles.totalsDivider} />
            <View style={styles.totalsCol}>
              <Text style={styles.totalsValue}>
                {totals.houses > 0
                  ? `${Math.round((totals.surveys / totals.houses) * 100)}%`
                  : '—'}
              </Text>
              <Text style={styles.totalsLabel}>Connection</Text>
            </View>
          </View>
        </View>

        {canvassersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : filteredSorted.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {search ? 'No matches.' : 'No activity in this range yet.'}
            </Text>
          </View>
        ) : (
          filteredSorted.map((r, i) => {
            const name =
              `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email;
            const primary = isLitDrop ? r.litDropped || 0 : r.surveysSubmitted || 0;
            const primaryLabel = isLitDrop ? 'lit drops' : 'surveys';
            const rangeStr = formatRange(r.firstActivityAt, r.lastActivityAt);
            const checked = selectedIds.has(r.userId);
            return (
              <Pressable
                key={r.userId}
                onPress={() => rowOnPress(r)}
                style={({ pressed }) => [
                  styles.row,
                  pressed && { opacity: 0.7 },
                  compareMode && checked && styles.rowChecked,
                ]}
              >
                {compareMode ? (
                  <View style={[styles.check, checked && styles.checkOn]}>
                    {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                ) : (
                  <Text style={styles.rank}>{i + 1}</Text>
                )}
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(name) || '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {name}
                    {!r.isActive && <Text style={styles.inactive}> · inactive</Text>}
                  </Text>
                  <Text style={styles.meta}>{r.email}</Text>
                  <View style={styles.statsLine}>
                    <Text style={styles.statBold}>{r.homesKnocked || 0}</Text>
                    <Text style={styles.stat}> houses · </Text>
                    <Text style={styles.statBold}>{primary}</Text>
                    <Text style={styles.stat}> {primaryLabel}</Text>
                    {!isLitDrop && (r.notHome || r.wrongAddress) ? (
                      <Text style={styles.stat}>
                        {' · '}
                        {r.notHome || 0} not home, {r.wrongAddress || 0} wrong addr
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.statsLine}>
                    {r.hours > 0 ? (
                      <Text style={styles.metaSmall}>
                        {r.hours.toFixed(1)}h ·{' '}
                        {r.doorsPerHour.toFixed(1)} doors/hr
                      </Text>
                    ) : null}
                    {r.homesKnocked > 0 ? (
                      <Text style={styles.metaSmall}>
                        {' · '}
                        {Math.round(r.connection * 100)}% connection
                      </Text>
                    ) : null}
                  </View>
                  {rangeStr ? (
                    <Text style={styles.shift}>🕘 {rangeStr}</Text>
                  ) : null}
                </View>
                {!compareMode ? (
                  <Text style={styles.chev}>›</Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {compareMode ? (
        <View style={styles.compareBar}>
          <Text style={styles.compareCount}>
            {selectedIds.size} selected
          </Text>
          <Pressable
            onPress={openCompare}
            disabled={selectedIds.size < 2}
            style={[
              styles.compareGo,
              selectedIds.size < 2 && styles.compareGoDisabled,
            ]}
          >
            <Text style={styles.compareGoText}>
              Compare {selectedIds.size > 0 ? selectedIds.size : ''} ›
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSortMenuOpen(false)}>
          <Pressable style={styles.sortSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sortSheetTitle}>Sort by</Text>
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sortKey;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setSortKey(opt.key);
                    setSortMenuOpen(false);
                  }}
                  style={[styles.sortOpt, active && styles.sortOptActive]}
                >
                  <Text style={[styles.sortOptText, active && styles.sortOptTextActive]}>
                    {active ? '✓ ' : '  '}
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
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
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  searchIcon: { marginRight: spacing.xs, fontSize: 13 },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 14,
  },
  clear: { color: colors.textMuted, fontSize: 14, paddingHorizontal: spacing.xs },
  sortBtn: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 130,
  },
  sortBtnText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  toggleItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleLabel: { ...type.caption, color: colors.textSecondary },
  actionBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  actionBtnText: { ...type.caption, color: colors.textPrimary, fontWeight: '700' },
  actionBtnTextActive: { color: colors.textInverse },

  totalsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  totalsTitle: { ...type.micro, marginBottom: spacing.sm },
  totalsRow: { flexDirection: 'row', alignItems: 'center' },
  totalsCol: { flex: 1, alignItems: 'center' },
  totalsValue: { ...type.h2, fontSize: 22 },
  totalsLabel: { ...type.caption, marginTop: 2 },
  totalsDivider: { width: 1, height: 28, backgroundColor: colors.border },

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
    gap: spacing.sm,
  },
  rowChecked: {
    borderColor: colors.brand,
    backgroundColor: colors.brandTint,
  },
  rank: {
    width: 22,
    fontSize: 13,
    fontWeight: '800',
    color: colors.brand,
    textAlign: 'center',
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  checkMark: { color: colors.textInverse, fontWeight: '800', fontSize: 14 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
  name: { ...type.bodyStrong, fontSize: 14 },
  inactive: { ...type.caption, color: colors.textMuted, fontWeight: '400' },
  meta: { ...type.caption, marginTop: 1 },
  metaSmall: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  statsLine: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  stat: { fontSize: 12, color: colors.textSecondary },
  statBold: { fontSize: 12, color: colors.textPrimary, fontWeight: '700' },
  shift: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  chev: { fontSize: 22, color: colors.textMuted, fontWeight: '300' },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, textAlign: 'center' },

  overlapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warnBg,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#FBBF24',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  overlapBannerIcon: { fontSize: 18 },
  overlapBannerTitle: { color: '#92400E', fontWeight: '700', fontSize: 14 },
  overlapBannerSub: { color: '#92400E', fontSize: 12, marginTop: 1 },
  overlapBannerChevron: { color: '#92400E', fontWeight: '700', fontSize: 22 },

  compareBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.raised,
  },
  compareCount: {
    color: colors.textInverse,
    fontWeight: '700',
    flex: 1,
  },
  compareGo: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  compareGoDisabled: { opacity: 0.4 },
  compareGoText: { color: colors.textInverse, fontWeight: '800' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  sortSheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: '100%',
    maxWidth: 320,
    ...shadow.raised,
  },
  sortSheetTitle: { ...type.h3, marginBottom: spacing.sm },
  sortOpt: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  sortOptActive: { backgroundColor: colors.brandTint },
  sortOptText: { ...type.body },
  sortOptTextActive: { color: colors.brand, fontWeight: '700' },
});
