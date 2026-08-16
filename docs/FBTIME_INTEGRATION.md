# FbTime integration — measured hours in doors-per-hour

How an organization that clocks its canvassers in and out with **FbTime** (the owner's
time-tracking product) can connect it so doors-per-hour divides by **measured clock time** instead
of the knock-span estimate. Opt-in per organization; orgs that never connect see zero change.

Related: [METRICS.md](METRICS.md) (what doors-per-hour means), [TIMEZONES.md](TIMEZONES.md) (day
bucketing), [EXPORTS.md](EXPORTS.md) (the stamped CSV), [AUDIT.md](AUDIT.md) (event history),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the v5 entry for this feature). The provider
contract lives in the FbTime repo: `FbTimeApp/docs/PARTNER_API.md` — its **Connecting** section is
the citation source for the base URL and key naming.

---

## Part 1 — For everyone

### What it does

Doorline normally *estimates* time on doors: each day's first knock to its last knock, added up.
That estimate is wrong in both directions — one knock at 9am and one at 5pm reads as eight hours;
an hour of driving between turfs reads as canvassing. If your canvassers already clock in and out
with FbTime, connecting it makes doors-per-hour divide by the hours they were actually on the
clock.

### What "measured" and "estimated" mean

Every hours figure in your reports now says which it is:

- **Measured** — from FbTime clock time. Marked **FbTime** on the canvasser tables, or the word
  "measured" on mobile.
- **Estimated** — the old knock-span math, used wherever no measured hours exist.

### Why someone's hours are estimated

"Estimated" is not one situation, it is four, and only two of them are anybody's to fix. Rather
than leaving you to work out which from a missing marker, the canvasser tables label the cause
next to that person's doors-per-hour:

| Marker | What it means | What to do |
|---|---|---|
| **FbTime** | Every day in range came from their clock time. | Nothing. |
| **Part** | Some days measured, the rest estimated. | Nothing, unless the split surprises you — hover for the reason. |
| **No link** | FbTime is connected, but this person is not mapped to an FbTime profile, so **none** of their clocked hours count. | Link them on the Integrations page. |
| **Open shift** | A shift was left open from an earlier day (a missed clock-out), so it was ignored rather than counted as a 30-hour day. | Close it in FbTime; the range re-measures itself on the next sync. |
| **Est** | They're linked and everything is healthy — they just have no clocked hours in this range. | Usually nothing; this is a day off. |

An organization that has not connected FbTime sees **no marker at all** on any row, exactly as
before the integration existed. Hovering any marker explains it in full.

**The two are never mixed into one team or campaign rate.** A team rate shows measured numbers only
when *every* contributor is fully measured; otherwise it stays estimated for everyone. A rate that
quietly blended both could not be defended to a client — or reconciled against payroll.

### Which hours count

FbTime tracks three versions of a shift's hours. Doorline uses **Adjusted hours** by default —
total time minus break overage, the same "Adjusted total" your FbTime timesheets show and the
number you run payroll on, so the leaderboard and a paycheck can never disagree. An admin can
switch to Worked hours (all breaks out) or Total hours (breaks in) on the Integrations page, but
Adjusted is the recommended setting and Total is not recommended as a rate denominator.

### Connecting (org admins)

1. In **FbTime**, an admin of your organization creates an API key (Integrations → New key) named
   for its purpose. The key is shown once.
