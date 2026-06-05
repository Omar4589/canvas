# Dashboard date filters

The date-range control that sits at the top of the admin dashboards (and the admin map). It
decides **which time window** the numbers below it describe — "today's knocks" vs. "everything
we've ever done."

- **Part 1 — For everyone** is plain language: the presets, what each page defaults to, and the
  one place the filter behaves differently (the map).
- **Part 2 — Technical reference** is for developers (and Claude): the shared component, the exact
  boundary math, how the range reaches the backend, and timezone handling.

Related: [TIMEZONES.md](TIMEZONES.md) (what "a day" *is* — every window here resolves in the
campaign's timezone), [METRICS.md](METRICS.md) (what each filtered number *means*, and which metrics
honor the range vs. stay all-time), [MAPS.md](MAPS.md) (the admin map, where the filter narrows the
pins), [EFFORTS.md](EFFORTS.md) (reports can also be scoped to one effort via `effortId`, independent
of the date range).

---

# Part 1 — For everyone

## What it is

A row of buttons — **Today · Yesterday · 7 days · 30 days · All time · Custom** — that scopes the
dashboard to a time window. Pick one and the knocks, surveys, connection rate, and canvasser
activity below recompute for that window. (Coverage — the colored bar — is always all-time and
ignores the filter; see [METRICS.md](METRICS.md).)

Web and mobile show the **same** presets and compute the **same** boundaries, so a window means
the same thing on a phone in the field and on the admin laptop.

## The presets

| Preset | Window |
|---|---|
| **Today** | From midnight this morning to now. |
| **Yesterday** | The whole of the previous calendar day. |
| **7 days** | Today plus the 6 days before it (7 calendar days). |
| **30 days** | Today plus the 29 days before it (30 calendar days). |
| **All time** | No limits — everything on record. |
| **Custom** | Pick your own start and/or end date. |

All windows are measured in **the campaign's day** — "Today" means the campaign's today (Central for a
Texas campaign, Eastern for a Florida one), identical for every admin wherever they are. The org-wide
**Overview** uses the org's timezone. See [TIMEZONES.md](TIMEZONES.md).

## What each page opens on

| Page | Opens on | Why |
|---|---|---|
| **Overview** (org-wide) | **Today** | Admins want "what happened today" at a glance. |
| **Campaign dashboard** | **Today** (active) / **All time** (archived) | Active campaigns lead with recent activity; an **archived** campaign has none today, so it opens on All time to show its full history (until you pick a window). |
| **Admin map** | **All time** | A date range on the map *hides* every door you didn't touch in that window (see below), so it opens showing the full turf. |

You can always change the window; the page just picks a sensible starting point.

## Custom ranges

Click **Custom** to open a small picker:

- Set a **From** date, a **To** date, or both. Leave either blank for an **open-ended** range
  ("since March 1", "up to April 15").
- Quick chips — **This week · Last week · This month · Last month** — fill both ends in one tap.
- If you pick a From that's after the To, it quietly swaps them.

The chosen range shows as a small label under the buttons (e.g. *Mar 1 – Mar 15*).

## The one exception: the map

On every dashboard, the filter changes the **numbers**. On the **admin map**, a date range also
changes **which pins appear**: turning on any window (or filtering by canvasser / by survey
answer) drops the map to **only the houses that were interacted with in that window** — knocked,
surveyed, or noted. That's deliberate ("show me just what we touched yesterday"), but it's why the
map starts on **All time** — otherwise it would open looking nearly empty. Switch back to All time
to see the whole universe of doors again. (Details in [MAPS.md](MAPS.md).)

---

# Part 2 — Technical reference

## A. The shared control

The pure preset logic lives in [client/src/lib/datePresets.js](../client/src/lib/datePresets.js)
(re-exported by [DateRangeSelector.jsx](../client/src/components/DateRangeSelector.jsx), which is the
controlled button bar). It is the web mirror of mobile's
[mobile/lib/dateRanges.js](../mobile/lib/dateRanges.js) + [DateRangeBar.jsx](../mobile/components/DateRangeBar.jsx)
— byte-for-byte the same builders, verified by a cross-timezone parity test, so the two surfaces never
disagree.

Exports (all take the anchor `tz`):

