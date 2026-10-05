---
slug: campaigns-manage
title: Creating and managing campaigns
audience: lead
kind: guide
order: 10
sourceDoc: CAMPAIGNS.md
summary: How to create a campaign, work the Campaigns page, edit safely, and archive or delete.
tags: campaigns, create, edit, archive, delete, key dates, door outcomes, not a target voter, app customization
---

A campaign is the container for one canvassing project — its voters, walk lists, passes, surveys, and reports all live inside it.

## Create one

Creating a campaign is an **admin** action — as a team lead you won't see the button; an admin creates the campaign and [grants it to you](team-lead-vs-admin), and from there it's yours to run.

Admins: open **Campaigns → New campaign**. A drawer asks for a name, a type (survey or lit drop), a state, and a timezone (which auto-fills from the state), plus optional **key dates**. You don't need a survey yet.

Once it's created, drill into the campaign and follow the **Setup progress** card on its dashboard — a live checklist that walks you from importing voters through building [walk lists](walk-lists), cutting [books](turf-and-books), assigning canvassers, and activating a [pass](passes). New here? See [Getting started as a lead](lead-getting-started).

## The Campaigns page

The Campaigns page opens on a summary strip — how many campaigns, how many active, total households and houses knocked — above the list. Toggle between **Cards** and **Table**, search by name or state, and sort by recent, name, households, knocked %, or setup progress. Finished campaigns tuck into an archived section at the bottom, and each card or row has a **⋮ menu** for View dashboard, Assignments, History and Edit, plus Archive and Delete for admins.

## Editing — what you can change, and when

The **Edit** drawer (in the ⋮ menu on Campaigns) is open to team leads as well as admins. As a lead you change a campaign's name, timezone and door goal there, and can swap its survey for another in your library (removing it is left to an admin); the admin-only fields show but are greyed out — for those, ask an admin. You can also attach or swap the survey from the campaign's Survey tab (see [surveys](surveys)).

- **Name and state** — always editable (the state by admins only).
- **Timezone** — editable, but once there's field activity you'll see a warning: changing it re-buckets every past daily stat. Nothing is lost and all-time totals stay the same, but day-by-day numbers shift.
- **Type (survey ↔ lit drop)** — locks the moment canvassing starts. To run a different type, create a new campaign instead.
- **Key dates** — admins only. As a lead you can see them but not change them (see [Team lead vs admin](team-lead-vs-admin)).
- **Door goal + goal date** — admins **and leads.** The one exception to the line above: if you run a campaign, you set its target. Every change is recorded with your name in the campaign's [History](#history--who-changed-what).
- **Name, survey, timezone** — admins and leads. As a lead you open the same edit drawer; the admin-only fields show but are greyed out.
- **Restricted doors on invoices** — admins only. Choose whether restricted (inaccessible) homes count toward this campaign's billable door totals, or leave it on *Use organization default*. Unlike Type, this is never locked — it only affects how doors are reported, so you can change it at any point in the campaign and change it back.
- **Door outcomes** — admins **and leads**, from the campaign's **App Customization** page (see below). The one exception is an outcome that starts off — today only **Not a target voter** — which only org admins can turn on or off.

## Door outcomes — which buttons canvassers see

Every campaign starts with the standard outcome buttons switched on in the field app — the one outcome that starts off is in the next section. On the campaign's **App Customization** page (in the sidebar's Setup group on the web; **Quick actions → App customization** on your phone) you can turn individual ones off — say your campaign never wants **No soliciting** used. The web page shows a live phone preview of the door screen beside the toggles — flip one and the button disappears from the preview, exactly as it will from your canvassers' phones.

