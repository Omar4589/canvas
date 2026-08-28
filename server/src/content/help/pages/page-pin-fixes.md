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

## How to work the list

Doors are **grouped by street**, because that's how you actually check them — one street at a time.
Click a row and the map flies to that pin. Then decide:

- **The pin is in the wrong spot → Move pin.** Drag the blue marker onto the right building and
  **Save location** — the same move-pin flow as the Map and Turf Cutting pages, same audit trail.
  An apartment row moves **every unit at that pin together**.
- **The pin is actually right → Looks right — confirm.** The door leaves the list and the ring goes
  out everywhere, without pretending anyone moved anything. The door's detail then reads
  **"Location confirmed"** instead of "Approximate location," the confirmation is saved with who and
  when, and a later file re-import won't quietly move the pin you vouched for. Mis-clicked? The
  toast has an **Undo**. Confirming an apartment row confirms every approximate unit at the pin — a
  unit someone already hand-moved is left alone.

Two tools make the checking fast:

- **Switch the map to Hybrid** (the basemap picker, top-left) — satellite imagery with street labels.
  Most pins can be placed on the right roof without leaving the page.
- **Google Maps ↗** opens the door's address in a Google Maps search in a new tab, for the ones
  imagery alone can't settle. It's exactly the address search you'd type yourself — nothing is sent
  anywhere until you click it.

## Who can use it

**Team leads and admins** — the same people who can move pins anywhere else. A lead works the
campaigns they manage. Canvassers still see the "Approximate location" badge in the field; if one
reports a bad pin, this page is where you fix it.

## Good to know

- **Fixing or confirming a pin never re-cuts books.** The door keeps its book, its walk order, and
  its status — only the dot (and the book's drawn outline around it) moves. Canvassers pick up
  corrected spots on their next sync.
- The general [Map page](page-map) keeps its amber rings as a passive signal — and its **Layers**
  panel has an **"Approximate location rings"** checkbox if a busy all-time view gets too noisy.
- An empty list is the goal: it means every pin in the campaign is exact, hand-corrected, or
  human-confirmed. New imports with street-level lookups will top the list back up.

More on moving pins — including from the phone and the Turf Cutting page — in
[Fixing a house pin](fix-pin-location).
