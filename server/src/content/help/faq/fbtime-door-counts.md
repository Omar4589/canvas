---
slug: fbtime-door-counts
title: Why can't I change a door count on FbTime — and where does it come from?
audience: admin
kind: faq
order: 63
sourceDoc: FBTIME_INTEGRATION.md
summary: When door counts to FbTime are on, Doorline decides the doors on FbTime's doors-per-hour page — where the number comes from, what happens to numbers typed there, "Doorline: none" days, the other doors box, and why a day can differ between the two apps.
tags: fbtime, door counts, doors per hour, locked, typed, other doors, doorline none, timeline, sync now, paper
---

This only applies if your organization sends door counts to FbTime. If you don't see a **Door counts to FbTime** card on the Integrations page, it isn't available to your organization yet.

**Because Doorline decides.** On a day Doorline reports, FbTime's doors-per-hour page shows Doorline's number, locked, for as long as your door-count key exists in FbTime. That's on purpose: the doors come from what your canvassers recorded, so the place to fix a wrong number is Doorline. Correct the door results there — on [Door Outcomes](page-door-outcomes), for example — and the next send carries the fix to FbTime.

## Where the number comes from

It's the **Doors** column of the canvasser table on a campaign's **Timeline**, for that person and that day — added up across all your campaigns if they worked more than one. Survey, Lit dropped, Not home, Wrong address, Refused, Not a target voter and No soliciting all count. **Restricted access** never counts, so a day with nothing but Restricted access marks is sent as **0**. Notes, and Restricted marks set from the desk, don't count and don't make a day count. A day the canvasser recorded nothing at a door isn't sent at all.

## The number someone typed there before

On a day Doorline reports, a number typed on FbTime — before door counts were turned on, or since — is filed away by FbTime, not shown or counted. It isn't lost: if you clear what Doorline sent, FbTime brings the typed numbers back on those days. You clear by choosing **No — the link was wrong** when unlinking someone, by ticking **Also clear the numbers Doorline sent** when turning door counts off, or with **Clear the numbers Doorline sent…** on the card once they're off.

## A day that says "Doorline: none — doors moved or removed"

Doorline reported doors on that day before and has none for it now: the doors moved to a later day (recorded again in the same round), were unknocked, or a round's knock history was cleared. **Don't type those doors in again** — they're already counted on the day they moved to, or they were removed on purpose.

## Doors Doorline can't know about

Doors done on paper after a phone died, or on another platform, go in FbTime's **other doors** box for that day. FbTime adds them to Doorline's number, and nothing Doorline sends or clears ever touches them.

## When a correction reaches FbTime — and when it doesn't

A corrected door result reaches FbTime within 15 minutes for the last 7 days, and overnight for anything up to 120 days old. **Sync now**, in the connection bar on the Integrations page, sends straight away. Corrections don't reach FbTime for:

- days more than 120 days old;
- people who are no longer linked;
- anything after door counts were turned off, stopped for good, disconnected, or switched to another FbTime organization.

Those days keep what Doorline last sent — locked while your door-count key exists, editable on FbTime once it's revoked — unless you clear them from Doorline.

## Why a day can look different in the two apps

- **A door recorded again moves to the later day.** Doorline keeps one result per canvasser per door per round — the latest. Forty doors marked *Not home* on Monday and recorded again on Thursday in the same round count on Thursday, and Monday's number drops. A callback in a new round leaves Monday alone.
- **Hours and doors can land on neighbouring days.** FbTime files a whole shift under the day it **started**, in the time zone where the person clocked in; Doorline files doors under the day in the **campaign's** time zone. A shift past midnight, or work in a time zone behind the campaign's, can put the hours on one day and the doors on the next.
- **A campaign's time zone was changed.** Its doors move to the matching dates — within 15 minutes for the last 7 days, overnight for older ones.

For everything else about door counts — turning them on, replacing the key, clearing, stopping for good — see [FbTime: measured hours and door counts](fbtime-hours).
