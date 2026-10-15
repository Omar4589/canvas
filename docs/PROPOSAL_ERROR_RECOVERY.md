# Proposal: never a dead screen — catch the errors that blank or close Doorline

> **Status: Part A BUILT 2026-10-15, with the server switch — not yet published. Part B (Android, native) deferred
> to the app-store build after Election Day.** PLAN v5 (2026-10-14) was final after four review rounds and nine
> reviewers: the error mechanics, the app integration, the native part, a working prototype of the handler against a
> port of React Native's release error chain, the plan as a product and release decision, a state-machine model of the
> escalation rules, an implementation-readiness pass over every reference and API, a final adversarial read with
> React's production renderer run in Node, and a final verification of every fix ([§K](#k-review-log)). Versions:
> React Native 0.81.5 (bridgeless), Expo SDK 54, expo-router 6.0.24, expo-updates 29.0.18, @rnmapbox/maps 10.3.0,
> react-native-worklets 0.5.1.
>
> **The owner's ruling, 2026-10-15:** Part A ships **now**, before Election Day — staging first, then production — as
> a phone update, with the server kill switch §J-1 described (`MOBILE_ERROR_RECOVERY=off`). Part B waits for the next
> app-store build, after Election Day. That replaces this plan's original timing (both parts after Election Day under
> the GPS plan's release rules, §F). One additive server change (the switch), no migration, no client-version bump,
> no new data collected, no new third party. Where the build differs from the plan, [*As built*](#as-built) says so;
> the rest of this document is the design as reviewed. Line references are to HEAD `31d85d3`.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) → *The update surfaces*, *Session & role recovery*, *The profile screen*
(the documentation of record gains *When something goes wrong* and *Error recovery*), [ADMIN_APP.md](ADMIN_APP.md) (a
pointer), [TIMEZONES.md](TIMEZONES.md), [mobile/README.md](../mobile/README.md),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

# Part 1 — For everyone

## What we learned

The gray screen a team lead hit on the Books map was one example of something broader. Two kinds of failure can stop
Doorline cold:

- **A mistake in Doorline's own code that runs after a tap, a timer, or a message from the phone** — for example a
  button whose code trips over unexpected data.
- **A failure inside a built-in piece** the app is made of, like the map or the animations.

Today, once the app has been open a few seconds, **both kinds leave an Android phone on a flat gray screen** until
someone force-closes it, and **both close the app on an iPhone.** Nothing reaches Doorline, which is why the gray screen
never showed up in Google Play's crash list.

## What changes

**With a phone update (staging first, then everyone — October 2026, before Election Day):**

1. **A tap that fails no longer takes the app down.** Doorline keeps running and usually shows a one-line banner just
   under the top bar: *"Something went wrong"*, with **Restart** and **✕**. Tap the words for the details — a
   screenshot of them tells Doorline what failed and in which version. If the tap was inside a pop-up sheet, the banner
   appears when the sheet closes. The thing you tapped may not have gone through, so check it: on a door, look at the
   door's result.
2. **The banner's Restart is offered, never forced.** It waits for any knock that is still saving. It is not offered
   while you're on a door or in a survey, or while the app is asking for your password. It reopens Doorline in a few
   seconds, still signed in (canvassers on their map, team leads and admins on their home screen), and picks up a
   downloaded update if one is waiting.
3. **On a door, nothing takes the door away.** If the door's own buttons stop working, go back to the map, restart
   Doorline and record the door again. Doors and surveys you already saved are safe.
4. **If a door screen itself crashes**, only that screen is replaced: *"This door hit a problem"* (or *"This survey…"*),
   with **Go back** and **Try again**. Answers on that screen that weren't saved are gone; saved doors are not.
5. **Off the doors, if failures pour in non-stop** (five within three seconds — something stuck in a loop), the app
   shows its full **"Something crashed"** screen. It now leads with **Restart Doorline**, which reopens the app in a
   few seconds — usually still signed in; if Doorline was about to sign you out anyway (your password was changed
   somewhere else), you'll sign in again and your houses download again, so you need signal. The second button,
   **Reset & go home**, is for when Restart brings you straight back: you choose your organization and campaign again
   and your houses download again, so you need signal; saved work waiting to send is kept.
6. **If the app's outer frame itself fails**, a plain "Doorline hit a problem" screen with Restart appears instead of a
   blank screen.

**With the GPS app-store build (Android):**

7. **A failure inside a built-in piece closes the app like any other crash** instead of leaving a gray screen. Reopen it
   and keep going.

**Team leads:** when a canvasser sends you a screenshot of the details, forward it with the time and what they tapped.

**For Doorline's developers:** an automatic check fails the tests when a map element is written in a way that lets one
of its settings disappear — the pattern that caused the gray screen. (It can't see a value that only turns empty while
the app runs; the Android crash handler in the app-store build is the backstop for that.)

## What it can't catch

- A step that fails *after* it started waiting on something (the network, a GPS fix, the phone's storage, a question on
  screen) still shows nothing, as today: the step just doesn't finish.
- A failure in the first moments after Doorline opens still closes the app (iPhone and Android) or, on Android, turns it
  gray.
- On an iPhone, a failure inside a built-in piece still closes the app, before and after.
- On Android, until the app-store build, a built-in failure can still turn the screen gray: close Doorline and reopen
  it; saved work is safe.

## What does not change

Less leaves the phone than today, not more. The error details live in the app until you dismiss them, sign out or
restart; the phone's own system log keeps its copy, as it always has. After the app-store build, if an Android phone
shares diagnostics with Google, the crash report Doorline itself raises names where in the code it failed, never the
error text. The server gained only an off switch (`MOBILE_ERROR_RECOVERY`) for the catching of errors — the banner
and the loop takeover; accounts and reports are untouched.

# Part 2 — Technical reference

## As built

Built 2026-10-15 as designed below, with these differences:

- **The kill switch (§J-1).** `server/src/routes/public/buildStatus.js` adds `errorRecovery` to both answers — false only
  for `MOBILE_ERROR_RECOVERY` = `off` (any case or padding); unset or anything else is on. `components/UpdateGate.jsx`
  passes a boolean to `errorStore.setEnabled()` and saves it (`saveErrorRecoveryEnabled` / `loadErrorRecoveryEnabled` in
  `lib/cache.js`, key `canvass.errorRecovery`, stored only as `off`). `app/_layout.jsx` hydrates the remembered value at
  module scope through `errorStore.hydrateEnabled()`, which is ignored once the server has answered in this launch, so a
  slow storage read can't undo a fresher answer. `decide()` forwards whenever the switch is off. Tests: the server's
  `buildStatus.int.test.js` (every answer carries the field; it fails open) and `errorRecovery.test.js`.
- **`CrashCard` is two files.** `components/CrashCard.jsx` holds `CrashFrame` (the shared page) and `DoorCrashCard`, and
  imports nothing that saves or signs out — the practice screen promises it imports nothing that writes
  (PROPOSAL_SURVEY_PRACTICE.md). `components/CrashRestart.jsx` holds `RestartBlock` (Restart from a crash screen, B6) and
  `OuterFrameCrash` (B5).
- **Crash-screen layout.** The title and what it means, then the buttons, then the screenshot line, the error and the
  build line, with the stack (and, for a render crash, the component stack) under *Details* at the bottom — so the
  buttons are on screen without scrolling. The full crash screen keeps the stack and component stack it showed before.
- **The door flag** is set in a layout effect (`useLayoutEffect`) rather than a passive one — earlier, never later, and
  still not a render-time ref (B4).
- **The map rule (B10)** also refuses importing `lib/mapbox.js`'s default under another name. It flags the pre-fix
  Books-map file at its spread (`f906408`, line 974) and nothing else in it; today's tree: 0 flagged.
- **Help** (§G) ships with the server deploy, a few hours ahead of the phone update rather than after it — the article
  only explains a banner, and names nothing a phone without it would miss.
- **Review round 1 (three reviewers: error mechanics, app integration, server/tests/docs) — fixed:**
  - The restart rule now waits until no save is in flight and the session store is idle *at the same moment*, and
    re-checks for a save in the same step as the reload (a door recorded from the map during the session wait could
    otherwise have been reloaded over — a regression against the old update banner). Three new tests.
  - `takeover` is no longer sticky — true only on the report that escalated. Before, errors landing during Reset's
    storage writes could leave it true, and one later error, even on a door, would take over. Reset now clears the
    store right before the screens come back.
  - A screen whose code fails to load: Metro reports that error through the global handler (now caught), and the route
    then crashes on the empty module. The crash screen shows the caught error as *Just before* when it landed less
    than two seconds earlier, so a screenshot names the real cause. It also reads the stack through `normalizeError`.
  - The crash screens' warning about what Restart costs re-renders when a sign-out is queued after the screen came up
    (`usePendingSessionAction` replaces `hasQueuedSignOut()`), with words that follow the reason.
  - The banner: a refusal's reason gets two lines and also shows in Details (opening Details no longer clears it); the
    shadow moved to an outer view, since iOS drops a shadow on a clipping view.
  - The switch reached open phones only every four hours, and a tick that landed while the phone was locked was
    skipped: UpdateGate's query now also re-asks whenever Doorline comes back to the screen, at most once every 15
    minutes (it overrides the app-wide `refetchOnWindowFocus: false`; a crew behind one venue IP stays far under the
    route's 300-per-15-minutes limit).
  - The map rule also flags optional chaining (`?.`) values, follows `const` aliases of the library, and refuses
    `require`, named and namespace imports.
  - Docs: the switch's scope (the catching of errors, not the boundaries) and its timing, the full crash screen's
    two triggers, the support address (hello@doorline.app), the rollout's raise and undo commands; the Help article's
    bullets are one line each (the help parser reads one-line list items; a wrapped one became a stray paragraph —
    an existing limit that affects other articles too).
- **Review round 2 — fixed:** the Help article's support address is plain text (both Help renderers treat any link
  that isn't `http` as an article slug, so a `mailto:` link opened "not found"); its title is *The phone app says
  "Something went wrong" — did I lose anything?* (the web console's own crash page also says "Something went wrong");
  CANVASSER_APP Part 1 names both triggers of the full crash screen; smaller doc corrections. `NoticeBoundary` resets
  through `getDerivedStateFromProps` (B3 says `componentDidUpdate`; same behavior, no extra render).
- **Review round 2 (three reviewers: the round-1 fixes, end-to-end scenarios, docs against code) — fixed:**
  - **The reload can wait** in expo-updates' serial queue behind an update check or download (Android
    `EnabledUpdatesController.kt` + `StateMachineSerialExecutorQueue.kt`; iOS `EnabledAppController.swift`) — a
    minute on a weak signal — while the app stays usable, so a door opened or a knock tapped meanwhile could be cut off
    (true of the update banner before this change too). `components/RestartCover.jsx` now covers the app with
    *Restarting Doorline…* from the moment the reload is asked for until it happens (`reloadPending` in
    `lib/appRestart.js`, raised by `restartPolicy`'s new `onReloadStart`, lowered by `onReloadFailed`); Reset is
    disabled meanwhile; SessionGate's queued sign-out waits for it; after 10 s and 60 s it says why and what to do.
  - The re-wait path for replaced session work yields one poll and respects the deadline (it could spin on
    microtasks); the bound uses a monotonic clock.
  - The build-status check's 15-minute spacing now holds for failures too (with no answer yet, query-core counts the
    query as stale forever, so every unlock refetched).
  - The store-update **hard wall waits until the person is off a door or a survey** — the focus re-check made it far
    likelier to land on a door.
  - Crash screens warn about any pending password screen (a reset password signs the phone out after the reload).
  - Details' door advice and the Help article say to close and reopen Doorline when Restart isn't offered; the
    "still saving" refusal says the same if it keeps happening (a save that can never finish would otherwise block
    every Restart).
  - The banner is an Android live region for the first error only; a refusal's reason gets three lines and clears on
    navigation; "Just before" ignores a clock set back.
  - The map rule stops flagging defined fallbacks (`zoom ?? 14`, `a || DEFAULT`) and also follows `?.` and `=`
    aliases, refuses re-exports, and checks comma expressions.
  - A Help test now fails on any `mailto:`/`tel:` link (neither renderer can open one).
  - Not changed, recorded: Reset's `router.replace('/')` remounts the app frame (as the old crash screen's Reset did),
    so a dismissed update banner returns; super admins are told to send details to Doorline support; right after Reset
    an admin's Details line says "team lead or admin" until an organization is picked.
