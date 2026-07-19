import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Switch,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useFocusedPoll } from '../../../lib/useFocusedPoll';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import { api } from '../../../lib/api';
import { loadActiveCampaign } from '../../../lib/cache';
import { useMapStyle } from '../../../lib/mapStyles';
import { formatDistance } from '../../../lib/geo';
import MapStyleControl from '../../../components/MapStyleControl';
import CampaignChip from '../../../components/CampaignChip';
import LiveStatus from '../../../components/LiveStatus';
import DateRangePickerModal from '../../../components/DateRangePickerModal';
import FlaggedEntryCard from '../../../components/FlaggedEntryCard';
import FlagLegendHint from '../../../components/FlagLegendHint';
import { primaryReason, reasonColor } from '../../../lib/flags';
import { PRESETS, rangeFor, labelForRange, deviceTimezone } from '../../../lib/dateRanges';
import { MAPBOX_PUBLIC_TOKEN } from '../../../lib/config';
import { initMapbox } from '../../../lib/mapbox';
import { timeAgo, formatExact, formatInTz } from '../../../lib/datetime';
import { radius, spacing } from '../../../lib/theme';
import { useTheme } from '../../../lib/ThemeContext';
import { useThemedStyles } from '../../../lib/useThemedStyles';

initMapbox();

const DEFAULT_CENTER = [-84.5, 39.0];

// Verb shown in the brief post-review confirmation.
const FLAG_FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

// Status filter options (mirror the web MapFilters set).
const STATUS_OPTIONS = [
  { key: 'unknocked', label: 'Unknocked' },
  { key: 'not_home', label: 'Not home' },
  { key: 'surveyed', label: 'Surveyed' },
  { key: 'refused', label: 'Refused' },
  { key: 'restricted', label: 'Restricted' },
  { key: 'wrong_address', label: 'Wrong addr' },
  { key: 'lit_dropped', label: 'Lit dropped' },
];

// The first/last-knock highlight colors — deliberately OUTSIDE the status palette so they
// read as route endpoints, not statuses (matches the web mapRender constants).
const FIRST_KNOCK_COLOR = '#0891b2'; // cyan
const LAST_KNOCK_COLOR = '#db2777'; // pink
// Mirror the server's KNOCK_ACTIONS so the inline overlap badge matches the /overlap-doors
// ring (restricted / note_added are not knocks — excluded).
const OVERLAP_KNOCK_ACTIONS = new Set(['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped']);

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

