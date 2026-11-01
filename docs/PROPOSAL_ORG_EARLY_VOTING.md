# Proposal: One early-voting file for the whole organization

> **Status: PLAN AND DESIGN v2, 2026-10-31. Revised after review round 1; nothing built.** Round 1 ran three
> reviewers (the mechanisms against the code, privacy and docs, and a pre-mortem at statewide scale), and every
> finding was checked before this revision. §S lists what each found and what changed. The owner's six
> decisions (given 2026-10-31: every recommendation, end of Part 1) are unchanged. Round 1 also found two
> problems in code already shipped, fixed outside this plan: the CSV reader's row that never ends
> ([PERFORMANCE.md](PERFORMANCE.md)), and the Early Voting history sending uploaders' email addresses to team
> leads (privacy item 49). Next: review round 2 on v2, then the build after Election Day (decision 1). One
> server deploy (web and worker) when built; nothing ships to phones. Line references are to HEAD `95a532e`.

Related: [EARLY_VOTING.md](EARLY_VOTING.md) (the campaign upload this builds on: pipeline, undo, the
remembered IDs), [VOTERS.md](VOTERS.md) (Do-not-contact, the organization-level upload this copies),
[PROPOSAL_PARKED_IDS.md](PROPOSAL_PARKED_IDS.md) (§B, §C and §F: the remembered-ID pile), [IMPORTS.md](IMPORTS.md)
(the import that marks remembered voters), [PERFORMANCE.md](PERFORMANCE.md) (*Voter-ID list uploads*: the
piece-by-piece reader this streams through), [PROPOSAL_ID_LIST_EXCEL.md](PROPOSAL_ID_LIST_EXCEL.md) (the
Excel reader and *Count only rows where*), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (items 45, 48, 49).

---

# Part 1 — For everyone

## Why

- **One list, many campaigns.** An early-voting list goes in one campaign at a time today. An organization
  running 15 campaigns in one state, all on the same ballot, uploads the same county file 15 times a day
  during early voting, and each copy separately remembers the IDs it couldn't match: 15 copies of the same
  remembered list, growing daily.
- **A whole state's file doesn't fit.** Nebraska's statewide early-ballot file is 149 MB (274,000 rows, 85
  columns). Doorline takes 50 MB at most, so today it has to be cut down by hand first.
- **Customers expect it to happen by itself.** Doorline doesn't buy voter data, so the list comes from the
  customer, who gets it from the county or the state. This makes that one step a day, for every campaign at
  once.

## What it does

A new **Early Voting** page for the organization, beside **Do-not-contact** under **Voters**, for org admins.

1. **Pick the state and the election**: *Nebraska · Tuesday, Nov 3, 2026*. The page lists the
   organization's campaigns in that state on that election day, all ticked. Untick any that shouldn't get
   this list; one client might not want it. A campaign with no election day set is listed with a link to set
   it. A campaign on a different election day can't be ticked: an early vote in November says nothing about a
   December runoff.
2. **Pick the file**: a CSV up to 500 MB (a whole state's file), or an Excel workbook up to 50 MB as today.
   The page checks the file's first rows before sending the rest, so a file with no Voter ID column is turned
   away in a second rather than after a long upload. A bar shows the upload. A big file needs a steady
   connection: at 4 Mbps a 149 MB file takes about 5 minutes, and the page allows up to 30.
3. **Say which rows count, the first time.** An election office's file often lists ballots not yet returned,
   or rejected ones. Before anything can be marked for a state, you choose: **every row**, or only rows with
   certain values (*Ballot_Status* is *ACCE*, say). The page remembers your choice in your browser for that
   state and uses it on the next file, which it says so you can change it.
4. **Doorline reads the file and matches it against every ticked campaign** in the background, so you can
   leave the page and come back. The rules are the campaign page's: the Voter ID column is detected (or you
   pick it), and leading zeros don't matter.
5. **The preview**, for the whole file: IDs read; people in at least one ticked campaign; IDs in none of the
   ticked campaigns yet (remembered for later); IDs that belong to voters in the organization's campaigns in
   other states (never marked); and voters in campaigns on this election that you didn't tick, in case one
   was missed. Then **per campaign**: *Will mark*, *Already voted*, *Doors that will drop*.
6. **Mark voters voted in 15 campaigns** applies it, campaign by campaign, with progress.
7. **History**: each organization upload with its results per campaign, and **Undo**: the whole upload, or
   one campaign's share. Undo never un-marks a voter that a newer list you uploaded still includes.

Each campaign's own **Early Voting** page shows its share of an organization upload in its history, as *Your
organization's list*, with that campaign's numbers only.

## Remembered for later

As on the campaign page, a voter who isn't in a campaign yet is remembered, and marked when a later voter
import brings them in. The difference is that the organization keeps the list **once**, however many
campaigns it went to. It's used for the campaigns the upload went to, and any you add to it later. The
remembered IDs are **deleted 30 days after the election**, and the page shows that date before you mark
anyone. The marks already made stay with each campaign, as today.

Because the list is kept, one more thing becomes possible: **Add campaigns** to the newest upload already
applied, for a campaign started in the middle of early voting or one unticked by mistake. Its voters are
marked from the kept list, without sending the file again.

## The organization's early-voting summary

At the top of the page, for the chosen election: each campaign with its voters marked voted, its doors fully
voted, and when its last list went in. A campaign is flagged when early voting is open by its own
early-voting dates and no list has gone in for more than a day.

## Who can use it

- **Org admins**, and Doorline staff only while they hold a support grant for that one organization, the
  same as Do-not-contact. Never across organizations: there is no Doorline-wide upload, and every request
  must name its organization.
- **Team leads don't see the page.** A lead may be the campaign's client, so nothing shows a lead which other
  campaigns a list went to, what the organization named its file, or who uploaded it. Their campaign's page
  shows its own share and nothing else.

## What stays the same

- The campaign's **Early Voting** page, which team leads use, up to 50 MB.
- Marks are per campaign. A door drops only when everyone there has voted.
- Phones: nothing to install. Doors drop within about 30 seconds, as today.

## What it doesn't do

- Fetch lists from a state or county website (dropped by the owner on 2026-10-31: few states publish to a
  stable link).
- Mark campaigns in other states, or on other election days.
- Change Do-not-contact.

## The screens

Drawn with the campaign page's own parts (white cards on the page, the gray preview box, the red **Mark**
button, the history table), so the two pages read as one feature. Status is said in words, never by color
alone. The numbers are made up.

**Voters page.** One more link under the two that are there now:

```
                                                     Do-not-contact list →
                                                     Do-not-knock addresses →
                                                     Early-voting lists →
```

**1. The election, and the campaigns on it.** The tick list doubles as the organization's summary: each
campaign's voters marked so far, doors fully voted, and when its last list went in.

