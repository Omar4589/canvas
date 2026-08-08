# Client reports & shareable links

How you deliver the weekly report you used to assemble by hand and email — an "Activity at a glance"
KPI strip, a support breakdown, survey and voter-contact breakdowns, your written observations, and an
interactive map of where the team has been. You build a report, review it, and publish it; recipients
open a **public link** (always password-protected — set your own or the app mints one) and see the
campaign's published reports — **latest plus the full weekly history** — with no login. Reports are **frozen snapshots**: once
published, a report never changes, and next week's report just appears at the same link.

- **Part 1 — For everyone** is plain language: what a recipient sees, how you build and publish a
  weekly report, and how to share it.
- **Part 2 — Technical reference** is for developers (and Claude): the models, the build/publish
  (freeze) flow, the dual-window numbers, the as-of-date map snapshot, the public + admin endpoints,
  and the share-link security model.

Related: [METRICS.md](METRICS.md) (the numbers a report freezes), [SURVEYS.md](SURVEYS.md) (where the
support/survey breakdowns come from + the per-question percentage rule), [MAPS.md](MAPS.md) (the shared
map rendering), [USERS.md](USERS.md) (admin/lead/canvasser roles), [TIMEZONES.md](TIMEZONES.md) and
[DATE_FILTERS.md](DATE_FILTERS.md) (how the report week is anchored).

---

# Part 1 — For everyone

## What a recipient sees

