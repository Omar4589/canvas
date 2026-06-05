# Efforts (parallel canvassing within a campaign)

How a campaign is split into several **efforts** that run at the same time — different areas
(North/E/W/S) or different teams (volunteers vs paid) — each with its own doors, survey, crew, and
rounds. This supersedes the old "one active pass per campaign" model.

- **Part 1 — For everyone** is plain language: the pieces, the rules, and the workflows.
- **Part 2 — Technical reference** is for developers (and Claude): models, ownership/intake,
  attribution, per-effort survey/reporting, and the migration.

Related: [WALKLISTS.md](WALKLISTS.md) (build a list — by filter or uploaded Voter-ID CSV — to
seed/claim an effort's doors), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (rounds + turf cutting — a
"pass" is now a Round within an effort), [METRICS.md](METRICS.md) (per-effort reporting),
[SURVEYS.md](SURVEYS.md) (per-effort survey), [IMPORTS.md](IMPORTS.md) (how new voters reach an effort
via Intake).

---

# Part 1 — For everyone

## The pieces

```
Campaign
  └─ Effort            a parallel operation (an area or a team)
       └─ Round        one sweep within the effort (= a "pass"; the billing unit)
            └─ Book     a walkable slice of the round (a canvasser's turf)
                 └─ Doors → Voters
```

An **effort** is the persistent thing — "North Dallas", "the volunteer crew". It **owns a disjoint
set of doors**, an optional **survey**, and a **crew** of canvassers. Inside it you run **Rounds**
(Round 1, Round 2, …) — each round is cut into **books** and assigned, exactly like passes worked
before. Round numbers restart per effort (North Round 1, South Round 1).

## How the pieces relate — and the order you build them

Each piece depends on the one above it, so you build top-down:

1. **Effort** — create it first (it owns the doors + survey + crew). Nothing else can exist without it.
2. **Doors** — give the effort its doors by claiming a **walk list** or **Intake** (see below). An
   effort with no doors has nothing to cut.
3. **Round** — make a round *inside* the effort. A round can't exist on its own; it belongs to one
   effort. (Round 2 later = a new round in the same effort.)
4. **Books** — cut the round into books (turf). A book belongs to one round; re-cutting makes new books.
5. **Assignment** — assign a book to a canvasser. This is the link between a person and a book — and
   it's what fills the effort's **crew** automatically (next section).

In short: **effort → doors → round → books → assign**. The step-by-step below walks each one.

## Door ownership and Intake

Every door belongs to **exactly one effort**, or sits in **Intake** (owned by no effort yet). Two
efforts in one campaign never share a door — if you genuinely need the same doors worked by two
operations, that's **two campaigns**.

When you import new voters:
- A new voter at a door an effort **already owns** rides along automatically (same physical door).
- A **new address** lands in **Intake** — not canvassed until you assign it to an effort.

See [IMPORTS.md](IMPORTS.md) for the full import behavior.

## Several efforts at once

A campaign can have **many active efforts**, each with its **one active round**. Canvassers see only
the books assigned to them, across whatever efforts they're on. Activating a round only archives the
*previous round of that same effort* — other efforts keep running.

## The crew

An effort's **crew** (the "Crew" count on the Efforts page) is **automatically whoever is assigned to
its current round's books**. You don't maintain it — assign a book to someone and they're on the crew;
unassign them and they drop off; re-carve doors into a different effort and the crews follow the
assignments. It's always an accurate picture of who's actually working the effort, and it does **not**
restrict who you can assign (any active canvasser is still assignable to any book).

You can also **pre-add** people to a crew on the Efforts page (open an effort → Crew → *Pre-add*) —
handy for lining up a team *before* you've cut/assigned their books. In the crew list, people show as
**assigned** (from a book) or **added** (pre-staged); you can only remove the pre-staged ones (assigned
people leave when you unassign their book on the Turf page).

## Per-effort survey and reporting

- Each effort can **override the campaign's survey** (or inherit it). At the door, a canvasser is
  shown the survey of that door's effort. Lit-drop campaigns have no survey, as before.
- The dashboard can be **filtered to one effort** (knocks, surveys, coverage), or left on "All
  efforts" for the whole-campaign totals (the sum across efforts).

## Step-by-step

### Create an effort
1. **Walk Lists** page → build a list for the area/voters this effort covers — either with the
   **filter builder** (precinct, party, district, etc.) or by **uploading a Voter-ID CSV** (an exact
   list you already have) — and save it. See [WALKLISTS.md](WALKLISTS.md). *(Skip if you'll claim doors
   another way.)*
