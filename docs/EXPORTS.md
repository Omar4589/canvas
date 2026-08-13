# The Export Center (background CSV/ZIP exports of your campaign data)

The **Export Center** is how an organization gets its data OUT — the product's side of "the
customer owns its data and may export it" (ToS §3/§4/§13, Privacy Policy, DPA §7/§9). An admin
(or a team lead, for campaigns they manage) queues an export on the campaign's **Exports** page,
the file is built in the background on the worker dyno, and the finished artifact is downloadable
from the history list until it expires 7 days later.

- **Part 1 — For everyone** is plain language: the export types, what each file contains, the
  voter-file reconstruction caveats, and why totals can differ from dashboards.
- **Part 2 — Technical reference** is for developers (and Claude): the model, queue, builders,
  the DNC injection point, the entitlement carve-out, and the invariants.

Related: [WALKLISTS.md](WALKLISTS.md) (a saved search scopes the filtered-voters export),
[IMPORTS.md](IMPORTS.md) (the voter-file export reconstructs; the raw upload is deleted after
import), [METRICS.md](METRICS.md) (the three survey counting units and the per-round invariant
the export files carry), [SURVEYS.md](SURVEYS.md) (stable option ids; the in-page
voters-by-answer CSV stays as-is), [DATE_FILTERS.md](DATE_FILTERS.md) (every dated column uses
the campaign anchor timezone), [BILLING.md](BILLING.md) (the read-only wind-down and the export
carve-out), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the v4 2026-08-01 watchlist
entry this feature is bound by).

---

# Part 1 — For everyone

## What it is

Open a campaign and pick **Exports** in the sidebar (on the phone: Admin → More → Exports). Pick
what you want, optionally narrow it with filters, and press **Queue export**. Each type
describes itself before anything queues — what it is, what one row of the file means. On the
phone, tapping a type opens a sheet that goes further: what's in the file, the same filters the
web offers for that type, and a **live row count** for exactly the filters you've set. The
file is built in the background — big exports take a minute — and appears in the
history below with a Download button when ready. Files are kept for **7 days**, then deleted
automatically; queue a fresh one any time (on the phone, touch and hold a row to delete it
sooner). Everything is CSV (opens in Excel/Sheets and re-imports cleanly into other tools); the
full backup is a ZIP of CSVs.

Your data stays exportable even if your subscription is paused or has ended: during the 60-day
wind-down after cancellation the account is read-only, but **queueing and downloading exports
still works** — that window exists precisely so you can take your data with you.

## The export types

| Type | One row is… | Use it for |
|---|---|---|
| **Canvassing activity** | one door event (who knocked, when, the outcome, the voter at that door, GPS, note) | the full field record; audits; "what happened at this address" |
| **Doors by round** | one door in one round, with its round status and visit count | re-knock lists; per-round door detail that adds up to the invoice numbers |
| **Survey results** | one survey taken, one column per question | analysis in a spreadsheet; one file per survey when a campaign ran several; opt-in contact/demographic columns for matching back |
| **Survey answers (detailed)** | one recorded answer, exactly as captured at the door | the audit-grade record — survives question re-wording; takes the same opt-in columns |
| **Voter file** | one voter currently in the campaign | your file back; optionally with the column names from one of your uploads |
| **Filtered voters** | one voter matching a saved search | handing a targeted subset to another tool |
| **Voter notes** (admins only) | one staff note about a voter | the one dataset that previously had no way out |
| **Full backup** (admins only, ZIP) | — | everything above for one campaign (or every campaign), plus per-round totals, a manifest, and a plain-language README |

Team leads see the campaign-scoped types for the campaigns they manage; org-wide exports, voter
notes, and the full backup are admin-only.

**Who each row identifies.** The voter-bearing files (activity, both survey files, notes, and
the voter files) carry two match keys side by side: **State voter ID** (the id your voter file
came with) and **UID** (the vendor id from your original upload, when it had one) — so a file
can be re-matched on another platform. In **Canvassing activity**, the voter columns fill in
only when the event named a voter — a survey at the door; plain knocks (not home, refused, lit
drop) are records about the *door*, nobody was picked, and their voter columns are blank on
purpose. **Doors by round** is a household file and deliberately has no voter columns at all —
use Canvassing activity for who was reached.

## Contact & demographic details (the two survey exports)

