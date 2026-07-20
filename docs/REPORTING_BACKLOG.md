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

> **Done (2026-07)** — the round breakdown + billing export shipped. `knocksPipeline` grew a
> `byPass` option (one row per round, Σ(rounds) === the collapsed total by construction) behind
> `GET /admin/reports/knocks-by-pass` (+ `?groupBy=canvasser` for by-canvasser-by-round, with the
> `crossCanvasserDoors` over-claim reconciliation) and the invoice-ready
> `GET /admin/reports/knocks-by-pass.csv` (walk list × round rows + a TOTAL row; Export CSV button
> on the Dashboard's new **By round** section). Surfaces: Dashboard **By round** table (web),
> per-pass **Survey doors / Lit drops / Conn %** columns on the Passes panel (the enriched
> `GET /admin/campaigns/:id/passes`), and a **By round** card on the mobile admin campaign screen.
> "Coverage gained" landed as **New homes reached** — first-ever-knock attribution per round.
> Spec + counting contract in [METRICS.md](METRICS.md) (Part 1 "By round", §E).
> **Client Reports intentionally remain round-blind** — a weekly client snapshot summarizes the
> window, it doesn't itemize rounds; revisit only if a client asks.

## 2. Clarity / vocabulary pass
The metrics are correct but the distinction is subtle and could be misread (esp. by a client):
- **Knocks** = per door **per round** (billable) — knock a door in R1 and again in R2 = 2 knocks.
- **Homes knocked / coverage** = **global, once per door** ("ever reached").
- So **knocks > homes** once you run second rounds — *by design*, but the only cue today is a tiny
  "per house-pass" hint. Make the labels + tooltips unmistakable (Dashboard, Overview, Client Reports).

> **Done (2026-07)** — the vocabulary/framing pass shipped: the Knocks metric now reads
> **"one per house · per round"** (Overview, Dashboard), and the "billable" / "house-pass" /
> "billed once" framing was pulled out of the dashboards, the metric tooltips, the Timeline overlaps
> line, and the client report — billing framing now lives only on the Billing page. The per-round vs
> global distinction reads clearer. The **round breakdown** (Round 1 vs Round 2 side by side) has
> since shipped too — see item 1's Done block.

> **Done (2026-07, second pass — the SURVEY units)** — the first sweep gave the labelling rule two
> axes (door-unit "Survey doors", voter-unit "Voters surveyed") and there are **three**. The missing
> response-unit meant every raw row count in the app rendered as **"Voters surveyed"** — correct
> *while a campaign has one round* (`SurveyResponse` is unique on `{voterId, passId}`, so rows and
> people coincide) and wrong the day a second round re-surveys anyone. Added **"Surveys taken"** and
> swept it across `/team-breakdown` (payload `votersSurveyed` → `surveysTaken`, still `{$sum: 1}` so
> team rows keep partitioning), `CanvasserSummaryTable`, the campaigns card/table, the user profile
> (web + mobile), `CampaignTeamPage`, and the mobile canvasser screens. Three real unit *swaps* fixed
> alongside (mobile campaign leaderboard, `CanvasserCard`, the super-admin Today card), plus the
> `surveysPerHour` name collision and the household-only key in `mobile/me.js`. Also shipped
> **`billableLitDoors`**: the survey-doors fix had deduped only the survey term of the Timeline
> connection rate, leaving a raw client-summed `lit` over a deduped denominator. **Per-round survey
> results** landed too — `?passId=` on `survey-results` / `voters-by-answer`(+`.csv`) /
> `answer-canvassers`, an effort-aware round selector on the web Explorer and the mobile campaign
> screen, and Walk list + Round columns in the answers CSV. This closes the survey half of item 1,
> which had shipped for knocks only. Contract in [METRICS.md](METRICS.md) and [SURVEYS.md](SURVEYS.md);
> locked by [multiPassUnits.int.test.js](../server/test/multiPassUnits.int.test.js).

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

Surfaces inventory: Overview (org rollup), DashboardPage (single-campaign: activity + **By round** +
coverage funnel + survey results + canvasser leaderboard), PassesPage (per-round knocks + rates),
Client Reports (public weekly snapshots — still round-blind by design). Endpoints:
[reports.js](../server/src/routes/admin/reports.js).
