import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import { useMapStyle } from '../lib/mapStyles.js';
import { householdsToGeoJSON, buildingsToGeoJSON, registerLayers } from '../lib/mapRender.js';
import { groupHouseholds } from '../lib/buildings.js';
import { IconButton } from './ui/index.js';
import { IconExpand, IconMinimize } from './navIcons.jsx';
import { formatInTz } from '../lib/datetime.js';

// Both pin layers registerLayers creates. Apartments share a geocode, so a stack renders as a
// building glyph and its doors are filtered out of the households layer — click handling has to
// cover BOTH or every apartment on the map is unclickable.
const PIN_LAYERS = ['households-symbols', 'building-symbols'];

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
export default function AnswerMiniMap({ campaignId, questionKey, option, optionId, surveyTemplateId, userId, effortId, passId, from, to, tz, onOpenResponse }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // The doors whose pin was last clicked — a LIST, because an apartment stack renders as one
  // building glyph covering many doors. Stored as IDs, never objects: the payload refetches
  // whenever the drill changes, and a held copy would keep showing a door no longer in the
  // answer set. Resolving through the live `households` array makes a stale id simply vanish.
  const [selectedIds, setSelectedIds] = useState([]);
  // The click handler is bound once at init, so it cannot close over the latest buildings memo.
  // This ref is how it reaches the current stack → units mapping.
  const byKeyRef = useRef(new Map());
  const { styleURL, dark: darkBase } = useMapStyle();

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });
  const mapQ = useQuery({
    queryKey: ['admin', 'answer-map', campaignId, questionKey, option, optionId, surveyTemplateId, userId, effortId, passId, from, to],
    queryFn: () =>
      api(
        `/admin/households/map${buildQuery({ campaignId, questionKey, option, optionId, surveyTemplateId, userId, effortId, passId, from, to })}`
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

    // Pins are the point of this card now, so they have to be reachable. Bound ONCE here rather
    // than in a data effect: registerLayers recreates the layers on every style swap, but Mapbox
    // layer handlers are keyed by layer ID and keep working across that — the same reason the
    // admin map binds its handlers at init.
    const onPinClick = (e) => {
      const props = e.features?.[0]?.properties || {};
      // A door carries `id`; a building glyph carries `key` and stands for its whole stack
      // (mapRender's two feature shapes). Handling only `id` would make every apartment inert.
      if (props.id) return setSelectedIds([String(props.id)]);
      if (props.key) {
        const units = byKeyRef.current.get(props.key)?.units || [];
        if (units.length) setSelectedIds(units.map((u) => String(u.id)));
      }
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    for (const layer of PIN_LAYERS) {
      map.on('click', layer, onPinClick);
      map.on('mouseenter', layer, enter);
      map.on('mouseleave', layer, leave);
    }
    // A click on empty basemap dismisses the card, the way every other map here behaves.
    const onBlank = (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS.filter((l) => map.getLayer(l)) });
      if (!hits.length) setSelectedIds([]);
    };
    map.on('click', onBlank);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data]);

  // Apartment units share a geocode, so without grouping a 40-unit building reads as one
  // door here too. A glyph is CLICKABLE and stands for its whole stack — the card lists every
  // matching unit at that pin, which is why building-symbols is in PIN_LAYERS. Note the count on a glyph here means "doors WITH THIS
  // ANSWER at this pin", not the building's size: the payload is already answer-filtered.
  const { buildings, stackedIds } = useMemo(() => groupHouseholds(households), [households]);

  // Keep the once-bound click handler's view of the stacks current, and drop a selection whose
  // door has left the answer set (changing the drill must not leave a card describing a door
  // that is no longer on the map).
  useEffect(() => {
    byKeyRef.current = new Map(buildings.map((b) => [b.key, b]));
  }, [buildings]);
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.length) return prev;
      const live = new Set(households.map((h) => String(h.id)));
      const kept = prev.filter((id) => live.has(id));
      return kept.length === prev.length ? prev : kept;
    });
  }, [households]);

  // Esc closes the detail card first, and only then leaves fullscreen — one Esc should undo one
  // thing, not both at once.
  useEffect(() => {
    if (!fullscreen && !selectedIds.length) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (selectedIds.length) setSelectedIds([]);
      else setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, selectedIds.length]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(households, stackedIds);
    src.setData(geojson);
    mapRef.current.getSource('buildings')?.setData(buildingsToGeoJSON(buildings));
    // Re-fit whenever the drill changes — the point of this map IS the filtered subset.
    // Stacked doors are still features here (only the layer filters them), so the camera
    // still frames every door.
    if (geojson.features.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
      }
    }
  }, [households, buildings, stackedIds, mapReady]);

  // The clicked doors, resolved live so a stale id disappears rather than showing a phantom.
  const selected = useMemo(() => {
    if (!selectedIds.length) return [];
    const byId = new Map(households.map((h) => [String(h.id), h]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [selectedIds, households]);

  if (!tokenQ.isLoading && !tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">
        Map is unavailable right now.
      </div>
    );
  }

  return (
    <div
      // Fullscreen is the same container-swap the Turf Cutting and Map pages use — no Fullscreen
      // API, so every overlay inside keeps working. It REPLACES the old "Open in Map →" link:
      // that link sent you to a different page to do what this map now does in place.
      // margin: 0 is NOT cosmetic. This card lives inside a `space-y-4` stack, which puts
      // margin-top: 1rem on it — and a fixed box with inset: 0 plus a margin is over-constrained,
      // so it rendered 16px short and 16px down instead of covering the viewport. Any fixed
      // overlay dropped into a space-y parent needs this.
      style={fullscreen ? { position: 'fixed', inset: 0, margin: 0, zIndex: 50 } : undefined}
      className={`flex flex-col overflow-hidden bg-card ${fullscreen ? '' : 'rounded-lg border border-border'}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <span className="text-fg-muted">
          {mapQ.isLoading
            ? 'Loading doors…'
            : `${households.length.toLocaleString()} ${households.length === 1 ? 'door' : 'doors'} with this answer · click a pin for details`}
        </span>
        <IconButton
          label={fullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
          className="border border-border bg-card/95"
          onClick={() => setFullscreen((v) => !v)}
        >
          {fullscreen ? <IconMinimize /> : <IconExpand />}
        </IconButton>
      </div>
      <div style={fullscreen ? { flex: 1, minHeight: 0, position: 'relative' } : { height: 420, position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {!mapQ.isLoading && households.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="rounded-lg border border-border bg-card/90 px-4 py-3 text-center text-sm text-fg-muted shadow-sm">
              No mapped doors match this answer.
            </div>
          </div>
        )}
        {selected.length > 0 && (
          <DoorCard
            doors={selected}
            tz={tz}
            onClose={() => setSelectedIds([])}
            onOpenResponse={onOpenResponse}
          />
        )}
      </div>
    </div>
  );
}

// What a clicked pin says: whose door it is, who surveyed it and when, and their note. Each
// survey row opens the SAME ResponseDetailDrawer the table rows use (onOpenResponse), so the
// full answers live in one place instead of a second detail UI drifting alongside it.
//
// Everything here is already in the map payload — no extra fetch on click.
function DoorCard({ doors, tz, onClose, onOpenResponse }) {
  const many = doors.length > 1;
  return (
    <div
      className="absolute right-3 top-3 z-20 w-80 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
      style={{ maxHeight: 'calc(100% - 1.5rem)' }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{doors[0].addressLine1}</div>
          <div className="truncate text-xs text-fg-muted">
            {doors[0].city}, {doors[0].state} {doors[0].zipCode}
          </div>
          {many && (
            <div className="mt-0.5 text-[11px] font-medium text-brand-accent">
              {doors.length} units at this pin
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
          </svg>
        </button>
      </div>
      <div className="divide-y divide-border">
        {doors.map((d) => (
          <div key={d.id} className="px-3 py-2">
            {many && <div className="mb-1 truncate text-xs font-medium text-fg">{d.addressLine1}</div>}
            {(d.surveys || []).length === 0 ? (
              <div className="text-xs text-fg-subtle">No survey recorded at this door.</div>
            ) : (
              (d.surveys || []).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onOpenResponse?.(s.id)}
                  disabled={!onOpenResponse}
                  className="mb-1 block w-full rounded px-1.5 py-1 text-left last:mb-0 hover:bg-sunken disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="text-xs font-medium text-fg">{s.voter?.fullName || 'Unknown voter'}</div>
                  <div className="text-[11px] text-fg-muted">
                    {s.canvasser ? `${s.canvasser.firstName} ${s.canvasser.lastName}` : 'Unknown canvasser'}
                    {s.submittedAt ? ` · ${formatInTz(s.submittedAt, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)}` : ''}
                  </div>
                  {s.note && <div className="mt-0.5 text-[11px] italic text-fg-subtle">“{s.note}”</div>}
                </button>
              ))
            )}
            {/* Residents with no survey — the door matched the answer through a housemate. */}
            {(d.voters || []).length > 0 && (
              <div className="mt-1 truncate text-[11px] text-fg-subtle">
                Residents: {(d.voters || []).map((v) => v.fullName).filter(Boolean).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
