# Proposal: Excel files on the Early Voting, Do-not-contact and Saved Search uploads

> **Status: BUILT 2026-10-28 (uncommitted) to plan v3, after both plan review rounds; the owner said
> yes to all three calls the same day. Where the build differs from the plan is in [§J As built](#j-as-built-2026-10-28);
> both code review rounds follow it (§J.1, §J.2), every finding fixed except a few nits each round
> lists as left by decision.**
>
> - **Owner calls** (Part 1 *Your calls*), all ruled **yes** 2026-10-28: A. let Early Voting count
>   only some rows (by ballot status); B. offer the last upload's ID column when a file's column isn't
>   recognised; C. refuse a file with rows hidden in Excel.
> - **Review:** two rounds, five reviewers, three of them driving the real code against built
>   workbooks. Round 1 found 2 blockers and 9 majors; round 2 found 1 blocker (found by both of its
>   reviewers) and 7 majors, mostly in what v2 added. v3 fixes all of them (§I).
> - **Scope:** the server and the web console. Nothing ships to phones: none of the six upload
>   endpoints is called by the mobile app (`npm run audit:mobile-api -- --list`).
> - **Privacy:** it changes how an uploaded voter file is read, so it is treated as privacy-relevant
>   (§E). No disk copies, no new third party, nothing newly exposed; no published sentence changes.
> - **Line references:** HEAD `44bb72d` for files only this change touches. Files another session is
>   also editing are cited by their text, not line numbers (§F). Every timing here was measured on the
>   owner's Mac, not on Heroku.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (the Early Voting upload), [VOTERS.md](VOTERS.md) (the
do-not-contact list upload), [WALKLISTS.md](WALKLISTS.md) and [EFFORTS.md](EFFORTS.md) (a saved search
built from a list), [IMPORTS.md](IMPORTS.md) (the Voter Import's Excel readers),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

---

# Part 1 — For everyone

## Why this is changing

Three pages take a list of Voter IDs: **Early Voting**, the **Do-not-contact list**, and a **saved
search** built by uploading a list. All three take CSV and other text files only. An Excel workbook
(`.xlsx`) shows grayed out in the file picker. The Voter Import page has always taken `.xlsx`.

It came up on 2026-10-28: Nebraska's CD-2 ballot-returns file arrived as an `.xlsx` (3,260 rows,
35 columns) and had to be turned into a CSV by hand.

The pages also contradict themselves today. Pick an old-format Excel file (`.xls`, Excel 97–2003) on
any of the three and the refusal says *Save As → Excel Workbook (.xlsx), then upload the .xlsx* — a
file the same picker then grays out.

## What changes, in short

- All three pages take `.xlsx` files, as well as everything they take now.
- The preview, the **Matched on column** picker, applying, the upload history and **Undo** work the
  same for both kinds of file.
- **Several tabs:** only the first tab you can see is read, the same rule as the Voter Import. When the
  workbook has other tabs, the page names the tab it read and the ones it ignored — on the preview, on
  the *Couldn't find a Voter ID column* box, and on any refusal.
- **A file is read whole or refused, never read partly.** A damaged workbook, one cut short, or one
  built to overload the server is turned away with a plain reason, not read for some of its rows.
- **Rows hidden in Excel** (by a filter, say) are never quietly counted: see call C.
- **Column names below a title row:** the *Couldn't find a Voter ID column* box says which row the
  column names look like they're in, and to delete the rows above them.
- Picking the **same file again** after fixing it in Excel now re-runs the preview. Today nothing
  happens until the page is reloaded.
- "CSV" becomes "CSV or Excel" on the three pages, and a saved search built from a list is badged
  **uploaded** instead of **from CSV**.
- **Fixed on the way:** on Saved Searches, a refused file showed an empty "pick a column" box instead
  of the reason.

## What you'll see

**Early Voting.** The box is labelled **Voted-voters file (CSV or Excel)**, with the chosen file's name
under it. Pick the CD-2 `.xlsx` and the preview runs straight away, matched on `Registrant_ID` (that
column name is recognised now). With call A, the preview has a line **Count only rows where [column]**.
Choose `Ballot_Status`, untick `REJE` and `SUSP`, press **Count these rows**, and the preview shows
*3,224 of 3,260 rows counted (Ballot_Status)*: the same numbers as the accepted-ballots CSV made by hand
on 2026-10-28.

**A workbook with more than one tab.** At the top of the preview box, and on the *Couldn't find a Voter
ID column* box or a refusal when that's what appears:

> These IDs come from the **CD-2 Records** tab — the first tab in the file, and the only one read.
> The Summary tab is ignored. If your list is on a different tab, move it to the front of the
> workbook and upload again.

Nothing is said for a CSV or a one-tab workbook. This is the Voter Import's wording, with "columns"
made "IDs".

**When the Voter ID column isn't found**, the box lists the file's columns to pick from, as now, and
adds a line: *Column names need to be in row 1 of the first tab.* When row 1 holds a single cell (a
title, say) and a lower row looks like the column names, it says so: *The column names look like
they're in row 3. Delete the rows above them, save, and upload again.* With call B, the column your
last upload used is already chosen in the list: *Your last upload used SOSID.* Press **Match column**
to use it.

**Do-not-contact list.** The box is labelled **Do-not-contact file (CSV or Excel)**. Pick the state
first, as now.

