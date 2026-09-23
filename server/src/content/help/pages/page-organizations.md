---
slug: page-organizations
title: The Organizations desk
audience: super
kind: page
order: 130
sourceDoc: PLATFORM.md
summary: The platform-wide customer list — what each money column means, what the filter chips do, and the monthly rhythm of closing, invoicing and recording payment.
tags: organizations, billing, invoice, overdue, super admin, desk
---

**Organizations** is the platform-wide list of every customer account. It is where you see who owes
what, and it is the front door to each organization's own page.

## The four numbers across the top

| | What it counts |
|---|---|
| **Running month** | What this month has come to so far, across every customer. It is still accumulating. |
| **Awaiting invoice** | Months that have **closed**, come to more than $0, and have **no statement**. This is your backlog. |
| **Outstanding** | Invoices you have issued and have not been paid for. |
| **Overdue** | Outstanding invoices whose due date has passed. |

Clicking a number filters the table to the organizations behind it.

**A closed month with nothing to bill is not a backlog item.** An organization still in setup, or
one whose campaigns are all archived, has closed months with no statement — but owes nothing. Those
read "Nothing to bill" and are never counted as awaiting.

## The filter chips

Every chip carries its own count, and whichever you pick stays in the address bar — so a filtered
desk is a link you can send someone.

- **Needs invoice** — has a closed month worth billing that you haven't invoiced.
- **Overdue** / **Outstanding** — money you are owed.
- **Drifting** — an invoiced month whose figures have since moved. Worth a look before the next one.
- **Trial ending** / **Trial expired** — a trial in its last week, or one that has lapsed.
- **Past due** / **Suspended** / **Wind-down** — account states you set.
- **Idle** — quiet for months at $0.
- **Not started** — no campaign has been to the field yet, so nothing is billing.

Two toggles sit on the right. **Show internal** reveals Doorline's own organizations, which are
never billed. **Show inactive** reveals organizations you have switched off — except that an
inactive organization **carrying money is always shown anyway**. Turning off sign-in does not
settle an invoice.

## The table, and why it is in that order

The default order is *what needs doing*, not alphabetical: chase overdue money first, then rescue a
trial that is about to lapse, then issue the invoices waiting, then everything already fine. The
**Next action** column says which of those a row is, and takes you straight to the tab that does it.

Click any column heading to sort by it instead; click again to reverse.

**Trial expired has its own red badge.** Underneath, a lapsed trial and an account you suspended
look identical — both are read-only — but they need opposite responses, so the desk separates them.

## Adding a client

**New organization** opens a dialog: name, an optional slug, how long the trial runs, and
optionally the first admin. If you leave the temporary password blank they get an emailed invite
and choose their own, which is the recommended path. If you type one, it is shown **once**, in that
same dialog — so it cannot disappear behind a window that closed itself.

## The monthly rhythm

1. **On the 1st**, the previous month closes. Anything worth billing appears under **Needs
   invoice**, here and on each organization's Statements tab.
2. **Issue** it — one month, or several together under one invoice number. That freezes the
   figures and sets a due date from the organization's payment terms.
3. **Send your invoice** from whatever you bill with. Doorline does not send it.
4. **Mark it paid** when the money arrives, with the date and your reference number.
5. **Chase** anything that goes past its due date — the desk sorts those to the top.

**Month close** in the sidebar does step 1 and 2 across every organization at once, which is the
faster way through a month-end.

## See also

- [The month close board](page-month-close)
- [What does "awaiting invoice" mean?](what-does-awaiting-invoice-mean)
