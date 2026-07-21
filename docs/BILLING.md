# Billing & entitlements (subscriptions, the account-manager console, access gating)

Related: [CAMPAIGNS.md](CAMPAIGNS.md) (archiving — it ends a campaign's billing),
[METRICS.md](METRICS.md) (the billable knock — the same counting feeds the statement),
[PLATFORM.md](PLATFORM.md) (the super-admin console this lives in),
[CLIENT_PORTAL.md](CLIENT_PORTAL.md) (share links — they die with a suspended org).

# Part 1 — For everyone

## What Doorline charges

**$300 per campaign per month** by default. The rate is negotiated, and it is set at **two levels**:
per organization, and — for a firm running races of very different sizes — **per campaign**. A
governor's race and a school-board race inside one client can carry different numbers.

A campaign starts billing in the calendar month of its **first field visit** — a knock, or a
restricted home a canvasser walked to and couldn't get into — and keeps billing through the month
it's **archived**. Setup months — created, imported, turf cut, but nobody in the field yet — are
free. Marking a book restricted from your desk is not a field visit and doesn't start anything.
Every billing surface shows **Billing started** per campaign so you can see the date it began (or
that it hasn't).

The price never depends on how many doors were knocked — it's a flat rate per active campaign per
month. (Separately, if *you* invoice your own client per door, see **Billable doors** in
[METRICS.md](METRICS.md) — that setting changes your reports, not your Doorline bill.)

**Customers never see a price in the app.** The org's Billing page shows account status and which
campaigns are canvassing; every dollar figure is stripped server-side. Pricing is a conversation with
the account manager, not a dashboard number.

### The month is a calendar month, and it is never prorated

"Per month" means the **calendar month** — not a 30-day cycle, and not an anniversary date counted
from your first knock. February costs the same as March. Nothing is ever billed by the day.

Proration was considered and deliberately rejected. A two-week GOTV blitz is the common shape of
this work, and day-counting would bill the most intense fortnight we ever serve at half price. The
market agrees: i360 requires a "one-month minimum payment" on add-ons, and state-party VoteBuilder
states flatly that "fees will not be prorated." Instead, two **grace rules** handle the edges, and a
**floor** keeps them honest.

**Start grace — the last week of a month is free.** A first field visit in the **last 7 days** of a
month makes that month free; billing starts on the 1st of the next one. Knock your first door on
January 28th and January costs nothing.

**End grace — archive promptly and the new month is free.** A campaign archived in the **first 3
days** of a month, **with nobody out that month**, doesn't owe that month. The zero-visit condition
is the whole point: knock on the 1st and 2nd, archive on the 3rd, and that is real work — it bills.

**Floor — a campaign that went to the field always bills at least one month.** Both graces can fire
on the same short campaign (first knock Oct 29, archived Nov 2, nobody out in November) and would
otherwise net to free. The first-visit month bills instead. There is no such thing as a free
campaign that knocked a door.

Everything else is unchanged:

- Month boundaries follow **the campaign's own timezone**, so a 9pm knock on Jan 31 in Denver is a
  January knock, not a February one.
- A campaign archived on **March 20th** still bills the full month of March.
- **Between the start and the archive, a campaign bills every month — whether or not anyone
  knocked.** A quiet month still costs full price; there is no "pause". A campaign that went quiet
  in June and was left alone until December bills for all seven months. **Archiving is the only
  thing that stops it**, which is why the Campaigns page nudges you to archive once a campaign's
  election day has passed.

Universe size is **not** priced and never enforced by the software. The "up to ~10,000 households
per campaign" figure some contracts carry is a sales guideline; bigger universes are a
conversation and, if agreed, a negotiated rate — nothing in the app blocks them.

### Issued statements — what you actually invoiced

Every other number in this system is computed **live**, which is right for a running meter and wrong
for an invoice: renegotiate a rate, or reactivate an archived campaign, and what "March owed"
silently changes months later. So a closed month can be **issued**, which freezes it. From then on
that month reads from the frozen record, and any later divergence shows up as a **drift warning**
rather than quietly rewriting the past. Statements are never edited — a wrong one is **voided with a
reason** and reissued, and both rows survive.

Only closed months can be issued (with a deliberate `force` override for a prepay or an early
close-out), and internal orgs never can. **Close the month** at `/super-admin/billing` shows every
org's issued / not-issued / drifting state for one month.

## Trials, and what each account state means

Every new organization starts a **free trial** with full access — **7 days by default, but you can
set any length** (e.g. 14 days) when you create the client, and extend it later to any number of
days or an explicit end date. The trial clock starts when the org is created. When a trial ends
without conversion the org automatically becomes **read-only** — nothing is deleted, nobody is
locked out of *seeing* their work, but recording, importing, and cutting stop until the account is
activated.

| State | What the org experiences |
|---|---|
| Trial | Full access; a countdown banner appears in the final 3 days. |
| Active | Full access, no banners. |
| Past due | Full access plus a persistent "invoice past due" banner — grace, not punishment. Suspending is a human decision. |
| Suspended | **Read-only.** Admins can see everything they built; recording/imports/cuts are disabled; public share links stop resolving. Data is never deleted. |
| Canceled | The org is closed — login lands on a contact notice. Data is retained. |
| Internal | Doorline's own and demo orgs: permanently free, never gated, never on a statement. |

A canvasser mid-shift when an org is paused is treated fairly: **work recorded while the org was
entitled always uploads**, even from the offline queue — only *new* dispositions are blocked (the
buttons disable, with a notice).

## Who manages this, and where

Account managers are **super admins**. The Organizations page gets a Billing column (status pill +
Manage) and a "Needs attention" strip (trials ending within 48 hours, past-due, suspended); the
Control Room shows the same pills on its org cards. Clicking Manage opens the org's **Billing
panel**: change status (suspend/cancel require a written reason — every change is kept in a
history), set a **custom trial length**, set the org's rate, and keep an internal billing contact +
notes (both **super-admin-only** now — org admins no longer see or edit the billing contact),
see a **"this month" usage meter** (billable campaigns × rate), and read the **monthly statement**
— one line per campaign with households, first knock, the month's knocks, and the amount —
exportable as CSV for invoicing. Payment itself happens outside the app (send an invoice — Stripe
Invoicing works well); the app tracks *entitlement*, not money.

When an invoice needs the knock detail *behind* a campaign's line — which walk list and which pass
the work landed in — the campaign dashboard's **By pass** section exports exactly that
(`knocks-by-pass.csv`: one row per walk list × pass plus a TOTAL row, counted by the same rule as
the statement's knocks; optionally per canvasser per pass). It's supporting detail, not a price
input — **pricing is unchanged** ($300 per campaign per month); the statement stays the billing
document. See [METRICS.md](METRICS.md) (Part 1 "By pass").

**Onboarding a new client is one step:** creating the org also seats its **first admin** (name +
email — they get a **set-password invite by email**, valid 72 hours, and choose their own password;
optionally type a simple temp password instead to hand over out-of-band, shown once, for a client
who can't receive email — left blank, no credential exists anywhere) and starts the trial at your
chosen length. Without this the org would have no admin and no way to seat one (adding members
needs an existing admin).

**Not every admin sees billing.** Billing is gated per-admin by a **billing-access** flag — only
the people who actually pay the bill. The seated first admin gets it; other admins don't until a
billing admin grants it (on the Users page). Org admins with access see their side on the
**Billing** page: account status, the trial countdown, how many campaigns are canvassing this month,
how many are still in free setup or on the start grace, and their own billable-doors setting.
**No dollar amounts** — not the rate, not a running total, not a per-campaign figure. Rates, status
changes, and statements are deliberately not theirs to see or touch.

# Part 2 — Technical reference

## Models

| Model | File | Fields that matter |
|---|---|---|
| `Subscription` | [models/Subscription.js](../server/src/models/Subscription.js) | One per org (`organizationId` unique). `status` (`trial`/`active`/`past_due`/`suspended`/`canceled`/`internal`), `statusChangedAt` (the offline-grace boundary), `trialEndsAt`, `pricePerCampaignCents` (default 30000 — per-org override), `billingContact{name,email}`, `notes` (internal, super-admin-only), `source` (`manual`/`stripe` — webhooks may only write when `stripe`, so manual wins), `stripeCustomerId` (dormant). |
| `SubscriptionEvent` | [models/SubscriptionEvent.js](../server/src/models/SubscriptionEvent.js) | Append-only audit: `fromStatus`/`toStatus` or `changes` (Mixed), `byUserId`, `reason` (required by the route for suspend/cancel). Indexed `{organizationId, createdAt}`. |
| `Campaign.archivedAt` | [models/Campaign.js](../server/src/models/Campaign.js) | Set when `isActive` flips false (route: [admin/campaigns.js](../server/src/routes/admin/campaigns.js)), cleared on reactivate. The statement's "bills through the archive month" boundary. `migrate:billing` backfills `updatedAt` for legacy archived campaigns. |
| `Campaign.pricePerCampaignCents` | [models/Campaign.js](../server/src/models/Campaign.js) | Tri-state per-campaign rate: `null` = inherit the org rate, a number = negotiated override, **`0` is legal** (a comped campaign). **`select: false`** — see the privilege note below. |
| `Statement` | [models/Statement.js](../server/src/models/Statement.js) | A **frozen** issued month. `organizationId` + `month` + `status` (`issued`/`void`), frozen `rateCents` / `rulesVersion` / `totalCents` / `lines[]`, `issuedAt`/`issuedByUserId`, `externalRef`, `voidedAt`/`voidedByUserId`/`voidReason`, `supersededByStatementId`. Indexes: `{organizationId, month}` **unique with `partialFilterExpression: {status:'issued'}`** (one live issued row per org-month, unlimited voids) and `{organizationId, month:-1}`. |

### Billing rules — `billingMonths.js`

[services/billing/billingMonths.js](../server/src/services/billing/billingMonths.js) owns *which
months a campaign bills*, as **pure string math** on `'YYYY-MM-DD'` / `'YYYY-MM'` values already
resolved in the campaign's timezone by `zonedDayStr`. That is exactly equivalent to the `Date`
comparisons it replaced (the window came from `zonedDayRange` over the same month) and is what makes
every calendar boundary unit-testable without a database
([test/billingMonths.test.js](../server/test/billingMonths.test.js)).

`START_GRACE_DAYS = 7`, `END_GRACE_DAYS = 3`. `decideMonth(facts)` returns `{billable, reason,
startMonth, floorMonth}` where `reason` is one of:

| Reason | Meaning |
|---|---|
| `no-field-visit` | never canvassed — a setup-only campaign, free forever |
| `before-start` | this month precedes the billing start month |
| `start-grace` | first visit landed in the last 7 days of this month → free |
| `billable` | ordinary billable month |
| `end-grace` | archived in the first 3 days with zero visits this month → free |
| `floor` | both graces fired; this is the one month that bills anyway |
| `archived-earlier` | archived before this month began |

Two things that look like details and are not:

- **"Did anyone go out this month" must be flag-independent.** It reads `knockAgg[0].billableDoors`
  (every distinct `(household, pass)` group, restricted marks included) — **not**
  `billableDoorsOf()`, which collapses to the knock count when `billRestrictedDoors` is off. Reading
  it through the helper would make a month of non-bulk restricted marks look empty and win a free
  month, contradicting the flag-independence rule the first-visit clock already follows.
- **The floor sometimes needs a fact about a different month.** Establishing whether the floor
  applies to month F can depend on whether anyone went out in F+1. `needsStartMonthVisitCount()`
  returns that month (or `null`) so `statement.js` knows to run one extra existence probe, and the
  rule module stays DB-free. It fires only for a campaign that got a start grace *and* was archived
  within the first 3 days of the very next month.

`RULES_VERSION` (in `statement.js`) is **3**: v1 = first knock → archive month; v2 = a non-bulk
`restricted` mark also starts the clock (Jul 2026); v3 = grace + floor. Bump it when billing
*semantics* change, not when code moves — it's frozen into every issued statement so an old invoice
can still explain itself.

**The two grace constants are duplicated client-side** in
[components/ArchiveNudge.jsx](../client/src/components/ArchiveNudge.jsx) (`END_GRACE_DAYS`), because
this repo has no shared client/server module. If either constant moves, both call sites move.

### Rate resolution — `rate.js`

[services/billing/rate.js](../server/src/services/billing/rate.js), shaped like
[billRestricted.js](../server/src/services/reports/billRestricted.js): campaign override → org
`Subscription.pricePerCampaignCents` → `DEFAULT_RATE_CENTS` (30000). Explicit null/undefined checks,
never `||` — **`0` is a legal rate** and `||` would promote a deliberately comped campaign back to
$300. The async form is org-scoped (`findOne({_id, organizationId})`, never `findById`).

`monthlyStatement` resolves the rate **inside** the per-campaign loop; each line carries its own
`rateCents` plus the raw `pricePerCampaignCents` (so the UI can distinguish "negotiated" from
"inherits"). The statement's top-level `rateCents` remains the **org default**, so nothing may
compute `totalCents` as `billableCount × rateCents` — the panel's totals row and the org-list rate
column were both corrected for this.

> **Privilege note.** `Campaign.pricePerCampaignCents` is `select: false` deliberately.
> [admin/campaigns.js](../server/src/routes/admin/campaigns.js) returns campaigns by spreading a lean
> doc (`...c`) and returns the mongoose doc from `PATCH`, and **org admins and team leads reach that
> router** — without `select: false` the negotiated price would appear in their responses the moment
> the field existed. Writes live only on
> [superAdmin/billing.js](../server/src/routes/superAdmin/billing.js) (`GET/PATCH
> .../billing/campaigns/:campaignId`), and mongoose skips unselected paths on `save()`, so an
> org-admin PATCH can never clear it. Asserted in
> [test/statement.int.test.js](../server/test/statement.int.test.js).

### Issuing, voiding, drift

`POST .../billing/statement/:month/issue` freezes a month. Guards in order: malformed month → 400;
internal org → 403 (checks **both** `org.isInternal` and `sub.status === 'internal'`, since the
rollup filters on one and the status chokepoint on the other); `month >= currentMonth()` → 422
unless `force`; a cheap already-issued pre-check → 409. **The real race guard is catching
`err.code === 11000`** from the partial unique index — there are no Mongo transactions in this
codebase, so single-document atomicity does the work, and two concurrent issues resolve to exactly
one 201 and one 409 (asserted).

The not-ended guard is a deliberate approximation: `currentMonth()` is UTC while each campaign's
month boundary is its own timezone, so a behind-UTC org's October can be issued during the first
hours of Nov 1 UTC. `force` covers the real cases (prepay, early close-out).

`POST .../billing/statement/:statementId/void` requires a `reason` (same precedent as suspend/cancel)
and claims the row atomically with `findOneAndUpdate({_id, organizationId, status:'issued'})` — the
`organizationId` in the *filter* is what blocks a cross-org void, and `status:'issued'` turns a
double-void into a clean 409.

`GET .../billing/statement?month=` returns `{...live, statement, drift}` — the live result stays
spread at the top level so existing consumers are untouched.
[services/billing/statementDrift.js](../server/src/services/billing/statementDrift.js) is a pure
diff used by **both** the org panel and the month-close board, so the two can never disagree about
what "drifting" means. `drift.material` is true only when `totalCents` moved; a late offline flush
that shifts `knocksThisMonth` is reported but doesn't raise an alarm.

`GET /super-admin/billing/statements?month=&live=0|1`
([superAdmin/statements.js](../server/src/routes/superAdmin/statements.js), mounted **before** the
`/super-admin` catch-all in `routes/index.js` or it gets swallowed) is the month-close board. The
default is three queries and no statement walks; `live=1` recomputes every org and is
`O(orgs × campaigns)` round-trips — strictly worse than `billing-rollup` — so it is opt-in behind a
button with no auto-refetch.

## Effective state — `entitlementFor()`

[services/billing/entitlement.js](../server/src/services/billing/entitlement.js) is the single
place the rules live. Pure function, **no cron**: a `trial` past `trialEndsAt` *is* `suspended`,
computed at read time. Returns `{ effective, canWrite, canCanvass, banner, trialDaysLeft }`;
`banner ∈ null | trial | trial_expired | past_due | suspended | canceled`. Two fail-open rules: a
**missing Subscription** (org predates the migration) and an **unknown status** both resolve to
full access — billing must never lock an org out by accident. `shareLinksBlocked(orgId)` wraps the
same resolution for the no-login share portal.

## The gate — `requireEntitlement`

[middleware/entitlement.js](../server/src/middleware/entitlement.js), mounted in
[routes/index.js](../server/src/routes/index.js) on `['/admin', '/mobile']` right after the auth +
password gates — super-admin surfaces are exempt. Org resolution mirrors `orgContext` (the
`X-Org-Id` header, else the single-active-membership auto-pick) without its extra queries; one
indexed `Subscription.findOne` per request. Rules, in order:

1. Super admins bypass entirely.
2. `canceled` → **402** on everything (reads included).
3. Non-mutating methods (GET/HEAD/OPTIONS) always pass — read-only means read-only.
4. Writes pass when `canWrite`.
5. **Sync-boundary grace**: a `/mobile` write whose `body.timestamp` predates
   `statusChangedAt` passes — a canvasser's offline queue recorded while entitled always
   flushes. Mobile-only, so an admin write can't smuggle an old timestamp.
6. Otherwise **402** `{ code: 'subscription-inactive', status }` — the one code both clients
   translate to friendly copy.

The middleware attaches `req.entitlement`/`req.subscription`; `/mobile/bootstrap` and
`/mobile/campaigns` echo `entitlement` in their payloads (null for super admins). The share portal
gates separately in `loadShare` ([public/share.js](../server/src/routes/public/share.js)) — 410
when suspended/canceled, alive through `past_due`.

## Statement math

[services/billing/statement.js](../server/src/services/billing/statement.js) —
`monthlyStatement(orgId, 'YYYY-MM')` owns the **queries**;
[billingMonths.js](../server/src/services/billing/billingMonths.js) (above) owns the **rule**. Per
campaign, in the **campaign's own timezone** (`zonedDayRange`, [TIMEZONES.md](TIMEZONES.md)), it
resolves `firstVisitDay` / `archivedDay` / `visitsThisMonth`, runs the conditional F+1 probe when
`needsStartMonthVisitCount` asks, and hands the facts to `decideMonth`. Each line carries the
resulting `reason` and its own `rateCents`. `knocksThisMonth` reuses `knocksPipeline` — the same
distinct (household, pass) counting as everywhere else ([METRICS.md](METRICS.md)); `households` is
reported for visibility, never priced.

`currentUsage` adds `graceCount` alongside `setupCount`: a start-grace campaign appears in neither
`billing[]` nor `setupCount`, so without it a $0 line would be invisible on the meter and the first
question an account manager asks about a free campaign is "why".

`publicUsage(usage)` is the **customer-facing projection** — the same numbers with every dollar
figure removed. [admin/billing.js](../server/src/routes/admin/billing.js) returns that, and
`publicView` no longer sends `pricePerCampaignCents`. The money leaves the *payload*, not just the
page; [test/billingAccess.int.test.js](../server/test/billingAccess.int.test.js) asserts its absence
negatively so a regression fails loudly.

**First field visit** (revised Jul 2026) = the earliest `KNOCK_ACTIONS` row **or** the earliest
**non-bulk** `restricted` mark, whichever came first (`BILLABLE_WITH_RESTRICTED` + `NOT_BULK`). A
canvasser who walks to a gated community and finds it locked made the trip, so the clock starts.
Two things this is *not*:

- It is **independent of the `billRestrictedDoors` opt-in** below. That flag decides what appears on
  the org's own invoice totals; when *Doorline* starts charging is not a customer-tunable number.
- It does **not** extend to bulk marks. An admin bulk-restricting a whole book from the Turf Cutting
  page ([turfs.js](../server/src/routes/admin/turfs.js), the only `via:'bulk'` writer) is desk work,
  and must never start an org's billing clock before anyone has walked. Notes still never start it.

### No periods, no proration, no renewal job

There is deliberately **no subscription-period machinery** — no `periodStart`/`periodEnd`, no
`billingStartedAt` column, no billing cron. `Subscription` holds *status and rate*, not a cycle.
Every month is evaluated independently and on demand from raw `CanvassActivity`, so there is nothing
to "roll over" and nothing to renew. (The only persisted record is a **`Statement`**, and it is
written by a human pressing Issue — never by a job.)

Two consequences that follow directly from `amountCents = billable ? rateCents : 0` (a boolean × a
flat rate):

- **No proration, either edge.** `monthDayBounds` only produces the month's first/last day; no code
  path divides by days elapsed. The grace rules move whole months in or out; they never split one.
- **Activity is not required to re-bill.** Once past the start month, the decision never consults
  `knocksThisMonth` except for the end grace. A started campaign bills every subsequent month until
  `archivedAt` lands before the month began.

⚠️ Un-issued months are computed **live**, so a rule change is retroactive: a past month can flip.
Before deploying a change here, diff `GET /super-admin/organizations/billing-rollup` — and check the
**month-close board** for issued months, which will now surface the change as drift instead of
absorbing it silently.

⚠️ Two ordinary admin actions rewrite any month that has **not** been issued:

- **Reactivating an archived campaign** clears `archivedAt`
  ([campaigns.js](../server/src/routes/admin/campaigns.js) — `campaign.archivedAt = data.isActive ? null : new Date()`),
  so every month it sat archived becomes billable again the next time a statement is read.
- **Changing a rate** (org or per-campaign) re-prices all un-issued history, since `monthlyStatement`
  resolves the *current* rate for whatever month you ask about.

**Issuing a month is the fix.** An issued `Statement` freezes `rateCents`, `rulesVersion`,
`totalCents` and every line, and both actions above then show up as
[drift](#issuing-voiding-drift) against it rather than quietly changing what you invoiced. Months
you never issued still have no snapshot to reconcile against — issue the ones you bill from.

`firstKnockAt` is surfaced as the **"Billing started"** indicator on both billing surfaces (the
super-admin `OrgBillingPanel` statement table and the org admin's own Billing page), reading
"Not started" when null — previously it was computed and returned but never shown.

### Billable doors — the customer's OWN invoicing (not ours)

Orgs that invoice their client per door can opt to count **restricted** homes, since the canvasser
made the walk. `Organization.billRestrictedDoors` is the org-wide default (set by a billing admin via
`PATCH /admin/billing/settings`); `Campaign.billRestrictedDoors` is a **tri-state** override (`null` =
inherit). **Both default to off**, so nothing changes for an org that never opts in — with the flag
off `billableDoors === knocks` bit-for-bit.

Statement lines carry `billableDoorsThisMonth`, `restrictedDoorsThisMonth`, and the resolved
`billRestrictedDoors` for display. **None of them are ever priced** — `amountCents` remains
`billable ? rateCents : 0`, a boolean × flat rate. The full counting semantics, and the invariant
that no rate or coverage number moves, are in [METRICS.md](METRICS.md).

Per-round supporting detail for a statement line comes from
`GET /admin/reports/knocks-by-pass` / `.csv` ([METRICS.md](METRICS.md) §E) — the same pipeline with
`byPass: true`, so Σ(rounds) equals the campaign total **by construction** and the export always
reconciles with the statement's knock count over the same window. The dollar amount never reads it;
pricing stays flat per campaign per month.

## Endpoints

| Route | Behavior |
|---|---|
| `GET /super-admin/organizations/:orgId/billing` | Subscription (full, incl. notes) + entitlement + events. History is paged (`eventsSkip`/`eventsLimit` + exact `eventsTotal`; parameterless keeps the legacy newest-50); the panel renders the stored before→after values from `SubscriptionEvent.changes`, plus `source` (manual vs stripe) and a canceled org's `windDownEndsAt`. Creates a default `active` record for pre-migration orgs on first touch. |
| `GET /super-admin/organizations/billing-rollup` | **This month's revenue across every customer org** in one response: per-org `{rate, totalCents, billableCampaigns, effective, trialEndsAt, windDownEndsAt}` (ranked by revenue) + the aggregate header (`totalCents`, `billableCampaigns`, `byStatus`). N+1 statement walk per org (fine at platform scale). Count contract: billable = statement lines with `billable === true`; **internal orgs excluded entirely** — they are not revenue. Powers the Organizations page's revenue bar and per-row dollars. |
| `GET /super-admin/organizations/at-risk` | The one server-side needs-attention definition (replacing the old client-only ≤2-day heuristic): trials expiring within `days` (default 7), `past_due`, `suspended`, `canceled` in wind-down (with the deletion date), and idle $0 zombies (`idleZeroDollarOrgs`). Feeds the Organizations strip AND the Control Room's billing strip. |
| `PATCH …/billing` | Rate / contact / notes; diffs logged as a `SubscriptionEvent`. Status is NOT patchable here. |
| `POST …/billing/status` `{to, reason}` | The status chokepoint: any → any, reason **required** for `suspended`/`canceled`, sets `statusChangedAt`, reclaims `source:'manual'`, logs the event. 400 on a no-op. **`internal` is coupled to `Organization.isInternal` both ways** (see below): `to:'internal'` on an un-flagged org **403 `INTERNAL_FLAG_REQUIRED`**; a flagged org can never leave `internal` (**403 `INTERNAL_LOCKED`**) — the flag checks run *before* the same-status 400, so `to:'internal'` can heal a flagged org whose sub drifted. Idle $0 orgs (active, no live campaign, long silent) are surfaced on the **Control Room's Idle organizations queue**, which deep-links here — setting `canceled` is what starts their 60-day wind-down (see [PLATFORM.md](PLATFORM.md)). |
| `POST …/billing/extend-trial` `{days?\|until?}` | Trial-status only. `+days` from max(now, current end) — extending an *expired* trial un-suspends with no separate step. |
| `GET …/billing/statement?month=YYYY-MM` | `{...live, statement, drift}` — the live recompute at the top level (unchanged shape), the frozen `Statement` if that month is issued, and the diff between them. CSV is built client-side from whichever is authoritative. |
| `POST …/billing/statement/:month/issue` `{externalRef?, force?}` | **Freezes** the month into a `Statement`. 400 malformed · 403 `INTERNAL_NOT_BILLABLE` (checks both `org.isInternal` and `sub.status`) · 422 `MONTH_NOT_ENDED` unless `force` · 409 `ALREADY_ISSUED`, from the pre-check **and** from catching duplicate-key `11000` (the actual race guard). Back-stamps `supersededByStatementId` on the newest voided row, best-effort. Logs a `SubscriptionEvent`. |
| `POST …/billing/statement/:statementId/void` `{reason}` | Voids an issued statement. `reason` **required** (400 without). Atomic `findOneAndUpdate` scoped by `organizationId` + `status:'issued'` → 409 if already void or another org's. Logs a `SubscriptionEvent`. |
| `GET …/billing/statements` | Every statement ever issued or voided for this org, newest first, without `lines`. |
| `GET …/billing/campaigns` · `PATCH …/billing/campaigns/:campaignId` | Per-campaign negotiated rate. `pricePerCampaignCents` is `.nullable()` — **`null` restores "inherit the org rate"**, `0` is a legal comped rate. Org-scoped lookup (a foreign `campaignId` 404s). Super-admin only, by design: this must never be reachable from `admin/campaigns.js`. |
| `GET /super-admin/billing/statements?month=&live=0\|1` | **The month-close board.** Every non-internal org's issued / not-issued state for one month + issued totals. `live=1` also recomputes each org and reports drift — `O(orgs × campaigns)` round-trips, so it is opt-in behind a button. Mounted **before** the `/super-admin` catch-all. |
| `GET /admin/billing` | Bill-payer-admin view (gated `requireOrgRole('admin')` **+ `Membership.billingAccess`** — super admins pass): status, entitlement, trial end, **`usage`** via `publicUsage` (billable-campaign count, `setupCount`, `graceCount`, and the campaign breakdown), and the org's `billRestrictedDoors` default. **No dollar amounts at all** — no rate, no total, no per-campaign amount — and no billing contact / notes / source / Stripe ids. |
| `PATCH /admin/billing/settings` `{billRestrictedDoors}` | Sets the org-wide default for counting restricted doors as billable doors. Same bill-payer gate as the GET. Exists here rather than on an org-settings page because there isn't one — every other org mutation is super-admin-only — and because it is a billing-counting policy. Per-campaign overrides go through `PATCH /admin/campaigns/:id` (org-admin only; a lead is refused). |
| `POST /super-admin/organizations` | Create a client: org + trial (`trialDays`, default 7) + optional **first admin** (`admin{firstName,lastName,email,password?}` → uses the typed `password` or auto-generates a temp one, `mustChangePassword`, `billingAccess:true`; returns `tempPassword` once). A taken admin email 409s **before** the org is created. |
| `PATCH /admin/memberships/:userId` `{billingAccess}` | Grant/revoke the Billing surface for an admin — only a caller who already has `billingAccess` (or a super admin) may change it (else 403). |

## The `internal` status (Doorline-owned orgs)

`internal` is not a status an account manager toggles — it is **set once, at internal-org creation, and
then flag-locked in both directions.** It exists only for Doorline's own orgs (the demo org and any
future sandbox), which are permanently free, never gated, and excluded from the revenue rollups and
at-risk lists. (An internal org's **own** billing panel still renders its statement lines for
reference — the statement builder is org-agnostic — but those lines never enter any rollup and are
never invoiced.)

- **Born with the org.** `POST /super-admin/organizations {internal:true}` creates the `Subscription`
  with `status:'internal'` in the same step (break-glass only; see
  [PLATFORM.md](PLATFORM.md) → *Internal (Doorline-owned) organizations*). There is no trial and no
  clock. `loadOrgSub` backfills a **missing** sub as `'internal'` for a flagged org (so the coupling
  guard can't wedge it on `active`); `migrate:billing` / `seed:demo` set it for the demo org.
- **Coupled to `Organization.isInternal` both ways** in the status chokepoint
  ([billing.js](../server/src/routes/superAdmin/billing.js)): **into** `internal` requires the
  born-immutable flag (`INTERNAL_FLAG_REQUIRED` without it — this is what closed the old hole where any
  super-admin could silently comp a customer org to free-forever *and* exempt it from the retention
  sweeps); **out of** `internal` is refused on a flagged org (`INTERNAL_LOCKED`). Because the flag can
  only be set at creation and never on an existing customer org, the `internal` state — and the
  retention exemption it carries — is reachable **only** through break-glass org creation.
- **Retention:** `internal` is in `DORMANCY_PROTECTED_STATUSES` and `triggers.js`'s `isExempt`, so an
  internal org is never touched by wind-down or dormancy purges. That exemption is legible in the
  org-detail billing header (`internal: true`).

## Onboarding & per-admin billing access

- **`Membership.billingAccess`** (Boolean, default `false`) gates the whole org billing surface —
  the `/billing` nav item + route, the page, and the client cost view — plus the
  `/admin/billing` endpoints. Client-side, `useAuth()` exposes
  `canViewBilling = isSuperAdmin || (isOrgAdmin && activeMembership.billingAccess)`; the flag rides
  the login/me membership payload and the `GET /admin/memberships` list.
- **An org can never lose its LAST billing admin through the console** (`LAST_BILLING_ADMIN`,
  409). Billing admins are also who receives the billing-grade emails — support-access notices
  and the wind-down/dormancy **deletion warnings** ([EMAIL.md](EMAIL.md)) — so all five console
  doors refuse on the last one: toggling billing access off, demoting the role, deactivating the
  membership (either route), removing them from the org, and (pre-existing) deleting their own
  account. Hand billing access to another admin first, then proceed. Guard + test:
  `routes/admin/memberships.js` `isLastBillingAdmin`, `test/billingAccess.int.test.js`.
- **Provisioning** ([routes/superAdmin/organizations.js](../server/src/routes/superAdmin/organizations.js))
  reuses `createOrgMember` ([services/memberships/createMember.js](../server/src/services/memberships/createMember.js),
  now taking `mustChangePassword` + `billingAccess`) to seat the first admin atomically with the
  org + trial. Closes the chicken-and-egg gap (`POST /admin/memberships` needs an existing admin).
- **Usage meter** — `currentUsage(orgId)` ([services/billing/statement.js](../server/src/services/billing/statement.js))
  summarizes the current month via `monthlyStatement` → `{ billableCampaigns, totalCents, rateCents,
  billing[], setupCount, graceCount }`. The super-admin surfaces consume this directly; the org's own
  Billing page gets `publicUsage(usage)` instead, which drops every dollar figure.
  Metered, not capped: campaign creation is never blocked, but any *canvassed* campaign auto-appears
  on the meter/statement — transparency, not a paywall.

## Client surfaces

Web: [BillingBanner.jsx](../client/src/components/BillingBanner.jsx) (global, in
[Layout.jsx](../client/src/components/Layout.jsx) beside `AddedToOrgBanner`; trial banner only in
the last 3 days; a 402 on reads renders the canceled notice), org-admin
[BillingPage.jsx](../client/src/pages/BillingPage.jsx) at `/billing` (ORG_NAV, not lead-visible),
super-admin [OrgBillingPanel.jsx](../client/src/components/OrgBillingPanel.jsx) opened from
[OrganizationsPage.jsx](../client/src/pages/OrganizationsPage.jsx) (Billing column + needs-attention
strip), pills + strip on the Control Room ([SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx));
shared meta in [lib/billingStatus.jsx](../client/src/lib/billingStatus.jsx).

Added with the statement work:

- **[MonthClosePage.jsx](../client/src/pages/MonthClosePage.jsx)** at `/super-admin/billing` — the
  month-close board, linked from the Organizations revenue strip. A separate page rather than another
  section on `OrganizationsPage`, which already carries the org table, revenue strip, at-risk strip,
  create-org flow and the embedded panel.
- **`OrgBillingPanel` statement section** — Issue / Void controls, an "Issued … · rules vN" badge, the
  drift banner, an inline per-campaign **Rate** column (disabled once the month is issued — a frozen
  statement must not be retypeable), a **Reason** annotation per line, and a CSV that names itself
  `-issued` or `-live` and carries a provenance header row. `changeText()` renders the new
  `campaignRate` / `statementIssued` / `statementVoided` events.
- **[ArchiveNudge.jsx](../client/src/components/ArchiveNudge.jsx)** — on
  [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) (aggregate, org-admin only, archives via
  the existing mutation) and [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx)
  (single, links to Campaigns). Fires when `electionDay` has passed and the campaign is still active;
  escalates tone inside the end-grace window. **Holds the client copy of `END_GRACE_DAYS`.**

Mobile: `entitlement` rides the bootstrap; [EntitlementBanner.jsx](../mobile/components/EntitlementBanner.jsx)
renders on the map (under the context card) and the campaign picker. It is **role-aware** (reads the
cached role via `loadRoleContext`): only **admins** see the billing warnings (trial countdown, past-due
invoice); **canvassers and team leads** see only a plain "This account is paused — canvassing is disabled.
Your recorded work is safe." for the read-only states (`trial_expired`/`suspended`/`canceled`), and nothing
during `trial`/`past_due` — they don't handle the bill, so no trial/money wording reaches them. The
household screen likewise disables disposition buttons on `canCanvass === false` with a billing-neutral
"Canvassing is paused…" notice ([household/[id].jsx](../mobile/app/(app)/household/[id].jsx)).
Older installed builds are safe: the server 402 is the backstop and `api.js` already surfaces
`err.message`; a fresh (post-suspension) submission hard-rejects with the friendly copy, while
queued pre-suspension work flushes under the grace rule.

## Migration & deploy

Order: **server → `npm run migrate:billing -- --apply` → web → mobile OTA.** The migration gives
every existing org a Subscription — the demo org (slug from `demoData/namePools.js`, plus any
`--internal slug1,slug2`) becomes `internal`, everything else `active` (grandfathered at the
default rate; set per-org rates afterwards from the Billing panel) — and backfills
`Campaign.archivedAt` from `updatedAt` (via a pipeline update, so `updatedAt` itself isn't
bumped). Server-first is safe: a missing Subscription resolves to full access, and old clients
simply never render the banners. New orgs self-provision (`trial`, +7 days) in the create route;
`seed:demo` upserts its org to `internal`. Tests:
[test/billing.int.test.js](../server/test/billing.int.test.js) (status × method matrix, trial
expiry, grace, super-admin bypass, statement windows) — run with `MONGODB_URI_TEST`.

### Grace rules + issued statements (Jul 2026)

Order: **server → `npm run migrate:build-indexes -- --apply` → web.** No mobile (nothing under
`mobile/` calls `/admin/billing`), and **no client-version gate** — the change is additive to the
super-admin surface and only *removes* fields from a web-only endpoint.

> 🛑 **The index build is a gate, not a follow-up.** `Statement`'s
> `{organizationId, month}` unique partial index **is** the double-issue race guard, and production
> runs with `autoIndex` off ([config/db.js](../server/src/config/db.js)) — a missing index never
> self-heals. Run the dry run, then `--apply`, then the dry run again until it reports
> "All declared indexes are already present", **before** the Issue button is reachable in prod.

**No backfill, deliberately.** Historical months are not retro-issued: generating statements for
months that were invoiced by hand, from numbers that may no longer match, would be fabricating a
record. Freezing starts from the first month you press Issue; earlier months stay honestly live.

Tests: [test/billingMonths.test.js](../server/test/billingMonths.test.js) (pure, no mongod — every
calendar boundary) and [test/statement.int.test.js](../server/test/statement.int.test.js) (the rules
as `statement.js` feeds them, per-campaign rates and their privilege boundary, issue/void/drift, and
the concurrent-issue race).

**Per-admin billing access (later addition)** ships **server → `npm run migrate:billing-access --apply`
→ web** (no mobile). The migration grandfathers `billingAccess:true` onto every existing
**non-super-admin** `role:'admin'` membership so no current admin loses the page (super admins
are skipped — they bypass the gate anyway); new admins default off. Covered by
[test/billingAccess.int.test.js](../server/test/billingAccess.int.test.js) (gating, usage math,
provisioning, grandfather).

## The Stripe phase (designed, not built)

When account volume justifies it: one webhook route (raw body + signature verification) mapping
`invoice.paid → active` and `invoice.payment_failed → past_due`, writing through the same status
chokepoint, honored **only when `source === 'stripe'`** — a manual change reclaims `source` and
therefore always wins. Flipping an org to automated billing = setting `stripeCustomerId` +
`source`. Nothing else changes: the gate, banners, and statement already speak entitlement, not
payment.