| Export | What it does |
|---|---|
| `RANGE_PRESETS` | The ordered preset list `{ id, label }` (`today`, `yesterday`, `7d`, `30d`, `all`, `custom`). |
| `rangeFor(preset, custom, tz)` | Resolves a preset id to **date-only** `{ from, to }` days (or `null` bounds) computed in `tz`. For `custom`, passes the supplied `{ from, to }` through. |
| `defaultRange(preset, tz)` | `{ preset, ...rangeFor(preset, undefined, tz) }` — initialize page state in one line. |
| `labelForRange({preset,from,to})` | Human label; for `custom` formats the dates (parses date-only as local). |
| `quickRangeFor(key, tz)` | The custom-picker quick chips: `thisWeek`/`lastWeek` (Monday-start), `thisMonth`/`lastMonth`, in `tz`. |
| `todayInTz(tz)` / `shiftDays(ymd, n)` | The tz-aware "today" + UTC calendar math the builders use. |
| *(default)* `DateRangeSelector` | The controlled button bar (takes a `tz` prop). |

The custom picker is [client/src/components/DateRangePickerModal.jsx](../client/src/components/DateRangePickerModal.jsx)
— native `<input type="date">` for From/To, the quick chips, swap-if-reversed, and open-ended
support. It reuses the modal idiom (backdrop + Escape-to-close) from
[CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx).

## B. Boundary math

The control emits **date-only** `YYYY-MM-DD` days, computed in the **anchor timezone** (the
campaign's, or the org's org-wide) — never the device clock. Both ends are **inclusive days**:

```js
today      → { from: todayInTz(tz),            to: null }          // open to "now"
yesterday  → { from: yesterday,                to: yesterday }     // a single whole day
7d         → { from: todayInTz(tz) − 6 days,   to: null }          // today + 6 prior days
30d        → { from: todayInTz(tz) − 29 days,  to: null }
all        → { from: null,                     to: null }
custom     → { from: pickedFrom || null,       to: pickedTo || null }
```

`todayInTz(tz)` is `Intl … en-CA` (the current date *in `tz`*); day arithmetic uses UTC math on the
`YYYY-MM-DD` string so it never drifts with the device timezone or DST. The server turns these days
into a UTC window in the anchor tz where `to` covers the **whole** day — `zonedDayRange` (see
[TIMEZONES.md](TIMEZONES.md) §B). A single day is a full 24-hour window — this is what fixed
"Yesterday" returning two days. The web ([datePresets.js](../client/src/lib/datePresets.js)) and mobile
([dateRanges.js](../mobile/lib/dateRanges.js)) builders are identical, verified by a cross-timezone test.

## C. State shape, the tz, & the gate

Each page resolves an **anchor tz** and initializes its range only once that tz is known, so a preset
never resolves in the device clock:

```js
const tz = current?.timeZone || orgTz;              // campaign tz, else org (useOrgTimeZone)
const [dateRange, setDateRange] = useState(null);   // null until the tz is known
useEffect(() => {
  if (rangeTouchedRef.current || !tzReady) return;  // tzReady = campaigns list loaded
  setDateRange(defaultRange(current?.isActive === false ? 'all' : 'today', tz));
}, [tzReady, tz, current]);
<DateRangeSelector value={dateRange} onChange={onRangeChange} tz={tz} />
```

`dateRange` is `{ preset, from, to }` with **date-only** `from`/`to`. Range-scoped queries are
**gated** on `!!dateRange` (and read it null-safely), so they never fetch a device-tz window before
the campaign tz loads. The keys flow into each query's `buildQuery` **and** its react-query
`queryKey`, so changing the window re-fetches automatically. `DateRangeSelector` / `DateRangeBar` and
the custom pickers take a `tz` prop; child display components
([QuestionResults.jsx](../client/src/components/QuestionResults.jsx),
[CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx)) also receive `tz`
for rendering ([TIMEZONES.md](TIMEZONES.md) §F). Mobile mirrors this per screen —
`campaign/[campaignId]` uses its route campaign's tz, other admin screens the active campaign's.

## D. How the range reaches the backend

The frontend sends **date-only** `from` / `to` query params. Both parsers turn them into a UTC window
**in the anchor timezone** (campaign, or org for org-wide):

