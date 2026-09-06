# Lock screen and directions (field app)

Two ideas a canvasser brought back on 2026-09-04 after using another canvassing app on Android:
that app "has a lock screen feature that lets you see the app from the lock screen," and it "has a
Google Map link for every house address, which is helpful for pulling up GPS in case the pin is in
the wrong location."

**Status: the Directions half is BUILT** (2026-09-05, mobile, JavaScript only). The lock-screen half
was investigated and **not built**: the competitor turned out to have no such feature, and the owner
scoped this change to Directions alone. The keep-screen-on option designed in section C is likewise
**not built** — it remains a costed option, nothing more.

- **Part 1 — For everyone** is the plain-language answer and the decisions we need.
- **Part 2 — Technical reference** is the verified mechanics, the designs, and the release and
  privacy paperwork each option carries.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (the door screen and map sheet the Directions button
lands on), [MAPS.md](MAPS.md) (approximate pins and the Pin Fixes page, which already has a Google
Maps link on the web), [PERFORMANCE.md](PERFORMANCE.md) (why the app is easy on batteries, and the
rule a lock-screen surface would bend), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) (the
precedent ruling for outbound maps links, item 15, and the location promises a lock-screen surface
must not break).

---

# Part 1 — For everyone

## The short version

**Directions to every house: BUILT.** Every house on the door screen, the map's pull-up
panel, and the building screen has a **Directions** link, and so do the lead-facing admin map,
overlap detail, and voter profile. It opens the maps app the canvasser
already uses (Apple Maps, Google Maps, or Waze) with walking directions to the house. It sends the
**street address**, not our pin, so a pin sitting on the wrong lot cannot send anyone to the wrong
lot. It is a JavaScript-only change, so it ships over the air with no store review, and it costs no
battery. Every competitor we looked at has this; we are the odd one out.

**"See the app from the lock screen": RightInsight has no such feature. What he saw is its phone
dialer.** We took RightInsight's shipped Android app apart, including pulling the live JavaScript
it is running today, and there is no canvassing lock-screen feature in it. No screen that draws
over the lock screen, no widget, no lock-screen card, not even a keep-screen-on setting.

What it does have is **phone banking**. RightInsight includes a Twilio dialer, and a ringing call
is one of the few things Android genuinely lets any app throw onto your lock screen. An incoming
call paints a full-screen card over the keyguard, and an active call leaves a notification sitting
there for the duration. That is the surface he saw, and it appears only while making calls, never
while knocking doors.

So there is nothing to copy here. The lock-screen feature he admired is a side effect of a feature
we do not have, which is the dialer. If canvassers want that behavior while knocking, we would be
building it from scratch rather than catching up.

**Also available over the air, but NOT built:** a **Keep screen on while canvassing** setting.
The native piece it needs is already compiled into every phone's current build, so it would be a
JavaScript change like Directions, and it would remove the most likely real pain of unlocking the
phone at every door. The owner scoped this change to Directions alone; section C keeps the design
if it is ever wanted.

**One thing gates the production release, and it is not this feature.** A production mobile
over-the-air publish is currently blocked by an unrelated commitment: see "The ship gate" below.

**What a true lock-screen surface would cost:** a native store release on both platforms (four
builds, two store reviews, the build-currency dance), a privacy decision from the owner because a
voter's street address would be readable by anyone holding a locked phone, and on iPhone either a
framework upgrade or hand-written Swift, because iOS has no way to show an app over the lock
screen at all.

## The ship gate (read before publishing)

**Directions is finished and safe to publish to the staging lane today. It must not go to
production until an unrelated edit lands.**

This has nothing to do with Directions. On 2026-08-29 the walk-up-voters feature shipped into
`main`: canvassers on survey campaigns can now create a voter record at the door, typing a name and
optionally a phone and email. Our privacy record wrote that up and recorded a condition in plain
terms: the published Privacy Policy still says voter records arrive one way, because *"our customers
upload"* them, and it lists the categories we hold without email. A person typing a new record into
the app at a door is a second way in, and email is a new category. Until the owner edits the policy
to say so, that feature must not reach production phones.

Because a production publish sends everything in `main`, publishing Directions would carry walk-up
voters with it. Verified 2026-09-05:

- The condition is written at [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) item 16, which
  calls the edit "a SHIP GATE for the production mobile OTA" and adds that staging may precede it.
- No later item resolves it.
- `client/public/privacy.html` still carries the upload-only sentence and no email in the voter
  category, so the gate is open.
- The walk-up-voters code, email field included, is in `main` and would ride any production bundle.

**So:** publish `npm run ota:staging` now and confirm Directions in the field. Production waits on
the owner's `privacy.html` edit, which is theirs to make deliberately and never a side effect of
code. That edit unblocks two features at once.

## Directions to a house

**What you would see.** On a house's screen, under the address, a **Directions** link. Tap it:

- On iPhone, a sheet offers **Apple Maps**, **Google Maps**, and **Waze**. Pick one and it opens
  with walking directions to the house.
- On Android, a small dialog offers **Google Maps** or **Another maps app**. Google Maps opens with
  walking directions; "Another maps app" hands the address to whatever maps app the phone prefers
  (Waze, for instance), or lets the phone ask which one to use.

If the chosen app is not installed, the phone opens the same directions in the browser instead, so
the tap never dead-ends.

**Why the address and not the pin.** The canvasser's whole reason was "in case the pin is in the
wrong location." If we sent our pin's coordinates, the maps app would faithfully route to our wrong
spot. Sending the address lets Google or Apple work out where the house is on their own, which is
exactly the second opinion the canvasser wants. This is the same reasoning the web console's Pin
Fixes page already uses for its "Google Maps" link ([MAPS.md](MAPS.md), "The Pin Fixes page").

**Worked example.** Maria opens 845 Collier Ct on her list. The door reads "Approximate location"
and the pin looks like it is on the neighbor's yard. She taps **Directions**, picks Google Maps, and
Google draws a walking route to the real 845 Collier Ct. She knocks the right door, records the
outcome in Doorline as usual, and tells her lead the pin is off so it can be moved (leads fix pins;
see [MAPS.md](MAPS.md)).

**Where it appears.** The door screen, the map's pull-up panel, and the building screen for the
canvasser; the admin map's house panel, the overlap detail, and the voter profile's household card
for leads and admins. It is deliberately not on every row of the house list, which already carries a
quick-action button; opening the house is one tap away and has the button.

**What it does not do.** It does not change anything in Doorline. It does not move the pin. Nothing
about the house is sent anywhere until the canvasser taps, and then only the address goes, to an
app the canvasser chose, the same as if they typed it in themselves.

## Keep the screen on while canvassing (not built)

**What it is.** A switch in the menu's appearance section, **Keep screen on while canvassing**.
When it is on, the screen does not dim or lock while you are on the map, the house list, a house, a
building, or a survey. Leave those screens, switch apps, or press the power button and the phone
behaves normally again. If the phone is not touched for ten minutes, the screen is released too, so
a phone left on a car seat does not stay lit all afternoon.

**Why it matters.** Between doors the screen times out; at the next door the canvasser unlocks,
finds Doorline, and taps the house. If "see the app from the lock screen" is really "I do not want
to unlock at every door," this fixes it without showing anything on the lock screen.

**The battery question.** A lit screen is the biggest battery cost on any phone. The canvasser
praised Doorline for draining slower than the other app, and that reputation comes from the rules in
[PERFORMANCE.md](PERFORMANCE.md): nothing runs when the app is in the background. Keeping the
screen on does not change those rules, but it does keep the screen lit, so we recommend the switch
**default off**, with a one-time tip on the map telling canvassers it exists. The owner may prefer
default on; the ten-minute release makes that defensible.

## "See the app from the lock screen", in plain words

There are only a few ways an app can be "on the lock screen," and they are very different products:

1. **The app sits on top of the lock screen**, the way an alarm or an incoming call does. Press
   the power button and Doorline is right there, tappable, no PIN. Android supports this for the
   app that was in front when the phone locked. iPhone does not support it for any app. The
   downside is obvious: whoever picks up the phone sees, and can use, the walk list.
2. **A card on the lock screen**, like a delivery tracker: "Next: 123 Main St · 12 of 40 doors."
   On Android that is a persistent notification; on iPhone it is a Live Activity. Tapping it opens
   the app after the normal unlock. The card can only change while the app is running, which is
   fine for us (it changes when you record a door).
3. **A lock-screen widget.** Only Pixel phones on the newest Android have these for third-party
   apps; Samsung has not confirmed them. Not worth building for yet.

