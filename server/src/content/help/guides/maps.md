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

## Filter to a canvasser to see just their work

Normally each house is colored by its status across the **whole campaign** — has *anyone* surveyed it, found nobody home, and so on. **Filter the map to a single canvasser** and the colors change to show **only what that person did**: green where *they* surveyed, blue where *they* got no answer, and gray for any door they never touched — even if a teammate worked it. It's the quickest way to see one canvasser's own results on the map. Clear the filter and the colors go back to the shared campaign status. (The pins stay put — only their color changes.)

## Scope to one walk list

Running more than one [walk list](walk-lists)? Once a campaign has two or more, both the web map and the mobile admin map add a **walk-list filter** — pick a list and the whole map follows: the doors, the pings, and the overlap rings all narrow to just that operation.

## Overlaps: doors worked by more than one canvasser

Turn on **Show overlaps** and the map rings the doors that **more than one canvasser knocked in the same pass** — an amber ring around each, with an **"N overlaps"** count up top. Tap one and its detail panel names the other canvassers who worked it. Once a pass has covered a door, nobody should knock it again until the next pass, so an overlap is a turf collision worth a look — usually two walk lists that ran into each other.

**It follows your dates, and still catches the cross-day case.** Say a door was knocked on the 5th and someone knocks it again on the 11th, in the same pass. Viewing the 11th, that door is flagged — the collision is found across the whole pass, then shown to you because one of its knocks happened on a day you're looking at. Tap **Review** next to the count for the list: each door, the round, and every canvasser who worked it with the date they did, so the earlier knock is named rather than left for you to hunt down. That's usually enough to message the crew: *someone is knocking doors that are already done — check your books.*

If a door was double-knocked entirely outside the dates you're viewing, it isn't hidden from you either — it's counted as **"+N outside your dates"** next to the total. Widen the range to bring those into the list.

(The Timeline's overlap line works differently: it only reconciles collisions where **both** knocks fall inside the range you picked, so it can miss a cross-day one — see [Understanding the numbers](metrics).) Nobody is ever billed twice for an overlap; this is purely to help you coach and coordinate. It's off by default.

## Arriving pre-filtered from a drill

You don't always have to set the map's filters by hand. Drill into a survey answer — from the campaign Home or the [Survey Explorer](page-survey-explorer) — and **Open in Map** lands here with the same answer, canvasser, and date range already applied, so the pins are exactly the doors behind the number you were looking at. Each entry in those lists also has its own **Map** link that jumps straight to that one door. The same works on your phone: **View on map** from an answer's voter list pre-filters the mobile admin map.

## Fixing an off-spot pin

Some pins are looked up from the address, not read from your file, so they can land a house or two off. The web map draws a faint **amber ring** around these and the door reads *"Approximate location."* To fix one, drag the pin to the right spot and Save — the ring disappears and it reads *"Pin corrected."* Canvassers pick up the fix on their next sync, and moving a pin never re-cuts your books. **Canvassers can't move pins themselves** — if one flags a bad pin to you, this is where you fix it. Full details in [Fixing a house pin](fix-pin-location).

## What's live vs. what needs a refresh

Status changes and pin fixes flow in on their own — the web map about every 20 seconds, phones about every 30. But **moving a door to another book, merging or splitting books, or reassigning a canvasser** only appears after a full refresh. See [Changes not showing in the field](changes-not-showing-in-field).
