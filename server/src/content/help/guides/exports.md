---
slug: exports
title: Exporting your data
audience: lead
kind: guide
order: 24
sourceDoc: EXPORTS.md
summary: Queue background CSV exports — canvassing activity, doors by round, survey results, your voter file, or a filtered subset — and download them from the Exports page.
tags: export, csv, download, voter file, backup, data
---

Your data is yours. The **Exports** page (open a campaign, then **Exports** in the sidebar — on
the phone: Admin → **More → Exports**) turns anything the campaign collected into a CSV you can
keep, open in Excel or Google Sheets, or load into another tool.

## How it works

1. Pick an export type and, if you want, narrow it with filters (date range, walk list, round,
   canvasser, or a saved search). On the phone, tapping a type opens a sheet that describes the
   file, takes the same filters, and shows a **live row count** before you queue anything.
2. Press **Queue export**. The file is built in the background — big exports can take a minute
   or two, and the list below updates as it goes.
3. When the row says **Ready**, press **Download**. Files are kept for **7 days**, then deleted
   automatically — you can queue a fresh one any time.

## What you can export

- **Canvassing activity** — every door result: who knocked, when, the outcome, and the voter at
  that door. The complete field record. Voter name and IDs fill in only when a survey named the
  voter — plain knocks like *not home* or *lit dropped* are about the door, so their voter
  columns are blank on purpose.
- **Doors by round** — one row per door per round with its status. Filter it to `not home` and
  you have a re-knock list.
- **Survey results** — one row per survey taken, one column per question. If the campaign ran
  more than one survey, you get one file per survey.
- **Survey answers (detailed)** — one row per recorded answer, exactly as captured at the door,
  even if a question's wording changed later.
- **Voter file** — everyone currently in the campaign. Pick one of your uploads in the
  **Columns** selector to get the file back under that vendor's own column names.
- **Filtered voters** — only the voters matching one of your saved searches.
- **Voter notes** *(admins only)* — staff notes about voters, with author and date.
- **Full backup** *(admins only)* — one ZIP with everything above for the campaign (or the whole
  organization), plus per-round totals and a README explaining each file.

Team leads can export from the campaigns they manage; org-wide exports, voter notes, and the
full backup are admin-only.

## Matching your file on another platform

The voter-bearing files carry two IDs side by side: **State voter ID** (the id from your voter
file) and **UID** (the vendor id from your original upload, when it had one). Either lets
another tool match the same people — so an export here re-matches cleanly wherever it goes
next.

## About the voter file

The original file you uploaded is deleted right after import, so this export **rebuilds** a file
from the data currently in Doorline. That means: columns that were never mapped during import
can't come back, rows that failed import are absent, and any edits made since the upload show
through. It's your current data — not a byte-for-byte copy of the old file.

## Why an export can show fewer rows than a dashboard

When someone asks not to be contacted, they're excluded from **every** export from then on —
including records made before they asked. Dashboards still count the historical activity, so an
export can show fewer rows than the screen it mirrors. Each export tells you how many rows were
withheld, so the difference is never a mystery.

## Archived campaigns still export

Archiving a campaign makes it read-only — but reading is what an export does, so the Exports page keeps working exactly as before. Open the archived campaign (on the web it's in the archived section at the bottom of **Campaigns**; on the phone, pick it from the campaign chip under the **Archived · read-only** divider) and queue whatever you need. See [Archive vs. delete a campaign](archive-vs-delete-campaign).

## If your subscription ends

Your data stays exportable. During the 60-day wind-down the account is read-only, but queueing
and downloading exports keeps working — that window exists so you can take your data with you.
