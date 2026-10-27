---
slug: early-voting
title: Dropping voters who already voted
audience: lead
kind: guide
order: 20
sourceDoc: EARLY_VOTING.md
summary: Upload a list of voters who already voted so their doors drop off canvassers' books.
tags: early voting, voted, absentee, voter id, doors, undo
---

## Stop knocking doors that are done

If someone has already voted early or absentee, there's no reason for a canvasser to visit them. Upload a list of those voters and the app takes their homes out of rotation once everyone at the address has voted.

The app matches your list **by Voter ID** and marks each person as voted. Nothing gets re-cut, and every upload can be undone.

One upload covers the whole campaign: every [walk list](walk-lists), every [pass](passes), and the doors still in Intake. You never upload per walk list, and a pass you start later already leaves those doors out.

## Where it lives

Open the campaign you're working in and pick **Early Voting** from its sidebar. The campaign shown at the top is the one you're uploading to, so double-check it matches the election you mean before you start.

1. Choose your voted-voters CSV. Any column that looks like a Voter ID is found automatically, and a preview runs right away, no changes yet.
2. The preview names the column it matched on, with a few of its values, and lets you pick a different one from the dropdown if the app chose wrong. IDs match **with or without leading zeros** (a list that went through Excel still matches), and the preview says how many matched that way. It also tells you how many will be marked, how many already were, how many doors will drop, and how many IDs aren't in this campaign's list.
3. Click **Mark these voters voted** to apply. You'll see the totals, and an upload history builds up below with an **Undo** button on each one.

**Big files.** A file can be up to 50 MB. Only the Voter ID column is used, so if a state or county sends you something bigger, save a copy with just that column and upload that. Check what the file lists first: an early-voting file often includes everyone who was *sent* a ballot, returned or not. Keep only the people who have already voted.

## Voted person vs. finished door

A **voted person** just gets a green **✓ Voted** badge. If someone else at that address still needs a knock, the door stays on the map. A door only disappears once *everyone* living there has voted.

Canvassers with the app open lose a finished door within about 30 seconds while they're on the map. Someone a canvasser added at the door is never on a state list, so they keep that door open; if you delete them and everyone left has voted, the door drops right away.

## Undo anytime

Every upload is logged. Hit **Undo** and it un-marks the voters that upload added and re-opens any doors that dropped because of them. You can also un-mark a single voter if just one was a mistake. Canvassers who already have the app open get the returned doors back on their own within about 30 seconds while they're on the map.

## "Not found" is remembered

Some IDs won't match yet, usually because those voters haven't been imported into this campaign. That's fine. The app remembers them, and the next time you [import voters](voter-imports), any that now match are marked automatically, no re-upload needed, however the import spells the ID. If a list matches almost nothing, check the column it matched on first: [My early-vote list says most IDs aren't in this campaign](early-vote-list-not-matching).

> Tip: Upload one campaign at a time. A person can be voted in one election but not another, so marks stay tied to the campaign you uploaded to.

Fully-voted doors also drop from new [walk lists](walk-lists) and turf cuts, and they show up in a separate **Voted** slice of your [coverage numbers](coverage-vs-knocks) instead of as unknocked.
