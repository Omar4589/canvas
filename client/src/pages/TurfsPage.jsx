import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import TurfAssignmentsModal from '../components/TurfAssignmentsModal.jsx';

const BOOK_COLORS = [
  '#2563eb', '#16a34a', '#db2777', '#ea580c', '#7c3aed', '#0891b2',
  '#ca8a04', '#dc2626', '#059669', '#9333ea', '#0d9488', '#e11d48',
];
const colorFor = (i) => BOOK_COLORS[i % BOOK_COLORS.length];

const ATTRIBUTES = [
  { value: 'precinct', label: 'Precinct' },
  { value: 'congressional', label: 'Congressional district' },
  { value: 'stateSenate', label: 'State senate district' },
  { value: 'stateHouse', label: 'State house district' },
  { value: 'city', label: 'City' },
  { value: 'zip', label: 'ZIP' },
  { value: 'county', label: 'County' },
];

function booksToFillGeoJSON(turfs, colorByTurf, selected) {
  return {
    type: 'FeatureCollection',
    features: turfs
      .filter((t) => t.boundary?.coordinates?.length)
      .map((t) => ({
        type: 'Feature',
        geometry: t.boundary,
        properties: { id: String(t._id), color: colorByTurf.get(String(t._id)), selected: selected.has(String(t._id)) },
      })),
  };
}
function booksToLabelGeoJSON(turfs) {
  return {
    type: 'FeatureCollection',
    features: turfs
      .filter((t) => t.centroid?.coordinates?.length === 2)
      .map((t) => ({ type: 'Feature', geometry: t.centroid, properties: { label: `${t.name} · ${t.doorCount}` } })),
  };
}
function doorsToGeoJSON(doors, colorByTurf) {
  return {
    type: 'FeatureCollection',
    features: doors.map((d) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      properties: { id: d.id, color: colorByTurf.get(String(d.turfId)) || '#9ca3af' },
    })),
  };
}
function bboxOf(turfs) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const t of turfs) {
    for (const ring of t.boundary?.coordinates || []) {
      for (const [x, y] of ring) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    }
  }
  return Number.isFinite(a) ? [[a, b], [c, d]] : null;
}

