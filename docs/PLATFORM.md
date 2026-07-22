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

**Where you land, on both clients:** *signing in starts you in the platform view; reloading keeps you
where you were.* Typing your password always clears the remembered organization, so a super admin who
is also an admin of some org lands on the Control Room rather than that org's home — your home is the
platform. Reload, session restore, and app resume deliberately leave the remembered org alone, so a
refresh mid-task doesn't throw away your place.

The rule lives in `activeOrgIdForLogin` ([client/src/lib/roles.js](../client/src/lib/roles.js)) and,
on mobile, in `app/login.jsx`. Note it can't be expressed by simply not auto-picking: a super admin
who is an admin of exactly **one** org would still be auto-entered by the ordinary single-membership
rule, which is the behavior being removed. Web previously skipped the whole block for super admins,
which didn't just decline to pick — it left a remembered org id in `localStorage` deciding the landing
page on every future login, and only an explicit **Sign Out** cleared it (an expired session did not,
so "signed out then in" and "session expired then in" landed in different places).

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
  reads higher. A muted "Recomputed nightly · last reconciled …" line shows the totals' freshness,
  with a **Reconcile now** button beside it (the same idempotent recompute the nightly job runs).
  Each totals card now carries a **trend sparkline** with a 30d / 90d / 1y toggle — one bar per UTC
  day, **through yesterday** (the last complete day, so a partial today never reads as a dip). The
  trend covers **live organizations only**: a deleted customer's records were destroyed on
  deletion, so their contribution has no dates and can never appear on the line — it stays in the
  lifetime total, and the card's ⓘ prints that exact gap (plus any dateless-row count, expected 0).
  The page opens with an **ops-health strip** — three chips answering "is anything on fire": the
  retention banner (green/red), how many staff are inside customer orgs right now, and how many org
  deletions are scheduled (with a "need a human" count when any is overdue or failed) — each linking
  to Support access. The **Billing needs attention** strip is now server-defined (the shared
  "at-risk" list: trials expiring within 7 days, past due, suspended, canceled orgs in wind-down)
  and each name deep-links to that org's Billing panel. Feed rows are drill-able (the org chip opens
  its billing panel) and the feed can **Load older** — history is no longer capped at the newest 50.
- **Organizations** — the revenue view. Each org's name opens a read-only **org detail page**
  (`/organizations/:orgId`; also reachable from a "Details" chip on the Control Room cards): the
  **member roster** — the one thing that previously required burning a logged support session just
  to look at — plus the campaign list with last activity, and deep-links to the billing panel, the
  access log pre-filtered to that org, and the deletion-requests list. All metadata, no grant, no
  audit row; **switching in** stays the (correctly grant-gated) way to reach voter content. An
  **internal**-status org shows an explicit warning that internal means *exempt from automatic
  retention* — the dormancy sweep and wind-down never delete it (the same warning appears in the
  billing panel when selecting the status). A **this-month rollup bar** across every customer org (total
  billable dollars, billable-campaign count, a status breakdown, and the top payers — internal orgs
  excluded), the server-defined **needs-attention strip** (expiring trials, past due, suspended,
  wind-downs, idle $0 zombies), and a **searchable, sortable, paged table** (name/slug search; sort
  by name, created, or trial end; columns for active members, campaigns split active/archived,
  created date, trial end, rate, and this-month dollars). Create a new org, activate/deactivate them
  (a deactivated org's members can't sign into it), manage each org's **billing** (status pill +
  Manage → the Billing panel; see [BILLING.md](BILLING.md)) — the panel now shows whether the status
  was set manually or by Stripe, a canceled org's deletion date, a **paged history with the actual
  before→after values** of rate/contact edits, and a **Rename** control (name + slug, with a warning
  that the slug is the org's platform-wide identity) — and **permanently delete** an org. Delete is a
  hard, irreversible cascade — campaigns, doors, voters, history, reports, share links, memberships —
  guarded by typing the org's slug back. User accounts always survive (someone in another org keeps
  that access); the org's identity records (People) are deleted with it — People are per-org, so
  nothing is shared with anyone else (see [PERSONS.md](PERSONS.md)).
