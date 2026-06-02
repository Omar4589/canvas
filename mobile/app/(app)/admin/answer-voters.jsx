import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import VoterRow from '../../../components/VoterRow';
import { deviceTimezone } from '../../../lib/dateRanges';
import { colors, spacing, type } from '../../../lib/theme';

const PAGE = 25;

function one(p) {
  return Array.isArray(p) ? p[0] : p;
}

export default function AnswerVoters() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const campaignId = one(params.campaignId);
  const questionKey = one(params.questionKey);
  const option = one(params.option);
  const label = one(params.label);
  const from = one(params.from);
  const to = one(params.to);

  const [skip, setSkip] = useState(0);
  const [items, setItems] = useState([]);
  const loadedSkips = useRef(new Set());

  const q = useQuery({
    queryKey: ['admin', 'answer-voters', campaignId, questionKey, option, from, to, skip],
    queryFn: () => {
      const p = new URLSearchParams({
        campaignId,
        questionKey,
        option: option ?? '',
        tz: deviceTimezone(),
        limit: String(PAGE),
        skip: String(skip),
      });
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      return api(`/admin/reports/voters-by-answer?${p.toString()}`);
    },
    enabled: !!campaignId && !!questionKey && option != null,
  });

  useEffect(() => {
    if (!q.data?.voters) return;
    if (loadedSkips.current.has(skip)) return;
    loadedSkips.current.add(skip);
    setItems((prev) => [...prev, ...q.data.voters]);
  }, [q.data, skip]);

  const total = q.data?.total ?? 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.title} numberOfLines={2}>{label || 'Responses'}</Text>
        <Text style={styles.subtitle}>
          “{option}” · {total.toLocaleString()} {total === 1 ? 'voter' : 'voters'}
        </Text>

        {items.map((v) => (
          <VoterRow key={v.responseId} v={v} showCanvasser />
        ))}

        {q.isLoading && items.length === 0 ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : items.length === 0 ? (
          <Text style={styles.muted}>No voters for this answer.</Text>
        ) : items.length < total ? (
          <Pressable
            onPress={() => setSkip(items.length)}
            disabled={q.isFetching}
            style={({ pressed }) => [styles.loadMore, pressed && { opacity: 0.85 }]}
          >
            {q.isFetching ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Text style={styles.loadMoreText}>Load more ({total - items.length} left)</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  back: { color: colors.brand, fontWeight: '600', fontSize: 14 },
  title: { ...type.h2, fontSize: 18, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginBottom: spacing.md },
  muted: { ...type.caption, marginTop: spacing.lg, textAlign: 'center' },
  loadMore: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  loadMoreText: { color: colors.brand, fontWeight: '700', fontSize: 14 },
});
