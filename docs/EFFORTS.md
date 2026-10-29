# Walk Lists (parallel canvassing within a campaign)

> Filename and the `Effort` model name are unchanged; the entity is **shown to users as a Walk list** (the operation). Throughout this doc, user-facing prose says "Walk list"; technical references to the `Effort` MODEL keep their original name.

How a campaign is split into several **walk lists** that run at the same time — different areas
(North/E/W/S) or different teams (volunteers vs paid) — each with its own doors, survey, crew, and
passes. This supersedes the old "one active pass per campaign" model.

- **Part 1 — For everyone** is plain language: the pieces, the rules, and the workflows.
- **Part 2 — Technical reference** is for developers (and Claude): models, ownership/intake,
  attribution, per-walk-list survey/reporting, and the migration.

Related: [PASSES.md](PASSES.md) (a walk list's **passes** — lifecycle, auto Pass 1, and where they're
managed), [WALKLISTS.md](WALKLISTS.md) (build a saved search — by filter or an uploaded Voter-ID list, CSV or Excel — to
seed/claim a walk list's doors), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (cutting a pass's doors into
books), [METRICS.md](METRICS.md) (per-walk-list reporting), [SURVEYS.md](SURVEYS.md) (per-walk-list
survey), [IMPORTS.md](IMPORTS.md) (how new voters reach a walk list via Intake).

---

# Part 1 — For everyone

## The pieces

```
Campaign
  └─ Walk list         a parallel operation (an area or a team)
       └─ Pass         one billable sweep within the walk list (Pass 1, Pass 2, …)
            └─ Book     a walkable slice of the pass (a canvasser's turf)
                 └─ Doors → Voters
```

A **walk list** is the persistent thing — "North Dallas", "the volunteer crew". It **owns a disjoint
set of doors**, an optional **survey**, and a **crew** of canvassers. Inside it you run **passes**
(Pass 1, Pass 2, …) — each pass is cut into **books** and assigned. Pass numbers restart per walk
list (North Pass 1, South Pass 1). Passes are managed *inside* the walk list — see [PASSES.md](PASSES.md).

## How the pieces relate — and the order you build them

Each piece depends on the one above it, so you build top-down:

1. **Walk list** — create it first (it owns the doors + survey + crew). Nothing else can exist without it.
   Creating one also creates its **Pass 1** automatically.
2. **Doors** — give the walk list its doors by claiming a **saved search** or **Intake** (see below). A
   walk list with no doors has nothing to cut.
3. **Pass** — Pass 1 already exists; add a follow-up **inside** the walk list when you need one. A pass
   can't exist on its own; it belongs to one walk list. (Pass 2 later = a new pass in the same walk list.)
4. **Books** — cut the pass into books (turf). A book belongs to one pass; re-cutting makes new books.
5. **Assignment** — assign a book to a canvasser. This is the link between a person and a book — and
   it's what fills the walk list's **crew** automatically (next section).

In short: **walk list → doors → pass → books → assign**. The step-by-step below walks each one.

## Door ownership and Intake

Every door belongs to **exactly one walk list**, or sits in **Intake** (owned by no walk list yet). Two
walk lists in one campaign never share a door — if you genuinely need the same doors worked by two
operations, that's **two campaigns**.

When you import new voters:
- A new voter at a door a walk list **already owns** rides along automatically (same physical door).
- A **new address** lands in **Intake** — not canvassed until you assign it to a walk list.

See [IMPORTS.md](IMPORTS.md) for the full import behavior.

## Several walk lists at once

A campaign can have **many active walk lists**, each with its **one active pass**. Canvassers see only
the books assigned to them, across whatever walk lists they're on. Activating a pass only archives the
*previous pass of that same walk list* — other walk lists keep running.

Because book numbers restart per walk list, a canvasser assigned to two walk lists could otherwise see two
"Book 6"s at once. So when a canvasser is on **more than one** walk list, the phone's **Books** screen shows
a **walk-list switcher** — they pick a walk list and see only that walk list's books (the choice is remembered).
A canvasser on a single walk list sees no switcher.

## The crew

A walk list's **crew** (the "Crew" count on the Walk Lists page) is **automatically whoever is assigned to
its current pass's books**. You don't maintain it — assign a book to someone and they're on the crew;
unassign them and they drop off; re-carve doors into a different walk list and the crews follow the
assignments. It's always an accurate picture of who's actually working the walk list, and it does **not**
restrict who you can assign (any active canvasser is still assignable to any book).

You can also **pre-add** people to a crew on the Walk Lists page (open a walk list → Crew → *Pre-add*) —
handy for lining up a team *before* you've cut/assigned their books. In the crew list, people show as
**assigned** (from a book) or **added** (pre-staged); you can only remove the pre-staged ones (assigned
people leave when you unassign their book on the Turf page).

## Per-walk-list survey and reporting

- Each walk list can **override the campaign's survey** (or inherit it). At the door, a canvasser is
  shown the survey of that door's walk list. Lit-drop campaigns have no survey, as before.
- The dashboard can be **filtered to one walk list** (knocks, surveys, coverage), or left on "All
  walk lists" for the whole-campaign totals (the sum across walk lists).
- That same filter runs through the rest of the console once a campaign has **two or more** walk
  lists (single-list campaigns hide it): the web dashboard's canvasser-responses modal honors it,
  the **live maps** get a walk-list select (web) / chip (mobile) ([MAPS.md](MAPS.md)), the **GPS
  audit** filters by walk list on web and mobile ([AUDIT.md](AUDIT.md)), the mobile **campaign
  screen** scopes Activity / By pass / Coverage / Top canvassers with a pill row, and the mobile
  **Timeline**'s walk-list pick follows into the whole canvasser drill-in and Compare
  ([ADMIN_APP.md](ADMIN_APP.md)).
- **Client reports** can be scoped to one walk list at creation (default: the whole campaign) — the
  report freezes the walk-list *name* and shows it to recipients
  ([CLIENT_PORTAL.md](CLIENT_PORTAL.md)).
