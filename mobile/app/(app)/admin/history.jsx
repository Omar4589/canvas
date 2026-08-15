import { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import CampaignChip from '../../../components/CampaignChip';
import ArchivedCampaignBanner from '../../../components/ArchivedCampaignBanner';
import { loadActiveCampaign } from '../../../lib/cache';
import { formatInTz } from '../../../lib/datetime';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import {
  labelForField,
  formatValue,
  isNotable,
  teamMoveSummary,
  actorLabel,
} from '../../../lib/campaignHistory';
import InsetGroup, {
  InsetRow,
  InsetNoteRow,
  InsetActionRow,
  GroupFooter,
} from '../../../components/InsetGroup';

// Who changed what on this campaign — the mobile twin of the web CampaignHistoryDrawer.
//
// Read-only view of GET /admin/campaigns/:campaignId/history, which merges two write-side records:
// CampaignChange (configuration edits — the door goal, the key dates, the invoice policy,
// archiving) and CoordinatorChange (team reassignments, which move doors between teams without
// anyone knocking one).
//
// The rows are INERT — both kinds are plain InsetRow, never InsetNavRow, because there is nothing
// behind them to open (InsetGroup's three-kinds rule). All the words come from
// lib/campaignHistory.js, hand-mirrored with the web copy.

// One feed row. `kind` decides the sentence, never the row KIND — see above.
function historyRow(item, tz, colors) {
  const when = formatInTz(item.at, tz);
  const who = actorLabel(item.by);
  // InsetGroup rows have no per-row background hook, so the web drawer's warn-tinted left border
  // becomes a badge here. warnFg on warnBg — a raw hue is ~3:1 on card at this size.
  const badge = isNotable(item)
    ? { text: 'review', bg: colors.warnBg, fg: colors.warnFg }
    : null;

  if (item.kind === 'team') {
    const { headline, detail } = teamMoveSummary(item);
    return (
      <InsetRow
        key={item.id}
        label="Team"
        labelLines={2}
        badge={item.restampError ? { text: 'incomplete' } : badge}
        value={null}
        sub={[
          headline,
          detail,
          item.restampError
            ? 'The team changed but moving their past doors failed — by-team numbers may not add up until it is re-run.'
            : null,
          `${who} · ${when}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
    );
  }

  return (
    <InsetRow
      key={item.id}
      label={labelForField(item.field)}
      labelLines={2}
      badge={badge}
      value={formatValue(item.field, item.toValue)}
      sub={`from ${formatValue(item.field, item.fromValue)} · ${who} · ${when}`}
    />
  );
}

export default function AdminCampaignHistory() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();

  // Campaign scoping via CampaignChip, re-synced on focus — the same shape Overlaps/Notes use.
  // undefined = the focus read hasn't landed; null = nothing selected.
  const [campaign, setCampaign] = useState(undefined);
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id ? String(campaign.id) : null;
  const tz = campaign?.timeZone;

  // Same query key as the web drawer, so the two clients describe the same cache entry.
  const historyQ = useQuery({
    queryKey: ['admin', 'campaign-history', cId],
    queryFn: () => api(`/admin/campaigns/${cId}/history`),
    enabled: !!cId,
  });

  const items = historyQ.data?.items || [];
  const { refreshing, onRefresh } = useRefresh([historyQ.refetch]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>History</Text>
        <View style={{ width: 80 }} />
      </View>

      <View style={styles.chipWrap}>
        <CampaignChip value={campaign} onChange={setCampaign} />
      </View>
      <ArchivedCampaignBanner campaignId={cId} style={styles.bannerWrap} />

      <Text style={styles.intro}>
        Settings changes and team moves, newest first.
      </Text>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {campaign === undefined ? (
          <InsetGroup>
            <InsetNoteRow loading />
          </InsetGroup>
        ) : campaign === null ? (
          <InsetGroup>
            <InsetNoteRow>No campaign selected — pick one from the chip above.</InsetNoteRow>
          </InsetGroup>
        ) : historyQ.error ? (
          <InsetGroup>
            {/* A 403 is a legitimate state here: a lead reading a campaign they don't manage. */}
            <InsetNoteRow>Couldn&apos;t load the history: {historyQ.error.message}</InsetNoteRow>
            <InsetActionRow label="Try again" onPress={() => historyQ.refetch()} />
          </InsetGroup>
        ) : historyQ.isLoading ? (
          <InsetGroup>
            <InsetNoteRow loading />
          </InsetGroup>
        ) : (
          <>
            <InsetGroup>
              {items.length === 0 ? (
                <InsetNoteRow>
                  Nothing has been changed since this campaign was created.
                </InsetNoteRow>
              ) : (
                items.map((it) => historyRow(it, tz, colors))
              )}
              {/* The campaign's own birth anchors the bottom, so a campaign nobody has edited
                  reads as a timeline with one entry rather than an empty box. */}
              <InsetRow
                label="Campaign created"
                sub={`${actorLabel(historyQ.data?.createdBy)} · ${formatInTz(historyQ.data?.createdAt, tz)}`}
              />
            </InsetGroup>
            <GroupFooter>
              {historyQ.data?.truncated
                ? 'Showing the most recent changes only — this campaign has more history than fits here. '
                : ''}
              Knock-by-knock activity is on the Timeline; GPS quality flags are on Audit.
            </GroupFooter>
          </>
        )}
      </ScrollView>
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

    intro: {
      ...type.caption,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
  });
}
