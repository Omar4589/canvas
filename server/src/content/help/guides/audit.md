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

Every time a canvasser marks a door, the app quietly records **where the phone was**. The audit reads that trail and flags the doors that look wrong — so you can spot bad canvassing that raw knock counts would hide: a house marked from far away, doors logged too fast to have walked between, or a whole street entered from one parked spot.

## The four flags

- **Far from house** — the phone was well away from the house pin. (A big distance caused by *weak* GPS is treated as Weak GPS instead, so bad signal never looks like bad canvassing.)
- **Rapid succession** — two different doors logged only seconds apart, too fast to have walked between them.
- **One spot** — different houses, actually spread down the street, all logged from nearly the same point (a parked car). Logging many units at one apartment entrance is normal and does **not** trip this.
- **Weak / missing GPS** — the location fix was poor, absent, or synced from offline, so the spot can't be trusted either way.

Each flag also carries a **severity** — low, medium, or high — so the worst ones stand out.

## Where you review flags

Two places, same data. The **Audit page** (inside a campaign, next to Timeline and [Map](maps)) opens on **Today** with KPI cards, a per-canvasser table sorted worst-first, and one card per flagged door — who, the address, the time, and the exact reason (*62 m from house*, *8 s after the previous door*). Filter by flag type, review status, walk list, or date, and use **View on map** to jump to any entry.

On the map itself, turn on **Show flagged entries** and each flag appears as a colored dot where it was recorded, with a line back to the house — so you can *see* the geography. Click a flag to review it there.

## Reviewing a flag

Every flag starts **Open**. Mark it **Reviewed** (looked, it's fine), **Dismissed** (not a real problem), or **Confirmed issue** (worth following up). Add a note if you like — the app records who decided and when, so nothing quietly disappears. You can always **reopen** a flag to set it back to Open.

> Tip: The **flagged** count means *still open*. As you review, dismiss, or confirm flags, that number drops — so you can work a day's flags down to zero.

Admins, team leads (for campaigns they manage), and super-admins can use the audit. See [Team lead vs. admin](team-lead-vs-admin) for who sees what.
