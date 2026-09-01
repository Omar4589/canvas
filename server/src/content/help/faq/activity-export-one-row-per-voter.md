---
slug: activity-export-one-row-per-voter
title: Can I get one row per voter on the canvassing activity export?
audience: lead
kind: faq
order: 48
sourceDoc: EXPORTS.md
summary: Yes — tick One row per voter at the door when you queue it, and every not-home (or refused, lit drop…) repeats once per registered voter at that address; the file is renamed so its rows are never counted as knocks.
tags: export, csv, activity, not home, voters, rows, download
---

Yes. By default the **Canvassing activity** export is one row per door event, and a knock that
named nobody — *not home*, *refused*, *wrong address*, *lit dropped*, *no soliciting*,
*restricted* — comes out as one row with the voter columns blank, because nobody was picked.
When you queue the export, tick **One row per voter at the door** (on the phone: the **Rows**
switch on the sheet) and each of those knocks repeats once per voter registered at that
address — same outcome, time, canvasser, GPS and note on every row, with that voter's State
voter ID, UID, name and party filled in. Surveys already name the person and don't change.

It's built for handing to a voter-keyed system — a mail-merge to everyone whose door was tried,
matching every household member touched by a not-home — not for counting.

Two things to keep straight:

- **Repeated, not attributed.** A *refused* on three rows means someone at that address
  declined, not that each of the three did; *no soliciting* is a sign on the property. Neither
  is a do-not-contact request.
- **Rows are not knocks.** The columns are identical but the row count isn't, so the file is
  named **activity-log-by-voter** — never use it for an invoice (see [How do I export knocks by
  pass for an invoice?](export-knocks-for-invoicing)). Every row of one knock shares the same
  **Activity DB id**.

Want to drop restricted-access or wrong-address entries at the same time? Leave those unticked
under **Door outcome** and they stay out of the file, fanned or not.

People who have asked not to be contacted are never listed, and an address with nobody to list
keeps its single blank row. The export history says **one row per voter at the door** on any
file that carried it. See [Exporting your data](exports).
