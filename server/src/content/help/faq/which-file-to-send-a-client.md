---
slug: which-file-to-send-a-client
title: Which file do I send my client?
audience: lead
kind: faq
order: 73
sourceDoc: EXPORTS.md
summary: Results by voter — one row per person at the doors you worked, with the door's outcome in plain English and their answers by round. It is not an accounting of doors, and its visit counts are not invoice lines.
tags: export, csv, client, results by voter, deliverable, survey, download
---

**Results by voter**, from the campaign's **Exports** page. Queue it on the web — the phone's
Exports screen offers four types, though it lists every finished file in its history either way.

One row is one person: every registered voter at a door your team actually visited, plus anyone
you surveyed, even if they have since moved to a door nobody knocked. Each row carries their name
and party, the address, **what happened at that address in plain English** (*Not home*,
*Surveyed*, *Refused*, *Restricted*, …), when it was first and last visited, who was there last,
how many visits and how many rounds it took, and their answers — one block per survey and round,
so somebody surveyed twice shows both sets side by side. It is the one export written to be read
rather than re-imported.

Four things to be straight about before you send it:

- **It is not a count of the doors you worked.** A visited door with no registered voters on file,
  and a door where everyone has asked not to be contacted, both produce no rows at all — and the
  file deliberately cannot tell those two apart, because an "omitted here" count would itself
  point at the person who opted out. **Doors by round** is the file that accounts for every door.
- **Address visits and Rounds worked are not invoice lines.** Address visits counts visits, so a
  door worked twice in one round reads 2 while billing counts that door once for that round. Don't
  reconcile this file against an invoice or against Doors by round's per-round visit column: those
  count doors per round, this counts visits to an address.
- **The address columns describe the door, not the person.** *Refused* on a three-voter house
  means somebody there declined, not that each of the three did, and it is not a do-not-contact
  request. See [Restricted vs. refused](restricted-vs-refused).
- **Personal detail is off by default, on purpose.** Two tick-boxes beside the filters add it:
  **Include contact & demographic details** (phone, date of birth, precinct, districts,
  coordinates) and **Include the note from each survey** — the answers are what somebody clicked,
  a note is a canvasser writing freely about a named person. This is the export that leaves your
  organization, so both stay off unless you turn them on, and both are printed on the export's
  history row so you can always tell which download carried them.

People who have asked not to be contacted are not in this file at all: here the row *is* the
person, so they are dropped whole and counted in the withheld figure. Row counts can therefore sit
below what the dashboard shows.

If what the client actually wants is the weekly picture rather than a spreadsheet, publish a
**client report** instead — headline numbers, breakdowns, your written observations and a coverage
map on a login-free link. See [Client reports and share links](client-reports) and [Exporting your
data](exports).
