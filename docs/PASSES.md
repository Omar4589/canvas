# Passes (a walk list's billable sweeps)

> The user-facing term is **Pass** (Pass 1, Pass 2, …). In the code the `Pass` model stores the
> per-walk-list counter as **`roundNumber`** — earlier docs called a pass a "Round". Throughout this
> doc, prose says **Pass**; `roundNumber`/`activeRound` are the unchanged technical field names.

What a **pass** is, how passes are numbered and created (including the automatic **Pass 1**), the
lifecycle — including **Bring back** for an archived pass — and **where you manage them**: passes live
*inside* a walk list, not on their own top-level page.

- **Part 1 — For everyone** is plain language: what a pass is, the rules, and the workflow.
- **Part 2 — Technical reference** is for developers (and Claude): the model, the `createNextPass`
  chokepoint, the routes, auto-Pass-1, and the client component that renders it in two places.

Related: [EFFORTS.md](EFFORTS.md) (the walk list a pass belongs to), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(cutting a pass's doors into **books** on the Turf Cutting page), [METRICS.md](METRICS.md) (a pass is
the billing unit), [SURVEYS.md](SURVEYS.md) (one survey per voter per pass).

---

# Part 1 — For everyone

## The pieces

```
Campaign
  └─ Walk list        a parallel operation (an area or a team) — owns a disjoint set of doors
       └─ Pass        one billable sweep through that walk list's doors (Pass 1, Pass 2, …)
            └─ Book    a walkable slice of the pass (a canvasser's turf)
                 └─ Doors → Voters
```

A **pass** is a single planned trip through **one walk list's doors** — Pass 1, then a follow-up
Pass 2, and so on. Pass numbers **restart per walk list** (North Pass 1, South Pass 1). Each pass is
cut into **books** on the Turf Cutting page and assigned to canvassers.

A pass is the **billing unit**: knocking a door in Pass 1 and again in Pass 2 counts as two billable
door-knocks (see [METRICS.md](METRICS.md)).

## Where you manage passes

Passes belong to a walk list, so you manage them **from the walk list** — there is no top-level
"Passes" nav item anymore. Two ways in, same controls:

- **Walk Lists page → open a walk list ("Manage") → the Passes panel.** The common path — create a
  pass, activate, archive, bring back, all inline.
- **"Open full view →"** in that panel (or the direct link `…/efforts/:effortId/passes`) for a
  roomier full-page view of the same thing.

Each pass row in that table shows its own numbers — **Books**, **Knocks**, **Survey doors**
(**Lit drops** on a lit-drop campaign), and **Conn %** — counted exactly the way the dashboard's
**By pass** breakdown counts them (one knock = one distinct house × pass, see
[METRICS.md](METRICS.md)). The panel is **all-time**; the dashboard table honors its date filter,
so the two match exactly on an "All time" range and can legitimately differ on any narrower one.

On a campaign that has **Not a target voter** turned on, a door marked that way is a knock in these
numbers like any other, but never a survey door — so **Conn %** reads exactly as it would have if the
canvasser had tapped Not home or Refused there — and it fills the pass's **Progress** bar as done work,
in its own fuchsia stretch. A campaign that never turns it on sees no change.

## Pass 1 is created for you

When you create a walk list, **Pass 1 is created automatically** so the usual flow — walk list →
cut books → activate — needs no separate "make a pass" step. To add a follow-up, click **New pass**:
it numbers itself (Pass 2, Pass 3, …). A name is optional — leave it blank and the pass is labeled
"Pass N"; type one (e.g. "GOTV") to override the label.

## The lifecycle

A pass goes **draft → active → archived**, and an archived pass can come back with **Bring back**
(below):

- **draft** — build it: cut its books on the Turf Cutting page, assign canvassers.
- **active** — live in the field. **Each walk list has at most one active pass**; activating a new
  pass archives the walk list's previous active one. (Different walk lists run their active passes
  independently — a campaign can have several active passes at once, one per walk list.)
- **archived** — ended. **Knock history is kept.** A pass ends one of three ways: its own **Archive**
  button, its walk list being archived ([EFFORTS.md](EFFORTS.md)), or the next pass on its walk list
  going live.

To **activate** a pass it needs at least one **published book** (cut on the Turf Cutting page), and —
on a survey campaign — a survey attached to the campaign. Activating a pass whose books have **no
canvasser assignments** is allowed but warns first (canvassers only see books assigned to them).
Activation still ends the walk list's current pass at once, without waiting and with no undo — the new
pass is live.

