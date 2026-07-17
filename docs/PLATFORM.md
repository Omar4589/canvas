# The platform console (super admin)

What a **super admin** is, and the platform-wide console they use to oversee every organization on the
instance — the Control Room, Organizations, All Users, Imports (with geocoding costs), People, and
background Jobs.

- **Part 1 — For everyone** is plain language: who a super admin is and what each screen does.
- **Part 2 — Technical reference** is for developers (and Claude): the gate, the endpoints, and where
  each screen's data comes from.

Related: [ROLES.md](ROLES.md) (org roles — admin / team lead / canvasser, which the super admin sits
above), [USERS.md](USERS.md) (accounts vs memberships), [PERSONS.md](PERSONS.md) (the cross-org People
layer, managed from this console), [METRICS.md](METRICS.md) (the numbers behind the Control Room).

---

# Part 1 — For everyone

## Who a super admin is

Org roles (admin / team lead / canvasser) live **inside** one organization. A **super admin** is
platform-wide: they sit above every org, can enter any of them, and run the platform console. It's a
deliberately small, trusted group (you promote someone to it from All Users). A super admin isn't the
same as an org admin — an org admin runs *their* org; a super admin oversees *all* of them and the
platform itself.

Super admins work in a **platform view** (no single active organization). From there they can drop into
any org to work inside it, then come back out.

## The screens

- **Control Room** — the platform's home page: headline totals (organizations, users, super admins,
  campaigns), **who's active right now** (canvassers who logged something in the last 15 minutes),
  **today's activity** (doors knocked, surveys, lit drops — across every org), and a table of every
  organization with its members, campaigns, who's live, and when it was last active. Alongside it, a
  **live activity feed** streams recent door events (Not home / Wrong address / **Refused** /
  **Restricted** / Survey / Lit drop) from across all orgs. Two more blocks (moved here from Support
  access): the **Idle organizations** queue — active-status, $0 (no live campaign), silent past the
  idle window; the population neither retention sweep can ever resolve, so a human decides
  re-engage vs terminate, and each row's **Manage billing →** deep-links to that org's Billing panel
  (`/organizations?billing=<orgId>`) — and the lifetime **Platform totals** (organizations,
  campaigns, doors knocked, surveys, voters), which exclude internal/demo orgs and survive customer
  deletion. **Every number on the page carries an ⓘ** explaining exactly what it counts (copy in
  `client/src/lib/platformStatsMeta.js`, mirrored to mobile); the one worth memorizing: lifetime
  "Doors knocked" counts **raw field records**, a deliberately different unit from the billable
  "knocks" in reports (one per household per round — see [METRICS.md](METRICS.md)), so it always
  reads higher. A muted "Recomputed nightly · last reconciled …" line shows the totals' freshness.
- **Organizations** — the list of every org; create a new one, activate/deactivate them (a
  deactivated org's members can't sign into it), manage each org's **billing** (status pill + Manage
  → the Billing panel; see [BILLING.md](BILLING.md)), and **permanently delete** an org. Delete is a
  hard, irreversible cascade — campaigns, doors, voters, history, reports, share links, memberships —
  guarded by typing the org's slug back. User accounts always survive (someone in another org keeps
  that access); the org's identity records (People) are deleted with it — People are per-org, so
  nothing is shared with anyone else (see [PERSONS.md](PERSONS.md)).
- **Refresh demo day** (Control Room) — one click re-stages the demo org's recent canvassing
  relative to *now*: the four prior evenings plus a "today" whose knocks run from mid-morning up to
  the minute you pressed it. Press it right before a pitch so the dashboard, map, and timeline look
  live. The staged day reads like a real field operation — the work is spread across the demo's
  several canvassers, each knocking a believable ~15-20 doors an hour (never hundreds), a realistic
  connection rate of about 1 in 5 doors, and survey answers that mirror a real canvass. It only ever
  touches the demo org; each app-review account's book (you can have one per platform — Apple, Google)
  always stays unwalked so those doors stay fresh for reviewers, and the voted layer + published client
  report survive. Also runnable from the Heroku Run console: `npm --prefix server run demo:refresh`.

  One-time setup / repair: the button leans on the demo org being set up correctly — a roster of
  field canvassers with the books shared out among them, and each app-review account's book marked as
  off-limits. If the demo org has drifted (e.g. every book ended up on one account), or if the button
  ever refuses to run because it can't find a marked reviewer book, re-run the demo **seed** once to
  rebuild that structure (see Part 2). The seed reshapes the survey, rebuilds the roster, shares the
  books out, and marks each reviewer's book; after that, the button just works.
