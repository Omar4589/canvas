---
slug: page-door-outcomes
title: The Door Outcomes page
audience: admin
kind: page
order: 117
sourceDoc: CAMPAIGNS.md
summary: Correct what a canvasser recorded at a door — including recording or removing survey answers.
tags: outcomes, corrections, surveys, quality, page, admin
---

**Door Outcomes** (in the sidebar's **Quality** group, next to Audit) is where you change what a recorded entry *says*. It's **org admins only** — leads decide what canvassers can record going forward, but changing the record itself sits one level up.

Filter by outcome, canvasser or round, tick the entries you want — one row to fix one door, or **Select all N matching** for a whole batch — then pick what they should become.

## Every change is priced before it runs

That review step is the whole safety model, so it's never skippable.

- A change that can't move any number says so: *"No reported numbers change."* True for any mix of **Not home**, **Wrong address** and **No soliciting** — each is one knock, and none means you reached a person.
- A change that *can* shows your campaign's real before-and-after — knocks, billable doors, contact rate, survey rate, restricted doors — with the changed figures in red. **Refused** moves your contact rate; **Restricted** moves billable doors. You can still make the change. You just can't make it by accident.

Entries keep their time, GPS location, canvasser, round and turf. Only the label changes — door colors follow, and phones pick them up on the next sync.

## Recording survey answers (→ Surveyed)

A canvasser who tapped the wrong button can't always fix it themselves: doing it away from the door flags their GPS. Select those entries, choose **Surveyed**, and enter the answers.

- **Enter answers** — one answer set for everyone at every selected door. Right for "that whole batch was really *Undecided*."
- **Door by door** — steps through the selection one address at a time so each household gets its own answers — and at a multi-voter door, tick **Different answers for each person** to record each voter separately. Leave part-way with **Finish later**; the session shows under **Survey answer changes** as *Unfinished — 3 of 40 done*, with **Resume** to carry on and **Stop here** to keep what you've done and close it. Closing the tab is the same as Finish later.

You can leave questions blank. Record only what you actually know.

**Who gets an answer:** every voter at that address, except anyone marked do-not-contact and anyone who already answered that round. **A real field answer is never overwritten by one you type** — the review step names everyone who'll be skipped and why.

**Who gets the credit:** the canvasser who knocked. The knock keeps their name, time, location, round and team, so their numbers reflect their work. The answers carry a visible **"Entered by ‹you› on ‹date›"** stamp on the voter's record and in exports, so a desk entry is never mistaken for a doorstep conversation. They count in your rates like any other answer.

If the selected doors use **different surveys** (a walk list with its own survey), you'll be asked to filter by walk list first — one survey at a time.

## Removing survey answers (Surveyed → something else)

This is the cleanup direction. When a canvasser's surveys turn out to be fake, select those entries and change them to **Not home** so the doors go back into play.

The review step lists **exactly whose answers are about to be removed, by name**. The answers are **kept, not destroyed** — they stay on each voter's record and can be restored, because in an investigation the answers you're removing are the evidence.

Only that entry's own canvasser is affected. If a second canvasser genuinely surveyed the same door in the same round, their answers survive untouched.

## Undoing

Every change is listed with an undo that reverses it exactly — including a selection that spanned several outcomes, and a door-by-door session, which undoes as one unit. Changes and undos both appear in the campaign's History.

A large batch runs in the background with a progress bar. If it stops part-way, everything that landed is correct — you can either undo it or pick up where it stopped.

## What you won't see here

Doors an admin marked with **bulk restrict** (desk marks, with their own undo on Turf Cutting), and entries an earlier change already converted, until you undo that one. **Lit dropped** entries never appear — a lit drop has no answers to move either way.
