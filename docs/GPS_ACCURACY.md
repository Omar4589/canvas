# GPS accuracy (the blue dot, the knock stamp, and "my dot is across the street")

Canvassers sometimes report that they are standing on a porch while their blue dot shows them across
the street. This doc answers that report end to end: what the dot is, how accurate a phone's location
really is next to houses, why the dot can be off while the recorded knock is still fine, which phone
settings matter, and how the audit's "far from house" rule tolerates it. It also records the 2026-10-03
audit of the whole location pipeline against what Google Maps and Apple Maps do, with the verified
findings, the non-issues, and the changes recommended from it.

- **Part 1 — For everyone** is plain language: what the dot can and cannot promise, why it drifts next
  to houses, what to tell a canvasser, and how leads should read a far flag.
- **Part 2 — Technical reference** is for developers (and Claude): the three readers of location on the
  phone, the exact OS requests each makes, what "accuracy" means on each platform, freshness bounds,
  thresholds, the audit's verified findings, the recommended changes by ship vehicle, and the rulings.

Related: [MAPS.md](MAPS.md) (the maps, pins, pings and how a knock becomes a ping),
[AUDIT.md](AUDIT.md) (the five GPS flags and the location-required gate),
[CANVASSER_APP.md](CANVASSER_APP.md) (the field app, including "Location is required"),
[PERFORMANCE.md](PERFORMANCE.md) (what runs while a screen is covered),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (§C9 and §C10: how location is collected, stored and
bounded).

---

# Part 1 — For everyone

## The short answer

Yes, it really happens, and it happens with the app working correctly. A phone does not know exactly
where it is. It knows a point and a radius it is only about two-thirds sure of. Under open sky that
radius is about 16 feet. Standing under a porch roof against a house wall, the phone sees half the sky
and hears satellite signals bouncing off the house, so the radius widens to tens of feet and the guess
is pushed away from the wall, usually toward the street. From a porch the far curb is only 50 to 70 feet
away. A fix that is 40 or 50 feet off therefore lands across the street some of the time. Google calls
"wrong side of the street" the biggest location error smartphones make in built-up areas.

The dot and the recorded knock come from the same place: the phone's own positioning engine, the one
Google Maps and Apple Maps also read. We ask it for the best it has. There is no accuracy setting left
to turn up. What those apps show that we do not is a visual cue for uncertainty: a light-blue circle
around the dot when the phone is unsure, and a grey dot when it has lost you. Our dot pulses the same
whether the phone is sure or not, which is why a porch fix across the street reads as "the app is
wrong" instead of "the GPS is unsure right here."

## What the blue dot is

The dot is drawn by the map engine itself from the phone's live position. It is drawn on your own
phone to help you navigate and is not sent to us unless you record something (that sentence is also in
the Privacy Policy). It eases to each new reading over about a second, so it trails you by a step while
you walk and takes a moment to settle when you stop.

The pulse around the dot is an animation. It shows the map is running; it does not prove a new reading
just arrived. Right after you unlock the phone at a new door, the dot can sit where the phone last knew
it was (the previous door, the sidewalk) for a few seconds, pulsing, until the next reading lands.

## How accurate a phone's location really is

| Where you are | Typical radius the phone reports | What that looks like |
|---|---|---|
| Open sky, no buildings | about 16 ft (5 m) | the dot is on you |
| Sidewalk on a residential street | roughly 20 to 45 ft (7 to 13 m) | the dot is in the right yard |
| Under a porch roof, against a wall, under big trees | tens of feet, sometimes 50 ft or more | the dot can be in the street or across it |
| Phone fell back to Wi-Fi (weak satellite signal) | often 100 ft or more; a Wi-Fi guess can sit on the street itself | the dot jumps to a neighbour, then back |
| Phone fell back to cell towers (just opened the app, no Wi-Fi, no satellites yet) | hundreds of feet to a mile | the dot is somewhere down the block for a few seconds |
| iPhone with Precise Location off, or Android "Approximate" | a mile or more | the app refuses to record a door |

Two things make the radius more forgiving than it sounds. On Android the number is the radius the phone
is about 68 percent sure about, so one honest reading in three lands outside its own circle (iPhones
report a radius without saying how sure they are). And the error next to a house is not random: the
reflected signals always measure long, so the guess leans away from the wall, which is exactly the
across-the-street direction.

Newer phones do better next to walls: phones with dual-frequency GPS (Android flagships from about 2018,
iPhone 14 Pro and later Pro models; not the regular iPhone 14, 15 or 16) reject reflected signals
better. Nothing in the app can change which chip a canvasser carries.

## Why the dot can sit across the street

In rough order of how often it comes up:

1. **You are under a roof or against a wall.** The most common cause. The dot drifts toward the open
   side, usually the street, for as long as you stand there, and recovers within seconds of stepping
   off the porch.
2. **You just unlocked the phone.** The map first shows the last position the phone had before it was
   pocketed, then jumps to the new reading a few seconds later. Give it a moment before you judge it.
3. **You just opened the app.** The first readings can be Wi-Fi or cell guesses that are tens or
   hundreds of feet off, settling over the first half-minute. With no data connection the first fix
   takes longer still.
4. **The phone is leaning on Wi-Fi.** When satellites are weak the phone falls back to the recorded
   positions of nearby Wi-Fi routers, which can be tens of feet off and are often placed on the street
   itself. The dot can snap toward the house across the street and back.
5. **A phone setting is dragging it down.** Android: Google Location Accuracy (also called Improve
   Location Accuracy) off, Battery Saver on (location can switch off while the screen is off), or
   Wi-Fi scanning off. iPhone: Precise Location off for Doorline (the app blocks recording in that
   case rather than guessing).
6. **The house marker is the thing that is off, not the dot.** Markers placed by looking up an address
   often sit on the street in front of the lot, and every unit of an apartment complex shares one
   marker. If the dot is where you are standing and the marker is across the street, the marker is
   wrong. Knock the real door and tell your lead so they can move the pin; the app says **Approximate
   location** on many of these doors but not all of them.
7. **Satellite or Hybrid base map.** Aerial imagery can sit a few yards off the true map, occasionally
   more in hilly areas or older imagery, so a correct dot can look like it is on the road or a roof.
8. **You are zoomed way in.** The dot is always the same size on screen, so the same few yards of
   error looks like a different lot at street-zoom and like nothing at block-zoom. Judge your position
   against the house marker, not the rooftop picture.
9. **The dot trails you by a step.** It eases toward each new reading over about a second; when you
   stop at a door it catches up a second later.

