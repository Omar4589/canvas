import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from '../../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useMapStyle } from '../../lib/mapStyles.js';
import MapStyleControl from '../MapStyleControl.jsx';
import { api } from '../../api/client.js';
import { BOOK_COLOR_HEX } from '../../lib/packet/packetTheme.js';

// Where the books actually are. Click a shape to add or drop it from the print run — the
// same selection the list on the left drives, so the two stay in step.
//
// ONE ROUND AT A TIME, deliberately. Rounds re-cover the same streets (each pass cuts its
// own books over the same doors), so stacking two rounds' fills is both unreadable and
// ambiguous to click. A round switcher sits above the canvas when there is more than one.

// Books with pocket islands are stored as MultiPolygon, which nests one level deeper than
// Polygon — flattening is what stops the fit landing on NaN.
const bboxOf = (books) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let seen = false;
  for (const b of books) {
    const c = b.boundary?.coordinates;
    if (!c) continue;
    const rings = b.boundary.type === 'MultiPolygon' ? c.flat() : c;
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        seen = true;
        if (lng < minX) minX = lng;
        if (lat < minY) minY = lat;
        if (lng > maxX) maxX = lng;
        if (lat > maxY) maxY = lat;
      }
    }
  }
  return seen ? [[minX, minY], [maxX, maxY]] : null;
};

const toFillGeoJSON = (books, isPicked) => ({
  type: 'FeatureCollection',
  features: books
    .filter((b) => b.boundary)
    .map((b) => ({
      type: 'Feature',
      geometry: b.boundary,
      properties: {
        id: b.id,
        color: BOOK_COLOR_HEX[b.colorIndex % BOOK_COLOR_HEX.length],
        selected: isPicked(b.id),
      },
    })),
});

const toLabelGeoJSON = (books, isPicked) => ({
  type: 'FeatureCollection',
  features: books
    .filter((b) => b.centroid?.coordinates?.length === 2)
    .map((b) => ({
      type: 'Feature',
      geometry: b.centroid,
      properties: { label: b.name, selected: isPicked(b.id) },
    })),
});

const registerLayers = (map, dark) => {
  if (map.getSource('packet-books')) return; // a basemap swap re-runs this
  map.addSource('packet-books', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'packet-book-fill',
    type: 'fill',
    source: 'packet-books',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['get', 'selected'], 0.42, 0.1],
    },
  });
  map.addLayer({
    id: 'packet-book-outline',
    type: 'line',
    source: 'packet-books',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['case', ['get', 'selected'], 3.5, 1.4],
      'line-opacity': ['case', ['get', 'selected'], 1, 0.65],
    },
  });
  map.addSource('packet-book-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'packet-book-label',
    type: 'symbol',
    source: 'packet-book-labels',
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-allow-overlap': false,
    },
    paint: {
      // Basemap dark, NOT app dark — the map can be light while the console is dark.
      'text-color': dark ? '#ffffff' : '#111827',
      'text-halo-color': dark ? '#000000' : '#ffffff',
      'text-halo-width': 1.4,
    },
  });
};