```
Early Voting — all campaigns
One list of voters who have already voted, for every campaign on the same ballot. Matched by Voter ID,
with or without leading zeros. A door drops only once everyone there has voted. Every upload can be undone.

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ State                    Election                                                        │
│ [ Nebraska         ▾ ]   [ Tuesday, Nov 3, 2026    ▾ ]                                   │
│                                                                                          │
│ Campaigns on this ballot                       Last list         Marked voted  Fully voted│
│ [x] Douglas County Commission                  Oct 31, 1:47 PM          8,412        3,016│
│ [x] CD-2 Paid Program                          Oct 31, 1:47 PM         22,190        9,877│
│ [x] LD 9 State Senate         No list in 2 days Oct 29, 9:02 AM          1,205          340│
│ [ ] Omaha Public Schools Bond                  —                            0            0│
│                                                                                          │
│ Not on this ballot here                                                                  │
│     Lincoln City Council — no election day set.  Set it →                                │
│     Sarpy County Runoff — election day Dec 1, 2026                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**2. The file, and which rows count.** The page checks the first rows the moment a file is picked. With a
choice remembered for this state, it says so:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Voted-voters file (CSV up to 500 MB, or Excel up to 50 MB)                               │
│ [ Choose file ]  Early Voting List 11.01.26.csv · 149 MB                                 │
│ Matching on Registrant_ID · counting only rows where Ballot_Status is ACCE               │
│ (your last choices for Nebraska)  Change                                                 │
│                                                                                          │
│ [ Read and match 3 campaigns ]                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The first time for a state there's nothing remembered, so the file is read and the page asks before anything
can be marked:

```
│ Which rows count?                                                                        │
│ This file has columns that often say whether a ballot came back. Counting every row      │
│ marks everyone listed, including ballots not returned yet.                               │
│ ( ) Every row                                                                            │
│ (•) Only rows where [ Ballot_Status ▾ ] is                                               │
│     [x] ACCE · 169,652   [ ] (blank) · 101,564   [ ] REJE · 2,268   [ ] SUSP · 350        │
│ [ Count these rows ]  Sends the file again.                                              │
```

**3. Sending, then reading and matching.** You can leave the page once the file is sent; matching keeps
going, and coming back shows where it is.

```
│ Sending the file… 58% · 86 of 149 MB. Keep this tab open until it's sent.                │
│ ████████████████████████████░░░░░░░░░░░░░░░░░░░░                                         │
```
```
│ Read 273,834 rows. Matching against 3 campaigns: 2 of 3 done (LD 9 State Senate next).   │
│ You can leave this page; it keeps going.                                                 │
```

**4. The preview.**

```
┌ in the gray preview box ─────────────────────────────────────────────────────────────────┐
│ Matching on [ Registrant_ID ▾ ] · 169,652 IDs in the rows counted                        │
│ 169,652 of 273,834 rows counted (Ballot_Status)                                          │
│ e.g. 1234567 · 2345678 · 3456789                                                         │
│                                                                                          │
│ In at least one of       In none of these         In other states'      On this ballot,  │
│ these campaigns          campaigns yet            campaigns             not ticked       │
│ 31,807 people            137,845 remembered       212, not marked       4,102 people     │
│                                                                                          │
│ Campaign                      In campaign   Will mark   Already voted   Doors that drop  │
│ Douglas County Commission          12,330       3,918           8,412             1,402  │
│ CD-2 Paid Program                  29,004       6,814          22,190             2,931  │
│ LD 9 State Senate                   1,644         439           1,205               118  │
│                                                                                          │
│ Most of a statewide file belongs to other areas, so most IDs are in none of these        │
│ campaigns. They're remembered until Dec 3, 2026, and marked if those voters are imported │
│ into one of these campaigns.                                                             │
│ Download 10,000 of the 137,845 · Download the 212 from other states                      │
│                                                                                          │
│ Omaha Public Schools Bond holds 4,102 of these voters and isn't ticked.                  │
│ Tick it and match again (no need to send the file again)                                 │
│                                                                                          │
│ Count only rows where [ Ballot_Status ▾ ]  ·  Change which rows count                    │
└──────────────────────────────────────────────────────────────────────────────────────────┘

[ Mark voters voted in 3 campaigns ]   Discard
```

**5. Marking.**

```
│ Marking: 2 of 3 campaigns done (LD 9 State Senate next). You can leave this page.        │
```
```
│ Done. Marked 11,171 voters voted in 3 campaigns · 4,451 doors dropped.                   │
│ 137,845 IDs remembered until Dec 3, 2026 for voters imported later.                      │
```

**6. History, Undo and Add campaigns.**

```
Upload history — Nebraska · Nov 3, 2026
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ WHEN              FILE                                   CAMPAIGNS   MARKED   DOORS DROPPED│
│ Oct 31, 1:47 PM   Early Voting List 10.31.26.csv                 3   11,171          4,451 │
│                   Ballot_Status: 169,652 of 273,834 rows                                   │
│                   by Alex Rivera · Add campaigns · Undo all                                │
│     Douglas County Commission      3,918 marked · 1,402 doors dropped   Undo this campaign │
│     CD-2 Paid Program              6,814 marked · 2,931 doors dropped   Undo this campaign │
│     LD 9 State Senate              undone Nov 1 by Jamie Ortiz                             │
│ Oct 30, 2:10 PM   Early Voting List 10.30.26.csv                 3    9,830          3,902 │
│ …                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
```
┌ Add campaigns to this upload ───────────────────────────────────┐
│ [x] Omaha Public Schools Bond — 4,102 of its voters are on it   │
│ Uses the list Doorline kept. No file needed.                    │
│ [ Mark them ]   Cancel                                          │
└─────────────────────────────────────────────────────────────────┘
```

**Add campaigns** is offered on the newest upload only, since an older day's list is shorter. Undo asks first:
*Undo this upload for all 3 campaigns? It un-marks the voters it marked, except any a newer list you uploaded
still includes, and doors re-open where someone hasn't voted.* For one campaign: *… for CD-2 Paid Program? It
un-marks the voters it marked in this campaign, except any a newer list still includes.*

**7. A campaign's own Early Voting page.** Its share of an organization upload sits in its history. Nothing
there names another campaign, the organization's file or who uploaded it, because a team lead may be the
client. Org admins also see the file's name.

```
│ Oct 31, 1:47 PM   Your organization's list                 3,918     1,402         —   Undo │
│                   Ballot_Status: 169,652 of 273,834 rows                                   │
```

*Not found* reads *—* on these rows, because the organization keeps that list, not the campaign. Undo asks:
*Undo this upload for this campaign? It un-marks the voters it marked here, except any a newer list still
includes.* Org admins also see, above the file box: *For a whole state's file, or one list for several
campaigns, use your organization's Early Voting page →*.

**When something's wrong**, the page says so in place of the next step:

- **No Voter ID column** (found by the first-rows check, before anything is sent): the column box, as on the
  campaign page.
- **A row that never ends** (a quote mark not closed, or no line breaks): the reader's own sentence, as on the
  campaign page.
- **Over the size limit:** *This file is 612 MB. The most this page takes is 500 MB. Only the Voter ID column
  is used, so save a copy with just that column and upload it.*
- **Sending stopped** (the connection dropped, or the tab closed): *Sending stopped before the whole file
  arrived. Nothing was kept. Pick the file again.*
- **Your last choice doesn't fit this file:** *Ballot_Status has more than 25 different values in this file, so
  it can't decide which rows count. Choose again.*
- **Someone else is working on this election:** *Alex Rivera is uploading a list for this election. Wait for it
  to finish, or discard it from the history.*
- **Matching stopped:** *Matching stopped. Try again*. It runs again from the IDs already sent.
- **Left too long:** *This upload wasn't applied within a day, so it was cleared. Pick the file again.*
- **No campaigns to tick:** *No campaigns in Nebraska have Nov 3, 2026 as their election day. Set each
  campaign's election day to use this page.*

## The owner's decisions (given 2026-10-31: every recommendation)

1. **When:** after Election Day (2026-11-03). It changes how voters get marked, and the last stretch of early
   voting isn't the time.
