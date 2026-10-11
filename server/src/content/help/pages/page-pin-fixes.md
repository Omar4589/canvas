---
slug: page-pin-fixes
title: The Pin Fixes page
audience: lead
kind: page
order: 118
sourceDoc: MAPS.md
summary: Fix every house pin that needs a check — by cause, a whole group at a time, or one house at a time.
tags: pin, map, location, approximate, pin fixes, geocode, confirm, no exact map spot, shared spot, complex, set aside, look up by address, place along the street, page
---

The **Pin Fixes** page (sidebar → **Quality**) lists every house pin in the campaign that needs a
person to look at it:

- **Approximate pins.** Some pins are **looked up from the address** rather than read from your voter
  file. A looked-up pin can land a house or two off, especially on long roads. The maps mark these with
  a faint **amber ring**.
- **Homes with no exact map spot.** The pin isn't the home: the file gave many homes **one** spot, the
  pin sits **far from the rest of its street**, or the address lookup **couldn't find** the home, so it
  waits at a holding spot in its ZIP.
- **Condo complexes.** Several homes on one spot that really are one place. They need only a quick
  look, once per complex.

The header reads **"N doors to review · M complexes"**, and the sidebar item's amber badge counts the
same doors plus one per complex.

## Fix together — the cards at the top

Above the list, one card per cause shows how many homes it holds, its busiest streets, and the buttons
that fix the whole group at once:

- **Share one spot with other addresses**, **Pinned far from their street** and **Couldn't be found by
  address** each have **Look up by address**. It runs the same address lookup an import runs, on just
  that group — useful for homes from an older import, or after an import's pin check was busy. The
  button reads **Looking up…** while it works, then a note says what happened: *"Map pins: 231 placed
  by address · 19 placed on the street (check them) · 3 without an exact spot."* Click it again any time;
  an address already looked up is answered for free and nothing placed is undone.
- **Place along the street** — click each roof instead of dragging (below).
- **Set aside…** — for homes nobody can place (below).
- **Complexes** — one row per complex, like *"Rowayton Woods Dr — 46 homes"*. Click it for **Looks right
  — it's a complex**, which vouches every home there in one click (with **Undo**), **Spread on the map**,
  which opens Place along the street for its addresses if you want each unit on its own building, and
  **Google Maps ↗**.
- **Placed on the street, not the house** — the approximate pins. **Start checking** narrows the list to
  them and opens the first: press **Enter** if it looks right, or drag it onto the roof. The page moves to
  the next one each time and ends with **"All checked."**
- **Show homes ▾** on any card narrows the list below to that card's homes. **Show all** brings everything
  back.

## Place along the street — click, not drag

The map switches to satellite view (**Hybrid**), flies to the first home, and labels the house numbers of
the street's homes that are already placed, so you can see which way the numbers run and which side is
odd or even. The list becomes a rail: *"Placing · Foxboro Dr · 3 of 42 — Click the roof of 1002 Foxboro
Dr."*

**Click the roof.** The pin is saved and the next home lights up. One click per home.

- A click on the home's old spot moves nothing — you'll see *"Nothing moved — click the house itself."*
- **Skip** leaves a home for later. **Back** goes to the previous home, so a wrong click is fixed by
  clicking its right roof.
- A row with several units of one address places all of them with one click.
- **Exit**, or **Esc**, leaves and puts your map style back.

Every click is the same pin move as a drag, with the same history and the same book-outline redraw.

## Set aside — for homes nobody can place

*"Fairfield University No Know, 00000"* isn't going to get a pin. **Set aside** asks once — *"Set aside 13
homes? They leave the queue and every book cut until brought back."* — and takes them out of this list and
out of every book cut. They stay on the map, listed under **Set aside (N)** at the bottom of the cards, each
with **Bring back**. Moving a set-aside home's pin, or confirming it, brings it back on its own.

## One house at a time

Below the cards, doors are **grouped by street**. The units of one apartment building share a row;
separate homes always get a row each. Pick a pin either way:

- **Click a pin on the map** and a **popup opens at the top-right of the map** with the address, the
  actions, and **← →** arrows to step through the list. If one spot holds several homes, the first one
  opens; click the spot again for the next.
- **Click a row in the list** and the map flies there with the same actions under the row.

Then decide:

- **The pin is in the wrong spot → Move pin.** Drag the blue marker onto the right building and **Save
  location**. An apartment building moves **every unit of that address together**. On a home with no exact
  map spot, **Save** stays off until you've dragged the pin clearly off its spot.
- **The pin is right → Looks right — confirm.** The door leaves the list and the ring goes out, without
  pretending anyone moved anything. The door then reads **"Location confirmed,"** and a later re-import
  won't quietly move it. The note has an **Undo**.
- **A home with no exact map spot really is there → Looks right — the home is here.** It asks once first.
  A home waiting at a holding spot has no Looks right: that spot is not the home, so place it or set it
  aside.
- **Set aside** is offered on any home with no exact map spot.

If someone else moved the pin since you opened the page, you'll see **"This pin changed since the page
loaded — reloading."** and the list refreshes.

**After each fix the page moves you along on its own** to the next pin. The header keeps score: **"12 doors
cleared this session · 34 left."** While the popup is open: **Enter** confirms, **← →** step, **G** opens
Google Maps, **Esc** closes. On a home with no exact map spot, and on a complex, **Enter does nothing** —
those always take the button.

Two tools make checking fast: **switch the map to Hybrid** (top-left) for satellite imagery, and
**Google Maps ↗** to search the address in a new tab — nothing is sent anywhere until you open it.

## Who can use it

**Team leads and admins** — the same people who can move pins anywhere else. A lead works the campaigns
they manage. Canvassers see the badges in the field; if one reports a bad pin, this page is where you fix
it.

## Good to know

- **Fixing or confirming a pin never re-cuts books.** The door keeps its book, walk order and status —
  only the dot (and the book's outline around it) moves. Canvassers pick up corrected spots on their next
  sync.
- **Before you cut books,** Turf Cutting can leave homes without a reliable spot out of the cut — see
  [Turf Cutting](page-turf-cutting).
- An empty list is the goal. New imports can top it back up.

More on moving pins — from the phone and the Turf Cutting page too — in [Fixing a house pin](fix-pin-location).
