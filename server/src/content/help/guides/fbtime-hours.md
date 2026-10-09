---
slug: fbtime-hours
title: FbTime: measured hours and door counts
audience: admin
kind: guide
order: 27
sourceDoc: FBTIME_INTEGRATION.md
summary: Connect FbTime so doors-per-hour divides by real clock time instead of an estimate, map canvassers between the two apps, and — where it's available — send each canvasser's doors per day back to FbTime.
tags: fbtime, hours, doors per hour, integration, time tracking, measured, estimated, door counts, unlink, replace key, sync now, kept account
---

If your canvassers clock in and out with **FbTime**, you can connect it to Doorline so
doors-per-hour divides by the hours they were actually on the clock — instead of the estimate
Doorline otherwise makes from each day's first knock to its last.

This is optional. If your organization doesn't track time (many volunteer efforts don't), nothing
changes for you and everything keeps working exactly as before.

Where it's available, the connection can also run the other way: Doorline can fill in FbTime's own doors-per-hour page with each canvasser's doors per day. That's covered under *Sending door counts to FbTime*, further down.

## What changes when you connect

Every hours figure in your reports says where it came from:

- **Measured** (marked **FbTime**, or the word "measured" on mobile) — real clock time from FbTime.
- **Estimated** — the knock-span math, used wherever no measured hours exist.

On the canvasser tables, the marker beside each person's doors-per-hour also tells you **why** an
estimated number is estimated — **No link** (nobody mapped them yet), **Open shift** (a missed
clock-out), or plain **Est** (they're linked, they just didn't clock in). Only the first two are
anybody's to fix. See [Why does doors-per-hour say "estimated"?](why-does-doors-per-hour-say-estimated)

The two are **never mixed into one team rate**. A team's doors-per-hour only says "measured" when
every canvasser in it is fully measured; otherwise it stays estimated for everyone, so you never
quote a client a number that's half one thing and half another.

## Which hours it uses

FbTime tracks three versions of a shift. Doorline uses **Adjusted hours** by default — the same
"Adjusted total" your FbTime timesheets show, the number you run payroll on — so the leaderboard
and a paycheck always agree. You can change this on the Integrations page, but Adjusted is the
recommended setting.

## Connecting

1. In **FbTime**, an admin of your organization creates an API key (Integrations → New key). The key is shown once — copy it right away.
2. In **Doorline → Integrations**, paste the key and press **Test connection**. Doorline shows which FbTime organization the key reads — **check the name is yours** before connecting.
3. Press **Yes — connect**. Doorline stores the key encrypted, links canvassers whose email matches in both apps, and pulls the last few months of hours within a couple of minutes.

To swap the key later — a new one, or one that can also fill in door counts — use **Settings → Replace key** on the Integrations page: paste it, press **Test**, check the FbTime organization's name is yours, then **Use this key**. Hours keep flowing and your links are kept. A key that reads a *different* FbTime organization asks before it's used.

## Mapping canvassers

Hours only count for canvassers linked to their FbTime person. Same email in both apps links
automatically. For the rest, use the mapping table on the Integrations page. A person marked
**Hours not counted** has clocked time that counts nowhere until you link them.

The table shows **both rosters side by side** — matched pairs, your people who have no FbTime
match, and FbTime people who have no match here — with each person's campaigns next to the FbTime
project they most recently clocked into, so you can tell at a glance whether the two line up.
Doorline doesn't judge that for you: the two names come from different systems, so both are shown
plainly and neither is ever flagged as wrong. The project name is **information only and never
changes any number** — hours attach to campaigns from your knock records.

Search matches either system's names and emails. The list is sorted with the work at the top, and
people who have left either system are hidden until you tick **Include inactive** (the line above
the table always says how many are hidden). When several people match by email, Doorline offers
them as a list you can review and untick before linking, rather than linking them silently — and
you can tick several rows to link or unlink them together.

