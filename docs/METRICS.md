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
defaults, and boundary math), [EXPORTS.md](EXPORTS.md) (the export files carry these same three
survey units and the Σ-rounds invariant), [TIMEZONES.md](TIMEZONES.md) (these counts are windowed and bucketed in
the campaign's timezone — what "a day" means here).

---

# Part 1 — For everyone

## The one idea that ties it together: a "pass"

A **pass** is one planned sweep of a walk list's doors (Pass 1, Pass 2, …). The whole model hangs off
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

> **Door-outcome toggles don't touch any number here.** A campaign can turn individual outcome
> buttons off in the field app ([CAMPAIGNS.md](CAMPAIGNS.md) → Door outcomes) — that's a
> *recording* policy. Every definition below keys off recorded rows, so doors recorded before a
> toggle flip keep counting in every metric, rate, export, and invoice, forever.

### Houses knocked
Distinct households that have been knocked at least once — **status outside
`NON_KNOCKED_STATUSES` (`unknocked`, `restricted`)**, and at bucket level also outside the
synthetic `doNotKnock`/`dnc`/`voted` segments, which are carved exclusively out of raw-`unknocked` doors.
This is **current-state and all-time** — it doesn't move with the date filter. It answers "how
much of the turf is done." Field: `homesKnocked`.

> The definition used to be a bare `status ≠ 'unknocked'`, and one surface (the Campaigns list)
> still computed it that way after Restricted Access shipped — presenting 3,226 gated doors
> nobody could knock as "knocked" and running 20 points hot against the dashboard (69% vs 49%
> on a real campaign). Owner ruling 2026-07-29: *a door we could not knock is not a knocked
> door.* All three surfaces (Campaigns list, overview, campaign-rollup) now derive from the
> shared constants in `services/reports/aggregations.js`; the rollup's hand-rolled bucket list
> also silently omitted `dnc`, which the shared constant closes.

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

> **Desk-entered responses count here too.** An org admin converting a door entry into Surveyed
> (Door Outcomes → Surveyed) records real answers on the knocking canvasser's behalf; those rows are
> ordinary `SurveyResponse` documents and move Surveys, Surveyed voters, contact rate and survey
> rate exactly like a field submission. They carry a `deskEntry` stamp for provenance — **the stamp
> is not arithmetic**, and no metric here filters on it. Every such conversion is priced in these
> same figures before it runs, and is revertible. See
> [SURVEYS.md §K](SURVEYS.md#k-desk-entered-responses-outcome-conversion).

### Surveyed voters
Distinct voters who have a survey — i.e. **how many people we actually reached** (not how many
forms we filed). Field: `surveyedVoters`.

> **Surveys > Surveyed voters?** Then a voter has more than one response (a re-survey). The rule is
> **one survey per voter per pass**, now **DB-enforced** — the submit upserts on `(voter, pass)` with a
> unique index ([SurveyResponse.js](../server/src/models/SurveyResponse.js), migration
> [migrateSurveyDedup.js](../server/src/migrations/migrateSurveyDedup.js)), so a double-tap can no
> longer create two rows. Anything that still reads as a duplicate shows in the **Duplicate
> surveys** report (`GET /admin/reports/duplicate-surveys`; web page `/admin/duplicate-surveys`,
> mobile **More → Duplicate surveys**),
> which lists those voters with **who / when / round / where** under **three kinds**:
> **Same round · overwritten** (danger — a second canvasser's same-round submit **replaced** the
> first's answers; the replaced response is **preserved** in `SurveyResponseArchive` and joins the
> report via `$unionWith`, restorable by an admin — [SURVEYS.md](SURVEYS.md) §F),
> **Same canvasser · same day** (warning — a double-submit or mis-tap, the historical class) and
> **Different canvassers · later round** (info — usually a legitimate revisit). Overwritten groups
> sort **first**, then same-day repeats, then count. Fix on **web** by opening
> the voter profile and deleting the extra response — or **restoring** a preserved one (a lossless
> swap); on **mobile** the expanded card deletes in place
> (`DELETE /admin/voters/:voterId/surveys/:responseId`), and a preserved row reads **Preserved**
> instead of Delete — its response-detail screen carries the Restore. Delete and restore are
> **org-admin only** on both
> surfaces — `admin/voters.js` is `requireOrgRole('admin')` router-wide — even though the report itself
> is lead-readable, so a lead sees every duplicate and no delete or restore. Deleting moves
> **`surveyCount` only**:
> the `survey_submitted` CanvassActivity row survives, so knock/door counts are untouched (pinned by
> `campaignStats.int.test.js`); an overwrite or a restore swap moves **no counters at all** (one
> current row throughout). The report is **paged** (`skip`/`limit`, default 25, max 100;
> `total` is the full matching-group count, not the page) and filterable by **`?userId=`** (groups
> containing that canvasser — matched **after** grouping, so filtering never changes what counts as a
> duplicate: the filtered group still shows every response, including other canvassers') and
> **`?kind=sameRoundOverwritten|sameCanvasserSameDay|differentCanvassers`** (the three flags, so an
> auditor can isolate the worst bucket first). An archived row's `responseId` is its **archive id**
> — the response detail (`/admin/reports/responses/:id`) falls back to the archive for it, and a
> live response that replaced someone's answers carries **`replacedEarlier`** on that same detail.

### Connection rate
**Surveyed knocks ÷ Knocks × 100.** Of the knocks we made, how many landed a survey. A
"surveyed knock" is a (household, pass) that got at least one survey, so the numerator is always
a subset of Knocks → **the rate is always ≤ 100%.** (Lit-drop campaigns use lit knocks ÷ knocks
and label it "Lit rate"; the value is computed the same way.) Field: `connectionRate`.

**The tiers, and where they're now visible.** The rate is graded on three bands:

| tier | rate | shown as |
|---|---|---|
| **On target** | 20% and up | green |
| **Watch** | 10–19% | amber |
| **Low** | under 10% | red |

These have always driven the color. What changed is that they are now **stated to users in words**
— the mobile campaign screen prints the tier name beside the percentage ("On target · 986 of 4,136
doors") and lists the whole ladder in its explanation sheet. So the 20% line is a published
promise, not just a styling constant: **moving a threshold changes what the app tells a customer
"good" means.** Single source on mobile is `RATE_TIERS` in
[mobile/lib/rates.js](../mobile/lib/rates.js); the web counterpart is
[client/src/lib/rates.js](../client/src/lib/rates.js). Change them together, and update
[the Help Center metrics guide](../server/src/content/help/guides/metrics.md) in the same pass.

### Lit drops vs lit doors — two different numbers

Two server fields, and they are **not** interchangeable:

- **`litKnocks`** — *doors* that got literature, one per house per pass. This is what the **lit
  rate divides by**, and it is what `metricHelp.litDrops` ("counted once per door per pass")
  describes.
- **`litDropped`** — the raw count of lit-drop **actions**. Drop at the same door twice in one
  pass and that is two. It is therefore **≥ `litKnocks`**, and it is *not* a rate operand.
  Its copy is `metricHelp.litDropEvents`.

The mobile campaign screen prints `litDropped` (labelled "Lit drops", unit "drops"), so on a
lit-drop campaign the rate row deliberately shows only its tier word and **not** the
"X of Y doors" fraction that survey campaigns get — printing that fraction there would assert an
equation the screen's own numbers don't support. **Never pair one of these fields with the
other's help string**; that shipped once and told readers a number was something it wasn't.

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

**Desk marks — a whole book or a single home — are the one exception to the per-canvasser rules
above.** An admin can mark a **whole book** restricted at once (a gated community — from the web Turf
Cutting page or the mobile Books screen), or a **single home** (one locked gate — from the Turf Cutting
map's house popup, the Map page's door panel, or the mobile admin map / book house pop-up; see
[PASSES_AND_TURF.md](PASSES_AND_TURF.md)). Both write the same real activity row carrying `via: 'bulk'`
([models/CanvassActivity.js](../server/src/models/CanvassActivity.js), written only by
[services/canvass/deskRestrict.js](../server/src/services/canvass/deskRestrict.js)): they drive door
status, per-round views, coverage, and campaign-scope restricted tallies exactly like field marks — but
they are **excluded** from every per-canvasser surface (timeline, leaderboards, per-canvasser Restricted
columns/CSV, shift windows, travel, activity feeds, active-now) and are **invisible to the GPS
audit** (`NOT_BULK` in [aggregations.js](../server/src/services/reports/aggregations.js)), because a
hundred same-second marks by one admin audit nothing a canvasser did. Doors already **completed in
the round** keep their result (skipped), already-restricted doors are skipped (idempotent), and
**Unmark restricted** removes only the desk marks — field marks survive (a book's Unmark removes every
desk mark on its current doors for that round, single-home ones included; a home's own popup removes
just that door's).


### No soliciting  *(all campaign types)*
A door with a **posted no-soliciting sign** the canvasser honored. Colored **pink (`#DB2777`)**,
offered on **every** campaign — a sign forbids leaving literature at least as much as it forbids a
survey.

It sits between Refused and Restricted, and the one rule to hold onto is that it takes **one half from
each**: like Refused it **is a knock**; like Restricted it **is not a contact**.

- It **is a knock.** `no_soliciting` is in `KNOCK_ACTIONS`, so it counts toward **Knocks**, **Houses
  knocked**, **billable doors**, and the doors/hour numerator. The canvasser walked the same path they
  walk for a Not home — the only difference is why they left. No opt-in, no flag: unlike Restricted
  doors these bill by default, because the walk is indistinguishable from any other knock.
- It is **not a contact.** Nobody answered, so it never enters the **Reached-a-person** (contact rate)
  numerator, and it isn't a completion so it never enters the **Connection rate** numerator either. It
  therefore *lowers* both rates by widening their shared denominator — correctly: a knock happened and
  no one was reached.
- It gets its **own coverage segment**, on the "knocked" side of the funnel (unlike Restricted, which
  sits outside it).

Like every non-completion it is **overridable** — it's in `REPLACEABLE_ACTIONS`, so any later
disposition on the same door/pass supersedes it, and vice-versa.

> **Why record it at all rather than suppressing the door?** Political canvassing is generally *exempt*
> from no-soliciting ordinances — it's protected speech, not commercial solicitation — so honoring a
> sign is a campaign **policy** choice, not a legal obligation. Doorline therefore records the outcome
> and leaves the decision with the campaign: an admin who doesn't want anyone sent back can drop those
> homes at **cut time** (the "Exclude N no-soliciting homes" toggle, see
> [PASSES_AND_TURF.md](PASSES_AND_TURF.md)). That is non-destructive and reversible, unlike the
> permanent suppression a do-not-contact flag applies (see [VOTERS.md](VOTERS.md)).

**Two units, and they differ on purpose.** The per-outcome report buckets (`noSolicitingKnocks`, the
CSV column) count doors where **any** canvasser recorded it — exactly like `refusedKnocks`, so a door
two canvassers dispositioned differently appears in both buckets. The coverage segment and the cut
exclusion instead read the door's **resolved status**, which is one bucket per door. Don't reconcile
one against the other; only the coverage segments are guaranteed to partition.

### Coverage funnel (the colored bar)
Each household sits in exactly one bucket — `surveyed`, `lit_dropped`, `refused`, `restricted`,
`no_soliciting`, `not_home`, `wrong_address`, `voted`, `dnc`, `doNotKnock`, or `unknocked` — so the bar sums to the total number
of households. `unknocked` = houses not yet knocked at all; `restricted` = homes a canvasser
couldn't physically reach (its own segment — counted in the household total but not among the
"knocked"); `voted` = early-voting doors that dropped off the canvasser's list (pulled out of
`unknocked`, see early-voting doc); `dnc` = doors where **every** resident is marked do-not-contact
(also pulled out of `unknocked` — they will never be knocked; see [VOTERS.md](VOTERS.md));
`doNotKnock` = addresses that asked nobody ever return (see [DO_NOT_KNOCK.md](DO_NOT_KNOCK.md)).
**Precedence, strongest first — `doNotKnock` > `dnc` > `voted`:** a door in more than one buckets
ONCE, in the strongest, so the segments always sum. The order is the permanence order — the address
request never reopens, the person-level one reopens for a new resident, and early voting resets
each election. This is a coverage lens, separate from Knocks (activity). Field: `canvass` / `coverage`.

### Door goal and pace (added 2026-08)
A campaign can carry a **door goal** and a **goal date** (see [CAMPAIGNS.md](CAMPAIGNS.md)). When it
does, the campaign Home page reports progress toward it and what it takes to get there.

> **Careful with the word "pace."** This doc already uses *pace* for **doors per hour** — a
> productivity rate per canvasser. Goal pace is a different thing entirely: **doors per calendar
> day** against a deadline. They share no math and no field name.

- **Progress** is counted in **billable doors** (`knocks` + `restrictedDoors` where the campaign
  bills them), so a goal and an invoice speak the same unit. It is **always all-time and
  campaign-wide** — the date range, walk-list and crew filters do not move it, which is why the card
  carries that sentence in its footer.
- **Needed** is `doors remaining ÷ calendar days left`, **not counting today**. By the time
  anyone reads the number, today's canvassing is already planned, underway or done — treating it
  as a fully available day silently understates what every remaining day has to carry. On the
  goal date itself the divisor clamps to 1 ("all of it, today"), never 0. Calendar days, not
  canvassing days: days off are still included.

  > This is also what keeps the card internally consistent. `projectedFinish` has always started
  > from tomorrow, so while *Needed* counted today the two disagreed — a real campaign showed
  > **On track** beside *"finish Aug 20 — 2 days past the goal date"*. Working at exactly the
  > needed rate now projects landing exactly on the deadline, and
  > [goalPace.test.js](../server/test/goalPace.test.js) asserts it.
> **Removed 2026-08-15: the trailing actual rate, the Ahead/On-track/Behind verdict, and the
> projected finish date.** They are gone from every surface *and* from the server — computing them
> cost a `Pass.activatedAt` lookup plus one `knocksPipeline` per distinct campaign timezone on
> every rollup and campaigns-list load. On a fully seeded org `goalProgressFor` now issues **zero
> aggregations**. If a verdict is ever wanted back it is a rebuild, and it has to bring back the
> suppression rules that made it honest: a floor of canvassing history before judging at all, and
> a cap on how far out a projection may be printed.

Fields: `goal.*` on each campaign row (§B). Owner: `services/reports/goalProgress.js`.

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
without making the rate a lie. Two exclusions worth knowing: a **desk** mark (an admin marking a whole
book — or a single home — restricted from Turf Cutting, the Map page or the mobile admin app) is desk
work, not a walk, so it never becomes a billable door; and a door that was restricted by one canvasser
and knocked by another is **one** door, counted as a knock.

None of this changes what **Doorline** charges you — that's a flat rate per active campaign per month
and never reads door counts at all ([BILLING.md](BILLING.md)).

## By pass (the per-pass breakdown)

The campaign dashboard's **By pass** section breaks the Activity numbers down one level: one row
per **walk list × pass** (Pass 1, Pass 2, …), over the same date range as the Activity numbers
above it. Each row shows that pass's **Knocks**, **Survey doors** (**Lit drops** on a lit-drop
campaign), **Surveys taken** (survey campaigns only — the response unit, so it can exceed the
door count wherever a house held several voters), **Conn %**, and **New homes reached**, with a
**TOTAL** row underneath. The same
per-pass numbers appear on each walk list's Passes panel, and the mobile admin campaign screen has
a matching **By pass** card. Knocks recorded before passes existed show as one **"Legacy / no
pass"** row, listed last.

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

- **Honors the date filter:** Knocks, Survey doors, Surveys taken, Voters surveyed, Connection
  rate, Active canvassers. (Knocks/lit range on the knock timestamp; surveys range on submission
  time.)
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

The review screen lists one card per house, grouped by the pass (`Pass N · name` — prefixed with
the walk-list name when the campaign has more than one walk list, since pass numbering restarts per
list) where the collision happened, with the canvassers involved. Because a same-pass double-knock counts as
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
| `CanvassActivity` | [models/CanvassActivity.js](../server/src/models/CanvassActivity.js) | `householdId`, `userId`, `actionType` (`not_home`/`wrong_address`/`refused`/`restricted`/`no_soliciting`/`survey_submitted`/`lit_dropped`/`note_added`), `passId` (nullable), `campaignId`, `organizationId`, `timestamp` |
| `Household` | [models/Household.js](../server/src/models/Household.js) | `status` (`unknocked`/`not_home`/`surveyed`/`wrong_address`/`refused`/`restricted`/`no_soliciting`/`lit_dropped`), `isActive`, `campaignId`, `lastActionAt`, `lastActionBy` |
| `SurveyResponse` | [models/SurveyResponse.js](../server/src/models/SurveyResponse.js) | `voterId`, `householdId`, `userId`, `passId`, `campaignId`, `submittedAt` (one per voter **per pass**) |
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `effortId` (the walk list the round belongs to), `roundNumber` (ordered **per walk list** — unique on `{effortId, roundNumber}`, so numbering restarts in every walk list and "Pass 1" alone is ambiguous once a campaign has 2+ lists), `name`, `status`, `activatedAt` |
| `Voter` | [models/Voter.js](../server/src/models/Voter.js) | `surveyStatus` (`not_surveyed`/`surveyed`), `householdId` (required → voters are campaign-disjoint) |

**The core invariant (write path).** In [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js),
every knock submission first runs
`CanvassActivity.deleteMany({ userId, householdId, passId, actionType ∈ REPLACEABLE_ACTIONS })`
before inserting the new one (`REPLACEABLE_ACTIONS` = the six knock types **plus `restricted`** — so a
mistaken restricted mark is superseded by any later disposition on the same door/pass, and vice-versa). Therefore:

> **At most ONE `CanvassActivity` (knock) exists per `(userId, householdId, passId)`.**

This is why a canvasser's raw knock-event count *equals* their distinct house-pass count, and why
a same-canvasser same-pass correction never inflates anything. The survey route applies the same
household-scoped dedup, so a multi-voter house still yields exactly one `survey_submitted`
activity per (user, house, pass) — even though it produces multiple `SurveyResponse` rows.

`KNOCK_ACTIONS = ['not_home', 'wrong_address', 'refused', 'survey_submitted', 'lit_dropped',
'no_soliciting']` ([services/reports/aggregations.js](../server/src/services/reports/aggregations.js)).
`refused` and `no_soliciting` are knocks like the others (billable door interactions — in both cases
the canvasser reached the door). Two actions are deliberately **excluded**: `note_added` (a note can be
left without a visit decision) and **`restricted`** (an inaccessible-home *marker* — no door
interaction happened, so it is never a knock and never enters any rate).

**The three-way distinction, since two of these look alike:** `refused` reached the door AND a person
(a contact); `no_soliciting` reached the door but no person (a knock, never a contact);
`restricted` reached neither (not even a knock). `contactRate`'s numerator is therefore
`surveyed + refused` and nothing else.

The non-completion status precedence (`ACTION_TO_STATUS` / `statusPrecedence` in
[utils/statusPrecedence.js](../server/src/utils/statusPrecedence.js)) maps `refused`, `no_soliciting`
and `restricted` to same-named statuses, resolved last-write-wins — so a later mark can overwrite an
earlier not-home on the same house-pass, but a survey still wins over any of them.

## B. Field dictionary

| API field | Meaning | How it's computed | Returned by | Date field |
|---|---|---|---|---|
| `knocks` | Billable knocks: distinct `(household, passId)` | `knocksPipeline` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyedKnocks` | Knocks (house-passes) with ≥1 `survey_submitted` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `litKnocks` | Knocks with ≥1 `lit_dropped` | `$max` flag in `knocksPipeline` | `/overview`, `/campaign-rollup` | `timestamp` |
| `refusedKnocks` | Knocks (house-passes) whose outcome was `refused` — a billable contact, **not** a survey. Subset of `knocks` (survey campaigns only; 0 on lit) | `$max` flag (`hasRefused`) in `knocksPipeline` | `/overview`, `/campaign-rollup` (on `/canvassers` the per-canvasser count is the bare `refused` column, which feeds that row's `contactRate`) | `timestamp` |
| `restricted` | Per-canvasser tally of `restricted` (inaccessible-home) marks — **not** a knock, **never** in `knocks`/`homesKnocked`/any rate; its own coverage segment. All campaign types | count of that user's `restricted` activities | `/canvassers`, `/canvasser-timeline` (`dayRestricted`); coverage `canvass`/`events` on `/overview` · `/campaign-rollup` | `timestamp` |
| `restrictedDoors` | Distinct `(household, passId)` doors whose ONLY disposition is a **field** `restricted` mark (`via ≠ 'bulk'` — desk marks, whole-book or single-home, never count). Disjoint from `knocks` by construction (a door with any knock is a knock). Reported **always**, billed or not, so the UI can offer the opt-in | `restrictedDoors` in `knocksPipeline` (`includeRestricted`) | `/overview`, `/campaign-rollup`, `/knocks-by-pass`, `/canvasser-timeline`, statement lines | `timestamp` |
| `billableDoors` | The org's own invoice figure: `knocks` + (`restrictedDoors` **iff** this campaign bills them). `=== knocks` when the opt-in is off, which is the default. **Never** a rate denominator | `billableDoorsOf(row, billRestricted)` (§C) over `knocksPipeline` | `/overview`, `/campaign-rollup`, `/knocks-by-pass` (+`.csv`), `/canvasser-timeline` | `timestamp` |
| `connectionRate` | `(surveyedKnocks + litKnocks) / knocks × 100`, integer, ≤100. **Unchanged by Refused** — refusals are not in the numerator | `connectionRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `contactRate` | "Reached a person": `(surveyedKnocks + refusedKnocks) / knocks × 100`, integer, ≤100 | `contactRate()` (§C) | `/overview`, `/campaign-rollup`, `/canvassers` | — |
| `surveysSubmitted` | Survey responses (one per voter/pass) — a volume count. **Surfaces as "Surveys taken"** (§G's labelling rule) | `SurveyResponse.countDocuments` / `$sum` | `/overview`, `/campaign-rollup`, `/canvassers` | `submittedAt` |
| `surveysTaken` | The **same response unit**, per round — `/knocks-by-pass`'s name for it. `Σ(rounds) === totals.surveysTaken` by construction: every `SurveyResponse` carries exactly one `passId`, so the rows partition (which is precisely why a distinct-VOTER column can never live in that table — a voter surveyed in two rounds belongs to both). Also emitted per `(round, canvasser)` under `?groupBy=canvasser`, where it needs **no** `crossCanvasserDoors` correction: a response has one `userId`, so the per-user rows sum exactly | `{$sum: 1}` grouped on `$passId` in [knocksByPass.js](../server/src/services/reports/knocksByPass.js) | `/knocks-by-pass` (+`.csv` as `Surveys taken`), Export Center `knocks-by-round` | **`submittedAt`** — NOT `timestamp`; the survey ledger has no `timestamp` field, so windowing it on one silently returns zero |
| `surveyedVoters` | Distinct voters surveyed | distinct `voterId` in `SurveyResponse` | `/overview`, `/campaign-rollup` | `submittedAt` |
| `voterCount` (tags[]) | "Identified": distinct voters EVER giving an answer carrying the tag | distinct `voterId` over `answerTagClause` | `/survey-results` `tags[]` | `submittedAt` |
| `currentVoterCount` (tags[]) | "Still current": voters whose LATEST in-scope answer carries the tag — the only count that can fall with no deletion | `currentVoterSetsByTag` (services/surveys/currentTags.js) | `/survey-results` `tags[]` | `submittedAt` |
| `identifiedVoters` / `currentVoters` | The same two units split by team under **first-finder** attribution (Σ teams + noTeam === totals, both) | `/tag-teams` first-finder agg + `currentVoterSetsByTag` | `/tag-teams`, ClientReport `tagBreakdowns` | `submittedAt` |
| `homesKnocked` | Org/campaign: distinct households `status ∉ {unknocked, restricted}` (inaccessible homes are **not** "knocked"). Per-canvasser: alias of `knocks` | `Household.countDocuments` (org) / `= knocks` (leaderboard) | `/overview`, `/campaign-rollup`, `/canvassers` | all-time (org) |
| `knockedPct` | `homesKnocked / households × 100` | derived | `/campaign-rollup` | all-time |
| `coverage` / `canvass` | Per-household current-status buckets (sums to households) | `Household.aggregate` group by `status` | `/campaign-rollup` (`coverage`), `/overview` (`canvass`) | all-time |
| `litDropped` | Lit-drop **events** (volume) | `CanvassActivity` count of `lit_dropped` | `/overview` (`events`), `/campaign-rollup`, `/canvassers` | `timestamp` |
| `surveyKnocks` | Per-canvasser surveyed knocks (rate numerator) | count of that user's `survey_submitted` activities | `/canvassers` | `timestamp` |
| `activeCanvassers` | Distinct `userId` with activity in range | `CanvassActivity.distinct('userId')` (**not summable**) | `/overview` (`activeUsers`), `/campaign-rollup` | `timestamp` |
| `goal` | Door-goal block, or `null` when no goal is set. **ALL-TIME and campaign-wide even on a windowed/effort/crew-scoped request** — a goal is a whole-campaign contract number, so it deliberately ignores the row's own filters. Keys: `target`, `deadline`, `deadlineSource` (`goalDate`\|`electionDay`), `done`, `remaining`, `percent`, `daysLeft`, `requiredPerDay`, `requiredPerWeek`. Progress only — no verdict, trailing rate or projection (removed 2026-08-15) | `goalProgressFor()` in [goalProgress.js](../server/src/services/reports/goalProgress.js) — `done` off `Campaign.stats`, with a live pipeline for unseeded legacy docs only. **Zero queries when nothing in scope has a goal, and zero aggregations on a fully seeded org**, which keeps the rollup's `useStats` fast path fast | `/campaign-rollup`, `/admin/campaigns` | all-time |
| `goal.done` | Billable doors toward the goal: `stats.knockCount + (policy ? stats.restrictedDoorCount : 0)`. Moves when `billRestrictedDoors` flips, by design — the goal tracks the invoice unit | `billableDoorsOf` over the counters | `/campaign-rollup`, `/admin/campaigns` | all-time |
| `goal.requiredPerDay` | `remaining ÷ daysLeft`, **today excluded**, clamped to a divisor of 1 on the deadline day. Null once `remaining` is 0, when there is no deadline, or once the date has passed | `computeGoalPace()` (pure; [goalPace.test.js](../server/test/goalPace.test.js)) | `/campaign-rollup`, `/admin/campaigns` | — |
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
widens the `$match` to `BILLABLE_WITH_RESTRICTED`, drops desk-authored restricted rows (`via:'bulk'` — a whole book or a single home), and
adds a `hasKnock` fold to the inner `$group`. That fold is what keeps the guarantee: `knocks` becomes `$sum: '$hasKnock'`
instead of `$sum: 1`, which is the **same value** — so restricted marks still touch neither `knocks`
nor any rate numerator/denominator, in either mode. The wider run additionally yields:

- `billableDoors` (`$sum: 1`) — every door in the dedup, knocked or restricted.
- `restrictedDoors` — doors where `hasKnock === 0`, i.e. restricted-only.

Because the `(household, passId)` dedup is untouched, a door that one canvasser restricted and
another knocked is **one** door and lands in `knocks`, and `Σ(byPass rows)` still equals the campaign
total by construction for the new columns exactly as it does for `knocks`.

The bulk exclusion is `$nor: [{ actionType: 'restricted', via: 'bulk' }]` — **scoped to restricted
rows, never a blanket `NOT_BULK`**. A desk mark — a whole book or a single home — is not a walk and must
not be billed; but a `via:'bulk'` row on a *knock* action is a real billable knock that round totals are
contractually required to include (only per-CANVASSER surfaces exclude bulk), so a blanket filter
would silently delete a door from the invoice. That is not hypothetical — it is asserted by
`knocksByPass.int.test.js`, which caught exactly this mistake. `$nor` rather than a top-level `$or`
so it can never clobber an `$or` the caller put in `match` (the team/crew filters do).

`Campaign.stats.restrictedDoorCount` denormalizes the same number for the no-date-window counter
fast path. **Transitioning INTO "restricted doors are billed" recomputes the affected campaigns'
stats** — the campaign PATCH recomputes that campaign, the org-level `PATCH /admin/billing/settings`
recomputes every campaign that *inherits* the default (`billRestrictedDoors: null`, which in Mongo
also matches the field being absent). This is not tidiness: a campaign created before this feature
has **trusted** stats (`reconciledAt` set) that simply have no `restrictedDoorCount`, so without the
recompute the counter-backed `/overview` would report `billableDoors = knocks` while the
live-aggregated invoice export reported the real, higher number — the toggle would look broken on one
screen and correct on another. Self-healing on the write beats a deploy-time migration nobody
remembers to run first.

**Only** on the transition into billed, never on turning it off and never on every flip. The counter
is read solely while the policy resolves true, so a stale value under an off policy is unreachable
and the next turn-on repairs it — an admin toggling back and forth doesn't re-aggregate the ledger
each time, which matters most for the org-wide flip that fans out over every inheriting campaign.

Two cheaper guards that look tempting and are both **wrong**: keying off `$exists` fails because an
unrelated `.save()` materializes subdoc defaults, so merely renaming a pre-feature campaign stamps a
wrong `restrictedDoorCount: 0` while leaving `reconciledAt` trusted (the trap the `reconciledAt`
comment in [Campaign.js](../server/src/models/Campaign.js) documents); and defaulting the field to
`null` to make absence detectable breaks the canvasser hot path, because `bumpCampaignStats` `$inc`s
it and `$inc` throws on null. Keying off the transition sidesteps both.

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
        { "passId", "roundNumber", "roundLabel": "Pass 2 · GOTV", "effortName": "North",
          "canvassers": [ { "userId", "firstName", "lastName", "email", "actionType", "timestamp" } ] }
      ],
      "totalCanvassers": 2
    }
  ],
  "total": 1
}
```

`passId: null` (legacy) is its own bucket — 2+ distinct canvassers there still flag.
`roundLabel` falls back to `"Legacy / no pass"` when there's no `Pass`, with `effortName: null`.

**Every pass entry carries `effortName`** (the walk list's name), and `roundLabel` is
`"Pass N · name"` — **prefixed with the walk-list name (`"North · Pass 2 · GOTV"`) only when the
campaign has 2+ walk lists**, because `roundNumber` restarts per walk list so a bare "Pass 1" is
ambiguous there; single-list campaigns keep the short label. The shared `passLabeler` in
[overlaps.js](../server/src/services/reports/overlaps.js) does this for **both** `computeOverlaps`
and `computeOverlapDoors`, so `/overlaps`, `/overlap-doors`, and the canvasser-timeline overlaps
label rounds identically. (An org-wide call with no `campaignId` in the match can't count the
campaign's efforts, so it prefixes when the *surfaced passes* span 2+ walk lists.)

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
| **Returns** | `{ overlaps[], total, householdIds, overlapUserIds }` — cards + the pre-cap reconciliation counts | `{ householdIds, doors[{ householdId, household{…}, totalCanvassers, passes[{ passId, roundLabel, effortName, canvassers[{userId, firstName, lastName, name, actionType, lastAt, inRange}] }] }], total, outOfRangeTotal }` — **self-contained**: address, who, what action, and when |

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
| `GET /admin/reports/campaign-rollup` | `scope=active\|archived\|all` or `campaignId`; optional **`coordinatorId`** (`ObjectId \| 'none'` — crew-scopes the activity/survey numbers via `withTeam`; households/coverage stay campaign-wide, and the request always takes the live pipelines: a crew has no `Campaign.stats` counter equivalent, so the fast path is bypassed exactly like `effortId`/date windows) | `cumulative{…}` + `campaigns[ row{ households, homesKnocked, knockedPct, knocks, surveyedKnocks, litKnocks, refusedKnocks, surveysSubmitted, surveyedVoters, litDropped, connectionRate, contactRate, activeCanvassers, coverage{} } ]` | activity on `timestamp`, surveys on `submittedAt`; households/coverage all-time |
| `GET /admin/reports/canvassers` | leaderboard; optional **`coordinatorId`** (`ObjectId \| 'none'`) — rows narrow to that crew (the lead's own null-stamped work folds in via the `teamMatch` `$or`; both ledgers take the identical clause so a row's knocks AND surveys agree) | rows `{ surveysSubmitted, surveyKnocks, notHome, wrongAddress, refused, restricted, litDropped, knocks, homesKnocked(=knocks), connectionRate, contactRate, status, hoursOnDoors, daysActive, doorsPerHour, coordinatorId, coordinatorName ('Multiple' when the window spans two teams — resolved from the LEDGER via the shared ledgerCoordinatorLabels, same as the timeline, so the Home leaderboard and the Timeline cannot disagree about a person's team), … }` (per-canvasser refused is the bare `refused` field, not `refusedKnocks`, and feeds `contactRate`; `restricted` is a standalone tally that feeds **no** rate. **`hoursOnDoors`/`doorsPerHour` are computed here as the SUM OF PER-DAY spans** — clients must not re-derive them from `firstActivityAt`/`lastActivityAt`, which is a *calendar* span and under-reports pace ~3×) | activity `timestamp`, surveys `submittedAt` |
| `GET /admin/reports/team-breakdown` | every TEAM at once, with the reconciliation | `{ ready, teams[{ coordinatorId, coordinatorName, people, doors, surveyDoors, surveysTaken, connectionRate, contactRate }], campaign{ doors, surveyDoors, connectionRate, … }, teamSum, crossTeamDoors }`. `coordinatorName: null` = the **No team** bucket. `doors` is distinct `(household, pass)` **within** a team, so a same-team double-knock is absorbed. **`ready: false`** when `Organization.teamAttributionReadyAt` is unset (the backfill hasn't run) — the endpoint returns empty rather than report every team as ~0 and No-team as enormous, which would look like data instead of an error. **Scope:** a crew is **per-campaign**, so with a `campaignId` the lead set (whose own unstamped doors fold onto their own team row) is derived **for that campaign, from the LEDGER** — `leadIdsForScope`; an unscoped org-wide call reproduces the set it returned before crews became per-campaign. 🚨 **`teamSum − crossTeamDoors == campaign.doors` is a TAUTOLOGY and cannot fail** — it is not a check (§F). | `timestamp` |
| `GET /admin/reports/canvassers.csv` | leaderboard export | columns incl. `Knocks`, `Connection rate %`, **`Refused`**, **`Restricted`** | same |
| `GET /admin/reports/team-averages` | org averages | `avg{ homesKnocked, surveysSubmitted, connectionRatePct, doorsPerHour, … }` (rate = Σ completion knocks / Σ knocks) | same |
| `GET /admin/reports/canvassers/:id/summary` | one canvasser | `kpi{ homesKnocked(=knocks, **refused included** — it once wasn't, so this panel read fewer doors than the Timeline for the same person and over-stated the rate), surveyDoors (door-unit, the rate numerator), surveysSubmitted (voter-unit), refused, connectionRatePct + contactRatePct (the **shared** `connectionRate()`/`contactRate()` helpers, integer %), doorsPerHour, … }` + `quality{ totalActivities (ALL non-bulk rows, every action type — the percent denominator), offlineCount/offlinePercent, avgDistanceFromHouseMeters (raw average of the frozen stamps), farFromHouseCount (**the detector's rule via `farAssessment`/services/audit/farKpi.js** — effective distance minus GPS accuracy over `FAR_WARN_M`, med/high only; honest replaced-chain corrections and post-knock pin fixes are forgiven, a self-move still counts. **Living number**: correcting a pin retroactively lowers it), farFromHousePercent (= farFromHouseCount / totalActivities — the denominator did NOT change when the numerator got honest), farForgivenByPinCount (the pin-forgiven subset, so the number's movement is explainable), distanceHistogram (**raw frozen distances, deliberately NOT pin-aware** — it describes GPS behavior, not a verdict) }` | same |
| `GET /admin/reports/canvassers/:id/quality` | one canvasser, geo + sync audit | `{ totalActivities, offlineCount/offlinePercent, avgDistanceFromHouseMeters, farFromHouseCount/farFromHousePercent/farForgivenByPinCount (**the same helper as `/summary`** — the two screens cannot disagree; historically this count hardcoded 50 m while its own flagged list used 75 m), distanceHistogram, syncLagHistogram, lastSyncAt, flaggedActivities[≤100] (**raw `FAR_WARN_M`-or-offline SUPERSET, annotated never post-filtered** — each row carries `pinForgiven`, so a forgiven entry stays visible, marked) }` | activity `timestamp`, sync lag `submittedAt` |
| `GET /admin/reports/canvassers/:id/activities` | one canvasser, paged raw feed (`?flaggedOnly=true` = the raw `FAR_WARN_M`-or-offline DB filter — deliberately a superset; effective/pin logic isn't an indexable query) | `{ total, limit, skip, activities[{ …, distanceFromHouseMeters, pinForgiven, wasOfflineSubmission, … }] }`. `pinForgiven` is computed per page; the DB filter and `total` are untouched by forgiveness, so pagination math stays exact | `timestamp` |
| `GET /admin/reports/canvassers/:id/daily` | one canvasser, per day | `days[{ homesKnocked, surveyKnocks, surveysSubmitted, connectionRatePct, … }]` | same |
| `GET /admin/reports/knocks-by-pass` | one campaign, **per round** (`campaignId` REQUIRED — 400 without it; optional `effortId`, `from`/`to`, **`coordinatorId`** (`ObjectId \| 'none'`) — crew-scopes every activity pipeline (rows, totals, `byCanvasser`) while the row set stays every Pass, so a crew that skipped a round shows a real zero row. **Crew `coverageGained` rule:** "first-ever" is still judged **campaign-wide** — a door counts for the crew (in the pass it landed) only if the campaign's first-ever knock on it was that crew's; a door another crew reached first is never a "new home" here) | `{ campaignId, timeZone, from, to, rounds[], totals{}, byCanvasser?, crossCanvasserDoors? }`. Each `rounds[]` row: `{ passId (null = legacy), effortId, effortName, roundNumber, roundName, roundLabel ("Pass N · name" \| "Legacy / no pass"), status, activatedAt, archivedAt, knocks, surveyedKnocks, **surveysTaken**, litKnocks, refusedKnocks, connectionRate, contactRate, coverageGained }`. Row set = **every Pass** of the campaign/effort (0-knock rounds are real information) + any agg bucket without a Pass doc (legacy `passId:null`, or a deleted pass) + any **SurveyResponse** bucket (a response whose paired activity row was cleaned up would otherwise land in an unrendered bucket, and `totals.surveysTaken` sums the DISPLAYED rows); sorted walk list asc → round asc, legacy last. Everything is live aggregation via `knocksPipeline` — the round-blind `Campaign.stats` fast-path is never used here. **The contract: `Σ(rounds[].knocks) === totals.knocks`** (same for the survey/lit/refused tallies) — both run the same pipeline over the same match (`byPass` vs collapsed), so the rows always sum exactly to the headline (rates in `totals` are recomputed from the summed counts, not averaged). `coverageGained`: first-ever knock per household is found over the campaign **lifetime** (no date filter), then the window narrows to first-knocks that happened inside it — a re-knocked door credits only its first round. **`?groupBy=canvasser`** adds `byCanvasser[]`: **RAW per-user per-round rows — `NOT_BULK`, never team-folded** (the audit convention, like the answer drill: "who pressed the button", not "whose team gets credit"; admin bulk marks are excluded). A door two canvassers both knocked in the same round counts once for the round but once per canvasser; the over-claim is `crossCanvasserDoors` = Σ(per-canvasser knocks) − the NOT_BULK round totals (the `/team-breakdown` convention — computed against a NOT_BULK total so bulk marks can't masquerade as cross-canvasser overlap). | `timestamp` |
| `GET /admin/reports/knocks-by-pass.csv` | the invoice-ready export (same params, incl. `coordinatorId` — one shared adapter threads it to both) | Same builder (`buildKnocksByPass`) as the JSON, so report and export can't drift. **Default:** one row per walk list × pass + a **TOTAL** row — columns `Walk list, Pass, Pass name, Pass status, Activated (ISO), Archived (ISO), Knocks, Survey doors, Surveys taken, Lit knocks, Refused, Connection rate %, Contact rate %, New homes reached`. **`?groupBy=canvasser`:** per-user per-pass rows (`Walk list, Pass, Pass name, Canvasser first/last name, Email, Status, Knocks, Survey doors, Surveys taken, Lit knocks, Refused, Connection rate %, Contact rate %`) — **no coverage column** (first-ever-knock coverage has no honest per-canvasser attribution) and no TOTAL row (the rows over-claim by `crossCanvasserDoors`, by design). `text/csv` attachment `knocks-by-pass-YYYY-MM-DD.csv`. | same |
| `GET /admin/reports/overlaps` | overlap review (date-**windowed**, event-level) | see §D; its `passes[]` rows also carry the **`overwrites`** annotation described on the row below (same shape, same absent-when-none contract — both engines attach it) | `timestamp` |
| `GET /admin/reports/overlap-doors` | the map's overlap **indicator + review list** (**anchored** to the window) | `{ householdIds:[…], doors:[{ householdId, household{id,addressLine1,addressLine2,city,state,zipCode,location}, totalCanvassers, passes:[{ passId, roundLabel, effortName, canvassers:[{userId, firstName, lastName, name, actionType, lastAt, inRange}], overwrites?:[{ voterId, voterName, by{id,name}, overwrittenBy{id,name}, overwrittenAt }] }] }], total, outOfRangeTotal }` — **self-contained, so the Overlaps report renders from this alone**. **`passes[].overwrites`** is **absent when none** (the OverlapDoorCard superset contract) and is built from `SurveyResponseArchive` **`via:'submit'` rows only** (restore swaps are admin curation, not field collisions) — rendered as "X replaced Y's survey answers for VoterName"; it only annotates doors already in the overlap set, never adds one. Params: `campaignId` **required** (400 without — unscoped it would scan the org ledger), optional `effortId`/`passId`/`userId`/`from`/`to` (`computeOverlapDoors` — see §D). Lead-gated. | anchored: detected pass-wide, surfaced when ≥1 knock is in `[from, to)` |
| `GET /admin/reports/duplicate-surveys` | voters with >1 survey response — preserved same-round overwrites included via **`$unionWith` from `SurveyResponseArchive`**; optional `?userId=` (groups containing that canvasser — matched **after** grouping, so the filter never changes what counts as a duplicate and the group still returns every response), `?kind=all\|sameRoundOverwritten\|sameCanvasserSameDay\|differentCanvassers`, `skip`/`limit` (default 25, max 100) | `{ duplicates[{ voterId, count, voter, household, responses[{ responseId, canvasser, submittedAt, day, passId, roundLabel, overwritten, overwrittenAt, overwrittenBy }], sameRoundOverwritten, sameCanvasserSameDay, differentCanvassers }], total, limit, skip, timeZone, tzAbbrev }`. **`total` is the true matching-group count** (it was the post-truncation page length before paging existed). All three flags are computed **in the aggregation** — `sameRoundOverwritten` when the group carries an archived (overwritten) row, `sameCanvasserSameDay` when a `(userId, local day)` key repeats among **live** rows (day bucketed in the anchor tz, so a 11:50 PM / 12:10 AM pair is two days), `differentCanvassers` when >1 distinct live userId. Sorted `sameRoundOverwritten` first, then `sameCanvasserSameDay`, then `count` desc, `voterId` as the tiebreak so pages don't shuffle. An archived row's `responseId` is its **archive id**, served by `/responses/:id`'s archived fallback (a live response that replaced someone's answers carries `replacedEarlier` there). | `submittedAt` |
| `GET /admin/reports/canvasser-timeline` | one campaign, one **day** (`?date=`, the mobile path), a **range** (`?from/&to` — **day buckets up to 62 days, week buckets (Monday-start) from 63 to 183 days**, 400 past that; missing `to` = today), or **campaign-to-date** (`?totals=1`, no bounds) | `mode:'day'`: `{ date, hours[], hourTotals{} }` shape (byte-compatible for mobile); `mode:'range'`: `{ days[], dayTotals{}, bucket:'day'\|'week' }` with per-canvasser `knocksByDay/surveysByDay` — **in `bucket:'week'` the `days[]` entries are Monday week-starts and every map is keyed by them** (the first/last week can be partial; the window still clips to `[from..to]`), plus `overlaps:[]` + `overlapsOmitted:true` and `inOverlap` always false (computeOverlaps is skipped, same reason as totals); `mode:'totals'`: **neither** — no bucket maps, no `days[]`, `range:{from:null,to:null}`, `overlapsOmitted:true`. All three: `{ range{from,to}, tz, canvassers[{ knocksByHour\|knocksByDay, …, dayKnocks, daySurveys, dayLit, dayRestricted, refused, restricted, notHome, wrongAddress, status, isActive, firstActivityAt, lastActivityAt, hoursOnDoors, doorsPerHour, connectionRate, contactRate, inOverlap }], grandKnocks, billableKnocks, overlapDoors, overlaps[] }`. `dayKnocks/daySurveys/dayLit` are the WINDOW totals in every mode; `dayRestricted` is a parallel **Restricted** tally never in `dayKnocks`. `hoursOnDoors` = Σ per-day (last−first), same method as `/canvassers/:id/summary` — **restricted stops are in this window** (`[...KNOCK_ACTIONS, 'restricted']` matched for the span, then knocks exclude restricted), so a restricted-only bucket extends shift-hours without adding a knock (the heatmap grid, which shows knocks only, skips it). Also returns **`billableSurveyDoors`** and **`billableLitDoors`** — survey/lit doors deduped by (household, pass), the twins of `billableKnocks`. All three exist because the per-canvasser rows are RAW: clients must render these fields and never sum the columns (see the survey-doors callout in §"Survey DOORS vs survey VOTERS"). **Both connection-rate numerator terms ship deduped on purpose** — when only the survey term was, the clients still summed `dayLit` across canvassers, putting a RAW term over a DEDUPED denominator: invisible on a survey campaign (lit ≈ 0), live on a lit-drop one. | `timestamp` window in campaign tz; buckets via `$hour` (day) / `$dateToString` (range and totals) |

### The 62-day day-bucket bound, the 183-day cap, and why `totals` escapes both

Both limits exist to bound the **grid's columns** — a range renders one column per bucket — **not**
the aggregation. Up to 62 days (`TIMELINE_DAY_BUCKET_MAX_DAYS`) a range renders day columns with
live per-door overlap review. From 63 to 183 days (`TIMELINE_RANGE_MAX_DAYS`) the response switches
to **week columns** (`bucket:'week'`): the server folds its day buckets to Mondays in the Node
assembly loop, so a 6-month range is ~27 columns instead of 183. Past 183 days, `?totals=1` lifts
everything by shipping no grid: no `knocksByDay`, no `days[]`, no hour maps. Everything else is
unchanged, and totals is the only way to see a whole campaign, which is the only way to see
**every canvasser who ever worked it** — including the ones who have since left.

Four invariants, each of which a plausible "simplification" would break:

- **It still buckets BY DAY internally — in every mode.** Grouping on `userId` alone would make
  `hoursOnDoors` equal *(last knock ever − first knock ever)* — weeks, not hours — and collapse
  `doorsPerHour` to ~0. Because it keeps the day bucket, every per-canvasser number in `totals`
  mode is **by construction** the exact sum of its range-mode buckets
  (`test/timelineTotals.int.test.js` asserts that field by field), and **week mode inherits the
  same guarantee**: the Mongo `$group` is untouched — only the Node roll-up folds day keys to
  their Monday, accumulating — so `hoursOnDoors` stays a per-DAY-span sum even when a column is a
  week (`test/timelineWeekBuckets.int.test.js` seeds a morning+evening week and asserts 4h, not
  ~82h).
- **Per-canvasser knocks are NOT `knocksPipeline`.** The endpoint runs two aggregations: a
  `$group` on `{userId, bucket}` (raw row counts → the per-canvasser numbers) and
  `knocksPipeline(scoped)` (dedupes by `(householdId, passId)`, collapses **across users**, `_id:null`
  → the campaign-wide `billableKnocks`). `knocksPipeline` has **no `userId` dimension**. Per-canvasser
  knocks are raw counts and *legitimately exceed* `billableKnocks` when two canvassers work the same
  door in the same pass — that's the overlap-never-double-bills design, reconciled by `overlapDoors`.
  Routing per-canvasser counts through `knocksPipeline` would silently rewrite everyone's numbers;
  the test seeds a deliberate overlap and asserts `grandKnocks > billableKnocks` to catch it.
- **Overlaps are skipped in `totals` AND week mode.** `computeOverlaps` `$push`es every event into
  per-door arrays, which over a long window can breach Mongo's 100MB per-stage limit. The overlap
  **door count** (`overlapDoors = grandKnocks − billableKnocks`) is pure arithmetic and stays honest;
  only the per-door reconciliation **cards** need a bounded window. `overlapsOmitted:true` says so,
  and both clients now render that as "per-door overlap review needs a range of 62 days or less"
  rather than implying a campaign had zero overlaps. Consequence: `inOverlap` is false on every row
  whenever `overlapsOmitted` (the ⚠ badges only appear with `bucket:'day'`).
- **The audit's 62 is NOT this 62.** The flags endpoint's cap is `AUDIT_WINDOW_MAX_DAYS`
  (`flagThresholds.js`) — an OOM guard on `detectFlags`, which loads every matched row into Node.
  The Timeline's constants live in `reports.js` and may drift from it freely; they were one
  constant until the week tier decoupled them.

**Cumulative summability:** `households`, `homesKnocked`, `knocks`, `surveyedKnocks`,
`litKnocks`, `refusedKnocks`, `surveysSubmitted`, `surveyedVoters`, `litDropped` (and the coverage
`restricted` tally) are summed across campaigns (households/voters are campaign-disjoint, so the
distinct counts don't overlap). Cumulative
`connectionRate` **and** `contactRate` are recomputed from the summed numerator/denominator (not
averaged). `activeCanvassers` is **not** summable — it uses a separate org-wide `distinct('userId')`.

## F. Invariants & edge cases

### Unknock removes rows from EVERY metric (2026-08-26)

**Unknock** (Door Outcomes → docs/CAMPAIGNS.md §Unknock) is the one operation that deletes
`CanvassActivity` rows, so every live aggregation in this document simply stops seeing them —
knocks, rates, coverage, per-canvasser rows (which drop by RAW rows, the same way they're
counted), overlap detection, GPS flags, hours-on-doors spans. Two consequences worth naming:
`coverageGained`'s first-ever-knock credit can migrate to a later round (correct — the fake first
knock never happened), and a door's next knock in the same round bills exactly once, because the
emptied `(household, pass)` pair groups fresh in `knocksPipeline`. `Campaign.stats` is recomputed
in the same operation (a deletion is never rate-neutral), and the struck rows stay frozen on the
run for revert — so a metric that "lost" rows can get them back byte-for-byte via Undo.

### Teams (coordinators) — the counting contract

**THE CURRENT COORDINATOR OWNS ALL OF THAT CANVASSER'S HISTORY IN THIS CAMPAIGN.**
`CanvassActivity.coordinatorId` and `SurveyResponse.coordinatorId` carry the team, stamped at knock
time by [canvass.js](../server/src/routes/mobile/canvass.js) from
**`CampaignAssignment.coordinatorId` for the campaign that door belongs to** (`coordinatorForWrite`
— one lookup, memoized per request, since a survey submit resolves the team twice) — and
**re-stamped whenever that person's crew changes**, by
[`setMemberCoordinator`](../server/src/services/memberships/setCoordinator.js). Assigning a crew to
someone who already knocked pulls those earlier doors onto the new team; moving someone from crew A
to crew B takes their history with them — **all time, but ONE campaign.** Changing a crew in
campaign A moves **zero** doors in campaign B.

**A crew is per-CAMPAIGN, not per-org.** It lives on
[`CampaignAssignment.coordinatorId`](../server/src/models/CampaignAssignment.js), unique on
`{campaignId, userId}`. It used to live on `Membership.coordinatorId`, unique on
`{userId, organizationId}` — **one slot per person per org** — and two team leads running two
campaigns with a shared canvasser overwrote each other: the second write clobbered the first, and
the re-stamp then dragged the **first** campaign's whole history onto the **second** lead's team.
(`Membership.coordinatorId` still exists on disk but is no longer read; dropping it is a separate,
later step, so the value a moved row moved *from* stays comparable.) Hence
[`restampFilter`](../server/src/services/memberships/restampCoordinator.js) **requires a
`campaignId` and throws without one** — an omitted scope silently meaning "everything" *was* the
bug. Reproduced end to end, then fixed, in
[test/perCampaignCrews.int.test.js](../server/test/perCampaignCrews.int.test.js) (two campaigns in
one org — the shape no other suite builds).

**Setting a crew happens in exactly ONE place:** a campaign's **Team tab**
([CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) → `PATCH
/admin/campaigns/:campaignId/crew/:userId/coordinator`), where the confirmation quotes *that
campaign's* door count from `previewRestamp` — the same filter the write uses, so the number
promised is the number that moves. Mobile's campaign **Team** screen reads the crew and adds people
to the campaign, but does not change a coordinator. The org **Users** page cannot set one — a single
dropdown cannot be true for somebody on two campaigns — and instead shows a **read-only list, one
row per campaign**, each linking to that campaign's Team tab
(`GET /admin/memberships/:userId/crews`). It also lost its Coordinator column, its coordinator
filter, and the coordinator field on the add-member form. (`PATCH /admin/memberships/:userId` still
*accepts* a `coordinatorId` and drops it on the floor, so an older client gets a clean no-op rather
than writing a field that no longer means anything.)

**The one exception, and it is load-bearing: DEPARTURE never re-stamps.** When a coordinator leaves
the org, [`releaseAssignedWork`](../server/src/services/users/deleteAccount.js) hard-deletes their
own roster rows and clears `Membership.coordinatorId` on their crew — but deliberately leaves the
ledger alone. That stamp is the only remaining record of who supervised those doors. (⚠️ The
`Membership` clear is now vestigial: the field it writes is no longer read, so a departed
coordinator's crew keeps `CampaignAssignment.coordinatorId` pointing at them and *future* knocks
still stamp that team until a lead re-picks. Nothing already counted moves either way; it is the
forward-looking half of "nobody keeps supervising from outside" that the field move left behind.)

**Departure vs. removal are now two distinct rules, and the difference is a real capability:**

- **Deactivated but still on the campaign roster** — the roster row survives, so the crew is **still
  settable**. (This is what un-strands the ~1,700 doors that would otherwise sit in "No team".)
- **Removed from the campaign** — the roster row is **hard-deleted**, so there is no crew there to
  set: the crew routes 404 (*"That member is not on this campaign"*), and `setMemberCoordinator`
  returns `null` on a missing roster row rather than creating one. Their doors keep the team frozen
  on them — the 104-door fix below. To reassign them, **re-add them to the campaign first.**

The distinction exists because the team used to be joined at read time from the **campaign roster**,
which caused two failures:
- Taking a canvasser off a campaign deleted their `CampaignAssignment`, so the join missed and their
  doors silently fell into **"No coordinator"** — the bucket admins deliberately *exclude* when
  reporting a team's number to a client. On the live HD54 campaign this under-reported one team by
  **104 doors**. A canvasser removed from the **org** has no `Membership` at all, so no read-time
  fix could ever recover them. The ledger stamp is what does.
- Moving anyone between teams **retroactively rewrote history**.

The second is now the *chosen* behavior, deliberately, and the first is still fixed — because the
two are different events. A roster change an admin makes on purpose moves the numbers; a person
leaving does not. **The trade you are accepting:** a by-team figure quoted to a client last month
can change if someone is reassigned since — **in that campaign only**. It is reversible — the rule
is idempotent with respect to current state, so setting the crew back restores the numbers exactly —
and every change is recorded in `CoordinatorChange` (who moved whom, **in which campaign**, from
which team to which, how many rows; `campaignId` is nullable because rows written under the old
org-wide model have no campaign to name, and absent means exactly that).
**Campaign totals, coverage, rates and the invoice never move: billing is team-blind.**

**`null` is a real answer, not "unknown"** — a candidate knocking their own district belongs in the
No-team bucket. The one-time *backfill* must never write over an explicit null (see the migration
note below); the *re-stamp* deliberately does, because under the current-coordinator rule a stale
null is just another stale value.

**Assigning a coordinator to someone who is themselves a coordinator** moves that person's **own**
doors off their own team row and onto their new coordinator's. Their crew's doors are untouched.
That is the rule applied consistently — `teamFoldStage` only rescues a lead's own null-stamped rows
onto their own team, and once a real id is stamped there is nothing to rescue — but it surprises an
admin who thinks they are recording an org chart, so the confirmation dialog says so out loud.

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

> ### 🚨 That identity is a TAUTOLOGY. It cannot fail, and it is NOT the verification.
>
> `crossTeamDoors = Math.max(0, teamSum − knocks)`, so `teamSum − crossTeamDoors == knocks` is true
> **by construction** for any `teamSum >= knocks` — and `teamFoldStage` puts every row on **exactly
> one** team, so `teamSum >= knocks` always holds. It therefore prints **✓ over completely wrong
> per-team rows**: doors in the wrong bucket still sum to the same total. This is not hypothetical —
> a lead-set derivation that broke the fold passed this identity while splitting a lead off their
> own team, which is why
> [test/perCampaignCrews.int.test.js](../server/test/perCampaignCrews.int.test.js) asserts the
> **rows**, never the identity.
>
> **The real check is `npm run audit:team-counts`**
> ([auditTeamCounts.js](../server/src/migrations/auditTeamCounts.js)) — read-only, one campaign
> (`-- --campaign=<id>`), one org (`-- --org=<slug>`) or all of them. Two things there have teeth
> the doors column does not:
>
> - **The `survey doors` and `surveys taken` columns have NO cross-team subtraction.** They compare
>   `Σ teams` against the campaign figure raw, so a misfolded row makes them **disagree** — they are
>   the columns that can actually go ✗.
> - **A per-team ROW diff.** Run it *before* and *after* any change that touches the fold, the lead
>   set, or a crew, and compare the per-team rows — not the totals. The campaign total is team-blind
>   and cannot move, so it agrees either way and **proves nothing**.
>
> It also prints a ledger cross-check naming every canvasser who ever knocked, with their state
> (`active` / `deactivated` / `REMOVED FROM ORG` / `account deleted`) and their crew here
> (`own team` / `no team` / `off roster` — `off roster` being the removed-from-campaign case, kept
> visibly distinct from a genuine No-team canvasser).

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
>
> 🚨 **That lead set comes from the LEDGER, scoped to the campaign** — `leadIdsForScope` takes the
> distinct non-null `coordinatorId` on `CanvassActivity` **and** `SurveyResponse` in the same scope
> the aggregates run on (both, or the two halves of `/team-breakdown` fold differently and no sum
> check can see it). Both obvious alternatives are **wrong** now that a crew is per-campaign:
> **`Membership`** has no campaign, so it answers org-wide and would fold a lead's doors onto their
> own team in a campaign where they run no crew at all; **`CampaignAssignment`** is a roster gate
> that is **hard-deleted** on removal, so a lead would lose their own folded doors the moment their
> last crew member came off the roster — the 104-door bug, back through the front door. The stamp
> already on the ledger cannot be un-said, so it survives departure, org removal and roster churn.
>
> **The consequence, and it is intended:** somebody who runs a crew in campaign A but knocks in
> campaign B **without** a crew there no longer folds onto their own team in B — they land in
> **"No team"** there, which is the per-campaign answer. This is the one thing that can move a
> per-TEAM row when the per-campaign crews migration is deployed. Campaign totals are team-blind and
> cannot move.

> 🚨 **The team filter must NOT live in `baseFilter()`.** That result is spread into **Household**
> queries (`/overview`: `{ isActive: true, ...cFilter }`), and a household has no team — a door
> doesn't belong to a crew. Putting the key there matches zero households and **zeroes out
> Coverage**. `effortId` only survives in `baseFilter` because it *is* denormalized onto Household.
> Use the opt-in `crewFilter(req)` / `withTeam(match, team)`, merged only into activity/survey
> matches. **`withTeam` composes with `$and` unconditionally** (`teamMatch`/`withTeam` live in
> `services/reports/aggregations.js`): a spread would clobber a match's own `$or` (the
> cross-timezone date windows) *and* the `none` shape's `userId` key would silently replace a
> canvasser drill's `userId`. `teamMatch` also **casts the `none` bucket's lead ids to ObjectIds**
> — aggregation `$match`es are never schema-cast, so string ids would make the `$nin` exclude
> nothing and double-count every lead's doors into "No team". Wired on: `/canvasser-timeline`,
> `/campaign-rollup`, `/canvassers`, `/knocks-by-pass` (+`.csv`), `/survey-results`,
> `/voters-by-answer` (+`.csv`), `/answer-canvassers`, `/canvassers/:userId/responses`.

> 🚨 **The backfill keys on `{ coordinatorId: { $exists: false } }`, never `{ coordinatorId: null }`.**
> In Mongo `{field: null}` **also matches documents where the field is absent**, so a null key would
> re-stamp *deliberate* nulls on a second run and hand the candidate's doors to a team — the
> migration would reintroduce the very bug it exists to fix. And because an unstamped row is
> invisible to `coordinatorId: <team>` while being swallowed by the No-team bucket, a **half-run
> backfill shows every team at ~zero and No-team enormous** — which looks like data, not an error.
> Hence `Organization.teamAttributionReadyAt`: the team surfaces refuse to render until it's set.
> Deploy order is not a safeguard; a gate is.
>
> ⚠️ **That key governs the one-time BACKFILL only. The re-stamp is the exact inverse and this is
> intentional.** [`restampFilter`](../server/src/services/memberships/restampCoordinator.js) keys on
> `{ coordinatorId: { $ne: next } }`, which *does* overwrite explicit nulls — correct, because under
> the current-coordinator rule a stale null is a stale value, not a deliberate one. It also earns two
> things for free from the same asymmetry: when `next` is a real id, `$ne` matches absent fields too,
> so legacy rows are swept without a second pass; when `next` is `null`, it matches neither absent
> nor explicit-null rows, so clearing a coordinator writes nothing it doesn't need to. **Do not
> "correct" the re-stamp to `$exists:false`** — that would quietly restore the old frozen behavior,
> and every team number would still add up, so no sum-check would catch it.
>
> `teamAttributionReadyAt` now **defaults to now on the Organization schema**. It previously
> defaulted to `null` with the migration as its only writer — and that write sits below two
> `continue` guards, so an org with nothing to backfill never reached it. Every org created after
> that release was therefore gated OFF permanently, with team surfaces silently absent. The default
> lives on the schema, not in the create route, because there are two creation paths
> (`routes/superAdmin/organizations.js` and `utils/seedDemoOrg.js`) and a third would have inherited
> the bug. `repair:team-stamps` sets it for orgs that predate the fix.

**Seeding the per-campaign crews:** `npm run migrate:campaign-coordinators` — `-- --preflight`
(read-only; run first — it also names anyone with knocks in a campaign they hold no roster row for),
no flags (dry run), `-- --apply` (commit), `-- --org=<slug>` to scope any of them. It copies
`Membership.coordinatorId` onto every `CampaignAssignment` row that does not already carry one, so
the day after the migration every campaign answers what the org used to, and from then on the
answers can diverge. Keying on `null` (not `$exists:false`) is right **here**, the inverse of the
ledger backfill above: an unset roster row means "no crew chosen", not "deliberately no crew" —
nothing had ever been able to choose one — and it also means a crew a lead has already set
per-campaign is never overwritten by the stale org value. **It writes ZERO ledger rows**, which is
what makes it re-runnable and reversible-by-doing-nothing: every frozen stamp stays exactly where it
is, so no door changes hands as a result of running it. `CampaignAssignment` also gained
`{campaignId, coordinatorId}` and `CoordinatorChange` `{campaignId, createdAt}`, so
**`migrate:build-indexes -- --apply` is required** (production runs with `autoIndex` off).

**Coverage is never team-scopable.** It's a property of `Household.status`, and a household has no
team.

#### First-finder attribution (the tag team split)

`GET /admin/reports/tag-teams` splits a tag's **distinct voters** by team — the shape everything
above says cannot partition. It can here because it adds a second rule on top of the fold:
after `teamFoldStage`, the pipeline sorts `{submittedAt: 1, _id: 1}` and takes `$first` per
voter, so **the voter belongs to the team on their EARLIEST in-scope tag-carrying response** —
exactly one team per voter, so `Σ(teams) + noTeam === totals` holds for identified AND
still-current by construction ([surveyTagUnits.int.test.js](../server/test/surveyTagUnits.int.test.js)).

Contrast with door attribution: doors use the fold alone (a voter surveyed by two teams belongs
to both rows; `crossTeamDoors` surfaces the over-claim). First-finder never over-claims — a team
keeps a supporter another team later re-knocked ("this team identified N"), which is the owner's
ruling on what "credit" means for people.

Two properties inherited from the stamps, worth stating: the credited team is the stamp on the
earliest tagged response, and **stamps move on crew re-stamps** — a reassignment moves found
voters exactly like it moves doors, so a tag team split quoted last month can shift after one.
And the split honors the same `teamAttributionReadyAt` gate (`ready:false` before the backfill)
and lead fold (`leadIdsForScope`, un-windowed `baseFilter` scope — `crewFilter`'s precedent) as
`/team-breakdown`. The per-CANVASSER analogue remains a designed 400 on `/answer-canvassers` —
no first-finder ruling exists for canvassers, and the codebase must keep refusing until one does.

### Survey DOORS vs survey VOTERS (they are different numbers)

| Number | Source | Meaning |
|---|---|---|
| **Survey doors** | `CanvassActivity.survey_submitted` (`surveyKnocks` / `daySurveys` raw; `billableSurveyDoors` deduped) | doors where ≥1 survey was taken — **the connection-rate numerator** |
| **Voters surveyed** | `SurveyResponse` **distinct `voterId`** (`surveyedVoters`) | people surveyed, counted once each however many rounds — one door can survey several |
| **Surveys taken** | `SurveyResponse` **rows** (`surveysSubmitted` / `surveysTaken` / `dayVoterSurveys`) | forms filled out — a later-round re-survey of the same person is another one |

`connectionRate = (surveyedKnocks + litKnocks) ÷ knocks` — **doors, not voters**. Live check: 273 ÷
1,252 = 22% (voters would give 297/1,252 = 24%, which is not what the app shows).

> ⚠️ **A survey-door count must be DEDUPED server-side — summing the per-canvasser column is not it.**
> Per-canvasser rows are RAW by design (see the `grandKnocks > billableKnocks` guard above), so two
> canvassers who both surveyed one house each carry that door. Summing the column therefore yields a
> survey *event* count, not doors. The Timeline KPI card did exactly this and read **990** where the
> campaign total was **986** — four shared doors, counted twice — while also feeding that raw number
> into a connection rate whose denominator was deduped: two different units in one fraction. The
> deduped figure is `billableSurveyDoors` on `/canvasser-timeline`, the survey-side twin of
> `billableKnocks` and, like it, **underivable in the browser**. Pinned by
> [test/timelineTotals.int.test.js](../server/test/timelineTotals.int.test.js).

Both are correct; the dual ledger is deliberate (see [SURVEYS.md](SURVEYS.md)). But they were both
labelled "Surveys" on different pages, so the same canvasser read 143 on the Timeline and 147 on
Home, and the Home KPI row showed **neither** the number its own connection rate divides by.
(`Surveys` and `Surveyed voters` were also *structurally identical* in a single-round campaign — the
unique index on `{voterId, passId}` allows one response per voter per pass — so one card was always
redundant.)

> ### ⚠️ THREE units, not two — and a one-round campaign cannot tell them apart
>
> `SurveyResponse` is unique on `{voterId, passId}`: **one response per voter per round.** In a
> single-round campaign a distinct-voter count and a raw row count are therefore **numerically
> identical**, which is exactly why every "voters surveyed" surface in the app agreed for months
> while computing different things. Run a second round and they part company.
>
> | Label | Counts | Same voter surveyed in R1 **and** R2 |
> |---|---|---|
> | **Survey doors** | doors with ≥1 survey, per house **per round** | **2** |
> | **Voters surveyed** | DISTINCT `voterId` | **1** |
> | **Surveys taken** | response ROWS | **2** |
>
> Option counts (a yard-sign "Yes") are **response-unit**: asked in both rounds means two signs were
> handed out, so it counts 2. All three are deliberately correct — the rule is that a surface must
> compute the unit its label claims. Locked by
> [test/multiPassUnits.int.test.js](../server/test/multiPassUnits.int.test.js), the only fixture with
> two rounds and one repeat voter; it also pins that a distinct-voter *team* column would break
> `Σ(teams) === campaign`, because `teamFoldStage` puts each response on exactly one team while a
> voter can belong to two.
>
> **The TAG units add a fourth axis: state.** A tag row carries `voterCount` ("identified" —
> distinct voters EVER giving a tagged answer; the R1+R2 voter counts **1**) and
> `currentVoterCount` ("still current" — voters whose LATEST answer still carries the tag; a
> Support→Opposed flipper stays in identified, leaves current). Identified is a voter-unit
> *history* number; current is a voter-unit *state* number, and it is the only count in the app
> that can go DOWN without any data being deleted. See [SURVEYS.md](SURVEYS.md) §I.
>
> **The one sanctioned distinct-voter team split is `/tag-teams`** — legal precisely because it
> does NOT rely on `teamFoldStage` alone: **first-finder attribution** ($sort submittedAt asc +
> $first after the fold) assigns each voter to exactly one team, so `Σ(teams) + noTeam === totals`
> holds for both tag units by construction. That is the documented exception to the pin above
> ([test/surveyTagUnits.int.test.js](../server/test/surveyTagUnits.int.test.js) locks it); the
> per-CANVASSER refusal (`/answer-canvassers` 400s tag mode) still stands — no first-finder
> ruling exists for canvassers.

**The labelling rule, applied everywhere a stat renders:** the door-unit shows as **"Survey doors"**,
the voter-unit as **"Voters surveyed"**, and the response-unit as **"Surveys taken"** — never a bare
"Surveys" next to a number. **The response-unit row was the missing third axis**, and its absence is
what let row counts render under "Voters surveyed" across the app. Swept across:
Home/Dashboard, the Timeline + `CanvasserSummaryTable`, the Team member panel, the org **Overview**
(whose old KPI row rendered the *same voter count twice* under two labels), `TeamBreakdown`, the
campaigns card/table, the org user profile (web modal + mobile), the mobile org dashboard + campaign
detail + canvasser detail/compare/day screens, the super-admin Today card, and the **canvasser's own
My Stats** (voter count beside a door-unit rate — a deep-surveying canvasser read "37 surveys · 95%"
and reasonably concluded the math was broken).

> **2026-08-10 — the third unit reached the two screens that had only two of it.** The campaign
> **Home** Activity row and the org **Overview** (KPI row *and* campaign cards) rendered Survey
> doors + Voters surveyed and no response unit, on the reasoning — recorded in both files — that a
> one-round campaign makes rows and people identical. True, and irrelevant the moment a second
> round is cut: the **Survey results** section counts in the response unit, so a question's
> "N answered" sat above two tiles it could legitimately exceed, with the number that actually
> bounds it nowhere on screen. Both now render all three, `/knocks-by-pass` breaks the response
> unit down per round (`surveysTaken`, new **Surveys taken** column in the table, the invoice CSV
> and the Export Center file), and the Survey-results section states its own total **and its
> scope** — it is filtered by range, walk list, crew *and* pass server-side, and was the only
> section on either client that never said so. Two numbers, deliberately different: the Activity
> tile spans every template and ignores the pass picker; the section caption is template- and
> pass-scoped, which is what makes it the real ceiling for the bars beneath it.

The only bare "Surveys" left are non-stat labels: the
Knocks|Surveys heatmap **view toggles**, the survey-template **library** page/nav, and an activity
**filter chip** — none of them sit next to a number in a different unit.

**Second sweep (the response unit).** The rule above had only two axes, so every row count in the
app was labelled "Voters surveyed" — right in a one-round campaign, wrong the day a second round
re-surveys anyone. Renamed to **"Surveys taken"**: `/team-breakdown`'s payload field
(`votersSurveyed` → `surveysTaken`, kept as `{$sum: 1}` because that is what makes team rows
partition), `CanvasserSummaryTable`, the campaigns card/table, the org user profile (web + mobile),
`CampaignTeamPage`, and the mobile canvasser detail/compare/day screens. Three genuine unit *swaps*
were also fixed — the mobile campaign screen fed `surveysSubmitted` (voters) into a slot its own
hint called "Survey doors"; `CanvasserCard` took door-unit from one caller and voter-unit from
another under a bare "surveys"; and the super-admin Today card rendered a **door** count as "voters
surveyed" on web and bare "Surveys" on mobile. `surveysPerHour` also named two different units in
one app and is now "Survey doors / hour" (mobile timeline) vs "Surveys taken / hour" (server-computed
canvasser detail).

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

**Measured hours (FbTime), when an org opts in.** Each per-day denominator may come from the
connected FbTime clock instead of the knock span — the merge lives in ONE place,
[`services/reports/hoursSource.js`](../server/src/services/reports/hoursSource.js), and routes
never read the connection or the hours cache directly (the `billRestricted.js`
resolver-not-direct-read pattern). The rules, in full in
[FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md):

- Per user-day: the measured hours win when usable (`hours > 0`, not a stale forgotten-clock-out);
  otherwise the span. Absence is never zero.
- The cache holds **shifts (instants), bucketed into local days at read time in the report's own
  anchor timezone** — so hours-days and knock-days share a bucketing by construction, and a
  campaign in any timezone measures. (Formerly day totals stamped with the org's zone, which
  silently estimated every campaign anchored elsewhere.)
- **Campaign-scoped attribution follows the knock ledger** (never FbTime locations): a clocked
  day with no knocks on the scoped campaign counts only inside that canvasser's knock stint there,
  and never on a day they knocked a different campaign. Org-wide reports keep the full union.
  The Integrations mapping screen now *displays* an FbTime project label beside each person's
  campaigns, purely so an admin can sanity-check a pairing — it is a label, never an input to any
  figure on this page, and it is not stored (see FBTIME_INTEGRATION.md, *Recent project labels*).
- Every figure carries `hoursSource`: `measured` | `estimated` | `mixed` — mixed only at the
  labeled per-person grain.
- **Aggregates are all-or-nothing**: a team/campaign rate is measured only when EVERY contributor
  is fully measured, otherwise it is the span figure for everyone, labeled estimated. One blended
  rate is never presented.
- The timeline's per-row `hoursOnDoors` deliberately stays the derived span (shipped builds sum it
  into the KPI tile); the merged figure rides additively as `measuredHoursOnDoors`, and the
  "clients must not re-derive" rule extends to `hoursSource` — clients compose these fields,
  never recompute them.

- **A knock is a historical fact. Losing a person never moves a number.** Deactivating a canvasser,
  removing them from a campaign, removing them from the org, or deleting their account **does not
  change a single count** — not the campaign totals, not the leaderboard, not the invoice. Whether
  someone can still log in is an *authorization* question; what they already did is a *ledger*
  question, and the two are deliberately unrelated.

  **The one staffing action that DOES move a number is changing someone's coordinator**, and it moves
  exactly one thing: which **team row** their doors are counted under (see §F — the current
  coordinator owns all of that canvasser's history). Campaign totals, coverage, every rate, and the
  invoice are untouched, because billing is team-blind. It is reversible by setting the coordinator
  back, and it is recorded in `CoordinatorChange`.

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
- **No soliciting is a knock, never a contact (all campaign types).** `no_soliciting` IS in
  `KNOCK_ACTIONS`, so it counts in `knocks`, `homesKnocked`, `billableDoors` (with no opt-in — the walk
  happened) and the doors/hour numerator, and it appears in the door-outcome breakdown's
  `no_soliciting` bucket, which is what keeps that breakdown summing to `doorsKnocked`. It is **not**
  in either rate numerator: `contactRate` stays `(surveyed + refused) ÷ knocks` and `connectionRate`
  stays `(surveyed + lit) ÷ knocks`, so a no-soliciting door lowers **both** as an unreached knock.
  Surfaced as `noSoliciting` on `/canvassers`, `dayNoSoliciting` on `/canvasser-timeline`,
  `noSolicitingKnocks` on `/knocks-by-pass` (+ the **No soliciting** CSV column), and as its own
  coverage segment on the **knocked** side of the funnel. Two units on purpose: the `*Knocks` buckets
  are `$max`-per-door-pass (a door two canvassers dispositioned differently lands in two buckets, same
  as `refusedKnocks`), while coverage reads the door's single resolved status — only coverage
  partitions.
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

On mobile the thresholds live in **one** exported constant, `RATE_TIERS` — `{ level, min, word,
range }` per tier, best-first. Both `rateFromPct` and `getConnectionRate` derive their level from
it, and the campaign screen prints `word` ("On target" / "Watch" / "Low") in the rate row's sub-line
and the full ladder in its explanation sheet. **These thresholds are now user-visible** — a lead is
told, in the app, that 20% or better is on target — so changing a `min` changes a published promise,
not just a color. Change the numbers here and in `client/src/lib/rates.js` together.

Shared live-refresh contract: [client/src/lib/livePoll.js](../client/src/lib/livePoll.js)
(`livePollOptions` into **every** count query on a live page, `liveStatusProps` so the pill answers
for all of them — see the gotcha in §F).

### Web ([client/src](../client/src))
| File | Renders |
|---|---|
| [pages/OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) | Org Overview. `DateRangeSelector` → `/campaign-rollup?scope=active`. Cumulative `CoverageBar` + StatCards (Households, Houses knocked, **Knocks**, **Survey doors**, **Surveys taken**, **Voters surveyed**, **Connection rate**, Lit drops, Active canvassers — all three survey units, per §G). Per-campaign `CampaignCard` rows carry the same three. Per-campaign `CampaignCard` rows + `CoverageBar`; archived rows show Knocks. |
| [pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Campaign detail. **Activity** (range, `/campaign-rollup?campaignId`): Knocks, Survey doors/Lit drops, **Surveys taken**, Voters surveyed, Connection rate — all THREE survey units, per the labelling rule in §G. **By pass** (range, `/knocks-by-pass` — same window + effort filter as Activity, so the rows sum to the same headline): walk list × round table (Knocks, Survey doors/Lit drops, **Surveys taken** — survey campaigns only, Conn %, New homes reached) + TOTAL `tfoot` + **Export CSV** (`/knocks-by-pass.csv`, raw fetch + blob — the SurveyExplorer pattern); hidden while `rounds` is empty. **Coverage** (all-time, `/overview`): households + homesKnocked + `CoverageBar`. |
| [components/PassManager.jsx](../client/src/components/PassManager.jsx) | Per-pass table (both mounts — PassesPage full view + Walk Lists drawer): **Knocks, Survey doors** (**Lit drops** on lit-drop campaigns — `campaignType` prop threaded from PassesPage/EffortsPage), **Conn %** from the enriched `GET /admin/campaigns/:id/passes` (see [PASSES.md](PASSES.md)). |
| [components/CanvasserTable.jsx](../client/src/components/CanvasserTable.jsx) | Leaderboard table: Surveys, Lit drops, Not home, Wrong addr, **Knocks**, **Connection**, Last activity. |
| [pages/DuplicateSurveysPage.jsx](../client/src/pages/DuplicateSurveysPage.jsx) | **Duplicate surveys** (`/admin/duplicate-surveys`): voters with >1 response. Compact cards (both flag badges render — never one behind the other), `Segmented` kind filter, ledger-first canvasser `<select>`, `DateRangeSelector` (opens on **All time**), shared `Pager` off the `skip`/`limit`/`total` contract. Fix path is **Open voter** → profile → delete. |
| [components/GoalStrip.jsx](../client/src/components/GoalStrip.jsx) | **Door goal** in the campaign Home HEADER, sharing ONE wrapping row with the key-date pills under the type/state line: bar, percentage, done/target, doors left, need /day. Renders the `goal` block verbatim — no arithmetic, and no verdict, trailing rate or projection (all three removed 2026-08-15). **The placement carries the meaning**: this is the ONLY number on the page that ignores the range/walk-list/crew pickers, and it sits in campaign-identity space (beside Election Day and early voting, which are equally filter-immune) rather than among the filtered numbers. The old body card's explanatory footer is gone with it; the sentence lives in `metricHelp.doorGoal` behind the (i). Names its own goal date **only** when `deadlineSource === 'goalDate'` — on the Election Day fallback the countdown pill beside it already says so. Words + colors from [lib/goalPace.js](../client/src/lib/goalPace.js); compact `GoalCell`/`GoalBlock` for the campaigns table/cards are exported from `campaigns/CampaignCard.jsx`. |
| [components/CoverageBar.jsx](../client/src/components/CoverageBar.jsx) | Segmented bar + numeric legend (counts + %). |
| [components/StatCard.jsx](../client/src/components/StatCard.jsx) | `label / value / hint / accent`. |
| [pages/TimelinePage.jsx](../client/src/pages/TimelinePage.jsx) + [components/CanvasserSummaryTable.jsx](../client/src/components/CanvasserSummaryTable.jsx) + [components/TimelineGrid.jsx](../client/src/components/TimelineGrid.jsx) + [components/TimelineOverlaps.jsx](../client/src/components/TimelineOverlaps.jsx) | **Timeline** (`/campaigns/:id/timeline`, `/canvasser-timeline`): live performance dashboard — KPI strip (Doors, Surveys, Connection rate, Doors/hr, Knocking N of M), sortable per-canvasser table (coordinator, rates, pace, start/last door, a **Restricted** tally column from `dayRestricted`), heatmap grid (hour columns for a day, day columns for a range), date-range presets **incl. All time** (campaign-to-date: swaps the grid + overlap cards for totals — see the `?totals=1` mode above) + single-day stepper, coordinator crew filter (**server-side** `?coordinatorId` — a deduped billable figure cannot be summed in the browser; overlaps card stays campaign-wide), a **by-team breakdown table** (`/team-breakdown`) with the reconciliation footer + an "← All teams" bar when a team is picked, Knocks/Surveys toggle, inline overlaps reconciliation. **Coordinator names come from the LEDGER** (`coordinatorId` stamped on each knock), NOT from the campaign roster — the old `useCampaignTeam` join blanked the column for anyone taken off a campaign. `useCampaignTeam` survives only for the "Knocking N of M" roster denominator. **Live refresh:** every count query on the page spreads `livePollOptions()` and the pill is built with `liveStatusProps([...all of them])` — see §G. First web overlaps surface. |

### Mobile ([mobile/app/(app)/admin](../mobile/app/(app)/admin))
| File | Renders |
|---|---|
| [index.jsx](../mobile/app/(app)/admin/index.jsx) | Org Overview. `DateRangeBar` → `/campaign-rollup`. Cumulative card: `CoverageBar` + two stat rows (Knocks/Surveys/Surveyed; Connection/Lit/Canvassers). `CampaignCard`: full `CoverageBar` + coverage line + inline (knocks/surveys/voters/conn/canv); archived rows show knocks. `RowAccessory` adds a **door-goal** bar under the coverage bar, tagged *"all time"* because every other number on the row honors the range picker. |
| [campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | **Door goal** as a two-line pressable inside the key-dates block, beside `ElectionCountdownChip` and **above** `DateRangeBar` and both filter switchers — bar, percentage, done/target, verdict, then need/doing/late. Same placement argument as the web strip: it is the only number on the screen the filters below don't touch. Tapping opens the shared `MetricSheet` with `metricHelp.doorGoal`, which is where the all-time sentence lives now that the group's caption is gone. Prints its own deadline only when `deadlineSource === 'goalDate'`. Words from [mobile/lib/goalPace.js](../mobile/lib/goalPace.js), the hand-mirrored twin of the web copy; **Activity** tiles (Knocks, Survey doors/Lit drops, **Surveys taken**, Voters surveyed, Connection rate via `rateFromPct`) from rollup; **By pass** card (`/knocks-by-pass` over the same range — one row per walk list × round: knocks + "Conn N%"/"Lit N%"); **Coverage** (all-time) from overview; Top canvassers from `/canvassers`; "Timeline" quick-link. |
| [timeline.jsx](../mobile/app/(app)/admin/timeline.jsx) + [components/LiveStatus.jsx](../mobile/components/LiveStatus.jsx) | **Timeline** (`/canvasser-timeline`): live performance dashboard at web parity — KPI tiles (`KpiGrid`: Doors, Surveys, Connection rate via `rateFromPct`, Doors/hr, Knocking N of M), per-canvasser cards (coordinator, `dayKnocks/daySurveys/connectionRate`, `hoursOnDoors`·doors/hr, `formatRange` shift line; tap → canvasser detail), `DateRangeBar` presets **incl. 'all'** (campaign-to-date: `?totals=1`, grid hidden) + single-day stepper, walk-list + coordinator `TabSwitcher` crew filters (the coordinator filter is **server-side** `?coordinatorId`, same as web; the option list is a union of the roster and the coordinators actually stamped on the ledger, so a departed canvasser's team still appears; overlaps stay campaign-wide with a note). **No by-team breakdown table** — that surface is web-only, Knocks/Surveys toggle, frozen-name-column heatmap grid (hour columns single-day, day columns for a range — `data.mode` guarded), reconciliation + overlap cards (`overlapCount` true total), `LiveStatus` pill (20s poll while the range includes today, pause/refresh) + `useFocusedPoll`. Reloads the campaign on focus + accepts a `campaignId` param. |
| [overlaps.jsx](../mobile/app/(app)/admin/overlaps.jsx) | Renders `overlaps[].passes[]` grouped by `roundLabel`. Campaign scope comes from the shared `CampaignChip` (archived campaigns included) + a focus re-sync — the screen previously had **no picker at all**, taking the cached pick via `useAdminCampaign()`, so an empty or unmanaged cache dead-ended it and its empty state told you to "pick a campaign you manage from the Overview", which never writes that cache. The resolving frame also needed its own branch: `/overlap-doors` is `enabled: !!cId`, and a disabled react-query is pending-but-not-fetching, so `isLoading` is false and the chain fell through to "No overlap 🎉" while the campaign was still being read off disk. |
| [duplicate-surveys.jsx](../mobile/app/(app)/admin/duplicate-surveys.jsx) + [components/DuplicateVoterCard.jsx](../mobile/components/DuplicateVoterCard.jsx) | **Duplicate surveys** (`/duplicate-surveys`): voters with >1 response, collapsed cards that expand to who/when/round. Kind + canvasser `TabSwitcher`s, `DateRangeBar` (opens on **All time**), "Load more" off the `skip`/`limit`/`total` contract. Org admins delete a response in place (`DELETE /admin/voters/:id/surveys/:id`); leads read-only. |
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
snapshot restore, bulk-restrict/unrestrict, restrict-doors/unrestrict-doors (single-home desk marks),
admin survey delete, demo staging) triggers a full per-campaign recompute. Locked by
[test/campaignStats.int.test.js](../server/test/campaignStats.int.test.js) — parity against an
independent ledger recompute after every operation type.

**The recompute oracle is ORG-SCOPED** (`computeCampaignStats` matches `organizationId` +
`campaignId`), because every live reader is — `/campaign-rollup`'s fallback, `/knocks-by-pass` via
`baseFilter`, the timeline. It once matched on `campaignId` alone, so it answered a marginally
*wider* question than the dashboards it feeds: a row with the right `campaignId` but a missing or
foreign `organizationId` counted toward the cached card while staying invisible to every live
report. That flavour of drift was **un-repairable** — the drift check recomputed with the same wide
match, agreed with the inflated number, and reported "nothing to do" — so the counter could sit one
knock above the live per-round table indefinitely. Scoping both sides identically is what makes
"identical by construction" above literally true, and it is what makes any surviving disagreement
real drift a reconcile can actually fix.

**Who reads them:** `/campaign-rollup` with no date window, no effort filter, and no crew filter
(knocks quadruple, `litDropped`, `activeCanvassers`, `lastActivityAt`); `/overview`'s knocks +
survey volume; and `campaignSummaries.hasCanvassed` (the archive/delete gate). Date-ranged,
effort-scoped, and crew-scoped (`?coordinatorId`) requests always use the live pipelines (a scalar
counter can't be windowed, and a crew has no counter), as do DISTINCT counts (surveyed voters,
ranged active canvassers).

**Fallback, not failure:** a campaign whose `stats.reconciledAt` is null (created before the
feature) makes the whole request fall back to the live aggregation — counters are exact or unused,
never approximate. Seed/repair with `npm run migrate:campaign-stats -- --apply`
([migrations/reconcileCampaignStats.js](../server/src/migrations/reconcileCampaignStats.js); the
dry run lists unseeded/drifted campaigns). `reconcileCounts --apply` also re-syncs stats after its
ledger dedups. Known limit: two truly simultaneous writes on the same (household, pass) can drift a
pair counter by 1 until the next reconcile — documented in the service header.

**The reconcile runs NIGHTLY** (`CAMPAIGN_STATS_JOB`, 04:07 UTC, `CAMPAIGN_STATS_CRON`) — registered
in `MAINTENANCE_JOBS` in [services/retention/scheduler.js](../server/src/services/retention/scheduler.js)
and deliberately **kept out of `REPEATABLE_JOBS`** (the `/health/retention` banner reports on every
entry there, so a counter reconcile going quiet must never read "Retention: NOT ENFORCED"). Both the
job and the `migrate:campaign-stats` CLI call the same `reconcileAllCampaignStats` sweep, so an
operator's dry run and the scheduled repair can never disagree about what "drifted" means. The job
logs at `warn` naming each campaign it repaired: a counter that drifts *every* night is a bug in the
bump hooks, and the log line is the only way anyone would find out.

**Why it is scheduled rather than run on demand:** counter drift is **silent**. Nothing errors — the
Home card simply renders a stale number that disagrees with the live By-round table directly beneath
it, and the disagreement is only visible to someone comparing the two. A real campaign shipped a
client report reading 4,138 knocks / 987 survey doors against a live 4,136 / 986 for exactly this
reason. `surveyedVoters` was unaffected, being the one Activity figure that never touches the cache
— which is also the quickest way to recognise the failure mode.
