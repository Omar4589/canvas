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

- **Geometric** — the default; groups households into **compact, walkable** books by location. The
  door count you set is an **approximate target**, not a hard cap — books flex in size so a house is
  never stranded far from the rest of its book just to hit an exact number (i.e. no driving across the
  area for one or two stray doors). Compactness is prioritized over even book sizes. A **Tight /
  Balanced / Compact** control sets how much book sizes may flex (Compact by default — the least
  driving). See Part 2 §B.1.
- **Attribute** — one book per precinct / county / city / ZIP / district, etc. Before you cut, the
  page **previews each group's door count** so you can set a smart cap (oversized groups are split).
  The grouping values are the household's denormalized district/precinct/ZIP/county fields, derived
  from the imported **voters'** data.
- **Manual** — draw one or more areas on the map; **each area becomes a book**. As you draw, the panel
  shows the **houses + voters inside each area** (live), you can remove an area (✕) or **Clear all**,
  and an optional **"split areas over N doors"** geometrically sub-cuts a big area into ~N-door
  walkable books instead of one giant book. **Overlapping areas: the first area drawn wins** — a house
  only ever lands in one book, and the live counts reflect that while you draw (a second area that
  overlaps the first shows fewer houses).

Cuts only include **knockable** doors — already-voted (fully-voted) doors are skipped, and you can also
**remove apartments** (any building with **N+ units at one address**, default 4): those doors are
persistently excluded from cutting, the map, counts, and the canvasser list — exactly like already-voted
doors — until you re-include them. Before cutting, the panel shows the **knockable door count** (and a
rough book estimate), so you know what you're cutting (see [EARLY_VOTING.md](EARLY_VOTING.md) for the
shared exclusion mechanism).

Books are first created as **drafts** — nothing reaches canvassers until you **accept** them (drafts →
published). Re-cut freely until then; a **Discard** snapshots the layout so it's always recoverable.
A pass needs accepted (published) books before it can be activated.

## Assigning books to canvassers

Select one or more books (in the list or on the map) and add people. For several books at once there
are three modes: **Even books** (round-robin — each person gets a similar *book* count), **Even doors**
(greedy — spreads the *door* count evenly, since books vary in size), and **Everyone** (every selected
person on every selected book). A **Crew load** summary shows each person's books + doors so you can
see the balance, and a **search** box finds a book by name or assigned canvasser. **Only accepted
(published) books can be assigned** — assigning a draft is blocked (a re-cut would wipe it), so Accept
first.

## Recutting (changing the books)

If you don't like the books, or the underlying voter list changed, you **recut**. Two situations:

- The books are still **drafts** → just generate again; the old drafts are replaced automatically.
- The books are **accepted/published** → you must **Discard** them first, then generate again.
  Discard snapshots the current layout (so it can be undone), removes the books, and — if the pass
  was active — drops it back to **draft** (a live campaign can't be left with an active pass that
  has no books). Then you cut fresh and re-accept.

**Discarding a worked round is guarded.** If the round already has knocks recorded, the Discard dialog
names the **effort · round** in its title, shows how many knocks exist, and requires **typing
`discard`** to confirm (the server refuses without the explicit confirmation too) — so you can't wipe
the wrong effort's worked books by accident.

**What discard does — and doesn't — touch.** Discard deletes the **books** and **canvasser
assignments** and unlinks doors from their books. It does **not** delete knock history, survey
responses, door statuses, or the doors themselves (unless you explicitly check *clear knock history* —
and even then the cleared knocks go into the snapshot). The auto-saved **snapshot stores the books AND
the assignments**: **Restore** (Undo / snapshots) re-creates both exactly, then you just re-activate
the round on the Passes page — canvassers see their books again with all prior progress intact.
(Restore is blocked while the pass has live books — discard those first.)

There is **no "add just the new houses to the existing books"** option. Recutting is all-or-nothing
for a pass: replace that pass's whole book set.

## Targeted follow-up rounds (cut over only the doors that still need work)

A new round normally cuts the effort's **whole** door universe. For a **follow-up round** you can cut
over only a **subset** — open **Target doors** on the Turf Cutting page and pick any mix of:
- **knock status** — e.g. *unknocked* (never reached), *not-home* (re-try); and
- **survey answers** — e.g. *Undecided* (persuasion), *Support / Likely* (GOTV).

