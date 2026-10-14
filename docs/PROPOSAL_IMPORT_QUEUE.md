# Proposal: The import line — honest waiting, and imports that fit in memory

> **Status: DESIGN, 2026-10-13. Nothing built. Review rounds 1–4 done** (seven adversarial reviewers: four
> blockers — the capacity gate, the early-voting measurement, the stuck clock, and a do-not-contact clear
> that would have deleted other organizations' requests — plus 35 major and 79 minor findings; the
> load-bearing ones re-verified against the code; all folded in). Round 4 still found a blocker and seven
> majors, so another round on the rewritten §H and C1 is worth it before building them. Two pieces
> that ship separately. **(1) The waiting line:** a job waiting its turn is never reported as failed, shows
> its place in line, a job the page has called failed or cancelled never runs or writes again, and at most
> one import per organization runs at a time. The bug it fixes was reproduced on 2026-10-13 against the
> real routes and worker code. **(2) Memory:** where an import's memory goes was measured stage by stage
> on a synthetic 166,738-row file; three fixes were prototyped on a scratch copy and measured (§G), and the
> rest are designed (§H). **Early-voting data is the first thing to fix** (§F.6): parked voted-list ids
> pile up once per upload, and an import that graduates any of them loads the whole pile twice.
> **The capacity gate in §I is not met.** Production facts this rests on (owner, 2026-10-13):
> `IMPORT_JOB_CONCURRENCY=1`, web and worker dynos both **Standard-2X** (1,024 MB). Read this before
> touching the import queue, the stale-job expiry, the voted/DNC lists, or the import write path.

What this covers: how the one import line works today and what goes wrong while a job waits in it; the
fix (one liveness signal, one verdict for every unfinished job, a claim token the worker must hold to
write, one import per organization at a time); the same bug in campaign deletes; where an import's memory
goes — early voting above all — and how to cut it; and what that means for the worker's size and for
running two imports at once.

Related: [IMPORTS.md](IMPORTS.md) (the pipeline, stale-job handling), [PERFORMANCE.md](PERFORMANCE.md)
(the August memory record this corrects), [OPERATIONS.md](OPERATIONS.md) (the one-worker rule, the
nightly jobs, the console scripts), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (raw-upload and
temp-file lifetime), [EARLY_VOTING.md](EARLY_VOTING.md) (parked voted-list ids), [CAMPAIGNS.md](CAMPAIGNS.md)
(background campaign delete), [PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md](PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md)
(Look up by address, which shares the import line).

---

# Part 1 — For everyone

## How the import line works today

Every organization's imports go into **one line**, served first come, first served by the one worker dyno.
The line holds four kinds of job: full imports, the **Preview changes** analysis, **See exact placement**,
and Pin Fixes' **Look up by address**. The worker runs `IMPORT_JOB_CONCURRENCY` of them at a time; in
production that is **1**. So when one organization is importing a big file, everyone else's preview waits
until it finishes. Turf cuts, exports and deletes have their own lines and never wait behind imports —
but they all run in the same worker process and share its memory.

## What goes wrong while you wait (reproduced 2026-10-13)

- **Waiting two minutes reads as "the system is down."** The page treats "not started after 2 minutes"
  as "no worker exists." A preview waiting behind someone else's big import turns red: *"No import worker
  picked this up. The worker dyno may be off — check Heroku → Resources."* The worker was fine, just busy.
- **The "failed" job runs anyway.** Nothing takes it out of the line, and Cancel refuses it (it already
  says failed). When its turn comes, the worker flips it back to completed. A preview's result is never
  seen; a full import caught by the nightly check writes its voters after saying it failed.
- **A crash or deploy mid-import has the same problem one step later.** BullMQ puts the interrupted job
  back in line, but if another job is running it waits there, and after 3 minutes the page calls it dead
  (*"stopped responding mid-job"*) — then it resumes anyway.
- **Pin Fixes shows a code.** A lookup that waited too long shows the toast *"stale-unclaimed"*, and the
  lookup still runs later, including paid address lookups.
- **Campaign deletes have the same bug.** Delete two campaigns close together: the second says *"No
  worker picked this delete up"* and offers Retry, and then deletes anyway when its turn comes.
- **Two smaller lies.** Between automatic retries an import reads *Failed* even though it will try again
  in seconds; and if the worker crashes in the instant after an import completes, the redelivered job can
  flip that finished import to *Failed*.

## What changes (piece 1: the waiting line)

- **Waiting looks like waiting.** *"Waiting in line — 2 ahead of you"*, or *"Next in line"*, with the
  clock; *"Resuming — 1 ahead"* for a job put back in line after a crash. If the import system itself is
  down the page says so — *"The import system isn't running right now. Your job keeps its place and starts
  when it's back"* — and anything still waiting (a preview, a full import, a See-exact-placement check, a
  Pin Fixes lookup) can be **Cancelled**. Nothing is failed for waiting.
- **Failed and cancelled are final.** A job the page has called failed or cancelled can never run or write
  again: the worker must hold the job's claim to write anything, and loses it the moment the job is
  finished from outside. A job between automatic retries says *"Retrying after a problem (attempt 2 of
  3)"*, not *Failed*.
- **Apart from a real problem with the file or the import itself, only four things fail an unfinished
  job:** it vanished from the line (the queue lost it); it waited **24 hours** without running (withdrawn,
  file deleted); it was running and made **no progress for 30 minutes** (stuck); or it was interrupted twice
  in the middle — two worker restarts or crashes during one import (deploys and Heroku's daily restart
  count). Each says what happened in plain words, and a real problem
  keeps its own precise message (a bad voter-ID column still says what to fix).
- **An import that has started writing can't be cancelled** — and writing starts when Doorline begins
  linking the file's people, before any door or voter row is imported. It finishes, or stops and says
  *"Stopped partway — import the file again to finish"* (re-importing is safe).
- **One import per organization at a time.** A second file from the same organization waits for the
  first (*"Waiting — another import from your organization is running"*). That keeps every import's
  new/updated counts correct, and when the line runs two full imports at once, they belong to two
  *different* organizations.
- **Pin Fixes says a sentence**, and a waiting lookup reads *"Waiting in line…"*.
- **Campaign deletes** get the same rule: *"Deleting… waiting in line."*

## Why imports run out of memory (measured 2026-10-13)

Today's code needs **a heap cap between 512 and 768 MB** for a big import (166,738 rows, 112,385 homes) with
no early-voting data: it crashed the worker at 384 and 512 and finished at 768. The worker's built-in cap
is 384 MB unless `WORKER_MAX_OLD_SPACE` raises it. Two at once took at least 1,078 MB — more than a
Standard-2X has. (Memory totals measured on this Mac are lower bounds: macOS compresses memory and leaves
compressed pages out of the resident figure; §F says which figures are footprints.) The August note that
such a file "fits under 384 MB" measured only *reading* the file.

Where it goes, biggest first:

1. **Early voting — the biggest risk for the next three weeks.** Every voted-list upload parks the voter
   ids it couldn't match, **once per upload**, so a campaign that uploads its county's cumulative early-vote
   file daily parks the same ids again every day. Every import loads that whole pile; and when the file
   brings in voters whose ids are parked, Doorline loads the whole pile **a second time** to clear them.
   Measured with 1.2 million parked rows and 30,000 of the file's voters graduating, one import needed
   **more than a Standard-2X has — about 1,150–1,180 MB of real memory** at a 1024 MB cap, and crashed at
   768 — with today's code *and* with the other memory fixes, which don't touch this step. At a list a day,
   a campaign gets to 1.2 million rows within a week of early voting starting, and keeps growing. The same
   load-everything step runs on the **website's** server when a voted list or a do-not-contact list is
   uploaded, and the do-not-contact pile has the same pattern across a whole organization.
2. **Writing the homes.** The import prepares the write for *every* home up front and keeps all of them
   through the whole home-writing step; the database library then rewrites each one into a copy several
   times bigger — about 300 MB held on a big file.
3. **Campaign-wide passes after the write.** Recomputing the campaign's cut attributes (precinct and
   districts per home) and re-checking which doors are still active load everything they cover at once —
   the cut attributes cover the *whole campaign*, so that one grows with the campaign, not the file.
4. **Previews and See-exact-placement checks** keep every row of the file in memory. A big preview still
   fits the 384 MB default on its own.

## What makes imports smaller (piece 2)

Three changes were tried on a scratch copy and measured (§G): write homes in batches, recompute cut
attributes in pages, and stream the who-moved check. They change only how much is held at once — the same
rows are written and the same counts reported (one tie-break in the cut attributes becomes deterministic,
§G). **Measured effect, without early-voting data:** a big import that needed a cap between 512 and 768 MB
now finishes between 256 and 384 — so the 384 default is enough — and **two at once finish at 512**. The
early-voting fix (§H, first item), the door re-check, previews and a few smaller holds are designed in §H.

## What this means for the worker

- **Now, from the dashboard, until the early-voting fix ships:** keep `IMPORT_JOB_CONCURRENCY` at **1**. An
  import that graduates early-voting ids needs more memory than a Standard-2X has (§F.6), and the pile grows
  every day. Two options:
  - **Recommended: move the worker dyno to Performance-M (2.5 GB) and set `WORKER_MAX_OLD_SPACE` to about
    2000 from the start.** The cap is shared by everything the worker process runs — turf cuts, exports and
    deletes live under the same heap limit as the import — so headroom has to be inside the cap, not just in
    the dyno. The measured import needed a cap between 768 and 1024 for 1.2 million parked rows (§F.6);
    footprint runs 150–310 MB above the heap, so a 2000 cap still lands under 2,560 MB. Don't start low and
    wait for out-of-memory restarts: each crash redelivers the job and crashes again, and a second crash puts
    the dyno into Heroku's restart cool-off (minutes, escalating), which stops every queue.
  - **This buys days, not weeks.** With daily cumulative lists the pile grows faster than linearly; check its
    size first (open questions) to know the horizon. The fix in "When to build" is the real answer.
  - Or stay on Standard-2X with `WORKER_MAX_OLD_SPACE` at 1024 and accept that those imports push the dyno
    past its quota (Heroku R14, swapping and slow — on the Cedar generation; see open questions), and crash
    once the pile grows further.
  - Without early-voting data, 768 was enough for one big import on today's code — measured into an empty
    or same-size campaign, not into a much bigger one.
- **The website's server is exposed too, and no setting protects it.** Uploading a voted list or a
  do-not-contact list holds the whole file in the web dyno's memory, parses every column of every row, and
  then — on any upload that matches anyone, which a cumulative county file always does — loads the whole
  parked pile. The web dyno serves every phone. Only shipping the first item in "When to build" removes that.
- **After the early-voting fix and the memory fixes:** two at once *may* fit a Standard-2X — the scenarios
  measured so far without early-voting data do — but the gate in §I must pass first, and the
  one-import-per-organization rule must be in.
- **To grow past that:** add import-only dynos (§I) rather than one bigger dyno — each runs its own import
  with its own memory, and one bad file can't take the others down.

## When to build

The election is **2026-11-03**, three weeks out, and imports are busiest right before it — which is also
when early-voting data piles up. Recommended order:

1. **First, alone, as soon as possible: stop loading the whole pile to clear it** (§H, first item). One
   small server change — `clearParkedByCanonical` deletes by index with its caller's own filter instead of
   loading every parked row — removes the pile load from the website's voted and do-not-contact uploads and
   the worker's second load during graduation. No result changes; a server deploy, no phone release.
2. **Then, before the election: the rest of the early-voting fix** (§H) — graduation looks up only the
   parked ids this file can graduate, in bounded chunks; the same for the do-not-contact pile; nightly
   backstops catch the rare cases a file-scoped lookup can miss; the two upload routes stop holding whole
   files in memory.
