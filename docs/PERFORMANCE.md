# Performance & resource hygiene (polling, GPS, queues, cleanups)

How the apps avoid wasting battery, data, and memory — what runs when a screen is visible, what
stops when it isn't, and the guardrails that keep background work honest. Written after a full
239-file leak audit (July 2026) whose fixes this documents.

- **Part 1 — For everyone** is plain language: what the apps do and don't do in the background.
- **Part 2 — Technical reference** is for developers (and Claude): the patterns, the fixed bugs,
  and the rules for new code.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (the map screen and offline recording),
[ADMIN_APP.md](ADMIN_APP.md) (admin screens and live map), [MAPS.md](MAPS.md) (map architecture),
[TIMEZONES.md](TIMEZONES.md) (date handling in polled reports).

---

# Part 1 — For everyone

## What runs in the background — and what doesn't

The apps poll the server so screens stay fresh: the canvasser map picks up other canvassers' knocks
every 30 seconds, the admin live map refreshes every 20 seconds, dashboards every 30. Three rules
keep that from draining phones:

1. **Backgrounded app → everything stops.** When the phone locks or the app leaves the foreground,
   all polling pauses (and resumes on return).
2. **Covered screen → its polling stops.** Navigating away from a screen (another tab, a pushed
   detail screen) pauses that screen's polling and its GPS dot. Coming back refreshes it
   immediately and resumes. Before July 2026 this rule didn't exist — a visited admin map kept
   polling all day behind other tabs. (The GPS-dot half of this rule only became genuinely true
   on Android in August 2026: the old dot's `visible` gate never actually stopped the library's
   location engine there — a start/stop counter leak kept it hot — and the native-puck migration
   replaced the gate with real unmounting.)
3. **Search boxes wait for you to stop typing.** Voter/household searches fire one request ~300ms
   after the last keystroke, not one per key, and abandoned searches are cancelled.

## Offline knocks can't double-count

Recording a knock with no signal queues it on the device; the queue flushes when connectivity
returns. The flush is single-flight: no matter how many things trigger it at once (app opened,
network restored, pull-to-refresh), only one flush runs, so a queued knock posts **exactly once** —
it can't be double-billed, and a knock recorded *during* a flush can't be lost.

## Small UX guarantees from the same pass

- Feedback toasts ("Saved.", "Copied!") always show for their full duration — a rapid second action
  no longer cuts the newer message short.
- Switching basemap styles rapidly on the web maps no longer risks a blank/broken layer.
- Admin drill-down lists (answer voters, activity feed) reset correctly when you open them for a
  different option/filter — no stale rows from the previous view.
- CSV export from the mobile admin screens works again (it broke silently with the Expo SDK 54
  file-system API change) and cleans up old export files as it goes.

---

# Part 2 — Technical reference

## The three focus/lifecycle layers (mobile)

| Layer | Mechanism | Where |
|---|---|---|
| App backgrounded | `focusManager.setFocused` wired to AppState | `mobile/app/_layout.jsx` |
| Screen covered | `...useFocusedPoll()` on polled queries | each polling screen |
| GPS dot | `{isFocused && <AppLocationPuck />}` — mount-gated: the native puck's `visible` prop hides pixels but does NOT stop the engine's location component; only unmount does | admin map, book map |

**Why screens need their own gating:** expo-router keeps screens mounted — Tabs screens forever
once visited (including `href:null` hidden ones), and stack base screens under everything pushed on
top. A `refetchInterval` on a mounted-but-covered screen keeps firing.

**`useFocusedPoll()`** (`mobile/lib/useFocusedPoll.js`) bundles the three options every polled query
needs, so the invariant lives in one place instead of being hand-repeated (and forgotten):

- `subscribed: useIsFocused()` — false when unfocused destroys the query observer (react-query
  ≥5.61; we resolve 5.100.6), stopping the interval; refocus re-subscribes and refetches if stale.
- `staleTime: 30s` — a refocus *within* the poll window shows cached data instead of firing a
  redundant request (without it, react-query's default `staleTime: 0` refetches on every refocus —
  a request storm when you tab-hop or pop back after each knock).
