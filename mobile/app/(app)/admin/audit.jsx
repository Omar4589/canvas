import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { PRESETS, rangeFor, labelForRange, todayInTz, deviceTimezone } from '../../../lib/dateRanges';
import { spacing, radius } from '../../../lib/theme';
import { makeRateColors } from '../../../lib/rates';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import DateRangeBar from '../../../components/DateRangeBar';
import CampaignChip from '../../../components/CampaignChip';
import InsetGroup, {
  InsetHeroRow,
  InsetRow,
  InsetNoteRow,
  InsetActionRow,
  GroupFooter,
} from '../../../components/InsetGroup';
import TabSwitcher from '../../../components/TabSwitcher';
import LiveStatus from '../../../components/LiveStatus';
import FlaggedEntryCard from '../../../components/FlaggedEntryCard';
import FlagLegendHint from '../../../components/FlagLegendHint';
import { postBulkReview, countBulkReview, undoBulkReview, invalidateFlagCaches, BULK_VERB } from '../../../lib/bulkReview';

const AUDIT_MAX_DAYS = 62;
const AUDIT_PRESETS = PRESETS.filter((p) => p.key !== 'all');
const STATUS_TABS = [
  { key: 'open', label: 'Open' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'all', label: 'All' },
];
const FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

// Bulk action labels: button text + the imperative confirm line ("Dismiss 340 flags?").
const BULK_ACTIONS = [
  { status: 'reviewed', label: 'Mark reviewed', confirm: (n) => `Mark ${n} reviewed` },
  { status: 'dismissed', label: 'Dismiss', confirm: (n) => `Dismiss ${n}` },
  { status: 'confirmed', label: 'Confirm issue', confirm: (n) => `Confirm ${n} as issues`, danger: true },
  { status: 'open', label: 'Reopen', confirm: (n) => `Reopen ${n}`, reopenOnly: true },
];
// Anything bigger than a screenful gets an explicit "yes, that many" Alert.
const BULK_CONFIRM_OVER = 25;
// Height of the bulk bar, for lifting the flash toast clear of it while selection mode is up.
// Applied ON TOP of the bottom inset — the bar is itself lifted by that inset, so this clearance
// is additive, never a replacement for it.
const FLASH_OVER_BULK_BAR = 230;

