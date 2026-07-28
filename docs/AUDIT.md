# GPS audit (flagged entries — canvassing quality)

How an admin catches bad canvassing from the **GPS trail** every knock already leaves. Each recorded
door carries the canvasser's location, so the app can flag the ones that look wrong — a door marked
from far away, a burst of doors logged too fast to have walked between them, a cluster of doors all
logged from one spot (sat in the car), an entry whose GPS was too weak to trust, or a fix that came
from a **fake-GPS app** — then let a reviewer **triage** each one and keep a record of the decision.
Recording is also **location-gated**: a canvasser cannot record a door at all unless the app captures
a fresh GPS fix (see §B.6).

- **Part 1 — For everyone** is plain language: what gets flagged and why, the two places you review
  them (a dedicated Audit page and the map), and what "reviewing" a flag does.
- **Part 2 — Technical reference** is for developers (and Claude): the live detector + its five
  algorithms, the thresholds, the review model (open = no record), the location-required gate, the
  endpoints, and the frontend.

Related: [MAPS.md](MAPS.md) (the admin map this overlays — pins, pings, and the "far from house"
distance a ping already shows), [METRICS.md](METRICS.md) (the overlap/duplicate-survey audits, a
sibling quality check), [DATE_FILTERS.md](DATE_FILTERS.md) (the date window that scopes the audit —
the map now opens on **Today**), [ROLES.md](ROLES.md) (who can audit: admins, team leads for their
campaigns, and super-admins), [TIMEZONES.md](TIMEZONES.md) (the campaign-day the window resolves in).

---

# Part 1 — For everyone

## What it's for

Every time a canvasser marks a door — Not home, Survey, Refused, Restricted, Lit drop — the app stamps
**where the phone was** at that moment (a Restricted-access mark is GPS-stamped and audited like any
other door action, even though it isn't a billable knock). That trail answers the questions you can't ask from knock counts alone:

- Did they mark a house they never actually walked to?
- Were they entering everything from **one spot** — sitting in a car, never getting out?
- Did they log a **run of doors far too fast** to have walked between them?
- Was the GPS just **bad** on that entry, so you shouldn't trust the location at all?
- Or did the location come from a **fake-GPS app** — spoofed outright?

The audit turns those into five kinds of **flags** and shows you **how many**, **who** they belong to,
**why** each one is flagged, and gives you a way to **review** each one. And the app won't record a
door at all without a live location: a canvasser with location off (or denied, or set to approximate)
is blocked at the tap with a clear message — so "no GPS trail" is not an option, on purpose.

## The five flags

| Flag | Plain meaning |
|---|---|
| **Mock location** | The phone reported that the fix came from a **mock-location (fake GPS) app** — the strongest fraud signal there is. The canvasser is never told this was detected; the flag simply appears for you. Always high severity. |
| **Far from house** | The canvasser's GPS was well away from the house pin when they recorded — a door they may not have walked to. (Accounts for GPS wobble — a big distance caused by a *weak* fix is treated as Weak GPS, not Far. And if the pin itself was wrong and someone later corrected it, an entry that turns out to sit beside the corrected pin drops to low — see below.) |
| **Rapid succession** | Two different doors logged only seconds apart — too fast to have walked between them (a sign of arm-chairing a block). |
| **One spot** | A run of *different* doors all logged from nearly the **same** GPS point, while those houses are actually spread down the street — i.e. entered from one place (a parked car), not walked. |
| **Weak / missing GPS** | The location fix was poor (or absent, or synced from offline), or the fix was computed **long before the door was recorded** (a stale, reheated location) — either way the entry's location can't be trusted. |

**On purpose, an apartment building doesn't trip "One spot."** Standing at one entrance to log ten
units is normal canvassing — those units share one map pin, so the app only flags a one-spot cluster
when the **houses themselves are spread out** but the canvasser never moved.

**Corrections don't punish honesty.** Changing your answer at a door you already visited — say you
tapped Restricted by mistake, walked off, and fixed it to Not home from down the street — would
otherwise look like a door marked from far away, because the newer entry (recorded where you now
stand) replaces the original. The app keeps a snapshot of the entry you replaced, so a correction
made **within the same canvassing day** of a genuine at-the-door visit shows as a **low**-severity
Far flag with a context line like *Replaced "Restricted" recorded 4 min earlier from 20 ft away*.
The reviewer still sees it (corrections are downgraded, never hidden) — but it reads as an honest
fix, not a phantom knock. A door rewritten from far away **without** a real earlier visit, or long
after it, keeps its full flag. Don't be surprised that these low flags still count in the Far KPI —
that's deliberate; dismiss them as you review.

**A wrong pin doesn't punish honesty either.** Some pins are looked up from the address rather than
read from your file, and land a house or two off. A canvasser who walks to the *real* door gets
flagged, because the distance is measured against the pin as it stood at that moment — and it stays
measured that way forever, since correcting a pin doesn't rewrite history. So the audit checks the
other direction too: if the pin was **corrected after** the door was recorded and the entry turns out
to sit right beside the corrected pin, the flag drops to **low** and shows both distances ("820 ft
from the pin at the time · 30 ft from the pin's current spot"). Two deliberate limits. It can only
ever *lower* a flag — dragging a pin away from a door can never create or worsen one, because nobody
should be graded on an edit they didn't make. And if the person who moved the pin is the same person
who recorded the door, the entry **keeps its full severity** and says so: nobody grades their own
work. (Moving a pin is a lead/admin action — see [MAPS.md](MAPS.md) — so this is a narrow case.)

Each flag has a **severity** (low / medium / high) so the worst ones stand out. Distances everywhere
in the app display in **feet**, switching to **miles** once a distance reaches a mile.

## Where you review them — two places

**1) The Audit page** (inside a campaign, next to Timeline and Map). It opens on **Today** and shows:

- **KPI cards** — total flagged, and a count for each of the five flags, plus how many are still open.
- **A per-canvasser table**, worst-first: each canvasser's flag counts by type and their worst
  severity. Click a row to drill into just that person's flagged entries.
- **The entries list** — one card per flagged door: who, the address, the time, the reason(s) with the
  actual number (e.g. *205 ft from house*, *8 s after the previous door*), and the review buttons. Each
  card has a **"View on map"** link that jumps to the map focused on that exact entry — **on mobile
  too**: the mobile audit card's link opens the admin map with the flag layer on, selects the entry
  and flies to its GPS point (already-reviewed entries still focus — the map widens to all review
  statuses while arriving). The mobile audit also **defaults to Today** (it opened on 30 days).

Filter the list by flag type, by review status (Open / Reviewed / Dismissed / Confirmed), by walk
list, or by date.

**2) The map** (the same admin map you already use). Turn on **"Show flagged entries"** in the left
panel and each flag appears as a colored dot at the spot it was recorded, with a line back to the
house — so you can *see* the geography (on the street? across the block? all from one corner?). The
reason chips show the counts; clicking a flag opens a panel to review it right there.

