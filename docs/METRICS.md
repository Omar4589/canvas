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
  house per round, honors the date filter.

They can disagree (Knocks can exceed Houses once you do a second pass) — that's expected.

## Metric definitions

### Houses knocked
Distinct households that have been knocked at least once (status ≠ `unknocked`). This is
**current-state and all-time** — it doesn't move with the date filter. It answers "how much of
the turf is done." Field: `homesKnocked`.

### Knocks
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

### Restricted access  *(all campaign types)*
A home a canvasser **physically can't reach** — a gated community, a locked building, no legal access.
It sits beside the other door dispositions but is deliberately the **mirror image of Refused**: a
*marker*, not a knock. It's colored **slate (`#475569`)** everywhere and, unlike Refused, is offered on
**every** campaign — survey and lit-drop alike.

The one rule to hold onto: **it is recorded and shown, but it is never billable.**

- It is **not a knock.** Restricted is kept out of `KNOCK_ACTIONS`, so it never counts toward **Knocks**,
  **Houses knocked**, the Connection rate, the Reached-a-person rate, or the doors/hour numerator. No
  door interaction was possible, so there's nothing to bill.
- It **is visible — in its own tally.** Every place a canvasser's numbers appear (leaderboard, CSV,
  timeline, "My Stats", memberships, platform counts) carries a separate **Restricted** count beside
  the knocks, so the work of *trying* the door is never lost.
- It gets its **own coverage segment.** A restricted home counts in the coverage universe (the
  denominator — it's a real door) but is **not** counted as "knocked"; it sits in its own slate segment
  on the bar, distinct from both `unknocked` and the knocked dispositions.

Restricted marks still count toward a canvasser's **shift window** (a restricted stop's timestamp
extends the first→last working span), and show up in **activity feeds, the daily timeline, and the GPS
audit** — the canvasser was there and did work, even if no door opened. So doors/hour can dip slightly
when someone logs restricted homes; that's intentional. A restricted mark is **overridable** — it's in
`REPLACEABLE_ACTIONS`, so re-recording any other disposition on the same door/pass supersedes it (fixes
a mistap).

**Bulk marks are the one exception to the per-canvasser rules above.** An admin can mark a **whole
book** restricted at once (a gated community — from the web Turf Cutting page or the mobile Books
screen). Those marks are real activity rows carrying `via: 'bulk'`
([models/CanvassActivity.js](../server/src/models/CanvassActivity.js)): they drive door status,
per-round views, coverage, and campaign-scope restricted tallies exactly like field marks — but they
are **excluded** from every per-canvasser surface (timeline, leaderboards, per-canvasser Restricted
columns/CSV, shift windows, travel, activity feeds, active-now) and are **invisible to the GPS
audit** (`NOT_BULK` in [aggregations.js](../server/src/services/reports/aggregations.js)), because a
hundred same-second marks by one admin audit nothing a canvasser did. Doors already **completed in
the round** keep their result (skipped), already-restricted doors are skipped (idempotent), and
**Unmark restricted** removes only the bulk marks — field marks survive.

### Coverage funnel (the colored bar)
Each household sits in exactly one bucket — `surveyed`, `lit_dropped`, `refused`, `restricted`,
`not_home`, `wrong_address`, `voted`, `dnc`, or `unknocked` — so the bar sums to the total number
of households. `unknocked` = houses not yet knocked at all; `restricted` = homes a canvasser
couldn't physically reach (its own segment — counted in the household total but not among the
"knocked"); `voted` = early-voting doors that dropped off the canvasser's list (pulled out of
`unknocked`, see early-voting doc); `dnc` = doors where **every** resident is marked do-not-contact
(also pulled out of `unknocked` — they will never be knocked; see [VOTERS.md](VOTERS.md)).
**Precedence:** a door that is both fully-voted and fully-DNC buckets as `dnc` — the permanent
request outranks this election's early voting, so the segments always sum. This is a coverage
lens, separate from Knocks (activity). Field: `canvass` / `coverage`.

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

**Now add restricted homes.** Suppose 5 of those 30 standing not-homes turn out to be a gated/locked
building the canvasser can't enter, so they're marked Restricted. They leave **Knocks and every rate
untouched** (a restricted mark isn't a knock), and drop out of **Houses knocked** (now 95, not 100) —
they surface only as their own slate **Restricted** tally and a distinct slate segment on the coverage
bar (coverage now reads 70 surveyed / 25 not-home / 5 restricted, still summing to 100). This is the
inverse of Refused: Refused *is* a knock in its own bucket; Restricted is a *marker* in its own bucket.

**Billable doors.** Some organizations invoice their client per door, and want those 5 gated homes on
the bill — the canvasser still made the walk. That's the **Restricted doors on invoices** setting
(org-wide default on the Billing page, overridable per campaign in the campaign's edit screen; **off**
everywhere unless you turn it on). Turn it on and a second number appears — **Billable doors = 140 + 5
= 145** — on the invoice export, the Timeline, and the dashboard. **Nothing else moves:** Knocks stays
140, both rates stay 56% and 50%, Houses knocked stays 95, and the coverage bar is unchanged. That's
deliberate — nobody answered a locked gate, so a restricted home can never sit in a rate's denominator
without making the rate a lie. Two exclusions worth knowing: a **bulk** restrict (marking a whole book
from Turf Cutting) is desk work, not a walk, so it never becomes a billable door; and a door that was
restricted by one canvasser and knocked by another is **one** door, counted as a knock.

None of this changes what **Doorline** charges you — that's a flat rate per active campaign per month
and never reads door counts at all ([BILLING.md](BILLING.md)).

## By round (the per-round breakdown)

The campaign dashboard's **By round** section breaks the Activity numbers down one level: one row
per **walk list × pass** (Round 1, Round 2, …), over the same date range as the Activity cards
above it. Each row shows that round's **Knocks**, **Survey doors** (**Lit drops** on a lit-drop
campaign), **Conn %**, and **New homes reached**, with a **TOTAL** row underneath. The same
per-pass numbers appear on each walk list's Passes panel, and the mobile admin campaign screen has
a matching **By round** card. Knocks recorded before rounds existed show as one **"Legacy / no
round"** row, listed last.

Because every row is counted by the same rule as the headline (one knock = one distinct house ×
round), **the rows always sum exactly to the campaign total** — the breakdown can never disagree
with the number it breaks down.

**New homes reached** = homes whose **first-ever knock of the campaign** landed in that round. A
Round-2 revisit of a Round-1 door adds a knock to Round 2 but **no** new home — so this column
shows what each round *added to coverage*, and over all time it sums to Houses knocked. (With a
date range set, the window applies to *when that first knock happened*.)

**The export.** The section's **Export CSV** button downloads the same table — one row per walk
list × round plus the TOTAL row — ready to check against an invoice, since billing is per knock
(see [BILLING.md](BILLING.md)). The endpoint can also break the rounds down **per canvasser**
(who did the work in each round) — see Part 2 §E.

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

**Two places show overlaps, and they scope differently.** The **Timeline's** overlap
reconciliation counts collisions **within the date range you're looking at** ("this window's raw
knocks vs. the deduped total") — so it can miss a collision whose two knocks landed on **different
days** of the same pass. The **map's Overlaps toggle** and a **door's detail panel** (⚠ Overlap)
take the other view: **the same pass, any day** — the *complete* picture of which doors more than one
canvasser worked in a pass, even across days. If you want the full list of collision doors, use the
map/panel; if you want to reconcile a specific day's or week's numbers, use the Timeline. See
[MAPS.md](MAPS.md) for the map toggle.

