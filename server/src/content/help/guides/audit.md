---
slug: audit
title: The GPS audit
audience: lead
kind: guide
order: 18
sourceDoc: AUDIT.md
summary: Catch questionable canvassing from the GPS trail every door leaves — flag types, the Audit page, and reviewing flags.
tags: audit, gps, quality, flags, review, canvassing
---

## What the GPS audit is for

Every time a canvasser marks a door, the app quietly records **where the phone was**. The audit reads that trail and flags the doors that look wrong — the bad canvassing raw knock counts would hide: a house marked from far away, doors logged too fast to have walked between, or a whole street entered from one parked spot.

## The five flags

- **Mock location** — the phone itself reported that the fix came from a **fake-GPS app**. This is the strongest fraud signal there is, and it's always high severity. The canvasser is never told it was detected — the flag quietly appears for you, so the evidence accumulates instead of tipping them off.
- **Far from house** — the phone was well away from the house pin. (A big distance from a *weak* signal reads as Weak GPS instead, so bad signal never looks like bad canvassing. And an honest correction — a canvasser fixing an earlier entry after walking away — shows as low severity, not a full flag; see below.)
- **Rapid succession** — two different doors logged only seconds apart, too fast to have walked between.
- **One spot** — different houses spread down the street, all logged from nearly the same point (a parked car). Many units logged at one apartment entrance is normal and does **not** trip this.
- **Weak / missing GPS** — the location fix was poor, absent, synced from offline, or **computed long before the door was recorded** (a stale, reheated location), so it can't be trusted.

The app also refuses to record a door **without** a location: a canvasser with location off, denied, or set to approximate is blocked at the tap with instructions to fix it. So "no GPS trail at all" isn't something you'll see — entries either carry a stamp or don't exist.

You don't have to go looking for mock-location flags: when one is waiting, a red **Mock GPS** alert appears on the campaign dashboard and a red count badge appears on **Audit** in the sidebar (and on the GPS-audit tiles and campaign cards in the mobile admin app). Click through and the Audit page opens already filtered to the open mock-location entries. The badges clear as you review.

Each flag also carries a **severity** — low, medium, or high — so the worst ones stand out.

## Where you review flags

Two places, same data. The **Audit page** (inside a campaign, next to Timeline and [Map](maps)) opens on **Today** with KPI cards, a per-canvasser table sorted worst-first, and one card per flagged door — who, the address, the time, and the reason (*205 ft from house*, *8 s after the previous door*). Filter by flag type, review status, walk list, or date. Or open the **map**, turn on **Show flagged entries**, and each flag becomes a colored dot with a line back to the house — the geography at a glance. Either way, click a flag to review it there.

## Reviewing a flag

Every flag starts **Open**. Mark it **Reviewed** (looked, it's fine), **Dismissed** (not a real problem), or **Confirmed issue** (worth following up). Add a note if you like — the app records who decided and when. You can always **reopen** a flag.

Reviewing records a decision — it never deletes the entry or changes any report numbers. What it clears is the **open** counts: badges drop as you review, and open mock-location flags also trigger a warning when you publish a [client report](client-reports).

> Tip: The little **(i)** next to the flag filters (on the Audit page, the map's GPS-audit section, and the flag panel) opens a plain-language key to all five flag types and their severities — including the four different things "Weak / missing GPS" can mean.

**Corrections look different on purpose.** When a canvasser changes their answer at a door they already visited — say they tapped Restricted by mistake, walked off, then fixed it to Not home — the newer entry is recorded from where they *now* stand, which can look far from the house. The app remembers the entry they replaced, so a same-day correction after a genuine at-the-door visit appears as a **low**-severity Far flag with a line like *Replaced "Restricted" recorded 4 min earlier from 20 ft away*. Review it like any flag — it usually means an honest fix, not a phantom knock. A door rewritten from far away without a real earlier visit keeps its full flag.

> Tip: The **flagged** count means *still open* — as you review, dismiss, or confirm flags, that number drops, so you can work a day's flags down to zero.

Admins, team leads (for the campaigns they manage), and super-admins can use the audit. See [Team lead vs. admin](team-lead-vs-admin) for who sees what.
