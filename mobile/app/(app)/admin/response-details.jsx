import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../lib/api';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { initMapbox } from '../../../lib/mapbox';
import { useMapStyle } from '../../../lib/mapStyles';
import { formatExact, timeAgo } from '../../../lib/datetime';
import { formatDistance } from '../../../lib/geo';
import InsetGroup, {
  InsetRow,
  InsetTitleRow,
  InsetBlockRow,
  InsetNoteRow,
  InsetActionRow,
  GroupFooter,
} from '../../../components/InsetGroup';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { useCampaignArchived } from '../../../lib/useCampaignArchived';
import { useConsoleRole } from '../../../lib/useConsoleRole';
import { buildRestorePrompt } from '../../../lib/duplicateSurveys';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

initMapbox();

function one(p) {
  return Array.isArray(p) ? p[0] : p;
}

function answerText(a) {
  if (a == null) return '—';
  return Array.isArray(a) ? a.join(', ') : String(a);
}

// Full detail for one survey response — reached by tapping a row on the
// answer-drill list (answer-voters). Hidden tab, like its parent.
export default function ResponseDetails() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { styleURL } = useMapStyle();
  const params = useLocalSearchParams();
  const responseId = one(params.responseId);
  const campaignId = one(params.campaignId); // satisfies the lead report gate

  const q = useQuery({
    queryKey: ['admin', 'response-details', responseId],
    queryFn: () => api(`/admin/reports/responses/${responseId}?campaignId=${campaignId || ''}`),
    enabled: !!responseId,
  });

  // Campaign tz so the exact (to-the-second) timestamps read in the CAMPAIGN's
  // clock for every admin — shared cache with the screens that pushed here.
  const campaignsQ = useQuery({
    queryKey: ['admin', 'campaigns'],
    queryFn: () => api('/admin/campaigns'),
    staleTime: 60 * 1000,
  });
  const tz = (campaignsQ.data?.campaigns || []).find((c) => String(c._id) === String(campaignId))?.timeZone;

  const d = q.data;
  const hasPin = d?.household?.lng != null && d?.household?.lat != null;

  // Restore (archived responses only) is org-admin only — positive form: useConsoleRole is
  // undefined while resolving, and a lead must never see the button flash.
  const qc = useQueryClient();
  const viewerRole = useConsoleRole();
  // ...and gone entirely on an archived campaign: restoring writes a response back onto a
  // campaign whose records are read-only. Same positive form — false until the list resolves.
  const { canWrite } = useCampaignArchived(campaignId);
  const canRestore = (viewerRole === 'admin' || viewerRole === 'super') && canWrite;
  const restoreMut = useMutation({
    mutationFn: () =>
      api(`/admin/voters/${d.response.voterId}/surveys/${d.response.id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      // The restore moved the same caches a delete moves: this screen's own entry (the archive id
      // is consumed — a refetch would 404), the report, and the voter profile.
      qc.removeQueries({ queryKey: ['admin', 'response-details', d.response.id] });
      qc.invalidateQueries({ queryKey: ['admin', 'duplicate-surveys'] });
      qc.invalidateQueries({
        predicate: (query) => query.queryKey?.[0] === 'mobile' && query.queryKey?.[1] === 'voter',
      });
      Alert.alert('Restored', 'These answers are the current response again.');
      router.back();
    },
    onError: (err) =>
      Alert.alert(
        err?.status === 404 ? 'Already restored' : "Couldn't restore",
        err?.status === 404
          ? 'Someone else restored or removed this response. Pull to refresh the report.'
          : err?.message || 'Try again in a moment.'
      ),
  });
  const confirmRestore = () => {
    const prompt = buildRestorePrompt({
      voterName: d?.voter?.fullName,
      response: {
        canvasser: d?.canvasser,
        roundLabel: d?.round ? `Pass ${d.round.roundNumber}${d.round.name ? ` — ${d.round.name}` : ''}` : null,
        submittedAt: d?.response?.submittedAt,
      },
      formatTime: (at) => formatExact(at, tz),
    });
    Alert.alert(prompt.title, prompt.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: prompt.confirmText, onPress: () => restoreMut.mutate() },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>

      {q.isLoading ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <InsetGroup>
            <InsetNoteRow loading />
          </InsetGroup>
        </View>
      ) : q.error ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <InsetGroup>
            <InsetNoteRow>{q.error.message}</InsetNoteRow>
          </InsetGroup>
        </View>
      ) : !d ? null : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}>
          <Text style={styles.title} numberOfLines={2}>
            {d.voter?.fullName || 'Unknown voter'}
            {d.voter?.party ? <Text style={styles.titleParty}> · {d.voter.party}</Text> : null}
          </Text>
          <Text style={styles.subtitle}>
            {formatExact(d.response.submittedAt, tz)} · {timeAgo(d.response.submittedAt)}
          </Text>

          {/* Where — address + a non-interactive map dot */}
          <View style={styles.section}>
            <InsetGroup>
              <InsetTitleRow title="Home" />
              {d.household ? (
                <InsetRow
                  label={`${d.household.addressLine1}${d.household.addressLine2 ? `, ${d.household.addressLine2}` : ''}`}
                  sub={`${d.household.city}, ${d.household.state} ${d.household.zipCode}`}
                />
              ) : (
                <InsetNoteRow>Household unavailable</InsetNoteRow>
              )}
              {hasPin && MAPBOX_PUBLIC_TOKEN ? (
                <InsetBlockRow>
                  <View style={styles.mapWrap} pointerEvents="none">
                    <Mapbox.MapView
                      style={{ flex: 1 }}
                      styleURL={styleURL}
                      zoomEnabled={false}
                      scrollEnabled={false}
                      pitchEnabled={false}
                      rotateEnabled={false}
                      attributionEnabled={false}
                      logoEnabled={false}
                    >
                      <Mapbox.Camera
                        defaultSettings={{ centerCoordinate: [d.household.lng, d.household.lat], zoomLevel: 15.5 }}
                      />
                      <Mapbox.ShapeSource
                        id="response-home"
                        shape={{ type: 'Point', coordinates: [d.household.lng, d.household.lat] }}
                      >
                        <Mapbox.CircleLayer
                          id="response-home-dot"
                          style={{
                            circleRadius: 7,
                            circleColor: colors.status?.surveyed || colors.brand,
                            circleStrokeColor: '#FFFFFF',
                            circleStrokeWidth: 2,
                          }}
                        />
                      </Mapbox.ShapeSource>
                    </Mapbox.MapView>
                  </View>
                </InsetBlockRow>
              ) : null}
            </InsetGroup>
          </View>

          {/* Who + when */}
          <View style={styles.section}>
            <InsetGroup>
              <InsetTitleRow title="Interaction" />
              <InsetRow
                label="Canvasser"
                value={d.canvasser ? `${d.canvasser.firstName} ${d.canvasser.lastName || ''}`.trim() : '—'}
              />
              <InsetRow
                label="Round"
                value={d.round ? `Pass ${d.round.roundNumber}${d.round.name ? ` — ${d.round.name}` : ''}` : '—'}
              />
              <InsetRow label="Recorded" value={formatExact(d.response.submittedAt, tz)} />
              {d.response.wasOfflineSubmission && d.response.syncedAt ? (
                <InsetRow label="Synced" value={formatExact(d.response.syncedAt, tz)} />
              ) : null}
              {d.response.editedAt ? (
                <InsetRow
                  label="Edited by"
                  value={`${d.response.editedBy ? `${d.response.editedBy.firstName} ${d.response.editedBy.lastName || ''}`.trim() : 'Unknown'}`}
                  sub={formatExact(d.response.editedAt, tz)}
                />
              ) : null}
              {d.response.replacedEarlier ? (
                <InsetRow
                  label="Replaced"
                  value={
                    d.response.replacedEarlier.by
                      ? `${d.response.replacedEarlier.by.firstName} ${d.response.replacedEarlier.by.lastName || ''}`.trim()
                      : 'an earlier response'
                  }
                  sub={`earlier answers from ${formatExact(d.response.replacedEarlier.submittedAt, tz)} — preserved`}
                />
              ) : null}
              {d.response.archived ? (
                <InsetRow
                  /* An 'outcome_convert' row was removed by an ADMIN changing this door's outcome,
                     not overwritten by another canvasser — the default wording would read as an
                     accusation against the canvasser for something they did not do. */
                  label={d.response.overwrittenVia === 'outcome_convert' ? 'Removed by' : 'Overwritten by'}
                  value={
                    d.response.overwrittenBy
                      ? `${d.response.overwrittenBy.firstName} ${d.response.overwrittenBy.lastName || ''}`.trim()
                      : d.response.overwrittenVia === 'outcome_convert'
                        ? 'an admin'
                        : 'another canvasser'
                  }
                  sub={
                    d.response.overwrittenVia === 'outcome_convert'
                      ? `${formatExact(d.response.overwrittenAt, tz)} · the door's outcome was changed`
                      : formatExact(d.response.overwrittenAt, tz)
                  }
                  badge={{ text: d.response.overwrittenVia === 'outcome_convert' ? 'Removed' : 'Overwritten' }}
                />
              ) : null}
              {d.response.deskEntry ? (
                <InsetRow
                  label="Entered at a desk"
                  value={formatExact(d.response.deskEntry.at, tz)}
                  sub="Typed by an admin correcting this door's outcome, not collected at the door"
                  badge={{ text: 'Desk entered' }}
                />
              ) : null}
              {d.response.archived && canRestore ? (
                <InsetActionRow
                  label={restoreMut.isPending ? 'Restoring…' : 'Restore these answers…'}
                  disabled={restoreMut.isPending}
                  onPress={confirmRestore}
                />
              ) : null}
              <InsetRow
                label="Distance from home"
                value={d.response.distanceFromHouseMeters != null ? formatDistance(d.response.distanceFromHouseMeters) : '—'}
              />
            </InsetGroup>
            {d.response.archived ? (
              <GroupFooter>
                These answers were replaced at the door and are preserved here. Restoring swaps the
                two responses — nothing is deleted.
              </GroupFooter>
            ) : null}
            {d.response.wasOfflineSubmission ? (
              <GroupFooter>
                {d.response.syncedAt
                  ? `Recorded offline · synced ${timeAgo(d.response.syncedAt)}`
                  : 'Recorded offline · synced later'}
              </GroupFooter>
            ) : null}
          </View>

          {/* Answers — free text, so the copy lives in the sub line, never a value column */}
          <View style={styles.section}>
            <InsetGroup>
              <InsetTitleRow title="Answers" />
              {(d.response.answers || []).length === 0 ? (
                <InsetNoteRow>No answers recorded.</InsetNoteRow>
              ) : (
                d.response.answers.map((a, i) => (
                  <InsetRow
                    key={`${a.questionKey || i}`}
                    label={a.questionLabel || a.questionKey}
                    sub={answerText(a.answer)}
                  />
                ))
              )}
              {d.response.note ? <InsetRow label="Note" sub={d.response.note} /> : null}
            </InsetGroup>
          </View>

          {/* Voter extras */}
          {d.voter && (d.voter.gender || d.voter.precinct) ? (
            <View style={styles.section}>
              <InsetGroup>
                <InsetTitleRow title="Voter" />
                {d.voter.gender ? <InsetRow label="Gender" value={d.voter.gender} /> : null}
                {d.voter.precinct ? <InsetRow label="Precinct" value={d.voter.precinct} /> : null}
              </InsetGroup>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(t) {
  const { colors, type } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    back: { ...type.caption, color: colors.brand, fontWeight: '600' },
    title: { ...type.h2, marginTop: spacing.xs },
    titleParty: { color: colors.textSecondary, fontWeight: '400' },
    subtitle: { ...type.caption, marginBottom: spacing.md },
    section: { marginBottom: spacing.md },
    mapWrap: {
      height: 150,
      borderRadius: radius.md,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
}