Trees, your own body between the phone and the sky, a metal case, and a phone deep in a bag each cost a
little more. Fake-GPS apps are not on this list: they move the dot and the recorded knock together, so
they never look like "the dot is a little off."

## What this means for your recorded doors

The dot is for navigating. The recorded knock is taken separately, from the phone's own location engine,
at the moment you tap:

- If the phone has a reading from the last 15 seconds that is accurate to about 65 feet, the app uses
  it and the pin recolors at once.
- Otherwise it asks the phone for a fresh reading and waits up to about six seconds for it.
- Failing that, it uses the newest reading the phone has, as long as it is under two minutes old.
- If there is nothing under two minutes old, or location is off or approximate, the door is **not
  recorded** and the app tells you why. See [Location is required](CANVASSER_APP.md#location-is-required-no-location--no-knock).

Every recorded knock carries the phone's own accuracy number, and the audit subtracts that number from
the distance to the house before judging anything. A door is called **Far from house** only when what is
left is more than about 250 feet, and **Weak GPS** when the phone's own radius is worse than about 330
feet. A dot across the street is 50 to 110 feet off. It cannot, on its own, earn a far flag. A knock
recorded in the first seconds after unlocking may carry a coarser reading, and the audit allows for that
too, because the coarser reading says so about itself. A stamp whose phone reported no usable estimate (no
number at all, or one the phone itself marks invalid) is kept as "accuracy unknown" and gets no allowance.

## What to check on the phone

**iPhone**

- Settings → Privacy & Security → Location Services → Doorline → **Precise Location** on, and location
  set to **While Using the App**.
- Settings → Privacy & Security → Location Services → System Services → **Wi-Fi networking** helps
  positioning near houses; leave it on.

**Android**

- Settings → Location → **Location Services** (or Advanced) → **Google Location Accuracy** (also called
  Improve Location Accuracy) **on**. With it off the phone uses satellites alone and does worst next to
  houses.
- Settings → Location → Location Services → **Wi-Fi scanning** on.
- Settings → Apps → Doorline → Permissions → Location → **Precise** (not Approximate), **allowed only
  while using the app** is fine.
- Battery Saver off while canvassing. On some phones it turns location off whenever the screen is off,
  so every door starts cold.

**Either**: step off the porch into the open for a few seconds if the dot looks wrong; it is the phone,
not the app, that needs sky.

## For team leads: reading a far flag

- A far flag is computed on **distance minus the phone's own accuracy radius**, for every entry and for
  the per-canvasser Far count alike. Only the remainder above about 250 ft flags (medium); above about
  820 ft is high. A fix worse than about 330 ft also draws a **Weak GPS** flag (medium; high above 820
  ft), and Far still applies if what is left after subtracting the radius is over 250 ft.
- A dot across the street is well under 250 ft. It never trips Far by itself.
- Before asking the canvasser, check the pin: a door that reads **Approximate location** was placed by
  looking up the address and often sits at the street; move or confirm it from **Pin Fixes**. A later
  pin correction by a lead or admin downgrades an older far flag that turns out to sit beside the
  corrected pin. Check the building too: every unit shares one pin, so a canvasser at the back building
  of a complex is legitimately far from it.
- Read a canvasser's typical accuracy number against the crew's on the same streets, not against zero.
  Everyone's number widens under porches.
- Hard-to-explain patterns, not single porch flags, are the conversation: a run of high far flags with
  tight accuracy numbers, doors logged seconds apart, or a whole street from one spot.
- On the web map, the flag and canvasser-location panels say **far** only on what is left after
  subtracting the phone's radius, and show that remainder; *Not far after allowing for GPS accuracy*
  means the radius explains the distance. Zoom in and each recorded location shows a faint circle the
  size of its accuracy estimate: a guide, not a boundary, since honest readings often land outside it
  (on Android about one time in three). The flag panel and the Audit cards also say when the house pin
  is approximate. The phone's admin map keeps the older label, and has no circles, until its next
  update.

## What Google Maps and Apple Maps do differently

Positioning is the same. Both of those apps read the same engine we do, on the same hardware, with the
same assistance from Wi-Fi, cell towers and (on Android, in thousands of cities) Google's 3D-building
corrections, which arrive for every app through the system provider. Neither app snaps a pedestrian to
the road; snapping is a driving feature and would be wrong on a porch.

The difference is display:

- **An uncertainty circle.** Google: "You could be anywhere within the light blue circle. The smaller
  the circle, the more certain the app is." Apple: "The size of the circle shows how precisely your
  location can be determined." Our dot shows no circle; a 15-foot fix and a 150-foot fix look identical.
- **A grey dot when the location is stale or lost.** Ours keeps pulsing at the last position.
- **A heading beam.** Ours is off on purpose (it is about which way you face, not where you are).

The circle is the cue that would turn "the app put me across the street" into "the GPS is unsure under
this roof." Adding it exactly as those apps draw it needs a native change to the map library we use,
so it waits for the next app-store build; a lighter cue that can ship over the air is described in
Part 2 §G. None of this changes what is recorded.

---

# Part 2 — Technical reference

Everything below was verified on 2026-10-03 against the vendored SDK sources (expo-location 19.0.8,
@rnmapbox/maps 10.3.0 bundling Mapbox Maps SDK 11.18.2 on both platforms, Expo SDK 54, React Native
0.81.5) and Apple/Google primary documentation. Where a statement is an inference rather than a verified
fact it says so.

## A. Three readers of location on the phone

| Reader | What it is | What it feeds | Stops when |
|---|---|---|---|
| **The engine puck** ([mobile/components/AppLocationPuck.jsx](../mobile/components/AppLocationPuck.jsx)) | `<Mapbox.LocationPuck visible pulsing={{ isEnabled: true, color: '#4A90E2', radius: 15 }} />`, drawn by the Mapbox engine from its own location provider. Position never crosses the JS bridge; there is no position prop and no way to read it from JS. | the blue dot only | the component unmounts (never `visible={false}`, which keeps the engine running) |
| **The JS feed** ([mobile/lib/useLocationFeed.js](../mobile/lib/useLocationFeed.js), policy in [locationFeed.js](../mobile/lib/locationFeed.js)) | the ONE `watchPositionAsync` call site in `mobile/`: `{ accuracy: High, timeInterval: 1000, distanceInterval: 0, mayShowUserSettingsDialog: false }` with a watchdog (15 s silence while active → resubscribe, no sooner than 30 s after the last attempt, 5 s tick). | the list's "nearest to me" sort and the iOS Precise-off probe. Never the dot, never the knock gate. | the houses map unmounts |
| **The knock gate** ([mobile/lib/location.js](../mobile/lib/location.js) `getCanvassLocation`, predicates in [locationGate.js](../mobile/lib/locationGate.js)) | one-shot reads at the tap: services on → permission granted (Android `coarse` grant → `PRECISE_OFF`) → `getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 20 })` → `Promise.race(getCurrentPositionAsync({ accuracy: High }), 6000 ms)` → `getLastKnownPositionAsync({ maxAge: 120000 })` → `NO_FIX`. Every candidate passes `assertPrecise` (iOS accuracy > 1000 m → `PRECISE_OFF`). | the stamp `{ lat, lng, accuracy, fixTimestamp, mocked }` on every knock, survey and add-person write ([recordAction.js](../mobile/lib/recordAction.js) `optimisticSubmit`, before the optimistic recolor) | n/a (one-shot) |

The houses map ([map.jsx](../mobile/app/(app)/map.jsx)) mounts the feed and the puck un-gated inside its
final render, in both map and list modes, and the door, building and survey screens are Stack siblings
pushed above it ([mobile/app/(app)/_layout.jsx](../mobile/app/(app)/_layout.jsx)), so both keep running
under a door screen. That warm OS cache is what makes the gate's first step cost no fresh-fix wait. The
Books map ([books.jsx](../mobile/app/(app)/books.jsx)) mounts the puck un-gated too; the two admin maps
mount it behind `isFocused`. Pin fixes use the best-effort `getCurrentLocation()` (same ladder, never
blocks).

**The dot and the stamp cannot disagree systematically.** On iOS both are `CLLocationManager`s on the
one Core Location engine; on Android both ride Google's fused provider (the puck through Mapbox Common's
`LocationService`, which picks the fused provider when Play services are present; likely, not provable
from the closed-source module). What differs is time: the dot glides to each fix over 1.0 s (Android,
linear) / 1.1 s (iOS), the first gate step accepts a fix up to 15 s old, and the last step one up to 2
min old. Nothing can stamp a place the dot has not shown within the last two minutes.

