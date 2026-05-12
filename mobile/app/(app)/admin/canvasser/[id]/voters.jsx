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
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../../lib/api';
import { loadActiveCampaign } from '../../../../../lib/cache';
import { rangeFor, deviceTimezone } from '../../../../../lib/dateRanges';
import { timeAgo } from '../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import BarChart from '../../../../../components/BarChart';
import SectionHeader from '../../../../../components/SectionHeader';

const PARTY_COLOR = {
  Democratic: '#3B82F6',
  Republican: '#EF4444',
  Independent: '#A855F7',
  'No Party': '#9CA3AF',
  Other: '#F59E0B',
  Unknown: '#9CA3AF',
};

export default function VotersScreen() {
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

  const cId = campaign?.id;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('limit', '500');
    return p.toString();
  }, [cId, range.from, range.to]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'voters', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/voters?${qs}`),
    enabled: !!cId && !!userId,
  });

  const voters = q.data?.voters || [];
  const partyData = (q.data?.partyBreakdown || []).map((p) => ({
    label: p.value,
    value: p.count,
    color: PARTY_COLOR[p.value] || colors.brand,
  }));
  const genderData = (q.data?.genderBreakdown || []).map((g) => ({
    label: g.value,
    value: g.count,
  }));

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Voters surveyed</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : voters.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No voters surveyed in this range.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.countLabel}>
              {q.data.total} voter{q.data.total === 1 ? '' : 's'} surveyed
            </Text>

            <SectionHeader title="Party breakdown" />
            <View style={styles.chartCard}>
              <BarChart data={partyData} />
            </View>

            <SectionHeader title="Gender breakdown" />
            <View style={styles.chartCard}>
              <BarChart data={genderData} />
            </View>

            <SectionHeader title="Recent" />
            {voters.map((v) => (
              <View key={v.responseId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {v.voter?.fullName || 'Unknown voter'}
                    {v.voter?.party ? (
                      <Text style={styles.party}> · {v.voter.party}</Text>
                    ) : null}
                  </Text>
                  {v.household ? (
                    <Text style={styles.address}>
                      {v.household.addressLine1}, {v.household.city} {v.household.state}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {timeAgo(v.submittedAt)}
                    {v.voter?.gender ? ` · ${v.voter.gender}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </>
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
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  title: { ...type.h3, flex: 1, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  countLabel: { ...type.caption, color: colors.textMuted, marginBottom: spacing.sm },
  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  name: { ...type.bodyStrong, fontSize: 14 },
  party: { color: colors.textSecondary, fontWeight: '400' },
  address: { ...type.caption, marginTop: 1 },
  meta: { ...type.caption, color: colors.textMuted, marginTop: 4 },
  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, fontStyle: 'italic' },
});