Each surface carries a small **(i)** legend (web `FlagLegend.jsx`, mobile audit header) explaining
all five flag types, the four weak-GPS sub-kinds, and what the severities mean — copy centralized in
`FLAG_LEGEND` in the two `flags.js` mirrors.

## How you're notified (the mock-GPS nudge)

You don't have to go looking for the worst flag. When an **open Mock location flag** exists, the app
tells you everywhere you'd naturally land:

- **The campaign dashboard** shows a red **"Mock GPS detected"** alert at the top, with a
  **Review in Audit** button that opens the Audit page *already filtered* — Mock chip lit, status
  Open, and the full audit date window (so the flag can't hide behind the page's Today default).
- **The sidebar** shows a red count badge on **Audit** (a red dot when the sidebar is collapsed;
  on small screens, a dot on the **More** tab and the count in its sheet).
- **The mobile admin app** shows matching red pills: on each campaign card on the Overview
  landing, on the **GPS audit** quick-action tile, and on the More → **GPS audit** row (that one is
  the total across every campaign you can see).

The nudge counts **open mock-location flags only** — the one flag that is affirmative device
evidence, never noise — over the audit's date window, and every badge drops the moment the flag is
reviewed or dismissed. Other flag types don't nudge; they wait in the Audit page as usual.

## What "reviewing" does

A flag starts **Open**. You mark it:

- **Reviewed** — you looked, it's fine / noted.
- **Dismissed** — not a real problem (e.g. a known GPS-bad neighborhood).
- **Confirmed issue** — a genuine problem to follow up on.

You can add a note, and the app records **who** decided and **when**. Your decision sticks to that
entry, so an open flag never quietly disappears and the team can see what's already been checked. You
can always **reopen** a flag to set it back to Open.

**Reviewing is a recorded decision, not a data edit.** It never deletes the entry or removes it from
any report's numbers — a confirmed-issue knock still counts everywhere. What a review drives is the
**open-flag counts**: the badges, the mock-GPS nudge, and the client-report builder's publish-time
warning when open mock-location flags fall inside a report's window (the count at the moment of
publish is stamped on the report as `openMockFlagsAtPublish`, operator-visible only).

One deliberate blind spot: **admin bulk-restrict marks** (`via: 'bulk'` — marking a whole book
restricted) are invisible to flag detection. A hundred same-second marks by one admin would flood
`rapid` flags while auditing nothing a canvasser actually did, so `detectFlags` excludes them at the
query ([flagDetection.js](../server/src/services/audit/flagDetection.js)).

## Who can use it

The audit is for the console — **admins**, **team leads** (only for the campaigns they manage), and
**super-admins**. Same access rules as the rest of the campaign dashboards (see [ROLES.md](ROLES.md)).

---

# Part 2 — Technical reference

## A. Shape of the feature

