import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueries } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { loadActiveCampaign } from '../../../../lib/cache';
import { rangeFor, deviceTimezone, labelForRange } from '../../../../lib/dateRanges';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';
import DateRangeBar from '../../../../components/DateRangeBar';

// Each KPI row in the table. accessor pulls value out of the summary
// response. formatter renders it for display. higherIsBetter controls
// which value is highlighted as best.
const KPIS = [
  {
    key: 'homesKnocked',
    label: 'Houses knocked',
    accessor: (s) => s?.kpi.homesKnocked || 0,
    format: (v) => v.toLocaleString(),
    higherIsBetter: true,
  },
  {
    key: 'surveysSubmitted',
    label: 'Surveys',
    accessor: (s) => s?.kpi.surveysSubmitted || 0,
    format: (v) => v.toLocaleString(),
    higherIsBetter: true,
  },
  {
    key: 'connectionRatePct',
    label: 'Connection rate',
    accessor: (s) => s?.kpi.connectionRatePct || 0,
    format: (v) => `${Math.round(v * 10) / 10}%`,
    higherIsBetter: true,
  },
  {
    key: 'hoursOnDoors',
    label: 'Hours on doors',
    accessor: (s) => s?.kpi.hoursOnDoors || 0,
    format: (v) => `${v.toFixed(1)}h`,
    higherIsBetter: true,
  },
  {
    key: 'daysActive',
    label: 'Days active',
    accessor: (s) => s?.kpi.daysActive || 0,
    format: (v) => String(v),
    higherIsBetter: true,
  },
  {
    key: 'doorsPerHour',
    label: 'Doors / hour',
    accessor: (s) => s?.kpi.doorsPerHour || 0,
    format: (v) => v.toFixed(1),
    higherIsBetter: true,
  },
  {
    key: 'surveysPerHour',
    label: 'Surveys / hour',
    accessor: (s) => s?.kpi.surveysPerHour || 0,
    format: (v) => v.toFixed(1),
    higherIsBetter: true,
  },
  {
    key: 'avgMinutesPerDoor',
    label: 'Avg minutes / door',
    accessor: (s) => s?.kpi.avgMinutesPerDoor || 0,
    format: (v) => (v ? v.toFixed(1) : '—'),
    higherIsBetter: false,
  },
  {
    key: 'offlinePercent',
    label: 'Offline %',
    accessor: (s) => s?.quality.offlinePercent || 0,
    format: (v) => `${v}%`,
    higherIsBetter: false,
  },
  {
    key: 'farFromHousePercent',
    label: 'Knocks > 50m %',
    accessor: (s) => s?.quality.farFromHousePercent || 0,
    format: (v) => `${v}%`,
    higherIsBetter: false,
  },
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

export default function Compare() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const ids = useMemo(
    () => (params.ids ? String(params.ids).split(',').filter(Boolean) : []),
    [params.ids]
  );

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

  const cId = campaign?.id;
  const qsBase = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('tz', deviceTimezone());
    return p.toString();
  }, [cId, range.from, range.to]);

  // One summary query per selected canvasser
  const summaryQs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['admin', 'canvasser', id, 'summary-compare', qsBase],
      queryFn: () => api(`/admin/reports/canvassers/${id}/summary?${qsBase}`),
      enabled: !!cId && !!id,
    })),
  });

  const teamQ = useQuery({
    queryKey: ['admin', 'canvasser', 'team-avg-compare', qsBase],
    queryFn: () => api(`/admin/reports/team-averages?${qsBase}`),
    enabled: !!cId,
  });

  const summaries = summaryQs.map((q) => q.data).filter(Boolean);
  const loading =
    summaryQs.some((q) => q.isLoading) || teamQ.isLoading;
  const team = teamQ.data?.avg;

  // For each KPI, identify the index of the "best" value among loaded summaries
  function bestIndex(kpi) {
    const values = summaries.map((s) => kpi.accessor(s));
    if (values.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < values.length; i++) {
      if (kpi.higherIsBetter ? values[i] > values[best] : values[i] < values[best]) {
        best = i;
      }
    }
    return best;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Compare canvassers</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : summaries.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No canvassers selected.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.rangeLabel}>
            {labelForRange(range)} ·{' '}
            {teamQ.data?.canvasserCount
              ? `team of ${teamQ.data.canvasserCount}`
              : ''}
          </Text>

          {/* Person header row */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.table}>
              <View style={styles.headerRow}>
                <View style={[styles.cellLabel, styles.cellLabelHeader]}>
                  <Text style={styles.kpiHeader}>KPI</Text>
                </View>
                {summaries.map((s) => (
                  <View key={s.user.id} style={styles.personCell}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {initials(`${s.user.firstName} ${s.user.lastName}`) || '?'}
                      </Text>
                    </View>
                    <Text style={styles.personName} numberOfLines={1}>
                      {s.user.firstName} {s.user.lastName}
                    </Text>
                  </View>
                ))}
                {team ? (
                  <View style={[styles.personCell, styles.teamCell]}>
                    <Text style={styles.teamLabel}>Team avg</Text>
                  </View>
                ) : null}
              </View>

              {KPIS.map((kpi) => {
                const best = bestIndex(kpi);
                return (
                  <View key={kpi.key} style={styles.row}>
                    <View style={styles.cellLabel}>
                      <Text style={styles.kpiLabel}>{kpi.label}</Text>
                    </View>
                    {summaries.map((s, i) => {
                      const v = kpi.accessor(s);
                      return (
                        <View
                          key={s.user.id}
                          style={[styles.valueCell, i === best && styles.bestCell]}
                        >
                          <Text style={[styles.valueText, i === best && styles.bestText]}>
                            {kpi.format(v)}
                          </Text>
                        </View>
                      );
                    })}
                    {team ? (
                      <View style={[styles.valueCell, styles.teamCell]}>
                        <Text style={styles.teamValue}>
                          {kpi.format(team[kpi.key] != null ? team[kpi.key] : 0)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.legend}>
            <View style={styles.legendDot} />
            <Text style={styles.legendText}>Best in row</Text>
          </View>

          <Text style={styles.helpText}>
            Tap any canvasser column to open their full drilldown.
          </Text>
          <View style={styles.openRow}>
            {summaries.map((s) => (
              <Pressable
                key={s.user.id}
                onPress={() =>
                  router.push({
                    pathname: `/(app)/admin/canvasser/${s.user.id}`,
                    params: {
                      from: range.from || '',
                      to: range.to || '',
                      preset: range.preset,
                    },
                  })
                }
                style={({ pressed }) => [styles.openBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.openBtnText}>
                  Open {s.user.firstName} ›
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const CELL_LABEL_W = 160;
const VALUE_W = 130;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  title: { ...type.h3, flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { ...type.caption, fontStyle: 'italic' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  rangeLabel: { ...type.caption, marginBottom: spacing.md, fontStyle: 'italic' },
  table: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.card,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cellLabel: {
    width: CELL_LABEL_W,
    padding: spacing.sm,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: 'center',
  },
  cellLabelHeader: { backgroundColor: colors.bg },
  kpiHeader: { ...type.micro },
  kpiLabel: { ...type.bodyStrong, fontSize: 12 },
  personCell: {
    width: VALUE_W,
    padding: spacing.sm,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 12 },
  personName: { ...type.caption, fontWeight: '700', maxWidth: VALUE_W - 16 },
  teamCell: { backgroundColor: colors.bg },
  teamLabel: { ...type.micro },
  teamValue: { ...type.bodyStrong, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  valueCell: {
    width: VALUE_W,
    padding: spacing.md,
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  valueText: { ...type.body, fontVariant: ['tabular-nums'] },
  bestCell: { backgroundColor: colors.successBg },
  bestText: { color: colors.success, fontWeight: '800' },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 3,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.success,
  },
  legendText: { ...type.caption, color: colors.textMuted },
  helpText: { ...type.caption, marginTop: spacing.md, color: colors.textMuted },
  openRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  openBtn: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  openBtnText: { ...type.bodyStrong, fontSize: 13, color: colors.brand },
});
