import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { downloadArtifact } from '../../../lib/artifactDownload';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { deviceTimezone } from '../../../lib/dateRanges';
import { spacing, radius } from '../../../lib/theme';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import { mergeTypeMeta } from '../../../lib/exportTypes';
import CampaignChip from '../../../components/CampaignChip';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import SectionHeader from '../../../components/SectionHeader';
import ExportSheet from '../../../components/ExportSheet';
import InsetGroup, {
  InsetNavRow,
  InsetNoteRow,
  GroupFooter,
  RowEmoji,
} from '../../../components/InsetGroup';

// Mobile Export Center. Tapping a type opens ExportSheet — what one row is, what's in the
// file, per-type filters, and a live row-count estimate — and only the sheet's button
// queues. The campaign's export history lists below, polls while a job builds, and a
// completed file downloads TO DISK (lib/artifactDownload — binary-safe, memory-flat) and
// opens the share sheet. The 4-type scope is the owner's decision: detailed survey answers,
// filtered voters, voter notes and the full-backup ZIP stay on the web dashboard. Works
// during the read-only wind-down: creating an export (and its estimate) are the writes the
// entitlement gate allows.
//
// Type copy comes from lib/exportTypes: local fallback strings, overlaid by the server
// registry via GET /admin/exports/types when it responds — the pickers cannot drift.
const TYPE_LABEL = {
  'canvass-activity': 'Canvassing activity',
  'doors-by-round': 'Doors by round',
  'survey-results': 'Survey results',
  'survey-answers': 'Survey answers',
  'voter-file': 'Voter file',
  'voters-filtered': 'Filtered voters',
  'voter-notes': 'Voter profile notes',
  notes: 'Notes',
  'full-backup': 'Full backup',
};
const STATUS_LABEL = {
  pending: 'Queued',
  running: 'Building',
  completed: 'Ready',
  failed: 'Failed',
  canceled: 'Canceled',
  expired: 'Expired',
};

const fmtBytes = (n) => {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const daysLeft = (expiresAt) =>
  expiresAt == null ? null : Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));

// Any wire key besides the server-stamped anchorTz means the file was narrowed — two
// same-type rows are otherwise indistinguishable in the history.
const isFiltered = (job) => Object.keys(job.params || {}).some((k) => k !== 'anchorTz');

