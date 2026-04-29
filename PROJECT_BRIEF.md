# Canvass App — Project Brief

**What it is**: Internal door-to-door canvassing tool for the Scott Berger State Representative campaign (KY District 64). Three canvassers max, one admin. Used to walk a list of ~5,840 households / 8,668 voters imported from a CSV, knock doors, record household status (unknocked / not_home / surveyed / wrong_address), and capture survey responses tied to individual voters.

**Repo**: `~/Desktop/canvass-app/` — three independent npm packages, no monorepo tooling.

```
canvass-app/
├── server/   # Node + Express + MongoDB Atlas (auth, API, CSV import, mobile bootstrap)
├── client/   # React + Vite admin dashboard (also bundled into server's static dir on deploy)
└── mobile/   # Expo SDK 54 + React Native + @rnmapbox/maps + Expo Router
```

## Deployment

- **Server + admin dashboard** → Heroku app named **`canvass`** (URL: `https://canvass-c038d2d7dc96.herokuapp.com`). Single dyno serves API at `/api/*` and built React at `/`. Deploy via `git push heroku main` from repo root. GitHub repo is `Omar4589/canvas`.
- **Mobile** → EAS Build for iOS (TestFlight) and Android (Play Console **Internal testing**). EAS Update for OTA JS-only changes (`eas update --branch production`). Project ID: `4d913345-676f-4240-8f9a-6e8cafdda04c`. Bundle ID: `com.canvassapp.mobile`.

## Stack details

- **MongoDB**: GeoJSON `Point` location on Household with `[lng, lat]` order and 2dsphere index. Voters keyed by `stateVoterId`. Households keyed by a normalized address string (uppercase, trimmed, joined with `|`).
- **Auth**: long-lived JWT (30d), stored on mobile in `expo-secure-store`. Global subscriber-based store at `mobile/lib/authState.js` — single source of truth for token; eliminates auth-gate race conditions.
- **Mobile state**: TanStack Query for the bootstrap endpoint (`/mobile/bootstrap` returns all households + voters + active survey). Cached to AsyncStorage so the app works offline. Offline submission queue at `mobile/lib/offlineQueue.ts` — actions get queued when offline, flushed on reconnect with `wasOfflineSubmission: true` flag.
- **Map**: Mapbox vector tiles with a `ShapeSource` + `CircleLayer` driven by a single GeoJSON feature collection (NOT 5,840 individual MarkerView components — would melt the device). No clustering. Status colors live in `mobile/components/StatusColor.js`.

## Non-obvious decisions

1. **CSV provides coordinates directly.** The CSV has `p_Latitude` / `p_Longitude` columns. The importer at `server/src/services/import/csvImporter.js` reads them and sets `geocodeProvider: 'csv'`. Census + Mapbox geocoding code still exists at `server/src/services/geocode/*` but is no longer in the import path.
2. **Idempotent upsert by State Voter ID.** Re-uploading the CSV updates voters in place and preserves canvass activity. Coordinates from the new CSV always overwrite existing location data when present.
3. **Survey versioning via question denormalization.** Each `SurveyResponse.answers[]` stores `{ questionKey, questionLabel, answer }` — old responses never break when admin edits questions.
4. **Surveys have intro + closing.** Stored on `SurveyTemplate` model. Rendered on the canvasser's mobile survey screen as amber script blocks for them to read at the door.
5. **Distance from house is logged, not enforced.** Census/Mapbox-style geocoding can be 50–200m off in rural areas. Mobile never blocks submission based on distance.
6. **Wrong Address pins stay on map (red), not removed.** Single misclick shouldn't permanently hide a household.
7. **Per-environment env vars on EAS** (not eas.json). `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` are stored in EAS environment, plaintext (NOT secret — secret means EAS won't bundle it into the JS, which broke map tiles). The Mapbox download token (`RNMAPBOX_MAPS_DOWNLOAD_TOKEN`) IS secret since it's only needed at build time.

## Important paths

- `server/src/models/{Household,Voter,SurveyTemplate,SurveyResponse,CanvassActivity,User,ImportJob}.js`
- `server/src/routes/{auth.js, admin/, mobile/}`
- `server/src/utils/seedAdmin.js` — seeds admin user + (one-time) default survey
- `client/src/pages/{LoginPage, DashboardPage, ImportPage, GeocodingPage, UsersPage, SurveysPage, PrivacyPolicyPage}.jsx`
- `client/src/App.jsx` — public routes (`/login`, `/privacy`) + protected admin layout
- `mobile/app/_layout.jsx` — auth gate using `useAuthToken` + `useAuthReady`
- `mobile/app/(app)/{map.jsx, household/[id].jsx, voter/[id]/survey.jsx}`
- `mobile/lib/{api.js, authState.js, auth.js, cache.js, config.js, location.js, offlineQueue.ts}`

## Privacy + compliance

- Public privacy policy at `https://canvass-c038d2d7dc96.herokuapp.com/privacy`. Required by both Apple and Google Play. Contact email: omar@foxbryant.com.

## Operational quirks / known issues

- **Recenter button rolled back via `eas update:republish`.** The conditional Mapbox.Camera mount caused iOS crashes. The fixed version (single Camera + `defaultSettings` + `followUserLocation` toggle, no `onTouchMove`) is in the code at `mobile/app/(app)/map.jsx` but **not yet shipped**. Test on a dev client before the next OTA push.
- **Bootstrap payload is ~5MB JSON.** Fine for now; gzip + cache headers should be on by default in Express. Watch this if the universe ever grows past ~10k households.
- **EAS-managed Android keystore** — first generated during this campaign's first Android build. Backup downloaded via `eas credentials --platform android` recommended. If lost, no future Android updates possible.
- **Reports are minimal.** Overview + activity audit only. CSV export of survey responses is the most likely first post-launch feature ask.

## How to onboard a new conversation

- Tell Claude: "Read `mobile/app/(app)/map.jsx`, `mobile/app/(app)/voter/[id]/survey.jsx`, `server/src/services/import/csvImporter.js`, and `server/src/routes/mobile/bootstrap.js` for current structure."
- For deployment: "Server changes ship via `git push heroku main`. Mobile JS-only changes ship via `cd mobile && eas update --branch production`. Native changes need `eas build`."