2. **Efforts** page → **New effort** → enter a name; if it's a survey campaign, optionally
   pick a **survey override** (else it uses the campaign's survey); pick the walk list under **Seed
   door-set**.
3. Click **Create effort**. It now owns that list's unclaimed (Intake) doors.

### Run a round (canvass an effort)
1. **Rounds** page → choose the effort (top-right) → **New round** → name it → **Create round**.
2. **Turf Cutting** page → pick that round → generate books (it cuts from the effort's doors) →
   **Accept**.
3. Still on Turf Cutting → **Assign** each book to canvassers (use the effort's roster).
4. **Rounds** page → **Activate** the round. Canvassers on those books now see their doors.
5. For Round 2 later: make a new round in the same effort and repeat — activating it archives the
   effort's previous round (other efforts are untouched).

### Split your existing campaign into efforts (re-carve)
Your campaign starts as one default effort ("Main") owning every door.
1. **Walk Lists** → build a list for the first new area (e.g. North).
2. **Efforts** → **New effort** "North", seed from that list. Because those doors are currently owned
   by "Main", the app asks you to confirm a **move (re-carve)** — confirm it; the doors leave "Main"
   and join "North" (and drop out of Main's books cleanly).
3. Repeat for each area. Rename or delete the leftover "Main" effort when it's empty.

### Assign new voters (Intake)
1. After a voter upload, the **Efforts** page shows an **Intake** count (new addresses). The import
   never assigns an effort — new addresses always wait in Intake until you claim them. (The same import
   also auto-applies any pending early-voter marks for those voters — see [EARLY_VOTING.md](EARLY_VOTING.md).)
2. Decide who owns them — an **existing** effort, or a **new effort** you create for these doors (make
   it first on the Efforts page, then claim). Open that effort → **Claim** → either claim a specific
   **walk list** or **Claim all Intake**.
   - To route **exactly this CSV's** doors to their own effort, build a **Walk List from that CSV** after
     the import (it matches by Voter ID — see [WALKLISTS.md](WALKLISTS.md)) and seed/claim the new effort
     from it. **Claim all Intake** is the quick path *only* when all current Intake is just these new
     addresses — it grabs **every** unowned door, so use a walk list when other Intake is mixed in.
3. **Turf Cutting** → that effort's round → **Add new doors → supplemental book** → **Accept** →
   **Assign** (a brand-new effort needs a round created first). The new doors are now in the field.
   (New voters at addresses an effort *already* owns appear automatically — no steps needed.)

---

# Part 2 — Technical reference

Server: [routes/admin/efforts.js](../server/src/routes/admin/efforts.js) (effort CRUD + roster +
claim/intake), [routes/admin/passes.js](../server/src/routes/admin/passes.js) (rounds, now
effort-scoped), [services/passes/activePasses.js](../server/src/services/passes/activePasses.js).

## A. Data model

| Model | File | Notes |
|---|---|---|
| `Effort` | [models/Effort.js](../server/src/models/Effort.js) | `campaignId`, `name`, `surveyTemplateId?` (override → falls back to `Campaign.surveyTemplateId`), `seededFromWalkListId?` (audit), `status` (draft/active/archived). |
| `EffortMember` | [models/EffortMember.js](../server/src/models/EffortMember.js) | **Manual pre-stage list only**, unique `{effortId, userId}`. The displayed "crew" is *derived* (see §G), not this. |
| `Household.effortId` | [models/Household.js](../server/src/models/Household.js) | **Source of truth for door ownership.** `null` = Intake. Index `{campaignId, effortId}`. Disjointness = one effortId per door. |
| `Pass` (= Round) | [models/Pass.js](../server/src/models/Pass.js) | Gains `effortId` (required); `roundNumber` unique **per effort** (`{effortId, roundNumber}`); `walkListId` retired (door-set comes from the effort). |
| `Campaign` | [models/Campaign.js](../server/src/models/Campaign.js) | **`activePassId` dropped.** Active rounds derive from `Pass.status === 'active'` via `activePassIds()`. |
| `CanvassActivity` / `SurveyResponse` | — | Gain a denormalized `effortId` (stamped at attribution) for direct per-effort reporting. |

## B. Ownership, Intake, and disjointness

- **Intake is automatic:** new `Household` docs default `effortId: null`, and the CSV import upsert
  ([csvImporter.js](../server/src/services/import/csvImporter.js)) never sets `effortId` — so new
  addresses land in Intake with no import-processor change. Existing owned doors keep their effortId.
- **Claim** (`POST .../efforts/:id/claim`, body `{walkListId? | all? , force?}`): sets
  `Household.effortId`. **`all:true` ("Claim all Intake") targets only unowned doors (`effortId: null`)** —
  it claims every Intake door and **never conflicts**, even in a multi-effort campaign. A **`walkListId`**
  claim takes that list's Intake doors; any door in the list already owned by **another** effort returns a
  `409 doors-owned` unless `force:true` (the re-carve path), which also clears their `turfId`/`walkOrder`
  and pulls them from their old book (`recomputeTurf`). Disjointness can never be violated silently.
- **Walk lists are source-agnostic here.** A list from the filter builder and one from an uploaded
  Voter-ID CSV are both just frozen `householdIds` (`WalkList.source` = `'filter' | 'csv'`), so
  seed/claim/re-carve treat them identically. See [WALKLISTS.md](WALKLISTS.md).
- **Archiving doesn't release doors.** Archive is only a status flag — it does **not** set `effortId`
  back to `null` (only **deleting** an effort does, and an effort with non-draft rounds can't be
  deleted). So a newly imported voter at an address an archived effort already owns stays on that effort
  (the importer never re-owns a door). To move such doors into a new effort, claim them with a
  **re-carve** — precisely targetable by uploading that voter list as a walk list
  ([WALKLISTS.md](WALKLISTS.md)).

## C. Rounds & "active"

- `activePassIds(campaignId)` = `Pass.find({campaignId, status:'active'})` — one per active effort.
  Replaces the single `Campaign.activePassId`.
- Activation ([passes.js](../server/src/routes/admin/passes.js)) archives other active rounds **of the
  same effort only**. Create scopes `roundNumber` per effort; `GET /passes?effortId=` filters.
- Turf cut scope ([generateTurf.js](../server/src/services/turf/generateTurf.js)) = the round's
  **effort's owned doors** (`{campaignId, isActive, effortId, coords}`); `addSupplementalBooks` adds
  the effort's owned-but-unbooked doors.

## D. Attribution & per-effort survey (mobile write path)

- **Deterministic attribution** ([canvass.js](../server/src/routes/mobile/canvass.js)
  `resolveAttribution`): a door → its published book among the campaign's **active rounds** →
  `passId`/`turfId`; `effortId` = the door's owner. Replaces the old `activatedAt` time-window (which
  was ambiguous with several active rounds). Stamps `passId`/`turfId`/`effortId` on the activity /
  response. Knock dedup key `(userId, householdId, passId)` is unchanged.
- **Survey** = `effort.surveyTemplateId || campaign.surveyTemplateId`; submit validates against it.
- **Bootstrap** ([bootstrap.js](../server/src/routes/mobile/bootstrap.js)): unions the canvasser's
  `TurfAssignment`s across all active rounds; returns each book tagged with `effortId` +
  `surveyTemplateId`, plus a `surveys` map. The app resolves a voter's survey via
  household → book → `surveyTemplateId` → `surveys[id]`, falling back to `activeSurvey`.

## E. Reporting

`baseFilter` ([reports.js](../server/src/routes/admin/reports.js)) accepts an optional `effortId`
(and `passId`). Because `effortId` is denormalized onto `CanvassActivity`, `SurveyResponse`, and
`Household`, that one filter scopes knocks, surveys, and coverage together. Omit it for whole-campaign
totals. The mobile personal daily-stats breakdown ([me.js](../server/src/routes/mobile/me.js)) is
per-effort aware — it unions the choice questions from whatever survey(s) the canvasser's responses
actually used.

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
- **Safe to re-run:** for a campaign that still has a single effort it re-folds harmlessly; once a
  campaign has **multiple efforts** it **skips** (so re-runs never sweep new Intake doors into the
  default effort — `effortCount > 1 → skip`). Recommended hygiene: **remove the `release:` line after
  the first successful deploy** so a one-time migration isn't part of every future release.

**Manual fallback (no Procfile line):** Heroku Dashboard → the app → **More ▸ Run console** →
`node server/src/migrations/migrateEfforts.js --apply` → **Run**, then **More ▸ Restart all dynos**.
Run without `--apply` first for a zero-write **dry run** (prints per-campaign counts, writes nothing).
The dry run is for the manual/local path — with release phase the real migration runs automatically on
deploy, so a separate dry run isn't needed.

## G. Crew (derived, not stored)

The displayed crew is computed in [efforts.js](../server/src/routes/admin/efforts.js), never synced:

- **`GET /efforts`** returns `crewCount` per effort = `|`(`EffortMember` users) ∪ (distinct
  `TurfAssignment.userId` on the effort's **active round's** books)`|`. Reuses the active-round lookup
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
| [client/src/pages/EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) | Efforts list/create, crew (derived) + pre-add, claim/re-carve, Intake banner + assign, survey override. |
| [client/src/pages/PassesPage.jsx](../client/src/pages/PassesPage.jsx) | "Rounds" — effort-scoped (selector + `?effortId=`); create a round in an effort. |
| [client/src/pages/TurfsPage.jsx](../client/src/pages/TurfsPage.jsx) | Turf cutting; PassPicker labels rounds by effort and defaults to an active round. |
| [client/src/pages/DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) | Effort filter → passes `effortId` to the reports endpoints. |
| [mobile/app/(app)/voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) | Resolves the survey per door from `books`/`surveys`. |
