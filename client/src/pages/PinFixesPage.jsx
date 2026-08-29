import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import mapboxgl from '../lib/mapboxInit.js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { api } from '../api/client.js';
import { useMapStyle } from '../lib/mapStyles.js';
import MapStyleControl from '../components/MapStyleControl.jsx';
import MovePinCard from '../components/MovePinCard.jsx';
import { useMovePin } from '../lib/useMovePin.js';
import { movePinToast } from '../lib/movePin.js';
import {
  registerLayers,
  householdsToGeoJSON,
  buildingsToGeoJSON,
  pointToGeoJSON,
} from '../lib/mapRender.js';
import { groupHouseholds } from '../lib/buildings.js';
import {
  buildStreetGroups,
  googleMapsUrl,
  confirmToast,
  confirmErrorMessage,
  confirmInvalidationKeys,
} from '../lib/pinFixes.js';

// Both pin layers registerLayers creates — click handling has to cover BOTH or every
// apartment stack (drawn as a building glyph, its doors filtered out of the household
// layer) is unclickable. Same constant, same reason, as AnswerMiniMap.
const PIN_LAYERS = ['households-symbols', 'building-symbols'];

const DEFAULT_CENTER = [-95.7129, 37.0902];
const DEFAULT_ZOOM = 3.5;

// The action card for a map-selected pin — parked in the shared top-right corner (the
// MovePinCard / Turf-popup slot; like the Turf popups it covers the zoom buttons while open,
// a precedented trade). Presentational: the page owns selection, the actions, the advance.
const PinFixPopup = ({ row, index, count, confirmBusy, mapReady, onMove, onConfirm, onClose, onPrev, onNext }) => {
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
        <button
          type="button"
          onClick={onConfirm}
          disabled={confirmBusy}
          className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
        >
          {confirmBusy ? 'Saving…' : 'Looks right — confirm'}
        </button>
        <a
          href={googleMapsUrl(row.door)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken"
        >
          Google Maps ↗
        </a>
      </div>
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
      <div className="border-t border-border px-3 py-1 text-[10px] text-fg-subtle">
        Enter confirm · ← → next / prev · G maps · Esc close
      </div>
    </div>
  );
};