Flags are **computed live** from the existing door-action ledger — nothing about *which* entries are
flagged is stored (same derive-don't-store philosophy as per-round door status). The **only** persisted
state is the reviewer's decision (`FlagReview`). No new mobile capture, no materialized-flags
collection, no worker job — the GPS the detector reads has been captured on every knock all along
(see [MAPS.md](MAPS.md) §C).

| Piece | File |
|---|---|
| Detector (DB) + pure core | [server/src/services/audit/flagDetection.js](../server/src/services/audit/flagDetection.js) |
| Thresholds (one source of truth) | [server/src/services/audit/flagThresholds.js](../server/src/services/audit/flagThresholds.js) |
| Review model | [server/src/models/FlagReview.js](../server/src/models/FlagReview.js) |
| Endpoints | `GET/POST /admin/reports/flags*` in [server/src/routes/admin/reports.js](../server/src/routes/admin/reports.js) |
| Audit page | [client/src/pages/AuditPage.jsx](../client/src/pages/AuditPage.jsx) (+ `AuditSummaryTable`, `FlaggedEntryList`) |
| Map overlay + panel | [client/src/lib/mapRender.js](../client/src/lib/mapRender.js), [MapFilters.jsx](../client/src/components/MapFilters.jsx), [FlaggedEntryPanel.jsx](../client/src/components/FlaggedEntryPanel.jsx) |
| Shared review control / badges / client meta | [FlagReviewControl.jsx](../client/src/components/FlagReviewControl.jsx), [FlagReasonBadges.jsx](../client/src/components/FlagReasonBadges.jsx), [client/src/lib/flags.js](../client/src/lib/flags.js) |
| Nudge count (`openMockFlags`) | [server/src/services/reports/campaignSummaries.js](../server/src/services/reports/campaignSummaries.js) (rides `GET /admin/campaigns` + the campaign-rollup; badges in `Layout.jsx`/`BottomNav.jsx`/`DashboardPage.jsx` + the mobile admin screens) |
| Client-report publish gate (`countOpenMockFlags`) | [campaignSummaries.js](../server/src/services/reports/campaignSummaries.js) + [routes/admin/clientReports.js](../server/src/routes/admin/clientReports.js) (`GET /:id` sibling + `openMockFlagsAtPublish` stamp; warning UI in `ClientReportBuilderPage.jsx`) |

## B. The detector

`detectFlags(match, { organizationId })` ([flagDetection.js](../server/src/services/audit/flagDetection.js))
takes a **prebuilt `CanvassActivity` filter** (org / campaign / effort + `timestamp` window, optional
`userId`) — the same contract as `computeOverlaps(match, …)` — so it's `req`-free and reusable by both
surfaces. It:

1. Loads the window's `CanvassActivity` rows (sorted by `userId, timestamp`) and the involved
   households' pins/addresses (one query each), then groups rows into a **per-canvasser timeline**.
2. Runs the five detectors (below) into a per-action reason map.
3. Left-joins `FlagReview` by `actionId` (absent → `status:'open'`) and resolves canvasser/reviewer
   names, then returns `{ entries, summary, windowActionCount }`.

**Reads `CanvassActivity` only — deliberately.** A survey submit double-writes a `SurveyResponse` *and*
a `survey_submitted` `CanvassActivity`; the ledger already has a row per survey, so reading it alone
avoids double-counting **and** collapses several quick voter-surveys at one door into a single
door-action (the right unit for a GPS audit — one physical visit — which also prevents a false Rapid
flag). See [METRICS.md](METRICS.md) for the dual-ledger.

The pure detection core is exported as **`computeReasons(rows, pinMap, thresholds)`** (no DB) and
unit-tested in [server/test/flagDetection.test.js](../server/test/flagDetection.test.js) (each flag
type + every guard).

### The five algorithms

All thresholds live in [flagThresholds.js](../server/src/services/audit/flagThresholds.js) (`FLAG_THRESHOLDS`);
the numbers below are the defaults — tune them in that one file.

| Flag | Rule | Guard |
|---|---|---|
| **far** | `distanceFromHouseMeters` (already stamped at record time) tiered on **`distance − accuracy`**: `> 250 m` (~820 ft) → high, `> 75 m` (~250 ft) → medium. | **Null distance is never far** (unknown ≠ far). Subtracting accuracy means a big distance from a *poor* fix reads as **weak_gps**, not far — so bad GPS can't masquerade as bad canvassing. **Correction downgrade:** a far entry whose `replaced.nearest` proves a near visit (effective ≤ `FAR_WARN_M`) within `FAR_CORRECTION_WINDOW_MIN` (720 min) drops to **low** with `detail.downgraded` — see §B.5. **Pin-correction downgrade:** a far entry whose household pin was corrected AFTER the knock, and whose GPS is within `FAR_WARN_M` effective of the **corrected** pin, drops to **low** with `detail.pinDowngraded` — unless `correctedBy` is the flagged user, in which case severity is kept and `detail.pinMovedBySelf` says why. **Never upgrades:** the check lives inside `if (farSev)` and only ever assigns `'low'`, so a pin dragged away can't create or worsen a flag — see §B.7. |
| **weak_gps** | Missing location → high; accuracy `> 250 m` → high, `> 100 m` → medium; else an offline submission → low. **Stale-fix escalation:** when `location.fixTimestamp` is present and the fix predates the tap by `> STALE_FIX_HIGH_SEC` (30 min) → high, `> STALE_FIX_MED_SEC` (5 min) → med (`detail.stale` + `fixAgeSec`); the client caps reused fixes at 2 min, so an honest new client can never trip this — it catches bypassed/old clients and forged payloads. | A **null** accuracy alone is *not* flagged (unknown ≠ bad — it would flood on legacy rows). Absent `fixTimestamp` (legacy rows, old clients) and negative gaps (clock skew) never flag. |
| **mock_gps** | `location.mocked === true` (Android's `isFromMockProvider`, captured on every fix by the app) → **high**, always. | `false`/`null`/absent (iOS, legacy rows, old clients) never flags. Detection is **silent by design**: the canvasser app never blocks or hints on a mocked fix, so the evidence accumulates instead of tipping the cheater off to switch methods. |
| **rapid** | Per canvasser, walk consecutive **distinct-door** actions on the travel timeline; a gap `< 20 s` flags the later action (`< 8 s` → high). | Same-household consecutive actions (a correction) are skipped; notes are excluded; an **identical-timestamp offline pair** is suppressed (that's a sync artifact, not real behavior). |
| **one_spot** | Per canvasser, greedily cluster GPS points within `20 m` over a `30 min` window; fire when a cluster covers **≥ 4 distinct households**. | **Apartment guard:** only fires if those households' **own pins span ≥ 60 m** — many units at one building coordinate (spread ≈ 0) never trip it; a whole street logged from one parked spot does. |

An entry can carry several reasons; its `maxSeverity` is the worst. `haversineMeters`
([utils/normalizeAddress.js](../server/src/utils/normalizeAddress.js)) does the distance math;
`Household.location` is GeoJSON `[lng, lat]`.

### One threshold, everywhere

`FAR_WARN_M` (75 m) is now the **single** "far" threshold. The `flaggedOnly` activity feed and the
`/quality` flagged list in [reports.js](../server/src/routes/admin/reports.js), the
`CanvasserPingPanel` "— far" label on web, and its mobile counterparts — `ActivityRow` and the admin
map's ping-detail sheet ([mobile/app/(app)/admin/map.jsx](../mobile/app/(app)/admin/map.jsx)) — all
reference it (server) / its client mirror ([client/src/lib/flags.js](../client/src/lib/flags.js)) or
mobile mirror ([mobile/lib/flags.js](../mobile/lib/flags.js)) — resolving an old 50 m-server /
100 m-client split so "far" means one thing across the app. (The mobile ping sheet was the last
straggler on 100 m; `/quality`'s far *count* was the last on 50 m, quietly contradicting its own
75 m flagged list until it moved to the shared rule below.)

**The per-canvasser far KPIs go further than the threshold — they share the full rule.**
`farFromHouseCount`/`farFromHousePercent` on `/canvassers/:id/summary` and `/quality` are computed by
`farAssessment` (via [services/audit/farKpi.js](../server/src/services/audit/farKpi.js)) — the same
function the detector calls — so they are accuracy-aware and **pin-aware**: effective distance
(minus GPS accuracy) over 75 m, with honest replaced-chain corrections and post-knock pin fixes
forgiven. They are **living numbers**: correcting a pin retroactively lowers a canvasser's far
count, and the movement is explained rather than silent — `farForgivenByPinCount` rides both
responses, and the flagged lists (`/quality.flaggedActivities`, `/activities?flaggedOnly`) keep
forgiven rows visible with a `pinForgiven` marker. **Lists are annotated, never post-filtered** —
the DB filters stay raw `FAR_WARN_M` supersets so `/activities` pagination math (`total`,
skip/limit) stays exact. The `distanceHistogram` deliberately stays raw frozen-distance — it
describes GPS behavior, not a verdict.

**Units:** storage, thresholds, and all detection math are **meters**; every user-facing string
converts at display time to **feet, then miles at ≥ 1 mile** — web via `formatDistanceImperial`
([client/src/lib/flags.js](../client/src/lib/flags.js)), mobile via `formatDistance`
([mobile/lib/geo.js](../mobile/lib/geo.js)). Never render a raw meter value.

### B.5 The `replaced` snapshot (correction downgrade)

"Latest wins" for a re-recorded door is a **delete-then-create**
([routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js) `REPLACEABLE_ACTIONS` +
`deleteMany`), which used to destroy the prior entry's GPS evidence: an honest correction made after
walking away kept only the far location and fired a med/high far flag, indistinguishable from a
phantom knock — with the exonerating near reading deleted.

Both write paths (dispositions **and** the survey route) now stamp the new row with a
**server-computed** `replaced` snapshot, built by `buildReplacedSnapshot(mineRows)` from the same
pre-read (`pairRows`) the stats delta already uses — **before** the `deleteMany`, never a re-query:

```
replaced: {
  actionType, timestamp, location {lat,lng,accuracy}, distanceFromHouseMeters,  // the IMMEDIATE prior entry (UI context line)
  nearest: { distanceFromHouseMeters, accuracy, timestamp },                     // best door-presence evidence in the CHAIN
}
```

- **`nearest` carries the chain forward:** it's the min-**effective**-distance (`distance − accuracy`)
  candidate among the prior row's own stamp and the prior row's `replaced.nearest`. So A (at door) →
  B (correction from afar) → C (second correction from afar) still proves the A visit on C.
- **Detection** ([flagDetection.js](../server/src/services/audit/flagDetection.js)): every far
  correction gets `detail.priorActionType/priorMeters/priorAccuracy/minutesSincePrior` (the UI
  context line renders on *every* correction, downgraded or not). The severity drops to **low** +
  `detail.downgraded/nearestMeters/minutesSinceNearest` only when `nearest` is within `FAR_WARN_M`
  effective **and** the correction landed within `FAR_CORRECTION_WINDOW_MIN` (720 min ≈ the same
  canvassing day) of it; a negative gap (clock skew) never downgrades.
- **`replaced` is never accepted from the request body** (the zod schemas don't know it) — a client
  can't forge exoneration.
- **Legacy rows lack `replaced`** → no special treatment, no migration, no new index. But the field
  **must be in the detector's scan projection** (flagDetection.js) — dropping it from that string
  silently disables the downgrade while everything else keeps passing.
- The UI line ("Replaced "Restricted" recorded 4 min earlier from 20 ft away") is built by
  `correctionContextText` in [client/src/lib/flags.js](../client/src/lib/flags.js) and its mobile
  mirror [mobile/lib/flags.js](../mobile/lib/flags.js).

### B.7 Pin-correction downgrade (a corrected pin forgives a stale far flag)

`distanceFromHouseMeters` is measured against the pin **as it stood when the door was recorded**
([routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js) `distanceFromHouse`) and is never
recomputed — `updateHouseholdLocation` doesn't so much as import `CanvassActivity`. So an approximate
geocode (street centroid, interpolated address) flags a canvasser who really did walk to the door, and
correcting the pin afterwards left that flag standing **forever**. The detector now checks the live
geometry as well, in the one direction that can only help.

- **Transport: a 4th parameter,** `computeReasons(rows, pinMap, thresholds, pinFixMap)`. `pinFixMap`
  maps householdId → `{lng, lat, correctedAt, correctedBy}` for corrected pins only. It is deliberately
  **not** folded into `pinMap`: those values are shipped verbatim to the client as
  `entry.household.location`, so enriching them would start leaking `correctedBy` (a raw User id no
  client has ever received). `correctedBy` is compared inside the detector and only the derived boolean
  leaves. Defaults to an empty Map, so every three-arg caller (all the unit tests but the two one-spot
  ones) is byte-identical.
- **`coordSource === 'corrected'` is part of the filter, not belt-and-braces.** A re-import with
  `overwriteHandEdits` puts the file's coordinate back and resets `coordSource`, but never clears
  `correctedAt`/`correctedBy` ([csvImporter.js](../server/src/services/import/csvImporter.js)) — so
  `correctedAt` alone would claim "the pin was moved here" about a pin that is the file's again.
- **The rule:** a post-knock correction (`correctedAt > row.timestamp`, strict) attaches
  `detail.pinCorrectedMeters` + `pinCorrectedAt` as reviewer context regardless. If the live distance
  minus accuracy is within `FAR_WARN_M`, severity drops to `low` with `detail.pinDowngraded` — unless
  `correctedBy === row.userId`, which sets `detail.pinMovedBySelf` and keeps the severity.
- **It never upgrades.** The block sits inside `if (farSev)` and assigns nothing but `'low'`. A pin
  dragged *away* from a door cannot manufacture or worsen a flag.
- **The self-move guard is a WITHHOLD, not a revert.** If the `replaced` chain already earned `low` on
  independent at-the-door evidence, a self-move leaves it there — taking it back would be an upgrade.
- **Clock skew is self-limiting, which is why there's no guard for it.** An offline knock flushed after
  a correction has its frozen distance computed at *flush* time, i.e. already against the corrected
  pin: if that reads far, the live check reads far too and nothing downgrades; if it reads near, there
  was never a far flag. No false downgrade is reachable.
- **Residual risk, named:** an *accomplice* — a lead moving a pin to exonerate someone else's phantom
  knock — is out of the guard's reach. Mitigated by downgrade-never-suppress (the entry stays in the
  audit queue and in every flagged list, visibly marked `forgiven`; a pin-forgiven entry does leave
  the per-canvasser far *count*, but `farForgivenByPinCount` keeps the forgiveness volume itself
  observable) and by `HouseholdLocationChange`, which logs who moved what, from where, when.
- **Two callers, one implementation.** The far rule is the exported `farAssessment(row, fix,
  thresholds)`; `computeReasons` (this detector) and the per-canvasser KPI helper
  ([services/audit/farKpi.js](../server/src/services/audit/farKpi.js)) both call it, and the
  corrected-pin filter is the shared `buildPinFixMap`. Change the rule in one place and every far
  surface moves together; there is no second implementation to drift.
- **The household projection is load-bearing, exactly like the `replaced` one above.** It must carry
  `coordSource correctedAt correctedBy` — drop them and the downgrade silently stops firing while every
  unit test that passes an empty `pinFixMap` keeps passing. `server/test/mobilePinRole.int.test.js` and
  the flags-endpoint assertions are what catch it.
- The UI lines are `pinCorrectionText` / `isPinDowngraded` / `isSelfMovedPin` in the two `flags.js`
  mirrors; `FlaggedEntryPanel` prints both distances side by side, because the map's leader line is
  drawn to the **current** pin and used to silently contradict the frozen label.

### B.6 Location-required enforcement (no location = no knock)

Recording a disposition or survey **requires a live GPS fix**, enforced twice:

- **Client hard gate** — `getCanvassLocation()` in [mobile/lib/location.js](../mobile/lib/location.js)
  runs inside `optimisticSubmit` ([mobile/lib/recordAction.js](../mobile/lib/recordAction.js))
  **before the optimistic recolor**: device location services on (`hasServicesEnabledAsync`), app
  permission granted, precise (Android `coarse` grants and iOS reduced-accuracy fixes — inferred via
  accuracy > 1 km, expo-location v19 exposes no real API — both throw `PRECISE_OFF`), then a fix:
  cached ≤ 15 s/≤ 20 m → fresh high-accuracy read (6 s race) → last-known **capped at 2 minutes**
  (the old any-age fallback was a stale-fix spoofing loophole). A typed failure
  (`SERVICES_OFF | PERMISSION_DENIED | PRECISE_OFF | NO_FIX`) shows a per-code alert with retry —
  nothing is recorded, recolored, or queued. The map shows a persistent advisory banner
  ([mobile/components/LocationBlockedBanner.jsx](../mobile/components/LocationBlockedBanner.jsx)).
  Pin corrections (`recordLocationCorrection`) are deliberately **not** gated (`requireFix: false`) —
  the moved coordinate comes from the map drag, and map hygiene must stay possible. (This is about the
  *location* gate only. Pin correction is separately restricted by **role** — leads/admins/supers, see
  [MAPS.md](MAPS.md) — so "map hygiene" now names a lead's job, not a canvasser's.)
- **Server backstop** — [routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js) rejects a
  missing/degenerate `location` on both write paths with `400 { error, code: 'LOCATION_REQUIRED' }`
  **before** zod (so clients get the typed message, not a zod dump). This replaces the accidental
  blocking the old zod schema provided, and catches bypassed or old clients.

Every stamp now carries provenance, nested in `location`: **`mocked`** (Android
`isFromMockProvider`; null = unknown/iOS) and **`fixTimestamp`** (when the OS computed the fix, vs
`timestamp`, the tap). Nesting is deliberate — the `replaced` correction snapshot (§B.5) embeds the
same sub-schema, so snapshots carry provenance for free, and the detector's scan projection already
covers `location`. `SurveyResponse.location` mirrors the fields so the two ledgers can't drift.

**Offline is unaffected**: GPS is satellite-based (no cell signal needed), and the stamp is captured
at tap time — only the POST queues. Old-client rollout note: a pre-gate client that fails GPS still
sends `location: null` and gets the 400 (now with a readable message); if such an item was queued
offline, the flush's pre-existing 4xx policy drops it (offlineQueue.js doFlush) — unchanged behavior.

## C. Review persistence (`FlagReview`)

[FlagReview.js](../server/src/models/FlagReview.js) stores **only decisions**, keyed to a stable
`(organizationId, actionModel, actionId)` (unique index — the upsert key):

```
{ organizationId, campaignId, actionModel:'CanvassActivity'|'SurveyResponse', actionId,
  status:'reviewed'|'dismissed'|'confirmed', note, reviewedBy, reviewedAt, reasonsAtReview[] }
```

- **`open` is never stored** — the *absence* of a record is Open. The detector synthesizes
  `{ status:'open' }` on the join, so a flag can't be lost and nothing needs backfilling.
- **Reopen deletes the record** (back to synthesized-open), preserving the "no open rows stored" invariant.
- `reasonsAtReview` snapshots the reasons at decision time, so a decision survives a later threshold
  change (if an action stops being flagged, its review just goes dormant).
- **A pin correction changes severity UNDER an existing decision, and deliberately does not re-open
  it.** Unlike a disposition correction — a delete-then-create whose new `_id` orphans the old review
  (below) — moving a pin leaves the `CanvassActivity` row alone, so a decision made at `high` can end
  up sitting over a `low`. Auto-reopening would be worse: reopen *is* a delete, so it would destroy a
  `confirmed` fraud finding with no replacement row to carry it. Deciding "moved since the review" also
  needs state the detector refuses to hold ("flags are derived, not stored"). And the drift is always
  toward *less* severe (§B.7 never upgrades), so the dangerous direction — a dismissal quietly sitting
  over something worse — is unreachable. `reasonsAtReview` is the hedge, and the panel says *"The pin
  was moved after this was reviewed"* when `pinCorrectedAt` post-dates `reviewedAt`.

It's a brand-new empty collection — **no migration**.

### A correction re-opens the flag, and that is the policy

A decision is keyed to one `CanvassActivity._id`, and a correction is a **delete-then-create** — the
replacement row gets a **new `_id`**, so the old decision no longer points at anything and the flag
reads as Open again. That is deliberate, and it is what the owner asked for. Verified against the
live app:

| The canvasser… | The flag | |
|---|---|---|
| records from 300 m | flags `far`/high | |
| …you dismiss it | dismissed | |
| …then **re-records at 10 m** | **no flag** | the correction genuinely fixed it |
| …then **re-records at 300 m again** | **flags again, Open, high** | a repeat offence must not inherit the dismissal |

> ⚠️ **Do not "fix" this by carrying decisions forward onto the replacement row.** It looks like
> orphaning and it is tempting to treat as a bug. Carrying a decision forward breaks the last row of
> that table: a canvasser who does the same thing again — or something worse — at a door you already
> cleared would arrive **pre-dismissed and never appear in your queue**. In a fraud tool, being asked
> twice beats being told never.

**The one genuine gap** is the decision *history*, and only `confirmed` matters. When a confirmed
fraud finding's door is later corrected, the flag correctly clears — but the finding itself becomes
unreachable, so a canvasser can retire their own finding by re-recording that door properly, and an
end-of-campaign "how many confirmed findings on this canvasser" cannot see it. Worse, a `FlagReview`
stores **no canvasser and no household** (they lived on the deleted action), so an orphaned finding
is *unattributable* as well as invisible.

`npm run audit:orphaned-reviews`
([auditOrphanedReviews.js](../server/src/migrations/auditOrphanedReviews.js)) counts them — read-only,
reports the population checked so a clean run is evidence rather than an empty query, and separates
`confirmed` from `dismissed` (a lost dismissal just means the flag came back for another look).

> **Measured 2026-07-20: 113 decisions checked, 0 orphaned.** Real usage, no losses — so this stayed
> documented rather than fixed. If a future run reports confirmed findings, the fix is a durable home
> for them against the canvasser; it is **not** a change to the flag behaviour above.

## D. Endpoints

Both live on the `/admin/reports` router, inheriting its auth, the **team-lead → managed-campaign**
gate, and anchor-tz resolution.

| Endpoint | Purpose |
|---|---|
| `GET /admin/reports/flags` | Runs `detectFlags` over `{ baseFilter + date window + optional userId }`. Returns `{ summary, entries, total, timeZone, tzAbbrev, thresholds }`. **`summary` is always the full picture** for the scope; `reasonType` / `reviewStatus` (incl. `open`) / `severity` narrow the paginated `entries`. `view=summary` skips the entries payload. An explicit range over **62 days** is rejected (same cap as the timeline). |
| `POST /admin/reports/flags/review` | Body `{ actionModel, actionId, status, note?, reasonsAtReview? }`. Loads the action to re-derive its campaign and re-checks `canManageCampaign` (defense in depth — a lead can't review another campaign's entry by guessing an id). Upserts the decision; `status:'open'` **deletes** it (reopen). **Body-only — it takes no `?campaignId`, and is the one route EXEMPT from the router's campaign-scope guard** (see below). |

> **Why this write is exempt from the campaign-scope guard.** `routes/admin/reports.js` mounts a bare
> `router.use` that requires `?campaignId` (or `all=1`) so a *read* can't silently blend two campaigns'
> numbers into one figure. It has no method filter and reads `req.query` only — and `POST /flags/review`
> is the router's **only** non-GET route. Because the handler re-derives `campaignId` from the flagged
> record and re-checks `canManageCampaign` itself, it never wants the param, and neither client sends
> one. Left unexempted the guard **400s admins in any multi-campaign org and 403s team leads in every
> org** (the lead branch has no single-campaign escape hatch), which shipped and broke flag review on
> web and mobile alike. The exemption is by exact method+path, deliberately not "any non-GET", so a
> future write to this router still gets scoped. Regression-tested in `test/locationGate.int.test.js`
> (admin + granted lead succeed, ungranted lead still 403s, unscoped GET still 400s).

Filtering by `open` happens **after** the live join (it isn't a DB status), so the endpoint slices the
computed+joined list in memory and returns the pre-slice `total`.

## E. Frontend

- **Audit page** — [AuditPage.jsx](../client/src/pages/AuditPage.jsx) at `/campaigns/:campaignId/audit`
  (console-user gated in [App.jsx](../client/src/App.jsx); nav slug `audit` in
  [navItems.js](../client/src/components/navItems.js)). Mirrors [TimelinePage.jsx](../client/src/pages/TimelinePage.jsx)
  (campaign-tz `defaultRange('today')`, 62-day cap, `LiveStatus` + 20 s poll while the range includes
  today). KPI cards + [AuditSummaryTable.jsx](../client/src/components/AuditSummaryTable.jsx) (per
  canvasser; row click sets the `userId` drill-in) + [FlaggedEntryList.jsx](../client/src/components/FlaggedEntryList.jsx)
  (cards with [FlagReasonBadges](../client/src/components/FlagReasonBadges.jsx) + the shared
  [FlagReviewControl](../client/src/components/FlagReviewControl.jsx) + a **"View on map"** deep-link).
  The summary is fetched full; reason chips + `userId` are applied client-side so those toggles are
  instant.
- **Map overlay** — when "Show flagged entries" is on, [MapPage.jsx](../client/src/pages/MapPage.jsx)
  runs a **second** query to `/admin/reports/flags?view=entries` (separate from the households query, so
  toggling flags never refetches households) and pushes a `flagged-pings` + `flagged-lines` layer
  registered in [mapRender.js](../client/src/lib/mapRender.js) (`flagsToGeoJSON` / `flagsToLinesGeoJSON`,
  colored by the worst reason via `primaryReason`; actioned flags fade). The "GPS audit" section in
  [MapFilters.jsx](../client/src/components/MapFilters.jsx) holds the toggle, reason chips (with counts
  from `summary.totals`), and the review-status filter. Clicking a flag opens
  [FlaggedEntryPanel.jsx](../client/src/components/FlaggedEntryPanel.jsx).
- **Deep-link** — `View on map` navigates to
  `/campaigns/:id/map?flag=1&focusActivityId=<id>&userId=<uid>&from=<>&to=<>`; MapPage seeds those from
  the URL (turns the layer on, scopes to the canvasser + window, defaults status to **all** so a
  reviewed entry still shows, and flies to the flagged point once its data lands).
- **Reason/severity/status display metadata** (colors, labels, human detail text) is centralized in
  [client/src/lib/flags.js](../client/src/lib/flags.js), which also mirrors the two thresholds the
  client needs.

## F. Invariants / gotchas

- **Flags are derived, not stored.** Only `FlagReview` decisions persist; **open = no record**. Don't
  add a materialized-flags collection or a worker — the detector runs live and is cheap (a day is a few
  thousand rows; per-canvasser sort/cluster is in-memory, like `computeOverlaps`).
- **Read `CanvassActivity` only.** Unioning `SurveyResponse` would double-count surveys and manufacture
  false Rapid flags (see §B / [METRICS.md](METRICS.md)).
- **Weak GPS ≠ far.** `far` tiers on `distance − accuracy`; a large distance from a poor fix is `weak_gps`.
- **The apartment guard is load-bearing** for `one_spot` — it requires spread-out house pins, not just
  distinct households at one coordinate.
- **`summary` is always the full scope**; the list filters (reason/status/severity/userId) narrow only
  the `entries` you review — so the KPI cards and per-canvasser table stay honest while you triage.
- **Corrections are downgraded, never suppressed.** A downgraded-low far still appears (and still
  counts in `summary.totals.far` while open) — full suppression would let a canvasser who once
  legitimately visited a door rewrite its status from anywhere, unflagged.
- **Live geometry may only DOWNGRADE.** The pin-correction check (§B.7) runs inside `if (farSev)` and
  assigns nothing but `'low'`. A pin dragged *away* from a door must never manufacture or worsen a flag
  — a canvasser can't be graded on an edit they didn't make and (pins being lead/admin-only) couldn't
  have made. And the self-move guard is a **withhold, not a revert**: when the `replaced` chain has
  already earned `low`, a self-move keeps it, because taking it back would itself be an upgrade.
- **The replace must never run without stamping the snapshot.** `buildReplacedSnapshot` reads the
  pre-`deleteMany` rows; any new replace path (or a reorder that queries after the delete) silently
  destroys the correction evidence again.
- **Absent provenance never flags.** `location.mocked` `false`/`null`/absent and a missing
  `location.fixTimestamp` (legacy rows, old clients, iOS for `mocked`) must never produce a
  `mock_gps` or stale-fix flag — only affirmative evidence flags.
- **Mock detection stays invisible in the canvasser app.** No alert, no block, no copy anywhere in
  `mobile/` mentions mock locations — blocking would tell the cheater exactly what got detected;
  silent flags accumulate evidence instead. Keep it that way.
- **The location gate lives BEFORE the optimistic patch.** A blocked tap must leave zero trace — if
  the gate ever moves after `writeBootstrap`/`markPendingHousehold`, a blocked knock would need
  rollback and could linger as a phantom recolor.
- **`openMockFlags` window parity.** The nudge counts `AUDIT_WINDOW_MAX_DAYS − 1` days (a strict
  subset of the flags endpoint's `TIMELINE_MAX_DAYS = AUDIT_WINDOW_MAX_DAYS` cap, which the
  dashboard deep link seeds) so a badge can never point at an entry the Audit page won't show. It
  excludes `via:'bulk'` (parity with the detector's scan filter), and open = no `FlagReview` row.
  Served by the partial index `{campaignId, 'location.mocked'}` — **deliberately a distinct key
  shape**: buildIndexes diffs by key shape only, so a partial index reusing an existing key would
  silently never build.
- **Reviewing a flag must invalidate the nudge sources.** All four review handlers (web
  AuditPage/MapPage, mobile audit/map) invalidate `['admin','campaigns']` + the campaign-rollup
  keys alongside the flags queries — miss one and a cleared flag leaves a stale badge.
- **The pin-correction change inverts the deploy order: mobile OTA FIRST.** "Server first" exists so a
  client never calls an endpoint that doesn't exist yet. Restricting pin-moving to leads/admins does the
  opposite — it *removes* a client capability — so deploying the server first would leave every
  canvasser tapping a live "Fix pin location" button into a 403 for the whole OTA window. Ship the OTA
  that hides the affordance, let it propagate, then deploy the server (which also carries the Help
  Center copy, so the article retarget lands at the same instant the endpoint starts refusing).
  **No migration and no `buildIndexes` run** — no new field is written and the household query shape is
  unchanged; only its projection widened. No client-version bump either: the endpoint keeps its shape,
  and an old bundle gets a typed, readable 403 that rolls the optimistic pin back.
- **Deploy the server first** (the endpoints must exist before the client calls them). `FlagReview`,
  the `replaced` snapshot, and the `location.mocked`/`fixTimestamp` fields all need **no migration**
  (absence = open / no special treatment / never flags). The nudge's partial index DOES need the
  index migration (prod autoIndex is off): run `node src/migrations/buildIndexes.js --apply` on
  deploy (dry-run first). The location gate, banner, context line, nudge badges + imperial units
  are JS-only: web deploy + mobile **OTA** (no native build — app.json untouched, expo-location
  already installed).
