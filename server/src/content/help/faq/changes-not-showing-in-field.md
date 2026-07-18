---
slug: changes-not-showing-in-field
title: Why doesn't the canvasser see the change I made?
audience: all
kind: faq
order: 32
sourceDoc: MAPS.md
summary: Pin, status, and voter-detail changes are live (~30s); book and assignment changes need a full refresh.
tags: refresh, sync, field, books, assignment
---

The field app has two refresh speeds, and which one applies depends on what you changed:

- **Live (within ~30 seconds):** a pin move, a door's status, a door dropping off because everyone there has voted — and a **voter-detail correction** (a fixed name, party, and so on), which reaches the field the same way. These patch onto the canvasser's map automatically.
- **Only on a full refresh:** a door's **book** (moving, merging, splitting, or adding a supplemental book) or **who's assigned** a book. These wait until the canvasser pulls-to-refresh, reopens/switches the campaign, or restarts the app.

So if you reshuffle books or reassign people mid-shift, **tell them to pull-to-refresh** so the losing canvasser drops the door and the new one picks it up. Nothing is miscounted in the meantime — a door briefly visible in two places still bills once per pass.

See [Using the maps](maps).
