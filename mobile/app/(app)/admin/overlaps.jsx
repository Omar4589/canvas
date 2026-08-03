import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { useRefresh } from '../../../lib/useRefresh';
import { useAdminCampaign } from '../../../lib/useAdminCampaign';
import { PRESETS, rangeFor } from '../../../lib/dateRanges';
import { timeAgo } from '../../../lib/datetime';
import { spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';
import { useConsoleRoleLabel } from '../../../lib/useConsoleRole';
import TabSwitcher from '../../../components/TabSwitcher';
import InsetGroup, {
  InsetHeroRow,
  InsetNavRow,
  InsetNoteRow,
  InsetActionRow,
  GroupFooter,
} from '../../../components/InsetGroup';

// 'custom' needs the from/to pickers this screen doesn't have; every other preset applies.
const OVERLAP_PRESETS = PRESETS.filter((p) => p.key !== 'custom');

// The most recent knock across every pass on the door — the "latest ⏱" in the row's sub.
function latestAt(o) {
  let max = null;
  for (const p of o.passes || []) {
    for (const c of p.canvassers || []) {
      if (c.lastAt && (!max || c.lastAt > max)) max = c.lastAt;
    }
  }
  return max;
}

export default function AdminOverlaps() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const roleLabel = useConsoleRoleLabel();
  const router = useRouter();
  const params = useLocalSearchParams();
  const [preset, setPreset] = useState(
    typeof params.preset === 'string' ? params.preset : 'today'
  );

  // VALIDATED campaign context (focus-resynced): the raw cache can hold a campaign a team
  // lead doesn't manage — the hook checks it against the lead-filtered /admin/campaigns
  // list and returns null instead of leaking an unmanaged campaign's context here.
  const campaign = useAdminCampaign();

  const cId = campaign?.id;
  // Anchor presets to the campaign's tz; the query is already gated on cId (campaign loaded),
  // so it never fetches a device-tz window.
  const range = useMemo(() => rangeFor(preset, null, campaign?.timeZone), [preset, campaign?.timeZone]);

  // The ANCHORED endpoint, deliberately not the date-windowed /overlaps this screen used to read.
  // Windowed detection only fires when BOTH knocks fall inside the range — so on the default
  // "Today" it stayed silent about a door knocked last week and again this morning, which is the
  // single case this screen exists to catch. Anchoring detects across the whole pass and surfaces
  // the collision because one knock is in view, naming the earlier one.
  const overlapsQ = useQuery({
    queryKey: ['admin', 'reports', 'overlap-doors', cId, range.from, range.to],
    queryFn: () => {
      const p = new URLSearchParams();
      if (cId) p.set('campaignId', cId);
      if (range.from) p.set('from', range.from);
      if (range.to) p.set('to', range.to);
      return api(`/admin/reports/overlap-doors?${p.toString()}`);
    },
    enabled: !!cId,
  });

  const overlaps = overlapsQ.data?.doors || [];
  const outOfRange = overlapsQ.data?.outOfRangeTotal || 0;
  const { refreshing, onRefresh } = useRefresh([overlapsQ.refetch]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ {roleLabel}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Overlaps</Text>
        <View style={{ width: 80 }} />
      </View>

      <Text style={styles.intro}>
        Houses knocked by 2+ canvassers within the same pass.
      </Text>

      <TabSwitcher tabs={OVERLAP_PRESETS} activeKey={preset} onChange={setPreset} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
        }
      >
        {campaign === null ? (
          <InsetGroup>
            <InsetNoteRow>
              No campaign selected — pick a campaign you manage from the Overview, then come back here.
            </InsetNoteRow>
          </InsetGroup>
        ) : overlapsQ.error ? (
          <InsetGroup>
            <InsetNoteRow>Couldn't load overlaps: {overlapsQ.error.message}</InsetNoteRow>
            <InsetActionRow label="Try again" onPress={() => overlapsQ.refetch()} />
          </InsetGroup>
        ) : overlapsQ.isLoading ? (
          <InsetGroup>
            <InsetNoteRow loading />
          </InsetGroup>
        ) : overlaps.length === 0 ? (
          <InsetGroup>
            <InsetNoteRow>
              No overlap 🎉 — every house in this range was visited by at most one canvasser.
              {outOfRange > 0 ? ` ${outOfRange} more sit outside your dates — widen the range to see them.` : ''}
            </InsetNoteRow>
          </InsetGroup>
        ) : (
          <>
            <View style={styles.summaryWrap}>
              <InsetGroup>
                <InsetHeroRow
                  label={overlaps.length === 1 ? 'House with overlap' : 'Houses with overlap'}
                  value={overlaps.length.toLocaleString()}
                />
              </InsetGroup>
              {outOfRange > 0 ? (
                <GroupFooter>
                  +{outOfRange} more outside your dates — widen the range to see them.
                </GroupFooter>
              ) : null}
            </View>

            {/* One summary row per house — who/when per pass lives on the drill-in, which
                renders instantly because the whole entry threads through params (item D14). */}
            <InsetGroup>
              {overlaps.map((o) => {
                const latest = latestAt(o);
                const passCount = (o.passes || []).length;
                const owCount = (o.passes || []).reduce((n, p) => n + (p.overwrites?.length || 0), 0);
                return (
                  <InsetNavRow
                    key={o.householdId}
                    label={
                      o.household
                        ? `${o.household.addressLine1}${o.household.addressLine2 ? `, ${o.household.addressLine2}` : ''}`
                        : 'Address unavailable'
                    }
                    unit={
                      o.household
                        ? `${o.household.city}, ${o.household.state} ${o.household.zipCode}`
                        : null
                    }
                    sub={[
                      `${o.totalCanvassers} canvassers`,
                      `${passCount} ${passCount === 1 ? 'pass' : 'passes'}`,
                      owCount ? `${owCount} survey${owCount === 1 ? '' : 's'} overwritten` : null,
                      latest ? `latest ${timeAgo(latest)}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    // Overlap is a fact to review, not an error — brand tint, with brandDark
                    // for the small text (raw brand on brandTint is 4.41:1 and fails).
                    badge={{
                      text: String(o.totalCanvassers),
                      bg: colors.brandTint,
                      fg: colors.brandDark,
                    }}
                    hint="Opens this house's overlap detail"
                    onPress={() =>
                      router.push({
                        pathname: `/(app)/admin/overlap/${o.householdId}`,
                        params: {
                          data: JSON.stringify(o),
                          campaignId: cId,
                          tz: campaign?.timeZone || '',
                        },
                      })
                    }
                  />
                );
              })}
            </InsetGroup>
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

    intro: {
      ...type.caption,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },

    summaryWrap: { marginBottom: spacing.md },
  });
}
