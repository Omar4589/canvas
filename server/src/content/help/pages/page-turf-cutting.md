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

Switch rounds with the **Pass** dropdown at the top right — the colors, the counts, and the bar all follow the round you pick. The page doesn't refresh on its own; reload it to see the latest.

## Why a house can sit outside its book's shape

The shaded shape around a book is a drawing aid — the book is really just its list of houses. Shapes are trimmed so neighboring books never overlap, and books are balanced to be similar in *size*, so a book sometimes owns a house that sits closer to the next book over. When that happens the house falls outside the drawn shape even though the book still owns it.

To tell which book a house truly belongs to, look at its **ring color**, or click it — both come from the book itself.

For the full walkthrough, see [Cutting and recutting books](turf-and-books).