**Deleting** is only for a draft with no history; **archiving** is the safe close for anything live
or with recorded knocks.

## Archiving a pass, and bringing it back

**Archive** in the Passes panel asks before it ends a pass. For a live pass: *Canvassers lose its books
the next time their map refreshes. Knocks are kept. You can bring it back until a newer pass on this walk
list goes live.* For a draft that holds knocks: *No canvasser has its books. Its knocks are kept. You can
bring it back as a draft.* Once the pass has knocks you also type `archive` to confirm. Right after, an
**Undo** link brings it straight back.

An archived pass says how it ended — *Archived · Oct 27 by Ada · by hand*, *… when North was archived*,
*… when Pass 3 went live*, or *… by the one-time check* — and offers **Bring back** in the walk list's
Passes panel and on Turf Cutting:

- **Bring back works until a newer pass on that walk list has gone live.** A pass that ended because the
  next pass went live never comes back; its row says why instead of showing the button (for example
  *Pass 4 went live after this one ended*).
- **A pass that was live comes back live** — the same books, back on the same canvassers' phones the next
  time their map refreshes. **A pass that was a draft** when it was archived comes back as a draft.
- **A pass with no doors left in its books comes back as a draft**, since there would be nothing to walk
  (say every door was re-carved into another walk list). The box says so before you confirm.
- **The box asks before anything changes:** *Bring back Pass 3? It goes live again: its 14 books return
  to 6 canvassers' phones the next time their map refreshes.*
- **Other reasons it can't:** another pass on the walk list is live (archive that one first); a survey
  campaign with no survey attached; an archived campaign; or an archived walk list — there, **Unarchive**
  offers to bring back the pass archiving ended ([EFFORTS.md](EFFORTS.md)). If someone else is changing
  the walk list, or re-cutting the pass, at that moment, it asks you to try again in a minute and
  changes nothing.
- **Who holds the books.** Assignments come back as they were. Anyone removed from the campaign since has
  already lost theirs, so their book comes back unassigned; anyone deactivated keeps theirs, exactly as on
  a live pass, and Turf Cutting's warning about books nobody on the roster can open names them.
- **Outlines are redrawn** as it comes back, so a pin moved while the pass was archived sits inside its
  book's shape again.
- **Who can:** whoever can archive — org admins, and team leads on the campaigns they manage.

Archiving a pass and bringing one back each appear in the campaign's **History** (*Ada archived North ·
Pass 3 · GOTV*, *Ada brought back North · Pass 3 · GOTV*). Starting the next pass doesn't — it's routine.

Knocks a phone recorded on a pass's book before the next pass started still count in that pass when they
arrive after it ended, on phones with the app update ([PASSES_AND_TURF.md](PASSES_AND_TURF.md) → *Late knocks*). An archived
pass is **view-only** on Turf Cutting, and so is every pass of an archived walk list
([PASSES_AND_TURF.md](PASSES_AND_TURF.md)).

---

# Part 2 — Technical reference

## Model — `Pass` (`server/src/models/Pass.js`)

Key fields: `organizationId`, `campaignId`, `effortId`, `roundNumber`, `name`, `status`
(`draft|active|archived`), `createdBy`, `activatedAt`, `archivedAt`. `roundNumber` is unique **per
`effortId`** (compound unique index), so numbering restarts per walk list and concurrent creates
collide on the index rather than double-allocating.

Since 2026-10-28 ([PROPOSAL_WALK_LIST_ARCHIVE.md](PROPOSAL_WALK_LIST_ARCHIVE.md)), all declared
(`strictQuery` is on):

- `lastActivatedAt` — stamped on **every** activation and every bring-back to live. `activatedAt` stays
  first-activation-only (it survives a discard), so Bring back's "a later pass went live" rule needs its
  own stamp.
- `archivedFrom` (`'active' | 'draft' | null`) — what the pass was when it ended; Bring back restores it.
- `archivedVia` (`'pass' | 'walk-list' | 'next-pass' | 'repair' | null`) — how it ended: its own Archive
  button, its walk list's archive, the next pass going live, or the one-time repair.
