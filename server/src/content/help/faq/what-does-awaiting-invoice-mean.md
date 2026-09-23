---
slug: what-does-awaiting-invoice-mean
title: What does "awaiting invoice" mean, and why isn't every unissued month in it?
audience: super
kind: faq
order: 69
sourceDoc: BILLING.md
summary: Awaiting invoice counts closed months worth more than $0 with no statement — a $0 month owes nobody anything and is never a backlog item.
tags: billing, invoice, awaiting, overdue, outstanding, super admin
---

**Awaiting invoice** is a month that meets all three of these:

1. It has **closed** — you can't invoice a month that is still accumulating knocks.
2. It comes to **more than $0**.
3. It has **no statement** — you haven't invoiced it.

That second condition is the one people ask about. An organization still in setup, or one whose
campaigns were all archived months ago, has plenty of closed months with no statement — and owes
nothing for any of them. Counting those would turn an empty to-do list into a page of busywork, so
they read **"Nothing to bill"** instead and are never part of the backlog.

## The three money words

- **Awaiting invoice** — you haven't billed it yet.
- **Outstanding** — you have billed it and haven't been paid.
- **Overdue** — outstanding, and the due date has passed.

They never overlap. A month is in exactly one of them, or in none.

## Why the figures are the ones you sent

Outstanding and overdue always total what the **statement** says, never a fresh recalculation. If a
recalculation later disagrees — someone's offline knocks flushed late, a rate changed — the month
is flagged **drifted** and shows both numbers, for you to void and reissue if the new one is right.
Nothing is ever quietly swapped underneath an invoice you already sent.