- **Review round 3 (two reviewers: the round-2 fixes, a fresh pass over everything) — fixed:**
  - SessionGate re-checks for a pending reload after its settle wait too, with no await before the sign-out takes the
    session lock — a sign-out could otherwise start just after the cover went up and be cut by the reload.
  - The build-status check's spacing keys off the error status: query-core marks a query invalidated on any failed
    fetch, even one with an older answer kept, so phones that had an answer re-asked on every unlock during an outage.
  - While the cover is up, the navigator is hidden from screen readers and the other overlays (the error banner, the
    update banner, the store wall, the session screens) step aside: on Android a TalkBack double-tap reaches a view
    without a touch, so the cover alone couldn't stop it. The cover takes screen-reader focus and swallows Android Back.
  - A second Restart while a reload already waits joins it (`reloadAlreadyPending`) instead of queueing another, and
    the crash screen's Restart shows *Restarting…* for a reload another button asked for.
  - The "still saving" refusal is short again; its "close and reopen if it keeps happening" hint shows in Details and on
    the crash screens, where there is room.
  - The map rule's header now says exactly what it checks; it also refuses exporting the `Mapbox` binding,
    re-exporting lib/mapbox's default, and require()/import() of lib/mapbox. The Help link test catches links with
    spaces.
  - Device check 14a covers the cover.
  - From the final fresh pass: a crash-screen Restart joins a waiting reload *before* running the held-back sign-out
    (it could otherwise start under the reload); each Restart button drops its own "Restarting…" once the shared
    `reloadPending` takes over, so a joined reload that fails leaves the buttons ready; the error store also clears at
    the next sign-in after a sign-out (an error can land on the sign-in screen); OPERATIONS.md says a phone sitting on
    a crash screen doesn't re-check the switch until its Restart or Reset (UpdateGate is inside the boundary).
  - Not changed, recorded: the three `#history--who-changed-what` links in `guides/campaigns-manage.md` land on the
    Help index on both clients (both renderers treat `#` as a slug) — they predate this change.
- **Part B (B12) and its device gates 15–17 are not built.**


## A. How an error reaches the screen today (verified)

**A1. A JavaScript error escaping a task** (both platforms; intercepted by this plan).

1. The bridgeless scheduler runs event dispatch, timers, `requestAnimationFrame` (a `setTimeout(0)`,
   `TimerManager.cpp:386-393`), `requestIdleCallback`, `queueMicrotask`/`setImmediate`, `RCTDeviceEventEmitter`
   listeners (AppState, Linking, Dimensions) and TurboModule callbacks (Alert buttons) as tasks. A task's `jsi::JSError`
   — or a native exception thrown inside the task, wrapped as `"Non-js exception: …"` — is caught in the loop
   (`ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp:374-387`, microtasks `:414-427`) and
   handed to the task-error callbacks (`ReactCommon/react/runtime/ReactInstance.cpp:108-113`, `:142-147`) →
   `JsErrorHandler::handleError(runtime, error, true)`. The loop keeps running. React's event dispatch catches a
   listener's error (`Libraries/Renderer/implementations/ReactFabric-prod.js:299-307`), resets its state and rethrows
   after the batch (`:1562-1565`), so an `onPress` throw takes this path.
2. With `useAlwaysAvailableJSErrorHandling` off (default `false`,
   `ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h:230-232`; no override in Expo, the new-architecture
   defaults or `RCTReactNativeFactory.mm`) and the runtime ready, `handleError` calls `handleJSError`
   (`ReactCommon/jserrorhandler/JsErrorHandler.cpp:228-253`; it returns as soon as the JS handler returns, `:236-241`)
   → JS `ErrorUtils.reportFatalError(error)` (`ReactCommon/cxxreact/ErrorUtils.h:15-38`) → the global handler with
   `(error, true)` (`…/@react-native/js-polyfills/error-guard.js:38-50`; `globalThis.ErrorUtils` is set at `:121`).
3. The installed chain in a release build is expo-router's splash wrapper (hides the splash, passes `(error, isFatal)`
   through unchanged — `expo-router/build/utils/splash.js:31-42`) and React Native's default
   (`Libraries/Core/setUpErrorHandling.js:33`). The wrapper is installed from a `setTimeout`
   (`expo-router/build/renderRootComponent.js:82-84`), so its order relative to ours is not guaranteed; either order
   works. Expo's own wrapper is Expo Go only (`expo/src/Expo.fx.tsx:23-27`).
4. The default calls `ExceptionsManager.handleException(e, true)`; `RN$handleException` returns `false` once the runtime
   is ready (`ReactInstance.cpp:494-498`), so JS reports it: `NativeExceptionsManager.reportException(data)` with
   `isFatal: true` (`Libraries/Core/ExceptionsManager.js:122-132`).
5. **Android:** `ExceptionsManagerModule.reportException` throws `JavascriptException(format(message, stack))`
   (`ReactAndroid/.../modules/core/ExceptionsManagerModule.kt:46-55`); the native-modules queue hands it to
   `ReactHostImpl.handleHostException` (`ReactHostImpl.kt:925`, `:661-671`), which asks the host delegate (A4), then
   **destroys the React host**. **iOS:** `RCTExceptionsManager` routes a fatal report to `RCTFatal`
   (`React/CoreModules/RCTExceptionsManager.mm:57-84`, `:158-159`), which raises in a release build
   (`React/Base/RCTAssert.m:122-150`) — the app closes. The iOS runtime uses the same C++ `ReactInstance` and
   `JsErrorHandler` (`RCTInstance.mm:286-296`), so a JS global handler intercepts identically on both.

**A2. Render errors.** React 19 reports through the root's callbacks
(`react-native/src/private/renderer/errorhandling/ErrorHandlers.js`): **caught** by an error boundary →
`ExceptionsManager.handleException(error, false)` (`:70`, a log line); **uncaught** →
`ExceptionsManager.handleException(error, true)` (`:63`) — **directly, not through `ErrorUtils`**, so a global handler
never sees it. Everything below `RootErrorBoundary` is caught today. `RootLayout` itself (its hooks at
`app/_layout.jsx:186-191`) and the providers and status bar it renders above the boundary (`:194-198`) are not. Before
any boundary sees a render error, React retries the whole root once synchronously and, if the retry succeeds, reports
the first error only as "recoverable" (`ReactFabric-prod.js:5401`, `:5409`, `:8928-8959`) — so only a render error that
throws again on the retry reaches a boundary.

**A3. Native exceptions — JavaScript never sees these** (Part B's class).
- A view-manager prop setter throwing during a mount, on the UI thread → `GuardedFrameCallback` → `handleHostException`
  (the Books map; `adb logcat` trace in PROPOSAL_BOOKS_MAP_GRAY_SCREEN.md §A).
- **Worklet errors in release builds.** The JS re-report (`react-native-worklets/lib/module/callGuard.js:17` →
  `errors.js:57-58`) is development-only; with `NDEBUG` the worklet is called with no guard
  (`Common/cpp/worklets/SharedItems/Serializable.h:28-36`). Android: `GuardedRunnable` →
  `BridgelessReactContext.handleException` → `handleHostException` (`AndroidUIScheduler.java:47`,
  `BridgelessReactContext.kt:153-155`). iOS: a C++ exception on the UI thread — a crash.
- Async TurboModule void methods that throw natively (Android `JavaTurboModule.cpp:807-846` → `handleHostException`;
  iOS `RCTTurboModule.mm:429-460` — a crash).
- An exception that escapes the scheduler loop itself (A6).

**A4. Why Android goes gray instead of crashing — and why "roll back a bad update" no longer applies.** In a release
build `handleHostException` calls the host delegate; `ExpoReactHostFactory.handleInstanceException` forwards to every
registered handler and rethrows **only when there are none** (`expo/android/.../ExpoReactHostFactory.kt:64-73`).
expo-updates registers one, first in line (priority 10, `expo-modules-core/.../ModulePriorities.kt:24`, sorted
descending `expo/.../ExpoModulesPackage.kt:26`). Its `onReactInstanceException` acts only while
`shouldHandleReactInstanceException` is true (`expo-updates/.../errorrecovery/ErrorRecovery.kt:56-60`): armed when the
host is created (`:47-50`, `:108-110`; reached once per process on Android from `onDidCreateDevSupportManager`,
`procedures/StartupProcedure.kt:219-223`, because the factory creates the host once, `ExpoReactHostFactory.kt:85-117`),
disarmed 10 seconds after the first content (`ErrorRecovery.kt:72-83`). After that it returns without rethrowing, the
host is destroyed, and the window shows its bare background: the gray screen, a live process, no crash report. **iOS
re-arms on every reload** (`RelaunchProcedure.swift:68-74` → `ErrorRecovery.swift:325-344`); Android does not
(`RelaunchProcedure.kt:80-90`).

"First content" comes almost at once: expo-router's outer `SafeAreaProvider` gets `initialMetrics` of `undefined` on
native (`expo-router/build/ExpoRoot.js:56-61`, `:79`), so it first renders an empty native `RNCSafeAreaProvider`
(`react-native-safe-area-context/src/SafeAreaContext.tsx:43-45`, `:92-97`) and `RootLayout` only renders after the
insets event (`ExpoRoot.js:146-148`). That empty view is the root's first child, which logs `CONTENT_APPEARED`
(`ReactRootView.java:464-467`). From then on expo-updates' pipeline is only "wait up to five seconds for a download,
then crash with the original exception" (`ErrorRecoveryHandler.kt:76-82` `retainAll(WAIT_FOR_REMOTE_UPDATE, CRASH)`,
`:138-149`, `:177-181`; iOS the same, `ErrorRecovery.swift:305-317`) and the launch is already marked successful —
**roll-back can only happen for a failure before that first frame.** Part A intercepts only once a crash-screen host
exists, which is after first content, so no roll-back safety net is lost. Inside the window, expo-updates' crash
carries the original exception: for a JavaScript error, its text.

