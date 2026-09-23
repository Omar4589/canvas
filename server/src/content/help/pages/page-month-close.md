---
slug: page-month-close
title: The month close board
audience: super
kind: page
order: 131
sourceDoc: BILLING.md
summary: Closing a month across every organization at once — who still needs invoicing, what has drifted, and what has been paid.
tags: month close, billing, invoice, statements, super admin
---

**Month close** is in the sidebar, under Organizations. It answers one question across every
customer at the same time: *who still needs invoicing for this month?*

Issuing and voiding happen on each organization's own **Statements** tab. This board is the
overview that tells you where to go.

## Picking the month

It opens on the **last closed month** — the one you are almost always here for. That month comes
from the server, not from your computer's clock, so it always agrees with what the app will let you
issue. For a few hours around the 1st those two can differ, and this is the side that is right.

Switch to **Range** to close July *and* August in one pass. Each organization then shows a chip per
month, so "who still owes me July" is a column you scan rather than a page you reload.

## What each row tells you

- **Not issued** — this month closed with something to bill and no statement. Your to-do list.
- **Nothing to bill** — it closed at $0. Nobody owes anything; there is nothing to do.
- **Issued / Paid / Overdue** — it has a statement, and this is where that invoice stands.
- **Drifted** — you invoiced a figure, and a fresh calculation now disagrees. Nothing has changed
  on its own; open the org and decide whether to void and reissue.

## Recompute live

The **Recompute live** button re-runs every organization's numbers from scratch. It is behind a
button rather than automatic because it is genuinely expensive — it walks every campaign of every
organization. Without it the board still answers the main question (who has a statement and who
does not) in three queries.

Live mode is also what tells a $0 month from an owed one, which is why an unissued month shows no
state until you press it.
