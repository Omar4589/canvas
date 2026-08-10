---
slug: two-survey-numbers
title: Why do I see different survey numbers?
audience: lead
kind: faq
order: 42
sourceDoc: METRICS.md
summary: "Survey doors" counts houses, "Surveys taken" counts forms, "Voters surveyed" counts people. They legitimately differ — and they only start to differ once you run a second round.
tags: surveys, doors, voters, surveys taken, rounds, connection rate, counts, discrepancy
---

Because they're counting three different things, and all of them are right.

- **Survey doors** — *houses* where at least one survey was taken, counted once per house **per round**.
- **Voters surveyed** — *people*, counted once each no matter how often you spoke to them.
- **Surveys taken** — *forms filled out*.

## One house, several voters

A single house can have several voters living in it. Survey two people at one door and that's **one survey door**, **two voters surveyed**, and **two surveys taken**.

A canvasser showing **18 survey doors and 37 voters surveyed** is averaging two voters per house — that's someone taking their time at the door, not a bug.

## A second round is where these really split apart

Until you run a second round, "Voters surveyed" and "Surveys taken" are usually the **same number** — you can only survey each person once, so a person and a form are the same thing.

Go back for a second round and that changes. Survey Maria in Round 1 and again in Round 2 and you get:

- **2 survey doors** — you visited her house twice, and did the work twice.
- **1 voter surveyed** — she's still one person.
- **2 surveys taken** — two forms.

None of those is wrong. If a number looks like it jumped after you started a second round, this is usually why.

## What about answers, like yard signs?

Answers are counted **per survey**. If Maria asks for a yard sign in Round 1 and again in Round 2, that counts as **2** — because you handed out two signs. That's deliberate: it's a count of what you did, not of how many people you spoke to.

You can also look at one round on its own. Use the round filter (on the campaign Home's Survey results or the **Survey Explorer**) to see, say, only the yard signs requested in Round 2. Each round's numbers add up to the all-rounds total.

## And tags?

**Tags count people, once each** — they're the voter-unit answer. If you tag "Support" as *Supporter*, Maria answering Support in both rounds is **one** identified supporter, not two. Each tag shows two figures: **identified** (ever gave a tagged answer — never goes down) and **still current** (their most recent answer still carries it — this one *can* go down when someone changes their mind in a later round, without anything being deleted). See [How do I count our supporters?](how-do-i-count-supporters).

## Which one does the connection rate use?

**Survey doors.** The connection rate is *"of the doors we knocked, how many completed the goal"* — so both sides of that fraction are doors. If you check the maths with the voter number instead, you'll get a different percentage and think something's broken.

## Do they ever add up?

**Never add them together.** They're three lenses on the same work, not three parts of a total.

One more that catches people out: **Survey doors** and the **surveyed** slice of the Coverage bar answer different questions. Coverage counts each *home* once, ever — so once you run a second round, Survey doors will be the bigger number, by exactly the number of houses you went back to.