4. **A ringing phone call.** Not a product decision at all, but worth naming, because it is the
   answer here. Android lets any app throw an incoming call over the lock screen, and an active
   call leaves a notification there while it lasts. An app with a dialer therefore appears to
   "show itself on the lock screen" without ever building a lock-screen feature.

**What RightInsight actually does: number 4.** We read its shipped Android app and the live
JavaScript it is running today. It does none of 1, 2, or 3. There is no lock-screen card, no
widget, no over-the-lock-screen screen, and no keep-screen-on setting. What it has is a Twilio
phone dialer for phone banking, whose incoming-call and in-call notifications are the only things
in the app that touch the lock screen. Its own release notes tell the same story: the features it
announced over two years are calling, a power dialer, and offline tasks, never a lock screen.

**The rest of the field, for context:** none of the other seventeen apps we inspected does 1 or 3
either, and those two we can genuinely rule out because they must be declared in an app's manifest
where we can read them. Number 2 we cannot rule out from a teardown, since a notification is posted
in ordinary code and leaves no trace. One field-sales app (SalesRabbit) can genuinely run a
permanent location-tracking notification, which does put a card on the lock screen all shift and is
exactly the battery drain canvassers complain about. MiniVAN's reviews are full of battery
complaints for the same reason. That version is the one we specifically do not want to copy.

**What we recommend, in order.**

1. **Now, over the air:** ship **Directions** and **Keep screen on**. Neither waits on anything.
   Directions closes a gap every competitor fills, and keep-screen-on addresses the friction that
   probably sits underneath the request.
2. **Do not build a lock-screen feature to match RightInsight.** There is nothing there to match.
   Building one would be choosing to add a surface the competitor does not have, at the price of a
   native release and a privacy ruling, on the strength of a comparison that turns out to be with
   a dialer.
3. **Later, and only on its own merits:** if a lock-screen card is wanted because *we* think it
   helps canvassers, the designs are in Part 2 and section D.3 costs out what one build round could
   carry. Judge it as a new feature, not as catching up.
4. **The real gap this uncovered is phone banking**, not the lock screen. RightInsight has a
   dialer and a power dialer; Doorline has neither. That is a genuine product difference and a
   much larger conversation than this document.

## Now, later, and never

**Now (over the air, no store review, no waiting):**

| Option | Reaches | Battery | Privacy paperwork |
|---|---|---|---|
| Directions button | Both platforms, every phone | None | One log entry; no policy change |
| Keep screen on | Both platforms, every phone | Screen stays lit while on (opt-in) | None |

**Later, and only on its own merits.** Nothing below is catching up any more: RightInsight has none
of it. Each is only worth building if we decide it helps canvassers, and then only as one bundled
native release (see Part 2 section D.3):

| Option | Reaches | Battery | Privacy paperwork |
|---|---|---|---|
| App over the lock screen | **Android only** — iPhone cannot do this at all | None by itself | Owner ruling; log entry |
| Lock-screen card (Android notification) | Every Android 8+ phone | Negligible | Owner ruling; log entry; corrects our "no push libraries" note |
| Lock-screen card (iPhone Live Activity) | iPhone; needs a framework upgrade or hand-written Swift | Low | Owner ruling; log entry |
| Android 16 "Live Update" chip | Recent Pixel and Samsung only | Negligible | Same as the card |
| Lock-screen widget | Recent Pixels only | Low | Skip until other phones get them |

The four builds are a **fixed toll, not a per-feature price**: everything in the "later" table can
ride one release for the same store cost. So the real question is not "is the lock screen worth
four builds" but "what else goes in the truck while it is going." On today's evidence the strongest
candidate for that truck is not on this list at all. It is **phone banking**, the feature
RightInsight has and we do not, and the one whose absence a canvasser would actually feel.

**Never:**

- Anything that reads GPS while the phone is locked or the app is closed. It would break the
  sentence in our Privacy Policy that says we never track location in the background, break both
  app-store permission prompts, and it is the exact pattern behind the battery complaints
  canvassers make about other apps. There is a config flag in a library we already ship that would
  turn this on. It stays off.
- Chasing "which maps apps are installed" before showing the Directions sheet. It needs a native
  release, and on iPhone it cannot even detect Google Maps correctly, which is why Apple has
  deprecated the way of asking.

## Privacy, in plain words

**Directions.** The house's address leaves the phone only when the canvasser taps, and only to the
maps app the canvasser picked. Doorline does not send it anywhere and never fetches anything. That
is the same class as the web console's existing Google Maps link, whose recorded reasoning in our
privacy record is that it is not a new service provider and needs no change to the Privacy Policy.
Google Play counts handing data to another app on the phone as "sharing," and exempts it only when
it happens on a specific user-initiated action the user expects; that is exactly why the button
must stay an explicit per-house tap where the canvasser picks a named app, never something that
opens on its own. It is recorded in the privacy verification log as item 20
([PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)), for the owner to confirm before the production
release.

**Keep screen on.** No new data, no new recipient. The phone is simply unlocked for longer, showing
what the canvasser already sees.

**Any lock-screen surface.** A voter's street address readable by someone who has not unlocked the
phone is a new kind of exposure. No sentence in the Privacy Policy, the Terms, or the DPA is made
false by it, but the DPA promises we will not materially decrease the overall protection of personal
information, and a customer could reasonably point at that. The owner decides. The honest design is
opt-in per canvasser, address and progress only, never a name, and nothing that reads location while
the phone is locked. That last part is not negotiable: the Privacy Policy says we do not track
location continuously or in the background, and both app-store permission prompts say the same.

## Decisions taken (owner, 2026-09-04)

1. **Both, friction first.** Ship the cheap fixes now so the field feels it this week, then build
   real parity once we know what RightInsight actually does.

   **The second half is now answered, and it dissolves.** RightInsight has no canvassing
   lock-screen feature (fact 22). There is no parity to build. The over-the-lock-screen surface the
   canvasser saw belongs to its phone dialer. So decision 1 collapses to its first half, which is
   the work already scheduled, and any lock-screen project from here has to justify itself as a new
   idea of ours rather than as catching up.
2. **Over the air only for now**, with the build-financed options costed so they can be chosen
   deliberately later. Section D.3 is that costing.
3. **Mixed fleet, both platforms matter.** An Android-only lock-screen feature would leave a gap
   people ask about, so any parity work has to carry an iPhone answer.
4. **Full walk screen on the lock screen** is the target if we build one. This was chosen before
   the RightInsight teardown came back; since there is nothing to match, treat it as the shape the
   feature would take *if* it is ever wanted on its own merits, not as a commitment.

   **One hard constraint on that choice, stated plainly: iPhone cannot do it.** No third-party app
   can render its own screen over the iOS lock screen, at any price, with any framework (fact 15).
   The most an iPhone can show is a card (a Live Activity) that opens the app after the normal
   unlock. So "full walk screen" is achievable on Android only, and the honest iPhone parity is the
   card. That is a platform limit, not a scoping decision.

   The second consequence is the privacy one: a full walk screen over the lock screen means voter
   names, party, age, and survey state are readable and operable by anyone holding the phone, and
   Android offers no system mitigation for it. Section D.2's glance-mode design (addresses and pins
   visible, names hidden until a PIN prompt) is the version that keeps the feature and shrinks the
   exposure. If the owner wants the unredacted version anyway, it needs an explicit
   PRIVACY_VERIFICATION stamp saying so and a considered answer to DPA §4.

Still open:

- **Keep screen on:** default off (recommended) or on; ten-minute release either way.
- **A side finding to check:** Google Play's permission list for the Doorline app shows "draw over
  other apps." Nothing in our code asks for that; the only place it appears is React Native's
  debug-only manifest, which should not be in a release build. Worth checking the last release
  build's merged manifest.

---

# Part 2 — Technical reference

## A. Verified facts the decisions rest on

Everything below was checked against the primary source or reproduced on 2026-09-04; the method is
in section J. Items marked *open* could not be settled without a device or the owner.

