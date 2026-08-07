// The cover map: one basemap image per packet, with the walk drawn on top.
//
// THE RULE THAT SHAPES THIS FILE: Mapbox is sent a CENTRE AND A ZOOM — a rectangle — and
// nothing else. The obvious way to build this is Mapbox's overlay syntax, which would put the
// whole route polyline in the request URL, i.e. every household's coordinates in a third
// party's access log. So the basemap is fetched plain and the route is projected and drawn
// locally in PDF vector ops. That also prints sharper than a rasterised line and keeps the
// URL short enough that a 1,200-door book can't blow the API's length limit.
//
// Mapbox is already the disclosed mapping subprocessor for the console's maps; a viewport
// rectangle is the same class of request those pages already make.

// Mapbox GL styles use 512px tiles, so the world is 512 * 2^zoom CSS pixels — the same zoom
// semantics as mapbox-gl-js, which is what makes the projection below line up with the image.
const WORLD = 512;

const mercY = (lat) => {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

const bounds = (pts) => {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of pts) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLng, minLat, maxLng, maxLat };
};

// Largest zoom whose extent still fits the image with a margin. A single door — or a whole
// book at one address — has no span to fit, so it falls back to a street-level zoom.
export const fitView = (pts, wPx, hPx, padPx = 48) => {
  const b = bounds(pts);
  const spanX = (b.maxLng - b.minLng) / 360;
  const spanY = mercY(b.minLat) - mercY(b.maxLat);
  const usableW = Math.max(32, wPx - padPx);
  const usableH = Math.max(32, hPx - padPx);
  const zx = spanX > 1e-9 ? Math.log2(usableW / (spanX * WORLD)) : 17;
  const zy = spanY > 1e-9 ? Math.log2(usableH / (spanY * WORLD)) : 17;
  return {
    lng: (b.minLng + b.maxLng) / 2,
    lat: (b.minLat + b.maxLat) / 2,
    zoom: Math.max(1, Math.min(17, Math.min(zx, zy))),
  };
};

// lng/lat -> a point inside the drawn image, in PDF units. Same maths the basemap was
// rendered with, so the route sits where the streets are.
export const makeProjector = (view, wPx, hPx, boxW, boxH) => {
  const world = WORLD * 2 ** view.zoom;
  const cx = ((view.lng + 180) / 360) * world;
  const cy = mercY(view.lat) * world;
  const sx = boxW / wPx;
  const sy = boxH / hPx;
  return (lng, lat) => ({
    x: (wPx / 2 + (((lng + 180) / 360) * world - cx)) * sx,
    y: (hPx / 2 + (mercY(lat) * world - cy)) * sy,
  });
};

// Re-rendering on every knob turn must not re-hit Mapbox. Keyed on what actually changes the
// image; a settings change that doesn't move the map reuses the bytes.
const cache = new Map();

const toJpegDataUrl = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  // Mapbox returns PNG for vector styles; a basemap re-encodes to JPEG at a fraction of the
  // size, which matters when a print run carries one of these per book.
  return canvas.toDataURL('image/jpeg', 0.82);
};

// Returns null — never throws — when there is no token, no geometry, no network, or no DOM.
// A missing map must cost the packet nothing but the map.
export const fetchCoverMap = async ({ doors, token, boxW, boxH, cacheKey }) => {
  if (!token || typeof document === 'undefined' || typeof fetch !== 'function') return null;
  const pts = (doors || []).filter((d) => Number.isFinite(d?.lng) && Number.isFinite(d?.lat));
  if (pts.length < 2) return null;

  const wPx = 700;
  const hPx = Math.round((boxH / boxW) * wPx);
  const key = `${cacheKey}:${wPx}x${hPx}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    return hit && { ...hit, project: makeProjector(hit.view, wPx, hPx, boxW, boxH) };
  }

  const view = fitView(pts, wPx, hPx);
  // light-v11 is the muted basemap: legible under an overlay and it doesn't flood a page with
  // toner. Attribution and logo stay ON — Mapbox's terms require them on a static image.
  const url =
    `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/` +
    `${view.lng.toFixed(6)},${view.lat.toFixed(6)},${view.zoom.toFixed(2)},0/` +
    `${wPx}x${hPx}@2x?access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`static map ${res.status}`);
    const dataUrl = await toJpegDataUrl(await res.blob());
    const entry = { dataUrl, view };
    cache.set(key, entry);
    return { ...entry, project: makeProjector(view, wPx, hPx, boxW, boxH) };
  } catch {
    cache.set(key, null); // don't retry a dead token on every keystroke
    return null;
  }
};
