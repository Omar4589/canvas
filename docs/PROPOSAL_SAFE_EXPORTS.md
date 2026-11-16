# Proposal: Exports that can't crash the worker or get stuck

> **Status: PLAN v1, 2026-11-16. Not built.** The owner's ask, the same day: campaigns are archived and
> read-only after the election, but customers can still export their data at any time (and an ended
> customer has 60 days to export, privacy.html "After termination"), so no export, at any campaign size,
> may crash the worker or be left stuck. This comes before the import and parked-ID work
> ([PROPOSAL_IMPORT_QUEUE.md](PROPOSAL_IMPORT_QUEUE.md), [PROPOSAL_PARKED_IDS.md](PROPOSAL_PARKED_IDS.md)),
> because nothing is importing now and an export can start at any moment. A server deploy only. Line
> references are to HEAD `9558a1b`.

What this covers: what happens today when an export is too big for the worker or the worker restarts
under it, the three fixes (exports read in small batches; an export that stops reads Failed instead of
Building forever; half-written files are always deleted), the tests, the memory measurements that decide
the worker's size, and the privacy record.

Related: [EXPORTS.md](EXPORTS.md) (the Export Center), [PERFORMANCE.md](PERFORMANCE.md),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md), [PROPOSAL_IMPORT_QUEUE.md](PROPOSAL_IMPORT_QUEUE.md)
(the same questions for imports).

---

# Part 1 — For everyone

## What goes wrong today

1. **Some exports hold a whole round's doors in memory at once.** Doors by round does, and so does the
   Full backup, which contains it. (The full list is in §B.) On the smaller worker you want to move to,
   a big enough campaign runs it out of memory. Measured 2026-11-16 at the smaller worker's limit: a Full
   backup of a 107,000-door campaign finished with little room to spare; at 160,000 doors it barely
   finished, after two minutes of struggling; Doors by round at 250,000 doors crashed the worker.
2. **When the worker runs out of memory, everything it was doing stops and starts over,** not just the
   export: another customer's export, a client report being built, the nightly cleanup.
3. **An export that crashes the worker is retried once by itself. If it crashes again, it says Building
   forever.** The customer can't delete it, it takes one of the organization's 3 export slots, and it
   blocks deleting that campaign. The Exports page keeps checking on it every second and a half for as
   long as the page is open.
4. **A crash leaves pieces of the half-written file in the database that nothing ever finds** — not the
   7-day expiry, not the nightly cleanup, not even an organization's deletion. Our privacy record says
   leftovers are cleaned up; for crash leftovers that isn't true. The same thing happens to an uploaded
   voter file if the website's server restarts in the middle of the upload.

## What changes

1. **Every export reads its data in small batches,** so its memory stays about the same whatever the
   campaign's size. Checked at the smaller worker's limit with campaigns bigger than any customer has.
2. **An export that stops before it finishes says Failed, with a plain reason and the Retry button,**
   within about a minute of the worker coming back — never Building forever. Exports already stuck that
   way are fixed the same way when this ships. And an export that hit a passing error and is about to
   retry by itself says Queued, not Failed.
3. **Half-written pieces are always deleted:** when the export retries, when it fails, and by the
   nightly cleanup, which also clears any old pieces left from before this fix — for exports and for
   uploaded voter files.

## What stays the same

- What's in every file, row for row. Who can export, the 7-day download window, 3 exports at a time per
  organization, the 60-day read-only window.
- An export interrupted by a deploy or a server restart still starts over by itself, once.
- **No phone update.** The website and the app already show Failed with a Retry button; only the server
  changes.

## Privacy

Nothing new is collected, nobody new sees anything, no new service is involved. The change makes two
sentences in our privacy record true again: leftovers from failed exports are cleaned up, and nothing
from an export outlives the organization. No Privacy Policy, Terms or DPA wording changes.

---

# Part 2 — Technical reference

## A. Today, code-verified

### A.1 The pipeline

- **Create:** `POST /api/admin/exports` creates the `ExportJob` and adds a BullMQ job whose id is the
  doc's id ([routes/admin/exports.js:139-153](../server/src/routes/admin/exports.js)). The queue's
  default options apply: `attempts: 3`, exponential backoff from 5 s, `removeOnComplete` after 7 days,
  `removeOnFail` after 30 days ([queues/index.js:46-51](../server/src/queues/index.js)).
- **Worker:** one `export-queue` Worker, `concurrency: EXPORT_JOB_CONCURRENCY || 1`, with no
  `lockDuration` or `maxStalledCount` of its own ([worker.js:160-163](../server/src/worker.js)), so
  BullMQ 5.77.6's defaults hold: a 30 s lock and **one** stall recovery
  (`node_modules/bullmq/dist/esm/classes/worker.js:31`).
