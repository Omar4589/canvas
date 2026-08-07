# Roles & the team-lead (campaign-scoped admin)

Who can do what in an organization, and how the **team lead** role lets you delegate a single campaign
without handing over the whole org.

- **Part 1 — For everyone** is plain language: the three roles, what a team lead can and can't do, and
  how to grant one.
- **Part 2 — Technical reference** is the authorization contract: the grant store, the middleware, the
  per-surface enforcement, and how the client/mobile scope themselves.

Related: [USERS.md](USERS.md) (accounts, memberships, coordinators), [CAMPAIGNS.md](CAMPAIGNS.md) (the
campaign lifecycle a lead runs), [EFFORTS.md](EFFORTS.md) (walk lists / crews within a campaign).

---

# Part 1 — For everyone

There are three roles on a membership, plus a platform-wide **super admin** that sits above every org.

- **Admin** — runs the whole organization.
- **Team lead** — a **campaign-scoped admin**: runs the specific campaigns they're granted, and nothing
  outside them.
- **Canvasser** — walks doors in the mobile app for the campaigns they're on. No console.

## What a team lead is for

An org often runs several campaigns at once. A **team lead** is a trusted person you hand one (or a
few) of them to run end-to-end — they report to the admins, who usually create + set up a campaign and
then hand it off. A lead avoids the all-or-nothing choice of making a campaign runner a full org admin
(which would give them every other campaign and all the org settings too).

Inside a campaign they're granted, a lead is **as powerful as an admin**: import the voter file, build
and attach a survey (authoring their own templates, not just picking from the library), build walk
lists, cut turf, create and activate passes (rounds), assign books — **including to themselves**, since
a lead who runs a campaign shouldn't have to ask an admin to put them on a book — build and manage the
crew (including creating new canvassers), print walk packets, export the campaign's data from the
Export Center, and see all the reporting — map, timeline, insights, early voting, and client reports.

## What a team lead can never do

- **Create, archive, or delete a campaign** — admins shape the campaign list; a lead is handed campaigns.
- **Change a campaign's key dates, type, state, or its billable-door policy** (whether restricted
  homes count toward invoiced door totals — see [BILLING.md](BILLING.md)). A lead edits their
  campaign's name, survey, and timezone; anything that changes what gets *invoiced* stays with org
  admins. The server refuses with a 403 naming the field, so this can't be bypassed from the UI.
- **Run the org survey library, or touch the tag library.** Surveys are nuanced: a lead **can author**
  survey templates — create new ones, and edit or duplicate their own or any survey attached to a
  campaign they manage — but **archiving, un-archiving, and deleting** templates stay with org admins,
  and the org-wide Surveys library page itself is admin-only (a lead works from their campaign's
  Survey tab). The **tag library** is stricter: a lead can *read* tags (to filter by them) but never
  create, edit, merge, or delete them.
- **Flag a voter Do-Not-Contact, or clear the flag.** DNC is an org-wide fact about a person, not a
  campaign fact — setting it anywhere silences that voter in every campaign — so it stays with org
  admins.
- **Run org-wide or admin-only exports.** The Export Center works for a lead campaign by campaign:
  exports of a managed campaign are theirs to create and download; the org-wide scope and the
  admin-only types (voter notes, the full backup) are refused.
- **Org settings or the org voter directory.** Those stay admin-only.
- **The org-WIDE Users view.** Since 2026-07-23 a lead **does** get the Users page — but scoped:
  their list is exactly the people rostered on campaigns they manage, deduped, never the whole
  organization. (That scoped surface lives in the **mobile** admin app's Users hub and the underlying
  API; the **web** console's org Users page stays admin-only — on web a lead's people work happens on
  the campaign Team page.) On that scoped list a lead can **set temporary passwords** and **switch accounts off
  and back on**, for **canvasser accounts only** — never an admin, another lead, or Doorline staff
  (the server refuses, not just the UI). Changing roles, creating org-level accounts, deleting, and
  editing someone's identity (name/email/phone) remain admin-only.

  **The off-switch caveat is a real one:** deactivation is *not* campaign-scoped — an account is
  either on or off for the whole organization, so switching off someone a lead shares with another
  campaign takes them out of that campaign too. The app says which campaigns it reaches before you
  confirm, and the lead can reverse it.
- **Grant the team-lead role** or change anyone's grants — only admins do that.
- **See or touch any campaign they weren't granted** — everything is default-deny; a lead with no
  grants sees an empty console.

## Granting a team lead

On the **Users** page (admins only): add or edit a member, set their role to **Team lead**, and check
the campaigns they should manage. You can change the checked campaigns anytime; unchecking one revokes
it immediately. Creating, then granting, are two separate admin acts — a brand-new campaign has no lead
until an admin grants one.

