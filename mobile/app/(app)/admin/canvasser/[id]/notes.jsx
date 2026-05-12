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
import { rangeFor } from '../../../../../lib/dateRanges';
import { formatExact, timeAgo } from '../../../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import PinIcon from '../../../../../components/PinIcon';

const ACTION_LABEL = {
  survey_submitted: 'Survey',
  not_home: 'Not home',
  wrong_address: 'Wrong addr',
  lit_dropped: 'Lit dropped',
  note_added: 'Note',
};
const ACTION_PIN = {
  survey_submitted: 'surveyed',
  not_home: 'not_home',
  wrong_address: 'wrong_address',
  lit_dropped: 'lit_dropped',
  note_added: 'unknocked',
};

export default function NotesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const [range, setRange] = useState(() => {
    const preset = params.preset || '30d';
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
    return p.toString();
  }, [cId, range.from, range.to]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'notes', qs],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/notes?${qs}`),
    enabled: !!cId && !!userId,
  });

  const notes = q.data?.notes || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Notes</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : notes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No notes in this range.</Text>
          </View>
        ) : (
          notes.map((n) => (
            <View key={`${n.source}-${n.id}`} style={styles.row}>
              <PinIcon status={ACTION_PIN[n.actionType] || 'unknocked'} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={styles.note}>“{n.note}”</Text>
                <Text style={styles.meta}>
                  {ACTION_LABEL[n.actionType] || n.actionType}
                  {n.voter?.fullName ? ` · ${n.voter.fullName}` : ''}
                </Text>
                {n.household ? (
                  <Text style={styles.address}>
                    {n.household.addressLine1}, {n.household.city} {n.household.state}
                  </Text>
                ) : null}
                <Text style={styles.timestamp}>
                  {formatExact(n.timestamp)} · {timeAgo(n.timestamp)}
                </Text>
              </View>
            </View>
          ))
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
  note: { ...type.body, fontStyle: 'italic' },
  meta: { ...type.caption, fontWeight: '600', marginTop: spacing.xs },
  address: { ...type.caption, marginTop: 1 },
  timestamp: { ...type.caption, color: colors.textMuted, marginTop: 4 },
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
