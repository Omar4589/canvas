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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { signOut } from '../../../lib/authState';
import {
  loadCurrentUser,
  saveActiveOrgId,
  clearActiveCampaign,
  clearBootstrap,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  lit_dropped: 'Lit dropped',
};

const DOT_COLOR = {
  survey_submitted: colors.success,
  not_home: colors.brand,
  wrong_address: colors.danger,
  lit_dropped: '#7E22CE',
};

function formatRelative(d) {
  if (!d) return 'Never';
  const date = new Date(d);
  const ms = Date.now() - date.getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function StatTile({ value, label, sub }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function SuperAdminHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
  }, []);

  const overviewQ = useQuery({
    queryKey: ['super-admin', 'platform-overview'],
    queryFn: () => api('/super-admin/platform-overview'),
    refetchInterval: 30_000,
  });

  const feedQ = useQuery({
    queryKey: ['super-admin', 'activity-feed', 5],
    queryFn: () => api('/super-admin/activity-feed?limit=5'),
    refetchInterval: 30_000,
  });

  async function pickOrg(orgId) {
    qc.clear();
    await saveActiveOrgId(orgId);
    await clearActiveCampaign();
    await clearBootstrap();
    router.replace('/(app)/admin');
  }

  async function onLogout() {
    qc.clear();
    await signOut();
  }

  const totals = overviewQ.data?.totals;
  const orgs = overviewQ.data?.organizations || [];
  const events = feedQ.data?.events || [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Logo size={26} />
        <Pressable onPress={onLogout} hitSlop={8}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={styles.greeting}>Hi {user?.firstName || 'super'} 🌐</Text>
        <Text style={styles.subtitle}>
          Platform control room. Active-now = activity in the last 15 min.
        </Text>

        {/* Top stats */}
        <View style={styles.statsRow}>
          <StatTile
            value={totals?.orgs?.total?.toLocaleString()}
            label="Orgs"
            sub={`${totals?.orgs?.active ?? 0} active`}
          />
          <StatTile
            value={totals?.users?.total?.toLocaleString()}
            label="Users"
            sub={`${totals?.users?.superAdmins ?? 0} super`}
          />
          <StatTile
            value={totals?.activeNow?.count?.toLocaleString()}
            label="Active now"
            sub={totals?.activeNow?.threshold || '15m'}
          />
        </View>

        <View style={styles.todayCard}>
          <Text style={styles.todayLabel}>Today</Text>
          <View style={styles.todayRow}>
            <View style={styles.todayCell}>
              <Text style={styles.todayValue}>
                {totals?.today?.doorsKnocked?.toLocaleString() ?? '—'}
              </Text>
              <Text style={styles.todayCellLabel}>Doors</Text>
            </View>
            <View style={styles.todayCell}>
              <Text style={styles.todayValue}>
                {totals?.today?.surveysSubmitted?.toLocaleString() ?? '—'}
              </Text>
              <Text style={styles.todayCellLabel}>Surveys</Text>
            </View>
            <View style={styles.todayCell}>
              <Text style={styles.todayValue}>
                {totals?.today?.litDropped?.toLocaleString() ?? '—'}
              </Text>
              <Text style={styles.todayCellLabel}>Lit drops</Text>
            </View>
          </View>
        </View>

        {/* Quick links */}
        <View style={styles.quickLinkRow}>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push('/(app)/super-admin/organizations')}
          >
            <Text style={styles.quickLinkIcon}>🏢</Text>
            <Text style={styles.quickLinkText}>Organizations</Text>
          </Pressable>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push('/(app)/super-admin/users')}
          >
            <Text style={styles.quickLinkIcon}>👥</Text>
            <Text style={styles.quickLinkText}>All users</Text>
          </Pressable>
          <Pressable
            style={styles.quickLink}
            onPress={() => router.push('/(app)/super-admin/activity')}
          >
            <Text style={styles.quickLinkIcon}>📡</Text>
            <Text style={styles.quickLinkText}>Activity</Text>
          </Pressable>
        </View>

        {/* All organizations */}
        <Text style={styles.sectionLabel}>All organizations</Text>
        {overviewQ.isLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
        ) : orgs.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No orgs yet. Create one in Organizations.</Text>
          </View>
        ) : (
          orgs.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => pickOrg(o.id)}
              disabled={!o.isActive}
              style={({ pressed }) => [
                styles.orgCard,
                { opacity: pressed || !o.isActive ? 0.85 : 1 },
              ]}
            >
              <View style={styles.orgCardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orgName}>{o.name}</Text>
                  <Text style={styles.orgSlug}>{o.slug}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {!o.isActive && (
                    <View style={styles.pillNeutral}>
                      <Text style={styles.pillTextNeutral}>inactive</Text>
                    </View>
                  )}
                  {o.activeNowCount > 0 && (
                    <View style={[styles.pillSuccess, { marginTop: 4 }]}>
                      <Text style={styles.pillTextSuccess}>🟢 {o.activeNowCount} active</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.orgCardStats}>
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatValue}>{o.memberCount}</Text>
                  <Text style={styles.orgStatLabel}>Members</Text>
                </View>
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatValue}>{o.campaignCount}</Text>
                  <Text style={styles.orgStatLabel}>Campaigns</Text>
                </View>
                <View style={styles.orgStat}>
                  <Text style={styles.orgStatLast}>{formatRelative(o.lastActivityAt)}</Text>
                  <Text style={styles.orgStatLabel}>Last active</Text>
                </View>
              </View>
              <Text style={styles.orgCardCta}>Switch into this org →</Text>
            </Pressable>
          ))
        )}

        {/* Recent activity preview */}
        <View style={styles.activityHeader}>
          <Text style={styles.sectionLabel}>Recent activity</Text>
          <Pressable onPress={() => router.push('/(app)/super-admin/activity')}>
            <Text style={styles.seeAll}>See all →</Text>
          </Pressable>
        </View>
        {feedQ.isLoading ? (
          <ActivityIndicator color={colors.brand} />
        ) : events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No activity yet.</Text>
          </View>
        ) : (
          events.map((e) => (
            <View key={e.id} style={styles.activityRow}>
              <View
                style={[
                  styles.activityDot,
                  { backgroundColor: DOT_COLOR[e.actionType] || colors.textMuted },
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityAction}>
                  {ACTION_LABEL[e.actionType] || e.actionType}
                  {e.organization && (
                    <Text style={styles.activityOrg}>  · {e.organization.name}</Text>
                  )}
                </Text>
                <Text style={styles.activitySub} numberOfLines={1}>
                  {e.canvasser
                    ? `${e.canvasser.firstName} ${e.canvasser.lastName}`
                    : 'Unknown'}
                  {e.household?.addressLine1 ? ` · ${e.household.addressLine1}` : ''}
                </Text>
              </View>
              <Text style={styles.activityTime}>{formatRelative(e.timestamp)}</Text>
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signOut: { color: colors.brand, fontWeight: '600', fontSize: 14 },

  greeting: { ...type.title, marginTop: spacing.xs },
  subtitle: { ...type.caption, marginTop: spacing.xs, marginBottom: spacing.lg },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  statValue: { ...type.h2, fontSize: 20, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  statSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  todayCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  todayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  todayRow: { flexDirection: 'row' },
  todayCell: { flex: 1, alignItems: 'center' },
  todayValue: { ...type.h2, fontSize: 18, fontVariant: ['tabular-nums'] },
  todayCellLabel: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  quickLinkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  quickLink: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    ...shadow.card,
  },
  quickLinkIcon: { fontSize: 22, marginBottom: 2 },
  quickLinkText: { ...type.caption, fontWeight: '700', color: colors.textPrimary },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyText: { ...type.caption, textAlign: 'center' },

  orgCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  orgCardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  orgName: { ...type.h3, fontSize: 16 },
  orgSlug: { ...type.caption, fontSize: 11, marginTop: 1 },
  orgCardStats: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.md,
  },
  orgStat: { flex: 1 },
  orgStatValue: { ...type.h2, fontSize: 16, fontVariant: ['tabular-nums'] },
  orgStatLast: { ...type.bodyStrong, fontSize: 12 },
  orgStatLabel: { fontSize: 10, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  orgCardCta: { color: colors.brand, fontWeight: '700', fontSize: 12, marginTop: spacing.sm },

  pillNeutral: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillTextNeutral: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  pillSuccess: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  pillTextSuccess: { fontSize: 10, fontWeight: '700', color: colors.success, textTransform: 'uppercase' },

  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  seeAll: { color: colors.brand, fontWeight: '700', fontSize: 12 },

  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  activityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  activityAction: { ...type.bodyStrong, fontSize: 13 },
  activityOrg: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  activitySub: { ...type.caption, fontSize: 11, marginTop: 1 },
  activityTime: { fontSize: 11, color: colors.textMuted },
});