By default a survey export identifies the person by **name, party and address** — enough to read
the results, not a copy of your voter file. Tick **Include contact & demographic details** on
**Survey results** or **Survey answers (detailed)** and every row also carries **Phone**, **Phone
type**, **Cell phone**, **Gender**, **Date of birth**, **County**, **Latitude**, **Longitude**,
**Precinct**, and the **Congressional / State senate / State house** districts — the columns you
need to write results back into a system that keys on more than a name.

It is **off by default deliberately**: most survey exports have no reason to put somebody's phone
number and date of birth on the same row as their political opinions. Three things stay true when
it is on:

- **It adds columns, never rows.** The row count, the do-not-contact exclusions and the preview
  count are all unchanged — it is a column option, not a filter.
- **Do-not-contact still wins.** Every added cell is read off the same suppressed voter record as
  the name, so a flagged person's phone and date of birth can no more appear than their name can.
- **The history remembers.** The choice is frozen into the export job, and the Exports history
  row says *contact & demographic details* — so which files carried them is answerable later.

Nothing here is newly collected or newly reachable: the same fields already leave via the
**Voter file** export to the same people. The toggle is about not spreading them by default.

The **Full backup** builds its survey files with the default columns — it composes the same
builders with no params, and a bundle that quietly upgraded itself to full PII would defeat the
point of the toggle. Its `voterfile-current.csv` already carries every one of those fields keyed
by State Voter ID, so the backup loses nothing; its README says so.

## The voter-file caveats (please read before relying on it)

The original file you uploaded is **deleted right after import** (that is deliberate — see
[IMPORTS.md](IMPORTS.md)). The voter-file export therefore **reconstructs** a file from the data
currently in Doorline. When you pick one of your imports in the "Columns" selector, the file
comes back under that vendor's own column names — but honestly:

- Vendor columns that were never mapped during import were never stored, so they can't come back.
- Rows that failed import (bad addresses, duplicates) never became voters and are absent.
- Edits made since the upload — corrections, re-geocoded coordinates, moved voters — show
  through; this is your **current** data in the old columns, not a byte copy of the old file.

## Why an export can show fewer rows than a dashboard

When someone asks not to be contacted, they are **excluded from every export from then on** —
including records made before they asked (that is the strict reading of our published
do-not-contact promise, chosen deliberately). Dashboards still count the historical activity, so
an export can trail the screen it mirrors. Every export records how many rows were withheld
("N withheld — do not contact" in the history), so the gap is always explainable. Door-level
knock records keep the knock itself (the work happened and is billable) with the person's
identity blanked.

Two other honest gaps: survey rows whose voter was later removed by an import undo are dropped
and counted, and the per-round files deliberately do not reproduce the dashboard's synthetic
"do-not-contact / voted" coverage buckets (that would amount to an address-level opt-out list).

## Counting units (so two files never look contradictory)

The survey files carry the three units from [METRICS.md](METRICS.md): **Survey doors** counts
doors (one per household per round), **Voters surveyed** counts distinct people, **Surveys
taken** counts submissions — never sum across them. The activity log is finer than all three
(one row per event). **Doors by round** reconciles to the invoice: for any round, its rows with
a status other than `unknocked`/`restricted` equal that round's **Knocks** in the knocks-by-pass
report, and the backup's `knocks-by-round.csv` is built by the very same pipeline as that
report, so the TOTAL row always matches.

---

# Part 2 — Technical reference

## Model & lifecycle

