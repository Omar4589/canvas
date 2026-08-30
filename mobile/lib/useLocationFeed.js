import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { ensureLocationPermission, reportFixAccuracy } from './location';
import {
  FEED_TIME_INTERVAL_MS,
  FEED_DISTANCE_INTERVAL_M,
  WATCHDOG_TICK_MS,
  shouldRestart,
} from './locationFeed';

// The canvasser map's owned GPS feed. The blue dot itself is the engine-rendered
// <AppLocationPuck> and needs nothing from JS; this stream exists ONLY for the two JS
// consumers the old <Mapbox.UserLocation onUpdate> used to feed:
//   (a) the iOS Precise-off probe (reportFixAccuracy — no-ops on Android), and
//   (b) the list view's "nearest to me" sort (userCoords in map.jsx).
// So its worst possible failure is a stale list sort — never a lying dot. Unlike the
// rnmapbox stream it replaces (which could die silently on Android and stay dead until
// logout, rnmapbox #3965), this one self-heals: a staleness watchdog resubscribes when
// the stream goes quiet while the app is active.
//
// Mount via the default-export <LocationFeed onFix={...}/> INSIDE the map's real render
// tree, not as a top-level hook: MapScreen has five bail-out screens (loading / error /
// archived / no-turf / book-resolving) that must not hold a High-accuracy 1Hz watcher.
export function useLocationFeed(onFix) {
  // Latest-ref so an inline arrow at the call site never tears down the watcher.
  const onFixRef = useRef(onFix);
  onFixRef.current = onFix;

  useEffect(() => {
    let cancelled = false;
    let sub = null; // current { remove() } subscription
    let starting = false; // overlap guard on the async subscribe
    let granted = false; // watchdog + retries gate off until permission lands
    let lastAliveAt = null; // later of (subscribe success, last delivered fix)
    let lastRestartAt = null; // stamped at every ATTEMPT — floors rejecting retries too

    const handleFix = (pos) => {
      lastAliveAt = Date.now();
      // Every fix feeds the Precise-off probe BEFORE any hysteresis — it needs the
      // full ~1s cadence, and the 10m re-sort gate lives at the state site, not here.
      reportFixAccuracy(pos?.coords?.accuracy);
      const lng = pos?.coords?.longitude;
      const lat = pos?.coords?.latitude;
      if (Number.isFinite(lng) && Number.isFinite(lat)) onFixRef.current?.([lng, lat]);
    };

    const subscribe = async () => {
      if (starting || cancelled) return;
      starting = true;
      lastRestartAt = Date.now();
      try {
        const next = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            // distanceInterval 0 is LOAD-BEARING: a distance-gated feed goes silent
            // when the canvasser stands still, starving the probe AND making real
            // stream death indistinguishable from standing still (no watchdog).
            timeInterval: FEED_TIME_INTERVAL_MS,
            distanceInterval: FEED_DISTANCE_INTERVAL_M,
            // Android: expo-location pops the system "turn on high-accuracy" dialog
            // by default when services are degraded — and a 30s watchdog would LOOP
            // it. Services-off UX belongs to LocationBlockedBanner/promptEnableServices.
            mayShowUserSettingsDialog: false,
          },
          handleFix,
          () => {
            // Provider lost (services toggled, engine error): declare dead now so the
            // next tick may resubscribe — still behind the restart floor.
            lastAliveAt = null;
          }
        );
        if (cancelled) {
          // Fast-unmount race: watchPositionAsync's promise resolves after the native
          // call, which can land after cleanup already ran.
          next.remove();
          return;
        }
        sub = next;
        lastAliveAt = Date.now(); // staleness is measured from subscribe, not from null
      } catch {
        // Rejected (services off): swallow — the watchdog retries at the floor.
      } finally {
        starting = false;
      }
    };

    (async () => {
      // May prompt once, matching the old mount behavior — and coalesced inside
      // ensureLocationPermission with the initial-camera helper's concurrent call.
      granted = await ensureLocationPermission().catch(() => false);
      if (cancelled || !granted) return; // denied: banner owns the UX; app-active re-checks
      subscribe();
    })();

    // Watchdog: fixes flow ~1s apart even standing still (see options above), so
    // sustained silence while ACTIVE genuinely means a dead stream.
    const watchdog = setInterval(() => {
      if (AppState.currentState !== 'active') return; // the background gap is normal
      if (!granted || starting) return;
      if (shouldRestart(lastAliveAt, lastRestartAt, Date.now())) {
        if (sub) {
          sub.remove();
          sub = null;
        }
        subscribe();
      }
    }, WATCHDOG_TICK_MS);

    // Backgrounding deliberately does NOT tear the subscription down: with when-in-use
    // permission both OSes stop delivering to a backgrounded app anyway, and an explicit
    // stop/restart adds two async races (stop vs pending subscribe, restart vs unmount)
    // for no battery win.
    const appStateSub = AppState.addEventListener('change', (status) => {
      if (status !== 'active' || cancelled) return;
      if (!granted) {
        // Check-only re-probe — re-prompting on every foreground would nag; the
        // banner's tap-to-fix owns re-prompts. The OS permission dialog itself fires
        // an app-active transition, so a banner-flow grant lands here and starts the
        // feed without an app restart. (Parity edge, same class as the old path: an
        // Android puck granted permission only after style load may need a screen
        // remount to draw — every map screen prompts at/before mount, so in practice
        // this is the Settings-round-trip case.)
        Location.getForegroundPermissionsAsync()
          .then((resp) => {
            if (cancelled || resp.status !== 'granted') return;
            granted = true;
            subscribe();
          })
          .catch(() => {});
      } else {
        // Grace reset: the background delivery gap must not read as a dead stream —
        // a truly dead one re-trips within one staleness window.
        lastAliveAt = Date.now();
      }
    });

    return () => {
      cancelled = true;
      if (sub) {
        sub.remove();
        sub = null;
      }
      clearInterval(watchdog);
      appStateSub.remove();
    };
  }, []);
}

// Null-rendering mount point so screens start the feed exactly when their real map
// renders (hooks can't sit behind MapScreen's bail-out returns; a component can).
const LocationFeed = ({ onFix }) => {
  useLocationFeed(onFix);
  return null;
};

export default LocationFeed;
