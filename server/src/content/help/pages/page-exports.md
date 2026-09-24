---
slug: page-exports
title: The Exports page
audience: lead
kind: page
order: 115
sourceDoc: EXPORTS.md

summary: What each control on the campaign Exports page does — the type picker, the filters, the options dialog, and the export history.
tags: exports, page, download, csv, results by voter, survey answers
---

Open a campaign and pick **Exports** in the sidebar.

## New export


- **Type cards** — pick what to export. Each card explains what one row of the file is. Cards
  marked admin-only (voter profile notes, full backup) don't appear for team leads. **Notes** and
  **Results by voter** are available to leads — **Results by voter** is the card to reach for when
  the file is going to a client: one row per person at the doors you worked, with what happened at
  their address and what they said.
- **Filters** — only the filters that fit the chosen type appear: date range (in the campaign's
  timezone), walk list, round, canvasser, a saved search (for **Filtered voters**), the
  **Columns** selector (for **Voter file** — pick an upload to get its vendor's column names),

  or the **Door outcome** chips (inline for **Notes**; inside the options dialog for **Canvassing
  activity** and **Results by voter** — tick the outcomes you want; nothing ticked means all).

- **Include contact & demographic details** — on the two survey exports and on **Results by
  voter**. Off by default; tick it to add phone, phone type, cell phone, gender, date of birth,
  county, latitude and longitude, precinct and districts to every row, for matching results back
  into another system. It adds columns, never rows, so the row count doesn't move.
- **Include the note from each survey** — on **Results by voter** only, beside the filters. Off by
  default; tick it to add what the canvasser typed beside each round's answers, one cell per
  round. This is the export built to be sent onward, so it stays off unless the recipient needs
  it: the answers are what somebody clicked, a note is a canvasser writing freely about a named
  person.

- **The options dialog** — on **Canvassing activity** and **Results by voter**, **Queue export**
  opens a dialog before anything is queued, holding the choices that change what the file *is*
  rather than narrowing it. Confirm there to queue.
  - The **Door outcome** chips (tick the outcomes you want; nothing ticked means all; leave
    *Restricted* or *Wrong address* unticked to drop them). On **Results by voter** they choose
    which *doors* are in the file, never how a door's outcome column reads — and there is no
    *Note added* chip, because writing a note is not a visit.
  - **One row per voter at the door** *(Canvassing activity)* — off by default; tick it and every
    knock that named nobody (not home, refused, lit drop, and so on) repeats once per voter
    registered at that address, same outcome and note on each. That adds **rows**, not columns,
    and the file is named `activity-log-by-voter` so its rows are never mistaken for knocks.
  - **Include survey answers** *(Canvassing activity)* — off by default; tick it and every survey
    row gains what was recorded, one column per question, plus which survey it was, when, who
    took it and whether an admin typed it at a desk. It also adds a row for each survey the file
    cannot otherwise show, because surveying three people at one door in one round is *one* knock
    and three surveys: those rows say **Row source: survey**, carry no Activity DB id, and must
    never be counted as knocks. Whenever it adds rows the file is named `activity-log-with-surveys` to say so. Tick
    *Not home* only and the option goes quiet — no survey rows to attach to, so no columns
    either. This is the one option the page remembers for the campaign, and it is still recorded
    on every export in the history.

  See [Exporting your data](exports) for what the repeated rows do and don't say about each
  person, and for what **Results by voter**'s Address columns claim.
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
the door** and one queued with the answers says **survey answers**, a **Results by voter** export
that carried the canvassers' notes says **survey notes**, and a Notes export that listed the
voters at each door says **voters listed at each door** — so the history is a lasting record of
which files carried them.

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

activity has the same **Door outcome** chips, the same **One row per voter at the door** switch
(under **Rows**) and the same **Include survey answers** switch, and the row count follows all
three. A **Notes** export is queued from the phone's own **Notes** screen instead, carrying the
filters you have on screen. The remaining types — **Results by voter**, detailed survey answers,
filtered voters, voter profile notes, and the full backup — stay on the web dashboard, and the
phone's history list names them properly when somebody queues one there. Downloads open the share
sheet, and touching and holding a row deletes it.
