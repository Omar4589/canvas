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
defaults, and boundary math), [TIMEZONES.md](TIMEZONES.md) (these counts are windowed and bucketed in
the campaign's timezone — what "a day" means here).

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

> **Surveys > Surveyed voters?** Then a voter has more than one response (a re-survey). The rule is
> **one survey per voter per pass**, now **DB-enforced** — the submit upserts on `(voter, pass)` with a
> unique index ([SurveyResponse.js](../server/src/models/SurveyResponse.js), migration
> [migrateSurveyDedup.js](../server/src/migrations/migrateSurveyDedup.js)), so a double-tap can no
> longer create two rows. Any **historical** gap (pre-fix double-submit) shows in the **Duplicate
> surveys** report (`GET /admin/reports/duplicate-surveys`; web page `/admin/duplicate-surveys`),
> which lists those voters with **who / when / round / where** and flags *same canvasser · same day*
> (a likely mistake) vs *different canvassers* (usually a legitimate revisit). Fix by opening the voter
> profile and deleting the extra response.

### Connection rate
**Surveyed knocks ÷ Knocks × 100.** Of the knocks we made, how many landed a survey. A
"surveyed knock" is a (household, pass) that got at least one survey, so the numerator is always
a subset of Knocks → **the rate is always ≤ 100%.** (Lit-drop campaigns use lit knocks ÷ knocks
and label it "Lit rate"; the value is computed the same way.) Field: `connectionRate`.

### Refused  *(survey campaigns only)*
A door where a voter **answered but declined to participate**. It sits beside Not Home and Wrong
Address as a door disposition, and it is colored amber (`#F59E0B`) everywhere.

Two things to hold onto:

- It **is a billable knock.** Someone opened the door; that's real, paid-for work. A refused door
  counts in **Knocks** exactly like any other disposition.
- It **is a contact, in its own bucket — never a survey.** We reached a person, but no survey form
  was filed. So a refused door does **not** count toward Surveys, Surveyed voters, or the
  Connection rate.

Refused doors live in their own metric, `refusedKnocks` — the count of knocks (house-passes) whose
outcome was Refused. It's a **subset of Knocks**. Refused is a survey-campaign concept; lit-drop
campaigns don't surface it (`refusedKnocks` stays 0).

### Reached a person  *(contact rate — survey campaigns only)*
**(Surveyed knocks + Refused knocks) ÷ Knocks × 100.** Of the knocks we made, how many reached a
**live person at the door** — whether or not they took the survey. This is a *new, separate* metric;
it answers "how often did someone actually answer?" rather than "how often did we land a survey?"
Field: `contactRate`. Because both pieces of the numerator are subsets of Knocks, it's always
≤ 100%.

> **The Connection / Survey rate is UNCHANGED.** Connection rate is still *surveyed knocks ÷ knocks*
> — refused doors are **not** in its numerator. A refusal lowers the Connection rate only the way any
> other unsurveyed knock does (it's a knock with no survey). Reached-a-person rate will therefore sit
> **at or above** the Connection rate by exactly the refused share. Two questions, two numbers: "did we
> reach anyone?" (contact rate) vs. "did we land a survey?" (connection rate).

### Coverage funnel (the colored bar)
Each household sits in exactly one bucket — `surveyed`, `lit_dropped`, `refused`, `not_home`,
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

**Now add refusals (survey campaigns).** Suppose 8 of those 40 Round-1 not-homes were actually
*refusals* (someone answered and declined). Knocks are unchanged at 140 (a refusal is still a
billable knock). But the door-outcome breakdown now carries a **refused** bucket — and still sums
to the 140 knocks: 70 surveyed / 8 refused / 62 not-home. Reached-a-person rate =
(70 + 8) ÷ 140 = **56%**, while the Connection rate stays **50%** (70 surveyed ÷ 140). The 6-point
gap is exactly the refused share.

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
| `CanvassActivity` | [models/CanvassActivity.js](../server/src/models/CanvassActivity.js) | `householdId`, `userId`, `actionType` (`not_home`/`wrong_address`/`refused`/`survey_submitted`/`lit_dropped`/`note_added`), `passId` (nullable), `campaignId`, `organizationId`, `timestamp` |
| `Household` | [models/Household.js](../server/src/models/Household.js) | `status` (`unknocked`/`not_home`/`surveyed`/`wrong_address`/`refused`/`lit_dropped`), `isActive`, `campaignId`, `lastActionAt`, `lastActionBy` |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `voterId`, `householdId`, `userId`, `passId`, `campaignId`, `submittedAt` (one per voter **per pass**) |
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `roundNumber` (ordered, unique per campaign), `name`, `status`, `activatedAt` |
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | `surveyStatus` (`not_surveyed`/`surveyed`), `householdId` (required → voters are campaign-disjoint) |

**The core invariant (write path).** In [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js),
every knock submission first runs
`CanvassActivity.deleteMany({ userId, householdId, passId, actionType ∈ REPLACEABLE_ACTIONS })`
before inserting the new one (`REPLACEABLE_ACTIONS` = the five knock types, including `refused`). Therefore:

> **At most ONE `CanvassActivity` (knock) exists per `(userId, householdId, passId)`.**

This is why a canvasser's raw knock-event count *equals* their distinct house-pass count, and why
a same-canvasser same-pass correction never inflates anything. The survey route applies the same
household-scoped dedup, so a multi-voter house still yields exactly one `survey_submitted`
activity per (user, house, pass) — even though it produces multiple `SurveyResponse` rows.

`KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped']`
([services/reports/aggregations.js](../server/src/services/reports/aggregations.js)). `refused` is a
knock like the others (a billable door interaction); `note_added` is excluded — it can be left
without a visit decision. The non-completion status precedence (`ACTION_TO_STATUS` /
`statusPrecedence` in [utils/statusPrecedence.js](../server/src/utils/statusPrecedence.js)) treats
`refused` as a non-completion outcome resolved last-write-wins, so a later refusal can overwrite an
earlier not-home on the same house-pass but a survey still wins over a refusal.

## B. Field dictionary

| API field | Meaning | How it's computed | Returned by | Date field |
|---|---|---|---|---|
| `knocks` | Billable knocks: distinct `(household, passId)` | `knocksPipeline` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyedKnocks` | Knocks (house-passes) with ≥1 `survey_submitted` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `litKnocks` | Knocks with ≥1 `lit_dropped` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `refusedKnocks` | Knocks (house-passes) whose outcome was `refused` — a billable contact, **not** a survey. Subset of `knocks` (survey campaigns only; 0 on lit) | `$max` flag (`hasRefused`) in `knocksPipeline` | `/overview`, `/campaign-rollup` (on `/canvassers` the per-canvasser count is the bare `refused` column, which feeds that row's `contactRate`) | `timestamp` |
| `connectionRate` | `(surveyedKnocks + litKnocks) / knocks × 100`, integer, ≤100. **Unchanged by Refused** — refusals are not in the numerator | `connectionRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `contactRate` | "Reached a person": `(surveyedKnocks + refusedKnocks) / knocks × 100`, integer, ≤100 | `contactRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
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

The same `$max`/`$group` also flags `hasRefused` and sums it to `refusedKnocks` — the count of
house-passes whose outcome was Refused (one per billable knock, so a subset of `knocks`).

```js
connectionRate({ knocks, surveyedKnocks, litKnocks }) =
  knocks ? Math.round(((surveyedKnocks + litKnocks) / knocks) * 100) : 0

contactRate({ knocks, surveyedKnocks, refusedKnocks }) =
  knocks ? Math.round(((surveyedKnocks + refusedKnocks) / knocks) * 100) : 0
```

Both live in [services/reports/aggregations.js](../server/src/services/reports/aggregations.js).
Survey and lit completions are mutually exclusive within a campaign, so summing them is safe and
the result never exceeds `knocks` (numerator ⊆ denominator) → always ≤ 100.

**`contactRate` ("Reached a person") is the new, separate metric** — *(surveyed + refused) ÷ knocks*.
It counts every knock where a person answered the door (a survey **or** a refusal). `connectionRate`
is deliberately left alone: refusals never enter its numerator, so a refusal lowers the survey rate
only as an unsurveyed knock. `refusedKnocks ⊆ knocks`, so `contactRate ≤ 100` and
`contactRate ≥ connectionRate` (it adds the refused share on top). Refused is a survey-campaign
disposition; on lit campaigns `refusedKnocks = 0` and `contactRate` degenerates to the survey share.

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

The aggregation+rollup above lives in `computeOverlaps` ([services/reports/overlaps.js](../server/src/services/reports/overlaps.js)) — a shared helper called by **both** `/overlaps` and `/canvasser-timeline` (so they can't drift). The **web Daily Timeline** (below) is the first web overlaps surface; the standalone web `/overlaps` page is still a backlog item.

## E. Endpoint reference

| Endpoint | Scope | Key returns | Range basis |
|---|---|---|---|
| `GET /admin/reports/overview` | one campaign or org-wide | `totals{ households, voters, activeUsers, surveysSubmitted, surveyedVoters, homesKnocked, knocks, surveyedKnocks, litKnocks, refusedKnocks, connectionRate, contactRate }`, `canvass{}` (incl. `refused`), `events{}` (incl. `refused`) | **all-time** (no `from/to`) |
| `GET /admin/reports/campaign-rollup` | `scope=active\|archived\|all` or `campaignId` | `cumulative{…}` + `campaigns[ row{ households, homesKnocked, knockedPct, knocks, surveyedKnocks, litKnocks, refusedKnocks, surveysSubmitted, surveyedVoters, litDropped, connectionRate, contactRate, activeCanvassers, coverage{} } ]` | activity on `timestamp`, surveys on `submittedAt`; households/coverage all-time |
| `GET /admin/reports/canvassers` | leaderboard | rows `{ surveysSubmitted, surveyKnocks, notHome, wrongAddress, refused, litDropped, knocks, homesKnocked(=knocks), connectionRate, contactRate, … }` (per-canvasser refused is the bare `refused` field, not `refusedKnocks`; it feeds `contactRate`) | activity `timestamp`, surveys `submittedAt` |
| `GET /admin/reports/canvassers.csv` | leaderboard export | columns incl. `Knocks`, `Connection rate %` | same |
| `GET /admin/reports/team-averages` | org averages | `avg{ homesKnocked, surveysSubmitted, connectionRatePct, doorsPerHour, … }` (rate = Σ completion knocks / Σ knocks) | same |
| `GET /admin/reports/canvassers/:id/summary` | one canvasser | `kpi{ homesKnocked(=knocks), surveysSubmitted, connectionRatePct, doorsPerHour, … }` | same |
| `GET /admin/reports/canvassers/:id/daily` | one canvasser, per day | `days[{ homesKnocked, surveyKnocks, surveysSubmitted, connectionRatePct, … }]` | same |
| `GET /admin/reports/overlaps` | overlap review | see §D | `timestamp` |
| `GET /admin/reports/duplicate-surveys` | voters with >1 survey response | `duplicates[{ voter, household, responses[{ canvasser, submittedAt, roundLabel }], sameCanvasserSameDay, differentCanvassers }]` | `submittedAt` |
| `GET /admin/reports/canvasser-timeline` | one campaign, one **day** (`?date=`, the mobile path) or a **range** (`?from/&to`, max 62 days; missing `to` = today) | `mode:'day'`: `{ date, hours[], hourTotals{} }` shape (byte-compatible for mobile); `mode:'range'`: `{ days[], dayTotals{} }` with per-canvasser `knocksByDay/surveysByDay`. Both: `{ range{from,to}, tz, canvassers[{ knocksByHour\|knocksByDay, …, dayKnocks, daySurveys, dayLit, refused, notHome, wrongAddress, firstActivityAt, lastActivityAt, hoursOnDoors, doorsPerHour, connectionRate, contactRate, inOverlap }], grandKnocks, billableKnocks, overlapDoors, overlaps[] }`. `dayKnocks/daySurveys/dayLit` are the WINDOW totals in both modes. `hoursOnDoors` = Σ per-day (last−first), same method as `/canvassers/:id/summary` | `timestamp` window in campaign tz; buckets via `$hour` (day) / `$dateToString` (range) |

**Cumulative summability:** `households`, `homesKnocked`, `knocks`, `surveyedKnocks`,
`litKnocks`, `refusedKnocks`, `surveysSubmitted`, `surveyedVoters`, `litDropped` are summed across
campaigns (households/voters are campaign-disjoint, so the distinct counts don't overlap). Cumulative
`connectionRate` **and** `contactRate` are recomputed from the summed numerator/denominator (not
averaged). `activeCanvassers` is **not** summable — it uses a separate org-wide `distinct('userId')`.

## F. Invariants & edge cases

- **Null `passId`** → one synthetic legacy bucket per household (pre-turf data = 1 knock/house;
  overlaps still flag 2+ distinct canvassers).
- **Range fields differ by metric:** knocks/lit/events range on `timestamp`; surveys and surveyed
  voters range on `submittedAt`. Don't mix them in one `$match`.
- **`/overview` is all-time**, `/campaign-rollup` honors the range. The campaign page pulls
  Activity (range) from rollup and Coverage (all-time) from overview — intentional.
- **Connection rate ≤ 100** by construction (numerator ⊆ knocks). "Surveys" is a separate volume
  number that *can* exceed knocks for multi-voter homes.
- **Refused is a knock + a contact, never a survey (survey campaigns only).** `refused` is in
  `KNOCK_ACTIONS`, so a refused door is a billable knock and appears in the door-outcome breakdown's
  `refused` bucket (which keeps the breakdown summing to `doorsKnocked`). `refusedKnocks ⊆ knocks`.
  It feeds **only** the new `contactRate` (= (surveyed + refused) ÷ knocks); the existing
  `connectionRate` (= (surveyed + lit) ÷ knocks) is **unchanged** — a refusal lowers it only as an
  unsurveyed knock. So `contactRate ≥ connectionRate` on survey campaigns; on lit campaigns
  `refusedKnocks = 0`. A survey still beats a refusal in status precedence
  ([utils/statusPrecedence.js](../server/src/utils/statusPrecedence.js)), so a house-pass that was
  refused then surveyed resolves to `surveyed`, not `refused`.
- **`homesKnocked` is overloaded:** org/campaign = distinct knocked households; per-canvasser = a
  back-compat **alias of `knocks`**. New code should read `knocks`.
- **Org knocks ≤ Σ per-canvasser knocks** when overlaps exist (each canvasser keeps personal
  credit; the org dedups the house-pass).
- **Client-report voter-contact breakdown is deduped per `(household, pass)`**, not a raw-event
  count: `computeWindowStats` ([computeReport.js](../server/src/services/reports/computeReport.js))
  resolves each house-pass to one outcome via `resolveStatus`, so the breakdown sums to
  `doorsKnocked` and `breakdown.surveyed === surveyedKnocks`. The breakdown now has a **`refused`
  bucket** (`events` keys `not_home`/`wrong_address`/`refused`/`surveyed`/`lit_dropped`); it's just
  another resolved outcome, so the breakdown still sums to `doorsKnocked` and
  `breakdown.refused === refusedKnocks`. The client-portal report labels this bucket **"Declined to
  participate"** (`CONTACT_LABELS` in [client/src/lib/reportDerive.js](../client/src/lib/reportDerive.js)).
  An overlap (2+ canvassers, same
  house-pass) is one outcome here, exactly as it's one knock. The admin Overview uses the deduped
  **coverage funnel** (`canvass`, per-household status) for the same reason; its raw `events{}`
  object is a separate volume lens (e.g. lit-drop volume). See [CLIENT_PORTAL.md](CLIENT_PORTAL.md).
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
| [pages/TimelinePage.jsx](../client/src/pages/TimelinePage.jsx) + [components/CanvasserSummaryTable.jsx](../client/src/components/CanvasserSummaryTable.jsx) + [components/TimelineGrid.jsx](../client/src/components/TimelineGrid.jsx) + [components/TimelineOverlaps.jsx](../client/src/components/TimelineOverlaps.jsx) | **Timeline** (`/campaigns/:id/timeline`, `/canvasser-timeline`): live performance dashboard — KPI strip (Doors, Surveys, Connection rate, Doors/hr, Knocking N of M), sortable per-canvasser table (coordinator, rates, pace, start/last door), heatmap grid (hour columns for a day, day columns for a range), date-range presets + single-day stepper, coordinator crew filter (client-side; overlaps card stays campaign-wide), Knocks/Surveys toggle, LiveStatus 20s refresh while the range includes today, inline overlaps reconciliation. Coordinator names come from the Team roster cache (`useCampaignTeam`). First web overlaps surface. |

### Mobile ([mobile/app/(app)/admin](../mobile/app/(app)/admin))
| File | Renders |
|---|---|
| [index.jsx](../mobile/app/(app)/admin/index.jsx) | Org Overview. `DateRangeBar` → `/campaign-rollup`. Cumulative card: `CoverageBar` + two stat rows (Knocks/Surveys/Surveyed; Connection/Lit/Canvassers). `CampaignCard`: full `CoverageBar` + coverage line + inline (knocks/surveys/voters/conn/canv); archived rows show knocks. |
| [campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | **Activity** tiles (Knocks, Surveys/Lit, Surveyed voters, Connection rate via `rateFromPct`) from rollup; **Coverage** (all-time) from overview; Top canvassers from `/canvassers`; "Timeline" quick-link. |
| [timeline.jsx](../mobile/app/(app)/admin/timeline.jsx) + [components/LiveStatus.jsx](../mobile/components/LiveStatus.jsx) | **Timeline** (`/canvasser-timeline`): live performance dashboard at web parity — KPI tiles (`KpiGrid`: Doors, Surveys, Connection rate via `rateFromPct`, Doors/hr, Knocking N of M), per-canvasser cards (coordinator, `dayKnocks/daySurveys/connectionRate`, `hoursOnDoors`·doors/hr, `formatRange` shift line; tap → canvasser detail), `DateRangeBar` presets (no 'all') + single-day stepper, walk-list + coordinator `TabSwitcher` crew filters (client-side join from `/campaigns/:id/assignments`; overlaps stay campaign-wide with a note), Knocks/Surveys toggle, frozen-name-column heatmap grid (hour columns single-day, day columns for a range — `data.mode` guarded), reconciliation + overlap cards (`overlapCount` true total), `LiveStatus` pill (20s poll while the range includes today, pause/refresh) + `useFocusedPoll`. Reloads the campaign on focus + accepts a `campaignId` param. |
| [canvassers.jsx](../mobile/app/(app)/admin/canvassers.jsx) | Leaderboard. `rowDerived` uses `r.knocks` + `r.connectionRate`; totals use `knocks` + `completionKnocks`; overlap banner. |
| [overlaps.jsx](../mobile/app/(app)/admin/overlaps.jsx) | Renders `overlaps[].passes[]` grouped by `roundLabel`. |
| [canvasser/[id]/index.jsx](../mobile/app/(app)/admin/canvasser/[id]/index.jsx), [compare.jsx](../mobile/app/(app)/admin/canvasser/compare.jsx), [[id]/days.jsx](../mobile/app/(app)/admin/canvasser/[id]/days.jsx), [[id]/day/[date].jsx](../mobile/app/(app)/admin/canvasser/[id]/day/[date].jsx) | Per-canvasser drilldowns; `kpi.homesKnocked` (= knocks) + `connectionRatePct`. |
| [components/CoverageBar.jsx](../mobile/components/CoverageBar.jsx) | Bar + legend; `compact` hides the legend. |

### Personal (separate lens — NOT billing)
[mobile/app/(app)/stats.jsx](../mobile/app/(app)/stats.jsx), [stats/[date].jsx](../mobile/app/(app)/stats/[date].jsx),
and the map HUD ("Today's Progress") read `/mobile/me/today` + `/mobile/me/history`. `doorsKnocked` =
raw personal door events (today / for the date), and `responses`/`litDropped` are raw volume counts;
these are a canvasser-motivation view and intentionally do **not** use the billable per-house-pass knock.

**The personal connection rate, though, is bounded like the report's.** `/mobile/me/*` also returns
`knockedHomes` / `surveyedHomes` / `litHomes` / `refusedHomes` (distinct `householdId` for that user/window/day), and the
mobile rate is `surveyedHomes ÷ knockedHomes` (or `litHomes ÷ knockedHomes`), clamped ≤100% in
[mobile/lib/rates.js](../mobile/lib/rates.js) `getConnectionRate`. So a canvasser who knocks one home and
surveys two voters there sees **100%, not 200%**, and the personal rate reads the same way as the
admin/report `connectionRate` (= `surveyedKnocks/knocks`). Only the *rate* uses distinct homes; the
displayed door/survey/lit **counts** stay raw.

**Refused, per day (personal).** `/mobile/me/*` ([me.js](../server/src/routes/mobile/me.js)) also
returns `refusedHomes` (distinct `householdId` this user marked `refused`) and `reachedHomes`
(distinct homes that were **surveyed OR refused** — the personal "Reached a person" count, the local
analogue of the report's `contactRate` numerator). `refused` is in this route's `DOOR_ACTIONS`, so a
refusal also counts in the raw personal `doorsKnocked`. **`reachedHomes` is a per-day display value
only — never sum it across days:** a home refused on day 1 and surveyed on day 2 would be
double-counted (the code builds it as a fresh `Set` union per day, both in `/today` and the
per-day `/history` rows).

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
