---
slug: page-tags
title: The Tags page
audience: admin
kind: page
order: 115
sourceDoc: SURVEYS.md
summary: Your organization's tag library — create, rename, merge, and delete the tags your surveys use, with usage counts so nothing breaks silently.
tags: tags, library, rename, merge, delete, supporters, page
---

The **Tags** page (in the org sidebar) is your organization's tag library — the one list every survey builder picks from. Keeping it here, instead of typed fresh into each survey, is what stops "Supporter," "supporter," and "Suporter" from becoming three different counts.

Each row shows the tag and a **usage summary** — how many answer options carry it, across how many surveys, and how many saved searches filter by it — so you can see what an edit touches before you make it.

## What you can do

- **Create** a tag up front, or just let the survey builder create it the first time you use one. Names are case-insensitive — creating "SUPPORTER" when "Supporter" exists gives you the existing tag, never a duplicate.
- **Rename** — the new name is rewritten **everywhere at once**: every survey option, every survey's tag list, every saved-search "by tag" filter. Reports and lists keep working under the new name. If the name you type already exists, the page offers to **merge** instead.
- **Merge** two tags into one — pick the target and the source's options, surveys, and saved searches all fold into it, then the duplicate is removed. Their counts combine from then on.
- **Delete** — the tag is removed from the library and **untagged everywhere** it was used. Any report or saved search using it stops matching, so read the usage summary first.

## Where tags show up

Once options carry tags, they surface in four places: the campaign's **survey results** (each tag's [identified and still-current voters](how-do-i-count-supporters), plus a by-team split), the **Survey Explorer**, **saved searches** (the "By tag" filter for re-canvass and export lists), and — only when explicitly ticked — **[client reports](client-reports)**.

Two boundaries worth knowing: tags are **admin-managed** — team leads pick from this library in the builder but can't add to it — and canvassers **never see tags** at the door.
