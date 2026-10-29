---
slug: early-voting
title: Dropping voters who already voted
audience: lead
kind: guide
order: 20
sourceDoc: EARLY_VOTING.md
summary: Upload a CSV or Excel list of voters who already voted so their doors drop off canvassers' books — and choose which rows of a returns file count.
tags: early voting, voted, absentee, voter id, doors, undo, csv, excel, xlsx, spreadsheet, tabs, hidden rows, ballot status, returns file, count only rows where, file too big
---

## Stop knocking doors that are done

If someone has already voted early or absentee, there's no reason for a canvasser to visit them. Upload a list of those voters and the app takes their homes out of rotation once everyone at the address has voted.

The app matches your list **by Voter ID** and marks each person as voted. Nothing gets re-cut, and every upload can be undone.

One upload covers the whole campaign: every [walk list](walk-lists), every [pass](passes), and the doors still in Intake. You never upload per walk list, and a pass you start later already leaves those doors out.

## Where it lives

Open the campaign you're working in and pick **Early Voting** from its sidebar. The campaign shown at the top is the one you're uploading to, so double-check it matches the election you mean before you start.

1. Choose your file in the box labelled **Voted-voters file (CSV or Excel)**: a CSV or other text export, or an Excel workbook (`.xlsx`). Its name and size show under the box. Any column that looks like a Voter ID is found automatically (Nebraska's `Registrant_ID` included), and a preview runs right away, no changes yet.
2. The preview names the column it matched on, with a few of its values, and lets you pick a different one from the dropdown if the app chose wrong. IDs match **with or without leading zeros** (a list that went through Excel still matches), and the preview says how many matched that way. It also tells you how many will be marked, how many already were, how many doors will drop, and how many IDs aren't in this campaign's list.
3. Click **Mark these voters voted** to apply. You'll see the totals, and an upload history builds up below with an **Undo** button on each one.

**Big files.** A file can be up to 50 MB, CSV or Excel. Only the Voter ID column is used, so if a state or county sends you something bigger, save a copy with just that column and upload that. Check what the file lists first: an early-voting file often includes everyone who was *sent* a ballot, returned or not. Keep only the people who have already voted, or, for a file under the limit, choose which rows count on the page (below).

An Excel file has one more limit, on what's inside it: its first tab, unpacked, can be up to 320 MB. That's about 184,000 rows of a 35-column file, fewer for wider files; a county's or a district's returns file is far below it. A bigger workbook is refused as soon as it arrives: *This Excel file is too big for us to read. Only the Voter ID column is used, so save a copy with just that column, keeping only the voters who have already voted, and upload it.*

## Excel files

- **Only the first tab is read**: the leftmost tab you can see (hidden tabs are skipped). When the workbook has other tabs, the preview names the tab it read, for example: *These IDs come from the Returns tab — the first tab in the file, and the only one read. The Summary tab is ignored. If your list is on a different tab, move it to the front of the workbook and upload again.*
- **Rows hidden in Excel are refused, never counted quietly.** Excel's filter hides rows but doesn't remove them, so they're still in the file. A workbook with hidden rows is turned away with how many, and asks you to clear the filter or delete those rows, save, and upload again. To leave rows out, use *Choosing which rows count* below instead of a filter.
- **A file is read whole or not at all.** A damaged workbook, one cut short, or one that isn't really an `.xlsx` is refused with *We couldn't read this file as an Excel workbook. Open it, save or export it as .xlsx or CSV, and upload that.*
- **Old-format and password-protected workbooks can't be read.** The page says so and gives the fix: open it in Excel, remove any password or access restriction, then **File → Save As → Excel Workbook (.xlsx)**, and upload the `.xlsx`. More in [My voter file is a .xls — can I upload it?](xls-file-wont-upload)
- **The first tab has to be your list.** A chart (or an old macro or dialog sheet) as the first tab, or a first tab with nothing in row 1, is refused with what to fix.
- **If the page says the server took too long,** it may still be working: wait a minute and check the upload history before trying again.
- **Fixed the file? Pick it again.** Choosing the same file again re-runs the preview. And if you edit a file after picking it, pick it again before you apply: the browser can't send a file that changed after it was chosen.

## If the Voter ID column isn't found

The page shows a *Couldn't find a Voter ID column* box with the file's columns to pick from. Choose the one that holds Voter IDs and press **Match column**. Column names need to be in row 1 of the first tab; when they look like they're further down, below a title, the box says which row (*The column names look like they're in row 3*): delete the rows above them, save, and upload again.

If your last upload (the most recent one you didn't undo) used a column this file also has, that column is already chosen (*Your last upload used SOSID.*). Check it, then press **Match column**. Nothing is matched until you do.

## Choosing which rows count

A returns file from an election office usually lists more than the people who voted: rejected or suspended ballots, or ballots sent out and not yet returned. You don't have to delete those rows by hand.

1. Under the preview's numbers, open **Count only rows where** and choose the column that says which is which, like `Ballot_Status`. The preview lists that column's values, each with how many rows hold it, all ticked: for example `ACCE · 3,224`, `SUSP · 26`, `REJE · 10`.
2. Untick what shouldn't count and press **Count these rows**. The preview re-runs on the rows that are left: *3,224 of 3,260 rows counted (Ballot_Status)*.
3. Click **Mark these voters voted**. It uses exactly what was last counted: after changing the ticks, press **Count these rows** again (until you do, the button stays off and the page says so).

Values are read as written: spaces around them are trimmed, capitals matter, and an empty cell shows as *(blank)*. The column needs a few short values, at most 25 different ones and none very long, like a status; the page tells you when a column won't work. When rows were left out, the upload history keeps the column and the count (*Ballot_Status: 3,224 of 3,260 rows*), never which values you ticked.

> **Heads-up: to redo an upload with rows left out, undo the earlier upload first.** Undo removes only the marks an upload made itself. If you upload the whole file and then the same file with rows left out, the second one marks nobody new, so undoing the first afterwards would leave nobody marked. Undo the first, then upload again with the rows you want.

## Voted person vs. finished door

A **voted person** just gets a green **✓ Voted** badge. If someone else at that address still needs a knock, the door stays on the map. A door only disappears once *everyone* living there has voted.

Canvassers with the app open lose a finished door within about 30 seconds while they're on the map. Someone a canvasser added at the door is never on a state list, so they keep that door open; if you delete them and everyone left has voted, the door drops right away.

## Undo anytime

Every upload is logged. Hit **Undo** and it un-marks the voters that upload added and re-opens any doors that dropped because of them. You can also un-mark a single voter if just one was a mistake. Canvassers who already have the app open get the returned doors back on their own within about 30 seconds while they're on the map.

## "Not found" is remembered

Some IDs won't match yet, usually because those voters haven't been imported into this campaign. That's fine. The app remembers them, and the next time you [import voters](voter-imports), any that now match are marked automatically, no re-upload needed, however the import spells the ID. If a list matches almost nothing, check the column it matched on first: [My early-vote list says most IDs aren't in this campaign](early-vote-list-not-matching).

> Tip: Upload one campaign at a time. A person can be voted in one election but not another, so marks stay tied to the campaign you uploaded to.

Fully-voted doors also drop from new [walk lists](walk-lists) and turf cuts, and they show up in a separate **Voted** slice of your [coverage numbers](coverage-vs-knocks) instead of as unknocked.