[`models/ExportJob.js`](../server/src/models/ExportJob.js) — org/campaign scope (campaignId
null = org-wide, admin-only), `type` (enum `EXPORT_TYPE_KEYS`, the registry's key list), frozen
`params` (validated whitelist + `anchorTz` resolved at POST — the worker has no `req`), status
`pending → running → completed | failed | canceled | expired`, honest counters (`rowCount`,
`bytes`, `excludedDncCount`, `orphanedRows`, per-file `files[]`), `artifact{gridFsId, filename,
contentType}`, capped `audit.subjectIds` (post-DNC ids actually written, for the download's
`addAuditSubjects`), `expiresAt` (NOT a Mongo TTL index — the sweeper expires so the history row
survives). Indexes: `{organizationId, createdAt}`, `{organizationId, status}`,
`{status, expiresAt}` — ship via `migrate:build-indexes` (prod autoIndex off) + a
`syncIndexes()` at worker boot.

## Queue & processor

`QUEUE_NAMES.EXPORT` (`export-queue`) consumed by
[`services/export/exportProcessor.js`](../server/src/services/export/exportProcessor.js) on the
worker dyno (concurrency `EXPORT_JOB_CONCURRENCY`, default 1 — never head-of-line-block
imports/turf). Lifecycle: stale-claim no-op → **delete any partial artifact first** (retry
hygiene) → mark running → build → stamp counters + `expiresAt` (`EXPORT_TTL_DAYS`, 7). Failure
marks `failed` with an honest `error` on every attempt (the importProcessor pattern);
`ExportUserError` throws BullMQ's `UnrecoverableError` (a user-actionable failure fails
identically on every retry). Artifacts stream through
[`services/export/exportArtifactStore.js`](../server/src/services/export/exportArtifactStore.js)
(GridFS bucket `exportArtifacts`, filename = job id, org/campaign in metadata for cascade
purges) — one GridFS file per job, CSV or ZIP; nothing ever materializes in memory (Mongo
cursors in, backpressured writes out; ZIP entries append **sequentially** via archiver, size cap
`EXPORT_MAX_BYTES`).

## The type registry & builders

