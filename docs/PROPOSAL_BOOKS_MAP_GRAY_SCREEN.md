# Proposal: the Books map on Android went gray — fix the door-dots hand-off and the map's camera

> **Status: BUILT 2026-10-14 (uncommitted at time of writing), to this plan with the recommended
> defaults in [§J](#j-decisions-for-the-owner-recommended-defaults-in-bold); the owner's device checks
> ([§F](#f-tests-and-device-gates)) and the staging → production OTA are pending.** Where the build
> differs from the plan is listed in [§M, "As built"](#m-as-built-2026-10-14) at the end, with the
> second review round's findings. Everything above §M is the plan as approved.
>
> Plan status before the build: PLAN v2, 2026-10-14. One review round (one reviewer; every finding was
> checked against the code before it was accepted, [§K](#k-review-log)). Two findings changed the
> design (the layer-ordering mechanism and the book-detail framing); the rest confirmed it.
>
> Root cause is **confirmed from the phone's log**, not inferred: two reproductions on the owner's
> Android phone over `adb logcat` on 2026-10-14, matching the lead's screen recording of 2026-10-13.
>
> Line references are to HEAD `f906408`. Phone only: no server change, no migration, no index build,
> no config var, no client-version bump, no native change (the fingerprint does not move), so it
> ships over the air, staging first.

Related: [ADMIN_APP.md](ADMIN_APP.md) → *Books tab* (the screen; its Part 2 bullet on the file-backed
door dots is updated by this change), [PERFORMANCE.md](PERFORMANCE.md) (the file-backed bullet),
[MAPS.md](MAPS.md), [mobile/README.md](../mobile/README.md) (release lanes).

# Part 1 — For everyone

## What happened

A team lead on an Android phone opened the admin **Books** tab, tapped **Map**, saw the map draw, and
about two seconds later the **whole screen turned flat gray**: header, chips, tab bar, everything.
The app stayed open but showed nothing until it was force-closed and reopened. The list view was
fine, and so was the canvasser map, so the lead switched back to canvass mode to see the territory.

It was not the lead's account, the campaign, the build, or the phone. It happens to **every Android
phone** on **this one screen**, the moment the map's door dots finish downloading. iPhones never hit it.

In plain words: the map library we use has an Android-only bug. When the Books map swaps its empty
door-dots placeholder for the downloaded file, the library trips over the swap, and the app's
framework responds by tearing down the entire screen. The process survives, which is why the app
sat there gray instead of closing, and why nothing was recorded in the store's crash reports.

While looking at this screen, two smaller problems with its camera turned up on both platforms:

- The Books map has no starting position of its own. If anything stops its first fit from landing,
  it shows the whole world instead of the campaign. And switching **Map → List → Map** always does:
  the second map is never fitted.
- Opening a **second book** from the Books list keeps the camera on the **first** book's area.

## What changes

1. **The gray screen goes away.** The door dots are added to the map in a way the Android library
   handles: the dots layer is created only once the file exists and never goes through the swap.
   Nothing about what you see changes: same dots, same colors, same order under the book outlines.
2. **The Books map opens over the campaign's books** and comes back framed on them every time you
   switch between List and Map or By book and By canvasser.
3. **Opening another book from the list frames that book.**

## What does not change

No new data is collected or sent anywhere; the same door file reaches the phone from the same
Doorline endpoint. No server deploy. No change for iPhone users beyond items 2 and 3. No Help Center
text changes.

## Who gets it, and when

A phone update over the air, **staging first**, then production, after the checks in
[§F](#f-tests-and-device-gates) pass on an Android phone with the log running.

**Until then,** Android users should avoid **Books → Map**. Tapping a book in the list to open its own
map, and the **Map** tab, are unaffected.

# Part 2 — Technical reference

## A. The incident and the evidence

**Symptom (screen recording, lead's Pixel, dark mode, campaign Fred Wilms – CT Treasurer, 289 books /
29,694 doors):** Books list → Map; the map mounts, the camera fit lands (so `onDidFinishLoadingMap`
and `fitBounds` both work); the map sits correctly framed with all chrome for about a second; then in a
**single frame** the entire window becomes flat `#303030`, Android's dark-theme `windowBackground`,
the color of an Activity whose content view is empty. No door dots were ever drawn.

**Log (owner's Android phone, two reproductions, 2026-10-14):**

```
JSApplicationIllegalArgumentException: Error while updating property 'shape' of a view managed by: RNMBXShapeSource
Caused by: java.lang.ClassCastException: Dynamic value from Object is not a string
    at com.facebook.react.bridge.DynamicFromObject.asString(DynamicFromObject.kt:48)
    at com.rnmapbox.rnmbx.components.styles.sources.RNMBXShapeSourceManager.setShape(RNMBXShapeSourceManager.kt:85)
    ... IntBufferBatchMountItem.execute → MountItemDispatcher → FabricUIManager$DispatchUIFrameCallback → GuardedFrameCallback.doFrame
W BridgelessReact: ReactHost{0}.handleHostException(message = "Error while updating property 'shape' ...")
W BridgelessReact: ReactHost{0}.getOrCreateDestroyTask()
```

**The chain, verified in the installed native sources:**

1. [books.jsx:972-977](../mobile/app/(app)/admin/books.jsx#L972-L977) renders the `door-dots`
   `ShapeSource` with `shape={empty FeatureCollection}` until the round-wide door file is downloaded,
   then re-renders it with `url={file://…}` and **no `shape`**.
2. React Native's prop diff sends a defined→undefined transition as **null**
   (`ReactNativeAttributePayload.js` `diffProperties`); undefined props are simply omitted on *create*.
3. rnmapbox 10.3.0's Android setter calls `geoJSONStr.asString()` **before** its own null check
   (`RNMBXShapeSourceManager.kt:83-91`), and RN's `DynamicFromObject.asString()` throws on anything
   that is not a String, null included.
4. The throw happens inside a Fabric mount item under `GuardedFrameCallback`, whose catch routes it to
   `BridgelessReactContext.handleException` → `ReactHostImpl.handleHostException` → `destroy()`
   (`ReactHostImpl.kt:661-671`): the React surface is torn down.
5. In a release build the host first hands the exception to Expo's
   `ExpoReactHostFactory.handleInstanceException`, which forwards to expo-updates'
   `onReactInstanceException` and **does not rethrow**. The process survives with an empty window.

**Why only Android:** iOS applies props through `RNMBX_OPTIONAL_PROP_NSString`, which skips a null
prop entirely (`RNMBXFabricPropConvert.h:38-41`); the setter is never called.
**Why only this screen:** it is the only rnmapbox element in `mobile/` that ever *removes* a prop
(grep of `mobile/app` and `mobile/components`; every other source mounts whole or always passes a
FeatureCollection, e.g. `pointFeatures` in `admin/map.jsx:94-100`).
**Why "two seconds":** the download time of the door file for that round.
**Why nowhere in Play Console:** the process never crashed. The app's own `RootErrorBoundary` only
catches render errors, so it never saw it either. The only record is `adb logcat` on a reproducing
phone; the runbook is in [§F](#f-tests-and-device-gates).

## B. Design

### B1. The door-dots source only ever carries `url`, is mounted once the file exists, and is the last source in the tree

```jsx
{/* LAST child on purpose, and mounted only once the file exists: see ADMIN_APP.md → Books tab.
    Never give this source a `shape` and never remove a prop from it — on Android a removed prop
    reaches the map library as null and tears down the whole app (PROPOSAL_BOOKS_MAP_GRAY_SCREEN.md). */}
{doorsQ.data && (
  <Mapbox.ShapeSource id="door-dots" url={doorsQ.data}>
    <Mapbox.CircleLayer
      id="door-dot"
      belowLayerID="promoted-home-dot"
      filter={doorDotFilter}
      style={{ /* unchanged */ }}
    />
  </Mapbox.ShapeSource>
)}
```

- **Created with the url, never with a shape.** Android `makeSource()` builds
  `builder.data(mShape ?: mURL.toString())` with `mShape` null (`RNMBXShapeSource.kt:67-74`); a
  `setURL` that arrives before attach only stores `mURL` (`:76-81`). iOS `makeSource()` sets
  `result.data = .url(URL(string: url)!)` (`RNMBXShapeSource.swift:106-108`). No `shape` prop is ever
  sent: RN omits undefined props on create, and the prop is never defined so it can never be removed.
- **Later url changes update in place.** A `doorEpoch` bump (bulk restrict) or a campaign/round switch
  (after `keepPreviousData`) changes the url on the existing source: Android `setURL` →
  `mSource.data(url)`; iOS `url` didSet → `parseJSON` → `updateGeoJSONSource`, as today. No React
  `key` on the source: a keyed remount was considered and dropped (it buys nothing on iOS, see B7, and
  blinks the dots on every bulk restrict).
- **Order comes from the tree, not from deferral.** Mapbox appends a layer at add time, and this
  source now mounts after the others, so its layer names `belowLayerID="promoted-home-dot"`. On
  Android a missing target is waited for (`RNMBXLayer.kt:187-202` → `RNMBXMapView.kt:760-778`,
  fired by `layerAdded` `:749-758`), but **on iOS the equivalent hook is an empty `TODO`**
  (`RNMBXMapView.swift:384-386`; `layerWaiters` is appended at `:393` and never read), so a layer
  whose target is absent at insertion is never added. The design therefore guarantees the target
  exists at insertion in every path by making `door-dots` the **last** child: on a joint mount or
  remount (Map → List → Map, By canvasser → By book, a style reload), sources are added in child
  order and `promoted-homes` precedes it; on the late mount (file arrives) it already exists.
  Resulting order on both platforms: `assign-book-fill`, `assign-book-line`, `door-dot`,
  `promoted-home-dot`, `assign-book-label`, which is today's intended order.
- **A failed download now unmounts the dots** instead of crashing: on a new query key an error leaves
  `doorsQ.data` undefined (`keepPreviousData` only holds while pending), so the conditional simply
  renders nothing.

### B2. The rule, written down where it will be read

A code comment at the source (above) and one sentence in [ADMIN_APP.md](ADMIN_APP.md) → *Books tab*
Part 2: **never let a mounted rnmapbox element lose a prop.** Conditionally mount the whole element
instead. Never rely on `belowLayerID`/`aboveLayerID` to wait for a layer that does not exist yet.

### B3. The Books map gets a starting camera

Every other map screen seeds its camera with `defaultSettings` (for example the canvasser picker,
[books.jsx:392-394](../mobile/app/(app)/books.jsx#L392-L394)); the Books map's
[`<Mapbox.Camera ref={cameraRef} />`](../mobile/app/(app)/admin/books.jsx#L928) has none, so until the
fit lands it shows Mapbox's built-in start: the whole world at zoom zero.

```jsx
// Where the map opens before the fit lands: the books' bounding-box center; a neutral default while loading.
const cameraDefaults = useMemo(
  () => cameraSeed(books.map((b) => b.centroid?.coordinates), DEFAULT_CENTER),
  [books]
);
…
<Mapbox.Camera ref={cameraRef} defaultSettings={cameraDefaults} />
```

`defaultSettings` is applied once, at the camera's creation, on both platforms (Android
`RNMBXCamera.addToMap` → `setInitialCamera` before any queued stop, `RNMBXCamera.kt:100-110`; iOS
`initialLayout()` from the first `layoutSubviews`, `RNMBXCamera.swift:567-582`), and the fit below
refines it. Seed and fit cannot fight: the seed lands before the map-loaded event that triggers the fit.

### B4. Every map instance fits itself once

Today the one-shot fit ([books.jsx:671-688](../mobile/app/(app)/admin/books.jsx#L671-L688)) is guarded
by `camInit`, reset only on `[cId, passId, view]`
([:339-347](../mobile/app/(app)/admin/books.jsx#L339-L347)), and `mapReady` is never reset. The List/Map
toggle unmounts and remounts the MapView (the ternary at [:914](../mobile/app/(app)/admin/books.jsx#L914)),
so the second instance is never fitted.

```jsx
// After `const loading = …` (:757). ONE gate for the map subtree, used by the JSX and the reset below,
// so the two can never drift.
const mapShown =
  view === 'book' && bookView === 'map' && !!cId && !!passId && !!MAPBOX_PUBLIC_TOKEN && (books.length > 0 || loading);
// A map INSTANCE's "ready" and "fitted" flags die with it: the List/Map and By canvasser toggles
// unmount the MapView, and a fresh one starts at Mapbox's world view until it is fitted.
useEffect(() => {
  if (!mapShown) return undefined;
  return () => {
    camInit.current = false;
    setMapReady(false);
  };
}, [mapShown]);
```

The JSX gate becomes `mapShown ? (…) : (…)`. The fit effect keeps its body and dependencies
(`[bookView, view, mapReady, books]`); it only switches to the shared `boundsOf` helper (§E). The
comment at `:915-917` ("the MapView stays mounted through refetches … unmounting it drops the camera")
is rewritten: it is true for refetches and scope switches and false for the view toggles, which is now
by design.

### B5. The book-detail map frames the book that is open

[book/[turfId].jsx](../mobile/app/(app)/admin/book/[turfId].jsx) is one reused Tabs instance. Its
framing effect (`:186-212`) is guarded by `camInit` (`:94`), which is never reset when `turfId`
changes, so the second book opened stays on the first book's area. A reset in the existing `[turfId]`
effect (`:273-275`) would not work: that effect is declared *after* the framing effect, so in the
commit where `turfId` changes the framing effect runs first, bails, and the reset lands too late; with
cached data (reopening a book) nothing later re-runs it. Key the framing on the book instead:

```jsx
const framedFor = useRef(null); // the turfId this reused instance has framed
useEffect(() => {
  if (framedFor.current === turfId || !mapReady || !cameraRef.current) return;
  const b = boundsOf(households.map((h) => [h.lng, h.lat]));
  if (b) {
    if (b.single) cameraRef.current.setCamera({ centerCoordinate: b.ne, zoomLevel: 16, animationDuration: 0 });
    else cameraRef.current.fitBounds(b.ne, b.sw, [56, 40, 56, 40], 0);
    framedFor.current = turfId;
  } else if (bookQ.isFetched) {
    if (turf?.centroid?.coordinates?.length === 2) {
      cameraRef.current.setCamera({ centerCoordinate: turf.centroid.coordinates, zoomLevel: 14, animationDuration: 0 });
    }
    framedFor.current = turfId;
  }
}, [households, mapReady, turf, bookQ.isFetched, turfId]);
```

`camInit` goes away. Fresh key: `bookQ` has no `placeholderData`, so `households` is `[]` and
`isFetched` is false in that render; nothing locks, and the effect fits when data arrives. Cached key:
data is present in the first render and `framedFor` differs, so it fits at once. No `defaultSettings`
here, on purpose: a single reused instance would only ever apply it on the first open, and the fit
lands within a second.

### B6. What stays as it is

`doorsQ` keeps `keepPreviousData` (a round switch never blanks the dots), the epoch filename scheme,
and the delete-the-previous-file step. The only time the native map re-reads a url on its own is a
style reload during the download window after an epoch bump, which self-heals when the new url
arrives. `promotedQ`, the sheet, select mode, chips and the loading overlay are untouched.

### B7. iOS: neutral, with one honest note

On iOS the `url` didSet runs on every set, creation included (`RNMBXShapeSource.swift:8-25`): it reads
the file and decodes it with Swift's `JSONDecoder` on a background queue, then hands the object to the
style on the main thread. That is today's iOS path and it stays. What is new on iOS is that the source
is *created* with the url, so the native loader also loads the file; a decode that completes before
the source exists is dropped by `doUpdate`'s guard (`:152-161`). Net: no iOS behavior change expected,
and one new path to verify on device ([§F](#f-tests-and-device-gates), the remount case). The Swift
decode's cost at 100k+ doors (tens of MB, seconds, memory) is a known follow-up, not this change.

## C. Alternatives rejected

| Alternative | Why not |
|---|---|
| Patch rnmapbox's Android setter (`patch-package`, move the null check above `asString()`) | A native change moves the fingerprint (`fingerprint.config.js`): four new store builds and store lag, for a fix that ships over the air in JS. File it upstream instead ([§I](#i-upstream)). |
| Keep the source always mounted with a placeholder empty file as the url | Needs an async file write that cannot be guaranteed before the first render; the iOS decode still runs; more code for the same result. |
| Key the source on the url so every file is a fresh creation | No iOS benefit (B7) and a visible dot blink on every bulk restrict. |
| Rely on `belowLayerID` deferral for ordering | Dead code on iOS (B1). |
| Fix only the crash, leave the camera | The user asked for all of it, and the camera fixes are two small, contained edits with the same device checks. |

## D. Files and exact changes

| File | Change |
|---|---|
| [mobile/lib/mapCamera.js](../mobile/lib/mapCamera.js) (new) | `DEFAULT_CENTER`, `boundsOf(points)`, `cameraSeed(points, fallback)`; pure, no React Native imports ([§E](#e-the-helper)). |
| [mobile/lib/mapCamera.test.js](../mobile/lib/mapCamera.test.js) (new) | `node:test` cases ([§F](#f-tests-and-device-gates)). |
| [mobile/app/(app)/admin/books.jsx](../mobile/app/(app)/admin/books.jsx) | Import the helper. `cameraDefaults` memo and `mapShown` + its cleanup effect after `const loading` (`:757`). Camera gets `defaultSettings` (`:928`). Fit effect uses `boundsOf` (`:671-688`). The `door-dots` block (`:972-989`) is removed from its position and re-added as the **last** child of the MapView as a conditional, url-only source with `belowLayerID` (B1). JSX gate uses `mapShown` (`:914`); comments at `:611-619` and `:915-917` rewritten. |
| [mobile/app/(app)/admin/book/[turfId].jsx](../mobile/app/(app)/admin/book/[turfId].jsx) | Import `boundsOf`. `camInit` (`:94`) replaced by `framedFor`; framing effect (`:186-212`) rewritten per B5 with `turfId` in its deps. |
| [docs/ADMIN_APP.md](ADMIN_APP.md) | *Books tab* Part 2: the file-backed bullet (around `:955-968`) gains the url-only/last-child/`belowLayerID` mechanism, the Android null-prop rule, and the seeded camera + per-instance fit; the book-detail section gains one line on `framedFor`. Part 1: one sentence, "the map opens over the round's books". |
| [docs/PERFORMANCE.md](PERFORMANCE.md) | The file-backed bullet: one line that iOS still decodes the file in Swift on every url set (rnmapbox 10.3.0 `didSet`), a follow-up at 100k+ doors. |
| [docs/README.md](README.md) | This proposal's row. |

Help Center: nothing (no user-facing text changes). Privacy: nothing (same data, same endpoint, same
file; [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) unaffected). Server: nothing.

## E. The helper

```js
// mobile/lib/mapCamera.js — pure camera helpers for the admin Books map and the book-detail map.
// No react-native imports: this file runs under node --test (see mapCamera.test.js).

// The neutral default the canvasser picker and the admin Map already use while nothing is known.
export const DEFAULT_CENTER = [-84.5, 39.0];

const isPoint = (c) => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]);

// Bounding box of the usable points ([lng, lat] pairs; anything else is ignored), or null.
// `single` = every usable point is the same spot (or there is one), where fitBounds has nothing to fit.
export function boundsOf(points) {
  const pts = (points || []).filter(isPoint);
  if (!pts.length) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of pts) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { ne: [maxLng, maxLat], sw: [minLng, minLat], single: minLng === maxLng && minLat === maxLat };
}

// A camera to open on BEFORE the fit lands (Mapbox.Camera defaultSettings).
export function cameraSeed(points, fallback = DEFAULT_CENTER) {
  const b = boundsOf(points);
  if (!b) return { centerCoordinate: fallback, zoomLevel: 9 };
  if (b.single) return { centerCoordinate: b.ne, zoomLevel: 14 };
  return { centerCoordinate: [(b.ne[0] + b.sw[0]) / 2, (b.ne[1] + b.sw[1]) / 2], zoomLevel: 10 };
}
```

The picker's and the admin Map's own `DEFAULT_CENTER` constants are left where they are (no churn in
files this change does not otherwise touch); a later cleanup can import this one.

## F. Tests and device gates

**Unit (`npm run test:mobile` from the repo root; the suite is 245 green today):**
`mapCamera.test.js`: `boundsOf` → null for `[]`, `undefined`, and all-malformed input; ignores
`null`, strings, three-element and `NaN` entries; one point → `single`; many → correct `ne`/`sw`;
identical points → `single`. `cameraSeed` → fallback at 9 for nothing; the point at 14 for one; the
bbox center at 10 for many; a custom fallback is honored.

**Static:** an esbuild parse of both screens, as previous mobile changes did:
`npx esbuild "mobile/app/(app)/admin/books.jsx" --loader:.jsx=jsx > /dev/null` and the same for
`book/[turfId].jsx`.

**Device, Android first.** The owner's phone is already authorized for USB debugging
(`~/Desktop/android/platform-tools/adb`). Run, then do each step:

```
~/Desktop/android/platform-tools/adb logcat -v time | grep -E "handleHostException|RNMBX|ReactNativeJS|AndroidRuntime"
```

1. Books → Map on the Fred Wilms campaign: the map opens over the books (no world view), the fit
   lands, **the dots appear** (this is also the first proof that the native map loads a `file://` url
   on Android, see the gate below), and the log never prints `handleHostException`.
2. Map → List → Map: framed on the books again, dots present.
3. By canvasser → By book: framed again.
4. Switch campaign in the chip, then switch back: framed on each.
5. Bulk-restrict a book from the map sheet: dots refresh in place, no blink, no log line.
6. Tap a book from the list, back, tap a different book, back, tap the first again: each opens framed
   on its own homes.
7. Chips narrowing and a promoted book: dots sit under the promoted (status-colored) dots and under
   the labels, polygons under both.

**iOS (TestFlight, staging lane):** steps 1, 2, 5, 6, 7. Step 2 is the one **new** iOS path (source
created with the url while a decode is in flight, B7): the dots must appear.

**Gate:** if the dots do **not** appear on a platform after the file downloads, that platform's native
loader does not accept `file://` for GeoJSON data (nothing before this change ever reached that point
on Android). The contingency is a short-lived signed HTTPS url the native loader fetches itself; that
is a server change (a signed-url variant of `GET …/turfs/doors`) and a separate proposal. Do not ship
production until the dots are seen on both platforms.

## G. Rollout

JS-only; the fingerprint does not move. From `mobile/`, **the owner runs**:

1. On the feature branch: `npm run test:mobile` (root) and the esbuild parses.
2. `npm run ota:staging` → the Android checks in §F with the log running, then the iOS checks.
3. Merge to `main` → `npm run ota:production` from `main`.

No client-version bump (additive, nothing an older bundle depends on changed), no `build-indexes`, no
Heroku change. Interim guidance for Android users until the production update is live: avoid Books →
Map; the book-detail map and the Map tab are unaffected.

## H. Docs cascade

Listed in [§D](#d-files-and-exact-changes). Help Center: none. Privacy policy, ToS, DPA: untouched; no
new data, no new third party, no new retention.

## I. Upstream

File against rnmapbox/maps (10.3.0): `RNMBXShapeSourceManager.setShape` calls
`geoJSONStr.asString()` before its null check; React Native delivers a removed `shape` prop as a null
`Dynamic`, whose `asString()` throws `ClassCastException`, and because the throw happens inside a Fabric
mount item the host destroys the surface. One-line fix: test `geoJSONStr.type == ReadableType.Null`
first. Second item in the same report: `RNMBXMapView.swift` `layerAdded` is a `TODO`, so
`belowLayerID`/`aboveLayerID` deferral never completes on iOS. Attach the stack in §A.

## J. Decisions for the owner (recommended defaults in bold)

1. Seed zoom for many books **10**, one book **14**, loading fallback **`DEFAULT_CENTER` at 9** (same
   as the sibling screens). Alternative: skip the fallback and let the loading map start at the world.
2. Dots refresh **in place** after a bulk restrict (no remount). Alternative: keyed remount (blink).
3. **File the upstream report** ([§I](#i-upstream)); the fix here does not wait for it.
4. **Leave** the picker's and admin Map's `DEFAULT_CENTER` constants alone this round.

## K. Review log

Round 1 (2026-10-14, one reviewer, read-only, every claim checked against the files; the reviewer also
ran the mobile suite: 245 pass).

| # | Finding | Verdict | Effect on the design |
|---|---|---|---|
| 1 | `belowLayerID` deferral is dead on iOS: `layerAdded` is an empty `TODO`, `layerWaiters` never read; with the dots source before `promoted-homes` in the tree, a joint mount or remount would add the dots layer before its target and it would never be added. | Confirmed (`RNMBXMapView.swift:384-395`) | **Changed:** the dots source is the last child; the named layer always exists at insertion. |
| 2 | A `camInit` reset in the `[turfId]` effect runs after the framing effect (declaration order `:186` vs `:273`); with cached data the framing never re-runs. | Confirmed | **Changed:** framing keyed on `turfId` via `framedFor` (B5). |
| 3 | iOS creation now takes the native url loader; a decode that finishes before the source exists is dropped by `doUpdate`'s guard. New path, unverified. | Confirmed (`RNMBXShapeSource.swift:152-161`) | Device gate step 2 on iOS (§F). |
| 4 | The sketch shadowed the helper (`const cameraSeed = useMemo(() => cameraSeed(…))`, a TDZ error) and `DEFAULT_CENTER` does not exist in the admin screen. | Confirmed | Fixed: `cameraDefaults`; `DEFAULT_CENTER` exported by the helper. |
| 5 | Undefined props are omitted on create; only a defined→undefined transition is sent as null. The url-only mount never sends `shape`. | Confirmed (`ReactNativeAttributePayload.js`) | Core of B1 holds. |
| 6 | Android `setURL` before attach stores the url; `makeSource` uses it; in-place `data(url)` is the standard path. | Confirmed | Holds. |
| 7 | Android deferral and style-reload re-add in child order work; a stale waiter cannot double-add after the reorder. | Confirmed | Holds. |
| 8 | Unpositioned layers append, so the ordering premise needs the reorder. | Confirmed | Folded into #1. |
| 9 | The `mapShown` cleanup resets on every unmount of the map subtree with no render loop; `loading` is defined at `:757`, so `mapShown` must sit after it, and the JSX must consume `mapShown`. | Confirmed | B4 as written; placement noted in §D. |
| 10 | `defaultSettings` is applied once at creation on both platforms, before the fit can fire. | Confirmed | B3 holds. |
| 11 | Tests: ESM `node:test`, root `test:mobile`; the helper must stay free of React Native imports. | Confirmed | §E, §F. |
| 12 | Scope: the door-dots spread is the only prop-removal on a map element in `mobile/`; nothing else on the layer changes type. The runtime style switch is a third remount/order path. | Confirmed | Covered by #1. |
| 13 | Alternatives: placeholder file, patch-package, keyed remount, keepPreviousData interplay. | Confirmed as rejected/benign | §C, B6. |

## L. Effort

Code: about 60 changed lines across two screens plus a 30-line helper and its test. Docs: three
files. Device checks: one Android session with the log running, one iOS session. One short sitting
for the build; the device checks are the long pole.

## M. As built (2026-10-14)

Built to §B–§E with every §J default. `npm run test:mobile`: 252 pass (245 before + 7 in
`mapCamera.test.js`); esbuild parses of both screens and the helper are clean. A second review round
(one reviewer, read-only, against the diff) found no correctness defect and confirmed every §D row;
its findings and what changed:

| # | Finding | Outcome |
|---|---|---|
| 1 | Two comments said the MapView "stays mounted through scope switches"; a switch to a campaign whose efforts are not cached makes `passId` null for a commit, so `mapShown` flips and the map remounts. Pre-existing (the old gate was the same expression) and now harmless: the cleanup makes the new instance fit itself. | Both comments reworded to say exactly which switches keep the instance. |
| 2 | The helper used `export function` like its oldest neighbors; the newest lib files and the global style preference use arrow functions. | New file, no in-file neighbors: converted to `export const … = () =>`. |
| 3 | `books.map((b) => b.centroid?.coordinates)` was built twice (fit effect and seed). The promotion effect still carries its own bbox loop. | One `bookCentroids` memo feeds the fit and the seed. The promotion effect is untouched (not in this change's scope; a later cleanup can use `boundsOf`). |
| 4 | Behaviour delta, strictly better: `boundsOf` ignores anything that is not two finite numbers. The old book-detail loop fed `[h.lng, h.lat]` unfiltered, so a home with null coordinates widened the fit toward (0, 0) and a book whose homes all lacked coordinates locked on (0, 0); such homes are now ignored and the all-null case falls through to the centroid. | Recorded; no change. |
| 5 | On a cold load (books still loading) the first frame is the neutral default at zoom 9 until the fit lands, so Part 1's "opens over the round's books" is true after that brief frame. | Accepted in §J decision 1; recorded. |

**Not done here, by design:** the device gates in §F (Android with the log running, then iOS, including
the remount-with-cached-file case), the staging and production OTA (the owner runs them), and the
upstream rnmapbox report (§I). Production must not ship until the dots are seen on both platforms.
