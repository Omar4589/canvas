---
slug: why-location-required
title: Why does Doorline need my location?
audience: canvasser
kind: faq
order: 40
sourceDoc: CANVASSER_APP.md
summary: Every recorded door carries a GPS stamp — recording is blocked when location is off, but offline canvassing still works.
tags: canvasser, location, gps, permission, blocked
---

Every door you record carries a GPS stamp of where you were standing. That stamp is how admins verify field work actually happened at the door — it's the backbone of trust in your numbers, and it protects **you** too: your recorded work is provable.

Because of that, **the app won't record a door without a location**. If you tap a door button and see a message like *"Location needed to canvass"* or *"Location is off"*, one of these is the cause:

- **Your phone's Location toggle is off** — turn it on in your phone's quick settings.
- **Doorline doesn't have location permission** — allow it when asked, or enable it for Doorline in Settings.
- **iPhone only: Precise Location is off** — Doorline needs your precise spot, not the approximate one. In Settings → Doorline → Location, turn **Precise Location** on.
- **No GPS signal right now** — deep inside a building, GPS can't get a fix. Step toward a window or outside and tap **Try again**.

The message includes a Settings shortcut and a **Try again** button. Nothing was recorded while blocked — fix location, then record the door again.

**Does this break offline canvassing? No.** GPS comes from satellites, not cell signal — airplane mode and dead zones don't stop it. Keep the Location toggle on and you can knock all day with zero bars; your work saves on the phone and syncs later. More in [Canvassing offline](canvasser-offline).