[`services/export/exportTypes.js`](../server/src/services/export/exportTypes.js) is the
anti-drift spine: each type declares `adminOnly` / `requiresCampaign` / `subjectType` /
`validateParams` (whitelist; snapshots a SavedSearch's filter JSON at POST) / `contentKind`
(survey-results becomes a ZIP when >1 template has responses) / `build` — plus the
**user-facing copy**: `label` / `desc` / `oneRowIs` / `filters` (UI filter-group tokens),
served by `GET /types`. The mobile sheet consumes all of it; the web overlays label/desc/filters
onto its local TYPES list (which keeps the per-filter component wiring and the older-server
fallback strings); `oneRowIs` renders on mobile only. Edits to what a type IS happen here once.
The registry's keys must equal the model enum (checked at import time), and the DNC guard test
**iterates the registry**, so a new type is born covered.

Each campaign type also declares **`estimate`** (from
[`services/export/exportEstimates.js`](../server/src/services/export/exportEstimates.js)) — the
pre-queue row count behind `POST /estimate`. The rule is **estimate==build**: every estimate
imports the same exported query constructor its builder streams (`canvassActivityQuery`,
`surveyBaseQuery`, `voterNotesQuery`, `resolveDoorsByRoundRounds` — the turf target-preview
principle), so `rows` predicts `rowCount` and `dncWithheld` predicts `excludedDncCount` by
construction. The two survey types are `approx: true` (their builders also drop orphaned
import-undo rows the count can't see: `rows === rowCount + orphanedRows`); survey-answers must
count `$size(answers)` entries, never responses. All estimates are countDocuments-class and run
inline in the web dyno; `full-backup` alone has no estimate (the endpoint 400s). Builders live in
[`services/export/exportBuilders.js`](../server/src/services/export/exportBuilders.js); the
full-backup **composes** them (never re-implements a file), and its `knocks-by-round.csv` calls
[`services/reports/knocksByPass.js`](../server/src/services/reports/knocksByPass.js) — the
req-free core extracted from `buildKnocksByPass`, shared with `GET /admin/reports/knocks-by-pass`
and its CSV — so Σ rounds === totals holds by construction.

**The opt-in detail block (`params.includeVoterDetail`)** — the two survey types declare the
`voterDetail` filter token and whitelist the boolean in `survey-results`'s `validateParams`
(survey-answers delegates to it, so there is one gate). `exportBuilders.js` resolves it ONCE per
build through **`detailPlan(ctx)`**, which returns the projections, the two header slices and the
two cell functions together — so a builder cannot widen its headers without widening its Mongo
projection to match, or vice versa. Two slices because the sources differ: `voterDetailCells`
(Gender, Date of birth, Phone, Phone type, Cell phone) hangs off the **voter** and therefore off
the same DNC-guarded object every other identity cell reads; `geoDetailCells` (County, Latitude,
Longitude, then Precinct + the three districts) mixes household geography with the
file-authoritative district/precinct fields on the voter. **Projections widen only when the
toggle is on** — an export that is not printing a phone number does not read one out of Mongo.
It is a COLUMN option, never a filter: row counts, `excludedDncCount` and therefore every
estimate are untouched, which is why `exportEstimates.js` needs no knowledge of it (pinned:
`exportBuilders.int.test.js` asserts equal `rowCount`/`excludedDncCount` across both settings,
and that flagged-fixture phone/DOB sentinels appear in NO artifact with the toggle ON).
Off by default (owner decision 2026-08-11); frozen into `ExportJob.params`, and the web history's
`scopeLabel` surfaces it so the record of which exports carried DOB survives the artifact's TTL.
Adding an optional param is backward-compatible in both directions — an old client never sends
it, and a new client sending it to an old server has the key dropped by the whitelist rather than
4xx'd — so it needs no `CLIENT_API_VERSION` bump.

Shared rules: CSV dialect from
[`services/export/csvWriter.js`](../server/src/services/export/csvWriter.js) (UTF-8 BOM, CRLF,
minimal quoting, **formula-injection guard** — string cells starting `=` `+` `-` `@` or tab get
a leading `'`); dated columns render `X (ISO)` + local `Date`/`Time` in the frozen anchor tz;
canvasser identity via `hydrateCanvassers` (ledger-first; a deleted user's snapshot name renders,
their email/tombstone never); `via:'bulk'` rows are included with a `Via` column and auto-dropped
only under a canvasser filter (`NOT_BULK`); `Campaign.pricePerCampaignCents` (select:false) must
never enter a builder projection (grep-guarded in tests).

**DNC is enforced in ONE place**:
[`services/export/exportScope.js`](../server/src/services/export/exportScope.js). The processor
loads the org-wide flagged-voter id set (sibling rows are kept in lockstep) and injects it;
builders never construct their own. Voter-unit rows are dropped; door-unit rows keep the event
with voter-identity columns blanked, no marker. Both paths count into `excludedDncCount`.

## Routes

[`routes/admin/exports.js`](../server/src/routes/admin/exports.js), mounted at `/api/admin/exports`
**after** `requireEntitlement` and `accessLog` (earlier would be an unlogged voter-data path).
Chain: `requireAuth, orgContext, requireOrgRole('admin','lead')`; leads via `canManageCampaign`,
admin-only types + org-wide scope via `isOrgAdmin`.

- `POST /` — validate via the registry, snapshot params + anchorTz, per-org active-job throttle
  (`EXPORT_MAX_ACTIVE_PER_ORG`, 3 → 429), enqueue with a stable jobId; queue ops are
  time-bounded (`EXPORT_ENQUEUE_TIMEOUT_MS`) so a wedged Redis 503s instead of hanging.
- `POST /estimate` — same body as `POST /`, same scope gate (a shared `resolveExportScope`, so
  the preview can never see a campaign the create would refuse), then the registry's `estimate`.
  Returns `{type, contentKind, rows, dncWithheld, approx, files?}` (`files[]` = per-template
  breakdown when survey-results will ZIP). Counts only: no artifact, no `addAuditSubjects`;
  read-only, so it neither checks nor counts toward the active-job throttle.
- `GET /types` — the registry's `label/desc/oneRowIs/adminOnly/requiresCampaign/filters/estimate`
  per type, role-filtered (a lead never receives the admin-only types). Copy only, no data.
- `GET /worker-status` — the imports worker-status pattern against the export queue.
- `GET /` — history, paged; admins also see org-wide (`campaignId:null`) rows; leads only
  managed campaigns; `audit.subjectIds` projected out of every list.
- `GET /:id` — poll target (the ImportPage refetchInterval-predicate pattern client-side).
- `GET /:id/download` — 410 when expired, 409 when not ready; tags `addAuditSubjects` from the
  job's persisted post-DNC ids BEFORE streaming; AccessLog `rows` is null for streams — the doc
  is the durable record. Classifies as `exports` in the access log (never audit-exempt).
- `DELETE /:id` — running 409; otherwise deletes doc + artifact (early purge of a sensitive
  file). Deliberately NOT entitlement-carved; leftovers expire via TTL. **No retry route** —
  the UI re-POSTs a failed job's params, keeping the carve-out one exact path.

## The entitlement carve-out

In [`middleware/entitlement.js`](../server/src/middleware/entitlement.js), after the `canWrite`
check: `POST` to `/admin/exports` **and `POST` to `/admin/exports/estimate`** (method-and-path
exact ×2 — the estimate is a read wearing POST: counts only, no artifact, no data write) pass
for every read-only status. This is what makes the published 60-day wind-down export window true
for the queued-export path, preview included. Widening it further is the top privacy risk of
this feature — `test/billing.int.test.js` pins narrowness (control write and export-DELETE still
402), and the scope amendment is stamped in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

## Retention

`sweep-expired-exports` in
[`services/export/sweepExpiredExports.js`](../server/src/services/export/sweepExpiredExports.js),
registered in `MAINTENANCE_JOBS` (NOT the pinned retention-only `REPEATABLE_JOBS`), cron
`EXPORT_SWEEP_CRON` (05:23 UTC): expires past-TTL artifacts (history row survives, download
410s), clears failed-job leftovers (the raw-imports failure path taught us leaks), and deletes
orphan GridFS files. Org/campaign deletion purges the bucket by metadata
(`deleteArtifactsForScope`) — `ExportJob` is in both `ORG_SCOPED` and `CAMPAIGN_SCOPED`; org-wide
backup jobs (`campaignId:null`) survive a *campaign* delete on purpose and age out via TTL.

## Frontends

Web: [`pages/ExportsPage.jsx`](../client/src/pages/ExportsPage.jsx) (campaign drill-in, nav slug
`exports`), downloads via the shared
[`lib/downloadFile.js`](../client/src/lib/downloadFile.js) (the raw-fetch attachment idiom,
extracted); its local `TYPES` list is filter-UI wiring plus fallback copy — `GET /types`
overlays label/desc and decides visibility when present. Mobile:
[`admin/exports.jsx`](../mobile/app/(app)/admin/exports.jsx) — tapping one of the four everyday
types opens [`components/ExportSheet.jsx`](../mobile/components/ExportSheet.jsx) (MetricSheet's
Modal anatomy): description, "one row is…", contents, the web's filters for that type, and a
live `POST /estimate` count (debounced on the serialized params, `keepPreviousData`, advisory —
an estimate error never blocks Queue, so either deploy order works). Type copy comes from
[`lib/exportTypes.js`](../mobile/lib/exportTypes.js) (local fallback, server registry overlaid).
History rows: failed/expired taps offer Retry (re-POST of the frozen params) and Delete;
long-press deletes any non-running row; a worker-offline banner mirrors the web's.
[`lib/artifactDownload.js`](../mobile/lib/artifactDownload.js) downloads TO DISK
(`FileSystem.downloadAsync` — binary-safe for ZIPs, memory-flat) then opens the share sheet.
Four types stay web-only (owner scope decision): Survey answers (detailed), Filtered voters,
Voter notes, and the full-backup ZIP.

## Tests

`test/exportCsv.test.js` (writer unit), `test/exports.int.test.js` (lifecycle, scoping, expiry,
sweeper placement, cascades; the estimate route's scope/400/throttle-independence matrix; the
types route's role filtering), `test/exportBuilders.int.test.js` (per-type columns/semantics +
the registry-driven DNC sweep — ZIPs run `EXPORT_ZIP_LEVEL=0` so artifacts stay greppable; the
registry-driven **estimate==build** loop, filtered-parity cases, the survey-answers `$size`
pin, and the canvass-activity orphan counter), `test/billing.int.test.js` (carve-out matrix ×2:
create and estimate pass read-only, export-DELETE still 402),
`test/accessLogCoverage.int.test.js` (the new URL shapes — including `/estimate` and `/types` —
must log), `test/orgDelete.int.test.js` (bucket emptiness after org delete).

## The hours-stamp rule (standing)

**Any frozen artifact that carries an hours or per-hour figure must say inside the file when those
hours were true and where they came from** — a visible `hours as of <generatedAt>` and a per-row
hours source. Live surfaces always re-derive; a generated file deliberately stops moving, and with
the FbTime integration ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md)) an hours figure can now
change retroactively (a shift edited or deleted after the file was made). A stamp only on the row
that produced the file leaves whoever opens it in six months holding a number with no provenance.

