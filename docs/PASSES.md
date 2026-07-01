# Passes (a walk list's billable sweeps)

> The user-facing term is **Pass** (Pass 1, Pass 2, …). In the code the `Pass` model stores the
> per-walk-list counter as **`roundNumber`** — earlier docs called a pass a "Round". Throughout this
> doc, prose says **Pass**; `roundNumber`/`activeRound` are the unchanged technical field names.

What a **pass** is, how passes are numbered and created (including the automatic **Pass 1**), the
one-way lifecycle, and **where you manage them** — passes now live *inside* a walk list, not on their
own top-level page.

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
  pass, activate, archive, all inline.
- **"Open full view →"** in that panel (or the direct link `…/efforts/:effortId/passes`) for a
  roomier full-page view of the same thing.

## Pass 1 is created for you

When you create a walk list, **Pass 1 is created automatically** so the usual flow — walk list →
cut books → activate — needs no separate "make a pass" step. To add a follow-up, click **New pass**:
it numbers itself (Pass 2, Pass 3, …). A name is optional — leave it blank and the pass is labeled
"Pass N"; type one (e.g. "GOTV") to override the label.

## The lifecycle (one-way)

A pass's status only moves in one direction:

**draft → active → archived.**

- **draft** — build it: cut its books on the Turf Cutting page, assign canvassers.
- **active** — live in the field. **Each walk list has at most one active pass**; activating a new
  pass archives the walk list's previous active one. (Different walk lists run their active passes
  independently — a campaign can have several active passes at once, one per walk list.)
- **archived** — done. **Archiving is one-way** — a pass is never reopened; you add a new pass to
  keep going. **Knock history is kept.**

To **activate** a pass it needs at least one **published book** (cut on the Turf Cutting page), and —
on a survey campaign — a survey attached to the campaign. Activating a pass whose books have **no
canvasser assignments** is allowed but warns first (canvassers only see books assigned to them).

**Deleting** is only for a draft with no history; **archiving** is the safe close for anything live
or with recorded knocks (it asks you to type `archive` to confirm).

---

# Part 2 — Technical reference

## Model — `Pass` (`server/src/models/Pass.js`)

Key fields: `organizationId`, `campaignId`, `effortId`, `roundNumber`, `name`, `status`
(`draft|active|archived`), `createdBy`, `activatedAt`, `archivedAt`. `roundNumber` is unique **per
`effortId`** (compound unique index), so numbering restarts per walk list and concurrent creates
collide on the index rather than double-allocating.

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

- `POST /:id/activate` — requires ≥1 published `Turf` for the pass; on survey campaigns requires
  `campaign.surveyTemplateId`. Archives other **active** passes **of the same effort** only, then
  sets `active` (+ `activatedAt` once).
- `POST /:id/archive` — one-way. Without `confirmArchive`, returns 409 `archive-confirm-required`
  (with `isActive`/`knockCount`) when the pass is active or has knocks; the client gates a typed
  `archive` confirmation on that.
- `DELETE /:id` — draft only.
- `GET /:id/progress` — per-pass door status counts for the progress bar.

## Client — one component, two mounts

`client/src/components/PassManager.jsx` holds **all** pass UI (stat cards, New-pass control, table,
per-pass detail, activate/archive/delete). It takes `{ campaignId, effortId, tz, variant }` — the
walk list is fixed by the caller, so there is **no walk-list picker**:

- `variant="full"` — stat cards + a "New pass" card + the full table. Rendered by the scoped page
  `PassesPage.jsx` at **`/campaigns/:campaignId/efforts/:effortId/passes`** (a thin wrapper that
  resolves the effort name + timezone).
- `variant="compact"` — a one-line New-pass control + the table, mounted inline in the Walk Lists
  drawer (`EffortsPage.jsx`).

Mutations invalidate `['admin','passes',campaignId]`, `['admin','efforts',campaignId]` (so the walk
list's "Active pass" column refreshes), `['admin','setup-status',campaignId]`, and
`['campaign-rollup']`.

**Routing / back-compat.** The top-level Passes nav item is gone (`navItems.js`). The old
`/campaigns/:campaignId/passes?effortId=X` route now renders `LegacyPassesRedirect` (`App.jsx`),
which forwards to `…/efforts/X/passes` (or to `…/efforts` with no `effortId`). Setup-step routes for
the pass steps (`setupSteps.js`, `effortSetupSteps.js`) point at `/efforts` — you manage passes from
the walk list.
