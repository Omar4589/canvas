# Passes, books & turf-cutting

How a campaign is broken into rounds (**passes**) and walkable territories (**books**), how those
books are generated and re-generated (**turf-cutting** / **recutting**), and how all of this feeds
the numbers.

- **Part 1 — For everyone** is plain language: the pieces, the rules, and the common "I uploaded
  new voters — now what?" scenario.
- **Part 2 — Technical reference** is for developers (and Claude): models, the generation pipeline,
  the lifecycle routes, and where passes do (and don't) affect aggregation.

Related: [EFFORTS.md](EFFORTS.md) (the layer above — see banner), [METRICS.md](METRICS.md) (a pass is
the billing unit), [TURF_RUNBOOK.md](../TURF_RUNBOOK.md) (operational runbook),
[SURVEYS.md](SURVEYS.md) (one survey per voter per pass), [VOTERS.md](VOTERS.md),
[MAPS.md](MAPS.md) (how books/turf show on the map).

> **Updated — passes are now "Rounds" inside Efforts.** A campaign is split into **efforts** (areas
> or teams), and a "pass" is now one **Round** within an effort (still the cut/assign/billing unit).
> The mechanics below — generating books, accept/discard, move/merge/split, supplemental books — are
> unchanged and apply **per round**. What changed: (1) a campaign can have **several active rounds at
> once** (one per active effort), not one; (2) a round's door-set comes from its **effort's owned
> doors** (`Household.effortId`), not a walk list; (3) knock attribution is **deterministic by
> door → book → effort**, not the `activatedAt` time-window; (4) new-address imports go to **Intake**
> until assigned to an effort. See [EFFORTS.md](EFFORTS.md) and [IMPORTS.md](IMPORTS.md). The
> per-pass details below remain correct read as "per round."

---

# Part 1 — For everyone

## The pieces: campaign → pass → book → households

```
Campaign
  └─ Pass            one round of canvassing (Round 1, Round 2, …)
       └─ Book       a walkable, ordered slice of households (a canvasser's turf)
            └─ Households → Voters
```

A **campaign** is the whole effort. Inside it you run one or more **passes**. Each pass is cut into
**books**, and each book is an ordered list of households for one person to walk.

## What a pass is

A **pass** is a single planned sweep of the campaign — Round 1, Round 2, and so on. It has a round
number, a name, and a status that only moves **one way**:

**draft → active → archived.** An archived pass is never reopened — you make a new pass instead.

A pass either covers **all voters** in the campaign, or a frozen **walk list** (a saved snapshot of
a subset — e.g. "only Precinct 12" or "only not-homes from last time").

## What a book is

A **book** (called a "turf" in the code) is a walkable, ordered set of households **inside one
pass**. It's what a canvasser is actually assigned. A book belongs to exactly one pass; the same
geography in Round 2 is a *new* book in the Round-2 pass, not the same object reused.

## Cutting turf (making books)

**Turf-cutting** is generating the books for a pass. Three ways:

- **Geometric** — the default; groups households into compact, similarly-sized books (a max door
  count each) by location.
- **Attribute** — one book per precinct / county / city / ZIP / district, etc.
- **Manual** — you draw a polygon on the map and the households inside become a book.

Books are first created as **drafts**; you review them, then **accept** them (drafts → published).
A pass needs accepted (published) books before it can be activated.

## Recutting (changing the books)

If you don't like the books, or the underlying voter list changed, you **recut**. Two situations:

- The books are still **drafts** → just generate again; the old drafts are replaced automatically.
- The books are **accepted/published** → you must **Discard** them first, then generate again.
  Discard snapshots the current layout (so it can be undone), removes the books, and — if the pass
  was active — drops it back to **draft** (a live campaign can't be left with an active pass that
  has no books). Then you cut fresh and re-accept.

There is **no "add just the new houses to the existing books"** option. Recutting is all-or-nothing
for a pass: replace that pass's whole book set.

## Only one pass runs at a time

A campaign can have **only one active pass**. Activating a pass automatically **archives** any other
active pass. Canvassers only ever see the **active** pass — and within it, only the **books assigned
to them**. You can have lots of passes sitting in draft or archived, but the field only ever sees
the one that's live.

## How the numbers add up across passes

- Every knock and every survey is stamped with the pass it happened in.
- **Dashboard totals add up across all passes.** If Round 1 had 100 knocks and Round 2 had 80, the
  dashboard shows **180**. (Only the per-pass progress view is scoped to a single pass.)
- A knock counts **once per (house, pass)** — re-knocking a house in the *same* pass doesn't add a
  knock; knocking it again in a *new* pass does. This is the billing unit.
- **Coverage / "homes knocked" is different** — it's based on each household's *current* status,
  campaign-wide, and is **not** pass-aware. One house has one status no matter how many passes hit
  it. So running another pass (or recutting) adds **knocks**, but doesn't change **coverage**.

See [METRICS.md](METRICS.md) for the exact definitions.

## Adding new voters after a pass exists (worked scenario)

You have a pass covering **all voters**, then you import **new voters at new addresses**. What
happens?

- The new addresses become **new household records with no book** — they're not in any book yet, so
  canvassers on the active pass **won't see them**. Existing books are **not** auto-updated.

Your options:

1. **Add them to the live pass as a supplemental book (recommended).** On the Turf page, when there
   are doors "not in any book," click **Add as new book** — the unassigned households are cut into
   new draft book(s) on the *current* pass without touching the existing books or knocks. Then
   **Accept** and **assign** them like any other book. No recut, no archive; canvassers see the new
   doors on their next refresh. → keeps the round running.
2. **Recut the same pass.** Discard its books (this resets the pass to draft), then generate again.
   Because this pass is "all voters," regeneration pulls in **all** current households, so the new
   addresses are **included**. → the "remove all existing books and recut" path; use when you also
   want the whole pass re-balanced.
3. **Create a new pass** for the updated voter universe and cut fresh books there. The old pass and
   its knocks stay exactly as they were. → the "keep them and make a new pass" path.
4. **Manually** move the new households into existing books one at a time (books editor). Fine for a
   few; impractical for a bulk import.

> **Walk-list gotcha.** The above "recut includes new addresses" only holds for an **all-voters**
> pass. If the pass is bound to a **walk list** (frozen snapshot), a recut uses that frozen list and
> will **not** pick up the new addresses — re-imports never modify a saved walk list. To include
> them you'd make a new walk list (or a new all-voters pass).

---

# Part 2 — Technical reference

Authoring/lifecycle: [`server/src/routes/admin/passes.js`](../server/src/routes/admin/passes.js) and
[`server/src/routes/admin/turfs.js`](../server/src/routes/admin/turfs.js). Generation:
[`server/src/services/turf/generateTurf.js`](../server/src/services/turf/generateTurf.js) (runs in a
BullMQ worker). Operational steps live in [TURF_RUNBOOK.md](../TURF_RUNBOOK.md).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `roundNumber` (unique per campaign, never reused), `name`, `walkListId` (null = all voters), `status` (`draft`/`active`/`archived`), `activatedAt` (monotonic — drives pass attribution), `archivedAt`, `recutLock{lockedAt,lockedBy}`. Unique index `{campaignId, roundNumber}`. |
| `Turf` (= "book") | [models/Turf.js](../server/src/models/Turf.js) | `passId` (required), `campaignId`, `name`, `mode` (`attribute`/`geometric`/`manual`), `params`, `householdIds[]` (**ordered** = walk sequence), `doorCount`, `boundary`/`centroid` (GeoJSON, **display-only**, not geo-indexed), `status` (`draft`/`published`/`archived`), `generationJobId`, `generatedBy`. |
| `Campaign.activePassId` | [models/Campaign.js](../server/src/models/Campaign.js) | Single ObjectId (not an array) → the one active pass; `null` when none. |
| `Household.turfId` / `walkOrder` | [models/Household.js](../server/src/models/Household.js) | Denormalized mirror of "which book + position" for the household; `null` until assigned by a cut. |
| `TurfAssignment` | [models/TurfAssignment.js](../server/src/models/TurfAssignment.js) | Which user is assigned which book on which pass (`{userId, campaignId, passId, turfId}`); drives the mobile bootstrap's per-canvasser scoping. |
| `WalkList` | [models/WalkList.js](../server/src/models/WalkList.js) | Frozen `householdIds[]` snapshot a pass can target; **immutable** w.r.t. later imports. |

## B. Generation pipeline

`generateTurf({ campaignId, passId, mode, params })`
([generateTurf.js](../server/src/services/turf/generateTurf.js)):

1. **Load households** ([:36-44](../server/src/services/turf/generateTurf.js#L36-L44)) — base filter
   = `{ campaignId, isActive: true, 'location.coordinates': {$exists,$ne:null} }`. If
   `pass.walkListId` is set, intersect with the walk list's frozen `householdIds`. **This is why an
   all-voters pass picks up newly imported households on a recut, but a walk-list pass does not.**
2. **Cut** by mode: `attributeCut` ([attributeCut.js](../server/src/services/turf/attributeCut.js)) —
   group by a denormalized cut column (precinct/county/city/zip/districts), optional `capN`
   geometric subdivision; `geometricCut` ([geometricCut.js](../server/src/services/turf/geometricCut.js)) —
   capacity-balanced k-means, `maxDoors` default 65; `manual` — households within `params.polygon`.
3. **Wipe prior drafts** ([:72-78](../server/src/services/turf/generateTurf.js#L72-L78)) — delete the
   pass's existing `draft` Turfs + their `TurfAssignment`s and clear the household mirror, so a
   re-run is idempotent. (Published books are *not* touched here — the `/generate` route blocks when
   published books exist; see §C.)
4. **Per book**: compute walk order, centroid, boundary (concave hull → Voronoi-clipped territory),
   insert as `status: 'draft'`, and **mirror** `turfId`/`walkOrder` back onto each household.

The route enqueues this as an async job and returns a `jobId` to poll
([turfs.js `/generate`:45](../server/src/routes/admin/turfs.js#L45), poll at `/jobs/:jobId`).

## C. Lifecycle & routes

**Passes** ([passes.js](../server/src/routes/admin/passes.js)):

| Route | Behavior |
|---|---|
| `POST /campaigns/:campaignId/passes` | Create (auto-increments `roundNumber`, optional `walkListId`); starts `draft`. |
| `POST /passes/:id/activate` ([:104](../server/src/routes/admin/passes.js#L104)) | 409 if archived ([:108](../server/src/routes/admin/passes.js#L108)); 400 if no published books ([:111](../server/src/routes/admin/passes.js#L111)); **archives all other active passes** ([:115-118](../server/src/routes/admin/passes.js#L115-L118)); sets `Campaign.activePassId` ([:122](../server/src/routes/admin/passes.js#L122)). |
| `POST /passes/:id/archive` ([:129](../server/src/routes/admin/passes.js#L129)) | Archive; clears `activePassId` if it was this pass. |
| `DELETE /passes/:id` ([:145](../server/src/routes/admin/passes.js#L145)) | Draft-only. |

**Books / turf** ([turfs.js](../server/src/routes/admin/turfs.js)):

| Route | Behavior |
|---|---|
| `POST .../turfs/generate` ([:45](../server/src/routes/admin/turfs.js#L45)) | Enqueue generation; **409 `has-published-books`** if the pass already has published books ([:59-65](../server/src/routes/admin/turfs.js#L59-L65)) — Discard is the path to re-cut. |
| `POST .../turfs/accept` ([:99](../server/src/routes/admin/turfs.js#L99)) | Draft → published for the pass. |
| `POST .../turfs/add-supplemental` | **Non-destructive add.** Cut the pass's currently-unassigned households (`turfId:null`, same base filter as generation) into new **draft** book(s) via `geometricCut`, mirror `turfId`/`walkOrder`, `recomputePassTerritories`. Works on an active/published pass (unlike `/generate`); serialized by `Pass.recutLock`. New books then use Accept + Assign. Body `{ passId, name?, maxDoors? }` → `{ added, bookCount, bookIds }`. Service: `addSupplementalBooks` in [generateTurf.js](../server/src/services/turf/generateTurf.js). |
| `POST .../turfs/discard` ([:113](../server/src/routes/admin/turfs.js#L113)) | Snapshot (for undo) → delete the pass's books + assignments + clear household mirror; if the pass was active, revert it to `draft` and clear `activePassId`; optional `clearKnocks` wipes that pass's `CanvassActivity`/`SurveyResponse`. Serialized by `Pass.recutLock`. |
| `POST .../turfs/restore-snapshot` | Re-create books + assignments from a snapshot (blocked if live books exist; does not auto-reactivate the pass). |
| move/merge/split door endpoints | Manual book edits; re-tessellate via `recomputeTurf` / `recomputePassTerritories`. |

## D. Why new households are unassigned after import

CSV import upserts households on `{campaignId, normalizedAddress}`
([csvImporter.js](../server/src/services/import/csvImporter.js)); the post-import processor
([importProcessor.js](../server/src/services/import/importProcessor.js)) recomputes cut attributes and
early-voting flags but performs **no book assignment**. New households therefore carry
`turfId: null` and are invisible to canvassers on the active pass until a (re)cut assigns them — see
the Part 1 scenario.

## E. Aggregation: pass-aware vs campaign-wide

| Concern | Pass-aware? | Where |
|---|---|---|
| **Knocks** (billable) | **Yes** — grouped by `(householdId, passId)` | `knocksPipeline` in [reports.js](../server/src/routes/admin/reports.js); `CanvassActivity.passId` |
| **Surveys / surveyed voters** | Tagged with `passId`; one survey per `(voterId, passId)` | `SurveyResponse.passId` ([models/SurveyResponse.js](../server/src/models/SurveyResponse.js)) |
| **Overlap detection** | **Yes** — `(householdId, passId)` with 2+ distinct canvassers | `/overlaps` in reports.js |
| **Coverage / homes-knocked** | **No** — current `Household.status`, campaign-wide | `Household.aggregate` in reports.js |
| **Dashboard totals** | Sum **across all** passes (no `passId` filter) | `/overview`, `/campaign-rollup` |
| **`bookId` (turfId)** | **Not used in reporting at all** | books are operational, not accounting |

So recutting or running another pass **adds knocks** (new `(house, pass)` buckets) but leaves
**coverage** unchanged (one house, one status). See the worked example in [METRICS.md](METRICS.md).

## F. Offline pass attribution

A knock submitted offline carries its original timestamp. The submission path resolves which pass it
belongs to via the passes' **`activatedAt` half-open windows**
([routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js)), falling back to
`Campaign.activePassId`. This is why `activatedAt` is preserved across recuts and why archived
passes still own their historical knocks.