// Pin Fixes — the work queue for approximate-geocode pins (the amber rings): every active
// door whose coordinate came from a street-level match (coordConfidence 'interpolated') and
// no human has vouched for yet. Two action surfaces, one selection: a MAP pin click opens
// the top-right action popup (with Next/Prev and keyboard triage), a LIST row click expands
// that row's inline buttons — and after any completed move or confirm the page auto-advances
// to the next pin in popup mode. Lead-allowed like the Map and Turf pin tools — the server's
// requireCampaignManager gate is the wall, so this page carries no in-page role check (the
// MapPage/TurfsPage precedent).
const PinFixesPage = () => {
  const { campaignId } = useParams();
  const qc = useQueryClient();
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
  const rowRefs = useRef(new Map());
  const [toast, setToast] = useState(null); // { text, tone?, undo? }
  const [confirmBusy, setConfirmBusy] = useState(false);

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
  const households = listQ.data?.households || [];
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
  // (lib/pinFixes.js) so the shapes are unit-tested.
  const { groups, rowCount, rowKeys, idToRowKey } = useMemo(() => buildStreetGroups(households), [households]);
  useEffect(() => {
    idToRowKeyRef.current = idToRowKey;
  }, [idToRowKey]);
  const rowsByKey = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const r of g.rows) m.set(r.rowKey, r);
    return m;
  }, [groups]);
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

  // Drop a selection whose row left the queue (fixed/confirmed elsewhere, refetch, undo).
  useEffect(() => {
    if (selection && !rowsByKey.has(selection.key)) setSelection(null);
  }, [selection, rowsByKey]);

  // Map glyph grouping for the map source (same helper the row builder uses — the two must
  // agree on what a building is, and do, because both call groupHouseholds).
  const { buildings, stackedIds } = useMemo(() => groupHouseholds(households), [households]);

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

  const flyToRow = (row) => {
    if (!mapRef.current || !row) return;
    mapRef.current.flyTo({
      center: [row.lng, row.lat],
      zoom: Math.max(mapRef.current.getZoom(), 17),
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
    const candidate =
      (stash.nextKey && freshByKey.has(stash.nextKey) && stash.nextKey) ||
      (stash.prevKey && freshByKey.has(stash.prevKey) && stash.prevKey) ||
      // Never the acted row itself — belt-and-braces should the cache ever lag too.
      fresh.rowKeys.find((k) => k !== stash.actedKey) ||
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
      setToast({ text: movePinToast(target.scope, res?.moved) });
      advanceAfterAction();
    },
  });

  // ONE entry point for both Move buttons (inline row + popup): stash the neighbors only if
  // the hook actually arms — start() refuses non-finite coords, and a captured-but-not-armed
  // stash would advance after nothing.
  const armMove = (row) => {
    if (movePin.start(row.target)) captureAdvance(row.rowKey);
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
        setSelection({ key: `b:${props.key}`, source: 'map' });
      }
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
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
  useEffect(() => {
    if (mapRef.current) mapRef.current._didFitBounds = false;
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
    const geojson = householdsToGeoJSON(households, stackedIds);
    src.setData(geojson);
    mapRef.current.getSource('buildings')?.setData(buildingsToGeoJSON(buildings));
    if (!mapRef.current._didFitBounds && geojson.features.length) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const f of geojson.features) bounds.extend(f.geometry.coordinates);
      if (!bounds.isEmpty()) {
        mapRef.current.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 0 });
        mapRef.current._didFitBounds = true;
      }
    }
  }, [households, buildings, stackedIds, mapReady, styleEpoch]);

  // Blue highlight ring on the selected row's pin (the shared selected-household source).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const src = mapRef.current.getSource('selected-household');
    if (!src) return;
    src.setData(pointToGeoJSON(selectedRow ? { location: { lng: selectedRow.lng, lat: selectedRow.lat } } : null));
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

  const selectRow = (row) => {
    if (movePin.armed) return; // finish or cancel the drag first
    setSelection({ key: row.rowKey, source: 'list' });
    flyToRow(row);
  };

  const refreshVouchCaches = () =>
    Promise.all(confirmInvalidationKeys(campaignId).map((queryKey) => qc.invalidateQueries({ queryKey })));

  // Confirm in place: the pin checks out against the imagery, so vouch it without moving it.
  const confirmLocation = async (target, rowKey) => {
    if (!target || confirmBusy) return;
    captureAdvance(rowKey);
    setConfirmBusy(true);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/${target.id}/confirm-location`, {
        method: 'POST',
        body: { scope: target.scope },
      });
      await refreshVouchCaches();
      setToast({ text: confirmToast(target.scope, res?.updated), undo: { id: target.id, scope: target.scope } });
      advanceAfterAction();
    } catch (err) {
      advanceRef.current = null; // a failed confirm must never advance later
      setToast({ text: confirmErrorMessage(err), tone: 'error' });
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
      await refreshVouchCaches();
      setToast({ text: 'Confirmation undone — the pin is back in the queue.' });
    } catch (err) {
      setToast({ text: confirmErrorMessage(err), tone: 'error' });
    } finally {
      setConfirmBusy(false);
    }
  };

  // ── Keyboard triage ─────────────────────────────────────────────────────────────────────
  // Mounted ONLY while the popup is open, so map arrow-key panning returns the moment it
  // closes. CAPTURE phase + stopPropagation: mapbox's keyboard handler (bubble phase, on the
  // canvas container) pans on arrows and never checks defaultPrevented, so halting the
  // capture descent is the load-bearing call (the DoorSelectionBar convention). Enter sits
  // out on interactive targets so a focused button activates natively exactly once; Space is
  // untouched (buttons activate on Space KEYUP — the documented TurfsPage trap). No dep
  // array on purpose: the handler re-binds each render, so every closure is fresh.
  useEffect(() => {
    if (!selection || selection.source !== 'map' || !selectedRow) return undefined;
    const onKey = (e) => {
      if (movePin.armedRef.current) return; // the drag owns the keyboard (its own Esc cancels)
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      const onControl = !!(t && (t.closest?.('button, a, input, textarea, select') || t.isContentEditable));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        const keys = rowKeysRef.current;
        const i = keys.indexOf(selection.key);
        const next = e.key === 'ArrowLeft' ? keys[i - 1] : keys[i + 1];
        if (next) goToKey(next);
      } else if (e.key === 'Enter') {
        if (onControl || confirmBusy) return; // native activation must run exactly once
        confirmLocation(selectedRow.target, selectedRow.rowKey);
      } else if (e.key === 'g' || e.key === 'G') {
        if (onControl) return;
        // Synchronous inside the keydown — a trusted user gesture, so no popup blocker
        // (deferring past an await WOULD get blocked); the rowNavigation.js convention.
        window.open(googleMapsUrl(selectedRow.door), '_blank', 'noopener');
      } else if (e.key === 'Escape') {
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
          <div className="border-b border-border p-4">
            <h1 className="text-base font-semibold text-fg">Pin Fixes</h1>
            <p className="mt-1 text-xs text-fg-muted">
              These pins were placed from the street address, not the exact building (the amber
              rings). Click a pin on the map to work it from the popup — or a row here — then
              drag it to the real building, or confirm it if it already sits right. Switch the
              map to <strong>Hybrid</strong> for satellite imagery.
            </p>
            <div className="mt-2 text-sm font-medium text-fg">
              {listQ.isLoading
                ? 'Loading…'
                : `${total.toLocaleString()} ${total === 1 ? 'door' : 'doors'} to review`}
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
          </div>

          {forbidden ? (
            <div className="p-4 text-sm text-fg-muted">
              Only campaign admins and team leads with access to this campaign can use Pin Fixes.
            </div>
          ) : listQ.error ? (
            <div className="p-4 text-sm text-danger">{listQ.error.message || 'Could not load the queue.'}</div>
          ) : !listQ.isLoading && total === 0 ? (
            <div className="p-4 text-sm text-fg-muted">
              Nothing to fix — every door's pin is rooftop-accurate, hand-corrected, or
              confirmed. New imports with street-level geocodes will show up here.
            </div>
          ) : (
            groups.map((g) => (
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
                            <button
                              type="button"
                              onClick={() => confirmLocation(row.target, row.rowKey)}
                              disabled={confirmBusy || movePin.armed}
                              className="rounded-md border border-border-strong px-2.5 py-1 text-xs font-medium text-fg-muted hover:bg-sunken disabled:opacity-60"
                            >
                              {confirmBusy ? 'Saving…' : 'Looks right — confirm'}
                            </button>
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
          {!movePin.armed && selection?.source === 'map' && selectedRow && (
            <PinFixPopup
              row={selectedRow}
              index={selectedIndex}
              count={rowKeys.length}
              confirmBusy={confirmBusy}
              mapReady={mapReady}
              onMove={() => armMove(selectedRow)}
              onConfirm={() => confirmLocation(selectedRow.target, selectedRow.rowKey)}
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
                  onClick={() => undoConfirm(toast.undo)}
                  disabled={confirmBusy}
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
