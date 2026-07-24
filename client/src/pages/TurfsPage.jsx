import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import { api } from '../api/client.js';
import { useCampaignSelection } from '../components/CampaignSelector.jsx';
import BookAssignmentPanel from '../components/BookAssignmentPanel.jsx';
import AnswerFilters from '../components/AnswerFilters.jsx';
import MapStyleControl from '../components/MapStyleControl.jsx';
import StatCard from '../components/StatCard.jsx';
import InfoHint from '../components/InfoHint.jsx';
import NextStepBanner from '../components/NextStepBanner.jsx';
import CoverageBar from '../components/CoverageBar.jsx';
import { useMapStyle } from '../lib/mapStyles.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import { formatInTz } from '../lib/datetime.js';
import { STATUS_COLORS, statusColorsForTheme, STATUS_LABELS, actionLabel } from '../lib/statusColors.js';

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

// Share of a book's eligible doors already worked this round (0–1), or null before any
// progress is known. Drives the completion tint on the book fill.
function bookProgress(turfId, progressByTurf) {
  const p = progressByTurf?.get(String(turfId));
  if (!p || !p.total) return null;
  return p.knocked / p.total;
}

function booksToFillGeoJSON(turfs, colorByTurf, selected, progressByTurf) {
  return {
    type: 'FeatureCollection',
    features: turfs
      .filter((t) => t.boundary?.coordinates?.length)
      .map((t) => ({
        type: 'Feature',
        geometry: t.boundary,
        properties: {
          id: String(t._id),
          color: colorByTurf.get(String(t._id)),
          selected: selected.has(String(t._id)),
          // Hue stays the book's color; only alpha varies, so an untouched book reads pale
          // and a finished one solid without ever losing its identity.
          progress: bookProgress(t._id, progressByTurf) ?? 0,
        },
      })),
  };
}
function booksToLabelGeoJSON(turfs, selected, progressByTurf, statusMode) {
  return {
    type: 'FeatureCollection',
    features: turfs
      .filter((t) => t.centroid?.coordinates?.length === 2)
      .map((t) => {
        const p = statusMode ? progressByTurf?.get(String(t._id)) : null;
        // "Book 4 · 23/65" once the round is underway, else today's plain door count.
        // Deliberately no percentage in the text — it lengthens the label and worsens the
        // collision-culling below; the fill tint is what carries the percentage.
        const label = p && p.total ? `${t.name} · ${p.knocked}/${p.total}` : `${t.name} · ${t.eligibleDoorCount ?? t.doorCount}`;
        return {
          type: 'Feature',
          geometry: t.centroid,
          properties: { id: String(t._id), label, selected: selected.has(String(t._id)) },
        };
      }),
  };
}
// `color` is what the dot is filled with, `ringColor` the halo beneath it. In status mode the
// fill carries THIS ROUND's door status and the ring keeps book identity, so both read at once —
// which matters because a book's outline provably need not contain all of its own doors (the
// Voronoi clip in services/turf/boundary.js), while the ring is keyed on turfId and always right.
function doorsToGeoJSON(doors, colorByTurf, targetedSet, statusMode, dark) {
  const statusColors = statusColorsForTheme(dark);
  return {
    type: 'FeatureCollection',
    features: doors.map((d) => {
      const bookColor = colorByTurf.get(String(d.turfId)) || '#9ca3af';
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        properties: {
          id: d.id,
          turfId: d.turfId ? String(d.turfId) : '',
          color: statusMode ? statusColors[d.passStatus || 'unknocked'] || statusColors.unknocked : bookColor,
          ringColor: bookColor,
          // When a target filter is active, dim doors that aren't in the matched set.
          dim: targetedSet ? !targetedSet.has(String(d.id)) : false,
        },
      };
    }),
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
function buildingMarkerEl(total, color, dark, badgeText) {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;';
  // A small 2x2-window building glyph (was 28px + 12 windows) — far less clutter at 100+ markers.
  const windows = [];
  for (let i = 0; i < 4; i++) {
    const r = Math.floor(i / 2);
    const c = i % 2;
    windows.push(`<rect x="${8.5 + c * 4}" y="${7 + r * 4}" width="2.6" height="2.6" rx="0.5" fill="#fff" opacity="0.92"/>`);
  }
  // The "{n} units" badge inverts on dark/satellite basemaps so it stays legible. Hidden by
  // default — the marker effect shows it at zoom ≥ 16 and on hover so it doesn't crowd the map.
  const badgeBg = dark ? '#e5e7eb' : '#111827';
  const badgeFg = dark ? '#111827' : '#fff';
  el.innerHTML =
    `<svg width="18" height="18" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,0.35))">` +
    `<rect x="6" y="3" width="12" height="18" rx="1.4" fill="${color}" stroke="#fff" stroke-width="1.4"/>` +
    windows.join('') +
    `</svg>` +
    `<div class="units-badge" style="display:none;margin-top:-3px;background:${badgeBg};color:${badgeFg};font-size:10px;font-weight:700;line-height:1;padding:2px 6px;border-radius:8px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.25)">${badgeText || `${total} units`}</div>`;
  return el;
}

// Compact inline stat (one slim strip instead of the tall StatCard grid — the shared
// StatCard is left untouched for the dashboards). Reclaims header height for the map.
function StatChip({ label, value, hint, accent }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-fg-muted">{label}</span>
      <span className={'text-sm font-semibold tabular-nums ' + (accent ? 'text-brand-accent' : 'text-fg')}>{value}</span>
      {hint && <span className="text-[11px] text-fg-muted">· {hint}</span>}
    </div>
  );
}