## Where a team lead works

- **Web console** — they sign in to the same console and land on **Campaigns**, which shows only the
  campaigns they manage. Inside a campaign, every tab an admin sees is there. The org-only areas
  (Overview, Surveys, Tags, Voters, Users) simply aren't in their nav.
- **Mobile admin app** — they get the same admin tab (Overview / Insights / Map / Books), scoped to
  their campaigns. **People management is one surface: More → Users** (the old standalone campaign
  Team screen merged into it). A campaign's **Team** tile opens Users pre-filtered to that campaign.
  There a lead sees their campaigns' people, creates canvassers (born assigned, with an optional
  coordinator), sets temporary passwords, and switches canvasser accounts off/on — and never sees
  assignment controls (their creations auto-assign; rostering is admin work). If a lead also walks
  doors, that's a separate thing: they're added to a campaign's walker roster like any canvasser and
  use the canvassing flow for their own books. When a lead switches into canvass mode, the drawer's
  **Admin dashboard** row brings them straight back.

## If you have different roles in different organizations

One account, one email — but a separate role in each org you belong to. You might be an **admin** in one
and a **canvasser** in another. Two rules follow from that, and they're worth knowing:

- **The web console only shows the orgs where you're an admin or team lead.** An org where you're a
  canvasser can't be opened in the console — there's nothing there for you to run. It still appears on
  the org picker, greyed out under **No console access**, so you can see it's there; the work for it
  lives in the mobile app.
- **If there's exactly one org you can run from the console, signing in takes you straight into it.**
  No picker, no choice to get wrong. You'll only see the picker when you genuinely have two or more.

The **mobile app** has no such restriction: every role has a home there, so *all* your orgs are
selectable, and switching between them is how an admin-in-one/canvasser-in-another account moves between
running a campaign and walking doors.

Switching orgs in the console always lands you on that org's home page (Overview for an admin, Campaigns
for a lead) — it never leaves you on a page belonging to the org you just left.

---

# Part 2 — Technical reference

## The grant store

`CampaignManager` ([server/src/models/CampaignManager.js](../server/src/models/CampaignManager.js)) —
`{ campaignId, userId, organizationId, grantedBy, grantedAt }`, unique `(campaignId, userId)`, indexed
`{ userId, organizationId }`. A lead's authority is **exactly** the set of campaigns they hold a grant
for. It's kept **separate** from `CampaignAssignment` (the walker roster) on purpose: managing ≠ walking.
It's added to the campaign delete cascade ([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js))
and cleared when a member is removed or their role changes away from `lead`.

The `Membership.role` enum gains `'lead'` — **additive, no migration**. Default-deny means a
half-rolled-out lead (role set, no grants yet) simply sees nothing until granted.

## The authz helpers + middleware

[services/authz/campaignManagement.js](../server/src/services/authz/campaignManagement.js):

- `isOrgAdmin(req)` — super admin or org `admin` (unscoped; manages every campaign).
- `isConsoleUser(req)` — super / admin / lead (may see the console at all).
- `managedCampaignIds(req)` — a lead's grant set in the active org (array of `ObjectId`).
- `canManageCampaign(req, campaignId)` — `true` for super/admin, or a lead **granted that campaign**;
  invalid id → `false`. Default-deny.

`requireCampaignManager` ([middleware/auth.js](../server/src/middleware/auth.js)) gates a campaign-nested
route on `canManageCampaign(req, req.params.campaignId)`. It runs after `orgContext` and **replaces**
`requireOrgRole('admin')` on the eleven campaign routers; each keeps its own `loadCampaign` org-ownership
check, so ownership and management are enforced independently.

## Super admins inside an org — including internal orgs

A super admin acts on org routes through the **same admin surfaces** everyone else does, not a parallel
one: `requireOrgRole(...)` short-circuits to `next()` for any `isSuperAdmin` caller
([middleware/auth.js](../server/src/middleware/auth.js)), so once `orgContext` has seated them in an org
they use the ordinary `/admin/*` endpoints as an admin. What differs is only how `orgContext` seats
them: a **customer** org requires a live support grant (and logs), while a **Doorline-owned internal
org** (`Organization.isInternal`) is free entry — no grant, no AccessLog row — because it holds only
synthetic data (see [PLATFORM.md](PLATFORM.md) → *When Doorline staff can see customer data* and
*Internal (Doorline-owned) organizations*).

This is why there is **no separate super-admin password-reset endpoint.** Resetting a member's
temporary password in an internal org goes through the **normal org-admin surface** —
`PATCH /admin/memberships/:userId/password`, the same "Set temporary password" control an org admin
uses (see [USERS.md](USERS.md)). Staff act *as* the internal org's admin, directly; there is nothing to
build alongside it.

## Per-surface enforcement (the contract)

