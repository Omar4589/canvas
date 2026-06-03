# Early voting (voted voters)

Lets an admin upload a list of voters who have **already voted** so canvassers stop wasting trips
on them. This doc is the source of truth for how it works and **how it touches doors, books,
voters, passes, campaigns, and the counts**.

- **Part 1 — For everyone** is plain language.
- **Part 2 — Technical reference** is for developers (and Claude): exact models, the pipeline,
  endpoints, the cross-effects, and the components.

Server entry point: [`server/src/routes/admin/voted.js`](../server/src/routes/admin/voted.js).
Related: the [metrics doc](METRICS.md).

---

# Part 1 — For everyone

## What it does

You upload a CSV of voters who already voted (early / absentee). The app matches them **by Voter
ID**, marks them as voted, and **removes a door from canvassers once *everyone* at that address has
voted**. Nothing is re-cut and every upload is reversible.

## "Voted voter" vs "fully-voted door"

These are two different things:

- A **voted voter** is one person marked as already voted. At a door that still has someone left
  to talk to, voted residents simply show a green **✓ Voted** badge — the door stays on the map.
- A **fully-voted door** is a household where **every** voter has voted. Only then does the door
  **drop off** the canvasser's map and books.

## Campaign-scoped and reversible

- **Per campaign.** A vote is recorded against the campaign you uploaded it to. The same person can
  be "voted" in one campaign and not another (different elections), so you upload per campaign.
- **Reversible.** Every upload is logged and can be **undone** with one click, which un-marks the
  voters that upload added and re-opens any doors that had dropped because of it.

## How to use it (Early Voting page)

1. Pick the **campaign**.
2. Choose your **voted-voters CSV** (any column that looks like a Voter ID is auto-detected). A
   **preview** runs immediately — no changes yet.
3. The preview shows: **Will mark voted**, **Already voted** (skipped), **Doors that will drop**,
   and **Not in this campaign** (IDs that don't belong to this campaign's list).
4. Click **Mark these voters voted** to apply. You'll see how many were marked and how many doors
   dropped.
5. The page keeps an **upload history** with **Voters marked voted** and **Doors fully voted**
   totals, and an **Undo** button per upload.

## What canvassers see

- **Fully-voted doors disappear** from the map and from book/turf door counts (their book's count
  shrinks to the remaining doors).
- At doors that are still open, **voted residents get a ✓ Voted badge** so the canvasser knows to
  skip them.

## Worked example

A 2-voter home, Jane and John, on Campaign A:

- Upload marks **Jane** voted → the door **stays** on the map; Jane shows ✓ Voted, John doesn't.
- A later upload marks **John** voted too → now everyone has voted → the door becomes **fully
  voted** and **drops off** the canvasser's map/books.
- **Undo** that second upload → John is un-marked → the door **re-appears**.

> Heads-up: once everyone at a door has voted it drops for *canvassers*, but the door still exists
> in the *admin reports* — now shown in its own **Voted** coverage segment (no longer counted as
> `unknocked`). See Part 2 §F.

## Lifecycle (step by step)

End to end, from upload to what everyone sees:

1. **Upload (admin).** On the Early Voting page, pick the campaign and choose the voted-voters CSV.
2. **Preview — no writes.** `POST …/voted/preview` parses the CSV, auto-detects the Voter-ID column,
   matches voters **by `stateVoterId`** (org-wide) filtered to this campaign's households, and returns
   will-mark / already-voted / doors-that-will-drop / not-found (plus the unmatched IDs to download).
3. **Apply.** `POST …/voted/import` records a `VotedUpload`, upserts one `VotedVoter` per voter, then
   `recomputeFullyVoted` flips `Household.fullyVoted = true` wherever **every** voter has now voted.
4. **Canvasser view updates.** The next mobile bootstrap / 30s delta drops fully-voted doors from the
   map and book counts; still-open doors show a ✓ on voted residents.
5. **Admin view updates.** Reports move those doors into the **Voted** coverage segment (out of
   `unknocked`); admin book/turf lists show the live eligible door count.
6. **Re-import the universe (sticky).** If you later import more voters, anyone who was on a prior
   (non-undone) voted list is **automatically re-marked** when they land — so doors don't wrongly
   re-open and brand-new all-voted households drop. A genuinely new, *un-voted* voter added to a
   dropped door correctly re-opens it.
7. **Corrections.** Undo a whole upload (`/voted/undo`) or un-mark one voter (`/voted/unmark`); both
   call `recomputeFullyVoted` to re-open doors as needed.

---

# Part 2 — Technical reference

## A. Data model

