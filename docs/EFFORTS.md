# Walk Lists (parallel canvassing within a campaign)

> Filename and the `Effort` model name are unchanged; the entity is **shown to users as a Walk list** (the operation). Throughout this doc, user-facing prose says "Walk list"; technical references to the `Effort` MODEL keep their original name.

How a campaign is split into several **walk lists** that run at the same time — different areas
(North/E/W/S) or different teams (volunteers vs paid) — each with its own doors, survey, crew, and
passes. This supersedes the old "one active pass per campaign" model.

- **Part 1 — For everyone** is plain language: the pieces, the rules, and the workflows.
- **Part 2 — Technical reference** is for developers (and Claude): models, ownership/intake,
  attribution, per-walk-list survey/reporting, and the migration.

Related: [PASSES.md](PASSES.md) (a walk list's **passes** — lifecycle, auto Pass 1, and where they're
managed), [WALKLISTS.md](WALKLISTS.md) (build a saved search — by filter or uploaded Voter-ID CSV — to
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

## Step-by-step

### Create a walk list
1. **Saved Searches** page → build a saved search for the area/voters this walk list covers — either with the
   **filter builder** (precinct, party, district, etc.) or by **uploading a Voter-ID CSV** (an exact
   list you already have) — and save it. See [WALKLISTS.md](WALKLISTS.md). *(Skip if you'll claim doors
   another way.)*
2. **Walk Lists** page → **New walk list** → enter a name; if it's a survey campaign, optionally
   pick a **survey override** (else it uses the campaign's survey); pick the saved search under **Seed
   door-set**.
3. Click **Create walk list**. It now owns that saved search's unclaimed (Intake) doors.

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
3. Repeat for each area. Rename or delete the leftover "Main" walk list when it's empty.

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
   - To route **exactly this CSV's** doors to their own walk list, build a **Saved Search from that CSV** after
     the import (it matches by Voter ID — see [WALKLISTS.md](WALKLISTS.md)) and seed/claim the new walk list
     from it. **Claim all Intake** is the quick path *only* when all current Intake is just these new
     addresses — it grabs **every** unowned door, so use a saved search when other Intake is mixed in.
3. **Turf Cutting** → that walk list's pass → **Add new doors → supplemental book** → **Accept** →
   **Assign**. The new doors are now in the field.
   (New voters at addresses a walk list *already* owns appear automatically — no steps needed.)

---

# Part 2 — Technical reference

Server: [routes/admin/efforts.js](../server/src/routes/admin/efforts.js) (walk-list CRUD + roster +
claim/intake — also auto-creates **Pass 1** on create via `createNextPass`),
[routes/admin/passes.js](../server/src/routes/admin/passes.js) (passes, walk-list-scoped),
[services/passes/createPass.js](../server/src/services/passes/createPass.js) (the shared
`createNextPass` allocator), [services/passes/activePasses.js](../server/src/services/passes/activePasses.js).
See [PASSES.md](PASSES.md) for the pass lifecycle in full.

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Effort` | [models/Effort.js](../server/src/models/Effort.js) | `campaignId`, `name`, `surveyTemplateId?` (override → falls back to `Campaign.surveyTemplateId`), `seededFromWalkListId?` (audit), `status` (draft/active/archived). |
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
  claim takes that saved search's Intake doors; any door in the saved search already owned by **another** walk list returns a
  `409 doors-owned` unless `force:true` (the re-carve path), which also clears their `turfId`/`walkOrder`
  and pulls them from their old book (`recomputeTurf`). Disjointness can never be violated silently.
- **Saved searches are source-agnostic here.** A saved search from the filter builder and one from an uploaded
  Voter-ID CSV are both just frozen `householdIds` (`SavedSearch.source` = `'filter' | 'csv'`), so
  seed/claim/re-carve treat them identically. See [WALKLISTS.md](WALKLISTS.md).
- **Archiving doesn't release doors.** Archive is only a status flag — it does **not** set `effortId`
  back to `null` (only **deleting** a walk list does, and a walk list with non-draft passes can't be
  deleted). So a newly imported voter at an address an archived walk list already owns stays on that walk list
  (the importer never re-owns a door). To move such doors into a new walk list, claim them with a
  **re-carve** — precisely targetable by uploading that voter list as a saved search
  ([WALKLISTS.md](WALKLISTS.md)).

## C. Passes & "active"

- `activePassIds(campaignId)` = `Pass.find({campaignId, status:'active'})` — one per active walk list.
  Replaces the single `Campaign.activePassId`.
- Creation goes through `createNextPass` ([createPass.js](../server/src/services/passes/createPass.js)),
  which scopes `roundNumber` per walk list (unique `{effortId, roundNumber}`, with an E11000 retry) and
  auto-labels a blank name `Pass {roundNumber}`. Called explicitly by `POST /passes` and implicitly
  (best-effort) by effort-create for **Pass 1**.
- Activation ([passes.js](../server/src/routes/admin/passes.js)) archives other active passes **of the
  same walk list only**. `GET /passes?effortId=` filters.
- Turf cut scope ([generateTurf.js](../server/src/services/turf/generateTurf.js)) = the pass's
  **walk list's owned doors** (`{campaignId, isActive, effortId, coords}`, plus
  `status: { $ne: 'restricted' }` when the cut's `params.excludeRestricted` is set — the opt-in
  "exclude restricted-access homes" toggle, see [PASSES_AND_TURF.md](PASSES_AND_TURF.md)));
  `addSupplementalBooks` adds the walk list's owned-but-unbooked doors (same `excludeRestricted` option).

## D. Attribution & per-walk-list survey (mobile write path)

- **Deterministic attribution** ([canvass.js](../server/src/routes/mobile/canvass.js)
  `resolveAttribution`): a door → its published book among the campaign's **active rounds** →
  `passId`/`turfId`; `effortId` = the door's owner. Replaces the old `activatedAt` time-window (which
  was ambiguous with several active rounds). Stamps `passId`/`turfId`/`effortId` on the activity /
  response. Knock dedup key `(userId, householdId, passId)` is unchanged.
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
DashboardPage (+ its `CanvasserResponsesModal`), MapPage, AuditPage; **mobile** — the campaign
screen (overview / campaign-rollup / canvassers / knocks-by-pass), Timeline (`/canvasser-timeline`,
then threaded as a route param through every canvasser drill-in screen, the CSV export, and Compare —
so `/canvassers/:userId/summary` and `/team-averages` compare within the walk list), the GPS audit
(`/flags`), and the admin map. Client reports persist a per-report `effortId` + frozen `effortName`
instead of taking a query param ([CLIENT_PORTAL.md](CLIENT_PORTAL.md)). The overlap engines
(`computeOverlapDoors` / `computeOverlaps`,
[services/reports/overlaps.js](../server/src/services/reports/overlaps.js)) also emit a per-pass
`effortName` and prefix `roundLabel` with the walk-list name when the campaign has 2+ efforts
(`passLabeler`; single-list campaigns keep the short "Pass N · name" label).

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
| [client/src/pages/EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) | Walk Lists list/create, crew (derived) + pre-add, claim/re-carve, Intake banner + assign, survey override. Drawer embeds `<PassManager variant="compact">`. |
| [client/src/components/PassManager.jsx](../client/src/components/PassManager.jsx) | All pass UI (new pass, activate, archive, per-pass detail). Shared by the drawer (compact) and the scoped page (full). |
| [client/src/pages/PassesPage.jsx](../client/src/pages/PassesPage.jsx) | Thin wrapper at `/campaigns/:campaignId/efforts/:effortId/passes` — renders `<PassManager variant="full">` for one walk list (no picker). |
| [client/src/pages/TurfsPage.jsx](../client/src/pages/TurfsPage.jsx) | Turf cutting; PassPicker labels passes by walk list and defaults to an active pass. |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Walk-list filter → passes `effortId` to the reports endpoints. |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | Resolves the survey per door from `books`/`surveys`. |
