# Saved searches (saved door sets you carve walk lists from)

> Filename is `WALKLISTS.md` and the underlying model is `WalkList`; this feature is shown to users as a **Saved search**.

A **saved search** is a saved, named, **frozen** set of doors carved out of a campaign's voter pool. You
build one, then hand it to a **walk list** to give that walk list its doors. Saved searches are the bridge
between "who's in my universe" and "which crew works which doors."

- **Part 1 — For everyone** is plain language: what a saved search is, the two ways to build one, and how a
  saved search becomes a walk list's doors.
- **Part 2 — Technical reference** is for developers (and Claude): models, the two resolvers, the
  endpoints, and the invariants.

Related: [EFFORTS.md](EFFORTS.md) (walk lists own disjoint doors; saved searches seed/claim them),
[IMPORTS.md](IMPORTS.md) (how new voters/addresses reach the pool and Intake),
[EARLY_VOTING.md](EARLY_VOTING.md) (the same Voter-ID CSV matcher marks voted voters),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (a saved search's doors get cut into books inside a round).

---

# Part 1 — For everyone

## What a saved search is

A **frozen selection of doors** (households) from one campaign, saved under a name. "Frozen" is the
key word: once you save a saved search, its doors are locked in. It does **not** re-resolve — importing more
voters later, or someone moving, doesn't change an existing saved search. If you need a fresh cut, build a new
saved search.

A saved search is a set of **doors, not voters.** That matters at multi-voter homes (see the rule below).

## Two ways to build a saved search

On the **Saved Searches** page, the "Build a saved search" panel has two modes:

1. **Filter builder** — pick doors by **demographics** (party, precinct, congressional/state districts,
   gender, age), **geography** (city, ZIP, county), **door status**, and **survey answers**. Combine the
   filters with **AND** (match all) or **OR** (match any). Use this when the people you want can be
   *described* by their data.
   - **Door status:** pick a **"from pass"** to filter on the status *within that round* (e.g. "not-home
     in Round 1"); leave it blank to filter on the door's **current status** across all rounds (e.g.
     "still unknocked"). *(Previously, choosing a status without a pass silently matched everything —
     fixed.)*
   - **Survey answers:** filter by the actual answers to your choice questions (e.g. *Support / Likely*,
     or *Undecided*) — one or more options per question.

2. **Upload a Voter-ID CSV** — upload a file that has a column of Voter IDs. The app matches those IDs
   to this campaign's voters and freezes the doors they live at into a saved search. Use this when you already
   have an **exact list** of people that filters can't express — e.g. "the voters who voted in the
   first election," handed to you as a spreadsheet.

Both produce the same thing: a frozen saved search you can seed/claim into a walk list. A saved search shows a
**"from CSV"** badge when it was built by upload.

## The multi-voter-door rule

A saved search is a set of **doors**. When you upload a Voter-ID CSV, a door joins the saved search if **any** of
its voters is in your file. And because walk lists own whole doors, **claiming a door later moves *all*
the voters at it**, not just the ones in your file. The CSV preview shows both numbers — *matched
voters* and *voters at those doors* — so the difference is visible. (At a 2-voter home where only one
person is in your file, the door still joins, and both voters come along when a walk list claims it.)

## How a saved search becomes a walk list's doors

Walk lists own a **disjoint** set of doors — every door belongs to exactly one walk list, or sits in
**Intake** (owned by none). A saved search is how you hand doors to a walk list:

- **Seed at creation** — Walk Lists page → New walk list → pick the saved search under "Seed door-set."
- **Claim later** — open a walk list → Claim → pick the saved search (or "Claim all Intake").

Either way, claiming takes only the saved search's **unowned (Intake)** doors. If some of the saved search's doors are
**already in another walk list**, the app says "*X doors are in another walk list*" and offers a **re-carve**
(move them here) — which pulls them out of the other walk list cleanly. See [EFFORTS.md](EFFORTS.md).

## Why the CSV upload exists

Two jobs the filter builder can't do:

- **Target an exact list you already have.** A spreadsheet of "first-election voters" becomes a saved search in
  one upload — no trying to approximate it with precinct/party filters.
- **Re-carve specific doors out of a finished walk list.** Say your first walk list is done/archived and you
  import a runoff list; a voter at an address that walk list already owns stays on that walk list (archiving
  doesn't release doors). Upload that runoff list as a saved search, then claim it into a new walk list with a
  re-carve to move exactly those doors over. (Brand-new addresses don't need this — they land in Intake
  automatically and any walk list can claim them.)

## Things to know

- **IDs not yet imported won't match.** A Voter ID that isn't in this campaign's universe lands in
  "not in this campaign." Import those voters first (they then appear in Intake), or download the
  unmatched IDs from the preview, fix the file, and re-upload.
- **Doors with no map coordinates are left out** of a saved search (they can't be cut). The preview reports how
  many were skipped.
- **Deleting a saved search** only removes the saved selection — it never changes which walk list owns a door.

---

# Part 2 — Technical reference

Server: [routes/admin/walklists.js](../server/src/routes/admin/walklists.js) (CRUD + filter
preview/save + CSV preview/save + distinct values),
[services/walklist/resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js) (filter
resolver), [services/import/parseVoterIdList.js](../server/src/services/import/parseVoterIdList.js)
(CSV matcher + door resolver, shared with early voting).

## A. Data model

| Model | File | Notes |
|---|---|---|
| `WalkList` | [models/WalkList.js](../server/src/models/WalkList.js) | A **frozen** selection (the `WalkList` model backs the user-facing **saved search**). `filter` (the builder's criteria, kept for reference), frozen `householdIds`/`voterIds` + `householdCount`/`voterCount` (the source of truth — saved searches do **not** re-resolve), `source` (`'filter'` \| `'csv'`), and `sourceMeta` (`fileName`, `idColumn`, `idsInFile`, `matchedVoters`, `notFound`) for CSV provenance/audit. |

A saved search is **campaign-scoped**; the frozen ids are the truth, so seeding/claiming never re-runs the
filter or re-reads the CSV.

## B. The two resolvers

- **Filter →
  [resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js)** — turns demographic/geo/
  prior-pass/survey predicates into household **sets**, intersected (`and`) or unioned (`or`). The base
  is the campaign's **coordinate-bearing active** households; targeted voters = those matching the voter
  predicate within the final households (or all voters there if no voter predicate).
- **CSV →
  [parseVoterIdList.js](../server/src/services/import/parseVoterIdList.js)** — two functions:
  - `parseAndMatch(campaign, buffer, idColumn)` — PapaParse the CSV, auto-detect the ID column
    (`idColumn` → `suggestMapping().stateVoterId` → `/voter\s*id/i` → fail), match **org-wide by
    `stateVoterId`** then filter to voters whose household is in this campaign. Returns
    `{ columns, col, totalRows, csvCount, inCampaign, notFound, notFoundIds }`. **This is the exact
    matcher early voting uses** ([voted.js](../server/src/routes/admin/voted.js) imports it).
  - `resolveHouseholdsFromVoterMatch(campaign, inCampaign)` — distinct households of the matched voters,
    intersected with **cuttable** (active, coordinate-bearing) doors; `voterIds` = **all** voters at
    those doors (whole-door semantics, mirroring the filter resolver). Returns
    `{ householdIds, voterIds, householdCount, voterCount, noCoordinates, ownership }` — `ownership`
    (`[{_id, effortId}]`) lets the preview bucket Intake vs already-owned with no extra query.

## C. Endpoints

Mounted at `/admin/campaigns/:campaignId/walklists`, admin-only.

| Method · path | Body | Returns |
|---|---|---|
| `GET /` | — | `{ walkLists }` (id arrays projected out; includes `source`/`sourceMeta`) |
| `POST /preview` | `{ filter }` | `{ householdCount, voterCount, sample }` — filter dry-run, no save |
| `POST /` | `{ name, filter }` | `201 { walkList }` — save a filter saved search |
| `POST /from-csv/preview` | `multipart`: `file` (+ optional `idColumn`) | `{ idColumn, columns, totalRows, idsInFile, matched, householdCount, voterCount, noCoordinates, notFound, notFoundIds, ownedDoors, intakeDoors, ownedByEffort, sample }` — no save |
| `POST /from-csv` | `multipart`: `file`, `name` (+ optional `idColumn`) | `201 { walkList }` — save a CSV saved search (`source: 'csv'`) |
| `GET /distinct` | — | filter-value pickers (genders, parties, precincts, …) |
| `GET /:id` · `DELETE /:id` | — | fetch / delete a saved search (delete never touches door ownership) |

Preview and save each upload the file (stateless re-parse, cheap) — the same two-call pattern the Early
Voting page uses.

## D. How a saved search reaches a walk list (unchanged machinery)

A saved search is just `householdIds`. Both seed and claim live in
[efforts.js](../server/src/routes/admin/efforts.js) and treat a CSV saved search identically to a filter saved search:

- **Seed at create** (`POST /efforts`, `seedWalkListId`) — `updateMany({ _id: {$in: householdIds},
  effortId: null }, { effortId })`: Intake-only.
- **Claim** (`POST /efforts/:id/claim`, `{ walkListId }`) — Intake doors claimed outright; doors owned
  by another walk list return `409 doors-owned` unless `force:true` (re-carve, which also clears
  `turfId`/`walkOrder` and pulls them from their old book). **Disjointness is preserved by
  construction** — see [EFFORTS.md §B](EFFORTS.md).

## E. Deliberate decisions / gotchas

- **No sticky graduation for not-yet-imported IDs.** Unlike early voting's `VotedPendingId`, a CSV saved
  search does **not** remember unmatched IDs to fold in later — that would mutate a saved search that is frozen by
  design. Unmatched IDs are reported (`notFound`) and downloadable; voters imported later reach walk lists
  via **Intake**, the designed control point.
- **Whole-door voter count.** `voterCount` counts *all* voters at the resolved doors, not just the
  matched ones — because claiming moves the whole door. The preview shows `matched` separately.
- **Coordinate guard.** Matched doors without coordinates are excluded (reported as `noCoordinates`) so
  a saved search never holds uncuttable doors.

## F. Frontend

| File | Renders |
|---|---|
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | "Build a saved search" with a **Filter builder / Upload CSV** toggle (CSV: file → auto-preview with matched/doors/owned-doors warning/unmatched download → name + save), and the saved-searches column (with a "from CSV" badge). |
| [client/src/pages/EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) | "Seed door-set" + Claim dropdowns list every saved search (CSV ones tagged `· CSV`); the claim panel surfaces the `409 doors-owned` re-carve. |
