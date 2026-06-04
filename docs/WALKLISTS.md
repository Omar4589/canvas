# Walk lists (saved door sets you carve efforts from)

A **walk list** is a saved, named, **frozen** set of doors carved out of a campaign's voter pool. You
build one, then hand it to an **effort** to give that effort its doors. Walk lists are the bridge
between "who's in my universe" and "which crew works which doors."

- **Part 1 — For everyone** is plain language: what a list is, the two ways to build one, and how a
  list becomes an effort's doors.
- **Part 2 — Technical reference** is for developers (and Claude): models, the two resolvers, the
  endpoints, and the invariants.

Related: [EFFORTS.md](EFFORTS.md) (efforts own disjoint doors; lists seed/claim them),
[IMPORTS.md](IMPORTS.md) (how new voters/addresses reach the pool and Intake),
[EARLY_VOTING.md](EARLY_VOTING.md) (the same Voter-ID CSV matcher marks voted voters),
[PASSES_AND_TURF.md](PASSES_AND_TURF.md) (a list's doors get cut into books inside a round).

---

# Part 1 — For everyone

## What a walk list is

A **frozen selection of doors** (households) from one campaign, saved under a name. "Frozen" is the
key word: once you save a list, its doors are locked in. It does **not** re-resolve — importing more
voters later, or someone moving, doesn't change an existing list. If you need a fresh cut, build a new
list.

A list is a set of **doors, not voters.** That matters at multi-voter homes (see the rule below).

## Two ways to build a list

On the **Walk Lists** page, the "Build a list" panel has two modes:

1. **Filter builder** — pick doors by **demographics** (party, precinct, congressional/state districts,
   gender, age), **geography** (city, ZIP, county), **prior-round door status** (e.g. "not home in
   Round 1"), and **survey response**. Combine the filters with **AND** (match all) or **OR** (match
   any). Use this when the people you want can be *described* by their data.

2. **Upload a Voter-ID CSV** — upload a file that has a column of Voter IDs. The app matches those IDs
   to this campaign's voters and freezes the doors they live at into a list. Use this when you already
   have an **exact list** of people that filters can't express — e.g. "the voters who voted in the
   first election," handed to you as a spreadsheet.

Both produce the same thing: a frozen list you can seed/claim into an effort. A saved list shows a
**"from CSV"** badge when it was built by upload.

## The multi-voter-door rule

A walk list is a set of **doors**. When you upload a Voter-ID CSV, a door joins the list if **any** of
its voters is in your file. And because efforts own whole doors, **claiming a door later moves *all*
the voters at it**, not just the ones in your file. The CSV preview shows both numbers — *matched
voters* and *voters at those doors* — so the difference is visible. (At a 2-voter home where only one
person is in your file, the door still joins, and both voters come along when an effort claims it.)

## How a list becomes an effort's doors

Efforts own a **disjoint** set of doors — every door belongs to exactly one effort, or sits in
**Intake** (owned by none). A walk list is how you hand doors to an effort:

- **Seed at creation** — Efforts page → New effort → pick the list under "Seed door-set."
- **Claim later** — open an effort → Claim → pick the list (or "Claim all Intake").

Either way, claiming takes only the list's **unowned (Intake)** doors. If some of the list's doors are
**already in another effort**, the app says "*X doors are in another effort*" and offers a **re-carve**
(move them here) — which pulls them out of the other effort cleanly. See [EFFORTS.md](EFFORTS.md).

## Why the CSV upload exists

Two jobs the filter builder can't do:

- **Target an exact list you already have.** A spreadsheet of "first-election voters" becomes a list in
  one upload — no trying to approximate it with precinct/party filters.
- **Re-carve specific doors out of a finished effort.** Say your first effort is done/archived and you
  import a runoff list; a voter at an address that effort already owns stays on that effort (archiving
  doesn't release doors). Upload that runoff list as a walk list, then claim it into a new effort with a
  re-carve to move exactly those doors over. (Brand-new addresses don't need this — they land in Intake
  automatically and any effort can claim them.)

## Things to know

- **IDs not yet imported won't match.** A Voter ID that isn't in this campaign's universe lands in
  "not in this campaign." Import those voters first (they then appear in Intake), or download the
  unmatched IDs from the preview, fix the file, and re-upload.
- **Doors with no map coordinates are left out** of a list (they can't be cut). The preview reports how
  many were skipped.
- **Deleting a list** only removes the saved selection — it never changes which effort owns a door.

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
| `WalkList` | [models/WalkList.js](../server/src/models/WalkList.js) | A **frozen** selection. `filter` (the builder's criteria, kept for reference), frozen `householdIds`/`voterIds` + `householdCount`/`voterCount` (the source of truth — lists do **not** re-resolve), `source` (`'filter'` \| `'csv'`), and `sourceMeta` (`fileName`, `idColumn`, `idsInFile`, `matchedVoters`, `notFound`) for CSV provenance/audit. |

A walk list is **campaign-scoped**; the frozen ids are the truth, so seeding/claiming never re-runs the
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
| `POST /` | `{ name, filter }` | `201 { walkList }` — save a filter list |
| `POST /from-csv/preview` | `multipart`: `file` (+ optional `idColumn`) | `{ idColumn, columns, totalRows, idsInFile, matched, householdCount, voterCount, noCoordinates, notFound, notFoundIds, ownedDoors, intakeDoors, ownedByEffort, sample }` — no save |
| `POST /from-csv` | `multipart`: `file`, `name` (+ optional `idColumn`) | `201 { walkList }` — save a CSV list (`source: 'csv'`) |
| `GET /distinct` | — | filter-value pickers (genders, parties, precincts, …) |
| `GET /:id` · `DELETE /:id` | — | fetch / delete a list (delete never touches door ownership) |

Preview and save each upload the file (stateless re-parse, cheap) — the same two-call pattern the Early
Voting page uses.

## D. How a list reaches an effort (unchanged machinery)

A list is just `householdIds`. Both seed and claim live in
[efforts.js](../server/src/routes/admin/efforts.js) and treat a CSV list identically to a filter list:

- **Seed at create** (`POST /efforts`, `seedWalkListId`) — `updateMany({ _id: {$in: householdIds},
  effortId: null }, { effortId })`: Intake-only.
- **Claim** (`POST /efforts/:id/claim`, `{ walkListId }`) — Intake doors claimed outright; doors owned
  by another effort return `409 doors-owned` unless `force:true` (re-carve, which also clears
  `turfId`/`walkOrder` and pulls them from their old book). **Disjointness is preserved by
  construction** — see [EFFORTS.md §B](EFFORTS.md).

## E. Deliberate decisions / gotchas

- **No sticky graduation for not-yet-imported IDs.** Unlike early voting's `VotedPendingId`, a CSV walk
  list does **not** remember unmatched IDs to fold in later — that would mutate a list that is frozen by
  design. Unmatched IDs are reported (`notFound`) and downloadable; voters imported later reach efforts
  via **Intake**, the designed control point.
- **Whole-door voter count.** `voterCount` counts *all* voters at the resolved doors, not just the
  matched ones — because claiming moves the whole door. The preview shows `matched` separately.
- **Coordinate guard.** Matched doors without coordinates are excluded (reported as `noCoordinates`) so
  a list never holds uncuttable doors.

## F. Frontend

| File | Renders |
|---|---|
| [client/src/pages/WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) | "Build a list" with a **Filter builder / Upload CSV** toggle (CSV: file → auto-preview with matched/doors/owned-doors warning/unmatched download → name + save), and the saved-lists column (with a "from CSV" badge). |
| [client/src/pages/EffortsPage.jsx](../client/src/pages/EffortsPage.jsx) | "Seed door-set" + Claim dropdowns list every walk list (CSV ones tagged `· CSV`); the claim panel surfaces the `409 doors-owned` re-carve. |
