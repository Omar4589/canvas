import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { PRESETS, rangeFor, labelForRange, todayInTz, deviceTimezone } from '../../../lib/dateRanges';
import { spacing, radius } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import KpiGrid from '../../../components/KpiGrid';
import TabSwitcher from '../../../components/TabSwitcher';
import LiveStatus from '../../../components/LiveStatus';
import FlaggedEntryCard from '../../../components/FlaggedEntryCard';
import FlagLegendHint from '../../../components/FlagLegendHint';

const AUDIT_MAX_DAYS = 62;
const AUDIT_PRESETS = PRESETS.filter((p) => p.key !== 'all');
const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'all', label: 'All' },
];
const FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

export default function AdminAudit() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();
  const qc = useQueryClient();

  // Campaign scoping via CampaignChip (like Timeline/Map). This is a hidden Tabs screen that
  // stays mounted, so re-sync the active campaign on focus (a per-campaign drill-in sets it first).
  const [campaign, setCampaign] = useState(undefined);
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone || deviceTimezone();

  const [reviewStatus, setReviewStatus] = useState('open');
  const [userId, setUserId] = useState(''); // '' = all canvassers
  const [live, setLive] = useState(true);
  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    // Default to TODAY (item D3) — the audit is a daily review; wider windows are one tap away.
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);

  // Reset view state when the resolved campaign changes (screen stays mounted).
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setReviewStatus('open');
    setUserId('');
    setLive(true);
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
    rangeTouchedRef.current = false;
  }

  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
  }, [tz]);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  const today = todayInTz(tz);
  const fromDay = range ? (range.preset === 'today' ? today : range.from) : null;
  const effectiveTo = range ? range.to || today : null;
  const includesToday = !!range && (!range.to || range.to >= today);
  const rangeInvalid =
    !!range && (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > AUDIT_MAX_DAYS);

  const q = useQuery({
    queryKey: ['admin', 'flags', cId, fromDay, range?.to, reviewStatus, userId],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      p.set('from', fromDay);
      if (range?.to) p.set('to', range.to);
      if (reviewStatus && reviewStatus !== 'all') p.set('reviewStatus', reviewStatus);
      if (userId) p.set('userId', userId);
      p.set('limit', '500');
      return api(`/admin/reports/flags?${p.toString()}`);
    },
    enabled: !!cId && !!fromDay && !rangeInvalid,
    refetchInterval: live && includesToday ? 20_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    ...useFocusedPoll(20 * 1000),
  });

  const data = q.data || {};
  const totals = data.summary?.totals || {};
  const byCanvasser = data.summary?.byCanvasser || [];
  const entries = data.entries || [];
  const rangeLabel = labelForRange(range);

  // Brief confirmation after a review; refresh this screen + the map flag layer.
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  function onReviewed(review) {
    setFlash(`Flag ${FLASH_LABEL[review?.status] || 'updated'}`);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
    // Also mark the mock-GPS nudge counts stale (campaign cards / audit tile / More row
    // via ['admin','campaigns']; Overview pills via the campaign-rollup keys).
    qc.invalidateQueries({
      predicate: (query) =>
        query.queryKey?.[0] === 'admin' &&
        (query.queryKey?.[1] === 'flags' ||
          query.queryKey?.[1] === 'flags-map' ||
          query.queryKey?.[1] === 'campaigns' ||
          (query.queryKey?.[1] === 'reports' && query.queryKey?.[2] === 'campaign-rollup')),
    });
  }

  const kpiTiles = [
    { label: 'Open', value: (totals.open || 0).toLocaleString(), sub: 'Need review', level: totals.open > 0 ? 'caution' : undefined },
    { label: 'Mock GPS', value: (totals.mockGps || 0).toLocaleString(), sub: 'Mock provider' },
    { label: 'Far', value: (totals.far || 0).toLocaleString(), sub: 'From house' },
    { label: 'Rapid', value: (totals.rapid || 0).toLocaleString(), sub: 'Too fast' },
    { label: 'One-spot', value: (totals.oneSpot || 0).toLocaleString(), sub: 'One place' },
    { label: 'Weak GPS', value: (totals.weakGps || 0).toLocaleString(), sub: 'Unreliable' },
    { label: 'Total', value: (totals.flaggedActions || 0).toLocaleString(), sub: rangeLabel },
  ];

  const canvasserTabs = [
    { key: '', label: 'All' },
    ...byCanvasser.map((c) => ({ key: String(c.userId), label: `${c.name || 'Canvasser'} (${c.openCount || 0})` })),
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>GPS audit</Text>
        {/* Same width as the back button so the title stays centered; the (i) opens the
            flag-type legend. */}
        <View style={{ width: 80, alignItems: 'flex-end' }}>
          <FlagLegendHint />
        </View>
      </View>
      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} presets={AUDIT_PRESETS} />

      <View style={styles.controls}>
        <TabSwitcher tabs={STATUS_TABS} activeKey={reviewStatus} onChange={setReviewStatus} />
        {includesToday ? (
          <LiveStatus
            live={live}
            onToggle={() => setLive((v) => !v)}
            isFetching={q.isFetching}
            updatedAt={q.dataUpdatedAt}
            onRefresh={() => q.refetch()}
          />
        ) : null}
      </View>

      {rangeInvalid ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>That range won't work</Text>
          <Text style={styles.emptyText}>Pick a range spanning at most {AUDIT_MAX_DAYS} days.</Text>
        </View>
      ) : q.isError && !q.data ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn't load the audit</Text>
          <Text style={styles.emptyText}>{q.error?.message || 'Check your connection and try again.'}</Text>
          <Pressable onPress={() => q.refetch()} style={styles.retryBtn} hitSlop={6}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          <View style={styles.kpiWrap}>
            <KpiGrid tiles={kpiTiles} columns={3} compact />
          </View>

          {byCanvasser.length > 0 ? (
            <TabSwitcher tabs={canvasserTabs} activeKey={userId} onChange={setUserId} />
          ) : null}

          <View style={styles.listWrap}>
            {entries.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No flagged entries</Text>
                <Text style={styles.emptyText}>
                  {reviewStatus === 'open'
                    ? 'Nothing needs review for this range.'
                    : `No ${reviewStatus === 'all' ? '' : reviewStatus + ' '}flags in this range.`}
                </Text>
              </View>
            ) : (
              entries.map((e) => (
                <FlaggedEntryCard
                  key={e.actionId}
                  entry={e}
                  tz={tz}
                  onReviewed={onReviewed}
                  // "View on map" (item D4) — the web audit has this per entry; the map turns
                  // its flag layer on, selects this entry, and flies to its GPS point.
                  onViewOnMap={(entry) =>
                    router.push(
                      `/(app)/admin/map?flag=1&focusActivityId=${entry.actionId}&focusAt=${Date.now()}`
                    )
                  }
                />
              ))
            )}
            {data.total > entries.length ? (
              <Text style={styles.truncated}>
                Showing {entries.length} of {data.total} — narrow the range or filters to see the rest.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      )}

      {flash ? (
        <View style={styles.flash} pointerEvents="none">
          <Text style={styles.flashText}>✓ {flash}</Text>
        </View>
      ) : null}
    </SafeAreaView>
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
    back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
    headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
    chipWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    controls: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
    emptyTitle: { ...type.h3 },
    emptyText: { ...type.caption, textAlign: 'center' },
    retryBtn: {
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.brand,
    },
    retryBtnText: { color: colors.textInverse, fontWeight: '700', fontSize: 14 },
    kpiWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    listWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.xl,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      gap: spacing.xs,
    },
    truncated: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
    flash: {
      position: 'absolute',
      bottom: spacing.xl,
      alignSelf: 'center',
      backgroundColor: colors.textPrimary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    flashText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
  });
}
