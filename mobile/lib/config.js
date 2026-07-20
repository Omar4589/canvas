import { Platform } from 'react-native';
import Constants from 'expo-constants';

// EAS Build bakes `EXPO_PUBLIC_*` env vars into the JS bundle at build time,
// so each build profile (development / preview / production) can point at a
// different API URL without editing app.json. Local `expo start` falls back
// to the value in app.json's `extra` block.
const extra = Constants.expoConfig?.extra || {};

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || 'http://localhost:4000';

export const MAPBOX_PUBLIC_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN || extra.mapboxPublicToken || '';

// Monotonic integer describing the server contract this JS bundle expects. Bump
// it whenever the bundle starts depending on a new/changed server behavior. The
// server reports `minClientApiVersion`; when ours is lower, the app is too old
// and routes to /update-required instead of failing with cryptic 4xx errors.
// (This is the forward-looking half of the Android stale-bundle fix — it can't
// help a bundle that predates it, but it protects every future mismatch.)
export const CLIENT_API_VERSION = 1;

// Production web origin (the console + public marketing site). The mobile app links
// OUT to it for browser-only flows — e.g. the password-reset UI lives on the web.
// Mirrors client/index.html's canonical/og:url; the API is the `api.` subdomain.
export const WEB_URL = 'https://doorline.app';

// Where "get the update" sends people. One copy, used by both update surfaces
// (the /update-required contract wall and the UpdateGate build nag).
// The PUBLIC store listings — deliberately NOT the same pair a new canvasser is sent to. This is
// the UPDATE path (someone who already has the app; overridable via MOBILE_STORE_URL_*), while
// first-INSTALL links live in server/src/config/storeLinks.js and go in the invite email. They
// converge at public launch.
export const STORE_URL = Platform.select({
  android: 'https://play.google.com/store/apps/details?id=com.canvassapp.mobile',
  ios: 'https://apps.apple.com/app/doorline/id6764581850',
});