Combine with **OR** (the union — "unknocked **or** supporters") or **AND** ("not-home **and** supporters").
The panel shows a live door/voter count, and the cut produces books over just those doors — scoped to
**this effort only** (it never pulls another effort's doors). Recut without a target = the full universe,
unchanged.

## Each round is its own pass — door status is per-round

Crucially, **a round is an independent billable pass.** A door's "done/not-done" that the canvasser
sees is **per the round they're working** — so a supporter you surveyed in Round 1 shows up **fresh**
in a Round-2 GOTV book, the canvasser re-contacts it, and that counts as a **new billable knock**
(billing already counts one knock per *door × round*). What carries across rounds is **coverage** —
the campaign-wide "have we ever reached this door" picture (`Household.status`) — which a re-knock
updates without double-counting. So: **per-round** for what the canvasser works; **global** for
coverage/reporting. (First/only rounds look exactly as before — the difference only shows once a Round 2
exists.)

A canvasser's per-round status is resolved from **their assigned book's round** (not a door's global
book pointer), so you can **cut/prep the next round at any time** — even while the current round is still
being walked — without disturbing the active round's canvassers. (Activating the new round still archives
the old one and needs its own book assignments — a new round is a fresh assignment.)

**Seeing it as an admin.** The **Passes page** shows a **Knocks** count per round (the billable
`door × round` figure) next to the books + progress. The **audit map** (Passes → *Audit →*) is
**pass-scoped**: with a round selected it shows *that round's* door status + activity, not the global
latest — and the door detail has a **History by round** section, so a door worked in Round 1 *and*
Round 2 shows both.

**Archiving a round is one-way + guarded.** A round goes draft → active → archived and is **never
reopened** (you make a new round). Archiving a **live or already-worked** round therefore needs a
confirmation (knocks are kept either way); only the *auto*-archive when you activate the next round is
silent.

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
   = `{ campaignId, isActive: true, effortId: pass.effortId, 'location.coordinates': {$exists,$ne:null} }`
   — a round cuts only its **effort's** owned doors (see [EFFORTS.md](EFFORTS.md)).
