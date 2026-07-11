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

## Where it lives

Open the campaign you're working in and pick **Early Voting** from its sidebar. The campaign shown at the top is the one you're uploading to, so double-check it matches the election you mean before you start.

1. Choose your voted-voters CSV. Any column that looks like a Voter ID is found automatically, and a preview runs right away, no changes yet.
2. The preview tells you how many will be marked, how many already were, how many doors will drop, and how many IDs aren't in this campaign's list.
3. Click **Mark these voters voted** to apply. You'll see the totals, and an upload history builds up below with an **Undo** button on each one.

## Voted person vs. finished door

A **voted person** just gets a green **✓ Voted** badge. If someone else at that address still needs a knock, the door stays on the map. A door only disappears once *everyone* living there has voted.

## Undo anytime

Every upload is logged. Hit **Undo** and it un-marks the voters that upload added and re-opens any doors that dropped because of them. You can also un-mark a single voter if just one was a mistake.

## "Not found" is remembered

Some IDs won't match yet, usually because those voters haven't been imported into this campaign. That's fine. The app remembers them, and the next time you [import voters](voter-imports), any that now match are marked automatically, no re-upload needed.

> Tip: Upload one campaign at a time. A person can be voted in one election but not another, so marks stay tied to the campaign you uploaded to.

Fully-voted doors also drop from new [walk lists](walk-lists) and turf cuts, and they show up in a separate **Voted** slice of your [coverage numbers](coverage-vs-knocks) instead of as unknocked.
