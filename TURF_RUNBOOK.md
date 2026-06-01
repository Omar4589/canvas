# Turf Cutting / Walk Lists / Passes / Job Queue — Ops Runbook

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
4. **Turf Cutting** — pick the campaign + pass, choose geometric (max doors, default 65) or attribute (group-by + optional cap-N), Generate → preview books on the map → **Accept**.
5. **Assign** canvassers to each book (multiple per book allowed).
6. **Passes → Activate** the round (one-way; requires accepted books). Per-pass progress shows on the Passes page.
7. **Jobs** (super-admin) — Bull Board for import/turf job observability.

## Notes / gotchas
- `noeviction` and `worker=1` are mandatory, or jobs sit/evict.
- County comes from a CSV column (case-insensitive header); re-run `migrate:cut-attributes` after a county-bearing re-import.
- Walk lists are frozen snapshots — re-imports don't change saved lists; bring new doors in via the books editor or a new list/pass.
- Bull Board is super-admin only and same-origin in production.

## Not yet built (follow-ups)
- **In-map edit ops** (split/merge/drag-door) + **manual polygon draw** — the backend endpoints exist (`/turfs/move-door`, `/merge`, `/:id/split`); only the in-map UI/`mapbox-gl-draw` remains.
- **Mobile (M5)** — bootstrap scoping to assigned books, current-pass coloring, sync triggers. JS-only; deferred.
- **Shared voter database** — the next planned major effort (global dedup, super-admin cross-org views).
