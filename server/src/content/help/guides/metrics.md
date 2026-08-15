---
slug: metrics
title: Understanding the numbers
audience: lead
kind: guide
order: 22
sourceDoc: METRICS.md
summary: What a knock, a survey door, coverage, and the connection rate actually mean — and why two pages can show different survey counts.
tags: metrics, knocks, coverage, rate, billing, doors, surveys, overlap, teams
---

A few definitions make every number on your dashboard click into place.

## Knocks (doors)

A **knock** is **one house, in one round**. If two canvassers hit the same house in the same round, it counts **once** — you are never billed twice for it. Knock that house again in a *new* round and that's a new knock, because going back is deliberate work.

So running another round **adds knocks** — each house counts once per round.

> The Timeline and the campaign Home page both show this same deduped number, so they always agree.

## When two canvassers hit the same house

It happens — usually because two walk lists overlapped. The Timeline shows both the raw count of everything everyone recorded *and* the deduped number, so the two always reconcile:

> *1,255 knocks across 6 canvassers · 3 overlap door-passes (counted once → 1,252)*

Click **Review overlap doors** to see exactly which houses, and who knocked them. **Each canvasser still gets credit** for the door they knocked — it shows on both their rows. It's only the *campaign* total that counts the house once.

**Two places show overlaps, and they scope differently:**

- The **Timeline** reconciles the overlaps **inside the date range you're viewing** — great for checking a specific day's or week's numbers. Because it's tied to that window, it can **miss** a collision whose two knocks happened on **different days** of the same pass.
- The **map's Overlaps toggle** (and a door's detail panel) take the other view — **the same pass, any day** — so it's the **complete** list of doors more than one canvasser worked in a pass, even across days. See [Using the maps](maps).

Either way, an overlap is **never billed twice** — this is just there to help you spot and coach the wasted effort.

## Surveys: three numbers, three questions

You'll see **three** survey figures, and they are all correct. They answer different questions:

- **Survey doors** — houses where at least one survey was taken. **This is the top of the connection rate** (it gets divided by Knocks).
- **Surveys taken** — how many *forms* were filled out. Same as "Voters surveyed" until you run a second round; survey the same person again in Round 2 and that's another survey but still one person.
- **Voters surveyed** — how many *people* were surveyed, counted once each however many rounds you spoke to them in. One house can have several voters, so this is usually higher than survey doors.

The **Survey results** section counts in the same unit as **Surveys taken** — so a question's "answered" count can be larger than "Voters surveyed" without anything being wrong.

If a canvasser shows 18 survey doors but 37 voters surveyed, they've been working houses deeply — two voters per door on average. Neither number is wrong, and **nothing adds them together**. See [Why do I see different survey numbers?](two-survey-numbers).

## Tags: identified vs still current

Survey **tags** (like "Supporter") count **people, once each** — and each tag shows two figures. **Identified** is everyone who ever gave a tagged answer; it never goes down. **Still current** is how many kept a tagged answer the last time you asked — someone who said Support in round 1 and Opposed in round 2 stays identified but is no longer current, so this is the number for "how many supporters do we have *now*." A tag's **By team** table splits those voters by crew — the team that found each voter first gets the credit, so the team rows always add up exactly to the campaign line. See [How do I count our supporters?](how-do-i-count-supporters).

## Rates

- **Connection rate** — of the doors you knocked, the share where the goal was completed: a **survey taken**, or (on a lit-drop campaign) **literature left**. It divides by **doors, not voters** — so 273 survey doors ÷ 1,252 doors = 22%.
- **Contact rate** — the share where someone actually came to the door. That includes [refusals](restricted-vs-refused): a refusal means you reached a person, even though you didn't get a survey.

### What counts as a good connection rate

The connection rate is graded on three bands, and that's what its color means:

- **On target** (green) — 20% and up
- **Watch** (amber) — 10% to 19%
- **Low** (red) — under 10%

In the mobile app the band is spelled out next to the percentage — *On target · 986 of 4,136 doors* — so you can check the number against the two figures printed just above it. Tap **How these are counted** under the Activity list to see the full ladder and which band you're in right now.

A low rate isn't always a canvassing problem: knocking at the wrong time of day, a list heavy on apartments, or a long walk list stretched thin will all pull it down. Compare it against the same campaign's earlier passes before reading much into one day.

### Lit drops vs lit doors

On a lit-drop campaign there are two different numbers, and it's worth knowing which you're looking at:

- **Lit drops** — how many times literature was dropped. Drop at the same door twice in one pass and that's two drops.
- **Lit doors** — how many *doors* got literature, counted once per door per pass. This is what the **lit rate** divides by.