// GPS-audit flags → points, colored by the worst reason, dimmed once reviewed. Mirrors the
// web flag layer (mapRender.js flagsToGeoJSON).
function flagsToFeatures(entries) {
  return {
    type: 'FeatureCollection',
    features: (entries || [])
      .filter((e) => e.location?.lat != null && e.location?.lng != null)
      .map((e) => {
        const pr = primaryReason(e);
        const reviewed = (e.review?.status || 'open') !== 'open';
        return {
          type: 'Feature',
          id: String(e.actionId),
          properties: { actionId: String(e.actionId), color: reasonColor(pr?.type), reviewed: reviewed ? 1 : 0 },
          geometry: { type: 'Point', coordinates: [e.location.lng, e.location.lat] },
        };
      }),
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
  if (t === 'restricted') return 'Restricted';
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
function FilterChip({ label, active, open, onPress, style }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive, style]}>
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
  const framedRef = useRef(false); // camera framed on this campaign's doors once (reset on campaign change)
  const focusedHouseholdRef = useRef(null); // last door focused from a ?household= link
  const [campaign, setCampaign] = useState(undefined);
  const [showPings, setShowPings] = useState(false);
  const [showFlags, setShowFlags] = useState(false);
  const [showOverlaps, setShowOverlaps] = useState(false);
  const [showOverlapList, setShowOverlapList] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedPing, setSelectedPing] = useState(null);
  const [selectedFlagId, setSelectedFlagId] = useState(null);
  const [flagFlash, setFlagFlash] = useState(null);
  const flagFlashTimer = useRef(null);
  const [mapNotice, setMapNotice] = useState(null); // brief bottom toast (e.g. door has no location)
  const mapNoticeTimer = useRef(null);
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

  // A single door to focus, from a Notes "view on map" link. NOT a server filter
  // (unlike scope) — it only widens the range + flies the camera (see the effect
  // below). Read live (not once-seeded) so re-navigating to another door on this
  // always-mounted Tabs screen re-focuses.
  const householdFocus = one(params.household);
  // A per-tap nonce so re-tapping "view on map" for the SAME door still re-focuses
  // (the id alone wouldn't change, and this screen stays mounted); background polls
  // leave it unchanged, so they never steal focus.
  const focusNonce = one(params.focusAt);
  const focusToken = householdFocus ? `${householdFocus}:${focusNonce}` : '';
  // The door's own campaign (from the deep link) — lets the focus effect safely give up
  // when THIS campaign has loaded without the door, without racing a campaign switch.
  const focusCid = one(params.hcid);

  // Audit filters — mirror the web admin map. Default to TODAY (like the web):
  // the map opens on today's activity; "All time" is one tap away in the preset
  // menu. Seeded from the device tz for first paint, re-anchored to the
  // campaign's tz below once it resolves. EXCEPT when arriving via a household
  // deep-link: the door's note may be old, so open ALL-TIME so it's in the set.
  const [range, setRange] = useState(() => {
    if (householdFocus) return { preset: 'all', from: null, to: null };
    const r = rangeFor('today', null, deviceTimezone());
    return { preset: 'today', from: r.from, to: r.to };
  });
  // True once the user picks a date themselves — the tz reseed must never stomp a
  // manual choice. NOT set for a deep-link: the reseed instead bails while
  // ?household= is present (below), so the widen self-heals back to today once the
  // param clears (e.g. the user taps the Map tab plainly).
  const dateTouchedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState([]); // [] = all statuses
  const [canvasserId, setCanvasserId] = useState('');
  // `option` is the answer TEXT, sent alongside optionId so the server dual-reads
  // (id-native rows by id, legacy text-only rows by text) — same as the web map.
  // `templateId` pins the filter to ONE survey template (multi-survey campaigns);
  // '' falls back to the campaign's current template once surveyQ resolves.
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', optionId: '', option: '', label: '', templateId: '' });
  const [live, setLive] = useState(true);
  const [openMenu, setOpenMenu] = useState(null); // 'date' | 'canvasser' | 'status' | 'answer' | null
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const isFocused = useIsFocused();
  // Viewport bound ("west,south,east,north"): once ARMED (the camera has actually shown some of
  // the loaded doors), every settled camera move refetches just the visible area — the 20s live
  // poll included — matching the web map. Unarmed/null = the unbounded (capped) pull.
  // lastBoundsRef holds the raw bounds of the last ACCEPTED viewport: onMapIdle fires after every
  // data-driven re-render too (not just user moves, unlike web's moveend), and its reported
  // bounds jitter by a hair — so updates are epsilon-gated against this ref (see handleMapIdle)
  // or the map refetches itself in a loop.
  const [bbox, setBbox] = useState(null);
  const bboxArmedRef = useRef(false);
  const lastBoundsRef = useRef(null); // { w, s, e, n } raw (unpadded)

  const pingDetailQ = useQuery({
    queryKey: ['admin', 'activity', selectedPing?.id],
    queryFn: () => api(`/admin/activities/${selectedPing.id}`),
    enabled: !!selectedPing?.id,
    staleTime: 60 * 1000,
  });

  // Household detail — lazy-loaded when a door sheet opens, matching the web
  // HouseholdDetailPanel. `/activity` gives the full per-round history (deduped
  // server-side: one line per survey) + powers the inline overlap badge; `/surveys`
  // gives per-survey answers (the map payload ships survey meta only). `passId`
  // mirrors the map's round scoping so the panel shows the same survey set as the pins.
  const hhActivityQ = useQuery({
    queryKey: ['admin', 'household-activity', selected?.id],
    queryFn: () => api(`/admin/households/${selected.id}/activity`),
    enabled: !!selected?.id,
  });
  const hhSurveysQ = useQuery({
    queryKey: ['admin', 'household-surveys', selected?.id, passId || ''],
    queryFn: () => api(`/admin/households/${selected.id}/surveys${passId ? `?passId=${passId}` : ''}`),
    enabled: !!selected?.id && (selected?.surveys?.length || 0) > 0,
  });

  // Re-sync the active campaign every time the map regains focus — a per-campaign
  // drill-in or a Notes "view on map" deep-link may have changed it while this
  // always-mounted Tabs screen stayed put. A mount-only read would strand it on a
  // stale campaign. The prev-id guard keeps object identity (no needless refetch)
  // when unchanged. Mirrors audit.jsx / notes.jsx.
  useFocusEffect(
    useCallback(() => {
      loadActiveCampaign().then((c) =>
        setCampaign((prev) => (String(c?.id) !== String(prev?.id) ? c || null : prev))
      );
    }, [])
  );

  const cId = campaign?.id;
  const tz = campaign?.timeZone || deviceTimezone();

  // When the campaign changes underneath this mounted screen, drop any door
  // selection, the deep-link focus guard, and the "date touched" flag so a new
  // campaign's ?household= link focuses fresh, a stale door sheet from the old
  // campaign doesn't linger, and the range re-anchors to the new campaign's today
  // (clearing any all-time widen a prior deep-link left behind).
  useEffect(() => {
    focusedHouseholdRef.current = null;
    dateTouchedRef.current = false;
    setSelected(null);
    setSelectedPing(null);
    setSelectedFlagId(null);
  }, [cId]);

  // Re-anchor the untouched "Today" default to the CAMPAIGN's day once its tz
  // resolves (and when switching campaigns) — a viewer in another timezone must
  // see the campaign's today, not their own. Mirrors the web MapPage reseed. Bails
  // while a ?household= deep-link is active so it can't pull the range off all-time
  // before the door is focused. `cId` is a dep so a same-tz campaign switch also
  // reseeds.
  useEffect(() => {
    if (dateTouchedRef.current || householdFocus) return;
    const r = rangeFor('today', null, tz);
    setRange((prev) => (prev.preset === 'today' && prev.from === r.from ? prev : { preset: 'today', from: r.from, to: r.to }));
  }, [tz, householdFocus, cId]);

  // New campaign = new geography: drop the viewport bound and re-arm from scratch so the next
  // (unbounded) pull can show the new campaign's doors wherever they are.
  useEffect(() => {
    setBbox(null);
    bboxArmedRef.current = false;
    lastBoundsRef.current = null;
    framedRef.current = false; // re-frame the camera on the new campaign's doors
  }, [cId]);

  // Survey (for the answer-filter chips) — same source the web map uses. Honors the map's date
  // range so the per-answer counts match the visible dates (absent from/to = all-time).
  // Declared BEFORE mapQ: the households query scopes its answer filter to this template.
  const surveyQ = useQuery({
    queryKey: ['admin', 'survey-results', cId, range?.from, range?.to],
    queryFn: () => {
      const p = new URLSearchParams({ campaignId: String(cId) });
      if (range?.from) p.set('from', range.from);
      if (range?.to) p.set('to', range.to);
      return api(`/admin/reports/survey-results?${p.toString()}`);
    },
    enabled: !!cId,
    staleTime: 5 * 60 * 1000,
  });

  // Template scope for the answer filter: an explicit seed/menu choice wins; else the
  // campaign's current template once surveyQ resolves (the same template the chips came
  // from). '' = legacy cross-template union server-side. Only meaningful with an answer
  // filter active, so it's '' otherwise (stable query key).
  const answerTemplateId = answerFilter.questionKey
    ? String(answerFilter.templateId || surveyQ.data?.surveyTemplate?.id || '')
    : '';

  const mapQ = useQuery({
    queryKey: [
      'admin', 'households', 'map', cId, range?.from, range?.to, statusFilter.join(','),
      canvasserId, answerFilter.questionKey, answerFilter.optionId, answerFilter.option, answerTemplateId, effortId, passId, importId, showPings, bbox,
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
        if (answerFilter.option) p.set('option', answerFilter.option);
        if (answerTemplateId) p.set('surveyTemplateId', answerTemplateId);
      }
      if (effortId) p.set('effortId', effortId);
      if (passId) p.set('passId', passId);
      if (importId) p.set('importId', importId);
      if (showPings) p.set('includeActivities', '1');
      p.set('includeBounds', '1'); // campaign door extent, to frame the camera even with no knocks today
      if (bbox) p.set('bbox', bbox);
      return api(`/admin/households/map?${p.toString()}`);
    },
    enabled: !!cId,
    refetchInterval: live ? 20 * 1000 : false,
    // keepPreviousData so a bbox/filter/campaign key change never blanks the pins mid-fetch
    // (same idiom as books.jsx) — without it every viewport update unmounted every pin for the
    // fetch duration, which read as the whole map flashing.
    placeholderData: keepPreviousData,
    // Tabs keep this screen mounted forever once visited — pause the live poll
    // (and refresh on return) whenever another screen covers it.
    ...useFocusedPoll(),
  });

  // GPS-audit flags overlay — OPEN (unresolved) flags for the current scope. Reviewing one
  // removes it from the layer (it's no longer open), matching the web map + the open-count model.
  const flagsQ = useQuery({
    queryKey: ['admin', 'flags-map', cId, range?.from, range?.to, canvasserId],
    queryFn: () => {
      const p = new URLSearchParams({ campaignId: String(cId), reviewStatus: 'open', limit: '500' });
      if (range?.from) p.set('from', range.from);
      if (range?.to) p.set('to', range.to);
      if (canvasserId) p.set('userId', canvasserId);
      return api(`/admin/reports/flags?${p.toString()}`);
    },
    enabled: !!cId && showFlags,
    refetchInterval: live && showFlags ? 20 * 1000 : false,
    ...useFocusedPoll(),
  });

  // Overlap doors — opt-in highlight of houses knocked by 2+ distinct canvassers in the same
  // pass. DATE-SCOPED like every other layer here (the map is a filtered view), and it honors the
  // canvasser filter + effort/pass scope. The server still groups over the whole pass so it can
  // return `outOfRangeTotal` — same-pass collisions whose knocks fall outside these dates, which we
  // surface as a hint rather than drop. Returns householdIds; we ring whichever are loaded.
  const overlapDoorsQ = useQuery({
    queryKey: ['admin', 'overlap-doors', cId, effortId, passId, range?.from, range?.to, canvasserId],
    queryFn: () => {
      const p = new URLSearchParams({ campaignId: String(cId) });
      if (effortId) p.set('effortId', effortId);
      if (passId) p.set('passId', passId);
      if (range?.from) p.set('from', range.from);
      if (range?.to) p.set('to', range.to);
      if (canvasserId) p.set('userId', canvasserId);
      return api(`/admin/reports/overlap-doors?${p.toString()}`);
    },
    enabled: !!cId && showOverlaps,
    // Deliberately NOT polled: a whole-pass aggregation whose answer barely moves minute to minute.
    // One fetch when the toggle goes on, and again only when the scope changes.
    refetchInterval: false,
    ...useFocusedPoll(),
  });

  const households = mapQ.data?.households || [];
  const activities = mapQ.data?.activities || [];
  const canvassers = mapQ.data?.canvassers || [];
  const bounds = mapQ.data?.bounds || null; // date-independent campaign door extent (for camera framing)
  const flagEntries = flagsQ.data?.entries || [];
  const openFlagCount = flagsQ.data?.summary?.totals?.open ?? 0;

  // Frame the camera on the campaign's doors once, when data first arrives: the doors
  // currently shown if any, else the campaign's full door extent — so opening on "today"
  // before anyone has knocked lands on the real neighborhood, not the default fallback.
  // Runs once per campaign; the viewport-bbox machinery takes over after the user pans.
  useEffect(() => {
    if (framedRef.current || householdFocus) return;
    if (!mapQ.data || !cameraRef.current) return;
    let box = null;
    const pts = households.filter((h) => h.location);
    if (pts.length) {
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const h of pts) {
        if (h.location.lng < minLng) minLng = h.location.lng;
        if (h.location.lng > maxLng) maxLng = h.location.lng;
        if (h.location.lat < minLat) minLat = h.location.lat;
        if (h.location.lat > maxLat) maxLat = h.location.lat;
      }
      box = { minLng, minLat, maxLng, maxLat };
    } else if (bounds) {
      box = bounds;
    }
    if (!box) return; // no doors + no extent (campaign has no geocoded doors) → keep default
    framedRef.current = true;
    // A single door (or a near-zero span) would over-zoom fitBounds — center on it instead.
    if (box.maxLng - box.minLng < 1e-4 && box.maxLat - box.minLat < 1e-4) {
      cameraRef.current.setCamera({ centerCoordinate: [box.minLng, box.minLat], zoomLevel: 15, animationDuration: 0 });
    } else {
      cameraRef.current.fitBounds([box.maxLng, box.maxLat], [box.minLng, box.minLat], [60, 60, 60, 60], 0);
    }
  }, [mapQ.data, households, bounds, householdFocus]);

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

  // Focus a door arriving from a Notes "view on map" link (?household=). The door's
  // note may fall outside the current view — an old date, or a status/canvasser/
  // answer filter or effort scope left on this mounted map — so first clear EVERY
  // server-side filter (mirroring the web map's fresh-mount defaults) so the door is
  // guaranteed to load, then fly to it + open its sheet on the next run. Keyed on a
  // per-tap token so it fires once per tap (not on every 20s poll) yet re-focuses on
  // a repeat or different-door link; the campaign-change effect clears the guard.
  useEffect(() => {
    if (!householdFocus) return;
    if (focusedHouseholdRef.current === focusToken) return;
    const filtered =
      range.preset !== 'all' ||
      statusFilter.length ||
      canvasserId ||
      answerFilter.questionKey ||
      effortId ||
      passId ||
      importId;
    if (filtered) {
      setRange({ preset: 'all', from: null, to: null });
      setStatusFilter([]);
      setCanvasserId('');
      setAnswerFilter({ questionKey: '', optionId: '', option: '', label: '', templateId: '' });
      setScope({ effortId: '', passId: '', importId: '' });
      return; // wait for the unfiltered set, then focus on the next run
    }
    // Door not yet in the loaded set? Do nothing — this re-runs when householdsById
    // next changes (the widened/new-campaign data arriving), and focuses then. We
    // deliberately DON'T "give up" on a miss: during a cross-campaign switch the old
    // campaign's set is settled but lacks this (other-campaign) door, and giving up
    // there would clear the param before the right campaign loads.
    const h = householdsById.get(String(householdFocus));
    if (h?.location?.lat != null && h?.location?.lng != null) {
      setSelectedPing(null);
      setSelectedFlagId(null);
      setSelected(h);
      cameraRef.current?.setCamera({
        centerCoordinate: [h.location.lng, h.location.lat],
        zoomLevel: 17,
        animationDuration: 600,
      });
      focusedHouseholdRef.current = focusToken;
      // Hold the all-time widen (so the focused pin stays put), then strip the
      // consumed param — a tab press re-applies existing route params, so leaving
      // it would pin the map to all-time forever. Marking the range touched here
      // stops the reseed from snapping to today (which would drop the old door's
      // pin) the instant the param clears; a campaign switch resets both.
      dateTouchedRef.current = true;
      router.setParams({ household: '', focusAt: '', hcid: '' });
    } else if (focusCid && String(focusCid) === String(cId) && mapQ.isSuccess && !mapQ.isFetching) {
      // The door's OWN campaign is now loaded and settled, but the door still isn't
      // focusable (no map coordinates, or not returned). Give up: stop re-checking each
      // poll and drop the consumed params (the range self-heals to today). Requiring
      // cId to already equal the door's campaign means this can't fire on a stale
      // other-campaign result during a switch.
      focusedHouseholdRef.current = focusToken;
      router.setParams({ household: '', focusAt: '', hcid: '' });
      setMapNotice('This door has no map location');
      clearTimeout(mapNoticeTimer.current);
      mapNoticeTimer.current = setTimeout(() => setMapNotice(null), 3000);
    }
  }, [
    focusToken,
    householdFocus,
    householdsById,
    range.preset,
    statusFilter,
    canvasserId,
    answerFilter.questionKey,
    effortId,
    passId,
    importId,
    focusCid,
    cId,
    mapQ.isSuccess,
    mapQ.isFetching,
  ]);

  // Seed the audit filters from an answer-drill "View on map" link (?seedAt=…) —
  // one-shot, modeled on the household focus above. Keyed on a per-tap nonce so a
  // repeat link re-seeds but background re-renders don't; consumed params are
  // stripped (a bare tab press re-delivers route params — leaving them would
  // re-seed forever). Waits until the seed's own campaign (?scid=, saved active
  // by the sender before pushing) is the one loaded: the campaign-change effects
  // above reset the range/filters, so seeding before the switch would be stomped.
  // Defined AFTER those effects so that on the switch commit this runs last.
  const seedNonce = one(params.seedAt);
  const seedCid = one(params.scid);
  const seededRef = useRef(null);
  useEffect(() => {
    if (!seedNonce || seededRef.current === seedNonce) return;
    if (seedCid && String(seedCid) !== String(cId)) return; // re-runs when cId catches up
    seededRef.current = seedNonce;
    const qk = one(params.questionKey) || '';
    const oid = one(params.optionId) || '';
    const alabel = one(params.alabel) || '';
    const stid = one(params.surveyTemplateId) || '';
    const uid = one(params.userId) || '';
    const f = one(params.from) || '';
    const t = one(params.to) || '';
    setAnswerFilter(
      qk
        ? { questionKey: qk, optionId: oid, option: alabel, label: alabel, templateId: stid }
        : { questionKey: '', optionId: '', option: '', label: '', templateId: '' }
    );
    setCanvasserId(uid);
    // Show exactly what the drill list showed: no lingering status/effort narrowing.
    setStatusFilter([]);
    setScope({ effortId: '', passId: '', importId: '' });
    // Mirror the drill's window: explicit bounds → custom range; none → the drill
    // was all-time. Marked touched so the tz reseed can't snap it back to today.
    dateTouchedRef.current = true;
    setRange(f || t ? { preset: 'custom', from: f || null, to: t || null } : { preset: 'all', from: null, to: null });
    // Drop the viewport bound + re-frame on the seeded subset once it loads (same
    // reset as a campaign change) — else the pull stays clipped to wherever the
    // map was last parked and the drill's doors may sit off-screen.
    setBbox(null);
    bboxArmedRef.current = false;
    lastBoundsRef.current = null;
    framedRef.current = false;
    router.setParams({ questionKey: '', optionId: '', alabel: '', surveyTemplateId: '', userId: '', from: '', to: '', seedAt: '', scid: '' });
  }, [seedNonce, seedCid, cId]);

  const lineFeatures = useMemo(
    () => (showPings ? linesToFeatures(activities, householdsById) : { type: 'FeatureCollection', features: [] }),
    [showPings, activities, householdsById]
  );

  const activitiesById = useMemo(() => {
    const m = new Map();
    for (const a of activities) m.set(String(a.id), a);
    return m;
  }, [activities]);

  const flagFeatures = useMemo(
    () => (showFlags ? flagsToFeatures(flagEntries) : { type: 'FeatureCollection', features: [] }),
    [showFlags, flagEntries]
  );
  const flagsById = useMemo(() => {
    const m = new Map();
    for (const e of flagEntries) m.set(String(e.actionId), e);
    return m;
  }, [flagEntries]);
  const selectedFlag = selectedFlagId ? flagsById.get(String(selectedFlagId)) : null;

  // Overlap doors → an amber ring on whichever loaded households are in the overlap set.
  // The endpoint returns ids only, so we intersect with the currently loaded (date/
  // viewport-scoped) pins; switch the date to "All time" to surface every overlap.
  const overlapIds = useMemo(
    () => new Set((overlapDoorsQ.data?.householdIds || []).map(String)),
    [overlapDoorsQ.data]
  );
  const overlapFeatures = useMemo(() => {
    if (!showOverlaps || overlapIds.size === 0) return { type: 'FeatureCollection', features: [] };
    return {
      type: 'FeatureCollection',
      features: households
        .filter((h) => h.location?.lat != null && h.location?.lng != null && overlapIds.has(String(h.id)))
        .map((h) => ({
          type: 'Feature',
          id: String(h.id),
          properties: { id: String(h.id) },
          geometry: { type: 'Point', coordinates: [h.location.lng, h.location.lat] },
        })),
    };
  }, [showOverlaps, households, overlapIds]);
  const overlapDoorCount = overlapDoorsQ.data?.total ?? 0;
  const overlapOutOfRange = overlapDoorsQ.data?.outOfRangeTotal ?? 0;
  const overlapDoors = overlapDoorsQ.data?.doors || [];

  // Selected-door detail (web parity). `hhRounds` is the per-pass history; the inline
  // overlap badge fires when any single pass has 2+ distinct canvassers among its
  // knock+survey entries, and names them. `hhSurveyDetailById` merges the lazily-loaded
  // answers onto the survey meta already on the household.
  const hhRounds = hhActivityQ.data?.rounds || [];
  const hhSurveyDetailById = useMemo(
    () => new Map((hhSurveysQ.data?.surveys || []).map((s) => [s.id, s])),
    [hhSurveysQ.data]
  );
  // Per-pass overlap, counted EXACTLY like the authoritative /overlap-doors ring so the badge
  // and the map can never disagree: distinct canvassers by USER ID (not display name) among
  // OVERLAP_KNOCK_ACTIONS only (restricted is a marker, not a knock — excluded, matching the
  // server's KNOCK_ACTIONS). Keyed by passId → Map(id → name). Matches web HouseholdDetailPanel.
  const overlapByPass = useMemo(() => {
    const m = new Map();
    for (const r of hhActivityQ.data?.rounds || []) {
      const byId = new Map();
      for (const e of r.entries || []) {
        if (!OVERLAP_KNOCK_ACTIONS.has(e.actionType)) continue;
        const id = e.canvasserId || e.canvasser; // fall back to name only if an old server omits the id
        if (id) byId.set(id, e.canvasser || 'Unknown');
      }
      if (byId.size >= 2) m.set(r.passId || 'none', byId);
    }
    return m;
  }, [hhActivityQ.data]);
  const hasOverlap = overlapByPass.size > 0;
  // Name the colliding canvassers OTHER than this door's own status owner (its last action)
  // — "also worked by …" reads relative to whoever owns the door now.
  const primaryId = selected?.lastAction?.canvasser?.id || null;
  const primaryName = selected?.lastAction?.canvasser
    ? `${selected.lastAction.canvasser.firstName || ''} ${selected.lastAction.canvasser.lastName || ''}`.trim()
    : '';
  const overlapOthers = useMemo(() => {
    const s = new Map();
    for (const byId of overlapByPass.values()) {
      for (const [id, nm] of byId) {
        if (primaryId ? id !== primaryId : nm !== primaryName) s.set(id, nm);
      }
    }
    return [...s.values()];
  }, [overlapByPass, primaryId, primaryName]);

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

  // Settled camera move → update the viewport bound. Armed only once the camera has actually
  // shown ≥1 loaded door, so a stray initial viewport (camera mounted before data, or pointed
  // at the default center) can never misbound the first refetch; after arming it tracks the
  // viewport freely (self-correcting — pan somewhere and that's what gets fetched).
  //
  // Two guards keep this from feeding back on itself (onMapIdle also fires after every
  // data-driven re-render, with slightly jittering bounds):
  //   • EPSILON GATE — a new viewport counts only when an edge moved > 5% of the visible span.
  //     Render jitter is orders of magnitude below that; a real pan/zoom always clears it.
  //   • PADDING — the bbox actually sent is widened ~10% per side, so sub-threshold drags stay
  //     inside the already-fetched area (no edge pop-in, no refetch needed).
  async function handleMapIdle() {
    if (!mapRef.current || !mapQ.data) return;
    let b;
    try {
      b = await mapRef.current.getVisibleBounds(); // [[neLng, neLat], [swLng, swLat]]
    } catch {
      return; // map not ready yet
    }
    const [[neLng, neLat], [swLng, swLat]] = b;
    if (!bboxArmedRef.current) {
      const anyVisible = households.some(
        (h) =>
          h.location &&
          h.location.lng >= swLng && h.location.lng <= neLng &&
          h.location.lat >= swLat && h.location.lat <= neLat
      );
      if (!anyVisible) return;
      bboxArmedRef.current = true;
    }

    const raw = { w: swLng, s: swLat, e: neLng, n: neLat };
    const spanLng = Math.max(raw.e - raw.w, 0.0001);
    const spanLat = Math.max(raw.n - raw.s, 0.0001);
    const last = lastBoundsRef.current;
    if (last) {
      const moved =
        Math.abs(raw.w - last.w) > spanLng * 0.05 ||
        Math.abs(raw.e - last.e) > spanLng * 0.05 ||
        Math.abs(raw.s - last.s) > spanLat * 0.05 ||
        Math.abs(raw.n - last.n) > spanLat * 0.05;
      if (!moved) return;
    }
    lastBoundsRef.current = raw;

    const r = (x) => Math.round(x * 10000) / 10000; // ~11m precision — stable query keys
    const padLng = spanLng * 0.1;
    const padLat = spanLat * 0.1;
    setBbox(
      [
        r(raw.w - padLng),
        r(Math.max(raw.s - padLat, -90)),
        r(raw.e + padLng),
        r(Math.min(raw.n + padLat, 90)),
      ].join(',')
    );
  }

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
        setSelectedFlagId(null);
        setSelectedPing(a);
      }
    },
    [activitiesById, moveTarget]
  );

  const onFlagPress = useCallback(
    (e) => {
      if (moveTarget) return;
      const f = e.features?.[0];
      if (!f) return;
      setSelected(null);
      setSelectedPing(null);
      setSelectedFlagId(String(f.properties?.actionId));
    },
    [moveTarget]
  );

  useEffect(() => () => {
    clearTimeout(flagFlashTimer.current);
    clearTimeout(mapNoticeTimer.current);
  }, []);
  function onFlagReviewed(review) {
    const status = review?.status || 'updated';
    setFlagFlash(FLAG_FLASH_LABEL[status] || 'updated');
    clearTimeout(flagFlashTimer.current);
    flagFlashTimer.current = setTimeout(() => setFlagFlash(null), 2500);
    setSelectedFlagId(null); // reviewed → no longer open → leaves the layer
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
      <Mapbox.MapView ref={mapRef} style={{ flex: 1 }} styleURL={styleURL} onMapIdle={handleMapIdle}>
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{ centerCoordinate: initialCenter, zoomLevel: 12 }}
          animationMode="flyTo"
          animationDuration={500}
        />
        {/* Plain location dot (no compass) to avoid continuous magnetometer use.
            Focus-gated so GPS stops while another screen covers this tab. */}
        <Mapbox.UserLocation visible={isFocused} />

        <Mapbox.Images
          images={{
            'house-unknocked': require('../../../assets/icons/house-unknocked.png'),
            'house-not_home': require('../../../assets/icons/house-not_home.png'),
            'house-surveyed': require('../../../assets/icons/house-surveyed.png'),
            'house-wrong_address': require('../../../assets/icons/house-wrong_address.png'),
            'house-refused': require('../../../assets/icons/house-refused.png'),
            'house-restricted': require('../../../assets/icons/house-restricted.png'),
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

        {/* Overlap highlight — an amber ring beneath any household knocked by 2+ distinct
            canvassers in the same pass (opt-in "Overlaps" toggle). Under the house icon so
            the pin stays legible; not pressable — tap the pin to open its detail + badge. */}
        {showOverlaps && (
          <Mapbox.ShapeSource id="admin-overlaps" shape={overlapFeatures}>
            <Mapbox.CircleLayer
              id="admin-overlap-halo"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 14, 14, 20, 17, 28],
                circleColor: colors.warn,
                circleOpacity: 0.16,
              }}
            />
            <Mapbox.CircleLayer
              id="admin-overlap-ring"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 17, 17, 24],
                circleColor: 'rgba(0,0,0,0)',
                circleStrokeColor: colors.warn,
                circleStrokeWidth: 3,
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
                'restricted', 'house-restricted',
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
                  'restricted', colors.status.restricted,
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

        {showFlags && (
          <Mapbox.ShapeSource id="admin-flags" shape={flagFeatures} onPress={onFlagPress}>
            <Mapbox.CircleLayer
              id="admin-flag-halo"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 16, 14, 22, 17, 30],
                circleColor: ['get', 'color'],
                circleOpacity: 0.18,
              }}
            />
            <Mapbox.CircleLayer
              id="admin-flag-dots"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 8, 14, 11, 17, 14],
                circleColor: ['get', 'color'],
                circleStrokeColor: '#ffffff',
                circleStrokeWidth: 2,
                circleOpacity: ['case', ['==', ['get', 'reviewed'], 1], 0.45, 1],
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

        {/* Selection highlight — a bold ring around the door last tapped or focused via
            a Notes "view on map" link, so it's obvious which door is selected. Topmost. */}
        {selected && !moveTarget && (
          <Mapbox.ShapeSource id="admin-selected" shape={pointFeatures(selected)}>
            <Mapbox.CircleLayer
              id="admin-selected-ring"
              style={{
                circleRadius: ['interpolate', ['linear'], ['zoom'], 10, 12, 13, 16, 16, 20, 18, 24],
                circleColor: 'rgba(0,0,0,0)',
                circleStrokeColor: '#2563eb',
                circleStrokeWidth: 4,
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
          {/* Row 1: the filters, horizontally scrollable (content-width chips). */}
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

          {/* Row 2: the layer toggle switches, stretched to fill the width like row 1 —
              each an equal share, so the two rows read as one uniform grid. */}
          <View style={styles.subBar}>
            <View style={[styles.toggleChip, styles.chipFill]}>
              <Switch style={styles.miniSwitch} value={showPings} onValueChange={setShowPings} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.card} />
              <Text style={styles.toggleLabel}>Pings</Text>
            </View>
            <View style={[styles.toggleChip, styles.chipFill]}>
              <Switch style={styles.miniSwitch} value={showFlags} onValueChange={setShowFlags} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.card} />
              <Text style={styles.toggleLabel}>Flags</Text>
              {showFlags && openFlagCount > 0 ? (
                <View style={styles.flagBadge}>
                  <Text style={styles.flagBadgeText}>{openFlagCount}</Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.toggleChip, styles.chipFill]}>
              <Switch style={styles.miniSwitch} value={showOverlaps} onValueChange={setShowOverlaps} trackColor={{ true: colors.brand, false: colors.border }} thumbColor={colors.card} />
              <Text style={styles.toggleLabel}>Overlaps</Text>
              {showOverlaps && overlapDoorCount > 0 ? (
                <View style={styles.overlapBadge}>
                  <Text style={styles.overlapBadgeText}>{overlapDoorCount}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Overlap review line — the ring says WHICH doors, this says WHO and WHEN. Only while
              the layer is on and there is something to say. */}
          {showOverlaps && (overlapDoorCount > 0 || overlapOutOfRange > 0) ? (
            <View style={styles.overlapReviewRow}>
              {overlapDoorCount > 0 ? (
                <Pressable onPress={() => setShowOverlapList(true)} hitSlop={6}>
                  <Text style={styles.overlapReviewLink}>
                    ⚠ {overlapDoorCount} double-knocked · Review
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.overlapReviewMuted}>No double-knocks in these dates</Text>
              )}
              {overlapOutOfRange > 0 ? (
                <Text style={styles.overlapReviewMuted}>+{overlapOutOfRange} outside your dates</Text>
              ) : null}
            </View>
          ) : null}

          {/* Row 3: live status (left) + the house count (right). */}
          <View style={styles.statusBar}>
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={mapQ.isFetching}
              updatedAt={mapQ.dataUpdatedAt}
              onRefresh={() => mapQ.refetch()}
            />
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
                  dateTouchedRef.current = true;
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
              <MenuItem label="Any answer" active={!answerFilter.questionKey} onPress={() => { setAnswerFilter({ questionKey: '', optionId: '', option: '', label: '', templateId: '' }); setOpenMenu(null); }} />
              {surveyQuestions.map((q) => (
                <View key={q.key}>
                  <Text style={styles.menuGroup}>{q.label}</Text>
                  {q.options.filter((o) => !o.retired).map((o) => (
                    <MenuItem
                      key={o.id || o.option}
                      label={o.option}
                      active={
                        answerFilter.questionKey === q.key &&
                        (answerFilter.optionId ? answerFilter.optionId === o.id : answerFilter.option === o.option)
                      }
                      onPress={() => { setAnswerFilter({ questionKey: q.key, optionId: o.id, option: o.option, label: o.option, templateId: String(surveyQ.data?.surveyTemplate?.id || '') }); setOpenMenu(null); }}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </SafeAreaView>

      {/* Overlap review — who double-knocked what, and when. Doors outside the loaded viewport
          still list (the endpoint isn't viewport-bound); they just have no address to show. */}
      <Modal
        visible={showOverlapList}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOverlapList(false)}
      >
        <Pressable style={styles.overlapBackdrop} onPress={() => setShowOverlapList(false)}>
          <Pressable style={styles.overlapSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.overlapSheetHeader}>
              <Text style={styles.overlapSheetTitle}>Double-knocked doors ({overlapDoors.length})</Text>
              <Pressable onPress={() => setShowOverlapList(false)} hitSlop={8}>
                <Text style={styles.overlapSheetClose}>×</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
              {overlapDoors.map((d) => {
                const h = households.find((x) => String(x.id) === String(d.householdId));
                return (
                  <View key={String(d.householdId)} style={styles.overlapDoorRow}>
                    <Text style={styles.overlapDoorAddress}>
                      {h ? h.addressLine1 : 'Door outside the current view'}
                    </Text>
                    {d.passes.map((p) => (
                      <View key={p.passId || 'legacy'} style={{ marginTop: 4 }}>
                        <Text style={styles.overlapPassLabel}>{p.roundLabel}</Text>
                        {p.canvassers.map((c) => (
                          <View key={c.userId} style={styles.overlapCanvasserRow}>
                            <Text style={c.inRange ? styles.overlapNameIn : styles.overlapNameOut}>
                              {c.name}{c.inRange ? '' : ' (earlier)'}
                            </Text>
                            <Text style={styles.overlapWhen}>{formatExact(c.lastAt, tz)}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Custom date range picker — opened from the date chip's "Custom" item. */}
      <DateRangePickerModal
        visible={datePickerOpen}
        initialFrom={range.from}
        initialTo={range.to}
        tz={tz}
        onClose={() => setDatePickerOpen(false)}
        onApply={({ from, to }) => {
          dateTouchedRef.current = true;
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
              {selected.coordSource === 'corrected' ? (
                <Text style={styles.coordChipCorrected}>
                  ● Pin corrected
                  {selected.correctedAt ? ` · ${formatInTz(selected.correctedAt, tz, { month: 'short', day: 'numeric' }, false)}` : ''}
                </Text>
              ) : selected.coordConfidence === 'interpolated' ? (
                <Text style={styles.coordChipApprox}>● Approximate location</Text>
              ) : null}
            </View>
            <View style={[styles.statusPill, { borderColor: colors.status[selected.status] || colors.border }]}>
              <View style={[styles.statusDot, { backgroundColor: colors.status[selected.status] }]} />
              <Text style={styles.statusText}>{colors.statusLabels[selected.status]}</Text>
            </View>
          </View>

          {/* Inline overlap badge — same detection as web: any single pass worked by 2+
              distinct canvassers among its knock+survey entries. Names the OTHERS. */}
          {hasOverlap && (
            <View style={styles.overlapWarnBadge}>
              <Text style={styles.overlapWarnText}>⚠ Overlap</Text>
              {overlapOthers.length > 0 && (
                <Text style={styles.overlapWarnSub}>
                  Also worked by {overlapOthers.join(', ')}{' '}
                  {overlapByPass.size > 1 ? 'in the same pass' : 'this pass'}
                </Text>
              )}
            </View>
          )}

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {selected.lastAction && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Last action</Text>
                <Text style={styles.detailValue}>{actionLabel(selected.lastAction.actionType)}</Text>
                <Text style={styles.detailSub}>
                  {timeAgo(selected.lastAction.timestamp)}
                  {selected.lastAction.canvasser
                    ? ` · ${selected.lastAction.canvasser.firstName} ${selected.lastAction.canvasser.lastName}`
                    : ''}
                </Text>
                <Text style={styles.detailTimestamp}>
                  {formatExact(selected.lastAction.timestamp, tz)}
                </Text>
              </View>
            )}

            {hhRounds.length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>History by pass</Text>
                {hhRounds.map((r) => (
                  <View key={r.passId || 'none'} style={styles.roundBlock}>
                    <View style={styles.roundHeadingRow}>
                      <Text style={styles.roundHeading}>
                        {r.roundNumber != null ? `Pass ${r.roundNumber}` : r.name}
                        {r.roundNumber != null && r.name ? (
                          <Text style={styles.roundHeadingSub}> · {r.name}</Text>
                        ) : null}
                      </Text>
                      {overlapByPass.has(r.passId || 'none') && (
                        <View style={styles.roundOverlapChip}>
                          <Text style={styles.roundOverlapChipText}>⚠ Overlap</Text>
                        </View>
                      )}
                    </View>
                    {r.entries.map((e, i) => (
                      <View key={i} style={styles.historyEntry}>
                        <View
                          style={[styles.historyDot, { backgroundColor: actionColor(colors, e.actionType) }]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyText}>
                            {actionLabel(e.actionType)}
                            {e.canvasser ? ` · ${e.canvasser}` : ''}
                          </Text>
                          <Text style={styles.historyTimestamp}>{formatExact(e.at, tz)}</Text>
                          {e.note ? (
                            <View style={styles.noteBox}>
                              <Text style={styles.noteText}>{e.note}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            )}

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Voters ({selected.voters?.length || 0})</Text>
              {selected.voters?.length ? (
                selected.voters.map((v) => (
                  <View key={v.id} style={styles.voterLine}>
                    <Text style={styles.voterLineName} numberOfLines={1}>
                      {v.fullName}
                    </Text>
                    <View style={styles.voterLineRight}>
                      {v.party ? (
                        <View style={styles.partyPill}>
                          <Text style={styles.partyPillText}>{v.party}</Text>
                        </View>
                      ) : null}
                      {v.surveyStatus === 'surveyed' ? (
                        <View style={styles.surveyedPill}>
                          <Text style={styles.surveyedPillText}>surveyed</Text>
                        </View>
                      ) : (
                        <View style={styles.notSurveyedPill}>
                          <Text style={styles.notSurveyedPillText}>not surveyed</Text>
                        </View>
                      )}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.detailEmpty}>No voters on file.</Text>
              )}
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Surveys ({selected.surveys?.length || 0})</Text>
              {selected.surveys?.length ? (
                selected.surveys.map((s) => {
                  const answers = hhSurveyDetailById.get(s.id)?.answers || [];
                  return (
                    <View key={s.id} style={styles.surveyCard}>
                      <View style={styles.surveyCardHead}>
                        <Text style={styles.surveyVoter} numberOfLines={1}>
                          {s.voter?.fullName || 'Unknown voter'}
                        </Text>
                        <Text style={styles.surveyWhen}>{formatExact(s.submittedAt, tz)}</Text>
                      </View>
                      {s.canvasser ? (
                        <Text style={styles.surveyBy}>
                          by {s.canvasser.firstName} {s.canvasser.lastName}
                        </Text>
                      ) : null}
                      {hhSurveysQ.isLoading ? (
                        <Text style={styles.surveyLoading}>Loading answers…</Text>
                      ) : null}
                      {answers.length > 0 ? (
                        <View style={styles.answerList}>
                          {answers.map((a, i) => (
                            <View key={i} style={styles.surveyAnswerRow}>
                              <Text style={styles.answerQuestion}>{a.questionLabel}</Text>
                              <Text style={styles.answerValue}>{formatAnswer(a.answer)}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                      {s.note ? (
                        <View style={styles.noteBox}>
                          <Text style={styles.noteText}>{s.note}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              ) : (
                <Text style={styles.detailEmpty}>No surveys at this household yet.</Text>
              )}
            </View>
          </ScrollView>

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

      {selectedFlag && (
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.flagSheetHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <Text style={styles.flagSheetTitle}>Flagged entry</Text>
              <FlagLegendHint />
            </View>
            <Pressable onPress={() => setSelectedFlagId(null)} hitSlop={8}>
              <Text style={styles.flagSheetClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <FlaggedEntryCard entry={selectedFlag} tz={tz} onReviewed={onFlagReviewed} defaultExpanded />
          </ScrollView>
        </SafeAreaView>
      )}

      {flagFlash && (
        <View style={styles.flagFlash} pointerEvents="none">
          <Text style={styles.flagFlashText}>✓ Flag {flagFlash}</Text>
        </View>
      )}

      {mapNotice && (
        <View style={styles.flagFlash} pointerEvents="none">
          <Text style={styles.flagFlashText}>{mapNotice}</Text>
        </View>
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
                    {formatDistance(dist)}{distFar ? ' — far from house' : ''}
                  </Text>
                )}
                {a.location?.accuracy != null && (
                  <Text style={styles.pingMetaSub}>
                    GPS accuracy ±{formatDistance(a.location.accuracy)}
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
    paddingTop: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  toggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // Same height as the row-1 filter chips; overflow:hidden so the native Switch can't push
    // this row taller (it's larger on Android).
    height: 36,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    gap: spacing.xs,
  },
  // Shrink the native switch so it fits the filter-chip-height pill on both platforms.
  miniSwitch: { transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] },
  toggleLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  // Row 3: live pill on the left, house count on the right.
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  flagBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagBadgeText: { fontSize: 11, fontWeight: '800', color: colors.danger },
  flagSheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  flagSheetTitle: { ...type.h3 },
  flagSheetClose: { color: colors.brand, fontWeight: '700', fontSize: 14 },
  flagFlash: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  flagFlashText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
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
  // Row 2's toggle chips stretch to fill the width (equal thirds).
  chipFill: { flex: 1, minWidth: 0 },
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

  // Overlaps toggle count badge (subBar) — amber, mirrors the flag badge.
  overlapReviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  overlapReviewLink: { fontSize: 12, fontWeight: '700', color: colors.warnFg },
  overlapReviewMuted: { fontSize: 11, color: colors.textMuted },

  overlapBackdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  overlapSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: '80%',
  },
  overlapSheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overlapSheetTitle: { ...type.h3, fontSize: 15 },
  overlapSheetClose: { fontSize: 22, color: colors.textMuted },
  overlapDoorRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overlapDoorAddress: { ...type.bodyStrong, fontSize: 13 },
  overlapPassLabel: { fontSize: 11, color: colors.textSecondary },
  overlapCanvasserRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  overlapNameIn: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  overlapNameOut: { fontSize: 12, color: colors.textMuted },
  overlapWhen: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'] },

  overlapBadge: {
    minWidth: 18,
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.warnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlapBadgeText: { fontSize: 11, fontWeight: '800', color: colors.warnFg },

  // Header pin-quality chips (web parity).
  coordChipCorrected: { color: colors.brand, fontSize: 12, fontWeight: '700', marginTop: 4 },
  coordChipApprox: { color: colors.warnFg, fontSize: 12, fontWeight: '700', marginTop: 4 },

  // Inline overlap warning banner inside the household sheet.
  overlapWarnBadge: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    borderRadius: radius.md,
  },
  overlapWarnText: { color: colors.warnFg, fontWeight: '700', fontSize: 13 },
  overlapWarnSub: { color: colors.warnFg, fontSize: 12, marginTop: 2 },

  // Household-detail sections (Last action / History by pass / Voters / Surveys).
  detailSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailLabel: { ...type.micro, marginBottom: 6 },
  detailValue: { ...type.bodyStrong, fontSize: 14 },
  detailSub: { ...type.caption, marginTop: 2 },
  detailTimestamp: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  detailEmpty: { ...type.caption },

  roundBlock: { marginTop: spacing.sm },
  roundHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  roundHeading: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, flexShrink: 1 },
  roundHeadingSub: { fontWeight: '400', color: colors.textSecondary },
  roundOverlapChip: {
    backgroundColor: colors.warnBg,
    borderWidth: 1,
    borderColor: colors.warnBorder,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  roundOverlapChipText: { fontSize: 10, fontWeight: '800', color: colors.warnFg },
  historyEntry: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  historyDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  historyText: { fontSize: 13, color: colors.textSecondary },
  historyTimestamp: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },

  voterLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: 6,
  },
  voterLineName: { fontSize: 14, color: colors.textPrimary, flex: 1 },
  voterLineRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  surveyedPill: {
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  surveyedPillText: { fontSize: 11, fontWeight: '700', color: colors.success },
  notSurveyedPill: {
    backgroundColor: colors.sunken,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  notSurveyedPillText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },

  surveyCard: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  surveyCardHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  surveyVoter: { ...type.bodyStrong, fontSize: 14, flex: 1 },
  surveyWhen: { fontSize: 11, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  surveyBy: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  surveyLoading: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  answerList: { marginTop: spacing.sm },
  surveyAnswerRow: { marginTop: spacing.sm },
  });
}
