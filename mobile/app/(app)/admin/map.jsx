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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { useMapStyle } from '../../../lib/mapStyles';
import MapStyleControl from '../../../components/MapStyleControl';
import CampaignChip from '../../../components/CampaignChip';
import DateRangePickerModal from '../../../components/DateRangePickerModal';
import { PRESETS, rangeFor, labelForRange, deviceTimezone } from '../../../lib/dateRanges';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { timeAgo, formatExact } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

if (MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
}

const DEFAULT_CENTER = [-84.5, 39.0];

// Status filter options (mirror the web MapFilters set).
const STATUS_OPTIONS = [
  { key: 'unknocked', label: 'Unknocked' },
  { key: 'not_home', label: 'Not home' },
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'refused', label: 'Refused' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'lit_dropped', label: 'Lit dropped' },
];

// The first/last-knock highlight colors — deliberately OUTSIDE the status palette so they
// read as route endpoints, not statuses (matches the web mapRender constants).
const FIRST_KNOCK_COLOR = '#0891b2'; // cyan
const LAST_KNOCK_COLOR = '#db2777'; // pink

const one = (v) => (Array.isArray(v) ? v[0] : v) || '';

function pointFeatures(activity) {
  if (activity?.location?.lng == null || activity?.location?.lat == null) {
    return { type: 'FeatureCollection', features: [] };
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [activity.location.lng, activity.location.lat] },
        properties: {},
      },
    ],
  };
}

function householdsToFeatures(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.lat != null && h.location?.lng != null)
      .map((h) => ({
        type: 'Feature',
        id: String(h.id),
        properties: {
          id: String(h.id),
          status: h.status || 'unknocked',
          coordConfidence: h.coordConfidence || '',
        },
        geometry: {
          type: 'Point',
          coordinates: [h.location.lng, h.location.lat],
        },
      })),
  };
}

function initialsFor(canvasser) {
  if (!canvasser) return '';
  const f = (canvasser.firstName || '').trim();
  const l = (canvasser.lastName || '').trim();
  const initials = `${f[0] || ''}${l[0] || ''}`.toUpperCase();
  return initials || (f[0] || l[0] || '').toUpperCase();
}

function pingsToFeatures(activities) {
  return {
    type: 'FeatureCollection',
    features: (activities || [])
      .filter((a) => a.location?.lat != null && a.location?.lng != null)
      .map((a) => ({
        type: 'Feature',
        id: String(a.id),
        properties: { id: String(a.id), actionType: a.actionType, initials: initialsFor(a.canvasser) },
        geometry: {
          type: 'Point',
          coordinates: [a.location.lng, a.location.lat],
        },
      })),
  };
}

// A dashed connector from each GPS ping to the house it was recorded at, so you can
// see how far a canvasser stood from the door. Mirrors the web `canvasser-lines` layer.
function linesToFeatures(activities, householdsById) {
  const features = [];
  for (const a of activities || []) {
    if (a.location?.lng == null || a.location?.lat == null) continue;
    const h = householdsById.get(String(a.householdId));
    if (!h?.location) continue;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [a.location.lng, a.location.lat],
          [h.location.lng, h.location.lat],
        ],
      },
      properties: { id: String(a.id) },
    });
  }
  return { type: 'FeatureCollection', features };
}

function actionLabel(t) {
  if (t === 'survey_submitted') return 'Survey submitted';
  if (t === 'lit_dropped') return 'Lit dropped';
  if (t === 'not_home') return 'Not home';
  if (t === 'wrong_address') return 'Wrong address';
  if (t === 'refused') return 'Refused';
  if (t === 'note_added') return 'Note added';
  return t;
}

function actionColor(colors, t) {
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

// A filter chip that opens a dropdown menu (canvasser / status / answer).
function FilterChip({ label, active, open, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.filterChevron}>{open ? '▴' : '▾'}</Text>
    </Pressable>
  );
}

function MenuItem({ label, active, dotColor, onPress }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.menuItem, active && styles.menuItemActive]}>
      {dotColor ? (
        <View style={[styles.menuDot, { backgroundColor: dotColor }]} />
      ) : (
        <View style={styles.menuDotPlaceholder} />
      )}
      <Text style={[styles.menuItemText, active && styles.menuItemTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Text style={styles.menuCheck}>✓</Text> : null}
    </Pressable>
  );
}

