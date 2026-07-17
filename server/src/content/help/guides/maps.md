---
slug: maps
title: Using the maps
audience: lead
kind: guide
order: 19
sourceDoc: MAPS.md
summary: Read the admin and field maps, follow canvasser pings, and fix an off-spot pin.
tags: maps, pins, pings, gps, pin correction, live updates
---

There are two maps, and they draw the **same doors** from the **same data**. The **web admin map** is your desk view: every door in the campaign, plus where canvassers have been, with filters and a live feed. The **field map** is what a canvasser sees on their phone: just the doors in the books assigned to them.

## Reading the pins

Every house is a pin colored by its current status — gray (unknocked), blue (not home), green (surveyed), amber (refused), red (wrong address), purple (lit dropped), and slate (restricted). If two colors trip you up, see [Restricted vs. refused](restricted-vs-refused). Doors where everyone has already voted drop off the field map on their own.

## Canvasser pings and trails

Turn pings on and each dot marks **where a canvasser stood** when they logged a knock, with a faint line back to the house. Filter to a **single canvasser** and the map rings two of their doors — a **Start** ring on their first knock and a **Latest** ring on their most recent — so you can trace their day. To flag GPS that looks off, see [Audit](audit).

## Arriving pre-filtered from a drill

You don't always have to set the map's filters by hand. Drill into a survey answer — from the campaign Home or the [Survey Explorer](page-survey-explorer) — and **Open in Map** lands here with the same answer, canvasser, and date range already applied, so the pins are exactly the doors behind the number you were looking at. Each entry in those lists also has its own **Map** link that jumps straight to that one door. The same works on your phone: **View on map** from an answer's voter list pre-filters the mobile admin map.

## Fixing an off-spot pin

Some pins are looked up from the address, not read from your file, so they can land a house or two off. The web map draws a faint **amber ring** around these and the door reads *"Approximate location."* To fix one, drag the pin to the right spot and Save — the ring disappears and it reads *"Pin corrected."* Canvassers pick up the fix on their next sync, and moving a pin never re-cuts your books.

## What's live vs. what needs a refresh

Status changes and pin fixes flow in on their own — the web map about every 20 seconds, phones about every 30. But **moving a door to another book, merging or splitting books, or reassigning a canvasser** only appears after a full refresh. See [Changes not showing in the field](changes-not-showing-in-field).
