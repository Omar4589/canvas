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

Every new organization starts a **7-day free trial** with full access. The trial clock starts when
the org is created, and an account manager can extend it in one click. When a trial ends without
conversion the org automatically becomes **read-only** — nothing is deleted, nobody is locked out
of *seeing* their work, but recording, importing, and cutting stop until the account is activated.

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
history), extend the trial, set the org's rate, billing contact and internal notes, and read the
**monthly statement** — one line per campaign with households, first knock, the month's knocks,
and the amount — exportable as CSV for invoicing. Payment itself happens outside the app (send an
invoice — Stripe Invoicing works well); the app tracks *entitlement*, not money.

Org admins see their side on the **Billing** page (status, the plan summary, their billing
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

## Endpoints

| Route | Behavior |
|---|---|
| `GET /super-admin/organizations/:orgId/billing` | Subscription (full, incl. notes) + entitlement + latest 50 events. Creates a default `active` record for pre-migration orgs on first touch. |
| `PATCH …/billing` | Rate / contact / notes; diffs logged as a `SubscriptionEvent`. Status is NOT patchable here. |
| `POST …/billing/status` `{to, reason}` | The status chokepoint: any → any, reason **required** for `suspended`/`canceled`, sets `statusChangedAt`, reclaims `source:'manual'`, logs the event. 400 on a no-op. |
| `POST …/billing/extend-trial` `{days?\|until?}` | Trial-status only. `+days` from max(now, current end) — extending an *expired* trial un-suspends with no separate step. |
| `GET …/billing/statement?month=YYYY-MM` | The monthly statement JSON (CSV is built client-side from it). |
| `GET /admin/billing` | Org-admin view: status, entitlement, trial end, rate, billing contact. **No** notes/source/Stripe ids. `requireOrgRole('admin')`. |
| `PATCH /admin/billing/contact` | Org admin updates the billing contact (upserts the subscription if somehow missing; logged). |

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
renders on the map (under the context card) and the campaign picker; the household screen disables
disposition buttons on `canCanvass === false` with a notice ([household/[id].jsx](../mobile/app/(app)/household/[id].jsx)).
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

## The Stripe phase (designed, not built)

When account volume justifies it: one webhook route (raw body + signature verification) mapping
`invoice.paid → active` and `invoice.payment_failed → past_due`, writing through the same status
chokepoint, honored **only when `source === 'stripe'`** — a manual change reclaims `source` and
therefore always wins. Flipping an org to automated billing = setting `stripeCustomerId` +
`source`. Nothing else changes: the gate, banners, and statement already speak entitlement, not
payment.
