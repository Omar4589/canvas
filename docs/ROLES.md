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

Inside a campaign they're granted, a lead is **as powerful as an admin**: import the voter file, attach
a survey, build walk lists, cut turf, create and activate passes (rounds), assign books, build and
manage the crew (including creating new canvassers), and see all the reporting — map, timeline,
insights, early voting, and client reports.

## What a team lead can never do

- **Create, archive, or delete a campaign** — admins shape the campaign list; a lead is handed campaigns.
- **Change a campaign's key dates, type, state, or its billable-door policy** (whether restricted
  homes count toward invoiced door totals — see [BILLING.md](BILLING.md)). A lead edits their
  campaign's name, survey, and timezone; anything that changes what gets *invoiced* stays with org
  admins. The server refuses with a 403 naming the field, so this can't be bypassed from the UI.
- **Touch org-wide libraries** — the **survey template library** and the **tag library**. A lead can
  *read* both (to attach a survey to their campaign and to filter by tag) but not create/edit/delete
  templates or tags.
- **The org Users administration, org settings, or the org voter directory.** A lead builds their crew
  from a campaign-scoped screen instead (see below).
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
  their campaigns. If a lead also walks doors, that's a separate thing: they're added to a campaign's
  walker roster like any canvasser and use the canvassing flow for their own books. When a lead
  switches into canvass mode, the drawer's **Admin dashboard** row brings them straight back.

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
`requireOrgRole('admin')` on the nine campaign routers; each keeps its own `loadCampaign` org-ownership
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
`turfs/:turfId/assignments`. A lead does everything an admin does inside a granted campaign.

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

**Org-wide, read-for-leads** — `surveys` + `tags`: role `('admin','lead')` so a lead can `GET` the
library (to attach a survey / filter by tag), but every mutation carries a per-route
`requireOrgRole('admin')`.

**Org-only, leads blocked** — `memberships` (org Users admin), `voters` (org voter directory), `queues`
stay `requireOrgRole('admin')`.

**Campaign-map data — allows leads, authorized per campaign.** The campaign Map tab is lead-visible, so
its data endpoints allow `('admin','lead')` and gate leads on the campaign: `households`
([households.js](../server/src/routes/admin/households.js)) — `GET /map` requires a managed `campaignId`
(no org-wide map), and `GET /:householdId/activity` authorizes on the household's `campaignId`; and
`activities` (`GET /admin/activities/:id`, the ping detail) authorizes on the activity's `campaignId`. So
a lead sees the map + ping/household detail only for campaigns they manage.

**The lead's crew surface** — `leadCrew` ([leadCrew.js](../server/src/routes/admin/leadCrew.js)) at
`/admin/campaigns/:campaignId/crew`, behind `requireCampaignManager`: `GET /` (org members for the
add-picker), `POST /` (create a **canvasser** — or **link an existing account by email** (`linkExisting`)
— role hard-coded, and put them on this campaign; a lead owns onboarding, so linking a returning
cross-org canvasser is allowed here too, with the same privacy guards as the admin path), `PATCH
/:userId/coordinator` + `GET /:userId/coordinator-preview` (both scoped to this campaign's roster).
This is how a lead builds a crew without the org Users admin. Adding/removing *existing* members and
reading the roster still go through `.../assignments`.

> ⚠️ **A lead's coordinator change is ORG-WIDE, despite the campaign-scoped URL.** The write filter is
> `{userId, organizationId}` — `Membership` has no `campaignId`, so a coordinator has never been
> per-campaign. Since the change now also **re-stamps that person's knock history** onto the new crew
> (see [USERS.md](USERS.md) and [METRICS.md](METRICS.md#teams-coordinators--the-counting-contract)),
> a lead reorganizing their crew inside one campaign moves that person's doors in **every** campaign
> in the org. The preview endpoint exists so they see the door count before committing.

Member creation + validation is shared in
[services/memberships/createMember.js](../server/src/services/memberships/createMember.js)
(`createOrgMember`, `resolveCoordinatorId` — now accepts admin **or** lead coordinators —,
`resolveManagedCampaigns`), reused by both `memberships` and `leadCrew`.

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
  org-admin screens (Overview, Surveys, Tags, Voters, Users, queues) and a `RoleGate require="billing"`
  nested inside that around `/billing`; and an **org-agnostic** one (`requireActiveOrg={false}` —
  `/profile`, `/help`) with a nested `RoleGate require="super"` around the platform screens. Nav
  ([navItems.js](../client/src/components/navItems.js) + [Layout.jsx](../client/src/components/Layout.jsx)
  + [BottomNav.jsx](../client/src/components/BottomNav.jsx)) filters the top-level list to `leadVisible`
  (just Campaigns) for a lead; the full campaign drill-in nav is unchanged.
  [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) hides create/edit/archive/delete for leads;
  [CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) hides the build/edit affordances;
  [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) reads the picker from the `crew`
  endpoint and gives leads an inline create-canvasser modal. Login/select-org land a lead on `/campaigns`
  (they have no `/admin` Overview).
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
  canvass mode). The org Users row is hidden for leads in
  [more.jsx](../mobile/app/(app)/admin/more.jsx). The **canvasser** flow is untouched — a lead who walks
  is scoped as a canvasser via `CampaignAssignment` exactly like anyone else.

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
  routes / import / scoped reports / campaign survey PATCH, and 403 on the same for B, on campaign
  create/archive/delete, on the org survey/tag mutations and the org Users admin — while 200 on
  `.../crew` — and that `GET /admin/campaigns` returns only A. Also asserts role 403s carry
  `code: 'FORBIDDEN_ROLE'` at both the org and campaign gate.
- [multiOrgRoles.int.test.js](../server/test/multiOrgRoles.int.test.js) — the mixed-role contract: ONE
  user who is `admin` in Org A and `canvasser` in Org B. Asserts login returns **both** memberships with
  their true roles (the client's picker filter depends on the canvasser row being present), that
  admin-only routes with `X-Org-Id: B` are 403 + `FORBIDDEN_ROLE` (the server never trusted the client's
  role logic), that an org with no membership is 403 + `ORG_CONTEXT` (a *different* recovery), and that
  Org B still serves the routes a canvasser is entitled to.
