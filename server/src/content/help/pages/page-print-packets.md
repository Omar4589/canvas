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

**Campaign → Print Packets** makes paper walk packets — addresses, who lives there, and room to write — for volunteers who aren't using the app. It's open to whoever manages the campaign: org admins, and **team leads** on the campaigns they've been granted.

**Before anything else: nothing written on these sheets comes back into Doorline.** A book walked on paper keeps reading as **unknocked** in coverage, on the map, and in every report. That's not a bug you can work around; it's what paper is. [What a paper day costs you](paper-canvass-and-your-reports) spells it out.

## The three panes

**Left — what to print.** One dropdown picks what you're printing: a **round**, listed under the walk list it belongs to, or a **saved search**. Your campaign runs several walk lists at once and each has its own rounds, so the walk list's name sits above its rounds — "Pass 3" on its own wouldn't tell you which one. Rounds that aren't live are in the list too, with their status shown; printing a **draft** round is the normal way to have packets ready before a round goes live.

Underneath sit **that round's books**. Tick the ones you want, or use **All** and **Clear**. At the bottom, a running total shows how many packets, doors and sheets you've picked, and warns you before you go over the limit.

**Switching rounds clears your ticks.** That's deliberate: printing books from two rounds in one run would put volunteers on paper at doors your app canvassers are already knocking. For the same reason, if you're on a round that's **live** and somebody already holds one of its books in the app, a note appears above the list.

**Don't see a round you just cut?** Its books are still drafts. Go back to Turf Cutting and **Accept** them — only accepted books can be printed.

**Middle — two tabs.** **Packet** isn't a preview drawing of the PDF, it *is* the PDF, rebuilt about a quarter-second after you change anything. What you download is the file you're looking at, and **Open in a new tab** gives you a bigger view. **Map** shows where the books actually are — click a shape to add or remove it. It draws whichever round you picked in the dropdown, because rounds cover the same streets and stacking them would be unreadable.

A book keeps the **same colour** everywhere: on the Turf Cutting map, in this list, on the map here, and as the stripe across the top of its printed pages.

**Right — the design.** Every control shows what it costs: the page and sheet count under the button updates as you turn each knob.

## Pick a layout

**Survey packet** — the campaign's questions beside every door. Pick-one questions are pills you **circle**, pick-any questions are squares you **tick**, free-text questions are dashed lines you **write on**. Roughly 2 doors a page.

**Field list** — no questions at all. Address, residents, what happened, and lines to write on, with the notes sitting **beside** the residents rather than under them so more doors fit. Roughly 4 doors a page, so a 200-door book is about 26 double-sided sheets instead of 61. Use this when you just want the doors walked. It works even if the campaign has no survey.

If the campaign has no survey set up, the survey layout is unavailable and you'll get the field list.

## What the download looks like

One packet downloads as a single PDF. Several packets download **your way — pick next to the Download button**:

- **One PDF** (the default) — one file, one print job. Every packet starts on the front of a fresh sheet, so double-sided printing never runs two packets onto one piece of paper.
- **File per packet** — a folder (ZIP) with one PDF per packet, each named for its book, plus the hand-out sheet as its own file. Print or reprint any one packet without touching the rest, or hand each volunteer their own file.

Files are named book first — `book-33-yourcampaign-field-list-2026-08-07.pdf` — so a folder of packets sorts by the thing that differs.

## The other controls

- **Lines to write on** — 0 to 6. On a **survey packet** this is the knob that decides your page count: a door is never split across two sheets, so if the writing lines push a door past half a page you get one door per page instead of two. On a 207-door book that is 208 pages at three lines versus 105 at one. The page count under the button updates as you change it. Three is the default. On a **field list** the lines are nearly free — going from two to four adds about five pages across a whole 200-door book.
- **Doors per packet** — splits big books into several small packets at print time. Set it to 35 and a 150-door book prints as **"Book 33 · 1 of 4"** through **"4 of 4"**: each part a contiguous stretch of the book's walk order with its own cover, map, street list and page numbering, sized for one volunteer. Parts prefer to break where streets change when a change sits near the cut, and a book only slightly over your number stays whole — so part sizes vary a little by design, never past about a third over it. Saved searches split the same way. **Paper only:** the book in the app — its doors, colour, assignment and route — is untouched, and clearing the field puts you back to whole books. Blank is off, and it's remembered per campaign.
- **What happened boxes** — Not home, Refused, Wrong address, Surveyed, Restricted. The same five on both layouts.
- **Last round's result** — shows a small pill on doors that were already visited this round.
- **What to say** — your opening, closing and any option scripts, printed once at the top of the first door page rather than repeated beside every door. It shares that page with the doors, so it costs no extra paper.
- **Map on the cover** — a map of the book with the walk drawn over it: the route, a dot per door, and **A** and **B** on your first and last. The line shows the **order** of the walk, drawn door to door — it isn't directions along the streets. Needs a Mapbox key set up; without one the map is simply absent and everything else prints as normal.
- **Hand-out sheet** — a front page listing every packet with ruled Out/In cells, so you can sign packets out to volunteers on the table. Appears whenever the run makes more than one packet — several books, or one big book split into parts.
- **Skip apartments** — leaves out doors in multi-unit buildings. A locked lobby or a call box is a door a volunteer can't work, so a lot of campaigns drop them on a paper day. Off by default, and the number left out is shown on screen. Whether apartments are in the book at all is decided when you cut it; this just keeps them off the printout.
- **Phone numbers** — off by default. Phone numbers on paper can't be recalled.

## What's on each sheet

The cover opens with the Doorline mark and wordmark, then the race, then your organisation. The downloaded file is named for the campaign, the book, which kind of packet it is, and the day you printed it — `florida-hd54-randy-maggard-book-33-survey-packet-2026-08-07.pdf`, or `…-book-33-4-packets-survey-packet-…` when a book was split — so a Wednesday print and a Saturday print never look alike. Every page carries the campaign, your organisation, and the packet name (including its "· 2 of 4" when a book was split) — so a packet found later says what it is without anyone opening the app — plus a coloured stripe matching the book's colour on the Turf Cutting map, and a **Walked by / Date** line.

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

Over about 1,200 doors the page refuses and tells you the real number. It won't print part of the selection and stop, because a packet that quietly ran short would send nobody to the doors it dropped and nothing would ever flag it. Deselect a few books and print the rest separately — **Doors per packet** doesn't move this limit; it changes how doors divide into packets, not how many one print run may contain.

## Shortcuts in

- **Turf Cutting** → select a book → **Print this book on paper**
- **Saved Searches** → **Print packet** on any row

Related: [Printing packets for a paper canvass](printing-walk-packets) · [Cutting and recutting books](turf-and-books)
