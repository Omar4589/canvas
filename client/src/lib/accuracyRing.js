// Faint accuracy circles for RECORDED stamps on the admin maps (docs/PROPOSAL_GPS_UPGRADES.md §H.4):
// each ping and flag gets a true-scale circle the size of the accuracy its phone reported when the
// door was recorded. Context, never a target: no layer that draws these may take a click, and a
// circle is a guide, not a boundary (on Android the radius is a 68 % one, so one honest stamp in
// three lies outside its own circle). Not the canvasser's live dot, which gets the map engine's own
// ring (§F.2). No imports, so the phone's copy can be byte-identical.

export const EARTH_RADIUS_M = 6371000; // the server's haversine radius (utils/normalizeAddress.js)
export const ACCURACY_RING_VERTICES = 64;
export const ACCURACY_RING_MAX_M = 250; // = GPS_ACCURACY_BAD_M; a wider circle would cover the street
export const ACCURACY_RING_CAP = 500;
export const ACCURACY_RING_MIN_ZOOM = 13; // below this even a 250 m circle is smaller than its dot
export const RINGS_WITHHELD_NOTE = 'Too many locations on screen to draw accuracy circles — zoom in.';

const EMPTY = { type: 'FeatureCollection', features: [] };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// The radius to draw, or null: an unusable accuracy (null, zero, negative, not finite) draws
// nothing, and neither does one wider than ACCURACY_RING_MAX_M (the panels say so instead).
export const ringRadiusM = (accuracy) =>
  Number.isFinite(accuracy) && accuracy > 0 && accuracy <= ACCURACY_RING_MAX_M ? accuracy : null;

// A closed, counter-clockwise ring of `vertices` points at `radiusM` around (lng, lat), from the
// great-circle destination formula. Longitudes are left unwrapped, so a circle at the antimeridian
// never spans the globe. Null for bad input.
export const geodesicCircle = (lng, lat, radiusM, vertices = ACCURACY_RING_VERTICES) => {
  if (![lng, lat, radiusM].every(Number.isFinite) || radiusM <= 0 || Math.abs(lat) > 90) return null;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lng * Math.PI) / 180;
  const delta = radiusM / EARTH_RADIUS_M;
  const ring = [];
  for (let i = 0; i < vertices; i += 1) {
    const theta = (-2 * Math.PI * i) / vertices;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 =
      lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
    ring.push([round6((lambda2 * 180) / Math.PI), round6((phi2 * 180) / Math.PI)]);
  }
  ring.push(ring[0]);
  return ring;
};

// The stamps to circle, flags first: a stamp drawn as both a ping and a flag gets one circle, in
// its flag colour. Pings are coloured by colorForAction(actionType). Works on the web's ping ids
// (activityId) and the phone's (id).
export const ringInputsFromPoints = (pingFC, flagFC, colorForAction) => {
  const out = [];
  const flagged = new Set();
  for (const f of flagFC?.features || []) {
    const p = f.properties || {};
    if (p.accuracy == null) continue;
    const [lng, lat] = f.geometry.coordinates;
    flagged.add(String(p.actionId));
    out.push({ id: `flag-${p.actionId}`, lng, lat, accuracy: p.accuracy, color: p.color, reviewed: p.reviewed ? 1 : 0 });
  }
  for (const f of pingFC?.features || []) {
    const p = f.properties || {};
    const id = String(p.activityId ?? p.id);
    if (p.accuracy == null || flagged.has(id)) continue;
    const [lng, lat] = f.geometry.coordinates;
    out.push({ id: `ping-${id}`, lng, lat, accuracy: p.accuracy, color: colorForAction(p.actionType), reviewed: 0 });
  }
  return out;
};

// The view widened on every side, rounded so a sub-pixel move keeps the same key. A circle whose
// centre is just off-screen is still drawn, so it doesn't pop in on a small pan.
export const padBounds = ({ w, s, e, n }, frac = 0.25, minDeg = 0.003) => {
  if (![w, s, e, n].every(Number.isFinite)) return null;
  const padLng = Math.max((e - w) * frac, minDeg);
  const padLat = Math.max((n - s) * frac, minDeg);
  const r = (x) => Math.round(x * 1e4) / 1e4;
  const b = { w: r(w - padLng), s: r(s - padLat), e: r(e + padLng), n: r(n + padLat) };
  return { ...b, key: `${b.w},${b.s},${b.e},${b.n}` };
};

// The circles' camera after a move: the zoom and the padded view, or `prev` itself when neither
// changed, so a move that ends where it started redraws nothing. Called on EVERY moveend, never from
// a handler that skips moves inside its last fetch box: each zoom-in is one of those.
export const nextRingView = (prev, zoom, view) => {
  const bounds = padBounds(view);
  return prev?.zoom === zoom && prev?.bounds?.key === bounds?.key ? prev : { zoom, bounds };
};

// The circles for the stamps inside `bounds` at `zoom`. Below ACCURACY_RING_MIN_ZOOM, an empty set
// (the layer's own minzoom hides circles, but not their polygons; this keeps them off the wire). More
// eligible stamps than `cap` draws none and says so (`withheld`), because a partial set would read as
// "no circle = a perfect fix".
export const accuracyRingsGeoJSON = (inputs, { bounds = null, zoom = null, cap = ACCURACY_RING_CAP } = {}) => {
  if (!Number.isFinite(zoom) || zoom < ACCURACY_RING_MIN_ZOOM) return { fc: EMPTY, withheld: false, count: 0 };
  const inView = (x) => !bounds || (x.lng >= bounds.w && x.lng <= bounds.e && x.lat >= bounds.s && x.lat <= bounds.n);
  const eligible = (inputs || []).filter((x) => ringRadiusM(x.accuracy) != null && inView(x));
  if (eligible.length > cap) return { fc: EMPTY, withheld: true, count: eligible.length };
  const features = [];
  for (const x of eligible) {
    const ring = geodesicCircle(x.lng, x.lat, ringRadiusM(x.accuracy));
    if (!ring) continue;
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { id: x.id, color: x.color, reviewed: x.reviewed } });
  }
  return { fc: { type: 'FeatureCollection', features }, withheld: false, count: features.length };
};