**Campaign-nested routers** — `requireCampaignManager` (super/admin/granted-lead): `assignments`,
`campaignHouseholds`, `walklists`, `voted`, `efforts`, `passes`, `setup-status`, `turfs`,
`turfs/:turfId/assignments`, `crew` (the lead crew surface, detailed below), and `packets`
(printable walk packets — voter PII on paper, read-only; pinned by
[packet.int.test.js](../server/test/packet.int.test.js)). A lead does everything an admin does inside
a granted campaign.

**Correcting a household pin** — the same `canManageCampaign` policy on **both** write paths, one of
them not campaign-nested: web `PATCH /admin/campaigns/:id/households/:householdId/location` (via the
router's `requireCampaignManager`) and mobile `POST /mobile/households/:householdId/location` (which
calls `canManageCampaign(req, household.campaignId)` **inline**, since its path carries no
`:campaignId`). **Canvassers cannot move a pin** — moving one is a data change with an audit trail, and
leaving it open let a faked door be laundered past the GPS audit (see [AUDIT.md](AUDIT.md) § B.7). This
is the only mobile route with a role gate: everything else under `/mobile` is scoped by data
(`canvasserHouseholdScope`), not by role. Note the ordering — the gate **replaces** the route's
`assertHouseholdAccess` call, whose roster check would otherwise refuse a lead who manages the campaign
but was never rostered onto it as a walker.

That parity extends past the router gate into the **assignability** check those routers share:
`partitionAssignable` ([services/campaignRoster.js](../server/src/services/campaignRoster.js)) allows
anyone on the campaign roster, **any active org `admin`**, **a lead holding a `CampaignManager` grant on
_this_ campaign**, or a super admin — the lead arm scoped to the campaign, never "is a lead somewhere".
Without it a lead could cut turf and hand out every book except their own: the check matched role
`'admin'` only, so self-assignment 409'd as *not on the team*.

**Campaign-targeted org routers** — role `('admin','lead')` at the router, then a per-request check:

- **`campaigns`** ([campaigns.js](../server/src/routes/admin/campaigns.js)) — `GET /` returns only
  `managedCampaignIds` for a lead. `PATCH /:id` is allowed for a managed campaign but a lead may edit
  only `{name, surveyTemplateId, timeZone}` — `isActive` (archive), `type`, and `state` are admin-only.
  `POST` (create) and `DELETE` are **admin-only** (inline `isOrgAdmin` guard).
- **`imports`** ([imports.js](../server/src/routes/admin/imports.js)) — every campaign-targeted endpoint
  (`/csv`, `/csv/preview`, `/csv/preview-enqueue`, `/geocode-check`, the job detail/errors/undo, and the
  history list) requires the target `campaignId ∈ managedCampaignIds` for a lead (`manages()` helper).
- **`reports`** ([reports.js](../server/src/routes/admin/reports.js)) — a router-level gate requires a
  lead to pass a **managed** `campaignId`; org-wide (no campaignId) reports are refused. This also closes
  a pre-existing gap where `baseFilter` trusted any `campaignId`. The one exception is
  **`/campaign-rollup`** (the multi-campaign list, e.g. the mobile admin landing): it's exempt from the
  gate and instead self-scopes its list to `managedCampaignIds`.
- **`client-reports`** ([clientReports.js](../server/src/routes/admin/clientReports.js)) — every handler
  authorizes on the report/share/campaign's `campaignId` via `manages()`; the list scopes to
  `managedCampaignIds`.

**Org-wide, read-for-leads** — `tags`: role `('admin','lead')` so a lead can `GET` the library (to
filter by tag), but every mutation (create, edit, merge, delete) carries a per-route
`requireOrgRole('admin')`.

**Surveys — leads author; admins own the lifecycle.** The `surveys` router is `('admin','lead')`,
and a lead's write access is per-survey rather than blanket-denied: `POST /` (create) is **open to
leads** — `createdBy` is stamped, and *attaching* a survey to a campaign is separately
campaign-manager-scoped — while `PATCH /:id` and `POST /:id/duplicate` gate on `canManageSurvey`
([campaignManagement.js](../server/src/services/authz/campaignManagement.js)): the lead authored it,
or it is attached to a managed campaign as the campaign default or an Effort (walk-list) override.
Archive, unarchive, and `DELETE` carry `requireOrgRole('admin')`. Pinned by
[teamLead.int.test.js](../server/test/teamLead.int.test.js) ("lead survey edit/duplicate is scoped").

**Org-wide, lead-SCOPED** — `memberships` (the Users surface) is `('admin','lead')` since
2026-07-23, with per-route boundaries inside
([memberships.js](../server/src/routes/admin/memberships.js)):

