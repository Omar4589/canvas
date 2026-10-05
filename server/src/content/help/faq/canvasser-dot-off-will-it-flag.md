---
slug: canvasser-dot-off-will-it-flag
title: A canvasser's dot was across the street — will that flag them?
audience: lead
kind: faq
order: 78
sourceDoc: GPS_ACCURACY.md
summary: No — the audit subtracts the phone's own accuracy radius before judging distance, so normal porch drift never earns a Far flag by itself; here's how to read one when it does appear.
tags: lead, gps, audit, far from house, accuracy, blue dot, pin, approximate location, apartments
---

No, not by itself. Every recorded door carries the phone's own accuracy estimate (shown as **GPS ±N ft** on the entry), and the audit subtracts that radius from the distance to the house pin before judging — for every entry, and for the per-canvasser **Far knocks** number alike. Only what's left above about **250 ft** counts as Far (medium); above about **820 ft** is high. A dot across the street is 50 to 110 feet off, well inside that allowance. A stamp whose phone reported no usable estimate gets no allowance. On the web map, the flag and location panels judge the same way: they say **far** only on what's left after allowing for GPS accuracy, and show that remainder. The canvasser's side of the story is in [Why is my blue dot across the street?](blue-dot-not-where-i-am) — worth sending them.

What the accuracy number means: on Android it's the radius the phone is 68% sure about, so one honest stamp in three lands outside its own circle; iPhones report a radius without saying how sure they are. Under open sky phones read about ±16 ft; next to houses, under porch roofs and trees, tens of feet is normal. A fix worse than about **330 ft** also draws a **Weak GPS** flag (high above 820 ft), and Far still applies if what's left after subtracting the radius is over 250 ft. On the web map, zoom in and each recorded location shows a faint circle that size: a guide, not a boundary, so a house outside the circle isn't evidence on its own.

**When a Far flag does appear, check two things before asking the canvasser:**

- **The pin.** A door that reads **Approximate location** (the flag panel and the Audit card say *House pin is approximate*) was placed by looking up the address and often sits on the street in front of the lot. Move or confirm it from Pin Fixes — a correction by a lead or admin also downgrades older far flags that turn out to sit beside the corrected pin. See [Fixing a house pin](fix-pin-location).
- **The building.** Every unit of a complex shares one pin, so someone at the back building is legitimately far from it.

Then read the pattern, not the single flag: compare a canvasser's typical ± against the crew's on the same streets (everyone's number widens under porches). A run of high Far flags with tight accuracy numbers, doors logged seconds apart, or a whole street entered from one spot is a conversation. How each flag works is in [The GPS audit](audit).