function PassPicker({ campaignId, passId, onChange }) {
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const passes = passesQ.data?.passes || [];
  const activeId = passesQ.data?.activePassId;
  useEffect(() => {
    if (passId || !passes.length) return;
    onChange(String(activeId || passes[0]._id));
  }, [passId, passes, activeId]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Pass</span>
      <select
        value={passId || ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
      >
        {!passes.length && <option value="">No passes</option>}
        {passes.map((p) => (
          <option key={p._id} value={p._id}>Round {p.roundNumber} · {p.name} ({p.status})</option>
        ))}
      </select>
    </div>
  );
}

export default function TurfsPage() {
  const qc = useQueryClient();
  const { campaignId, setCampaignId, campaigns, isLoading } = useCampaignSelection();
  const [passId, setPassId] = useState('');

  const [mode, setMode] = useState('geometric');
  const [attribute, setAttribute] = useState('precinct');
  const [capN, setCapN] = useState('');
  const [maxDoors, setMaxDoors] = useState(65);
  const [jobId, setJobId] = useState(null);
  const [assignTurf, setAssignTurf] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(new Set());
  const [drawnPolygon, setDrawnPolygon] = useState(null);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const editModeRef = useRef(false);
  const moveDoorRef = useRef(() => {});
  const toggleSelectRef = useRef(() => {});

  const tokenQ = useQuery({ queryKey: ['config', 'mapbox-token'], queryFn: () => api('/admin/config/mapbox-token') });
  const turfsQ = useQuery({
    queryKey: ['turfs', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs?passId=${passId}`),
    enabled: !!campaignId && !!passId,
  });
  const doorsQ = useQuery({
    queryKey: ['turf-doors', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/doors?passId=${passId}`),
    enabled: !!campaignId && !!passId && editMode,
  });
  const turfs = turfsQ.data?.turfs || [];
  const draftCount = turfs.filter((t) => t.status === 'draft').length;
  const colorByTurf = new Map(turfs.map((t, i) => [String(t._id), colorFor(i)]));

  const jobQ = useQuery({
    queryKey: ['turf-job', campaignId, jobId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/jobs/${jobId}`),
    enabled: !!jobId && !!campaignId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 1200;
    },
  });
  useEffect(() => {
    if (jobQ.data?.status === 'completed') {
      qc.invalidateQueries({ queryKey: ['turfs', campaignId, passId] });
      qc.invalidateQueries({ queryKey: ['turf-doors', campaignId, passId] });
    }
  }, [jobQ.data?.status]);

  const invalidateTurfs = () => {
    qc.invalidateQueries({ queryKey: ['turfs', campaignId, passId] });
    qc.invalidateQueries({ queryKey: ['turf-doors', campaignId, passId] });
  };

  const generate = useMutation({
    mutationFn: () => {
      let params;
      if (mode === 'manual') params = { polygon: drawnPolygon };
      else if (mode === 'attribute') params = { attribute, capN: capN ? Number(capN) : null };
      else params = { maxDoors: Number(maxDoors) || 65 };
      return api(`/admin/campaigns/${campaignId}/turfs/generate`, { method: 'POST', body: { passId, mode, params } });
    },
    onSuccess: (res) => {
      setJobId(res.jobId);
      if (drawRef.current) drawRef.current.deleteAll();
      setDrawnPolygon(null);
    },
  });
  const accept = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/accept`, { method: 'POST', body: { passId } }),
    onSuccess: invalidateTurfs,
  });
  const moveDoor = useMutation({
    mutationFn: ({ householdId, toTurfId }) => api(`/admin/campaigns/${campaignId}/turfs/move-door`, { method: 'POST', body: { householdId, toTurfId } }),
    onSuccess: invalidateTurfs,
  });
  const merge = useMutation({
    mutationFn: (turfIds) => api(`/admin/campaigns/${campaignId}/turfs/merge`, { method: 'POST', body: { turfIds } }),
    onSuccess: () => { setSelectedBooks(new Set()); invalidateTurfs(); },
  });
  const rename = useMutation({
    mutationFn: ({ turfId, name }) => api(`/admin/campaigns/${campaignId}/turfs/${turfId}`, { method: 'PATCH', body: { name } }),
    onSuccess: invalidateTurfs,
  });

  // keep refs current for the once-registered map handlers
  editModeRef.current = editMode;
  moveDoorRef.current = (householdId, toTurfId) => moveDoor.mutate({ householdId, toTurfId });
  toggleSelectRef.current = (id) =>
    setSelectedBooks((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [-95.7129, 37.0902],
      zoom: 3.5,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: {} });
    map.addControl(draw);
    drawRef.current = draw;

    map.on('draw.create', (e) => setDrawnPolygon(e.features?.[0]?.geometry || null));

    map.on('load', () => {
      const empty = { type: 'FeatureCollection', features: [] };
      map.addSource('books', { type: 'geojson', data: empty });
      map.addLayer({ id: 'book-fill', type: 'fill', source: 'books', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 } });
      map.addLayer({
        id: 'book-outline',
        type: 'line',
        source: 'books',
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 4, 2] },
      });
      map.addSource('book-labels', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'book-labels',
        type: 'symbol',
        source: 'book-labels',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-allow-overlap': false },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
      map.addSource('doors', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'doors',
        type: 'circle',
        source: 'doors',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
        },
      });

      // Merge: click a book to toggle selection (edit mode).
      map.on('click', 'book-fill', (e) => {
        if (!editModeRef.current) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) toggleSelectRef.current(id);
      });

      // Drag a door onto another book to move it.
      let dragging = null;
      map.on('mousedown', 'doors', (e) => {
        if (!editModeRef.current) return;
        e.preventDefault();
        dragging = e.features?.[0]?.properties?.id;
        map.dragPan.disable();
        map.getCanvas().style.cursor = 'grabbing';
      });
      map.on('mouseup', (e) => {
        if (!dragging) return;
        const hit = map.queryRenderedFeatures(e.point, { layers: ['book-fill'] });
        const toTurfId = hit?.[0]?.properties?.id;
        if (toTurfId) moveDoorRef.current(dragging, toTurfId);
        dragging = null;
        map.dragPan.enable();
        map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', 'doors', () => { if (editModeRef.current) map.getCanvas().style.cursor = 'grab'; });
      map.on('mouseleave', 'doors', () => { map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
      paint();
    });

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; };
  }, [tokenQ.data?.isReady]);

  function paint() {
    const map = mapRef.current;
    if (!map || !map.getSource('books')) return;
    map.getSource('books').setData(booksToFillGeoJSON(turfs, colorByTurf, selectedBooks));
    map.getSource('book-labels').setData(booksToLabelGeoJSON(turfs));
    map.getSource('doors').setData(doorsToGeoJSON(doorsQ.data?.doors || [], colorByTurf));
    const bb = bboxOf(turfs);
    if (bb) map.fitBounds(bb, { padding: 50, maxZoom: 15, duration: 0 });
  }
  useEffect(() => { paint(); }, [turfsQ.data, doorsQ.data, selectedBooks]);

  function startDraw() {
    if (drawRef.current) { drawRef.current.deleteAll(); drawRef.current.changeMode('draw_polygon'); }
  }

  const jobBusy = jobId && jobQ.data && jobQ.data.status !== 'completed' && jobQ.data.status !== 'failed';
  const progress = jobQ.data?.progress;
  const pct = typeof progress === 'object' ? progress?.pct : progress;
  const canGenerate = passId && !generate.isPending && !jobBusy && (mode !== 'manual' || drawnPolygon);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Turf Cutting</h1>
        <div className="flex flex-wrap items-center gap-3">
          <CampaignSelector campaignId={campaignId} onChange={(id) => { setCampaignId(id); setPassId(''); }} campaigns={campaigns} isLoading={isLoading} />
          {campaignId && <PassPicker campaignId={campaignId} passId={passId} onChange={setPassId} />}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-base font-medium">Generate books</h2>

          <div className="mb-4 flex rounded-md border border-gray-200 p-0.5 text-sm">
            {['geometric', 'attribute', 'manual'].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={['flex-1 rounded px-2 py-1.5 font-medium capitalize transition-colors', mode === m ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'].join(' ')}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === 'geometric' && (
            <label className="mb-4 block text-sm">
              <span className="mb-1 block text-xs font-medium text-gray-700">Max doors per book</span>
              <input type="number" min="1" value={maxDoors} onChange={(e) => setMaxDoors(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              <span className="mt-1 block text-xs text-gray-500">Default 65 — adjust freely.</span>
            </label>
          )}
          {mode === 'attribute' && (
            <>
              <label className="mb-3 block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-700">Group by</span>
                <select value={attribute} onChange={(e) => setAttribute(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600">
                  {ATTRIBUTES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
              <label className="mb-4 block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-700">Cap at N doors/group (optional)</span>
                <input type="number" min="1" placeholder="no cap" value={capN} onChange={(e) => setCapN(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
              </label>
            </>
          )}
          {mode === 'manual' && (
            <div className="mb-4 text-sm">
              <button onClick={startDraw} className="w-full rounded border border-brand-300 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100">
                ✎ Draw a polygon on the map
              </button>
              <p className="mt-1 text-xs text-gray-500">{drawnPolygon ? 'Polygon drawn — Generate to create the book.' : 'Click to add points; double-click to finish.'}</p>
            </div>
          )}

          <button onClick={() => canGenerate && generate.mutate()} disabled={!canGenerate} className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60">
            {generate.isPending || jobBusy ? 'Generating…' : 'Generate'}
          </button>

          {jobId && (
            <div className="mt-3 text-xs text-gray-600">
              {jobQ.data?.status === 'failed' ? (
                <span className="text-red-700">Failed: {jobQ.data.error || 'unknown error'}</span>
              ) : jobQ.data?.status === 'completed' ? (
                <span className="text-green-700">Done — {jobQ.data?.result?.bookCount ?? draftCount} books.</span>
              ) : (
                <>
                  <div className="mb-1">{progress?.phase || 'queued'}… {pct != null ? `${pct}%` : ''}</div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-gray-100"><div className="h-full bg-brand-500 transition-all" style={{ width: `${pct || 5}%` }} /></div>
                </>
              )}
            </div>
          )}
          {generate.error && <div className="mt-2 text-xs text-red-700">{generate.error.message}</div>}

          {!!turfs.length && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{turfs.length} books{draftCount ? ` · ${draftCount} draft` : ''}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditMode((v) => !v)} className={`rounded px-2 py-1 text-xs font-medium ${editMode ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {editMode ? 'Editing' : 'Edit'}
                  </button>
                  {draftCount > 0 && (
                    <button onClick={() => accept.mutate()} disabled={accept.isPending} className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                      {accept.isPending ? 'Accepting…' : 'Accept'}
                    </button>
                  )}
                </div>
              </div>

              {editMode && (
                <div className="mb-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
                  Drag a door onto another book to move it. Click books to select, then merge.
                  {selectedBooks.size >= 2 && (
                    <button onClick={() => merge.mutate([...selectedBooks])} className="ml-2 rounded bg-brand-600 px-2 py-0.5 font-semibold text-white">
                      Merge {selectedBooks.size}
                    </button>
                  )}
                </div>
              )}

              <ul className="max-h-72 space-y-1 overflow-auto text-sm">
                {turfs.map((t, i) => (
                  <li key={t._id} className="flex items-center justify-between gap-2 rounded px-1 py-0.5">
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: colorFor(i) }} />
                      {editMode ? (
                        <input
                          defaultValue={t.name}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && rename.mutate({ turfId: t._id, name: e.target.value.trim() })}
                          className="min-w-0 flex-1 truncate rounded border border-transparent px-1 hover:border-gray-300 focus:border-brand-500 focus:outline-none"
                        />
                      ) : (
                        <span className="truncate">{t.name}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-gray-500">{t.doorCount}</span>
                      <button onClick={() => setAssignTurf(t)} className="text-xs font-medium text-brand-600 hover:underline">Assign</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {!tokenQ.data?.isReady ? (
            <div className="flex h-[600px] items-center justify-center text-sm text-gray-500">
              {tokenQ.isLoading ? 'Loading map…' : 'Set MAPBOX_PUBLIC_TOKEN to enable the map.'}
            </div>
          ) : (
            <div ref={containerRef} className="h-[600px] w-full" />
          )}
        </section>
      </div>

      {assignTurf && <TurfAssignmentsModal campaignId={campaignId} turf={assignTurf} onClose={() => setAssignTurf(null)} />}
    </div>
  );
}
