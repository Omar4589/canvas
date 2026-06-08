# Client portal & weekly reports

How a candidate (the "client") logs in to a read-only portal and reads the weekly reports you used
to assemble by hand and email — an "Activity at a glance" KPI strip, a support breakdown, survey and
voter-contact breakdowns, your written observations, and an interactive map of where the team has
been. Reports are **published weekly snapshots**: you build one, review it, and publish it; the
client only ever sees frozen, published reports, and can scroll back through every prior week.

- **Part 1 — For everyone** is plain language: what a client sees, how you build and publish a
  weekly report, and how to give a candidate a login scoped to their campaign.
- **Part 2 — Technical reference** is for developers (and Claude): the models, the build/publish
  (freeze) flow, the dual-window numbers, the as-of-date map snapshot, the endpoints, and the
  campaign-scoping guards.

Related: [METRICS.md](METRICS.md) (the numbers a report freezes), [SURVEYS.md](SURVEYS.md) (where the
support/survey breakdowns come from), [MAPS.md](MAPS.md) (the shared map rendering), [USERS.md](USERS.md)
(roles + adding people), [TIMEZONES.md](TIMEZONES.md) and [DATE_FILTERS.md](DATE_FILTERS.md) (how the
report week is anchored).

---

# Part 1 — For everyone

## What the client sees

A client signs in and lands on **/client** — a slim portal with no admin tools, just their **weekly
reports**, newest first. Opening one shows:

- **Activity at a glance** — headline cards (doors knocked, surveys taken, voters surveyed, connection
  rate). Each card shows the **cumulative total** as the big number and a **"+N this week"** delta, so
  the candidate sees both the running total and the week's progress.
- **Support breakdown** — the counts for the survey question you designate as "support" (e.g. *1,394
  Support · 404 Likely Support · 889 Undecided · 50 Opposed*).
- **Voter contact breakdown** — outcomes across the doors: surveyed, not home, wrong address, lit
  dropped.
- **Survey breakdowns** — per-question option counts and percentages for the questions you choose to
  show.
- **Canvasser observations** — your written, sectioned narrative (e.g. *Voter Intent*, *Opponent
  Activity*).
- **A coverage map** — an interactive, read-only map of where the team has been: only the doors we
  actually reached (unknocked doors are hidden), colored by outcome, with filters by status and survey
  answer (the status chips follow the campaign type — no lit-drop chip on a survey campaign). It shows
  **no canvasser names or locations** — only the doors and their outcomes.

The numbers and the map are **frozen at publish time** — a published report never changes, even as the
team keeps knocking. Next week's report picks up the new activity.

## Building and publishing a weekly report

On the admin side, open **Client Reports** (in the left nav), pick a campaign, and click **Create
draft** for a week (a start and end date). The system pre-computes all the numbers for two windows —
everything through the week's end (cumulative) and just the week itself (the delta).

In the builder you:

- Write the **Canvasser observations** as sections (a heading + a paragraph each; add, reorder, or
  remove them).
- Choose the **headline support question** and which **survey questions** the client may see.
- Choose whether to show the **map**, and which survey answers become map filters.
- **Recompute** at any time while it's a draft (if more data has come in), and use **Preview** to see
  exactly what the client will see.
- **Publish** — this freezes the numbers and snapshots the map. The client can now see it.

A published report is locked; click **Unpublish to edit** to make changes, then republish. You can
delete a draft or a published report.

## Giving a candidate a login

On the **Users** page, **Add member** with the role **Client (read-only)** and check the campaign(s)
whose reports they should see. You set an **initial password** and hand it over; the client then signs
in and can **change it themselves** any time from their **Account** page (the link in the portal
header). They are *not* forced to change it on first login — if you'd rather hand them a one-time
password they must replace, use **Set temporary password** on their profile (a 72-hour temp that
forces a change at next login). A client only ever sees **published reports for the campaigns you
grant** — never other campaigns in your org, never drafts, never live data. You can change a client's
campaign access any time from their profile (Users → click the client → **Campaign access**).

