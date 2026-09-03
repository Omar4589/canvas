---
slug: fbtime-hours
title: Measured hours from FbTime
audience: admin
kind: guide
order: 27
sourceDoc: FBTIME_INTEGRATION.md
summary: Connect FbTime time-tracking so doors-per-hour divides by real clock time instead of an estimate, and map canvassers between the two apps.
tags: fbtime, hours, doors per hour, integration, time tracking, measured, estimated
---

If your canvassers clock in and out with **FbTime**, you can connect it to Doorline so
doors-per-hour divides by the hours they were actually on the clock — instead of the estimate
Doorline otherwise makes from each day's first knock to its last.

This is optional. If your organization doesn't track time (many volunteer efforts don't), nothing
changes for you and everything keeps working exactly as before.

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

1. In **FbTime**, an admin of your organization creates an API key (Integrations → New key). The
   key is shown once — copy it right away.
2. In **Doorline → Integrations**, paste the key and press **Test connection**. Doorline shows
   which FbTime organization the key reads — **check the name is yours** before connecting.
3. Press **Connect**. Doorline stores the key encrypted, links canvassers whose email matches in
   both apps, and pulls the last few months of hours within a couple of minutes.

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

To check one person without coming here, open them from Users or a campaign's Team page — their
profile says **FbTime linked** or **FbTime not linked**, with a shortcut back to this page. Team
leads can see that too, even though they can't open the Integrations page themselves.

## When a timesheet fix shows up

Doorline re-checks FbTime on a schedule: the **last 7 days** about **every 15 minutes**, and the
**last few months** overnight. So a correction made in FbTime — a fixed clock-in, a closed shift,
a deleted entry — appears on its own within 15 minutes if the shift is recent, or by the next
morning if it's older.

Don't want to wait? Press **Refresh hours** in the connection bar at the top of the Integrations
page. It re-pulls the last
few months on the spot — usually done in seconds — and tells you when the numbers are in. If the
connection shows **Needs attention**, the same button also retries it; a problem fixed on the
FbTime side heals without re-pasting the key.

## Good to know

- A canvasser still on the clock counts "so far" — the number keeps moving until they clock out,
  and the reports say when that's what you're looking at.
- **Several shifts in one day are added together for you.** A morning and an evening shift are one
  day's hours — nothing to configure.
- **Campaigns in different timezones all measure.** Hours follow each campaign's own calendar
  automatically, so an Eastern campaign and a Central one both show measured hours.
- **Hours follow the knocks.** If a canvasser splits time across campaigns, each campaign's
  doors-per-hour only counts the days they actually worked it — a day spent knocking a different
  campaign counts there instead, and hours from before they joined a campaign never count
  against it.
- Hours an admin typed into FbTime by hand still count, and the reports note it.
- A shift someone forgot to close is ignored for that day (it would read as a 30-hour day) and the
  day falls back to the estimate.
- A day someone was clocked in but knocked nothing still counts its hours — time driving between
  turfs is exactly what the estimate could never see.
- Doorline holds **each shift's start time and its hours figures**, and nothing else. Clock-out
  times, breaks and who edited a shift are never stored here — open the person's timesheet in
  FbTime for those.
- Disconnecting reverts every report to estimates immediately and destroys the stored key. Your
  canvasser links are kept for a reconnect.
- Two rows mean something is actually wrong. **Broken link** means the link points at somebody who
  has left your organization, so their clocked hours are landing on an account nobody uses — unlink
  it. **Orphan hours** means hours from a person no longer on your FbTime roster; you can still
  link them to the right canvasser.

See also: [The Integrations page](page-integrations), [Your dashboard numbers, defined](metrics), [Export knocks for invoicing](export-knocks-for-invoicing).
