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
the export files carry — plus the counts that exist only in a file: Results by voter's per-person
*Surveys taken*, its *Address visits* / *Rounds worked*, and the activity log's survey-source rows), [SURVEYS.md](SURVEYS.md) (stable option ids; the in-page
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
| **Canvassing activity** | one door event (who knocked, when, the outcome, the voter at that door, GPS, note) — or, with **One row per voter at the door** ticked, one voter at that door for every knock that named nobody | the full field record; audits; "what happened at this address"; a voter-keyed file when every person at a not-home address needs a row |
| **Doors by round** | one door in one round, with its round status and visit count | re-knock lists; per-round door detail that adds up to the invoice numbers |
| **Survey results** | one survey taken, one column per question | analysis in a spreadsheet; one file per survey when a campaign ran several; opt-in contact/demographic columns for matching back |
| **Survey answers (detailed)** | one recorded answer, exactly as captured at the door | the audit-grade record — survives question re-wording; takes the same opt-in columns |
| **Results by voter** | one registered voter at a door that was visited, with that door's outcome and their answers | the file you send a client — who lives there, what happened at their address, and what they said, in one row per person, with the outcome in plain English and answers grouped by round |
| **Voter file** | one voter currently in the campaign | your file back; optionally with the column names from one of your uploads |
| **Filtered voters** | one voter matching a saved search | handing a targeted subset to another tool |
| **Notes** | one note — typed at a door, attached to a survey, or written on a voter profile | reading what the field actually wrote; "every not-home note from last week" |
| **Voter profile notes** (admins only) | one note written on a voter profile | the profile trail on its own, with author and edit history |

| **Full backup** (admins only, ZIP) | — | a copy of each type above for one campaign (or every campaign) — except **Filtered voters** (a saved-search subset) and **Results by voter** (the bundle already carries the survey files) — plus per-round totals, a manifest, and a plain-language README |

Team leads see the campaign-scoped types for the campaigns they manage; org-wide exports, the
**Voter profile notes** type, and the full backup are admin-only. **Notes** *is* lead-available,
and note that this means a lead can download profile-note bodies through it even though the
profile-notes type itself stays admin-only — a deliberate owner ruling (2026-09-01), recorded in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) v6, on the grounds that a lead already reads
all three note sources on the Notes page for campaigns they manage.

**Results by voter** is lead-available too, both of its opt-ins included, and that is also
deliberate: a lead is often the **client** — an outside stakeholder paying for the one campaign they
have access to, with no access to the org — so "may a lead export this" is the same question as "is
this file fit to hand the customer" (owner ruling 2026-09-23, recorded in the same place).


**Narrowing by outcome.** Canvassing activity, Notes and Results by voter all take a **Door outcome** filter —
chips; tick the outcomes you want, and nothing ticked means every outcome. Leave *Restricted*
and *Wrong address* unticked to drop desk marks and bad addresses from the file, or tick only
*Not home* for a re-knock list with the full event detail behind it. On the web, Canvassing
activity's chips live in the dialog that **Queue export** opens for that type (beside the
one-row-per-voter box); the Notes chips sit inline with the other filters. The phone's row-count
preview follows it, and the export history lists the outcomes a file was narrowed to.
On **Results by voter** the chips do one thing only: they choose which *doors* are in the file. Narrow
to *Not home* and you get the people at the addresses where somebody was out — each row still showing
that address's own outcome, which can therefore name an outcome you did not tick, while the visit
counts beside it follow the chips. That type offers only outcomes that count as a visit, so there is
no *Note added* chip: a note is not a visit, and a file of people at doors that were merely annotated
would be empty.


**Who each row identifies.** The voter-bearing files (activity, both survey files, Results by
voter, notes, and the voter files) carry two match keys side by side: **State voter ID** (the id your voter file
came with) and **UID** (the vendor id from your original upload, when it had one) — so a file
can be re-matched on another platform. In **Canvassing activity**, the voter columns fill in
only when the event named a voter — a survey at the door; plain knocks (not home, refused, lit
drop) are records about the *door*, nobody was picked, and their voter columns are blank on
purpose. Two exports let you ask for the people registered at that door anyway, and both are
off by default with the choice recorded in the export history, because a door record names
nobody on its own and that roster is the one thing that ties it to named people. In
**Canvassing activity**, tick **One row per voter at the door** and every knock that named
nobody repeats once per registered voter at that address (the next section). In **Notes**, tick
**Include the voters registered at each door** and a door note gains a column listing the people

registered there; the count beside the list counts only the names shown. A third route is a whole
type rather than a tick: **Results by voter** *is* that roster — every registered voter at a door
that was visited gets a row whether or not anybody named them — which is why it carries its own
opt-ins and its own limits (below). In all three, do-not-contact voters are never listed. **Doors by
round** is a household file and deliberately has no voter columns at all — use Canvassing activity or
Results by voter for who was reached.

## One row per voter at the door (the Canvassing activity export)

A "not home" is a fact about an address. Some tools on the receiving end want a fact about a
*person* — a row per registered voter, so a knock can be matched to every household member in a
voter-keyed system. Press **Queue export** on a Canvassing activity export, tick **One row per
voter at the door** in the dialog that opens, and every knock that named nobody — not home, wrong address, refused, lit drop, no
soliciting, restricted — comes out once per voter registered at that address, each row carrying
the same outcome, time, canvasser, GPS and note, with that voter's State voter ID, UID, name and
party filled in. Rows that already name a voter (a survey at the door) are untouched.

Four things to know before you rely on the file:

- **The outcome is repeated, not attributed.** A *refused* on three rows means someone at that
  address declined — not that each of the three did. *No soliciting* is a sign on the property,
  and neither is a do-not-contact request. *Restricted* rows repeat too, and many of those are
  desk marks over a whole book rather than a visit, so an export over a bulk-restricted book can
  grow a lot; the `Via` column says which rows are desk marks, filtering to one canvasser
  leaves them out, and unticking *Restricted* under **Door outcome** drops them altogether.
- **Its rows are not knocks.** The columns are identical to the normal file but the row count is
  not, so the file is named **`activity-log-by-voter`** (and the download
  `…-canvass-activity-by-voter-<date>.csv`) — never sum its rows for an invoice; the invoice-grade
  files are still the per-round ones. To recover the knock count, count distinct **Activity DB
  id** values, which every row of one knock shares.
- **It is today's roster.** The people listed are the voters registered at that address *now* —
  someone imported after the knock appears, someone moved out since does not — so the row count
  on screen and the finished file can differ by a row if the roster changed in between.
- **Nobody to list keeps one row.** An address with no registered voters, or none who can be
  listed, keeps its single row with the voter columns blank, exactly as the normal file has it.
  Do-not-contact voters are never listed, and the "N withheld" figure does not count them here —
  a per-address count of who was left out would itself say who asked not to be contacted.

The choice is recorded in the export history ("one row per voter at the door" in the row's
scope), and the full backup never uses it.

