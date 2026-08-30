import Mapbox from '@rnmapbox/maps';

// The ONE location puck for all four map screens — rendered by the map engine itself,
// so its position never crosses the RN bridge. This replaced <Mapbox.UserLocation>
// (renderMode 'normal'), which moved a CircleLayer from JS state per fix and could
// silently freeze on Android (rnmapbox #3965 — a canvasser's dot stuck a block behind
// her, fixed only by logging out). The engine puck cannot freeze from JS.
//
// NEVER hide this with visible={false}: on both platforms that only swaps in empty
// puck images while the engine keeps GPS running, and on Android the pulsing config is
// applied OUTSIDE the visible branch (RNMBXNativeUserLocation.kt), so an "invisible"
// puck still draws its pulse ring. Unmount is the only real off-switch — screens that
// gate GPS must do `{isFocused && <AppLocationPuck />}`.
//
// No bearing/heading props on purpose (LocationPuck's default is bearing OFF): the
// compass puck keeps the magnetometer polling the whole time a map is open — a real
// battery drain for little gain.
//
// Pulsing is pinned explicitly instead of 'default' because the platform defaults
// diverge (Android ~10dp vs iOS ~30pt — showy), and radius 'accuracy' would draw an
// alarming ~50m ring indoors. 15 = just past the dot's own edge: visibly alive, not a
// sonar ping — and a liveness cue no frozen feed could fake. #4A90E2 is the Mapbox
// puck blue both native SDKs already use.
const PUCK_PULSING = { isEnabled: true, color: '#4A90E2', radius: 15 };

const AppLocationPuck = () => <Mapbox.LocationPuck visible pulsing={PUCK_PULSING} />;

export default AppLocationPuck;
