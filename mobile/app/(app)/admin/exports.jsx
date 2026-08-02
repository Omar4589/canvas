import { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { downloadArtifact } from '../../../lib/artifactDownload';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { spacing } from '../../../lib/theme';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import CampaignChip from '../../../components/CampaignChip';
import SectionHeader from '../../../components/SectionHeader';
import InsetGroup, {
  InsetNavRow,
  InsetActionRow,
  InsetNoteRow,
  GroupFooter,
  RowEmoji,
} from '../../../components/InsetGroup';

// Mobile Export Center — view + download + one-tap queue (owner scope decision 2026-08-01).
// The campaign's export history lists here, polls while a job builds, and a completed file
// downloads TO DISK (lib/artifactDownload — binary-safe, memory-flat) and opens the share
// sheet. Queueing covers the simple no-filter types; filters, voter-notes, and the
// full-backup ZIP live on the web dashboard (the CSV-upload precedent). Works during the
// read-only wind-down: creating an export is the one write the entitlement gate allows.

// Same labels as the web page's TYPES — the two pickers must not drift.
const QUEUEABLE = [
  { id: 'canvass-activity', emoji: '🚪', label: 'Canvassing activity', sub: 'Every door result, with the voter at that door' },
  { id: 'doors-by-round', emoji: '🔁', label: 'Doors by round', sub: 'One row per door per round, with its status' },
  { id: 'survey-results', emoji: '📊', label: 'Survey results', sub: 'One row per survey taken, one column per question' },
  { id: 'voter-file', emoji: '🗂️', label: 'Voter file', sub: 'Everyone currently in the campaign' },
];
const TYPE_LABEL = {
  'canvass-activity': 'Canvassing activity',
  'doors-by-round': 'Doors by round',
  'survey-results': 'Survey results',
  'survey-answers': 'Survey answers',
  'voter-file': 'Voter file',
  'voters-filtered': 'Filtered voters',
  'voter-notes': 'Voter notes',
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

export default function AdminExports() {
  const styles = useThemedStyles(makeStyles);
  const qc = useQueryClient();
  const poll = useFocusedPoll();
  const [campaign, setCampaign] = useState(undefined);
  const [busyId, setBusyId] = useState(null);

  // Hidden Tabs screen stays mounted — re-sync the active campaign on focus (notes.jsx pattern).
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );
  const cId = campaign?.id ? String(campaign.id) : null;

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

  const createMut = useMutation({
    mutationFn: (type) => api('/admin/exports', { method: 'POST', body: { type, campaignId: cId, params: {} } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'exports', cId] }),
    onError: (err) => Alert.alert('Could not queue the export', err?.message || 'Try again in a moment.'),
  });

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
      Alert.alert('Export failed', job.error || 'Try queueing it again.');
      return;
    }
    if (job.status === 'expired') {
      Alert.alert('Expired', 'This export has expired — queue a fresh one.');
      return;
    }
    Alert.alert('Still building', 'This export is still being built — it will be ready shortly.');
  }

  const jobSub = (job) => {
    const bits = [new Date(job.createdAt).toLocaleDateString()];
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
        <Text style={styles.headerLabel}>Exports</Text>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={listQ.isRefetching} onRefresh={() => listQ.refetch()} />}
      >
        <SectionHeader caption title="Queue an export" />
        <InsetGroup>
          {QUEUEABLE.map((t) => (
            <InsetActionRow
              key={t.id}
              leading={<RowEmoji>{t.emoji}</RowEmoji>}
              label={t.label}
              disabled={!cId || createMut.isPending}
              onPress={() => createMut.mutate(t.id)}
            />
          ))}
        </InsetGroup>
        <GroupFooter>
          Built in the background — the list below updates as it finishes. Filters, voter notes and
          the full-backup ZIP are on the web dashboard. Do-not-contact voters are excluded from
          every export.
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
              />
            ))
          )}
        </InsetGroup>
        <GroupFooter>Files are kept for 7 days, then deleted automatically.</GroupFooter>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    headerLabel: { ...type.title, color: colors.fg },
  });
}
