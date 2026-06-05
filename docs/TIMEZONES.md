# Timezones

How the app decides what "a day" is, and which clock every date and time is shown in. This is a
cross-cutting concern: it governs the **counts** (METRICS), the **date filters** (DATE_FILTERS), and
every **displayed timestamp** across web and mobile.

- **Part 1 — For everyone** is plain language: the one rule, why it exists, and what you see.
- **Part 2 — Technical reference** is for developers (and Claude): the anchor-tz resolution, the
  date-window math, day bucketing, the preset builders, display formatting, and the data flow.

Related: [METRICS.md](METRICS.md) (the numbers anchored by this), [DATE_FILTERS.md](DATE_FILTERS.md)
(the date-range control that sends days into the anchor tz), [USERS.md](USERS.md) (multi-org / who an
admin is).

---

# Part 1 — For everyone

## The one rule: every campaign owns its timezone

A **campaign defines its own day.** A campaign in Texas runs on **Central** time; a campaign in
Florida runs on **Eastern**. "June 3" for the Texas campaign means midnight-to-midnight *Central* —
the same window for every admin looking at it, whether they are in Tyler, Las Vegas, New York, or
Tokyo.

Why this matters: an **organization** is a firm or consultant that can run several campaigns in
different states at once, and its admins are spread across the country. If each admin saw "today" in
their *own* timezone, the same campaign would show different numbers to different people, and a knock
logged at noon would read as a different time on each screen. Anchoring everything to the campaign
removes that — the data belongs to the campaign, so it is shown in the campaign's clock.

## What you actually see

- **Counts** — "6/3" on a campaign dashboard is that campaign's June 3, identical for every admin.
- **Presets** — **Today / Yesterday / Last week …** mean the **campaign's** today, yesterday, week.
  A Tokyo-based admin asking for "Yesterday" on a Texas campaign gets *Texas's* yesterday, not their
  own (which, 14 hours ahead, could already be a different day).
- **Times** — a knock made at 12:01 PM Central shows as **"12:01 PM CDT"** to everyone, with the
  zone label so it is never ambiguous.

## When the *organization's* timezone is used instead

A campaign's timezone only applies where a single campaign does. Two places use the **org** timezone
as the shared anchor:

- The **Overview rollup** (org-wide), which sums campaigns that may span zones — no one campaign's
  clock applies.
- **User-level** timestamps — when someone joined the org, last login, an import job — which are not
  tied to one campaign's wall clock.

## Setting a campaign's timezone

New campaigns **default their timezone from their state** (Texas → Central, Florida → Eastern). About
a dozen states straddle two zones (e.g. El Paso is Mountain, the Florida panhandle is Central), so the
campaign form has a **Timezone** dropdown to override the guess. The org has its own timezone for the
rollups above.

## The one exception: personal stats

The canvasser's own **My Stats** screen stays on the **phone's local time** — it is a personal
motivation view, not cross-admin reporting, so "today" there means the canvasser's today.

---

# Part 2 — Technical reference

## A. The anchor timezone

Every admin report resolves an **anchor timezone** and uses it for both the date window and per-day
bucketing. The rule (in [reports.js](../server/src/routes/admin/reports.js) `resolveAnchorTz`, exposed
as `req.anchorTz` by a router-level middleware):

```
campaignId in the query  → that campaign's  Campaign.timeZone
otherwise (org-wide)      → the org's        Organization.timeZone
fallback                  → 'America/New_York'
```

`parseDateRange(req, field)` and `tzOf(req)` (day bucketing) both read `req.anchorTz`. The viewer's
device timezone is **never** used for a report window or bucket.

| Field | Where | Default |
|---|---|---|
| `Campaign.timeZone` | [models/Campaign.js](../server/src/models/Campaign.js) | from `state` on create (see §E) |
| `Organization.timeZone` | [models/Organization.js](../server/src/models/Organization.js) | `America/New_York` |

## B. The date window (counts + filters)

Clients send **date-only** `from` / `to` as `YYYY-MM-DD` (not instants). The server turns them into a
UTC window **in the anchor tz** with [utils/timezone.js](../server/src/utils/timezone.js)
`zonedDayRange(fromDay, toDay, tz)`:

```
window = [ startOfDay(fromDay, tz),  startOfDay(toDay + 1 day, tz) )      // half-open
```

So `from` and `to` are **both inclusive days** — the window covers the whole `to` day. A single day
(`from === to`) is a full 24-hour window (this is what fixed "Yesterday" returning two days). Helpers:

| Helper | Purpose |
|---|---|
| `zonedTimeToUtc(y,mo,d,h,mi,s,tz)` | UTC instant for a wall-clock time in `tz` (DST-aware via `Intl` offset re-measurement). |
| `zonedDayRange(fromDay,toDay,tz)` | `{ $gte, $lt }` for the inclusive day span (the above). |
| `tzAbbrev(tz, at)` | Short label, e.g. `CDT`/`CST` (DST-aware). |
| `zonedDayStr(instant, tz)` | `YYYY-MM-DD` for an instant as seen in `tz` (matches the Mongo buckets). |

`parseDateRange` slices any incoming value to its first 10 chars before calling `zonedDayRange`, so it
is robust to a legacy ISO instant, but the clients now send date-only. **No server change is needed
to add a new date-filtered endpoint** — it inherits `req.anchorTz` from the middleware.

## C. Day bucketing

