# Maps

How the maps work across the whole app — what the dots mean, where they come from, and how a
canvasser knocking a door turns into a pin you can see on a screen.

- **Part 1 — For everyone** is plain language: reading the maps and what they show.
- **Part 2 — Technical reference** is for developers (and Claude): every map screen, the endpoints
  that feed them, how they render, and the refresh/intervals.

Related: [IMPORTS.md](IMPORTS.md) (where coordinates come from), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(books/turf the maps are scoped to), [EARLY_VOTING.md](EARLY_VOTING.md) (voted doors dropping off the
map), [METRICS.md](METRICS.md) (the numbers behind the pins), [DATE_FILTERS.md](DATE_FILTERS.md)
(the date-range control — on the map a window narrows the pins to interacted-with doors).

---

# Part 1 — For everyone

## Where the maps are

There are maps in two places, drawing the **same doors** from the **same database**:

- **The mobile field app** — what a canvasser sees while walking: the doors in their assigned books,
  with a colored pin per house.
- **The web admin console** — what an organizer sees at a desk: every door in the campaign, plus
  where canvassers have been (their "pings"), with filters and a live, auto-refreshing view.

## Reading a door pin

Every house is a pin, colored by its current status:

| Color | Status | Means |
|---|---|---|
| Gray | Unknocked | No one has logged anything here yet. |
| Blue | Not home | A canvasser knocked; nobody answered. |
| Green | Surveyed | Someone answered and a survey was taken. |
| Red | Wrong address | The door doesn't exist / bad data. |
| Purple | Lit dropped | Literature was left (no conversation). |

Doors where **everyone has already voted** drop off the canvasser's map automatically, so the field
team only sees doors that still need work (see [EARLY_VOTING.md](EARLY_VOTING.md)).

## Apartment buildings

When several units share the same spot (an apartment building), the map groups them into **one
building marker** instead of stacking pins on top of each other. The marker shows progress like
"**12 units · 5 done**", and tapping it opens the list of units.

## The mobile canvasser map

A canvasser opens the app and sees the doors in the books assigned to them. They can:

- **Tap a pin** to see the household and the voters who live there.
- **Mark a door and see it instantly.** Tapping Not home / Wrong address / Survey / Lit drop recolors
  the pin **right away** — the GPS stamp and the save to the server happen in the background, so you
  never wait on a spinner to know it registered.
- **Recenter / follow** their own location (a "follow me" button; it turns itself off when you pan the
  map or background the app, to save battery).
- **Work offline.** If there's no signal, the door still recolors instantly and the action is saved on
  the phone; a "**pending**" badge shows how many are waiting. They sync automatically in the
  background once signal returns — nothing is lost.
- **Switch the base map** between Street, Satellite, Hybrid, and more.

## The web admin map

An organizer sees the whole campaign at once:

- **Every door**, colored by status, plus **canvasser pings** — a dot wherever a canvasser stood when
  they logged a knock — with a faint line back to the house.
- **Filters**: by status, by canvasser, by date range, and by a specific survey answer.
- **Live mode**: a "**Live · updated Xs ago**" toggle (on by default) that auto-refreshes the map
  about every 20 seconds, so pins and pings update as the field works — no page reload. You can pause
  it or hit Refresh on demand. It pauses on its own when the browser tab isn't in front.

## Other map views (brief)

- **Admin overview map (mobile)** — the same all-doors view on a phone, with an optional canvasser-pings
  toggle.
- **A single canvasser's path** — one canvasser's pings over a date range, to review their day.
- **Books overview** — a marker per book at its center, colored by how much of it is done; tap one to
  jump into that book on the map.

## Where the dots come from (and how live it is)

- **Coordinates come from your uploaded voter file.** Each row brings its own latitude/longitude, and
  that's where the pin lands. The app **does not look up addresses** — a row without coordinates won't
  appear on the map (see [IMPORTS.md](IMPORTS.md)).
- **A "ping" is a GPS stamp.** When a canvasser logs an action, the app records where the phone was at
  that moment. That's the dot you see on the admin map, along with how far it was from the house.
- **How fresh:** the web map refreshes ~every 20s; the mobile app keeps doors in sync ~every 30s.
  Mobile stays deliberately light on battery (canvassers open and close the app all day), while the
  web map can be more live because admins sit at a connected desk.

---

# Part 2 — Technical reference

## A. The maps at a glance