- **All Users** — every account on the platform (with the orgs each belongs to and their role in each).
  This is where you **promote or demote a super admin** (you can't change your own flag) and **clear a
  user's login lockout** if they've been throttled by too many wrong passwords (see [USERS.md](USERS.md)).
- **Imports** — every voter-file import across every org and the **geocoding cost** each incurred:
  totals + a per-import table (homes that arrived with coordinates = free, vs. those that needed a
  lookup; new vs. cached; and the internal dollar cost). This cost is owner-only — it's never shown to
  admins or clients. Filter by month; see [IMPORTS.md](IMPORTS.md) § "Cost review (owner-only)".
- **People** — the **Person** identity layer: each org's voter identities, deduped **within that org**
  (People are per-org — the same human in two orgs is two separate records); review merge/split
  candidates, approve edit proposals, and set locks. Fully documented in [PERSONS.md](PERSONS.md).
  Opening any of it requires a support access grant for that org (below).
- **Support access** — where staff grants are managed: start a grant (with its written reason), see
  who currently holds one, revoke them, and review the access audit trail and retention-job health.
- **Jobs** — the background job queues (imports, turf-cutting) for when something needs a look under the
  hood.

## When Doorline staff can see customer data

Doorline staff can't open a customer organization's voter or canvassing data just because they work
here. Entering an org requires a **support access grant**: the staff member starts one with a written
reason, it covers **one organization at a time**, and it **expires automatically after a few hours**.
Access under a grant is designed to be recorded in an **audit log** — who entered, which organization,
what kind of data was touched, when, and the stated reason — and those records are kept. There is no
unlogged mode.

Two things this is *not*: it doesn't apply to an organization's **own** admins, leads, and canvassers
working in their own org (that's normal use, not staff access, and isn't logged this way); and it is
an internal control with after-the-fact accountability, not a customer approval step — grants are
disclosed in the Privacy Policy, not requested from the customer.

---

# Part 2 — Technical reference

## The gate

Everything here is behind `requireSuperAdmin` ([middleware/auth.js](../server/src/middleware/auth.js)),
which checks `req.user.isSuperAdmin`. Separately, `requireOrgRole(...)` **bypasses** its role check for a
super admin (`if (req.user.isSuperAdmin) return next()`), so a super admin can act inside any org's admin
routes too. `isSuperAdmin` lives on the `User` (global), not on a `Membership` — see [USERS.md](USERS.md).
The client mirrors this: `ProtectedRoute requireSuperAdmin` + `AuthContext.isSuperAdmin`; the sidebar's
`SUPER_NAV` ([navItems.js](../client/src/components/navItems.js)) lists these screens.

## Screens → endpoints

| Screen | Client page | Endpoint(s) |
|---|---|---|
| Control Room | [SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx) | `GET /super-admin/platform-overview`, `GET /super-admin/activity-feed` ([platform.js](../server/src/routes/superAdmin/platform.js)); `GET /super-admin/access/platform-stats`, `GET /super-admin/access/idle-orgs` ([access.js](../server/src/routes/superAdmin/access.js)) |
| Organizations | [OrganizationsPage.jsx](../client/src/pages/OrganizationsPage.jsx) | `GET/POST /super-admin/organizations`, `PATCH /super-admin/organizations/:orgId`, `DELETE /super-admin/organizations/:orgId` (body `{confirmSlug}` must equal the slug; cascade in [services/platform/deleteOrganization.js](../server/src/services/platform/deleteOrganization.js), tested by [test/orgDelete.int.test.js](../server/test/orgDelete.int.test.js)) ([organizations.js](../server/src/routes/superAdmin/organizations.js)); billing routes in [BILLING.md](BILLING.md) |
| Refresh demo day | Control Room button ([SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx)) | `POST /super-admin/demo/refresh-day` → [services/platform/refreshDemoDay.js](../server/src/services/platform/refreshDemoDay.js) (slug-locked to the demo org; wipes + restages the activity layer only — doors/books/accounts/voted layer/report survive; console runner `npm run demo:refresh`). Generation + batched persistence are shared with the seed via [services/platform/demoActivity.js](../server/src/services/platform/demoActivity.js) so both look identical. |
| All Users | [SuperAdminUsersPage.jsx](../client/src/pages/SuperAdminUsersPage.jsx) | `GET /super-admin/users`, `POST /super-admin/users/:userId/promote`, `POST /super-admin/users/:userId/clear-lockout` (clears the per-email login throttle via `clearLoginLockout`, see [loginRateLimit.js](../server/src/middleware/loginRateLimit.js)) ([users.js](../server/src/routes/superAdmin/users.js)) |
| Imports | [SuperAdminImportsPage.jsx](../client/src/pages/SuperAdminImportsPage.jsx) | `GET /super-admin/imports` — cross-org import + geocoding-cost aggregation (real persisted lookup counts; cost derived from `GEOCODE_COST_PER_1000_CENTS`, never sent to clients) ([imports.js](../server/src/routes/superAdmin/imports.js)) |
| People | [SuperAdminPeoplePage.jsx](../client/src/pages/SuperAdminPeoplePage.jsx) + [PersonDetailPage.jsx](../client/src/pages/PersonDetailPage.jsx) | `/super-admin/persons/*` ([persons.js](../server/src/routes/superAdmin/persons.js)) — see [PERSONS.md](PERSONS.md) |
| Support access | [SupportAccessPage.jsx](../client/src/pages/SupportAccessPage.jsx) | `/super-admin/access/*` ([access.js](../server/src/routes/superAdmin/access.js)) — grants CRUD, audit-log review, retention health, deletion requests. Grant/logging services in [services/access/supportAccess.js](../server/src/services/access/supportAccess.js); the full verified picture is in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (E12/E13 + v3) |
| Jobs | queues page | Bull Board at `/admin/queues` (`requireBullBoardAuth`, mounted in [app.js](../server/src/app.js)) |

## Notes

- **`platform-overview`** aggregates platform-wide but counts only activity tied to **active** campaigns
  (matching the campaign count). "Today" is a UTC-day window; "active now" is a 15-minute window of
  distinct `userId`s. `today.doorsKnocked` sums the door actions in `ACTION_DOOR` — which **includes
  `refused`** (a first-class billable knock; it was previously omitted and undercounted — see
  [METRICS.md](METRICS.md)) but **excludes `restricted`** (a marker, not a knock). Restricted marks are
  surfaced as their own separate `today.restricted` tally instead of being folded into `doorsKnocked`,
  yet they still count a canvasser toward "active now" (they're real `CanvassActivity`).
- **`activity-feed`** returns the most recent `CanvassActivity` events whose
  `actionType ∈ [...ACTION_DOOR, 'restricted']` (so **Refused and Restricted** events both appear,
  matching the styling the feed UIs ship), newest first, with org / canvasser / campaign / household
  populated; supports `?since=` for polling and `?limit=`.
- **Platform totals (`platform-stats`)** are the two-bucket lifetime counters in
  [models/PlatformStats.js](../server/src/models/PlatformStats.js) /
  [services/platform/platformStats.js](../server/src/services/platform/platformStats.js):
  `total = live + deleted`. `live` is a best-effort running tally (bumped on create/knock/survey/
  import; increments swallow errors by design) that is **recomputed from real rows** by the nightly
  `platform-stats-reconcile` job (03:47 UTC, `recomputeLive({stampBackfill:true})`; manual runner
  `npm run migrate:platform-stats -- --apply` → [backfillPlatformStats.js](../server/src/migrations/backfillPlatformStats.js)).
  `deleted` is banked from **true row counts captured the instant before an org/campaign is deleted**
  and is never recomputed. Internal orgs (Subscription `status:'internal'`) are excluded everywhere.
  `backfilledAt` drives the Control Room's "last reconciled" line. The reconcile job is registered in
  `MAINTENANCE_JOBS` ([scheduler.js](../server/src/services/retention/scheduler.js)) **deliberately
  outside `REPEATABLE_JOBS`** — the retention health banner reports on that list, and a stats hiccup
  must never read "Retention: NOT ENFORCED".
- **Idle organizations (`idle-orgs`)** — criteria in
  [services/billing/idleOrgs.js](../server/src/services/billing/idleOrgs.js): org `isActive`, paying
  subscription status (`active`/`trial`/`past_due`, or none — fails open), **zero active campaigns**
  ($0 under per-campaign billing), newest `CanvassActivity` (fallback `createdAt`) older than
  `PLATFORM_IDLE_MONTHS` (default 6). These escape **both** retention triggers by construction: the
  wind-down needs `canceled`, and the dormancy purge protects paying statuses — hence the human
  queue. Terminating (Billing panel → status `canceled`, reason required) starts the 60-day
  wind-down; the nightly sweep deletes on lapse (see [OPERATIONS.md](OPERATIONS.md)).
- **`promote`** toggles `User.isSuperAdmin`; a super admin **cannot** toggle their own flag (guards
  against self-lockout / accidental self-demotion).
- **Organizations** `PATCH` flips `isActive` (deactivate hides the org from its members) and edits
  name/slug (slug validated kebab-case — see [validators.js](../server/src/utils/validators.js)).
- **Refresh demo day internals** ([demoActivity.js](../server/src/services/platform/demoActivity.js),
  [refreshDemoDay.js](../server/src/services/platform/refreshDemoDay.js)):
  - **Realism is per-canvasser, not per-book.** `stageDemoActivity` groups each canvasser's books,
    spreads them ~one-per-day across `[today, -1, -2, -3, -4]`, and walks each day on a single running
    clock (2-5 min/door, capped). So the single-day `doorsPerHour = knocks / (last-first span)` (see
    [reports.js](../server/src/routes/admin/reports.js), [METRICS.md](METRICS.md)) lands ~15-20/hr
    instead of collapsing a canvasser's whole inventory into one window (the old per-book scheduler
    produced ~150-200/hr). `OUTCOME_WEIGHTS` tune the connection rate (surveys ÷ knocks) to ~22%.
  - **Batched writes, no H12.** `persistDemoActivity` computes door status **in memory** via
    `resolveStatus` and writes with a single `Household.bulkWrite` (plus `insertMany` for activity and
    deduped surveys) — replacing per-household/per-survey loops that blew Heroku's 30s request limit.
    The endpoint stays synchronous; the whole op is a handful of bulk writes.
  - **Reviewer books are marked, not email-matched.** Each book reserved for an app-review account is
    flagged `isReviewerBook: true` on its [TurfAssignment](../server/src/models/TurfAssignment.js) (set
    by the seed). The refresh excludes **all** marked books and **throws (500) if none is marked** rather
    than silently walking a reviewer's doors — the old runtime `SEED_DEMO_CANVASSER_EMAIL` lookup could
    drift and no-op, letting every book land on the review account.
  - **Multiple reviewers (Apple + Google, …).** `SEED_DEMO_CANVASSER_EMAIL` accepts a **comma-separated
    list** — e.g. `apple@review.com,android@review.com`. The seed creates one canvasser account per
    email (all sharing `SEED_DEMO_CANVASSER_PASSWORD`) and reserves one clean, marked book for each; the
    refresh keeps every one of them unwalked. No button changes are needed to add a platform.
  - **One-time repair = re-run the seed.** `node src/utils/seedDemoOrg.js --reset --apply` reshapes the
    survey template, ensures the field-canvasser roster, **cleanly redistributes** book assignments
    (wipe + reassign: reviewer keeps one marked book, the rest round-robin across field canvassers),
    and restages a fresh day — without touching doors/voters/report/share-link. Set
    `SEED_DEMO_CANVASSER_EMAIL` to the demo org's actual review-account email(s) first — comma-separate
    for multiple platforms (`apple@review.com,android@review.com`) — so the seed resolves and marks the
    right reviewer book(s).