// Book status filter chips (multi-select). Coverage (assigned/unassigned) + progress
// (completed/in-progress/not-started). Filtering hides non-matching books + their dots.
const BOOK_STATUS_CHIPS = [
  { key: 'assigned', label: 'Assigned', color: '#16a34a' },
  { key: 'unassigned', label: 'Unassigned', color: '#9ca3af' },
  { key: 'completed', label: 'Completed', color: '#2563eb' },
  { key: 'in_progress', label: 'In progress', color: '#ca8a04' },
  { key: 'not_started', label: 'Not started', color: '#dc2626' },
];
function BookStatusChips({ value, onChange, counts }) {
  const toggle = (k) => {
    const n = new Set(value);
    n.has(k) ? n.delete(k) : n.add(k);
    onChange(n);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {BOOK_STATUS_CHIPS.map((c) => {
        const active = value.has(c.key);
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => toggle(c.key)}
            className={
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
              (active ? 'border-brand-600 bg-brand-tint text-brand-accent' : 'border-border bg-card text-fg-muted hover:bg-sunken')
            }
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
            {c.label}
            <span className="text-fg-subtle">{counts?.[c.key] ?? 0}</span>
          </button>
        );
      })}
      {value.size > 0 && (
        <button type="button" onClick={() => onChange(new Set())} className="ml-1 text-[11px] text-brand-accent hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}

// (Re)create the book/door sources + layers. Called on initial `load` and after
// every basemap `setStyle` (which wipes them). `dark` flips the book-label text +
// halo so labels stay readable on dark/satellite basemaps.
function registerBookLayers(map, dark) {
  // Idempotency backstop: registering twice on one style (e.g. stacked
  // style.load handlers) would throw mapbox's duplicate-source error.
  if (map.getSource('books')) return;

  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('books', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'book-fill',
    type: 'fill',
    source: 'books',
    paint: {
      'fill-color': ['get', 'color'],
      // Tinted by completion: pale at 0% worked, solid at 100%, with the selected book
      // lifted above whatever its progress would otherwise give it.
      'fill-opacity': [
        'case',
        ['get', 'selected'],
        ['interpolate', ['linear'], ['get', 'progress'], 0, 0.3, 1, 0.46],
        ['interpolate', ['linear'], ['get', 'progress'], 0, 0.1, 1, 0.32],
      ],
    },
  });
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
    layout: {
      'text-field': ['get', 'label'],
      // Grow with zoom so a book's label is readable once you zoom in (was a flat 12).
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 14, 16, 17, 22],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      // Collision-cull (text-allow-overlap can't be data-driven); symbol-sort-key places the
      // SELECTED book's label first so it wins collisions and always shows.
      'text-allow-overlap': false,
      'symbol-sort-key': ['case', ['boolean', ['get', 'selected'], false], 0, 1],
    },
    paint: {
      'text-color': dark ? '#e5e7eb' : '#111827',
      'text-halo-color': dark ? '#0b0f19' : '#ffffff',
      'text-halo-width': 2,
      'text-halo-blur': 0.5,
    },
  });
  map.addSource('doors', { type: 'geojson', data: empty });
  // Book-colored halo UNDER each dot. In status mode the dot itself is spent on the door's
  // round status, so this is what still says "and it belongs to Book 4". Hidden when status
  // mode is off (the dot is already the book color then — a ring would just be a fatter dot).
  // Starts hidden and is switched on by the layer-visibility effect, so a fresh cut (the
  // common cutting case, status mode off) never flashes rings for a frame on load or after
  // a basemap swap re-registers these layers.
  map.addLayer({
    id: 'door-book-ring',
    type: 'circle',
    source: 'doors',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.7, 15, 7.2],
      'circle-color': ['get', 'ringColor'],
      'circle-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.12, 1],
    },
  });
  map.addLayer({
    id: 'doors',
    type: 'circle',
    source: 'doors',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.12, 1],
      'circle-stroke-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.12, 1],
    },
  });
  // Lift the labels above the door dots so the dots don't overprint the text.
  if (map.getLayer('book-labels')) map.moveLayer('book-labels');
}
function bboxOf(turfs) {
  let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
  for (const t of turfs) {
    // A book with pocket islands stores a MultiPolygon (one extra nesting level) — flatten
    // it to the same rings-of-positions shape a plain Polygon has.
    const coords = t.boundary?.coordinates || [];
    const rings = t.boundary?.type === 'MultiPolygon' ? coords.flat() : coords;
    for (const ring of rings) {
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
  // Default to a round that still NEEDS cutting (no books yet), else the active one,
  // else the most recent — so you usually land where there's work to do.
  useEffect(() => {
    if (passId || !passes.length) return;
    const live = passes.filter((p) => p.status !== 'archived');
    const recent = (arr) => [...arr].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const needsCut = recent(live.filter((p) => (p.turfCount || 0) === 0));
    const active = recent(live.filter((p) => p.status === 'active'));
    const pick = needsCut[0] || active[0] || recent(live)[0] || passes[0];
    onChange(String(pick._id));
  }, [passId, passes, activeIds]);
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Pass</span>
      <select
        value={passId || ''}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border-strong bg-card px-2 py-1 text-sm text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {!passes.length && <option value="">No passes</option>}
        {passes.map((p) => (
          <option key={p._id} value={p._id}>
            {effortName.get(String(p.effortId)) || 'Walk list'} · Pass {p.roundNumber} · {p.name} ({p.status})
          </option>
        ))}
      </select>
    </div>
  );
}

// Typed-confirm for the bulk restricted mark/unmark — a whole gated community in
// one action. Mirrors DiscardModal's contract; the skip rules are stated so the
// admin knows completed and already-restricted doors keep their result.
// Sum a status key across the selected books' per-round statusCounts (from /turfs/progress).
function sumStatus(books, progressByTurf, keys) {
  let n = 0;
  for (const b of books) {
    const sc = progressByTurf?.get(String(b._id))?.statusCounts;
    if (!sc) continue;
    for (const k of keys) n += sc[k] || 0;
  }
  return n;
}

function RestrictModal({ mode, books, progressByTurf, pending, error, onCancel, onConfirm }) {
  const [confirmText, setConfirmText] = useState('');
  const marking = mode === 'mark';
  const totalDoors = books.reduce((s, b) => s + (b.eligibleDoorCount ?? b.doorCount ?? 0), 0);
  const bulkMarks = books.reduce((s, b) => s + (b.bulkRestrictedCount || 0), 0);

  // Live per-scope counts from the progress the page already loaded. "Reached" = doors the crew
  // touched but didn't complete (not-home / refused / wrong-address). When there are any, offer a
  // choice and default to leaving them alone.
  const unknockedCount = sumStatus(books, progressByTurf, ['unknocked']);
  const incompleteCount = sumStatus(books, progressByTurf, ['unknocked', 'not_home', 'wrong_address', 'refused']);
  const reachedCount = Math.max(0, incompleteCount - unknockedCount);
  const hasProgress = progressByTurf && progressByTurf.size > 0;
  const showScope = marking && hasProgress && reachedCount > 0;
  const [scope, setScope] = useState(reachedCount > 0 ? 'unknocked' : 'incomplete');

  const chosenCount = scope === 'unknocked' ? unknockedCount : incompleteCount;
  const typedOk = !marking || confirmText.trim().toLowerCase() === 'restrict';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-fg">
          {marking
            ? `Mark ${books.length === 1 ? `“${books[0].name}”` : `${books.length} books`} restricted?`
            : 'Remove bulk restricted marks?'}
        </h3>
        {marking ? (
          showScope ? (
            <>
              <p className="mt-2 text-sm text-fg-muted">
                Your crew already reached {reachedCount.toLocaleString()} door{reachedCount === 1 ? '' : 's'} in{' '}
                {books.length === 1 ? 'this book' : 'these books'}. Choose which doors to mark{' '}
                <strong>Restricted Access</strong> — canvassers see them slate, they stay out of every rate and knock
                count, and the next cut can exclude them.
              </p>
              <div className="mt-3 space-y-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-strong p-2.5 hover:bg-sunken">
                  <input
                    type="radio"
                    name="restrict-scope"
                    checked={scope === 'unknocked'}
                    onChange={() => setScope('unknocked')}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-fg">Only unknocked doors ({unknockedCount.toLocaleString()})</span>
                    <span className="mt-0.5 block text-xs text-fg-muted">
                      Leaves the {reachedCount.toLocaleString()} door{reachedCount === 1 ? '' : 's'} your crew reached
                      (not-home, refused) exactly as they are.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border-strong p-2.5 hover:bg-sunken">
                  <input
                    type="radio"
                    name="restrict-scope"
                    checked={scope === 'incomplete'}
                    onChange={() => setScope('incomplete')}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium text-fg">Every door not yet done ({incompleteCount.toLocaleString()})</span>
                    <span className="mt-0.5 block text-xs text-fg-muted">
                      Also marks the {reachedCount.toLocaleString()} reached-but-unfinished door
                      {reachedCount === 1 ? '' : 's'} — for a whole inaccessible book.
                    </span>
                  </span>
                </label>
              </div>
              <p className="mt-2 text-xs text-fg-subtle">
                Completed doors keep their result; already-restricted doors are skipped. Reversible via{' '}
                <strong>Unmark restricted</strong>.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              Every eligible door in {books.length === 1 ? 'this book' : 'these books'} (~
              {totalDoors.toLocaleString()}) gets a <strong>Restricted Access</strong> mark — canvassers see them
              slate, they stay out of every rate and knock count, and the next cut can exclude them. Doors already{' '}
              <strong>completed this round</strong> keep their result; doors already restricted are skipped. Reversible
              via <strong>Unmark restricted</strong>, and a canvasser can re-disposition any door in the field.
            </p>
          )
        ) : (
          <p className="mt-2 text-sm text-fg-muted">
            Removes the {bulkMarks.toLocaleString()} bulk mark{bulkMarks === 1 ? '' : 's'} this action created in the
            selected book{books.length === 1 ? '' : 's'}. Restricted marks canvassers recorded at the door are kept.
          </p>
        )}
        {marking && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-fg-muted">
              Type <strong>restrict</strong> to confirm
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="restrict"
              autoFocus
              className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-danger focus:outline-none"
            />
          </label>
        )}
        {error && <p className="mt-2 text-sm text-danger">{error.message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm font-semibold text-fg-muted hover:bg-sunken">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(scope)}
            disabled={pending || !typedOk}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {pending
              ? 'Working…'
              : marking
              ? showScope
                ? `Restrict ${chosenCount.toLocaleString()} door${chosenCount === 1 ? '' : 's'}`
                : 'Mark restricted'
              : 'Remove marks'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscardModal({ isActive, bookCount, passLabel, knockCount, clearKnocks, setClearKnocks, pending, error, onCancel, onConfirm }) {
  const worked = knockCount > 0;
  const [confirmText, setConfirmText] = useState('');
  const typedOk = !worked || confirmText.trim().toLowerCase() === 'discard';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-overlay/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-fg">
          Discard {bookCount} book{bookCount === 1 ? '' : 's'}{passLabel ? ` — ${passLabel}` : ''}?
        </h3>
        {worked ? (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            ⚠️ <strong>{knockCount.toLocaleString()} knock{knockCount === 1 ? '' : 's'} already recorded</strong> in this
            pass{isActive ? ' — and it is LIVE' : ''}. Discarding removes its books and{' '}
            <strong>all canvasser assignments</strong>{isActive ? ' and reverts the pass to draft' : ''}. Knock history
            is kept (unless you check the box below), and a snapshot is saved — restorable from{' '}
            <strong>Undo / snapshots</strong>.
          </div>
        ) : isActive ? (
          <div className="mt-2 rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
            ⚠️ This pass is <strong>LIVE</strong>. Discarding wipes its books and{' '}
            <strong>all canvasser assignments</strong>, and reverts the pass to draft. Knock history is kept
            unless you check the box below.
          </div>
        ) : (
          <p className="mt-2 text-sm text-fg-muted">
            This removes the pass's books and canvasser assignments so you can re-cut. Knock history is kept, and a
            <strong> snapshot is saved automatically</strong> — restore it anytime from <strong>Undo / snapshots</strong> below
            if you change your mind.
          </p>
        )}
        <label className="mt-3 flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" checked={clearKnocks} onChange={(e) => setClearKnocks(e.target.checked)} className="mt-0.5" />
          <span>
            Also clear all knock history for this pass — resets door progress.{' '}
            <span className="text-fg-subtle">(Snapshotted; undoable.)</span>
          </span>
        </label>
        {worked && (
          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-xs font-medium text-fg-muted">
              Type <strong>discard</strong> to confirm
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="discard"
              autoFocus
              className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-danger focus:outline-none"
            />
          </label>
        )}
        {error && <div className="mt-2 text-xs text-danger">{error.message}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} disabled={pending} className="rounded px-3 py-1.5 text-sm text-fg-muted hover:bg-sunken">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending || !typedOk}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {pending ? 'Discarding…' : clearKnocks ? 'Discard + clear knocks' : 'Discard books'}
          </button>
        </div>
      </div>
    </div>
  );
}

// What happened at this door THIS round, plus the answers recorded here. Both come from the
// endpoints the Map page's HouseholdDetailPanel already uses — same roles (admin + a lead who
// manages the campaign), same per-campaign gate, and the same router.param audit hook, so this
// widens no access and stays record-level auditable. Scoped to `passId` exactly like the panel.
function RoundActivity({ householdId, passId, status, tz }) {
  const activityQ = useQuery({
    queryKey: ['household-activity', householdId],
    queryFn: () => api(`/admin/households/${householdId}/activity`),
    enabled: !!householdId,
  });
  const surveysQ = useQuery({
    queryKey: ['household-surveys', householdId, passId || ''],
    queryFn: () => api(`/admin/households/${householdId}/surveys${passId ? `?passId=${passId}` : ''}`),
    enabled: !!householdId && status === 'surveyed',
  });
  const round = (activityQ.data?.rounds || []).find((r) => String(r.passId || '') === String(passId || ''));
  const latest = round?.entries?.[0] || null; // the server already sorts newest-first
  const surveys = surveysQ.data?.surveys || [];
  const when = (at) =>
    formatInTz(at, tz, { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true);

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">This round</div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLORS[status] || STATUS_COLORS.unknocked }} />
        <span className="font-medium text-fg">{STATUS_LABELS[status] || 'Unknocked'}</span>
      </div>
      {activityQ.isLoading ? (
        <div className="mt-0.5 text-[11px] text-fg-subtle">Loading…</div>
      ) : latest ? (
        <div className="mt-0.5 text-[11px] text-fg-muted">
          {actionLabel(latest.actionType)}
          {latest.canvasser ? ` · ${latest.canvasser}` : ''}
          {latest.at ? ` · ${when(latest.at)}` : ''}
        </div>
      ) : (
        <div className="mt-0.5 text-[11px] text-fg-subtle">Not worked this round yet.</div>
      )}

      {surveys.map((s) => (
        <div key={s.id} className="mt-1.5 rounded border border-border px-1.5 py-1">
          <div className="text-[11px] font-medium text-fg">
            {s.voter?.fullName || 'Survey'}
            {s.canvasser ? <span className="font-normal text-fg-muted"> · {s.canvasser.firstName} {s.canvasser.lastName}</span> : null}
          </div>
          <ul className="mt-0.5 space-y-0.5">
            {(s.answers || []).map((a, i) => (
              <li key={i} className="text-[11px] leading-snug">
                <span className="text-fg-muted">{a.questionText || a.questionKey}: </span>
                <span className="text-fg">{Array.isArray(a.answer) ? a.answer.join(', ') : String(a.answer ?? '—')}</span>
              </li>
            ))}
            {!(s.answers || []).length && <li className="text-[11px] text-fg-subtle">No answers recorded.</li>}
          </ul>
          {s.note && <div className="mt-0.5 text-[11px] italic text-fg-muted">“{s.note}”</div>}
        </div>
      ))}
    </div>
  );
}

function HousePopup({ data, loading, book, bookColor, books = [], moving, onMove, onClose, householdId, passId, status, tz, showRound }) {
  const hh = data?.household;
  const voters = data?.voters || [];
  const currentId = book ? String(book._id) : null;
  return (
    <div className="absolute right-3 top-3 z-10 w-64 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {loading || !hh ? (
            <div className="text-sm text-fg-muted">Loading…</div>
          ) : (
            <>
              <div className="truncate text-sm font-semibold text-fg">{hh.addressLine1}</div>
              {hh.addressLine2 && <div className="truncate text-xs text-fg-muted">{hh.addressLine2}</div>}
              <div className="text-xs text-fg-muted">{hh.city}, {hh.state} {hh.zipCode}</div>
            </>
          )}
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-sunken hover:text-fg-muted" aria-label="Close">✕</button>
      </div>
      {hh && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            {bookColor && <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: bookColor }} />}
            <span className="font-medium">{book ? book.name : 'Unassigned'}</span>
          </div>
          <select
            value=""
            onChange={(e) => { if (e.target.value) onMove(e.target.value); }}
            disabled={moving}
            className="mt-1.5 w-full rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
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
      {hh && showRound && <RoundActivity householdId={householdId} passId={passId} status={status} tz={tz} />}
      {hh && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
            {voters.length} member{voters.length === 1 ? '' : 's'}
          </div>
          <ul className="max-h-40 space-y-0.5 overflow-auto text-sm">
            {voters.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-fg">{v.fullName}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {v.party && <span className="text-[10px] text-fg-subtle">{v.party}</span>}
                  {v.surveyStatus === 'surveyed' && <span className="text-[10px] font-semibold text-success" title="Surveyed">✓</span>}
                </span>
              </li>
            ))}
            {!voters.length && <li className="text-xs text-fg-subtle">No members on file.</li>}
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
    <div className="absolute right-3 top-3 z-10 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <span aria-hidden>🏢</span>
            <span className="truncate">{addressLine1 || 'Apartment building'}</span>
          </div>
          <div className="text-xs text-fg-muted">{city}, {state} {zipCode}</div>
          <div className="mt-0.5 text-[11px] font-semibold text-brand-accent">{total} units at this location</div>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-0.5 text-fg-subtle hover:bg-sunken hover:text-fg-muted" aria-label="Close">✕</button>
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <select
          value=""
          onChange={(e) => { if (e.target.value) onMoveAll(e.target.value); }}
          disabled={moving}
          className="w-full rounded border border-border-strong bg-card px-2 py-1 text-xs font-medium text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
        >
          <option value="">{moving ? 'Moving…' : 'Move all units to book…'}</option>
          {books.map((t) => (
            <option key={t._id} value={t._id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Units</div>
        <ul className="max-h-56 space-y-1 overflow-auto">
          {units.map((u) => {
            const book = u.turfId ? books.find((t) => String(t._id) === String(u.turfId)) : null;
            const color = u.turfId ? colorByTurf.get(String(u.turfId)) : null;
            return (
              <li key={u.id} className="rounded border border-border p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{u.addressLine2 || u.addressLine1 || 'Unit'}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />}
                    <span className="text-[10px] text-fg-muted">{book ? book.name : 'Unassigned'}</span>
                  </span>
                </div>
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) onMove(u.id, e.target.value); }}
                  disabled={moving}
                  className="mt-1 w-full rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-fg-muted focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60"
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
  const { campaignId } = useParams();
  const { selected } = useCampaignSelection(campaignId);
  // Turf snapshots belong to the selected campaign → show times in its tz (fallback org).
  const tz = selected?.timeZone || orgTz;
  // Basemap style picker (Street/Hybrid/Satellite/Outdoors/Dark), independent of the
  // app theme. styleEpoch bumps after a swap so paint() + building markers re-hydrate.
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);
  // A deep-link from Efforts/Passes (?passId=) pre-selects the pass; the PassPicker's
  // auto-select only kicks in when this is empty, so a seeded value wins.
  const [searchParams] = useSearchParams();
  const [passId, setPassId] = useState(() => searchParams.get('passId') || '');

  const [mode, setMode] = useState('geometric');
  const [attribute, setAttribute] = useState('precinct');
  const [capN, setCapN] = useState('');
  const [maxDoors, setMaxDoors] = useState(65);
  // Admin-reviewed second-pass removal: default ON, so a re-cut skips inaccessible homes
  // (only surfaced when the effort actually has restricted-status doors).
  const [excludeRestricted, setExcludeRestricted] = useState(true);
  const [flex, setFlex] = useState('compact');
  const [jobId, setJobId] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [aptThreshold, setAptThreshold] = useState(4);
  // Targeted follow-up round: cut over only doors matching a knock-status / survey
  // filter (e.g. unknocked, or GOTV supporters). Empty = the full effort universe.
  const [targetFilter, setTargetFilter] = useState({ priorPassStatuses: [], answerFilters: [], combine: 'or' });
  const [showTarget, setShowTarget] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(new Set());
  const [drawnAreas, setDrawnAreas] = useState([]); // [{ id, geometry }] from MapboxDraw
  const [manualSplit, setManualSplit] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [showRestrict, setShowRestrict] = useState(null); // 'mark' | 'unmark' | null
  const [restrictResult, setRestrictResult] = useState(null);
  const [clearKnocks, setClearKnocks] = useState(false);
  const [lastSnapshotId, setLastSnapshotId] = useState(null);
  const [popupHouseholdId, setPopupHouseholdId] = useState(null);
  const [popupBuildingKey, setPopupBuildingKey] = useState(null);
  // Map layer visibility toggles + book status filter + crew-load bar open state.
  // `notInBook` (all loose doors) and `restricted` (the restricted subset) both start
  // HIDDEN so the cut map opens showing only this cut's booked doors — a targeted second
  // cut otherwise leaves every already-worked/excluded door on the map as a gray dot,
  // padding the density. Their Layers-box rows only appear when such doors exist.
  const [layerVis, setLayerVis] = useState({ houses: true, buildings: true, fills: true, labels: true, notInBook: false, restricted: false });
  const [statusFilter, setStatusFilter] = useState(new Set()); // empty = show all books
  const [crewOpen, setCrewOpen] = useState(false);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const editModeRef = useRef(false);
  const moveDoorRef = useRef(() => {});
  const toggleSelectRef = useRef(() => {});
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
  // withStatus=1 rides along so each door carries its status FOR THIS ROUND — what colors
  // the dots. Counts never come from here; see progressQ (the single count oracle).
  const doorsQ = useQuery({
    queryKey: ['turf-doors', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/doors?passId=${passId}&withStatus=1`),
    enabled: !!campaignId && !!passId,
  });
  const turfs = turfsQ.data?.turfs || [];
  const draftCount = turfs.filter((t) => t.status === 'draft').length;
  const publishedCount = turfs.filter((t) => t.status === 'published').length;
  const colorByTurf = useMemo(() => new Map(turfs.map((t, i) => [String(t._id), colorFor(i)])), [turfsQ.data]);
  const selectedTurfs = turfs.filter((t) => selectedBooks.has(String(t._id)));
  // Group stacked apartment units (same geocode) into buildings; lone doors stay
  // singles. Used for the dot layer, the building markers, and the popup.
  //
  // Two Layers toggles hide LOOSE doors (turfId=null) — the doors a cut left out of every
  // book, which otherwise pad the map's density: "Not in a book" hides all of them,
  // "Restricted" hides just the restricted ones. A loose door shows only when EVERY toggle
  // covering it is on (a restricted loose door needs both). Doors that ARE in a book always
  // stay — a canvasser can mark one restricted mid-pass and it keeps its book color — so an
  // active-pass audit never loses worked doors.
  const grouped = useMemo(() => {
    const all = doorsQ.data?.doors || [];
    const visible = all.filter((d) => {
      if (d.turfId) return true;
      if (!layerVis.notInBook) return false;
      if (d.status === 'restricted' && !layerVis.restricted) return false;
      return true;
    });
    return groupDoors(visible);
  }, [doorsQ.data, layerVis.notInBook, layerVis.restricted]);
  // Loose doors (not in any book): already-worked leftovers a targeted cut skipped,
  // restricted homes, and voters added since the cut. Drives the "Not in a book" toggle count.
  const looseDoorCount = (doorsQ.data?.doors || []).filter((d) => !d.turfId).length;
  // Doors not yet in any book — e.g. voters imported after this pass was cut. Restricted
  // homes are loose too (they're kept out of the cut), but when we're excluding them they
  // aren't actionable, so don't let them inflate the "not in any book" nag.
  const unassignedCount = (doorsQ.data?.doors || []).filter(
    (d) => !d.turfId && !(excludeRestricted && d.status === 'restricted')
  ).length;
  // Inaccessible homes a canvasser flagged (Household.status === 'restricted'). The admin
  // can drop them from this cut so nobody is routed back to an unreachable door.
  const restrictedDoorCount = (doorsQ.data?.doors || []).filter((d) => d.status === 'restricted').length;
  // Dead-end guard: the effort owns no mappable doors. /doors returns the effort's
  // knockable doors (booked or not), so 0 here = nothing to cut. Don't trip while loading.
  const hasNoDoors = !!passId && !!doorsQ.data && (doorsQ.data.doors || []).length === 0;
  // Already-voted owned doors the cut skips (so a smaller book total makes sense).
  const votedDoorCount = turfsQ.data?.votedDoorCount || 0;
  const excludedApartmentCount = turfsQ.data?.excludedApartmentCount || 0;
  const knockCount = turfsQ.data?.knockCount || 0;
  // "Remove apartments": preview how many doors sit in buildings of N+ units (same
  // rounded-geocode key the server uses), so we can persistently exclude them.
  const aptPreview = useMemo(() => {
    const byKey = new Map();
    for (const d of doorsQ.data?.doors || []) {
      const key = `${Math.round(d.lat * 1e5)}|${Math.round(d.lng * 1e5)}`;
      byKey.set(key, (byKey.get(key) || 0) + 1);
    }
    let doors = 0;
    let buildings = 0;
    for (const c of byKey.values()) if (c >= aptThreshold) { doors += c; buildings += 1; }
    return { doors, buildings };
  }, [doorsQ.data, aptThreshold]);
  const invalidateCut = () => {
    qc.invalidateQueries({ queryKey: ['turf-doors', campaignId, passId] });
    qc.invalidateQueries({ queryKey: ['turfs', campaignId, passId] });
  };
  const excludeApts = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/exclude-apartments`, { method: 'POST', body: { passId, threshold: aptThreshold } }),
    onSuccess: invalidateCut,
  });
  const includeApts = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/include-apartments`, { method: 'POST', body: { passId } }),
    onSuccess: invalidateCut,
  });

  // Manual mode: live houses + voters inside each drawn area.
  const manualAreasKey = JSON.stringify(drawnAreas.map((a) => a.geometry?.coordinates));
  const manualPreviewQ = useQuery({
    queryKey: ['manual-preview', campaignId, passId, manualAreasKey],
    queryFn: () =>
      api(`/admin/campaigns/${campaignId}/turfs/manual-preview`, {
        method: 'POST',
        body: { passId, polygons: drawnAreas.map((a) => a.geometry) },
      }),
    enabled: mode === 'manual' && !!campaignId && !!passId && drawnAreas.length > 0,
  });
  const manualAreaStats = manualPreviewQ.data?.areas || [];
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
  const effortsQ = useQuery({
    queryKey: ['admin', 'efforts', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/efforts`),
    enabled: !!campaignId,
  });
  // "{Effort} · Round N" — named in the Discard dialog so you can't wipe the wrong effort blind.
  const selectedEffort = (effortsQ.data?.efforts || []).find((e) => String(e._id) === String(selectedPass?.effortId)) || null;
  const passLabel = selectedPass ? `${selectedEffort?.name || 'Walk list'} · Round ${selectedPass.roundNumber}` : '';

  // Targeted-pass filter: the effort's survey questions (for answer chips) + a live count.
  const campaign = selected || null;
  const targetSurveyTemplateId = selectedEffort?.surveyTemplateId || campaign?.surveyTemplateId || null;
  const targetSurveyQ = useQuery({
    queryKey: ['reports', 'survey-results', campaignId, targetSurveyTemplateId],
    queryFn: () =>
      api(`/admin/reports/survey-results?campaignId=${campaignId}${targetSurveyTemplateId ? `&surveyTemplateId=${targetSurveyTemplateId}` : ''}`),
    enabled: !!campaignId && campaign?.type !== 'lit_drop' && showTarget,
  });
  const targetQuestions = (targetSurveyQ.data?.questions || []).filter(
    (q) => q.type === 'single_choice' || q.type === 'multiple_choice'
  );
  const targetActive = (targetFilter.priorPassStatuses?.length || 0) > 0 || (targetFilter.answerFilters?.length || 0) > 0;
  const targetPreviewQ = useQuery({
    queryKey: ['turf-target-preview', campaignId, passId, JSON.stringify(targetFilter)],
    queryFn: () =>
      api(`/admin/campaigns/${campaignId}/turfs/target-preview`, { method: 'POST', body: { passId, filter: targetFilter } }),
    enabled: !!campaignId && !!passId && targetActive,
  });
  const targetedSet = useMemo(
    () => (targetActive && targetPreviewQ.data?.householdIds ? new Set(targetPreviewQ.data.householdIds.map(String)) : null),
    [targetActive, targetPreviewQ.data]
  );
  const toggleTargetStatus = (s) =>
    setTargetFilter((t) => ({
      ...t,
      priorPassStatuses: t.priorPassStatuses.includes(s)
        ? t.priorPassStatuses.filter((x) => x !== s)
        : [...t.priorPassStatuses, s],
    }));

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

  // Per-book canvassing progress — THE single count oracle for this page. Feeds the status
  // filter chips (Completed/In-progress/Not-started), the map labels, the fill tint, the
  // round coverage bar, and the status-mode gate below, so none of them can drift apart.
  const progressQ = useQuery({
    queryKey: ['turf-progress', campaignId, passId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/progress?passId=${passId}`),
    enabled: !!campaignId && !!passId && turfs.length > 0,
  });
  const progressByTurf = useMemo(() => {
    const m = new Map();
    for (const p of progressQ.data?.progress || []) m.set(String(p.turfId), p);
    return m;
  }, [progressQ.data]);
  // Round totals: doors worked so far, and the same broken out by status for the coverage bar.
  const roundProgress = useMemo(() => {
    const rows = progressQ.data?.progress || [];
    const counts = {};
    let knocked = 0;
    let total = 0;
    for (const p of rows) {
      knocked += p.knocked || 0;
      total += p.total || 0;
      for (const [k, n] of Object.entries(p.statusCounts || {})) counts[k] = (counts[k] || 0) + n;
    }
    return { knocked, total, counts };
  }, [progressQ.data]);
  // Status coloring engages once the round has actually been worked — on a fresh cut it would
  // paint every dot the same gray and actively hurt the cutting task, so dots stay book-colored
  // until then. Gated on the oracle's `knocked`, NOT turfsQ's knockCount: the server computes
  // that one as countDocuments({ passId }) with no actionType filter, so it counts note_added —
  // which getPassStatusMap excludes. A notes-only pass would otherwise flip the page to an
  // all-gray map. `statusOverride` is the Layers-box checkbox; null = follow the round.
  const [statusOverride, setStatusOverride] = useState(null);
  const statusMode = statusOverride ?? roundProgress.knocked > 0;

  // Group-sizes preview for attribute mode (knockable doors per precinct/zip/…).
  const attributePreviewQ = useQuery({
    queryKey: ['turf-attribute-preview', campaignId, passId, attribute],
    queryFn: () => api(`/admin/campaigns/${campaignId}/turfs/attribute-preview?passId=${passId}&attribute=${attribute}`),
    enabled: !!campaignId && !!passId && mode === 'attribute',
  });

  // At-a-glance summary (all client-derived from data already loaded).
  const totalHouses = turfs.reduce((s, t) => s + (t.eligibleDoorCount ?? t.doorCount ?? 0), 0);
  const assignedUserSet = new Set();
  for (const arr of assignedByTurf.values()) for (const u of arr) assignedUserSet.add(u.id);
  const booksUnassigned = turfs.filter((t) => !(assignedByTurf.get(String(t._id)) || []).length).length;

  // Per-canvasser load across the round (books + knockable doors) — for the panel.
  const crewLoad = (() => {
    const m = new Map();
    for (const t of turfs) {
      const doors = t.eligibleDoorCount ?? t.doorCount ?? 0;
      for (const u of assignedByTurf.get(String(t._id)) || []) {
        const e = m.get(u.id) || { user: u, books: 0, doors: 0 };
        e.books += 1;
        e.doors += doors;
        m.set(u.id, e);
      }
    }
    return [...m.values()].sort((a, b) => b.doors - a.doors);
  })();

  // Book search filter (by book name or assigned-canvasser name).
  const bookQuery = bookSearchQuery.trim().toLowerCase();
  const matchBook = (t) =>
    !bookQuery ||
    String(t.name).toLowerCase().includes(bookQuery) ||
    (assignedByTurf.get(String(t._id)) || []).some((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(bookQuery));
  const selectedDoors = selectedTurfs.reduce((s, t) => s + (t.eligibleDoorCount ?? t.doorCount ?? 0), 0);

  // Book status (coverage + progress) → the filter chips + the map/list filter.
  const bookStatuses = (t) => {
    const s = new Set();
    s.add((assignedByTurf.get(String(t._id)) || []).length ? 'assigned' : 'unassigned');
    const p = progressByTurf.get(String(t._id));
    if (p && p.total > 0) s.add(p.knocked === 0 ? 'not_started' : p.knocked >= p.total ? 'completed' : 'in_progress');
    return s;
  };
  // Additive chips: a book shows if it matches ANY selected status (union). Selecting
  // "Assigned" + "In progress" shows every assigned book AND every in-progress book.
  const matchesStatus = (t) => {
    if (!statusFilter.size) return true;
    const s = bookStatuses(t);
    for (const k of statusFilter) if (s.has(k)) return true;
    return false;
  };
  const statusCounts = useMemo(() => {
    const c = { assigned: 0, unassigned: 0, completed: 0, in_progress: 0, not_started: 0 };
    for (const t of turfs) for (const k of bookStatuses(t)) c[k] += 1;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turfsQ.data, assignmentsQ.data, progressQ.data]);
  const visibleBookIds = useMemo(() => {
    if (!statusFilter.size) return null; // null = show all books
    return new Set(turfs.filter(matchesStatus).map((t) => String(t._id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, turfsQ.data, assignmentsQ.data, progressQ.data]);
  // A book shows in the list when it passes BOTH the name/canvasser search and the status filter.
  const bookShown = (t) => matchBook(t) && (!visibleBookIds || visibleBookIds.has(String(t._id)));
  const shownBooksCount = turfs.filter(bookShown).length;
  const listFiltered = !!bookQuery || statusFilter.size > 0;

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
      if (mode === 'manual') params = { polygons: drawnAreas.map((a) => a.geometry), subCutN: manualSplit ? Number(maxDoors) || 65 : null };
      else if (mode === 'attribute') params = { attribute, capN: capN ? Number(capN) : null };
      else params = { maxDoors: Number(maxDoors) || 65, tolerance: (FLEX_OPTIONS.find((o) => o.key === flex) || {}).tolerance };
      if (targetActive) params.targetFilter = targetFilter;
      if (excludeRestricted && restrictedDoorCount > 0) params.excludeRestricted = true;
      return api(`/admin/campaigns/${campaignId}/turfs/generate`, { method: 'POST', body: { passId, mode, params } });
    },
    onSuccess: (res) => {
      setJobId(res.jobId);
      if (drawRef.current) drawRef.current.deleteAll();
      setDrawnAreas([]);
    },
  });
  const accept = useMutation({
    mutationFn: () => api(`/admin/campaigns/${campaignId}/turfs/accept`, { method: 'POST', body: { passId } }),
    onSuccess: () => {
      invalidateTurfs();
      qc.invalidateQueries({ queryKey: ['admin', 'setup-status', campaignId] });
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
    },
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
  // Bulk restricted — whole gated communities in one action (docs/PASSES_AND_TURF.md).
  const restrictBulk = useMutation({
    mutationFn: ({ turfIds, scope }) =>
      api(`/admin/campaigns/${campaignId}/turfs/restrict-bulk`, { method: 'POST', body: { turfIds, scope } }),
    onSuccess: (res) => {
      setShowRestrict(null);
      const skips = res.skipped || {};
      const parts = [];
      if (skips.completed) parts.push(`${skips.completed} completed`);
      if (skips.alreadyRestricted) parts.push(`${skips.alreadyRestricted} already restricted`);
      // Doors the crew reached, left untouched under the "only unknocked" scope.
      if (skips.reached) parts.push(`${skips.reached} reached left as-is`);
      const skipNote = parts.length ? ` · ${parts.join(', ')}` : '';
      setRestrictResult(`Marked ${res.marked} door${res.marked === 1 ? '' : 's'} restricted${skipNote}.`);
      invalidateCut();
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
    },
  });
  const unrestrictBulk = useMutation({
    mutationFn: (turfIds) =>
      api(`/admin/campaigns/${campaignId}/turfs/unrestrict-bulk`, { method: 'POST', body: { turfIds } }),
    onSuccess: (res) => {
      setShowRestrict(null);
      setRestrictResult(`Removed ${res.unmarked} bulk restricted mark${res.unmarked === 1 ? '' : 's'}.`);
      invalidateCut();
      qc.invalidateQueries({ queryKey: ['campaign-rollup'] });
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
  openPopupRef.current = (id) => { setPopupBuildingKey(null); setPopupHouseholdId(id); };
  openBuildingPopupRef.current = (key) => { setPopupHouseholdId(null); setPopupBuildingKey(key); };

  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: appliedStyleRef.current,
      center: [-95.7129, 37.0902],
      zoom: 3.5,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    const draw = new MapboxDraw({ displayControlsDefault: false, controls: {} });
    map.addControl(draw);
    drawRef.current = draw;

    const syncAreas = () => {
      const fc = drawRef.current?.getAll();
      setDrawnAreas((fc?.features || []).map((f) => ({ id: f.id, geometry: f.geometry })));
    };
    map.on('draw.create', syncAreas);
    map.on('draw.update', syncAreas);
    map.on('draw.delete', syncAreas);

    // Layer event handlers — bound ONCE; they target layer IDs that registerBookLayers
    // recreates on each style swap, so they keep working across basemap changes.
    // Unified click precedence: the BOOK wins unless the click is within DOT_TOL px of a
    // house dot (then the house popup opens — keeping the move-a-door flow). A hidden or
    // status-filtered `doors` layer drops out of queryRenderedFeatures, so it can't steal
    // a book click. Building HTML markers handle their own click (stopPropagation).
    const DOT_TOL = 6;
    map.on('click', (e) => {
      const near = map.queryRenderedFeatures(
        [[e.point.x - DOT_TOL, e.point.y - DOT_TOL], [e.point.x + DOT_TOL, e.point.y + DOT_TOL]],
        { layers: map.getLayer('doors') ? ['doors'] : [] }
      );
      let bestId = null;
      let bestDist = Infinity;
      for (const f of near) {
        const p = map.project(f.geometry.coordinates);
        const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
        if (d < bestDist) { bestDist = d; bestId = f.properties?.id; }
      }
      if (bestId != null && bestDist <= DOT_TOL) { openPopupRef.current(bestId); return; }
      const bf = map.queryRenderedFeatures(e.point, { layers: map.getLayer('book-fill') ? ['book-fill'] : [] });
      if (bf.length) { toggleSelectRef.current(bf[0].properties?.id); return; }
      // Clicking empty map does NOT clear the selection — only the ✕ in the assignment
      // panel deselects. Accidental blank-map clicks used to wipe a built-up selection.
    });
    map.on('mouseenter', 'book-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'book-fill', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'doors', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'doors', () => { map.getCanvas().style.cursor = ''; });

    map.on('load', () => {
      registerBookLayers(map, darkBase);
      mapRef.current = map;
      setMapReady(true); // re-fires the paint effect now that sources exist
    });

    return () => { map.remove(); mapRef.current = null; drawRef.current = null; setMapReady(false); };
  }, [tokenQ.data?.isReady]);

  // Keep the Mapbox canvas filling its container when the box changes (e.g. the
  // sidebar collapses) — Mapbox needs an explicit resize().
  useEffect(() => {
    const el = containerRef.current;
    if (!mapReady || !el) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapReady]);

  // Swap the basemap when the picker changes; re-register layers on style.load and
  // bump styleEpoch so paint() + building markers re-hydrate. fittedSigRef is kept
  // so the view isn't reset on a swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleURL) return;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      registerBookLayers(map, darkBase);
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    // Remove a still-pending handler if the style changes again before this
    // one loads — otherwise both fire on the final style and re-register.
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  function paint() {
    const map = mapRef.current;
    if (!map || !map.getSource('books')) return;
    map.getSource('books').setData(booksToFillGeoJSON(turfs, colorByTurf, selectedBooks, progressByTurf));
    map.getSource('book-labels').setData(booksToLabelGeoJSON(turfs, selectedBooks, progressByTurf, statusMode));
    map.getSource('doors').setData(doorsToGeoJSON(grouped.singles, colorByTurf, targetedSet, statusMode, darkBase));

    // Status filter (Assigned / Unassigned / Completed / In-progress / Not-started): hide
    // non-matching books + their dots via cheap Mapbox filter expressions — full GeoJSON
    // stays in the sources, so a chip toggle never re-serializes. null = show everything
    // (selection just restyles, never hides). Re-applies on styleEpoch via the paint effect.
    const ids = visibleBookIds ? [...visibleBookIds] : null;
    map.setFilter('book-fill', ids ? ['in', ['get', 'id'], ['literal', ids]] : null);
    map.setFilter('book-outline', ids ? ['in', ['get', 'id'], ['literal', ids]] : null);
    map.setFilter('book-labels', ids ? ['in', ['get', 'id'], ['literal', ids]] : null);
    // The ring shares the `doors` source, so it needs the SAME filter or a hidden book's
    // dots would vanish while their halos stayed behind.
    map.setFilter('doors', ids ? ['in', ['get', 'turfId'], ['literal', ids]] : null);
    map.setFilter('door-book-ring', ids ? ['in', ['get', 'turfId'], ['literal', ids]] : null);

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
  useEffect(() => { paint(); }, [turfsQ.data, doorsQ.data, selectedBooks, mapReady, styleEpoch, targetedSet, visibleBookIds, progressByTurf, statusMode, darkBase]);

  // Building markers (HTML overlays) for stacked apartment units — synced apart from paint()
  // so book-select toggles don't churn the DOM. Hidden when Houses/Buildings is toggled off
  // or the building's book is filtered out; the "N units" badge shows at zoom ≥ 16 or on hover.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    buildingMarkersRef.current.forEach((m) => m.remove());
    buildingMarkersRef.current = [];
    if (!(layerVis.houses && layerVis.buildings)) return;
    const badgesOn = () => map.getZoom() >= 16;
    for (const b of grouped.buildings) {
      if (visibleBookIds && !visibleBookIds.has(String(b.turfId))) continue;
      const color = colorByTurf.get(String(b.turfId)) || '#9ca3af';
      // The glyph stays BOOK-colored (a building is a book-membership object, and its units
      // can hold several different statuses). In status mode the badge answers "how many of
      // these have been hit" instead of just how many units are stacked here.
      const hit = statusMode
        ? (b.units || []).filter((u) => (u.passStatus || 'unknocked') !== 'unknocked').length
        : 0;
      const el = buildingMarkerEl(b.total, color, darkBase, statusMode ? `${hit}/${b.total} hit` : null);
      // Live target preview: dim a building unless one of its units is targeted.
      if (targetedSet && !(b.units || []).some((u) => targetedSet.has(String(u.id)))) {
        el.style.opacity = '0.2';
      }
      const badge = el.querySelector('.units-badge');
      if (badge) {
        badge.style.display = badgesOn() ? 'block' : 'none';
        el.addEventListener('mouseenter', () => { badge.style.display = 'block'; });
        el.addEventListener('mouseleave', () => { badge.style.display = badgesOn() ? 'block' : 'none'; });
      }
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openBuildingPopupRef.current(b.key); });
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([b.lng, b.lat]).addTo(map);
      buildingMarkersRef.current.push(marker);
    }
    const onZoom = () => {
      const on = badgesOn();
      for (const m of buildingMarkersRef.current) {
        const badge = m.getElement().querySelector('.units-badge');
        if (badge) badge.style.display = on ? 'block' : 'none';
      }
    };
    map.on('zoomend', onZoom);
    return () => map.off('zoomend', onZoom);
  }, [grouped, colorByTurf, mapReady, darkBase, styleEpoch, targetedSet, layerVis.houses, layerVis.buildings, visibleBookIds, statusMode]);

  // Layer visibility toggles (Houses/Buildings/Fills/Labels). Flip the Mapbox layers here;
  // the HTML building markers are handled in the marker effect above. Re-applies on styleEpoch
  // (a basemap swap recreates the layers via registerBookLayers).
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const set = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    set('book-fill', layerVis.fills);
    set('book-outline', layerVis.fills);
    set('book-labels', layerVis.labels);
    set('doors', layerVis.houses);
    // Only meaningful in status mode — off, the dot already IS the book color.
    set('door-book-ring', layerVis.houses && statusMode);
  }, [layerVis, mapReady, styleEpoch, statusMode]);

  // Clear selection + popups when switching pass/campaign (those books are gone).
  useEffect(() => { setSelectedBooks(new Set()); setPopupHouseholdId(null); setPopupBuildingKey(null); }, [passId, campaignId]);

  function startDraw() {
    // Don't clear — areas accumulate so you can draw several.
    if (drawRef.current) drawRef.current.changeMode('draw_polygon');
  }
  function clearAreas() {
    if (drawRef.current) drawRef.current.deleteAll();
    setDrawnAreas([]);
  }
  function deleteArea(id) {
    if (drawRef.current) drawRef.current.delete(id);
    setDrawnAreas((areas) => areas.filter((a) => a.id !== id));
  }

  const jobBusy = jobId && jobQ.data && jobQ.data.status !== 'completed' && jobQ.data.status !== 'failed';
  const progress = jobQ.data?.progress;
  const pct = typeof progress === 'object' ? progress?.pct : progress;
  const canGenerate =
    passId && !generate.isPending && !jobBusy && publishedCount === 0 && !hasNoDoors && (mode !== 'manual' || drawnAreas.length > 0);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }} className="px-6 pt-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Turf Cutting</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Cut this pass's doors into walkable books, then assign them to canvassers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {campaignId && <PassPicker campaignId={campaignId} passId={passId} onChange={setPassId} />}
          {isActivePass && (
            <span className="rounded bg-success-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
              ● Live
            </span>
          )}
        </div>
      </div>

      {!campaignId && (
        <NextStepBanner tone="info" className="mb-5">Pick a campaign above to start cutting turf.</NextStepBanner>
      )}
      {campaignId && !passId && (
        <NextStepBanner tone="info" className="mb-5">Pick a pass above to cut its doors into books.</NextStepBanner>
      )}
      {campaignId && passId && !hasNoDoors && turfs.length === 0 && doorsQ.data && (
        <NextStepBanner tone="info" className="mb-5">No books yet — pick a cutting mode on the left and click Generate.</NextStepBanner>
      )}

      {!!turfs.length && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <StatChip label="Books" value={turfs.length.toLocaleString()} hint={draftCount ? `${draftCount} draft` : undefined} />
            <StatChip
              label="Houses"
              value={totalHouses.toLocaleString()}
              hint={unassignedCount > 0 ? `${unassignedCount.toLocaleString()} not in a book` : undefined}
            />
            <StatChip
              label="Assigned"
              value={assignedUserSet.size.toLocaleString()}
              accent={!!assignedUserSet.size}
              hint={booksUnassigned > 0 ? `${booksUnassigned} book${booksUnassigned === 1 ? '' : 's'} unassigned` : 'every book covered'}
            />
            <StatChip
              label="Selected"
              value={selectedBooks.size.toLocaleString()}
              accent={!!selectedBooks.size}
              hint={selectedBooks.size ? `${selectedDoors.toLocaleString()} doors` : undefined}
            />
          </div>
          {passId && publishedCount > 0 && (
            <BookStatusChips value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
          )}
        </div>
      )}

      {/* Round coverage — the whole pass's door mix. Doubles as the legend for the map's
          status colors, which is why the page needs no separate legend widget. */}
      {statusMode && roundProgress.total > 0 && (
        <div className="mb-4">
          <CoverageBar canvass={roundProgress.counts} compact />
        </div>
      )}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '1.25rem' }} className="px-6 pb-6">
        <section style={{ flexShrink: 0, overflowY: 'auto' }} className="w-80 rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 text-base font-medium">Generate books</h2>

          <div className="mb-4">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-xs font-medium text-fg-muted">Cutting mode</span>
              <InfoHint label="When to use each mode">
                <b>Geometric</b> — group nearby houses into even, walkable books (the usual choice).<br />
                <b>Attribute</b> — one book per precinct / zip / district.<br />
                <b>Manual</b> — draw an area on the map by hand.
              </InfoHint>
            </div>
            <div className="flex rounded-md border border-border p-0.5 text-sm">
              {['geometric', 'attribute', 'manual'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={['flex-1 rounded px-2 py-1.5 font-medium capitalize transition-colors', mode === m ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-sunken'].join(' ')}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {mode === 'geometric' && (
            <div className="mb-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Max doors per book</span>
                <input type="number" min="1" value={maxDoors} onChange={(e) => setMaxDoors(e.target.value)} className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
                <span className="mt-1 block text-xs text-fg-muted">Default 65 — adjust freely.</span>
              </label>
              <div>
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-fg-muted">Book size flex</span>
                  <InfoHint label="What is book size flex?">
                    Books aim for your door count but flex to stay tight and walkable. <b>Compact</b> lets
                    sizes vary more so nobody drives far for a stray house; <b>Tight</b> keeps sizes even
                    but may leave a few houses in a slightly farther book. For a 65-door target, books land
                    roughly ~55–80 (Tight), ~48–90 (Balanced), ~40–100 (Compact).
                  </InfoHint>
                </div>
                <div className="flex rounded-md border border-border-strong p-0.5 text-xs">
                  {FLEX_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setFlex(o.key)}
                      className={['flex-1 rounded px-2 py-1 font-medium transition-colors', flex === o.key ? 'bg-brand-600 text-white' : 'text-fg-muted hover:bg-sunken'].join(' ')}
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
                <span className="mb-1 block text-xs font-medium text-fg-muted">Group by</span>
                <select value={attribute} onChange={(e) => setAttribute(e.target.value)} className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                  {ATTRIBUTES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </label>
              {attributePreviewQ.data?.groups && (
                <div className="mb-3 rounded-md border border-border-strong bg-sunken px-3 py-2 text-xs">
                  <div className="mb-1 font-medium text-fg-muted">
                    {attributePreviewQ.data.groups.length} group{attributePreviewQ.data.groups.length === 1 ? '' : 's'} → one book each{capN ? ' (big ones split by the cap)' : ''}
                  </div>
                  <ul className="max-h-32 space-y-0.5 overflow-auto">
                    {attributePreviewQ.data.groups.map((g) => {
                      const over = capN && Number(capN) > 0 && g.doorCount > Number(capN);
                      return (
                        <li key={g.name} className={`flex justify-between gap-2 ${over ? 'text-warning-fg' : 'text-fg-muted'}`}>
                          <span className="truncate">{g.name}</span>
                          <span className="shrink-0 font-semibold">{g.doorCount.toLocaleString()}{over ? ' ⚠' : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              <label className="mb-4 block text-sm">
                <span className="mb-1 block text-xs font-medium text-fg-muted">Cap at N doors/group (optional)</span>
                <input type="number" min="1" placeholder="no cap" value={capN} onChange={(e) => setCapN(e.target.value)} className="w-full rounded border border-border-strong bg-card px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30" />
              </label>
            </>
          )}
          {mode === 'manual' && (
            <div className="mb-4 text-sm">
              <div className="flex gap-2">
                <button onClick={startDraw} className="flex-1 rounded border border-brand-accent/40 bg-brand-tint px-3 py-2 text-sm font-medium text-brand-tint-fg hover:bg-brand-tint/80">
                  ✎ Draw an area
                </button>
                {drawnAreas.length > 0 && (
                  <button onClick={clearAreas} className="rounded border border-border-strong px-3 py-2 text-xs font-medium text-fg-muted hover:bg-sunken">
                    Clear all
                  </button>
                )}
              </div>
              {drawnAreas.length === 0 ? (
                <p className="mt-1 text-xs text-fg-muted">Click to add points; double-click to finish. Draw as many areas as you want — each becomes a book.</p>
              ) : (
                <>
                  <ul className="mt-2 space-y-1">
                    {drawnAreas.map((a, i) => {
                      const s = manualAreaStats[i];
                      return (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded bg-sunken px-2 py-1 text-xs">
                          <span className="font-medium text-fg">Area {i + 1}</span>
                          <span className="flex items-center gap-2">
                            <span className="text-fg-muted">
                              {manualPreviewQ.isFetching && !s
                                ? '…'
                                : `${(s?.doorCount ?? 0).toLocaleString()} houses · ${(s?.voterCount ?? 0).toLocaleString()} voters`}
                            </span>
                            <button onClick={() => deleteArea(a.id)} className="rounded px-1 text-fg-subtle hover:bg-danger-tint hover:text-danger" aria-label="Remove area">✕</button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {drawnAreas.length > 1 && manualAreaStats.length > 0 && (
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      Total: {manualAreaStats.reduce((t, x) => t + (x?.doorCount || 0), 0).toLocaleString()} houses ·{' '}
                      {manualAreaStats.reduce((t, x) => t + (x?.voterCount || 0), 0).toLocaleString()} voters
                    </p>
                  )}
                  {drawnAreas.length > 1 && (
                    <p className="mt-1 text-[11px] text-fg-subtle">
                      Houses in overlapping areas count toward the first area drawn.
                    </p>
                  )}
                  <label className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                    <input type="checkbox" checked={manualSplit} onChange={(e) => setManualSplit(e.target.checked)} />
                    Split areas over
                    <input
                      type="number"
                      min="1"
                      value={maxDoors}
                      onChange={(e) => setMaxDoors(e.target.value)}
                      className="w-12 rounded border border-border-strong bg-card px-1 py-0.5 text-center text-fg"
                    />
                    doors into smaller books
                  </label>
                </>
              )}
            </div>
          )}

          {passId && publishedCount === 0 && (
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setShowTarget((v) => !v)}
                className="flex w-full items-center justify-between rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium text-fg-muted hover:bg-sunken"
              >
                <span>Target doors {targetActive ? '· on' : '(optional)'}</span>
                <span>{showTarget ? '▾' : '▸'}</span>
              </button>
              {showTarget && (
                <div className="mt-2 space-y-2 rounded-md border border-border-strong bg-sunken px-3 py-2">
                  <p className="text-[11px] text-fg-muted">
                    Cut this pass over only the doors that match — e.g. follow up on the unknocked, re-try not-homes, or GOTV your supporters.
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium text-fg-muted">Status:</span>
                    {['unknocked', 'not_home', 'surveyed', 'refused', 'restricted', 'lit_dropped', 'wrong_address'].map((s) => (
                      <label key={s} className="flex items-center gap-1 capitalize">
                        <input type="checkbox" checked={targetFilter.priorPassStatuses.includes(s)} onChange={() => toggleTargetStatus(s)} />
                        {s.replace('_', ' ')}
                      </label>
                    ))}
                  </div>
                  {targetQuestions.length > 0 && (
                    <AnswerFilters
                      questions={targetQuestions}
                      value={targetFilter.answerFilters}
                      onChange={(v) => setTargetFilter((t) => ({ ...t, answerFilters: v }))}
                    />
                  )}
                  {targetActive && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      {targetFilter.priorPassStatuses.length > 0 && targetFilter.answerFilters.length > 0 ? (
                        <label className="flex items-center gap-1.5 text-fg-muted">
                          Combine
                          <select
                            value={targetFilter.combine}
                            onChange={(e) => setTargetFilter((t) => ({ ...t, combine: e.target.value }))}
                            className="rounded border border-border-strong bg-card px-1 py-0.5 text-fg"
                          >
                            <option value="or">OR (any)</option>
                            <option value="and">AND (all)</option>
                          </select>
                        </label>
                      ) : (
                        <span />
                      )}
                      <span className="font-semibold text-fg">
                        {targetPreviewQ.isFetching
                          ? '…'
                          : `${(targetPreviewQ.data?.doorCount ?? 0).toLocaleString()} doors · ${(targetPreviewQ.data?.voterCount ?? 0).toLocaleString()} voters`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {passId && !hasNoDoors && publishedCount === 0 && (
            <div className="mb-3 rounded-md border border-border-strong bg-sunken px-3 py-2 text-xs">
              {excludedApartmentCount > 0 ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">{excludedApartmentCount.toLocaleString()} apartment door{excludedApartmentCount === 1 ? '' : 's'} excluded</span>
                  <button onClick={() => includeApts.mutate()} disabled={includeApts.isPending} className="shrink-0 font-semibold text-brand-accent hover:underline disabled:opacity-50">Re-include</button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">
                    Remove apartments (
                    <input
                      type="number"
                      min="2"
                      value={aptThreshold}
                      onChange={(e) => setAptThreshold(Math.max(2, parseInt(e.target.value, 10) || 4))}
                      className="mx-0.5 w-10 rounded border border-border-strong bg-card px-1 py-0.5 text-center text-fg"
                    />
                    + units)
                  </span>
                  <button
                    onClick={() => excludeApts.mutate()}
                    disabled={excludeApts.isPending || aptPreview.doors === 0}
                    className="shrink-0 font-semibold text-brand-accent hover:underline disabled:opacity-40"
                  >
                    {aptPreview.doors > 0 ? `Exclude ${aptPreview.doors.toLocaleString()} · ${aptPreview.buildings} bldg` : 'None found'}
                  </button>
                </div>
              )}
            </div>
          )}

          {doorsQ.data && !hasNoDoors && publishedCount === 0 && (() => {
            const total = doorsQ.data.doors?.length || 0;
            const n = targetActive ? targetPreviewQ.data?.doorCount ?? null : total;
            return (
              <p className="mb-2 text-xs text-fg-muted">
                <strong>{(n ?? 0).toLocaleString()}</strong> {targetActive ? 'targeted' : 'knockable'} doors
                {mode === 'geometric' && n != null ? ` → ~${Math.max(1, Math.ceil(n / (Number(maxDoors) || 65)))} books` : ''}
              </p>
            );
          })()}

          {restrictedDoorCount > 0 && publishedCount === 0 && (
            <label className="mb-2 flex items-start gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                checked={excludeRestricted}
                onChange={(e) => setExcludeRestricted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Exclude <strong>{restrictedDoorCount.toLocaleString()}</strong> restricted-access{' '}
                {restrictedDoorCount === 1 ? 'home' : 'homes'} from this cut
              </span>
            </label>
          )}

          <button onClick={() => canGenerate && generate.mutate()} disabled={!canGenerate} className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60">
            {generate.isPending || jobBusy ? 'Generating…' : 'Generate'}
          </button>
          {!hasNoDoors && publishedCount === 0 && (
            <p className="mt-2 text-[11px] text-fg-muted">
              Generated books are <strong>drafts</strong> — nothing reaches canvassers until you Accept. Re-cut freely until then.
            </p>
          )}

          {hasNoDoors && votedDoorCount > 0 && (
            <NextStepBanner tone="info" className="mt-3">
              All {votedDoorCount.toLocaleString()} door{votedDoorCount === 1 ? '' : 's'} here have already voted — nothing to cut.
            </NextStepBanner>
          )}
          {hasNoDoors && votedDoorCount === 0 && (
            <NextStepBanner
              tone="warning"
              className="mt-3"
              action={{ label: 'Go to Walk Lists', to: `/campaigns/${campaignId}/efforts` }}
            >
              This walk list owns no mappable doors yet. Claim doors into it on the Walk Lists page before cutting books.
            </NextStepBanner>
          )}
          {!hasNoDoors && votedDoorCount > 0 && (
            <p className="mt-2 text-xs text-fg-muted">
              {votedDoorCount.toLocaleString()} door{votedDoorCount === 1 ? '' : 's'} here already voted — skipped (not cut into books).
            </p>
          )}

          {jobId && (
            <div className="mt-3 text-xs text-fg-muted">
              {jobQ.data?.status === 'failed' ? (
                <span className="text-danger">Failed: {jobQ.data.error || 'unknown error'}</span>
              ) : jobQ.data?.status === 'completed' ? (
                <span className="text-success">Done — {jobQ.data?.result?.bookCount ?? draftCount} books.</span>
              ) : (
                <>
                  <div className="mb-1">{progress?.phase || 'queued'}… {pct != null ? `${pct}%` : ''}</div>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-sunken"><div className="h-full bg-brand-500 transition-all" style={{ width: `${pct || 5}%` }} /></div>
                </>
              )}
            </div>
          )}
          {generate.error && <div className="mt-2 text-xs text-danger">{generate.error.message}</div>}
          {publishedCount > 0 && (
            <p className="mt-2 text-xs text-warning-fg">This pass has accepted books — Discard them below to re-cut.</p>
          )}

          {publishedCount > 0 && selectedPass && selectedPass.status !== 'active' && (
            <NextStepBanner
              tone="success"
              className="mt-3"
              title="Books accepted."
              action={{
                label: 'Activate pass',
                to: `/campaigns/${campaignId}/efforts/${selectedPass.effortId || ''}/passes`,
              }}
            >
              Assign canvassers to books below, then activate the pass to send it to the field.
            </NextStepBanner>
          )}

          {!!turfs.length && unassignedCount > 0 && (
            <div className="mt-3 rounded-md border border-info/30 bg-info-tint px-3 py-2.5 text-xs">
              <p className="font-medium text-info-fg">
                {unassignedCount.toLocaleString()} door{unassignedCount === 1 ? '' : 's'} not in any book
              </p>
              <p className="mt-0.5 text-info-fg">
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
                <div className="mt-1 text-danger">{addSupplemental.error.message}</div>
              )}
              {addSupplemental.data?.added === 0 && (
                <div className="mt-1 text-info-fg">No eligible doors to add (saved-search passes only include their saved list).</div>
              )}
            </div>
          )}

          {!!turfs.length && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{turfs.length} books{draftCount ? ` · ${draftCount} draft` : ''}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setEditMode((v) => !v)} title="Rename books" className={`rounded px-2 py-1 text-xs font-medium ${editMode ? 'bg-fg text-card' : 'border border-border-strong text-fg-muted hover:bg-sunken'}`}>
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
                    className="rounded px-2 py-1 text-xs font-medium text-danger hover:bg-danger-tint disabled:opacity-60"
                  >
                    {discard.isPending ? 'Discarding…' : 'Discard'}
                  </button>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-3 text-xs">
                <button onClick={() => setSelectedBooks(new Set(turfs.filter(bookShown).map((t) => String(t._id))))} className="font-medium text-brand-accent hover:underline">Select all{listFiltered ? ' shown' : ''}</button>
                {selectedBooks.size > 0 && (
                  <button onClick={() => setSelectedBooks(new Set())} className="font-medium text-fg-muted hover:underline">Clear ({selectedBooks.size})</button>
                )}
                <span className="text-fg-subtle">Click a book (here or on the map) to assign canvassers.</span>
              </div>

              {editMode && (
                <div className="mb-2 rounded bg-sunken px-2 py-1.5 text-xs text-fg-muted">
                  Rename mode: edit a book's name below. Selecting/assigning still works as usual.
                </div>
              )}

              {turfs.length > 6 && (
                <div className="mb-2">
                  <input
                    type="search"
                    value={bookSearchQuery}
                    onChange={(e) => setBookSearchQuery(e.target.value)}
                    placeholder="Search books by name or canvasser…"
                    className="w-full rounded border border-border-strong bg-card px-2 py-1 text-xs text-fg placeholder:text-fg-subtle focus:border-brand-accent focus:outline-none"
                  />
                </div>
              )}
              {listFiltered && <div className="mb-2 text-[10px] text-fg-subtle">{shownBooksCount} of {turfs.length} books</div>}

              <ul className="max-h-72 space-y-1 overflow-auto text-sm">
                {turfs.map((t, i) => {
                  const selected = selectedBooks.has(String(t._id));
                  if (!bookShown(t)) return null;
                  return (
                  <li
                    key={t._id}
                    onClick={() => toggleBook(t._id)}
                    title="Click to select this book (assign on the panel); click again to deselect"
                    className={`flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-0.5 ${
                      selected ? 'bg-brand-tint ring-1 ring-brand-accent/30' : 'hover:bg-sunken'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: colorFor(i) }} />
                      {editMode ? (
                        <input
                          defaultValue={t.name}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && rename.mutate({ turfId: t._id, name: e.target.value.trim() })}
                          className="min-w-0 flex-1 truncate rounded border border-transparent px-1 hover:border-border-strong focus:border-brand-accent focus:outline-none"
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
                              <span key={u.id} className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-tint text-[8px] font-semibold text-brand-tint-fg ring-1 ring-card">
                                {(u.firstName?.[0] || '') + (u.lastName?.[0] || '')}
                              </span>
                            ))}
                            {asg.length > 3 && <span className="pl-1 text-[9px] text-fg-subtle">+{asg.length - 3}</span>}
                          </span>
                        );
                      })()}
                      <span className="text-fg-muted">{t.eligibleDoorCount ?? t.doorCount}</span>
                    </span>
                  </li>
                  );
                })}
              </ul>
            </div>
          )}

          {snapshots.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">Undo / snapshots</div>
              {lastSnapshotId && turfs.length === 0 && (
                <button
                  onClick={() => restore.mutate(lastSnapshotId)}
                  disabled={restore.isPending}
                  className="mb-2 w-full rounded bg-fg px-2 py-1.5 text-xs font-semibold text-card hover:bg-fg-muted disabled:opacity-60"
                >
                  {restore.isPending ? 'Restoring…' : '↩ Undo last discard'}
                </button>
              )}
              <ul className="space-y-1 text-xs">
                {snapshots.map((s) => (
                  <li key={s._id} className="flex items-center justify-between gap-2 rounded px-1 py-1">
                    <span className="min-w-0 truncate text-fg-muted">
                      {formatInTz(s.createdAt, tz, { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }, true)} · {s.bookCount} books
                      {s.clearedKnocks ? ` · ${s.knockCount} knocks` : ''}
                      {s.restoredAt ? ' · restored' : ''}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => restore.mutate(s._id)}
                        disabled={restore.isPending || turfs.length > 0}
                        title={turfs.length > 0 ? 'Discard current books first' : 'Restore this snapshot'}
                        className="rounded border border-border-strong px-2 py-0.5 font-medium text-fg-muted hover:bg-sunken disabled:opacity-50"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => { if (window.confirm('Delete this snapshot? It can no longer be restored.')) deleteSnapshot.mutate(s._id); }}
                        disabled={deleteSnapshot.isPending}
                        title="Delete snapshot"
                        className="rounded px-1.5 py-0.5 text-fg-subtle hover:bg-danger-tint hover:text-danger disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
              {turfs.length > 0 && (
                <p className="mt-1 text-[11px] text-fg-subtle">Discard the current books to restore an earlier snapshot.</p>
              )}
              {restore.error && <div className="mt-1 text-[11px] text-danger">{restore.error.message}</div>}
            </div>
          )}
        </section>

        <section style={{ flex: 1, minHeight: 0, position: 'relative' }} className="overflow-hidden rounded-lg border border-border bg-card">
          {!tokenQ.data?.isReady ? (
            <div style={{ height: '100%' }} className="flex items-center justify-center text-sm text-fg-muted">
              {tokenQ.isLoading ? 'Loading map…' : 'Set MAPBOX_PUBLIC_TOKEN to enable the map.'}
            </div>
          ) : (
            <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          )}
          {tokenQ.data?.isReady && (
            <MapStyleControl value={styleId} onChange={setStyle} menuDirection="up" className="absolute bottom-3 left-3 z-10 items-start" />
          )}
          {tokenQ.data?.isReady && !!turfs.length && (
            <div className="absolute right-3 top-28 z-10 rounded-lg border border-border bg-card/95 p-2 text-xs shadow-lg backdrop-blur">
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Layers</div>
              {[
                ['houses', 'Houses'],
                ['buildings', 'Buildings'],
                ['fills', 'Book fills'],
                ['labels', 'Labels'],
                // Offered only when the cut actually left doors loose. "Not in a book" hides
                // every loose door; "Restricted" hides just the restricted ones — both default
                // hidden, so the map opens showing only this cut's booked doors.
                ...(looseDoorCount > 0 ? [['notInBook', `Not in a book (${looseDoorCount.toLocaleString()})`]] : []),
                ...(restrictedDoorCount > 0 ? [['restricted', `Restricted (${restrictedDoorCount.toLocaleString()})`]] : []),
              ].map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-sunken">
                  <input
                    type="checkbox"
                    checked={layerVis[key]}
                    onChange={(e) => setLayerVis((v) => ({ ...v, [key]: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
                  />
                  <span className="text-fg">{label}</span>
                </label>
              ))}
              {/* Colors houses by what happened at them THIS round, keeping book identity as
                  the halo. Auto-on once the round has knocks; this forces it either way. */}
              <label
                className="mt-0.5 flex cursor-pointer items-center gap-2 rounded border-t border-border px-1 pt-1 hover:bg-sunken"
                title="Color houses by this round's door status, with the book color as a ring"
              >
                <input
                  type="checkbox"
                  checked={statusMode}
                  onChange={(e) => setStatusOverride(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border-strong text-brand-accent focus-visible:ring-ring"
                />
                <span className="text-fg">Door status</span>
              </label>
            </div>
          )}
          {tokenQ.data?.isReady && !!turfs.length && (
            <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
              {crewOpen && crewLoad.length > 0 && (
                <div className="mb-1 max-h-56 w-72 overflow-auto rounded-lg border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
                  <ul className="space-y-0.5 text-xs">
                    {crewLoad.map((c) => (
                      <li key={c.user.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-fg">{c.user.firstName} {c.user.lastName}</span>
                        <span className="shrink-0 text-fg-muted">{c.books} bk · {c.doors.toLocaleString()} dr</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                type="button"
                onClick={() => setCrewOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs font-medium text-fg shadow-lg backdrop-blur hover:bg-sunken"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">Crew load</span>
                {crewLoad.length > 0 ? (
                  <span>{crewLoad.length} canvasser{crewLoad.length === 1 ? '' : 's'} · {turfs.length} books</span>
                ) : (
                  <span className="text-fg-muted">no one assigned yet</span>
                )}
                <span className="text-fg-subtle">{crewOpen ? '▾' : '▴'}</span>
              </button>
            </div>
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
              householdId={popupHouseholdId}
              passId={passId}
              status={popupDoor?.passStatus || 'unknocked'}
              tz={tz}
              showRound={statusMode}
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
          {restrictResult && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-md border border-info/30 bg-info-tint px-3 py-2 text-xs text-info-fg shadow">
              <span>{restrictResult}</span>
              <button onClick={() => setRestrictResult(null)} className="font-semibold hover:opacity-70">
                ✕
              </button>
            </div>
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
              onRestrict={() => {
                setRestrictResult(null);
                setShowRestrict('mark');
              }}
              onUnrestrict={() => {
                setRestrictResult(null);
                setShowRestrict('unmark');
              }}
              restrictPending={restrictBulk.isPending || unrestrictBulk.isPending}
            />
          )}
        </section>
      </div>

      {showRestrict && (
        <RestrictModal
          mode={showRestrict}
          books={selectedTurfs}
          progressByTurf={progressByTurf}
          pending={restrictBulk.isPending || unrestrictBulk.isPending}
          error={showRestrict === 'mark' ? restrictBulk.error : unrestrictBulk.error}
          onCancel={() => setShowRestrict(null)}
          onConfirm={(scope) => {
            const turfIds = selectedTurfs.map((t) => String(t._id));
            if (showRestrict === 'mark') restrictBulk.mutate({ turfIds, scope });
            else unrestrictBulk.mutate(turfIds);
          }}
        />
      )}

      {showDiscard && (
        <DiscardModal
          isActive={isActivePass}
          bookCount={turfs.length}
          passLabel={passLabel}
          knockCount={knockCount}
          clearKnocks={clearKnocks}
          setClearKnocks={setClearKnocks}
          pending={discard.isPending}
          error={discard.error}
          onCancel={() => { setShowDiscard(false); setClearKnocks(false); }}
          onConfirm={() => discard.mutate({ confirmActive: isActivePass || knockCount > 0, clearKnocks })}
        />
      )}
    </div>
  );
}
