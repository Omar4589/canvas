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

**If your Excel file has several tabs, only the first one is imported** — the leftmost tab you can see (hidden sheets are skipped; note it isn't always the tab Excel opens on, which is whichever one was showing when the file was last saved). Extra `Summary` or `README` tabs after the data are simply ignored. The **Map columns** step names the tab it read and lists the ones it skipped, so you can check it picked the right one. If your voter data is on a different tab, move that tab to the front of the workbook and upload again.

## How an upload is matched

- A row matches an existing **door by its address** (after light normalization). A different or misspelled address becomes a separate door.
- A row matches a **voter by their state Voter ID, within the campaign you're importing into**. Re-uploading the same voter updates them in place — imports are safe to repeat.
- **Running more than one campaign?** Each campaign gets its **own copy** of every voter and door it imports. Two campaigns can upload overlapping — even identical — files and neither disturbs the other: separate doors, separate books, separate counts. The person stays one person to your organization (a **Do not contact** set anywhere applies everywhere, and they appear once in the org-wide Voters directory), but each campaign works its own copy.

## Preview before you commit

After you map the columns, click **Preview changes** to see exactly what the import will do — new vs. existing doors, new vs. updated voters, voters that would change doors, and near-duplicate addresses — before you **Confirm & import**.

If your team has **hand-corrected** any voter info (say, a phone number confirmed at the door), the preview also lists every hand edit this file would change. **Your edits are kept by default** — the file updates everything else. To take the file's values instead, tick **Overwrite these hand edits with the file's values** on the review screen; that replaces the listed values and can't be undone.

**Corrected map pins are protected the same way.** If someone dragged a door's pin to where the house actually is, a later import **won't snap it back** to the file's coordinates — the person standing at the door knew better than the file. Everything else about that address still updates normally. The same **Overwrite** tick box also releases the pins, so it's one decision: keep what your team corrected, or let the file win.

## Big files, and what the stages mean

Files are analyzed **in the background** — even a very large file won't time out, and **refreshing the page doesn't lose a running import**; it picks the job back up where it was. While a job waits its turn the button reads **"Queued — waiting for a worker"** with a clock, and a **Cancel** button can pull back a job that hasn't started yet (one that's already running can't be cancelled).

Uploads are capped at **50 MB and 300,000 rows**. If your file is bigger, split it — **by county is usually the natural cut** — and upload each piece; imports are safe to repeat, so the end result is the same.

While an import runs you'll see its stage:

- **Parsing** — reading and checking the file's rows.
- **Geocoding** — looking up map coordinates for addresses that arrived without them. This only appears when some addresses actually need it.
- **Linking** — connecting each voter to your organization's people records. On very large files this is the longest step before writing, and it deliberately shows no percentage.
- **Importing** — writing doors and voters, with live progress.

**A stuck import fails with a message instead of spinning forever.** If the import system dies mid-job — or never picks the job up — the import marks itself **Failed within a few minutes**, and the message says which happened. More on what's normal vs. stuck: [My import has said Analyzing or Linking for a while — is it stuck?](import-taking-long)

## What goes live, and what waits

- A **new voter at a door a walk list already owns** joins that door automatically — **if that door hasn't been knocked yet.** The canvasser sees them when they reach it.
- A **new voter at a door you've already knocked or surveyed** is different: the door reads "done," so nobody is sent back and the new voter would be missed. Tick **"Revisit already-worked homes that gain a new voter"** on the import review screen — the import collects those homes into a [saved search](saved-searches) named after your file ("New voters — …"), and the summary shows **Create revisit walk list →**, which starts a new walk list from exactly those doors so you can cut a fresh round and go back. Because it's a new round, the revisit **counts as a knock**.
- A **new address** lands in **Intake** and is **not** canvassed until you assign it to a walk list.

> Heads up: Claiming a door into a walk list is only step one — a claimed door isn't visible to canvassers until it's cut into a book and assigned. To add a second file's new doors to the field, Claim them, then on **Turf Cutting** use **Add new doors** to cut a supplemental book, Accept, and Assign.

More on that flow in [I uploaded a second voter file — now what?](add-a-second-voter-file).
