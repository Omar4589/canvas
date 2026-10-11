import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import { useMapStyle } from '../lib/mapStyles.js';
import MapStyleControl from '../components/MapStyleControl.jsx';
import MovePinCard from '../components/MovePinCard.jsx';
import PinFixCards from '../components/PinFixCards.jsx';
import PlaceAlongRail from '../components/PlaceAlongRail.jsx';
import { useMovePin } from '../lib/useMovePin.js';
import { movePinToast, movePinInvalidationKeys } from '../lib/movePin.js';
import { importPinLine } from '../lib/importPins.js';
import { pinLine } from '../lib/pinBadges.js';
import { formatInTz } from '../lib/datetime.js';
import { useOrgTimeZone } from '../auth/AuthContext.jsx';
import {
  registerLayers,
  householdsToGeoJSON,
  buildingsToGeoJSON,
  pointToGeoJSON,
  setNeighbourNumbers,
  removeNeighbourNumbers,
} from '../lib/mapRender.js';
import { groupHouseholds } from '../lib/buildings.js';
import {
  buildGroups,
  buildStreetGroups,
  googleMapsUrl,
  confirmToast,
  confirmErrorMessage,
  confirmInvalidationKeys,
  confirmNeedsRefetch,
  confirmLabel,
  confirmPrompt,
  pickSpotRow,
  popupKeyAction,
  popupHint,
  isOffWorld,
  doorIdsOfRows,
  setAsidePrompt,
  setAsideToast,
  bringBackToast,
  isLookupActive,
  lookupToast,
  lookupErrorMessage,
  scopedGroups,
  placeFlyTarget,
  middleOf,
  neighbourNumbersGeoJSON,
} from '../lib/pinFixes.js';

// Both pin layers registerLayers creates — click handling has to cover BOTH or every
// apartment stack (drawn as a building glyph, its doors filtered out of the household
// layer) is unclickable. Same constant, same reason, as AnswerMiniMap.
const PIN_LAYERS = ['households-symbols', 'building-symbols'];

const DEFAULT_CENTER = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;
// Stable empties, so a loading payload doesn't hand every memo a fresh array each render.
const EMPTY = [];
// Place along the street: the zoom the camera flies to (roofs clickable, and wide enough — about 400 m
// across on a laptop — that the street's placed neighbours and their numbers are in view), and the zoom
// below which the house-number labels aren't fetched (a wide view would pull a whole town's doors for
// unreadable labels).
const PLACE_ZOOM = 17;
const NEIGHBOUR_MIN_ZOOM = 15;
const r5 = (x) => Math.round(x * 100000) / 100000;

