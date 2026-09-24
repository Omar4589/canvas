---
slug: exports
title: Exporting your data
audience: lead
kind: guide
order: 24
sourceDoc: EXPORTS.md

summary: Queue background CSV exports — canvassing activity, doors by round, survey results, results by voter (the file you send a client), your voter file, or a filtered subset — and download them from the Exports page.
tags: export, csv, download, voter file, backup, data, results by voter, client file, survey answers
---

Your data is yours. The **Exports** page (open a campaign, then **Exports** in the sidebar — on
the phone: Admin → **More → Exports**) turns anything the campaign collected into a CSV you can
keep, open in Excel or Google Sheets, or load into another tool.

## How it works

1. Pick an export type and, if you want, narrow it with filters (date range, walk list, round,
   canvasser, door outcome, or a saved search). On the phone, tapping a type opens a sheet that describes the
   file, takes the same filters, and shows a **live row count** before you queue anything.

2. Press **Queue export**. For **Canvassing activity** and **Results by voter** a dialog opens
   first, holding the choices that change what the file *is* rather than narrowing it: the door
   outcome chips, and — on Canvassing activity — the one-row-per-voter box and **Include survey
   answers**. Confirm there. The file is built in the background — big exports can take a minute
   or two, and the list below updates as it goes.
3. When the row says **Ready**, press **Download**. Files are kept for **7 days**, then deleted
   automatically — you can queue a fresh one any time.

## What you can export

- **Canvassing activity** — every door result: who knocked, when, the outcome, and the voter at
  that door. The complete field record. Voter name and IDs fill in only when a survey named the
  voter — plain knocks like *not home* or *lit dropped* are about the door, so their voter

  columns are blank on purpose. Pressing **Queue export** on this type opens a dialog with three
  choices: **Door outcome** chips that narrow the file to the outcomes you tick (leave
  *Restricted* and *Wrong address* unticked to drop them, or tick only *Not home* for a re-knock
  list with the full detail), **One row per voter at the door**, which repeats those knocks
  once per registered voter at the address instead, and **Include survey answers**, which puts
  what each survey recorded beside the knock that took it — both explained below.
- **Doors by round** — one row per door per round with its status. Filter it to `not home` and
  you have a re-knock list.
- **Survey results** — one row per survey taken, one column per question. If the campaign ran
  more than one survey, you get one file per survey.
- **Survey answers (detailed)** — one row per recorded answer, exactly as captured at the door,
  even if a question's wording changed later.


Both survey exports — and **Results by voter** below — offer **Include contact & demographic
details**; see below.
- **Results by voter** — the file you send a client: one row per person at the doors you worked,
  with what happened at their address and what they said. Always one file, even when the campaign
  ran several surveys, because the row is the person. It is the only export that spells the outcome
  in plain English (*Not home*, *Refused*, *Surveyed*) — it is the one built to be read rather than
  re-imported. Answers are grouped by round. See below for what its Address columns do and don't
  claim.
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

- **Full backup** *(admins only)* — one ZIP for the campaign (or the whole organization) holding
  the voter file, canvassing activity, doors by round, both survey files, notes and voter profile
  notes, plus per-round totals and a README explaining each file. It is not *every* type on this
  list: **Results by voter** is left out because the bundle already carries the survey files, and
  **Filtered voters** because a saved search is a question only you asked. Queue either on its own
  when you want it.


Team leads can export from the campaigns they manage; org-wide exports, **Voter profile notes**,
and the full backup are admin-only. **Notes** is available to team leads — it covers the same
three sources they already read on the Notes page. So is **Results by voter**, with both of its
tick-boxes: a team lead is often the client paying for that campaign, so "can a lead export this"
and "is this fit to hand the customer" are the same question.

### About the door notes in a Notes export

A note typed at a door is a record about the **door**, not about a person — nobody was picked, so
it names no one. The Notes export can add a column listing the people registered at that address
beside the note, but you have to tick **Include the voters registered at each door** to get it,
and the export history records which downloads carried it. People who have asked not to be
contacted are never listed, and the count beside the list counts only the names shown.

### One row per voter at a door (Canvassing activity)

A *not home* is a fact about an address. If the tool you're handing the file to wants a fact
about a person — a row for every registered voter at the address — press **Queue export** on a
Canvassing activity export and tick **One row per voter at the door** in the dialog that opens
(on the phone: the **Rows** switch on the sheet). Every knock that named nobody (*not home*, *wrong address*, *refused*, *lit dropped*,
*no soliciting*, *restricted*) then comes out once per voter registered at that address, each
row carrying the same outcome, time, canvasser, GPS and note, with that voter's State voter ID,
UID, name and party filled in. Surveys, which already name the person, are unchanged.

Three things to know:

- **The outcome is repeated, not attributed.** A *refused* on three rows means someone at that
  address declined — not that each of the three did. *No soliciting* is a sign on the property.
  Neither is a request not to be contacted. *Restricted* rows repeat too, and many of those are
  desk marks over a whole book rather than a visit — the **Via** column says which, and unticking
  *Restricted* under **Door outcome** leaves them out altogether.
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

### Survey answers on a Canvassing activity export

Tick **Include survey answers** in the same dialog and every survey row gains what was actually
recorded — one column per question, plus which survey it was, its version, when it was submitted,
who took it, and whether an admin typed it at a desk rather than a canvasser at the door. If more
than one survey ran in the range, each question column is prefixed with its survey's name.

