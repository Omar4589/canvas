import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import mapboxgl from './mapboxInit.js';
import { api } from '../api/client.js';
import { invalidateFlagCaches } from './bulkReview.js';
import {
  canSaveMove,
  isNothingMoved,
  movePinCopy,
  movePinErrorMessage,
  movePinInvalidationKeys,
  NOTHING_MOVED,
  NOTHING_PLACED,
  placeAtBody,
  placeAtCopy,
} from './movePin.js';

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
//   start({ id, addressLine1, lng, lat, scope:'unit'|'building', count, unplaced }) arms it — ignored
//   when lng/lat are not finite (a ghost door with no pin cannot be moved). `unplaced`: the door (or
//   an address unit the move carries) has no exact map spot, so Save stays off until the drag clears
//   the spot (`canSave`). A save the server answers with `moved: 0` keeps the card armed with
//   "Nothing moved" and never calls onSaved, so a page never advances past it. `armedRef` is for the
//   pages' ONCE-bound map handlers (layer clicks, the fullscreen Esc): they must read
//   `movePin.armedRef.current` at event time, never `movePin.armed`, which their closure froze.
//
// Click mode (Pin Fixes' Place along the street; docs/PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md S10.3):
//   startClick(target) arms a target with NO marker, and placeAt({ lng, lat }) — the page's one map click —
//   saves it there: the same PATCH, the target's scope, the same invalidations, then onSaved(res, target,
//   coords) with `target.mode === 'click'`. placeAt reads the target from `clickTargetRef` (assigned
//   during render AND on arming), never from a closure: the page binds its map click once, so a closed-
//   over target would PATCH the first row again on the second click. The target carries the campaign it
//   was armed under, so a click can never PATCH a door under another campaign's URL. armedRef covers both
//   modes (every once-bound page handler keeps sitting out); cancel (and Esc) clears both. `clickCopy`
//   is the rail's sentence; `copy` stays drag-only, so MovePinCard never shows in click mode.
export const useMovePin = ({ mapRef, campaignId, onSaved }) => {
  const qc = useQueryClient();
  const [target, setTarget] = useState(null); // { id, addressLine1, lng, lat, scope, count }
  const [coords, setCoords] = useState(null); // { lng, lat } from the drag
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [clickTarget, setClickTarget] = useState(null); // click mode: { ...target, mode, campaignId, retry }
  const markerRef = useRef(null);
  // Assigned during render, like MapPage's selectModeRef — the once-bound handlers read it live.
  const clickTargetRef = useRef(null);
  clickTargetRef.current = clickTarget;
  const campaignIdRef = useRef(campaignId);
  campaignIdRef.current = campaignId;
  const savingRef = useRef(false);
  const armedRef = useRef(false);
  armedRef.current = !!target || !!clickTarget;
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
    clickTargetRef.current = null;
    setClickTarget(null);
    setTarget({
      id: next.id,
      addressLine1: next.addressLine1 || '',
      lng,
      lat,
      scope: next.scope === 'building' ? 'building' : 'unit',
      count: Number(next.count) || 1,
      unplaced: !!next.unplaced,
    });
    return true;
  }, []);

  // Click mode needs no starting spot (a home at 0,0 is placed by its first click), only a door id.
  const startClick = useCallback((next, { retry = false } = {}) => {
    if (!next?.id) return false;
    const armed = {
      id: String(next.id),
      addressLine1: next.addressLine1 || '',
      lng: Number(next.lng),
      lat: Number(next.lat),
      scope: next.scope === 'building' ? 'building' : 'unit',
      count: Number(next.count) || 1,
      unplaced: !!next.unplaced,
      mode: 'click',
      retry: !!retry,
      campaignId: campaignIdRef.current,
    };
    setError(null);
    setTarget(null);
    setCoords(null);
    clickTargetRef.current = armed;
    setClickTarget(armed);
    return true;
  }, []);

  const cancel = useCallback(() => {
    setTarget(null);
    setCoords(null);
    setError(null);
    clickTargetRef.current = null;
    setClickTarget(null);
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
    if (!target && !clickTarget) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, clickTarget, cancel]);

  const save = useCallback(async () => {
    if (!target || !coords || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api(`/admin/campaigns/${campaignId}/households/${target.id}/location`, {
        method: 'PATCH',
        body: { lat: coords.lat, lng: coords.lng, scope: target.scope },
      });
      if (isNothingMoved(res)) {
        // The server moved nothing: stay armed so the admin can drag it properly.
        setError(NOTHING_MOVED);
        return;
      }
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

  // Click mode's save: the page's map click, at the clicked point. Stable (refs only), so a once-bound
  // handler may hold it. One save at a time: a second click while one is in flight is ignored.
  const placeAt = useCallback(
    async (at) => {
      const t = clickTargetRef.current;
      const body = placeAtBody(t, at);
      if (!t || savingRef.current || !Number.isFinite(body.lng) || !Number.isFinite(body.lat)) return false;
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        const res = await api(`/admin/campaigns/${t.campaignId}/households/${t.id}/location`, { method: 'PATCH', body });
        if (isNothingMoved(res)) {
          setError(NOTHING_PLACED); // stay armed on the same home: click again
          return false;
        }
        await Promise.all(movePinInvalidationKeys(t.campaignId).map((queryKey) => qc.invalidateQueries({ queryKey })));
        invalidateFlagCaches(qc);
        // Disarm only if nothing re-armed meanwhile; onSaved usually arms the next row at once.
        if (clickTargetRef.current === t) {
          clickTargetRef.current = null;
          setClickTarget(null);
        }
        onSavedRef.current?.(res, t, { lng: body.lng, lat: body.lat });
        return true;
      } catch (err) {
        setError(movePinErrorMessage(err));
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [qc]
  );

  return {
    armed: !!target,
    target,
    coords,
    copy: target ? movePinCopy(target) : null,
    canSave: canSaveMove(target, coords),
    saving,
    error,
    armedRef,
    start,
    cancel,
    save,
    clickArmed: !!clickTarget,
    clickTarget,
    clickTargetRef,
    clickCopy: clickTarget ? placeAtCopy(clickTarget) : null,
    startClick,
    placeAt,
  };
};

export default useMovePin;