- **Overlap round labels name their walk list** once a campaign has more than one — *North · Pass 2 ·
  GOTV* — because pass numbers restart per walk list, so "Pass 2" alone would be ambiguous.

## Archiving a walk list, and undoing it

Archive a walk list when its work is done. **Archiving ends its live pass**: its books leave canvassers'
phones the next time their map refreshes, and every knock already recorded stays counted. Nothing is
deleted — no knock, answer, note, book, assignment or snapshot.

- **The box says what will end.** On the Walk Lists page, **Archive** opens a box naming the live pass,
  how many books leave how many canvassers' phones, and how many knocks stay counted, plus any draft
  passes (they stay drafts) and how many doors stay with the walk list. With a pass live you type
  `archive` to confirm; with nothing live it's a plain **Archive** button.
- **Undo, right away.** A line at the top of the page — *North archived — Pass 3 ended.* — carries an
  **Undo** link that brings the walk list and its pass back in one click.
- **Unarchive, later.** **Unarchive** sits on each archived walk list, on its Passes page, and in the Turf
  Cutting banner. It asks about the pass that archiving ended: **Unarchive and bring Pass 3 back** returns
  the same books to the same canvassers' phones on their next refresh; **Unarchive only** leaves the pass
  ended, and it keeps its own **Bring back** button ([PASSES.md](PASSES.md)). When the pass can't come
  back — say a survey campaign has no survey attached any more — the box says why and offers a single
  **Unarchive**. When someone else is changing the walk list at that moment, it says *Someone else is
  changing this walk list right now. Try again in a minute.* and changes nothing.
- **Its draft passes stay drafts**, frozen while it's archived: they can't be cut or started until you
  unarchive.
- **Who can:** whoever can archive can undo — org admins, and team leads on the campaigns they manage.

**An archived walk list is read-only**, like an archived campaign:

- **Still allowed:** renaming it; claiming its doors **into another** walk list (a re-carve — archiving
  never releases its doors, so they stay with it until you do); Door Outcomes, flag review, notes and
  exports on its history; deleting an old Turf Cutting snapshot; unmarking a desk mark.
- **Refused**, with *Walk list "North" is archived — unarchive it to change it.*: claiming doors into it,
  adding or removing crew, changing its survey (a phone that was offline may still be sending answers to
  that survey, and a changed survey would refuse them), adding, renaming, deleting or starting a pass,
  and every book change on its passes (drafts included). Two refusals have their own sentence: bringing a
  pass back except through Unarchive (*Its walk list is archived — unarchive the walk list to bring this
  pass back.*) and desk marks on its doors (*Walk list "North" is archived — unarchive it to mark its
  doors.*).
- **Its history stays in every report.** Report filters keep it, marked "(archived)" and listed after the
  open walk lists; pickers you use to do work — the phone's admin Books, print packets, Mark restricted —
  leave it out.

**On canvassers' phones** (after the app update), a canvasser whose only book closed sees *No book right
now — The office closed or reassigned the book you were working. Anything you saved still counts.* Someone
with books on another walk list goes to their book list. A survey already open, and anything waiting to
send, still save, and count in the pass they were made in ([PASSES_AND_TURF.md](PASSES_AND_TURF.md) →
*Late knocks*).

**On an archived campaign** nothing here can change — walk lists can't be archived, unarchived, renamed,
deleted or claimed into, and their passes can't change. Reactivate the campaign first.

**Walk lists archived before this update (October 2026)** were only labelled archived: their pass could still be
live. Until Doorline's one-time check ends it, such a walk list shows *Archived · Pass 3 still live* in
amber, with **Unarchive** and **End Pass 3**; afterwards it reads *Archived · Pass 3 ended by the one-time
check*, and Unarchive can bring the pass back.

## The Walk Lists page

Each walk list has **one status** — never "archived" and "Live" on the same row:

| Status | What it means |
|---|---|
| *Live · Pass 3* | A pass is live. |
| *Setting up · 4/5 · next: …* | No pass has gone live yet; it names the next setup step. |
| *Between passes · Pass 1 ended Oct 20* | A pass has been live and none is live now (plus *· Pass 2 draft* when one is waiting). |
| *No passes yet* | The walk list has no pass. |
| *Archived Oct 27 by Ada · Pass 3 ended* | Archived, and archiving ended Pass 3. |
| *Archived Oct 27 by Ada* | Archived with nothing live to end. |
| *Archived · Pass 1 ended by the one-time check* | Archived before this update with a pass still live, which the one-time check ended. |
| *Archived* | Archived before this update — no date or name was recorded then. |
| *Archived · Pass 3 still live* (amber) | Archived before this update with its pass still live, until the one-time check runs; **End Pass 3** ends it now. |

- **Archived walk lists fold away** into an *Archived walk lists (N)* section at the bottom, closed by
  default. If every walk list is archived, the table says *No open walk lists — 2 archived below.* The
  **Walk Lists** card at the top counts the open ones, with the archived ones under it: *3*, *+2
  archived*.
- **What each row offers:** an open walk list has **Manage · Archive · Delete**; an archived one **View ·
  Unarchive · Delete**. **Delete** only shows when it can work — every pass of that walk list is still a
  draft (doors recorded there also stop a delete; the server still checks, and says so).
- **An archived walk list opens read-only.** You can rename it; everything else says *Unarchive North to
  change this.*
- **On an archived campaign** the page shows the campaign's archived banner, and archiving, unarchiving,
  renaming, deleting, claiming and passes are all off.
- The **Pass** column (it used to say *Active pass*) names the live pass.

## Step-by-step

### Create a walk list
1. **Saved Searches** page → build a saved search for the area/voters this walk list covers — either with the
   **filter builder** (precinct, party, district, etc.) or by **uploading a Voter-ID list** (a CSV or
   Excel file: an exact list you already have) — and save it. See [WALKLISTS.md](WALKLISTS.md). *(Skip if you'll claim doors
   another way.)*
