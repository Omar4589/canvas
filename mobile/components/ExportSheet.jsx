import { useEffect, useState } from 'react';
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
import { paramsFor, ROUND_STATUSES, outcomeKeysFor, estimateLineFor } from '../lib/exportTypes';
import { walkListOptions, walkListLabel, passOptionLabel } from '../lib/walkListOptions';
import { useOutcomeInUse } from '../lib/useOutcomeInUse';
import DateRangeBar from './DateRangeBar';
import TabSwitcher from './TabSwitcher';
import { loadExportOptions } from '../lib/cache';
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

export default function ExportSheet({ meta, campaignId, campaignType, tz, queueing, onQueue, onClose }) {
  // Not a target voter — named in the description and the per-voter hint, and offered as an outcome
  // chip and a round status, only on a campaign that has used it, so a customer who never turns it on
  // never sees the words.
  const notTargetInUse = useOutcomeInUse(campaignId);
  // One row per knock (docs/PROPOSAL_ONE_ROW_PER_KNOCK.md). A row option, off on every open and never
  // remembered (the owner's ruling, 2026-11-09). Shown only when the server advertises the token
  // (the local fallback leaves it out), so an older server can never silently drop it.
  const [onePerKnock, setOnePerKnock] = useState(false);
  const perKnockOn = (meta.filters || []).includes('onePerKnock') && onePerKnock;
  // The exports screen holds the active campaign with its type: the copy says Lit dropped there.
  const isLitDrop = campaignType === 'lit_drop';
  const outcomeKeys = outcomeKeysFor(meta, OUTCOME_CHIPS.map((c) => c.key), { onePerKnock, notTargetInUse });
  const outcomeChips = OUTCOME_CHIPS.filter((c) => outcomeKeys.includes(c.key));
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
  // The one REMEMBERED option (lib/cache exportOptions, the web page's rule). The estimate is gated
  // on prefsLoaded below so the live count is never computed for a state the sheet is about to
  // replace — otherwise the number visibly changes under the user a beat after the sheet opens.
  const [includeSurveyAnswers, setIncludeSurveyAnswers] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    let ignore = false;
    loadExportOptions(campaignId)
      .then((opts) => {
        if (ignore) return;
        setIncludeSurveyAnswers(!!opts.includeSurveyAnswers);
        setPrefsLoaded(true);
      })
      .catch(() => {
        if (!ignore) setPrefsLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, [campaignId]);

  // The web page's rule: a round belongs to a walk list, so changing the list resets it.
  function pickEffort(id) {
    setEffortId(id);
    setPassId('');
  }

  // The round tabs need the walk lists too, to name each round's.
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId && (wants('effort') || wants('pass')),
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

  const wire = paramsFor(meta, { range, effortId, passId, userId, roundStatus, importJobId, actionTypes, includeVoterDetail, perVoterRows, includeSurveyAnswers, onePerKnock });
  // Debouncing the SERIALIZED params gives a stable query key and kills object-identity
  // churn in one move; api() threads react-query's abort signal, so a superseded count
  // stops on the wire.
  const wireKey = useDebouncedValue(JSON.stringify(wire), 400);
  const estimateQ = useQuery({
    queryKey: ['admin', 'export-estimate', campaignId, meta.id, wireKey],
    // The answer carries the params it was counted for (`asked`), so its line is labelled by what was
    // counted, never by switches that have moved since (lib/exportTypes estimateLineFor).
    queryFn: ({ signal }) =>
      api('/admin/exports/estimate', {
        method: 'POST',
        body: { type: meta.id, campaignId, params: JSON.parse(wireKey) },
        signal,
      }).then((answer) => ({ ...answer, asked: JSON.parse(wireKey) })),
    enabled: !!campaignId && prefsLoaded,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
    retry: false,
  });
  const est = estimateQ.data;

  // Archived walk lists stay — an export is history — marked and listed last, and they count
  // toward the 2+ gate below (lib/walkListOptions.js).
  const walkLists = walkListOptions(efforts);
  const effortTabs = [{ key: '', label: 'All walk lists' }, ...walkLists.map((e) => ({ key: String(e._id), label: walkListLabel(e) }))];
  // Each round names its walk list ("North · Pass 2") — a bare "Pass 2" names a different round in
  // every walk list — grouped in the walk-list tabs' order, then by round number.
  const listRank = new Map(walkLists.map((e, i) => [String(e._id), i]));
  const rankOf = (p) => listRank.get(String(p.effortId)) ?? walkLists.length;
  const passTabs = [
    { key: '', label: 'All rounds' },
    ...[...passes]
      .sort((a, b) => rankOf(a) - rankOf(b) || (a.roundNumber ?? 0) - (b.roundNumber ?? 0))
      .map((p) => {
        const list = walkLists[listRank.get(String(p.effortId))];
        return { key: String(p._id), label: passOptionLabel(p, list ? walkListLabel(list) : null) };
      }),
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
    // The status's own label, as the web select shows it — the slug with underscores swapped read
    // "not target" for Not a target voter.
    ...[...ROUND_STATUSES, ...(notTargetInUse ? ['not_target'] : [])].map((s) => ({ key: s, label: colors.statusLabels[s] || s })),
  ];

  // "One row is…" must not read "one door event" while a Rows switch is on.
  const fanOn = wants('perVoterRows') && perVoterRows;
  const oneRowIs = perKnockOn
    ? fanOn
      ? 'one knock, or one voter at a knock that named nobody — each door once per round'
      : 'one knock — each door once per round, the way your Knocks count it'
    : fanOn
      ? 'one voter at one door event — a knock that named nobody repeats per registered voter at that address'
      : meta.oneRowIs;

  const estimateLine = () => estimateLineFor(est);

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
            <Text style={styles.title}>{meta.label}</Text>
            <Text style={styles.desc}>{(notTargetInUse && meta.descNotTargetInUse) || meta.desc}</Text>

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
                    accessibilityLabel="Include contact and demographic details"
                    value={includeVoterDetail}
                    onValueChange={setIncludeVoterDetail}
                    trackColor={{ true: colors.brand }}
                  />
                </View>
              </View>
            ) : null}

            {/* One row per knock sits ABOVE the chips it changes (the web dialog's order): ticked, it
                takes Restricted and Note added off the row and makes the chips pick door results. */}
            {wants('onePerKnock') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Knocks</Text>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>One row per knock</Text>
                    <Text style={styles.switchSub}>
                      Each door once per round, matching your Knocks when no outcome is ticked. Two
                      canvassers at one door: one entry is kept, the door{'\u2019'}s result (
                      {isLitDrop ? 'Lit dropped if anyone dropped literature' : 'Surveyed if anyone surveyed'}
                      , otherwise the later visit), under one name, so don{'\u2019'}t total it by canvasser.
                      Restricted marks and Note added entries are left out.
                    </Text>
                  </View>
                  <Switch accessibilityLabel="One row per knock" value={onePerKnock} onValueChange={setOnePerKnock} trackColor={{ true: colors.brand }} />
                </View>
              </View>
            ) : null}

            {wants('outcome') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Door outcome</Text>
                {/* SourceChips is a horizontal ScrollView with the flex caveat at its top: it is
                    safe here because it sits inside this sheet's vertical scroller content. */}
                <View style={styles.bleed}>
                  <SourceChips sources={outcomeChips} selected={actionTypes} onToggle={toggleOutcome} />
                </View>
                {/* With a canvasser picked there is no door result to pick between (a canvasser never
                    has two entries at one door in a round), so no caption. */}
                {perKnockOn && !userId ? (
                  <Text style={styles.chipCaption}>
                    These pick door results: each door is listed by its knock result for the round.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {wants('perVoterRows') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Rows</Text>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>One row per voter at the door</Text>
                    <Text style={styles.switchSub}>
                      A knock that named nobody (not home, refused, {notTargetInUse ? 'not a target voter, ' : ''}lit
                      drop…) repeats once per
                      registered voter at that address, same outcome and note on each — repeated,
                      not attributed. Same columns, more rows; the file name includes -by-voter so its
                      rows are never counted as knocks.
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="One row per voter at the door"
                    value={perVoterRows}
                    onValueChange={setPerVoterRows}
                    trackColor={{ true: colors.brand }}
                  />
                </View>
              </View>
            ) : null}

            {wants('surveyAnswers') ? (
              <View style={styles.filterBlock}>
                <Text style={styles.filterLabel}>Survey answers</Text>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={styles.switchLabel}>Include survey answers</Text>
                    <Text style={styles.switchSub}>
                      What each survey recorded, one column per question, beside the knock that took
                      it — plus a row for every survey this file cannot otherwise show, because
                      surveying three people at one door in one round is one knock and three
                      surveys. Those rows say Row source: survey; never count them as knocks.
                      Remembered for this campaign.
                    </Text>
                  </View>
                  <Switch
                    accessibilityLabel="Include survey answers"
                    value={includeSurveyAnswers}
                    onValueChange={setIncludeSurveyAnswers}
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
    chipCaption: { ...type.caption, marginTop: spacing.sm },

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
