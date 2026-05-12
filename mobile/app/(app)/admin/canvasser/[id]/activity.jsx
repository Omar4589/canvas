import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Switch,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { loadActiveCampaign } from '../../../../../lib/cache';
import { rangeFor, deviceTimezone } from '../../../../../lib/dateRanges';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import TabSwitcher from '../../../../../components/TabSwitcher';
import ActivityRow from '../../../../../components/ActivityRow';
import { downloadCsv } from '../../../../../lib/csv';

const PAGE_SIZE = 50;
const ACTION_TABS = [
  { key: 'all', label: 'All' },
  { key: 'survey_submitted', label: 'Surveys' },
  { key: 'not_home', label: 'Not home' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'lit_dropped', label: 'Lit drop' },
  { key: 'note_added', label: 'Notes' },
];

export default function ActivityFeed() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const [range, setRange] = useState(() => {
    const preset = params.preset || '7d';
    if (params.from || params.to) return { preset, from: params.from || null, to: params.to || null };
    const r = rangeFor(preset);
    return { preset, from: r.from, to: r.to };
  });

  const [actionTab, setActionTab] = useState('all');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [skip, setSkip] = useState(0);

  // Reset pagination when filters change
  useEffect(() => {
    setSkip(0);
  }, [range, actionTab, flaggedOnly]);

  const cId = campaign?.id;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    if (actionTab !== 'all') p.set('actionType', actionTab);
    if (flaggedOnly) p.set('flaggedOnly', 'true');
    p.set('limit', String(PAGE_SIZE));
    p.set('skip', String(skip));
    p.set('tz', deviceTimezone());
    return p.toString();
  }, [cId, range.from, range.to, actionTab, flaggedOnly, skip]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'activities-feed', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/activities?${qs}`),
    enabled: !!cId && !!userId,
    keepPreviousData: true,
  });

  const total = q.data?.total || 0;
  const activities = q.data?.activities || [];
  const showingTo = Math.min(skip + PAGE_SIZE, total);

  function exportCsv() {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('tz', deviceTimezone());
    downloadCsv(
      `/admin/reports/canvassers/${userId}/export.csv?${p.toString()}`,
      `canvasser-${userId}-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Activity feed</Text>
        <Pressable onPress={exportCsv} hitSlop={8}>
          <Text style={styles.export}>CSV</Text>
        </Pressable>
      </View>

      <DateRangeBar value={range} onChange={setRange} />
      <TabSwitcher tabs={ACTION_TABS} activeKey={actionTab} onChange={setActionTab} />

      <View style={styles.toggleRow}>
        <Switch
          value={flaggedOnly}
          onValueChange={setFlaggedOnly}
          trackColor={{ true: colors.danger, false: colors.border }}
          thumbColor={colors.card}
        />
        <Text style={styles.toggleLabel}>Only flagged (offline or &gt;50m)</Text>
        <Text style={styles.count}>
          {total > 0 ? `${skip + 1}–${showingTo} of ${total}` : '0'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : activities.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No matching activity.</Text>
          </View>
        ) : (
          activities.map((a) => <ActivityRow key={a.id} activity={a} showDate />)
        )}

        {total > PAGE_SIZE ? (
          <View style={styles.pagerRow}>
            <Pressable
              onPress={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
              style={[styles.pagerBtn, skip === 0 && styles.pagerBtnDisabled]}
            >
              <Text style={styles.pagerBtnText}>‹ Prev</Text>
            </Pressable>
            <Pressable
              onPress={() => setSkip(skip + PAGE_SIZE)}
              disabled={showingTo >= total}
              style={[
                styles.pagerBtn,
                showingTo >= total && styles.pagerBtnDisabled,
              ]}
            >
              <Text style={styles.pagerBtnText}>Next ›</Text>
            </Pressable>
          </View>
        ) : null}
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
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 60 },
  export: { color: colors.brand, fontWeight: '700', fontSize: 14, width: 60, textAlign: 'right' },
  title: { ...type.h3, flex: 1, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  toggleLabel: { ...type.caption, flex: 1 },
  count: { ...type.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, fontStyle: 'italic' },
  pagerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pagerBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.card,
  },
  pagerBtnDisabled: { opacity: 0.4 },
  pagerBtnText: { ...type.bodyStrong, color: colors.brand },
});
