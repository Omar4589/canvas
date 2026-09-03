---
slug: page-pin-fixes
title: The Pin Fixes page
audience: lead
kind: page
order: 118
sourceDoc: MAPS.md
summary: Work through every approximate house pin in one place — move it to the right building, or confirm it's already right.
tags: pin, map, location, approximate, pin fixes, geocode, confirm, page
---

Some pins are **looked up from the address** rather than read from your voter file, and a looked-up
pin is a best guess — it can land a house or two off, especially in rural areas and on long roads.
The maps mark these with a faint **amber ring**. The **Pin Fixes** page (sidebar → **Quality**) is
where you clean them up: it lists **every** approximate pin in the campaign — including ones the map
can't ring, like doors stacked inside an apartment building's icon — so nothing hides in a crowded
view. The sidebar item carries an amber count of pins waiting, and the page shows the same number.

## How to work the queue

Doors are **grouped by street**, because that's how you actually check them — one street at a time.
Pick a pin either way:

- **Click a pin on the map** and a **popup opens at the top-right of the map** with the address
  (and, for an apartment building, the list of its units), the actions, and **← →** arrows to step
  through the queue.
- **Click a row in the list** and the map flies there with the same actions right under the row.

Then decide:

- **The pin is in the wrong spot → Move pin.** Drag the blue marker onto the right building and
  **Save location** — the same move-pin flow as the Map and Turf Cutting pages, same audit trail.
  An apartment building moves **every unit at that pin together**.
- **The pin is actually right → Looks right — confirm.** The door leaves the list and the ring goes
  out everywhere, without pretending anyone moved anything. The door's detail then reads
  **"Location confirmed"** instead of "Approximate location," the confirmation is saved with who and
  when, and a later file re-import won't quietly move the pin you vouched for. Mis-clicked? The
  toast has an **Undo**. Confirming an apartment building confirms every approximate unit at the
  pin — a unit someone already hand-moved is left alone.

**After each fix the page moves you along on its own** — it flies to the next pin and opens its
popup, so a big backlog is one decision per house. The header keeps score: **"12 doors cleared this
session · 34 left"**, with a progress bar. And while the popup is open you can drive it entirely
from the keyboard: **Enter** confirms, **← →** step to the previous or next pin, **G** opens Google
Maps, **Esc** closes the popup.

Two tools make the checking fast:

- **Switch the map to Hybrid** (the basemap picker, top-left) — satellite imagery with street labels.
  Most pins can be placed on the right roof without leaving the page.
- **Google Maps ↗** opens the door's address in a Google Maps search in a new tab, for the ones
  imagery alone can't settle. It's exactly the address search you'd type yourself — nothing is sent
  anywhere until you open it (a click, or the **G** key).

## Who can use it

**Team leads and admins** — the same people who can move pins anywhere else. A lead works the
campaigns they manage. Canvassers still see the "Approximate location" badge in the field; if one
reports a bad pin, this page is where you fix it.

## Good to know

- **Fixing or confirming a pin never re-cuts books.** The door keeps its book, its walk order, and
  its status — only the dot (and the book's drawn outline around it) moves. Canvassers pick up
  corrected spots on their next sync.
- The general [Map page](page-map) keeps its amber rings as a passive signal — this page is where
  you actually clear them.
- An empty list is the goal: it means every pin in the campaign is exact, hand-corrected, or
  human-confirmed. New imports with street-level lookups will top the list back up.

More on moving pins — including from the phone and the Turf Cutting page — in
[Fixing a house pin](fix-pin-location).