Today exactly ONE artifact carries hours — the legacy leaderboard CSV,
`GET /admin/reports/canvassers.csv` (not an Export Center type). It opens with two preamble rows
(`Canvasser export, <range>, hours as of <ISO>`, then a blank line) before the header, and ends
every row with an `Hours source` column (`Measured`/`Estimated`/`Mixed` — always present, so the
file shape is constant whether or not an org connected FbTime). Import scripts that assumed row 1
was the header must skip three rows. No Export Center type, statement, or client report carries
hours; if one ever grows an hours column, it inherits this rule.

## Appendix — column contracts (per type)

The header arrays in `exportBuilders.js` are the source of truth; this is the readable copy.
Voter identity in the four voter-bearing CSVs is always the pair **`State voter ID`, `UID`**
(sentence case — the voter files use the title-case canonical labels `State Voter ID` / `UID`
from `canonicalFields.js`; the two spellings coexist deliberately, matching each file's
neighbors). Every new identity cell must derive from the DNC-guarded voter object, never from
the event document — that guard is what blanks a do-not-contact person's row.

- **`activity-log.csv`** — Timestamp (ISO), Date, Time (tz), Action; Address block (line 1/2,
  City, State, Zip, County); **State voter ID, UID**, Voter first/last name, Party (filled only
  when the event named a voter; blanked for DNC); Canvasser first/last/status, Team; Walk list,
  Pass, Pass name, Via (field|bulk), Offline submission; Latitude, Longitude, GPS accuracy (m),
  Distance from house (m); Replaces earlier action, Replaced at (ISO), Note; Household DB id,
  Voter DB id, Activity DB id.
