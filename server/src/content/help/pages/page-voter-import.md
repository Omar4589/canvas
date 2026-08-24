---
slug: page-voter-import
title: The Voter Import page
audience: lead
kind: page
order: 102
sourceDoc: IMPORTS.md
summary: Upload a voter file, preview the changes, and import.
tags: import, voters, page
---

The **Voter Import** tab is where you upload a voter file (CSV, Excel `.xlsx`, or a delimited `.txt`/`.tsv`/`.xls` export — the separator is detected for you; only a genuine Excel 97–2003 workbook is refused, with [instructions](xls-file-wont-upload)). After you map the columns, you preview exactly what will change — new vs. existing doors, updated voters, and any near-duplicates — then confirm the import. New addresses land in Intake until you claim them into a walk list. On the review screen you can also tick **"Revisit already-worked homes that gain a new voter"** — if the file drops a new target voter into a home you've already knocked, those homes are collected into a saved search, and the summary's **Create revisit walk list →** turns it into a walk list you can cut a fresh round from.

**Excel files with several tabs.** Only the **first tab** is imported — the leftmost one you can see (hidden sheets are skipped). The mapping step names the tab it read and lists any it skipped, so if the columns look wrong, check that note first: your voter data may be on a different tab. Move that tab to the front of the workbook and upload again.

**Files that pack several voters into one row.** When a file numbers its voter columns (`FLVoterId1..4`, `FirstName1..4`), the **What we detected** panel offers **Explode multi-member rows** (on by default): each row becomes one voter per person, with precinct and district values stated once per row filled down to everyone at the door — party and gender stay per-person and are never copied from the first voter. If the file *looks* multi-voter but the importer can't read the column naming, the panel shows a **red warning** instead — only the first voter in each row will import until the extra columns are renamed to end in 2, 3, … (or, if the file carries no voter-ID column per person, until the vendor supplies one). The warning doesn't block the import. Details: [My file has more rows than the doors the import reports](fewer-doors-than-file-rows).

**What the states mean.** Analysis and imports run in the background, so the page shows where the job is: **Queued — waiting for a worker** (with a clock — it hasn't started yet; a **Cancel** button can pull it back at this point), then **Parsing** (reading the file), **Geocoding** (only if some addresses need coordinates looked up), **Linking** (matching voters to your organization's people records — the longest stage on big files, no percentage on purpose), and **Importing** (writing, with live progress). Refreshing the page doesn't lose a running job. If an import **fails**, the red message says why — including when the import system stopped responding mid-job or never picked the job up, in which case the import fails itself within a few minutes rather than spinning forever.

**Reading Recent imports.** **Voters** is rows that imported, **Households** is the distinct addresses those rows live at, **New** is voters / doors this file created (lower than Households when an earlier file already had some of the addresses), **Moved / Emptied** is voters who changed address and doors left with no voters, and **Errors** is skipped rows — the preview lists each with its reason. Fewer doors than rows is normal: see [My file has more rows than the doors the import reports](fewer-doors-than-file-rows).

For the full walkthrough, see [Uploading a voter file](voter-imports). If a stage seems to sit still, see [My import has said Analyzing or Linking for a while — is it stuck?](import-taking-long)