- `archivedBy` — who ended it (null for the repair, and for passes archived before the field existed).
- `endedByPassId` — the pass whose activation ended this one (`archivedVia: 'next-pass'`).
- Index **`one_live_pass_per_walk_list`** — `{ status: 1, effortId: 1 }`, unique, partial `{ status:
  'active', effortId: { $type: 'objectId' } }`: at most one live pass per walk list, enforced
  ([EFFORTS.md](EFFORTS.md) §I for why that key, and the build step).

Every one of the new fields is null on a pass archived before them; the rules below infer what they need
(`archivedFrom` from `activatedAt`; "ended by Pass N" from a sibling whose `activatedAt` equals this pass's
`archivedAt`, because activation stamps both from one `now`).

## The creation chokepoint — `createNextPass`

`server/src/services/passes/createPass.js` is the **single place** a pass is minted. It reads the
walk list's highest `roundNumber`, adds one, and creates the pass; on an E11000 (a concurrent create
racing the unique `(effortId, roundNumber)` index) it retries (up to 5×). A blank/whitespace `name`
auto-labels `Pass {roundNumber}`. Returns the `Pass`, or `null` if it couldn't allocate a number.

Two callers:

- **`POST /admin/campaigns/:campaignId/passes`** (`routes/admin/passes.js`) — the explicit "New pass".
  `name` is **optional**; `effortId` is required. 409 if a number couldn't be allocated.
- **`POST /admin/campaigns/:campaignId/efforts`** (`routes/admin/efforts.js`) — after the walk list is
  created and its doors claimed, it calls `createNextPass` **best-effort** (a failure here is
  swallowed — it must not fail walk-list creation; the admin can add Pass 1 manually). The created
  pass is returned as `pass` in the response (`{ effort, claimed, pass }`) so the UI can link
  straight to cutting its books.

## Other pass routes (`routes/admin/passes.js`)

- `GET /` (the list) — every pass of the campaign (optionally `?effortId=`) with `turfCount` plus
  **per-round counts from the shared billing pipeline** (`knocksPipeline({ campaignId }, { byPass:
  true })`, [aggregations.js](../server/src/services/reports/aggregations.js)): `knockCount`,
  `surveyedKnocks`, `litKnocks`, `refusedKnocks`, `notTargetKnocks`, `connectionRate`, `contactRate`.
  Same aggregation every report uses, run **all-time** (no date window) — it equals the
  `/admin/reports/knocks-by-pass` report exactly when that report's range is all-time; a windowed
  report legitimately shows less ([METRICS.md](METRICS.md) §E). Also returns `activePassIds`.
  **`notTargetKnocks`** (2026-10-02, additive) counts the round's (door, pass) knocks holding a
  `not_target` row — an independent flag like `refusedKnocks`, and 0 on any campaign that never
  turned the outcome on. **`contactRate`** is `contactKnocks ÷ knockCount`, the pipeline's
  `hasContact` fold (a survey, a refusal or `not_target`), so each door counts **once per round**
  however many canvassers recorded a contact there; summing the per-outcome flags instead had read one
  door twice (a 200% rate on a one-door round). `contactRate()` throws without `contactKnocks`. The
  Passes table shows neither field.
  Since 2026-10-28 each pass also carries `archivedFrom`, `archivedVia`, `archivedByName` (through
  `hydrateCanvassers`) and `endedByPassName` (the pass that ended it by going live, stamped or inferred,
  as "Pass 4 · GOTV", or null), and each **archived** pass its `bringBack` verdict (below) plus
  `bringBackMessage` — the refusal sentence — when `!bringBack.ok`. All of it is worked out from this one
  load (the listed passes are the siblings), never a query per pass.
- `POST /` (create), `PATCH /:id` (rename a draft), `DELETE /:id` (a draft with no history) — 409
  `walk-list-archived` on an archived walk list, whose drafts are frozen. The delete runs under the walk
  list's lifecycle lock.
- `POST /:id/activate` → `{ pass }` — `activatePass` in
  [passLifecycle.js](../server/src/services/passes/passLifecycle.js), under the walk list's lifecycle
  lock. Requires ≥1 published `Turf` (400 `no-books`) and, on survey campaigns,
  `campaign.surveyTemplateId` (400 `survey-required`). Refuses an archived pass with 409 `pass-archived`
  (*Pass 3 is archived — use Bring back.*), an archived walk list (409 `walk-list-archived`), and a
  duplicate-key error on the one-live-pass index (409 `another-pass-live`); a busy lock is 409
  `lifecycle-busy`. Archives other **active** passes **of the same effort** only — each through a
  conditional update stamping `archivedFrom: 'active'`, `archivedVia: 'next-pass'`, `archivedBy` and
  `endedByPassId` — then sets `active` + `lastActivatedAt` (+ `activatedAt` once). It does **not** take
  the ending pass's recut lock (starting the next pass never waits, even while a claim or supplemental job
  runs on the old one) and writes **no** History row.
