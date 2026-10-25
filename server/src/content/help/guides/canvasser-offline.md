---
slug: canvasser-offline
title: Canvassing offline
audience: canvasser
kind: guide
order: 34
sourceDoc: CANVASSER_APP.md
summary: Keep knocking with no signal — everything saves and syncs when you reconnect.
tags: canvasser, offline, sync, connection
---

Lost signal? Keep going. The app is built to work in dead zones.

Every door you record — statuses, surveys, pin fixes — is saved on your phone right away, and the app sends it up automatically the moment you're back online. You don't have to do anything special: being offline never loses a knock.

If you see a house recolor the instant you tap it but you're offline, that's normal — it's saved locally and will sync later.

## If you change your mind about a door

Change a door's answer and **the most recent one is what sticks** — even if an earlier answer for that same door was still waiting to sync and only goes up afterwards. The app sorts it out by when you actually tapped, not by the order things reach the server, so a late-syncing knock can't undo a correction you made after it.

One thing that **does** need to stay on, even offline: your phone's **location**. GPS comes from satellites, not cell signal — airplane mode or a dead zone won't stop it — but the app records a GPS stamp with every door, so if the Location toggle itself is off, recording is blocked until you turn it back on. Signal off, location on: that's the offline combo that works. One difference offline: the very first position fix after opening the app can take longer, because the phone can't download its usual satellite assistance data — give the blue dot a moment to settle before your first door ([Why is my blue dot across the street?](blue-dot-not-where-i-am)).

You can tell when work is still waiting to go up: the **Refresh** button (in the bottom-right controls on the map) shows a small **pending badge** with the number of recorded items (door results, surveys, pin fixes) that haven't synced yet. It clears on its own once you're back on signal, but you can tap **Refresh** any time to push everything up right away and pull the latest doors.

## If the app asks for your password

Nothing is wrong — for security, Doorline asks for your password again from time to time. A screen says **"Enter your password to keep going"**; type it and you're back where you were. It never interrupts a door: if it comes up while you're at one, the app lets you finish and asks once you're back on the map.

No signal to sign in? After the sign-in fails for lack of signal, tap **Later** and keep knocking. The map then shows **"Password needed"** with how many items are waiting — your team can't see them until you enter your password, so do it as soon as you have signal (tap the notice, or **Refresh**).

**Always sign back in as yourself**: anything saved on the phone goes up under whoever signs in next. And never delete the app while the pending badge shows a number — deleting it loses the work on it. More in [Doorline asked for my password again](signed-out-sign-in-again).

## What the offline notices mean

If you open the app with no signal, an **amber notice** may appear at the top of the map: *"Offline — showing houses as of…"*. That means you're seeing the copy of your houses saved on your phone, from the time shown. It's safe to keep knocking — your work records normally — and the notice disappears on its own once you're back online and the app catches up. If it reads *"Showing houses saved on this phone as of…"* instead, you have signal but the app needs your password again — see above.

If a refresh fails — say you tap **Refresh** in a dead zone — the houses you already have stay on the map, and an amber row says *"Couldn't refresh the houses: …"*. Tap **Try again** once you have signal. Your books screen shows the same row for your books.

A **red storage notice** ("Couldn't save map data to this phone") means your phone is running out of space, so the app can't keep your houses saved for offline use. Free up some storage — otherwise, next time you open the app in a dead zone you may see older houses than you expect.

A red notice saying **"Recording is paused for review. Call your team lead."** is something else: your recording is paused until someone on your team reviews your doors ([Why is my recording paused?](why-is-recording-paused)). Doors you saved before the pause still upload as usual, including any counted in the pending badge. The notice's **Check again** needs signal — in a dead zone it says *"Can't check right now — move to where you have signal and tap Check again."*

One more thing that happens quietly: if you tap a door button and pocket your phone before the app can get a GPS fix, the "couldn't get your location" message **waits until you unlock the phone** to appear. If you see it, that door did **not** record — tap the button again.

> Tip: Before heading into an area you know has poor coverage, open your book once while you still have signal so your doors are loaded. After that, you're good to knock offline.
