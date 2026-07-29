---
slug: walk-lists
title: Walk lists
audience: lead
kind: guide
order: 13
sourceDoc: EFFORTS.md
summary: Run parallel operations in one campaign — each walk list owns its own doors, survey, crew, and passes.
tags: walk lists, intake, doors, crew, saved search, passes
---

## What a walk list is

A walk list is a self-contained operation inside a campaign — think "North Dallas" or "the volunteer crew." Each one owns its own set of doors, its own optional survey, its own crew of canvassers, and its own [passes](passes). Creating a walk list also creates its **Pass 1** for you.

The key rule: every door belongs to **exactly one** walk list. Two walk lists in the same campaign never share a door — if two operations truly need the same doors, that's two campaigns.

## Intake: doors nobody owns yet

Doors that haven't been claimed by any walk list sit in **Intake**. When you import voters, brand-new addresses land in Intake and stay there — uncanvassed — until you assign them to a walk list. New voters at a door a walk list already owns just ride along automatically. See [What is Intake](what-is-intake).

## Running several at once

A campaign can have many active walk lists at once, each with its own active pass. Canvassers only see the books assigned to them, and if someone is on more than one walk list, their phone shows a switcher so book numbers don't collide. And once a campaign has two or more, a walk-list filter appears on the dashboard, the [maps](maps), the Timeline, and the [GPS audit](audit) — and a [client report](client-reports) can be scoped to one list too — so every surface can show one operation's numbers or the whole-campaign totals. More in [Multiple walk lists](multiple-walk-lists).

## Giving a walk list its doors

You claim doors two ways:

- **From a saved search** — build one on the [Saved Searches](saved-searches) page (by filter or by uploading a Voter-ID CSV), then seed the walk list from it. Use this when Intake holds a mix of doors and you only want some.
- **Claim all Intake** — grabs every unowned door at once. Quick, but only when all current Intake is exactly what you want.

## Re-carving an existing campaign

Your campaign starts as one default walk list ("Main") owning every door. To split it up, build a saved search for each new area and seed a new walk list from it. Because those doors belong to "Main," the app asks you to confirm a **move (re-carve)** — the doors cleanly leave Main and join the new list. Rename or delete the empty leftover when you're done.

> Tip: The crew count fills itself in — assign a book to someone on the [Turf & Books](turf-and-books) page and they join the crew automatically.
