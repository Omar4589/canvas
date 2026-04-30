import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import DateRangeSelector, { rangeFromId } from '../components/DateRangeSelector.jsx';
import HouseholdDetailPanel from '../components/HouseholdDetailPanel.jsx';
import MapFilters from '../components/MapFilters.jsx';
import AddressSearch from '../components/AddressSearch.jsx';
import CanvasserPingPanel from '../components/CanvasserPingPanel.jsx';

const STATUS_COLORS = {
  unknocked: '#9ca3af',
  not_home: '#3b82f6',
  surveyed: '#22c55e',
  wrong_address: '#ef4444',
};

const STATUS_LABELS = {
  unknocked: 'Unknocked',
  not_home: 'Not home',
  surveyed: 'Surveyed',
  wrong_address: 'Wrong address',
};

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

// Render a modern two-tone house icon — rounded body in the status color, a
// slightly darker roof, a small white door + window, and a soft drop shadow.
// One pre-colored ImageData per status; we ship our own because the
// streets-v12 sprite no longer bundles Maki icons.
function darkenHex(hex, amount = 0.2) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - amount)));
  return `rgb(${r},${g},${b})`;
}

function drawHouseIcon(color, size = 64) {
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const darker = darkenHex(color);

  // Drop shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(size / 2, size - 4, 19, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // House body (walls) — rounded rectangle in the status color
  ctx.beginPath();
  ctx.roundRect(11, 28, 42, 26, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Roof — darker shade of the same color, rounded peak
  ctx.beginPath();
  ctx.moveTo(6, 30);
  ctx.lineTo(31, 8);
  ctx.quadraticCurveTo(32, 7, 33, 8);
  ctx.lineTo(58, 30);
  ctx.closePath();
  ctx.fillStyle = darker;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Small window (left)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(17, 34, 9, 9, 1.5);
  ctx.fill();
  // Window cross
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(21.5, 34);
  ctx.lineTo(21.5, 43);
  ctx.moveTo(17, 38.5);
  ctx.lineTo(26, 38.5);
  ctx.stroke();

  // Door (right of center)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(32, 38, 11, 16, 1.5);
  ctx.fill();
  // Door knob
  ctx.fillStyle = darker;
  ctx.beginPath();
  ctx.arc(41, 47, 0.9, 0, Math.PI * 2);
  ctx.fill();

  return ctx.getImageData(0, 0, size * dpr, size * dpr);
}

function householdsToGeoJSON(households) {
  return {
    type: 'FeatureCollection',
    features: households
      .filter((h) => h.location?.lng != null && h.location?.lat != null)
      .map((h) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [h.location.lng, h.location.lat],
        },
        properties: {
          id: h.id,
          status: h.status,
        },
      })),
  };
}

function activitiesToPingsGeoJSON(activities) {
  return {
    type: 'FeatureCollection',
    features: activities
      .filter((a) => a.location?.lng != null && a.location?.lat != null)
      .map((a) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [a.location.lng, a.location.lat],
        },
        properties: {
          activityId: a.id,
          actionType: a.actionType,
        },
      })),
  };
}

function activitiesToLinesGeoJSON(activities, householdsById) {
  const features = [];
  for (const a of activities) {
    if (a.location?.lng == null || a.location?.lat == null) continue;
    const h = householdsById.get(a.householdId);
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
      properties: { activityId: a.id },
    });
  }
  return { type: 'FeatureCollection', features };
}