## Include survey answers (the Canvassing activity export)

The activity log records *knocks*; the answers live in the survey files, so "what happened at this
address, and what they told us" has meant exporting twice and joining. Press **Queue export** on a
Canvassing activity export and tick **Include survey answers** in the dialog that opens, beside the
outcome chips (the phone's Canvassing activity sheet has the same switch), and every survey row
carries what was recorded — one column per question, plus the survey's name and version, when it was
submitted, who took it, and whether an admin typed it in at a desk rather than a canvasser recording
it at the door.

It adds **rows** as well as columns, which is the part to understand before counting anything:

- **Surveying three people at one door in one round is one knock and three surveys.** The knock
  ledger keeps one row per canvasser, household and round however many people were surveyed, so two
  of those three surveys have no knock row to sit on. Each becomes its own row, and a new **Row
  source** column says where every row came from: `knock` for a door event, `survey` for a row that
  exists because a survey does. A `survey` row has no **Activity DB id**. **Never count those as
  knocks** — for the knock count, count distinct **Activity DB id** values and ignore the blanks.
- **The file is renamed to say so** — **`activity-log-with-surveys`** (download
  `…-canvass-activity-with-surveys-<date>.csv`), and `activity-log-by-voter-with-surveys` with both
  options on. The suffix tracks whether rows were actually added: filter to one canvasser and you get
  the answer columns with **no** extra rows — that filter has already removed the covering knock
  rows, and adding the uncovered surveys would fill one canvasser's file with other people's work —
  so the name stays `activity-log`.
- **Unticking *Surveyed* under Door outcome switches the whole layer off.** A file narrowed to *Not
  home* has nothing to attach answers to, so it comes out with no answer columns at all rather than
  as a re-knock list padded with surveys.
- **Two canvassers who surveyed the same person in one round keep a row each.** Only the later survey
  is the live record, and both rows carry it, with **Survey taken by** naming whose survey it is —
  blanking the first canvasser's row would make their knock look like it recorded nothing.

The choice is remembered for that campaign in the browser you queued from, so wanting the answers
once means having them next time; unticking it and queueing is remembered too. It is frozen into the
export job either way and the history's scope line says *survey answers*, so which activity files
carried political opinions is answerable later. Retrying an old export re-runs *its* options, never
your remembered one.

## Results by voter (the file you send a client)

Most exports are built to be re-imported. This one is built to be **handed over**: one row per person,
the outcome at their address spelled in plain English — *Not home*, *Refused*, *Surveyed* — and
beside it what they said.

**One row is one registered voter at a door that was visited.** A visit means somebody walked up,
which includes a *Restricted* mark made in the field and excludes a restriction applied to a book
from the desk. Anyone surveyed in the same scope is in the file too, even if they have since been
moved to an address nobody has knocked — their Address columns then describe where they live now and
read *Unknocked* with no visits.

Each row carries the voter's two match keys, name and party; the address; what happened at that
address (the outcome, how many visits, how many rounds, the first and last visit dates, and who was
there last); how many surveys they took; and then one block of columns per survey. Two opt-ins widen
it: **Include contact & demographic details** adds the matching-back columns (the next section), and
**Include the note from each survey** adds what the canvasser typed — off by default, because this is
the export most likely to be sent onward and a note is free writing about a named person. Queue it
from the web; the phone offers four types to queue, but a file queued anywhere appears in both
histories.

**The Address columns describe the door, not the person.** *Refused* on a three-voter house means
somebody there declined — not all three, and not any identifiable one of them. The same goes for *No
soliciting* (a sign on the property) and *Not home*. Only the survey blocks are facts about the
person whose row it is.

**Answers are grouped by round**, so a voter surveyed in round 1 and again in round 2 shows both,
side by side, in blocks labelled by walk list and round (`North Side R1 — …`) — nothing averaged,
nothing overwritten, so a change of mind is visible. One person can hold one survey per round, which
is why the blocks are the rounds that actually happened rather than a grid of every possible one. A
block's **Survey** cell reads *(desk entered)* when an admin typed those answers in instead of a
canvasser recording them at the door.

Three limits, and they matter the moment you reconcile the file against anything:

- **A door with no registered voters produces no rows** — and neither does a door where every
  registered voter has asked not to be contacted. The two are **indistinguishable by design**,
  because a file that showed the difference would be telling you which addresses hold an opt-out. So
  the row count is **not "the doors we worked"**; **Doors by round** is the file that accounts for
  every door.
- **Address visits and Rounds worked are not invoice numbers.** *Address visits* counts events, so a
  door visited twice in one round reads 2 where the invoice counts that door once; *Rounds worked*
  counts the rounds in which the door was visited at all. Neither matches **Doors by round**'s
  per-round visit count either. Anything that has to agree with a bill comes from **Doors by round**
  and the per-round reports.
- **Removed work is gone, not zeroed.** A knock taken back with **Unknock**, or a round that was
  discarded, takes its visits with it — and a door whose only visit was undone drops out of the file
  entirely.


## Contact & demographic details (the survey exports and Results by voter)


By default these files identify the person by **name, party and address** — enough to read
the results, not a copy of your voter file. Tick **Include contact & demographic details** on
**Survey results**, **Survey answers (detailed)** or **Results by voter** and every row also carries **Phone**, **Phone
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
identity blanked. One deliberate exception to the counting: with **One row per voter at the
door** on, a do-not-contact voter is simply absent from the address's rows and is *not* added to
the withheld figure — a per-address count of who was left out would itself say who asked.
Two related details: a survey's note is written to both ledgers, so a do-not-contact person's survey
note used to print on their otherwise-blanked knock row beside their full address — it is now blanked
with the rest of their identity, whether or not the answers option is on. And on **Results by voter**
the unit is the person, so a flagged voter's row goes entirely and is counted in the withheld figure
— but only where their door was visited, since a flagged voter at a door nobody worked was never in
the file to withhold.


Two other honest gaps: in the two survey files, rows whose voter was later removed by an import undo
are dropped and counted (in Canvassing activity such a row keeps its place with the identity blank,
the same as any other door record), and the per-round files deliberately do not reproduce the dashboard's synthetic
"do-not-contact / voted" coverage buckets (that would amount to an address-level opt-out list).

## Counting units (so two files never look contradictory)

The survey files carry the three units from [METRICS.md](METRICS.md): **Survey doors** counts
doors (one per household per round), **Voters surveyed** counts distinct people, **Surveys
taken** counts submissions — never sum across them. The activity log is finer than all three
(one row per event) — and **`activity-log-by-voter.csv`**, its opt-in one-row-per-voter form, is

finer still and is *not* a count of anything: dedupe on **Activity DB id** to get back to events.
With **Include survey answers** on it also carries rows that are not events at all, so count distinct
**Activity DB id** and ignore the blanks. **Results by voter** reconciles to nothing on purpose: its
unit is a person, its *Address visits* counts events rather than billable doors, and doors with no
listable voters are absent from it altogether.
**Doors by round** reconciles to the invoice: for any round, its rows with
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

**The tenth type, `results-by-voter`** ("Results by voter") declares `adminOnly: false`,
`requiresCampaign: true`, `subjectType: 'voter'`, `contentKind: async () => 'csv'` — ALWAYS one
file, even with several surveys in scope, because the row unit is the PERSON and splitting by
template the way survey-results does would split one person across files. Its tokens are
`['date','effort','pass','canvasser','outcome','voterDetail','surveyNote']` and its `estimate` is
EXACT (`approx: false`). It is deliberately absent from `buildFullBackup`'s composition list, which
still runs **eight** builders: the bundle already carries both survey files and
`voterfile-current.csv`, so this type is a *presentation* of data the bundle holds rather than data
it lacks. Its own section is below.

Each campaign type also declares **`estimate`** (from
[`services/export/exportEstimates.js`](../server/src/services/export/exportEstimates.js)) — the
pre-queue row count behind `POST /estimate`. The rule is **estimate==build**: every estimate

imports the same exported query constructor its builder streams (`canvassActivityQuery` and
`countActivityRowsWithLayer` / `countCanvassActivityRows` / `countUncoveredResponses`,
`surveyBaseQuery`, `voterNotesQuery`, `resolveDoorsByRoundRounds`, `notesScopeOf`, and
`resolveVoterResultsUniverse` + `countVoterResultsRows` + `countVoterResultsWithheld` — the turf
target-preview principle), so `rows` predicts `rowCount` and `dncWithheld` predicts
`excludedDncCount` by construction. `results-by-voter` goes one step further and shares the
resolved **universe object** itself, not just the constructor: `resolveVoterResultsUniverse` runs
once and both the row count and the withheld count are taken off it, so the preview cannot count a
different set than the file contains. It is `approx: false` and exact — the roster cursor IS the
row set, so there is nothing the builder drops that the count cannot see — and
`countVoterResultsRows` is simultaneously the estimate's `rows` and the builder's progress
denominator. The two survey types are `approx: true` (their builders also
drop orphaned import-undo rows the count can't see: `rows === rowCount + orphanedRows`);
**`notes` is `approx: true` too, and its three sources contribute to `orphanedRows` very
differently — get this wrong and the parity loop fails:**

| source | on a missing voter | why |
|---|---|---|
| door | never counted | every matching row is WRITTEN (a flagged voter only blanks the identity), so the plain count IS the rowCount. Counting one here would break the identity — which is why this differs from `buildCanvassActivity`, whose `approx: false` makes its orphan count informational |
| survey | `countOrphaned(1)`, row dropped | voter-unit, and the count has no voter join, so the row IS in `est.rows` — that is exactly what `orphanedRows` reconciles |
| admin | never counted, row skipped silently | the estimate's campaign-membership join already excludes it. The builder cannot tell "voter deleted" from "voter in another campaign" (`VoterNote` is org-level, so cross-campaign notes are the *common* case), and neither case is in `est.rows` |

survey-answers must
count `$size(answers)` entries, never responses. All estimates are countDocuments-class and run
inline in the web dyno — with three aggregation-class exceptions, all still inline: canvass-activity
under `perVoterRows` (the FIRST row-multiplying option, see *The opt-in row grain* below), the same
type under `includeSurveyAnswers` (the second — `countUncoveredResponses`), and `results-by-voter`
(an aggregation cursor over worked doors plus chunked roster counts); `full-backup` alone has no
estimate (the endpoint 400s). Builders live in
[`services/export/exportBuilders.js`](../server/src/services/export/exportBuilders.js); the
full-backup **composes** them (never re-implements a file), and its `knocks-by-round.csv` calls
[`services/reports/knocksByPass.js`](../server/src/services/reports/knocksByPass.js) — the
req-free core extracted from `buildKnocksByPass`, shared with `GET /admin/reports/knocks-by-pass`
and its CSV — so Σ rounds === totals holds by construction.

**The opt-in detail block (`params.includeVoterDetail`)** — **three** types declare the
`voterDetail` filter token: the two survey ones, which share a single gate (`survey-answers`
delegates its whole `validateParams` to `survey-results`'s), and `results-by-voter`, which
whitelists the boolean in its own — so there are TWO gates for one param, and a change to what
the toggle accepts has to land in both. `exportBuilders.js` resolves it ONCE per
build through **`detailPlan(ctx)`**, which returns the projections, the two header slices and the
two cell functions together — so a builder cannot widen its headers without widening its Mongo
projection to match, or vice versa. Two slices because the sources differ: `voterDetailCells`
(Gender, Date of birth, Phone, Phone type, Cell phone) hangs off the **voter** and therefore off
the same DNC-guarded object every other identity cell reads; `geoDetailCells` (County, Latitude,
Longitude, then Precinct + the three districts) mixes household geography with the
file-authoritative district/precinct fields on the voter. **Projections widen only when the
toggle is on** — an export that is not printing a phone number does not read one out of Mongo.
It is a COLUMN option, never a filter (contrast `perVoterRows` below, the one ROW option): row
counts, `excludedDncCount` and therefore every
estimate are untouched, which is why `exportEstimates.js` needs no knowledge of it (pinned:
`exportBuilders.int.test.js` asserts equal `rowCount`/`excludedDncCount` across both settings,
and that flagged-fixture phone/DOB sentinels appear in NO artifact with the toggle ON).
Off by default (owner decision 2026-08-11); frozen into `ExportJob.params`, and the web history's
`scopeLabel` surfaces it so the record of which exports carried DOB survives the artifact's TTL.
Adding an optional param is backward-compatible in both directions — an old client never sends
it, and a new client sending it to an old server has the key dropped by the whitelist rather than
4xx'd — so it needs no `CLIENT_API_VERSION` bump.

**The opt-in row grain (`params.perVoterRows`)** — the Export Center's first ROW option, on
`canvass-activity` only (token `perVoterRows`; same backward-compatibility argument, no version
bump). `exportBuilders.js` resolves it once through **`fanPlan(ctx)`** (the `detailPlan` pattern):
the file name (`activity-log-by-voter` vs `activity-log`) and the roster predicate
`rosterMatch = { campaignId, ...DNC_FILTER }` that both the builder's per-batch roster prefetch
(`loadFanRoster`, ≤ BATCH doors — the `buildNotes` roster lifted almost verbatim) and the
estimate's `$unionWith` sub-`$match` spread, so preview and file cannot disagree about who counts
as a voter at a door. **Emission rule:** an activity whose *stored* `voterId` is `null` repeats
once per voter in its door's kept roster (sorted last, first, `_id`); an EMPTY kept roster falls
back to exactly one row byte-identical to the un-fanned one; rows that already name a voter —
including a DNC-blanked one and a dangling one — are never fanned (the rule keys on the stored
id, never on rendered blankness). The 34 headers are identical either way: the grain rides the
NAME — a privacy control, see the DNC paragraph — and it rides the *download* name through the
registry's `fileSlug(params)` → `exportFilename({ slug })` → `exportProcessor`, because `csvSink`
discards `sink.file()`'s name and neither client renders `ExportJob.files[].name`, so renaming

the sink entry alone would be invisible. **The estimate** is the builder's own
**`countActivityRowsWithLayer(ctx, { maxTimeMS })`** — literally the same function the builder uses
as its progress denominator, and a thin sum of the fan's `countCanvassActivityRows` and the answer
layer's `countUncoveredResponses` (below), so neither option can move the row count without moving
the preview. Inside the fan half: plan off, `countDocuments(q)` as ever; plan on,
`named + Σ_doors k_d × max(1, r_d)` as ONE `$unionWith` pipeline (voter-less activities grouped
by household ∪ the campaign's kept roster grouped by household → merge → `$max: [1, r]` is the
empty-roster fallback as arithmetic; two index scans, one document back to Node — served by the
new `{campaignId, voterId, timestamp, householdId}` index on `CanvassActivity` and the covered
`{campaignId, householdId, doNotContact.flagged}` index on `Voter`, both behind the
`migrate:build-indexes --apply` gate). `approx` stays `false` and must: `countOrphaned` here fires
on a row that IS written, so `approx: true` would make the registry parity loop demand
`rowCount + orphanedRows`. Instead the pipeline carries `maxTimeMS` (`EXPORT_ESTIMATE_MAX_MS`,
default 8000 — the first `maxTimeMS` in the server, justified because `POST /estimate` has no
other bound, Heroku's router gives up at 30s, and an aborted request does not stop a running
aggregation) and on expiry the estimate answers with the **floor** — `countDocuments(q)`, one row
per knock, never above the truth — flagged `rowsAreFloor: true` (the mobile sheet says "at least

N rows"); with `includeSurveyAnswers` also on, the floor is that count plus the exact
`countUncoveredResponses` term — a separate aggregation that did not time out — so the floor is only
ever short by *fanned* rows. **The fan does not move `dncWithheld`**: it counts rows whose OWN
`voterId` is flagged, and roster omissions are never counted (`exportScope.js` rule (b)). **The
answer layer does**, and the comment in `exportEstimates.js` that read "IDENTICAL with the option on
and off" has been corrected to say which option it was ever a claim about: an uncovered response is a
voter-unit row, so a flagged voter's survey row is dropped WHOLE and counted, a second term in the
same figure. Every fanned voter is added
to `ctx.subjects` at write time, so the record-level audit names them — and `subjectsTruncated`
becomes routine on large fanned exports. The full backup passes `params: {}`, so the bundle is

un-fanned by construction. Off by default; frozen into `ExportJob.params`; surfaced by the web
history's `scopeLabel` (which now also surfaces `includeDoorVoters`, `actionTypes`,
`includeSurveyNote` and `includeSurveyAnswers`).

**The opt-in answer layer (`params.includeSurveyAnswers`)** — the Center's SECOND row option, on
`canvass-activity` only (token `surveyAnswers`; same backward-compatibility argument, no version
bump). Resolved once through **`answerLayerPlan(params)`** — PARAMS, not a `ctx`, so the registry's
`fileSlug` resolves the same layer the builder does and the file name can never disagree with the
columns. It returns three booleans and the distance between them is the design:

| flag | rule | why |
|---|---|---|
| `on` | `asked && chipsAllow` | **the chips gate the layer.** With `survey_submitted` unticked there are no survey rows to attach anything to, so the file is **byte-identical** to one queued without the option rather than gaining a strip of empty columns |
| `joinAnswers` | `on` | the join, on the `SurveyResponse` unique key `{voterId, passId}` |
| `addRows` | `on && !params.userId` | suppressed under a canvasser filter: that filter REMOVES the covering rows, so keeping the rule would manufacture other people's surveys into a file measured as one canvasser's work |

**No `userId` equality in the join (owner ruling 2026-09-23).** Two canvassers who surveyed the same
person in one round keep one activity row each while the live response is the later one's, so BOTH
rows carry the answers **of record** and the disclosure columns (`Survey taken by`, `Desk entered`)
say whose survey it is; blanking the superseded row would read as "no survey taken", which is false.
The response scope is its own `activityResponseQuery`, deliberately NOT `surveyBaseQuery`, because
that one applies `params.userId` and would hide the very row the ruling is about.

**It also ADDS ROWS**, and that is why the columns are honest. A survey knock is
**household-deduped**: surveying three people at one door in one pass leaves ONE `survey_submitted`
row and THREE responses, so columns alone would show one of the three and look complete. Every
in-scope response that no activity row in the file names becomes its own row — `Row source: survey`,
blank `Activity DB id`, **never counted as a knock**. **Coverage is decided from the RESPONSE side**,
per batch: for the responses in this batch, does any `survey_submitted` row in the file's scope name
their `(voter, pass)`? Deciding it from the activity side double-prints answers at `BATCH = 500`,
because a covering row can sit in a different batch than the response it covers. The two ledgers
stream as two cursors through `mergeByTime`, with the ACTIVITY stream at index **0** deliberately —
the equal-instant tie-break is emergent (strict `<` keeps the lowest index) and equal instants are the
NORM here, because a field submit writes one `ts` to both ledgers.

**A dangling response** (its `Voter` removed by an import undo) is KEPT with blank identity and
counted into `orphanedRows` — the same door-unit habit this file already has for a dangling knock
row, and the reason `approx` can stay `false` here rather than following survey-results into
drop-and-count.

**Both file names come from ONE function**, `activityFileNames(params)`: `activity-log`,
`activity-log-by-voter`, `activity-log-with-surveys`, `activity-log-by-voter-with-surveys`, and the
same four for the download slug (`canvass-activity…`). The `-with-surveys` suffix tracks **`addRows`**,
not the raw tick — columns never rename a file (`includeVoterDetail` does not), and a name claiming a
moved grain the file does not have is worse than no name.

**The `outcome` filter token** on the same type is the notes export's Door-outcome chip row
reused: both tokens feed the one `actionTypes` param (include semantics; empty = all), which
`canvassActivityQuery` already applied and the estimate therefore already honoured — the token
is what makes the chips render on both clients. Mobile renders it with `SourceChips` inside the
sheet's scroller (the component's flex caveat applies), keyed off `ACTION_LABELS` in
`lib/theme.js`.

Shared rules: CSV dialect from
[`services/export/csvWriter.js`](../server/src/services/export/csvWriter.js) (UTF-8 BOM, CRLF,
minimal quoting, **formula-injection guard** — string cells starting `=` `+` `-` `@` or tab get
a leading `'`); dated columns render `X (ISO)` + local `Date`/`Time` in the frozen anchor tz — with
one deliberate exception, `results-by-voter`'s two *Address … visited* columns, which are a local
DATE only (see the appendix);
canvasser identity via `hydrateCanvassers` (ledger-first; a deleted user's snapshot name renders,
their email/tombstone never); `via:'bulk'` rows are included with a `Via` column and auto-dropped
only under a canvasser filter (`NOT_BULK`); `Campaign.pricePerCampaignCents` (select:false) must
never enter a builder projection (grep-guarded in tests).

**DNC is enforced in ONE place**:
[`services/export/exportScope.js`](../server/src/services/export/exportScope.js). The processor
loads the org-wide flagged-voter id set (sibling rows are kept in lockstep) and injects it;
builders never construct their own. Voter-unit rows are dropped; door-unit rows keep the event
with voter-identity columns blanked, no marker. Both paths count into `excludedDncCount`. Two
opt-in exceptions read a door's roster through `DNC_FILTER` instead — `notes`/`includeDoorVoters`
and `canvass-activity`/`perVoterRows` — and `exportScope.js` states the three rules that keep an
omission from becoming a marker: never a count, placeholder or withheld row for an omitted voter
(an empty roster falls back to ONE blank row, byte-identical to a voter-less door's); roster
omissions never count into `excludedDncCount`; and the fan keys on the stored `voterId`, never on
rendered blankness.

**Two new DNC paths.** The answer layer adds a term, and `results-by-voter` is the first type whose
withheld figure is UNIVERSE-scoped:

- A flagged voter's **knock** row keeps the row and blanks identity as ever — and now also blanks the
  answers **and the `Note` cell on a `survey_submitted` row**. That last one **closes a pre-existing
  leak**: a field survey's note is written to BOTH ledgers (`routes/mobile/canvass.js`), so today's
  shipped `activity-log.csv` prints a do-not-contact person's survey note beside their full address
  while blanking their name. Blanked with the option on and off.
- A flagged voter's **survey-source** row is voter-unit — the row IS the person — so it is dropped
  whole and counted; that is the second `dncWithheld` term above.
- `results-by-voter` is voter-unit throughout: `DNC_FILTER` sits inside the roster cursor, so a
  flagged voter never reaches a row for `ctx.countDnc` to count. The withheld figure is therefore a
  second query over the SAME universe (`countVoterResultsWithheld`, `buildVoterFile`'s pattern) and
  **universe-scoped on purpose** — a flagged voter at a door nobody visited was never a row this
  export withheld, and counting campaign-wide would overstate what was held back.

## Results by voter (`results-by-voter`)

The tenth type, and the first built to be **read** rather than re-imported — the file an org sends a
client. `buildVoterResults` in `exportBuilders.js` streams ONE globally sorted `Voter` cursor
(`{lastName, firstName}`, so the file is alphabetical end to end) with per-batch membership testing;
per 500-voter batch it runs ONE `CanvassActivity` aggregation for the door facts and ONE
`SurveyResponse.find` for the answers.

**The universe** — `resolveVoterResultsUniverse(ctx)`, shared with the estimate: every registered
voter at a door with a *surviving* field visit, UNION anyone surveyed in scope. The surveyed half is
not redundant with the door half — a re-import moves `Voter.householdId` while
`SurveyResponse.householdId` stays frozen at submit time, so a voter we surveyed who has since
re-housed to an unknocked door would otherwise vanish from their own results file. Worked doors are
streamed through an aggregation cursor rather than `distinct`, which returns ONE reply and dies at
the 16MB BSON cap (~840k ids). The surveyed half **follows the outcome chips** too, because it is a
repair for re-housing rather than a second universe: a response implies a `survey_submitted` visit,
so asking for not-home work only and still receiving everyone ever surveyed would make the chips
cosmetic.

**THE FOUR DEFINITIONS.** Two exports and an invoice get compared against this file, so these are
written down here rather than left in the code:

1. **A VISIT is a field-visit row** — the shared `fieldVisitMatch`, *the same predicate that starts
   the billing clock*. So a **field** `restricted` IS a visit (the walk was made, which is also
   exactly why it starts the clock) and an admin **desk** restriction is not (`via: 'bulk'` on
   `restricted`; `services/canvass/deskRestrict.js`'s `DESK_RESTRICT_MATCH` is the write-side owner of
   the same pair). A note is never a visit.
2. **ADDRESS OUTCOME resolves over the door's non-note rows** (`STATUS_ROW_MATCH` — desk restricts
   **INCLUDED**), so the column says what the web map, Books and Door Outcomes say. It is **not** the
   stored `Household.status`, deliberately: `utils/reconcileCounts.js` only rewrites those fields
   inside `if (h.status !== newStatus)`, so drift in the stored value is never repaired by the
   nightly job and must not be exported as fact. Resolving over VISITS instead would print "Not
   home" for a door the whole rest of the product calls "Restricted".
3. **The FILTERS narrow the work columns** — a "last week, canvasser Ada" file prints Ada's visits in
   that window, not the door's lifetime. **The outcome chips narrow the work columns too** — `loadDoorFacts` intersects them through
`fieldVisitActionTypes` — and they additionally choose WHICH DOORS are in the file. The one thing they
never touch is **how a door's outcome reads** (`voterResultsStatusQuery` carries no `actionType`), or
every row of a chip-filtered file would read back whatever was ticked.
4. **A ROUND is a `passId`, never a round number** — `roundNumber` resets per effort
   (`models/Pass.js`), so "R2" names a different round in every walk list. Blocks carry the walk-list
   name for exactly that reason.

**The two count units, and why neither is an invoice line.** `Address visits` is **EVENT-unit** (a
`$sum` over the field-visit set); `Rounds worked` is **DISTINCT-PASS-unit** (an `$addToSet` of
`passId` over the same set, the legacy `null` bucket counting as one). **Neither matches billing**,
which groups on `{householdId, passId}` — a door visited twice in one round is **2 visits and 1
billable door**. Neither matches `doors-by-round.csv`'s *Door visits this round* either, which is
per-round and applies no desk-mark guard. **Do not claim these files reconcile**; `doors-by-round`
remains the invoice-grade per-door file.

**The answer blocks** — ONE BLOCK PER (survey template, pass) PAIR THAT ACTUALLY OCCURS IN SCOPE,
discovered by a `$group` on `{surveyTemplateId, passId}`. Not a template × round cross product: a
voter can hold at most ONE response per pass (`{voterId, passId}` is unique and DB-enforced), so a
cross product would be mostly columns no row can fill — and blank reads as "not surveyed". A block is
a `Survey` label cell (reading `Door Survey (desk entered)` when an admin typed the answers) + one
column per question + optionally a `Note` cell. `orderAnswerBlocks` sorts walk list, then round, with
the legacy null-pass bucket LAST — NOT `pass.activatedAt`, which the archive path never sets and which
interleaves walk lists. Blocks are prefixed `North Side R1 — ` only when more than one is in scope,
and the prefix names the walk list because round numbers reset; duplicate labels are uniquified with
the template name, because two efforts may legitimately share a name (`Effort` has no unique name
index) and two templates can occur in one pass if the survey was switched mid-round.

**A chip outside the field-visit set is REFUSED, not intersected.** `validateParams` throws
`ExportUserError` naming the chip ("This export lists the people at doors that were visited, so it
cannot be narrowed to note_added."); silently intersecting to nothing would hand back an empty file
for a plausible-looking request. The web page drops `note_added` from this type's chip row for the
same reason, and `paramsForCreate` narrows `actionTypes` to the chips the CURRENT type offers, since
nothing resets that state when the type changes.

**What it cannot say**, stated here because the row count invites the question: a field-visited door
with NO registered voters, and one whose whole roster is do-not-contact, both produce ZERO rows and
are **indistinguishable by design** (that is `exportScope.js`'s no-marker rule, and making them
distinguishable would BE the marker). So the row count is NOT "the doors you worked" —
`doors-by-round` is the file that accounts for every door. Unknock and pass-discard **hard-delete**
ledger rows, which is why the universe is doors with a *surviving* visit. Overwritten answers live in
`SurveyResponseArchive` and a same-user re-submit archives nothing, so the live response is the
answer of record.

**Owner ruling 2026-09-23 — lead-visible is CLIENT-visible.** This type is lead-visible, and a lead
may use the contact/demographic and survey-note opt-ins exactly as an admin can. In the owner's
words: *"its okay for the lead to be able to export just like an admin. leads could be clients that
just wont have access to the org but will have access to a campaign they are paying for through the
org thats running the canvassing."* So "can a lead export this" is the same question as "is this fit
to hand the customer" — and it is why both opt-ins are frozen into `ExportJob.params` and surfaced in
the history's Scope column. Recorded in [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) v6.

**The shared field-visit predicate.** `fieldVisitMatch`, `NOT_DESK_MARK` and
`fieldVisitActionTypes` now live in
[`services/reports/aggregations.js`](../server/src/services/reports/aggregations.js) beside
`BILLABLE_WITH_RESTRICTED`; `services/billing/statement.js` imports rather than owns it, because a
second copy would be a second definition of when a customer starts being charged.
`test/fieldVisitPredicate.test.js` pins the shared version against the exact filter billing has
always run. **The anti-spread rule:** `fieldVisitMatch` and a caller's outcome chips BOTH own the
`actionType` key, so composing them by spread silently drops one of them — either the chips vanish or
the billing set does and `note_added` becomes a visit. **Intersect instead**, through
`fieldVisitActionTypes(chips)`, and treat its `null` return as **ZERO ROWS, never "no filter"**: a
caller that reads `null` as absent inverts its own filter. `NOT_DESK_MARK` owns the `$nor` key the
same way — spread it into a filter that has its own `$nor` and one of them disappears; put it in
`$and`, or give it its own `$match` stage as `knocksPipeline` does.

**Door status from an aggregation.** `resolveStatusFromSummary(campaignType, summary)` and
`STATUS_ROW_MATCH` in
[`utils/statusPrecedence.js`](../server/src/utils/statusPrecedence.js) exist because a per-door
`$group` cannot ship whole rows and the two obvious ways out are both wrong. Handing the grouped document to `resolveStatus` returns **`'unknocked'` for every door**, surveyed ones
included — it reads `actionType`/`timestamp` off each ELEMENT, and a grouped document has neither. The
*other* near-miss is subtler, and is why the field name is mapped inside the pipeline: give
`resolveStatusFromSummary` a shape without `latestActionType` and it answers `'unknocked'` only on
**non-completion** doors, because a surveyed door still resolves off `actions` — a legal-looking constant
that hides on exactly the doors you would check first. And `$push`-ing the
real rows back re-imports `resolveStatus`'s array-order tie-break at equal instants (strict `>`),
which a composite `$max: {at, action}` does not have. So the pipeline ships `actions` (an
`$addToSet` over `STATUS_ROW_MATCH` rows) plus `latestActionType`, mapped off the composite **in the
pipeline** rather than at the call site, so that field name cannot be hand-copied wrong again.
Labels come from `DOOR_STATUS_LABELS` (8 keys, the `Household.status` domain), pinned by
`test/actionLabels.test.js` against `Household`'s own enum and, wording for wording, against the web
`STATUS_LABELS` — a SUBSET comparison, never `deepStrictEqual`: the web map carries three more keys
(`voted` / `dnc` / `doNotKnock`) that are VOTER facts, not door statuses. The aggregation runs with
NO `$sort`, because there is no `{campaignId, householdId, timestamp}` index and sorting makes the
planner drop the `householdId` bound.

## The shared answer-column factory

[`services/export/surveyColumns.js`](../server/src/services/export/surveyColumns.js) —
`templateAnswerPlan(template, orphanEntries)` and `snapshotAnswerText`, lifted out of
`buildSurveyResultsWide` and now spent by **three** surfaces: survey-results, `results-by-voter`'s
blocks, and `canvass-activity`'s answer layer. It returns `{cols, columnOf, renderAnswer,
templateName}`: current questions in template order then orphan keys (hard-deleted questions,
labelled from their snapshot and discovered by the CALLER, which owns the response query they come
from), the `Label (key)`-on-duplicates base name, and the id-native renderer with the recorded
snapshot as fallback — including the seeded `__other__` sentinel that makes a write-in read
`Other — potholes` instead of colliding with a canonical option of the same wording. Callers that
group columns further (by round, by survey) **decorate** `columnOf`; they must never re-implement it,
or one file's header stops matching another's.

**It is a FACTORY, and that is load-bearing rather than tidy.** Option ids are unique only WITHIN a
question and question keys only WITHIN a template — and `POST /admin/surveys/:id/duplicate` clones
both verbatim — so a single module-level `${key}:${optionId}` map shared across templates would
resolve one survey's option TEXT into another survey's file, silently, in an already-shipped export.
Per-template state makes that impossible instead of documented; `test/surveyColumns.test.js` ends on
exactly that case.

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
overlays label/desc and decides visibility when present. The narrowing filters render inline for

every type; a type whose `filters` carry an *options* token (`OPTION_TOKENS` = `outcome`,
`perVoterRows`, `surveyAnswers` — canvass-activity carries all three, `results-by-voter` carries
`outcome`) gets an **options dialog** instead of queueing straight from **Queue export**:
the NotesPage export-dialog pattern, carrying the outcome chips, the per-voter checkbox and the
survey-answers checkbox, with the dialog's own Queue button doing the POST. `voterDetail` and
`surveyNote` are NOT options tokens — they render inline, beside the pickers, as the survey types'
detail toggle always has. Mobile:
[`admin/exports.jsx`](../mobile/app/(app)/admin/exports.jsx) — tapping one of the four everyday
types opens [`components/ExportSheet.jsx`](../mobile/components/ExportSheet.jsx) (MetricSheet's
Modal anatomy): description, "one row is…", contents, the web's filters for that type, and a
live `POST /estimate` count (debounced on the serialized params, `keepPreviousData`, advisory —
an estimate error never blocks Queue, so either deploy order works). Two of the sheet's switches move that count, both Canvassing activity only and both ROW options
that ride `paramsFor` onto the estimate wire: **Rows** (`perVoterRows`), which also rewrites the
"one row is…" line while on, and **Survey answers** (`includeSurveyAnswers`). A `rowsAreFloor`
answer renders as "at least N rows", and the count is gated on `prefsLoaded` so it is never
computed for a remembered state the sheet is about to replace.
Type copy comes from
[`lib/exportTypes.js`](../mobile/lib/exportTypes.js) (local fallback, server registry overlaid).
History rows: failed/expired taps offer Retry (re-POST of the frozen params) and Delete;
long-press deletes any non-running row; a worker-offline banner mirrors the web's.
[`lib/artifactDownload.js`](../mobile/lib/artifactDownload.js) downloads TO DISK
(`FileSystem.downloadAsync` — binary-safe for ZIPs, memory-flat) then opens the share sheet.

**Six** types stay web-only to QUEUE (owner scope decision): Survey answers (detailed), Filtered
voters, Voter profile notes, **Notes**, **Results by voter**, and the full-backup ZIP. Notes is the
one with another way in on the phone: the admin **Notes** screen queues it directly, carrying the
filters on screen, so the sheet does not need to grow a fifth type. Web-only to queue is not
invisible on the phone, though: `admin/exports.jsx`'s `TYPE_LABEL` must carry **every** key in
`EXPORT_TYPE_KEYS`, because the history list renders every job the org has and a missing key shows a
raw slug. (`mergeTypeMeta` ignores server types it has no card for, which is why the tenth type
needed no other mobile edit.)

**The one remembered option.** `includeSurveyAnswers` is remembered per campaign — web
[`lib/exportOptions.js`](../client/src/lib/exportOptions.js) on `localStorage` (every accessor
wrapped, so a private window or blocked site data degrades to the defaults rather than breaking the
page), mobile `saveExportOptions`/`loadExportOptions` in
[`lib/cache.js`](../mobile/lib/cache.js) on AsyncStorage, one campaign-keyed record. **Nothing else
is**: `perVoterRows` multiplies rows, and `includeVoterDetail` and `includeSurveyNote` each widen what
leaves the building, so each stays a fresh decision. It persists **only on a successful queue from
the page's / the sheet's own path, never from the mutation's `onSuccess`** — `retryJob` re-POSTs an
old job's frozen params through the SAME mutation, so persisting there would quietly adopt a
months-old choice as the default. The memory is a convenience; the frozen `ExportJob.params` and the
history's Scope column remain the record — which is what makes it acceptable that two admins queueing
"the same" export can get different files. Mobile gates the live estimate on `prefsLoaded`, so the
count is never computed for a state the sheet is about to replace; the web page re-seeds on a
`campaignId` change, because it does not remount on a route-param change.

## Tests

`test/exportCsv.test.js` (writer unit), `test/exports.int.test.js` (lifecycle, scoping, expiry,
sweeper placement, cascades; the estimate route's scope/400/throttle-independence matrix; the
types route's role filtering), `test/exportBuilders.int.test.js` (per-type columns/semantics +
the registry-driven DNC sweep — ZIPs run `EXPORT_ZIP_LEVEL=0` so artifacts stay greppable; the
registry-driven **estimate==build** loop, filtered-parity cases, the survey-answers `$size`
pin, the canvass-activity orphan counter, and the `perVoterRows` fan — the registry DNC sweep
runs canvass-activity a second time with the option on as the keyed artifact
`canvass-activity:fanned`; the fixture's h2 two-voter, h5 all-flagged and h6 voter-less doors pin
the repeat/fallback/no-marker rules; header and download-name parity; estimate parity under five
param sets; and the timed-out pipeline's floor via a stubbed `aggregate`),
`client/src/lib/exportsRender.smoke.test.js` (renderToString of the real Exports page — with
canvass-activity selected the outcome chips and the per-voter checkbox are NOT inline, they belong to
the Queue-export dialog; SSR cannot click, so the open dialog is compiled, not rendered),
`test/billing.int.test.js` (carve-out matrix ×2:
create and estimate pass read-only, export-DELETE still 402),
`test/accessLogCoverage.int.test.js` (the new URL shapes — including `/estimate` and `/types` —
must log), `test/orgDelete.int.test.js` (bucket emptiness after org delete).

Four unit suites arrived with these two features, all `node --test` and none needing Mongo:
`test/fieldVisitPredicate.test.js` (the shared visit predicate is still byte-for-byte the filter
billing has always run; a field `restricted` counts, a desk mark does not, `note_added` never does;
and `fieldVisitActionTypes` returns `null` — not `[]` — on an empty intersection),
`test/resolveStatusSummary.test.js` (the aggregation-shaped ladder agrees with `resolveStatus` for
every row set with distinct instants, and deliberately does NOT at a tie, where it resolves on
`actionType` and answers the same way whatever order the scan returned),
`test/surveyColumns.test.js` (column order, orphan keys, `Label (key)` duplicates, the write-in
sentinel, and the cross-template collision that is the whole reason the plan is a factory), and
`client/src/lib/exportOptions.test.js` (defaults, per-campaign scoping, a throwing `localStorage`).
`test/actionLabels.test.js` gained the door-status label gate described above.
`test/exportBuilders.int.test.js` gained five `results-by-voter` cases (the row set plus the two
absences that are documented limits; answers grouped by ROUND with a retired option still resolving
to its current text; the opt-in note and the shared detail block; the chips narrowing doors while the
outcome column does not move; and the refused chip) and FIVE answer-layer cases: columns on the covering rows, the added uncovered-response row, the KEPT dangling
response, `orphanedRows === 2`, a chronological merge across both ledgers and estimate==build including the
second `dncWithheld` term; a flagged voter's knock row keeping the row while losing the answers AND the note,
with no marker of any kind; the chips gating the whole layer while a canvasser filter never manufactures rows;
both row options composing, with all four `activityFileNames` distinct; and the full backup staying un-layered
by construction. `test/exports.int.test.js` pins the tenth type's tokens, its `adminOnly: false`
and `estimate: true`, and the new `surveyAnswers` token on canvass-activity — that pinned token list
is the anti-drift gate and is *supposed* to fail the moment a token is added.

## The hours-stamp rule (standing)

**Any frozen artifact that carries an hours or per-hour figure must say inside the file when those
hours were true and where they came from** — a visible `hours as of <generatedAt>` and a per-row
hours source. Live surfaces always re-derive; a generated file deliberately stops moving, and with
the FbTime integration ([FBTIME_INTEGRATION.md](FBTIME_INTEGRATION.md)) an hours figure can now
change retroactively (a shift edited or deleted after the file was made). A stamp only on the row
that produced the file leaves whoever opens it in six months holding a number with no provenance.

Today exactly ONE artifact carries hours — the legacy leaderboard CSV,
`GET /admin/reports/canvassers.csv` (not an Export Center type). It opens with two preamble rows
(`Canvasser export, <range>, hours as of <ISO>`, plus `Crew: <name>` when a crew filter was
applied, then a blank line) before the header, and ends every row with an `Hours source` column
(`Measured`/`Estimated`/`Mixed` — always present, so the file shape is constant whether or not an
org connected FbTime). Import scripts that assumed row 1 was the header must skip three rows.

**Scope belongs in the stamp too.** The route honors `?coordinatorId` — the same crew filter
`GET /canvassers` takes — and names the crew in the preamble, because one crew's rows and a whole
campaign's look identical once the file is on someone's desktop. It did **not** honor it until
2026-08-14: the Timeline's crew filter scoped the table server-side while the export silently
returned everyone, so a crew-filtered download disagreed with the table it came from. Any future
export that sits under a filtered table inherits this rule — **the download must carry every
filter the table carries, or say on its face that it didn't.**

Downloadable from the **web** Timeline and the **mobile** admin Timeline; both send the campaign,
walk list, crew and range currently on screen. No Export Center type, statement, or client report carries
hours; if one ever grows an hours column, it inherits this rule.

## Appendix — column contracts (per type)

The header arrays in `exportBuilders.js` are the source of truth; this is the readable copy.

Voter identity in the six voter-bearing CSVs is always the pair **`State voter ID`, `UID`**
(sentence case — the voter files use the title-case canonical labels `State Voter ID` / `UID`
from `canonicalFields.js`; the two spellings coexist deliberately, matching each file's
neighbors). Every new identity cell must derive from the DNC-guarded voter object, never from
the event document — that guard is what blanks a do-not-contact person's row.

- **`activity-log.csv`** — Timestamp (ISO), Date, Time (tz), Action; Address block (line 1/2,
  City, State, Zip, County); **State voter ID, UID**, Voter first/last name, Party (filled only
  when the event named a voter; blanked for DNC); Canvasser first/last/status, Team; Walk list,
  Pass, Pass name, Via (field|bulk), Offline submission; Latitude, Longitude, GPS accuracy (m),
  Distance from house (m); Replaces earlier action, Replaced at (ISO), Note; Household DB id,
  Voter DB id, Activity DB id. **`activity-log-by-voter.csv`** (`perVoterRows`) — the SAME 34
  columns in the same order; each voter-less event repeats once per kept voter at its door with
  the five identity cells and Voter DB id filled from the door ROSTER (never from the event), so
  **Activity DB id is no longer unique per row** — it is the dedupe key back to events.
  **`activity-log-with-surveys.csv`** / **`activity-log-by-voter-with-surveys.csv`**
  (`includeSurveyAnswers`; all four names come from `activityFileNames`) — the same columns, then
  after **Note**: Row source (`knock`|`survey`), Survey, Survey version, Survey submitted (ISO),
  Survey taken by, Desk entered, one column per question (the union across templates in scope,
  prefixed `<survey name> — ` when more than one), and **Response DB id** last of all, after the
  three DB ids. Every row is the same width whether or not a survey is attached to it. A
  `Row source: survey` row has a **blank Activity DB id** and is NOT a knock; on it Via reads
  `field` and the two Replaces columns are blank. For a do-not-contact voter, a knock row blanks the
  answers **and the Note** along with the identity; a survey-source row is dropped whole.
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
- **`results-by-voter.csv`** — **State voter ID, UID**, Voter first/last name, Party; *[with
  `includeVoterDetail`: Gender, Date of birth, Phone, Phone type, Cell phone]*; Address, Address line
  2, City, State, Zip; *[with `includeVoterDetail`: County, Latitude, Longitude, Precinct,
  Congressional district, State senate district, State house district — the same `detailPlan`, the
  same two positions]*; **Address outcome** (plain English via `DOOR_STATUS_LABELS`, this type only),
  Address visits, Rounds worked, Address first visited (tz), Address last visited (tz), Last visited
  by first/last/status; **Surveys taken**; then one BLOCK per (template, pass) pair occurring in
  scope — Survey, one column per question, *[with `includeSurveyNote`: Note]* — prefixed
  `North Side R1 — ` only when more than one block is in scope; Household DB id, Voter DB id. Two
  departures from the Center's dialect, both deliberate: the outcome is WORDS rather than a slug, and
  the two visited columns are a **local date in the anchor tz** rather than the usual `X (ISO)` +
  `Date` + `Time` triple — this is the file built to be read, and "when was this house worked" wants a
  day. Rows are sorted `{lastName, firstName}` across the whole file. `Surveys taken` is the response
  unit from [METRICS.md](METRICS.md), counting only responses in scope; `Address visits` is
  event-unit and `Rounds worked` distinct-pass-unit, and neither is an invoice line (see the four
  definitions above).
- **`voterfile-current.csv` / `voters-filtered.csv`** — every `CANONICAL_FIELDS` label (State
  Voter ID, First Name, Last Name, UID, Phone, …, County, Latitude, Longitude) + Household DB
  id, Voter DB id. **`voterfile-import.csv`** — the import's own vendor headers in canonical
  order (duplicates collapse first-wins) + the two DB ids.
- **`voter-notes.csv`** (the *Voter profile notes* type) — Created (ISO)/Date/Time; **State voter
  ID, UID**, Voter first/last name; Address, City, State, Zip; Author first/last/status; Edited,
  Edited at (ISO), Note; Voter DB id, Note DB id.
- **`notes.csv`** — Created (ISO)/Date/Time; Source (Door/Survey/Admin), Outcome; **State voter
  ID, UID**, Voter first/last name; Address, City, State, Zip; Author first/last/status; Desk
  entered, Desk entered by; Walk list, Pass, Pass name; Edited, Edited at (ISO), Note;
  *[with `includeDoorVoters`: Voters at this door, Voter count at this door]*; Household DB id,
  Voter DB id, Note DB id. **Author vs Desk entered by:** on a desk-converted survey the note was
  typed by an admin while the row's `userId` is still the field canvasser, so Author alone would
  name the wrong person — the two columns are read together.
- **`knocks-by-round.csv`** (backup only) — Walk list, Pass, Pass name, Pass status,
  Activated/Archived (ISO); Knocks, Survey doors, **Surveys taken**, Lit knocks, Refused;
  [Restricted doors, Billable doors when restricted billing is on]; Connection rate %,
  Contact rate %, New homes reached; TOTAL row. `Surveys taken` is the response unit and sits
  beside the door unit deliberately — the two are read together, and only the DOOR column feeds
  the rates. Column order matches `/admin/reports/knocks-by-pass.csv` exactly.