| # | Fact | How we know |
|---|---|---|
| 1 | `expo-keep-awake` 15.0.8 is a hard dependency of `expo@54.0.35`, is autolinked on both platforms, and its `android/` and `ios/` dirs are hashed into the current fingerprints (android `efdcd132…`, ios `190f0a92…`). So its native module is inside every installed build, and using it from JS is an OTA. Declaring it in `mobile/package.json` does not move the hash (dependencies are not a fingerprint source; only scripts are, and those are skipped). | `node_modules/expo/package.json`, `expo-modules-autolinking resolve`, `npx expo-updates fingerprint:generate`, a scratch-copy hash experiment |
| 2 | Those two hashes are the fleet today: `GET /api/build-status` on production answers `ok` for exactly them and `outdated` for older ones, so `MOBILE_CURRENT_RUNTIME_*` name them and no fingerprint input has changed since the 2026-07-28 builds. | Live production endpoint, read-only |
| 3 | `Linking.openURL` needs no native config on either platform: iOS `open(_:)` is explicitly exempt from `LSApplicationQueriesSchemes`, and Android `startActivity` needs no `<queries>`. Only `Linking.canOpenURL` needs them. The Expo SDK 54 template manifest declares one `<queries>` intent, for the **https** scheme (the merged manifest adds two non-maps intents from `expo-file-system` and `expo-sharing`), so `canOpenURL` of `geo:`, `comgooglemaps://`, or `waze://` is false today and making it true is a fingerprint change. Apple has since deprecated `canOpenURL` (iOS 27: "prefer attempting to open URLs and handling any failures") and caps the schemes list at 25 for apps linked on iOS 27+, so open-and-catch is the vendor's own recommendation. | Apple `canOpenURL` reference; Android package-visibility docs; `expo/template.tgz` (expo-template-bare-minimum 54.0.52) manifest; RN 0.81.5 `IntentModule.kt` and `RCTLinkingManager.mm` |
| 4 | `react-native-map-link` 3.13.0 is pure JavaScript, so installing it does not move the fingerprint; but it detects every app via `canOpenURL`, so without its config plugin (25 `LSApplicationQueriesSchemes` entries plus `geo`/`waze` `<queries>`) it shows almost nothing on iOS, and adding that plugin to `app.json` is a fingerprint change (measured). A hand-rolled sheet of https links does the same job with neither. | npm tarball read; scratch-copy fingerprint experiment |
| 5 | Google Maps https URLs (`/maps/dir/?api=1&destination=…&travelmode=walking`, `/maps/search/?api=1&query=…`) open the native Google Maps app on both platforms when it is installed and not disabled (universal link on iOS, verified App Link on Android) and Google Maps in the browser otherwise, so the link is never dead. | Google Maps URLs docs; `google.com/apple-app-site-association`; `google.com/.well-known/assetlinks.json` |
| 6 | Apple Maps has two URL generations: legacy `https://maps.apple.com/?daddr=<address>&dirflg=w` and the unified `https://maps.apple.com/directions?destination=<address>&mode=walking` documented for iOS 18.4+. Apple treats the legacy parameters as aliases of the unified ones: `maps.apple.com` answers HTTP 301 rewriting every legacy form to its unified path (`?daddr=<addr>&dirflg=w` becomes `/directions?mode=walking&destination=<addr>`, reproduced 2026-09-04), the unified doc deprecates nothing, and post-18.4 forum traffic shows `daddr=<address>` still starting directions; the one reported regression concerned a **coordinate** destination. So the legacy address form is the one URL that works on every iOS version; the unified form is not documented below 18.4. | Apple archived Map Links doc; Apple unified-map-URLs doc; live redirect table from `maps.apple.com`; Apple forum threads 784030 and 787788 |
| 7 | No maps URL carries an address plus a coordinate fallback; the only secondary key is a place ID. Address-first is one URL; a coordinate link would be a separate action. | Google and Apple URL docs |
| 8 | Android `geo:0,0?q=<address>` resolves to any app registering `geo:` (Google Maps and Waze both do); RN calls `startActivity` directly with no chooser, so the phone's default handler opens, or the system asks when there is none. If nothing handles it, RN rejects the promise, so JS can fall back to the Google https URL. | Android common intents doc; RN `IntentModule.kt` |
| 9 | RN's `Alert` shows at most three buttons on Android; `ActionSheetIOS` is exported from `react-native` 0.81.5. | `Libraries/Alert/Alert.js:96`; `index.js:157` |
| 10 | `Activity.setShowWhenLocked` / `android:showWhenLocked` (API 27) keeps the resumed activity fully interactive above a secure keyguard, but only when it was the top activity when the phone locked; an app cannot pull itself onto the lock screen from the background. It adds no permission. No installed module exposes it, so both a manifest config plugin and a Kotlin Expo module move the fingerprint. Xiaomi/HyperOS additionally gates it behind a per-app "Show on Lock screen" permission. | Android `Activity` reference; grep of every `android/` dir under `node_modules`; scratch-copy `expo config --type introspect` and fingerprint experiments |
| 11 | A plain local notification with `sticky: true` (ongoing) and channel `lockscreenVisibility` PUBLIC/PRIVATE stays on the lock screen with no service and no battery cost, but can only be updated while the app runs. A foreground service is only needed to keep updating in the background; Android 14+ requires a declared type plus a Play Console declaration with video, and the only honest types for us are `location` (needs background location, which we forbid) or `specialUse` (reviewed). `notifee` was archived 2026-04-07. | Android notifications and FGS docs; `expo-notifications` 0.32.x source |
| 12 | Adding `expo-notifications` unconditionally links `com.google.firebase:firebase-messaging:24.0.1` and adds `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED`, even for local-only use. That makes the "no push SDK (no FCM/APNs)" verified negative in PRIVACY_VERIFICATION G15 literally false and needs a correcting stamp; it falsifies no published policy sentence while push is never sent. Sending push would be a DPA §6 purpose change. | `expo-notifications` tarball `android/build.gradle` and manifest |
| 13 | Android 16 Live Updates: `Notification.ProgressStyle` is API 36, but the promoted-ongoing treatment (`setRequestPromotedOngoing`, `POST_PROMOTED_NOTIFICATIONS`) is API 36.1 (Android 16 QPR1); reach today is Pixel on 16 QPR1+ and Samsung One UI 8+ (Now Bar). Neither `expo-notifications` nor `notifee` has any of it; it is a custom Kotlin module. "Quick access to app features" is a disallowed use; navigation is an allowed one. | Android reference and Live Update guide |
| 14 | Third-party lock-screen widgets on phones exist only on Pixel 6 to 10 with Android 16 QPR2 (Dec 2025), opt-in, content visible while locked, tap requires unlock. Samsung support unconfirmed as of One UI 8.5. `react-native-android-widget` 0.22.1 would do it and is a native release. | Android Developers Blog widgets FAQ; press coverage; npm tarball |
| 15 | iOS has no equivalent of `showWhenLocked`. Its lock-screen surfaces for apps are notifications, Live Activities (ActivityKit, iOS 16.1+, 8h active plus 4h lingering, 4 KB state, app must be foreground to start, updates from the app or push), and accessory widgets (monochrome, 40 to 70 refreshes a day). Guided Access and Assistive Access are user-side accessibility modes. | Apple ActivityKit, WidgetKit, and support docs |
| 16 | Every iOS lock-screen surface is a native change: a WidgetKit extension target, `NSSupportsLiveActivities`, an extension bundle id and its EAS credentials (App Groups only if the app and the card share data on disk). And it is four builds, not two: the fingerprint hashes the whole resolved `app.json` as one source with no per-platform pruning, so an iOS-only key moves the Android hash too (measured). The official `expo-widgets` does not exist for SDK 54 (first alpha 55.0.0 in Jan 2026, stable in SDK 56, current 57.0.17, no `sdk-54` tag); the upgrade target would be SDK 57, since SDK 54 is on critical-fixes-only support. The SDK 54 route is `@bacons/apple-targets` v5 with hand-written SwiftUI/ActivityKit; `expo-live-activity` (Software Mansion Labs) was archived and npm-deprecated 2026-06-01. | Expo SDK changelogs and docs; package READMEs; scratch-copy fingerprint experiment |
| 17 | Adding `LSApplicationQueriesSchemes` to `app.json` moves both fingerprints (measured; the config is hashed whole), so any "which maps apps are installed" probe is a four-build change. It would also be pointless: `canOpenURL` cannot tell whether a universal-link app such as Google Maps is installed, which is part of why Apple deprecated it. | Scratch-copy fingerprint experiment; Apple `canOpenURL` reference |
| 18 | A lock-screen surface that reads GPS while the phone is locked or the app is not visible contradicts three promises at once: `privacy.html` line 94 ("we do not track location continuously or in the background"), both `app.json` permission strings ("It is never tracked continuously or in the background"), and the C9 grep contract in PRIVACY_VERIFICATION. Android itself classes a location-typed foreground service as foreground access that survives the screen turning off, and Google Play requires a declared service type with a demo video for it; either way it reads GPS while the phone is locked, which is the promise we made not to break. A card that only displays the already-loaded next door touches none of them. | `client/public/privacy.html:94`; `mobile/app.json`; PRIVACY_VERIFICATION §C9; Play policy |
| 18b | **A trap in our own stack:** `expo-location` ships a `LocationTaskService` declaration in its manifest, so Doorline's merged manifest already carries it (dormant; the plugin flags that arm it are off, and the C9 grep contract is what keeps it that way). Turning on `isAndroidForegroundServiceEnabled` / `isAndroidBackgroundLocationEnabled` would produce an ongoing lock-screen card without adding `expo-notifications` at all. **Do not.** It is a location-typed service, so it reads GPS while the phone is locked, which is precisely what fact 18 forbids, and it is a config change (four builds), not an OTA. | `mobile/node_modules/expo-location/android/src/main/AndroidManifest.xml`; the plugin's `withLocation.js` |
| 19 | A lock-screen surface showing a voter's address makes no published sentence false (neither `privacy.html`, `terms.html`, nor `DPA.md` mentions the device lock), fires the repo's "what we expose" trigger, and engages DPA §4 ("shall not materially decrease the overall protection of Personal Information"). Owner decision. | `terms.html:87-88`; `DPA.md` §4; PRIVACY_VERIFICATION triggers |
| 20 | The Directions hand-off is the same class as PRIVACY_VERIFICATION v6 item 15 (the web Pin Fixes "Google Maps" link): user-initiated, per door, from the user's own device, nothing prefetched or server-side, so not a DPA §6 subprocessor (§6 covers parties Doorline engages "to provide the Service"; no contract or API key attaches to a maps URL) and no `privacy.html` edit. Item 15 is the doc's recorded reasoning, accepted by commit, not a marked owner ruling. Play's Data safety definition of "sharing" explicitly includes on-device transfer to another app; the feature is exempt only through "transferring user data to a third party based on a specific user-initiated action, where the user reasonably expects the data to be shared," so the exemption is conditional on the explicit per-door tap. The next v6 stamp number is 20 (the "20." further down the file belongs to the v1 counsel-brief list). | PRIVACY_VERIFICATION.md:1124-1145; DPA.md §6; Play Data safety help |
| 21 | Competitor census (17 shipped Android manifests, re-verified independently 2026-09-04: zero matches for `showWhenLocked`, `turnScreenOn`, or an `APPWIDGET_UPDATE` receiver across all of them). **Scope limit, load-bearing:** a manifest census can only rule out the declared surfaces (a lock-screen activity, a widget). Lock-screen presence for a *notification* is set at runtime via `setVisibility` and is invisible to any manifest, so this census cannot say whether a competitor shows a lock-screen card. Findings: no `showWhenLocked`/`turnScreenOn` activity, no app-widget receiver, no own-code Live Update call in any of them; the two keyguard-adjacent permissions (`DISABLE_KEYGUARD`, `USE_FULL_SCREEN_INTENT`) appear in exactly the three apps that also ship Twilio Voice's `VoiceService`, so they are phone-banking plumbing rather than a canvassing feature; only SalesRabbit can actually run a location foreground service. The test that matters is a declared location-typed service **and** the matching permission, and only SalesRabbit passes both: Spotio holds the permissions but declares no location service (its one typed service is Twilio's, microphone plus short-service), while BlueVote and Pulsar declare location-typed services without the permission that would let Android 14+ start them. Per-house directions are universal (Google Maps https URLs, `geo:` intents, `maps.apple.com`, `waze://`), labeled "Directions", "Get Directions", or "Navigate". Pulsar (Campaign Sidekick) is Expo SDK 54, our stack. | APK manifests and bundle strings; store listings; vendor help centers; about 1,100 Play reviews |
| 22 | **RightInsight (`com.rightinsight.android`, Right Insight LLC, Expo SDK 53, 1K+ installs, v2.3.0 of 2026-08-27) has no canvassing lock-screen feature.** Read from the shipped APK (manifest + four dex files) and from the live OTA JavaScript for both 2.2.0 and 2.3.0, pulled from Expo's update server. Zero hits for `setShowWhenLocked`, `setTurnScreenOn`, `FLAG_SHOW_WHEN_LOCKED`, `requestDismissKeyguard`, `showWhenLocked`, `KeepAwake`/`activateKeepAwake`/`useKeepAwake`, `requestPromotedOngoing`, `ProgressStyle`, `AppWidgetProvider`, `APPWIDGET_UPDATE`, `foregroundService`, `TaskManager`, `defineTask`. Its only activity is `MainActivity` with neither lock-screen attribute. The searches were shown not to be silently failing by returning 579 hits for `voter` and 3 for `CanvassingMap` on the same files. Its `DISABLE_KEYGUARD` + `USE_FULL_SCREEN_INTENT` + `SYSTEM_ALERT_WINDOW` sit beside `com.twiliovoicereactnative.VoiceService` and the dex strings `createIncomingCallNotification` and `setFullScreenIntent`: **phone banking**. It declares `expo.modules.location.services.LocationTaskService` (location-typed) but holds no `FOREGROUND_SERVICE_LOCATION` and no `ACCESS_BACKGROUND_LOCATION`, so it cannot start it — the same dormant declaration Doorline carries (fact 18b). Its iOS release notes across 20+ versions never mention a lock screen; the feature entries are calling, a power dialer, and offline tasks. | The shipped XAPK 2.2.0 from a mirror; the live `u.expo.dev` bundles for 2.2.0 and 2.3.0; Play and App Store listings |
| 23 | **RightInsight's per-house directions use `react-native-map-link` with its defaults unchanged**: the bundle carries `showLocation`, `getDirectionsModeGoogleMaps`/`AppleMaps`/`Sygic`, the URLs `https://www.google.com/maps/dir/?api=1`, `https://www.google.com/maps/search/?api=1&query=…&query_place_id=…`, `comgooglemaps://` and `waze://`, and the library's hardcoded popup strings "Open in Maps" and "What app would you like to use?". Its manifest carries the matching native `<queries>` for `geo`, `waze`, `https` and the Google Maps package — the config-plugin change fact 4 says the library forces. Component `MapNavigationButton.tsx`; iOS 1.4.1 (2024-07-24) announced it as "Ability to navigate to homes from the map." No `geo:0,0?q=` and no `maps.apple.com`. | Same artifacts |

