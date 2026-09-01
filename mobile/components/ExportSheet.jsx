import { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator, Switch, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api';
import { radius, spacing, ACTION_LABELS, actionLabel } from '../lib/theme';
import { useTheme } from '../lib/ThemeContext';
import { useThemedStyles } from '../lib/useThemedStyles';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { paramsFor, ROUND_STATUSES } from '../lib/exportTypes';
import DateRangeBar from './DateRangeBar';
import TabSwitcher from './TabSwitcher';
import SourceChips from './SourceChips';
import { SHEET_TIMING } from './PullableSheet';

// The Export Center's "what am I about to download" sheet — tap a type, read what one row
// is, set filters, watch the live row count, THEN queue. Modal anatomy is MetricSheet's,
// copied deliberately: every structural comment there marks a shipped bug (no
// statusBarTranslucent, GestureHandlerRootView for the grabber inside a Modal window,
// backdrop as SIBLING, the maxHeight on the sheet not the scroller). Mounted only while
// open — a fresh open always starts from default (whole-campaign) filters.
//
// The estimate hits POST /admin/exports/estimate with the SAME params Queue will send
// (estimate==build, server-guaranteed). It is advisory: on any error the well says so and
// Queue stays enabled — the server is the authority at POST time.
// The Door-outcome chips (the notes screen's row, same include semantics: none ticked = all).
const OUTCOME_CHIPS = Object.keys(ACTION_LABELS).map((a) => ({ key: a, label: actionLabel(a) }));

export default function ExportSheet({ meta, campaignId, tz, queueing, onQueue, onClose }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(0);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 600) runOnJS(onClose)();
      else translateY.value = withTiming(0, SHEET_TIMING);
    });

  const wants = (f) => (meta.filters || []).includes(f);

  // Filter state — '' means "whole campaign" everywhere; the wire params only carry what
  // was actually narrowed (lib/exportTypes paramsFor, the web page's builder mirrored).
  const [range, setRange] = useState({ preset: 'all', from: null, to: null });
  const [effortId, setEffortId] = useState('');
  const [passId, setPassId] = useState('');
  const [userId, setUserId] = useState('');
  const [roundStatus, setRoundStatus] = useState('');
  const [importJobId, setImportJobId] = useState('');
  // Door-outcome chips (multi-select; [] = every outcome). Unticking Restricted / Wrong address
  // is how a file drops desk marks and bad addresses.
  const [actionTypes, setActionTypes] = useState([]);
  const toggleOutcome = (key) =>
    setActionTypes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  // Off by default (the web page's rule, and the server's) — a survey export shouldn't carry
  // a date of birth unless someone asked for one.
  const [includeVoterDetail, setIncludeVoterDetail] = useState(false);
  // Off by default too — and unlike the detail toggle this one changes the ROW COUNT and the file
  // name, so the live estimate below reads it (lib/exportTypes paramsFor).
  const [perVoterRows, setPerVoterRows] = useState(false);

  // The web page's rule: a round belongs to a walk list, so changing the list resets it.
  function pickEffort(id) {
    setEffortId(id);
    setPassId('');
  }

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId && wants('effort'),
    staleTime: 60 * 1000,
  });
  const efforts = effortsQ.data?.efforts || [];

  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId, effortId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes${effortId ? `?effortId=${effortId}` : ''}`),
    enabled: !!campaignId && wants('pass'),
    staleTime: 60 * 1000,
  });
  const passes = passesQ.data?.passes || [];

  // Ledger-first roster (the reports endpoint), NOT the assignments roster — a departed
  // canvasser's knocks stay exportable, so they must stay pickable.
  const canvassersQ = useQuery({
    queryKey: ['admin', 'report-canvassers', campaignId],
    queryFn: () => api(`/admin/reports/canvassers?campaignId=${campaignId}`),
    enabled: !!campaignId && wants('canvasser'),
    staleTime: 60 * 1000,
  });
  const canvassers = Array.isArray(canvassersQ.data) ? canvassersQ.data : [];

  const importsQ = useQuery({
    queryKey: ['admin', 'imports', campaignId],
    queryFn: () => api(`/admin/imports?campaignId=${campaignId}`),
    enabled: !!campaignId && wants('import'),
    staleTime: 60 * 1000,
  });
  const imports = (importsQ.data?.jobs || []).filter((j) => j.status === 'completed' && !j.undone);

  const wire = paramsFor(meta, { range, effortId, passId, userId, roundStatus, importJobId, actionTypes, includeVoterDetail, perVoterRows });
  // Debouncing the SERIALIZED params gives a stable query key and kills object-identity
  // churn in one move; api() threads react-query's abort signal, so a superseded count
  // stops on the wire.
  const wireKey = useDebouncedValue(JSON.stringify(wire), 400);
  const estimateQ = useQuery({
    queryKey: ['admin', 'export-estimate', campaignId, meta.id, wireKey],
    queryFn: ({ signal }) =>
      api('/admin/exports/estimate', {
        method: 'POST',
        body: { type: meta.id, campaignId, params: JSON.parse(wireKey) },
        signal,
      }),
    enabled: !!campaignId,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    retry: false,
  });
  const est = estimateQ.data;

  const effortTabs = [{ key: '', label: 'All walk lists' }, ...efforts.map((e) => ({ key: String(e._id), label: e.name }))];
  const passTabs = [
    { key: '', label: 'All rounds' },
    ...passes.map((p) => ({ key: String(p._id), label: `Pass ${p.roundNumber} · ${p.name}` })),
    { key: 'legacy', label: 'Legacy / no pass' },
  ];
  const canvasserTabs = [
    { key: '', label: 'All canvassers' },
    ...canvassers.map((c) => ({
      key: String(c.userId),
      label:
        `${c.firstName || ''} ${c.lastName || ''}`.trim() +
        (c.status && c.status !== 'active' ? ` (${c.status})` : ''),
    })),
  ];
  const statusTabs = [
    { key: '', label: 'Any status' },
    ...ROUND_STATUSES.map((s) => ({ key: s, label: s.replace(/_/g, ' ') })),
  ];

  // "One row is…" must not read "one door event" while the Rows switch is on.
  const oneRowIs = wants('perVoterRows') && perVoterRows
    ? 'one voter at one door event — a knock that named nobody repeats per registered voter at that address'
    : meta.oneRowIs;

  const estimateLine = () => {
    if (!est) return null;
    // rowsAreFloor: the fanned count hit its time cap and the server answered with one row per
    // knock — a floor, never above the truth — so say so instead of printing it as ≈.
    const n = Number(est.rows || 0).toLocaleString();
    const bits = [est.rowsAreFloor ? `at least ${n} rows` : `≈ ${n} rows`];
    if (est.dncWithheld > 0) bits.push(`${est.dncWithheld} withheld (do not contact)`);
    if (est.files?.length) bits.push(`${est.files.length} files — one per survey`);
    if (est.contentKind === 'zip') bits.push('ZIP');
    return bits.join(' · ');
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false} />

        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, sheetStyle]}
          accessibilityViewIsModal
        >
          <GestureDetector gesture={pan}>
            <View style={styles.grabberArea}>
              <View style={styles.grabber} accessibilityElementsHidden importantForAccessibility="no" />
            </View>
          </GestureDetector>

          <ScrollView contentContainerStyle={{ paddingBottom: spacing.md }}>
            <Text style={styles.title}>
              {meta.emoji} {meta.label}
            </Text>
            <Text style={styles.desc}>{meta.desc}</Text>

            <View style={styles.item}>
              <Text style={styles.itemLabel}>One row is…</Text>
              <Text style={styles.itemText}>{oneRowIs}.</Text>
            </View>
            <View style={styles.item}>
              <Text style={styles.itemLabel}>In the file</Text>
              <Text style={styles.itemText}>{meta.contents}</Text>
            </View>

            {wants('date') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Date range</Text>
                {/* DateRangeBar/TabSwitcher pad for a full-width screen; bleeding them to the
                    sheet edge makes their own padding line the pills up with the text above. */}
                <View style={styles.bleed}>
                  <DateRangeBar value={range} onChange={setRange} tz={tz} />
                </View>
              </View>
            ) : null}
            {wants('effort') && efforts.length > 1 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Walk list</Text>
                <View style={styles.bleed}>
                  <TabSwitcher tabs={effortTabs} activeKey={effortId} onChange={pickEffort} />
                </View>
              </View>
            ) : null}
            {wants('pass') && passes.length > 0 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Round</Text>
                <View style={styles.bleed}>
                  <TabSwitcher tabs={passTabs} activeKey={passId} onChange={setPassId} />
                </View>
              </View>
            ) : null}
            {wants('canvasser') && canvassers.length > 0 ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Canvasser</Text>
                <View style={styles.bleed}>
                  <TabSwitcher tabs={canvasserTabs} activeKey={userId} onChange={setUserId} />
                </View>
              </View>
            ) : null}
            {wants('roundStatus') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Round status</Text>
                <View style={styles.bleed}>
                  <TabSwitcher tabs={statusTabs} activeKey={roundStatus} onChange={setRoundStatus} />
                </View>
              </View>
            ) : null}
            {wants('import') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Columns</Text>
                {/* Vertical options, not pills — vendor filenames are long and pills truncate. */}
                <Pressable
                  style={[styles.optionRow, !importJobId && styles.optionRowActive]}
                  onPress={() => setImportJobId('')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.optionText, !importJobId && styles.optionTextActive]}>
                    Current data, standard columns
                  </Text>
                </Pressable>
                {imports.map((j) => {
                  const active = importJobId === String(j._id);
                  return (
                    <Pressable
                      key={j._id}
                      style={[styles.optionRow, active && styles.optionRowActive]}
                      onPress={() => setImportJobId(String(j._id))}
                      accessibilityRole="button"
                    >
                      <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                        {j.filename || 'Upload'} — {new Date(j.createdAt).toLocaleDateString()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {wants('voterDetail') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Columns</Text>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>Contact &amp; demographic details</Text>
                    <Text style={styles.switchSub}>
                      Adds phone, cell, gender, date of birth, county, coordinates, precinct and
                      districts — for matching back to your own voter file.
                    </Text>
                  </View>
                  <Switch
                    value={includeVoterDetail}
                    onValueChange={setIncludeVoterDetail}
                    trackColor={{ true: colors.brand }}
                  />
                </View>
              </View>
            ) : null}

            {wants('outcome') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Door outcome</Text>
                {/* SourceChips is a horizontal ScrollView with the flex caveat at its top: it is
                    safe here because it sits inside this sheet's vertical scroller content. */}
                <View style={styles.bleed}>
                  <SourceChips sources={OUTCOME_CHIPS} selected={actionTypes} onToggle={toggleOutcome} />
                </View>
              </View>
            ) : null}

            {wants('perVoterRows') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Rows</Text>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>One row per voter at the door</Text>
                    <Text style={styles.switchSub}>
                      A knock that named nobody (not home, refused, lit drop…) repeats once per
                      registered voter at that address, same outcome and note on each — repeated,
                      not attributed. Same columns, more rows; the file is named
                      activity-log-by-voter so its rows are never counted as knocks.
                    </Text>
                  </View>
                  <Switch
                    value={perVoterRows}
                    onValueChange={setPerVoterRows}
                    trackColor={{ true: colors.brand }}
                  />
                </View>
              </View>
            ) : null}

            {meta.id === 'voter-file' ? (
              <View style={styles.warn}>
                <Text style={styles.warnText}>
                  This rebuilds a file from the voter data currently in Doorline
                  {importJobId ? ', using the column names from that upload' : ''}. It is not the
                  original file: columns that weren’t mapped during import aren’t included, rows
                  that failed import aren’t included, and edits made since the upload are
                  reflected.
                </Text>
              </View>
            ) : null}

            <View style={styles.well}>
              {est ? (
                <View style={styles.wellRow}>
                  <Text style={[styles.wellText, estimateQ.isFetching && styles.wellTextStale]}>
                    {estimateLine()}
                  </Text>
                  {estimateQ.isFetching ? <ActivityIndicator size="small" /> : null}
                </View>
              ) : estimateQ.isError ? (
                <Text style={styles.wellMuted}>Estimate unavailable — you can still queue.</Text>
              ) : (
                <View style={styles.wellRow}>
                  <Text style={styles.wellMuted}>Counting rows…</Text>
                  <ActivityIndicator size="small" />
                </View>
              )}
            </View>
            <Text style={styles.dncNote}>
              Do-not-contact voters are excluded from every export — the count above already
              reflects that.
            </Text>
          </ScrollView>

          <Pressable
            style={[styles.btn, queueing && styles.btnDisabled]}
            onPress={() => onQueue(wire)}
            disabled={queueing}
            accessibilityRole="button"
          >
            {queueing ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.btnText}>Queue export</Text>
            )}
          </Pressable>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    root: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.backdrop },
    sheet: {
      maxHeight: '90%',
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: spacing.lg,
    },
    grabberArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.md },
    grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },

    title: { ...type.h3, marginBottom: spacing.xs },
    desc: { ...type.caption, marginBottom: spacing.lg },
    item: { marginBottom: spacing.lg },
    itemLabel: { ...type.bodyStrong, marginBottom: 2 },
    itemText: { ...type.caption },

    filterBlock: { marginBottom: spacing.md },
    filterLabel: { ...type.micro, color: colors.textSecondary, marginBottom: spacing.xs },
    bleed: { marginHorizontal: -spacing.lg },

    optionRow: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      marginBottom: spacing.xs,
    },
    optionRowActive: { borderColor: colors.brand },
    optionText: { ...type.caption, color: colors.textPrimary },
    optionTextActive: { color: colors.brand, fontWeight: '600' },

    // The switch sits in the sunken well the estimate uses, so an opt-in that widens the
    // file reads as a block rather than a stray control between two pill strips.
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.sunken,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    switchText: { flex: 1 },
    switchLabel: { ...type.bodyStrong, marginBottom: 2 },
    switchSub: { ...type.caption },

    warn: {
      backgroundColor: colors.warnBg,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.md,
    },
    warnText: { ...type.caption, color: colors.warnFg },

    // MetricSheet's well: sunken fill alone is invisible in dark mode — the hairline is
    // what makes it read as a block.
    well: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.sunken,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: spacing.sm,
    },
    wellRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    wellText: { ...type.bodyStrong, fontVariant: ['tabular-nums'], flexShrink: 1 },
    wellTextStale: { opacity: 0.5 },
    wellMuted: { ...type.caption },

    dncNote: { ...type.caption, marginBottom: spacing.sm },

    btn: {
      backgroundColor: colors.brand,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    btnDisabled: { opacity: 0.6 },
    btnText: { ...type.bodyStrong, color: colors.textInverse, fontWeight: '700' },
  });
}
