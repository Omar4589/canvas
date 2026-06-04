# Voter imports & Intake

What happens when you upload voters — how rows match existing doors/voters, what goes live
immediately, and how new doors reach the field through **Intake**.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): the upsert keys, normalization,
  the preview/diff, and the `isActive` lifecycle.

Related: [EFFORTS.md](EFFORTS.md) (Intake → assign to an effort), [WALKLISTS.md](WALKLISTS.md) (turn a
Voter-ID CSV into a walk list without re-importing the universe), [VOTERS.md](VOTERS.md).

---

# Part 1 — For everyone

## How an upload is matched

- A row is matched to a **household by its address** (after light normalization: trim + uppercase,
  5-digit zip). A different/misspelled address makes a **separate** household; it does **not** merge.
- A row is matched to a **voter by their state Voter ID** (org-wide). Re-uploading the same voter
  updates their info in place.

## Preview before you import

Picking a file no longer applies it straight away. After you map the columns, click **Preview changes**
to see exactly what the import will do — **new vs existing doors**, **new vs updated voters**, **voters
that would change doors** (re-housing), **near-duplicate addresses** (formatting drift that won't merge),
**doors that would be emptied**, and any **skipped rows** (missing fields / bad coordinates / duplicate
Voter IDs). Review it, then **Confirm & import** to apply (or **Back** to fix the mapping). Each finished
import also records how many voters moved doors and how many doors were emptied, in the history table.

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

Still open (not built): reopening an already-knocked door when a new voter is added there.

## E. Operations — the import worker

Imports (and turf cuts) run in a **separate `worker` dyno** ([Procfile](../Procfile)
`worker: npm --prefix server run worker` → [worker.js](../server/src/worker.js)), not the web dyno. If
that dyno is scaled to 0, the web app still **enqueues** jobs but nothing **consumes** them — they sit in
BullMQ **"waiting"** forever. `GET /admin/imports/worker-status`
([routes/admin/imports.js](../server/src/routes/admin/imports.js)) reports whether a worker is consuming
the queue (`queue.getWorkers()` + job counts) and drives an **"import worker offline" banner** on the
Import page, so a stopped worker is obvious instead of a silent stuck "pending". Keep the `worker` dyno
on (a Basic, always-on dyno) so imports always process.
