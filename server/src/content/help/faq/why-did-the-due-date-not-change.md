---
slug: why-did-the-due-date-not-change
title: I changed an organization's payment terms, but an old invoice still shows the old due date
audience: super
kind: faq
order: 71
sourceDoc: BILLING.md
summary: Due dates are frozen when a statement is issued, so changing terms only affects the next invoice.
tags: billing, payment terms, due date, invoice, super admin
---

That is deliberate. A statement's due date is **frozen at the moment you issue it**, from whatever
the organization's payment terms were right then.

It works the same way the rate does: renegotiating a price doesn't re-price invoices you already
sent, and renegotiating terms doesn't move the date you already told someone to pay by.

Change the terms on the **Account** tab and the **next** invoice you issue uses them. The Account
tab says so directly beneath the field.

## Net 0 is allowed

Setting terms to **0** means due on issue. It is a real setting, not a mistake, so the app keeps it
rather than quietly resetting to 30.

## Older invoices that never had a due date

Statements issued before due dates existed read as *issued date plus the organization's current
terms* until a one-time maintenance step writes that value down permanently. Either way the date
you see is the same one.
