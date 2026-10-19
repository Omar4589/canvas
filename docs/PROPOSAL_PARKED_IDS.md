# Proposal: Parked voter IDs — the full fix (after Election Day)

> **Status: step 1 BUILT 2026-10-19 (uncommitted at time of writing) — the indexed clear (§A), a server
> deploy only. Everything else here is PLANNED for after the 2026-11-03 election, by the owner's ruling
> (2026-10-19).** Derived from [PROPOSAL_IMPORT_QUEUE.md](PROPOSAL_IMPORT_QUEUE.md) §F.6 and §H, which went
> through four adversarial review rounds; that doc holds the measurements and the reviewers' detail. Read
> this before touching voted-list or do-not-contact parking, `reapplyVotedLists`, `reapplyDncLists`, or
> `clearParkedByCanonical`.

What this covers: what a parked ID is, why the pile grows, what shipped before the election, and the full
fix to build after it — in order, each step with its mechanism, its gate and its tests.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (voted lists and graduation), [VOTERS.md](VOTERS.md)
(do-not-contact), [PROPOSAL_IMPORT_QUEUE.md](PROPOSAL_IMPORT_QUEUE.md) (the import line and its memory),
[PROPOSAL_VOTER_ID_KEYS.md](PROPOSAL_VOTER_ID_KEYS.md) (the other post-election voter-ID work),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

---

# Part 1 — For everyone

## What a parked ID is

When you upload an early-voting list, Doorline marks every voter on it who is in the campaign. An ID it
can't match yet — that person isn't in the campaign's voter list — is **parked**, so that if the person is
imported later, they're marked then ("graduates"). Do-not-contact lists park the same way, across the
whole organization.

## The problem

- **Parked IDs are stored once per upload.** A county's cumulative early-vote list, uploaded every day,
  parks the same people again every day. A campaign can pass a million parked rows within a week of early
  voting starting, and the pile keeps growing until Election Day.
- **Doorline used to read the whole pile to clear a few rows.** Every import read it, and read it a second
  time whenever anyone on it matched; every voted-list or do-not-contact upload read it on the website's
  server. In testing, that is what pushed one import past the worker's memory.

## What shipped before the election (2026-10-19)

- **Clearing parked IDs now asks the database for exactly the rows to delete**, instead of loading the
  pile and picking through it. Nothing changes in what gets cleared. This removes the pile load from
  voted-list and do-not-contact uploads on the website's server, and the second load from imports.
- **Still there until after the election:** each import's *first* read of the pile (to find who
  graduates), and the pile's growth. Measured, the fix saves about 80 MB on the worst import tested, which
  still needs more than the worker's 1 GB — so until the full fix ships, the worker needs the bigger dyno
  (Performance-M) if campaigns keep uploading cumulative lists.

## What's left, after Election Day

1. Imports look up only the parked IDs the file can actually match, in small batches.
2. A nightly pass catches the rare cases that misses — one for voted lists, one for do-not-contact.
3. One parked row per voter instead of one per upload, so the pile stops growing (needs a data migration).
4. List uploads stop holding whole files in the website's memory.
5. A small read-only command that reports how big each pile is.

---

# Part 2 — Technical reference

## A. BUILT 2026-10-19: the indexed clear

[`clearParkedByCanonical(Model, filter, canonicals)`](../server/src/services/voters/voterIdLookup.js) — same
signature, same callers (`reapplyVotedLists`, `routes/admin/voted.js`, `routes/admin/dnc.js`), same result:

- **Width:** `widestNumericIdWidth(filter, Model)` — the existing helper, now given the parked model, so
  padding reaches the widest numeric spelling actually *parked* in scope (an aggregate on the server; no
  rows come back).
- **Delete:** each canonical ID's spellings (`voterIdVariants(c, width)`), batched at ≤ 5,000 spellings per
  `deleteMany({ ...filter, stateVoterId: { $in } })`, never splitting one ID's spellings, on the existing
  `{ campaignId, stateVoterId }` / `{ organizationId, stateVoterId }` indexes.
