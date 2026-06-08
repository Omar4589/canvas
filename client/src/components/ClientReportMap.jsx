import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import MapFilters from './MapFilters.jsx';
import MapStyleControl from './MapStyleControl.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import { householdsToGeoJSON, registerLayers } from '../lib/mapRender.js';

// Read-only interactive coverage map for a client report. Reuses the admin map's rendering
// (drawHouseIcon / householdsToGeoJSON / registerLayers via lib/mapRender), but: data is
// fetched ONCE from the frozen snapshot (no live polling), there are NO canvasser pins, and
// status / survey-answer filtering runs entirely CLIENT-SIDE against the already-loaded points.

const DEFAULT_CENTER = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;

function matchesAnswer(h, answerFilter) {
  if (!answerFilter?.questionKey || !answerFilter?.option) return true;
  const a = (h.answers || []).find((x) => x.questionKey === answerFilter.questionKey);
  if (!a) return false;
  if (Array.isArray(a.answer)) return a.answer.map(String).includes(String(answerFilter.option));
  return String(a.answer) === String(answerFilter.option);
}

export default function ClientReportMap({
  mapDataPath,
  tokenPath = '/client/config/mapbox-token',
  survey,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState([]);
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '' });
  const [selected, setSelected] = useState(null);

  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token', tokenPath],
    queryFn: () => api(tokenPath),
    staleTime: 5 * 60 * 1000,
  });
  const dataQ = useQuery({
    queryKey: ['client-report-map', mapDataPath],
    queryFn: () => api(mapDataPath),
    enabled: !!mapDataPath,
  });

  const households = dataQ.data?.households || [];
  const filtered = useMemo(
    () =>
      households.filter(
        (h) =>
          (statusFilter.length === 0 || statusFilter.includes(h.status)) &&
          matchesAnswer(h, answerFilter)
      ),
    [households, statusFilter, answerFilter]
  );

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
    map.on('click', 'households-symbols', (e) => {
      const f = e.features?.[0];
      if (f) setSelected(f.properties.id);
    });
    map.on('mouseenter', 'households-symbols', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'households-symbols', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('load', () => {
      registerLayers(map, darkBase, { withCanvassers: false });
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleURL) return;
    appliedStyleRef.current = styleURL;
    map.setStyle(styleURL);
    map.once('style.load', () => {
      registerLayers(map, darkBase, { withCanvassers: false });
      setStyleEpoch((e) => e + 1);
    });
  }, [styleURL, darkBase, mapReady]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(filtered);
    src.setData(geojson);
    if (geojson.features.length && !mapRef.current._didFitBounds) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [filtered, mapReady, styleEpoch]);

  const selectedHousehold = useMemo(
    () => households.find((h) => h.id === selected) || null,
    [selected, households]
  );

  if (tokenQ.isLoading || dataQ.isLoading) {
    return <div className="p-6 text-sm text-fg-muted">Loading map…</div>;
  }
  if (!tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">
        Map is unavailable right now.
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] overflow-hidden rounded-lg border border-border">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-4">
        <div className="mb-3 text-xs text-fg-muted">
          {filtered.length.toLocaleString()} of {households.length.toLocaleString()} doors
        </div>
        <MapFilters
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          answerFilter={answerFilter}
          onAnswerChange={setAnswerFilter}
          survey={survey}
          statusColors={STATUS_COLORS}
          statusLabels={STATUS_LABELS}
          hideCanvassers
        />
      </aside>
      <div className="relative flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        <MapStyleControl
          value={styleId}
          onChange={setStyle}
          menuDirection="down"
          className="absolute left-4 top-4 z-10 items-start"
        />
        {selectedHousehold && (
          <div className="absolute right-4 top-4 z-10 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="float-right text-fg-muted hover:text-fg"
              aria-label="Close"
            >
              ✕
            </button>
            <div className="text-sm font-semibold text-fg">{selectedHousehold.addressLine1}</div>
            <div className="text-xs text-fg-muted">
              {selectedHousehold.city}, {selectedHousehold.state}
            </div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[selectedHousehold.status] }}
              />
              <span className="text-fg-muted">
                {STATUS_LABELS[selectedHousehold.status] || selectedHousehold.status}
              </span>
            </div>
            {(selectedHousehold.answers || []).length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
                {selectedHousehold.answers.map((a, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-fg-muted">{a.questionKey}</span>
                    <span className="text-right text-fg">
                      {Array.isArray(a.answer) ? a.answer.join(', ') : String(a.answer)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