2. **Cut** by mode: `attributeCut` ([attributeCut.js](../server/src/services/turf/attributeCut.js)) —
   group by a denormalized cut column (precinct/county/city/zip/districts), optional `capN`
   geometric subdivision; `geometricCut` ([geometricCut.js](../server/src/services/turf/geometricCut.js))
   → `balancedKMeans` ([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) —
   **compactness-first** clustering with `maxDoors` as a soft target (§B.1); `manual` — households
   within `params.polygon`.
3. **Wipe prior drafts** ([:72-78](../server/src/services/turf/generateTurf.js#L72-L78)) — delete the
   pass's existing `draft` Turfs + their `TurfAssignment`s and clear the household mirror, so a
   re-run is idempotent. (Published books are *not* touched here — the `/generate` route blocks when
   published books exist; see §C.)
4. **Per book**: compute walk order, centroid, boundary (concave hull → Voronoi-clipped territory),
   insert as `status: 'draft'`, and **mirror** `turfId`/`walkOrder` back onto each household.

The route enqueues this as an async job and returns a `jobId` to poll
([turfs.js `/generate`:45](../server/src/routes/admin/turfs.js#L45), poll at `/jobs/:jobId`).

## B.1 The geometric cut (compactness-first)

`balancedKMeans(items, maxDoors, { tolerance = 0.4 })`
([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) makes books as **tight and walkable**
as possible, treating `maxDoors` as an **approximate target**, not a hard equal cap. (The old
capacity-balanced cut forced near-equal sizes, which exiled boundary houses into far books — a canvasser
driving across the area for one door.) Everything runs on Hilbert-projected meters and is fully
**deterministic** (no `Math.random`, so a worker re-run reproduces identical books):

- **k & soft band:** `k = ceil(n / maxDoors)` books; `softMax = ceil(maxDoors·(1+tolerance))` (initial
  balance), `hardMax = ceil(maxDoors·(1+1.5·tolerance))` (true ceiling), `softMin = floor(maxDoors·(1−tolerance))`.
- **Seed + assign (Lloyd loop):** centroids seeded evenly along the Hilbert curve; each house goes to its
  **nearest** book still under `softMax`, and overflow picks the **nearest book with room** — never a
  distance-blind "book with the most space" (the old stray source).
- **Relocation polish:** move any house to a strictly-nearer book that has room — single-point, so it
  relocates a *lone* stray (which a count-preserving swap cannot).
- **Swap polish:** trade boundary pairs between two full books (count-preserving, lowers total distance).
- **Tiny-book merge:** fold a sub-`softMin` book into an adjacent one if the result fits under `softMax`;
  a genuinely **isolated** small cluster is left alone (don't drag a remote hamlet across town).
- **`hardMax` rescue (the finisher):** a house still stuck far from its cluster joins its **nearest** book
  even slightly over target (up to `hardMax`) instead of driving away — compactness beats the count.

`tolerance` is surfaced on the Turf Cutting page as a **Tight / Balanced / Compact** toggle
(`0.15 / 0.25 / 0.4`; default **Compact = 0.4**), sent through `params.tolerance` (the `/generate` route
passes `params` straight through). Lower → tighter, more even books; higher → more size flex for
compactness. On a synthetic benchmark vs. the old cut, the farthest house from its book center dropped
from ~5 km to ~1 km, and "misplaced" doors (a closer book exists) from ~100 to 0–7. The same engine
powers `geometricSubdivide` (attribute mode, default flex) and `addSupplementalBooks`.

## C. Lifecycle & routes

**Passes** ([passes.js](../server/src/routes/admin/passes.js)):

| Route | Behavior |
|---|---|
| `POST /campaigns/:campaignId/passes` | Create (auto-increments `roundNumber`, optional `walkListId`); starts `draft`. |
| `POST /passes/:id/activate` ([:104](../server/src/routes/admin/passes.js#L104)) | 409 if archived ([:108](../server/src/routes/admin/passes.js#L108)); 400 if no published books ([:111](../server/src/routes/admin/passes.js#L111)); **archives all other active passes** ([:115-118](../server/src/routes/admin/passes.js#L115-L118)); sets `Campaign.activePassId` ([:122](../server/src/routes/admin/passes.js#L122)). |
| `POST /passes/:id/archive` | **409 `archive-confirm-required`** `{ knockCount, isActive }` when the round is active **or** has knocks and `confirmArchive` isn't set (one-way + canvassers lose it — knocks kept). Else archive; clears `activePassId` if it was this pass. |
| `GET /campaigns/:campaignId/passes` | Each pass row carries `turfCount` **and `knockCount`** (distinct `(household, pass)` over `KNOCK_ACTIONS`) for the Passes page. |
| `GET /admin/households/:householdId/activity` | A door's `CanvassActivity` + `SurveyResponse` across all rounds, grouped by round (`{ rounds: [{ passId, roundNumber, name, entries }] }`) — powers the door-detail "History by round". |
| `DELETE /passes/:id` ([:145](../server/src/routes/admin/passes.js#L145)) | Draft-only. |

**Books / turf** ([turfs.js](../server/src/routes/admin/turfs.js)):

| Route | Behavior |
|---|---|
| `GET .../turfs/attribute-preview?passId=&attribute=` | Group-sizes preview for attribute mode: knockable doors per `ATTR_COLUMN[attribute]` group (same cut base filter), `{ groups: [{ name, doorCount }] }` desc. |
| `POST .../turfs/manual-preview` `{ passId, polygons }` | Per-area preview for manual mode: cuttable houses (`$geoWithin`, same cut base filter) + their `Voter` count inside each drawn polygon → `{ areas: [{ doorCount, voterCount }] }` index-aligned. Manual `generate` takes `params.polygons[]` (one book each) + optional `subCutN` (geometric split of big areas). **Overlap dedup is first-area-wins** in both the preview and the cut (a `claimed` Set across the polygon loop), so a house is never double-assigned/double-counted. |
| `POST .../turfs/assign-bulk` | Bulk-assign selected books to selected people. `mode`: `distribute` (round-robin, even **books**), `balance` (greedy by eligible door count, even **doors**), `everyone` (all on all); `replace` clears existing first. **409 `not-accepted`** if any selected book is still a draft (per-book `POST /:turfId/assignments` enforces the same). |
| `POST .../turfs/exclude-apartments` `{ passId, threshold }` | Group the effort's doors by rounded geocode; set `Household.excludedFromTurf:true` on members of clusters ≥ threshold → they skip cutting/map/counts/canvasser everywhere (mirrors `fullyVoted`). `POST .../turfs/include-apartments` clears it. |
| `POST .../turfs/generate` ([:45](../server/src/routes/admin/turfs.js#L45)) | Enqueue generation; **409 `has-published-books`** if the pass already has published books ([:59-65](../server/src/routes/admin/turfs.js#L59-L65)) — Discard is the path to re-cut. Skips fully-voted doors. |
| `POST .../turfs/accept` ([:99](../server/src/routes/admin/turfs.js#L99)) | Draft → published for the pass. |
| `POST .../turfs/add-supplemental` | **Non-destructive add.** Cut the pass's currently-unassigned households (`turfId:null`, same base filter as generation) into new **draft** book(s) via `geometricCut`, mirror `turfId`/`walkOrder`, `recomputePassTerritories`. Works on an active/published pass (unlike `/generate`); serialized by `Pass.recutLock`. New books then use Accept + Assign. Body `{ passId, name?, maxDoors? }` → `{ added, bookCount, bookIds }`. Service: `addSupplementalBooks` in [generateTurf.js](../server/src/services/turf/generateTurf.js). |
| `POST .../turfs/discard` | **409 `active-pass-confirm-required`** (with `knockCount`/`assignmentCount`/`isActive`) when the pass is active **or has recorded knocks** and `confirmActive` isn't set — the client's typed-confirm dialog supplies it. Then: snapshot (for undo) → delete the pass's books + assignments + clear household mirror; if the pass was active, revert it to `draft` and clear `activePassId`; optional `clearKnocks` wipes that pass's `CanvassActivity`/`SurveyResponse` (captured in the snapshot). Serialized by `Pass.recutLock`. The turfs `GET /` also returns `knockCount` for the selected pass (drives the dialog's warning). |
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