2. **Walk Lists** page → **New walk list** → enter a name; if it's a survey campaign, optionally
   pick a **survey override** (else it uses the campaign's survey); pick the saved search under **Seed
   door-set**.
3. Click **Create walk list**. It claims that saved search's unclaimed (Intake) doors in the
   background — a progress line under the form shows the claim landing (moments for small lists). If
   some of the saved search's doors already belong to another walk list, the finished line says how
   many were **not moved** and offers **Move them here…**, which opens the same move (re-carve) confirm
   as the Claim panel — no second trip through the list's Passes panel.

### Run a pass (canvass a walk list)
1. **Walk Lists** page → open the walk list (**Manage**) → the **Passes** panel. Pass 1 already exists
   (it's created with the walk list); the panel is also where you add a follow-up with **New pass**.
2. **Turf Cutting** page → pick that pass → generate books (it cuts from the walk list's doors) →
   **Accept**.
3. Still on Turf Cutting → **Assign** each book to canvassers (use the walk list's roster).
4. Back in the walk list's **Passes** panel → **Activate** the pass. Canvassers on those books now see
   their doors.
5. For Pass 2 later: **New pass** in the same walk list and repeat — activating it archives the walk
   list's previous pass (other walk lists are untouched). See [PASSES.md](PASSES.md) for the details.

### Split your existing campaign into walk lists (re-carve)
Your campaign starts as one default walk list ("Main") owning every door.
1. **Saved Searches** → build a saved search for the first new area (e.g. North).
2. **Walk Lists** → **New walk list** "North", seed from that saved search. Because those doors are currently owned
   by "Main", the app asks you to confirm a **move (re-carve)** — confirm it; the doors leave "Main"
   and join "North" (and drop out of Main's books cleanly).
3. Repeat for each area. Then rename the leftover "Main" walk list, or **archive** it once you're done
   with it. Archiving ends its live pass, so any of its books still on canvassers' phones close on their
   next map refresh — check nobody is still working one (Unarchive can bring the pass back). A walk list
   whose passes are all still drafts, with nothing recorded, can be deleted instead.

### Run two crews (e.g. paid + volunteer) in one walk list
When two teams work the **same** territory, you don't need two walk lists — walk lists own *disjoint
doors*, so splitting the territory is one option, but the simpler path is one walk list where each crew
gets its own books:
1. **Team** tab → **Add to the campaign** → add everyone from both crews. This comes first: a crew is a
   fact about *this campaign*, so it can only be set on someone already on the campaign's team.
2. Still on the **Team** tab → click a canvasser → set their **Crew (coordinator)** to their crew lead
   (an admin or team lead) — e.g. paid folks under "Paid Lead", volunteers under "Vol Lead". This is what
   defines a crew, and the Team tab is the **only** place you set one. The team list then groups by crew,
   so you can see each team. See [USERS.md](USERS.md).
3. **Turf Cutting** → cut the walk list's pass into books (draw the crews' areas, or by size/precinct) → **Accept**.
4. Still on Turf Cutting → in the assign panel, use the **crew filter** to show just "Paid Lead", **Select
   all**, and assign them to the paid books; repeat for the volunteers. Books are disjoint and each
   canvasser only sees their own, so the crews never overlap (a book with both crews shows a "mixed crews" flag).
5. **Activate** the pass. Both crews go live.

**Per-crew reporting comes for free.** Open the campaign's **Timeline**: the **by-team** table gives you
each crew's doors, survey doors, surveys taken and connection rate side by side, with a Campaign row
that the crews add up to. You no longer need two walk lists just to keep two crews' numbers apart —
split the territory only if you actually want them working separate doors.

A team's numbers follow the **crew you have set today, in this campaign**: change someone's crew and
*all* of their doors **here** move onto the new crew, so a crew you forgot to set at the start is
fixable after the fact — and their doors in your *other* campaigns don't budge. That holds for someone
you've deactivated too, as long as they're still on this campaign's team, which is how you rescue their
doors from the "No team" bucket. Someone *leaving* moves nothing — their doors stay on the crew they
worked for. **Removing** them from the campaign takes their crew row with it, so if you need to move
their doors to another crew later, add them back to the campaign first. See
[METRICS.md](METRICS.md#teams-coordinators--the-counting-contract).

### Assign new voters (Intake)
1. After a voter upload, the **Walk Lists** page shows an **Intake** count (new addresses). The import
   never assigns a walk list — new addresses always wait in Intake until you claim them. (The same import
   also auto-applies any pending early-voter marks for those voters — see [EARLY_VOTING.md](EARLY_VOTING.md).)
2. Decide who owns them — an **existing** walk list, or a **new walk list** you create for these doors (make
   it first on the Walk Lists page, then claim). Open that walk list → **Claim** → either claim a specific
   **saved search** or **Claim all Intake**.
   - To route **exactly this file's** doors to their own walk list, build a **Saved Search from that file** after
     the import (upload the same CSV or Excel file there; it matches by Voter ID — see [WALKLISTS.md](WALKLISTS.md)) and seed/claim the new walk list
     from it. **Claim all Intake** is the quick path *only* when all current Intake is just these new
     addresses — it grabs **every** unowned door, so use a saved search when other Intake is mixed in.
3. **Turf Cutting** → that walk list's pass → **Add new doors → supplemental book** → **Accept** →
   **Assign**. The new doors are now in the field.
   (New voters at addresses a walk list *already* owns appear automatically — no steps needed.)

---

# Part 2 — Technical reference

Server: [routes/admin/efforts.js](../server/src/routes/admin/efforts.js) (walk-list CRUD + roster +
claim/intake — also auto-creates **Pass 1** on create via `createNextPass`; create-time seeding
enqueues the same claim job as `/claim`, so `POST /` returns `{effort, pass, claimJobId, claimError}` —
on enqueue failure the list exists **unseeded**, never half-created),
[routes/admin/passes.js](../server/src/routes/admin/passes.js) (passes, walk-list-scoped),
[services/passes/createPass.js](../server/src/services/passes/createPass.js) (the shared
`createNextPass` allocator), [services/passes/activePasses.js](../server/src/services/passes/activePasses.js).
See [PASSES.md](PASSES.md) for the pass lifecycle in full.

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Effort` | [models/Effort.js](../server/src/models/Effort.js) | `campaignId`, `name`, `surveyTemplateId?` (override → falls back to `Campaign.surveyTemplateId`), `seededFromWalkListId?` (audit), `status` (`active` / `archived`; `draft` is in the enum but unused). Since 2026-10-28: `archivedAt` + `archivedBy` (cleared on unarchive — the campaign History keeps both; null on walk lists archived before the fields existed), `endedPassId` (the live pass the current archive ended, so Unarchive can offer it back — read only while archived) and `lifecycleLock { lockedAt, token }` (§I). |
| `EffortMember` | [models/EffortMember.js](../server/src/models/EffortMember.js) | **Manual pre-stage list only**, unique `{effortId, userId}`. The displayed "crew" is *derived* (see §G), not this. |
| `Household.effortId` | [models/Household.js](../server/src/models/Household.js) | **Source of truth for door ownership.** `null` = Intake. Index `{campaignId, effortId}`. Disjointness = one effortId per door. |
| `Pass` (= Round) | [models/Pass.js](../server/src/models/Pass.js) | Gains `effortId` (required); `roundNumber` unique **per walk list** (`{effortId, roundNumber}`); `walkListId` retired (door-set comes from the walk list). |
| `Campaign` | [models/Campaign.js](../server/src/models/Campaign.js) | **`activePassId` dropped.** Active rounds derive from `Pass.status === 'active'` via `activePassIds()`. |
| `CanvassActivity` / `SurveyResponse` | — | Gain a denormalized `effortId` (stamped at attribution) for direct per-walk-list reporting. |

## B. Ownership, Intake, and disjointness

- **Intake is automatic:** new `Household` docs default `effortId: null`, and the CSV import upsert
  ([csvImporter.js](../server/src/services/import/csvImporter.js)) never sets `effortId` — so new
  addresses land in Intake with no import-processor change. Existing owned doors keep their effortId.
- **Claim** (`POST .../efforts/:id/claim`, body `{walkListId? | all? , force?}`): sets
  `Household.effortId`. **`all:true` ("Claim all Intake") targets only unowned doors (`effortId: null`)** —
  it claims every Intake door and **never conflicts**, even in a multi-walk-list campaign. A **`walkListId`**
  claim takes that saved search's Intake doors; any door in the saved search already owned by **another**
  walk list returns a **`409 doors-owned` with a per-donor breakdown** —
  `{conflicts, claimable, breakdown:[{effortId, effortName, doors, booksAffected, booksEmptied}],
  totalBooksAffected, totalBooksEmptied}` — which the web console renders as a real confirm modal
  before anything moves. With `force:true` (or no conflicts) the route **ENQUEUES** the move on the
  TURF queue and returns `202 {jobId, claimable, conflicts}` (poll `GET .../turfs/jobs/:jobId`;
  `503 queue-unavailable` when Redis is down; `{jobId: null}` when nothing would move). The old
  inline move outlived Heroku's 30s router timeout at 24k doors and took no lock (2026-08 incident).
  A create-time seed (`POST /efforts` + `seedWalkListId`) enqueues with `force:false`, so owned doors
  are **skipped**, not refused — the job result's `skippedOwned` says how many, and the Walk Lists
  page's claim line offers **Move them here…**, which re-claims the seed list without force and lets
  the expected 409 open the move-confirm modal (2026-10-13; before that the skip was silent).
  The job (`executeClaim` in [claimDoors.js](../server/src/services/walklist/claimDoors.js)):
  **snapshots every donor pass BEFORE mutating** (`TurfSnapshot` `reason:'move'`, deduped on the
  job id so a stall-redelivery can't double-capture), holds + renews the per-pass `recutLock` on
  each donor pass, moves the doors (clearing `turfId`/`walkOrder`), rebuilds the shrunk books in
  bulk (ownership-keyed sweep, so a re-run is a no-op), and re-clips only their territories.
  Emptied donor books **persist at 0 doors** (badged on the Turf page) — moving doors back later
  never rebuilds books. The full **undo** is: force-claim the doors back → Discard the donor pass's
  gutted books → Restore the `'move'` snapshot (books, memberships, and assignments return).
  Disjointness can never be violated silently.
- **Saved searches are source-agnostic here.** A saved search from the filter builder and one from an uploaded
  Voter-ID list are both just frozen `householdIds` (`SavedSearch.source` = `'filter' | 'csv'`; since
  2026-10-28 `'csv'` covers an uploaded Excel file too — the value predates Excel uploads and is kept,
  and the pages show it as **uploaded**), so
  seed/claim/re-carve treat them identically. See [WALKLISTS.md](WALKLISTS.md).
- **Archiving doesn't release doors.** Archiving a walk list ends its live pass and makes it read-only
  (§I), but it does **not** set `effortId` back to `null` (only **deleting** a walk list does, and a walk
  list with non-draft passes can't be deleted). So a newly imported voter at an address an archived walk list already owns stays on that walk list
  (the importer never re-owns a door). To move such doors into a new walk list, claim them with a
  **re-carve** — claims OUT of an archived walk list still work (claims INTO one are refused) — precisely
  targetable by uploading that voter list as a saved search ([WALKLISTS.md](WALKLISTS.md)).
- **Deleting is ledger-guarded.** `DELETE /efforts/:id` refuses (400 `has-history`) while any
  `CanvassActivity` or `SurveyResponse` references the walk list or its rounds — draft-rounds-only is
  NOT proof of no history, because knocks stamp the door's owner at write time
  (`resolveAttribution`, [services/canvass/attribution.js](../server/src/services/canvass/attribution.js));
  deleting the
  doc would orphan those rows into the by-pass report's **"Legacy / no pass"** bucket (the 2026-08
  incident). A **desk mark** is such a row too: a single home marked restricted from the Turf Cutting
  map, the Map page or the mobile admin app on a **draft** round ([PASSES_AND_TURF.md](PASSES_AND_TURF.md))
  blocks deleting the walk list until it is unmarked. Archive instead — it keeps the name resolvable
  in reports forever. Kept copies of earlier answers (`SurveyResponseArchive`) count as history too, and
  the delete takes each round's re-cut lock first (**409 `recut-locked`** while a discard or a restore holds
  one), since 2026-10-20. A delete takes its draft rounds' saved snapshots with them, knocks cleared into
  them included (since 2026-10-20 — only their own round could restore them; [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
  Part 2, `DELETE /passes/:id`). Orphans created
  before this guard are repaired with **`npm run repair:orphan-attribution`** (dashboard Run console;
  dry-run by default, `-- --apply` to write): it re-stamps rows whose walk list/round was deleted to
  the door's *current* list + round, and lists ambiguous rows (door back in Intake, several rounds
  none active) for manual review instead of guessing
  ([repairOrphanAttribution.js](../server/src/migrations/repairOrphanAttribution.js)).
  **`--passless`** (requires `--campaign`) additionally re-homes rows that dangle on nothing but carry
  `passId: null` — knocks recorded while a door sat in a valid list with no active book over it (the
  incident's second class; their totals were always right, only the round attribution was missing).
  Campaign-gated on purpose: platform-wide, `passId: null` deliberately marks pre-rounds-era history.
  A round-less survey answer whose voter already answered in the target round is never folded
  (`{voterId, passId}` is unique — the voter genuinely answered twice); it's listed for manual review.
  Since 2026-10-28 the delete runs under the walk list's **lifecycle lock** (§I, 409 `lifecycle-busy`
  while another lifecycle change holds it), refuses on an archived campaign (409 `campaign-archived`),
  and the Walk Lists page offers **Delete** only when `GET /efforts` says `canDelete` (every pass still a
  draft) — the ledger check above still runs. Its rules are otherwise unchanged, so an archived walk list
  that never went live can still be deleted.

## C. Passes & "active"

- `activePassIds(campaignId)` = `Pass.find({campaignId, status:'active'})` — one per active walk list.
  Replaces the single `Campaign.activePassId`.
- Creation goes through `createNextPass` ([createPass.js](../server/src/services/passes/createPass.js)),
  which scopes `roundNumber` per walk list (unique `{effortId, roundNumber}`, with an E11000 retry) and
  auto-labels a blank name `Pass {roundNumber}`. Called explicitly by `POST /passes` and implicitly
  (best-effort) by effort-create for **Pass 1**.
- Activation (`activatePass` in [passLifecycle.js](../server/src/services/passes/passLifecycle.js), called
  by [passes.js](../server/src/routes/admin/passes.js)) archives other active passes **of the same walk
  list only**, stamping each `archivedVia: 'next-pass'` and `endedByPassId` — a pass ended that way never
  comes back ([PASSES.md](PASSES.md)) — and refuses an archived walk list (409 `walk-list-archived`). At
  most one live pass per walk list is also enforced by the `one_live_pass_per_walk_list` index (§I).
  `GET /passes?effortId=` filters.
- Turf cut scope ([generateTurf.js](../server/src/services/turf/generateTurf.js)) = the pass's
  **walk list's owned doors** (`{campaignId, isActive, effortId, coords}`, plus the restricted /
  no-soliciting boxes' `_id: { $nin }` from `cutExclusionParts` when `params.excludeRestricted` /
  `excludeNoSoliciting` are set — the targeting ladder over each door's whole history, see
  [PASSES_AND_TURF.md](PASSES_AND_TURF.md)));
  `addSupplementalBooks` adds the walk list's owned-but-unbooked doors (same `excludeRestricted` option).

## D. Attribution & per-walk-list survey (mobile write path)

- **Deterministic attribution** (`resolveAttribution`, in
  [services/canvass/attribution.js](../server/src/services/canvass/attribution.js) since 2026-10-28 —
  it lived in [canvass.js](../server/src/routes/mobile/canvass.js) before): `effortId` = the door's owner,
  and the pass and book in two steps. **Step 1**, for a phone with the update (it sends the door's
  `turfId` from its bootstrap, read at tap time) while `LATE_KNOCK_ATTRIBUTION` isn't `off`: that book,
  if it is still published, still holds the door and belongs to a pass of the door's walk list — used as
  is on a live pass, and on an archived pass only when the knock was tapped no later than the pass's
  `archivedAt`, or before the live book's pass first went live (its `activatedAt`), or no live book holds
  the door. **Step 2**, today's rule and all an older phone gets: the
  door's published book among the campaign's **active rounds** → `passId`/`turfId`, else `passId: null`.
  Replaces the old `activatedAt` time-window (which was ambiguous with several active rounds). Stamps
  `passId`/`turfId`/`effortId` on the activity / response. Knock dedup key `(userId, householdId,
  passId)` is unchanged. Full rules, the switch and the edge cases: [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
  §F.
- **Survey** = `effort.surveyTemplateId || campaign.surveyTemplateId`; submit validates against it.
- **Bootstrap** ([bootstrap.js](../server/src/routes/mobile/bootstrap.js)): unions the canvasser's
  `TurfAssignment`s across all active rounds; returns each book tagged with `effortId` +
  `surveyTemplateId`, plus a `surveys` map. The app resolves a voter's survey via
  household → book → `surveyTemplateId` → `surveys[id]`, falling back to `activeSurvey`. It also returns
  an **`efforts: [{ id, name }]`** list (the distinct walk lists the canvasser has books in) so the Books
  screen can offer the **walk-list switcher** ([EffortPicker.jsx](../mobile/components/EffortPicker.jsx))
  and scope the picker to one walk list — see Part 1 §"Several walk lists at once". The chosen walk list persists
  via `saveCurrentEffort` ([cache.js](../mobile/lib/cache.js)).
- **Canvass scope (everyone, admins included).** The mobile canvass surfaces — `/bootstrap` (door
  list/map), `/changes` (30s delta), and `/me/today` (the "Remaining" stat) — all scope to the user's
  **own assigned books** via `canvasserHouseholdScope`
  ([canvasserScope.js](../server/src/services/canvass/canvasserScope.js)). This applies to **admins too**:
  an admin who canvasses is scoped to their own books (from the walk lists they're on), so two people never
  knock the same block — there is no "admin sees all houses" mobile map. **"Switch to canvass mode"**
  ([more.jsx](../mobile/app/(app)/admin/more.jsx) `onCanvassMode`, campaign screen `goCanvass`) just enters
  the normal canvasser flow at the Books picker. **Three outcomes, not two** — the third is the cached
  campaign, and it used to dead-end: assigned → their books → map; **unassigned → the "No turf assigned
  yet" screen**; **cached pick is ARCHIVED → the campaign picker**, not Books. `onCanvassMode` routed on
  the strength of an id alone, but `/mobile/bootstrap` 404s `Campaign inactive` for an archived campaign,
  which Books rendered as a Retry button with nothing behind it — an admin who had deliberately opened an
  archived campaign on an admin screen could not reach canvass mode again without force-quitting. It now
  checks `isActive` (via `archiveStateOf`) and sends an archived — or not-yet-resolved — pick to
  `/(app)/campaigns`, which is never a dead end because `/mobile/campaigns` is active-only and has its own
  empty state. Both canvasser error branches also gained a **"Choose a different campaign"** escape, and
  `bootstrapQuery` no longer serves its disk snapshot on a **404** — that fallback exists for connectivity
  failures, and using it here opened the field flow on stale doors whose knocks could never be recorded.
  Admin *oversight* (campaign-wide counts/coverage) lives in the `/admin` screens +
  web, on the separate `/admin/*` endpoints — never the canvass bootstrap.

## E. Reporting

`baseFilter` ([reports.js](../server/src/routes/admin/reports.js)) accepts an optional `effortId`
(and `passId`). Because `effortId` is denormalized onto `CanvassActivity`, `SurveyResponse`, and
`Household`, that one filter scopes knocks, surveys, and coverage together. Omit it for whole-campaign
totals. The mobile personal daily-stats breakdown ([me.js](../server/src/routes/mobile/me.js)) is
per-walk-list aware — it unions the choice questions from whatever survey(s) the canvasser's responses
actually used.

Surfaces that send it (each renders its walk-list control only with 2+ efforts): **web** —
DashboardPage (+ its `CanvasserResponsesModal`), MapPage, AuditPage, SurveyExplorerPage,
DoorOutcomesPage (where it doubles as the fix `MIXED_SURVEY_TEMPLATES` names — "filter by walk
list first" — and as a gate-satisfying narrowing for the survey-answer filter); **mobile** — the campaign
screen (overview / campaign-rollup / canvassers / knocks-by-pass), Timeline (`/canvasser-timeline`,
then threaded as a route param through every canvasser drill-in screen, the CSV export, and Compare —
so `/canvassers/:userId/summary` and `/team-averages` compare within the walk list), the GPS audit
(`/flags`), and the admin map. Client reports persist a per-report `effortId` + frozen `effortName`
instead of taking a query param ([CLIENT_PORTAL.md](CLIENT_PORTAL.md)). The overlap engines
(`computeOverlapDoors` / `computeOverlaps`,
[services/reports/overlaps.js](../server/src/services/reports/overlaps.js)) also emit a per-pass
`effortName` and prefix `roundLabel` with the walk-list name when the campaign has 2+ efforts
(`passLabeler`; single-list campaigns keep the short "Pass N · name" label).

The campaign home pages (web DashboardPage, mobile campaign screen) and the Timeline carry a second,
orthogonal filter dimension alongside the walk list: the **crew** filter (`?coordinatorId`). It
composes with `effortId` (the two intersect) and scopes the same activity/survey queries — but never
Households/Coverage, since a crew, unlike an effort, is **not** denormalized onto `Household`. See
[METRICS.md](METRICS.md) §F.

## F. Deploy & migrate (runbook)

[migrations/migrateEfforts.js](../server/src/migrations/migrateEfforts.js) (`--apply`): per campaign,
create one default `Effort` (`Main`), set `Household.effortId` for all current doors, tag every
`Pass.effortId`, backfill `effortId` on activities/responses, drop `Campaign.activePassId`, then
`syncIndexes()` (Pass roundNumber uniqueness moves to `{effortId, roundNumber}`). It is **idempotent**
and disables `autoIndex` for its own run so it can build the new unique index cleanly after the
backfill.

**The migration must finish before the updated web dyno boots** (the new Pass unique index needs
`effortId` populated). On Heroku this is wired via **release phase**, so it happens automatically:

- [`Procfile`](../Procfile): `release: node server/src/migrations/migrateEfforts.js --apply`. Heroku
  runs the `release` process after the build and **before** new web/worker dynos start; if it exits
  non-zero the release fails and the old release stays live (safe).
- **To deploy:** push/deploy as usual → watch the **release log** (Heroku Dashboard → *Activity*, or
  the deploy output) for `Efforts migration applied.`. The web dyno then boots on migrated data.
- **Safe to re-run:** for a campaign that still has a single walk list it re-folds harmlessly; once a
  campaign has **multiple walk lists** it **skips** (so re-runs never sweep new Intake doors into the
  default walk list — `effortCount > 1 → skip`). Recommended hygiene: **remove the `release:` line after
  the first successful deploy** so a one-time migration isn't part of every future release.

**Manual fallback (no Procfile line):** Heroku Dashboard → the app → **More ▸ Run console** →
`node server/src/migrations/migrateEfforts.js --apply` → **Run**, then **More ▸ Restart all dynos**.
Run without `--apply` first for a zero-write **dry run** (prints per-campaign counts, writes nothing).
The dry run is for the manual/local path — with release phase the real migration runs automatically on
deploy, so a separate dry run isn't needed.

## G. Crew (derived, not stored)

The displayed crew is computed in [efforts.js](../server/src/routes/admin/efforts.js), never synced:

- **`GET /efforts`** returns `crewCount` per walk list = `|`(`EffortMember` users) ∪ (distinct
  `TurfAssignment.userId` on the walk list's **active round's** books)`|`. Reuses the active-round lookup
  already in that handler; one `TurfAssignment.aggregate` keyed by `passId ∈ activePassIds`.
- **`GET /efforts/:id/members`** returns `crew: [{ user, viaRoster, viaAssignment }]` — the union of the
  manual roster and the active round's assignees, flagged by source.
- **Why derived:** it's always accurate and self-corrects on unassign / re-carve with no write-path
  hook and **no backfill** of pre-existing assignments. `EffortMember` is only the manual pre-stage
  layer; the real driver is `TurfAssignment` (per book, per round, created by
  [turfAssignments.js](../server/src/routes/admin/turfAssignments.js) — unchanged).
- **Removal:** the roster `DELETE …/members/:userId` removes only a manual `EffortMember`; an assigned
  person leaves the crew by being unassigned from the book (Turf page). The UI hides the remove `×` for
  anyone who is `viaAssignment`.

## H. Frontend

| File | Renders |
|---|---|
| [client/src/pages/EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) | Walk Lists list/create, crew (derived) + pre-add, claim/re-carve, Intake banner + assign, survey override. One **Status** cell per walk list from `walkListState` ([client/src/lib/walkListState.js](../client/src/lib/walkListState.js), pure, first match wins over the nine states in Part 1) and the row's actions from `walkListActions`; archived walk lists in a collapsed *Archived walk lists (N)* section (its open state a per-viewer `localStorage` convenience, wrapped in try/catch); the inline *Undo* line above the table; Archive / Unarchive / End Pass N through the shared dialogs in `client/src/components/walkListLifecycle/`. Drawer embeds `<PassManager variant="compact">`; for an archived walk list only the name field is live. |
| [client/src/components/PassManager.jsx](../client/src/components/PassManager.jsx) | All pass UI (new pass, activate, archive, **Bring back**, per-pass detail). Shared by the drawer (compact) and the scoped page (full). Read-only on an archived walk list, with an **Unarchive** banner. |
| [client/src/pages/PassesPage.jsx](../client/src/pages/PassesPage.jsx) | Thin wrapper at `/campaigns/:campaignId/efforts/:effortId/passes` — renders `<PassManager variant="full">` for one walk list (no picker); its title carries the walk list's status. |
| [client/src/pages/TurfsPage.jsx](../client/src/pages/TurfsPage.jsx) | Turf cutting; PassPicker groups passes **Live / Drafts / Archived** (`groupPassesByState`, [passPicker.js](../client/src/lib/passPicker.js)), labels them by walk list and defaults to an active pass. An archived pass, any pass of an archived walk list and an archived campaign open **view-only** ([PASSES_AND_TURF.md](PASSES_AND_TURF.md)). |
| [client/src/lib/walkListOptions.js](../client/src/lib/walkListOptions.js) (+ [mobile/lib/walkListOptions.js](../mobile/lib/walkListOptions.js), byte-identical below its header and held there by `walkListOptions.parity.test.js`) | How every picker lists walk lists: report filters use `walkListOptions` (open first, then archived ones labelled "North (archived)"), work pickers `openWalkLists`; `passOptionLabel` → "North · Pass 3 · GOTV". |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Walk-list filter → passes `effortId` to the reports endpoints. |
| [mobile/lib/doorSurvey.js](../mobile/lib/doorSurvey.js) | Resolves the survey per door from `books`/`surveys` (`surveyForDoor`, read by [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx)), and the surveys **Practice the survey** offers, one per distinct survey across the user's books, named by walk list (`practiceSurveys`). |

## I. Archive, unarchive and the read-only walk list (2026-10-28)

Built to [PROPOSAL_WALK_LIST_ARCHIVE.md](PROPOSAL_WALK_LIST_ARCHIVE.md) (plan v3). Every lifecycle write
goes through ONE service, [services/passes/passLifecycle.js](../server/src/services/passes/passLifecycle.js):
`archiveWalkList`, `unarchiveWalkList`, `archivePass`, `bringBackPass`, `activatePass` and the one-time
`repairWalkList`. Nothing else writes `Pass.status` except `createNextPass` (new drafts), discard's
conditional active → draft revert ([turfs.js](../server/src/routes/admin/turfs.js)), the demo seeder and
the delete routes. Invariant: **a pass of an archived walk list is never live** — the one exception is a
walk list archived before this change, until the one-time repair runs.

- **The lifecycle lock.** Each export takes the walk list's `Effort.lifecycleLock` **once** (a
  compare-and-set with the recut lock's token and 5-minute staleness rule), then runs unlocked internal
  steps — the lock is not re-entrant, so an export calling another export would lose to itself. It
  serializes archive, unarchive, archive-pass, bring-back, activation and the walk-list and draft-pass
  deletes across **all** passes of one walk list, which per-pass recut locks can't (a bring-back of Pass 2
  and an archive of the walk list take different ones). Busy → **409 `lifecycle-busy`** with `temporary:
  true` (*Someone else is changing this walk list right now. Try again in a minute.*). Exports that end
  or restore a pass also take that pass's recut lock (409 `recut-locked`, temporary); activation
  deliberately doesn't, so starting the next pass never waits for a claim or supplemental job on the old
  one. Jobs never take the lifecycle lock, and every lock is try-once, so nothing deadlocks.
- **Archive** — `POST /efforts/:id/archive` `{ confirmArchive }` → `{ effort, endedPassId, endedPass }`
  (`endedPass` `{ _id, roundNumber, name }` or null — the pass this archive ended, named, so the page's
  notice and its Undo follow what the server did even when a pass went live after the box opened). With
  a live pass and no `confirmArchive: true`: 409 `archive-confirm-required` (the web dialog sends the flag
  only after the typed confirm, and re-asks on that 409). Then, in order: under the live pass's recut lock — every
  live pass's, on data from before the one-live-pass index (409 `recut-locked`, and nothing changes) —
  record `Effort.endedPassId` (the walk list is still open, and the field is read only while archived) and
  end the pass (`status: 'archived'`, `archivedAt`, `archivedFrom: 'active'`, `archivedVia: 'walk-list'`,
  `archivedBy`); with several live, the others first and the one Unarchive offers 1 ms after them
  (`endPassesOfferingLast`: a pass from before `lastActivatedAt` counts as live until it ended, so ended
  after the offered one it would block that one's bring back under rule 4b); archive the walk list
  (`status`, `archivedAt`, `archivedBy`); write one History row. A
  crash between the pass and the walk list leaves an open walk list with an ended pass (its own Bring back
  fixes that); archiving again finds nothing live, keeps `endedPassId`, and archives. On a walk list
  already archived **with** a live pass (the pre-repair amber state) the same call ends that pass — the
  row's **End Pass N**; with nothing live it is 409 `already-archived`. Drafts, `Household.effortId`,
  books, assignments, `EffortMember`, snapshots and the ledger are untouched. `GET
  /efforts/:id/archive-preview` → `{ livePass: { _id, roundNumber, name, books, canvassers, knocks } | null,
  drafts, doors }` is the only source of the dialog's stakes (knocks via `knocksPipeline(…, { byPass: true
  })`, so they match the Passes panel).
- **Unarchive** — `POST /efforts/:id/unarchive` `{ bringBack }` → `{ effort, broughtBack, to,
  bringBackError? }`. 409 `not-archived`; with `bringBack: true` and no ended pass on file, 409
  `nothing-to-bring-back`. The Bring back verdict ([PASSES.md](PASSES.md)) is checked **before** anything
  changes, so a refusal leaves the walk list archived. Then it reopens the walk list **first** (`status:
  'active'`, `archivedAt`/`archivedBy` cleared — History keeps them), brings the pass back as an internal
  step under the lock it already holds (no History row of its own), clears `endedPassId`, and writes one
  row. That order means a crash can leave an open walk list with an ended pass, never an archived walk
  list with a live one. If the bring-back step fails after the reopen, the answer is still 200, with
  `bringBackError: { code, error }` (*"North" is unarchived, but Pass 3 couldn't come back: …*), which the
  dialog shows as a warning. `GET /efforts/:id/unarchive-preview` → `{ endedPass: null | { _id,
  roundNumber, name, archivedAt, archivedVia, archivedByName, bringBack } }`.
- **`GET /efforts`** adds per walk list `archivedAt`, `archivedByName` (through `hydrateCanvassers`, as
  History does, so a deleted account reads as its tombstone), `endedPassId`, `canDelete` (every pass still a
  draft — the delete route's own first rule; it still checks the ledger), `everLive` (some pass has an
  `activatedAt`) and `lastEndedPass: { _id, roundNumber, name, archivedAt, archivedVia } | null` (its most
  recently archived pass). `activeRound` and `setup` are computed as before; an archived walk list has an
  `activeRound` only in the pre-repair state, and the page ignores `setup` for archived walk lists.
  `lifecycleLock` is never sent.
- **The guards** ([middleware/campaignWritable.js](../server/src/middleware/campaignWritable.js)), beside
  `assertCampaignWritable` and with its 409-never-403 contract: `assertWalkListWritable(res, effort)`
  (sync, returns a boolean) answers **409 `walk-list-archived`** (*Walk list "North" is archived —
  unarchive it to change it.*); `assertPassWritable(res, pass, effort?)` (async) answers **409
  `pass-archived`** (*Pass 3 · GOTV is archived — bring it back to change it.*) for an archived pass and
  `walk-list-archived` for any pass of an archived walk list, which covers its frozen drafts. On the
  efforts router they guard a claim INTO the walk list, roster add/remove and a `surveyTemplateId` PATCH —
  a phone that was offline may still be sending answers to that survey, and the survey route refuses a
  mismatch, which would drop them; `PATCH { name }` stays allowed. The passes router guards create, rename
  and delete; the turf and assignment routes guard every book write ([PASSES_AND_TURF.md](PASSES_AND_TURF.md)
  §C); desk marks on its doors refuse in [deskRestrict.js](../server/src/services/canvass/deskRestrict.js)
  ([MAPS.md](MAPS.md)). The claim job (`executeClaim`) re-checks that its TARGET walk list is open; donor
  passes keep shrinking, locking and snapshotting as before, which is why a re-carve OUT of an archived
  walk list still works.
- **Archived campaign.** `requireActiveCampaign()` is mounted on the efforts and passes routers (after
  `loadCampaign`), so every write there — archive, unarchive, rename, delete, claim, and every pass
  action — answers 409 `campaign-archived`; reads stay open ([CAMPAIGNS.md](CAMPAIGNS.md) Part 2).
- **One live pass per walk list, enforced.** `Pass` index `one_live_pass_per_walk_list`: `{ status: 1,
  effortId: 1 }`, unique, partial `{ status: 'active', effortId: { $type: 'objectId' } }`. Not `{
  effortId: 1 }` — that key pattern already exists (`effortId`'s own index), and `migrate:build-indexes`
  decides "missing" by key pattern alone, so it would never be built; the `$type` filter keeps live passes
  from before walk lists existed from colliding on null. Production builds it with `npm run
  migrate:build-indexes -- --apply` **after** the one-time repair ([OPERATIONS.md](OPERATIONS.md)); until
  then the code behaves as before. A duplicate-key error from activation or a bring-back becomes 409
  `another-pass-live`. Tests build it in [testIndexPreload.mjs](../server/scripts/testIndexPreload.mjs).
- **History.** Each act writes one `CampaignChange` row with `source: 'walk_list_lifecycle'` — fields
  `walkListArchived`, `walkListUnarchived`, `passArchived`, `passBroughtBack` — readable
  `fromValue`/`toValue` for phones without the sentence renderer, and `details: { walkList, pass, outcome
  }` for the ones with it ([CAMPAIGNS.md](CAMPAIGNS.md) Part 2). Activation writes none (routine, and it
  would crowd the feed's 200-row cap).
- **The one-time repair** — walk lists archived before this change with a pass still live, and any walk
  list holding two live passes — is `npm run repair:archived-walk-lists`
  ([migrations/repairArchivedWalkLists.js](../server/src/migrations/repairArchivedWalkLists.js); runbook in
  [OPERATIONS.md](OPERATIONS.md)).