| Endpoint family | Parser | Applied to |
|---|---|---|
| `/admin/reports/*` | `parseDateRange(req, field)` → `zonedDayRange` in `req.anchorTz` ([reports.js](../server/src/routes/admin/reports.js)) | half-open `$gte`/`$lt` on the field — `timestamp` for knocks/activity, `submittedAt` for surveys. Different metrics range on different fields; see [METRICS.md](METRICS.md) §F. |
| `/admin/households/map` | `resolveMapTz` + `zonedDayRange` ([households.js](../server/src/routes/admin/households.js)) | `$gte`/`$lt` on `CanvassActivity.timestamp` **and** `SurveyResponse.submittedAt`. |

Both resolve the anchor tz the same way (campaign tz when `campaignId` is present, else the org's), so
the map narrows to the **same campaign-day window** as the dashboards. The mechanism — `req.anchorTz`
and `zonedDayRange` — is in [TIMEZONES.md](TIMEZONES.md) §A–B.

**Map interacted-only behavior.** In [households.js](../server/src/routes/admin/households.js), when
any of `from` / `to` / `userId` / (`questionKey`+`option`) is set, `filteringInteractions` is true:
the route first collects the household ids that had a matching survey or activity in the window
(`interactedHouseholdIds`) and restricts the map to those. With no filters (All time), it returns
the whole active-household universe. This is the mechanism behind the Part 1 "map exception" — and
why the map defaults to `all`.

## E. Timezone

The filter is anchored to the **campaign's timezone** (the org's for org-wide views), **not** the
admin's device — so "Today" is the same campaign day for everyone, and a Tokyo-based admin asking for
"Yesterday" on a Texas campaign gets *Texas's* yesterday. The full model — anchor resolution, the
date-only contract, the day-window math, DST, and display labels — lives in [TIMEZONES.md](TIMEZONES.md).

The legacy `tz=deviceTimezone()` query param some mobile screens still send is **dead**: the server
ignores it and uses `req.anchorTz`. The custom pickers emit the picked **calendar dates** as date-only
`yyyy-mm-dd` (never `toISOString`, which is UTC and shifts a day in negative-offset zones). Per-day
*bucketing* (per-canvasser daily/summary, the user stats chart) also uses the anchor tz — see
[TIMEZONES.md](TIMEZONES.md) §C.

## F. Frontend mapping

### Web ([client/src](../client/src))
| File | Role |
|---|---|
| [lib/datePresets.js](../client/src/lib/datePresets.js) | The pure, tz-aware preset builders (`rangeFor`, `quickRangeFor`, `defaultRange`, `todayInTz`, …). |
| [components/DateRangeSelector.jsx](../client/src/components/DateRangeSelector.jsx) | The controlled button bar (takes a `tz` prop); re-exports the builders. |
| [components/DateRangePickerModal.jsx](../client/src/components/DateRangePickerModal.jsx) | Custom From/To picker + quick chips (date-only; takes `tz`). |
| [pages/OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) | Default **Today** in the **org** tz; range → `/campaign-rollup?scope=active`. |
| [pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Default **Today** in the **campaign** tz; range → `/campaign-rollup`, `/canvassers`, `/survey-results` (gated on the tz — §C). Coverage stays all-time from `/overview`. An untouched **archived** campaign defaults to All time. |
| [pages/MapPage.jsx](../client/src/pages/MapPage.jsx) | Default **All time**; campaign tz from `useCampaignSelection().selected`; range → `/admin/households/map` (narrows pins, see §D). |

### Mobile ([mobile](../mobile))
| File | Role |
|---|---|
| [lib/dateRanges.js](../mobile/lib/dateRanges.js) | The tz-aware preset builders the web mirrors (`PRESETS`, `rangeFor`, `quickRangeFor`, `labelForRange`, `todayInTz`, `shiftDays`; `deviceTimezone` is now legacy). |
| [components/DateRangeBar.jsx](../mobile/components/DateRangeBar.jsx) | The scrollable preset bar (admin overview, campaign detail, leaderboard, canvasser drilldowns); takes a `tz` prop. |
| [components/DateRangePickerModal.jsx](../mobile/components/DateRangePickerModal.jsx) | Native custom picker + quick chips (date-only; takes `tz`). |

Each admin screen feeds its campaign's `timeZone` to the bar/builders and keeps its range null until
that tz loads, gating its query (the active campaign carries `timeZone`; `campaign/[campaignId]` uses
its route campaign). Defaults are mostly **Today** (canvasser drilldowns open wider — `7d`/`30d`). The
personal canvasser stats screen and the super-admin control room intentionally have **no** date filter
(personal/all-time / fixed live windows).
