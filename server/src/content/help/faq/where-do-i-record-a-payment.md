---
slug: where-do-i-record-a-payment
title: Where do I record that a client paid?
audience: super
kind: faq
order: 70
sourceDoc: BILLING.md
summary: Open the organization, go to Statements, and use Mark paid on the issued month — with the date and your reference number.
tags: billing, payment, paid, invoice, super admin
---

Open the organization, go to the **Statements** tab, and choose **Mark paid** on the month's row.
You can also do it from the **Outstanding** card on that org's Overview tab, which lists exactly
the invoices still waiting.

You are asked for two things:

- **The date the money arrived.** It can be earlier than the invoice — a prepayment is a real
  thing, and the dialog says so when you pick such a date.
- **A payment reference** (optional): your invoice number, a check number, a transfer id.

**A reference number only.** Never a person's name, and never card or bank details. That field is
on a record we keep free of personal information on purpose.

## Undoing it

**Unmark paid** reverses it and asks why. The date and reference you are clearing are kept in the
organization's change history, because once the fields are cleared that entry is the only remaining
record the money ever came in.

## Why you can't void a paid statement

Voiding is refused while a statement is marked paid — unmark it first. "The money arrived" and
"that invoice was wrong" are two different decisions, and each gets its own line in the history
rather than one unexplained click.

## Doorline still doesn't take payment

You invoice outside the app and the money arrives wherever it arrives. What the app does is keep
the bookkeeping, so "which invoices are still out" stops living in somebody's memory.