| Model | File | Purpose / key fields |
|---|---|---|
| `VotedUpload` | [models/VotedUpload.js](../server/src/models/VotedUpload.js) | Audit record + **unit of undo** for one CSV: `organizationId`, `campaignId`, `fileName`, `uploadedBy`, `totalRows`, `matched` (newly marked), `alreadyVoted`, `notFound`, `doorsDropped`, `undone`/`undoneAt`. Index `{campaignId, createdAt:-1}`. |
| `VotedVoter` | [models/VotedVoter.js](../server/src/models/VotedVoter.js) | The mark — **one row per voter per campaign**: `organizationId`, `campaignId`, `voterId`, `householdId`, `stateVoterId`, `voteMethod`, `votedAt`, `uploadId`. **Unique index `{campaignId, voterId}`**; `uploadId` indexed for undo. |
| `Household.fullyVoted` | [models/Household.js:65](../server/src/models/Household.js#L65) | Derived `Boolean` (indexed, default `false`): everyone at this address has voted → the door drops. |
| `VotedPendingId` | [models/VotedPendingId.js](../server/src/models/VotedPendingId.js) | A `stateVoterId` from an upload that didn't match a voter **yet** (voter not in the universe): `organizationId`, `campaignId`, `uploadId`, `stateVoterId`. Index `{campaignId, stateVoterId}`. Makes early voting "sticky" — graduates to a `VotedVoter` when the voter is later imported; deleted on graduation or undo. |

Notes:
- **There is no `voted` field on `Voter`.** The mark lives in `VotedVoter` precisely because it's
  campaign-scoped; `Voter` rows are shared org-wide. The mobile API *derives* a `voted` flag per
  voter at request time (§E).
- `voteMethod` exists on the schema but the CSV import path doesn't populate it (stays `null`) —
  reserved for future use.

## B. Pipeline ([voted.js](../server/src/routes/admin/voted.js))

1. **`parseAndMatch(campaign, buffer, idColumn)`** — PapaParse the CSV; pick the ID column
   (explicit `idColumn` → `suggestMapping().stateVoterId` → `/voter\s*id/i` → fail). Match **by
   `stateVoterId`** across the org's `Voter`s, then **filter to voters whose household is in this
   campaign**. Returns `{ col, totalRows, csvCount, inCampaign, notFound, notFoundIds }` (the
   unmatched IDs power the "Download unmatched" button).
2. **`classify(campaign, inCampaign)`** — split into `newly` (no existing `VotedVoter`) vs
   `alreadyCount`, and the `affected` household ids.
3. **`previewDrops(...)`** — dry-run union: how many `affected` households would become fully-voted
   if `newly` were marked (no writes).
4. **`recomputeFullyVoted(campaignId, householdIds)`**
   ([services/voted/recomputeFullyVoted.js](../server/src/services/voted/recomputeFullyVoted.js)) —
   for each household, set `fullyVoted = (voterCount > 0 && every voter has a VotedVoter row for
   this campaign)`. Bulk, chunked at 2000.
5. **Import** = create `VotedUpload` → bulk **upsert** `VotedVoter` (`$setOnInsert`, so re-marking
   is idempotent) → `recomputeFullyVoted(affected)` → write `matched`/`doorsDropped`
   (`afterFully − beforeFully`) back to the upload → persist every **unmatched** id as a
   `VotedPendingId` (and clear stale pending ids for ids that matched this time).
6. **Undo** = find `VotedVoter` rows by `uploadId` → `deleteMany` → `deleteMany VotedPendingId` by
   `uploadId` → `recomputeFullyVoted(affected)` → set `undone:true, undoneAt`. Soft on the upload,
   hard on its rows + pending ids.
7. **Sticky re-apply on regular import** — [importProcessor.js](../server/src/services/import/importProcessor.js)
   calls [`reapplyVotedLists(campaignId)`](../server/src/services/voted/reapplyVotedLists.js): any
   `VotedPendingId` (from a non-undone upload) whose voter has **now** been imported graduates into a
   `VotedVoter` (pending row deleted). Then `recomputeFullyVoted` runs over the union of those doors
   and the currently-dropped doors. So a voter who was on a prior list stays marked (the door doesn't
   wrongly re-open, and a brand-new all-voted household drops), while a **genuinely new, un-voted**
   voter still re-opens its door.

## C. Endpoint reference

Mounted at `/admin/campaigns/:campaignId/voted` ([routes/index.js:46](../server/src/routes/index.js#L46)),
admin-only, campaign loaded/validated per request.

| Method · path | Body | Returns |
|---|---|---|
| `POST /preview` | `multipart/form-data`: `file` (+ optional `idColumn`) | `{ idColumn, columns, totalRows, idsInFile, matched, willMark, alreadyVoted, notFound, notFoundIds, doorsWillDrop }` — no writes |
| `POST /import` | same | `{ uploadId, matched, marked, alreadyVoted, notFound, notFoundIds, doorsDropped, totalRows }` |
| `GET /` | — | `{ uploads:[…last 50…], totalVoted, fullyVotedDoors }` |
| `POST /undo` | `{ uploadId }` | `{ ok, removed }` — un-marks a whole upload |
| `POST /unmark` | `{ stateVoterId }` | `{ ok, removed, reopened }` — un-marks one voter, re-opens the door if needed |

`notFoundIds` is capped at 10k and powers the web "Download unmatched" button.

## D. Effect on the rest of the app

| Area | Effect | Source |
|---|---|---|
| **Doors (mobile)** | Fully-voted households are filtered out of the canvasser's door pool (`fullyVoted: { $ne: true }`) and out of the 30s delta sync (client drops them live). | [bootstrap.js:145](../server/src/routes/mobile/bootstrap.js#L145), [bootstrap.js:245](../server/src/routes/mobile/bootstrap.js#L245), [map.jsx:434](../mobile/app/(app)/map.jsx#L434) |
| **Books / turf** | Book door counts are computed **live** as "active & not-fully-voted" — on mobile *and* now in the admin turf list (`eligibleDoorCount`), so a book's count shrinks as doors drop. **`Turf.householdIds` is not mutated and turfs are not re-cut**; the stored `Turf.doorCount` is kept for snapshots/splits but no longer shown to admins. | [bootstrap.js:80-94](../server/src/routes/mobile/bootstrap.js#L80), [turfs.js:280](../server/src/routes/admin/turfs.js#L280) |
| **Voters** | Not hidden — flagged `voted: true` in the bootstrap payload and shown with a ✓ badge. No write to the `Voter` doc. | [bootstrap.js:190-193](../server/src/routes/mobile/bootstrap.js#L190) |
| **Passes** | No interaction — voted filtering is campaign-wide, not pass-specific. Passes/knocks are unaffected. | — |
| **Campaigns** | The mark is per-campaign; the same voter is tracked independently per campaign. | [VotedVoter.js](../server/src/models/VotedVoter.js) |
| **Canvass status** | Independent. `fullyVoted` is separate from `status` (`unknocked`/`not_home`/…); a dropped door keeps whatever status it had — it just isn't shown. | [Household.js](../server/src/models/Household.js) |
| **Admin reports/metrics** | Fully-voted doors are pulled out of `unknocked` into a dedicated **Voted** coverage segment (they still count in Households; `homesKnocked`/knocks unchanged). | [reports.js](../server/src/routes/admin/reports.js) (`coverageBucketExpr`) |

## E. Frontend mapping

- **Web** — [pages/EarlyVotingPage.jsx](../client/src/pages/EarlyVotingPage.jsx): campaign picker,
  CSV upload (auto-previews on pick), preview stats, **Mark these voters voted**, and the history
  table (`Voters marked voted` / `Doors fully voted` + per-upload **Undo**). Routed at
  `/early-voting`, admin-only ([App.jsx](../client/src/App.jsx)), nav item in
  [navItems.js](../client/src/components/navItems.js).
- **Mobile** — bootstrap derives the per-voter `voted` flag and drops fully-voted doors (§D). The
  ✓ Voted badge renders in [map.jsx:1112](../mobile/app/(app)/map.jsx#L1112) and
  [household/[id].jsx:96](../mobile/app/(app)/household/[id].jsx#L96).

## F. Known interactions & gotchas

Resolved (kept here so the history is clear):

- **Reports — fully-voted doors now have a "Voted" segment.** They used to inflate `unknocked`;
  `coverageBucketExpr` in [reports.js](../server/src/routes/admin/reports.js) reclassifies
  voted-and-still-unknocked doors into a `voted` bucket in `/overview` and `/campaign-rollup`.
  Households and `homesKnocked` are unchanged. A door knocked *before* it went fully-voted keeps its
  knocked status (only otherwise-`unknocked` doors move to `voted`). See the [metrics doc](METRICS.md).
- **Admin turf counts are live.** The admin turf list returns `eligibleDoorCount` (active &
  not-fully-voted), so books no longer show a stale stored `doorCount`.
- **Per-voter unmark exists.** `POST …/voted/unmark { stateVoterId }` fixes a single mistaken mark
  (re-opening the door if needed), in addition to whole-upload undo.
- **Unmatched rows are downloadable.** Preview/import return `notFoundIds`; the Early Voting page
  offers a "Download unmatched" CSV so the admin can fix the file and re-upload.
- **Early voting is sticky across universe re-imports.** Unmatched ids are persisted as
  `VotedPendingId`; a regular import graduates any that now match (`reapplyVotedLists`), so a voter
  who was on a prior list and is imported later is still marked — the door doesn't wrongly re-open,
  and a brand-new all-voted household drops. Only a genuinely **new, un-voted** voter re-opens a door.
  Undoing an upload also clears its pending ids so they never re-apply.

Still true:

- **Matching is `stateVoterId`-only.** Voters without a `stateVoterId`, or a CSV with no detectable
  Voter ID column, won't match (they land in `notFound` → download & fix). Sticky re-apply also keys
  on `stateVoterId`.
- **Undo is per-upload and soft.** A voter marked by two uploads stays voted until both are undone
  (or use per-voter unmark). The `VotedUpload` is flagged `undone`, not deleted.
- **Campaign-scoped.** Uploading to the wrong campaign marks no one useful (matches are filtered to
  that campaign's households); re-upload to the correct campaign.
- **`voteMethod` is unused.** The schema field exists but the CSV import doesn't populate it.
- **`voteMethod` is unused.** The schema field exists but the CSV import doesn't populate it.
