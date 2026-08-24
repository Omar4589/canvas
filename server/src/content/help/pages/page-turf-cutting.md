---
slug: page-turf-cutting
title: The Turf Cutting page
audience: lead
kind: page
order: 105
sourceDoc: PASSES_AND_TURF.md
summary: Cut a pass's doors into books, accept them, assign them, and watch a round's progress.
tags: turf, books, cutting, assign, progress, status, move, page
---

**Turf Cutting** is where you turn a pass's doors into walkable **books** — geometrically, by attribute (like precinct), or by drawing areas on the map. For a follow-up round, the optional **Target doors** panel narrows the cut to just the doors you're chasing, and **Exclude doors** removes the ones you want skipped — like doors that already took a yard sign (see [Passes](passes)). You **Accept** the books to publish them, then **Assign** each to canvassers. It's also where you add new doors as a supplemental book (**Add as new book** — runs in the background with a progress bar), move, merge, or split books, mark a house or a book restricted, and fix a pin that's sitting in the wrong spot.

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

## Marking several homes at once

A fence line, a gated cul-de-sac, a block the contractors closed off — forty homes shouldn't mean forty
popups, and marking the whole book would be too much. Click **Select doors** at the top-left of the map and
the map becomes a picker:

- **Drag a shape** around the homes you mean. Draw another one somewhere else and it adds to the first, so
  three streets take three drags.
- **Click a house** to add or remove just that one. **Click a building** and every unit on that pin goes in
  or out together.
- **Hold Option (Alt) while you drag** to take the doors inside that shape back out.
- **Hold Space** — or switch the toggle to **Pan** — to move the map without leaving the mode.
- **Esc** cancels a shape you're in the middle of drawing; press it again, or click **Done**, to leave. That
  clears the selection.

You can only pick homes the map is actually showing. Anything hidden by the **Layers** box, the book-status
chips or your filters can't be caught — if you can't see it, a shape drawn over it takes nothing. (With the
**Houses** layer off, nothing is selectable at all, and the bar tells you.) One action takes up to **1,000
doors**; if a shape would go over that, none of it is added and the bar says how many it would have been —
zoom in and take a smaller stretch.

**The bar along the bottom** counts what you've picked — how many **will be marked**, how many are
**already restricted**, how many were **completed this round**, how many **can't be marked** — with an **ⓘ**
that explains each number. On the map, each picked home gets a **blue** ring if it will be marked and a
**slate** ring if it will be skipped.

**It always asks before it writes.** Up to 25 doors you just confirm in the bar; above that you get the same
dialog as a whole book, including typing **restrict**. And if your crew already **reached** some of the homes
you picked, you're asked which to mark — **only the untouched ones** (the default, leaving every not-home and
refusal exactly as it is) or **every door not yet done** — the same choice a whole book gives you. The
numbers are locked in when the dialog opens, so nothing shifts while you're reading it.

Homes that can't be marked are simply never sent: one still in **Intake** (it isn't in a walk list yet, so no
round could own the mark), one you've held out of books with **Remove apartments**, and one flagged
do-not-contact. The bar counts them and names the reason.

**Unmark restricted…** works the same way (it asks in the same dialog, without the typing) and removes **desk** marks only — every one on the homes you
picked for this round, including marks made earlier or by someone else. Marks canvassers recorded at the door
are kept.

When it's done you get a line like *"Marked 842 of 1,284 doors restricted · 210 already restricted · 232
completed this round"*, and your selection stays put — the rings turn from blue to slate in front of you.
There's no undo link (unmarking would also strip marks that were already there), so **Unmark restricted…**
is right there in the bar if you need it. Marks land on the round selected in the **Pass** dropdown. The
[Map page](page-map) has the same mode; the phone marks one home at a time.

## Moving doors between books in bulk

The same **Select doors** picker also moves homes. Pick the doors — across any number of books, loose
doors included — and choose **Move to book…** in the bar. A dialog lists the round's books with their
door counts (searchable when the list is long); pick one, or pick **New book…** and name a brand-new
book made from exactly the doors you selected. The dialog says which books the doors are leaving before
you confirm, and both books' walk orders renumber themselves. Statuses and knock history always travel
with the door, so nothing about your counts changes.

A new book made **mid-round** — on a pass whose books are already accepted — comes out **live and
assignable right away**; during cutting it's a draft that gets accepted with the rest. And if a move
takes the **last** doors out of a book, the page asks whether to delete the now-empty book (that also
clears any leftover assignments on it) — it never deletes anything on its own; keep it and it stays in
the list with a zero-door badge.

**Moving whole books.** Select books in the list (or by clicking their shapes) and choose **Move doors
to…** on the panel. Everything those books hold moves into the target book you pick — the canvassers
assigned to them follow their doors, and the emptied books are removed — or into one **new** book that
combines them. It's the same machinery as **Merge**, with you choosing the surviving book.

## Fixing a pin from here

A pin in the wrong place usually shows itself on this map first — a dot sitting in the wrong book, or
miles from its street. You don't have to go to the Map page to fix it. **Click the house** and choose
**Move pin →** in its popup: the popups step aside, a blue marker appears on the dot, and a small card
tells you whose pin you're moving. Drag the marker to the right spot and click **Save location** (or
**Cancel**, or press **Esc**, to back out). That moves **one door**. For an apartment building, click the
building and choose **Move building pin →** — that moves **every unit at that pin together**, and the
card says how many. While a move is armed, clicks elsewhere on the map do nothing, so you can't select
a book by accident.

When it saves, the dot moves and the **book outline redraws around it** — the door's own book, and any
other book whose shape covered the new spot — so the house still sits inside its book's shape (below).
Nothing else changes: the door keeps its book and its place in the walk order, its status and every
count stay put, and the Map page, printed packets and the GPS audit pick the new spot up on their own.
Canvassers see it on their next sync. Reopen the popup and it reads *Pin corrected* with the date; a
looked-up pin that hasn't been fixed reads *Approximate location*.

Three things to know. Only **team leads and admins** can move a pin (see [Fixing a house pin](fix-pin-location)
for why). The button is greyed out while a cut is running — wait for it to finish. And a pin that was so
wrong the house sat in the wrong *area* usually wants two fixes: move the pin, then **Move door** to put
it in the right book — moving a pin never moves a door between books. On a very large round the outline
redraw is skipped (the pin is still fixed); ask your Doorline contact to run the outline repair.

## Every house sits inside its book's shape

Each book's shaded shape **contains all of that book's houses**, and shapes never overlap. So the shape a house sits in, the ring around its dot, and its popup all name the same book.

One thing you may notice: a small **pocket** — a little island of one book's color sitting inside another book's area. That's not a mistake. Books are balanced to be similar in size, so a book sometimes owns a house in the middle of another book's houses; the map draws a pocket of the owning book's color right around that house so you can tell whose it is at a glance.

For the full walkthrough, see [Cutting and recutting books](turf-and-books).