3. **Before the election, if there is room: memory fixes 1–3** (§G) — same rows, same counts; the new test
   assertions in §J come with them.
4. **Piece 1, the waiting line** — any time; it changes what the page says and how the worker claims and
   writes a job's own record, not how rows are imported.
5. **After all of that and the §I gate: raise `IMPORT_JOB_CONCURRENCY`**, or add import-only dynos.

## Open questions for the owner

- What is `WORKER_MAX_OLD_SPACE` set to in production today (Settings → Config Vars)?
- Has a 150k+-row import completed in production since the pin pass shipped (2026-10-10)? If yes, at what
  memory? That confirms or refutes the synthetic file.
- How often do campaigns upload voted lists, and are they cumulative county files? How big is the biggest
  campaign's parked pile today, and the biggest organization's do-not-contact pile? There is no safe console
  command for that yet: add a small root-proxied, read-only count script. **Don't run
  `npm run audit:voter-id-spellings` during early voting** — it loads every parked row itself.
- Does the web dyno set a heap limit (`NODE_OPTIONS`)? It runs `node src/server.js` with none in the code.
- Which Heroku generation is the app on — Cedar or Fir? Heroku documents memory enforcement differently for
  Fir (a restart at the quota), which would remove the "accept R14" option above. Confirm before relying on
  it.

---

# Part 2 — Technical reference

## A. Today, code-verified

**One queue.** `import-queue` ([queues/index.js:7](../server/src/queues/index.js)); four producers, all
`getQueue(QUEUE_NAMES.IMPORT).add(name, { importJobId }, { jobId: String(importJob._id) })`, no priority,
no group: `csv-import`, `csv-preview`, `geocode-check` ([routes/admin/imports.js](../server/src/routes/admin/imports.js)),
and `pin-lookup` ([routes/admin/campaignHouseholds.js:284](../server/src/routes/admin/campaignHouseholds.js)).
Default job options: `attempts: 3`, exponential backoff from 5 s ([queues/index.js:36](../server/src/queues/index.js)).
One consumer: `new Worker(QUEUE_NAMES.IMPORT, processImportJob, { concurrency: IMPORT_CONCURRENCY })`
([worker.js:112](../server/src/worker.js)); the code default is **2** (`worker.js:21`), production sets 1.
BullMQ defaults apply to it: `lockDuration` 30 s, `stalledInterval` 30 s, `maxStalledCount` 1. The turf,
export, campaign-delete, org-delete, conversion and maintenance Workers run in the same process
(`worker.js:111-154`). One worker dyno by rule ([OPERATIONS.md](OPERATIONS.md), "The one-worker rule").

**The watchdog.** [sweepStaleImports.js](../server/src/services/import/sweepStaleImports.js):
`UNCLAIMED_MS = 2 min` for `pending` (measured from `createdAt`), `STALE_MS = 3 min` for active statuses
(from `heartbeatAt`). `maybeExpireStaleImportJob` CAS-flips the doc to `failed` with
`lastError: 'stale-unclaimed' | 'stale-heartbeat'`. It runs on `GET /admin/imports/:importId` (per
poll), inside Cancel when the queue removal fails, in the nightly `IMPORT_SWEEP_JOB`, and from the
`npm run sweep:raw-imports` console script. The list route does not run it, and it never touches the
queue. Only the Import page's preview and See-exact-placement jobs and Pin Fixes' lookup poll the detail
route ([ImportPage.jsx](../client/src/pages/ImportPage.jsx), [PinFixesPage.jsx](../client/src/pages/PinFixesPage.jsx));
a full import is only ever listed, so it reaches the watchdog only through the nightly sweep.

**The worker claims and writes unconditionally.** `processImportJob`'s claim is
`ImportJob.updateOne({ _id }, { status: 'parsing', … })` with no status filter
([importProcessor.js:156-166](../server/src/services/import/importProcessor.js)), preceded by
campaign/org guard writes that are also unfiltered and sit outside the `try` (`:124-151`);
`processPinLookupJob` claims the same way (`:41-44`). Every later write — stage transitions, progress,
completion — filters on `_id` alone. So a doc the watchdog failed is resurrected when its still-queued job
is reached, and a job failed while still running goes on to write `completed`.

**Cancel** removes a queued job and CAS-fails the doc on the status it read
(`{ _id, status: job.status }`), but returns early for a doc that is already `failed`
([imports.js:521](../server/src/routes/admin/imports.js)), so a watchdog-failed zombie can't be withdrawn.
Only the preview has a Cancel button.

**Between retries the doc reads failed.** The processor's catch writes `status: 'failed'` on every attempt
([importProcessor.js:607](../server/src/services/import/importProcessor.js)), though BullMQ retries when
`attemptsMade + 1 < attempts` and the error is not an `UnrecoverableError` (`Job.shouldRetryJob`, bullmq
5.77.6; `attemptsMade` is incremented after that decision, so the processor sees the pre-failure value).
The worker's own `failed` listener already knows the difference ([worker.js:175](../server/src/worker.js)).

**Redelivery after success.** A job whose completion write landed but whose BullMQ completion didn't (a
crash in between) is redelivered as stalled; the unconditional claim flips the doc to `parsing`, the raw
file is already deleted, `loadRawImport` throws FileNotFound, and the catch writes `failed` over a
finished import.

**Crash or deploy mid-job.** The doc stays in its mid-run status and its heartbeat stops. BullMQ requeues
the job only from a later stall check (a two-pass mark-then-move, every 30 s), and puts it at the
consumer end of the wait list (`RPUSH` in `moveStalledJobsToWait`), while the restarted worker's main loop
has already taken the next waiting job. At concurrency 1 the requeued job waits that whole job out, and
`STALE_MS` fails it after 3 minutes.

**Counts assume one import per campaign and org.** Per-job counts are before/after `countDocuments`
differences (`csvImporter.js`, `applyImport`), and `votersProcessed` is an org-wide distinct-people
difference (`countOrgPeople`). Nothing stops two imports into one campaign or org from running at once,
and the code default concurrency of 2 allows it; each then reports the other's inserts as its own.

**The history list ships the big arrays.** `GET /admin/imports` projects only `{ errors: 0, ...ORG_HIDDEN_IMPORT_FIELDS }`
([imports.js:440](../server/src/routes/admin/imports.js)) and returns full Mongoose documents, so every
row carries `insertedVoterIds`, `insertedHouseholdIds`, `sourceHouseholdIds` and `duplicateStateVoterIds`
— about 7.5 MB of JSON for one fresh 166k-row import — and the Import page polls it every 1.5 s while any
row is unfinished (`ImportPage.jsx:597-601`). The detail route already strips them. Nothing on the web or
the phone reads them (the phone's export picker uses `_id`, `status`, `undone`, `filename`, `createdAt`).

**Reproduction (2026-10-13, throwaway mongod, real Express app + real processor; the BullMQ hand-off
simulated because no Redis was available locally):** a preview `pending` at 1:55 polled `pending`; at
2:05 it polled `failed` with the "worker may be off" message while a sibling org's import read
`importing`; Cancel returned 200 without touching the queue; `processImportJob` then took it to
`completed` with a diff. A full import aged 2:05 stayed `pending` in the list route; after the sweep's
per-job expiry it read `failed`, then the processor wrote its 3 voters and it read `completed`. Pin Fixes'
`lookupToast` on that doc returns `{ text: 'stale-unclaimed' }`.

**Campaign deletes, same pattern.** [deletionState.js:19](../server/src/services/campaigns/deletionState.js)
`UNCLAIMED_MS = 2 min` on `campaign-delete-queue` (concurrency 1, "a 100k-door cascade runs for minutes"),
and the claim in [deleteCampaignProcessor.js](../server/src/services/campaigns/deleteCampaignProcessor.js)
accepts `failed` (its retry path), so a delete expired while queued still runs. Its `running` stamps keep a
3-minute heartbeat timer, so a crash-requeued delete waiting behind another delete is failed too. **Org
deletes** already use `UNCLAIMED_MS = 6 h` because "a short window would fail perfectly healthy queued
jobs" ([orgDeletionState.js:14-26](../server/src/services/platform/orgDeletionState.js)). Exports, turf and
desk conversions have no pending-expiry (checked two ways: no pending `_MS` rule, no `heartbeatAt` reader).

## B. Design: one liveness signal, one verdict for every unfinished job

The rule: **a job's doc is failed only by something that knows the job will not run, or that it has
stopped advancing while alive.** BullMQ says whether a job will run (in line, running, or gone), the worker
heartbeat says whether anyone is consuming the line, the job's own heartbeat says whether its processor is
alive, and a progress timestamp says whether it is moving. No timer on the doc alone decides a job is
dead — that was the bug, in both its forms (2-minute "unclaimed", 3-minute "stale heartbeat" on a job
BullMQ had put back in line).

### B1. Worker heartbeat, per queue

```js
// server/src/queues/workerHeartbeat.js (new)
export const heartbeatKey = (queueName) => `doorline:worker:heartbeat:${queueName}`;
export const startWorkerHeartbeat = (redis, queueNames, { everyMs = 15_000, ttlMs = 90_000 } = {}) => {
  const beat = () => Promise.all(queueNames.map((q) =>
    redis.set(heartbeatKey(q), JSON.stringify({ at: Date.now(), dyno: process.env.DYNO || null }), 'PX', ttlMs)))
    .catch((err) => console.error('[worker] heartbeat write failed:', err?.message || err));
  beat();
  const t = setInterval(beat, everyMs);
  t.unref?.();
  return () => clearInterval(t);
};
export const readWorkerHeartbeat = async (redis, queueName) => { /* GET heartbeatKey(queueName), JSON.parse → { at, dyno } | null */ };
```

- Started in `worker.js` right after `connectDb` — before the boot probe and `registerMaintenanceJobs`,
  whose bounded waits (up to ~30 s) would otherwise eat the TTL — for the queues this process consumes.
- Beats through the 25-second drain in `shutdown()`; stopped just before `closeQueues()`.
- Never deleted. Worker dynos do not preboot: on a deploy the old dyno stops and the new one boots after
  it. The 90-second TTL covers a normal restart; a slower boot shows "the import system isn't running"
  for those seconds, which is true.
- `GET /admin/imports/worker-status` uses it for `online` (replacing the `getWorkers()` guess, which needs
  `CLIENT LIST` and falls back to a heuristic where Redis refuses it).
- It proves the process is alive. Whether the queue is **paused** is checked separately (B2).

### B2. Queue state — one bounded round, skipped when Redis isn't ready

`importQueueState(importJobIds, { isReady = () => getSharedRedis().status === 'ready' } = {})` (new,
`services/import/importQueueState.js`) answers for one or several jobs in one round, under one ~2 s budget
(`Promise.all` inside a single `queueOp(…, 2000)`; a timeout bounds the request, it does not cancel the
commands). **If `isReady()` is false it answers `redis: 'down'` without sending anything** — with
`maxRetriesPerRequest: null`, commands sent to a disconnected client pile up in ioredis's offline queue for
the whole outage. (`isReady` is a parameter so int tests, which point at an unreachable Redis, can pass
`() => true` and stub the queue calls; ioredis's `status` is a data property, which `t.mock.getter` can't
wrap.) Calls: `queue.getJobState(id)` per job (`'unknown'` for an id in no state list),
`readWorkerHeartbeat`, `queue.isPaused()`, and — only if some job is waiting — one
`queue.getRanges(['waiting', 'paused'], 0, -1, true)`. The wait list is LPUSHed and consumed from the right
and `asc` reverses it in JS, so index 0 runs next; a paused queue keeps its jobs in `paused`, and
`getJobState` still answers `waiting` for them; a crash-requeued job is RPUSHed (it goes next) and a
promoted delayed job LPUSHed (it goes last). Result per job: `{ redis, state, ahead, workerUp, paused }`;
`ahead` < 0 (not found — e.g. just claimed) reads as *starting*. **A timed-out or errored round answers
`redis: 'down'` for every job** — never a partial answer, which the verdict would read as `lost`. Routes get
`isReady` from a module-level hook (`setQueueStateDeps({ isReady })`) so route-level tests can inject it. The
shared client is created lazily, so a one-off caller (the `sweep:raw-imports` console script) first awaits
readiness with a bounded ping; otherwise its first call would see `connecting`, answer `down` for every doc,
and act on nothing.

### B3. The verdict — a pure function, for pending and in-progress docs alike

```js
// services/import/queueVerdict.js (new, plain-module tested)
export const NO_PROGRESS_CEILING_MS = 30 * 60 * 1000;  // alive, but no progress for 30 min → stuck
export const QUEUED_CEILING_MS = 24 * 60 * 60 * 1000;  // pending 24 h without running → withdrawn
export const LOST_AFTER_MS = 2 * 60 * 1000;            // grace for a doc whose job is in no BullMQ state
export const JOB_SILENT_MS = 90 * 1000;                // three missed 30 s job heartbeats

export function jobVerdict({ doc, queue, now = Date.now() }) {
  if (queue.redis === 'down') return { act: 'wait', show: 'unreachable' };
  const at = (d) => +new Date(d);
  const sinceQueued = now - at(doc.queuedSince || doc.createdAt);
  const sinceProgress = now - at(doc.progressAt || doc.startedAt || doc.createdAt); // never heartbeatAt
  const jobAlive = !!doc.heartbeatAt && now - at(doc.heartbeatAt) < JOB_SILENT_MS;
  const midRun = doc.status !== 'pending';
  switch (queue.state) {
    case 'waiting': case 'prioritized': case 'waiting-children':
      // A mid-run doc whose job is back in line resumes — checked before any ceiling. Only once the job's own
      // heartbeat is silent: a live processor that merely lost its BullMQ lock is left alone.
      if (midRun) return jobAlive ? { act: 'wait', show: 'running' } : { act: 'requeued', show: 'resuming', ahead: queue.ahead };
      if (sinceQueued > QUEUED_CEILING_MS) return doc.writeStartedAt ? { act: 'fail', code: 'stopped-partway' } : { act: 'withdraw', code: 'expired' };
      return { act: 'wait', show: waitingShow(doc, queue), ahead: queue.ahead };
    case 'delayed': // a retry's backoff, or the one-import-per-org rule (C4) holding it back
      if (!midRun && sinceQueued > QUEUED_CEILING_MS) return doc.writeStartedAt ? { act: 'fail', code: 'stopped-partway' } : { act: 'withdraw', code: 'expired' };
      return { act: 'wait', show: doc.waitingFor === 'org' ? 'org-busy' : 'retrying' };
    case 'active':
      if (!queue.workerUp) return { act: 'wait', show: 'system-down' }; // BullMQ requeues it when a worker is back
      if (midRun && jobAlive && sinceProgress > NO_PROGRESS_CEILING_MS) return { act: 'fail', code: 'stuck' };
      return { act: 'wait', show: midRun ? 'running' : 'starting' };
    case 'failed':
      return { act: 'fail', code: 'queue-failed' };   // BullMQ gave up; the worker's failed listener normally got here first
    default: // 'unknown', or 'completed' while the doc is unfinished
      return now - at(doc.createdAt) > LOST_AFTER_MS ? { act: 'fail', code: 'lost' } : { act: 'wait', show: 'starting' };
  }
}
// System states first (they explain why nothing moves), then the job's own reason, then its place in line.
const waitingShow = (doc, q) =>
  q.paused ? 'paused' : !q.workerUp ? 'system-down' : doc.waitingFor === 'org' ? 'org-busy' : doc.requeuedAt ? 'resuming' : 'in-line';
```

- **The verdict reads its own copy of the doc.** Every route that acts on it (detail, list, Cancel) reads
  the doc for the *response* with `claimToken` hidden (`ORG_HIDDEN_IMPORT_FIELDS`), and Mongoose sends a
  hidden field as `null` in a filter — so a CAS built from that read could never match a claimed doc. The
  verdict path re-reads by `_id` with its own projection (`status, claimToken, queuedSince, progressAt,
  startedAt, heartbeatAt, writeStartedAt, waitingFor, requeuedAt, createdAt, kind, organizationId` — the last
  for the lease release) and CASes on that.
- **`requeued`**: CAS `{ _id, status, claimToken }` as read → `pending`, `claimToken: null`,
  `requeuedAt: now` (cleared by the next claim, so later polls still say *"Resuming"*), `queuedSince: now`
  (so the 24-hour ceiling measures this wait, not the job's whole life — otherwise an old job would be
  withdrawn on the very next poll), C2's progress reset (so the badge can't read "Waiting 72%"), keeping
  `writeStartedAt`; and release the organization lease that token held (C4). The next claim restarts the job idempotently. This replaces
  `STALE_MS` as a failure trigger.
