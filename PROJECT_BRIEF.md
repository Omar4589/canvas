# Doorline — Project Brief

**What it is**: **Doorline** — a multi-tenant SaaS platform for door-to-door political canvassing, sold to political consulting firms. The marketing site is `https://doorline.app` (no public pricing; the sales motion is "Request a demo"). It began as an internal tool for the Scott Berger State Representative campaign (KY District 64 — one admin, ~3 canvassers, ~5,840 households / 8,668 voters) and grew into a platform: multiple organizations, each running their own campaigns with their own admins, team leads, and canvassers, under a super-admin tier. Canvassers walk turf-cut "books" of geocoded households imported from a CSV, knock doors, record a door disposition (`unknocked` / `not_home` / `surveyed` / `wrong_address` / `refused` / `lit_dropped` / `restricted`), and capture survey responses tied to individual voters. The commercial unit is the **knock**: one distinct (household, pass) over the billable disposition set — [docs/METRICS.md](docs/METRICS.md) is the source of truth for counting.

**Repo**: `~/Desktop/canvass-app/` — three independent npm packages, no monorepo tooling.

```
canvass-app/
├── server/   # Node + Express + MongoDB Atlas (auth, API, CSV import, BullMQ jobs, mobile bootstrap)
├── client/   # React + Vite admin dashboard + marketing site (bundled into server's static dir on deploy)
└── mobile/   # Expo SDK 54 + React Native + @rnmapbox/maps + Expo Router
```

## Domain model (UI name ≠ model name in three places)

```
Organization (tenant)
  └─ Campaign             type: survey | lit_drop
       └─ Effort           UI "Walk list" — owns a DISJOINT door set (Household.effortId; null = Intake)
            └─ Pass        UI "Pass" — one billable sweep; roundNumber restarts per walk list
                 └─ Turf   UI "Book" — ordered householdIds[] = the walk sequence
                      └─ Household (a door)
                           └─ Voter ──→ Person   (cross-org canonical identity)
```

`SavedSearch` is the renamed `WalkList` — the Mongo collection is still `walklists` and the admin
route is still `.../walklists`. Full references: [docs/EFFORTS.md](docs/EFFORTS.md),
[docs/PASSES.md](docs/PASSES.md), [docs/PASSES_AND_TURF.md](docs/PASSES_AND_TURF.md),
[docs/PERSONS.md](docs/PERSONS.md).

## Deployment