- `GET /` — a lead's list is filtered to `leadVisibleUserIds` (everyone holding a
  `CampaignAssignment` on a campaign in their `managedCampaignIds` grant set; empty grants → empty
  list, default-deny).
- `PATCH /:userId/password`, `/deactivate`, `/reactivate` — allowed for a lead only when
  `leadMayManageTarget` passes: the target's membership role is **`canvasser`** AND they share a
  managed campaign. Fellow leads and admins are never manageable (privilege-escalation guard).
- `GET /:userId/{crews,campaigns,stats,recent-activity}` — read drills allowed for any *visible*
  target (`leadMaySeeTarget`), 403 outside the scope.
- `POST /`, `PATCH /:userId` (role/grants/billing), `DELETE /:userId`, `PATCH /:userId/user`
  (identity) — walled by `requireAdminRole` → `403 { code: 'ADMIN_ONLY' }`.
- The whole matrix is pinned by
  [`test/leadUserManagement.int.test.js`](../server/test/leadUserManagement.int.test.js).

**Org-only, leads blocked** — `voters` (org voter directory) stays `requireOrgRole('admin')` with no
per-route carve-outs; `dnc` is mounted org-level and admin-only on purpose (see below); and `queues`
is stricter than the old "admin" framing here — its one route is `requireSuperAdmin`, a **platform**
surface, so even org admins don't reach it (the web mounts it under `RoleGate require="super"`).

