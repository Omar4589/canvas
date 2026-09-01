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
  columns are blank on purpose. Tick **One row per voter at the door** to repeat those knocks
  once per registered voter at the address instead — see below.
- **Doors by round** — one row per door per round with its status. Filter it to `not home` and
  you have a re-knock list.
- **Survey results** — one row per survey taken, one column per question. If the campaign ran
  more than one survey, you get one file per survey.
- **Survey answers (detailed)** — one row per recorded answer, exactly as captured at the door,
  even if a question's wording changed later.

Both survey exports offer **Include contact & demographic details** — see below.
- **Voter file** — everyone currently in the campaign. Pick one of your uploads in the
  **Columns** selector to get the file back under that vendor's own column names.
- **Filtered voters** — only the voters matching one of your saved searches.
- **Notes** — every note currently on the campaign in one file, one row per note: the ones
  canvassers type at a door, the ones attached to a submitted survey, and the ones written on a
  voter's profile. Filter by source, door outcome, date, walk list, round, author, or note text.
  You can also start one straight from the **Notes** page, carrying the filters you have on
  screen.
- **Voter profile notes** *(admins only)* — the notes written on voter profiles on their own,
  with author and edit history. This one has never contained door or survey notes; use **Notes**
  for those.
- **Full backup** *(admins only)* — one ZIP with everything above for the campaign (or the whole
  organization), plus per-round totals and a README explaining each file.

Team leads can export from the campaigns they manage; org-wide exports, **Voter profile notes**,
and the full backup are admin-only. **Notes** is available to team leads — it covers the same
three sources they already read on the Notes page.

### About the door notes in a Notes export

A note typed at a door is a record about the **door**, not about a person — nobody was picked, so
it names no one. The Notes export can add a column listing the people registered at that address
beside the note, but you have to tick **Include the voters registered at each door** to get it,
and the export history records which downloads carried it. People who have asked not to be
contacted are never listed, and the count beside the list counts only the names shown.

### One row per voter at a door (Canvassing activity)

A *not home* is a fact about an address. If the tool you're handing the file to wants a fact
about a person — a row for every registered voter at the address — tick **One row per voter at
the door** when you queue a Canvassing activity export (on the phone: the **Rows** switch on the
sheet). Every knock that named nobody (*not home*, *wrong address*, *refused*, *lit dropped*,
*no soliciting*, *restricted*) then comes out once per voter registered at that address, each
row carrying the same outcome, time, canvasser, GPS and note, with that voter's State voter ID,
UID, name and party filled in. Surveys, which already name the person, are unchanged.

Three things to know:

- **The outcome is repeated, not attributed.** A *refused* on three rows means someone at that
  address declined — not that each of the three did. *No soliciting* is a sign on the property.
  Neither is a request not to be contacted. *Restricted* rows repeat too, and many of those are
  desk marks over a whole book rather than a visit — the **Via** column says which.
- **Its rows are not knocks.** The columns are the same but the row count isn't, so the file
  arrives named **activity-log-by-voter** — never count its rows for an invoice. Every row of one
  knock shares the same **Activity DB id**, so counting distinct values there gets you back to
  knocks. The per-round exports remain the invoice-grade files.
- **Nobody to list keeps one row.** An address with no registered voters keeps its single row
  with the voter columns blank, just like the normal file. People who have asked not to be
  contacted are never listed. The people are the ones registered at the address *today*, so the
  count you saw when queueing and the finished file can differ by a row if your voter file
  changed in between.

The export history says **one row per voter at the door** on any file that carried it.

## Matching your file on another platform

The voter-bearing files carry two IDs side by side: **State voter ID** (the id from your voter
file) and **UID** (the vendor id from your original upload, when it had one). Either lets
another tool match the same people — so an export here re-matches cleanly wherever it goes
next.

### Contact & demographic details on the survey exports

By default a survey export identifies the person by name, party and address — enough to read,
not enough to be a copy of your voter file. When you need to write results back into another
system, tick **Include contact & demographic details** on **Survey results** or **Survey answers
(detailed)** and each row also carries:

**Phone**, **Phone type**, **Cell phone**, **Gender**, **Date of birth**, **County**,
**Latitude** and **Longitude**, **Precinct**, and the **Congressional**, **State senate** and
**State house** districts.

It's off by default on purpose — most survey exports don't need somebody's phone number and date
of birth sitting beside their political opinions. Nothing about *who* is in the file changes: it
adds columns, never rows, and everyone excluded from the export stays excluded. The Exports
history records which exports were run with it on, so you can always tell.

Handing the file to someone outside your organization? Those columns are personal data about
real people — send them only when the recipient actually needs them.

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
