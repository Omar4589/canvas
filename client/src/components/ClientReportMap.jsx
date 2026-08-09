import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import MapFilters from './MapFilters.jsx';
import MapStyleControl from './MapStyleControl.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { STATUS_COLORS, STATUS_LABELS } from '../lib/statusColors.js';
import { householdsToGeoJSON, buildingsToGeoJSON, registerLayers } from '../lib/mapRender.js';
import { groupHouseholds } from '../lib/buildings.js';

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

// The client map only shows doors we actually reached — every non-unknocked status. Survey
// campaigns drop the lit-drop chip; lit-drop campaigns drop the surveyed chip.
function visibleStatusesFor(campaignType) {
  const base = ['surveyed', 'refused', 'restricted', 'no_soliciting', 'not_home', 'wrong_address', 'lit_dropped'];
  if (campaignType === 'survey') return base.filter((s) => s !== 'lit_dropped');
  if (campaignType === 'lit_drop') return base.filter((s) => s !== 'surveyed');
  return base;
}

export default function ClientReportMap({
  mapDataPath,
  tokenPath = '/admin/config/mapbox-token',
  survey,
  campaignType = null,
  // Extra api() options — the public share page passes { public: true, shareToken } so the map's
  // fetches run unauthenticated; the admin preview passes nothing (authed).
  requestOpts = {},
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState([]);
  const [answerFilter, setAnswerFilter] = useState({ questionKey: '', option: '' });
  const [selected, setSelected] = useState(null);
  // An opened building (by key) or an ambiguous multi-door click (by ids). The click
  // handlers are bound once, so the building lookup rides a ref.
  const [stackKey, setStackKey] = useState(null);
  const [stackIds, setStackIds] = useState(null);
  const buildingsByKeyRef = useRef(new Map());

  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  const tokenQ = useQuery({
    queryKey: ['mapbox-token', tokenPath, requestOpts.shareToken || null],
    queryFn: () => api(tokenPath, requestOpts),
    staleTime: 5 * 60 * 1000,
  });
  const dataQ = useQuery({
    queryKey: ['client-report-map', mapDataPath, requestOpts.shareToken || null],
    queryFn: () => api(mapDataPath, requestOpts),
    enabled: !!mapDataPath,
  });

  const households = dataQ.data?.households || [];
  const visibleStatuses = useMemo(() => visibleStatusesFor(campaignType), [campaignType]);

  // Only doors we actually reached — drop unknocked (and anything off the campaign-type set).
  const reached = useMemo(
    () => households.filter((h) => visibleStatuses.includes(h.status)),
    [households, visibleStatuses]
  );
  const filtered = useMemo(
    () =>
      reached.filter(
        (h) =>
          (statusFilter.length === 0 || statusFilter.includes(h.status)) &&
          matchesAnswer(h, answerFilter)
      ),
    [reached, statusFilter, answerFilter]
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

    // This map is embedded inside a tab below tall content, so its container often finishes
    // sizing a tick AFTER Mapbox initializes — leaving the canvas at the wrong (often zero)
    // height: tiles load but nothing paints. Re-measure whenever the container settles. (The
    // full-page admin map doesn't need this; it's 100vh from the first paint.)
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    // Read every hit, not features[0]. Coincident icons all fire, and picking the first
    // silently opened one door while hiding the rest — the same defect the admin map had.
    // True stacks are now drawn by the building layer, so this branch catches the
    // near-coincident-but-distinct pins that remain.
    map.on('click', 'households-symbols', (e) => {
      const ids = [...new Set((e.features || []).map((f) => f.properties.id))];
      if (!ids.length) return;
      if (ids.length > 1) {
        setStackKey(null);
        setStackIds(ids);
        setSelected(null);
      } else {
        setStackIds(null);
        setStackKey(null);
        setSelected(ids[0]);
      }
    });
    // A building stands for every reached door on that pin. The handler is bound once, so
    // the lookup rides a ref rather than a closure over the memo.
    map.on('click', 'building-symbols', (e) => {
      const key = e.features?.[0]?.properties?.key;
      if (!key || !buildingsByKeyRef.current.has(key)) return;
      setStackKey(key);
      setStackIds(null);
      setSelected(null);
    });
    map.on('mouseenter', 'building-symbols', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'building-symbols', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('mouseenter', 'households-symbols', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'households-symbols', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('load', () => {
      registerLayers(map, darkBase, { withCanvassers: false });
      // The container can finish laying out (flex height) a tick after init; resize so the
      // canvas fills it rather than rendering at 0×0.
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
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleURL) return;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      registerLayers(map, darkBase, { withCanvassers: false });
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    // Remove a still-pending handler if the style changes again before this
    // one loads — otherwise both fire on the final style and re-register.
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  // Doors sharing a pin, grouped into one glyph. Derived entirely from coordinates the
  // snapshot already carries — no new field reaches the share link. The count means
  // "doors REACHED and matching the current filters at this pin": the frozen snapshot
  // drops unknocked doors, so the building's true size is unknowable here and must
  // never be claimed. (Roll-up is therefore only ever 'done' or 'partial'.)
  const { buildings, stackedIds, buildingsByKey } = useMemo(() => {
    const g = groupHouseholds(filtered);
    return { buildings: g.buildings, stackedIds: g.stackedIds, buildingsByKey: g.byKey };
  }, [filtered]);
  buildingsByKeyRef.current = buildingsByKey;

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(filtered, stackedIds);
    src.setData(geojson);
    mapRef.current.getSource('buildings')?.setData(buildingsToGeoJSON(buildings));
    if (geojson.features.length && !mapRef.current._didFitBounds) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [filtered, buildings, stackedIds, mapReady, styleEpoch]);

  const selectedHousehold = useMemo(
    () => households.find((h) => h.id === selected) || null,
    [selected, households]
  );

  // The doors behind an opened glyph (a building) or an ambiguous click (near-coincident
  // pins). Deliberately summarised, never listed: the frozen point carries no unit line
  // (ClientReportMapPoint), so a per-door list would print the same street address N times —
  // and adding addressLine2 to fix that would put apartment numbers on an unauthenticated
  // share link (docs/PRIVACY_VERIFICATION.md §D11). A status tally says more and exposes nothing new.
  const stackSummary = useMemo(() => {
    const doors = stackKey ? buildingsByKey.get(stackKey)?.units : stackIds?.map((id) => households.find((h) => h.id === id)).filter(Boolean);
    if (!doors?.length) return null;
    const lines = new Set(doors.map((d) => (d.addressLine1 || '').trim()).filter(Boolean));
    const byStatus = new Map();
    for (const d of doors) byStatus.set(d.status, (byStatus.get(d.status) || 0) + 1);
    return {
      title: lines.size === 1 ? [...lines][0] : `${doors.length} doors at one spot`,
      place: doors[0]?.city ? `${doors[0].city}, ${doors[0].state || ''}`.trim() : '',
      total: doors.length,
      tally: [...byStatus.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [stackKey, stackIds, buildingsByKey, households]);

  // Gate ONLY on the token — the map container must mount as soon as the token is ready so the
  // init effect (which keys off tokenQ.data) finds it. Waiting on the data query here is the bug
  // that left the map blank: the token resolves first, the effect runs with no container, bails,
  // and never re-runs. Pins fill in once the data effect runs.
  if (tokenQ.isLoading) {
    return <div className="p-6 text-sm text-fg-muted">Loading map…</div>;
  }
  if (!tokenQ.data?.isReady) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-fg-muted">
        Map is unavailable right now.
      </div>
    );
  }

  const noDoors = !dataQ.isLoading && reached.length === 0;

  return (
    <div
      style={{ height: '70vh', minHeight: 420, display: 'flex' }}
      className="overflow-hidden rounded-lg border border-border"
    >
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-card p-4">
        <div className="mb-3 text-xs text-fg-muted">
          {dataQ.isLoading
            ? 'Loading doors…'
            : `${filtered.length.toLocaleString()} of ${reached.length.toLocaleString()} doors knocked`}
        </div>
        <MapFilters
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          answerFilter={answerFilter}
          onAnswerChange={setAnswerFilter}
          survey={survey}
          statusColors={STATUS_COLORS}
          statusLabels={STATUS_LABELS}
          statuses={visibleStatuses}
          hideCanvassers
        />
      </aside>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {noDoors && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div className="rounded-lg border border-border bg-card/90 px-4 py-3 text-center text-sm text-fg-muted shadow-sm">
              No mapped doors for this week.
            </div>
          </div>
        )}
        <MapStyleControl
          value={styleId}
          onChange={setStyle}
          menuDirection="down"
          className="absolute left-4 top-4 z-10 items-start"
        />
        {/* Several doors at one spot. A tally, not a list — see the stackSummary comment. */}
        {!selectedHousehold && stackSummary && (
          <div className="absolute right-4 top-4 z-10 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
            <button
              type="button"
              onClick={() => { setStackKey(null); setStackIds(null); }}
              className="float-right text-fg-muted hover:text-fg"
              aria-label="Close"
            >
              ✕
            </button>
            <div className="text-sm font-semibold text-fg">{stackSummary.title}</div>
            {stackSummary.place && <div className="text-xs text-fg-muted">{stackSummary.place}</div>}
            <div className="mt-2 text-xs text-fg-muted">
              <strong className="tabular-nums text-fg">{stackSummary.total.toLocaleString()}</strong> doors
              reached at this spot — an apartment building or several homes sharing one address point.
            </div>
            <ul className="mt-2 space-y-1">
              {stackSummary.tally.map(([status, n]) => (
                <li key={status} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[status] }}
                  />
                  <span className="flex-1 text-fg-muted">{STATUS_LABELS[status] || status}</span>
                  <span className="tabular-nums text-fg">{n.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
