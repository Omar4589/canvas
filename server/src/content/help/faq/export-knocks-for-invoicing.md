---
slug: export-knocks-for-invoicing
title: How do I export knocks by round for an invoice?
audience: admin
kind: faq
order: 46
sourceDoc: METRICS.md
summary: Download the per-round knock breakdown from the campaign Home's By round section — the TOTAL row always matches the campaign's knock count.
tags: export, csv, invoice, billing, rounds, passes, knocks, download
---

Open the campaign's **Home** and find the **By round** section — one row per walk list and round (Round 1, Round 2, …) for the selected date range. Click **Export CSV** to download the same table as a spreadsheet.

Each row carries that round's knocks, survey doors (or lit drops), connection rate, and **New homes reached** — homes whose first-ever knock landed in that round, so a revisit adds a knock but not a new home.

The last line is the **TOTAL row**: the sum of every round above it, and always exactly the campaign's Knocks number for the same date range — so you can check the export against the dashboard, or against an invoice, at a glance. Knocks recorded before the campaign had rounds appear as one "Legacy / no round" row.

Two things to know:

- **Pick the date range first.** The export uses the range selected on the page — set it to the invoice period (say, last month) before downloading.
- **Pricing doesn't change.** Doorline bills per campaign per month; this export is the supporting detail behind the work, not a price calculator.

See [Understanding the numbers](metrics) and [Billing and your account](billing).