function ymdSpanDays(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

export default function AdminAudit() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();
  const qc = useQueryClient();

  // Campaign scoping via CampaignChip (like Timeline/Map). This is a hidden Tabs screen that
  // stays mounted, so re-sync the active campaign on focus (a per-campaign drill-in sets it first).
  const [campaign, setCampaign] = useState(undefined);
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone || deviceTimezone();

  const [reviewStatus, setReviewStatus] = useState('open');
  const [userId, setUserId] = useState(''); // '' = all canvassers
  // The picked canvasser's NAME, captured at pick time. The pill strip is built from a payload
  // ?userId has already filtered, so it cannot offer the pill that produced it: narrow the range
  // after picking somebody and `byCanvasser` comes back empty, which used to unmount the strip and
  // leave no way to clear the filter (the same trap Timeline's crew row had). Holding the name lets
  // us keep a pill on screen — labelled "(0)", which is TRUE, they have zero flags in this scope.
  const [pickedName, setPickedName] = useState(null);
  const [effortId, setEffortId] = useState(''); // '' = all walk lists
  const [live, setLive] = useState(true);

  // Bulk selection mode: cards grow check circles, the poll pauses (a refetch would shift
  // the list under fingers), and a bottom bar applies ONE decision to the selection — or,
  // with `scopeWide`, to every flag matching the current filters (the escape hatch when the
  // fetched list is capped at 500). Everything on this screen filters server-side, so the
  // fetch scope IS the displayed scope — unlike the web audit page.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [scopeWide, setScopeWide] = useState(false);
  const [bulkNote, setBulkNote] = useState('');
  const [bulkBusy, setBulkBusy] = useState(null);
  const [bulkFlash, setBulkFlash] = useState(null); // { text, error?, undo?: { scope, ids } }
  const bulkFlashTimer = useRef(null);
  useEffect(() => () => clearTimeout(bulkFlashTimer.current), []);
  const [range, setRange] = useState(() => {
    const r = rangeFor('today', null, deviceTimezone());
    // Default to TODAY (item D3) — the audit is a daily review; wider windows are one tap away.
    return { preset: 'today', from: r.from, to: r.to };
  });
  const rangeTouchedRef = useRef(false);

  // Reset view state when the resolved campaign changes (screen stays mounted).
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setReviewStatus('open');
    setUserId('');
    setPickedName(null);
    setEffortId('');
    setSelectMode(false);
    setSelectedIds(new Set());
    setScopeWide(false);
    setBulkNote('');
    setLive(true);
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
    rangeTouchedRef.current = false;
  }

  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const r = rangeFor('today', null, tz);
    setRange({ preset: 'today', from: r.from, to: r.to });
  }, [tz]);
  function onRangeChange(v) {
    rangeTouchedRef.current = true;
    setRange(v);
  }

  const today = todayInTz(tz);
  const fromDay = range ? (range.preset === 'today' ? today : range.from) : null;
  const effectiveTo = range ? range.to || today : null;
  const includesToday = !!range && (!range.to || range.to >= today);
  const rangeInvalid =
    !!range && (!fromDay || fromDay > effectiveTo || ymdSpanDays(fromDay, effectiveTo) > AUDIT_MAX_DAYS);

  const q = useQuery({
    queryKey: ['admin', 'flags', cId, fromDay, range?.to, reviewStatus, userId, effortId],
    queryFn: () => {
      const p = new URLSearchParams();
      p.set('campaignId', cId);
      p.set('from', fromDay);
      if (range?.to) p.set('to', range.to);
      if (reviewStatus && reviewStatus !== 'all') p.set('reviewStatus', reviewStatus);
      if (userId) p.set('userId', userId);
      if (effortId) p.set('effortId', effortId);
      p.set('limit', '500');
      return api(`/admin/reports/flags?${p.toString()}`);
    },
    enabled: !!cId && !!fromDay && !rangeInvalid,
    // Poll pauses while selection mode is on — a refetch would reorder/remove entries under
    // fingers mid-triage. Cache invalidation after a bulk write still refetches.
    refetchInterval: live && includesToday && !selectMode ? 20_000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
    ...useFocusedPoll(20 * 1000),
  });

  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/efforts`),
    enabled: !!cId,
  });
  const efforts = effortsQ.data?.efforts || [];

  const data = q.data || {};
  const totals = data.summary?.totals || {};
  const byCanvasser = data.summary?.byCanvasser || [];
  const entries = data.entries || [];
  const rangeLabel = labelForRange(range);

  // ——— Bulk review ———

  // Keep the selection honest as the list changes (filter switches, post-write refetch):
  // anything no longer listed is deselected.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const shown = new Set(entries.map((e) => e.actionId));
      const next = new Set([...prev].filter((id) => shown.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  const bulkScope = {
    campaignId: cId,
    from: fromDay,
    to: range?.to || undefined,
    reviewStatus: reviewStatus === 'all' ? undefined : reviewStatus,
    userId: userId || undefined,
    effortId: effortId || undefined,
  };

  const allSelected = entries.length > 0 && entries.every((e) => selectedIds.has(e.actionId));

  function enterSelectMode(actionId) {
    setSelectMode(true);
    if (actionId) setSelectedIds(new Set([actionId]));
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setScopeWide(false);
    setBulkNote('');
  }
  function toggleSelect(actionId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(actionId)) next.delete(actionId);
      else next.add(actionId);
      return next;
    });
  }

  function showBulkFlash(f, ms = 10000) {
    setBulkFlash(f);
    clearTimeout(bulkFlashTimer.current);
    bulkFlashTimer.current = setTimeout(() => setBulkFlash(null), ms);
  }

  async function applyBulk(status, wide) {
    setBulkBusy(status);
    try {
      const res = await postBulkReview(bulkScope, {
        status,
        note: bulkNote.trim() || undefined,
        ...(wide ? {} : { actionIds: [...selectedIds] }),
      });
      invalidateFlagCaches(qc);
      const created = res.createdActionIds || [];
      const overwritten = (res.overwrittenActionIds || []).length;
      const n = status === 'open' ? res.deleted ?? res.matched : res.matched;
      let text = `${n} ${BULK_VERB[status] || 'updated'}`;
      if (overwritten > 0 && status !== 'open') text += ` · ${overwritten} already decided (not undoable)`;
      showBulkFlash({
        // Undo reopens only the decisions this bulk CREATED — see lib/bulkReview.js.
        text,
        undo: status !== 'open' && created.length ? { scope: bulkScope, ids: created } : null,
      });
      exitSelectMode();
    } catch (err) {
      showBulkFlash({ text: err?.message || 'Bulk review failed.', error: true });
    } finally {
      setBulkBusy(null);
    }
  }

  async function requestBulk(action) {
    if (bulkBusy) return;
    const wide = scopeWide;
    let count = selectedIds.size;
    if (wide) {
      // Exact count for the confirm line — the paused poll means data.total can be stale.
      setBulkBusy('count');
      try {
        count = await countBulkReview(bulkScope);
      } catch (err) {
        showBulkFlash({ text: err?.message || 'Could not count the matching flags.', error: true });
        return;
      } finally {
        setBulkBusy(null);
      }
    }
    if (!count) return;
    if (wide || count > BULK_CONFIRM_OVER) {
      Alert.alert(
        `${action.confirm(count)}?`,
        wide
          ? 'This covers every flag matching the current filters, including any beyond the list shown.'
          : undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: action.confirm(count),
            style: action.danger ? 'destructive' : 'default',
            onPress: () => applyBulk(action.status, wide),
          },
        ]
      );
    } else {
      applyBulk(action.status, wide);
    }
  }

  async function runUndo(undo) {
    setBulkFlash(null);
    try {
      const res = await undoBulkReview(undo.scope, undo.ids);
      invalidateFlagCaches(qc);
      showBulkFlash({ text: `${res.deleted ?? 0} reopened` }, 4000);
    } catch (err) {
      showBulkFlash({ text: err?.message || 'Undo failed.', error: true });
    }
  }

  // Brief confirmation after a review; refresh this screen + the map flag layer.
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  function onReviewed(review) {
    setFlash(`Flag ${FLASH_LABEL[review?.status] || 'updated'}`);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2500);
    // Also mark the mock-GPS nudge counts stale (campaign cards / audit tile / More row
    // via ['admin','campaigns']; Overview pills via the campaign-rollup keys).
    qc.invalidateQueries({
      predicate: (query) =>
        query.queryKey?.[0] === 'admin' &&
        (query.queryKey?.[1] === 'flags' ||
          query.queryKey?.[1] === 'flags-map' ||
          query.queryKey?.[1] === 'campaigns' ||
          (query.queryKey?.[1] === 'reports' && query.queryKey?.[2] === 'campaign-rollup')),
    });
  }

  // Both toasts sit at the same height: clear of the tab bar normally, clear of the bulk bar while
  // selection mode is up (an error flash can coexist with the bar).
  const flashBottom = selectMode ? FLASH_OVER_BULK_BAR : spacing.md;

  // Total is the group's hero; Open leads the rows and gets the caution chip when nonzero
  // (the only judgment call on this screen — everything else is a plain count by flag type).
  const rateColors = makeRateColors(colors);
  const flagRows = [
    { label: 'Open', value: (totals.open || 0).toLocaleString(), sub: 'Need review', caution: totals.open > 0 },
    { label: 'Mock GPS', value: (totals.mockGps || 0).toLocaleString(), sub: 'Mock provider' },
    { label: 'Far', value: (totals.far || 0).toLocaleString(), sub: 'From house' },
    { label: 'Rapid', value: (totals.rapid || 0).toLocaleString(), sub: 'Too fast' },
    { label: 'One-spot', value: (totals.oneSpot || 0).toLocaleString(), sub: 'One place' },
    { label: 'Weak GPS', value: (totals.weakGps || 0).toLocaleString(), sub: 'Unreliable' },
  ];

  const canvasserTabs = useMemo(() => {
    const tabs = [
      { key: '', label: 'All' },
      ...byCanvasser.map((c) => ({ key: String(c.userId), label: `${c.name || 'Canvasser'} (${c.openCount || 0})` })),
    ];
    // Keep the picked canvasser on screen even when this scope has no flags for them, so the
    // strip can never unmount while a userId filter is still applied. See `pickedName`.
    if (userId && !tabs.some((t) => t.key === userId)) {
      tabs.push({ key: userId, label: `${pickedName || 'Canvasser'} (0)` });
    }
    return tabs;
  }, [byCanvasser, userId, pickedName]);

  const onCanvasserChange = (key) => {
    setUserId(key);
    setPickedName(key ? byCanvasser.find((c) => String(c.userId) === key)?.name || null : null);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>GPS audit</Text>
        {/* Same width as the back button so the title stays centered; the (i) opens the
            flag-type legend. */}
        <View style={{ width: 80, alignItems: 'flex-end' }}>
          <FlagLegendHint />
        </View>
      </View>
      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>

      <DateRangeBar value={range} onChange={onRangeChange} tz={tz} presets={AUDIT_PRESETS} />

      <View style={styles.controls}>
        <TabSwitcher tabs={STATUS_TABS} activeKey={reviewStatus} onChange={setReviewStatus} />
        {includesToday ? (
          <LiveStatus
            live={live}
            onToggle={() => setLive((v) => !v)}
            isFetching={q.isFetching}
            updatedAt={q.dataUpdatedAt}
            onRefresh={() => q.refetch()}
          />
        ) : null}
      </View>

      {/* Walk-list filter (server-side effortId, like Timeline's) — scopes the KPI totals,
          the by-canvasser tabs, and the entries list alike. Lives in the fixed filter area
          so picking an empty walk list is never a dead end. */}
      {efforts.length > 1 ? (
        <TabSwitcher
          tabs={[
            { key: '', label: 'All walk lists' },
            ...efforts.map((ef) => ({ key: String(ef._id), label: ef.name })),
          ]}
          activeKey={effortId}
          onChange={setEffortId}
        />
      ) : null}
      {/* Canvasser filter — fixed area for the same reason, and gated on the tab list rather than
          on `byCanvasser`: the payload it comes from is already ?userId-filtered, so gating on it
          hid the pill that could clear it. `canvasserTabs` always carries the picked person. */}
      {canvasserTabs.length > 1 ? (
        <TabSwitcher tabs={canvasserTabs} activeKey={userId} onChange={onCanvasserChange} />
      ) : null}

      {rangeInvalid ? (
        <View style={styles.groupWrap}>
          <InsetGroup>
            <InsetNoteRow>
              That range won't work — pick a range spanning at most {AUDIT_MAX_DAYS} days.
            </InsetNoteRow>
          </InsetGroup>
        </View>
      ) : q.isError && !q.data ? (
        <View style={styles.groupWrap}>
          <InsetGroup>
            <InsetNoteRow>
              Couldn't load the audit — {q.error?.message || 'check your connection and try again.'}
            </InsetNoteRow>
            <InsetActionRow label="Try again" onPress={() => q.refetch()} />
          </InsetGroup>
        </View>
      ) : q.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: selectMode ? 260 : spacing.xxl }}>
          <View style={styles.groupWrap}>
            <InsetGroup>
              <InsetHeroRow
                label="Total"
                value={(totals.flaggedActions || 0).toLocaleString()}
                sub={rangeLabel}
              />
              {flagRows.map((r) => (
                <InsetRow
                  key={r.label}
                  label={r.label}
                  value={r.value}
                  sub={r.sub}
                  chipColors={r.caution ? rateColors.caution : null}
                />
              ))}
            </InsetGroup>
          </View>

          <View style={styles.listWrap}>
            {entries.length > 0 ? (
              <View style={styles.selectRow}>
                {selectMode ? (
                  <>
                    <Pressable
                      onPress={() =>
                        setSelectedIds(allSelected ? new Set() : new Set(entries.map((e) => e.actionId)))
                      }
                      hitSlop={8}
                    >
                      <Text style={styles.selectRowAction}>
                        {allSelected ? 'Deselect all' : `Select all (${entries.length})`}
                      </Text>
                    </Pressable>
                    <Pressable onPress={exitSelectMode} hitSlop={8}>
                      <Text style={styles.selectRowAction}>Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable onPress={() => enterSelectMode()} hitSlop={8}>
                    <Text style={styles.selectRowAction}>Select</Text>
                  </Pressable>
                )}
              </View>
            ) : null}
            <InsetGroup>
              {entries.length === 0 ? (
                <InsetNoteRow>
                  {reviewStatus === 'open'
                    ? 'No flagged entries — nothing needs review for this range.'
                    : `No ${reviewStatus === 'all' ? '' : reviewStatus + ' '}flags in this range.`}
                </InsetNoteRow>
              ) : (
                entries.map((e) => (
                  <FlaggedEntryCard
                    key={e.actionId}
                    bare
                    entry={e}
                    tz={tz}
                    onReviewed={onReviewed}
                    selectable={selectMode}
                    selected={selectedIds.has(e.actionId)}
                    onToggleSelect={toggleSelect}
                    onLongPress={selectMode ? undefined : () => enterSelectMode(e.actionId)}
                    // "View on map" (item D4) — the web audit has this per entry; the map turns
                    // its flag layer on, selects this entry, and flies to its GPS point.
                    onViewOnMap={(entry) =>
                      router.push(
                        `/(app)/admin/map?flag=1&focusActivityId=${entry.actionId}&focusAt=${Date.now()}`
                      )
                    }
                  />
                ))
              )}
            </InsetGroup>
            {data.total > entries.length ? (
              <GroupFooter>
                Showing {entries.length} of {data.total} — narrow the range or filters to see the rest.
              </GroupFooter>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* Bulk bar, docked to the bottom edge above the tab bar. */}
      {selectMode ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.bulkBarWrap}
          pointerEvents="box-none"
        >
          <View style={styles.bulkBar}>
            <View style={styles.bulkHeaderRow}>
              <Text style={styles.bulkCount}>
                {scopeWide ? 'All flags matching the filters' : `${selectedIds.size} selected`}
              </Text>
              {data.total > entries.length || scopeWide ? (
                <Pressable onPress={() => setScopeWide((v) => !v)} hitSlop={6}>
                  <Text style={styles.bulkSwitch}>
                    {scopeWide ? 'Back to selected only' : 'Act on all matching instead'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <TextInput
              value={bulkNote}
              onChangeText={setBulkNote}
              placeholder="Add a shared note (optional)…"
              placeholderTextColor={colors.textMuted}
              style={styles.bulkNote}
            />
            <View style={styles.bulkBtnRow}>
              {BULK_ACTIONS.filter((a) => !a.reopenOnly || reviewStatus !== 'open').map((a) => {
                const disabled = !!bulkBusy || (!scopeWide && selectedIds.size === 0);
                return (
                  <Pressable
                    key={a.status}
                    disabled={disabled}
                    onPress={() => requestBulk(a)}
                    style={[styles.bulkBtn, a.danger && styles.bulkBtnDanger, disabled && styles.bulkBtnDisabled]}
                  >
                    <Text style={[styles.bulkBtnText, a.danger && styles.bulkBtnTextDanger]}>
                      {bulkBusy === a.status ? 'Saving…' : a.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : null}

      {bulkFlash ? (
        <Pressable
          style={[styles.flash, { bottom: flashBottom }]}
          onPress={() => bulkFlash.undo && runUndo(bulkFlash.undo)}
          disabled={!bulkFlash.undo}
        >
          <Text style={styles.flashText}>
            {bulkFlash.error ? '' : '✓ '}
            {bulkFlash.text}
            {bulkFlash.undo ? '  ·  Undo' : ''}
          </Text>
        </Pressable>
      ) : null}
      {flash ? (
        <View style={[styles.flash, { bottom: flashBottom }]} pointerEvents="none">
          <Text style={styles.flashText}>✓ {flash}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
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
    chipWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    controls: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs },
    groupWrap: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
    listWrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm },
    selectRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.lg,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    selectRowAction: { fontSize: 13, fontWeight: '700', color: colors.brand },
    // `bottom` is set inline (the tab-bar inset), which also carries the home-indicator clearance
    // this bar used to hand-roll as an oversized paddingBottom.
    bulkBarWrap: { position: 'absolute', left: 0, right: 0 },
    bulkBar: {
      backgroundColor: colors.card,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.md,
      gap: spacing.sm,
    },
    bulkHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    bulkCount: { ...type.bodyStrong, fontSize: 14 },
    bulkSwitch: { fontSize: 12, fontWeight: '700', color: colors.brand },
    // Note input + buttons mirror FlagReviewControl's styling so bulk and single review read
    // as the same instrument.
    bulkNote: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      color: colors.textPrimary,
      fontSize: 14,
      minHeight: 40,
    },
    bulkBtnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
    bulkBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    bulkBtnDanger: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
    bulkBtnDisabled: { opacity: 0.5 },
    bulkBtnText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
    bulkBtnTextDanger: { color: colors.danger },
    // `bottom` is set inline (flashBottom) — it depends on the tab-bar inset and the bulk bar.
    flash: {
      position: 'absolute',
      alignSelf: 'center',
      backgroundColor: colors.textPrimary,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    flashText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
  });
}
