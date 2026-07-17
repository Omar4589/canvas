import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import { useMapStyle } from '../lib/mapStyles.js';
import { householdsToGeoJSON, registerLayers } from '../lib/mapRender.js';

const DEFAULT_CENTER = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Single-fetch mini map of exactly the homes matching the current answer drill — same
// pins as the admin map (mapRender helpers), no polling, no bbox (the filtered set is
// small). The camera fits the RETURNED features; includeBounds is deliberately not used
// (it returns the campaign-wide extent, which would mis-frame a filtered subset).
export default function AnswerMiniMap({ campaignId, questionKey, option, optionId, userId, effortId, from, to }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const { styleURL, dark: darkBase } = useMapStyle();

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });
  const mapQ = useQuery({
    queryKey: ['admin', 'answer-map', campaignId, questionKey, option, optionId, userId, effortId, from, to],
    queryFn: () =>
      api(
        `/admin/households/map${buildQuery({ campaignId, questionKey, option, optionId, userId, effortId, from, to })}`
      ),
    enabled: !!campaignId && !!questionKey && !!(option || optionId),
  });
  const households = mapQ.data?.households || [];

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleURL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    // The card lays out a tick after Mapbox initializes — re-measure so the canvas
    // never sticks at a stale (often zero) height. Same fix as ClientReportMap.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    map.on('load', () => {
      registerLayers(map, darkBase, { withCanvassers: false });
      map.resize();
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(households);
    src.setData(geojson);
    // Re-fit whenever the drill changes — the point of this map IS the filtered subset.
    if (geojson.features.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
      }
    }
  }, [households, mapReady]);

  // The Map page's answer chips key on option TEXT, so the deep link always carries it.
  const mapHref = `/campaigns/${campaignId}/map${buildQuery({ questionKey, option, optionId, userId, effortId, from, to })}`;

  if (!tokenQ.isLoading && !tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">
        Map is unavailable right now.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="text-fg-muted">
          {mapQ.isLoading
            ? 'Loading doors…'
            : `${households.length.toLocaleString()} ${households.length === 1 ? 'door' : 'doors'} with this answer`}
        </span>
        <Link to={mapHref} className="font-medium text-brand-accent hover:underline">
          Open in Map →
        </Link>
      </div>
      <div style={{ height: 360, position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {!mapQ.isLoading && households.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="rounded-lg border border-border bg-card/90 px-4 py-3 text-center text-sm text-fg-muted shadow-sm">
              No mapped doors match this answer.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
