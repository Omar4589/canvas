# Proposal: Archiving a walk list ends its live pass, with undo, and screens that say what each pass is

> **Status: BUILT 2026-10-28 (uncommitted) to plan v3, which the owner approved the same day; plan
> reviews in §N, two code review rounds done and fixed (§O.6); deploy, the one-time repair, the index
> build and the phone update pending (§K).**
> Where the build differs from the plan is in [§O As built](#o-as-built-2026-10-28).
>
> - **Owner rulings** (ten, all recorded in §M):
>   1. Archiving a walk list ends its live pass, and Unarchive asks each time whether to bring that pass
>      back.
>   2. A pass ended by its own Archive button gets the same undo, until a newer pass on that walk list
>      goes live.
>   3. Late knocks count in the pass they were made in.
>   4. Archiving a walk list whose pass is live takes typing `archive`.
>   5. It ships this week, with an off switch for the late-knock part.
>   6. Whoever can archive can undo.
>   7. Archived walk lists stay in report filters, marked and listed last.
>   8. Walk lists already archived with a live pass are listed first, then ended with one command.
>   9. Knocks made on an old book after the next pass started count in the new pass when it includes the
>      door (2026-10-28).
>   10. That one command ends every listed pass, customers' included (2026-10-28).
> - **Review:** two rounds, six reviewers, three of them driving the real code on throwaway databases.
>   Round 1 found 3 blockers, round 2 found none; v3 fixes every finding of both (§N).
> - **Scope:** the server, the web console, and the phone through an over-the-air update (no new
>   build). No new personal data, recipients, exports or links (§J).
> - **Line references:** HEAD `44bb72d`.

Related: [EFFORTS.md](EFFORTS.md) (walk lists), [PASSES.md](PASSES.md) and
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (passes, books, attribution), [WALKLISTS.md](WALKLISTS.md)
(saved searches and re-carves), [METRICS.md](METRICS.md) (how knocks count), [CAMPAIGNS.md](CAMPAIGNS.md)
(campaign archive, History, Door Outcomes undo), [ADMIN_APP.md](ADMIN_APP.md) (the phone's admin Books),
[CANVASSER_APP.md](CANVASSER_APP.md) (what a phone sends with a knock).

# Part 1 — For everyone

## Why this is changing

Today, archiving a walk list only changes its label. We checked this on a test copy of the server:

- **Its live pass keeps running.** Canvassers keep their books, and their knocks keep counting.
- **The Walk Lists page then says "archived" and "Live" on the same row.**
- **Nothing is locked.** You can still claim doors into an archived walk list, add a pass and send it
  live.
- **There is no way back.** Archive is one click with no confirm, and nothing in the app unarchives.
- **Ending a pass is one-way.** A pass archived by mistake can never come back; you rebuild it.
- **The Turf Cutting Pass dropdown sorts passes under the wrong headings.** An ended pass can sit
  under "Active round", a finished precinct under "Not started", and a pass canvassers are still
  walking under "Archived".
- **An ended pass looks editable on Turf Cutting.** Half the buttons still work, the other half fail,
  and a green banner offers to activate a pass that can never be activated.

## What changes, in short

- **Archiving a walk list ends its live pass.** Its books leave canvassers' phones the next time their
  map refreshes. A box says exactly what will end, and you type `archive` to confirm when a pass is
  live.
- **You can undo it.** Right after you archive, an **Undo** link puts everything back. Later,
  **Unarchive** asks whether to bring that pass back, with the same books and the same canvassers, or
  keep it ended.
- **Ending a single pass can be undone too.** An archived pass gets a **Bring back** button, until a
  newer pass on that walk list has gone live.
- **Late knocks count in the pass they were made in.** A phone that was offline when its pass ended
  still has those knocks counted in that pass, instead of in "Legacy / no pass". This needs the phone
  update, and a Heroku setting can switch it off.
- **An archived walk list is read-only,** like an archived campaign: no new doors, passes, crew or
  survey change. You can still rename it. Its doors and its draft passes stay with it, and its history
  stays in every report.
- **An archived pass is view-only on Turf Cutting.** A banner says when it ended and what you can do.
- **The Pass dropdown groups passes by what each one is:** Live, Drafts, Archived.
- **The Walk Lists page gives each walk list one clear status.** Archived walk lists fold into an
  "Archived (N)" section. **Delete** only shows when it can work.
- **Report filters keep archived walk lists, marked and last** ("North (archived)"). Pickers you use
  to do work (the phone's admin Books, print packets, Mark restricted) leave them out.
- **The campaign's History says who archived, unarchived, ended or brought back what, and when.**
- **Walk lists already archived with a live pass** are listed by a one-time console check. One
  command then ends all of them, and each one can be brought back with Unarchive.

## Archiving a walk list

On the Walk Lists page, **Archive** opens a box that says what will happen:

```
┌ Archive "North"? ─────────────────────────────────────────────────┐
│ Pass 3 · GOTV is live. Archiving North ends it:                   │
│   · its 14 books leave 6 canvassers' phones the next time their   │
│     map refreshes                                                 │
│   · its 1,204 knocks stay counted                                 │
│ Pass 4 stays a draft, and can't be cut or started while North is  │
│ archived.                                                         │
│                                                                   │
│ North becomes read-only. Its 3,412 doors stay with it; claim them │
│ into another walk list if you need them.                          │
│ You can unarchive North at any time and bring Pass 3 back.        │
│                                                                   │
│ Type archive to confirm   [ archive        ]                      │
│                                     [ Cancel ]  [ Archive North ] │
└───────────────────────────────────────────────────────────────────┘
```

- **Typing `archive` is only asked for when a pass is live.** A walk list with nothing live gets the
  same box with a plain **Archive** button.
- **Right after**, a line at the top of the page says *North archived — Pass 3 ended.* with an
  **Undo** link. Undo brings North and Pass 3 back in one click.
- **On the phones** (after the app update): within 30 seconds while a canvasser's map is open, or when
  they next open the app, North's books close. If that was the only book they had, the map says *No
  book right now* — *The office closed or reassigned the book you were working. Anything you saved
  still counts.* A canvasser with books on another walk list goes to their book list, as today.
- **What still saves.** A survey that's already open, and anything waiting to send, still save, and
  count in Pass 3 (see *Late knocks*). If the pass is brought back, the books return on the phones'
  next refresh.

## Unarchiving

**Unarchive** sits on each archived walk list, on its Passes page, and in the Turf Cutting banner. It
asks about the pass that archiving ended:

```
┌ Unarchive "North"? ───────────────────────────────────────────────┐
│ North can take doors and passes again.                            │
│                                                                   │
│ Pass 3 · GOTV ended when North was archived (Oct 27, by Ada).     │
│ Bring it back and its 14 books return to the same 6 canvassers'   │
│ phones the next time their map refreshes.                         │
│                                                                   │
│  [ Cancel ]  [ Unarchive only ]  [ Unarchive and bring Pass 3 back ] │
└───────────────────────────────────────────────────────────────────┘
```

- **Unarchive only** leaves Pass 3 ended. It keeps its own **Bring back** button, under the rule in
  the next section.
- **When Pass 3 can't come back**, the box says why and offers a single **Unarchive**. One example: the
  campaign has no survey attached any more, and a survey campaign can't have a live pass without one.
- **When someone else is changing North at that moment**, the box says *Someone else is changing North
  right now. Try again in a minute.* and changes nothing.

## Archiving a pass, and bringing it back

The pass **Archive** button works as today: a confirm, plus typing `archive` once the pass has
knocks. Its wording no longer says "one-way".

An archived pass shows **Bring back** in the walk list's Passes panel and on Turf Cutting:

```
 Pass  Name      Status                                           Books  Knocks
 3     GOTV      Archived · Oct 27 by Ada · by hand  [Bring back]    14   1,204
 2     Pass 2    Archived · Oct 12 · when Pass 3 went live           12   2,310
```

- **Bring back works until a newer pass on that walk list has gone live.** A pass that ended because
  the next pass went live never comes back; its row says so instead of showing the button.
- **A pass that was live comes back live.** The same books go back to the same canvassers. A pass that
  was a draft when it was archived comes back as a draft.
- **A pass with no doors left in its books comes back as a draft**, since there would be nothing to
  walk (for example, every door was re-carved into another walk list). The box says so before you
  confirm.
- **The box asks before anything changes:** *Bring back Pass 3? It goes live again: its 14 books
  return to 6 canvassers' phones the next time their map refreshes.*
- **Right after archiving a pass**, an **Undo** link appears, as for a walk list.

## Late knocks

A canvasser in a basement with no signal knocks 20 doors on Pass 3. Before they get signal back, you
archive North. When their phone reconnects, those 20 knocks reach Doorline.

- **Today** they are saved with no pass, in the "Legacy / no pass" row of the By pass report.
- **After this change** they count in Pass 3, the pass they were made in. If you bring Pass 3 back,
  nothing is missing from its numbers.
- **The same goes for a pass that ended because the next one went live.** A knock made on Pass 3
  *before* Pass 4 started counts in Pass 3, even if it arrives later.
- **Knocks made after the next pass started count in the new pass** when it includes that door. Say a
  phone in a dead zone keeps showing yesterday's book, and the canvasser knocks all morning after you
  started Pass 4 at 6 am. Those knocks count in Pass 4, so its crew sees those doors as done. When the
  new pass doesn't include the door (or nothing is live, as after archiving the walk list), they count
  in the book's own pass.
- **It needs the phone update.** The phone now says which book each knock was made in. A phone
  without the update keeps today's rule.
- **Per-pass numbers get more accurate, and can keep growing for a while.**
  - A late knock now counts once, in its own pass. So the By pass report, and any per-door invoice you
    build from it, can move by a few doors either way compared with today.
  - A pass's row can still grow after it ends, while offline phones catch up. Invoice a finished pass
    once phones have synced, or by date range.
  - Doorline's own bill is a flat price per campaign and doesn't change.
- **A door knocked just before the switch** shows as done on that canvasser's phone for a few minutes,
  then as not done in the new pass, because it counts in the old one.
- **The off switch:** setting `LATE_KNOCK_ATTRIBUTION` to `off` in the Heroku dashboard (Settings →
  Config Vars) puts knocks back on today's rule. Saving a config var restarts the app for a few
  seconds. Do it outside field hours, unless knocks are failing: then flip it anyway, because phones
  hold their knocks through the restart.

## Turf Cutting

The **Pass** dropdown groups passes by what each pass is. The page still opens on the pass you're most
likely there to work on (your August rule):

```
 Pass [ North · Pass 3 · GOTV                  ▾ ]
      ── Live ──────────────────────────
        North · Pass 3 · GOTV
        South · Pass 2
      ── Drafts ────────────────────────
        Central · Pass 1
        South · Pass 3
      ── Archived ──────────────────────
        North · Pass 2
        South · Pass 1
        West · Pass 1 · walk list archived
        West · Pass 2 (draft) · walk list archived
```

Picking an archived pass, or any pass of an archived walk list, shows its books as they were, with a
banner:

```
┌───────────────────────────────────────────────────────────────────┐
│ Pass 2 is archived. It ended Oct 12, when Pass 3 went live.       │
│ You're looking at its books as they were.                         │
│                                                   [ Open Pass 3 ] │
└───────────────────────────────────────────────────────────────────┘
```

- **The banner names what you can do:**
  - **Bring back Pass 2**, when the rule allows it;
  - **Unarchive West**, when the walk list is archived (the box opens right there);
  - **Open Pass N**, which goes to the walk list's live pass, when it has one.
- **What's gone** while you view one: cutting, Accept, Discard, Add as new book, renaming, moving doors,
  merging, Mark restricted, assigning, and restoring a snapshot. The book list still shows who held
  each book.
- **What stays:**
  - deleting an old snapshot, which is the way to clear one rare Door Outcomes undo case (§C.7)
    without bringing the pass back;
  - unmarking a desk mark, which stays on the Map page.
- **An archived campaign gets the same view-only page,** with the campaign wording. Today most of its
  buttons fail without saying anything.

## The Walk Lists page

```
 Walk list   Status                          Doors  Crew  Pass              Created
 North       Live · Pass 3                   3,412     6  Pass 3 · GOTV     Oct 1
 South       Setting up · 4/5 · next: Pass   2,100     0  —                 Oct 9
             activated
 Central     Between passes · Pass 1 ended   1,880     4  —                 Oct 2
             Oct 20

 ▸ Archived walk lists (2)
     West    Archived Oct 27 by Ada · Pass 1 ended   [View] [Unarchive]
     Main    Archived                                [View] [Unarchive] [Delete]
```

- **One status per walk list**, never "archived" and "Live" together.
  - *Setting up* means no pass has gone live yet.
  - *Between passes* means a pass has been live and none is live now.
- **Older rows show less.** A walk list archived before this change shows *Archived* with no date or
  name, because nothing recorded them. Once the one-time check ends its pass, it reads *Archived ·
  Pass 1 ended by the one-time check*.
- **Until the one-time check runs**, a walk list archived with a pass still live shows *Archived ·
  Pass 3 still live* in amber, with **Unarchive** and **End Pass 3**.
- **Archived walk lists fold away** at the bottom, closed by default. If every walk list is archived,
  the table says *No open walk lists — 2 archived below.*
- **Delete only shows when it can work:** every pass of that walk list is still a draft. (Doors
  recorded there also stop a delete. The server still checks, and says so.)
- **An archived walk list opens read-only.** You can rename it; everything else says *Unarchive North
  to change this.*
- **On an archived campaign** the page shows the campaign's archived banner, and archiving, unarchiving,
  renaming, deleting, claiming and passes are all off.
- **The counts at the top** read *Walk lists: 3 (+2 archived)*.

## Everywhere else

- **Report filters** (campaign Home, Map, Timeline, Audit, Notes, Exports, Survey Explorer, Door
  Outcomes, client reports, and the phone's campaign screen, map, timeline, audit, notes and exports)
  keep archived walk lists, marked "(archived)" and listed last.
- **Lists of passes in those filters name their walk list** ("North · Pass 2"), so two "Pass 1"s can be
  told apart. Survey Explorer's pass list follows the walk list you pick, as Door Outcomes' already
  does.
- **The phone's admin Books** lists only walk lists that aren't archived. With none left it says *No
  open walk lists. Unarchive one on the web to assign books.*
- **Print packets** offer no pass of an archived walk list.
- **The Map door panel's Mark restricted** says *North is archived — unarchive it to mark its doors*,
  instead of *This walk list has no round yet*.
- **The Survey page** locks an archived walk list's own survey choice. A phone that was offline could
  still be sending answers to that survey, and a changed survey would refuse them.
- **New client report** opens on a walk list that isn't archived, or on the first one if all are.
- **Campaign Home:** once a campaign has canvassed and no pass is live, a short line replaces the
  full Setup checklist.
  - It reads *No pass is live right now. Start one on Walk Lists.*
  - With every walk list archived, it reads *Unarchive a walk list or create one*.
  - Org admins also see *or archive the campaign if you're done*, except when the Election Day archive
    reminder is already showing. Team leads never see that clause.
- **Door Outcomes, flag review, notes and exports** keep working on an archived walk list's history.
- **Re-carving doors out of an archived walk list** (claiming them into a new one) keeps working.

## History

The campaign's **History** (web and phone) gains four entries:

- *Ada archived walk list North — ended Pass 3 · GOTV*
- *Ada unarchived walk list North — brought back Pass 3 · GOTV* (or *Pass 3 stayed ended*)
- *Ada archived North · Pass 3 · GOTV*
- *Ada brought back North · Pass 3 · GOTV*

Entries written by the one-time check read *One-time check ended North · Pass 3 · GOTV*. A phone without
the update shows all of these entries in a plain form, and still names the check *One-time check*, never
*Unknown user*.

## Walk lists already archived with a live pass

The likely cause: the Help Center tells admins to archive the leftover "Main" list after splitting a
campaign, and Main's pass stayed live. After the update, a console check lists every such walk list,
archived campaigns included.

- **The list is grouped by organization** (yours, then each customer's). For each walk list it shows the
  campaign, the pass, how many books and canvassers it has, the last knock, and whether it was knocked
  in the last 2 days. It shows counts, never canvassers' names, and a count under 3 canvassers reads
  *fewer than 3*.
- **One command ends every listed pass** (your ruling), customers' included, exactly as a new archive
  would. Each one can be brought back with Unarchive.
- **To keep one of your own walk lists running,** unarchive it on the web first, and the command skips
  it.
- **Tell the customers it lists before you run it,** especially those knocked in the last 2 days: their
  canvassers lose those books the next morning, and the customer can unarchive to bring them back.
- The same command also fixes any walk list left with two live passes (an old state the app can no
  longer create): it keeps the one started most recently.
- **Run it outside field hours.**

## Also fixed on the way

- **Walk lists and passes on an archived campaign can no longer be changed,** including renaming and
  deleting. Today you can still claim doors, create passes and activate them there.
- **"Undo last discard" on Turf Cutting** could restore a different pass's books after you switched
  passes. It now belongs to the pass it was made on.
- **Turf Cutting failures say what went wrong.** Several buttons (Accept, Merge, rename, deleting a
  snapshot, Remove apartments, assigning) used to fail silently.
- **A late knock no longer moves a door's "last visit" backwards** when someone visited it more
  recently, and teammates' phones still pick up the change.

## What doesn't change

- Archiving never deletes anything: no knocks, answers, notes, books, assignments or snapshots.
- Starting the next pass still ends the walk list's current one, without waiting and with no undo (the
  new pass is live).
- Deleting a walk list or a pass on a live campaign follows today's rules.
- Doorline's bill is a flat price per campaign; nothing here changes it.

## What you'll do after it's built

1. Deploy the server (Heroku, from `main`). Old phones keep working.
2. In the Heroku dashboard, **More → Run console**, run `npm run repair:archived-walk-lists` and read
   the list.
   - Unarchive on the web any of your own walk lists you want to keep running.
   - Tell the customers it lists.
   - Then, outside field hours: `npm run repair:archived-walk-lists -- --apply`. If it reports a
     walk list it couldn't change because someone was working on it, run it again.
3. Same console: `npm run migrate:build-indexes`. It should list one missing index,
   `one_live_pass_per_walk_list`. If it lists anything else, stop and ask before going on. Then
   `npm run migrate:build-indexes -- --apply`.
4. Publish the phone update to staging and do the airplane-mode check (§K step 8), then publish to
   production.

---

# Part 2 — Technical reference

## A. What the design rests on (checked at `44bb72d`)

**Walk-list archive is a label today.** `POST /admin/campaigns/:campaignId/efforts/:id/archive`
([efforts.js:485-493](../server/src/routes/admin/efforts.js#L485-L493)) sets `Effort.status =
'archived'` and nothing else. In the whole server, only
[setupStatus.js:65](../server/src/routes/admin/setupStatus.js#L65) reads `Effort.status`. In the
clients, only [passPicker.js:37](../client/src/lib/passPicker.js#L37),
[EffortsPage.jsx:301,323](../client/src/pages/EffortsPage.jsx#L301) and
[CampaignSurveyPage.jsx:352-353](../client/src/pages/CampaignSurveyPage.jsx#L352-L353) read it; the
phone never does. There is no unarchive route; `PATCH /efforts/:id` ignores `status`.

**What a phone gets is decided by `Pass.status` alone.**
[activePasses.js:6-15](../server/src/services/passes/activePasses.js#L6-L15) returns passes with
`status: 'active'`; `canvasserBooks` ([bootstrap.js:175-193](../server/src/routes/mobile/bootstrap.js#L175-L193))
and the door scope read only those. Verified on a throwaway mongod (2026-10-27): after archiving a walk
list mid-round, its book was still in the canvasser's bootstrap, and a lit drop saved afterwards was
stamped with the live pass and the walk list.

**Phones notice a changed set of live passes within one poll.**

- `GET /mobile/changes` returns `activePassIds`
  ([bootstrap.js:583-587](../server/src/routes/mobile/bootstrap.js#L583-L587)), and finds changed doors
  by `updatedAt` (:494-499).
- The map polls every 30 s while it is in front ([map.jsx:544-562](../mobile/app/(app)/map.jsx#L544-L562))
  and refetches the bootstrap when the set differs ([map.jsx:628-636](../mobile/app/(app)/map.jsx#L628-L636)).
- `focusManager` follows `AppState` ([_layout.jsx:174-222](../mobile/app/_layout.jsx#L174-L222)), so the
  poll pauses in the background; `refetchOnWindowFocus` is off (:163), so an open survey keeps its
  door.
- **When a pass ends:**
  - with no doors left, the map shows *No turf assigned yet* ([map.jsx:872-884](../mobile/app/(app)/map.jsx#L872-L884));
  - with books on another walk list it sends the canvasser to the books list (:405-421);
  - the saved selection survives, so books brought back reappear on the next refresh.
- **A cold start with no signal** serves the saved bootstrap, old book ids included (bootstrapQuery.js),
  and never moves a canvasser off their selected book (map.jsx:415).

**Ending a pass touches only the Pass.**

- `POST /passes/:id/archive` ([passes.js:168-196](../server/src/routes/admin/passes.js#L168-L196))
  and activation's sibling archive ([passes.js:152-160](../server/src/routes/admin/passes.js#L152-L160))
  set `status` and `archivedAt`.
- Books stay `published`; `TurfAssignment`s, snapshots and the ledger are untouched.
- No nightly job purges archived-pass data
  ([scheduler.js:91-130](../server/src/services/retention/scheduler.js#L91-L130)), and snapshots are
  swept only when their Pass is gone
  ([snapshotRetention.js:31-39](../server/src/services/turf/snapshotRetention.js#L31-L39)).
- **Two timestamp facts drive B.5:**
  - activation stamps the old pass's `archivedAt` and the new pass's first `activatedAt` from the
    **same** `now` (:152-160; the same millisecond in review round 2);
  - `activatedAt` is set only on a pass's first activation and survives a discard (:160;
    [turfs.js:504-508](../server/src/routes/admin/turfs.js#L504-L508)).
- **Discard** reads the pass's status before it takes the recut lock and reverts with that stale value
  (turfs.js:398-400, :431, :504-508).

**Attribution is decided at save time, from the door.**

- `resolveAttribution` ([canvass.js:356-365](../server/src/routes/mobile/canvass.js#L356-L365))
  stamps the published book on a live pass that holds the door, else `passId: null`.
- The phone sends a tap `timestamp` ([recordAction.js:415-418](../mobile/lib/recordAction.js#L415-L418)),
  which attribution ignores today. Every door in its bootstrap carries `turfId`, the canvasser's own book
  ([bootstrap.js:363-370](../server/src/routes/mobile/bootstrap.js#L363-L370)), and `/changes` never
  overwrites it.
- All three body schemas are non-strict `z.object`s
  ([canvass.js:205-210, 818, 1149](../server/src/routes/mobile/canvass.js#L205-L210)), so a server without
  this change strips an unknown `turfId` silently.
- Inside the attributed pass everything keys on the same `passId`: the replaceable-row read, the
  deleteMany, the SurveyResponse filter, `supersededByNewer`, `healDuplicateDelivery`, the
  `Campaign.stats` deltas and per-round status. Rounds 1 and 2 verified this on throwaway mongods,
  including an archived pass. No route moves a book to another pass; restore, generate, split and
  supplemental mint new book ids.
- `Household.lastActionAt`/`lastActionBy` are overwritten unconditionally by a knock (:532-533) and a
  survey (:1093-1094); only `healDuplicateDelivery` keeps the later time (:344). `household.save()` writes
  nothing, and leaves `updatedAt` alone, when no field changed.
- The phone's optimistic overlay holds a door's recorded status for up to 5 minutes
  ([recordAction.js:123-151](../mobile/lib/recordAction.js#L123-L151)), keyed by door only.

**Where "archived" is treated as permanent** (F-numbers used below):

- **F1:** `roundClearedSince` ([answerEditRuns.js:270-296](../server/src/services/canvass/answerEditRuns.js#L270-L296))
  skips archived rounds (`status: { $ne: 'archived' }`, :289), on the premise that their cleared
  snapshot can never come back.
- **F2:** queued TURF jobs never re-check status. This covers `generateTurf`
  ([generateTurf.js:161-168](../server/src/services/turf/generateTurf.js#L161-L168)), which takes no recut
  lock, `addSupplementalBooks` (:342-348) and `executeClaim`
  ([claimDoors.js:138-153](../server/src/services/walklist/claimDoors.js#L138-L153)). TURF jobs retry 3
  times with backoff ([queues/index.js:47-48](../server/src/queues/index.js#L47-L48)).
- **F3:** `executeClaim` never checks the target walk list's status. It shrinks, locks and snapshots
  books of archived donor passes (:174-188); that part is correct and stays.
- **F5:** `strictQuery` is on ([config/db.js:26](../server/src/config/db.js#L26)), so every new field
  must be declared.
- **F7:** pin re-hulls skip archived passes
  ([rehullAfterPinMove.js:45-48](../server/src/services/turf/rehullAfterPinMove.js#L45-L48)), and import
  pin placement logs no `HouseholdLocationChange`
  ([placeStackedPins.js:646-660](../server/src/services/households/placeStackedPins.js#L646-L660)).

**Write paths with no status check today.**

- **Routes that refuse an archived pass:**
  - `add-supplemental`: 400, no code ([turfs.js:339-341](../server/src/routes/admin/turfs.js#L339-L341));
  - `discard`: 409, no code (:400);
  - `restrict-doors`: 409 `pass-archived` (:1226-1231);
  - `move-doors`: 409 `pass-archived` (:1712-1717).
- **Everything else succeeds on an archived pass,** including:
  - `restrict-bulk` (:1090-1136);
  - `assign-bulk` with Replace (:144-146);
  - `restore-snapshot` (:546-603);
  - generate, accept, rename, merge, split and the assignment routes;
  - `move-door`, whose `from` book isn't tied to the target's pass (:1647-1653).
- **`efforts.js` and `passes.js` have no `requireActiveCampaign`.**

**Reusable pieces:**

- `assertCampaignWritable`/`requireActiveCampaign`: 409, never 403
  ([campaignWritable.js:19-23](../server/src/middleware/campaignWritable.js#L19-L23)). The phone's `api()`
  turns a 409 into the server's message ([api.js:107-160](../mobile/lib/api.js#L107-L160)).
- The recut lock's compare-and-set ([recutLock.js](../server/src/services/turf/recutLock.js)).
- `recomputePassTerritories(passId, { withCentroid: true })`.
- `CampaignChange` + the History feed, rendered by
  [CampaignHistoryDrawer.jsx](../client/src/components/CampaignHistoryDrawer.jsx) and
  [admin/history.jsx](../mobile/app/(app)/admin/history.jsx), with `answerEditSentence` as the model for
  sentence rows ([campaignHistory.js:136](../client/src/lib/campaignHistory.js#L136)).
- [useRoundOptions.js](../client/src/lib/useRoundOptions.js), the existing owner of "walk list · Pass N"
  labels.
- `DoorSelectionBar`'s `readOnly`/`readOnlyReason`.
- The shared `Modal` and `Button variant="danger"`.

## B. The rules (one model)

### B.1 States

| Thing | States | Stored as |
|---|---|---|
| Walk list | **open** (live, setting up, between passes) · **archived** | `Effort.status` `'active'` / `'archived'` (`'draft'` stays unused) |
| Pass | **draft** · **live** · **archived** | `Pass.status` `'draft'` / `'active'` / `'archived'` |

**Invariant: a pass of an archived walk list is never live.** Its drafts stay drafts, frozen by the
walk-list guard (B.8). "Is this pass live?" stays `Pass.status === 'active'` everywhere. The only
exception is walk lists archived before this change, until the one-time repair runs (C.11).

### B.2 Archive a walk list

Under the walk list's **lifecycle lock** (C.2):

1. **Refusals:**
   - the campaign is archived or being deleted (409, `requireActiveCampaign`);
   - the walk list is already archived with no live pass (409 `already-archived`). With a live pass
     (an archive from before this change) the call finishes the job; the amber row's **End Pass 3**
     uses this.
2. **Confirm gate.** With a live pass the call needs `confirmArchive: true`, else a bare 409
   `archive-confirm-required`. The stakes come from `GET …/archive-preview` only. The web dialog always
   sends the flag: after the typed confirm when a pass is live, from the plain button otherwise.
3. **Lock.** Take the live pass's recut lock (409 `recut-locked` if a book operation holds it; nothing
   changes).
4. **Record first.** Set `Effort.endedPassId` = the live pass. The walk list is still open; the field
   is read only while archived.
5. **End the live pass:** `status: 'archived'`, `archivedAt`, `archivedFrom: 'active'`,
   `archivedVia: 'walk-list'`, `archivedBy`.
6. **Archive the walk list:** `status: 'archived'`, `archivedAt`, `archivedBy`.
7. **Finish:** one History row; release the locks.

- **A crash between steps 5 and 6** leaves an open walk list with an ended pass. Its own Bring back
  works. Archive again finds no live pass, keeps `endedPassId`, and archives.
- **Not touched:** drafts, `Household.effortId` (doors stay), books, assignments, roster
  (`EffortMember`), snapshots, the ledger.

### B.3 Unarchive a walk list (`bringBack: true | false`)

Under the lifecycle lock:

1. **Refusals:** the campaign is archived or being deleted, or the walk list isn't archived (409
   `not-archived`).
2. **Check before changing anything.** With `bringBack: true`, run
   `canBringBack(endedPass, { viaUnarchive: true })`.
   - **A permanent refusal** (B.5 rules 1-8): 409 with the reason, and nothing changes. The dialog then
     offers a single **Unarchive**.
   - **A temporary one** (`recut-locked`): 409, and the dialog says *try again in a minute*.
3. **Reopen the walk list first:** `status: 'active'`; `archivedAt`/`archivedBy` cleared (History keeps
   them).
4. **Then bring the pass back** when asked. This runs B.5's internal step under the lock already held,
   with no History row of its own.
5. **Then clear `endedPassId`.**
6. **Finish:** one History row.

**Why this order.** A crash after step 3 leaves an open walk list with an ended pass, which its own
Bring back fixes; never an archived walk list with a live pass. If step 4 fails after step 3, the answer
says *North is unarchived, but Pass 3 couldn't come back: <reason>.*

### B.4 Archive a pass

As today ([passes.js:168-196](../server/src/routes/admin/passes.js#L168-L196)), plus, under the
lifecycle lock:

- **New refusals:**
  - an archived campaign (`requireActiveCampaign`);
  - an archived walk list (409 `walk-list-archived`);
  - an already-archived pass (409 `already-archived`; today it overwrites `archivedAt`).
- **Lock:** it takes the pass's recut lock (409 `recut-locked`, as delete does).
- **Writes:** `archivedFrom`, `archivedVia: 'pass'`, `archivedBy` and a History row.

### B.5 Bring back a pass

`canBringBack(pass, { viaUnarchive = false })` returns `{ ok, to, reason, laterPass, books,
canvassers, downgraded }`:

| # | Rule | Refusal `reason` |
|---|---|---|
| 1 | `pass.status === 'archived'` and `archivedAt` set | `not-archived` / `unknown-end` |
| 2 | Campaign writable (not archived, not being deleted) | `campaign-archived` |
| 3 | Its walk list exists; if archived, only through Unarchive | `walk-list-archived` |
| 4a | `archivedVia !== 'next-pass'` | `ended-by-next-pass` (`laterPass` names it, if it still exists) |
| 4b | If `to === 'active'`: no other pass of the walk list was last live at or after `pass.archivedAt` | `later-pass-went-live` (`laterPass` names it) |
| 5 | `to = archivedFrom ?? (activatedAt ? 'active' : 'draft')`, decided before 4b | — |
| 6 | If `to === 'active'`: no other live pass in the walk list | `another-pass-live` |
| 7 | If `to === 'active'` on a survey campaign: the campaign has a survey | `survey-required` |
| 8 | If `to === 'active'` and no published book has doors: `to = 'draft'`, `downgraded: 'no-doors'` | — |
| 9 | The pass's recut lock is free | `recut-locked` (temporary) |

**Rule 4b, "last live at".** A sibling's last-live time is:

- `lastActivatedAt` when set (stamped by every activation and every bring-back to live);
- for a sibling from before this change with `activatedAt` set: now if it is live, else its `archivedAt`
  (or its `activatedAt` when it was never archived);
- nothing, for a sibling that never went live.

**Why each piece is needed:**

- **`>=`, not `>`.** Activation stamps the ended pass's `archivedAt` and the new pass's activation from
  the same `now`.
- **`lastActivatedAt`.** `activatedAt` is first-activation-only, so a re-activated pass needs its own
  stamp.
- **The pre-change fallback.** A pass that was discarded and re-activated before this change still
  blocks the pass it ended. Review round 2 reproduced that case passing without it. The cost is
  over-refusing a few pre-change draft cases.
- **4a.** It makes "ended by the next pass" permanent even if that next pass is later discarded and
  deleted.
- **4b applies only when coming back live.** A draft coming back as a draft conflicts with nothing.
  Without that limit, undoing a walk-list archive would wrongly revoke an archived draft's Bring back
  (reproduced in round 2).

**Labels.** `endedByPassId` (stamped by B.6) gives *when Pass N went live* and the refusal's name. For
older rows the same label is inferred from a pass whose `activatedAt` equals this pass's `archivedAt`.
A deleted pass reads *when the next pass went live*.

**`bringBackPass`**, called through the export (lifecycle lock taken once, C.2):

1. takes the pass's recut lock and re-checks every rule;
2. makes one conditional update, `{ _id, status: 'archived' }` to `to`:
   - clears `archivedAt`, `archivedFrom`, `archivedVia`, `archivedBy` and `endedByPassId`;
   - sets `lastActivatedAt = now` when `to === 'active'`;
   - a duplicate-key error on the index (C.12) becomes 409 `another-pass-live`;
3. **redraws the pass's book outlines, best-effort:**
   - `recomputePassTerritories(passId, { withCentroid: true })` inside try/catch, when its booked doors
     are at most `TURF_BRING_BACK_REHULL_MAX_DOORS` (default 20,000; measured 2.0 s at 16,000 doors and
     7.4 s at 60,000 on a laptop);
   - above that it logs, and the existing `npm run recompute:territories -- --apply` heals it;
   - it runs always, because §A F7 leaves nothing to detect a moved pin by;
4. writes one History row (unless called by B.3) and releases the locks.

`activatedAt` is never touched.

**What comes back.** Assignments come back as they were:

- anyone removed from the campaign since has already lost theirs (`releaseAssignedWork` deletes them on
  passes of any status, [deleteAccount.js:888-931](../server/src/services/users/deleteAccount.js#L888-L931));
- anyone deactivated keeps theirs, exactly as on a live pass, and Turf Cutting's existing "books nobody
  on the roster can open" warning names them.

### B.6 Activate

The activation logic moves into the same service, under the lifecycle lock. Changes:

- it refuses an archived walk list (409 `walk-list-archived`);
- it refuses an archived pass with *This pass is archived — use Bring back.* (today: *…create a new
  pass*, [passes.js:142](../server/src/routes/admin/passes.js#L142));
- it stamps the pass it ends with `archivedFrom: 'active'`, `archivedVia: 'next-pass'`, `archivedBy` and
  `endedByPassId`, through a conditional update (`{ _id, status: 'active' }`);
- it stamps `lastActivatedAt` on the pass it activates (and `activatedAt` once, as today);
- it turns a duplicate-key error on the index into 409 `another-pass-live`.

It **doesn't take the ended pass's recut lock.** Starting the next pass never waits, as today, even
while a claim or supplemental job runs on the old pass; those jobs keep working on an archived donor
(F3). It writes **no** History row: routine, and it would crowd the feed's 200-row cap.

### B.7 Late-knock attribution

`resolveAttribution(campaign, household, { clientTurfId, tappedAt })` moves to
`server/src/services/canvass/attribution.js`. It decides in two steps.

**Step 1: the book the phone says it was in.** It runs when the switch is on and `clientTurfId` is a
valid id: `typeof v === 'string' && mongoose.isObjectIdOrHexString(v)`, as in tokens.js:88. Round 2
reproduced `isValidObjectId` letting a number or object through to a 500 CastError, which stalls the
phone's queue.

1. Find `Turf { _id, campaignId, status: 'published', householdIds: household._id }`.
2. Its Pass must have `effortId === household.effortId`.
3. If that pass is **live**, use that book.
4. If that pass is **archived**, use it only when the knock was made while it was live (`tappedAt <=
   pass.archivedAt`), **or** when no live book holds the door. Otherwise fall to step 2 (ruling 9: a
   dead-zone canvasser working yesterday's book after Pass 4 started counts in Pass 4 when Pass 4
   holds the door).

**Step 2: today's rule.** The live book that holds the door, else `passId: null`.

`tappedAt` is the body's `timestamp` (the tap time the row already stores), else the server's now.
The phone clock is trusted here exactly as it already is for the row's own timestamp. A clock a few
minutes off only moves knocks made around the switch.

**Not used: a server-side fallback for phones without the update.** v1's "the walk list's most recently
archived pass" fallback was removed in round 1. It was reproduced filing a discarded pass's late knocks
into the previous pass, where the replace deleted or overwrote that pass's real answers. Step 1 can't
do that: a discarded or re-cut pass's books are gone, so step 2 gives today's null. A book absorbed by a
merge, or split away, also falls to step 2 (null when nothing live holds the door).

- **A phone without the update** sends no `turfId` and gets exactly today's rule.
- **An invalid `turfId`** is **ignored, never refused**. The offline queue deletes an item on any 4xx
  ([offlineQueue.js:131-135](../mobile/lib/offlineQueue.js#L131-L135)).
- **The switch** is `LATE_KNOCK_ATTRIBUTION`, read at call time. `String(v || '').trim().toLowerCase()
  === 'off'` turns step 1 off (house pattern,
  [buildStatus.js:65-66](../server/src/routes/public/buildStatus.js#L65-L66)); anything else, including
  unset, means on.
- **What a flip leaves behind.** Saved knocks keep their pass. A retry that straddles a flip can land in
  a different pass than its first delivery and isn't deduplicated (the duplicate check is per pass).
  *As built (code review round 2, §O.6): a retry is recognized as the same tap in any pass, so it is.*
  So the advice is: flip outside field hours, but in an emergency flip anyway; phones queue through a
  restart, because server errors are retried (offlineQueue.js:207).

### B.8 Read-only walk list, view-only pass

| | Refused (409) | Still allowed |
|---|---|---|
| **Archived walk list** (`walk-list-archived`) | claim **into** it, roster add/remove, survey override change, new pass, rename/delete/activate a pass, bring back (except through Unarchive), every book write on its passes (drafts included), desk marks on its doors | renaming the walk list; claims **out of** it (re-carves); deleting a snapshot; unmarking a desk mark; Door Outcomes; flag review; notes; exports; reads |
| **Archived pass** (`pass-archived`) | generate, accept, rename book, delete book, merge, split, move-door, move-doors, restrict-bulk, restrict-doors, add-supplemental, discard (all scopes), restore-snapshot, exclude/include apartments, assign, unassign, assign-bulk, unassign-bulk | deleting a snapshot (it changes no book, and it clears a C.7 hold); unrestrict-bulk and unrestrict-doors (a correction of the office's own marks, by design, [turfs.js:1267-1272](../server/src/routes/admin/turfs.js#L1267-L1272)); reads |
| **Archived campaign** (`campaign-archived`) | everything above on every walk list and pass, plus renaming and deleting walk lists, via `requireActiveCampaign` on the efforts and passes routers | deleting a snapshot (`DELETE /turfs/snapshots/:id` joins campaignWritable.js's "NOT blocked" list beside flag review, so a C.7 hold always has a way out without Reactivate, which back-bills); the campaign PATCH (rename, reactivate); reads; exports |

**Error bodies** follow `campaignWritable.js`: `{ error, code }`, with the message naming the thing and
the way out. For example: *Pass 3 is archived — bring it back to change it.* and *Walk list "North" is
archived — unarchive it to change it.*

### B.9 Delete a walk list

**Unchanged on a live campaign:** it is refused when any pass's status isn't `draft`, or the ledger
references the walk list ([efforts.js:497-536](../server/src/routes/admin/efforts.js#L497-L536)).
Because drafts stay drafts (B.2), an archived walk list that never went live can still be deleted. The
web shows **Delete** only when every pass is a draft (`canDelete` on `GET /efforts`, from the statuses
already loaded there).

## C. Server

### C.1 Model changes (all declared: `strictQuery`)

- **`Effort`:**
  - `archivedAt: Date|null`, `archivedBy: ObjectId|null`
  - `endedPassId: ObjectId|null` (the pass the current archive ended)
  - `lifecycleLock: { lockedAt: Date|null, token: String|null }`
- **`Pass`:**
  - `archivedFrom: 'active'|'draft'|null`
  - `archivedVia: 'pass'|'walk-list'|'next-pass'|'repair'|null`
  - `archivedBy: ObjectId|null`
  - `endedByPassId: ObjectId|null`
  - `lastActivatedAt: Date|null`
  - The header comment ([Pass.js:3-5](../server/src/models/Pass.js#L3-L5)) changes from "one-way" to
    "draft → active → archived, and back with Bring back (services/passes/passLifecycle.js)".
- **`CampaignChange`:**
  - `source` enum gains `'walk_list_lifecycle'` (server-only; the History route doesn't ship `source`);
  - a declared `details: Mixed` holds `{ walkList, pass, outcome }` for the sentence renderers (C.9).

### C.2 `server/src/services/passes/passLifecycle.js`: the ONE owner of status changes

**Exports:**

- `archiveWalkList`, `unarchiveWalkList`, `archivePass`, `bringBackPass`, `activatePass`;
- `canBringBack`;
- `couldComeBack`: rule 1, "the walk list exists", and rules 4a/4b, ignoring campaign state, walk-list
  archive and locks, all of which are transient;
- `archiveStakes`: the live pass, published books, distinct assigned canvassers, and knocks via
  `knocksPipeline({ campaignId }, { byPass: true })`, so the number matches the Passes panel; plus
  drafts and doors.

**The lifecycle lock.** Every export takes the walk list's lifecycle lock **once**: a compare-and-set on
`Effort.lifecycleLock`, with the recut lock's token and staleness rules. Each then calls unlocked
internal steps, and unarchive's bring-back is such a step. The lock is not re-entrant, so an export
calling another export would always lose to itself (round 2).

- **What it serializes:** archive, unarchive, archive-pass, bring-back, activation, and the
  walk-list and draft-pass deletes, across **all** passes of one walk list.
- **Why it's needed:** per-pass recut locks don't stop a bring-back of Pass 2 racing an archive of North,
  or a bring-back racing an activation, because those take different locks.
- **Busy** answers 409 `lifecycle-busy` (*Someone else is changing this walk list. Try again in a
  moment.*).
- **No deadlock:** every lock is try-once, and jobs never take this one.
- **A crashed holder** costs up to the staleness window of 409s.

**Who writes `Pass.status`.** Every route and the repair script call these exports. Nothing else writes
`Pass.status` except:

- `createNextPass` (creates drafts);
- the discard route (active → draft, now a conditional update, C.4);
- the demo seeder, which also stamps the new fields;
- the delete routes.

### C.3 Routes

All new ones sit under the existing routers, so `requireCampaignManager` decides who can use them
(ruling 6).

| Route | Body / answer |
|---|---|
| `GET …/efforts/:id/archive-preview` | `{ livePass: { _id, roundNumber, name, books, canvassers, knocks } \| null, drafts, doors }` |
| `POST …/efforts/:id/archive` | `{ confirmArchive }` → `{ effort, endedPassId }` (as built, plus `endedPass`, the ended pass named: §O.6); 409s per B.2 |
| `GET …/efforts/:id/unarchive-preview` | `{ endedPass: { _id, roundNumber, name, archivedAt, archivedVia, archivedByName, bringBack } \| null }` |
| `POST …/efforts/:id/unarchive` | `{ bringBack }` → `{ effort, broughtBack: passId \| null, to }`; 409s per B.3 |
| `POST …/passes/:id/bring-back` | → `{ pass, to, downgraded? }`; 409 with `reason` per B.5 |
| `GET …/efforts` | adds per walk list `archivedAt`, `archivedByName`, `endedPassId`, `canDelete`, `lastEndedPass: { _id, roundNumber, name, archivedAt, archivedVia }` |
| `GET …/passes` | adds per pass `archivedVia`, `archivedByName`, `endedByPassName` (stamped or inferred), and for archived passes `bringBack` (B.5's full answer: `books` counts books that have doors, `canvassers` comes from one `TurfAssignment` aggregate over archived passes) |

- **Names** are resolved through `hydrateCanvassers`, as History does, so a deleted account shows as its
  tombstone.
- **`activeRound` and `setup`** are computed as today. `activeRound` is the live pass, which an archived
  walk list has only before the repair (the amber state). The page ignores `setup` for archived walk
  lists.

### C.4 Guards

- **Where they live.** `assertWalkListWritable(res, effort)` and `assertPassWritable(res, pass,
  effort)` go in [campaignWritable.js](../server/src/middleware/campaignWritable.js), beside
  `assertCampaignWritable` (same 409 contract), called in the handlers B.8 lists. `assertPassWritable`
  refuses when the pass is archived **or** its walk list is archived, which covers drafts.
- **Turf-scoped routes** (rename, delete, merge, split, move-door, the assignment routes) load the pass
  from `turf.passId`. `move-door` also requires `from.passId === to.passId` (today its `from` book is
  unconstrained, turfs.js:1647-1653).
- **Every recut-lock holder re-reads the pass after taking the lock** and runs `assertPassWritable`
  again. This covers discard, restore, snapshot delete and the walk-list/pass deletes. Discard's revert
  becomes `updateOne({ _id, status: 'active' }, { $set: { status: 'draft' } })`. Round 2 reproduced the
  stale revert turning a just-archived pass back into a draft.
- **`requireActiveCampaign()`** is mounted on the efforts and passes routers, after `loadCampaign`.
  `DELETE /turfs/snapshots/:id` is exempted from it on the turfs router (B.8).
- **Error codes:** `add-supplemental` (400, no code) and `discard` (409, no code) move to 409
  `pass-archived`.
- **The "one-way" comment** at [passes.js:172](../server/src/routes/admin/passes.js#L172) goes.

### C.5 Jobs

- **`generateTurf` and `addSupplementalBooks`** re-check the pass, its walk list and the campaign at start
  and right before their book insert. A refusal throws BullMQ's `UnrecoverableError` (the
  importProcessor.js precedent), so the job fails at once instead of retrying three times, and the Turf
  page's job line shows the guard's message.
- **`generateTurf` also re-checks right after its insert,** because it takes no lock. If an archive
  landed in between, it deletes the books **it created that are still `draft`**, and their Household
  mirror, then fails the same way. An Accept landing during the mirror loop is never undone.
- **A run killed mid-insert** and then redelivered fails at its start check and can leave its drafts
  behind. They're harmless: they're on an archived pass, never reach a phone, and the pass is view-only.
- **`executeClaim`** re-checks that the **target** walk list is open and the campaign writable. Donor
  passes keep today's behavior (F3).
- **The generate route** gets the pass guard (today it checks existence only,
  [turfs.js:227-266](../server/src/routes/admin/turfs.js#L227-L266)).

### C.6 Attribution and last visit

**Attribution.** B.7 lands in `services/canvass/attribution.js`. Callers:

- `recordHouseholdAction` ([canvass.js:446](../server/src/routes/mobile/canvass.js#L446)) and the survey
  route ([canvass.js:889](../server/src/routes/mobile/canvass.js#L889)) pass `clientTurfId` from the raw
  body (`req.body?.turfId`, read before zod, like `missingLocation`) and `tappedAt`;
- the walk-up voter add ([canvass.js:1202](../server/src/routes/mobile/canvass.js#L1202)) passes the same
  for its per-round stamp.

**Pointers.** The ones naming the old location are updated: efforts.js:515, surveyConversion.js:370,
repairOrphanAttribution.js:3, and the docs in §I.

**The response wire stays as today:** `toWireHousehold` answers for the attributed pass.

- The only reader is the online path ([recordAction.js:422](../mobile/lib/recordAction.js#L422)), whose
  phone still shows the book it tapped in.
- Offline flushes read only `pace` ([offlineQueue.js:105-114](../mobile/lib/offlineQueue.js#L105-L114)).

**Last visit.**

- `Household.lastActionAt`/`lastActionBy` move only forward (the later of stored and new) in the knock
  route ([canvass.js:532-533](../server/src/routes/mobile/canvass.js#L532-L533)) and the survey route
  (:1093-1094), as `healDuplicateDelivery` already does (:344).
- The write **always bumps `updatedAt`** (`household.markModified('lastActionAt')` before the save, which
  keeps the later value), so `/changes` still ships the door to teammates. Without it, an older replayed
  survey that completes the door this round reached no teammate's phone (round 2, reproduced; it
  matches the rule written in deskRestrict.js:153-157).
- Unknock's settle and the nightly reconcile already take the later time.

### C.7 The Door Outcomes undo guard (F1)

`roundClearedSince` loads each candidate pass without the `status` filter and skips it only when
`status === 'archived' && !couldComeBack(pass)`. A round that can still come back holds the undo, as an
open round does today. That includes:

- a pass on an archived walk list (Unarchive is transient), and
- a pass on an archived campaign (Reactivate is transient).

A pass ended by the next pass going live can't come back (rule 4a), so it is skipped exactly as today.

`roundClearedRefusal` gains a variant for an archived round that names the ways out:

> …Pass 3 (archived) was cleared on Oct 20, and that snapshot could still come back with it. Delete that
> snapshot on Turf Cutting (Undo / snapshots), or bring Pass 3 back (unarchive North first) and restore
> it, then undo.

Deleting the snapshot is allowed on an archived pass, an archived walk list and an archived campaign
(B.8), so the owner never has to put a finished round back on phones, or reactivate a campaign, just to
clear the hold.

### C.8 Desk marks

- **`currentDeskPassForDoor`** ([deskRestrict.js:209-215](../server/src/services/canvass/deskRestrict.js#L209-L215))
  returns `{ passId: null, reason: 'walk-list-archived' }` for a door whose walk list is archived. Its
  single draft must not take a mark.
- **`resolveDeskPassForDoors`**:
  - carries that distinct reason, never `'no-round'`;
  - for an explicit `passId`, also checks the pass's walk list, so a frozen draft is refused
    (:228-241).
- **`restrict-doors` and `restrict-bulk`** map it to **409 `walk-list-archived`** with the walk list's
  name, **before** the `PASS_REQUIRED` branch (turfs.js:1232-1234). Old phones turn a non-intake
  `PASS_REQUIRED` into *no current round — open the door from its book*
  ([restrictBooks.js:249-253](../mobile/lib/restrictBooks.js#L249-L253)).

### C.9 History

`passLifecycle.js` writes `CampaignChange` rows with `source: 'walk_list_lifecycle'`.

- **For old phones:** `fromValue`/`toValue` are readable strings, so a phone without the update reads
  sensibly through the label fallback.
- **For the new renderers:** `details` carries the structured facts, so sentences are built from fixed
  templates, never by splitting names (walk list and pass names are free text).

| `field` | `fromValue` | `toValue` | `details.outcome` |
|---|---|---|---|
| `walkListArchived` | "North · live (Pass 3 · GOTV)" | "North · archived · Pass 3 · GOTV ended" | `ended` / `nothing-live` |
| `walkListUnarchived` | "North · archived" | "North · open · Pass 3 · GOTV brought back" / "… stayed ended" | `brought-back` / `stayed-ended` |
| `passArchived` | "North · Pass 3 · GOTV · live" | "North · Pass 3 · GOTV · archived" (+ " (one-time check)") | `by-hand` / `repair` |
| `passBroughtBack` | "North · Pass 3 · GOTV · archived" | "North · Pass 3 · GOTV · live again" / "… · back as a draft" | `live` / `draft` |

- **The repair** writes `passArchived` with `outcome: 'repair'` and `byUserId: null`.
- **The History route** gives actorless `walk_list_lifecycle` rows `by: { id: null, name: 'One-time
  check' }` (no `status`: a shipped phone appends any status but `active` to the name), so every phone,
  including one without the update, names *One-time check*, never *Unknown user* ([campaigns.js:485-486](../server/src/routes/admin/campaigns.js#L485-L486);
  [mobile/lib/campaignHistory.js:143-147](../mobile/lib/campaignHistory.js#L143-L147)).
- **The route ships `details`** additively on those rows.
- **Web and phone** gain `walkListSentence(item)` beside `answerEditSentence`.

### C.10 Setup status

No server change. The client reads the existing `steps` and `hasCanvassed` (D.5).

### C.11 The one-time repair

`server/src/migrations/repairArchivedWalkLists.js`:

- server script `repair:archived-walk-lists`;
- root proxy `"repair:archived-walk-lists": "npm --prefix server run repair:archived-walk-lists --"`;
- options `[--campaign <id>] [--apply]`.

**The dry run** prints per organization (internal ones first, then customers), per campaign (archived
ones flagged):

- **archived walk lists with a live pass:**
  - the walk list and pass names;
  - counts of published books and assigned canvassers;
  - the last knock's date;
  - *knocked in the last 2 days* when true;
- **walk lists of any kind with two or more live passes** (an old state the app can't create);
- **the count of live passes with no walk list.** The index's partial filter excludes them (C.12).

**It prints counts, never canvassers' names.** It runs in the staff console across customer
organizations, outside any support-access grant, so no personal data is shown (§J).

**`--apply` (ruling 10: every listed pass, customers' included):**

- **On every archived walk list,** in any campaign state, it ends every live pass: `archivedVia:
  'repair'`, `archivedBy: null`, `archivedFrom: 'active'`. `endedPassId` = the one last activated, so
  Unarchive offers it back.
- **On every open walk list with two or more live passes,** it keeps the one last activated and ends the
  rest the same way.
- **It bypasses the archived-campaign refusal,** so a later Reactivate can't revive the bug.
- **It keeps each walk list's own archive date.** Walk lists archived before this change have none, and
  the row reads *Archived · Pass 1 ended by the one-time check*.
- **It skips** a pass whose recut lock or lifecycle lock is held, and reports it, so the owner re-runs.
- **It writes** a `passArchived` History row per ended pass, with outcome `repair`.
- **It is idempotent.**

It is run from the repo root before hand-over.

### C.12 One live pass per walk list, enforced

```js
passSchema.index(
  { status: 1, effortId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active', effortId: { $type: 'objectId' } },
    name: 'one_live_pass_per_walk_list',
  }
);
```

- **Why this key.**
  - `{ effortId: 1 }` can't be used: `Pass.effortId` already has `index: true`, and
    `migrate:build-indexes` decides "missing" by key pattern alone
    ([buildIndexes.js:52-53](../server/src/migrations/buildIndexes.js#L52-L53)), so its dry run would
    never list it. The repo warns about this trap at Household.js:216 and SurveyResponseArchive.js:142.
  - `{ status: 1, effortId: 1 }` is a new pattern (the existing one is `{ effortId: 1, status: 1 }`).
  - The `$type` filter keeps live passes with no walk list (pre-Effort data) from colliding on null.
    Round 2 reproduced that collision blocking the build.
- **How it gets built.** Production has autoIndex off, so it is built with
  `npm run migrate:build-indexes -- --apply` after the repair. Until then the code behaves as today; the
  duplicate-key branch never fires. Round 2 ran the real build: the dry run lists it, `--apply` builds
  it, and a duplicate prints "✗ Pass: …E11000…" while every other model still builds.
- **Why it's still worth having.** It is defense in depth for writers outside `passLifecycle` (the seeder,
  migrations) and for `activePassIdForEffort`'s arbitrary `findOne`
  ([activePasses.js:12-15](../server/src/services/passes/activePasses.js#L12-L15)).
- **Tests.** Autoindex races the fixtures in tests and fails silently on duplicates (db.js:27-31). So
  the index is built in [testIndexPreload.mjs](../server/scripts/testIndexPreload.mjs), after connect and
  after every drop, with the same spec and name.
  - Forced that way, **nine suites** fail today: exportBuilders, campaignHomeCrewFilter,
    answerEditFollowup, answerEditRound8, answerEditRound9, duplicateSurveys, mapCounts,
    perCanvasserAndOverlaps and surveyConversion (103 tests).
  - Most create "the next round" as `active` and become `archived` (or use `activatePass`).
  - **mapCounts and perCanvasserAndOverlaps assert behavior over two live rounds** and are restructured:
    their rounds move to two walk lists, or the earlier round is archived with the assertion rewritten.

## D. Web

### D.1 Walk Lists page ([EffortsPage.jsx](../client/src/pages/EffortsPage.jsx))

- **One Status cell** from a pure `walkListState(effort, passes)` in `client/src/lib/walkListState.js`,
  first match wins:
  1. **Archived · Pass N still live** (amber, with **Unarchive** and **End Pass N**): archived with a
     live pass, the state before the repair.
  2. **Archived** <date> by <name> · Pass N ended: archived, ended by archiving.
  3. **Archived** · Pass N ended by the one-time check: archived, ended by the repair.
  4. **Archived** <date> by <name>: archived with nothing ended.
  5. **Archived**: archived before this change, no date or name.
  6. **Live · Pass N**: open with a live pass.
  7. **Between passes** · Pass N ended <date> (+ *· Pass N+1 draft*): open, no live pass, and a pass
     has been live.
  8. **Setting up** · s/t · next: …: open, and no pass has ever been live.
  9. **No passes yet.**
- **Columns:** "Active pass" becomes **Pass**.
- **The archived section.** Archived walk lists render in a collapsed "Archived walk lists (N)" section
  below the table. Its open state is a per-viewer `localStorage` convenience, wrapped in try/catch. With
  none open: *No open walk lists — N archived below.*
- **Actions:**
  - open walk lists: **Manage · Archive · Delete**;
  - archived ones: **View · Unarchive · Delete**;
  - **Delete** only when `canDelete`.
- **Shared dialogs** in `client/src/components/walkListLifecycle/`: `ArchiveWalkListDialog`,
  `UnarchiveWalkListDialog`, `BringBackPassDialog` and `ArchivePassDialog`.
  - They are built on `Modal` with `Button variant="danger"` (no hard-coded colors).
  - They are used here, in PassManager, on PassesPage and on Turf Cutting.
  - A temporary refusal (`lifecycle-busy`, `recut-locked`) says *try again in a minute* and changes
    nothing; a permanent one says why.
  - On success, the inline *Undo* line renders **above** the table, because the row it's about has
    just moved into the closed archived section.
- **The drawer for an archived walk list:**
  - name field enabled;
  - survey select, Roster and Claim replaced by *Unarchive North to change this*;
  - PassManager read-only;
  - no "Cut / assign books →".
- **On an archived campaign** (`selected.isActive === false`):
  - the archived-campaign banner pattern ([CampaignTeamPage.jsx:272-288](../client/src/pages/CampaignTeamPage.jsx#L272-L288));
  - create, Archive, Unarchive, claim, rename (name field disabled), Delete and pass actions all off.
- **Stat cards:** open walk lists with hint "+N archived".
- **Errors** from archive, unarchive and delete render under the table.

### D.2 Passes panel and page ([PassManager.jsx](../client/src/components/PassManager.jsx), [PassesPage.jsx](../client/src/pages/PassesPage.jsx))

- **Archived rows** show *Archived · <date> [by <name>]* plus how it ended: *by hand*, *when <walk list>
  was archived*, *when Pass N went live* or *by the one-time check*. Then **Bring back** when
  `bringBack.ok`, or the reason line, e.g. *Pass 4 went live after this one ended*.
- **The archive dialog** moves onto `ArchivePassDialog` (today a hand-rolled overlay with `bg-red-600`,
  :366-407). Its copy depends on the pass:
  - **a live pass:** *Canvassers lose its books the next time their map refreshes. Knocks are kept. You
    can bring it back until a newer pass on this walk list goes live.*
  - **a draft with knocks:** *No canvasser has its books. Its knocks are kept. You can bring it back as a
    draft.*
  - The typed confirm rule is unchanged.
- **The intro text** (:269) loses "Passes are one-way".
- **`PassDetail` on an archived pass** says **View books →**, not "Cut / assign books →" or "No books cut
  yet. Cut books →" (:150, :158).
- **On an archived walk list:** no New pass, Activate, Archive, Delete or Bring back; a banner with
  **Unarchive North** (the dialog in place).
- **PassesPage's title** gets the walk list's status chip.

### D.3 Turf Cutting ([TurfsPage.jsx](../client/src/pages/TurfsPage.jsx))

- **The picker.** `groupPassesByEffortStatus` in [passPicker.js](../client/src/lib/passPicker.js) becomes
  `groupPassesByState`:
  - **Live:** status active, walk list open.
  - **Drafts:** status draft, walk list open.
  - **Archived:** status archived, or any pass of an archived walk list, with " · walk list archived" and
    " (draft)" where true.
  - Options come from `useRoundOptions`' label, *Walk list · Pass N · name*, which skips a name that
    only repeats "Pass N" (as admin/books.jsx:180 does). They are sorted by walk list name, then round
    number.
  - `pickDefaultPass` (the August ruling) is unchanged. Its test "the default is always inside the FIRST
    group" becomes "the default is never in Archived unless every pass is".
- **The header badge:** Live (exists) · Draft · *Archived · view only*.
- **`viewOnly`** = pass archived || walk list archived || campaign archived:
  - **one banner** at the top: the reason, plus **Bring back** / **Unarchive <walk list>** (dialogs in
    place) / **Open Pass N** (the walk list's live pass, if any) / the campaign message;
  - **not rendered:** the Generate panel, target and exclude panels, apartments, Accept, Delete drafts,
    Discard, the supplemental banner, renaming and Select doors;
  - **the popups** lose move, mark, unmark and Move pin;
  - **`BookAssignmentPanel`** renders read-only: holders listed; no assign, unassign, merge, move,
    restrict or print;
  - **snapshots** are listed with **Delete** only, with the note *Bring the pass back to restore a
    snapshot*, or *Unarchive <walk list> to restore a snapshot* for a draft of an archived walk list;
  - **the stat hints** use neutral wording (*12 books had no canvasser*).
- **Banners.** "Books accepted … activate the pass" (:3703-3715) shows only for drafts of an open walk
  list. The other to-do nudges (:3168-3170, :3631-3635, :3642-3650, :3699-3701, :3717-3737, :3776-3793,
  :3920-3922, and BookAssignmentPanel :351-354 and :457-473) are hidden in view-only.
- **The snapshot bug.** `lastSnapshotId` (:1641) becomes `{ passId, snapshotId }`, cleared in the
  pass-switch effect (:3111-3120). "Undo last discard" renders only when `lastSnapshot.passId ===
  passId`, through a small pure helper.
- **Silent failures.** Rename, Accept, Merge, snapshot delete, Remove/Re-include apartments,
  BookAssignmentPanel Assign/Unassign and Apply to N books render the server's `error`, on live passes
  too.
- **Stale pages.** A 409 `pass-archived`, `walk-list-archived`, `campaign-archived` or `lifecycle-busy`
  from any write refetches passes, walk lists and the campaign, so a page left open while someone else
  archived flips to view-only.
- **Move confirm wording.** EffortsPage's move-confirm line "restorable from its Turf page" (:126) adds
  *(bring an archived pass back first)* when a donor pass is archived.

### D.4 Every other picker

Two shared helpers:

- **`client/src/lib/walkListOptions.js`:** `walkListOptions(efforts)` returns open walk lists first in
  today's order, then archived ones marked "(archived)". It is mirrored byte-for-byte below the header
  in `mobile/lib/walkListOptions.js`, with a parity test as `byPassFold` has.
- **[useRoundOptions.js](../client/src/lib/useRoundOptions.js)** stays the single owner of round labels.
  It gains the archived marking and the walk-list filter.

| Surface (file) | Change |
|---|---|
| Campaign Home walk-list select and survey pass select ([DashboardPage.jsx](../client/src/pages/DashboardPage.jsx)) | `walkListOptions`; rounds via `useRoundOptions` |
| Map toolbar ([MapPage.jsx](../client/src/pages/MapPage.jsx)) | `walkListOptions`; the pass chip names its walk list |
| Timeline, Audit, Notes ([TimelinePage.jsx](../client/src/pages/TimelinePage.jsx), [AuditPage.jsx](../client/src/pages/AuditPage.jsx), [NotesPage.jsx](../client/src/pages/NotesPage.jsx)) | `walkListOptions` |
| Exports ([ExportsPage.jsx](../client/src/pages/ExportsPage.jsx)) | `walkListOptions`; round labels name their walk list |
| Survey Explorer ([SurveyExplorerPage.jsx](../client/src/pages/SurveyExplorerPage.jsx)) | `walkListOptions`; the round list is narrowed to the chosen walk list, as Door Outcomes' is |
| Door Outcomes ([DoorOutcomesPage.jsx](../client/src/pages/DoorOutcomesPage.jsx)) | `walkListOptions` |
| New client report ([NewReportDialog.jsx](../client/src/components/clientReports/NewReportDialog.jsx)) | `walkListOptions`; default `effortPick \|\| first open \|\| first` |
| Saved Searches "From pass" ([WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx)) | Pass labels name their walk list |
| Print packets ([packets.js:56-62](../server/src/routes/admin/packets.js#L56-L62)) | Archived walk lists left out server-side |
| Map door panel ([HouseholdDetailPanel.jsx:214-224, 434-453](../client/src/components/HouseholdDetailPanel.jsx#L214-L224)) | For an archived walk list: *North is archived — unarchive it to mark its doors.* |
| Survey page ([CampaignSurveyPage.jsx:345-384](../client/src/pages/CampaignSurveyPage.jsx#L345-L384)) | Override select disabled for archived walk lists, *Unarchive to change*; server guard B.8 |

The "2 or more" gates keep counting archived walk lists, so an archived one stays filterable.

### D.5 Campaign Home setup note ([SetupProgress.jsx:83-95](../client/src/components/SetupProgress.jsx#L83-L95))

When `hasCanvassed` and every step but `roundActivated` is done, render a slim `NextStepBanner` instead
of the checklist:

- *No pass is live right now. Start one on Walk Lists.*;
- with every walk list archived: *No pass is live right now. Unarchive a walk list or create one.*;
- org admins also get *or archive the campaign if you're done*, except while ArchiveNudge shows;
- team leads never see that clause.

DashboardPage passes the campaign to `SetupProgress` (today only `campaignId`, :593), and the component
reuses the exported `isStale` ([ArchiveNudge.jsx:29](../client/src/components/ArchiveNudge.jsx#L29),
rendered at DashboardPage.jsx:590). The banner logic is a pure function so it can be tested.

### D.6 History

- [campaignHistory.js](../client/src/lib/campaignHistory.js) gains the four labels and
  `walkListSentence(item)`, built from `details`.
- [CampaignHistoryDrawer.jsx](../client/src/components/CampaignHistoryDrawer.jsx) renders it beside
  `answerEditSentence`.

## E. Phone (over the air)

1. **Knock and survey payloads carry `turfId`.**
   - New pure helpers in [doorPaths.js](../mobile/lib/doorPaths.js): `doorTurfId(bootstrap, householdId)`
     and the body builders, beside `addVoterBody` (:29), so they run under `node --test`.
   - The callers read the door's book **at tap time** and send it, or `null`:
     `recordHouseholdAction` ([recordAction.js:535](../mobile/lib/recordAction.js#L535)), the walk-up voter
     add (:576), and the survey save ([survey.jsx:137-160](../mobile/app/(app)/voter/[id]/survey.jsx#L137-L160)).
   - The offline queue persists the body as is.
   - `doorChange.test.js:76-82` (which asserts `addVoterBody`) is updated.
2. **Admin Books** ([admin/books.jsx:155-181, 802-818, 1211-1216](../mobile/app/(app)/admin/books.jsx#L155-L181)):
   - `effortList` always leaves archived walk lists out;
   - one empty state: *No open walk lists. Unarchive one on the web to assign books.*
3. **Report pickers** (CampaignHome, admin timeline, map, audit, notes, ExportSheet) use the mirrored
   `walkListOptions`; ExportSheet's round tabs name the walk list.
4. **History:** `mobile/lib/campaignHistory.js` gains the labels and `walkListSentence`; `history.jsx`
   renders it.
5. **The closed-book message** ([map.jsx:872-884](../mobile/app/(app)/map.jsx#L872-L884)).
   - **When:** the saved book selection is non-empty, the data is fresh (not the disk copy), none of the
     selected book ids is in `data.books`, and there are no doors.
   - **What it says:** title *No book right now*; body *The office closed or reassigned the book you were
     working. Anything you saved still counts.*; then **Refresh** and **Choose a different campaign**.
     The wording covers archive, unassign, reassign and a new pass alike.
   - *No turf assigned yet* stays for a canvasser who never had a book. A book emptied because everyone
     voted still shows the existing message.
   - The condition is a pure helper, tested.
6. **The overlay follows the book.** Each pending overlay entry also stores the door's `turfId` at tap
   time. When a bootstrap refetch gives that door a different book (a new pass), the entry is dropped
   instead of painting the old round's status on the new pass's pin for up to 5 minutes
   ([recordAction.js:123-151](../mobile/lib/recordAction.js#L123-L151)). Pure helper, tested.
7. **Canvasser screens** (Books, "Choose your walk list", Survey practice) come from the bootstrap and
   follow automatically.

## F. Design notes

The mockups are in Part 1. Reused patterns:

- the shared `Modal` with `Button variant="danger"`, as `MoveConfirmModal` does;
- `Badge` variants for states (success = Live, neutral = Draft/Archived, amber for "still live");
- `NextStepBanner` for the view-only, setup and archived-campaign notes;
- the inline success line from EffortsPage's create flow for Undo;
- `DoorSelectionBar`'s `readOnly` prop for the map's select mode.

Light theme, semantic tokens only, no emoji (house rules).

## G. Edge cases

| Case | What happens |
|---|---|
| A generate or supplemental job is running when the pass ends | It fails at its next re-check, without retrying. Generate's post-insert re-check deletes the drafts it just made. A killed-and-redelivered run can leave its drafts on the archived pass, where they are harmless (C.5). |
| A claim job is moving doors into a walk list that gets archived | The job's target re-check fails it before any move. Snapshots it took are kept, as today. |
| Re-carving doors **out of** an archived walk list | Allowed (F3). The donor's archived books shrink. Bring back returns them as they are now; a pass left with no doors comes back as a draft (rule 8). |
| A discard racing an archive | Archive waits for, or refuses during, the discard's recut lock. A discard that started first re-checks after its lock, and its revert is conditional (C.4). |
| Starting the next pass while a claim or supplemental job runs on the old one | Proceeds, as today (B.6). |
| Two admins act on one walk list at once | The lifecycle lock serializes them; the loser gets 409 `lifecycle-busy` and nothing changes. |
| Two live passes on one walk list | Impossible through the app. Old data is fixed by the repair, and the index refuses any other writer. |
| Pins moved while the pass was archived | Bring back redraws its book outlines (B.5). |
| A canvasser removed from the campaign while archived | Their assignments were already deleted. The book comes back unassigned. |
| The walk list's own survey changes while archived | Refused (B.8). The campaign default can still change, and a re-carved door takes its new walk list's survey. A late answer to the old survey is then refused and dropped by the phone, as today. That gap predates this plan. |
| A dead-zone phone works yesterday's book after the next pass started | Knocks made before the start count in the old pass. Those made after count in the new pass when it holds the door, else in the old one (B.7, ruling 9). |
| A phone offline for days, with the update | Its knocks count where B.7 step 1 puts them, as long as their book still exists and holds the door; else today's rule. |
| A phone without the update | Today's rule, exactly. |
| A late knock older than the door's last visit | Counts in its pass; the door's last visit stays the later one, and teammates' phones still get the change (C.6). |
| A garbage `turfId` (string, number or object) | Ignored (B.7); answers 201. |
| `LATE_KNOCK_ATTRIBUTION` flipped | Saved knocks keep their pass. A retry straddling the flip can count twice (as built, it can't: §O.6). Flip outside field hours unless knocks are failing (B.7). |
| Archived campaign | Read-only for walk lists and passes, except snapshot delete (B.8). The repair still ends a live pass there (C.11). |
| Campaign being deleted | Every route answers as today (404/409); the lifecycle service checks `deletion.requestedAt`. |
| A pass archived before this change | `archivedFrom` inferred (rule 5); rule 4b uses the pre-change fallback; *when Pass N went live* is inferred from equal timestamps. |
| The next pass was deleted after it ended this one | Rule 4a still refuses; the label reads *when the next pass went live*. |
| Unarchive only, then later Bring back | Allowed under B.5. |
| Archive, unarchive, archive again | `endedPassId` is rewritten each time; it is read only while archived. |
| An archived draft, then the walk list is archived and the archive undone | The draft's Bring back still works (rule 4b applies only when coming back live). |
| The Turf page open on a pass someone else archives | The next write gets a 409, and the page refetches into view-only (D.3). |
| `?passId=<archived>` deep links (Walk Lists, Map, Audit) | Open the view-only page. |
| A team lead who can't manage that campaign | The existing `requireCampaignManager` 403 applies, as for every efforts and passes route. |
| A Door Outcomes undo held by a cleared snapshot on an archived pass, walk list or campaign | Delete the snapshot, or bring the pass back and restore it (C.7). |
| A door knocked just before the switch | Shows done for up to a few minutes on that phone, then not done in the new pass (it counts in the old one); E.6 drops the overlay as soon as the book changes. |
| A phone on the staging bundle (staging talks to production) | Sends `turfId` to the production server, which reads it after the deploy. Before the deploy, the server ignores it. |

## H. Tests and verification

**Unit (node --test):**

- `passPicker.test.js`: grouping by pass state; an archived walk list's drafts under Archived; labels;
  the new default invariant.
- `walkListState.test.js`: all nine states in D.1's order.
- `walkListOptions.test.js` on web and phone, plus `walkListOptions.parity.test.js`; `useRoundOptions`
  marking and filtering.
- `passLifecycle.rules.test.js`: `canBringBack` and `couldComeBack` for every rule in B.5:
  - equal timestamps;
  - a re-activated pass (`lastActivatedAt`) and the pre-change re-activation case;
  - a deleted successor (4a);
  - a draft coming back while a later pass went live (4b skipped);
  - the no-doors downgrade;
  - a pass on an archived walk list or campaign (`couldComeBack` true).
- `attribution.test.js`: the two steps; `tappedAt` before and after `archivedAt`; a live book holding the
  door or not; the switch's spellings; invalid ids including a number and an object.
- `campaignHistory.test.js` (web and phone): `walkListSentence` for every outcome; repair rows.
- The D.3 `lastSnapshot` helper; the D.5 banner function (lead vs admin, ArchiveNudge showing, every walk
  list archived).
- Phone: `doorTurfId` and the body builders (a door with and without a book); the E.5 condition; the E.6
  overlay helper.

**Integration (throwaway mongod, `npm run test:int -- test/<file>`):**

- **`walkListArchive.int.test.js`:**
  - archive ends the live pass and leaves drafts as drafts;
  - the confirm gate; recut and lifecycle locks;
  - a History row with `details`;
  - the bootstrap drops the books, and `/changes` reports the new `activePassIds`;
  - Unarchive both ways (a single History row), its partial-failure answer, and Undo;
  - resuming after a crash between B.2 steps 5 and 6;
  - the amber state: End Pass 3 on an archived walk list with a live pass;
  - `canDelete` matching B.9.
- **`passBringBack.int.test.js`:**
  - every refusal reason;
  - a pass ended through the real `activatePass`, then its successor archived by hand, refused;
  - `activatePass` stamping `archivedVia`, `archivedFrom`, `archivedBy`, `endedByPassId` and
    `lastActivatedAt`, and `bringBackPass` clearing them;
  - GET /passes `endedByPassName`, stamped and inferred;
  - `to` and the downgrade; the outline redraw runs and swallows a failure;
  - assignments return; `activatedAt` kept.
- **`passLifecycleRace.int.test.js`:** a concurrent archive plus bring-back, two bring-backs, and a
  bring-back plus an activation. One wins, the loser gets `lifecycle-busy` with nothing changed; never an
  archived walk list with a live pass, never two live passes.
- **`walkListReadOnly.int.test.js`:**
  - every route in B.8 answers 409 with its code on an archived walk list (drafts included), an archived
    pass and an archived campaign;
  - `move-door` with `from` in another pass;
  - snapshot delete on all three still works;
  - unrestrict and claims **out of** an archived walk list still work;
  - B.4's new refusals;
  - the discard race (conditional revert);
  - B.9 (an archived never-live walk list can be deleted; refused on an archived campaign);
  - the packets exclusion (in `packet.int.test.js`).
- **`lateKnocks.int.test.js`:**
  - client `turfId` on a live book;
  - on an archived book, tapped before its end;
  - on an archived book, tapped after its end, with and without a live book holding the door (ruling 9);
  - a discarded, a re-cut, a deleted, a merged-away and a split-away book: the knock lands where today's
    rule puts it, and no earlier pass's rows change;
  - no `turfId`; garbage ids (201, never 4xx or 5xx);
  - switch `off` gives today's stamps;
  - the survey route; the walk-up add;
  - `lastActionAt` never moves backwards, **and the teammate's `/changes` includes the door**.
- **Door Outcomes:** `roundClearedSince` cases in the existing answer-edit and unknock suites:
  - archived and could come back (open, archived walk list, archived campaign) holds the undo;
  - ended by the next pass lets it through;
  - deleting the snapshot releases it.
- **`restrictDoors.int.test.js`:** 409 `walk-list-archived` for a door of an archived walk list and for
  an explicit frozen draft pass (never `PASS_REQUIRED`).
- **`liveIndex.int.test.js`:**
  - `buildIndexes` dry run lists `one_live_pass_per_walk_list` on a database without it;
  - a second live pass on one walk list is refused;
  - two walk-list-less live passes don't collide.
- **`repairArchivedWalkLists.int.test.js`:**
  - the dry run lists, grouped, with counts and no names, archived campaigns included;
  - apply ends every live pass on archived walk lists, in archived campaigns too, with dates kept;
  - two-live walk lists keep the latest;
  - locked passes skipped;
  - idempotent;
  - History rows read *One-time check* (through `GET /history`, in `walkListArchive.int.test.js`).
- **Jobs:** generate (`UnrecoverableError`, the post-insert cleanup leaving accepted books alone),
  supplemental and claim on an archived pass or walk list.
- **The test preload builds the index;** the nine suites in C.12 are fixed. The full `npm run test:int`
  run and the demo seeder pass.

**Verification after the build:**

- Run the web console against a local server and walk every Part 1 flow as the owner would.
- Re-run the 2026-10-27 scratch probe. It must now show the book gone, the knock counted in the ended
  pass, and Bring back returning the book.
- `npm run audit:mobile-api` on the diff.
- The staging device check (§K step 8).

## I. Docs and Help Center

**Docs:**

- **[EFFORTS.md](EFFORTS.md):**
  - the archive bullet (:245-250): "Archive is only a status flag" becomes the archive/unarchive rules;
    "doesn't release doors" kept;
  - the delete passage (:251-260) and its pointer (:254);
  - attribution (:295-299);
  - read-only rules.
- **[CAMPAIGNS.md](CAMPAIGNS.md):**
  - what History records (:150-170) and the CampaignChange sources and keys (:898-921);
  - the Door Outcomes undo guard (:1331-1336);
  - the archived-campaign guard's routers and its snapshot-delete exemption (:923-926);
  - what an archived campaign refuses (:781-790);
  - SetupProgress's branches (:1560-1564).
- **[PASSES.md](PASSES.md):** the lifecycle (:8, :68-86), Bring back, and the routes (:132-135).
- **[PASSES_AND_TURF.md](PASSES_AND_TURF.md):** the lifecycle lines (:56, :733-744), the routes table
  (:1105-1106), attribution (:1165-1172) with late knocks, ruling 9 and the switch, its pointer (:1167),
  and Turf view-only.
- **[WALKLISTS.md](WALKLISTS.md):** re-carves out of an archived walk list still work (:128-131).
- **[METRICS.md](METRICS.md):** what "Legacy / no pass" holds now (:84, :516); late knocks count once in
  their own pass; a pass's row can grow after it ends.
- **[SURVEYS.md](SURVEYS.md):** the pointer (:1875) and the undo-guard rule (:2044-2052).
- **[MAPS.md](MAPS.md):** desk marks on an archived walk list (:250-254).
- **[WALK_PACKETS.md](WALK_PACKETS.md):** which rounds are offered (:334).
- **[ADMIN_APP.md](ADMIN_APP.md):** admin Books, the Legacy row (:313-314), desk marks (:743-747,
  :1239-1243).
- **[CANVASSER_APP.md](CANVASSER_APP.md):**
  - the payload's `turfId`;
  - the closed-book message and the overlay;
  - last visit only moves forward (:1345-1371);
  - doors that flip at a pass change.
- **[OPERATIONS.md](OPERATIONS.md):**
  - `LATE_KNOCK_ATTRIBUTION`: spellings, the restart, when to flip;
  - `TURF_BRING_BACK_REHULL_MAX_DOORS` beside `TURF_REHULL_INLINE_MAX_DOORS` (:1016-1022), with
    `recompute:territories` as the fallback;
  - the repair script; the index build.
- **[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md):** item 43 (§J).
- **[docs/README.md](README.md):** an index line for this proposal.

**Help Center** (`server/src/content/help/`). Help ships with the server deploy, ahead of the phone
update, so phone behavior is worded "after the app update".

- `guides/passes.md`: the lifecycle and Bring back.
- `guides/walk-lists.md`: archive and unarchive; the "archive the emptied leftover" line now says what
  ending its pass means; "restorable from its Turf page" gets the archived-pass caveat (:35).
- `guides/campaigns-manage.md` (:137-145) and `faq/who-changed-the-door-goal.md` (:24-37): what History
  records.
- `guides/turf-and-books.md` (:49): the phone's admin Books.
- `guides/surveys.md` (:106): the survey choice locked while archived.
- `pages/page-walk-lists.md`: the Status column and the archived section.
- `pages/page-turf-cutting.md`: the dropdown groups and the view-only page.
- `pages/page-map.md` (:20) and `faq/mark-one-home-restricted.md` (:28): desk marks on an archived walk
  list.
- `pages/campaign-home.md` (:16-18): the setup note.
- `pages/page-print-packets.md` (:18): the round dropdown.
- `pages/page-door-outcomes.md` (:79): an archived round that can still come back holds an undo, as an open
  one does (C.7) — added in code review round 2 (§O.6), which found it still stating the old rule.
- `faq/why-cant-canvasser-see-doors.md`: "the walk list is archived" as a reason, quoting *No book right
  now*.
- `faq/export-knocks-for-invoicing.md`: the Legacy row (:16), late knocks, and invoicing a finished pass
  after phones sync.
- **New** `faq/undo-archive.md` (`audience: lead`): *I archived a walk list or a pass by mistake*, with
  a triage line in `faq/_INBOX.md`.

Part 1 here is the source; Part 2 is never exposed.

## J. Privacy, mobile API, version gate

**Not privacy-affecting** in what the product collects, keeps or shares (checked against CLAUDE.md's
list):

- no new personal data: `turfId` is an internal book id the phone already holds;
- no retention or deletion change: archive deletes nothing, and delete's rules are unchanged;
- no new access: same `requireCampaignManager` roles;
- no new third party;
- nothing newly exposed;
- no published policy text changes.

**[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) gets item 43** (with the built/deploy-pending stamp
its pattern uses), as for every new History source (the v5 entry; `survey_conversion`, `answer_edit`,
`client_report`):

- `walk_list_lifecycle` rows hold four fields whose values are walk list and pass names, a `details`
  object with the same facts, and the actor id.
- They are read through the History gate (`canManageCampaign`), and are deleted with the campaign and
  the organization like every `CampaignChange` row (the campaign and org cascades).
- Repair rows have no actor.
- New actor ids: `Effort.archivedBy` and `Pass.archivedBy`. `archivedByName` on `GET /efforts`, `GET
  /passes` and the unarchive preview reaches the same people who already see History's actor names,
  under the same gate, resolved through `hydrateCanvassers`.
- **The one-time repair's console output** crosses customer organizations outside a support-access
  grant, so it prints counts and walk list, pass, campaign and organization names (operator metadata),
  never canvassers' names.

**Mobile API:** additive only.

- New fields on `GET /efforts` and `GET /passes`; an optional body field on knocks, the walk-up add and
  surveys.
- New 409 codes on the assignment and desk-mark routes the phone calls, for archived passes and walk
  lists only. The phone's admin Books no longer offers those (E.2); an old bundle shows the server's
  message.
- **No client-version gate.** Publishing the phone update before the server is also safe, because the
  schemas strip unknown fields.
- `npm run audit:mobile-api` will flag efforts.js, passes.js, turfs.js, turfAssignments.js, packets.js,
  campaigns.js (History: `details` and the *One-time check* actor on the new rows) and mobile/canvass.js;
  their diffs are additive.

## K. Release

1. **Commit:** the owner commits (`git add -A` from the repo folder, owner routine).
2. **Deploy:** server and web deploy from `main` (Heroku). `LATE_KNOCK_ATTRIBUTION` unset = on.
3. **Repair, dry run:** dashboard → More → Run console: `npm run repair:archived-walk-lists`. The owner
   reads the list, grouped by organization.
4. **Before applying:** unarchive on the web any of your own walk lists to keep running, and tell the
   customers the list names, especially those knocked in the last 2 days.
5. **Repair, apply** (outside field hours): `npm run repair:archived-walk-lists -- --apply`. Re-run it if
   it reports locked passes.
6. **Index, dry run:** `npm run migrate:build-indexes`.
   - It must list `one_live_pass_per_walk_list` as missing.
   - If it lists any other index, stop and ask before applying, because `--apply` builds every missing
     index.
7. **Index, build:** `npm run migrate:build-indexes -- --apply`. A "✗ Pass:" line mentioning E11000 means
   a duplicate the repair didn't fix: re-run step 5, which reports it, then step 7.
8. **Staging update:** from `mobile/`, `npm run ota:staging`, then the **airplane-mode check**.
   - **Setup.** Use a throwaway test campaign in an internal org (Doorline-owned, never the demo
     campaign reviewers sign into), since staging phones talk to the production server. On the web,
     make a walk list with Pass 1 live. Cut and accept Pass 2 with one door in both. Assign the phone's
     account a book on each pass.
   - **The check:**
     1. On the phone, open the Pass 1 book and turn on airplane mode.
     2. Knock that door.
     3. On the web, activate Pass 2.
     4. Turn airplane mode off and let the phone send.

     The By pass table must count that knock in **Pass 1**; a phone without the update puts it in Pass 2.
   - **Then:** on the phone, open the Pass 2 book (activating Pass 2 sent the phone to its book list).
     Archive the test walk list on the web: the phone shows *No book right now*, and Undo brings the Pass 2
     book back on the next refresh.
   - **Clean up:** `npm run cleanup:test-campaigns -- --ids=<id> --apply` from the repo root (in the
     console).
9. **Production update:** from `mobile/`, `npm run ota:production` on `main`.

Steps 3-7 are hand-over commands, run from the repo root before hand-over. The off switch is
`LATE_KNOCK_ATTRIBUTION=off` in Config Vars; it restarts the app, so flip it outside field hours unless
knocks are failing.

## L. Files

**Server:**

- `models/Effort.js`, `models/Pass.js`, `models/CampaignChange.js`
- `services/passes/passLifecycle.js` (new), `services/canvass/attribution.js` (new)
- `middleware/campaignWritable.js` (the guards; the snapshot-delete exemption)
- `routes/admin/efforts.js` (including the :515 pointer), `passes.js` (including :142 and :172),
  `turfs.js` (guards, discard's conditional revert, move-door, the exemption), `turfAssignments.js`,
  `packets.js`, `campaigns.js` (History route: synthesized actor, `details`)
- `routes/mobile/canvass.js` (attribution callers, last visit at :532-533 and :1093-1094)
- `services/canvass/answerEditRuns.js` (C.7), `services/canvass/deskRestrict.js`,
  `services/canvass/surveyConversion.js` (the :370 pointer)
- `services/turf/generateTurf.js`, `services/walklist/claimDoors.js`, the TURF processor (UnrecoverableError)
- `services/platform/seedDemoOrg.js` (stamp the new fields)
- `migrations/repairArchivedWalkLists.js` (new), `migrations/repairOrphanAttribution.js` (the :3 pointer)
- `scripts/testIndexPreload.mjs` (the index)
- `package.json` (server and root)
- tests, including the nine suites in C.12

**Web:**

- `pages/EffortsPage.jsx`, `components/PassManager.jsx`, `pages/PassesPage.jsx`, `pages/TurfsPage.jsx`,
  `pages/DashboardPage.jsx`
- `components/BookAssignmentPanel.jsx`, `components/HouseholdDetailPanel.jsx`,
  `components/SetupProgress.jsx`, `components/CampaignHistoryDrawer.jsx`
- `components/walkListLifecycle/*` (new)
- `lib/passPicker.js`, `lib/useRoundOptions.js`, `lib/walkListState.js` (new),
  `lib/walkListOptions.js` (new), `lib/campaignHistory.js`
- the pickers in D.4: MapPage, TimelinePage, AuditPage, NotesPage, ExportsPage, SurveyExplorerPage,
  DoorOutcomesPage, NewReportDialog, WalkListsPage, CampaignSurveyPage
- tests

**Phone:**

- `lib/recordAction.js`, `lib/doorPaths.js`, `app/(app)/voter/[id]/survey.jsx`, `app/(app)/map.jsx`
- `app/(app)/admin/books.jsx`, `app/(app)/admin/history.jsx`, `components/CampaignHome.jsx`, the admin
  timeline, map, audit and notes screens, `components/ExportSheet.jsx`
- `lib/walkListOptions.js` (new mirror), `lib/campaignHistory.js`
- tests (`doorChange.test.js` included)

**Docs and Help:** §I.

## M. Owner calls

**Ruled 2026-10-27:**

1. Unarchive asks each time whether to bring back the pass archiving ended.
2. A pass archived by hand gets the same undo, until a newer pass on that walk list goes live.
3. Late knocks count in the pass they were made in.
4. Archiving a walk list whose pass is live takes typing `archive`.
5. Ships this week, with an off switch for the late-knock part.
6. Whoever can archive can unarchive and bring back (admins and team leads on campaigns they manage).
7. Archived walk lists stay in report filters, marked and last; work pickers leave them out.
8. Walk lists already archived with a live pass: list first, then end with one command.

**Ruled 2026-10-28:**

9. A canvasser working yesterday's book after the next pass started: those knocks count in the new pass
   when it includes the door (knocks made before it started stay in the old pass).
10. The one command ends every listed pass, customers' included. (The recommended option was to skip
    lists knocked in the last 2 days; the owner chose to end them all.)

**Decided in this plan (say if you disagree):**

- an archived walk list can still be renamed;
- Door Outcomes, flag review, notes and exports keep working on it;
- its drafts stay drafts, and are frozen while it's archived;
- deleting an old snapshot stays possible on an archived pass, walk list or campaign;
- unmarking a desk mark on an archived pass stays possible from the Map page;
- starting the next pass never waits for a running job;
- the buttons read **Archive / Unarchive** for walk lists and **Archive / Bring back** for passes;
- "Pass went live" is not added to History;
- the repair prints counts, never canvassers' names.

## N. Review rounds

**Round 1 (v1, three reviewers: server correctness on a throwaway mongod; owner walkthrough +
simplicity; release, phone compatibility, docs and consistency).** Found 3 blockers (two of them the
same rule-4 bug, found independently), 7 majors and about 25 minors. Every one was re-checked against the
code before being accepted. What changed:

- **Rule 4** used `>`, but activation stamps both times from one `now`. So every pass replaced by the next
  would have shown **Bring back**. Fixed with `>=`, `lastActivatedAt` and `endedByPassId`.
- **The server-side late-knock fallback was removed.** It was reproduced filing a discarded pass's late
  knocks into the previous pass, where the replace deleted or overwrote that pass's answers.
- **The index used a key the model already has,** so it would never have been built. It now uses
  `{ status: 1, effortId: 1 }`.
- **A walk-list lifecycle lock** was added; unarchive reopens the walk list before bringing the pass back.
- **Drafts stay drafts;** `Effort.endedPassId` records the one ended pass.
- **Dropped:** the response-wire special case, the "Pass went live" History row and `broughtBackAt`/`By`.
- **Also:**
  - last visit only moves forward;
  - a lower redraw cap;
  - generate re-checks after insert;
  - repair gaps;
  - snapshot delete allowed on archived passes;
  - the phone's closed-book message;
  - an airplane-mode staging check;
  - the docs cascade; empty and edge states; History sentences; shared dialogs on `Modal`.

**Round 2 (v2, three reviewers: new mechanisms on throwaway mongods; pre-mortem + owner walkthrough;
coverage and consistency).** Found **no blockers**, 9 majors and about 35 minors, all re-checked. Two
were the owner's to decide (rulings 9 and 10). What changed in v3:

- **Late knocks after the next pass started** count in the new pass when it holds the door (ruling 9;
  B.7). Without this, a dead-zone canvasser's morning would have landed in yesterday's pass and been
  knocked again.
- **The repair** ends every listed pass, customers' included (ruling 10). It:
  - lists results by organization with counts and no canvassers' names;
  - fixes walk lists with two live passes itself, including on archived walk lists and campaigns, where
    the owner couldn't;
  - writes *One-time check* rows that old phones show correctly.
- **Last visit only moving forward** stopped teammates' phones from getting some late surveys. The write
  now always bumps `updatedAt` (C.6; reproduced).
- **The index:**
  - nine test suites, not two, create two live passes; the test preload now builds the index, because
    autoindex silently lost the race;
  - a `$type` filter keeps live passes with no walk list from colliding.
- **`couldComeBack`** now counts passes on archived walk lists and campaigns as able to come back, so an
  undo is held instead of breaking a snapshot for good. Snapshot delete is exempt from the
  archived-campaign guard, so the hold always has a way out (C.7, B.8).
- **Rule 4:**
  - 4a makes "ended by the next pass" permanent even if that pass is deleted;
  - 4b applies only when coming back live;
  - a pre-change fallback catches re-activated passes (reproduced).
- **The lifecycle lock** is taken once per export (it isn't re-entrant).
- **Discard** re-checks after its lock and reverts conditionally (reproduced).
- **`move-door`** keeps both books in one pass.
- **Desk marks** answer 409 before `PASS_REQUIRED`, including for an explicit frozen draft
  (reproduced).
- **Garbage `turfId`** numbers and objects no longer cause a 500 that stalls the phone's queue
  (reproduced).
- **Jobs** fail with `UnrecoverableError`; generate's cleanup leaves accepted books alone.
- **Activation** doesn't wait for the old pass's recut lock.
- **The phone:** the overlay drops when a door's book changes; the closed-book message's wording and
  condition were fixed; testable pure helpers.
- **The staging check:**
  - it now assigns the tester a Pass 2 book before going offline (as written it could not pass);
  - it uses a throwaway campaign, never the demo;
  - it cleans up after itself.
- **The docs cascade** gained about 20 passages; privacy item 43; nine named test suites.
- **Smaller fixes:** the setup note's all-archived and lead variants; D.4 built on `useRoundOptions`;
  wording fixes; five line references corrected.

The owner asked for another round only if round 2 found blockers. It found none, so review stops at
round 2 unless the owner asks for more.

## O. As built (2026-10-28)

Built to plan v3 by the lead and eight parallel builders, each owning a disjoint set of files; every
builder's report was re-checked against the code. Uncommitted. The tree is shared with the client report
links build (docs/PROPOSAL_CLIENT_REPORT_LINKS.md), which edits some of the same files (§O.5).

### O.1 Where the build differs from the plan

**Server:**

- **A walk list that doesn't exist.** `withLifecycleLock` answers 409 `walk-list-missing` when the walk
  list is gone or the pass has none (a pass from before walk lists existed). It no longer says
  `lifecycle-busy` ("try again in a minute"), which would never come true.
- **Older records.** `GET /efforts` and `GET /passes` always send the new fields (`archivedAt`,
  `archivedBy`, `endedPassId`; `lastActivatedAt`, `archivedFrom`, `archivedVia`, `archivedBy`,
  `endedByPassId`), as null on older records. `GET /efforts` also sends `everLive`. No response carries
  `lifecycleLock`.
- **The Unarchive preview** carries `bringBackMessage`, the server's refusal sentence, so the dialog
  never keeps its own copy.
- **Lock before recording.** `archiveWalkList` records `endedPassId` *inside* the live pass's recut lock,
  so a refusal changes nothing (the plan recorded first). `repairWalkList` does the same, and on a re-run
  keeps a pointer it already set.
- **Renaming or deleting an archived pass** still answers 400 *Only draft passes can be edited/deleted*
  (not `pass-archived`). The walk-list guard applies to the drafts of an archived walk list.
- **The walk-up voter add** passes the tap time to attribution, like the knock and survey routes.
- **Book routes:**
  - `move-door` across passes answers 400 `different-pass`, as merge does;
  - snapshot delete's check under the lock is its own result: a snapshot already gone answers 404;
  - generate's draft wipe moved to just before its insert, behind one pre-write check;
  - inside a job, "not found" is unrecoverable too;
  - `restrict-doors` on an explicit archived pass keeps its old sentence (code `pass-archived`), while
    `restrict-bulk` uses the shared one.
- **Desk marks.** `deskRoundForDoor` (exported) carries the reason. As a consequence, the Map door panel
  doesn't show the desk state or Unmark for a mark on a frozen draft of an archived walk list unless the
  page is opened on that round. Known limitation; the mark itself is refused with the 409 sentence.
  *Fixed in code review round 2 (§O.6): `/activity`'s `currentPassId` resolves as an unmark does, so that
  mark shows with Unmark in every view, on installed phones too; the clients turn Mark off from the walk
  list's status.*
- **The repair script:**
  - refuses unknown flags (a mistyped `--campaign` can't widen `--apply`);
  - lists a deleted walk list holding two or more live passes as "NOT CHANGED, ask before building the
    index" (exit 1);
  - "last knock" is the latest knock on the live passes, as a UTC date;
  - the seeder also stamps `archivedBy`.

**Tests:**

- The nine suites keep every assertion. The answer-edit suites put each extra round on its own walk list
  ("Side N"), and one regex in Round 9 now names that walk list.
- In mapCounts, P0 is a draft (a pass with no books can't be live). The preload helper is now
  `ensureTestIndexes`.
- `turfBookStatus.int.test.js`'s supplemental test runs on a draft pass, since archived passes take no
  new books.
- §H's unit files `passLifecycle.rules.test.js` and `attribution.test.js` weren't written: the bring-back
  rules and attribution are pinned through the real routes instead (passBringBack, walkListArchive,
  lateKnocks, roundClearedArchived). §H's `walkListReadOnly.int.test.js` became `walkListBookGuards`
  (every book write) plus the refusal table in `walkListArchive`.
- **One refusal reason the plan didn't list:** `campaign-deleting` (a pass of a campaign being deleted
  can't come back).
- **The dialogs' own copy of the refusal sentences.** `lifecycleCopy.js` keeps `REFUSAL_WORDS` as a
  fallback for the one answer that sends no sentence (the Unarchive preview's `bringBack`); wherever the
  server sends `bringBackMessage`, that wins.

**Web:**

- `walkListState` returns `{ key, tone, label, detail }`. *Setting up* means passes exist but none has
  ever been live; *No passes yet* means none at all.
- The Archived section folds inside the same table (aligned columns), and its header adds "· N still
  has a live pass" before the repair.
- **End Pass N** on an amber row leaves *Pass 3 ended. Unarchive North to bring it back.* with no Undo,
  because undoing it would also unarchive the walk list.
- On an archived campaign the open rows read **View**, and the New walk list card and the Intake banner
  are hidden.
- **The move-confirm caveat** shows when a donor walk list is archived or has an ended pass. The claim
  breakdown doesn't say which donor passes are archived, so this can't be exact.
- **Passes panel and page.** In the Walk Lists drawer, PassManager shows a one-line note instead of a
  second Unarchive button. The full Passes page carries Unarchive (and End Pass N in the amber state).
- **Turf Cutting:**
  - a pass still live on an archived walk list (before the repair) reads "(still live) · walk list
    archived" and is view-only;
  - the banner offers one action, in the order campaign → Unarchive → Bring back → Open Pass N;
  - the snapshot note says *This pass can't come back, so its snapshots can't be restored.* when it never
    can, and *Reactivate the campaign to restore a snapshot.* on an archived campaign;
  - Target/Exclude are off in view-only;
  - Merge reports through a toast;
  - any 409 refetches, not just the four codes.
- **Campaign Home's note** lives in SetupProgress.jsx as `noPassLiveNote`.
- **History (web and phone)** reads one sentence with the actor first (*One-time check ended North ·
  Pass 3 · GOTV*), with only the time under it. Both use one implementation, pinned by
  `walkListSentence.parity.test.js`.
- Saved Searches' "From pass" uses `useRoundOptions`.

**Phone:**

- The pure helpers live in `lib/doorPaths.js` (`doorTurfId`, the body builders, `pendingDoorVerdict`,
  `bookClosed`).
- **An added guard:** an online reply's status is painted only if the door is still in the book it was
  tapped in.
- The overlay drops on any book change, including a re-cut, split or merge within a live pass, because
  bootstrap books carry no pass id.
- ExportSheet's rounds are grouped by walk list.

**Docs and Help:**

- Privacy record item 43.
- User-facing copy says "before the October 2026 update" where a date was needed.
- Also fixed: TURF_RUNBOOK.md's "one-way" lines; faq/archive-vs-delete-campaign.md (walk lists and passes
  freeze with an archived campaign); faq/changes-not-showing-in-field.md (a pass ending or coming back
  reaches phones like other live changes).

### O.2 Verified

- **Web:** 1,134+ unit tests pass, and `vite build` compiles (with the same chunk-size warning as
  before).
- **Phone:** 402 of 402 pass.
- **Server unit:** 0 failures.
- **New integration suites**, all passing:
  - walkListArchive 21, passBringBack 15, passLifecycleRace 5 (12 rounds each), lateKnocks 11,
    roundClearedArchived 8;
  - walkListBookGuards 18, repairArchivedWalkLists 6, liveIndex 4;
  - restrictDoors 24, packet 23, turfBookStatus 11, the nine fixed suites 179, demoRebuild 17.
- **Builder A's mutation checks:** 12 deliberately broken copies of its code, each caught by a test.
- **The end-to-end probe** on a throwaway database:
  - archive with confirm takes the book off the canvasser's bootstrap;
  - a late knock tapped before the archive counts in the ended pass;
  - claiming into the walk list and adding a pass are refused;
  - Unarchive with bring back returns the pass live (`activatedAt` kept, `lastActivatedAt` set) and the
    book to the phone;
  - History shows both rows.
- **The repair** was run from the repo root against a seeded scratch database: dry run, apply, re-run,
  then `migrate:build-indexes` listing and building the index.

**Not verified:** no click-through in a browser, and no device test. The staging device check is §K step 8.

### O.3 Integration run

The full `npm run test:int` (181 files) shows failures only in the client report links work in progress
in the same tree:

- clientReportBuild, clientReportDuplicates, clientReportSingleLinks, leadWalkthrough, reportSecurity and
  shareLinks — e.g. `REPORT_REQUIRED`, *Each link opens one report*;
- crewJobEdges, a known planner-timing flake that passes alone.

None touch this feature's code.

### O.4 Owner steps

Unchanged from §K: deploy; the repair dry run then `--apply` (tell the customers it lists); the index
dry run then `--apply`; staging OTA with the airplane-mode check; production OTA.

### O.5 Shared files

These files carry both this build and the client report links build:

- server/src/routes/admin/campaigns.js (History route)
- client/src/lib/campaignHistory.js
- client/src/components/clientReports/NewReportDialog.jsx
- server/src/services/platform/seedDemoOrg.js (and server/test/demoRebuild.int.test.js)
- package.json and server/package.json
- docs/PRIVACY_VERIFICATION.md (item 43 is this build's, item 44 that one's)
- docs/OPERATIONS.md (each build has its own release section), docs/README.md (a proposal row each) and
  server/src/content/help/faq/_INBOX.md

docs/CLIENT_PORTAL.md still needs one line, which that session owns: New report opens on an open walk
list and marks archived ones.

At that session's request, server/scripts/testIndexPreload.mjs also builds its one-link-per-report guard
(`report_one_link_guard`), and server/test/liveIndex.int.test.js checks that entry against
models/ReportShareLink.js.

### O.6 Code review

**Round 1 (three reviewers: server correctness on throwaway mongods; web and phone code; release safety,
shared files, docs and tests).** No blockers; 3 majors and 15 minors, each re-checked against the code.

- **Late knocks in the gap (major).** A knock tapped after its pass was ended by hand, but before the next
  pass started, counted in the new pass once that pass was live. A copy delivered before the start and
  retried after it counted in both passes. It now stays in the old pass when the tap came before the live
  pass's first activation (B.7 step 1.4, its `activatedAt`); pinned by lateKnocks (3b).
- **Two live passes, then Undo (major).** On a walk list holding two live passes (data from before the
  index), archive and the repair ended the pass Unarchive offers *first*. The other pass, from before
  `lastActivatedAt`, then read as live after it, so rule 4b refused the bring back for good. Both now take
  every live pass's recut lock up front and end the offered pass last, 1 ms after the others
  (`endPassesOfferingLast`); pinned by two repair-suite tests.
- **Privacy item 43 (major).** The client report links plan had claimed item 43 too; that session moved
  to item 44.
- **Server minors:**
  - `POST` and `PATCH /efforts` no longer return `lifecycleLock`.
  - Rebuild demo day reopens the demo walk list if someone archived it (demoRebuild test).
  - The repair skips campaigns being deleted, and says to build the index once those deletes finish.
  - A live pass with no walk list can be ended by its Archive route again (it had lost that path). No
    screen lists one, so the dry run's count must read 0, or the owner stops and asks (OPERATIONS step 3).
- **Web and phone minors:**
  - Activate ignores a second click while the first is in flight.
  - The archive box sends `confirmArchive` only after the typed confirm, and re-asks if a pass went live
    meanwhile.
  - The Unarchive box shows a refusal once.
  - The walk-list drawer's crew and claim panels refresh on a 409.
  - The Map lasso leaves doors of archived walk lists (or an archived pass's scope) out of Mark
    restricted…, as it does Intake doors.
  - End Pass N on an amber row writes a pass row, not a walk-list row.
  - History sentences are actor-first on both clients (parity test).
  - The repair rows' actor carries no status, so a phone without the update shows plain *One-time check*.
  - The phone's lifecycle rows show a departed actor's standing.
- **Docs minors:**
  - the old-phone History wording;
  - Unmark on the Map works only from the pass's own view for an archived walk list;
  - EFFORTS' archive order;
  - item 43's *Pinned by* is now walkListArchive's History-actor test;
  - the audit list names packets.js and campaigns.js;
  - the staging check opens the Pass 2 book.
- **Left as is:** Turf Cutting is editable until its data loads (a nit; the server refuses the writes).

Verified after the round-1 fixes:

- **Unit tests:** web 1,154 of 1,154; phone 402 of 402; server unit 656 of 656.
- **Integration suites:** walkListArchive 23, passBringBack 15, passLifecycleRace 5, lateKnocks 12,
  roundClearedArchived 8, walkListBookGuards 18, repairArchivedWalkLists 8, liveIndex 5, demoRebuild 18,
  campaignHistory 12.
- **Mutation checks:** each new server test fails with its fix undone.

**Round 2 (three reviewers, new lenses: adversarial runtime on throwaway mongods; the clients over time —
phones old and new, offline, and the web as owner and lead; spec coverage, docs and privacy, and a dry run
of the release runbook from the repo root).** No blockers; 2 majors, 13 minors and about 15 nits, each
re-checked against the code. The owner's rule was another round only for blockers, so review stops here.

- **One tap counted in two passes (major).** A retry whose first reply was lost could resolve to another
  pass when the next pass ended, came back, or was discarded and started again in between — attribution
  is decided on arrival, and the duplicate check read only the attributed pass. A replay that is the same
  tap as one already counted in any pass (its own row; an entry in a later save's history, for a knock;
  its survey answer's tap time) now answers 200 for the pass it counted in, and a tap an admin struck
  stays struck when its retry resolves elsewhere (`tapStruckInAnyPass` matches the tap itself, never
  another pass's visit). Pinned by lateKnocks (10), (10b) and (10c); the 20 suites that send offline
  replays pass.
- **Door Outcomes Help (major).** It still said an archived round lets an undo go ahead; as built, one that
  can still come back holds it (C.7). Rewritten.
- **Server:**
  - a survey change racing an archive can't land on the archived walk list (the write is conditional;
    a test stages the race);
  - both deletes answer once the walk list's lock is released, and a draft with no walk list can be
    deleted;
  - the archive answer names the pass it ended (`endedPass`), so the notice and its Undo follow the
    server, not a stale preview;
  - `/activity`'s `currentPassId` resolves as an unmark does, so a desk mark on an archived walk list's
    draft shows with Unmark again, on installed phones too; the clients turn Mark off from the walk list's
    status;
  - the repair prints a canvasser count under 3 as *fewer than 3* (item 39's rule), and its dry-run total
    leaves out campaigns being deleted.
- **Web:**
  - a drawer write refused because the walk list was archived meanwhile now says so on the page (the
    drawer unmounts as its row moves);
  - the Bring back box shows a refusal once; the Archive-pass box keeps its words after a refusal and
    turns Archive off;
  - a refused Undo shows on its notice line, and a permanent refusal removes the link (on Walk Lists it
    points at Unarchive);
  - Campaign Home's rollup refreshes after a lifecycle change (its key was missed);
  - a held Bring back checks again every 30 seconds.
- **Phone:** the admin map's door sheet turns Mark off on an archived walk list (Unmark stays); admin
  Books refreshes after a 409, moving off a walk list archived elsewhere.
- **Docs and privacy:** late surveys follow the two-canvasser rule in an ended pass too (PASSES_AND_TURF
  Part 1, SURVEYS, the passes guide); item 43 (d) no `status`, (e) who started a pass now shows, (g) the
  small-count rule and a question for the owner on DPA §3; stale comments; the shared-file list; notes
  on what was built differently; two UI paraphrases.
- **Left as is:** Undo after Bring back re-archives in one click, without a typed confirm — the immediate
  reversal of the action just taken; and until the phone update, the installed app's admin Books still
  lists archived walk lists.

Verified after the round-2 fixes:

- **Unit tests:** web 1,167 of 1,167; phone 402 of 402; server 656 of 656. `vite build` passes, and the
  changed phone screens compile.
- **Integration suites:** walkListArchive 26, lateKnocks 15, repairArchivedWalkLists 8, restrictDoors 24,
  demoRebuild 18, liveIndex 5, and the 20 offline-replay suites.
- **Mutation checks:** each new retry test fails with its check turned off.
- **The reviewers' web flow probes, rerun:** the drawer refusal is on screen, the Bring back refusal shows
  once, the Archive box keeps its words, and a refused Undo sits on its notice line with no link.
- **The full integration run (all 186 suites, on the tree shared with the client report links build):**
  everything passes except two existing suites, each fixed in its test alone. `auditGpsStamps` wrote two
  doors with no `normalizedAddress`; once the test preload's longer build at connect let the model's
  unique `{ campaignId, normalizedAddress }` index land first, they collided. They now carry addresses.
  `crewJobEdges` drops its database after connecting, and a memoized `init()` doesn't rebuild what the
  drop took, so its roster test could plan with no index (COLLSCAN). This was a known flake, and the
  preload's timing made it fail more often. It now calls `createIndexes()`. Rerun: 8 of 8 three times, and
  18 of 18 four times.

