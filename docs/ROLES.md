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
  walker roster like any canvasser and use the canvassing flow for their own books.

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
add-picker), `POST /` (create a **net-new canvasser** — role hard-coded — and put them on this campaign;
linking an existing cross-org account stays an admin act), `PATCH /:userId/coordinator` (scoped to this
campaign's roster). This is how a lead builds a crew without the org Users admin. Adding/removing
*existing* members and reading the roster still go through `.../assignments`.

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

## Client & mobile scoping

- **Web** — `AuthContext` derives `isLead`, `isConsoleUser`, `managedCampaignIds`.
  [ProtectedRoute.jsx](../client/src/components/ProtectedRoute.jsx) `requireConsoleUser` admits leads;
  [App.jsx](../client/src/App.jsx) splits the admin area into a **console group** (`requireConsoleUser` —
  all campaign pages, incl. import + the campaign Survey *select*) and an **org-admin group**
  (`requireOrgAdmin` — Overview, the survey-template *builder*, Surveys, Tags, Voters, Users, queues).
  Route ranking keeps `/campaigns/:id/survey/new|edit` (builder, admin) ahead of
  `/campaigns/:id/survey` (attach, console). Nav ([navItems.js](../client/src/components/navItems.js) +
  [Layout.jsx](../client/src/components/Layout.jsx) + [BottomNav.jsx](../client/src/components/BottomNav.jsx))
  filters the top-level list to `leadVisible` (just Campaigns) for a lead; the full campaign drill-in nav
  is unchanged. [CampaignsPage.jsx](../client/src/pages/CampaignsPage.jsx) hides create/edit/archive/delete
  for leads; [CampaignSurveyPage.jsx](../client/src/pages/CampaignSurveyPage.jsx) hides the build/edit
  affordances; [CampaignTeamPage.jsx](../client/src/pages/CampaignTeamPage.jsx) reads the picker from the
  `crew` endpoint and gives leads an inline create-canvasser modal. Login/select-org land a lead on
  `/campaigns` (they have no `/admin` Overview).
- **Mobile** — [admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) admits `lead`;
  [index.jsx](../mobile/app/index.jsx) lands a lead in the admin tab; the admin landing's
  `/admin/reports/campaign-rollup` self-scopes to managed campaigns, and every deeper admin screen
  (Insights / Map / Books) is per-campaign, so it inherits the scope. The org Users row is hidden for
  leads in [more.jsx](../mobile/app/(app)/admin/more.jsx). The **canvasser** flow is untouched — a lead
  who walks is scoped as a canvasser via `CampaignAssignment` exactly like anyone else.

## Verification

Server files pass `node --check`; the client passes `npm run build`. The authorization matrix is covered
by a throwaway-mongod integration test ([teamLead.int.test.js](../server/test/teamLead.int.test.js)):
seed an org, an admin, and a lead granted campaign A only (with a campaign B they don't manage), then
assert the lead gets 200 on A's field routes / import / scoped reports / campaign survey PATCH, and 403
on the same for B, on campaign create/archive/delete, on the org survey/tag mutations and the org Users
admin — while 200 on `.../crew` — and that `GET /admin/campaigns` returns only A.
