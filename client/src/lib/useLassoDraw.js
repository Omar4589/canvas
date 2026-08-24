import { useCallback, useEffect, useRef, useState } from 'react';
import { SELECTION_MARK_COLOR, SELECTION_SKIP_COLOR } from './mapRender.js';

// The rubber band half of "Select doors": it owns the pointer drag, draws the shape on the map,
// and hands the finished ring back in lng/lat. It decides NOTHING about doors — lassoSelect.js
// hit-tests, the page owns the selection.
//
//   const { drawing, cancelDrag } = useLassoDraw({ map, enabled, tool, spaceHeld, onRing });
//
//   map        — the mapbox-gl Map (null until it exists)
//   enabled    — select mode is on
//   tool       — 'lasso' (freehand) | 'box' | 'pan' (drag pans; nothing is drawn)
//   spaceHeld  — Space is down: pan without leaving the mode
//   onRing     — (ring, { mode, tool }) => void, ring = [[lng, lat], …] (unclosed),
//                mode = 'add' | 'subtract' (Option/Alt held at either end of the drag)
//
// The ring comes back in lng/lat rather than pixels because that is the space the doors already
// live in — projecting 50k doors per lasso to hit-test in screen space would cost more than the
// whole drag. A box is densified into ~64 vertices for the same reason it must be: under a bearing
// or pitch the four screen corners unproject to a curved quad, and four points would cut the wrong
// doors at the edges.
//
// Clicks: a drag under the 3 px threshold is left alone, so a real tap still reaches the pages'
// existing layer handlers. A COMPLETED drag is not, because mapbox synthesizes its `click` from the
// distance between mousedown and the click POINT rather than the length of the path
// (MapEventHandler.click, `clickTolerance: 3`) — a freehand loop drawn back to where it started
// releases within 3 px and would fire one, toggling the door under the release point straight back
// out of the shape that just took it. So the hook eats exactly that one click, in the capture phase
// on the canvas container and therefore ahead of mapbox's own bubble listener there. Same trick
// mapbox's own suppressClick() uses after its drags; pages need no guard of their own.

const DRAG_THRESHOLD_PX = 3; // mapbox-gl's own clickTolerance default — keep them equal
const SAMPLE_MIN_PX = 2; // freehand points closer than this add vertices, not shape
const BOX_SEGMENTS = 16; // per edge → a 64-vertex ring

const SRC = 'lasso-draw';
const FILL_LAYER = 'lasso-draw-fill';
const LINE_LAYER = 'lasso-draw-line';

// The band wears the same two hexes as the rings the drag is about to produce, from the one place
// they are declared (mapRender.js) — re-tinting the rings must never leave the band on the old
// color. Blue matches the selection ring; slate is the restricted slate, so an Option-drag reads as
// "taking these back out".
const ADD_COLOR = SELECTION_MARK_COLOR;
const SUBTRACT_COLOR = SELECTION_SKIP_COLOR;

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Restore an interaction handler to EXACTLY what it was. Never a blind `.enable()`: MapboxDraw
// disables boxZoom on the Turf Cutting page, and handing it back would be a silent regression.
const restoreHandler = (handler, wasEnabled) => {
  if (!handler) return;
  if (wasEnabled) handler.enable();
  else handler.disable();
};

