import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useAdminCampaign } from '../../../../../lib/useAdminCampaign';
import { rangeFor, deviceTimezone, labelForRange } from '../../../../../lib/dateRanges';
import { formatRange, timeAgo } from '../../../../../lib/datetime';
import { formatDistance } from '../../../../../lib/geo';
import { rateFromPct, makeRateColors } from '../../../../../lib/rates';
import { radius, spacing } from '../../../../../lib/theme';
import { useTheme } from '../../../../../lib/ThemeContext';
import { useThemedStyles } from '../../../../../lib/useThemedStyles';
import DateRangeBar from '../../../../../components/DateRangeBar';
import BarChart from '../../../../../components/BarChart';
import SectionHeader from '../../../../../components/SectionHeader';
import InsetGroup, {
  InsetHeroRow,
  InsetRow,
  InsetNavRow,
  InsetActionRow,
} from '../../../../../components/InsetGroup';
import { downloadCsv } from '../../../../../lib/csv';

const HOUR_LABELS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function initials(name) {
  return (name || '')
    .split(' ')
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function delta(value, baseline, unit = '') {
  if (baseline == null || value == null) return null;
  const diff = value - baseline;
  return { value: Math.round(diff * 100) / 100, unit };
}

export default function CanvasserOverview() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams();
  const userId = params.id;
  // Walk-list scope threaded from a filtered Timeline — every query and onward push
  // carries it, so the whole drill-in stays inside the same walk list.
  const effortId = params.effortId || null;

  // Threaded campaignId wins; the validated cache is the fallback — never the raw
  // cache, which can hold a campaign a team lead doesn't manage (or be empty, which
  // left every query disabled and the screen blank).
  const campaign = useAdminCampaign(params.campaignId);

  const tz = campaign?.timeZone || deviceTimezone();

  const [range, setRange] = useState(() => {
    if (params.from || params.to) {
      return {
        preset: params.preset || '7d',
        from: params.from || null,
        to: params.to || null,
      };
    }
    const r = rangeFor(params.preset || '7d', null, deviceTimezone());
    return { preset: params.preset || '7d', from: r.from, to: r.to };
  });

  const rangeTouchedRef = useRef(!!(params?.from || params?.to));
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const preset = params?.preset || '7d';
    const r = rangeFor(preset, null, tz);
    setRange({ preset, from: r.from, to: r.to });
  }, [tz]);

  function onRangeChange(next) {
    rangeTouchedRef.current = true;
    setRange(next);
  }

  const cId = campaign?.id;
  const isLitDrop = campaign?.type === 'lit_drop';

  const qsBase = useMemo(() => {
    const p = new URLSearchParams();
    if (cId) p.set('campaignId', cId);
    if (effortId) p.set('effortId', effortId);
    if (range?.from) p.set('from', range.from);
    if (range?.to) p.set('to', range.to);
    p.set('tz', deviceTimezone());
    return p.toString();
  }, [cId, effortId, range?.from, range?.to]);

  const summaryQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'summary', qsBase],
    queryFn: () => api(`/admin/reports/canvassers/${userId}/summary?${qsBase}`),
    enabled: !!cId && !!userId && !!range,
  });

  const teamQ = useQuery({
    queryKey: ['admin', 'canvasser', 'team-avg', qsBase],
    queryFn: () => api(`/admin/reports/team-averages?${qsBase}`),
    enabled: !!cId && !!range,
  });

  const answersQ = useQuery({
    queryKey: ['admin', 'canvasser', userId, 'answers', qsBase],
    queryFn: () =>
      api(`/admin/reports/survey-results?${qsBase}&userId=${userId}&compareToOrg=true`),
    enabled: !!cId && !!userId && !isLitDrop && !!range,
  });

  // Only to name the walk list in the scope line — Timeline's efforts key, so the
  // list is usually already cached from the screen that threaded the scope here.
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId && !!effortId,
  });
  const effortName = effortId
    ? (effortsQ.data?.efforts || []).find((ef) => String(ef._id) === String(effortId))?.name
    : null;

  const s = summaryQ.data;
  const team = teamQ.data?.avg;

  // Deltas render as the sub-line accent: '▲ 1.4h vs team' in success when ahead, muted
  // otherwise — the retired grid tile's exact semantics, re-expressed in the row idiom.
  const rateColors = makeRateColors(colors);
  const deltaAccent = (d) => {
    if (!d) return null;
    const up = d.value > 0;
    const mark = up ? '▲' : d.value === 0 ? '·' : '▼';
    return {
      subAccent: `${mark} ${Math.abs(d.value)}${d.unit || ''} vs team`,
      accentColor: up ? colors.success : colors.textMuted,
    };
  };

  const kpiRows = useMemo(() => {
    if (!s) return [];
    const k = s.kpi;
    // Server-computed connection rate (completion knocks ÷ knocks, capped at 100).
    const cr = rateFromPct(k.connectionRatePct);
    // "Surveys taken", not a bare "Surveys" and not "Voters surveyed": this value is a COUNT OF
    // RESPONSE ROWS (SurveyResponse), and the team-average delta compares against the same
    // response-unit figure. It read "Voters surveyed" — right number in a one-round campaign (one
    // response per voter per round), wrong the moment a second round re-surveys anyone. The label
    // has to name the unit, or it looks like it contradicts the door-unit counts on the Timeline.
    const primaryLabel = isLitDrop ? 'Lit drops' : 'Surveys taken';
    const primaryValue = isLitDrop ? k.litDropped : k.surveysSubmitted;
    return [
      {
        label: 'Knocks',
        value: (k.homesKnocked || 0).toLocaleString(),
        delta: team ? delta(k.homesKnocked, team.homesKnocked) : null,
      },
      {
        label: primaryLabel,
        value: (primaryValue || 0).toLocaleString(),
        delta: team
          ? delta(primaryValue, isLitDrop ? null : team.surveysSubmitted)
          : null,
      },
      {
        label: 'Connection rate',
        value: cr ? cr.value : '—',
        level: cr?.level,
        delta: team && cr
          ? delta(k.connectionRatePct, team.connectionRatePct, '%')
          : null,
      },
      {
        label: 'Hours on doors',
        value: (k.hoursOnDoors || 0).toFixed(1),
        sub: `${k.daysActive || 0} active day${k.daysActive === 1 ? '' : 's'}`,
        delta: team ? delta(k.hoursOnDoors, team.hoursOnDoors, 'h') : null,
      },
      {
        label: 'Knocks / hour',
        value: (k.doorsPerHour || 0).toFixed(1),
        delta: team ? delta(k.doorsPerHour, team.doorsPerHour) : null,
      },
      {
        label: 'Surveys taken / hour',
        value: (k.surveysPerHour || 0).toFixed(1),
        delta: team ? delta(k.surveysPerHour, team.surveysPerHour) : null,
      },
      {
        label: 'Avg minutes / door',
        value: k.avgMinutesPerDoor ? k.avgMinutesPerDoor.toFixed(1) : '—',
      },
      {
        label: 'Not home / wrong',
        value: `${k.notHome || 0} / ${k.wrongAddress || 0}`,
      },
    ];
  }, [s, team, isLitDrop]);

  const hourData = useMemo(() => {
    if (!s) return [];
    // 8 bars covering every 3 hours, for legibility
    const buckets = Array.from({ length: 8 }, () => 0);
    for (const b of s.hourDistribution || []) {
      buckets[Math.floor(b.hour / 3)] += b.count;
    }
    return buckets.map((count, i) => ({ label: HOUR_LABELS[i], value: count }));
  }, [s]);

  const dowData = useMemo(() => {
    if (!s) return [];
    return (s.dayOfWeekDistribution || []).map((d) => ({
      label: DOW_LABELS[d.dow],
      value: d.count,
    }));
  }, [s]);

  const lastSeven = s?.lastSevenDays || [];

  const answers = answersQ.data;

  function exportCsv() {
    const name = `canvasser-${userId}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(
      `/admin/reports/canvassers/${userId}/export.csv?${qsBase}`,
      name
    );
  }

  // No campaign to scope by (nothing threaded AND nothing valid in the cache): say so
  // instead of rendering nothing — this exact state used to be a blank white screen.
  if (campaign === null) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <Text style={{ color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.xl }}>
            No campaign selected. Open a campaign from the Overview, then view this canvasser from there.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (campaign === undefined || !range || summaryQ.isLoading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  if (summaryQ.error) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <Text style={{ color: colors.danger }}>
            {summaryQ.error.message || 'Failed to load'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // A settled query with no payload (deleted user, empty response) — an explicit empty
  // state, never a bare null (that rendered as a white screen).
  if (!s) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Header onBack={() => router.back()} />
        <View style={styles.loading}>
          <Text style={{ color: colors.textSecondary }}>No data for this canvasser.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const fullName =
    `${s.user.firstName || ''} ${s.user.lastName || ''}`.trim() || s.user.email;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Header onBack={() => router.back()} title={fullName} />

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} />

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Identity */}
        <View style={styles.idCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(fullName) || '?'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{fullName}</Text>
            <Text style={styles.idMeta}>{s.user.email}</Text>
            {s.user.phone ? (
              <Text style={styles.idMeta}>{s.user.phone}</Text>
            ) : null}
            <View style={styles.idBadges}>
              {s.memberships?.map((m, i) => (
                <View key={i} style={[styles.badge, m.role === 'admin' && styles.badgeAdmin]}>
                  <Text style={[styles.badgeText, m.role === 'admin' && styles.badgeAdminText]}>
                    {m.role}
                  </Text>
                </View>
              ))}
              {!s.user.isActive ? (
                <View style={[styles.badge, styles.badgeInactive]}>
                  <Text style={[styles.badgeText, styles.badgeInactiveText]}>inactive</Text>
                </View>
              ) : null}
              {s.user.lastLoginAt ? (
                <Text style={styles.lastLogin}>
                  · last login {timeAgo(s.user.lastLoginAt)}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        <Text style={styles.rangeLabel}>
          Showing: {labelForRange(range)}
          {teamQ.data?.canvasserCount ? ` · ${teamQ.data.canvasserCount} canvassers in scope` : ''}
          {effortId ? (effortName ? ` · walk list: ${effortName}` : ' · one walk list') : ''}
        </Text>

        {/* KPIs — hero (Knocks) over supporting rows. Each delta rides the sub line as the
            accent fragment, so the tier color lands on '▲ 1.4h vs team' and never on the
            label beside it. */}
        <InsetGroup>
          <InsetHeroRow
            label={kpiRows[0]?.label || 'Knocks'}
            value={kpiRows[0]?.value ?? '—'}
            subAccent={deltaAccent(kpiRows[0]?.delta)?.subAccent}
            accentColor={deltaAccent(kpiRows[0]?.delta)?.accentColor}
          />
          {kpiRows.slice(1).map((tile) => {
            const acc = deltaAccent(tile.delta);
            return (
              <InsetRow
                key={tile.label}
                label={tile.label}
                value={tile.value}
                sub={tile.sub ? `${tile.sub}${acc ? ' · ' : ''}` : acc ? '' : null}
                subAccent={acc?.subAccent}
                accentColor={acc?.accentColor}
                chipColors={tile.level ? rateColors[tile.level] : null}
              />
            );
          })}
        </InsetGroup>

        {/* Highlights — was a 3-across squeeze of mini-cards; rows give each value the
            full width. */}
        <View style={styles.groupGap}>
          <InsetGroup>
            <InsetRow
              label="Best day"
              value={
                s.highlights.bestDay
                  ? `${s.highlights.bestDay.homesKnocked} knocks`
                  : '—'
              }
              sub={
                s.highlights.bestDay
                  ? fmtDate(s.highlights.bestDay.date)
                  : 'No activity yet'
              }
            />
            <InsetRow
              label="Streak"
              value={`${s.highlights.currentStreak || 0}d`}
              sub="consecutive active days"
            />
            <InsetRow
              label="Last activity"
              value={
                s.highlights.lastActivityAt
                  ? timeAgo(s.highlights.lastActivityAt)
                  : '—'
              }
              sub={
                s.highlights.firstActivityAt
                  ? `since ${formatRange(s.highlights.firstActivityAt, null, campaign?.timeZone)}`
                  : ''
              }
            />
          </InsetGroup>
        </View>

        {/* Days preview */}
        <SectionHeader
          title="Recent days"
          onSeeAll={() =>
            router.push({
              pathname: `/(app)/admin/canvasser/${userId}/days`,
              params: {
                ...(campaign?.id ? { campaignId: campaign.id } : {}), ...(effortId ? { effortId } : {}), from: range.from || '', to: range.to || '', preset: range.preset },
            })
          }
        />
        {lastSeven.length === 0 ? (
          <Empty text="No active days in this range." />
        ) : (
          lastSeven.map((d) => (
            <Pressable
              key={d.date}
              onPress={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/day/${d.date}`,
                  params: {
                    ...(campaign?.id ? { campaignId: campaign.id } : {}), ...(effortId ? { effortId } : {}), preset: range.preset },
                })
              }
              style={({ pressed }) => [styles.dayRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dayDate}>{fmtDate(d.date)}</Text>
                <Text style={styles.dayMeta}>
                  {formatRange(d.firstActivityAt, d.lastActivityAt, campaign?.timeZone)} ·{' '}
                  {d.hoursOnDoors.toFixed(1)}h
                </Text>
              </View>
              <Text style={styles.dayDoors}>{d.homesKnocked} knocks</Text>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))
        )}

        {/* Hour of day */}
        <SectionHeader title="When they work · hour of day" />
        <View style={styles.chartCard}>
          <BarChart data={hourData} />
        </View>

        {/* Day of week */}
        <SectionHeader title="Day of week" />
        <View style={styles.chartCard}>
          <BarChart data={dowData} />
        </View>

        {/* Survey answers preview */}
        {!isLitDrop && answers?.questions?.length ? (
          <>
            <SectionHeader
              title="Survey answers"
              subtitle={
                answers.compareToOrg
                  ? `${answers.totalResponses} responses vs ${answers.orgTotalResponses} org-wide`
                  : `${answers.totalResponses} responses`
              }
              onSeeAll={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/answers`,
                  params: {
                    ...(campaign?.id ? { campaignId: campaign.id } : {}), ...(effortId ? { effortId } : {}), from: range.from || '', to: range.to || '', preset: range.preset },
                })
              }
            />
            {answers.questions.slice(0, 2).map((q) => (
              <View key={q.key} style={styles.chartCard}>
                <Text style={styles.qLabel} numberOfLines={2}>
                  {q.label}
                </Text>
                <BarChart
                  data={q.options.map((opt) => ({
                    label: String(opt.option).slice(0, 16),
                    value: opt.percent,
                    secondaryValue: opt.orgPercent,
                  }))}
                  max={100}
                  valueFormat={(v) => `${v}%`}
                  secondaryLabel="Org avg"
                />
              </View>
            ))}
          </>
        ) : null}

        {/* Quality */}
        <SectionHeader
          title="Quality & sync"
          onSeeAll={() =>
            router.push({
              pathname: `/(app)/admin/canvasser/${userId}/quality`,
              params: {
                ...(campaign?.id ? { campaignId: campaign.id } : {}), ...(effortId ? { effortId } : {}), from: range.from || '', to: range.to || '', preset: range.preset },
            })
          }
        />
        <InsetGroup>
          <InsetRow
            label="Offline"
            value={`${s.quality.offlinePercent}%`}
            sub={`${s.quality.offlineCount} submissions`}
          />
          <InsetRow
            label="Avg distance from house"
            value={formatDistance(s.quality.avgDistanceFromHouseMeters)}
          />
          {/* Detector-rule far (accuracy-aware, corrections + pin fixes forgiven) — the
              forgiven count explains a drop after someone corrects a pin. */}
          <InsetRow
            label="Far knocks"
            value={`${s.quality.farFromHousePercent}%`}
            sub={
              s.quality.farForgivenByPinCount != null && s.quality.farForgivenByPinCount > 0
                ? `${s.quality.farFromHouseCount} flagged · ${s.quality.farForgivenByPinCount} forgiven`
                : `${s.quality.farFromHouseCount} flagged`
            }
          />
        </InsetGroup>

        {/* Drill down — a menu of destinations, which is exactly what an inset group is for.
            Note the last one: "Export CSV" does not navigate, so it is an InsetActionRow and
            gets NO chevron. It carried one as a tile, which is an affordance that lies. */}
        <SectionHeader title="Drill down" />
        <InsetGroup>
          {[
            { key: 'activity', label: 'Activity feed', sub: 'Every knock' },
            { key: 'households', label: 'Households', sub: 'Places visited' },
            ...(isLitDrop ? [] : [{ key: 'voters', label: 'Surveys taken', sub: 'With demographics' }]),
            { key: 'notes', label: 'Notes', sub: 'All free-text' },
            { key: 'map', label: 'Territory map', sub: 'Knock locations' },
          ].map((d) => (
            <InsetNavRow
              key={d.key}
              label={d.label}
              sub={d.sub}
              onPress={() =>
                router.push({
                  pathname: `/(app)/admin/canvasser/${userId}/${d.key}`,
                  params: {
                    ...(campaign?.id ? { campaignId: campaign.id } : {}),
                    ...(effortId ? { effortId } : {}),
                    from: range.from || '',
                    to: range.to || '',
                    preset: range.preset,
                  },
                })
              }
            />
          ))}
          <InsetActionRow label="Export CSV" onPress={exportCsv} />
        </InsetGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

// Left-aligned, back link on its own line — matching the campaign screen it is reached from.
// The old centered title needed a magic `width: 80` spacer to balance the back link, and gave
// the name only what was left over; stacked, it gets the full width and two lines.
function Header({ onBack, title }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button">
        <Text style={styles.back}>‹ Back</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={2}>
        {title || ''}
      </Text>
    </View>
  );
}

function Empty({ text }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // Stacked, left-aligned — matches the campaign screen this is reached from.
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  back: { ...type.caption, color: colors.brand, fontWeight: '600', alignSelf: 'flex-start' },
  headerTitle: { ...type.title, marginTop: 2 },

  idCard: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 20 },
  name: { ...type.h2 },
  idMeta: { ...type.caption, marginTop: 1 },
  idBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.bg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  badgeAdmin: { backgroundColor: colors.brandTint, borderColor: colors.brandTint },
  badgeAdminText: { color: colors.brand },
  badgeInactive: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBg },
  badgeInactiveText: { color: colors.danger },
  lastLogin: { ...type.caption, color: colors.textMuted },

  rangeLabel: {
    ...type.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontStyle: 'italic',
  },

  // Breathing room between back-to-back groups that share no SectionHeader.
  groupGap: { marginTop: spacing.md },

  chartCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
  },
  qLabel: {
    ...type.bodyStrong,
    fontSize: 13,
    marginBottom: spacing.sm,
  },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  dayDate: { ...type.bodyStrong, fontSize: 14 },
  dayMeta: { ...type.caption, marginTop: 2 },
  dayDoors: { ...type.bodyStrong, fontVariant: ['tabular-nums'] },
  chev: { color: colors.textMuted, fontSize: 22, fontWeight: '300' },

  empty: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  emptyText: { ...type.caption, fontStyle: 'italic' },
  });
}
