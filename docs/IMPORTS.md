# Voter imports & Intake

What happens when you upload voters (CSV **or** Excel) — how rows match existing doors/voters,
what goes live immediately, how coordinate-less and multi-voter-per-row files are handled, how
voters are linked to canonical People across orgs, and how new doors reach the field through
**Intake**.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): the upsert keys, normalization,
  the preview/diff, smart-import parsing, geocoding, the shared-voter-DB linking, and the
  `isActive` lifecycle.

Related: [PERSONS.md](PERSONS.md) (the canonical cross-org People the import links to),
[EFFORTS.md](EFFORTS.md) (Intake → assign to an effort), [WALKLISTS.md](WALKLISTS.md) (turn a
Voter-ID CSV into a walk list without re-importing the universe), [VOTERS.md](VOTERS.md).

---

# Part 1 — For everyone

## Where to find it

Voter Import lives **inside a campaign**: open a campaign from the Campaigns launchpad, then pick
**Voter Import** in the campaign sidebar. There's no campaign dropdown on the page anymore — the
campaign you drilled into is the target, shown read-only at the top, and the **Recent imports**
history below only lists that campaign's imports.

## How an upload is matched

- A row is matched to a **household by its address** (after light normalization: trim + uppercase,
  5-digit zip). A different/misspelled address makes a **separate** household; it does **not** merge.
- A row is matched to a **voter by their state Voter ID** (org-wide). Re-uploading the same voter
  updates their info in place.

## Any vendor file — CSV or Excel

You can upload **`.csv` or `.xlsx`** directly. Some vendors pack **multiple voters into one row**
(e.g. `FLVoterId1..4`); the importer **detects** this and offers an **"Explode multi-member
rows"** toggle (on by default) that splits each row into one voter per person — the preview
counts update live. It also warns about **leading-zero risk** (IDs/zips stored as numbers) and
**Excel date serials**, and surfaces a **vendor** field on the mapping step so files with a
universal person ID (a "uid") are matched across orgs (see *Shared voter database* below).

## Coordinate-less files (geocoding)

If a file has **no latitude/longitude**, geocoding (when enabled) turns each address into a pin
so the file can still import — just **leave the Latitude/Longitude columns unmapped** (they're
optional; the mapping step no longer requires a coordinate column). The preview shows a **free
forecast** (how many addresses need
geocoding, how many are already cached, and an estimated cost), plus an opt-in **"See exact
placement"** button that runs the real geocode (cost shown first) and reports exactly what can
and can't be placed. On import, unplaceable addresses are dropped (and listed) so every imported
door keeps a walkable pin.

## Shared voter database

Every upload also **links its voters to canonical People** — one record per real human, shared
across organizations. The preview forecasts it: *"links to N existing people · adds K new
people."* For a single-org customer the first import is all new; once another org imports the
same voters they show up as existing-person matches. Full details: [PERSONS.md](PERSONS.md).

## Preview before you import

