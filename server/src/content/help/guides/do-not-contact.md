---
slug: do-not-contact
title: Honoring "don't contact me again"
audience: admin
kind: guide
order: 21
sourceDoc: VOTERS.md
summary: Mark a voter Do not contact — they drop out of walk lists, exports, and surveys everywhere, and a fully-flagged door leaves the map.
tags: do not contact, dnc, opt out, privacy, remove, skip, complaint, suppression list, upload, csv, excel, xlsx
---

## When someone asks to be left alone

Sometimes a person tells a canvasser — or calls the campaign — that they never want to be contacted
again. **Do not contact** is how you honor that, permanently.

> **Asking about the *house*, not the person?** If a resident says "never come to this door again",
> that's **[Do not knock](do-not-knock)** — it suppresses the whole address, including the
> housemates, which Do not contact deliberately does not.

The flag lives on the **person**, not the campaign: set it once and it follows them into every
future campaign your organization runs, on every campaign type — literature drops included.

## Marking one voter

Open the voter in **Voters** and use the **Do not contact** section on their profile. A written
reason is required — it becomes part of the voter's notes, so anyone looking later can see who set
it, when, and why. Removing the flag works the same way and is also recorded.

## Uploading a whole list

Have a suppression list from a client or a prior cycle? On the **Voters** page, open
**Do-not-contact list**, pick the **state the list is for**, and upload a CSV or Excel file (`.xlsx`) of
Voter IDs in the box labelled **Do-not-contact file (CSV or Excel)**. It works like the Early Voting
upload:

1. A preview runs first — how many voters match, how many are already flagged, and how many doors
   would drop off the map, campaign by campaign. It names the column it matched on (and lets you
   change it), and IDs match with or without leading zeros. Nothing changes yet.
2. Apply to flag them. Every upload appears in the history below with an **Undo** button that
   reverts exactly the voters that upload flagged — voters you flagged by hand are never touched.
3. IDs that don't match anyone yet are remembered for that state: if that voter shows up in a later
   import under the same ID, they're flagged automatically. (If the later import spells the ID
   differently — zeros added or dropped — upload the list again afterwards; it will match then.)

A list can be up to 50 MB, CSV or Excel. Only the Voter ID column is used, so if yours is bigger, save a
copy with just that column and upload that. Every row of the file counts.

**Excel files.** Only the first tab you can see is read; when the workbook has other tabs, the preview
names the one it read, so check it's your list. A workbook with **rows hidden in Excel** (by a filter,
say) is refused with how many. Hidden rows are still in the file, so the app won't guess what you
meant: counting them could flag people you filtered out, and skipping them could leave someone off
this list. Clear the filter or delete those rows, save, and upload again. Old-format and
password-protected workbooks are refused with the fix (open in Excel, remove any password, **Save As →
Excel Workbook (.xlsx)**), and so is a damaged one. An Excel file's first tab must also unpack to
320 MB or less, about 184,000 rows of a 35-column file.

**If the Voter ID column isn't found,** pick it from the list and press **Match column**. Column names
need to be in row 1 of the first tab, and the box says so, with the row they seem to be in when a
title sits above them. If your last upload for that state (the most recent one you didn't undo) used a column this file also has, it's already chosen;
check it and press **Match column**.

**Fixed the file? Pick it again** and the preview re-runs. If you edit a file after picking it, pick
it again before applying.

**Why the state matters.** Two states can issue the same digits, so the app only looks inside the
campaigns of the state you picked. If the file names voters in other states' campaigns, the preview
says so and offers those IDs as a download; nothing outside the state is flagged. A list that covers
two states is two uploads, one per state.

## What changes in the field

- The voter disappears from **walk-list exports** (even lists saved before you set the flag) and
  is never included in new walk lists.
- Canvassers see a **Do not contact** badge on the voter at the door, and the survey button is
  disabled for them. The server refuses a survey for a flagged voter no matter what.
- The rest of the household is unaffected — one flagged voter doesn't hide the door, and canvassers
  are still routed there for the housemates. **If that's not what you want, use
  [Do not knock](do-not-knock) instead**, which suppresses the address itself. But once
  **everyone** at an address is flagged, the whole door drops off books, maps, and future turf
  cuts, and shows in reports as its own **Do not contact** coverage segment.
- Nothing historical changes: past knocks and surveys stay in your reports (marked, so an export
  can't be mistaken for a call list), and your counts and billing never move.

If a new resident is imported into a fully-flagged address later, the door comes back
automatically — only the flagged individuals stay suppressed. (Do not knock is the opposite: it
never reopens on its own.)