export default function PacketMap({ rounds, selection, onToggleBook }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const toggleRef = useRef(onToggleBook);
  const fittedRef = useRef('');
  const { styleId, styleURL, setStyle, dark } = useMapStyle();

  const withBooks = useMemo(() => rounds.filter((r) => r.books.length), [rounds]);
  const [activeRoundId, setActiveRoundId] = useState(null);

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });

  // Default to the round holding the first picked book, else the first round with books.
  useEffect(() => {
    if (!withBooks.length) return;
    if (activeRoundId && withBooks.some((r) => r.id === activeRoundId)) return;
    const picked = selection.kind === 'books' ? selection.turfIds : [];
    const holding = withBooks.find((r) => r.books.some((b) => picked.includes(b.id)));
    setActiveRoundId((holding || withBooks[0]).id);
  }, [withBooks, activeRoundId, selection]);

  const activeRound = withBooks.find((r) => r.id === activeRoundId) || withBooks[0] || null;
  const books = activeRound?.books || [];

  // The click handler is bound once and reads the callback through a ref — a handler that
  // closed over `selection` would go stale after the very first toggle.
  useEffect(() => { toggleRef.current = onToggleBook; }, [onToggleBook]);

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleURL,
      center: [-95.7129, 37.0902],
      zoom: 3.5,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => registerLayers(map, dark));
    map.on('click', (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ['packet-book-fill'] });
      // Clicking bare map deliberately does NOT clear the selection — an accidental blank
      // click wiping a built-up print run is the failure TurfsPage already learned about.
      if (hit.length) toggleRef.current?.(hit[0].properties.id);
    });
    map.on('mousemove', 'packet-book-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'packet-book-fill', () => { map.getCanvas().style.cursor = ''; });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // styleURL/dark are handled by the swap effect below; re-running this would rebuild the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data?.isReady, tokenQ.data?.token]);

  // A basemap change WIPES every custom source and layer, so they are re-registered on
  // style.load — and a still-pending handler is removed, or two styles both re-register.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const handler = () => registerLayers(map, dark);
    map.on('style.load', handler);
    map.setStyle(styleURL);
    return () => map.off('style.load', handler);
  }, [styleURL, dark]);

  // Feed the layers. Guarded on the source existing, because style swaps briefly remove it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const isPicked = (id) => selection.kind === 'books' && selection.turfIds.includes(id);
    const paint = () => {
      const fill = map.getSource('packet-books');
      const label = map.getSource('packet-book-labels');
      if (!fill || !label) return;
      fill.setData(toFillGeoJSON(books, isPicked));
      label.setData(toLabelGeoJSON(books, isPicked));
    };
    if (map.isStyleLoaded()) paint();
    else map.once('idle', paint);
  }, [books, selection]);

  // Fit once per round, never on a selection change — otherwise every click yanks the camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !books.length) return;
    const sig = books.map((b) => b.id).join(',');
    if (fittedRef.current === sig) return;
    const bb = bboxOf(books);
    if (!bb) return;
    fittedRef.current = sig;
    map.fitBounds(bb, { padding: 40, maxZoom: 15, duration: 0 });
  }, [books]);

  // The pane resizes when the window does; a stale canvas size renders a letterboxed map.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (tokenQ.data && !tokenQ.data.isReady) {
    return (
      <div className="flex-1 flex items-center justify-center rounded-lg border border-border bg-muted">
        <p className="text-sm text-muted-fg">Set MAPBOX_PUBLIC_TOKEN to enable the map.</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {withBooks.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-3">
          {withBooks.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveRoundId(r.id)}
              aria-pressed={r.id === activeRound?.id}
              className={`px-2.5 py-1 rounded-md border text-xs transition-colors ${
                r.id === activeRound?.id
                  ? 'border-brand bg-brand-tint text-fg'
                  : 'border-border bg-card text-muted-fg hover:bg-muted'
              }`}
            >
              {r.effortName} · Pass {r.roundNumber}
            </button>
          ))}
        </div>
      )}

      <div className="relative flex-1 rounded-lg overflow-hidden border border-border" style={{ minHeight: 0 }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        <MapStyleControl
          value={styleId}
          onChange={setStyle}
          className="absolute left-2 top-2 z-10 flex flex-col items-start"
          menuDirection="down"
        />
        {!books.length && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-muted-fg bg-card/90 px-3 py-1.5 rounded-md">
              This round&apos;s books have no map outline.
            </p>
          </div>
        )}
      </div>

      <p className="pt-2 text-xs text-muted-fg">
        Click a book to add or remove it. Only books on this round are shown — rounds cover the
        same streets, so they can&apos;t be drawn together.
      </p>
    </div>
  );
}
