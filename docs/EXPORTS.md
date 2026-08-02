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
what you want, optionally narrow it with filters, and press **Queue export**. The file is built
in the background — big exports take a minute — and appears in the history below with a
Download button when ready. Files are kept for **7 days**, then deleted automatically; queue a
fresh one any time. Everything is CSV (opens in Excel/Sheets and re-imports cleanly into other
tools); the full backup is a ZIP of CSVs.

Your data stays exportable even if your subscription is paused or has ended: during the 60-day
wind-down after cancellation the account is read-only, but **queueing and downloading exports
still works** — that window exists precisely so you can take your data with you.

## The export types

| Type | One row is… | Use it for |
|---|---|---|
| **Canvassing activity** | one door event (who knocked, when, the outcome, the voter at that door, GPS, note) | the full field record; audits; "what happened at this address" |
| **Doors by round** | one door in one round, with its round status and visit count | re-knock lists; per-round door detail that adds up to the invoice numbers |
| **Survey results** | one survey taken, one column per question | analysis in a spreadsheet; one file per survey when a campaign ran several |
| **Survey answers (detailed)** | one recorded answer, exactly as captured at the door | the audit-grade record — survives question re-wording |
| **Voter file** | one voter currently in the campaign | your file back; optionally with the column names from one of your uploads |
| **Filtered voters** | one voter matching a saved search | handing a targeted subset to another tool |
| **Voter notes** (admins only) | one staff note about a voter | the one dataset that previously had no way out |
| **Full backup** (admins only, ZIP) | — | everything above for one campaign (or every campaign), plus per-round totals, a manifest, and a plain-language README |

Team leads see the campaign-scoped types for the campaigns they manage; org-wide exports, voter
notes, and the full backup are admin-only.

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
(survey-results becomes a ZIP when >1 template has responses) / `build`. The registry's keys
must equal the model enum (checked at import time), and the DNC guard test **iterates the
registry**, so a new type is born covered. Builders live in
[`services/export/exportBuilders.js`](../server/src/services/export/exportBuilders.js); the
full-backup **composes** them (never re-implements a file), and its `knocks-by-round.csv` calls
[`services/reports/knocksByPass.js`](../server/src/services/reports/knocksByPass.js) — the
req-free core extracted from `buildKnocksByPass`, shared with `GET /admin/reports/knocks-by-pass`
and its CSV — so Σ rounds === totals holds by construction.

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
check: `POST` to `/admin/exports` (method-and-path exact) passes for every read-only status.
This is what makes the published 60-day wind-down export window true for the queued-export path.
Widening it is the top privacy risk of this feature — `test/billing.int.test.js` pins narrowness
(control write and export-DELETE still 402).

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
`exports`), downloads via the new shared
[`lib/downloadFile.js`](../client/src/lib/downloadFile.js) (the raw-fetch attachment idiom,
extracted). Mobile: [`admin/exports.jsx`](../mobile/app/(app)/admin/exports.jsx) — view +
download/share + one-tap queue of the no-filter types;
[`lib/artifactDownload.js`](../mobile/lib/artifactDownload.js) downloads TO DISK
(`FileSystem.downloadAsync` — binary-safe for ZIPs, memory-flat) then opens the share sheet.
Filters and the full builder are web-only (the CSV-upload precedent).

## Tests

`test/exportCsv.test.js` (writer unit), `test/exports.int.test.js` (lifecycle, scoping, expiry,
sweeper placement, cascades), `test/exportBuilders.int.test.js` (per-type columns/semantics + the
registry-driven DNC sweep — ZIPs run `EXPORT_ZIP_LEVEL=0` so artifacts stay greppable),
`test/billing.int.test.js` (carve-out matrix), `test/accessLogCoverage.int.test.js` (the new URL
shapes must log), `test/orgDelete.int.test.js` (bucket emptiness after org delete).
