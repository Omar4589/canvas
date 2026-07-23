---
slug: fix-pin-location
title: Fixing a house pin
audience: lead
kind: guide
order: 20
sourceDoc: MAPS.md
summary: Move a mis-placed house pin to the right spot — who can do it, and what it does and doesn't change.
tags: pin, map, location, gps, pin correction, approximate location
---

Some pins are looked up from the address rather than read from your file, so they can land a house or
two off — especially in rural areas or on long roads. The web map draws a faint **amber ring** around
these and the door reads **"Approximate location."** Once someone moves it, the ring disappears and it
reads **"Pin corrected."**

## Who can move a pin

**Team leads and admins only.** A lead can move pins for the campaigns they manage; an admin can move
any. Canvassers can't — they still see the "Approximate location" badge, so if one tells you a pin is in
the wrong place, you're the person who fixes it.

That's deliberate. Moving a pin is a data change with an audit trail, and when anyone could do it, a
canvasser could record a door from somewhere they'd never been, collect a **"far from house"** GPS flag,
then drag the pin onto their own house to make the flag look innocent.

## Two ways to do it

- **On the web map** — click the door, choose **Move pin**, drag it to the right spot, and Save.
- **In the mobile app** — open the door through **Switch to canvass mode**, tap **Fix pin location →**,
  then either **Use my current location** (drops it where you're standing, and warns if your GPS is
  weak) or drag the pin on the mini-map. It saves in the background and works **offline** — the fix
  holds and uploads when you're back on signal, writing the spot you picked rather than wherever you
  happen to be at sync time.

If the address shares a pin with other units — an apartment building — you'll be asked whether to move
**just this unit** or the **whole building**.

## What it changes, and what it doesn't

A correction fixes **only where the dot sits**. It never re-cuts books, never changes the walk order,
never changes a door's status, and never moves a count. Canvassers pick up the corrected spot on their
next sync, and every move is saved with who made it and when.

Two things worth knowing:

- **It can clear a stale GPS flag.** A canvasser who walked to the real house while the pin was wrong
  gets flagged "far from house," and that flag used to stick forever, because the distance is measured
  once — when the door is recorded. Correcting the pin now drops such an entry to **low** severity and
  shows both distances. It only ever *lowers* a flag, and it won't help if the person who moved the pin
  is the same person who recorded the door. See [The GPS audit](audit).
- **A published report keeps the map it was frozen with.** Republish it to pick up corrections made
  afterwards.
