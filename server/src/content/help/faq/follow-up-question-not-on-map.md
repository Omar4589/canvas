---
slug: follow-up-question-not-on-map
title: Why can't this follow-up question go on the map?
audience: lead
kind: faq
order: 83
sourceDoc: CLIENT_PORTAL.md
summary: A question asked only after a certain answer would show, door by door, who gave that answer. So it can go on a client report's map only together with the question it follows.
tags: client report, map, follow-up question, map filter, show only if, hidden question, privacy, yard sign, greyed out, can't tick
---

Because putting it on the map would give away the answers to the question it follows.

Say your survey asks **"Back the recall?"** and then, only to people who said Yes, **"Could we put a yard sign up?"**. Only recall supporters ever answer the yard-sign question. If its answers were on the map, every home with a yard-sign answer would be a home that said Yes to the recall, even if you'd hidden "Back the recall?" from your client.

So in the report builder, a follow-up question's **Map** box works only when the question it follows is on the map too. The row says why: *"Asked only on some paths through 'Back the recall?' — mapping it shows who took that path."*

## What you can do

- **Leave it off the map.** Usually the best choice. Its **chart** is still yours to show, and the builder warns you before you publish if that chart hints at a hidden question.
- **Put both on the map**, if you're happy for your client to see the first question's answers door by door too.
- **Use areas instead of exact doors** if the worry is showing answers at street addresses. See [Should my client report show exact doors or areas?](exact-doors-or-areas)

## Other reasons the Map box won't tick

- **Its chart is hidden.** A question whose chart your client can't see can't go on the map either.
- **It follows a written answer.** Written answers never go on a client's map, so neither do questions asked only after one.
- **The survey used to ask it that way.** If the question was ever asked only after another answer, even in an earlier version of the survey, the rule still applies: some of the answers on file were collected that way. Doorline has kept this record since October 2026. For survey versions older than that it can't know, so when such answers could reach the map beside a question you hide, **Before you publish** says so: check your map questions.
- **The report was published before October 2026.** Its map follows the rules of every survey the campaign's answers came from, so a question one of them asked as a follow-up stays off that report's map until you refresh its numbers, even if today's survey asks it of everyone.
- **The report is already published.** You can take a question off a published report's map with **Edit**, but adding one goes through **Refresh numbers**.

For the rest of the builder, see [Client reports and share links](client-reports).
