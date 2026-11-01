# Proposal: One early-voting file for the whole organization

> **Status: PLAN AND DESIGN v6, 2026-11-01. Revised after review rounds 1 to 5; nothing built.** Each round
> ran three reviewers, every finding was checked against the code before revising, and §S lists what each
> round found and what changed. Round 3 traced most of its findings to one root cause, several operations
> working on one election's marks at once, and v4 answered with **one update at a time per election** (§E).
> Rounds 4 and 5 confirmed the lock is exclusive; their findings were at the edges. Round 5's: a hand un-mark
> that undoing a newer list, or adding a campaign to an older one, could reverse; the IDs outliving the date the
> page shows (samples settled at the list's end, a busy day, an organization deleted mid-send); an undo still
> reachable from a campaign page after the list ended; the campaign page's writers locking the wrong election
> (and, as round 4's fix was worded, blocking each other); and a marking that stopped before its list was
> written, which Resume couldn't finish. v6 fixes each. The owner's six decisions (given 2026-10-31: every
> recommendation, end of Part 1) are unchanged. The reviews also found problems in shipped code: the CSV
> reader's row that never ends and the Early Voting history sending uploaders' email addresses to team leads
> (both deployed 2026-11-01 in `4453997`); the Voter Import leaving a half-uploaded file on the web server when
> an upload is cut off (fixed 2026-11-01, deploy pending; privacy record, the v5 2026-08-04 entry); and two rare
> door slips on the campaign page's early-voting path, which this build fixes for every caller (§E's
> conditional door write; §F's undo re-opening a moved voter's current door). Next: the build after Election
> Day (decision 1). One server deploy (web and worker) when built; nothing ships to phones. Line references are
> to HEAD `4453997`.

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

1. **Pick the state and the election**: *Nebraska · Tuesday, Nov 3, 2026*. The page lists the organization's
   campaigns in that state on that election day. The first time, all of them are ticked. After that, the
   ticks follow your last list for this election: a campaign whose share was undone, or that wasn't on it,
   shows unticked, marked *not on your last list*, so a client who doesn't want the list never gets it by
   accident. Untick or tick any. A campaign with no election day set is listed with a link to set it. A
   campaign on a different election day can't be ticked: an early vote in November says nothing about a
   December runoff.
2. **Pick the file**: a CSV up to 500 MB (a whole state's file, up to 2 million rows), or an Excel workbook up
   to 50 MB as today. Before sending the whole file, the page reads its start, so a file with no Voter ID
   column, or one someone else's unfinished upload would block, is turned away in a second.
3. **Say which rows count, before it's sent.** An election office's file often lists ballots not yet returned,
   or rejected ones. From the file's first rows, the page shows its columns and their values. The first time
   for a state, you choose: **every row**, or only rows with certain values (*Ballot_Status* is *ACCE*, say).
   After that it uses your last choice for that state and says so. It also shows what the organization's last
   list counted and who uploaded it, and warns you if this one differs, so two admins can't quietly count
   differently.
4. **Send it.** A bar shows the upload. A big file needs a steady connection: at 4 Mbps a 149 MB file takes
   about 5 minutes, and the page allows up to 30. Leaving the page while it sends stops the send, and the page
   asks before you do.
5. **Doorline matches it against every ticked campaign** in the background, so you can leave the page once
   it's sent. If it's waiting behind another early-voting upload, the page says so. The rules are the campaign
   page's: the Voter ID column is detected (or you pick it), and leading zeros don't matter.
6. **The preview**, for the whole file: the rows counted, with every value's count for the whole file; IDs
   read; people in at least one ticked campaign; IDs in none of the ticked campaigns yet; IDs that belong to
   voters in the organization's campaigns in other states (never marked); and voters in campaigns on this
   election that you didn't tick, in case one was missed. Then **per campaign**: *Will mark*, *Already voted*,
   *Doors that will drop*.
7. **Mark voters voted in 15 campaigns** applies it, campaign by campaign, with progress.
8. **History**: each organization upload with its results per campaign, and **Undo**: the whole upload, or
   one campaign's share. Undo never un-marks a voter that a newer list from this page still includes.

**One update at a time per election.** Marking, undoing and adding campaigns each change the same voters'
marks, so for one election they take turns. While one runs, the campaign pages on that election wait too
before their own upload, undo or un-mark, and an organization update waits for those to finish; two campaign
pages never wait for each other. If someone else's update is running, the page says *This election's lists are
being updated. Try again in a few minutes.* (a team lead sees *This list is being updated. Try again in a few
minutes.*).

Each campaign's own **Early Voting** page shows its share of an organization upload in its history, as *Your
organization's list*, with that campaign's numbers and the list's row counts.

**If something stops partway** (a server restart, a lost connection), the page says so plainly and offers the
way on. A send that stopped is cleared by itself, and none of its Voter IDs are kept. A match that stopped can
be run again from what was already sent. A marking that stopped offers **Resume** or **Undo what was marked**.
An undo that stopped offers **Try the undo again**. A campaign added later that didn't finish offers **Try
again**. Nothing is ever left half-done with no button.

## Remembered for later

As on the campaign page, a voter who isn't in a campaign yet is remembered, and marked when a later voter
import brings them in. The difference is that the organization keeps the list **once**, however many
campaigns it went to. It's used for the campaigns the upload went to, and any you add to it later. Every
counted ID on the list is kept, those already marked included, and the page says how many before you mark
anyone (*169,652 IDs kept until Dec 3, 2026*). They're **deleted 30 days after the election** (as that day
begins in the organization's time zone), or sooner if the upload is undone. The marks already made stay with
each campaign, as today. Once the list has ended, the upload's history stays, but its Undo and Add campaigns
go, on the campaign pages too: there's no list left to keep newer lists' marks by, and the election is over.

Someone un-marked by hand on a campaign's page stays un-marked until the list ends: nothing automatic marks
them again, and neither does a list uploaded before the un-mark (resuming it, adding a campaign to it, or
undoing a newer list, included). A list uploaded after the un-mark still can, since it says they voted.

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
  shows its own share: its numbers, and the list's row counts (*169,652 of 273,834 rows counted*), never a
  column's name: that's the organization's own text.

## What stays the same

- The campaign's **Early Voting** page, which team leads use, up to 50 MB. It only waits, for a few minutes,
  while an organization update for its election runs.
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
with or without leading zeros. A door drops only once everyone there has voted. Every upload can be undone
until its election's list ends, 30 days after the election.

┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ State                    Election                                                        │
│ [ Nebraska         ▾ ]   [ Tuesday, Nov 3, 2026    ▾ ]                                   │
│                                                                                          │
│ Campaigns on this ballot                       Last list         Marked voted  Fully voted│
│ [x] Douglas County Commission                  Oct 31, 1:47 PM          8,412        3,016│
│ [x] CD-2 Paid Program                          Oct 31, 1:47 PM         22,190        9,877│
│ [x] LD 9 State Senate         No list in 2 days Oct 29, 9:02 AM          1,205          340│
│ [ ] Omaha Public Schools Bond  not on your last list  —                     0            0│
│                                                                                          │
│ Not on this ballot here                                                                  │
│     Lincoln City Council — no election day set.  Set it →                                │
│     Sarpy County Runoff — election day Dec 1, 2026                                       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**2. The file, and which rows count, before it's sent.** The page reads the file's start the moment it's
picked. With a choice remembered for this state:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Voted-voters file (CSV up to 500 MB, or Excel up to 50 MB)                               │
│ [ Choose file ]  Early Voting List 11.01.26.csv · 149 MB                                 │
│ Matching on Registrant_ID · counting only rows where Ballot_Status is ACCE               │
│ (your last choices for Nebraska)  Change                                                 │
│ Your organization's last list (Oct 31, by Alex Rivera) counted rows where Ballot_Status  │
│ was chosen: 169,652 of 273,834 rows.                                                     │
│                                                                                          │
│ [ Send and match 3 campaigns ]                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The first time for a state, or after **Change**, the page asks first, from the file's first rows:

```
│ Which rows count?                                                                        │
│ This file has columns that often say whether a ballot came back. Counting every row      │
│ marks everyone listed, including ballots not returned yet.                               │
│ ( ) Every row                                                                            │
│ (•) Only rows where [ Ballot_Status ▾ ] is            (values in the first 4,000 rows)   │
│     [x] ACCE · 2,480   [ ] (blank) · 1,402   [ ] REJE · 91   [ ] SUSP · 27               │
│ A value that first appears later in the file isn't counted unless you tick it then.      │
│                                                                                          │
│ [ Send and match 3 campaigns ]                                                           │
```

When this choice differs from the organization's last list, a line above the button says so: *Your
organization's last list counted only rows where Ballot_Status was chosen; this one counts every row.*

**3. Sending, then matching.**

```
│ Sending the file… 58% · 86 of 149 MB. Keep this page open until it's sent.               │
│ ████████████████████████████░░░░░░░░░░░░░░░░░░░░                                         │
```
```
│ Read 273,834 rows. Matching against 3 campaigns: 2 of 3 done (LD 9 State Senate next).   │
│ You can leave this page; it keeps going.                                                 │
```
```
│ Waiting for another early-voting upload to finish, then matching starts.                 │
```

**4. The preview.**

```
┌ in the gray preview box ─────────────────────────────────────────────────────────────────┐
│ Matching on [ Registrant_ID ▾ ] · 169,652 IDs in the rows counted                        │
│ Counted only rows where Ballot_Status is ACCE: 169,652 of 273,834 rows.                  │
│ In the whole file: ACCE 169,652 · (blank) 101,564 · REJE 2,268 · SUSP 350                │
│ e.g. 1234567 · 2345678 · 3456789                                                         │
│                                                                                          │
│ In at least one of       In none of these         In other states'      On this ballot,  │
│ these campaigns          campaigns yet            campaigns             not ticked       │
│ 31,807 people            137,845                  212, not marked       4,102 people     │
│                                                                                          │
│ Campaign                      In campaign   Will mark   Already voted   Doors that drop  │
│ Douglas County Commission          12,330       3,918           8,412             1,402  │
│ CD-2 Paid Program                  29,004       6,814          22,190             2,931  │
│ LD 9 State Senate                   1,644         439           1,205               118  │
│                                                                                          │
│ All 169,652 IDs are kept until Dec 3, 2026, so voters imported into these campaigns      │
│ later are marked too. Most of a statewide file belongs to other areas, so most are in    │
│ none of these campaigns.                                                                 │
│ Download 10,000 of the 137,845 · Download the 212 from other states                      │
│                                                                                          │
│ Omaha Public Schools Bond holds 4,102 of these voters and isn't ticked.                  │
│ Tick it and match again (no need to send the file again)                                 │
│                                                                                          │
│ Change which rows count (sends the file again)                                           │
└──────────────────────────────────────────────────────────────────────────────────────────┘

[ Mark voters voted in 3 campaigns ]   Discard
```

The whole-file counts (*In the whole file*) come back with the upload and are never stored, so after a reload,
or for another admin, the preview shows the rows counted without them.

**5. Marking.**

```
│ Marking: 2 of 3 campaigns done (LD 9 State Senate next). You can leave this page.        │
```
```
│ Done. Marked 11,171 voters voted in 3 campaigns · 4,451 doors dropped.                   │
│ 169,652 IDs kept until Dec 3, 2026 for voters imported later.                            │
```
```
│ Marking stopped after 2 of 3 campaigns (the server restarted).                           │
│ [ Resume ]   Undo what was marked                                                        │
```

**6. History, Undo and Add campaigns.**

```
Upload history — Nebraska · Nov 3, 2026
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ WHEN              FILE                                   CAMPAIGNS   MARKED   DOORS DROPPED│
│ Oct 31, 1:47 PM   Early Voting List 10.31.26.csv                 3   10,753          4,451 │
│                   Ballot_Status: 169,652 of 273,834 rows                                   │
│                   by Alex Rivera · Add campaigns · Undo all                                │
│     Douglas County Commission      3,918 marked · 1,402 doors dropped   Undo this campaign │
│     CD-2 Paid Program              6,814 marked · 2,931 doors dropped   Undo this campaign │
│     LD 9 State Senate              undone Nov 1 by Jamie Ortiz: 21 un-marked, 418 kept     │
│                                    (a newer list includes them)                            │
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

*Marked* is how many marks each upload holds now: marks a newer list takes over on an undo are counted on that
newer list's row, so the numbers always say who holds what. **Add campaigns** is offered on the newest upload
only, since an older day's list is shorter. **Discard** appears on an upload that was matched but never marked.
Undo asks first: *Undo this upload for all 3 campaigns? It un-marks the voters it marked, except any a newer list
from this page still includes, and doors re-open where someone hasn't voted.* For one campaign: *… for CD-2 Paid
Program? It un-marks the voters it marked in this campaign, except any a newer list from this page still
includes.*

**7. A campaign's own Early Voting page.** Its share of an organization upload sits in its history. Nothing
there names another campaign, the organization's file or who uploaded it, because a team lead may be the
client. Org admins also see the file's name.

```
│ Oct 31, 1:47 PM   Your organization's list                 3,918     1,402         —   Undo │
│                   Ballot_Status: 169,652 of 273,834 rows                                   │
```

Org admins see the counting column's name, as above; a team lead sees only *169,652 of 273,834 rows*, since a
column's name is the organization's own text. *Not found* reads *—* on these rows, because the organization
keeps that list, not the campaign. **Undo** is
offered only once the share is done marking; a share whose undo stopped offers **Try again**, to its lead too.
Undo asks: *Undo this upload for this campaign? It un-marks the voters it marked here, except any a newer list
from your organization still includes.* When the election is busy, a lead sees only *This list is being
updated. Try again in a few minutes.*, never who is doing what. Org admins also see, above the file box: *For a
whole state's file, or one list for several campaigns, use your organization's Early Voting page →*.

**When something's wrong**, the page says so in place of the next step:

- **No Voter ID column** (found from the file's start, before anything is sent): the column box, as on the
  campaign page.
- **A row that never ends** (a quote mark not closed, or no line breaks): the reader's own sentence, as on the
  campaign page.
- **Over the size limit:** *This file is 612 MB. The most this page takes is 500 MB. Only the Voter ID column
  is used, so save a copy with just that column and upload it.* (For a workbook over 50 MB, the campaign page's
  Excel sentence.) Over 2 million rows, found once the file has been read: *This file has more than 2,000,000
  rows. Save a copy with just the Voter ID column, keeping only the voters who have already voted, and upload
  that.*
- **Sending stopped** (the connection dropped, the page closed, or the server restarted): *Sending stopped
  before the whole file arrived. None of its Voter IDs were kept. Pick the file again.*
- **Your last choice doesn't fit this file:** *Ballot_Status has more than 25 different values in this file, so
  it can't decide which rows count. Choose again.*
- **Someone else has an unfinished upload for this election** (told before you send), by where it is:
  - sending, matching or previewed: *Alex Rivera is uploading a list for this election. Wait for it to finish,
    or discard it from the history.*
  - stopped while matching: *Alex Rivera's upload for this election stopped while matching. Match it again or
    discard it from the history.*
  - marking or undoing right now: *Alex Rivera's list for this election is being applied (or undone) right now.
    Try again when it finishes.*
  - stopped while marking: *An upload for this election stopped partway (Alex Rivera, Oct 31). Resume it or undo
    what it marked before uploading another.*
  - stopped while undoing: *An undo for this election stopped partway (Alex Rivera, Oct 31). Try the undo again
    before uploading another.*
  Your own unfinished upload that hasn't started marking (still sending, matching or previewed) is simply
  replaced when you send again.
- **The election is busy:** *This election's lists are being updated. Try again in a few minutes.*
- **Matching stopped:** *Matching stopped. Match again*. It runs again from the IDs already sent.
- **Marking stopped:** *Resume* or *Undo what was marked* (panel 5). **An undo stopped:** *Try the undo again*.
  **A campaign added later didn't finish:** *Not marked yet. Try again.*
- **Left too long:** *This upload wasn't marked within a day, so its Voter IDs were cleared. Pick the file
  again.*
- **No campaigns to tick:** *No campaigns in Nebraska have Nov 3, 2026 as their election day. Set each
  campaign's election day to use this page.*
- **The election's list has ended** (30 days after the election): *This election's list ended on Dec 3, 2026.
  Its marks stay with each campaign.* No upload, Undo or Add campaigns.

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
  ([Campaign.js](../server/src/models/Campaign.js)). A ticked campaign must carry the upload's `electionDay`,
  checked when it's ticked and again before it's marked (§E). A campaign with `null` is offered only after its
  date is set (the campaign's key dates; Help Center *set-election-dates*). Archived campaigns (`archivedAt`)
  and campaigns being deleted (`deletion.requestedAt` set) are not offered, and never counted anywhere on the
  page.
- **Voted lists match by canonical ID** (leading zeros ignored), as the campaign upload does. That is safe
  here for the reason it's safe there: everything in scope is one state. (Do-not-contact stays exact because
  its parking is organization-wide across states; PROPOSAL_PARKED_IDS §F makes the same split.)

## B. Data model

| Model | Purpose / key fields |
|---|---|
| **`OrgVotedElection`** (new) | **The election's lock**, one per `{ organizationId, state, electionDay }` (unique). `runSeq` (top level, counting the runs) and `run: { kind, uploadId, campaignIds, votedUploadId, jobId, runSeq, attempt, phase, heartbeatAt }`, where `kind` is `mark` (Mark, Resume, Add campaigns and its Try again: the same steps) · `undo` (the whole upload or one share) · `campaign` (a campaign page's undo of its own upload that must re-credit marks, through the queue) · `listEnd` · `recount` (the nightly pass's recount), and `phase` is `queued` · `running` · `done` · `failed` (named `phase`, not `state`, which already names the US state). Every claim sets every field of `run` (§E). `run.campaignIds` is declared with `default: undefined`, so the step that makes sure the document exists writes no `run` (round 5: Mongoose's array default wrote `run: { campaignIds: [] }`), and a `null` phase is never written (round 4). **`holds`**: `[{ _id, campaignId, beatAt }]`, a campaign page's own upload, inline undo and per-voter un-mark while each runs (§E): holds never block each other, and no run starts while a fresh one exists. `listEndsAt`: 00:00 on election day + 30 in the organization's time zone, set when the document is created (TIMEZONES.md: the organization's clock anchors what no single campaign owns; that moment falls on that date in every US zone). `listEndedAt`: set when the list's end begins; `listDeletedAt`: set once its deletion has finished (§K). |
| **`OrgVotedUpload`** (new) | One organization upload, the unit of the page's history. `organizationId`, `state`, `electionDay`, `fileName`, `uploadedBy` (a User reference). **Status** (§E's table: `receiving` · `matching` · `previewed` · `matchFailed` · `applying` · `applyFailed` · `applied` · `undoing` · `undoFailed` · `undone` · `discarded`), changed only by compare-and-set; `endReason` (`sendStopped` · `expired` · `replaced` · `discarded` · `keepUnsuitable` · `tooManyRows` · `refused` · `matchStopped` · `applyStopped` · `undoStopped` · `listEnded`, the cause each screen sentence is chosen by; `error` holds only generic text, §E). `matchJobId`, `matchSeq` (matching takes no election lock, §D), `runSeq` (stamped by each run that changes the upload, so a failure listener's write lands only on its own run), `progress { stage, done, total }`, `heartbeatAt`. `unsettled` (true from creation until `applied`, `undone` or `discarded`, and never true again), `settledAt`, `stoppedAt`. `applyStartedAt`, `listWrittenAt`. The read summary: `idColumnDetected` (true when the name rules found the ID column); `idColumn`, and `keepColumn` (the counting column's name, only when rows were left out — item 45(c)'s rule), each stored only when `idColumnDetected`, else `null`, since on a file whose first row is data a column picked by hand is a voter's value; `totalRows`, `keptRows`. Totals the worker computes: `idsInFile`, `spellings`, `noId`, `matchedPeople`, `inNoCampaign`, `outsideState.count`, `alsoUnticked [{ campaignId, people }]`. **Shares:** `campaigns: [{ campaignId, votedUploadId, preview { inCampaign, willMark, alreadyVoted, doorsWillDrop }, result { marked, doorsDropped }, done, skipped (null · archived · deleting · electionChanged: only a share with no child, its `votedUploadId` unset), stopReason (null · archived · electionChanged: a share that has a child when its campaign stops being eligible, whatever its marks; it stays live and undoable), campaignDeleted, runSeq, undoState (null · undoing · undone · undoFailed: the one place a child's undo state lives; the child's own `undone` and `undoneAt` are set when its undo finishes), marksAtUndoStart, undoResult { unmarked, keptByNewerList } (set by the run that completes the undo, then never changed), undoneAt, undoneBy (a User reference) }]`. **Never stored:** `columns`, `sheetName` and `otherSheets` (the page has them from `/check`, and on a CSV with no header row the column names are a voter's row), the value counts for *Which rows count?*, and which values were ticked. **Held only until 24 hours after the upload settles, or 7 days after it stops, then cleared (§K):** `sampleIds`, `zeroMatchExample`, `outsideState.samples`, `outsideState.ids` and `unmatchedSample` (up to 10,000 of the file's spellings each, for the two downloads). `draftExpiresAt` (24 hours after creation, set once and never moved; the sweep honours it until the list is written, §K). Indexes `{ organizationId, createdAt: -1 }`; **unique** `{ organizationId, state, electionDay }` with `partialFilterExpression: { unsettled: true }` (round 2: a second insert was refused with E11000 on mongod 7.0.2); `{ draftExpiresAt: 1 }`, `{ settledAt: 1 }` and `{ stoppedAt: 1 }` (sparse, the sweep). |
| **`OrgVotedListId`** (new) | The kept list: **one row per ID per organization, state and election**, PROPOSAL_PARKED_IDS §F's shape from the first day, so daily cumulative files don't grow it. `organizationId`, `state`, `electionDay`, `canonical` (`canonicalVoterId`), `uploadIds` (the live organization uploads that listed it). Order in the array means nothing: MongoDB doesn't promise `$addToSet`'s order, so "earliest" always comes from the uploads' own `createdAt`. Unique `{ organizationId, state, electionDay, canonical }`, which also serves the retention delete by its prefix; multikey `{ uploadIds: 1 }`, which serves matching from the list (§E), undo's `$pull` and the `{ uploadIds: [] }` delete of empty rows (an equality match on the empty array uses the index; `$size: 0` scans the collection). **It has no `campaignId`, so it must never join `LATE_WRITE_MODELS`** (§K). |
| **`VotedUpload`** (existing), new fields | `orgUploadId` links a campaign's share (a "child") to its organization upload; absent on campaign uploads. Unique partial index `{ orgUploadId, campaignId }` with `partialFilterExpression: { orgUploadId: { $type: 'objectId' } }`, never `$exists`, which matches a stored `null` and would refuse every campaign's second campaign upload with E11000, and never `$ne: null`, which MongoDB refuses in a partial filter (round 1). On children: `startFullyVoted`, written before the first mark whenever it isn't set yet (graduation may have created the child first, §G). On campaign uploads only: `undoState` (null · `undoing` · `undoFailed`) for an undo that runs through the queue; a child's undo state lives on its share. The door lists live in `VotedUploadDoor`, not on the document: three lists of up to every matched door pass the 16 MB document limit at about 285,000 doors (round 4 measured 16.85 MB at 300,000). A child's `uploadedBy` is the org uploader (a User reference); what the campaign route returns about a child is a fixed list of fields (§J). |
| **`VotedUploadDoor`** (new) | The door lists of one child or campaign upload, one row per door per list: `organizationId`, `campaignId`, `votedUploadId`, `householdId`, `kind` (`affected`: every matched voter's door, as `classify`'s `affected`, written before the first mark; `marked`: the doors of marks the upload actually inserts, written before each batch's write; `undo`: the doors whose marks an undo deletes, both the mark's stored door and the voter's current one, written before each batch of deletes). Unique `{ votedUploadId, kind, householdId }`. A share's `affected` and `marked` rows are deleted once it's `done` (only Resume reads them), its `undo` rows once its undo completes, an election's leftovers at the list's end, and any the sweep finds for a finished share; and with the campaign and the organization. It carries `campaignId`, so it joins `LATE_WRITE_MODELS`. |
| **`VotedVoter`** (existing), new field | `movedFrom` (an array grown by `$addToSet`, sparse multikey index): each child an undo moved the mark away from, so a later move never erases an earlier one (round 5), and the undo's `keptByNewerList` is recounted from the data, never added up by hand (§F). |
| **`VotedUnmark`** (new) | A voter un-marked by hand on a campaign's page, written whenever an organization upload exists for an election the un-mark holds (the campaign's current one, or one where it has a share not finished, §E) and that list hasn't ended: `organizationId`, `campaignId`, `state`, `electionDay` (the latest-ending of those elections), `canonical` (the voter's canonical ID, since undoing an import and importing again gives the same person a new voter `_id`), `at`. Nothing else, so no record of who did it. **A mark is credited only to an upload created after `at`**, on every path: the apply, Resume, Add campaigns, graduation, the nightly pass, `reapplyVotedLists`, and both undo re-credits. For a child, the date compared is its organization upload's `createdAt`, never the child's own (a child made later by Add campaigns or graduation belongs to an older list). Marking never deletes the row, so undoing a newer list can't hand the voter back to an older one (round 5). Unique `{ campaignId, canonical }` (a second un-mark updates `at` and the election). Deleted with the campaign and the organization, and at the list's end of the election it names, by `state` and `electionDay`, so a campaign whose election day changed is still covered. |
| **`ImportJob`** (existing), new field | `orgGraduatedAt`: set when an import's marking from organization lists has run (§G). |
| **`Voter`** (existing), new index | `{ campaignId: 1, createdAt: 1 }`, so graduation can find a campaign's voters created since an import began (§G). Voter has timestamps (Voter.js). |
| GridFS bucket **`votedListDrafts`** (new) | The kept IDs of one organization upload between upload and the start of marking: the file's own spellings, one per line, opened with `openUploadStreamWithId(orgUploadId, …, { metadata: { organizationId } })`. Never the file. Deleted at the start of any run once the kept list is written (§E), by any undo or discard, when the upload record changed while it arrived, on any error while it's written (§C), and by the sweep and the list's end (§K). |

Unchanged otherwise: `VotedVoter` (one mark per voter per campaign; children's marks carry the child's
`uploadId`), `Household.fullyVoted`, `VotedPendingId` (still written by campaign uploads; **never** by children —
the kept list does that job).

**"Live share", defined once.** A share is live when its `undoState` is null, it isn't `skipped` or
`campaignDeleted`, its upload is `applying`, `applyFailed` or `applied` **and has written its list**
(`listWrittenAt`, so nothing is marked for an upload whose list a failed run could still take back, §E), and the
election's list hasn't ended (`listEndedAt` unset and `listEndsAt` in the future). One helper, `isLiveShare`, is
used by graduation, the nightly pass and the re-credit targets; nothing else defines it. **"Finished", the
other helper:** a share is finished when it's `undone`, `skipped` or `campaignDeleted`, or never got a child.
`shareFinished` decides which elections a campaign page's own writes hold (§E) and when an upload's last share
undo also runs the list step (§F): a share whose undo failed still holds marks, so it isn't finished.

## C. Reading the file, on the web dyno

**The organization comes first.** A new middleware, `requireActiveOrg`, runs before anything else on the
router, ahead of the storage engine, and answers 400 when no organization is active, as dnc.js's
`ensureOrgScoped` does inside its handlers. Without it a super-admin sending no `X-Org-Id` passes `orgContext`
with `activeOrg` null and no grant (orgContext.js), passes `requireOrgRole` (auth.js lets super-admins through),
writes no access log, and a filter holding `organizationId: undefined` stops scoping: round 1 saw Mongoose drop
the key from a `find`'s cast, and round 4 saw a `deleteMany` send it as `null`, which matches every document
without one. Either way a lookup by id would reach any organization's upload. Every lookup on these routes is
`{ _id, organizationId: req.activeOrg._id }`.

**The choice is made before the full send.** `POST /check` goes through `api()`, so a lapsed session, a grant
that ended or a password-change hold surfaces before the big upload. Memory only, nothing stored. The page
reads the file's first four bytes itself, as the server decides formats (a zip signature is a workbook, the
OLE2 signature an old `.xls`, anything else text), so an `.xlsx` named `.csv` is never sent cut short:

- **A CSV:** the page sends its first 1 MB with `truncated=1` (the server can't otherwise tell a cut head from a
  whole small file). A plain Papa parse returns the cut row as a row, with *MissingQuotes* when the cut falls
  inside a quoted cell (round 4), so the server drops the last row of a truncated head instead of refusing a good
  file as `unclosed-quote`. It returns the columns; the detected ID column (or the one passed as `idColumn`); the title-row
  hint (computed from the head as `readCsv` computes it, moved to a helper both use); every countable column's
  values with their counts in those rows, labelled as the first rows' counts; or the refusal (the code-less
  *Could not detect a Voter ID column* with its columns, or `row-too-long`). A countable column already over
  25 values in the first rows is reported unfit there, before anything is sent.
- **An Excel workbook:** the whole workbook, up to 50 MB, is read in memory by the Excel reader, as the campaign
  page reads it today, and its columns come back. The reader keeps only the ID column and one counting column
  (readIdColumn.js), so a column's values come back when the page asks again with that column as `keepColumn`
  (and `idColumn` when it wasn't detected), which is the campaign page's own two-step flow.
- **The election:** before sending, the page asks `GET /current` for the election's unsettled upload and running
  update, and refuses to send while someone else's upload is unsettled, with the sentences in *The screens*.
  (`/check` carries no election, so it doesn't answer this.)

The page holds **Send** until a choice exists: *every row*, or a column and its values. With a remembered
choice (decision 6), the page checks it against the first rows (the column must exist) and shows it. It also
shows the organization's last applied list for this election, read from stored fields only (`keepColumn`,
`keptRows`, `totalRows`, the uploader's name), and warns when this choice differs in column or in whether rows
are left out. Ticked values are never stored, so only that much can be compared.

**The upload record comes before the body.** `state`, `electionDay` and `campaignIds` travel in the query string,
so before multer reads a byte, the route validates the campaigns (§J's codes), expires any stale upload for the
election (§E), and creates the `OrgVotedUpload` (status `receiving`, `unsettled: true`, `heartbeatAt` now,
`draftExpiresAt` = now + 24 hours). `campaignIds` is one comma-separated value: Express parses queries with qs,
whose array limit is 20, so 21 repeated ids arrive as a plain object with numeric keys (round 4 tried it, as
clientReports.js already sends its `coordinatorIds`); the list is capped at 200 and each id validated, and a
`state` or `electionDay` arriving as an array is refused. When the organization's unsettled upload for this
election is the same uploader's and hasn't started marking (`matching`, `previewed`, `matchFailed`, or a
`receiving` one with a stale heartbeat), it's discarded by compare-and-set (`endReason: 'replaced'`; a match job
still running on it finds its final compare-and-set fails, harmlessly) and replaced, so *Change which rows
count* never runs into the one-upload rule. Anyone else's unsettled upload makes the insert fail on the unique
index: a 409, answered before the body is read (multer drains a body before it answers an error, so a refusal
after it would come only once the whole file had arrived). The route answers with `Connection: close` and
closes the socket once the answer is out, so the browser stops sending; whether every browser shows the answer
before it has finished sending is unverified, and the page's own `/current` check makes this rare. A heartbeat
timer writes `heartbeatAt` every 30 seconds while the file arrives, and stops when the request closes. If the
request fails before the storage engine takes over (a malformed body, no file part, the browser leaving during
the fields), the route's error handler and its `close` listener mark the upload `discarded`. The route then uses a multer custom storage engine
(`streamIdList`) instead of `memoryStorage`. Its `_handleFile(req, file, cb)` gets the file stream and reads its
first four bytes:

- the OLE2 signature: `legacy-xls`, as today;
- a zip signature: buffered up to 50 MB and read by the Excel reader as today
  ([readIdColumn.js](../server/src/services/import/readIdColumn.js), unchanged);
- anything else is a CSV: the stream goes into `readCsvColumns`, changed to take an async iterable of Buffers
  where it now slices one Buffer (its up-front head read becomes async), and to hand each kept spelling to a
  sink instead of collecting `raw`. The decoding and parsing logic doesn't change: `StringDecoder` already
  joins characters split across piece edges, and the format guess still comes from the first million
  characters. The guards added to the shipped reader on 2026-10-31 come with it: the first 10 rows must fit in
  the first 1M characters, a row still open after about 1 MB stops the read, and an unclosed quote at the end
  is refused. The sink writes each spelling to the draft's upload stream, waiting on `drain`. **Memory stays
  flat**: one 64 KB piece, Papa's current row, the value counters. Distinct IDs are counted on the worker, not
  here (a `Set` of 1M IDs is +71 MB, measured in round 1). Each piece still steps aside (`setImmediate`), so
  field traffic keeps being answered.

**Ending a send, every way:**

- **The browser goes away, or the reader refuses.** The engine calls the upload stream's `abort()`, which removes
  the chunks already written, and marks the upload `discarded` with its `endReason` (and `settledAt`,
  `unsettled: false`). Busboy destroys the file stream on a client abort, and multer calls `_removeFile` only for
  a file that finished, so the engine must do this itself (round 2 found 0 chunks left in 20 trials).
- **At the size cap.** Busboy emits `limit` and then ends the file stream *normally*. So the engine checks
  `truncated` before it ever calls `end()` on the upload stream, and aborts instead: `abort()` after `end()`
  throws and leaves the chunks (round 2). Multer then calls `_removeFile` for that file, which must accept a
  draft that's already gone.
- **After the file completed, a later error.** `_removeFile` deletes the draft with `bucket.delete(id)`,
  ignoring one already gone.
- **The upload changed while its file arrived** (discarded, replaced, or deleted with its organization: a
  deletion that retention triggers doesn't wait for sends, superAdmin/organizations.js): the route's
  compare-and-set from `receiving` misses, so the route deletes the draft itself with `bucket.delete(id)`.
  Multer calls `_removeFile` only on its own errors (make-middleware.js), not on this (round 5). The sweep's
  orphan rule backs it up (§K).
- **The web dyno restarts mid-send.** Nothing in the process runs: server.js drains for 25 seconds, then exits.
  The upload is left `receiving` with a heartbeat that stops. The server's stale check (§E) marks it `discarded`
  (`sendStopped`) once the heartbeat is over 2 minutes old, and the sweep removes its chunks (§K), so it never
  blocks the election.

*Count only rows where* is applied during the same pass, so `keepColumn` and `keepSelected` must arrive before
`file` in the multipart body (`idColumn` too). Busboy emits parts in order and `FormData` keeps the order they
were appended in (tried in round 1 with multer 2.1.1 and busboy 1.6.0). A file that comes first is refused (400
`fields-first`). Rows are dropped before the reader knows for sure whether the column is fit to count by (25
values or fewer, none over 64 characters, `applyKeep`'s rules), so if it turns out unfit past the first rows,
the upload is refused (400 `keep-unsuitable`) and discarded, never kept with rows wrongly dropped.

In the same pass every column but the ID column has its distinct values counted over the whole file (CSV; for
Excel, the counting column only): one `Map` per column, with `keepKey`'s rules, dropped once the column passes
25 values or a value passes 64 characters. Keys are copies (`own()`): Papa's values are slices that would keep
their 64 KB piece alive. The counts go back in the upload's answer to the uploader's own screen, as *In the
whole file*, and are **never stored**, the same rule item 45(a) set for the one column the campaign page counts.

**Caps.** CSV 500 MB (decision 2) and 2,000,000 rows (round 1 measured a single fold and its spellings at about
1.1 GB per pass at 5,000,000). Excel 50 MB, with the reader's own limits. The page checks the size against the
cap for the format it read from the first four bytes. Over the cap: 413 `file-too-large` naming the cap
(`idListTooBig`, given the format's cap; the parity test in
[idListUpload.test.js](../server/test/idListUpload.test.js), which holds today's 50 MB page limit to the
server's, is extended to the new caps). Over the row cap: 413 `too-many-rows`, discarded; that one can only be
known once the file has been read.

**Time limits.**

- **Node's own:** `server.requestTimeout` defaults to 300,000 ms in Node 18 and later, and server.js calls
  `app.listen` without changing it, so any request whose body takes over 5 minutes gets a 408. **server.js sets
  `server.requestTimeout = 30 * 60 * 1000`** (round 2: setting it after `listen` takes effect on Node 20.19.5,
  and `headersTimeout`, 60 s, still applies). That clock is server-wide, and other routes take big bodies too:
  the Voter Import and the three ID-list uploads accept up to 50 MB. So **a new `bodyDeadline(300_000)`
  middleware**, mounted in app.js first, before the webhook's raw body is read (app.js line 88) and before
  `express.json`, ends any request whose body hasn't finished in 5 minutes the way Node does: it writes a raw
  `408` to the socket and destroys it, unless the body is already complete (`req.complete`) or an answer has
  started (`res.headersSent`). An Express `res.status(408)` isn't enough, since a finished response detaches
  the request, and multer and raw-body never see it end (round 3 tried both). The organization upload route
  lifts its own deadline inside the route, through a handle the middleware leaves on `req`, after
  `requireOrgRole`, so only an authenticated org admin's upload gets 30 minutes. Heroku itself says protection from slow bodies belongs on the dyno: *"If you need
  protection from clients transmitting the body of a request slowly, … drop the request by closing the
  connection at the dyno"* ([HTTP Routing](https://devcenter.heroku.com/articles/http-routing)).
- **Heroku's:** *"The countdown for this 30 second timeout begins after the entire request (all request
  headers and, if applicable, the request body) has been sent from the router to the dyno"*
  ([Request Timeout](https://devcenter.heroku.com/articles/request-timeout)), and a body with a known length
  is passed on through *"a 1024 byte buffer, filled and flushed continuously"*
  ([HTTP Routing](https://devcenter.heroku.com/articles/http-routing)). So back-pressure reaches the browser,
  the parse finishes as the body does, and only closing the draft, writing the upload and enqueueing are left
  in the 30 seconds. Neither article documents Router 2.0's handling of a request body. **The build verifies
  it:** a synthetic file (never a real one, §M) sent to an internal organization on the live app over a
  connection throttled to 3 Mbps, taking longer than 60 seconds.

**Then.** Status `matching` by compare-and-set, with a fresh `matchJobId` (§D); enqueue the match on a new
`voted-list-queue`. Job data carries ids only, never voter IDs. If the enqueue fails or times out, the status
goes back to `matchFailed` by compare-and-set, bumping `matchSeq` so a job that lands after the timeout finds
its id stale and exits, and the answer is 503 `QUEUE_UNAVAILABLE` (the code the campaign delete uses). The answer is 202 with the upload's id, the read summary and the whole-file value
counts; the page polls `GET /:id/status`.

**Measure before building:** peak memory and the longest wait for other requests through the real route on
the scratch harness, for the 149 MB Nebraska-shaped file and a 500 MB synthetic one; and the Atlas load of one
daily match and apply for 15 campaigns (about 2,100 lookups of 5,000 spellings and 230,000 writes, estimated in
round 1). Round 2 measured the kept-list upsert locally: 13.3 s for 200,000 IDs and 137 s for 2,000,000 (2,000
per `bulkWrite`); Atlas will be slower. Same method as [PERFORMANCE.md](PERFORMANCE.md) → *Voter-ID list
uploads*.

## D. Matching (job `match`, on the worker)

Matching writes only the upload's own preview, never a mark or the kept list, so it takes no election lock. Its
own job ids (`voted-match-<uploadId>-<matchSeq>`) follow §E's rule: fresh per run, checked by the processor.

1. Read the draft (a stream) and fold the IDs **once for the job** with the exported `foldVoterIds`.
   `findVotersByVoterIds` folds internally and pads each ID to its scope's widest stored ID, so the job uses
   its lookup half directly, with the widest numeric ID across the ticked campaigns, and builds the spellings
   once.
2. **Per ticked campaign, one at a time**, so memory holds one campaign's matches: look up the campaign's voters
   in the lookup's own 5,000-spelling chunks, then `classify` and `previewDrops`. These are the functions
   [voted.js](../server/src/routes/admin/voted.js) runs today, moved into `services/voted/votedListOps.js` so
   both paths run one implementation, with every `$in` chunked at 20,000 (today's `classify`, `previewDrops`
   and `recomputeFullyVoted` pass whole arrays; 1M ObjectIds is 19 MB, over the 16 MB BSON limit; round 2
   confirmed chunking doesn't change the campaign path's results). Not-found IDs aren't listed per campaign:
   for a statewide file that list is nearly the whole file each time. Write the campaign's preview and
   `progress` after each one.
3. **People**: the union of matched canonical IDs across campaigns (`matchedPeople`). **In no campaign**: the
   rest, as a count plus up to 10,000 spellings (`unmatchedSample`).
4. **Outside the state**: one lookup in `{ organizationId }` scope (the `{ organizationId, stateVoterId }`
   index), keeping hits in other states' campaigns, as `parseAndMatchState` does: the count, 10 samples, and up
   to 10,000 IDs for the download (`outsideState.ids`, as dnc.js returns them).
5. **This election, not ticked**: the same lookup's hits in this state's campaigns on this election that
   weren't ticked (archived and deleting campaigns left out), counted per campaign.
6. Status `previewed` by compare-and-set from `matching`, on this run's `matchJobId`. A failure sets
   `matchFailed` (`matchStopped`) with generic text and keeps the draft until it expires, so **Match again**
   needs no re-upload.

**Matching again needs no file.** `POST /:id/match { campaignIds }` re-runs this job on the stored draft, from
`previewed` or `matchFailed`, with a fresh job id. It replaces every share's preview with the new campaign set.
The page uses it when the ticked campaigns change after a read (*Tick it and match again*), and for **Match
again** after a failure. Only a different ID column or counting choice needs the file sent again.

A **heartbeat timer** writes `heartbeatAt` every 30 seconds inside every job of this queue, the
campaign-deletion pattern (deleteCampaignProcessor.js), so no long step (round 2: a 2,000,000-row list upsert
took 137 s locally, a `$pull` of 2,000,000 rows 35 s) ever looks stopped.

## E. One update at a time per election, and applying

**The election's lock.** Every operation that writes marks or the kept list for an election takes the
election's lock first. An organization run, and the campaign page's queued undo, take it **exclusively**, in two
steps. Round 4 tried the one-step upsert: every loser, and even an uncontended attempt on a held lock, throws
E11000 instead of answering *taken*; a first insert returns `null` to its own winner; `$set` with `$inc` on `run`
conflicts; and a job id can't be computed in an inserting pipeline. So:

1. **Make sure the document exists:** `updateOne(key, { $setOnInsert: { createdAt, listEndsAt } }, { upsert:
   true })`. The server retries its own duplicate key here (0 errors in 50 concurrent tries, round 4).
2. **Claim it:** a non-upsert `findOneAndUpdate` filtered by the election key (step 1's `updateOne` returns no id
   for a document that already existed), with `run.phase` not `queued` or `running`, the list not ended
   (`listEndedAt` unset, `listEndsAt` in the future; the list's end claims without this condition) and no fresh
   hold, and a two-stage pipeline: first `runSeq` = `$ifNull: ['$runSeq', 0]` + 1; then `run` = `$mergeObjects`
   of every field, `jobId` being `'voted-run-' + $toString(_id) + '-' + $toString(runSeq)`, and `holds` with the
   stale ones filtered out. `new: true`. A `null` answer means taken: 409 `election-busy`. Round 5 found two
   traps here: a literal `runSeq + 1` gave a first claim `runSeq: null, jobId: null`, which no job could claim
   and no stale check could expire; and a plain `{ run: {…} }` in a pipeline merges into the old run, so a field
   one claim leaves out survives from the last. (Round 4: exactly one winner in each of 200 rounds of 50
   concurrent claims; round 5 repeated it on first-ever documents.)

**Holds, for a campaign page's own writes.** A campaign page's upload, inline undo and per-voter un-mark only
need to keep out organization runs, not each other, so they take a **hold** instead: step 1, then a pipeline
update that appends `{ _id, campaignId, beatAt }` to `holds` (dropping stale ones) if no run is `queued` or
`running` and the list hasn't ended. A `null` answer is 409 `election-busy`. A hold is beaten every 30 seconds
while its request runs, counts as stale after 2 minutes without a beat (a web dyno that died), and is pulled
when the request ends, however it ends. Two campaign pages, two clients' leads included, never wait for each
other, so a busy answer never tells one client that another is working (round 5). **Which elections:** the
campaign's current one (when it has an election day), plus every election where it has a share that isn't
finished (`shareFinished`, §B), since a share stays live after its campaign's election day changes (round 5: a
runoff upload under the new election's lock raced an undo of the old election's share). They're taken in key
order; if one is refused, those taken are pulled. A hold is taken whether or not the election has an
organization list yet (round 5: testing first raced a first-ever Mark), and kept for the whole write (round 5:
releasing it before an inline undo let Add campaigns count a voter as already voted whom the undo then
un-marked). Once the list has ended no hold is needed, since no organization run can start.

The operations that take the lock exclusively: Mark, Resume, Add campaigns and its Try again (kind `mark`); Undo
all, a share's undo and Try the undo again (kind `undo`); a campaign page's undo of its own upload where marks
must be re-credited (kind `campaign`, §F); the nightly recount (kind `recount`, §G); and the list's end (kind
`listEnd`, §K). Every holder of a run or a hold beats it every 30 seconds. The busy answer is *This election's
lists are being updated. Try again in a few minutes.*, and to a team lead *This list is being updated. Try again
in a few minutes.* This is what makes the rest simple:

- **No two runs ever touch one election's marks at once.** The queue already runs one job at a time, but a
  job's retry backoff, the web dyno, and the import and maintenance queues all ran beside it. Round 3 found
  overlapping share undos and Add campaigns cancelling each other, an undo settling the upload while another
  share still held marks, and a newer list undone between a run's attempts; round 4 found the campaign page's
  own upload, undo and un-mark slipping into an organization run. One lock per election closes the marks side
  of all of them. Graduation and the nightly pass (§G) are the only writers that don't take it: they only add
  marks for voters new since an import began, and they re-check after writing.
- **The lock is held until the run ends**, done or failed, retries included, so nothing slips between attempts.
- **The upload or share status changes in the same request**, by compare-and-set, after the lock is taken. If
  that compare-and-set fails, the lock is released (`done`) and the answer is 409 `state-changed`.
- **Every write that beats, releases or fails a run matches `{ 'run.jobId', 'run.runSeq', 'run.attempt' }`**, and a
  job whose heartbeat write misses stops at once: someone has released or expired its run, or a redelivery has
  taken it over.

**If the enqueue fails.** `queueOp` only races a timer, so an add that timed out can still land later
(queues/index.js). The route first releases the lock by compare-and-set on `{ jobId, phase: 'queued' }` →
`done`. Only if that wins does it roll back what it changed (the upload's status and the shares' states;
`draftExpiresAt` is never moved) and answer 503 `QUEUE_UNAVAILABLE`. If it loses, the job has already claimed the run, so the
answer is 202, as if the enqueue had worked. A job that lands after a successful rollback finds its run
released when it tries to claim it, and returns without throwing, so no failure listener fires for it. (The campaign-delete rollback this follows, campaigns.js, is safe
for the same reason: its guard is the field the worker changes when it claims.)

**The upload's status, and nothing else** (anything else is a 409 `state-changed`):

| From | Action | To |
|---|---|---|
| (new) | `POST /` | `receiving` → `matching` (§C), or `discarded` on any refusal or abort |
| `matching` | the job finishes / fails | `previewed` / `matchFailed` |
| `previewed`, `matchFailed` | **Match again** | `matching` |
| `previewed`, `matchFailed`, a stale `receiving` (and `matching`, for the same uploader sending again) | **Discard**, the same uploader sending again, or expiry | `discarded` |
| `previewed` | **Mark** | `applying` |
| `applying` | the run finishes / fails | `applied` / `applyFailed` |
| `applying` | the run stops before its list is written | `previewed` (nothing was marked; Applying, below) |
| `applyFailed` | **Resume** | `applying` (the shares not done yet) |
| `applyFailed`, `applied` | **Undo what was marked** / **Undo all** | `undoing` |
| `undoing` | the run finishes / fails | `undone` / `undoFailed` |
| `undoFailed` | **Try the undo again** | `undoing` |
| `applied`, `applyFailed` | the last share still holding marks finishes its undo (`shareFinished`, §F) | `undone` |
| `applied`, `applyFailed` | a share's undo | stays as it was; the share's own `undoState` changes (§J's `shareState`) |
| `applied` | Add campaigns, or its Try again | stays `applied`; the new shares' own state changes |
| any unsettled | the election's list ends (§K) | `discarded` if never marked; otherwise the status stays (`applyFailed` or `undoFailed`), settled in place, with `endReason: 'listEnded'` (round 5: calling a stopped undo `undone` misread the history while its marks stayed) |

A failed apply or undo is **never discardable**: once any share holds marks, only **Resume** or an undo moves it
on. An upload stopped partway stays unsettled, which blocks a new upload for the election until it's resumed or
undone; the 409 says so and names the way on (*The screens*). Settled means `applied`, `undone` or `discarded`,
or settled in place by the list's end;
`unsettled` turns false and `settledAt` is set at each, and never turns true again (so a later undo of an
`applied` upload can't collide with a newer upload's unique index).

**Fresh job ids, one attempt each.** Every run gets `jobId` = `voted-run-<electionId>-<runSeq>` (dashes: BullMQ
5.77.6 refuses a custom id containing `:` unless it splits into exactly three parts,
`bullmq/dist/cjs/classes/job.js`). Fixed ids would not do: the queue keeps finished jobs 7 days and failed ones
30 (queues/index.js), and adding a job whose id still exists does nothing and raises no error (round 2 tried both
cases; campaigns.js and enqueueOrgDelete.js already warn about this trap). These jobs are added with `attempts:
1`, as client-report builds are (worker.js), so a failure ends the run and a retry is always a new run with a new
id, started by the page's button or never. The new worker is created with `concurrency: 1` and `maxStalledCount:
1`, pinned rather than left to defaults: a stalled job (the worker died) is redelivered once with the same id,
`attempts: 1` notwithstanding, and fails on a second stall (round 4 tried it on BullMQ 5.77.6; the client-report
worker this follows uses 2). A redelivered job re-claims its own run with a fresh `attempt` (the fence, below)
and carries on, since every step is idempotent or recorded before it runs. A deploy or the daily restart drains
the worker for 25 seconds and exits (worker.js), so a long run is often redelivered this way, and resumes by
itself (round 5: claiming only from `queued` left it locked until the stale check, then waiting for **Resume**).
A concurrency-1 worker never fetches while its processor runs, but a stall from a blocked event loop can still
hand the job to a second process while the first runs on (round 5 tried it); the `attempt` fence stops the first
at its next check.

**The fence.** At its start the processor claims its run by compare-and-set on its `jobId` and `runSeq`, with
`run.phase` `queued` or `running` (a redelivery), setting `running` and a fresh `attempt` (an ObjectId), the way
client-report builds re-claim (`processClientReportJob`, clientReportBuilds.js); a job that can't claim returns
without throwing. Before each campaign, before each batch and with each heartbeat it re-reads the run and stops
unless `run.jobId`, `run.runSeq` and `run.attempt` are its own, `run.phase` is `running`, and the list hasn't
ended. Only `OrgVotedUpload` and
`OrgVotedElection` writes can carry the job in their filter; mark, list and door writes are idempotent upserts
and deletes (round 3: `VotedVoter`'s upsert filters on its unique `{ campaignId, voterId }`, so a job id can't ride
along), so a stale run can at worst finish one batch before its heartbeat or the fence stops it.

**The server decides "stopped", never the browser.** On every `GET /:id/status`, and in the 15-minute sweep, the
server expires stale work (the `maybeExpireStaleDeletion` pattern, campaigns/deletionState.js). The sweep scans
`OrgVotedElection.run` itself, since a crash between taking the lock and the status compare-and-set leaves a lock
with no upload in progress, and a campaign page's own run has no upload page polling it; every expiry is a
compare-and-set on the run's `jobId` and `runSeq`:

- `receiving` with a heartbeat over 2 minutes old: the send died with the dyno, so it becomes `discarded`
  (`sendStopped`);
- a match or a run whose heartbeat is over 10 minutes old, **and** whose job BullMQ reports in none of the live
  states: it becomes the failure state for its phase, with `endReason` (a run with no `jobId` counts as stopped;
  the list's end and the recount run inside maintenance jobs, so BullMQ reports their ids as unknown, and they
  stay live by beating every 30 seconds). A hold over 2 minutes without a beat is dropped. The check asks BullMQ for the job's state
  through a `jobStateOf(queue, id)` generalised from clientReportBuilds.js (today it's tied to the client-report
  queue), counts every state in `LIVE_QUEUE_STATES` as live (`delayed` included: a job in backoff isn't
  stopped), and treats a timeout or an unreachable Redis (`null`) as unknown, never as stopped. A run merely
  waiting behind another job reads *Waiting for another early-voting upload to finish*.

A **`failed` listener** in worker.js, like the ones for imports and deletions, matches the failing job's id
against the run, and writes the same failure states, on the upload and shares only where their `runSeq` is the
run's (so a Resume started meanwhile is never marked failed by its predecessor), and only from an in-progress
status (`applying`, `undoing`) or share state (`undoing`), so a job rolled back after a late enqueue can never
mark a `previewed` upload failed (round 5). It acts when BullMQ gives up, because an out-of-memory crash or a
stall never reaches the processor's own catch. Whoever records a failure of a run that stopped before
`listWrittenAt` takes the upload back to `previewed` instead (Applying, step 1).

**Errors never carry a Voter ID out of the process.** BullMQ keeps a failed job's message and stack in Redis for
30 days (job.js; queues/index.js), worker.js's `failed` listener logs every failed job's message to Heroku's
log, and a duplicate-key error on `OrgVotedListId` quotes the key. The precedent v5 cited,
deleteCampaignProcessor.js, logs the original message and rethrows the original error, so it isn't one (round
5). The processor catches everything, logs only `err.name` and `err.code`, and throws a **new** `Error` with
generic text (changing the original's message would leave it in the stack); jobs return nothing, or counts
only. A test forces a duplicate-key error and finds no ID in the log, `failedReason` or `stacktrace`.

**Deletions.** The campaign and organization delete routes add one busy check, *an early-voting update is
running* (409), beside their import and export checks (campaigns.js, organizations.js), so a delete never starts
under a running run. A deletion that starts first is caught by the run's re-checks below.

**Applying.** Order matters (§G):

1. Take the lock (kind `mark`); `previewed` → `applying`; set `applyStartedAt` (first run only). If
   `listWrittenAt` is already set (a Resume, or a run that died after writing the list), delete any draft still
   there first. **If the run stops before `listWrittenAt`** (a failed list write, a crash, a stale expiry),
   whoever records the failure `$pull`s the upload from the list rows written so far, deletes rows left empty,
   and puts the upload back to `previewed` with its shares as they were. Nothing was marked, since shares are
   live only once the list is written (§B), and the draft is still there under its original `draftExpiresAt`
   (round 5: `applyFailed` with no list made Resume impossible once the sweep took the draft, and keeping the
   draft instead broke the 24 hours).
2. **The kept list first, once.** Unless `listWrittenAt` is set: for each canonical ID in the draft (every one,
   decision 3), upsert `OrgVotedListId` with `$addToSet: { uploadIds }`, 2,000 per `bulkWrite`. Then set
   `listWrittenAt` and **delete the draft**: from here on, everything reads the upload's IDs from the list rows
   whose `uploadIds` contain it (the `{ uploadIds: 1 }` index), so nothing waits on a file that may be gone.
   Then check whether the organization's deletion cascade has begun, with a new organization-only
   `orgCascadeBegun(organizationId)`: the organization half of lateWriteSweep.js's `deletingTenant`, which
   deleteOrganization.js sets before its first sweep. Not `deletingTenant`: called without a campaign it returns
   `{ campaignId: undefined }`, which is truthy for every live organization (round 4), so read literally it would
   delete the list on every apply. And not `deletion.requestedAt`, since a requested deletion can be rolled back
   when its enqueue fails (enqueueOrgDelete.js). If the cascade has begun, delete this organization's list rows
   and stop. `deletingTenant` and `sweepIfDeleting` are also made to throw when called without a campaign, so no
   future caller can sweep with an empty campaign filter; today every caller passes one (round 5 checked all 17
   call sites). `OrgVotedUpload` and `OrgVotedElection` have no `campaignId` either, so they never join
   `LATE_WRITE_MODELS`.
3. **Each live share not yet `done`**, in turn, inside `sweptAfter` ([lateWriteSweep.js](../server/src/services/platform/lateWriteSweep.js),
   the run-then-sweep wrapper conversionProcessor.js uses), so a campaign deletion that begins mid-step leaves
   nothing behind:
   - re-check the campaign: archived, its deletion cascade begun, or its state or election day changed since it
     was ticked. A share with no child is marked `skipped` with the reason, by a compare-and-set that requires
     its `votedUploadId` unset; a share with a child (marked or not: an earlier run, or graduation) gets
     `stopReason` instead and stays live, so any marks keep their **Undo** and are never stranded. Graduation
     sets `votedUploadId` by compare-and-set before it marks (§G), so exactly one of the two wins (round 5: a
     skip landing after graduation re-read the share stranded its marks, and a child with no marks fitted
     neither). Either way the run moves on. A deletion merely requested isn't a
     reason: the delete routes refuse while a run holds the lock, and a cascade that runs deletes the child and
     its marks anyway;
   - find-or-create its child `VotedUpload` as an upsert on `{ orgUploadId, campaignId }` (the server retries
     its own duplicate key on the partial unique index; find-then-create threw E11000 on 1,887 of 2,000 racing
     calls, round 5), and set the share's `votedUploadId`;
   - match the campaign's voters against the list rows for this upload;
   - unless the child's `startFullyVoted` is already set, write its `affected` doors (every matched voter's door,
     as `classify`'s `affected`, so the result counts drops the way the preview's `previewDrops` did) to
     `VotedUploadDoor` and set `startFullyVoted`. Graduation may have created the child first (§G), so "the
     first run" isn't the test;
   - in batches: write the doors of the voters the batch will newly mark to `VotedUploadDoor` (`marked`)
     **before** the write, so a crash between the two never loses them; upsert `VotedVoter` (`$setOnInsert`,
     `uploadId` = the child), skipping voters whose `VotedUnmark` row is dated after this organization upload was
     created (the upload's `createdAt`, never the child's), and never deleting a row (round 5);
   - recompute `fullyVoted` over the `affected` doors, through a new option on `recomputeFullyVoted` that
     **writes** only the doors in the `marked` list and the doors whose computed value differs from the stored
     one. Each write is filtered on the door's `updatedAt` as read before its residents, and a door whose write
     misses is read and computed again: every write to a door bumps `updatedAt`, so a walk-up add or an un-mark
     that changed it meanwhile is never overwritten (round 5 traced that race in shipped code, where a campaign
     upload's recompute can hide a door at which a walk-up was just added, canvass.js; the option is the
     default for every caller, so the campaign path is fixed too). That keeps the campaign path's drift repair,
     and keeps *Doors that will drop* equal to the result, without bumping unchanged doors onto every phone's
     change feed. Every door with a new mark is written,
     which is how open phones learn of it (`/changes` ships every voter of a door whose `updatedAt` moved,
     bootstrap.js), and because the `marked` list is kept, a resumed run still writes the doors an earlier run
     marked;
   - set the child's `matched` and the share's `result.marked` from `countDocuments({ uploadId: child })`, and
     `doorsDropped` = fully voted among the `affected` doors − `startFullyVoted`; then `done: true`, and delete
     the share's `affected` and `marked` door rows.
4. `applying` → `applied` by compare-and-set; `unsettled: false`; `settledAt`; release the lock (`done`).

**Resume** takes the lock (kind `mark`) and repeats from step 3 for the live shares not `done`. Step 2 is
skipped once `listWrittenAt` is set, and every step is idempotent or recorded before it runs, so a stalled-job
redelivery (which resumes by itself, the fence above) or a crash between any two steps resumes cleanly. A crash between the list write and the draft delete
leaves a draft that step 1 of the next run deletes, and the sweep too (§K). A crash after the last share but
before step 4 resumes into an immediate step 4.

The new queue runs **one job at a time** on the existing worker (Performance-M), which bounds memory. A
15-campaign apply holds other early-voting jobs for its length, and the page says so. That's acceptable at
today's scale, and to be revisited if two organizations collide. It adds one Redis connection on the worker
(within Premium 0's 40), and the connection-budget comment in
[connection.js](../server/src/queues/connection.js) is brought up to date. Whether Heroku runs an old and a new
worker side by side during a deploy is unverified; the fence above keeps an overlap to at most one campaign's
idempotent batch.

## F. Undo (job `undo`, under the election's lock)

**Re-credit to a newer organization list, never strip a mark it still holds.** `$setOnInsert` credits each mark
to the first upload that made it, so in a daily cumulative run nearly every mark belongs to day 1, and deleting
by `uploadId` alone would un-mark, on undoing day 1, voters whom days 2 to 5 still list. So for each mark
credited to the share being undone, the job looks up the voter's canonical ID in `OrgVotedListId` (about 15
indexed lookups of 2,000 for 30,000 marks, round 2). If another upload of this election lists it with a live
share in this campaign (`isLiveShare`), and was created after the voter's `VotedUnmark` row if there is one
(round 5: without that test, undoing a newer list handed a hand-unmarked voter back to an older one), the mark's
`uploadId` moves to that upload's child (the earliest by `createdAt`, found or created by the apply's upsert).
Otherwise it's deleted. Campaign-page uploads keep no list of whom they named, so a newer
*campaign-page* list can't hold a mark this way; the promise is worded *a newer list from this page*, and
EARLY_VOTING.md's *Undo order* gotcha says so. The lock means no other list of the election can change while an
undo runs.

**Each batch, in this order**, so a retry is always right:

1. Decide, for the batch's marks, which move and which are deleted.
2. Write the doors of the marks to be deleted to `VotedUploadDoor` (`undo`), grow-only: each mark's stored door
   and its voter's current one, since nothing updates a mark's door when its voter moves (auditVotedDoors.js
   Check C), and today's undo, reading only the stored one, can leave the new door dropped (round 5, in shipped
   code; this fixes the campaign path too). A retry that finds a mark now has no live list to move to adds its
   doors then.
3. Move (`updateMany` by `_id`, setting `uploadId` to the newer child and adding this one to `movedFrom`) and
   delete.

At the end of every run, recompute `fullyVoted` over the whole `undo` door list; set every touched child's
`matched` and its share's `result.marked` from `countDocuments({ uploadId })`; and, on the run that completes the
undo, set the share's `undoResult` once from the data: `keptByNewerList` = `countDocuments({ movedFrom: child })`,
`unmarked` = `marksAtUndoStart` (written on the first attempt) − `keptByNewerList`, never below 0. It's never
recomputed after, so a later undo moving those marks again can't change a finished undo's numbers (round 5).
One case stays approximate: a mark this undo moved that another share's undo then deleted, between this undo's
failure and its retry, counts as un-marked by both. When the undo completes, its `undo` door rows are deleted. So a retried undo re-opens every door whose
mark it deleted, on any attempt (round 3 reproduced a door left dropped when the doors were saved only on the
first attempt), and no number is added up by hand, so a crash between a write and its count loses nothing.

- **Whole upload** (Undo all, Undo what was marked, Try the undo again): take the lock (kind `undo`; refused with
  409 `list-ended` once the list has ended, here and on every undo route); `applied`,
  `applyFailed` or `undoFailed` → `undoing`; delete any draft still there; every share not `undone` (null or
  `undoFailed`) becomes `undoing`, which stops new marks for voters imported later (§G); then each share in turn as
  above, set `undone` (and the child's own `undone` and `undoneAt`); then `$pull` the upload from `OrgVotedListId`
  (`{ uploadIds: 1 }`), delete the rows left empty (`{ uploadIds: [] }`), and set `undone`, `unsettled: false`,
  `settledAt`; release the lock. A failure (the processor's catch, the failed listener, or the stale check) moves
  every share of the run still `undoing` to `undoFailed`, and the upload to `undoFailed`, so no share is left
  reading *undoing* with no button.
- **One campaign's share** (from the org page or the campaign page, by an admin or that campaign's lead): take the
  lock (kind `undo`); that share's `undoState` null or `undoFailed` → `undoing`; the steps above for it alone;
  `undone`. The upload stays as it was (`applied` or `applyFailed`), so every other share keeps its **Undo**. When
  every share of the upload is finished (`shareFinished`: undone, skipped, its campaign deleted, or never given
  a child), the list step runs too and the upload becomes `undone`. A share whose undo failed isn't finished, so
  another share's undo never settles the upload under it (round 5: settling it stranded that share's marks behind
  a 409 on its **Try again**). A failure leaves the share `undoFailed`, and its **Try again** (to its lead too) is
  a new run.
- **A campaign-page undo, when an organization list is involved.** The campaign page's
  `POST /admin/campaigns/:id/voted/undo` checks the upload it's handed. A child: it refuses with 409
  `list-ended` once that election's list has ended, and otherwise enqueues the one-campaign undo above and
  answers 202 with `{ queued: true }` and no ids. A campaign upload: it takes its holds first (§E), and only then
  tests whether the campaign holds a live share in any election. With one, the undo must re-credit marks onto
  that election's children, so it turns its hold on that election into the exclusive run (one compare-and-set:
  no other fresh hold, no run), sets the campaign upload's `undoState` `undoing`, runs through the queue (kind
  `campaign`) with the same batch order, stale check and failure listener, and answers 202; its failure leaves
  `undoFailed`, with **Try again**. Without one, it undoes inline under its holds, as today, with a 200, and pulls
  the holds after. The page handles both answers.
- **A campaign page's own upload** (`POST /admin/campaigns/:id/voted/import`) takes its holds (§E) for the whole
  upload, inline, beating them while it runs. Otherwise an
  organization undo running beside it could delete a mark the campaign upload had just counted as already voted,
  leaving the voter un-marked though the campaign's own list names them (round 4). Leads' uploads included: while
  an organization update runs, they get *This list is being updated. Try again in a few minutes.* Being newer
  than any un-mark, a campaign upload may mark a voter un-marked by hand, and leaves the `VotedUnmark` row, as an
  organization upload does.
- **The per-voter un-mark** takes its holds too (§E), inline. An
  organization run's recompute reads a door and writes it later, and an un-mark landing in between would leave
  the door dropped with the voter un-marked (round 4). It writes the `VotedUnmark` row whenever an organization
  upload exists for an election it holds and that list hasn't ended (round 5: a campaign with no share yet,
  added later to an older list, would otherwise be marked again), recomputes the door, and recounts the child it
  took the mark from. Where no organization upload exists for the election, it writes no row and stays as it is
  today.
- **After the list ends** (30 days after the election, §K) there's nothing to re-credit by, so the upload's Undo
  and Add campaigns are withdrawn (409 `list-ended` on the organization page, and on a campaign page's undo of a
  share, checked under the lock; the page says so, and `shareState` reads `ended` before anything but `undone`,
  §J). The marks stay with each campaign, and the campaign page's per-voter un-mark still works (round 5: a share
  undo still reachable from a campaign page, with no list left to re-credit by, would have un-marked voters a
  newer list holds).

## G. Voters imported later (sticky marks)

[importProcessor.js](../server/src/services/import/importProcessor.js) calls `reapplyVotedLists` today. After it,
add `reapplyOrgVotedLists(campaign, importJob)`. It doesn't rely on the import's list of inserted voters: a
crashed attempt's inserts can be lost from it (the capture is saved once, after the whole write,
importProcessor.js lines 444-456, and `counts.insertedVoterIds` holds only the current attempt's), and on a first
attempt the loaded `importJob` never carries it (line 121). It anchors on time instead:

1. Find the live shares for this campaign (`isLiveShare`) whose upload's `state` and `electionDay` still equal
   the campaign's, re-read when the hook runs (not the copy loaded at the job's start, importProcessor.js line
   124). (A campaign whose election day was changed, say for a runoff, stops receiving that election's
   marks.)
2. Find the campaign's voters created since this import job was created (`Voter.createdAt` ≥
   `ImportJob.createdAt`, on the new `{ campaignId, createdAt }` index; the job's `createdAt` is set once, unlike
   `startedAt`, which every attempt rewrites). A voter with a `VotedUnmark` row is credited only to an upload
   created after it (step 4), as on every path. Voters another import created in the same window are included,
   which is right: they're new voters on a live list.
3. Fetch `OrgVotedListId` rows for those uploads' `{ organizationId, state, electionDay }` with `canonical` in
   that set and `uploadIds` intersecting the live uploads.
4. Credit each mark to the earliest live upload in the row's `uploadIds` by `createdAt`, among those created
   after the voter's `VotedUnmark` row if there is one, using this campaign's child of that upload, found or
   created by the apply's upsert after setting the share's `votedUploadId` by compare-and-set (a share already
   skipped refuses it, §E): a share the apply hasn't reached yet, or a new Add campaigns share,
   has no child yet (the apply then writes the child's `affected` doors and `startFullyVoted`, since it tests
   whether they're set, not whether it made the child).
5. Upsert `VotedVoter`, then **re-read the share and the voters' `VotedUnmark` rows**. A mark whose voter was
   un-marked meanwhile, after its upload was created, is taken back like a dead share's (an un-mark takes a hold
   and graduation doesn't, so one can land between graduation's read and its write, round 5). If the share is no
   longer live (an undo started meanwhile), first
   re-credit those marks to another share that's live now (step 4 again, without the share just found dead);
   delete only the ones no live share lists, and only while still credited to that child
   (`{ _id: { $in: ids }, uploadId: child }`, so a mark an undo has just moved to a newer list's child is left
   alone), returning their doors to the recompute.
6. Recount the touched children (`countDocuments({ uploadId })`) and set their `matched` and their shares'
   `result.marked`. Return the doors, which join the import's existing `toRecompute`, and set
   `ImportJob.orgGraduatedAt`.

Why this is enough, and where it isn't:

- **Only voters new since the import began can graduate.** Everyone present at apply was matched then.
- **Order closes the race with an apply.** The list is written before the apply matches, and an `applying`
  upload's shares are live from the moment its list is written. So a voter created before the apply's match is marked by the apply, and one created
  after finds the list waiting.
- **Step 5 closes the race with an undo.**
- **A hand un-mark stands.** `VotedUnmark` is checked by every automatic path. Only an upload created after the
  un-mark marks the voter again.
- **An import that dies before its hook runs** (a crash that never succeeds) is covered by a **nightly pass**
  (maintenance queue): for each import of kind `apply` with no `orgGraduatedAt`, in a campaign with a live share,
  that was still running when that share's upload began applying or started after (`completedAt`, or now, at or
  after `applyStartedAt`), it runs steps 1–6 from that import's `createdAt`, then sets `orgGraduatedAt`. It runs per
  campaign inside `sweptAfter({ campaignId, organizationId })`, skipping tenants being deleted, so its marks can't
  outlive a cascade (the delete routes' busy checks cover imports, not this pass). Preview, geocode-check and
  pin-lookup jobs (other `kind`s, ImportJob.js) never run the hook and are skipped.
- **Counts can drift between runs** if two writers recount the same child at once. The nightly pass ends by
  recounting the children of the organization's live uploads, election by election and only where it can take
  that election's lock (kind `recount`); a busy election waits for the next night, so the recount never overwrites a running
  update's count.

## H. Add campaigns

`POST /:id/campaigns { campaignIds }` is offered on the organization's newest `applied` upload for the election
only. It takes the lock (kind `mark`), adds the campaigns' shares (same state and election, eligible, and either
not on the upload yet or on it as `skipped`, which a corrected election day or a reversed archive can make
eligible again) with `done: false`, and runs §E's step 3 for them, matching against the list rows for
this upload, with no file. A share that a failed run leaves not done reads *Not marked yet* with **Try again**,
which is a new `addCampaigns` run for the shares not done. From then on, imports into them graduate as in §G.

## I. The summary

`GET /summary?state&electionDay` returns, per campaign on that election:

- `VotedVoter` count (`{ campaignId, voterId }` index);
- `Household` count with `fullyVoted: true`;
- the newest live upload of either kind;
- `earlyVotingStart` and `earlyVotingEnd`;
- `stale`, which is true when today, in the campaign's time zone, is inside its early-voting dates and the
  newest list is more than 24 hours old;
- whether the campaign has a live share on the organization's last applied list for this election (the default
  ticks, Part 1: an undone, skipped or deleted share doesn't count).

The page shows it in the campaign tick list (*The screens*, 1), with `stale` written as *No list in N days*.

## J. Endpoints

All mounted at `/admin/voted-lists`, behind `requireAuth, orgContext, requireActiveOrg, requireOrgRole('admin')`,
in that order, ahead of any body parsing. Staff get into a customer organization only through `orgContext`,
which requires a live support grant for it (`SUPPORT_ACCESS_REQUIRED` otherwise) and records the grant on the
request; `requireOrgRole` lets staff through after that. The central access log
([accessLog.js](../server/src/middleware/accessLog.js)) logs every staff request it isn't told to skip, and
`classifyResource`'s existing `/\/voted/` rule labels these paths `voted` (round 1 ran it).

**The status poll alone is exempt** from the access log, so a staff member's open page doesn't write a row every
1.5 seconds. It's a fourth entry in `AUDIT_EXEMPT`
([supportAccess.js](../server/src/services/access/supportAccess.js)), anchored, `/^\/admin\/voted-lists\/[^/]+\/status$/`
(the list holds anchored path regexes, tested against the URL without `/api`, round 2), and its answer carries
only status, progress, `heartbeatAt`, waiting or running, and numeric counts: never a column name, which on a CSV
with no header row is a voter's row. [accessLogCoverage.int.test.js](../server/test/accessLogCoverage.int.test.js)
pins the exempt list, so it gains this path under EXEMPT, and `/:id`, `/:id/unmatched.csv`,
`/:id/outside-state.csv`, `/current` and `/summary` under the paths that must be logged.

| Method · path | Body | Returns |
|---|---|---|
| `GET /options` | — | the pickers: states, the elections in each, and each election's campaigns (archived and deleting left out; `null`-date campaigns flagged); whether each election's list has ended |
| `GET /current` | `?state&electionDay` | the organization's unsettled upload for the election, if any (so the page picks up where it was), and the election's running update, if any, as fixed fields (status, uploader's name, date, progress; never the samples) |
| `GET /last-choice` | `?state&electionDay` | the organization's last applied list's counting column, rows counted, total rows, uploader's name, date |
| `POST /check` | `multipart/form-data`: `file` (a CSV's first 1 MB, or a whole workbook), `truncated`?, `idColumn`?, `keepColumn`? | columns, the ID column, the title-row hint and value counts, or the refusal; nothing stored |
| `POST /?state&electionDay&campaignIds` (`campaignIds` one comma-separated value) | `multipart/form-data`: `idColumn`?, `keepColumn`?, `keepSelected`?, **then** `file` | 202 `{ id, read summary, whole-file value counts }` |
| `GET /:id/status` | — | status (after the server's stale check), progress, `heartbeatAt`, waiting or running, numeric counts |
| `GET /:id` | — | the full preview and results (sample IDs included until the sweep clears them) |
| `GET /:id/unmatched.csv` | — | up to 10,000 IDs in no ticked campaign; 410 `sample-cleared` once cleared |
| `GET /:id/outside-state.csv` | — | up to 10,000 IDs matching other states' campaigns; 410 `sample-cleared` once cleared |
| `POST /:id/match` | `{ campaignIds }` | 202; matching again on the stored draft (§D) |
| `POST /:id/apply` | — | 202; **Mark** from `previewed`, **Resume** from `applyFailed` |
| `POST /:id/undo` | `{ campaignId? }` | 202; the whole upload, one share, or **Try the undo again** |
| `POST /:id/campaigns` | `{ campaignIds }` | 202; Add campaigns, or **Try again** for shares not done |
| `DELETE /:id` | — | discards an upload never marked |
| `GET /` | `?state&electionDay` | history, the newest 50, every status, as fixed fields per row (never the samples); **Discard** shows on the discardable ones |
| `GET /summary` | `?state&electionDay` | §I |

**The refusals:**

| Status · code | When | Sentence (or the screens' wording) |
|---|---|---|
| 400 (no code) | no organization selected | *Active organization required.* |
| 400 `campaign-not-eligible` | a `campaignIds` entry is in another state or election, archived, being deleted, has no election day, or isn't the organization's; more than 200 ids, or one that isn't an id; a `state` or `electionDay` sent twice | names the reason per campaign |
| 400 `fields-first`, `keep-unsuitable`, `keep-selected`, `id-column`, and the reader's codes | §C; the reader's existing refusals | the reader's own sentences |
| 413 `file-too-large` | over the format's cap | §C |
| 413 `too-many-rows` | over 2,000,000 rows, known once read | *The screens* |
| 409 `upload-unsettled` | someone else's unsettled upload for the election, with `{ byName, status }` (your own, not yet marking, is replaced instead) | the five sentences in *The screens*, by its status |
| 409 `election-busy` | the election's lock is taken | *This election's lists are being updated. Try again in a few minutes.*; to a lead, *This list is being updated. Try again in a few minutes.* |
| 409 `state-changed` | a compare-and-set missed | *This upload just changed. Refresh to see where it is.* |
| 409 `list-ended` | Undo, Add campaigns or an upload after the list ended | *The screens* |
| 410 `sample-cleared` | a download after the sweep | *That download has been cleared.* |
| 503 `QUEUE_UNAVAILABLE` | the enqueue failed; the status was rolled back | *We couldn't start that just now. Try again.* |

The campaign router changes in three places:

- **`GET /admin/campaigns/:id/voted`** returns a child row as a fixed list of fields: `_id`, `createdAt`,
  `fromOrganization: true`, `idColumn` and `keepColumn` for an org admin or staff only (stored only when the name
  rules found the ID column, so a column picked by hand on a file whose first row is data never reaches anyone; a
  lead gets the row counts without them, since a column's name is the organization's text and could name a
  client, round 5), `keptRows`, `totalRows`,
  `matched`, `doorsDropped`, `undone`, `undoneAt`, and `shareState`. It never includes
  `orgUploadId`, `notFound`, other campaigns or the uploader, and adds `fileName` only for an org admin or staff.
  Since 2026-10-31 (privacy item 49) every row's uploader is name only. `idColumn` keeps *Your last upload used
  X* right for admins (`lastIdColumn`; a lead's reads only the campaign's own uploads); `totalRows` completes the subtitle (`historySubtitle`); `undone` drives the row's
  grey and its button as today. **`shareState`** (not `state`, which `historySubtitle` already reads as the US
  state) is derived, read in this order with the first match winning: `undone`, `ended`, `undoing`, `undoFailed`,
  `stopped`, `done`, `marking`, `notMarked` (round 5: `ended` before `undoFailed`, so no **Try again** survives the
  list's end):

  | `shareState` | When | The row offers |
  |---|---|---|
  | `marking` | this share not `done` while this upload's run holds the lock | nothing |
  | `notMarked` | this share not `done`, and no run of this upload holds the lock (Add campaigns failed, or a resume pending) | for admins, a link to the organization's Early Voting page (the row carries no upload id to retry with); nothing for leads |
  | `done` | the share `done` and live (`isLiveShare`), the upload `applied` or `applyFailed` | **Undo** |
  | `stopped` | the share has a `stopReason`: its campaign was archived, or its election day changed, after it was marked | **Undo** |
  | `undoing` | `undoState` `undoing` | nothing |
  | `undoFailed` | `undoState` `undoFailed` | **Try again**, to leads too |
  | `undone` | `undoState` `undone` | nothing (*undone*) |
  | `ended` | the election's list has ended (`listEndedAt` set, or `listEndsAt` passed) | nothing: the marks stay |

  (A skipped share has no child, so it never reaches this route; nor does a deleted campaign's share, since the
  campaign is gone.) A campaign upload's own rows gain
  the same idea in a smaller form: `undoState` drives *undoing* and **Try again** when its undo ran through the
  queue. Every row, campaign upload or child, is projected to a fixed list of fields: today the route returns
  whole documents (voted.js), so without the projection a campaign upload's internal fields would leave the
  server.
- **`POST /undo`** refuses a child's undo with `list-ended` once its list has ended, and otherwise enqueues it;
  for a campaign upload it takes its holds, and enqueues when marks must be re-credited (§F). Either answers 202
  with `{ queued: true }` and no ids; otherwise it stays inline with a 200. A lead whose undo meets
  a busy election gets `election-busy`, naming no person and no campaign.
- **`POST /import` and `POST /unmark`** take their holds (§E) and answer `election-busy` the same way. `/unmark`
  also writes the `VotedUnmark` row where an organization list exists (§F); `/import` never deletes one.

**Phones call none of these** (`npm run audit:mobile-api -- --list`), so there's no client-version gate.

## K. Retention and deletion

| What | Kept until |
|---|---|
| The file | Never stored. It streams through memory (§C). |
| `POST /check`'s reads | Never stored: memory only, for that request. |
| The draft (kept IDs, GridFS) | Deleted right after the kept list is written (§E step 2) and again at the start of any later run once `listWrittenAt` is set; by any undo or discard (by a person, a replacement, a refusal or an abort, §C); when the upload record changed while the file arrived (§C); and on any error while it's written. The sweep deletes the draft of any upload that is settled or has `listWrittenAt`; expires an upload whose `draftExpiresAt` (24 hours after creation, never moved) has passed and that isn't `applying`, by compare-and-set to `discarded` (`expired`) first and only then deleting its draft, so a Mark at hour 24 wins or loses cleanly (round 5); and deletes any draft whose upload no longer exists, once over 30 minutes old. A run that stops before its list is written puts the upload back to `previewed` under the same `draftExpiresAt` (§E). The list's end deletes the election's drafts too. So no draft outlives 24 hours unmarked, the list's end, or its organization (round 4 found three paths that left one; round 5 the stopped-before-the-list path and an organization deleted mid-send). |
| Orphaned chunks | Any `votedListDrafts` chunks whose `files_id` has no `files` document and no live upload, once over 24 hours old. A chunk's `_id` is an ObjectId made at write time, so "older than 24 hours" is a range on the `_id` index (round 2). |
| The value counts | Never stored (§C). |
| `sampleIds`, `zeroMatchExample`, `outsideState.samples`, `outsideState.ids`, `unmatchedSample` | 24 hours after the upload settles (`settledAt`), or 7 days after it stopped partway (`stoppedAt`, set on `applyFailed` and `undoFailed`) if it hasn't settled by then, and at the list's end in any case (round 5: an upload the list's end settled kept them 24 hours longer). Column and sheet names are never stored (§B). |
| `OrgVotedListId` | At the list's end (`listEndsAt`: 00:00 on election day + 30 in the organization's time zone), per organization, state and election; undo (§F); and by the sweep, for an organization that no longer exists. |
| `OrgVotedUpload` | Kept as history (counts, the file's name, and the ID and counting columns' names when the name rules found them; no IDs once swept), like `VotedUpload`; deleted with the organization. |
| `OrgVotedElection` | The lock, its holds and its last run's state; deleted with the organization, and by the sweep for an organization that no longer exists (a hold or claim racing a cascade could make one again). |
| `VotedUnmark` | With the campaign and the organization, and at the list's end of the election it names (by `state` and `electionDay`); never by marking (§B). |
| `VotedUploadDoor` | A share's `affected` and `marked` rows once it's done; its `undo` rows once its undo completes; the election's leftovers at the list's end; and with the campaign and the organization. |
| Marks (`VotedVoter`) | As today: with the campaign. |

- **The sweep runs every 15 minutes** on the maintenance queue, arranged like the account-deletion sweep
  (`DELETION_SWEEP_JOB`, retention/scheduler.js): in `MAINTENANCE_JOBS`, writing no `RetentionRun` per run, so
  it neither floods that collection (96 rows a day, which the scheduler's own comment rules out) nor turns the
  retention banner red. It expires stale runs and holds (§E); deletes expired and orphaned drafts and orphaned
  chunks (never an upload that is marking or undoing); clears samples on the schedule above; deletes list rows,
  `OrgVotedElection`, `VotedUnmark` and `VotedUploadDoor` rows of organizations that no longer exist (round 5: a
  cascade that ran during a send, or a crash after `orgCascadeBegun`, could leave them where no election's end
  reaches); and finishes any list's end that's due (below).
- **The list's end is the promise the page shows**, so the date drives it, not a daily slot. At `listEndsAt` the
  list has ended: `isLiveShare` turns false, and every route and claim refuses Undo, Add campaigns and new
  uploads with `list-ended` from that moment, before any job runs (round 5: refusals keyed on a field only the
  job set let runs start after the date). Every 15-minute sweep, and the daily job, then finish each due election
  without `listDeletedAt`: set `listEndedAt` if unset; claim the run (kind `listEnd`; it needs no run in progress
  and no fresh hold, and if one is there the next sweep tries again within 15 minutes, while a run in progress
  stops at its next fence check because the list has ended; round 5: "a busy election waits for the next day's
  run" let the date slip); delete the election's list rows, drafts, `VotedUnmark` rows and leftover
  `VotedUploadDoor` rows; clear the samples of every upload of the election; settle any unsettled upload in place
  (§E's table; their marks stay with each campaign); set `listDeletedAt`; release. Elections are picked by date
  with `listDeletedAt` as the completion mark, so a crash midway is finished by the next pass. The daily job
  writes a `RetentionRun` like the retention triggers, clean only if no due election is left without
  `listDeletedAt` when it ends, and joins `REPEATABLE_JOBS`, where the retention health check watches it.
  [supportAccess.int.test.js](../server/test/supportAccess.int.test.js) asserts the check reports on exactly two
  jobs, so it becomes three. A new entry reads *has NEVER run* until its first clean run, so the deploy runs it
  once (§P). The banner turns red after 48 hours without a clean run.
- **Organization deletion:** add `OrgVotedUpload`, `OrgVotedElection`, `OrgVotedListId`, `VotedUnmark`,
  `VotedUploadDoor`, and the bucket's `files` (by `metadata.organizationId`) and their `chunks` (by `files_id`, including chunks whose
  `files` document was never written, by the upload ids of the organization's uploads) to
  [deleteOrganization.js](../server/src/services/platform/deleteOrganization.js)'s cascade. A running update makes
  the delete route answer busy (§E), the apply's `orgCascadeBegun` check after its list write covers a cascade
  that began first, and the sweep's orphan rule covers what a cascade racing a send or a crash leaves (above).
- **Campaign deletion:** its children, marks and `VotedUnmark` rows go with it, as now
  ([deleteCampaign.js](../server/src/services/campaigns/deleteCampaign.js)), and the cascade marks its shares
  `campaignDeleted`, so `isLiveShare` stops counting them. The jobs' per-campaign steps run inside `sweptAfter`
  (§E), and `VotedVoter`, `VotedUpload`, `VotedUploadDoor` and `VotedUnmark` join `LATE_WRITE_MODELS`
  ([lateWriteSweep.js](../server/src/services/platform/lateWriteSweep.js)), so a step that races a deletion
  leaves nothing behind. **`OrgVotedListId` must never join that list.** `sweepIfDeleting` runs
  `deleteMany({ campaignId })` on every model in it, `OrgVotedListId` has no `campaignId`, and the app's
  `strictQuery` drops a filter on an undeclared field. The filter becomes `{}`, so deleting any campaign would wipe
  every organization's kept list (round 2 confirmed the cast with the installed Mongoose). A campaign deletion
  leaves the organization's list as it is: it belongs to the election, and the 30-day job ends it.
- **Account deletion:** `uploadedBy` and `campaigns[].undoneBy` are User references, like `VotedUpload` and
  `DncUpload`. [deleteAccount.js](../server/src/services/users/deleteAccount.js) scrubs the User in place, so
  they read *Deleted user*. No name is ever copied into these records as text, and `VotedUnmark` records no one.
- **The demo reset:** seedDemoOrg.js's reset clears only campaign collections today (near line 907), and
  PLATFORM.md says the reset clears the early-vote layer; the reset gains the organization-level ones
  (`OrgVotedUpload`, `OrgVotedElection`, `OrgVotedListId`, the bucket) and the two new campaign-level ones
  (`VotedUnmark`, `VotedUploadDoor`), since seedDemoOrg.js clears a fixed list (near lines 907-909).

## L. Web

- **The page:** `client/src/pages/OrgEarlyVotingPage.jsx` at `/voters/early-voting`, linked from the Voters
  page beside Do-not-contact ([VotersPage.jsx](../client/src/pages/VotersPage.jsx), the `/voters/dnc` link).
  Org admins only, inside the same `RoleGate` as `/voters/dnc`.
- **Shared with the campaign page, never copied:** `IdColumnPicker`; `refusalView`, and `idListTooBig` /
  `idListTooBigText` ([lib/idListPreview.js](../client/src/lib/idListPreview.js), taking the cap); the tab note;
  the counting controls (`KeepRows`), lifted out of [EarlyVotingPage.jsx](../client/src/pages/EarlyVotingPage.jsx)
  into a component both pages render; and `historySubtitle`.
- **Before sending:** the first four bytes decide the format; `/check` through `api()`, then **Which rows
  count?** (*The screens*, 2), with the organization's last choice beside it (`GET /last-choice`), the warning
  when this one differs, and, from `GET /current`, the election's unsettled upload and running update, if any.
  **Send** stays off until a choice exists and no one else's upload for the election is unsettled.
- **Upload progress:** nothing in the client shows it today, because `api()` posts with `fetch`. A small
  `XMLHttpRequest` helper with `upload.onprogress` adds it, built into browsers, so no new library. It builds its
  headers from `getToken` and `getActiveOrgId` ([api/client.js](../client/src/api/client.js)), as
  [lib/downloadFile.js](../client/src/lib/downloadFile.js) already does for its own requests. `api()`'s error
  handling is inline today (api/client.js), so it's extracted into a function both use, and
  `PASSWORD_CHANGE_REQUIRED`, `ORG_CONTEXT`, `SUPPORT_ACCESS_REQUIRED` and an expired session behave as everywhere
  else. A 408 or a dropped connection reads *Sending stopped*. While it sends, a `beforeunload` prompt asks
  before the page closes, and leaving within the app asks too; the request is aborted on unmount or **Discard**.
- **Polling:** TanStack Query, `refetchInterval` 1,500 ms on `GET /:id/status` while the status is `receiving`,
  `matching`, `applying` or `undoing` (or a share is undoing, or the election's update is running), off once it
  settles, then one `GET /:id` for the preview. The page shows what the server says (*waiting*, *running*, or a
  failure state after the server's stale check) and offers each button only on the state that allows it. Each
  `queryFn` passes TanStack's `signal` to its request, so leaving the page cancels it (the campaign page's
  queries don't today: 41 of 255 `queryFn`s do).
- **Decision 6:** `localStorage`, keyed by organization and state, holds `{ idColumn, keepColumn,
  keepSelected }` (or *every row*), the column names only when the name rules found them (on a file with no
  header row, a picked column's name is a voter's value, and a staff member's browser would keep it after the
  grant ends, round 5), with every read and write wrapped in try/catch, and the page works the same
  without it. It's written when **Mark** is accepted (the 202), so an admin who leaves while marking runs isn't
  asked again tomorrow.
- **Default ticks:** the live shares of the last applied list for the election (`GET /summary`); the first
  time, all eligible campaigns.
- **The campaign page:** child rows read *Your organization's list* (the file's name for org admins), with *—*
  under *Not found*, and buttons by `shareState` (§J), including the admins' link to the organization page for a
  share not marked yet. Its undo handles a 200 (inline, as today) or a 202 (polling the history until the row
  reads undone). Its undo, upload and un-mark each show `election-busy`'s sentence, a lead's wording for a lead.
  A lead's child rows show the row counts without column names (§J).
  Above the file box, for org admins: *For a whole state's file … use your organization's Early Voting page →*.

## M. Privacy — this is privacy-affecting; say so

This affects what the privacy record says about **retention**, **access** and **exposure** for early-voting
lists. Per CLAUDE.md:

- **What we collect:** nothing new from the file. These are Voter IDs from a customer's early-voting file, as
  today. The value counts of the file's countable columns go back to the uploader's own screen and are never
  stored: item 45(a)'s rule, extended from one column to every countable one, never the ID column. H16(e) says
  the reader *discards every other column*; this route counts them for that screen, which the record's note must
  say. One new record about a voter: `VotedUnmark`, which says a voter's mark was taken off by hand in a
  campaign, and when: the voter's canonical ID, never who did it. It's written only where an organization list
  exists for the campaign's election, so no list older than the correction overrides it, and it's deleted with
  the campaign or the organization, or when that election's list ends. One internal record about doors:
  `VotedUploadDoor`, which households an upload's marks touched (no voter in it), kept only while a share is
  marking or being undone, and deleted at the list's end at the latest.
- **Retention:** new. The organization keeps the canonical Voter ID of every counted row, matched or not, once
  per organization, state and election day, until 30 days after the election (decision 3). Today's remembered
  IDs (`VotedPendingId`) have no end date. With a statewide file, that's most of the state's early voters,
  mostly people in none of the customer's campaigns. They're voting-participation identifiers of people
  otherwise absent from the customer's data, which is what the record's H16(e) paragraph already says of
  `VotedPendingId`. The draft lasts at most 24 hours unmarked; once marking starts, until the list is written (a
  marking that stops first goes back to unmarked, under the same 24 hours). The sample IDs last at most 24 hours
  after the upload settles, or 7 days after it stops partway, and never past the list's end. The list's end is
  00:00 on election day + 30 in the organization's time zone, the date the page shows.
- **Storage:** the kept IDs are written to MongoDB Atlas (GridFS, then `OrgVotedListId`) between upload and
  marking. The file itself is never stored and never written to disk. That is a privacy-record change for this
  route, as PERFORMANCE.md and PROPOSAL_PARKED_IDS §G already said storing the IDs would be, not item 45(b)
  extended.
- **Access:** org admins, and staff under a grant, logged, **except the status poll**, which is metadata only
  (status and counts) and is a fourth `AUDIT_EXEMPT` entry. The record says the only skips are *a 3-entry
  `AUDIT_EXEMPT` metadata allowlist* (PRIVACY_VERIFICATION.md, near lines 32 and 5669); both lines become *a
  4-entry `AUDIT_EXEMPT` metadata allowlist (the fourth, from the build's date: `GET /admin/voted-lists/:id/status`,
  status and counts only)*, which privacy.html's staff-access paragraph and DPA §4 allow just as they allow
  today's three. Every request must name its organization (§C). **A wider audience than item 45 describes:** items
  45(a) and 45(d) say the counted values, sample IDs and sheet names go *only to the person who uploaded the
  file*. On this route, `GET /:id` serves the stored samples (never column or sheet names, which aren't stored)
  to every org admin and to staff under a grant (logged), until they're cleared, which the record's new item must
  say. Leads see only their campaign's share: its numbers and the list's row counts, never a column's name,
  other campaigns, the organization's file name or its uploader.
- **Exposure:** new. Two downloads are now served from the server: the unmatched IDs
  (`GET /:id/unmatched.csv`) and the IDs matching other states' campaigns (`GET /:id/outside-state.csv`), each up
  to 10,000, to org admins and to staff under a grant (logged), until cleared. Today both are built in the browser
  from the preview's answer and nothing is stored. The record's B8 list of server-side CSV endpoints (*Exactly
  five*) gets the note: *two more server-side CSVs, `GET /admin/voted-lists/:id/unmatched.csv` and
  `…/outside-state.csv`: up to 10,000 Voter IDs each from an organization early-voting upload, the ones that
  matched no ticked campaign and the ones that matched other states' campaigns, until 24 hours after it settles
  (7 days after it stops); org admins and staff under a grant (logged, `voted`).* Per-campaign numbers go to org
  admins, who already see every campaign.
- **The browser:** decision 6's `localStorage` entry gets a privacy.html `:97` note like the record's existing
  local-storage entries: a column name and a few values from the admin's own file, on their own device.
- **Sharing:** no new third party. Heroku, Atlas and Heroku Key-Value Store as today. Job payloads carry ids
  only; jobs return counts or nothing; a failed job's message and stack, and the worker's log lines, carry no
  Voter ID (§E; Heroku's log keeps the latest 1,500 lines, and no log drain is recorded in the repo, G15). DPA
  §6 unchanged; **no customer notice**.
- **Published text:** no sentence becomes false. The reasoning rests on DPA §2 (using a feature is the
  customer's instruction) and on the deletion date shown on the page before **Mark**. DPA §9 makes the Policy
  the customer's retention instruction, and the Policy keeps customer information *as long as the related
  customer account is active, or as otherwise instructed* (`privacy.html:118`). privacy.html `:85`, `:91` and
  `:122` hold. A voter's request to remove one ID short of **Undo all** is a manual staff step (DPA §7).
- **Record updates when built:** a new item, plus dated notes on items 45(a), 45(b), 45(c), 45(d) (samples are
  now stored for a bounded time and seen by every org admin; the file's other column names and its sheet names
  are still never stored) and
  48(a); on H16(e)'s
  `VotedPendingId` paragraph and its *discards every other column* sentence; on B5's count of deleted
  collections, B6's list of timers and B8's CSV endpoints; on the two `AUDIT_EXEMPT` lines; and on row 1 of the
  subprocessor table (Atlas now holds the draft and the kept list). The new item's core wording: *"Kept: the
  canonical Voter ID of every counted row, matched or not, once per organization, state and election day
  (OrgVotedListId). With a statewide file that is most of the state's early voters, mostly people in none of the
  customer's campaigns. Used only to mark that upload's voters in the campaigns it went to (at Mark, Resume and
  Add campaigns, and voters imported later), and on an undo to keep marks a newer list still includes; no route,
  export or report returns it. Deleted at 00:00 on the 30th day after the election day in the organization's
  time zone (the date the page shows) by the retention sweep, by Undo all, by undoing the last share that still
  holds marks on that upload (from the organization page or a campaign's page, including by a team lead), and
  with the organization; not while another share still holds marks, nor by a campaign or account deletion; backups per privacy.html:122. The page
  shows the date before Mark (DPA §2). No published sentence changes; no customer notice."*
- **Live testing uses synthetic files only,** in an internal organization (these go unlogged, precisely because
  they hold no customer personal data). Never the Nebraska file or any real list.

## N. Docs and Help Center (the cascade)

- **Docs:**
  - [EARLY_VOTING.md](EARLY_VOTING.md): *Organization uploads* in Part 1, and a new Part 2 section; correct
    *so you upload per campaign* (Part 1, *Campaign-scoped and reversible*), the remembered-IDs paragraphs, the
    50 MB lines, the *Undo order* gotcha (newer organization lists keep marks; campaign-page lists don't), the
    *stays voted until both are undone* line, the undo steps in §B, what `/undo`'s `removed` counts once marks
    can move, the per-voter un-mark (now recorded where an organization list exists, and taking a hold), the
    `GET /` row (each row projected to fixed fields), the *Reversible* line (an undo can now keep marks a newer
    organization list holds, and a hand un-mark stands until the list ends),
    `reapplyVotedLists` skipping hand-unmarked voters, the busy message on the campaign page's upload, undo and
    un-mark, and the note that the organization path writes only changed doors while the campaign path rewrites
    every matched door;
  - [PLATFORM.md](PLATFORM.md): the demo reset now also clears the organization-level early-vote data;
  - [VOTERS.md](VOTERS.md): the organization's voter tools;
  - [CAMPAIGNS.md](CAMPAIGNS.md): the election day now decides which campaigns can be ticked; deleting a
    campaign leaves the organization's list; a running early-voting update makes a delete wait; the deletion
    list (near lines 1580-1586) gains `VotedUnmark` and `VotedUploadDoor`;
  - [IMPORTS.md](IMPORTS.md): imports now also mark voters from organization lists, by creation time, and record
    `orgGraduatedAt`;
  - [ROLES.md](ROLES.md): a lead can undo their campaign's share; the per-route permissions list gains
    `/admin/voted-lists`;
  - [TIMEZONES.md](TIMEZONES.md): the organization history's times, `stale`, and the 30-day date are civil-date
    uses;
  - [PERFORMANCE.md](PERFORMANCE.md): the streamed upload and its measurements;
  - [OPERATIONS.md](OPERATIONS.md): the queue, the election lock, the sweep, the daily deletion, the nightly
    pass, `bodyDeadline`, and the new `audit:voted-doors` check (§O);
  - [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): §M's item and notes;
  - [PROPOSAL_PARKED_IDS.md](PROPOSAL_PARKED_IDS.md): organization lists use §F's shape from the start, but
    credit by `createdAt`, not `uploadIds[0]`; campaign piles are unchanged.
- **Help Center:**
  - a new page guide, `pages/page-org-early-voting.md` (`audience: admin`);
  - `guides/early-voting.md`: a section, and its lines on uploading one campaign at a time, the 50 MB limit, what's
    remembered, un-marking a voter (it now stays un-marked), *Undo removes only the marks an upload made itself*
    (false in campaigns with an organization share), its *every upload can be undone* and *Undo anytime* lines
    (not once the list ends), and *Your last upload used SOSID* (a lead's hint reads only the campaign's own
    uploads);
  - `pages/page-early-voting.md`: the child rows, the queued campaign undo, the busy message, and its 50 MB line;
  - `pages/page-voters.md`: the new link among the organization's voter tools;
  - `guides/campaigns-manage.md`: a campaign's state and election day now decide whether it gets organization
    lists;
  - a new FAQ, *Can I upload one early-voting file for all my campaigns?* (`audience: admin`);
  - `faq/early-vote-list-not-matching.md`: a statewide file shows most IDs as in none of the campaigns, which is
    expected;
  - `faq/set-election-dates.md`: needed for organization uploads;
  - `faq/xls-file-wont-upload.md`: the size lines;
  - `faq/_INBOX.md`: the *too large* answer.

## O. Tests

- **The core scenario,** on a throwaway mongod with three campaigns in one state on one election (two ticked,
  one not), one in another state and one on another election:
  - only the ticked campaigns are marked, and outside-state and unticked are reported;
  - each ticked campaign's marks, counts and dropped doors equal the campaign page's upload of the same file to
    that campaign, on fixtures with no drift (the campaign path is the oracle);
  - a drifted door is repaired by the organization path too, and the preview's *Doors that will drop* equals the
    result;
  - `npm run audit:voted-doors` reads 0 on every check afterwards, including a new **Check D**: marks credited to
    an upload that is missing, undone, or a child of an undone share (today's Check C checks only that the voter
    exists, auditVotedDoors.js).
- **The election lock:**
  - the two-step claim gives one winner and a clean `election-busy` to every loser, with no E11000 reaching a
    caller, on a first-ever claim too;
  - a share undo while Add campaigns runs, two share undos, Undo all during a share undo, and a campaign page's own
    upload, undo or un-mark on the election during an organization run are each `election-busy`;
  - a failed run releases the lock and the next starts cleanly; a heartbeat whose write misses stops its job;
  - an enqueue that times out and lands later finds its run released and returns, and the upload is back as it
    was, with its `draftExpiresAt` never moved;
  - a lock left by a crash before its status change is expired by the sweep.
- **Hand un-marks:** a `VotedUnmark` row stands against graduation, the nightly pass, `reapplyVotedLists`, and an
  older upload's Resume or Add campaigns; a newer upload, organization or campaign, may mark the voter and leaves
  the row; a re-imported voter with a new `_id` is still recognised (canonical ID).
- **Graduation:**
  - an import into a ticked campaign marks a listed voter on its first attempt, and records `orgGraduatedAt`;
  - an import killed mid-write and then retried marks its first attempt's voters too (the time anchor);
  - not after the upload or that campaign's share is undone, or once the campaign's election day changes;
  - never in an unticked campaign; a voter with a `VotedUnmark` row only from an upload created after it;
  - an import racing the apply ends marked either way; one racing an undo leaves no mark on the undone share, and
    never deletes a mark the undo moved;
  - an import that never succeeds is covered by the nightly pass, run inside `sweptAfter`; a preview import is
    skipped;
  - graduation that creates a child before the apply reaches its share leaves the apply still writing that
    child's `affected` doors and `startFullyVoted`, and the doors drop; a take-back re-credits to a share that's
    live now before deleting.
- **Undo:**
  - whole, and one campaign's share; the list rows are `$pull`ed and the empty ones removed; undoing the last live
    share removes them too, ignoring deleted and skipped shares;
  - day 1 undone after day 2 leaves day 2's voters marked, counted on day 2's row, with `undoResult` right;
  - a retried undo after a newer list's share was undone between attempts re-opens every door it un-marked (round
    3's reproduction);
  - a failed share undo retries, by a lead too; a failed whole undo leaves every share it didn't finish
    `undoFailed`, never *undoing*;
  - `undoResult` is recounted from `movedFrom` after a crash between a move and its count, and never changes once
    the undo has completed;
  - a share whose campaign is archived after it was marked gets `stopReason` and keeps its Undo; a share skipped
    with no marks can be added again;
  - the campaign page's undo of a campaign upload in a campaign with an organization share goes through the queue,
    re-credits, and shows *undoing*;
  - after the list ends, Undo and Add campaigns are `list-ended`.
- **Status and jobs:**
  - a completed match, then **Match again**, runs again; a failed apply, then **Resume**, runs again (fresh job
    ids, `attempts: 1`); a stale run stops at the fence;
  - a run killed between the list write and the draft delete, and between the last share and the final status,
    each resumes into `applied`, never `applyFailed` with a missing draft;
  - apply twice, undo during apply, discard during apply, and discard of an `applyFailed` upload are each a 409;
    a second admin's upload for the same election is refused before the body is read; the same uploader's new send
    replaces their own `previewed` upload;
  - a `receiving` upload left by a killed web process is discarded after 2 minutes and doesn't block the next one;
    a queued or delayed job reads *waiting*; an unreachable Redis never expires anything;
  - an enqueue that fails rolls the status back with `QUEUE_UNAVAILABLE`.
- **Deletion:** `orgCascadeBegun` is false for a live organization; `deletingTenant` and `sweepIfDeleting` throw
  without a campaign; the demo reset clears the organization-level data; deleting a campaign leaves its own
  organization's and another organization's list rows intact, and marks its shares `campaignDeleted`; a campaign or organization delete during a run is refused as busy; a
  deletion that begins mid-step leaves nothing (`sweptAfter`); `sweepIfDeleting` with a campaign scope touches no
  `OrgVotedListId`; a requested-then-rolled-back organization deletion leaves the list intact.
- **Add campaigns:** marks from the kept list with no file; offered on the newest upload only; a failed add's
  shares read *Not marked yet* and **Try again** completes them.
- **Retention:** the list's end sets `listEndedAt`, takes the election's lock, settles stopped uploads in place
  and the daily job writes a `RetentionRun`; list rows gone at `listEndsAt`; drafts gone once the list is
  written, or after 24 hours unmarked, never while marking, and on each path round 4 found (a crash after the
  list write, a failed list step followed by an undo, a rolled-back Mark); an aborted send and a send at the size cap
  leave no chunks; orphaned chunks are swept; samples cleared 24 hours after settling or 7 days after a stop.
- **Permissions:**
  - a lead gets 403 on every org route;
  - a lead's child row carries the fixed field list: no file name, uploader, `orgUploadId` or other campaigns; a
    picked column name hidden; `shareState` and its buttons right; a lead's 409 names no person or campaign;
  - another organization gets 404;
  - staff with a grant are logged; without one they're refused; with no organization selected, 400 before the
    file is read;
  - [accessLogCoverage.int.test.js](../server/test/accessLogCoverage.int.test.js): the status poll exempt, the
    other routes logged; the status answer carries no column names.
- **Streaming:**
  - a 500 MB CSV through the route with flat memory, in a child process like `idListCsvPieces`' memory test, with
    the value counters' keys copied;
  - an upload taking longer than 5 minutes completes; another route's slow body gets a 408 at 5 minutes, and
    multer cleans up after it (`bodyDeadline`);
  - a file before its fields is refused; a remembered counting column unfit for the new file is refused (at
    `/check` when the first rows show it) and discarded; over 2,000,000 rows is refused;
  - `/check` with `truncated=1` on a CSV head cut inside a quoted multi-line cell reads the good rows; on a
    workbook; an `.xlsx` named `.csv` is read as a workbook; nothing stored;
  - 21 to 200 `campaignIds` arrive whole; 201 is refused;
  - an upload with 300,000 matched doors in one campaign records and resumes (`VotedUploadDoor`);
  - the CSV sink gives exactly `readIdList`'s IDs (the existing equivalence fixtures, run through the stream), and
    the runaway-row refusals hold through it.
- **Round 5's fixes:**
  - the first-ever claim stores `runSeq: 1` and a real `jobId`; a second claim leaves no field of the first run;
  - a redelivered job (a stall, a drained worker) re-claims its run with a new `attempt` and finishes it, and the
    first attempt, still running, stops at its next fence check;
  - two campaign pages' holds on one election both succeed; an organization claim fails while a fresh hold
    exists and succeeds once it's stale; a hold fails while a run is in progress; a campaign whose election day
    changed holds the old election too while its share there isn't finished; an inline undo keeps its hold to
    the end, so an Add campaigns started meanwhile is `election-busy`;
  - a hand un-mark stands against undoing a newer list (the mark isn't handed to an older one), against Add
    campaigns of an older list in a campaign that had no share when it was un-marked, and against graduation
    landing between its read and write; a list created after the un-mark marks the voter and leaves the row;
  - a run that stops while writing the list puts the upload back to `previewed` with no list rows left, and
    **Mark** works again; the late job of a rolled-back enqueue changes nothing;
  - a failed share undo keeps its **Try again** after another share's undo completes, and the upload stays
    unsettled until it's finished;
  - the list's end: refusals begin at `listEndsAt` before any job runs; a run in progress stops; a held lock is
    retried by the next sweep; samples are cleared; a stopped undo stays `undoFailed`, settled, and Check D
    accepts its marks; a campaign page's share undo after the end is `list-ended`, and `shareState` reads
    `ended`;
  - an organization deleted while a file is sending leaves no draft, no chunks, and no list rows once the sweep
    runs;
  - a forced duplicate-key error leaves no Voter ID in the log, `failedReason` or `stacktrace`;
  - a door recompute racing a walk-up add leaves the door open; an undo re-opens a moved voter's current door;
  - a share's door rows are gone once it's done, and once its undo completes;
  - an organization deletion clears every new collection and the bucket (orgDelete.int.test.js says a missing
    collection isn't caught otherwise);
  - a lead's child row has no column names; `/current` and `GET /` return no samples; the browser keeps a
    column name only when it was detected.
- **Health:** [supportAccess.int.test.js](../server/test/supportAccess.int.test.js) reports on three repeatable
  jobs; the 15-minute sweep writes no `RetentionRun`.
- **Client:** the page's logic in `lib/`, **Send** held until a choice exists and the election is free, the
  last-choice warning, the default ticks, `shareState`'s buttons, and the `localStorage` fallback.

## P. Ship gates (no calendar)

1. The owner's decisions: given 2026-10-31 (Part 1).
2. The design: *The screens* (Part 1) and §R.
3. Review rounds: 1 to 5 done (§S).
4. The build, the tests, and §C's measurements.
5. **`npm run migrate:build-indexes -- --apply`** before the page is used, because production `autoIndex` is
   off. New indexes: `OrgVotedElection`'s unique index; `OrgVotedListId`'s unique index and `{ uploadIds }`;
   `OrgVotedUpload`'s five, the `unsettled` one unique and partial; `VotedUpload`'s `{ orgUploadId, campaignId }`
   partial; `VotedUploadDoor`'s unique index; `VotedUnmark`'s unique index; `VotedVoter`'s sparse
   `movedFrom`; and **Voter's `{ campaignId, createdAt }`**, on the largest collection, so it's built at a
   quiet hour.
6. One server deploy (web and worker), with server.js's longer request timeout and `bodyDeadline`. The new
   queue runs on the existing worker. No phone release, no client-version bump, no config var. Run the daily
   list-deletion job once right after the deploy, so the retention banner doesn't read *has NEVER run*.
7. The live check in §C (throttled, synthetic, internal organization) before customers use it.
8. Decision 1: after Election Day.

## Q. Alternatives considered

- **Read the file in the browser and send only the IDs.** Kindest on privacy, and it would sidestep upload time
  entirely. But it means a second copy of the parsing rules in the browser (column detection, title rows,
  byte-order marks and encodings, the runaway-row guards, Excel), a new client library, and two ways in for one
  feature. Not recommended. The upload-time problem is answered by the longer timeout instead, and `/check`
  reads the file's start in the browser's place.
- **Send the file in parts** (several requests). Upload time stops mattering, but the parse would have to carry
  its state between requests (the dyno can restart between them) or store the parts, which is storing the file
  (decision 5). Not recommended.
- **Keep the whole file until apply, like a voter import** (the `rawImports` bucket). Changing what counts
  wouldn't re-send the file, but the full file would sit in the database for up to a day. That's decision 5's
  alternative.
- **Fence each kind of operation separately instead of one lock per election** (v3's way). Round 3 found the
  pairs that slipped through: share undos and Add campaigns cancelling each other, an undo settling the upload
  while a share still held marks, a newer list undone between an undo's attempts. One lock closes the class, at
  the cost of a busy message while another update runs.
- **Give each mark a set of uploads instead of one `uploadId`** (undo would remove an upload from the set, and
  delete the mark when the set is empty, with no re-credit). Cleaner in principle, but it changes `VotedVoter`
  for every campaign, with a data migration and every reader of `uploadId` updated, for a problem the lock and
  the re-credit already solve. Not recommended.
- **Run the campaign upload once per campaign.** It remembers unmatched IDs once per campaign (the pile
  problem, multiplied), and at statewide size it runs past Heroku's 30 seconds.
- **A Doorline-wide upload by staff across organizations.** No. The Privacy Policy limits staff access to one
  organization under a grant, and each customer controls its own lists.
- **Fetch lists from state websites.** Dropped by the owner on 2026-10-31.

## R. Components and state (the design, for the build)

**The page:** `OrgEarlyVotingPage.jsx`, lazy-loaded like `DoNotContactPage`, at `/voters/early-voting` inside
the same org-admin `RoleGate` as `/voters/dnc` ([App.jsx](../client/src/App.jsx)).

**State in the page:**

- `state`, `electionDay`: from `GET /options`. A state with one election picks it by itself; otherwise the
  soonest election not yet past is chosen.
- `ticked`: the ticked campaigns, defaulting to the last applied list's live shares (all eligible the first time).
- `file`; `format` (from the first four bytes); `check`, the `/check` answer; `send`, the upload in flight (its
  progress and its abort).
- `uploadId`: the upload being worked on, from `GET /current` on load, so leaving and coming back picks up where
  it was.
- `choice`: `{ idColumn, keep: { column, selected } | 'every-row' }`, seeded from `rememberedChoice(orgId, state)`;
  `null` the first time, which holds **Send**. Written back when **Mark** is accepted.
- `lastChoice`: the organization's last applied list's counting summary (`GET /last-choice`).
- `valueCounts`: from `/check` (the first rows), then from the upload's answer (the whole file), held in the page
  only.
- `ticks` for `KeepRows`: local until the choice is confirmed.

**Queries** (TanStack Query, each `queryFn` passing `signal`):

- `['voted-lists', 'options']`, `['voted-lists', 'summary', state, electionDay]`,
  `['voted-lists', 'last-choice', state, electionDay]` and `['voted-lists', 'current', state, electionDay]`;
- `['voted-lists', uploadId, 'status']`, with `refetchInterval: 1500` while work is in progress, stopped once it
  settles; then `['voted-lists', uploadId]`;
- `['voted-lists', 'history', state, electionDay]`, refreshed when an upload settles.

**Mutations:** `check`, `send` (aborted on unmount or **Discard**), `match`, `apply` (also **Resume**), `undo`
(whole, one share, or **Try the undo again**), `addCampaigns` (also **Try again**), `discard`.

**New pieces**, in `client/src/components/earlyVoting/` unless noted:

| Piece | What it is |
|---|---|
| `ElectionPicker.jsx` | The two selects. |
| `CampaignTickList.jsx` | The ticks with the summary columns, *No list in N days*, *not on your last list*, and the *Not on this ballot here* group with its reasons and the *Set it* link to the campaign's key dates. |
| `ListSender.jsx` | The file input, the format and first-rows lines, the last-choices line with **Change**, the organization's last-choice note and its warning, the election's unsettled-upload sentence, the progress bar, *Keep this page open until it's sent*, the leave prompt. |
| `WhichRowsCount.jsx` | The choice: *Every row*, or a column and its values, from `valueCounts`, labelled as the first rows' counts. |
| `UploadState.jsx` | What the server says: waiting, running with progress, busy, or a stop with its one allowed action (**Match again**, **Resume** or **Undo what was marked**, **Try the undo again**). |
| `OrgPreview.jsx` | The whole-file counts, the four totals, the per-campaign table, the two downloads, the not-ticked note with **Tick it and match again**, and **Change which rows count**. |
| `OrgHistory.jsx` | Uploads with their campaign lines, `undoResult` on undone shares, *Not marked yet* with **Try again**, **Undo** (with the confirm texts), **Discard** on the discardable ones, and **Add campaigns** (a dialog, on the newest upload only, hidden once the list has ended). |
| `lib/sendWithProgress.js` | An `XMLHttpRequest` wrapper: `{ promise, abort }`, a progress callback, headers from `getToken` and `getActiveOrgId`, error answers handed to the error handling extracted from `api()`, *Sending stopped* on a 408 or a dropped connection. |
| `lib/rememberedChoice.js` | `localStorage` read and write under one key per organization and state; every access in try/catch; `null` when storage isn't there. |

**Shared with the campaign page, moved where needed so both pages render one copy:**

- `KeepRows`: already exported from EarlyVotingPage.jsx; moves to `components/earlyVoting/KeepRows.jsx`.
- `IdColumnPicker` and `SheetNote`.
- `refusalView`, and `idListTooBig` / `idListTooBigText`, which now take the cap as an argument.
- `describeIdsInFile`, `keptLine`, `zeroMatchLine`, `historySubtitle`, `fileLine`.

**The campaign page:**

- A child row (`fromOrganization`) reads *Your organization's list* (or its file name, for org admins), with *—*
  under *Not found*, and its buttons by `shareState` (§J).
- Its undo handles a 200 or a 202 (polling the history until the row reads undone); its undo, upload and un-mark
  show a busy election's 409 (a lead's wording for a lead); a share not marked yet shows admins a link to the
  organization page.
- The hint above the file box shows to org admins only (`isOrgAdmin`, as VotersPage decides it).

**Look:** the campaign page's classes throughout:

- cards `rounded-lg border border-border bg-card p-5`, and the preview box in `bg-sunken`;
- labels `text-xs font-medium text-fg-muted`;
- the apply button `bg-brand-600`;
- warnings in `bg-warning-tint text-warning-fg`;
- the history header `bg-sunken text-xs uppercase`.

Status is always in words (*No list in 2 days*, *undone Nov 1 by …*, *Waiting for another early-voting upload*),
never color alone, and never an emoji or a symbol used as a marker.

## S. Review rounds: what each found and what changed

Each round, three reviewers read the plan cold, checked against the code with experiments on throwaway
databases, Redis and local servers, and every finding was verified before revising; a few the reviewers marked
unverified are marked so above.

### Round 5 (2026-11-01), on v5

Lenses: v5's new mechanisms against the code, with experiments on a throwaway mongod and Redis; data integrity
on v5's changes; and whether the plan keeps its promises on every path, with every section agreeing.

**What held.** The two-step claim is exclusive on first-ever documents too (200 rounds of 50). The enqueue
rollback decides cleanly in every order. 200 comma-separated campaign ids arrive whole, and `/check` with
`truncated=1` reads every complete row. `VotedUploadDoor`'s shape and the campaign sweep hold, and so does
`orgCascadeBegun` (all 17 call sites pass a campaign). Round 4's draft paths and the older list's Resume and Add
campaigns are closed. Phones call none of the routes. No published sentence becomes false once the error-text
fix is in, and there is no new third party.

**Blockers, fixed in v6:**

- **A hand un-mark could still be reversed**, two ways. A newer list deleted the voter's row when it marked them,
  and undoing that list handed the mark back to an older one. And a campaign with no share when the voter was
  un-marked wrote no row, so adding it to an older list marked the voter again. Now:
  - rows are written wherever an organization list exists;
  - marking never deletes them;
  - every path credits a mark only to an upload created after the un-mark (§B, §E, §F, §G).
- **The IDs could outlive the date the page shows.**
  - The list's end kept samples for 24 more hours.
  - A busy election waited a day.
  - The end had no hour or time zone.
  - An organization deleted mid-send left a draft that no rule reached.
  
  Now:
  - the end is 00:00 on election day + 30 in the organization's time zone;
  - refusals start at that moment, and the sweep finishes the end within 15 minutes;
  - samples are cleared;
  - orphan rules cover a deleted organization (§B, §C, §K).
- **An undo still ran from a campaign page after the list ended.** With no list left to re-credit by, it would
  have un-marked voters a newer list holds. Now every undo route refuses with `list-ended`, and `shareState`
  reads `ended` first (§F, §J).

**Majors, fixed in v6:**

- The claim's pipeline gave a first claim no `jobId`, and merged into the old run. Now `$ifNull`,
  `$mergeObjects`, and a claim by the election key (§E).
- A redelivered job couldn't claim its own `running` run, so a deploy mid-run left the election locked and then
  waiting for Resume. Now it re-claims with a fresh `attempt` and resumes (§E).
- The campaign page's lock had four problems:
  - it locked only the campaign's current election, though a share outlives an election-day change;
  - it released before inline undos;
  - it tested before locking;
  - with the fix as round 4 worded it, two campaign pages would have blocked each other.
  
  Now holds: shared among campaign pages, exclusive against organization runs, taken on every election with an
  unfinished share, and kept for the whole write (§E).
- A run that stopped before writing its list made Resume impossible. Now the upload goes back to `previewed`,
  and shares are live only once the list is written (§B, §E).
- A failed share undo was stranded when another share's undo settled the upload. Now only finished shares
  settle it (§B, §F).
- The list's end called a stopped undo `undone`. Now it settles uploads in place (§E).
- `VotedUploadDoor` kept every daily child's door lists until the campaign was deleted, and §M didn't mention it.
  Now it's pruned as each share finishes (§B, §K, §M).
- Column and sheet names were still served and swept in three places. Removed (§J, §K, §M).
- The error-handling precedent v5 cited logs and rethrows the original error. Now new generic errors, only
  `name` and `code` logged, and a test (§E, §M).
- Unlocked door recomputes could overwrite locked ones, a race in shipped code too. Now each write is
  conditional on `updatedAt` (§E).
- The un-mark rule's date was ambiguous (the child's or the organization upload's), and the row had no election.
  Now it's the organization upload's date, with `state` and `electionDay` on the row (§B).

**Minors folded in:**

- Children created by upsert. A skip and graduation are decided by one compare-and-set on `votedUploadId`, so a
  child with no marks gets `stopReason`. Graduation re-reads the campaign.
- `undoResult` is frozen when the undo completes, `movedFrom` only grows, and the count never goes below 0. Its
  one approximate case is named.
- The undo re-opens a moved voter's current door; shipped code read only the stored one.
- `orgCascadeBegun` is named, and `OrgVotedUpload` and `OrgVotedElection` stay out of `LATE_WRITE_MODELS`.
- `listEnded` joins the end reasons; the `matchFailed` 409 gets its sentence; the `recount` kind is added; every
  lock holder beats; `skipped` leaves `shareState`.
- `/current` and `GET /` get field lists. The browser keeps a column name only when it was detected, and leads
  see no column names.
- The draft's expiry is a compare-and-set before the delete. §N and §O are completed, and §P's leftover gate
  is gone.

**Checked, no change:**

- Whether Heroku overlaps worker processes in a deploy: still unverified. The `attempt` fence bounds an overlap
  to one batch.
- Whether a Heroku log drain exists: not recorded in the repo (G15). The error-text rule keeps IDs out of the log
  either way.

### Round 4 (2026-11-01), on v4

Lenses: v4's new mechanisms against the code; simplicity and consistency after the rewrite; and data integrity on
the lock.

**What held.** The lock is exclusive (one winner in each of 200 rounds of 50 concurrent claims), and it closes
round 3's problems: overlapping share undos, a list undone between attempts, a retried undo leaving doors
dropped, a draft expiring mid-marking, crashed imports' first-attempt voters. Matching from the kept list finds
exactly the voters the file's own spellings find, and the time anchor works.

**Blockers, fixed in v5:**

- **The uploaded IDs could outlive their promised date** on three paths (a crash after the list write, a failed
  list step followed by an undo, a rolled-back Mark), which would have made the page's deletion date false. Now
  every run, undo and discard deletes the draft, the sweep's rule covers every path, and the list-end job does
  too (§K).
- **A hand un-mark could be reversed by an older list**, through Resume or Add campaigns. Now only a list created
  after the un-mark overrides it, and `VotedUnmark` is keyed by canonical ID (§B, §E).

**Majors, fixed in v5:**

- The lock written as one upsert answers *taken* with E11000. Now two steps, with a computed job id (§E).
- An enqueue that times out can still land. Now the lock is released first, and the upload rolled back only if
  that wins (§E).
- More than 20 `campaignIds` broke the query string. Now one comma-separated value (§C).
- Three door lists on one document pass 16 MB near 285,000 doors. Now `VotedUploadDoor` (§B).
- The campaign page's own upload, undo and un-mark wrote marks beside an organization run. Now they take the lock
  in a campaign with a live share (§E, §F, §J).
- `skipped` could strand a share's marks. Now only a share with no child is skipped; a share with marks gets
  `stopReason` and keeps Undo (§B, §E).
- A failed whole undo left shares reading *undoing*. Now every failure path moves them to `undoFailed` (§F).
- A child's undo state lived in three places. Now on the share (§B).
- Stored column and sheet names served no feature. Now never stored (§B, §M).
- `VotedUnmark` stored who un-marked. Now only the voter, the campaign and the time (§B, §M).
- Graduation could need a child that didn't exist yet. Now it creates it, and the apply tests for the child's
  fields (§E, §G).
- The admins' **Try again** on a campaign page couldn't be built. Now a link to the organization page (§J).
- `deletingTenant` without a campaign reads every live organization as being deleted. Now `orgCascadeBegun`, and
  the helpers throw without a campaign (§E).
- The record's core sentence was left over from v3 (§M).

**Minors folded in:**

- The run's unread fields dropped, its kinds merged, `phase` rather than `state`, and never a `null` default.
- Heartbeat and release matched on `jobId` and `runSeq`; the processor claims `queued` → `running`.
- The stale sweep scans locks; the failed listener writes only its own run's upload and shares.
- Worker options pinned.
- `/check` with `truncated=1`, and no election answer there (`/current` does it).
- The 409 sentences per status; your own upload replaced while it's matching; the stale-matching row made
  consistent.
- `shareState` rows for `stopped`, `ended` and a done share on a stopped upload; `isLiveShare` false once the list
  ends.
- The busy wording for leads; projected campaign-upload rows; the child undo's 202 body.
- Column names stored only when detected.
- `undoResult` recounted from `movedFromUploadId`; doors recorded before each write.
- The take-back re-crediting first; the nightly pass inside `sweptAfter`, and its recount under the lock.
- The list-end job under the lock; the demo reset; the docs cascade; the undefined-filter explanation corrected.

**Checked, no change:**

- Whether a browser shows the early 409 before it finishes sending: unverified; the `/current` check makes it
  rare.
- Whether Heroku overlaps worker processes in a deploy: unverified; the fence bounds an overlap to one batch.
- No shipped code calls `deletingTenant` without a campaign (every caller passes one; `setCoordinator`'s crew
  holds are per campaign), so the trap was the plan's alone.

### Round 3 (2026-11-01), on v3

Lenses: v3's new mechanisms against the code; build-readiness (could a developer build it without guessing) with
a fix audit of round 2; and data integrity under overlapping, retried and crashed operations.

**The root cause, and the change.** Most findings came from one place: v3 let several operations work on one
election's marks at once (two share undos, Add campaigns, Undo all, a campaign-page undo, retries in between),
fenced them with a single job id per upload, and lost. v4 gives each election **one lock** that every
mark-writing operation takes and holds to the end, runs each job **once** (a retry is a new run), and **deletes
the uploaded IDs once the kept list is written**, so Resume and Add campaigns read the list (§E, §F, §H).

**Blockers, all fixed in v4:**

- **Share-level runs cancelled each other**, an undo could settle the upload while another share still held
  marks (stranding them with no button), and a failed Add campaigns had no state at all (§E's lock; §J's
  `shareState`).
- **The 24-hour draft expiry would have discarded an upload mid-marking**, orphaning its marks, and the 7-day
  resume window had no field (§K: the draft goes once the list is written; marking never expires).
- **A retried undo could leave a door dropped with someone un-marked** when a newer list was undone between
  attempts (reproduced). The doors to re-open are now saved before each batch of deletes and recomputed at the end
  of every run (§F).

**Majors, all fixed in v4:**

- A complete apply could end `applyFailed` with its draft gone. Now `attempts: 1`, the list is written once,
  `applied` is set last with nothing after it, and Resume reads the list (§E).
- Only upload writes can carry a job id. The fence and idempotency are now stated honestly (§E).
- The stale check read an unreachable Redis as "stopped" and ignored `delayed`. Now unknown never expires, and
  every live state counts (§E).
- The 409s arrived only after a 30-minute upload. Now the upload record and the election check come before the
  body, from the query string and `/check` (§C).
- Graduation's take-back could delete a moved mark; crashed imports' first-attempt voters were never marked; the
  window caught other imports; hand un-marks were re-marked. Now there's a time anchor on the job's `createdAt`
  with a new Voter index, `VotedUnmark`, and a take-back by `{ _id, uploadId }` (§G).
- A campaign upload's queued undo had no state. Now it has `undoState` and the lock (§F, §J).
- The child's derived state had no mapping and collided with `historySubtitle`'s `state`, and `undone` was
  missing. Now there's `shareState` and its table (§J).
- Stopped uploads blocked the election with a wrong 409 sentence. Now there's a sentence and a code per case, and
  `endReason` (*The screens*, §B, §J).
- `doorsDropped` disagreed with the preview. Now it uses `classify`'s `affected` (§E).
- The other-states download had no data. Now it's stored and served, with a B8 note (§D, §J, §M).
- Apply and Resume didn't re-check archived campaigns or a changed election day. Now shares are `skipped` with a
  reason (§E).
- Default ticks included undone shares. Now only live shares (§I).
- The wider audience for samples, and picked column names that could be a voter's value. Now recorded, and
  hidden from leads (§J, §M).
- A developer's guesses: `/current`, history statuses, `campaignIds` validation, every code and status,
  `/check`'s `idColumn`, cleared downloads, Match again's effect, the enqueue failure (§J).
- "Live share" had three definitions. Now one helper, with deleted and skipped shares excluded (§B).
- Writes landing after a deletion cascade's last sweep. Now `sweptAfter`, busy deletes, and `deletingTenant`
  instead of `requestedAt` for the list wipe (§E, §K).
- Count drift between graduation and runs. Now recounted from the data, plus a nightly recount (§E, §F, §G).

**Minors folded in:**

- `bodyDeadline` ends requests as Node does, is mounted before the webhook's raw body, and is lifted only after
  auth.
- A new write-only-changed option on `recomputeFullyVoted`, with `markedHouseholdIds` persisted for Resume.
- `/check` cuts the head at the parser's last complete row, and the browser picks the format from the first four
  bytes.
- `unsettled` never turns true again.
- The new retention job runs once at deploy.
- The retry count stated (`attempts: 1`).
- *Another early-voting upload*.
- The whole-file counts' lifetime said in the screens.
- The screen 6 count after a move.
- `api()`'s error handling extracted.
- No upload, undo or add after the list ends.
- `guides/early-voting.md`'s undo line.
- *None of its Voter IDs were kept*.
- `_removeFile` tolerating a missing draft.
- The failed listener matching the job id.
- The deploy overlap noted as unverified.

**Outside the plan, in shipped code:** a Voter Import upload cut off partway left its half-written file on the
web dyno until it restarted, though the privacy record (the v5 2026-08-04 entry) says such files are deleted on a
client abort too. Fixed 2026-11-01 (`middleware/tempUpload.js`, `test/tempUpload.test.js`); deploy pending.

### Round 2 (2026-11-01), on v2

**Blockers:** adding the kept list to `LATE_WRITE_MODELS` would have wiped every organization's list on any
campaign deletion; fixed job ids made every re-run a silent no-op (and colons are refused outright); states with
no exit (a send cut by a restart, a failed apply that could only be discarded, one `failed` status for three
phases).

**Majors:**

- The 2-minute heartbeat was shorter than single steps.
- The first-time choice cost two or three sends.
- Two admins could count rows differently.
- The nightly pass re-marked hand un-marks.
- Undo races.
- Counts after re-credit.
- Undo's promise was too broad.
- Samples were cleared only after apply.
- Column and sheet names were stored.
- The access-log exemption.
- The record's undo wording.
- The lead's field list.
- The server-wide request timeout.

### Round 1 (2026-10-31), on v1

**Blockers:** graduation read an always-empty `importJob.insertedVoterIds`; the `VotedUpload` partial index
written with `$exists`; no organization selected meant no scoping; a row that never ends (also true of the
shipped reader, fixed and deployed 2026-11-01); Node's 5-minute request timeout.

**Majors:**

- Undo stripped marks a newer list still held.
- Retries zeroed counts.
- No failure listener or heartbeat.
- Orphaned chunks.
- Stored value counts.
- Uncleared sample IDs.
- An unfit counting column.
- Deletion races.
- Leads saw the file name and every uploader's email (fixed, privacy item 49, deployed 2026-11-01).
- The upload helper's auth.
- Memory at 5M rows.
- The first day's unreturned ballots.
- Privacy-record coverage.
- The docs cascade.

### Noted, not changed

- An org-wide **Undo all** makes open phones in every campaign it touched pull a fresh bootstrap within about 30
  seconds (map.jsx's returning-door refetch). It's the same mechanism a campaign undo uses today, at more
  campaigns at once.
- `MAX_IMPORT_ROWS` counts rows before multi-voter rows are split, so a very large import's inserted-ID capture
  can approach the 16 MB document limit (importProcessor.js). This predates the plan, and v4's graduation no
  longer depends on that capture.
- The one-job-at-a-time queue serves every organization; revisit if two organizations' statewide applies
  collide.
