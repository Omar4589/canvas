# Scale hardening — Phase 2 (hand-off brief)

> **For the agent picking this up (fable).** This is a self-contained task brief. Phase 1 (connection
> pooling, indexes, bounded `/flags` + admin map, chunked import query, GeocodeCache storage trim,
> import stress test + `npm run test:int` harness) is **already merged and deployed to prod**. You are
> doing the two heavier items that were deliberately deferred. Read this whole file before starting.

## Environment & constraints

- **Stack:** Node/Express + Mongoose (`server/src`), React web (`client/src`), React Native
  (`mobile/`). Branch: **`sharedVoters`**.
- **Plain JavaScript only — NO TypeScript.** Match each file's neighbors in style, naming, comment
  density.
- **Light theme + red brand accent.** Use existing semantic design tokens (`bg-card`/`text-fg`/…);
  never hard-coded grays or dark sections.
- **Do NOT introduce map pin clustering** — the owner dislikes it on any map.
- **Metrics are business-critical and must be EXACT.** The counters in Item 1 are the entire risk of
  this task. Prove correctness with a parity test; do not eyeball it.
- **Verify with** `npm run test:int` (from `server/`) — it boots a throwaway `mongod` (on PATH), runs
  every `*.int.test.js` (one DB per file), and tears down. Add new `*.int.test.js` files as needed.
  Build the web client with `cd client && npm run build`.
- **Cascade docs when done** (house rule): update `docs/METRICS.md` and `docs/PERFORMANCE.md`
  (Part 1 plain-English + Part 2 technical), and any Help Center article under
  `server/src/content/help/` that references dashboard numbers. Part 1 is the source for Help copy;
  Part 2 (technical) is never shown to users.

---

## Item 1 — Denormalized rollup counters (the hard part)

### Problem
The admin dashboards recompute headline totals **live off the raw `CanvassActivity` /
`SurveyResponse` ledgers on every load**, unbounded on the "All time" range. At millions of rows this
is the central scale risk. The two endpoints:
- `campaign-rollup` — `server/src/routes/admin/reports.js` (~line 290)
- `overview` — `server/src/routes/admin/reports.js` (~line 191)

(Phase 1 already fixed the worst offender — `campaignSummaries` no longer counts these collections
all-time just to test `hasCanvassed>0` — but the rollups themselves still re-aggregate the ledger.)

### Approach
1. **Add counters to** `server/src/models/Campaign.js`: `knockCount` (Number, default 0),
   `surveyCount` (Number, default 0), `lastActivityAt` (Date, default null).
2. **Adjust them through a SINGLE choke-point helper** in the write path
   `server/src/routes/mobile/canvass.js` — the SAME places that create/delete `CanvassActivity` and
   `SurveyResponse`, **including the undo/delete paths and the bulk paths** — via `$inc`
   (and `$max` for `lastActivityAt`). Write one helper (e.g. `adjustCampaignCounters(campaignId, {knocks, surveys, at})`)
   and call it everywhere a knock/survey is recorded OR removed. **Every mutation site must be
   covered or the counts drift.** Grep for: `CanvassActivity.create`, `CanvassActivity.deleteMany`,
   `SurveyResponse.findOneAndUpdate`/`create`/`deleteMany`, and the bulk path (`via: 'bulk'`,
   book-level bulk-restrict). Note the recordHouseholdAction handler (~L88-143) does a
   `deleteMany` + `create` on re-record — net-zero for the counter, so compute the delta, don't
   double-count.
3. **Counting rules — match the live rollup EXACTLY.** Read `reports.js` to see which action types it
   counts today and mirror them:
   - `knockCount` counts door-unit **billable knocks** — the `KNOCK_ACTIONS` set (grep for it).
     `refused` IS a billable knock; `restricted_access` is NOT (deliberately kept out of
     `KNOCK_ACTIONS`); `note_added` is not a knock. Do not invent your own set — reuse the constant.
   - `surveyCount` counts `SurveyResponse` docs (voter-unit).
   - **Survey dual-ledger caveat:** a survey submit writes BOTH a `CanvassActivity`
     (`survey_submitted`) row AND a `SurveyResponse`. `knockCount` counts the door-unit activity,
     `surveyCount` counts the voter-unit response — nothing sums both. See `docs/SURVEYS.md` /
     `docs/METRICS.md`.
