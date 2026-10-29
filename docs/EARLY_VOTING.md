# Early voting (voted voters)

Lets an admin upload a list of voters who have **already voted** so canvassers stop wasting trips
on them. This doc is the source of truth for how it works and **how it touches doors, books,
voters, passes, campaigns, and the counts**.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): exact models, the pipeline,
  endpoints, the cross-effects, and the components.

Server entry point: [`server/src/routes/admin/voted.js`](../server/src/routes/admin/voted.js).
Related: the [metrics doc](METRICS.md), [MAPS.md](MAPS.md) (voted doors dropping off the map),
[EFFORTS.md](EFFORTS.md) (marking is campaign-wide / effort-independent; new voters reach efforts via
Intake), [IMPORTS.md](IMPORTS.md) (the import that triggers the sticky re-apply),
[PROPOSAL_ID_LIST_EXCEL.md](PROPOSAL_ID_LIST_EXCEL.md) (Excel files on the three Voter-ID uploads and
*Count only rows where*: the design, the owner's calls and the review).

---

# Part 1 — For everyone

## What it does

You upload a list of voters who already voted (early / absentee): a CSV or other text export, or an
Excel workbook (`.xlsx`). The app matches them **by Voter ID**, marks them as voted, and **removes a
door from canvassers once *everyone* at that address has voted**. Nothing is re-cut and every upload
is reversible. An election office's returns file can go in as it comes: you choose on the page which
of its rows count — accepted ballots only, say (*Choosing which rows count*, below).

## "Voted voter" vs "fully-voted door"

These are two different things:

- A **voted voter** is one person marked as already voted. At a door that still has someone left
  to talk to, voted residents simply show a green **✓ Voted** badge — the door stays on the map.
- (Sibling mechanism: **fully-voted** has a permanent, org-wide twin — the **fully-do-not-contact
  door**, where every resident asked never to be contacted. Same suppression machinery, different
  lifetime and its own `dnc` coverage segment. See [VOTERS.md](VOTERS.md).)
- A **fully-voted door** is a household where **every** voter has voted. Only then does the door
  **drop off** the canvasser's map and books.

## Campaign-scoped and reversible

- **Per campaign.** A vote is recorded against the campaign you uploaded it to. The same person can
  be "voted" in one campaign and not another (different elections), so you upload per campaign.
- **Reversible.** Every upload is logged and can be **undone** with one click, which un-marks the
  voters that upload added and re-opens any doors that had dropped because of it.

## How to use it (Early Voting page)

Open a campaign and pick **Early Voting** from its sidebar — the campaign in the URL is the one you're
uploading to (shown as a read-only label, no dropdown to pick).

1. Confirm the **campaign** label matches the election you mean (switch campaigns from the sidebar if not).
2. Choose your file in the box labelled **Voted-voters file (CSV or Excel)**: a CSV or other text
   export (`.csv`, `.tsv`, `.txt`, or text named `.xls`), or an Excel workbook (`.xlsx`). The file's
   name and size show under the box. Any column that looks like a Voter ID is detected (Nebraska's
   `Registrant_ID` and `TEXT_REGISTRANT_ID` included), and the preview
   names it (**Matched on column**) with a few of its values, so you can see what was matched on — and
   change the column from that dropdown if the app picked the wrong one. IDs match **with or without
   leading zeros** (Georgia writes `08719967`; Excel turns it into `8719967`; either finds the voter),
   and the preview says how many matched only that way. A **preview** runs immediately — no changes yet.
   **Files can be up to 50 MB**, CSV or Excel. Only the Voter ID column is used, so a bigger file — a
   state's whole early-voting file, say — goes in as a copy with just that column, keeping only the
   people who have already voted: those files often list every ballot sent out, returned or not. A file
   over the limit is turned away the moment you pick it, with that advice, before anything uploads. An
   Excel file has one more limit, on what's inside it: its first tab, unpacked, can be up to 320 MB —
   about 184,000 rows of a 35-column file like Nebraska's CD-2 returns, fewer for wider files. A bigger
   one is refused as soon as it arrives: *This Excel file is too big for us to read. Only the Voter ID
   column is used, so save a copy with just that column, keeping only the voters who have already
   voted, and upload it.*
3. The preview shows: **Will mark voted**, **Already voted** (skipped), **Doors that will drop**,
   and **Not in this campaign** (IDs that don't belong to this campaign's list).
4. Click **Mark these voters voted** to apply. You'll see how many were marked and how many doors
   dropped.
5. The page keeps an **upload history** with **Voters marked voted** and **Doors fully voted**
   totals, and an **Undo** button per upload.

### Excel files: which tab, and what can't be read

- **Only the first tab is read** — the leftmost tab you can see (hidden tabs are skipped), the same
  rule as the Voter Import. When the workbook has other tabs, the top of the preview names the tab it
  read: *These IDs come from the **CD-2 Records** tab — the first tab in the file, and the only one
  read. The Summary tab is ignored. If your list is on a different tab, move it to the front of the
  workbook and upload again.* With more than one other tab it lists them (*3 other tabs are ignored
  (Summary, Pivot, Notes).*). On the *Couldn't find a Voter ID column* box and above a refusal, where
  no IDs were read, it starts *We read the **CD-2 Records** tab …* instead (and a chart-tab refusal,
  which already says to move the tab, has no note). Nothing is said for a CSV or a one-tab workbook.
- **Rows hidden in Excel are refused, never counted quietly.** Excel's filter hides rows; it doesn't
  remove them, and the file keeps them. A workbook whose first tab has hidden rows holding a Voter ID
  is turned away with the count: *36 rows on the CD-2 Records tab are hidden (by a filter, for
  example). Hidden rows are still in the file, so they would be counted. Clear the filter or delete
  those rows, save, and upload again. Then choose which rows count on this page.* (Filter here instead:
  *Choosing which rows count*, below.)
- **A file is read whole or refused, never partly.** A damaged workbook, one cut short, or one built to
  overload the server is turned away with a plain reason, never read for some of its rows. What the
  page says, in red, in place of the preview:
  - An old Excel 97–2003 `.xls`, or a password-protected or access-restricted workbook: *This is an
    old-format Excel file (.xls, Excel 97–2003) or a password-protected one, which we cannot read. Open
    it in Excel, remove any password or access restriction, then use File → Save As → Excel Workbook
    (.xlsx), and upload the .xlsx.* (The Voter Import says the same. A text file that only carries a
    `.xls` name still reads as text, as before.)
  - A damaged workbook, or a file that isn't really an `.xlsx`: *We couldn't read this file as an Excel
    workbook. Open it, save or export it as .xlsx or CSV, and upload that.*
  - A chart as the first tab: *The first tab, Chart1, is a chart. Move the tab with your list to the
    front of the workbook and upload again.* (An old macro or dialog sheet first gets the same advice,
    starting *The first tab, Macro1, isn't a worksheet.*)
  - Nothing in row 1: *The Sheet1 tab has no column names in its first row. Put the column names (like
    Voter ID) in row 1, then upload again.*
  - Hidden rows, and a workbook too big inside: the two messages above.

### When the Voter ID column isn't found

The *Couldn't find a Voter ID column* box lists the file's columns to pick from, as before, and adds
*Column names need to be in row 1 of the first tab.* (for a CSV, *Column names need to be in the first
row.*). When row 1 holds a single cell (a title, say) and a lower row with more filled cells than row 1
holds a Voter ID column name, it says which row: *The column names look like they're in
row 3. Delete the rows above them, save, and upload again.* And when the newest upload that wasn't
undone used a column this file also has, that column comes up already chosen — *Your last upload used
SOSID.* — so a county whose ID column nothing recognises (Summit County's `SOSID`) is one press of
**Match column**. Nothing is matched until you press it: a column with a common name like `ID` can
hold row numbers, and short IDs would match real voters.

### Picking a file again

- **Fixed the file in Excel? Pick it again.** Choosing the same file again re-runs the preview (it used
  to do nothing until the page was reloaded).
- **Edited the file after picking it?** Pick it again before applying: the browser can't send a file
  that changed after it was chosen. If you don't, the page says *We couldn't read the file or reach the
  server. If you changed the file after picking it, pick it again; otherwise check your connection and
  try again.*
- **While Mark these voters voted runs**, the file box is off, so a newly picked file can't be cleared
  by the upload finishing.

## Choosing which rows count

An election office's returns file usually lists more than the people who voted: rejected and
suspended ballots (Nebraska's CD-2 file has 36), or every ballot sent out, returned or not (37% of
Nebraska's statewide file were ballots not yet returned). You don't have to delete those rows by hand.
Under the preview's numbers, **Count only rows where [— every row — ▾]** lists the file's other
columns. Choose one — `Ballot_Status`, say — and the preview re-runs and lists that column's values,
each with how many rows hold it, all ticked: `ACCE · 3,224`, `SUSP · 26`, `REJE · 10`. Untick what
shouldn't count and press **Count these rows**: the preview re-runs on the rows that are left, and
reads *3,224 of 3,260 rows counted (Ballot_Status)*.

- **Values are read as written.** Spaces around a value are trimmed, capitals matter (`ACCE` and `acce`
  are two values), and an empty cell shows as *(blank)*. A date column lists dates.
- **The column needs a few short values:** at most 25 different ones (*Ballot_Date has more than 25
  different values; pick a column with a few, like a status.*), none longer than 64 characters (*Notes
  has values too long to count by.*).
- **Applying uses exactly what was last counted.** After changing the ticks, press **Count these rows**
  before **Mark these voters voted**; until you do, Mark these voters voted is off and the page says
  *Press Count these rows to update the numbers first.* While it counts, the numbers stay on screen and
  the button reads *Counting…*. The line above the numbers then says *IDs in the rows counted*, not
  *in file*.
- **When rows were left out, the upload history keeps the column and the count** — *Ballot_Status: 3,224
  of 3,260 rows* — and never which values you ticked (with every value still ticked, it keeps nothing
  extra). Every voter an upload marks is linked to that upload, so the ticked
  values would say something about each of them (with a ballot-type column, how they voted), which
  Doorline doesn't keep.
- **To redo an upload with rows left out, undo the earlier upload first.** Undo removes only the marks
  an upload made itself. Upload the whole file and then the same file with rows left out, and the
  second marks nobody new — they're already marked — so undoing the first afterwards would leave
  nobody marked. Undo the first, then upload again with the rows you want.
- It works the same on a CSV. It's on Early Voting only: the do-not-contact list and saved searches
  read every row.

## What "Not found" means — and that it's remembered

The preview's **Not in this campaign** count (and the **Not found** column in the upload history) is
about the **universe, not your efforts or books**: those Voter IDs simply aren't in *this campaign's*
voter list yet — they haven't been imported, or they belong to a different campaign. It does **not**
mean "those homes aren't in the active effort." A voter who *is* in the campaign matches no matter
which effort their door is in (or if it's still in Intake).

Those IDs aren't thrown away — they're **remembered**. The next time you **import voters** and one of
them lands in the campaign, they're **automatically marked voted**, and their door drops once everyone
there has voted (this is the "sticky" behavior — see the Lifecycle below). So a normal flow is: upload
the voted list now (some land in *Not found*), import the new voters later, and the overlap gets marked
on that import — no re-upload needed. This works however the import spells the ID: a list that lost its
leading zeros still marks the voters when the zero-padded voter file arrives.

You can upload **as many voted lists as you want** to the same campaign. **Each upload remembers its
own unmatched IDs**, so the remembered set **grows** — it's the union across all your (non-undone)
uploads. Re-listing the same ID in two uploads is harmless: it still becomes a single mark when the
voter finally arrives.

## Early voting + efforts / Intake

Marking and door-dropping are **campaign-wide** — you don't target them per effort. A voted voter is
marked across the whole campaign, and a fully-voted door drops from **every** effort's map/books and
from **Intake** alike. New addresses you import later sit in **Intake** until you assign them to an
effort; if those voters were on a voted list, they're already marked when they land, so when you
**claim** them into an effort they arrive already-handled (fully-voted doors never reach the field).
See [EFFORTS.md](EFFORTS.md) and [IMPORTS.md](IMPORTS.md).

It doesn't matter how many walk lists or passes a campaign has, or what state each pass is in. The
upload never looks at walk lists, passes, or books: it marks people, and every place a canvasser gets
doors from checks each door at that moment. So a voted door leaves the books of every live pass, a
pass you activate later arrives without it, and books cut before the upload need no re-cut. Checked
end to end on 2026-10-27 with up to 50 walk lists of one to four passes each (Part 2 §F).

## What canvassers see

- **Fully-voted doors disappear** from the map and from book/turf door counts (their book's count
  shrinks to the remaining doors).
- **Turf cutting also skips fully-voted doors** — a new cut (or re-cut) builds and *balances* books on
  the remaining knockable doors only, so book sizes reflect real work and voted doors aren't filed
  into a book. Books cut *before* a voted upload aren't reshuffled; their live counts already shrink.
  The Turf Cutting page notes how many voted doors were skipped. (The same `excluded from cut/canvass`
  mechanism also powers **"remove apartments"** on the Turf Cutting page — `Household.excludedFromTurf`,
  the sibling flag to `fullyVoted`; see [PASSES_AND_TURF.md](PASSES_AND_TURF.md).)
- At doors that are still open, **voted residents get a ✓ Voted badge** so the canvasser knows to
  skip them.
- **Phones already open catch up on their own.** A canvasser with the app open loses a fully-voted
  door within about 30 seconds while the map is on screen (the update pauses on the door and survey
  screens and catches up back on the map), and their book counts and **Remaining** shrink with it.
- **A door that comes back returns on its own too.** After an **Undo**, an un-mark, or an import that
  adds someone who hasn't voted, a phone that's already open reloads its doors on its next update
  (about 30 seconds on the map) and the door is back. (Until the 2026-10-27 phone update, it took a
  tap on refresh or reopening the app.)
- **Someone added at the door keeps it open.** A person a canvasser added on the spot is never on a
  state list, so that door stays. If a canvasser adds someone at a door that dropped while their
  screen still showed it, the door comes back for everyone (that person hasn't voted). If you delete
  them and everyone left has voted, the door drops right away.

## Worked example

A 2-voter home, Jane and John, on Campaign A:

- Upload marks **Jane** voted → the door **stays** on the map; Jane shows ✓ Voted, John doesn't.
- A later upload marks **John** voted too → now everyone has voted → the door becomes **fully
  voted** and **drops off** the canvasser's map/books.
- **Undo** that second upload → John is un-marked → the door **re-appears**.

> Heads-up: once everyone at a door has voted it drops for *canvassers*, but the door still exists
> in the *admin reports* — now shown in its own **Voted** coverage segment (no longer counted as
> `unknocked`). See Part 2 §F.

## Lifecycle (step by step)

End to end, from upload to what everyone sees:

1. **Upload (an admin, or the campaign's team lead).** Drill into a campaign, open its **Early Voting** tab (the campaign comes from the
   URL — no in-page picker), and choose the voted-voters file (CSV or Excel).
2. **Preview — no writes.** `POST …/voted/preview` reads the file — CSV or `.xlsx`, told apart by its
   first bytes, never its name — auto-detects the Voter-ID column (or takes the one picked), keeps
   only the rows chosen under *Count only rows where* when a column is chosen there, matches voters
   **by `stateVoterId`** inside this campaign (leading zeros ignored), and returns will-mark /
   already-voted / doors-that-will-drop / not-found (plus the unmatched IDs to download). A workbook it
   won't read is refused with the reason instead, and nothing else happens.
3. **Apply.** `POST …/voted/import` reads the file again with the column and the rows the preview
   counted, records a `VotedUpload` (with the counting column's name and how many rows counted, when
   rows were left out), upserts one `VotedVoter` per voter, then
   `recomputeFullyVoted` flips `Household.fullyVoted = true` wherever **every** voter has now voted.
4. **Canvasser view updates.** The next mobile bootstrap / 30s delta drops fully-voted doors from the
   map and book counts; still-open doors show a ✓ on voted residents.
5. **Admin view updates.** Reports move those doors into the **Voted** coverage segment (out of
   `unknocked`); admin book/turf lists show the live eligible door count.
6. **Re-import the universe (sticky).** If you later import more voters, anyone who was on a prior
   (non-undone) voted list is **automatically re-marked** when they land — so doors don't wrongly
   re-open and brand-new all-voted households drop. A genuinely new, *un-voted* voter added to a
   dropped door correctly re-opens it.
7. **Corrections.** Undo a whole upload (`/voted/undo`) or un-mark one voter (`/voted/unmark`); both
   call `recomputeFullyVoted` to re-open doors as needed.

---

# Part 2 — Technical reference

## A. Data model

| Model | File | Purpose / key fields |
|---|---|---|
| `VotedUpload` | [models/VotedUpload.js](../server/src/models/VotedUpload.js) | Audit record + **unit of undo** for one uploaded list (CSV or Excel): `organizationId`, `campaignId`, `fileName`, `uploadedBy`, `totalRows`, `matched` (newly marked), `alreadyVoted`, `notFound`, `doorsDropped`, `idColumn` (the column matched on), `matchedViaZeros`, **`keepColumn` / `keptRows`** (since 2026-10-28: the *Count only rows where* column's **name** and how many rows counted, set only when rows were actually left out, else `null`; **never which values were ticked** — every `VotedVoter` row carries this upload's `uploadId`, so stored values would describe each voter it marked, with a ballot-type column how they voted; declared because the schema is strict, unindexed), `undone`/`undoneAt`. Index `{campaignId, createdAt:-1}`. |
| `VotedVoter` | [models/VotedVoter.js](../server/src/models/VotedVoter.js) | The mark — **one row per voter per campaign**: `organizationId`, `campaignId`, `voterId`, `householdId`, `stateVoterId`, `voteMethod`, `votedAt`, `uploadId`. **Unique index `{campaignId, voterId}`**; `uploadId` indexed for undo. |
| `Household.fullyVoted` | [models/Household.js:65](../server/src/models/Household.js#L65) | Derived `Boolean` (indexed, default `false`): everyone at this address has voted → the door drops. |
| `VotedPendingId` | [models/VotedPendingId.js](../server/src/models/VotedPendingId.js) | A `stateVoterId` from an upload that didn't match a voter **yet** (voter not in the universe): `organizationId`, `campaignId`, `uploadId`, `stateVoterId`. Index `{campaignId, stateVoterId}`. Makes early voting "sticky" — graduates to a `VotedVoter` when the voter is later imported; deleted on graduation or undo. |

Notes:
- **There is no `voted` field on `Voter`.** The mark lives in `VotedVoter` precisely because it's
  campaign-scoped; `Voter` rows are shared org-wide. The mobile API *derives* a `voted` flag per
  voter at request time (§E).
- `voteMethod` exists on the schema but the upload doesn't populate it, from either format (stays
  `null`) — reserved for future use.

## B. Pipeline ([voted.js](../server/src/routes/admin/voted.js))

1. **`parseAndMatch(campaign, buffer, idColumn, { keep })`** — read the list with **`readIdList`**
   (pure, database-free; [parseVoterIdList.js](../server/src/services/import/parseVoterIdList.js)),
   then match. Since 2026-10-28 (design and every rule:
   [PROPOSAL_ID_LIST_EXCEL.md](PROPOSAL_ID_LIST_EXCEL.md) §B):
   - **The reader is chosen by the file's bytes, never its name.** The OLE2 signature (an Excel
     97–2003 `.xls`, or a password-protected or access-restricted `.xlsx`, which Excel wraps in the same
     container) → `LegacyXlsError`'s refusal, `code: 'legacy-xls'`; a zip signature, `PK\x03\x04` or
     `PK\x05\x06` (four bytes, so a CSV whose first column is named `PK…` stays a CSV) → the Excel reader
     below; anything else → Papa, exactly as before (`header`, `skipEmptyLines`, trimmed headers).
   - **The ID column, both formats: `pickIdColumn(columns, idColumn)`.** The admin's `idColumn` when the
     file has it; else, over column names of 255 characters or fewer (a longer name is listed for the
     picker but never auto-matched), `suggestMapping().stateVoterId` → the first name matching
     `/voter\s*id/i` → a name normalising to `registrantid` or `textregistrantid` (Nebraska's
     `Registrant_ID` and `TEXT_REGISTRANT_ID`; recognised on these three uploads only, not by the Voter
     Import) → the first matching `/registrant[\s_-]*id/i` → `null`. `null` is the one code-less 400,
     *Could not detect a Voter ID column*, sent with the file's columns and `headerRowHint`: when row 1
     holds at most one value and a lower row in 2–10 with MORE values than row 1 (a header is wider than a
     title; a one-column list's data rows are not) has a whole cell that normalises to a Voter ID name the
     rule knows
     (`VOTER_ID_NAMES` from [canonicalFields.js](../server/src/services/import/canonicalFields.js), plus
     the two registrant names), the first such row's number (on a CSV, physical lines, blank ones
     included); never a substring, so a data cell like *No voter ID provided* can't trigger it.
   - **`keep` (*Count only rows where*; this route alone passes it).** `applyKeep` counts the chosen
     column's values over every counted row, **before** filtering (so an unticked value can be ticked
     again): trimmed, case kept, `''` for a blank, a date-formatted cell as its `YYYY-MM-DD`, sorted by
     row count. More than 25 distinct values (`tooMany`) or any longer than 64 characters (`tooLong`)
     makes the column unsuitable, and nothing is filtered. Otherwise, when `keep.selected` names fewer
     than all of them, only the rows whose value is selected go on to matching (`keptRows`; their
     unmatched IDs are the only ones parked). A `keep.column` the file lacks → 400 `keep-column`.
   - **The Excel reader**, [readIdColumn.js](../server/src/services/import/readIdColumn.js), reads the
     first visible tab in memory and keeps only the ID column and, with `keep`, the counting column:
     `unzipper.Open.buffer` over the zip's central directory (its end record found by scanning back for
     the real one, so a long zip comment or a small zip64 file still opens), saxes, and only the shared
     strings actually cited. It writes nothing to disk, unlike the Voter Import's `streamParse`, which
     writes an `xlsx-norm-*.zip` and an exceljs `tmp-*` spool for files like CD-2. The tab comes from
     `sheetChoiceFrom` over the parsed tab list in [parseUpload.js](../server/src/services/import/parseUpload.js)
     (the Import's rule: the first visible tab; `sheetName` only when the name can be proved;
     `otherSheets` the other visible tabs); when the first visible tab can't be resolved to a part (no
     tab list, or rels that don't name it) and the zip holds more than one worksheet, or its one
     worksheet belongs to another listed tab (a hidden one, say), it is `damaged`, never a guess. A
     chart, dialog or macro sheet first — by its relationship type or its folder (`xl/chartsheets/`,
     `xl/dialogsheets/`, `xl/macrosheets/`) — is `chart-tab` (*… is a chart.* or *… isn't a worksheet.*);
     a worksheet stored anywhere else is read.
     `workbook.xml`, its rels and `styles.xml` are read through a capped stream with their CRC-32 and
     size checked, never `entry.buffer()`, and each is parsed ONCE by a saxes walk shared with the Voter
     Import (`parseWorkbookXml`, `relationships`, `sheetsWithTargets`, `sheetChoiceFrom`,
     `dateStylesFromXml` in [parseUpload.js](../server/src/services/import/parseUpload.js)): either
     quote, any prefix (saxes in its plain mode; prefixes resolved from the declarations seen), the
     relationship id found by its namespace, and the 1904 flag from the workbook's own `<workbookPr>` —
     the first in the spreadsheet namespace, so an extension's `x15:workbookPr` further down says nothing
     about dates. The regexes it replaced were quadratic on crafted text (a 1.5 KB upload froze the dyno
     for 12.7 s in code review round 1). Round 2 found the walk itself still costly — each part was walked
     four times and every attribute cost an object, so a 4.1 MB upload held the dyno 14.7 s and pushed it
     past 1.2 GB — and the per-format date regexes still rescanned from every `[` (an 8 MB `styles.xml` of
     255-`[` formats, 2.9 s). Now the walk stops, keeping what it read, at 64 levels of nesting, 100 XML
     errors, 256 attributes on one tag or 200,000 in a part, and collects at most 10,000 tabs or
     relationships; a number format is cut in one pass each for brackets and quotes. Both crafted shapes
     read in about 70 ms. The zip's member count is read before unzipper lists the directory, from the
     record unzipper will use: the end record, or the zip64 record whenever the end record's count reads
     0xFFFF or its directory offset 0xFFFFFFFF (with no readable zip64 record, `damaged`) — past 10,000 (a
     workbook has dozens), `damaged`. **Row numbers must go up** (Excel's own rule): a repeated or falling
     `r` is `damaged`, which also keeps the row limit a true count. Kept values, and the cells and shared
     strings of rows 1–10, are copied (`own()`), since a slice of saxes's decoded text kept its whole chunk
     alive. Passes: rows 1–10 (headers and the title-row line; an early
     stop), the shared strings once for which are empty, the whole tab (the kept cells stored
     compactly), then the shared strings again for the cited ones. Every pass that reaches the end of
     its part closes the parser (an unclosed tag throws) and checks the inflated size and CRC-32 against
     the directory, so a torn sheet or a flipped bit is refused, never read short. Headers are row 1,
     trimmed, blanks skipped, duplicates renamed by Papa 5.5.3's own rule, so a workbook and its CSV
     export name their columns alike. A row counts when a cell under a named column has a value (the
     Import's rule). Values are what Excel shows: shared or inline text (rich-text runs joined, phonetic
     runs left out, CDATA kept), booleans as `TRUE`/`FALSE`, errors as written (`#N/A`), numbers in plain
     form (`String(Number(text))`, so `8719967` never becomes `8,719,967` or `8.72E+06`), a date-formatted
     number as ISO in the 1900 or 1904 system. **Hidden rows** — `hidden="1"` or `"true"`, or a numeric
     height of 0 (an empty `ht` isn't one) — are counted, and any hidden row with an ID refuses the file
     (`hidden-rows`, with the count).
     Limits (`ID_LIST_XLSX_LIMITS`): the tab's XML plus the shared strings, unpacked, 320 MB (checked
     from the directory before reading; about 5.5 s on the owner's Mac, about 184,000 rows of a
     35-column CD-2-shaped file); `styles.xml` 8 MB, `workbook.xml` and its rels 2 MB each (real ones are
     a few KB); 1,048,576 rows; text kept from rows 1–10, 1 MB —
     past these, `xlsx-too-big`. Every pass also counts the bytes it inflates against that part's own
     directory size, so a directory that understates a part is `damaged`, and the 320 MB bound holds. 16,384 columns; 2 MB fed to saxes since its last event
     (caps any one tag, attribute, comment or text node); 32,767 characters kept per cell; nesting depth
     32 — past these, `damaged`. Each Excel read logs one line, `[id-list] xlsx <file> MB · sheet <n> MB
     + strings <n> MB · <rows> rows · <time> s` (or `refused <code>`, or `no Voter ID column`, in place
     of the sizes and rows): sizes, a row count, a time and a code, never a file, tab or column name, a
     value or an ID. It is there to tune the 320 MB bound against real uploads on the dyno; nobody needs
     to read it otherwise. A CSV read logs nothing.

   Then match **inside
   this campaign** through the one outside-ID lookup,
   [`findVotersByVoterIds`](../server/src/services/voters/voterIdLookup.js): each file ID is reduced to
   its canonical form ([`canonicalVoterId`](../server/src/utils/voterIdKey.js): digits lose leading
   zeros, anything with a letter is exact, all-zero is no ID) and searched under every spelling a
   stored row could carry — the bare number and each zero-padded width up to the widest numeric ID the
   campaign holds — in one `$in` on the existing `{campaignId, stateVoterId}` index. Symmetric: a
   stripped list finds a padded campaign, a padded list finds an unpadded one. Returns
   `{ columns, col, totalRows, keptRows, keep, sheetName, otherSheets, csvCount (distinct IDs; the
   name predates Excel uploads), spellings, noId, inCampaign, notFound, notFoundIds (the file's
   spellings), matchedViaZeros, zeroMatchExample, sampleIds }`, or a refusal `{ error, code, columns,
   sheetName, otherSheets, headerRowHint }` before any database work; the unmatched IDs power the
   "Download unmatched" button. A structural test
   ([`voterIdChokePoint.test.js`](../server/test/voterIdChokePoint.test.js)) fails the build if any
   other file looks up an outside ID by exact string.
2. **`classify(campaign, inCampaign)`** — split into `newly` (no existing `VotedVoter`) vs
   `alreadyCount`, and the `affected` household ids.
3. **`previewDrops(...)`** — dry-run union: how many `affected` households would become fully-voted
   if `newly` were marked (no writes).
4. **`recomputeFullyVoted(campaignId, householdIds)`**
   ([services/voted/recomputeFullyVoted.js](../server/src/services/voted/recomputeFullyVoted.js)) —
   for each household, set `fullyVoted = (voterCount > 0 && every voter has a VotedVoter row for
   this campaign)`. Bulk, chunked at 2000.
5. **Import** = create `VotedUpload` (with `keepColumn`/`keptRows` only when the response's `keep`
   left rows out: not `tooMany`/`tooLong`, and fewer values selected than listed) → bulk **upsert**
   `VotedVoter` (`$setOnInsert`, so re-marking
   is idempotent) → `recomputeFullyVoted(affected)` → write `matched`/`doorsDropped`
   (`afterFully − beforeFully`) back to the upload → persist every **unmatched** id as a
   `VotedPendingId` (and clear stale pending ids for ids that matched this time).
6. **Undo** = find `VotedVoter` rows by `uploadId` → `deleteMany` → `deleteMany VotedPendingId` by
   `uploadId` → `recomputeFullyVoted(affected)` → set `undone:true, undoneAt`. Soft on the upload,
   hard on its rows + pending ids.
7. **Sticky re-apply on regular import** — [importProcessor.js](../server/src/services/import/importProcessor.js)
   calls [`reapplyVotedLists(campaignId)`](../server/src/services/voted/reapplyVotedLists.js): any
   `VotedPendingId` (from a non-undone upload) whose voter has **now** been imported graduates into a
   `VotedVoter` (pending row deleted). Then `recomputeFullyVoted` runs over the union of those doors,
   the currently-dropped doors, and both doors of every move the import made (`ImportJob.movedHouseholdIds`).
   So a voter who was on a prior list stays marked (the door doesn't wrongly re-open, and a brand-new
   all-voted household drops), a **genuinely new, un-voted** voter still re-opens its door, and a voted
   voter who moved finishes the door they joined or left. Every other write that changes a door's
   residents (walk-up add and delete, import undo) recomputes through `recomputeResidentFlags`. Graduation matches the way the upload matched — leading zeros
   ignored, inside the campaign — and clears parked rows by canonical ID, whatever spelling they were
   parked under. (Its do-not-contact twin, `reapplyDncLists`, is deliberately exact: it is org-wide,
   and two states can issue the same digits; see [VOTERS.md](VOTERS.md).) The clear
   (`clearParkedByCanonical`, shared with both upload routes) deletes on the index — every spelling of
   each ID up to the widest spelling parked in scope, always inside the caller's own campaign or
   organization — and never reads the parked pile itself; since a list parks its unmatched IDs once per
   upload, the pile runs to millions of rows during early voting (2026-10-19;
   [PROPOSAL_PARKED_IDS.md](PROPOSAL_PARKED_IDS.md) has the rest of that fix, planned for after Election
   Day).

## C. Endpoint reference

Mounted at `/admin/campaigns/:campaignId/voted` ([routes/index.js:46](../server/src/routes/index.js#L46)),
behind `requireCampaignManager` (org admins, and team leads for the campaigns they manage), campaign
loaded/validated per request.

| Method · path | Body | Returns |
|---|---|---|
| `POST /preview` | `multipart/form-data`: `file` (CSV or `.xlsx`) (+ optional `idColumn`; + optional `keepColumn`, and `keepSelected`, a JSON array of values sent as a string) | `{ idColumn, columns, sheetName, otherSheets, keep, keptRows, sampleIds, totalRows, idsInFile, spellings, noId, matched, matchedViaZeros, zeroMatchExample, willMark, alreadyVoted, notFound, notFoundIds, doorsWillDrop }` — no writes. `idsInFile` counts distinct IDs (two spellings of one ID once); `noId` rows (blank, all-zero) are never looked up or parked, so `idsInFile = matched + notFound` when the campaign holds each person once. `sheetName`/`otherSheets`: the tab read and the other visible tabs (`null`/`[]` for a CSV). `keep`: `null`, or `{ column, values: [{ value, rows }], selected, tooMany, tooLong }` — `values` counted before filtering, `selected` what was applied (every value when no `keepSelected` was sent); `keptRows`: the rows that went on to matching (`totalRows` when nothing was left out) |
| `POST /import` | same; the page sends the last preview response's `idColumn`, `keep.column` and `keep.selected`, never local state | `{ uploadId, idColumn, matched, matchedViaZeros, zeroMatchExample, noId, marked, alreadyVoted, notFound, notFoundIds, doorsDropped, totalRows, keptRows }` (`keptRows` `null` unless rows were left out); the `VotedUpload` records `idColumn`, `matchedViaZeros` and, when rows were left out, `keepColumn`/`keptRows` |
| `GET /` | — | `{ uploads:[…last 50…], totalVoted, fullyVotedDoors }` |
| `POST /undo` | `{ uploadId }` | `{ ok, removed }` — un-marks a whole upload |
| `POST /unmark` | `{ stateVoterId }` | `{ ok, removed, reopened }` — un-marks one voter, typed with or without leading zeros; every row the ID names in this campaign is un-marked (`removed` counts them) and their doors recomputed |

`notFoundIds` is capped at 10k and powers the web "Download unmatched" button.

**Refusals.** Every 400 from reading the file is `{ error, code, columns, sheetName, otherSheets,
headerRowHint }` (since 2026-10-28 this route sends the `code` the do-not-contact route already sent).
`columns` is non-empty only on the code-less *Could not detect a Voter ID column — pick one with
idColumn.*, the one refusal a page answers with the column picker, and only it carries a
`headerRowHint`; every coded refusal sends `columns: []`, so its sentence is never hidden behind the
picker. Codes: `legacy-xls` (old-format or password-protected Excel; now sent by these three uploads
too), `damaged`, `chart-tab`, `no-header-row`, `hidden-rows`, `xlsx-too-big`, `keep-column` (*That
column isn't in this file.*), `id-column` (an `idColumn` sent more than once, which arrives as an array:
*Pick one Voter ID column.* — never a quiet fall-back to the detected column). A malformed counting request is a 400 `keep-selected` before the file is
read, never taken as "count every row": a `keepSelected` that isn't a JSON array of strings (*keepSelected
must be a JSON array of values.*), a `keepSelected` with no `keepColumn` (*keepSelected needs a
keepColumn.*), or a `keepColumn` that isn't one string (*keepColumn must be one column name.* — sent
twice, multer makes it an array).

**Upload limit.** Both uploads go through [`uploadIdList`](../server/src/middleware/idListUpload.js),
shared with the do-not-contact upload and a saved search from a list (`…/walklists/from-csv`, a path
kept from when it took CSV only): multer `memoryStorage`, capped at **50 MB**, an `.xlsx` included; what bounds a workbook beyond that is what's inside it (the reader's
limits, §B). A file that reaches the cap is a **413 `{ error, code: 'file-too-large' }`** whose error names
the limit and the fix ("Only the Voter ID column is used, so save a copy with just that column and
upload it.") — until 2026-10-27 it was multer's bare "File too large" as a 500. Busboy refuses a file the
moment it *reaches* the cap, so exactly 50 MB is refused too. Why the cap stays: §F.

## D. Effect on the rest of the app

| Area | Effect | Source |
|---|---|---|
| **Doors (mobile)** | Fully-voted households are filtered out of the canvasser's door pool (`fullyVoted: { $ne: true }`) and out of the 30s delta sync (client drops them live); a door the phone lacks that the delta shows knockable again (undo, un-mark, a new un-voted resident) makes it pull a fresh bootstrap (`returningDoorIds`). | [bootstrap.js:196](../server/src/routes/mobile/bootstrap.js#L196), [bootstrap.js:339](../server/src/routes/mobile/bootstrap.js#L339), [map.jsx:516](../mobile/app/(app)/map.jsx#L516) |
| **Books / turf** | Book door counts are computed **live** as "active & not-fully-voted" — on mobile *and* now in the admin turf list (`eligibleDoorCount`), so a book's count shrinks as doors drop. **`Turf.householdIds` is not mutated and turfs are not re-cut**; the stored `Turf.doorCount` is kept for snapshots/splits but no longer shown to admins. | [bootstrap.js:80-94](../server/src/routes/mobile/bootstrap.js#L80), [turfs.js:280](../server/src/routes/admin/turfs.js#L280) |
| **Voters** | Not hidden — flagged `voted: true` in the bootstrap payload and shown with a ✓ badge. No write to the `Voter` doc. | [bootstrap.js:257](../server/src/routes/mobile/bootstrap.js#L257) |
| **Passes** | No interaction — voted filtering is campaign-wide, not pass-specific. Passes/knocks are unaffected. | — |
| **Efforts / Intake** | No interaction with ownership — voted filtering is campaign-wide and **effort-independent** (like passes); a fully-voted door drops from every effort and from Intake. New voters land in **Intake**; the sticky re-apply marks them on the next import, and **claiming** doors into an effort carries the marks (fully-voted doors are excluded from the effort's cuts/maps). | [reapplyVotedLists.js](../server/src/services/voted/reapplyVotedLists.js), [importProcessor.js:66](../server/src/services/import/importProcessor.js#L66) |
| **Campaigns** | The mark is per-campaign; the same voter is tracked independently per campaign. | [VotedVoter.js](../server/src/models/VotedVoter.js) |
| **Canvass status** | Independent. `fullyVoted` is separate from `status` (`unknocked`/`not_home`/…); a dropped door keeps whatever status it had — it just isn't shown. | [Household.js](../server/src/models/Household.js) |
| **Admin reports/metrics** | Fully-voted doors are pulled out of `unknocked` into a dedicated **Voted** coverage segment (they still count in Households; `homesKnocked`/knocks unchanged). | [reports.js](../server/src/routes/admin/reports.js) (`coverageBucketExpr`) |

## E. Frontend mapping

- **Web** — [pages/EarlyVotingPage.jsx](../client/src/pages/EarlyVotingPage.jsx): a **per-campaign
  screen in the campaign drill-in**. It reads `campaignId` from `useParams` (the URL *is* the active
  campaign), so there's **no in-page campaign picker** — just a **read-only campaign label**; it
  redirects to `/campaigns` if the campaign doesn't resolve. Then: the file upload (auto-previews on
  pick), preview stats, **Mark these voters voted**, and the history table (`Voters marked voted` /
  `Doors fully voted` + per-upload **Undo**). The preview, the apply result, and a footnote under the
  history all explain that **"Not found" voters are saved** and auto-marked if those voters are later
  imported into this campaign (the sticky behavior). Routed at
  **`/campaigns/:campaignId/early-voting`**, in the campaign console that org admins and the campaign's
  team leads reach ([App.jsx](../client/src/App.jsx); the server's gate is the wall); the old flat
  `/early-voting` redirects to `/campaigns`. Reached from the **"Early Voting"** item in the
  campaign-scoped sidebar (`CAMPAIGN_NAV`, slug `early-voting`, in
  [navItems.js](../client/src/components/navItems.js)). A file at or over the 50 MB cap is refused the
  moment it's picked and no preview runs (`idListTooBig` /
  `idListTooBigText('the voters who have already voted')` in
  [lib/idListPreview.js](../client/src/lib/idListPreview.js), shared with the other two Voter-ID
  uploads): multer drains the whole body before it answers, so a 149 MB file used to upload in full just
  to be refused. [idListUpload.test.js](../server/test/idListUpload.test.js) keeps the page's limit and
  sentence equal to the server's.
  **Excel, and the shared refusal view (2026-10-28).** The picker takes `.csv,.tsv,.txt,.xls,.xlsx`
  (the Voter Import's list), labelled **Voted-voters file (CSV or Excel)**. Each pick takes the file into
  state and clears the input (`e.target.value = ''`), so picking the same file again fires again; the
  chosen file shows under it (`fileLine`: name · size), the input itself then reading *No file chosen*.
  A failed preview goes through **`refusalView(error, { page: 'early-voting' })`** in
  [lib/idListPreview.js](../client/src/lib/idListPreview.js), which decides it once for the three pages:
  the column box only for the code-less 400 with columns, otherwise the sentence in red, with Early
  Voting's hidden-rows suffix (*Then choose which rows count on this page.*) and, for `xlsx-too-big`,
  `idListTooBigText('the voters who have already voted', { excel: true })`. The column box
  ([IdColumnPicker.jsx](../client/src/components/IdColumnPicker.jsx)'s warning form) gains the tab note
  (`note`), `rowOneLine({ excel })` (a CSV's wording when the refusal has no `sheetName`) and
  `headerRowHintText(headerRowHint)`, and a pre-chosen column (`suggested` = `suggestedColumn(refused,
  lastIdColumn(uploads))`: the newest upload not undone, when this file has that column) with *Your
  last upload used X.*; nothing runs until **Match column**. The tab note (`SheetNote` / `sheetNote`,
  the Voter Import's wording with "columns" made "IDs", in `text-info-fg` for contrast) sits at the top
  of the preview box; on the column box and above a refusal it reads *We read the X tab …*
  (`sheetNote(data, { refused: true })`), and a chart-tab refusal gets none. A request with no answer
  (`status` unset: the network, or a file changed on disk after it was picked) reads
  `requestErrorText`'s sentence, never *Failed to fetch*; a gateway timeout (502/503/504, Heroku's
  answer after 30 seconds while the server may still be working) says to wait and check the upload
  history before trying again. A new preview clears an earlier apply's error. **The preview box stays on
  screen while the next preview runs**: the page renders the last answered preview (`shown`, set by
  call-level `mutate` callbacks, which TanStack fires only for the newest call), and no control in it
  is disabled while a preview runs, so the one the admin is on keeps focus; the **Matched on column**
  and counting selects show what was last ASKED for (`preview.variables` while pending), and every new
  request starts from that, so a change made mid-preview never reverts another. Apply reads
  `preview.data`, empty while a preview runs. **While Mark these voters voted runs, the whole box is
  locked** (`locked = apply.isPending`: both selects and the ticks disabled, every handler a no-op) and
  the file box is off, so the numbers on screen are the numbers being marked. **Count only rows where**
  sits under the stats (hidden for a file with no other column): choosing a column re-runs the
  preview with `keepColumn` (*Listing X's values…* until they arrive — the old column's boxes are not
  offered meanwhile); the ticks are local, kept with the column they were ticked on and filtered to
  that column's values, until **Count these rows** (aria-disabled, not disabled, so focus stays;
  *Counting…* only while a count runs) re-runs it with `keepSelected`; Apply sends the settled
  preview's `keepToSend(…)` and is held, with *Press Count these rows to update the numbers first.*
  (hidden while a preview runs), while `ticksChanged`. A counting column that becomes the ID column is
  dropped. `keptLine` gives *3,224 of 3,260 rows counted (Ballot_Status)*,
  `describeIdsInFile(pv, { counted })` then says *IDs in the rows counted*, and `historySubtitle` adds
  *Ballot_Status: 3,224 of 3,260 rows* from the upload's `keepColumn`/`keptRows`.
- **Mobile** — bootstrap derives the per-voter `voted` flag and drops fully-voted doors (§D). The
  ✓ Voted badge renders in [map.jsx:1447](../mobile/app/(app)/map.jsx#L1447) and
  [household/[id].jsx:104](../mobile/app/(app)/household/[id].jsx#L104) — beside the shared
  [VoterMeta](../mobile/components/VoterMeta.jsx) line (Party · Age · Gender) that both surfaces
  now render. The upload itself is web-only: the phone calls none of the upload endpoints
  (`npm run audit:mobile-api -- --list`), so Excel uploads changed nothing there.

## F. Known interactions & gotchas

Resolved (kept here so the history is clear):

- **Every write that changes a door's residents recomputes `fullyVoted` (2026-10-27).** The walk-up add
  ([canvass.js](../server/src/routes/mobile/canvass.js)) and walk-up delete
  (`DELETE /admin/voters/:voterId`, [voters.js](../server/src/routes/admin/voters.js)) recomputed
  `fullyDnc` and `isActive` but not `fullyVoted`, and import undo
  ([undoImport.js](../server/src/services/import/undoImport.js)) recomputed `isActive` alone. So a person
  added at a door that dropped while a phone still showed it (door screen open, or offline) left it hidden
  with someone there who hadn't voted — the one dropped-wrongly case — and deleting a door's last un-voted
  resident, or undoing the import that added them, left an all-voted door up. All three now call
  [`recomputeResidentFlags`](../server/src/services/households/recomputeResidentFlags.js) (`fullyVoted`,
  `fullyDnc` and `isActive` together); undo also covers an inserted door kept for a do-not-contact
  resident, which the old exclusion skipped, so the DNC twin was fixed in the same change. An import that
  moves people ([importProcessor.js](../server/src/services/import/importProcessor.js)) now recomputes both
  doors of every move (voted and DNC), read right after the write and kept on the job
  (`ImportJob.movedHouseholdIds`) so a crash-retry still finds them; it used to recompute only dropped doors
  and graduated IDs, missing a voted voter's new door and the door an un-voted one left. Locked by
  [residentFlags.int.test.js](../server/test/residentFlags.int.test.js). The remaining window: an import
  that crashes partway through its write loses the moves of the batches already written (the retry sees
  them as no move), which the next upload naming a resident clears, as before.
- **A door that comes back reaches an open phone (2026-10-27).** The fold updates only doors the phone
  holds (a delta row has no address to draw), so a door leaving suppression — undo, un-mark, a new un-voted
  resident, a cleared DNC flag, a refilled door — used to stay off an open phone until a manual refresh, an
  app restart or a pass change. `/changes` now projects every `KNOCKABLE_DOOR_FILTER` flag
  (`KNOCKABLE_DOOR_FLAGS`; `excludedFromTurf` was the missing one), the phone mirrors the rule
  (`isSuppressedDoor` in [deltaFold.js](../mobile/lib/deltaFold.js), held to the server's list by
  [knockableDoorParity.test.js](../server/test/knockableDoorParity.test.js)), and when a delta carries a
  door the phone lacks that passes it and has a pin (`returningDoorIds`), map.jsx pulls a fresh bootstrap —
  the refetch a pass change already used. As a side effect a door taken out of books mid-shift
  (`excludedFromTurf`) now leaves an open phone on the next poll, as it already left a fresh one.
  Dropping was never affected: the recompute's `Household.bulkWrite` bumps `updatedAt` on every door it
  touches (Mongoose 8 timestamps), and the door rides the delta with `fullyVoted: true`.
- **Reports — fully-voted doors now have a "Voted" segment.** They used to inflate `unknocked`;
  `coverageBucketExpr` in [reports.js](../server/src/routes/admin/reports.js) reclassifies
  voted-and-still-unknocked doors into a `voted` bucket in `/overview` and `/campaign-rollup`.
  Households and `homesKnocked` are unchanged. A door knocked *before* it went fully-voted keeps its
  knocked status (only otherwise-`unknocked` doors move to `voted`). See the [metrics doc](METRICS.md).
- **Admin turf counts are live.** The admin turf list returns `eligibleDoorCount` (active &
  not-fully-voted), so books no longer show a stale stored `doorCount`.
- **Per-voter unmark exists.** `POST …/voted/unmark { stateVoterId }` fixes a single mistaken mark
  (re-opening the door if needed), in addition to whole-upload undo.
- **Unmatched rows are downloadable.** Preview/import return `notFoundIds`; the Early Voting page
  offers a "Download unmatched" CSV so the admin can fix the file and re-upload.
- **Early voting is sticky across universe re-imports.** Unmatched ids are persisted as
  `VotedPendingId`; a regular import graduates any that now match (`reapplyVotedLists`), so a voter
  who was on a prior list and is imported later is still marked — the door doesn't wrongly re-open,
  and a brand-new all-voted household drops. Only a genuinely **new, un-voted** voter re-opens a door.
  Undoing an upload also clears its pending ids so they never re-apply.
- **Leading zeros are ignored, in both directions (2026-09-30).** Georgia pads IDs to eight digits
  (`08719967`) and Excel strips the zeros the moment a file is saved; Nebraska, Connecticut and Kentucky
  files number voters without padding, so the state's own padded file would miss them. Every outside
  ID (uploaded, typed, parked) now goes through `services/voters/voterIdLookup.js`, which searches every
  spelling at once; the preview reports `matchedViaZeros` with an example pair, and the page shows
  the column it matched on with a dropdown to change it. Stored IDs keep the spelling their file used;
  only the matching changed. The import side is a **gate**, not a match: a voter file whose IDs name
  existing voters only by zeros is refused by the worker (see [IMPORTS.md](IMPORTS.md)). Background and
  the deferred parts (adoption or a stored key, the do-not-contact job): [PROPOSAL_VOTER_ID_KEYS.md](PROPOSAL_VOTER_ID_KEYS.md).
- **Multiple uploads accumulate pending ids.** `VotedPendingId`'s `{campaignId, stateVoterId}` index is
  **non-unique**, so each upload banks its **own** unmatched ids (one row per upload); the pending pool
  is the **union** across non-undone uploads, so re-uploading another list grows it. `reapplyVotedLists`
  graduates by **distinct `stateVoterId`** and deletes **every** pending row for a graduated id, so the
  same id listed by two uploads **collapses to a single `VotedVoter`** mark. Undo removes only that
  upload's pending rows (others survive).

Still true:

- **Verified across walk lists and passes (2026-10-27).** A scenario run over the real routes and a
  throwaway mongod: 7 to 50 walk lists with one to four passes each in every state (archived, live, a
  cut-and-accepted next pass, a walk list with no live pass), 31 to 241 books, shared books, books in
  archived and draft passes, Intake doors, walk-up voters, a sibling campaign holding the same people,
  and three cumulative daily lists spelling IDs with and without zeros. Every door's `fullyVoted`, the
  preview and import counts, each walker's bootstrap (doors, `voted`, book `doorCount`, `/me/today`
  `remaining`), an open phone's `/changes` replayed through
  [`mobile/lib/deltaFold.js`](../mobile/lib/deltaFold.js), the admin turf list's `eligibleDoorCount`,
  packets, a fresh cut, add-on books after a claim, pass activation, the import re-apply, undo and
  un-mark all matched an oracle written independently of this code; a planted missed drop failed the
  phone check. Why it holds: `parseAndMatch` is scoped to `{ campaignId }` alone and
  `recomputeFullyVoted` keys on the household, so marking has no walk-list, pass or book input; and
  every canvasser surface applies `KNOCKABLE_DOOR_FILTER` when it serves, not when a book is cut.
- **Checking real data.** `npm run audit:voted-doors -- --campaign=<campaign id>` from the Heroku
  dashboard's Run console ([OPERATIONS.md](OPERATIONS.md)) is read-only: Check A counts dropped doors
  hiding someone who hasn't voted (must be 0), Check B all-voted doors still up (expected 0 since the
  2026-10-27 resident-flag fix; a door from before it, or from an import that crashed mid-write, clears at
  the next upload that lists a resident), Check C stray marks. Without `--campaign` it walks every campaign
  of every organization. Run from the repo root on the scenario's data: 0 / 0 / 0.
- **Matching is `stateVoterId`-only.** Voters without a `stateVoterId`, or a file with no detectable
  Voter ID column and none picked, won't match (they land in `notFound` → download & fix). Sticky
  re-apply also keys on `stateVoterId`.
- **Undo is per-upload and soft.** A voter marked by two uploads stays voted until both are undone
  (or use per-voter unmark). The `VotedUpload` is flagged `undone`, not deleted.
- **Campaign-scoped.** Uploading to the wrong campaign marks no one useful (matches are filtered to
  that campaign's households); re-upload to the correct campaign.
- **`voteMethod` is unused.** The schema field exists but the upload doesn't populate it, from either
  format.
- **The 50 MB cap is load-bearing for a CSV.** A CSV's whole buffer still becomes one string that Papa
  parses every column of, every row, on the web dyno, though only the ID column is used (and, with
  *Count only rows where*, one more). Measured 2026-10-27 on Nebraska's statewide early-ballot file (85
  columns, 273,834 rows, 149 MB; parse only, no database): ~860 MB peak for its first 50 MB, ~2.3 GB for
  the whole file — on the 1 GB web dyno. Raising the number alone would take the web dyno down; the
  owner ruled 2026-10-27 that the cap stays, with no streaming rework of the CSV path. An `.xlsx` is
  read differently — one or two columns, kept compactly, about 186–272 MB peak for the whole process at
  the reader's bound (measured on the owner's Mac for the plan) — but the bound is on what's inside the
  file: 320 MB unpacked, about 184,000 rows of a 35-column file, so a whole state's file doesn't go in
  as a workbook either. That file was also not a voted list: 101,564 of its rows had no ballot returned
  yet, which is why the refusals say to keep only the people who have already voted, and why *Count
  only rows where* exists.
- **Excel uploads (2026-10-28).** What the reader refuses and why ([PROPOSAL_ID_LIST_EXCEL.md](PROPOSAL_ID_LIST_EXCEL.md) §A.10):
  - **Hidden rows.** Excel's filter writes `<row … hidden="1">`, and the Voter Import's readers return
    those rows like any other, so a reader built the same way would count all 3,260 rows of the CD-2
    file filtered to `ACCE` in Excel. Refused instead, with the count, on all three
    uploads: refusing can never mark the wrong person voted, and on the do-not-contact list it can never
    leave someone off. A hidden row with no ID doesn't refuse the file. (The Voter Import still reads
    hidden rows; unchanged.)
  - **Tabs.** The first visible tab, by the Import's own rule, now prefix-tolerant: a workbook written
    as `<x:workbook><x:sheets>` used to match nothing and fall back to `sheet1.xml`, which can be a
    hidden tab ([IMPORTS.md](IMPORTS.md) §G). The page names the tab whenever there are others.
  - **Torn, altered or crafted files.** unzipper checks no CRC and saxes reports an unclosed tag only on
    `close()`: in the plan's review, a reader without these checks read 499 of 1,000 IDs from a sheet
    torn at row 501, with no error, and single-bit flips gave wrong IDs. Every full pass closes the
    parser and checks the part's CRC-32 and size; the limits cap whole-part inflates, deep nesting and
    single huge tokens.
  - **The 30-second request limit.** About 5.5 s for the reader at its bound on the owner's Mac; Heroku
    is unmeasured, which is what the log line is for. An apply that runs past 30 seconds keeps running
    on the dyno and writes after the browser has shown an error, so check the upload history before
    applying again.
  - **A file edited after it was picked** fails to post (Chrome reads it as *NotReadableError* after an
    atomic save; the page says *We couldn't read the file or reach the server. If you changed the file
    after picking it, pick it again …*): pick it again.
- **Undo order with rows left out.** Undo removes only the `VotedVoter` rows carrying that upload's
  `uploadId`, and a re-upload's `$setOnInsert` never re-claims a voter an earlier upload marked. So
  after an unfiltered upload and a filtered re-upload of the same file, undoing the unfiltered one
  leaves nobody marked (the filtered one marked nobody new). To redo an upload with rows left out, undo
  the earlier one first.
