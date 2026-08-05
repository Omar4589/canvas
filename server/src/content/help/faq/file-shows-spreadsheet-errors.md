---
slug: file-shows-spreadsheet-errors
title: My file shows =#NUM! or #REF! where the Voter IDs should be
audience: lead
kind: faq
order: 22
sourceDoc: IMPORTS.md
summary: A formula in the source spreadsheet failed before export — what the red preview warning means and how to fix or work around it.
tags: import, voter id, spreadsheet, error, num, ref, skipped rows
---

That's a **spreadsheet error frozen into text**. Whoever built the file used a formula (usually a lookup) to fill the Voter ID column, the formula failed on some rows, and Excel exported its error message — `=#NUM!`, `#REF!`, `#N/A` — instead of an ID. It often hits *most* of a file while a healthy-looking minority still has real IDs.

The import catches this: affected rows are **skipped and counted, with the reason named** — the mapping step warns as soon as it sees an error value in the ID column, and the preview shows a red callout with the exact row counts. If more than a fifth of the file would be skipped, **Confirm & import** stays off until you explicitly tick **Import anyway**.

Two ways forward, best first:

1. **Ask for a re-export.** The person who made the file should fix the formula (or export the raw ID field directly instead of computing it) and send a fresh file. The error means those IDs were never actually in the file — they can't be recovered from it.
2. **Map a different unique column.** If the file has another column that uniquely identifies each person — most vendor files carry the vendor's own person ID — go **Back** and map that column as **State Voter ID** instead. The preview will re-run and should show nearly every row importing.

One rule if you take option 2: **keep using that same column for every later file in this campaign.** Voters match across uploads by the ID you mapped — switching ID columns between files makes the same people look brand new and duplicates them.
