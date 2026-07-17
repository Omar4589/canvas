import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import { signOut } from '../../../lib/authState';
import {
  loadCurrentUser,
  saveActiveOrgId,
  clearActiveCampaign,
  clearBootstrap,
} from '../../../lib/cache';
import Logo from '../../../components/Logo';
import LiveStatus from '../../../components/LiveStatus';
import NavTileGrid from '../../../components/NavTileGrid';
import InfoHint from '../../../components/InfoHint';
import {
  PLATFORM_TOTALS,
  OVERVIEW_HELP,
  TOTALS_INTRO,
  IDLE_ORGS_HELP,
  IDLE_ORGS_MOBILE_NOTE,
} from '../../../lib/platformStatsMeta';
import { ThemeIconButton } from '../../../components/ThemeToggle';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const ACTION_LABEL = {
  survey_submitted: 'Surveyed',
  not_home: 'Not home',
  wrong_address: 'Wrong address',
  refused: 'Refused',
  restricted: 'Restricted',
  lit_dropped: 'Lit dropped',
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

function StatTile({ value, label, sub, help }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.statTile}>
      <Text style={styles.statValue}>{value ?? '—'}</Text>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {help ? <InfoHint title={label} body={help} /> : null}
      </View>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function SuperAdminHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const DOT_COLOR = {
    survey_submitted: colors.success,
    not_home: colors.brand,
    wrong_address: colors.danger,
    refused: colors.status.refused,
    restricted: colors.status.restricted,
    lit_dropped: colors.accentPurple,
  };
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadCurrentUser().then((u) => setUser(u));
  }, []);

  const [live, setLive] = useState(true);

  // This stack base stays mounted under pushed child screens — pause both
  // polls (and refresh on return) whenever the screen is covered.
  const overviewQ = useQuery({
    queryKey: ['super-admin', 'platform-overview'],
    queryFn: () => api('/super-admin/platform-overview'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });

  const feedQ = useQuery({
    queryKey: ['super-admin', 'activity-feed', 5],
    queryFn: () => api('/super-admin/activity-feed?limit=5'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });

  // Lifetime totals (live + banked-from-deleted) — one singleton doc, cheap to poll.
  const statsQ = useQuery({
    queryKey: ['super-admin', 'platform-stats'],
    queryFn: () => api('/super-admin/access/platform-stats'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });
  // Idle-orgs walks every active org server-side — fine at platform scale, and the
  // focused-poll pause keeps a covered screen from paying for it.
  const idleQ = useQuery({
    queryKey: ['super-admin', 'idle-orgs'],
    queryFn: () => api('/super-admin/access/idle-orgs'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });
  // The support glance: who is inside a customer's data right now, and is retention healthy —
  // the off-hours phone check. Ending a session is the one action worth having here.
  const grantsQ = useQuery({
    queryKey: ['support-grants'],
    queryFn: () => api('/super-admin/access/grants?all=1'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });
  const healthQ = useQuery({
    queryKey: ['retention-health'],
    queryFn: () => api('/super-admin/access/health/retention'),
    refetchInterval: live ? 30_000 : false,
    ...useFocusedPoll(),
  });

  const revokeMut = useMutation({
    mutationFn: (id) => api(`/super-admin/access/grants/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support-grants'] }),
  });

  function confirmEnd(g) {
    Alert.alert(
      'End this session?',
      `${g.actor || 'This session'} loses access to ${g.organization?.name || 'the organization'} immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End now', style: 'destructive', onPress: () => revokeMut.mutate(g.id) },
      ]
    );
  }

  const { refreshing, onRefresh } = useRefresh([
    overviewQ.refetch, feedQ.refetch, statsQ.refetch, idleQ.refetch, grantsQ.refetch, healthQ.refetch,
  ]);
  // One pill for all polls: freshest of them, fetching if any is, refresh all.
  const liveUpdatedAt =
    Math.max(
      overviewQ.dataUpdatedAt || 0,
      feedQ.dataUpdatedAt || 0,
      statsQ.dataUpdatedAt || 0,
      idleQ.dataUpdatedAt || 0,
      grantsQ.dataUpdatedAt || 0,
      healthQ.dataUpdatedAt || 0
    ) || undefined;

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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <ThemeIconButton />
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.liveRow}>
        <LiveStatus
          live={live}
          onToggle={() => setLive((v) => !v)}
          isFetching={
            overviewQ.isFetching || feedQ.isFetching || statsQ.isFetching || idleQ.isFetching
            || grantsQ.isFetching || healthQ.isFetching
          }
          updatedAt={liveUpdatedAt}
          onRefresh={() => {
            overviewQ.refetch();
            feedQ.refetch();
            statsQ.refetch();
            idleQ.refetch();
            grantsQ.refetch();
            healthQ.refetch();
          }}
        />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
      >
        <Text style={styles.greeting}>Hi {user?.firstName || 'super'} 🌐</Text>
        <Text style={styles.subtitle}>
          Platform control room. Active-now = activity in the last 15 min.
        </Text>

        {/* Top stats — 2×2 so Campaigns fits without squeezing (statTile is flex:1). */}
        <View style={styles.statsRowWrap}>
          <View style={styles.halfTile}>
            <StatTile
              value={totals?.orgs?.total?.toLocaleString()}
              label="Orgs"
              sub={`${totals?.orgs?.active ?? 0} active`}
              help={OVERVIEW_HELP.orgs}
            />
          </View>
          <View style={styles.halfTile}>
            <StatTile
              value={totals?.users?.total?.toLocaleString()}
              label="Users"
              sub={`${totals?.users?.superAdmins ?? 0} super`}
              help={OVERVIEW_HELP.users}
            />
          </View>
          <View style={styles.halfTile}>
            <StatTile
              value={totals?.campaigns?.total?.toLocaleString()}
              label="Campaigns"
              sub={`${totals?.campaigns?.active ?? 0} active`}
              help={OVERVIEW_HELP.campaigns}
            />
          </View>
          <View style={styles.halfTile}>
            <StatTile
              value={totals?.activeNow?.count?.toLocaleString()}
              label="Active now"
              sub={totals?.activeNow?.threshold || '15m'}
              help={OVERVIEW_HELP.activeNow}
            />
          </View>
        </View>

        <View style={styles.todayCard}>
          <View style={styles.statLabelRow}>
            <Text style={styles.todayLabel}>Today</Text>
            <InfoHint title="Today" body={OVERVIEW_HELP.today} />
          </View>
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
            {/* A separate tally on purpose — restricted marks are never knocks. */}
            <View style={styles.todayCell}>
              <Text style={styles.todayValue}>
                {totals?.today?.restricted?.toLocaleString() ?? '—'}
              </Text>
              <Text style={styles.todayCellLabel}>Restricted</Text>
            </View>
          </View>
        </View>

        {/* Billing needs attention — the same trigger set as the web strip (past due, suspended,
            trial inside its last 2 days). The data was already in platform-overview; actions stay
            on the web console. */}
        {orgs.some(
          (o) =>
            ['past_due', 'suspended'].includes(o.billing?.effective) ||
            (o.billing?.effective === 'trial' && o.billing?.trialDaysLeft != null && o.billing.trialDaysLeft <= 2)
        ) && (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>Billing needs attention</Text>
            {orgs
              .filter(
                (o) =>
                  ['past_due', 'suspended'].includes(o.billing?.effective) ||
                  (o.billing?.effective === 'trial' && o.billing?.trialDaysLeft != null && o.billing.trialDaysLeft <= 2)
              )
              .map((o) => (
                <Text key={o.id} style={styles.warnText}>
                  {o.name} —{' '}
                  {o.billing.effective === 'trial'
                    ? `trial ends in ${o.billing.trialDaysLeft}d`
                    : o.billing.effective.replace('_', ' ')}
                </Text>
              ))}
            <Text style={styles.warnCaption}>Manage from the web console → Organizations.</Text>
          </View>
        )}

        {/* Idle organizations — the needs-a-human queue no sweep can ever resolve. */}
        <View style={styles.statLabelRow}>
          <Text style={styles.sectionLabel}>Idle organizations</Text>
          <InfoHint title="Idle organizations" body={`${IDLE_ORGS_HELP}\n\n${IDLE_ORGS_MOBILE_NOTE}`} />
        </View>
        {(idleQ.data?.orgs || []).length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No idle organizations — nothing to review.</Text>
          </View>
        ) : (
          <>
            {idleQ.data.orgs.map((o) => (
              <View key={o.organizationId} style={styles.idleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.idleName}>{o.name}</Text>
                  <Text style={styles.idleMeta}>
                    {o.status} · {o.monthsIdle} mo idle
                  </Text>
                </View>
                <Text style={styles.idleMeta}>{formatRelative(o.lastActivityAt)}</Text>
              </View>
            ))}
            <Text style={styles.caption}>{IDLE_ORGS_MOBILE_NOTE}</Text>
          </>
        )}

        {/* Support access glance — is anyone inside a customer's data, is retention healthy.
            End-now is the one action worth having on the phone; everything else is web. */}
        <Text style={styles.sectionLabel}>
          {grantsQ.data?.scope === 'all' ? 'Support access' : 'Support access (your sessions)'}
        </Text>
        {healthQ.data && (
          <View style={[styles.healthChip, healthQ.data.healthy ? styles.healthOk : styles.healthBad]}>
            <Text style={healthQ.data.healthy ? styles.healthOkText : styles.healthBadText}>
              {healthQ.data.healthy ? '● Retention enforced' : '▲ Retention NOT ENFORCED'}
            </Text>
            {!healthQ.data.healthy && <Text style={styles.healthBadText}>{healthQ.data.message}</Text>}
          </View>
        )}
        {(grantsQ.data?.grants || []).length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {grantsQ.data?.scope === 'all'
                ? 'Nobody is inside a customer organization right now.'
                : 'You are not inside any customer organization right now.'}
            </Text>
          </View>
        ) : (
          grantsQ.data.grants.map((g) => (
            <View key={g.id} style={styles.idleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.idleName}>
                  {g.actor} → {g.organization?.name}
                </Text>
                <Text style={styles.idleMeta} numberOfLines={1}>{g.reason}</Text>
                <Text style={styles.idleMeta}>
                  expires {new Date(g.expiresAt).toLocaleString()} · {g.read?.requests ?? g.accessCount} request
                  {(g.read?.requests ?? g.accessCount) === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable
                onPress={() => confirmEnd(g)}
                disabled={revokeMut.isPending}
                hitSlop={8}
                style={styles.endBtn}
              >
                <Text style={styles.endBtnText}>End now</Text>
              </Pressable>
            </View>
          ))
        )}

        {/* Quick actions */}
        <View style={styles.quickActions}>
          <NavTileGrid
            items={[
              { label: 'Organizations', subtitle: 'All orgs', onPress: () => router.push('/(app)/super-admin/organizations') },
              { label: 'All users', subtitle: 'Platform users', onPress: () => router.push('/(app)/super-admin/users') },
              { label: 'Activity', subtitle: 'System activity', onPress: () => router.push('/(app)/super-admin/activity') },
            ]}
          />
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

        {/* Platform totals — lifetime numbers, every tile explains itself (shared ⓘ copy). */}
        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Platform totals</Text>
        <Text style={styles.caption}>{TOTALS_INTRO}</Text>
        <View style={styles.statsRowWrap}>
          {PLATFORM_TOTALS.map(({ key, label, help }) => (
            <View key={key} style={styles.totalsTile}>
              <StatTile
                value={(statsQ.data?.total?.[key] ?? 0).toLocaleString()}
                label={label}
                help={help}
              />
            </View>
          ))}
        </View>
        <Text style={styles.caption}>
          Recomputed nightly · last reconciled{' '}
          {statsQ.data?.backfilledAt ? new Date(statsQ.data.backfilledAt).toLocaleString() : 'never'}
        </Text>

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
                  {/* City/state only — street addresses left this feed on purpose (server route). */}
                  {e.household?.city ? ` · ${e.household.city}${e.household.state ? `, ${e.household.state}` : ''}` : ''}
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

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
  liveRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },

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
  statLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Platform totals: 5 tiles wrapping into a 3+2 grid (statTile is flex:1, so each needs
  // a fixed-basis wrapper or the row refuses to wrap).
  statsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  totalsTile: { width: '31%', flexGrow: 1 },
  halfTile: { width: '48%', flexGrow: 1 },
  caption: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.md },

  warnCard: {
    backgroundColor: colors.warnBg,
    borderColor: colors.warnBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  warnTitle: { fontSize: 12, fontWeight: '700', color: colors.warnFg, marginBottom: 2 },
  warnText: { fontSize: 12, color: colors.warnFg },
  warnCaption: { fontSize: 10, color: colors.textMuted, marginTop: spacing.xs },

  healthChip: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  healthOk: { backgroundColor: colors.successBg, borderColor: colors.successBorder },
  healthBad: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
  healthOkText: { fontSize: 12, fontWeight: '700', color: colors.success },
  healthBadText: { fontSize: 12, fontWeight: '700', color: colors.danger },

  endBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  endBtnText: { fontSize: 11, fontWeight: '700', color: colors.danger },
  idleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
  },
  idleName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  idleMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },

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

  quickActions: { marginBottom: spacing.lg },

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
}