## B. Platform plumbing (the exact requests)

**Android (expo-location 19.0.8, `FusedLocationProviderClient` throughout)**

- `Accuracy.High`, `Highest` and `BestForNavigation` all map to `PRIORITY_HIGH_ACCURACY`; the caller's
  `timeInterval`/`distanceInterval` override the per-accuracy defaults. The feed is therefore
  `LocationRequest(1000 ms).setMinUpdateIntervalMillis(1000).setMaxUpdateDelayMillis(1000).setMinUpdateDistanceMeters(0)`.
- `getCurrentPositionAsync({ High })` is `CurrentLocationRequest { PRIORITY_HIGH_ACCURACY, maxUpdateAgeMillis: 2000 }`
  via fused `getCurrentLocation`: a cached fix under 2 s old returns at once, else a fresh derivation.
- `getLastKnownPositionAsync` is fused `lastLocation` filtered by wall-clock age and `accuracy <= requiredAccuracy`.
- `hasServicesEnabledAsync` is true when the GPS **or** the network provider is enabled. A phone with
  Google Location Accuracy off (network provider disabled, satellites only) passes it.
- A one-shot read without `mayShowUserSettingsDialog: false` can raise Google's system "turn on location
  accuracy" dialog when the network provider is disabled. The feed passes `false`; the three one-shots
  (gate, pin fix, initial camera) do not yet (§G).
- `mocked` = `Location.isFromMockProvider`.
- The engine puck: Mapbox's `DefaultLocationProvider` requests `AccuracyLevel.HIGH`, interval 1000 ms,
  minimum interval 1000 ms, displacement 0.1 m, and replays the last known fix to each new consumer.
  Mounting the puck also starts rnmapbox's own second engine stream (HIGH, 1000 ms) whose fixes feed
  listeners this app never registers; battery only, not accuracy.

**iOS (expo-location 19.0.8, a new `CLLocationManager` per request)**

- `Accuracy.High` = `kCLLocationAccuracyNearestTenMeters`; `Highest` = `kCLLocationAccuracyBest`;
  `BestForNavigation` = `kCLLocationAccuracyBestForNavigation`. The feed and the gate use `High`; the
  engine puck's own manager runs at `Best` with `kCLDistanceFilterNone`.
- `getCurrentPositionAsync` = `requestLocation()`, which Apple documents as one-shot, "may take several
  seconds", and "If obtaining the desired accuracy would take too long, the location manager delivers a
  less accurate location value rather than reporting an error." The wait is undocumented.
- `getLastKnownPositionAsync` = a fresh `CLLocationManager().location` filtered by age and
  `horizontalAccuracy <= requiredAccuracy` (a negative, invalid accuracy passes today; §G).
- expo-location sets only `allowsBackgroundLocationUpdates = false`, `distanceFilter = 0.0` and
  `desiredAccuracy`; `activityType` stays `.other` and `pausesLocationUpdatesAutomatically` stays at
  Apple's default of `true`. The foreground `LocationOptions` type exposes neither; Mapbox's
  `AppleLocationProvider` sets neither and has no pause handler.
- No `mocked` field is produced on iOS (`sourceInformation.isSimulatedBySoftware` is never read); the
  stamp carries `null`.
- With Precise Location off, Apple delivers reduced-accuracy fixes "usually within 1–20 kilometers"
  and updates them "at most a few times per hour".

## C. What "accuracy" means

Android documents `getAccuracy()` as the radius at the **68th percentile**: a 68 percent chance the true
position is inside it. Apple documents `horizontalAccuracy` only as "the radius of uncertainty", with no
confidence level; practice treats it the same. Under an ideal circular model the 95 percent radius is
about 1.6× the reported value and the 99 percent radius about 2×; real smartphone error is fatter-tailed
than that, and multipath error next to a wall is biased, not symmetric. Treat the number as the phone's
honest estimate of its own doubt, never as a bound.

Field references (primary sources, cited in §F): gps.gov 4.9 m under open sky, "worsens near buildings,
bridges, and trees"; Merry & Bettinger 2019 iPhone 6 averaging 7–13 m on a built-up campus; Zandbergen
2009 median 8 m for assisted GPS, 74 m for Wi-Fi positioning (nearly half of Wi-Fi fixes exactly on the
road centreline), ~600 m for cellular; Google's 2020 note that "wrong-side-of-the-street and even
wrong-city-block errors" are the biggest urban problem, mitigated by 3D-mapping-aided corrections
delivered through the fused provider on Android 8+.

