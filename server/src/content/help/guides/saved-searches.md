---
slug: saved-searches
title: Saved searches
audience: lead
kind: guide
order: 12
sourceDoc: WALKLISTS.md
summary: A saved search is a frozen set of doors you build by filter or by uploading a CSV or Excel file of Voter IDs, then hand to a walk list.
tags: saved search, walk list, filter, csv, excel, xlsx, upload file, uploaded, voter id, doors
---

## What a saved search is

A **saved search** is a named, frozen set of doors carved out of your campaign's voter pool. It's the bridge between "who's in my universe" and "which crew works which doors."

*Frozen* is the key word. Once you save it, the doors are locked in. Importing more voters later, or someone moving, won't change an existing saved search. If you want a fresh cut, build a new one.

## Two ways to build one

On the **Saved Searches** page, the "Build a saved search" panel has two modes, **Filter builder** and **Upload file**:

- **Filter builder** — pick doors by the data you already have: party, precinct, district, age, geography, door status, and even [survey answers](surveys). Combine filters with **AND** (match all) or **OR** (match any). An **Exclude doors** section lets you throw doors *out* as well: a door matching any of its conditions is removed even if it matches your other filters — say, supporters minus everyone who already took a yard sign. Use this when the people you want can be *described* by their data. A door status with no pass chosen reads each door's whole history across every round — Restricted if any round ever recorded it, else Surveyed if surveyed in any round, else the most recent answer (refused, wrong address, no soliciting, not a target voter), else Not home if nobody ever answered, else Unknocked — the same rule as [Target doors](passes).
- **Upload file** — upload a CSV or Excel file (`.xlsx`) with a column of Voter IDs, in the box labelled **Voter-ID file (CSV or Excel)**. The app matches them to this campaign's voters (with or without leading zeros; the preview names the column it matched on and lets you change it) and freezes the doors they live at. Use this when you already have an exact list filters can't express — say, everyone who voted in the first election. These show an **uploaded** badge (hover it for the file's name), and the Walk Lists page lists them with **· uploaded**. Files can be up to 50 MB; only the Voter ID column is used, so trim a bigger file to just that column.

Both produce the same thing: a frozen door set. You can build one the moment your first import finishes, so even your very first walk list can be targeted instead of "everyone."

## Uploading a list

- **Excel files:** only the first tab you can see is read, and the preview names it when the workbook has other tabs. A workbook with rows hidden in Excel (by a filter, say) is refused with how many, because hidden rows are still in the file; clear the filter or delete those rows, save, and upload again. Old-format, password-protected and damaged workbooks are refused with the fix, and an Excel file's first tab must unpack to 320 MB or less (about 184,000 rows of a 35-column file).
- **If the Voter ID column isn't found,** pick it from the list and press **Match column**. Column names need to be in row 1 of the first tab; when a title sits above them, the box says which row they seem to be in. If your newest uploaded saved search used a column this file also has, it's already chosen; check it and press **Match column**.
- **Fixed the file? Pick it again** and the preview re-runs. If you edit a file after picking it, pick it again before saving.
- **If a save errors after a long wait, check the list before trying again.** A very large list can take longer to save than the page waits, and the save can still finish on its own. Look for your saved search in the list first; saving again would make a second one.

## The whole-door rule

A saved search holds **doors, not voters**, so a home joins if **any** voter there is a match. And since walk lists own whole doors, claiming a door later moves *all* the voters at it — not just the ones you matched. At a two-voter home where only one person is on your list, both come along. The upload's preview shows both numbers so the difference is clear.

## Turning it into doors

A saved search doesn't assign work on its own — it feeds a [walk list](walk-lists), two ways:

1. **Seed at creation** — create a new walk list and pick your saved search under **Doors**.
2. **Claim later** — open a walk list, choose Claim, and pick the saved search.

Either way, claiming only takes the saved search's unowned doors (those sitting in [Intake](what-is-intake)). If some already belong to another walk list, the app shows you exactly what moving them would do to each list's books — and snapshots those books before the move, so it's undoable.

> Tip: Every saved search has a **Download CSV** action that exports its frozen voters — great for handing a phone bank the numbers or a mail house the addresses.