- **Processor** ([services/export/exportProcessor.js:155-308](../server/src/services/export/exportProcessor.js)):
  a deleted, completed or canceled doc is a no-op (:157-159); `deleteArtifact(doc._id)` clears a prior
  attempt's file (:163); the doc is reset to `running` (:171-181); the builder streams into one GridFS
  upload (:245-267); success stamps `completed` (:271-287). The catch (:288-307) aborts the upload,
  deletes the artifact and marks the doc `failed` with a message **on every failed attempt**, then
  rethrows (`UnrecoverableError` for an `ExportUserError`, which fails the same way every time).

### A.2 What a crash does

A V8 heap abort, an R15 or a SIGKILL skips the catch, so the doc stays `running`.

1. The job's lock lapses after 30 s. The restarted worker's stall check moves it back to waiting
   (stalled count 1, within the limit of 1) and the export runs again from the top.
2. If it crashes again, the stall check finds a count of 2 and stores a deferred failure, "job stalled
   more than allowable limit" (`commands/moveStalledJobsToWait-8.lua:87-90`). The next worker to pick
   the job up fails it as an `UnrecoverableError` without running the processor (`classes/worker.js:578-582`,
   `:612-615`), and the Worker emits `failed`.
3. The export Worker's only `failed` listener logs (worker.js:204). **The doc stays `running` forever.**
   Imports, campaign deletes, org deletes, conversions, answer edits and client reports each reconcile
   their record on that event (worker.js:214-318); exports have no reconcile.

A deploy is the same story with a gentler start: the shutdown drain waits at most 25 s
(worker.js:322-350), so a longer export is abandoned, stalls, and uses up its one recovery.

### A.3 What a stuck export blocks

| What | Where |
|---|---|
| Delete: 409 "Export is running — wait for it to finish." | routes/admin/exports.js:378-380 |
| The per-org throttle counts `pending` + `running`; 3 stuck exports mean 429 for every new export | routes/admin/exports.js:128-137 |
| Campaign delete: 409 `campaign-busy` | routes/admin/campaigns.js:891-900 |
| Staff org delete: 409 `org-busy` | routes/superAdmin/organizations.js:689-697 |
| Polling: web every 1.5 s, phone every 2 s, while any job is `pending`/`running` | client/src/pages/ExportsPage.jsx:375-378; mobile/app/(app)/admin/exports.jsx:125-127 |

The retention-path org deletions don't check exports (on purpose: a legally required deletion is never
deferred). The nightly `sweepExpiredExports` never looks at `pending` or `running` docs
([services/export/sweepExpiredExports.js:18-50](../server/src/services/export/sweepExpiredExports.js)).

Both clients already handle `failed`: the web row shows `job.error` with Retry and Delete
(ExportsPage.jsx:994-996, :1028-1031), the phone shows the error with Retry (admin/exports.jsx:200-202).

### A.4 Half-written files

The MongoDB driver (6.20.0) writes a GridFS file's `.files` document only after its last chunk
(`node_modules/mongodb/lib/gridfs/upload.js:186-194`); `abort()` deletes the chunks written so far
(:117-128). A killed process gets to neither, so its chunks stay with no `.files` document. Every cleanup
finds files through `.files`:

- exports: `deleteArtifact` by filename
  ([services/export/exportArtifactStore.js:36-43](../server/src/services/export/exportArtifactStore.js) —
  its comment says a half-written file from a crashed attempt is handled; it can't be found),
  the three passes of `sweepExpiredExports`, and `deleteArtifactsForScope` by metadata (:69-92), which
  the campaign and org delete cascades call
  ([services/campaigns/deleteCampaign.js:204](../server/src/services/campaigns/deleteCampaign.js),
  [services/platform/deleteOrganization.js:156](../server/src/services/platform/deleteOrganization.js));
- uploaded voter files: `deleteRawImport` by filename
  ([services/import/rawImportStore.js:52](../server/src/services/import/rawImportStore.js)) and the
  raw-file pass of `sweepStaleImportJobs`
  ([services/import/sweepStaleImports.js:81-95](../server/src/services/import/sweepStaleImports.js)).
  The web dyno pipes each upload into GridFS (`saveRawImportFromFile`, rawImportStore.js:28-35, called
  from routes/admin/imports.js:244, :324, :373), so a web restart mid-upload leaves the same orphans.

So a crash leftover — slices of an export file, or of a whole voter file — stays forever and survives the
campaign's and the organization's deletion.

## B. Memory: every export reads in batches

*Pending the builder audit (every export type, every Full backup part, the export estimate on the web
dyno, and the other jobs a customer can still start on an archived campaign).*

## C. An export that stops says so

### C.1 Reconcile on the final failure

`reconcileFailedExportJob(job, err)` in exportProcessor.js, wired as the export Worker's `failed`
listener next to the others in worker.js:

- **A retry is coming** (`job.attemptsMade < job.opts.attempts` and no `job.finishedOn`): do nothing.
- **Final:** `ExportJob.updateOne({ _id: job.data.exportJobId, status: { $in: ['pending', 'running'] } },
  { $set: { status: 'failed', error: <C.4>, completedAt: now } })`, then `deleteArtifact` (D.2). The
  status filter leaves a doc the processor already marked `failed` (its own message stands), a
  `completed` one, and a deleted one alone.

This is the deferred stall failure of A.2 step 2: the doc reads Failed within about a minute of the
worker's second restart, and its slot is free.

### C.2 The repair sweep

For docs no listener will ever see again: exports stuck before this ships, and any whose queue job Redis
lost. `settleStalledExports()` follows the reviewed model already in the code for desk-entry
conversions, `settleStalledConversion`
([services/canvass/surveyConversion.js:944-990](../server/src/services/canvass/surveyConversion.js)):

- reads `ExportJob.find({ status: { $in: ['pending', 'running'] }, updatedAt: { $lt: now − 10 min } })`
  (the `{ status, expiresAt }` index has `status` first). The age guard keeps it off a doc whose POST
  hasn't added its queue job yet, and off a running export that is still writing progress (it writes at
  most once a second while rows flow);