- **`progressAt`** (new) is set **at every claim** and then only by real progress, through `jobWrite`:
  each stage transition; each row batch; each geocode and link batch; between each post-write pass (cut
  attributes, voted, DNC, do-not-knock, who-moved, door re-check — today nothing is written between them);
  and inside the pin pass after each load, classify and mark step **and after each lookup batch and each
  write batch**, through a callback (a lookup batch can wait 180 s, and the step can run 25 of them). Never
  from the heartbeat timer, and the fallback never uses `heartbeatAt` — so a job wedged in its first parse is
  still caught, and a resumed job starts a fresh 30 minutes.
- **`queuedSince`** (new) is set whenever a doc becomes `pending` from creation, a retry, a requeue, or a C4
  org-wait that followed a claim taking over a mid-run doc; a plain org-wait cycle doesn't reset it. The
  24-hour ceiling applies only to `pending` docs, in both the `waiting` and `delayed` branches (a mid-run doc
  is resumed, never withdrawn).
- **An organization blocked by a wedged holder:** when a row's verdict shows `org-busy`, the route also runs
  the verdict on the lease holder (`ImportJob.findById(importLease.jobId)` — the BullMQ job id is the
  ImportJob id), so a `stuck` holder in another campaign can be cleared from any page of that organization,
  not only from its own.
- **`stuck`** needs a live job heartbeat: a dead job is `requeued` (or `system-down`), never `stuck`.
- **Every fail or withdraw verdict that wins its CAS deletes the stored upload** and releases the
  organization lease the cleared token held.
- **Residual risk, stated:** a processor wedged on a promise that never settles keeps its BullMQ lock (the
  lock renews on a timer) and its slot. Mongo calls are bounded (`socketTimeoutMS` 120 s) and the Geocodio
  client has timeouts, so the remaining case is a stream that never ends. The verdict marks such a job
  `stuck` and the line shows it; freeing the slot takes a worker restart.

### B4. Withdraw — one function, shared with Cancel

`withdrawImport(importJobId, { code, reason })`:
1. Re-read by `_id` with the verdict's projection (as B3).
2. **Refuse a job that has started writing:** `writeStartedAt` set → `409 "This import is already writing
   — it can't be cancelled now. It will finish, or stop and say so."` Writing starts at **linking**, not at
   the row write (C1); for a pin lookup, at its pins stage.
3. `queue.remove(id)` — 1 = removed (also for an id BullMQ doesn't have, and for an active job whose lock
   has lapsed), 0 = locked (running: stop, report running); a timeout changes nothing and reports
   unreachable.
4. CAS `{ _id, status: <as read>, claimToken: <as read> }` → `failed`, `lastError: code`,
   `errors: [{ reason }]`, `claimToken: null`. **If the CAS misses after a successful remove** (the doc moved
   under us — an org-wait cycle, say), re-read and CAS once more, **only if the re-read status is still
   claimable**, with `writeStartedAt ? 'stopped-partway' : code` (a live processor whose lock lapsed may have
   started writing in between; `remove()` also returns 1 for a job that just completed, which must stay
   completed).
5. Only if a CAS won: `deleteRawImport`, and release the organization lease the cleared token held.

Cancel calls it with `code: 'cancelled'` (*"Cancelled before it ran."*); the 24-hour ceiling with
`code: 'expired'`.

### B5. Where it runs, and what the page gets

- `GET /admin/imports/:importId`: for any unfinished doc, `importQueueState` → `jobVerdict` → act; respond
  `{ job, queue: { show, ahead } }` (additive). `claimToken` is hidden from the response only.
- **`GET /admin/imports` (the history list) runs it too** — a full import is only ever listed, so without
  this none of piece 1 reaches it. One `importQueueState` round for the list's unfinished rows that are
  `pending`, or whose `heartbeatAt` is older than 90 s, or whose `progressAt` is older than 30 minutes, in
  parallel under the same ~2 s budget; `queue` per row. **And the list's projection drops the big arrays**
  (the detail route's exclusions plus `errors: 0`) **and goes `.lean()`** — today it ships ~7.5 MB per big
  fresh import on every 1.5-second poll (§A). `npm run audit:mobile-api` will flag `imports.js`; removing
  those fields is safe because nothing reads them.
- History rows gain a failure line, computed from fields the list returns. Deliberate failures store a
  top-level **`failCode`** (new; today the code lives only in `errors[0].code`, which the list drops):
  `ZERO_ONLY_MATCHES`, `IMPORT_TOO_LARGE`, `LEGACY_XLS`, `FILE_NOT_FOUND`. Precedence: **`failCode`'s own
  sentence** (the zero gate keeps its fix-the-file advice) → **a system code's sentence** (`lost`, `stuck`,
  `queue-failed`, `interrupted`, `undone`, `expired`, `cancelled`) → *"Stopped partway — import the file
  again to finish"* for `failed` + `writeStartedAt` → a generic line. **Raw `lastError` is never rendered**
  (it can hold a migration command or a Mongo error). `interrupted` is mapped by the failed listener from
  BullMQ's "job stalled more than allowable limit": *"This import was interrupted twice (restarts or
  crashes) — import the file again to finish."*
- `.lean()` drops schema defaults, so older rows would show "—" for fields added since they were written
  (`movedVoters`, `deactivatedDoors`): run `ImportJob.applyDefaults(row)` on each lean row.
- The nightly `IMPORT_SWEEP_JOB`: the same verdict for every unfinished doc; its projection widens to the
  verdict's fields (today it reads only `status, heartbeatAt, startedAt, createdAt`).
- `npm run sweep:raw-imports` (console script, root-proxied) runs the sweep and so opens Redis: it must
  `await closeQueues()` before exiting or the Run console never returns. Run it from the repo root to check.
- `maybeExpireStaleImportJob`, `UNCLAIMED_MS` and `STALE_MS` are deleted; `ACTIVE_STATUSES` stays exported
  (`routes/admin/campaigns.js` and `routes/superAdmin/organizations.js` import it).
- Bull Board: an operator's **Retry** on a failed import job becomes a no-op (the doc is `failed`; the
  claim refuses it) — re-running means uploading again; **Pause** shows *"Imports are paused"*. Both go
  in [OPERATIONS.md](OPERATIONS.md).

## C. Design: the worker writes only while it holds the claim

### C1. The claim token

Right after `ImportJob.findById` — before the campaign/org guards, which become claimed writes too:

```js
const CLAIMABLE = ['pending', 'parsing', 'geocoding', 'linking', 'importing'];
for (let attempt = 0; ; attempt++) {
  // Full document, as today: a retry re-checks the persisted sourceHouseholdIds (and older docs still carry
  // their inserted-id arrays, which insertedIdsFor reads alongside the side collection).
  const doc = await ImportJob.findById(importJobId).lean();
  if (!doc) throw new UnrecoverableError(`ImportJob ${importJobId} not found`); // as today
  if (doc.undone && doc.status === 'pending') {                                // a file-wide Undo ran while it waited
    const closed = await ImportJob.updateOne({ _id: importJobId, status: 'pending', claimToken: doc.claimToken ?? null },
      { $set: { status: 'failed', lastError: 'undone', completedAt: new Date() } });
    if (closed.modifiedCount) await deleteRawImport(importJobId).catch(() => {});
    return { ok: true, skipped: 'undone' };
  }
  if (!CLAIMABLE.includes(doc.status) || doc.undone) return { ok: true, skipped: doc.status };
  const token = `${job.id}:${job.attemptsStarted}:${crypto.randomUUID()}`;
  const won = await ImportJob.updateOne(
    { _id: importJobId, status: doc.status, claimToken: doc.claimToken ?? null },
    { $set: { status: 'parsing', phase: 'parsing', claimToken: token, startedAt: new Date(), heartbeatAt: new Date(), progressAt: new Date(), requeuedAt: null, progress: 0, queueJobId: String(job.id), waitingFor: null } }
  );
  if (won.modifiedCount) break;
  if (attempt === 2) throw new Error('claim raced three times'); // retried by BullMQ — never "completed" over a claimable doc
}
```

- **`jobWrite(update)`** = `updateOne({ _id, claimToken: token, status: { $in: CLAIMABLE }, undone: { $ne: true } }, update)`;
  0 matched → throw `ClaimLostError` (an `UnrecoverableError`). Every later write to the job's own doc goes
  through it — stage transitions, progress, `progressAt`, the preview/geocode/pin-lookup/apply completion
  writes, the heartbeat timer — **except two that are deliberately ungated**: the pin pass's ledger and
  spend write (`pinProbedIds`, `pinLookupsNew` — record what was paid for first, then check the claim: the
  spend accounting must be complete, and the same job's own retry reads that ledger so it never buys an
  address twice; a later re-import is a new job with an empty ledger, which the address cache protects), and
  the inserted-id record below.
- **The catch handles `ClaimLostError` (and `DelayedError`) first:** rethrow untouched — no doc write, **no
  raw-upload deletion** (today's catch deletes the upload for every unrecoverable error, which would make
  the next claimer fail with FileNotFound), no spill cleanup beyond its own token-named files. The
  non-fatal catches that swallow everything today — the pin pass, the revisit list, the pin lookup —
  rethrow `ClaimLostError` too.
- **The worker's `failed` listener** ([worker.js:175](../server/src/worker.js)) skips
  `err.name === 'ClaimLostError'` (the doc belongs to whoever holds the claim). When it does fail a doc it
  also sets `claimToken: null`, maps BullMQ's "job stalled more than allowable limit" to the code
  `interrupted`, deletes the upload when its CAS wins, and releases the lease the cleared token held. Its
  body moves out of `main()` into an exported `reconcileFailedImport(job, err)` so it can be tested without
  starting Workers.
- **Spill files are named by the claim token**, not just the job id (`import-spill-${importJobId}-${token}`),
  so two copies of one job in one process can't truncate or delete each other's files.
- **`writeStartedAt`** (new) is set through `jobWrite` **at the linking stage write, before the first
  `reconcileIdentityFromImport` call** — linking already inserts Persons (`resolvePerson.js`), bulk-writes
  Persons and edit proposals, and fans identity out onto voter rows across the organization
  (`reconcileIdentityFromImport.js`), before `applyImport` writes a single row. A pin lookup sets it at its
  pins stage (it writes marks and placements).
