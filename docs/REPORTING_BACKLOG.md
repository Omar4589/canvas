# Reporting & dashboards — backlog (deferred)

Status check (2026-06): after the per-round / billing work (rounds are now first-class,
knocks are billed per door×round, canvasser status is per-round, coverage stays global),
the **reporting is correct** — knocks (per-round/billable) and coverage (global, once-per-door)
are cleanly separated, no double-counting, surveys de-duped per round. Nothing below is a bug;
these are **enhancements** we chose to defer to start the shared-voter-DB effort. Come back to
these (roughly in this order) and **walk one surface in depth** at the end.

## 1. Per-round reporting + billing export
Today only the **Passes page** shows per-round numbers (`knockCount` per round). The main
surfaces — Overview, Dashboard (`/admin/reports/overview`, `/campaign-rollup`, `/canvassers`),
Client Reports — are **round-blind**: campaign-wide cumulative over a date window, no `passId`
breakdown.
- Add a **round breakdown** to the main reports: Round 1 vs Round 2 knocks / coverage gained /
  connection-rate, side by side (a per-round trend).
- Add a **billing export**: "knocks by round" (and "by canvasser by round") — billing is per
  door×round, but there's no single export; you'd assemble it across each effort's Passes page.
  Consider `GET /admin/reports/knocks-by-pass`.
- Reuse: `knocksPipeline` ([aggregations.js](../server/src/services/reports/aggregations.js)) already
  groups by `(household, pass)`; the report endpoints just need to accept/scope by `passId`.

## 2. Clarity / vocabulary pass
The metrics are correct but the distinction is subtle and could be misread (esp. by a client):
- **Knocks** = per door **per round** (billable) — knock a door in R1 and again in R2 = 2 knocks.
- **Homes knocked / coverage** = **global, once per door** ("ever reached").
- So **knocks > homes** once you run second rounds — *by design*, but the only cue today is a tiny
  "per house-pass" hint. Make the labels + tooltips unmistakable (Dashboard, Overview, Client Reports).

## 3. Walk one surface in depth (do last)
After 1–2, pick **Dashboard**, **Overview**, or the public **Client Reports** and walk it the way we
walked Turf Cutting ("what do we see / what should we see / what can/can't we do"), gap-analysis first.

> **Done (2026-06) on Client Reports** — a UX/visual/export pass: human date ranges, the voter-contact
> breakdown reordered ahead of the support question, a `prominent` KPI treatment + segmented bars, a
> quiet-week empty state, **per-report view tracking** (`viewCount`/`lastViewedAt`), a client-side
> **PDF download** (jsPDF, map omitted) shared with the on-screen view via `deriveReportSections`, and
> builder polish (confirm-on-publish, inline share-link passwords/labels, "what the client sees" recap).
> Still **round-blind** per item 1 — per-round breakdown was intentionally left out of this pass. See
> [CLIENT_PORTAL.md](CLIENT_PORTAL.md).

Surfaces inventory: Overview (org rollup), DashboardPage (single-campaign: activity + coverage funnel +
survey results + canvasser leaderboard), PassesPage (per-round knocks — the only round-aware view),
Client Reports (public weekly snapshots). Endpoints: [reports.js](../server/src/routes/admin/reports.js).