Unlinking one person happens straight away, with **Undo**; unlinking several at once asks first — and when it's someone who deleted their account, or Doorline has sent door counts for them, it always asks (see *Unlinking: was the link right?* below). A canvasser who's already linked can't be moved straight to a different FbTime person — unlink them first, then link them to the right one.

To check one person without coming here, open them from Users or a campaign's Team page — their
profile says **FbTime linked** or **FbTime not linked**, with a shortcut back to this page. Team
leads can see that too, even though they can't open the Integrations page themselves.

## When a timesheet fix shows up

Doorline re-checks FbTime on a schedule: the **last 7 days** about **every 15 minutes**, and the
**last few months** overnight. So a correction made in FbTime — a fixed clock-in, a closed shift,
a deleted entry — appears on its own within 15 minutes if the shift is recent, or by the next
morning if it's older.

Don't want to wait? Press **Refresh hours** in the connection bar at the top of the Integrations page — if your organization sends door counts to FbTime, the same button reads **Sync now** and re-sends those too. It re-pulls the last few months on the spot — usually done in seconds — and tells you when the numbers are in. If the connection shows **Needs attention**, the same button also retries it; a problem fixed on the FbTime side heals without re-pasting the key.

## Unlinking: was the link right?

Unlinking never clears anything by itself. Usually it simply unlinks, and that person's reports go back to estimated hours straight away. But when a canvasser **deleted their account**, or Doorline has **sent door counts** to FbTime for them, **Unlink** asks one question — **Was the link right?**

- **Yes — keep.** They left, or they'll come back with a new account. The old account keeps counting for that FbTime person: the hours it clocked stay its own, so its past doors-per-hour stays measured. If your organization sends door counts, what Doorline sent stays on FbTime, corrections stop reaching FbTime for them, and the old account's doors are added to a new account's once you link one.
- **No — the link was wrong.** Doorline clears every number it sent to FbTime for that person, brings back any numbers someone had typed there, and won't suggest that pairing again. If you then link the FbTime person to the right canvasser while door counts are on, their last 120 days refill in the same run. Where nothing was sent, it simply unlinks.

**Undo**, right after an unlink, cancels a clear that hasn't run yet — so does linking the same pair again. If the clear already ran, those days stay cleared. A **deleted** account, and a member who **left your organization**, can't be linked again once unlinked.

## A canvasser who comes back with a new account

A deleted account can't be restored — a canvasser who returns gets a brand-new account. To keep them as one person:

1. Add them as a new person.
2. On the Integrations page, unlink the old account and choose **Yes — keep**.
3. Link the new account to the same FbTime person.

The old account's hours stay with the old account, so last season's measured rates stay measured, and the new account's hours start from its own first days on doors. If your organization sends door counts to FbTime, both accounts' doors are added together for that FbTime person.

The FbTime person's row then says it **also counts** the earlier account, by name. **Stop counting** undoes that if it was a mistake: the earlier account's hours go back to the current link, so its past rates become estimated, and door counts are re-sent without it. For a deleted account, Stop counting can't be undone.

## Good to know

- A canvasser still on the clock counts "so far" — the number keeps moving until they clock out, and the reports say when that's what you're looking at.
- **Several shifts in one day are added together for you.** A morning and an evening shift are one day's hours — nothing to configure.
- **Campaigns in different timezones all measure.** Hours follow each campaign's own calendar automatically, so an Eastern campaign and a Central one both show measured hours.
- **Hours follow the knocks.** If a canvasser splits time across campaigns, each campaign's doors-per-hour only counts the days they actually worked it — a day spent knocking a different campaign counts there instead, and hours from before they joined a campaign never count against it.
- Hours an admin typed into FbTime by hand still count, and the reports note it.
- A shift someone forgot to close is ignored for that day (it would read as a 30-hour day) and the day falls back to the estimate.
- A day someone was clocked in but knocked nothing still counts its hours — time driving between turfs is exactly what the estimate could never see.
- Doorline holds **each shift's start time and its hours figures**, and nothing else. Clock-out times, breaks and who edited a shift are never stored here — open the person's timesheet in FbTime for those.
- Disconnecting reverts every report to estimates immediately, destroys the stored key, and turns door counts off. Your canvasser links — and any earlier accounts you kept — stay for a reconnect.
- Two rows mean something is actually wrong. **Broken link** means the link points at somebody who has left your organization, or at somebody who's no longer in FbTime. A row for someone who **left your organization** is usually best left alone — the link is what keeps their past hours their own, and once unlinked they can't be linked again; a row for someone **no longer in FbTime** can be unlinked. **Orphan hours** means hours from a person no longer on your FbTime roster; you can still link them to the right canvasser.