- `POST /:id/archive` `{ confirmArchive }` → `{ pass }` — `archivePass`, under the lifecycle lock and the
  pass's recut lock. Without `confirmArchive`, 409 `archive-confirm-required` (with
  `isActive`/`knockCount`) when the pass is active or has knocks; the client gates a typed `archive`
  confirmation on `knockCount > 0`. Also 409 `already-archived` (it used to overwrite `archivedAt`),
  `walk-list-archived`, `lifecycle-busy` and `recut-locked`. Writes `archivedFrom`, `archivedVia: 'pass'`,
  `archivedBy` and a History row.
- `POST /:id/bring-back` → `{ pass, to, downgraded }` — `bringBackPass`. 409 with `code` = the reason and
  `error` = the sentence, `laterPass` when one is named, `temporary: true` for `recut-locked` and
  `lifecycle-busy`. The rules are below.
- The router mounts `requireActiveCampaign()`, so every write above answers 409 `campaign-archived` on an
  archived campaign; reads stay open.
- `GET /:id/progress` — per-pass door status counts for the progress bar: `{ passId, total, counts }`
  over the doors of every book in the pass, each door's status **for this round**
  (`getPassStatusMap` → `statusCountsFromMap`), so `counts` is the nine-key `emptyStatusCounts()`
  shape ([passStatus.js](../server/src/services/passes/passStatus.js)), `not_target` included.

## Bring back — the rules (`bringBackVerdict`)

One pure function in [passLifecycle.js](../server/src/services/passes/passLifecycle.js) decides, so `GET
/passes` can answer for every archived pass from one load and the action re-checks the same rules under
its locks. It returns `{ ok, to, reason, laterPass, books, canvassers, downgraded, temporary? }`; first
refusal wins:

| # | Rule | Refusal `reason` |
|---|---|---|
| 1 | The pass is archived, with an `archivedAt` | `not-archived` / `unknown-end` |
| 2 | The campaign is writable | `campaign-archived` / `campaign-deleting` |
| 3 | Its walk list exists, and if archived, only through Unarchive (`viaUnarchive`) | `walk-list-missing` / `walk-list-archived` |
| 4a | It didn't end because the next pass went live (`archivedVia !== 'next-pass'`) — permanent, even if that pass is later deleted | `ended-by-next-pass` (`laterPass` names it, if it still exists) |
| 5 | `to = archivedFrom ?? (activatedAt ? 'active' : 'draft')` | — |
| 4b | If `to === 'active'`: no other pass of the walk list was last live at or after this pass's `archivedAt` | `later-pass-went-live` (`laterPass` names it) |
| 6 | If `to === 'active'`: no other pass of the walk list is live | `another-pass-live` |
| 7 | If `to === 'active'` on a survey campaign: the campaign has a survey | `survey-required` |
| 8 | If `to === 'active'` and no published book has doors: `to = 'draft'`, `downgraded: 'no-doors'` | — |
| 9 | The pass's recut lock is free | `recut-locked` (`temporary: true`) |

- **"Last live at"** for a sibling is its `lastActivatedAt` when set; for a pass from before that field,
  now if it is live, else its `archivedAt` (or `activatedAt` when never archived); nothing for a pass that
  never went live. **`>=`, not `>`:** activation stamps the ended pass's `archivedAt` and the new pass's
  activation from the same `now`. The pre-field fallback keeps a pass discarded and re-activated before
  the change blocking the pass it ended, at the cost of over-refusing a few old draft cases.
- **4b applies only when coming back live.** A draft coming back as a draft conflicts with nothing — and
  without that limit, undoing a walk-list archive would wrongly revoke an archived draft's Bring back.
