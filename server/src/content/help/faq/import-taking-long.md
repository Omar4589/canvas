---
slug: import-taking-long
title: My import has said Analyzing or Linking for a while — is it stuck?
audience: lead
kind: faq
order: 21
sourceDoc: IMPORTS.md
summary: What each import stage does, how long is normal, and how a genuinely stuck import tells you.
tags: import, stuck, linking, geocoding, worker
---

Probably not stuck — big files genuinely take a while, and the stage label tells you what's happening:

- **Queued — waiting for a worker** (with a clock): the job hasn't started yet. It's waiting its turn behind other jobs — or, if the clock keeps climbing past a couple of minutes, the import system isn't picking work up at all (see below). This is the one state with a **Cancel** button.
- **Parsing**: reading and checking every row of the file.
- **Geocoding**: looking up map coordinates for addresses that arrived without them. Shows a percentage, and only appears when some addresses actually need it.
- **Linking**: connecting each voter to your organization's people records. **On very large files this is the longest stage before writing, and it deliberately shows no percentage** — the label sitting still is normal, not frozen.
- **Importing**: writing doors and voters, with live progress.

**How long is normal?** A typical file finishes in well under a minute. A very large one — hundreds of thousands of rows, or one that needs lots of geocoding — can take several minutes, most of it in Geocoding and Linking. Refreshing the page is safe; it picks the running job back up.

**You never have to guess whether it's dead.** A genuinely stuck import **fails itself within a few minutes** with a message that says which of two things happened:

- **"No import worker picked this up"** — the background import system is off. The page's **worker-offline banner** will usually be showing too. This isn't something the file caused or a retry will fix; if it doesn't clear in a few minutes, contact whoever operates your Doorline server (for most teams, Doorline support).
- **"The import worker stopped responding mid-job"** — the system died partway through, usually on an unusually heavy file. Try the import again; if it happens repeatedly on the same file, split the file (by county is the natural cut) and upload the pieces — imports are safe to repeat, so the end result is the same.

Either way nothing half-imports silently: a failed import says so in the history with the reason, and re-running the same file just refreshes the rows it already wrote.