2. **The biggest CSV:** 500 MB (Nebraska's whole-state file is 149 MB).
3. **What's remembered:** every ID on the list, until 30 days after the election, so a voter imported later is
   marked automatically and **Add campaigns** works. With a whole state's file, Doorline holds the state's
   early-voter IDs for the customer until then, most of them people in none of the customer's campaigns (§M).
4. **Leads and undo:** a team lead can undo their campaign's share; the organization page shows who did.
5. **Changing *Count only rows where*:** the page sends the file again by itself. Doorline never keeps the
   file, only the Voter IDs it needs.
6. **The daily shortcut:** the page remembers, in your browser, the Voter ID column and the rows you counted
   last time for each state, and uses them on the next file. Nothing about it is stored on our side.

---

# Part 2 — Technical reference

## A. Why one state and one election

- **One state.** Two states can issue the same digits, and nothing in a file says which state wrote it
  ([parseVoterIdList.js](../server/src/services/import/parseVoterIdList.js), `parseAndMatchState`'s comment).
  The upload names its state; only ticked campaigns are matched, all in that state; IDs that also match voters
  in other states' campaigns are reported as `outsideState`, exactly as
  [dnc.js](../server/src/routes/admin/dnc.js) reports them, and never marked.
- **One election.** `Campaign.electionDay` is a `'YYYY-MM-DD'` civil date or `null`
  ([Campaign.js](../server/src/models/Campaign.js)). A ticked campaign must carry the upload's `electionDay`.
  A campaign with `null` is offered only after its date is set (the campaign's key dates; Help Center
  *set-election-dates*). Archived campaigns (`archivedAt`) and campaigns being deleted (`deletion.requestedAt`
  set) are not offered.
- **Voted lists match by canonical ID** (leading zeros ignored), as the campaign upload does. That is safe
  here for the reason it's safe there: everything in scope is one state. (Do-not-contact stays exact because
  its parking is organization-wide across states; PROPOSAL_PARKED_IDS §F makes the same split.)

## B. Data model

| Model | Purpose / key fields |
|---|---|
| **`OrgVotedUpload`** (new) | One organization upload, and the unit of the page's history and of whole-upload undo. `organizationId`, `state`, `electionDay`, `fileName`, `uploadedBy` (a User reference), `status` (`receiving` · `matching` · `previewed` · `applying` · `applied` · `undoing` · `failed` · `discarded`; changed only by compare-and-set, §E), `progress { stage, done, total }`, `heartbeatAt`, `error` (generic text only, §M). The read summary: `idColumn`, `columns`, `sheetName`, `otherSheets`, `totalRows`, `keptRows`, `keepColumn` (name only, and only when rows were left out — item 45(c)'s rule). Totals the worker computes: `idsInFile`, `spellings`, `noId`, `matchedPeople`, `inNoCampaign`, `outsideState.count`, `alsoUnticked [{ campaignId, people }]`. `campaigns: [{ campaignId, preview { inCampaign, willMark, alreadyVoted, doorsWillDrop }, votedUploadId, result { marked, alreadyVoted, doorsDropped }, addedAt, undone, undoneAt, undoneBy (a User reference) }]`. **IDs held only until the upload settles, then cleared by the sweep (§K):** `sampleIds`, `zeroMatchExample`, `outsideState.samples`, `unmatchedSample` (up to 10,000 of the file's spellings). `draftExpiresAt`, `settledAt`, `undone`, `undoneAt`. **Never stored:** the value counts for *Count only rows where* (returned in the upload's answer only, §C) and which values were ticked. Indexes `{ organizationId, createdAt: -1 }`; `{ organizationId, state, electionDay, status }` (the one-unsettled-upload rule, §E); `{ draftExpiresAt: 1 }` and `{ settledAt: 1 }` (sparse, the sweep). |
| **`OrgVotedListId`** (new) | The kept list: **one row per ID per organization, state and election**, PROPOSAL_PARKED_IDS §F's shape from the first day, so daily cumulative files don't grow it. `organizationId`, `state`, `electionDay`, `canonical` (`canonicalVoterId`), `uploadIds` (the live organization uploads that listed it). Order in the array means nothing: MongoDB doesn't promise `$addToSet`'s order, and a retried job can apply out of turn, so "earliest" always comes from the uploads' own `createdAt` (§G). Unique `{ organizationId, state, electionDay, canonical }`, which also serves the retention delete by its prefix; multikey `{ uploadIds: 1 }`, which serves undo's `$pull` and the `{ uploadIds: [] }` delete of empty rows (an equality match on the empty array uses the index; `$size: 0` scans the collection). No spellings: a canonical ID reaches every stored spelling through `voterIdVariants` at lookup. |
| **`VotedUpload`** (existing), new fields | `orgUploadId` links a campaign's share (a "child") to its organization upload; absent on campaign uploads. Unique partial index `{ orgUploadId, campaignId }` with `partialFilterExpression: { orgUploadId: { $type: 'objectId' } }`, never `$exists`, which matches a stored `null` and would refuse every campaign's second campaign upload with E11000, and never `$ne: null`, which MongoDB refuses in a partial filter (both tried on a throwaway mongod in round 1). `startFullyVoted` and `affectedHouseholdIds`: written before the first mark, so a retried apply reports the same numbers (§E). `undoHouseholdIds`: written before the first un-mark, so a retried undo re-opens the same doors (§F). A child's `uploadedBy` is the org uploader (a User reference); what the campaign route returns about a child is a fixed list of fields (§J). |
| GridFS bucket **`votedListDrafts`** (new) | The kept IDs of one organization upload between upload and apply: the file's own spellings, one per line, opened with `openUploadStreamWithId(orgUploadId, …, { metadata: { organizationId } })`. Never the file. Deleted when the apply job finishes, at discard, on any error while it's written (`abort()`), and by the sweep (§K). |

Unchanged: `VotedVoter` (one mark per voter per campaign; children's marks carry the child's `uploadId`),
`Household.fullyVoted`, `VotedPendingId` (still written by campaign uploads; **never** by children — the kept
list does that job).

## C. Reading the file, on the web dyno

**The organization comes first.** `requireActiveOrg` runs before anything else on the router, ahead of the
storage engine, and answers 400 when no organization is active, as dnc.js's `ensureOrgScoped` does inside its
handlers. Without it a super-admin sending no `X-Org-Id` passes `orgContext` with `activeOrg` null and no
grant, passes `requireOrgRole`, writes no access log, and Mongoose drops `organizationId: undefined` from a
filter, so a lookup by id would reach any organization's upload (round 1 ran `Query.cast` to confirm the
drop). Every lookup on these routes is `{ _id, organizationId: req.activeOrg._id }`.

**The head check.** For a CSV the page sends the first 1 MB (`file.slice(0, 1 << 20)`) to `POST /check`
through `api()`, so a lapsed session, a grant that ended or a password-change hold surfaces before the big
upload. The server runs `readCsvColumns` on it with the last, possibly cut, line dropped, and returns the
columns, the detected ID column and the title-row hint (computed from the head as `readCsv` computes it, moved
to a helper both use), or the refusal: the code-less *Could not detect a Voter ID column* with its columns, or
`row-too-long`. Memory only, and about a second. An Excel file skips it: a zip's directory is at its end, and
Excel stays at 50 MB.

**The upload streams through the reader.** Before reading a byte of the file, the route creates the
`OrgVotedUpload` (status `receiving`, `draftExpiresAt` = now + 24 hours), refusing if the organization already
has an unsettled upload for this state and election (§E). `POST /` then uses a multer custom storage engine
(`streamIdList`) instead of `memoryStorage`. Its `_handleFile(req, file, cb)` gets the file stream and reads
its first four bytes:

- the OLE2 signature: `legacy-xls`, as today;
- a zip signature: buffered up to 50 MB and read by the Excel reader as today
  ([readIdColumn.js](../server/src/services/import/readIdColumn.js), unchanged);
- anything else is a CSV: the stream goes into `readCsvColumns`, changed to take an async iterable of Buffers
  where it now slices one Buffer (its up-front head read becomes async), and to hand each kept spelling to a
  sink instead of collecting `raw`. The decoding and parsing logic doesn't change: `StringDecoder` already
  joins characters split across piece edges, and the format guess still comes from the first million
  characters. The guards added to the shipped reader on 2026-10-31 come with it: the first 10 rows must fit in
  the first 1M characters, a row still open after about 1 MB stops the read, and an unclosed quote at the end
  is refused, so no file makes the stream re-read a growing row. The sink writes each spelling to the draft's
  upload stream, waiting on `drain`. **Memory stays flat**: one 64 KB piece, Papa's current row, the value
  counters. Distinct IDs are counted on the worker, not here (a `Set` of 1M IDs is +71 MB, measured in
  round 1). Each piece still steps aside (`setImmediate`), so field traffic keeps being answered.

On any error, refusal or abort (the browser closes the request, a 413 mid-stream, a reader refusal), the engine
calls the upload stream's `abort()`, which removes the chunks already written, and marks the upload
`discarded`. Multer calls `_removeFile` only for a file that finished, and GridFS writes its `files` document
only at the end, so without this an interrupted upload would leave chunks that no `files` query finds.

