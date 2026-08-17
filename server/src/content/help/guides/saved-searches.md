---
slug: saved-searches
title: Saved searches
audience: lead
kind: guide
order: 12
sourceDoc: WALKLISTS.md
summary: A saved search is a frozen set of doors you build by filter or CSV, then hand to a walk list.
tags: saved search, walk list, filter, csv, voter id, doors
---

## What a saved search is

A **saved search** is a named, frozen set of doors carved out of your campaign's voter pool. It's the bridge between "who's in my universe" and "which crew works which doors."

*Frozen* is the key word. Once you save it, the doors are locked in. Importing more voters later, or someone moving, won't change an existing saved search. If you want a fresh cut, build a new one.

## Two ways to build one

On the **Saved Searches** page, the "Build a saved search" panel has two modes:

- **Filter builder** — pick doors by the data you already have: party, precinct, district, age, geography, door status, and even [survey answers](surveys). Combine filters with **AND** (match all) or **OR** (match any). An **Exclude doors** section lets you throw doors *out* as well: a door matching any of its conditions is removed even if it matches your other filters — say, supporters minus everyone who already took a yard sign. Use this when the people you want can be *described* by their data.
- **Upload a Voter-ID CSV** — upload a spreadsheet with a column of Voter IDs. The app matches them to this campaign's voters and freezes the doors they live at. Use this when you already have an exact list filters can't express — say, everyone who voted in the first election. These show a **from CSV** badge.

Both produce the same thing: a frozen door set. You can build one the moment your first import finishes, so even your very first walk list can be targeted instead of "everyone."

## The whole-door rule

A saved search holds **doors, not voters**, so a home joins if **any** voter there is a match. And since walk lists own whole doors, claiming a door later moves *all* the voters at it — not just the ones you matched. At a two-voter home where only one person is on your list, both come along. The CSV preview shows both numbers so the difference is clear.

## Turning it into doors

A saved search doesn't assign work on its own — it feeds a [walk list](walk-lists), two ways:

1. **Seed at creation** — create a new walk list and pick your saved search under **Doors**.
2. **Claim later** — open a walk list, choose Claim, and pick the saved search.

Either way, claiming only takes the saved search's unowned doors (those sitting in [Intake](what-is-intake)). If some already belong to another walk list, the app shows you exactly what moving them would do to each list's books — and snapshots those books before the move, so it's undoable.

> Tip: Every saved search has a **Download CSV** action that exports its frozen voters — great for handing a phone bank the numbers or a mail house the addresses.