**Saved Searches.** The choice reads **Filter builder | Upload file**, the box **Voter-ID file (CSV or
Excel)**, and the help line *Upload a CSV or Excel file of Voter IDs*. A saved search made this way is
badged **uploaded** (the file name stays on the badge's tooltip). The Walk Lists page's menus say
**· uploaded** after it.

**When an Excel file can't be read**, the page says why, in red, in place of the preview:

| What was picked | What the page says |
|---|---|
| An old Excel 97–2003 `.xls`, or a password-protected or restricted workbook | This is an old-format Excel file (.xls, Excel 97–2003) or a password-protected one, which we cannot read. Open it in Excel, remove any password or access restriction, then use File → Save As → Excel Workbook (.xlsx), and upload the .xlsx. *(The Voter Import shows the same sentence.)* |
| A damaged workbook, or a file that isn't really an `.xlsx` | We couldn't read this file as an Excel workbook. Open it, save or export it as .xlsx or CSV, and upload that. |
| A chart as the first tab | The first tab, Chart1, is a chart. Move the tab with your list to the front of the workbook and upload again. |
| Nothing in row 1 | The Sheet1 tab has no column names in its first row. Put the column names (like Voter ID) in row 1, then upload again. |
| Rows hidden in Excel (call C) | 36 rows on the CD-2 Records tab are hidden (by a filter, for example). Hidden rows are still in the file, so they would be counted. Clear the filter or delete those rows, save, and upload again. *(Early Voting, with call A, adds: "Then choose which rows count on this page.")* |
| A workbook too big to read | This Excel file is too big for us to read. Only the Voter ID column is used, so save a copy with just that column and upload it. *(Early Voting, like its 50 MB message, adds "keeping only the voters who have already voted".)* |

Each of these also gets the tab sentence above when the workbook has other tabs.

**How big an Excel file can be.** Up to 50 MB, like a CSV. Separately, what's inside its first tab has
to be readable in a few seconds: for a file shaped like the CD-2 returns (35 columns) that's about
184,000 rows; fewer for wider files. Bigger than that is refused at once with the last message above.
A county's or a district's returns file is far below it; a whole state's file can be past it, and is
usually past the 50 MB limit anyway.

## Your calls

**A. Should Early Voting take an election office's returns file as it comes, and let you choose which
rows count?** Recommended: **yes**. Every file this week needed rows removed by hand: CD-2 (only
`ACCE` ballots count), Nebraska's statewide file (37% were ballots not yet returned), and Summit
County's (only `VALID`). With Excel accepted, the raw file goes in with a few clicks and believable
numbers, and the rejected and suspended ballots get marked voted unless something stops them.

With this, the preview offers **Count only rows where [column]**. Choose a column and it lists that
column's values with their row counts (`ACCE · 3,224`, `SUSP · 26`, `REJE · 10`), all ticked; untick
what shouldn't count and press **Count these rows**. Applying uses exactly what was counted. It is on
Early Voting only; the Do-not-contact list and saved searches don't get it.

The upload history keeps **the column used and how many rows counted** (*Ballot_Status: 3,224 of
3,260 rows*), not which values were ticked. Every voter an upload marks is linked to that upload, so
keeping the values would record something about each of them: with a ballot-type column, how they
voted, which Doorline otherwise never stores. If you'd rather the history show the values too, say so;
the privacy record then has to say it.

To redo an upload with rows left out, **undo the earlier upload first**: Undo removes only the marks an
upload made itself, so undoing the unfiltered one after a filtered re-upload would leave nobody
marked.

Without this call the plan still works, but step 3 of *After it's built* stays a preview-only check.

**B. When a file's Voter ID column isn't recognised, should the page offer the column your last upload
used?** Recommended: **yes**. Summit County's ID column is called `SOSID`, which nothing recognises,
so it has to be picked by hand on every upload. With this, the *Couldn't find a Voter ID column* box
comes up with your last upload's column already chosen, when the new file has a column by that name
(*Your last upload used SOSID*), and you press **Match column**. It is never chosen without you: a
column with a common name like `ID` can hold row numbers, and short Nebraska IDs would match real
voters.

**C. Rows hidden in Excel.** Excel's filter hides rows; it doesn't remove them, and the file keeps
them. Today, hidden rows are read like any other, so filtering the CD-2 file to `ACCE` in Excel and
uploading it would count all 3,260 (the CD-2 sheet already has Excel's filter buttons on). Recommended:
**refuse the file and say how many rows are hidden** (the table above), on all three pages. Refusing
can never mark the wrong person voted, and on the do-not-contact list it can never leave someone off.
The other option is to leave hidden rows out on Early Voting and say so in the preview. That matches
what you see in Excel, but on the do-not-contact list leaving people out is the dangerous direction,
so it would still refuse there. (The Voter Import still reads hidden rows; it isn't changed here.)

**Decided in the plan; say if you disagree:** the **uploaded** badge wording; recognising
`Registrant_ID` and `TEXT_REGISTRANT_ID` as the Voter ID on these three pages (not on the Voter
Import); one message for old-format and password-protected files; the title-row line; the size limit
above.

## What doesn't change

- **Only the Voter ID column is used** (plus, with call A, the one column you choose to count by).
  Nothing else in the file is kept, and the file is never saved: it is read in memory and thrown away
  when the page gets its answer, exactly as a CSV is today. The upload history keeps the file's name
  and the column matched on, as now, and with call A the counting column and how many rows counted.
- **The file still has to be the right list.** Without call A, accepting Excel filters nothing: an
  election office's returns file can carry rejected or suspended ballots (the CD-2 file has 36), and a
  state's file can list every ballot sent out. Keep only the people who already voted.
- The 50 MB limit; matching with or without leading zeros; the state rule for the do-not-contact
  list; IDs not yet in the campaign being remembered; per-upload **Undo**.
- **The Voter Import:** only its old-format message changes, plus two fixes it shares with these pages
  that give the same results on ordinary files: a very long column name can no longer stall the
  server, and a workbook saved with unusual internal formatting reads the right tab.
- Phones: nothing changes, and no app update is needed.
- **If you edit a file after picking it,** pick it again before applying; the browser can't send a file
  that changed after it was chosen.

## What you'll do after it's built

1. Commit everything with one `git add -A`, together with the other two sessions' work in the tree
   (the walk-list archive and the client-report links).
2. Deploy from `main` **by those two plans' release steps**. The commit carries them: the walk-list
   archive's one-time repair (dry run, then `--apply`), its index build and its phone update (staging,
   then production), and the client-report links' key check before deploy and console report after.
   This change adds no console step, index or phone update of its own.
3. On Early Voting, pick the CD-2 `.xlsx`. It should match on `Registrant_ID` and show 3,260 IDs, 36
   more than the accepted-ballots CSV's 3,224. With call A, choose `Ballot_Status`, untick `REJE` and
   `SUSP`, press **Count these rows**: every count should then equal the CSV's preview. Without call A,
   **preview only, don't apply**: the file still has the 36 rejected and suspended ballots.

---

# Part 2 — Technical reference

## A. What the design rests on (checked at `44bb72d`)

1. **One parse function behind six routes.** Early Voting (`POST /admin/campaigns/:id/voted/preview`
   and `/import`, [voted.js:81](../server/src/routes/admin/voted.js#L81), `:111`), the do-not-contact
   list (`POST /admin/dnc/preview` and `/import`, [dnc.js:99](../server/src/routes/admin/dnc.js#L99),
   `:133`) and a saved search from a list (`POST /admin/campaigns/:id/walklists/from-csv/preview` and
   `/from-csv`, [walklists.js:150](../server/src/routes/admin/walklists.js#L150), `:190`) take the file
   through `uploadIdList` (multer `memoryStorage`, 50 MB,
   [idListUpload.js](../server/src/middleware/idListUpload.js)) and parse it in
   `parseIdsAndFindVoters` ([parseVoterIdList.js:19](../server/src/services/import/parseVoterIdList.js#L19)):
   the legacy-`.xls` refusal (`:25`, no `code` sent), `fileBuffer.toString('utf8')` through Papa
   (`:26-27`), the column rule (`:29-34`), then the database half. `parseAndMatchState` repeats the
   legacy check (`:97`). An `.xlsx` that reaches it today (a renamed file) is read as text: a few junk
   columns, then *Could not detect a Voter ID column*.
2. **The pickers.** `accept=".csv,.tsv,.txt,.xls"` at
   [EarlyVotingPage.jsx:132](../client/src/pages/EarlyVotingPage.jsx#L132),
   [DoNotContactPage.jsx:147](../client/src/pages/DoNotContactPage.jsx#L147) and in `WalkListsPage.jsx`;
   the Voter Import has `.csv,.tsv,.txt,.xls,.xlsx` ([ImportPage.jsx:880](../client/src/pages/ImportPage.jsx#L880)).
   No page reads the file in the browser: they check its size and post it. Each `onChange` takes
   `e.target.files[0]` and never clears the input (EarlyVotingPage.jsx:134, DoNotContactPage.jsx:149),
   so choosing the same file again fires no `change` (headless Chrome, round 1). A file edited on disk
   after it was picked fails to post (*Failed to fetch*; reproduced in Chrome after an atomic save).
3. **Error rendering.** Early Voting and Do-not-contact show the column box whenever the 400 carries a
   non-empty `columns` (EarlyVotingPage.jsx:103, DoNotContactPage.jsx:107), and then hide the message
   (`:148`, `:164`). Saved Searches tests `columns` for truthiness, so `columns: []` gives an empty
   picker and hides the message. voted.js:85 and walklists.js:154/:196 drop `code` from their 400s;
   dnc.js:96 forwards it. TanStack Query clears a mutation's `data` while it is pending, so each
   re-preview hides the preview box until the answer arrives (today, on a column change, too).
4. **The legacy refusal's text** ([parseUpload.js:44-53](../server/src/services/import/parseUpload.js#L44-L53))
   ends *then upload the .xlsx*. Tests match only `/old-format Excel file/`
   (`legacyXlsRefusal.int.test.js:90`, `:126`; `parseUpload.test.js:99`). The Voter Import route
   (`typedParseRefusal`, imports.js:94) and the worker (importProcessor.js:635) key on the error's
   `name`.
5. **Not mobile-facing.** `npm run audit:mobile-api -- --list` names none of the six endpoints. No
   OTA, no client-version gate.
6. **The Voter Import's two Excel readers, and why neither is reused.** `streamParse`
   ([parseUpload.js:243](../server/src/services/import/parseUpload.js#L243), exceljs) is wrong on 14 of
   36 cell kinds (phonetic text instead of the value, only the last run of inline rich text, entities
   decoded twice, booleans as `true`), reads zero rows from later tabs of a workbook with no shared
   strings, throws on cells with no `r`, and never settles on a sheet whose compressed data is cut
   short. `peekUpload` ([peekUpload.js:134](../server/src/services/import/peekUpload.js#L134), unzipper
   + saxes, five rows) reads its small parts with `entry.buffer()` (`entryToString`, `:41-44`), which
   inflates a part whole before trimming it: a 598 KB file whose `styles.xml` or `workbook.xml` inflates
   to 600 MB took peekUpload to 872–1,176 MB. Both choose the tab with `resolveFirstSheetTarget`
   (`parseUpload.js:103`) over `listWorkbookSheets` (`:132`), which matches only an unprefixed
   `<sheets>`: a workbook written with an `x:` prefix falls back to `sheet1.xml`, which can be a hidden
   tab (reproduced; it affects the Import's preview too).
7. **The column matcher can be stalled.** `suggestMapping`'s word splitter
   ([canonicalFields.js:160](../server/src/services/import/canonicalFields.js#L160),
   `/([A-Z]+)([A-Z][a-z])/g`) is quadratic on a run of capitals with no lowercase letter after it:
   92 ms at 8,000 capitals, 362 ms at 16,000, 1.5 s at 32,767, and a 330 KB workbook of 15,000 such
   headers ran over 7 minutes. `/([A-Z])(?=[A-Z][a-z])/g` gives identical output on 300,016 strings
   (random and real headers) and takes under a millisecond. Long lowercase headers cost too: 111.6 s
   and 762 MB on one crafted file. This is today's CSV path and the Import's mapping step as well.
8. **Measured on this Mac** (Node 20.19.5; exceljs 4.4.0, saxes 5.0.1, unzipper 0.10.14), on synthetic
   voter-shaped workbooks (no real people) and the real CD-2 file; peak memory is the process's maximum
   resident set size, file buffer included. Round-1 and round-2 reviewers re-ran these within about 5%.

   | Workbook | Size | Unpacked sheet | Rows × columns | `streamParse`, one column kept | One-column reader |
   |---|---|---|---|---|---|
   | Inline strings | 48.5 MB | 304 MB | 260,000 × 35 | 15.8 s, 305 MB | 5.8 s, 237 MB |
   | Shared strings | 45.9 MB | 276 MB + 6 MB strings | 260,000 × 35 | 13.1 s, 350 MB | 5.8 s, 249 MB |
   | Shared strings, wide | 47.6 MB | 250 MB + 2 MB strings | 95,000 × 85 | 11.9 s, 330 MB | 5.1 s, 272 MB |
   | At the 320 MB bound, with CRC and hidden-row tracking | — | 320 MB | — | — | 5.3–5.5 s, 186–212 MB |
   | One column, long, compact storage | — | — | 1,048,575 × 1 | — | 237–240 MB (numbers), 302–305 MB (shared strings) |
   | Real CD-2 file | 0.46 MB | 5.4 MB | 3,260 × 35 | — | 0.1 s, 84 MB |

   The floor for any saxes reader (unzip, tokenise, no-op handlers) is 4.1–4.8 s on the three big
   workbooks. **The synthetic files compress 5–6 times; the real CD-2 sheet compresses 11.8 times**
   (about 1,745 bytes of sheet XML per row, 1,824 once row numbers reach six digits). Event-loop delay
   during a read stays at p99 ≤ 10 ms on deflated sheets; a stored (uncompressed) sheet arrives as one
   chunk and blocked it for 639 ms until fed in slices. The CSV path on a 50 MB, 85-column CSV: about
   860 MB and 1.8 s, one synchronous call (2026-10-27).
9. **`streamParse` writes files like CD-2 to disk twice:** an `xlsx-norm-*.zip` (its `workbook.xml` and
   `styles.xml` are stored after the sheet) and an exceljs `tmp-*` spool of the unpacked sheet (exceljs
   spools every sheet of a workbook with no `sharedStrings.xml`), both gone within a second. unzipper's
   `Open.buffer` only slices the buffer and saxes has no file access; the reader writes nothing.
10. **What a file can hide** (all reproduced):
    - **Hidden rows.** Excel's filter writes `<row … hidden="1">`; every reader here returned those rows.
      The real CD-2 sheet carries `<autoFilter ref="A1:AI3261"/>` (no hidden rows yet).
    - **A torn sheet.** A valid zip around sheet XML that stops at row 501 returned 499 of 1,000 IDs
      with no error: saxes reports unclosed tags only on `close()`.
    - **A flipped bit.** unzipper checks no CRC-32: of 200 single-bit flips in a sheet's compressed
      data, 28 returned wrong or missing IDs with no error.
    - **Bombs.** Whole-part inflates (above); 3 million nested tags in a 10 KB zip (+528 MB); a single
      300 MB attribute, comment or text node in a 300 KB file (+420–556 MB), because saxes holds a
      whole token before any handler sees it.
    - **Zip tails.** unzipper finds the end record only in the last 80 bytes, so a valid zip with a
      comment over about 58 bytes fails; a larger fixed `tailSize` breaks small zip64 files and a
      workbook whose last member is an embedded `.xlsx`.
11. **Heroku.** One Standard-2X web dyno (1 GB). The router cuts a request at 30 seconds (H12), counted
    from when the body reaches the dyno, and the dyno keeps working: an apply that runs long still
    writes after the browser has shown an error.

## B. The design

### B.1 Which reader: by the file's bytes, never its name

In `readIdList` (§B.3), first:

1. Starts with the OLE2 signature (`looksLegacyXls`) → `LegacyXlsError` (widened message, §B.5).
2. Starts with a zip signature, `PK\x03\x04` or `PK\x05\x06` → the Excel reader (§B.2). Four bytes,
   not two: a CSV whose first column is named `PK…` reads as a CSV today and must keep doing so.
3. Anything else → the CSV path, unchanged.

The filename is never passed in. A CSV renamed `.xlsx` reads as a CSV; an `.xlsx` renamed `.csv` reads
as Excel.

### B.2 The one-column Excel reader: `server/src/services/import/readIdColumn.js`

`readIdColumn(buffer, { pickColumn, keepColumn, limits })` returns
`{ headers, col, values, keepColumnValues, totalRows, sheetName, otherSheets, headerRowHint }`, or
throws an `IdListReadError` with a `code` and an owner-worded `message`. It is peekUpload's design
(central-directory random access, saxes, only the shared strings actually cited), taken from "five
rows, every column" to "every row, one or two columns". It shares only **pure text functions** with
the Voter Import and reads every part itself, through its own capped streams.

**Limits** (`limits` lets tests inject small ones):

| Limit | Value | Why |
|---|---|---|
| The tab's XML plus the shared strings, unpacked | 320 MB | A time bound: about 5.5 s here; about 184,000 rows of a CD-2-shaped file. Checked from the central directory before reading, and again by counting the bytes each pass inflates (a directory can lie). |
| Each small part (`workbook.xml`, its rels, `styles.xml`) | 8 MB | Read through the capped stream, never `entry.buffer()`. |
| Rows | 1,048,576 | Excel's own limit. |
| Column index | 16,384 | Excel's own limit (XFD). |
| Bytes fed to saxes since its last event | 2 MB | Caps any one tag, attribute, comment or text node. A real cell is at most 32,767 characters. |
| Text kept per cell | 32,767 characters | Excel's own limit; kept only for the ID and counting columns. |
| Text kept from rows 1–10 | 1 MB | For the headers and the title-row line. |
| Column-name length considered for matching | 255 characters | Longer names are listed but never matched (§A.7). |
| XML nesting depth | 32 | A real sheet nests about 7 deep. |

Past the first three: `xlsx-too-big`. Past the rest: `damaged`.

**Steps:**

1. **Open.** Find the end record by scanning back from the end of the buffer for the last
   `PK\x05\x06` whose comment length reaches exactly the end of the file, and pass
   `tailSize = length − offset` to `unzipper.Open.buffer`. (A fixed 80-byte tail misses long
   comments; a fixed larger one breaks small zip64 files and embedded workbooks.) Any throw →
   `damaged`.
2. **Find the parts.** `xl/workbook.xml` and its rels, matched case-insensitively against the
   directory; the shared-strings and styles parts through the rels' relationship types, matched by
   their suffix (`/sharedStrings`, `/styles`, so Strict Open XML files work). Small parts are read
   through the capped stream with their CRC checked. No workbook → `damaged`.
3. **Which tab.** The text goes to pure functions only: `sheetChoice(workbookXml, relsXml)` (new, in
   parseUpload.js beside `resolveFirstSheetTarget`; peekUpload's `resolveSheet` is refactored to call
   it, unchanged in behaviour) gives `{ target, name, others }` — the first visible tab, named only
   when the name can be proved. `listWorkbookSheets` becomes prefix-tolerant (`<x:sheets>`,
   `<x:sheet>`, the relationship id under any prefix), which also fixes the Import's preview and import
   for such files. If the tab list still can't be read and the zip holds more than one worksheet →
   `damaged`, never a guess at `sheet1.xml`. A target under `xl/chartsheets/` → `chart-tab`. No entry
   at the target → `damaged`.
4. **Date styles.** `dateStylesFromXml(stylesXml)` (exported from peekUpload.js, split out of
   `dateStyleIndexes`, unchanged in behaviour) over the capped `styles.xml` text; `date1904` read from
   `workbook.xml`.
5. **Pass A, rows 1–10.** Stream the tab until row 10 closes (an early stop: no `close()`, no CRC).
   Row 1 gives the headers: trimmed, blanks skipped, duplicates renamed by Papa's own rule, with the
   taken-names set seeded from the raw untrimmed row, blanks included (this matches Papa 5.5.3 on all
   194,371 generated header lists; a test runs Papa on the same lists). Their shared strings are
   resolved by a short pass over the shared-strings part that stops at the highest index needed. No
   header → `no-header-row`, naming the tab.
6. **Pick the column.** `pickColumn(headers)` (§B.3). `null` → the existing *Could not detect a Voter
   ID column* 400, with the column list and the tab fields, plus `headerRowHint`: when row 1 has at
   most one non-blank cell and the first row r of 2–10 has a cell whose name, normalised (lowercase,
   letters and digits only), is exactly one of the Voter ID names the rule knows (canonicalFields'
   State Voter ID names, `voterid`, `registrantid`, `textregistrantid`), `headerRowHint = r`. Exact
   names only, never a substring or pattern, so a data cell reading *No voter ID provided* never
   triggers it; and a file whose row 1 holds its real column names never gets the line at all.
7. **The emptiness pass.** One pass over the whole shared-strings part, CRC-checked, recording one bit
   per string: empty or not. Pass B then decides every row as it goes and carries nothing forward.
8. **Pass B, the whole tab.** Only `<row>` and `<c>` inside `<sheetData>` count. The inflated bytes go
   to saxes in slices of at most 64 KB, with `setImmediate` between slices. For each row after row 1:
   - hidden when `hidden` (trimmed) is `1` or `true`, or its height `ht` is 0;
   - the ID cell is kept compactly: literal text in a string array, a shared-string index in a typed
     array, positions grouped by index (no Map, no Set);
   - with call A, the counting column's cell likewise;
   - the row counts when a cell under a named column has a value (literal text, or a shared string
     whose emptiness bit says it isn't empty): the Import's rule exactly;
   - a cell with no `r` takes the next column after its neighbour; a row with no `r` takes the next
     row number.
   At the end: `parser.close()`, the CRC-32 of the inflated bytes (`zlib.crc32`, Node 20.15+, with a
   10-line table fallback) equal to the directory's, and the inflated byte count equal to the
   directory's `uncompressedSize`. Hidden rows with an ID → `hidden-rows` with the count (call C).
9. **Pass C, the strings.** The whole shared-strings part again, CRC-checked, writing the cited
   strings straight into the kept columns. An index must be digits (`/^\d+$/`; an empty `<v>` is not
   index 0) and below the number of `<si>` read, or `damaged`. Rich-text runs are joined, phonetic runs
   (`<rPh>`) left out, only `<t>` text counts (whitespace between tags does not), and CDATA counts as
   text.
10. **Values** — what Excel shows, by the reader's own `cellValue` (peekUpload is not touched): shared
    or inline text (runs joined, phonetics out, CDATA in); `t="str"` text; booleans `TRUE`/`FALSE`;
    errors as written (`#N/A`); numbers in plain form (`String(Number(text))`, so `8719967` never
    becomes `8.72E+06` or `8,719,967`), `t="n"` included; a date-formatted number as ISO, honouring
    `date1904`; `t="d"` as written; an empty `<v>` as empty. A number formatted with leading zeros
    (`00000123`) reads as `123`, which the matcher treats the same.
11. **Strict.** Every pass that runs to its end finishes with `parser.write(decoder.end());
    parser.close()` inside the same guard, so an unclosed tag throws; the early-stopping passes (A and
    the header strings) don't, and the full passes re-read what they read. Any saxes, unzip or zlib
    error, a CRC or size mismatch, or a limit → refused. A file is read whole or refused; it is never
    read short.

Memory is the file buffer plus one or two columns, stored compactly: 186–272 MB peak for the whole
process on wide files up to the bound; the long one-column file 237–240 MB with numbers and
302–305 MB with shared strings. The §D test holds that case under 320 MB; if the build can't, the row
limit comes down until it does.

### B.3 `parseVoterIdList.js`: one pure read, then the unchanged match

`parseIdsAndFindVoters` splits in two:

- **`readIdList(fileBuffer, { idColumn, keep })`**, pure and database-free: §B.1's dispatch, then Papa
  (today's lines 26-34) or `readIdColumn`. Returns
  `{ columns, col, raw, totalRows, keptRows, keepColumnValues, sheetName, otherSheets }` (`null`/`[]`
  for a CSV), or `{ error, code, columns, sheetName, otherSheets, headerRowHint }`. Every coded
  refusal sends `columns: []`; only the code-less *Could not detect* sends the column list.
- **The database half**, unchanged: `findVotersByVoterIds` on `raw`, `sampleIds`, the result object.

`pickIdColumn(columns, idColumn)`, shared by both readers, over the column names of 255 characters or
fewer, in order:

1. `idColumn`, the admin's pick, when it is a column of the file (on a duplicate name, the last such
   column, as Papa's row objects already do);
2. `suggestMapping(columns).stateVoterId`;
3. the first column matching `/voter\s*id/i`;
4. a column whose normalised name is `registrantid` or `textregistrantid`; then the first matching
   `/registrant[\s_-]*id/i`;
5. otherwise `null`.

On the CSV path, the title-row line reads Papa's first ten physical lines (blank lines included, so the
row number is right) and the cells Papa puts in `__parsed_extra` when the title line is narrower than
the column names.

`canonicalFields.js:160`'s splitter becomes `/([A-Z])(?=[A-Z][a-z])/g` (§A.7), for every caller.

### B.4 Routes and refusal codes

- All three preview responses add `sheetName`, `otherSheets` (additive).
- All 400s from the parse carry `error`, `code`, `columns`, `sheetName`, `otherSheets` and
  `headerRowHint`: voted.js and walklists.js gain the `code` dnc.js already sends.
- Codes: `legacy-xls` (now sent by the three uploads too), `damaged`, `chart-tab`, `no-header-row`,
  `hidden-rows`, `xlsx-too-big`, and with call A `keep-column`. The *Could not detect a Voter ID
  column* 400 keeps having no code.
- **Call A, on voted.js only.** Preview and apply take `keepColumn` and `keepSelected` (a JSON array in
  the form). With `keepColumn`, the preview returns `keep: { column, values: [{ value, rows }],
  selected, tooMany, tooLong }`: `values` are that column's distinct values over the counted rows,
  **before** filtering, so an unticked value can be ticked again; trimmed, case kept, `""` for a blank
  (the page shows *(blank)*), dates as their date; at most 25 (`tooMany`, and no filtering); a value
  over 64 characters makes the column unsuitable (`tooLong`). `selected` echoes what was applied (all
  values when nothing was sent). With `keepSelected`, only rows whose value is selected go on to
  matching, and the response adds `keptRows`. Apply sends the last preview response's
  `keep.column` and `keep.selected`, never local state. `VotedUpload` gains `keepColumn` and `keptRows`
  (declared, unindexed); the history endpoint returns them. A `keepColumn` that isn't in the file →
  400 *That column isn't in this file* (code `keep-column`).

### B.5 Old-format and password-protected workbooks: one message

A password-protected `.xlsx`, and one with restricted access, is not a zip: Excel wraps it in the same
OLE2 container an old `.xls` uses, so today it gets the old-format message. Rather than detect it, the
one `LegacyXlsError` message names both and gives one remedy (Part 1's table). Same class, `name`,
`code` and call sites, so the Voter Import route, the worker and every test keep working.

### B.6 Web console

- `accept=".csv,.tsv,.txt,.xls,.xlsx"` on the three pickers, matching the Voter Import.
- **Re-picking.** Each `onChange` takes the file into state, then clears the input
  (`e.target.value = ''`), so choosing the same file again fires again (checked in headless Chrome:
  the kept File still reads and posts). The page shows the chosen file's name and size under the input,
  which itself then reads *No file chosen*.
- **One `refusalView(error, { page, keepOn })` in [idListPreview.js](../client/src/lib/idListPreview.js)**
  decides what a failed preview shows, so the three pages can't drift: the column box only for the
  code-less 400 with columns; otherwise the message in red; the Excel too-big variant
  (`idListTooBigText(keeping, { excel: true })`: *too big for us to read*, Early Voting's `keeping`
  clause, and with call A *the Voter ID and ballot status columns*); Early Voting's hidden-rows suffix
  with call A; and the tab sentence whenever there are other tabs. It is tested per code.
- **The column box** (IdColumnPicker's warning form) gains: the tab note (a `note` prop); the line
  *Column names need to be in row 1 of the first tab*; with `headerRowHint`, *The column names look like
  they're in row N. Delete the rows above them, save, and upload again*; and (call B) a pre-chosen
  column with *Your last upload used X*, when the newest upload that hasn't been undone used a column
  this file has (Early Voting and Do-not-contact from their history queries; Saved Searches from the
  newest uploaded saved search's `sourceMeta.idColumn`). Nothing is matched until **Match column**.
- **Copy.** Early Voting's label (EarlyVotingPage.jsx:129); Do-not-contact's (DoNotContactPage.jsx:144);
  Saved Searches' intro (*or upload a CSV of Voter IDs*), toggle (`'Upload CSV'` → `'Upload file'`),
  help line, label (*Voter-ID CSV*) and badge (`from CSV` → `uploaded`, tooltip fallback *Built from an
  uploaded Voter-ID list*); EffortsPage.jsx's two `' · CSV'` → `' · uploaded'` and its *built from
  filters or a Voter-ID CSV*.
- **`sheetNote({ sheetName, otherSheets })`**: `null` unless both are set and there are other tabs;
  else Part 1's sentence, built as ImportPage.jsx:939-951 builds its note (one tab named, more listed up
  to six, then *and N more*; no bold on the ignored tabs). At the top of the preview box.
- **Call A's control** (Early Voting only): under the stats, **Count only rows where [— every row —
  ▾]** listing the file's other columns. Choosing one re-runs the preview, which lists the values with
  their counts as tick-boxes, ticked per `keep.selected`. Ticks are local; **Count these rows** sends
  them and is disabled while a preview runs; until it is pressed, Apply still uses the last response's
  `selected`. `tooMany`: *Ballot_Date has more than 25 different values; pick a column with a few,
  like a status.* `tooLong`: *Notes has values too long to count by.* The stats line reads *3,224 of
  3,260 rows counted (Ballot_Status)*; the history subtitle adds *Ballot_Status: 3,224 of 3,260 rows*.
  The box hides while a preview runs, as it does today on a column change.
- Saved Searches' error check moves to `refusalView` like the other two.
- IdColumnPicker.jsx's and idListPreview.js's header comments say "from a list", not "from CSV".

### B.7 One log line per Excel read

`[id-list] xlsx 48.5 MB · sheet 304 MB · 260,000 rows · 5.8 s`, or `[id-list] xlsx refused
hidden-rows · 0.5 MB`: sizes, a count, a time and a code, never the file name, tab name, column names,
values or IDs. It's for whoever next tunes the 320 MB bound against real uploads on the dyno; nobody
needs to read it after the deploy.

## C. Files

| File | Change |
|---|---|
| `server/src/services/import/readIdColumn.js` | **New.** §B.2. |
| [parseVoterIdList.js](../server/src/services/import/parseVoterIdList.js) | §B.3: `readIdList`, `pickIdColumn`, the title-row line, call A's filter. |
| [parseUpload.js](../server/src/services/import/parseUpload.js) | `sheetChoice` (pure); `listWorkbookSheets` prefix-tolerant; `LegacyXlsError`'s message. |
| [peekUpload.js](../server/src/services/import/peekUpload.js) | `resolveSheet` calls `sheetChoice`; `dateStylesFromXml` split out and exported. Same behaviour. |
| [canonicalFields.js](../server/src/services/import/canonicalFields.js) | The linear splitter (§A.7). |
| [voted.js](../server/src/routes/admin/voted.js) | Tab fields, `code`, `headerRowHint`; call A's params, `keep`, `keptRows`, the two `VotedUpload` fields. |
| [dnc.js](../server/src/routes/admin/dnc.js), [walklists.js](../server/src/routes/admin/walklists.js) | Tab fields, `headerRowHint`; walklists.js gains `code`. |
| `server/src/models/VotedUpload.js` | Call A: `keepColumn`, `keptRows`. |
| [idListUpload.js](../server/src/middleware/idListUpload.js) | Comment: the 50 MB rule covers Excel; the Excel bounds live in readIdColumn.js. |
| [EarlyVotingPage.jsx](../client/src/pages/EarlyVotingPage.jsx) | `accept`, re-pick, file name, label, `refusalView`, tab note, call A's control, call B. |
| [DoNotContactPage.jsx](../client/src/pages/DoNotContactPage.jsx) | `accept`, re-pick, file name, label, `refusalView`, tab note, call B. |
| `client/src/pages/WalkListsPage.jsx` (shared) | The same, plus copy and badge. |
| `client/src/pages/EffortsPage.jsx` (shared) | Three labels. |
| [idListPreview.js](../client/src/lib/idListPreview.js), [IdColumnPicker.jsx](../client/src/components/IdColumnPicker.jsx) | `refusalView`, `sheetNote`, the too-big variant, call A's subtitle; the `note` prop, the row-1 and title-row lines, call B's pre-choice. |

**Docs** (Part 1 and Part 2 of each, in the same change): [EARLY_VOTING.md](EARLY_VOTING.md) (Part 1
*What it does*, *How to use it*, *Lifecycle*; §A data model for call A, §B pipeline, §C endpoints, §E
frontend, §F gotchas: hidden rows, tabs, limits, undo order); [VOTERS.md](VOTERS.md) (the *Voted*
definition and the do-not-contact list); [WALKLISTS.md](WALKLISTS.md) (shared: the summary line,
*Two ways to build a saved search*, *The multi-voter-door rule*'s CSV lines, *Why the CSV upload
exists*, §A data model, §B's *PapaParse the CSV*, §C, §D, §E, §F); [EFFORTS.md](EFFORTS.md) (shared:
the saved-search lines and `source 'csv'` now covering Excel); [IMPORTS.md](IMPORTS.md) (Part 1's `.xls`
lines, its note that the three Voter-ID uploads take `.csv,.tsv,.txt,.xls`, its list of how they pick
the ID column, and the shared splitter and tab-list fixes); [CAMPAIGNS.md](CAMPAIGNS.md) (shared:
*Saved Searches → from CSV*); [GETTING_STARTED.md](GETTING_STARTED.md); [README.md](README.md) (shared:
line 31's summary, and this proposal's row); [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
(shared; §E). In each listed file the build reads every line `grep -a -n -i csv` finds.

**Help Center** (Part 1 is the source; frontmatter `summary` and `tags` too, since search matches
them): `guides/early-voting.md` (Excel, tabs, hidden rows, the size limit, *pick the file again if you
edit it*; with call A, *Choosing which rows count*, including *undo the earlier upload first*),
`guides/do-not-contact.md`, `guides/saved-searches.md` (also: if a save errors after a long wait,
check the list before trying again), `guides/walk-lists.md` (shared), `pages/page-early-voting.md`,
`pages/page-saved-searches.md`, `faq/xls-file-wont-upload.md` (the password case; its last line made
true and precise: the three pages take `.xlsx`, and the Import-only type warnings don't apply there),
`faq/early-vote-list-not-matching.md` ("walk lists from a CSV"; with call A, files that list ballots
not yet returned), `faq/_INBOX.md` (shared; the *too large* entry and a triaged *can I upload Excel*
entry), `guides/voter-imports.md` (the password line).

## D. Tests

**No real voter file ever goes in the repo.** Every fixture is built in the test from made-up rows.
The hand-off checks `git status --porcelain -uall | grep -a -iE '\.(xlsx|xls|csv)$'` comes back empty.

Server, no database (`npm --prefix server test`):

- **`test/readIdColumn.test.js` (new): pinned values.** Each fixture states the values Excel shows,
  and the reader must return exactly those: shared and inline strings; rich text (shared and inline);
  phonetic runs (shared and inline); CDATA; XML entities and character references (decoded once);
  `xml:space`; numbers (thousands format, decimals, 15 digits, `t="n"`, a leading-zero format);
  text IDs with leading zeros; formulas with number, text, boolean and error results; `t="str"`,
  `t="b"`, `t="e"`, `t="d"`; date formats in the 1900 and 1904 systems; empty `<v>`; empty cells,
  empty rows, rows with an empty ID, rows whose only value is an empty shared string; header
  whitespace; duplicate headers (against Papa, including whitespace variants); a namespace prefix on
  cells and on the workbook; cells and rows with no `r`; a pretty-printed shared-strings part.
  `streamParse` agreement is asserted only for plain strings, numbers, 1900 dates and number/text
  formula results with shared strings present.
- **Structure:** a hidden first tab; all tabs hidden; three tabs (name and others); a chart first; a
  prefixed workbook with a hidden first tab; an unreadable tab list with two worksheets (refused); a
  sheet part not named `sheetN.xml`; absolute rel targets; `xl/SharedStrings.xml`; Strict relationship
  types; the CD-2 zip order; a streaming-writer zip (data descriptors); zip64, including one under
  64 KB; a zip comment of 40 and 200 bytes; trailing bytes; an embedded `.xlsx` as the last member.
- **Refusals, each proving the file is refused and never read short:** a valid zip around a sheet torn
  at a row boundary, mid-cell and after `</sheetData>`; malformed XML; a CRC mismatch (one flipped bit,
  deflated and stored); a lying `uncompressedSize`; a shared-string index past the table, and a
  non-numeric one; hidden rows (`hidden="1"`, `"true"`, `" 1"`, `ht="0"`; a hidden row with no ID
  doesn't count); each limit, injected small: unpacked bytes by directory and by counting, small-part
  size (the 598 KB styles and workbook bombs at the real limits too), rows, columns, cell text, bytes
  since the last event (a 300 MB attribute, comment and text node), rows-1–10 text, depth; a zip with
  no workbook; an empty first tab; the OLE2 containers.
- **Resources:** a 1,048,575-row one-column shared-strings workbook stays under 320 MB peak, and a
  stored 47 MB sheet keeps the event loop's longest pause under 100 ms (both in child processes).
- **`test/idListRead.test.js` (new): plain rows read the same from both formats.** On the same rows of
  plain text and numbers, with no blank headers or blank rows, `readIdList` gives equal `columns`,
  `col`, `raw` and `totalRows` from a CSV and an `.xlsx`. Also: dispatch by bytes (a CSV whose first
  column is `PK…`; an `.xlsx` under any name); `pickIdColumn` order, including both registrant
  spellings, a file with a Voter ID and a Registrant ID column, names over 255 characters, and a
  duplicate name; the title-row line on both formats, firing on a title row above the real column
  names and never on a file whose row 1 holds its column names, whatever its data cells say (*VOTER ID
  REQUIRED*, *No voter ID provided*, *Voter Registration*), nor on a substring; call A's values (counts,
  `""`, trimming, case, the 25 and 64 limits), `selected` and filtering.
- **`canonicalFields.test.js`:** the new splitter equals the old on 300,000 generated strings and the
  real headers in the suite, and takes under 50 ms on 32,767 capitals. `parseUploadOrder.test.js` and
  `peekUpload.test.js`: a prefixed workbook resolves to its first visible tab; otherwise unchanged; the
  widened message still matches `/old-format Excel file/`.

Server, real mongod (`npm --prefix server run test:int`):

- `votedUpload.int.test.js`: an `.xlsx` preview and apply on Early Voting give the same counts as its
  CSV twin; the history row; **Undo**; tab fields on a three-tab workbook and on the *Could not detect*
  400; `columns: []` and a code on every coded 400; a saved search from an `.xlsx` (the `from-csv`
  routes live in this suite). Call A: preview with `keepColumn` returns the values before filtering;
  apply with `keepSelected` marks only the kept rows and parks only their unmatched IDs; the
  `VotedUpload` row records the column and `keptRows`, not the values.
- `dncUpload.int.test.js`: the same for the do-not-contact list, including the state rule.
- `legacyXlsRefusal.int.test.js`: unchanged; it still passes.

Client (`npm --prefix client test`, then `npm --prefix client run build`): `idListPreview.test.js` for
`refusalView` (every code, with and without other tabs, each page, call A on and off), `sheetNote`
(none, one, two, seven other tabs; no name), the too-big variants, and call A's subtitle; call B's
pre-choice (the newest not-undone upload; a column the file lacks).

## E. Privacy record

**This changes how an uploaded voter file is read, so it is treated as privacy-relevant.**

- **What we collect:** nothing new. Only the Voter ID column and the column names are used, plus with
  call A the one column the admin picks to count by: its values decide which rows are used, and the
  column's distinct values with their row counts go back to the uploader's own screen. Nothing about
  any one person from that column is returned or stored.
- **Retention:** nothing new. The workbook is held in memory for the request, like a CSV (multer
  `memoryStorage`), and never written to disk (§A.9). With call A, `VotedUpload` records the counting
  column's name and how many rows counted, not which values were ticked: every `VotedVoter` row
  carries its `uploadId`, so stored values would describe each voter the upload marked (with a
  ballot-type column, how they voted). Tab names go back to the uploader and are not stored. The log
  line (§B.7) carries sizes, a count, a time and a code.
- **Access, sharing, exposure:** unchanged. No new third party: unzipper and saxes are already direct
  dependencies, recorded as "not a subprocessor event" in the v5 2026-08-04 entry.
- **[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md):** item **45** under *Remaining honest gaps
  (v3)* (43 and 44 are the other sessions'), dated, stating the above. And a dated stamp on H16(e),
  *Whether a person voted is stored — but not how*, whose sentence "the CSV parser reads only a single
  voter-ID column and discards every other column" is load-bearing: the parser now reads `.xlsx` too,
  and with call A one more column per row, used only to decide which rows count and never stored. It
  still stores participation only. (If the owner rules that the history should show the ticked values,
  this stamp must instead say the upload records them, and why that describes each marked voter.)
- **Published Privacy Policy, ToS, DPA:** checked: the policy lists "voting-participation records"
  among what customers upload and has no sentence about file formats or upload handling; no sentence
  changes; no customer notice.

## F. Release

- Server and web; Help Center content ships with the server deploy. No migration, no index (call A's
  two fields are unindexed), no config var, no OTA, no client-version gate (§A.5).
  `npm run audit:mobile-api` should flag none of the changed routes; it may list the service files as
  "could not resolve", which is expected for files that aren't routes. The Voter Import's route file
  isn't touched.
- **Shared tree.** The walk-list-archive and client-report-links sessions have uncommitted work in
  `WalkListsPage.jsx`, `EffortsPage.jsx`, `WALKLISTS.md`, `EFFORTS.md`, `CAMPAIGNS.md`,
  `PRIVACY_VERIFICATION.md`, `README.md`, `guides/walk-lists.md` and `faq/_INBOX.md`. Some of this
  plan's edits fall inside their hunks, so the build edits those files by their current text, never by
  HEAD line numbers, and finishes by reading every line `grep -a -n -i csv` finds in each file it
  touched. The hand-off is one `git add -A` for every session: every suite on the combined tree
  (client, mobile, server unit and `test:int`), `npm run audit:mobile-api` with flagged diffs read, the
  untracked-file scan (§D), and the sessions' commit messages combined.
- **Release steps** are the other two plans' (Part 1 step 2); this change adds none.

## G. Not in this plan

- **The CSV path's memory** (860 MB for a 50 MB, 85-column CSV). Owner ruling 2026-10-27: the cap
  stays, no streaming rework.
- **Reusing the Voter Import's `streamParse`.** About 2.5 times slower at the cap, more memory, two disk
  copies of files like CD-2, and the defects in §A.6.
- **Reading old `.xls`, `.ods`, Numbers or `.xlsb`.** Refused, with the fix.
- **The Voter Import's own Excel defects, found in review and not fixed here** (worth a separate look;
  the owner's call): `streamParse` returns phonetic text instead of the cell's value, only the last run
  of inline rich text, and entities decoded twice; reads zero rows from tabs after the first in a
  workbook with no shared strings; throws on cells with no `r`; never settles when a sheet's compressed
  data is cut short (a worker job would hang); checks no CRC; reads hidden rows; peekUpload inflates its
  small parts whole (the 1 GB bombs above); `streamParse` throws on a workbook written with a namespace
  prefix (`<x:workbook>`), so now that the shared tab list reads such a workbook, the Import's preview
  names the right tab and its import fails with that error (before, both silently used the
  `sheet1.xml` guess, which can be a hidden tab); when a chart is the first tab, the Import's preview shows
  the chart while the import reads the first worksheet; and its tab fallback still guesses
  `sheet1.xml` when the tab list can't be read. The two shared fixes in this plan (the splitter, the
  prefixed tab list) are the only Import changes.

## H. Risks

| Risk | Handled by |
|---|---|
| Wrong IDs from a damaged file | CRC and size on every part read whole; strict close; index checks (§B.2 steps 8, 9, 11). |
| IDs silently missing | Strict close; a file is read whole or refused; tests for torn sheets. |
| Rows hidden in Excel counted | Refused with the count (call C). |
| The wrong rows (rejected ballots) | Call A; otherwise unchanged, and the copy says to keep only people who voted. |
| The wrong tab | The Import's resolver, prefix-tolerant now; an unreadable tab list refused; the tab named whenever there are others. |
| A refusal hidden behind the column box | `columns: []` on every coded refusal, and one `refusalView` tested per code. |
| A crafted file stalls or exhausts the dyno | The limits table, including whole-part bombs, nesting, single huge tokens, long names, the quadratic splitter, and slices for stored sheets. |
| The 30-second limit | About 5.5 s here at the 320 MB bound; Heroku unmeasured, hence the log line. Matching time for many IDs is the same as for a CSV of the same IDs today. An apply that still runs long writes after the browser errors; on Saved Searches a retry would make a second search, and the guide says to check the list first. |
| Memory on the shared web dyno | One or two columns, stored compactly; budget tested. |
| The reader disagrees with what Excel shows | Pinned expected values per cell kind (§D). |
| A suggested column is wrong (call B) | Only ever pre-chosen; the admin presses Match column. |
| Stored filter values describe voters (call A) | Not stored: column name and counts only. |

## I. Review log

**Round 1 (2026-10-28), three reviewers.** R1-A built adversarial workbooks against a prototype and
`streamParse`; R1-B walked the three pages as the owner, in the real page code, with a headless Chrome
check; R1-C covered privacy, release, the docs cascade and a pre-mortem.

- **Blockers (2):** a torn sheet read short with no error (no `close()`); rows hidden by an Excel filter
  read, so filtering the CD-2 file to `ACCE` would still count all 3,260 (found by all three).
- **Majors (9):** no CRC check (bit flips gave wrong IDs); bombs below the byte cap; `streamParse` is
  the wrong yardstick for parity; the size bound set from files that compress half as much as CD-2; no
  tab note when the column isn't found (all three); a title row leaves only junk columns; re-picking
  the same file does nothing; choosing which rows count (now call A); the release step ignored the
  other sessions' steps in the same commit.
- **Minors and nits:** a CSV starting `PK` routed to Excel; the empty-shared-string row count;
  long-file memory; chart tabs; case-variant parts; zip comments; non-numeric string indexes; the
  password message; dropped error codes; the privacy record's item number and H16(e); missed CSV
  wording in ten docs and four Help articles; edits inside the other sessions' hunks; the PII guard;
  expected numbers for the after-deploy check; the log line's owner step; the `t="n"` change to the
  Import's preview.

**Round 2 (2026-10-28), two reviewers.** R2-A built a v2-faithful reader and re-ran every round-1
reproduction against it, then attacked v2's new mechanisms; R2-B audited v2's coverage of round 1,
walked v2 end to end against the real pages (with headless Chrome), and ran a pre-mortem and a
simplicity pass.

- **Blocker (1, found by both):** every refusal that carried the file's columns showed the column box
  instead of its reason, so call C's hidden-rows message and the title-row message never reached a
  page. Fixed: `columns: []` on coded refusals and one tested `refusalView`.
- **Majors (7):** reusing peekUpload's `resolveSheet` and `dateStyleIndexes` brought back round 1's
  bombs (both reviewers); the title-row hint fired on data cells like *VOTER ID REQUIRED* and replaced
  the picker, refusing files that upload today (both); a prefixed `workbook.xml` silently read a hidden
  tab; the quadratic splitter, long names and single huge tokens could stall the dyno (§H's claim was
  false); storing call A's ticked values would record, per marked voter, what they had in that column;
  call A's echo rule had nothing to echo; call B could auto-pick a generic `ID` column whose row
  numbers match short Nebraska IDs (false positives).
- **Minors and nits:** the fixed `tailSize` broke small zip64 files and embedded workbooks; memory of
  the empty-string rule and of long shared-string files; a stored sheet blocking the event loop;
  Papa's renaming needs its seeding rule; CDATA read as blank; no tab sentence on layout refusals;
  saxes holds a whole text node, so the per-cell limit didn't bound memory; undo order with call A;
  Mac-only timings; the Import's hidden rows; `legacy-xls` isn't sent today; 184,000 rows, not
  190,000; a lying size wasn't refused; zero-height and padded `hidden` rows; CSV hint row numbers;
  naming; the "same as its CSV export" test overclaimed; the README row's wording; Strict relationship
  types; the *Failed to fetch* after editing a picked file.
- **Simplicity, adopted:** the title-row refusal became a line in the column box; *not a workbook*
  merged into *damaged*; call B became a pre-choice on the client (no server change); call A became one
  **Count these rows** button; one `refusalView` instead of three error branches; pure text helpers
  instead of peekUpload's internals.

v3 fixes every finding of both rounds, or turns it into an owner call (A, B, C). The owner asked for
two rounds; this plan has had them.

## J. As built (2026-10-28)

Built the same day the owner ruled yes to calls A, B and C, uncommitted, in the tree shared with the
walk-list-archive and client-report-links sessions.

**Where the build differs from the plan:**

1. **Apply waits for Count these rows.** The plan let **Mark these voters voted** use the last counted
   values while new ticks sat unpressed. Built stricter: while the ticks differ from what was last
   counted, Apply is off and the page says *Press Count these rows to update the numbers first.*, so the
   numbers on screen are always the numbers that run.
2. **Early Voting's too-big Excel message** keeps the 50 MB message's clause (*keeping only the voters
   who have already voted*); the plan's variant naming the ballot status column wasn't built.
3. **The zip's end record:** the exact record (its comment reaches the end of the file) is preferred,
   else the last one in range, so a workbook with stray bytes after its end still reads, as zip tools
   allow. The plan named the exact rule only.
4. **Memory:** the 1,048,575-row list of shared-string IDs peaks at **150–199 MB** across runs (2.6 s),
   not the 302–305 MB the round-2 prototype measured: one string array per column and (index, row)
   pairs packed into one sorted typed array, no Map or Set. A **stored** (uncompressed) 47 MB sheet costs
   more, about **346 MB**, its whole part arriving as one chunk per pass; its longest event-loop pause is
   19 ms. 150,000 twenty-character text IDs: about 120 MB (§J.1, finding 2).
5. **`VotedUpload.keepColumn` / `keptRows` are stored only when rows were actually left out.** A
   counting column with every value still ticked records nothing, and the history shows nothing extra.
6. **A malformed `keepSelected`** (not a JSON array of strings) is a 400 with code `keep-selected`.
7. **The title-row names** are canonicalFields' own State Voter ID names (`VOTER_ID_NAMES`, exported
   with `normalizeHeaderName`) plus the two registrant names, matched whole. A title above a header row
   whose ID column has a name the rule doesn't know (an `SOSID` row) gets no hint, only the row-1 line.
8. **Rows 1–10 past 1 MB of text** refuse as `xlsx-too-big`, not `damaged`.
9. `KeepRows` is exported from EarlyVotingPage.jsx for its render test.
10. The log lines read `[id-list] xlsx 0.5 MB · sheet 5 MB + strings 0 MB · 3,260 rows · 0.2 s`,
    `[id-list] xlsx 0.0 MB · refused hidden-rows · 0.0 s` and `… · no Voter ID column · …`.

**Files.** Server: `services/import/readIdColumn.js` (new), `parseVoterIdList.js`, `parseUpload.js`
(`sheetChoice` and `sheetChoiceFrom`, prefix-tolerant `listWorkbookSheets`, the widened `LegacyXlsError`;
after the code reviews, the shared saxes walk `walkXml` with `parseWorkbookXml`, `relationships`,
`sheetsWithTargets` and `dateStylesFromXml`), `peekUpload.js`
(`resolveSheet` on `sheetChoice`, `dateStylesFromXml`; same behaviour), `canonicalFields.js` (the
linear splitter, `VOTER_ID_NAMES`), routes `voted.js` (`keepOf`, `parseFailure`), `dnc.js`,
`walklists.js`, `models/VotedUpload.js`, `middleware/idListUpload.js` (comment). Web:
`lib/idListPreview.js` (`refusalView`, `sheetNote`, `fileLine`, `keptLine`, `lastIdColumn`, the Excel
too-big wording, `historySubtitle`'s counting column), `components/IdColumnPicker.jsx` (`SheetNote`,
the row-1 and title-row lines, the pre-chosen column), `EarlyVotingPage.jsx`, `DoNotContactPage.jsx`,
`WalkListsPage.jsx` and `EffortsPage.jsx` (the last two shared, edited by content). Docs and Help: the
§C lists, by a docs builder that edited only `docs/` and `server/src/content/help/`; item 45 and the
H16(e) stamp in PRIVACY_VERIFICATION.md.

**Tests added.** `server/test/readIdColumn.test.js` (20: pinned values, structure, read-whole-or-refuse,
hidden rows, limits, bombs), `readIdColumn.resources.test.js` (memory and event loop, in child
processes), `idListRead.test.js` (8: CSV and Excel alike, dispatch, `pickIdColumn`, the title-row line
and what must not trigger it, call A), `test/support/xlsxBuild.js` and `readIdColumnResources.child.js`
(made-up rows only), a splitter case in `canonicalFields.test.js`, a prefixed-workbook case in
`peekUpload.test.js`, four Excel cases in `votedUpload.int.test.js` and one in `dncUpload.int.test.js`;
web: `idListPreview.test.js` (5 more) and `idListExcelRender.smoke.test.js` (3).

**Verified on the combined tree (2026-10-28):** server unit 2,985 tests, 0 failed (690 run here, the
rest are the database suites); web 1,184 of 1,184; phone 402 of 402; the web build; the upload suites
on a throwaway mongod (`votedUpload` 13/13, `dncUpload` 11/11, `legacyXlsRefusal` 5/5, `dnc` 9/9);
`npm run audit:mobile-api`: none of the three changed routes is called by the phone (`mobile calls 0
endpoint(s)` on each), the five service files listed as expected; no spreadsheet in the tree; and the
full `test:int` marathon on the combined tree (*all integration suites passed*). The real
CD-2 workbook: matched on `Registrant_ID`, 3,260 rows, and with `Ballot_Status` ticked to `ACCE` the
same 3,224 IDs, in the same order, as the accepted-ballots CSV.

### J.1 Code review round 1 (2026-10-28)

Three reviewers: CR1-A drove the server with crafted workbooks and the real routes on a throwaway
mongod (6,000-case corruption fuzz: 0 wrong IDs); CR1-B drove the three pages in headless Chrome over
CDP; CR1-C checked the docs, Help Center, privacy record, test coverage and the hand-off. No blockers;
every finding below is fixed and pinned by a test unless it says otherwise.

**Majors (5):**
1. **A tiny crafted workbook froze the web dyno** (CR1-A): the regexes that read `workbook.xml`, its rels
   and `styles.xml` took time growing with the square of a crafted part's size — a 1,561-byte upload held
   the dyno for 12.7 s, and the Voter Import's preview had the same exposure. Now a saxes walk shared with
   the Import (`walkXml`, parseUpload.js), stopping at 64 levels or 100 XML errors (saxes itself slows on
   a pile of unclosed tags, and each reported error costs an Error object); 8 MB of each crafted shape
   now parses in under 50 ms. *(Round 2 found this incomplete: those shapes repeated one attribute name,
   so they hit the error stop, and a part of distinct attributes, walked four times, still held the dyno
   for 14.7 s — §J.2, finding 1.)*
2. **Long text IDs held the file in memory** (CR1-A): a kept 13+ character slice of saxes's decoded text
   kept its whole chunk alive (up to 576 MB in review). Kept values are copied (`own()`); a 150,000-row
   test of 20-character IDs went from ~313 MB to ~120 MB and is bounded at 200 MB.
3. **The reader still guessed `sheet1.xml`** (CR1-A, CR1-C): when the tab list parsed but the first visible
   tab's link didn't (single-quoted attributes, rels that don't name it, an extra prefixed `id` before
   `r:id`), it read a hidden tab silently. Now the walk reads either quote and finds the relationship id by
   its namespace; an unresolved first tab with more than one worksheet is `damaged`.
4. **Repeated row numbers slipped past the row limit** (CR1-A): 8 million rows from 20 MB, and past 2^21
   counted rows a string landed in the wrong row. Row numbers must now go up (Excel's rule).
5. **IMPORTS.md said the prefix fix reached the Import's import** (CR1-C): exceljs still throws on a
   prefixed `workbook.xml`. Corrected, and added to §G.

**Minors and nits:** zip members capped at 10,000 from the end record; a malformed counting request
(`keepColumn` twice, `keepSelected` alone) is a 400 instead of counting every row; the title-row line
needs a lower row with more values than row 1 (no longer fires in one-column lists); an empty `ht` isn't
a hidden row; on the pages — a network or read failure says what to do instead of *Failed to fetch*; the
preview box stays on screen while the next preview runs (focus no longer drops; Count these rows is
aria-disabled, reads *Counting…*); the tab note on a refusal says *We read the X tab* (none on a
chart-tab refusal); Do-not-contact offers only a column from that state's uploads; the tab note's text
uses `text-info-fg` for contrast (the Voter Import's note too); the file box is off while an apply or save
runs (an old apply's success had wiped a newly picked file); KeepRows hides for a file with no other
column, and a counting column that becomes the ID column is dropped; *IDs in the rows counted* after
counting; a CSV's row-1 line; the could-not-find box's lines reordered; `aria-describedby` on the file
line; one helper each for the pre-chosen column and the counting logic (tested); privacy item 45's (a) and
(d) now say the sample and unmatched IDs cover only the rows that counted; EARLY_VOTING.md's limit codes
and history wording; missing tests the plan promised (Strict types, all tabs hidden, deflated CRC flips,
workbook and token bombs, the real duplicate-name case, no disk writes and the log line's contents, the
splitter at 300,000 strings); the stored-sheet resource test now under the 50 MB cap.

Not changed: the placeholder in the could-not-find box snapping back to the pre-chosen column (harmless);
the inline **Matched on column** picker on Do-not-contact and Saved Searches still re-renders on change, as
before this change.

### J.2 Code review round 2 (2026-10-28)

Two reviewers, aimed at what round 1's fixes added: CR2-A drove the server mechanisms with crafted
workbooks, the real routes in their own process on a throwaway mongod, a corpus of 18 ordinary workbooks
(exceljs, Excel 365, the .NET SDK's `x:` prefixes, openpyxl, LibreOffice, Google Sheets, Strict) read at
HEAD and now, the real CD-2 workbook and six other real voter files read in place (nothing printed but
equal or differs), and a wider corruption fuzz (3 × 15,000 runs: 0 wrong IDs, 0 errors that would be a
500, 0 hangs); CR2-B drove the three pages in headless Chrome over CDP, checked round 1's coverage, the
docs, Help Center and privacy record, and rehearsed the hand-off. Each finding below is fixed and pinned
by a test unless it says otherwise; each server finding was re-run with the reviewer's own script after
the fix.

**Blocker (1):**
1. **A crafted `workbook.xml` or rels still froze the web dyno** (CR2-A). Round 1's walk was linear, but
   the reader walked `workbook.xml` four times and its rels four times in one synchronous run, and in
   saxes's namespace mode every attribute cost an object: a 4.1 MB upload held the dyno for 14.7 s (an
   unrelated request sent 300 ms later waited 14.4 s) and took it from 253 MB to 1,243 MB. Fixed: each
   small part is parsed **once** (`parseWorkbookXml`, `relationships`, `sheetsWithTargets`,
   `sheetChoiceFrom` in parseUpload.js, which `sheetChoice` and the Import's preview use too); saxes runs
   in its plain mode, prefixes resolved from the declarations seen; the walk stops, keeping what it read,
   past 256 attributes on one tag or 200,000 in a part, and collects at most 10,000 tabs or
   relationships; `workbook.xml` and its rels are capped at **2 MB** each (real ones are a few KB;
   `styles.xml` keeps 8 MB). The reviewer's files are now refused in 4–7 ms; a 1.9 MB part of 256
   distinct attributes per tag reads in about 70 ms.

**Majors (5):**
2. **The date check was still quadratic inside its 255-character cap** (CR2-A): the per-format regexes
   rescanned from every `[`, so an 8 MB `styles.xml` of 255-`[` formats took 2.9 s, and a 55 KB upload
   blocked the event loop for 3.06 s. Fixed: brackets, then quotes, cut in one pass each (`cutPairs`);
   the same answers as the regexes on 1,000,000 random formats (checked); 92 ms end to end.
3. **The member cap could be bypassed** (CR2-A): unzipper also switches to the zip64 record when the
   end record's directory **offset** reads 0xFFFFFFFF, whatever count the end record gives, so a 46 MB
   file claiming 3 members there and a million in its zip64 record took 8.5 s and 1,331 MB before being
   refused. Fixed: the cap reads the count unzipper will use (the zip64 one on either marker), and
   either marker with no readable zip64 record is `damaged`. Now refused in 1 ms.
4. **Changing the state on Do-not-contact while a flag ran detached it** (CR2-B): *Applying…* turned back
   into an enabled button, the file box came back on, an old flag's success wiped a newly picked file,
   and its failure showed nothing at all. Fixed: the state select is off while a flag runs, and changing
   it then does nothing.
5. **The Early Voting preview box stayed live during Applying…** (CR2-B): it could read *8 of 10 rows
   counted* beside an apply marking all 10. Fixed: while marking, the whole box is locked — both selects
   and the ticks disabled, every handler a no-op.
6. **A stuck *Press Count these rows* state** (CR2-B): the ticks weren't tied to a column, so ticks from
   the old column's boxes (still on screen while a new column was listed) were sent with the new column
   and could never be unticked. Fixed: ticks are kept with their column and filtered to that column's
   values; while a column change runs the box says *Listing X's values…* and offers no boxes.

**Minors (4):**
7. **A modern 1904-date workbook read as the 1900 system** (CR2-A): the flag came from any `workbookPr`,
   the last one winning, so an extension's `x15:workbookPr` reset it — dates 1,462 days off in *Count only
   rows where*. Fixed: the first `workbookPr` in the spreadsheet namespace.
8. **Round 1's copy (`own()`) missed rows 1–10** (CR2-A): their cells and shared strings stayed slices,
   so a crafted 413 KB file peaked at 399 MB. Fixed; a 9,000-name row 1 now peaks at ~112 MB (~254 MB
   without the copy), bounded at 180 MB by a resources test, and the reviewer's file at 124 MB.
9. **The unresolved-first-tab fallback could still read a hidden tab** (CR2-A): when the visible first
   tab's link was missing and the zip's one worksheet was a listed hidden tab, it was read, unnamed.
   Fixed: `damaged` when that worksheet belongs to another listed tab.
10. **The Early Voting ID-column select dropped focus, and could lose a change** (CR2-B): it was disabled
    while a preview ran, and a counting column chosen during that wait was sent with the last answer's
    ID column, silently reverting it. Fixed: it stays enabled, shows what was last asked for, and each
    request starts from the latest request (`preview.variables`), not the last answer.

**Nits:** a dialog or macro sheet first is refused like a chart (*The first tab, Macro1, isn't a
worksheet.*), judged by its relationship type or its folder, so a worksheet stored outside
`xl/worksheets/` still reads; an `idColumn` sent twice is a 400 `id-column` instead of a quiet
fall-back to the detected column; *Counting…* shows only while a count runs, and the *Press Count these
rows* hint hides while a preview runs; the Saved Searches column picker is off while a save runs (it
stayed live, as it had before this change); a new preview clears a failed apply's message (it showed twice); a
gateway timeout (502/503/504) says the server may still be working — wait and check the upload history —
instead of *Request failed: 503*; docs no longer call the walk "linear" without its caps (EARLY_VOTING.md,
IMPORTS.md, finding 1's note in §J.1); PROPOSAL_VOTER_ID_KEYS.md's *Uploads are CSV-only* annotated.
Checked and moot: the 100-error stop can't cut a tab list short on undeclared prefixes, since plain mode
doesn't report them (300 of 300 tabs listed).

**Left, by decision:** the could-not-find answer lists rows 1–10's column names without a CRC'd pass of
the whole tab, so a corrupted file can show garbled names (1 case in 15,000 fuzz runs); picking one
re-reads the file with every check and refuses it, so no wrong ID results, and a full pass only to list
names would cost seconds on a big file. The inline **Matched on column** picker on Do-not-contact and
Saved Searches stays disabled while its own preview runs, as before this change.

**Verified after the fixes (2026-10-28, combined tree):** server unit 708 run, 0 failed (3,004 with the
database suites, skipped without one); `readIdColumn.test.js` and `idListRead.test.js` 42 of 42 (six
new this round, plus two crafted shapes in `peekUpload.test.js`), resources 4 of 4 (one new); the upload suites on a throwaway mongod (`votedUpload` 14/14, `dncUpload` 11/11,
`legacyXlsRefusal` 5/5, `dnc` 9/9, `doNotKnock` 13/13); web 1,188 of 1,188 and the build; phone 402 of
402; `npm run audit:mobile-api`: still none of the three routes called by the phone; and the full
`test:int` marathon: 189 suites, 2,303 tests, 2,299 passed, 4 skipped, 0 failed (*all integration suites
passed*).