**A5. Not fatal today, and unchanged by this plan:** promise rejections (tracking is on only in `__DEV__`,
`Libraries/Core/polyfillPromise.js:28-35`) — so a throw inside an `async` handler is silent, before and after; React
Query query and mutation errors (`app/_layout.jsx:132-141`); render errors caught by `RootErrorBoundary`; and Expo
Modules event listeners (expo-location's `watchPositionAsync` among them), whose errors are reported **non-fatal**
(`expo-modules-core/common/cpp/EventEmitter.cpp:56-63`, `:80-86` → `ErrorUtils.reportError`), from a `noexcept` frame
(`:43`).

**A6. What an intercepted error leaves behind — and the one kind that must not be intercepted.**
- After a listener throws, Fabric drops the rest of that event batch and skips its cleanup (`EventQueueProcessor.cpp:28-122`
  — the loop `:41-108`, the conclusion `:111`, the target release `:117-121`; `UIManagerBinding.cpp:139-147`); a shared JS
  emitter skips every listener registered after the one that threw (`Libraries/vendor/emitter/EventEmitter.js:128-131` —
  this app has seven AppState `change` listeners); a throwing one-shot timer's closure is never freed
  (`TimerManager.cpp:211-217`); and a handler that set a busy flag before throwing stays latched (a door's outcome
  buttons: `household/[id].jsx:250-253`, `lib/recordAction.js:505`). The app keeps running but may be partly stuck —
  which is why the banner leads with **Restart**.
- **An exception that escapes the loop** (`ReactInstance.cpp:85-93`) leaves the scheduler stalled for good: `selectTask`
  clears `isEventLoopScheduled_` (`RuntimeScheduler_Modern.cpp:273-292`) and only an empty queue re-arms it (`:237`).
  These arrive as `"Non-js exception: …"` (for example "Hits microtasks retries bound.", `:432`). Today the teardown
  hides the stall; intercepting one would draw a banner over frozen JavaScript. The handler forwards every native-wrapped
  error (B1) — including the ones caught inside a task, which matches today.

**What this means:** A1 can be intercepted in JavaScript, on both platforms. A2 needs boundaries that wrap `RootLayout`
itself and each door. A3, A4 and A6's escapes can only be handled natively.

## B. Design

### B1. The global handler — `mobile/lib/errorRecovery.js` (new, pure, unit-tested)

One module owns "a JavaScript error escaped a tap, a timer, or a native callback": a store, a value normalizer, two pure
decisions, a handler factory and an idempotent installer. No React Native imports, so it runs under `npm run test:mobile`.

```js
// Five intercepted errors inside three seconds is a loop (a timer throwing on every tick, a screen re-firing a broken
// callback). A person retrying a broken button can reach it too — which is why a takeover never happens on a door
// (shouldTakeOver); there the banner just counts.
export const BURST_COUNT = 5;
export const BURST_WINDOW_MS = 3_000;
const MESSAGE_CAP = 4_000;
const STACK_CAP = 16_000;
// What C++ wraps a native exception in (RuntimeScheduler_Modern.cpp:385, :425; ReactInstance.cpp:89). Native state is
// unknown, and one that escaped the loop has stalled JavaScript — never intercept these.
const NATIVE_PREFIX = 'Non-js exception: ';

// Monotonic, so a wall-clock jump can't keep old errors "recent". Date.now() is for display only.
export const defaultNow = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

// Any thrown value → a real Error with string name/message/stack, capped. Every property read and every String()
// conversion happens inside its own try; `typeof` is the only unguarded check. A value with no usable message becomes
// "Unknown error (<typeof>)" — never "[object Object]". Never throws.
export const normalizeError = (value) => { … };

// 'forward' — hand to the previous handler (fatal → today's teardown on Android, crash on iOS)
// 'notice'  — keep running, show the banner
// 'escalate'— keep running, count it toward a takeover
export const decide = ({ isFatal, isDev, hasHost, message, recent, now }) => {
  if (isDev || !isFatal || !hasHost || message.startsWith(NATIVE_PREFIX)) return 'forward';
  const inWindow = recent.filter((t) => now - t < BURST_WINDOW_MS).length + 1;
  return inWindow >= BURST_COUNT ? 'escalate' : 'notice';
};

// The crash screen takes over only on an escalate decided while the person is OFF a door. Nothing is sticky: a loop
// that is still running when they leave the door escalates again on its next tick (recent is kept — so one more error
// within three seconds of a burst on a door, once off it, counts as the same loop), and a burst that has stopped never
// takes over later.
export const shouldTakeOver = ({ decision, inDoorFlow }) => decision === 'escalate' && !inDoorFlow;
```

The handler:

```js
const fallbackError = () => new Error('Unknown error');

export const createGlobalHandler = ({ previous, store, isDev, now = defaultNow }) => (value, isFatal) => {
  let error;
  try { error = normalizeError(value); } catch { error = fallbackError(); }
  let decision = 'forward';
  try {
    decision = decide({ isFatal, isDev, hasHost: store.hasHost(), message: error.message,
      recent: store.recentTimes(), now: now() });
  } catch {
    decision = 'forward';
  }
  if (decision === 'forward') {
    // Passes the normalized copy. Fatal: today's path, unwrapped on purpose — if React Native's own report fails, its
    // C++ fallback must still end the session (a prototype of the release chain shows every forwarded fatal still
    // ending in a native fatal). Non-fatal: guarded — Expo's event emitter calls this from a noexcept frame.
    if (isFatal) return previous?.(error, true);
    try { previous?.(error, false); } catch { /* log line lost */ }
    return undefined;
  }
  try { previous?.(error, false); } catch { /* the device-log line only */ }
  try {
    store.report(error, { decision, at: now(), wallAt: Date.now() });
  } catch {
    try { previous?.(error, true); } catch { /* never throw from here */ }
  }
  return undefined;
};

let installed = false;
export const installGlobalErrorHandler = ({
  ErrorUtils = globalThis.ErrorUtils,
  isDev = typeof __DEV__ !== 'undefined' && __DEV__,
} = {}) => {
  if (installed || !ErrorUtils?.setGlobalHandler) return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler(createGlobalHandler({ previous, store: errorStore, isDev }));
};
export const _resetForTests = () => { installed = false; };
```

- **Forward in development** (red box stays), **forward non-fatal** (A5), **forward when no host is mounted** (nothing to
  draw on), **forward native-wrapped errors** (A6).
- **Otherwise intercept:** the previous handler gets `(error, false)` — the device-log line (Android `FLog.e`, tag
  `ReactNative`, `ExceptionsManagerModule.kt:56-59`; iOS the `console.error` line, `ExceptionsManager.js:104-109`)
  without the teardown — and the store records it. This leaves React Native consistent: `RN$notifyOfFatalException` is
  never called, `_hasHandledFatalError` is untouched (`JsErrorHandler.cpp:394-403`), and `inExceptionHandler` prevents a
  `console.error` loop (`ExceptionsManager.js:188`).
- **Never throws on the intercept path** — verified with a prototype against a port of the release chain: sixteen
  hostile values (a Proxy that throws on every read, a throwing `message` getter, a throwing `toString`, a Symbol,
  `Object.create(null)`, `undefined`, a 2 MB message, a cyclic object…), with expo-router's wrapper installed both
  before and after ours: no throw, no stall, one soft report each.

**The store** (`createErrorStore()`, singleton `errorStore`) follows `lib/sessionStore.js:41-47`'s rule: **one immutable
snapshot, replaced only when something changed**, with `getState()` returning the current reference. Snapshot:
`{ count, last: { name, message, stack, wallAt } | null, takeover }`. Methods:
- `subscribe(fn)` → unsubscribe; `getState()`.
- `report(error, { decision, at, wallAt })` appends `at` to `recent` and prunes it to the burst window, bumps `count`,
  replaces `last`, and sets `takeover` when `shouldTakeOver({ decision, inDoorFlow })` is true.
- `setInDoorFlow(bool)` — kept current by RootErrorBoundary's wrapper (B4); no emit.
- `dismiss()` — drops `last` and resets `count` (the in-app copy is gone; the device log keeps its own).
- `clear()` — resets the snapshot and `recent`; **never the host count**.
- `addHost()` → an idempotent release; `hasHost()`; `recentTimes()`.
- Emits only when the snapshot changes; every listener call is wrapped in `try`.

### B2. Where it is installed

`app/_layout.jsx`, module scope, beside `setSessionEndedHandler` (`:122`): `installGlobalErrorHandler();`. The root
layout's module evaluates during expo-router's first render, after the bundle has evaluated (`getRoutesCore.js:609-620`
via `router-store.js:141`). Errors while the bundle itself evaluates keep today's path.

Also in module scope: one `subscribeSession` listener (next to `:164`) that calls `errorStore.clear()` when the token goes
from a string to `null` (it is `undefined` until the session store hydrates, `lib/sessionStore.js:17`, `:115-123`), so
the next person to sign in never sees the previous person's error.

### B3. The banner — `mobile/components/ErrorNotice.jsx` (new)

- Mounted **inside `RootErrorBoundary`, last — after `<UpdateGate />`**. All root overlays share `zIndex`/`elevation`
  1000 and rely on render order; last means it is never hidden under UpdateGate's soft banner (`UpdateGate.jsx:100-124`,
  `:166-174`). It paints over the password screen (an absolute-fill view, not a Modal — `ReauthSheet.jsx:225-229`,
  `:329-334`), which is right if the password screen's own code is what failed, and — intentionally — over UpdateGate's
  hard wall: **✕** reveals the wall and **Restart** reloads into it. Being inside the boundary, it disappears with
  everything else when the crash screen takes over.
- **Structure.** `ErrorNotice` (a function component) holds the Details-open flag, the `restarting` flag and the outcome
  text, and renders its row and sheet inside `NoticeBoundary`, a small class boundary that renders `null` after an error
  and resets itself in `componentDidUpdate` when the store's `count` changes. Nothing is remounted on a normal update, so
  an open Details sheet stays open while errors keep arriving; a bug in the banner can never escalate, and the next error
  gets a fresh try.
- Reads the store with `useSyncExternalStore`. Shown while `last` is set; hidden while signing out (`ending`).
- **Placement: one row under the header row** — `top: insets.top + HEADER_CLEARANCE` (`HEADER_CLEARANCE = 56`), full width
  with side margins — so both top corners stay clear: the canvasser screens' drawer button is at the top right
  (`CanvasserHeader.jsx:15-17`, its only opener, `lib/DrawerContext.jsx:4-6`), the door's "‹ Map" and the survey's
  "‹ Back" at the top left (`household/[id].jsx:289-294`, `SurveyForm.jsx:538-543`). It covers the first content row
  until **✕** — measured: on the map and Books, the campaign/book card or the first notice row; on the admin home, the
  first content row; on a door, the address line (not the outcome buttons); on a survey, the voter card (not the first
  question); on the password screen, only the logo area. Nothing needed to act on the error is covered.
- **Contents:** the message — *"Something went wrong"*, or *"Something went wrong (3)"* when repeated — `numberOfLines={1}`,
  which is also the tap target that opens Details; then **Restart** and **✕** (`accessibilityLabel="Dismiss"`), each with
  a 44-point hit area. About 230 points wide, so it fits a 320-point screen. `accessibilityRole="alert"`,
  `accessibilityLiveRegion="polite"` on Android. Semantic tokens only (`colors.card`, `colors.border`, `colors.danger` for
  the accent bar, `type.*`). No timers: a restart outcome (B6) replaces the message text until the next tap on the
  banner or the next error.
- **Restart is hidden** in the door flow (`inCanvassFlow(pathname)`), while the password screen is pending (`reauth`), and
  when `Updates.isEnabled` is false.
