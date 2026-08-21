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

Every house is a pin colored by its current status — gray (unknocked), blue (not home), green (surveyed), amber (refused), red (wrong address), purple (lit dropped), pink (no soliciting), and slate (restricted). If two colors trip you up, see [Restricted vs. refused](restricted-vs-refused). Doors where everyone has already voted drop off the field map on their own.

## What the count up top is counting

The number under the **Map** title reads like **"3,513 doors match · of 10,482 in campaign"**. Three things to know:

- **"3,513 doors match"** is how many doors match your filters across the **whole campaign** — not just the part of the map on your screen. Pan or zoom and it stays put.
- **"of 10,482 in campaign"** is every door the campaign has on the map, regardless of filters — apartments included, and the doors you excluded from books and the do-not-knock doors included too (the **ⓘ** breaks those two out). Pick a walk list and it becomes that walk list's doors ("of 4,200 in North").
- On **Today** — the default — "match" means doors with a knock or survey **today**, so the first number starts small and grows through the day. Pick **All time** to see every door.

When your screen holds fewer than match — you're zoomed in, or you've hidden excluded doors — a second figure, **"N in view"**, says so. A very large pull (over 50,000 doors) gets a warning that the map is capped; zoom in to see every door in an area. The **status chips** in the sidebar carry the same campaign-wide count for each status (under your other filters), so you can see how many doors are Surveyed or Unknocked without clicking. The **survey-answer** pills count **responses**, not doors — a house with three voters can carry three.

## Apartment buildings: one marker, many doors

Every apartment unit is its own door in Doorline. But address files put every unit of a building at the **same spot on the map**, so if each one got its own pin they'd land on top of each other — you'd see one house, click it, and get one of the units with no hint that dozens more were underneath.

So wherever **two or more doors share a spot**, the map draws a **building icon** instead, with a **"N doors"** label once you zoom in close enough to read it. Its color is a summary of the doors inside: gray if none are worked, amber if some are, green when they all are.

**Click the building to see every door in it** — each with its status and when it was last visited. Pick one to open it like any other door, then use **"← Back to all N doors at this pin"** to return to the list. If you reach one of those doors another way, like address search, the same Back bar is there, so a door inside a big building always tells you it has neighbors.

Up top, next to the door count, you'll see how many buildings there are and how many doors are folded into them — for example **39 buildings · 485 stacked doors**. That pill is about what's drawn on screen right now. It's the honest answer to "why don't I see a pin for every door?"

Two things this is *not*:

- **It isn't clustering.** The building sits at the doors' real location, never merges with the building next door, and never breaks apart as you zoom in.
- **It isn't always a real building.** Open one and check the addresses: a real building is one street address with many units. If the list shows **different addresses on one dot** — different streets, or different house numbers along one road —, your voter file stamped a placeholder coordinate on addresses it couldn't place — the doors are real, the dot is wrong, and the panel says so with an amber note. Ask your Doorline contact to run the pin repair; those doors are usually worth it, because [turf cutting](page-turf-cutting)'s Remove apartments will otherwise exclude them from books as if they were a tower.
- **It isn't the same as excluding apartments when you cut turf.** [Turf cutting](page-turf-cutting) has a **Remove apartments (N+ units)** option that keeps big buildings out of your **books**. Those doors still exist and still show on the map — the map shows what you *have*, not what you cut. See the next section.

## Doors you left out of your books

If you cut turf with **Remove apartments**, those doors don't disappear. They're still on the map, because this map is the record of every door you have and every knock that happened at one — an excluded door can still be flagged, double-knocked, or asked to be left alone, and you'd want to see all of that.

So the map names them instead of hiding them. In the **Layers** panel you'll see a count — "Doors excluded from books · 485" — and three choices:

- **Show** (the default) — they look like any other door.
- **Dim** — they fade back, so the doors your canvassers actually have stand out without the rest vanishing.
- **Hide** — they come off the map entirely. This only changes *your* view; nothing is deleted and no one else is affected.

Open one and its panel carries a **Not in books** badge. Excluding is campaign-wide — an excluded door isn't cut into any book, sent to any phone, or printed on any packet, in this campaign, whichever walk list happens to own it. To put them back, use **Include apartments** on Turf Cutting for the walk list that owns the door.

Two things worth knowing before you go looking for a number to match:

- **The Layers count is labeled "in view"** — the excluded doors currently on your screen (so you can un-hide what you hid). The campaign-wide figure under your filters sits right beneath it. Neither is the Turf Cutting page's number, which counts one walk list's cut — a different thing.
- **A door excluded after a cut is still listed in that book.** Excluding it stops it being *served* — it won't reach a phone or a packet — but the book that was already cut still has its name in it. Re-cut the pass if you want the book itself to change.

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

You don't always have to set the map's filters by hand. Drill into a survey answer — from the campaign Home or the [Survey Explorer](page-survey-explorer) — and the Explorer's own map shows exactly the doors behind the number you were looking at — click a pin there for the door's details without leaving the page. Each entry in those lists also has its own **Map** link that jumps straight to that one door on this page. The same works on your phone: **View on map** from an answer's voter list pre-filters the mobile admin map.

## Fixing an off-spot pin

Some pins are looked up from the address, not read from your file, so they can land a house or two off. The web map draws a faint **amber ring** around these and the door reads *"Approximate location."* To fix one, drag the pin to the right spot and Save — the ring disappears and it reads *"Pin corrected."* Canvassers pick up the fix on their next sync, and moving a pin never re-cuts your books. **Canvassers can't move pins themselves** — if one flags a bad pin to you, this is where you fix it. Full details in [Fixing a house pin](fix-pin-location).

## What's live vs. what needs a refresh

Status changes and pin fixes flow in on their own — the web map about every 20 seconds, phones about every 30. But **moving a door to another book, merging or splitting books, or reassigning a canvasser** only appears after a full refresh. See [Changes not showing in the field](changes-not-showing-in-field).
