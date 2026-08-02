---
slug: page-duplicate-surveys
title: The Duplicate Surveys page
audience: lead
kind: page
order: 115
sourceDoc: METRICS.md
summary: Voters who were surveyed more than once — filter by canvasser, duplicate type, or date to audit them.
tags: duplicate surveys, audit, canvasser, surveys, page, mobile
---

The **Duplicate Surveys** page lists every voter with **more than one survey response**. That's the reason your **Surveys** number can read higher than **Surveyed voters** — one person answered twice, so they count once as a voter but twice as a survey.

Each entry shows the voter, their address, how many times they were surveyed, and one line per response: **who** took it, **when**, and **which round**. On the web, **Open voter** goes to their profile, where you can compare the answers side by side and delete the extra response if it was a mistake. On the phone you delete it right on this screen — see below.

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

## Who can delete a response

**Team leads can read this page** — every entry, every filter — but **deleting a response is admin-only**, on the phone and on the web alike. That isn't just the app hiding a button: the server refuses a lead's delete either way. If you're a lead and you find a duplicate worth removing, ask an org admin to take it off.

Deleting is permanent — there's no undo and no copy is kept. What it does *not* touch is the knock: the visit stays on the timeline and the door still reads surveyed. Only the response goes, and your **Surveys** total drops by one.

## Why new ones can't be created anymore

The rule is **one survey per voter, per round**, and the database now enforces it — a double-tap can no longer write two rows. Anything on this page is either historical (recorded before that rule existed) or a legitimate revisit in a later round.

## On the phone

Admin → **More → Duplicate surveys** gives you the same report: the same three filters, the same sorting, and **Load more** at the bottom of the list. Each voter starts collapsed with their badges showing, so you can scan for the suspicious ones; tap a voter to open up who surveyed them, when, and in which round. Tapping a response opens its full detail, and **Open voter** goes to the voter's profile — which is read-only on the phone.

An admin can delete an extra response straight from the expanded card: tap **Delete** on the response you want gone, and confirm. The confirmation names the canvasser, the round, and the time, so you can be sure which one you're removing.