- **Refresh demo day** (Control Room) — one click re-stages the demo org's recent canvassing
  relative to *now*, as a **two-round story**: an archived **Round 1** worked the week before
  (evenings on days −8…−12, its pass properly archived), and the active **Round 2** on the four
  prior evenings plus a "today" whose knocks run from mid-morning up to the minute you pressed it.
  A believable share of Round-2 doors are **re-knocks** of Round-1 not-homes — so the dashboard's
  **By pass** table, the per-pass numbers, and the knock-vs-coverage distinction all demo
  truthfully (two knocks, one home). Press it right before a pitch so the dashboard, map, and
  timeline look live. The staged days read like a real field operation — the work is spread across
  the demo's several canvassers, each knocking a believable ~15-20 doors an hour (never hundreds), a
  realistic connection rate of about 1 in 5 doors, and survey answers that mirror a real canvass. It
  only ever touches the demo org; each app-review account's book (you can have one per platform —
  Apple, Google) stays unwalked **in both rounds** so those doors stay fresh for reviewers, and the
  voted layer + published client report survive. Also runnable from the Heroku Run console:
  `npm --prefix server run demo:refresh`.

  One-time setup / repair: the button leans on the demo org being set up correctly — a roster of
  field canvassers with the books shared out among them, and each app-review account's book marked as
  off-limits. If the demo org has drifted (e.g. every book ended up on one account), or if the button
  ever refuses to run because it can't find a marked reviewer book, re-run the demo **seed** once to
  rebuild that structure (see Part 2). The seed reshapes the survey, rebuilds the roster, shares the
  books out, and marks each reviewer's book; after that, the button just works.
- **All Users** — every account on the platform (with the orgs each belongs to and their role in each),
  now **searched and filtered server-side and paged** — the browser never downloads the whole user
  base. Each name opens a full **user detail page** (`/super-admin/users/:userId`): identity
  including the fields no list carries (temp-password state, deletion lock), **all memberships
  including deactivated ones** (previously invisible from every platform surface; genuinely
  *removed* memberships are hard-deleted and can't be shown), per-org activity counts (raw field
  records — not billable knocks — plus surveys and first/last activity), a staff member's **grant
  and access-log history** (including expired/revoked grants), and the deletion-tombstone **status**
  (dates only — never the retained name, which stays org-scoped on reports). All of it is account
  metadata: no support grant needed, no audit row written. The headline counts real accounts and lists **deleted tombstones separately** (they carry a
  "deleted" badge and never inflate the total); filters cover super admins, active/inactive, deleted,
  temp-password (never finished onboarding), and accounts with no memberships. **Three clocks are
  shown apart**, because they answer three different questions: **Last login** (the last time they
  typed a password — sessions last 30 days and the phone app skips the login screen, so this can
  honestly read weeks old for someone who works every day), **Last active** (the last time their app
  talked to us at all, on any surface — recorded at most every 15 minutes, and it means the session
  was live, not that a human was tapping), and **Last canvassed** (the last door they knocked), which
  sits in the expanded row because most accounts — admins, leads, staff — never canvass at all. An
  account with no clock yet reads "—", not "Never": before someone's first request after this
  shipped there is simply nothing recorded, and the page fills in as people use it. Expanding a row
  shows the account's details, its **login-lockout state** (read live — "Locked, N failed attempts", honestly
  labeled *on this server* — with the Clear button beside it), and, for break-glass operators, the
  **platform-role control**: every super admin is either **support** (day-to-day) or **break-glass**
  (destructive actions); the badge shows which, and the last break-glass account can never be demoted.
  Promote/demote a super admin here too (you can't change your own flag; see [USERS.md](USERS.md)).
- **Imports** — every voter-file import across every org and the **geocoding cost** each incurred:
  totals + a per-import table (homes that arrived with coordinates = free, vs. those that needed a
  lookup; new vs. cached; and the internal dollar cost). This cost is owner-only — it's never shown to
  admins or clients. Built for reconciling the Geocodio invoice: filter by month **or organization**,
  search server-side (file, uploader, or org name), sort by cost, page through the full history (no
  more silent newest-500 window), and switch to **By month / By organization rollups**. A **cache
  savings** card prices the lookups the shared cache avoided (with the hit rate); the assumed
  per-1,000 rate is printed on screen (it's an internal estimate, not Geocodio's bill); reversed
  imports carry an **undone** badge with an *Exclude undone* toggle that drops them from the cost
  math; an **Unplaceable** column surfaces addresses the geocoder couldn't place (including provider
  failures); and the current view exports to CSV. See [IMPORTS.md](IMPORTS.md) § "Cost review
  (owner-only)".