## Sending door counts to FbTime

> **Note:** if you don't see a **Door counts to FbTime** card on the Integrations page, it isn't available to your organization yet, and nothing below applies to you.

FbTime's **doors-per-hour page** divides each canvasser's doors by the hours they were on the clock. Usually somebody types those doors in by hand, reading them off Doorline. With door counts turned on, Doorline sends them instead: each linked canvasser's doors for each day — every 15 minutes for the last 7 days, and every night for the last 120 days. It stays off until an org admin turns it on.

What Doorline sends, exactly:

- **To** the FbTime organization your key belongs to — nobody else.
- **About** every canvasser linked to an FbTime person on the Integrations page, including anyone you link later, plus an earlier account you kept for that person. Nobody unlinked is ever sent.
- **The number** is that day's doors — the same number as the **Doors** column in the canvasser table on a campaign's **Timeline**, added up across all your campaigns. Survey, Lit dropped, Not home, Wrong address, Refused, Not a target voter and No soliciting all count. **Restricted access** never does.
- **Only days they recorded something at a door.** A day with nothing but Restricted access marks is sent as **0**, and a day with nothing recorded sends nothing. Notes, and Restricted marks set from the desk, never count and never make a day count.
- **The date** is the day in the campaign's own time zone — the day the Timeline files it under. Two campaigns on one date give one number, added together.
- **What's in it:** FbTime's own id for the person, the date and the number. Never names, emails, voters, addresses, survey answers, notes or locations.

**A door recorded again moves to the later day.** Doorline keeps one result per canvasser per door per round — the latest. If Maria marks 40 doors *Not home* on Monday and records them again on Thursday in the same round, the Timeline — and so FbTime — shows those 40 on Thursday, and Monday's number drops. A callback in a **new round** leaves Monday alone.

## What FbTime's page shows: Doorline decides

- **A day Doorline reports shows Doorline's number, locked**, marked as coming from Doorline, for as long as your door-count key exists in FbTime. To change it, fix the door results in Doorline — the correction arrives with the next send. A number someone had typed on that day is filed away by FbTime, not shown or counted.
- **Doors Doorline can't know about** — on paper after a phone died, or on another platform — go in FbTime's **other doors** box for that day. They're added to Doorline's number, and nothing Doorline sends or clears ever touches them.
- **A day Doorline never reports** works as it always has: a typed number stands.
- **A day Doorline emptied** — its doors moved to another day, were unknocked, or a round's history was cleared — shows **"Doorline: none — doors moved or removed"**. Don't type those doors in again, or they'll count twice.
- **When you clear in Doorline**, Doorline's numbers come off those days and any number someone had typed there comes back; days with nothing typed go blank.
- **Once door counts are stopped for good** (the door-count key revoked in FbTime), Doorline's days unlock on FbTime and can be edited there.

Tell whoever types doors into FbTime before you turn this on.

## Turning door counts on

1. **Get a key that allows it — when you're ready, not before.** In FbTime, create a key with **Also let it fill in door counts** ticked. It reads hours too, so it replaces your current key. FbTime allows one such key per organization (if the option is greyed out, one already exists), and while it exists FbTime's page expects Doorline's numbers.
2. **Put the key into Doorline.** Already connected: **Integrations → Settings → Replace key** — paste it, press **Test**, check the FbTime organization's name is yours, then **Use this key**. Hours keep flowing and your links are kept. Not connected yet: paste it into the connect card.
3. **Turn on** door counts on the **Door counts to FbTime** card. The confirmation says what will be sent and for how many people (everyone linked now, and anyone you link later), and that numbers typed on FbTime on those days are replaced. The first send — the last 120 days — usually goes within a few minutes.
4. In FbTime, **revoke the old key** — once no other Doorline organization uses it.