> ⚠️ **One write on `leadCrew` is NOT campaign-shaped, and it is the only one.**
> `PATCH .../crew/:userId/deactivate` and `.../reactivate` write `Membership.isActive`, and
> [`Membership`](../server/src/models/Membership.js) has **no `campaignId`** — one row per person per
> org. So the usual guarantee on this router ("the campaign in the URL bounds the blast radius") does
> **not** hold for these two, and they are guarded on the **target** instead:
>
> - the role lives **inside the update filter**, not in a read before it — a read-then-write races a
>   concurrent promotion to `{role:'admin', billingAccess:true}` and would defeat *both* billing
>   layers, which were computed against the stale snapshot;
> - `User.isSuperAdmin` is refused outright — a super-admin can hold an ordinary canvasser membership,
>   and switching it off would force Doorline staff onto the support-grant path where every request
>   logs as vendor intrusion, poisoning the audit trail `orgContext` exists to keep clean;
> - vendor staff (support-grant holders) are guarded per **target**, not per router: the 2026-07-29
>   owner decision removed the blanket `VENDOR_READ_ONLY` rule (never re-add it), so a support grant
>   now permits crew writes — every one recorded by `accessLog` — with one surviving refusal: any
>   write **targeting** a Doorline staff account, via `refuseVendorStaffTarget`
>   ([vendorGuards.js](../server/src/services/memberships/vendorGuards.js)), which guards all four
>   leadCrew writes (create, coordinator, deactivate, reactivate);
> - the response carries **`alsoAffects`** — the other campaigns this reaches. The clients disclose
>   the reach **before** committing by reading `GET /admin/memberships/:userId/crews` into the
>   confirm dialog (mobile MemberSheet + member detail, web UserProfileModal): `/crews` resolves
>   campaign *names* and is deliberately **not grant-filtered**, so the list names campaigns the
>   acting lead doesn't manage — which is the point. (Never resolve ids against `GET
>   /admin/campaigns` for this — that list is lead-scoped and drops exactly the campaigns the
>   warning exists to name.)
>
> They ship as a **pair**. A deactivate without its inverse would be a one-way door for a lead, and
> their books stay assigned precisely because reactivation is one tap away — the same reason the org
> route doesn't release work either.

**Campaign-map data — allows leads, authorized per campaign.** The campaign Map tab is lead-visible, so
its data endpoints allow `('admin','lead')` and gate leads on the campaign: `households`
([households.js](../server/src/routes/admin/households.js)) — `GET /map` requires a managed `campaignId`
(no org-wide map), and `GET /:householdId/activity` authorizes on the household's `campaignId`; and
`activities` (`GET /admin/activities/:id`, the ping detail) authorizes on the activity's `campaignId`. So
a lead sees the map + ping/household detail only for campaigns they manage.

**Export Center — campaign-scoped for leads.** `exports` is `('admin','lead')` with the
imports/reports posture ([exports.js](../server/src/routes/admin/exports.js)): a lead may create and
download exports of a **managed** campaign; the org-wide scope (`campaignId: null`) and the
admin-only types are refused (`def.adminOnly || !campaign` → `isOrgAdmin`), the type list is
filtered per role, and the history list scopes to `managedCampaignIds` — a lead's `$in` filter never
matches `null`. Pinned by [exports.int.test.js](../server/test/exports.int.test.js).

**DNC — deliberately NOT lead territory.** `/admin/dnc` is mounted **org-level**, not
campaign-nested, and gated `requireOrgRole('admin')` ([dnc.js](../server/src/routes/admin/dnc.js)):
DNC is an org-wide fact on the Voter, and the campaign-nested `voted.js` gate
(`requireCampaignManager`) would admit leads — the mount comment in
[routes/index.js](../server/src/routes/index.js) records exactly this. Pinned by
[dnc.int.test.js](../server/test/dnc.int.test.js).

**Import mapping profiles — deliberately lead-writable.** `GET`/`POST /admin/imports/profiles` are
org-wide, name-keyed vendor column mappings behind only the router's `('admin','lead')` gate: a lead
can read them and save/overwrite one by name. Owner-ruled 2026-08-07 — leads run imports, so they
keep profile self-service; the profiles hold column mappings, never voter data.

**Client-report shares — one write is org-shaped, and it is admin-only.** Every share route
authorizes leads per campaign via `manages()`
([clientReports.js](../server/src/routes/admin/clientReports.js)) — except
`POST /shares/revoke-legacy`, the org-wide sweep that kills every legacy-open link at once. That is
an org operator's switch, so since 2026-08-07 it carries a per-route `requireOrgRole('admin')`;
before that a lead could enumerate and bulk-revoke links on campaigns they held no grant for. Pinned
by [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js).

**The lead's crew surface** — `leadCrew` ([leadCrew.js](../server/src/routes/admin/leadCrew.js)) at
`/admin/campaigns/:campaignId/crew`, behind `requireCampaignManager`: `GET /` (org members for the
add-picker), `POST /` (create a **canvasser** — or **link an existing account by email** (`linkExisting`)
— role hard-coded, and put them on this campaign; a lead owns onboarding, so linking a returning
cross-org canvasser is allowed here too, with the same privacy guards as the admin path), `PATCH
/:userId/coordinator` + `GET /:userId/coordinator-preview` (both scoped to this campaign's roster).
This is how a lead builds a crew without the org Users admin. Adding/removing *existing* members and
reading the roster still go through `.../assignments`.

**A lead's coordinator change is confined to the campaign in the URL — structurally, not by
convention.** A crew lives on `CampaignAssignment.coordinatorId` (unique `{campaignId, userId}`), so
both the roster write and the **ledger re-stamp** that follows it (see [USERS.md](USERS.md) and
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract)) are keyed on
**`req.params.campaignId`** — resolved through `loadOwnedCampaign`, which also re-checks org ownership.
That is *the same param* `requireCampaignManager` gated the mount on, which is the whole guarantee: a
lead physically cannot address a campaign they weren't granted, because there is no campaign id in the
body to forge. Changing a crew in campaign A moves zero doors in campaign B. The preview endpoint still
exists so they see the door count before committing — now **this campaign's** count.

> ⚠️ **Take the scope from the URL, never from the body — and never let it default.**
> `restampFilter` ([restampCoordinator.js](../server/src/services/memberships/restampCoordinator.js))
> **requires** a `campaignId` and throws without one, rather than treating an omitted scope as
> "everything". That was the bug: the crew used to live on `Membership` (unique
> `{userId, organizationId}` — one slot per person per org), so two leads managing two campaigns with a
> shared canvasser overwrote each other, and the org-wide re-stamp then dragged the **first** campaign's
> entire history onto the **second** lead's team, in a race that lead does not manage.

Member creation + validation is shared in
[services/memberships/createMember.js](../server/src/services/memberships/createMember.js)
(`createOrgMember`, `resolveCoordinatorId` — now accepts admin **or** lead coordinators —,
`resolveManagedCampaigns`), reused by both `memberships` and `leadCrew`. `createOrgMember` takes an
optional `campaignId`, which the lead's crew path supplies and the plain org-Users add does not: joining
an **org** carries no crew, so with no campaign the create-time re-stamp is skipped entirely — there is
no race whose history the call has authority over.

## Granting (admins only)

`POST/PATCH /admin/memberships` accept `managedCampaignIds[]` when the role is/becomes `lead`;
`resolveManagedCampaigns` validates every id is a campaign in the org, and the route reconciles
`CampaignManager` rows (upsert the set, delete the rest). Leaving the `lead` role clears all grants;
`DELETE /:userId` clears them too. `GET /admin/memberships` returns each member's `managedCampaignIds`.
The login / `/auth/me` payload carries `managedCampaignIds` on a lead membership so the client scopes
without an extra fetch.

## Who may open the console: the one predicate

[client/src/lib/roles.js](../client/src/lib/roles.js) is the **single** definition of "this membership
role can use the web console" — `CONSOLE_ROLES = ['admin', 'lead']`, plus `isConsoleRole`,
`consoleMemberships`, `nonConsoleMemberships`, and `autoSelectOrgId`. Super admin is a global `User`
boolean, not a membership role, so it is deliberately **not** in that list; callers pass `isSuperAdmin`
separately to `consoleHomePath` ([lib/homePath.js](../client/src/lib/homePath.js)). Never inline
`role === 'admin' || role === 'lead'` again.

The bug that produced this file: the org picker and the sidebar switcher each built their own unfiltered
membership list, so a user who was an admin in Org A and a **canvasser** in Org B could pick Org B, get
routed by `homePathForRole('canvasser')` to the admin-only `/admin`, and hit a Forbidden screen that had
replaced the whole app — no nav, no way back, and sticky across reloads because `canvass.activeOrgId`
persists in `localStorage`.

`homePathForRole` is now a lookup (`{admin: '/admin', lead: '/campaigns'}`) that returns **`null`** for
any other role, so no role can silently land on `/admin` again. `resolveHomePath` counts *console*
memberships: exactly one → enter it and skip the picker; two or more → the picker; zero → `null`.

**`null` is a destination, not an error.** `postAuthPath()` (same file) is `resolveHomePath(args) || '/select-org'`,
and every post-auth caller uses it — `LoginPage` (both the submit path and the already-signed-in guard) and
`ChangePasswordPage`. `/select-org` explains that the console is admins-and-leads only and carries the
**Get the app** install card. Before this, `LoginPage` rendered a dead-end red error naming roles the user
doesn't have, so a canvasser who set their password from an emailed invite link had nowhere to go at all —
the one path `ChangePasswordPage` had always handled correctly.

## The gate invariant

> **A gate that wraps `<Layout/>` may only *redirect*. A gate that renders *inside* `<Layout/>` may
> render `<Forbidden/>`.**

Breaking this rule is what made the bug unrecoverable rather than merely wrong.

- [ProtectedRoute.jsx](../client/src/components/ProtectedRoute.jsx) is the **ORG-level** gate and wraps
  `<Layout/>`, so it only ever `<Navigate>`s: not signed in → `/login`; owes a password change →
  `/change-password`; no active org → `/select-org`; **active org but no console role in it** →
  `/select-org`. Props are `requireActiveOrg`, `requireConsoleAccess`, `allowPasswordChange`. No
  redirect loop is possible: every target is mounted with those flags off.
- [RoleGate.jsx](../client/src/components/RoleGate.jsx) is the **ROLE-level** gate and lives *inside*
  `<Layout/>` as a pathless layout route (`require="orgAdmin" | "billing" | "super"`). On failure it
  renders [Forbidden.jsx](../client/src/components/Forbidden.jsx) in the content area, with the sidebar,
  the org switcher and Sign out still on screen. It replaced four inline
  `<div className="p-8 text-danger">Forbidden…</div>`s.

`AuthContext` **self-heals** a stale `activeOrgId`: if the persisted org is one the user has no console
role in (demoted, removed, hand-edited, left over from an older build), it is cleared, so the app can
never be pinned to an unusable org across reloads. Super admins are exempt — they legitimately hold an
`activeOrgId` for orgs they aren't members of. `AuthContext.homePath` is guaranteed non-null (falls back
to `/select-org`) because six render-time consumers pass it straight to `<Link to>` / `navigate()`.

## Client & mobile scoping

- **Web** — `AuthContext` derives `isOrgAdmin`, `isLead`, `isConsoleUser` (the *active* org) and
  `hasConsoleAccess` (*any* org), plus `managedCampaignIds`. [App.jsx](../client/src/App.jsx) mounts
  **two** `<Layout/>` shells: an **org-scoped** one (`requireConsoleAccess` — all campaign pages, incl.
  import and the campaign Survey select *and builder*, which leads may reach; the server's
  `canManageSurvey` enforces per-survey scope) with a nested `RoleGate require="orgAdmin"` around the
  org-admin screens (Overview, Surveys, Tags, Voters, Users, duplicate-surveys) and a `RoleGate
  require="billing"` nested inside that around `/billing`; and an **org-agnostic** one
  (`requireActiveOrg={false}` — `/profile`, `/help`) with a nested `RoleGate require="super"` around
  the platform screens — including the Jobs/queues screen, which lives in the super shell (not the
  orgAdmin group) because its server route is `requireSuperAdmin`. Nav
  ([navItems.js](../client/src/components/navItems.js) + [Layout.jsx](../client/src/components/Layout.jsx)
  + [BottomNav.jsx](../client/src/components/BottomNav.jsx)) filters the top-level list to `leadVisible`
  (just Campaigns) for a lead; the full campaign drill-in nav is unchanged.
  [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) hides create/edit/archive/delete for leads;
  [CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) **shows** a lead the authoring
  affordances (New/Edit/Duplicate) via `canManage = isOrgAdmin || managedCampaignIds.includes(campaignId)`,
  with the server's `canManageSurvey` as the per-survey authority;
  [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) reads the picker from the `crew`
  endpoint, gives leads an inline create-canvasser modal, and is the **one** place a crew is set (the
  org Users page shows crews read-only). Login/select-org land a lead on `/campaigns` (they have no
  `/admin` Overview).
- **The `/admin/memberships` fork** — that route is admin-only, so any *campaign* page that reads it for
  a name list breaks for a lead. Three pages now branch on `isOrgAdmin`, calling
  `/admin/campaigns/:id/crew` instead (same shape, open to the lead who manages the campaign) and keying
  the query `['admin','campaign-crew',campaignId]` so the two never share a cache entry:
  `CampaignTeamPage`, [CampaignAssignmentsModal.jsx](../client/src/components/CampaignAssignmentsModal.jsx)
  (opened from the Campaigns page's **ungated** action list, so a lead reaches it) and
  [EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) (the "assigned by" labels). **The failure mode is
  what makes this worth a bullet:** the 403 arrived as an empty array, so the picker rendered *empty* and
  the labels rendered *blank* — the UI asserting there is nobody, rather than that you may not look. Both
  web cases were found only by grepping for the pattern after the mobile one was reported.
- **The two org lists** — [SelectOrgPage.jsx](../client/src/pages/SelectOrgPage.jsx) makes only
  `consoleMemberships` selectable, renders `nonConsoleMemberships` as a muted, non-interactive **"No
  console access"** section pointing at the mobile app, and auto-enters when there is exactly one console
  org. [OrgSwitcher.jsx](../client/src/components/OrgSwitcher.jsx) lists only `consoleMemberships` and,
  critically, **navigates to the new org's role home on every switch**. Not navigating was a second bug:
  a URL is org-scoped, so switching while sitting on `/users` (admin → lead org) 403'd, and switching
  while drilled into `/campaigns/<old org's id>` produced "Campaign not found".