- **People** — the **Person** identity layer: each org's voter identities, deduped **within that org**
  (People are per-org — the same human in two orgs is two separate records); review merge
  candidates, merge/split records, and set locks. Merging now starts from a **search picker**
  (find the other record by name / vendor uid / state voter ID) instead of pasting a raw record id
  — the id paste survives as a collapsed fallback. The edit-proposal review UI was retired (the
  mechanism is vestigial post-per-org; see [PERSONS.md](PERSONS.md)). Fully documented in
  [PERSONS.md](PERSONS.md). Opening any of it requires a support access grant for that org (below),
  and the People console is **break-glass only** — the nav item is hidden from support-tier staff.
- **Support access** — where staff grants are managed and the delete-on-request intake lives. Start a
  session deliberately (org picker + the same reason/kind/length form the 403 modal uses — access no
  longer begins only by tripping a Forbidden somewhere); see who currently holds one (with its kind,
  last request, and **how much was read under it** — requests, rows, bytes — where "requests" is
  request-count, never distinct voters), revoke them; and review the access **audit log**, now paged
  with an exact total ("N entries total, oldest …" — history past the first page stays reachable) and
  filterable by organization, staff member, date window, or a single session, with a **Read** column
  separating a one-voter peek from a 4,000-row export. The retention banner expanded into a **health
  panel** (per-job last success/error plus stuck/failed deletion counts), and a **Scheduled deletions**
  section runs the contractual delete-on-request flow: file a request (org, requester email, note —
  it schedules the deletion for now + SLA), cancel one before it fires, and see overdue ones flagged.
  A support-tier super sees *their own* sessions labeled as such; listing everyone's requires the
  break-glass role.
- **Jobs** — the background job queues (imports, turf-cutting) for when something needs a look under the
  hood.

## On the phone

