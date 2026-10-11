---
slug: homes-in-the-ocean-or-on-one-dot
title: After an import, some homes are in the ocean, on one dot, or miles from their street — how do I fix them?
audience: lead
kind: faq
order: 79
sourceDoc: IMPORTS.md
summary: Voter files sometimes give homes 0,0, one shared spot, or the wrong town. Doorline catches each case at import, and Pin Fixes fixes what's left by group — before you cut books.
tags: pin, map, import, ocean, africa, 0,0, one dot, shared spot, placeholder, far from street, complex, pin fixes, look up by address, place along the street, set aside
---

Voter files make three kinds of map mistake, and Doorline now catches each one when the file is imported:

- **0,0 — "in the ocean off Africa."** Some vendors write 0,0 when they have no location. Doorline ignores
  it and looks the home up by its address. If nothing is found, the home waits at a **holding spot** in the
  middle of its ZIP, marked **"Couldn't be found by address"** — never in the ocean, never dropped.
- **Many homes on one dot.** The vendor stamped one coordinate on homes it couldn't place. Doorline looks
  each one up by its own address. When the lookup puts several of them on the same exact point, they're
  **a complex** — one place, and that's the right answer.
- **A pin miles from its street.** A home far from the other homes on its street (or in its ZIP) is looked up
  too; if the lookup agrees with the pin, the flag comes off.

The preview warns about all three before you confirm, and the line under the file afterwards says what
happened (*Map pins: 412 placed by address · 41 placed on the street (check them) · 212 in complexes · 60
without an exact spot…*).

**Fix what's left in [Pin Fixes](page-pin-fixes), before you cut books.** The cards at the top work a whole
group at once:

1. **Look up by address** on each card — for homes from a file imported before Doorline caught these, or
   after a busy pin check. Click it again any time; nothing is bought twice.
2. **Complexes** — click each one and **Looks right — it's a complex**, one click per complex.
3. **Start checking** the homes placed on the street (approximate pins): Enter if it looks right, or drag
   it onto the roof.
4. **Place along the street** for what remains: the map goes to satellite view, shows the house numbers
   of the street's other homes, and you click each roof — one click per home.
5. **Set aside** the homes nobody can place, like a dorm with no street address. They leave the list and
   every book cut until you bring them back.

Then cut books on [Turf Cutting](page-turf-cutting) with **Leave out N homes without a reliable map spot**
ticked (it's on by default), so nothing still unfixed lands in the wrong book. Fix those later and add them
with **Add as new book**.

You don't need to import the file again: **Look up by address** does the lookups, and **Place along the
street** or **Set aside** handles a home the lookup still can't find. (Importing the same file again is safe
too — it parks any home still at 0,0 at its ZIP's holding spot — but it isn't needed.)