- `gcTime: 30min` — holds the cache past the default 5min so a screen left covered for a few
  minutes doesn't blank to a cold loader (showing 0 knocks) on return.

Spread it alongside the query's own `refetchInterval`:
`useQuery({ queryKey, queryFn, refetchInterval: 30_000, ...useFocusedPoll() })`. `q.refetch()`
(pull-to-refresh via `lib/useRefresh.js`) is not blocked by `subscribed`.

Gated queries: admin map `mapQ` (20s), admin Overview rollup (30s), admin timeline (20s when the
range includes today, pausable via its `LiveStatus` pill), super-admin overview + both activity
feeds (30s), canvasser map `todayQ` (120s) + `changesQ` (30s — `sinceRef` persists across the pause,
so the first refetch catches up on missed deltas).

**Rule for new code:** any `refetchInterval` on a mobile screen needs `...useFocusedPoll()` unless
the screen provably unmounts when left. Queries without intervals usually don't need it.

## Offline queue robustness (`mobile/lib/offlineQueue.js`)

The canvasser map triggers flushes from mount, AppState `active`, and NetInfo (which emits
immediately on subscribe), and `recordAction` fires one after each queued knock — so the queue must
tolerate concurrent and overlapping calls without double-POSTing (duplicate billable knock) or
dropping items. Three mechanisms:

- **Single-flight with rerun** — `flushQueue()` shares one in-flight promise; a call that arrives
  while a flush runs sets `flushAgain` so the loop runs one more `doFlush()` pass after the current
  one. That closes two gaps: an item enqueued after `doFlush`'s final empty read still gets sent,
  and a flush that began on a dead connection and bailed is retried when NetInfo/AppState fires
  during it (instead of the knocks sitting stuck until some later unrelated trigger).
- **Mutation lock** — `enqueue()` and the flush's `removeItem()` are both read-modify-write on the
  same AsyncStorage key; they run one-at-a-time through `withQueueLock` so an enqueue interleaving a
  remove can't resurrect a just-sent item or drop the new one. `removeItem` deletes **by id** against
  a fresh read (never `slice()` on a stale snapshot).
- **Flush semantics** — 4xx → drop the item and continue; network error (no `err.status`) / 5xx →
  stop, retry on the next trigger.

## AbortSignal threading (`api()` wrappers)

Both wrappers accept `signal`. Web (`client/src/api/client.js`): passed straight to fetch. Mobile
(`mobile/lib/api.js`): the external signal aborts the same internal controller that implements the
20s timeout; a `timedOut` flag distinguishes the two so only real timeouts become the
`code: 'TIMEOUT'` error (`submitOrQueue` queues on `!err.status` — external aborts rethrow as
AbortError and are treated by react-query as cancellations, never queued or alerted). The timeout
timer is cleared as soon as the response **headers** arrive (before reading the body): a body that
finishes streaming just after the 20s deadline would otherwise be aborted and turn a response the
server already persisted into a "timeout" that `submitOrQueue` re-POSTs — a double-recorded knock.

Wire-up pattern in a queryFn: `queryFn: ({ signal }) => api(path, { signal })`. Used by the three
search-as-you-type queries (web voters, mobile voters, canvasser households), all of which also
debounce input via `useDebouncedValue` (`client/src/lib/` and `mobile/lib/`, 300ms default).

## Map lifecycle rules

- **Web style swaps** (`MapPage`, `TurfsPage`, `ClientReportMap`): the style-swap effect registers a
  *named* `style.load` handler and removes it in cleanup — rapid style changes previously stacked
  `once()` handlers that both fired on the final style. `registerLayers` / `registerBookLayers`
  early-return if their first source already exists (duplicate `addSource` throws in mapbox-gl).
  Layer *event handlers* are still bound once at map init and survive swaps ([MAPS.md](MAPS.md)).