Only an org admin who's a member of your organization can turn door counts on — Doorline staff helping in your account can't, though they can turn them off. Only one Doorline organization can send door counts to a given FbTime organization; if another already does, the card says so — contact Doorline support if that's unexpected.

## Replacing a door-count key

FbTime allows only one door-count key at a time, so the order is: in FbTime **revoke** the current key, **create** the new one with door counts ticked, then **Replace key** in Doorline straight away. In between, hours and door counts pause (the connection bar shows **Needs attention**), and Doorline's days are briefly editable on FbTime; the next send puts Doorline's numbers back. If another Doorline organization reads hours with the same key, give it its own hours-only key first.

## When door numbers change

While a canvasser is linked and door counts are on, for the last 120 days:

- **A door result is corrected, unknocked, reclassified or moved to a later day:** the next send fixes FbTime — within 15 minutes for the last 7 days, otherwise overnight. Late results from a phone that was offline work the same way.
- **A round's knock history is cleared in Turf Cutting:** those doors leave the Timeline, so those days drop on FbTime too.
- **A canvasser is linked:** within 15 minutes Doorline sends their last 120 days.
- **A campaign's time zone is changed:** its doors move to the matching dates — within 15 minutes for the last 7 days, overnight for older days.

**Corrections stop reaching FbTime** for days older than 120, for anyone unlinked, and after door counts are turned off, stopped for good, disconnected, or switched to another FbTime organization. Those days keep what Doorline last sent — locked while your door-count key exists, editable once it's revoked — unless you clear them.

## Clearing what Doorline sent

- **For one person you unlinked because the link was wrong:** choose **No — the link was wrong** when you unlink (see *Unlinking: was the link right?*).
- **For an FbTime person who's no longer linked:** their row on the Integrations page offers **Clear the numbers Doorline sent for** that person.
- **For everyone:** tick **Also clear the numbers Doorline sent** when you turn door counts off, or use **Clear the numbers Doorline sent…** on the card once they're off. You can't clear everyone while door counts are on — turn them off and clear in the same step.

A clear reaches back to the first day Doorline ever sent, brings back the numbers people had typed on those days, and blanks the rest. While it runs the card says **Clearing**, with **Cancel**.

## Turning door counts off, or stopping for good

- **Turn off** stops sending. Days Doorline sent keep its numbers — locked while the door-count key exists — unless you tick **Also clear the numbers Doorline sent**.
- **Stopping for good:** clear first if you want Doorline's numbers gone, then in FbTime create a key **without** door counts, **Replace key** in Doorline, and **revoke the door-count key** in FbTime. Doorline's days then unlock on FbTime.
- **Clear before you revoke.** Doorline can only clear with a key that can fill in door counts, so once that key is gone, its numbers stay where they are.
- **Disconnecting** turns door counts off too; clear first if you want, then revoke the key in FbTime. If a clear is still waiting, Doorline asks first — disconnecting abandons it.
- **Reconnecting** starts with door counts off.

## Door-count limits worth knowing

- A day with more than **2,000 doors** for one person isn't sent (FbTime's limit); the card names it.
- Doorline re-sends at most **120 days** back. A clear goes further, back to the first day Doorline ever sent.
- FbTime files a whole shift under the day it **started**, in the time zone where the person clocked in; Doorline files doors under the campaign's day. A shift past midnight, or work in a time zone behind the campaign's, can put hours and doors on neighbouring days.

See also: [The Integrations page](page-integrations), [Why can't I change a door count on FbTime?](fbtime-door-counts), [Your dashboard numbers, defined](metrics), [Export knocks for invoicing](export-knocks-for-invoicing).
