---
slug: exact-doors-or-areas
title: Should my client report show areas or a house-level map?
audience: lead
kind: faq
order: 82
sourceDoc: CLIENT_PORTAL.md
summary: Every report's map shows areas, which never show an address. A house-level map shows each knocked house with its address and answers to anyone who has the link, so you turn it on report by report, after a warning.
tags: client report, map, areas, area view, hexagons, house-level map, exact doors, address, addresses, privacy, survey answers on the map, large areas, candidate, campaign manager
---

Every client report's map shows **areas** unless you turn on its **house-level map**.

**Areas** shade fixed hexagons, each with how many doors were reached there and how they went. **Areas never show an address.** You pick the size:

- **Small areas**, about 1,100–1,400 ft across;
- **Large areas**, about 0.55–0.7 mi across.

**A house-level map** puts a dot at each home your team reached, colored by how the door went. Whoever opens the report can tap a dot to see the home's street address and its answers to the questions you put on the map, and filter the map by result and by those answers. It's for someone who should see exactly which homes you've been to: say the candidate or the campaign manager asks "what homes have we been to?".

## Turning on a house-level map

Under **Map** in the report builder, choose **House-level**. It asks first: *"Anyone with this report's link and password will see every knocked house on the map — its address, its door status, and the survey answers you put on the map. Turn this on only for someone who should see that, like the candidate or the campaign manager."* Press **Use a house-level map** to turn it on. Doorline notes who turned it on and when, in the report's **History**.

It's for that one report. **Next report** always starts in areas, so a house-level map is never passed on to next week's report without you choosing it again.

## Survey answers in area view

Only pick-one questions can show answers by area. Even then, a question shows its answers area by area only when **every** area has at least five answers to it. If one area has fewer, that report shows only the question's overall chart, and the builder tells you so: under **Before you publish** on a draft, and on a published report in the **Switch to areas** confirm, the **Refresh numbers** review and the **Worth a look** box. **Large areas usually fix it.**

The hexagons are see-through so the streets show under them, and the legend's colours match them as they look on the map.

Two things still worth knowing:

- An area where every home that answered gave the same answer tells your client how each of them answered.
- Other reports your client can open can narrow things down: another week's report, a team or walk-list report, or a report with a house-level map. Each report has its own link, but one person can hold several links, so the builder lists every report that could.

How each door went (surveyed, didn't answer, and so on) shows for every area, even one with a single home.

## Switching

- **On a draft**, choose **Areas** or **House-level** under **Map**, then press **Recompute** before you publish.
- **On a published report**, **Switch to areas** is part of **Edit**. Your client keeps seeing the house-level map until the areas are ready, then sees "Edited". On a report that's taken down, they see the areas when you put it back up.
- **Turning on a house-level map**, or changing the area size, on a published report means **Refresh numbers**. Choose **House-level map** there and tick **Use a house-level map on this report** under the same warning.

## Reports from before November 2026

Reports used to show exact doors by default. In November 2026 Doorline switched every existing report to small areas, once. The numbers didn't change and your client wasn't shown "Edited"; the report's History says "Map switched to areas by Doorline (privacy update)". To show a report house by house again, turn its house-level map on (on a published report, with **Refresh numbers**).

For the rest of the report, see [Client reports and share links](client-reports).