- **Mobile** — canvasser-first, so **every** membership is selectable and there is no Forbidden screen
  anywhere: every gate is a `<Redirect>`, and the root re-router ([index.jsx](../mobile/app/index.jsx))
  re-derives the role after each org switch. [lib/role.js](../mobile/lib/role.js) mirrors the web split —
  `isOrgAdmin` (unscoped org authority; **excludes** `lead`) vs `isConsoleUser` / `isConsoleRole` (may see
  the admin app; **includes** `lead`). Gate admin *entry points* on `isConsoleUser`, billing/org-wide
  affordances on `isOrgAdmin`. [admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) and
  [index.jsx](../mobile/app/index.jsx) both use `isConsoleRole`; the canvasser drawer's **Admin
  dashboard** row is gated on `isConsoleUser` (it was `isOrgAdmin`, which stranded a lead who switched to
  canvass mode). In [more.jsx](../mobile/app/(app)/admin/more.jsx) the org Users row is **shown** to
  leads (server-scoped to their campaigns' rosters since 2026-07-23 — the old `isLead` branch that hid
  it was deleted as dead code); the **Duplicate surveys** row is likewise `isConsoleUser`, but the
  Delete inside that screen is `isOrgAdmin`, since `admin/voters.js` is `requireOrgRole('admin')`
  router-wide — a lead reads every duplicate and can remove none. The campaign screen's **Team** tile
  ([campaign/\[campaignId\].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx)) opens the
  **Users hub pre-filtered to that campaign** ([users.jsx](../mobile/app/(app)/admin/users.jsx)) —
  since the 2026-07-23 change made `/admin/memberships` lead-scoped server-side, the hub is one
  surface for everyone. (The historical bug this area carried: before the scoping, a lead's
  `/admin/memberships` call 403'd and the hub rendered the failure as **"No users yet"** — the app
  stating as fact that the organization is empty to somebody simply not allowed to look.) The member
  sheet ([MemberSheet.jsx](../mobile/components/MemberSheet.jsx)) carries a coordinator picker
  (staged pick → `coordinator-preview` door count → confirm) wired to the campaign-scoped `crew`
  endpoints, so crews are settable from mobile as well as from
  [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) on web. The **canvasser** flow is
  untouched — a lead who walks is scoped as a canvasser via `CampaignAssignment` exactly like anyone
  else.