- **The action** (`bringBackPass`): takes the pass's recut lock, re-checks every rule on a fresh read, then
  makes one conditional update `{ _id, status: 'archived' }` → `to` that clears `archivedAt`,
  `archivedFrom`, `archivedVia`, `archivedBy` and `endedByPassId`, and sets `lastActivatedAt` when `to ===
  'active'` (`activatedAt` is never touched). A duplicate-key error on the one-live-pass index becomes 409
  `another-pass-live`; a pass that changed underneath is 409 `pass-changed`. Then it **redraws the book
  outlines, best-effort** — `recomputePassTerritories(passId, { withCentroid: true })` in a try/catch,
  always, because pin re-hulls skip archived passes and import pin placement logs nothing to detect a
  move by — but only while the pass's booked doors are at most `TURF_BRING_BACK_REHULL_MAX_DOORS`
  (default 20,000; about 2 s at 16,000 doors on a laptop). Above that it logs, and `npm run
  recompute:territories -- --apply` heals it ([OPERATIONS.md](OPERATIONS.md)). One History row, unless it
  ran inside an unarchive.
- **What comes back:** assignments as they were. `releaseAssignedWork` already deleted those of anyone
  removed from the campaign, on passes of any status; a deactivated person keeps theirs, exactly as on a
  live pass.
- **`couldComeBack(pass)`** is the same rule set minus everything transient (the campaign's archive, the
  walk list's archive, locks): rule 1, the walk list exists, and rules 4a/4b. The Door Outcomes undo guard
  uses it ([CAMPAIGNS.md](CAMPAIGNS.md) Part 2, `roundClearedSince`).

## Client — one component, two mounts

`client/src/components/PassManager.jsx` holds **all** pass UI (stat cards, New-pass control, table,
per-pass detail, activate/archive/delete). It takes `{ campaignId, effortId, tz, variant,
campaignType }` — the walk list is fixed by the caller, so there is **no walk-list picker**. The
table's per-pass columns include **Knocks, Survey doors** (labeled **Lit drops** when
`campaignType === 'lit_drop'` — same column, different unit) and **Conn %** from the enriched list
route above; `campaignType` is threaded from both mounts (PassesPage via `useCampaignSelection`,
EffortsPage via `EffortRow`) so the compact drawer variant labels the column correctly too:

- `variant="full"` — stat cards + a "New pass" card + the full table. Rendered by the scoped page
  `PassesPage.jsx` at **`/campaigns/:campaignId/efforts/:effortId/passes`** (a thin wrapper that
  resolves the effort name + timezone).
- `variant="compact"` — a one-line New-pass control + the table, mounted inline in the Walk Lists
  drawer (`EffortsPage.jsx`).

The table's **Progress** column (both variants) is `ProgressBar` over `/:id/progress`: one segment per
non-zero status, colored from `SEG_COLORS` (`not_target` is fuchsia `#a21caf`, drawn right after
`refused`), beside a done % of `(total − unknocked) ÷ total` — so a `not_target` door counts as done,
and a campaign with no such doors draws exactly what it did before.

Mutations invalidate `['admin','passes',campaignId]`, `['admin','efforts',campaignId]` (so the walk
list's **Pass** column and status refresh), `['admin','setup-status',campaignId]`, and
`['campaign-rollup']` — and, for the lifecycle actions, `['turfs', campaignId]` too
(`invalidateLifecycle`).

**Archived passes and archived walk lists** (2026-10-28). An archived row reads *Archived · <date> [by
<name>]* plus how it ended — *by hand*, *when <walk list> was archived*, *when Pass N went live*, *by the
one-time check* — then **Bring back** when `bringBack.ok`, else `bringBackMessage`. Archive, Bring back
and Unarchive use the shared dialogs in `client/src/components/walkListLifecycle/` (`ArchivePassDialog`,
`BringBackPassDialog`, `UnarchiveWalkListDialog`), built on the shared `Modal` and `Button
variant="danger"` — the hand-rolled overlay with a hard-coded red button is gone, and so is "Passes are
one-way" in the intro. A temporary refusal (`lifecycle-busy`, `recut-locked`) says to try again in a
minute and changes nothing; a permanent one says why. `PassDetail` on an archived pass links **View books
→**. On an archived walk list the panel is read-only (no New pass, Activate, Archive, Delete or Bring back)
under a banner with **Unarchive <walk list>**.

**Routing / back-compat.** The top-level Passes nav item is gone (`navItems.js`). The old
`/campaigns/:campaignId/passes?effortId=X` route now renders `LegacyPassesRedirect` (`App.jsx`),
which forwards to `…/efforts/X/passes` (or to `…/efforts` with no `effortId`). Setup-step routes for
the pass steps (`setupSteps.js`, `effortSetupSteps.js`) point at `/efforts` — you manage passes from
the walk list.