The mobile app carries a companion version of the platform console, laid out the same way as the
rest of the app: a **bottom tab bar** with five tabs. **Control Room** is the "is anything on fire"
screen — the live pill, headline stats, today's numbers, billing alerts, support-access glance, idle
orgs, and the lifetime totals. **Orgs** is the single organization surface: every org as a card
(members, campaigns, who's active now, last activity, billing state), with **Switch into this
org →** to enter its admin console, plus create and deactivate/reactivate. **Users** is the same
server-searched, filtered, paged account list as the web (promote and clear-lockout included), and
**Activity** is the cross-org live feed with "Load older" history. **More** holds your account,
Help, the theme toggle, "Switch into an organization", and Sign out. The phone version is for
monitoring and the handful of actions worth having in the field — billing changes, org deletion,
imports/People review stay on the web console.

**Entering a customer org from the phone works the same way it does on the web.** Each org card says
how you get in — `internal`, `session open`, or **needs a session** — and tapping one that needs a
grant opens the same reason/kind/length sheet the web's 403 modal uses
([SupportAccessGate.jsx](../mobile/components/SupportAccessGate.jsx), mounted once in
`(app)/_layout.jsx` because the 403 can surface from any org-scoped query on any screen). The field
set is deliberately identical to the web's `StartSupportSessionForm`, including the 10-character
reason minimum, so the audit log reads the same whichever client wrote it. Declining **leaves the
org** rather than just closing the sheet — a dismissed sheet over a still-org-scoped screen re-fires
the 403 and reopens itself, which is the loop the web client shipped and fixed. Reviewing the access
log and the grant history stays on the web console; the phone can start, see, and end a session.

Before this, mobile had no handling for that 403 at all: tapping a customer org's card persisted the
org id, navigated to the admin console, and every query failed with a Retry button that could never
succeed and no way out but signing out.

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

**The one exception: Doorline's own internal organizations.** Doorline keeps a small number of its own
**internal** orgs — the demo org and any future sandbox — that hold **only fictional, Doorline-made
data**, never a customer's. Because there's no customer information inside one, staff work in them
**directly**, the same way an org's own admin does: no support grant, and no audit-log entry. The mark
is set **when the org is created** (and only by the highest, "break-glass" tier of staff); **no screen
or API request can add it to an existing customer org afterward** — the only remaining paths are
operator-run maintenance scripts on the server itself, which sit outside the app entirely (Part 2 lists
each one). An internal org is permanently free and off the books. So the grant-and-log requirement
above always applies to **your** organization; the carve-out reaches only Doorline's own practice data.

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
| Control Room | [SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx) | `GET /super-admin/platform-overview`, `GET /super-admin/activity-feed` (`?since=` forward cursor, `?before=` backward "Load older") ([platform.js](../server/src/routes/superAdmin/platform.js)); `GET /super-admin/access/platform-stats`, `GET /super-admin/access/platform-trends?days=30\|90\|365` (the sparkline series — zero-filled UTC days ending at **yesterday**; returns `live`/`deleted`/`undated` so the ⓘ can print the exact gaps), `POST /super-admin/access/platform-stats/reconcile` (the "Reconcile now" button — `recomputeLive` **+ `recomputeDaily`**, same as the nightly job), `GET /super-admin/access/idle-orgs`, `GET /super-admin/access/health/retention`, `GET /super-admin/access/grants?all=1`, `GET /super-admin/access/deletion-requests` (the ops-health chips) ([access.js](../server/src/routes/superAdmin/access.js)); `GET /super-admin/organizations/at-risk` (billing strip) |
| Organizations | [OrganizationsPage.jsx](../client/src/pages/OrganizationsPage.jsx) + [OrgDetailPage.jsx](../client/src/pages/OrgDetailPage.jsx) | `GET /super-admin/organizations` (opt-in `skip`/`limit`/`q`/`sort` + `total`), `GET /super-admin/organizations/billing-rollup` (this-month revenue across all customer orgs), `GET /super-admin/organizations/at-risk` (the needs-attention definition), `GET /super-admin/organizations/:orgId` (the slim detail composite — roster incl. deactivated memberships, campaigns + last activity, billing header w/ the `internal` exemption flag; **registered after the literal routes** so `/:orgId` can't swallow them; metadata only — no grant, no AccessLog row), `POST /super-admin/organizations`, `PATCH /super-admin/organizations/:orgId` (isActive + the Rename control's name/slug), `DELETE /super-admin/organizations/:orgId` (body `{confirmSlug}` must equal the slug; cascade in [services/platform/deleteOrganization.js](../server/src/services/platform/deleteOrganization.js), tested by [test/orgDelete.int.test.js](../server/test/orgDelete.int.test.js)) ([organizations.js](../server/src/routes/superAdmin/organizations.js)); billing routes in [BILLING.md](BILLING.md) |
| Emails | [SuperAdminEmailsPage.jsx](../client/src/pages/SuperAdminEmailsPage.jsx) (web) + `super-admin/emails.jsx` (mobile More ▸ Platform) | `GET /super-admin/emails` (opt-in `skip`/`limit` + `kind`/`outcome`/`organizationId` filters; returns `total`, distinct `kinds`, `last24h` sent/failed; rows carry `deliveryStatus`/`deliveryDetail` from the Resend webhook and `keptForever` on the never-expiring deletion-warning evidence), `GET /super-admin/emails/orgs` (filter dropdown) ([emails.js](../server/src/routes/superAdmin/emails.js)). Metadata only — see [EMAIL.md](EMAIL.md) for the send log, TTL, and webhook. |
| Refresh demo day | Control Room button ([SuperAdminHomePage.jsx](../client/src/pages/SuperAdminHomePage.jsx)) | `POST /super-admin/demo/refresh-day` → [services/platform/refreshDemoDay.js](../server/src/services/platform/refreshDemoDay.js) (slug-locked to the demo org; wipes + restages the activity layer only — doors/books/accounts/voted layer/report survive; regenerates **both rounds** of the 2-round story and re-stamps pass lifecycle dates; returns per-round staged counts + `reknockDoors`; console runner `npm run demo:refresh`). Generation + batched persistence are shared with the seed via [services/platform/demoActivity.js](../server/src/services/platform/demoActivity.js) so both look identical. |
| All Users | [SuperAdminUsersPage.jsx](../client/src/pages/SuperAdminUsersPage.jsx) + [SuperAdminUserDetailPage.jsx](../client/src/pages/SuperAdminUserDetailPage.jsx) | `GET /super-admin/users` (opt-in `skip`/`limit`/`q` + filters `super`/`deleted`/`tempPassword`/`orphan`/`active`; returns `total` + `deletedCount`, per-page `lastActivityAt`, and `lastSeenAt` — the last one is **not** page-gated, since unlike `lastActivityAt` it is already on the user document and costs no extra read), `GET /super-admin/users/:userId` (the drill-in composite → [services/platform/userOversight.js](../server/src/services/platform/userOversight.js): full identity incl. `tempPasswordSetAt`/`deletionLocked`/`lastSeenAt`, ALL memberships incl. deactivated, per-org structural activity counts, staff grant/access history, `DeletedUserRecord` **status only** — metadata, no grant, no AccessLog row), `GET /super-admin/users/:userId/lockout` (reads the per-email throttle state — per-process, labeled), `PATCH /super-admin/users/:userId/platform-role` (break-glass only; refuses to demote the last break-glass account), `POST /super-admin/users/:userId/promote`, `POST /super-admin/users/:userId/clear-lockout` (clears the per-email login throttle via `clearLoginLockout`, see [loginRateLimit.js](../server/src/middleware/loginRateLimit.js)) ([users.js](../server/src/routes/superAdmin/users.js)) |
| Imports | [SuperAdminImportsPage.jsx](../client/src/pages/SuperAdminImportsPage.jsx) | `GET /super-admin/imports` — cross-org import + geocoding-cost aggregation (real persisted lookup counts; cost derived from `GEOCODE_COST_PER_1000_CENTS`, never sent to clients); opt-in `skip`/`limit`, `q` (file/uploader/org), `orgId`, `sort=cost\|new`, `excludeUndone=1`, `groupBy=month\|org` rollups ([imports.js](../server/src/routes/superAdmin/imports.js)) |
| People | [SuperAdminPeoplePage.jsx](../client/src/pages/SuperAdminPeoplePage.jsx) + [PersonDetailPage.jsx](../client/src/pages/PersonDetailPage.jsx) | `/super-admin/persons/*` ([persons.js](../server/src/routes/superAdmin/persons.js)) — see [PERSONS.md](PERSONS.md) |
| Support access | [SupportAccessPage.jsx](../client/src/pages/SupportAccessPage.jsx) | `/super-admin/access/*` ([access.js](../server/src/routes/superAdmin/access.js)) — grants CRUD (`GET /grants` returns `scope: all\|mine` + per-grant `read {requests, rows, bytes}` totals), the audit log (`GET /log` — `skip`/`limit` + exact `total`, filters `organizationId`/`actorUserId`/`grantId`/`from`/`to`/**`subjectId`** (record-level: which voter/person/household a row touched — single-record opens + exports carry `subjects`/`subjectCount`/`subjectsTruncated`; browse rows stay request-level), each entry carrying `rows`/`bytes`/`route`), `GET /log-facets` (filter options + the log's true extent: `logTotal`, `oldestAt`), retention health, and deletion requests (`GET` paged + `status` filter + per-row `overdue`; `POST` files; `POST /:id/cancel`). The customer-facing half is `GET /admin/voters/:voterId/staff-access` (the voter profile's "Doorline staff access" panel — first-name-only). Grant/logging services in [services/access/supportAccess.js](../server/src/services/access/supportAccess.js); the full verified picture is in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (E12/E13 + v3/v4) |
| Jobs | queues page | Bull Board at `/admin/queues` (`requireBullBoardAuth`, mounted in [app.js](../server/src/app.js)) |

## Internal (Doorline-owned) organizations

`Organization.isInternal` ([models/Organization.js](../server/src/models/Organization.js)) is the
**security boundary** that lets platform staff enter an org **without** a support grant and **without**
an AccessLog row. `orgContext` ([middleware/orgContext.js](../server/src/middleware/orgContext.js))
grants a super-admin free entry to an internal org in a branch that runs **after** the membership check
and **before** the vendor-grant branch — `req.activeOrg` set, `req.internalOrgAccess = true`
(observability only), but **no `req.supportGrant`** — so the `VENDOR_READ_ONLY` write-blocks and
[middleware/accessLog.js](../server/src/middleware/accessLog.js) stay silent exactly as they do for a
real member. It is safe because an internal org holds **only Doorline's own synthetic/demo data** and
because the flag can never reach a customer org:

- **Born-immutable.** The field is `immutable: true` and is absent from every update schema, so no
  PATCH body and no ordinary Mongoose write can set it on an existing org. It is settable **only at
  creation**, plus **three** sanctioned raw-collection writes — all CLI-only, none reachable from an
  HTTP route: [utils/seedDemoOrg.js](../server/src/utils/seedDemoOrg.js) (hard-locked to the demo
  slug), [migrations/migrateInternalOrgs.js](../server/src/migrations/migrateInternalOrgs.js)
  (`npm run migrate:internal-orgs`, dry-run by default, `--apply`; `--slugs` accepts arbitrary orgs),
  and [migrations/migrateBilling.js](../server/src/migrations/migrateBilling.js) (its pre-existing
  `--internal` slugs). All three are idempotent and print what they touch; their write filters guard
  *re-running*, not *targeting* — the two migrations can flag any org an operator names, which is the
  operator's prerogative (server shell access sits outside the app's security boundary).
- **Create-time only, break-glass only.** `POST /super-admin/organizations {internal:true}`
  ([organizations.js](../server/src/routes/superAdmin/organizations.js)) requires
  `platformRole === 'break_glass'` (else **403 `BREAK_GLASS_REQUIRED`**); passing `trialDays` with
  `internal` is **400 `INTERNAL_NO_TRIAL`**; the org's `Subscription` is born `'internal'`, and
  `bumpLive` skips internal orgs so they never inflate the marketing counters.
- **Slug locked.** `PATCH /super-admin/organizations/:orgId` refuses a slug change on a flagged org
  (**403 `INTERNAL_SLUG_LOCKED`**) — the slug is the internal tooling's key (demo refresh, migrations),
  so renaming would silently break the Control Room button. (`isInternal` itself is not in the update
  schema and is schema-immutable, so it cannot be toggled here either.)
- **Billing locked to `'internal'` both ways** — see [BILLING.md](BILLING.md). This is what keeps an
  internal org out of **both** retention sweeps.
- **UI:** the Organizations list rows, the org-detail composite, the billing GET, and the
  platform-overview rows all carry `isInternal`; the console surfaces it as an "Internal" badge and, on
  a flagged org, replaces the billing status control with a "Locked to Internal" note.

**Fixing a mistakenly-internal org.** The flag is deliberately **one-way** — there is intentionally no
route, migration, or flag-clear that turns an internal org back into a customer org (that door is
exactly the attack the immutability closes). If an org is created internal by mistake, the remediation
is a **break-glass `DELETE /super-admin/organizations/:orgId`** (typed-slug confirm) and **recreate** it
as a normal customer org. An internal org holds only synthetic data, so the delete destroys nothing a
customer owns.

## Notes

- **The paging contract (batch 2).** Every super-admin list speaks the same shape, copied from
  [persons.js](../server/src/routes/superAdmin/persons.js): clamped `skip`/`limit` (+ optional regex
  `q`) in, `{ <items>, total }` out, with `total` from `countDocuments` on the same filter — exact,
  never the truncated length. **Paging is opt-in**: a request with NO `skip`/`limit` keeps the exact
  legacy response (full list / legacy window), so already-shipped mobile builds are untouched and no
  client-version gate bump was needed. Web renders pages with the shared
  [Pager.jsx](../client/src/components/Pager.jsx) (Prev/Next + "N–M of total"); mobile accumulates
  with the shared [useInfinitePaged.js](../mobile/lib/useInfinitePaged.js) hook + an explicit "Load
  more" button. Pinned by legacy-shape tests in
  [superAdminUsers.int.test.js](../server/test/superAdminUsers.int.test.js) /
  [superAdminImports.int.test.js](../server/test/superAdminImports.int.test.js) /
  [supportAccess.int.test.js](../server/test/supportAccess.int.test.js).
- **The access log** ([models/AccessLog.js](../server/src/models/AccessLog.js)) has **no TTL — on
  purpose, for now**: audit-log retention is a privacy-policy decision the owner makes deliberately,
  never a code side effect. Instead the surface shows the log's true extent (`log-facets` →
  `logTotal` + `oldestAt`). The per-request `rows`/`bytes` magnitude the middleware always stored now
  travels to the UI; any "N requests" figure is request-rows, never distinct voters.
- **`billing-rollup` / `at-risk`** ([organizations.js](../server/src/routes/superAdmin/organizations.js))
  are N+1 walks over orgs (one statement/entitlement evaluation each — same tradeoff as idle-orgs);
  fine at platform scale, revisit past the low hundreds. Count contract: **billable = statement lines
  where `l.billable === true`** (first knock before the month ended AND not archived before it began —
  [services/billing/statement.js](../server/src/services/billing/statement.js)); internal orgs are
  excluded from both. At-risk = trials expiring within `days` (default 7), `past_due`, `suspended`,
  `canceled` in wind-down (`windDownEndsAt`), plus the idle $0 zombies from `idleZeroDollarOrgs`.
- **Lockout read** (`GET /users/:userId/lockout` → `loginLockoutStatus`,
  [loginRateLimit.js](../server/src/middleware/loginRateLimit.js)): the email limiter now holds an
  explicit `MemoryStore` so state is readable, not just blind-clearable. Same per-process caveat as
  clearing — one dyno's view, reset on redeploy; the response says `scope: 'this-process'` and the UI
  prints "on this server". The env allowlist stays the durable fix.
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
- **The trend series (`PlatformDaily` + `platform-trends`)** — one row per UTC day, the five
  lifetime metrics counted from the DATES of surviving rows with the **same filter set as the live
  bucket** (internal excluded, `KNOCK_ACTIONS`, never `via:'bulk'`). Rebuilt in FULL by
  `recomputeDaily()` ([platformStats.js](../server/src/services/platform/platformStats.js)) inside
  the existing nightly `STATS_JOB` (no new cron), the manual backfill, and Reconcile-now — full
  rebuild is the point: an org hard-delete removes its bars retroactively while the `deleted` bank
  grows by the same amount. **The invariant, pinned by test:**
  `Σ(series) + undated === live` per metric — where `undated` is counted **independently**
  (`countDocuments` on a missing/null date field; possible for pre-`timestamps:true` rows, since
  Mongoose stamps `createdAt` on write only), making the identity a real cross-check of the
  bucketing rather than a residual defined into truth. The endpoint zero-fills missing days and
  **slices off today** (a partial day must never render as a dip). Deliberately **platform-wide
  with no org dimension** — the Privacy Policy's aggregate-statistics carve-out covers exactly
  this; a per-org daily series would identify a customer and is a separate privacy decision.
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
  - **The demo is a permanent two-round story, regenerated identically by seed and refresh.** The
    seed ([seedDemoOrg.js](../server/src/utils/seedDemoOrg.js)) finds-or-creates Round 1 and Round 2
    idempotently (`Pass.findOne({effortId, roundNumber})` else `createNextPass`, with a fail-loud
    guard against a stray pass minting the wrong number) and cuts+assigns each round's books via a
    shared `buildRoundBooks(pass)` — reviewer books are `isReviewerBook`-marked in **every** round.
    Round 2 is cut **last** so the `Household.turfId` mirror lands on the active round's books.
    Round 1 is archived (activated −14d 9am, archived −7d 6pm), Round 2 active (activated −6d 9am);
    the lifecycle dates are **re-stamped every run** so the narrative stays fresh relative to now
    (per-round report attribution keys on the `passId` stamped into each activity, not on date
    windows). Activity: Round 1 staged on `ARCHIVED_DAY_OFFSETS` (−8…−12), Round 2 on the default
    `DAY_OFFSETS` (today…−4) — `stageDemoActivity` takes a `dayOffsets` param — then **both rounds
    are concatenated and persisted with ONE `persistDemoActivity` call**, so a door's color is
    `resolveStatus` over all rounds (latest-across-passes) and writes stay batched. ~375-450 Round-2
    doors are deliberate **re-knocks** of Round-1 doors (two knocks, one home — the By-round table
    and knock-vs-coverage distinction demo truthfully).
  - **The refresh regenerates BOTH rounds.** `refreshDemoDay` pulls **all archived + active passes
    with published turfs** (an active-only pull would erase Round-1 history on first press), guards
    reviewer books over the union of their assignments, wipes, restages archived rounds on the old
    offsets + the active round on the defaults (concat + single persist, same as the seed), and
    touches up pass lifecycle dates at the staged-window boundary. Returns per-round staged counts +
    `reknockDoors` alongside the original staged/wiped shape (the CLI prints one per-round summary
    line; the Control Room toast shows the overall staged/wiped totals).
  - **Realism is per-canvasser, not per-book.** `stageDemoActivity` groups each canvasser's books,
    spreads them ~one-per-day across the round's day offsets, and walks each day on a single running
    clock (2-5 min/door, capped). So the single-day `doorsPerHour = knocks / (last-first span)` (see
    [reports.js](../server/src/routes/admin/reports.js), [METRICS.md](METRICS.md)) lands ~15-20/hr
    instead of collapsing a canvasser's whole inventory into one window (the old per-book scheduler
    produced ~150-200/hr). `OUTCOME_WEIGHTS` tune the connection rate (surveys ÷ knocks) to ~22%.
    (For offset sets without day 0 — the archived round — every day schedules as an evening and
    `todayKnocks` stays 0; the now-cutoff is never consulted.)
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
    (wipe + reassign: reviewer keeps one marked book per round, the rest round-robin across field
    canvassers), and restages the full two-round story — without touching
    doors/voters/report/share-link. (On an org that predates the second round, the seed *creates*
    Round 2 via `createNextPass`, cuts+publishes its books, and archives Round 1; run it with
    `--reset --apply` — or press Refresh demo day once — so the staged history matches the new pass
    dates.) Set
    `SEED_DEMO_CANVASSER_EMAIL` to the demo org's actual review-account email(s) first — comma-separate
    for multiple platforms (`apple@review.com,android@review.com`) — so the seed resolves and marks the
    right reviewer book(s).