Picking a file no longer applies it straight away. After you map the columns, click **Preview changes**
to see exactly what the import will do — **new vs existing doors**, **new vs updated voters**, **voters
that would change doors** (re-housing), **near-duplicate addresses** (formatting drift that won't merge),
**doors that would be emptied**, and any **skipped rows** (missing fields / bad coordinates / duplicate
Voter IDs). Review it, then **Confirm & import** to apply (or **Back** to fix the mapping). Each finished
import also records how many voters moved doors and how many doors were emptied, in the history table.

## File size & large files

Uploads are capped at **50 MB** (roughly 150k–250k voter rows). Picking a bigger file is blocked up
front with a "split it" message — and since imports are **additive and idempotent** (re-uploading rows
just refreshes them), splitting a very large file by region/county and uploading each piece produces the
**same end result**. When you pick a file the page shows its size and an estimated row count.

Most files preview in a second or two. A **large file** (≥ ~15 MB) is analyzed in the **background** so
it can't hit the request timeout — you'll see "Analyzing in the background…" and the diff appears when
it's ready. That background preview, like the actual import, needs the **import worker** running (the
worker-offline banner will warn you if it isn't).

## Undo an import

Uploaded the wrong file? Each completed import has an **Undo** button in the history. Undo removes the
**net-new doors and voters that import added** — but only ones still **untouched**: it **skips** (and
reports) anything already **claimed into an effort, cut into a book, canvassed, surveyed, or marked
voted**, plus any new door that now shares its address with other voters. It does **not** revert *updates*
to people who already existed (a re-housing, or a refreshed phone/party) — the **preview** is the guard
for those. So the clean case ("wrong file, nothing worked yet") fully reverses; once doors are claimed or
knocked, those are kept and you're told how many.

## What goes live, and what waits in Intake

Where a voter ends up depends on the door:

- **New voter at a door an effort already owns** → joins that door immediately (the door is already
  cut and assigned). It also appears so it isn't missed.
- **New voter at a new address** → the door lands in **Intake** (owned by no effort) and is **not
  canvassed** until you assign it to an effort (Efforts page → open an effort → *Claim*). This is the
  deliberate control point for new doors.

## Things to watch (today's behavior)

- **Voters that change doors are now surfaced.** If the same Voter ID is uploaded with a different
  address, that voter moves to the new door — the **preview shows it** before you confirm, and the old
  door, if it ends up with nobody, is **deactivated** (it drops off the field instead of lingering as a
  phantom door).
- **Near-duplicate addresses are flagged, not merged.** "123 N Main St" vs "123 North Main Street" stay
  two doors; the preview lists the pairs so you can fix the file first if you want.
- **A new voter at an already-knocked door doesn't re-open it.** The door keeps its status, so a
  canvasser won't be sent back automatically.
- **Bad/odd addresses aren't validated** beyond requiring coordinates; a coordinate-less row is skipped
  (the preview counts it under *Rows skipped*).

---

# Part 2 — Technical reference

Import pipeline: [services/import/csvImporter.js](../server/src/services/import/csvImporter.js),
[services/import/importProcessor.js](../server/src/services/import/importProcessor.js),
[utils/normalizeAddress.js](../server/src/utils/normalizeAddress.js).

## A. Matching keys

| Entity | Key | Behavior |
|---|---|---|
| `Household` | unique `{campaignId, normalizedAddress}` | Upsert: address/location fields `$set`; `status`/`isActive` only `$setOnInsert`. **Never sets `effortId`** → new doors stay `null` (Intake); existing doors keep their owner. **Never touches `turfId`/`status`** → a new voter at an owned door rides the existing book. |
| `Voter` | unique `{organizationId, stateVoterId}` | Upsert `$set: {...row, householdId}` → re-import with a new address **moves** the voter's household. The move is **surfaced in the preview** and **audited** on the `ImportJob` (`movedVoters`); a source door emptied by moves is **deactivated** (`isActive:false`, counted as `deactivatedDoors`). |

`normalizeAddress` = `[addr1, addr2, city, state, zip5]` upper-trimmed and joined with `|` — exact
match only (no fuzzy / "St" vs "Street"). `looseAddressKey` (same file) is a fuzzier key — expands
ST→STREET, N→NORTH, etc. — used **only** for the preview's near-duplicate detection, never for the upsert.

**`isActive` lifecycle.** A door starts active. After an import,
[`recomputeHouseholdActive`](../server/src/services/import/recomputeHouseholdActive.js) (over the
households the import touched) sets `isActive:false` on any door now at **0 voters** and back to `true`
on any previously-emptied door that gets a voter again — so emptied doors stop showing up as phantom
doors (every door-pool query already filters `isActive`).

## B. Intake is automatic

`Household.effortId` defaults to `null` and the upsert never writes it, so **new-address doors are in
Intake by construction** — no import-processor change was needed. They become canvassable only once an
effort claims them (`POST .../efforts/:id/claim`, then a supplemental cut). See [EFFORTS.md](EFFORTS.md) §B.

Separately, an uploaded **Voter-ID CSV** can be turned directly into a walk list (matched by
`stateVoterId`, no universe re-import) and used to seed/claim an effort — handy when you already have an
exact list of people. IDs not already in the universe simply won't match; import them first. See
[WALKLISTS.md](WALKLISTS.md).

## C. Coverage / cut visibility

Cuts and `/doors` require `location.coordinates`; coordinate-less households persist but are excluded.
"New voters since last cut" for an effort = voters whose `createdAt` is after the effort's active
round was cut, on doors the effort owns (derive; no extra field).

## D. Preview & confirm (the import diff)

The page ([client/src/pages/ImportPage.jsx](../client/src/pages/ImportPage.jsx)) is a **campaign
drill-in screen** at `/campaigns/:campaignId/import`; it reads `campaignId` from `useParams()` (no
in-page picker — the target campaign is shown read-only and posted on every mutation). The
**Recent imports** history is campaign-scoped via `GET /admin/imports?campaignId=<id>` (the server
already supported the filter), so the old redundant "Campaign" column is gone. **View on map** on a
completed import navigates to `/campaigns/:campaignId/map?importId=<job>` to show that import's
homes on the campaign map. The old flat `/import` route redirects.

The web flow is **map → preview → confirm**. `POST /admin/imports/csv/preview`
([routes/admin/imports.js](../server/src/routes/admin/imports.js)) parses the file (`parseAndValidate`,
no writes) and runs [`computeImportDiff`](../server/src/services/import/computeImportDiff.js), returning
`{ totals, rowIssues, samples }`: new/existing doors, new/updated voters, moved voters, orphaned doors,
near-duplicates, and skipped-row counts (capped sample lists). It is **read-only**; **apply is the
unchanged `POST /csv`** (parse → `applyImport` upsert → the worker's post-apply step).

- **Orphan definition:** a source door is "emptied" iff **every** current voter appears in the file and
  **all** of them map to a different address (`movingOut === currentVoterCount`, and no file row maps
  back to it). A voter absent from the file keeps its door alive.
- **Near-duplicate** is advisory only — the loose key never affects the upsert (still exact
  `normalizeAddress`) and never auto-merges.
- **On apply**, `importProcessor` captures each incoming voter's prior household, then after `applyImport`
  runs `recomputeHouseholdActive` over the touched (source ∪ destination) households and stamps
  `movedVoters`/`deactivatedDoors` onto the `ImportJob` (shown in the Recent-imports history).
- **Forecast vs. actual:** the preview is a forecast against current data; the apply re-parses the same
  file and computes the authoritative counts. The CLI `runImport` path skips the worker's post-apply
  step (no deactivation), same as it skips the other post-apply recomputes.
- **Sync vs. async preview:** the synchronous `POST /csv/preview` parses + diffs in the request — fine
  for city-sized files but at risk of the platform's 30s request timeout on very large files. So the
  client routes files **≥ 15 MB** to `POST /csv/preview-enqueue`, which stashes the file
  (`saveRawImport`) and queues an `ImportJob` with **`kind: 'preview'`** on the same import queue. The
  worker branch in [importProcessor.js](../server/src/services/import/importProcessor.js) runs
  `parseAndValidate` + `computeImportDiff`, stores the result on `ImportJob.diff`, and deletes the raw
  file (no `applyImport`). The page polls `GET /admin/imports/:id` for `job.diff`. Preview jobs are
  excluded from the Recent-imports list (`kind: { $ne: 'preview' }`).
- **Size cap:** Multer rejects files over **50 MB**; a `uploadCsv` wrapper maps that to a friendly
  **413** (`code: 'file-too-large'`) instead of a generic 500, and the client also blocks oversized
  files before upload.

Still open (not built): reopening an already-knocked door when a new voter is added there; streaming the
upload to disk + a sampled preview if single files ever need to exceed 50 MB.

## E. Operations — the import worker

Imports (and turf cuts) run in a **separate `worker` dyno** ([Procfile](../Procfile)
`worker: npm --prefix server run worker` → [worker.js](../server/src/worker.js)), not the web dyno. If
that dyno is scaled to 0, the web app still **enqueues** jobs but nothing **consumes** them — they sit in
BullMQ **"waiting"** forever. `GET /admin/imports/worker-status`
([routes/admin/imports.js](../server/src/routes/admin/imports.js)) reports whether a worker is consuming
the queue (`queue.getWorkers()` + job counts) and drives an **"import worker offline" banner** on the
Import page, so a stopped worker is obvious instead of a silent stuck "pending". Keep the `worker` dyno
on (a Basic, always-on dyno) so imports always process.

## F. Undo (`POST /admin/imports/:importId/undo`)

`applyImport` captures the docs it **inserted** (each `bulkWrite`'s `upsertedIds` →
`ImportJob.insertedHouseholdIds`/`insertedVoterIds`, persisted once in the worker — retry-safe, since an
idempotent retry inserts nothing). Undo
([services/import/undoImport.js](../server/src/services/import/undoImport.js)) deletes those that are
still untouched: a voter is **kept** if it has a `VotedVoter`/`SurveyResponse`/`CanvassActivity`; a
household is **kept** if `effortId`/`turfId` is set, `status != 'unknocked'`, `fullyVoted`, it has any
household-level activity/survey/voted, or it holds a voter not from this import. It deletes voters, then
the now-empty deletable households, then runs `recomputeHouseholdActive` over existing doors that lost a
voter. **Conservative — it only ever deletes net-new, untouched records and never reverts updates.**
Idempotent: `undone` blocks a second run. The result
(`doorsDeleted`/`doorsSkipped`/`votersDeleted`/`votersSkipped`) is stored on the `ImportJob` and shown in
the Recent-imports history. Undo also tears down any **Person** this import created that now has
**zero** linked voters (plus its candidate/proposal/log rows) — see [PERSONS.md](PERSONS.md) §H.

## G. Smart import — formats, explode & detection

One parse seam: `parseUpload(buffer, filename)`
([services/import/parseUpload.js](../server/src/services/import/parseUpload.js)) reads **CSV via
Papa** and **XLSX via exceljs** (formatted strings, so IDs keep leading zeros). `csvImporter.js`
splits **parse** (`buildImportRows`) from **validate**; the CSV path is byte-for-byte unchanged
after the split. Multi-member files are detected by **numbered siblings of the mapped
`stateVoterId` column** (`FLVoterId1..N`); only **voter-group** columns are suffix-substituted
per member (household columns stay shared, so `Address1/2/3` never mis-explode). The explode
decision persists on the `ImportJob` so the worker apply explodes identically to the preview.
Detection (`{ format, multiMember, warnings[] }`) flows through `computeImportDiff` to the
**"What we detected"** panel; warnings cover `leading_zero_risk` and `date_serial` (a bare
numeric date is converted from the Excel serial **only** when the column maps to a date field).

## H. Geocoding (when `GEOCODE_ENABLED`)

Provider: **Geocodio** (storable-without-contract licensing), keyed batch API on the public **v2**
endpoint (`api.geocod.io/v2/geocode`; override via `GEOCODIO_API_VERSION` — v1.9/v1.10 are
enterprise-only), cache-backed in `GeocodeCache` (org/campaign-agnostic, keyed on `looseAddressKey`). The validate gate is split:
*invalid* coords → always `bad_coords`; *missing* coords + enabled → survive to grouping with
null coords. `importProcessor` geocodes inline (per-batch cache writes), **fills matched
households + drops unplaceable ones (with their voters)**, and stamps `coordSource`/
`coordConfidence`. Safeguards: a per-state **bounding-box gate**, an `accuracy_type` + `accuracy`
confidence gate (centroids rejected), and a negative cache with staleness. The preview forecast
is **cache-only** (zero provider calls); the opt-in `POST /admin/imports/geocode-check` runs the
live geocode (cost-confirmed, worker-backed) and caches results so a later apply is free. Off ⇒
today's `bad_coords` behavior byte-for-byte. `GeocodeCache` indexes build at worker boot.

**Batching:** 1000 addresses/request with a 180s timeout by default (`GEOCODE_BATCH_SIZE` /
`GEOCODE_BATCH_TIMEOUT_MS`) — Geocodio's hard cap is 10000, but smaller batches stay within the
per-batch timeout, make retries cheap, and cache incrementally (the worker has no platform request
timeout). **Mapping:** `latitude`/`longitude` are `required: false` in
[canonicalFields.js](../server/src/services/import/canonicalFields.js), so a file with no
coordinate columns passes the mapping step and is geocoded (or skipped as `bad_coords` when
geocoding is off) per-row.

## I. Shared-voter-DB linking

`reconcileIdentityFromImport` runs **after geocoding, before `applyImport`**, stamping `personId`
(+ `uidSource`) onto each row so the upsert carries them; `computeImportDiff` adds a read-only
`persons` forecast (`existingPeople`/`newPeople`). The **vendor namespace** (`uidSource`) is
resolved at upload (inline or from the `ImportProfile`), stored on the `ImportJob`, and threaded
into matching. Full design — the canonical Person model, the ownership state machine, and
super-admin oversight — is in [PERSONS.md](PERSONS.md).
