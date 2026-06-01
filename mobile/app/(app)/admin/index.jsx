import { useEffect, useState } from 'react';
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
import { loadCurrentUser } from '../../../lib/cache';
import Logo from '../../../components/Logo';
import KpiGrid from '../../../components/KpiGrid';
import SectionHeader from '../../../components/SectionHeader';
import { timeAgo } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function CampaignCard({ campaign, onPress }) {
  const c = campaign;
  const isLitDrop = c.type === 'lit_drop';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.campaignCard, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.campaignCardHead}>
        <Text style={styles.campaignName} numberOfLines={1}>
          {c.name}
        </Text>
        <View style={[styles.typePill, isLitDrop ? styles.typePillLit : styles.typePillSurvey]}>
          <Text style={[styles.typePillText, isLitDrop ? styles.typePillTextLit : styles.typePillTextSurvey]}>
            {isLitDrop ? 'Lit drop' : 'Survey'}
          </Text>
        </View>
      </View>
      <View style={styles.campaignStatsRow}>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatValue}>{fmt(c.households)}</Text>
          <Text style={styles.campaignStatLabel}>Households</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatValue}>{c.knockedPct ?? 0}%</Text>
          <Text style={styles.campaignStatLabel}>Knocked</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatValue}>{fmt(isLitDrop ? c.litDropped : c.surveysSubmitted)}</Text>
          <Text style={styles.campaignStatLabel}>{isLitDrop ? 'Lit drops' : 'Surveys'}</Text>
        </View>
        <View style={styles.campaignStat}>
          <Text style={styles.campaignStatValue}>{fmt(c.activeCanvassers)}</Text>
          <Text style={styles.campaignStatLabel}>Canvassers</Text>
        </View>
      </View>
      <Text style={styles.campaignFoot}>
        {c.lastActivityAt ? `Last activity ${timeAgo(c.lastActivityAt)}` : 'No activity yet'}
        {'   ›'}
      </Text>
    </Pressable>
  );
}

export default function AdminOverview() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
  }, []);

  const activeQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'active'],
    queryFn: () => api('/admin/reports/campaign-rollup?scope=active'),
  });
  const archivedQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'archived'],
    queryFn: () => api('/admin/reports/campaign-rollup?scope=archived'),
    enabled: archivedOpen,
  });

  const cumulative = activeQ.data?.cumulative || {};
  const campaigns = activeQ.data?.campaigns || [];
  const archived = archivedQ.data?.campaigns || [];

  const kpiTiles = [
    { label: 'Households', value: fmt(cumulative.households) },
    { label: 'Homes knocked', value: fmt(cumulative.homesKnocked), sub: `${cumulative.knockedPct ?? 0}% of households` },
    { label: 'Doors knocked', value: fmt(cumulative.doorDays) },
    { label: 'Surveys', value: fmt(cumulative.surveysSubmitted) },
    { label: 'Lit drops', value: fmt(cumulative.litDropped) },
    { label: 'Canvassers', value: fmt(cumulative.activeCanvassers) },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>Admin{user?.isSuperAdmin ? ' · super' : ''}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.greeting}>Hi {user?.firstName || 'there'} 👋</Text>
        <Text style={styles.subtitle}>Your active campaigns at a glance.</Text>

        {activeQ.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : activeQ.error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Couldn't load overview. Pull to retry.</Text>
          </View>
        ) : (
          <>
            <SectionHeader title="All active campaigns" />
            <KpiGrid tiles={kpiTiles} columns={2} />

            <SectionHeader title="Campaigns" />
            {campaigns.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No active campaigns yet.</Text>
              </View>
            ) : (
              campaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
                />
              ))
            )}

            {/* Archived (collapsible) */}
            <Pressable style={styles.archivedToggle} onPress={() => setArchivedOpen((v) => !v)}>
              <Text style={styles.archivedToggleChevron}>{archivedOpen ? '▾' : '▸'}</Text>
              <Text style={styles.archivedToggleText}>Archived campaigns</Text>
            </Pressable>
            {archivedOpen && (
              <View style={{ marginTop: spacing.sm }}>
                {archivedQ.isLoading ? (
                  <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
                ) : archived.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyText}>No archived campaigns.</Text>
                  </View>
                ) : (
                  archived.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
                      style={({ pressed }) => [styles.archivedRow, pressed && { opacity: 0.85 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.archivedName} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={styles.archivedMeta}>
                          {fmt(c.households)} households · {c.knockedPct ?? 0}% knocked · {fmt(c.doorDays)} doors
                        </Text>
                      </View>
                      <View style={styles.archivedBadge}>
                        <Text style={styles.archivedBadgeText}>Read-only</Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            )}
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { ...type.caption, color: colors.textSecondary },
  greeting: { ...type.title, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginTop: spacing.xs, marginBottom: spacing.sm },

  errorCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  errorText: { ...type.caption },

  campaignCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  campaignCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  campaignName: { ...type.h3, flex: 1 },
  typePill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  typePillSurvey: { backgroundColor: '#EFF6FF' },
  typePillLit: { backgroundColor: '#F5F3FF' },
  typePillText: { fontSize: 11, fontWeight: '700' },
  typePillTextSurvey: { color: '#1D4ED8' },
  typePillTextLit: { color: '#6D28D9' },

  campaignStatsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  campaignStat: { flex: 1 },
  campaignStatValue: { ...type.h3, fontSize: 16, fontVariant: ['tabular-nums'] },
  campaignStatLabel: { fontSize: 10, color: colors.textSecondary, fontWeight: '600', marginTop: 1 },
  campaignFoot: { ...type.caption, marginTop: spacing.md, color: colors.textMuted },

  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  archivedToggleChevron: { fontSize: 14, color: colors.textSecondary, width: 16 },
  archivedToggleText: { ...type.h3 },

  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  archivedName: { ...type.bodyStrong, fontSize: 14 },
  archivedMeta: { ...type.caption, marginTop: 2 },
  archivedBadge: { backgroundColor: '#FEF3C7', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  archivedBadgeText: { fontSize: 10, fontWeight: '700', color: '#92400E' },

  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  emptyText: { ...type.caption },
});