Per-day groupings (per-canvasser daily/summary/CSV, the user stats chart) bucket with Mongo
`$dateToString` in the anchor tz: `dayBucketExpr(field, tzOf(req))` in
[reports.js](../server/src/routes/admin/reports.js). The per-user stats chart in
[memberships.js](../server/src/routes/admin/memberships.js) buckets in `Organization.timeZone` (it
spans the user's activity across all their campaigns, so the org is the right anchor).

## D. Presets are computed in the anchor tz, client-side

Presets resolve to **date-only days in the anchor tz**, never the device clock. Pure, mirrored
modules:

- Web: [client/src/lib/datePresets.js](../client/src/lib/datePresets.js)
- Mobile: [mobile/lib/dateRanges.js](../mobile/lib/dateRanges.js)

Both expose `todayInTz(tz)` (`Intl … en-CA` → `YYYY-MM-DD`) and UTC-based calendar math
(`shiftDays`, week/month boundaries) so arithmetic never touches the device tz. `rangeFor(preset,
custom, tz)` / `quickRangeFor(key, tz)` return date-only bounds (open presets `to: null`; closed
presets' `to` is the **last included day**).

**The gate.** Each campaign-scoped surface keeps its range **null until the campaign tz is known**
(the campaigns list / active campaign has loaded), and gates its report queries on it — so a preset
never resolves in, or fetches with, the device clock. Web pages source the tz from the campaigns
cache by `campaignId` (or `useCampaignSelection().selected`), falling back to `useOrgTimeZone()`;
mobile screens pass the active (or route) `campaign?.timeZone`. The custom pickers send the picked
**calendar dates** as date-only (no `toISOString`, which is UTC and shifts a day in negative-offset
zones).

## E. Defaulting from state + the migration

- [utils/usStateTimeZone.js](../server/src/utils/usStateTimeZone.js) — `defaultZoneForState(state)`
  (dominant IANA zone per US state) + `US_TIMEZONES` (the override dropdown list). Campaign create
  ([routes/admin/campaigns.js](../server/src/routes/admin/campaigns.js)) defaults `timeZone` from
  `state`; the SPA campaign form has the dropdown.
- [migrations/migrateTimeZones.js](../server/src/migrations/migrateTimeZones.js)
  (`npm run migrate:timezones [-- --apply]`) — backfills each campaign's `timeZone` from its state
  (replacing the old blanket Eastern default) and sets each org's `timeZone` to its campaigns' most
  common zone. Idempotent.

## F. Displaying timestamps

A timestamp is shown in the timezone of whatever **owns** it, with a short label, via shared
formatters:

- Web: [client/src/lib/datetime.js](../client/src/lib/datetime.js) — `formatInTz(instant, tz, opts,
  withLabel)`, `tzAbbrev(tz)`. `useOrgTimeZone()` ([auth/AuthContext.jsx](../client/src/auth/AuthContext.jsx))
  reads the active org's tz from the `/auth/me` payload.
- Mobile: [mobile/lib/datetime.js](../mobile/lib/datetime.js) — `formatInTz`, `tzAbbrev`, and
  `formatExact(date, tz)` / `formatRange(first, last, tz)` (the optional `tz` anchors + labels them).

Who passes which tz:

| Surface | tz used |
|---|---|
| Campaign-scoped web display (dashboard canvasser panels, map house/ping panels, turf snapshots, walk lists, early-voting uploads) | the **campaign** tz, threaded from the page (report-response `timeZone` or the campaigns cache) as a `tz` prop; components fall back to `useOrgTimeZone()` |
| Org-wide / user-level (Overview card, import jobs, user profile) | `useOrgTimeZone()` |
| Mobile admin screens | the active campaign's `timeZone` (carried on the saved active campaign — see §G) |
| Mobile personal stats | **device-local** (the deliberate exception) |

`timeAgo` ("5m ago") is relative and tz-agnostic — left as-is everywhere.

## G. How the campaign tz reaches the clients

- **Report responses** `/overview` and `/campaign-rollup` return `timeZone` + `tzAbbrev` (the resolved
  anchor) so a page can label its filter and feed its display.
- **Mobile** carries `timeZone` on the campaign objects: `/mobile/campaigns` and `/mobile/bootstrap`
  include it, and the saved **active campaign** (`saveActiveCampaign` in
  [mobile/lib/cache.js](../mobile/lib/cache.js), set by
  [CampaignChip.jsx](../mobile/components/CampaignChip.jsx) and the campaign picker) carries it — so
  every admin screen reads `campaign?.timeZone` with no extra fetch.
- **Web** has `Organization.timeZone` in the `/auth/me` membership payload; campaign tz comes from the
  cached `['admin','campaigns']` list (full docs include `timeZone`) or a report response.

## H. Invariants & gotchas

- **Date-only contract.** Clients send `YYYY-MM-DD`; the server reads it in the anchor tz. Sending an
  instant still works (sliced to its date) but is discouraged.
- **`to` is the last *included* day** (the server adds the +1). Preset builders and the custom picker
  both follow this; a closed preset like Yesterday sends `from === to === that day`.
- **DST-safe.** `zonedTimeToUtc` re-measures the tz offset at each instant, and US day boundaries are
  local midnight (no spring-forward gap), so CST↔CDT transitions are handled.
- **The device `tz` query param is dead.** Some mobile screens still send `tz=deviceTimezone()` to
  `/admin/reports/*`; the server ignores it (uses `req.anchorTz`). Harmless legacy.
- **Display falls back to org tz**, not device, when a campaign tz prop is absent — correct for a
  single-zone org, and an explicit prop makes it exact for multi-zone orgs.
