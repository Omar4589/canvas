# Proposal: One row per knock — a Canvassing activity export that adds up to your Knocks

> **Status: BUILT 2026-11-09 (uncommitted, not deployed) to plan v3 and the owner's decisions the same day
> (D1 no: the box is ticked every time; D2–D5 as recommended), after two plan review rounds (six
> reviewers). Two code review rounds follow the build; where the build differs from the plan, and what was
> verified, is in [§Q, "As built"](#q-as-built-2026-11-09).** Server, web and phone; one Heroku deploy,
> then one phone update (over the air, no store build). No migration, no config var, no new index (one
> existing index must be present in production; the release checks it). Line references are to HEAD
> `aed00e6`.

Related: [EXPORTS.md](EXPORTS.md) (the Canvassing activity export, its row options, the counting units),
[METRICS.md](METRICS.md) (*Knocks*, the overlap warning, the `knocksPipeline` invariant),
[CLIENT_PORTAL.md](CLIENT_PORTAL.md) (client reports and their outcome breakdown),
[CAMPAIGNS.md](CAMPAIGNS.md) (Door Outcomes and Unknock), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

# Part 1 — For everyone

## Why this exists

A client's Canvassing activity export, through November 8, had **4,707 rows**. The campaign's Home
page said **4,683 knocks**. We counted the file:

- **14 rows were surveys of a second person** at a door where someone else had already been surveyed in
  the same round. The file adds those because *Include survey answers* was ticked: one knock, two surveys.
- **10 rows were second entries** at doors that two canvassers both recorded in the same round. Eight of
  the ten were seconds or minutes apart: partners standing at the same door, both tapping it.
- What was left was **4,683 different doors-per-round: exactly the Knocks number.** (The one doubled door
  where both canvassers took a survey was the same person, so nothing was lost by keeping one.)

The dashboard was right. The file is a list of entries, and Knocks counts each door once per round. We
cleaned that file by hand. This option does it for you.

## What it does

On a campaign's **Exports** page, pick **Canvassing activity** and press **Queue export**. The options
dialog gets a new box at the top: **One row per knock**.

- **Each door appears once per round**, the way your Knocks count it. **With no outcome boxes ticked, the
  file's knocks match the Knocks on your Home page** for the same dates and walk list.
- **Two canvassers at one door in one round: one row**, showing the door's knock result for the round:
  **Surveyed** if anyone surveyed there (on a lit-drop campaign, **Lit dropped** if anyone dropped
  literature there), otherwise **the later visit**. It is the same rule your client reports use for their
  outcome breakdown. Restricted marks never count toward it.
- **That row is one canvasser's entry**: their name, time, GPS and note. The other canvasser's entry isn't
  in this file; it stays on the Overlaps page, and in the file without this option. **So don't total this
  file by canvasser**: a shared door would count for only one of them. For each canvasser's numbers, use
  the canvasser filter or the Home page's canvasser table, which credit both.
- **Restricted marks and Note added entries aren't knocks, so they're left out.** A knock's own note stays.
- **The file name includes -per-knock**, for example
  `…-canvass-activity-per-knock-with-surveys-2026-11-09.csv`. The date in the name is the day the file
  was built.

### Together with Include survey answers

- **Every survey still gets a row.** A second person surveyed at a door that's already listed can't share
  the door's row, so their survey is a row of its own, marked **Row source: survey**. In this file those
  rows come **after all the knock rows, at the end**. (With a canvasser picked, survey rows aren't added,
  as today: they would fill one person's file with other people's surveys.)
- **Doorline shows the split** (decision D3): **4,683 knocks + 14 more people surveyed**, in the phone's
  row count before you queue and on the export's history row.
- **When two canvassers surveyed different people at one door in the same round**, the door's row carries
  one of those surveys and the other person's survey becomes one of the rows at the end. So this file can
  have a few more of those rows than today's file has. With *Include survey answers* off, that second
  survey isn't in the file, as with any file that has no survey answers.

### The worked example

| | Rows |
|---|---|
| Canvassing activity today, with survey answers | 4,707 |
| Surveys of a second person (Row source: survey) | − 14 |
| Second entries at the 10 doors two canvassers both recorded | − 10 |
| **= Knocks on the Home page** | **4,683** |
| **With One row per knock and survey answers: 4,683 knocks + 14 more people surveyed** | **4,697** |

The bottom line holds here because the one doubled door where both canvassers took a survey was the same
person. Had they surveyed two different people, it would read 4,683 knocks + 15 more people surveyed.

### What it looks like

On the web, in the dialog **Queue export** opens for Canvassing activity:

```
Canvassing activity options
These change what the file is, so they are chosen here, on purpose, before anything is queued.
For: through Nov 8 · all walk lists · all rounds · all canvassers

[x] One row per knock
    Each door once per round, the way your Knocks count it: with no outcome boxes ticked, the
    knocks match the Knocks on your Home page for the same dates and walk list. Where two
    canvassers recorded the same door in a round, the file keeps one entry: the door's knock
    result (Surveyed if anyone surveyed there, otherwise the later visit), under that canvasser's
    name, so don't total this file by canvasser. Restricted marks and Note added entries aren't
    knocks, so they're left out; a knock's own note stays. The file name includes -per-knock.

DOOR OUTCOME
(Not home) (Wrong address) (Refused) (Surveyed) (Lit dropped) (No soliciting)
Leave these all unticked for every knock. Tick some and you get only the doors whose knock
result for the round is one of those: a door one canvasser marked Not home and another
surveyed is a Surveyed door.

[ ] One row per voter at the door  ...
[x] Include survey answers  ...

                                                      [ Cancel ]  [ Queue export ]
```

The history row then reads, in its Scope column, `through 2026-11-08 · one row per knock · survey
answers`, and under its row count, `4,683 knocks + 14 more people surveyed` with an (i): *Each of those
rows is another person surveyed at a door already listed: one knock, two surveys. They're at the end of
the file, marked Row source: survey.*

On the phone (Admin → More → Exports → Canvassing activity), the same switch sits above *Door outcome*, a
line under the outcome chips says they now pick door results, the row count reads `≈ 4,683 knocks + 14 more
people surveyed`, and the export's history line says *per knock*. On a very big campaign the row count
can say *not available*; you can still queue.

## The Door outcome boxes, with it on (decision D5)

Leave them all unticked for every knock. With One row per knock on, the boxes pick **door results**: tick
*Not home* and you get the doors whose knock result for the round was Not home. A door one canvasser
marked Not home and another surveyed is a Surveyed door, so it isn't in a Not home file. That makes a
better re-knock list than today's (which includes doors a partner surveyed), and ticking *Surveyed* gives
the same doors as your client report's Surveyed count. The **Restricted** and **Note added** boxes
disappear while the option is ticked, since those aren't knocks. With a canvasser picked, the boxes work
as they do today: a canvasser never has two entries at one door in a round.

## Matching your other numbers

- **The Home page.** Set the same dates on both: the Exports page opens on *All time*, the Home page on
  *Today*. If you picked a crew on the Home page, compare with *All coordinators* (the export has no crew
  filter). On *All time* with nothing picked, the Home page reads a running total Doorline re-checks every
  night; if it's ever a door off, pick *Custom* on the Home page from the campaign's first day through
  today, which forces a fresh count.
- **A client report for the whole campaign.** For its "doors knocked so far", leave *From* empty and set
  *To* to the report's last day; for its "+N this week", use the report's own dates. **A walk-list report**:
  the same, with that walk list picked. **A team's report can't be matched from this file**, because the
  export has no crew filter: read those numbers on the report, or on the Home page with that crew picked.
  A file built later can be a few doors higher: phones that were offline send their doors late, and a
  published report keeps the numbers it was built with until you press *Refresh numbers*.
- **A walk list or a round.** The file matches that walk list's Knocks, or that round's row in the
  **By pass** table.
- **A canvasser.** The file is that canvasser's own knocks, matching their **Doors** on the Timeline and
  the canvasser table. (A canvasser never has two entries at one door in a round, so here the option only
  leaves out their Restricted marks and notes.)
- **Do-not-contact.** A knock at the door of someone who asked not to be contacted stays, with the name
  blank, so the knocks still match. "Withheld" counts the blanked names and the survey rows left out.

## With your other choices

- **One row per voter at the door** (decision D2): each knock once, then each knock that named nobody
  repeated per registered voter, as that option does today. It is the per-voter file without doubled doors.
- **Full backup:** never uses it. The backup stays the complete record of every entry.

## What doesn't change

- **Unticked, the file is exactly today's.**
- **No number in the app moves.** Knocks, the By pass table, invoices and statements, each canvasser's
  counts and anything you pay from: this only changes what goes into a file. (One small fix rides along:
  on campaigns with very old entries, the phone's row-count preview for a file with survey answers could
  read a row too many; it now matches the file.)
- **Doubled doors stay visible** on the Overlaps page and the map, where you coach them. This option leaves
  them out of a file; it removes nothing from the record.
- **Team leads (your clients) get the option too**, as they get the rest of this export.
- **A phone that hasn't updated yet** has no switch, and its files are exactly today's.

## The owner's decisions (2026-11-09)

D1 went against the recommendation: **the box is ticked deliberately every time** (*"make it needed to be checked every time"*). D2–D5 as recommended.

| # | Question | Recommended | Decided |
|---|---|---|---|
| D1 | Once you've used One row per knock on a campaign, should it stay ticked next time? Today only *Include survey answers* is remembered; choices that change what a row is start fresh every time, so this would be the first exception. | Yes. | **No: unticked every time** (on the web, each time the options open; on the phone, each time the sheet opens). Include survey answers stays the only remembered option. On the web, One row per voter keeps its tick for the page visit, as it always has. |
| D2 | Should a client be able to get the one-row-per-voter file without the doubled doors (both boxes ticked)? | Yes. | **Yes.** |
| D3 | Show the split, **4,683 knocks + 14 more people surveyed**, in the phone's row count before you queue and on the export's history row (web and phone)? | Yes. | **Yes.** |
| D4 | Add a row count to the web dialog before you queue (the phone already has one)? | No: the history row gives the exact split once the file is built, and on a very big campaign each preview is a few seconds of database work. | **No.** (§O keeps the design if it is ever wanted.) |
| D5 | With One row per knock ticked, can you still pick outcomes (say, only Not home doors)? | Yes, by door result, as above. | **Yes.** |

# Part 2 — Technical reference

## A. What exists today (verified at `aed00e6`)

- **The file's query** is `canvassActivityQuery(ctx)`
  ([exportBuilders.js:153](../server/src/services/export/exportBuilders.js)): org and campaign, the
  `timestamp` window in the campaign's zone (`zonedDayRange`), `effortId`, `passId` (`'legacy'` → `null`),
  `coordinatorId`, the outcome chips as `actionType: {$in}`, and `userId` (+ `NOT_BULK`) or `excludeBulk`.
- **The builder** `buildCanvassActivity` (:424) streams `CanvassActivity.find(q).sort({timestamp:1})`
  (:495), merged by time with `SurveyResponse` when the answer layer adds rows, and per batch loads homes,
  voters, the fan roster, the joined answers (live) and **coverage** (the `survey_submitted` rows in `q`
  that name the batch's responses, live). It returns `{ files: [{ name, rows }] }` (:657).
- **The ledger is mutable.** `REPLACEABLE_ACTIONS`
  ([routes/mobile/canvass.js:227](../server/src/routes/mobile/canvass.js)) replace on `{userId,
  householdId, passId}` by delete-then-create (:531–536, :1112–1117), so two canvassers at one door in one
  round are two rows, and the same canvasser surveying a second person at a door replaces her entry with a
  new `_id`. Door Outcomes conversions change an entry in place (same `_id`: surveyConversion.js ~:562,
  ~:646; reclassifyOutcomes.js ~:452).
- **Knocks** are `knocksPipeline` ([aggregations.js:206](../server/src/services/reports/aggregations.js)):
  distinct `{householdId, passId}` over `KNOCK_ACTIONS`. `/campaign-rollup`
  ([reports.js:620](../server/src/routes/admin/reports.js)) and `/knocks-by-pass` use it; with no dates,
  walk list or crew, the rollup reads `Campaign.stats.knockCount` instead (:729–731; reconciled nightly).
- **The precedent for one result per door per round, over knocks only**, is the client report:
  [buildReportSnapshot.js](../server/src/services/reports/buildReportSnapshot.js) reads `KNOCK_ACTIONS`
  rows (:248), sorts them `{timestamp: 1, _id: 1}` (~:300) and resolves one outcome per (household, round)
  with `resolveStatus` (:358–361), whose strict `>` keeps the earlier row at an exact tie. Team reports add
  a crew clause and `NOT_BULK` (:244–247). The map and Doors by round use the per-round status, which lets a
  later Restricted mark win ([passStatus.js](../server/src/services/passes/passStatus.js)); the report and
  this file ignore Restricted.
- **The counts** `countCanvassActivityRows` (:242), `countUncoveredResponses` (:374) and
  `countActivityRowsWithLayer` (:419) serve as both the builder's progress denominator and the estimate
  ([exportEstimates.js:68](../server/src/services/export/exportEstimates.js)), which caps only the fan's
  pipeline (`maxTimeMS`, floor on timeout).
- **Both contexts carry the full campaign** (no projection): the worker
  ([exportProcessor.js:185](../server/src/services/export/exportProcessor.js)) and `/estimate`
  ([routes/admin/exports.js:84](../server/src/routes/admin/exports.js)). `Campaign.type` is a required enum.
- **Failure handling.** The export queue makes 3 attempts with exponential backoff from 5 s
  ([queues/index.js:46–48](../server/src/queues/index.js)), one job at a time (worker.js:31). Every failed
  attempt marks the job Failed (exportProcessor.js:286–296) — the web history stops polling a failed job and
  never refetches on focus (ExportsPage.jsx:344–347, client/src/main.jsx:24) — so any design that leans on a
  retry shows *Failed* even when the next attempt succeeds.
- **The real file (2026-11-09)**: 4,707 rows = 4,683 distinct `{Household DB id, Walk list, Pass}` among
  the knock rows (= the Home page) + 10 second entries + 14 `Row source: survey` rows. The ten pairs: six
  Not home + Not home, one Refused + Refused, one Not home then Surveyed, one Not home then Refused, one
  Surveyed + Surveyed of the **same** person; all ten by two different canvassers. The 14 were each a second
  person surveyed by the same canvasser at the same door, minutes apart.

## B. The option: `params.onePerKnock`

- **Registry** (`canvass-activity`, [exportTypes.js:201](../server/src/services/export/exportTypes.js)):
  `filters` gains the token `onePerKnock`. **The type's `desc` does not mention it**: `/types` serves `desc`
  to every phone, and a phone without the update would describe a switch it doesn't have. The checkbox and
  switch copy carry the explanation.
- **`validateParams`** (:226): `if (params.onePerKnock) out.onePerKnock = true;`. When it is on and
  `actionTypes` is set, every chip must be in `KNOCK_ACTIONS`, else `ExportUserError('One row per knock
  lists knocks only, so it can't include Restricted or Note added.')`. Both clients narrow the chips, so
  normal use never reaches it.
- **Frozen into `ExportJob.params`**, so the history is the record of which files were per knock.
- **The backup's notes and README** (exportTypes.js) add that the per-knock form, like the per-voter one, is
  an opt-in on a standalone export: the bundle's activity log is always every entry. The existing desc's
  "in a file named activity-log-by-voter" (:196) becomes "in a file whose name includes -by-voter".
- **Additive.** An old phone never sends it. An old server drops it silently (the whitelist returns known
  keys only), so the phone shows the switch only when the server's type list carries the token (§H).

## C. One owner for "which entry is the knock": `knockPlan(ctx)`

In exportBuilders.js beside `fanPlan` and `answerLayerPlan`: one function returns the stages every
per-knock consumer uses, so the knock rows, the counts and the withheld figure can't disagree.

```js
// The door's knock result for a round, as ONE stage list — the client report's rule
// (buildReportSnapshot.js: KNOCK_ACTIONS rows sorted {timestamp:1, _id:1}, resolveStatus per household
// and round). The campaign's completion action is sticky; otherwise the latest entry wins; at an exact
// tie the LOWER _id wins, as resolveStatus's strict `>` keeps the earlier row. As a $min composite:
// completion → 0, a later time → a smaller negative number, then the _id ascending. The group key is
// knocksPipeline's own, so the kept rows ARE the dashboard's Knocks — pinned by a test against
// buildKnocksByPassData rather than by sharing code, which keeps the billing pipeline untouched.
export const knockPlan = (ctx, { withRow = false } = {}) => {
  if (!ctx.params.onePerKnock) return { on: false };
  if (!ctx.campaign) throw new ExportUserError('This campaign no longer exists, so the file can’t be built.');
  const { actionType: _chips, ...scope } = canvassActivityQuery(ctx);
  const chips = ctx.params.actionTypes || [];
  const completion = completionFor(ctx.campaign.type).action; // 'survey_submitted' | 'lit_dropped' | null
  const group = (match) => [
    { $match: match },
    {
      $group: {
        _id: { householdId: '$householdId', passId: '$passId' },
        k: {
          $min: {
            c: completion ? { $cond: [{ $eq: ['$actionType', completion] }, 0, 1] } : 1,
            t: { $subtract: [0, { $toLong: '$timestamp' }] },
            id: '$_id',
            a: '$actionType',
            v: { $ifNull: ['$voterId', null] },
            ...(withRow ? { d: '$$ROOT' } : {}),
          },
        },
      },
    },
    ...(chips.length ? [{ $match: { 'k.a': { $in: chips } } }] : []),
  ];
  return {
    on: true,
    completion,
    stages: group({ ...scope, actionType: { $in: KNOCK_ACTIONS } }),
    // The coverage branch's input on a survey campaign (§E): only survey entries, the same group, so it
    // is equivalent by construction. Gated: wrong on a lit-drop campaign.
    surveyStages: completion === 'survey_submitted' ? group({ ...scope, actionType: completion }) : null,
  };
};
```

- **A composite accumulator** is the house idiom ([overlaps.js:129–133](../server/src/services/reports/overlaps.js)):
  BSON compares field by field in declared order, and `id` is unique, so `a`, `v` and `d` ride along and
  are never compared. `timestamp` is required on the model. Verified on MongoDB 7.0.2: completion stays
  sticky, otherwise the latest wins, an exact tie keeps the lowest `_id`, and `$ifNull` makes a missing
  `voterId` a present null. Against the client report's own way (each door-round's knock rows sorted
  `{timestamp: 1, _id: 1}`, then `resolveStatus`), a fuzz of 3,000 door-rounds per campaign type, 1,802 of
  them with exact ties, gave **0 mismatches** with this `$min` form (the `$max` form v2 used: 587 and 590).
  No measurable cost.
- **The chips run after the group**: dedupe over every knock in scope, then keep the doors whose result is
  ticked.
- **The group key** is `knocksPipeline`'s inner key verbatim, so a missing and a null `passId` stay apart
  exactly as they do there.

## D. The builder

1. **`fenceAt = new Date()`** when the build starts.
2. **The knock rows come from one aggregation**, with no kept-id set and no retry:
   `[...knockPlan(ctx, { withRow: true }).stages, { $replaceRoot: { newRoot: '$k.d' } }, { $sort: {
   timestamp: 1, _id: 1 } }]`, `.hint({ campaignId: 1 })`, `.allowDiskUse(true)`, streamed as a cursor. The
   `$group` is blocking, so the rows are fixed once it has read the ledger: a re-tap, an Unknock or a
   conversion after that moment doesn't change this file (the next file has it).
   - **Why the hint.** The read is not a snapshot: it yields as it goes. On `{campaignId: 1, timestamp: -1}`
     (which the planner picks for a dated window) a re-tap's new entry sorts *ahead* of the old one, so a
     re-tap mid-scan can delete the old entry before the scan reaches it and write the new one where the
     scan has already been: the door ends up in neither, silently. Round 2 reproduced it at 300,000 knocks
     (149,999 knock rows against 150,000 Knocks, before and after). `{campaignId: 1}` scans in the order
     entries were saved, and a replacement is always saved later, so the scan returns the old entry or the
     new one, never neither; with the hint every race matched Knocks. Cost: none on whole-campaign files;
     a small window on a big campaign reads the whole campaign (a 2,400-row window on 300,000 knocks: 21 ms
     → 190 ms).
   - **The index** is declared on the model (`campaignId`, `index: true`, CanvassActivity.js:69–73). A hint
     naming a missing index fails the query, so the release checks it exists in production first (§L).
   - **What's left:** if one of the very newest entries is re-tapped, its delete can land just before the
     scan reaches it and its insert just after the scan ends, a window as long as the route's gap between
     the two writes. Snapshot reads (`readConcern: 'snapshot'`) closed it too in round 2, but the int-test
     mongod is standalone (snapshot reads need a replica set) and they fail on a scan longer than 300 s.
3. **Write the knock rows first**, with today's fan, answer join, DNC blanking and counting, and orphan
   logic. While writing, collect `coveredKeys` = `respKey(storedVoterId, passId)` for every written
   `survey_submitted` row that stores a voter, DNC-blanked rows included (coverage uses the stored id, as
   today's coverage does).
4. **Then the survey rows, after all the knock rows**: `SurveyResponse.find({ ...activityResponseQuery(ctx),
   createdAt: { $not: { $gt: fenceAt } } }).sort({ submittedAt: 1 })`. Skip responses in `coveredKeys`;
   drop and count flagged voters as withheld; keep and count dangling voters as orphaned; write the rest as
   `Row source: survey` rows. Coverage is decided from the rows actually written, so a survey is never
   double-printed or lost against them, and the fence keeps out surveys saved after the build started (a
   new door surveyed mid-build would otherwise appear as a survey row for a door the file doesn't list).
5. **Unchanged:** the answer join (by each written row's stored voter and round, live), the fan (kept
   voter-less rows only), DNC blanking and counting per written row, orphan counting. Off, the builder is
   byte-for-byte today's (round 2: 192 of 192 combinations identical).
6. **Returns** `{ files: [{ name, rows }], surveyRows }`, with `surveyRows` the survey rows written **only
   when the option is on** (0 otherwise), so the job field means per-knock files only and `files[]` keeps
   its strict `{name, rows}` shape.

## E. The counts: one function, two passes (estimate == build)

`countActivityPerKnock(ctx, { maxTimeMS })` returns `{ rows, surveyRows, dncWithheld }`, with **rows =
knock rows + surveyRows**. It is the estimate when the option is on and the builder's progress denominator
(uncapped on the worker). Every quantity is computed once; each aggregation gets `.allowDiskUse(true)`.

- **Pass 1, the knocks** (`CanvassActivity.aggregate`): `[...stages, { $facet: { kept: [{ $count: 'n' }],
  flagged: [{ $match: { 'k.v': { $in: flagged } } }, { $count: 'n' }], named: …, fanned: … } }]`. `named`
  and `fanned` exist only with the per-voter fan: `named` counts kept rows that name a voter; `fanned` is
  today's `$unionWith` roster pipeline with its opening `$match`/`$group` replaced by `{ $match: { 'k.v':
  null } }, { $group: { _id: '$_id.householdId', k: { $sum: 1 }, r: { $sum: 0 } } }`. Knock rows = `kept`,
  or `named + fanned` with the fan. The do-not-contact `$in` stays a query-style `$match`.
- **Pass 2, the survey rows** (only when the answer layer adds rows; `SurveyResponse.aggregate`): the
  responses grouped by `{ v: '$voterId', p: { $ifNull: ['$passId', null] } }`, `$unionWith` the kept survey
  rows (`surveyStages` on a survey campaign, else `stages`, then `{ $match: { 'k.a': 'survey_submitted',
  'k.v': { $ne: null } } }, { $group: { _id: { v: '$k.v', p: { $ifNull: ['$_id.passId', null] } }, a: {
  $sum: 1 } } }` — the round is `_id.passId` after the group), regrouped, `{ $match: { a: 0 } }`, then `{
  $facet: { clean: [{ $match: { '_id.v': { $nin: flagged } } }, …sum], flagged: [{ $match: { '_id.v': {
  $in: flagged } } }, …sum] } }`. `surveyRows` = clean; the flagged sum joins `dncWithheld`.
- **One key fix, both paths.** The coverage key normalizes the round with `$ifNull` on both branches, in
  this function and in today's `countUncoveredResponses`: the builder's `respKey` already treats a missing
  and a null round alike, so today a legacy survey whose entry lacks the field while its response has `null`
  is counted as a row by the estimate but written as covered by the builder. Round 2: the repo's estimate
  disagreed with its own build in 16 of 192 combinations, all from that case; with the fix, 192 of 192
  agree, and files are unchanged.
- **Caps.** In the estimate both passes get `maxTimeMS` (`EXPORT_ESTIMATE_MAX_MS`, default 8,000 ms), so
  the worst case stays inside Heroku's 30-second router even though an aborted request doesn't stop a
  running aggregation. On a timeout the answer is `rowsUnavailable: true` with no number (a plain count is
  an upper bound for a per-knock file, not a floor).
- **Cost** (round 2, v2's two passes, 300,000 knocks on a constrained local mongod; read the ratios): per
  knock 1.6 s against 0.15 s today; with survey answers 2.7 s against 1.2 s; with answers and the fan 3.5 s
  against 1.8 s, all under the cap. The survey-only branch saves about 1.1 s. For scale, the client's
  campaign has under 5,000 knocks.
- **The option off** keeps today's estimate and floor exactly, apart from the key fix.
- **No hint on the counts.** A write during an estimate only moves the preview by a door, and the planner's
  own choice is faster for small windows.
- **The whole build** (round 2, 300,000 knocks, counting sink): per knock 11.3 s, with survey answers
  15.1 s, with answers and the fan 17.0 s, against 6.6 s for today's plain file; within a few percent of
  v2's kept-set design, with no set held on the worker.
- **The route** ([routes/admin/exports.js](../server/src/routes/admin/exports.js), `/estimate`) whitelists
  its response, so it gains `surveyRows` and `rowsUnavailable` there.

## F. Names, the job record, the history

- **`activityFileNames`** (:410): `activity-log` + `-per-knock` + `-by-voter` + `-with-surveys` (when the
  layer adds rows): eight distinct names; the download slug follows, then the build date.
- **`ExportJob`** ([models/ExportJob.js](../server/src/models/ExportJob.js)) gains `surveyRowCount: { type:
  Number, default: 0 }`, written by the processor from the builder's `surveyRows`
  ([exportProcessor.js:265](../server/src/services/export/exportProcessor.js)) and zeroed in the retry
  reset (:171–181). No index. The history list reads with `.lean()`, so old jobs read `undefined`; readers
  check `> 0`.
- **History, web and phone:** on a per-knock file, `N knocks + M more people surveyed` (N = rows − M)
  without the fan, `includes M more people surveyed` with it, only when M > 0. The phone's history line
  (`jobSub`, exports.jsx:226–237) also gains `per knock` whenever `params.onePerKnock`.
- **`scopeLabel`** (ExportsPage.jsx:186–207) writes a one-sided range as `through 2026-11-08` or `from
  2026-11-01` instead of a bare date, for every export type, and adds `one row per knock`.
- **A pre-existing log line** becomes a real one: on any failed build, `uploadDone` had no handler and the
  worker logged *unhandledRejection: Stream has been aborted* (worker.js:54). As built (code review round
  2), the catch logs `[export] job … upload failed`, and `csvWriter` refuses a stream that already failed,
  which ends a pre-existing hang.

## G. Web — [ExportsPage.jsx](../client/src/pages/ExportsPage.jsx), [exportOptions.js](../client/src/lib/exportOptions.js)

- `OPTION_TOKENS` (:120) gains `onePerKnock`. The local fallback `filters` (:43) gains `surveyAnswers`
  (missing today) and `onePerKnock`; the web only queues against the deploy that served it.
- **State:** `onePerKnock` starts `false` on every load and is never saved (D1: no). `exportOptions.js` is
  unchanged.
- **Dialog:** the checkbox first; under the subtitle a scope line, *For: {dates in words} · {walk list or
  all walk lists} · {round or all rounds} · {canvasser or all canvassers}*, named the way the pickers name
  them (`effortName`, `roundChoices`, `canvasserName`). The round matters because switching the card from
  another type keeps the round picked there (only a walk-list change resets it, :511, :533). While the box
  is ticked, `chipOutcomes` (:436) drops `restricted` and `note_added`; `paramsForCreate` already narrows
  `actionTypes` to the offered chips, so a chip ticked earlier rides nowhere and comes back when unticked.
  The outcome hint has three forms (§I).
- **Copy fixes in the same dialog:** the per-voter and survey-answer bodies' "the file is named
  activity-log-by-voter / -with-surveys" become "the file name includes -by-voter / -with-surveys" (:786,
  :808).
- **History:** the split line under the row count (§F) with the existing `InfoHint`; `scopeLabel` (§F).
- **No pre-queue row count** (D4 recommended no; design in §O if chosen).

## H. Phone — [ExportSheet.jsx](../mobile/components/ExportSheet.jsx), [lib/exportTypes.js](../mobile/lib/exportTypes.js), [exports.jsx](../mobile/app/(app)/admin/exports.jsx), [lib/cache.js](../mobile/lib/cache.js)

- **The token stays out of `EXPORT_TYPE_META`** (the local fallback): when `/types` fails the fallback is
  used (exports.jsx:110), and an old server would drop the param. The switch only shows where it works.
- **`outcomeChipsFor(meta, { onePerKnock, notTargetInUse })`** in lib/exportTypes.js (sibling imports with
  `.js`, as in queueCore.js) is the one narrowing rule: the sheet renders its chips and `paramsFor` (:82)
  sends `actionTypes` through it. Hidden chips stay in state, as on the web.
- **Order:** a new *One row per knock* block above *Door outcome*, a caption under the chips while it's on
  (§I, with a lit-drop form), then *Rows* (per voter) and *Survey answers*.
- **The campaign type** for the lit-drop copy comes from exports.jsx, which already holds the active
  campaign with its `type` (campaignSelection.js:20–26, exports.jsx:95–101), passed into ExportSheet.
- **`oneRowIs`** (:193): per knock alone, *one knock — each door once per round, the way your Knocks count
  it*; with per voter, *one knock, or one voter at a knock that named nobody — each door once per round*.
- **`estimateLine`** (:197): `≈ N knocks + M more people surveyed` (no fan), `≈ R rows · includes M more
  people surveyed` (fan), *Row count not available for this one — you can still queue* (`rowsUnavailable`).
- **Not remembered (D1), and an existing bug fixed.** The switch starts off on every open. exports.jsx:335
  saved `{ includeSurveyAnswers }` after a successful queue of *any* sheet, so queueing Doors by round, Survey
  results or Voter file reset the remembered survey-answers choice. A new `optionsToRemember(meta, params)`
  in lib/exportTypes.js returns `{ includeSurveyAnswers }` only for a type carrying that token, else `null`,
  and the screen saves only then. cache.js is unchanged (one campaign's record, as today).
- **History line** (`jobSub`): `per knock`, and the split (§F).

## I. Exact copy

| Where | Text |
|---|---|
| Web checkbox, title | One row per knock |
| Web checkbox, body (survey campaign) | Each door once per round, the way your Knocks count it: with no outcome boxes ticked, the knocks match the Knocks on your Home page for the same dates and walk list. Where two canvassers recorded the same door in a round, the file keeps one entry: the door's knock result (Surveyed if anyone surveyed there, otherwise the later visit), under that canvasser's name, so don't total this file by canvasser. Restricted marks and Note added entries aren't knocks, so they're left out; a knock's own note stays. The file name includes -per-knock. |
| Same, lit-drop campaign | …the door's knock result (Lit dropped if anyone dropped literature there, otherwise the later visit)… |
| Outcome hint, on, no canvasser | Leave these all unticked for every knock. Tick some and you get only the doors whose knock result for the round is one of those: a door one canvasser marked Not home and another surveyed is a Surveyed door. (Lit-drop: *…another dropped literature at is a Lit dropped door.*) |
| Outcome hint, on, canvasser picked | Tick the outcomes you want; nothing ticked means every knock. |
| Dialog scope line | For: {dates in words, one-sided ranges as *through* / *from*} · {walk list or all walk lists — left out when the round's name carries it} · {round or all rounds} · {canvasser or all canvassers} |
| Phone switch, label | One row per knock |
| Phone switch, sub (survey campaign) | Each door once per round, matching your Knocks when no outcome is ticked. Two canvassers at one door: one entry is kept, the door's result (Surveyed if anyone surveyed, otherwise the later visit), under one name, so don't total it by canvasser. Restricted marks and Note added entries are left out. |
| Same, lit-drop campaign | …the door's result (Lit dropped if anyone dropped literature, otherwise the later visit)… |
| Phone chip caption, on | These pick door results: each door is listed by its knock result for the round. |
| Row count (phone) | ≈ 4,683 knocks + 14 more people surveyed · with the fan: ≈ {rows} rows · includes 14 more people surveyed · timeout: Row count not available for this one — you can still queue |
| History (web and phone) | 4,683 knocks + 14 more people surveyed · web (i): *Each of those rows is another person surveyed at a door already listed: one knock, two surveys. They're at the end of the file, marked Row source: survey.* |
| Phone history line | … · per knock |
| Web Scope column | one row per knock; one-sided dates read *through 2026-11-08* / *from 2026-11-01* |
| Server refusal | One row per knock lists knocks only, so it can't include Restricted or Note added. |

## J. Tests

- **New `server/test/activityPerKnock.int.test.js`**, its own database, indexes built before the fixtures
  (`await Model.init()`, the 77fb703 lesson). Fixture: a survey campaign with every pair kind — the five seen
  in the real file (Not home + Not home, Refused + Refused, Not home then Surveyed, Not home then Refused,
  Surveyed + Surveyed of the same person), plus Surveyed then Not home (sticky), Surveyed + Surveyed of
  different people (one with the dropped person do-not-contact), two different results at the same
  millisecond — Restricted (field and desk) and Note added entries, desk-authored knock entries, a legacy
  door with one `passId: null` knock and one with no `passId` field, a legacy survey entry with no `passId`
  beside its response with `passId: null`, a flagged voter on a kept row, and a lit-drop campaign. Cases:
  1. Each pair kind yields one row, the expected one.
  2. Different people surveyed: with survey answers, the dropped entry's survey is a `Row source: survey`
     row at the end of the file; do-not-contact, it is withheld instead; without answers, one row.
  3. Restricted and Note added never appear; chips naming them with the option → 400.
  4. Chips pick door results: `[not_home]` leaves out doors whose result is Surveyed or Refused.
  5. Lit drop is sticky on the lit-drop campaign.
  6. Legacy knocks: the `null` door collapses to one row; the missing-and-null door is two rows, matching
     `buildKnocksByPassData`'s legacy row.
  7. A canvasser filter yields exactly that canvasser's own entries, `NOT_BULK` applied, matching their
     knocks on `/canvassers`.
  8. The fan repeats kept voter-less rows only.
  9. A kept row naming a flagged voter is blanked and counted once; a dropped one isn't counted;
     `dncWithheld` == `excludedDncCount`.
  10. **Reconciliation** against `buildKnocksByPassData`: `totals.knocks` for all time, two date ranges, a
      walk list; that round's `rounds[]` row for a pass and for legacy.
  11. **The tie and the report**: for every door-round, the kept row's outcome equals `resolveStatus` over
      that door-round's knock rows sorted `{timestamp: 1, _id: 1}`; the same-millisecond pair keeps the
      lower `_id`.
  12. **estimate == build** (rows, `dncWithheld`, `surveyRows`) across chips, fan, answers and canvasser
      combinations; the progress denominator equals rows written; survey rows all follow the knock rows.
  13. Timeout: a stub that fails only the two per-knock passes (`CanvassActivity.aggregate` with `$facet`,
      and `SurveyResponse.aggregate`) with a `MaxTimeMSExpired`-shaped error answers `rowsUnavailable`; the
      existing stub at exportBuilders.int.test.js:760 fails every aggregation and can't be reused.
  14. **Writes during a build**: a re-tap of a kept entry, a second person surveyed at a kept door, an
      Unknock and a conversion in place, each between knock batches, leave the file consistent (the door
      once, on its earlier entry; no survey printed twice or lost against the written rows); a survey
      created after `fenceAt` at a new door is not written; the job never reads Failed. And the knock
      aggregation runs with the `{campaignId: 1}` hint (its explain shows `IXSCAN campaignId_1`).
  15. The coverage key fix: the legacy survey with no `passId` is covered in both estimate and build, option
      on and off.
  16. The eight file names are distinct; the download slug follows.
  17. **The job record**: `surveyRowCount` equals the survey rows of a per-knock file, is 0 on a plain file
      with survey answers, and is zeroed by the retry reset.
- **exportBuilders.int.test.js:** the registry DNC sweep gains a `canvass-activity:perKnock` artifact
  (option, fan and answers on); the *estimates match filtered builds* table gains per-knock rows.
- **exports.int.test.js:** update the pinned canvass-activity filter list (:278–280, fails by design); the
  route refuses Restricted with the option; the params are frozen; `/estimate` returns `surveyRows` and
  `rowsUnavailable`; `files[]` keeps `{name, rows}` (:352).
- **Web:** `exportsPageRender.smoke.test.js` (the checkbox; hidden chips; the three hints; the scope line
  with a round carried from another type; the scope label and one-sided dates; the history split and its
  InfoHint; a render with a chip ticked, which the current smoke tests never do); `exportOptions.test.js`.
- **Phone:** `mobile/lib/exportTypes.test.js` (`outcomeChipsFor`; `paramsFor` narrowing;
  `optionsToRemember` is `null` for the other types; the fallback meta carries no `onePerKnock`).
- **Help links:** `helpLinks.test.js` (server unit suite) fails a lead article that links an admin one, so
  the new lead FAQ links only lead or all-audience articles.

## K. Docs and Help Center

- **EXPORTS.md.** Part 1: a new section *One row per knock (the Canvassing activity export)* after *Include
  survey answers*; the types table row; *Narrowing by outcome* (door results while on); *Counting units*;
  *Why an export can show fewer rows than a dashboard* (:304–320: on a per-knock file the withheld figure
  counts kept rows only); the answer layer's row-order statement (on a per-knock file the survey rows come
  after all the knock rows, not merged by time). Fix the sentences that say counting distinct **Activity DB id** values gives the
  knock count (:155, :185): it gives entries (door events); for Knocks, One row per knock or Doors by round.
  *Two canvassers who surveyed the same person … keep a row each* (:195) gains "unless One row per knock is
  ticked". The option counts (:455, :479, :872, :882) and *The one remembered option* (:940–946, for D1).
  Part 2: the token, `knockPlan`, the builder, the counts, the names, the job field, the frontends, the
  tests; the column-contract appendix's file names (:1097–1102).
- **METRICS.md:** the callouts *An export's visit columns are EVENTS* and *3 surveys but 1 knock* gain the
  per-knock sentence.
- **Help Center** (Part 1 is the source; phone-switch text says *on a phone with the latest update*):
  - guides/exports.md: *How it works* step 2 (:23–27) lists the new box; *three choices* (:33); the file
    names (:96, :121–122, as *includes*); the Activity DB id claim (:97); two canvassers, same person
    (:132); *the only export option that is* remembered (:140).
  - pages/page-exports.md: the option; the names (:46, :53); remembered (:55); the history paragraph
    (:69–77: the *one row per knock* scope word and the split); *follows all three* and the phone's row
    count (:89–95).
  - faq/survey-answers-in-my-export.md: the names (:22); the Activity DB id claim (:27); two canvassers,
    same person (:39).
  - faq/activity-export-one-row-per-voter.md: ticking both; the names (:28, :41).
  - faq/export-knocks-for-invoicing.md: its caution (:44–49) becomes "a plain activity file lists entries,
    finer than knocks; with One row per knock and no outcome boxes ticked, its knocks equal your Knocks for
    the same dates and walk list — still invoice from the By pass CSV, which carries Billable doors on
    campaigns that bill restricted homes."
  - faq/which-file-to-send-a-client.md: the per-knock file as the knock-level file whose knocks match your
    Knocks when no outcome boxes are ticked.
  - **New** faq/export-more-rows-than-knocks.md (audience `lead`): *Why does my Canvassing activity export
    have more rows than my Knocks?* — two canvassers at one door, Restricted and Note added entries, survey
    rows, one row per voter, and different dates, a crew, or a team report; then the fix. Links
    page-overlaps and which-file-to-send-a-client (both lead), never an admin article.
  - faq/_INBOX.md: a DONE triage line in the file's convention.
- **Phone and registry copy** that names files: ExportSheet.jsx:351–352 (per-voter switch), the registry
  desc (exportTypes.js:196), mobile/lib/exportTypes.js:16 (fallback desc).
- **The remembered-option lines** (*the only export option that is* remembered, *The one remembered
  option*, item 23(e), the code comments) stay true under D1 and are unchanged.
- **PRIVACY_VERIFICATION.md** item 57 (§L); **docs/README.md** gains this proposal's row.
- **Not touched:** the Home page's Knocks (i) text (three hand-synced copies); the new FAQ answers the
  question where people look for exports.

## L. Privacy, phones, release

- **Privacy.** Not privacy-affecting in substance: the file holds only what the plain file already holds (a
  subset of its entries; a few surveys get a row of their own instead of riding a dropped entry). Nothing is newly
  collected, kept, shown or shared; no new recipient; the audience is the same; privacy.html's
  do-not-contact sentence still holds. Recorded as item 57 in item 56's (a)–(f) shape, stating: the file
  loses rows only; `surveyRowCount` is a count with no personal data, kept with the job like `rowCount`; the
  do-not-contact withheld figure on a per-knock file counts kept rows only; the option is not remembered (no
  new browser or phone storage). No Privacy Policy, Terms or DPA text change.
- **Phones.** After committing, run from the repo root `npm run audit:mobile-api -- aed00e6` (with no ref
  it reads only uncommitted files and would report nothing). It flags routes/admin/exports.js (the phone
  calls `/admin/exports`, `/:id`, `/estimate`, `/types` and `/worker-status` there); exportTypes,
  exportBuilders, exportEstimates and exportProcessor list under *Could not resolve a mount — check them by
  hand*, and models/ExportJob.js isn't scanned. By hand: `/estimate` gains `surveyRows` and
  `rowsUnavailable` (sent only when a phone sends `onePerKnock`, which old phones never do); history jobs
  gain `surveyRowCount`. All additive: no `CLIENT_API_VERSION` bump.
- **Release.**
  0. In the Heroku dashboard, **More → Run console**: `npm run migrate:build-indexes` (a dry run that lists
     declared indexes missing from production; nothing is built). If it lists `canvassactivities` with
     `{ campaignId: 1 }`, run `npm run migrate:build-indexes -- --apply` before deploying, because the
     per-knock file names that index (§D). (Both commands are run from the repo root before hand-over.)
  1. One Heroku deploy from `main` (**Deploy → Manual deploy**; server, web and Help Center together). A
     deploy ships everything on `main` that isn't live yet, not only this change. That includes `aed00e6`
     (the billing renewals, hard deadline November 24, PROPOSAL_BILLING_CYCLES.md §I): if they aren't live
     and you want them out before this, deploy `main` before committing this change; either way, after the
     deploy that carries them, do their check (Close the month → the live check on October: nothing newly
     *Drifted*). After this deploy, run `npm run migrate:build-indexes` once more in the Run console: a
     commit on `main` that wasn't live yet can declare an index step 0 couldn't see (DemoRequest's expiry
     index, for one). If it lists anything, run `npm run migrate:build-indexes -- --apply` in a quiet moment.
  2. The phone, from `mobile/`, after the deploy. **First, what else the update carries:** a phone update
     publishes every phone change on `main`, not only this one. Since the last production update
     (`95a532e`, 2026-10-31) there is one other, the offline queue (`fd7bc5e`, *Saved-without-signal doors
     are never lost or misfiled*). If its update hasn't gone out, this one sends it, so its own gate comes
     first: the owner's two Privacy Policy edits (PRIVACY_VERIFICATION item 54) live before `ota:staging`,
     and production at 20% first (`npm run ota:production -- --rollout-percentage=20`, then everyone;
     OPERATIONS.md → *Release: saved-without-signal doors are never lost or misfiled*). Until then, hold this
     phone update: the web has the whole feature. Then: `git status --short .` prints nothing (an update
     bundles whatever is on disk); `npm run ota:staging`; check the sheet on a staging phone signed in to a
     test organization (staging talks to production); then `npm run ota:production` from `main`. JavaScript
     only, so the fingerprint is unchanged. Deploy first: the switch only appears once the server
     advertises it.
  3. No migration and no config var. No new index: the per-knock file uses the existing `{ campaignId: 1 }`
     index, which step 0 checks and builds only if production lacks it (the dry run prints
     `CanvassActivity (canvassactivities) — MISSING …` then `+ {"campaignId":1}`; `--apply` builds every
     index the list shows, not just this one). The new job field touches none of ExportJob's indexes.

## M. Edge cases and risks

- **A write during the build.** The knock rows are fixed once the knock aggregation has read the ledger, and
  surveys saved after the build started are fenced out, so a file is internally consistent. What a file
  shows when canvassers are working (round 2 ran each case):
  - a re-tap, or a second person surveyed, after the knock rows were gathered: the door once, with its
    earlier entry (that second person isn't in this file);
  - an Unknock of an entry already gathered: the file still has it (one more knock than the Home page reads
    afterwards);
  - a door first knocked during the build: in the file only if its entry was saved before the scan reached
    it;
  - a re-tap mid-scan: the old entry or the new one, thanks to the hint (§D), except the tiny window for
    the very newest entries.
  The next file is right in every case. Today's file has its own version of this: it streams live, so a
  re-tapped door shows whichever entry the stream reaches.
- **The fence compares two clocks.** `fenceAt` is the worker's time; `createdAt` is stamped by the dyno that
  saved the survey. A survey in flight across the build start, or a clock running behind, can still give a
  survey row at a door the file doesn't list. The time between `fenceAt` and the scan (the progress count:
  milliseconds at this client's size, about 3 s at 300,000 knocks) covers the ordinary gap, which is why
  `fenceAt` is taken before the count.
- **An exact-millisecond tie** keeps the lower `_id`, as the client report does; the map and Doors by round
  read a per-round status that has no `_id` tie-break and can pick either (pre-existing, `passStatus.js`;
  flagged to the owner, not changed here).
- **A legacy door with a null-round and a no-round survey entry for the same voter** is two knocks and two
  rows, and both rows carry that voter's one legacy response (as the plain file does); counts unaffected.
- **Restricted and a knock in one round:** in by its knock. The map and Doors by round may show that door as
  Restricted for the round; a *Not home* per-knock file still lists it if its knock was Not home.
- **Missing versus null round on knocks:** grouped apart, exactly like `knocksPipeline` (a legacy door with
  one of each is two knocks in both).
- **Desk conversions** (Door Outcomes → Surveyed) are `survey_submitted` entries and win like any survey.
- **Desk-authored knock entries** (`via: 'bulk'` on a knock action) are in at campaign scope, as in Knocks,
  and out under a canvasser filter, as in their Doors.
- **A survey row whose door isn't listed:** a response whose knock entry falls outside the file's dates (a
  desk conversion keeps the original knock time) is still written, as today.
- **`excludeBulk`** (no screen sends it) is an explicit opt-out and can read below Knocks.
- **The export's crew filter** (`coordinatorId` equality) differs from the Home page's (a team `$or` that
  folds in the lead's own work). No screen sends it, so it is outside the claim; team reports can't be
  matched (Part 1).

## N. Verification after the build

- Every suite through its runner: `npm --prefix server run test:int` (or `-- test/<file>`; never bare
  `node --test` for int suites), `npm --prefix server test` (unit, including helpLinks.test.js),
  `npm --prefix client test`, `npm run test:mobile`.
- Drive the real builder and estimate on a throwaway mongod with a fixture shaped like the real case and
  compare with `buildKnocksByPassData`.
- **After the deploy (owner):** on that campaign, queue Canvassing activity with *To: Nov 8*, One row per
  knock, Include survey answers and **no outcome boxes**. Expect its knocks to equal the Home page's Knocks
  for *Custom* through Nov 8, read at the same time (4,683 on 2026-11-09, or a few more if phones have
  synced Nov 8 doors since), plus 14 more people surveyed. Then compare it with the file cleaned by hand on
  2026-11-09 (put both on the Desktop and I'll compare them) as sets of rows, since the new file puts the
  survey rows at the end: the same rows, except where a door's latest knock that round was a No soliciting
  or other entry the earlier file never included.

## O. If D4 is yes: a row count in the web dialog

Canvassing activity only (Results by voter opens the same dialog and keeps none). `POST
/admin/exports/estimate` through react-query with the abort signal (`api()` honours it) and the existing
`useDebouncedValue` (about 400 ms), enabled only while the dialog is open. The request params are built
**after** `roundStatuses` and `chipOutcomes` are declared (:436–441): `paramsForCreate` reads both, and
calling it from a hook placed with the others throws once a chip is ticked. An estimate error never blocks
*Queue export* (the phone's rule). Same lines as the phone's row count.

## P. Review log

**Round 1 (2026-11-09), three reviewers.** The mechanism held: run against the real export code on a
throwaway MongoDB 7.0.2, the kept rows matched the dashboard's Knocks in every scope tried and the row count
matched the built file in every combination. What changed: the worked example's assumption checked on the
real file (the one Surveyed + Surveyed pair was the same person); the counts, 4–7 times slower than today,
became one function with two capped `$facet` passes; a mid-build guard for re-tapped doors; the promise made
conditional ("with no outcome boxes ticked", "knock rows"), with Home's defaults, crews, the nightly counter
and client reports covered; shared doors listed under one name; the precedent changed to the client report;
the phone's switch order, chip narrowing, server-only token and an existing remembered-option bug; D3 split,
D2 reworded, D5 added, D1's departure stated; the cascade (four sentences claiming distinct Activity DB ids
count knocks, the remembered-option lines, file names, option counts, the invoicing caution, the backup
notes); a pre-existing estimate/build mismatch on legacy surveys; the house commands; tests that would have
broken.

**Round 2 (2026-11-09), three reviewers.** Run on 1,440 combinations, the v2 counts held: estimate == build
for rows, the withheld figure and the survey rows; knock rows equal to `buildKnocksByPassData` in every
scope; files without the option byte-identical (192 of 192); previews 1.6–3.5 s at 300,000 knocks, under
the cap. What changed:

- **The mid-build guard is gone.** All three reviewers found it unworkable: the same canvasser surveying a
  second person at a door replaces her entry, so on a busy campaign it would trip constantly; each failed
  attempt marks the job Failed and the web stops polling it, so a successful retry never shows; and a
  conversion changes an entry in place, which it couldn't see, while its fixed coverage set then printed a
  survey twice. Now the knock rows come from one aggregation (consistent once it has read the ledger), the
  survey rows follow the knock rows with coverage taken from the rows actually written, and surveys saved
  after the build started are fenced out (§D).
- **The server reviewer then ran the v3 builder and the tie-break.** Estimate == build held across the
  same 1,440 combinations and at 300,000 knocks, and v3 writes the same rows as v2 (order aside). One
  catch: the single aggregation isn't a snapshot, and on the `{campaignId, timestamp}` index a re-tap
  mid-scan made a door vanish silently; pinning the scan to `{campaignId: 1}` (saved order) fixed every
  race tried, at no cost on whole-campaign files, so the release now checks that index exists (§D, §L).
- **The tie-break** now keeps the lower `_id`: 0 mismatches against the client report's outcome over 3,000
  door-rounds per campaign type with 1,802 ties, against about 590 for v2's rule (§C).
- **The split** reads "4,683 knocks + 14 more people surveyed" (14 survey rows read as a survey count), and
  is recorded only for per-knock files.
- **Team reports** can't be matched from this file and Part 1 says so; walk-list reports need the walk list
  picked.
- **The dialog's scope line** names the round (a round picked on another type carries over), and one-sided
  dates read *through* / *from* in the history.
- **The phone** says *per knock* in its history, remembers per campaign (not just the last one), takes the
  lit-drop wording from the campaign it already holds, and the type description no longer mentions the
  switch (old phones would show it).
- **Copy:** "the file name includes -per-knock" (and -by-voter, -with-surveys), the date is the build day;
  the partner's entry (note, GPS, time) isn't in the file; "Note added entries"; with a canvasser picked no
  survey rows are added; the phone's count can say *not available*; the invoicing and which-file FAQs carry
  the no-outcome-boxes condition; more cascade lines (§K).
- **Precision:** the coverage branch reads `_id.passId` after the group (as written in v2 it would have
  made every survey legacy); the survey-only branch is the same stages fed survey entries, gated to survey
  campaigns; rows = knock rows + survey rows; `allowDiskUse` on every per-knock aggregation; 3 attempts, not
  3 retries; the audit needs a ref after committing; the acceptance check compares with the Home page read
  at the same time.
- **Owner-facing, outside this plan:** the billing renewals in `aed00e6` have a hard deadline of November
  24; if they aren't live, deploy them on their own now.

## Q. As built (2026-11-09)

Built to plan v3 with the owner's decisions. Where the build differs, or names things differently:

- **D1 is no.** The web checkbox and the phone switch start unticked on every open and are never saved.
  On the web that takes an explicit reset: the page keeps its state between exports and across a campaign
  switch (it doesn't remount), so Queue export clears the box each time it opens the options;
  `exportOptions.js` and the phone's cache are unchanged. The phone still gets the remembered-option fix:
  `optionsToRemember(meta, params)` returns `{ includeSurveyAnswers }` only for a type carrying that token,
  so queueing Doors by round, Survey results or Voter file no longer resets it. No per-campaign phone map
  (it existed only for D1).
- **Names.** The phone's chip rule is `outcomeKeysFor(meta, keys, …)` (§H said `outcomeChipsFor`); the
  builder's knock rows are `knockRowsAggregate(ctx)`, exported so a test can `explain()` the hint; the web
  split wording lives in `client/src/lib/exportSplit.js`, hand-mirrored as `knockSplitLine` in
  `mobile/lib/exportTypes.js`.
- **The survey cursor opens lazily** on the per-knock path (only once the knock rows are written), so it
  can't sit idle and time out through a long build.
- **The phone block** is labelled *Knocks*, above *Door outcome*.

Verified before review: `npm --prefix server run test:int` for the three export suites (the new
activityPerKnock.int with 14 cases, exportBuilders.int 30/30 with the per-knock DNC sweep artifact and
parity rows, exports.int 18/18), `npm --prefix client test` (all pass, with the new
perKnockExportsRender.smoke and exportSplit tests), `npm run test:mobile` (451/451).

**Code review round 1 (2026-11-09), three reviewers.** No blocker or major in the server or the docs. The
server reviewer ran the REAL modules on a throwaway MongoDB 7.0.2: plain files byte-identical to HEAD over
455 option combinations (the estimate differing only in the legacy missing-vs-null case the `$ifNull` fix
targets); per-knock estimate == build over about 1,350 combinations; knock rows == `buildKnocksByPassData`
in 257 scopes; the kept entry == the client report's rule in 192,668 door-rounds (15,777 exact ties);
writes during builds (re-taps, second surveys, Unknock, conversions, new doors, response edits) never
printed a survey twice or lost one; on a 250,000-entry ledger with 8–16 writers re-tapping during the scan,
the hinted builder missed 0, 0, 0 and 1 door-rounds (the one miss inside the documented tail window), the
same stages on `{campaignId, timestamp}` 472–2,395. What changed:

- **Web (the one major):** the render test could not fail when the box stopped resetting or the option
  stopped reaching the POST (proven by mutation). A FLOW test now mounts the real page and drives the
  owner's steps (`perKnockExportsFlow.smoke.test.js`); it fails on both, and on the next fix.
- **A campaign switch kept the walk list, round and canvasser** (pre-existing; a stale canvasser quietly
  emptied the next file): cleared on switch. Queue export also clears the last attempt's error.
- **The phone's row count** is labelled by the params each answer was counted for (`asked`), not by
  switches that moved since; the line and the history bits moved into `mobile/lib/exportTypes.js`
  (`estimateLineFor`, `perKnockJobBits`) with tests, and a parity test holds the web and phone wording in
  step. New helpers are arrow functions; the four switches have accessibility labels; row counts carry
  thousands separators; the (i) opens inward; the per-voter text drops "restricted" while per knock is on;
  the dialog says *through*/*from* like the history.
- **A missing `{campaignId: 1}` index** now fails once with the reason (an `ExportUserError`) instead of
  three generic retries; the test preload rebuilds it after drops.
- **Docs:** the conditional ("no outcome boxes ticked") added where three promises lacked it; item 57 and
  the docs index say the file "holds only what the plain file holds" (a few surveys get a row of their own);
  §L step 3 names the right index; two rare edges documented (the exact-tie disagreement with the per-round
  status, pre-existing in `passStatus.js` and flagged to the owner; a legacy null-and-missing pair joining
  one response twice).

**Code review round 2 (2026-11-09), three reviewers.** No blocker or major in the feature. The server
reviewer re-ran the REAL modules: tenant isolation held over 108 combinations with a second organization
and 8,192 deliberately mis-scoped entries; estimate == build over 455 fresh per-knock combinations; the kept
entry == the client report's rule in 61,985 door-rounds (5,316 ties); plain files byte-identical to HEAD
over 180 combinations; a 343,000-entry campaign built in 13.7 s at 78 MB of heap. What changed:

- **A pre-existing hang, now fixed:** a GridFS chunk insert failing between batches destroyed the upload,
  and the next write never resolved, so the export hung and held the worker's single export slot. Round
  1's quiet `uploadDone.catch` had removed its only log trace. `csvWriter` now refuses a failed stream and
  the catch logs (`exportCsv.test.js` pins it).
- **The web page:** a campaign change (Back and Forward included) now closes an open options dialog and also
  clears the import and saved search, during render rather than an effect a commit late; the For: line
  leaves out the walk list when the picked round's name carries it; the flow test gained the walk list,
  the failed-queue error and the dialog close, each guard checked by deleting its line.
- **Hardening:** the model's `{campaignId: 1}` declaration carries a do-not-drop comment and a test; the
  per-knock aggregations pin their ids with `oid()`.
- **Release:** a deploy ships everything unreleased on `main`, so step 1 runs the index dry run again after
  it and covers the billing renewals' check; the phone step waits on the offline-queue update's own gate
  (its Privacy Policy edits, its 20% rollout) if that update hasn't gone out; OPERATIONS.md has the
  release section.
- **Copy:** Note added entries (not notes) in two FAQs; the docs index's promise carries its condition; on
  the web One row per voter keeps its tick for the page visit (only One row per knock was ruled on).

**Verified on the final tree (2026-11-09):** `npm --prefix server run test:int` — all 201 suites passed
(activityPerKnock.int 16/16, exportBuilders.int 30/30, exports.int 18/18 among them); `npm --prefix server
test` 787/787; `npm --prefix client test` 1,264/1,264; `npm run test:mobile` 453/453; `npm run
migrate:build-indexes` from the repo root runs as handed over (dry run against the local dev database:
nothing built). Not verified here: production's indexes (step 0 of §L checks them) and a real phone (the
staging check in step 2).
