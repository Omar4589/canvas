import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Switch,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { colors, radius, spacing, type, shadow } from '../../../lib/theme';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

function householdsToFeatures(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.lat != null && h.location?.lng != null)
      .map((h) => ({
        type: 'Feature',
        id: String(h.id),
        properties: { id: String(h.id), status: h.status || 'unknocked' },
        geometry: {
          type: 'Point',
          coordinates: [h.location.lng, h.location.lat],
        },
      })),
  };
}

function pingsToFeatures(activities) {
  return {
    type: 'FeatureCollection',
    features: (activities || [])
      .filter((a) => a.location?.lat != null && a.location?.lng != null)
      .map((a) => ({
        type: 'Feature',
        id: String(a.id),
        properties: { id: String(a.id), actionType: a.actionType },
        geometry: {
          type: 'Point',
          coordinates: [a.location.lng, a.location.lat],
        },
      })),
  };
}

function actionLabel(t) {
  if (t === 'survey_submitted') return 'Survey submitted';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong address';
  if (t === 'note_added') return 'Note added';
  return t;
}

function actionColor(t) {
  if (t === 'survey_submitted') return colors.status.surveyed;
  return colors.status[t] || colors.textMuted;
}

function formatAnswer(answer) {
  if (answer == null || answer === '') return '—';
  if (Array.isArray(answer)) {
    if (answer.length === 0) return '—';
    return answer.join(', ');
  }
  return String(answer);
}

