import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import DateRangeSelector, { rangeFromId } from '../components/DateRangeSelector.jsx';
import HouseholdDetailPanel from '../components/HouseholdDetailPanel.jsx';
import MapFilters from '../components/MapFilters.jsx';
import AddressSearch from '../components/AddressSearch.jsx';

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

export default function MapPage() {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState(null);

  const [rangeId, setRangeId] = useState('all');
  const dateRange = useMemo(() => rangeFromId(rangeId), [rangeId]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [canvasserId, setCanvasserId] = useState('');
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '' });

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
    ],
    queryFn: () => api(`/admin/households/map${queryString}`),
  });

  const households = householdsQ.data?.households || [];
  const canvassers = householdsQ.data?.canvassers || [];

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
      map.addSource('households', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'households-circles',
        type: 'circle',
        source: 'households',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            10, 4,
            14, 7,
            17, 10,
          ],
          'circle-color': [
            'match', ['get', 'status'],
            'unknocked', STATUS_COLORS.unknocked,
            'not_home', STATUS_COLORS.not_home,
            'surveyed', STATUS_COLORS.surveyed,
            'wrong_address', STATUS_COLORS.wrong_address,
            '#888',
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });

      map.on('click', 'households-circles', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        setSelected(f.properties.id);
      });
      map.on('mouseenter', 'households-circles', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'households-circles', () => {
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

  const selectedHousehold = useMemo(
    () => households.find((h) => h.id === selected) || null,
    [selected, households]
  );

  function flyToHousehold(h) {
    if (!mapRef.current || !h?.location) return;
    mapRef.current.flyTo({
      center: [h.location.lng, h.location.lat],
      zoom: 16,
      essential: true,
    });
    setSelected(h.id);
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
        </div>
      </div>
    </div>
  );
}
