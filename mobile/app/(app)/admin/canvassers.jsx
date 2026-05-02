import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all', label: 'All time' },
];

function rangeFor(preset) {
  const now = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (preset === 'today') {
    return { from: start.toISOString(), to: null };
  }
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

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function AdminCanvassers() {
  const router = useRouter();
  const [campaign, setCampaign] = useState(undefined);
  const [preset, setPreset] = useState('today');

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const range = useMemo(() => rangeFor(preset), [preset]);

  const cId = campaign?.id;

  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, range.from, range.to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (cId) params.set('campaignId', cId);
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      return api(`/admin/reports/canvassers?${params.toString()}`);
    },
    enabled: !!cId,
  });

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

  const isLitDrop = campaign?.type === 'lit_drop';
  const rows = canvassersQ.data || [];

  const totals = rows.reduce(
    (acc, r) => {
      acc.houses += r.homesKnocked || 0;
      acc.surveys += r.surveysSubmitted || 0;
      acc.litDrops += r.litDropped || 0;
      acc.notHome += r.notHome || 0;
      acc.wrongAddr += r.wrongAddress || 0;
      return acc;
    },
    { houses: 0, surveys: 0, litDrops: 0, notHome: 0, wrongAddr: 0 }
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Canvassers</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Date preset pills */}
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
        {/* Overlap banner — visible only when there's overlap in this range */}
        {overlapsQ.data?.total > 0 && (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(app)/admin/overlaps',
                params: { preset },
              })
            }
            style={({ pressed }) => [
              styles.overlapBanner,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={styles.overlapBannerIcon}>⚠️</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.overlapBannerTitle}>
                {overlapsQ.data.total}{' '}
                {overlapsQ.data.total === 1 ? 'house' : 'houses'} hit by 2+ canvassers
              </Text>
              <Text style={styles.overlapBannerSub}>
                Tap to review overlap
              </Text>
            </View>
            <Text style={styles.overlapBannerChevron}>›</Text>
          </Pressable>
        )}

        {/* Totals card */}
        <View style={styles.totalsCard}>
          <Text style={styles.totalsTitle}>
            Totals · {PRESETS.find((p) => p.key === preset)?.label}
          </Text>
          <View style={styles.totalsRow}>
            <View style={styles.totalsCol}>
              <Text style={styles.totalsValue}>{totals.houses.toLocaleString()}</Text>
              <Text style={styles.totalsLabel}>Houses</Text>
            </View>
            <View style={styles.totalsDivider} />
            {isLitDrop ? (
              <View style={styles.totalsCol}>
                <Text style={styles.totalsValue}>{totals.litDrops.toLocaleString()}</Text>
                <Text style={styles.totalsLabel}>Lit drops</Text>
              </View>
            ) : (
              <View style={styles.totalsCol}>
                <Text style={styles.totalsValue}>{totals.surveys.toLocaleString()}</Text>
                <Text style={styles.totalsLabel}>Surveys</Text>
              </View>
            )}
            <View style={styles.totalsDivider} />
            <View style={styles.totalsCol}>
              <Text style={styles.totalsValue}>{rows.length}</Text>
              <Text style={styles.totalsLabel}>Canvassers</Text>
            </View>
          </View>
        </View>

        {/* List */}
        {canvassersQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity in this range yet.</Text>
          </View>
        ) : (
          rows.map((r, i) => {
            const name = `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email;
            const primary = isLitDrop ? r.litDropped || 0 : r.surveysSubmitted || 0;
            const primaryLabel = isLitDrop ? 'lit drops' : 'surveys';
            return (
              <View key={r.userId} style={styles.row}>
                <Text style={styles.rank}>{i + 1}</Text>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(name) || '?'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {name}
                    {!r.isActive && <Text style={styles.inactive}> · inactive</Text>}
                  </Text>
                  <Text style={styles.meta}>{r.email}</Text>
                  <View style={styles.statsLine}>
                    <Text style={styles.statBold}>{r.homesKnocked || 0}</Text>
                    <Text style={styles.stat}> houses · </Text>
                    <Text style={styles.statBold}>{primary}</Text>
                    <Text style={styles.stat}> {primaryLabel}</Text>
                    {!isLitDrop && (r.notHome || r.wrongAddress) ? (
                      <Text style={styles.stat}>
                        {' · '}
                        {r.notHome || 0} not home, {r.wrongAddress || 0} wrong addr
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>
            );
          })
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

  totalsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  totalsTitle: { ...type.micro, marginBottom: spacing.sm },
  totalsRow: { flexDirection: 'row', alignItems: 'center' },
  totalsCol: { flex: 1, alignItems: 'center' },
  totalsValue: { ...type.h2, fontSize: 22 },
  totalsLabel: { ...type.caption, marginTop: 2 },
  totalsDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.sm,
  },
  rank: {
    width: 22,
    fontSize: 13,
    fontWeight: '800',
    color: colors.brand,
    textAlign: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 14 },
  name: { ...type.bodyStrong, fontSize: 14 },
  inactive: { ...type.caption, color: colors.textMuted, fontWeight: '400' },
  meta: { ...type.caption, marginTop: 1 },
  statsLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs,
  },
  stat: { fontSize: 12, color: colors.textSecondary },
  statBold: { fontSize: 12, color: colors.textPrimary, fontWeight: '700' },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, textAlign: 'center' },

  overlapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warnBg,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: '#FBBF24',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  overlapBannerIcon: { fontSize: 18 },
  overlapBannerTitle: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 14,
  },
  overlapBannerSub: {
    color: '#92400E',
    fontSize: 12,
    marginTop: 1,
  },
  overlapBannerChevron: {
    color: '#92400E',
    fontWeight: '700',
    fontSize: 22,
  },
});
