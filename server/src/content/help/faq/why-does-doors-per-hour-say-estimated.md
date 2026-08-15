---
slug: why-does-doors-per-hour-say-estimated
title: Why does doors-per-hour say "estimated" (or "measured")?
audience: admin
kind: faq
order: 62
sourceDoc: FBTIME_INTEGRATION.md
summary: What the measured/estimated label on hours figures means, what each marker beside doors-per-hour is telling you, and why a team rate can say estimated even when some canvassers are measured.
tags: fbtime, hours, doors per hour, estimated, measured, dot, no link, open shift
---

**Estimated** means the hours behind that number came from Doorline's knock-span math — each day's
first knock to its last, added up. That's the default for every organization.

**Measured** means your organization has connected [FbTime](fbtime-hours) and the hours came from
real clock-in/clock-out time.

## The marker beside someone's doors-per-hour

On Campaign Home and Timeline, each canvasser's rate carries a small label saying where their hours
came from. Hover it for the full explanation.

| Marker | What it means | What to do |
|---|---|---|
| **FbTime** | Every day in range came from their clock time. | Nothing. |
| **Part** | Some days measured, the rest estimated. | Nothing, unless the split surprises you. |
| **No link** | FbTime is connected, but this person isn't matched to an FbTime profile — so **none** of their clocked hours count. | Link them on the Integrations page. |
| **Open shift** | Someone forgot to clock out, so a shift stayed open from an earlier day. Doorline ignores it rather than counting a 30-hour day. | Close it in FbTime; the number corrects itself. |
| **Est** | They're linked and everything's fine — they just have no clocked hours in this range. | Usually nothing. This is a day off. |

If your organization hasn't connected FbTime, there's no marker on any row at all.

You can also check one person without going to the Integrations page: open them from Users (or a
campaign's Team page) and their profile says **FbTime linked** or **FbTime not linked**. Team leads
see this too.

Three things people ask next:

**Why does my team rate say estimated when most of my canvassers are measured?** Because measured
and estimated hours are never blended into one rate. The team figure only switches to measured when
*every* canvasser in it is fully measured — usually this means someone isn't linked to their FbTime
person yet, or didn't clock in one day they knocked. Link them on the Integrations page, or accept
the estimate.

**Why did a canvasser's hours drop after we connected?** The estimate can only see knock-to-knock
time; the clock sees breaks that were deducted (and, the other way, driving time the estimate
missed). The measured number is the one that matches their paycheck.

**Why did today's number change during the day?** A shift that's still open counts "so far" and
updates as Doorline re-checks FbTime every few minutes. When that's what's happening, the
explanation on the marker says so — *"includes a shift still running"* — along with a note if any
of the hours were typed into FbTime by hand rather than clocked.

**What if someone works two shifts in one day?** That's handled and needs nothing from you. A
morning and an evening shift are added together into one day's hours automatically.

## Downloading the detail

Both the web Timeline and the mobile Timeline have an **Export CSV** button that gives you one row
per canvasser with an **Hours source** column saying *Measured*, *Mixed* or *Estimated* for each
person. The file stamps its own date range, the moment its hours were read, and the crew if you had
one selected — measured hours can change later (a shift gets edited or closed), so a saved file has
to say when it was true.
