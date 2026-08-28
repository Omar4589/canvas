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
Voter-ID CSV into a walk list without re-importing the universe), [VOTERS.md](VOTERS.md),
[EXPORTS.md](EXPORTS.md) (the Export Center can *reconstruct* a CSV under the vendor's columns —
it is not the original file, which is deleted after import).

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
- A row is matched to a **voter by their state Voter ID, within the campaign you're importing
  into**. Re-uploading the same voter into the same campaign updates their info in place.
- **Another campaign in your org already has this person?** Doesn't matter — this import creates
  **this campaign's own copy** of them (and of their door), and never touches the other
  campaign's. Two campaigns can import overlapping — even identical — files and each keeps its
  own voters, doors, and statuses. A person already marked **Do not contact** anywhere in the org
  arrives here already flagged.

## Rows are people; doors are addresses

A vendor file has **one row per voter**, and Doorline counts **doors** — so the number of doors an
import creates is always lower than the number of rows, often by a third. Nothing was lost; the rows
were folded onto their addresses:

- Several voters usually share an address, so several rows become **one door**. A file of about 2,900
  rows where most homes hold two registered voters is roughly 2,000 doors.
- **Each apartment unit is its own door** — "Apt 2" and "Apt 3" at one building are two doors (and one
  map pin, because vendors place every unit of a building at the same rooftop). A building is never
  counted as one door.
- A second file that overlaps the first **reuses** the doors it already created rather than making new
  ones. Vendors often split one precinct into two files by target (say a "strong" file and a "swing"
  file); a home with one voter in each file is **one** door, created by the first file and simply
  re-used by the second.
- A row is **skipped** only for a missing required field (first name, last name, Voter ID, address,
  city, state, zip), a Voter ID that is a spreadsheet error value, coordinates that aren't valid
  numbers, or a Voter ID repeated inside the file. Skipped rows show under **Errors** in the history
  table, and the preview lists each one with its reason. A skipped row costs a **voter**, not a door,
  unless it was the only voter at that address.

Reading the **Recent imports** table: **Voters** is how many rows imported; **Households** is how many
distinct addresses those rows live at; **New** is how many of each were created by *this* file (lower
than Households when an earlier file already had some of the addresses); **Moved / Emptied** is voters
who changed address and doors left with no voters; **Errors** is skipped rows.

**A worked example.** A client sent six files for three precincts — a "strong" and a "swing" file per
precinct — and said they held 2,898 doors. The files had 2,898 rows, i.e. 2,898 voters (their vendor's
household id was unique per row, so it was a person key, not a household key). Those voters live at
**2,055 distinct addresses** — the doors Doorline reported — in **1,677 buildings** (43 apartment
buildings hold 421 of the doors; the rest are single homes). Each swing file shared 98 to 143 addresses
with its precinct's strong file, which is why its **New** was lower than its **Households**. Exactly one
row was skipped, for a blank first name, and its address survived through another resident. The client's
count and the app's count were both right — they counted different things. To reconcile a vendor's
number, ask whether it counts **rows**, **addresses**, or **rooftops**; only the middle one is a door.

**Some files run the other way — more people than rows.** A few vendors pack a whole household into
each row (`FLVoterId` plus `FLVoterId2..4`, `FirstName1..4`, and so on — Florida's export does this).
The importer detects these by the **voter-ID column having numbered siblings** — the number can sit
anywhere in the name (`FirstName2`, `Voter2_ID`, `ID_2`) and capitalization doesn't matter — and
offers the **"Explode multi-member rows"** toggle (on by default), splitting each row into one voter
per person, up to 20 per row. Facts about the **address** fill down from the first voter to the
others at the door when the file states them only once per row: precinct and the congressional /
state senate / state house districts — everyone at a door is in the same district by definition.
Facts about the **person** never fill down — a second voter whose party or gender the file doesn't
state simply has none, rather than inheriting the first voter's. And when a file *looks* multi-voter
but the importer can't read the shape, the preview shows a **red warning** instead of quietly
importing one voter per row: either the column naming isn't one the importer recognizes (rename the
extra columns to end in 2, 3, … — `FirstName2`, `StateVoterID2` — and re-upload), or the file has no
voter-ID column per person (ask the vendor for one; every imported voter needs their own state Voter
ID, so those extra people can't import at all until it exists). The warning never blocks the import —
a file you know really is one voter per row can proceed.

## Any vendor file — CSV, Excel, or a delimited text export

You can upload **`.csv`, `.xlsx`, or any delimited text export** (`.txt`, `.tsv`) directly. The
delimiter — comma, tab, pipe, semicolon — is **detected for you**, and commas sitting *inside* a
field don't confuse a tab-separated file.

**About `.xls`.** Two completely different things arrive with that extension, and the app tells them
apart by reading the file's **contents**, never its name:

- **Delimited text named `.xls`** — what several state and vendor exports actually ship (Florida's
  voter export is tab-separated text with a `.xls` name). This imports normally. Nothing to convert.
- **A genuine Excel 97–2003 workbook** — an older binary format with nothing in common with `.xlsx`
  beyond the first three letters. (`.xlsx` is a zip of XML files; `.xls` is an OLE2 binary document.)
  The app cannot read it and **refuses it with the remedy**: open it in Excel, **File → Save As →
  Excel Workbook (.xlsx)**, and upload the `.xlsx`. It also tops out at 65,536 rows, so a large voter
  file was never one of these to begin with.

Before this distinction existed, a real `.xls` was read as though it were text: the mapping step
showed a single column of binary junk and zero rows, so a **format** problem looked like a **column**
problem. The same content-first rule now applies to the Voter-ID uploads (walk list from CSV, early
voting, do-not-contact), which share one parser.

**If an Excel file has several tabs, only the first
one is imported** — the leftmost tab you can see (hidden sheets are skipped, and it isn't necessarily
the tab Excel opens on, which is whichever one was showing when the file was last saved). Vendor files
often carry extra `Summary` or `README` tabs after the data; those are ignored, which is usually what
you want. **The mapping step tells you which tab it read and which ones it skipped**, so you can see
at a glance whether it picked the right one. If the data isn't on the first tab, move it there (or
delete the tabs in front of it) and upload again. Some vendors pack **multiple voters into one row**
(e.g. `FLVoterId1..4`); the importer **detects** this and offers an **"Explode multi-member
rows"** toggle (on by default) that splits each row into one voter per person — the preview
counts update live (the full story, including what fills down to the extra voters and the red
warning shown when the shape can't be read, is under **Rows are people; doors are addresses** above). It also warns about **leading-zero risk** (IDs/zips stored as numbers) and
**Excel date serials**, and surfaces a **vendor** field on the mapping step so files with a
universal person ID (a "uid") are matched across orgs (see *Shared voter database* below).

## Coordinate-less files (geocoding)

If a file has **no latitude/longitude**, geocoding (when enabled) turns each address into a pin
so the file can still import — just **leave the Latitude/Longitude columns unmapped** (they're
optional; the mapping step no longer requires a coordinate column). The preview shows a **free
forecast** (how many addresses need geocoding and how many are already cached), plus an opt-in
**"See exact placement"** button that runs the real geocode and reports exactly what can and can't
be placed. On import, unplaceable addresses are dropped (and listed) so every imported door keeps a
walkable pin. *(Geocoding has an internal per-lookup cost, but that's Doorline's cost — it's never
shown to admins or clients. Only the platform owner sees it, on the super-admin Imports page.)*

## When two rows disagree about where a house is

Several voters usually share an address, so several rows in your file become **one door**. They're
supposed to carry the same coordinates — but files do disagree, and one bad row used to be enough to
pin a house miles away: whichever row happened to come first simply won, silently.

Now the file has to make its case:

- Rows within about **150 metres** of each other aren't a disagreement at all — that's just a rooftop
  versus a driveway, and the first pin stands.
- A coordinate that isn't even **inside the state** loses to one that is.
- Otherwise the **most rows win.** A single bad row can no longer outvote the good ones.
- If it's a genuine tie — two rows, two places, nothing to separate them — the door keeps the first
  pin and the import **records the conflict** instead of hiding it. The preview counts these, so
  "3 addresses had disagreeing coordinates" is something you see rather than something you find out
  months later from a canvasser standing in the wrong neighborhood.

A tie is never resolved by throwing the coordinates away: a door with no pin gets dropped from the
import along with its voters, and losing a house is worse than a suspect pin. Ties are cleaned up
afterwards — see **Fixing pins that came in wrong** below.

## Fixing pins that came in wrong

Doors imported before the rule above may still sit in the wrong place, and ties still need settling.
An audit run finds them and can correct them:

- It looks only at pins that came **from your file**. A pin someone dragged to the right spot by hand
  is field-verified truth and is never overwritten, and neither is one the geocoder placed.
- A door is suspected when it's outside its state, when it's far from the other doors on its own
  street, when it **shares an exact map spot with doors from other addresses** (a placeholder
  coordinate the vendor stamped on addresses it couldn't place — a real building is one **house
  number** with many units, so it never trips this; 18 different house numbers on one dot are 18
  collapsed homes even when they share a street name), or when **two or more canvassers logged a
  knock far away from it** — they were standing at the real house, so the pin is what's wrong.
- A real building carrying a couple of oddly-typed rows keeps its majority: the building stays put
  and only the odd doors get a second look. An 89-door mobile-home park with two typo'd lots is a
  park with two typos, not a fake pin.
- Nothing is corrected on suspicion. Each suspect is re-checked against the **address itself**, and
  only a confident, clearly-different answer wins.
- Corrected doors keep their books. A door fixed this way stays in whatever book was cut around its
  old location until you re-cut that pass — the book's **outline** is redrawn around the corrected pin
  (the repair redraws every live round it touched once it applies, and a single pin moved by hand
  redraws as it saves), but its membership and walk order don't move. And if **Remove apartments** had
  excluded a fake stack, fixing the pins does not put those doors back in books — re-include and re-cut
  (the script prints the exact steps).

Ask your Doorline contact to run it — it's an operator tool, not a page in the app. The import
preview also warns up front now: *"N doors sit on an exact map spot shared with doors from other addresses"*
means the file shipped placeholder coordinates and a repair run is worth scheduling before turf is cut.

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
Voter IDs / spreadsheet error values). Review it, then **Confirm & import** to apply (or **Back** to fix
the mapping). Each finished import also records how many voters moved doors and how many doors were
emptied, in the history table.

