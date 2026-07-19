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

If your team has **hand-corrected** any voter info (say, a phone number confirmed at the door), the preview also lists every hand edit this file would change. **Your edits are kept by default** — the file updates everything else. To take the file's values instead, tick **Overwrite these hand edits with the file's values** on the review screen; that replaces the listed values and can't be undone.

**Corrected map pins are protected the same way.** If someone dragged a door's pin to where the house actually is, a later import **won't snap it back** to the file's coordinates — the person standing at the door knew better than the file. Everything else about that address still updates normally. The same **Overwrite** tick box also releases the pins, so it's one decision: keep what your team corrected, or let the file win.

## What goes live, and what waits

- A **new voter at a door a walk list already owns** joins that door automatically — **if that door hasn't been knocked yet.** The canvasser sees them when they reach it.
- A **new voter at a door you've already knocked or surveyed** is different: the door reads "done," so nobody is sent back and the new voter would be missed. Tick **"Revisit already-worked homes that gain a new voter"** on the import review screen — the import bundles those homes into a walk list and shows **Create revisit walk list →** in the summary, so you can cut a fresh round and go back. Because it's a new round, the revisit **counts as a knock**.
- A **new address** lands in **Intake** and is **not** canvassed until you assign it to a walk list.

> Heads up: Claiming a door into a walk list is only step one — a claimed door isn't visible to canvassers until it's cut into a book and assigned. To add a second file's new doors to the field, Claim them, then on **Turf Cutting** use **Add new doors** to cut a supplemental book, Accept, and Assign.

More on that flow in [I uploaded a second voter file — now what?](add-a-second-voter-file).
