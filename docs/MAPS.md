# Maps

How the maps work across the whole app — what the dots mean, where they come from, and how a
canvasser knocking a door turns into a pin you can see on a screen.

- **Part 1 — For everyone** is plain language: reading the maps and what they show.
- **Part 2 — Technical reference** is for developers (and Claude): every map screen, the endpoints
  that feed them, how they render, and the refresh/intervals.

Related: [IMPORTS.md](IMPORTS.md) (where coordinates come from), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(books/turf the maps are scoped to), [EARLY_VOTING.md](EARLY_VOTING.md) (voted doors dropping off the
map), [METRICS.md](METRICS.md) (the numbers behind the pins), [DATE_FILTERS.md](DATE_FILTERS.md)
(the date-range control — on the map a window narrows the pins to interacted-with doors; the admin map
now opens on **Today**), [AUDIT.md](AUDIT.md) (the GPS-audit **flag overlay** + the Audit page that
reviews it).

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
| Amber | Refused | Someone answered but declined to participate — a real contact, just not a survey. (Survey campaigns only.) |
| Red | Wrong address | The door doesn't exist / bad data. |
| Purple | Lit dropped | Literature was left (no conversation). |
| Pink | No soliciting | A posted sign ended the visit. The canvasser reached the door, so it **is** a knock — but nobody answered, so it is not a contact. (All campaign types.) |
| Slate | Restricted | The home is physically inaccessible — gated community, locked building, no legal access. Recorded, but not a knock. (All campaign types.) |

**This palette is shared, not per-map.** `lib/statusColors.js` (mirroring `mobile/lib/theme.js`) is the
one source, so the same status is the same color on the admin map, the canvasser app, the charts, the
coverage bars — and on the **Turf Cutting** map, where a house's fill is its status *for the selected
round* and the ring around it is its book's color (see
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) → *Watching a round on the cut map*).

**Refused vs. the misses.** Amber sits deliberately *between* the wins and the misses. Not home (blue)
and Wrong address (red) mean nobody was reached; **Refused (amber) means a person answered the door** —
they just declined to take the survey. It still counts as a knock and as a contact, so it gets its own
distinct color rather than blending in with the misses (see [METRICS.md](METRICS.md) for the "Reached a
person" rate). It only appears on survey campaigns.

**No soliciting vs. Restricted.** These are the two dispositions where nobody answered but the visit
still ended, and they are counted in *opposite* ways — the difference is whether the canvasser reached
the door. **No soliciting (pink)** means they did: they walked up, read the sign, and honored it, so the
walk is real work and it counts as a knock (and as a billable door, with no opt-in). **Restricted
(slate)** means they never got there — a gate, a locked lobby — so it is not a knock at all. Neither is
a contact: nobody came to the door in either case, so neither lifts the "Reached a person" rate.

A no-soliciting sign is a *campaign policy* choice, not a legal one — political canvassing is generally
exempt from no-soliciting ordinances, which is why Doorline records the door rather than suppressing it.
Admins who don't want anyone sent back can drop those homes at cut time (see
[PASSES_AND_TURF.md](PASSES_AND_TURF.md)).

**Restricted (slate) is the odd one out.** A slate pin means the canvasser **couldn't reach** the home
at all (gated, locked, no access). It's offered on **every** campaign type, and it's deliberately *not*
a knock — it's recorded and shown, but it never counts toward knocks, rates, or "houses knocked" (its
own slate coverage segment instead). See [METRICS.md](METRICS.md).

Doors where **everyone has already voted** drop off the canvasser's map automatically, so the field
team only sees doors that still need work (see [EARLY_VOTING.md](EARLY_VOTING.md)).

## Apartment buildings

When several units share the same spot (an apartment building), the map groups them into **one
building marker** instead of stacking pins on top of each other. The marker shows progress like
"**12 units · 5 done**", and tapping it opens the list of units. This works the same way on the
**mobile canvasser map**, the **turf-cutting map**, and the **web admin map**.

**Why this matters:** each apartment unit is its own door in Doorline. A vendor geocodes every unit
of a building to one rooftop, so without grouping the map would draw 84 house pins in exactly the
same pixel — you'd see one house, click it, and get one of the 84 with no way to know the other 83
were under it. Grouping them into a building is what makes those doors visible and reachable.

On the web admin map you'll see:

- A **building icon** wherever two or more doors share a pin, with a **"N doors"** label once you
  zoom in far enough to read it. Its color rolls up the doors underneath — grey (none worked),
  amber (some worked), green (all worked). It's a mix, so it never borrows a single door's color.
- A count in the header — "**39 buildings · 485 stacked doors**" — and the same note in the filter
  sidebar, so the number of doors you *can't* see individually is never a mystery.
- **Clicking a building opens the full door list**, each with its status and last visit. Pick one to
  open it as usual; a **"← Back to all N doors at this pin"** bar takes you back to the list.
- If you reach one of those doors another way (address search, a **View on map** link), the Back bar
  is there too — so a door inside a 84-unit building always says so.

Two doors that are *near* each other but not identical still get their own pins. If they overlap on
screen and your click hits both, the map now opens the same list instead of silently picking one.

**Building grouping is not clustering.** A building sits at the doors' real location, never merges
with the building next door, and never dissolves as you zoom. Doorline does not cluster map pins.

## The mobile canvasser map

A canvasser opens the app and sees the doors in the books assigned to them. They can:

- **Tap a pin** to pull up the household — the address, its status, how many voters live there (and
  how many are already surveyed), when it was last visited, and the voters themselves. Each voter
  reads **Party · Age · Gender** ("Democratic · 34 yrs · Female"), plus a **✓ Voted** tag and their
  survey status. Voter files are patchy, so whatever's missing is simply left out. **Open** takes you
  into the door, where every voter reads exactly the same way — the sheet and the door screen used to
  disagree (one showed age, the other showed precinct), which confused people.
