---
slug: voters-page-took-too-long
title: Why does the Voters page say it took too long?
audience: admin
kind: faq
order: 75
sourceDoc: VOTERS.md
summary: The all-campaigns view of a very large organization ran out of time — Try again usually works, and picking a campaign always loads quickly.
tags: voters, directory, too long, try again, slow, timeout, campaign filter, large organization
---

The page gives the database a fixed amount of time to put the list together, and that attempt ran out
of it — nothing is wrong with your voters, and nothing was changed. **Try again** usually works. If it
keeps happening, pick a campaign in the filter: one campaign's list loads right away, however many
voters your organization holds. The slowest thing the page does is the all-campaigns view of a very
large organization, because every person who appears in more than one campaign has to be shown once
(see [Can two of our campaigns target the same voters?](two-campaigns-same-voters)), and that means
looking across every campaign at the same time. Searching by name doesn't shorten that work — the
campaign filter is what does.
