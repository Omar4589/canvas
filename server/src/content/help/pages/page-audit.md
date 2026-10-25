---
slug: page-audit
title: The Audit page
audience: lead
kind: page
order: 110
sourceDoc: AUDIT.md
summary: Review GPS-flagged entries to check canvassing quality.
tags: audit, gps, quality, page, mobile
---

The **Audit** page surfaces doors the app flagged for a quality check — a mark recorded far from the house, suspiciously fast sequences, many logged from one spot, or weak GPS. You mark each flag **Reviewed**, **Dismissed**, or **Confirmed**, and the app records who decided and when — so you keep field data honest without watching every knock.

Facing a backlog? Filter the list, tick the checkboxes (or **Select all shown**), and apply one decision to the whole set — with a confirmation that names the exact count, and an **Undo** right after.

Each card says when the house pin is approximate (placed by address lookup) or was confirmed in place, so check the pin before asking the canvasser. A door recorded at an unchecked estimated pin, or at a condo complex more than about 1,000 ft from its spot, reads **low** on Far and says why (*Recorded at an estimated pin…* / *Recorded at a complex…*), and those count under the canvasser's **forgiven by pin** number; and a Weak GPS card shows the distance beside the phone's accuracy (*GPS ±492 ft · 394 ft from house*). The audit allows for that accuracy before it calls a door far. **View on map** opens the web map, where a zoomed-in flag shows a faint circle the size of the phone's accuracy estimate: a guide, not a boundary, so a house outside the circle isn't evidence on its own.

Reviewing flags records a decision; it never changes what an entry *says*. When a drilled-in canvasser's entries turn out to need actual correcting, **Correct their entries in Door Outcomes** (org admins, shown while drilled into one canvasser) carries them and this page's date window straight to the Door Outcomes page.

**Paused canvassers.** If your organization uses automatic pause and someone on this campaign is paused for review, a **Paused canvassers** panel sits at the top of the page: who, when, and how many of their doors were faster than possible. **Review** opens the pause — the plain sentence saying what kind of fast it was, the doors behind it, and **Unpause**. Past pauses are under **Show resolved**. More in [A canvasser was paused for review — what do I do?](a-canvasser-was-paused).

For the full walkthrough, see [The GPS audit](audit).

## On the phone

Admin → **More → GPS audit** is the same review queue: the totals, the per-canvasser list, one card per flagged door with the reason, the same filters, and **View on map** on each entry. Tap **Select** (or long-press a card) to decide many at once. It works the campaign named in the **campaign chip** at the top — except **Paused for review**, which sits above the chip and lists everyone paused across the campaigns you manage; tap one for its summary, **Unpause** and **See their day**. **Reviewing still works on archived campaigns** — a review records a decision about work already done, so it isn't switched off when a campaign goes read-only.
