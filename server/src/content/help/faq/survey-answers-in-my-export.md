---
slug: survey-answers-in-my-export
title: My export says a survey was submitted but not what they said — how do I get the answers?
audience: lead
kind: faq
order: 72
sourceDoc: EXPORTS.md
summary: Tick Include survey answers when you queue Canvassing activity to put the answers beside each knock, or use Results by voter for one row per person; Survey results is still the file that is only surveys.
tags: export, csv, survey, answers, activity, results by voter, download
---

Because by default **Canvassing activity** records that a survey *happened* — the action, the
door, the person, the canvasser, the time — and nothing about what was recorded. Three exports
fill that in, and they are shaped for three different jobs.

## The answers beside the knock record

Press **Queue export** on **Canvassing activity** and tick **Include survey answers** (on the
phone: the **Survey answers** switch on the sheet). Every survey row then carries what was
recorded — one column per question — plus the survey's name and version, when it was submitted,
who took it, and **Desk entered** when an admin typed it rather than a canvasser at the door. Your choice is remembered for this campaign, and whenever the option actually adds rows the file arrives
named `activity-log-with-surveys` — the name is the tell.

It also adds rows, and that is the part to read twice. Surveying three people at one door in one
round is **one** knock and **three** surveys, so two of those surveys have no knock row of their
own. They come out as their own rows, marked **Row source: survey**, with the **Activity DB id**
column empty. Never count those as knocks: for a knock count, count the rows that DO carry an
**Activity DB id**, or use Doors by round, which counts doors per round and nothing else.

Two things quietly change what you get:

- **The Door outcome chips gate it.** Untick **Surveyed** and there is nothing to attach, so the
  columns don't appear at all — the file is exactly the one you'd have got without the option,
  rather than a page of empty columns.
- **A canvasser filter keeps the columns but adds no rows.** The filter removes the knock rows
  that cover the other surveys, and adding them back would fill one canvasser's file with other
  people's work.

If two canvassers surveyed the same person in the same round, both of their rows carry the answers
of record — the ones that are live — and the **Survey taken by** and **Desk entered** columns say
whose survey each row is looking at.

## One row per person instead

If what you want is a person-shaped file rather than an event-shaped one, use **Results by voter**
(web only to queue). One row is one person at a door your team visited, with what happened at that
address in plain English and their answers grouped by round. That is the file built to be handed
to somebody — see [Which file do I send my client?](which-file-to-send-a-client).

## Just the surveys

**Survey results** is one row per survey taken, one column per question. **Survey answers
(detailed)** is one row per recorded answer, exactly as captured, for when the wording of a
question has since changed. Neither carries the knocks that reached nobody.

One rule holds across all of them: someone who has asked not to be contacted never has answers,
survey note or name in a file. On **Canvassing activity** their knock row stays (it is a record of
work performed) with the name, the note and the answers blank; a survey-source row about them is
dropped whole and counted in the withheld figure on the history row. See [What does do-not-contact
mean?](what-does-do-not-contact-mean) and [Exporting your data](exports).
