---
slug: page-duplicate-surveys
title: The Duplicate Surveys page
audience: admin
kind: page
order: 115
sourceDoc: METRICS.md
summary: Voters who were surveyed more than once — filter by canvasser, duplicate type, or date to audit them.
tags: duplicate surveys, audit, canvasser, surveys, page
---

The **Duplicate Surveys** page lists every voter with **more than one survey response**. That's the reason your **Surveys** number can read higher than **Surveyed voters** — one person answered twice, so they count once as a voter but twice as a survey.

Each entry shows the voter, their address, how many times they were surveyed, and one line per response: **who** took it, **when**, and **which round**. **Open voter** goes to their profile, where you can compare the answers side by side and delete the extra response if it was a mistake.

## Not every duplicate is a problem

Two badges tell you which kind you're looking at:

- **Same canvasser · same day** — the same person surveyed the same voter twice within one campaign day. That's almost always a double-submit or a mis-tap, and it's the one worth fixing.
- **Different canvassers** — two people surveyed the same voter. In a later round that's a normal revisit; in the same round it usually means two walk lists ran into each other (the [Overlaps page](page-overlaps) is where you'd chase that).

An entry can carry **both** badges when three or more responses are involved — a same-day repeat that also pulled in a third canvasser.

## Filtering it for an audit

Three filters narrow the list, and they combine:

- **All / Same canvasser, same day / Different canvassers** — start with **Same canvasser, same day** if you're hunting for mistakes rather than reading history.
- **Canvasser** — shows only the voters *that person* was involved in. The entry still lists everyone's responses, so you can see who else touched the voter. Canvassers who have left the campaign stay in this list, because their work stays on the page.
- **Dates** — the page opens on **All time**, because it's a history report; narrow it when you're checking a specific stretch of fieldwork.

The list is paged. **Same canvasser · same day** entries come first — those are the likely mistakes — and after them voters sort by how many times they were surveyed. The count under the list is the total across every page for the filters you've picked, so you can tell at a glance whether you're looking at four duplicates or four hundred.

## Why new ones can't be created anymore

The rule is **one survey per voter, per round**, and the database now enforces it — a double-tap can no longer write two rows. Anything on this page is either historical (recorded before that rule existed) or a legitimate revisit in a later round.
