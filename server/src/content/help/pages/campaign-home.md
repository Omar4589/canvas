---
slug: page-campaign-home
title: The campaign Home (dashboard)
audience: lead
kind: page
order: 100
sourceDoc: CAMPAIGNS.md
summary: What the campaign dashboard shows and when to use it.
tags: dashboard, home, metrics
---

The campaign **Home** is your dashboard — the first screen when you drill into a campaign. It does two jobs depending on where the campaign is in its life.

## Before you're live

While you're still setting up, Home shows the **Setup progress** card: an ordered checklist with a highlighted next step and deep links to each screen. It's non-blocking — you can jump anywhere — but it's the fastest way to see what's left before canvassers can start.

## Once you're live

After the first pass is activated and knocks start coming in, Home becomes a **monitoring dashboard**: households, houses knocked, knocks, active canvassers, and a coverage bar — filterable by date range, by walk list, and by **crew**. On a **survey** campaign you'll also see surveys and a connection rate; on a **lit-drop** campaign, lit drops and a lit rate instead.

## Filter by crew

Once your campaign has coordinators, a **coordinator filter** appears next to the walk-list one (a dropdown on the web, a pill row in the app — the same control the Timeline has). Leave it on **All coordinators** for everyone's numbers, pick a coordinator to see just their crew's, or pick **No coordinator** for people who aren't on any crew. A coordinator's own door-knocking counts toward their crew.

Everything activity-based follows it — the activity numbers, the By pass table and its CSV export, the survey results (the Tags panel included) and their drill-ins, and the canvasser list. The one exception is **Coverage**: doors don't belong to a crew, so coverage always shows the whole campaign's progress, and its caption says so while a crew is selected.

## "How these are counted"

Not sure whether a number means houses or people? In the **mobile app**, the Activity list ends with a **How these are counted** line. Tap it and a panel slides up explaining every number in the group — using your actual figures, not examples — along with what the connection rate's colors mean and where the target sits. There's a matching line under **Top canvassers** for that table's columns.

Two of the numbers also carry a small grey word telling you the unit: **Survey doors** counts *houses*, **Surveyed voters** counts *people*. They're usually different, because one house can hold several voters. And the connection rate says its verdict in words next to the percentage — *On target*, *Watch*, or *Low* — with the fraction it came from, so you can check it against the two numbers printed just above.

## The By pass breakdown

Below the activity numbers, the **By pass** section lists one row per walk list and pass (Pass 1, Pass 2, …) for the selected date range — knocks, survey doors (or lit drops), the connection rate, and **New homes reached** — with a TOTAL row that always matches the Knocks number above it.

**New homes reached** counts a home only in the pass of its **first-ever** knock: going back to a Pass-1 door in Pass 2 adds a knock, not a new home. So the column shows what each pass added to your coverage. With a crew selected, "first-ever" is still judged campaign-wide — a home counts for the crew only if that crew made its very first knock, so a door another crew reached first is never a "new home" here. Knocks recorded before the campaign had passes appear as one "Legacy / no pass" row.

**Export CSV** downloads the same table, TOTAL row included — pick the date range first, since the export uses it. See [Understanding the numbers](metrics) for how each column is counted.

## Drill into a survey answer

In the survey results, **click any answer** to see the entries behind its count — each one names the voter, the address, **who recorded it and at what time**, any note, and an Offline badge if it synced later. Click an entry for the full response, flip to **By canvasser** to see who's been recording that answer, or click **Open full view** to take the drill to the [Survey Explorer](page-survey-explorer) with a map and export.

The section header also has a **pass picker** once your campaign has more than one pass — pick one to scope every survey number on the section (the Tags panel and the drills included) to that round; each round adds up to the all-rounds view.

If your survey uses **tags**, a **Tags** panel sits above the question charts: each tag shows **voters identified** and how many are **still current**, and clicking one opens its voters plus a **By team** table — the team that found each voter first gets the credit, so the rows add up exactly to the campaign line. See [How do I count our supporters?](how-do-i-count-supporters).

> Tip: Use the walk-list filter to see one operation's numbers, or the coordinator filter to see one crew's — or combine them. Leave them on "All walk lists" / "All coordinators" for the whole-campaign totals. Everything activity-based on the page follows both — including the survey-answer drill, so the entries behind a count always match the count.
