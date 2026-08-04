---
slug: page-voter-import
title: The Voter Import page
audience: lead
kind: page
order: 102
sourceDoc: IMPORTS.md
summary: Upload a voter file, preview the changes, and import.
tags: import, voters, page
---

The **Voter Import** tab is where you upload a voter file (CSV or Excel). After you map the columns, you preview exactly what will change — new vs. existing doors, updated voters, and any near-duplicates — then confirm the import. New addresses land in Intake until you claim them into a walk list. On the review screen you can also tick **"Revisit already-worked homes that gain a new voter"** — if the file drops a new target voter into a home you've already knocked, those homes are collected into a saved search, and the summary's **Create revisit walk list →** turns it into a walk list you can cut a fresh round from.

**What the states mean.** Analysis and imports run in the background, so the page shows where the job is: **Queued — waiting for a worker** (with a clock — it hasn't started yet; a **Cancel** button can pull it back at this point), then **Parsing** (reading the file), **Geocoding** (only if some addresses need coordinates looked up), **Linking** (matching voters to your organization's people records — the longest stage on big files, no percentage on purpose), and **Importing** (writing, with live progress). Refreshing the page doesn't lose a running job. If an import **fails**, the red message says why — including when the import system stopped responding mid-job or never picked the job up, in which case the import fails itself within a few minutes rather than spinning forever.

For the full walkthrough, see [Uploading a voter file](voter-imports). If a stage seems to sit still, see [My import has said Analyzing or Linking for a while — is it stuck?](import-taking-long)