- **`doors-by-round.csv`** — Walk list, Pass, Pass name, Pass status, Book; Address block +
  Precinct; Round status, Door visits this round; Last action at (ISO)/Date/Time; Last action
  by first/last/status; Campaign status, Active door, Household DB id. **No voter columns by
  design** (household grain).
- **`survey-results*.csv`** — Submitted (ISO)/Date/Time; Walk list, Pass, Pass name; **State
  voter ID, UID**, Voter first/last name, Party; *[with `includeVoterDetail`: Gender, Date of
  birth, Phone, Phone type, Cell phone]*; Address block minus County; *[with
  `includeVoterDetail`: County, Latitude, Longitude, Precinct, Congressional district, State
  senate district, State house district]*; Canvasser + Team; Template,
  Template version, Offline submission, Edited, Note; one column per question (current text,
  `Label (key)` on duplicates); Household/Voter/Response DB ids. An **"Other (specify)" write-in**
  renders as **`Other — <typed text>`** (the sentinel is seeded into the export's option lookup), so
  it can't be read as a canonical option that happens to share the typed wording; a multi-select
  keeps its other picks (`Yes; Other — potholes`).
- **`survey-answers.csv`** — Submitted (ISO)/Date/Time; **State voter ID, UID**, Voter
  first/last name, Party; *[with `includeVoterDetail`: the same two blocks as above, in the same
  two positions — one `detailPlan` serves both files]*; Address block minus County; Canvasser; Walk list, Pass, Pass name, Template,
  Template version; Question, Question key, Answer (snapshot), Option ids, Other text; Note,
  Offline submission; Household/Voter/Response DB ids.
- **`voterfile-current.csv` / `voters-filtered.csv`** — every `CANONICAL_FIELDS` label (State
  Voter ID, First Name, Last Name, UID, Phone, …, County, Latitude, Longitude) + Household DB
  id, Voter DB id. **`voterfile-import.csv`** — the import's own vendor headers in canonical
  order (duplicates collapse first-wins) + the two DB ids.
- **`voter-notes.csv`** — Created (ISO)/Date/Time; **State voter ID, UID**, Voter first/last
  name; Address, City, State, Zip; Author first/last/status; Edited, Edited at (ISO), Note;
  Voter DB id, Note DB id.
- **`knocks-by-round.csv`** (backup only) — Walk list, Pass, Pass name, Pass status,
  Activated/Archived (ISO); Knocks, Survey doors, **Surveys taken**, Lit knocks, Refused;
  [Restricted doors, Billable doors when restricted billing is on]; Connection rate %,
  Contact rate %, New homes reached; TOTAL row. `Surveys taken` is the response unit and sits
  beside the door unit deliberately — the two are read together, and only the DOOR column feeds
  the rates. Column order matches `/admin/reports/knocks-by-pass.csv` exactly.