export default function AdminExports() {
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();
  const qc = useQueryClient();
  const poll = useFocusedPoll();
  const [campaign, setCampaign] = useState(undefined);
  const [busyId, setBusyId] = useState(null);
  const [sheetType, setSheetType] = useState(null);

  // Hidden Tabs screen stays mounted — re-sync the active campaign on focus (notes.jsx pattern).
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );
  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone || deviceTimezone();

  // The sheet's filters are campaign-scoped state — close it if the campaign changes under it.
  const [prevCid, setPrevCid] = useState(cId);
  if (prevCid !== cId) {
    setPrevCid(cId);
    setSheetType(null);
  }

  // Server registry copy overlaid on the local fallback (older server → 404 → fallback).
  const typesQ = useQuery({
    queryKey: ['admin', 'export-types'],
    queryFn: () => api('/admin/exports/types'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const typeMeta = mergeTypeMeta(typesQ.data?.types);
  const sheetMeta = sheetType ? typeMeta.find((t) => t.id === sheetType) : null;

  const listQ = useQuery({
    queryKey: ['admin', 'exports', cId],
    queryFn: () => api(`/admin/exports?campaignId=${cId}&limit=20`),
    enabled: !!cId,
    ...poll,
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs || [];
      return jobs.some((j) => ['pending', 'running'].includes(j.status)) ? 2000 : false;
    },
  });
  const jobs = listQ.data?.jobs || [];

  // The web page's worker banner: exports build on the worker dyno, and a queued job with
  // no worker looks stuck — say so instead. `online === false` strictly; an errored status
  // request shows nothing.
  const workerQ = useQuery({
    queryKey: ['admin', 'exports', 'worker-status'],
    queryFn: () => api('/admin/exports/worker-status'),
    refetchInterval: 15000,
    ...useFocusedPoll(),
  });
  const workerOffline = workerQ.data?.online === false;

  const createMut = useMutation({
    mutationFn: ({ type, campaignId, params }) =>
      api('/admin/exports', {
        method: 'POST',
        body: { type, ...(campaignId ? { campaignId: String(campaignId) } : {}), params: params || {} },
      }),
    onSuccess: () => {
      // The new row appearing at the top of Recent exports (and the 2s poll animating it
      // Queued → Building → Ready) IS the confirmation — the app has no toast layer.
      setSheetType(null);
      qc.invalidateQueries({ queryKey: ['admin', 'exports', cId] });
    },
    onError: (err) => {
      if (err?.data?.code === 'export-throttled') {
        Alert.alert('Export limit reached', err.message);
        return;
      }
      Alert.alert('Could not queue the export', err?.message || 'Try again in a moment.');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (jobId) => api(`/admin/exports/${jobId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'exports', cId] }),
    onError: (err) => Alert.alert('Could not delete the export', err?.message || 'Try again in a moment.'),
  });

  const requeue = (job) =>
    createMut.mutate({ type: job.type, campaignId: job.campaignId, params: job.params || {} });

  const confirmDelete = (job) =>
    Alert.alert('Delete this export?', 'A copy you already downloaded is unaffected.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate(job._id) },
    ]);

  async function onRowPress(job) {
    if (job.status === 'completed') {
      const dl = daysLeft(job.expiresAt);
      if (dl === 0) {
        Alert.alert('Expired', 'This export has expired — queue a fresh one.');
        return;
      }
      setBusyId(job._id);
      try {
        await downloadArtifact(
          `/admin/exports/${job._id}/download`,
          job.artifact?.filename || `${job.type}.csv`,
          job.artifact?.contentType === 'application/zip' ? 'application/zip' : 'text/csv'
        );
      } catch {
        // downloadArtifact already alerted
      } finally {
        setBusyId(null);
      }
      return;
    }
    if (job.status === 'failed') {
      Alert.alert('Export failed', job.error || 'Try queueing it again.', [
        { text: 'Retry', onPress: () => requeue(job) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(job) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    if (job.status === 'expired') {
      Alert.alert('Expired', 'This export has expired — queue a fresh one.', [
        { text: 'Queue again', onPress: () => requeue(job) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(job) },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Alert.alert('Still building', 'This export is still being built — it will be ready shortly.');
  }

  // A completed row's tap must stay download, so delete rides on long-press (the audit.jsx
  // row-accelerator precedent). Running jobs can't be deleted (server 409s anyway).
  function onRowLongPress(job) {
    if (job.status === 'running') return;
    confirmDelete(job);
  }

  const jobSub = (job) => {
    const bits = [new Date(job.createdAt).toLocaleDateString()];
    if (isFiltered(job)) bits.push('filtered');
    if (job.rowCount) bits.push(`${job.rowCount} rows`);
    if (job.bytes) bits.push(fmtBytes(job.bytes));
    if (job.status === 'completed') {
      const dl = daysLeft(job.expiresAt);
      if (dl != null) bits.push(dl > 0 ? `expires in ${dl}d` : 'expired');
    }
    if (job.excludedDncCount > 0) bits.push(`${job.excludedDncCount} withheld (DNC)`);
    return bits.join(' · ');
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Exports</Text>
        <View style={{ width: 80 }} />
      </View>
      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>
      <ArchivedCampaignBanner campaignId={cId} extra="Exports still work — this campaign's data stays downloadable." style={styles.bannerWrap} />

      {workerOffline ? (
        <View style={styles.workerBanner}>
          <Text style={styles.workerBannerText}>
            Exports are built in the background, and the background worker looks offline right
            now — your export will start as soon as it returns.
          </Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={listQ.isRefetching} onRefresh={() => listQ.refetch()} />}
      >
        <SectionHeader caption title="Queue an export" />
        <InsetGroup>
          {typeMeta.map((t) => (
            <InsetNavRow
              key={t.id}
              emphasis="menu"
              leading={<RowEmoji>{t.emoji}</RowEmoji>}
              label={t.label}
              sub={t.sub}
              disabled={!cId}
              hint="Shows what's in this file and lets you filter it before queueing"
              onPress={() => setSheetType(t.id)}
            />
          ))}
        </InsetGroup>
        <GroupFooter>
          Tap a type to see what&apos;s in the file, set filters, and queue it. Exports build in
          the background — the list below updates as each finishes. Detailed survey answers,
          filtered voters, voter profile notes and the full-backup ZIP are on the web dashboard.
          A Notes export is queued from the Notes screen, with the filters you have on screen.
        </GroupFooter>

        <SectionHeader caption title="Recent exports" />
        <InsetGroup>
          {listQ.isLoading ? (
            <InsetNoteRow loading>Loading…</InsetNoteRow>
          ) : jobs.length === 0 ? (
            <InsetNoteRow>No exports yet — queue one above.</InsetNoteRow>
          ) : (
            jobs.map((job) => (
              <InsetNavRow
                key={job._id}
                label={TYPE_LABEL[job.type] || job.type}
                sub={jobSub(job)}
                value={
                  busyId === job._id
                    ? 'Downloading…'
                    : `${STATUS_LABEL[job.status] || job.status}${
                        job.status === 'running' && job.progress ? ` ${job.progress}%` : ''
                      }`
                }
                hint={job.status === 'completed' ? 'Downloads and opens the share sheet' : undefined}
                disabled={busyId === job._id}
                onPress={() => onRowPress(job)}
                onLongPress={() => onRowLongPress(job)}
              />
            ))
          )}
        </InsetGroup>
        <GroupFooter>
          Files are kept for 7 days, then deleted automatically. Touch and hold a row to delete
          it sooner.
        </GroupFooter>
      </ScrollView>

      {sheetMeta && cId ? (
        <ExportSheet
          meta={sheetMeta}
          campaignId={cId}
          tz={tz}
          queueing={createMut.isPending}
          onQueue={(params) => createMut.mutate({ type: sheetMeta.id, campaignId: cId, params })}
          onClose={() => setSheetType(null)}
        />
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
    bannerWrap: { marginHorizontal: spacing.lg },

    workerBanner: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.warnBg,
      borderWidth: 1,
      borderColor: colors.warnBorder,
      borderRadius: radius.md,
    },
    workerBannerText: { ...type.caption, color: colors.warnFg },
  });
}