## D. Freshness and staleness

| Bound | Value | Where |
|---|---|---|
| Gate fast path | fix ≤ 15 s old and ≤ 20 m accuracy | `location.js` `acquire()` step 2 |
| Gate fresh read | raced against 6 s | step 3 |
| Gate fallback | any accuracy, ≤ 2 min old (`MAX_FIX_AGE_MS`) | step 4 |
| Feed staleness | 15 s of silence while the app is active | `locationFeed.js` `STALE_FIX_MS` |
| Feed restart floor | ≥ 30 s since the last subscribe attempt, 5 s tick | `RESTART_MIN_INTERVAL_MS`, `WATCHDOG_TICK_MS` |
| Puck glide | 1.0 s (Android, linear) / 1.1 s (iOS) | Mapbox SDK, not configurable from JS |
| Stale-fix flag | `fixTimestamp` older than the tap by > 5 min med, > 30 min high | `flagThresholds.js` |

The tap timestamp is minted once after the gate and frozen into any offline-queued body, so an offline
replay cannot trip the stale-fix rule; the worst honest gap is the 2 min cap against the 5 min threshold.
Android removes and re-adds the watcher itself on host pause/resume; iOS stops delivering while the app
is suspended and resumes when it runs again. Backgrounding deliberately does not tear the feed down.

## E. Thresholds (meters and feet)

| Rule | Meters | Feet | Source |
|---|---|---|---|
| Far, medium | effective > 75 | > ~250 | `FAR_WARN_M` |
| Far, high | effective > 250 | > ~820 | `FAR_CONFIRM_M` |
| Weak GPS, medium | accuracy > 100 | > ~330 | `GPS_ACCURACY_WARN_M` |
| Weak GPS, high | accuracy > 250 | > ~820 | `GPS_ACCURACY_BAD_M` |
| Gate fast-path accuracy | ≤ 20 | ≤ ~65 | `location.js` |
| iOS reduced-accuracy inference | accuracy > 1000 | > ~3,280 | `IOS_REDUCED_ACCURACY_MIN_M` |

`effective = max(0, distance − max(0, accuracy ?? 0))`: `effectiveMeters` in
[flagDetection.js](../server/src/services/audit/flagDetection.js), used by `farAssessment` (shared with the
per-canvasser Far KPI in [farKpi.js](../server/src/services/audit/farKpi.js) and the admin map's ping
verdict) and by the `replaced` snapshot's nearest pick in `canvass.js`. A negative radius gives no discount
and never adds distance. Far and Weak GPS are independent: a poor fix far from the pin can carry both. A
null accuracy gives no discount and never flags on its own; the server stores a zero, negative or
non-finite accuracy as null (`usableAccuracy` in `canvass.js`), on new stamps and in every snapshot it
writes. Stamps stored before that rule can still hold a zero or a negative, read as no discount. Residential geometry for scale: curb to curb 28–39 ft, front setbacks
15–30 ft, porch to the far curb ~50–70 ft (15–22 m), porch to the opposite porch ~80–110 ft (24–34 m).

## F. The 2026-10-03 audit: verified findings and non-issues

Seven independent readers (SDK semantics, puck provider, knock pipeline, lifecycle, pro comparison, field
scenarios, docs), a synthesis, and three adversarial verifiers per claim (code, external sources,
practitioner). 43 of 45 claims survived; the two refuted ones are listed last.

**Non-issues (the owner can say these with confidence)**