## Per-canvasser numbers (leaderboard & drilldowns)

- A canvasser has **at most one knock record per (house, pass)**, so a single canvasser's
  **Knocks** is exactly their distinct house-passes.
- Their **Connection rate** = their surveyed knocks ÷ their knocks (≤ 100%).
- The org **Knocks** is **less than or equal to** the sum of every canvasser's knocks: when two
  canvassers overlap on the same house-pass, each gets personal credit for the knock they made,
  but the org counts that house-pass once (we don't bill the client for the overlap).
- The **survey answer drill-in** (the Survey Explorer's By-canvasser table — "who recorded this
  answer?") is the same way, only stricter: those are **raw per-person entry counts**, never
  re-credited to a team. It's an **audit surface** — it answers "who pressed the button", not
  "whose team gets credit" — so it deliberately skips the team fold that the team-attribution
  reports apply. See [SURVEYS.md](SURVEYS.md) (Part 1 → *Auditing answers*; contract in §J).

---

# Part 2 — Technical reference

## A. Data model & the core invariant

Knock events live in their own collection; the household carries only its latest aggregate
status. The reporting reads these fields:

| Model | File | Fields that matter for metrics |
|---|---|---|
| `CanvassActivity` | [models/CanvassActivity.js](../server/src/models/CanvassActivity.js) | `householdId`, `userId`, `actionType` (`not_home`/`wrong_address`/`refused`/`restricted`/`survey_submitted`/`lit_dropped`/`note_added`), `passId` (nullable), `campaignId`, `organizationId`, `timestamp` |
| `Household` | [models/Household.js](../server/src/models/Household.js) | `status` (`unknocked`/`not_home`/`surveyed`/`wrong_address`/`refused`/`restricted`/`lit_dropped`), `isActive`, `campaignId`, `lastActionAt`, `lastActionBy` |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `voterId`, `householdId`, `userId`, `passId`, `campaignId`, `submittedAt` (one per voter **per pass**) |
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `roundNumber` (ordered, unique per campaign), `name`, `status`, `activatedAt` |
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | `surveyStatus` (`not_surveyed`/`surveyed`), `householdId` (required → voters are campaign-disjoint) |

**The core invariant (write path).** In [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js),
every knock submission first runs
`CanvassActivity.deleteMany({ userId, householdId, passId, actionType ∈ REPLACEABLE_ACTIONS })`
before inserting the new one (`REPLACEABLE_ACTIONS` = the five knock types **plus `restricted`** — so a
mistaken restricted mark is superseded by any later disposition on the same door/pass, and vice-versa). Therefore:

> **At most ONE `CanvassActivity` (knock) exists per `(userId, householdId, passId)`.**

This is why a canvasser's raw knock-event count *equals* their distinct house-pass count, and why
a same-canvasser same-pass correction never inflates anything. The survey route applies the same
household-scoped dedup, so a multi-voter house still yields exactly one `survey_submitted`
activity per (user, house, pass) — even though it produces multiple `SurveyResponse` rows.

`KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped']`
([services/reports/aggregations.js](../server/src/services/reports/aggregations.js)). `refused` is a
knock like the others (a billable door interaction). Two actions are deliberately **excluded**:
`note_added` (a note can be left without a visit decision) and **`restricted`** (an inaccessible-home
*marker* — no door interaction happened, so it is never a knock and never enters any rate). The
non-completion status precedence (`ACTION_TO_STATUS` / `statusPrecedence` in
[utils/statusPrecedence.js](../server/src/utils/statusPrecedence.js)) maps **both** `refused` and
`restricted` to same-named statuses, resolved last-write-wins — so a later refusal or restricted mark
can overwrite an earlier not-home on the same house-pass, but a survey still wins over either.

## B. Field dictionary

| API field | Meaning | How it's computed | Returned by | Date field |
|---|---|---|---|---|
| `knocks` | Billable knocks: distinct `(household, passId)` | `knocksPipeline` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyedKnocks` | Knocks (house-passes) with ≥1 `survey_submitted` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `litKnocks` | Knocks with ≥1 `lit_dropped` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `refusedKnocks` | Knocks (house-passes) whose outcome was `refused` — a billable contact, **not** a survey. Subset of `knocks` (survey campaigns only; 0 on lit) | `$max` flag (`hasRefused`) in `knocksPipeline` | `/overview`, `/campaign-rollup` (on `/canvassers` the per-canvasser count is the bare `refused` column, which feeds that row's `contactRate`) | `timestamp` |
| `restricted` | Per-canvasser tally of `restricted` (inaccessible-home) marks — **not** a knock, **never** in `knocks`/`homesKnocked`/any rate; its own coverage segment. All campaign types | count of that user's `restricted` activities | `/canvassers`, `/canvasser-timeline` (`dayRestricted`); coverage `canvass`/`events` on `/overview` · `/campaign-rollup` | `timestamp` |
| `restrictedDoors` | Distinct `(household, passId)` doors whose ONLY disposition is a **non-bulk** `restricted` mark. Disjoint from `knocks` by construction (a door with any knock is a knock). Reported **always**, billed or not, so the UI can offer the opt-in | `restrictedDoors` in `knocksPipeline` (`includeRestricted`) | `/overview`, `/campaign-rollup`, `/knocks-by-pass`, `/canvasser-timeline`, statement lines | `timestamp` |
| `billableDoors` | The org's own invoice figure: `knocks` + (`restrictedDoors` **iff** this campaign bills them). `=== knocks` when the opt-in is off, which is the default. **Never** a rate denominator | `billableDoorsOf(row, billRestricted)` (§C) over `knocksPipeline` | `/overview`, `/campaign-rollup`, `/knocks-by-pass` (+`.csv`), `/canvasser-timeline` | `timestamp` |
| `connectionRate` | `(surveyedKnocks + litKnocks) / knocks × 100`, integer, ≤100. **Unchanged by Refused** — refusals are not in the numerator | `connectionRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `contactRate` | "Reached a person": `(surveyedKnocks + refusedKnocks) / knocks × 100`, integer, ≤100 | `contactRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `surveysSubmitted` | Survey responses (one per voter/pass) — a volume count | `SurveyResponse.countDocuments` / `$sum` | `/overview`, `/campaign-rollup`, `/canvassers` | `submittedAt` |
| `surveyedVoters` | Distinct voters surveyed | distinct `voterId` in `SurveyResponse` | `/overview`, `/campaign-rollup` | `submittedAt` |
| `homesKnocked` | Org/campaign: distinct households `status ∉ {unknocked, restricted}` (inaccessible homes are **not** "knocked"). Per-canvasser: alias of `knocks` | `Household.countDocuments` (org) / `= knocks` (leaderboard) | `/overview`, `/campaign-rollup`, `/canvassers` | all-time (org) |
| `knockedPct` | `homesKnocked / households × 100` | derived | `/campaign-rollup` | all-time |
| `coverage` / `canvass` | Per-household current-status buckets (sums to households) | `Household.aggregate` group by `status` | `/campaign-rollup` (`coverage`), `/overview` (`canvass`) | all-time |
| `litDropped` | Lit-drop **events** (volume) | `CanvassActivity` count of `lit_dropped` | `/overview` (`events`), `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyKnocks` | Per-canvasser surveyed knocks (rate numerator) | count of that user's `survey_submitted` activities | `/canvassers` | `timestamp` |
| `activeCanvassers` | Distinct `userId` with activity in range | `CanvassActivity.distinct('userId')` (**not summable**) | `/overview` (`activeUsers`), `/campaign-rollup` | `timestamp` |
| `coverageGained` | "New homes reached": households whose **first-ever** campaign knock landed in that round. Σ over all rounds (unwindowed) = the campaign's distinct knocked-door coverage | first-knock-per-household aggregation in `buildKnocksByPass` (§E) — lifetime scan, then the date window narrows to first-knocks that happened inside it | `/knocks-by-pass` (+ `.csv` as `New homes reached`) | `timestamp` (of the *first* knock) |

## C. Core aggregation

`knocksPipeline(match, { byCampaign, byPass })` in
[services/reports/aggregations.js](../server/src/services/reports/aggregations.js) — the single
source for knocks and the rate numerator:

```js
[
  { $match: { ...match, actionType: { $in: KNOCK_ACTIONS } } },
  { $group: {
      _id: { householdId: '$householdId', passId: '$passId' /*, campaignId when byCampaign */ },
      hasSurvey: { $max: { $cond: [{ $eq: ['$actionType', 'survey_submitted'] }, 1, 0] } },
      hasLit:    { $max: { $cond: [{ $eq: ['$actionType', 'lit_dropped'] }, 1, 0] } },
  } },
  { $group: {
      _id: byCampaign ? '$_id.campaignId' : byPass ? '$_id.passId' : null,
      knocks: { $sum: 1 }, surveyedKnocks: { $sum: '$hasSurvey' }, litKnocks: { $sum: '$hasLit' },
  } },
]
```

The first `$group` collapses each `(household, pass)` to one row (the billable unit) and flags
whether it landed a completion action; the second tallies.

**`byPass: true` promotes the inner group's `passId` to the outer `_id`** — one row per round.
The inner `(household, pass)` dedup is identical either way, so **Σ(byPass rows) equals the
collapsed campaign total by construction** — per-round numbers can never disagree with the
headline they break down. `passId: null` surfaces as one legacy bucket (`_id: null`).

The same `$max`/`$group` also flags `hasRefused` and sums it to `refusedKnocks` — the count of
house-passes whose outcome was Refused (one per billable knock, so a subset of `knocks`).

**`restricted` never becomes a knock.** By default the opening `$match` filters to `KNOCK_ACTIONS`,
which excludes it. Callers that need billable-door numbers pass `includeRestricted: true`, which
widens the `$match` to `BILLABLE_WITH_RESTRICTED`, drops desk-authored bulk restricted rows, and
adds a `hasKnock` fold to the inner `$group`. That fold is what keeps the guarantee: `knocks` becomes `$sum: '$hasKnock'`
instead of `$sum: 1`, which is the **same value** — so restricted marks still touch neither `knocks`
nor any rate numerator/denominator, in either mode. The wider run additionally yields:

- `billableDoors` (`$sum: 1`) — every door in the dedup, knocked or restricted.
- `restrictedDoors` — doors where `hasKnock === 0`, i.e. restricted-only.

Because the `(household, passId)` dedup is untouched, a door that one canvasser restricted and
another knocked is **one** door and lands in `knocks`, and `Σ(byPass rows)` still equals the campaign
total by construction for the new columns exactly as it does for `knocks`.

The bulk exclusion is `$nor: [{ actionType: 'restricted', via: 'bulk' }]` — **scoped to restricted
rows, never a blanket `NOT_BULK`**. A desk-authored bulk restrict is not a walk and must not be
billed; but a `via:'bulk'` row on a *knock* action is a real billable knock that round totals are
contractually required to include (only per-CANVASSER surfaces exclude bulk), so a blanket filter
would silently delete a door from the invoice. That is not hypothetical — it is asserted by
`knocksByPass.int.test.js`, which caught exactly this mistake. `$nor` rather than a top-level `$or`
so it can never clobber an `$or` the caller put in `match` (the team/crew filters do).

`Campaign.stats.restrictedDoorCount` denormalizes the same number for the no-date-window counter
fast path. **Turning the policy on recomputes the affected campaigns' stats** — the campaign PATCH
recomputes that campaign, the org-level `PATCH /admin/billing/settings` recomputes every campaign
that *inherits* the default (`billRestrictedDoors: null`, which in Mongo also matches the field
being absent). This is not tidiness: a campaign created before this feature has **trusted** stats
(`reconciledAt` set) that simply have no `restrictedDoorCount`, so without the recompute the
counter-backed `/overview` would report `billableDoors = knocks` while the live-aggregated invoice
export reported the real, higher number — the toggle would look broken on one screen and correct on
another. Self-healing on the write beats a deploy-time migration nobody remembers to run first.

Whether `restrictedDoors` actually counts is then decided in exactly one place,
`billableDoorsOf(row, billRestricted)`, so `restrictedDoors` means "how many exist" on every surface
rather than "how many are billed" on some and "exists" on others. The policy itself resolves
campaign-override → org-default → `false`
([billRestricted.js](../server/src/services/reports/billRestricted.js)); an org-wide rollup resolves
it **per campaign**, since a rollup can span campaigns that answer differently.

The coverage funnel keeps `restricted` as its own status bucket in all cases, and the per-canvasser
tally remains a straight count of `restricted` activities.

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

### The TWO overlap surfaces: the windowed reconciliation vs the pass-wide indicator

Two functions in [overlaps.js](../server/src/services/reports/overlaps.js) answer the **same question**
("which doors did 2+ distinct canvassers knock in the same pass?") for **two different jobs**, and they
scope differently on purpose:

| | `computeOverlaps` → `/overlaps` + `/canvasser-timeline` | `computeOverlapDoors` → `/overlap-doors` |
|---|---|---|
| **Job** | Event-level **reconciliation** — reconcile the Timeline's raw Σ-per-canvasser knocks against the deduped billable count, and list the colliding events (who, when, which action) | The map / household-panel **indicator** — ring the collision doors and name who else worked them |
| **Date scope** | **Date-WINDOWED** — the caller passes the same `[from, to)` window as the dashboard ("collisions within the selected range") | **ANCHORED** *(changed 2026-07-19)* — detects across the **whole pass**, surfaces a collision when **≥1 of its knocks lands in the window**; ones with none come back as `outOfRangeTotal` |
| **Cost** | Heavy: `$push`es every colliding event into per-door arrays, so it's bounded to the window (and skipped entirely in the campaign-to-date `totals` mode — a whole campaign can breach Mongo's 100MB per-stage limit) | Cheap: one row per (household, pass, **canvasser**) carrying `$max` timestamp — **no** `$push`, so cost is bounded by distinct triples, not knock volume. This is why it can span a pass and the windowed one cannot |
| **Returns** | `{ overlaps[], total, householdIds, overlapUserIds }` — cards + the pre-cap reconciliation counts | `{ householdIds, doors[{ householdId, passes[{ passId, roundLabel, canvassers[{userId, name, lastAt, inRange}] }] }], total, outOfRangeTotal }` — ids + who + **when**, no addresses |

**Why the windowed one exists at all** — and why it isn't just the pass-wide set filtered to a range:
the Timeline reconciliation is an **event-level** audit (it must show *which knock* collided, when, and
by whom), and that per-event `$push` is what makes it memory-bound, so it has to be scoped to a window.
The pass-wide indicator carries none of that event payload, so it can afford to be un-windowed.

**The consequence to remember:** a same-pass overlap is a fact about the **pass**, not a calendar range,
so **two knocks days apart in one pass still collide** — but the windowed `/overlaps` (and the Timeline
reconciliation built on it) **can only see collisions whose events both fall inside the selected date
window**, so it **silently misses cross-day same-pass overlaps**. `/overlap-doors` is the one that
catches those, and since 2026-07-19 it does so **while still respecting the map's dates** via anchoring:
a door knocked on the 5th and again on the 11th surfaces while you are viewing the 11th, with the 5th
knock named and dated (`inRange:false`) so the admin can see *who* they collided with. Collisions with
no knock in the window are counted in `outOfRangeTotal` and shown as a "+N outside your dates" hint —
they are never silently dropped. Anchoring is **not** applied to `computeOverlaps`: its per-event
`$push` would then span the whole pass on every request and inherit exactly the 100MB hazard that
`totals` mode exists to avoid. Neither affects billing: an overlap is never
double-billed (one knock per household × pass), so both surfaces are coach-and-coordinate signals, not
money. See [MAPS.md](MAPS.md) (the Overlaps toggle + the ring layer) for the map side.

### The survey dual-ledger no longer double-lists in the door activity feed

A survey writes to **both** ledgers on purpose — a `survey_submitted` `CanvassActivity` **and** a
`SurveyResponse` (the door-unit vs voter-unit split; see the dual-ledger note in §F and
[SURVEYS.md](SURVEYS.md)). The door-detail **History by pass/round** feed
(`GET /admin/households/:householdId/activity`, powering the web `HouseholdDetailPanel` and the mobile
map sheet) reads **both** ledgers, so a naïve merge listed every survey **twice** — once as a knock
entry, once as the survey entry. It now emits **one entry per survey**: the `survey_submitted`
`CanvassActivity` line is **suppressed when a matching `SurveyResponse` exists** for the same
door + pass + canvasser (the `SurveyResponse` line is the richer one — it names the voter), and kept
only if genuinely orphaned (legacy/partial data). This is a **display de-dupe in the activity feed
only** — both ledger rows still exist and every count query is unchanged (nothing sums both ledgers;
GPS/door audits read `CanvassActivity`, survey/voter counts read `SurveyResponse`). The feed's overlap
badge counts distinct canvassers per pass across those de-duped entries, so a single canvasser's survey
never looks like a two-person collision.

## E. Endpoint reference

| Endpoint | Scope | Key returns | Range basis |
|---|---|---|---|
| `GET /admin/reports/overview` | one campaign or org-wide | `totals{ households, voters, activeUsers, surveysSubmitted, surveyedVoters, homesKnocked, knocks, surveyedKnocks, litKnocks, refusedKnocks, connectionRate, contactRate }`, `canvass{}` (incl. `refused`, `restricted`), `events{}` (incl. `refused`, `restricted`) | **all-time** (no `from/to`) |
| `GET /admin/reports/campaign-rollup` | `scope=active\|archived\|all` or `campaignId` | `cumulative{…}` + `campaigns[ row{ households, homesKnocked, knockedPct, knocks, surveyedKnocks, litKnocks, refusedKnocks, surveysSubmitted, surveyedVoters, litDropped, connectionRate, contactRate, activeCanvassers, coverage{} } ]` | activity on `timestamp`, surveys on `submittedAt`; households/coverage all-time |
| `GET /admin/reports/canvassers` | leaderboard | rows `{ surveysSubmitted, surveyKnocks, notHome, wrongAddress, refused, restricted, litDropped, knocks, homesKnocked(=knocks), connectionRate, contactRate, status, hoursOnDoors, daysActive, doorsPerHour, coordinatorId, coordinatorName ('Multiple' when the window spans two teams — resolved from the LEDGER via the shared ledgerCoordinatorLabels, same as the timeline, so the Home leaderboard and the Timeline cannot disagree about a person's team), … }` (per-canvasser refused is the bare `refused` field, not `refusedKnocks`, and feeds `contactRate`; `restricted` is a standalone tally that feeds **no** rate. **`hoursOnDoors`/`doorsPerHour` are computed here as the SUM OF PER-DAY spans** — clients must not re-derive them from `firstActivityAt`/`lastActivityAt`, which is a *calendar* span and under-reports pace ~3×) | activity `timestamp`, surveys `submittedAt` |
| `GET /admin/reports/team-breakdown` | every TEAM at once, with the reconciliation | `{ ready, teams[{ coordinatorId, coordinatorName, people, doors, surveyDoors, votersSurveyed, connectionRate, contactRate }], campaign{ doors, surveyDoors, connectionRate, … }, teamSum, crossTeamDoors }`. `coordinatorName: null` = the **No team** bucket. `doors` is distinct `(household, pass)` **within** a team, so a same-team double-knock is absorbed. **`ready: false`** when `Organization.teamAttributionReadyAt` is unset (the backfill hasn't run) — the endpoint returns empty rather than report every team as ~0 and No-team as enormous, which would look like data instead of an error. | `timestamp` |
| `GET /admin/reports/canvassers.csv` | leaderboard export | columns incl. `Knocks`, `Connection rate %`, **`Refused`**, **`Restricted`** | same |
| `GET /admin/reports/team-averages` | org averages | `avg{ homesKnocked, surveysSubmitted, connectionRatePct, doorsPerHour, … }` (rate = Σ completion knocks / Σ knocks) | same |
| `GET /admin/reports/canvassers/:id/summary` | one canvasser | `kpi{ homesKnocked(=knocks, **refused included** — it once wasn't, so this panel read fewer doors than the Timeline for the same person and over-stated the rate), surveyDoors (door-unit, the rate numerator), surveysSubmitted (voter-unit), refused, connectionRatePct + contactRatePct (the **shared** `connectionRate()`/`contactRate()` helpers, integer %), doorsPerHour, … }` | same |
| `GET /admin/reports/canvassers/:id/daily` | one canvasser, per day | `days[{ homesKnocked, surveyKnocks, surveysSubmitted, connectionRatePct, … }]` | same |
| `GET /admin/reports/knocks-by-pass` | one campaign, **per round** (`campaignId` REQUIRED — 400 without it; optional `effortId`, `from`/`to`) | `{ campaignId, timeZone, from, to, rounds[], totals{}, byCanvasser?, crossCanvasserDoors? }`. Each `rounds[]` row: `{ passId (null = legacy), effortId, effortName, roundNumber, roundName, roundLabel ("Pass N · name" \| "Legacy / no round"), status, activatedAt, archivedAt, knocks, surveyedKnocks, litKnocks, refusedKnocks, connectionRate, contactRate, coverageGained }`. Row set = **every Pass** of the campaign/effort (0-knock rounds are real information) + any agg bucket without a Pass doc (legacy `passId:null`, or a deleted pass); sorted walk list asc → round asc, legacy last. Everything is live aggregation via `knocksPipeline` — the round-blind `Campaign.stats` fast-path is never used here. **The contract: `Σ(rounds[].knocks) === totals.knocks`** (same for the survey/lit/refused tallies) — both run the same pipeline over the same match (`byPass` vs collapsed), so the rows always sum exactly to the headline (rates in `totals` are recomputed from the summed counts, not averaged). `coverageGained`: first-ever knock per household is found over the campaign **lifetime** (no date filter), then the window narrows to first-knocks that happened inside it — a re-knocked door credits only its first round. **`?groupBy=canvasser`** adds `byCanvasser[]`: **RAW per-user per-round rows — `NOT_BULK`, never team-folded** (the audit convention, like the answer drill: "who pressed the button", not "whose team gets credit"; admin bulk marks are excluded). A door two canvassers both knocked in the same round counts once for the round but once per canvasser; the over-claim is `crossCanvasserDoors` = Σ(per-canvasser knocks) − the NOT_BULK round totals (the `/team-breakdown` convention — computed against a NOT_BULK total so bulk marks can't masquerade as cross-canvasser overlap). | `timestamp` |
| `GET /admin/reports/knocks-by-pass.csv` | the invoice-ready export (same params) | Same builder (`buildKnocksByPass`) as the JSON, so report and export can't drift. **Default:** one row per walk list × round + a **TOTAL** row — columns `Walk list, Round, Round name, Round status, Activated (ISO), Archived (ISO), Knocks, Survey doors, Lit knocks, Refused, Connection rate %, Contact rate %, New homes reached`. **`?groupBy=canvasser`:** per-user per-round rows (`Walk list, Round, Round name, Canvasser first/last name, Email, Status, Knocks, Survey doors, Lit knocks, Refused, Connection rate %, Contact rate %`) — **no coverage column** (first-ever-knock coverage has no honest per-canvasser attribution) and no TOTAL row (the rows over-claim by `crossCanvasserDoors`, by design). `text/csv` attachment `knocks-by-pass-YYYY-MM-DD.csv`. | same |
| `GET /admin/reports/overlaps` | overlap review (date-**windowed**, event-level) | see §D | `timestamp` |
| `GET /admin/reports/overlap-doors` | the map's overlap **indicator + review list** (**anchored** to the window) | `{ householdIds:[…], doors:[{ householdId, passes:[{ passId, roundLabel, canvassers:[{userId, name, lastAt, inRange}] }] }], total, outOfRangeTotal }`. Params: `campaignId` **required** (400 without — unscoped it would scan the org ledger), optional `effortId`/`passId`/`userId`/`from`/`to` (`computeOverlapDoors` — see §D). Lead-gated. | anchored: detected pass-wide, surfaced when ≥1 knock is in `[from, to)` |
| `GET /admin/reports/duplicate-surveys` | voters with >1 survey response | `duplicates[{ voter, household, responses[{ canvasser, submittedAt, roundLabel }], sameCanvasserSameDay, differentCanvassers }]` | `submittedAt` |
| `GET /admin/reports/canvasser-timeline` | one campaign, one **day** (`?date=`, the mobile path), a **range** (`?from/&to`, max 62 days; missing `to` = today), or **campaign-to-date** (`?totals=1`, no bounds) | `mode:'day'`: `{ date, hours[], hourTotals{} }` shape (byte-compatible for mobile); `mode:'range'`: `{ days[], dayTotals{} }` with per-canvasser `knocksByDay/surveysByDay`; `mode:'totals'`: **neither** — no bucket maps, no `days[]`, `range:{from:null,to:null}`, `overlapsOmitted:true`. All three: `{ range{from,to}, tz, canvassers[{ knocksByHour\|knocksByDay, …, dayKnocks, daySurveys, dayLit, dayRestricted, refused, restricted, notHome, wrongAddress, status, isActive, firstActivityAt, lastActivityAt, hoursOnDoors, doorsPerHour, connectionRate, contactRate, inOverlap }], grandKnocks, billableKnocks, overlapDoors, overlaps[] }`. `dayKnocks/daySurveys/dayLit` are the WINDOW totals in every mode; `dayRestricted` is a parallel **Restricted** tally never in `dayKnocks`. `hoursOnDoors` = Σ per-day (last−first), same method as `/canvassers/:id/summary` — **restricted stops are in this window** (`[...KNOCK_ACTIONS, 'restricted']` matched for the span, then knocks exclude restricted), so a restricted-only bucket extends shift-hours without adding a knock (the heatmap grid, which shows knocks only, skips it). | `timestamp` window in campaign tz; buckets via `$hour` (day) / `$dateToString` (range and totals) |

### The 62-day cap, and why `totals` escapes it

The cap exists to bound the **grid's columns** — a range renders one column per day — **not** the
aggregation. So `?totals=1` lifts it by shipping no grid: no `knocksByDay`, no `days[]`, no hour
maps. Everything else is unchanged, and it is the only way to see a whole campaign, which is the
only way to see **every canvasser who ever worked it** — including the ones who have since left.

Three invariants, each of which a plausible "simplification" would break:

- **It still buckets BY DAY internally.** Grouping on `userId` alone would make `hoursOnDoors` equal
  *(last knock ever − first knock ever)* — weeks, not hours — and collapse `doorsPerHour` to ~0.
  Because it keeps the day bucket, every per-canvasser number in `totals` mode is **by construction**
  the exact sum of its range-mode buckets. `test/timelineTotals.int.test.js` asserts that field by
  field.
- **Per-canvasser knocks are NOT `knocksPipeline`.** The endpoint runs two aggregations: a
  `$group` on `{userId, bucket}` (raw row counts → the per-canvasser numbers) and
  `knocksPipeline(scoped)` (dedupes by `(householdId, passId)`, collapses **across users**, `_id:null`
  → the campaign-wide `billableKnocks`). `knocksPipeline` has **no `userId` dimension**. Per-canvasser
  knocks are raw counts and *legitimately exceed* `billableKnocks` when two canvassers work the same
  door in the same pass — that's the overlap-never-double-bills design, reconciled by `overlapDoors`.
  Routing per-canvasser counts through `knocksPipeline` would silently rewrite everyone's numbers;
  the test seeds a deliberate overlap and asserts `grandKnocks > billableKnocks` to catch it.
- **Overlaps are skipped in `totals`.** `computeOverlaps` `$push`es every event into per-door arrays,
  which over a whole campaign can breach Mongo's 100MB per-stage limit. The overlap **door count**
  (`overlapDoors = grandKnocks − billableKnocks`) is pure arithmetic and stays honest; only the
  per-door reconciliation **cards** need a bounded window. `overlapsOmitted:true` says so, so a client
  never implies a campaign had zero overlaps.

**Cumulative summability:** `households`, `homesKnocked`, `knocks`, `surveyedKnocks`,
`litKnocks`, `refusedKnocks`, `surveysSubmitted`, `surveyedVoters`, `litDropped` (and the coverage
`restricted` tally) are summed across campaigns (households/voters are campaign-disjoint, so the
distinct counts don't overlap). Cumulative
`connectionRate` **and** `contactRate` are recomputed from the summed numerator/denominator (not
averaged). `activeCanvassers` is **not** summable — it uses a separate org-wide `distinct('userId')`.

## F. Invariants & edge cases

### Teams (coordinators) — the counting contract

**The team is FROZEN ON THE KNOCK.** `CanvassActivity.coordinatorId` and
`SurveyResponse.coordinatorId` record the canvasser's coordinator **at the moment they knocked**,
stamped by [canvass.js](../server/src/routes/mobile/canvass.js) from `req.activeMembership` (already
loaded by `orgContext`, so it costs zero extra queries).

It used to be joined at read time from the **campaign roster**, which caused two failures:
- Taking a canvasser off a campaign deleted their `CampaignAssignment`, so the join missed and their
  doors silently fell into **"No coordinator"** — the bucket admins deliberately *exclude* when
  reporting a team's number to a client. On the live HD54 campaign this under-reported one team by
  **104 doors**.
- Moving anyone between teams **retroactively rewrote history**, so a figure quoted to a client last
  month stopped reconciling.

Freezing also fixes the twin: a canvasser removed from the **org** has no `Membership` at all, so any
read-time fix would still lose them. On the ledger, their history is immune to everything.

**`null` is a real answer, not "unknown"** — a candidate knocking their own district belongs in the
No-team bucket. Never backfill over an explicit null (see the migration note below).

#### How a team's numbers are computed

**Billing is team-blind and unchanged:** a billable knock is one distinct `(householdId, passId)`.
Two canvassers on one house in one round = **1**. The same house in round 2 = **2**.

**A team's doors are that same pipeline, run over that team's knocks** —
`knocksPipeline({ ...scope, ...teamMatch })`. Because it already groups by `(household, pass)`, a
house that **two of the same team's own people** double-knocked collapses to **one door inside that
team's number, automatically**. No tie-breaking rule is needed.

**The reconciliation** (asserted by `test/teamAttribution.int.test.js`):

```
Σ teams  +  "no team"  −  crossTeamDoors  ==  campaign billable      (exactly)

crossTeamDoors = (Σ per-team doors) − campaignBillable
```

A door-pass worked by *k* teams contributes *k* to the team sum and 1 to the campaign, so the
difference **is** the over-claim. It costs nothing to compute — the same arithmetic as
`overlapDoors = grandKnocks − billableKnocks`.

> ⚠️ **The subtraction is CROSS-team double-knocks only — NOT the overlap count on screen.**
> `computeOverlaps` flags a door-pass touched by **2+ distinct `userId`s, not 2+ distinct teams**. A
> house double-knocked by two people on the *same* team is one of those overlaps, yet that team
> claims it only **once** (their own dedupe absorbed it), so nothing should be subtracted for it.
> Subtracting the on-screen overlap count would land you **under**. Two teams should never share
> doors, so `crossTeamDoors` is normally **0** — surface it when it isn't; never hide it.

> ⚠️ **A team lead's OWN doors.** `coordinatorId` answers *"who oversees me"*, so a lead's own knocks
> stamp *their* coordinator (usually nobody) and would fall into the No-team bucket — the lead
> missing from their own team. Every team clause folds them back in:
> `{ $or: [ {coordinatorId: X}, {userId: X, coordinatorId: null} ] }`, and the No-team bucket
> excludes all leads so nobody is counted twice.

> 🚨 **The team filter must NOT live in `baseFilter()`.** That result is spread into **Household**
> queries (`/overview`: `{ isActive: true, ...cFilter }`), and a household has no team — a door
> doesn't belong to a crew. Putting the key there matches zero households and **zeroes out
> Coverage**. `effortId` only survives in `baseFilter` because it *is* denormalized onto Household.
> Use the opt-in `crewFilter(req)` / `withTeam(match, team)`, spread only into activity/survey
> matches. `withTeam` composes with `$and` — never spread a `$or` team clause into a match that may
> already carry one.

> 🚨 **The backfill keys on `{ coordinatorId: { $exists: false } }`, never `{ coordinatorId: null }`.**
> In Mongo `{field: null}` **also matches documents where the field is absent**, so a null key would
> re-stamp *deliberate* nulls on a second run and hand the candidate's doors to a team — the
> migration would reintroduce the very bug it exists to fix. And because an unstamped row is
> invisible to `coordinatorId: <team>` while being swallowed by the No-team bucket, a **half-run
> backfill shows every team at ~zero and No-team enormous** — which looks like data, not an error.
> Hence `Organization.teamAttributionReadyAt`: the team surfaces refuse to render until it's set.
> Deploy order is not a safeguard; a gate is.

**Coverage is never team-scopable.** It's a property of `Household.status`, and a household has no
team.

### Survey DOORS vs survey VOTERS (they are different numbers)

| Number | Source | Meaning |
|---|---|---|
| **Survey doors** | `CanvassActivity.survey_submitted` (`surveyKnocks` / `daySurveys`) | doors where ≥1 survey was taken — **the connection-rate numerator** |
| **Voters surveyed** | `SurveyResponse` rows (`surveysSubmitted` / `dayVoterSurveys`) | people surveyed — one door can survey several |

`connectionRate = (surveyedKnocks + litKnocks) ÷ knocks` — **doors, not voters**. Live check: 273 ÷
1,252 = 22% (voters would give 297/1,252 = 24%, which is not what the app shows).

Both are correct; the dual ledger is deliberate (see [SURVEYS.md](SURVEYS.md)). But they were both
labelled "Surveys" on different pages, so the same canvasser read 143 on the Timeline and 147 on
Home, and the Home KPI row showed **neither** the number its own connection rate divides by.
(`Surveys` and `Surveyed voters` were also *structurally identical* in a single-round campaign — the
unique index on `{voterId, passId}` allows one response per voter per pass — so one card was always
redundant.)

**The labelling rule, applied everywhere a stat renders:** the door-unit shows as **"Survey doors"**
and the voter-unit as **"Voters surveyed"** — never a bare "Surveys" next to a number. Swept across:
Home/Dashboard, the Timeline + `CanvasserSummaryTable`, the Team member panel, the org **Overview**
(whose old KPI row rendered the *same voter count twice* under two labels), `TeamBreakdown`, the
campaigns card/table, the org user profile (web modal + mobile), the mobile org dashboard + campaign
detail + canvasser detail/compare/day screens, the super-admin Today card, and the **canvasser's own
My Stats** (voter count beside a door-unit rate — a deep-surveying canvasser read "37 surveys · 95%"
and reasonably concluded the math was broken). The only bare "Surveys" left are non-stat labels: the
Knocks|Surveys heatmap **view toggles**, the survey-template **library** page/nav, and an activity
**filter chip** — none of them sit next to a number in a different unit.

### A live page's pill must answer for EVERY number under it

The Timeline, Map, Audit and Control Room auto-refresh behind a **"Live · updated Xs ago"** pill.
The rule, enforced by [`client/src/lib/livePoll.js`](../client/src/lib/livePoll.js):

- every query that renders a **count** on a live page spreads `livePollOptions(live, includesToday)`;
- the pill is built with `liveStatusProps([...every one of those queries])`, so it reports the
  **oldest** of them and its Refresh button refetches **all** of them.

**Both halves are load-bearing.** The by-team table shipped with no `refetchInterval` while the
canvasser table beside it polled every 20s — so a live knock moved one number and not the other. That
alone is a nuisance. What made it a *wrong number* is that the pill read only the polling query's
`dataUpdatedAt` and therefore announced "updated 3s ago" over a team total that was minutes stale: an
admin quoting it to a client had no way to know. **A stale number labelled stale is a nuisance; a
stale number labelled fresh is a lie.** (The global default is `refetchOnWindowFocus: false`, so a
query with no interval is frozen until its key changes — there is no accidental safety net.)

`refetchIntervalInBackground: false` everywhere: a console left open in a background tab must go
quiet. Home (`DashboardPage`) has no pill — it polls unconditionally at 30s — but routes through the
same helper so it inherits that pause.

### `hoursOnDoors` is a sum of per-DAY spans

Never `(lastActivityAt − firstActivityAt)` — that is a **calendar** span. The Dashboard derived its
own hours that way and divided a week's doors by a week of wall-clock, under-reporting pace ~3×
(4.9 doors/hr where the truth was 13.7). `/canvassers` now returns `hoursOnDoors` and `doorsPerHour`
computed the same way the timeline and the CSV do; **clients must not re-derive them.**

- **A knock is a historical fact. Staffing changes never move a number.** Deactivating a canvasser,
  removing them from a campaign, removing them from the org, or deleting their account **does not
  change a single count** — not the campaign totals, not the leaderboard, not the invoice. Whether
  someone can still log in is an *authorization* question; what they already did is a *ledger*
  question, and the two are deliberately unrelated.

  This holds because **every per-canvasser metric is ledger-first**: it aggregates
  `CanvassActivity`, takes its row set from *the activity's* `userId`s, and only then joins out to
  `User` for a name — never the reverse, never with a filter, never with a `$lookup`. See the shape
  at [`services/reports/canvasserIdentity.js`](../server/src/services/reports/canvasserIdentity.js)
  (`hydrateCanvassers`), which every canvasser-facing report uses so they cannot drift:

  ```js
  const userIds = [...byUser.keys()];              // ← the LEDGER decides who is on the report
  const uMap = await hydrateCanvassers(userIds, orgId);   // ← decoration only; NEVER filters
  const rows = userIds.map((uid) => ({ ...byUser.get(uid), ...uMap.get(uid) }));
  ```

  A row therefore survives even if the `User` document is gone entirely. Account deletion
  ([`deleteAccount.js`](../server/src/services/users/deleteAccount.js)) *scrubs the user row in
  place* rather than removing it, precisely so the ledger's `required` `userId` still resolves.
  `test/timelineTotals.int.test.js` seeds a canvasser who is deactivated **and** off the campaign
  roster and asserts every one of their knocks is still counted and attributed.

- **`status` vs `isActive` — two different `isActive` flags, and the reports use the composite.**
  `Membership.isActive` is what the admin **Deactivate** button writes. `User.isActive` is written by
  **nothing except terminal account deletion**, so on a live database it just means *"not deleted"*.
  Reports used to return the latter and label it "active", which meant the flag never went false for
  someone an admin had actually deactivated. They now return a `status` of
  `active` | `deactivated` | `removed` (no membership row — org removal hard-deletes it) | `deleted`,
  with `isActive` kept as the boolean shorthand (`status === 'active'`). **This is a label, never a
  filter** — no report hides anyone by default.

- **`useCampaignTeam` returns two lists on purpose.** `members` = who you may *assign* work to
  (deactivated people excluded; the server refuses them anyway, so offering them in a picker only
  earns a 409 from `partitionAssignable`). `allMembers` = the full roster whatever their standing —
  **reports join against this**, so a coordinator label or a roster headcount does not blink out the
  moment somebody is deactivated while their knocks are still on the page.

- **"Knocking N of M"** — M is the current roster **∪ everyone with activity in the range**, not the
  roster alone. Someone who worked the campaign and then quit is *deleted from the roster*, so
  counting only the roster erased them from **both** numbers: a campaign whose crew had turned over
  read "1 of 1" with four people's work sitting in the table below it. The union also keeps `N ≤ M`
  by construction (every knocker is in M). N counts people who actually **knocked** — a
  restricted-only row has activity but no knock.

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
- **Restricted is a marker, never a knock (all campaign types) — the inverse of Refused.** `restricted`
  is deliberately **out of** `KNOCK_ACTIONS`, so an inaccessible-home mark never counts in `knocks`,
  `homesKnocked` (`status ∉ {unknocked, restricted}`), `connectionRate`, `contactRate`, or the
  doors/hour numerator. It is surfaced as its **own tally** everywhere a canvasser's stats appear
  (`restricted` on `/canvassers`, `dayRestricted` on `/canvasser-timeline`, the CSV **Restricted**
  column, "My Stats", memberships, platform counts) and as its **own coverage segment** (in the
  household universe, not "knocked"). It **is** counted toward shift-hours (a restricted stop's
  timestamp extends the first→last window, so doors/hour can dip slightly — intentional), the
  GPS/distance audit, activity feeds, and active-now/hasCanvassed. It's in `REPLACEABLE_ACTIONS`, so
  re-recording any other disposition on the same door/pass supersedes it.
- **…but it CAN be a billable door, if the org opts in.** Never a knock and never in a rate — but an
  org that invoices its client per door can count the walk. See **Billable doors** below. The two
  ideas are separate on purpose: `knocks` answers "how many doors did we work", `billableDoors`
  answers "how many doors do we charge for", and only the second is configurable.
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
  dedicated **`voted`** coverage bucket (`coverageBucketExpr` in aggregations.js — now a `$switch`
  with the **`dnc` branch first**: a fully-do-not-contact door buckets as `dnc` even if also
  fully-voted, so the two synthetic segments never double-count). It still counts in
  **Households**; `homesKnocked`/knocks are unaffected. Only otherwise-`unknocked` doors move — a
  door knocked before it went fully-voted keeps its knocked status. See [docs/EARLY_VOTING.md](EARLY_VOTING.md)
  and, for `Household.fullyDnc`/`Voter.doNotContact`, [docs/VOTERS.md](VOTERS.md). DNC changes NO
  knock/billing number — flags are forward-looking only, the ledger is never rewritten.

## G. Frontend mapping

Shared rate tiers (green ≥20% / amber 10–19% / red <10%): web
[client/src/lib/rates.js](../client/src/lib/rates.js) (`rateLevel`/`rateAccent`/`ratePct`),
mobile [mobile/lib/rates.js](../mobile/lib/rates.js) (`rateFromPct` for the server pct;
`getConnectionRate` for the personal raw-event screens; `RATE_COLORS`).

Shared live-refresh contract: [client/src/lib/livePoll.js](../client/src/lib/livePoll.js)
(`livePollOptions` into **every** count query on a live page, `liveStatusProps` so the pill answers
for all of them — see the gotcha in §F).

### Web ([client/src](../client/src))
| File | Renders |
|---|---|
| [pages/OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) | Org Overview. `DateRangeSelector` → `/campaign-rollup?scope=active`. Cumulative `CoverageBar` + StatCards (Households, Houses knocked, **Knocks**, Surveys, **Surveyed voters**, **Connection rate**, Lit drops, Active canvassers). Per-campaign `CampaignCard` rows + `CoverageBar`; archived rows show Knocks. |
| [pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Campaign detail. **Activity** (range, `/campaign-rollup?campaignId`): Knocks, Surveys/Lit, Surveyed voters, Connection rate. **By round** (range, `/knocks-by-pass` — same window + effort filter as Activity, so the rows sum to the same headline): walk list × round table (Knocks, Survey doors/Lit drops, Conn %, New homes reached) + TOTAL `tfoot` + **Export CSV** (`/knocks-by-pass.csv`, raw fetch + blob — the SurveyExplorer pattern); hidden while `rounds` is empty. **Coverage** (all-time, `/overview`): households + homesKnocked + `CoverageBar`. |
| [components/PassManager.jsx](../client/src/components/PassManager.jsx) | Per-pass table (both mounts — PassesPage full view + Walk Lists drawer): **Knocks, Survey doors** (**Lit drops** on lit-drop campaigns — `campaignType` prop threaded from PassesPage/EffortsPage), **Conn %** from the enriched `GET /admin/campaigns/:id/passes` (see [PASSES.md](PASSES.md)). |
| [components/CanvasserTable.jsx](../client/src/components/CanvasserTable.jsx) | Leaderboard table: Surveys, Lit drops, Not home, Wrong addr, **Knocks**, **Connection**, Last activity. |
| [components/CoverageBar.jsx](../client/src/components/CoverageBar.jsx) | Segmented bar + numeric legend (counts + %). |
| [components/StatCard.jsx](../client/src/components/StatCard.jsx) | `label / value / hint / accent`. |
| [pages/TimelinePage.jsx](../client/src/pages/TimelinePage.jsx) + [components/CanvasserSummaryTable.jsx](../client/src/components/CanvasserSummaryTable.jsx) + [components/TimelineGrid.jsx](../client/src/components/TimelineGrid.jsx) + [components/TimelineOverlaps.jsx](../client/src/components/TimelineOverlaps.jsx) | **Timeline** (`/campaigns/:id/timeline`, `/canvasser-timeline`): live performance dashboard — KPI strip (Doors, Surveys, Connection rate, Doors/hr, Knocking N of M), sortable per-canvasser table (coordinator, rates, pace, start/last door, a **Restricted** tally column from `dayRestricted`), heatmap grid (hour columns for a day, day columns for a range), date-range presets **incl. All time** (campaign-to-date: swaps the grid + overlap cards for totals — see the `?totals=1` mode above) + single-day stepper, coordinator crew filter (**server-side** `?coordinatorId` — a deduped billable figure cannot be summed in the browser; overlaps card stays campaign-wide), a **by-team breakdown table** (`/team-breakdown`) with the reconciliation footer + an "← All teams" bar when a team is picked, Knocks/Surveys toggle, inline overlaps reconciliation. **Coordinator names come from the LEDGER** (`coordinatorId` stamped on each knock), NOT from the campaign roster — the old `useCampaignTeam` join blanked the column for anyone taken off a campaign. `useCampaignTeam` survives only for the "Knocking N of M" roster denominator. **Live refresh:** every count query on the page spreads `livePollOptions()` and the pill is built with `liveStatusProps([...all of them])` — see §G. First web overlaps surface. |

### Mobile ([mobile/app/(app)/admin](../mobile/app/(app)/admin))
| File | Renders |
|---|---|
| [index.jsx](../mobile/app/(app)/admin/index.jsx) | Org Overview. `DateRangeBar` → `/campaign-rollup`. Cumulative card: `CoverageBar` + two stat rows (Knocks/Surveys/Surveyed; Connection/Lit/Canvassers). `CampaignCard`: full `CoverageBar` + coverage line + inline (knocks/surveys/voters/conn/canv); archived rows show knocks. |
| [campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | **Activity** tiles (Knocks, Surveys/Lit, Surveyed voters, Connection rate via `rateFromPct`) from rollup; **By round** card (`/knocks-by-pass` over the same range — one row per walk list × round: knocks + "Conn N%"/"Lit N%"); **Coverage** (all-time) from overview; Top canvassers from `/canvassers`; "Timeline" quick-link. |
| [timeline.jsx](../mobile/app/(app)/admin/timeline.jsx) + [components/LiveStatus.jsx](../mobile/components/LiveStatus.jsx) | **Timeline** (`/canvasser-timeline`): live performance dashboard at web parity — KPI tiles (`KpiGrid`: Doors, Surveys, Connection rate via `rateFromPct`, Doors/hr, Knocking N of M), per-canvasser cards (coordinator, `dayKnocks/daySurveys/connectionRate`, `hoursOnDoors`·doors/hr, `formatRange` shift line; tap → canvasser detail), `DateRangeBar` presets **incl. 'all'** (campaign-to-date: `?totals=1`, grid hidden) + single-day stepper, walk-list + coordinator `TabSwitcher` crew filters (the coordinator filter is **server-side** `?coordinatorId`, same as web; the option list is a union of the roster and the coordinators actually stamped on the ledger, so a departed canvasser's team still appears; overlaps stay campaign-wide with a note). **No by-team breakdown table** — that surface is web-only, Knocks/Surveys toggle, frozen-name-column heatmap grid (hour columns single-day, day columns for a range — `data.mode` guarded), reconciliation + overlap cards (`overlapCount` true total), `LiveStatus` pill (20s poll while the range includes today, pause/refresh) + `useFocusedPoll`. Reloads the campaign on focus + accepts a `campaignId` param. |
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

**Restricted, per day (personal).** `/mobile/me/*` also returns `restricted` (count of this user's
`restricted` marks) and `restrictedHomes` (distinct inaccessible `householdId`s), surfaced on **My
Stats** as an "N restricted" line (shown only when > 0). Unlike `refused`, `restricted` is **not** in
this route's `DOOR_ACTIONS`, so it never enters the raw personal `doorsKnocked` or `reachedHomes`
(= surveyed OR refused). But its stops **do** count toward the shift window and travel distance (the
canvasser was physically there). A per-day display value only — like `reachedHomes`, don't sum it
across days.

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

## H. Denormalized all-time counters (`Campaign.stats`)

The unbounded "All time" dashboards no longer re-aggregate the whole ledger on every load. Each
campaign carries a maintained counter subdoc — [models/Campaign.js](../server/src/models/Campaign.js)
`stats`: `activityCount` (every activity row, bulk included — powers `hasCanvassed`), the
`knocksPipeline` quadruple (`knockCount`/`surveyedKnockCount`/`litKnockCount`/`refusedKnockCount`,
distinct household×pass), `litDroppedCount` (volume), `surveyCount` (`SurveyResponse` rows),
`lastActivityAt` + `canvasserIds` (non-bulk, mirroring `NOT_BULK`), and `reconciledAt` (the trust
marker).

**The semantics are identical to the live pipelines by construction** — maintenance lives in
[services/reports/campaignCounters.js](../server/src/services/reports/campaignCounters.js): the
mobile write path applies exact per-pair deltas (one indexed pre-read of the pair's replaceable
rows derives the before/after knock state), and every rare admin bulk op (re-cut clear-knocks,
snapshot restore, bulk-restrict/unrestrict, admin survey delete, demo staging) triggers a full
per-campaign recompute. Locked by
[test/campaignStats.int.test.js](../server/test/campaignStats.int.test.js) — parity against an
independent ledger recompute after every operation type.

**Who reads them:** `/campaign-rollup` with no date window and no effort filter (knocks quadruple,
`litDropped`, `activeCanvassers`, `lastActivityAt`); `/overview`'s knocks + survey volume; and
`campaignSummaries.hasCanvassed` (the archive/delete gate). Date-ranged and effort-scoped requests
always use the live pipelines (a scalar counter can't be windowed), as do DISTINCT counts
(surveyed voters, ranged active canvassers).

**Fallback, not failure:** a campaign whose `stats.reconciledAt` is null (created before the
feature) makes the whole request fall back to the live aggregation — counters are exact or unused,
never approximate. Seed/repair with `npm run migrate:campaign-stats -- --apply`
([migrations/reconcileCampaignStats.js](../server/src/migrations/reconcileCampaignStats.js); the
dry run lists unseeded/drifted campaigns). `reconcileCounts --apply` also re-syncs stats after its
ledger dedups. Known limit: two truly simultaneous writes on the same (household, pass) can drift a
pair counter by 1 until the next reconcile — documented in the service header.
