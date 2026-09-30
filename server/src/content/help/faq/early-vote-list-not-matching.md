---
slug: early-vote-list-not-matching
title: My early-vote list says most IDs aren't in this campaign
audience: lead
kind: faq
order: 74
sourceDoc: EARLY_VOTING.md
summary: Leading zeros no longer matter — so if a list still matches almost nothing, it's the column, the state, or a file that isn't a list of this campaign's voters.
tags: early voting, do not contact, walk list, voter id, leading zeros, excel, not found, not in this campaign, matched on column
---

**Leading zeros are not the reason any more.** Some states write voter IDs with zeros in front
(Georgia: `08719967`), and Excel turns that into `8719967` the moment a file is saved. Uploads now match
IDs **with or without** those zeros, in either direction, and the preview tells you how many matched that
way (*"1,190 matched only after ignoring leading zeros"*). Nothing to fix in the file.

So if a list still matches almost nothing, check these, in order:

1. **Matched on column.** The preview names the column it matched on and shows a few of its values. If
   it picked the wrong one (a vendor's own ID instead of the state's number, say), choose the right
   column from that dropdown; the preview re-runs on it.
2. **The state**, for a do-not-contact list. The upload only looks inside the campaigns of the state you
   picked, because two states can issue the same digits. If the preview reports IDs *outside* that
   state, they belong to another state's list.
3. **The campaign.** "Not in this campaign" means those voters were never imported into *this*
   campaign's universe — the list covers the whole county, the campaign a targeted slice. That's normal;
   those IDs are remembered and marked automatically if the voters are imported later.

**A voter file, not a list?** If it's the **Voter Import** page refusing a file with a red note about
leading zeros, that's a different thing: the file names voters already in the campaign under another
spelling of their ID, and importing it would add each of them a second time. The note shows a pair
(*file 8719967 → stored 08719967*) and says which side has the zeros; ask for an untouched export, or
make the ID column match the campaign's spelling, and upload again.

Two habits still help: don't open a voter file in Excel before uploading it, and know that *Save As
CSV* strips the zeros too. The upload copes; the Voter Import page will tell you.

The upload walkthrough is in [Dropping voters who already voted](early-voting); walk lists from a CSV
are in [Saved searches](saved-searches).
