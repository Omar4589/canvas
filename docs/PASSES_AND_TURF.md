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

> **Updated — a "pass" lives inside a walk list.** The user-facing term is **Pass** again (Pass 1,
> Pass 2, …; the `Pass` model stores the counter as `roundNumber`). A campaign is split into **walk
> lists** (efforts — areas or teams), and each pass belongs to **one walk list** (still the
> cut/assign/billing unit) — you manage passes *inside* the walk list, not on a top-level page. For
> the pass **lifecycle, numbering, auto Pass 1, and where they're managed**, see the dedicated
> **[PASSES.md](PASSES.md)**. The **turf-cutting** mechanics below — generating books, accept/discard,
> move/merge/split, supplemental books — are unchanged and apply **per pass**. What also changed:
> (1) a campaign can have **several active passes at once** (one per active walk list), not one;
> (2) a pass's door-set comes from its **walk list's owned doors** (`Household.effortId`);
> (3) knock attribution is **deterministic by door → book → walk list**, not the `activatedAt`
> time-window; (4) new-address imports go to **Intake** until assigned to a walk list. See
> [EFFORTS.md](EFFORTS.md) and [IMPORTS.md](IMPORTS.md).

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

**Excluding restricted-access homes from a later round (admin-reviewed).** When a canvasser marks a home
**Restricted access** in the field (gated / locked / inaccessible — see [METRICS.md](METRICS.md)), the
home stays in the campaign, fully counted and visible. But when you cut the **next** round, you usually
don't want to send someone back to a door nobody could reach. So the Turf Cutting page shows an
**"Exclude N restricted-access homes"** toggle whenever any exist (**on by default**). Leaving it on
skips those homes from **that round's books only** — it's **non-destructive** (the homes stay in the
campaign, still counted and shown on the coverage bar as their own slate segment) and **overridable**
(re-disposition a door in the field and it re-enters scope on the next cut). This is **opt-in per cut**,
never automatic: turn it off to include them (e.g. if access has since opened up). It's the second-pass
counterpart to the field marker — the field records "can't get in," the admin decides per round whether
to keep trying.

