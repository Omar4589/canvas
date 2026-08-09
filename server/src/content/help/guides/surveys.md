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

## Letting people answer in their own words: "Other (specify)"

On any choice question, tick **Other (specify)**. At the door the canvasser gets an extra **Other** choice, and picking it opens a small box to type what the person actually said. You keep the clean option counts *and* the verbatim wording.

Those write-ins are tracked like any other answer:

- Survey results show an **Other** bar next to your real options.
- Click it and you get the list of people who wrote something in, **each row showing what they typed**.
- You can filter the map to Other, and exports spell it out as `Other — potholes`, so a write-in is never confused with a real option that happens to use the same word.
- On a voter's page you can read the typed text, and change or clear it like any other answer.

**Clients never see the words.** On a client report, every write-in is merged into a single **Other** row with its count intact — a client learns how many people said something else, never what any of them said.

Two things worth knowing:

- It's a **question setting, not an option** — you won't find "Other" in the list of options you typed, and you don't need to add it there.
- If you also create your own option called "Other", both work and stay separate; the write-in then reads **Other (specify)** so you can tell them apart. Usually that means you want one or the other, not both.

## Branching and tags

Any question after the first can be set to **Show only if...** an earlier answer matches — the app builds branch, skip, and skip-to-end flows from that one rule. Hidden questions never show at the door and their answers aren't saved.

**Tags** are short labels (like "Supporter") you stick on answer options across different questions, so a report or a [saved search](saved-searches) can roll up everyone who matched — no double-counting. Canvassers never see tags.

## Different surveys for different groups

Most campaigns use one survey for everyone. When a group needs different questions, a **walk list can override the campaign default** with its own — set it on the Survey tab's coverage table or on the Walk Lists page. Each door gets the right questions automatically. See [Running more than one survey](multiple-surveys).

## Auditing answers — who chose it, who recorded it

Counts tell you *how many* picked an answer; the drill tells you **who**. On the campaign Home, click any answer in the survey results: every entry shows the voter, the address, **which canvasser recorded it and exactly when**, any note, and an Offline badge if it synced later. Click an entry for the full response — including an *"Edited by …"* line if an admin changed it.

For the full workbench, open the campaign's **Survey Explorer** tab: filters (question, answer, canvasser, walk list, dates), a **By canvasser** ranking ("who's entering Opposed the most, and how much of their own answers is that?"), a map of exactly the matching doors, and a CSV export of the drill. See [The Survey Explorer page](page-survey-explorer) and [How do I see who recorded a survey answer?](who-entered-an-answer).

## Who can edit what

If you're a **team lead**, you can build new surveys and edit or duplicate the ones you authored or that are attached to a campaign you manage — that covers everything above. **Your library is exactly that set**: the survey list and every picker show your own surveys and the ones already on your campaigns, nothing else in the organization.

Two things follow from that. **Be careful swapping away an admin-built survey**: once it's detached from your last campaign using it, it leaves your library and only an admin can bring it back — if you just want different questions, **Duplicate** it first and edit your copy. And if a survey you share shows "**also used elsewhere in your organization**," edits apply there too — same answer: Duplicate before you change it.

Two things stay with org admins: **archiving or deleting** a survey template, and the **tag library** — you pick from existing tags in the builder but can't create new ones. If an option is missing a tag you need, ask an admin to add it.

## Editing a live survey

Once a survey has responses you can still edit almost everything freely — rename it, reword questions, rename options, reorder, add, or remove. Removed items are quietly retired, so past answers keep reporting.

> Heads up: The one change you can't make is a question's **answer type** (like single-choice to text). To change it, use **Duplicate** to make a fresh copy and point your campaign at that.
