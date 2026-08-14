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

Creating a campaign is an **admin** action — as a team lead you won't see the button; an admin creates the campaign and [grants it to you](team-lead-vs-admin), and from there it's yours to run.

Admins: open **Campaigns → New campaign**. A drawer asks for a name, a type (survey or lit drop), a state, and a timezone (which auto-fills from the state), plus optional **key dates**. You don't need a survey yet.

Once it's created, drill into the campaign and follow the **Setup progress** card on its dashboard — a live checklist that walks you from importing voters through building [walk lists](walk-lists), cutting [books](turf-and-books), assigning canvassers, and activating a [pass](passes). New here? See [Getting started as a lead](lead-getting-started).

## The Campaigns page

The Campaigns page opens on a summary strip — how many campaigns, how many active, total households and houses knocked — above the list. Toggle between **Cards** and **Table**, search by name or state, and sort by recent, name, households, knocked %, or setup progress. Finished campaigns tuck into an archived section at the bottom, and each card or row has a **⋮ menu** for View dashboard, Assignments, and (for admins) Edit, Archive, and Delete.

## Editing — what you can change, and when

The **Edit** drawer (in the ⋮ menu on Campaigns) is **admin-only**, like Archive and Delete. As a team lead the campaign setting you change yourself is its **survey** — attach or swap it from the campaign's Survey tab (see [surveys](surveys)); for the fields below, ask an admin.

- **Name and state** — always editable.
- **Timezone** — editable, but once there's field activity you'll see a warning: changing it re-buckets every past daily stat. Nothing is lost and all-time totals stay the same, but day-by-day numbers shift.
- **Type (survey ↔ lit drop)** — locks the moment canvassing starts. To run a different type, create a new campaign instead.
- **Key dates** — admins only. As a lead you can see them but not change them (see [Team lead vs admin](team-lead-vs-admin)).
- **Door goal + goal date** — admins **and leads.** The one exception to the line above: if you run a campaign, you set its target.
- **Restricted doors on invoices** — admins only. Choose whether restricted (inaccessible) homes count toward this campaign's billable door totals, or leave it on *Use organization default*. Unlike Type, this is never locked — it only affects how doors are reported, so you can change it at any point in the campaign and change it back. See [Can I bill for restricted doors?](bill-restricted-doors).

## Key dates

An admin can set an Election Day, an early-voting window, and a short note. Election Day shows the actual date with a countdown beside it — "Election Day · Wed, Nov 4," then "in 12 days." The early-voting window always names **both** of its ends: "Opens Oct 20 · through Nov 1" before it starts, "Open now · Oct 20 – Nov 1" while it runs, "Ended Nov 1" after. Canvassers see all of this on their campaign picker **and** at the top of their book list once they're working, so the dates stay in front of the field team. See [Setting election dates](set-election-dates).

## Door goal

Give a campaign a **door goal** — say 10,000 doors — and an optional **goal date**, and the campaign's Home page tells you whether you're going to make it. You'll see how many doors are done, how many are left, **how many a day and a week it takes** from here, what your crew is actually averaging, and a plain **Ahead / On track / Behind**. Leave the goal date blank and Election Day is used instead.

Both fields sit in the same create/edit drawer as the key dates, and unlike the dates, **a team lead can set them** on a campaign they run. The Campaigns list shows a small progress bar on every campaign so you can see which ones are falling behind without opening each. Canvassers never see any of it.

Three things that trip people up:

- **The goal card ignores the filters above it.** Change the date range, pick a walk list, filter by crew — the rest of the page moves, the goal doesn't. It's always the campaign's all-time total, and the card says so underneath.
- **Days off count.** "412 a day" divides the doors left by every remaining day on the calendar, including the ones nobody knocks. Your current pace is measured the same way, so the two numbers are fair to compare.
- **No verdict for the first few days.** You need about 5 days of canvassing before Ahead/Behind appears. Judging a campaign that started Tuesday would just be guessing, so we show you the target and stay quiet about the rest.

See [How many doors a day do we need?](how-many-doors-a-day).

## Archive vs. delete

**Archive** is the normal "we're done" action — reversible, and it makes the campaign **read-only**: canvassers stop seeing it, and books, turf, the roster and house pins are all frozen. You can still open it and read everything, on the web or on your phone, and you can still [export](exports) it. Reactivate anytime — you'll be asked to confirm first, because billing starts again when you do (including the months it spent archived). **Delete** is permanent and only allowed before any canvassing; once knocks or surveys exist, it's disabled and you'll archive instead. Confirming a delete answers right away and the removal runs in the background — the campaign shows a **Deleting…** badge and drops off the list when it finishes (a **Retry delete** appears in its ⋮ menu if the removal is ever interrupted). More in [Archive vs. delete a campaign](archive-vs-delete-campaign).

Archiving also tidies your sidebar: the campaign switcher inside a campaign lists **active campaigns only**, so finished work stops crowding the list you use every day. Archived campaigns are always one click away in the archived section on **Campaigns** or **Overview** — open one and it reads normally, with the switcher still showing it so you can step back out.
