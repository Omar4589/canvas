# Dashboard date filters

The date-range control that sits at the top of the admin dashboards (and the admin map). It
decides **which time window** the numbers below it describe — "today's knocks" vs. "everything
we've ever done."

- **Part 1 — For everyone** is plain language: the presets, what each page defaults to, and the
  one place the filter behaves differently (the map).
- **Part 2 — Technical reference** is for developers (and Claude): the shared component, the exact
  boundary math, how the range reaches the backend, and timezone handling.

Related: [METRICS.md](METRICS.md) (what each filtered number *means*, and which metrics honor the
range vs. stay all-time), [MAPS.md](MAPS.md) (the admin map, where the filter narrows the pins),
[EFFORTS.md](EFFORTS.md) (reports can also be scoped to one effort via `effortId`, independent of
the date range).

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

All windows are measured in **your local day** — "Today" means your today, wherever you are.

## What each page opens on

| Page | Opens on | Why |
|---|---|---|
| **Overview** (org-wide) | **Today** | Admins want "what happened today" at a glance. |
| **Campaign dashboard** | **Today** | Same — recent activity first; switch to a wider window when you want the campaign-to-date picture. |
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

One component drives all three web dashboards:
[client/src/components/DateRangeSelector.jsx](../client/src/components/DateRangeSelector.jsx). It is
the web mirror of mobile's [mobile/lib/dateRanges.js](../mobile/lib/dateRanges.js) +
[DateRangeBar.jsx](../mobile/components/DateRangeBar.jsx) — same presets, same boundary math, so the
two surfaces never disagree.

Exports:

| Export | What it does |
|---|---|
| `RANGE_PRESETS` | The ordered preset list `{ id, label }` (`today`, `yesterday`, `7d`, `30d`, `all`, `custom`). |
| `rangeFor(preset, custom)` | Resolves a preset id to `{ from, to }` ISO strings (or `null` bounds). For `custom`, passes the supplied `{ from, to }` through. |
| `defaultRange(preset)` | `{ preset, ...rangeFor(preset) }` — used to initialize page state in one line. |
| `labelForRange({preset,from,to})` | Human label; for `custom` formats the dates (same-day / range / "Since" / "Until"). |
| `quickRangeFor(key)` | The custom-picker quick chips: `thisWeek`/`lastWeek` (Monday-start), `thisMonth`/`lastMonth`. |
| *(default)* `DateRangeSelector` | The controlled button bar. |

The custom picker is [client/src/components/DateRangePickerModal.jsx](../client/src/components/DateRangePickerModal.jsx)
— native `<input type="date">` for From/To, the quick chips, swap-if-reversed, and open-ended
support. It reuses the modal idiom (backdrop + Escape-to-close) from
[CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx).

## B. Boundary math

`from` is **inclusive**, `to` is **exclusive** (next-day start), and every boundary is **local
start-of-day**:

```js
today      → { from: startOfToday,            to: null }          // open to "now"
yesterday  → { from: startOfYesterday,        to: startOfToday }
7d         → { from: startOfToday − 6 days,   to: null }          // today + 6 prior calendar days
30d        → { from: startOfToday − 29 days,  to: null }
all        → { from: null,                    to: null }
custom     → { from: custom.from || null,     to: custom.to || null }
```

`startOfDay` is `new Date(d); x.setHours(0,0,0,0)` — local midnight. The web and mobile helpers are
byte-for-byte equivalent here (the web `7d`/`30d` were aligned to mobile's calendar-day math during
this change).

> **Boundary edge case:** the helpers treat `to` as exclusive, but the backend compares with `$lte`
> (inclusive — see §D). A record stamped at *exactly* the millisecond of midnight would match both
> the day before and the day after. Negligible in practice; noted for completeness.

## C. State shape & wiring

Each page holds the resolved range object directly — no `useMemo`/derive step:

```js
const [dateRange, setDateRange] = useState(() => defaultRange('today')); // 'all' on the map
// ...
<DateRangeSelector value={dateRange} onChange={setDateRange} />
```