- The dot is engine-rendered, continuous and never bridge-fed; the JS-caused frozen-dot class
  (rnmapbox #3965 symptom: the `onUpdate` stream dies while the native puck keeps drawing) is gone for
  this app because the dot no longer depends on any JS stream, and the only JS stream self-heals.
- Acquisition settings match platform guidance: Android `PRIORITY_HIGH_ACCURACY` at 1 Hz for the feed
  and `HIGH` at 1 Hz for the puck; iOS `Best` for the puck. The one JS-reachable setting not used is
  `Accuracy.Highest` (`kCLLocationAccuracyBest`) for the iOS feed and one-shot: left deliberately,
  because Apple documents no quantified gain over `NearestTenMeters`, the puck already runs `Best` on
  the same device whenever a map is open, and a slower `Best` one-shot risks losing the 6 s race and
  falling to the 2 min fallback, which is worse evidence than a 10 m fix delivered in time.
- Three Android location clients and two iOS managers coexist while the houses map is open; the OS
  serves one engine to all, so lowering the feed's accuracy would save neither battery nor change the
  dot. The admin maps' `isFocused` unmount stops all of it because they mount no feed.
- The ~1 s glide behind each fix is the SDK default on both platforms; with 1 Hz fixes the drawn dot
  can be up to ~2 s (one stride) behind a walking canvasser. The stamp is taken from the OS directly,
  so the drawn lag never enters the data.
- The gate's order, the 15 s / 20 m fast path and the 2 min cap are sound. GPS error alone practically
  never far-flags an honest porch knock: it would need true error above 75 m plus the reported radius.
- Not tearing the feed down on background is correct; the privacy grep contract holds (one
  `watchPositionAsync` call site plus two comment lines; background terms zero). Run that grep over
  tracked files only: the gitignored `mobile/dist/` source maps bundle expo-location's own JS and would
  read as a false second match.
- Watchdog restarts while the OS merely has nothing new are harmless (a resubscribe every 30–35 s at
  worst; on iOS it builds a fresh `CLLocationManager`, which is also the only thing that would revive an
  OS auto-paused stream).
- `visible={false}` keeps the engine running on both platforms (iOS stops only the pulse); unmount is the
  off-switch. The rejected pulsing radius `'accuracy'` is an animated sonar ping; the static
  `showAccuracyRing` / `showsAccuracyRing` disc (§G) is a different control, off by default, same colour
  on both platforms.
- The iOS Precise-off inference (> 1 km) is safe against false blocks: Apple puts reduced fixes at 1–20
  km. expo-location 55.1 added `resp.ios.accuracy: 'full' | 'reduced'`; at the next Expo SDK upgrade the
  real flag replaces the inference (a JS change beside `isCoarseGrant`).
- Mock-location apps move the dot and the stamp together; "my dot is across the street" is never a
  mock symptom. Android stamps `mocked`; iOS stamps `null` (expo-location never reads Apple's flag,
  which covers Xcode/GPX simulation only — the owner parked iOS spoof work in July 2026).
- No snap-to-road and no heading beam are correct choices. One wording correction: the AppLocationPuck
  comment's "keeps the magnetometer polling" is Android-only; on iOS the Mapbox SDK runs heading updates
  under any 2D puck regardless of `puckBearing`, so the saving there is rendering only.

**Findings that survived (ranked), each with the skeptics' corrections applied**

| Id | Severity | Finding | Verdict after review |
|---|---|---|---|
| F-01 | med | No uncertainty cue on the canvasser's dot. Both native SDKs can draw a translucent accuracy disc (`Puck2DConfiguration.showsAccuracyRing`, `LocationComponentSettings.showAccuracyRing`, both default off, both #89CFF0 at 30 %), rnmapbox 10.3.0 exposes no prop. | Real gap. Vehicle is native (fold into the next four-build cycle via an rnmapbox prop PR consumed as a git dependency, or a config plugin; never patch-package, which needs a `mobile/package.json` script). Do not ship a JS-drawn `CircleLayer` ring: it would centre on a different OS client than the puck, jump while the puck glides, and go stale apart from the dot. Both pro apps draw the circle only when unsure, which answers the 2026-08-30 "alarming indoors" objection. Owner decision. |
| F-02 | med → low | After unlocking, the dot sits at the pre-lock spot and keeps pulsing; no "finding you" cue. | Behaviour confirmed; the transient "Finding your position" chip was refuted as noise. Put it in words (Part 1) and fix the AppLocationPuck comment. A grey dot after tens of seconds of true staleness is possible from JS (a grey `topImage` registered in `Mapbox.Images`), but the feed is a proxy for a different OS client; owner sign-off first. |
| F-03 | med → none | Accuracy-inflation evasion window: a client asserting accuracy 100 m is unflagged within 175 m of the pin; asserting 250 m draws only Weak GPS up to 325 m. | Arithmetic verified, escalation refuted: raising severity when accuracy > 100 m and raw distance > 250 m would upgrade a share of honest 150–250 m fixes to high, against the false-positive veto. Keep as a documented trade-off (AUDIT.md §F). Display parity only: the mobile flag card should show the raw distance the web panel already shows. |
| F-04 | med | Admin maps draw a ping, a leader line and a fixed-pixel halo but no accuracy radius; the panels label "far" on raw distance > 75 m while the server subtracts accuracy. | Upheld. Web ships with the server deploy (payloads already carry `location.accuracy`). Mobile admin map via OTA, after the owner has seen the web version. |
| F-05 | med | No doc or Help article explains GPS accuracy. | This doc and the two FAQs. |
| F-06 | med | MAPS.md, PERFORMANCE.md, CANVASSER_APP.md and PRIVACY_VERIFICATION §C10 contradicted the code (gate order, function name, "no continuous feed", unbounded fallback). | Corrected 2026-10-03 in the same change as this doc. |
| F-07 | med → low | Lead-facing docs never stated the accuracy-subtraction rule. | AUDIT.md Part 1 and the audit guide now do; AUDIT.md's "low flags still count in the Far KPI" sentence was wrong (the per-canvasser KPI counts medium and high only) and is fixed. |
| F-08 | low | A negative (invalid) iOS `horizontalAccuracy` passes the ≤ 20 m fast path and is stamped; a 0.0 accuracy would read as perfect. | Upheld as hardening. Android exposure is theoretical (the platform rejects locations without accuracy). Server half built 2026-10-05 (W1): a zero, negative or non-finite accuracy is stored as null and gets no allowance, never refused, because a refused offline replay is a knock the phone silently drops; in practice a zero comes from a mock-location app or an emulator. The phone-side guard is §G item 4. |
| F-09 | low | Knock stamps have no lat/lng range validation. | Upheld for the coordinate bounds only. The proposed future-timestamp clamp was refuted (it would let a stale offline replay out-rank a fast-clock phone's newer action). |
| F-11 | low | The iOS Precise-off early-warning banner probably cannot trip: it needs 6 coarse fixes with gaps ≤ 30 s, while reduced accuracy delivers "at most a few times per hour" and the feed's restart cadence is ~30 s. | Likely (WWDC 2020: "recomputed about four times per hour"). The hard gate still blocks every coarse tap, so no bad data. Help copy that promised "you'll usually see it coming" is corrected; the retune waits for a two-minute device log. |
| F-12 | low | rnmapbox Android drops a puck enable while the MapView is detached (lifecycle `CREATED`). | Upstream defect, confirmed; reachable only if a style finishes loading while the map is covered. Monitor; an upstream PR is the fix. |
| F-13 | low | iOS stamps carry no simulated-location flag. | Refuted as actionable: Apple's flag covers Xcode/GPX simulation only; expo upstream adds it later for free. Nothing to do. |
| F-14 | low | Mapbox already calls `requestTemporaryFullAccuracyAuthorization(withPurposeKey: "LocationAccuracyAuthorizationDescription")` under reduced accuracy, but app.json declares no `NSLocationTemporaryUsageDescriptionDictionary`, so Apple fails it silently. | Verified. Declaring the key (an app.json edit: native, four builds) would add Apple's one-tap "precise location once" prompt at authorization-change moments only; the banner stays the primary path. Prompt copy must be reconciled with the privacy wording first. |
| F-15 | low | iOS porch latency: fixes under eaves are 20–40 m, the fast path demands 20 m, `requestLocation` at `NearestTenMeters` waits for a 10 m fix, the 6 s race expires, and the fallback returns the fix the fast path refused. | Mechanism upheld, unmeasured. Measure first (~20 porch taps, log the step and elapsed ms). If confirmed, raise the fast-path `requiredAccuracy` from 20 to ~40 m (still under every threshold; the audit subtracts accuracy regardless). Do not insert an any-accuracy step between the race and the fallback (a no-op). |
| F-16 + F-18 | low → med | Android phones in device-only mode (Google Location Accuracy off) degrade silently, and the gate's one-shot can pop Google's system settings dialog mid-knock, racing the 6 s timer. | Upheld; the mapping is settled (Google: the platform network provider is disabled whenever Google Location Accuracy is off). JS-only fix in §G. |
| F-17 | low → none | iOS auto-pause is left at the default for both the feed and the puck; a paused puck would freeze until remount. | Documented open question. Apple documents pausing only in background terms; a remount-on-restart mitigation was refuted (no-op in follow mode, blinks the dot). Device test in §I. |
| F-19 | low | iOS feed uses `distanceFilter 0` rather than `kCLDistanceFilterNone` (−1). | Probably equivalent by Apple's documented semantics; field count is the deliverable, not the change. |
| F-20 | low | A transient iOS Core Location error (`locationUnknown`, which Apple says to ignore) ends the JS stream, and the restart waits for the 30 s floor when it lands inside one. | Upheld; one immediate resubscribe per error burst, which MUST remove the dead subscription first. |
| F-21 | low | On a cold, cell-only iPhone fix (> 1 km) the gate says "turn on Precise Location" although it is on. | Observation upheld; the code change (deciding the code by the probe's run) was refuted because it would mislabel genuine Precise-off taps. Copy fix instead: the alert and banner should say that if Precise is already on, GPS is still warming up. |
| F-22 | low | Flag entries do not say when the house pin is an approximate geocode. | Upheld. Project `coordConfidence` and `locationConfirmedAt` into the entry's household, render a three-way line in both flag panels, never feed the far downgrade with it. |
| F-23 | low | The add-person route comment says the stamp "evidences the visit" but nothing stores it. | Comment fix only; persisting it would be a new retained datum needing the privacy cascade. |
| F-24 | low | Code comments overstate the pulse and misattribute the warm fix cache. | Comment fixes, with the next OTA. |
| F-26 | med | Found while designing the upgrades (docs/PROPOSAL_GPS_UPGRADES.md). A hand-made knock with a non-finite coordinate (JSON `1e400` parses to Infinity) passed the server's `typeof` check; on the door-result path the replace deleted the canvasser's earlier entry for that door, then the create failed with a 500 that a phone would queue and retry forever. No app can send one (JSON writes infinity as null). Reproduced on a throwaway database. | Fixed 2026-10-05 (W1): a coordinate that isn't a finite number is `400 LOCATION_REQUIRED` before any write on all three stamped routes (`isFiniteLatLng`), pinned by `locationGate.int.test.js` (the earlier entry survives). Finite values off the Earth are still accepted until `npm run audit:gps-stamps` shows none stored (§G item 14). |

**Refuted**

- "The knock-time permission request bypasses the shared in-flight guard and surfaces as `NO_FIX`."
  All three verifiers refuted it: expo-modules-core queues overlapping Android manifest-permission
  requests (the "Another permissions request is in progress" throw is `WRITE_SETTINGS`-only), so the
  rationale comment at `location.js:12-17` is wrong about Android. The guard is still useful on iOS,
  where an overlapping request during `undetermined` would orphan the earlier caller's promise.
- "CANVASSER_APP.md, AUDIT.md §B.6 and the on-screen copy are already correct" survived on its merits but
  its verification did not complete; it is listed here only for completeness. Those passages were
  checked by hand and left alone.

## G. Recommended changes, by ship vehicle

Nothing below was built as of 2026-10-03; it is the design the audit produced, approved with the
implementation plan [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md) on 2026-10-05. The web and server
halves of items 11-15 were built on 2026-10-05 (the plan's step W1); each item says what is left.
Every item keeps the rulings in §H. None changes what is collected, kept, shown to a new audience, or sent
to a third party except where marked.

**Docs and Help Center (server deploy, no OTA) — done in this change**

1. This doc, its README row, the corrections to MAPS.md, PERFORMANCE.md, CANVASSER_APP.md, AUDIT.md and
   the PRIVACY_VERIFICATION.md §C10 stamp.
2. Help: the canvasser FAQ `blue-dot-not-where-i-am`, the lead FAQ `canvasser-dot-off-will-it-flag`,
   the "How much GPS drift Far tolerates" paragraph in the audit guide, backlinks from the field map
   guide, the location FAQ, the first-day guide and the offline guide, and the honest wording for the
   Precise-off notice.

**Mobile, JS-only (ships OTA; `ota:staging` first, then `ota:production` from `main`)**

3. **Settings-dialog hygiene and the device-only advisory (F-16, F-18).** Pass
   `mayShowUserSettingsDialog: false` on the three one-shot reads (`location.js` `acquire()` and
   `getCurrentLocation()`, `map.jsx` `tryGetUserCoords`). In `getLocationGateStatus`, on Android after
   the granted/precise checks, call `Location.getProviderStatusAsync()` and return an advisory
   `NETWORK_OFF` when `locationServicesEnabled && gpsAvailable && !networkAvailable`; add
   `COPY.NETWORK_OFF` to `LocationBlockedBanner` in a softer tone ("Location accuracy is set to
   device-only — tap to turn on Google Location Accuracy for faster, more accurate positioning"), routed
   to the existing `promptEnableServices()`, falling back to `Linking.openSettings()` if the resolution
   dialog does not appear. Advisory only: never a tap-time block, never a watcher option change. Tests:
   a `locationGate.test.js` structural pin that every `getCurrentPositionAsync` call passes
   `mayShowUserSettingsDialog: false`. Device check on an Android 12+ phone with Location Accuracy off.
4. **Invalid-accuracy guard (F-08).** `isUsableFix(pos)` in `locationGate.js` (finite lat/lng; accuracy
   null or > 0) applied to all six candidate reads in `acquire()` and `getCurrentLocation()`; an unusable
   candidate falls through. Unit cases (−1, NaN, 0, null, 5) plus a structural pin mirroring the
   `assertPrecise` one. Cleans up the "GPS accuracy ±-3 ft" render sites and FixPinModal's `> 50`
   warning.
5. **Transient-error restart (F-20).** In `useLocationFeed`'s error callback allow one immediate
   resubscribe per burst: `sub.remove(); sub = null; subscribe()`, counter reset on the next delivered
   fix, the 30 s floor kept for repeated errors. Put the decision in `locationFeed.js` so `node --test`
   covers "first error after a fix bypasses the floor" and "second error in a burst is floored". Guard
   the early-error race (error before `sub = next`).
6. **Honest Precise-off copy (F-21).** `locationBlockedAlert`'s `PRECISE_OFF` text and
   `LocationBlockedBanner`'s `COPY.PRECISE_OFF`: "Doorline only got an approximate location. If Precise
   Location is already on for Doorline in Settings, GPS is still warming up: step outside, wait a few
   seconds, and tap Try again." (the button's actual label). Keep `assertPrecise` and its code unchanged.
7. **Precise-off probe retune (F-11), after a device log.** With Precise off, log `handleFix` timestamps
   for two minutes. If it is one coarse fix per subscription, set `PRECISE_OFF_MAX_GAP_MS` to 60 s,
   `PRECISE_OFF_MIN_COUNT` to 3 and `PRECISE_OFF_MIN_SPAN_MS` to about 50 s; add a test asserting
   `PRECISE_OFF_MAX_GAP_MS > RESTART_MIN_INTERVAL_MS + WATCHDOG_TICK_MS` (import both modules) and a
   cadence replay (coarse fixes at 0, 34.9, 64.9, 94.9 s with +5 ms drift) that expects a trip. The
   honest promise afterwards is "within about a minute of opening the map", never "before you walk".
8. **Porch latency (F-15), after measurement.** If porch taps routinely run past 3 s on iPhone, raise
   the fast-path `requiredAccuracy` from 20 to 40 m in both ladders and update the comment block and
   AUDIT.md §B.6. Optional: a "Getting your location" state on the door screen's buttons while the gate
   runs.
9. **Comment fixes (F-24, refuted F-10).** AppLocationPuck: the pulse proves the renderer is running,
   not that fixes arrive, and the magnetometer note is Android-only. recordAction.js and location.js:
   one shared sentence naming both the feed and the engine puck as what keeps the OS cache warm (do not
   write the watcher's function name in the new comment). location.js:12-17: Android queues overlapping
   requests; the guard exists for the iOS orphaned-promise case. useLocationFeed.js:120-123: the Mapbox
   provider polls for permission, so a Settings round-trip should draw the dot without remount.
10. **Optional accuracy readout (F-01/F-02 interim), owner's call.** A small pill on the houses map,
    "GPS ±N ft", fed from the feed's `pos.coords.accuracy` through its own tiny subscriber component (so
    `map.jsx` does not re-render at 1 Hz), greyed when the watchdog's `isStale` is true. It gives the
    "step into the open" cue without re-litigating the ring, touches no location call site, and
    never changes the puck. Not a "Finding your position" chip on every resume (refuted as noise).

**Web and server (deploys from `main`; the mobile mirrors ride the next OTA)**

11. **Flag panels judge "far" like the server (F-04).** `FlaggedEntryPanel.jsx`, `CanvasserPingPanel.jsx`
    and the mobile admin map sheet label "far" on `max(0, distance − (accuracy ?? 0)) > FAR_WARN_M`, with
    the "after allowing for GPS accuracy" wording the legend already uses. **Web built 2026-10-05:** both
    panels label from the server's own verdict (the flag's far reason; a new `far` field on each map
    ping), falling back to that arithmetic only for a payload without one ([AUDIT.md](AUDIT.md) §E).
    Left: the mobile admin map sheet (the plan's §H.5).
12. **Accuracy radius on the admin maps (F-04).** `activitiesToPingsGeoJSON` and `flagsToGeoJSON` carry
    `accuracy` (omit the key when null or ≤ 0); add ring layers below the ping layers, drawn as geodesic
    polygons in a fill layer (a 64-vertex circle; a `circle` layer clips at tile buffers once the radius
    exceeds ~128 px) with `fill-opacity` ~0.1 and a 1 px stroke in the feature colour; keep the
    fixed-pixel halo as the alert affordance at overview zooms; cap or text-fallback above ~250 m. Verify
    once against a known street width. Mobile admin map: the same via `ShapeSource` + `FillLayer`, OTA,
    after the owner has seen the web version. **Web built 2026-10-05** ([MAPS.md](MAPS.md) §E): from zoom
    13, none wider than 250 m (the panel says "Too wide to draw on the map"), all or none over 500 on
    screen. Left: the street-width check in a browser, and the mobile admin map (§H.6).
13. **Pin precision on flag entries (F-22).** Add `coordConfidence` and `locationConfirmedAt` to the
    detector's Household projection and `entry.household`; a copy helper in the
    `client/src/lib/flags.js` / `mobile/lib/flags.js` mirrors; render in `FlaggedEntryPanel` and
    `FlaggedEntryCard`. Display only; never into `buildPinFixMap` or `farAssessment` (AUDIT.md §B.7).
    **Server and web built 2026-10-05:** `pinPrecisionText` reads "House pin is approximate (placed by
    address lookup) — check the pin before asking the canvasser." or "House pin is approximate but was
    confirmed in place on <date>.", in the flag panel and on the Audit cards. Left: the phone's helper
    copy and `FlaggedEntryCard`.
14. **Coordinate bounds (F-09).** `locationSchema`: `lat: z.number().min(-90).max(90)`,
    `lng: z.number().min(-180).max(180)` (one edit covers knock, survey and add-person). No timestamp
    clamp. Server backstop for F-08: `accuracy` transformed to `null` unless finite and `> 0`.
    Integration case: lat 200 → 400, zero rows written. **Partly built 2026-10-05:** non-finite
    coordinates are refused as `LOCATION_REQUIRED` before any write (F-26), the accuracy backstop is in
    (on both ledgers, the `replaced` snapshot and the pin route's audit row), and the far discount is
    clamped (`effectiveMeters`, §E). Left: finite values off the Earth, refused only once
    `npm run audit:gps-stamps` shows none stored, because a refused offline replay is a silently dropped
    knock (the plan's W1-offEarth).
15. **Mobile flag card parity (F-03 residue).** `FlaggedEntryCard` shows the raw distance beside the Weak
    GPS detail, as the web panel does. Comment fix at `canvass.js:1006` (F-23). **The comment fix and the
    web Audit cards' Weak GPS distance were built 2026-10-05** (`weakGpsDistanceText`). Left: the phone's
    `FlaggedEntryCard`.

**Next native build cycle (four builds; fold in, never a cycle of their own)**

16. **The accuracy ring (F-01).** `showsAccuracyRing` / `showAccuracyRing` on the engine puck, SDK
    default colour, plumbed as a `LocationPuck` prop upstream or applied by a config plugin at prebuild.
    Owner decision first: a static disc that both pro apps draw only when unsure, versus the 2026-08-30
    objection to the pulsing ring indoors.
17. **Temporary full accuracy purpose key (F-14).** `ios.infoPlist.NSLocationTemporaryUsageDescriptionDictionary.LocationAccuracyAuthorizationDescription`
    with copy reconciled against the permission strings and §C9 (the grant is session-wide while the
    puck consumes it, so the copy cannot say "only when you log a knock"). Partial benefit; privacy
    review of the wording.
18. **Only if the §I device test confirms a foreground pause (F-17):** `pausesLocationUpdatesAutomatically
    = false` on expo-location's foreground providers and a configured `AppleLocationProvider` for the
    puck. Not fixable from JS in rnmapbox 10.3.0.

## H. Rulings and invariants

- **The dot is the engine puck.** Never reintroduce `Mapbox.UserLocation`, the JS `locationManager`, or
  any JS-positioned geometry that stands in for the user's position; never `visible={false}` (unmount is
  the only off-switch).
- **One `watchPositionAsync` call site** in `mobile/` ([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
  §C9(a)); the background-location terms stay at zero; count call sites in tracked files.
- **The knock gate is never fed from the watcher** and never from the puck; it reads the OS directly.
- **No background location, ever.** Both permission strings and the Privacy Policy promise it.
- **The far rule subtracts the client's own accuracy claim.** That makes it generous by design and
  forgeable in a narrow band (§F, F-03). Do not close the band with threshold arithmetic; the
  false-positive veto applies, and the behavioural flags (mock, rapid, one-spot, stale) cover the
  tampering side.
- **`Accuracy.High` stays** for the iOS feed and one-shot (§F non-issues); `activityType` stays `.other`
  (`.fitness` disables indoor positioning and may pause when stationary).
- **Native changes cost four builds** and must fold into a cycle the team already has to cut.
- **Display cues never change data.** A ring, a readout or a grey dot informs the canvasser; the stamp
  and the flags are untouched.
- **The admin maps' accuracy circles are for recorded stamps only.** Each is drawn from the stamp's own
  accuracy, is a guide and never a boundary (on Android one honest stamp in three lies outside its own
  circle), and never takes a click. They are not the live dot's ring, which stays the engine's own (F-01).
- **A panel never re-judges the server's far verdict.** It labels from the verdict the row carries and
  falls back to `farAssessment`'s arithmetic only for a payload without one; `server/test/flagsMirror.test.js`
  pins the label to the server on 192 boundary cases.
- **An accuracy is a finite radius above zero, or it is unknown.** The server stores anything else as
  null and never refuses the stamp for it; the far discount never goes negative (`effectiveMeters`).

## I. Open questions that need a phone, not a reader

1. **Does iOS auto-pause a foreground, screen-on session?** Map open, phone still for 20–30 minutes on
   battery, following off and again on; then walk and compare the dot with the list's "nearest" order.
   Decides F-17.
2. **Reduced-accuracy cadence.** One iPhone with Precise Location off, two minutes of `handleFix`
   timestamps. Decides the F-11 retune constants.
3. **Porch latency.** About 20 taps at real porches on an iPhone, logging which gate step produced the
   stamp and the elapsed time. Decides F-15.
4. **`distanceFilter` 0 versus −1 indoors.** Three minutes stationary indoors with each value, counting
   fixes per minute and watchdog restarts. Decides F-19 (probably a no-op).
5. **Android device-only mode.** Confirm `networkAvailable` reads false with Google Location Accuracy
   off, that the knock no longer pops the system dialog after item 3, and that
   `enableNetworkProviderAsync` raises the resolution dialog. Decides the F-16 copy and fallback.
6. **Which provider Mapbox Common picks on Android** (fused vs platform GPS/network) is closed source;
   a dev overlay comparing puck position with the feed's fixes would settle whether the two can ever
   disagree by more than the glide.

## J. File map

| File | Role |
|---|---|
| [mobile/components/AppLocationPuck.jsx](../mobile/components/AppLocationPuck.jsx) | The one engine-rendered puck (pulse constants, the never-`visible={false}` rule). |
| [mobile/lib/useLocationFeed.js](../mobile/lib/useLocationFeed.js) · [mobile/lib/locationFeed.js](../mobile/lib/locationFeed.js) · [locationFeed.test.js](../mobile/lib/locationFeed.test.js) | The foreground feed, its watchdog, the pure policy and its tests. |
| [mobile/lib/location.js](../mobile/lib/location.js) · [mobile/lib/locationGate.js](../mobile/lib/locationGate.js) · [locationGate.test.js](../mobile/lib/locationGate.test.js) | The knock gate ladder, the Precise-off predicates and probe, the structural pins. |
| [mobile/components/LocationBlockedBanner.jsx](../mobile/components/LocationBlockedBanner.jsx) | The advisory banner (services / permission / precise). |
| [mobile/lib/recordAction.js](../mobile/lib/recordAction.js) | `optimisticSubmit`: gate, then patch, then submit or queue; the per-code alerts. |
| [server/src/routes/mobile/canvass.js](../server/src/routes/mobile/canvass.js) | `locationSchema` (with `usableAccuracy`), the `LOCATION_REQUIRED` backstop, `distanceFromHouseMeters`, the `replaced` snapshot. |
| [server/src/utils/stateBounds.js](../server/src/utils/stateBounds.js) | `isFiniteLatLng` (the knock routes' backstop) and `isValidLatLng` (finite and on the Earth: the pin-move service today, the knock routes once off-Earth stamps are counted). |
| [server/src/migrations/auditGpsStamps.js](../server/src/migrations/auditGpsStamps.js) | `npm run audit:gps-stamps`: the read-only count of stored stamps by accuracy and coordinate category, and what the far clamp changes ([OPERATIONS.md](OPERATIONS.md)). |
| [server/src/services/audit/flagThresholds.js](../server/src/services/audit/flagThresholds.js) · [flagDetection.js](../server/src/services/audit/flagDetection.js) · [farKpi.js](../server/src/services/audit/farKpi.js) | Thresholds, `effectiveMeters`, `farAssessment`, the five detectors, the per-canvasser Far KPI and the map pings' `farVerdictForWire`. |
| [client/src/lib/mapRender.js](../client/src/lib/mapRender.js) · [client/src/lib/accuracyRing.js](../client/src/lib/accuracyRing.js) · [client/src/components/FlaggedEntryPanel.jsx](../client/src/components/FlaggedEntryPanel.jsx) · [client/src/components/CanvasserPingPanel.jsx](../client/src/components/CanvasserPingPanel.jsx) | Pings, leader lines, halos and the accuracy circles; the flag and ping panels. |
| [client/src/lib/flags.js](../client/src/lib/flags.js) · [mobile/lib/flags.js](../mobile/lib/flags.js) · [server/test/flagsMirror.test.js](../server/test/flagsMirror.test.js) | The user-facing flag copy. Hand mirrors, not byte-identical (they differ in imports and the distance formatter's name); the test pins the web far label to the server and the shared constants, shared helpers and legend footers of the two files to each other. The web file has the far-label and pin-line helpers; the phone's copy gets them with its next update. |
| [server/src/content/help/faq/blue-dot-not-where-i-am.md](../server/src/content/help/faq/blue-dot-not-where-i-am.md) · [faq/canvasser-dot-off-will-it-flag.md](../server/src/content/help/faq/canvasser-dot-off-will-it-flag.md) | The canvasser and lead Help Center articles derived from Part 1. |
