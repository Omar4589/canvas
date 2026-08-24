---
slug: fewer-doors-than-file-rows
title: My file has more rows than the doors the import reports — did it lose some?
audience: lead
kind: faq
order: 21
sourceDoc: IMPORTS.md
summary: Rows are people, doors are addresses. Several voters share a door, every apartment unit is its own door, and a second file reuses doors the first one created.
tags: import, doors, households, counts, rows, multi-voter, warnings, fewer doors than file rows?
---

Almost certainly not — with one exception the preview flags in red, covered at the end of this answer. A vendor file usually has **one row per voter**, and Doorline counts **doors**, so the door count is always lower than the row count. Here's where the rows go:

- **Several voters share a door.** A home with two registered voters is two rows and one door. A file of about 2,900 rows is typically around 2,000 doors.
- **Every apartment unit is its own door.** "Apt 2" and "Apt 3" at one building are two doors (drawn as one building on the map).
- **A second file reuses doors the first one created.** Vendors often split one precinct into a "strong" file and a "swing" file; a home with one voter in each is still **one** door. That's why a later file's **New** column can be lower than its **Households** column — the difference is addresses an earlier file already created.
- **A few rows may be skipped** — a blank first name, last name, Voter ID, address, city, state or zip; a Voter ID that is a spreadsheet error like `#REF!`; coordinates that aren't valid numbers; or a Voter ID repeated inside the file. These show under **Errors** in the Recent imports table, and the preview lists each one with its reason. A skipped row costs a voter, not a door, unless it was the only voter at that address.

To read the **Recent imports** table: **Voters** = rows imported, **Households** = distinct addresses in the file, **New** = voters / doors created by *this* file, **Moved / Emptied** = voters who changed address / doors left empty, **Errors** = skipped rows.

If a client or vendor quotes a "door count" that matches your **row** count, they are counting people. Ask whether their number is rows, addresses, or rooftops — all three are honest counts of the same file, and only the middle one is what Doorline calls a door. More in [Uploading a voter file](voter-imports).

## The exception: the red "more than one voter per row" warning

This is the one case where people really weren't imported. Some vendor files pack a whole household into each **row** — numbered columns like `FirstName1..4` and `FLVoterId1..4`, one set per person. The importer normally detects these and splits each row into one voter per person. But if the preview's **What we detected** panel showed a **red warning** saying the file looks like it packs more than one voter per row, the split did **not** happen: only the first voter in each row imported, and the extra people were left out. The warning's own text tells you which of two problems you have:

- **"the naming isn't one the importer recognizes"** — the extra people's columns are there, but named in a style the importer can't read — often the voter-ID columns are numbered while the name columns aren't (say `SpouseFirstName` instead of `FirstName2`). Rename the extra columns so each one ends in 2, 3, … matching the first voter's column (`FirstName2`, `StateVoterID2`, and so on) and upload again — the panel should then offer **Explode multi-member rows** instead of the warning, and everyone imports.
- **"it has no voter-ID column per person"** — every imported voter needs their own state Voter ID, and this file carries only one ID per row, so the extra people have no identity to import under. Renaming won't fix this one: ask your vendor for an export with an ID column per person (e.g. `StateVoterID2`), or one row per voter.

Either way the import itself still runs — it just imports one voter per row until the file is fixed, so fix the file and upload again (imports are safe to repeat).
