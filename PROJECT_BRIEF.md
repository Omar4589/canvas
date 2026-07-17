# Doorline — Project Brief

**What it is**: **Doorline** — a multi-tenant SaaS platform for door-to-door political canvassing, sold to political consulting firms. The marketing site is `https://doorline.app` (no public pricing; the sales motion is "Request a demo"). It began as an internal tool for the Scott Berger State Representative campaign (KY District 64 — one admin, ~3 canvassers, ~5,840 households / 8,668 voters) and grew into a platform: multiple organizations, each running their own campaigns with their own admins, team leads, and canvassers, under a super-admin tier. Canvassers walk turf-cut "books" of geocoded households imported from a CSV, knock doors, record a door disposition (`unknocked` / `not_home` / `surveyed` / `wrong_address` / `refused` / `lit_dropped` / `restricted`), and capture survey responses tied to individual voters. The commercial unit is the **knock**: one distinct (household, pass) over the billable disposition set — [docs/METRICS.md](docs/METRICS.md) is the source of truth for counting. Orgs pay **$300/campaign/month** (a campaign starts billing the month of its first knock and bills through the month it's archived; setup months are free), enforced by an entitlement gate — suspension means read-only, never data loss ([docs/BILLING.md](docs/BILLING.md)).

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
                           └─ Voter ──→ Person   (per-org canonical identity)
```

`SavedSearch` is the renamed `WalkList` — the Mongo collection is still `walklists` and the admin
route is still `.../walklists`. Full references: [docs/EFFORTS.md](docs/EFFORTS.md),
[docs/PASSES.md](docs/PASSES.md), [docs/PASSES_AND_TURF.md](docs/PASSES_AND_TURF.md),
[docs/PERSONS.md](docs/PERSONS.md).

## Deployment

- **Server + admin dashboard** → Heroku app named **`doorline-test`** (URL `https://doorline-test-33a9431a3e3c.herokuapp.com`), served on custom domains: web at `https://doorline.app`, API at `https://api.doorline.app` (the API host is locked to `/api/*` and 302-redirects all other paths to the web app). **Two process types**: `web` (API at `/api/*` + built React at `/`) and `worker` (BullMQ — CSV imports and turf generation; requires Redis via `REDIS_URL`). Deploys happen from the **Heroku dashboard** (Deploy tab, connected to the GitHub repo): deploy the current working branch (**`sharedVoters`**, until it's merged). One-off commands (migrations, seeds) run from **More → Run console**, e.g. `npm --prefix server run migrate:billing -- --apply`. **Never deploy `main`**: its Procfile is web-only, and shipping a web-only slug removes the `worker` process type — Heroku scales the worker to **0** and does *not* restore it on the next good deploy (recover in the Resources tab, or `heroku ps:scale worker=1 -a doorline-test`). A dead worker shows a red banner on the web Import page (it polls `/admin/imports/worker-status`); turf generation just shows an indefinite in-progress state. An older `canvass` Heroku app exists and is **not** the live backend — don't keep a local `heroku` git remote pointing at it. GitHub repo is `Omar4589/canvas`.
- **Mobile** → EAS Build for iOS (TestFlight) and Android (Play Console **Internal testing**). EAS Update for OTA JS-only changes (`cd mobile && eas update --branch production`). Project ID: `4d913345-676f-4240-8f9a-6e8cafdda04c`. Bundle ID: `com.canvassapp.mobile`. Two independent update gates guard old installs — the env-driven build-currency nag (`MOBILE_CURRENT_RUNTIME_ANDROID/IOS` + `GET /api/build-status`; re-point the vars after every build/submit) and the breaking-change client-version wall (`CLIENT_API_VERSION` ↔ `MIN_CLIENT_API_VERSION`). They answer different questions ("is your binary newest?" vs "can your code talk to my API?") — see CLAUDE.md and [mobile/README.md](mobile/README.md).

## Stack details

- **MongoDB**: GeoJSON `Point` location on Household with `[lng, lat]` order and 2dsphere index. Voters keyed by `stateVoterId`; a canonical **Person** layer dedups the same real person **within each org** — Person is org-scoped since the July 2026 processor-not-controller hardening, and identity never propagates across orgs ([docs/PERSONS.md](docs/PERSONS.md) — its warning box is authoritative over older sections). Households keyed by a normalized address string (uppercase, trimmed, joined with `|`). 43 models in `server/src/models/`.
- **Auth**: long-lived JWT (30d), stored on mobile in `expo-secure-store`. Global subscriber-based store at `mobile/lib/authState.js` — single source of truth for token; eliminates auth-gate race conditions. Org roles: `admin | lead | canvasser` ([docs/ROLES.md](docs/ROLES.md)); above the orgs sits the super-admin tier (`User.isSuperAdmin` — a global flag, not a membership) with staff tiers `support | break_glass`.
- **Mobile state**: TanStack Query around the bootstrap endpoint (`/mobile/bootstrap` returns the canvasser's assigned universe — households, voters, books, active rounds, survey). Cached to a file-backed store (`canvass.bootstrap.json` via `expo-file-system` in `mobile/lib/cache.js` — Android's AsyncStorage SQLite limits crashed on large turfs; startup migrates legacy rows) so the app works offline. Recording is **optimistic-first** (`mobile/lib/recordAction.js` — the pin recolors before any GPS or network work). Offline submission queue at `mobile/lib/offlineQueue.js` — actions queue when offline and flush on reconnect (NetInfo-triggered) with a `wasOfflineSubmission: true` flag.
- **Map**: Mapbox vector tiles with a single `ShapeSource` + `CircleLayer` + `SymbolLayer` driven by one GeoJSON feature collection (NOT thousands of individual MarkerView components — would melt the device). No clustering. Status colors live in `mobile/lib/theme.js` (`colors.status`). Full reference: [docs/MAPS.md](docs/MAPS.md).
- **Help Center**: markdown articles in `server/src/content/help/` parsed server-side and served role-filtered at `/api/help`; web and mobile both render the parsed block model, so help copy ships with a server deploy — no OTA or app release needed. Keep it cascaded from the docs' Part 1 layers (see CLAUDE.md).

## Non-obvious decisions

1. **Coordinates come from the CSV; geocoding is optional and off by default.** The importer at `server/src/services/import/csvImporter.js` reads `p_Latitude` / `p_Longitude`. With `GEOCODE_ENABLED` unset/false (the default), rows without valid coordinates are rejected (`bad_coords`). With `GEOCODE_ENABLED=true`, rows *missing* coordinates survive validation and are geocoded via **Geocodio** during apply (`server/src/services/import/geocode/`, results cached in `GeocodeCache`, audited on `ImportJob`); rows with *invalid* provided coordinates are rejected either way. (The earlier Census + Mapbox subsystem was removed in `ce093f5`; the Geocodio path replaced it. See [docs/IMPORTS.md](docs/IMPORTS.md) §H.)
2. **Idempotent upsert by State Voter ID.** Re-uploading the CSV updates voters in place and preserves canvass activity. Coordinates from the new CSV always overwrite existing location data when present.
3. **Survey versioning via question denormalization.** Each `SurveyResponse.answers[]` stores `{ questionKey, questionLabel, answer }` — old responses never break when admin edits questions.
4. **Surveys have intro + closing.** Stored on `SurveyTemplate` model. Rendered on the canvasser's mobile survey screen as amber script blocks for them to read at the door.
5. **Distance from house is logged, not enforced.** Vendor-supplied coordinates can be 50–200m off in rural areas, so mobile never blocks submission based on distance.
6. **Wrong Address pins stay on map (red), not removed.** Single misclick shouldn't permanently hide a household.
7. **Per-environment env vars on EAS** (not eas.json). `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` are stored in EAS environment, plaintext (NOT secret — secret means EAS won't bundle it into the JS, which broke map tiles). The Mapbox download token (`RNMAPBOX_MAPS_DOWNLOAD_TOKEN`) IS secret since it's only needed at build time.

## Important paths

- `server/src/models/` — **43 models**. The spine: `Organization`, `Membership`, `User`, `Campaign`, `Effort`, `Pass`, `Turf`, `TurfAssignment`, `Household`, `Voter`, `Person`, `SavedSearch` (collection `walklists`), `SurveyTemplate`, `SurveyResponse`, `CanvassActivity`, `ImportJob`, `ClientReport`, `FlagReview`, `Tag`, `Subscription` (billing entitlement — [docs/BILLING.md](docs/BILLING.md)).
- `server/src/routes/{auth.js, admin/, mobile/, superAdmin/, public/}`
- `server/src/services/` — shared logic: `reports/aggregations.js` (**`KNOCK_ACTIONS` + the counting primitives**), `turf/generateTurf.js`, `passes/`, `person/`, `import/`.
- `server/src/utils/seedAdmin.js` — creates or promotes a super-admin user (nothing else)
- `client/src/pages/` — **44 pages**. The admin spine: `OverviewPage`, `CampaignsPage` + the per-campaign drill-in (`EffortsPage`, `PassesPage`, `TurfsPage`, `WalkListsPage`, `VotersPage`, `TimelinePage`, `AuditPage`, `NotesPage`, `EarlyVotingPage`, `ClientReportsPage`/`ClientReportBuilderPage`), `MapPage`, `ImportPage`, `UsersPage`; the super-admin console (`SuperAdminHomePage`, `SuperAdminUsersPage`, `SuperAdminPeoplePage`, `OrganizationsPage`); public pages (`LandingPage`, `PublicReportListPage`/`PublicReportDetailPage`; privacy/terms/delete-account are zero-JS static HTML in `client/public/`, not React routes).
- `client/src/App.jsx` — public routes (marketing `/`, `/login`, `/privacy`, `/terms`, the share portal `/r/<token>`) + the protected admin layout (`/admin`, `/campaigns/:campaignId/...`)
- `mobile/app/_layout.jsx` — auth gate using `useAuthToken` + `useAuthReady`
- `mobile/app/(app)/{map.jsx, household/[id].jsx, voter/[id]/survey.jsx, admin/}` (`admin/` = the mobile admin tabs)
- `mobile/lib/{api.js, authState.js, auth.js, cache.js, config.js, location.js, offlineQueue.js, recordAction.js, validators.js}`

## Privacy + compliance

- **Posture: Doorline is a data processor; the customer org is the controller.** That's why Person is org-scoped and no customer data ever crosses org lines. The signed DPA ([docs/DPA.md](docs/DPA.md)) makes this contractual — and its §6 makes **adding or replacing a subprocessor a customer-notice event BEFORE it goes live** (see CLAUDE.md's privacy invariant).
- **Verified subprocessors**: MongoDB Atlas, Heroku (incl. router logs), Geocodio (addresses only, no names — the geocoder is Geocodio, NOT Mapbox), Mapbox (tiles; telemetry disabled on mobile, unmutable on web), Heroku Key-Value/Redis, Expo/EAS, Apple/Google (app distribution). [docs/PRIVACY_VERIFICATION.md](docs/PRIVACY_VERIFICATION.md) is the code-verified record of what the policy/ToS/DPA may truthfully claim — reconcile it on any privacy-affecting change.
- **Staff access is grant-gated**: staff reach customer voter data only through a typed-reason, 4-hour support grant, and every record opened is written to an append-only AccessLog ("no god mode = no unlogged mode").
- **Retention promises are kept by BullMQ jobs on the worker dyno** (identity purge; org wind-down / dormancy / deletion-request triggers) — no TTL index enforces any retention promise (the only TTL index in the codebase is GeocodeCache's cache-eviction one), so a dead worker silently breaks published legal promises. Health: `GET /api/super-admin/access/health/retention`.
- **Account deletion is a tombstone, never a purge**: PII scrubbed in place, the knock ledger and billing counts untouched (end state is pseudonymous, not anonymous). Public promise at `doorline.app/delete-account`.
- Public privacy policy at `https://doorline.app/privacy` (required by both Apple and Google Play); the legal pages are committed zero-JS HTML in `client/public/`. Contact email: hello@doorline.app.

## Operational quirks / known issues

- **The worker-dyno trap** (see Deployment) is the #1 way to silently break imports and turf cutting — and since the worker also runs the retention jobs, a dead worker quietly breaks published legal promises too.
- **`SavedSearch` vs `walklists` naming.** The model was renamed from `WalkList`; the DB collection (`walklists`), the admin route (`.../walklists`), and the `walkLists` response key keep the old name. Grep for both names when touching that subsystem.
- **OTA fingerprint trap.** `runtimeVersion` is fingerprint-based — editing native config (`app.json`) or native deps strands OTA updates from installed builds. Publish with `eas update --branch production` (never `--auto`); check with `eas fingerprint:compare` when unsure.
- **Payload scaling.** The old "~5MB bootstrap" watch-item is retired: `/mobile/bootstrap` is book-scoped for everyone (a canvasser downloads only their assigned books' doors) and lands in the file-backed cache, gzip is on (`app.use(compression())` — a ~12MB map pull ships as ~1.5MB), and the admin map is viewport-bounded (bbox → `$geoWithin` on the 2dsphere index, 50k cap backstop). The remaining watch-item is bulk-assigning ALL books to one user — their bootstrap becomes the whole universe. Details: [docs/PERFORMANCE.md](docs/PERFORMANCE.md) → Payload scaling.
- **EAS-managed Android keystore** — first generated during this campaign's first Android build. Backup downloaded via `eas credentials --platform android` recommended. If lost, no future Android updates possible.
- **Reports are extensive** (the old "reports are minimal" note is long gone): org Overview + campaign rollup, per-canvasser summary with daily drill-downs, the canvasser daily timeline (knocks × hours with overlap reconciliation), duplicate-survey and overlap audits, the notes hub, the GPS-quality audit (persisted flag reviews), early voting, client report snapshots + public share links, and CSV exports. Open reporting items live in [docs/REPORTING_BACKLOG.md](docs/REPORTING_BACKLOG.md) (per-round billing export is item 1) — not in code TODOs.

## How to onboard a new conversation

- Start with **[docs/README.md](docs/README.md)** — the index of the feature docs. [docs/METRICS.md](docs/METRICS.md) is the counting source of truth; [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) is the click-by-click walkthrough.
- Tell Claude: "Read `mobile/app/(app)/map.jsx`, `mobile/app/(app)/voter/[id]/survey.jsx`, `server/src/services/import/csvImporter.js`, and `server/src/routes/mobile/bootstrap.js` for current structure."
- For deployment: "Server changes ship from the Heroku dashboard's Deploy tab — deploy the `sharedVoters` branch, never `main` (see Deployment); one-off commands run in More → Run console. Mobile JS-only changes ship via `cd mobile && eas update --branch production`. Native changes need `eas build`."
