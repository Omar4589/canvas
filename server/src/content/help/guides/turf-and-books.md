---
slug: turf-and-books
title: Cutting and recutting books
audience: lead
kind: guide
order: 14
sourceDoc: PASSES_AND_TURF.md
summary: Cut a pass into walkable books, accept and assign them, and reshape or recut safely.
tags: turf, books, recut, cutting, assign, supplemental, mobile
---

A **book** is a walkable, ordered slice of households — one canvasser's turf for a single [Pass](passes). Turf-cutting is how you turn a pass into books.

## Cut the books

On the Turf Cutting page, pick how to slice the doors:

- **Geometric** (the default) groups households into compact, walkable books by location. Your door count is an *approximate target*, not a hard cap — books flex so no house is stranded far from the rest. A **Tight / Balanced / Compact** control sets how much sizes may flex.
- **By attribute** makes one book per precinct, county, city, ZIP, or district. You'll see each group's door count first, so you can set a smart cap.
- **Manual** lets you draw areas on the map — each area becomes a book, with live house and voter counts as you draw.

Cuts only include knockable doors. Already-voted homes are skipped, and you can leave out apartments and [restricted-access homes](restricted-vs-refused) too. Doors you leave out aren't deleted — they stay visible and counted on the [Map](page-map), where you can dim or hide them; they're simply never cut into a book, sent to a phone, or printed.

Cutting a follow-up round? The **Target doors** panel narrows the cut to just the doors you're chasing — the not-homes, the undecided — so canvassers only get those. See [Passes](passes) for how it works.

## Accept, then assign

New books start as **drafts** — canvassers see nothing yet. Re-cut freely; when you're happy, **Accept** to publish them. Only published books can be [assigned to canvassers](assigning-canvassers).

## Check on a round without leaving the page

Once canvassers have started, the same map shows you how the round is going: houses colored by what happened at them **in the round picked in the Pass dropdown**, a book-colored ring on each so you can still tell books apart, `23/65` counts in the book labels, and books that shade in as they fill up. Click a house for who knocked it, when, and any answers taken there. See [The Turf Cutting page](page-turf-cutting) for the details.

## Recutting is all-or-nothing

Don't like the layout, or the voter list changed? If the books are still drafts, just generate again. If they're published, you must **Discard** first — see [Recut books mid-pass](recut-books-mid-pass) for how that's guarded and how it keeps knocks while clearing assignments.

## Smaller fixes

- Added a few new addresses? Use **Add as new book** to cut only the doors not yet in any book — no recut, no downtime.
- Reshape a book or two with **move**, **merge**, or **split**.
- A book gated off? **Mark restricted** — and if only *part* of it is out of reach, mark **just the untouched doors**, leaving the ones your crew already reached alone. See [The Turf Cutting page](page-turf-cutting).

> Tip: Knocks follow the *door*, not the book — so moving, merging, or splitting never changes your [coverage or knock counts](coverage-vs-knocks).

## Assigning from your phone

Cutting books is web work — you're drawing on a map. **Handing them out isn't.** The mobile admin app's **Books** tab works the campaign's active round: switch between **By book** (each book's doors, its knocked/total progress, and who's on it) and **By canvasser** (each person's book count — tap to give or take books). **Select** several books and hand them out in one go: **Distribute** splits them across people, **Everyone** gives all of them to each. A **Map** chip draws the whole round as book outlines so you can see where the unassigned turf actually sits before you hand it out, and tapping a book opens its own map to assign in context.

Need them back? The same bar has **Unassign all**, which takes every canvasser off the books you've selected in one action — handy when a shift ends or you're reshuffling turf. It only shows up when somebody is actually on one of them, and it asks you to confirm first. On the web Turf Cutting page, the selected-books panel does the same thing with **Unassign all (N)**.

Unassigning is safe: **nobody loses any work.** Every door they knocked and every survey they saved still counts toward the campaign, and they stay on the campaign team — they just stop being pointed at those books, so you can hand them to someone else.

Only people already on the campaign can be given a book, so if someone's missing, add them to the campaign first. Canvassers pick up changes on their next sync — including books taken away, so someone already out walking will still see them until their app reloads the campaign. Anything they record in the meantime still counts. See [Changes I make aren't showing up in the field](changes-not-showing-in-field).

The Books tab follows the **campaign chip** at the top. Pick an **archived** campaign and it becomes a viewer: you'll see the book layout and how the round finished, but assigning is off, because an archived campaign is read-only.

## Handing a book out on paper

A book doesn't have to go to a phone. **Campaign → Print Packets** turns any book into a printed packet — addresses in walk order, who lives there, and room to write — for volunteers who aren't using the app; a big book can be split into several volunteer-sized packets right on that screen, without re-cutting anything. There's a **Print this book on paper** shortcut in the assignment panel too.

One thing to plan around: printed packets are **print-only**, so a book walked on paper keeps reading as **0 knocked** here and everywhere else. If a paper crew is working alongside app canvassers, cut the paper doors into their own book and leave it **unassigned** — an unassigned book is invisible to every canvasser in the app, so nobody walks the same street twice. See [Printing packets for a paper canvass](printing-walk-packets).