- **Inserted ids are recorded per batch in a side collection**, `ImportInsertedIds { organizationId,
  campaignId, importJobId, kind: 'household' | 'voter', ids: [≤ 2,000] }`, indexed on `{ importJobId: 1 }`,
  `{ campaignId: 1 }` and `{ organizationId: 1 }`. **`organizationId` and `campaignId` are load-bearing:**
  the campaign- and org-delete cascades delete by those fields, and under `strictQuery` a filter on a field
  the schema doesn't declare is dropped — `deleteMany({ campaignId })` on a model without `campaignId` casts
  to `{}` and would wipe **every organization's** records (checked with mongoose 8.23.1).
  - *Recorded before the write, so a crash can't lose a batch.* Each op pre-assigns its `_id` in
    `$setOnInsert` (mongoose 8.23.1's cast keeps it), and an ungated `onInserted(kind, ids)` callback records
    that batch's would-be ids **before** its `bulkWrite`. A row that already existed keeps its own id, so its
    pre-assigned one never exists; every reader already skips ids that don't exist, and Undo's tracked counts
    change to count documents that do. Without this, the batch in flight when the worker dies (the commonest
    crash: out of memory during the home write) would never be recorded, and the retry's upserts find those
    rows already there.
  - *One reader for both shapes.* `insertedIdsFor(importJobIds, kind)` = the side collection ∪ the legacy
    arrays on older docs, used by **every** reader: Undo (`undoImport`, `undoFileImport`),
    `collectRevisitHomes` (which today picks this run's ids *or* the persisted ones; it unions), the
    households map scope behind the history row's **View on map** (`routes/admin/households.js`), and the
    **export from an import** estimate and builder (`exportEstimates.js`, `exportBuilders.js`), which the
    web Exports page and the phone's export sheet both offer. Missing any one of them would make new imports
    show an empty map or export zero rows.
  - *Why not the array on the ImportJob:* with explode, the row cap counts *source* rows, so 300,000 rows ×
    3 members ≈ 900,000 voter ids ≈ 18 MB — past the 16 MB document limit, which today's single
    end-of-import write would also hit. `seedDemoOrg.js`'s own `applyImport` call passes no callback and
    keeps writing the arrays, which `insertedIdsFor` still reads.
- **Undo answers 409 while a sibling attempt of the same file is unfinished** — today it marks queued and
  running siblings `undone` with no status filter, and a running one's rows then can't be undone.
- What the token buys: a cancelled, withdrawn or `stuck` doc stops a still-running processor at its next
  write (within one batch: 2,000 rows when writing, 5,000 when linking, one lookup batch in the pin pass,
  or the next pass boundary); a stall-requeued copy that claims while the original is somehow alive takes
  the claim and the original stops — and the copy cannot write rows before it holds the organization lease
  (C4), which the original's lease protects for 90 s after its last renewal; a redelivery after success is
  skipped (the doc is `completed`); the pin-lookup enqueue-timeout zombie is skipped.
- Import Worker options: `lockDuration` 90 s (TURF's value), so a lost lock needs a 90-second event-loop
  block, not 30. **`maxStalledCount` stays 1** until the memory fixes and the §I gate pass: at 2, a file that
  always runs out of memory crashes the shared worker three times — killing every turf cut, export and
  delete on it each time — before it fails. The cost of 1: two worker restarts during one import fail it as
  `interrupted` — and deploys and Heroku's daily dyno restart count (a deploy's shutdown exits after its
  25-second drain). Note that hazard in [OPERATIONS.md](OPERATIONS.md): avoid deploying while a big import is
  running.
- `processImportJob(job, bullToken)` takes BullMQ's second argument (needed by C4); `processPinLookupJob`
  gets the same claim and `jobWrite`.

### C2. Retry honesty

In the catch of both processors, after the `ClaimLostError`/`DelayedError` passthrough, compute BullMQ's
own decision:

```js
const unrecoverable = err instanceof UnrecoverableError || err?.name === 'UnrecoverableError' || /* today's FileNotFound / ImportTooLarge / LegacyXls */;
const willRetry = !unrecoverable && (job.attemptsMade ?? 0) + 1 < (job.opts?.attempts ?? 1);
```

`willRetry` → `jobWrite({ $set: { status: 'pending', phase: null, claimToken: null, lastError,
retryAttempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts, progress: null, processedRows: 0,
queuedSince: new Date() } })` and release the organization lease — progress reset so the badge can't read
"Waiting 60%"; `maxAttempts` stored so the label can say "attempt 2 of 3". Otherwise today's `failed` write,
as a `jobWrite`, keeping the processor's own error code (C1's failure-line precedence). BullMQ's remaining
refusals (`discarded`, a backoff of −1, a closing connection) aren't used; if one ever fires, the `failed`
listener reconciles the doc as it does now.

Because a retry waits as `pending`, the claim needs no special case for retries: `failed` and `completed`
are written only when nothing will run again — so they are final.

### C3. Heartbeat vs progress

One `setInterval` (30 s) for the whole run of every kind writes `heartbeatAt` through `jobWrite` (alive),
and — after a successful heartbeat write only — renews C4's organization lease (`expiresAt`, `renewedAt`);
once a heartbeat write matches nothing (the claim is gone), the timer stops and clears itself, so a
processor that lost its claim can't keep its organization's lease. `progressAt` moves only at claims and
with real progress (B3). The pins stage's and `processPinLookupJob`'s own timers become this one.

### C4. One import per organization at a time

After the claim and **after the campaign/org guards** — inside the `try`, so `finally` always releases it
(today those guards run outside the `try`, and a lease taken before them would skip the release) — take an
organization-level lease, the pattern `placeStackedPins` uses for its per-campaign lease:

```js
const now = new Date();
const leased = await Organization.updateOne(
  { _id: orgId, $or: [
    { 'importLease.owner': null },
    { 'importLease.expiresAt': { $lt: now } },
    // Our own BullMQ job's lease, left behind by a crash or deploy — but only once it has gone unrenewed
    // for 90 s, so a stall-requeued copy can't take it from an original that is still alive.
    { 'importLease.jobId': String(job.id), 'importLease.renewedAt': { $lt: new Date(now - 90_000) } },
  ] },
  { $set: { importLease: { owner: token, jobId: String(job.id), expiresAt: new Date(+now + 5 * 60_000), renewedAt: now } } }
);
if (!leased.modifiedCount) {
  await job.moveToDelayed(Date.now() + 20_000, bullToken);                 // first: if this throws, nothing has changed
  await jobWrite({ $set: { status: 'pending', claimToken: null, waitingFor: 'org', phase: null, progress: null } });
  throw new DelayedError();                                                // re-scheduled without counting an attempt
}
```

- Why the job id: a deploy's `process.exit(0)` after the 25-second drain, or an out-of-memory abort, skips
  every `finally`, so the lease outlives its holder by up to 5 minutes; without the `jobId` clause the
  requeued job would wait on its own lease and read *"another import from your organization is running"*.
- **Its own lease, not yet 90 s stale:** with a 90 s lock, BullMQ redelivers a crashed job 45–120 s after the
  crash, while the lease was renewed at most 30 s before it — so the 90 s guard often still holds at
  redelivery. When the only blocker is a lease whose `jobId` is this job's own, wait **in-process** until
  `renewedAt + 90 s` (at most 90 s; the job keeps its slot and its place in line) and retry the lease once,
  instead of the 20-second delay that would send it to the back of the line. Never label that wait
  *org-busy*.
- Every lease write passes `{ timestamps: false }` (Organization has timestamps on; without it every 30-second
  renewal bumps the organization's `updatedAt`) — as `placeStackedPins.js` already does for its campaign
  lease.
- Released (`$set: { importLease: null }` where `owner` matches) in `finally`, and by **every CAS that clears
  a claim from outside** — Cancel/withdraw, `stuck`, `lost`, `queue-failed`, `requeued`, the failed listener —
  where `owner` is the cleared token. Renewed only by C3's timer while the claim holds; expires on its own if
  the worker dies.
- `moveToDelayed` passes `skipAttempt` (no attempt counted), removes the lock and the stalled mark, and the
  lock manager stops tracking the job; `handleFailed` neither fails it nor emits `failed` for a
  `DelayedError` (bullmq `dist/esm/classes/worker.js:595-597, 647-658`); with a stale lock it returns an
  error code and throws before changing anything. A job delayed for its organization goes to the **back**
  of the line when promoted (delayed jobs are LPUSHed).
- Who takes it: full imports and pin lookups (the lookups count nothing, but this keeps one organization
  from holding both slots); previews and See-exact-placement checks do not (they write nothing, and they
  are what a waiting person is staring at). So at concurrency 2, two full imports always belong to two
  different organizations — a preview can still run beside its own organization's import.
- Effects: every count is a clean before/after again — no other import is writing into the organization
  meanwhile.
- File order within one campaign is not guaranteed by C4, and isn't today either: a retry's backoff can
  already let a later file run first. C4 adds the org-wait cycle to the ways that can happen. If file order
  ever matters, that's a per-campaign sequence number on the claim — out of scope here.

## D. Campaign deletes (and org deletes)

- `isStaleDeletion` drops both its doc-only timers. For a campaign whose stamp is `pending` **or `running`**,
  a **delete-specific adapter** reads `campaign-delete-queue` (B2 with that queue and its own heartbeat key):
  - inputs: status ← `deletion.status`; created/queued ← `deletion.requestedAt`; job heartbeat ←
    `deletion.heartbeatAt` (the cascade's 30-second timer). A stamp holds nothing else.
  - **no `stuck` and no 24-hour withdraw** — the cascade has no progress signal (single multi-minute
    deletes), so B3's 30-minute rule would fail a healthy delete that queued behind others; a delete is
    never withdrawn (the person asked for it).
  - in line or `requeued` → **no write**, shown as waiting in line (the next claim takes it; the delete's
    claim already accepts `pending`, `running` and `failed`);
  - `lost` or `queue-failed` → CAS the `pending`/`running` stamp to `failed` with today's Retry message;
  - none of B3's ImportJob machinery (claim tokens, raw uploads, the org lease) applies.
  A queued delete stays pending, and a crash-requeued `running` delete waits in line instead of being
  failed. The card reads *"Deleting… waiting in line"*
  ([CampaignCard.jsx](../client/src/components/campaigns/CampaignCard.jsx),
  [CampaignsTable.jsx](../client/src/components/campaigns/CampaignsTable.jsx)).
- `GET /admin/campaigns` is hot and mobile-facing (the phone reads it from about eleven places). It runs the
  Redis round **only for `pending` and `running` stamps** (a `failed` stamp offers Retry; one that BullMQ is
  about to retry flips itself back to `running` at its next claim, since the delete's catch writes `failed`
  on every attempt — so `failed` is not final for deletes, and none of this changes that), in parallel
  under one ~1.5 s budget, skipped outright when Redis isn't ready (B2) — never a sequential 5 s per
  campaign.
- `campaignDeletionHealth` (`deletionState.js`) reports a pending delete that is in the line as **queued**,
  not **stuck**, with an upper bound like `orgDeletionState.js`'s "unstarted" one — so a normal queue
  doesn't turn the super-admin retention banner red, and a lost delete doesn't read healthy forever.
- The delete's claim keeps accepting `failed` (a delete finishing after a stale verdict is what was asked
  for, and Retry would do the same).
- `test/campaignDeleteJob.int.test.js` ("expires stale deletions to failed") asserts a 10-minute pending
  delete and a stale running one expire; it changes to: queued → stays pending; requeued running → waits;
  lost (not in the queue) → failed.
- Org deletes: unchanged (6 h); adopting the verdict is optional.

## E. Client, copy, schema, and side effects

- **Schema (load-bearing):** `config/db.js` sets `strictQuery`, which silently drops filter fields a schema
  doesn't declare — a forgotten `claimToken` would turn every CAS and `jobWrite` into `{ _id }`, which always
  matches — and on a model that lacks the field entirely, a delete filtered on it matches *everything* (C1).
  Declare on `ImportJob`: `claimToken`, `progressAt`, `queuedSince`, `requeuedAt`, `writeStartedAt`,
  `retryAttempt`, `maxAttempts`, `waitingFor`, `failCode`; on `Organization`: `importLease { owner, jobId,
  expiresAt, renewedAt }`. New collection `ImportInsertedIds` (C1) with `organizationId`, `campaignId`,
  `importJobId`, `kind`, `ids`, indexed on each of the first three — new indexes, so
  `npm run migrate:build-indexes -- --apply` is a release gate (production autoIndex is off). Add
  `claimToken` to `ORG_HIDDEN_IMPORT_FIELDS` (responses only; the verdict re-reads, B3).
- [ImportPage.jsx](../client/src/pages/ImportPage.jsx) `previewPendingLabel(job, queue)`, the
  See-exact-placement button, and history rows: `in-line` → *"Waiting in line — N ahead (m:ss)"* / *"Next
  in line"*; `resuming` → *"Resuming — N ahead"*; `org-busy` → *"Waiting — another import from your
  organization is running"*; `system-down` → *"Waiting — the import system isn't running right now"*;
  `paused` → *"Waiting — imports are paused"*; `retrying` → *"Retrying after a problem (attempt 2 of 3)"*,
  or *"Retrying — N ahead"* once BullMQ has put it back in line; `unreachable` → *"Waiting — can't reach the
  import system right now"*. The badge shows no percent for `pending`.
- **Cancel** while queued on everything that waits: previews (today), full imports in the history row menu,
  See-exact-placement checks (they buy paid lookups), and Pin Fixes lookups. None once `writeStartedAt` is
  set (B4). A failed See-exact-placement check shows its message (today it shows none).
- [pinFixes.js](../client/src/lib/pinFixes.js) `lookupToast`: sentences for `expired`, `lost`, `stuck`,
  `queue-failed`, `cancelled`, `undone`, `interrupted` and the legacy
  `stale-unclaimed`/`stale-heartbeat`; any other `lastError` that isn't one of the processor's own sentences
  (the worker's failed listener writes the raw error message) falls back to *"The lookup couldn't run…"*.
  [PinFixesPage.jsx](../client/src/pages/PinFixesPage.jsx) passes the lookup's waiting state down so
  [PinFixCards.jsx](../client/src/components/PinFixCards.jsx) can say *"Waiting in line…"*.
- **Busy checks stop counting jobs that only read or only fix pins.** The campaign-delete and org-delete
  busy checks (`routes/admin/campaigns.js`, `routes/superAdmin/organizations.js`) count any unfinished
  import, including `preview` and `geocode_check` jobs (they write nothing, and the admin can't see them in
  the history to cancel) and `pin_lookup` jobs (they update homes by `_id` only, with no upsert, and their
  claim already refuses a deleting campaign). Exclude those three kinds.
- Copy and docs cascade: [IMPORTS.md](IMPORTS.md) (Part 1's queued/stale text, the worker-status
  description, the stale-job section); Help Center [faq/import-taking-long.md](../server/src/content/help/faq/import-taking-long.md),
  [guides/voter-imports.md](../server/src/content/help/guides/voter-imports.md),
  [pages/page-voter-import.md](../server/src/content/help/pages/page-voter-import.md), and the campaigns
  guide plus [faq/archive-vs-delete-campaign.md](../server/src/content/help/faq/archive-vs-delete-campaign.md)
  for the delete line (both being edited by another session today — merge after it lands);
  [CAMPAIGNS.md](CAMPAIGNS.md); [EARLY_VOTING.md](EARLY_VOTING.md) (the parked pile); [OPERATIONS.md](OPERATIONS.md)
  (the `sweep-stale-imports` row, the `sweep:raw-imports` script, the heartbeat keys, Bull Board
  Retry/Pause); [EXPORTS.md](EXPORTS.md) (its worker-status is "the imports worker-status pattern");
  [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (its "fail with a message within minutes" sentence, and K).

## F. Memory: where it goes (measured)

Method: a scratch copy of HEAD (`f906408`) with a probe at every stage boundary that records the highest
heap the previous step reached, then forces two full GCs and records what is still **held**. File: a
synthetic 166,738-row × 35-column xlsx shaped like FL-22 (112,385 homes, apartment units counted
separately; written by exceljs's streaming writer, so it takes the importer's zip-normalization path),
Node 20 (as on Heroku), local mongod, address lookups off, each run in a fresh process (no long-lived
worker caches — `placeStackedPins` keeps a module-level cache of up to 200,000 entries across jobs).
Scenarios: P1 = apply into an empty campaign; P2 = the same file re-imported into it; P4 = a different 166k
file into the now-full campaign (333k voters); P3/P5 = previews. **These peaks were taken with a 4 GB cap,
so they include garbage V8 had not collected** — read them as where the churn is, and read *held* as the
floor. Need is decided by the capped runs in §G. **Totals:** "total" below is macOS's *maximum resident set
size*, which leaves out compressed pages — a lower bound (in uncapped runs it came out *below* V8's used
heap, which only compression explains). Where noted, the *peak memory footprint* (which counts compressed
memory, and is the better proxy for Linux, where Heroku measures) was captured instead. Over the capped runs
that captured it, footprint ran **150–310 MB above peak heap** — budget a cap with that much room under
the dyno's quota. (Resident figures swing both ways and mean little here: 17–122 MB above the heap in the
earlier capped runs, but 216 MB *below* it in one G-run — that is compression.) Even footprint is a
**lower bound for the dyno**: it counts the node process only — not the `npm` parent the Procfile keeps
resident, not the real worker's larger baseline (the harness loads only the processor), and not page cache
from spill and spool files, which Heroku's R14 accounting includes — and it was taken on arm64 macOS, not
Heroku's x86-64 Linux. Confirm on Heroku with `log-runtime-metrics` during one big import.
**Provenance:** the first today's-code results (one import crashing at 384 and 512; one at 1024 — heap 552,
600 total; two at once at 384 — crash, and at 1024 — heap 1,006, 1,078 total; import plus preview at 1024 —
heap 753, 770 total) come from this session's first `measure.mjs` runs, whose output was captured in the
working session rather than in a log file; every later number is in a scratch log.

| Step | P1 peak / held (MB) | P2 re-import | P4 campaign → 333k |
|---|---|---|---|
| parse (spill on) | 233 / 125 | 336 / 124 | 272 / 124 |
| link people | 655 / 142 | 646 / 141 | 665 / 141 |
| load prior voters (who-moved, before) | 148 / 134 | **418 / 207** | 148 / 133 |
| build all home ops | 209 / 184 | 283 / 258 | 209 / 184 |
| **write homes** | **526 / 490** | **862 / 552** | **513 / 490** |
| home address → id map | 532 / 514 | 692 / 576 | 627 / 513 |
| write voters (after the shield prefetch) | 308 / 199 | 503 / 233 | 333 / 199 |
| **recompute cut attributes** | **419** / 171 | **615** / 208 | **736** / 171 |
| early voting, DNC, do-not-knock (no voted or DNC data seeded) | 172 / 171 | 209 / 208 | 171 / 171 |
| who-moved (after) | 252 / 227 | 396 / 207 | 285 / 227 |
| destination ids + door re-check (`recomputeHouseholdActive`) | 375 / 253 | 646 / 172 | 417 / 253 |
| map-pin pass | 498 / 120 | 553 / 101 | 480 / 110 |

Previews: P5 (empty campaign) parse 557 / **208 held** (every valid row in memory — no spill on the
preview or See-exact-placement path), diff 268; P3 (re-import) parse 450 / 208, diff 753.

What the numbers and the code say:

1. **Home writes hold ~300 MB more than they need.** `applyImport` builds `householdOps` for every home
   (`householdValues.map(...)`) before writing 2,000 at a time ([csvImporter.js](../server/src/services/import/csvImporter.js)),
   and Mongoose's `castUpdateOne` (mongoose 8.23.1, `helpers/model/castBulkWrite.js`; `Model.bulkWrite`
   casts the caller's own op objects) **rewrites each op in place**: it clones the update, adds timestamps,
   merges every schema default into `$setOnInsert` (`setDefaultsOnInsert`), adds the version key, then
   assigns the cast filter and update back onto the op. The array stays referenced through the whole home
   phase: 184 → 490 MB held across the write (released later inside `applyImport`, by the shield-pass
   probe). The same in-place retention exists in `recomputeFullyVoted`, `recomputeFullyDnc` and the
   original cut recompute.
2. **`recomputeCutAttributesForCampaign` loads the whole campaign.** One `Household.find({ campaignId })`
   array, one `$in` of every home id, one `Voter.aggregate` returned whole, a map of every home's voters,
   and an `ops` array for every home ([computeCutAttributes.js:51](../server/src/services/turf/computeCutAttributes.js)).
   Its churn grew from 419 to 736 MB peak when a same-size file went into a campaign twice as big (P1 → P4).
   (Its single `$in` of every home id would also hit MongoDB's 16 MB document limit around 800k homes.)
3. **The re-housing audit and the door re-check materialize.** `findInChunks` returns arrays of every prior
   and post voter doc (projection `{ stateVoterId, householdId }`) ([importProcessor.js:375](../server/src/services/import/importProcessor.js),
   `:497`); on a re-import that is +66 MB held. `recomputeHouseholdActive` ([recomputeHouseholdActive.js](../server/src/services/import/recomputeHouseholdActive.js))
   then does one unchunked `Household.find({ _id: { $in } })` over every touched id and one unchunked
   `Voter.aggregate` `$in`, with several id arrays and maps alongside — the 646 MB peak on a re-import is
   this step. Undo calls it too.
4. **Previews and See-exact-placement checks hold the file.** `useSpill` is off for both kinds, so
   `validRows` (about 85 MB more than the apply path's floor) sits in heap; a See-exact-placement check uses
   only the address map and never reads the rows at all. A preview's `computeImportDiff` then materializes
   existing households, existing voters (with `fullName`), their source homes and person maps on top. Even
   so, a big re-import preview completes under the 384 default (§G).
5. **The map-pin pass grows with the campaign.** It streams every located home of the campaign, active
   and inactive, into `byKey`/`activeById` as compact ~17-field objects (`placeStackedPins.js:250-262`),
   so its live set is linear in campaign size — its own design budgets it against 250k doors. The flat
   498 → 480 peaks above are 4 GB-cap churn and hide that; no capped run has used a big campaign yet (§I).
6. **Early voting — the largest allocation, and it grows every day until the election.**
   - `reapplyVotedLists` loads every parked `VotedPendingId` of every live upload in one array, maps it, and
     looks up every spelling of every parked id ([reapplyVotedLists.js](../server/src/services/voted/reapplyVotedLists.js));
     when any of them graduate, it then calls `clearParkedByCanonical`, which **loads every parked row of
     the campaign again** (`voterIdLookup.js:155-162`, `Model.find(filter, { stateVoterId: 1 }).lean()` —
     its comment assumes "parked rows are few").
   - Voted-list uploads park their unmatched ids **once per upload** with no de-duplication across uploads
     (`routes/admin/voted.js`; the `{ campaignId, stateVoterId }` index is not unique), so a campaign that
     uploads its county's cumulative early-vote file daily parks the same ids again every day.
   - `recomputeFullyVoted` runs over **every** fully-voted door of the campaign on every import
     (`importProcessor.js:470-472`), with unchunked `$in` queries and one op per door.
   - **The same helper runs on the website's server**, inside the voted-list upload route (whenever the
     upload matches anyone; the uploaded file itself sits in memory, `multer.memoryStorage()`) and the
     do-not-contact upload route — so a big pile threatens the web dyno too, not only the worker.
   - Measured 2026-10-13, into a full campaign with 40% of its doors fully voted. The E/H runs re-imported
     the same file and used parked ids that never matched anyone, so the step returned before the voted
     upserts and the second load — those are floors. The **G-runs** imported a *different* file — 166,738 new
     people, taking the campaign to 333k voters — with numeric Georgia-style ids with leading zeros, and parked
     lists that include 30,000 of those new voters (half spelled without the zero, as Excel leaves them), so
     the import graduates them and runs the whole path. They also carry a growing campaign's costs (like P4),
     so G versus E/H is not graduation alone:

     | Scenario (1.2M parked rows unless noted; 40% of doors fully voted) | Code | Cap | Result | Peak heap | Resident | Footprint |
     |---|---|---|---|---|---|---|
     | 200k parked, none graduating | fixed | 384 | completes | 313 | 430 | — |
     | none graduating (a floor) | fixed | 384 | crashes | — | — | — |
     | none graduating (a floor) | fixed | 768 | completes | 755 | 863 | — |
     | none graduating (a floor) | today | 768 | crashes | — | 835 | — |
     | none graduating (a floor) | today | 1024 | completes | 896 | 998 | — |
     | **30k of the file's voters graduating** | fixed | 768 | **crashes** | — | 807 | 987 |
     | **30k graduating** | fixed | 1024 | completes | 884 | 933 | **1,148** |
     | **30k graduating** | today | 1024 | completes | 868 | 908 | **1,176** |
     | **30k graduating** | today | 1536 | completes | 1,094 | 878 | **1,365** |

     Graduation was verified in every completed G-run: voted voters 66,697 → 96,697, parked rows
     1,200,000 → 1,020,000. Once ids graduate, this step dominates the import and fixes 1–3 don't touch it:
     both versions need more than a Standard-2X's 1,024 MB of footprint even at a 1024 cap (resident
     figures understate it — note today's code at 1536 shows *less* resident memory than at 1024, while its
     footprint is 190 MB higher).

7. **Do-not-contact has the same pattern, organization-wide.** `reapplyDncLists` (run on every import,
   `importProcessor.js:480`) loads the organization's whole parked DNC pile into one array
   (`reapplyDncLists.js:27-30`) and then runs one **unchunked** `Voter.find({ organizationId, stateVoterId:
   { $in: svids } })` (`:44-47`) — past roughly 730,000 distinct ids that command passes MongoDB's 16 MB
   limit and the import fails on every attempt. DNC uploads also park per upload, with no de-duplication
   (`routes/admin/dnc.js`). No run above had DNC data.
8. **Smaller holds.** A retry starts heavier: the claim loads the full document, including persisted
   `sourceHouseholdIds` and inserted-id arrays — on purpose (C1). `errors` keeps one object per rejected row
   though only 100 are saved. Linking churns heavily (655 peak) but keeps only +17 MB.

## G. Memory fixes — prototyped and measured

Applied to the scratch copy only (the repo is untouched):

1. **Batch-built home ops.** `const householdOp = (h) => { …same body… }` and, in the write loop,
   `Household.bulkWrite(householdValues.slice(i, i + batchSize).map(householdOp), …)`. Verified identical by
   review: same ops in the same order (the builder reads only lookups prefetched before the loop), the three
   counters it increments are read only in the return value, progress and `insertedHouseholdIds` unchanged.
2. **Paged cut-attribute recompute.** Page the campaign's homes, aggregate only that page's voters, build
   and write that page's ops; the same per-home `computeCutValues` (it reads only the home and its own
   voters), campaign-wide as before. **As prototyped it paged on `_id`, a regression to fix before
   building:** there is no `{ campaignId: 1, _id: 1 }` index, so the planner walked the `_id` index across
   every tenant's homes (`docsExamined` 224,871, then 337,256, for a page of 2,000). **Build it on the
   existing unique `{ campaignId, normalizedAddress }` index** (`Household.js:203`; no collation anywhere,
   so `$gt` pages exactly) — `normalizedAddress: { $gt: last }`, `sort({ normalizedAddress: 1 })`,
   `.hint({ campaignId: 1, normalizedAddress: 1 })` — never an unhinted cursor: the planner could otherwise
   pick a `{ campaignId, precinctValue | countyValue | cityValue }` index, and this pass rewrites those very
   keys. **Ties:** `modal()` keeps the first value at the top count, so an exact tie is won by whichever voter
   the aggregate emits first — an order MongoDB doesn't specify, arbitrary today and changeable by paging.
   Push each voter's `_id` into the group and sort each home's voters by it in JS before `modal()` (a
   `$sort` stage before `$group` would add a candidate plan that walks the whole `_id` index). The
   `cutConflicts` flag is identical either way.
3. **Streamed re-housing audit.** Build `priorHhBySvid` straight from a cursor per 5,000-id chunk; count
   moved voters from a second cursor without an array; collect destination ids as strings.
   `sourceHouseholdIds` comes from the map's values. Verified identical by review (at most one voter per id
   per campaign, unique index): same `priorHhBySvid`, `sourceHouseholdIds` (same set and order),
   `movedVoters`, `touchedHhIds` and pin-pass `tallyIds`.