4. **Dashboards read headline totals from the Campaign doc**; keep the **date-bounded per-range
   breakdowns** as live indexed aggregations (Phase 1 added `{organizationId,timestamp}` /
   `{campaignId,timestamp}` indexes, so a bounded range is fine). Only the unbounded "all-time
   headline" numbers move to the counters.
5. **Ship a reconcile/backfill script** `server/src/migrations/reconcileCampaignCounters.js`
   (mirror the dry-run + `--apply` pattern of `server/src/migrations/buildIndexes.js` /
   `stripGeocodeRaw.js`; add an npm script `migrate:reconcile-counters` in `server/package.json`). It
   recomputes each Campaign's counters from the ledger — this **backfills existing campaigns** and is
   the **repair tool** if drift is ever suspected. Run it once after deploy.

### Acceptance test (required)
New `server/test/campaignCounters.int.test.js`: record knocks + surveys, delete some, run an undo,
run a bulk op; after each, assert `Campaign.knockCount` / `surveyCount` equal a fresh live count from
the ledger (`CanvassActivity.countDocuments` with the same `KNOCK_ACTIONS` filter; `SurveyResponse.countDocuments`).
Then run the reconcile script and re-assert parity. This parity is the bar — it must hold across
create/delete/undo/bulk.

---

## Item 2 — Viewport-bounded admin map + lighter payload

### Problem
`GET /admin/households/map` (`server/src/routes/admin/households.js` ~line 97) returns every matching
household (Phase 1 capped it at **50,000** with a `truncated` flag — `MAP_HOUSEHOLD_CAP`) plus all
their voters and **all** `SurveyResponse.answers[]`. It's ~12 MB uncompressed on a large campaign,
refetched every 20 s while the web map's Live toggle is on.

### Approach
1. **Server — bbox filter.** Accept optional bbox query params (e.g. `west,south,east,north`). When
   present, filter `location` with `$geoWithin: { $box: [[west,south],[east,north]] }`. This **uses
   the existing but currently-dormant `2dsphere` index** on `Household.location` (see
   `server/src/models/Household.js`), bounding both the query and the payload. Keep the 50k cap as a
   backstop for a no-bbox request.
2. **Server — drop the heaviest field.** Project `SurveyResponse.answers[]` OUT of the bulk map
   payload (it's the biggest part). **First** grep `client/src/pages/MapPage.jsx` and the household
   detail panel to confirm what actually reads `answers` — if the panel/answer-filter chips need it,
   load it lazily on household-click (a small per-household fetch) instead of in the bulk map fetch.
3. **Client — send the viewport.** In `client/src/pages/MapPage.jsx` (and the mobile admin map), send
   the current map viewport bbox and refetch (debounced ~300–500 ms) on pan/zoom-end, instead of
   loading all households up front. Keep the existing **Today-default date guard**.
4. If bbox is adopted, the `2dsphere` index earns its keep — **keep it** and note that in
   `docs/PERFORMANCE.md` (Phase 1 flagged it as otherwise-dead write cost).

### Verify
`explain()` the bbox query and confirm it uses the `2dsphere` index (an index scan, not `COLLSCAN`).

---

## Overall verification checklist

- [ ] `npm run test:int` (server) — all suites green, including the new `campaignCounters` parity test.
- [ ] Counter parity holds across create / delete / undo / bulk, and the reconcile script restores it.
- [ ] Map bbox query uses the `2dsphere` index (`explain()`).
- [ ] `cd client && npm run build` succeeds.
- [ ] Docs cascaded: `docs/METRICS.md`, `docs/PERFORMANCE.md` (+ any Help article about dashboard
      numbers).

## Deploy notes (for the owner, after fable finishes)

> **STATUS: DONE.** Both items are implemented and verified (parity suite 7/7, full int suite
> 16/16 files, bbox query confirmed IXSCAN on the 2dsphere index, web build + mobile parse clean).
> The reconcile script shipped as **`migrate:campaign-stats`** (it reconciles `Campaign.stats`).

- Deploy `sharedVoters` (Procfile keeps web + worker — never deploy a web-only Procfile).
- Run `npm run migrate:campaign-stats -- --apply` once to backfill the new Campaign.stats counters
  (until then, dashboards silently use the exact live-aggregation fallback — slower, never wrong).
- The viewport map needs a web deploy; the mobile map change needs an OTA (`eas update --branch production`).
