# Client reports & shareable links

How you deliver the weekly report you used to assemble by hand and email — an "Activity at a glance"
KPI strip, a support breakdown, survey and voter-contact breakdowns, your written observations, and an
interactive map of where the team has been. You build a report, review it, and publish it; recipients
open a **public link** (optionally password-protected) and see the campaign's published reports —
**latest plus the full weekly history** — with no login. Reports are **frozen snapshots**: once
published, a report never changes, and next week's report just appears at the same link.

- **Part 1 — For everyone** is plain language: what a recipient sees, how you build and publish a
  weekly report, and how to share it.
- **Part 2 — Technical reference** is for developers (and Claude): the models, the build/publish
  (freeze) flow, the dual-window numbers, the as-of-date map snapshot, the public + admin endpoints,
  and the share-link security model.

Related: [METRICS.md](METRICS.md) (the numbers a report freezes), [SURVEYS.md](SURVEYS.md) (where the
support/survey breakdowns come from + the per-question percentage rule), [MAPS.md](MAPS.md) (the shared
map rendering), [USERS.md](USERS.md) (admin/canvasser roles), [TIMEZONES.md](TIMEZONES.md) and
[DATE_FILTERS.md](DATE_FILTERS.md) (how the report week is anchored).

---

# Part 1 — For everyone

## What a recipient sees

You share a link like `https://doorline.app/r/<token>`. Anyone with it (the candidate, a consultant,
the campaign manager, your boss, the state director — one person or many) opens a clean **report hub**:
the **weekly reports for that campaign, newest first**, with no admin tools and no account to create.
If you put a password on the link, they're asked for it once (it's remembered for that browser tab).

A report reads top to bottom as a document, in this order:

- **Activity at a glance** — headline cards (doors knocked, surveys taken, voters surveyed, connection
  rate). Each card shows the **cumulative total** as the big number and a **"+N this week"** pill. A
  quiet week (no new doors) says so plainly above the cards.
- **Voter contact breakdown** — outcomes across the doors (surveyed, not home, wrong address, lit
  dropped), shown as one stacked bar with a legend. This reads **first**, right after the numbers.
- **Support breakdown** — the question you designate as "support" (e.g. *1,394 Support · 404 Likely
  Support · 889 Undecided · 50 Opposed*), emphasized as the headline.
- **Survey breakdowns** — per-question option counts and percentages for the questions you choose to
  show. Percentages total exactly 100% per question (see [SURVEYS.md](SURVEYS.md)).
- **Canvasser observations** — your written, sectioned narrative (e.g. *Voter Intent*, *Opponent
  Activity*).
- **A coverage map** — an interactive, read-only map of where the team has been: only the doors we
  actually reached (unknocked doors are hidden), colored by outcome, with filters by status and survey
  answer. It shows **no canvasser names or locations** — only the doors and their outcomes.

The header shows the campaign, a human week range (e.g. *May 31 – Jun 13, 2026*), and a **Download PDF**
button — a one-click, paginated PDF of the numbers, breakdowns, and observations (the map is left out).

The numbers and the map are **frozen at publish time** — a published report never changes, even as the
team keeps knocking. Next week's report picks up the new activity and appears at the same link.

## Building and publishing a weekly report

On the admin side, open **Client Reports** (left nav), pick a campaign, and click **Create draft** for
a week (a start and end date). The system pre-computes all the numbers for two windows — everything
through the week's end (cumulative) and just the week itself (the delta).

In the builder you:

- Write the **Canvasser observations** as sections (a heading + a paragraph each; add, reorder, remove).
- Choose the **headline support question** and which **survey questions** the recipient may see. A
  **"What the client sees"** recap (Support / N of M questions shown / Map on-off) updates live, and a
  warning flags if your support question isn't in the visible set (the client wouldn't see its bars).