Results, 2026-10-13. Cap = `--max-old-space-size`, i.e. `WORKER_MAX_OLD_SPACE`; *completes* means the whole
import finished; heap = V8's peak used heap; total = peak resident memory from `/usr/bin/time -l`, in binary
MB like Heroku's 1,024 MB quota — a **lower bound** (§F); *footprint* where captured. Peak heap rises with
the cap because V8 collects lazily when it has room, so the need is bracketed by the caps a run crashes and
completes at — compare caps, not peaks taken at different caps.

| Run | Current code | With fixes 1–3 |
|---|---|---|
| One big import, empty campaign | crashes at 384 and 512; completes at 768 (heap 632, 681 total; a re-run: heap 562, **footprint 710**) and 1024 (heap 552, 600 total) — **needs 512–768** | **completes at 384** (heap 314, 394 total; a re-run: heap 303, **footprint 598**); crashes at 256 — **needs 256–384** |
| One big re-import into the full campaign | completes at 768 (heap 658, 689 total) | **completes at 384** (heap 312, 416 total) |
| Two big imports at once (two orgs, empty campaigns) | crashes at 384; completes at 1024 (heap 1,006, **1,078 total — over a Standard-2X's 1,024** even on the lower-bound measure) | **completes at 512** (heap 470, 577 total; re-run **footprint 742**) and 768 (heap 576, 673 total; re-run **footprint 801**) |
| Big re-import preview | completes at 384 (heap 365, 478 total) — the preview path is unchanged by fixes 1–3 | same code |
| One org's big import + another org's big re-import preview, started together | completes at 1024 (heap 753, 770 total) | **completes at 512** (heap 488, 604 total) and 768 (heap 631, 711 total; re-run **footprint 838**) |
| Re-import with early-voting data | see §F.6 | see §F.6 |

Every run reported the same counts with and without the fixes (166,738 rows; 166,738 new or updated
voters; 112,385 homes). Two gaps in what was measured: the import-plus-preview runs started both jobs
together, so the 22-second preview overlapped the import's parse and link, not its peak; and the two-import
runs used empty campaigns, so neither carried a re-import's who-moved and door re-check holds.

## H. Memory fixes — designed, not prototyped

- **Early voting — build first, before the election (§F.6).** In order:
  - **1. `clearParkedByCanonical`, rewritten in place — ship alone, first.** Keep its signature
    `(Model, filter, canonicals)` and replace the body: instead of loading every row matching `filter` and
    filtering in memory, delete `{ ...filter, stateVoterId: { $in: <spellings> } }` in chunks of at most
    5,000 spellings, **always spreading the caller's own filter** — that is what keeps each caller's scope:
    `{ campaignId }` for voted lists, and for do-not-contact `{ organizationId, … }` with its state rule.
    **Never write a do-not-contact filter with `campaignId`:** `DncPendingId` is organization-wide and has
    no such field, so under `strictQuery` the condition is dropped and the delete would remove **every
    organization's** parked do-not-contact requests with those spellings — people's "never contact me"
    requests, lost. Spellings come from `voterIdVariants` padded only to the **widest spelling actually
    parked** (computed once per campaign, or stored per upload) — padding a 7-digit id to the 24-character
    maximum costs 18 spellings instead of 2. (A parked spelling longer than 24 characters, which no real id
    is, would be missed; today's in-memory filter would reach it.) This removes the pile load from the web
    dyno's two upload routes and the worker's second load, changes no result, and is the smallest possible
    release before the election.
  - **2. Graduation in bounded chunks.** An import can only graduate parked ids of voters it just brought in.
    Take this file's canonical ids **that reached the campaign** (rejected rows don't), in chunks of whole ids
    (≤ 5,000 spellings per chunk, every spelling of an id in the same chunk, spellings generated per chunk);
    per chunk: find the live uploads' parked rows on the `{ campaignId, stateVoterId }` index → find the voters
    present → credit each graduation to the earliest upload among that id's parked rows (deterministic; today
    it follows whatever order the unsorted `find` returns) → upsert `VotedVoter` → `$inc` each upload's
    `matched` from the upserts' actual results (counting from a pre-read double-counts if two imports graduate
    the same voter) → delete exactly those parked rows by `_id`. Memory is one chunk. Time still grows with how
    many uploads parked each graduating id — 30,000 ids × 6 uploads was 180,000 rows in the G-runs — which is
    why the post-election de-duplication below matters.
  - **3. A nightly backstop** for what file-scoping misses: a voted-list upload racing an import (the upload
    parks an id just after the import's graduation step), and an import that wrote voters but died before
    graduating, whose voters never arrive in another file. (Walk-up voters are not a case: they get
    `stateVoterId: manual:…`, which a voted list can never carry, `routes/mobile/canvass.js:1119`.) One
    streaming cursor per campaign, `find({ campaignId, uploadId: { $in: live } }).sort({ uploadId: 1 })
    .hint({ uploadId: 1 })` (upload ids are time-ordered, so the first upload seen for an id is the earliest;
    each upload belongs to one campaign, so the scan stays inside it), batch-wise lookup, graduation and
    delete-by-`_id` (safe behind the cursor; no indexed key is rewritten); the id width computed once per
    campaign (today `findVotersByVoterIds` re-runs a campaign-wide width aggregate on every call); campaigns
    and organizations being deleted are skipped. Never paged by `_id` — no `{ campaignId, _id }` index, the
    cross-tenant plan problem of §G fix 2.
  - **4. Do-not-contact, its own way.** `reapplyDncLists` file-scoped with a chunked `$in` (which also removes
    the 16 MB failure), keeping its **exact, state-aware** matching (unlike voted lists, by design — two
    states can issue the same digits), plus a **nightly organization-scoped DNC backstop** (exact,
    state-aware, delete by `_id`, skipping deleting campaigns) — because today's reapply runs organization-wide
    on every import and so heals cases a file-scoped one never revisits: a DNC upload racing an import, an
    import that died after writing voters, and **a campaign's `state` being corrected** (parkings key on the
    campaign's state, and admins can change it). Alternatively, re-run DNC graduation when a campaign's state
    changes. A test pins that a second organization's parked request survives every DNC clear.
  - **5. Page `recomputeFullyVoted`** at 2,000 doors (find, `VotedVoter` lookup and write per page) — it also
    serves voted-list uploads and undo — and keep writing **every** listed door: the write bumps the door's
    timestamp, which is how phones' change feed learns of voted marks.
  - **6. The two upload routes on the website's server** stop holding whole files: disk storage instead of
    `multer.memoryStorage()`, and parse only the id column instead of every column of every row (the import
    route made exactly this change after its own web-dyno R14s).
  - **After the election — stop the pile growing:** one parked row per `{ campaignId, canonical id }`, with a
    stored `canonical` field and an `uploadIds` array (add on upload, `$pull` on undo, delete when empty;
    `uploadIds[0]` keeps the graduation credit). Order matters: a one-off migration first collapses today's
    duplicates and backfills `canonical`; only then can the unique `{ campaignId, canonical }` index build (a
    unique build fails on duplicates) — through `migrate:build-indexes`, since production autoIndex is off —
    plus an index on `uploadIds` for undo's `$pull`; code reads both row shapes until the migration is done.
- **Page the door re-check.** `recomputeHouseholdActive` at 2,000 ids per page (find, aggregate and write per
  page); undo uses it too.
- **Release the file's homes after the home write.** It can't be done from the processor as it stands:
  `applyImport` is one await, `householdValues` inside it holds every home until the address-map step, and
  `uniqueHouseholds: householdMap.size` is read after the voter write. So: capture the size first, drop
  `householdValues` after the address map is built, clear the map inside `applyImport`, and keep only the
  keys in the processor. Saves about 78–79 MB (the drop measured at the map-clear probe: 253 → 175,
  172 → 94, 152 → 73) from the voter write onward.
- **Previews and See-exact-placement checks spill too.** Let both use the NDJSON spill (a See-exact-placement
  check needs only the address map, so it can skip writing rows entirely), and give `computeImportDiff` a
  streaming input. Constraints: `forecastPersons` classifies rows against key maps built from *all* rows (last
  write wins), so it needs two passes over the spill; the synchronous `POST /csv/preview` route on the web
  dyno still passes arrays (the client no longer calls it — retire it); and previews would then write voter
  rows to dyno disk, which [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) scopes to "the worker's apply
  path" today — update it in the same change (no policy text changes).
- **Compact diff maps.** `existingBySvid` needs `householdId` for moves and `fullName` only for the ≤100
  sampled movers: build it from a cursor as `svid → hhId` and fetch names for the samples alone. Same for
  `existingHouseholds` (a set of addresses from a cursor) and `fromHouseholds`.
- **Capped errors.** Keep the first 100 error objects plus a count per error code (`computeImportDiff.js`
  counts codes over the full array today), instead of one object per rejected row.
- **Not pursued:** scoping the cut recompute to the homes this file touched. Voter edits
  (`routes/admin/voters.js` saves precinct and districts with no recompute) and undo (deletes voters with no
  recompute) rely on the next import's campaign-wide pass to heal those homes; a touched-only pass would
  leave them stale for turf cuts. After fix 2 the campaign-wide pass holds one page, so scoping would save
  time, not memory.

## I. Capacity: what fits where

From §G and §F.6, for a 166k-row file, lookups off, on a **Standard-2X (1,024 MB)**, the import alone in
the worker (turf cuts, exports and deletes share the same heap and were not running):

| Setup | Concurrency | `WORKER_MAX_OLD_SPACE` | Footprint | Fits a Standard-2X (1,024 MB)? |
|---|---|---|---|---|
| Today's code, no early-voting data | 1 | unset (384) | — | **No** — one big import crashes |
| Today's code, no early-voting data | 1 | 768 | 710 MB | Yes |
| Today's code, early-voting ids graduating (1.2M parked) | 1 | 1024 | 1,176 MB | **No** — over the quota; swaps |
| Fixes 1–3, no early-voting data | 1 | unset (384) | 598 MB | Yes |
| Fixes 1–3, no early-voting data, two imports (two orgs) | 2 | 512 | 742 MB | Yes, on what was measured |
| Fixes 1–3, no early-voting data, two imports (two orgs) | 2 | 768 | 801 MB | Yes, on what was measured |
| Fixes 1–3, import + another org's preview | 2 | 768 | 838 MB | Yes, on what was measured |
| Fixes 1–3, early-voting ids graduating | 1 | 1024 | 1,148 MB | **No** — the early-voting fix is what's missing |
| Today's code, early-voting ids graduating, on **Performance-M** (2.5 GB) | 1 | 1536 | 1,365 MB | Yes — measured; the stop-gap sets ~2000 for headroom (below) |

**The gate before `IMPORT_JOB_CONCURRENCY` goes above 1** (each measured with the built code, capped, on
footprint rather than resident size):
1. **Piece 1's one-import-per-organization lease (C4).** Without it concurrency corrupts counts whenever two
   imports share a campaign or an org — a correctness bug, not a memory one. The code default of 2 should
   become 1 in the same change, so an environment without the variable never runs two by accident.
2. **The early-voting fix (§H), then early-voting data at a realistic size** — several cumulative lists
   parked, ids graduating, 30–50% of doors fully voted — **and a DNC pile.**
3. **A big campaign:** a fixed-code import into a 333k-voter campaign at the target cap (the pin pass and
   the door re-check grow with the campaign).
4. **A file at the caps:** `MAX_IMPORT_ROWS` 300,000 / `MAX_IMPORT_CELLS` 8,000,000 — the test file is 166k.
5. **Address lookups on:** a file without coordinates, against a stubbed provider or a pre-warmed cache (the
   geocode maps, holding spots and the paid pin path never ran here).
6. **Neighbour jobs:** an import alongside a 250k-door turf cut, and alongside a big export.
7. **Overlap at the peak:** a preview started while another import is at its heaviest step, and two
   re-imports into full campaigns at once.
8. **A long-lived worker:** several imports back to back in one process (module-level caches persist).
9. Measured on Linux, or on macOS with the *peak memory footprint* — not macOS resident size.

**768 vs 1024.** At a lower cap a runaway import hits a clean V8 out-of-memory restart (the job is retried,
or failed honestly under piece 1 — though every crash also kills whatever turf cut, export or delete is
running on the dyno); at a higher one V8 can grow toward the whole quota and the dyno swaps first (Heroku
R14), slowing everything on it. Without early-voting data, 768 fits one big import on today's code and 384
after fixes 1–3. With early-voting ids graduating, the early-voting step dominates: one import crashed at
768 and used about 1,150–1,180 MB of footprint at 1024 with or without fixes 1–3 — over a Standard-2X
either way. So until the early-voting fix ships, the workable setting is Performance-M with the cap at
about 2000 from the start (the cap is shared by every job in the worker process, so turf cuts and exports
need room *inside* it; heap 2000 + 150–310 MB of footprint stays under 2,560), or Standard-2X at 1024
accepting R14 on those imports. After the early-voting fix and the gate, **re-derive the Standard-2X cap
rather than assuming 768:** with footprint 150–310 MB above the heap, a runaway job at a 768 cap (816 MB of
heap) would reach about 1,030–1,130 MB and swap before V8's own out-of-memory stop — so the right cap is
nearer 640–700, set from the gate's measurements.

**Scale out instead of up: an import-only dyno type.** The one-worker rule exists for the maintenance queue
(FbTime's door step must never run twice at once, [OPERATIONS.md](OPERATIONS.md)); nothing in the import
pipeline needs a single process — every cross-import guard is in Mongo (CAS claims, the per-campaign
pin-pass lease, C4's per-org lease, unique upserts). So imports can get their own process type, scaled in
the dashboard like web dynos:

- `worker.js` builds only the Workers named in `WORKER_QUEUES` (include) or not named in
  `WORKER_SKIP_QUEUES` (exclude); unset = all, today's behavior. The `worker:` line uses the **exclude**
  form (`WORKER_SKIP_QUEUES=import-queue`), so a future queue lands on it by default instead of on nobody.
  It beats only those queues' heartbeat keys (B1), and calls `registerMaintenanceJobs()` only when it
  consumes `maintenance-queue`.
- **`worker.js` attaches each `failed` listener only when its Worker exists.** Today it runs
  `workers.find(...)` and then `.on('failed', …)` unconditionally for the import, campaign-delete,
  org-delete and conversion Workers (`worker.js:174, 203, 226, 251`); with filtering, one lookup returns
  `undefined` in each process, `main()` throws, and both dyno types crash-loop.
- `Procfile` gains `importer: WORKER_QUEUES=import-queue npm --prefix server run worker`. The variables go
  inline because Heroku config vars are app-wide, not per process type — and so must
  `WORKER_MAX_OLD_SPACE`: with the Performance-M stop-gap's ~2000 cap app-wide, an `importer` on a smaller
  dyno must set its own cap inline on its Procfile line.
- **The importer purges its own temp files.** `sweepStaleImportJobs` removes `tmp-*`, `import-spill-*` and
  `xlsx-norm-*` files (voter data) from the `os.tmpdir()` of whichever process consumes the maintenance
  queue — the `worker:` dyno. Spill files would now live on `importer` dynos, so the importer runs the same
  temp-file purge at boot and on a timer. **That is a retention change (CLAUDE.md):** flag it and update
  PRIVACY_VERIFICATION's v5 entry, which relies on that sweep to clean up after a SIGKILL.
- Each `importer` dyno runs `IMPORT_JOB_CONCURRENCY=1`, so each big import gets a whole dyno, and one import
  running out of memory takes down only its own dyno — never a turf cut, an export or a delete.
- Cost per importer process: two Redis connections (a shared base connection plus one blocking duplicate),
  against the 40 the Key-Value plan allows ([PERFORMANCE.md](PERFORMANCE.md)), and a Mongo pool of up to 10
  (`WORKER_MONGO_MAX_POOL_SIZE`, `worker.js:51-53`) against the Atlas connection limit.
- **Release step:** a new Procfile process type starts at **0** dynos — imports stop until `importer` is
  scaled up (and sized) in Resources. Put that in the release notes; with zero importers the page says the
  import system isn't running (B3), which is the truth.

**Fairness, beyond C4:** BullMQ open source has no per-tenant groups (that is BullMQ Pro). A separate small
lane for interactive jobs (preview, See exact placement, Look up by address) would stop them queueing behind
full imports — but a big re-import preview needs ~365 MB on its own, so on a shared Standard-2X that lane is
the two-big-jobs case again: it needs the preview fixes in §H or a dyno of its own.

## J. Verification when built

- Plain-module tests: `jobVerdict` truth table (each state × mid-run × job alive/silent × queued/progress
  ages × workerUp × paused × redis down × writeStartedAt), including **a mid-run requeued doc resumes even
  past the 24-hour mark** and the label order (paused and system-down before the job's own reason); a timed-out
  round answering `down` for every job; the delete adapter (no `stuck`, no withdraw); the label function;
  `lookupToast` codes; the failure-line precedence (`failCode` → system code → stopped partway → generic,
  never raw `lastError`).
- Int tests (throwaway mongod; routes get `isReady: () => true` through `setQueueStateDeps`, and the queue
  calls are stubbed with `t.mock.method` on the cached `getQueue(...)` instance and the shared Redis client,
  the way `campaignDeleteJob.int.test.js` stubs `Voter.deleteMany`; the failed listener is tested through the
  extracted `reconcileFailedImport`):
  - **across two polls:** a requeued doc is not withdrawn on the next poll, however old it is; and a
    re-claimed job whose previous `progressAt` is 40 minutes old is not `stuck` — a property of the claim
    write (it resets `progressAt`), not of the verdict alone;
  - a `pending` doc aged 2:05 with state `waiting` stays `pending` and returns `queue.show: 'in-line'`;
    state `unknown` → `failed`/`lost` and the upload is deleted; a `pending` doc 24 h old → removed and
    `expired`, or `stopped-partway` if it had started writing;
  - a mid-run doc whose job is `waiting` with a silent heartbeat goes back to `pending` (with `requeuedAt`)
    and is claimed again; with a live heartbeat it is left alone;
  - the detail, list and Cancel routes act on claimed docs (their response hides `claimToken`, the verdict's
    re-read doesn't); the list response carries no inserted-id arrays;
  - Cancel on a mid-run doc whose lock has lapsed removes it and CAS-fails it; Cancel on a job with
    `writeStartedAt` → 409;
  - a `failed`/`cancelled`/`undone` doc handed to `processImportJob` writes nothing and inserts no voters (an
    undone `pending` one is closed as `failed`/`undone` with its upload deleted); a `completed` doc
    redelivered stays `completed`; the campaign/org guard writes can't overwrite it;
  - a claim lost mid-run (token changed) stops the processor at its next write, leaves the raw upload and
    the other holder's spill files alone, and still records the batch's inserted ids;
  - a transient error on attempt 1 leaves `pending` + `retryAttempt: 1`; the final attempt leaves `failed`
    with the processor's own code; the same for a pin lookup (its retries survive);
  - two imports of one org: the second waits (`waitingFor: 'org'`, BullMQ `delayed`) and both report exact
    counts; a crash-requeued job takes back its own leftover lease once unrenewed for 90 s, and not before;
    a Cancel, `stuck` or `lost` verdict on a dead holder releases its lease;
  - Undo answers 409 while a same-file sibling is unfinished; a file-wide Undo after an interrupted attempt
    removes that attempt's rows (from `ImportInsertedIds`), including the batch that was in flight when it
    died (ids recorded before the write); **View on map** and **export from an import** return the same rows
    for a new import (side collection) and an old one (legacy arrays); a campaign delete removes its own
    `ImportInsertedIds` and leaves another organization's untouched; the failed listener clears `claimToken`, maps
    the stall-limit message and deletes the upload; a raced claim throws (BullMQ retries) rather than
    completing;
  - campaign deletes: queued stays pending, requeued running waits, lost fails; `campaignDeletionHealth`
    reports queued, not stuck, and flags a delete unstarted too long; busy checks ignore previews,
    See-exact-placement checks and pin lookups.
- **Early voting:**
  - the rewritten `clearParkedByCanonical` deletes exactly what the old one did for each caller (same rows
    left), without loading the pile — and **a second organization's parked do-not-contact request survives
    every DNC clear**, and a second campaign's parked voted ids survive every voted clear;
  - on a fixture with parked lists, chunked file-scoped graduation gives the campaign-wide result — same
    VotedVoter rows, same remaining parked rows, same fully-voted doors — and the credits follow the new rule:
    include one id parked under two spellings by two uploads, and assert the earliest upload gets it;
    rejected rows graduate nothing;
  - the voted backstop graduates an id parked after an import's graduation step; the DNC backstop honors a
    request after a campaign's state is corrected; both skip deleting campaigns;
  - concurrent graduations of one voter count `matched` once; `recomputeFullyVoted` paging still writes
    every listed door;
  - the voted and DNC upload routes keep their memory flat with a large pile and a 50 MB file;
    `reapplyDncLists` survives a pile past the old 16 MB limit.
- **New assertions for the memory fixes**, which no current test covers: a re-import with moves checking
  `movedVoters`, `deactivatedDoors` and the persisted `sourceHouseholdIds`; cut-attribute values after an
  import, including a home with conflicting values and an exact tie. Better still, one differential test
  running the old and new code on the same fixture and comparing every written document.
- `importHandEdits.int.test.js` re-runs a job whose doc is already `completed`; under C1 that run is skipped
  and the test would pass without testing anything — reset the doc to `pending` first. The other import
  suites (`importStress`, `importZeroGate`, `importPlaceholderPins`, `pinFixesAtScale`,
  `overlappingCampaigns`, `undoImport`) call the processor one at a time and pass unchanged.
- BullMQ's own behavior (states, `getRanges` order, `remove` return values, `moveToDelayed` + `DelayedError`,
  stall requeue) is verified here only by reading bullmq 5.77.6's source and by stubs — the int environment
  has no Redis. Add one test against a real Redis (a local `redis-server`), or record that gap where the
  tests live.
- Re-run §G's sweep and §I's gate on the built code; they decide `IMPORT_JOB_CONCURRENCY`.
- `npm run audit:mobile-api` (the detail and campaigns routes gain fields; the list route drops unused
  arrays — no client-version bump).
- `npm run migrate:build-indexes -- --apply` after deploy (the `ImportInsertedIds` index).
- `npm run sweep:raw-imports` from the repo root exits on its own.

## K. Privacy

**Retention timing changes for a queued file (flagged per CLAUDE.md: retention/deletion).** Today a queued
job failed at 2 minutes keeps its raw upload until the nightly sweep finds it terminal and older than 24 h
(up to ~48 h). After: a queued upload is deleted when it runs (unchanged), when it is cancelled
(unchanged), when it is undone while waiting, or when any fail or withdraw verdict wins its CAS (`lost`,
`queue-failed`, `stuck`, `expired`, `stopped-partway`) — enforced by any poll, by the list route for
overdue rows, by the failed listener, and by the nightly sweep. While the worker is down and nobody opens
the Import page, the nightly sweep can't run, so the outer bound then waits for whichever comes first — the
same as today, where deletion also waits for the sweep. [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)'s
raw-upload paragraph (the v5 2026-08-04 entry) gains these paths and loses its "fail with a message within
minutes" sentence. **No Privacy Policy, ToS or DPA sentence changes:** "the original file is deleted after
import" stays true.

**New stored data, all operational:** the heartbeat keys (a timestamp and a dyno name), the org lease (a
token, a job id, two dates), and `ImportInsertedIds` (record ids plus the org, campaign and job they belong
to; no personal data) — which must die with its ImportJob. The campaign- and org-delete cascades (and demo
refresh, and the test-campaign purge) delete it **by its own declared `campaignId` / `organizationId`** —
never by a field it doesn't have, which under `strictQuery` would match every organization's rows (C1). An
ungated record can land after a cascade has passed (a retention-path org delete doesn't wait for a running
import), so the nightly sweep also drops records whose ImportJob no longer exists. The exhaustive org-delete
test gains a surviving organization's row that must still be there afterwards. No new subprocessor.

**Do-not-contact requests must never cross organizations** (flagged per CLAUDE.md: who can access or
change customer data). `DncPendingId` is organization-wide and has no `campaignId`; every DNC clear and the
nightly DNC backstop scope by `organizationId`, spread from the caller's own filter. A filter on a field
the model doesn't declare is dropped under `strictQuery`, so a careless `campaignId` would delete every
organization's parked requests with those spellings — people who asked never to be contacted, then
contacted. §J pins it with a second organization's row that must survive.

**Temp files on an importer dyno** (if §I's import-only dyno is built): the nightly sweep that deletes stray
spill and spool files (voter data) runs only where the maintenance queue runs, so the importer must purge
its own — and PRIVACY_VERIFICATION's v5 entry, which relies on that sweep after a SIGKILL, must say so.

**Processing statements must match what happened.** Linking writes Person records — personal data — and
fans identity out onto voter rows across the organization before any door or voter row is imported. Today a
job cancelled or expired after linking would read *"Cancelled before it ran."* while those writes stand;
setting `writeStartedAt` at linking (C1) makes such a job uncancellable and its failure read *"Stopped
partway"*. **Pre-existing, separate from this design, and to reconcile in PRIVACY_VERIFICATION:** an import
that fails after linking leaves the Person records it created, and no retention job purges orphan Persons
(nothing under `services/retention/` does); whether the privacy record already says so needs checking. If
§H's preview spill is built, previews start writing voter rows to the worker's disk — update the spill
disclosure in the same change.

Also fixed by piece 1, and worth knowing: today a full import the page has called failed can still write
its voters later — data entering a campaign after the customer was told it didn't.
