import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { api } from '../api/client.js';
import CampaignSelector, { useCampaignSelection } from '../components/CampaignSelector.jsx';
import BookAssignmentPanel from '../components/BookAssignmentPanel.jsx';
import StatCard from '../components/StatCard.jsx';
import InfoHint from '../components/InfoHint.jsx';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';

// Geometric book-size flex → tolerance (how much book sizes may vary from the target
// to stay compact). Default Compact (0.4); consumed by balancedKMeans via params.
const FLEX_OPTIONS = [
  { key: 'tight', label: 'Tight', tolerance: 0.15 },
  { key: 'balanced', label: 'Balanced', tolerance: 0.25 },
  { key: 'compact', label: 'Compact', tolerance: 0.4 },
];

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
      .map((t) => ({ type: 'Feature', geometry: t.centroid, properties: { id: String(t._id), label: `${t.name} · ${t.eligibleDoorCount ?? t.doorCount}` } })),
  };
}
function doorsToGeoJSON(doors, colorByTurf) {
  return {
    type: 'FeatureCollection',
    features: doors.map((d) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      properties: { id: d.id, turfId: d.turfId ? String(d.turfId) : '', color: colorByTurf.get(String(d.turfId)) || '#9ca3af' },
    })),
  };
}

// Apartment units are each their own household but share one geocode, so on the
// map their dots stack and only the top one is clickable. Group doors by rounded
// coordinate (~1.1m): a key with >=2 doors becomes one building marker, lone
// doors stay as normal dots.
function doorKey(d) {
  return `${Math.round(d.lat * 1e5)}|${Math.round(d.lng * 1e5)}`;
}
function groupDoors(doors) {
  const groups = new Map();
  for (const d of doors || []) {
    const k = doorKey(d);
    const arr = groups.get(k) || [];
    arr.push(d);
    groups.set(k, arr);
  }
  const singles = [];
  const buildings = [];
  for (const [key, units] of groups) {
    if (units.length < 2) {
      singles.push(units[0]);
      continue;
    }
    const first = units[0];
    buildings.push({
      key,
      lng: first.lng,
      lat: first.lat,
      turfId: first.turfId,
      addressLine1: first.addressLine1,
      city: first.city,
      state: first.state,
      zipCode: first.zipCode,
      units,
      total: units.length,
    });
  }
  return { singles, buildings };
}

// DOM element for a building marker: an SVG apartment glyph (book-colored) + a
// "{n} units" badge. A building icon — not a numbered bubble — so it never reads
// as pin clustering.
function buildingMarkerEl(total, color) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
  const windows = [];
  for (let i = 0; i < 12; i++) {
    const r = Math.floor(i / 3);
    const c = i % 3;
    windows.push(`<rect x="${7 + c * 3.6}" y="${5 + r * 3.6}" width="2.2" height="2.2" rx="0.4" fill="#fff" opacity="0.92"/>`);
  }
  el.innerHTML =
    `<svg width="28" height="28" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))">` +
    `<rect x="5" y="2.5" width="14" height="19" rx="1.4" fill="${color}" stroke="#fff" stroke-width="1.4"/>` +
    windows.join('') +
    `</svg>` +
    `<div style="margin-top:-4px;background:#111827;color:#fff;font-size:10px;font-weight:700;line-height:1;padding:2px 6px;border-radius:8px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.25)">${total} units</div>`;
  return el;
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
// Bbox of the raw door points — used to frame the houses before any books exist.
function bboxOfDoors(doors) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const p of doors || []) {
    const x = p.lng; const y = p.lat;
    if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
  }
  return Number.isFinite(a) ? [[a, b], [c, d]] : null;
}

function PassPicker({ campaignId, passId, onChange }) {
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  const passes = passesQ.data?.passes || [];
  const activeIds = passesQ.data?.activePassIds || [];
  const effortName = new Map((effortsQ.data?.efforts || []).map((e) => [String(e._id), e.name]));
  useEffect(() => {
    if (passId || !passes.length) return;
    onChange(String(activeIds[0] || passes[0]._id));
  }, [passId, passes, activeIds]);
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
          <option key={p._id} value={p._id}>
            {effortName.get(String(p.effortId)) || 'Effort'} · Pass {p.roundNumber} · {p.name} ({p.status})
          </option>
        ))}
      </select>
    </div>
  );
}

