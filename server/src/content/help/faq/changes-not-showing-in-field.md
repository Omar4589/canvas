---
slug: changes-not-showing-in-field
title: Why doesn't the canvasser see the change I made?
audience: all
kind: faq
order: 32
sourceDoc: MAPS.md
summary: Pin, status, voter-detail and door-setting changes are live (~30s); book and assignment changes need a full refresh.
tags: refresh, sync, field, books, assignment, door settings, outcome buttons, add person
---

The field app has two refresh speeds, and which one applies depends on what you changed:

- **Live (within ~30 seconds):** a pin move, a door's status, a door dropping off because everyone there has voted — and a **voter-detail correction** (a fixed name, party, and so on), which reaches the field the same way. These patch onto the canvasser's map automatically. So do the campaign's **door settings** — an outcome button turned on or off, or a change to who can add a person at the door: the phone applies them on its own while the canvasser is on the map, and a canvasser who's on a door screen at that moment gets them once they're back on the map.
- **Only on a full refresh:** a door's **book** (moving, merging, splitting, or adding a supplemental book) or **who's assigned** a book. These wait until the canvasser taps **Refresh** (↻) on their map, reopens/switches the campaign, or restarts the app.

So if you reshuffle books or reassign people mid-shift, **tell them to tap Refresh** so the losing canvasser drops the door and the new one picks it up. Nothing is miscounted in the meantime — a door briefly visible in two places still bills once per pass.

**Door settings have two exceptions.** A phone with **no signal** keeps the buttons it already has until it's back online — and anything recorded offline in the meantime still syncs, because real door work is never thrown away. A phone on an **older version of the app** picks a settings change up only on a full refresh, and can't show a button its version doesn't have — such as **Not a target voter**, if your campaign has it turned on — until the app itself updates: by tapping **Restart** when the app says [a new version is ready](app-asks-to-restart), or by installing the store update when it says [an update is available](app-says-update-available).

See the maps guide, or ask your campaign manager.
