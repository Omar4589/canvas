import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
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
import PinIcon from '../../../../../components/PinIcon';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong addr',
  lit_dropped: 'Lit dropped',
  note_added: 'Note added',
};
const ACTION_PIN = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  lit_dropped: 'lit_dropped',
  note_added: 'unknocked',
};

export default function HouseholdsScreen() {
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

  const [search, setSearch] = useState('');

  const cId = campaign?.id;
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    p.set('tz', deviceTimezone());
    p.set('limit', '500');
    if (search) p.set('q', search);
    return p.toString();
  }, [cId, range.from, range.to, search]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'households', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/households?${qs}`),
    enabled: !!cId && !!userId,
  });

  const households = q.data?.households || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Households visited</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <View style={styles.searchWrap}>
        <TextInput
          placeholder="Search address, city, or zip"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          autoCorrect={false}
        />
        {search ? (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : households.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {search ? 'No matching addresses.' : 'No households visited in this range.'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.countLabel}>
              {q.data.total} unique household{q.data.total === 1 ? '' : 's'} ·{' '}
              {households.reduce((a, h) => a + h.visits, 0)} total visits
            </Text>
            {households.map((h) => (
              <View key={h.household.id} style={styles.row}>
                <PinIcon status={ACTION_PIN[h.finalAction] || 'unknocked'} size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.address}>
                    {h.household.addressLine1}
                    {h.household.addressLine2 ? `, ${h.household.addressLine2}` : ''}
                  </Text>
                  <Text style={styles.cityZip}>
                    {h.household.city}, {h.household.state} {h.household.zipCode}
                  </Text>
                  <Text style={styles.meta}>
                    {h.visits} visit{h.visits === 1 ? '' : 's'} · last:{' '}
                    {ACTION_LABEL[h.finalAction] || h.finalAction} ·{' '}
                    {timeAgo(h.lastAt)}
                  </Text>
                  {h.actionTypes.length > 1 ? (
                    <Text style={styles.meta}>
                      Actions:{' '}
                      {h.actionTypes
                        .map((a) => ACTION_LABEL[a] || a)
                        .join(', ')}
                    </Text>
                  ) : null}
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, paddingVertical: 8, fontSize: 14, color: colors.textPrimary },
  clear: { color: colors.textMuted, fontSize: 14 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  countLabel: { ...type.caption, marginBottom: spacing.sm, color: colors.textMuted },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  address: { ...type.bodyStrong, fontSize: 14 },
  cityZip: { ...type.caption, marginTop: 1 },
  meta: { ...type.caption, marginTop: 4, color: colors.textMuted },
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
