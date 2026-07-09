import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData, useQueryClient } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import HouseholdDetailPanel from '../components/HouseholdDetailPanel.jsx';
import MapFilters from '../components/MapFilters.jsx';
import AddressSearch from '../components/AddressSearch.jsx';
import CanvasserPingPanel from '../components/CanvasserPingPanel.jsx';
import FlaggedEntryPanel from '../components/FlaggedEntryPanel.jsx';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import MapStyleControl from '../components/MapStyleControl.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import {
  householdsToGeoJSON,
  activitiesToPingsGeoJSON,
  activitiesToLinesGeoJSON,
  flagsToGeoJSON,
  flagsToLinesGeoJSON,
  pointToGeoJSON,
  FIRST_KNOCK_COLOR,
  LAST_KNOCK_COLOR,
  registerLayers,
} from '../lib/mapRender.js';

const DEFAULT_CENTER = [-95.7129, 37.0902]; // continental US
const DEFAULT_ZOOM = 3.5;

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(','));
    } else {
      sp.set(k, v);
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Verb shown in the brief post-review confirmation toast.
const FLAG_FLASH_LABEL = { reviewed: 'reviewed', dismissed: 'dismissed', confirmed: 'confirmed as an issue', open: 'reopened' };

export default function MapPage() {
  const [searchParams] = useSearchParams();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const qc = useQueryClient();
  const [mapReady, setMapReady] = useState(false);
  // Brief page-level confirmation after a flag review (the panel itself closes on refetch,
  // so the feedback has to live above it). Auto-dismisses.
  const [flagFlash, setFlagFlash] = useState(null);
  const flagFlashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flagFlashTimer.current), []);
  function onFlagReviewed(review) {
    const status = review?.status || 'updated';
    setFlagFlash(FLAG_FLASH_LABEL[status] || 'updated');
    clearTimeout(flagFlashTimer.current);
    flagFlashTimer.current = setTimeout(() => setFlagFlash(null), 2500);
    // Refresh this surface + mark the Audit page's flags query stale (cross-surface sync).
    qc.invalidateQueries({
      predicate: (q) =>
        (q.queryKey?.[0] === 'admin' && q.queryKey?.[1] === 'flags-map') ||
        (q.queryKey?.[0] === 'reports' && q.queryKey?.[1] === 'flags'),
    });
  }
  // A "View on map" deep-link from the Notes hub (?household=<id>) opens that household.
  const [selected, setSelected] = useState(() => searchParams.get('household') || null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const didFocusHouseholdRef = useRef(false);

  // "Move pin" mode: a draggable marker to correct a household's location.
  const moveMarkerRef = useRef(null);
  const [moveTarget, setMoveTarget] = useState(null); // the household being repositioned
  const [moveCoords, setMoveCoords] = useState(null); // { lng, lat } from the drag
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveErr, setMoveErr] = useState(null);

  const orgTz = useOrgTimeZone();
  // Default to Today. Seed from the org tz so the first paint (before the campaign loads)
  // isn't UTC; the effect below reseeds to the campaign's own "today" once its tz resolves.
  // A "View on map" deep-link from the Audit page can carry a window (?from/&to), a canvasser
  // (?userId), the flag layer (?flag=1), and one entry to focus (?focusActivityId). A Notes-hub
  // household link (?household=) needs ALL doors loaded (the Today default + interacted-only
  // filtering would otherwise hide an untouched household), so it opens on all-time.
  const [dateRange, setDateRange] = useState(() => {
    const f = searchParams.get('from');
    if (f) return { preset: 'custom', from: f, to: searchParams.get('to') || null };
    if (searchParams.get('household')) return defaultRange('all', orgTz);
    return defaultRange('today', orgTz);
  });
  const rangeTouchedRef = useRef(!!searchParams.get('from') || !!searchParams.get('household'));
  const [statusFilter, setStatusFilter] = useState([]);
  const [canvasserId, setCanvasserId] = useState(searchParams.get('userId') || '');
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '', optionId: '' });
  const [showCanvasserPins, setShowCanvasserPins] = useState(false);
  // Live auto-refresh of the map (web admins are at a desk + connected). Gates
  // the poll interval below; pauses automatically when the tab is backgrounded.
  const [live, setLive] = useState(true);
  // Basemap style picker (Street/Hybrid/Satellite/Outdoors/Dark) — independent of
  // the app theme. styleEpoch bumps after a style swap so the data-push effects
  // re-hydrate the freshly-recreated sources.
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  // Scoped audit: a deep-link from an Effort/Pass (?effortId / ?passId) narrows the
  // map to that scope. Seeded once from the URL; the chip's ✕ clears it.
  const [scopeEffortId, setScopeEffortId] = useState(searchParams.get('effortId') || '');
  const [scopePassId, setScopePassId] = useState(searchParams.get('passId') || '');
  const [scopeImportId, setScopeImportId] = useState(searchParams.get('importId') || '');

  // GPS-audit flag overlay. When deep-linked to a specific entry (?focusActivityId), start on
  // "all" statuses so that entry is present even if it's already been reviewed.
  const [showFlags, setShowFlags] = useState(searchParams.get('flag') === '1');
  const [flagReasonFilter, setFlagReasonFilter] = useState([]); // [] = all reasons
  const [reviewStatus, setReviewStatus] = useState(searchParams.get('focusActivityId') ? 'all' : 'open');
  const [selectedFlagId, setSelectedFlagId] = useState(searchParams.get('focusActivityId') || null);
  const didFocusFlagRef = useRef(false);

  const { campaignId } = useParams();
  const { selected: selectedCampaign } = useCampaignSelection(campaignId);
  // Anchor presets to the selected campaign's tz.
  const tz = selectedCampaign?.timeZone || orgTz;

  // Reseed the default "Today" to the campaign's own day once its tz is known (so it's the
  // campaign's today for every admin), unless the admin already picked a range.
  useEffect(() => {
    if (rangeTouchedRef.current) return;
    const campTz = selectedCampaign?.timeZone;
    if (campTz && campTz !== orgTz) setDateRange(defaultRange('today', campTz));
  }, [selectedCampaign?.timeZone, orgTz]);

  // Resolve a friendly name for the scope chip (reuses the cached efforts/passes lists).
  const scopeEffortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId && !!scopeEffortId,
  });
  const scopePassesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId && !!scopePassId,
  });
  let scopeLabel = null;
  if (scopeEffortId) {
    const e = (scopeEffortsQ.data?.efforts || []).find((x) => String(x._id) === scopeEffortId);
    scopeLabel = e ? e.name : 'Walk list';
  } else if (scopePassId) {
    const p = (scopePassesQ.data?.passes || []).find((x) => String(x._id) === scopePassId);
    scopeLabel = p ? `Pass ${p.roundNumber} · ${p.name}` : 'Pass';
  } else if (scopeImportId) {
    scopeLabel = "this import's homes";
  }
  function clearScope() {
    setScopeEffortId('');
    setScopePassId('');
    setScopeImportId('');
  }

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  const surveyQ = useQuery({
    queryKey: ['reports', 'survey-results', campaignId],
    queryFn: () =>
      api(`/admin/reports/survey-results${buildQuery({ campaignId })}`),
    enabled: !!campaignId && selectedCampaign?.type !== 'lit_drop',
  });

  const queryString = buildQuery({
    campaignId,
    from: dateRange.from,
    to: dateRange.to,
    status: statusFilter,
    userId: canvasserId,
    questionKey: answerFilter.questionKey,
    option: answerFilter.option,
    optionId: answerFilter.optionId,
    includeActivities: showCanvasserPins ? '1' : '',
    effortId: scopeEffortId,
    passId: scopePassId,
    importId: scopeImportId,
  });

  const householdsQ = useQuery({
    queryKey: [
      'admin',
      'households-map',
      campaignId,
      dateRange.from,
      dateRange.to,
      statusFilter.join(','),
      canvasserId,
      answerFilter.questionKey,
      answerFilter.option,
      answerFilter.optionId,
      showCanvasserPins,
      scopeEffortId,
      scopePassId,
      scopeImportId,
    ],
    queryFn: () => api(`/admin/households/map${queryString}`),
    enabled: !!campaignId,
    // Live polling: refresh pins/pings on a timer when "Live" is on. Pauses in a
    // backgrounded tab; keepPreviousData avoids blanking the map during a poll
    // (or a filter change) — the Mapbox sources just setData the new features.
    refetchInterval: live ? 20000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });

  const households = householdsQ.data?.households || [];
  const canvassers = householdsQ.data?.canvassers || [];
  const activities = householdsQ.data?.activities || [];

  // GPS-audit flags — a SEPARATE query (only when the layer is on) so toggling flags never
  // refetches households. Server returns the full per-reason summary (for the chip counts)
  // plus the entries for the current review status; reason chips filter client-side.
  const flagsQ = useQuery({
    queryKey: [
      'admin',
      'flags-map',
      campaignId,
      dateRange.from,
      dateRange.to,
      canvasserId,
      scopeEffortId,
      reviewStatus,
    ],
    queryFn: () =>
      api(
        `/admin/reports/flags${buildQuery({
          campaignId,
          from: dateRange.from,
          to: dateRange.to,
          userId: canvasserId,
          effortId: scopeEffortId,
          reviewStatus: reviewStatus === 'all' ? '' : reviewStatus,
          view: 'entries',
          limit: 500,
        })}`
      ),
    enabled: !!campaignId && showFlags,
    refetchInterval: live ? 20000 : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const flagEntries = flagsQ.data?.entries || [];
  const flagSummary = flagsQ.data?.summary || null;

  const shownFlags = useMemo(() => {
    if (!flagReasonFilter.length) return flagEntries;
    const set = new Set(flagReasonFilter);
    return flagEntries.filter((e) => e.reasons.some((r) => set.has(r.type)));
  }, [flagEntries, flagReasonFilter]);

  const selectedFlag = useMemo(
    () => flagEntries.find((e) => e.actionId === selectedFlagId) || null,
    [flagEntries, selectedFlagId]
  );

  function toggleFlagReason(key) {
    setFlagReasonFilter((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  // Safety net: if the selected canvasser somehow isn't in the roster (e.g. they
  // were deactivated), reset the filter so the controlled <select> can't wedge.
  useEffect(() => {
    if (canvasserId && canvassers.length && !canvassers.some((c) => c.id === canvasserId)) {
      setCanvasserId('');
    }
  }, [canvassers, canvasserId]);

  // Initialize the map once we have a token.
  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: appliedStyleRef.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');

    // Layer event handlers — bound ONCE; they reference layer IDs that get
    // recreated by registerLayers on each style swap, so they keep working.
    map.on('click', 'households-symbols', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      setSelected(f.properties.id);
      setSelectedActivityId(null);
    });
    map.on('mouseenter', 'households-symbols', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'households-symbols', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'canvasser-pings', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      setSelectedActivityId(f.properties.activityId);
      setSelected(null);
    });
    map.on('mouseenter', 'canvasser-pings', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'canvasser-pings', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'flagged-pings', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      setSelectedFlagId(f.properties.actionId);
      setSelected(null);
      setSelectedActivityId(null);
    });
    map.on('mouseenter', 'flagged-pings', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'flagged-pings', () => { map.getCanvas().style.cursor = ''; });

    map.on('load', () => {
      registerLayers(map, darkBase);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [tokenQ.data]);

  // Swap the basemap style when the picker changes. setStyle wipes our sources/
  // layers/images, so re-register them on `style.load`, then bump styleEpoch to
  // re-hydrate the data. _didFitBounds is preserved so the view isn't reset.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleURL) return;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      registerLayers(map, darkBase);
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    // Remove a still-pending handler if the style changes again before this
    // one loads — otherwise both fire on the final style and re-register.
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  // Push household features to the map source whenever data changes.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(households);
    src.setData(geojson);

    // Auto-fit on first load (only when bounds are valid and we haven't moved yet).
    if (geojson.features.length && !mapRef.current._didFitBounds) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [households, mapReady, styleEpoch]);

  const householdsById = useMemo(() => {
    const m = new Map();
    for (const h of households) m.set(h.id, h);
    return m;
  }, [households]);

  // Push canvasser activity GPS points + connecting lines.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const pingsSrc = mapRef.current.getSource('canvasser-pings');
    const linesSrc = mapRef.current.getSource('canvasser-lines');
    if (!pingsSrc || !linesSrc) return;
    const list = showCanvasserPins ? activities : [];
    pingsSrc.setData(activitiesToPingsGeoJSON(list));
    linesSrc.setData(activitiesToLinesGeoJSON(list, householdsById));
  }, [activities, householdsById, showCanvasserPins, mapReady, styleEpoch]);

  // Toggle layer visibility — instant, no refetch.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const vis = showCanvasserPins ? 'visible' : 'none';
    for (const id of ['canvasser-pings', 'canvasser-lines', 'canvasser-labels']) {
      if (mapRef.current.getLayer(id)) {
        mapRef.current.setLayoutProperty(id, 'visibility', vis);
      }
    }
  }, [showCanvasserPins, mapReady, styleEpoch]);

  // First & last knock — only when auditing ONE canvasser with pings on. The endpoint
  // already scopes `activities` to that userId + date window, so first = earliest ping,
  // last = most recent. Skip "last" when there's a single ping (don't double-mark it).
  const firstLastKnock = useMemo(() => {
    if (!canvasserId || !showCanvasserPins) return { first: null, last: null };
    const withLoc = activities.filter(
      (a) => a.location?.lng != null && a.location?.lat != null && a.timestamp
    );
    if (!withLoc.length) return { first: null, last: null };
    const sorted = [...withLoc].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return { first: sorted[0], last: sorted.length > 1 ? sorted[sorted.length - 1] : null };
  }, [canvasserId, showCanvasserPins, activities]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const firstSrc = mapRef.current.getSource('first-knock');
    const lastSrc = mapRef.current.getSource('last-knock');
    if (!firstSrc || !lastSrc) return;
    firstSrc.setData(pointToGeoJSON(firstLastKnock.first));
    lastSrc.setData(pointToGeoJSON(firstLastKnock.last));
  }, [firstLastKnock, mapReady, styleEpoch]);

  // Push the GPS-audit flag overlay (dots + lines to the house). Empty when the layer is off.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const pingsSrc = mapRef.current.getSource('flagged-pings');
    const linesSrc = mapRef.current.getSource('flagged-lines');
    if (!pingsSrc || !linesSrc) return;
    const list = showFlags ? shownFlags : [];
    pingsSrc.setData(flagsToGeoJSON(list));
    linesSrc.setData(flagsToLinesGeoJSON(list));
  }, [shownFlags, showFlags, mapReady, styleEpoch]);

  // Deep-link focus: when arriving via "View on map" (?focusActivityId), fly to that flag
  // once its data lands. Runs a single time so it doesn't fight later panning.
  useEffect(() => {
    if (didFocusFlagRef.current || !mapReady || !mapRef.current || !selectedFlagId) return;
    const e = flagEntries.find((x) => x.actionId === selectedFlagId);
    if (e?.location?.lng != null && e?.location?.lat != null) {
      mapRef.current.flyTo({ center: [e.location.lng, e.location.lat], zoom: 17, essential: true });
      didFocusFlagRef.current = true;
    }
  }, [mapReady, selectedFlagId, flagEntries]);

  // Deep-link focus: a Notes-hub household link (?household=<id>) opens on all-time (above), so once
  // the households load, fly to and open that household. One-shot.
  useEffect(() => {
    if (didFocusHouseholdRef.current || !mapReady || !mapRef.current) return;
    const hid = searchParams.get('household');
    if (!hid) return;
    const h = householdsById.get(hid);
    if (h?.location?.lng != null && h?.location?.lat != null) {
      mapRef.current.flyTo({ center: [h.location.lng, h.location.lat], zoom: 17, essential: true });
      setSelected(hid);
      didFocusHouseholdRef.current = true;
    }
  }, [mapReady, householdsById, searchParams]);

  const selectedHousehold = useMemo(
    () => households.find((h) => h.id === selected) || null,
    [selected, households]
  );

  // "Move pin" mode: drop a draggable marker at the target's current spot; the drag
  // updates moveCoords; Save PATCHes the new location and refetches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !moveTarget?.location) return undefined;
    const start = [moveTarget.location.lng, moveTarget.location.lat];
    setMoveCoords({ lng: start[0], lat: start[1] });
    const marker = new mapboxgl.Marker({ draggable: true, color: '#2563eb' }).setLngLat(start).addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      setMoveCoords({ lng: ll.lng, lat: ll.lat });
    });
    moveMarkerRef.current = marker;
    return () => { marker.remove(); moveMarkerRef.current = null; };
  }, [moveTarget]);

  async function saveMovedPin() {
    if (!moveTarget || !moveCoords) return;
    setMoveSaving(true);
    setMoveErr(null);
    try {
      await api(`/admin/campaigns/${campaignId}/households/${moveTarget.id}/location`, {
        method: 'PATCH',
        body: { lat: moveCoords.lat, lng: moveCoords.lng },
      });
      setMoveTarget(null);
      setMoveCoords(null);
      await householdsQ.refetch();
    } catch (err) {
      setMoveErr(err?.message || 'Could not move the pin.');
    } finally {
      setMoveSaving(false);
    }
  }

  const selectedActivity = useMemo(
    () => activities.find((a) => a.id === selectedActivityId) || null,
    [selectedActivityId, activities]
  );

  const selectedActivityHousehold = useMemo(
    () =>
      selectedActivity ? householdsById.get(selectedActivity.householdId) || null : null,
    [selectedActivity, householdsById]
  );

  function flyToHousehold(h) {
    if (!mapRef.current || !h?.location) return;
    mapRef.current.flyTo({
      center: [h.location.lng, h.location.lat],
      zoom: 16,
      essential: true,
    });
    setSelected(h.id);
    setSelectedActivityId(null);
  }

  if (tokenQ.isLoading) {
    return <div>Loading map…</div>;
  }
  if (!tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-tint p-6 text-sm text-warning-fg">
        <div className="text-base font-semibold">Mapbox token not configured</div>
        <p className="mt-2">
          Set <code className="rounded bg-warning/20 px-1 py-0.5">MAPBOX_PUBLIC_TOKEN</code> in
          your server <code className="rounded bg-warning/20 px-1 py-0.5">.env</code> file (a
          public token starting with <code>pk.</code>) and restart the server.
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{ flexShrink: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-6 py-3"
      >
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">Map</h1>
            {scopeLabel && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-2.5 py-0.5 text-xs font-medium text-brand-accent">
                Showing: {scopeLabel}
                <button
                  type="button"
                  onClick={clearScope}
                  className="text-brand-accent/70 hover:text-brand-accent"
                  aria-label="Clear scope"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>
              {householdsQ.isLoading
                ? 'Loading households…'
                : `${households.length.toLocaleString()} households shown`}
            </span>
            <span className="text-fg-subtle" aria-hidden="true">·</span>
            <LiveStatus
              live={live}
              onToggle={() => setLive((v) => !v)}
              isFetching={householdsQ.isFetching}
              updatedAt={householdsQ.dataUpdatedAt}
              onRefresh={() => householdsQ.refetch()}
            />
            {showFlags && flagSummary?.totals?.open > 0 && (
              <>
                <span className="text-fg-subtle" aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-tint px-2 py-0.5 font-medium text-danger">
                  ⚠ {flagSummary.totals.open.toLocaleString()} flagged
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AddressSearch households={households} onSelect={flyToHousehold} />
          <DateRangeSelector
            value={dateRange}
            onChange={(next) => {
              rangeTouchedRef.current = true;
              setDateRange(next);
            }}
            tz={tz}
          />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside
          style={{ flexShrink: 0, overflowY: 'auto' }}
          className="w-72 border-r border-border bg-card p-4"
        >
          <MapFilters
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            canvassers={canvassers}
            canvasserId={canvasserId}
            onCanvasserChange={setCanvasserId}
            survey={surveyQ.data}
            answerFilter={answerFilter}
            onAnswerChange={setAnswerFilter}
            statusColors={STATUS_COLORS}
            statusLabels={STATUS_LABELS}
            showCanvasserPins={showCanvasserPins}
            onShowCanvasserPinsChange={setShowCanvasserPins}
            showFlags={showFlags}
            onShowFlagsChange={setShowFlags}
            flagReasonFilter={flagReasonFilter}
            onFlagReasonToggle={toggleFlagReason}
            reviewStatus={reviewStatus}
            onReviewStatusChange={setReviewStatus}
            flagCounts={flagSummary?.totals || null}
          />
        </aside>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="absolute left-4 top-4 z-10 items-start" />
          {firstLastKnock.first && (
            <div
              style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 10 }}
              className="rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-lg"
            >
              <div className="flex items-center gap-2">
                <span style={{ width: 11, height: 11, borderRadius: 999, border: `2px solid ${FIRST_KNOCK_COLOR}` }} />
                <span className="text-fg-muted">Start (first knock)</span>
              </div>
              {firstLastKnock.last && (
                <div className="mt-1 flex items-center gap-2">
                  <span style={{ width: 11, height: 11, borderRadius: 999, border: `2px solid ${LAST_KNOCK_COLOR}` }} />
                  <span className="text-fg-muted">Latest knock</span>
                </div>
              )}
            </div>
          )}
          {selectedHousehold && !moveTarget && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 384,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <HouseholdDetailPanel
                household={selectedHousehold}
                onClose={() => setSelected(null)}
                onMovePin={() => { setMoveErr(null); setMoveTarget(selectedHousehold); }}
                statusColors={STATUS_COLORS}
                statusLabels={STATUS_LABELS}
                tz={tz}
              />
            </div>
          )}
          {moveTarget && (
            <div
              style={{ position: 'absolute', right: 16, top: 16, zIndex: 11, width: 320, maxWidth: 'calc(100% - 32px)' }}
              className="rounded-lg border border-border bg-card p-4 shadow-lg"
            >
              <div className="text-sm font-semibold text-fg">Move pin</div>
              <p className="mt-1 text-xs text-fg-muted">
                Drag the blue marker to <strong>{moveTarget.addressLine1}</strong>'s correct spot, then Save.
              </p>
              <p className="mt-2 rounded border border-warning/30 bg-warning-tint px-2 py-1.5 text-[11px] leading-snug text-warning-fg">
                Corrects the pin only — this door keeps its current book until you re-cut turf. Canvassers see the new
                spot on their next sync.
              </p>
              {moveErr && <div className="mt-2 text-xs text-danger">{moveErr}</div>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => { setMoveTarget(null); setMoveCoords(null); setMoveErr(null); }}
                  disabled={moveSaving}
                  className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-sunken"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMovedPin}
                  disabled={moveSaving}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {moveSaving ? 'Saving…' : 'Save location'}
                </button>
              </div>
            </div>
          )}
          {selectedActivity && !selectedHousehold && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 320,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <CanvasserPingPanel
                activity={selectedActivity}
                household={selectedActivityHousehold}
                onOpenHousehold={(id) => {
                  setSelectedActivityId(null);
                  setSelected(id);
                }}
                onClose={() => setSelectedActivityId(null)}
                tz={tz}
              />
            </div>
          )}
          {selectedFlag && !selectedHousehold && !selectedActivity && !moveTarget && (
            <div
              style={{
                position: 'absolute',
                right: 16,
                top: 16,
                zIndex: 10,
                width: 340,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'calc(100% - 32px)',
                overflowY: 'auto',
              }}
              className="rounded-lg border border-border bg-card shadow-lg"
            >
              <FlaggedEntryPanel
                entry={selectedFlag}
                household={householdsById.get(selectedFlag.householdId) || selectedFlag.household}
                onOpenHousehold={(id) => {
                  setSelectedFlagId(null);
                  setSelected(id);
                }}
                onReviewed={(review) => onFlagReviewed(review)}
                onClose={() => setSelectedFlagId(null)}
                tz={tz}
              />
            </div>
          )}
          {flagFlash && (
            <div
              style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
              className="rounded-full bg-fg px-3 py-1.5 text-xs font-medium text-bg shadow-lg"
            >
              ✓ Flag {flagFlash}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
