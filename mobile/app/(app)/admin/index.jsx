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
import CoverageBar from '../../../components/CoverageBar';
import SectionHeader from '../../../components/SectionHeader';
import DateRangeBar from '../../../components/DateRangeBar';
import { rangeFor, deviceTimezone } from '../../../lib/dateRanges';
import { timeAgo } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

function fmt(n) {
  return n == null ? '—' : Number(n).toLocaleString();
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{fmt(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CampaignCard({ campaign, onPress }) {
  const c = campaign;
  const isLitDrop = c.type === 'lit_drop';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.campaignCard, pressed && { opacity: 0.85 }]}>
      <View style={styles.campaignHead}>
        <Text style={styles.campaignName} numberOfLines={1}>{c.name}</Text>
        <View style={[styles.typePill, isLitDrop ? styles.typePillLit : styles.typePillSurvey]}>
          <Text style={[styles.typePillText, isLitDrop ? styles.typePillTextLit : styles.typePillTextSurvey]}>
            {isLitDrop ? 'Lit drop' : 'Survey'}
          </Text>
        </View>
      </View>
      <CoverageBar canvass={c.coverage} compact />
      <View style={styles.inlineRow}>
        <Text style={styles.inlineStat}>
          <Text style={styles.inlineStatVal}>{fmt(c.doorDays)}</Text> doors
        </Text>
        <Text style={styles.inlineStat}>
          <Text style={styles.inlineStatVal}>{fmt(isLitDrop ? c.litDropped : c.surveysSubmitted)}</Text>{' '}
          {isLitDrop ? 'lit' : 'surveys'}
        </Text>
        <Text style={styles.inlineStat}>
          <Text style={styles.inlineStatVal}>{fmt(c.activeCanvassers)}</Text> canv
        </Text>
      </View>
      <Text style={styles.campaignFoot}>
        {c.lastActivityAt ? `Last activity ${timeAgo(c.lastActivityAt)}` : 'No activity in range'}
        {'   ›'}
      </Text>
    </Pressable>
  );
}

export default function AdminOverview() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [range, setRange] = useState(() => {
    const r = rangeFor('today');
    return { preset: 'today', from: r.from, to: r.to };
  });
  const tz = deviceTimezone();

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
  }, []);

  const activeQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'active', range.from, range.to],
    queryFn: () => {
      const p = new URLSearchParams({ scope: 'active', tz });
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
      return api(`/admin/reports/campaign-rollup?${p.toString()}`);
    },
  });
  // Archived is reviewed as historical data → always all-time.
  const archivedQ = useQuery({
    queryKey: ['admin', 'reports', 'campaign-rollup', 'archived'],
    queryFn: () => api(`/admin/reports/campaign-rollup?scope=archived&tz=${tz}`),
    enabled: archivedOpen,
  });

  const cumulative = activeQ.data?.cumulative || {};
  const campaigns = activeQ.data?.campaigns || [];
  const archived = archivedQ.data?.campaigns || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Text style={styles.headerLabel}>Admin{user?.isSuperAdmin ? ' · super' : ''}</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Text style={styles.greeting}>Hi {user?.firstName || 'there'} 👋</Text>
        </View>

        <DateRangeBar value={range} onChange={setRange} />

        {activeQ.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : activeQ.error ? (
          <View style={[styles.card, { marginHorizontal: spacing.lg }]}>
            <Text style={styles.errorText}>Couldn't load overview. Pull to retry.</Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg }}>
            <SectionHeader title="All active campaigns" />
            <View style={styles.card}>
              <CoverageBar canvass={cumulative.coverage} />
              <View style={styles.divider} />
              <View style={styles.statRow}>
                <Stat value={cumulative.doorDays} label="Doors" />
                <Stat value={cumulative.surveysSubmitted} label="Surveys" />
                <Stat value={cumulative.litDropped} label="Lit" />
                <Stat value={cumulative.activeCanvassers} label="Canvassers" />
              </View>
            </View>

            <SectionHeader title="Campaigns" />
            {campaigns.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.errorText}>No active campaigns yet.</Text>
              </View>
            ) : (
              campaigns.map((c) => (
                <CampaignCard key={c.id} campaign={c} onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)} />
              ))
            )}

            <Pressable style={styles.archivedToggle} onPress={() => setArchivedOpen((v) => !v)}>
              <Text style={styles.archivedChevron}>{archivedOpen ? '▾' : '▸'}</Text>
              <Text style={styles.archivedToggleText}>Archived campaigns</Text>
            </Pressable>
            {archivedOpen && (
              <View>
                {archivedQ.isLoading ? (
                  <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
                ) : archived.length === 0 ? (
                  <View style={styles.card}>
                    <Text style={styles.errorText}>No archived campaigns.</Text>
                  </View>
                ) : (
                  archived.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => router.push(`/(app)/admin/campaign/${c.id}`)}
                      style={({ pressed }) => [styles.archivedRow, pressed && { opacity: 0.85 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.archivedName} numberOfLines={1}>{c.name}</Text>
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
          </View>
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
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { ...type.caption, color: colors.textSecondary },
  greeting: { ...type.title, marginTop: spacing.xs, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  errorText: { ...type.caption },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  statRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { flex: 1 },
  statValue: { ...type.h2, fontSize: 19, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 1 },

  campaignCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  campaignHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  campaignName: { ...type.h3, fontSize: 15, flex: 1 },
  typePill: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  typePillSurvey: { backgroundColor: '#EFF6FF' },
  typePillLit: { backgroundColor: '#F5F3FF' },
  typePillText: { fontSize: 10, fontWeight: '700' },
  typePillTextSurvey: { color: '#1D4ED8' },
  typePillTextLit: { color: '#6D28D9' },
  inlineRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.md },
  inlineStat: { fontSize: 12, color: colors.textSecondary },
  inlineStatVal: { fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  campaignFoot: { ...type.caption, marginTop: spacing.sm, color: colors.textMuted },

  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  archivedChevron: { fontSize: 14, color: colors.textSecondary, width: 16 },
  archivedToggleText: { ...type.h3, fontSize: 15 },
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
});