`dateRange` is `{ preset, from, to }`. The `.from` / `.to` keys flow straight into each query's
`buildQuery({ from, to })` **and** its react-query `queryKey`, so changing the window (preset or
custom) re-fetches automatically — no manual invalidation. Child components
([QuestionResults.jsx](../client/src/components/QuestionResults.jsx), the `VoterList` inside it,
[CanvasserResponsesModal.jsx](../client/src/components/CanvasserResponsesModal.jsx)) receive the same
`{from,to}`-shaped object as a prop.

## D. How the range reaches the backend

The frontend sends absolute ISO instants as `from` / `to` query params. Two parsers consume them:

| Endpoint family | Parser | Applied to |
|---|---|---|
| `/admin/reports/*` | `parseDateRange(req, field)` ([reports.js](../server/src/routes/admin/reports.js)) | `$gte`/`$lte` on the field — `timestamp` for knocks/activity, `submittedAt` for surveys. Different metrics range on different fields; see [METRICS.md](METRICS.md) §F. |
| `/admin/households/map` | local `parseDate` ([households.js](../server/src/routes/admin/households.js)) | `$gte`/`$lte` on `CanvassActivity.timestamp` **and** `SurveyResponse.submittedAt`. |

**Map interacted-only behavior.** In [households.js](../server/src/routes/admin/households.js), when
any of `from` / `to` / `userId` / (`questionKey`+`option`) is set, `filteringInteractions` is true:
the route first collects the household ids that had a matching survey or activity in the window
(`interactedHouseholdIds`) and restricts the map to those. With no filters (All time), it returns
the whole active-household universe. This is the mechanism behind the Part 1 "map exception" — and
why the map defaults to `all`.

## E. Timezone

Boundaries are computed from the **admin's local browser time** (local start-of-day) and serialized
to absolute UTC instants, which the backend compares directly with `$gte`/`$lte`. So the range
reflects the admin's local day with no server-side timezone needed for the *filter itself*.

The separate `tz` query param (IANA name) is **not** used for range filtering — it only drives
per-day *bucketing* in the per-canvasser endpoints (`dayBucketExpr` / daily / summary in
[reports.js](../server/src/routes/admin/reports.js)).

In the custom picker, native `<input type="date">` yields a `yyyy-mm-dd` string. Conversion to/from
ISO uses **local** dates (`new Date(y, m-1, d)`, and local getters when formatting back) — never
`toISOString().slice(0,10)`, which is UTC and can shift a day in negative-offset timezones.

## F. Frontend mapping

### Web ([client/src](../client/src))
| File | Role |
|---|---|
| [components/DateRangeSelector.jsx](../client/src/components/DateRangeSelector.jsx) | Presets + helpers + the controlled button bar. |
| [components/DateRangePickerModal.jsx](../client/src/components/DateRangePickerModal.jsx) | Custom From/To picker + quick chips. |
| [pages/OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) | Default **Today**; range → `/campaign-rollup?scope=active`. |
| [pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Default **Today**; range → `/campaign-rollup`, `/canvassers`, `/survey-results`. Coverage stays all-time from `/overview`. |
| [pages/MapPage.jsx](../client/src/pages/MapPage.jsx) | Default **All time**; range → `/admin/households/map` (narrows pins, see §D). |

### Mobile ([mobile](../mobile))
| File | Role |
|---|---|
| [lib/dateRanges.js](../mobile/lib/dateRanges.js) | The canonical presets + helpers the web mirrors (`PRESETS`, `rangeFor`, `labelForRange`, `quickRangeFor`, `deviceTimezone`). |
| [components/DateRangeBar.jsx](../mobile/components/DateRangeBar.jsx) | The scrollable preset bar (admin overview, campaign detail, leaderboard, canvasser drilldowns). |
| [components/DateRangePickerModal.jsx](../mobile/components/DateRangePickerModal.jsx) | Native custom picker + quick chips. |

Admin mobile screens mostly default to **Today** (canvasser drilldowns open wider — `7d`/`30d`).
The personal canvasser stats screen and the super-admin control room intentionally have **no** date
filter (all-time / fixed live windows).
