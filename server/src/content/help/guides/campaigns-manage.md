---
slug: campaigns-manage
title: Creating and managing campaigns
audience: lead
kind: guide
order: 10
sourceDoc: CAMPAIGNS.md
summary: How to create a campaign, work the Campaigns page, edit safely, and archive or delete.
tags: campaigns, create, edit, archive, delete, key dates
---

A campaign is the container for one canvassing project — its voters, walk lists, passes, surveys, and reports all live inside it.

## Create one

Open **Campaigns → New campaign**. A drawer asks for a name, a type (survey or lit drop), a state, and a timezone (which auto-fills from the state), plus optional **key dates**. You don't need a survey yet.

Once it's created, drill into the campaign and follow the **Setup progress** card on its dashboard — a live checklist that walks you from importing voters through building [walk lists](walk-lists), cutting [books](turf-and-books), assigning canvassers, and activating a [pass](passes). New here? See [Getting started as a lead](lead-getting-started).

## The Campaigns page

The Campaigns page opens on a summary strip — how many campaigns, how many active, total households and houses knocked — above the list. Toggle between **Cards** and **Table**, search by name or state, and sort by recent, name, households, knocked %, or setup progress. Finished campaigns tuck into an archived section at the bottom, and each card or row has a **⋮ menu** for View dashboard, Assignments, and (for admins) Edit, Archive, and Delete.

## Editing — what you can change, and when

- **Name and state** — always editable.
- **Timezone** — editable, but once there's field activity you'll see a warning: changing it re-buckets every past daily stat. Nothing is lost and all-time totals stay the same, but day-by-day numbers shift.
- **Type (survey ↔ lit drop)** — locks the moment canvassing starts. To run a different type, create a new campaign instead.
- **Key dates** — admins only. As a lead you can see them but not change them (see [Team lead vs admin](team-lead-vs-admin)).
- **Restricted doors on invoices** — admins only. Choose whether restricted (inaccessible) homes count toward this campaign's billable door totals, or leave it on *Use organization default*. Unlike Type, this is never locked — it only affects how doors are reported, so you can change it at any point in the campaign and change it back. See [Can I bill for restricted doors?](bill-restricted-doors).

## Key dates

An admin can set an Election Day, an early-voting window, and a short note. Election Day shows the actual date with a countdown beside it — "Election Day · Wed, Nov 4," then "in 12 days." The early-voting window always names **both** of its ends: "Opens Oct 20 · through Nov 1" before it starts, "Open now · Oct 20 – Nov 1" while it runs, "Ended Nov 1" after. Canvassers see all of this on their campaign picker **and** at the top of their book list once they're working, so the dates stay in front of the field team. See [Setting election dates](set-election-dates).

## Archive vs. delete

**Archive** is the normal "we're done" action — reversible, and it makes the campaign **read-only**: canvassers stop seeing it, and books, turf, the roster and house pins are all frozen. You can still open it and read everything, on the web or on your phone, and you can still [export](exports) it. Reactivate anytime — you'll be asked to confirm first, because billing starts again when you do (including the months it spent archived). **Delete** is permanent and only allowed before any canvassing; once knocks or surveys exist, it's disabled and you'll archive instead. Confirming a delete answers right away and the removal runs in the background — the campaign shows a **Deleting…** badge and drops off the list when it finishes (a **Retry delete** appears in its ⋮ menu if the removal is ever interrupted). More in [Archive vs. delete a campaign](archive-vs-delete-campaign).

Archiving also tidies your sidebar: the campaign switcher inside a campaign lists **active campaigns only**, so finished work stops crowding the list you use every day. Archived campaigns are always one click away in the archived section on **Campaigns** or **Overview** — open one and it reads normally, with the switcher still showing it so you can step back out.