export const useLassoDraw = ({ map, enabled = false, tool = 'lasso', spaceHeld = false, onRing }) => {
  const [drawing, setDrawing] = useState(false);
  const dragRef = useRef(null); // the live drag, or null
  const rafRef = useRef(0);
  const controlsRef = useRef(null); // the dragPan/boxZoom/doubleClickZoom snapshot
  const colorRef = useRef(ADD_COLOR);
  const onRingRef = useRef(onRing);
  const toolRef = useRef(tool);
  const panRef = useRef(false);

  // Latest-value refs, read inside pointer handlers at event time (never from a memo during
  // render), so the listeners can bind once for the whole mode instead of on every keystroke.
  useEffect(() => {
    onRingRef.current = onRing;
  }, [onRing]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Space (or the Pan tool) hands the drag back to the map.
  const panMode = spaceHeld || tool === 'pan';
  useEffect(() => {
    // In a ref as well as a dep: holding Space must not re-bind the pointer listener (which would
    // tear down the band's layers on every press) — the handler reads the live value instead.
    panRef.current = panMode;
  }, [panMode]);

  // A style swap wipes custom sources/layers, so this is asked every frame rather than once.
  // Throws mid-swap (mapbox refuses to add to a style that is not done loading) — setBand catches
  // it and the next frame tries again.
  const ensureLayers = useCallback(() => {
    if (!map) return false;
    if (map.getSource(SRC)) return true;
    map.addSource(SRC, { type: 'geojson', data: EMPTY_FC });
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SRC,
      paint: { 'fill-color': colorRef.current, 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SRC,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': colorRef.current, 'line-width': 2, 'line-dasharray': [2, 1.5] },
    });
    return true;
  }, [map]);

  const removeLayers = useCallback(() => {
    if (!map) return;
    try {
      if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
      if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
      if (map.getSource(SRC)) map.removeSource(SRC);
    } catch {
      // The map was torn down (or its style swapped) between the last frame and this cleanup —
      // there is nothing left to remove, and throwing here would take the page's unmount with it.
    }
  }, [map]);

  const paintBand = useCallback(
    (color) => {
      colorRef.current = color;
      if (!map || !map.getLayer(LINE_LAYER)) return;
      map.setPaintProperty(LINE_LAYER, 'line-color', color);
      map.setPaintProperty(FILL_LAYER, 'fill-color', color);
    },
    [map]
  );

  // The drag's current shape, in lng/lat.
  const ringFor = useCallback(
    (drag) => {
      if (!map) return null;
      const pts = [];
      if (drag.tool === 'box') {
        const { start, last } = drag;
        // Walk the four screen corners, densifying each edge: a straight line in pixels is a curve
        // in lng/lat the moment the map is rotated or pitched.
        const corners = [
          [start.x, start.y],
          [last.x, start.y],
          [last.x, last.y],
          [start.x, last.y],
        ];
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % corners.length];
          for (let s = 0; s < BOX_SEGMENTS; s++) {
            const t = s / BOX_SEGMENTS;
            const ll = map.unproject([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
            pts.push([ll.lng, ll.lat]);
          }
        }
      } else {
        for (let i = 0; i < drag.px.length; i++) {
          const ll = map.unproject([drag.px[i].x, drag.px[i].y]);
          pts.push([ll.lng, ll.lat]);
        }
      }
      return pts.length >= 3 ? pts : null;
    },
    [map]
  );

  const setBand = useCallback(
    (ring) => {
      if (!map) return;
      try {
        // Clearing never CREATES the band — a plain click (no drag) must not leave two layers
        // behind on a map that was only ever tapped.
        if (!ring) {
          const existing = map.getSource(SRC);
          if (existing) existing.setData(EMPTY_FC);
          return;
        }
        if (!ensureLayers()) return;
        const src = map.getSource(SRC);
        if (src) {
          src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
          });
        }
      } catch {
        // The style is mid-swap, or the map was torn down between this frame and the last. The
        // band is feedback, not state: the next frame redraws it, and the drag is unaffected.
      }
    },
    [map, ensureLayers]
  );

  const flush = useCallback(() => {
    rafRef.current = 0;
    const drag = dragRef.current;
    if (!map) return;
    setBand(drag && drag.moved ? ringFor(drag) : null);
  }, [map, setBand, ringFor]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  // Eat the one click a completed drag synthesizes (see the header note). Capture phase on the
  // canvas container runs ahead of mapbox's own bubble listener there, so the map never fires a
  // `click` at all — and a DOM marker's own handler (the Turf page's building glyphs) never fires
  // either. Self-clearing on a zero timeout, which lands after the synchronous
  // pointerup → mouseup → click burst and so can never outlive the drag that armed it.
  const eatClickRef = useRef(null); // { el, fn, timer } while one is armed

  const clearEatClick = useCallback(() => {
    const armed = eatClickRef.current;
    if (!armed) return;
    eatClickRef.current = null;
    clearTimeout(armed.timer);
    armed.el.removeEventListener('click', armed.fn, true);
  }, []);

  const eatNextClick = useCallback(() => {
    if (!map) return;
    clearEatClick();
    const el = map.getCanvasContainer();
    if (!el) return;
    const fn = (ev) => {
      ev.stopPropagation();
      clearEatClick();
    };
    const armed = { el, fn, timer: setTimeout(clearEatClick, 0) };
    eatClickRef.current = armed;
    el.addEventListener('click', fn, true);
  }, [map, clearEatClick]);

  // Every listener a live drag owns, in one place, so ending it can never leak one.
  const detachDragListeners = useCallback((drag) => {
    if (!drag || !drag.handlers) return;
    const { move, up, cancel, key, blur } = drag.handlers;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', blur);
    drag.handlers = null;
  }, []);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    detachDragListeners(drag);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setBand(null);
    setDrawing(false);
    return drag;
  }, [detachDragListeners, setBand]);

  // Abandon a drag in progress without selecting anything. Returns whether there WAS one — the
  // page's Esc ladder reads that return value ("cancel the drag, else leave select mode") rather
  // than the `drawing` state, which its keydown closure would have captured a render too early.
  const cancelDrag = useCallback(() => {
    if (!dragRef.current) return false;
    endDrag();
    return true;
  }, [endDrag]);

  const onPointerDown = useCallback(
    (e) => {
      if (!map || dragRef.current) return;
      // Mouse and pen only. A touch drag stays the map's pan: there is no way to hold Space or
      // Option on a phone, and this feature is web-console-only by design.
      if (e.pointerType === 'touch') return;
      if (e.button !== 0) return; // right/middle keep the context menu and drag-rotate
      if (e.ctrlKey) return; // ctrl-drag is mapbox's pitch/rotate (and a macOS right-click)
      if (panRef.current || toolRef.current === 'pan') return;

      // Measured against the canvas CONTAINER because that is the origin map.unproject() expects.
      const rect = map.getCanvasContainer().getBoundingClientRect();
      const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const drag = {
        pointerId: e.pointerId,
        rect,
        start,
        last: start,
        px: [start],
        moved: false,
        subtract: e.altKey === true,
        tool: toolRef.current === 'box' ? 'box' : 'lasso',
        handlers: null,
      };

      const pointOf = (ev) => ({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });

      const move = (ev) => {
        if (ev.pointerId != null && ev.pointerId !== drag.pointerId) return;
        const p = pointOf(ev);
        drag.last = p;
        if (!drag.moved) {
          // Under the threshold this is still a click: leave it to the map's own synthesis so the
          // page's layer handler can toggle the door under the cursor.
          if (Math.hypot(p.x - start.x, p.y - start.y) < DRAG_THRESHOLD_PX) return;
          drag.moved = true;
          setDrawing(true);
        }
        if (drag.tool === 'lasso') {
          const prev = drag.px[drag.px.length - 1];
          if (Math.hypot(p.x - prev.x, p.y - prev.y) < SAMPLE_MIN_PX) return;
          drag.px.push(p);
        }
        schedule();
      };

      const up = (ev) => {
        if (ev.pointerId != null && ev.pointerId !== drag.pointerId) return;
        const p = pointOf(ev);
        drag.last = p;
        if (drag.moved && drag.tool === 'lasso') drag.px.push(p);
        const finished = drag.moved ? ringFor(drag) : null;
        // Option at either end of the drag subtracts — pressed before the drag or during it.
        const mode = drag.subtract || ev.altKey === true ? 'subtract' : 'add';
        const usedTool = drag.tool;
        const moved = drag.moved;
        endDrag();
        // Armed BEFORE onRing: an onRing that throws must not leave the click behind to undo the
        // selection it just made.
        if (moved) eatNextClick();
        if (finished && onRingRef.current) onRingRef.current(finished, { mode, tool: usedTool });
      };

      const cancel = () => endDrag();
      const blur = () => endDrag();
      const key = (ev) => {
        if (ev.key !== 'Escape') return;
        // Capture phase + stopPropagation so Esc mid-drag cancels the DRAG and nothing else — the
        // page's own Esc handler (which leaves select mode) never sees this one.
        ev.preventDefault();
        ev.stopPropagation();
        endDrag();
      };

      drag.handlers = { move, up, cancel, key, blur };
      dragRef.current = drag;
      paintBand(drag.subtract ? SUBTRACT_COLOR : ADD_COLOR);
      // move/up live on the WINDOW, not the canvas: a lasso that runs off the map edge (over the
      // sidebar, or out of the browser) must still track and still finish.
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key, true);
      window.addEventListener('blur', blur);
    },
    [map, schedule, ringFor, endDrag, paintBand, eatNextClick]
  );

  // Snapshot the map's own gestures on entry and hand them back untouched on exit.
  useEffect(() => {
    if (!map || !enabled) return undefined;
    const snap = {
      dragPan: map.dragPan.isEnabled(),
      boxZoom: map.boxZoom.isEnabled(),
      doubleClickZoom: map.doubleClickZoom.isEnabled(),
    };
    controlsRef.current = snap;
    map.boxZoom.disable(); // shift-drag box zoom would fight the lasso
    map.doubleClickZoom.disable(); // a fast double toggle must not zoom the map out from under it
    return () => {
      controlsRef.current = null;
      restoreHandler(map.dragPan, snap.dragPan);
      restoreHandler(map.boxZoom, snap.boxZoom);
      restoreHandler(map.doubleClickZoom, snap.doubleClickZoom);
    };
  }, [map, enabled]);

  // Space / the Pan tool gives dragPan back for as long as it is held. Declared AFTER the
  // snapshot effect so `controlsRef` is already filled on the render that turns the mode on.
  useEffect(() => {
    if (!map || !enabled) return undefined;
    if (panMode) {
      const snap = controlsRef.current;
      cancelDrag(); // a half-drawn shape when the hand takes over would finish somewhere random
      restoreHandler(map.dragPan, snap ? snap.dragPan : true);
    } else {
      map.dragPan.disable();
    }
    return undefined;
  }, [map, enabled, panMode, cancelDrag]);

  // The one place the pointer listener and everything a drag can leave behind is torn down.
  useEffect(() => {
    if (!map || !enabled) return undefined;
    // The canvas CONTAINER, not the canvas: mapbox appends DOM markers to it, ABOVE the canvas, and
    // the Turf page draws every building glyph as one — a drag starting on top of a glyph would
    // never reach the canvas and so would never start. Same origin, so the drag math is unchanged.
    const el = map.getCanvasContainer();
    if (!el) return undefined;
    el.addEventListener('pointerdown', onPointerDown);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      cancelDrag();
      clearEatClick();
      removeLayers();
    };
  }, [map, enabled, onPointerDown, cancelDrag, clearEatClick, removeLayers]);

  // Both pages swap basemaps at runtime, which wipes every custom source and layer. The band only
  // exists during a drag, so re-add it only when one is live; otherwise the next drag builds it.
  useEffect(() => {
    if (!map || !enabled) return undefined;
    const onStyle = () => {
      if (!dragRef.current) return;
      paintBand(colorRef.current);
      schedule();
    };
    map.on('style.load', onStyle);
    return () => {
      map.off('style.load', onStyle);
    };
  }, [map, enabled, paintBand, schedule]);

  return { drawing, cancelDrag };
};

export default useLassoDraw;
