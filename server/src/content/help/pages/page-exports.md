---
slug: page-exports
title: The Exports page
audience: lead
kind: page
order: 115
sourceDoc: EXPORTS.md
summary: What each control on the campaign Exports page does — the type picker, filters, and the export history.
tags: exports, page, download, csv
---

Open a campaign and pick **Exports** in the sidebar.

## New export

- **Type cards** — pick what to export. Each card explains what one row of the file is. Cards
  marked admin-only (voter profile notes, full backup) don't appear for team leads. The **Notes**
  type is available to leads.
- **Filters** — only the filters that fit the chosen type appear: date range (in the campaign's
  timezone), walk list, round, canvasser, a saved search (for **Filtered voters**), or the
  **Columns** selector (for **Voter file** — pick an upload to get its vendor's column names).
- **Include contact & demographic details** — on the two survey exports only. Off by default;
  tick it to add phone, phone type, cell phone, gender, date of birth, county, latitude and
  longitude, precinct and districts to every row, for matching results back into another
  system. It adds columns, never rows, so the row count doesn't move.
- **One row per voter at the door** — on **Canvassing activity** only. Off by default; tick it
  and every knock that named nobody (not home, refused, lit drop, and so on) repeats once per
  voter registered at that address, same outcome and note on each. It adds **rows**, not
  columns, and the file is named `activity-log-by-voter` so its rows are never mistaken for
  knocks. See [Exporting your data](exports) for what those repeated rows do and don't say about
  each person.
- **Queue export** — creates the job. Building happens in the background; the history below
  polls until it's done. If the background worker is offline you'll see a notice — the export
  starts when it returns.

The yellow panel under **Voter file** is worth reading once: the export is a rebuild from
current data, not the original uploaded file.

## Export history

Each row shows the type, the scope it was queued with, its status (**Queued → Building →
Ready**), who requested it, row count, size, and when it expires (files keep for 7 days). A
survey export queued with the detail columns on says **contact & demographic details** in its
scope, a Canvassing activity export queued with one row per voter says **one row per voter at
the door**, and a Notes export that listed the voters at each door says **voters listed at each
door** — so the history is a lasting record of which files carried them.

- **Download** — saves the file. Ready rows only.
- **Retry** — re-queues a failed export with the same scope.
- **Delete** — removes the export and its file immediately (a copy you already downloaded is
  unaffected). Building rows can't be deleted — let them finish first.

"N withheld (do not contact)" on a row means that many entries were excluded because the person
asked not to be contacted — that's why an export can show fewer rows than a dashboard.

Exports work on an **archived** campaign too, on the web and on the phone. Archiving makes a campaign read-only — but an export is a read, and taking your data with you is exactly why a finished campaign sticks around. Pick it from the campaign chip and queue as usual.

On the phone, Admin → **More → Exports** queues the four everyday types with the same filters
and a live row-count preview: tap a type, and a sheet explains what one row of the file is,
what's in it, and roughly how many rows your filters will produce before you queue. Canvassing
activity has the same **One row per voter at the door** switch there (under **Rows**), and the
row count updates when you flip it. The other
types — detailed survey answers, filtered voters, voter notes, and the full backup — stay on
the web dashboard. Downloads open the share sheet, and touching and holding a row deletes it.
