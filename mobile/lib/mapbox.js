import Mapbox from '@rnmapbox/maps';
import { MAPBOX_PUBLIC_TOKEN } from './config';

// The ONE place Mapbox gets configured. Every screen that renders a map must call initMapbox()
// at module scope instead of calling Mapbox.setAccessToken() itself.
//
// Why a chokepoint rather than a line in each screen: setting the token was already copy-pasted
// into NINE files, and each copy silently left telemetry ON. A tenth map screen would have done
// the same. There is now nothing to copy — the token and the telemetry switch travel together.
//
// TELEMETRY IS OFF ON PURPOSE. @rnmapbox/maps ships anonymous usage AND LOCATION data to Mapbox by
// default. Leaving it on would:
//   · make our published privacy policy false — it states we do "not use advertising cookies,
//     third-party analytics, or tracking technologies ... in our apps";
//   · force us to declare Mapbox as a third party collecting Location + App activity on the Play
//     Data safety form, and push the App Store privacy label toward "Data Used to Track You";
//   · oblige us to build a user-facing opt-out, which the SDK's own docs require when telemetry is
//     enabled ("You are additionally required to provide users with the option to disable anonymous
//     usage and location sharing").
// Turning it off makes all three go away. Do not remove this call.
//
// Map TILES still reach Mapbox (that is what a map is), and that is disclosed in the privacy policy
// under service providers "providing maps and converting addresses into map coordinates". Telemetry
// is the separable, opt-outable part — this kills exactly that.
let initialized = false;

export function initMapbox() {
  if (initialized) return;
  initialized = true;

  Mapbox.setTelemetryEnabled(false);

  if (MAPBOX_PUBLIC_TOKEN) {
    Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
  }
}

export default Mapbox;