- **Scope:** the caller's `filter` is always spread into the delete — `{ campaignId }` for voted lists,
  `{ organizationId, $or: [{ state }, { state: null }] }` for do-not-contact. `DncPendingId` has no
  `campaignId`; under `strictQuery` a filter on an undeclared field is silently dropped, so a wrong scope
  would delete other organizations' requests.
- **Equivalence:** removes exactly the rows the old in-memory fold removed. A non-canonical input
  (`08719967`) still matches nothing; letter-bearing IDs still match only themselves, case kept. The one
  difference: a numeric spelling wider than `MAX_VOTER_ID_WIDTH` (24), which no real ID is, is no longer
  reached (`widestNumericIdWidth` warns).
- **Tests:** [`test/clearParkedByCanonical.int.test.js`](../server/test/clearParkedByCanonical.int.test.js) —
  the old body is the oracle; another campaign's voted IDs, another organization's and a sibling state's
  do-not-contact requests survive; no `find` over the scope; 6,000-ID chunking. The existing
  `votedUpload`, `dncUpload`, `auditVoterIdSpellings`, `overlappingCampaigns`, `campaignDeleteJob` and
  `doNotKnock` int suites and the voter-ID choke-point test pass unchanged.
- **Measured** (the PROPOSAL_IMPORT_QUEUE §F.6 worst case — an import graduating 30,000 voters from 1.2
  million parked rows, 40% of doors fully voted; footprint = macOS peak memory footprint, the Linux proxy):

  | Run (2026-10-19) | Cap | Result | Peak heap | Footprint |
  |---|---|---|---|---|
  | Before (current code) | 1024 | completes | 881 MB | **1,207 MB** |
  | After (with the indexed clear) | 1024 | completes | 878 MB | **1,125 MB** |
  | After (with the indexed clear) | 768 | crashes | — | 961 MB at the crash |

  Both completed runs cleared exactly the same rows (parked 1,200,000 → 1,020,000; voted voters
  66,697 → 96,697). **On the worker the clear saves about 80 MB in this case** — the import's peak is its
  *first* read of the pile in `reapplyVotedLists` (§B), which is still there; such an import still needs
  more than a Standard-2X until §B ships, so the worker stop-gap stays (Performance-M with
  `WORKER_MAX_OLD_SPACE` ≈ 2000, PROPOSAL_IMPORT_QUEUE Part 1). **On the web dyno the whole pile load is
  gone** from every matching voted-list and do-not-contact upload.

## B. Graduation in bounded chunks (file-scoped)

Replaces `reapplyVotedLists`' whole-pile array. Per chunk of **whole** IDs (≤ 5,000 spellings, every
spelling of an ID in the same chunk, spellings generated per chunk), over this file's canonical IDs **that
reached the campaign** (rejected rows graduate nothing):
1. find the live uploads' parked rows on `{ campaignId, stateVoterId }`;
2. find the voters present;
3. credit each graduation to the **earliest** upload among that ID's parked rows (deterministic; today it
   follows the unsorted `find` order);
4. upsert `VotedVoter`;
5. `$inc` each upload's `matched` from the upserts' actual results (a pre-read double-counts when two
   imports graduate the same voter);
6. delete exactly those parked rows by `_id`.

Pad only to the widest parked spelling (computed once per campaign, or stored per upload) — padding a
7-digit ID to 24 costs 18 spellings instead of 2. Memory is one chunk; time still grows with how many
uploads parked each graduating ID until §F lands.

## C. Nightly backstops

File-scoping misses two cases: a list upload racing an import (it parks an ID just after the import's
graduation step), and an import that wrote voters but died before graduating, whose voters never arrive in
another file. (Walk-up voters are not a case: their `stateVoterId` is `manual:…`, which no list carries.)