- **You can turn off:** Wrong address, Refused, No soliciting, Restricted access. (A lit-drop campaign shows only the last two — the first two don't exist at its doors.)
- **Always on:** Not home and the goal outcome (Survey / Lit dropped). Without those, a walk can't be recorded.
- **Off until an org admin turns it on:** **Not a target voter** — survey campaigns only, and only once Doorline has made it available. See below.

Turning one off hides the button on canvassers' phones and blocks new recordings of it — even from a phone that hasn't picked up the change yet, which instead gets a clear "turned off" message. A phone on the current app picks up changes from this page within about 30 seconds while its map is on screen, with no refresh; a phone on an older app version gets them when it next reloads the campaign (tapping **Refresh** ↻ on the map, a restart, switching campaigns, or a new round). A door a canvasser recorded **while their phone was offline** still syncs when they reconnect — even one tapped after you made the change, because a phone with no signal keeps the buttons it already has until it's back online. A settings change never throws away real door work.

**Nothing about the past changes.** Doors already recorded keep their status and keep counting in every number, report, and export. Each flip is recorded in the campaign's [History](#history--who-changed-what) with your name — "Door outcomes: all on → Refused off."

## Off until you turn it on — Not a target voter

You may never see this section on **App Customization**: it appears only on **survey** campaigns, and only once Doorline has made the outcome available. **Not a target voter** is a door button for the moment a canvasser talks to someone who isn't one of the voters on the list for that address, and that person won't give their name. Without it there's no honest way to record that visit — **＋ Add person** needs a name, **Refused** hides that the person wasn't one of your voters, and **Not home** says nobody answered. It counts as a knock and as reaching a person (Contact %), never as a survey, so the connection rate reads exactly as it would have with Not home or Refused at that door. See [Understanding the numbers](metrics).

Nothing about it can be checked — no name is taken — so it works the opposite way from the switches above:

- **It starts off on every campaign**, existing and new.
- **Only org admins can turn it on or off.** As a team lead you see the section and whether it's on, but the switch is greyed out with the line *"Only org admins can turn this on or off."* Turning on an outcome nobody can verify is the organization's trust decision, so it stays with org admins — ask one.
- **When it's on, everyone on the campaign gets the button** — including anyone a team lead adds to the crew later. Turn it on only for crews you trust.
- **Turning it on asks first.** The confirmation spells out that it counts as a knock and as reaching a person, never as a survey; that an entry can't be verified; that each one is GPS-stamped and shows on that canvasser's row on Home and the Timeline; and that the change goes into History with your name. Turning it off doesn't ask — that's the safe direction.
- **History** records each switch, highlighted, with who and when: *Off-by-default outcomes: none → Not a target voter*, and back to *none* when it's switched off.

**Turning it off.** A phone that's online loses the button within about 30 seconds of being on the map, and a tap in the meantime gets a "turned off for this campaign" message instead of being recorded. A phone that's **offline** when it's switched off (no signal, or airplane mode) keeps the button until it reconnects, and what it records meanwhile syncs and counts, like any offline door result. An org admin can review those entries on the **Door Outcomes** page — filter by canvasser and date; entries recorded offline are marked **Offline** — and change any they don't accept, or Unknock them so they stop counting and billing. Everything already recorded keeps its status and keeps counting; nothing is converted automatically. (On a campaign that has never had it on, nothing gets through at all — not even from a phone's offline queue, since no phone could have shown the button there.)

**Paused by Doorline.** Doorline can withdraw the outcome everywhere at once if something goes wrong. A campaign that's still set on then reads *"Paused by Doorline — no phone shows this button right now."* Phones drop the button, new taps are refused, everything already recorded keeps counting, and the campaign keeps its setting — an org admin can still turn it off, but not back on until Doorline makes it available again. When Doorline releases it again, the button comes back on every campaign still set on, and Doorline tells org admins before it does.

## Door Outcomes — fixing what was recorded

Sometimes an entry is simply wrong — a canvasser hit **Not home** when someone actually answered — or you've retired an outcome and want its old entries folded into another one. The **Door Outcomes** page (in the sidebar's **Quality** group, next to Audit) does both. It's **org admins only**: leads decide what canvassers can record going forward, but changing what the record *says* sits one level up.

Filter by outcome, canvasser, walk list, round, date range — or, on a survey campaign, by a specific survey answer — tick the entries you want (one row to fix one door, or **Select all N matching** to fold a whole batch), pick what they should become, and review.

**The review step is the important part: it tells you what the change does to your numbers.**

- If the change can't move anything, it says so: *"No reported numbers change."* That's true for any mix of **Not home**, **Wrong address** and **No soliciting** — each is one knock and none means you reached a person.
- If it *can*, you see your campaign's real before-and-after — knocks, billable doors, contact rate, survey rate — with the changed figures in red. **Refused** — and, on a campaign that uses it, **Not a target voter** — moves your contact rate (someone answered) and **Restricted** moves billable doors (those can be invoiced). You can still make the change; you just can't make it by accident.
- **Lit dropped** entries can never be converted — a lit drop has no answers to move either way.
- **Surveyed** entries can be converted in both directions, but not as a relabel: you enter the answers going in, and removing them shows you exactly whose answers go. See below.

Each entry keeps its time, location, canvasser and round — only the label changes, and door colors follow on canvassers' next sync. Every change is listed with a **Revert** button that undoes it exactly (even a selection that spanned several outcomes), and both the change and the revert appear in the campaign's [History](#history--who-changed-what).

Two things you won't see there: doors an admin marked restricted from the desk — a whole book with **bulk restrict**, or a single home from its popup (desk marks, each with its own undo where it was made), and entries an earlier change already converted, until you revert that one.

The App Customization page keeps a small **Reclassification** shortcut for the common case right after you switch an outcome off.

## Recording survey answers after the fact

Sometimes the conversation really happened and the app has no record of it — a canvasser tapped **Not home** by mistake and only noticed back at the office, where redoing it would flag their GPS as far from the door. Or a whole week got recorded as **Refused** because that button was left on. On the same **Door Outcomes** page, select those entries and change them to **Surveyed**. Because a surveyed door has to own real answers, you enter them:

- **Enter answers** applies one answer set to every voter at every selected door — right for "that whole batch was really *Undecided*."
- **Door by door** walks you through the selection one address at a time, so each household gets its own answers — with a **Different answers for each person** option when the people at one door answered differently. You can stop part-way — the unfinished session is listed under **Survey answer changes** with a **Resume** button (and **Stop here** if you'd rather keep what you've done and close it).

You can leave questions blank — record only what you actually know.

Answers are recorded for **every voter at the address, except anyone marked do-not-contact and anyone who already answered that round.** A canvasser's real field answer is never replaced by one you type; the review step names everyone who'll be skipped and why.

Every answer you enter is **credited to the canvasser who knocked** — their knock, their time, their round and team — so their numbers reflect the work they did. The answers themselves are stamped **"Entered by ‹you› on ‹date›"** on the voter's record and marked in exports, so nobody mistakes a desk entry for a doorstep conversation. They count in your contact and survey rates just like any other answer.

## Removing survey answers (cleanup)

The reverse works too, and it's what you want when a canvasser's surveys turn out to be fake: select the surveyed entries and change them to **Not home** so the doors go back into play. The review step lists **exactly whose answers will be removed, by name**, and the answers are **kept, not destroyed** — they stay on each voter's record and can be restored.

Only that entry's own canvasser is affected. If someone else genuinely surveyed the same door in the same round, their answers are untouched.

Both directions are undoable in one click — a door-by-door session undoes as a single unit — and a large batch runs in the background with a progress bar.

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

A door goal is a number someone promised a client, and a lead can change it. Every campaign has a **History** view recording who changed what and when: the goal and its date, the key dates and note, the billable-doors setting, what canvassers can record at the door — the door-outcome toggles, an off-by-default outcome switched on or off, and who may add people at the door — archiving and reactivating, and the campaign's name, type and state. Open it from the campaign's **⋮ menu → History**, or from the **History** link on the door-goal line when a number looks off.

On your phone, it's **Quick actions → History** on the campaign screen (and a **History** row in the Door goal section when there's a goal).

It also shows **team reassignments** — the other way a number moves without anyone knocking a door. Changing someone's coordinator moves all of their past doors onto the new team, so "why did Bo's team jump by 3,907?" is answerable here.

The timezone and the attached survey aren't recorded — a timezone change already announces itself (every daily number shifts, and you're warned first), and the survey is visible on the campaign's Survey tab. As a lead you see the history of campaigns you run.

Three things in this app are called "audit," and they answer different questions: **History** is who changed the campaign's *settings*; the **Audit** page is GPS quality flags on individual knocks; the **Timeline** is who knocked what, when.

## Archive vs. delete

**Archive** is the normal "we're done" action — reversible, and it makes the campaign **read-only**: canvassers stop seeing it, and books, turf, the roster and house pins are all frozen. You can still open it and read everything, on the web or on your phone, and you can still [export](exports) it. Reactivate anytime — you'll be asked to confirm first, because billing starts again when you do (including the months it spent archived). **Delete** is permanent and only allowed before any canvassing; once knocks or surveys exist, it's disabled and you'll archive instead. Confirming a delete answers right away and the removal runs in the background — the campaign shows a **Deleting…** badge and drops off the list when it finishes (a **Retry delete** appears in its ⋮ menu if the removal is ever interrupted). More in [Archive vs. delete a campaign](archive-vs-delete-campaign).

Archiving also tidies your sidebar: the campaign switcher inside a campaign lists **active campaigns only**, so finished work stops crowding the list you use every day. Archived campaigns are always one click away in the archived section on **Campaigns** or **Overview** — open one and it reads normally, with the switcher still showing it so you can step back out.
