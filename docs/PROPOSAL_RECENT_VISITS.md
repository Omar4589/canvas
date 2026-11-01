# Proposal: Leave out doors visited recently — "Visited in the last N days" on Exclude doors

> **Status: DEPLOYED 2026-10-31 (`95a532e`), built to plan v5 and the owner's decisions; the owner tested it
> on the live site the same day. Where
> the build differs from the plan is in [§O, "As built"](#o-as-built-2026-10-31) at the end, with what was
> verified and what was not.** The owner's decisions are in *The owner's decisions* (end of Part 1); the
> short check of the two pieces added after round 3 (the **Use them again** line and the question Generate
> asks) is folded in (§M). Three review rounds, nine reviewers, then the short check: three ran the
> plan's server logic against the real app on throwaway databases (and the repo's own test suites against
> those copies), three walked or modelled the web page, one checked every claim, the docs and privacy, one
> wrote a pre-mortem, and one audited the plan for coverage and contradictions. What each round changed is
> in §K–§M. One Heroku deploy (server and web together); nothing ships to phones; no migration, no new
> index, no config var. Line references are to HEAD `d429239`.

Related: [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (*Targeted follow-up rounds*), [PASSES.md](PASSES.md)
(activating a pass), [WALKLISTS.md](WALKLISTS.md) (the filter model, §A–§B),
[TIMEZONES.md](TIMEZONES.md) (what "a day" is), [DATE_FILTERS.md](DATE_FILTERS.md) (the dashboards'
**7 days** button this matches), [EXPORTS.md](EXPORTS.md) (gap G1).

# Part 1 — For everyone

## What it does

On **Turf Cutting**, the **Exclude doors** panel gets one more line:

**Visited in the last [7] days — since [Oct 25]**

Tick it, and every door a canvasser visited since that date (from midnight that day, the campaign's
time) is left out of the cut. Type a number of days or pick a date from the calendar; the other one
follows. The page always shows the date, so there is never any doubt about what "7 days" meant.

What it is for:

- **Starting the next round while the last one is finishing.** Cut the whole walk list, minus anything
  knocked this week. Cut close to when you activate (see *When doors are checked*).
- **Re-trying not-homes, but giving them a rest.** Target *Not home*, and leave out the ones knocked in
  the last 3 days.
- **Spacing out visits** when a client asks you not to knock the same door again too soon.

It works with **Target doors** or on its own. On its own it means *the whole walk list, except the
doors visited recently*.

## Where it lives

```
 Exclude doors · on                                                 ▾
┌────────────────────────────────────────────────────────────────────┐
│ Doors matching ANY of these are removed from the cut — even when   │
│ they match the target above. e.g. skip supporters who already took │
│ a yard sign.                                                       │
│                                                                    │
│ Status:  ☐ Unknocked  ☐ Not home  ☐ Surveyed  ☐ Refused  …         │
│                                                                    │
│ ☑ Visited in the last [  7 ] days — since [ 10/25/2026 ]           │
│   Any result a canvasser recorded at the door, in any round.       │
│   Notes and desk marks don't count. Dates follow the campaign's    │
│   time zone (CDT).                                                 │
│                                                                    │
│ Survey answers:  [ + Add a question ]                              │
│                                                                    │
│ 1,240 doors removed from this cut, 1,100 of them visited since     │
│ Oct 25                                                             │
└────────────────────────────────────────────────────────────────────┘

 3,410 doors in this cut · 1,240 removed by Exclude doors (1,100
 visited since Oct 25) · 12 restricted left out → ~53 books
```

With only Exclude doors in use, the count line says **doors in this cut** and the Target doors header
no longer says "on". With Target doors ticks it says **targeted doors**, as today.

Clicking a faded house says why, and when it was last visited:

```
 1234 Elm St
 ─────────────────────────────────────────────
 TARGET DOORS · ALL ROUNDS
 ● Not home · last visit Oct 27
 Faded: visited since Oct 25 (Exclude doors).
```

While the line is ticked, that status line shows the door's **last visit** (desk marks left out), or
**never visited**. The rest of the time it shows **last recorded**, as today. Apartment buildings show
the reason for each unit (today they show none). A door that matches both the visit line and another
Exclude condition is labelled as visited.

## What counts as a visit

**Counts:**

- Any result a canvasser recorded in the app: Not home, Surveyed, Refused, Lit dropped, Restricted, No
  soliciting, Wrong address, Not a target voter.
- In **any round and any walk list of this campaign**, including the round you are cutting. A door
  moved from one walk list to another keeps its history.
- An entry an admin later corrected on **Door Outcomes**. It keeps the canvasser's original time, so it
  counts on the day of the knock.
- **Paper results typed into the app later** count on the day they were typed, because that is the
  time the app records.

**Doesn't count:**

- **Notes.**
- **Desk marks**: a home or a book marked restricted by an admin or team lead, on the web or the phone.
  Nobody visited; those doors are already handled by **Exclude restricted-access homes**.
- Entries taken out with **Unknock**, or cleared when a round's books were discarded with their knocks.
- **Paper days nobody typed in.** Doorline has no record that anyone went.
- **Other campaigns.** Two campaigns never share doors (the Help Center FAQ *Can two of our campaigns
  target the same voters?*), so another campaign's knocks at the same address never count.

## How the days work

- **The campaign's day, in the campaign's time zone**, the same for every admin wherever they sit.
- **"Last 7 days" is today plus the 6 days before it**, exactly like the dashboards' **7 days** button.
  On Saturday, Oct 31 that is *since Sunday, Oct 25*.
- **"Since" includes that whole day, from midnight.** A knock at 12:05 AM on Oct 25 is left out; one at
  11:55 PM on Oct 24 stays in.

## When doors are checked

- **When you click Generate.** The books hold the doors that passed at that moment.
- **Again whenever you click Add as new book**, against the same date.
- **Books already cut are not re-checked.** If the last round is still being knocked, a door knocked
  after you cut stays in the new books. So cut (or re-generate the draft books) close to when you
  activate. This is how every Target doors and Exclude doors condition already works: a door targeted
  as Not home that gets surveyed after the cut stays in its book too. (No check at Activate in this
  build: the owner's decision 2.)

## Coming back to a round

The round remembers the conditions it was last cut with, but today the two panels come back empty
after a reload, and generating again (say, to change the book size) quietly drops every condition, the
visit date included. The owner chose to have the page **ask** (2026-10-31):

- **The panels open as they do today**: empty after a reload, and keeping what you ticked when you
  switch rounds.
- **Whenever the round was last cut with conditions that differ from the panels**, a line above them
  says so — *This round was last cut with Not home, leaving out doors visited since Oct 25.* — with
  **Use them again**, which puts those conditions back in the panels and opens them, so you see the
  count before cutting. The line stays as a reminder while you change things, and hides while a cut is
  running.
- **The first time you click Generate on a round in that situation**, it asks:

  ```
   Use this round's last conditions?
   ─────────────────────────────────────────────────────────────
   This round was last cut with Not home, leaving out doors
   visited since Oct 25.
   Target doors and Exclude doors are empty now.

   Use them again puts them back so you can check the count;
   nothing is cut yet.

           [ Cancel ]  [ Cut without them ]  [ Use them again ]
  ```

  When the panels hold other conditions, the box names them (*Ticked now: Not home.*) and the middle
  button says **Cut with what's ticked now**. Survey answers are named by their survey words
  (*Support: Undecided*), so two different answers never read the same, and the box says **any of these**
  or **all of these** wherever that changes the result.
- **Once you've answered it** (or used **Use them again**) on a round, it doesn't ask again there unless
  the round's last conditions change — for instance when you restore an earlier cut. So deliberately
  cutting with new conditions costs one extra click per visit to a round, and rebuilding only part of the
  last cut (ticking Not home but forgetting the visit line) is always caught.
- **Generate waits until the page has loaded the round** (*Loading this round's conditions…*), so nothing
  can be cut before the page knows what the round was cut with.

## After the cut: the round remembers the date

- The round stores the **date** (Oct 25), not "7 days", so **Add as new book** later in the round leaves
  out the same doors. A brand-new door, with no visits, still flows in.
- One line over the books says so: *Add as new book leaves out doors visited since Oct 25, like this
  round's cut.* On a view-only round: *This round was cut leaving out doors visited since Oct 25.*
- To let doors back in, cut a new round with a new date.

## Also fixed along the way

Each of these is wrong today, and the feature depends on getting them right:

- **Accept no longer leaves the map stuck in the target colors.** Today, conditions ticked before Accept
  keep the now-live round's map in the all-rounds view, with fading, until a reload.
- **The round's remembered conditions follow its books.** A cut that fails before it saves anything no
  longer changes them, and **restoring an earlier cut** from a snapshot brings back that cut's
  conditions. Today Add as new book can apply the wrong round's conditions after a restore.
- **Generate waits for the round to load** (above).

## What doesn't change

- **Phones.** Nothing to install, nothing over the air.
- The Map page, coverage, reports, billing, Door Outcomes.
- The three boxes above Generate (restricted-access, no-soliciting, no reliable map spot).
- Rounds with accepted books are never re-cut by any of this.
- **Saved searches** don't get the line in this build. You didn't ask for it there, and a saved
  search's **Filtered voters** export in the Export Center re-checks its conditions on the day you
  export, so it could quietly differ from the saved list. Say if you want it, and we plan that properly.

## Gaps the reviews found that already exist today

Each one exists today, separate from this feature. Pick which to fix:

- **G1. A saved search built from an uploaded file (or a "New voters" list from an import) exports the
  whole campaign** from the Export Center's **Filtered voters**. These lists keep no conditions to
  re-check, so the export hands over every voter in the campaign. A reviewer reproduced it with the real
  code: a one-voter list exported all 7 voters of a test campaign. After the fix, the export holds the
  same people as the list's own **Download CSV** on the Saved Searches page, minus do-not-contact. **In
  this build.** This is about an export, so it also corrects our privacy record, which says exports hold
  "saved-search subsets". **Worth checking now:** if anyone sent a Filtered voters file of an uploaded or
  "New voters" list to a client or a vendor, that file held every voter in the campaign.
- **G2. Drawn-area and attribute-group counts ignore Target doors, Exclude doors and the restricted /
  no-soliciting boxes**, so an area's or group's count can be higher than the books it becomes. Fixing it
  makes those counts roughly twice as slow on big walk lists. **Reviewed after this build.** *[2026-10-31: the
  owner reviewed it: after Election Day.]*
- **G3. Two cut refusals retry three times** (about 15 seconds) before the page shows them: a broken
  Exclude condition, and "no doors inside the drawn areas". **In this build** (two lines).
- **G4. The saved-search builder says door statuses use each door's "current status".** Since the
  October 13 rule they read the door's whole history, like Target doors. **In this build** (the words).
- **G5. A phone with a wrong clock records wrong visit times**, which then read wrong here and in every
  report. **Reviewed after this build.** *[2026-10-31: the owner reviewed it: a read-only check first,
  [PROPOSAL_PHONE_CLOCKS.md](PROPOSAL_PHONE_CLOCKS.md).]*
- **G6. Switching campaigns on Turf Cutting keeps the previous campaign's round selected**, so the page
  shows an empty map until you pick a round. **In this build** (small).

## The owner's decisions (2026-10-31)

1. **Coming back to a round:** the page **asks** (above). The fill-in-automatically option is not built.
2. **A check at Activate:** **none in this build**; cut close to when you activate. The design stays in
   §N.
3. **What counts as a visit:** **as listed above.**
4. **Today's gaps:** **G1, G3, G4 and G6 in this build; G2 and G5 reviewed after everything.**

# Part 2 — Technical reference

## A. What exists today (verified)

Verified by reading, and where marked *run*, by running it: the server reviewers drove the real app
(`createApp`, `generateTurf`, `addSupplementalBooks`, snapshots, claims, the export processor, a real
BullMQ worker) on throwaway databases with the plan's changes in scratch copies, and ran 18 of the
repo's suites against those copies (all green with the v3 fixes).

- **The filter model.** `resolveWalkList(campaign, filter, { effortId })`
  ([resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js)): `collectPredicateSets`
  (72–164) makes one household set per predicate; include sets combine by `combine` (default `and`, 246);
  `filter.exclude` resolves through the same function, OR'd and subtracted (262–274). An exclude-only
  filter is active (`isActiveTargetFilter`, 48–59; a non-empty string reads active, `''` and `null` do
  not). An empty walk list returns early (202–213).
- **Cut refusals.** A fully failed exclusion sets `excludeDegenerate`; `generateTurf` refuses (251) with a
  plain `Error`, as does manual mode's "no doors inside the drawn area(s)" (311); the turf queue retries
  a plain `Error` 3 times from 5 s ([queues/index.js:46–51](../server/src/queues/index.js#L46-L51); *run*:
  about 15 s before the page shows it) — gap G3. The late archive check after the insert already throws
  `UnrecoverableError` (406–410).
- **The round's stored filter.** `Pass.targetFilter` is `Mixed` ([Pass.js:39](../server/src/models/Pass.js#L39));
  rounds created before 2026-06-10 lack the field. `generateTurf` writes it at line 274, before the cut
  can still fail (311, 383, and the late check at 406–410 after `wipeDraftBooks` at 387 and
  `insertMany` at 388) — *run*: a failed manual cut leaves the old drafts under a new stored filter.
  Every cut book stores the full generation `params`, including `targetFilter` when one was sent
  ([generateTurf.js:341–354](../server/src/services/turf/generateTurf.js#L341-L354)); supplemental books
  store `{ supplemental: true, maxDoors }` (498); books made by move-doors store `params: {}`
  ([turfs.js:1871](../server/src/routes/admin/turfs.js#L1871)). Snapshots keep each book's name, mode,
  `params`, geometry, doors and status ([snapshot.js:48–64](../server/src/services/turf/snapshot.js#L48-L64)),
  but `restoreSnapshot` never touches `Pass.targetFilter` — *run*: restoring an untargeted cut leaves a
  later cut's visit filter in place. The city-suffix repair rewrites `Pass.targetFilter` but not book
  `params` ([repairCitySuffix.js:197–198](../server/src/migrations/repairCitySuffix.js#L197-L198)).
- **Its readers.** `GET /turfs?passId=` loads it (803–806) and re-resolves it for the bookless count
  (845–851) on every Turf Cutting load, every Passes page pass detail
  ([PassManager.jsx:147–151](../client/src/components/PassManager.jsx#L147-L151), same cache key
  `['turfs', c, pass]` as Turf Cutting, without `slim`), and every load of the phone's admin Books screen
  ([books.jsx:203](../mobile/app/(app)/admin/books.jsx#L203)), which reads only `turfs`. For another
  campaign's pass it answers 200 with no books. `addSupplementalBooks` re-resolves it (450–452).
- **The page.** The panels are `useState` with an empty start
  ([TurfsPage.jsx:1666](../client/src/pages/TurfsPage.jsx#L1666)), never filled from a stored filter, and
  survive round and campaign switches. `setExcludeSide` (1975–1980) sets the whole Exclude side to `null`
  when its statuses and answers are empty. `targetActive` (1685) has no `publishedCount` check and drives
  `targetView` (1693) while the panels render only when `publishedCount === 0` (3515, 3590); neither the
  round-switch reset (3165–3183) nor Accept (2422–2428) clears the filter, so today the target view sticks
  on a newly live round. Generate is enabled while `GET /turfs` is loading (`canGenerate`, 3219–3220;
  `publishedCount` reads 0 while `turfs` is empty) and sends the filter only when `targetActive` (2408).
  A finished cut refreshes only `['turfs', …]` and `['turf-doors', …]` (2369–2375); window-focus refetch is
  off ([main.jsx:25](../client/src/main.jsx#L25)). React Query's `isFetchedAfterMount` resets on every
  key switch and also turns true after a failed fetch (query-core `queryObserver`, line 328). The campaign
  switcher navigates to `/campaigns/<id>/<same page>` ([CampaignSwitcher.jsx:45](../client/src/components/campaigns/CampaignSwitcher.jsx#L45))
  and the page is not re-mounted ([App.jsx:170](../client/src/App.jsx#L170)), while `passId` is read from
  the URL once ([TurfsPage.jsx:1613](../client/src/pages/TurfsPage.jsx#L1613)) — gap G6.
- **Building pop-ups.** The per-unit "… across all rounds · reason" line exists only for separate homes
  (1477–1485); an apartment building's **Units** list (1550–1593) shows none. Units carry `targetStatus`
  row by row when `withTarget=1`.
- **History reads.** [targetingStatus.js](../server/src/services/walklist/targetingStatus.js) reads door
  history in chunks of 10,000 ids, hinted to `{ householdId: 1, timestamp: -1 }`
  ([CanvassActivity.js:166](../server/src/models/CanvassActivity.js#L166); in the schema since the first
  commit) with a fallback when the hint fails. The integration tests' index preload
  ([testIndexPreload.mjs](../server/scripts/testIndexPreload.mjs)) builds only indexes hinted WITHOUT a
  fallback; this one is not among them — *run*: a fallback-less hint on it 500s the house pop-up route and
  fails five suites.
- **Who writes visit times.** The phone freezes `timestamp` at the tap
  ([recordAction.js:421](../mobile/lib/recordAction.js#L421)); the server keeps it unclamped
  ([canvass.js:460](../server/src/routes/mobile/canvass.js#L460)) — gap G5. "Latest wins" is a
  delete-then-create per canvasser × door × round (canvass.js:525). Desk rows are exactly
  `{ actionType: 'restricted', via: 'bulk' }`, already named `NOT_DESK_MARK` when excluded
  ([aggregations.js:47](../server/src/services/reports/aggregations.js#L47)). *Run*: reclassify and survey
  conversion keep `timestamp`; Unknock and Discard-with-knocks delete rows (turfs.js:548); snapshot and
  unknock restores re-insert the originals; no migration rewrites `timestamp`.
- **Days.** *Run*: `zonedDayRange(day, null, tz).$gte` gives 2026-10-25 in `America/Chicago` → `05:00Z`
  and 2026-11-02 (after DST ends) → `06:00Z`; midnight exactly counts. Client
  `shiftDays(todayInTz(tz), -6)` = `2026-10-25` = `rangeFor('7d')`. Campaign zones are editable
  ([campaigns.js:697](../server/src/routes/admin/campaigns.js#L697)); the page's zone is
  `campaign.timeZone || org zone` (1604).
- **Exports.** The Export Center's **Filtered voters** re-resolves a saved search's stored filter live
  ([exportTypes.js:404–419](../server/src/services/export/exportTypes.js#L404-L419);
  [exportBuilders.js:1569–1570](../server/src/services/export/exportBuilders.js#L1569-L1570);
  [exportEstimates.js:192–195](../server/src/services/export/exportEstimates.js#L192-L195)). Uploaded and
  import lists store `filter: {}` ([walklists.js:216](../server/src/routes/admin/walklists.js#L216);
  [collectRevisitHomes.js:77](../server/src/services/import/collectRevisitHomes.js#L77)), so their export
  resolves the whole campaign — *run* on unmodified code — gap G1. The Saved Searches page's **Download
  CSV** uses the frozen `voterIds` with live do-not-contact ([walklists.js:298–316](../server/src/routes/admin/walklists.js#L298-L316)):
  for an uploaded list, everyone at the matched homes that have a map spot; for an import list, only the
  new voters. Both exports are `adminOnly: false` (exportTypes.js:367, 399).
- **Drawn areas and attribute groups.** `POST /turfs/manual-preview` (973) and
  `GET /turfs/attribute-preview` (1142) count with the knockable filter and the map-spot box only;
  manual-preview's voter count has no do-not-contact filter (999) — gap G2.
- **Phones.** `npm run audit:mobile-api -- --list`: the phone calls `GET /turfs?passId=`,
  `GET /turfs/household/:id` and `GET /passes`, never target-preview, generate, manual-preview,
  add-supplemental, activate, move-doors or `/walklists`; no phone code reads `targetFilter`.

## B. The data shape and what it means

- New key **`exclude.visitedSince: 'YYYY-MM-DD'`**, a civil date read in the campaign's zone:
  `campaign.timeZone || org.timeZone || 'America/New_York'`, the same order the page uses (the org is read
  only when the campaign has no zone).
- **Meaning:** the door has at least one VISIT row in this campaign with
  `timestamp >= zonedDayRange(visitedSince, null, zone).$gte`, where
  `VISIT_ROW_MATCH = { ...STATUS_ROW_MATCH, ...NOT_DESK_MARK }` (no notes, no desk marks).
- **"No line"** is `undefined`, `null` or `''`, on every route and in the resolver, through one shared
  reader. *Run*: all three return 200 with a response identical to the key being absent. The page deletes
  the key when the line is unticked.
- **No upper bound.** "Since" runs through now, so a re-resolution later also removes doors visited after
  the cut, the live round's own knocks included. "Since" is safe under latest-wins (a door's newest tap is
  never earlier than one it replaced); a date range would not be (§K).
- **Stored as the date, never a day count.** Add as new book must apply the cut's date; a recount would
  sweep rested doors back in (they keep the old round's `turfId`, so the bookless count would not even show
  them).
- **Read in the campaign's current zone.** Editing a campaign's time zone moves a stored cutoff by the
  zones' difference the next time the round re-resolves, like every other date window in the product.
- **Exclude side only.** The routes refuse it on the include side and on saved searches. If one reaches the
  resolver anyway, it reports `includeUnsupported` and `generateTurf` refuses; an exclude-side value that is
  present but unusable yields no set, so on its own the exclusion is degenerate and the cut refuses.
- **Validation** of a present value: a string matching `isoDateSchema`
  ([validators.js:49](../server/src/utils/validators.js#L49)) that is also a real calendar day (round-trip
  through `Date.UTC`), as a new `civilDaySchema` beside it; `isoDateSchema` itself is unchanged (campaign
  key dates use it). *Run*: 13 other value shapes (numbers, objects, `true`, ISO datetimes, one-element
  arrays…) on either side return 400.

## C. Server changes

1. **New [services/walklist/visitedSince.js](../server/src/services/walklist/visitedSince.js)** (arrow
   consts): `readVisitedSince(value)` → `{ present: false }` | `{ present: true, valid, day }`;
   `visitedSinceProblem(filter)` → message | null (present on the include side; present and invalid on the
   exclude side); `dayStart(day, zone)` = `zonedDayRange(day, null, zone).$gte`; `zoneFor(campaign)`.
2. **[targetingStatus.js](../server/src/services/walklist/targetingStatus.js)**:
   - `export const VISIT_ROW_MATCH = { ...STATUS_ROW_MATCH, ...NOT_DESK_MARK }`.
   - `export const visitedIdsSince = async (campaignId, householdIds, since) => Set<idStr>`: same `CHUNK`,
     `HINT` and fallback as `runChunks`; pipeline
     `[{ $match: { campaignId: oid(campaignId), householdId: { $in: part }, timestamp: { $gte: since }, ...VISIT_ROW_MATCH } }, { $group: { _id: '$householdId' } }]`,
     `since` a `Date` (pipelines are not cast). *Run* at 100k doors / 400k rows: 7-day window 532 ms,
     6-month 1.1 s; a status tick over the same doors 1.4 s.
   - `export const lastVisitAt = async (campaignId, householdId) => Date | null`: one
     `findOne({ campaignId, householdId, ...VISIT_ROW_MATCH }).sort({ timestamp: -1 })`, **no hint** (*run*:
     the planner picks the index, 1 key, 1 doc).
3. **[resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js)**:
   `collectPredicateSets(campaign, f, ctx, side)` reads `readVisitedSince(f.visitedSince)`: absent →
   nothing; include side and present → `includeUnsupported = true` + warning, no set; exclude side and
   invalid → warning, no set; exclude side and valid → push `ctx.visitedIds(start)` and return it as
   `visitedSet`. After the subtraction, `excludedVisited` = ids in `excludedSet` that are in
   `exc.visitedSet`. Returns gain `excludedVisitedHouseholdIds` and `includeUnsupported`, in the
   empty-walk-list return too.
4. **Routes** (each refuses `visitedSinceProblem` with 400 before doing anything):
   - `POST /turfs/target-preview` (1014): `visitedDrawn` = `excludedDrawn` ∩ `excludedVisited`, in JS
     (*run*: 31 ms vs 487 ms for a second query at 97,767 ids). The lists go out **disjoint**:
     `excludedHouseholdIds` = excluded drawn doors not matched by the visit line, `visitedHouseholdIds` =
     those matched (*run*: 2.70 MB at 100k doors and a 6-month window, vs 5.34 MB sending both in full).
     `counts.excluded` stays the total of both; `counts.visited` is the second's size; the remainder
     arithmetic (1116) is unchanged. With the line off the response gains only `visitedHouseholdIds: []`
     and `counts.visited: 0`. The only reader is the web page.
   - `POST /turfs/generate` (301): on `params.targetFilter`, before anything is queued.
   - `GET /turfs?passId=`: adds `targetFilter: pass?.targetFilter ?? null`, set outside the `if (pass)`
     block so a foreign or missing pass answers `null`.
   - `GET /turfs/household/:id` (1556): adds `lastVisitAt` only with `?withVisit=1`. *Run*: without it the
     response is byte-identical to today's.
   - `POST /walklists/preview` and `POST /walklists` (75, 96): refuse a present `visitedSince` on either
     side; no saved-search schema change, so no saved search (and no export of one) can carry it.
5. **[generateTurf.js](../server/src/services/turf/generateTurf.js)**:
   - Write `Pass.targetFilter` (the same `isActiveTargetFilter ? filter : null` as line 274) after the late
     archive check (after line 410) instead of at line 274. A cut that fails before it saves anything leaves
     the round's books and stored conditions as they were; one that fails after `wipeDraftBooks` (387)
     leaves the stored conditions unchanged and its drafts as today's code leaves them (*run*: a single
     failure heals on the queue's second attempt).
   - Refuse `resolved.includeUnsupported` like `excludeDegenerate`.
   - Gap G3: the degenerate and include refusals and manual mode's "no doors" (311) throw BullMQ's
     `UnrecoverableError` (already imported, used at 409). *Run*: the page shows the refusal in 0.1 s
     instead of about 15 s; the existing test matches on the message and still passes.
6. **[snapshot.js](../server/src/services/turf/snapshot.js)** `restoreSnapshot`: when the restored books
   include any a cut made (non-empty `params` without `supplemental`), set `Pass.targetFilter` to the first
   such book's `params.targetFilter` if `isActiveTargetFilter` passes, else `null`; when none of them came
   from a cut (only supplemental or moved-door books), leave the stored conditions unchanged. *Run*:
   swapping between two snapshots restores each one's filter; mixed cut + lasso + supplemental snapshots,
   legacy books with no `params` and a claim's move snapshot behave. A restore can bring back a city value
   the city-suffix repair has since rewritten in `Pass.targetFilter` (narrow; the repair only ran once).
7. **Gap G1 (in this build).** [exportTypes.js](../server/src/services/export/exportTypes.js)
   `voters-filtered.validateParams` also reads `source` and records `frozen: source === 'csv' || source ===
   'import'`. When `frozen`, `buildVotersFiltered` and `estimateVotersFiltered` read that saved search's
   `voterIds` (by `savedSearchId` and `campaignId` at build time; they never change after a list is saved)
   instead of re-resolving `{}`. Do-not-contact as today (`DNC_FILTER`), with the held-back voters counted in
   `excludedDncCount` like the voter-file import branch ([exportBuilders.js:1515–1517](../server/src/services/export/exportBuilders.js#L1515-L1517)
   and its estimate twin). A list deleted after the request fails the job with *That saved search was
   deleted.* Filter-built searches stay live. *Run*: 3 rows = 3 expected; `excludedDncCount` 2 = withheld 2;
   the same people as the list's Download CSV.
8. **Gap G2 — not in this build** (the owner reviews it after everything); the design, for then:
   `POST /turfs/manual-preview` and
   `GET /turfs/attribute-preview` accept the same `filter` and box flags as target-preview (refusing the same
   problems), resolve an active filter effort-scoped, add `_id: { $in: householdIds }`, merge
   `cutExclusionParts(...).filter` as target-preview does, return `excludeDegenerate`, and add the
   do-not-contact filter to the area voter count. *Run*: area counts equal the books Generate makes;
   manual-preview goes from 0.59 s to 1.2–4.2 s at 100k doors.

## D. Client changes

1. **`client/src/lib/visitedSince.js`** (new, pure, arrow consts; reuses `todayInTz` / `shiftDays`
   (datePresets.js) and `civilDaysBetween` / `shortDate` ([reportDerive.js:18, 121](../client/src/lib/reportDerive.js#L18))):
   `daysToSince(days, today)`, `sinceToDays(day, today)`, `maxDays(today)` (back to the 2020-01-01 floor),
   `acceptableSince(day, today)`, `DEFAULT_VISITED_DAYS = 7`, `targetFilterForPanels(stored)` (whitelist
   `priorPassStatuses`, `answerFilters`, `combine`, `exclude.{priorPassStatuses, answerFilters,
   visitedSince}`; a missing `combine` becomes `'and'`, the resolver's default; an empty `exclude` becomes
   `null`; `visitedSince` read through the shared "no line" rule; a missing `texts` becomes `[]`; a stored
   date kept as is), `sameConditions(a, b)` (order-insensitive, after `targetFilterForPanels`; `combine`
   compared whenever the target side holds two or more predicate sets — `(statuses ? 1 : 0) +
   answerFilters.length >= 2` — because the resolver applies it across all of them, 241–254),
   `describeConditions(filter, questions)` → *with Not home, leaving out Surveyed doors and doors visited
   since Oct 25* or *leaving out doors visited since Oct 25* (answers named as *Support: Undecided* from the
   survey's question and option labels when `questions` is loaded, else *a survey answer*; *any of these* /
   *all of these* whenever `combine` matters), `lastConditionsDiffer({ editable, stored, panels })` (the
   line: editable, stored filter active, `!sameConditions`) and `askBeforeGenerate({ editable, stored,
   panels, acknowledged, roundKey })` (the question: the same, unless `acknowledged` was recorded for this
   round against an equal stored filter).
2. **`client/src/components/VisitedSinceRow.jsx`** (new, shared like `AnswerFilters`): checkbox, a days box
   and `<input type="date" min="2020-01-01" max={today}>`. The date input keeps a local draft (the
   [DateRangePickerModal.jsx](../client/src/components/DateRangePickerModal.jsx) pattern) and commits an
   `acceptableSince` value. The days box keeps a draft while focused, commits through `useDebouncedValue`
   (400 ms; [useDebouncedValue.js](../client/src/lib/useDebouncedValue.js)) for typing and the arrows, and
   flushes at once on blur or Enter; it reports `pending` while its draft differs from the committed date.
   Out-of-range values clamp to `1–maxDays(today)`. Ticking sets `daysToSince(7)`; unticking deletes the key.
   Every change goes through `setExcludeSide`. Inputs copy the page's number input (`rounded border
   border-border-strong bg-card px-1 py-0.5 text-fg`).
3. **[TurfsPage.jsx](../client/src/pages/TurfsPage.jsx)** — common to both decision-1 options:
   - **`sideActive`** (1684) counts `visitedSince`; **`setExcludeSide`** (1975–1980) treats the side as empty
     only when `!sideActive(ex)`, so unticking the last status or answer never drops the visit line.
   - **Ready gate.** `turfsReady = turfsQ.isFetchedAfterMount && turfsQ.isSuccess`. Until it holds (on a
     round that is not view-only), the panels area shows *Loading this round's conditions…* and Generate is
     off; on a failed load it shows *Couldn't load this round.* with **Try again** (refetch) and Generate
     stays off. Generate is also off while the days box is `pending`.
   - **`targetActive`** gains `publishedCount === 0` (so Accept leaves the target view), and Generate sends
     `targetFilter` whenever the panels hold conditions (2408 sends it only when `targetActive`).
   - **Count line** (3683–3697): today's parts through `targetCountParts`, the first word set at 3692
     (`targeted doors` when `sideActive(targetFilter)`, else `doors in this cut`); with draft books on the
     round and conditions on, the suffix `· the draft books hold M`.
   - **Target doors header** (3522): "· on" from `sideActive(targetFilter)`.
   - **Exclude panel** (3592–3640): the row between Status and the answers; the panel line `N doors removed
     from this cut, M of them visited since Oct 25`.
   - **Pop-ups.** `fadeMode` (2202) adds `visitedSince`; the household query adds `withVisit=1` (and to its
     key) while `targetView` is on and the line is ticked; the status line (1188–1190) shows `last visit
     <date>` or `never visited` while ticked, else `last recorded`, as today. The **Units** branch
     (1550–1593) gains the per-unit status-and-reason line the separate-homes branch has (1477–1485), for
     every reason.
   - **After-cut note** over the books, from `turfsQ.data.targetFilter?.exclude?.visitedSince` (§E).
   - **Gap G6:** an effect clears `passId` when `campaignId` changes after the first render, so the
     PassPicker picks the new campaign's round.
4. **Coming back to a round — the page asks (the owner's decision 1):**
   - **`stored`** = `turfsQ.data?.targetFilter ?? null`; `editable = !viewOnly && turfsReady &&
     publishedCount === 0`. Neither piece shows while `turfsQ.isFetching` (so a restore, an undo or a cut
     never flashes the old conditions), while `generate.isPending`, or while a cut job runs (`jobBusy`).
   - **`acknowledged`** (new state) = `{ round: campaignId|passId, stored }`, recorded when the owner
     answers the question either way or clicks **Use them again**. It counts only while the round matches
     and `sameConditions(acknowledged.stored, stored)` — so it needs no reset effect: switching rounds, or
     the round's stored filter changing (a restore of a different cut, another admin's cut), re-arms the
     question by itself; a restore of the same cut does not. Plain edits record nothing.
   - **The line**, above the Target doors panel, renders while `lastConditionsDiffer` holds: *This round
     was last cut …* (`describeConditions(stored, targetQuestions)`) · **Use them again**. Clicking loads
     `targetFilterForPanels(stored)`, opens the panels that hold conditions (so the preview runs and the
     survey questions load), records `acknowledged`, moves focus into the first opened panel, and holds
     Generate until that preview answers (a one-shot flag), so an Enter can't cut before the count shows.
   - **The question**: clicking **Generate** while `askBeforeGenerate` holds opens it instead of generating
     (Part 1): `describeConditions(stored, …)`, then *Target doors and Exclude doors are empty now.* or
     *Ticked now: …*, then *Use them again puts them back so you can check the count; nothing is cut yet.*
     **Use them again** does what the line's link does; **Cut without them** / **Cut with what's ticked
     now** records `acknowledged` and calls `generate.mutate()` itself (guarded by `canGenerate`);
     **Cancel** closes. The shared `Modal`, `size="lg"` (three buttons don't fit `md`; its footer doesn't
     wrap) and `closable={false}`, so a double-clicked Generate can't open and close it on the scrim.
   - **Survey labels.** `targetSurveyQ` (1926) is also enabled while either piece could show and the
     stored or ticked filter has answer conditions, so the descriptions name answers. While it loads, an
     answer reads *a survey answer*; if the two descriptions still come out identical, the box adds *The
     survey answers differ.*
   - Conditions loaded this way can include a survey answer whose question — or whose option — is no
     longer on the survey (the walk list's survey was swapped, or a value saved before options had ids).
     After the questions load, a notice under the answers says so (*1 survey answer from the last cut isn't
     on this survey* · **Remove**), rendered outside the `targetQuestions.length > 0` gate (3543, 3619). The
     panels' `AnswerFilters` change handlers put such values back, since `AnswerFilters` rebuilds its value
     from the option keys it knows ([AnswerFilters.jsx:40–75](../client/src/components/AnswerFilters.jsx#L40-L75))
     and would otherwise drop them on the next click.
5. **Filling the panels in automatically — not chosen** (the owner, 2026-10-31). Its reviewed design
   (gates, an armed state, a per-round reload rule) is not carried in this plan; §L and §M record what it
   involved and what the rounds found in it.
6. **[targetFade.js](../client/src/lib/targetFade.js)**: `indexPreview` maps `visitedHouseholdIds` to
   `'visited'`; `fadeReasonLine('visited')` and `fadeReasonShort('visited')` (§E); `targetCountParts` keeps
   ONE Exclude part, `N removed by Exclude doors` + ` (M visited since Oct 25)` when `counts.visited`.
7. **[WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx)** (gap G4): the two "current status" strings
   (380, 402–403).
8. **Gap G2's client part** (not in this build; for when the owner takes G2 up): the manual- and attribute-preview queries send the filter
   and box flags under the same conditions as the target preview (in their query keys), debounced with
   `useDebouncedValue`, passing React Query's `signal` to `api()` so a superseded count is aborted.

## E. Exact copy

| Where | Text |
|---|---|
| Row | `Visited in the last [N] days — since [date]` (`day` when N is 1) |
| Hint | `Any result a canvasser recorded at the door, in any round. Notes and desk marks don't count. Dates follow the campaign's time zone (CDT).` |
| Panel line | `1,240 doors removed from this cut, 1,100 of them visited since Oct 25` |
| Count line | `3,410 doors in this cut · 1,240 removed by Exclude doors (1,100 visited since Oct 25) · …`; with draft books: `… · the draft books hold 3,402` |
| Loading / error | `Loading this round's conditions…` · `Couldn't load this round.` + `Try again` |
| House pop-up | `● Not home · last visit Oct 27` / `· never visited`; `Faded: visited since Oct 25 (Exclude doors).` |
| Building pop-up, per unit | `Not home across all rounds · visited since Oct 25` |
| Last-conditions line | `This round was last cut with Not home, leaving out doors visited since Oct 25.` (exclude-only: `This round was last cut leaving out doors visited since Oct 25.`) · `Use them again` |
| Generate's question | Title `Use this round's last conditions?`; body: the line's sentence, then `Target doors and Exclude doors are empty now.` or `Ticked now: Refused.`, then `Use them again puts them back so you can check the count; nothing is cut yet.` (plus `The survey answers differ.` when the two descriptions read the same); buttons `Cancel` · `Cut without them` (panels empty) or `Cut with what's ticked now` · `Use them again` |
| Orphan notice | `1 survey answer from the last cut isn't on this survey` · `Remove` |
| After the cut | `Add as new book leaves out doors visited since Oct 25, like this round's cut.`; view-only: `This round was cut leaving out doors visited since Oct 25.` |
| Refusals (400) | `"Visited in the last … days" needs a valid date.` · `"Visited in the last … days" can only exclude doors.` · `"Visited in the last … days" is on Turf Cutting only.` |
| Saved-search fix (G4) | `no pass picked → the door's whole history, same as Target doors`; Exclude intro `Statuses read each door's whole history across every round; survey answers match any round.` |

## F. Tests

**Server**, new `server/test/visitedSince.int.test.js` on a throwaway mongod (`npm run test:int`):

1. **Boundary**, campaign in `America/Chicago`, cutoff `2026-10-25`: rows at `05:00Z` (midnight) and `05:05Z`
   are left out, `04:55Z` stays in. **DST**: cutoff `2026-11-02`, a row at `2026-11-02T05:30Z` (11:30 PM
   Nov 1 CST) stays in. A campaign with no stored zone reads its org's.
2. **What counts**: desk mark only → in; note only → in; no rows → in; an old knock plus a recent desk mark
   → in; a reclassified row keeps its time → out; a row under another walk list or round of the same
   campaign → out; an unknocked row → in.
3. **Shapes**: exclude-only → active, the universe minus visited; with a *Not home* target → intersect,
   then subtract; with a status exclusion too → the preview lists are disjoint, their union is every
   excluded drawn door, and the parts sum to `drawable`.
4. **Preview equals cut**: `doorCount` equals the generated books' door total.
5. **The stored filter follows the books**: written only after the books are saved (a failed manual cut
   leaves the old filter and drafts; a zero-book cut stores the new filter); `GET /turfs?passId=` returns it
   (`null` on a round from before the field and on another campaign's pass); restoring an earlier untargeted
   snapshot sets it to `null`, a targeted one brings its date back, and a snapshot of only moved-door books
   leaves it unchanged; the bookless count and `addSupplementalBooks` skip a recently visited door and pick
   up a new door with no rows.
6. **Refusals**: 400 on target-preview and generate for a bad string, a number, an object, `true`, an ISO
   datetime and a one-element array, and for any include-side value; 400 on walklists preview and create for
   any present value. **No line**: `undefined`, `null` and `''` on either side → 200, identical to the key
   absent.
7. **Resolver defenses**: an include-side value → `includeUnsupported`, and `generateTurf` refuses with an
   `UnrecoverableError`; an invalid exclude-side value alone → `excludeDegenerate`, refused the same way;
   manual "no doors" refuses on the first attempt (G3).
8. **Household route**: `lastVisitAt` only with `withVisit=1`; it ignores desk marks and notes; the route
   answers on a database without the `{ householdId, timestamp }` index (the test preload's setup).
9. **G1**: Filtered voters of an uploaded list and of an import list export exactly the list's
   stored voters minus do-not-contact, with `excludedDncCount` counting the held-back ones; estimate equals
   build; a deleted list fails cleanly; a filter-built search stays live; the uploaded list joins the
   do-not-contact sweep test.
10. **G2** (later, with G2): manual- and attribute-preview with a target, an exclusion and the boxes equal
    the cut; a degenerate exclusion is reported; area voter counts leave out do-not-contact voters.

**Client** (`node --test`): `visitedSince.test.js` (days ↔ date across month, year and leap edges and
across 2026-11-01 and 2026-03-08; N = 1; clamping to `maxDays`; unacceptable dates; `targetFilterForPanels`
on `null`, the three stored shapes (2026-06 without `exclude`, with `exclude`, with `visitedSince`), a
missing `combine`, a missing `texts`, `visitedSince` of `''`/`null`, junk keys; `sameConditions` ignoring
order, and comparing `combine` exactly when two or more target predicate sets exist (two answer questions
AND vs OR differ); `describeConditions` for each kind, with and without labels, exclude-only, and two
different answers to one question reading differently once labels load; `lastConditionsDiffer` and
`askBeforeGenerate` over the lifecycle — a reloaded round (both), panels carried from another round
(both), panels equal to the stored filter (neither), a partial rebuild (both), answered on this round
(line only), answered and then the stored filter changes (both again), the same cut restored (line state
unchanged, no question), a round switch and back, not editable (neither), no stored filter (neither), a
stored filter from before this feature (both)); orphan detection per value (a June-shape text value); the
`setExcludeSide` rule (unticking the last status keeps the visit line); new cases in `targetFade.test.js`
(the visited reason, the single Exclude part).

Kept green: the 18 suites the round-3 reviewer ran against the v3 copies (targetExclusion, turfTargeting,
walkListBookGuards, effortClaim, turfAssignmentHygiene, moveDoorsBulk, answerEditRound9, repairCitySuffix,
passLifecycleRace, passBringBack, accessLogCoverage, pinWire, pinMoveRehull, leadWalkthrough,
turfCutDeterminism, exportBuilders, exports, notTarget), plus targetingStatus.

## G. Docs and Help Center

- **[PASSES_AND_TURF.md](PASSES_AND_TURF.md)**: Part 1 *Targeted follow-up rounds* — the visit line after
  Exclude doors; faded doors go from five reasons to six; the stale count-line sentence (674); "its last
  visit" (684) names which date; coming back to a round (656 "a tick … stays visible after you switch");
  when doors are checked; Add as new book on a targeted round (854–858); restore bringing back the
  conditions. Part 2 — the predicate; target-preview's disjoint lists; `targetFilter` on `GET /turfs`;
  `withVisit`; the stored filter written after the books and restored with snapshots; the ready gate (982
  "`targetFilter` survives a campaign switch", 1009–1016 "a plain page load pays no history aggregate",
  both said precisely). With G2: 946–948 and the manual-preview row at 1194.
- **[WALKLISTS.md](WALKLISTS.md)**: §B (the predicate exists, Turf Cutting only), §C (walklists routes refuse
  `visitedSince`; the stale endpoint row at 274–275).
- **[TIMEZONES.md](TIMEZONES.md)**: one line under *What you actually see*.
- **[EXPORTS.md](EXPORTS.md)** + Help `guides/exports.md`, `pages/page-exports.md` (G1).
- **[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)** (G1): the Export Center entry (479, "saved-search
  subsets").
- **Help Center**: `guides/passes.md` (the Exclude paragraph, the faded-doors callout at 42),
  `pages/page-turf-cutting.md` (Exclude doors, the reasons, coming back to a round, the note; 41 "colors,
  counts, bar follow the round"), `guides/turf-and-books.md` (38 "just generate again" and decision 1; 42 Add
  as new book follows the round's conditions; with G2, 20's draw-areas counts), `faq/recut-books-mid-pass.md`
  (14), a new `faq/skip-recently-visited-doors.md` (*Can I skip doors we knocked recently?*, audience
  `lead`, `sourceDoc: PASSES_AND_TURF.md`, saying also to cut close to activating) with its Triaged line in
  `faq/_INBOX.md`, and `faq/paper-canvass-and-your-reports.md` (typed-in results count on the day typed;
  untyped paper days never count).
- **[README.md](README.md)**: the index row, rewritten for this version.
- Not needed in this build (no Activate check): [PASSES.md](PASSES.md) (81, 202),
  [GETTING_STARTED.md](GETTING_STARTED.md) (121–122), Help `guides/passes.md` (52).

## H. Privacy, phones, release

- **The feature is not privacy-affecting.** Nothing new is collected, kept, shared or exported. The pop-up's
  last-visit date goes to the same people who already see each visit and its time: this route already
  returns `lastActionAt` (turfs.js:1579); `GET /admin/households/:id/activity` returns every visit with time
  and canvasser on the web and the phone; Results by voter gives each door's first and last visit;
  [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (v4, 2026-07-22, ~1281–1293) records this route serving
  those roles. No change to the Privacy Policy, Terms or DPA.
- **G1 is privacy-affecting by the repo's own list (an export's contents).** It narrows Filtered voters to
  the list it is named after and makes the privacy record's "saved-search subsets" (479) true; update that
  entry when it is built. No policy text changes. The owner should check whether any earlier Filtered voters
  file of an uploaded or "New voters" list went to a client or vendor.
- **Phones:** nothing to ship. The phone's routes gain nothing it reads (`GET /turfs` gains
  `targetFilter`; the household route is unchanged without `withVisit`), so no `CLIENT_API_VERSION` bump. The
  phone's admin Books screen does trigger the stored filter's re-resolution, now with the visit step (*run*:
  about +1 s at 100k doors). Not gated, because the Passes page shares that response's cache entry with Turf
  Cutting and a gated rollup would flash zeros there. Run `npm run audit:mobile-api` before deploy.
- **Release:** one Heroku deploy from `main`. No migration, no index build, no config var. Optional check in
  the dashboard's **Run console**: `npm run migrate:build-indexes` (a read-only dry run; the root
  `package.json` proxies it). If `{ householdId: 1, timestamp: -1 }` on `canvassactivities` is listed, stop
  and tell me before deploying; other lines are not this feature's. The hand-over will list every file the
  change should add or modify, so `git status --short` can be checked before `git add -A`; screenshots stay
  in the session's scratch folder, never the repo (`*.png` is not ignored).

## I. Edge cases and risks

- **Preview to cut:** doors knocked between the preview and the moment the queued cut runs drop out of the
  cut (inherent; seconds to minutes).
- **A restricted or no-soliciting door visited recently** is credited to the visit line, not the box,
  because Exclude doors acts first (the existing rule).
- **Campaign time-zone edits** shift a stored cutoff by the zones' difference (§B).
- **Wrong clocks:** an admin's computer clock moves the date the page computes (the date shown is the date
  applied); a phone's clock moves the visit times it records (G5).
- **A page left open past midnight** keeps its date; the days box then reads one more.
- **Re-cutting a round that has been knocked** (after discarding its books) also leaves out that round's own
  knocks, its not-homes included; the preview shows it before anything is cut.
- **Payload:** at 250k doors a 6-month window's preview still ships every kept and excluded id once (about
  the size of today's preview with a status exclusion).

## J. Verification

- Server unit and integration suites (throwaway mongod), client tests, client build.
- Drive the real page on a seeded campaign: tick the line, check the counts and pop-ups (a house and an
  apartment building); untick a neighbouring status and confirm the line stays; generate; reload (Generate
  waits while loading; the *Use them again* line; Generate's question and each of its three buttons; the
  line and question gone after an edit); restore an earlier snapshot (the stored conditions follow, and the
  offer comes back); Accept (the map leaves the target view); switch campaigns (G6); **Add as new book**
  leaves the doors out. Screenshots in the scratch folder.
- `npm run audit:mobile-api`.

## K. What changed after review round 1

- The after-cut note reads `GET /turfs?passId=` (refreshed by every cut), not the passes list.
- Honest timing (*When doors are checked*); one Exclude number everywhere; one date in the pop-up; apartment
  units get reasons; exclude-only cuts stop saying "targeted"; the days box commits sensibly.
- Saved searches dropped from this build (the export would re-check the date live).
- Server hardening: `typeof string` validation; include-side bad dates never widen; pipeline values cast;
  preview lists disjoint and intersected in JS; existing helpers reused.
- Facts corrected: paper results typed in later count; desk marks come from the phone too; Discard with knocks
  removes visits; the privacy evidence; `GET /turfs` costs the visit step on every load.
- Decisions cut from four to three; the reverse line on Target doors and the date range dropped (a range
  would miss doors whose in-range visit was replaced by a later tap).
- New: gaps that exist today.

## L. What changed after review round 2

- `lastVisitAt` lost its hint and runs only with `withVisit=1` (the hint 500'd the house pop-up wherever the
  index is missing, including the tests' databases).
- "No line" is `null`, `undefined` or `''` through one reader (v2's validator 400'd the page's own `null`).
- The stored filter follows the books: written after they are saved, restored with snapshots.
- The page gates, the armed state and the Activate check with Leave them out were introduced; G1's wording
  made exact and its privacy angle flagged; G2 extended to attribute groups and costed.

## M. What changed after review round 3

- **Decision 1 became a choice, with B recommended.** Round 3 found a blocker in the automatic fill (a
  filter carried from another round armed itself, so Generate could cut with conditions nobody had seen a
  count for) and four more problems in its machinery (a failed load opening the gate, restores not reaching
  the panels, copy naming panels that were off, the "from this round's last cut" line on carried filters).
  Option A keeps every fix; option B avoids the machinery.
- **The Activate check left the build** (decision 2). Round 3 found that Leave them out could be interrupted
  or double-clicked into duplicate books, would re-count doors it had already set aside, and — a blocker —
  counted the round's own knocks after a discard and restore, so it would strip a round's own not-homes. The
  design that fixes all three is §N.
- **`setExcludeSide`** now keeps the visit line when the last status or answer is unticked (v3 had lost
  v2's note, so unticking would silently drop the line).
- The ready gate also requires a successful load; the write-after-insert point moved after the late archive
  check (410) and its claim narrowed; restore ignores books a cut didn't make; G3 covers the manual "no doors"
  refusal; G1's wording fixed for import lists; the zone falls back to the org's like the page; the date
  check builds on `isoDateSchema`; G6 added; line references corrected (turfs.js:1579, 1796;
  collectRevisitHomes.js:77; WalkListsPage.jsx:402–403); the README row rewritten.
- **The owner's decisions (2026-10-31):** ask (option B); no Activate check in this build; visits as
  listed; G1, G3, G4 and G6 in this build, G2 and G5 reviewed after everything. v5 then tightened option B
  before its short check: the line and the question stop once the owner changes the panels on this round
  (v4 would have asked after every deliberate change); **Use them again** in the question loads the
  conditions without cutting (v4 cut blind, without a count or the orphan notice); a restore re-arms the
  offer.
- **After the short check of those two pieces (one reviewer, the same day):** the question named answers
  only by count, so two different answers read the same on both sides (a blocker) — answers are now named
  by their survey words, with *any/all* where it matters; *Nothing is ticked now* was false beside the three
  ticked boxes — now *Target doors and Exclude doors are empty now* and **Cut without them**; one tick hid
  the only reminder, so a partial rebuild could drop the visit date silently — the line is now a standing
  reminder and the question asks once per round visit until answered; `sameConditions` now compares
  `combine` whenever two or more target sets exist; answering is recorded against the stored filter
  (re-arming by itself when it changes, no Restore reset); neither piece shows during a refetch or a cut;
  orphans are judged per value; the box is `lg`, can't be closed by a stray click, and focus and Generate
  wait for the count after **Use them again**.

## N. The Activate check — not in this build (the owner, 2026-10-31)

The design the rounds converged on, kept for if it is ever wanted.

- **Check.** `GET /turfs/visit-check?passId=`: when the round's stored filter has a visit line, the
  knockable doors of its published books — skipping set-aside books — with a VISIT row since that date
  **from other rounds** (`passId: { $ne: pass._id }`), so a round re-activated after a discard and restore
  never flags its own work. Returns `{ visitedSince, visitedCount }`. *Run*: 0.9–1.0 s at 100k booked
  doors (reuse `eligibleSetOf` or chunk at 10k).
- **Warning only** (option "a warning"): on every Activate click, a `checking` state, then one modal with
  today's no-canvassers paragraph when it applies: *This pass was cut to leave out doors visited since Oct
  25. Since then, 312 doors in its books have been visited.* **Activate anyway** leaves them in their books,
  so canvassers will knock them again.
- **Leave them out and activate**: ONE server step, `POST /turfs/set-aside-visited { passId }`, run as a turf
  job under the round's recut lock (like Add as new book, with progress), that recomputes the visited set,
  creates or reuses the round's set-aside book (`params: { setAside: { visitedSince }, targetFilter }`, so the
  check skips it and a restore knows it), moves the doors and recomputes territories once; then the client
  activates. Once started, the modal can't be closed (`closable={false}`), its buttons are disabled
  (*Leaving them out…*), a ref guards double clicks, and an abort is checked before activating. Copy: the
  set-aside doors still count in the round's progress, and a published book with doors can't be deleted
  (turfs.js:2026–2027); a success line names the book. *Run* (move-doors at 100k doors): 2.5–4.8 s per
  1,000 doors; time the whole step at 250k doors before shipping.

## O. As built (2026-10-31)

Built to v5 and the owner's decisions: the visit line, the "last cut with" line and Generate's question,
the stored conditions following the books, and gaps G1, G3, G4 and G6. Not built, by the owner's
decision: the Activate check (§N), and G2 and G5 (reviewed after everything). Committed by the owner as
`95a532e` and deployed 2026-10-31.

**Where the build differs from the plan, or adds to it**
- **The date check** is `civilDaySchema` beside `isoDateSchema` in `utils/validators.js`. Exercising it
  caught that zod still runs a refinement after the regex fails, so `'2026-10-25T00:00:00Z'` reached
  `Date.UTC` with a NaN day and threw; the refinement re-checks the shape first.
- **`aggregateHinted`** (targetingStatus.js) now holds the hint-and-fallback both `runChunks` and
  `visitedIdsSince` use — the same behaviour, written once.
- **The turfs query moved** above the page's gates in TurfsPage, because `targetActive` / `targetView`
  must know whether the round has accepted books before the doors query decides what to ask for.
- **The orphan count** counts answers (a question with two stored values that the survey lacks counts
  two), and a survey that loaded with no choice questions treats every stored answer as orphaned;
  `orphanAnswers` takes `null` for "not loaded yet".
- **The draft-books suffix** appears only while a target or exclusion is on, so its number is compared
  with a count taken after the same boxes.

**What was verified**
- `server/test/visitedSince.int.test.js` — 11/11 on a throwaway mongod: the Central-time midnight and DST
  boundaries, a campaign with no stored zone reading its org's, every "what counts" case, targets and
  exclusions together, the disjoint preview lists and their arithmetic, preview equals cut, the stored
  filter through a failed cut / GET /turfs / three snapshot restores, Add as new book and the bookless
  count, every refusal and every "no line" form, the resolver defences, the opt-in last visit, and the
  route and the line with the `{ householdId, timestamp }` index dropped.
- `server/test/filteredVotersFrozen.int.test.js` — 4/4: an uploaded list exports its own two people (not
  the campaign's nine) with its do-not-contact voter withheld and counted, estimate equals build; an
  import list exports its new voter; a filter-built search stays live; a deleted list fails with the
  plan's sentence.
- Existing integration suites, all green: targetExclusion 10, turfTargeting 8, notTarget 20,
  exportBuilders 30, exports 17, walkListBookGuards 18, effortClaim 9, turfAssignmentHygiene 5,
  moveDoorsBulk 11, answerEditRound9 17, repairCitySuffix 5, passLifecycleRace 5, passBringBack 15,
  accessLogCoverage 12, pinWire 4, pinMoveRehull 8, leadWalkthrough 14, turfCutDeterminism 5,
  savedSearchMap 5, archivedCampaign 12, help 3.
- Client: `node --test src/` 1,202/1,202 (new `visitedSince.test.js` and the new targetFade case among
  them); `vite build` clean.
- Server unit suite: 3,045 tests, one failure in `readIdColumn.resources.test.js` (a time-budget test on
  spreadsheet parsing, untouched by this change) that passes 4/4 on its own — load from the parallel run.
- The real TurfsPage rendered in Node with the map stubbed (scratch folder only): no render errors; while
  the round loads it shows *Loading this round's conditions…*; once loaded, with a stored "Not home +
  visited since Oct 25" and empty panels, it shows *This round was last cut with Not home, leaving out
  doors visited since Oct 25.* with **Use them again**; the row renders 7 days and disables its boxes when
  unticked.
- `npm run audit:mobile-api`: turfs.js is mobile-facing; its changes add one field to `GET /turfs` and an
  opt-in field to the house route, so no `CLIENT_API_VERSION` bump.

**Not verified before the deploy:** a live browser session of Turf Cutting with real data — ticking the line, a real cut and
Add as new book through the queue, the question's buttons, the house and building pop-ups, and the
campaign switch. No local stack was run against the repo's own `.env`, which may reach live services. Do
these on staging or production right after deploy (§J).

**Verified after the deploy (2026-10-31):** the owner tested Turf Cutting on the live site and reported no
problems.

