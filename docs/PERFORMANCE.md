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
   polling all day behind other tabs.
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
| GPS dot | `<Mapbox.UserLocation visible={isFocused} />` | admin map, book map |

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
