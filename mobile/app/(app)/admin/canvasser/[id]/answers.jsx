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
import { colors, radius, spacing, type, shadow } from '../../../../../lib/theme';
import DateRangeBar from '../../../../../components/DateRangeBar';
import BarChart from '../../../../../components/BarChart';

export default function AnswersScreen() {
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
    p.set('userId', userId);
    p.set('compareToOrg', 'true');
    return p.toString();
  }, [cId, range.from, range.to, userId]);

  const q = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'answers', qs],
    queryFn: () => api(`/admin/reports/survey-results?${qs}`),
    enabled: !!cId && !!userId,
  });

  const data = q.data;
  const isLitDrop = campaign?.type === 'lit_drop';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Survey answers</Text>
        <View style={{ width: 80 }} />
      </View>

      <DateRangeBar value={range} onChange={setRange} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {q.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : isLitDrop ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>This campaign has no survey.</Text>
          </View>
        ) : !data || !data.surveyTemplate ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No survey template found.</Text>
          </View>
        ) : data.questions.length === 0 || data.totalResponses === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No responses from this canvasser in the selected range.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryCard}>
              <Text style={styles.surveyName}>{data.surveyTemplate.name}</Text>
              <Text style={styles.totals}>
                {data.totalResponses} response{data.totalResponses === 1 ? '' : 's'} by this canvasser
                {data.compareToOrg
                  ? ` · ${data.orgTotalResponses} org-wide`
                  : ''}
              </Text>
            </View>

            {data.questions.map((qn) => (
              <View key={qn.key} style={styles.qCard}>
                <Text style={styles.qLabel}>{qn.label}</Text>
                {qn.type === 'text' ? (
                  qn.options.length === 0 ? (
                    <Text style={styles.muted}>No free-text answers.</Text>
                  ) : (
                    qn.options.slice(0, 10).map((opt, i) => (
                      <View key={i} style={styles.verbatim}>
                        <Text style={styles.verbatimText}>“{opt.option}”</Text>
                        <Text style={styles.verbatimMeta}>
                          {opt.count} {opt.count === 1 ? 'response' : 'responses'}
                        </Text>
                      </View>
                    ))
                  )
                ) : (
                  <BarChart
                    data={qn.options.map((opt) => ({
                      label: String(opt.option),
                      value: opt.percent,
                      secondaryValue: opt.orgPercent,
                    }))}
                    max={100}
                    valueFormat={(v) => `${v}%`}
                    secondaryLabel="Org avg"
                  />
                )}
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
  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  surveyName: { ...type.h3 },
  totals: { ...type.caption, marginTop: 4 },
  qCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  qLabel: { ...type.bodyStrong, fontSize: 14, marginBottom: spacing.sm },
  muted: { ...type.caption, fontStyle: 'italic', color: colors.textMuted },
  verbatim: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  verbatimText: { ...type.body, fontStyle: 'italic' },
  verbatimMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
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
