import { useMemo } from 'react';
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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../lib/api';
import { saveActiveCampaign, clearBootstrap } from '../../../../lib/cache';
import PinIcon from '../../../../components/PinIcon';
import { formatRange } from '../../../../lib/datetime';
import { getConnectionRate, RATE_COLORS } from '../../../../lib/rates';
import { colors, radius, spacing, type, shadow } from '../../../../lib/theme';

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function StatTile({ pinStatus, value, label }) {
  return (
    <View style={styles.statTile}>
      <PinIcon status={pinStatus} size={26} />
      <View style={{ marginLeft: spacing.sm }}>
        <Text style={styles.statValue}>{value ?? '—'}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function TodayTile({ value, label, level }) {
  const palette = level ? RATE_COLORS[level] : null;
  return (
    <View style={[styles.todayTile, palette && { backgroundColor: palette.bg, borderColor: palette.bg }]}>
      <Text style={[styles.todayTileValue, palette && { color: palette.fg }]}>{value ?? '—'}</Text>
      <Text style={[styles.todayTileLabel, palette && { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export default function CampaignDetail() {
  const router = useRouter();
  const qc = useQueryClient();
  const { campaignId } = useLocalSearchParams();
  const cId = Array.isArray(campaignId) ? campaignId[0] : campaignId;

  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
  });
  const campaign = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(cId)) || null;
  const isLitDrop = campaign?.type === 'lit_drop';
  const isArchived = campaign && campaign.isActive === false;

  const overviewQ = useQuery({
    queryKey: ['admin', 'reports', 'overview', cId],
    queryFn: () => api(`/admin/reports/overview?campaignId=${cId}`),
    enabled: !!cId,
  });

  const canvassersQ = useQuery({
    queryKey: ['admin', 'reports', 'canvassers', cId, 'today'],
    queryFn: () =>
      api(`/admin/reports/canvassers?campaignId=${cId}&from=${encodeURIComponent(startOfTodayISO())}`),
    enabled: !!cId,
  });

  const totals = overviewQ.data?.totals || {};
  const events = overviewQ.data?.events || {};
  const topCanvassers = (canvassersQ.data || []).slice(0, 5);

  const todayTotals = useMemo(() => {
    const rows = canvassersQ.data || [];
    let doors = 0;
    let surveys = 0;
    let lit = 0;
    for (const r of rows) {
      doors += r.homesKnocked || 0;
      surveys += r.surveysSubmitted || 0;
      lit += r.litDropped || 0;
    }
    return { doors, surveys, lit };
  }, [canvassersQ.data]);

  const todayRate = isLitDrop
    ? getConnectionRate(todayTotals.lit, todayTotals.doors)
    : getConnectionRate(todayTotals.surveys, todayTotals.doors);
  const overallRate = isLitDrop
    ? getConnectionRate(events.litDropped || 0, totals.homesKnocked || 0)
    : getConnectionRate(totals.surveysSubmitted || 0, totals.homesKnocked || 0);

  async function goCanvass() {
    if (!campaign) return;
    await saveActiveCampaign({
      id: String(campaign._id),
      name: campaign.name,
      type: campaign.type,
      state: campaign.state,
    });
    await clearBootstrap();
    qc.removeQueries({ queryKey: ['bootstrap'] });
    router.push('/(app)/map');
  }

  if (campaignsQ.data && !campaign) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.back}>‹ Overview</Text>
          </Pressable>
        </View>
        <View style={styles.centered}>
          <Text style={type.body}>Campaign not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Overview</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {campaign?.name || 'Campaign'}
        </Text>
        <View style={{ width: 64 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        {isArchived && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              This campaign is archived — data is read-only. Reactivate it from the web to resume canvassing.
            </Text>
          </View>
        )}

        {/* Today */}
        <View style={styles.statsCard}>
          <Text style={styles.cardTitle}>Today</Text>
          {canvassersQ.isLoading || overviewQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.todayRow}>
              <TodayTile value={todayTotals.doors.toLocaleString()} label="Doors knocked" />
              <TodayTile
                value={todayRate?.value}
                label={isLitDrop ? 'Lit drop rate' : 'Survey rate'}
                level={todayRate?.level}
              />
              <TodayTile
                value={overallRate?.value}
                label={isLitDrop ? 'Overall lit rate' : 'Overall connection'}
                level={overallRate?.level}
              />
            </View>
          )}
        </View>

        {/* Campaign overview */}
        <View style={styles.statsCard}>
          <Text style={styles.cardTitle}>Campaign overview</Text>
          {overviewQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.statsRow}>
              <StatTile pinStatus="unknocked" value={totals.households?.toLocaleString()} label="Households" />
              <StatTile pinStatus="not_home" value={totals.homesKnocked?.toLocaleString()} label="Knocked" />
              <StatTile
                pinStatus={isLitDrop ? 'lit_dropped' : 'surveyed'}
                value={isLitDrop ? events.litDropped?.toLocaleString() : totals.surveysSubmitted?.toLocaleString()}
                label={isLitDrop ? 'Lit drops' : 'Surveys'}
              />
            </View>
          )}
        </View>

        {/* Top canvassers */}
        <Pressable
          onPress={() => router.push('/(app)/admin/canvassers')}
          style={({ pressed }) => [styles.statsCard, pressed && { opacity: 0.85 }]}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Top canvassers today</Text>
            <Text style={styles.cardLink}>See all ›</Text>
          </View>
          {canvassersQ.isLoading ? (
            <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.md }} />
          ) : topCanvassers.length === 0 ? (
            <Text style={styles.emptyText}>No activity yet today.</Text>
          ) : (
            topCanvassers.map((c, i) => {
              const primary = isLitDrop ? c.litDropped || 0 : c.surveysSubmitted || 0;
              const primaryLabel = isLitDrop ? 'lit drops' : 'surveys';
              const knocked = c.homesKnocked || 0;
              const range = formatRange(c.firstActivityAt, c.lastActivityAt);
              return (
                <View key={c.userId} style={styles.canvasserRow}>
                  <Text style={styles.canvasserRank}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.canvasserName}>
                      {c.firstName || c.email} {c.lastName || ''}
                    </Text>
                    <Text style={styles.canvasserMeta}>
                      {knocked} houses · {primary} {primaryLabel}
                    </Text>
                    {range ? <Text style={styles.canvasserShift}>🕘 {range}</Text> : null}
                  </View>
                </View>
              );
            })
          )}
        </Pressable>

        {/* Quick links */}
        <View style={styles.quickLinkRow}>
          <Pressable style={styles.quickLink} onPress={() => router.push('/(app)/admin/map')}>
            <Text style={styles.quickLinkIcon}>🗺️</Text>
            <Text style={styles.quickLinkText}>Live map</Text>
          </Pressable>
          <Pressable style={styles.quickLink} onPress={() => router.push('/(app)/admin/users')}>
            <Text style={styles.quickLinkIcon}>👥</Text>
            <Text style={styles.quickLinkText}>Users</Text>
          </Pressable>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push(`/(app)/admin/campaign-assignments/${cId}`)}
          >
            <Text style={styles.quickLinkIcon}>🔗</Text>
            <Text style={styles.quickLinkText}>Assignments</Text>
          </Pressable>
        </View>

        {/* Switch to canvass mode — active campaigns only */}
        {!isArchived && (
          <Pressable
            onPress={goCanvass}
            style={({ pressed }) => [styles.canvassButton, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={styles.canvassButtonText}>Switch to canvass mode</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { color: colors.brand, fontWeight: '600', fontSize: 14, width: 64 },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  banner: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FCD34D',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerText: { fontSize: 13, color: '#92400E', fontWeight: '600' },

  statsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.md,
  },
  cardTitle: { ...type.h3, marginBottom: spacing.md },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardLink: { color: colors.brand, fontWeight: '700', fontSize: 13 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statTile: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  statValue: { ...type.h2, fontSize: 20, lineHeight: 22 },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },

  todayRow: { flexDirection: 'row', gap: spacing.sm },
  todayTile: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  todayTileValue: { ...type.h2, fontSize: 20, fontVariant: ['tabular-nums'], color: colors.textPrimary },
  todayTileLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 2, textAlign: 'center' },

  emptyText: { ...type.caption, paddingVertical: spacing.md },

  canvasserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  canvasserRank: { width: 24, fontSize: 14, fontWeight: '800', color: colors.brand },
  canvasserName: { ...type.bodyStrong, fontSize: 14 },
  canvasserMeta: { ...type.caption, marginTop: 1 },
  canvasserShift: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },

  quickLinkRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  quickLink: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.card,
  },
  quickLinkIcon: { fontSize: 28, marginBottom: spacing.xs },
  quickLinkText: { ...type.bodyStrong },

  canvassButton: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md + 2, alignItems: 'center' },
  canvassButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 16 },
});