It also adds rows, and that is the point. Surveying three people at one door in one round is
**one** knock and **three** surveys, so two of those surveys have no knock row to sit on. Each one
becomes its own row instead, marked **Row source: survey** with no Activity DB id; the ordinary
ledger rows say **Row source: knock**. Never count a *survey* row as a knock — the per-round
exports remain the invoice-grade files. The finished file is named **activity-log-with-surveys**
(or **activity-log-by-voter-with-surveys**) so nobody has to guess.

Three more things:

- **Tick *Not home* only and the option goes quiet.** The answers ride the survey rows, so a file
  with surveys chipped out gains no columns at all and comes back identical to one queued without
  the option.
- **Filter to one canvasser and you get the columns, not other people's surveys.** That filter
  removes the rows the extra surveys would have been measured against, so no extra rows are added
  rather than somebody else's work being invented for them.
- **Two canvassers who surveyed the same person in one round both keep the answers.** What stands
  is the later submission, and both rows carry it, with **Survey taken by** saying whose survey it
  is. Blanking the earlier row would read as "no survey taken", which isn't true.

With **One row per voter at the door** on as well, the repeated neighbour rows carry no answers —
attaching one person's survey to everyone at the address would attribute it to people who never
gave it.

Your choice is remembered for this campaign, on the device you queued from — it is the only export
option that is — and every export still records it in the history.

### Results by voter — the file you send a client

**Results by voter** answers the question a client actually asks: *what happened with the people
you were sent to reach?* One row per registered voter at a door somebody walked to, plus anyone
you surveyed — even if they have since moved to a door nobody knocked. Each row carries the
voter's State voter ID, UID, name and party, their address, what happened at that address, and,
grouped by round, the surveys they took.

**The Address columns are about the door, not the person.** *Address outcome*, *Address visits*,
*Rounds worked*, *Address first / last visited* and *Last visited by* all describe the house.
*Refused* on a three-voter household means somebody there declined, not that all three did. The
outcome is the same one the map, Books and Door Outcomes show for that door — a marked-restricted
door reads *Restricted* here too — just spelled out instead of coded.

**Answers are grouped by round.** Every round that produced surveys gets its own group of columns:
a **Survey** cell naming the survey (and saying *(desk entered)* when an admin typed the answers
rather than a canvasser at the door), then one column per question. Somebody surveyed in two
rounds shows both sets side by side, so you can read the change without a second file. When there
is more than one group, each is labelled with its walk list *and* round, because round numbers
start again in every walk list.

**The visit numbers are not invoice numbers.** *Address visits* counts trips to the door, so a
house knocked twice in one round counts 2 — while a bill counts that round's door once. *Rounds
worked* counts the rounds a door was actually visited in. Neither is meant to reconcile against an
invoice or against **Doors by round**; the per-round exports remain the invoice-grade files.

Three limits worth knowing before you send it:

- **A door with nobody registered at it produces no rows** — and neither does a door where
  everyone registered has asked not to be contacted. The two are deliberately indistinguishable,
  so the absence of a row can never become a marker for an opt-out. **The row count is therefore
  not "the doors we worked."** **Doors by round** is the file that accounts for every door.
- **Deleted work is gone, not hidden.** A knock that was un-knocked, or a round that was
  discarded, leaves no record — so a door whose only visit was deleted drops out of this file
  entirely.
- **You get the survey that stands.** If a *different* canvasser replaced someone's survey in the
  same round, this file carries the replacement; the earlier answers are kept and listed under
  **Same round · overwritten** on the Duplicate Surveys page. A canvasser correcting their own
  submission simply overwrites it.

**Filters narrow the work, not the door's outcome.** A "last week, canvasser Ada" file prints
Ada's visits in that window, not the door's whole history. The **Door outcome** chips in the dialog
are the one exception: they decide which *doors* are in the file, never how a door's outcome column
reads — otherwise every row would say whatever you ticked. There is no *Note added* chip here,
because writing a note is not a visit.

Both tick-boxes beside the filters are off by default: **Include contact & demographic details**
(the same columns the survey exports offer) and **Include the note from each survey**. Leave the
note off unless the recipient needs it — the answers are what somebody clicked, a note is a
canvasser writing freely about a named person. The export history records which client files
carried either.

## Matching your file on another platform

The voter-bearing files carry two IDs side by side: **State voter ID** (the id from your voter
file) and **UID** (the vendor id from your original upload, when it had one). Either lets
another tool match the same people — so an export here re-matches cleanly wherever it goes
next.


### Contact & demographic details on the survey and client exports

By default these exports identify the person by name, party and address — enough to read,
not enough to be a copy of your voter file. When you need to write results back into another
system, tick **Include contact & demographic details** on **Survey results**, **Survey answers
(detailed)** or **Results by voter** and each row also carries:

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

How they drop out depends on what a row *is*. On **Results by voter** they are dropped whole — the
export is a list of people, so there is no row left to keep. On **Canvassing activity** the knock
stays, because it is a record of work that was done and billed, and it is their name, their survey
answers and the note from that survey that come out blank.

## Archived campaigns still export

Archiving a campaign makes it read-only — but reading is what an export does, so the Exports page keeps working exactly as before. Open the archived campaign (on the web it's in the archived section at the bottom of **Campaigns**; on the phone, pick it from the campaign chip under the **Archived · read-only** divider) and queue whatever you need. See [Archive vs. delete a campaign](archive-vs-delete-campaign).

## If your subscription ends

Your data stays exportable. During the 60-day wind-down the account is read-only, but queueing
and downloading exports keeps working — that window exists so you can take your data with you.
