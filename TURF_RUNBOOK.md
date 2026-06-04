# Turf Cutting / Walk Lists / Passes / Job Queue — Ops Runbook

> **Updated — "passes" are now "Rounds" inside Efforts.** A campaign is split into **efforts**
> (areas/teams), and a pass is one **Round** within an effort. The turf-cutting / accept / discard /
> assign steps below still apply **per round**; what changed is that a campaign can have several active
> rounds at once (one per effort), a round's door-set comes from its effort's owned doors (not a walk
> list), and attribution is door→book→effort. See [docs/EFFORTS.md](docs/EFFORTS.md) (concepts +
> deploy/migrate runbook) and [docs/IMPORTS.md](docs/IMPORTS.md) (Intake). Read "pass" below as "round."

Everything needed to deploy and operate the turf-cutting feature. Built on a feature branch for an isolated Heroku app (no impact on the current production app). Mobile is **not** part of this change.

## What shipped
- **Async job queue** (BullMQ + Redis) on a dedicated **worker** dyno.
- **CSV import** moved onto the queue, now **vendor-agnostic** (column mapping + saved import profiles, GridFS file handoff, batched/idempotent writes). Voter identity is **org-scoped** (`{organizationId, stateVoterId}`).
- **Collision behavior**: `surveyed`/`lit_dropped` sticky precedence, pass-scoped dedup, offline-safe pass attribution, same-day collision + per-day door-dedup reporting (campaign timezone).
- **Turf generation**: attribute / geometric / manual cut → concave-hull boundary + walk order, as an async job.
- **Walk lists** (frozen segment builder), **passes** (one-way rounds), **multi-canvasser assignment**, per-pass status, turf **edit ops**.
- **Admin UI**: Turf Cutting, Passes, Walk Lists, Assign modal, Jobs (Bull Board).

## New dependencies (already in package.json)
- server: `bullmq`, `ioredis`, `@bull-board/express`, `@bull-board/api`, `@turf/turf`, `h3-js`
- client: (none new yet — `@mapbox/mapbox-gl-draw` only if/when in-map manual draw is added)

## Environment
`server/.env` (and Heroku config):
```
REDIS_URL=...                 # rediss:// on Heroku Key-Value Store (auto-injected)
IMPORT_JOB_CONCURRENCY=2
TURF_JOB_CONCURRENCY=1
MAPBOX_PUBLIC_TOKEN=pk....    # used by the admin map
```

## Heroku setup (new app)
```bash
heroku addons:create heroku-redis:mini        # or heroku-keyvalue; injects REDIS_URL
heroku redis:maxmemory --policy noeviction     # REQUIRED by BullMQ
git push heroku feat/turf-cutting:main         # deploy the branch
heroku ps:scale web=1 worker=1                 # the worker consumes the queues
```
`Procfile` already defines `web` + `worker: npm --prefix server run worker`.

## Migrations (run once, in order, after the first deploy)
Each supports a dry run (no flag) then `--apply`. Locally `npm --prefix server run <name>`; on Heroku `heroku run "npm --prefix server run <name> -- --apply"`.
1. `migrate:voter-scope --apply` — drop the global-unique `stateVoterId` index, build `{organizationId, stateVoterId}`.
2. `migrate:passes --apply` — give every campaign a frozen "All voters (initial)" walk list + an active **Pass 1** + `activePassId` + `timeZone`.
3. `migrate:cut-attributes --apply` — denormalize precinct/districts/city/zip/county onto households (modal voter value + conflict flags).
4. **After** generating + accepting Pass-1 books for a campaign: `migrate:activity-turf-tags --apply` — backfill `passId`/`turfId` onto pre-existing canvass history so prior knocks show as Pass-1 progress.

> **Hotfix — only for envs first deployed before this fix:** `migrate:turf-indexes --apply` drops the stale `boundary_2dsphere`/`centroid_2dsphere` indexes the old Turf schema created. Those fields are display-only and never geo-queried; the S2 index rejected valid self-touching concave-hull rings (`Can't extract geo keys … Loop is not valid`) and failed turf generation at the save step. The schema no longer declares them, so **fresh deploys never build them and don't need this** — it's purely to clean an already-built index. Run it once after deploying the fix, **before** re-generating turf.