export default function MapPage() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);

  const [rangeId, setRangeId] = useState('all');
  const dateRange = useMemo(() => rangeFromId(rangeId), [rangeId]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [canvasserId, setCanvasserId] = useState('');
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '' });
  const [showCanvasserPins, setShowCanvasserPins] = useState(false);

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  const surveyQ = useQuery({
    queryKey: ['reports', 'survey-results'],
    queryFn: () => api('/admin/reports/survey-results'),
  });

  const queryString = buildQuery({
    from: dateRange.from,
    to: dateRange.to,
    status: statusFilter,
    userId: canvasserId,
    questionKey: answerFilter.questionKey,
    option: answerFilter.option,
    includeActivities: showCanvasserPins ? '1' : '',
  });

  const householdsQ = useQuery({
    queryKey: [
      'admin',
      'households-map',
      dateRange.from,
      dateRange.to,
      statusFilter.join(','),
      canvasserId,
      answerFilter.questionKey,
      answerFilter.option,
      showCanvasserPins,
    ],
    queryFn: () => api(`/admin/households/map${queryString}`),
  });

  const households = householdsQ.data?.households || [];
  const canvassers = householdsQ.data?.canvassers || [];
  const activities = householdsQ.data?.activities || [];

  // Initialize the map once we have a token.
  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.on('load', () => {
      // Register one house icon per status (pre-colored, non-SDF).
      // pixelRatio: 2 because drawHouseIcon renders at 2x for retina sharpness.
      for (const status of Object.keys(STATUS_COLORS)) {
        const id = `house-${status}`;
        if (!map.hasImage(id)) {
          map.addImage(id, drawHouseIcon(STATUS_COLORS[status]), { pixelRatio: 2 });
        }
      }

      map.addSource('households', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'households-symbols',
        type: 'symbol',
        source: 'households',
        layout: {
          'icon-image': [
            'match', ['get', 'status'],
            'unknocked', 'house-unknocked',
            'not_home', 'house-not_home',
            'surveyed', 'house-surveyed',
            'wrong_address', 'house-wrong_address',
            'house-unknocked',
          ],
          'icon-size': [
            'interpolate', ['linear'], ['zoom'],
            10, 0.32,
            14, 0.5,
            17, 0.7,
          ],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      map.on('click', 'households-symbols', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        setSelected(f.properties.id);
        setSelectedActivityId(null);
      });
      map.on('mouseenter', 'households-symbols', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'households-symbols', () => {
        map.getCanvas().style.cursor = '';
      });

      // Canvasser GPS pings + dashed lines connecting them to their households.
      // Added BEFORE the household symbols so houses render on top.
      map.addSource('canvasser-lines', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer(
        {
          id: 'canvasser-lines',
          type: 'line',
          source: 'canvasser-lines',
          paint: {
            'line-color': '#6b7280',
            'line-width': 1,
            'line-opacity': 0.45,
            'line-dasharray': [2, 2],
          },
        },
        'households-symbols'
      );

      map.addSource('canvasser-pings', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer(
        {
          id: 'canvasser-pings',
          type: 'circle',
          source: 'canvasser-pings',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              10, 3,
              14, 5,
              17, 7,
            ],
            'circle-color': [
              'match', ['get', 'actionType'],
              'survey_submitted', STATUS_COLORS.surveyed,
              'not_home', STATUS_COLORS.not_home,
              'wrong_address', STATUS_COLORS.wrong_address,
              '#6b7280',
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          },
        },
        'households-symbols'
      );

      map.on('click', 'canvasser-pings', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        setSelectedActivityId(f.properties.activityId);
        setSelected(null);
      });
      map.on('mouseenter', 'canvasser-pings', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'canvasser-pings', () => {
        map.getCanvas().style.cursor = '';
      });

      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [tokenQ.data]);

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
  }, [households, mapReady]);

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
  }, [activities, householdsById, showCanvasserPins, mapReady]);

  // Toggle layer visibility — instant, no refetch.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const vis = showCanvasserPins ? 'visible' : 'none';
    if (mapRef.current.getLayer('canvasser-pings')) {
      mapRef.current.setLayoutProperty('canvasser-pings', 'visibility', vis);
    }
    if (mapRef.current.getLayer('canvasser-lines')) {
      mapRef.current.setLayoutProperty('canvasser-lines', 'visibility', vis);
    }
  }, [showCanvasserPins, mapReady]);

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
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <div className="text-base font-semibold">Mapbox token not configured</div>
        <p className="mt-2">
          Set <code className="rounded bg-amber-100 px-1 py-0.5">MAPBOX_PUBLIC_TOKEN</code> in
          your server <code className="rounded bg-amber-100 px-1 py-0.5">.env</code> file (a
          public token starting with <code>pk.</code>) and restart the server.
        </p>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{ flexShrink: 0 }}
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-6 py-3"
      >
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Map</h1>
          <div className="text-xs text-gray-500">
            {householdsQ.isLoading
              ? 'Loading households…'
              : `${households.length.toLocaleString()} households shown`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AddressSearch households={households} onSelect={flyToHousehold} />
          <DateRangeSelector value={rangeId} onChange={setRangeId} />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <aside
          style={{ flexShrink: 0, overflowY: 'auto' }}
          className="w-72 border-r border-gray-200 bg-white p-4"
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
              className="rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              <HouseholdDetailPanel
                household={selectedHousehold}
                onClose={() => setSelected(null)}
                statusColors={STATUS_COLORS}
                statusLabels={STATUS_LABELS}
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
              className="rounded-lg border border-gray-200 bg-white shadow-lg"
            >
              <CanvasserPingPanel
                activity={selectedActivity}
                household={selectedActivityHousehold}
                onOpenHousehold={(id) => {
                  setSelectedActivityId(null);
                  setSelected(id);
                }}
                onClose={() => setSelectedActivityId(null)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
