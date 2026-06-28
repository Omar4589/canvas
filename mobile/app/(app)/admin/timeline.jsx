import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { todayInTz, shiftDays, deviceTimezone } from '../../../lib/dateRanges';
import { rateFromPct, makeRateColors } from '../../../lib/rates';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

const ROW_H = 46;
const CELL_W = 40;
const NAME_W = 134;
const SUM_W = 48;

function fmtDay(ymd) {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
function fmtHour(h) {
  const ampm = h < 12 ? 'a' : 'p';
  return `${((h + 11) % 12) + 1}${ampm}`;
}
function actionLabel(t) {
  if (t === 'survey_submitted') return 'Surveyed';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong addr';
  if (t === 'refused') return 'Refused';
  return t;
}
function actionColor(colors, t) {
  return colors.status[t === 'survey_submitted' ? 'surveyed' : t] || colors.textMuted;
}

export default function AdminTimeline() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const rc = makeRateColors(colors);

  const [campaign, setCampaign] = useState(undefined);
  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);
  const cId = campaign?.id;
  const tz = campaign?.timeZone || deviceTimezone();

  const [day, setDay] = useState(() => todayInTz(deviceTimezone()));
  const dayTouched = useRef(false);
  useEffect(() => {
    if (dayTouched.current || !campaign?.timeZone) return;
    setDay(todayInTz(campaign.timeZone));
  }, [campaign?.timeZone]);

  const [metric, setMetric] = useState('knocks');
  const isToday = day === todayInTz(tz);
  function stepDay(n) {
    dayTouched.current = true;
    setDay((d) => shiftDays(d, n));
  }

  const q = useQuery({
    queryKey: ['admin', 'reports', 'canvasser-timeline', cId, day],
    queryFn: () => {
      const p = new URLSearchParams();
      if (cId) p.set('campaignId', cId);
      p.set('date', day);
      return api(`/admin/reports/canvasser-timeline?${p.toString()}`);
    },
    enabled: !!cId,
    refetchInterval: isToday ? 30000 : false,
  });

  const data = q.data || {};
  const hours = data.hours || [];
  const canvassers = data.canvassers || [];
  const overlaps = data.overlaps || [];
  const byHourKey = metric === 'surveys' ? 'surveysByHour' : 'knocksByHour';
  const totalsKey = metric === 'surveys' ? 'surveys' : 'knocks';
  const hourTotals = data.hourTotals?.[totalsKey] || {};

  let maxCell = 0;
  for (const c of canvassers) for (const h of hours) {
    const v = c[byHourKey]?.[h] || 0;
    if (v > maxCell) maxCell = v;
  }
  const cellBg = (v) => (v && maxCell ? `rgba(59,130,246,${(0.12 + 0.88 * (v / maxCell)).toFixed(3)})` : 'transparent');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Admin</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Daily Timeline</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Day stepper + metric toggle */}
      <View style={styles.controls}>
        <View style={styles.stepper}>
          <Pressable onPress={() => stepDay(-1)} style={styles.stepBtn} hitSlop={6}>
            <Text style={styles.stepBtnText}>‹</Text>
          </Pressable>
          <Text style={styles.dayLabel}>{fmtDay(day)}</Text>
          <Pressable
            onPress={() => stepDay(1)}
            disabled={isToday}
            style={[styles.stepBtn, isToday && styles.stepBtnDisabled]}
            hitSlop={6}
          >
            <Text style={styles.stepBtnText}>›</Text>
          </Pressable>
          {data.tzAbbrev ? <Text style={styles.tzText}>{data.tzAbbrev}</Text> : null}
        </View>
        <View style={styles.toggle}>
          {['knocks', 'surveys'].map((m) => {
            const active = m === metric;
            return (
              <Pressable key={m} onPress={() => setMetric(m)} style={[styles.pill, active && styles.pillActive]}>
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {m === 'knocks' ? 'Knocks' : 'Surveys'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {q.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.brand} /></View>
      ) : canvassers.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No activity</Text>
          <Text style={styles.emptyText}>No knocks recorded on {fmtDay(day)}. Step to another day.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {/* Reconciliation */}
          <View style={styles.reconCard}>
            <Text style={styles.reconText}>
              <Text style={styles.reconStrong}>{(data.grandKnocks || 0).toLocaleString()}</Text> knocks across{' '}
              <Text style={styles.reconStrong}>{canvassers.length}</Text>{' '}
              {canvassers.length === 1 ? 'canvasser' : 'canvassers'}
            </Text>
            {data.overlapDoors > 0 ? (
              <Text style={styles.reconWarn}>
                {data.overlapDoors} overlap door-pass{data.overlapDoors === 1 ? '' : 'es'} (billed once → {data.billableKnocks})
              </Text>
            ) : (
              <Text style={styles.reconMuted}>No overlaps</Text>
            )}
          </View>

          {/* Frozen-name-column grid */}
          <View style={styles.gridRow}>
            {/* Fixed left column */}
            <View style={{ width: NAME_W }}>
              <View style={[styles.cellBase, styles.headCell, { width: NAME_W, alignItems: 'flex-start' }]}>
                <Text style={styles.headText}>Canvasser</Text>
              </View>
              {canvassers.map((c) => (
                <View key={c.userId} style={[styles.cellBase, styles.nameCell, { width: NAME_W }]}>
                  <Text style={styles.nameText} numberOfLines={1}>
                    {c.firstName} {c.lastName}{c.inOverlap ? ' ⚠' : ''}
                  </Text>
                </View>
              ))}
              <View style={[styles.cellBase, styles.totalCell, { width: NAME_W, alignItems: 'flex-start' }]}>
                <Text style={styles.totalText}>Total</Text>
              </View>
            </View>

            {/* Scrollable hours + summary */}
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View>
                {/* Header */}
                <View style={{ flexDirection: 'row' }}>
                  {hours.map((h) => (
                    <View key={h} style={[styles.cellBase, styles.headCell, { width: CELL_W }]}>
                      <Text style={styles.headText}>{fmtHour(h)}</Text>
                    </View>
                  ))}
                  <View style={[styles.cellBase, styles.headCell, { width: SUM_W }]}><Text style={styles.headText}>Kn</Text></View>
                  <View style={[styles.cellBase, styles.headCell, { width: SUM_W }]}><Text style={styles.headText}>Sv</Text></View>
                  <View style={[styles.cellBase, styles.headCell, { width: SUM_W }]}><Text style={styles.headText}>Conn</Text></View>
                </View>
                {/* Rows */}
                {canvassers.map((c) => {
                  const lvl = rateFromPct(c.connectionRate)?.level;
                  return (
                    <View key={c.userId} style={{ flexDirection: 'row' }}>
                      {hours.map((h) => {
                        const v = c[byHourKey]?.[h] || 0;
                        return (
                          <View key={h} style={[styles.cellBase, styles.dataCell, { width: CELL_W, backgroundColor: cellBg(v) }]}>
                            <Text style={styles.cellText}>{v || ''}</Text>
                          </View>
                        );
                      })}
                      <View style={[styles.cellBase, styles.dataCell, { width: SUM_W }]}><Text style={styles.sumStrong}>{c.dayKnocks}</Text></View>
                      <View style={[styles.cellBase, styles.dataCell, { width: SUM_W }]}><Text style={styles.cellText}>{c.daySurveys}</Text></View>
                      <View style={[styles.cellBase, styles.dataCell, { width: SUM_W }]}>
                        <Text style={[styles.sumStrong, { color: lvl ? rc[lvl].fg : colors.textMuted }]}>{c.connectionRate}%</Text>
                      </View>
                    </View>
                  );
                })}
                {/* Totals */}
                <View style={{ flexDirection: 'row' }}>
                  {hours.map((h) => (
                    <View key={h} style={[styles.cellBase, styles.totalCell, { width: CELL_W }]}>
                      <Text style={styles.totalText}>{hourTotals[h] || ''}</Text>
                    </View>
                  ))}
                  <View style={[styles.cellBase, styles.totalCell, { width: SUM_W }]}><Text style={styles.totalText}>{data.grandKnocks}</Text></View>
                  <View style={[styles.cellBase, styles.totalCell, { width: SUM_W }]}><Text style={styles.totalText}>{data.grandSurveys}</Text></View>
                  <View style={[styles.cellBase, styles.totalCell, { width: SUM_W }]}><Text style={styles.totalText}>—</Text></View>
                </View>
              </View>
            </ScrollView>
          </View>

          {/* Day's overlaps */}
          {overlaps.length > 0 && (
            <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
              <Text style={styles.sectionLabel}>Overlaps ({overlaps.length})</Text>
              {overlaps.map((o) => (
                <View key={o.household.id} style={styles.card}>
                  <Text style={styles.address}>
                    {o.household.addressLine1}
                    {o.household.addressLine2 ? `, ${o.household.addressLine2}` : ''}
                  </Text>
                  <Text style={styles.addressSub}>
                    {[o.household.city, o.household.state, o.household.zipCode].filter(Boolean).join(', ')}
                  </Text>
                  {o.passes.map((p) => (
                    <View key={p.passId || 'none'} style={styles.passBlock}>
                      <Text style={styles.passLabel}>{p.roundLabel}</Text>
                      {p.canvassers.map((c, i) => (
                        <View key={`${c.userId}-${i}`} style={styles.canvasserRow}>
                          <View style={[styles.actionDot, { backgroundColor: actionColor(colors, c.actionType) }]} />
                          <Text style={styles.canvasserName} numberOfLines={1}>{c.firstName} {c.lastName}</Text>
                          <Text style={styles.canvasserAction}>{actionLabel(c.actionType)}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
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

    controls: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    stepBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    stepBtnDisabled: { opacity: 0.4 },
    stepBtnText: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
    dayLabel: { ...type.bodyStrong, minWidth: 96, textAlign: 'center' },
    tzText: { ...type.caption, color: colors.textMuted },

    toggle: { flexDirection: 'row', gap: spacing.xs },
    pill: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
    pillText: { color: colors.textPrimary, fontWeight: '600', fontSize: 12 },
    pillTextActive: { color: colors.textInverse },

    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
    emptyTitle: { ...type.h3 },
    emptyText: { ...type.caption, textAlign: 'center' },

    reconCard: {
      margin: spacing.lg,
      marginBottom: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    reconText: { ...type.body },
    reconStrong: { fontWeight: '800', color: colors.textPrimary },
    reconWarn: { ...type.caption, color: colors.warnFg, marginTop: 2, fontWeight: '600' },
    reconMuted: { ...type.caption, color: colors.textMuted, marginTop: 2 },

    gridRow: { flexDirection: 'row', paddingHorizontal: spacing.lg },
    cellBase: {
      height: ROW_H,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingHorizontal: 2,
    },
    headCell: { backgroundColor: colors.bg },
    headText: { ...type.caption, fontWeight: '700', color: colors.textMuted, fontSize: 11 },
    nameCell: { alignItems: 'flex-start', backgroundColor: colors.card },
    nameText: { ...type.body, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    dataCell: {},
    cellText: { fontSize: 12, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    sumStrong: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    totalCell: { backgroundColor: colors.bg, borderBottomWidth: 0, borderTopWidth: 1, borderTopColor: colors.border },
    totalText: { fontSize: 12, fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'] },

    sectionLabel: { ...type.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.sm },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      ...shadow.card,
    },
    address: { ...type.bodyStrong, fontSize: 14 },
    addressSub: { ...type.caption, marginTop: 2 },
    passBlock: { marginTop: spacing.sm },
    passLabel: { ...type.caption, fontWeight: '700', color: colors.textSecondary },
    canvasserRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
    actionDot: { width: 8, height: 8, borderRadius: 4 },
    canvasserName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    canvasserAction: { fontSize: 12, color: colors.textSecondary },
  });
}