**Marking a whole book restricted (bulk).** When an entire book is inaccessible (a gated community),
select it on the Turf Cutting page, or on mobile open its **⋯** menu (the Books map's promoted-book
sheet, or the book detail screen reached from List view) — **Mark restricted…** —
`POST .../turfs/restrict-bulk { turfIds[] }` creates a real restricted activity row per eligible door
(`via: 'bulk'`, the acting admin's user, the house's own coordinates, the book's round), so canvassers
see the slate doors **immediately** in their round view and the excludeRestricted toggle above catches
the whole community on the next cut. Doors **completed this round** are skipped (they keep their
result), already-restricted doors are skipped (idempotent), and field rows are never deleted — a
canvasser can still re-disposition any door, which supersedes the bulk mark. **Unmark restricted (N)**
(`POST .../turfs/unrestrict-bulk`) deletes only the bulk-created rows and recomputes statuses; field
marks survive. Bulk rows are excluded from per-canvasser stats and the GPS audit — see
[METRICS.md](METRICS.md).

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

## Watching a round on the cut map

Once a round has been worked, the Turf Cutting map stops being only a cutting tool and starts
answering *"how is this round going?"* — without leaving the page.

- **Each house is colored by what happened at it this round** — surveyed, not home, refused,
  restricted, or still unknocked — using the same colors as the Map page. Around each house sits a
  **ring in its book's color**, so you can read "this one is a not-home *and* it's in Book 4" at a
  glance. That's two facts on one dot.
- **The shape agrees with the ring.** Every house sits inside its book's outline (see *Every house
  is inside its book's shape* below), so the shape a dot sits in and the ring around it always name
  the same book.
- **Book labels count the work**: `Book 4 · 23/65` — 23 of its 65 houses done.
- **Book shading tracks completion**: an untouched book is pale, a finished one is solid. Spot the
  book nobody has started from across the map without reading a single number.
- **A coverage bar** across the top gives the whole round's mix — how many surveyed, not home,
  refused, still unknocked — and doubles as the map's color key.
- **Click a house** for its status, who knocked it, when, and any survey answers recorded there this
  round, alongside the usual "move to another book".
- **Apartment buildings** show `5/12 hit` instead of `12 units` once the round is underway.

This appears **automatically once the round has knocks**. While you're still cutting, houses stay
colored by book exactly as before — a fresh cut has no status to show, and coloring every dot the same
gray would only make the cut harder to see. A **Door status** checkbox in the map's Layers box forces
it either way.

**It does not auto-refresh.** The page shows the round as of when you opened it; reload to update.

## Every house is inside its book's shape

The shaded outline around a book **contains every one of the book's houses**, and outlines still
**never overlap**. The book itself remains its list of houses — the outline is drawn *from* that
list, and it always agrees with it.

One shape follows from that guarantee: a **pocket**. When a book owns a house that sits in the middle
of another book's houses (which the size-balancing cut legitimately produces), the map draws a small
island of the owning book's color right around that house, and the surrounding book's shape carries a
matching hole. A pocket isn't an error — it's the map telling you, at a glance, "this door belongs to
that other book." The house's ring color and its popup say the same thing.

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

## Editing books after the cut (move a door, merge, split)

Sometimes you don't need a full recut — you just want to reshape a book or two. These edits live in
the books editor on the Turf Cutting page and apply to a pass's **published** books.

> **The rule that makes all of this safe: knocks follow the _door_, not the _book_.** A knock is
> recorded against a household (door) + pass — never against a book — so moving a door to another
> book, merging books, or splitting a book **never changes coverage or billable counts**, and an
> already-knocked door keeps its status wherever it lands. And a **billable knock is one distinct
> (door, pass)**: if two canvassers on the same book knock the same door in the same pass, it bills
> **once** (a new pass counts again). Overlap can never double-bill.

- **Move a door to another book.** Pulls the house out of its current book and into the target,
  re-numbering both books' walk order. A door can only move between books **in the same walk list**
  (walk lists own disjoint doors). You can also move **every unit of one building** at once.
- **Merge two or more books** (same pass) into one. The first book is kept; the others' doors move
  into it and the emptied books are removed. **Assignments are folded in:** if the books were assigned
  to the _same_ person, they stay assigned once; if to _different_ people, **both stay assigned to the
  merged book** — on purpose (you _can_ put two canvassers on one book, and billing won't double-count
  if they overlap). Reassign afterward if you want a single owner.
- **Split a book** — peel a subset of doors out into a **new** book. Heads-up: the new book comes out
  **unassigned** (a merge can fold assignments; a split can't guess who should get the new book), so
  **assign it** or its doors drop off the original canvasser's list.

**Two things to know, by design:**
- **A merge can't be undone** (unlike Discard, it takes no snapshot). Merging already-worked books is
  safe for the counts, but you can't un-merge — recut the pass if you need the old split back.
- **Fixing a pin ≠ moving the door's book.** Correcting a mis-placed pin (below) moves the _dot_ only;
  the door stays in whatever book the cut put it in. If a pin was so wrong it sat in the wrong area,
  fix the pin **and** use _Move door_ to put it in the right book.

## Fixing a mis-placed pin

A house pin in the wrong spot can be dragged to its correct location — an admin does it on the web map
(**"Move pin"**), and a **canvasser can do it in the field** (**"Fix pin location,"** including "use my
current GPS"). Either way it corrects **only the coordinates** (with an audit trail); it does **not**
change the book, the walk order, the door's status, or any count, and it **needs no recut**. Canvassers
see the corrected spot on their **next sync (within ~30s** — see below). Full mechanics:
[MAPS.md → Coordinate provenance & pin correction](MAPS.md). (What you _can't_ do in-app is edit the
address _text_ or re-run geocoding on a single door — the pin drag is the tool.)

## How field phones get these edits — and when

The field app is **pull-only** (no live push). Two refresh layers decide _when_ a canvasser sees an
admin change:

| What you changed | When the canvasser sees it |
|---|---|
| A **pin move**, a door's **status**, or a door going **excluded/voted** | **Live — within ~30s.** A background delta patches their map in place. |
| A door's **book** (move / merge / split / supplemental) or **who's assigned** a book | **Next full refresh** — pull-to-refresh, reopening/switching the campaign, a round activating, or a cold app start. |

So a **pin fix is near-live**, but **reshuffling books or reassigning people is not** — the phone keeps
showing the old books until a full refresh. Nothing is lost or miscounted in the meantime (a door
briefly visible in two places still bills once per pass), but if you move work between canvassers
**mid-shift, tell them to pull-to-refresh** so the losing canvasser drops the door and the new one
picks it up. Plumbing behind both layers is in [MAPS.md](MAPS.md); the field flow is in
[CANVASSER_APP.md](CANVASSER_APP.md). Technical details in Part 2 §G.

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
Round 2 shows both. The **Turf Cutting page** is pass-scoped the same way (see *Watching a round on
the cut map* below): pick a round in its dropdown and the house colors, the per-book progress and the
coverage bar all re-scope to that round.

**Archiving a round is one-way + guarded.** A round goes draft → active → archived and is **never
reopened** (you make a new round). Archiving a **live or already-worked** round therefore needs a
confirmation (knocks are kept either way); only the *auto*-archive when you activate the next round is
silent.

## One active pass per walk list

Each **walk list** runs **one active pass at a time** — activating a pass archives the other active
pass *in that same walk list*, but other walk lists keep theirs. So a campaign can have **several active
passes at once** (one per active walk list — see the banner above and [EFFORTS.md](EFFORTS.md)).
Canvassers only ever see an **active** pass, and within it only the **books assigned to them**; passes
sitting in draft or archived are never shown in the field.

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
4. **Manually** move the new households into existing books one at a time (see **Editing books after
   the cut** above). Fine for a few; impractical for a bulk import.

> **Walk-list gotcha.** The above "recut includes new addresses" only holds for an **all-voters**
> pass. If the pass is bound to a **walk list** (frozen snapshot), a recut uses that frozen list and
> will **not** pick up the new addresses — re-imports never modify a saved walk list. To include
> them you'd make a new walk list (or a new all-voters pass).

### New voters at homes you've **already worked**

A different, rarer case: an import drops a **new target voter into a home you've already knocked or
surveyed**. The new voter is attached to the existing home (no duplicate door), but the door's status
is **per-household** and already reads "done," and the home is **not** in Intake — it's still owned by
whatever book worked it. So by default nothing surfaces the new voter for a revisit.

We deliberately do **not** reopen the door in place: a re-knock in the *same* pass dedupes to one knock
per house×pass, so it wouldn't **bill** the revisit, and rewriting a completed door's status back to
"unknocked" would muddle the first knock's history.

Instead, the **voter import has an opt-in checkbox — "Revisit already-worked homes that gain a new
voter."** When it's on and the import lands new target voters in already-worked homes, those homes are
collected into an auto-generated **saved search** ("New voters — <file>", `source: 'import'`). From
the import summary, **Create revisit walk list →** deep-links to the Walk Lists page with that saved
search preselected as the new list's door source: name it and **Create walk list**, and because those
homes are already owned, the app **re-carves** them into the new list for you (pulling them from their
old books). Then cut books and walk. Because it's a **new pass**, the revisit **bills as its own
knock**, and the first knock stays intact in its original pass. Brand-new addresses from the same
import still go to **Intake** as usual; to walk both together, claim Intake + this list into the one
walk list. "Already worked" = the home's sticky status is a completion (`surveyed` for survey
campaigns, `lit_dropped` for lit-drop), so it holds even if the completing round is archived.

---

# Part 2 — Technical reference

Authoring/lifecycle: [`server/src/routes/admin/passes.js`](../server/src/routes/admin/passes.js) and
[`server/src/routes/admin/turfs.js`](../server/src/routes/admin/turfs.js). Generation:
[`server/src/services/turf/generateTurf.js`](../server/src/services/turf/generateTurf.js) (runs in a
BullMQ worker). Operational steps live in [TURF_RUNBOOK.md](../TURF_RUNBOOK.md).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `effortId` (the walk list whose owned doors are the round's universe), `roundNumber` (unique **per walk list**, never reused), `name`, `targetFilter` (optional walk-list-shaped filter for a targeted follow-up round), `walkListId` (**deprecated** — null on new rounds; the door-set comes from the effort), `status` (`draft`/`active`/`archived`), `activatedAt` (set on activation; knock attribution is now door→book→walk-list, not this timestamp — see the banner), `archivedAt`, `recutLock{lockedAt,lockedBy}`. Unique index `{effortId, roundNumber}` ([Pass.js:58](../server/src/models/Pass.js#L58)). |
| `Turf` (= "book") | [models/Turf.js](../server/src/models/Turf.js) | `passId` (required), `campaignId`, `name`, `mode` (`attribute`/`geometric`/`manual`), `params`, `householdIds[]` (**ordered** = walk sequence), `doorCount`, `boundary`/`centroid` (GeoJSON, **display-only**, not geo-indexed), `status` (`draft`/`published`/`archived`), `generationJobId`, `generatedBy`. |
| Active passes (derived) | [services/passes/activePasses.js](../server/src/services/passes/activePasses.js) | `activePassIds(campaignId)` derives the live passes from `Pass.status==='active'` — **one per active walk list** (a campaign can have several at once). There is **no** `Campaign.activePassId` field. |
| `Household.turfId` / `walkOrder` | [models/Household.js](../server/src/models/Household.js) | Denormalized mirror of "which book + position" for the household; `null` until assigned by a cut. |
| `TurfAssignment` | [models/TurfAssignment.js](../server/src/models/TurfAssignment.js) | Which user is assigned which book on which pass (`{userId, campaignId, passId, turfId}`); drives the mobile bootstrap's per-canvasser scoping. |
| `SavedSearch` | [models/SavedSearch.js](../server/src/models/SavedSearch.js) | Frozen `householdIds[]` snapshot a pass can target; **immutable** w.r.t. later imports. (Formerly `WalkList`.) |

## B. Generation pipeline

`generateTurf({ campaignId, passId, mode, params })`
([generateTurf.js](../server/src/services/turf/generateTurf.js)):

1. **Load households** ([:36-44](../server/src/services/turf/generateTurf.js#L36-L44)) — base filter
   = `{ campaignId, isActive: true, effortId: pass.effortId, 'location.coordinates': {$exists,$ne:null} }`
   — a round cuts only its **effort's** owned doors (see [EFFORTS.md](EFFORTS.md)). When
   `params.excludeRestricted` is set, the base filter also gets **`status: { $ne: 'restricted' }`**, so
   inaccessible homes are dropped from **that** cut's books (opt-in; non-destructive — the homes are
   untouched in the DB). `addSupplementalBooks` takes the same `excludeRestricted` option.
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

### Book outlines: containment AND non-overlap — both, via door-level Voronoi

`computeBoundary` ([boundary.js](../server/src/services/turf/boundary.js)) walks a relaxing `maxEdge`
ladder (0.4 → 0.6 → 1.2 km) and **each rung must contain every one of the book's houses**, falling
back to `turf.convex` (which contains all input points by construction). It used to return on the
first rung that produced a `Polygon` — but `turf.concave` triangulates away outlying points and still
returns a valid Polygon, so hulls were accepted that visibly excluded their own doors and the ladder
never got its chance (measured: **1 of 13 houses outside at maxEdge 0.4, 0 at 1.2**).

`computeTerritories` builds each stored outline as

```
territory_i = hull_i ∩ union(Voronoi cells of book i's OWN doors)
```

with the Voronoi diagram seeded by **every booked door of the pass** — not one seed per book. Every
door is inside its own cell by definition and inside its hull (verified above), so it is inside the
intersection; cells are disjoint across books, so territories never overlap. **Both properties hold
simultaneously.** An earlier revision of this section claimed that was impossible and pinned the loss
as by-design — that held only for the previous construction (each hull clipped to a *single* cell
seeded at the book's centroid), under which a door nearer a neighbour's centroid fell outside its own
outline (measured then: 7 of 24 doors lost from a street book). The door-level union retires that
trade-off. Measured at production scale (16.5k doors / 128 books): **~1.5s full recompute, 0 doors
outside, 0 m² overlap**, ~95 KB total geometry. Deterministic — worker re-runs reproduce identical
shapes. Duplicate coordinates (apartment stacks) are deduped first-book-wins; a coordinate genuinely
split across two books can only be strictly inside one of two disjoint shapes, so the minority units
rely on the ring/popup (the one honest residual). Contract pinned by `test/turfBoundary.test.js`.

Two shape consequences, both intended: a door surrounded by another book's houses gets a **pocket
island** (the territory becomes a `MultiPolygon`; the surrounding book carries a matching hole), and
`Turf.boundary` therefore accepts **`Polygon` or `MultiPolygon`** — safe because boundary is
display-only and never geo-queried (see the model comment; Mapbox on web and mobile renders both
natively, and the canvasser bootstrap never ships boundary at all).

**Edit-time cost is bounded by `onlyTurfIds`.** `recomputePassTerritories(passId, { onlyTurfIds })`
still seeds the diagram with the whole pass (seams depend on every door) but re-unions only the books
an edit touched (~110ms at 16k doors vs ~1.5s for all 128). Correct because a door *move* doesn't
change the diagram — only cell ownership flips, so untouched books' stored shapes stay exactly right —
and a door *removal* (the effort claim path) only grows the remaining cells, so untouched shapes stay
strictly inside their new entitlement: still disjoint, still containing. `recomputeTurf` writes the
**unclipped** hull and must always be followed by `recomputePassTerritories` — every call site does
(move-door, move-doors, merge, split, and the effort door-claim path in
[efforts.js](../server/src/routes/admin/efforts.js)), each passing the books it changed. Outlines cut
before this change are healed in place by `npm run recompute:territories -- --apply`
(see [OPERATIONS.md](OPERATIONS.md)) — it rewrites only `Turf.boundary`, so it is safe mid-round.

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
| `POST /passes/:id/activate` ([:111](../server/src/routes/admin/passes.js#L111)) | 409 if archived ([:115-116](../server/src/routes/admin/passes.js#L115-L116)); 400 if no published books; **archives other active rounds of the same walk list only** ([:127-132](../server/src/routes/admin/passes.js#L127-L132)) — other walk lists keep their active rounds; sets `activatedAt` once ([:134](../server/src/routes/admin/passes.js#L134)). No campaign-level pointer is written — active rounds are **derived** (see the data-model table). |
| `POST /passes/:id/archive` | **409 `archive-confirm-required`** `{ knockCount, isActive }` when the round is active **or** has knocks and `confirmArchive` isn't set (one-way + canvassers lose it — knocks kept). Else archive (`status:'archived'` + `archivedAt`, [:163-164](../server/src/routes/admin/passes.js#L163-L164)). |
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
| `POST .../turfs/generate` ([:45](../server/src/routes/admin/turfs.js#L45)) | Enqueue generation; **409 `has-published-books`** if the pass already has published books ([:59-65](../server/src/routes/admin/turfs.js#L59-L65)) — Discard is the path to re-cut. Skips fully-voted doors. Passes `params` straight through, so **`params.excludeRestricted`** reaches `generateTurf` and skips `status:'restricted'` doors for that cut (the "Exclude restricted-access homes" toggle; default on when any exist). |
| `POST .../turfs/accept` ([:99](../server/src/routes/admin/turfs.js#L99)) | Draft → published for the pass. |
| `POST .../turfs/add-supplemental` | **Non-destructive add.** Cut the pass's currently-unassigned households (`turfId:null`, same base filter as generation) into new **draft** book(s) via `geometricCut`, mirror `turfId`/`walkOrder`, `recomputePassTerritories`. Works on an active/published pass (unlike `/generate`); serialized by `Pass.recutLock`. New books then use Accept + Assign. Body `{ passId, name?, maxDoors?, excludeRestricted? }` (`excludeRestricted` adds `status: { $ne: 'restricted' }` to the base filter) → `{ added, bookCount, bookIds }`. Service: `addSupplementalBooks` in [generateTurf.js](../server/src/services/turf/generateTurf.js). |
| `POST .../turfs/discard` | **409 `active-pass-confirm-required`** (with `knockCount`/`assignmentCount`/`isActive`) when the pass is active **or has recorded knocks** and `confirmActive` isn't set — the client's typed-confirm dialog supplies it. Then: snapshot (for undo) → delete the pass's books + assignments + clear household mirror; if the pass was active, revert it to `draft` ([turfs.js:366-372](../server/src/routes/admin/turfs.js#L366-L372)); optional `clearKnocks` wipes that pass's `CanvassActivity`/`SurveyResponse` (captured in the snapshot). Serialized by `Pass.recutLock`. The turfs `GET /` also returns `knockCount` for the selected pass (drives the dialog's warning). |
| `POST .../turfs/restore-snapshot` | Re-create books + assignments from a snapshot (blocked if live books exist; does not auto-reactivate the pass). |
| `POST .../turfs/move-door` `{ householdId, fromTurfId?, toTurfId }` ([:851](../server/src/routes/admin/turfs.js#L851)) | Move one door between books in the same pass. Pulls it from its current book, pushes into `toTurfId`, `recomputeTurf` on both (re-mirrors `Household.turfId`/`walkOrder`) + `recomputePassTerritories`. **409** if the door's `effortId` ≠ the target book's effort (disjointness). Does **not** touch `CanvassActivity`. |
| `POST .../turfs/move-doors` `{ householdIds[], toTurfId }` ([:892](../server/src/routes/admin/turfs.js#L892)) | Bulk move (e.g. every unit of a building) — pulls the ids out of every other book in the pass, adds to `toTurfId`, one `recomputeTurf`/`recomputePassTerritories`. Same effort guard. |
| `POST .../turfs/merge` `{ turfIds[] }` ([:930](../server/src/routes/admin/turfs.js#L930)) | Merge ≥2 books of the **same pass** into `turfs[0]` (survivor). Union the doors onto the survivor; **fold assignments** (`findOneAndUpdate` upsert on `{turfId:survivor, userId}` → same-user dedups, different-users **both survive**); **hard-delete** the absorbed `Turf`s + their `TurfAssignment`s; `recomputeTurf`/`recomputePassTerritories`. **No snapshot → irreversible.** Survivor = DB order of the `$in`, not request order. |
| `POST .../turfs/:turfId/split` `{ householdIds[], name? }` ([:970](../server/src/routes/admin/turfs.js#L970)) | Peel `householdIds` out of the book into a **new** `Turf` (same pass/mode/params, `status` copied). `recomputeTurf` on both. **Creates no `TurfAssignment`** — the split-off book comes out unassigned. |
| `POST .../turfs/unassign-bulk` `{ turfIds[], userIds[] }` ([:151](../server/src/routes/admin/turfs.js#L151)) | Campaign-scoped `TurfAssignment.deleteMany` for the given (book, user) pairs — the "unassign everywhere" path. Touches no `Household`. |
| `GET .../turfs/doors?passId=&withStatus=1` | The effort's knockable doors with coordinates, each tagged with its book (`turfId`) or `null`. **`withStatus=1`** (opt-in) adds **`passStatus`** — the door's status *for this round*, from `getPassStatusMap`. Distinct from the always-present `status`, which is `Household.status` (latest across **all** rounds). Opt-in because the mobile assign map (`slim=1`) colors by book and would pay an aggregate + a string per door across a 16k-door effort for nothing. Drives **dot color only, never a count**. |
| `GET .../turfs/progress?passId=` | **The single count oracle for the cut page.** Per book: `{ turfId, total, knocked, statusCounts }` over eligible doors (`KNOCKABLE_DOOR_FILTER`), from one `getPassStatusMap` sliced per turf. `statusCounts` (via `statusCountsFromMap`) sums to `total` by construction, and Σ over books is the round total — so the book status chips, the map labels, the completion tint and the coverage bar cannot drift apart. `passStatus` above resolves from the same map over the same pass, so a dot's color can't contradict what it contributes. Also read by the mobile books screen, which ignores `statusCounts`. |
| `GET .../turfs/household/:householdId` | One door's address + members for the map popup. **Record-level audited**: a `router.param('householdId')` hook tags the household as an `AccessLog` subject, matching `/admin/households` and `/admin/voters` (this router previously had none). The popup's *round* detail — status/who/when and survey answers — comes from `/admin/households/:householdId/{activity,surveys}` instead, which are already lead-accessible, campaign-gated and subject-tagged. |

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

A knock submitted offline carries its original timestamp, but pass attribution is no longer
time-based. At submission the server resolves attribution **from the door**: `resolveAttribution`
([routes/mobile/canvass.js:72-82](../server/src/routes/mobile/canvass.js#L72-L82)) finds the
**published book containing the household** among the campaign's currently-active rounds and stamps
that book's `passId`/`turfId` (plus the door owner's `effortId`) on the activity row. `activatedAt`
is still kept monotonic and preserved across recuts (per-round reporting depends on its half-open
windows — [Pass.js:45](../server/src/models/Pass.js#L45)), and archived passes still own their
historical knocks because activity rows keep their original `passId`.

## G. Post-cut book edits & field-app propagation

The move/merge/split routes in §C are **pure book-membership operations**: they rewrite
`Turf.householdIds` and its `Household.turfId`/`walkOrder` mirror (via `recomputeTurf`,
[generateTurf.js:245](../server/src/services/turf/generateTurf.js#L245)), then re-tessellate the pass
(`recomputePassTerritories`, [:270](../server/src/services/turf/generateTurf.js#L270)). **None of them
writes `CanvassActivity`.** That is what makes them count-safe:

- **Knocks key on `(householdId, passId)`, never on a book** — see `CanvassActivity`
  ([models/CanvassActivity.js:26,46-58](../server/src/models/CanvassActivity.js#L26)) and its
  `{passId, householdId}` status indexes. Per-round door status is **derived** from that pair
  (`getPassStatusMap` / `statusesFromDoorPass`, [passStatus.js](../server/src/services/passes/passStatus.js)),
  so a moved/merged/split door keeps its status wherever it lands, and book progress recomputes over
  the new membership.
- **`CanvassActivity.turfId` is a write-only stamp** — set at knock time, **not** re-written by these
  edits, so historical rows keep pointing at the book the door was in when knocked. Harmless: nothing
  in reporting reads it (§E — "`bookId` not used in reporting at all"); book attribution always goes
  through the _live_ `Turf.householdIds`. **Do not** add a report that groups knocks by
  `CanvassActivity.turfId` without back-filling these edits first.

**Field-app propagation.** A canvasser's doors are resolved **live** per request from
`TurfAssignment → Turf.householdIds` (`canvasserBooks` / `canvasserScopeWithPasses`,
[canvasserScope.js](../server/src/services/canvass/canvasserScope.js)) in `GET /mobile/bootstrap` — there
is no server-side snapshot, so a full bootstrap always reflects current membership + assignment. But
the app **does not** refetch bootstrap on remount (`staleTime 30s`, `refetchOnMount:false`,
[map.jsx:310-337](../mobile/app/(app)/map.jsx#L310)); between full fetches it relies on the **30s delta**
`GET /mobile/changes` ([map.jsx:489-556](../mobile/app/(app)/map.jsx#L489)), which returns households whose
`updatedAt > since` **within the caller's current scope** and patches only `status` + `location` (pin) +
archival on **already-cached** doors. Voters ride the delta on **two tracks, unioned**
([routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js)): **(1)** ALL voters of each
changed household — not only docs whose own `updatedAt` moved, because marking a voter voted writes a
`VotedVoter` row, not the Voter doc (the recompute bumps the household, so its door is already in the
delta); **(2)** voters whose **own `updatedAt` moved** — a pure identity edit (admin correction, Person
propagation, re-import reconcile) touches only the Voter doc, never the household, so track 1 alone
would strand it until a cold re-bootstrap. Same cost class either way: index seeks over the
canvasser's own book scope, projected to the bootstrap's identity-cache fields. Consequences:

- **Pin moves & status changes propagate in ~30s** (they bump `Household.updatedAt` and stay in scope).
- **Voter identity edits propagate in ~30s too** (track 2) — a corrected name/party reaches phones
  without a pull-to-refresh. (One projection caveat: the delta ships the identity-cache fields only —
  `phone` isn't among them, so a phone-only correction reaches the profile screen live but the cached
  delta copy carries no phone until a full bootstrap.)
- **A move/merge/split is _not_ reflected by the delta**: it never adds a door, never changes book
  membership, and carries no removal signal — so a door that moved _out_ of a canvasser's book lingers
  on their cached map, and one that moved _in_ doesn't appear, until a full bootstrap.
- **A reassignment is invisible to the delta entirely** — `TurfAssignment` writes touch no `Household`,
  so nothing bumps `updatedAt`. The new/losing canvasser updates only on a full bootstrap.
- **Full-bootstrap triggers:** pull-to-refresh (campaigns/stats screens invalidate `['bootstrap']`),
  campaign switch (`clearBootstrap`), a round change detected by the delta (`activePassIds` differs →
  invalidate), or cold start. This is deliberate — a naive refetch-on-mount would revert an optimistic
  recolor — so liveness is "delta + manual refresh," not auto-refetch.

Bottom line: **membership/assignment edits are eventually-consistent on the client, reconciled at the
next full bootstrap; billing stays correct throughout** because it dedups per `(household, pass)` (§E).

**Wrong Address** is one of the `KNOCK_ACTIONS` ([aggregations.js:8](../server/src/services/reports/aggregations.js#L8)) —
a real **billable knock that counts as coverage**, non-sticky in `Household.status` (`resolveStatus`
makes only survey/lit sticky, [statusPrecedence.js](../server/src/utils/statusPrecedence.js)). A canvasser
can flag it, drop a note, and fix the pin, but **cannot edit the address string** — that's an admin/data
change on the web side.
