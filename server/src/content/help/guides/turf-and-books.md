---
slug: turf-and-books
title: Cutting and recutting books
audience: lead
kind: guide
order: 14
sourceDoc: PASSES_AND_TURF.md
summary: Cut a pass into walkable books, accept and assign them, and reshape or recut safely.
tags: turf, books, recut, cutting, assign, supplemental
---

A **book** is a walkable, ordered slice of households — one canvasser's turf for a single [Pass](passes). Turf-cutting is how you turn a pass into books.

## Cut the books

On the Turf Cutting page, pick how to slice the doors:

- **Geometric** (the default) groups households into compact, walkable books by location. Your door count is an *approximate target*, not a hard cap — books flex so no house is stranded far from the rest. A **Tight / Balanced / Compact** control sets how much sizes may flex.
- **By attribute** makes one book per precinct, county, city, ZIP, or district. You'll see each group's door count first, so you can set a smart cap.
- **Manual** lets you draw areas on the map — each area becomes a book, with live house and voter counts as you draw.

Cuts only include knockable doors. Already-voted homes are skipped, and you can leave out apartments and [restricted-access homes](restricted-vs-refused) too.

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
