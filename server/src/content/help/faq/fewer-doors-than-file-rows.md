---
slug: fewer-doors-than-file-rows
title: My file has more rows than the doors the import reports — did it lose some?
audience: lead
kind: faq
order: 21
sourceDoc: IMPORTS.md
summary: Rows are people, doors are addresses. Several voters share a door, every apartment unit is its own door, and a second file reuses doors the first one created.
tags: import, doors, households, counts, rows
---

Almost certainly not. A vendor file has **one row per voter**, and Doorline counts **doors**, so the door count is always lower than the row count. Here's where the rows go:

- **Several voters share a door.** A home with two registered voters is two rows and one door. A file of about 2,900 rows is typically around 2,000 doors.
- **Every apartment unit is its own door.** "Apt 2" and "Apt 3" at one building are two doors (drawn as one building on the map).
- **A second file reuses doors the first one created.** Vendors often split one precinct into a "strong" file and a "swing" file; a home with one voter in each is still **one** door. That's why a later file's **New** column can be lower than its **Households** column — the difference is addresses an earlier file already created.
- **A few rows may be skipped** — a blank first name, last name, Voter ID, address, city, state or zip; a Voter ID that is a spreadsheet error like `#REF!`; coordinates that aren't valid numbers; or a Voter ID repeated inside the file. These show under **Errors** in the Recent imports table, and the preview lists each one with its reason. A skipped row costs a voter, not a door, unless it was the only voter at that address.

To read the **Recent imports** table: **Voters** = rows imported, **Households** = distinct addresses in the file, **New** = voters / doors created by *this* file, **Moved / Emptied** = voters who changed address / doors left empty, **Errors** = skipped rows.

If a client or vendor quotes a "door count" that matches your **row** count, they are counting people. Ask whether their number is rows, addresses, or rooftops — all three are honest counts of the same file, and only the middle one is what Doorline calls a door. More in [Uploading a voter file](voter-imports).