2. In **Doorline → Integrations**, paste the key and press **Test connection**. Doorline shows you
   which FbTime organization the key reads — **confirm the name is yours** (this is the guard
   against pasting another customer's key).
3. Press **Connect**. Doorline stores the key encrypted, matches canvassers to FbTime people by
   email, and pulls the last 120 days of hours within a couple of minutes.

Canvassers whose email differs between the two apps are linked by hand on the same page. A person
with clocked hours but no link shows a **"has hours"** badge — their hours count nowhere until
linked.

### Checking one person without leaving what you're doing

The Integrations page is the only place links are *edited*, and it is admin-only. But whether a
particular canvasser's hours are measured shows up in two other places, so you rarely have to go
looking:

- **Their profile** — open anyone from Users (or a campaign's Team page) and the Activity section
  says **"FbTime linked"** or **"FbTime not linked"**, with a shortcut to go fix it. **Team leads
  see this too**, since they cannot open the Integrations page at all; theirs reads "ask an org
  admin to link them" instead of offering the shortcut.
- **The canvasser tables** on Campaign Home and Timeline — the marker beside doors-per-hour, above.

### Trust notes

- A shift still open right now counts "so far" and keeps moving until clock-out.
- A shift someone forgot to close (open since an earlier day) is **ignored** for that day's rate —
  a 30-hour ghost shift must not flatten someone's pace — and the day falls back to the estimate.
  **Only that day is affected.** The same person's other days, including one they are on the clock
  for right now, still measure normally — so one forgotten clock-out costs you a single day, not
  that canvasser's whole week.
- Hours an admin typed into FbTime by hand count, and the report notes the range includes manual
  entries — hover the marker beside doors-per-hour on the canvasser tables, or read the sub-line
  under **Hours on doors** on a canvasser's detail screen in the mobile app.
- **Someone can work several shifts in one day, and that is handled** — a 9–12 and a 2–6 read as
  one day of 7 hours, added together the same way FbTime's own timesheet adds them.
- **Campaigns in different timezones all measure.** Hours follow each campaign's own calendar
  automatically — an organization running an Eastern campaign and a Central one sees measured
  hours on both, each bucketed into its own local days.
- A day that carries a shift someone is **still clocked into** is marked as such, because that
  day's number keeps moving until they clock out.
- A day someone was clocked in but knocked no doors still counts its hours — that is exactly the
  time the estimate could never see.
- **Hours follow the knocks.** A canvasser who splits time across campaigns is only charged, on
  each campaign's screens, for the days they actually worked it: a day they knocked a *different*
  campaign counts there instead, and clocked days before their first knock (or after their last)
  on this campaign never count here. A clocked day with no doors *anywhere* still counts toward
  the campaign they were working at the time — that is the idle day the previous note is about.

### Disconnecting

Disconnect on the Integrations page. Reports revert to estimated hours immediately, the stored key
is destroyed, and the pulled hours are deleted. Your canvasser links and the connection history are
kept, so reconnecting later finds the roster already mapped.

---

## Part 2 — Technical reference

### The moving parts

| Piece | Where |
|---|---|
| Sealed key storage (AES-256-GCM, env master key) | [`server/src/utils/sealedSecret.js`](../server/src/utils/sealedSecret.js) |
| Connection / links / shift cache / audit models | [`FbTimeConnection`](../server/src/models/FbTimeConnection.js) · [`FbTimePersonLink`](../server/src/models/FbTimePersonLink.js) · [`FbTimeShift`](../server/src/models/FbTimeShift.js) · [`IntegrationEvent`](../server/src/models/IntegrationEvent.js) |
| HTTP client + test seam (`fbt_test_` → in-process fake) | [`server/src/services/fbtime/client.js`](../server/src/services/fbtime/client.js) |
| Sync jobs (replace-range re-pulls) | [`server/src/services/fbtime/sync.js`](../server/src/services/fbtime/sync.js), registered in [`services/retention/scheduler.js`](../server/src/services/retention/scheduler.js) |
| The hours resolver (merge + labels) | [`server/src/services/reports/hoursSource.js`](../server/src/services/reports/hoursSource.js) |
| Admin routes | [`server/src/routes/admin/integrations.js`](../server/src/routes/admin/integrations.js) (`/admin/integrations/fbtime…`) |
| Web UI | [`client/src/pages/IntegrationsPage.jsx`](../client/src/pages/IntegrationsPage.jsx) (`/integrations`, orgAdmin RoleGate) |
| Per-row provenance marker | [`client/src/components/CanvasserSummaryTable.jsx`](../client/src/components/CanvasserSummaryTable.jsx) `HOURS_MARK` — the five states, their words and their tooltips, in one table |
| Per-person link state | [`client/src/components/UserProfileModal.jsx`](../client/src/components/UserProfileModal.jsx) Activity section, off `stats.fbtime` |
| Mobile | read-only status row on admin **More**; badges on every hours surface |
| Tests | `test/fbtimeClient.test.js`, `test/hoursSourceFold.test.js`, `test/fbtimeSync.int.test.js`, `test/fbtimeIntegration.int.test.js`, `test/reportsHoursSource.int.test.js` |

### Configuration

- **`CREDENTIAL_SEAL_KEY`** — 32 bytes base64, on web AND worker dynos. Absent = the integration is
  dormant (connect answers 503 `SEALING_UNCONFIGURED`, sync no-ops) — the mailer's dormant-switch
  posture, so the code ships before the config exists.
- `FBTIME_API_BASE` (defaults to the production URL from the provider contract),
  `FBTIME_TIMEOUT_MS`, `FBTIME_RECENT_CRON` / `FBTIME_DEEP_CRON`,
  `FBTIME_RECENT_WINDOW_DAYS` (7) / `FBTIME_DEEP_WINDOW_DAYS` (120).
- Run `npm run migrate:build-indexes -- --apply` after a deploy that adds indexes (prod runs
  `autoIndex: false`); the worker also `syncIndexes()`es the shift cache at boot.
- **Cutover from the day-total cache (2026-08):** `npm run migrate:fbtime-shifts -- --apply`
  deep-resyncs every connected org into the shift cache immediately (instead of waiting for the
  nightly deep job); a later `-- --apply --drop-legacy` drops the retired `fbtimedailyhours`
  collection once the numbers are confirmed. Dashboard Run console, repo root — both proxied.

### The sync model — and the provider traps it honors

Two maintenance jobs re-pull **date ranges of shifts** (`GET /shifts`) and make the cache equal
the response over that range (upsert by the provider's shift id, delete what it no longer has):

- `fbtime-hours-recent` — every 15 min (off the quarter-hour), trailing 7 days, `connected` orgs.
- `fbtime-hours-deep` — nightly 06:29, trailing 120 days; also re-pings `errored` connections and
  self-heals (`sync-recovered`).
- `fbtime-hours-org` — one-off at connect, so a fresh connection has a season of hours in seconds.

The traps, from the provider's contract, all deliberate here:

1. **Never an `updatedSince` cursor for shifts.** FbTime hard-deletes time entries; a deleted row
   is never "updated". Replace-range propagates deletions for free. The delete scan uses the SAME
   UTC bounds the provider derives from `[startDate, endDate]` in the pull zone (its inclusive
   `23:59:59.999` end and our exclusive next-midnight are the same set at integer-millisecond
   resolution), so "inside the window" can never disagree between the two systems.
2. **No reconciliation machinery.** Every poll re-reads from scratch; live surfaces are
   self-healing by construction. One bounded exception: `/shifts` paginates on `clockIn` — a
   mutable sort key — so `getShifts` re-pulls ONCE if `pagination.total` moves between pages of a
   single pull (a mid-pull edit shuffled the pages); a second drift is accepted and the next
   15-minute tick heals it.
3. **Absence ≠ zero.** A person missing from `/shifts` (or a day with no shifts) falls back to
   the span estimate, labeled — never a 0 that would read as an infinite rate.
4. **The timezone parameter only shapes the pull window.** Shifts are cached as INSTANTS and
   bucketed into local days at read time, in each report's own anchor zone — so one pull serves
   every campaign the org runs, whatever zone each anchors to. (The previous day-total cache was
   stamped with the org's zone, and any campaign anchored elsewhere silently read zero measured
   rows — the failure the shift cache exists to make unrepresentable.)

Fatal provider codes (`KEY_REVOKED`, `KEY_EXPIRED`, `KEY_INVALID`, `ORG_INACTIVE`) mark the
connection `errored` with exactly **one** `sync-failed` event per transition; transient errors
mark-and-continue and never change status.

### The merge rules (`services/reports/hoursSource.js`)

- **The day is built HERE, in the report's own anchor timezone.** The cache holds shifts
  (instants); each belongs entirely to the local day its `clockIn` falls on in the request's
  anchor tz — the provider's own bucketing rule (`localDateOf`), applied to the same instants in
  the report's zone instead of one stamped at sync time. Hours-days and knock-days therefore
  share a bucketing **by construction**: the same request resolves one anchor tz and feeds it to
  both. Day totals sum the per-shift figures **already-rounded** (each arrives 2dp per the
  contract), which is literally how the provider's own `/hours` computes its totals — so a day
  here equals the timesheet, always.
- Multi-shift days are summed here (a 9–12 and a 2–6 make one 7-hour day). A day is still usable
  or not *as a whole*: one runaway open shift spoils its day even beside a clean one — falling
  back to the span entirely rather than salvaging the half is conservative and honest, and it is
  the same whole-day rule the day-total cache had.
- Per **user-day**: the measured hours win when present AND usable — `hours > 0` and not stale
  (a forgotten clock-out falls back to the span and keeps its flag). `isOpen` days count ("so
  far"); `isManualEntry` days count, flag rolled up.
- **Staleness is derived, exactly, per request** — a day is stale when it holds an open shift AND
  lies strictly before today-in-anchor-tz ("stale" *means* open since an earlier day, so today's
  open shift is just open). Never cached: a "today" baked into a row is wrong from the next
  midnight and frozen wrong for any org whose sync is erroring, which is why sync deliberately
  ignores the provider's per-shift `isStale` field. With shift-level data the old broad-write /
  read-narrow dance is gone — only the forgotten clock-out's own day falls back (and still
  raises `hasStaleShift`); the same person's other days, today included, measure normally.
  `staleDay()` survives as a guard for hand-built overlays: a stale flag with no calendar keeps
  the conservative broad reading.
- A user's day set is the **union** of knock-days and measured days — clocked-but-not-knocking
  lowers the rate. `daysActive` keeps its knock-day meaning.
- **CAMPAIGN-SCOPED ATTRIBUTION, by the knock ledger** (owner-ruled 2026-08-16 — **never** by
  FbTime location, an honor-system dropdown; knocks carry GPS, a timestamp, and a campaign id
  recorded at the moment of work). On a campaign-scoped report, a clocked day with **no knocks on
  that campaign** joins the union only when it sits inside the canvasser's all-time knock stint
  there (first knock-day … last knock-day) AND the org-wide ledger shows no knocks on any other
  campaign that day. Knocked elsewhere = the hours visibly belong there; clocked and knocked
  nowhere = the idle day, still charged. One owner: `unionDayAllowed()` — the fold and any
  union-day surface ask it, never re-derive. Org-wide reports are untouched: every clocked day
  counts, as always. The case that forced it: a canvasser's spring hours on another project sat
  inside a fall campaign's all-time denominator, reading 9.2 doors/hr against a true ~19. Honest
  limits, both accepted: a day knocked on two campaigns charges its full hours to both rates, and
  an idle day inside two overlapping stints does the same — the day is the atom.
- Per-canvasser rows: `hoursSource` = `measured` | `estimated` | `mixed` (mixed exists ONLY at this
  labeled per-person grain).
- **Aggregates are all-or-nothing**: a campaign/team figure is measured only when every
  contributing user is fully measured; otherwise it is the span figure for everyone, labeled
  estimated. `mixed` never appears at aggregate level.
- **`hoursReason` names WHICH estimated** — `null` when the row is fully measured, otherwise
  `not-connected` | `not-linked` | `stale-shift` | `no-hours`, in that precedence. Precedence is
  "who can act on it", outermost first: an unconnected org has nothing to fix, an unlinked person
  is an admin's two-click fix, a stale shift is somebody's forgotten clock-out, and `no-hours` is
  the residue that is usually a day off. `loadMeasuredHours` carries the org's `linkedUserIds`
  alongside the hours for exactly this — the two answer one question between them, and a caller
  that had to load links separately is the caller that forgets to. A fold whose overlay has **no**
  `linkedUserIds` (a pre-existing fixture) yields `no-hours`, never `not-linked`: never accuse a
  mapping of being missing without having looked at the mapping.

### Endpoint additions (all additive — no client-version bump)

| Endpoint | Added |
|---|---|
| `/admin/reports/canvassers` | rows' `hoursOnDoors`/`doorsPerHour` become **merged** values + `hoursSource`, `hoursReason`, `hoursFlags` |
| `/admin/reports/canvasser-timeline` | rows **keep the derived** `hoursOnDoors` (shipped builds sum it into the KPI — replacing it would make them blend) + additive `measuredHoursOnDoors`, `hoursSource`, `hoursReason`, `hoursFlags`; top-level `measuredKpi {hoursOnDoors, hoursSource}` (all-or-nothing; null when not all-measured) |
| `/admin/memberships/:userId/stats` | `fbtime {connected, linked, personName, source}` — **link state only, never this person's hours**. Admin **or lead** (the route's existing `leadMaySeeTarget` gate), which is the only FbTime fact a lead can see anywhere |
| `/admin/reports/team-averages` | all-or-nothing applied server-side + top-level `hoursSource` |
| `/admin/reports/canvassers/:id/summary` | merged `kpi.hoursOnDoors` + `kpi.hoursSource`/`hoursFlags`; `lastSevenDays[].hoursSource` |
| `/admin/reports/canvassers/:id/daily` | per-day merge; each day exactly `measured` or `estimated` |
| `/admin/reports/canvassers.csv` | preamble stamp rows (`Canvasser export, <range>, hours as of <ISO>` + blank) and a trailing `Hours source` column — see [EXPORTS.md](EXPORTS.md) for the standing rule |

Clients: the web/mobile Timeline KPI applies the all-or-nothing rule over the rows **in view**
(the crew filter changes who is included), summing server-computed per-row fields — composing,
never re-deriving. The canvasser's own pace lane (`mobile/lib/rates.js` `formatPace` off
`firstDoorAt`/`lastDoorAt`) is deliberately untouched: it is a within-day span, and a live
"measured pace" would need mid-shift freshness the 15-minute poll cannot honestly claim.

### Identity mapping

`FbTimePersonLink`, one-to-one per org in both directions (DB-unique). Auto-match by lowercase
email is an explicit, audited **action** (at connect + a button) — never a background sweep, so an
admin's unlink is never silently undone. Link/unlink backfills `FbTimeShift.userId`
immediately. Links **survive disconnect**; the shift cache does not.

### Privacy

The org's own admin connects it — that act is the consent. What Doorline stores: the sealed key,
FbTime person ids/names/emails for the mapping, and per-person **shift-level hours records** —
each shift's start instant, its three hour figures, and its open/manual flags. Deliberately NOT
stored, by data minimization: clock-outs (`isOpen` carries the only fact reports need), the
breaks array, and every break-minutes figure — and never GPS, never pay rates (the provider
doesn't offer them and the client never asks). The start instant is held because it is what a
shift's local day is derived from; it is the one granularity increase over the retired day-total
cache, stamped in PRIVACY_VERIFICATION.md (v5 entry). All four collections are org-scoped and in
the org-delete sweep.

**Who sees what.** Everything that *configures* the integration — the key, the hours figure, the
mapping table, the event history — is admin-only, and leads deliberately cannot reach any of it.
The one thing a lead can see is **whether a canvasser they already manage is linked**, on that
person's profile modal, because a lead reading a doors-per-hour they cannot explain is the whole
problem this feature exists to solve. That is a boolean about a person already in their scope
(the route's existing `leadMaySeeTarget` gate), never hours, never the key, never the roster of
other people's links, and it adds no new data category and no new recipient.
See PRIVACY_VERIFICATION.md (v5 entry) and the DPA §6 subprocessor listing.
