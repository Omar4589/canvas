# Canvassing metrics

This doc is the source of truth for every count on the admin **Overview** and **Campaign**
dashboards (web and mobile show the same set), and for the duplicate-knock ("overlap") warning.

- **Part 1 — For everyone** is plain language: what each number means and why.
- **Part 2 — Technical reference** is for developers (and Claude): exact field names, the
  aggregations that produce them, the endpoints that return them, and the components that render
  them.

The implementation lives in [`server/src/routes/admin/reports.js`](../server/src/routes/admin/reports.js).

Related: [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (a "pass"/round is the billing unit; coverage vs.
passes), [EFFORTS.md](EFFORTS.md) (reports can be scoped to one effort via `effortId`; "All efforts" =
the whole-campaign totals below), [SURVEYS.md](SURVEYS.md) (what "Surveys" / "Surveyed voters" count),
[DATE_FILTERS.md](DATE_FILTERS.md) (the date-range control that scopes these numbers — presets,
defaults, and boundary math).

---

# Part 1 — For everyone

## The one idea that ties it together: a "pass"

A **pass** is one planned sweep of a turf (Round 1, Round 2, …). The whole model hangs off
this: once a house has been knocked **in a pass**, nobody should knock it again until the
**next pass**. Going back in a new pass is deliberate, billable work (you're returning to the
not-homes / undecideds). Re-knocking the same house **within the same pass** is either a
correction or a mistake — never billable.

Two lenses sit on top of that, and they answer different questions:

- **Coverage** (the colored bar) — *how much of the universe have we touched?* One bucket per
  household, current standing, all-time.
- **Activity / Knocks** — *how much work did we do (and bill for)?* Counts knock events per
  house-pass, honors the date filter.

They can disagree (Knocks can exceed Houses once you do a second pass) — that's expected.

## Metric definitions

### Houses knocked
Distinct households that have been knocked at least once (status ≠ `unknocked`). This is
**current-state and all-time** — it doesn't move with the date filter. It answers "how much of
the turf is done." Field: `homesKnocked`.

### Knocks  *(this is the billable number)*
**One knock = one distinct (household, pass).** So:

- Same canvasser corrects/re-enters the same house **in the same pass** → **1 knock** (the app
  replaces the prior entry; nothing is double-counted).
- Two **different** canvassers hit the same house **in the same pass** → **1 knock** (that's an
  overlap — our operational mistake, not the client's line item; see below).
- The house is knocked again in a **new pass** (e.g. Round 2 revisiting a not-home) → **+1 knock**.

Knocks honor the date filter. We bill **per knock**, not per house. Field: `knocks`.

> Legacy / no-pass data: knocks recorded before turf/passes existed (`passId = null`) collapse
> to **one knock per house**. Use passes to get per-pass billing.

### Surveys
Total survey responses submitted — one per voter per pass. A **volume** number: a house with
3 voters all surveyed in one visit is **3 surveys but 1 knock**, so Surveys can exceed Knocks.
Field: `surveysSubmitted`.

### Surveyed voters
Distinct voters who have a survey — i.e. **how many people we actually reached** (not how many
forms we filed). Field: `surveyedVoters`.

### Connection rate
**Surveyed knocks ÷ Knocks × 100.** Of the knocks we made, how many landed a survey. A
"surveyed knock" is a (household, pass) that got at least one survey, so the numerator is always
a subset of Knocks → **the rate is always ≤ 100%.** (Lit-drop campaigns use lit knocks ÷ knocks
and label it "Lit rate"; the value is computed the same way.) Field: `connectionRate`.

### Coverage funnel (the colored bar)
Each household sits in exactly one bucket — `surveyed`, `lit_dropped`, `not_home`,
`wrong_address`, `voted`, or `unknocked` — so the bar sums to the total number of households.
`unknocked` = houses not yet knocked at all; `voted` = early-voting doors that dropped off the
canvasser's list (pulled out of `unknocked`, see early-voting doc). This is a coverage lens,
separate from Knocks (activity). Field: `canvass` / `coverage`.

## Coverage vs. Knocks — worked example

A 100-house turf. In Round 1 you knock all 100 (60 surveyed, 40 not-home). In Round 2 you go
back to the 40 not-homes and survey 10 of them.

| Metric | Value | Why |
|---|---|---|
| Houses knocked | 100 | every house has been knocked at least once |
| Knocks | 140 | 100 (Round 1) + 40 (Round 2 revisits) |
| Surveys | 70 | 60 + 10 |
| Connection rate | 50% | 70 surveyed knocks ÷ 140 knocks |
| Coverage | 70 surveyed / 30 not-home / 0 unknocked | current standing per house |

You bill for **140 knocks**, even though there are only 100 houses.

## Date range vs. all-time

- **Honors the date filter:** Knocks, Surveys, Surveyed voters, Connection rate, Active
  canvassers. (Knocks/lit range on the knock timestamp; surveys range on submission time.)
- **Always all-time / current-state:** Households, Houses knocked, and the coverage funnel.

On a campaign page, the **Activity** section is the selected range; the **Coverage** section is
all-time. This is why the two can look different — by design.

## The duplicate-knock ("overlap") warning

A house is flagged as an overlap **only when 2+ different canvassers knocked it within the same
pass.** Rationale: once a house is knocked in a pass, nobody should return until the next pass.

What does **not** trigger it:

- The **same** canvasser knocking a house twice — within a pass it self-heals to one record;
  across passes it's a legitimate revisit.
- **Different** canvassers across **different** passes — that's normal Round-2 coverage of
  not-homes / undecideds, not a collision.

The review screen lists one card per house, grouped by the pass (`Round N · name`) where the
collision happened, with the canvassers involved. Because a same-pass double-knock counts as
**1 knock**, overlaps are never billed — the warning is just there to help you spot and coach
the wasted effort.

## Per-canvasser numbers (leaderboard & drilldowns)

- A canvasser has **at most one knock record per (house, pass)**, so a single canvasser's
  **Knocks** is exactly their distinct house-passes.
- Their **Connection rate** = their surveyed knocks ÷ their knocks (≤ 100%).
- The org **Knocks** is **less than or equal to** the sum of every canvasser's knocks: when two
  canvassers overlap on the same house-pass, each gets personal credit for the knock they made,
  but the org counts that house-pass once (we don't bill the client for the overlap).

---

# Part 2 — Technical reference

## A. Data model & the core invariant

Knock events live in their own collection; the household carries only its latest aggregate
status. The reporting reads these fields:

| Model | File | Fields that matter for metrics |
|---|---|---|
| `CanvassActivity` | [models/CanvassActivity.js](../server/src/models/CanvassActivity.js) | `householdId`, `userId`, `actionType` (`not_home`/`wrong_address`/`survey_submitted`/`lit_dropped`/`note_added`), `passId` (nullable), `campaignId`, `organizationId`, `timestamp` |
| `Household` | [models/Household.js](../server/src/models/Household.js) | `status` (`unknocked`/`not_home`/`surveyed`/`wrong_address`/`lit_dropped`), `isActive`, `campaignId`, `lastActionAt`, `lastActionBy` |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `voterId`, `householdId`, `userId`, `passId`, `campaignId`, `submittedAt` (one per voter **per pass**) |
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `roundNumber` (ordered, unique per campaign), `name`, `status`, `activatedAt` |
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | `surveyStatus` (`not_surveyed`/`surveyed`), `householdId` (required → voters are campaign-disjoint) |

**The core invariant (write path).** In [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js),
every knock submission first runs
`CanvassActivity.deleteMany({ userId, householdId, passId, actionType ∈ REPLACEABLE_ACTIONS })`
before inserting the new one (`REPLACEABLE_ACTIONS` = the four knock types). Therefore:

> **At most ONE `CanvassActivity` (knock) exists per `(userId, householdId, passId)`.**

This is why a canvasser's raw knock-event count *equals* their distinct house-pass count, and why
a same-canvasser same-pass correction never inflates anything. The survey route applies the same
household-scoped dedup, so a multi-voter house still yields exactly one `survey_submitted`
activity per (user, house, pass) — even though it produces multiple `SurveyResponse` rows.

`KNOCK_ACTIONS = ['not_home', 'wrong_address', 'survey_submitted', 'lit_dropped']` (reports.js).
`note_added` is excluded — it can be left without a visit decision.

## B. Field dictionary

| API field | Meaning | How it's computed | Returned by | Date field |
|---|---|---|---|---|
| `knocks` | Billable knocks: distinct `(household, passId)` | `knocksPipeline` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyedKnocks` | Knocks (house-passes) with ≥1 `survey_submitted` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `litKnocks` | Knocks with ≥1 `lit_dropped` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `connectionRate` | `(surveyedKnocks + litKnocks) / knocks × 100`, integer, ≤100 | `connectionRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `surveysSubmitted` | Survey responses (one per voter/pass) — a volume count | `SurveyResponse.countDocuments` / `$sum` | `/overview`, `/campaign-rollup`, `/canvassers` | `submittedAt` |
| `surveyedVoters` | Distinct voters surveyed | distinct `voterId` in `SurveyResponse` | `/overview`, `/campaign-rollup` | `submittedAt` |
| `homesKnocked` | Org/campaign: distinct households `status ≠ unknocked`. Per-canvasser: alias of `knocks` | `Household.countDocuments` (org) / `= knocks` (leaderboard) | `/overview`, `/campaign-rollup`, `/canvassers` | all-time (org) |
| `knockedPct` | `homesKnocked / households × 100` | derived | `/campaign-rollup` | all-time |
| `coverage` / `canvass` | Per-household current-status buckets (sums to households) | `Household.aggregate` group by `status` | `/campaign-rollup` (`coverage`), `/overview` (`canvass`) | all-time |
| `litDropped` | Lit-drop **events** (volume) | `CanvassActivity` count of `lit_dropped` | `/overview` (`events`), `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyKnocks` | Per-canvasser surveyed knocks (rate numerator) | count of that user's `survey_submitted` activities | `/canvassers` | `timestamp` |
| `activeCanvassers` | Distinct `userId` with activity in range | `CanvassActivity.distinct('userId')` (**not summable**) | `/overview` (`activeUsers`), `/campaign-rollup` | `timestamp` |

## C. Core aggregation

`knocksPipeline(match, { byCampaign })` in [reports.js](../server/src/routes/admin/reports.js) —
the single source for knocks and the rate numerator:

```js
[
  { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
  { $group: {
      _id: { householdId: '$householdId', passId: '$passId' /*, campaignId when byCampaign */ },
      hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
      hasLit:    { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
  } },
  { $group: {
      _id: byCampaign ? '$_id.campaignId' : null,
      knocks: { $sum: 1 }, surveyedKnocks: { $sum: '$hasSurvey' }, litKnocks: { $sum: '$hasLit' },
  } },
]
```

The first `$group` collapses each `(household, pass)` to one row (the billable unit) and flags
whether it landed a completion action; the second tallies.

```js
connectionRate({ knocks, surveyedKnocks, litKnocks }) =
  knocks ? Math.round(((surveyedKnocks + litKnocks) / knocks) * 100) : 0
```

Survey and lit completions are mutually exclusive within a campaign, so summing them is safe and
the result never exceeds `knocks` (numerator ⊆ denominator) → always ≤ 100.

## D. Overlap detection

`/overlaps` ([reports.js](../server/src/routes/admin/reports.js)) groups by `(household, pass)`,
counts **distinct** canvassers, and keeps groups with 2+:

```js
{ $group: { _id: { householdId, passId }, canvassers: { $addToSet: '$userId' }, events: { $push: {...} } } },
{ $set:   { distinctCount: { $size: '$canvassers' } } },
{ $match: { distinctCount: { $gt: 1 } } },
```

then rolls up to **one card per household** listing its colliding passes. Response shape:

```jsonc
{
  "overlaps": [
    {
      "household": { "id", "addressLine1", "addressLine2", "city", "state", "zipCode" },
      "passes": [
        { "passId", "roundNumber", "roundLabel": "Round 2 · GOTV",
          "canvassers": [ { "userId", "firstName", "lastName", "email", "actionType", "timestamp" } ] }
      ],
      "totalCanvassers": 2
    }
  ],
  "total": 1
}
```

`passId: null` (legacy) is its own bucket — 2+ distinct canvassers there still flag.
`roundLabel` falls back to `"Legacy / no pass"` when there's no `Pass`.

## E. Endpoint reference

| Endpoint | Scope | Key returns | Range basis |
|---|---|---|---|
| `GET /admin/reports/overview` | one campaign or org-wide | `totals{ households, voters, activeUsers, surveysSubmitted, surveyedVoters, homesKnocked, knocks, surveyedKnocks, litKnocks, connectionRate }`, `canvass{}`, `events{}` | **all-time** (no `from/to`) |
| `GET /admin/reports/campaign-rollup` | `scope=active\|archived\|all` or `campaignId` | `cumulative{…}` + `campaigns[ row{ households, homesKnocked, knockedPct, knocks, surveyedKnocks, litKnocks, surveysSubmitted, surveyedVoters, litDropped, connectionRate, activeCanvassers, coverage{} } ]` | activity on `timestamp`, surveys on `submittedAt`; households/coverage all-time |
| `GET /admin/reports/canvassers` | leaderboard | rows `{ surveysSubmitted, surveyKnocks, notHome, wrongAddress, litDropped, knocks, homesKnocked(=knocks), connectionRate, … }` | activity `timestamp`, surveys `submittedAt` |
| `GET /admin/reports/canvassers.csv` | leaderboard export | columns incl. `Knocks`, `Connection rate %` | same |
| `GET /admin/reports/team-averages` | org averages | `avg{ homesKnocked, surveysSubmitted, connectionRatePct, doorsPerHour, … }` (rate = Σ completion knocks / Σ knocks) | same |
| `GET /admin/reports/canvassers/:id/summary` | one canvasser | `kpi{ homesKnocked(=knocks), surveysSubmitted, connectionRatePct, doorsPerHour, … }` | same |
| `GET /admin/reports/canvassers/:id/daily` | one canvasser, per day | `days[{ homesKnocked, surveyKnocks, surveysSubmitted, connectionRatePct, … }]` | same |
| `GET /admin/reports/overlaps` | overlap review | see §D | `timestamp` |

**Cumulative summability:** `households`, `homesKnocked`, `knocks`, `surveyedKnocks`,
`litKnocks`, `surveysSubmitted`, `surveyedVoters`, `litDropped` are summed across campaigns
(households/voters are campaign-disjoint, so the distinct counts don't overlap). Cumulative
`connectionRate` is recomputed from the summed numerator/denominator. `activeCanvassers` is **not**
summable — it uses a separate org-wide `distinct('userId')`.

## F. Invariants & edge cases

- **Null `passId`** → one synthetic legacy bucket per household (pre-turf data = 1 knock/house;
  overlaps still flag 2+ distinct canvassers).
- **Range fields differ by metric:** knocks/lit/events range on `timestamp`; surveys and surveyed
  voters range on `submittedAt`. Don't mix them in one `$match`.
- **`/overview` is all-time**, `/campaign-rollup` honors the range. The campaign page pulls
  Activity (range) from rollup and Coverage (all-time) from overview — intentional.
- **Connection rate ≤ 100** by construction (numerator ⊆ knocks). "Surveys" is a separate volume
  number that *can* exceed knocks for multi-voter homes.
- **`homesKnocked` is overloaded:** org/campaign = distinct knocked households; per-canvasser = a
  back-compat **alias of `knocks`**. New code should read `knocks`.
- **Org knocks ≤ Σ per-canvasser knocks** when overlaps exist (each canvasser keeps personal
  credit; the org dedups the house-pass).
- **Early-voting doors get their own "Voted" coverage segment.** A household marked `fullyVoted`
  drops off the *canvasser's* map/books and, in reports, is pulled out of `unknocked` into a
  dedicated **`voted`** coverage bucket (`coverageBucketExpr` in reports.js). It still counts in
  **Households**; `homesKnocked`/knocks are unaffected. Only otherwise-`unknocked` doors move — a
  door knocked before it went fully-voted keeps its knocked status. See [docs/EARLY_VOTING.md](EARLY_VOTING.md).

## G. Frontend mapping

Shared rate tiers (green ≥20% / amber 10–19% / red <10%): web
[client/src/lib/rates.js](../client/src/lib/rates.js) (`rateLevel`/`rateAccent`/`ratePct`),
mobile [mobile/lib/rates.js](../mobile/lib/rates.js) (`rateFromPct` for the server pct;
`getConnectionRate` for the personal raw-event screens; `RATE_COLORS`).

### Web ([client/src](../client/src))
| File | Renders |
|---|---|
| [pages/OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) | Org Overview. `DateRangeSelector` → `/campaign-rollup?scope=active`. Cumulative `CoverageBar` + StatCards (Households, Houses knocked, **Knocks**, Surveys, **Surveyed voters**, **Connection rate**, Lit drops, Active canvassers). Per-campaign `CampaignCard` rows + `CoverageBar`; archived rows show Knocks. |
| [pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Campaign detail. **Activity** (range, `/campaign-rollup?campaignId`): Knocks, Surveys/Lit, Surveyed voters, Connection rate. **Coverage** (all-time, `/overview`): households + homesKnocked + `CoverageBar`. |
| [components/CanvasserTable.jsx](../client/src/components/CanvasserTable.jsx) | Leaderboard table: Surveys, Lit drops, Not home, Wrong addr, **Knocks**, **Connection**, Last activity. |
| [components/CoverageBar.jsx](../client/src/components/CoverageBar.jsx) | Segmented bar + numeric legend (counts + %). |
| [components/StatCard.jsx](../client/src/components/StatCard.jsx) | `label / value / hint / accent`. |

### Mobile ([mobile/app/(app)/admin](../mobile/app/(app)/admin))
| File | Renders |
|---|---|
| [index.jsx](../mobile/app/(app)/admin/index.jsx) | Org Overview. `DateRangeBar` → `/campaign-rollup`. Cumulative card: `CoverageBar` + two stat rows (Knocks/Surveys/Surveyed; Connection/Lit/Canvassers). `CampaignCard`: full `CoverageBar` + coverage line + inline (knocks/surveys/voters/conn/canv); archived rows show knocks. |
| [campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | **Activity** tiles (Knocks, Surveys/Lit, Surveyed voters, Connection rate via `rateFromPct`) from rollup; **Coverage** (all-time) from overview; Top canvassers from `/canvassers`. |
| [canvassers.jsx](../mobile/app/(app)/admin/canvassers.jsx) | Leaderboard. `rowDerived` uses `r.knocks` + `r.connectionRate`; totals use `knocks` + `completionKnocks`; overlap banner. |
| [overlaps.jsx](../mobile/app/(app)/admin/overlaps.jsx) | Renders `overlaps[].passes[]` grouped by `roundLabel`. |
| [canvasser/[id]/index.jsx](../mobile/app/(app)/admin/canvasser/[id]/index.jsx), [compare.jsx](../mobile/app/(app)/admin/canvasser/compare.jsx), [[id]/days.jsx](../mobile/app/(app)/admin/canvasser/[id]/days.jsx), [[id]/day/[date].jsx](../mobile/app/(app)/admin/canvasser/[id]/day/[date].jsx) | Per-canvasser drilldowns; `kpi.homesKnocked` (= knocks) + `connectionRatePct`. |
| [components/CoverageBar.jsx](../mobile/components/CoverageBar.jsx) | Bar + legend; `compact` hides the legend. |

### Personal (separate lens — NOT billing)
[mobile/app/(app)/stats.jsx](../mobile/app/(app)/stats.jsx), [stats/[date].jsx](../mobile/app/(app)/stats/[date].jsx),
and the map HUD ("Today's Progress") read `/mobile/me/today` + `/mobile/me/history`. `doorsKnocked` =
raw personal door events (today / for the date); these are a canvasser-motivation view and intentionally
do **not** use the billable per-house-pass knock.

**`remaining`** (the map HUD's "Remaining", [me.js `/today`](../server/src/routes/mobile/me.js)) = the
doors still left for **this person** to knock: `status = 'unknocked'`, `isActive`,
**`fullyVoted: { $ne: true }`**, scoped to the user's **own assigned books** (`canvasserHouseholdScope`,
see [EFFORTS.md §D](EFFORTS.md)) — i.e. the unknocked pins on their *own* map. Because it's **personal**,
it does **not** equal the admin dashboard's campaign-wide **Unknocked** coverage segment:
- Admin **Unknocked** = the *whole campaign*, with fully-voted doors pulled out into the `voted` bucket.
- Mobile **Remaining** = *one person's assigned books*, with fully-voted doors simply excluded.

So a canvasser assigned a slice of the campaign sees a smaller number, and an admin in canvass mode sees
only their own assigned books. (Both correctly exclude fully-voted doors — a mismatch there was a real
bug, fixed by adding the `fullyVoted` filter + the per-user scope.)
