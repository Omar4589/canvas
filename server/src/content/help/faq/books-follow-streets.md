---
slug: books-follow-streets
title: Why do my books look different after re-cutting?
audience: admin
kind: faq
order: 34
sourceDoc: PASSES_AND_TURF.md
summary: Where we hold street data for the area, books are grouped by walking distance instead of straight-line distance — so they no longer put houses together just because a canal happens to be narrow. Re-cutting is safe: knock history is kept.
tags: books, turf, cut, recut, streets, roads, canal, water, walk order, route
---

If you re-cut a pass and the books came out different, this is the most likely reason.

**Books used to be grouped by straight-line distance.** That works almost everywhere, and it quietly fails around water. Two houses on opposite banks of a canal can be 150 metres apart on the map and a couple of miles apart on foot — but a straight line can't tell, so they'd land in the same book and someone would be sent across a bridge for one door.

**Where we hold street data for an area, "close" now means close on foot.** The cut follows real streets, and so does the order the doors are listed in. There is nothing to switch on and nothing to draw.

Two things follow from that:

- **Books near water change shape.** That's the point — a book that used to straddle a canal gets split along the water instead.
- **Books can be slightly less even in size.** If refusing to cross the water means a small peninsula only holds 30 doors, that's a 30-door book. The **Tight / Balanced / Compact** control is what absorbs that.

**Where we don't have street data for an area, nothing changes** — those books are grouped by straight-line distance exactly as they always were.

### Is re-cutting safe once people have knocked?

Yes, as long as you leave the **"clear knock history"** box unchecked on the Discard step — it's unchecked by default.

Discarding books and re-cutting **does not touch knock history**. Every visit, survey and door status stays exactly as it was, because that history belongs to the *door* and the *round*, not to the book it happened to be in. New books will simply contain a mix of doors that have been knocked and doors that haven't, and doors that used to sit in different books can end up together.

What you **do** lose when you discard: book names, canvasser assignments, and any hand edits (doors you moved, books you merged, split or renamed). If the pass was live it goes back to draft, so **canvassers see no doors until you re-cut, accept and re-assign** — and any packets already printed are out of date. Every discard saves a snapshot first, so it can be undone from **Undo / snapshots**.