- **Server + admin dashboard** → Heroku app named **`doorline-test`** (URL `https://doorline-test-33a9431a3e3c.herokuapp.com`), served on custom domains: web at `https://doorline.app`, API at `https://api.doorline.app` (the API host is locked to `/api/*` and 302-redirects all other paths to the web app). **Two process types**: `web` (API at `/api/*` + built React at `/`) and `worker` (BullMQ — CSV imports and turf generation; requires Redis via `REDIS_URL`). Deploys happen from the **Heroku dashboard** (Deploy tab, connected to the GitHub repo): deploy the current working branch (**`sharedVoters`**, until it's merged). One-off commands (migrations, seeds) run from **More → Run console**, e.g. `npm --prefix server run migrate:billing -- --apply`. **Never deploy `main`**: its Procfile is web-only, and shipping a web-only slug removes the `worker` process type — Heroku scales the worker to **0** and does *not* restore it on the next good deploy (recover in the Resources tab, or `heroku ps:scale worker=1 -a doorline-test`). A dead worker shows a red banner on the web Import page (it polls `/admin/imports/worker-status`); turf generation just shows an indefinite in-progress state. An older `canvass` Heroku app exists and is **not** the live backend — don't keep a local `heroku` git remote pointing at it. GitHub repo is `Omar4589/canvas`.
- **Mobile** → EAS Build for iOS (TestFlight) and Android (Play Console **Internal testing**). EAS Update for OTA JS-only changes (`cd mobile && eas update --branch production`). Project ID: `4d913345-676f-4240-8f9a-6e8cafdda04c`. Bundle ID: `com.canvassapp.mobile`.

## Stack details

- **MongoDB**: GeoJSON `Point` location on Household with `[lng, lat]` order and 2dsphere index. Voters keyed by `stateVoterId`; a canonical cross-org **Person** layer dedups the same real person across orgs ([docs/PERSONS.md](docs/PERSONS.md)). Households keyed by a normalized address string (uppercase, trimmed, joined with `|`). 35 models in `server/src/models/`.
- **Auth**: long-lived JWT (30d), stored on mobile in `expo-secure-store`. Global subscriber-based store at `mobile/lib/authState.js` — single source of truth for token; eliminates auth-gate race conditions. Org roles: `admin | lead | canvasser` ([docs/ROLES.md](docs/ROLES.md)).
- **Mobile state**: TanStack Query around the bootstrap endpoint (`/mobile/bootstrap` returns the canvasser's assigned universe — households, voters, books, active rounds, survey). Cached to AsyncStorage so the app works offline. Recording is **optimistic-first** (`mobile/lib/recordAction.js` — the pin recolors before any GPS or network work). Offline submission queue at `mobile/lib/offlineQueue.js` — actions queue when offline and flush on reconnect (NetInfo-triggered) with a `wasOfflineSubmission: true` flag.
- **Map**: Mapbox vector tiles with a single `ShapeSource` + `CircleLayer` + `SymbolLayer` driven by one GeoJSON feature collection (NOT thousands of individual MarkerView components — would melt the device). No clustering. Status colors live in `mobile/lib/theme.js` (`colors.status`). Full reference: [docs/MAPS.md](docs/MAPS.md).

## Non-obvious decisions

1. **Coordinates come from the CSV; geocoding is optional and off by default.** The importer at `server/src/services/import/csvImporter.js` reads `p_Latitude` / `p_Longitude`. With `GEOCODE_ENABLED` unset/false (the default), rows without valid coordinates are rejected (`bad_coords`). With `GEOCODE_ENABLED=true`, rows *missing* coordinates survive validation and are geocoded via **Geocodio** during apply (`server/src/services/import/geocode/`, results cached in `GeocodeCache`, audited on `ImportJob`); rows with *invalid* provided coordinates are rejected either way. (The earlier Census + Mapbox subsystem was removed in `ce093f5`; the Geocodio path replaced it. See [docs/IMPORTS.md](docs/IMPORTS.md) §H.)
2. **Idempotent upsert by State Voter ID.** Re-uploading the CSV updates voters in place and preserves canvass activity. Coordinates from the new CSV always overwrite existing location data when present.
3. **Survey versioning via question denormalization.** Each `SurveyResponse.answers[]` stores `{ questionKey, questionLabel, answer }` — old responses never break when admin edits questions.
4. **Surveys have intro + closing.** Stored on `SurveyTemplate` model. Rendered on the canvasser's mobile survey screen as amber script blocks for them to read at the door.
5. **Distance from house is logged, not enforced.** Vendor-supplied coordinates can be 50–200m off in rural areas, so mobile never blocks submission based on distance.
6. **Wrong Address pins stay on map (red), not removed.** Single misclick shouldn't permanently hide a household.
7. **Per-environment env vars on EAS** (not eas.json). `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` are stored in EAS environment, plaintext (NOT secret — secret means EAS won't bundle it into the JS, which broke map tiles). The Mapbox download token (`RNMAPBOX_MAPS_DOWNLOAD_TOKEN`) IS secret since it's only needed at build time.

## Important paths

- `server/src/models/` — **37 models**. The spine: `Organization`, `Membership`, `User`, `Campaign`, `Effort`, `Pass`, `Turf`, `TurfAssignment`, `Household`, `Voter`, `Person`, `SavedSearch` (collection `walklists`), `SurveyTemplate`, `SurveyResponse`, `CanvassActivity`, `ImportJob`, `ClientReport`, `FlagReview`, `Tag`, `Subscription` (billing entitlement — [docs/BILLING.md](docs/BILLING.md)).
- `server/src/routes/{auth.js, admin/, mobile/, superAdmin/, public/}`
- `server/src/services/` — shared logic: `reports/aggregations.js` (**`KNOCK_ACTIONS` + the counting primitives**), `turf/generateTurf.js`, `passes/`, `person/`, `import/`.
- `server/src/utils/seedAdmin.js` — seeds admin user + (one-time) default survey
- `client/src/pages/` — **39 pages**. The admin spine: `OverviewPage`, `CampaignsPage` + the per-campaign drill-in (`EffortsPage`, `PassesPage`, `TurfsPage`, `WalkListsPage`, `VotersPage`, `TimelinePage`, `AuditPage`, `NotesPage`, `EarlyVotingPage`, `ClientReportsPage`/`ClientReportBuilderPage`), `MapPage`, `ImportPage`, `UsersPage`; the super-admin console (`SuperAdminHomePage`, `SuperAdminUsersPage`, `SuperAdminPeoplePage`, `OrganizationsPage`); public pages (`LandingPage`, `PublicReportListPage`/`PublicReportDetailPage`, `PrivacyPolicyPage`, `TermsPage`).
- `client/src/App.jsx` — public routes (marketing `/`, `/login`, `/privacy`, `/terms`, the share portal `/r/<token>`) + the protected admin layout (`/admin`, `/campaigns/:campaignId/...`)
- `mobile/app/_layout.jsx` — auth gate using `useAuthToken` + `useAuthReady`
- `mobile/app/(app)/{map.jsx, household/[id].jsx, voter/[id]/survey.jsx, admin/}` (`admin/` = the mobile admin tabs)
- `mobile/lib/{api.js, authState.js, auth.js, cache.js, config.js, location.js, offlineQueue.js, recordAction.js, validators.js}`

## Privacy + compliance

- Public privacy policy at `https://doorline.app/privacy`. Required by both Apple and Google Play. Contact email: omar@foxbryant.com.

## Operational quirks / known issues

- **The worker-dyno trap** (see Deployment) is the #1 way to silently break imports and turf cutting.
- **`SavedSearch` vs `walklists` naming.** The model was renamed from `WalkList`; the DB collection (`walklists`), the admin route (`.../walklists`), and the `walkLists` response key keep the old name. Grep for both names when touching that subsystem.
- **OTA fingerprint trap.** `runtimeVersion` is fingerprint-based — editing native config (`app.json`) or native deps strands OTA updates from installed builds. Publish with `eas update --branch production` (never `--auto`); check with `eas fingerprint:compare` when unsure.
- **Payload scaling.** The old "~5MB bootstrap" watch-item is retired: `/mobile/bootstrap` is book-scoped for everyone (a canvasser downloads only their assigned books' doors). The remaining heavy surfaces are the admin map with a **cleared date filter** (whole-universe pull, ~12MB+ uncompressed on a 16k-household campaign, re-polled every 20s in Live mode) and bulk-assigning ALL books to one user (their bootstrap becomes the whole universe, which breaks Android's AsyncStorage row limit). **No compression middleware is installed** — Express does not gzip by default; `app.use(compression())` is the cheapest win. Details: [docs/PERFORMANCE.md](docs/PERFORMANCE.md) → Payload scaling.
- **EAS-managed Android keystore** — first generated during this campaign's first Android build. Backup downloaded via `eas credentials --platform android` recommended. If lost, no future Android updates possible.
- **Reports are extensive** (the old "reports are minimal" note is long gone): org Overview + campaign rollup, per-canvasser summary with daily drill-downs, the canvasser daily timeline (knocks × hours with overlap reconciliation), duplicate-survey and overlap audits, the notes hub, the GPS-quality audit (persisted flag reviews), early voting, client report snapshots + public share links, and CSV exports. Open reporting items live in [docs/REPORTING_BACKLOG.md](docs/REPORTING_BACKLOG.md) (per-round billing export is item 1) — not in code TODOs.

## How to onboard a new conversation

- Start with **[docs/README.md](docs/README.md)** — the index of the feature docs. [docs/METRICS.md](docs/METRICS.md) is the counting source of truth; [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) is the click-by-click walkthrough.
- Tell Claude: "Read `mobile/app/(app)/map.jsx`, `mobile/app/(app)/voter/[id]/survey.jsx`, `server/src/services/import/csvImporter.js`, and `server/src/routes/mobile/bootstrap.js` for current structure."
- For deployment: "Server changes ship from the Heroku dashboard's Deploy tab — deploy the `sharedVoters` branch, never `main` (see Deployment); one-off commands run in More → Run console. Mobile JS-only changes ship via `cd mobile && eas update --branch production`. Native changes need `eas build`."
