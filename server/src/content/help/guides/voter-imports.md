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

**Voter Import** lives inside a campaign — open the campaign, then pick **Voter Import** in the sidebar. You can upload a `.csv`, an `.xlsx`, or any delimited text export (`.txt`, `.tsv`) directly — the separator is worked out for you — and you can upload **more than one file** over the life of a campaign. A file named `.xls` is usually delimited text and imports normally; if it turns out to be a genuine Excel 97–2003 workbook the upload is refused with the fix (Save As `.xlsx`) — see [My voter file is a .xls — can I upload it?](xls-file-wont-upload).

**If your Excel file has several tabs, only the first one is imported** — the leftmost tab you can see (hidden sheets are skipped; note it isn't always the tab Excel opens on, which is whichever one was showing when the file was last saved). Extra `Summary` or `README` tabs after the data are simply ignored. The **Map columns** step names the tab it read and lists the ones it skipped, so you can check it picked the right one. If your voter data is on a different tab, move that tab to the front of the workbook and upload again.

**Some files pack a whole household into one row** — numbered columns like `FirstName1..4` and `FLVoterId1..4`, one set per person. The importer spots these by the numbered voter-ID columns (the number can sit anywhere in the name, and capitalization doesn't matter) and offers an **Explode multi-member rows** toggle (on by default) that splits each row into one voter per person — the preview counts update live. Precinct and district values stated once per row fill down to everyone at the door (they're facts about the address); party and gender never do (they're facts about each person). If a file *looks* like it packs several voters per row but the columns are named in a way the importer can't read, the preview shows a **red warning** instead of quietly importing only the first voter in each row — what it means and how to fix it: [My file has more rows than the doors the import reports](fewer-doors-than-file-rows).

## How an upload is matched

- A row matches an existing **door by its address** (after light normalization). A different or misspelled address becomes a separate door.
- A row matches a **voter by their state Voter ID, within the campaign you're importing into**. Re-uploading the same voter updates them in place — imports are safe to repeat.
- **Running more than one campaign?** Each campaign gets its **own copy** of every voter and door it imports. Two campaigns can upload overlapping — even identical — files and neither disturbs the other: separate doors, separate books, separate counts. The person stays one person to your organization (a **Do not contact** set anywhere applies everywhere, and they appear once in the org-wide Voters directory), but each campaign works its own copy.
- **Rows are people; doors are addresses.** Several voters usually share an address, every apartment unit is its own door, and a second file reuses the doors an earlier file already created — so an import always reports fewer doors than the file has rows. In the **Recent imports** table, **Voters** is rows imported, **Households** is distinct addresses in the file, **New** is what *this* file created, **Moved / Emptied** is voters who changed address and doors left empty, and **Errors** is skipped rows. See [My file has more rows than the doors the import reports](fewer-doors-than-file-rows).

## Preview before you commit

After you map the columns, click **Preview changes** to see exactly what the import will do — new vs. existing doors, new vs. updated voters, voters that would change doors, and near-duplicate addresses — before you **Confirm & import**. The preview also says plainly how many of the file's rows will import, and lists every skipped row with its reason.

**If the file's Voter ID column is broken, the preview says so in red.** Some vendor files arrive with a spreadsheet error — the literal text `=#NUM!` or `#REF!` — where the ID should be, because a formula failed before the file was exported. Those rows are skipped, the preview names the repeated values and how many rows each one costs, and if more than a fifth of the file would be skipped, **Confirm & import** stays off until you tick **Import anyway**. Usually the right move instead is **Back** → map a different column that uniquely identifies each person (a vendor ID) as State Voter ID — or ask whoever sent the file to re-export it with the IDs fixed. See [My file shows =#NUM! or #REF! where the Voter IDs should be](file-shows-spreadsheet-errors).

If your team has **hand-corrected** any voter info (say, a phone number confirmed at the door), the preview also lists every hand edit this file would change. **Your edits are kept by default** — the file updates everything else. To take the file's values instead, tick **Overwrite these hand edits with the file's values** on the review screen; that replaces the listed values and can't be undone.

**Corrected map pins are protected the same way.** If someone dragged a door's pin to where the house actually is, a later import **won't snap it back** to the file's coordinates — the person standing at the door knew better than the file. Everything else about that address still updates normally. The same **Overwrite** tick box also releases the pins, so it's one decision: keep what your team corrected, or let the file win.

**When two rows disagree about where a house is.** Several voters usually share an address, so several rows in your file become one door — and they're supposed to carry the same coordinates. Sometimes they don't. Rows within about 150 metres of each other aren't really disagreeing (that's a rooftop versus a driveway) and the first one stands. Past that, a coordinate that isn't even inside the state loses, and otherwise **the most rows win** — one bad row can't outvote the good ones. If it's a true tie, the door keeps the first pin and the preview tells you: *"N addresses had rows disagreeing about where the house is, with nothing to settle it."* That's worth a look, but it isn't a reason to stop the import — a house with a suspect pin is still better than a house that didn't import. If you think a door ended up in the wrong place, tell your Doorline contact: there's an audit they can run that finds mis-pinned doors and corrects them from the address.

**When many houses land on one dot.** Some vendors stamp a placeholder coordinate on addresses they couldn't place — the middle of a ZIP code, say — so unrelated houses from different streets pile onto one exact spot on the map. The preview now warns you: *"N doors sit on an exact map spot shared with doors from other addresses."* Those doors still import and are still walkable; they're just drawn in the wrong place, and turf cutting's Remove apartments may mistake the pile for an apartment building and leave real houses out of your books. If you see that warning, ask your Doorline contact to run the pin repair before you cut turf.

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

> Heads up: Claiming a door into a walk list is only step one — a claimed door isn't visible to canvassers until it's cut into a book and assigned. To add a second file's new doors to the field, Claim them, then on **Turf Cutting** use **Add as new book** to cut a supplemental book, Accept, and Assign.

More on that flow in [I uploaded a second voter file — now what?](add-a-second-voter-file).
