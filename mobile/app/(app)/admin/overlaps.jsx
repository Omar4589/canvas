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
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

function rangeFor(preset) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (preset === 'today') return { from: start.toISOString(), to: null };
  if (preset === 'yesterday') {
    const yStart = new Date(start);
    yStart.setDate(yStart.getDate() - 1);
    return { from: yStart.toISOString(), to: start.toISOString() };
  }
  if (preset === '7d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 6);
    return { from: s.toISOString(), to: null };
  }
  if (preset === '30d') {
    const s = new Date(start);
    s.setDate(s.getDate() - 29);
    return { from: s.toISOString(), to: null };
  }
  return { from: null, to: null };
}

function actionLabel(t) {
  if (t === 'survey_submitted') return 'Surveyed';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong addr';
  return t;
}

function actionColor(t) {
  return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
}

export default function AdminOverlaps() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [campaign, setCampaign] = useState(undefined);
  const [preset, setPreset] = useState(
    typeof params.preset === 'string' ? params.preset : 'today'
  );

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const range = useMemo(() => rangeFor(preset), [preset]);
  const cId = campaign?.id;

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

  const overlaps = overlapsQ.data?.overlaps || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Overlaps</Text>
        <View style={{ width: 80 }} />
      </View>

      <Text style={styles.intro}>
        Houses recorded by 2+ canvassers in this range.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetRow}
      >
        {PRESETS.map((p) => {
          const active = p.key === preset;
          return (
            <Pressable
              key={p.key}
              onPress={() => setPreset(p.key)}
              style={[styles.presetPill, active && styles.presetPillActive]}
            >
              <Text
                style={[styles.presetPillText, active && styles.presetPillTextActive]}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
      >
        {overlapsQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : overlaps.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No overlap 🎉</Text>
            <Text style={styles.emptyText}>
              Every house in this range was visited by at most one canvasser.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.summaryValue}>{overlaps.length}</Text>
              <Text style={styles.summaryLabel}>
                {overlaps.length === 1 ? 'house' : 'houses'} with overlap
              </Text>
            </View>

            {overlaps.map((o) => (
              <View key={o.household.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.address}>
                      {o.household.addressLine1}
                      {o.household.addressLine2 ? `, ${o.household.addressLine2}` : ''}
                    </Text>
                    <Text style={styles.addressSub}>
                      {o.household.city}, {o.household.state} {o.household.zipCode}
                    </Text>
                  </View>
                  <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{o.count}×</Text>
                  </View>
                </View>

                <View style={styles.canvassers}>
                  {o.canvassers.map((c, i) => (
                    <View key={`${c.userId}-${i}`} style={styles.canvasserRow}>
                      <View
                        style={[
                          styles.actionDot,
                          { backgroundColor: actionColor(c.actionType) },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <View style={styles.canvasserTopLine}>
                          <Text style={styles.canvasserName} numberOfLines={1}>
                            {c.firstName} {c.lastName}
                          </Text>
                          <Text style={styles.canvasserAction}>
                            {actionLabel(c.actionType)}
                          </Text>
                          <Text style={styles.canvasserTimeAgo}>
                            {timeAgo(c.timestamp)}
                          </Text>
                        </View>
                        <Text style={styles.canvasserTimestamp}>
                          {formatExact(c.timestamp)}
                        </Text>
                      </View>
                    </View>
                  ))}
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
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '700', fontSize: 16, width: 80 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },

  intro: {
    ...type.caption,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },

  presetRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  presetPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  presetPillText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  presetPillTextActive: { color: colors.textInverse },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.successBorder,
    alignItems: 'center',
  },
  emptyTitle: { ...type.h3, marginBottom: spacing.xs },
  emptyText: { ...type.caption, textAlign: 'center' },

  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  summaryValue: { ...type.title, color: colors.brand },
  summaryLabel: { ...type.caption },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  address: { ...type.bodyStrong, fontSize: 14 },
  addressSub: { ...type.caption, marginTop: 2 },
  countBadge: {
    backgroundColor: colors.brandTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  countBadgeText: {
    color: colors.brand,
    fontWeight: '800',
    fontSize: 12,
  },

  canvassers: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  canvasserRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  canvasserTopLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  canvasserName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  canvasserAction: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  canvasserTimeAgo: {
    fontSize: 11,
    color: colors.textMuted,
  },
  canvasserTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
});