`reconcile:counts --apply` stays available and is now pass-aware (sticky precedence + pass-scoped dedup).

## Local dev
```bash
redis-server                                   # terminal 1 (brew install redis)
npm --prefix server run migrate:passes -- --apply   # one-time on your dev DB
npm --prefix server run worker                 # terminal 2
npm run dev                                     # terminal 3 (server :4000 + client :5173)
```

## Using it (admin)
1. **CSV Import** — upload → map the vendor's columns (save a profile per vendor: i360, L2, …) → import runs in the background with a progress bar.
2. **Walk Lists** — build a targeted segment (demographics + prior-round status/answers), preview the count, save it (frozen).
3. **Passes** — create a round from a walk list (or all voters).
4. **Turf Cutting** — pick the campaign + pass; the map shows every eligible house (gray before a cut). Choose geometric (max doors, default 65 — compact, balanced books via capacity-balanced k-means) or attribute (group-by + optional cap-N), Generate → books render colored on the map → click a book in the list to isolate it on the map → **Accept**.
5. **Assign** canvassers to each book (multiple per book allowed).
6. **Passes → Activate** the round (one-way; requires accepted books). Per-pass progress shows on the Passes page.
7. **Jobs** (super-admin) — Bull Board for import/turf job observability.

## Re-cutting a pass (discard / undo / clear knocks)
The model: **books are how you slice the work; knocks are what happened.** Re-cutting only re-slices — it never deletes fieldwork unless you explicitly ask.

- **Before Accept** (books still `draft`): just **Generate** again — it cleanly wipes the prior drafts (+ their assignments + the household mirror) and rebuilds.
- **After Accept** (books `published`): **Generate is blocked** (409 `has-published-books`). Use **Discard** first — the deliberate path to re-cut accepted books (prevents duplicate/overlapping published books).
- **Discard** snapshots the book layout + assignments first (for undo), clears the household `turfId`/`walkOrder` mirror, deletes assignments, and removes the draft+published books. Archived (merge-stub) books are left alone.
- On a **LIVE (active) pass**, Discard requires an explicit confirm (`confirmActive`) and **reverts the pass to `draft`** + clears `activePassId` when it empties (so a campaign is never "active with zero books"). Flow: re-cut → re-Accept → re-Activate on the Passes page.
- **Clear knocks (opt-in checkbox):** Discard keeps knock history by default. Ticking the box also wipes this pass's `CanvassActivity` + `SurveyResponse` (door statuses recomputed). Those are snapshotted, so Undo restores them verbatim.
- **Undo / Snapshots:** the last ~10 snapshots per pass are listed under the books panel. **Restore** recreates the books, assignments, and (if captured) the cleared knocks. It's blocked while the pass still has live books (discard them first) and does **not** auto-re-activate the pass.
- Concurrent discard/restore on one pass is serialized by a per-pass advisory lock (`Pass.recutLock`, auto-reclaimed after 5 min). `activatedAt` is preserved across a revert, so a re-cut pass keeps its attribution window — knock history attributes to the pass via `activatedAt`, never a book id, which is why re-cutting is always safe for fieldwork.

## Notes / gotchas
- `noeviction` and `worker=1` are mandatory, or jobs sit/evict.
- County comes from a CSV column (case-insensitive header); re-run `migrate:cut-attributes` after a county-bearing re-import.
- Walk lists are frozen snapshots — re-imports don't change saved lists; bring new doors in via the books editor or a new list/pass.
- Bull Board is super-admin only and same-origin in production.

## Not yet built (follow-ups)
- **In-map edit ops** (split/merge/drag-door) + **manual polygon draw** — the backend endpoints exist (`/turfs/move-door`, `/merge`, `/:id/split`); only the in-map UI/`mapbox-gl-draw` remains.
- **Mobile (M5)** — bootstrap scoping to assigned books, current-pass coloring, sync triggers. JS-only; deferred.
- **Shared voter database** — the next planned major effort (global dedup, super-admin cross-org views).
