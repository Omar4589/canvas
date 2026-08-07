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

**Left — what to print.** Your books, grouped **walk list → round → book**, plus your saved searches. Your campaign runs several walk lists at once and each has its own rounds, so the walk list's name sits above its rounds — "Pass 3" on its own wouldn't tell you which one. **All** and **Clear** select a whole walk list or a single round. At the bottom, a running total shows how many packets, doors and sheets you've picked, and warns you before you go over the limit.

**Middle — two tabs.** **Packet** isn't a preview drawing of the PDF, it *is* the PDF, rebuilt about a quarter-second after you change anything. What you download is the file you're looking at, and **Open in a new tab** gives you a bigger view. **Map** shows where the books actually are — click a shape to add or remove it. Only one round is drawn at a time, because rounds cover the same streets and stacking them would be unreadable.

A book keeps the **same colour** everywhere: on the Turf Cutting map, in this list, on the map here, and as the stripe across the top of its printed pages.

**Right — the design.** Every control shows what it costs: the page and sheet count under the button updates as you turn each knob.

## Pick a layout

**Survey packet** — the campaign's questions beside every door. Pick-one questions are pills you **circle**, pick-any questions are squares you **tick**, free-text questions are dashed lines you **write on**. Roughly 2 doors a page.

**Field list** — no questions at all. Address, residents, what happened, and lines to write on, with the notes sitting **beside** the residents rather than under them so more doors fit. Roughly 4 doors a page, so a 200-door book is about 26 double-sided sheets instead of 61. Use this when you just want the doors walked. It works even if the campaign has no survey.

If the campaign has no survey set up, the survey layout is unavailable and you'll get the field list.

## The other controls

- **Lines to write on** — 0 to 6. Four is the default and is nearly free: going from two to four adds about five pages across a whole 200-door book.
- **What happened boxes** — Not home, Refused, Wrong address, Surveyed (or "Spoke with" on the field list), Restricted.
- **Last round's result** — shows a small pill on doors that were already visited this round.
- **What to say page** — one reference sheet per packet carrying your opening, closing, and any option scripts, instead of repeating them beside every door.
- **Map on the cover** — a map of the book with the walk drawn over it: the route, a dot per door, and **A** and **B** on your first and last. The line shows the **order** of the walk, drawn door to door — it isn't directions along the streets. Needs a Mapbox key set up; without one the map is simply absent and everything else prints as normal.
- **Hand-out sheet** — a front page listing every packet with ruled Out/In cells, so you can sign packets out to volunteers on the table. Appears when you're printing more than one book.
- **Skip apartments** — leaves out doors in multi-unit buildings. A locked lobby or a call box is a door a volunteer can't work, so a lot of campaigns drop them on a paper day. Off by default, and the number left out is shown on screen. Whether apartments are in the book at all is decided when you cut it; this just keeps them off the printout.
- **Phone numbers** — off by default. Phone numbers on paper can't be recalled.

## What's on each sheet

The cover opens with the Doorline mark and wordmark, then the race, then your organisation. Every page carries the campaign, your organisation, and the book name — so a packet found later says what it is without anyone opening the app — plus a coloured stripe matching the book's colour on the Turf Cutting map, and a **Walked by / Date** line.

Each door gets a numbered red circle (its place in the walk order), the address in large type, who lives there with party and age, the outcome boxes, and your writing lines. A **hollow** circle instead of a solid one means that door carried over from the previous page.

Each run of one street gets a **banded header** with the doors it covers — and if the route comes back to that street later, the band says **back later**, so the range never overpromises. Apartment units are grouped under their real street rather than appearing as one "street" per unit.

The cover states which order the packet uses. And if you see the **city flip back and forth** between doors — San Antonio, then Dade City, then back — that's the postal address label, not a sorting problem: ZIP boundaries cut through neighborhoods, and the route is built from map coordinates, so it stays local even when the city name doesn't.

**The doors are ordered street by street** — each street walked in one go, up one side and back down the other, with the streets in the order the book's route reaches them. The books themselves are cut as a shortest route, which suits the app because the phone draws that route on a map; on paper there's no map, so a route that cuts back and forth between two parallel streets is just confusing. The packet only regroups when it doesn't make the walk longer — on cul-de-sacs or a rural route it keeps the book's own order instead. The streets listed on the cover are alphabetical, so you can scan for a name.

Every page has a **Walked by** and **Date** line, not just the cover — books get torn in half and shared between two volunteers all the time, and each half should say who walked it.

The **cover** has a **Walked by** and **Date** line for whoever picks the packet up. No canvasser's name is ever printed — a packet goes to whoever takes it off the table, which is rarely who the app thinks holds the book, and a wrong pre-printed name can't be fixed with a pen. If you print several books at once, the hand-out sheet has a matching **Walked by** column so you can sign them out. Who currently holds a book *in the app* still shows in the picker on screen, so you can spot a book that someone is already walking on a phone.

## What never prints

- **Dates of birth.** An age prints instead.
- **Anyone who asked not to be contacted.** They're removed when the PDF is built, checked at that moment — not from whatever the book held when it was cut. If one person at a three-person door is flagged, the door still prints and that person doesn't, with **no mark showing anyone was removed**.

Doors also drop out if everyone there has already voted, the door was excluded from turf, or it's inactive. The cover doesn't account for any of that — it states the door count once and leaves it there. What was left out, and why, is on screen for you, not on the paper for a volunteer.

**Restricted doors do print** — "restricted" is what happened at a door, not an instruction to stay away.

## If it won't print

Over about 1,200 doors the page refuses and tells you the real number. It won't print part of the selection and stop, because a packet that quietly ran short would send nobody to the doors it dropped and nothing would ever flag it. Deselect a few books and print the rest separately.

## Shortcuts in

- **Turf Cutting** → select a book → **Print this book on paper**
- **Saved Searches** → **Print packet** on any row

Related: [Printing packets for a paper canvass](printing-walk-packets) · [Cutting and recutting books](turf-and-books)
