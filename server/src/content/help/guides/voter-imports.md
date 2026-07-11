---
slug: voter-imports
title: Uploading a voter file
audience: lead
kind: guide
order: 10
sourceDoc: IMPORTS.md
summary: How a voter file matches your existing doors, what goes live, and what waits in Intake.
tags: import, voters, intake
---

**Voter Import** lives inside a campaign — open the campaign, then pick **Voter Import** in the sidebar. You can upload a `.csv` or `.xlsx` directly, and you can upload **more than one file** over the life of a campaign.

## How an upload is matched

- A row matches an existing **door by its address** (after light normalization). A different or misspelled address becomes a separate door.
- A row matches a **voter by their state Voter ID**. Re-uploading the same voter updates them in place — imports are safe to repeat.

## Preview before you commit

After you map the columns, click **Preview changes** to see exactly what the import will do — new vs. existing doors, new vs. updated voters, voters that would change doors, and near-duplicate addresses — before you **Confirm & import**.

## What goes live, and what waits

- A **new voter at a door a walk list already owns** joins that door automatically.
- A **new address** lands in **Intake** and is **not** canvassed until you assign it to a walk list.

> Heads up: Claiming a door into a walk list is only step one — a claimed door isn't visible to canvassers until it's cut into a book and assigned. To add a second file's new doors to the field, Claim them, then on **Turf Cutting** use **Add new doors** to cut a supplemental book, Accept, and Assign.

More on that flow in [I uploaded a second voter file — now what?](add-a-second-voter-file).
