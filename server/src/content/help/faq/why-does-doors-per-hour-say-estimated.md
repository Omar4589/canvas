---
slug: why-does-doors-per-hour-say-estimated
title: Why does doors-per-hour say "estimated" (or "measured")?
audience: admin
kind: faq
order: 62
sourceDoc: FBTIME_INTEGRATION.md
summary: What the measured/estimated label on hours figures means, and why a team rate can say estimated even when some canvassers are measured.
tags: fbtime, hours, doors per hour, estimated, measured, dot
---

**Estimated** means the hours behind that number came from Doorline's knock-span math — each day's
first knock to its last, added up. That's the default for every organization.

**Measured** (often shown as a • dot) means your organization has connected
[FbTime](fbtime-hours) and the hours came from real clock-in/clock-out time.

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
updates as Doorline re-checks FbTime every few minutes.
