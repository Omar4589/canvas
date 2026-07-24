---
slug: two-campaigns-same-voters
title: Can two of our campaigns target the same voters?
audience: lead
kind: faq
order: 30
sourceDoc: VOTERS.md
summary: Yes — each campaign gets its own copy of every voter and door, so nothing mixes.
tags: campaigns, import, voters, overlap, multiple campaigns
---

Yes. Two campaigns in your organization can work the **same neighborhoods — even the exact same
people** — and nothing bleeds between them.

When a campaign imports a voter file, it gets its **own copy** of every voter and every door in
that file. If another campaign later imports an overlapping file, that campaign gets its own
copies too. From then on:

- **Doors, books, and maps are separate.** Each campaign cuts and assigns its own books; a
  canvasser only ever sees the doors of the campaign they're working.
- **Counts and reports are separate.** Knocks, surveys, coverage, and per-canvasser numbers are
  each campaign's own. (The org-level Overview still shows the campaign-by-campaign rollup.)
- **"Surveyed" is per campaign.** Surveying someone in one campaign doesn't mark them surveyed in
  the other — each campaign tracks its own conversations.
- **Billing is separate.** Each campaign's knocks bill to that campaign.

A few things stay **organization-wide on purpose**, because they're about the *person*, not a
campaign:

- **Do not contact** — set it once, it applies in every campaign, current and future.
- **Admin notes** on a voter follow them everywhere.
- The org-wide **Voters** directory shows each person once, with a chip for every campaign
  they're in; filter by a campaign to see that campaign's own records.

There's nothing to configure — this is just how imports work. See
[Importing voter files](voter-imports).