export default function AdminMap() {
  const router = useRouter();
  const cameraRef = useRef(null);
  const [campaign, setCampaign] = useState(undefined);
  const [showPings, setShowPings] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedPing, setSelectedPing] = useState(null);

  const pingDetailQ = useQuery({
    queryKey: ['admin', 'activity', selectedPing?.id],
    queryFn: () => api(`/admin/activities/${selectedPing.id}`),
    enabled: !!selectedPing?.id,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    loadActiveCampaign().then((c) => setCampaign(c || null));
  }, []);

  const cId = campaign?.id;

  const mapQ = useQuery({
    queryKey: ['admin', 'households', 'map', cId, showPings],
    queryFn: () =>
      api(
        `/admin/households/map?campaignId=${cId}${
          showPings ? '&includeActivities=1' : ''
        }`
      ),
    enabled: !!cId,
    staleTime: 30 * 1000,
    refetchInterval: showPings ? 30 * 1000 : false,
  });

  const households = mapQ.data?.households || [];
  const activities = mapQ.data?.activities || [];

  const householdFeatures = useMemo(() => householdsToFeatures(households), [households]);
  const pingFeatures = useMemo(
    () => (showPings ? pingsToFeatures(activities) : { type: 'FeatureCollection', features: [] }),
    [activities, showPings]
  );

  const householdsById = useMemo(() => {
    const m = new Map();
    for (const h of households) m.set(String(h.id), h);
    return m;
  }, [households]);

  const activitiesById = useMemo(() => {
    const m = new Map();
    for (const a of activities) m.set(String(a.id), a);
    return m;
  }, [activities]);

  const onPinPress = useCallback(
    (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const h = householdsById.get(String(f.properties?.id));
      if (h) {
        setSelectedPing(null);
        setSelected(h);
      }
    },
    [householdsById]
  );

  const onPingPress = useCallback(
    (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const a = activitiesById.get(String(f.properties?.id));
      if (a) {
        setSelected(null);
        setSelectedPing(a);
      }
    },
    [activitiesById]
  );

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          Map unavailable: missing Mapbox configuration.
        </Text>
      </SafeAreaView>
    );
  }
  if (campaign === undefined || mapQ.isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brand} />
        <Text style={styles.loadingText}>Loading map…</Text>
      </SafeAreaView>
    );
  }
  if (!campaign) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>
          No campaign selected. Pick one from the admin home.
        </Text>
        <Pressable onPress={() => router.back()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const initialCenter = households[0]
    ? [households[0].location.lng, households[0].location.lat]
    : DEFAULT_CENTER;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Mapbox.MapView style={{ flex: 1 }} styleURL={Mapbox.StyleURL.Street}>
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
          animationMode="flyTo"
          animationDuration={500}
        />
        <Mapbox.UserLocation visible androidRenderMode="compass" />

        <Mapbox.Images
          images={{
            'house-unknocked': require('../../../assets/icons/house-unknocked.png'),
            'house-not_home': require('../../../assets/icons/house-not_home.png'),
            'house-surveyed': require('../../../assets/icons/house-surveyed.png'),
            'house-wrong_address': require('../../../assets/icons/house-wrong_address.png'),
            'house-lit_dropped': require('../../../assets/icons/house-surveyed.png'),
          }}
        />

        <Mapbox.ShapeSource id="admin-households" shape={householdFeatures} onPress={onPinPress}>
          <Mapbox.SymbolLayer
            id="admin-household-pins"
            style={{
              iconImage: [
                'match',
                ['get', 'status'],
                'unknocked', 'house-unknocked',
                'not_home', 'house-not_home',
                'surveyed', 'house-surveyed',
                'wrong_address', 'house-wrong_address',
                'lit_dropped', 'house-lit_dropped',
                'house-unknocked',
              ],
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.13, 14, 0.2, 17, 0.28],
              iconAllowOverlap: true,
              iconIgnorePlacement: true,
            }}
          />
        </Mapbox.ShapeSource>

        {showPings && (
          <Mapbox.ShapeSource id="admin-pings" shape={pingFeatures} onPress={onPingPress}>
            <Mapbox.CircleLayer
              id="admin-ping-dots"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7, 17, 9],
                circleColor: [
                  'match',
                  ['get', 'actionType'],
                  'survey_submitted', colors.status.surveyed,
                  'not_home', colors.status.not_home,
                  'wrong_address', colors.status.wrong_address,
                  'lit_dropped', colors.status.lit_dropped,
                  '#6b7280',
                ],
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 2,
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topBarWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.topBarLeft} hitSlop={8}>
            <Text style={styles.back}>‹ Admin</Text>
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            {campaign.name}
          </Text>
          <View style={{ width: 80 }} />
        </View>

        <View style={styles.subBar}>
          <View style={styles.toggleChip}>
            <Switch
              value={showPings}
              onValueChange={setShowPings}
              trackColor={{ true: colors.brand, false: colors.border }}
              thumbColor={colors.card}
            />
            <Text style={styles.toggleLabel}>Canvasser pings</Text>
          </View>
          <View style={styles.countChip}>
            <Text style={styles.countText}>
              <Text style={styles.countStrong}>{households.length}</Text> houses
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {selected && (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetAddress}>
                {selected.addressLine1}
                {selected.addressLine2 ? `, ${selected.addressLine2}` : ''}
              </Text>
              <Text style={styles.sheetSub}>
                {selected.city}, {selected.state} {selected.zipCode}
              </Text>
            </View>
            <View style={[styles.statusPill, { borderColor: colors.status[selected.status] || colors.border }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.status[selected.status] }]} />
              <Text style={styles.statusText}>{colors.statusLabels[selected.status]}</Text>
            </View>
          </View>

          {selected.lastAction && (
            <View style={styles.lastActionRow}>
              <Text style={styles.lastActionText}>
                <Text style={styles.lastActionStrong}>
                  {selected.lastAction.canvasser
                    ? `${selected.lastAction.canvasser.firstName} ${selected.lastAction.canvasser.lastName}`
                    : 'Unknown'}
                </Text>{' '}
                — {colors.statusLabels[selected.status]}{' '}
                <Text style={styles.lastActionSub}>
                  ({timeAgo(selected.lastAction.timestamp)})
                </Text>
              </Text>
              <Text style={styles.lastActionTimestamp}>
                {formatExact(selected.lastAction.timestamp)}
              </Text>
            </View>
          )}

          <Pressable onPress={() => setSelected(null)} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>Close</Text>
          </Pressable>
        </SafeAreaView>
      )}

      {selectedPing && (() => {
        const a = selectedPing;
        const household = householdsById.get(String(a.householdId));
        const dist = a.distanceFromHouseMeters;
        const distFar = dist != null && dist > 100;
        const detail = pingDetailQ.data;
        const voter = detail?.voter;
        const surveyResponse = detail?.surveyResponse;
        const noteText = surveyResponse?.note || detail?.activity?.note || a.note || null;
        return (
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHandle} />

            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.pingActionRow}>
                    <View
                      style={[
                        styles.actionDot,
                        { backgroundColor: actionColor(a.actionType) },
                      ]}
                    />
                    <Text style={styles.pingActionLabel}>
                      {actionLabel(a.actionType)}
                    </Text>
                  </View>
                  {a.canvasser && (
                    <Text style={styles.pingCanvasser}>
                      {a.canvasser.firstName} {a.canvasser.lastName}
                    </Text>
                  )}
                  <Text style={styles.pingTimeAgo}>{timeAgo(a.timestamp)}</Text>
                  <Text style={styles.pingTimestamp}>
                    {formatExact(a.timestamp)}
                  </Text>
                </View>
              </View>

              {household && (
                <View style={styles.pingMetaSection}>
                  <Text style={styles.pingMetaLabel}>House</Text>
                  <Text style={styles.pingMetaValue}>{household.addressLine1}</Text>
                  <Text style={styles.pingMetaSub}>
                    {household.city}, {household.state} {household.zipCode}
                  </Text>
                </View>
              )}

              <View style={styles.pingMetaSection}>
                <Text style={styles.pingMetaLabel}>Distance from house</Text>
                {dist == null ? (
                  <Text style={styles.pingMetaSub}>unknown</Text>
                ) : (
                  <Text
                    style={[
                      styles.pingMetaValue,
                      distFar && { color: colors.danger },
                    ]}
                  >
                    {Math.round(dist)} m{distFar ? ' — far from house' : ''}
                  </Text>
                )}
                {a.location?.accuracy != null && (
                  <Text style={styles.pingMetaSub}>
                    GPS accuracy ±{Math.round(a.location.accuracy)} m
                  </Text>
                )}
              </View>

              {pingDetailQ.isLoading && (
                <View style={styles.pingMetaSection}>
                  <ActivityIndicator color={colors.brand} />
                </View>
              )}

              {voter && (
                <View style={styles.pingMetaSection}>
                  <Text style={styles.pingMetaLabel}>Voter surveyed</Text>
                  <View style={styles.voterRow}>
                    <Text style={styles.pingMetaValue}>{voter.fullName}</Text>
                    {voter.party ? (
                      <View style={styles.partyPill}>
                        <Text style={styles.partyPillText}>{voter.party}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              )}

              {surveyResponse?.answers?.length > 0 && (
                <View style={styles.pingMetaSection}>
                  <Text style={styles.pingMetaLabel}>Survey answers</Text>
                  {surveyResponse.answers.map((ans, i) => (
                    <View key={`${ans.questionKey}-${i}`} style={styles.answerRow}>
                      <Text style={styles.answerQuestion}>{ans.questionLabel}</Text>
                      <Text style={styles.answerValue}>{formatAnswer(ans.answer)}</Text>
                    </View>
                  ))}
                  {surveyResponse.surveyTemplateVersion ? (
                    <Text style={styles.surveyVersion}>
                      v{surveyResponse.surveyTemplateVersion}
                    </Text>
                  ) : null}
                </View>
              )}

              {noteText && (
                <View style={styles.pingMetaSection}>
                  <Text style={styles.pingMetaLabel}>Note</Text>
                  <View style={styles.noteBox}>
                    <Text style={styles.noteText}>{noteText}</Text>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.sheetButtons}>
              {household && (
                <Pressable
                  onPress={() => {
                    setSelectedPing(null);
                    setSelected(household);
                  }}
                  style={[styles.primaryButton, { flex: 1, marginRight: 6 }]}
                >
                  <Text style={styles.primaryButtonText}>Open household</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => setSelectedPing(null)}
                style={[styles.closeButton, { flex: 1, marginLeft: household ? 6 : 0, marginTop: 0 }]}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: { marginTop: spacing.sm, color: colors.textSecondary, fontSize: 14 },
  errorText: { color: colors.danger, marginBottom: spacing.md, textAlign: 'center' },
  primaryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  primaryButtonText: { color: colors.textInverse, fontWeight: '700' },

  topBarWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBarLeft: { width: 80 },
  topBarTitle: { ...type.h3, fontSize: 15, flex: 1, textAlign: 'center' },
  back: { color: colors.brand, fontWeight: '700', fontSize: 15 },

  subBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  toggleChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.sm,
  },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  countChip: {
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  countText: { fontSize: 12, color: colors.textSecondary },
  countStrong: { color: colors.textPrimary, fontWeight: '700' },

  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.raised,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  sheetAddress: { ...type.h3 },
  sheetSub: { ...type.caption, marginTop: 2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.bg,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },

  lastActionRow: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lastActionText: { fontSize: 13, color: colors.textSecondary },
  lastActionStrong: { color: colors.textPrimary, fontWeight: '700' },
  lastActionSub: { color: colors.textMuted },
  lastActionTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  closeButton: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  closeButtonText: { color: colors.textPrimary, fontWeight: '600' },

  sheetButtons: {
    flexDirection: 'row',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  pingActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  actionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pingActionLabel: {
    ...type.micro,
    color: colors.textSecondary,
    fontSize: 11,
  },
  pingCanvasser: { ...type.h2, fontSize: 18 },
  pingTimeAgo: { ...type.caption, marginTop: 2 },
  pingTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  pingMetaSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pingMetaLabel: {
    ...type.micro,
    marginBottom: 4,
  },
  pingMetaValue: {
    ...type.bodyStrong,
    fontSize: 14,
  },
  pingMetaSub: {
    ...type.caption,
    marginTop: 2,
  },

  sheetScroll: {
    maxHeight: 480,
  },
  sheetScrollContent: {
    paddingBottom: spacing.sm,
  },

  voterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  partyPill: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  partyPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  answerRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  answerQuestion: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  answerValue: {
    fontSize: 14,
    color: colors.textPrimary,
  },
  surveyVersion: {
    marginTop: spacing.sm,
    fontSize: 10,
    color: colors.textMuted,
    textAlign: 'right',
  },

  noteBox: {
    backgroundColor: colors.bg,
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
    padding: spacing.sm,
    borderRadius: radius.sm,
    marginTop: 4,
  },
  noteText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontStyle: 'italic',
    lineHeight: 18,
  },
});
