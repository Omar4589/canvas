---
slug: page-duplicate-surveys
title: The Duplicate Surveys page
audience: lead
kind: page
order: 116
sourceDoc: METRICS.md
summary: Voters who were surveyed more than once — filter by canvasser, duplicate type, or date to audit them.
tags: duplicate surveys, audit, canvasser, surveys, page, mobile
---

The **Duplicate Surveys** page lists every voter with **more than one survey response**. That's the reason your **Surveys taken** number can read higher than **Voters surveyed** — one person answered twice, so they count once as a voter but twice as a survey.

Each entry shows the voter, their address, how many times they were surveyed, and one line per response: **who** took it, **when**, and **which round**. On the web, **Open voter** goes to their profile, where you can compare the answers side by side and delete the extra response if it was a mistake — or **restore** a replaced one (see below). On the phone you handle it right on this screen — see below.

## Not every duplicate is a problem

Three badges tell you which kind you're looking at, worst first:

- **Same round · overwritten** — two canvassers surveyed the same voter **in the same round**, and the second submit **replaced** the first's answers. Nothing is lost: the earlier response is preserved, listed right here in the entry, and an admin can restore it. A collision like this usually means two books ran into each other (the [Overlaps page](page-overlaps) is where you'd chase that).
- **Same canvasser · same day** — the same person surveyed the same voter twice within one campaign day. That's almost always a double-submit or a mis-tap.
- **Different canvassers · later round** — two people surveyed the same voter in different rounds. That's a normal revisit, listed so the history is complete.

An entry can carry **more than one** badge when three or more responses are involved — a same-day repeat that also pulled in a third canvasser, say.

## Filtering it for an audit

Three filters narrow the list, and they combine:

- **All / Same round · overwritten / Same canvasser, same day / Different canvassers** — start with **Same round · overwritten** if you're checking whether any answers got replaced, or **Same canvasser, same day** if you're hunting for double-submits.
- **Canvasser** — shows only the voters *that person* was involved in. The entry still lists everyone's responses, so you can see who else touched the voter. Canvassers who have left the campaign stay in this list, because their work stays on the page.
- **Dates** — the page opens on **All time**, because it's a history report; narrow it when you're checking a specific stretch of fieldwork.

The list is paged. **Same round · overwritten** entries come first — those are the ones where answers were replaced — then **Same canvasser · same day**, and after them voters sort by how many times they were surveyed. The count under the list is the total across every page for the filters you've picked, so you can tell at a glance whether you're looking at four duplicates or four hundred.

## Who can delete a response

**Team leads can read this page** — every entry, every filter — but **deleting a response is admin-only**, on the phone and on the web alike. That isn't just the app hiding a button: the server refuses a lead's delete either way. The same goes for **restoring** a replaced response — leads can see that it's preserved, but only an org admin can put it back. If you're a lead and you find a duplicate worth removing (or restoring), ask an org admin.

Deleting is permanent — there's no undo and no copy is kept. What it does *not* touch is the knock: the visit stays on the timeline and the door still reads surveyed. Only the response goes, and your **Surveys** total drops by one.

## Why new ones can't be created anymore

The rule is **one survey per voter, per round**, and the database now enforces it — a double-tap can no longer write two rows. A second submit for the same voter in the same round doesn't add a response either: it **replaces** the first one — and when the two submits came from different canvassers, the replaced answers are **preserved** and listed here under **Same round · overwritten**, where an admin can restore them. So anything on this page is historical (recorded before the rule existed), a legitimate later-round revisit, or a same-round replacement with the earlier answers kept.

## On the phone

Admin → **More → Duplicate surveys** gives you the same report: the same three filters, the same sorting, and **Load more** at the bottom of the list. Each voter starts collapsed with their badges showing, so you can scan for the suspicious ones; tap a voter to open up who surveyed them, when, and in which round. Tapping a response opens its full detail, and **Open voter** goes to the voter's profile — which is read-only on the phone.

An admin can delete an extra response straight from the expanded card: tap **Delete** on the response you want gone, and confirm. The confirmation names the canvasser, the round, and the time, so you can be sure which one you're removing.

Replaced responses look different: instead of Delete they read **Preserved**. Tap one to open its full detail — that's where an admin finds **Restore**, which makes those earlier answers current again (the answers they displace are preserved in their place, so nothing is lost either way).

On an **archived** campaign the report still opens and every filter still works, but **Delete** and **Restore** are gone — an archived campaign is read-only, and the server refuses the change even if a button were there. Reactivate it from the web if you genuinely need to remove or restore a response.
