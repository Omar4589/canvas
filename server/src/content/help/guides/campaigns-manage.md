---
slug: campaigns-manage
title: Creating and managing campaigns
audience: lead
kind: guide
order: 10
sourceDoc: CAMPAIGNS.md
summary: How to create a campaign, work the Campaigns page, edit safely, and archive or delete.
tags: campaigns, create, edit, archive, delete, key dates, door outcomes
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
- **Door goal + goal date** — admins **and leads.** The one exception to the line above: if you run a campaign, you set its target. Every change is recorded with your name in the campaign's [History](#history--who-changed-what).
- **Name, survey, timezone** — admins and leads. As a lead you open the same edit drawer; the admin-only fields show but are greyed out.
- **Restricted doors on invoices** — admins only. Choose whether restricted (inaccessible) homes count toward this campaign's billable door totals, or leave it on *Use organization default*. Unlike Type, this is never locked — it only affects how doors are reported, so you can change it at any point in the campaign and change it back. See [Can I bill for restricted doors?](bill-restricted-doors).
- **Door outcomes** — admins **and leads**, from the campaign's **Door Outcomes** page (see below).

## Door outcomes — which buttons canvassers see

Every campaign starts with the full set of outcome buttons in the field app. On the campaign's **Door Outcomes** page (in the campaign's sidebar on the web; **Quick actions → Door outcomes** on your phone) you can turn individual ones off — say your campaign never wants **No soliciting** used.

- **You can turn off:** Wrong address, Refused, No soliciting, Restricted access. (A lit-drop campaign shows only the last two — the first two don't exist at its doors.)
- **Always on:** Not home and the goal outcome (Survey / Lit dropped). Without those, a walk can't be recorded.

Turning one off hides the button on canvassers' phones and blocks new recordings of it — even from a phone that hasn't refreshed yet, which instead gets a clear "turned off" message. A knock a canvasser recorded **while offline before the change** still syncs when they reconnect: a settings change never throws away work that already happened.

**Nothing about the past changes.** Doors already recorded keep their status and keep counting in every number, report, and export. Each flip is recorded in the campaign's [History](#history--who-changed-what) with your name — "Door outcomes: all on → Refused off."

## Key dates

An admin can set an Election Day, an early-voting window, and a short note. Election Day shows the actual date with a countdown beside it — "Election Day · Wed, Nov 4," then "in 12 days." The early-voting window always names **both** of its ends: "Opens Oct 20 · through Nov 1" before it starts, "Open now · Oct 20 – Nov 1" while it runs, "Ended Nov 1" after. Canvassers see all of this on their campaign picker **and** at the top of their book list once they're working, so the dates stay in front of the field team. See [Setting election dates](set-election-dates).

## Door goal

Give a campaign a **door goal** — say 10,000 doors — and an optional **goal date**, and the campaign's Home page does the arithmetic: how many doors are done, how many are left, and **how many a day it takes** from here. Leave the goal date blank and Election Day is used instead.

Both fields sit in the same create/edit drawer as the key dates, and unlike the dates, **a team lead can set them** on a campaign they run. The Campaigns list shows a small progress bar on every campaign so you can see which ones are falling behind without opening each. Canvassers never see any of it.

Three things that trip people up:

- **The goal line ignores the page's filters.** Change the date range, pick a walk list, filter by crew — the rest of the page moves, the goal doesn't. It's always the campaign's all-time total, which is why it sits up in the header with the dates instead of down among the filtered numbers.
- **Today doesn't count.** The daily target divides by the days left *after* today — by the time you're looking, today is already planned or underway. On Aug 14 with a goal date of Aug 18, that's 4 days, not 5.
- **Days off do count.** It's calendar days, so the ones nobody knocks are in there. If you canvass three days a week, the honest target for those days is roughly the number shown times seven over three.
- **It reports, it doesn't grade.** There's no Ahead/Behind badge and no predicted finish date — just where you are and what each remaining day has to carry.

See [How many doors a day do we need?](how-many-doors-a-day).

## History — who changed what

A door goal is a number someone promised a client, and a lead can change it. Every campaign has a **History** view recording who changed what and when: the goal and its date, the key dates and note, the billable-doors setting, the door-outcome toggles, archiving and reactivating, and the campaign's name, type and state. Open it from the campaign's **⋮ menu → History**, or from the **History** link on the door-goal line when a number looks off.

On your phone, it's **Quick actions → History** on the campaign screen (and a **History** row in the Door goal section when there's a goal).

It also shows **team reassignments** — the other way a number moves without anyone knocking a door. Changing someone's coordinator moves all of their past doors onto the new team, so "why did Bo's team jump by 3,907?" is answerable here.

The timezone and the attached survey aren't recorded — a timezone change already announces itself (every daily number shifts, and you're warned first), and the survey is visible on the campaign's Survey tab. As a lead you see the history of campaigns you run.

Three things in this app are called "audit," and they answer different questions: **History** is who changed the campaign's *settings*; the **Audit** page is GPS quality flags on individual knocks; the **Timeline** is who knocked what, when.

## Archive vs. delete

**Archive** is the normal "we're done" action — reversible, and it makes the campaign **read-only**: canvassers stop seeing it, and books, turf, the roster and house pins are all frozen. You can still open it and read everything, on the web or on your phone, and you can still [export](exports) it. Reactivate anytime — you'll be asked to confirm first, because billing starts again when you do (including the months it spent archived). **Delete** is permanent and only allowed before any canvassing; once knocks or surveys exist, it's disabled and you'll archive instead. Confirming a delete answers right away and the removal runs in the background — the campaign shows a **Deleting…** badge and drops off the list when it finishes (a **Retry delete** appears in its ⋮ menu if the removal is ever interrupted). More in [Archive vs. delete a campaign](archive-vs-delete-campaign).

Archiving also tidies your sidebar: the campaign switcher inside a campaign lists **active campaigns only**, so finished work stops crowding the list you use every day. Archived campaigns are always one click away in the archived section on **Campaigns** or **Overview** — open one and it reads normally, with the switcher still showing it so you can step back out.
