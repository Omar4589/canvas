import { View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
      </View>

      {q.isLoading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : q.error ? (
        <Text style={styles.muted}>{q.error.message}</Text>
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
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Home</Text>
            {d.household ? (
              <>
                <Text style={styles.bodyStrong}>
                  {d.household.addressLine1}
                  {d.household.addressLine2 ? `, ${d.household.addressLine2}` : ''}
                </Text>
                <Text style={styles.caption}>
                  {d.household.city}, {d.household.state} {d.household.zipCode}
                </Text>
              </>
            ) : (
              <Text style={styles.caption}>Household unavailable</Text>
            )}
            {hasPin && MAPBOX_PUBLIC_TOKEN ? (
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
            ) : null}
          </View>

          {/* Who + when */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Interaction</Text>
            <Row styles={styles} label="Canvasser">
              {d.canvasser ? `${d.canvasser.firstName} ${d.canvasser.lastName || ''}`.trim() : '—'}
            </Row>
            <Row styles={styles} label="Round">
              {d.round ? `Pass ${d.round.roundNumber}${d.round.name ? ` — ${d.round.name}` : ''}` : '—'}
            </Row>
            <Row styles={styles} label="Recorded">
              {formatExact(d.response.submittedAt, tz)}
            </Row>
            {d.response.wasOfflineSubmission && d.response.syncedAt ? (
              <Row styles={styles} label="Synced">
                {formatExact(d.response.syncedAt, tz)}
              </Row>
            ) : null}
            {d.response.editedAt ? (
              <Row styles={styles} label="Edited by">
                {`${d.response.editedBy ? `${d.response.editedBy.firstName} ${d.response.editedBy.lastName || ''}`.trim() : 'Unknown'} · ${formatExact(d.response.editedAt, tz)}`}
              </Row>
            ) : null}
            <Row styles={styles} label="Distance from home">
              {d.response.distanceFromHouseMeters != null ? formatDistance(d.response.distanceFromHouseMeters) : '—'}
            </Row>
            {d.response.wasOfflineSubmission ? (
              <Text style={styles.offlineBadge}>
                {d.response.syncedAt
                  ? `Recorded offline · synced ${timeAgo(d.response.syncedAt)}`
                  : 'Recorded offline · synced later'}
              </Text>
            ) : null}
          </View>

          {/* Answers */}
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Answers</Text>
            {(d.response.answers || []).length === 0 ? (
              <Text style={styles.caption}>No answers recorded.</Text>
            ) : (
              d.response.answers.map((a, i) => (
                <View key={`${a.questionKey || i}`} style={styles.answerItem}>
                  <Text style={styles.answerQuestion}>{a.questionLabel || a.questionKey}</Text>
                  <Text style={styles.answerValue}>{answerText(a.answer)}</Text>
                </View>
              ))
            )}
            {d.response.note ? (
              <View style={styles.answerItem}>
                <Text style={styles.answerQuestion}>Note</Text>
                <Text style={styles.answerValue}>{d.response.note}</Text>
              </View>
            ) : null}
          </View>

          {/* Voter extras */}
          {d.voter && (d.voter.gender || d.voter.precinct) ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Voter</Text>
              {d.voter.gender ? <Row styles={styles} label="Gender">{d.voter.gender}</Row> : null}
              {d.voter.precinct ? <Row styles={styles} label="Precinct">{d.voter.precinct}</Row> : null}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ styles, label, children }) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={2}>
        {children}
      </Text>
    </View>
  );
}

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.bg },
    header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm },
    back: { color: colors.brand, fontWeight: '600', fontSize: 14 },
    title: { ...type.h2, fontSize: 18, marginTop: spacing.xs },
    titleParty: { color: colors.textSecondary, fontWeight: '400' },
    subtitle: { ...type.caption, marginBottom: spacing.md },
    muted: { ...type.caption, marginTop: spacing.lg, textAlign: 'center' },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.md,
      ...shadow.card,
    },
    sectionLabel: {
      ...type.caption,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      color: colors.textMuted,
      marginBottom: spacing.sm,
    },
    bodyStrong: { ...type.bodyStrong, fontSize: 15 },
    caption: { ...type.caption, marginTop: 1 },
    mapWrap: {
      height: 150,
      borderRadius: radius.md,
      overflow: 'hidden',
      marginTop: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kvRow: { flexDirection: 'row', paddingVertical: 5 },
    kvLabel: { ...type.caption, width: 130, color: colors.textMuted },
    kvValue: { ...type.body, fontSize: 14, flex: 1 },
    offlineBadge: {
      ...type.caption,
      color: colors.warnFg || colors.warn,
      marginTop: spacing.xs,
      fontWeight: '600',
    },
    answerItem: { marginBottom: spacing.sm },
    answerQuestion: { ...type.caption, color: colors.textMuted, marginBottom: 1 },
    answerValue: { ...type.body, fontSize: 14 },
  });
}