- Choose whether to show the **map**, and which survey answers become map filters.
- **Recompute** at any time while it's a draft. The header shows an **Unsaved changes / All changes
  saved** indicator, and **Preview** (instant — it's prefetched) shows exactly what the recipient will
  see, including a **Download PDF** button.
- **Publish** — a confirm dialog spells out the freeze (numbers + map snapshot locked, link goes live);
  confirming freezes the report.

A published report is locked; click **Unpublish to edit** to make changes, then republish. The header
also shows whether the client has opened it yet (**Viewed N× · last …**). You can delete a draft or a
published report.

## Sharing a report

On **Client Reports**, with a campaign selected, use the **Share link** panel:

- **+ New link** creates a public link to this campaign's published reports. **Copy** it and send it to
  anyone — they don't need an account. Give each link a **label** (e.g. *Candidate*, *Internal*) inline.
- **Set / Change password** is an **inline field** (no browser prompt); leaving it blank removes it.
- **Rotate** issues a fresh URL and **instantly kills the old one** (use it if a link leaked).
- **Disable / Enable** turns a link off without deleting it; **Delete** removes it for good. Each row
  shows when the link was **last opened**.
- You can keep **more than one link per campaign** (e.g. a password-protected one for the candidate and
  an open one for internal staff), each revocable on its own.

A link always shows the **latest report plus every prior week** for that campaign, and new reports you
publish appear automatically — so you share it once. Recipients only ever see **published** reports for
**that one campaign** — never drafts, never other campaigns, never live data.

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
- `supportQuestionKey`, `campaignType`, and `visibility: { visibleQuestionKeys[], mapAnswerKeys[],
  showMap }`.
- `mapPointCount`, `publishedAt`, `publishedBy`, `createdBy`.
- `viewCount`, `lastViewedAt` — a best-effort per-report counter of genuine client opens (defaults
  `0`/`null`; missing on old reports, so no migration — `$inc` treats absent as 0). Surfaced to admins
  only, never in the public shapers.

**[ClientReportMapPoint](../server/src/models/ClientReportMapPoint.js)** — one frozen household point
per published report (its own collection so a large campaign can't blow the 16 MB BSON limit). Stores
`lng/lat`, coarse address, the door's `status` **as of the report's end**, and the whitelisted survey
`answers`. **No canvasser identity, no voter name, no timestamps** are ever stored here.

**[ReportShareLink](../server/src/models/ReportShareLink.js)** — a public, revocable link to **one
campaign's** published reports. `{ organizationId, campaignId, token (unique), label, passwordHash |
null, isActive, createdBy, lastAccessedAt }`. The `token` is `crypto.randomBytes(24).toString('base64url')`
— an unguessable capability string that appears in the URL. A campaign may have several links.

## The numbers (dual window)

[services/reports/computeReport.js](../server/src/services/reports/computeReport.js) computes each
window from **activity/survey rows within a UTC date range** — never from live `Household.status` — so
a snapshot is reproducible and can't drift. It reuses the shared knock primitives in
[services/reports/aggregations.js](../server/src/services/reports/aggregations.js) (`knocksPipeline`,
`connectionRate`, `KNOCK_ACTIONS`) — the same code the admin dashboards use (see [METRICS.md](METRICS.md)).

- **cumulative** = `{ $lt: rangeEndUtc }` (everything through the week's end).
- **period** = `{ $gte: rangeStartUtc, $lt: rangeEndUtc }` (just the week).

Survey/support breakdowns use the **per-question** denominator (each option's percent = count ÷ that
question's own answer total), and `ReportBreakdown` rounds them to total exactly 100% — see
[SURVEYS.md](SURVEYS.md).

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
`POST /` (create draft) · `GET /?campaignId=` (list; rows carry `viewCount`/`lastViewedAt`/`timeZone`) ·
`GET /:id` (also returns `campaignName`/`orgName` so the builder's PDF header matches the client's) ·
`PATCH /:id` (drafts only) · `POST /:id/recompute` · `GET /:id/preview` · `GET /:id/preview/map` ·
`POST /:id/publish` · `POST /:id/unpublish` · `DELETE /:id`.

**Admin share management** — same router, also `requireOrgRole('admin')`. Declared **before** the
`/:id` report routes so Express doesn't match `:id = "shares"`:
`GET /shares?campaignId=` · `POST /shares` `{campaignId,label?,password?}` ·
`PATCH /shares/:id` `{label?, password?(string sets / null clears), isActive?}` ·
`POST /shares/:id/rotate` (new token) · `DELETE /shares/:id`. Returns the token; the SPA builds
`${origin}/r/${token}`.

**Public read** — `/share`, mounted **before** the `requireAuth` gate in
[routes/index.js](../server/src/routes/index.js) (no login), implemented in
[routes/public/share.js](../server/src/routes/public/share.js). `loadShare` resolves `:token` to an
active `ReportShareLink` (404 otherwise):
- `GET /share/:token` → `{ campaignName, orgName, requiresPassword }` — drives the brand header + gate.
- `POST /share/:token/unlock` `{ password }` → bcrypt-checks (or passes for an open link) and returns a
  short-lived **share JWT** `{ accessToken }`.
- `requireShareAccess` → an open link passes; a password link requires a valid `X-Share-Token` (the
  share JWT) for **this** share, else `401 { code: 'password-required' }`.
- `GET /share/:token/reports` · `/reports/:id` · `/reports/:id/map` · `/mapbox-token` (all
  `loadShare, requireShareAccess`) — scoped to the link's `campaignId` + org + `status:'published'`,
  reusing `shapeReportListRow` / `shapeReportForClient` / `mapFilterSurvey` / `shapeMapPoints`
  ([clientReportView.js](../server/src/services/reports/clientReportView.js)). The same shapers feed the
  admin preview, so the operator's preview is byte-for-byte what recipients get.
- The **`/reports/:id` handler** also fires a best-effort `$inc viewCount` + `$set lastViewedAt` (never
  blocking the read, mirroring `loadShare`'s link stamp). It lives in the handler body — **not** the
  shared `loadReport`, so `/reports/:id/map` doesn't double-count — and only published reports are
  reachable here, so admin previews and drafts are excluded.

## Scoping & security

- The link `token` is a long random capability string; an **optional per-link password** (bcrypt
  `passwordHash`) is a second factor. A correct password yields a **24h share JWT**
  (`signShareToken({shareId, campaignId})`, [tokens.js](../server/src/services/auth/tokens.js)) that
  authorizes the reads; the SPA keeps it in `sessionStorage` (tab-scoped).
- Every public read is scoped to the link's single `campaignId` and `status:'published'`, so there is
  no path to drafts, other campaigns, or live `Household` / `CanvassActivity` / `SurveyResponse` data;
  map points carry no canvasser/voter identity.
- **Revoke is immediate**: `isActive:false` (Disable) or **Rotate** (new token) makes the old URL 404
  on the next request; a share JWT can't be re-minted without the password/link.
- The Mapbox token is the public `pk.` `MAPBOX_PUBLIC_TOKEN`, served at `/share/:token/mapbox-token`
  (safe to expose — it's already public on the admin map).

## Frontend

- Admin: [ClientReportsPage](../client/src/pages/ClientReportsPage.jsx) (list + create + the **Share
  link** panel) and [ClientReportBuilderPage](../client/src/pages/ClientReportBuilderPage.jsx) (edit +
  preview + publish).
- Public hub (no login): [PublicReportLayout](../client/src/components/PublicReportLayout.jsx) (brand +
  password gate; provides `{token, accessToken}` via Outlet context),
  [PublicReportListPage](../client/src/pages/PublicReportListPage.jsx) (the archive, newest first), and
  [PublicReportDetailPage](../client/src/pages/PublicReportDetailPage.jsx). Routes `/r/:token` and
  `/r/:token/reports/:reportId` live **outside** `ProtectedRoute` in [App.jsx](../client/src/App.jsx).
- Shared derivation: [lib/reportDerive.js](../client/src/lib/reportDerive.js) `deriveReportSections()`
  returns the report's KPIs, contact/support/other breakdowns and section **order** as plain data — the
  single source consumed by **both** the on-screen view and the PDF, so they can't drift.
- PDF export: [lib/reportPdf.js](../client/src/lib/reportPdf.js) `generateReportPdf()` lazily imports
  `jspdf` (its own bundle chunk — never on the report's first paint) and draws the document from
  `deriveReportSections` (header + KPI grid + labeled bars + observations; **map omitted**). Mounted on
  the public detail page and the builder Preview tab.
- Shared render: [ClientReportView](../client/src/components/ClientReportView.jsx) (KPIs + breakdowns +
  observations, used by both the public page and the admin preview),
  [StatCard](../client/src/components/StatCard.jsx) (the report opts into a `prominent` look + a delta
  pill; the admin dashboards' default look is unchanged),
  [ReportBreakdown](../client/src/components/ReportBreakdown.jsx) (derives 100%-summing percents from
  counts; `variant="segmented"` draws a stacked bar + legend for contact/support), and the read-only
  [ClientReportMap](../client/src/components/ClientReportMap.jsx) — which
  takes a `requestOpts` prop so its fetches run public (`{ public: true, shareToken }`) on the share
  page while the admin preview stays authed; it reuses the admin map's pin rendering via
  [lib/mapRender.js](../client/src/lib/mapRender.js) (`withCanvassers: false`).
- API plumbing: [api/client.js](../client/src/api/client.js) gained a `public: true` option (no user
  `Authorization`/`X-Org-Id`) and a `shareToken` option (`X-Share-Token`);
  [lib/shareAccess.js](../client/src/lib/shareAccess.js) stores the unlock token per share in
  `sessionStorage`.

## Migration & deploy

There are no client login accounts anymore. [cleanupClientRole.js](../server/src/migrations/cleanupClientRole.js)
(`npm run migrate:cleanup-client-role -- --apply`, idempotent) deletes the old `role:'client'`
memberships and unsets any leftover `clientCampaignIds` (the `Membership.role` enum is now
`admin | canvasser`). Run it with the deploy. No new env vars — `MAPBOX_PUBLIC_TOKEN` and `JWT_SECRET`
already exist. Mobile is unaffected.

The PDF export adds one client dependency, **`jspdf`** (lazy-loaded into its own chunk) — `npm --prefix
client install` (the `heroku-postbuild` `install:all` already does this). The `viewCount`/`lastViewedAt`
fields need **no migration** (`$inc` treats a missing field as 0; schema defaults apply on read).
