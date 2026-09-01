---
slug: export-knocks-for-invoicing
title: How do I export knocks by pass for an invoice?
audience: admin
kind: faq
order: 46
sourceDoc: METRICS.md
summary: Download the per-pass knock breakdown from the campaign Home's By pass section — the TOTAL row always matches the campaign's knock count.
tags: export, csv, invoice, billing, passes, knocks, download
---

Open the campaign's **Home** and find the **By pass** section — one row per walk list and pass (Pass 1, Pass 2, …) for the selected date range. Click **Export CSV** to download the same table as a spreadsheet.

Each row carries that pass's knocks, survey doors (or lit drops), connection rate, and **New homes reached** — homes whose first-ever knock landed in that pass, so a revisit adds a knock but not a new home.

The last line is the **TOTAL row**: the sum of every pass above it, and always exactly the campaign's Knocks number for the same date range — so you can check the export against the dashboard, or against an invoice, at a glance. Knocks recorded before the campaign had passes appear as one "Legacy / no pass" row.

Three things to know:

- **Pick the date range first.** The export uses the range selected on the page — set it to the invoice period (say, last month) before downloading. The same goes for the **coordinator filter**: if a crew is selected, the export is that crew's rows and TOTAL, not the campaign's — leave it on "All coordinators" for an invoice.
- **Pricing doesn't change.** Doorline bills per campaign per month; this export is the supporting detail behind the work, not a price calculator.
- **No-soliciting doors are already in there.** They're knocks like any other, counted in the **Knocks** column, plus their own **No soliciting** column so you can see how many there were.
- **Restricted homes can be included.** If this campaign counts restricted homes as billable doors, the export gains **Restricted doors** and **Billable doors** columns, and the TOTAL row carries the billable-door figure. If it doesn't, the export looks exactly as it always has. See [Can I bill for restricted doors?](bill-restricted-doors).

**Want a file that sticks around, or the per-door detail behind these totals?** The campaign's
**Exports** page can queue the same per-round numbers inside a full backup, plus a
**Doors by round** file that reconciles to this table door by door — and exports keep working
during the read-only wind-down after a subscription ends. See [Exporting your data](exports).
One caution: a Canvassing activity export queued with **One row per voter at the door** arrives
named `activity-log-by-voter` and repeats each knock once per voter — never invoice from that
file; the name is the tell.

See [Understanding the numbers](metrics) and [Billing and your account](billing).
