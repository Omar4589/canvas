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

## Surveys: two numbers, two questions

You'll see **two** survey figures, and they are both correct. They answer different questions:

- **Survey doors** — houses where at least one survey was taken. **This is what the connection rate divides by.**
- **Surveyed voters** — how many *people* were surveyed. One house can have several voters, so this is usually the higher number.

If a canvasser shows 18 survey doors but 37 surveyed voters, they've been working houses deeply — two voters per door on average. Neither number is wrong, and **nothing adds them together**.

## Rates

- **Connection rate** — of the doors you knocked, the share where the goal was completed: a **survey taken**, or (on a lit-drop campaign) **literature left**. It divides by **doors, not voters** — so 273 survey doors ÷ 1,252 doors = 22%.
- **Contact rate** — the share where someone actually came to the door. That includes [refusals](restricted-vs-refused): a refusal means you reached a person, even though you didn't get a survey.

## Coverage (houses knocked)

**Coverage** — "houses knocked" and the coverage bar — is based on each door's *current* status across the whole campaign. It is **not** round-aware: one house has one status no matter how many rounds hit it. So a second round adds knocks but **doesn't** change coverage. See [Coverage vs. knocks](coverage-vs-knocks).

Coverage is always for the whole campaign — it can't be narrowed to one team, because a *door* doesn't belong to a team; a *person* does.

## Doors per hour

Time actually spent on doors — each day's first knock to its last knock, added up. Gaps between days aren't counted, so a canvasser who worked three hard afternoons isn't penalised for the days in between.

## Restricted

An **inaccessible** home — a locked building, a gate, no legal access. It's recorded and shown so you know it was attempted, but it is **never counted as a knock and never billed**. See [Restricted vs. refused](restricted-vs-refused).

## Team numbers

Each team's doors are counted the same way — one house per round — so two people on the *same* team who both knocked a house count it once for that team. Teams add up to the campaign total. See [How many doors has one team knocked?](team-door-counts).

> Tip: Dashboard totals add up across *all* rounds. Only the per-round progress view is scoped to one round.