## B. Directions link — as built (2026-09-05)

### B.1 Surfaces and what each has in hand

Every household in the bootstrap cache carries `addressLine1`, `addressLine2`, `city`, `state`,
`zipCode`, and `location.coordinates` `[lng, lat]`, because the bootstrap projection sends all of
them and its filter drops doors without coordinates ([bootstrap.js](../server/src/routes/mobile/bootstrap.js)
lines 268-292). The delta poll patches existing doors only and never removes address parts, so the
canvasser surfaces need no server change.

| Surface | File | Address parts | Coordinates | Button |
|---|---|---|---|---|
| Door screen address card | [household/[id].jsx](../mobile/app/(app)/household/[id].jsx) | full | yes | **Built** — under the city line |
| Map pull-up sheet | [map.jsx](../mobile/app/(app)/map.jsx) selected-house sheet | full | yes | **Built** — a link under the city line, *not* a third button beside Open/Close: three buttons crowd the sheet, and this matches the door screen's grammar. **`HOUSE_PEEK_HEIGHT` went 220 → 248** with it; see below |
| Building screen | [building.jsx](../mobile/app/(app)/building.jsx) | full (building address, no unit) | yes | **Built** — under the units summary |
| House list rows | [DoorListRow.jsx](../mobile/components/DoorListRow.jsx) | full | yes | No: the row carries the quick-action; the door screen is one tap away |
| Survey screen header | [voter/[id]/survey.jsx](../mobile/app/(app)/voter/[id]/survey.jsx) ~L419-425 | full | yes | No: the canvasser is at the door |
| Admin map house sheet | [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | full | yes | **Built** (lead/admin) — above the pin badges |
| Overlap detail | [admin/overlap/[householdId].jsx](../mobile/app/(app)/admin/overlap/[householdId].jsx) | full | yes | **Built** (lead/admin) |
| Voter profile, Household card | [voters/[id].jsx](../mobile/app/(app)/voters/[id].jsx) | full (`buildVoterProfile` sends line1/city/state/zip) | yes | **Built** (management-only screen) |
| Lead's book map sheet | [admin/book/[turfId].jsx](../mobile/app/(app)/admin/book/[turfId].jsx) | `addressLine1`, `city`, `state` only | yes | **Deliberately omitted.** It would work (the builder drops a missing zip cleanly), but this release is JavaScript-only on purpose; adding `zipCode` to [turfs.js](../server/src/routes/admin/turfs.js) is an additive server change for a later one |
| Voter search rows | [voters/index.jsx](../mobile/app/(app)/voters/index.jsx) ~L89 | no `zipCode`, no coordinates | no | No: tap through to the profile |
| Canvasser drill-in lists | `admin/canvasser/[id]/*` | parts only | no | No |

### B.2 The URL builder

[`mobile/lib/mapsLinks.js`](../mobile/lib/mapsLinks.js) — one pure module, no React and no
`Linking`, so `node --test` can pin every URL through the root `test:mobile` script. (Never add a
script to `mobile/package.json`: that moves the fingerprint. See the mobile README's OTA rules.)

It exports `addressQuery`, the five URL builders (`googleDirectionsUrl`, `googleSearchUrl`,
`appleDirectionsUrl`, `wazeUrl`, `geoUrl`), plus `directionsOptions(household, platform)` which
returns the per-platform rows in order, and `canGetDirections`.

The decisions encoded there, each with its reason in the file's own comments:

- **The address, never the pin.** `addressQuery` mirrors the web helper's join exactly
  ([pinFixes.js](../client/src/lib/pinFixes.js)): `addressLine1`, `city`, `"ST zip"`, dropping
  whatever the voter file lacks. A coordinate link would faithfully route to our own possibly-wrong
  spot, which is the bug this feature exists to route around. A test asserts no builder ever emits
  a coordinate.
- **The unit is left off**, on the door screen and the building screen alike. A unit never changes
  the walking route and confuses geocoders.
- **Apple gets the legacy `?daddr=…&dirflg=w` form on every iOS version**, with no version branch.
  Apple's own server 301-rewrites it to the documented unified `/directions` URL, and the unified
  form is documented only for iOS 18.4 and later, so the legacy one is the single URL that works
  everywhere (fact 6).
- **Only `https:` and `geo:`.** A test enforces it. `comgooglemaps://` and `waze://` would work
  with `openURL`, but having them present invites a `canOpenURL` probe, and that needs native
  config, which moves both fingerprints and costs four store builds (facts 3 and 17).
- **`canGetDirections`** hides the affordance on a door with no street line, rather than opening a
  maps app onto `", Kissimmee, FL"`.

Never call `Linking.canOpenURL` (fact 3). Every open is `Linking.openURL(url)` with a `.catch` that
falls back to the Google search URL, which always has a handler, so a tap cannot dead-end.

### B.3 The button and the sheet

One presentational component, [`components/DirectionsButton.jsx`](../mobile/components/DirectionsButton.jsx),
used on every surface in B.1. It takes a household (or a building — the shapes agree on the fields
that matter) and renders a brand-colored link in the same grammar as "Fix pin location →":
`colors.brand`, 13, weight 700, `hitSlop` 6. It renders nothing when `canGetDirections` is false, so
a door with no street line simply has no link.

It has one shape, the link. An outlined `variant="button"` existed briefly for the map sheet's
Open/Close row and was **removed**: that placement was rejected during the build (three buttons
crowd the sheet on a phone), which left the variant unreachable and its own comment contradicting
the decision recorded in `map.jsx`.

Door screen address card, after the change (the badge row below it is unchanged):

```
845 Collier Ct                              [ Not home ]
Kissimmee, FL 34741
Directions →
────────────────────────────────────────────────────────
Last visit 2 days ago
```

The tap, per platform:

- **iOS:** `ActionSheetIOS.showActionSheetWithOptions({ title: addressQuery(h), options: ['Apple
  Maps', 'Google Maps', 'Waze', 'Cancel'], cancelButtonIndex: 3 })`. The rows are named by the
  platform convention; the link says "Directions" because both maps apps reserve "Go" and "Start"
  for beginning turn-by-turn.
- **Android:** an `Alert` with Cancel, then the rows through `androidAlertOrder`. Three buttons is
  Android's cap (fact 9). "Another maps app" opens `geoUrl(h)`, so a Waze user gets Waze and a
  phone with no default gets the system chooser.

  **The array order is not the drawn order, and getting it wrong is silent.** React Native assigns
  Android's three slots by popping from the *end* of the array — positive, then negative, then
  neutral — and Android draws them neutral, negative, positive from left to right with positive
  emphasized. Passing the rows in the obvious order and Cancel last therefore puts **Cancel** in
  the emphasized position under the thumb, so the tap that should open Google Maps dismisses the
  dialog. `style: 'cancel'` is no protection: the Android branch never reads it. Hence Cancel
  first and the rows reversed, which matches the repo's other three-button alert in
  `admin/notes.jsx`. A test replicates React Native's own pop logic and asserts both the correct
  mapping and the naive-order regression.

Walking mode is the default because the canvasser is on foot between doors; the maps app lets them
switch. There is no "remember my choice" preference: Android already remembers a default for
`geo:`, and the iOS sheet is one tap.

### B.3a The one non-obvious edit: the sheet's peek height

The map's pull-up sheet has a **fixed** peek height (`HOUSE_PEEK_HEIGHT`), and everything past it
is off-screen until the sheet is dragged open. Adding a row inside the peek header therefore spends
headroom that something else was using.

Measured against the peek's content stack, the pre-change content came to roughly 184pt of the
220pt budget, and the Directions row adds about 25pt. That still fits on one line — but
`sheetAddress` has no `numberOfLines`, so a long `addressLine1, addressLine2` wraps to two lines and
adds another ~21pt. That case fit before at ~205pt and would have overflowed after at ~230pt,
pushing **Open** and **Close** out of view at rest, on exactly the long addresses most likely to be
apartments.

`HOUSE_PEEK_HEIGHT` is therefore **248**, which leaves the two-line case ~18pt of headroom.
`HOUSE_EXPANDED_HEIGHT` is unchanged at 460, so the sheet still opens to the same size and only the
drag distance shrinks. This is the one edit in the change that is not purely additive, and it is the
reason a "just drop a link in" change touched a layout constant.

### B.3b Where the link sits, and why it moved twice

Two placements changed during review, both for the same reason: the link is brand-colored and
carries an 8pt top margin, while the lines it was spliced between sit 2–4pt apart. Inserted into
such a block, it stops reading as a trailing action and starts reading as a heading for whatever
follows it.

- **Voter profile** — moved *below* the `Campaign: …` line, so the address block stays contiguous.
- **Admin map sheet** — moved *below* the pin badges. `coordChipCorrected` is itself
  `colors.brand`, so a brand link 4pt above "● Pin corrected" read as part of that group.

Where the link already had a real separator below it, it stays put: the door screen's last-visit
block has a top border, and on the map sheet, the building screen and the overlap detail nothing
follows it inside its container.

The link variant also carries `alignSelf: 'flex-start'` in the component itself. In a column
layout a `Pressable` stretches to the full row width, so without it the tap target extended far to
the right of the words — into empty space beside the address.

### B.4 Fallbacks and edge cases

- Chosen app not installed: iOS rejects the open when no app handles the scheme; the https Google
  and Apple URLs always have a handler (the browser), so a rejection only happens for a phone with
  no browser. Android rejects when nothing handles `geo:`; the catch opens the Google https URL in
  the browser.
- Address that the maps app cannot resolve: Google shows its best guess or "can't find"; Apple shows
  "No Results" or "Directions Not Available." That fuzziness is the feature: the canvasser is asking
  for the maps app's independent opinion of the address. Our pin is still on our map.
- Apartment buildings: the building's `addressLine1` without a unit; a unit never changes the
  walking route and can confuse geocoders.
- Google Maps on iOS: the https link is a universal link the Google Maps app claims, but iOS keeps a
  per-domain "open in Safari" breadcrumb preference; if a user once chose Safari, the link opens the
  web version, which still works. *Open:* device check.

### B.5 Tests

[`mobile/lib/mapsLinks.test.js`](../mobile/lib/mapsLinks.test.js), 12 tests, run via the root
`test:mobile` script. The mobile suite goes 93 → 105, all green. What they pin:

- The address join matches the web helper on the web helper's own fixture: `845 Collier Ct,
  Kissimmee, FL 34741` encodes to `845%20Collier%20Ct%2C%20Kissimmee%2C%20FL%2034741`, the exact
  string `client/src/lib/pinFixes.test.js` expects. The two must not drift.
- **No builder ever emits a coordinate.** This is the load-bearing one: a wrong pin is the reason
  the feature exists, so a coordinate reaching a maps app would defeat it.
- Missing address parts are dropped, never rendered as "undefined", including the trailing-space
  case where a door has a state but no zip.
- Each URL carries the encoded query exactly once, and the exact five URL strings are asserted
  verbatim, so a silent edit to any of them fails here.
- An ampersand in a street name is encoded, since unencoded it would truncate the destination at
  `12 O'Brien `. An apostrophe deliberately passes through literally, pinned so nobody "fixes" it
  and breaks the byte-for-byte match with the web helper.
- Every option on both platforms is `https:` or `geo:`, never a custom scheme.
- Walking mode is present on both providers that take one.
- **The Android button slots**: Cancel lands in the leftmost throwaway slot and Google Maps in the
  emphasized one, asserted by replicating React Native's own pop logic — plus the inverse, that the
  naive array order would put Cancel under the thumb. `androidAlertOrder` is also asserted not to
  mutate its input.

### B.6 Docs and Help Center cascade (done)

- [CANVASSER_APP.md](CANVASSER_APP.md) — Part 1 "At the door" (a "Getting to the house" paragraph)
  and the pin-in-the-wrong-place section; Part 2 "The door screen" (the component, the never-a-pin
  and never-`canOpenURL` rules).
- [MAPS.md](MAPS.md) — Part 1 "The mobile canvasser map"; Part 2 "J. Frontend file map".
- Help Center: `guides/canvasser-map.md` (the pull-up panel gains Directions),
  `getting-started/canvasser-first-day.md` (step 6 links to the new FAQ), the new
  `faq/directions-to-a-house.md`, and a `faq/_INBOX.md` triage line. Every internal
  `[label](slug)` link on the touched canvasser-audience pages was checked against
  `helpArticle(slug, 'canvasser')` so none points at an article a canvasser cannot see — the
  lead-only `fix-pin-location` guide is referenced only from the inbox file, which is not served.

### B.7 Privacy stamp (PRIVACY_VERIFICATION v6, item 20)

Same class as item 15 (recorded reasoning, not a marked owner ruling; the stamp should say so and give the owner the chance to mark it), recorded with the two differences: the actor is a canvasser rather than staff
(already an authorized reader of the address under the policy's "within your organization"
paragraph), and the recipient is whichever maps app the canvasser or the OS picks, including Waze,
under the canvasser's own account. Nothing is prefetched, nothing is server-side, no Doorline SDK
sends anything. Not a DPA §6 subprocessor; no `privacy.html` edit; a Play Data safety "sharing"
event only in form, exempt through the user-initiated exception, which the explicit per-door tap
and named app choice are what satisfy. If the link is ever automated (prefetch, an embedded Google
map, server-side Google geocoding), that is the §6 event, exactly as item 15 says. Fold in the C9
drift noted in section G.

### B.8 Release

JavaScript and Help Center content only. Verified on the finished change, 2026-09-05:

- **Both fingerprints are byte-identical to the fielded builds** after every edit — android
  `efdcd132f39f115ac4dd02a5e13611ba8014e098`, ios `190f0a929f00cd6ef4cbdd56b54f4e0ba6f9269f` —
  regenerated with the same resolver `ota:check` uses. Nothing native moved, so this is a true OTA.
- `npm run audit:mobile-api`: no server route or service files changed, nothing to check.
- No `CLIENT_API_VERSION` bump: the server contract is untouched.
- Tests: mobile 93 → **105** green, server unit **280** green, client **321** green (untouched, run
  as a collateral guard).
- The help articles ship **with the server**, so the FAQ and guide changes reach both clients on a
  normal server deploy with no app release.

**Publish to staging now; production is gated.** `npm run ota:staging` from the branch, confirm on a
staging phone, merge. **Do not run `npm run ota:production` until the owner's `privacy.html` edit
lands** — that gate is item 16's, not this feature's, and it is explained under "The ship gate" in
Part 1. `ota:check` runs ahead of both and is the backstop that the tree still matches the fleet.

## C. Keep screen on — design (NOT BUILT; kept as a costed option)

### C.1 Mechanism

[expo-keep-awake](https://docs.expo.dev/versions/v54.0.0/sdk/keep-awake/) 15.0.8: `useKeepAwake(tag)`,
`activateKeepAwakeAsync(tag)`, `deactivateKeepAwake(tag)`. Native side: `FLAG_KEEP_SCREEN_ON` on the
window (Android) and `UIApplication.isIdleTimerDisabled` (iOS). Both only hold the screen while the
app's window is visible; backgrounding releases it automatically, and the power button always locks.
No permission, empty manifest. Already compiled into the fleet (facts 1 and 2).

Declare `"expo-keep-awake": "~15.0.8"` in `mobile/package.json` `dependencies` so the import is not
riding on npm hoisting; this is fingerprint-neutral (measured), but never touch the `scripts` block
in the same edit.

### C.2 Preference, context, and toggle

- `lib/cache.js`: `KEEP_AWAKE_KEY = 'canvass.keepAwake'` beside `THEME_KEY`, with
  `saveKeepAwakePreference` / `loadKeepAwakePreference` following the theme pair (lines 411-420).
- `lib/KeepAwakeContext.jsx` mirroring [ThemeContext.jsx](../mobile/lib/ThemeContext.jsx): load once,
  `setKeepAwake(on)` persists. Default **off** (Part 1 explains why; the owner may flip it).
- `components/KeepAwakeToggle.jsx`: a two-option segmented control in the [ThemeToggle.jsx](../mobile/components/ThemeToggle.jsx)
  grammar, mounted where the theme toggle lives: the canvasser drawer's Appearance section
  ([CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx) ~L187-190), admin More
  (~L206-211), super-admin More (~L94-96). Label: "Keep screen on while canvassing."
- A one-time hint on the map (a dismissable line under the context card, stored under
  `canvass.keepAwakeHintSeen`) so canvassers learn it exists.

### C.3 Hook placement and the idle release

- `lib/useCanvassKeepAwake.js`: reads the preference, calls `activateKeepAwakeAsync('canvass')` on
  mount when on and `deactivateKeepAwake('canvass')` on unmount and whenever the preference flips.
- Mounted on the field screens only: the houses map (inside the real render tree, never at the top of
  `MapScreen`, because the map has five bail-out early returns and a top-level hook would hold the
  screen on the loading and error screens), the door screen, the building screen, and the survey
  screen. Admin screens do not hold the screen.
- Idle release: the screen root `View` of each field screen gets `onTouchStart={markActive}`; a
  ten-minute timer since the last touch calls `deactivateKeepAwake`, and the next touch
  re-activates. Timer cleared on unmount.
- One tag (`'canvass'`) everywhere, so overlapping screens (door pushed over the map) never leave a
  stale activation behind; the last unmount releases it.

### C.4 What it does not touch

Nothing in the location or polling rules changes: [PERFORMANCE.md](PERFORMANCE.md) rule 1 ("backgrounded
app → everything stops") stays true because the screen is released the moment the app is not in
front. No privacy stamp is needed (no new data, no new recipient); mention it in PERFORMANCE.md Part
1 when it ships so the battery narrative stays complete.

## D. Android lock-screen surfaces, if the owner wants one

All four routes are native releases: four builds, two store reviews, and the `MOBILE_CURRENT_RUNTIME_*`
re-point afterwards (see the mobile README and the repo CLAUDE.md). None is OTA.

| Route | What the canvasser sees | Native change | Reach | Exposure while locked | Verdict |
|---|---|---|---|---|---|
| D.1 Sticky "current door" notification | A card on the lock screen: "Doorline · 12 of 40 doors / Next: 845 Collier Ct"; tap opens the app after unlock | `expo-notifications` (bundles FCM client; fact 12) | Every Android 8+ phone | Configurable: PRIVATE hides the body; PUBLIC shows the address | **Best value for risk** if a lock-screen surface is wanted |
| D.2 Walk screen over the lock screen | Press power and the map or list is there, tappable, no PIN | Local Kotlin Expo module, per-screen `setShowWhenLocked` | Every Android 8.1+ phone (Xiaomi needs a manual permission) | The signed-in walk screen, mitigated only by our own redaction | The literal feature; only with glance-mode redaction and per-user opt-in |
| D.4 Live Update (promoted notification) | D.1's card pinned at the top of the shade, expanded on the lock screen, status-bar chip, AOD outline | Custom Kotlin on top of D.1; API 36.1 | Pixel 16 QPR1+, Samsung One UI 8+ | Same as D.1 PUBLIC | Layer on D.1 later |
| D.5 Lock-screen widget | A "Next doors" widget on the lock-screen widget page | `react-native-android-widget` | Pixel 6 to 10 on 16 QPR2+, opt-in | Widget content visible; tap needs unlock | Skip until OEMs ship it |
| Not an option | A location foreground service keeping the card live in the background | FGS `location` type + Play declaration | | Continuous location while locked | **No**: contradicts the location promise (fact 18) and the battery advantage |

### D.1 Sticky notification, the design

```js
// once, on the first walk: channel importance LOW (no sound), visibility from the user's setting
await Notifications.setNotificationChannelAsync('walk', {
  name: 'Current door', importance: Notifications.AndroidImportance.LOW,
  lockscreenVisibility: showAddressWhenLocked ? PUBLIC : PRIVATE,
});
// on every door change (bootstrap fold, recorded action, book switch):
await Notifications.scheduleNotificationAsync({
  identifier: 'walk-card',
  content: { title: `Doorline · ${done} of ${total} doors`, body: `Next: ${addressLine1}`, sticky: true, autoDismiss: false },
  trigger: null,
});
// on leaving the campaign, signing out, or the app being killed: dismiss 'walk-card'
```

- "Next" is the first unknocked entry of the map's list order (walk order, or nearest when a fix is
  present), which the map already computes (`listEntries` in map.jsx ~L695-737); done/total are the
  context card's numbers (~L359-369). Never a voter's name.
- Two user settings: "Show my next door on the lock screen" (off = PRIVATE, so the lock screen shows
  only the title; on = PUBLIC) and the master on/off. Both default off.
- Android 13+ needs the `POST_NOTIFICATIONS` runtime prompt at the start of a walk; Android 14+
  lets the user swipe an ongoing notification away while unlocked, so re-post on the next change.
- Paperwork: a PRIVACY_VERIFICATION stamp correcting G15's "no FCM" negative (fact 12) and recording
  the exposure ruling; before the stamp, capture network traffic on a built binary to confirm the
  bundled Firebase client sends nothing without `google-services.json`. Push is never used; the day
  it is, that is a DPA §6 event.

### D.2 Walk screen over the lock screen, the design

```kotlin
// modules/lock-screen/android/.../LockScreenModule.kt (Expo Modules API; API 27+ guarded)
class LockScreenModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LockScreen")
    AsyncFunction("setShowWhenLocked") { on: Boolean ->
      appContext.currentActivity?.let { a -> a.runOnUiThread { a.setShowWhenLocked(on); a.setTurnScreenOn(on) } }
    }
    Function("isKeyguardLocked") {
      (appContext.reactContext?.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    }
    AsyncFunction("requestUnlock") { promise: Promise ->  // KeyguardManager.requestDismissKeyguard
      ...
    }
  }
}
```

- Only the houses map, list, door, and building screens call `setShowWhenLocked(true)` on focus and
  `false` on blur, and only when the per-user setting "Show Doorline on the lock screen" is on
  (default off). Admin screens, login, and the survey never do.
- **Glance mode:** while `isKeyguardLocked()` is true the screens hide voter names, party, age, and
  survey state, showing addresses, pins, statuses, and progress only. Any tap that would record or
  open a voter calls `requestUnlock()` first; the PIN prompt appears and the action continues after
  it. That is the only mitigation Android offers for this route; there is no system setting.
- Battery: none by itself. The app is technically in the foreground while shown over the keyguard,
  so its normal foreground polling and the map's location feed keep running; that is foreground
  behavior under the published policy (the live position stays on the device), but PERFORMANCE.md
  rule 1 must be reworded, and the C9 narrative in PRIVACY_VERIFICATION must say so. Pair with
  keep-screen-on or the screen still times out.
- iOS gets nothing from this route (fact 15); the setting is Android-only and says so.

### D.3 What one build round buys, if we ever pay for one

The four builds and two store reviews are a **fixed toll, not a per-feature price**. Everything
native in this document can ride the same round for no extra release cost, because the fingerprint
moves once whether one native input changes or ten. That reframes the question from "is the lock
screen worth four builds" to "what else should be in the truck while it is going."

What a single round could carry, together:

| Rides along | Buys | Marginal cost inside the round |
|---|---|---|
| Kotlin `showWhenLocked` module (D.2) | The literal feature on Android: the walk screen over the lock screen, glance-mode redaction, PIN prompt before recording | ~15 lines of Kotlin plus the per-screen focus wiring |
| `expo-notifications` (D.1) | The lock-screen card on every Android 8+ phone, the fallback for phones where D.2 is awkward, and the foundation for anything later that needs to tell a canvasser something | A dependency, a channel, the permission prompt copy, and the G15 correction stamp |
| iPhone Live Activity (section E) | The honest iPhone half of parity: the card, the Dynamic Island, the tap-through | Either the SDK 54 → 57 upgrade (the real work, and the risk lives in Mapbox, Reanimated and expo-updates) or hand-written Swift via `@bacons/apple-targets` |
| SDK 54 → 57 upgrade itself | Two years of platform drift paid down at a moment we are already cutting builds, plus `expo-widgets` becoming available at all | Regression testing across the whole app; this is the item that decides the round's size |
| Android 16 Live Update (D.4) | The Now Bar and status-bar chip treatment on Pixel and Samsung | Custom Kotlin on top of D.1; skip unless D.1 lands first |

What it does **not** buy, at any price: an iPhone showing the walk screen over the lock screen
(fact 15), or anything that reads GPS while the phone is locked (fact 18, and it would break a
published promise).

**The sequencing this suggests.** The two over-the-air items ship now and are worth shipping whether
or not a build round ever happens. The native round is worth scheduling when at least two of these
are true: RightInsight's feature turns out to be something a card cannot imitate, the SDK upgrade is
due anyway, or a native build is already being cut for another reason. Cutting a round for the lock
screen alone is defensible only if the sales pressure is real, and the honest sales answer is that
half the fleet gets a card rather than the full screen.

## E. iOS lock-screen surfaces

There is no way to show an app over the lock screen (fact 15). The parity answer to D.1 is a **Live
Activity**: a Lock Screen and Dynamic Island card reading "Next: 845 Collier Ct · 0.1 mi" with a "12
of 40 doors" progress bar, started when a book is opened (app in foreground), updated from JS on
every recorded knock and book change, ended on leaving the campaign, auto-ended by the system after
eight hours (a shift fits; re-start each day). Tapping it deep-links to `canvass://household/<id>`
after the normal unlock. It is display-only while locked: Apple states that on a locked device a
Live Activity's buttons and toggles are inactive until the person authenticates, so a "Not home"
button on the card is not possible without unlocking. Never a voter's name (Apple HIG: never
sensitive information on a Live Activity).

Two ways to build it, both native releases (fact 16):

| Route | Requires | Notes |
|---|---|---|
| `expo-widgets` (official, JSX, Swift-free) | Upgrading mobile from SDK 54 to 57 (SDK 54 is on critical-fixes-only support; SDK 58 canaries began 2026-09-02) | Live Activities, home and Lock Screen widgets, push-to-start tokens. The upgrade's risk lives in `@rnmapbox/maps`, `react-native-reanimated`, and `expo-updates` compatibility; not assessed here |
| `@bacons/apple-targets` v5 on SDK 54 | Xcode 16, CocoaPods 1.16.2, hand-written SwiftUI + ActivityKit, a small Expo module to bridge start/update/end | Stays on SDK 54; more code to own; extension signing on EAS is described by the author as automatic but tested on one widget |

Lock Screen accessory widgets are a poor fit (monochrome, refreshed 40 to 70 times a day, so "next
door" lags by up to an hour); at most a "12/40 today" glance if a Live Activity ships anyway. Guided
Access is a user-side kiosk mode, not a feature; mention in help only if the owner wants.

Exposure: a Live Activity renders in full on a locked iPhone whenever the user's "Allow Access When
Locked → Live Activities" toggle is on (default on) and the per-app Live Activities switch is on;
"Show Previews" is a notifications setting and does not govern it. Same owner ruling as D.

## F. Release mechanics by change

| Change | OTA or builds | Gates |
|---|---|---|
| Directions button (https + `geo:` via `openURL`) | OTA | `ota:check`; staging lane first |
| Keep screen on (`expo-keep-awake`) | OTA | `ota:check`; never edit `mobile/package.json` scripts |
| Additive `zipCode`/`addressLine2` on the lead's book projection | Server deploy | `npm run audit:mobile-api`; additive, no `CLIENT_API_VERSION` bump |
| `expo-notifications` (D.1) | Four builds | `POST_NOTIFICATIONS` prompt copy; G15 correction stamp |
| Kotlin `showWhenLocked` module (D.2) | Four builds | Privacy ruling; PERFORMANCE rule 1 rewording |
| Live Update (D.4) | Four builds | Needs compile SDK 36.1 in the toolchain |
| `react-native-android-widget` (D.5) | Four builds | |
| Live Activity via `expo-widgets` (E) | SDK 57 upgrade + four builds | Extension credentials on EAS |
| Live Activity via `@bacons/apple-targets` (E) | Four builds | Xcode 16 for local iteration |
| Any `LSApplicationQueriesSchemes` or `<queries>` addition | Four builds | Avoid; not needed for `openURL` |

After any set of four builds: re-point `MOBILE_CURRENT_RUNTIME_ANDROID` / `MOBILE_CURRENT_RUNTIME_IOS`
in the Heroku dashboard once the stores serve the builds (repo CLAUDE.md).

## G. Privacy and policy reconciliation

| Feature | Trigger fired | Published sentence affected | Verdict |
|---|---|---|---|
| Directions | "What we expose" (an address handed to a maps app) | None; same class as item 15 | Stamp as item 20; no `privacy.html` edit; not DPA §6 |
| Keep screen on | None | None | No stamp |
| D.1 notification | "What we expose"; G15 verified negative ("no FCM") becomes false | None made false; `privacy.html:98` is about advertising trackers | Owner ruling on the lock-screen address; correcting stamp for G15; push never used or it is a §6 event |
| D.2 over the lock screen | "Who can access customer data" (a signed-in walk screen without the PIN) | None made false; DPA §4 non-regression engaged; `terms.html:87-88` put credential confidentiality and canvasser conduct on the user and the Customer | Owner ruling; glance-mode redaction; PERFORMANCE rule 1 and C9 narrative reworded |
| E Live Activity | "What we expose" | None made false | Owner ruling; address and progress only |
| Any background location | Everything | `privacy.html:94`, both permission strings, C9 grep contract, Play background-location policy | Not an option |

C9 drift to fold into the next stamp: the "`watchPositionAsync` → exactly one match" grep now hits
one call (`mobile/lib/useLocationFeed.js:53`) plus two comment lines (`useLocationFeed.js:74`,
`lib/locationFeed.js:32`); the background terms still return zero matches, verified 2026-09-04. Not a
finding in substance; the stamp should count call sites, not lines.

## H. Competitor census (17 shipped Android builds, 2026-09-04)

| App (package) | Stack | Lock-screen surface | Directions mechanism | Location foreground service |
|---|---|---|---|---|
| **RightInsight** (`com.rightinsight.android`) | Expo SDK 53 | **None.** Its only over-lock-screen surface is the Twilio dialer's incoming-call and in-call notifications | `react-native-map-link` defaults: Google Maps `dir`/`search` URLs, `comgooglemaps://`, `waze://` | Declares one, but holds neither permission, so it cannot start it |
| Pulsar by CampaignSidekick (`com.campaignsidekick.v3`) | Expo SDK 54 | None (its keyguard permissions are Twilio Voice's) | In-app route drawing ("Get Directions") | No |
| Numinar (`com.numinar.numinar`) | Expo | None (keyguard permissions are Twilio Voice's) | Google Maps `dir`/`search` URLs, `maps.apple.com` | No |
| i360 Grassroots (`com.i360.Volunteers`) | Xamarin | None | `geo:0,0?q=`; walkbook-level "Get Directions" | No |
| Patriot Pulse Door (`com.patriotpulse.door`) | Expo | None | In-app routing | No |
| MiniVAN (`com.voteractivationnetwork.minivan`) | Native | None | Google Maps `dir`/`search` URLs; per-pin directions since Oct 2024 | No (but heavy battery complaints) |
| PDI Mobile | Native | None | "Get Directions" below the assignment card (turf-level) | No |
| Ecanvasser Walk | Native | None | "Directions" | No |
| Grassroots Unwired | Xamarin | None | | No |
| Reach (`com.reachVoteTech`) | Expo | None | | No |
| Voter Science TRC, Campaign Knock, Knock Canvassing, LGCY Canvass, Active Knocker | Various | None | Google Maps / Waze strings where present | No |
| Knockbase (`com.SunbaseData.SalesApp`) | Unity | None | `waze` and `maps.google.com` strings | No (activity recognition for steps) |
| BlueVote (`com.sieena.bluevote`) | Flutter | None | | Declares two, but holds no `FOREGROUND_SERVICE` permission, so it cannot start them |
| Spotio (`com.spotio.app`) | RN | None (keyguard permissions are Twilio Voice's) | `waze://`, Google Maps | No: holds the permissions but declares no location service |
| SalesRabbit | Native | None | Google Maps | **Yes**, the only one: `LocationSyncService` plus the permission, and the only app in the set asking to ignore battery optimizations |
| ValidNation, Knockio | | Not obtainable (store 404 at the mirror) | | Knockio's Play label "disable your screen lock" unexplained |

Method lesson kept from the ValidNation audio investigation: read the artifact, not the vendor's
description. Seventeen manifests and bundles say no political walk app has a lock-screen surface;
nothing any vendor publishes says otherwise either.

## I. Open questions and device tests

Only the owner or the canvasser can answer:

1. ~~What RightInsight's lock-screen feature is.~~ **Answered** by the teardown (fact 22): it has
   none, and the surface the canvasser saw is the Twilio dialer. The one residual is that the
   mirror served version 2.2.0 while the store serves 2.3.0, so a native lock-screen addition made
   in 2.3.0 is not *strictly* excluded — though 2.3.0's live JavaScript was read and contains
   nothing supporting one, and its release note is only "Fixes and improvements". A screenshot from
   the canvasser would close even that gap, and would most likely show a phone call.
2. The lock-screen ruling under DPA §4. The owner has chosen the **full walk screen** as the
   target; that is the most exposed option and Android offers no system mitigation, so the ruling
   needs to say whether glance-mode redaction (D.2) is part of it, and whether customers get
   notice or an org-level switch.
3. Keep-screen-on default.
4. The "draw over other apps" permission Google Play lists for `com.doorline.app`: inspect the last
   release build's merged manifest (download the artifact from the EAS build page). The only
   in-tree declaration is React Native's debug manifest.

Thirty-second device tests before the Directions OTA:

- iPhone on iOS 26 and one on iOS 18.3 or older: confirm `maps.apple.com/?daddr=<address>&dirflg=w`
  opens walking directions on both (fact 6 says it will; this is the thirty-second check).
- iPhone with Google Maps installed: does the https directions link open the app or Safari?
- Android with Waze: does "Another maps app" reach Waze, and does Waze honor `q=<address>&navigate=yes`?
- A de-Googled Android (Huawei, if any are in the fleet): does `geo:` resolve, and is the browser
  fallback acceptable?

## J. Method

Six research lenses (competitors, Android, iOS, map links, this codebase, privacy and store policy)
followed by two independent refuters per load-bearing claim and a completeness critic, run
2026-09-04. Artifacts read: seventeen competitor APKs from a mirror (manifests via `pyaxmlparser`, dex
and Hermes bundle strings), Google Play's permission listing for 22 packages and about 1,100 recent
reviews, App Store version histories for 12 apps; the `expo-template-bare-minimum` 54.0.52/54.0.53
manifest; the `expo-notifications`, `react-native-map-link`, and `react-native-android-widget`
tarballs; React Native 0.81.5's `IntentModule.kt`, `RCTLinkingManager.mm`, and `Alert.js`; every
`android/` directory under `mobile/node_modules`. Fingerprint claims were measured by hashing a
scratch copy of `mobile/` before and after each candidate change; the fleet claim was checked
against the live `/api/build-status` endpoint. RightInsight itself was then taken apart
separately: the shipped XAPK from a mirror (manifest plus four dex files) and, because the store
serves a newer version than the mirror, the live JavaScript bundles for both 2.2.0 and 2.3.0 pulled
from Expo's own update server, with the per-asset signature header lifted from the update manifest
to get past the CDN. Negative greps there were controlled by confirming the same method returned
hundreds of hits for ordinary terms in the same files. All scratch work lived in the session
scratchpad; the only repo changes are this document and its cross-links.