export default function AdminMap() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { styleId, styleURL, setStyle } = useMapStyle();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const qc = useQueryClient();
  const cameraRef = useRef(null);
  const mapRef = useRef(null);
  const [campaign, setCampaign] = useState(undefined);
  const [showPings, setShowPings] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedPing, setSelectedPing] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null); // household being repositioned

  // Deep-link scope (from a walk list / pass / import "view on map" link) — seeded once
  // from the route params, clearable in the UI.
  const params = useLocalSearchParams();
  const [scope, setScope] = useState({
    effortId: one(params.effortId),
    passId: one(params.passId),
    importId: one(params.importId),
  });
  const { effortId, passId, importId } = scope;

  // Audit filters — mirror the web admin map. Default to All time so every door shows.
  const [range, setRange] = useState(() => {
    const r = rangeFor('all', null, deviceTimezone());
    return { preset: 'all', from: r.from, to: r.to };
  });
  const [statusFilter, setStatusFilter] = useState([]); // [] = all statuses
  const [canvasserId, setCanvasserId] = useState('');
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', optionId: '', label: '' });
  const [live, setLive] = useState(true);
  const [openMenu, setOpenMenu] = useState(null); // 'date' | 'canvasser' | 'status' | 'answer' | null
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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
  const tz = campaign?.timeZone || deviceTimezone();

  const mapQ = useQuery({
    queryKey: [
      'admin', 'households', 'map', cId, range?.from, range?.to, statusFilter.join(','),
      canvasserId, answerFilter.questionKey, answerFilter.optionId, effortId, passId, importId, showPings,
    ],
    queryFn: () => {
      const p = new URLSearchParams({ campaignId: String(cId) });
      if (range?.from) p.set('from', range.from);
      if (range?.to) p.set('to', range.to);
      if (statusFilter.length) p.set('status', statusFilter.join(','));
      if (canvasserId) p.set('userId', canvasserId);
      if (answerFilter.questionKey) {
        p.set('questionKey', answerFilter.questionKey);
        if (answerFilter.optionId) p.set('optionId', answerFilter.optionId);
      }
      if (effortId) p.set('effortId', effortId);
      if (passId) p.set('passId', passId);
      if (importId) p.set('importId', importId);
      if (showPings) p.set('includeActivities', '1');
      return api(`/admin/households/map?${p.toString()}`);
    },
    enabled: !!cId,
    staleTime: 30 * 1000,
    refetchInterval: live ? 20 * 1000 : false,
  });

  // Survey (for the answer-filter chips) — same source the web map uses.
  const surveyQ = useQuery({
    queryKey: ['admin', 'survey-results', cId],
    queryFn: () => api(`/admin/reports/survey-results?campaignId=${cId}`),
    enabled: !!cId,
    staleTime: 5 * 60 * 1000,
  });

  const households = mapQ.data?.households || [];
  const activities = mapQ.data?.activities || [];
  const canvassers = mapQ.data?.canvassers || [];

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

  const lineFeatures = useMemo(
    () => (showPings ? linesToFeatures(activities, householdsById) : { type: 'FeatureCollection', features: [] }),
    [showPings, activities, householdsById]
  );

  const activitiesById = useMemo(() => {
    const m = new Map();
    for (const a of activities) m.set(String(a.id), a);
    return m;
  }, [activities]);

  // First & last knock — only when auditing ONE canvasser with pings on. The endpoint
  // already scopes activities to that userId + date window; first = earliest, last = most recent.
  const firstLastKnock = useMemo(() => {
    if (!canvasserId || !showPings) return { first: null, last: null };
    const withLoc = activities.filter(
      (a) => a.location?.lng != null && a.location?.lat != null && a.timestamp
    );
    if (!withLoc.length) return { first: null, last: null };
    const sorted = [...withLoc].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { first: sorted[0], last: sorted.length > 1 ? sorted[sorted.length - 1] : null };
  }, [canvasserId, showPings, activities]);

  // Labels for the filter chips.
  const canvasserLabel = useMemo(() => {
    if (!canvasserId) return 'All canvassers';
    const c = canvassers.find((x) => String(x.id) === String(canvasserId));
    return c ? `${c.firstName} ${c.lastName}` : 'Canvasser';
  }, [canvasserId, canvassers]);
  const statusLabel = statusFilter.length === 0
    ? 'All statuses'
    : statusFilter.length === 1
      ? (STATUS_OPTIONS.find((s) => s.key === statusFilter[0])?.label || '1 status')
      : `${statusFilter.length} statuses`;

  // Choice questions for the answer filter (mirror the web MapFilters derivation).
  const surveyQuestions = useMemo(() => {
    const qs = surveyQ.data?.questions || [];
    return qs.filter(
      (q) => (q.type === 'single_choice' || q.type === 'multiple_choice') && Array.isArray(q.options) && q.options.length
    );
  }, [surveyQ.data]);

  const toggleMenu = useCallback((m) => setOpenMenu((cur) => (cur === m ? null : m)), []);
  const toggleStatus = useCallback(
    (k) => setStatusFilter((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])),
    []
  );

  // Move-pin: PATCH the door's location, then refetch the map. Mirrors the web endpoint
  // (scope defaults to 'unit' server-side).
  const moveMut = useMutation({
    mutationFn: ({ id, lat, lng }) =>
      api(`/admin/campaigns/${cId}/households/${id}/location`, { method: 'PATCH', body: { lat, lng } }),
    onSuccess: () => {
      setMoveTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'households', 'map'] });
    },
  });

  // Enter move mode: close the sheet and center the camera tightly on the door so the
  // fixed screen crosshair starts right on top of it. The user then drags the map to
  // reposition the crosshair, and Save reads the map center.
  function enterMoveMode(h) {
    setSelected(null);
    setSelectedPing(null);
    setOpenMenu(null);
    moveMut.reset();
    setMoveTarget(h);
    if (h?.location != null) {
      cameraRef.current?.setCamera({
        centerCoordinate: [h.location.lng, h.location.lat],
        zoomLevel: 18,
        animationDuration: 500,
      });
    }
  }

  async function saveMovedPin() {
    if (!moveTarget || !mapRef.current) return;
    let center;
    try {
      center = await mapRef.current.getCenter(); // [lng, lat]
    } catch {
      return;
    }
    if (!Array.isArray(center) || center.length < 2) return;
    moveMut.mutate({ id: moveTarget.id, lng: center[0], lat: center[1] });
  }

  const onPinPress = useCallback(
    (e) => {
      if (moveTarget) return;
      const f = e.features?.[0];
      if (!f) return;
      const h = householdsById.get(String(f.properties?.id));
      if (h) {
        setSelectedPing(null);
        setSelected(h);
      }
    },
    [householdsById, moveTarget]
  );

  const onPingPress = useCallback(
    (e) => {
      if (moveTarget) return;
      const f = e.features?.[0];
      if (!f) return;
      const a = activitiesById.get(String(f.properties?.id));
      if (a) {
        setSelected(null);
        setSelectedPing(a);
      }
    },
    [activitiesById, moveTarget]
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
        <View style={{ width: '100%', paddingHorizontal: spacing.lg, marginBottom: spacing.lg }}>
          <CampaignChip value={campaign} onChange={setCampaign} />
        </View>
        <Text style={styles.errorText}>No active campaign yet.</Text>
      </SafeAreaView>
    );
  }

  const initialCenter = households[0]
    ? [households[0].location.lng, households[0].location.lat]
    : DEFAULT_CENTER;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Mapbox.MapView ref={mapRef} style={{ flex: 1 }} styleURL={styleURL}>
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
          animationMode="flyTo"
          animationDuration={500}
        />
        {/* Plain location dot (no compass) to avoid continuous magnetometer use. */}
        <Mapbox.UserLocation visible />

        <Mapbox.Images
          images={{
            'house-unknocked': require('../../../assets/icons/house-unknocked.png'),
            'house-not_home': require('../../../assets/icons/house-not_home.png'),
            'house-surveyed': require('../../../assets/icons/house-surveyed.png'),
            'house-wrong_address': require('../../../assets/icons/house-wrong_address.png'),
            'house-refused': require('../../../assets/icons/house-refused.png'),
            'house-lit_dropped': require('../../../assets/icons/house-surveyed.png'),
          }}
        />

        {/* Ping-to-house connector lines, drawn beneath the pins so the markers sit on top. */}
        {showPings && (
          <Mapbox.ShapeSource id="admin-lines" shape={lineFeatures}>
            <Mapbox.LineLayer
              id="admin-line-strokes"
              style={{
                lineColor: colors.textSecondary,
                lineWidth: 1,
                lineOpacity: 0.5,
                lineDasharray: [2, 2],
              }}
            />
          </Mapbox.ShapeSource>
        )}

        <Mapbox.ShapeSource id="admin-households" shape={householdFeatures} onPress={onPinPress}>
          {/* Amber "approximate" ring under any interpolated (non-rooftop) geocode, so
              admins can spot the pins most likely to be off. Below the house icon. */}
          <Mapbox.CircleLayer
            id="admin-approx-ring"
            filter={['==', ['get', 'coordConfidence'], 'interpolated']}
            style={{
              circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 13, 17, 18],
              circleColor: 'rgba(0,0,0,0)',
              circleStrokeColor: '#f59e0b',
              circleStrokeWidth: 2,
              circleStrokeOpacity: 0.9,
            }}
          />
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
                'refused', 'house-refused',
                'lit_dropped', 'house-lit_dropped',
                'house-unknocked',
              ],
              iconSize: ['interpolate', ['linear'], ['zoom'], 10, 0.09, 14, 0.14, 17, 0.2],
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
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12, 17, 15],
                circleColor: [
                  'match',
                  ['get', 'actionType'],
                  'survey_submitted', colors.status.surveyed,
                  'not_home', colors.status.not_home,
                  'wrong_address', colors.status.wrong_address,
                  'refused', colors.status.refused,
                  'lit_dropped', colors.status.lit_dropped,
                  colors.textSecondary,
                ],
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 2,
              }}
            />
            <Mapbox.SymbolLayer
              id="admin-ping-labels"
              style={{
                textField: ['get', 'initials'],
                textSize: ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11, 17, 13],
                textColor: '#ffffff',
                textHaloColor: 'rgba(0,0,0,0.35)',
                textHaloWidth: 0.8,
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* First & last knock — when auditing ONE canvasser, ring their earliest ping
            ("Start") and most-recent ping ("Latest") so you can see where they began and
            where they are now. Rendered ON TOP as a hollow ring + labeled badge. */}
        {firstLastKnock.first && (
          <Mapbox.ShapeSource id="admin-first-knock" shape={pointFeatures(firstLastKnock.first)}>
            <Mapbox.CircleLayer
              id="admin-first-ring"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 16, 16, 20, 18, 24],
                circleColor: 'rgba(0,0,0,0)',
                circleStrokeColor: FIRST_KNOCK_COLOR,
                circleStrokeWidth: 3,
              }}
            />
            <Mapbox.SymbolLayer
              id="admin-first-label"
              style={{
                textField: 'Start',
                textSize: 12,
                textColor: FIRST_KNOCK_COLOR,
                textHaloColor: '#ffffff',
                textHaloWidth: 1.4,
                textOffset: [0, -2.1],
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}
        {firstLastKnock.last && (
          <Mapbox.ShapeSource id="admin-last-knock" shape={pointFeatures(firstLastKnock.last)}>
            <Mapbox.CircleLayer
              id="admin-last-ring"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 16, 16, 20, 18, 24],
                circleColor: 'rgba(0,0,0,0)',
                circleStrokeColor: LAST_KNOCK_COLOR,
                circleStrokeWidth: 3,
              }}
            />
            <Mapbox.SymbolLayer
              id="admin-last-label"
              style={{
                textField: 'Latest',
                textSize: 12,
                textColor: LAST_KNOCK_COLOR,
                textHaloColor: '#ffffff',
                textHaloWidth: 1.4,
                textOffset: [0, -2.1],
                textAllowOverlap: true,
                textIgnorePlacement: true,
              }}
            />
          </Mapbox.ShapeSource>
        )}
      </Mapbox.MapView>

      {/* Top chrome — campaign + audit filters (date, canvasser, status, answer) + toggles. */}
      <SafeAreaView edges={['top']} style={styles.topBarWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <CampaignChip value={campaign} onChange={setCampaign} />
          </View>
        </View>

        <View style={styles.chromeCard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScroll}
          >
            <FilterChip label={labelForRange(range)} active={range.preset !== 'all'} open={openMenu === 'date'} onPress={() => toggleMenu('date')} />
            <FilterChip label={canvasserLabel} active={!!canvasserId} open={openMenu === 'canvasser'} onPress={() => toggleMenu('canvasser')} />
            <FilterChip label={statusLabel} active={statusFilter.length > 0} open={openMenu === 'status'} onPress={() => toggleMenu('status')} />
            {surveyQuestions.length > 0 && (
              <FilterChip
                label={answerFilter.questionKey ? (answerFilter.label || 'Answer') : 'Any answer'}
                active={!!answerFilter.questionKey}
                open={openMenu === 'answer'}
                onPress={() => toggleMenu('answer')}
              />
            )}
          </ScrollView>

          {(effortId || passId || importId) && (
            <View style={styles.scopeRow}>
              <Text style={styles.scopeText} numberOfLines={1}>
                Scoped to {effortId ? 'a walk list' : passId ? 'a pass' : 'an import'}
              </Text>
              <Pressable onPress={() => setScope({ effortId: '', passId: '', importId: '' })} hitSlop={8}>
                <Text style={styles.scopeClear}>✕ clear</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.subBar}>
            <View style={styles.toggleChip}>
              <Switch value={showPings} onValueChange={setShowPings} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.card} />
              <Text style={styles.toggleLabel}>Pings</Text>
            </View>
            <View style={styles.toggleChip}>
              <Switch value={live} onValueChange={setLive} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.card} />
              <Text style={styles.toggleLabel}>Live</Text>
            </View>
            <View style={styles.countChip}>
              <Text style={styles.countText}>
                <Text style={styles.countStrong}>{households.length}</Text> houses
              </Text>
            </View>
          </View>
        </View>

        {/* Dropdown menus — one open at a time, rendered below the chrome. */}
        {openMenu === 'date' && (
          <View style={styles.menu}>
            {PRESETS.map((p) => (
              <MenuItem
                key={p.key}
                label={p.label}
                active={range.preset === p.key}
                onPress={() => {
                  setOpenMenu(null);
                  if (p.key === 'custom') {
                    setDatePickerOpen(true);
                    return;
                  }
                  const r = rangeFor(p.key, null, tz);
                  setRange({ preset: p.key, from: r.from, to: r.to });
                }}
              />
            ))}
          </View>
        )}
        {openMenu === 'canvasser' && (
          <View style={styles.menu}>
            <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
              <MenuItem label="All canvassers" active={!canvasserId} onPress={() => { setCanvasserId(''); setOpenMenu(null); }} />
              {canvassers.map((c) => (
                <MenuItem
                  key={c.id}
                  label={`${c.firstName} ${c.lastName}`}
                  active={String(canvasserId) === String(c.id)}
                  onPress={() => { setCanvasserId(String(c.id)); setOpenMenu(null); }}
                />
              ))}
            </ScrollView>
          </View>
        )}
        {openMenu === 'status' && (
          <View style={styles.menu}>
            <MenuItem label="All statuses" active={statusFilter.length === 0} onPress={() => setStatusFilter([])} />
            {STATUS_OPTIONS.map((s) => (
              <MenuItem key={s.key} label={s.label} active={statusFilter.includes(s.key)} dotColor={colors.status[s.key]} onPress={() => toggleStatus(s.key)} />
            ))}
          </View>
        )}
        {openMenu === 'answer' && (
          <View style={styles.menu}>
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              <MenuItem label="Any answer" active={!answerFilter.questionKey} onPress={() => { setAnswerFilter({ questionKey: '', optionId: '', label: '' }); setOpenMenu(null); }} />
              {surveyQuestions.map((q) => (
                <View key={q.key}>
                  <Text style={styles.menuGroup}>{q.label}</Text>
                  {q.options.filter((o) => !o.retired).map((o) => (
                    <MenuItem
                      key={o.id || o.option}
                      label={o.option}
                      active={answerFilter.questionKey === q.key && answerFilter.optionId === o.id}
                      onPress={() => { setAnswerFilter({ questionKey: q.key, optionId: o.id, label: o.option }); setOpenMenu(null); }}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </SafeAreaView>

      {/* Custom date range picker — opened from the date chip's "Custom" item. */}
      <DateRangePickerModal
        visible={datePickerOpen}
        initialFrom={range.from}
        initialTo={range.to}
        tz={tz}
        onClose={() => setDatePickerOpen(false)}
        onApply={({ from, to }) => {
          setRange({ preset: 'custom', from, to });
          setDatePickerOpen(false);
        }}
      />

      {/* First/last-knock legend — only while auditing one canvasser. */}
      {firstLastKnock.first && !selected && !selectedPing && (
        <View style={[styles.legend, { bottom: insets.bottom + spacing.lg }]}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { borderColor: FIRST_KNOCK_COLOR }]} />
            <Text style={styles.legendText}>Start (first knock)</Text>
          </View>
          {firstLastKnock.last && (
            <View style={styles.legendRow}>
              <View style={[styles.legendDot, { borderColor: LAST_KNOCK_COLOR }]} />
              <Text style={styles.legendText}>Latest knock</Text>
            </View>
          )}
        </View>
      )}

      {/* Move-pin mode: a fixed crosshair at screen center + a bottom action bar. The
          user drags the MAP (not a marker) so the crosshair lands on the true door —
          this dodges the MarkerView/PointAnnotation pinch-zoom issues on Fabric. */}
      {moveTarget && (
        <>
          <View pointerEvents="none" style={styles.crosshairWrap}>
            <View style={styles.crosshairRing} />
            <View style={styles.crosshairDot} />
          </View>
          <SafeAreaView edges={['bottom']} style={styles.moveBar}>
            <Text style={styles.moveTitle}>Move pin</Text>
            <Text style={styles.moveSub} numberOfLines={2}>
              Drag the map so the crosshair sits on {moveTarget.addressLine1}, then save.
            </Text>
            {moveMut.isError && (
              <Text style={styles.moveErr}>
                {moveMut.error?.message || 'Could not move the pin.'}
              </Text>
            )}
            <View style={styles.moveBtnRow}>
              <Pressable
                onPress={() => setMoveTarget(null)}
                disabled={moveMut.isPending}
                style={[styles.closeButton, { flex: 1, marginRight: 6, marginTop: 0 }]}
              >
                <Text style={styles.closeButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveMovedPin}
                disabled={moveMut.isPending}
                style={[styles.primaryButton, { flex: 1, marginLeft: 6, alignItems: 'center' }]}
              >
                <Text style={styles.primaryButtonText}>
                  {moveMut.isPending ? 'Saving…' : 'Save location'}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </>
      )}

      {/* Base-map picker, bottom-right. Rendered before the selection sheet so it
          tucks behind it when a household is open. */}
      {!moveTarget && (
        <MapStyleControl
          value={styleId}
          onChange={setStyle}
          menuDirection="up"
          style={{ position: 'absolute', right: spacing.lg, bottom: insets.bottom + spacing.lg }}
        />
      )}

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
                {formatExact(selected.lastAction.timestamp, campaign?.timeZone)}
              </Text>
            </View>
          )}

          <View style={styles.sheetButtons}>
            <Pressable
              onPress={() => enterMoveMode(selected)}
              style={[styles.primaryButton, { flex: 1, marginRight: 6, alignItems: 'center' }]}
            >
              <Text style={styles.primaryButtonText}>Move pin</Text>
            </Pressable>
            <Pressable
              onPress={() => setSelected(null)}
              style={[styles.closeButton, { flex: 1, marginLeft: 6, marginTop: 0 }]}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
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
                        { backgroundColor: actionColor(colors, a.actionType) },
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
                    {formatExact(a.timestamp, campaign?.timeZone)}
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

function makeStyles(t) {
  const { colors, type, shadow } = t;
  return StyleSheet.create({
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
    backgroundColor: colors.chromeBar,
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

  chromeCard: { paddingTop: spacing.xs },
  chipScroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: 6,
  },
  filterChipActive: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  filterChipText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, maxWidth: 170 },
  filterChipTextActive: { color: colors.brand },
  filterChevron: { fontSize: 11, color: colors.textSecondary },

  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.brandTint,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: spacing.sm,
  },
  scopeText: { fontSize: 12, fontWeight: '600', color: colors.brand, flex: 1 },
  scopeClear: { fontSize: 12, fontWeight: '700', color: colors.brand },

  menu: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuItemActive: { backgroundColor: colors.brandTint },
  menuDot: { width: 10, height: 10, borderRadius: 5 },
  menuDotPlaceholder: { width: 10, height: 10 },
  menuItemText: { flex: 1, fontSize: 14, color: colors.textPrimary },
  menuItemTextActive: { color: colors.brand, fontWeight: '700' },
  menuCheck: { color: colors.brand, fontWeight: '700' },
  menuGroup: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 2,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  legend: {
    position: 'absolute',
    left: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 6,
    ...shadow.card,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 3,
    backgroundColor: 'transparent',
  },
  legendText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },

  // Move-pin reticle — anchored at the exact screen (map) center that Save reads.
  crosshairWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairRing: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: colors.brand,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  crosshairDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brand,
  },
  moveBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    ...shadow.raised,
  },
  moveTitle: { ...type.h3 },
  moveSub: { ...type.caption, marginTop: 4 },
  moveErr: { color: colors.danger, fontSize: 12, marginTop: spacing.sm },
  moveBtnRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

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
}