- asks the queue for each job by id, each call bounded at 2 s (`queueOp`), with the conversion's live
  set: **`waiting`, `active`, `delayed`, `prioritized`, `waiting-children`** → alive, leave it. Missing,
  or any other state → settled: `updateOne({ _id, status, updatedAt }, { $set: { status: 'failed',
  error: <C.4>, completedAt } })`, then `deleteArtifact`. **A queue that can't be asked counts as
  alive** — the safe direction, as in the conversion's `jobAlive`.

An `active` job with no worker (the worker is down, or in Heroku's crash cool-off) stays alive on
purpose: nothing can be decided until a worker returns, and then A.2's stall check and C.1 take over.

It runs once when the worker starts (bounded, like the other boot steps, so the deploy itself clears
today's stuck exports) and nightly as a fourth pass of `sweepExpiredExports`.

### C.3 Queued while a retry is coming

Today a thrown error on attempt 1 or 2 marks the doc `failed`, and BullMQ re-runs it 5 or 10 s later. In
that window the row says Failed with a Retry button; pressing it starts a second export of the same
thing. The catch instead sets `status: 'pending'` (with `error: null`) when a retry is coming — not an
`ExportUserError`, and `job.attemptsMade + 1 < job.opts.attempts` — and `failed` only on the last. The
per-org throttle already counts `pending`, so the slot accounting is unchanged.

### C.4 Wording (design step)

One server-side sentence for C.1 and C.2, shown by both clients as they are. Proposed, in the house form
the conversion already uses ("The conversion stopped before it finished."): "The export stopped before it
finished. Try again." The owner picks the words in the design step.

### C.5 Stall settings, stated

The export Worker states `maxStalledCount: 1` and the default `lockDuration` explicitly, with a comment:
one automatic restart after a crash or a deploy, then Failed. Raising it to 2, as some queues do, would let
an export that is too big crash the worker three times instead of twice; with §B in place a crash
shouldn't happen, and a deploy rarely lands twice on one export.

## D. Half-written files are always deleted

### D.1 The file's id is the export's id

`openArtifactUploadStream` uses `bucket.openUploadStreamWithId(exportJobId, …)` instead of a random id.
Every chunk of every attempt then carries `files_id = exportJobId`, so any cleanup that knows the export
finds its pieces, finished or not. The filename stays the job id, so download, `artifactStats` and the
existing sweeps work unchanged, and older files (random ids) still delete by filename.

Considered instead: a per-attempt random id recorded on the doc. It needs a new schema field and a write
per attempt. The shared id's one weakness is two attempts of one export writing at the same moment, which
needs a stall while the first is still alive; the second attempt's first chunk then collides on GridFS's
unique `{ files_id, n }` index, fails, and the doc reads Failed with Retry. That double fault fails safe.

### D.2 `deleteArtifact` deletes the pieces too

After deleting by filename, `chunks.deleteMany({ files_id: ObjectId(exportJobId) })`. Every existing
caller gains it: the retry hygiene at the top of the processor, the catch, DELETE, the TTL sweep, C.1 and
C.2.

### D.3 The delete cascades

Both cascades already call `deleteArtifactsForScope` before they delete the scope's `ExportJob` rows
(deleteCampaign.js:204 runs before the `CAMPAIGN_SCOPED` loop; deleteOrganization.js:156 before
`ORG_SCOPED`). It gains one step: stream the scope's job ids (`{ organizationId, campaignId }` for a
campaign, so org-wide backups keep surviving a campaign delete as they do today; `{ organizationId }` for
an org) and delete chunks by `files_id` in batches. A crash leftover of the new shape then can't outlive
the campaign or the organization even for a night. Both fields are declared on `ExportJob`, so the filter
can't be dropped under `strictQuery`.

### D.4 The orphan sweep, both buckets

`sweepOrphanChunks(bucketName, { olderThanMs })` in a new shared module, run nightly as a pass of
`sweepExpiredExports` (`exportArtifacts`) and of `sweepStaleImportJobs` (`rawImports`):

- `chunks.distinct('files_id')` (served by the `{ files_id: 1, n: 1 }` index the driver creates), minus
  `files.distinct('_id')`;
- keep ids younger than 24 h by their ObjectId time (an upload in flight), and, for exports, ids of a
  `pending` or `running` job;
- `chunks.deleteMany({ files_id: { $in: batch } })` in batches; return the count, which the maintenance
  log prints.

This also clears leftovers from before the fix, whatever their id.

## E. Tests

- **`test/exportCrashRecovery.int.test.js` (new):**
  - C.1: final failure → `failed` with the C.4 sentence and its pieces gone; retry coming → nothing; a
    `completed`, `failed` or deleted doc is untouched.
  - C.2, with the queue stubbed the way `answerEditFollowup.int` stubs it: each state from C.2 leads to
    its outcome; a doc younger than 10 minutes is untouched; a queue that throws or hangs changes
    nothing.
  - C.3: a passing error on attempt 1 of 3 → `pending`; on the last → `failed`; an `ExportUserError` →
    `failed` at once.
- **`test/gridfsOrphanChunks.int.test.js` (new):** a half-written upload (600 KB written, the stream
  dropped) leaves chunks and no `.files` document; `deleteArtifact` removes a new-shape leftover; the
  sweep deletes old orphans in both buckets, keeps young ones and a running export's, and never touches
  a finished file; the cascades remove a new-shape leftover.
- **Builders (§B):** each rewritten builder against the old one kept in the test as an oracle:
  byte-identical files on fixtures with several rounds, inactive doors, do-not-contact exclusions and
  re-knocks.
- Unchanged and passing: `exports.int`, `exportBuilders.int`, `activityPerKnock.int`, `orgDelete.int`,
  `campaignDeleteJob.int`, and every client export test.

## F. Verification

On the real worker (`server/src/worker.js`) at `--max-old-space-size=384`, against a local mongod and
Redis, with synthetic campaigns (no customer data), memory read as macOS peak memory footprint (the Linux
proxy):

1. **Every export type** at 107,000, 250,000 and 400,000 doors, and the Full backup for one campaign and
   for a whole organization. Pass: each completes, footprint under 450 MB (Basic's dyno has 512 MB), and
   row counts and files match the old build.
2. **The busiest moment:** a Full backup, a client report build and the heaviest nightly job at once.
3. **Crash drill:** `kill -9` the worker mid-export twice. Pass: the doc reads Failed with the sentence
   within a minute of the second restart, no chunks remain, the slot is free, Delete works.
4. **Stuck-before drill:** a doc left `running` with its queue job failed or gone; the next worker start
   marks it Failed.
5. **The size limit:** every export stops at 512 MB of uncompressed CSV (`EXPORT_MAX_BYTES`,
   exportProcessor.js:20, :61) with "narrow the filters", and the Full backup has no filters. Record the
   uncompressed size of the 400,000-door Full backup and of the biggest whole-organization backup the
   synthetic data allows, so the owner can see how close an ended customer's last export of everything
   comes to that wall (§I).

The numbers from steps 1 and 2 decide the worker's size (§H).

## G. Docs, Help Center, privacy record

- [EXPORTS.md](EXPORTS.md): Part 1 (what Failed means now, Retry) and Part 2 (the reconcile, the repair
  sweep, the file id, the orphan sweep; the line "nothing ever materializes in memory" is replaced by
  what §B makes true).
- [PERFORMANCE.md](PERFORMANCE.md): the export memory numbers; the worker runs 9 queues, not 8.
- Help Center: the Exports guide and page say what Failed means and that Retry starts it again.
- [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): a dated note under the Export Center item and the
  raw-upload item — crash leftovers are now deleted (D.2-D.4), which makes "the sweep also clears
  failed-job leftovers and orphan files" and "an export artifact must not outlive the org" true for
  them. No published text changes.

## H. Shipping

One server deploy: no phone update, no client-version bump (same response shapes), no migration, no new
index, no config var. On the worker's first start after the deploy, C.2 clears exports stuck from before.
Then the §F numbers decide the worker's size; until they are in, keep the worker where it is.

## I. Open questions for the owner

1. **The wording** of the stopped-export sentence (C.4).
2. **The 512 MB limit on a Full backup** (§F step 5): keep it, or raise it for the Full backup only, so an
   ended customer's last export of everything can't be refused for size. Decided on the measured sizes.
