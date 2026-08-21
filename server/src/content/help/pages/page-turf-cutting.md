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

**Turf Cutting** is where you turn a pass's doors into walkable **books** — geometrically, by attribute (like precinct), or by drawing areas on the map. For a follow-up round, the optional **Target doors** panel narrows the cut to just the doors you're chasing, and **Exclude doors** removes the ones you want skipped — like doors that already took a yard sign (see [Passes](passes)). You **Accept** the books to publish them, then **Assign** each to canvassers. It's also where you add new doors as a supplemental book (**Add as new book** — runs in the background with a progress bar), and move, merge, or split books.

## Watching a round's progress here

Once a round has been knocked, the map starts showing you how it's going:

- **Every house is colored by what happened at it in the round you've picked** — surveyed, not home, refused, no soliciting, restricted, or still unknocked.
- **The ring around each house is its book's color**, so you can see a house's status *and* which book it belongs to at the same time.
- **Book labels count the work** — `Book 4 · 23/65` means 23 of that book's 65 houses are done.
- **Books shade in as they fill up** — pale means untouched, solid means finished. Easy way to spot a book nobody has started.
- **The bar across the top** is the whole round's mix, and doubles as the color key.
- **Click a house** to see its status, who knocked it, when, and any survey answers taken there this round.

Status colors appear on their own once the round has knocks. While you're still cutting, houses stay colored by book — a brand-new cut has no progress to show yet. The **Door status** checkbox in the map's **Layers** box turns it on or off yourself.

**Hiding doors that aren't in a book.** After a cut — especially a second pass where you only cut the unknocked doors — every door left out of a book (the already-worked ones, restricted homes, voters added since you cut) still shows on the map as a gray dot, so the round can look bigger than the actual walk. The **Not in a book** checkbox in the **Layers** box hides them all in one flip. It starts hidden, so the map opens showing just the cut's books, and only appears when the cut left doors loose. Homes that are *inside* a book — including one a canvasser marked restricted mid-round — keep their book color and stay put, so you never lose worked doors.

Switch rounds with the **Pass** dropdown at the top right — the colors, the counts, and the bar all follow the round you pick. The page doesn't refresh on its own; reload it to see the latest.

**Making the map bigger.** Use the chevron on the **Generate books** header to collapse that panel so the map fills the space — a small button at the top-left of the map brings it back, and it stays collapsed next time. For an even bigger view, the **fullscreen** button (also top-left of the map) expands the map to the whole screen; press **Esc** or the button again to come back.

## Leaving homes out of the next round

When you cut a round, two checkboxes appear above **Generate** whenever there's anything to skip:

- **Exclude N restricted-access homes** — doors nobody could reach.
- **Exclude N no-soliciting homes** — doors with a posted sign your canvassers honored.

Both are **on by default** and both are independent — tick either, both, or neither. Either way it's
non-destructive: the homes stay in the campaign and in every count, they're just left out of *this
round's* books, and they come back automatically if someone re-records the door later.

## Marking a book restricted

If a whole book is behind a gate you can't get into, select it and choose **Mark restricted…** — every
unfinished door goes slate, stays out of your rates and knock counts, and the next cut can leave it out.

If the crew has already worked *part* of the book, you'll be asked which doors to mark: **only the
untouched ones** (the default when there's reached work — it leaves every door your crew already got to,
like not-homes and refusals, exactly as it is) or **every door not yet done**. Doors already surveyed
keep their result either way, and you can **Unmark restricted** to undo.

## Marking one home restricted

One locked gate, one building nobody can get into — you don't have to mark the whole book. **Click the
house** on the map and choose **Mark restricted…** in its popup; it's the same mark as above, for that one
door: canvassers see it slate, it stays out of your rates and knock counts, and the next cut can leave it
out. One confirm, no note. It works on a draft cut, an accepted book, or a loose dot not in any book (loose
dots are hidden after a cut — tick **Not in a book** under **Layers** first). For an apartment building,
the building's popup has **Mark building restricted…** for every unit at that pin, and **Unmark
restricted (N)** to take the desk marks back — N counts every unit restricted this round, and marks
canvassers recorded stay. A door your crew already surveyed this round keeps its result and can't be
marked; a door they reached but didn't finish (a not-home, say) *is* marked — the knock stays counted.

To undo, open the same popup: a door marked from the desk reads *Marked from the desk by …* and has
**Unmark restricted**. A door a **canvasser** marked restricted at the door reads *Recorded at the door
by …* and has no desk undo — only a canvasser re-knocking it changes it. A book's **Unmark restricted (N)**
takes back every desk mark on the book's doors too, single-home ones included (on a draft cut the book's
Unmark isn't offered yet, so use the popup until you accept).

Two things you'll notice: the first mark on a draft cut switches the map from book colors to **status
colors** (uncheck **Door status** under **Layers** to go back), and the **Discard** dialog counts the mark
among the round's recorded work. Re-cutting or discarding drafts doesn't undo it — the mark follows the
door into whichever book it lands in next. Marks land on the round you have selected at the top right.

You can do the same on your phone — from the admin **Map** tab's door sheet, or by tapping a house inside a
book — and from the web [Map page](page-map). See [Can I mark just one house restricted?](mark-one-home-restricted).

## Every house sits inside its book's shape

Each book's shaded shape **contains all of that book's houses**, and shapes never overlap. So the shape a house sits in, the ring around its dot, and its popup all name the same book.

One thing you may notice: a small **pocket** — a little island of one book's color sitting inside another book's area. That's not a mistake. Books are balanced to be similar in size, so a book sometimes owns a house in the middle of another book's houses; the map draws a pocket of the owning book's color right around that house so you can tell whose it is at a glance.

For the full walkthrough, see [Cutting and recutting books](turf-and-books).
