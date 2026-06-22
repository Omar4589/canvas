// Approximate per-state bounding boxes [minLat, maxLat, minLng, maxLng], padded a
// little so legitimate points are never falsely rejected. This is a cheap,
// provider-agnostic SANITY gate on every geocode: it catches the highest-consequence,
// count-invisible failures — a lat/lng swap (a FL point landing in the ocean / wrong
// hemisphere) and gross mis-geocodes (a FL row resolving to TX) — BEFORE the point is
// cached or written to a door. It is insurance, not precision; unknown state codes
// fail OPEN (return true) so we never reject a valid point for lack of a box.
const STATE_BOUNDS = {
  AL: [30.0, 35.1, -88.6, -84.8], AK: [51.0, 71.6, -179.9, -129.0], AZ: [31.2, 37.1, -114.9, -108.9],
  AR: [32.9, 36.6, -94.7, -89.5], CA: [32.4, 42.1, -124.6, -114.0], CO: [36.9, 41.1, -109.1, -101.9],
  CT: [40.9, 42.1, -73.8, -71.7], DE: [38.4, 39.9, -75.8, -74.9], DC: [38.7, 39.1, -77.2, -76.8],
  FL: [24.3, 31.1, -87.7, -79.9], GA: [30.3, 35.1, -85.7, -80.7], HI: [18.8, 22.3, -160.3, -154.7],
  ID: [41.9, 49.1, -117.3, -110.9], IL: [36.9, 42.6, -91.6, -87.3], IN: [37.7, 41.9, -88.1, -84.7],
  IA: [40.3, 43.6, -96.7, -90.0], KS: [36.9, 40.1, -102.1, -94.5], KY: [36.4, 39.2, -89.7, -81.9],
  LA: [28.8, 33.1, -94.1, -88.7], ME: [42.9, 47.6, -71.2, -66.8], MD: [37.8, 39.8, -79.6, -74.9],
  MA: [41.1, 42.9, -73.6, -69.8], MI: [41.6, 48.4, -90.5, -82.3], MN: [43.4, 49.5, -97.3, -89.4],
  MS: [29.9, 35.1, -91.7, -88.0], MO: [35.9, 40.7, -95.8, -88.9], MT: [44.3, 49.1, -116.2, -103.9],
  NE: [39.9, 43.1, -104.1, -95.2], NV: [34.9, 42.1, -120.1, -113.9], NH: [42.6, 45.4, -72.6, -70.5],
  NJ: [38.8, 41.4, -75.6, -73.8], NM: [31.2, 37.1, -109.1, -102.9], NY: [40.4, 45.1, -79.8, -71.7],
  NC: [33.7, 36.6, -84.4, -75.4], ND: [45.8, 49.1, -104.1, -96.5], OH: [38.3, 42.1, -84.9, -80.4],
  OK: [33.6, 37.1, -103.1, -94.4], OR: [41.9, 46.4, -124.6, -116.4], PA: [39.6, 42.4, -80.6, -74.6],
  RI: [41.0, 42.1, -71.9, -71.0], SC: [31.9, 35.3, -83.4, -78.4], SD: [42.4, 46.0, -104.1, -96.4],
  TN: [34.9, 36.8, -90.4, -81.5], TX: [25.7, 36.6, -106.8, -93.4], UT: [36.9, 42.1, -114.1, -108.9],
  VT: [42.6, 45.1, -73.5, -71.4], VA: [36.5, 39.5, -83.8, -75.1], WA: [45.5, 49.1, -124.9, -116.8],
  WV: [37.1, 40.7, -82.7, -77.6], WI: [42.4, 47.4, -92.9, -86.7], WY: [40.9, 45.1, -111.1, -103.9],
  PR: [17.8, 18.6, -67.4, -65.1],
};

export function inStateBounds(state, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const b = STATE_BOUNDS[String(state || '').trim().toUpperCase()];
  if (!b) return true; // unknown state/territory → fail open (insurance, not a gate)
  return lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3];
}
