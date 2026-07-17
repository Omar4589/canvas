---
slug: surveys
title: Building and assigning surveys
audience: lead
kind: guide
order: 11
sourceDoc: SURVEYS.md
summary: Build a survey, attach it to a campaign, run different surveys per walk list, and edit it safely.
tags: surveys, questions, branching, tags, walk lists, editing
---

A **survey** is the questionnaire your canvassers run at the door. You build it once, then attach it to a campaign — and canvassers on that campaign start seeing it.

## Build a survey

Open a campaign and pick **Survey** in the sidebar, then click **New survey**. Give it a name, write a short **intro** and **closing** for the canvasser to read, then add questions. Each question is **single choice**, **multiple choice**, or **text**, and can be marked **required**. The builder opens right inside the campaign and returns you here when you save.

If the campaign has no survey yet, the one you build becomes its default. If it already has one, your new survey is added to your library so you can assign it to specific doors — a new survey never silently replaces the default.

## Branching and tags

Any question after the first can be set to **Show only if...** an earlier answer matches — the app builds branch, skip, and skip-to-end flows from that one rule. Hidden questions never show at the door and their answers aren't saved.

**Tags** are short labels (like "Supporter") you stick on answer options across different questions, so a report or a [saved search](saved-searches) can roll up everyone who matched — no double-counting. Canvassers never see tags.

## Different surveys for different groups

Most campaigns use one survey for everyone. When a group needs different questions, a **walk list can override the campaign default** with its own — set it on the Survey tab's coverage table or on the Walk Lists page. Each door gets the right questions automatically. See [Running more than one survey](multiple-surveys).

## Auditing answers — who chose it, who recorded it

Counts tell you *how many* picked an answer; the drill tells you **who**. On the campaign Home, click any answer in the survey results: every entry shows the voter, the address, **which canvasser recorded it and exactly when**, any note, and an Offline badge if it synced later. Click an entry for the full response — including an *"Edited by …"* line if an admin changed it.

For the full workbench, open the campaign's **Survey Explorer** tab: filters (question, answer, canvasser, walk list, dates), a **By canvasser** ranking ("who's entering Opposed the most, and how much of their own answers is that?"), a map of exactly the matching doors, and a CSV export of the drill. See [The Survey Explorer page](page-survey-explorer) and [How do I see who recorded a survey answer?](who-entered-an-answer).

## Editing a live survey

Once a survey has responses you can still edit almost everything freely — rename it, reword questions, rename options, reorder, add, or remove. Removed items are quietly retired, so past answers keep reporting.

> Heads up: The one change you can't make is a question's **answer type** (like single-choice to text). To change it, use **Duplicate** to make a fresh copy and point your campaign at that.