| Map | Platform | Library | Renders | Data source | Refresh |
|---|---|---|---|---|---|
| Web admin map — [MapPage.jsx](../client/src/pages/MapPage.jsx) | Web | Mapbox GL JS | Household pins, canvasser pings + lines | `GET /admin/households/map` | ~20s when **Live** on |
| Canvasser map — [map.jsx](../mobile/app/(app)/map.jsx) | Mobile | `@rnmapbox/maps` | House pins, building markers, bottom sheet | `GET /mobile/bootstrap` + `/mobile/changes` | 30s delta |
| Admin overview map — [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Mobile | `@rnmapbox/maps` | Household pins + optional pings | `GET /admin/households/map` | on toggle |
| Canvasser path — [admin/canvasser/[id]/map.jsx](../mobile/app/(app)/admin/canvasser/[id]/map.jsx) | Mobile | `@rnmapbox/maps` | One canvasser's action pings | `GET /admin/reports/canvassers/:id/path` | one-shot |
| Books overview — [books.jsx](../mobile/app/(app)/books.jsx) | Mobile | `@rnmapbox/maps` | Book centroid markers | `GET /mobile/bootstrap` | bootstrap |
| Turf cutting map — [TurfsPage.jsx](../client/src/pages/TurfsPage.jsx) | Web | Mapbox GL JS + Draw | Turf polygons, draw tools | turf endpoints | on-demand |

Turf polygons/cutting are documented in [PASSES_AND_TURF.md](PASSES_AND_TURF.md) — not repeated here.

## B. How a door gets on the map

Households store a GeoJSON point: `Household.location = { type: 'Point', coordinates: [lng, lat] }`
([models/Household.js](../server/src/models/Household.js)). Coordinates come **straight from the CSV**
(`p_Latitude` / `p_Longitude`); the importer **requires** valid lat/lng and **rejects rows without
them** ([services/import/csvImporter.js](../server/src/services/import/csvImporter.js)). There is **no
geocoding** — an older Census/Mapbox geocoder was removed. See [IMPORTS.md](IMPORTS.md).

## C. How an action becomes a ping

Recording is **optimistic-first**: the UI updates before the network, so the pin recolors the instant
a canvasser taps an action — the GPS stamp and the server write happen in the background and never
block the screen. (This replaced an older flow that awaited GPS **and** the full network round-trip
before recoloring, which made doors feel unrecorded on weak signal — the bare fetch could hang ~60s.)

1. **Instant (synchronous).** The tapped action patches the `['bootstrap']` React Query cache —
   `household.status` (and the client-computed building aggregate) recolor this same frame — via the
   shared helper [lib/recordAction.js](../mobile/lib/recordAction.js) (`recordHouseholdAction` /
   `optimisticSubmit`). The cache is mirrored to AsyncStorage so it survives a cold start. The screen
   returns to the map immediately; it never `await`s the network.
2. **Background — GPS.** [lib/location.js](../mobile/lib/location.js) `getCurrentLocation()` captures
   one fix (not continuous GPS): a warm recent OS fix when fresh/accurate, else a fresh high-accuracy
   read **capped at ~6s** so a cold GPS can't stall the submit.
3. **Background — submit/queue.** It POSTs `{ location: { lat, lng, accuracy }, timestamp, note }`:
   `POST /mobile/households/:id/not-home` · `/wrong-address` · `/lit-drop`, or
   `POST /mobile/voters/:voterId/survey` ([routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js))
   through [lib/offlineQueue.js](../mobile/lib/offlineQueue.js) `submitOrQueue`. A transport failure
   (including the **~20s `api` timeout** — [lib/api.js](../mobile/lib/api.js)) queues it instead.
4. **Server.** Creates a `CanvassActivity` (stamping `distanceFromHouseMeters` = haversine from the
   house), runs `recomputeHouseholdStatus`, and sets `household.status` / `lastActionAt` / `lastActionBy`
   (the save bumps `updatedAt`). Re-knocking the same door **in the same round deletes + replaces** the
   prior activity (important for delta logic — see F).
5. **Reconcile.** On a successful online write the helper re-patches the cache with the server's
   authoritative status. On a **hard** (4xx/5xx) failure it invalidates `['bootstrap']` to pull server
   truth back (so an optimistic change can't linger as a lie) and alerts. Other canvassers pick the
   door up on their next `changes` poll (F).

Offline actions queue on the device ([lib/offlineQueue.js](../mobile/lib/offlineQueue.js)) and flush
on **reconnect (a `@react-native-community/netinfo` listener in [map.jsx](../mobile/app/(app)/map.jsx)),
map focus, app-foreground, manual refresh, or the next recorded action**. The optimistic recolor already
stands, so a queued door looks done immediately and the "pending" badge counts only what's still unsent;
the reconnect listener drains it the moment signal returns, without the canvasser touching the app.

## D. Data sources / endpoints

| Endpoint | File | Returns | Notes |
|---|---|---|---|
| `GET /admin/households/map` | [routes/admin/households.js](../server/src/routes/admin/households.js) | `{ households, canvassers[], activities[], total }` | Params: `campaignId, from, to, status, userId, questionKey, option, includeActivities`. Heavy: all matching households + 5 parallel queries (voters, surveys, last-activity aggregate, canvasser directory, optional activities). `activities` (pings) only when `includeActivities=1`. |
| `GET /mobile/bootstrap` | [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) | `{ user, campaign, surveys, households[], voters[], books[], generatedAt }` | Canvasser-scoped to assigned books on active rounds; fully-voted doors dropped. The map's initial load. |
| `GET /mobile/changes?since=` | [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) | `{ serverTime, households[], voters[] }` | Delta: households with `updatedAt > since` (+ their voters). Client patches the bootstrap cache so multiple canvassers stay in sync. |
| `GET /mobile/me/today?since=` | [routes/mobile/me.js](../server/src/routes/mobile/me.js) | Shift stats | Powers the bottom-sheet progress (doors, responses, pace, distance). |
| `GET /admin/reports/canvassers/:userId/path` | [routes/admin/reports.js](../server/src/routes/admin/reports.js) | One canvasser's pings | Feeds the single-canvasser path map. |

`GET /admin/households/map` activity shape: `{ id, householdId, actionType, timestamp,
location:{lng,lat,accuracy}, distanceFromHouseMeters, canvasser:{id,firstName,lastName} }`.

## E. Rendering

- **Web (Mapbox GL JS):** GeoJSON **sources + layers** — a symbol layer for household icons, a circle
  layer for pings, a line layer for ping→house links. House icons are drawn to a canvas at runtime.
  Updates call `source.setData(...)`, so a refresh re-paints features **without** recreating DOM
  markers or moving the camera (auto-fit runs once via a `_didFitBounds` flag).
- **Mobile (`@rnmapbox/maps`):** native **`ShapeSource` + `SymbolLayer`** driven by **one** GeoJSON
  feature collection — deliberately **not** per-pin `MarkerView` components (thousands would block
  pinch-zoom and melt the device) and **no clustering**. House pins are pre-baked PNGs in
  [mobile/assets/icons](../mobile/assets/icons) (`house-unknocked/not_home/surveyed/wrong_address`;
  `lit_dropped` reuses the surveyed icon). Building & book progress markers (grey/yellow/green) are
  generated by [scripts/genMarkerIcons.js](../mobile/scripts/genMarkerIcons.js) (SVG→PNG via `sharp`).
- **Buildings grouping:** [lib/buildings.js](../mobile/lib/buildings.js) rounds coordinates to ~1m and
  collapses ≥2 units at one spot into a single building marker with `total`/`done`/`status`.

## F. Live updates & intervals

| Surface | Interval | Where |
|---|---|---|
| Web admin map | 20s (when Live on); **paused in background**; `keepPreviousData` | [MapPage.jsx](../client/src/pages/MapPage.jsx), [LiveStatus.jsx](../client/src/components/LiveStatus.jsx) |
| Mobile `changes` (door/voter sync) | 30s; `refetchIntervalInBackground:false` | [map.jsx](../mobile/app/(app)/map.jsx) |
| Mobile `me/today` (shift stats) | 120s | [map.jsx](../mobile/app/(app)/map.jsx) |

The web map uses **full refetch**, not a `since=` delta, on purpose: re-knocks **delete + replace**
the prior `CanvassActivity`, so a delta would leave **stale pings** on the map; a full refetch always
shows the truth. A delta endpoint would only be worth it for sub-10s refresh on very large campaigns,
and would then need to reconcile deleted pings.

Recording an action does **not** wait for any of these intervals: the optimistic cache patch (C)
recolors the door immediately and the submit runs in the background. The 30s `changes` poll only
*reconciles* other canvassers' edits — it returns only households the server changed since `since=`, so
it won't revert a local optimistic change the server hasn't recorded yet.

**A full `bootstrap` refetch is the one thing that *would* clobber an optimistic recolor** — it returns
the server's current state, which lags a just-recorded action by the round-trip, so one resolving right
after a tap reverts the pin to its pre-action color (a blue→grey→blue flicker). To prevent that, every
`['bootstrap']` reader sets **`refetchOnMount: false`** (map, household, survey, building) so opening a
house — or the map remounting after a survey — never kicks off a stale full refetch; and
`optimisticSubmit` calls **`cancelQueries(['bootstrap'], { revert: false })`** to discard any bootstrap
fetch already in flight at record time (e.g. a manual pull-to-refresh). Bootstrap now refetches only on
first load, manual pull-to-refresh, campaign switch, or a hard-fail `invalidate`; liveness in between is
the `changes` delta. (`refetchOnWindowFocus` is already globally `false`; `focusManager` tracks
app-foreground via AppState, not screen navigation.)

**The hard guarantee — pending overlay.** Belt-and-suspenders on top of the above, so NO refetch from
any source (now or future) can revert a fresh recolor: [lib/recordAction.js](../mobile/lib/recordAction.js)
keeps a registry of statuses the canvasser set but the server hasn't confirmed (`markPendingHousehold` on
the optimistic write), and **every server-sourced write to `['bootstrap']`** — the bootstrap `queryFn`
result *and* the `changes`-delta merge in [map.jsx](../mobile/app/(app)/map.jsx) — runs its households
through `reconcilePendingHouseholds()`, which re-applies the pending status and clears each entry once the
server's own data matches (or a ~5-min TTL elapses). On a hard failure the entry is dropped and bootstrap
invalidated. Net effect: a pin can't be reverted to pre-action state, no matter which refetch wins the race.

## G. Status colors & legend

Canonical palette (hex): `unknocked #9ca3af`, `not_home #3b82f6`, `surveyed #22c55e`,
`wrong_address #ef4444`, `lit_dropped #a855f7`, plus `voted #14b8a6`.

- **Mobile (canonical):** [lib/theme.js](../mobile/lib/theme.js) `colors.status` / `colors.statusLabels`
  — used by all mobile maps for legend dots and ping colors. (`mobile/components/StatusColor.js` holds
  the same values but is currently unused/legacy.)
- **Web:** `STATUS_COLORS` / `STATUS_LABELS` in [MapPage.jsx](../client/src/pages/MapPage.jsx).

## H. Config

- **Mapbox token — web:** the server returns it via `GET /admin/config/mapbox-token` (env
  `MAPBOX_PUBLIC_TOKEN`, a `pk.*` token); `MapPage` sets `mapboxgl.accessToken`.
- **Mapbox token — mobile:** `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` (public, bundled; the *download* token
  `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is build-time/secret — see [mobile/README.md](../mobile/README.md)).
- **Base styles:** [lib/mapStyles.js](../mobile/lib/mapStyles.js) + `useMapStyle()` (Street default;
  Satellite/Hybrid/Outdoors/Dark) drive the mobile [MapStyleControl](../mobile/components/MapStyleControl.jsx).

## I. Invariants / gotchas

- **No geocoding.** Coordinates are imported, not derived; uncoordinated rows never reach a map.
- **Native symbol layers, not MarkerView; no clustering** — one GeoJSON feature collection per layer.
- **Fully-voted doors drop off** the canvasser's bootstrap/map (see EARLY_VOTING.md).
- **Pings are per-action GPS stamps**, not live tracking — there is no continuous location feed.
- **Recording is optimistic-first.** The pin recolors before the network call; GPS + submit run in the
  background ([lib/recordAction.js](../mobile/lib/recordAction.js)). Never re-add an `await` before the
  cache patch — that ordering was the cause of the field "did it register?" delay.
- **An optimistic recolor can't be reverted by a refetch.** Three layers: every `['bootstrap']` reader
  sets `refetchOnMount: false` (no stale full refetch on screen (re)mount); `optimisticSubmit`
  `cancelQueries(['bootstrap'])` kills any in-flight refetch at record time; and the **pending overlay**
  (`reconcilePendingHouseholds` in [recordAction.js](../mobile/lib/recordAction.js), applied to both
  server writers in [map.jsx](../mobile/app/(app)/map.jsx)) re-holds the status until the server confirms.
  Don't drop these or add a bootstrap `refetchInterval` — use the `changes` delta for liveness.
- **`api` has a ~20s timeout** ([lib/api.js](../mobile/lib/api.js)); a bare fetch with none let weak
  signal hang ~60s before an action would queue offline.
- **Writes are double-tap-safe (defense in depth).** Survey/action submits are fire-and-forget +
  navigate-away, which made a fast double-tap create two rows. Three layers now: the Save/action
  buttons disable on first press (`firedRef` + `isSubmitting`); `optimisticSubmit` ignores a second
  in-flight call to the same path ([recordAction.js](../mobile/lib/recordAction.js)); and `router.push`
  to a detail screen goes through `guardedPush` ([lib/navGuard.js](../mobile/lib/navGuard.js)) so a
  double-tap can't stack two identical screens. The hard guarantee is server-side — the survey route
  **upserts** on `(voter, pass)` against a **unique index** (see [METRICS.md](METRICS.md)), so a race
  can never persist two `SurveyResponse` rows; this also preserves the "re-survey replaces, counts
  once" self-heal, just atomically.
- **The offline queue flushes on reconnect** (NetInfo listener in [map.jsx](../mobile/app/(app)/map.jsx))
  as well as on focus / foreground / refresh / next-action. NetInfo is a native module — it ships only in
  a native build, never an OTA (a bundle importing it would crash an older binary).
- **Mobile is battery-conscious** (delta + 30s/120s cadence + background pause; plain location dot, no
  compass; follow-mode auto-exits on pan/background). **Web is live** (~20s) because admins are at a
  connected desk.
- **An embedded map must re-measure itself.** The full-page admin map ([MapPage.jsx](../client/src/pages/MapPage.jsx))
  is `100vh` from the first paint, so its Mapbox container is stable. The client-report map
  ([ClientReportMap.jsx](../client/src/components/ClientReportMap.jsx)) is embedded inside a tab below
  tall content, so its container finishes sizing a tick *after* Mapbox initializes — leaving a
  zero-height canvas: **tiles load and the style switcher works, but the map area is blank, with no
  console error.** Two fixes together: size the container with **inline** `height` / `minHeight:0`
  (not Tailwind `h-[..vh]` + `flex-1` + `absolute inset-0`, which has been flaky here — same lesson as
  the inline-`100vh` full-bleed rule), and attach a `ResizeObserver` that calls `map.resize()` whenever
  the container settles. That blank-map-with-tiles-loading signature always means a size-zero canvas.

## J. Frontend file map

| File | Renders |
|---|---|
| [client/src/pages/MapPage.jsx](../client/src/pages/MapPage.jsx) | Web admin map: sources/layers, filters, Live toggle, household + ping detail panels. |
| [client/src/lib/mapRender.js](../client/src/lib/mapRender.js) | Shared pin rendering (`drawHouseIcon` / `householdsToGeoJSON` / `registerLayers`) used by both the admin map and the client-report map. |
| [client/src/components/ClientReportMap.jsx](../client/src/components/ClientReportMap.jsx) | Read-only client-report coverage map: frozen snapshot points, client-side status/answer filtering, no canvassers; ResizeObserver-resized (see gotcha §I). |
| [client/src/components/LiveStatus.jsx](../client/src/components/LiveStatus.jsx) | The "Live · updated Xs ago" toggle/indicator + Refresh. |
| [mobile/app/(app)/map.jsx](../mobile/app/(app)/map.jsx) | Canvasser map: pins, buildings, bottom sheet, follow mode, offline badge, `changes`/`me/today` polling. |
| [mobile/app/(app)/admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Mobile admin overview map + canvasser-pings toggle. |
| [mobile/app/(app)/admin/canvasser/[id]/map.jsx](../mobile/app/(app)/admin/canvasser/[id]/map.jsx) | One canvasser's path of action pings. |
| [mobile/app/(app)/books.jsx](../mobile/app/(app)/books.jsx) | Books overview map (centroid markers). |
| [mobile/lib/buildings.js](../mobile/lib/buildings.js) · [mobile/lib/mapStyles.js](../mobile/lib/mapStyles.js) · [mobile/lib/location.js](../mobile/lib/location.js) | Buildings grouping · base-style switcher · per-action location capture. |
