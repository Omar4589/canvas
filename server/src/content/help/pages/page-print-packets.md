---
slug: page-print-packets
title: The Print Packets page
audience: lead
kind: page
order: 106
sourceDoc: WALK_PACKETS.md
summary: Turn a book into a printed paper packet for volunteers who aren't using the app.
tags: print, packets, paper, pdf, volunteers, walk list, printable
---

**Campaign → Print Packets** makes paper walk packets — addresses, who lives there, and room to write — for volunteers who aren't using the app.

**Before anything else: nothing written on these sheets comes back into Doorline.** A book walked on paper keeps reading as **unknocked** in coverage, on the map, and in every report. That's not a bug you can work around; it's what paper is. [What a paper day costs you](paper-canvass-and-your-reports) spells it out.

## The three panes

**Left — what to print.** Your published books, grouped by round, plus your saved searches. Tick as many books as you want; each one becomes its own packet. **All** and **Clear** select a whole round at once.

**Middle — the packet.** This isn't a preview drawing of the PDF, it *is* the PDF, rebuilt about a quarter-second after you change anything. What you download is the file you're looking at. **Open in a new tab** gives you a bigger view.

**Right — the design.** Every control shows what it costs: the page and sheet count under the button updates as you turn each knob.

## Pick a layout

**Survey packet** — the campaign's questions beside every door. Pick-one questions are pills you **circle**, pick-any questions are squares you **tick**, free-text questions are dashed lines you **write on**. Roughly 2 doors a page.

**Field list** — no questions at all. Address, residents, what happened, and lines to write on. Roughly 4 doors a page, so a 200-door book is about 25 double-sided sheets instead of 67. Use this when you just want the doors walked. It works even if the campaign has no survey.

If the campaign has no survey set up, the survey layout is unavailable and you'll get the field list.

## The other controls

- **Lines to write on** — 0 to 6. Four is the default and is nearly free: going from two to four adds about five pages across a whole 200-door book.
- **What happened boxes** — Not home, Refused, Wrong address, Surveyed (or "Spoke with" on the field list), Restricted.
- **Last round's result** — shows a small pill on doors that were already visited this round.
- **What to say page** — one reference sheet per packet carrying your opening, closing, and any option scripts, instead of repeating them beside every door.
- **Hand-out sheet** — a front page listing every packet with ruled Out/In cells, so you can sign packets out to volunteers on the table. Appears when you're printing more than one book.
- **Phone numbers** — off by default. Phone numbers on paper can't be recalled.

## What's on each sheet

Every page carries the campaign, your organisation, the book name, and a **packet code** like `R2-B07` in a red box — so a packet found later says what it is without anyone opening the app. Under that is a coloured stripe matching the book's colour on the Turf Cutting map.

Each door gets a numbered red circle (its place in the walk order), the address in large type, who lives there with party and age, the outcome boxes, and your writing lines. A **hollow** circle instead of a solid one means that door carried over from the previous page.

## What never prints

- **Dates of birth.** An age prints instead.
- **Anyone who asked not to be contacted.** They're removed when the PDF is built, checked at that moment — not from whatever the book held when it was cut. If one person at a three-person door is flagged, the door still prints and that person doesn't, with **no mark showing anyone was removed**.

Doors also drop out if everyone there has already voted, the door was excluded from turf, or it's inactive. The cover tells you the total held back.

**Restricted doors do print** — "restricted" is what happened at a door, not an instruction to stay away.

## If it won't print

Over about 1,200 doors the page refuses and tells you the real number. It won't print part of the selection and stop, because a packet that quietly ran short would send nobody to the doors it dropped and nothing would ever flag it. Deselect a few books and print the rest separately.

## Shortcuts in

- **Turf Cutting** → select a book → **Print this book on paper**
- **Saved Searches** → **Print packet** on any row

Related: [Printing packets for a paper canvass](printing-walk-packets) · [Cutting and recutting books](turf-and-books)
