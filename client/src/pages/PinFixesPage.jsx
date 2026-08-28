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

// Pin Fixes — the work queue for approximate-geocode pins (the amber rings): every active
// door whose coordinate came from a street-level match (coordConfidence 'interpolated') and
// no human has vouched for yet. The list is grouped by street; each row can be MOVED (the
// shared move-pin flow — drag the blue marker onto the real building) or CONFIRMED in place
// (the spot checks out against imagery/Google Maps), and either way it leaves the queue, the
// ring goes out everywhere, and the sidebar badge counts down. Lead-allowed like the Map and
// Turf pin tools — the server's requireCampaignManager gate is the wall, so this page carries
// no in-page role check (the MapPage/TurfsPage precedent).
const PinFixesPage = () => {
  const { campaignId } = useParams();
  const qc = useQueryClient();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const { styleId, styleURL, setStyle, dark: darkBase } = useMapStyle();
  const [styleEpoch, setStyleEpoch] = useState(0);
  const appliedStyleRef = useRef(styleURL);

  // Row selection is by rowKey ('h:<id>' | 'b:<key>'); the once-bound map click handler
  // resolves a pin to its row through this ref (it can't close over the latest memo).
  const [selectedKey, setSelectedKey] = useState(null);
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

  // Street-grouped queue rows (one row per pin — buildings collapse) + the id → row map the
  // pin-click handler reads. Pure (lib/pinFixes.js) so the shape is unit-tested.
  const { groups, rowCount, idToRowKey } = useMemo(() => buildStreetGroups(households), [households]);
  useEffect(() => {
    idToRowKeyRef.current = idToRowKey;
  }, [idToRowKey]);
  const rowsByKey = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const r of g.rows) m.set(r.rowKey, r);
    return m;
  }, [groups]);
  const selectedRow = selectedKey ? rowsByKey.get(selectedKey) || null : null;

  // Drop a selection whose row left the queue (fixed/confirmed elsewhere, refetch, undo).
  useEffect(() => {
    if (selectedKey && !rowsByKey.has(selectedKey)) setSelectedKey(null);
  }, [selectedKey, rowsByKey]);

  // Map glyph grouping for the map source (same helper the row builder uses — the two must
  // agree on what a building is, and do, because both call groupHouseholds).
  const { buildings, stackedIds } = useMemo(() => groupHouseholds(households), [households]);

  // Shared move-pin flow — declared BEFORE the map-build effect so its once-bound handlers can
  // read movePin.armedRef at event time. movePinInvalidationKeys already drops this page's
  // list and the sidebar badge, so onSaved only has to toast and release the row.
  const movePin = useMovePin({
    mapRef,
    campaignId,
    onSaved: (res, target) => {
      setToast({ text: movePinToast(target.scope, res?.moved) });
      setSelectedKey(null);
    },
  });

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
        if (rk) setSelectedKey(rk);
      } else if (props.key) {
        setSelectedKey(`b:${props.key}`);
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
      if (!hits.length) setSelectedKey(null);
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

  // Push the queue to the map. Every door here is interpolated + unconfirmed, so every pin
  // rings amber by construction. Fit once on first data.
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

  // A map-click selection should be visible in the list too.
  useEffect(() => {
    if (!selectedKey) return;
    rowRefs.current.get(selectedKey)?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);

  // Toasts clear themselves; Undo lives only as long as the toast does.
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 12000);
    return () => clearTimeout(t);
  }, [toast]);

  const selectRow = (row) => {
    if (movePin.armed) return; // finish or cancel the drag first
    setSelectedKey(row.rowKey);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [row.lng, row.lat],
        zoom: Math.max(mapRef.current.getZoom(), 17),
        duration: 600,
      });
    }
  };

  const refreshVouchCaches = () =>
    Promise.all(confirmInvalidationKeys(campaignId).map((queryKey) => qc.invalidateQueries({ queryKey })));

  // Confirm in place: the pin checks out against the imagery, so vouch it without moving it.
  const confirmLocation = async (target, rowKey) => {
    if (!target || confirmBusy) return;
    setConfirmBusy(true);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/${target.id}/confirm-location`, {
        method: 'POST',
        body: { scope: target.scope },
      });
      await refreshVouchCaches();
      // Release only the CONFIRMED row (the stale-selection effect also drops it once the
      // refetch removes it) — a different row picked while this was in flight stays selected.
      setSelectedKey((k) => (k === rowKey ? null : k));
      setToast({ text: confirmToast(target.scope, res?.updated), undo: { id: target.id, scope: target.scope } });
    } catch (err) {
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

  if (!tokenQ.isLoading && !tokenQ.data?.isReady) {
    return (
      <div className="p-6 text-sm text-fg-muted">
        Map is unavailable right now — Pin Fixes needs the map to place pins.
      </div>
    );
  }

  const forbidden = listQ.error?.status === 403;

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
              rings). Check each spot — switch the map to <strong>Hybrid</strong> or open the
              address in Google Maps — then drag the pin to the real building, or confirm it if
              it already sits right.
            </p>
            <div className="mt-2 text-sm font-medium text-fg">
              {listQ.isLoading
                ? 'Loading…'
                : `${total.toLocaleString()} ${total === 1 ? 'pin' : 'pins'} to review`}
            </div>
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
                    const isSelected = row.rowKey === selectedKey;
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
                        {isSelected && (
                          <div className="flex flex-wrap gap-2 px-4 pb-3">
                            <button
                              type="button"
                              onClick={() => movePin.start(row.target)}
                              disabled={!mapReady || movePin.armed}
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
            <MapStyleControl value={styleId} onChange={setStyle} menuDirection="down" className="items-start" />
          </div>
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
