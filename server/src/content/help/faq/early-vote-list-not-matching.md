---
slug: early-vote-list-not-matching
title: My early-vote list says most IDs aren't in this campaign
audience: lead
kind: faq
order: 74
sourceDoc: EARLY_VOTING.md
summary: The list has probably lost its leading zeros in Excel — how to tell, and how to put them back before you upload.
tags: early voting, do not contact, walk list, voter id, leading zeros, excel, not found, not in this campaign
---

Almost always, the list **lost its leading zeros**. Some states (Georgia, for one) write voter IDs a
fixed width with zeros in front, like `08719967`. Excel reads that as a number and shows `8719967`,
and the moment someone saves the file, the zero is gone for good. The app matches IDs exactly, so
`8719967` and `08719967` don't match, and the preview says **Not in this campaign** (or **Not found**)
for most of the file.

**How to tell.** Open a voter in the app and look at their Voter ID: if it starts with `0` and the IDs
in your file don't, that's it. The few that *did* match are usually the newest voters, whose IDs happen
not to start with a zero. Also check **Matched on column** in the preview; if it names the wrong
column, that's the other reason a list matches nothing.

**How to fix the file.**

1. In a spreadsheet, add a column next to the IDs with `=TEXT(A2,"00000000")`, using as many zeros as
   the IDs in the app are digits wide (eight for Georgia). Fill it down.
2. Copy that column and paste it **as values** over the original ID column.
3. Save as CSV and upload again. The preview should now show most IDs matching.

Or ask whoever sent the list for a fresh export with the ID column as **text**.

**How to avoid it.** Don't open a voter list in Excel before uploading it. If you have to, format the ID
column as **Text** first, and know that *Save As CSV* strips the zeros too.

The same applies to a [walk list from CSV](saved-searches), and to the do-not-contact lists admins upload.
The full walkthrough for the upload itself is in [Dropping voters who already voted](early-voting).
