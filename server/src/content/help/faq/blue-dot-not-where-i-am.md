---
slug: blue-dot-not-where-i-am
title: Why is my blue dot across the street from where I'm standing?
audience: canvasser
kind: faq
order: 77
sourceDoc: GPS_ACCURACY.md
summary: Phones are only sure of their position to within a radius, and a porch is the worst spot on the block — the dot can drift a few yards while your recorded doors stay fine.
tags: canvasser, gps, blue dot, location, accuracy, map, across the street, porch, precise location, battery saver
---

Because a phone never knows exactly where it is. It knows a point and a radius it's only about two-thirds sure of. Under open sky that radius is about 16 feet. Standing under a porch roof against a house wall, the phone sees half the sky and hears satellite signals bouncing off the house, so the radius widens to tens of feet and the guess gets pushed away from the wall — usually toward the street. From a porch the far curb is only 50 to 70 feet away, so a reading that's 40 or 50 feet off lands across the street some of the time. Google Maps and Apple Maps read the exact same position from the same phone; they just draw a light-blue circle around their dot when the phone is unsure, and ours doesn't yet.

**The usual reasons, most common first**

- **You're under a roof or against a wall.** The dot drifts toward the open side while you stand there and recovers within seconds of stepping off the porch.
- **You just unlocked the phone.** The map first shows where the phone last knew it was (the previous door, the sidewalk), then jumps to the new reading a few seconds later. Give it a moment.
- **You just opened the app.** The first readings can be rough guesses from Wi-Fi or cell towers; they settle over the first half-minute, longer with no data connection.
- **The phone is leaning on Wi-Fi.** With weak satellite signal it falls back to the recorded positions of nearby routers, which are often placed on the street itself, so the dot can hop toward the house across the street and back.
- **A setting is dragging it down.** Android: make sure **Google Location Accuracy** (sometimes called Improve Location Accuracy) is on, Wi-Fi scanning is on, and Battery Saver is off — on some phones it switches location off while the screen is off, so every door starts cold. iPhone: keep **Precise Location** on for Doorline (with it off the app won't record a door at all — see [Why does Doorline need my location?](why-location-required)).
- **The house marker is the thing that's off.** Markers placed by looking up an address often sit on the street in front of the lot, and every unit of an apartment complex shares one marker. If the dot is on you and the marker is across the street, the marker is wrong — knock the real door and tell your lead so they can move it. See [Your field map](canvasser-map).
- **Satellite or Hybrid view.** Aerial photos can sit a few yards off the map, so a correct dot can look like it's on the road. The dot is also always the same size on screen, so the same few yards look worse the further you zoom in.

Fake-GPS apps are not on this list: they move the dot and the recorded knock together.

**Does it affect my recorded doors? No.** The dot is for navigating. When you tap a door the app takes its own reading from the phone at that moment, records it together with the phone's own accuracy number, and the audit subtracts that number before judging anything. A door is only called "far from house" when what's left is more than about 250 feet, and a dot across the street is 50 to 110 feet off. Being on the porch cannot earn you a flag by itself.

**If the dot looks wrong:** step into the open for a few seconds — it's the phone that needs sky, not the app — and judge where you are by the house marker, not the rooftop picture. Need to find the house itself? Use [Directions](directions-to-a-house). And it all works the same offline: GPS comes from satellites, not signal ([Canvassing offline](canvasser-offline)).