- **Native map remounts**: don't gate `<Mapbox.MapView>` behind `q.isLoading` for queries whose key
  changes with filters — use `placeholderData: keepPreviousData` so the map stays mounted (camera
  preserved, no tile refetch). Done on the canvasser path map.
- **`keepPreviousData: true` is a dead option in react-query v5** — it's silently ignored. The v5
  form is `placeholderData: keepPreviousData` (import from `@tanstack/react-query`).

## Payload scaling (bootstrap + admin map)

Investigated July 2026 with the 16,503-household FL campaign as the stress case.

**The field bootstrap is book-scoped — the old "~5MB payload" brief note is history.**
`/mobile/bootstrap` filters households through `canvasserScopeWithPasses()`
([services/canvass/canvasserScope.js](../server/src/services/canvass/canvasserScope.js)): the union
of the user's **assigned books on active rounds**, admins included; unassigned ⇒ zero doors. A
typical canvasser (a few books × ~100 doors) downloads tens of KB regardless of universe size.
Voters ship only for survey campaigns, scoped to those doors
([routes/mobile/bootstrap.js:222-238](../server/src/routes/mobile/bootstrap.js#L222-L238)). The old
~5MB figure was the pre-turf whole-universe payload (5,840 doors + 8,668 voters ≈ ~350 bytes/row).

**The whole-universe surfaces are the admin map and full self-assignment:**

- `/admin/households/map` ([routes/admin/households.js:97](../server/src/routes/admin/households.js#L97))
  returns every matching door, their voters (4-field projection), each door's survey META (id /
  when / who / note — **`answers[]` no longer ships or is even fetched**; the detail panel
  lazy-loads it per door via `GET /admin/households/:id/surveys`), and a last-activity row per
  door. It is **viewport-bounded**: both clients send `bbox=west,south,east,north` after the first
  auto-fit and on settled pan/zoom (debounced), which the server turns into a `$geoWithin`
  on the household `2dsphere` index — so the 20s live poll re-pulls only the visible area, not the
  universe. To keep panning smooth the **web** client sends a **padded buffer** box (~4× the
  viewport, `BBOX_PAD`, `inflateBbox` in [MapPage.jsx](../client/src/pages/MapPage.jsx)) and **skips
  the refetch entirely while the viewport stays inside the last padded box** — so small pans cost no
  network, only a pan/zoom beyond the buffer refetches (the mobile admin map already pads its box
  ~10%/side + epsilon-gates). A missing/degenerate/near-world bbox falls back to the unbounded pull, still **capped
  at 50,000 households** (`MAP_HOUSEHOLD_CAP`) with `truncated`+`total`+`cap`, backed by the
  `{campaignId,isActive}` index. Its sibling `GET /admin/households/map/counts` (the header's
  campaign-wide "N match · of M" + the status-chip counts) is **bbox-independent by design** — the
  clients key it on filters-minus-bbox so a pan never refetches it — and cheap: in the global-status
  mode two index-backed `$group`s (one over the universe, one by `status` over the matching set); in
  the per-canvasser / per-pass modes one slim `_id excludedFromTurf doNotKnock` find over the
  (already bbox-free) scope ids + the same activity aggregate `/map` runs. It polls at 20s with Live
  like `/map`. The **date window is the other guard**: with from/to
  set, doors narrow to interaction-touched ones
  ([:211-230](../server/src/routes/admin/households.js#L211-L230)), and both the web and mobile
  admin maps default to **Today**. The heavy pull only happens when a user clears/widens the dates:
  on FL that's ~6MB of households + ~4MB of voters + surveys/last-activity on top — **~12MB+ of
  uncompressed JSON**, refetched every **20s** while the web map's Live toggle is on
  ([MapPage.jsx:218](../client/src/pages/MapPage.jsx#L218); the mobile admin map is focus-gated,
  `staleTime` 60s, no interval).
- Bulk-assigning **all books to one user** (assign-bulk `everyone` mode) makes that user's
  bootstrap the whole universe (~10–15MB on FL). `saveBootstrap` used to write it as ONE
  AsyncStorage row; Android's SQLite-backed AsyncStorage can't read rows past ~2MB (CursorWindow)
  and defaults to a ~6MB total DB, which crashed exactly this case in July 2026 (a canvasser
  assigned all 16k homes hit "Row too big" + SQLITE_FULL at "loading houses"; iOS is file-based
  and was unaffected). **Fixed:** the bootstrap now lives in a **cache-directory** file
  (`canvass.bootstrap.json` via `expo-file-system/legacy`,
  [mobile/lib/cache.js](../mobile/lib/cache.js)) with no row/DB size limits on either platform.
  The cache directory (not Documents) is deliberate: both OSes exclude it from device backups, so
  the voter roster never rides into a canvasser's personal iCloud/Google backup — see the privacy
  note in cache.js before ever moving it. Startup migrates the old Documents copy across;
  startup migrates a readable legacy AsyncStorage row into the file (an oversized Android row
  throws on read, lands in the catch, and is deleted unread — removeItem never reads, which is
  what frees the 6MB DB); saves are atomic (temp file + rename, so a mid-write kill can't corrupt
  the cache) and coalesced (a knock burst collapses into one write of the newest snapshot); all
  file ops run through one serialization chain; and `saveBootstrap` swallows its own errors so a
  cache-write failure can never fail an otherwise-successful fetch. The remaining whole-universe
  cost is JS heap + `JSON.parse`, not storage.

**Compression was missing until July 2026** — Express does not gzip by default and the Heroku
router doesn't add it, so every JSON response used to ship uncompressed. Fixed in the billing
commit: `app.use(compression())` ([app.js:49](../server/src/app.js#L49)); payloads like these
compress ~85–90% (~12MB → ~1.5MB on the FL all-time map pull). Note gzip helps the WIRE only —
JSON.parse cost and retained JS heap on mobile are unchanged, which is why the mobile assign map
requests `/turfs/doors?slim=1` (address fields dropped server-side;
[turfs.js](../server/src/routes/admin/turfs.js) `GET /doors`).

**Delivered (scale-hardening Phase 2):** (1) `SurveyResponse.answers` is out of the map payload —
lazy-loaded per door on panel open (the web `HouseholdDetailPanel` was its only reader; the mobile
sheet never read it); (2) **viewport-bounded** map fetches — `bbox` → `$geoWithin` `$geometry`
polygon, which finally puts the household `2dsphere` index to work (verified IXSCAN). The 50k cap
stays as the no-bbox backstop. (3) the web map fetches a **padded buffer** and skips the refetch
while the viewport stays inside it, so panning no longer costs a round-trip per settled move.
**Remaining lever:** ~~a size guard or chunked storage in `saveBootstrap` for the
everyone-assignment case~~ — delivered July 2026 as file-backed storage (see the bullet above);
what's left of that case is parse/heap cost on low-end phones, not storage.

## Database scaling (connection pool, indexes, storage)

Investigated July 2026 when the app went commercial off the Atlas M0 free tier. The
concurrency-critical path (many canvassers recording knocks at once — knock write, survey submit,
`getPassStatusMap`, mobile bootstrap) is tightly indexed and was **not** the risk; the risks were
the infra tier plus a few heavy/unbounded read paths. What changed:

- **Connection pooling** — [config/db.js](../server/src/config/db.js) `connectDb(uri, overrides)`
  now sets `maxPoolSize` (env `MONGO_MAX_POOL_SIZE`, default 20; the worker passes 10 via
  `WORKER_MONGO_MAX_POOL_SIZE`), `minPoolSize`, `serverSelectionTimeoutMS` 10s, `socketTimeoutMS`
  120s, `retryWrites/Reads`, and optional `MONGO_COMPRESSORS`. Before, `mongoose.connect(uri)` ran
  with no options → the driver default **100/process**, multiplying per dyno with no ceiling and no
  socket timeout (a hung query held a connection forever). Pool size is per process, so total Atlas
  connections = sum over web + worker dynos; the tuned defaults keep it well under a dedicated tier.
- **Indexes** — new org-wide + map indexes: `CanvassActivity {organizationId,timestamp}`,
  `SurveyResponse {organizationId,submittedAt}`, `Household {campaignId,isActive}`, `ImportJob
  {organizationId,campaignId,createdAt}` + `{createdAt}`. `autoIndex` is **off in production**, so
  build them after deploy: `npm run migrate:build-indexes -- --apply` (idempotent + additive;
  [buildIndexes.js](../server/src/migrations/buildIndexes.js)).
- **Bounded the heavy reads** — the `/flags` GPS audit
  ([flagDetection.js](../server/src/services/audit/flagDetection.js)) loaded the whole matched
  `CanvassActivity` set into memory; it now clamps the window to `AUDIT_WINDOW_MAX_DAYS` even with no
  `from` and count-guards at `AUDIT_ROW_CAP` (250k), returning `truncated` so the UI says "narrow the
  range". `campaignSummaries` ([campaignSummaries.js](../server/src/services/reports/campaignSummaries.js))
  stopped **counting** the two largest collections all-time just to test `hasCanvassed>0` — now an
  indexed `distinct('campaignId', …)` (DISTINCT_SCAN).
- **Denormalized rollup counters (Phase 2)** — the "All time" dashboards no longer re-aggregate the
  ledger at all: `Campaign.stats` carries maintained all-time counters (knocks quadruple, survey +
  lit volume, activity count, last-activity, canvasser set), applied write-side by
  [services/reports/campaignCounters.js](../server/src/services/reports/campaignCounters.js) and
  read by `/campaign-rollup`, `/overview`, and `campaignSummaries` — with an automatic
  live-aggregation fallback for any campaign not yet seeded. Backfill/repair:
  `npm run migrate:campaign-stats -- --apply`. Full semantics + parity test in
  [METRICS.md](METRICS.md) § H.
- **Import memory** — hardened in two waves. First wave: the one un-chunked `$in` in
  [csvImporter.js](../server/src/services/import/csvImporter.js) (normalizedAddress→\_id resolution)
  chunked + `.lean()`, matching the rest of the batched pipeline. Second wave (August 2026), the
  measured record — every number from a real 166,738-row / ~50 MB xlsx:
  - **Preview-headers peek**: `parseUpload` materialized all 166k rows on the **web** dyno to return
    five — **~620 MB / ~6 s** (the R14s). [`peekUpload`](../server/src/services/import/peekUpload.js)
    (unzipper central-directory random access + a two-pass saxes SAX parse) reads O(5 rows):
    **~283 ms / ~90 MB peak**. ExcelJS-with-early-break was rejected — its streaming reader spools the
    whole decompressed sheet (~150 MB) to tmpdir and an early break leaks the spool.
  - **The rows array is gone**: materializing every parsed row as a JS object was **~299 MB live
    heap** — an 8.8× blow-up over the file that OOM'd the worker's 384 MB cap
    (`--max-old-space-size=${WORKER_MAX_OLD_SPACE:-384}`, `server/package.json`). `streamParse`
    ([parseUpload.js](../server/src/services/import/parseUpload.js)) hands rows out one at a time;
    verified: the full 166k xlsx **completes under `--max-old-space-size=384` in ~7 s at 219 MB
    peak RSS** with identical outputs (166,149 valid / 106,958 households / 589 skips) — that
    includes the zip entry-order normalization pass (`preflightXlsx`, IMPORTS.md §G), which
    rewrites hostile-order workbooks to a transient deps-first copy so exceljs's order-sensitive
    streaming reader can never crash or mis-resolve shared strings.
  - **Apply-path spill**: valid rows go to an NDJSON spill file on the dyno's ephemeral disk instead
    of a ~160 MB heap array; the link pass re-writes them stamped with `personId`, and `applyImport`
    consumes `ndjsonBatches` — **one 2000-row batch (~2 MB) in heap at a time**, so worker heap is
    roughly flat in file size. Both spills die in a `finally`; the nightly sweep is the crash backstop.
  - **Diff cursors** ([computeImportDiff.js](../server/src/services/import/computeImportDiff.js)):
    the near-duplicate scan was an **unchunked full-collection Household scan** (+22 MB at 107k doors,
    growing linearly forever) with the zip filter applied client-side — now zip-scoped (`$in` mixing
    exact zip5 strings + anchored zip9 regexes, both riding the index) and cursor-folded into just the
    loose-key map. `forecastPersons` accumulated matched Person docs (a person matching on both svid
    **and** uid was materialized twice — **+75 MB** on a 100k-row re-import) — now cursor-folded into
    key→person maps that retain only compact strings.

  Guard: [importStress.int.test.js](../server/test/importStress.int.test.js) (big messy CSV →
  completes, counts right, idempotent, undoes; crank with `STRESS_IMPORT_HOUSEHOLDS`). Row/cell
  ceilings (`MAX_IMPORT_ROWS` 300k / `MAX_IMPORT_CELLS` 8M) are enforced *during* the parse. Full
  pipeline design: [IMPORTS.md](IMPORTS.md) §E/§G.
- **Storage: GeocodeCache `raw`** — each cache entry stored the full Geocodio response blob, written
  but **never read** (reads project it out; the useful `accuracyType/accuracy/confidence` are already
  separate fields). Dropped it — cuts each entry ~5–6×. Reclaim existing rows with
  `npm run migrate:strip-geocode-raw -- --apply`. This is the single biggest free-tier storage lever
  (a no-coords import is a double hit: geocoding $ **and** cache storage).
- **Atlas tier** — M0 (512 MB, no backups, 500-conn) is undersized for real use: ~1–2 GB per busy
  org per cycle. Move to **M10 with auto-scaling** (backups/PITR, dedicated CPU/RAM, 1500 conn); the
  storage ceiling + no-backups are the risks that bite before load does.
- **Running the suites** — `npm run test:int` ([scripts/test-int.sh](../server/scripts/test-int.sh))
  boots a throwaway `mongod`, runs every `*.int.test.js` (one DB per file), and tears it down; the
  int suites skip without `MONGODB_URI_TEST`.

## State-reset patterns (no reset-in-effect)

Resetting pagination/accumulators in a `useEffect` fires one wasted render+query with
[new filters, stale skip] first. Use instead:

- **Filter handlers reset synchronously** — `onTabChange(k) { setActionTab(k); setSkip(0); }`
  (canvasser activity feed). React 18 batches both into one render.
- **Key the component** — `<VoterList key={...identifying props...} />` remounts with fresh state
  (web QuestionResults/TagResults).
- **Prev-key-in-state** — for screens that can't be keyed from outside (expo-router screen reused
  with new params): compare an `identityKey` during render and reset state synchronously
  (answer-voters). This is the React-sanctioned render-phase adjustment, StrictMode-safe.

## Misc

- **expo-file-system v19 (SDK 54):** the main entry throws on legacy functions and doesn't export
  `cacheDirectory`/`EncodingType`. Import from **`expo-file-system/legacy`** (`mobile/lib/csv.js`).
  `downloadCsv` also sweeps **stale** `*.csv` files (older than 1h, by `modificationTime`) from the
  cache dir before each export — age-gated rather than "all but the current file" so a just-created
  export a share target may still be reading (e.g. Gmail attaching lazily on Android) is never
  deleted mid-share.
- **Feedback timers:** `flash()`/copy-confirm helpers keep their timeout id in a ref, clear it
  before re-arming, and clear on unmount (UserProfileModal, ClientReportBuilderPage,
  ClientReportsPage, mobile users/[id]).
- **Overlay (`client/src/components/ui/Overlay.jsx`):** the focus-trap/scroll-lock effect is
  mount-once; `onClose` is read through a ref so inline-arrow consumers don't churn listeners or
  yank focus on host re-renders.
- **Verified non-issues** (audited, intentionally left): CrossOrgActivityFeed's
  `refetchIntervalInBackground: true` (deliberate super-admin live feed), module-level singletons
  registered once per JS load, root-layout effects.
