import mapboxgl from 'mapbox-gl';

// Single import point for Mapbox GL on the web (admin console maps AND public shared-report pages).
//
// ⚠️ READ THIS BEFORE WRITING A PRIVACY POLICY SENTENCE ABOUT ANALYTICS. This is a BEST-EFFORT attempt
// to suppress Mapbox's usage beacons (events.mapbox.com: a "turnstile" event and a map-load event). On
// mapbox-gl-js v3 the events endpoint is derived internally and blanking `config.EVENTS_URL` does NOT
// reliably stop the beacons — treat this as harm-reduction, not a guarantee.
//
// More importantly, even a perfect beacon mute would NOT make Mapbox absent as a data recipient: drawing
// a map necessarily fetches tiles, styles, fonts and sprites from api.mapbox.com, and on a per-address
// report map the request bounding box / coordinates disclose the location being viewed. So Mapbox
// receives the viewer's IP and viewport whenever a map renders.
//
// CONCLUSION for the policy: do NOT claim "no third-party analytics or tracking" for pages that render a
// map. Mapbox MUST be disclosed as a mapping subprocessor that receives viewer IP and viewport. See
// docs/PRIVACY_VERIFICATION.md.
try {
  if (mapboxgl.config) {
    mapboxgl.config.EVENTS_URL = null;
    if ('SESSION_PATH' in mapboxgl.config) mapboxgl.config.SESSION_PATH = null;
  }
} catch {
  // Internal config shape changed — fail open to a working map rather than crash.
}

export default mapboxgl;
