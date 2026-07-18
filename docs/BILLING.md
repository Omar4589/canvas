# Billing & entitlements (subscriptions, the account-manager console, access gating)

Related: [CAMPAIGNS.md](CAMPAIGNS.md) (archiving — it ends a campaign's billing),
[METRICS.md](METRICS.md) (the billable knock — the same counting feeds the statement),
[PLATFORM.md](PLATFORM.md) (the super-admin console this lives in),
[CLIENT_PORTAL.md](CLIENT_PORTAL.md) (share links — they die with a suspended org).

# Part 1 — For everyone

## What Doorline charges

**$300 per campaign per month** (the default — the rate is stored per organization, so a
negotiated deal just changes that org's number). A campaign starts billing in the calendar month
it records its **first knock** and keeps billing through the month it's **archived**. Setup months
— created, imported, turf cut, but nobody knocking yet — are free, and archiving a finished
campaign is what stops its billing, which is one more reason to archive.

Universe size is **not** priced and never enforced by the software. The "up to ~10,000 households
per campaign" figure some contracts carry is a sales guideline; bigger universes are a
conversation and, if agreed, a per-org rate — nothing in the app blocks them.

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

When an invoice needs the knock detail *behind* a campaign's line — which walk list and which round
(pass) the work landed in — the campaign dashboard's **By round** section exports exactly that
(`knocks-by-pass.csv`: one row per walk list × round plus a TOTAL row, counted by the same rule as
the statement's knocks; optionally per canvasser per round). It's supporting detail, not a price
input — **pricing is unchanged** ($300 per campaign per month); the statement stays the billing
document. See [METRICS.md](METRICS.md) (Part 1 "By round").

**Onboarding a new client is one step:** creating the org also seats its **first admin** (name +
email → a temp password to hand over — type a simple one or leave it blank to auto-generate; either
way it's shown once and they reset it on first login) and starts the trial at your chosen length.
Without this the org would have no admin and no way to seat one (adding members needs an existing admin).

**Not every admin sees billing.** Billing is gated per-admin by a **billing-access** flag — only
the people who actually pay the bill. The seated first admin gets it; other admins don't until a
billing admin grants it (on the Users page). Org admins with access see their side on the
**Billing** page (status, the plan summary, a **live "this month" cost with a per-campaign
breakdown** — which campaigns are billing, since when, and how many are still in free setup — their billing
contact) plus the banner states above. Rates and status changes are deliberately not theirs to touch.

# Part 2 — Technical reference

## Models

| Model | File | Fields that matter |
|---|---|---|
| `Subscription` | [models/Subscription.js](../server/src/models/Subscription.js) | One per org (`organizationId` unique). `status` (`trial`/`active`/`past_due`/`suspended`/`canceled`/`internal`), `statusChangedAt` (the offline-grace boundary), `trialEndsAt`, `pricePerCampaignCents` (default 30000 — per-org override), `billingContact{name,email}`, `notes` (internal, super-admin-only), `source` (`manual`/`stripe` — webhooks may only write when `stripe`, so manual wins), `stripeCustomerId` (dormant). |
| `SubscriptionEvent` | [models/SubscriptionEvent.js](../server/src/models/SubscriptionEvent.js) | Append-only audit: `fromStatus`/`toStatus` or `changes` (Mixed), `byUserId`, `reason` (required by the route for suspend/cancel). Indexed `{organizationId, createdAt}`. |
| `Campaign.archivedAt` | [models/Campaign.js](../server/src/models/Campaign.js) | Set when `isActive` flips false (route: [admin/campaigns.js](../server/src/routes/admin/campaigns.js)), cleared on reactivate. The statement's "bills through the archive month" boundary. `migrate:billing` backfills `updatedAt` for legacy archived campaigns. |

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
`monthlyStatement(orgId, 'YYYY-MM')`. Per campaign, in the **campaign's own timezone**
(`zonedDayRange`, [TIMEZONES.md](TIMEZONES.md)): billable in month M iff *first knock*
(earliest `KNOCK_ACTIONS` activity — `restricted`/notes never start billing) `< end(M)` **and**
not archived before M began (`archivedAt || updatedAt` for legacy rows). `knocksThisMonth` reuses
`knocksPipeline` — the same distinct (household, pass) counting as everywhere else
([METRICS.md](METRICS.md)). `households` is reported for visibility, never priced.

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
| `GET …/billing/statement?month=YYYY-MM` | The monthly statement JSON (CSV is built client-side from it). |
| `GET /admin/billing` | Bill-payer-admin view (gated `requireOrgRole('admin')` **+ `Membership.billingAccess`** — super admins pass): status, entitlement, trial end, rate, and **`usage`** (this month's billable-campaign count + `totalCents` via `currentUsage`). **No** billing contact / notes / source / Stripe ids. |
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
  billing[], setupCount }`. `billing[]` is the per-campaign breakdown (name, first-knock date,
  archived tag, amount) the org Billing page renders; `setupCount` = active campaigns not yet billing.
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