**Broken ID columns are caught, loudly.** Some vendor files arrive with a *formula error* — the literal
text `=#NUM!`, `#REF!`, `#N/A`, … — where the Voter ID should be, because the lookup that built that
column failed before the file was exported. Those rows are skipped with their own reason ("spreadsheet
error value"), never silently folded together as one repeated voter. The mapping step warns as soon as
the sample rows show an error value in the ID column; the preview shows a red callout naming the repeated
values and how many rows each one drops, plus a plain **"N of M rows in the file will import"** line. And
when more than **20%** of a file would be skipped, **Confirm & import** stays disabled until you tick an
explicit *"Import anyway — skip N rows"* acknowledgment — the escape hatch when the file can't be
re-exported is to map a different column that uniquely identifies each person (a vendor ID) as State
Voter ID.

## File size & large files

Uploads are capped at **50 MB and 300,000 rows** (a 50 MB file is roughly 150k–250k voter rows). An
oversized file is refused up front with a "split it" message — and since imports are **additive and
idempotent** (re-uploading rows just refreshes them), splitting a very large file — **by county is
usually the natural cut** — and uploading each piece produces the **same end result**. When you pick
a file the page shows its size and an estimated row count, instantly even on a huge file (it reads
just the first few rows, never the whole thing).

**Every preview is analyzed in the background** by the import worker — there's no size cutoff
anymore, and no file is big enough to hit a request timeout. While the job waits its turn the button
reads **"Queued — waiting for a worker"** with an elapsed clock, and a **Cancel** button can pull a
still-queued job back (a job that's actively running can't be cancelled). Once a worker picks it up
you see the stage and percentage. **Refreshing the page no longer loses a running preview or
import** — the page picks the job back up where it was. Background analysis, like the actual import,
needs the **import worker** running (the worker-offline banner will warn you if it isn't).

**What the stages mean** while an import runs:

- **Parsing** — reading and validating the file's rows.
- **Geocoding** — looking up map coordinates for addresses that arrived without them. This stage only
  appears when at least one address actually needs it; a file that arrives fully geocoded skips it.
- **Linking** — connecting each voter to your organization's People records. On very large files this
  is the longest step before writing, and it deliberately shows no percentage — a stage label beats a
  made-up number.
- **Importing** — writing doors and voters, with live progress.

**A stuck import now fails instead of spinning forever.** If the worker dies mid-job — or never picks
the job up at all — the import marks itself **Failed within a few minutes**, with a message that says
which of the two happened ("no worker picked this up" vs. "the worker stopped responding mid-job")
instead of an endless spinner.

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

**Claiming isn't the last step.** Claiming sets *ownership* (which walk list a door belongs to), but a
canvasser only ever sees doors that are **cut into a book and assigned** — so a freshly-claimed door is
owned yet still invisible in the field until you book it. After you Claim, go to **Turf Cutting** for that
walk list's active pass → **Add new doors** (a supplemental book) → **Accept** → **Assign**: no recut and no
new pass, the new doors join the running round and appear on the canvassers' next full refresh. The full
walkthrough — including when to use **Claim all Intake** vs. a saved search — is in
[EFFORTS.md](EFFORTS.md) → *"Assign new voters (Intake)"* and [PASSES_AND_TURF.md](PASSES_AND_TURF.md) →
*"Adding new voters after a pass exists."*

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
- **A file coordinate that is a valid number in the wrong place is accepted as-is.** The import only
  rejects coordinates that aren't numbers or are outside the world; it doesn't check that a pin is
  anywhere near its street. (In one real file a row sat 179 miles from its address, with the vendor's
  own delivery-point status marking it doubtful.) The door imports, pinned wrong, and the post-import
  pin audit — not the import — is what finds and corrects it. See *Fixing pins that came in wrong*.
- **Duplicate-ID skips are counted as rows, not values.** 37,000 rows all carrying the same junk ID read
  as 37,000 skipped rows — with the repeated value named — never as "1 duplicate".

---

# Part 2 — Technical reference

Import pipeline: [services/import/csvImporter.js](../server/src/services/import/csvImporter.js),
[services/import/parseUpload.js](../server/src/services/import/parseUpload.js),
[services/import/peekUpload.js](../server/src/services/import/peekUpload.js),
[services/import/importProcessor.js](../server/src/services/import/importProcessor.js),
[services/import/sweepStaleImports.js](../server/src/services/import/sweepStaleImports.js),
[utils/normalizeAddress.js](../server/src/utils/normalizeAddress.js).

## A. Matching keys

| Entity | Key | Behavior |
|---|---|---|
| `Household` | unique `{campaignId, normalizedAddress}` | Upsert: address/location fields `$set`; `status`/`isActive` only `$setOnInsert`. **Never sets `effortId`** → new doors stay `null` (Intake); existing doors keep their owner. **Never touches `turfId`/`status`** → a new voter at an owned door rides the existing book. |
| `Voter` | unique `{campaignId, stateVoterId}` | **Per-campaign upsert** `$set: {...row, householdId, campaignId}` → within a campaign, a re-import with a new address **moves** the voter's household (surfaced in the preview, audited as `movedVoters`; a source door emptied by moves is deactivated, `deactivatedDoors`). An overlapping import into a **sibling campaign inserts that campaign's own row** — it can never re-house this one's (the old org-wide upsert used to silently steal the voter to whichever campaign imported last). The re-housing audit + preview are campaign-scoped to match. A person flagged do-not-contact anywhere in the org gets the flag **seeded on insert** (`$setOnInsert`, original attribution kept — upload-undo still reverts seeded copies), and seeded doors join the post-import `fullyDnc` recompute. `newVoters`/`updatedVoters` mean **new/updated to this campaign**; the platform's lifetime `votersProcessed` counts **people** (distinct-svid delta), so an overlap import doesn't inflate it. |

`normalizeAddress` = `[addr1, addr2, city, state, zip5]` upper-trimmed and joined with `|` — exact
match only (no fuzzy / "St" vs "Street"). `looseAddressKey` (same file) is a fuzzier key — expands
ST→STREET, N→NORTH, etc. — used **only** for the preview's near-duplicate detection, never for the upsert.

**Recent-imports table columns** ([ImportPage.jsx](../client/src/pages/ImportPage.jsx), persisted on
`ImportJob` by [importProcessor.js](../server/src/services/import/importProcessor.js)):

| Column | Field | Meaning |
|---|---|---|
| Voters | `uniqueVoters` | valid rows after validation (and after any geocode drops) — `rowCount` in `applyImport` |
| Households | `uniqueHouseholds` | `householdMap.size` — distinct `normalizedAddress` keys in the file |
| New | `newVoters` / `newHouseholds` | `countDocuments` delta across the write — created by **this** import (rows that matched a pre-existing door/voter don't count) |
| Moved / Emptied | `movedVoters` / `deactivatedDoors` | re-housed voters; doors at 0 voters after the import |
| Errors | `errorCount` | `errors.length` — skipped rows (`missing_required`, `spreadsheet_error`, `bad_coords`, geocode-unplaceable). In-file duplicate Voter IDs are dropped first-wins and counted in `dupRows`, **not** in `errorCount`. |

So Σ `newHouseholds` over a campaign's completed, non-undone imports equals the campaign's active door
count when nothing was emptied, and `uniqueHouseholds − newHouseholds` on a later file is exactly the
set of addresses an earlier file already created. `bad_coords` only tests that latitude/longitude are
finite and in range — a file coordinate that is a valid number in the wrong place (one row in the
worked example above sat 179 miles from its street, DPV `D`) is accepted as-is and is the pin audit's
job (`repair:import-pins`, §H), not the validator's. Verified 2026-08-22 by replaying `buildImportRows`
over a six-file upload: 2,898 rows → 2,897 valid → 2,055 keys, column for column against the table.

**`isActive` lifecycle.** A door starts active. After an import,
[`recomputeHouseholdActive`](../server/src/services/import/recomputeHouseholdActive.js) (over the
households the import touched) sets `isActive:false` on any door now at **0 voters** and back to `true`
on any previously-emptied door that gets a voter again — so emptied doors stop showing up as phantom
doors (every door-pool query already filters `isActive`).

## B. Intake is automatic

`Household.effortId` defaults to `null` and the upsert never writes it, so **new-address doors are in
Intake by construction** — no import-processor change was needed. They become canvassable only once an
effort claims them (`POST .../efforts/:id/claim` — a queued background job since the 2026-08 hardening —
then a supplemental cut, also queued). See [EFFORTS.md](EFFORTS.md) §B.

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
- **Spreadsheet error literals** (`SPREADSHEET_ERROR_RE` in
  [csvImporter.js](../server/src/services/import/csvImporter.js), `/^=?#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)$/i`,
  mirrored in `ImportPage.jsx` — keep them in sync): a mapped `stateVoterId` matching it becomes a
  per-row **`spreadsheet_error`** *before* the dedup — otherwise a broken export where 37k rows share
  the literal `=#NUM!` collapses them into one voter and "1 duplicate" (the FL-22 i360 incident this
  guard exists for). `rowIssues.spreadsheetErrors` carries the count.
- **`rowIssues.duplicateInFile` is dropped ROWS**, not distinct duplicated values — the validator tracks
  `dupRows` alongside `dupSvids` (now a `Map` of value → dropped count; `duplicateStateVoterIds` on the
  job persists its keys). `samples.dupValues` lists the top 5 repeated values with per-value dropped
  counts for the review callout. The client sums `spreadsheetErrors` into *Rows skipped*, renders
  `validCount` of `totalRows`, and past a **20% skip share** (`SKIP_ACK_SHARE`) disables
  **Confirm & import** behind an explicit "Import anyway" checkbox (`ackSkip`, reset by
  `dropReview`/`resetSelection`). The mapping step also warns early when the 5-row peek shows an error
  literal in the column mapped to State Voter ID (best-effort; the full-file preview is authoritative).
- **On apply**, `importProcessor` captures each incoming voter's prior household, then after `applyImport`
  runs `recomputeHouseholdActive` over the touched (source ∪ destination) households and stamps
  `movedVoters`/`deactivatedDoors` onto the `ImportJob` (shown in the Recent-imports history).
- **Forecast vs. actual:** the preview is a forecast against current data; the apply re-parses the same
  file and computes the authoritative counts. The CLI `runImport` path skips the worker's post-apply
  step (no deactivation), same as it skips the other post-apply recomputes.
- **Previews always run on the worker:** the client sends **every** preview to
  `POST /csv/preview-enqueue` (the old ≥ 15 MB size fork is deleted — one path, no request-timeout
  cliff), which stashes the file (`saveRawImportFromFile`) and queues an `ImportJob` with
  **`kind: 'preview'`** on the same import queue. The worker branch in
  [importProcessor.js](../server/src/services/import/importProcessor.js) runs `buildImportRows` +
  `computeImportDiff`, stores the result on `ImportJob.diff`, and deletes the raw file (no
  `applyImport`). The page polls `GET /admin/imports/:id` for `job.diff` and persists the job id in
  `sessionStorage` (`import.previewJobId` / `import.geocodeCheckJobId`), so a refresh re-attaches to
  the running job instead of orphaning it. Preview jobs are excluded from the Recent-imports list.
  The synchronous `POST /csv/preview` remains (API callers, tests); an oversized file 400s there with
  `code: 'file-too-many-rows'`.
- **Size caps:** Multer rejects files over **50 MB**; a `uploadCsv` wrapper maps that to a friendly
  **413** (`code: 'file-too-large'`) instead of a generic 500, and the client also blocks oversized
  files before upload. Past the byte cap, `streamParse` enforces **`MAX_IMPORT_ROWS`** (default
  300,000) and **`MAX_IMPORT_CELLS`** (default 8,000,000; both env-overridable) **during** the parse —
  `ImportTooLargeError` carries the count and the split-by-county remedy, and the worker marks it
  unrecoverable instead of burning the retry schedule (§E, §G).
- **The `GET /:importId` poll projects out the big arrays**
  (`insertedHouseholdIds`/`insertedVoterIds`/`sourceHouseholdIds`/`duplicateStateVoterIds` — ~5 MB of
  JSON on a 100k-row import that the 1.5s poller must not re-download every tick; undo reads them from
  the DB), validates the ObjectId, and runs the lazy stale-job expiry (§E).

Still open (not built): reopening an already-knocked door when a new voter is added there. (The other
former entry here — streaming the upload to disk + a sampled preview — shipped: multer `diskStorage`
plus `peekUpload`, see §E and §G.)

## E. Operations — the import worker

Imports (and turf cuts) run in a **separate `worker` dyno** ([Procfile](../Procfile)
`worker: npm --prefix server run worker` → [worker.js](../server/src/worker.js)), not the web dyno. If
that dyno is scaled to 0, the web app still **enqueues** jobs but nothing **consumes** them — they sit in
BullMQ **"waiting"** forever. `GET /admin/imports/worker-status`
([routes/admin/imports.js](../server/src/routes/admin/imports.js)) reports whether a worker is consuming
the queue (`queue.getWorkers()` + job counts) and drives an **"import worker offline" banner** on the
Import page, so a stopped worker is obvious instead of a silent stuck "pending". Its Redis calls are
bounded by a **3 s `Promise.race`**: with `maxRetriesPerRequest: null` (required by BullMQ) ioredis
queues commands *forever* against a dead Redis and never rejects, so an unbounded await would ride to
the router's H12 and the offline banner would never render in the one case it exists for — Redis
unreachable now answers `{ online: false, reason: 'redis-unreachable' }`. Keep the `worker` dyno on (a
Basic, always-on dyno) so imports always process.

**Heartbeat + stale-job expiry**
([sweepStaleImports.js](../server/src/services/import/sweepStaleImports.js)). A worker V8 OOM-abort
(or SIGKILL) skips every catch, so an `ImportJob` used to freeze in an active status forever while the
client polled it — the "Analyzing…" spinner that never ends. Now **`heartbeatAt` rides every progress
write** (per 2000-row apply batch, per geocode batch, per link batch — no extra writes), and two
enforcement points share one CAS expiry:

- **Lazy, per poll — `GET /admin/imports/:importId`.** Deliberately enforced on the **web** dyno,
  because the dead component in this failure is the worker. `pending` older than **2 minutes** means
  no worker ever claimed the job; any later active status **3 minutes** past its heartbeat means the
  worker died mid-job. Either way the doc CAS-flips to `failed` (the `{ _id, status }` filter leaves a
  job that resumed or finished between read and write alone), with a human `errors[]` message
  distinguishing **"No import worker picked this up"** (worker dyno off — check Heroku → Resources)
  from **"The import worker stopped responding mid-job"** (retry, or split the file), plus
  `lastError: 'stale-unclaimed' | 'stale-heartbeat'`. The poll itself is the watchdog — a stranded job
  self-fails within minutes with a real message.
- **The nightly sweep — 05:53 UTC, `IMPORT_SWEEP_JOB`** — the backstop for jobs nobody is polling.
  Registered in the scheduler's `MAINTENANCE_JOBS` and deliberately **not** in `REPEATABLE_JOBS`
  (hygiene going quiet must never read as "Retention: NOT ENFORCED" on the health banner). It also
  deletes **rawImports GridFS files** whose `ImportJob` is terminal or missing and that are older than
  24 h — crashed imports used to orphan the complete uploaded voter file with no TTL and no deletion
  path (see [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)) — and stray worker temp files
  (`tmp-*` ExcelJS spools, `import-spill-*`) older than 24 h. One-off console run:
  `npm run sweep:raw-imports` ([OPERATIONS.md](OPERATIONS.md)).

**Redis→Mongo failure reconcile.** When BullMQ exhausts a job's retries, the failure lands in Redis
only — nothing else writes `failed` onto the doc the client polls. The import worker's `failed`
listener ([worker.js](../server/src/worker.js)) CAS-writes `{ status: 'failed', lastError }` (active
statuses only) once the last attempt dies. In the processor, a missing raw file, an oversized file, or
an unparseable one is classified **`UnrecoverableError`** — no retry burn — and its raw upload is
deleted immediately (the sweep covers every other failure path). The worker's boot probe and
`registerMaintenanceJobs` are time-bounded for the same ioredis reason as worker-status: a dead Redis
must not wedge `main()` before any `Worker` exists.

**Cancel.** `POST /admin/imports/:importId/cancel` cancels a **queued** job: pull it from the queue,
CAS-fail the doc, drop the raw upload. A job a worker is actively heartbeating returns **409**
("running — it can only be cancelled once it stops responding") — cancelling one mid-write would let
the processor's completion overwrite the cancel — unless the heartbeat shows the worker dead, in which
case the stale expiry takes it.

**Memory & sizing.** The worker script pins V8's heap —
`node --max-old-space-size=${WORKER_MAX_OLD_SPACE:-384}` ([server/package.json](../server/package.json)),
default **384 MB**. After this batch a **166k-row / 50 MB-class file fits under that cap**: the apply
path spills valid rows to NDJSON on the dyno's ephemeral disk and processes 2000-row batches, so worker
heap stays roughly **flat in file size** (measured record in [PERFORMANCE.md](PERFORMANCE.md) —
raising the cap is no longer the fix for big files). `IMPORT_JOB_CONCURRENCY` (default 2) multiplies
whatever a single job still holds; if imports ever OOM again, drop it to 1 before reaching for a
bigger dyno + a higher `WORKER_MAX_OLD_SPACE`. `ImportJob` gained `heartbeatAt` / `phase` /
`lastError` and a **`{status: 1, heartbeatAt: 1}` index** — prod autoIndex is off, so
`npm run migrate:build-indexes -- --apply` after deploy is a **gate**.

The **web** side stopped holding uploads in memory too: multer uses **`diskStorage`** (OS temp dir,
ephemeral on Heroku) instead of `memoryStorage`, so a 50 MB upload never sits in the web dyno's RSS;
`saveRawImportFromFile` streams disk → GridFS, and the temp file is unlinked on the response's
`'close'` event (success, failure, or client abort — the file holds voter PII, so its lifetime is the
request).

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

## G. Smart import — formats, explode, detection & the streaming engine

**The mapping peek is O(5 rows), never O(file).** `POST /preview-headers` calls
[`peekUpload`](../server/src/services/import/peekUpload.js) for headers + 5 sample rows + an
`estimatedRows` count. CSV: decode only the first 1 MB and Papa-parse with `preview` (row estimate =
size ÷ average line length). XLSX: **unzipper** opens the zip **central directory** — random access to
exactly the entries needed, in the order we want — and a **saxes** SAX parse makes two bounded passes:
the sheet until 6 `<row>`s have been seen (the stream is destroyed mid-entry), then
`sharedStrings.xml` retaining **only** the string indices those cells cite (stops at the max needed
index, with a 64 MB text backstop so a crafted file can't turn the peek into a full read).
`styles.xml` supplies the date-format style indexes (built-in numFmtIds + the y/m/d token heuristic),
so per-cell semantics — shared strings, booleans, date serials, float stringification — match
`parseUpload`'s `readCell` exactly. Measured on a 166,738-row xlsx: **~283 ms / ~90 MB peak** vs the
old full-parse path's **~6 s / ~620 MB** on the web dyno (the R14s). **Why not ExcelJS with an early
break:** its streaming reader spools the *entire* decompressed sheet (~150 MB for that file) to a temp
file whenever the zip lists the sheet before sharedStrings, and breaking out early skips its cleanup
callback — a leaked spool per preview. `estimatedRows` (xlsx `<dimension>`; the CSV extrapolation)
feeds the client's oversized warning before the user maps 24 columns. `peekUpload` takes a Buffer or a
**file path** (multer `diskStorage`, §E — the upload never enters the web dyno's heap).

**Format is decided by CONTENT, never by filename.** `looksXlsx` accepts the `.xlsx` name *or* the
`PK` zip signature; `looksLegacyXls(buffer)` matches **only** the 8-byte OLE2 Compound File signature
`D0 CF 11 E0 A1 B1 1A E1` that leads every Excel 97–2003 workbook, and raises the typed
`LegacyXlsError` (`code: 'legacy-xls'`, HTTP 400, message carries the Save-As remedy) from
`streamParse`, `parseUpload`, `peekUpload` **and** `parseIdsAndFindVoters`. It deliberately does
**not** trigger on the `.xls` extension: vendors ship delimited *text* named `.xls` (Florida's export
is tab-separated), Papa sniffs the delimiter, and those files import correctly — refusing on the name
would break a working upload. Untrapped, an OLE2 buffer fell through to the CSV branch and Papa read
the binary as text: one garbage header column, zero rows, so the mapping step blamed the *columns*.
The same check catches a real `.xls` **renamed** `.xlsx`, which passed `looksXlsx` on the name and
died inside unzipper as a bare `FILE_ENDED` 500. The three stash-and-enqueue routes (`POST /csv`,
`/csv/preview-enqueue`, `/geocode-check`) never parse, so they sniff the upload's first 8 bytes
themselves (`refusedAsLegacyXls`) and refuse **before** writing a GridFS blob and an ImportJob the
worker could only fail; `importProcessor` still classes `LegacyXlsError` as **unrecoverable**, so a
job queued before this shipped fails once instead of burning its retry schedule. Both typed parse
refusals (`ImportTooLargeError`, `LegacyXlsError`) are mapped to a coded 400 by one helper,
`typedParseRefusal`. Client `accept` lists were widened to match what the parser really handles —
`.csv,.tsv,.txt,.xls,.xlsx` on the Import page, `.csv,.tsv,.txt,.xls` on the three Voter-ID uploads.

**One parse seam, now streaming:** `streamParse(buffer, filename, { onRow, maxRows, maxCells })`
([services/import/parseUpload.js](../server/src/services/import/parseUpload.js)) reads **CSV via
Papa** (`step` mode) and **XLSX via exceljs's `WorkbookReader`** (row-at-a-time; sharedStrings/styles
cached, so IDs keep leading zeros and date cells keep their type via the shared `readCell`), calling
`onRow` once per non-empty row — **no rows array ever exists**. Materializing every row as a JS object
was ~299 MB of live heap on a 166k-row file, which OOM'd the worker's 384 MB cap (§E); the streamed
pipeline finishes the same file in ~7 s under `--max-old-space-size=384` with identical outputs
(219 MB peak RSS, normalization included). **Zip entry order is normalized first when needed**
(`preflightXlsx`): exceljs's streaming reader is entry-order sensitive — a sheet arriving after
sharedStrings but before `workbook.xml` crashed its inline path (`this.model.sheets`, exceljs 4.4.0),
and a sheet arriving *before* sharedStrings in a **data-descriptor zip** (what streaming writers like
exceljs's own `WorkbookWriter` emit) silently swallowed the rest of the stream, surfacing text cells
as raw `{sharedString: n}` placeholders. The old `wb.xlsx.load` never saw either because it had random
access. So `streamParse` reads the central directory (milliseconds), and only when a dependency entry
(`workbook.xml`, rels, sharedStrings, styles) trails the first worksheet does it rewrite the zip
deps-first to a transient `xlsx-norm-*.zip` temp file (streamed entry-by-entry, archiver level 1,
unlinked in a `finally`, swept nightly). Files already in the safe order — everything desktop Excel
writes — skip the rewrite entirely.

**Which tab gets read — ONE rule, shared.** A workbook can hold many worksheets; the importer reads
exactly one: the workbook's **first non-hidden `<sheet>` element** — the leftmost tab the user can
actually see. Hidden sheets (`state="hidden"`/`"veryHidden"`) are skipped deliberately: a workbook
leading with a hidden scratch tab would otherwise import that tab, and *no* remedy we could print is
performable, because Excel's Move-or-Copy dialog does not list hidden sheets. (Everything hidden →
fall back to the first sheet, so a file always resolves to something.)
`resolveFirstSheetTarget(workbookXml, relsXml)` (pure string logic in `parseUpload.js`) is that rule,
and **both** `peekUpload` (the preview) and `streamParse` (the real import) call it — `peekUpload` to
pick the entry to sample, `streamParse` via `preflightXlsx`, which converts it to a *position in zip
stream order* (`targetSheetIndex`) and reads that emitted worksheet, draining the others. They must
never diverge: the preview resolved the first tab while the streaming reader took whichever sheet the
zip stored first, so a workbook with out-of-order tabs showed **tab A's columns in the mapping step
and imported tab B's rows**, silently. The zip rewrite above preserves the sheets' relative order, so
the index survives it. Pinned by
[test/parseUploadOrder.test.js](../server/test/parseUploadOrder.test.js): both hostile entry orders, a
genuine streaming-writer workbook, the untouched safe order, and three multi-tab cases (normal,
reversed tabs, reversed tabs *plus* a hostile dep order) each asserting preview and import land on the
same tab.

**And the mapping step says so.** `listWorkbookSheets(workbookXml, relsXml)` returns every tab as
`{ name, target }` in tab order — the same list `resolveFirstSheetTarget` picks from, so the two can't
drift. `peekUpload` names the tab by **matching on `target`**, never by position: when the rels are
unreadable the target falls back to `sheet1.xml` and position would print a guess as fact, so instead
`sheetName` goes `null` and the mapping step stays silent. That yields **`sheetName`** and
**`otherSheets`**, both passed straight through `POST /preview-headers`. When a workbook has more than
one tab, `ImportPage` renders an info note above the column grid — *"These columns come from the
**Master** tab — the first tab in the file, and the only one imported. 2 other tabs are ignored
(Summary, README)…"* — and the required-fields error gains a matching hint. Silent for CSVs and
single-tab workbooks, so the common case gains no chrome. The client also stopped discarding the
server's `estimatedRows` in favour of its own `file.size / 250` guess: a workbook whose data hides
behind a README tab now reads *"~9 rows (est.)"* next to nine rows of README columns, instead of
*"~200,000 rows"* next to them. Same fix closed a latent race — a second file picked while the first
peek was still in flight could paint the earlier file's columns; the peek's `onSuccess` now drops any
response whose file is no longer the current pick.
`maxRows` / `maxCells` (env **`MAX_IMPORT_ROWS`** / **`MAX_IMPORT_CELLS`**, defaults 300,000 /
8,000,000) are enforced **during** the parse — `ImportTooLargeError` (`code: 'file-too-many-rows'`)
fires the moment a counter trips, not after materializing everything. `parseUpload` survives as the
array-mode wrapper for small-file callers and tests. **Deviation from the plan, on purpose:** no
`loadRawImportStream` was added — `streamParse` takes buffers (Papa's sync mode needs the whole CSV
string anyway, and the 50 MB upload cap bounds it), so the worker still loads the raw file from GridFS
as one buffer; the win is never materializing *rows*, which is where the 8.8× blow-up lived.

`csvImporter.js` still splits **parse** (`buildImportRows`) from **validate**, but validation is now a
**streaming sink**: `makeRowValidator` (the extracted per-row core — semantics identical to the old
loop) is fed one row at a time, `explodeRow` explodes a multi-member row per-row (never holding the
exploded set; the transform binds lazily on the first row, when headers become known), and with
`{ spill }` valid rows are appended to an **NDJSON spill file** instead of an array (`validRows: null`,
`validCount` set). `applyImport` accepts either `validRows` (array — small files, CLI, tests) or
`validRowsFile` + `validCount` (the worker's large-file path) and reads whichever exists via
`ndjsonBatches` — **one 2000-row batch in heap at a time**. Multi-member files are detected by
**numbered siblings of the mapped `stateVoterId` column** — the identity anchor; no other numbered
column can trigger detection — but a "sibling" is a **template**, not a bare suffix:
`memberTemplate(col1, headerIndex)` finds the digit run in member 1's header whose in-place variation
yields an existing header (suffix `FirstName1→FirstName2`, prefix `Voter1_ID→Voter2_ID`, infix
`ID_1→ID_2`; when several runs could work, the rightmost that yields a member-2 header wins, and a
column is never its own member-2 sibling), falls back to the append case for an unsuffixed member 1
(`FLVoterId→FLVoterId2`), and returns `{ make(n) }` — member N's header in its **real casing**, or
null. Lookups resolve through `lowerHeaderIndex` (one lowercased-name → real-header map per pass), so
vendor case drift (`Firstname2` for `FirstName2`) still matches. Contiguity (stop at the first gap)
and the 20-member cap are unchanged. `detectMembers` adds a **name rail**: an ID template alone never
explodes — without a per-member `firstName` or `lastName` column, every manufactured member 2+ has a
blank name and fails required-field validation, thousands of errors instead of an explanation — so
that shape returns `{ detected: false, idSiblings: true }` and falls through to the warning below.
Only **voter-group** columns are template-substituted per member (household columns stay shared, so
`Address1/2/3` and `Mail1/2/3` never mis-explode), with one carve-out: `ADDRESS_LEVEL_VOTER_FIELDS`
(`precinct`, `congressionalDistrict`, `stateSenateDistrict`, `stateHouseDistrict`) are facts about
the door, so `explodeRow` copies them to members 2+ from the source row **when the field has no
per-member template** — a file that numbers its districts (`Congress2`) still reads member N's own
column — while every other templateless voter field (party, gender: personal facts) stays blank
rather than fabricated. The explode decision persists on the `ImportJob` so the worker apply explodes
identically to the preview. Detection (`{ format, multiMember, warnings[] }`; `multiMember` is
`{ detected: false }` or `{ detected: true, memberCount, sourceRows, exploded, explodedVoters }` —
`idSiblings` stays internal to the detector, never on the wire) flows through `computeImportDiff` to
the **"What we detected"** panel. `buildWarnings` covers `leading_zero_risk`, `date_serial` (a bare
numeric date is converted from the Excel serial **only** when the column maps to a date field) and
`missing_coordinates`; when detection did **not** fire, `buildImportRows` additionally asks
`possibleMultiMemberWarning` for the **loud miss**: if at least **two** distinct mapped voter fields
have digit-varied siblings (the same `memberTemplate` oracle — case-insensitive, any digit position;
household fields are never scanned, which is what keeps `Address1/2/3` + `Mail1/2/3` silent), it
pushes one `{ type: 'possible_multi_member', column, field, detail }` warning naming up to four of
the offending headers, member-major. Variant (a) — the ID field has siblings, or the name rail
blocked (`idSiblings`) — carries `field: 'stateVoterId'` and the rename remedy: these people *could*
import under the recognized naming. Variant (b) — no per-person ID siblings — anchors on the first
`firstName`/`lastName` sibling field and says the extra people **cannot** import: `stateVoterId` is
required and `{campaignId, stateVoterId}` unique, so there is no identity to create members 2+
under — a vendor request, not a mapping fix. The two-field threshold keeps one stray numbered column
from nagging. `ImportPage`'s `DetectionPanel` renders it through `DANGER_WARNING_TYPES` — the red
treatment `missing_coordinates` gets — but it never blocks the import: silent loss of a large
fraction of a file is nearer an error than a note, yet a file the operator knows really is
one-voter-per-row may still proceed.

**Mapping auto-suggest is deliberately narrow**
([canonicalFields.js](../server/src/services/import/canonicalFields.js)). Exact normalized alias
matches win, and a header that *is* some field's alias can never be substring-claimed by a different
field — the unrestricted bidirectional substring it replaced once suggested `stateVoterId → STATE`
(`'statevoterid' ⊇ 'state'`), which would have collapsed an entire file to **one voter**. Substring
fallbacks are gated both ways: alias-inside-header needs the alias ≥ 4 chars (so `cd`/`sd`/`hd` can't
hit inside unrelated headers), header-inside-alias needs the header ≥ 6 chars (so short generic
headers like `state` can't claim a longer alias of an unrelated field).

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
`resolve(map, { cacheOnly: true })` serves whatever the cache already knows and never calls the
provider — how `repair:import-pins` audits for free.

### Disagreeing coordinates across rows for one household

Rows sharing a `normalizeAddress` key collapse into one household. The rule **was** "first row with
valid coords wins", silently — no error, no counter, and the geocoder never re-checks a door that
already HAS coordinates (`needsGeocode` tests for null), so a bad first row pinned the door
permanently. `resolveCoordConflicts` ([csvImporter.js](../server/src/services/import/csvImporter.js))
replaces row order, deciding in `finish()` rather than per row:

1. Candidates are keyed at the shared ~1.1 m building precision, so identical rows collapse.
2. Max pairwise distance ≤ `COORD_AGREE_M` (150 m, well under the audit layer's `FAR_CONFIRM_M` 250) ⇒
   not a disagreement; the first pin stands and nothing is counted.
3. Out-of-state candidates (`inStateBounds`, which fails open on unknown codes) are dropped — but only
   when that leaves something.
4. Most votes wins. A tie **keeps the first pin, never nulls it**, and sets `coordConflict` — because
   `resolve()` DROPS a household it can't place, along with its voters, and losing a door is strictly
   worse than a suspect pin. This is the one case the file cannot settle.

Bounded for the streaming path: nothing is allocated until a household actually disagrees with itself
(one integer, `coordVotes`, per household otherwise), and the candidate list caps at
`COORD_CANDIDATE_CAP`. Counts surface as `rowIssues.coordConflicts` / `coordConflictTies` in the
import diff and as the matching `ImportJob` fields.

`finish()` also runs `classifyStackedPins` over the resolved households (CROSS-household — a vendor
that can't place an address stamps a centroid, piling different streets onto one dot). Detection
only: the coords are **never nulled** — nulling would hand the doors to the geocoder, which DROPS
what it can't place, and placeholder-stamped addresses (rural routes, new construction) are exactly
the ones geocoders fail on. A suspect pin walks; a dropped door doesn't. Surfaces as
`rowIssues.placeholderPins` / `placeholderPinDoors` + the same `ImportJob` fields, rendered in the
preview's "Doors imported with a suspect map pin" block; `repair:import-pins` adjudicates after.

### `repair:import-pins` — settling ties and cleaning up old imports

`server/src/migrations/repairImportPins.js`, proxied in the **root** `package.json` (the Heroku
dashboard's Run console starts at the app root). Dry-run and cache-only by DEFAULT.

```
npm run repair:import-pins                              # report only, free
npm run repair:import-pins -- --campaign=<id>           # or --org=<slug>
npm run repair:import-pins -- --geocode                 # allow PAID provider lookups
npm run repair:import-pins -- --verify-all --campaign=<id>  # audit EVERY pin, not just suspects
npm run repair:import-pins -- --apply --user=<userId>   # commit
```

The original CSV is **not** recoverable — `importProcessor` deletes the raw GridFS upload on success,
`Voter` carries no coordinates, and `ImportJob` stores none — so this **re-derives** truth rather than
reconstructing the disagreement. Four shortlist signals, none of which repairs anything on its own:
out-of-state; a street-cohort outlier (grouped by `streetOf` + ZIP5 from
[utils/streetName.js](../server/src/utils/streetName.js), de-duplicated by building key so a tower
doesn't outvote its street, judged against the cohort **medoid** — never a mean, which an outlier drags
— at `max(--min-meters, 4 × cohort median)`); a **placeholder pin** (`classifyStackedPins` in
[utils/stackedPins.js](../server/src/utils/stackedPins.js) — doors from several different streets on one
building-key pin; no street holding an outright majority ⇒ every door is suspect, a majority street ⇒
the building stays and only the off-street strays are suspect — this is the signal the street cohort
structurally misses, because a street that collapsed WHOLE leaves no cohort to compare against);
and knock evidence (`CanvassActivity.distanceFromHouseMeters`
≥ threshold with the *closest* knock still far, from 2+ distinct canvassers). Suspects are then
adjudicated against the address via `geocodeResolve`, and an answer must clear **four trust gates**
before it may overrule a stored pin — because the geocoder has placeholder behavior of its *own*
(observed on a real district file: twelve different "De Soto Ave, Clewiston" house numbers "matched"
onto one identical LaBelle rooftop 49km away): `exact` confidence; a **true rooftop type**
(`rooftop`/`point` — never `nearest_rooftop_match`, which means "the nearest roof I *do* know",
i.e. somebody else's); **no collapse** — an identical answer point claimed by two or more
*different base addresses* is the provider guessing (89 lots of one park sharing a point is one
base address, and passes); and the **matched ZIP** agreeing with the address's own ZIP. **The confirm floor is per-signal**: distance-based suspects (out-of-state,
street outlier, knock evidence) need the answer more than `--min-meters` (250) away — an exact answer
agreeing within that refutes a distance suspicion. Stacked-pin suspects need only
`STACKED_MIN_METERS` (25): their suspicion is *identity*, not distance — the door provably shares one
~1.1m dot with other streets' doors, so the pin is wrong at any gap, and a centroid stamped on a small
area puts true rooftops well inside 250m. An exact answer that agrees with the pin is counted and
reported as **refuted** ("N refuted — the address geocodes to where the pin already is"), so a clean
run can't be misread as a cache miss.

All four signals need something to **contradict** the pin — a state line, street-mates, a shared dot,
a knock. A pin that is wrong but *self-consistent* shows none of them: a genuine 5-unit building
placed on the wrong lot is one base address (so never a placeholder) and often its street's only pin
(so no cohort), and a street whose every door sits on one wrong spot *is* its own cohort medoid.
Observed on a real district file — "161 Jaycee Lions Dr", five units, pinned among houses two streets
over, invisible to every signal. **`--verify-all`** closes that hole: it shortlists *every*
`file`-pin door in scope and lets the same adjudication gates decide (`exact` confidence,
`--min-meters` floor — the 25m stacked floor stays reserved for stacked suspects), so a correct pin
costs one cache-first lookup and moves nothing. It requires a `--campaign`/`--org` scope (unscoped it
would probe the whole database), and a cache-only dry run reports exactly how many addresses have no
cached answer — the upper bound of what `--geocode` would spend — before any money moves. Run it
**before** cutting a pass: books are cut around pin geography, so repairing after Accept leaves books
drawn around fiction.

**The script also second-guesses itself.** Every run re-examines its own past repairs — doors whose
`coordSource` is `'corrected'` *and* whose latest `HouseholdLocationChange` row is
`source: 'import_repair'` — against the same trust gates, always cache-only (free). A past move whose
evidence fails the gates is **reverted** to the pin the file gave it: location restored from the
audit row's `from`, provenance reset to `'file'`, corrected-by stamps cleared, and a new audit row
written for the revert itself. A door whose latest move is human (`drag`/`admin_drag`/`gps`) is
never touched — people outrank providers. This is what healed the doors that earlier runs had parked
on collapsed geocoder answers before the gates existed.

**Sequencing trap: use `--geocode` on the FIRST apply.** The placeholder signal is stack-based, so
once a pin's cached-answer neighbours move away, an uncached tail door at that pin is a lone door with
no signal — a later `--geocode` pass can no longer find it. Adjudicate the whole stack in one run
(`--geocode --apply --user=…`), while the stack still exists.

Traps this script is built around, each of which is a real failure mode:

- **Scope is always `'unit'`.** `scope: 'building'` moves every door sharing the pin — catastrophic
  here, since the bogus location may hold doors that legitimately belong there.
- **Only `coordSource: 'file'` doors are eligible.** `'corrected'` is human-placed truth (overwriting it
  is the regression the re-import pin shield exists to prevent) and `'geocodio'` already came from the address.
- **`--apply` requires `--user`.** `HouseholdLocationChange.userId` is `required`, while
  `updateHouseholdLocation` passes `byUserId || null` — without a real id the household **saves** and
  *then* throws on its audit row, leaving a moved pin with no trail. The script refuses up front.
- **`source: 'import_repair'`** is its own enum member rather than `'admin_drag'`: nobody dragged
  anything, and mislabeling would put a lie in a permanent audit log.
- **After-effects it prints out loud:** book/turf membership is untouched (so a repaired door stays in
  the book cut around its old location until that pass is re-cut), and `coordSource: 'corrected'` enters
  `buildPinFixMap`, downgrading past far-knock GPS flags at those doors — correct, but it moves
  historical Audit numbers.
- **It re-hulls the book outlines itself — once, at the end.** Each per-door call passes
  `rehull: false` to `updateHouseholdLocation` (the inline per-move re-hull that the UI pin writers get
  — [MAPS.md](MAPS.md) § "Coordinate provenance & pin correction" — would re-run the whole-pass Voronoi
  per repaired door), and the revert path writes `doc.location` directly; so the script collects the
  passes of **every** door it moved, repairs and reverts alike, and under `--apply` calls
  `recomputePassTerritories(passId)` (full, no `onlyTurfIds`) once per touched **live** pass after the
  campaign loop. `npm run recompute:territories -- --apply` is therefore no longer a required follow-up,
  only the fallback for a pass the run reports it left alone.
- **A re-import can still move an un-corrected pin with no re-hull.** The importer's reconcile `$set`s
  `location` on an existing `coordSource:'file'` door straight from the file — that path never re-hulls,
  so the outline follows on the next cut or `recompute:territories`. Corrected doors are shielded from
  it (below).

Idempotent: a repaired door becomes `'corrected'` and is excluded from the next run.

`coordSource`/`coordConfidence` are no longer import-only bookkeeping: the maps now **surface** them
(an amber "approximate" ring on `interpolated` pins) and a pin can be **corrected** — which sets
`coordSource='corrected'` — or **confirmed in place** on the Pin Fixes page — which stamps
`locationConfirmedBy/At` while leaving the geocoder's verdict untouched. See
[MAPS.md](MAPS.md) § "Coordinate provenance & pin correction".

**Pin shield (the household twin of the voter hand-edit shield).** A corrected pin is a
field-verified fact the file cannot know, so `applyImport` **will not revert it** — and since
2026-08-28 a **confirmed** pin (Pin Fixes, `locationConfirmedAt` set) gets the same protection:
its whole point is "a person checked this spot", and letting a re-import silently relocate it
would leave the stamp vouching for a pin nobody saw. Before building the household ops the
importer prefetches this campaign's shielded addresses — `$or` of `coordSource:'corrected'` and
`locationConfirmedAt: { $ne: null }` (batched `$in`, key-only projection — the narrow filter keeps
it tiny even on a 100k-row file) — and, for those, moves
`location`/`coordSource`/`coordConfidence` out of `$set` into `$setOnInsert`: the existing
door keeps its human-placed (or human-vouched) pin, while a row deleted between prefetch and write
still inserts with complete coords (a field must never appear in both operators — Mongo rejects the
conflict). Every other household field still takes the file. **`overwriteHandEdits` governs BOTH
shields** — one keep-or-overwrite decision, not two competing toggles — so ticking it lets the
file's coords win, resets `coordSource` to `'file'`, **and clears `locationConfirmedBy/At`**: a
corrected pin self-heals its provenance through `coordSource` in the `$set`, but the confirm stamp
has no such sentinel, so without the explicit clear a stale stamp would read as a valid
confirmation of the file's unverified pin. Counts ride back separately — `keptPins`
(human-corrected pins kept, its long-standing meaning) and **`keptConfirmed`** (confirmed pins
kept) — both on the `ImportJob`, `$max`-merged like the other counters, so a retry can't double
them. The confirmed-pin cases are pinned by test 8 of
[pinFixes.int.test.js](../server/test/pinFixes.int.test.js); guard cases 8–11 in
[importHandEdits.int.test.js](../server/test/importHandEdits.int.test.js) pin the corrected-pin four:
kept by default, released on overwrite, never over-blocking an uncorrected door, and a brand-new
address still inserting with coords.

**Cost review (owner-only).** Every completed apply import persists its real lookup counts
(`geocodedNew` = billable Geocodio hits, `geocodedCached`, `geocodeUnmatched`) plus
`householdsWithFileCoords` (homes that arrived with coords, counted *before* geocoding fills the
rest — an exact "arrived with coords" figure). The dollar cost is **never persisted or sent to a
client**: it's derived on read as `geocodedNew / 1000 × GEOCODE_COST_PER_1000_CENTS` (the single
rate constant in `geocodeService.js`, ~$1/1k). The super-admin **Imports** page
(`GET /super-admin/imports`, [server/src/routes/superAdmin/imports.js](../server/src/routes/superAdmin/imports.js))
aggregates this across every org — totals + a per-import table (with-coords vs. needed-geocoding,
new/cached, cost) — so the platform owner can review costs. Built for reconciling the Geocodio
invoice: the endpoint takes opt-in `skip`/`limit` paging (parameterless keeps the legacy newest-500
window), server-side `q` search (file/uploader/org), an `orgId` filter, `sort=cost`,
`excludeUndone=1` (a reversed import still incurred its lookups, but it's flagged `undone` and can
be dropped from the math), and `groupBy=month|org` rollups; `geocodeFailed` (transient provider
errors) now rides along so a half-geocoded run doesn't look clean. The page adds a cache-savings
card (lookups avoided × the rate, plus hit rate), prints the assumed rate on screen, and exports
the current view to CSV. Legacy rows with no `householdsWithFileCoords` fall back to
`uniqueHouseholds − geocodedNew − geocodedCached` (flagged approximate). Nothing in the admin
import UI shows any cost.

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
`persons` forecast (`existingPeople`/`newPeople`).

**Linking is its own visible stage now.** The worker stamps `status: 'linking'` (+ `phase`) before
`reconcileIdentityFromImport` — at 100k+ voters this is the longest pre-write step, and it used to run
under whatever label came before it (usually "Geocoding" frozen at 0%). Progress deliberately holds at
the geocode floor during it: the step has no cheap row-granular progress, and a stage label beats a
lying percentage. Relatedly, the **geocoding status is only stamped when ≥ 1 household actually needs
geocoding** — a file that arrives fully geocoded never flashes a phantom "Geocoding" stage (resolve()
would no-op, but the client polls every 1.5 s and used to catch the stamp). In spill mode (§G) the
link pass streams the raw spill in 5000-row batches — dropping geocode-unmatched rows, reconciling
each batch (which stamps `personId`), and re-writing the stamped rows to the `-linked` spill that
`applyImport` consumes — one batch in heap at a time, heartbeating per batch. The **vendor namespace** (`uidSource`) is
resolved at upload (inline or from the `ImportProfile`), stored on the `ImportJob`, and threaded
into matching. It is **per-org matching only** — Persons are org-scoped, and the import screen's
copy says so (the old "matched across orgs" wording described the pre-July-2026 behavior that was
removed). Full design — the canonical Person model, the ownership state machine, and
super-admin oversight — is in [PERSONS.md](PERSONS.md).

**The namespace input is hidden in the UI (owner decision 2026-07-19) — the server path is
untouched.** Every file we import is matched on `stateVoterId`, which `validateRow` hard-requires;
the vendor namespace only applies to commercial vendor files carrying that vendor's own person ID,
and no org has ever set one. It was hidden rather than relabeled because it is the **master switch
for uid-first matching**: `UID` is an offerable column mapping, and a namespace + a column mapped to
`UID` makes the uid the *authoritative* key over the state voter ID
(`resolvePerson.js` — on disagreement it raises a `uid_svid_conflict` candidate and **links to the
uid match**), so a non-unique column (precinct, county code) mapped there would collapse distinct
humans onto one Person and then fan identity edits between them via `propagateIdentity`. With no
namespace, `hasUid` is false and a mis-mapped `UID` column is inert — hiding the one input disarms
the whole path. The state/setter and the request field remain wired (a legacy `ImportProfile` value
still loads), so restoring the input is the only change needed if a vendor-data customer appears.

**Saved profiles are org-wide and lead-writable by design.** `GET`/`POST /admin/imports/profiles`
sit behind the router's `('admin','lead')` gate with no per-route wall: a team lead can read every
saved vendor mapping and save/overwrite one by name (upsert on `{organizationId, name}`).
Owner-ruled 2026-08-07 — leads run imports, so they keep profile self-service; a profile holds
column mappings and a `uidSource`, never voter data. The trade-off to know: two operators sharing a
profile name overwrite each other silently, so name profiles by vendor, not by campaign.
