---
slug: walk-lists
title: Walk lists
audience: lead
kind: guide
order: 13
sourceDoc: EFFORTS.md
summary: Run parallel operations in one campaign — each walk list owns its own doors, survey, crew, and passes.
tags: walk lists, intake, doors, crew, saved search, passes, archive, unarchive, undo
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

- **From a saved search** — build one on the [Saved Searches](saved-searches) page (by filter or by uploading a CSV or Excel file of Voter IDs), then seed the walk list from it. Use this when Intake holds a mix of doors and you only want some. If some of its doors already belong to another walk list, the claim line says how many weren't moved and offers **Move them here…** — the same confirm described below.
- **Claim all Intake** — grabs every unowned door at once. Quick, but only when all current Intake is exactly what you want.

## Re-carving an existing campaign

Your campaign starts as one default walk list ("Main") owning every door. To split it up, build a saved search for each new area and seed a new walk list from it. Because those doors belong to "Main," the app asks you to confirm a **move (re-carve)** — and the confirm spells out the stakes: how many doors each list loses, and how many of its books that guts or empties. Before anything moves, each affected list's books are **snapshotted** (restorable from its Turf page under Undo / snapshots — bring an archived pass back first), then the move runs in the background with a progress bar. One thing to know: **moving doors back later does not rebuild their old books** — they come back bookless until you re-cut or restore the snapshot. Rename or archive the emptied leftover when you're done. Archiving it **ends its live pass**, so its books leave canvassers' phones — check first that nobody is still working one of them (you can unarchive it and bring the pass back). A list with recorded knocks can be archived but not deleted — its history stays readable in reports; a home marked restricted from the desk on one of its draft rounds counts as history too, so unmark it first if you really mean to delete.

## When a walk list is done: archive it

**Archive** on the Walk Lists page ends the walk list's live pass and makes the walk list read-only. Nothing is deleted. A box first tells you exactly what will end: the live pass, how many of its books leave how many canvassers' phones (the next time their map refreshes), and that its knocks stay counted. If a pass is live, you type `archive` to confirm.

- **Undo, right away.** A line at the top of the page — like *North archived — Pass 3 ended.* — has an **Undo** link that puts the walk list and its pass back in one click.
- **Unarchive, later.** Archived walk lists fold into an **Archived walk lists** section at the bottom of the page. **Unarchive** asks whether to bring the ended pass back too — **Unarchive and bring Pass 3 back** returns the same books to the same canvassers' phones on their next refresh — or leave it ended (**Unarchive only**; the pass keeps its own **Bring back**). If the pass can't come back, the box says why and offers a plain **Unarchive**.
- **While it's archived, it's read-only.** You can still rename it, and its history stays everywhere: Door Outcomes, notes, exports, and every report filter, where it's marked "(archived)" and listed last. Everything else waits until you unarchive — no claiming doors into it, no crew or survey changes, no new or started passes, no book changes. Its draft passes stay drafts. Its doors stay with it; to use some elsewhere, claim them into another walk list (that still works).
- **On canvassers' phones**, after the app update, someone whose only book it was sees *No book right now*. Anything they'd already saved still counts — including doors recorded with no signal that reach Doorline later, which count in the pass they were knocked in.

Archived something by mistake? See [I archived a walk list or a pass by mistake](undo-archive). Each archive and unarchive shows in the campaign's [History](who-changed-the-door-goal).

> Tip: The crew count fills itself in — assign a book to someone on the [Turf & Books](turf-and-books) page and they join the crew automatically.