*Count only rows where* is applied during the same pass, so `keepColumn` and `keepSelected`, like `state`,
`electionDay`, `campaignIds` and `idColumn`, must arrive **before** `file` in the multipart body. Busboy emits
parts in order and `FormData` keeps the order they were appended in (tried in round 1 with multer 2.1.1 and
busboy 1.6.0: fields appended first are on `req.body` when `_handleFile` runs). A file that comes first is
refused (400 `fields-first`); the 400 goes out once busboy has drained the body. One-pass filtering has one more
consequence: rows are dropped before the reader knows whether the column is fit to count by (25 values or
fewer, none over 64 characters, `applyKeep`'s rules, which otherwise ignore the selection). So if the column
turns out unfit, typically a remembered choice meeting a new file, the upload is refused with
`keep-unsuitable` and discarded, never kept with rows wrongly dropped.

In the same pass every column but the ID column has its distinct values counted: one `Map` per column, dropped
once the column passes 25 values or a value passes 64 characters. The counts go back in the upload's answer, to
the uploader's own screen, and are **never stored**, the same rule item 45(a) set for the one column the
campaign page counts. So after one read the page can offer every countable column and its values. Applying a
different choice sends the file again; the page still holds the `File` and does it by itself (decision 5).

**Caps.** CSV 500 MB (decision 2) and 2,000,000 rows (the worker folds once per job, §D; at 5,000,000 a single
fold and its spellings came to about 1.1 GB per pass in round 1's measurement). Excel 50 MB, with the reader's
own limits. Over the cap: 413 `file-too-large` naming the cap, and refused the moment it's picked
(`idListTooBig`, given the org page's cap; the parity test in
[idListUpload.test.js](../server/test/idListUpload.test.js), which holds today's 50 MB page limit to the
server's, is extended to the new cap).

**Time limits.** Two clocks apply, and the plan's first version knew only Heroku's:

- **Node's own:** `server.requestTimeout` defaults to 300,000 ms in Node 18 and later, and server.js calls
  `app.listen` without changing it, so any request whose body takes over 5 minutes to arrive gets a 408. In
  round 1 a back-pressured upload hit it exactly; at that limit a 149 MB file needs about 4 Mbps of sustained
  upload, and a 500 MB file about 14 Mbps. **server.js sets `server.requestTimeout = 30 * 60 * 1000`.** It's
  server-wide, but every other route's body is small (Express's JSON limit), and Heroku still bounds each
  response. `headersTimeout` stays as it is.
- **Heroku's:** *"The countdown for this 30 second timeout begins after the entire request (all request
  headers and, if applicable, the request body) has been sent from the router to the dyno"*
  ([Request Timeout](https://devcenter.heroku.com/articles/request-timeout)), and a body with a known length
  is passed on through *"a 1024 byte buffer, filled and flushed continuously"*
  ([HTTP Routing](https://devcenter.heroku.com/articles/http-routing)). So back-pressure reaches the browser,
  the parse finishes as the body does, and only closing the draft, writing the upload and enqueueing are left
  in the 30 seconds. Neither article documents Router 2.0's handling of a request body. **The build verifies it:**
  a synthetic file (never a real one, §M) sent to an internal organization on the live app over a connection
  throttled to 3 Mbps, taking longer than 60 seconds.

**Then.** Status `matching` by compare-and-set; enqueue `{ action: 'match', orgUploadId }` on a new
`voted-list-queue` with a fixed job id (`match:<id>`). Job data carries ids only, never voter IDs. The answer is
202 with the upload's id, the read summary and the value counts; the page polls `GET /:id/status`.

**Measure before building:** peak memory and the longest wait for other requests through the real route on
the scratch harness, for the 149 MB Nebraska-shaped file and a 500 MB synthetic one; and the Atlas load of one
daily match and apply for 15 campaigns (about 2,100 lookups of 5,000 spellings and 230,000 writes, estimated in
round 1). Same method as [PERFORMANCE.md](PERFORMANCE.md) → *Voter-ID list uploads*.

## D. Matching (job `match`, on the worker)

1. Read the draft (a stream) and fold the IDs **once for the job** (`foldVoterIds`); the canonical IDs and
   their spellings are reused for every campaign. (Calling `findVotersByVoterIds` per campaign as-is would fold
   the whole list and build every spelling again each time.)
2. **Per ticked campaign, one at a time**, so memory holds one campaign's matches: look up the campaign's
   voters for the folded IDs in chunks (the lookup's own 5,000-spelling chunks), then `classify` and
   `previewDrops`. These are the functions [voted.js](../server/src/routes/admin/voted.js) runs today, moved
   into `services/voted/votedListOps.js` so both paths run one implementation, with every `$in` chunked at
   20,000 (today's `classify`, `previewDrops` and `recomputeFullyVoted` pass whole arrays; 1M ObjectIds is
   19 MB, over the 16 MB BSON limit). Write the campaign's preview, `progress` and `heartbeatAt` after each
   one.
3. **People**: the union of matched canonical IDs across campaigns (`matchedPeople`). **In no campaign**: the
   rest, as a count plus up to 10,000 spellings (`unmatchedSample`).
4. **Outside the state**: one lookup in `{ organizationId }` scope (the `{ organizationId, stateVoterId }`
   index), keeping hits in other states' campaigns, as `parseAndMatchState` does.
5. **This election, not ticked**: the same lookup's hits in this state's campaigns on this election that
   weren't ticked, counted per campaign.
6. Status `previewed` by compare-and-set from `matching`. A failure sets `failed` with generic text and keeps
   the draft until it expires, so a retry needs no re-upload.

**Matching again needs no file.** `POST /:id/match { campaignIds }` re-runs this job on the stored draft, from
`previewed` or `failed` only. The page uses it when the ticked campaigns change after a read (*Tick it and match
again*), and for *Try again* after a failure. Only a different ID column or counting choice needs the file sent
again, since the draft holds just the IDs those choices kept.

## E. Applying (job `apply`)

**Status changes are compare-and-set.** Every transition is one `findOneAndUpdate` on the current status:
apply only from `previewed`; match only from `previewed` or `failed`; undo only from `applied`; add campaigns
only on an `applied` upload; discard only from `previewed` or `failed`. Anything else is a 409. With fixed job
ids (`apply:<id>`, `undo:<id>`, `undo:<id>:<campaignId>`), a double-clicked **Mark** queues one job, an undo
can't slip between two apply attempts, and the sweep never clears a draft an apply is reading. **One unsettled
upload per organization, state and election:** a second is refused with who has the first, until it's applied
or discarded.

Order matters (§G):

1. Status `applying`. Re-check the organization's and each ticked campaign's deletion stamps
   (`deletion.requestedAt`), here and before each campaign, as importProcessor.js does: a deleting
   organization stops the job, and a deleting campaign is skipped and shown as such.
2. **The kept list first.** For each canonical ID in the draft (every one, decision 3): upsert
   `OrgVotedListId` with `$addToSet: { uploadIds }`, 2,000 per `bulkWrite`.
3. **Each ticked campaign, in turn**, its completion recorded on the upload so a retry resumes:
   - find-or-create its child `VotedUpload` (the unique partial index makes it idempotent);
   - match again, because things may have moved since the preview;
   - on the first attempt only, write `affectedHouseholdIds` (the doors of the voters it will newly mark)
     and `startFullyVoted` (how many of those are fully voted) on the child;
   - upsert `VotedVoter` (`$setOnInsert`, `uploadId` = the child);
   - `recomputeFullyVoted` over `affectedHouseholdIds` only, the doors whose residents just changed. Doors
     whose matched voters were all already marked didn't change, so they're no longer rewritten, which also
     keeps them off phones' change feed. Every door that did change is still written, which is how open
     phones learn of the new marks;
   - set `matched` = `countDocuments({ uploadId: child })` and `doorsDropped` = fully voted among
     `affectedHouseholdIds` − `startFullyVoted`, so a retry after the upserts landed reports the same
     numbers, not 0;
   - write the campaign's `result` on the upload, and `heartbeatAt`.
4. Delete the draft; status `applied`; `settledAt`.

The job runs with BullMQ `attempts: 3` and backoff (the queue's defaults). Every step above is idempotent or
recorded before it runs. A **`failed` listener** in worker.js, like the ones for imports and deletions, writes
`failed` with generic text when BullMQ gives up, because an out-of-memory crash or a stall never reaches the
processor's own catch. The page treats a heartbeat more than 2 minutes old during `matching`, `applying` or
`undoing` as stopped, and offers *Try again*. Thrown errors never quote a Voter ID: BullMQ keeps failed jobs'
error text in Redis for 30 days, and a duplicate-key error on `OrgVotedListId` would quote the key. So the
processor rethrows generic messages, as worker.js already does elsewhere.

The new queue runs **one job at a time** on the existing worker (Performance-M), which bounds memory. A
15-campaign apply holds other organizations' early-voting jobs for its length, minutes. That's acceptable at
today's scale, and to be revisited if two organizations collide. It adds one Redis connection on the worker
(within Premium 0's 40), and the connection-budget comment in
[connection.js](../server/src/queues/connection.js) is brought up to date.

## F. Undo (job `undo`)

**Re-credit, never strip a mark a newer list still holds.** `$setOnInsert` credits each mark to the first
upload that made it, so in a daily cumulative run nearly every mark belongs to day 1, and deleting by
`uploadId` alone would un-mark, on undoing day 1, voters whom days 2 to 5 still list. So for each mark credited
to the child being undone, the job looks up the voter's canonical ID in `OrgVotedListId`. If another live
upload lists it, one that targets this campaign and isn't undone there, the mark's `uploadId` moves to that
upload's child for this campaign (the earliest by `createdAt`). Otherwise it's deleted. The same lookup runs
when the **campaign page** undoes one of its own uploads, so a campaign upload overlapping a live organization
list no longer un-marks people the list still names (EARLY_VOTING.md's *Undo order* gotcha, for this case).

- **Whole upload:**
  1. Status `undoing`, and every campaign's share is marked undone, which stops new marks for voters imported
     later (§G).
  2. Per campaign: write `undoHouseholdIds` on the child (first attempt only), re-credit or delete its marks,
     recompute over `undoHouseholdIds`, and mark the child undone.
  3. `$pull` the upload from `OrgVotedListId` (`{ uploadIds: 1 }`), delete the rows left empty
     (`{ uploadIds: [] }`), and set status `applied` with `undone`.
- **One campaign's share**, from the org page or the campaign page: the same steps 1–2 for that campaign
  alone. The list rows stay, since other campaigns use them, unless no campaign on the upload is live any
  longer, in which case step 3 runs too.
- The campaign page's `POST /admin/campaigns/:id/voted/undo` checks the `VotedUpload` it's handed. If it's a
  child (`orgUploadId` set), it enqueues the one-campaign undo and answers 202, and the page polls its
  history. A statewide share can be far bigger than a campaign upload, and the inline undo would run past 30
  seconds. A retried undo re-opens the doors it saved, not the doors it can still find: today's inline undo
  reads its doors from the rows it deletes, so a retry after the delete would find none and leave doors
  dropped.

## G. Voters imported later (sticky marks)

[importProcessor.js](../server/src/services/import/importProcessor.js) calls `reapplyVotedLists` today. After
it, add `reapplyOrgVotedLists(campaign, inserted)`, where `inserted` is the import's newly inserted voters. That
list must be `counts.insertedVoterIds` from this run when it has any, else `importJob.insertedVoterIds`, as
[collectRevisitHomes.js](../server/src/services/import/collectRevisitHomes.js) already does. It must not be
`importJob.insertedVoterIds` alone: importProcessor.js loads `importJob` once (line 121) and writes the captured
IDs only to the database (lines 446-454), never onto the loaded copy, so on every first attempt that field is
an empty array and nobody would graduate. The steps:

1. Find the live uploads aimed at this campaign: `OrgVotedUpload` with this campaign in `campaigns` and not
   undone there, status `applying` or `applied`, not `undoing`, upload not undone, whose `state` and
   `electionDay` still equal the campaign's. (A campaign whose election day was changed, say for a runoff,
   stops receiving that election's marks.)
2. Look up the inserted voters' `stateVoterId`s, chunked, as canonical IDs.
3. Fetch `OrgVotedListId` rows for those uploads' `{ organizationId, state, electionDay }` with `canonical` in
   that set and `uploadIds` intersecting the live uploads.
4. Credit each mark to the earliest live upload in the row's `uploadIds`, by `createdAt`, using this
   campaign's child of that upload.
5. Upsert `VotedVoter` and `$inc` the child's `matched`.
6. Return the doors, which join the import's existing `toRecompute`.

Why this is enough, and where it isn't:

- **Only voters an import inserted can graduate.** Everyone present at apply was matched then.
- **Order closes the race with an apply.** The list is written before the apply job matches, and an `applying`
  upload counts as live. So a voter inserted before the apply's match is marked by the apply, and one inserted
  after finds the list waiting.
- **A crashed import isn't covered.** An import that dies mid-write loses the inserted IDs of the batches
  already written: the retry sees those voters as existing, and the capture is saved once. This is
  PROPOSAL_PARKED_IDS §C's case. So a **nightly pass** (maintenance queue) walks each campaign that has a live
  organization list. In chunks of list rows, it marks any of the campaign's voters whose canonical ID is listed
  by a live upload aimed at it and who carry no mark. This is the first version's claim that no nightly pass
  was needed, withdrawn.

## H. Add campaigns

`POST /:id/campaigns { campaignIds }` is offered on the organization's newest live upload for the election only.
It takes campaigns in the same state and election that aren't on the upload yet, and runs `apply` for just
those, matching against the `OrgVotedListId` rows whose `uploadIds` contain this upload, with no file. From then
on, imports into them graduate as in §G.

## I. The summary

`GET /summary?state&electionDay` returns, per campaign on that election:

- `VotedVoter` count (`{ campaignId, voterId }` index);
- `Household` count with `fullyVoted: true`;
- the newest live upload of either kind;
- `earlyVotingStart` and `earlyVotingEnd`;
- `stale`, which is true when today, in the campaign's time zone, is inside its early-voting dates and the
  newest list is more than 24 hours old.

The page shows it in the campaign tick list (*The screens*, 1), with `stale` written as *No list in N days*.

## J. Endpoints

All mounted at `/admin/voted-lists`, behind `requireAuth, orgContext, requireActiveOrg, requireOrgRole('admin')`,
in that order, ahead of any body parsing. Staff get into a customer organization only through `orgContext`,
which requires a live support grant for it (`SUPPORT_ACCESS_REQUIRED` otherwise) and records the grant on the
request; `requireOrgRole` lets staff through after that. The central access log
([accessLog.js](../server/src/middleware/accessLog.js)) already logs every staff request it isn't told to skip,
and `classifyResource`'s existing `/\/voted/` rule labels these paths `voted` (round 1 ran it), so no change is
needed for the content routes. The status poll returns no voter content, and is added to `AUDIT_EXEMPT`
([supportAccess.js](../server/src/services/access/supportAccess.js)), so a staff member's open page doesn't
write an access-log row every 1.5 seconds. The preview and the unmatched download stay logged.

| Method · path | Body | Returns |
|---|---|---|
| `GET /options` | — | the pickers: states, the elections in each, and each election's campaigns (archived and deleting left out; `null`-date campaigns flagged) |
| `POST /check` | `multipart/form-data`: `file` (the first 1 MB of a CSV) | `{ columns, idColumn, headerRowHint }` or the refusal |
| `POST /` | `multipart/form-data`: `state`, `electionDay`, `campaignIds`, `idColumn`?, `keepColumn`?, `keepSelected`?, **then** `file` | 202 `{ id, read summary, value counts }`; 409 when the election already has an unsettled upload |
| `GET /:id/status` | — | status, progress, `heartbeatAt`, the read summary's counts (no IDs) |
| `GET /:id` | — | the full preview and results, once settled into `previewed`, `applied` or `failed` (sample IDs included until the sweep clears them) |
| `GET /:id/unmatched.csv` | — | up to 10,000 unmatched spellings, until cleared (§K) |
| `POST /:id/match` | `{ campaignIds }` | 202; matching again on the stored draft (§D) |
| `POST /:id/apply` | — | 202 |
| `POST /:id/undo` | `{ campaignId? }` | 202 |
| `POST /:id/campaigns` | `{ campaignIds }` | 202 |
| `DELETE /:id` | — | discards a draft |
| `GET /` | `?state&electionDay` | history, the newest 50 |
| `GET /summary` | `?state&electionDay` | §I |

The campaign router changes in two places:

- **`GET /admin/campaigns/:id/voted`** returns a child row as a fixed list of fields: `_id`, `createdAt`,
  `fromOrganization: true`, `keepColumn`, `keptRows`, `matched`, `doorsDropped`, `undone`, `undoneAt`. It never
  includes `orgUploadId`, `notFound`, other campaigns or the uploader. It adds `fileName` only when the
  requester is an org admin or staff. Since 2026-10-31 (privacy item 49) every row's uploader is name only.
- **`POST /undo`** enqueues for a child (§F).

**Phones call none of these** (`npm run audit:mobile-api -- --list`), so there's no client-version gate.

## K. Retention and deletion

| What | Kept until |
|---|---|
| The file | Never stored. It streams through memory (§C). |
| The draft (kept IDs, GridFS) | The apply job finishes, or the upload is discarded or aborted, or `draftExpiresAt` (24 hours) passes on an upload that is `receiving`, `previewed`, `failed` or `discarded`, or `matching` with a heartbeat over an hour old. Never while an apply or undo runs. |
| Orphaned chunks | Any `votedListDrafts` chunks whose `files_id` has no `files` document and no live upload, once over 24 hours old (the sweep checks `chunks` itself, not only `files`). |
| The value counts | Never stored (§C). |
| `sampleIds`, `zeroMatchExample`, `outsideState.samples`, `unmatchedSample` | 24 hours after the upload settles (`settledAt`). |
| `OrgVotedListId` | 30 days after its `electionDay`, deleted per organization, state and election; undo (§F). |
| `OrgVotedUpload` | Kept as history (counts, the file's name, column names; no IDs once swept), like `VotedUpload`; deleted with the organization. |
| Marks (`VotedVoter`) | As today: with the campaign. |

- **The sweep runs every 15 minutes,** as its own repeatable job, not beside `sweep-stale-imports`, which runs
  once a day at 05:53 (retention/scheduler.js) and would have let a "24 hours" draft live 48. The daily 30-day
  list deletion is a second job. **Both go in `REPEATABLE_JOBS`** (retention/scheduler.js), where the retention
  health check watches them, because the page promises the deletion date.
- **Organization deletion:** add `OrgVotedUpload`, `OrgVotedListId`, and the bucket's `files` (by
  `metadata.organizationId`) and their `chunks` (by `files_id`) to
  [deleteOrganization.js](../server/src/services/platform/deleteOrganization.js)'s cascade.
- **Campaign deletion:** its children and marks go with it, as now
  ([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js)). The upload's entry for it stays as
  history, shown as *campaign deleted*. The jobs re-check deletion stamps (§E), and `VotedVoter`, the children
  and `OrgVotedListId` join `LATE_WRITE_MODELS`
  ([lateWriteSweep.js](../server/src/services/platform/lateWriteSweep.js)), so a job that races a deletion
  leaves nothing behind.
- **Account deletion:** `uploadedBy` and `campaigns[].undoneBy` are User references, like `VotedUpload` and
  `DncUpload`. [deleteAccount.js](../server/src/services/users/deleteAccount.js) scrubs the User in place, so
  they read *Deleted user*. No name is ever copied into these records as text.

## L. Web

- **The page:** `client/src/pages/OrgEarlyVotingPage.jsx` at `/voters/early-voting`, linked from the Voters
  page beside Do-not-contact ([VotersPage.jsx](../client/src/pages/VotersPage.jsx), the `/voters/dnc` link).
  Org admins only, inside the same `RoleGate` as `/voters/dnc`.
- **Shared with the campaign page, never copied:** `IdColumnPicker`; `refusalView`, and `idListTooBig` /
  `idListTooBigText` ([lib/idListPreview.js](../client/src/lib/idListPreview.js), with the org cap); the tab
  note; the counting controls (`KeepRows`), lifted out of
  [EarlyVotingPage.jsx](../client/src/pages/EarlyVotingPage.jsx) into a component both pages render; and
  `historySubtitle`.
- **Upload progress:** nothing in the client shows it today, because `api()` posts with `fetch`. A small
  `XMLHttpRequest` helper with `upload.onprogress` adds it, built into browsers, so no new library. It builds its
  headers from `getToken` and `getActiveOrgId` ([api/client.js](../client/src/api/client.js)), as
  [lib/downloadFile.js](../client/src/lib/downloadFile.js) already does for its own requests, and hands any
  error answer to `api()`'s error handling, so `PASSWORD_CHANGE_REQUIRED`, `ORG_CONTEXT`,
  `SUPPORT_ACCESS_REQUIRED` and an expired session behave as everywhere else. `/check` goes through `api()`
  itself, so those surface before the big upload. A 408 or a dropped connection reads *Sending stopped*. The
  request is aborted on unmount or **Discard**.
- **Polling:** TanStack Query, `refetchInterval` 1,500 ms on `GET /:id/status` while the status is `receiving`,
  `matching`, `applying` or `undoing`, off once it settles, then one `GET /:id` for the preview. Each `queryFn`
  passes TanStack's `signal` to its request, so leaving the page cancels it (the campaign page's queries don't
  today: 41 of 255 `queryFn`s do).
- **Which rows count, the first time:** with no remembered choice for the state, **Mark** stays off until the
  admin chooses *Every row* or a column and values (*The screens*, 2).
- **Decision 6:** `localStorage`, keyed by organization and state, holds `{ idColumn, keepColumn,
  keepSelected }`, with every read and write wrapped in try/catch, and the page works the same without it.
  It's written only after an apply succeeds.
- **The campaign page:** child rows read *Your organization's list* (the file's name for org admins), with
  *—* under *Not found*; their Undo answers 202 and the page polls until the row reads undone. Above the file
  box, for org admins: *For a whole state's file … use your organization's Early Voting page →*.

## M. Privacy — this is privacy-affecting; say so

This affects what the privacy record says about **retention**, **access** and **exposure** for early-voting
lists. Per CLAUDE.md:

- **What we collect:** nothing new. These are Voter IDs from a customer's early-voting file, as today. The
  value counts of the file's countable columns go back to the uploader's own screen and are never stored,
  item 45(a)'s rule extended from one column to every countable one, never the ID column.
- **Retention:** new. The organization keeps the canonical Voter ID of every counted row, matched or not, once
  per organization, state and election day, until 30 days after the election (decision 3). Today's remembered
  IDs (`VotedPendingId`) have no end date. With a statewide file, that's most of the state's early voters,
  mostly people in none of the customer's campaigns. They're voting-participation identifiers of people
  otherwise absent from the customer's data, which is what the record's H16(e) paragraph already says of
  `VotedPendingId`. The draft lasts at most 24 hours, and the sample IDs at most 24 hours after the upload
  settles.
- **Storage:** the kept IDs are written to MongoDB Atlas (GridFS, then `OrgVotedListId`) between upload and
  apply. The file itself is never stored and never written to disk. That is a privacy-record change for this
  route, as PERFORMANCE.md and PROPOSAL_PARKED_IDS §G already said storing the IDs would be, not item 45(b)
  extended.
- **Access:** org admins, and staff under a grant, logged. Every request must name its organization (§C). Leads
  see only their campaign's share: never other campaigns, the organization's file name or its uploader.
- **Exposure:** new. The unmatched download is now served from the server (`GET /:id/unmatched.csv`), to org
  admins and to staff under a grant (logged), until the sample is cleared. Today the browser builds it from the
  preview's answer and nothing is stored. Per-campaign numbers go to org admins, who already see every campaign.
- **Sharing:** no new third party. Heroku, Atlas and Heroku Key-Value Store as today. Job payloads carry ids
  only, and failed-job error text is generic (§E). DPA §6 unchanged; **no customer notice**.
- **Published text:** no sentence becomes false. The reasoning rests on DPA §2 (using a feature is the
  customer's instruction) and on the deletion date shown on the page before **Mark**. DPA §9 makes the Policy
  the customer's retention instruction, and the Policy keeps customer information *as long as the related
  customer account is active, or as otherwise instructed* (`privacy.html:118`). privacy.html `:85`, `:91` and
  `:122` hold. A voter's request to remove one ID short of **Undo all** is a manual staff step (DPA §7).
- **Record updates when built:** a new item, plus dated notes on items 45(a), 45(b), 45(c), 45(d) and 48(a); on
  H16(e)'s `VotedPendingId` paragraph; on B5's count of deleted collections and B6's list of timers; and on row
  1 of the subprocessor table (Atlas now holds the draft and the kept list). The new item's core wording:
  *"Kept: the canonical Voter ID of every counted row, matched or not, once per organization, state and
  election day (OrgVotedListId). With a statewide file that is most of the state's early voters, mostly people
  in none of the customer's campaigns. Used only to mark voters later imported into campaigns of that state and
  election day that the upload was sent to, then or through Add campaigns; no route, export or report returns
  it. Deleted by the retention job 30 days after the election day, by Undo all, and with the organization; not
  by one campaign's undo, a campaign deletion or an account deletion; backups per privacy.html:122. The page
  shows the date before Mark (DPA §2). No published sentence changes; no customer notice."*
- **Live testing uses synthetic files only,** in an internal organization (these go unlogged, precisely because
  they hold no customer personal data). Never the Nebraska file or any real list.

## N. Docs and Help Center (the cascade)

- **Docs:**
  - [EARLY_VOTING.md](EARLY_VOTING.md): *Organization uploads* in Part 1, and a new Part 2 section; and
    correct *so you upload per campaign* (Part 1, *Campaign-scoped and reversible*), the remembered-IDs
    paragraphs and the *Undo order* gotcha;
  - [VOTERS.md](VOTERS.md): the organization's voter tools;
  - [CAMPAIGNS.md](CAMPAIGNS.md): the election day now decides which campaigns can be ticked; deleting a
    campaign leaves the organization's list;
  - [IMPORTS.md](IMPORTS.md): imports now also mark voters from organization lists;
  - [ROLES.md](ROLES.md): a lead can undo their campaign's share;
  - [PERFORMANCE.md](PERFORMANCE.md): the streamed upload and its measurements;
  - [OPERATIONS.md](OPERATIONS.md): the queue, the two jobs, the nightly graduation pass;
  - [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): §M's item and notes;
  - [PROPOSAL_PARKED_IDS.md](PROPOSAL_PARKED_IDS.md): organization lists use §F's shape from the start;
    campaign piles are unchanged.
- **Help Center:**
  - a new page guide, `pages/page-org-early-voting.md` (`audience: admin`);
  - `guides/early-voting.md`: a section, and its lines on uploading one campaign at a time, the 50 MB limit
    and what's remembered;
  - `pages/page-early-voting.md`: the child rows;
  - `pages/page-voters.md`: the new link among the organization's voter tools;
  - a new FAQ, *Can I upload one early-voting file for all my campaigns?*;
  - `faq/early-vote-list-not-matching.md`: a statewide file shows most IDs as in none of the campaigns, which is
    expected;
  - `faq/set-election-dates.md`: needed for organization uploads;
  - `faq/_INBOX.md`: the *too large* answer.

## O. Tests

- **The core scenario,** on a throwaway mongod with three campaigns in one state on one election (two ticked,
  one not), one in another state and one on another election:
  - only the ticked campaigns are marked, and outside-state and unticked are reported;
  - each ticked campaign's marks, counts and dropped doors equal the campaign page's upload of the same file
    to that campaign (the campaign path is the oracle);
  - `npm run audit:voted-doors` reads 0 / 0 / 0 afterwards.
- **Graduation:**
  - an import into a ticked campaign marks a listed voter on its first attempt (the round-1 blocker);
  - not after the upload is undone, or after that campaign's share is undone, or once the campaign's
    election day changes;
  - never in an unticked campaign;
  - an import racing the apply ends marked either way;
  - an import killed mid-write, then the nightly pass, ends marked.
- **Undo:**
  - whole, and one campaign's share; the list rows are `$pull`ed and the empty ones removed;
  - day 1 undone after day 2 leaves day 2's voters marked (re-credit);
  - the campaign page's undo of an overlapping campaign upload re-credits too;
  - killed after its deletes and retried, the doors re-open.
- **Retries:** an apply killed after its upserts and retried reports the same `matched` and `doorsDropped`.
- **Status:** apply twice, undo during apply, discard during match and add campaigns on an unapplied upload are
  each a 409; a second upload for the same election is refused; a stale heartbeat reads stopped.
- **Add campaigns:** marks from the kept list with no file; offered on the newest upload only.
- **Retention:** list rows gone after election day + 30; drafts after 24 hours; an aborted upload leaves no
  chunks; orphaned chunks are swept; the samples are cleared 24 hours after settling.
- **Permissions:**
  - a lead gets 403 on every org route;
  - a lead's child row carries the fixed field list: no file name, uploader, `orgUploadId` or other campaigns;
  - another organization gets 404;
  - staff with a grant are logged; without one they're refused; with no organization selected, 400 before the
    file is read.
- **Streaming:**
  - a 500 MB CSV through the route with flat memory, in a child process like `idListCsvPieces`' memory test;
  - an upload taking longer than 5 minutes completes (the request timeout);
  - a file before its fields is refused;
  - a remembered counting column unfit for the new file is refused and discarded;
  - the head check;
  - the CSV sink gives exactly `readIdList`'s IDs (the existing equivalence fixtures, run through the stream),
    and the runaway-row refusals hold through it.
- **Client:** the page's logic in `lib/`, the first-time *which rows count* gate, and the `localStorage`
  fallback.

## P. Ship gates (no calendar)

1. The owner's decisions: given 2026-10-31 (Part 1).
2. The design: *The screens* (Part 1) and §R.
3. Review rounds on plan and design: round 1 done (§S); round 2 on this version next.
4. The build, the tests, and §C's measurements.
5. **`npm run migrate:build-indexes -- --apply`** before the page is used, because production `autoIndex` is
   off. New indexes: `OrgVotedListId`'s unique index and `{ uploadIds }`, `OrgVotedUpload`'s four, and
   `VotedUpload`'s `{ orgUploadId, campaignId }` partial.
6. One server deploy (web and worker), with server.js's longer request timeout. The new queue runs on the
   existing worker. No phone release, no client-version bump, no config var.
7. The live check in §C (throttled, synthetic, internal organization) before customers use it.
8. Decision 1: not in election week.

## Q. Alternatives considered

- **Read the file in the browser and send only the IDs.** Kindest on privacy, and it would sidestep upload time
  entirely. But it means a second copy of the parsing rules in the browser (column detection, title rows,
  byte-order marks and encodings, the new runaway-row guards, Excel), a new client library, and two ways in for
  one feature. Not recommended. Round 1's upload-time finding is answered by the longer timeout instead.
- **Send the file in parts** (several requests). Upload time stops mattering, but the parse would have to
  carry its state between requests (the dyno can restart between them) or store the parts, which is storing
  the file (decision 5). Not recommended.
- **Keep the whole file until apply, like a voter import** (the `rawImports` bucket). Changing what counts
  wouldn't re-send the file, but the full file would sit in the database for up to a day. That's decision 5's
  alternative.
- **Run the campaign upload once per campaign.** It remembers unmatched IDs once per campaign (the pile
  problem, multiplied), and at statewide size it runs past Heroku's 30 seconds.
- **A Doorline-wide upload by staff across organizations.** No. The Privacy Policy limits staff access to one
  organization under a grant, and each customer controls its own lists.
- **Fetch lists from state websites.** Dropped by the owner on 2026-10-31.

## R. Components and state (the design, for the build)

**The page:** `OrgEarlyVotingPage.jsx`, lazy-loaded like `DoNotContactPage`, at `/voters/early-voting`
inside the same org-admin `RoleGate` as `/voters/dnc` ([App.jsx](../client/src/App.jsx)).

**State in the page:**

- `state`, `electionDay`: from `GET /options`. A state with one election picks it by itself; otherwise the
  soonest election not yet past is chosen.
- `ticked`: the ticked campaigns. Reset to every eligible one when the election changes.
- `file`; `head`, the first-rows check; `send`, the upload in flight (its progress and its abort).
- `uploadId`: the upload being worked on. On load, the organization's unsettled upload for the chosen
  election, if any, so leaving and coming back picks up where it was.
- `choice`: `{ idColumn, keep: { column, selected } | 'every-row' }`, seeded from
  `rememberedChoice(orgId, state)`; `null` the first time, which holds **Mark** until it's set (decision 6, and
  the first-time gate). Written back after an apply succeeds.
- `valueCounts`: the countable columns' values from the upload's answer, held in the page only.
- `ticks` for `KeepRows`: local until **Count these rows**, as on the campaign page.

**Queries** (TanStack Query, each `queryFn` passing `signal`):

- `['voted-lists', 'options']` and `['voted-lists', 'summary', state, electionDay]`;
- `['voted-lists', uploadId, 'status']`, with `refetchInterval: 1500` while the status is `receiving`,
  `matching`, `applying` or `undoing`, stopped once it settles; then `['voted-lists', uploadId]`;
- `['voted-lists', 'history', state, electionDay]`, refreshed when an upload settles.

**Mutations:** `check` (the 1 MB slice, through `api()`), `send` (the upload, aborted on unmount or
**Discard**), `match`, `apply`, `undo` (whole, or one campaign), `addCampaigns`, `discard`.

**New pieces**, in `client/src/components/earlyVoting/` unless noted:

| Piece | What it is |
|---|---|
| `ElectionPicker.jsx` | The two selects. |
| `CampaignTickList.jsx` | The ticks with the summary columns, *No list in N days*, and the *Not on this ballot here* group with its reasons and the *Set it* link to the campaign's key dates. |
| `ListSender.jsx` | The file input, the first-rows line, the last-choices line with **Change**, the progress bar, *Keep this tab open until it's sent*. |
| `WhichRowsCount.jsx` | The first-time choice: *Every row*, or a column and its values, from `valueCounts`. |
| `OrgPreview.jsx` | The four totals, the per-campaign table, the two downloads, the not-ticked note with **Tick it and match again**, and `KeepRows`. |
| `OrgHistory.jsx` | Uploads with their campaign lines, **Undo** (with the confirm texts) and **Add campaigns** (a dialog, on the newest upload only). |
| `lib/sendWithProgress.js` | An `XMLHttpRequest` wrapper: `{ promise, abort }`, a progress callback, headers from `getToken` and `getActiveOrgId`, error answers handed to `api()`'s handling, *Sending stopped* on a 408 or a dropped connection. |
| `lib/rememberedChoice.js` | `localStorage` read and write under one key per organization and state; every access in try/catch; `null` when storage isn't there. |

**Shared with the campaign page, moved where needed so both pages render one copy:**

- `KeepRows`: already exported from EarlyVotingPage.jsx; moves to `components/earlyVoting/KeepRows.jsx`.
- `IdColumnPicker` and `SheetNote`.
- `refusalView`, and `idListTooBig` / `idListTooBigText`, which now take the cap as an argument.
- `describeIdsInFile`, `keptLine`, `zeroMatchLine`, `historySubtitle`, `fileLine`.

**The campaign page:**

- A child row (`fromOrganization`) reads *Your organization's list* (or its file name, for org admins), with
  *—* under *Not found*.
- Its **Undo** handles the 202 by polling the history until the row reads undone.
- The hint above the file box shows to org admins only (`isOrgAdmin`, as VotersPage decides it).

**Look:** the campaign page's classes throughout:

- cards `rounded-lg border border-border bg-card p-5`, and the preview box in `bg-sunken`;
- labels `text-xs font-medium text-fg-muted`;
- the apply button `bg-brand-600`;
- warnings in `bg-warning-tint text-warning-fg`;
- the history header `bg-sunken text-xs uppercase`.

Status is always in words (*No list in 2 days*, *undone Nov 1 by …*), never color alone, and never an emoji
or a symbol used as a marker.

## S. Review round 1 (2026-10-31): what it found and what changed

Three reviewers read v1 cold: the mechanisms against the code (with experiments on a throwaway mongod and a
local Express app), privacy and docs against the record, Policy and DPA, and a pre-mortem at statewide scale
(with Heroku's documentation and timing experiments). Every finding below was checked against the code before
this revision; a few the reviewers marked unverified are marked so above.

**Blockers, all fixed in v2:**

- **Graduation would mark nobody.** It read `importJob.insertedVoterIds`, which is empty on every first attempt
  (§G).
- **The new `VotedUpload` index, written the natural way, refuses every campaign's second campaign upload.**
  `$exists` matches a stored `null` (§B).
- **No organization selected meant no scoping.** A super-admin without `X-Org-Id` reached any organization's
  upload, unlogged (§C, §J).
- **A row that never ends** (a stray quote, or no line breaks) made the reader re-read a growing row, so a 500 MB
  stream wasn't safe. This was true of the reader already shipped, too: **fixed there 2026-10-31** with three
  guards and tests (PERFORMANCE.md), which this route inherits (§C).
- **Node cuts any upload over 5 minutes** (`requestTimeout`), not Heroku (§C).

**Majors, all fixed in v2:**

- **Undo stripped marks a newer list still held,** so undoing day 1 un-marked day 2's voters. Now re-credited
  (§F).
- **Retries** reported zero marks and dropped doors, and a retried undo left doors dropped. Now the job writes
  before-states first and counts from the data (§E, §F).
- **Job lifecycle:** no `failed` listener or heartbeat, an undo able to run between apply attempts, double
  clicks, and the sweep able to clear a draft mid-apply. Fixed with compare-and-set status, fixed job ids, a
  heartbeat and one unsettled upload per election (§E).
- **Interrupted uploads left orphaned chunks,** and the "24 hours" sweep ran daily. Now the record is created
  first, the stream is aborted on errors, and a 15-minute sweep reads chunks (§C, §K).
- **The stored value counts would hold names and addresses for small files.** Now never stored, never the ID
  column (§B, §C, §M).
- **Stored sample IDs were never cleared,** and the server-side unmatched download is a new exposure. Now both
  are swept and recorded (§B, §K, §M).
- **A one-pass counting filter can't know a column is unfit until the end.** Now refused and discarded (§C).
- **Deletion races,** where jobs and graduation re-created rows after a cascade. Now re-checked, and the new
  models join `LATE_WRITE_MODELS` (§E, §K).
- **Leads would see the organization's file name,** and the uploader's email address. That last part was
  already true of every upload: **fixed 2026-10-31, privacy item 49.** Now a fixed field list (§J).
- **The upload helper ignored `api()`'s auth and error handling** (§L).
- **Memory at the 5M-row cap and unchunked `$in`.** Now the IDs are folded once, every `$in` is chunked, and
  the cap is 2M rows (§C, §D).
- **First day:** forgetting *Count only rows where* would mark unreturned ballots in every campaign. Now **Mark**
  waits for an explicit choice (*The screens*, 2; §L).
- **Privacy-record coverage:** the dated notes and the record's wording are now listed (§M).
- **The docs and Help Center cascade** was missing six files (§N).

**Minors folded in:**

- Earliest upload by `createdAt`, not array order.
- Empty rows deleted by `{ uploadIds: [] }`, on the index.
- The retention delete uses the unique index's prefix.
- `classifyResource` needs no change.
- `no-header-row` is Excel-only.
- TanStack cancels only when `signal` is passed.
- The extra Redis connection.
- One queue for every organization.
- Undoing the last live share pulls the list rows.
- Graduation stops when a campaign's election day changes.
- **Add campaigns** on the newest upload only.
- A second admin's upload for the same election.
- The status poll is light, and exempt from the access log.
- Recompute only the doors whose residents changed.
- Generic job error text.
- Synthetic files for the live test.
- User references for `uploadedBy` and `undoneBy`.

**Withdrawn from v1:** the claim that no nightly pass was needed (§G); *"classifyResource needs a change"*
(§J); *"item 45(b) extends to this route"* (§M).

**Noted, not changed:**

- An org-wide **Undo all** makes open phones in every campaign it touched pull a fresh bootstrap within about
  30 seconds (map.jsx's returning-door refetch). It's the same mechanism a campaign undo uses today, at more
  campaigns at once.
- `MAX_IMPORT_ROWS` counts rows before multi-voter rows are split, so a very large import's inserted-ID capture
  can approach the 16 MB document limit (importProcessor.js). This predates the plan; noted for the import work.
