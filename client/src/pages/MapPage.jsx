import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import DateRangeSelector, { defaultRange } from '../components/DateRangeSelector.jsx';
import HouseholdDetailPanel from '../components/HouseholdDetailPanel.jsx';
import MapFilters from '../components/MapFilters.jsx';
import AddressSearch from '../components/AddressSearch.jsx';
import CanvasserPingPanel from '../components/CanvasserPingPanel.jsx';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import MapStyleControl from '../components/MapStyleControl.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import LiveStatus from '../components/LiveStatus.jsx';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import {
  householdsToGeoJSON,
  activitiesToPingsGeoJSON,
  activitiesToLinesGeoJSON,
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

export default function MapPage() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);

  const [dateRange, setDateRange] = useState(() => defaultRange('all'));
  const [statusFilter, setStatusFilter] = useState([]);
  const [canvasserId, setCanvasserId] = useState('');
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '' });
  const [showCanvasserPins, setShowCanvasserPins] = useState(false);
  // Live auto-refresh of the map (web admins are at a desk + connected). Gates
  // the poll interval below; pauses automatically when the tab is backgrounded.
  const [live, setLive] = useState(true);
  const orgTz = useOrgTimeZone();
  // Basemap style picker (Street/Hybrid/Satellite/Outdoors/Dark) — independent of
  // the app theme. styleEpoch bumps after a style swap so the data-push effects
  // re-hydrate the freshly-recreated sources.
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  // Scoped audit: a deep-link from an Effort/Pass (?effortId / ?passId) narrows the
  // map to that scope. Seeded once from the URL; the chip's ✕ clears it.
  const [searchParams] = useSearchParams();
  const [scopeEffortId, setScopeEffortId] = useState(searchParams.get('effortId') || '');
  const [scopePassId, setScopePassId] = useState(searchParams.get('passId') || '');

  const {
    campaignId,
    setCampaignId,
    campaigns,
    selected: selectedCampaign,
    isLoading: campaignsLoading,
  } = useCampaignSelection();
  // Anchor presets to the selected campaign's tz (default range is all-time, which needs none).
  const tz = selectedCampaign?.timeZone || orgTz;

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
    scopeLabel = e ? e.name : 'Effort';
  } else if (scopePassId) {
    const p = (scopePassesQ.data?.passes || []).find((x) => String(x._id) === scopePassId);
    scopeLabel = p ? `Pass ${p.roundNumber} · ${p.name}` : 'Pass';
  }
  function clearScope() {
    setScopeEffortId('');
    setScopePassId('');
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
    includeActivities: showCanvasserPins ? '1' : '',
    effortId: scopeEffortId,
    passId: scopePassId,
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
      showCanvasserPins,
      scopeEffortId,
      scopePassId,
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
    map.setStyle(styleURL);
    map.once('style.load', () => {
      registerLayers(map, darkBase);
      setStyleEpoch((e) => e + 1);
    });
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

  const selectedHousehold = useMemo(
    () => households.find((h) => h.id === selected) || null,
    [selected, households]
  );

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
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CampaignSelector
            campaignId={campaignId}
            onChange={setCampaignId}
            campaigns={campaigns}
            isLoading={campaignsLoading}
          />
          <AddressSearch households={households} onSelect={flyToHousehold} />
          <DateRangeSelector value={dateRange} onChange={setDateRange} tz={tz} />
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
          />
        </aside>
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="absolute left-4 top-4 z-10 items-start" />
          {selectedHousehold && (
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
                statusColors={STATUS_COLORS}
                statusLabels={STATUS_LABELS}
                tz={tz}
              />
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
        </div>
      </div>
    </div>
  );
}
