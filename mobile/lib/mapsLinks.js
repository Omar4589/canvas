// Per-house "Directions" hand-off to whichever maps app the canvasser uses.
// Pure — no React, no Linking — so node --test can pin every URL.
//
// THE ADDRESS, NEVER THE PIN. The canvasser's reason for wanting this is "in case the
// pin is in the wrong location": a coordinate link would faithfully route them to our
// own possibly-wrong spot, which is the bug, not the fix. Sending the address makes the
// maps app geocode it independently — the second opinion they actually asked for. Same
// call, same reason, as the web console's Pin Fixes link (client/src/lib/pinFixes.js);
// keep the two joins in sync.
//
// OPEN, NEVER PROBE. Every consumer must call Linking.openURL(url).catch(fallback) and
// must NEVER gate on Linking.canOpenURL: the probe needs native config this app does not
// have (iOS LSApplicationQueriesSchemes; Android <queries> beyond https), so it would
// answer false for geo:/waze:// today, and adding that config moves BOTH fingerprints =
// four new store builds. openURL itself needs nothing (iOS `open` is exempt by
// documentation; Android startActivity is exempt from package visibility). Apple has
// since deprecated canOpenURL outright. See docs/LOCK_SCREEN_AND_DIRECTIONS.md § B.

// "845 Collier Ct, Kissimmee, FL 34741" — mirrors pinFixes.js googleMapsUrl's join
// exactly (line1, city, "ST zip"), dropping whatever the voter file didn't have.
export function addressQuery(h = {}) {
  const stateZip = `${h.state || ''} ${h.zipCode || ''}`.trim();
  return [h.addressLine1, h.city, stateZip].filter(Boolean).join(', ');
}

const enc = (h) => encodeURIComponent(addressQuery(h));

// Cross-platform. Opens the Google Maps app when it's installed and enabled (an iOS
// universal link / an Android verified App Link), and Google Maps in the browser
// otherwise — so this one is never a dead end, which is what makes it the fallback.
export const googleDirectionsUrl = (h) =>
  `https://www.google.com/maps/dir/?api=1&destination=${enc(h)}&travelmode=walking`;

// The web console's exact URL. Used as the universal fallback when a chosen app
// refuses to open (nothing registered for its scheme).
export const googleSearchUrl = (h) => `https://www.google.com/maps/search/?api=1&query=${enc(h)}`;

// Apple Maps, the legacy parameter form, deliberately on every iOS version. Apple's own
// server 301-rewrites it to the documented unified /directions?mode=walking&destination=…
// form, and the unified form is documented only for iOS 18.4+ — so the legacy URL is the
// single one that works everywhere, and there is no OS-version branch to get wrong.
export const appleDirectionsUrl = (h) => `https://maps.apple.com/?daddr=${enc(h)}&dirflg=w`;

export const wazeUrl = (h) => `https://waze.com/ul?q=${enc(h)}&navigate=yes`;

// Android only: hand the address to whatever app registers geo: (Google Maps, Waze, …).
// `geo:0,0?q=<address>` is Android's documented "show this address" form — the 0,0 is the
// required placeholder point, not a location. React Native calls startActivity directly,
// so the phone's default handler opens, or the system asks when there is no default.
export const geoUrl = (h) => `geo:0,0?q=${enc(h)}`;

// The rows a platform offers, in order. Each is {key, label, url}. Kept here (not in the
// component) so the ordering and the labels are testable.
//   iOS     — three named apps; the OS has no chooser of its own for this.
//   Android — Google Maps, then "Another maps app" (geo:) which reaches Waze/Organic/etc
//             or raises the system chooser. Two rows + Cancel is also Android's Alert cap.
export function directionsOptions(h, platform) {
  if (platform === 'ios') {
    return [
      { key: 'apple', label: 'Apple Maps', url: appleDirectionsUrl(h) },
      { key: 'google', label: 'Google Maps', url: googleDirectionsUrl(h) },
      { key: 'waze', label: 'Waze', url: wazeUrl(h) },
    ];
  }
  return [
    { key: 'google', label: 'Google Maps', url: googleDirectionsUrl(h) },
    { key: 'other', label: 'Another maps app', url: geoUrl(h) },
  ];
}

// A door with no street line can't be geocoded by anyone — hide the affordance rather
// than open a maps app onto ", Kissimmee, FL".
export const canGetDirections = (h) => Boolean(h && h.addressLine1);

// Android only. React Native's Alert does NOT draw buttons in array order: it assigns the
// three slots by popping from the END (positive = pop(), negative = pop(), neutral = pop()),
// and Android draws them neutral | negative | positive, left to right, with positive
// emphasized. So the caller passes Cancel FIRST and the rows REVERSED, which lands Cancel in
// the leftmost throwaway slot and the primary destination under the thumb. Exported so the
// slot mapping is pinned by a test — pass the rows in the obvious order and Cancel silently
// becomes the emphasized button.
export const androidAlertOrder = (options) => [...options].reverse();
