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
import { rangeFor } from '../../../lib/dateRanges';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

function actionLabel(t) {
  if (t === 'survey_submitted') return 'Surveyed';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong addr';
  return t;
}

function actionColor(colors, t) {
  return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
}

export default function AdminOverlaps() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams();
  const [campaign, setCampaign] = useState(undefined);
  const [preset, setPreset] = useState(
    typeof params.preset === 'string' ? params.preset : 'today'
  );

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const cId = campaign?.id;
  // Anchor presets to the campaign's tz; the query is already gated on cId (campaign loaded),
  // so it never fetches a device-tz window.
  const range = useMemo(() => rangeFor(preset, null, campaign?.timeZone), [preset, campaign?.timeZone]);

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
        Houses knocked by 2+ canvassers within the same pass.
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
                    <Text style={styles.countBadgeText}>{o.totalCanvassers} canvassers</Text>
                  </View>
                </View>

                {o.passes.map((p) => (
                  <View key={p.passId || 'none'} style={styles.passBlock}>
                    <Text style={styles.passLabel}>{p.roundLabel}</Text>
                    <View style={styles.canvassers}>
                      {p.canvassers.map((c, i) => (
                        <View key={`${c.userId}-${i}`} style={styles.canvasserRow}>
                          <View
                            style={[
                              styles.actionDot,
                              { backgroundColor: actionColor(colors, c.actionType) },
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
                              {formatExact(c.timestamp, campaign?.timeZone)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
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

  passBlock: { marginTop: spacing.sm },
  passLabel: {
    ...type.caption,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
}