A client in a single org lands straight on their portal at sign-in; a client who belongs to multiple
orgs picks one first.

---

# Part 2 — Technical reference

## Data model

**[ClientReport](../server/src/models/ClientReport.js)** — one frozen weekly report. Small doc
(numbers + observations); the map points live in a companion collection.

- Scope/window: `organizationId`, `campaignId`, `weekStart`/`weekEnd` (`YYYY-MM-DD` in the campaign
  tz), `timeZone`, and the frozen `rangeStartUtc`/`rangeEndUtc` instants (from `zonedDayRange`).
- `status`: `draft | published | archived`.
- `observations`: `[{ heading, body }]`.
- `stats`: **dual-window** — `cumulative` and `period`, each `{ totals, contactBreakdown, coverage,
  surveyBreakdowns[] }`. The KPI cards read `cumulative.totals.X` as the big number and
  `period.totals.X` as the "+N this week" delta. Breakdowns render from `cumulative`.
- `supportQuestionKey`, and `visibility: { visibleQuestionKeys[], mapAnswerKeys[], showMap }`.
- `mapPointCount`, `publishedAt`, `publishedBy`, `createdBy`.

**[ClientReportMapPoint](../server/src/models/ClientReportMapPoint.js)** — one frozen household point
per published report (its own collection so a large campaign can't blow the 16 MB BSON limit). Stores
`lng/lat`, coarse address, the door's `status` **as of the report's end**, and the whitelisted survey
`answers`. **No canvasser identity, no voter name, no timestamps** are ever stored here.

**Client↔campaign access** lives on **[Membership](../server/src/models/Membership.js)**: the `role`
enum gains `'client'`, and `clientCampaignIds: [Campaign]` is the per-client allow-list. Org-level
membership is not enough (an org holds many clients' campaigns), so every client request is
additionally scoped to this array.

## The numbers (dual window)

[services/reports/computeReport.js](../server/src/services/reports/computeReport.js) computes each
window from **activity/survey rows within a UTC date range** — never from live `Household.status` — so
a snapshot is reproducible and can't drift. It reuses the shared knock primitives in
[services/reports/aggregations.js](../server/src/services/reports/aggregations.js) (`knocksPipeline`,
`connectionRate`, `KNOCK_ACTIONS`) — the same code the admin dashboards use (see [METRICS.md](METRICS.md)) —
so the client's cumulative figures match the admin Overview.

- **cumulative** = `{ $lt: rangeEndUtc }` (everything through the week's end).
- **period** = `{ $gte: rangeStartUtc, $lt: rangeEndUtc }` (just the week).

Survey/support breakdowns mirror the admin `/survey-results` math (percent = count / totalResponses);
see [SURVEYS.md](SURVEYS.md).

## Publish = freeze

`POST /admin/client-reports/:id/publish` ([routes/admin/clientReports.js](../server/src/routes/admin/clientReports.js)):

1. Recompute both windows one last time.
2. Build the frozen map points with `buildFrozenMapPoints`: every in-scope household with coordinates,
   its status **as of `rangeEndUtc`** via `resolveStatus(campaign.type, activities-before-end)` — the
   same precedence the live app uses ([statusPrecedence.js](../server/src/utils/statusPrecedence.js)),
   but point-in-time — plus the operator-whitelisted survey answers (latest response per household).
   Canvasser identity is stripped.
3. Replace the report's points (`deleteMany` + `insertMany`), stash the cumulative `coverage` tally,
   set `status='published'`, `publishedAt/By`, `mapPointCount`.

Drafts can be edited/recomputed; publishing is idempotent (rebuilds points); unpublish returns it to
draft.

## Endpoints

**Admin builder** — `/admin/client-reports`, gated `requireOrgRole('admin')`:
`POST /` (create draft, pre-computes both windows) · `GET /?campaignId=` (list) · `GET /:id` ·
`PATCH /:id` (observations / visibility / support question; drafts only) · `POST /:id/recompute` ·
`GET /:id/preview` (the exact client payload) · `GET /:id/preview/map` (live, unsaved points) ·
`POST /:id/publish` · `POST /:id/unpublish` · `DELETE /:id`.

**Client read** — `/client/reports`, gated `requireClientRole` + per-report campaign check
([routes/client/reports.js](../server/src/routes/client/reports.js)):
`GET /` (published reports across the client's `clientCampaignIds`) · `GET /:id` (frozen stats +
observations + visibility-filtered breakdowns) · `GET /:id/map` (the frozen points; `canvassers: []`).
The mapbox token is the existing org-member-gated `/admin/config/mapbox-token`, also mounted at
`/client/config`.

**Client-user management** lives in [routes/admin/memberships.js](../server/src/routes/admin/memberships.js):
add a member with `role: 'client'` + `clientCampaignIds`, and `PATCH /:userId/campaigns` to grant/revoke.

The shared shaper [services/reports/clientReportView.js](../server/src/services/reports/clientReportView.js)
(`shapeReportForClient`, `shapeMapPoints`, `mapFilterSurvey`) is used by both the client read endpoints
and the admin preview, so the operator's preview is byte-for-byte what the client gets.

## Scoping & security

- A client's `Membership.role` is `'client'` (never `'admin'`), so `requireOrgRole('admin')` already
  bars clients from every `/admin` route.
- `requireClientRole` gates `/client`; per-report handlers assert `status === 'published'`,
  `organizationId === activeOrg`, and `campaignId ∈ clientCampaignIds`.
- The JWT carries no role — role and `clientCampaignIds` are read fresh from the membership on every
  request, so a revoke is immediate.
- Client endpoints read **only** the frozen `ClientReport*` collections — never `Household` /
  `CanvassActivity` / `SurveyResponse` — so there is no path to live or cross-campaign data, and the
  map carries no canvasser/voter identity.

## Frontend

- Admin: [ClientReportsPage](../client/src/pages/ClientReportsPage.jsx) (list + create) and
  [ClientReportBuilderPage](../client/src/pages/ClientReportBuilderPage.jsx) (edit + preview + publish);
  client-user management in [UsersPage](../client/src/pages/UsersPage.jsx) /
  [UserProfileModal](../client/src/components/UserProfileModal.jsx).
- Client: [ClientLayout](../client/src/components/ClientLayout.jsx),
  [ClientReportListPage](../client/src/pages/ClientReportListPage.jsx) (the archive),
  [ClientReportDetailPage](../client/src/pages/ClientReportDetailPage.jsx).
- Shared render: [ClientReportView](../client/src/components/ClientReportView.jsx) (KPIs + breakdowns +
  observations, used by both the client page and the admin preview),
  [ReportBreakdown](../client/src/components/ReportBreakdown.jsx), and the read-only
  [ClientReportMap](../client/src/components/ClientReportMap.jsx) — which reuses the admin map's pin
  rendering via [lib/mapRender.js](../client/src/lib/mapRender.js) (`withCanvassers: false`) and
  client-side filtering. Role wiring: `isClient` in [AuthContext](../client/src/auth/AuthContext.jsx),
  `requireClientRole` in [ProtectedRoute](../client/src/components/ProtectedRoute.jsx), and the
  role-based redirect in [LoginPage](../client/src/pages/LoginPage.jsx).
- Account: a shared self-serve [ProfilePage](../client/src/pages/ProfilePage.jsx) (edit name/phone via
  `PATCH /auth/me`, change your own password via `POST /auth/change-password`) served at
  `/client/profile` (portal header link) and `/profile` (admin + super-admin console, linked from the
  sidebar user card; gated by `requireConsoleUser` so a super admin in platform view can reach it).

## Migration

The `role` enum change is additive (existing rows keep their role).
[migrateClientRole.js](../server/src/migrations/migrateClientRole.js) (`npm run migrate:client-role --
--apply`, idempotent) backfills `clientCampaignIds: []` on memberships created before the field
existed. No new env vars — `MAPBOX_PUBLIC_TOKEN` already exists and is a public `pk.` token.
