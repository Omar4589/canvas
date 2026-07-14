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
// is the separable, opt-outable part — this kills exactly that. (Mapbox still sends a session-
// counting `appUserTurnstile` ping with telemetry off; "telemetry off" is not "no network calls".)
//
// THE ORDER BELOW IS LOAD-BEARING. It reads like a cosmetic line-swap; it is a process kill.
// setTelemetryEnabled has no cheap native path on Android — RNMBXModule.kt builds a THROWAWAY
// Mapbox MapView on the UI thread just to reach the telemetry flag. Mapbox v11 throws
// MapboxConfigurationException ("Using MapView requires providing a valid access token when
// inflating or creating the view") if a MapView is inflated before the token is set, and that throw
// lands on the main Looper — RN's native-module exception handler never sees it and no JS try/catch
// can catch it, so the process just dies with no red box. Calling telemetry first therefore hard-
// crashed every Android map screen (iOS is immune: its impl is a one-line UserDefaults write that
// touches no view). So: token first, ALWAYS, and telemetry only once it has actually landed.
let initialized = false;

export function initMapbox() {
  if (initialized) return;
  initialized = true;

  // No token means no telemetry call either — the Android impl builds a MapView to make it, and a
  // MapView without a token is the native crash described above.
  if (!MAPBOX_PUBLIC_TOKEN) return;

  // setAccessToken's promise resolves from inside the native UI-thread runnable that sets the token,
  // so chaining off it guarantees ordering rather than trusting the queue to stay FIFO.
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN)
    .then(() => Mapbox.setTelemetryEnabled(false))
    .catch((err) => console.warn('initMapbox failed', err));
}

export default Mapbox;