## Machine-readable 403s

Both role gates in [middleware/auth.js](../server/src/middleware/auth.js) (`requireOrgRole`,
`requireOrgMember`, `requireCampaignManager`) return `403 { error, code: 'FORBIDDEN_ROLE' }`, and every
org-resolution failure in [middleware/orgContext.js](../server/src/middleware/orgContext.js) (not a
member → 403, org not found → 404, bad header → 400) carries `code: 'ORG_CONTEXT'`. The distinction is
what lets the clients self-heal *correctly*:

- **`ORG_CONTEXT`** = "that isn't your org" → drop `activeOrgId`, route to the picker. Both clients do
  this ([client/src/api/client.js](../client/src/api/client.js);
  [mobile/app/_layout.jsx](../mobile/app/_layout.jsx)'s `QueryCache.onError`).
- **`FORBIDDEN_ROLE`** = "the org is fine, your role isn't." The web client deliberately does **not**
  eject on this (a lead calling an admin-only endpoint is a bug to fix, not a reason to sign them out).
  Mobile uses it to detect a **mid-session role change**: it refetches `/auth/me` via
  [lib/session.js](../mobile/lib/session.js) and only re-routes if the role actually changed — which
  makes the recovery loop-proof. `refreshSession()` also runs on app foreground, on the authenticated
  shell mounting, and before the org picker lists memberships, since mobile otherwise cached roles at
  login and never refetched them.

## Verification

Server files pass `node --check`; the client passes `npm run build`.

**The console-access rule** is a pure function, so it's unit-tested with no React, DOM or DB:
[client/src/lib/homePath.test.js](../client/src/lib/homePath.test.js) (`npm --prefix client test`) walks
the roles × org-count matrix and locks the regressions — `homePathForRole('canvasser') === null`;
admin-in-A + canvasser-in-B resolves to `/admin` **even with a stale `activeOrgId` pointing at B**;
`autoSelectOrgId` never picks a canvasser org; and `consoleHomePath` still handles the synthetic
`'super_admin'` role the two org lists build (the trap in the refactor — a lookup map returns `null` for
it, which would have silently broken super-admin org entry).

**The authorization matrix** is covered by throwaway-mongod integration tests (`npm --prefix server run
test:int`):

- [teamLead.int.test.js](../server/test/teamLead.int.test.js) — seed an org, an admin, and a lead granted
  campaign A only (with a campaign B they don't manage), then assert the lead gets 200 on A's field
  routes / import / scoped reports (overview, the notes feed, campaign-rollup self-scoping) /
  campaign survey PATCH / the campaign map / household activity / the activity ping detail, and 403
  on the same for B, on campaign create/archive/delete, on tag creation, on survey
  archive/unarchive/delete, and on the org voter directory. Survey **create** is asserted **201** —
  leads author — and edit/duplicate follow the `canManageSurvey` scope (own or managed-attached yes,
  unmanaged-attached no). `GET /admin/memberships` is asserted **200 lead-scoped** (since
  2026-07-23); the full Users boundary matrix is
  [`leadUserManagement.int.test.js`](../server/test/leadUserManagement.int.test.js)'s job. `.../crew`
  is 200/201, `GET /admin/campaigns` returns only A, and role 403s carry `code: 'FORBIDDEN_ROLE'` at
  both the org and campaign gate. Lead scope on the newer surfaces is pinned elsewhere: packets in
  [packet.int.test.js](../server/test/packet.int.test.js), exports in
  [exports.int.test.js](../server/test/exports.int.test.js), the DNC refusal in
  [dnc.int.test.js](../server/test/dnc.int.test.js), the flags list + bulk review in
  [flagBulkReview.int.test.js](../server/test/flagBulkReview.int.test.js), the canvasser timeline and
  overlap doors in
  [perCanvasserAndOverlaps.int.test.js](../server/test/perCanvasserAndOverlaps.int.test.js), and the
  admin-only `revoke-legacy` share sweep in
  [reportSecurity.int.test.js](../server/test/reportSecurity.int.test.js).
- [perCampaignCrews.int.test.js](../server/test/perCampaignCrews.int.test.js) — the scope guarantee
  above, as a fixture no other suite could build: **two campaigns in ONE org** (Asa leads HD54, Frank
  leads HD64, Maria canvasses both). Asserts that two leads setting Maria's crew in their own campaigns
  don't clobber each other, and that Frank's change in HD64 moves **zero** doors in HD54 — the campaign
  he does not manage. `teamAttribution.int.test.js` puts its second campaign in a *different* org, so
  all 22 of its tests stayed green through both bugs: a suite that cannot construct the failure cannot
  report it.
- [multiOrgRoles.int.test.js](../server/test/multiOrgRoles.int.test.js) — the mixed-role contract: ONE
  user who is `admin` in Org A and `canvasser` in Org B. Asserts login returns **both** memberships with
  their true roles (the client's picker filter depends on the canvasser row being present), that
  admin-only routes with `X-Org-Id: B` are 403 + `FORBIDDEN_ROLE` (the server never trusted the client's
  role logic), that an org with no membership is 403 + `ORG_CONTEXT` (a *different* recovery), and that
  Org B still serves the routes a canvasser is entitled to.