You share a link like `https://doorline.app/r/<token>`. Anyone with it (the candidate, a consultant,
the campaign manager, your boss, the state director — one person or many) opens a clean **report hub**:
the **weekly reports for that campaign, newest first**, with no admin tools and no account to create.
The link has a password (every link does — you hand it over with the URL); they're asked for it once
(it's remembered for that browser tab).

A report reads top to bottom as a document, in this order:

- **Activity at a glance** — headline cards (doors knocked, surveys taken, voters surveyed, connection
  rate). Each card shows the **cumulative total** as the big number and a **"+N this week"** pill. A
  quiet week (no new doors) says so plainly above the cards.
- **Voter contact breakdown** — outcomes across the doors (surveyed, *declined to participate*, not
  home, wrong address, lit dropped), shown as one stacked bar with a legend. This reads **first**, right
  after the numbers. On survey campaigns, **Declined to participate** is the door where someone answered
  but wouldn't take the survey — a real contact, not a survey — shown in amber.
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
A report scoped to one **walk list** (see below) says so wherever its numbers appear — *Walk list:
North* on the report hub's list, under the report's title, and in the PDF header — so scoped numbers
can never be mistaken for campaign totals.

The numbers and the map are **frozen at publish time** — a published report never changes, even as the
team keeps knocking. Next week's report picks up the new activity and appears at the same link.

## Building and publishing a weekly report

On the admin side, drill into the campaign and open its **Client Reports** tab, then click **Create
draft** for a week (a start and end date). The system pre-computes all the numbers for two windows —
everything through the week's end (cumulative) and just the week itself (the delta).

The create form also has a **Walk list** select. The default — **Whole campaign** — is exactly what
every report was before. Pick a walk list instead and the entire report covers only that walk list's
doors and activity: both stat windows, every breakdown, and the frozen coverage map. The scope is
fixed at creation (create a second report for a different walk list — two same-week reports, one per
walk list, is the intended pattern), and the builder header plus the **"What the client sees"** recap
both name it. One thing to know before you pick: **the walk-list name appears on the public report
pages and the PDF**, readable by anyone with the share link — it's operator-authored labeling, the
same exposure class as the report title, so name walk lists accordingly.

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
  confirming freezes the report. If **unreviewed mock-location flags** fall inside the report's window,
  the builder shows a red warning with a link to review them in the Audit page, and the confirm dialog
  repeats it — publish is **never blocked** (a mock flag can be a false alarm), but the count at the
  moment of freeze is stamped on the report as `openMockFlagsAtPublish` (operator-visible only, never
  in the public shapers).

A published report is locked; click **Unpublish to edit** to make changes, then republish. The header
also shows whether the client has opened it yet (**Viewed N× · last …**). You can delete a draft or a
published report.

## Sharing a report

On the campaign's **Client Reports** tab, use the **Share link** panel:

- **+ New link** creates a public link to this campaign's published reports — **and a password with it**:
  every new link is password-protected, and when the operator doesn't supply a password the server mints
  a strong one and returns it **once**, in the create response. The panel shows it in a one-time callout
  ("shown once and never again") with a copy button — it's bcrypt-hashed at rest and can never be
  displayed again. **Copy** the URL and send both to the client — they don't need an account. Give each
  link a **label** (e.g. *Candidate*, *Internal*) inline.
- **Set / Change password** is an **inline field** (no browser prompt). A password can be **replaced
  but never removed** — the server refuses removal (`SHARE_PASSWORD_REQUIRED`) so a protected link
  can't quietly become an open one; if a password is lost, **Set password** replaces it. (A legacy open
  link can still have a password *added* — that's the one permitted direction.)
- **Rotate** issues a fresh URL and **instantly kills the old one** (use it if a link leaked). The
  password carries over — rotate changes the URL, not the password.
- **Disable / Enable** turns a link off without deleting it; **Delete** removes it for good. Each row
  shows when the link was **last opened** and when it **expires** — every new link expires
  (`SHARE_LINK_DEFAULT_DAYS`, default 90; an expired row is badged **expired**). Past expiry, the
  operator creates a fresh link.
- You can keep **more than one link per campaign** (e.g. one for the candidate and one for internal
  staff), each with its own password and each revocable on its own.
- A link from before passwords+expiry became required keeps working (`isLegacyOpen`) and is badged
  **open link — add a password** in the panel; the admin-only **revoke-legacy** sweep kills all of
  them at once, deliberately never automatically.

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
- Optional walk-list scope: `effortId` + `effortName` — `null` = the whole campaign (every
  pre-existing report, and the default). `effortName` is **frozen at creation** on purpose: the
  public share page renders the label without an admin API lookup, and it survives the walk list
  being renamed or deleted later. Create-time only — `updateSchema` doesn't accept it, so a draft's
  scope can't drift from its computed stats.
- `status`: `draft | published | archived`.
- `observations`: `[{ heading, body }]`.
- `stats`: **dual-window** — `cumulative` and `period`, each `{ totals, contactBreakdown, coverage,
  surveyBreakdowns[] }`. The KPI cards read `cumulative.totals.X` as the big number and
  `period.totals.X` as the "+N this week" delta. Breakdowns render from `cumulative`.
- `supportQuestionKey`, `campaignType`, and `visibility: { visibleQuestionKeys[], mapAnswerKeys[],
  showMap }`.
- `mapPointCount`, `publishedAt`, `publishedBy`, `createdBy`.
- `openMockFlagsAtPublish` — unreviewed mock-GPS flags inside the cumulative window at freeze time
  (the soft publish gate's audit trail; `null` on pre-feature reports, operator-only).
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
— an unguessable capability string that appears in the URL. A campaign may have several links. A
password link exchanges the password for a short-lived share JWT via `POST /share/:token/unlock`; that
endpoint is **rate-limited** — 10 attempts / 15 min per **IP + token**, counting only failed guesses —
so a link's password can't be brute-forced ([share.js](../server/src/routes/public/share.js)).

## The numbers (dual window)

[services/reports/computeReport.js](../server/src/services/reports/computeReport.js) computes each
window from **activity/survey rows within a UTC date range** — never from live `Household.status` — so
a snapshot is reproducible and can't drift. It reuses the shared knock primitives in
[services/reports/aggregations.js](../server/src/services/reports/aggregations.js) (`knocksPipeline`,
`connectionRate`, `KNOCK_ACTIONS`) — the same code the admin dashboards use (see [METRICS.md](METRICS.md)).

- **cumulative** = `{ $lt: rangeEndUtc }` (everything through the week's end).
- **period** = `{ $gte: rangeStartUtc, $lt: rangeEndUtc }` (just the week).

`computeWindowStats` also takes an optional `effortId`, and `computeBothWindows` reads it **off the
report itself** — so create, recompute, and the publish-time recompute all stay scoped without any
caller passing it. `effortId` is denormalized onto the activity/response rows
([EFFORTS.md](EFFORTS.md) §E), so the one filter scopes knocks, surveys, and breakdowns together.

**Voter-contact breakdown is a DOOR-OUTCOME breakdown, not a raw-event count.** `contactBreakdown`
collapses each `(household, pass)` to its single resolved outcome via
`resolveStatus(campaignType, acts)` ([statusPrecedence.js](../server/src/utils/statusPrecedence.js)) —
the same per-door-per-round unit as `knocksPipeline`. So the bar **sums exactly to
`totals.doorsKnocked`**, and `contactBreakdown.surveyed === totals.surveyedKnocks` (the connection-rate
numerator). A door knocked by two canvassers in the same round (an "overlap") is **one** knock with
**one** outcome here, even though it has two `CanvassActivity` rows — matching how Doors knocked counts
it (see [METRICS.md](METRICS.md) §overlaps). This is why the breakdown's **"Surveyed" (doors)** can be
below the **"Surveys taken"** KPI: a home with two voters surveyed in one visit is **1 surveyed door
but 2 surveys**. (Before this fix the breakdown counted raw activity events, so overlaps made it
over-count and the bar didn't tie to Doors knocked.) The client labels are local to
[reportDerive.js](../client/src/lib/reportDerive.js) (`CONTACT_LABELS`: "Surveyed" / "Declined to
participate" / "Didn't answer" / "Wrong address" / "Lit dropped"), separate from the admin coverage
bar's `STATUS_LABELS`. The `refused` row is the **"Declined to participate"** bucket — a door where a
voter answered but declined the survey: a billable knock and a contact, but **not** a survey, so it's
separate from "Surveyed". `contactOrderFor('survey')` slots it right after `surveyed`; `computeReport`
keeps it in `contactBreakdown.events` so the bar still sums exactly to `totals.doorsKnocked`. (It's the
client-facing reflection of the door-level **Refused** disposition — see [METRICS.md](METRICS.md) /
[SURVEYS.md](SURVEYS.md); `totals.refusedKnocks` and `contactRate = (surveyed + refused) / knocks` are
admin-side and don't appear in the client report.) Each KPI and breakdown row
carries a plain-language `help` string surfaced as an on-screen "(i)" tooltip (`InfoHint`) and a
"What these numbers mean" section in the PDF.

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
   Canvasser identity is stripped. A walk-list scope narrows the **household set only**
   (`Household.effortId` is the ownership source of truth); the activity/response scans stay
   campaign-wide and household-keyed, so a door's as-of status still reflects knocks stamped before
   it joined the walk list, and only in-scope households are ever looked up from those maps.
3. Replace the report's points (`deleteMany` + `insertMany`), stash the cumulative `coverage` tally,
   set `status='published'`, `publishedAt/By`, `mapPointCount`.

Drafts can be edited/recomputed; publishing is idempotent (rebuilds points); unpublish returns it to
draft.

## Endpoints

**Admin builder** — server routes are mounted at `/admin/client-reports` (unchanged), gated
`requireOrgRole('admin', 'lead')` with every handler authorizing the specific campaign via
`manages()` (`canManageCampaign` — an admin passes everywhere, a lead only on granted campaigns) and
filtered by `campaignId` in query/body. The admin **UI** for these lives
inside the campaign drill-in — list at `/campaigns/:campaignId/reports`
([ClientReportsPage](../client/src/pages/ClientReportsPage.jsx)), builder at
`/campaigns/:campaignId/reports/:id` ([ClientReportBuilderPage](../client/src/pages/ClientReportBuilderPage.jsx)),
both reading `campaignId` from `useParams` (the old "Client Reports" launchpad + campaign dropdown are
gone; the legacy `/admin/client-reports[/:id]` client routes redirect to `/campaigns` — see
[App.jsx](../client/src/App.jsx)). Server endpoints:
`POST /` (create draft; optional `effortId` — must name an `Effort` of **this** campaign, 400
otherwise, and is frozen onto the report with its `name`) ·
`GET /?campaignId=` (list; rows carry `viewCount`/`lastViewedAt`/`timeZone`/`effortName`) ·
`GET /:id` (also returns `campaignName`/`orgName` so the builder's PDF header matches the client's) ·
`PATCH /:id` (drafts only) · `POST /:id/recompute` · `GET /:id/preview` · `GET /:id/preview/map` ·
`POST /:id/publish` · `POST /:id/unpublish` · `DELETE /:id`.

**Admin share management** — same router, same campaign-scoped gate (only
`POST /shares/revoke-legacy` layers `requireOrgRole('admin')` on top — it sweeps links across all
campaigns). Declared **before** the `/:id` report routes so Express doesn't match `:id = "shares"`:
`GET /shares?campaignId=` · `POST /shares` `{campaignId,label?,password?,expiresInDays?}` — always
creates a **password + expiry**; when `password` is absent the server mints one
(`generateSharePassword`, ~62^12) and returns it once as `generatedPassword`, and `expiresAt`
defaults to `SHARE_LINK_DEFAULT_DAYS` (90, max 365) ·
`PATCH /shares/:id` `{label?, password?(string replaces; null → 400 SHARE_PASSWORD_REQUIRED), isActive?}` ·
`POST /shares/:id/rotate` (new token, password unchanged) · `DELETE /shares/:id`. Returns the token;
the SPA builds `${origin}/r/${token}`. Rows carry `hasPassword`/`expiresAt`/`isLegacyOpen` for the
panel's badges.

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
- The public shapers expose the walk-list **name only** — `effortName` rides both
  `shapeReportListRow` (so two same-week reports, one scoped and one campaign-wide, are
  distinguishable on the share list without opening each) and `shapeReportForClient` — **never
  `effortId`** or any other internal id. The name is operator-authored metadata, the same exposure
  class as the report title (flagged in Part 1).
- **Revoke is immediate**: `isActive:false` (Disable) or **Rotate** (new token) makes the old URL 404
  on the next request; a share JWT can't be re-minted without the password/link.
- The Mapbox token is the public `pk.` `MAPBOX_PUBLIC_TOKEN`, served at `/share/:token/mapbox-token`
  (safe to expose — it's already public on the admin map).

## Frontend

- Admin: [ClientReportsPage](../client/src/pages/ClientReportsPage.jsx) (list + create + the **Share
  link** panel; the create form's **Walk list** select only sends an `effortId` that belongs to the
  *current* campaign — the page stays mounted across campaign switches, so a stale selection could
  otherwise leak into the POST — and scoped rows get an `effortName` badge) and
  [ClientReportBuilderPage](../client/src/pages/ClientReportBuilderPage.jsx) (edit + preview +
  publish; a scoped report's header line and "What the client sees" recap name the walk list).
  The public list/detail pages append *· Walk list: name* under the week range on scoped reports.
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
  `deriveReportSections` (header + KPI grid + labeled bars + observations; **map omitted**). A scoped
  report's header line appends *· Walk list: name* — scoped numbers under an unlabeled header would
  read as campaign totals. Mounted on the public detail page and the builder Preview tab.
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
`admin | lead | canvasser` — the `lead` role arrived after this migration; see [ROLES.md](ROLES.md)).
Run it with the deploy. No new env vars — `MAPBOX_PUBLIC_TOKEN` and `JWT_SECRET`
already exist. Mobile is unaffected.

The PDF export adds one client dependency, **`jspdf`** (lazy-loaded into its own chunk) — `npm --prefix
client install` (the `heroku-postbuild` `install:all` already does this). The `viewCount`/`lastViewedAt`
fields need **no migration** (`$inc` treats a missing field as 0; schema defaults apply on read) — and
neither do `effortId`/`effortName` (both default `null` = whole campaign, which is what every existing
report already is; no new index).