- **Mark a door and see it instantly.** Tapping Not home / Wrong address / Refused / Restricted /
  Survey / Lit drop recolors the pin **right away** — the GPS stamp and the save to the server happen in
  the background, so you never wait on a spinner to know it registered. (Refused turns the pin amber and
  is offered on survey campaigns only; Restricted turns it slate and is offered on all campaign types.)
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
- **Apartment buildings as one marker.** Doors that share a pin are drawn as a building icon with a
  "N doors" label; the header and sidebar count them, and clicking one lists every door inside. See
  [Apartment buildings](#apartment-buildings) above — this is why the "households shown" number can
  be larger than the number of pins you can pick out.
- **Doors excluded from books, called out rather than hidden.** If turf was cut with **Remove
  apartments**, those doors are still here — this map is the record of what exists, not of what was
  cut. The Layers sidebar counts them and offers **Show / Dim / Hide**, and each one's panel carries a
  **Not in books** badge. Exclusion is campaign-wide, so the badge never claims a particular walk list.
- **Filters**: by status, by canvasser, by date range, and by a specific survey answer — and, once
  the campaign has **two or more walk lists**, an in-page **"All walk lists"** select that narrows
  the doors and pins to one walk list (the mobile admin map offers the same as a **walk-list chip**
  in its filter row; single-list campaigns show neither). A walk-list deep link still works and
  simply arrives with that control pre-set.
- **Filter to one canvasser and the colors become *their* work.** By default a door is colored by its
  **global** status — has *anyone* ever surveyed it, across the whole campaign. Filter the map to a
  **single canvasser** and each door instead shows **that canvasser's own disposition**: green only
  where *they* surveyed it, blue where *they* found nobody home, and so on — a door they never touched
  reads gray even if someone else worked it. So the colors show exactly what one person did, not the
  campaign's latest word on each door, and the **status chips** filter against that same per-canvasser
  status. Clear the canvasser filter and the colors go back to the shared "ever surveyed" status
  (scoping to a single round colors doors per-round instead — see §D). The pins never move; only their
  color changes.
- **Arriving pre-filtered.** Other screens can open the map with filters already set: the **Survey
  Explorer**'s per-entry "Map" link (web) and the answer drill's "View on map" (mobile) land here filtered
  to the same answer, canvasser, and date window they were showing — so the pins are exactly the
  doors behind the number you were looking at (see [SURVEYS.md](SURVEYS.md), and §D below for the
  parameters). The [Notes hub](NOTES.md)'s "view on map" similarly focuses a single door.
- **Live mode**: a "**Live · updated Xs ago**" toggle (on by default) that auto-refreshes the map
  about every 20 seconds, so pins and pings update as the field works — no page reload. You can pause
  it or hit Refresh on demand. It pauses on its own when the browser tab isn't in front.
- **Where a canvasser started and their latest door.** Filter to a **single canvasser** (with pings
  on) and the map rings two of their knocks: a **"Start"** ring on their **first** knock and a
  **"Latest"** ring on their **most recent** one — so you can see where the day began and where they
  are now, and trace the pings in between. A small legend names the two rings. The **mobile admin map
  shows the same** two rings when you audit one canvasser.
- **GPS-audit flags.** Turn on **"Show flagged entries"** to overlay the doors whose GPS looks off —
  marked from far away, in rapid succession, all from one spot, or with weak GPS — each a colored dot
  with a line back to the house, reviewable in place. The overlay opens on **Today** with the rest of
  the map; the full detection rules and a dedicated Audit page are in [AUDIT.md](AUDIT.md).
- **Overlaps.** Turn on **"Show overlaps"** to ring the doors that **more than one canvasser knocked in
  the same pass** — a turf collision worth a look, since once a door is knocked in a pass nobody should
  return until the next one. Each such door gets a hollow **amber ring** around its pin, the header
  shows an **"N overlaps"** count, and a door's detail panel names the other canvassers who worked it in
  that pass. When the collision includes a **same-round survey overwrite**, the door says so too —
  "X replaced Y's survey answers for VoterName" — and the earlier answers are preserved on the
  Duplicate Surveys report, restorable by an admin ([METRICS.md](METRICS.md) §Surveys). It's
  **pass-wide and day-agnostic**: it catches two canvassers on the same door in one pass
  even when they knocked on **different days** — a cross-day collision the date-windowed Timeline
  reconciliation can miss (the two overlap surfaces are compared in [METRICS.md](METRICS.md)). Off by
  default, and never shown on the read-only client map. Overlaps are never double-billed regardless
  (one knock per household × pass — see [METRICS.md](METRICS.md)); this is purely a coach-and-coordinate
  signal.

The admin map (web and mobile) is for **admins and team leads** — a team lead sees it only for the
campaigns they manage (see [ROLES.md](ROLES.md)).

## Other map views (brief)

- **Admin overview map (mobile)** — the same all-doors view on a phone, with an optional canvasser-pings
  toggle.
- **A single canvasser's path** — one canvasser's pings over a date range, to review their day.
- **Books overview** — a marker per book at its center, colored by how much of it is done; tap one to
  jump into that book on the map.

## Where the dots come from (and how live it is)

- **Coordinates come from your voter file — or are looked up when it doesn't have them.** If a row
  includes latitude/longitude, that's where the pin lands. If it doesn't, the address is **geocoded**
  (looked up) at import so the door still gets a pin; only rows we genuinely can't place are left off
  the map (see [IMPORTS.md](IMPORTS.md)).
- **A "ping" is a GPS stamp.** When a canvasser logs an action, the app records where the phone was at
  that moment. That's the dot you see on the admin map, along with how far it was from the house.
- **How fresh:** the web map refreshes ~every 20s; the mobile app keeps doors in sync ~every 30s.
  Mobile stays deliberately light on battery (canvassers open and close the app all day), while the
  web map can be more live because admins sit at a connected desk.
- **What's live vs. what needs a refresh:** pin fixes and status changes sync in ~30s, but **moving a
  door to another book, merging/splitting books, or reassigning a canvasser only show up after a full
  refresh** (pull-to-refresh / reopen the campaign). See
  [PASSES_AND_TURF.md → How field phones get these edits](PASSES_AND_TURF.md).

## Approximate pins, and fixing them

A **looked-up (geocoded)** pin is a best guess — it can land a house or two off, especially in rural
areas or on long roads. The web admin map flags these with a faint **amber ring** around the pin, and
the door's detail panel shows **"Approximate location."** To fix one, an admin **drags the pin** to the
right spot ("Move pin" → Save); a team lead can also fix it from the field in the mobile app. Once it's
moved the amber ring disappears and the door reads **"Pin corrected."** Four things worth knowing:

- **Only leads and admins can move a pin.** Canvassers still see the "Approximate location" badge, but
  the fix is a data change with an audit trail, so it belongs with the people accountable for the data
  — and leaving it open to anyone let a faked door be laundered (record it from home, collect a "far
  from house" flag, then drag the pin onto your own house). If a canvasser spots a bad pin, they tell
  their lead.
- **Moving a pin doesn't re-cut books.** A correction only fixes *where the dot sits* — the door keeps
  whatever book (turf) it's already in until you re-cut ([PASSES_AND_TURF.md](PASSES_AND_TURF.md)).
- **Canvassers see corrections automatically** on their next sync — you don't have to tell them.
- A report you've already **published** keeps the map it was frozen with; republish it to pick up
  corrections made afterward.

**It can also clear a stale GPS flag.** A canvasser who walked to the real house while the pin was in
the wrong place gets flagged "far from house" — and the flag used to stick forever, since the distance
is measured once, when the door is recorded. Correcting the pin now drops such an entry to **low**
severity. See [AUDIT.md](AUDIT.md) for the exact rule (it can only ever lower a flag, and it won't
help if the person who moved the pin is the one who recorded the door).

---

# Part 2 — Technical reference

## A. The maps at a glance

| Map | Platform | Library | Renders | Data source | Refresh |
|---|---|---|---|---|---|
| Web admin map — [MapPage.jsx](../client/src/pages/MapPage.jsx) | Web | Mapbox GL JS | Household pins, building markers, canvasser pings + lines, first/last-knock rings | `GET /admin/households/map` | ~20s when **Live** on |
| Canvasser map — [map.jsx](../mobile/app/(app)/map.jsx) | Mobile | `@rnmapbox/maps` | House pins, building markers, bottom sheet | `GET /mobile/bootstrap` + `/mobile/changes` | 30s delta |
| Admin overview map — [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Mobile | `@rnmapbox/maps` | Household pins + optional pings, first/last-knock rings, opt-in overlap rings; web-parity door sheet | `GET /admin/households/map` | ~20s when Live on |
| Canvasser path — [admin/canvasser/[id]/map.jsx](../mobile/app/(app)/admin/canvasser/[id]/map.jsx) | Mobile | `@rnmapbox/maps` | One canvasser's action pings | `GET /admin/reports/canvassers/:id/path` | one-shot |
| Books overview — [books.jsx](../mobile/app/(app)/books.jsx) | Mobile | `@rnmapbox/maps` | Book centroid markers | `GET /mobile/bootstrap` | bootstrap |
| Turf cutting map — [TurfsPage.jsx](../client/src/pages/TurfsPage.jsx) | Web | Mapbox GL JS + Draw | Turf polygons, draw tools | turf endpoints | on-demand |

Turf polygons/cutting are documented in [PASSES_AND_TURF.md](PASSES_AND_TURF.md) — not repeated here.

## B. How a door gets on the map

Households store a GeoJSON point: `Household.location = { type: 'Point', coordinates: [lng, lat] }`
([models/Household.js](../server/src/models/Household.js)). Coordinates come from the CSV
(`p_Latitude` / `p_Longitude`) when present, otherwise the address is **geocoded** at import via
Geocodio ([services/import/geocode/geocodeService.js](../server/src/services/import/geocode/geocodeService.js));
rows that still have no usable point are rejected. Each door records **`coordSource`**
(`file` | `geocodio` | `corrected`) and **`coordConfidence`** (`exact` | `interpolated` | null) — see
[IMPORTS.md](IMPORTS.md) for the import side.

### Coordinate provenance & pin correction
A geocode can land off-spot (usually `interpolated` matches). The maps surface this and let it be fixed:

- **Approximate pins are flagged.** The web admin map draws an **amber ring** under any `interpolated`
  pin ([lib/mapRender.js](../client/src/lib/mapRender.js)), and the door detail panel shows an
  "Approximate location" / "Pin corrected" badge.
- **Correcting a pin.** An admin drags the pin (MapPage "Move pin" → `PATCH
  /admin/campaigns/:id/households/:householdId/location`); a lead can fix it in the field (drop it at
  their GPS spot or drag it → `POST /mobile/households/:householdId/location`). Both go through the shared
  `updateHouseholdLocation` service ([services/households/updateHouseholdLocation.js](../server/src/services/households/updateHouseholdLocation.js)),
  which validates a **state-bounding-box** guardrail, sets `coordSource='corrected'` + provenance
  (`correctedBy`/`correctedAt`/`previousLocation`), and logs a `HouseholdLocationChange` audit row. A
  `scope:'building'` move repositions every unit sharing the pin. **A correction never re-cuts turf** —
  book membership is `turfId` (set at cut), not derived from coordinates — and `walkOrder`/`status` are
  untouched.
- **Both paths enforce the SAME policy: `canManageCampaign`** — org admin (or super, who still needs a
  support grant to enter the org at all), or a team lead for a campaign they manage. The web route gets
  it from `requireCampaignManager`; the mobile route calls the same function inline with
  `household.campaignId`, because that route isn't campaign-nested. A canvasser is refused with
  `403 { code: 'FORBIDDEN_ROLE' }` and a message written to be read in the app's alert. **Order
  matters on the mobile route:** the gate replaces `assertHouseholdAccess`, whose roster check would
  otherwise 403 a lead who manages the campaign but was never rostered onto it — a policy the web path
  doesn't have. Covered by `server/test/mobilePinRole.int.test.js`.
- **A correction can lower a stale `far` GPS flag** on entries recorded before the move — see
  [AUDIT.md](AUDIT.md) §B.7. It reads `coordSource`/`correctedAt`/`correctedBy`; nothing here writes to
  `CanvassActivity`, and the frozen `distanceFromHouseMeters` is never rewritten.
- **Caveat:** a published `ClientReportMapPoint` snapshot is frozen at publish time and won't reflect a
  later correction until the report is republished.

## C. How an action becomes a ping

Recording is **optimistic-first**: the UI updates before the network, so the pin recolors the instant
a canvasser taps an action — the GPS stamp and the server write happen in the background and never
block the screen. (This replaced an older flow that awaited GPS **and** the full network round-trip
before recoloring, which made doors feel unrecorded on weak signal — the bare fetch could hang ~60s.)

1. **Instant (synchronous).** The tapped action patches the `['bootstrap']` React Query cache —
   `household.status` (and the client-computed building aggregate) recolor this same frame — via the
   shared helper [lib/recordAction.js](../mobile/lib/recordAction.js) (`recordHouseholdAction` /
   `optimisticSubmit`). The cache is mirrored to a cache-directory file
   (`canvass.bootstrap.json` via [lib/cache.js](../mobile/lib/cache.js) — formerly AsyncStorage,
   whose Android SQLite limits broke large turfs; the cache directory is backup-excluded on both
   OSes, which the privacy policy's device-storage disclosure relies on) so it survives a cold start. The screen
   returns to the map immediately; it never `await`s the network.
2. **Background — GPS.** [lib/location.js](../mobile/lib/location.js) `getCurrentLocation()` captures
   one fix (not continuous GPS): a warm recent OS fix when fresh/accurate, else a fresh high-accuracy
   read **capped at ~6s** so a cold GPS can't stall the submit.
3. **Background — submit/queue.** It POSTs `{ location: { lat, lng, accuracy }, timestamp, note }`:
   `POST /mobile/households/:id/not-home` · `/wrong-address` · `/refused` · `/restricted` ·
   `/no-soliciting` · `/lit-drop`, or
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
| `GET /admin/households/map` | [routes/admin/households.js](../server/src/routes/admin/households.js) | `{ households, canvassers[], activities[], total, truncated }` | Params: `campaignId, from, to, status, userId, questionKey, option, optionId, surveyTemplateId, includeActivities, effortId, passId, bbox`. **`surveyTemplateId`** (optional, validated ObjectId) scopes the answer filter (`questionKey` + `option`/`optionId`) to **one survey template** — question keys and option ids are label slugs unique only *within* a template, so on a multi-survey campaign an unscoped filter can union answers from two templates whose slugs collide. Both clients now send it (web `MapFilters`/`MapPage`/`AnswerMiniMap`, mobile `admin/map.jsx` — stamped from the survey-results payload's `surveyTemplate.id` when an answer chip is set, or seeded from the drill-in params); **without it the legacy cross-template union applies** (old mobile builds, legacy deep links — a deep link without the param briefly queries cross-template until the survey query resolves the current template's id). **`bbox=west,south,east,north`** (both clients send it after the first auto-fit, debounced per settled pan/zoom) narrows the pull to the viewport via `$geoWithin` on the household `2dsphere` index; an absent/degenerate/near-world bbox falls back to the unbounded pull (50k cap + `truncated`). For smooth panning the clients send a **padded buffer** box and skip the refetch while the viewport stays inside the last padded box — web pads ~4× the viewport (`inflateBbox` in `MapPage.jsx`, containment-gated), mobile pads ~10%/side + epsilon-gates (`admin/map.jsx`) — so small pans cost no request. Each household row carries `doNotKnock` **and `excludedFromTurf`** — projected purely so the client can count/badge/dim them; **neither is ever a server filter** (§I). Each household's `surveys[]` carries META only (`id, submittedAt, voter, canvasser, note`) — **`answers[]` moved to the lazy per-door `GET /admin/households/:householdId/surveys`** (same lead-scope guard, optional `passId`), fetched on open by both the web detail panel and (now, at web parity) the mobile door sheet. Otherwise: matching households + 5 parallel queries (voters, survey meta, last-activity aggregate, canvasser directory, optional activities). `activities` (pings) only when `includeActivities=1`. **With `passId`** the door set is scoped to that round's books AND each door's `status`/`lastAction`/surveys are resolved **per-round** (`getPassStatusMap` + `passId`-scoped activity/survey queries; a door untouched that round reads `unknocked`) — the audit reflects the selected round, not the global latest. The `status=` **filter** is also applied against the per-round status when `passId` is set, so the door set matches the colors shown. **With `userId`** (the canvasser filter) each door's `status`/`lastAction` are resolved to **that canvasser's OWN** disposition (`getUserStatusMap` — `surveyed` if they surveyed it, else their latest action; a door they never touched reads `unknocked`), the last-activity aggregate is narrowed to their own knocks, and the `status=` filter tests that per-user status too — so the colors AND the door set are one canvasser's work, not the global "ever-surveyed" status. **Without `userId`/`passId`** the row ships the global `Household.status` (unchanged legacy behavior); the client renders `status` → pin color either way, so the recolor is automatic and needs no client change. (`userId` **takes** the `statusMap` branch but still honors `passId` — `getUserStatusMap(userId, …, passId)` scopes to that round — so `userId`+`passId` yields *that canvasser's disposition within that round*.) The admin map screen also accepts a **client-side** `?household=<id>` URL param (web `MapPage`, and now mobile `admin/map.jsx` with a `&focusAt=` nonce) that focuses a single door — used by the [Notes hub](NOTES.md) "view on map" link; it opens the map on **all-time** so an old door still loads, then flies to the pin. Not a server param. |
| `GET /mobile/bootstrap` | [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) | `{ user, campaign, surveys, households[], voters[], books[], generatedAt }` | Canvasser-scoped to assigned books on active rounds; fully-voted doors dropped. The map's initial load. Voters project `party / gender / dateOfBirth / surveyStatus` (+ a derived `voted`) — everything the shared `VoterMeta` line needs and nothing it doesn't. **`precinct` was removed**: once the door screen stopped showing it, no mobile surface read it from this payload, and it was being shipped for every voter on every device. (The voter *profile* still shows precinct — it's fed by `GET /mobile/voters/:id`, a different, unprojected query.) |
| `GET /mobile/changes?since=` | [routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js) | `{ serverTime, households[], voters[] }` | Delta: households with `updatedAt > since`, plus voters on **two tracks, unioned**: ALL voters of each changed household, **and voters whose own `updatedAt` moved** — so a pure identity edit (admin correction, Person propagation, re-import reconcile) reaches phones in ~30s without a re-bootstrap. Client patches the bootstrap cache so multiple canvassers stay in sync. Full contract + consequences in [PASSES_AND_TURF.md](PASSES_AND_TURF.md) §G. |
| `GET /mobile/me/today?since=` | [routes/mobile/me.js](../server/src/routes/mobile/me.js) | Shift stats | Powers the bottom-sheet **Today's Progress** (doors, responses, remaining, pace, distance). Refetched on the 120s poll **and immediately when a knock/survey is confirmed** — the record flow invalidates `['mobile','me']` (see the intervals note below). |
| `GET /admin/reports/canvassers/:userId/path` | [routes/admin/reports.js](../server/src/routes/admin/reports.js) | One canvasser's pings | Feeds the single-canvasser path map. |
| `GET /admin/reports/flags` | [routes/admin/reports.js](../server/src/routes/admin/reports.js) | `{ summary, entries[], … }` | The GPS-audit **flag overlay** — a *separate* query MapPage runs only when "Show flagged entries" is on, so toggling flags never refetches households. Live-detected, not stored. Full spec in [AUDIT.md](AUDIT.md). |
| `GET /admin/reports/overlap-doors` | [routes/admin/reports.js](../server/src/routes/admin/reports.js) | `{ householdIds:[…], doors:[{ householdId, passes:[{ passId, roundLabel, canvassers:[{userId,name}] }] }], total }` | The **Overlaps** overlay's data — doors knocked by **2+ distinct canvassers in the same pass** (`computeOverlapDoors`, [services/reports/overlaps.js](../server/src/services/reports/overlaps.js)). **Detection is ANCHORED, not windowed** (2026-07-19): the pipeline groups over the **whole pass** but surfaces a collision only when **at least one of its knocks falls inside `[from, to)`** — so a door knocked the 5th and again the 11th rings while you view the 11th, and `doors[].passes[].canvassers[]` carries each canvasser's `lastAt` + an `inRange` flag so the UI can name the *earlier* knock. Each door is **self-contained** — an org-scoped `household{…}` (address + `location`), a `totalCanvassers` count, and per-canvasser `firstName`/`lastName`/`actionType` deliberately mirroring `/overlaps`' field names so ONE card component (`client/src/components/OverlapDoorCard.jsx`) renders both the Timeline's windowed reconciliation list and the anchored **Overlaps report** (`/campaigns/:campaignId/overlaps`, and mobile's `admin/overlaps`, which now carries the shared `CampaignChip` — this endpoint's required `campaignId` had no on-screen source there before). The per-canvasser action comes from a `$max` over a composite `{at, action}` object — BSON compares objects field-by-field, so it yields the latest knock *and* its action without a `$sort` stage or `$top` (unused elsewhere in this codebase, so its server support is unproven). Collisions with no in-window knock are returned as **`outOfRangeTotal`** (the "+N outside your dates" hint) rather than dropped. The date test is an expression inside `$group`, never a `$match` — filtering first would make the cross-day case invisible instead of countable. Params: **`campaignId` is REQUIRED** (400 otherwise; unscoped this aggregated the org's entire ledger), plus optional `effortId`/`passId`/`from`/`to`/**`userId`** (collisions *involving* that canvasser — applied after grouping, since narrowing rows to one person first would leave nothing to collide). Lead-gated like its neighbors. Each pass entry also carries **`effortName`**, and `roundLabel` is prefixed with the walk-list name (*North · Pass 2 · GOTV*) **only when the campaign has 2+ efforts** — `roundNumber` restarts per walk list, so "Pass 2" alone is ambiguous there; single-list campaigns keep the short label (the shared `passLabeler` in [overlaps.js](../server/src/services/reports/overlaps.js) does the same for `/overlaps` and the timeline reconciliation; an org-wide match with no `campaignId` falls back to "the surfaced passes span 2+ efforts"). A *separate* query both maps run only when "Show overlaps" is on (so toggling it never refetches households). **It is NOT polled** (2026-07-19): a whole-pass aggregation whose answer barely moves minute to minute was re-running every 20s for as long as the layer stayed open; it now fetches once per scope change, so it is deliberately outside the live-poll set on both clients. It still catches the cross-day collisions the date-scoped `/overlaps` structurally cannot see (see the anchoring note above). The endpoint returns **ids only**: each map rings whichever of those doors are currently loaded in the viewport (coordinates come from the loaded households via `overlapDoorsToGeoJSON`), so the `total` count can legitimately exceed the number of rings visible at a given zoom/pan. Full model + the two-surfaces comparison in [METRICS.md](METRICS.md) §D. |

`GET /admin/households/map` activity shape: `{ id, householdId, actionType, timestamp,
location:{lng,lat,accuracy}, distanceFromHouseMeters, canvasser:{id,firstName,lastName} }`.

### Deep links into the admin maps (client-side URL params)

Both admin maps accept **client-side** params that seed their filters — none of these are server
params; the map turns them into its normal filter state and fetches as usual. The main sender is
the **answer drill-in** ([SURVEYS.md](SURVEYS.md) §J): the Survey Explorer's per-entry "Map" link and the
mobile drill's "View on map".

**Web ([MapPage.jsx](../client/src/pages/MapPage.jsx))** — read once in the state initializers:

| Param | Seeds |
|---|---|
| `?questionKey` + `&option` (+ `&optionId` + `&surveyTemplateId`) | The **survey-answer filter**. Links must always carry the option **text** — the answer chips key on it — with `optionId` alongside for id-native matching (the same dual-read as reporting, §C of SURVEYS.md), and `surveyTemplateId` to keep the filter template-scoped (a legacy link without it falls back to the current survey's template once that query loads — cross-template until then). |
| `&userId` | The **canvasser filter** (pre-existing). |
| `&from` / `&to` | A **touched custom date range** (skips the Today default). |
| `&effortId` / `&passId` / `&importId` | The scope narrowing (pre-existing; the `?effortId` deep link itself is unchanged). On a **2+-walk-list** campaign the in-page walk-list control now **owns** `effortId`: web renders a toolbar `<select>` bound to the same state (a deep-linked id that isn't in the campaign's effort roster resets the scope rather than leaving the select claiming "All walk lists" over a secretly scoped map); mobile renders a `FilterChip` + menu, and **picking a walk list clears `passId`/`importId`** — a pass belongs to one effort, so a stale intersection would zero out the map. With the picker present, the **scope chip** (web) / "Scoped to …" row (mobile) announces only pass/import scopes, and its ✕ clears only those — never the picked walk list. On a campaign with fewer than 2 walk lists there is no picker and the old chip behavior (including the effort label) is unchanged. |
| `?household` (+ `&focusAt` nonce on mobile) | Focus a **single door** — opens on **All time** so an old door still loads, then flies to the pin (the Notes-hub link, and the explorer's per-row "Map →"). |
| `?flag=1` / `&focusActivityId` | The GPS-audit overlay ([AUDIT.md](AUDIT.md)). |

**Mobile ([admin/map.jsx](../mobile/app/(app)/admin/map.jsx))** — the answer drill's **one-shot
seed**: `questionKey`, `optionId`, `alabel` (the option **text** — same dual-read reason as web),
`surveyTemplateId` (the template scope — same fallback as web when absent), `userId`, `from`, `to`,
plus two coordination params: **`scid`** (the seeding campaign's id) and
**`seedAt`** (a per-tap nonce). Mechanics, all deliberate:

- A `seededRef` remembers the last consumed `seedAt`, so the seed applies **once** — parking on the
  map tab can't re-apply it (the same idiom as the `household`/`focusAt` door focus).
- The effect **waits until the active campaign equals `scid`** before applying: the map re-syncs its
  campaign asynchronously, and its campaign-change reset effects would stomp an early seed. The seed
  effect is defined **after** those resets on purpose — reordering the effects reintroduces the stomp
  (there's a comment on it).
- Applying the seed sets the answer + canvasser filters, a **touched custom range** (or **All time**
  when the drill itself had no bounds — leaving Today would show a different window than the list
  the user came from), clears status/scope narrowing, and resets the viewport-bbox/framing refs so
  the camera re-frames on the seeded doors.
- The params are then stripped with `router.setParams` using `''` values (the household-clear
  convention), so back-navigation and later campaign switches see a clean route.

## E. Rendering

- **Web (Mapbox GL JS):** GeoJSON **sources + layers** — a symbol layer for household icons, a circle
  layer for pings, a line layer for ping→house links. House icons are drawn to a canvas at runtime.
  Updates call `source.setData(...)`, so a refresh re-paints features **without** recreating DOM
  markers or moving the camera (auto-fit runs once via a `_didFitBounds` flag).
- **Mobile (`@rnmapbox/maps`):** native **`ShapeSource` + `SymbolLayer`** driven by **one** GeoJSON
  feature collection — deliberately **not** per-pin `MarkerView` components (thousands would block
  pinch-zoom and melt the device) and **no clustering**. House pins are pre-baked PNGs in
  [mobile/assets/icons](../mobile/assets/icons) (`house-unknocked/not_home/surveyed/wrong_address/refused/restricted/no_soliciting`,
  including its own amber `house-refused.png`, slate `house-restricted.png` and pink
  `house-no_soliciting.png`; `lit_dropped` reuses the surveyed icon). All are generated by
  [scripts/gen-house-icons.mjs](../mobile/scripts/gen-house-icons.mjs). The `icon-image` match in
  [map.jsx](../mobile/app/(app)/map.jsx) maps `refused → house-refused`,
  `restricted → house-restricted` and `no_soliciting → house-no_soliciting`. Building & book progress
  markers (grey/yellow/green) are
  generated by [scripts/genMarkerIcons.js](../mobile/scripts/genMarkerIcons.js) (SVG→PNG via `sharp`).
- **Buildings grouping:** [mobile/lib/buildings.js](../mobile/lib/buildings.js) rounds coordinates to ~1m
  and collapses ≥2 units at one spot into a single building marker with `total`/`done`/`status`. The
  web mirror is [client/src/lib/buildings.js](../client/src/lib/buildings.js) — `buildingKeyForCoords(lng, lat)`
  → `` `${round(lat*1e5)}|${round(lng*1e5)}` `` plus `groupHouseholds(households, minUnits = 2)`, returning
  `{ buildings, stackedIds, byKey }` with the same `done`/`touched` roll-up (`DONE = surveyed | lit_dropped`).
  **Four surfaces share this key** and must keep sharing it — see §I.
- **Web building layer (admin map):** `registerLayers` adds a `buildings` GeoJSON source and a
  `building-symbols` symbol layer fed by `buildingsToGeoJSON(buildings)`. The icon is drawn to canvas at
  runtime by `drawBuildingIcon` in three roll-up colors (`building-done` / `building-partial` /
  `building-none`, from `buildingColorsForTheme(dark)`) — deliberately **three** states, not the 8-status
  palette, because a building holds a mix and painting it one door's status would be a false claim. The
  `text-field` is a `['step', ['zoom'], '', 14, …]` so the "N doors" label only appears at z≥14, and it's
  `text-optional` — labels may collide away, icons never do (`icon-allow-overlap` + `icon-ignore-placement`),
  so no building is ever hidden.
- **Stacked doors are drawn exactly once.** `householdsToGeoJSON(households, stackedIds)` stamps
  `stacked: true` on every door in a building, and `households-symbols` carries
  `filter: ['!=', ['get','stacked'], true]` (as does `household-approx-ring`). Without that filter the
  building glyph would sit on top of N still-rendered coincident house icons and a click could resolve
  to any of them. A caller that passes no `stackedIds` gets `stacked: false` on every feature and renders
  exactly as before — that default is what lets one shared helper serve maps that do and don't group.
- **Which web maps group.** The **admin map**, **[ClientReportMap](../client/src/components/ClientReportMap.jsx)**
  and **[AnswerMiniMap](../client/src/components/AnswerMiniMap.jsx)** all group, from the one shared
  `groupHouseholds`. **[PacketMap](../client/src/components/packet/PacketMap.jsx) does not and must not** —
  despite the grep hit, it defines its own *local* `registerLayers`, imports nothing from `mapRender.js`,
  and draws only book polygons. Recorded so an audit by grep doesn't relitigate it.
  - `AnswerMiniMap` gets the **glyph only**: no click handler, because the card's hand-off is its
    fullscreen toggle (the "Open in Map →" link was removed — pins are clickable in place). Its
    payload is already answer-filtered, so a glyph's count there means
    "doors WITH THIS ANSWER at this pin", not the building's size.
  - `ClientReportMap` gets the glyph, the click fix, and a **status-tally summary — never a door list.**
    The frozen `ClientReportMapPoint` carries no `addressLine2`, so a per-door list would print the same
    street address N times; adding the unit line to fix that would put apartment numbers on an
    **unauthenticated share link**, contradicting [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) §D11.
    Its count says "doors **reached** at this spot" because the snapshot drops unknocked doors — the
    building's real size is genuinely unknowable there, and the roll-up is only ever `done`/`partial`.
- **Click disambiguation:** the `households-symbols` handler reads **all** of `e.features`, not
  `features[0]` — on both the admin map and the client report map. One hit → open that door. More than
  one (two pins a metre apart that overlap on screen) → open the stack UI rather than guess:
  [DoorStackPanel](../client/src/components/DoorStackPanel.jsx) on the admin map, the tally card on the
  client report. The `building-symbols` handler resolves `properties.key` through a `buildingsByKeyRef`
  (feature properties can only carry scalars, and the layer handlers are bound once at init so a closure
  over the memo would go stale on the first data change).
- **First/last-knock endpoints:** when the map is scoped to a **single canvasser** (with pings on) the
  two ends of their run are ringed — a **"Start"** ring on the earliest knock and a **"Latest"** ring on
  the most recent. There is **no server field for this**: it's derived **client-side** from the same
  `activities` array that draws the pings — a `firstLastKnock` memo sorts the located, timestamped
  activities and takes `first` = earliest, `last` = most recent (`last` is `null` when there's only one
  ping). It's byte-parallel across the two admin maps: **web** registers `first-knock` / `last-knock`
  GeoJSON sources with a hollow `circle` **ring** layer + a `symbol` **"Start"/"Latest"** label layer in
  [mapRender.js](../client/src/lib/mapRender.js) (`registerLayers`), fed by the `firstLastKnock` memo in
  [MapPage.jsx](../client/src/pages/MapPage.jsx); **mobile** renders the same rings as `ShapeSource` +
  `CircleLayer` + `SymbolLayer` from the matching memo in [admin/map.jsx](../mobile/app/(app)/admin/map.jsx).
  The canvasser field map doesn't draw these (it surfaces first/last **door times** as text in the
  Today's-shift sheet instead).
- **GPS-audit flag layer:** when "Show flagged entries" is on, [MapPage.jsx](../client/src/pages/MapPage.jsx)
  pushes a `flagged-pings` circle layer + a `flagged-lines` line-to-house layer (registered in
  [mapRender.js](../client/src/lib/mapRender.js) via `flagsToGeoJSON` / `flagsToLinesGeoJSON`), colored
  by the entry's worst reason (`primaryReason`) and drawn on top; actioned flags fade back. The
  detection + review model is in [AUDIT.md](AUDIT.md).
- **Overlap ring layer:** when "Show overlaps" is on, an `overlap-doors` source drives a hollow amber
  (`#f59e0b`) `overlap-doors-ring` circle layer (registered in [mapRender.js](../client/src/lib/mapRender.js);
  fed by `overlapDoorsToGeoJSON(households, overlapIds)`) — a **ring on top of the existing house icon**,
  not a new pin and never a cluster. It rings only the currently-loaded doors whose id is in the
  `/overlap-doors` set, so the ring set follows the viewport while the header's `total` is scope-wide.
  It reads as amber to match the "overlap = warning" semantics of the panel badge, and sits visually
  above the thin under-icon amber "approximate location" ring and the blue selection ring. **Mobile**
  ([admin/map.jsx](../mobile/app/(app)/admin/map.jsx)) draws the same ring **beneath** the pins as an
  `admin-overlaps` `ShapeSource` + `CircleLayer` from the matching overlap set.

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

The **Today's Progress counter** likewise doesn't wait for the 120s `me/today` poll: on a
**server-confirmed** knock/survey, the record flow invalidates `['mobile','me']` (`invalidateKeys` in
[recordAction.js](../mobile/lib/recordAction.js), passed from `recordHouseholdAction` and the survey
submit), so the counter refetches the **authoritative** counts within the write's round-trip — no
optimistic increment, so re-knocking a door already counted today can't double-count. A
**queued/offline** write skips it (the server hasn't counted it yet, so a refetch would show the
pre-knock number); those counts catch up on the next poll, the reconnect-flush, or a manual refresh.
The 120s poll is now just a backstop. (Pin correction uses the same `optimisticSubmit` but does **not**
opt into `invalidateKeys` — moving a pin doesn't change the daily counts.)

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
`wrong_address #ef4444`, `refused #f59e0b`, `restricted #475569`, `no_soliciting #db2777`,
`lit_dropped #a855f7`, plus `voted #14b8a6`.

`refused` is **amber `#F59E0B`**, label **Refused** (web/admin/mobile alike) — a *contact* disposition
(a voter answered but declined), kept visually distinct from the misses (blue Not home / red Wrong
address). The same hex drives the house pin and the canvasser **ping** circle (the `actionType` match in
[mapRender.js](../client/src/lib/mapRender.js) `registerLayers` includes `refused`).

`restricted` is **slate `#475569`**, label **Restricted** (web/admin/mobile alike) — an *inaccessible-home*
marker (all campaign types), kept distinct from the neutral grey `unknocked`. The same hex drives its
house pin (`house-restricted`) and its ping circle (the `registerLayers` `actionType` match includes
`restricted`), so a restricted mark's GPS stamp shows on the admin map like any other. It is **not** a
counted as a knock — the color is purely a coverage/audit signal (see [METRICS.md](METRICS.md)).

`no_soliciting` is **pink `#DB2777`**, label **No soliciting** (web/admin/mobile alike) — a
*reached-the-door-but-nobody-answered* disposition (all campaign types). It drives its house pin
(`house-no_soliciting`) and its ping circle. The hue is deliberately clear of amber `refused` **and**
purple `lit_dropped`: unlike those two it appears on *both* campaign types, so it has to stay legible
next to either. It **is** counted as a knock (unlike `restricted`) but never as a contact (unlike
`refused`) — see [METRICS.md](METRICS.md).

- **Mobile (canonical):** [lib/theme.js](../mobile/lib/theme.js) `colors.status.refused = '#F59E0B'` /
  `colors.statusLabels.refused = 'Refused'` and `colors.status.restricted = '#475569'` /
  `colors.statusLabels.restricted = 'Restricted'` — used by all mobile maps for legend dots and ping
  colors. `restricted` is in **both** the survey legend (`SURVEY_LEGEND` in
  [map.jsx](../mobile/app/(app)/map.jsx)) and the `LIT_DROP_LEGEND` (refused is survey-only), and so is
  `no_soliciting`.
  (`mobile/components/StatusColor.js` holds the same values but is currently unused/legacy.)
- **Web:** `STATUS_COLORS` / `STATUS_LABELS` — canonical in [lib/statusColors.js](../client/src/lib/statusColors.js)
  (`refused: '#f59e0b'`, `restricted: '#475569'`, `no_soliciting: '#db2777'`), consumed by [MapPage.jsx](../client/src/pages/MapPage.jsx)
  and the shared [mapRender.js](../client/src/lib/mapRender.js) house-icon + ping layers.

**Building roll-up colors (outside the status palette).** A building glyph stands for 2+ doors with a
*mix* of statuses, so it can't wear any one of them. Three states instead: **green** (`STATUS_COLORS.surveyed`
— every door done), **amber `#f59e0b`** (some worked), **grey** (`STATUS_COLORS.unknocked`, lightened to
`#d1d5db` on dark basemaps — nothing worked). Web: `buildingColorsForTheme(dark)` in
[mapRender.js](../client/src/lib/mapRender.js), rendered by `drawBuildingIcon`. Mobile: the same
green/yellow/grey roll-up from `groupBuildings`'s `status`, drawn from the pre-baked marker PNGs. "Done"
means `surveyed | lit_dropped` on both — keep the two `DONE` sets in step.

**Route-endpoint colors (outside the status palette).** The Start/Latest-knock rings (§E) use two colors
that are **deliberately not** in the status palette, so they read as route endpoints, not door statuses:
`FIRST_KNOCK_COLOR = #0891b2` (cyan, **"Start"**) and `LAST_KNOCK_COLOR = #db2777` (pink, **"Latest"**).
Defined in [mapRender.js](../client/src/lib/mapRender.js) (web) and again in
[admin/map.jsx](../mobile/app/(app)/admin/map.jsx) (mobile, with a comment noting it mirrors the web
constants). A small legend labels the two rings when they're shown.

## H. Config

- **Mapbox init — mobile: one chokepoint, [lib/mapbox.js](../mobile/lib/mapbox.js).** Every map screen
  calls `initMapbox()` at module scope. **Never call `Mapbox.setAccessToken()` directly.**
  - **Why:** `@rnmapbox/maps` ships anonymous usage **and location** to Mapbox by *default*, and
    `setTelemetryEnabled(false)` has to be called to stop it. Setting the token had been copy-pasted
    into **nine** files and every copy left telemetry on. A tenth map screen would have done the same.
    Now the token and the telemetry switch travel together and there is nothing to copy.
  - **Leaving telemetry on would have three costs:** it makes the published privacy policy false (it
    states we use no *"third-party analytics, or tracking technologies … in our apps"*); it forces us
    to declare Mapbox as a third party collecting Location + App activity on Play's Data safety form
    and pushes the App Store label toward *"Data Used to Track You"*; and the SDK's own docs then
    **require** us to ship a user-facing opt-out toggle. Turning it off deletes all three problems.
  - Map **tiles** still reach Mapbox — that is what a map is — and that is disclosed in the privacy
    policy under service providers *"providing maps and converting addresses into map coordinates."*
    Telemetry is the separable, opt-outable part; that is what `initMapbox()` kills. (Mapbox still
    sends a session-counting `appUserTurnstile` ping even with telemetry off — "telemetry off" is not
    "no network calls".)
  - **The order inside `initMapbox()` is load-bearing — see the invariant in §I.** The token is set
    first and telemetry is chained off its promise. Reversing those two lines hard-crashes every
    Android map screen.
- **Mapbox token — web:** the server returns it via `GET /admin/config/mapbox-token` (env
  `MAPBOX_PUBLIC_TOKEN`, a `pk.*` token); `MapPage` sets `mapboxgl.accessToken`.
- **Mapbox token — mobile:** `EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN` (public, bundled; the *download* token
  `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is build-time/secret — see [mobile/README.md](../mobile/README.md)).
- **Base styles:** [lib/mapStyles.js](../mobile/lib/mapStyles.js) + `useMapStyle()` (Street default;
  Satellite/Hybrid/Outdoors/Dark) drive the mobile [MapStyleControl](../mobile/components/MapStyleControl.jsx).

## I. Invariants / gotchas

- **Coordinates are imported or geocoded (Geocodio), and can be corrected** (see §B); rows with no
  usable point never reach a map. A pin correction is deterministic (`updateHouseholdLocation`),
  never re-cuts turf, and is **lead/admin-only on both write paths** (`canManageCampaign`).
- **Set the Mapbox access token BEFORE `setTelemetryEnabled()` — never the other way round.** On
  Android `setTelemetryEnabled` has no cheap native path: `RNMBXModule.kt` builds a throwaway Mapbox
  `MapView` on the UI thread just to reach the flag. Mapbox v11 throws `MapboxConfigurationException`
  when a `MapView` is inflated before the token is set, and that throw lands on the **main Looper** —
  React Native's native-module exception handler never sees it and **no JS `try/catch` can catch it**,
  so the process dies with no red box. Calling telemetry first crashed every Android map screen
  (Map, Books, canvasser Books) the instant the route module evaluated; iOS was immune because its
  impl is a one-line `UserDefaults` write that touches no view.
  [lib/mapbox.js](../mobile/lib/mapbox.js) therefore chains telemetry off `setAccessToken`'s promise,
  and returns early when there is no token at all. **Never "fix" a telemetry crash with a `try/catch`**
  — the throw is uncatchable from JS, and a *native* catch would swallow the failure and silently
  leave telemetry **on**, quietly falsifying the privacy policy.
- **Native symbol layers, not MarkerView; no clustering** — one GeoJSON feature collection per layer.
- **The building key has ONE rule and exactly THREE implementations of it.** `` `${round(lat*1e5)}|${round(lng*1e5)}` ``
  (~1.1 m) is implemented in [client/src/lib/buildings.js](../client/src/lib/buildings.js) (web),
  [mobile/lib/buildings.js](../mobile/lib/buildings.js) (mobile), and
  [server/src/utils/buildingKey.js](../server/src/utils/buildingKey.js) (server). Count *implementations*,
  not screens — the web one is shared by four surfaces already (admin map, [TurfsPage](../client/src/pages/TurfsPage.jsx)'s
  `doorKey`, [ClientReportMap](../client/src/components/ClientReportMap.jsx),
  [AnswerMiniMap](../client/src/components/AnswerMiniMap.jsx)), and new consumers should import it rather
  than add a fourth copy. **`POST /admin/turfs/exclude-apartments` still builds the key inline** — it is
  the one site that has not been folded in, and it is the one where drift would be worst: the cut would
  exclude doors the map never showed as stacked. Change the rounding in one implementation and "this is
  one building" silently means a different set of doors on different screens. All three guard non-finite
  coordinates and return `null`; a `NaN`/`null` that rounds to `0` folds unrelated doors into a phantom
  building at the equator.
- **A door's *display* threshold is 2+, the *exclusion* threshold is the admin's.** The map groups at
  `BUILDING_MIN_UNITS = 2` because the job is "don't hide a door under another door." Turf Cutting's
  **Remove apartments (N+ units)** takes its own N (default 4) — the two are the same key at different
  cutoffs and should never be collapsed into one number.
- **`excludedFromTurf` is never a SERVER filter — it is a client view toggle.** Doors excluded from books
  stay on the admin map by design (same rule as `doNotKnock`): the map is the record of what exists and
  what was worked and billed, and an excluded apartment door can still be flagged, overlapped, or marked
  do-not-contact. `/admin/households/map` filters on neither `excludedFromTurf` nor `turfId` — it now
  *projects* the flag ([households.js](../server/src/routes/admin/households.js), beside `doNotKnock`) so
  the client can count it, badge it, and offer **Show / Dim / Hide** in the Layers sidebar. Never add a
  server query param that drops them, or coverage and billing stop reconciling with what an admin sees.
  So "3,513 households shown" counts every active geocoded door in scope, apartments and excluded doors
  included; it is **not** the size of the cut — scope to a `passId` for that.
  - **Hide must filter BEFORE `groupHouseholds`** ([excludedDoors.js](../client/src/lib/excludedDoors.js)).
    Filter after and the hidden doors are still in `stackedIds`, so `households-symbols`'s
    `['!=', ['get','stacked'], true]` keeps them invisible while the building glyph keeps counting them —
    the sidebar would report stacked doors that aren't on the map.
  - **Dim is a data property + a `case` expression, not `visibility` and not `setFilter`.** `visibility`
    can't express "dim"; `setFilter` would leave the doors inside `stackedIds` and the building totals.
    These are **symbol** layers, so it is `icon-opacity` / `text-opacity` — the cut map's `circle-opacity`
    idiom silently no-ops here. `household-approx-ring` shares the source and fades too, or a dimmed door
    keeps a bright amber halo around a ghost house. A building dims only when EVERY unit in it is excluded.
  - **The chip counts the PAYLOAD, not the campaign** — viewport-bounded and capped at
    `MAP_HOUSEHOLD_CAP`. It will not reconcile with Turf Cutting's `excludedApartmentCount`, which is
    effort-scoped, coords-required, and (unlike the voted/DNC/do-not-knock trio beside it) carries no
    disjointness carve-outs. Don't present the two as the same quantity.
  - **The flag is campaign-wide and provenance-free.** `KNOCKABLE_DOOR_FILTER` reads it unscoped and the
    stamp records no effort/pass/actor/threshold, so copy may say "not in books" and must **never** say
    "excluded from this walk list" — a door can be force-re-carved into another effort and keep the flag.
    Two open consequences: `include-apartments` is an effort-wide reset, not a per-door lift, and a door
    returned to Intake (`effortId: null`) can never be un-excluded, because `Pass.effortId` is required.
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
  once" self-heal, just atomically — and when the replaced response is **another canvasser's**, the
  server snapshots it into `SurveyResponseArchive` before the replace, so a cross-canvasser
  overwrite is preserved and admin-restorable, never a silent loss ([SURVEYS.md](SURVEYS.md) §F).
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
| [client/src/pages/MapPage.jsx](../client/src/pages/MapPage.jsx) | Web admin map: sources/layers, filters (incl. the in-page walk-list `<select>` on 2+-effort campaigns — see §D's deep-link row), Live toggle, household + ping detail panels, first/last-knock rings (single canvasser), the GPS-audit flag overlay + [FlaggedEntryPanel](../client/src/components/FlaggedEntryPanel.jsx) review panel ([AUDIT.md](AUDIT.md)), and the opt-in **Overlaps** ring overlay (`/overlap-doors` query + `overlap-doors-ring` layer + the header "N overlaps" chip). |
| [client/src/components/HouseholdDetailPanel.jsx](../client/src/components/HouseholdDetailPanel.jsx) | Web admin map's tapped-door panel: header status/address, last action, **History by pass** (from the lazy `/activity` rounds), voters, surveys (answers lazy-loaded from `/surveys`), and the inline **⚠ Overlap** badge — computed no-new-fetch from the loaded `rounds` (2+ distinct canvassers among real knock + survey entries in one pass), with an "Also worked by …" line and a per-pass overlap pill in the history. |
| [client/src/lib/mapRender.js](../client/src/lib/mapRender.js) | Shared pin rendering (`drawHouseIcon` / `householdsToGeoJSON` / `registerLayers`) used by both the admin map and the client-report map; also the flag-overlay layers (`flagsToGeoJSON` / `flagsToLinesGeoJSON`), the overlap-ring layer (`overlapDoorsToGeoJSON` → `overlap-doors-ring`), and the building layer (`drawBuildingIcon` / `buildingColorsForTheme` / `buildingsToGeoJSON` → `building-symbols`). |
| [client/src/lib/buildings.js](../client/src/lib/buildings.js) | Web building grouping: `buildingKeyForCoords` (the shared ~1.1 m key — see §I), `groupHouseholds` → `{ buildings, stackedIds, byKey }`, `buildingLabel`. Consumed by MapPage, TurfsPage's `doorKey`, ClientReportMap and AnswerMiniMap. Tested in [buildings.test.js](../client/src/lib/buildings.test.js). |
| [client/src/lib/excludedDoors.js](../client/src/lib/excludedDoors.js) | The Show/Dim/Hide predicate for doors held back from books: `isExcludedDoor`, `visibleMapDoors(households, mode)` (Hide must run BEFORE grouping — §I), `countExcludedDoors` (counts the payload, not the campaign). Tested in [excludedDoors.test.js](../client/src/lib/excludedDoors.test.js). |
| [client/src/components/DoorStackPanel.jsx](../client/src/components/DoorStackPanel.jsx) | Web admin map's "every door on this pin" list — opened by a building click or by a click that hit more than one house. Presentational; MapPage owns selection and hands the picked door to `HouseholdDetailPanel` (with a "← Back to all N doors" bar). |
| [client/src/components/ClientReportMap.jsx](../client/src/components/ClientReportMap.jsx) | Read-only client-report coverage map: frozen snapshot points, client-side status/answer filtering, no canvassers; ResizeObserver-resized (see gotcha §I). |
| [client/src/components/LiveStatus.jsx](../client/src/components/LiveStatus.jsx) | The "Live · updated Xs ago" toggle/indicator + Refresh. |
| [mobile/app/(app)/map.jsx](../mobile/app/(app)/map.jsx) | Canvasser map: pins, buildings, bottom sheet, follow mode, offline badge, `changes`/`me/today` polling. |
| [mobile/app/(app)/admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Mobile admin overview map + canvasser-pings toggle + the walk-list `FilterChip` + menu (2+-effort campaigns; picking one clears pass/import scope — §D) + first/last-knock rings (single canvasser); tapped-door sheet now at **web parity** (header status/address, last action, **History by pass**, voters, surveys with lazy answers) + the inline **⚠ Overlap** badge + the opt-in **Overlaps** ring toggle (`/overlap-doors`, rings beneath the pins). |
| [mobile/app/(app)/admin/canvasser/[id]/map.jsx](../mobile/app/(app)/admin/canvasser/[id]/map.jsx) | One canvasser's path of action pings. |
| [mobile/app/(app)/books.jsx](../mobile/app/(app)/books.jsx) | Books overview map (centroid markers). |
| [mobile/lib/buildings.js](../mobile/lib/buildings.js) · [mobile/lib/mapStyles.js](../mobile/lib/mapStyles.js) · [mobile/lib/location.js](../mobile/lib/location.js) | Buildings grouping · base-style switcher · per-action location capture. |
