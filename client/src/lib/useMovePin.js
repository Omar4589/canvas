import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import mapboxgl from './mapboxInit.js';
import { api } from '../api/client.js';
import { invalidateFlagCaches } from './bulkReview.js';
import { movePinCopy, movePinErrorMessage, movePinInvalidationKeys } from './movePin.js';

// "Move pin" mode, shared by the Map page and the Turf Cutting page: a draggable blue marker
// dropped at the door's current spot, Save PATCHes the new location, and every cache a moved
// pin can stale is dropped (movePin.js owns that list + the copy). One hook so both pages
// behave the same — same endpoint, same provenance, same refresh.
//
//   const movePin = useMovePin({ mapRef, campaignId, onSaved });
//
//   mapRef      — ref holding the mapbox-gl Map (null until it exists)
//   campaignId  — the route's campaign
//   onSaved     — (res, target, coords) => void, after the caches are dropped and before reset
//
// Returns { armed, target, coords, copy, saving, error, armedRef, start, cancel, save }.
//   start({ id, addressLine1, lng, lat, scope:'unit'|'building', count }) arms it — ignored when
//   lng/lat are not finite (a ghost door with no pin cannot be moved). `armedRef` is for the
//   pages' ONCE-bound map handlers (layer clicks, the fullscreen Esc): they must read
//   `movePin.armedRef.current` at event time, never `movePin.armed`, which their closure froze.
export const useMovePin = ({ mapRef, campaignId, onSaved }) => {
  const qc = useQueryClient();
  const [target, setTarget] = useState(null); // { id, addressLine1, lng, lat, scope, count }
  const [coords, setCoords] = useState(null); // { lng, lat } from the drag
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const markerRef = useRef(null);
  // Assigned during render, like MapPage's selectModeRef — the once-bound handlers read it live.
  const armedRef = useRef(false);
  armedRef.current = !!target;
  // Latest callback, read at save time, so the pages never re-bind anything to pass a fresh one.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const start = useCallback((next) => {
    const lng = Number(next?.lng);
    const lat = Number(next?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    setError(null);
    setTarget({
      id: next.id,
      addressLine1: next.addressLine1 || '',
      lng,
      lat,
      scope: next.scope === 'building' ? 'building' : 'unit',
      count: Number(next.count) || 1,
    });
    return true;
  }, []);

  const cancel = useCallback(() => {
    setTarget(null);
    setCoords(null);
    setError(null);
  }, []);

  // Drop a draggable marker at the target's current spot; the drag updates coords.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !target) return undefined;
    const at = [target.lng, target.lat];
    setCoords({ lng: at[0], lat: at[1] });
    const marker = new mapboxgl.Marker({ draggable: true, color: '#2563eb' }).setLngLat(at).addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLngLat();
      setCoords({ lng: ll.lng, lat: ll.lat });
    });
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
  }, [mapRef, target]);

  // Esc cancels while armed. The pages' own Esc handlers (fullscreen, the Turf Esc ladder)
  // read armedRef and sit this press out, so one Esc never also drops the map out of fullscreen.
  useEffect(() => {
    if (!target) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, cancel]);

  const save = useCallback(async () => {
    if (!target || !coords || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/${target.id}/location`, {
        method: 'PATCH',
        body: { lat: coords.lat, lng: coords.lng, scope: target.scope },
      });
      // Awaited, so the card reads "Saving…" until the dots (and the re-hulled outlines) have
      // actually refetched — the marker and the old dot never overlap for a beat.
      await Promise.all(movePinInvalidationKeys(campaignId).map((queryKey) => qc.invalidateQueries({ queryKey })));
      invalidateFlagCaches(qc); // a far-from-house flag is re-assessed live against the new spot
      onSavedRef.current?.(res, target, coords);
      setTarget(null);
      setCoords(null);
    } catch (err) {
      setError(movePinErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [target, coords, saving, campaignId, qc]);

  return {
    armed: !!target,
    target,
    coords,
    copy: target ? movePinCopy(target) : null,
    saving,
    error,
    armedRef,
    start,
    cancel,
    save,
  };
};

export default useMovePin;