So the drop count can be higher than the door count, and the lit rate is built from the doors. The campaign screen shows you the drop count; tap **How these are counted** if you want the distinction spelled out.

## Coverage (houses knocked)

**Coverage** — "houses knocked" and the coverage bar — is based on each door's *current* status across the whole campaign. It is **not** round-aware: one house has one status no matter how many rounds hit it. So a second round adds knocks but **doesn't** change coverage. See [Coverage vs. knocks](coverage-vs-knocks).

Coverage is always for the whole campaign — it can't be narrowed to one team, because a *door* doesn't belong to a team; a *person* does.

## Doors per hour

Time actually spent on doors. If your organization has connected **FbTime** (see [Measured hours from FbTime](fbtime-hours)), this divides by measured clock time — those figures are marked **FbTime** on the canvasser tables (or **measured** on mobile), and an estimated row says *why* it's estimated — see [Why does doors-per-hour say "estimated"?](why-does-doors-per-hour-say-estimated). Otherwise it's estimated from each day's first knock to its last knock, added up. Gaps between days aren't counted, so a canvasser who worked three hard afternoons isn't penalised for the days in between.

Measured and estimated hours are never mixed into one team rate: a team figure only says "measured" when every canvasser in it is fully measured.

## No soliciting

A door with a posted no-soliciting sign the canvasser honored. The canvasser reached the door, so this **is** counted as a knock — it counts toward doors, doors/hour, and billing like any other. But nobody answered, so it never counts toward your **contact rate** or **survey rate**; it lowers both, the same way a not-home does. See [Refused, No soliciting, and Restricted](restricted-vs-refused).

## Restricted

An **inaccessible** home — a locked building, a gate, no legal access. It's recorded and shown so you know it was attempted, but it is **never counted as a knock**, so it never affects your contact rate, survey rate, or coverage. See [Refused, No soliciting, and Restricted](restricted-vs-refused).

## Billable doors

If you invoice your client per door, you may want the restricted homes on the bill anyway — the canvasser still made the walk. Admins can turn that on, and a **Billable doors** number appears alongside Doors on your reports and invoice export: knocked doors **plus** restricted homes.

Everything else stays exactly where it was. Doors, contact rate, survey rate, and the coverage bar don't move — nobody answered a locked gate, so counting it as a contact would make those numbers wrong. Two homes never count: one your team marked restricted in bulk from the office (that's not a walk), and one that a second canvasser later knocked (it's one door, counted once, as a knock).

This is **off** unless you turn it on, and it has no effect on what Doorline charges you. See [Can I bill for restricted doors?](bill-restricted-doors).

## Door goal and pace

If a campaign has a **door goal**, a thin line at the top of its Home page shows progress toward it and what it takes to get there. Two words of warning about vocabulary: **"pace" means two different things** in this app. On the Timeline it's **doors per hour** — how productive a canvasser is. On the goal line it's **doors per calendar day** against a deadline. Same word, unrelated numbers.

Goal progress is counted in **billable doors**, so the goal and your invoice speak the same unit, and it's always the campaign's **all-time** total — the date range, walk-list and crew filters don't change it.

**Needed** is the doors left divided by the calendar days remaining **after today** — today's knocking is already planned or underway by the time you're reading, so counting it as an available day would flatter every day that follows. (On the goal date itself it's simply everything left, today.) Days nobody knocks still count. **Current pace** is the last 14 days measured exactly the same way, which is what makes the two comparable: if you take Sundays off, both numbers absorb it, and hitting the needed rate exactly puts your finish exactly on the date.

**Ahead / On track / Behind** compares those two (on track is within 5% either way). It doesn't appear until the campaign has about **5 days of canvassing** behind it, or if the last two weeks hold no doors at all. That silence is deliberate — calling a two-day-old campaign "behind" because it hasn't done two weeks of work would be wrong, and a wrong warning costs more than a missing one. See [How many doors a day do we need?](how-many-doors-a-day).

## Team numbers

Each team's doors are counted the same way — one house per round — so two people on the *same* team who both knocked a house count it once for that team. Teams add up to the campaign total. See [How many doors has one team knocked?](team-door-counts).

A canvasser's doors count for whoever their coordinator is **right now**, so setting a crew you forgot to set moves that person's earlier doors onto it. Someone *leaving* moves nothing. See [I moved someone to another team](move-a-canvasser-to-another-team).

> Tip: Dashboard totals add up across *all* rounds. Only the per-round progress view is scoped to one round.