- **Details** — an RN `Modal` (`onRequestClose` set), title *"What went wrong"*, selectable monospace fields: **When**
  (`new Date(wallAt).toLocaleString()`), **Version** (B9), **Error** (`name: message`), **Details** (the stack). Then:
  - *"Doors and surveys you already saved are safe."*
  - When the screen you're on as you open Details is in the door flow: *"If this door's buttons stopped working, go back to
    the map, restart Doorline and record the door again."* In Practice the survey: *"Nothing is saved in practice — go back
    and start again."*
  - *"If this keeps happening, screenshot this and send it to "* + *Doorline support* when
    `loadRoleContext().isConsoleUser` (read when the sheet opens; `lib/role.js:22-50`), otherwise *your team lead or admin*
    (also shown until the read resolves). (`useConsoleRole()` can't be used: it returns `'admin'` for canvassers and reads
    once, `lib/useConsoleRole.js:24-39`.)
  - **Restart Doorline** (same rule as the banner's) and **Close**.
- **Known limits, stated in the docs:** a root view can't paint over a React Native `Modal`, so an error from a tap inside a
  sheet shows its banner once the sheet closes; an error inside an `async` handler is a silent promise rejection (A5).

### B4. The crash screen — `mobile/components/RootErrorBoundary.jsx`

- Registers as a host on mount (`errorStore.addHost()`), releases on unmount; never remounted (a theme change only passes a
  new prop, `RootErrorBoundary.jsx:89-92`).
- The wrapper adds `usePathname()` (RootLayout already calls it through `useSessionCoverUp`, `:191`; expo-router drops the
  `(app)` group, so a door reads `/household/…`, a survey `/voter/…/survey`, practice `/survey-practice/…`, all matching
  `CANVASS_FLOW`, `lib/sessionEnd.js:86`) and calls `errorStore.setInDoorFlow(inCanvassFlow(pathname))` in an effect. The
  effect is exact, not a lag: in this bridgeless build a navigation is a synchronous update whose effects and follow-up
  sync work flush before any timer, native event or Alert callback can run (`setUpTimers.js:27`,
  `ReactFabric-prod.js:9752`, `:9805`; React Navigation 7 keeps its state in a `useSyncExternalStore` store), so no error
  can land between a door opening or closing and the flag changing. Don't "fix" it with a render-time ref.
- It subscribes to the store and takes over when `takeover` turns true — **only when no error is already shown**, so it
  never overwrites a render crash — rendering `last`, the error that escalated. Because `takeover` is only ever set by an
  escalate decided off a door (B1), the door-flow rule holds (`lib/sessionEnd.js:83-85`: nothing that would tear a door
  down runs while one is open). Once it has taken over it keeps the error in its own state, so a `clear()` during its own
  restart (B2's sign-out listener, B6 step 4) can't bring the screens back for a moment. Rendering the fallback unmounts
  every screen below it, which stops loops those screens own; loops owned by module scope or by `RootLayout` keep running
  behind it, and Restart is the fix for those. There is no way back to the screens except Restart or Reset (the root
  Stack's state is discarded on unmount).
- Renders from `normalizeError(error)` — `message || name` — plus the build line (B9). Subtitle on a takeover: *"Doorline
  kept hitting an error."*; on a render crash: *"This screen hit an error."* The existing *"Copy the details below — they
  pinpoint the cause."* becomes *"Take a screenshot of this screen — it tells Doorline what went wrong."*
- **Restart Doorline** (primary, `ReauthSheet.jsx:362-369`'s style) — *"Reopens Doorline in a few seconds."* When a
  sign-out is queued (`hasQueuedSignOut()`, B6) or the pending password screen's reason is `password_changed`, it adds
  *"You'll sign in again, and your houses download again — you need signal."* — calls B6 with `{ fromCrashScreen: true,
  beforeReload: runQueuedSessionAction }`; its outcome shows as one line under the button. **Reset & go home**
  (secondary, `:370-378`'s style) — *"Use this only if Restart brings you straight back here. You'll choose your
  organization and campaign again, and your houses download again, so you need signal. Saved work waiting to send is
  kept."* (What Reset does: `clearActiveOrgId` + `clearActiveCampaign` + `router.replace('/')`,
  `RootErrorBoundary.jsx:33-42` → the organization picker, `app/index.jsx:79-82`, whose pick clears the saved houses,
  `select-org.jsx:81-91`; the offline queue survives, `lib/offlineQueue.js:5`.) Reset calls `errorStore.clear()` before
  resetting its own state.

### B5. The outer frame — expo-router's `ErrorBoundary` export in `app/_layout.jsx`

expo-router wraps a route component in its `Try` boundary when the module exports `ErrorBoundary`
(`expo-router/build/useScreens.js:128-146`); the root layout is loaded the same way (`router-store.js:168`), so
`export const ErrorBoundary = ({ error, retry }) => …` in `app/_layout.jsx` catches errors in **RootLayout itself** — its
hooks and every provider it renders — which a boundary *inside* RootLayout cannot. `Try` hides the splash screen on error
(`views/Try.js:44-52`, `hideAsync` at `:46`) and is the only boundary in expo-router's tree.

It **always renders its screen** — no launch-time rethrow: by the time RootLayout can fail, first content has already
appeared (A4), so a rethrow could only crash the app (or, on Android after any restart, gray it) and send the error text to
Play; it could never roll anything back. The screen is the shared `CrashCard` (B13): *"Doorline hit a problem"*, the
message and build line, and **Restart Doorline** (B6 with `{ fromCrashScreen: true, beforeReload: runQueuedSessionAction }`,
the outcome under the button, B4's sign-in line when it applies). It sits inside expo-router's own `SafeAreaProvider`
(`ExpoRoot.js:74-83`) but above `ThemeProvider`, so it uses `buildTheme('light')` from `lib/theme.js:257-267` (`colors`,
`type`, `shadow`) and `useSafeAreaInsets`. It registers as a host in a `useLayoutEffect`, so there is no gap after
`RootErrorBoundary` unmounts, and it calls `disarmStagingCrash()` in a mount effect (B11).

### B6. One owner for restarting — `mobile/lib/restartPolicy.js` + `mobile/lib/appRestart.js` (new; moved from `OtaUpdatePrompt`)

`components/OtaUpdatePrompt.jsx:99-114` holds the rule: wait up to five seconds for in-flight saves, never reload over one,
never on a door screen. It moves into a pure `createRestart(deps)` in `lib/restartPolicy.js` (unit-tested with injected
`hasInFlightActions`, `sessionSettled`, `getSessionState`, `reloadAsync`, `now`, `sleep`), wired to the real modules in
`lib/appRestart.js` as `restartWhenSettled({ getPath, fromCrashScreen, beforeReload })`, returning
`'reloading' | 'saving' | 'door' | 'password' | 'failed'`:

1. **Wait, within one five-second bound,** for in-flight saves (the module-level lock, `lib/recordAction.js:198-204`) **and
   the session store**: a new `sessionSettled()` export from `lib/authState.js` returns the store's current chain promise
   (`sessionStore.js:112`); the policy races it against the time left and, if a different promise is current once it
   resolves (work queued during the wait), waits again while time remains. That lets a password change in progress
   (`rotateToken`, `sessionStore.js:206-216`, used by `profile.jsx:117` and `change-password.jsx:58`) or a sign-out mid-way
   (`signOutSteps`, `:85-96`, writes the null token before it clears the caches) finish first. Still busy, or `ending`:
   `'saving'`.
2. **Door:** `getPath()` — optional, read **after** the wait through a ref, as today — in the door flow: `'door'`.
3. **Password:** while the password screen is pending (`getSessionState().reauth`, including a collapsed one): `'password'`
   — its state lives only in memory (`sessionStore.js:36`), and a reload during an in-place password change turns the next
   `password_changed` 401 into a sign-out that deletes the saved houses (`app/_layout.jsx:104-121`, `lib/sessionEnd.js:64-68`;
   the server checks `password_changed` before expiry, `server/src/middleware/auth.js:78`, `:84`). **Skipped when
   `fromCrashScreen`:** the password screen is gone with the screens it covered, and the person's only other way out
   (force-closing) loses that memory the same way — B4's copy says what it costs.
4. **`beforeReload`** (the crash screens pass `runQueuedSessionAction`, a new `SessionGate.jsx` export alongside
   `hasQueuedSignOut()`): runs a queued deliberate sign-out (a password changed elsewhere, a deleted account — kept until
   it's safe, `SessionGate.jsx:29-38`) through `endSessionIfCurrent`, and resolves `'signed-out'` or `'none'`. It leaves a
   queued forced password change alone (that comes back on the first request after the reload). If it rejects, the reload
   still happens. The point is timing: the ended token is still stored, so the next answered request would queue the
   sign-out again anyway — running it now deletes the houses now rather than whenever the phone next has signal. After the
   reload the person lands on the sign-in screen without the usual "why" note (that note lives in memory,
   `login.jsx:42`, `sessionStore.js:35`) — rare, and stated in the docs.
5. `await reloadAsync()` in a `try`: `'reloading'` (it resolves before the reload tears JavaScript down,
   `expo-updates/build/Updates.js:150-154`, so callers keep showing "Restarting…") or `'failed'`.

The update banner passes its `pathnameRef` and maps every outcome other than `'reloading'` to its existing silent reset (it
re-offers later, as today); the error banner passes a ref to its pathname; the crash screen and B5's screen pass none, with
`fromCrashScreen`. `sessionPath` is never used: SessionGate is unmounted under the crash screen, so it would freeze at the
crashed door's path. Callers keep their own `restarting` guard, label and an alive ref. Copy: `'saving'` → *"Still saving —
try again in a moment."*; `'door'` → *"Finish this door first."*; `'password'` → *"Enter your password first, then
restart."*; `'failed'` → *"Couldn't restart — close and reopen Doorline."* Restart only appears when `Updates.isEnabled`
(false in development and Expo Go, true on every store and staging build).

### B7. Time zones — `mobile/lib/timeZone.js` (new)

`safeTimeZone(tz)`: empty input returns as-is; otherwise the name is checked once with
`new Intl.DateTimeFormat('en-US', { timeZone: tz })`, the verdict cached per name, and an unknown name falls back to the
device's IANA zone name (`Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`, so the zone label still prints) with
one `console.warn`. Hermes throws `RangeError: Incorrect timeZone information provided` for an unknown name (checked with
the 0.81.5 `hermes` binary); Node says `Invalid time zone specified`, so tests check the fallback, never the text. Same
precedent as `lib/electionDates.js:5-13`. Applied at every campaign-zone formatter, importing `./timeZone.js` **with the
extension** (Node's loader runs `dateRanges.test.js` and refuses extensionless imports): `lib/dateRanges.js:19-26`
(`todayInTz`, behind `rangeFor`, `quickRangeFor`, `useTodayInTz` and three direct callers), `lib/datetime.js:19-27`
(`formatInTz` and its label), `:45-59` (`formatExact`), `:64-87` (`formatRange`); `tzAbbrev` and `electionDates` already
guard themselves. `_resetTimeZoneCache()` keeps tests order-independent. Exposure is small (eight curated zones on write,
`server/src/routes/admin/campaigns.js:92`, `:447`, `:562`; `migrate:timezones` backfilled the rest), so this is internal
hardening, not user-facing copy.

### B8. Camera inputs — the two tap-time calls

`lib/mapCamera.js` exports its `isPoint` (`:9-10`; stricter than turf, which accepts numeric strings).
`app/(app)/map.jsx:751` flies only when `isPoint(coords)`; `app/(app)/admin/map.jsx:1141-1145` (`enterMoveMode`, also
reached from Alert buttons at `:1179-1180`) centers only when both coordinates are finite — move mode still opens, it just
doesn't recenter. Every other camera call runs in an effect, after an `await`, or as a render-time prop.

### B9. Shared build line — `mobile/lib/buildInfo.js` (from the GPS plan's M1)

The GPS plan's M1 creates `mobile/lib/buildInfo.js` and `buildInfo.test.js`, lifting `app/(app)/profile.jsx:144-151`'s build
line into a pure function (PROPOSAL_GPS_UPGRADES.md G.3, `:1285-1286`), but names no signature. This plan fixes it, and the
edit to the GPS plan's G.3 lands with this plan's docs commit, before M1 is built: `export const buildLine = ({
runtimeVersion, channel, isEmbeddedLaunch, updateId, createdAt } = {}, formatDate = (d) => d.toLocaleString()) => …`
returning exactly the string `profile.jsx:144-151` builds today; callers pass `buildLine(Updates)`, tests inject
`formatDate`. Part A uses it on the banner's Details, the crash screen and `CrashCard`. If M1 ships a different signature
anyway, Part A calls what M1 exports; if M1 is pulled first, Part A adds the file with this signature. Hermes release stacks
are bytecode offsets, so the update id is what makes a screenshot useful.

### B10. The rule, enforced — `mobile/lib/nativeProps.test.js` (new)

A unit test that parses every `.js`/`.jsx` under `mobile/app` and `mobile/components` with `@babel/parser`
(`{ sourceType: 'module', plugins: ['jsx'] }`) and fails on any `Mapbox.*` element with:
- an attribute whose value is a **logical** expression (`a && b`, `a || b`, `a ?? b`) or a **`void`** expression;
- an attribute whose value is a **conditional with a branch that is** `undefined`, a `NullLiteral`, `void …` or a logical
  expression (checked through nested conditionals) — a conditional between two defined values, like the GPS plan's
  `pulsing={grey ? PUCK_PULSING_OFF : PUCK_PULSING}`, is allowed;
- the identifier `undefined` or a `NullLiteral` as the value. A valueless attribute (`zoomEnabled`) has `value === null` in
  Babel's AST and is **not** flagged — sixteen exist today;
- a **spread attribute**, unless the opening tag's range contains a comment `native-props-ok: <test file>` — a block comment
  between attributes (`/* native-props-ok: puckLook.test.js */`) or a line comment inside a multi-line tag; `{/* … */}` is
  a syntax error there. The test scans `ast.comments` inside the tag's range and requires the named test file to exist.

Conditionally mounting a whole element stays allowed; nested values (inside `style={{…}}` or a `filter` array) are not
checked. It also asserts that every file importing `@rnmapbox/maps` uses exactly `import Mapbox from '@rnmapbox/maps'` (no
named imports), that the scan found map elements (no pinned counts — B11 adds some), and — to prove it is discriminative —
that it flags an inlined copy of the pre-fix `app/(app)/admin/books.jsx` door-dots source (`f906408`, `:972-977`), a
`shape={x ? y : undefined}` fixture and an unmarked spread, and passes a conditionally mounted source and the GPS plan's
marked puck. Calibrated on today's tree: 124 files, 82 map elements, 0 flagged. It cannot see a variable that becomes
`undefined`; Part B is the backstop for that.

**CI:** the mobile tests run in CI with no mobile install (`.github/workflows/tests.yml:60-64`: "import nothing outside
mobile/lib and no npm package"). `@babel/parser` therefore becomes a root devDependency pinned to exactly `7.29.7` (the
version in `mobile/node_modules`; the root's only other devDependency is `concurrently`), the job gains a root `npm ci` step
before `npm run test:mobile` with `package-lock.json` added to `cache-dependency-path`, and the workflow comment says so.
Node resolves it from the root install in CI and from `mobile/node_modules` locally. The root is not a mobile fingerprint
input; Heroku's root `npm ci` installs and then prunes it, and `heroku-postbuild` and the web build are untouched. The
lockfile's root name is rewritten from "canvass-app" to "doorline" on that install — harmless.

### B11. Staging-only test rows — `mobile/components/ErrorRecoveryTests.jsx` (new), on the Profile screen

Long-pressing the build line (rendered at `profile.jsx:324`) reveals a list of rows **only when `Updates.channel ===
'staging'`** (TestFlight and Play internal; `eas.json`'s staging profile sets the channel). On production builds the
long-press is not attached and the component is **never loaded** — `profile.jsx` `require`s it inside the staging branch,
so its module-scope `initMapbox()` never runs there. Every timer starts from a tap. Plain `Pressable` rows (an Android Alert
keeps only three buttons, `Alert.js:96-101`, and Alert callbacks take a different path than real taps):

- **Tap error** — a synchronous throw in `onPress` (React's dispatch path).
- **Repeated errors** — a component-owned `setInterval` every 300 ms that throws, cleared in its effect cleanup: the
  takeover, and that it stops once the crash screen is up.
- **Delayed error** — a module-scope 20-second `setTimeout` (a component timer would be cleared when Profile is left —
  `app/(app)/_layout.jsx:28-47` is one Stack): open a door meanwhile; the banner shows no Restart, and Details shows the door
  line.
- **Burst on a door** — module-scope: 15 seconds after the tap, six throws 200 ms apart. On a door: the banner only; leave
  it afterwards: still the banner. Off a door: the crash screen.
- **Keep looping** — module-scope: 15 seconds after the tap, a `setInterval` every 300 ms that throws until the app
  restarts. On a door: the banner only; back on the map, the crash screen within a tick.
- **Error in a sheet** — an RN `Modal` whose button throws: the banner appears when it closes.
- **Ask for password** — `requireReauthIfCurrent({ reason: 'expired', token: getCurrentToken() })` (`lib/authState.js:51`,
  `:59`): the password screen over Profile, for gate 7 without a short-lived server token.
- **Crash the next door**, **Crash the next survey**, **Crash the next practice survey**, **Crash the app frame** — arm
  `lib/stagingCrash.js` (new) for `'household'`, `'survey'`, `'practice'` or `'root'`. `armStagingCrash(target)` does nothing
  unless `Updates.channel === 'staging'` (fixed for the life of the app). `useStagingCrash(target)` — an unconditional
  `useSyncExternalStore` subscription, the **first statement** in `RootLayout` and in each door route (before their early
  returns: `household/[id].jsx:231`, `voter/[id]/survey.jsx:88`, `:100`, `survey-practice/[surveyId].jsx:28`) — **throws on
  every render while armed** for its target. It must not disarm itself: React retries a failed render once synchronously and
  would commit the clean retry, reporting the error only as "recoverable" (A2; reproduced with React's production renderer
  in Node). `disarmStagingCrash()` is called from a mount effect in `CrashCard` (B13's card and B5's screen), so it disarms
  only once the boundary has caught it. Production cost: one subscription per mounted route.
- **Native failure (Android only)** — mounts a 1×1 map with a `CircleLayer` whose `minZoomLevel` is then removed
  (`minZoomLevel={zoom}`, `zoom` set to `undefined`). The component file calls `initMapbox()` at module scope (leaf routes
  load lazily, and a map without a token fails differently, `lib/mapbox.js:27-35`). The manager calls `asDouble()` on null
  (`RNMBXCircleLayerManager.kt:51-54`) on the UI thread before the style even loads — the real A3 path. Before Part B: the
  gray screen. After: a crash. Hidden on iOS (a null there is silently ignored). A comment marks it as the one deliberate
  violation of B10's rule, which can't see it by design (it is a variable).

### B12. Part B — the Android host-failure handler: `mobile/modules/host-failure/` (new local module)

Autolinked from `./modules` by default (`expo-modules-autolinking/build/commands/autolinkingOptions.js:162-164`). A `Package`
is discovered only in a file whose name ends `Package.kt` that literally imports `expo.modules.core.interfaces.Package`
(`build/platforms/android/android.js:173-192`), so the class lives in `HostFailurePackage.kt` with an explicit import. Files:

- `expo-module.config.json`: `{ "platforms": ["android"] }` — accepted with no `android.modules`; iOS ignores it
  (`ExpoModuleConfig.js:51-69`) and its fingerprint does not move.
- `android/build.gradle` (the plugin publishes by default and requires `namespace` and `versionName`):

  ```gradle
  plugins { id 'com.android.library'; id 'expo-module-gradle-plugin' }
  group = 'expo.modules.hostfailure'
  version = '1.0.0'
  android {
    namespace "expo.modules.hostfailure"
    defaultConfig { versionCode 1; versionName '1.0.0' }
  }
  // expo-modules-core keeps React Native as `implementation`, so ReactMarker needs it here; React Native's Gradle plugin
  // supplies the version (as for expo-updates and expo-splash-screen).
  dependencies { implementation "com.facebook.react:react-android" }
  ```
- `android/src/main/AndroidManifest.xml`: `<manifest>\n</manifest>` (as expo-secure-store has).
- `android/src/main/java/expo/modules/hostfailure/HostFailurePackage.kt` — no JavaScript, no Expo Module.

```kotlin
package expo.modules.hostfailure

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.facebook.react.bridge.ReactMarker
import com.facebook.react.bridge.ReactMarkerConstants
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.util.concurrent.atomic.AtomicBoolean

class HostFailurePackage : Package {
  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    listOf(HostFailureHandler)
}

// expo-updates handles a React host exception only until 10 s after the FIRST content of the process
// (ErrorRecovery.kt:56-60, :72-83). Past that it returns without rethrowing, the host is destroyed, and Android shows a
// gray window over a live process. Inside its window, once content has appeared, it can only wait up to 5 s for a
// download and then crash (ErrorRecoveryHandler.kt:76-82, :138-149). This turns every host failure after first content
// into an ordinary crash: the person reopens the app, and Play's crash list sees it.
object HostFailureHandler : ReactNativeHostHandler {
  private const val TAG = "HostFailure"
  private const val EXPO_UPDATES_WINDOW_MS = 10_000L // ErrorRecovery.kt:83 — re-check on every expo-updates upgrade
  private const val EXPO_UPDATES_GRACE_MS = 6_000L   // its 5 s download wait (ErrorRecoveryHandler.kt:184) + 1 s
  @Volatile private var firstContentAt = 0L
  private val crashing = AtomicBoolean(false)
  private val listener: ReactMarker.MarkerListener = ReactMarker.MarkerListener { name, _, _ ->
    if (name == ReactMarkerConstants.CONTENT_APPEARED && firstContentAt == 0L) {
      firstContentAt = SystemClock.uptimeMillis()
      ReactMarker.removeListener(listener) // as ErrorRecovery.kt:75 does; listeners are a CopyOnWriteArrayList
    }
  }
  init { ReactMarker.addListener(listener) }

  override fun onReactInstanceException(useDeveloperSupport: Boolean, exception: Exception) {
    if (useDeveloperSupport) return
    val at = firstContentAt
    if (at == 0L) return // no content yet: expo-updates' window never closed, its pipeline owns this
    if (!crashing.compareAndSet(false, true)) return
    Log.e(TAG, "React host failed; crashing so the screen is not left blank", exception) // on-device log only
    val sinceContent = SystemClock.uptimeMillis() - at
    val delay = if (sinceContent >= EXPO_UPDATES_WINDOW_MS) 0L else EXPO_UPDATES_GRACE_MS
    // Posted, never thrown here: handleHostException can run inside a bolts continuation that swallows a synchronous
    // throw (Task.kt:323-326). Inside expo-updates' window its own crash comes first and this never runs.
    Handler(Looper.getMainLooper()).postDelayed({ throw HostFailureException.of(exception) }, delay)
  }
}

// What Play receives: each exception's class name and stack frames, cause chain included, so reports group by the real
// culprit (a prop setter sits in the cause of ViewManagersPropertyCache's wrapper) — never a message, which for a
// JavaScript error is the JS error text.
class HostFailureException private constructor(message: String, cause: Throwable?) : RuntimeException(message, cause) {
  companion object {
    fun of(t: Throwable): HostFailureException = copy(t, depth = 0)
    private fun copy(t: Throwable, depth: Int): HostFailureException {
      val inner = t.cause?.takeIf { depth < 8 && it !== t }?.let { copy(it, depth + 1) }
      return HostFailureException("React host failed: ${t.javaClass.name}", inner).also { it.stackTrace = t.stackTrace }
    }
  }
}
```

- `firstContentAt` never resets, matching Android's once-per-process window (A4): after an `Updates.reloadAsync()`
  expo-updates no longer handles anything, and this handler acts at once.
- `CONTENT_APPEARED` is logged per surface, and this app has one.
- Not compiled yet (no Kotlin compiler in the review environment); the GPS plan's J.10 step 5 is the first compile.
- **Remaining gap (exists today):** a failure before any content on an emergency launch (expo-updates skips
  `startMonitoring`, `StartupProcedure.kt:220-222`) still goes gray.

### B13. A door's own crash stays on the door — `ErrorBoundary` exports on the door routes, and `CrashCard`

A render crash inside a door today takes over the whole app (`RootErrorBoundary`). The same expo-router export as B5, on the
three door-flow routes, keeps it on that screen. Each route child of the `(app)` Stack goes through
`getQualifiedRouteComponent` → `fromImport` (`useScreens.js:128-147`, `:246-247`; native release builds import routes
synchronously, `babel-preset-expo/build/common.js:171-182`). Each export renders `components/CrashCard.jsx` (new, shared with
B5): the title, the message and build line (B9), *"Answers on this screen that weren't saved are gone. Doors and surveys you
already saved are safe."*, **Go back** (`router.canGoBack() ? router.back() : router.replace('/')`) and **Try again**
(`retry`, which re-renders once per tap). `CrashCard` calls `disarmStagingCrash()` in a mount effect (B11).

| Route | Title |
|---|---|
| `app/(app)/household/[id].jsx` | *"This door hit a problem."* |
| `app/(app)/voter/[id]/survey.jsx` (pushed from the door, `household/[id].jsx:437`, so Go back lands on the door) | *"This survey hit a problem."* |
| `app/(app)/survey-practice/[surveyId].jsx` | *"This practice survey hit a problem."* — plus B3's practice line |

Caught errors are logged as today (`ErrorHandlers.js:70`) and not added to the store (the card already shows them). The door's
busy flags die with the screen; the save lock is released by `submitPromise.finally(release)` (`recordAction.js:458`). No host
registration (RootErrorBoundary is the host).

## C. Alternatives rejected

| Alternative | Why not |
|---|---|
| A crash-reporting service (Sentry, Crashlytics, Bugsnag) | A new third party receiving customer-device data: a subprocessor change with DPA §6 notice, and it flips a recorded privacy negative. A separate decision if ever wanted. |
| Swallow fatal errors silently | Hides real bugs and leaves people on a half-working screen (A6) with no way out. |
| Reload the app automatically on every fatal error | Loses whatever was on screen, can loop, and breaks "restart is offered, never forced". |
| Forward fatal errors during expo-updates' window to keep its safety net | After first content — which comes before `RootLayout` even renders (A4) — its pipeline can only wait and crash. |
| v1's boundary inside `RootLayout`; v2's launch-time rethrow in B5 | The first can't catch `RootLayout`'s own hooks or hide the splash; the second rested on rolling back a bad update, which A4 shows is impossible by then. |
| v3's sticky escalation ("take over on leaving a door if an error is still recent") | A model of the rule showed it taking over after five human taps and a Back, after a single late error, and after a slow trickle. Replaced by "take over only on an escalate decided off a door" (B1). |
| A render-time ref for the door-flow flag | Not needed: the effect is exact in this build (B4). |
| Keep SessionGate running under the crash screen so the password screen can be used there | Couples the most minimal screen to the session UI and its navigation; B6's crash-screen path (run the queued sign-out, skip the password refusal, say what it costs) is safe without it. |
| On the crash screens, hide Restart while a changed-password screen is pending | Reopening starts a fresh process with no password-screen state, so the same 401 signs the person out anyway; it would only remove the in-app way out. |
| A "Go home" that skips Reset's org and campaign clear | Restart already reopens the app; a third button adds a choice without adding a way out. |
| Show the banner for non-fatal reports and unhandled promise rejections too | Rejection tracking in release would surface every fire-and-forget network failure — offline canvassers would see banners for nothing. Non-fatal reports are unchanged from today. |
| Tell taps from background errors with a touch timestamp | A root touch hook for a copy difference; Restart on the banner covers both. |
| ~~A server kill switch (a `buildStatus` flag the handler reads)~~ **Adopted 2026-10-15** | Rejected only for the post-election schedule; worth it for a pre-election release, where an OTA rollback reaches field phones only on a cold start or an accepted Restart. The owner moved Part A before Election Day, so it is built (§J-1, *As built*). |
| `RN$registerExceptionListener` (C++ listener hook) | Part of the C++ pipeline, which runs only before the runtime is ready or when the JS pipeline throws (`JsErrorHandler.cpp:241-252`). |
| v1's null-tolerant rnmapbox patch | Collides with the GPS plan's patch (same file, `postinstall`, and a test that counts its entries — PROPOSAL_GPS_UPGRADES.md §J.2); returning early on a null `shape`/`url` would leave a stale value that `makeSource()` restores on a style switch (`RNMBXShapeSource.kt:67-72`); `filter` and `styleURL` can never be null from JS (`filterUtils.ts:1-7`, `MapView.tsx:1218-1219`). B10 blocks the pattern and B12 turns a slip into a crash. Reported upstream instead. |
| An Expo Module to simulate a host failure | B11's map row reproduces the real path in JavaScript. |
| A staging crash hook that disarms itself when it throws | React's synchronous retry would commit the clean second render; the boundary would never show (A2). |
| Skip B10 when the parser isn't installed | Would make "an automatic check fails the tests" untrue in CI, the one place that runs every push. |
| Auto-restart instead of crashing in B12 | Possible (§J-4). Crashing is simpler, can't loop, and is the only way Play's crash list sees it. |
| Never escalate at all | A loop off the doors would keep every screen half-working with a climbing count; the crash screen unmounts the screens that own it. |

## D. Files and exact changes

| File | Part | Change |
|---|---|---|
| `mobile/lib/errorRecovery.js` (new) + `.test.js` | A | B1. |
| `mobile/app/_layout.jsx` | A | Install; session-clear listener; `export const ErrorBoundary` (B5); `<ErrorNotice />` last inside `RootErrorBoundary`; `useStagingCrash('root')` first. |
| `mobile/components/ErrorNotice.jsx` (new) | A | B3, with `NoticeBoundary`. |
| `mobile/components/RootErrorBoundary.jsx` | A | B4. |
| `mobile/components/CrashCard.jsx` (new) | A | B5's screen and B13's card. |
| `mobile/lib/restartPolicy.js` (new) + `.test.js`; `mobile/lib/appRestart.js` (new) | A | B6, moved from `OtaUpdatePrompt.jsx:99-114`. |
| `mobile/components/OtaUpdatePrompt.jsx` | A | Calls `restartWhenSettled`; maps every outcome but `'reloading'` to its existing silent reset; now also waits for the session store and refuses during a sign-out or a password screen that starts mid-wait; header comment points at `appRestart.js`. |
| `mobile/lib/authState.js` | A | Export `sessionSettled()`. |
| `mobile/components/SessionGate.jsx` | A | Export `runQueuedSessionAction()` and `hasQueuedSignOut()`; the comment at `:43` names `appRestart.js`. |
| `mobile/lib/timeZone.js` (new) + `.test.js`; `mobile/lib/dateRanges.js`, `mobile/lib/datetime.js` | A | B7. |
| `mobile/lib/mapCamera.js`; `mobile/app/(app)/map.jsx`, `mobile/app/(app)/admin/map.jsx` | A | B8. |
| `mobile/lib/buildInfo.js` (GPS M1's) | A | B9: used, not created (unless M1 is pulled). |
| `mobile/lib/nativeProps.test.js` (new); root `package.json` + `package-lock.json`; `.github/workflows/tests.yml` | A | B10 and its CI step. |
| `mobile/components/ErrorRecoveryTests.jsx` (new), `mobile/lib/stagingCrash.js` (new), `mobile/app/(app)/profile.jsx` | A | B11. |
| `mobile/app/(app)/household/[id].jsx`, `voter/[id]/survey.jsx`, `survey-practice/[surveyId].jsx` | A | B13's `ErrorBoundary` exports; `useStagingCrash(…)` first. |
| `mobile/lib/recordAction.js:200`, `mobile/lib/sessionEnd.js:83-85` | A | Comments that name OtaUpdatePrompt as the settle-rule owner now name `appRestart.js`. |
| `mobile/modules/host-failure/**` (new) | B | B12. |
| `docs/CANVASSER_APP.md` | A (+B) | Part 1 *When something goes wrong*; Part 2 *Error recovery*; `:644` (the settle rule now shared with the error surfaces); `:685` (no restart while the password screen is pending; the crash screens' exception and what it costs); *The update surfaces* (`:774-830`) names `appRestart.js`; *The profile screen* (`:832`) documents the build stamp, its shared module and the staging rows; *Files* (`:1604`). |
| `docs/ADMIN_APP.md` | A | A pointer to *Error recovery*. |
| `docs/TIMEZONES.md` | A | One line: the phone falls back to the device zone for an unknown name. |
| `docs/PROPOSAL_GPS_UPGRADES.md` | docs now; A, B | With this plan's docs commit: G.3 (`:1285-1286`) and the §M `buildInfo.test.js` row (`:2029`) get B9's `buildLine` signature; §F.1's puck code (`:1133-1134`) and the §M `puckLook.test.js` row (`:2028`) get B10's `native-props-ok:` marker. With Part B: J.1 (`:1545-1548`), J.10 step 2 (`:1796-1799`, Part A in "publish first", after M2), step 4 (`:1821-1825`), step 5 (`:1826-1840`, the first Kotlin compile and gate 15), step 9 (`:1861-1869`, gates 16–17), step 13 (`:1896-1898`), and the §N table: a row for Part A between M2 and N1, and the N1 row (`:2181`). |
| `server/src/content/help/faq/something-went-wrong.md` (new); `faq/app-asks-to-restart.md`, `faq/app-says-update-available.md` | A | §G — the new FAQ and the cross-links, committed only after Part A reaches every phone. *(As built: ships with the server deploy, ahead of the phone update.)* |
| `docs/PRIVACY_VERIFICATION.md` | A, B | The dated entry in §H. |
| `mobile/README.md` | A, B | *Reading it off a phone* (`:401-405`): the staging rows. Part B: hashed inputs (`:268-271`) gain `mobile/modules/*/android` and each module's `expo-module.config.json`. |
| `CLAUDE.md` | B | The same hashed-input line (Kotlin and module-config edits need four builds). |
| `docs/README.md` | docs now | This proposal's row. |

## E. Tests and device gates

**Unit (`npm run test:mobile`, root; 252 green today):**
- `errorRecovery.test.js`: `normalizeError` for an Error, `undefined`, `'text'`, a Symbol, `Object.create(null)`, a plain object
  and a cyclic object with no message ("Unknown error (object)"), a numeric message, a throwing `message` getter, a throwing
  `toString`, a Proxy that throws on every read, a 2 MB message (capped) — and the handler never throws for any of them.
  `decide` for development, non-fatal, no host, a `"Non-js exception: "` message, notice, the burst boundary (four inside
  three seconds → notice; the fifth → escalate; five spread over more than three seconds → notice). `shouldTakeOver` for each
  decision × door flag. `createGlobalHandler`: intercepted → previous called once with `false`, never `true`; forwarded fatal →
  `true`, unwrapped; forwarded non-fatal → a throwing previous is contained; a throwing store falls back without throwing. The
  store: `getState() === getState()`; identity changes after report, dismiss and clear; stored fields are strings; `recent`
  stays pruned; `takeover` set only off a door and never by a burst that ended on one; `dismiss()` drops `last`; `hasHost()`
  survives `clear()`; releasing a host twice is a no-op; no emit when nothing changed. `installGlobalErrorHandler` with a fake
  `ErrorUtils` (reset with `_resetForTests` between tests): wraps the existing handler, installs once.
- `restartPolicy.test.js`: each outcome; the five-second bound across saves and the session store together; new session work
  queued mid-wait is waited for; `fromCrashScreen` skips `'password'` and runs `beforeReload` first; a rejecting
  `beforeReload` still reloads; a rejecting `reloadAsync` → `'failed'`.
- `timeZone.test.js`: valid kept; unknown → the device's zone name, one warning (no error-text assertion); empty passes through.
- `nativeProps.test.js`: B10.

**Server (`npm --prefix server test`):** `test/helpLinks.test.js` validates the new FAQ's slug, title and links.

**CI:** the job's new root `npm ci` step and a green `npm run test:mobile` on the first push.

**Static:** esbuild parse of every changed screen and component.

**Device, staging lane — Android first, with the log running:**

```
~/Desktop/android/platform-tools/adb logcat -v time | grep -E "handleHostException|ReactNativeJS|ReactNative|AndroidRuntime|HostFailure"
```

All rows at least 15 seconds after a cold start.

1. **No-error smoke test first:** an online door result, a survey save, Add a person, and one door recorded in airplane mode
   and replayed — the banner must never appear.
2. **Tap error,** signed in as a canvasser: the banner under the header row, both top corners still usable; the app keeps
   working; the log shows a non-fatal report and **no** `handleHostException`. The message opens Details with the time and
   build line, and "send it to your team lead or admin". **Restart** reopens still signed in.
3. **Repeated errors:** the crash screen with **Restart Doorline** and **Reset & go home**; the log stops showing new errors
   once it is up; both buttons work.
4. **Delayed error**, with a door open: the banner without Restart; Details shows the door line.
5. **Burst on a door,** opened on a door: the banner only — on the door and after leaving it.
6. **Keep looping:** open a door within the 15 seconds — the banner only; back on the map, the crash screen within a tick.
7. **Password screen:** tap **Delayed error**, then **Ask for password** — when the error fires, the banner sits over the
   password screen with no Restart. Enter the password. Tap **Burst on a door** (off a door), then **Ask for password** — the
   crash screen appears; its Restart reloads without the "Enter your password first" refusal and reopens signed in (the
   server token is still valid, so no password screen follows).
8. **Error in a sheet:** nothing while the sheet is open; the banner when it closes.
9. **Crash the next door**, then open a door: the door card with its title, Go back and Try again. The same for **Crash the
   next survey** (open a survey from a door) and **Crash the next practice survey**. **Crash the app frame:** "Doorline hit a
   problem" with Restart.
10. Sign out with a banner up: it disappears and does not come back for the next sign-in.
11. The update banner still restarts (B6 regression): publish two staging updates in a row.
12. **Native failure (Android):** the gray screen, as today (`handleHostException`, no crash).
13. Once as a team lead or admin: steps 2 and 3, and Details names Doorline support.
14. iOS (TestFlight staging): steps 1–11 and 13; the app must never close.
14a. **The restarting cover (as built, round 2):** on a slow connection (Android emulator network throttling, or iOS
    Network Link Conditioner on "Very Bad Network"), background and foreground Doorline so its update check starts,
    then tap **Tap error** and the banner's **Restart** at once: *Restarting Doorline…* covers everything, taps and
    Android Back do nothing, TalkBack and VoiceOver land on the title and can't reach the app behind it, the 10-second
    line appears, and the app reopens when the check finishes. Repeat from a crash screen (**Repeated errors**): its
    Restart shows the same lines and **Reset & go home** is disabled meanwhile.

**Device, Part B build (Android):**

15. Before the build, from `mobile/` (read-only): `npx expo-modules-autolinking resolve -p android --json` lists `host-failure`
    with `sourceDir` `…/modules/host-failure/android`; `npx expo-modules-autolinking generate-package-list -p android
    --namespace expo.modules --target /tmp/EMPL.java` writes `new expo.modules.hostfailure.HostFailurePackage()`;
    `resolve -p apple --json` does not list it.
16. **Native failure** at least 15 seconds after a cold start: the app **closes** (no gray screen); the log shows `HostFailure`
    with the full original, then `FATAL EXCEPTION: main` with `HostFailureException` chains and no error text; reopening works.
17. Same, within ten seconds of launch: the app still closes (expo-updates' own crash, or this one six seconds later).

## F. Rollout

**Superseded 2026-10-15 for Part A — the owner's ruling: ship it now, with the kill switch.** The order is (1) deploy the
server and web from `main` so the switch exists before any phone runs the new code; (2) `npm run ota:staging` from
`mobile/` and the device gates (§E, the staging rows); (3) `npm run ota:production` from `main`, optionally
`npm run ota:production -- --rollout-percentage=20` first. If anything looks wrong: `MOBILE_ERROR_RECOVERY=off` (Heroku
dashboard, Settings ▸ Reveal Config Vars — phones take it when Doorline is opened or comes back to the screen, at most
once every 15 minutes, or within four hours while it stays on screen, and remember it),
then if needed republish the previous update (mobile/README.md → *Undoing an OTA*). The runbook is in
[OPERATIONS.md](OPERATIONS.md). Because the GPS plan's M1 is not built yet, Part A takes the staging channel and the
production queue first; M1's own window (its rules 3, 6, 7) starts after Part A is at 100 %. The original schedule is kept
below for the record.

**Part A — after Election Day, as its own step under the GPS plan's release rules** (PROPOSAL_GPS_UPGRADES.md §N rules 1–8).
Before Election Day there is no safe window: M1 holds the staging channel and the production queue until its 100 %
(rules 3, 6, 7; its checkpoints run to 2026-10-23, and M1 is not built yet), and nothing ships 2026-10-27 through 2026-11-04
(rule 8, D35). The incident that started this was Part B's class and is already fixed at its source; Part A's class has no
field incident yet. The order is M1, then M2 (from 2026-11-05, with its own staging and 20 % stage), then Part A, then N1 — so
"after Election Day" realistically means mid-to-late November.

1. **Built straight into the project folder only when its turn comes** (rule 1 — your ruling of 2026-10-05: no clones,
   worktrees or patch folders for building a step) — after M2 is at 100 % on both platforms, or dropped — and committed on its
   own. Nothing of Part A is in the folder before then: `git add -A` would sweep it into another step's commit, and uncommitted
   `mobile/` files ship with any publish (rule 2).
2. From `mobile/`: `npm run ota:staging` (note the Commit line, rule 3) → gates 1–14.
3. From `mobile/`, verbatim — the `--` is what passes the flag through to `eas update` (without it npm swallows it and the
   update goes to everyone):

   ```
   npm run ota:production -- --rollout-percentage=20
   ```

   Raise it with `eas update:edit <group id> --rollout-percentage 100`, or back out with
   `eas update:revert-update-rollout --group <group id>` — once per platform each (rule 6). The three to five named testers
   must confirm on their Profile build stamp that they have the new update (a 20 % rollout picks devices at random). With few
   field days after the election, the 20 % stage runs two days of the team's own use instead of one field day.
4. Help (the FAQ and its cross-links) is committed and the server deployed only after both platforms are at 100 % (rule 5).
5. Published before the native freeze (J.10 step 2's "everything the current fleet should get first"). Its slot pushes N1's
   build back by its duration (§J-8).

Expect fewer fatal-error reports in EAS's insights after Part A on iOS (intercepted errors no longer reach expo-updates' error
report) — not a regression.

**Part B** — native. It joins the GPS plan's app-store build and follows §J.10–J.11 and decisions D33/D34, including whatever
you decide for N1's build copies (rule 1 leaves `canvass-native` and `canvass-hotfix` as a question for you before N1); Part B
reaches `main` only after both stores accept; ordinary phone updates pause meanwhile; an urgent fix for the old fleet goes out
with `--build-ids`. Adding `modules/` moves the Android fingerprint (`mobile/scripts/ota-check.mjs:8-15`, `:57-82`; the module's
directory and the autolinking config are hashed, `@expo/fingerprint/build/sourcer/Expo.js:217-267`), so it must not reach
`main` earlier, or `ota:check` refuses every update to the phones in the field. After the stores serve the new builds, set
`MOBILE_CURRENT_RUNTIME_ANDROID` and `_IOS` to the runtime versions of **both** the staging and production builds (CLAUDE.md).
Building Part B alone is possible but not cheaper: an Android fingerprint change brings the same freeze and hotfix routine.

## G. Docs cascade

- `docs/CANVASSER_APP.md` as in §D. Part 1 *When something goes wrong* follows this document's Part 1: the banner and its place,
  Restart and when it isn't offered, the details and what to send, checking the door, the door rule and what to do when a door's
  buttons stop working, the door card, the crash screen, what its Restart can cost and what Reset costs, the outer-frame screen,
  the sheet and async limits, and "a gray screen until the app-store build: close and reopen". Part 2 *Error recovery*: B1–B13
  and A6's leftovers.
- Help Center: `faq/something-went-wrong.md` — `slug: something-went-wrong`, `title: The phone app says "Something went wrong" — did I
  lose anything?` (as built; the plan said "The app says"), `audience: all`, `kind: faq`, `order: 44.5` (`loadHelp.js:72` parses `Number(order)`, so it sorts right after
  the update FAQs at 43 and 44 for every role), `sourceDoc: CANVASSER_APP.md`, `summary: Usually nothing — doors and surveys you
  saved are safe. The thing you tapped may not have gone through, so check it, and restart Doorline if anything looks stuck.`,
  `tags: error, something went wrong, crashed, restart, stuck, frozen, gray, blank, closed`. Body, from Part 1: what the banner
  means; the thing you tapped may not have gone through, so check it; saved work is safe; when to Restart and why it isn't
  offered on a door or during the password screen; a door whose buttons stop working; the door card; the crash screen's two
  buttons, what Restart can cost and what Reset costs; "Doorline hit a problem"; a sheet's error shows when it closes; a gray
  screen or a closed app: reopen it; team leads: forward the screenshot with the time and what was tapped. The cross-link line in
  `app-asks-to-restart` and `app-says-update-available`: *"If the app says "Something went wrong" instead, see [this
  article](something-went-wrong)."* Committed after Part A reaches every phone. *(As built: ships with the server
  deploy, ahead of the phone update — see* As built*.)*
- The rest as in §D.

## H. Privacy

**No published sentence becomes false, and this is not a DPA §6 event** — Part A sends less off the phone than today, and Part B
adds no recipient: `client/public/privacy.html` already names Expo ("delivers updates to our mobile app", `:106`) and Apple and
Google (`:106`), and covers technical information collected to troubleshoot (`:97`); `docs/DPA.md:49` lists Expo and "Apple and
Google (mobile application distribution)".

**Part A is not privacy-affecting.** It keeps errors on the phone — the in-app copy until dismissed, sign-out or a restart, plus
the device log as today — and so **reduces** two flows that exist today and that the privacy record doesn't mention: (a) on iOS, a
fatal JS error ends in `RCTFatal`, whose exception name carries the JS message (`RCTExceptionsManager.mm:79-82`, `RCTAssert.m:133`,
`:147`) — Apple receives it from phones that share analytics; (b) inside expo-updates' error window, up to 1,024 characters of a
fatal error (on iOS, the message) go to Expo in the `Expo-Fatal-Error` header of the next update check (`FileDownloader.swift:303-308`;
Android from the emergency launcher, `FileDownloader.kt:536-543`), and every update check sends a per-install `EAS-Client-ID`
(`FileDownloader.swift:283`, `:299`; `FileDownloader.kt:426`, `:528`).

**Part B is treated as privacy-relevant** (CLAUDE.md's "when unsure" rule): a host failure after launch becomes an Android crash,
which Google Play receives from phones that share diagnostics, naming each exception's class and stack frames, never a message
(B12). Inside expo-updates' window, its own crash still rethrows the original exception — for a JavaScript error, its text — as it
does today.

**The entry for `PRIVACY_VERIFICATION.md`** (item 30, after item 29; stamp the G15 row 6 and the negatives at `:3754`, `:3765`):

> *[v6 <date> — Error recovery. No SDK, no new recipient; the "no crash-reporting" negative stands.]* Three platform paths already
> carry error data off the phone: (a) iOS `RCTFatal`'s exception name includes the JS message, received by Apple from phones that
> share analytics; (b) in expo-updates' error window (launch until 10 s after the first screen; on iOS again after every reload) up
> to 1,024 characters of a fatal error — on iOS including the message — go to Expo in the `Expo-Fatal-Error` header of the next
> update check, and every check sends a per-install `EAS-Client-ID`; (c) an Android crash reaches Google Play's vitals from phones
> that share diagnostics. Part A: a fatal JS error after launch stays on the phone (shown in the app until dismissed, sign-out or a
> restart, written to the device log), so (a) and (b) now occur only for launch-time, native-wrapped or no-screen errors. Part B: a
> host failure after launch becomes a crash naming each exception's class and stack frames, never its message; inside the window,
> expo-updates' own crash still rethrows the original. The Expo and Apple/Google sentences in `privacy.html` and DPA §6 stay true;
> no customer notice. Optional at the next policy revision: "…and, on phones whose owners allow it, send us crash reports."

Row 6 then reads "device IP, a per-install EAS-Client-ID, update metadata, and after an in-window fatal error up to 1,024
characters of it (the error text on iOS)". **The owner, before Part B's builds:** confirm these lines and check Play's Data safety
answers (not visible from the repository). No policy or DPA edit is needed.

## I. Upstream

- **rnmapbox/maps:** Android `Dynamic` setters call `asString()`/`asMap()`/`asArray()`/`asDouble()` before any null check, so a
  removed prop destroys the host; iOS `RNMBXMapView.layerAdded` is a `TODO`, so deferred `belowLayerID`/`aboveLayerID` never
  completes.
- **expo/expo (expo-updates):** in bridgeless mode `ErrorRecovery.onReactInstanceException` drops host exceptions after its
  window, and `ExpoReactHostFactory` rethrows only when no handler exists — every release app with expo-updates goes gray on
  Android instead of crashing.

## J. Decisions for the owner (recommended defaults in bold)

1. **Decided 2026-10-15: before Election Day, with the kill switch — built.** The original choice: Part A timing: **after Election Day, as its own step after M2, before the native freeze** vs. before Election Day — which
   means M1 drops out of its window (D35's fallback) and Part A adds a server kill switch: `routes/public/buildStatus.js` returns
   `errorRecovery: process.env.MOBILE_ERROR_RECOVERY !== 'off'`, UpdateGate's existing query feeds a persisted flag, `decide`
   forwards when it's off (about 40 lines plus tests; additive; `audit:mobile-api` flags it).
2. Escalation: **five errors within three seconds, and a takeover only when that happens off a door**.
3. **Restart on the banner itself**, hidden on doors and while the password screen is pending.
4. Part B on a host failure: **crash** (Play's crash list sees it, can't loop) vs. auto-restart (no crash entry). Crashes count
   toward Play's user-perceived crash rate (Play flags apps above about 1.09 %); gray screens never counted. With failures this
   rare the impact should be negligible.
5. **Include the staging-only test rows** (B11), including the deliberate native-failure row and the crash hooks.
6. **Keep the door-route boundaries** (B13).
7. **Keep the time-zone guard** (B7) — the lowest-value item; it can be dropped without touching the rest.
8. Part B timing: **ride the GPS plan's app-store build** (after Part A's slot, which pushes it back by about a week) vs. cut one
   sooner for this alone.

## K. Review log

**Round 1 (2026-10-14; three reviewers — the error mechanics, the app integration, the native part):**

| # | Finding | Verdict | Effect |
|---|---|---|---|
| 1 | An exception that escapes the scheduler loop stalls JavaScript for good; intercepting it would draw a banner over a frozen app. A strange thrown value could make React Native's own reporting throw and cascade into exactly that. | Confirmed (`RuntimeScheduler_Modern.cpp:237`, `:273-292`, `:432`; `ReactInstance.cpp:85-93`) | **Changed:** normalize first; `"Non-js exception: "` always forwarded; the intercept path can never throw. |
| 2 | An intercepted error can leave the app partly stuck. | Confirmed | **Changed:** Restart on the banner; A6. |
| 3 | Worklet errors re-report to JS only in development. | Confirmed | **Changed:** moved to A3. |
| 4 | expo-updates' arming and pipeline details; iOS re-arms per reload. | Confirmed | A4 corrected. |
| 5 | A boundary inside `RootLayout` can't catch its hooks or hide the splash. | Confirmed | **Changed:** expo-router's `ErrorBoundary` export (B5). |
| 6 | Store snapshot rules unspecified; no caps; no pruning. | Confirmed | **Changed:** B1's store. |
| 7 | Five in ten seconds escalates a person retrying on a door. | Confirmed | **Changed:** five in three seconds; never on a door (#26, #42). |
| 8 | The banner would paint over "Signing out…" and survive to the next session; UpdateGate's soft banner would cover it. | Confirmed | **Changed:** B2, B3. |
| 9 | A yes/no restart result loses "reload failed"; the crash screens can't use `sessionPath`. | Confirmed | **Changed:** B6. |
| 10 | The Alert test menu drops a button on Android and tests the wrong path. | Confirmed (`Alert.js:96-101`) | **Changed:** B11. |
| 11 | No banner over native Modals or for async handlers; copy overclaimed. | Confirmed | Limits stated. |
| 12 | Crash screens lacked the build line; "[object Object]"; escalation could overwrite a render crash. | Confirmed | **Changed:** B4, B9. |
| 13 | v1's rnmapbox patch collides with the GPS plan's, has wrong null semantics, patches never-null setters. | Confirmed | **Changed:** dropped. |
| 14 | `simulateHostFailure` wouldn't compile; a JS map row reproduces the real path. | Confirmed (`AppContext.kt:221`) | **Changed:** B11's map row. |
| 15 | `Package` discovery depends on the file name; the module needs `react-android`. | Confirmed (`android.js:173-192`) | **Changed:** B12 layout. |
| 16 | v1's handler left a 10–11 s gap. | Confirmed | **Changed:** B12 timing. |
| 17 | A synchronous throw in the host handler can be swallowed; expo-updates' handler always runs first. | Confirmed (`Task.kt:323-326`) | Comment corrected. |
| 18 | Part B's crash text would carry JS error text to Google. | Confirmed | **Changed:** class names and frames only. |
| 19 | Part B must follow the GPS plan's release rules. | Confirmed | §F. |
| 20 | Docs and Help cascade gaps. | Confirmed | §D, §G. |
| 21 | Expo Modules event listeners report non-fatal from a `noexcept` frame. | Confirmed | **Changed:** guarded non-fatal forward. |
| 22 | B7 covers every campaign-zone formatter. | Confirmed | Kept. |
| 23 | B8 found the only two tap-time camera calls. | Confirmed | Kept. |

**Round 2 (2026-10-14; two reviewers — a working prototype against a port of the release chain, and the plan as a product and
release decision):**

| # | Finding | Verdict | Effect |
|---|---|---|---|
| 24 | First content appears before `RootLayout` renders, so B5's launch-time rethrow could never roll back. | Confirmed (`ExpoRoot.js:56-61`, `:79`, `:146-148`; `SafeAreaContext.tsx:43-45`, `:92-97`; `ReactRootView.java:464-467`) | **Changed:** B5 always renders; A4 rewritten. |
| 25 | `normalizeError` was called unguarded; a Proxy can make it throw and stall the loop. | Confirmed (prototype) | **Changed:** guarded; hostile-value tests. |
| 26 | Escalating tears down a door; five taps in three seconds is humanly possible. | Confirmed (`SurveyForm.jsx:62`, `lib/sessionEnd.js:83-85`) | **Changed:** never on a door. |
| 27 | Restart over a pending password screen can turn an in-place password change into a sign-out that deletes the houses. | Confirmed (`lib/sessionStore.js:36`, `lib/sessionEnd.js:64-68`) | **Changed:** `'password'` outcome. |
| 28 | No pre-election window under the GPS plan's rules. | Confirmed (GPS §N rules 3, 5–8) | **Changed:** after Election Day; kill switch in §J-1. |
| 29 | The GPS plan's M1 creates the same `buildInfo.js`; B10 would reject its approved puck code; it doesn't know Part B rides its build. | Confirmed (GPS `:1285`, `:1133-1134`, `:1545-1548`, `:1821-1825`) | **Changed:** B9, B10, §D. |
| 30 | "Reset & go home — signs you out" is wrong. | Confirmed (`RootErrorBoundary.jsx:33-42`, `select-org.jsx:81-91`) | **Changed:** B4's copy. |
| 31 | The door copy can't be followed when the door's buttons are dead. | Confirmed (`household/[id].jsx:250-253`) | **Changed:** copy. |
| 32 | `clear()` read literally zeroes the hosts. | Confirmed (prototype) | **Changed:** never touches hosts. |
| 33 | Test rows: `initMapbox()`; component timers die with Profile; native row iOS. | Confirmed | **Changed:** B11. |
| 34 | Inside expo-updates' window its crash rethrows the original. | Confirmed (`ErrorRecoveryHandler.kt:177-181`) | Part 1 and §H. |
| 35 | B12's crash dropped the cause chain; a missing import. | Confirmed | **Changed:** message-less chain. |
| 36 | Part 1 overclaims. | Confirmed | **Changed:** Part 1. |
| 37 | The privacy record misses error data that already leaves the phone. | Confirmed (`FileDownloader.swift:283`, `:299`, `:307`) | **Changed:** §H entry. |
| 38 | Help only after every phone has Part A; FAQ placement. | Confirmed (GPS rule 5) | **Changed:** §F, §G. |
| 39 | A door's own render crash takes over the whole app. | Confirmed | **Added:** B13. |
| 40 | Smaller: monotonic time; normalized crash screens; `useLayoutEffect`; installer reset; the banner's boundary; Reset clears first; role-aware copy; the 15 s rule. | Confirmed | **Changed** throughout. |
| 41 | Holds: forwarding fatals unwrapped; the `"Non-js exception: "` rule; B12's 6-second logic; B5's `Try` wrapping; B6's move; B10's calibration. | Confirmed | — |

**Round 3 (2026-10-14; two reviewers — a state-machine model of the escalation and session rules, and an implementation-readiness
pass over every reference and API):**

| # | Finding | Verdict | Effect |
|---|---|---|---|
| 42 | v3's "take over on leaving a door if an error is still recent" took over after five taps then Back, after one late error, and after a slow trickle. | Confirmed (model) | **Changed:** `shouldTakeOver` — only an escalate decided off a door; nothing sticky. |
| 43 | The crash screens' `'password'` refusal pointed at a password screen that isn't there; a queued sign-out was dropped by a crash-screen restart. | Confirmed (`_layout.jsx:199-227`, `SessionGate.jsx:29`) | **Changed:** `fromCrashScreen` skips the refusal; `beforeReload` runs the queued sign-out. |
| 44 | B6 ignored the session lock (a password change in flight) and a sign-out mid-way. | Confirmed (`sessionStore.js:85-96`, `:206-216`) | **Changed:** waits for `sessionSettled()`; refuses while `ending`. |
| 45 | B10's test fails in CI, which has no mobile install. | Confirmed (`tests.yml:60-64`; reproduced) | **Changed:** root devDependency and a root `npm ci` step. |
| 46 | `useConsoleRole()` returns `'admin'` for canvassers. | Confirmed (`useConsoleRole.js:24-39`) | **Changed:** `loadRoleContext().isConsoleUser`. |
| 47 | The banner's "top-left clear" premise was wrong (the drawer button is top right) and the row didn't fit. | Confirmed (`CanvasserHeader.jsx:15-17`; measured) | **Changed:** under the header row; message as the Details target; two buttons. |
| 48 | The rollout command as worded publishes to 100 %. | Confirmed (npm 10.8.2 swallows the flag) | **Changed:** the verbatim command with `--`; raise and back-out commands. |
| 49 | B13's labels were wrong for two routes; no message or build line; untested. | Confirmed (`household/[id].jsx:437`) | **Changed:** per-route titles, Go back, message and build line; staging crash hooks. |
| 50 | ErrorNotice's mount point was ambiguous. | Confirmed | **Changed:** inside `RootErrorBoundary`. |
| 51 | "Kept in memory until dismissed" was false; the device log isn't cleared at sign-out. | Confirmed | **Changed:** `dismiss()` drops `last`; wording. |
| 52 | Details showed "the time" from a monotonic clock. | Confirmed | **Changed:** `wallAt`. |
| 53 | B11's component loaded on production builds. | Confirmed | **Changed:** required only on staging; timers start from taps. |
| 54 | Gate 13 used a command that never lists `Package` classes; gate 7 had no workable recipe. | Confirmed (scratch app roots) | **Changed:** gate 15; the "Ask for password" row. |
| 55 | B9's export had no signature; B12's `build.gradle` needs `namespace` and `versionName`; B7's imports need the `.js` extension; B10's valueless-attribute trap and marker syntax. | Confirmed | **Changed:** B7, B9, B10, B12. |
| 56 | Part 1 and the FAQ didn't match B13, Reset's cost, "check the door" and the lead's role. | Confirmed | **Changed:** Part 1, §G. |
| 57 | Reference corrections. | Confirmed | Fixed. |
| 58 | Holds: pathnames match `CANVASS_FLOW`; `getSessionState().reauth` is the right signal; A6's listener-skip; every other reference; the APIs; the unit tests run here; B12's module layout and fingerprint behavior. | Confirmed | — |

**Round 4 (2026-10-14; two reviewers — a final adversarial read that ran React's production renderer in Node, and a
verification of every round-3 fix and reference). Verdict: ready to build after these fixes:**

| # | Finding | Verdict | Effect |
|---|---|---|---|
| 59 | **Blocker:** a staging crash hook that disarms itself when it throws never reaches a boundary — React retries the render once synchronously and commits the clean retry. | Confirmed (`ReactFabric-prod.js:5401`, `:5409`, `:8928-8959`; reproduced in two harnesses) | **Changed:** throws on every render while armed; `CrashCard` disarms on mount (B11, B13). |
| 60 | The crash screen's "still signed in" is false when a queued sign-out runs or a changed-password screen was pending; step 4's reason overstated. | Confirmed (`login.jsx:42`, `sessionStore.js:35`, `_layout.jsx:104-121`) | **Changed:** B4's conditional line; B6 step 4 restated; Part 1. |
| 61 | §F's "separate branch or worktree" contradicts your 2026-10-05 ruling (GPS rule 1). | Confirmed (GPS `:2063-2066`) | **Changed:** built in the folder only at its turn; Part B follows your N1 decision. |
| 62 | Gates 6 and 7 couldn't be carried out (no start delay; the password screen covers the rows; the wrong expected result). | Confirmed (model) | **Changed:** 15 s start delay; gate 7's recipe. |
| 63 | `runQueuedSessionAction`'s contract, the session-settle race, the update banner's outcome mapping, the banner's remount on every error, the door line's timing, per-route crash targets, `canGoBack`, the device-zone fallback, a test for the restart policy, `CrashCard`, the GPS §N row for Part A. | Confirmed | **Changed:** B3, B6, B7, B11, B13, §D, §E. |
| 64 | Schedule realism (M1 not built; M2 from 11-05), FAQ order 45's tie, "or restart", reference nits (`Expo.js:217-267`, `babel-preset-expo/build/common.js`, `lib/DrawerContext.jsx`, `_layout.jsx:28-47`, `ota-check.mjs:57-82`, `role.js:22-50`, `ReauthSheet.jsx:370-378`, `Try.js:44-52`), the root's `concurrently`, pin `7.29.7`. | Confirmed | Fixed. |
| 65 | Holds: the door-flow effect is exact in bridgeless (no render-time ref needed); nothing outside the door flow holds typed field input; the banner covers nothing needed to act; the hooks' cost; the CI change leaves Heroku and the web build alone; every other reference; the round-3 fixes. | Confirmed | B4 says why the effect is exact. |

## L. Effort

*As built (Part A, 2026-10-15): seven new lib modules and tests (`errorRecovery`, `restartPolicy`, `appRestart`, `timeZone`,
`buildInfo`, `stagingCrash`, `nativeProps.test.js`), four new components (`ErrorNotice`, `CrashCard`, `CrashRestart`,
`ErrorRecoveryTests`) and the rewritten `RootErrorBoundary`, the server switch and its test, a root devDependency and a CI
step. The estimate below is the plan's.*

Part A: about 900 lines across five new lib modules (`errorRecovery`, `restartPolicy`, `appRestart`, `timeZone`, `stagingCrash`),
three new components (`ErrorNotice`, `CrashCard`, `ErrorRecoveryTests`) and eighteen edits, plus four test files and a CI step.
Part B: about 100 lines of Kotlin and configuration. The device gates are the long pole.
