---
slug: page-turf-cutting
title: The Turf Cutting page
audience: lead
kind: page
order: 105
sourceDoc: PASSES_AND_TURF.md
summary: Cut a pass's doors into books, accept them, assign them, and watch a round's progress.
tags: turf, books, cutting, assign, progress, status, page
---

**Turf Cutting** is where you turn a pass's doors into walkable **books** — geometrically, by attribute (like precinct), or by drawing areas on the map. You **Accept** the books to publish them, then **Assign** each to canvassers. It's also where you add new doors as a supplemental book, and move, merge, or split books.

## Watching a round's progress here

Once a round has been knocked, the map starts showing you how it's going:

- **Every house is colored by what happened at it in the round you've picked** — surveyed, not home, refused, restricted, or still unknocked.
- **The ring around each house is its book's color**, so you can see a house's status *and* which book it belongs to at the same time.
- **Book labels count the work** — `Book 4 · 23/65` means 23 of that book's 65 houses are done.
- **Books shade in as they fill up** — pale means untouched, solid means finished. Easy way to spot a book nobody has started.
- **The bar across the top** is the whole round's mix, and doubles as the color key.
- **Click a house** to see its status, who knocked it, when, and any survey answers taken there this round.

Status colors appear on their own once the round has knocks. While you're still cutting, houses stay colored by book — a brand-new cut has no progress to show yet. The **Door status** checkbox in the map's **Layers** box turns it on or off yourself.

**Hiding restricted homes.** When you exclude restricted-access homes from a cut, they still show on the map as gray dots — the same gray as doors not yet in a book — which can look like doors you still need to cut. Flip the **Restricted** checkbox in that same **Layers** box to hide them. It only appears when the round has restricted homes. Homes a canvasser marked restricted *inside* a book keep their book color and stay put, so you never lose worked doors.

Switch rounds with the **Pass** dropdown at the top right — the colors, the counts, and the bar all follow the round you pick. The page doesn't refresh on its own; reload it to see the latest.

## Marking a book restricted

If a whole book is behind a gate you can't get into, select it and choose **Mark restricted…** — every
unfinished door goes slate, stays out of your rates and knock counts, and the next cut can leave it out.

If the crew has already worked *part* of the book, you'll be asked which doors to mark: **only the
untouched ones** (the default when there's reached work — it leaves every door your crew already got to,
like not-homes and refusals, exactly as it is) or **every door not yet done**. Doors already surveyed
keep their result either way, and you can **Unmark restricted** to undo.

## Every house sits inside its book's shape

Each book's shaded shape **contains all of that book's houses**, and shapes never overlap. So the shape a house sits in, the ring around its dot, and its popup all name the same book.

One thing you may notice: a small **pocket** — a little island of one book's color sitting inside another book's area. That's not a mistake. Books are balanced to be similar in size, so a book sometimes owns a house in the middle of another book's houses; the map draws a pocket of the owning book's color right around that house so you can tell whose it is at a glance.

For the full walkthrough, see [Cutting and recutting books](turf-and-books).