- **Voted:** per campaign, one streaming cursor `find({ campaignId, uploadId: { $in: live } })
  .sort({ uploadId: 1 }).hint({ uploadId: 1 })` — upload ids are time-ordered, so the first upload seen for
  an ID is the earliest — with batch-wise lookup, graduation and delete-by-`_id`; the ID width computed once
  per campaign; deleting campaigns and organizations skipped. Never paged by `_id` (no `{ campaignId, _id }`
  index — it would walk every tenant's rows).
- **Do-not-contact:** per organization — exact, state-aware, delete by `_id`, deleting campaigns skipped. It
  also covers a campaign's `state` being corrected (parkings key on the campaign's state). Alternatively,
  re-run DNC graduation when a campaign's state changes.

Both run from the maintenance queue.

## D. Do-not-contact graduation

`reapplyDncLists` runs on every import, loads the organization's whole parked DNC pile, and runs one
unchunked `Voter.find({ organizationId, stateVoterId: { $in: svids } })` — past roughly 730,000 distinct
IDs that command passes MongoDB's 16 MB limit and the import fails on every attempt. Make it file-scoped
with a chunked `$in`, keeping its **exact, state-aware** matching (by design — two states can issue the
same digits), with §C's backstop healing what file-scoping misses.

## E. Page `recomputeFullyVoted`

2,000 doors per page (find, `VotedVoter` lookup and write per page). Keep writing **every** listed door:
the write bumps the door's timestamp, which is how phones' change feed learns of voted marks.

## F. One parked row per ID (the pile stops growing)

- **Voted:** one row per `{ campaignId, canonical }` with a stored `canonical` field and an `uploadIds`
  array — add on upload, `$pull` on undo, delete the row when empty; `uploadIds[0]` keeps the graduation
  credit.
- **Do-not-contact:** one row per `{ organizationId, state, stateVoterId }` — exact, not canonical, by
  design.
- **Order matters:** a one-off migration first collapses today's duplicates and backfills `canonical`;
  only then can the unique index build (a unique build fails on duplicates) — through
  `npm run migrate:build-indexes -- --apply`, since production autoIndex is off — plus an index on
  `uploadIds` for undo's `$pull`. Code reads both row shapes until the migration is done. A plain "first
  upload wins" de-dup would lose a parking when the first upload is undone while a later one is live.

## G. Upload routes on the website's server

`routes/admin/voted.js` and `routes/admin/dnc.js` use `multer.memoryStorage()` (up to 50 MB in the web
dyno) and `parseVoterIdList` parses every column of every row. Switch to disk storage and parse only the ID
column — the change the import route made after its own web-dyno R14s.

## H. A safe pile count

A root-proxied, read-only console script (so it runs from Heroku's Run console): parked rows and distinct
IDs per campaign, DNC rows per organization — counts and aggregates only, never rows. **Don't run
`npm run audit:voter-id-spellings` during early voting** — it loads every parked row itself. (This one is
cheap and read-only; it could ship before the election if the pile size is wanted.)

## I. Verification

- The early-voting cases in PROPOSAL_IMPORT_QUEUE §J: chunked file-scoped graduation gives the
  campaign-wide result, with the new earliest-upload credit pinned by an ID parked under two spellings by
  two uploads; the backstops; concurrent graduations count `matched` once; paging still writes every door;
  upload routes stay flat in memory with a large pile and a 50 MB file; `reapplyDncLists` survives a pile
  past the old 16 MB limit; a second organization's parked DNC request survives every DNC operation.
- Re-run the §A measurement on the built code.

## J. Privacy

No published sentence changes. Parked rows are deleted at the same moments as today (§A changes only how).
The de-duplication migration (§F) changes the row shape, not what is kept or for how long. The rule that
matters is scope: **do-not-contact parking is organization-wide and must never be filtered by a field it
doesn't have** — a cross-organization delete would lose people's "never contact me" requests. Every DNC
step above scopes by `organizationId` and keeps the state rule.
