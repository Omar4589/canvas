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