// The action card for a map-selected pin — parked in the shared top-right corner (the
// MovePinCard / Turf-popup slot; like the Turf popups it covers the zoom buttons while open,
// a precedented trade). Presentational: the page owns selection, the actions, the advance.
//
// A complex row (kind 'complex', the pin-fixes build) shows its homes and the complex actions — Looks right
// (every home at once), Spread on the map — instead of Move / confirm; it sits outside the street order, so
// no ← →. A home parked at a holding spot has no confirm at all (confirmLabel is null). Set aside is offered
// on any home without an exact spot.
const PinFixPopup = ({
  row,
  index,
  count,
  confirmBusy,
  busy = false,
  mapReady,
  fmtDate,
  onMove,
  onConfirm,
  onSetAside,
  onSpread,
  onClose,
  onPrev,
  onNext,
}) => {
  // Units sorted by their unit line: the wire sorts by addressLine1 + _id, so same-line units
  // arrive in id order — meaningless to a human reading "Apt 3, Apt 1, Apt 2".
  const units = useMemo(
    () =>
      row.units
        ? [...row.units].sort((a, b) =>
            String(a.addressLine2 || a.addressLine1).localeCompare(
              String(b.addressLine2 || b.addressLine1),
              undefined,
              { numeric: true }
            )
          )
        : null,
    [row.units]
  );
  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">{row.label}</div>
          <div className="truncate text-xs text-fg-muted">
            {row.sub ? `${row.sub} · ` : ''}
            {row.door.city}, {row.door.state} {row.door.zipCode}
          </div>
          {row.kind !== 'complex' && pinLine(row.door, fmtDate) && (
            <div className="mt-0.5 text-xs text-fg-muted">{pinLine(row.door, fmtDate)}</div>
          )}
          {row.kind === 'complex' && (
            <div className="mt-0.5 text-xs text-fg-muted">
              The file and the address lookup agree these homes share this spot. Each home has its own Directions on the phone.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-fg-subtle hover:bg-sunken hover:text-fg-muted"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 101.06 1.06L10 11.06l4.72 4.72a.75.75 0 101.06-1.06L11.06 10l4.72-4.72a.75.75 0 00-1.06-1.06L10 8.94 5.28 4.22z" />
          </svg>
        </button>
      </div>
      {units && (
        // Capped + scrollable — a 100-unit tower must not grow the card past the map.
        <div className="max-h-36 overflow-y-auto border-b border-border px-3 py-1.5">
          {units.map((u) => (
            <div key={u.id} className="truncate py-0.5 text-xs text-fg-muted">
              {u.addressLine2 ? `${u.addressLine1} ${u.addressLine2}` : u.addressLine1}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2 px-3 py-2.5">
        {row.kind === 'complex' ? (
          <>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmBusy || busy}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {confirmBusy ? 'Saving…' : 'Looks right — it’s a complex'}
            </button>
            <button
              type="button"
              onClick={onSpread}
              disabled={!mapReady || confirmBusy || busy}
              className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
            >
              Spread on the map
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onMove}
              // confirmBusy too: arming a move while a confirm is settling would let the settling
              // advance hijack the drag (they share the neighbor stash).
              disabled={!mapReady || confirmBusy}
              className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {row.kind === 'building' ? 'Move building pin' : 'Move pin'}
            </button>
            {confirmLabel(row) && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={confirmBusy}
                className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
              >
                {confirmBusy ? 'Saving…' : confirmLabel(row)}
              </button>
            )}
            {row.unplaced && (
              <button
                type="button"
                onClick={onSetAside}
                disabled={confirmBusy || busy}
                className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
              >
                Set aside
              </button>
            )}
          </>
        )}
        <a
          href={googleMapsUrl(row.door)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
        >
          Google Maps ↗
        </a>
      </div>
      {index >= 0 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={index <= 0}
            aria-label="Previous pin"
            className="rounded px-2 py-0.5 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-[11px] text-fg-subtle">
            {index + 1} of {count} pins
          </span>
          <button
            type="button"
            onClick={onNext}
            disabled={index >= count - 1}
            aria-label="Next pin"
            className="rounded px-2 py-0.5 text-sm text-fg-muted hover:bg-sunken disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
      <div className="border-t border-border px-3 py-1 text-[10px] text-fg-subtle">
        {index >= 0 ? popupHint(row) : 'G maps · Esc close'}
      </div>
    </div>
  );
};

// Pin Fixes — the work queue for approximate-geocode pins (the amber rings): every active
// door whose coordinate came from a street-level match (coordConfidence 'interpolated') and
// no human has vouched for yet — plus every home with no exact map spot (its coordinate was
// shared with other addresses and the import's lookup couldn't place it; UNPLACED_PIN on the
// server). Those rows never confirm on Enter, and Looks right asks once before vouching.
// Two action surfaces, one selection: a MAP pin click opens
// the top-right action popup (with Next/Prev and keyboard triage), a LIST row click expands
// that row's inline buttons — and after any completed move or confirm the page auto-advances
// to the next pin in popup mode. Lead-allowed like the Map and Turf pin tools — the server's
// requireCampaignManager gate is the wall, so this page carries no in-page role check (the
// MapPage/TurfsPage precedent).
//
// The pin-fixes build (docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.2–S10.3) puts "Fix together" cards
// above the list, one per cause (shared spot, far from its street, couldn't be found, complexes,
// approximate), with Look up by address (an ImportJob of kind 'pin_lookup', polled), Place along the street
// (click each roof in Hybrid; useMovePin's click mode), Set aside, Start checking (the list narrowed to the
// approximate rows, Enter and auto-advance as before) and, per complex, Looks right / Spread on the map.
const PinFixesPage = () => {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const orgTz = useOrgTimeZone();
  const fmtDate = (d) => formatInTz(d, orgTz, { month: 'short', day: 'numeric' }, false);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);
  const styleControlRef = useRef(null);

  // Row selection: { key: 'h:<id>' | 'b:<key>', source: 'list' | 'map' }. The source decides
  // WHERE the actions render — 'list' expands the row's inline buttons, 'map' (pin clicks,
  // arrow keys, auto-advance) opens the top-right popup. One state object so key and source
  // can never disagree; a render-assigned mirror ref (the armedRef idiom) lets post-await
  // code read the LIVE selection instead of a stale closure.
  const [selection, setSelection] = useState(null);
  const selectionRef = useRef(null);
  selectionRef.current = selection;
  const idToRowKeyRef = useRef(new Map());
  const spotRowKeysRef = useRef(new Map());
  const rowRefs = useRef(new Map());
  const [toast, setToast] = useState(null); // { text, tone?, undo?: { kind: 'confirm', id, scope } | { kind: 'setAside', ids } }
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false); // set aside / bring back in flight
  // Start checking / Show homes: the list narrowed to one card's rows ({ kind, title, rowKeys: Set,
  // checking }), or null. Mirrored for post-await reads (advanceAfterAction).
  const [scope, setScope] = useState(null);
  const scopeRef = useRef(null);
  scopeRef.current = scope;
  // Place along the street: { title, rows (snapshots — a placed row leaves the payload), index, placed: [rowKey] }.
  const [placeMode, setPlaceMode] = useState(null);
  const placeModeRef = useRef(null);
  placeModeRef.current = placeMode;
  const placing = !!placeMode;
  const placeStyleRef = useRef(null); // the basemap to go back to on exit
  const [placeBox, setPlaceBox] = useState(null); // the viewport, for the house-number labels
  // Look up by address: the running job ({ id, group, campaignId }) — one at a time.
  const [lookupJob, setLookupJob] = useState(null);

  const tokenQ = useQuery({
    queryKey: ['config', 'mapbox-token'],
    queryFn: () => api('/admin/config/mapbox-token'),
    staleTime: 5 * 60 * 1000,
  });
  const listQ = useQuery({
    queryKey: ['admin', 'pin-fixes', campaignId],
    queryFn: () => api(`/admin/campaigns/${campaignId}/households/pin-fixes`),
    enabled: !!campaignId,
  });
  const households = listQ.data?.households || EMPTY;
  const complexes = listQ.data?.complexes || EMPTY;
  const setAsideList = listQ.data?.setAside || EMPTY;
  const complexCount = listQ.data?.complexCount || 0;
  const total = listQ.data?.total ?? households.length;

  // Session progress baseline: the queue's DOOR total at first load, per campaign. Written
  // only when data exists (total falls back to 0 while loading — a baseline captured then
  // would read "everything cleared"); whole-record reset on campaign switch (the page stays
  // mounted through one); rebased upward if a mid-session import adds new interpolated doors.
  // Render-assigned ref, armedRef-style. An Undo raises total back TOWARD the baseline, never
  // past it, so cleared simply counts back down — no special case.
  const startRef = useRef({ campaignId: null, startTotal: null });
  if (listQ.data) {
    if (startRef.current.campaignId !== campaignId) {
      startRef.current = { campaignId, startTotal: listQ.data.total };
    } else if (listQ.data.total > startRef.current.startTotal) {
      startRef.current.startTotal = listQ.data.total;
    }
  }
  const cleared =
    listQ.data && startRef.current.campaignId === campaignId
      ? Math.max(0, startRef.current.startTotal - listQ.data.total)
      : 0;

  // Street-grouped queue rows (one row per pin — buildings collapse), the flat order the
  // arrows/advance walk, and the id → row map the pin-click handler reads. Pure
  // (lib/pinFixes.js) so the shapes are unit-tested. buildGroups adds the cause cards, one pseudo-row
  // per condo complex ('c:<key>', outside the street order) and each complex's member rows (what
  // Spread on the map places).
  const fix = useMemo(
    () => buildGroups({ households, complexes, setAside: setAsideList }),
    [households, complexes, setAsideList]
  );
  const { groups, rowCount } = fix.street;
  // The list as shown: narrowed to a card's rows while a scope is set. `rowKeys` is the order Next/Prev,
  // Enter and auto-advance walk, so a scope keeps every key press inside it.
  const visibleGroups = useMemo(() => scopedGroups(groups, scope?.rowKeys || null), [groups, scope]);
  const rowKeys = useMemo(() => visibleGroups.flatMap((g) => g.rows.map((r) => r.rowKey)), [visibleGroups]);
  // A complex marker resolves to its 'c:' row, by door id or by spot, like any row.
  const idToRowKey = useMemo(() => {
    const m = new Map(fix.street.idToRowKey);
    for (const c of fix.complexRows) for (const u of c.units) m.set(String(u.id), c.rowKey);
    return m;
  }, [fix]);
  const spotRowKeys = useMemo(() => {
    const m = new Map();
    for (const [spot, keys] of fix.street.spotRowKeys) m.set(spot, [...keys]);
    for (const c of fix.complexRows) {
      const list = m.get(c.spot);
      if (list) list.push(c.rowKey);
      else m.set(c.spot, [c.rowKey]);
    }
    return m;
  }, [fix]);
  useEffect(() => {
    idToRowKeyRef.current = idToRowKey;
  }, [idToRowKey]);
  useEffect(() => {
    spotRowKeysRef.current = spotRowKeys;
  }, [spotRowKeys]);
  const rowsByKey = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const r of g.rows) m.set(r.rowKey, r);
    for (const r of fix.complexRows) m.set(r.rowKey, r);
    for (const r of fix.memberRows) if (!m.has(r.rowKey)) m.set(r.rowKey, r);
    return m;
  }, [groups, fix]);
  const selectedRow = selection ? rowsByKey.get(selection.key) || null : null;
  // Mirrors for post-await reads — the awaited refetch makes every handler closure stale.
  const rowsByKeyRef = useRef(new Map());
  const rowKeysRef = useRef([]);
  useEffect(() => {
    rowsByKeyRef.current = rowsByKey;
  }, [rowsByKey]);
  useEffect(() => {
    rowKeysRef.current = rowKeys;
  }, [rowKeys]);

  // Drop a selection whose row left the queue (fixed/confirmed elsewhere, refetch, undo). Only if it is
  // STILL the selection: the refetch can commit before a settling action advances, and this effect then
  // runs after the advance with the old row in its closure — a plain setSelection(null) would wipe the
  // advance (found by the browser check of the pin-fixes build: Enter sometimes closed the popup
  // instead of opening the next pin).
  useEffect(() => {
    if (selection && !rowsByKey.has(selection.key)) {
      setSelection((cur) => (cur && cur.key === selection.key ? null : cur));
    }
  }, [selection, rowsByKey]);

  // Map glyph grouping for the map source: one glyph per map spot (groupHouseholds), as on every
  // admin map. The rows split a spot by street address, so a glyph can hold several rows — a glyph
  // click goes through spotRowKeys (pickSpotRow), both keyed by the same buildingKeyForCoords. A
  // complex's members join the map so each complex draws as one "N homes" marker.
  const mapHouseholds = useMemo(
    () => (complexes.length ? [...households, ...complexes.flatMap((c) => c.rows || [])] : households),
    [households, complexes]
  );
  const { buildings, stackedIds } = useMemo(() => groupHouseholds(mapHouseholds), [mapHouseholds]);
  // Where the camera goes for a row at 0,0 with no street to borrow from: the queue's middle.
  const queueMiddle = useMemo(() => middleOf(mapHouseholds.map((h) => h.location)), [mapHouseholds]);
  const queueMiddleRef = useRef(null);
  queueMiddleRef.current = queueMiddle;
  // Doors the house-number labels leave out: everything still in the queue.
  const queueIds = useMemo(() => new Set(mapHouseholds.map((h) => String(h.id))), [mapHouseholds]);

  // ── Auto-advance ────────────────────────────────────────────────────────────────────────
  // Neighbors are captured at ACTION START (the acted row's spot in the flat order is gone by
  // the time the awaited refetch resolves) and consumed ONLY after a COMPLETED action — a
  // drag cancelled by Esc leaves its stash behind, inert until the next action overwrites it
  // (useMovePin owns its own Esc listener, so clear-on-cancel is not reachable from here).
  const advanceRef = useRef(null); // { actedKey, nextKey, prevKey }
  const captureAdvance = (rowKey) => {
    const keys = rowKeysRef.current;
    const i = keys.indexOf(rowKey);
    advanceRef.current = {
      actedKey: rowKey,
      nextKey: i >= 0 ? keys[i + 1] || null : null,
      prevKey: i > 0 ? keys[i - 1] : null,
    };
  };

  // Never to 0,0 (a vendor's "no location"): placeFlyTarget borrows the middle of the row's street, else
  // the queue's middle, else stays put.
  const flyToRow = (row, zoom = 17) => {
    if (!mapRef.current || !row) return;
    const at = placeFlyTarget(row, [...rowsByKeyRef.current.values()], queueMiddleRef.current);
    if (!at) return;
    mapRef.current.flyTo({
      center: [at.lng, at.lat],
      zoom: Math.max(mapRef.current.getZoom(), zoom),
      duration: 600,
      // Runs even under prefers-reduced-motion — MapPage passes it on every flyTo, and a
      // suppressed camera move here would leave the popup describing an off-screen pin.
      essential: true,
    });
  };

  const goToKey = (key) => {
    const row = rowsByKeyRef.current.get(key);
    if (!row) return;
    setSelection({ key, source: 'map' });
    flyToRow(row);
  };

  // An EXPLICIT close (the popup's X, Esc, a blank map click) also cancels any pending
  // auto-advance — "close it" must never mean "it reopens on the next pin" a beat later.
  // The refetch-dropped-row effect deliberately keeps calling setSelection directly: a row
  // vanishing because its action settled IS the advance completing, not a close.
  const closePopup = () => {
    advanceRef.current = null;
    setSelection(null);
  };

  // After a completed confirm/move (its refetch already awaited): advance to the captured
  // next pin in popup mode — unless the admin selected a DIFFERENT row mid-flight (their
  // pick wins — the mid-flight-selection rule from the original review pass) or has a drag
  // ARMED (never yank the camera mid-drag; the stash is left for that move's own onSaved).
  // Candidates are resolved against the REFETCHED QUERY CACHE, not the row memos/refs: the
  // awaited invalidation has updated the cache, but React commits that render on a later
  // task, so rowsByKeyRef still holds the pre-action rows when this runs. (movePin is
  // declared below; this arrow only runs from settled actions, never during render.)
  const advanceAfterAction = () => {
    if (movePin.armedRef.current) return;
    const stash = advanceRef.current;
    advanceRef.current = null;
    if (!stash) return;
    const cur = selectionRef.current;
    if (cur && cur.key !== stash.actedKey) return;
    const fresh = buildStreetGroups(qc.getQueryData(['admin', 'pin-fixes', campaignId])?.households || []);
    const freshByKey = new Map();
    for (const g of fresh.groups) for (const r of g.rows) freshByKey.set(r.rowKey, r);
    // While a scope is set (Start checking), the fallback stays inside it: an exhausted scope ends
    // with "All checked", never by opening a row outside it. nextKey/prevKey were captured from the
    // scoped order, so they are inside it already.
    const inScope = (k) => !scopeRef.current || scopeRef.current.rowKeys.has(k);
    const candidate =
      (stash.nextKey && freshByKey.has(stash.nextKey) && stash.nextKey) ||
      (stash.prevKey && freshByKey.has(stash.prevKey) && stash.prevKey) ||
      // Never the acted row itself — belt-and-braces should the cache ever lag too.
      fresh.rowKeys.find((k) => k !== stash.actedKey && inScope(k)) ||
      null;
    if (!candidate) {
      // Nothing fetched is left. On a truncated queue `total` can still be positive — the
      // banner already says to refresh for the next tranche.
      setSelection(null);
      return;
    }
    setSelection({ key: candidate, source: 'map' });
    flyToRow(freshByKey.get(candidate));
  };

  // Shared move-pin flow — declared BEFORE the map-build effect so its once-bound handlers
  // can read movePin.armedRef at event time. movePinInvalidationKeys already drops this
  // page's list and the sidebar badge, and save() awaits those refetches before onSaved —
  // so the query CACHE is fresh by onSaved time (the rendered rows/refs are not, which is
  // why advanceAfterAction reads the cache).
  const movePin = useMovePin({
    mapRef,
    campaignId,
    onSaved: (res, target) => {
      if (target?.mode === 'click') {
        onPlaced(target); // Place along the street: the click was the save; light up the next home
        return;
      }
      setToast({ text: movePinToast(target.scope, res?.moved) });
      advanceAfterAction();
    },
  });
  // For the map's once-bound click handler (Place along the street) — the latest hook return.
  const movePinRef = useRef(movePin);
  movePinRef.current = movePin;

  // ONE entry point for both Move buttons (inline row + popup): stash the neighbors only if
  // the hook actually arms — start() refuses non-finite coords, and a captured-but-not-armed
  // stash would advance after nothing.
  const armMove = (row) => {
    if (movePin.start(row.target)) captureAdvance(row.rowKey);
  };

  // ── Place along the street (S10.3) ──────────────────────────────────────────────────────
  // A card's (or a complex's) rows in order; each map click saves the armed home there and arms the
  // next. A multi-unit row carries scope 'building', so one click places all its units. Entering
  // switches the basemap to Hybrid (put back on exit if nobody changed it meanwhile).
  const armPlaceRow = (rows, i, opts) => {
    const row = rows[i];
    if (!row) {
      movePin.cancel(); // past the last home: the rail says "All done"
      return;
    }
    movePin.startClick(row.target, opts);
    const at = placeFlyTarget(row, rows, queueMiddleRef.current);
    if (at && mapRef.current) {
      mapRef.current.flyTo({ center: [at.lng, at.lat], zoom: Math.max(mapRef.current.getZoom(), PLACE_ZOOM), duration: 600, essential: true });
    }
  };
  const enterPlaceMode = (rowKeysToPlace, title) => {
    const rows = rowKeysToPlace.map((k) => rowsByKeyRef.current.get(k)).filter((r) => r?.target && r.kind !== 'complex');
    if (!rows.length || !mapRef.current) return;
    movePin.cancel();
    advanceRef.current = null;
    setSelection(null);
    placeStyleRef.current = styleId;
    if (styleId !== 'hybrid') setStyle('hybrid');
    setPlaceMode({ title, rows, index: 0, placed: [] });
    armPlaceRow(rows, 0);
  };
  const onPlaced = (target) => {
    const pm = placeModeRef.current;
    if (!pm) return;
    const found = pm.rows.findIndex((r) => r.target?.id === target.id);
    const at = found >= 0 ? found : pm.index;
    const key = pm.rows[at]?.rowKey;
    const placed = !key || pm.placed.includes(key) ? pm.placed : [...pm.placed, key];
    setPlaceMode({ ...pm, index: at + 1, placed });
    armPlaceRow(pm.rows, at + 1);
  };
  const goToPlaceIndex = (i, opts) => {
    const pm = placeModeRef.current;
    if (!pm || movePin.saving || i < 0 || i > pm.rows.length) return;
    setPlaceMode({ ...pm, index: i });
    armPlaceRow(pm.rows, i, opts);
  };
  const exitPlaceMode = () => {
    movePin.cancel();
    setPlaceMode(null);
    const prev = placeStyleRef.current;
    placeStyleRef.current = null;
    if (prev && prev !== 'hybrid' && styleId === 'hybrid') setStyle(prev);
  };

  // Build the map once the token is ready. Handlers are bound ONCE here — they reference layer
  // ids that registerLayers recreates on every style swap, so they keep working across it.
  useEffect(() => {
    if (!tokenQ.data?.isReady || !containerRef.current || mapRef.current) return undefined;
    mapboxgl.accessToken = tokenQ.data.token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: appliedStyleRef.current,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), 'top-right');
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    map.on('load', () => {
      // Default registration (withCanvassers on): the canvasser sources just stay empty, and
      // it's what carries the 'selected-household' highlight ring this page needs. darkBase
      // here is the build-time value, which matches the style the map was created with; the
      // swap effect below owns every later change.
      registerLayers(map, darkBase);
      mapRef.current = map;
      setMapReady(true);
    });

    const onPinClick = (e) => {
      if (movePin.armedRef.current) return; // placing a marker — don't switch rows mid-drag
      const props = e.features?.[0]?.properties || {};
      if (props.id) {
        const rk = idToRowKeyRef.current.get(String(props.id));
        if (rk) setSelection({ key: rk, source: 'map' });
      } else if (props.key) {
        // A spot glyph can hold several rows (homes with different addresses on one shared spot):
        // each click selects the next one.
        const rk = pickSpotRow(spotRowKeysRef.current, props.key, selectionRef.current?.key);
        if (rk) setSelection({ key: rk, source: 'map' });
      }
    };
    // While placing, the crosshair stays put over pins too.
    const enter = () => { map.getCanvas().style.cursor = placeModeRef.current ? 'crosshair' : 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = placeModeRef.current ? 'crosshair' : ''; };
    for (const layer of PIN_LAYERS) {
      map.on('click', layer, onPinClick);
      map.on('mouseenter', layer, enter);
      map.on('mouseleave', layer, leave);
    }
    const onBlank = (e) => {
      if (movePin.armedRef.current) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: PIN_LAYERS.filter((l) => map.getLayer(l)) });
      if (!hits.length) closePopup(); // closes the popup / collapses the row, cancels a pending advance
    };
    map.on('click', onBlank);
    // Place along the street: any click on the map (a pin included) is the roof for the armed home. The
    // hook reads the armed home from its ref, so this once-bound handler never saves a stale row.
    const onPlaceClick = (e) => {
      const mp = movePinRef.current;
      if (!mp?.clickTargetRef.current) return;
      mp.placeAt(e.lngLat);
    };
    map.on('click', onPlaceClick);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenQ.data]);

  // New campaign = new geography (the sidebar switcher keeps this slug, so the mounted map
  // survives the switch): re-arm the one-time fit so the next data push re-frames the map on
  // the new campaign's doors instead of the old city's view. Same reset MapPage carries.
  // The same switch ends every mode bound to the old campaign: a placing map click can never PATCH a door
  // of another campaign, a scope never narrows a list it doesn't belong to, and a lookup's toast never
  // lands on the wrong queue.
  useEffect(() => {
    if (mapRef.current) mapRef.current._didFitBounds = false;
    if (placeModeRef.current) exitPlaceMode();
    else movePin.cancel();
    setScope(null);
    setLookupJob(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Swap the basemap when the picker changes — the MapPage pattern: setStyle wipes our
  // sources/layers/images, so re-register on style.load and bump styleEpoch to re-hydrate.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    if (appliedStyleRef.current === styleURL) return undefined;
    appliedStyleRef.current = styleURL;
    const handler = () => {
      registerLayers(map, darkBase);
      setStyleEpoch((e) => e + 1);
    };
    map.setStyle(styleURL);
    map.once('style.load', handler);
    return () => map.off('style.load', handler);
  }, [styleURL, darkBase, mapReady]);

  // Push the queue to the map. Every door here is interpolated + unconfirmed, so every
  // single-door pin rings amber by construction (stacked doors draw as the building glyph).
  // Fit once on first data.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('households');
    if (!src) return;
    const geojson = householdsToGeoJSON(mapHouseholds, stackedIds);
    src.setData(geojson);
    const buildingsGeo = buildingsToGeoJSON(buildings);
    mapRef.current.getSource('buildings')?.setData(buildingsGeo);
    if (!mapRef.current._didFitBounds && (geojson.features.length || buildingsGeo.features.length)) {
      const bounds = new mapboxgl.LngLatBounds();
      // Stacked spots (complexes, shared spots) count too — on a file like Fairfield's they are most of
      // the queue — and a home at 0,0 never stretches the first view across the Atlantic.
      for (const f of [...geojson.features, ...buildingsGeo.features]) {
        const [lng, lat] = f.geometry.coordinates;
        if (!isOffWorld(lat, lng)) bounds.extend(f.geometry.coordinates);
      }
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [mapHouseholds, buildings, stackedIds, mapReady, styleEpoch]);

  // Blue highlight ring on the selected row's pin (the shared selected-household source).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('selected-household');
    if (!src) return;
    // No ring at 0,0: the camera never goes there (flyToRow), so a ring there would only mislead.
    const ringed = selectedRow && !isOffWorld(selectedRow.lat, selectedRow.lng) ? selectedRow : null;
    src.setData(pointToGeoJSON(ringed ? { location: { lng: ringed.lng, lat: ringed.lat } } : null));
  }, [selectedRow, mapReady, styleEpoch]);

  // Any selection should be visible in the list too — popup mode included, so the admin can
  // see where they are in the street order.
  useEffect(() => {
    if (!selection) return;
    rowRefs.current.get(selection.key)?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  // Toasts clear themselves; Undo lives only as long as the toast does.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Place along the street: the crosshair, Esc, the viewport, the house numbers ────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !placing) return undefined;
    const canvas = map.getCanvas();
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.style.cursor = '';
    };
  }, [placing, mapReady]);

  // Esc leaves the mode (the hook's own Esc has already disarmed the home). An open basemap menu owns
  // its own Esc — the ref sniff the keyboard ladder below uses — so one press never does two things.
  // Bound once per placing session, reading the latest exit through a ref: the hook's Esc listener
  // re-renders the page in the middle of the same keydown, and a listener re-bound by that render is
  // removed before the event reaches it (the browser check caught Esc only pausing the rail).
  const exitPlaceModeRef = useRef(exitPlaceMode);
  exitPlaceModeRef.current = exitPlaceMode;
  useEffect(() => {
    if (!placing) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (styleControlRef.current?.querySelector('.animate-pop-in')) return;
      exitPlaceModeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing]);

  // The viewport while placing, rounded so a nudge doesn't refetch; nothing when zoomed out past the
  // labels' zoom (a wide view would pull a whole town for labels nobody can read).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !placing) return undefined;
    const update = () => {
      if (map.getZoom() < NEIGHBOUR_MIN_ZOOM) {
        setPlaceBox(null);
        return;
      }
      const b = map.getBounds();
      setPlaceBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map(r5).join(','));
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
      setPlaceBox(null);
    };
  }, [placing, mapReady]);

  // The doors in view (the Map page's endpoint, viewport-bounded and lead-scoped). Its key sits under
  // the households-map prefix, so every placement's invalidation refreshes it: the home just placed
  // gets its number.
  const neighboursQ = useQuery({
    queryKey: ['admin', 'households-map', campaignId, 'pin-fixes-neighbours', placeBox],
    queryFn: () => api(`/admin/households/map?campaignId=${encodeURIComponent(campaignId)}&bbox=${placeBox}`),
    enabled: !!campaignId && placing && !!placeBox,
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });

  // The labels layer: (re)added while placing — and after every basemap swap, since setStyle drops it
  // (styleEpoch) — and removed on exit. A style still loading refuses the source; retry on next idle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;
    if (!placing) {
      removeNeighbourNumbers(map);
      return undefined;
    }
    const data = neighbourNumbersGeoJSON(neighboursQ.data?.households, queueIds);
    const push = () => setNeighbourNumbers(map, data, darkBase);
    if (push()) return undefined;
    map.once('idle', push);
    return () => map.off('idle', push);
  }, [placing, mapReady, styleEpoch, neighboursQ.data, queueIds, darkBase]);

  // ── Look up by address: poll the job, then say what it did and refresh ────────────────────
  const lookupQ = useQuery({
    queryKey: ['admin', 'pin-lookup-job', lookupJob?.id],
    queryFn: () => api(`/admin/imports/${lookupJob.id}`),
    enabled: !!lookupJob?.id,
    refetchInterval: (q) => (!q.state.data || isLookupActive(q.state.data.job) ? 1500 : false),
  });
  useEffect(() => {
    if (!lookupJob) return;
    if (lookupQ.error) {
      setLookupJob(null);
      setToast({ text: lookupQ.error.message || 'Could not read the lookup’s progress.', tone: 'error' });
      return;
    }
    const job = lookupQ.data?.job;
    if (!job || String(job._id) !== lookupJob.id || isLookupActive(job)) return;
    setLookupJob(null);
    setToast(lookupToast(job, importPinLine));
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupQ.data, lookupQ.error, lookupJob]);

  const selectRow = (row) => {
    if (movePin.armed || placing) return; // finish or cancel the drag (or the placing) first
    setSelection({ key: row.rowKey, source: 'list' });
    flyToRow(row);
  };

  const refreshVouchCaches = () =>
    Promise.all(confirmInvalidationKeys(campaignId).map((queryKey) => qc.invalidateQueries({ queryKey })));
  // Set aside, bring back, a complex vouch and a finished lookup can also move book cuts (set-aside flips
  // excludedFromTurf) and the map: the confirm keys plus every key a pin move stales.
  const refreshAll = () => {
    const seen = new Set();
    const keys = [...confirmInvalidationKeys(campaignId), ...movePinInvalidationKeys(campaignId)].filter((k) => {
      const id = JSON.stringify(k);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  };

  // Confirm in place: the pin checks out against the imagery, so vouch it without moving it.
  // A home with no exact map spot asks once first (the click is the only way there — Enter
  // sits out on those rows). expectedCoordinates is the pin this page drew: if an import or
  // another lead has moved it since, the server refuses (PIN_CHANGED) instead of vouching for
  // a spot nobody looked at, and the list reloads.
  //
  // A complex row ('c:<key>') vouches the whole complex (scope 'spot'): no question — Undo is on the
  // toast — and no advance, since a complex sits outside the street order.
  const confirmLocation = async (row) => {
    const target = row?.target;
    if (!target || confirmBusy) return;
    const complex = row.kind === 'complex';
    if (!complex && target.unplaced && !window.confirm(confirmPrompt(row))) return;
    if (!complex) captureAdvance(row.rowKey);
    setConfirmBusy(true);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/${target.id}/confirm-location`, {
        method: 'POST',
        body: { scope: target.scope, expectedCoordinates: [target.lng, target.lat] },
      });
      await (complex ? refreshAll() : refreshVouchCaches());
      setToast({ text: confirmToast(target.scope, res?.updated), undo: { kind: 'confirm', id: target.id, scope: target.scope } });
      if (!complex) advanceAfterAction();
    } catch (err) {
      advanceRef.current = null; // a failed confirm must never advance later
      setToast({ text: confirmErrorMessage(err), tone: 'error' });
      if (confirmNeedsRefetch(err)) listQ.refetch();
    } finally {
      setConfirmBusy(false);
    }
  };

  const undoConfirm = async (undo) => {
    if (!undo || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await api(`/admin/campaigns/${campaignId}/households/${undo.id}/confirm-location`, {
        method: 'POST',
        body: { scope: undo.scope, confirmed: false },
      });
      await (undo.scope === 'spot' ? refreshAll() : refreshVouchCaches());
      setToast({ text: 'Confirmation undone — the pin is back in the queue.' });
    } catch (err) {
      setToast({ text: confirmErrorMessage(err), tone: 'error' });
    } finally {
      setConfirmBusy(false);
    }
  };

  // ── Set aside / bring back ──────────────────────────────────────────────────────────────
  // Out of the queue and every book cut until brought back (services/households/setAsidePin.js). One
  // question first; the toast's Undo brings them back.
  const setAsideRows = async (rows) => {
    const ids = doorIdsOfRows(rows);
    if (!ids.length || bulkBusy) return;
    if (!window.confirm(setAsidePrompt(ids.length))) return;
    setBulkBusy(true);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/set-aside`, {
        method: 'POST',
        body: { householdIds: ids },
      });
      await refreshAll();
      setToast({ text: setAsideToast(res?.updated ?? ids.length), undo: { kind: 'setAside', ids } });
    } catch (err) {
      setToast({ text: err?.message || 'Could not set these homes aside.', tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };
  const bringBack = async (ids) => {
    if (!ids?.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/bring-back`, {
        method: 'POST',
        body: { householdIds: ids },
      });
      await refreshAll();
      setToast({ text: bringBackToast(res?.updated ?? ids.length) });
    } catch (err) {
      setToast({ text: err?.message || 'Could not bring these homes back.', tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };
  const runUndo = (undo) => (undo?.kind === 'setAside' ? bringBack(undo.ids) : undoConfirm(undo));

  // ── Look up by address ──────────────────────────────────────────────────────────────────
  const startLookup = async (card) => {
    if (!card || lookupJob) return;
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/pin-lookup`, {
        method: 'POST',
        body: { group: card.kind },
      });
      if (res?.jobId) setLookupJob({ id: String(res.jobId), group: card.kind, campaignId });
    } catch (err) {
      setToast({ text: lookupErrorMessage(err), tone: 'error' });
    }
  };

  // ── The cards' actions ──────────────────────────────────────────────────────────────────
  const rowsOfKeys = (keys) => keys.map((k) => rowsByKeyRef.current.get(k)).filter(Boolean);
  const onCardAction = (card, id) => {
    if (id === 'lookup') startLookup(card);
    else if (id === 'place') enterPlaceMode(card.rowKeys, card.title);
    else if (id === 'setAside') setAsideRows(rowsOfKeys(card.rowKeys));
    else if (id === 'show' || id === 'check') {
      const keys = new Set(card.rowKeys);
      setScope({ kind: card.kind, title: card.title, rowKeys: keys, checking: id === 'check' });
      if (id === 'check') {
        // The first row opens in popup mode: Enter, the arrows and auto-advance work over the scope.
        const first = card.rowKeys.find((k) => rowsByKeyRef.current.has(k));
        if (first) goToKey(first);
      } else {
        setSelection(null);
      }
    }
  };
  const selectComplex = (row) => {
    if (movePin.armed || placing) return;
    setSelection({ key: row.rowKey, source: 'list' });
    flyToRow(row);
  };
  const spreadComplex = (row) => enterPlaceMode(row.memberRowKeys || [], row.streets?.join(' · ') || 'A complex');

  // ── Keyboard triage ─────────────────────────────────────────────────────────────────────
  // Mounted ONLY while the popup is open, so map arrow-key panning returns the moment it
  // closes. CAPTURE phase + stopPropagation: mapbox's keyboard handler (bubble phase, on the
  // canvas container) pans on arrows and never checks defaultPrevented, so halting the
  // capture descent is the load-bearing call (the DoorSelectionBar convention). Enter sits
  // out on interactive targets so a focused button activates natively exactly once, and on
  // homes with no exact map spot altogether (popupKeyAction answers null — their confirm is
  // the click that asks first); Space is untouched (buttons activate on Space KEYUP — the
  // documented TurfsPage trap). No dep array on purpose: the handler re-binds each render,
  // so every closure is fresh.
  useEffect(() => {
    if (!selection || selection.source !== 'map' || !selectedRow) return undefined;
    const onKey = (e) => {
      if (movePin.armedRef.current) return; // the drag owns the keyboard (its own Esc cancels)
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      const onControl = !!(t && (t.closest?.('button, a, input, textarea, select') || t.isContentEditable));
      const action = popupKeyAction(e.key, selectedRow);
      if (action === 'prev' || action === 'next') {
        e.preventDefault();
        e.stopPropagation();
        const keys = rowKeysRef.current;
        const i = keys.indexOf(selection.key);
        const next = action === 'prev' ? keys[i - 1] : keys[i + 1];
        if (next) goToKey(next);
      } else if (action === 'confirm') {
        if (onControl || confirmBusy) return; // native activation must run exactly once
        confirmLocation(selectedRow);
      } else if (action === 'maps') {
        if (onControl) return;
        // Synchronous inside the keydown — a trusted user gesture, so no popup blocker
        // (deferring past an await WOULD get blocked); the rowNavigation.js convention.
        window.open(googleMapsUrl(selectedRow.door), '_blank', 'noopener');
      } else if (action === 'close') {
        // The Esc ladder: an armed drag never reaches here (guard above); an open basemap
        // menu owns its own document Esc (MapStyleControl) — sit out via the MapPage ref
        // sniff so one press never does two things.
        if (styleControlRef.current?.querySelector('.animate-pop-in')) return;
        closePopup();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!tokenQ.isLoading && !tokenQ.data?.isReady) {
    return (
      <div className="p-6 text-sm text-fg-muted">
        Map is unavailable right now — Pin Fixes needs the map to place pins.
      </div>
    );
  }

  const forbidden = listQ.error?.status === 403;
  const selectedIndex = selection ? rowKeys.indexOf(selection.key) : -1;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <section
          style={{ flexShrink: 0, overflowY: 'auto' }}
          className="w-80 border-r border-border bg-card"
        >
          {placeMode ? (
            <PlaceAlongRail
              placeMode={placeMode}
              copy={movePin.clickCopy}
              saving={movePin.saving}
              error={movePin.error}
              onSkip={() => goToPlaceIndex(placeMode.index + 1)}
              onBack={() => goToPlaceIndex(placeMode.index - 1, { retry: true })}
              onPick={(i) => goToPlaceIndex(i, { retry: placeMode.placed.includes(placeMode.rows[i]?.rowKey) })}
              onResume={() => goToPlaceIndex(placeMode.index)}
              onExit={exitPlaceMode}
            />
          ) : (
            <>
              <div className="border-b border-border p-4">
                <h1 className="text-base font-semibold text-fg">Pin Fixes</h1>
                <p className="mt-1 text-xs text-fg-muted">
                  These homes need a pin check, grouped by cause below: homes sharing one spot with other
                  addresses, pins far from their street, homes the address lookup couldn&apos;t find, condo
                  complexes, and pins placed from the street address (the amber rings). Fix a group together,
                  or click a pin or a row to drag it onto the real house, or confirm it if it&apos;s already
                  right. Switch the map to <strong>Hybrid</strong> for satellite imagery.
                </p>
                <div className="mt-2 text-sm font-medium text-fg">
                  {listQ.isLoading
                    ? 'Loading…'
                    : `${total.toLocaleString()} ${total === 1 ? 'door' : 'doors'} to review${
                        complexCount > 0
                          ? ` · ${complexCount.toLocaleString()} ${complexCount === 1 ? 'complex' : 'complexes'}`
                          : ''
                      }`}
                </div>
                {cleared > 0 && (
                  <div className="mt-1.5">
                    <div className="text-xs font-medium text-fg-muted">
                      {cleared.toLocaleString()} {cleared === 1 ? 'door' : 'doors'} cleared this
                      session · {total.toLocaleString()} left
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{
                          width: `${Math.min(100, Math.round((cleared / Math.max(1, startRef.current.startTotal)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {listQ.data?.truncated && (
                  <div className="mt-1 rounded border border-warning/30 bg-warning-tint px-2 py-1 text-[11px] text-warning-fg">
                    Showing the first {rowCount.toLocaleString()} — fix or confirm these and refresh
                    for the rest.
                  </div>
                )}
                {listQ.data?.truncatedExtra && (
                  <div className="mt-1 rounded border border-warning/30 bg-warning-tint px-2 py-1 text-[11px] text-warning-fg">
                    Not every complex or set-aside home is shown — work through these and refresh for the rest.
                  </div>
                )}
              </div>

              {forbidden ? (
                <div className="p-4 text-sm text-fg-muted">
                  Only campaign admins and team leads with access to this campaign can use Pin Fixes.
                </div>
              ) : listQ.error ? (
                <div className="p-4 text-sm text-danger">{listQ.error.message || 'Could not load the queue.'}</div>
              ) : (
                <>
                  <PinFixCards
                    cards={fix.cards}
                    complexRows={fix.complexRows}
                    setAside={fix.setAside}
                    selection={selection}
                    lookupGroup={lookupJob?.group || null}
                    busy={bulkBusy || confirmBusy || movePin.armed}
                    mapReady={mapReady}
                    onAction={onCardAction}
                    onSelectComplex={selectComplex}
                    onVouchSpot={(row) => confirmLocation(row)}
                    onSpread={spreadComplex}
                    onBringBack={(h) => bringBack([String(h.id)])}
                  />
                  {scope && (
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-sunken px-4 py-2 text-xs">
                      <span className="min-w-0 truncate font-medium text-fg">
                        {scope.checking
                          ? `Checking approximate pins · ${rowKeys.length.toLocaleString()} left`
                          : `${scope.title} · ${rowKeys.length.toLocaleString()} shown`}
                      </span>
                      <button
                        type="button"
                        onClick={() => setScope(null)}
                        className="shrink-0 font-semibold text-brand-accent hover:underline"
                      >
                        Show all
                      </button>
                    </div>
                  )}
                  {!listQ.isLoading && total === 0 && complexCount === 0 ? (
                    <div className="p-4 text-sm text-fg-muted">
                      Nothing to fix — every door's pin is rooftop-accurate, hand-corrected, or
                      confirmed, and every home that shared a map spot has been placed or confirmed.
                      New imports with street-level geocodes will show up here.
                    </div>
                  ) : scope && !listQ.isLoading && rowKeys.length === 0 ? (
                    <div className="p-4 text-sm text-fg-muted">
                      {scope.checking ? 'All checked — nothing left in this group.' : 'Nothing left in this group.'}
                    </div>
                  ) : (
                    visibleGroups.map((g) => (
                      <div key={g.street}>
                        <div className="sticky top-0 border-b border-border bg-sunken px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle">
                          {g.street}
                        </div>
                        <div className="divide-y divide-border">
                          {g.rows.map((row) => {
                            const isSelected = row.rowKey === selection?.key;
                            return (
                              <div
                                key={row.rowKey}
                                ref={(el) => {
                                  if (el) rowRefs.current.set(row.rowKey, el);
                                  else rowRefs.current.delete(row.rowKey);
                                }}
                                className={isSelected ? 'bg-brand-tint/60' : undefined}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectRow(row)}
                                  className="block w-full px-4 py-2 text-left hover:bg-sunken"
                                >
                                  <div className="truncate text-sm font-medium text-fg">{row.label}</div>
                                  <div className="truncate text-xs text-fg-muted">
                                    {row.sub ? `${row.sub} · ` : ''}
                                    {row.door.city}, {row.door.state} {row.door.zipCode}
                                  </div>
                                </button>
                                {/* Inline actions belong to LIST-made selections only — a map pin
                                    click (or an advance) presents the same actions in the popup. */}
                                {isSelected && selection.source === 'list' && (
                                  <div className="flex flex-wrap gap-2 px-4 pb-3">
                                    <button
                                      type="button"
                                      onClick={() => armMove(row)}
                                      disabled={!mapReady || movePin.armed || confirmBusy}
                                      className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                                    >
                                      {row.kind === 'building' ? 'Move building pin' : 'Move pin'}
                                    </button>
                                    {confirmLabel(row) && (
                                      <button
                                        type="button"
                                        onClick={() => confirmLocation(row)}
                                        disabled={confirmBusy || movePin.armed}
                                        className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
                                      >
                                        {confirmBusy ? 'Saving…' : confirmLabel(row)}
                                      </button>
                                    )}
                                    {row.unplaced && (
                                      <button
                                        type="button"
                                        onClick={() => setAsideRows([row])}
                                        disabled={bulkBusy || confirmBusy || movePin.armed}
                                        className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
                                      >
                                        Set aside
                                      </button>
                                    )}
                                    <a
                                      href={googleMapsUrl(row.door)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
                                    >
                                      Google Maps ↗
                                    </a>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </section>

        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
          <div className="absolute left-4 top-4 z-10 flex items-start gap-2">
            {/* `contents` keeps the picker's own box untouched; the ref is how the keyboard
                Esc ladder sees its open menu (the MapPage sniff — a sibling listener cannot
                stopPropagation a document listener away). */}
            <div ref={styleControlRef} className="contents">
              <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="items-start" />
            </div>
          </div>
          {/* The action popup for a map-made selection. The MovePinCard takes this exact slot
              while a drag is armed (it self-nulls otherwise), so the two can never stack. */}
          {!movePin.armed && !placing && selection?.source === 'map' && selectedRow && (
            <PinFixPopup
              row={selectedRow}
              index={selectedIndex}
              count={rowKeys.length}
              confirmBusy={confirmBusy}
              busy={bulkBusy}
              mapReady={mapReady}
              fmtDate={fmtDate}
              onMove={() => armMove(selectedRow)}
              onConfirm={() => confirmLocation(selectedRow)}
              onSetAside={() => setAsideRows([selectedRow])}
              onSpread={() => spreadComplex(selectedRow)}
              onClose={closePopup}
              onPrev={() => {
                if (selectedIndex > 0) goToKey(rowKeys[selectedIndex - 1]);
              }}
              onNext={() => {
                if (selectedIndex >= 0 && selectedIndex < rowKeys.length - 1) goToKey(rowKeys[selectedIndex + 1]);
              }}
            />
          )}
          <MovePinCard
            copy={movePin.copy}
            error={movePin.error}
            saving={movePin.saving}
            canSave={movePin.canSave}
            onCancel={movePin.cancel}
            onSave={movePin.save}
            className="absolute right-3 top-3 z-10 w-72"
          />
          {toast && (
            <div
              className={
                'absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow ' +
                (toast.tone === 'error'
                  ? 'border-danger/30 bg-danger-tint text-danger'
                  : 'border-info/30 bg-info-tint text-info-fg')
              }
            >
              <span>{toast.text}</span>
              {toast.undo && (
                <button
                  type="button"
                  onClick={() => runUndo(toast.undo)}
                  disabled={confirmBusy || bulkBusy}
                  className="font-semibold underline disabled:opacity-60"
                >
                  Undo
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PinFixesPage;
