# GPS audit (flagged entries — canvassing quality)

How an admin catches bad canvassing from the **GPS trail** every knock already leaves. Each recorded
door carries the canvasser's location, so the app can flag the ones that look wrong — a door marked
from far away, a burst of doors logged too fast to have walked between them, a cluster of doors all
logged from one spot (sat in the car), or an entry whose GPS was too weak to trust — then let a
reviewer **triage** each one and keep a record of the decision.

- **Part 1 — For everyone** is plain language: what gets flagged and why, the two places you review
  them (a dedicated Audit page and the map), and what "reviewing" a flag does.
- **Part 2 — Technical reference** is for developers (and Claude): the live detector + its four
  algorithms, the thresholds, the review model (open = no record), the endpoints, and the frontend.

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
- Or was the GPS just **bad** on that entry, so you shouldn't trust the location at all?

The audit turns those into four kinds of **flags** and shows you **how many**, **who** they belong to,
**why** each one is flagged, and gives you a way to **review** each one.

## The four flags

| Flag | Plain meaning |
|---|---|
| **Far from house** | The canvasser's GPS was well away from the house pin when they recorded — a door they may not have walked to. (Accounts for GPS wobble — a big distance caused by a *weak* fix is treated as Weak GPS, not Far.) |
| **Rapid succession** | Two different doors logged only seconds apart — too fast to have walked between them (a sign of arm-chairing a block). |
| **One spot** | A run of *different* doors all logged from nearly the **same** GPS point, while those houses are actually spread down the street — i.e. entered from one place (a parked car), not walked. |
| **Weak / missing GPS** | The location fix was poor (or absent, or synced from offline) — the entry's location can't be trusted either way. |

**On purpose, an apartment building doesn't trip "One spot."** Standing at one entrance to log ten
units is normal canvassing — those units share one map pin, so the app only flags a one-spot cluster
when the **houses themselves are spread out** but the canvasser never moved.

Each flag has a **severity** (low / medium / high) so the worst ones stand out.

## Where you review them — two places

**1) The Audit page** (inside a campaign, next to Timeline and Map). It opens on **Today** and shows:

- **KPI cards** — total flagged, and a count for each of the four flags, plus how many are still open.
- **A per-canvasser table**, worst-first: each canvasser's flag counts by type and their worst
  severity. Click a row to drill into just that person's flagged entries.
- **The entries list** — one card per flagged door: who, the address, the time, the reason(s) with the
  actual number (e.g. *62 m from house*, *8 s after the previous door*), and the review buttons. Each
  card has a **"View on map"** link that jumps to the map focused on that exact entry.

Filter the list by flag type, by review status (Open / Reviewed / Dismissed / Confirmed), by walk
list, or by date.

**2) The map** (the same admin map you already use). Turn on **"Show flagged entries"** in the left
panel and each flag appears as a colored dot at the spot it was recorded, with a line back to the
house — so you can *see* the geography (on the street? across the block? all from one corner?). The
reason chips show the counts; clicking a flag opens a panel to review it right there.

## What "reviewing" does

A flag starts **Open**. You mark it:

- **Reviewed** — you looked, it's fine / noted.
- **Dismissed** — not a real problem (e.g. a known GPS-bad neighborhood).
- **Confirmed issue** — a genuine problem to follow up on.

You can add a note, and the app records **who** decided and **when**. Your decision sticks to that
entry, so an open flag never quietly disappears and the team can see what's already been checked. You
can always **reopen** a flag to set it back to Open.

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

## B. The detector

`detectFlags(match, { organizationId })` ([flagDetection.js](../server/src/services/audit/flagDetection.js))
takes a **prebuilt `CanvassActivity` filter** (org / campaign / effort + `timestamp` window, optional
`userId`) — the same contract as `computeOverlaps(match, …)` — so it's `req`-free and reusable by both
surfaces. It:

1. Loads the window's `CanvassActivity` rows (sorted by `userId, timestamp`) and the involved
   households' pins/addresses (one query each), then groups rows into a **per-canvasser timeline**.
2. Runs the four detectors (below) into a per-action reason map.
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

### The four algorithms

All thresholds live in [flagThresholds.js](../server/src/services/audit/flagThresholds.js) (`FLAG_THRESHOLDS`);
the numbers below are the defaults — tune them in that one file.

| Flag | Rule | Guard |
|---|---|---|
| **far** | `distanceFromHouseMeters` (already stamped at record time) tiered on **`distance − accuracy`**: `> 250 m` → high, `> 75 m` → medium. | **Null distance is never far** (unknown ≠ far). Subtracting accuracy means a big distance from a *poor* fix reads as **weak_gps**, not far — so bad GPS can't masquerade as bad canvassing. |
| **weak_gps** | Missing location → high; accuracy `> 250 m` → high, `> 100 m` → medium; else an offline submission → low. | A **null** accuracy alone is *not* flagged (unknown ≠ bad — it would flood on legacy rows). |
| **rapid** | Per canvasser, walk consecutive **distinct-door** actions on the travel timeline; a gap `< 20 s` flags the later action (`< 8 s` → high). | Same-household consecutive actions (a correction) are skipped; notes are excluded; an **identical-timestamp offline pair** is suppressed (that's a sync artifact, not real behavior). |
| **one_spot** | Per canvasser, greedily cluster GPS points within `20 m` over a `30 min` window; fire when a cluster covers **≥ 4 distinct households**. | **Apartment guard:** only fires if those households' **own pins span ≥ 60 m** — many units at one building coordinate (spread ≈ 0) never trip it; a whole street logged from one parked spot does. |

An entry can carry several reasons; its `maxSeverity` is the worst. `haversineMeters`
([utils/normalizeAddress.js](../server/src/utils/normalizeAddress.js)) does the distance math;
`Household.location` is GeoJSON `[lng, lat]`.

### One threshold, everywhere

`FAR_WARN_M` (75 m) is now the **single** "far" threshold. The legacy far-knock counters and the
`flaggedOnly` activity feed in [reports.js](../server/src/routes/admin/reports.js), and the
`CanvasserPingPanel` "— far" label, all reference it (server) / its client mirror
([client/src/lib/flags.js](../client/src/lib/flags.js)) — resolving an old 50 m-server / 100 m-client
split so "far" means one thing across the app.

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

It's a brand-new empty collection — **no migration**.

## D. Endpoints

Both live on the `/admin/reports` router, inheriting its auth, the **team-lead → managed-campaign**
gate, and anchor-tz resolution.

| Endpoint | Purpose |
|---|---|
| `GET /admin/reports/flags` | Runs `detectFlags` over `{ baseFilter + date window + optional userId }`. Returns `{ summary, entries, total, timeZone, tzAbbrev, thresholds }`. **`summary` is always the full picture** for the scope; `reasonType` / `reviewStatus` (incl. `open`) / `severity` narrow the paginated `entries`. `view=summary` skips the entries payload. An explicit range over **62 days** is rejected (same cap as the timeline). |
| `POST /admin/reports/flags/review` | Body `{ actionModel, actionId, status, note?, reasonsAtReview? }`. Loads the action to re-derive its campaign and re-checks `canManageCampaign` (defense in depth — a lead can't review another campaign's entry by guessing an id). Upserts the decision; `status:'open'` **deletes** it (reopen). |

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
- **Deploy the server first** (the endpoints must exist before the client calls them). **No mobile
  change** — the GPS was already captured — so no OTA/native build, and `FlagReview` needs no migration.