function DiscardModal({ isActive, bookCount, clearKnocks, setClearKnocks, pending, error, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">
          Discard {bookCount} book{bookCount === 1 ? '' : 's'}?
        </h3>
        {isActive ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            ⚠️ This pass is <strong>LIVE</strong>. Discarding wipes its books and{' '}
            <strong>all canvasser assignments</strong>, and reverts the pass to draft. Knock history is kept
            unless you check the box below.
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            This removes the pass's books and canvasser assignments so you can re-cut. Knock history is kept. You
            can undo this from Snapshots.
          </p>
        )}
        <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={clearKnocks} onChange={(e) => setClearKnocks(e.target.checked)} className="mt-0.5" />
          <span>
            Also clear all knock history for this pass — resets door progress.{' '}
            <span className="text-gray-400">(Snapshotted; undoable.)</span>
          </span>
        </label>
        {error && <div className="mt-2 text-xs text-red-700">{error.message}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={pending} className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? 'Discarding…' : clearKnocks ? 'Discard + clear knocks' : 'Discard books'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HousePopup({ data, loading, book, bookColor, books = [], moving, onMove, onClose }) {
  const hh = data?.household;
  const voters = data?.voters || [];
  const currentId = book ? String(book._id) : null;
  return (
    <div className="absolute right-3 top-3 z-10 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {loading || !hh ? (
            <div className="text-sm text-gray-500">Loading…</div>
          ) : (
            <>
              <div className="truncate text-sm font-semibold text-gray-900">{hh.addressLine1}</div>
              {hh.addressLine2 && <div className="truncate text-xs text-gray-500">{hh.addressLine2}</div>}
              <div className="text-xs text-gray-500">{hh.city}, {hh.state} {hh.zipCode}</div>
            </>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">✕</button>
      </div>
      {hh && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            {bookColor && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: bookColor }} />}
            <span className="font-medium">{book ? book.name : 'Unassigned'}</span>
          </div>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
            disabled={moving}
            className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60"
          >
            <option value="">{moving ? 'Moving…' : 'Move to book…'}</option>
            {books
              .filter((t) => String(t._id) !== currentId)
              .map((t) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
          </select>
        </div>
      )}
      {hh && (
        <div className="mt-2 border-t border-gray-100 pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {voters.length} member{voters.length === 1 ? '' : 's'}
          </div>
          <ul className="max-h-40 space-y-0.5 overflow-auto text-sm">
            {voters.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-gray-800">{v.fullName}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {v.party && <span className="text-[10px] text-gray-400">{v.party}</span>}
                  {v.surveyStatus === 'surveyed' && <span className="text-[10px] font-semibold text-green-600" title="Surveyed">✓</span>}
                </span>
              </li>
            ))}
            {!voters.length && <li className="text-xs text-gray-400">No members on file.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function BuildingPopup({ building, books = [], colorByTurf, moving, onMove, onMoveAll, onClose }) {
  if (!building) return null;
  const { addressLine1, city, state, zipCode, units, total } = building;
  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <span aria-hidden>🏢</span>
            <span className="truncate">{addressLine1 || 'Apartment building'}</span>
          </div>
          <div className="text-xs text-gray-500">{city}, {state} {zipCode}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-brand-600">{total} units at this location</div>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">✕</button>
      </div>

      <div className="mt-2 border-t border-gray-100 pt-2">
        <select
          value=""
          onChange={(e) => { if (e.target.value) onMoveAll(e.target.value); }}
          disabled={moving}
          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60"
        >
          <option value="">{moving ? 'Moving…' : 'Move all units to book…'}</option>
          {books.map((t) => (
            <option key={t._id} value={t._id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 border-t border-gray-100 pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Units</div>
        <ul className="max-h-56 space-y-1 overflow-auto">
          {units.map((u) => {
            const book = u.turfId ? books.find((t) => String(t._id) === String(u.turfId)) : null;
            const color = u.turfId ? colorByTurf.get(String(u.turfId)) : null;
            return (
              <li key={u.id} className="rounded border border-gray-100 p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-800">{u.addressLine2 || u.addressLine1 || 'Unit'}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />}
                    <span className="text-[10px] text-gray-500">{book ? book.name : 'Unassigned'}</span>
                  </span>
                </div>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) onMove(u.id, e.target.value); }}
                  disabled={moving}
                  className="mt-1 w-full rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-700 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60"
                >
                  <option value="">Move to book…</option>
                  {books
                    .filter((t) => String(t._id) !== String(u.turfId))
                    .map((t) => (
                      <option key={t._id} value={t._id}>{t.name}</option>
                    ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default function TurfsPage() {
  const qc = useQueryClient();
  const orgTz = useOrgTimeZone();
  const { campaignId, setCampaignId, campaigns, isLoading } = useCampaignSelection();
  // Turf snapshots belong to the selected campaign → show times in its tz (fallback org).
  const tz = campaigns.find((c) => String(c._id) === String(campaignId))?.timeZone || orgTz;
  // A deep-link from Efforts/Passes (?passId=) pre-selects the pass; the PassPicker's
  // auto-select only kicks in when this is empty, so a seeded value wins.
  const [searchParams] = useSearchParams();
  const [passId, setPassId] = useState(() => searchParams.get('passId') || '');

  const [mode, setMode] = useState('geometric');
  const [attribute, setAttribute] = useState('precinct');
  const [capN, setCapN] = useState('');
  const [maxDoors, setMaxDoors] = useState(65);
  const [flex, setFlex] = useState('compact');
  const [jobId, setJobId] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(new Set());
  const [drawnPolygon, setDrawnPolygon] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [clearKnocks, setClearKnocks] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState(null);
  const [popupHouseholdId, setPopupHouseholdId] = useState(null);
  const [popupBuildingKey, setPopupBuildingKey] = useState(null);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const editModeRef = useRef(false);
  const moveDoorRef = useRef(() => {});
  const toggleSelectRef = useRef(() => {});
  const clearSelectionRef = useRef(() => {});
  const fittedSigRef = useRef(null);
  const openPopupRef = useRef(() => {});
  const openBuildingPopupRef = useRef(() => {});
  const buildingMarkersRef = useRef([]);

  const tokenQ = useQuery({ queryKey: ['config', 'mapbox-token'], queryFn: () => api('/admin/config/mapbox-token') });
  const turfsQ = useQuery({
    queryKey: ['turfs', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs?passId=${passId}`),
    enabled: !!campaignId && !!passId,
  });
  // Doors load for the whole pass so every household shows on the map as a dot
  // colored by its book the moment a cut completes — not only in edit mode.
  // (Drag-to-move is still gated behind editMode in the map handlers below.)
  const doorsQ = useQuery({
    queryKey: ['turf-doors', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/doors?passId=${passId}`),
    enabled: !!campaignId && !!passId,
  });
  const turfs = turfsQ.data?.turfs || [];
  const draftCount = turfs.filter((t) => t.status === 'draft').length;
  const publishedCount = turfs.filter((t) => t.status === 'published').length;
  const colorByTurf = useMemo(() => new Map(turfs.map((t, i) => [String(t._id), colorFor(i)])), [turfsQ.data]);
  const selectedTurfs = turfs.filter((t) => selectedBooks.has(String(t._id)));
  // Group stacked apartment units (same geocode) into buildings; lone doors stay
  // singles. Used for the dot layer, the building markers, and the popup.
  const grouped = useMemo(() => groupDoors(doorsQ.data?.doors || []), [doorsQ.data]);
  // Doors not yet in any book — e.g. voters imported after this pass was cut.
  const unassignedCount = (doorsQ.data?.doors || []).filter((d) => !d.turfId).length;
  // The popup's house + its current book, derived live from the doors data so it
  // updates after a move.
  const popupDoor = (doorsQ.data?.doors || []).find((d) => String(d.id) === String(popupHouseholdId));
  const popupBook = popupDoor?.turfId ? turfs.find((t) => String(t._id) === String(popupDoor.turfId)) || null : null;
  const popupBuilding = popupBuildingKey ? grouped.buildings.find((b) => b.key === popupBuildingKey) || null : null;

  // Selected pass (shares react-query cache with PassPicker) — for the live flag
  // + whether Discard must confirm an active pass.
  const passesQ = useQuery({
    queryKey: ['admin', 'passes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/passes`),
    enabled: !!campaignId,
  });
  const selectedPass = (passesQ.data?.passes || []).find((p) => String(p._id) === String(passId)) || null;
  const isActivePass = selectedPass?.status === 'active';

  const snapshotsQ = useQuery({
    queryKey: ['turf-snapshots', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/snapshots?passId=${passId}`),
    enabled: !!campaignId && !!passId,
  });
  const snapshots = snapshotsQ.data?.snapshots || [];

  // Pass-level assignments → turfId -> [canvassers], for the per-book chips.
  const assignmentsQ = useQuery({
    queryKey: ['turf-pass-assignments', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/assignments?passId=${passId}`),
    enabled: !!campaignId && !!passId,
  });
  const assignedByTurf = new Map();
  for (const a of assignmentsQ.data?.assignments || []) {
    const key = String(a.turfId);
    const arr = assignedByTurf.get(key) || [];
    arr.push(a.user);
    assignedByTurf.set(key, arr);
  }

  // At-a-glance summary (all client-derived from data already loaded).
  const totalHouses = turfs.reduce((s, t) => s + (t.eligibleDoorCount ?? t.doorCount ?? 0), 0);
  const assignedUserSet = new Set();
  for (const arr of assignedByTurf.values()) for (const u of arr) assignedUserSet.add(u.id);
  const booksUnassigned = turfs.filter((t) => !(assignedByTurf.get(String(t._id)) || []).length).length;
  const selectedDoors = selectedTurfs.reduce((s, t) => s + (t.eligibleDoorCount ?? t.doorCount ?? 0), 0);

  // Single household detail for the click-a-dot popup.
  const householdQ = useQuery({
    queryKey: ['turf-household', campaignId, popupHouseholdId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/household/${popupHouseholdId}`),
    enabled: !!campaignId && !!popupHouseholdId,
  });

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
      else params = { maxDoors: Number(maxDoors) || 65, tolerance: (FLEX_OPTIONS.find((o) => o.key === flex) || {}).tolerance };
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
  const discard = useMutation({
    mutationFn: (opts = {}) =>
      api(`/admin/campaigns/${campaignId}/turfs/discard`, {
        method: 'POST',
        body: { passId, confirmActive: !!opts.confirmActive, clearKnocks: !!opts.clearKnocks },
      }),
    onSuccess: (res) => {
      setShowDiscard(false);
      setClearKnocks(false);
      setSelectedBooks(new Set());
      setEditMode(false);
      setLastSnapshotId(res?.snapshotId || null);
      invalidateTurfs();
      qc.invalidateQueries({ queryKey: ['turf-snapshots', campaignId, passId] });
      qc.invalidateQueries({ queryKey: ['admin', 'passes', campaignId] });
    },
  });
  const restore = useMutation({
    mutationFn: (snapshotId) =>
      api(`/admin/campaigns/${campaignId}/turfs/restore-snapshot`, { method: 'POST', body: { snapshotId } }),
    onSuccess: () => {
      setLastSnapshotId(null);
      invalidateTurfs();
      qc.invalidateQueries({ queryKey: ['turf-snapshots', campaignId, passId] });
      qc.invalidateQueries({ queryKey: ['admin', 'passes', campaignId] });
    },
  });
  const deleteSnapshot = useMutation({
    mutationFn: (snapshotId) => api(`/admin/campaigns/${campaignId}/turfs/snapshots/${snapshotId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['turf-snapshots', campaignId, passId] }),
  });
  const moveDoor = useMutation({
    mutationFn: ({ householdId, toTurfId }) => api(`/admin/campaigns/${campaignId}/turfs/move-door`, { method: 'POST', body: { householdId, toTurfId } }),
    onSuccess: invalidateTurfs,
  });
  const moveDoors = useMutation({
    mutationFn: ({ householdIds, toTurfId }) => api(`/admin/campaigns/${campaignId}/turfs/move-doors`, { method: 'POST', body: { householdIds, toTurfId } }),
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
  // Fold voters imported after this pass was cut (currently unassigned to any
  // book) into the pass as new draft book(s) — no recut, no archive.
  const addSupplemental = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/add-supplemental`, { method: 'POST', body: { passId } }),
    onSuccess: invalidateTurfs,
  });

  // A book is selected by clicking it in the list OR on the map; clicking again
  // toggles it off. The same Set drives the highlight in both places and the panel.
  const toggleBook = (id) =>
    setSelectedBooks((s) => { const k = String(id); const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  // keep refs current for the once-registered map handlers
  editModeRef.current = editMode;
  moveDoorRef.current = (householdId, toTurfId) => moveDoor.mutate({ householdId, toTurfId });
  toggleSelectRef.current = toggleBook;
  clearSelectionRef.current = () => setSelectedBooks(new Set());
  openPopupRef.current = (id) => { setPopupBuildingKey(null); setPopupHouseholdId(id); };
  openBuildingPopupRef.current = (key) => { setPopupHouseholdId(null); setPopupBuildingKey(key); };

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
      map.addLayer({ id: 'book-fill', type: 'fill', source: 'books', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.3, 0.16] } });
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

      // Click a book polygon to toggle it into the selection (drives the assignment
      // panel + highlight). Skip if a house is under the click — that's a door tap,
      // handled by the doors layer below.
      map.on('click', 'book-fill', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ['doors'] }).length) return;
        const id = e.features?.[0]?.properties?.id;
        if (id) toggleSelectRef.current(id);
      });
      map.on('mouseenter', 'book-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'book-fill', () => { map.getCanvas().style.cursor = ''; });

      // Click empty map (not a book, not a door) → clear the selection.
      map.on('click', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ['book-fill', 'doors'] }).length) return;
        clearSelectionRef.current();
      });

      // Click a house (any mode) → popup with address + members + book + move-to-book.
      map.on('click', 'doors', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) openPopupRef.current(id);
      });
      map.on('mouseenter', 'doors', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'doors', () => { map.getCanvas().style.cursor = ''; });

      mapRef.current = map;
      setMapReady(true); // re-fires the paint effect now that sources exist
    });

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; setMapReady(false); };
  }, [tokenQ.data?.isReady]);

  function paint() {
    const map = mapRef.current;
    if (!map || !map.getSource('books')) return;
    map.getSource('books').setData(booksToFillGeoJSON(turfs, colorByTurf, selectedBooks));
    map.getSource('book-labels').setData(booksToLabelGeoJSON(turfs));
    map.getSource('doors').setData(doorsToGeoJSON(grouped.singles, colorByTurf));

    // All books/doors stay visible — selection just thickens the outline + brightens
    // the fill (the `selected` paint props). Selecting books never hides the rest, so
    // multi-select on the map stays usable and you keep the full picture.
    map.setFilter('book-fill', null);
    map.setFilter('book-outline', null);
    map.setFilter('book-labels', null);
    map.setFilter('doors', null);

    // Fit to the books (or raw house dots before any cut) ONCE per data set — keyed
    // by the book-id signature so selection toggles and assignment refetches never
    // yank the admin's pan/zoom. Switching pass changes the signature → refits.
    const sig = turfs.map((t) => String(t._id)).join(',') || `doors:${(doorsQ.data?.doors || []).length}`;
    if (fittedSigRef.current !== sig) {
      fittedSigRef.current = sig;
      const bb = bboxOf(turfs) || bboxOfDoors(doorsQ.data?.doors);
      if (bb) map.fitBounds(bb, { padding: 50, maxZoom: 15, duration: 0 });
    }
  }
  useEffect(() => { paint(); }, [turfsQ.data, doorsQ.data, selectedBooks, mapReady]);

  // Building markers (HTML overlays) for stacked apartment units — synced apart
  // from paint() so book-select toggles don't churn the DOM.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    buildingMarkersRef.current.forEach((m) => m.remove());
    buildingMarkersRef.current = [];
    for (const b of grouped.buildings) {
      const color = colorByTurf.get(String(b.turfId)) || '#9ca3af';
      const el = buildingMarkerEl(b.total, color);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openBuildingPopupRef.current(b.key); });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([b.lng, b.lat]).addTo(map);
      buildingMarkersRef.current.push(marker);
    }
  }, [grouped, colorByTurf, mapReady]);

  // Clear selection + popups when switching pass/campaign (those books are gone).
  useEffect(() => { setSelectedBooks(new Set()); setPopupHouseholdId(null); setPopupBuildingKey(null); }, [passId, campaignId]);

  function startDraw() {
    if (drawRef.current) { drawRef.current.deleteAll(); drawRef.current.changeMode('draw_polygon'); }
  }

  const jobBusy = jobId && jobQ.data && jobQ.data.status !== 'completed' && jobQ.data.status !== 'failed';
  const progress = jobQ.data?.progress;
  const pct = typeof progress === 'object' ? progress?.pct : progress;
  const canGenerate =
    passId && !generate.isPending && !jobBusy && publishedCount === 0 && (mode !== 'manual' || drawnPolygon);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Turf Cutting</h1>
        <div className="flex flex-wrap items-center gap-3">
          <CampaignSelector campaignId={campaignId} onChange={(id) => { setCampaignId(id); setPassId(''); }} campaigns={campaigns} isLoading={isLoading} />
          {campaignId && <PassPicker campaignId={campaignId} passId={passId} onChange={setPassId} />}
          {isActivePass && (
            <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-700">
              ● Live
            </span>
          )}
        </div>
      </div>

      {!!turfs.length && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Books" value={turfs.length.toLocaleString()} hint={draftCount ? `${draftCount} draft` : undefined} />
          <StatCard
            label="Houses"
            value={totalHouses.toLocaleString()}
            hint={unassignedCount > 0 ? `${unassignedCount.toLocaleString()} not in a book` : undefined}
          />
          <StatCard
            label="Canvassers assigned"
            value={assignedUserSet.size.toLocaleString()}
            accent={assignedUserSet.size ? 'brand' : undefined}
            hint={booksUnassigned > 0 ? `${booksUnassigned} book${booksUnassigned === 1 ? '' : 's'} unassigned` : 'every book covered'}
          />
          <StatCard
            label="Selected"
            value={selectedBooks.size.toLocaleString()}
            accent={selectedBooks.size ? 'brand' : undefined}
            hint={selectedBooks.size ? `${selectedDoors.toLocaleString()} doors` : undefined}
          />
        </div>
      )}

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
            <div className="mb-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-gray-700">Max doors per book</span>
                <input type="number" min="1" value={maxDoors} onChange={(e) => setMaxDoors(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
                <span className="mt-1 block text-xs text-gray-500">Default 65 — adjust freely.</span>
              </label>
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-700">Book size flex</span>
                  <InfoHint label="What is book size flex?">
                    Books aim for your door count but flex to stay tight and walkable. <b>Compact</b> lets
                    sizes vary more so nobody drives far for a stray house; <b>Tight</b> keeps sizes even
                    but may leave a few houses in a slightly farther book. For a 65-door target, books land
                    roughly ~55–80 (Tight), ~48–90 (Balanced), ~40–100 (Compact).
                  </InfoHint>
                </div>
                <div className="flex rounded-md border border-gray-300 p-0.5 text-xs">
                  {FLEX_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setFlex(o.key)}
                      className={['flex-1 rounded px-2 py-1 font-medium transition-colors', flex === o.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'].join(' ')}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
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
          {publishedCount > 0 && (
            <p className="mt-2 text-xs text-amber-700">This pass has accepted books — Discard them below to re-cut.</p>
          )}

          {!!turfs.length && unassignedCount > 0 && (
            <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs">
              <p className="font-medium text-sky-900">
                {unassignedCount.toLocaleString()} door{unassignedCount === 1 ? '' : 's'} not in any book
              </p>
              <p className="mt-0.5 text-sky-800">
                Voters added since this pass was cut. Add them as new book(s) without recutting — then
                Accept and assign as usual.
              </p>
              <button
                onClick={() => addSupplemental.mutate()}
                disabled={addSupplemental.isPending}
                className="mt-2 rounded bg-sky-600 px-2.5 py-1 font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {addSupplemental.isPending ? 'Adding…' : 'Add as new book'}
              </button>
              {addSupplemental.error && (
                <div className="mt-1 text-red-700">{addSupplemental.error.message}</div>
              )}
              {addSupplemental.data?.added === 0 && (
                <div className="mt-1 text-sky-800">No eligible doors to add (walk-list passes only include their saved list).</div>
              )}
            </div>
          )}

          {!!turfs.length && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{turfs.length} books{draftCount ? ` · ${draftCount} draft` : ''}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditMode((v) => !v)} title="Rename books" className={`rounded px-2 py-1 text-xs font-medium ${editMode ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {editMode ? 'Renaming' : 'Rename'}
                  </button>
                  {draftCount > 0 && (
                    <button onClick={() => accept.mutate()} disabled={accept.isPending} className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60">
                      {accept.isPending ? 'Accepting…' : 'Accept'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowDiscard(true)}
                    disabled={discard.isPending}
                    className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    {discard.isPending ? 'Discarding…' : 'Discard'}
                  </button>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-3 text-xs">
                <button onClick={() => setSelectedBooks(new Set(turfs.map((t) => String(t._id))))} className="font-medium text-brand-700 hover:underline">Select all</button>
                {selectedBooks.size > 0 && (
                  <button onClick={() => setSelectedBooks(new Set())} className="font-medium text-gray-500 hover:underline">Clear ({selectedBooks.size})</button>
                )}
                <span className="text-gray-400">Click a book (here or on the map) to assign canvassers.</span>
              </div>

              {editMode && (
                <div className="mb-2 rounded bg-gray-50 px-2 py-1.5 text-xs text-gray-600">
                  Rename mode: edit a book's name below. Selecting/assigning still works as usual.
                </div>
              )}

              <ul className="max-h-72 space-y-1 overflow-auto text-sm">
                {turfs.map((t, i) => {
                  const selected = selectedBooks.has(String(t._id));
                  return (
                  <li
                    key={t._id}
                    onClick={() => toggleBook(t._id)}
                    title="Click to select this book (assign on the panel); click again to deselect"
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 ${
                      selected ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: colorFor(i) }} />
                      {editMode ? (
                        <input
                          defaultValue={t.name}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && rename.mutate({ turfId: t._id, name: e.target.value.trim() })}
                          className="min-w-0 flex-1 truncate rounded border border-transparent px-1 hover:border-gray-300 focus:border-brand-500 focus:outline-none"
                        />
                      ) : (
                        <span className="truncate">{t.name}</span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {(() => {
                        const asg = assignedByTurf.get(String(t._id)) || [];
                        if (!asg.length) return null;
                        return (
                          <span className="flex -space-x-1" title={asg.map((u) => `${u.firstName} ${u.lastName}`).join(', ')}>
                            {asg.slice(0, 3).map((u) => (
                              <span key={u.id} className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-[8px] font-semibold text-brand-700 ring-1 ring-white">
                                {(u.firstName?.[0] || '') + (u.lastName?.[0] || '')}
                              </span>
                            ))}
                            {asg.length > 3 && <span className="pl-1 text-[9px] text-gray-400">+{asg.length - 3}</span>}
                          </span>
                        );
                      })()}
                      <span className="text-gray-500">{t.eligibleDoorCount ?? t.doorCount}</span>
                    </span>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}

          {snapshots.length > 0 && (
            <div className="mt-5 border-t border-gray-100 pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Undo / snapshots</div>
              {lastSnapshotId && turfs.length === 0 && (
                <button
                  onClick={() => restore.mutate(lastSnapshotId)}
                  disabled={restore.isPending}
                  className="mb-2 w-full rounded bg-gray-800 px-2 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
                >
                  {restore.isPending ? 'Restoring…' : '↩ Undo last discard'}
                </button>
              )}
              <ul className="space-y-1 text-xs">
                {snapshots.map((s) => (
                  <li key={s._id} className="flex items-center justify-between gap-2 rounded px-1 py-1">
                    <span className="min-w-0 truncate text-gray-600">
                      {formatInTz(s.createdAt, tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)} · {s.bookCount} books
                      {s.clearedKnocks ? ` · ${s.knockCount} knocks` : ''}
                      {s.restoredAt ? ' · restored' : ''}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => restore.mutate(s._id)}
                        disabled={restore.isPending || turfs.length > 0}
                        title={turfs.length > 0 ? 'Discard current books first' : 'Restore this snapshot'}
                        className="rounded border border-gray-300 px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Delete this snapshot? It can no longer be restored.')) deleteSnapshot.mutate(s._id); }}
                        disabled={deleteSnapshot.isPending}
                        title="Delete snapshot"
                        className="rounded px-1.5 py-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {turfs.length > 0 && (
                <p className="mt-1 text-[11px] text-gray-400">Discard the current books to restore an earlier snapshot.</p>
              )}
              {restore.error && <div className="mt-1 text-[11px] text-red-700">{restore.error.message}</div>}
            </div>
          )}
        </section>

        <section className="relative overflow-hidden rounded-lg border border-gray-200 bg-white">
          {!tokenQ.data?.isReady ? (
            <div className="flex h-[600px] items-center justify-center text-sm text-gray-500">
              {tokenQ.isLoading ? 'Loading map…' : 'Set MAPBOX_PUBLIC_TOKEN to enable the map.'}
            </div>
          ) : (
            <div ref={containerRef} className="h-[600px] w-full" />
          )}
          {popupHouseholdId && (
            <HousePopup
              data={householdQ.data}
              loading={householdQ.isLoading}
              book={popupBook}
              bookColor={popupBook ? colorByTurf.get(String(popupBook._id)) : null}
              books={turfs}
              moving={moveDoor.isPending}
              onMove={(toTurfId) => moveDoor.mutate({ householdId: popupHouseholdId, toTurfId })}
              onClose={() => setPopupHouseholdId(null)}
            />
          )}
          {popupBuilding && (
            <BuildingPopup
              building={popupBuilding}
              books={turfs}
              colorByTurf={colorByTurf}
              moving={moveDoor.isPending || moveDoors.isPending}
              onMove={(householdId, toTurfId) => moveDoor.mutate({ householdId, toTurfId })}
              onMoveAll={(toTurfId) => moveDoors.mutate({ householdIds: popupBuilding.units.map((u) => u.id), toTurfId })}
              onClose={() => setPopupBuildingKey(null)}
            />
          )}
          {selectedTurfs.length > 0 && (
            <BookAssignmentPanel
              campaignId={campaignId}
              passId={passId}
              books={selectedTurfs}
              assignedByTurf={assignedByTurf}
              onClear={() => setSelectedBooks(new Set())}
              onMerge={() => merge.mutate([...selectedBooks])}
              mergePending={merge.isPending}
            />
          )}
        </section>
      </div>

      {showDiscard && (
        <DiscardModal
          isActive={isActivePass}
          bookCount={turfs.length}
          clearKnocks={clearKnocks}
          setClearKnocks={setClearKnocks}
          pending={discard.isPending}
          error={discard.error}
          onCancel={() => { setShowDiscard(false); setClearKnocks(false); }}
          onConfirm={() => discard.mutate({ confirmActive: isActivePass, clearKnocks })}
        />
      )}
    </div>
  );
}
