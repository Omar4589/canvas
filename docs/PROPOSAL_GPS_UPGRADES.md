# Proposal: GPS upgrades — the pro-grade cues on the dot, the field fixes, and the instruments to prove it

> **Status: PLAN + DESIGN, approved by the owner on 2026-10-05 with every recommendation as written
> (written 2026-10-03). Nothing here is built yet.** It implements the recommended changes in
> [GPS_ACCURACY.md](GPS_ACCURACY.md) §G (items 3-18), adds one new screen (**Location check**) that the
> device tests in §O need, and fixes two bugs the design work found in shipped code (F-25 and F-26, in
> Part 1's "Two bugs"). Each workstream was designed by an agent that read the exact code it would change
> and prototyped its pure logic in a scratch copy of the tree, so each workstream's test counts and
> "fails today, passes after" claims were run, not guessed; the merged suite, with every workstream in
> one tree, has not been run yet. Where workstreams overlapped (three of them each designed a location
> store, two designed the same Settings helper), this plan keeps one owner per mechanism; §B lists the
> merges. The plan then went through seven review rounds. In rounds 1-3, independent reviewers read the
> plan and the code, and a second reviewer re-checked every finding against the code. Round 4 was a solo
> walkthrough, run while the reviewers' usage limit was exhausted. In rounds 5-7, independent reviewers
> read the plan and the code again, and the plan's author re-checked every finding against the code
> instead of a second reviewer. Before round 7 the release section was rewritten around the owner's own
> routine (`git add -A`, commit, push). §S records what each round caught.

What this covers: what changes for canvassers and for leads, the decisions that are yours, the screens
(design), and — in Part 2 — every file that changes, the shared modules and who owns them, the tests, the
privacy record, the docs and Help Center cascade, the release order and the device tests. Most of this
ships over the air. The next app-store build carries the accuracy circle, Apple's "use precise location
once" box (including when Try again asks for it) and the refreshed permission wording, plus, only if you
approve it with its test result, a native fix a device test calls for (the foreground-pause fix, or an
Android dot change from the provider test).

Related: [GPS_ACCURACY.md](GPS_ACCURACY.md) (the audit this implements, and the facts it rests on),
[CANVASSER_APP.md](CANVASSER_APP.md) (the field app, Location is required), [AUDIT.md](AUDIT.md) (the far
rule and the flag panels), [MAPS.md](MAPS.md) (the admin maps), [PERFORMANCE.md](PERFORMANCE.md),
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) §C9 and §C10, [mobile/README.md](../mobile/README.md)
(the four-build procedure), [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md) (another
session's unbuilt plan that edits the same far rule, activity-row projections, distance labels and
`pinPrecisionText`; §H.3 says how the two meet).

---

# Part 1 — For everyone

To approve this plan, read **Decisions for you** and **How it ships**. Each change below names the
decision that governs it, or the shipping step that carries it when it needs no decision of its own, and
the Design section shows the screens.

## What changes, by who notices it

**Canvassers**

- **The dot turns grey when the phone doesn't know where you are** (item 1). On the houses map, if the
  phone hasn't found you within a few seconds of unlocking (or opening the map), or has stopped getting
  readings for about half a minute, the dot turns grey and stops pulsing. Grey means "this is the last
  place the phone knew", which is exactly what Google Maps does. It turns blue again with the next
  reading. When everything is fine the dot looks as it does today. *Over the air, once a test on a still
  iPhone shows it won't turn grey while you stand at a door.*
- **The light-blue accuracy circle** (item 2). At the next app-store build, the dot on the houses and
  Books maps gets the circle Google and Apple draw: it hides under the dot when the phone is sure (within
  about 30 feet at the normal zoom) and grows into a pale disc when it isn't. Under a porch roof the
  circle covers the porch even when the dot sits in the street, which turns "the app put me across the
  street" into "the GPS is unsure here". It is a still disc, not the pulsing ring turned down in August,
  and it hides while the dot is grey. *Next app-store build.*
- **On iPhone, precise location can be allowed just once** (items 10 and 14). When Precise Location is
  off, iPhone can show Apple's own "use precise location once?" box with our explanation: when the
  setting is switched off while a map is open, and when the canvasser taps **Try again** on the "Precise
  location required" alert. **Allow Once** lets doors record until they stop using the app; the Precise
  Location switch stays the lasting fix. *Next app-store build.*
- **"Getting your location…" instead of a frozen button** (part of step 2). When a door tap needs a
  moment for a fresh reading (under a porch roof, right after unlocking), the button you tapped says so
  after 0.4 seconds, and "Locating…" on the door list and building buttons. Nothing is recorded until the
  reading arrives, as today.
- **No more Google box popping up mid-knock** (part of step 2). On Android phones with **Google Location
  Accuracy** off (its switch is labelled Improve Location Accuracy), the app today can raise Google's own
  "turn on location accuracy" box by itself — when the map opens, in the middle of a knock, or during a
  pin fix — and the knock waits under it. After this change that box only appears when the canvasser taps
  something asking for it.
- **A soft amber notice for that setting** (item 4). Those same phones get an amber notice at the top of
  the map: the phone is finding you by GPS alone, which is slower and less accurate next to houses. Tap
  to turn it on; **Later** hides it for the day, and once Later has been used, **Don't remind me on this
  phone** hides it until the setting changes. It never blocks a door. The red notices (location off,
  permission denied, Precise Location off) always take priority. Android 7-8 phones in "Battery saving"
  location mode get the same notice with their own wording.
- **A clearer "No GPS signal" alert on Android** (item 4). When Google Location Accuracy is off, the
  alert says so and offers **Turn on** (on Android 7-8 in Battery saving mode, **Open Settings**).
  Tapping the red "location is off" notice also opens the phone's Location settings when Google's box
  doesn't appear, instead of doing nothing.
- **Honest iPhone wording for "Precise location required"** (item 5). An iPhone can't tell the app
  whether Precise Location is off or its GPS is still warming up, so the alert and the red notice now
  name both and the notice clears itself if it was warm-up. Android keeps today's wording, because there
  it is always the setting.
- **The iPhone red notice stops vanishing** (part of step 2). Today the red "Precise Location is off"
  notice disappears the first time an iPhone canvasser locks and unlocks the phone, and later blocked
  taps don't bring it back (bug F-25). This plan fixes it: the notice will stay until Precise Location is
  back on.
- **The Precise-off early warning actually works** (item 6). The red notice is meant to appear before the
  first wasted door. But an iPhone with Precise off gives the app about one rough reading each time the
  map restarts its GPS, roughly every 30 seconds, which is too few for today's rule: it needs six
  readings close together. Retuned to three, it lights within about a minute of opening the map.
- **A new Location check screen** (item 3). In the menu (and behind a **Details** link on the location
  notice): whether each setting Doorline depends on is on, with a button to fix any that isn't; how
  accurate the GPS is right now, in feet; a **Test a door tap** button that runs exactly the check a door
  runs and records nothing; and whether each of the last ten door taps got a location or was blocked, and
  why. **Share this report** opens the phone's share menu so the canvasser can send it as text, for
  example to their lead. It carries the settings, the current accuracy and the recent door taps; never a
  location, an address, any voter data or the minute-by-minute history behind the technical details, and
  nothing on it is sent to Doorline.

**Team leads and admins**

- **The panels say "far" only when the audit does** (item 8). Today the web flag panel, the web ping
  panel and the phone's ping sheet print a red "— far" for any knock more than about 250 feet from the
  house, even when the audit didn't flag it because the phone's own accuracy covers that distance. After
  the change they show what's left after allowing for the phone's accuracy ("361 ft after allowing for
  GPS accuracy (±33 ft)"), say "Not far after allowing for GPS accuracy" when the radius covers it, say
  "Too imprecise to judge the distance" when the reading itself is too wide (over about 330 ft), and read
  "far, flagged low" with the reason when the audit lowered a flag.
- **Accuracy circles on the admin maps** (item 8). Zoomed in, each recorded knock and each flag gets a
  faint circle the size of the phone's own accuracy estimate at that moment, in the dot's colour. It is a
  guide, not a boundary: honest readings often land outside their own circle (on Android about one in
  three, by design), so a house outside the circle is not evidence on its own, and the panels say so next
  to the circle's number. Web first; the phone's admin map after you've looked at the web version.
- **Flag cards say when the house pin is approximate** (item 8). "House pin is approximate (placed by
  address lookup) — check the pin before asking the canvasser", or "confirmed in place on Sep 12".
- **The phone's flag card shows how far a Weak GPS stamp was from the house** (item 8), as the web panel
  does.
- **Canvassers can send you a Location check report** (item 3) when they say their dot is wrong.

**Behind the scenes (nobody sees these, which is the point)**

- The app stops accepting a GPS reading the phone itself marks as invalid (an iPhone negative accuracy)
  and asks for the next one (item 9), so a broken number can never become a door's evidence. A reading
  that carries no accuracy estimate (an Android zero, which in practice comes from a mock-location app or
  an emulator) is still recorded, with its accuracy marked unknown, so a door is never blocked for it and
  the audit still sees it. The review screens stop printing "GPS accuracy ±-3 ft".
- The server refuses a malformed position with the same "Location required" message a missing one gets
  (item 9), and stores a meaningless accuracy as "unknown" instead of refusing the knock. Today a
  hand-made request with an absurdly large number for the position deletes the canvasser's earlier entry
  for that door and then fails (bug F-26; the app can't send one, but a hand-made request can); this plan
  fixes it. A real number that is off the Earth gets the same refusal only if a read-only count, run
  first, shows no phone has ever sent one; otherwise that part waits until the phone's own guard is on
  every phone, so a knock queued offline is never silently dropped.
- The location feed recovers at once from a transient iPhone GPS hiccup (part of step 2) instead of going
  quiet for up to 30 seconds with the GPS still switched on.
- New tests enforce the privacy promise on every run (steps 2 and 5): one foreground location watcher, no
  background location terms or background switches in the app's location settings, no coordinate in any
  of the new on-device readouts.

## What stays the same

- **What is collected, kept and sent.** Nothing new reaches Doorline. The only new things stay on the
  phone and are never sent to Doorline: in memory, the feed's timing and accuracy and the last 20
  door-tap outcomes (cleared at sign-out), which the Location check screen displays; in the phone's
  storage, one short note of which amber notice was dismissed and until when (for example "NETWORK_OFF
  2026-10-03"; no personal data; it stays with the phone across sign-outs, though a note for the day
  stops hiding the notice at sign-out, since it records a phone setting, not a person). A canvasser can
  choose to share a text report of that screen; it has no location, address or voter data. The published
  Privacy Policy, ToS and DPA stay true and no subprocessor is added. One older gap the review surfaced,
  between the DPA's Google entry and the Privacy Policy, is yours to rule on (§L, §R). Details in Part 2
  §L.
- **How doors are judged.** The far and Weak GPS rules keep their thresholds. Two server changes touch
  stored stamps, and both can only make an old row's flag milder, never harsher: a meaningless accuracy
  becomes "unknown", and a stored negative accuracy (probably none exist) stops adding distance. A
  read-only script counts exactly how many rows that affects before and after.
- **Every count and KPI**, with one possible exception that the count script measures before it ships:
  rows with a stored negative accuracy (probably none). On those rows the clamp can only lower an audit
  flag or a canvasser's Far count, or add to "forgiven". Otherwise only labels and drawings change on the
  admin side.
- **The standing rulings**: the dot is the engine's own puck; never a JS-drawn dot or ring; one location
  watcher; the door tap reads the phone directly, never the dot; no background location ever.

## Two bugs this fixes that the audit didn't know about

- **F-25 (iPhone, in the live app today).** On iPhone the "is location OK?" check can't see Precise
  Location, so each time the map opened or the app came back to the foreground it erased a red Precise
  notice that a blocked tap had raised, and a de-duplication rule kept later taps from bringing it back.
  Confirmed by tracing the code step by step. The live Help article promises an early warning an iPhone
  can't give; today's Help edit (not yet committed) is reworded to stay true on every phone until this
  fix ships.
- **F-26 (server, in the live server today).** A hand-made request with an absurdly large latitude
  (written 1e400) deletes the canvasser's earlier entry for that door, then fails with an error a phone
  would retry forever. The app can't send such a number. Reproduced on a throwaway database; the
  coordinate check closes it.

## Decisions for you

The full table with alternatives is in Part 2 §A. In short, with the recommendation first:

1. **Grey dot on the houses map** — approve as designed, shipping only if the still-phone test passes
   (otherwise it comes back to you first).
2. **Accuracy circle on the dot** — yes, on the houses and Books maps (not the admin maps), hidden while
   the dot is grey, built so an over-the-air update can switch it off without a new build. Ships with the
   next app-store build.
3. **Location check screen** — for everyone (it shows only your own phone), with **Share this report**,
   the technical details collapsed, a **Details** link on the location notice, and accuracy words Good
   (up to about 65 ft), Normal near houses (up to about 165 ft), Rough beyond, and above about 3,300 ft
   Approximate only on iPhone or Very rough on Android. Those lines stay put even if item 7 changes how
   door taps take a reading.
4. **The amber Google Location Accuracy notice** — three parts. (a) **Dismissing it** (D9): **Later**
   hides it for the rest of the day (signing out ends that); once Later has been used on the phone, the
   notice also offers **Don't remind me on this phone**, for phones whose settings are locked or whose
   owner keeps the setting off on purpose. That choice stays with the phone across sign-outs, since it
   records a phone setting, not a person, and the notice comes back if the app sees the setting change.
   (b) **Android 7-8 "Battery saving" mode** (D10): included, if an Android 7-8 phone is on hand to test
   it, or with your recorded waiver of that test. (c) **The "No GPS signal" alert** (D11): it also names
   the setting and offers **Turn on** (on Android 7-8 in Battery saving mode, **Open Settings**, because
   Google's box can't change that mode).
5. **iPhone Precise-off wording** — split by platform as described.
6. **Precise-off early warning** — ship the retune in phone update part 1, without waiting for the device
   log, accepting that if an iPhone does report every second, the notice waits about 45 seconds instead
   of 15.
7. **Porch latency** — approve a rule that about 20 measured porch taps on an iPhone decide (the Location
   check screen records them). If they show the predicted six-second wait on readings the phone already
   had, raise the "good enough to use at once" bar for door stamps from about 65 to about 130 feet (pin
   fixes keep 65); that is the expected result. If instead the slow taps end with a much tighter fresh
   reading, wait at most 2 seconds when a reading within about 165 ft is already in hand, and record the
   tighter one. If few taps are slow, or the readings the phone refused were mostly wider than about 130
   ft (which the higher bar wouldn't help), change nothing.
8. **Admin side** — the ping panel uses the audit's own verdict (a small additive server field); circles
   on every stamp on screen (up to 500); no circle for a reading worse than about ±820 ft (it would be
   over 1,600 ft across); the panels and the map legend say each circle is a guide, not a boundary; "Too
   imprecise to judge the distance" on very wide readings; no minimum size; the web Audit page cards get
   the pin and distance lines too; the phone's activity-feed "flagged" badge stays as it is.
9. **Server and stamps** — ship the read-only count script first and run it; refuse malformed coordinates
   with "Location required", and off-Earth ones too only if the count finds none from real phones; store
   meaningless accuracies as unknown, never refuse; on the phone, record a reading with no accuracy
   estimate (an Android zero) with its accuracy unknown, refusing only a reading the iPhone itself marks
   invalid; stop stored negative accuracies adding distance; leave a position of exactly zero latitude
   and zero longitude (a common placeholder) alone until the count says otherwise.
10. **iPhone "allow precise location once" prompt** — the map library already asks iOS for it, but the
    app never declared the purpose text, so iOS silently refuses. Recommended: add it at the next
    app-store build. It's a permission prompt, so the words are yours; suggested: *"Doorline can't record
    a door from an approximate location. Your precise location puts you at the right house: it is shown
    on your own phone and sent to Doorline only when you record a door or correct a house's map pin."*
    The privacy record forbids the shorter "only when you record a door": a pin correction sends the
    phone's location too.
11. **Permission prompt wording** — recommended, same build: add that the live position is shown on the
    canvasser's own phone and not sent. Found while designing: today's text says location is recorded
    only for knocks and surveys, but a lead's GPS pin fix records it too; this is the moment to say so,
    in your words. The privacy record notes the mismatch now either way.
12. **An interim "GPS ±N ft" readout on the map until the circle ships** — it would ride phone update
    part 2, which item 17 puts after the election, and come out again with the app-store build that
    follows. So it is worth building only if that build will trail part 2 by more than a few weeks. It
    would show only when the phone is unsure (worse than about 65 ft, or no new reading). Location check
    shows the same number on demand from part 1 either way.
13. **Release order** — the phone code already waiting on `main` (scripted surveys, Not a target voter)
    goes to production first, on its own. It waits on your scripted-survey device checks and your
    confirmation of privacy item 25 (item 26's is recorded as given on 2026-10-03). Phone update part 1
    can't go to staging until it is out, so it needs to be in production by about 2026-10-12 for part 1
    to keep item 17's dates.
14. **Try again asks iPhone for precise location once** — recommended, same app-store build. Without it,
    the prompt in item 10 appears only when the setting changes with a map open, so a canvasser who
    leaves Precise off is refused at every door and never asked. It adds no button. It needs a second
    small patch, to Expo's location library, pinned to its current version.
15. **How the app-store build is carried and released** — recommended, four parts. (a) **Patch files**
    (D29): the circle and Try again each need a small change inside an outside library (the map library
    and Expo's location library); each is kept as a small reviewed patch file, re-applied automatically
    on every install (the audit's "never patch the library" note rested on something that is no longer
    true). (b) **Release** (D33): the four builds are made, from a separate copy of the repository, and
    tested through TestFlight and Play's internal track before the change joins `main`; for release,
    Apple reviews it first, the Play production submission follows only after Apple approves, and the
    change joins `main` once both stores have accepted it, so no store releases the new app unless both
    approved it. Once the stores serve the new version, only it counts as current, so older apps show the
    soft "update available" note. (c) **Older apps** (D34): an urgent fix for phones still on the older
    app goes out only after a check that compares it with the exact builds those phones run, never with
    that check switched off. (d) **Upstream** (D32): you file two pull requests to the map library from
    your GitHub account, so our patch can be dropped once the library carries the change.
16. **The foreground-pause fix** — only if the 25-minute test shows the dot stops following you when the
    phone sits still; then both halves ship in the app-store build (a line in Expo's location library and
    a build step that edits the map engine's own iPhone code). Otherwise nothing ships. Either way it
    comes back to you with the test result before the build.
17. **Timing against Election Day, 2026-11-03** — recommended, on these dates:
    - **now:** today's docs go into a commit.
    - **by about 10-08:** the count script.
    - **by about 10-12:** the release in item 13 in production (your scripted-survey device checks and
      the privacy confirmation it waits on come first).
    - **about 10-13:** phone update part 1's contents are fixed; the phone's own admin labels ride it
      only if the server and web step is already out, otherwise they move to part 2, so the web step
      never holds part 1 back.
    - **10-14 to 10-26:** part 1 on staging by about 10-14, its staging checks passed by 10-20, a fifth
      of phones by 10-21, every phone offered it by 10-23 (its rollout at 100 %), its Help out by 10-26.
    - **as soon as it is ready, and by 10-23 at the latest:** the server and web step (a redeploy reverts
      its code, though not a knock it already refused from an offline queue, so its deploy includes a
      phone smoke test).
    - **10-27 to 11-04:** nothing from this plan goes out except an emergency fix or a rollback.
    - **from 11-05:** phone update part 2, the held server check (if the count finds off-Earth stamps)
      and the app-store build, which can then fold into an Expo upgrade if one is planned (§R).
    - **if 10-20 or 10-23 is missed:** part 1 is pulled back from the phones that have it and taken back
      out of `main`, so nothing else published carries it, and waits until after the election, accepting
      that its field fixes (no Google box mid-knock, the iPhone notice fix) would help most in those
      weeks.
18. **Release rules for every session** — recommended: you keep shipping the way you do now (`git add
    -A`, commit, push, then deploy or publish). For this plan, GPS work that isn't ready stays out of the
    shared folder until its step ships, so your usual `git add -A` can't send it early, and the only
    branches are for the app-store build cycle: the build's own and, after it, a hotfix branch for urgent
    fixes to older apps, each in its own separate copy of the repository with exact commands (Part 2
    §J.10-J.11). From the freeze before the app-store builds until both stores approve the new version,
    ordinary phone updates wait, and an urgent fix goes out from the hotfix copy with the commands the
    hand-off gives. Four checks that every session follows go into CLAUDE.md, with that rule, in a docs
    commit as soon as you approve and before the item 13 release goes out:
    - before a phone update or server deploy, you look at what it carries (the hand-off names what it
      expects), and before a phone update nothing in `mobile/` is left uncommitted;
    - the phone update you release is the one you tested on the test (staging) channel, and nothing else
      goes to real phones between a change's test publish and its release;
    - a rollback is a revert and redeploy, because Heroku's Roll back also restores old settings (the
      one-click Roll back stays for when no setting has changed since the release you roll back to);
    - while one change's device tests run on the test channel, no other session publishes there.

The other open questions, including whether version 1.0.2 is free on the App Store and whether an Expo
upgrade is planned, are in Part 2 §R.

## How it ships

Five steps. Part 2 §N calls them W1, M1, the device tests, M2 and N1. You ship each the way you always do
(`git add -A`, commit, push, then deploy or publish), with the checks in item 18 before each phone update
and one difference: each step gets a commit of its own, because pulling a step back means reverting that
commit.
A step's code stays out of the shared folder until you're ready to ship it, so a commit for other work
can't send it early; step 1's off-Earth check is kept as its own small change, added only if that night's
count is clean. Item 17 sets which steps may go out before
Election Day. Steps 1, 2 and 4, the held server check and step 5 each add lines to one new privacy-record
entry (item 27); each waits for your confirmation of its own lines, asked for in that step's hand-off.

Two things come first. `main` already carries phone code that hasn't reached production (scripted
surveys, Not a target voter), and any production phone update from `main` ships it: finish those staging
checks and the privacy confirmation still open (item 25), and release them on their own, so the GPS
update is diagnosed and rolled back on its own. And today's audit docs and Help edits (with one Help
sentence corrected) go into a commit now, before anything else (§N calls this B0); they go live with the
next server deploy, whoever makes it. The read-only count script follows in a small server deploy of its
own (W0). You run it from the Heroku dashboard late in the evening, before step 1, and again just before
step 1's deploy; that second answer decides part of step 1.

1. **Server and web** from `main`: the admin panels and circles on the web, pin precision on flag cards,
   the server's stamp validation (the off-Earth part only if that night's count found
   none) and the clamp, and the lead-facing Help copy for the web. Nothing on the phone changes. The
   deploy includes a quick phone test on the demo org, including one door recorded offline; run the count
   again afterwards.
2. **Phone update over the air, part 1** (committed, then `npm run ota:staging`, your device checks on
   Android with Google Location Accuracy off, the iPhone red-notice check and the warm-tap timing, then
   `npm run ota:production -- --rollout-percentage=20`, reaching a fifth of phones first and every phone
   after a clean field day): the field fixes and the instruments — the Android dialog fix and amber
   notice, the notice rewrite (F-25), honest iPhone wording, the invalid-reading guard, "Getting your
   location…", the feed fixes and early-warning retune, the Location check screen, and the phone's admin
   labels if step 1 is already out when part 1's contents are fixed (otherwise they move to part 2).
3. **Device tests** on the Location check screen (porch taps, the Precise-off timing, a still iPhone, the
   25-minute test of whether the dot stops following you), plus one read-only check over USB of which
   location source draws the Android dot. §O has the protocol.
4. **Phone update over the air, part 2**: the grey dot (if the still-phone test passed), the phone's
   admin-map circles and their captions (and the phone's admin labels if they didn't ride part 1), and
   whatever the device tests decided (the porch-latency rule, an iPhone GPS setting, and the interim GPS
   readout if you choose it). If the count found off-Earth stamps, the held server check goes out after
   part 1 has reached the fleet, as its own deploy.
5. **The next app-store build cycle**: the accuracy circle, the iPhone "precise once" prompt and Try
   again, the permission text if you choose, and, each only after you approve it with its test result,
   the foreground-pause fix (item 16) or an Android dot change the USB test calls for. Four builds, made
   from a separate copy of the repository and tested before the change joins `main`; the build-currency
   variables are widened when the test builds reach TestFlight and Play internal, and narrowed to the new
   version once both stores serve it. Phone updates published before the change joins `main` reach
   today's app; after it they reach only the new one, so steps 2 and 4 go first.

The Help Center copy for each phone update is committed only after that update is offered to every phone
(for part 1, once its rollout is at 100 %), because committing Help publishes it with the next server
deploy, whatever that deploy is for.

## Design

Text sketches of each screen that changes. Colours are the app's existing theme tokens, except the dot
and its circle, which keep the map engine's own colours (a fixed set for the dot and the engine's default
light blue for the circle) so they match Google's and Apple's. Every piece of small text on a tint passes
the WCAG 4.5:1 contrast floor in both themes (the figures are in Part 2).

### 1. Houses map — the grey dot

```
 ┌──────────────────── houses map ─────────────────────┐
 │  [Map | List]                        [⌕ All houses] │
 │    ⌂ 412        ⌂ 414        ⌂ 416                  │
 │  ═══════════════ Maple Ave ═══════════════════      │
 │    ⌂ 413       ( ◉ )         ⌂ 417            [◎]   │  ◉ blue, pulsing: current reading
 │                                               [≡]   │
 ├─────────────────── bottom sheet ────────────────────┤

 Unlocked at a new door and no new reading for 5 s, or no reading for about half a minute:
 │    ⌂ 413       ( ○ )         ⌂ 417            [◎]   │  ○ grey, still: the last place
 │                                                     │    the phone knew
 Next reading arrives: blue and pulsing again, and the dot glides to it.
```

The fresh dot is redrawn from images that match the map library's own dot, so it looks like today; only
the grey state is new. Books and the admin maps keep the plain dot (they have no location feed to tell
fresh from stale).

### 2. Houses map — the accuracy circle (next app-store build)

```
 Zoom 16, ±25 ft         Zoom 16, ±100 ft               Zoom 16, ±330 ft
 circle under the dot    circle about 64 pt across      circle about 216 pt across
                            .-''''-.                 .-''''''''''''''''-.
       .---.              .'  .---.  '.            .'                    '.
      / ### \            /   / ### \   \          /        .---.           \
      \ ### /            \   \ ### /   /         |        / ### \           |
       '---'              '.  '---'  .'           \       \ ### /          /
                            '-....-'               '.      '---'         .'
    looks like today     pale blue (#89CFF0, 30%)    '-..............-'

 In the map, a porch reading of ±100 ft: the dot sits on the street, the circle covers the porch.
```

House pins under the circle stay visible and tappable. Whether the pale disc draws over them or under
them is the map engine's default, checked on a phone before release (§J.10).

### 3. Map notices — red block, amber advice, Details

```
 Red (blocked), unchanged copy, now theme tokens (dark red in dark mode):
 ┌──────────────────────────────────────────────────┐
 │ Your phone's location is off — canvassing is     │
 │ paused until it's on. Tap to fix.      Details › │
 └──────────────────────────────────────────────────┘

 Amber (advice, Android, Google Location Accuracy off):
 ┌──────────────────────────────────────────────────┐
 │ Google Location Accuracy is off, so your phone   │
 │ finds you by GPS alone — slower and less         │
 │ accurate near houses. Tap to turn it on.         │
 │                               Later   Details ›  │
 └──────────────────────────────────────────────────┘

 Amber, on a later day once Later has been used (same text, one more choice):
 │ accurate near houses. Tap to turn it on.         │
 │ Don't remind me on this phone   Later  Details › │

 Amber, Android 7-8, location mode "Device only" (same tap: Google's box):
 │ Your phone's location mode uses GPS only, so     │
 │ finding you near houses is slower and less       │
 │ accurate. Tap to switch to High accuracy.        │

 Amber, Android 7-8, location mode "Battery saving" (tap opens the Location page):
 │ Your phone's location mode doesn't use GPS, so   │
 │ your doors record with rough locations. Tap to   │
 │ switch to High accuracy.                         │

 iPhone, Precise Location off or GPS warming up (red):
 ┌──────────────────────────────────────────────────┐
 │ Only an approximate location so far. Tap to      │
 │ check Precise Location — if it's on, GPS is      │
 │ warming up and this clears itself.   Details ›   │
 └──────────────────────────────────────────────────┘
```

Tapping the notice's text does today's one-step fix (Google's box, the permission prompt, or Settings).
**Details ›** opens Location check. One notice at a time, red before amber.

### 4. Door screen — "Getting your location…"

```
 ┌─────────────────────────────────────┐
 │      ◌  Getting your location…      │  ← the tapped button, after 0.4 s
 └─────────────────────────────────────┘
 ┌─────────────────────────────────────┐
 │            Wrong address            │  ← disabled while it waits, as today
 └─────────────────────────────────────┘

 Door list row:   1412 Elm St  ● Unknocked · 2 voters        [ Locating… ]
```

### 5. Alerts

```
 iPhone, Precise location required:           Android, No GPS signal with the setting off:
 ┌───────────────────────────────────────┐    ┌───────────────────────────────────────┐
 │      Precise location required        │    │ No GPS signal                         │
 │ Doorline only got an approximate      │    │ Couldn't get a location fix — nothing │
 │ location, so nothing was recorded. If │    │ was recorded. Google Location         │
 │ Precise Location is off for Doorline, │    │ Accuracy is off on this phone, so     │
 │ turn it on in Settings. If it's       │    │ it's finding you by GPS alone, which  │
 │ already on, GPS is still warming up:  │    │ struggles next to buildings. Turn it  │
 │ step outside, wait a few seconds, and │    │ on, or step away from the house and   │
 │ tap Try again.                        │    │ try again.                            │
 │ Cancel · Open Settings · Try again    │    │      CANCEL   TURN ON   TRY AGAIN     │
 └───────────────────────────────────────┘    └───────────────────────────────────────┘
```

On Android 7-8 the No GPS signal alert names the location mode instead. In "Device only" mode it offers
the same **Turn on**. In "Battery saving" mode it reads *"Couldn't get a location fix — nothing was
recorded. Your phone's location mode doesn't use GPS. Switch it to High accuracy in Settings, then try
again."* and offers **Open Settings**, because Google's box can't change that mode.

### 6. Location check

```
 ‹ Back          Location check
 PHONE SETTINGS
 ┌──────────────────────────────────────────┐
 │ Phone location                    [On]   │
 │ Doorline permission           [Allowed]  │
 │ Precise location                  [On]   │
 │ Google Location Accuracy        [Off]  › │  ← Android only; tap to turn it on
 │ Your phone is using satellites alone,    │
 │ which does worst next to houses. The     │
 │ setting is optional: it lets Google use  │
 │ Wi-Fi and cell signals to find you…      │
 └──────────────────────────────────────────┘
 YOUR GPS RIGHT NOW
 ┌──────────────────────────────────────────┐
 │ ACCURACY                                 │
 │ ±49 ft                                   │
 │ Updated just now · Good                  │
 │ Fresh · 58 readings in the last minute   │
 └──────────────────────────────────────────┘
   A door tap now gets its location at once.
   Your recorded doors allow for the phone's own accuracy.
 RECENT DOOR TAPS
 ┌──────────────────────────────────────────┐
 │ Location OK                      ±49 ft  │
 │ 3:41:07 PM · took 0.3 s                  │
 │ No GPS reading   BLOCKED            —    │
 │ 3:38:55 PM · after 6.1 s                 │
 └──────────────────────────────────────────┘
 ┌──────────────────────────────────────────┐
 │ Test a door tap                          │  ← records nothing
 │ Show technical details                   │
 │ Share this report                        │
 └──────────────────────────────────────────┘
 HELP · Why is my blue dot across the street? ›  · Why does Doorline need my location? ›
 ABOUT THIS PHONE · App v4f1c…e2 · production · update 1a2b3c4d  · Phone Android 14 · samsung SM-A146U
```

With the houses map open underneath, the GPS number updates live from the map's own feed. **Test a door
tap** runs exactly the location check a door runs and records nothing: it shows which step answered, how
long it took and how accurate the reading was ("Location OK in 3.2 s, ±33 ft"), or why a door would have
been blocked. It is also how the porch test in §O is run. For a true door-tap reading, open the screen
from the houses map (the menu or **Details ›**); with no map open the screen says so beside the button,
because the phone's location may be cold. Accuracy bands: up to about 65 ft green "Good", up to about 165
ft blue "Normal near houses" (deliberately not amber, so normal porch drift doesn't read as a fault),
above that amber "Rough" (not "Weak", which is the audit's word for a flag that starts at 330 ft), and
above about 3,300 ft red "Approximate only" on iPhone or amber "Very rough" on Android. The bands don't
move if item 7 raises the door-tap bar; only the sentence about how fast a door tap gets its location
follows it.

The shared report (illustrative and abbreviated, in the prototype's format; with technical details open
it adds the aggregate figures, never the minute-by-minute history or the restart ring):

```
Doorline location check
Fri, Oct 3, 3:42 PM
Phone location: On
Doorline permission: Allowed
Precise location: On
Google Location Accuracy: Off
GPS right now: ±49 ft (Good) · Fresh · updated just now · 58 readings in the last minute
Recent door taps (newest first):
Location OK · ±49 ft · 3:41:07 PM · took 0.3 s · recent reading · reading 2 s old
Blocked: No GPS reading · — · 3:38:55 PM · after 6.1 s
App: v4f1c…e2 · production · update 1a2b3c4d · 10/3/2026, 3:01:22 PM
Phone: Android 14 (API 34) · samsung SM-A146U
This report has no location coordinates and no addresses.
```

### 7. Web flag panel and ping panel

```
 DISTANCE                                   (a medium far)
 394 ft from house — far                    ← red, medium weight
 361 ft after allowing for GPS accuracy     ← small, muted
 (±33 ft)

 DISTANCE                                   (300 ft out at ±130 ft — red "far" today)
 300 ft from house                          ← plain
 Not far after allowing for GPS accuracy (±130 ft)

 DISTANCE                                   (Weak GPS only, 394 ft out — red "far" today)
 394 ft from house                          ← plain
 Too imprecise to judge the distance (±1,312 ft)   ← when ± > 330 ft
 Too wide to draw on the map                ← only when ± > 820 ft

 DISTANCE                                   (lowered because the pin was corrected)
 820 ft from the pin at the time — far, flagged low       ← plain, not red
 804 ft after allowing for GPS accuracy (±16 ft)
 30 ft from the pin's current spot
 The pin was corrected to a spot this entry sits next to — flagged low for reference.

 HOUSE
 1 Gate St, Town FL 34741
 House pin is approximate (placed by address lookup) — check the pin before asking the canvasser.

 Under every GPS accuracy line, and in the map legend's footer:
 The faint circle shows the phone's own accuracy estimate. It's a guide, not a boundary: honest
 readings often land outside it, so a house outside the circle isn't evidence on its own.
```

### 8. Admin maps — accuracy circles

```
  ============================ Oak St ============================
                .   -  ~  -   .
            .                     .          [house]   ← houses draw on top
          /   fill: 10% of the     \       /
         |    dot's own colour      | - - -        ← the existing dashed leader line
         |           (GW)           |              ← ping dot + initials
          \                         /
            '   -  ~  -   '        circle = this stamp's ±33 ft
```

Nothing is drawn below zoom 13; circles for readings worse than about ±820 ft aren't drawn (the panel
says so); with more than 500 stamps on screen the map asks you to zoom in. Clicking a house, ping or flag
inside someone's circle opens that item, exactly as today.

### 9. Phone flag card

```
 Gil Walker                                ( Open )
 1 Gate St, Town FL
 Oct 3, 2:14:07 PM CDT
 (● Weak GPS  GPS ±1,312 ft · 394 ft from house)
 House pin is approximate (placed by address lookup) — check the pin before asking the canvasser.
```

---

# Part 2 — Technical reference

## A. Decisions

Each row names the recommendation first. Alternatives and the reasoning are in the workstream sections.

| # | Question | Recommendation | Alternatives |
|---|---|---|---|
| D1 | Grey dot on the houses map (§F.1) | Grey when the feed's freshness is `lost`, or `reacquiring` for 5 s or more; pulse off while grey; houses map only; the 5 s clock starts when the map opens, when location permission is granted, or when the app comes back to the foreground, never at lock; a dot already grey at lock stays grey until a current fix; ships only if §E.5's grey-dot test passes | `lost` only; keep the pulse while grey; decline |
| D2 | Accuracy circle on the engine puck (§F.2) | Houses and Books maps, off on the admin maps; SDK default colour; plumbed as an rnmapbox `accuracyRing` prop so JS can hide it while grey and switch it off over the air; probably drawn over the house pins (confirmed on device; a lower alpha, passed through `processColor`, is the lever) | also on admin maps; hard-coded natively (no prop: no hide-while-grey, no OTA off switch, and drawn on every map, admin maps included, because all four share one puck); no circle and build the `GPS ±N ft` pill instead; neither |
| D3 | Circle while the dot is grey | Hidden | keep it at the last fix's size, grey; keep it blue |
| D4 | Location check audience (§G) | Everyone (it shows only the viewer's own phone) | leads/admins only; everyone but details for leads only |
| D5 | Share this report | Yes, React Native's core `Share` (no new dependency, no native build), text built only from derived rows; never the per-minute history or the restart ring, which stay on screen | screenshots only; clipboard (needs `expo-clipboard`, a native dependency) |
| D6 | Technical details on Location check | Collapsed for everyone, not remembered | always shown; leads/admins only |
| D7 | `Details ›` link on the location notice | Yes | menu entry only |
| D8 | Location check accuracy bands (§G.3) | 20 m / 50 m / 1000 m (Good / Normal near houses / Rough, and above 1000 m Approximate only on iPhone or Very rough on Android), fixed: they don't follow D14, and their text says nothing about speed; one door-tap sentence follows the gate's own limits | bands follow D14 (Good to 40 m under option A); amber from 100 m; the word "Weak" (the audit's Weak GPS flag starts at 100 m); number only |
| D9 | Dismissing the amber notice (§C) | `Later` hides it for the rest of the local day; once Later has been used, **Don't remind me on this phone** hides it until the setting changes; both kept as one stored string, the notice's code and a day, `used` or `always`; sign-out ends a Later's hiding but keeps the fact it was used, and keeps an `always`, since both record a phone setting, not a person; any of them re-arms when the app sees the setting fixed or a different notice | `always` cleared at sign-out too (the button then reads "Don't remind me until I sign out"); not dismissible; until the app restarts (memory only); 7 days stored |
| D10 | Android 7-8 Battery saving mode (`GPS_OFF`) | Include (API < 28 only), if an Android 7-8 phone is on hand to test it before M1, or with the owner's recorded waiver of that test | `NETWORK_OFF` only |
| D11 | "No GPS signal" alert names the setting with `Turn on` | Yes; on Android 7-8 in Battery saving mode the button is `Open Settings` (Google's box can't change that mode) | leave the alert unchanged |
| D12 | iPhone/Android Precise-off copy | Split by platform | one two-cause text on both |
| D13 | Precise-off probe retune (§E) | Ship in M1 with the honest copy, without waiting for the device log (3 readings, 45 s span, 60 s gap) | wait for the device log; leave as is |
| D14 | Porch latency (§D) | Approve §D.5's rule: A, B or C by the measured taps (A expected: door-stamp fast path 20 → 40 m, pin fixes keep 20 m); Location check's bands stay put (D8) | always A; change nothing |
| D15 | Ping panel far verdict (§H) | Server verdict: `GET /admin/households/map` adds each ping's `far` from the audit's own `farAssessment` | client arithmetic only (cannot see downgrades) |
| D16 | Which stamps get circles on admin maps (§H.4) | Every ping and flag in the padded viewport, at most 500, else none plus a "zoom in" note; no circle for an accuracy above 250 m (the panel says "Too wide to draw"); the panels and the legend say the circle is a guide, not a boundary | only the selected stamp |
| D17 | Minimum circle size | None (small circles hide under their dot) | hide under 8 m |
| D18 | Web Audit page cards get the pin and Weak GPS distance lines | Yes (matches the phone, where one card serves both) | map panel only |
| D19 | Phone activity-feed `flagged` badge | Unchanged (its toggle and total are a raw-superset count) | relabel by the accuracy rule |
| D20 | Impossible coordinate (§I.1) | Non-finite (F-26): `400 LOCATION_REQUIRED` before any write, always. Finite but off the Earth: the same, only if the count run before the deploy finds none; otherwise held until M1's phone-side guard is on the fleet, because a refused offline replay is a silently dropped knock | refuse both at once; a zod `400 Invalid input` |
| D21 | Accuracy that is not a real radius | Stored as `null`, never refused (a refused offline replay is a silently dropped knock); on the phone too, an Android zero (no estimate) is stamped as unknown, never refused, and only an iPhone negative, which marks the coordinate invalid, is refused | refuse on live taps; refuse everywhere |
| D22 | Legacy negative accuracies in the far rule | Clamp: `effective = max(0, d − max(0, acc ?? 0))` on the server and in both clients' labels | read as stored |
| D23 | Read-only count script `npm run audit:gps-stamps` (§I.3) | Ship it first, in its own deploy (W0); run it late in the evening before W1, again immediately before W1's deploy (that run decides the off-Earth part), then after it with `--since` | run only after the deploy; rely on "probably none" |
| D24 | A stamp at exactly (0, 0) | Not now; decide from the count | treat as no location now |
| D25 | iOS temporary-full-accuracy purpose key (§J.4) | Add at the next build; recommended copy in §J.4, the owner's to edit, keeping the pin clause (any "only when you record (or log) a door" wording is barred by PRIVACY_VERIFICATION §C9(c)) | leave iOS refusing silently |
| D26 | Permission prompt refresh (§J.6) | Yes, same build: append the on-phone sentence and name GPS pin fixes, in the owner's words | keep both strings (a sentence known to be false for GPS pin fixes stays until the next native cycle; B0's dated §C9(a) stamp records it either way) |
| D27 | Interim `GPS ±N ft` readout on the houses map (§F.3) until the circle ships | Only if N1 will trail M2 by more than a few weeks (both come after the election, D35); shown only when accuracy is worse than 20 m or the dot is grey (its "no new reading" state held back whenever §F.1 is); deleted in the N1 commit | build it regardless (always visible or only when unsure); never |
| D28 | Release order with the phone code already on `main` | Release scripted surveys and Not a target voter to production first, then the GPS update; that release waits on the owner's scripted-survey device checks and on PRIVACY_VERIFICATION item 25 being confirmed (item 26's confirmation is recorded, 2026-10-03), so M1's staging date, and with it D35's 2026-10-20 cutoff, depends on them; the release covers 5cb42b2, 4d1276a's two `mobile/lib` files, 6d3ca94 and 44ca37e | one combined production update |
| D29 | How the native ring code reaches the build (§J.2) | `patch-package`, applied on every install, `@rnmapbox/maps` pinned to 10.3.0, the same prop filed upstream | a prebuild config plugin (never reaches `eas update` bundles); a fork as a git dependency (builds rnmapbox on every install); a vendored tarball (gitignored); wait for upstream (no release has it) |
| D30 | iPhone Try again asks for precise location once (§J.5) | Yes, same build (a second patch, to expo-location) | only the §J.4 prompt, at authorization changes |
| D31 | Foreground-pause fix (§J.7) | Only if §O.6 shows the dot freezing; then both halves, after the owner's yes on the test result | ship it without the test; skip F-17 |
| D32 | Upstream rnmapbox pull requests (§J.9) | File both from the owner's GitHub account | the ring PR only; neither |
| D33 | Runtime versions that count as current after release (§J.10) | Only the new ones, soft mode | old and new for a grace period; new only, hard mode |
| D34 | JS fixes for phones still on the old build (§J.11) | Emergencies only, from one long-lived hotfix branch at the commit the old fleet runs, through `ota-check --build-ids` | dual-publish every update to both fleets; none |
| D35 | Timing against Election Day, 2026-11-03 (§N) | B0 now; W0 by about 2026-10-08; W1 as soon as it is ready and by 2026-10-23, with a phone smoke test in its deploy; M1 to production only if its staging checks pass by 2026-10-20 and its rollout reaches 100 % by 2026-10-23 (dated checkpoints in §N rule 8), else taken back out of `main` and put back from 2026-11-05 by reverting the revert; M1 carries the phone's admin labels only if W1 is on `main` when M1's contents are fixed (about 2026-10-13), so W1 never delays it; M2, M2s and N1 from 2026-11-05; from 2026-10-27 through 2026-11-04 only an emergency fix or a rollback, and no rollout change but a revert | ship as ready, no gate; hold everything until after the election |
| D36 | Release rules for every session (§N rules 2-4 and 7) | The owner's routine stays (`git add -A`, commit, push, then deploy or publish); four checks go into CLAUDE.md in a docs commit as soon as the owner approves and before D28's production publish: look at what a phone update or deploy carries, release what was tested, roll back by revert and redeploy, and one step's device tests on the staging channel at a time; plus, while an app-store build is out, the `--build-ids` publish rule (§J.10) | GPS steps only |

Design calls made while designing, recommended with the plan: the red notice moves to theme tokens (light
mode is pixel-identical; dark mode turns dark red); the "Getting your location…" label appears after 400
ms (600 ms if warm taps on a low-end Android come close, §O.9); the F-19 distance filter is measured
before anything ships; the admin circles are polygons (a circle layer clips at tile edges); the panels'
downgrade sentences move from `text-fg-subtle` (2.54:1, failing) to `text-fg-muted` (4.83:1).

## B. One owner per mechanism

Three workstreams independently designed an in-memory location store, two designed the same Settings
helper, two designed the same guard. This plan keeps exactly one of each:

| Mechanism | Owner | Consumers |
|---|---|---|
| Feed health + freshness (`fresh` / `reacquiring` / `lost`) | **new** `mobile/lib/locationHealth.js` (§E.1) + `useLocationHealth.js` | the grey dot (§F.1), Location check (§G), the pill if D2 declines or D27 chooses the interim readout |
| Last 20 knock-gate runs | **new** `mobile/lib/gateLog.js` (§D.3) | Location check shows the newest 10 and shares them |
| "Gate is slow" per submit path | **new** `mobile/lib/gateSlow.js` + `useGateSlow.js` + `components/GateWaitLabel.jsx` (§D.4) | door screen, survey Save, Add person, door-list and building buttons |
| The one fresh read | `readFresh(timeoutMs)` in [`mobile/lib/location.js`](../mobile/lib/location.js) (§D.1), clears its timer, passes `mayShowUserSettingsDialog: false` | the knock ladder and the pin-fix ladder (Location check's test tap runs the knock ladder itself) |
| Is this fix usable | `isUsableFix`, `isFastPathFix`, `FAST_PATH_*`, `FRESH_TIMEOUT_MS`, `MAX_FIX_AGE_MS` in [`mobile/lib/locationGate.js`](../mobile/lib/locationGate.js) (pure) | both ladders, the health store, Location check (imports, no mirrors) |
| Is this accuracy printable | `hasUsableAccuracy` in [`mobile/lib/geo.js`](../mobile/lib/geo.js); the web copy is added to [`client/src/lib/flags.js`](../client/src/lib/flags.js) (§H.1) and `flagsMirror.test.js` pins the two against each other | every "GPS accuracy ±" line |
| Is this a real radius, per runtime | deliberate copies, one per runtime: the server's `usableAccuracy` (§I.1), the web map's finite-and-positive stamping (§H.4) and `ringRadiusM` in `accuracyRing.js` (§H.4) | the stored stamp, the map features, the circles |
| Device-only predicate | `locationAdvisoryFor` in **new** `mobile/lib/locationBanner.js` (§C.2) | the amber notice, the No GPS alert, Location check's row |
| "A fused fix exists" | `hasFusedFixAsync` in `mobile/lib/location.js` (§C.2): true for the session once any read there has returned a fix, cleared at sign-out | `getLocationAdvisory`, Location check's row |
| The amber notice's dismissal | **new** `mobile/lib/advisoryDismissal.js` (§C.3): the stored key and its in-memory copy, Later, Don't remind me, `rearmAdvisoryDismissal(verdict)` and the sign-out step | `LocationBlockedBanner.jsx`, Location check's poll, `authState.signOut()` |
| Android Location settings page | `openLocationSettings` in `mobile/lib/location.js` | the notice, the No GPS alert's `GPS_OFF` branch, Location check |
| The remembered gate block | `lastGateBlock` in `mobile/lib/location.js`, which never holds `NO_FIX` (§C.3) | the Precise probe's clear, `subscribeGateBlock`'s replay on subscribe, and Location check's Precise row, whose subscriber ignores `NO_FIX` exactly as the banner's does, so its state always equals the remembered value |
| After Google's dialog: open Settings or not | `shouldOpenSettingsAfterPrompt` in `mobile/lib/locationBanner.js` (§C.3) | the notice's tap, Location check's fix row |
| Notice precedence | `foldNotice` / `noticeFor` in `mobile/lib/locationBanner.js` | `LocationBlockedBanner.jsx` |
| Far label arithmetic | `effectiveMeters` in [`server/src/services/audit/flagDetection.js`](../server/src/services/audit/flagDetection.js) (imported by `canvass.js` for the snapshot); `effectiveDistanceMeters` in both `flags.js` mirrors, the same formula under the client name, pinned against the server by `flagsMirror.test.js` | `farAssessment`, the snapshot, the panels |
| Admin accuracy circles | **new** `client/src/lib/accuracyRing.js`, byte-identical copy at `mobile/lib/accuracyRing.js` | web MapPage, phone admin map |
| Puck look and the grey rule | **new** `mobile/lib/puckLook.js` (`isGreyDot`, image props, scale) + `useGreyDot.js` + `PUCK_COLORS` in [`mobile/lib/theme.js`](../mobile/lib/theme.js) | `AppLocationPuck.jsx`, `scripts/gen-puck-icons.mjs` |
| The privacy grep contract | **new** `mobile/lib/privacyGrep.test.js` | runs on every `npm run test:mobile` |

`mobile/lib/location.js` is edited by §C.1-C.3, §D.1, §D.3, §D.7 (two comments), §E.4 (one comment),
§G.1, §G.4 and, in N1, §J.5. Build in the order §C → §D → §E → §G, each rebased on the last. C.1 puts the
dialog flag on today's two inline reads; D.1 folds them into `readFresh`, which keeps the flag, and
updates C.1's site pin from three call sites to two. C.3 leaves the notice's `Details ›` link to §G,
which adds it with the route it opens. The structural pins in `locationGate.test.js` slice the file on
`'async function acquire('` and `'// Best-effort read'`, so both strings stay verbatim.

## C. Android location settings and the notice

**C.1 Never raise Google's dialog from a read.** On Android, expo-location's `getCurrentPositionAsync`
reads the fused provider directly when the network provider is enabled or `mayShowUserSettingsDialog` is
`false` (`LocationModule.kt:397-424`, branch at `:408`). Otherwise it parks the read behind
`SettingsClient.checkLocationSettings` and Google's resolution dialog, and settles only from
`onActivityResult`. The option defaults to `true` (`records/LocationArguments.kt:24,30`). The feed
already passes `false`; the one-shot reads don't ([`location.js`](../mobile/lib/location.js) `:175,
:204`; [`map.jsx`](../mobile/app/(app)/map.jsx) `:101`). Worse than a surprise dialog: under it the
activity is paused, React Native's timers don't fire (`JavaTimerManager.kt:71-72, 276-278`), so the
gate's 6 s race can't even expire. Change: the flag goes onto today's two inline reads in `location.js`
(§D.1 then folds them into `readFresh`, which keeps it) and into `map.jsx` `tryGetUserCoords`. A
structural pin in `locationGate.test.js` walks tracked `mobile/` source and asserts every
`getCurrentPositionAsync` call and the watcher pass the flag, and first asserts the walker found the
known sites, three today and two once §D.1 lands (so a broken walker fails instead of passing vacuously).
It names the watcher only through fragments (§D.7). Verified: the pin fails on today's tree and passes
with the edits; the 18 existing gate cases stay green.

**C.2 The advisory.** `getLocationAdvisory()` in [`location.js`](../mobile/lib/location.js) (never
rejects) reads `Location.getProviderStatusAsync()`, asks `hasFusedFixAsync()` whether a fused fix exists,
and hands both to the pure `locationAdvisoryFor` in **new** `mobile/lib/locationBanner.js`. It returns
the bare verdict, which is what its three callers use (the banner's probe, the banner's `NETWORK_OFF` tap
and the No GPS alert's branch, §C.4): `null` off Android or when the settings are fine, `undefined` when
there is no verdict (the check failed, location off, no fused fix), else the code; `locationGate.test.js`
pins that no caller destructures it and that its `catch` returns `undefined`. `hasFusedFixAsync()`
(Android only, never rejects) treats "a fused fix exists" as a capability, not a state: once any read in
`location.js` has returned a fix this session (its own `Location.getLastKnownPositionAsync()`, the knock
ladder, `readFresh`), it stays true in module memory, cleared at sign-out, and only while it is false
does one cached-fix read decide, the coordinate discarded and never stored. Android clears that cache
whenever location is turned off, so a read right after location comes back on would otherwise report no
fix and leave the verdict unknown just when the canvasser needs it. The sticky flag can be wrong in one
case: if Google Play services is disabled or restarting mid-session, the network provider reads disabled
while the flag stays true, so the verdict says `NETWORK_OFF` when Play services is the cause. The amber
notice keeps the flag (it is advice, dismissible, and re-probed on every foreground); the No GPS alert
passes `{ live: true }` (§C.4), which makes one live cached-fix read instead of trusting the flag and
names the setting only if that read returns a fix. Location check calls `hasFusedFixAsync()` itself only
on the occasions §G.1 lists, never on every poll, and recomputes its row on every 5 s poll from the last
answer.

```js
export const API_LOCATION_MODES_REMOVED = 28;
// undefined = no verdict (check failed, location off, odd shape, no fused fix); null = fine.
export const locationAdvisoryFor = ({ platformOS, apiLevel, status, hasFusedFix }) => {
  if (platformOS !== 'android') return null;
  if (!status || status.locationServicesEnabled !== true) return undefined;
  if (typeof status.gpsAvailable !== 'boolean' || typeof status.networkAvailable !== 'boolean') return undefined;
  if (!hasFusedFix) return undefined;
  if (status.gpsAvailable && !status.networkAvailable) return 'NETWORK_OFF';
  if (apiLevel < API_LOCATION_MODES_REMOVED && !status.gpsAvailable && status.networkAvailable) return 'GPS_OFF';
  return null;
};
```

The `hasFusedFix` gate keeps phones without Google's location service (where every expo read fails) from
being told to turn on a Google setting. Google states the platform network provider is disabled whenever
Google Location Accuracy is off (on every GMS Android version), which is the mapping `NETWORK_OFF` relies
on; §O.1 confirms it on a Pixel and a Samsung. `openLocationSettings` opens
`android.settings.LOCATION_SOURCE_SETTINGS` through `Linking.sendIntent`, falling back to
`Linking.openSettings()` (Doorline's App info page) if the intent doesn't resolve under Android 11+
package visibility. A `<queries>` manifest entry would be native and is not proposed.

**C.3 Two channels, one notice (fixes F-25).**
[`LocationBlockedBanner.jsx`](../mobile/components/LocationBlockedBanner.jsx) today keeps one `blockCode`
written by the probe and by `subscribeGateBlock`, last write wins (`:28-58`). A recorded knock publishes
`null`, which would wipe any advisory; and on iOS the probe returns `null` whenever permission is granted
(it can't see Precise), erasing a gate-reported `PRECISE_OFF` on every mount and foreground, after which
`setGateBlock`'s de-duplication (`location.js:74`) stops later blocked taps re-showing it. The rewrite is
a `useReducer` over the pure `foldNotice(state, event, platformOS)` with slots `{ probe, gate, advisory,
dismissed, today }` and `noticeFor(state)` deciding precedence:

- a hard block (`SERVICES_OFF` > `PERMISSION_DENIED` > `PRECISE_OFF`) always outranks the advisory;
- a recorded knock (gate `null`) clears hard blocks and never the advisory;
- a clean probe clears the gate codes it can see, never an iOS `PRECISE_OFF` (only a precise fix can);
- `NO_FIX` never changes the notice (the same object comes back, so React skips the render);
- `Later` hides the advisory for the local day; once Later has been used, the notice also offers **Don't
  remind me on this phone**, which hides it until the setting changes. The dismissal is one string, the
  code and one of a day, `used` or `always` (for example `NETWORK_OFF 2026-10-03`), under a new
  `cache.js` key, `canvass.locationAdvisoryDismissedOn`, read and written in try/catch. One module owns
  the key and its in-memory copy: **new** `mobile/lib/advisoryDismissal.js`, loaded once at module load
  (the `authState` hydration pattern), which the banner reads and subscribes to. The reducer is filled
  from that copy synchronously, and the advisory is held until the load has settled, so a dismissed
  notice never flashes on a remount, a return from Books or a cold start; a banner that mounts before the
  load finishes receives the result as a `{ type: 'hydrated', dismissed }` fold event, and `noticeFor`
  shows no advisory until it has. The fold's rules for the dismissal are explicit. A day hides the notice
  only on that day, and once the day has passed it reads as `used`. `used` hides nothing but records that
  Later has been used, so the notice then also offers Don't remind me. `always` never expires by date:
  the probe's expiry, `noticeFor` and the render-time date check all skip the day for it. A different
  code (Device only straight to Battery saving on Android 7-8) or a verdict of fine drops any of them and
  re-arms; an undefined verdict never does. Every write in `advisoryDismissal.js` waits for the load to
  settle first, so the load can never put an older value back over a newer write, and the fold's
  `advisory` slot starts `undefined` (not yet probed), so the `hydrated` event applies the drop rule
  against a known verdict. `Later` writes both the key and the copy and also sets `today`; "still today"
  is checked against a date taken at render, not only the last probe's, so a dismissal made after
  midnight with the map open counts. Storage is written only by Later, Don't remind me,
  `rearmAdvisoryDismissal(verdict)` and sign-out. The re-arm is called by the banner's probe and by
  Location check's poll when the verdict is fine or a different code; it clears the key and the copy
  together, so a re-arm made on Location check reaches a banner mounted underneath. `authState.signOut()`
  turns a Later into `used` (the memory reset before any await) and keeps an `always`, so the button
  still reaches phones signed out between shifts; neither holds personal data, and both record a phone
  setting, not a person (D9). The dismissal survives the map remounting, a process death and an update
  restart.

`setGateBlock` gains `{ force }` for tap outcomes, so a repeated code re-shows after a probe cleared it;
the 1 Hz Precise probe keeps the de-duplication. `NO_FIX` is never stored as the remembered block:
`setGateBlock` still notifies subscribers of it but leaves `lastGateBlock` at the last hard code (or
null), and a null publish still resets it. Otherwise a `NO_FIX` tap after a `PRECISE_OFF` (deep indoors,
or a test tap) would leave the red notice stuck after Precise is back on, because the probe clears only a
remembered `PRECISE_OFF` (`location.js:131`), and a remounted banner, which `subscribeGateBlock` replays
synchronously (`:79-83`), would lose the notice while Precise is still off. The probe's clear, the replay
and Location check's Precise row all read that one value. Probes are sequenced (latest wins) and a tap
outcome voids a probe still in flight. Tapping the advisory runs `promptEnableServices()` (Google's
one-tap dialog) and opens the Location page only if no dialog appeared and the setting is still wrong,
never after the canvasser's own "No thanks" (`shouldOpenSettingsAfterPrompt({ leftForeground,
stillDegraded })`; a real dialog pauses the host, `AppStateModule.kt:46-49`). The `SERVICES_OFF` tap
gains the same fallback (a dead end today, `:70-71`). The same commit carries §D.6's platform-split
`PRECISE_OFF` copy and the advisory copy: `NETWORK_OFF` names Google Location Accuracy, Android 7-8 in
Device only mode gets `NETWORK_OFF_LEGACY` ("Your phone's location mode uses GPS only…"), and `GPS_OFF`
its own line (Design §3). §G adds the `Details ›` link with the route it opens (an inner `Pressable`
calling `guardedPush`, so the outer tap keeps its one-step fix). Colours move to
`colors.dangerBg/dangerFg` and `colors.warnBg/warnFg` (light: 6.80:1 and 6.37:1; dark: 8.68:1 and
9.62:1); the raw warn colour is never used for text (1.93:1). Tests: `locationBanner.test.js`, 19 cases
(precedence, dismissal, fallback), each mutation of the rules caught by a named case, ran green on the
prototype; plus cases added since for the stored dismissal (midnight, the load race, a changed code; an
`always` surviving a next-day probe and a midnight render; yesterday's Later showing the notice today
with Don't remind me offered; an `always` re-arming on a fixed setting and on a different code; sign-out
keeping an `always` and turning a Later into `used` that still offers Don't remind me; a Location check
poll that sees the setting fixed clearing a stored `always` through `rearmAdvisoryDismissal`; a fine
probe before the load settles, then an `always` hydrated, ends with the dismissal dropped) and for
`NO_FIX` (`PRECISE_OFF`, then `NO_FIX`, then a precise fix clears the notice; `PRECISE_OFF`, then
`NO_FIX`, then a banner remount with Precise still off shows it again; subscribers still receive
`NO_FIX`).

**C.4 The No GPS alert.** On a `NO_FIX`, `optimisticSubmit`'s failure branch reads `getLocationAdvisory({
live: true })` (two quick native reads, falling back to the generic alert when there is no verdict, only
after a tap already failed, never inside the gate) and passes it to `locationBlockedAlert`, which gains
two branches before the generic one. `NETWORK_OFF` (modern copy, or the Device-only copy below API 28)
gets `Turn on` → `promptEnableServices().then(onRetry, onCancel)`, the existing `SERVICES_OFF` pattern.
`GPS_OFF` gets `Open Settings` → `openLocationSettings(); onCancel()`, because
`enableNetworkProviderAsync` returns at once with no dialog while the network provider is on
(`LocationModule.kt:219-222`), so Google's box can't fix that mode. Cancel stays first, Android's button
order. iPhones and every other alert are unchanged. A structural pin covers each branch's buttons, and
the existing pin "a blocked tap records NOTHING" stays green.

**C.5 GPS_OFF (D10).** Written into C.2-C.4 and Location check's settings row (§G.1), marked; dropping
D10 deletes those pieces and two tests. If D10 is approved, §O.1 adds an Android 7-8 phone in Battery
saving mode.

## D. The knock gate

**D.1 Refuse invalid fixes (F-08).** Both ladders (`acquire()` and `getCurrentLocation()`) guard every
candidate with `isUsableFix(pos)` (finite, in-range coordinates; accuracy `null`, exactly 0, or a finite
number above zero) and fall through to the next step on an unusable one. A negative accuracy is refused:
on iOS it marks the coordinate itself invalid. An accuracy of exactly 0 is not: Android reports 0.0 when
a fix carries no accuracy estimate, so it is stamped with its accuracy as `null` (unknown), the posture
D21 takes on the server. Refusing it would block every door for such a phone, including a mock-location
app set to 0, whose taps the audit records and flags quietly today; FixPinModal's existing warning for an
unknown accuracy keeps pin fixes guarded. The fast-path accuracy bar leaves the native `requiredAccuracy`
option, which waves negatives and zero through (`ios/LocationUtils.swift:117`; `LocationHelpers.kt:35`),
and becomes `isFastPathFix(pos, maxAccuracyM)` in JS, which also requires a known accuracy above zero
(`null <= 20` and `0 <= 20` are both true in JavaScript, and a zero means no estimate, not a perfect
fix), so a zero-accuracy fix never takes the fast path; `toStamp` maps a zero accuracy to `null`. The
accuracy half is one exported predicate, `fastPathAccuracyOk(accuracyM, maxAccuracyM)` (known, above
zero, at most the bar), which `isFastPathFix` and Location check's `doorTapSentence` (§G.3) both call.
Every return from the knock ladder goes through one `stampFrom(pos, step, trace)` that runs
`assertPrecise(toStamp(pos))`. One `readFresh(timeoutMs)` serves both ladders, keeps §C.1's dialog flag
and clears its race timer (today's two inline races leave a 6 s timer pending after a fast read); C.1's
site pin drops from three call sites to two (`readFresh` and `map.jsx` `tryGetUserCoords`).
`FRESH_TIMEOUT_MS = 6000` and `MAX_FIX_AGE_MS` move to `locationGate.js` as exports and become
`location.js`'s defaults, so Location check imports them instead of mirroring; the slice markers stay
verbatim. Behaviour for valid fixes is unchanged. The structural pin is rewritten: acquire's returns are
exactly `stampFrom(recent|fresh|capped)`, each behind its guard on the same line, with no
`requiredAccuracy: <n>` left inside acquire; a new pin covers the pin-fix ladder. Prototype: 25/25, and
nine deliberate regressions each failed the suite; a new case pins that a fix with accuracy 0 is stamped
with a `null` accuracy, not refused.

**D.2 Never print "±-3 ft".** The four `GPS accuracy ±` render sites guard on `!= null` today
([`FixPinModal.jsx`](../mobile/components/FixPinModal.jsx) `:133`,
[`admin/map.jsx`](../mobile/app/(app)/admin/map.jsx) `:2366`,
[`CanvasserPingPanel.jsx`](../client/src/components/CanvasserPingPanel.jsx) `:89`,
[`FlaggedEntryPanel.jsx`](../client/src/components/FlaggedEntryPanel.jsx) `:103`) and
`formatDistance(-1)` returns `'-3 ft'`. They switch to `hasUsableAccuracy`; the web panels get it through
§H.1's `gpsAccuracyText`. FixPinModal's weak-GPS warning treats an unusable accuracy like an unknown one.

**D.3 The gate log.** **New** `mobile/lib/gateLog.js`, a pure module with no imports: a 20-entry,
newest-first ring in module memory (`getGateLog`, `subscribeGateLog`, `clearGateLog`).
`getCanvassLocation` opens a trace, `acquire(freshTimeoutMs, maxFixAgeMs, trace)` notes each candidate
(`noteCandidate`, `noteFresh`, `noteStamped` inside `stampFrom`, before `assertPrecise`, so a
`PRECISE_OFF` entry still says how wide the refused fix was), and both the success and failure paths
close it with `finishGateTrace`. Entry: `{ id, source, platform, at, elapsedMs, code, step, accuracyM,
fixAgeMs, recentAccuracyM, recentAgeMs, freshMs, freshTimedOut, unusable[], mapOpen }` — never a
coordinate or a door. `mapOpen` is set only on test taps, from a flag the screen passes
(`getCanvassLocation({ source: 'test', mapOpen })`), so the gate itself never reads the health store. The
technical form prints each wait in milliseconds (`elapsedMs`), so §O.9's threshold can be read exactly.
Every note swallows its own errors and subscribers are notified on the next tick, so tracing can never
block or change a knock (about 0.6 µs per run measured in node). `authState.signOut()` calls
`clearGateLog()`, so the next person on a shared phone can't see this one's taps. Tests:
`gateLog.test.js` 7 cases, including one that asserts no key named like a coordinate, a door id or the
mock bit (`mocked`; the ruling is that mock detection stays invisible in the app) and one that the module
imports nothing that could persist or send, plus a pin that `authState.signOut()` calls `clearGateLog()`.

**D.4 "Getting your location…" (the label).** **New** `mobile/lib/gateSlow.js`: a keyed store where
`beginGateWait(key)` returns an idempotent `end()`, the key reads slow after `GATE_SLOW_MS = 400`, and a
token stops a late `end()` clearing a newer wait; 400 ms is checked against warm taps on the M1 staging
build (§O.9) and becomes 600 if they come close. `optimisticSubmit` opens the wait with its request path
as the key, immediately before `await getCanvassLocation()` (after the confirm step and the in-flight
lock), and closes it in a `finally`. `GateWaitLabel` (new component) reads `useGateSlow(key)` and swaps
one button's label. Each surface keys its label with the same path function its submit uses
(`doorResultPath`, `surveyPath`, `addVoterPath`); `recordHouseholdAction` switches to
`doorResultPath(householdId, action)` (the identical string). Every path clears it: accepted (before the
screen pops), blocked (as the alert is requested), duplicate and kept (no wait ever opens), pin fixes
(never open one). Tests: `gateSlow.test.js` (fake timers), `gateSlowWiring.test.js` (every outcome
button's key equals its submit path), and an extension of the blocked-tap pin requiring `beginGateWait`
after `await confirm()` and `endWait()` in the `finally`. All five edited screens parse with
`@babel/parser`.

**D.5 Porch latency (D14).** Measured first: about 20 porch taps on an iPhone (a non-Pro model, single-
frequency GNSS), read from Location check's recent taps with technical details on (step, elapsed, refused
cached accuracy and its age, fresh-read time, whether it timed out), plus 10 Android taps to confirm
nothing regresses. The taps are **Test a door tap** runs (§G.2) with the houses map open underneath
(§O.4), so nothing is recorded and the phone's location cache is as warm as at a real door. Rule: if at
least 5 of the 20 take over 3 s, and in at least 3 of those the gate refused a cached reading of 20-40 m
(65-130 ft) under 15 s old and then timed out to it (step `capped`, `freshTimedOut` true), ship **A**. If
most slow taps instead end at `fresh` after 2-6 s with a reading at least 10 m tighter than the refused
one, ship **B**. If fewer than 5 take over 3 s, or the refused readings were mostly wider than 40 m
(which A wouldn't help), ship **C** (nothing; the label explains the wait).

- **A**: `FAST_PATH_ACCURACY_M` 20 → 40 in `locationGate.js`; `PIN_FIX_FAST_PATH_ACCURACY_M` stays 20,
  because a pin fix makes the GPS fix the pin's new coordinate and a 40 m fix can move a pin across the
  street (`FixPinModal.jsx:29-36`). Location check's bands stay at 20 / 50 / 1000 m (D8); only its
  door-tap sentence follows the constant.
- **B**: a usable cached fix within 50 m shortens the fresh race to 2 s and the tighter of the two is
  stamped (`isNearFix`, `pickTighterFix`, step `near`). Prototype 27/27. `pickTighterFix` treats any
  accuracy that isn't finite and above zero as unknown, the test `fastPathAccuracyOk` applies, so an
  Android zero never beats a known accuracy; a case pins it (the prototype predates §D.1's zero rule).

Inserting an any-accuracy step between the fresh race and the 2-minute fallback is a no-op (both read the
one OS cached fix, filtered only by age and accuracy), which is why B shortens the race instead. Evidence
trade-off: on a confirmed F-15 tap today's fallback already stamps the refused 20-40 m fix after 6 s, so
A changes the wait, not the evidence. Either option also shrinks an honest-canvasser artefact: the tap
timestamp is minted after the gate, so a 6 s wait compresses the recorded gap to the next door against
the 20 s rapid rule.

**D.6 Honest Precise-off copy (F-21, D12).** `locationBlockedAlert`'s `PRECISE_OFF` branch and the
notice's `COPY.PRECISE_OFF` branch on `Platform.OS`; iOS names both causes, Android keeps today's string
byte for byte (its `PRECISE_OFF` comes only from the Approximate grant, `locationGate.js:23`).
`assertPrecise`, the code and the `[cancel, openSettings, retry]` buttons are unchanged. The Help copy's
"Retry" becomes "Try again", the button's actual label (`recordAction.js:218`); that correction goes out
with B0, because the wrong label is live today, and B0 also corrects GPS_ACCURACY.md §G item 6's quoted
copy to "tap Try again".

**D.7 Comment fixes and the grep test.** `location.js:12-17` stops crediting the permission guard to an
Android throw (expo-modules-core queues overlapping manifest-permission requests; the throw is
`WRITE_SETTINGS`-only, `PermissionsService.kt:129, :144, :262`); the real reason is iOS, where one
requester's single resolver is overwritten and the first caller's promise orphaned
(`EXBaseLocationRequester.m:55`). `recordAction.js:265-266` and `location.js:141-142` get one shared
sentence naming both the feed and the engine puck as what keeps the OS cache warm.
`useLocationFeed.js:117-123` is corrected too: the Mapbox provider polls for permission, so a Settings
round-trip should draw the dot without a remount (GPS_ACCURACY.md §G item 9; not yet checked on a
device). No new comment writes the watcher's function name. **New** `mobile/lib/privacyGrep.test.js`
walks tracked `app/`, `components/`, `lib/` (test files included) and `app.json`: exactly one watcher
call site (`lib/useLocationFeed.js`), comment mentions at most 2 (1 once §E.3 rewords
`useLocationFeed.js:74`), the five background terms zero, no `UIBackgroundModes`. It also parses
`app.json`'s expo-location plugin entry, because that plugin adds background modes and permissions at
prebuild where no grep can see them: `isIosBackgroundLocationEnabled`,
`isAndroidBackgroundLocationEnabled` and `isAndroidForegroundServiceEnabled` absent or false, and
`locationAlwaysAndWhenInUsePermission` and `locationAlwaysPermission` exactly `false`. Every test that
names the watcher or a background term, this one and §C.1's pin included, assembles the name from
fragments, so no test file matches the grep it enforces.

## E. The feed and its health

**E.1 The health store.** **New** `mobile/lib/locationHealth.js`: a pure fold `foldHealth(state, event)`
over the feed's events (`mount`, `unmount`, `permission`, `attempt(cause)`, `held`, `delivery(pos)`,
`error(reason)`, `appState(status)`, `tick`) wrapped in a module store with `subscribeLocationHealth` /
`getLocationHealth` (React's `useSyncExternalStore` contract; React 19.1 is installed).
[`useLocationFeed`](../mobile/lib/useLocationFeed.js) is the only writer (`noteFeed*`), with the delivery
note as the last statement of `handleFix` so a reader can never starve the probe or the list sort. The
snapshot holds `freshness`, `lastAccuracy`, `lastDeliveryAt`, `lastFixTimestamp`, a 120-entry ring of
`{at, fixTimestamp, accuracy}`, a 60-entry per-minute history (below), restart counts by cause, attempts,
errors, `granted`, `feedMounts`, `resumedAt`, `awaitingResume`, `firstNewFixAt` (the first genuinely new
fix since the window opened), `lostSinceMount` (how many times freshness entered `lost` since the map
opened), `deliveriesSinceMount`, `attemptsSinceMount`, and a 20-entry ring of restarts, each `{at, cause,
firstAnswerAgeMs, answeredInTime}` (whether a current fix answered it within 15 s) — and no latitude or
longitude field anywhere. Deliveries pass the same `isUsableFix` as the gate, with a zero accuracy
recorded as unknown. A replayed fix is a delivery whose fix time is more than 2 s older than its epoch's
attempt or the resume. A history row is `{minute, deliveries, unusable, restarts, backgroundSeconds}`:
usable deliveries, unusable ones counted apart, restarts from the watchdog and from errors, and the
seconds spent backgrounded. Every fold event (a delivery, an attempt, an app-state change, a tick) first
closes each minute that has passed since the newest row: it writes a zero row for each, splits
`backgroundSeconds` out of the open background interval, and flags minutes with no feed mounted, so five
locked minutes read as five rows of no readings and 60 s in the background, and a minute in iOS
`inactive` gets its own row. Deliveries count toward the row for their own minute. So a paused minute
reads 0 instead of going missing (what the 25-minute test in §O.6 needs). Every event, a tick included,
then runs one time step that recomputes the fields that change with time alone: `freshness`, counting
each transition into `lost` in `lostSinceMount` whatever event caused it; each restart-ring entry's
`answeredInTime`, set `false` once 15 s have passed since that restart without a current fix and `true`,
with `firstAnswerAgeMs`, when one arrives in time; and `abandoned` on an entry still pending when a
return or an unmount clears it. Minute closing is bounded: at most 60 rows per event, and a backwards
clock step keeps the newest row open, with readings during it counted in that row, instead of writing
rows. A tick returns the same object, waking no subscriber, only when none of those changed and no minute
closed. Readings in the last minute are derived at render from the ring, so the snapshot holds no
per-minute rate. `useLocationHealth(selector)` selects primitives, or the ring and history arrays by
reference (stable for each snapshot), and is mounted in a leaf component, never in `map.jsx`. Nothing
time-dependent is computed in a selector: React 19.1's `useSyncExternalStore` re-renders whenever two
calls disagree, so a `Date.now()` in a selector loops; time-window figures (readings in the last minute,
a replay's age) are derived during render from the screen's 1 s clock. `authState.signOut()` also calls
`resetLocationHealthHistory()`, which clears everything a person could read except the mount counters and
the window inputs the fold needs while a feed is mounted: both rings, the per-minute history,
`lastAccuracy`, `lastDeliveryAt`, `lastFixTimestamp`, `firstNewFixAt`, `lostSinceMount`, the since-mount
counters, the restart, attempt and error counts and the last error. So the next person on a shared phone
can't read this one's last hour, and the fold stays right if the feed's unmount lands after sign-out.

Tests: `locationHealth.test.js`, 38 cases including "NEVER a coordinate" (folds fixes at known
coordinates and asserts neither value appears in the serialized state; the forbidden keys include
`mocked`), "the feed is the only writer" and "exactly one `<LocationFeed>` mount point". Because the hook
can't run in node, and one dropped or mis-passed line would grey every dot for good with every test
green, a structural pin in `locationFeed.test.js` slices `useLocationFeed.js` and asserts the writer's
wiring: `handleFix`'s last statement is `noteFeedDelivery` called with expo's position object (not the
`[lng, lat]` pair built for `onFix`); `noteFeedAppState` comes before the `status !== 'active'` early
return; `noteFeedMount` opens the effect and `noteFeedUnmount` sits in its cleanup; `noteFeedAttempt`
follows each `lastRestartAt` stamp; `noteFeedTick` precedes the watchdog's granted/starting return; and
`noteFeedPermission` runs at both places permission is granted (after `ensureLocationPermission`
resolves, and after the `active` re-check), since freshness stays `null` without it. The pin is
mutation-tested by deleting each call and by swapping the position for the pair. The feed-health
prototypes alone took the mobile suite from 164 to 220 passing; the per-minute history, the restart ring,
the new counters and §G.2's figures came later and aren't prototyped (history cases, zero rows and the
window rules get their own tests), and the merged suite (every workstream in one tree, one
`locationGate.test.js`) hasn't been run.

**E.2 Freshness.** `freshness(state, now)` is `null` with no feed or no permission; `lost` when a
watchdog or error restart has gone unanswered by a current fix for 15 s (measured from the first
unanswered restart, so the next restart can't flicker it); otherwise `fresh` once a genuinely new fix has
arrived since the window opened, else `reacquiring`. A window opens at mount, when permission is granted
(`granted` flipping to true; an iOS in-app grant causes only an `inactive` blip), and at the `active`
that follows a `background` — never at the `background` itself. Between `background` and `active`,
`awaitingResume` is true; Android also sends `background` when Google's dialog or the permission dialog
pauses the app with the map still visible. The `background` event also records whether freshness was
`lost` at that moment, and whether the dot was grey (`greyAtBackground`: lost, or reacquiring with 5 s
passed since `resumedAt`, the test `isGreyDot` applies); the `active` window resets the new-fix state and
`resumedAt`, but clears the unanswered-restart fields only when the phone was not lost at `background`,
and `greyAtBackground` holds until the first genuinely new fix. The `background` event computes both from
`freshness(state, now)` at its own time, not the stored value, which can be a tick old.
`greyAtBackground` is cleared at mount (the 5 s grace applies whenever the map opens, D1) and by
`resetLocationHealthHistory()`, and `isGreyDot` is never grey while freshness is `null`. So a dot already
grey at lock, for either reason, stays grey through the lock and the unlock (or an Android dialog) until
a current fix, with no blue flash, while a restart merely pending at lock never greys before 5 s. A
delivery counts as new if it is the second or later of its epoch with a strictly newer fix time, or its
fix time is within 2 s of the resume (so a replayed pre-lock fix never counts, and device-clock skew
can't fool it). A restart answered by a young cached fix counts as answered, so in the harness a
canvasser standing still while iOS is quiet stays `fresh` indefinitely. On a real iPhone that rests on
two unmeasured behaviours, iOS delivering while the phone is still or a restart's replay being young;
§O.5 measures both and §E.5's rule acts on the result. Harness timings against the real watchdog: walking
stays fresh; unlock at a new door reads `reacquiring` for about 1 s; true loss reads `lost` about 30 s
after the last fix. Table-driven tests: 29 cases, six mutations each caught.

**E.3 Immediate restart after an iOS stream error (F-20).** A pure `shouldRestartOnError({ errorsInBurst,
lastErrorRestartAt, now })` in `locationFeed.js`: the first error of a burst restarts at once, repeats
wait for the 30 s floor, and at most one floor-bypassing restart happens per 30 s. Each attempt gets its
own error handler; the handler removes the dead subscription before subscribing again (expo's iOS
streamer finishes the stream on `didFailWithError` without stopping its `CLLocationManager`,
`LocationsStreamer.swift:50-54`). An `inFlightAttempt` hand-off covers errors that arrive before the
start promise resolves (expo registers the handler before the native start, `build/Location.js:73-76`),
which also fixes today's erasure of an in-flight error. `shouldRestart` also stops a backwards clock jump
from blocking restarts. The fast-unmount comment at `useLocationFeed.js:74-75` is reworded without the
watcher's name ("the promise resolves after the native call…"), taking the comment mentions of it from 2
to 1. On Android the watcher's error callback never fires in expo-location 19.0.8, so this is iOS-only in
practice. Harness: an error 10 s after a restart now resubscribes at once (today: up to the 30 s floor
with the dead manager running); a stream that always errors makes 7 attempts in 3 minutes; zero zombie
managers.

**E.4 Precise-off probe retune (F-11, D13).** `PRECISE_OFF_MIN_COUNT` 6 → 3, `PRECISE_OFF_MIN_SPAN_MS` 15
s → 45 s, `PRECISE_OFF_MAX_GAP_MS` 30 s → 60 s, plus a guard so an invalid accuracy (negative, or no
estimate: `null` or zero) neither extends nor clears a run (today a negative iOS accuracy clears a real
run). Harness at the realistic one-fix-per- restart cadence: today never trips, the retune trips at 65 s;
at 1 Hz, 15 s → 45 s; a 40 s cold start trips today (a false notice at 15 s) and not after. New tests
import both modules and pin `PRECISE_OFF_MAX_GAP_MS > RESTART_MIN_INTERVAL_MS + WATCHDOG_TICK_MS` and
replay the real cadence. It ships with or after §D.6, because the retune adds a route to the red notice
that needs no tap, and only the honest wording is true for a Precise-on phone stuck on wide fixes. The
two comments that hard-code today's rule are rewritten with it: `locationFeed.js:16-19` ("needs 6 coarse
fixes spanning >=15s with <=30s gaps") and `location.js:110` ("BEFORE the first wasted knock"). The
retune is strictly better than today on both counts (it detects the reduced cadence today's rule never
can, and false-trips less on a cold start), so it ships in M1 rather than waiting; §O.3 still checks a
Precise-ON cold start indoors, and if that trips the retuned rule the span widens to 60 s in M2.

**E.5 The still-phone test: the grey dot's go, and the iPhone distance filter (F-19).** Measured, not
changed: three minutes flat on a table indoors with the map open, then locked 60 s and unlocked without
moving, technical details open (§O.5). The screen shows what the rule needs: the freshness word, the
seconds from the return to the first new reading, `lostSinceMount` (with the map opened fresh for the
test), and the restart ring (§E.1). The rule answers two separate questions.

- **The grey dot ships (§F.1, M2)** if, after the 60 s lock, the first new reading arrives within 3 s of
  the unlock, and freshness never read `lost` during the still minutes (no restart was left without a
  current answer for 15 s). That holds whether the phone delivered steadily or the feed restarted every
  30 s with each restart answered by a young replay, the quiet-iPhone case the feed-health model
  predicts.
- **F-19 closes** at 50+ readings a minute with no watchdog restarts. If it doesn't, the grey dot can
  still ship, and `feedDistanceInterval(Platform.OS)` (−1, `kCLDistanceFilterNone`, on iOS; 0 on Android,
  where a negative value makes the fused request builder throw) goes to staging as its own experiment
  (committed like any step; if §O.5 fails, its commit is reverted before any production publish, rule 4)
  and §O.5 is re-run before it is promoted. GPS_ACCURACY.md F-19 calls −1 "probably equivalent" to 0, so
  it may not help.

When the grey-dot condition fails: (1) if only the unlock was slow, try −1 the same way; if that doesn't
fix it, raise `GREY_REACQUIRE_MS` above the measured unlock-to-fresh time plus a margin, or take D1's
`lost`-only alternative, decided with the owner before M2. (2) If any restart on the still phone was
answered only by a replay older than 15 s, or freshness read `lost` while the phone sat still, neither
change prevents a false grey: §F.1 stays out of M2, D1 goes back to the owner, and D27's interim readout,
if chosen, holds back its "no new reading" state too, since it carries the same verdict.

## F. The dot

**F.1 The grey dot (D1).** rnmapbox builds the puck solely from named images once any image is named
(`RNMBXNativeUserLocation.kt:128-139`, `.swift:155-159`), and iOS never clears an image prop once set
(`RNMBXFabricPropConvert.h:38-41`). So the houses map names a full set in both states, and the fresh set
matches each SDK's default (exactly on iOS; on Android a PNG resampled at non-integer densities,
near-identical, which the three-density device check confirms): iOS `location-dot-inner` (16.5 pt
`#3C83F7`) over `location-dot-outer` (22 pt white), baked into one image because iOS draws puck images
concentric; Android `mapbox_user_icon` (14 dp `#4A90E2`) + `mapbox_user_stroke_icon` +
`mapbox_user_icon_shadow`, kept as three images because Android displaces them when tilted. Grey swaps
only the top image to Mapbox's own stale grey `#A1B0C0`. Colours live in a fixed `PUCK_COLORS` export in
`theme.js`; **new** `scripts/gen-puck-icons.mjs` (sharp, run by hand like the house-pin generator) writes
16 PNGs (about 14 KB) at @2x/@3x (iOS) and @2x/@3x/@4x (Android); Android's `scale` prop is `density /
assetScale` so every density lands on 22 dp.
[`AppLocationPuck`](../mobile/components/AppLocationPuck.jsx) takes `showsFreshness`; only `map.jsx`
passes it:

```jsx
const FeedAwarePuck = () => {
  const grey = useGreyDot(); // lost, or reacquiring for GREY_REACQUIRE_MS (5 s) after a return
  return (
    <>
      <Mapbox.LocationPuck visible pulsing={grey ? PUCK_PULSING_OFF : PUCK_PULSING}
        scale={PUCK_SCALE} {...puckImageProps(Platform.OS, grey)} />
      <Mapbox.Images images={PUCK_SOURCES} />
    </>
  );
};
```

**New** `mobile/lib/useGreyDot.js` selects `freshness`, `resumedAt`, `awaitingResume` and
`greyAtBackground` from the health store (primitive selectors) and arms a one-shot timeout for the 5 s
reacquire threshold (`GREY_REACQUIRE_MS` in `puckLook.js`), cleared on change and unmount. The pure
`isGreyDot(freshness, resumedAt, awaitingResume, greyAtBackground, now)` is grey when freshness is
`lost`, when `greyAtBackground` holds (the dot was grey at the last lock and no new fix has come since),
or when freshness is `reacquiring`, the app is not awaiting a resume, and 5 s have passed since
`resumedAt`. Without the `awaitingResume` term the dot would turn grey the moment the phone locks
(`background` makes freshness `reacquiring` while `resumedAt` still holds the last return, minutes old)
and flip back at unlock, two puck-layer rebuilds per unlock; on Android it would also turn grey under
Google's dialog and the permission dialog, which send `background` with the map still visible. The images
component sits after the puck because Android registers transparent placeholders first. Device checks:
parity with the Books map's SDK dot, grey within the stated times, never grey on a quick unlock, a
screen-recorded flip check (Android rebuilds the puck layer on each flip; the position is re-seeded
synchronously, but a vanished frame can't be ruled out from source), base-map switch while grey, Android
sizes on three densities. Tests: `puckLook.test.js`, 19 cases including PNG size and centre-pixel colour
checks with a 30-line RGBA reader, plus the window cases (with `locationHealth.test.js`): a lock never
greys; for a phone not lost at lock, an unlock with no new fix greys only after 5 s; a dot grey at lock,
lost or reacquiring, stays grey through the lock and the unlock with no flip and turns blue at the first
current fix; an iOS in-app grant 8 s after mount doesn't grey before grant + 5 s; an Android dialog pause
doesn't grey a blue dot and keeps a grey one grey. Risks: a false grey if only the JS feed dies (healed
by §E.3 within a second for errors, by the watchdog otherwise); a false grey while a canvasser stands at
a door, if iOS throttles delivery on a still phone (§E.5's rule decides whether the grey dot ships at
all); a missed grey if iOS pauses the puck's manager but not the feed's (§O.6 decides; until N1's §J.7, a
blue dot that stops following the canvasser can still be stale, so no Help copy may promise a blue dot is
always current).

**F.2 The accuracy circle (D2, D3; native).** Both SDKs draw a static disc from the puck's own fix, in
the puck's own layer, off by default and in the same colour (#89CFF0 at 30 %): iOS
`Puck2DConfiguration.showsAccuracyRing`, Android `LocationComponentSettings.showAccuracyRing`. rnmapbox
10.3.0 exposes neither, so a new prop `accuracyRing: { isEnabled, color?, borderColor? }`, mirroring
`pulsing`, is patched into six files: both spec copies, the iOS Fabric component view and Swift class,
the Android view manager and Kotlin class (§J.3 has the hunks, §J.2 the vehicle). JS, in
`AppLocationPuck.jsx`: `RING_ON = { isEnabled: true }` and `RING_OFF = { isEnabled: false }`, no colours,
so each SDK keeps its default and nothing is hard-coded; `ACCURACY_RING_ENABLED = true` is the
over-the-air kill switch. The puck always passes an object and never omits the prop: iOS sets a
dictionary prop to nil when it goes undefined (`RNMBXFabricPropConvert.h:31-34`), while Android's
existing `pulsing` setter ignores null (`RNMBXNativeUserLocationManager.kt:89-93`); the patched
`setAccuracyRing` clears on null (§J.3), and JS never relies on either. In code:
`accuracyRing={ACCURACY_RING_ENABLED && showsAccuracyRing && !grey ? RING_ON : RING_OFF}` in
`FeedAwarePuck`, and the same without `grey` in the plain puck the Books map uses. `map.jsx` and
`books.jsx` pass `showsAccuracyRing`; the admin maps don't. The ring is drawn from the engine's own fix
and glides with the dot, so it can never disagree with it. Never a JS `CircleLayer`: that would centre on
a different OS client than the puck, jump while the puck glides, and go stale apart from the dot. Radius
at follow zoom 16 (39°N): 5 m and 10 m hide under the dot, 20 m is 22 pt, 50 m 54 pt, 100 m 108 pt, 200 m
wider than the screen. Off with no build: an OTA setting `ACCURACY_RING_ENABLED = false`. On iOS with
Precise Location off the SDK already draws a large disc in the same colour instead of a dot; unchanged.

Stacking: rnmapbox sets no layer position for the puck, and the houses map's pin layers set none either,
so the disc probably draws above the status-coloured pins; §J.10 step 9 confirms it on a phone. At porch
fixes a 30 % wash over the door being read shifts its colour slightly. Moving the puck layer below the
pins would hide the dot under them too, so the lever before the kill switch is a lower alpha passed
through the prop's colour keys as `processColor(PUCK_COLORS.…)` at the call site, from a new token, never
a literal. rnmapbox's `LocationPuck` converts only `pulsing` colours (`LocationPuck.js:41-59`), and the
patched native code accepts only processed colours, so a raw colour string would silently change nothing
on either platform; `locationPuck.test.js` pins that any ring colour goes through `processColor`.

**F.3 The pill.** Built only if D2 declines the circle, or as an interim until N1 if D27 chooses it: a
self-subscribing `GpsAccuracyPill` reading a bucketed label from the health store (5 ft steps under 100
ft), shown only when accuracy is worse than `PILL_SHOW_ABOVE_M = 20` ("GPS ±130 ft", amber) or the dot is
grey ("GPS: no new reading"; that state is held back whenever §F.1 is, §E.5), hidden otherwise,
`pointerEvents="none"`, mounted inside the map-only fragment so `map.jsx` never re-renders per fix. As an
interim it is deleted in the N1 commit, when the circle replaces it; if D2 declines the circle, it stays.

**F.4 Comments.** `AppLocationPuck.jsx`: the pulse proves the map is drawing, not that fixes arrive; the
magnetometer saving is Android-only (iOS feeds heading into every 2D puck regardless); and the line
calling `#4A90E2` "the Mapbox puck blue both native SDKs already use" (`:22-23`) is wrong for iOS, whose
dot is `#3C83F7`.

## G. Location check

**G.1 Route and sources.** **New** `mobile/app/(app)/location-check.jsx`, registered in
[`(app)/_layout.jsx`](../mobile/app/(app)/_layout.jsx) after `profile`. It reads `readLocationStatus()`
(new in `location.js`: services, permission including Android precise/approximate, and the provider flags
exactly as `getProviderStatusAsync` returns them, `{ locationServicesEnabled, gpsAvailable,
networkAvailable }`, each `null` on failure; read-only, never prompts, each probe fails to unknown, never
to fine), the health store (§E.1), the gate log (§D.3), and `subscribeGateBlock` +
`getPreciseProbeRun()`. The Android settings row is `locationAdvisoryFor`'s verdict (§C.2, one
predicate), so it covers `GPS_OFF` too, labelled "Location mode" on Android 7-8 and "Google Location
Accuracy" from Android 9. Its `hasFusedFix` input comes from `hasFusedFixAsync()` (§C.2), called when the
screen gains focus, once after each fix action on the screen returns, and once when the 5 s poll sees
location or permission turn on, never on every tick; once it has answered true it makes no further read
this session. The row itself is the pure `settingsRow({ servicesOn, provider, hasFusedFix, apiLevel })`
in `locationCheck.js`, recomputed on every 5 s poll: it passes `readLocationStatus()`'s provider object
to `locationAdvisoryFor` as it is (that predicate returns no verdict unless `locationServicesEnabled` is
true, so a provider object without it would read Unknown on every Android phone), and keeps the
prototype's "Shown once phone location is on" for location off, which an undefined verdict alone can't
tell apart from no fused fix. `locationCheck.test.js` feeds it `readLocationStatus()`'s exact output
shape. The row so follows a change made in Settings as soon as the canvasser comes back, even when the
trip there doesn't count as a fix action. Without the re-reads, granting permission from the screen's own
row would leave the verdict unknown until the canvasser left and came back, because Android's dialogs
pause the app without a focus change. A provider-flags-only verdict would drop the guard that keeps
phones without Google's location service from being told to turn on a Google setting. So the screen's
location reads are those cached-fix reads on Android (used only as "a fused fix exists", the coordinate
discarded inside `location.js`) and the test tap below. It never imports `expo-location`, the feed, the
puck or Mapbox, and never starts a location feed of its own.

**G.2 Live readings and the test tap.** With the houses map mounted underneath (`feedMounts > 0`) the GPS
hero is live from the health store. **Test a door tap** calls `getCanvassLocation({ source: 'test',
mapOpen })`: the real knock ladder (up to three OS location reads, and the permission prompt if
permission was never granted), one user-initiated read occasion, the stamp discarded on the phone and
nothing submitted, queued or recoloured. The button is disabled while a run is in progress (a ref guard
plus a running state), because a second request while permission is still undetermined would orphan the
first on iOS. Its run lands in the gate log marked `test` (shown as "Test" in Recent door taps). With
technical details on, a row shows the step, the wait, the stamped accuracy and age, the refused cached
reading's accuracy and age, the fresh-read time and whether it timed out, which is everything §D.5's rule
reads, and the share text always uses that full form. Because it is the real check, a blocked test raises
the same red notice a blocked door would (that is the point: it shows what a door would do here). A door
tap always happens over the mounted houses map, whose feed and puck keep the phone's location cache warm,
so a true reading needs the screen opened from there (the drawer or `Details ›`, both push over the map).
When `feedMounts` is 0 the screen says so beside the button: "Open this from the houses map for a true
door-tap test: with no map open, the phone's location may be cold." The screen passes its own `mapOpen`
flag into the call, so a test made with no map open is marked "map closed" in its row and in the share
text; the gate never reads the health store. `recordAction.js` keeps calling `await getCanvassLocation()`
with no argument, the literal the structural pin looks for. The hero always shows, under the accuracy,
the freshness word (Fresh / Finding you / Lost) and the readings in the last minute. Technical details
add, from the health store: the seconds from the last return to the first new reading, how many times
freshness read `lost`, readings since the map opened, GPS starts and restarts, the restart ring (each
restart's cause, the age of its first answer and whether a current fix answered it within 15 s), the
longest gap, and the per-minute history for the last hour. The share text carries what the screen shows,
in two fixed forms: collapsed, the settings, the hero line (accuracy, band, how long ago it updated,
freshness word, readings in the last minute), the recent taps in full, the app build and the phone; with
technical details open, also the technical aggregates. Never the per-minute history or the restart ring,
which stay on screen: per-minute background seconds would make the report a record of when the
canvasser's phone was locked, and a lead may be the client. Above the Share button the screen says what
the report will include. That is enough to run every device test in §O except §O.8 (USB) without a
development build. The hero's "Updated" time comes from the freshness verdict, not from the last
delivery, so a pre-lock fix replayed at unlock never reads "just now".

**G.3 Pure derivations.** **New** `mobile/lib/locationCheck.js`: every word and number on the screen
comes from pure functions taking plain inputs (`servicesCheck`, `permissionCheck`, `preciseCheck`,
`networkCheck`, `accuracyBand`, `liveSummary`, `probeSummary`, `gateRunRow`, `deviceLine`,
`buildShareText`, feet and age formatters). The accuracy bands are the screen's own, `GOOD_ACCURACY_M =
20` and `NEAR_HOUSES_M = 50` (D8): Good, Normal near houses, Rough, and above 1000 m Approximate only on
iPhone or Very rough on Android. The band texts say nothing about how fast a door tap is. One pure
`doorTapSentence(accuracyM, fixAgeMs)` does, from `fastPathAccuracyOk`, `FAST_PATH_ACCURACY_M`,
`FAST_PATH_MAX_AGE_MS` and `FRESH_TIMEOUT_MS` imported from `locationGate.js` (§D.1), plus option B's
near-fix values if B ships: "a door tap now gets its location at once" only when the gate's own predicate
would take the fast path (a known accuracy above zero within the bar, at most 15 s old), otherwise "a
door tap may wait up to 6 seconds for a fresh reading" (2 under B when a near fix is in hand). An unknown
accuracy (`null`, or an Android zero) always gets the waiting sentence, and the hero reads "Accuracy
unknown" for a fresh reading with no estimate. It stays true whichever way §D.5 goes, and the probe
constants come the same way. Rows get a word for B's step `near` if B ships. `deviceLine` reads only
Release, Version, Manufacturer, Model, systemName and osVersion, never Serial or Fingerprint. No
derivation reads the Android mock bit. `buildShareText` is test-pinned to carry no coordinate, address,
mock bit, Serial or Fingerprint even when its inputs do. **New** `mobile/lib/buildInfo.js` lifts the
profile's build line into a pure function both screens use.

**G.4 Behaviour.** While focused: settings re-read every 5 s (a quick-settings toggle doesn't background
the app) and a 1 s clock, both stopped when covered (`useFocusEffect`), per PERFORMANCE.md rule 2. Fix
actions per row. The Google Location Accuracy row calls `promptEnableServices()` and then the notice's
own `shouldOpenSettingsAfterPrompt` (§C.3): the Location page opens only if no dialog appeared and the
setting is still off, never after the canvasser's own No thanks. "Still off" is the row's verdict
recomputed right after the fix action returns (§G.1), so `getLocationAdvisory()` keeps its three callers.
The row's note says the setting is optional and that it lets Google use nearby Wi-Fi and cell signals to
find the phone, as the Help does (§K). Android 7-8's Battery-saving row opens the Location page directly.
Android Approximate: `requestPreciseLocation()` re-requests FINE+COARSE, which on Android 12+ offers the
system's change-to-precise choice (device-verify), falling back to Settings after one try. Rendered only
with the existing inset grammar (`InsetGroup`, `InsetRow`, `InsetNavRow`, `InsetActionRow`,
`InsetHeroRow`, `InsetNoteRow`); tones via `makeRateColors()` for green, amber and red, and `{ bg:
colors.infoBg, deep: colors.infoFg }` for the blue band (raw `info` on its tint is 3.01:1, below the
4.5:1 floor; `infoFg` is 7.15:1); neutral values print as plain text because `textSecondary` on the
sunken chip fails 4.5:1.

**G.5 Entry points.** Canvasser drawer (Navigate group, after Help center; no role or campaign
condition), admin and super-admin More → Support, and the notice's `Details ›` (§C.3). Not on the No GPS
alert: that alert is the only sign a door wasn't recorded, and a third button adds a decision at the
door.

Tests: `locationCheck.test.js` (the derivations, plus screen pins: exactly one `getCanvassLocation` call,
with `source: 'test'`; no `expo-location`, watcher, map, puck, `getCurrentPositionAsync`, `recordAction`,
offline-queue or API import; no coordinate or clipboard import and no direct storage import (its only
storing call is `rearmAdvisoryDismissal`); no derivation reads `mocked`; exactly one `Share.share`, fed
by `buildShareText`; theme tokens only; every interval and listener stopped; `_layout` registers the
route; every menu row present; the test button disabled while a run is in progress; `doorTapSentence`
with the gate's bar at 20 and at 40 m, a reading older than 15 s, and a `null` and a `0` accuracy (both
the waiting sentence); `gateRunRow` and the share text against an entry that timed out and fell back to a
capped fix, and one marked "map closed"; the freshness word and the return-to-first-reading figure;
`buildShareText`'s two forms pinned line by line (collapsed, and with technical details open), and never
the per-minute history, background seconds or the restart ring; the screen's gate subscriber ignores
`NO_FIX`, so after `PRECISE_OFF` and then a `NO_FIX` test run the Precise row still reads "Approximate
only", and a precise fix then clears it) and `buildInfo.test.js`. The location-check prototype (all pass;
seven deliberate regressions each caught by one failing case) covers the screen before **Test a door
tap** replaced its one-shot read; the test tap and the screen pins above aren't prototyped yet.

## H. Admin side

**H.1 Panels judge "far" like the audit.** New helpers in
[`client/src/lib/flags.js`](../client/src/lib/flags.js) (W1), copied into
[`mobile/lib/flags.js`](../mobile/lib/flags.js) together with §H.5's code that uses them, in M1 when W1
is on `main` by the time M1's contents are fixed and otherwise in M2 (§N rule 8), so W1 changes nothing
on the phone and never holds M1 back: `effectiveDistanceMeters` (the server's clamped arithmetic, `max(0,
d − max(0, acc ?? 0))`), `farRowOf` (a map ping in the flag-entry shape), `farLabelState` (the server's
verdict when the row carries one — a flag entry's own far reason, or a ping's `far` field from §H.2 —
else the arithmetic), `gpsAccuracyText` (plain at or under 250 ft; the remainder when far; "Not far after
allowing for GPS accuracy" when a radius of at most 100 m covers it; "Too imprecise to judge the
distance" when the radius is above `GPS_ACCURACY_WARN_M`, 100 m, because then the audit can't call it far
and nothing can call it near; nothing for null or ≤ 0), `farDowngradeLines` (today's three sentences) and
`hasUsableAccuracy` (the web copy of the one §D.2 adds to [`mobile/lib/geo.js`](../mobile/lib/geo.js);
the pin between the two lands with whichever of W1 and M1 comes second). `FlaggedEntryPanel.jsx` and
`CanvasserPingPanel.jsx` render them. Under the GPS accuracy line both web panels print one caption,
which the web `FLAG_LEGEND_FOOTER` carries too: "The faint circle shows the phone's own accuracy
estimate. It's a guide, not a boundary: honest readings often land outside it, so a house outside the
circle isn't evidence on its own." It says nothing about where the house belongs: the pin marks the
house, sometimes only approximately, not where the canvasser stood. The phone gets the same caption,
legend sentence and "Too wide to draw" line only in the commit that draws phone circles (§H.6), so it
never describes circles it doesn't draw; if the owner declines phone circles, the phone's text never
changes. Labels only: no count, KPI, filter or query reads them (`summarize`, `farKpi`, the `flaggedOnly`
supersets and the map chips all verified untouched). **New** `server/test/flagsMirror.test.js` loads both
mirrors (with the repo's resolve hook for the phone's extension-less imports) and the server's
`farAssessment`: the label agrees with the server on 192 boundary cases (0 mismatches in the prototype).
W1's version pins the web copy against the server; the step that brings the phone helpers (M1 or M2) adds
the phone mirror, and both must then return identical text from every shared helper. The legend footers
are compared too: until §H.6 the web footer equals the phone's plus the circle sentence, and identical
after it. Nothing enforces the mirror today, and GPS_ACCURACY.md's "byte-identical" claim is wrong (they
differ in imports and formatters); corrected in the cascade.

**H.2 The ping verdict (D15).** `GET /admin/households/map` passes its activity rows through
`farKpiForRows` (the per-canvasser KPI's own path into `farAssessment`) and adds `far: null | { severity,
detail }` through a whitelist helper `farVerdictForWire` (no replaced-entry snapshot, never
`correctedBy`, only the derived `pinMovedBySelf`). The activity projection at
[`households.js`](../server/src/routes/admin/households.js) `:545` gains `replaced`, read server-side
only (the response map at `:654-671` never ships it); without it the honest-correction downgrade silently
never fires, and an honest correction would read red on the ping panel while the audit says low. Trap:
the route populates `userId`, and the self-move guard compares `String(row.userId)` — a populated
document stringifies to `[object Object]` and silently forgives a canvasser's own pin move — so rows go
in with the raw id (verified both ways in a scratch run). One extra indexed Household query per map
refresh while pings are on, limited to raw-far candidates. Additive: the phone ignores it until §H.5.
**New** `mapPingVerdict.int.test.js` compares every ping's verdict with `/admin/reports/flags` for five
seeded doors (med, pin-downgraded, self-moved, not far, honest correction).

**H.3 Pin precision and the Weak GPS distance (F-22, F-03 residue).** The detector's Household projection
(`flagDetection.js:54-57`) gains `coordConfidence` and `locationConfirmedAt`, copied into
`entry.household` for display only — never into `buildPinFixMap` or `farAssessment` (AUDIT.md §B.7),
never `correctedBy` or `locationConfirmedBy`. Two helpers in `client/src/lib/flags.js` (W1), copied into
`mobile/lib/flags.js` with the §H.5 card that renders them (M1 or M2, as in §H.1): `pinPrecisionText(h,
formatDate)` (approximate / confirmed on a date / nothing for exact or corrected, the existing badges'
precedence) and `weakGpsDistanceText(entry)`. Rendered in the map panel, the web Audit cards (D18) and
the phone card. The int test asserts the exact `household` key list and that a mock flag is unchanged.

**Sequencing with [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md)** (another session's
unbuilt plan, under revision on 2026-10-05; re-read its sequencing note before building either). It adds
a stored, downgrade-only `knockPin` input to `farAssessment`, builds every CanvassActivity row projection
from one `FAR_ROW_FIELDS` constant, notes this plan's new caller on `/admin/households/map` (§H.2), and
asks `pinPrecisionText` for a third state, "No exact map spot". Whichever plan lands second rebases onto
the other: §H.2's activity rows and §I.3's count script take their projection from `FAR_ROW_FIELDS` if it
is on `main`, the clamp (§I.2) is written on top of its `farAssessment`, `pinPrecisionText` carries the
third state, and the int tests' exact key lists follow what is on `main`. Both plans also rewrite the
same distance lines: both `flags.js` mirrors, `CanvasserPingPanel.jsx`, `FlaggedEntryPanel.jsx`, the
phone's ping sheet and `FlaggedEntryCard`. Whichever lands second merges them, adds the other plan's
downgrade reason to `farDowngradeLines` and its helpers to `flagsMirror.test.js`, and shows the owner one
merged wording for a knock on a shared spot before it ships.

**H.4 Web circles (D16, D17).** `activitiesToPingsGeoJSON` and `flagsToGeoJSON` stamp `accuracy` only
when it is finite and above zero. **New** `client/src/lib/accuracyRing.js` (no imports, so the phone copy
is byte-identical) builds 64-vertex geodesic polygons (max 0.065 m error against the server's haversine;
about 1.5 KB of JSON each) for stamps in the padded viewport, only at zoom `ACCURACY_RING_MIN_ZOOM` or
closer (an empty set below it, on both platforms), capped at 500, else none with `withheld: true` (a
partial set would read as "no circle = a perfect fix"). The module also exports `ACCURACY_RING_MIN_ZOOM =
13` and the one withheld-note string both maps print, `RINGS_WITHHELD_NOTE` ("Too many locations on
screen to draw accuracy circles — zoom in."). `ACCURACY_RING_MAX_M = 250` (= `GPS_ACCURACY_BAD_M`):
`ringRadiusM` returns null above it, so no circle is drawn, and both web panels print "Too wide to draw
on the map". When the 500 cap withholds circles, `MapFilters.jsx` shows the note as one muted line under
the pings or flags toggle. Its "Show canvasser locations" description gains: "Zoom in and each dot shows
a faint circle: the phone's own accuracy estimate, a guide, not a boundary." A ping that is also a flag
gets one circle, in the flag colour. `registerLayers` adds `accuracy-rings-fill` and `-line` before
`household-approx-ring` (the bottom of the app's own stack), `minzoom` `ACCURACY_RING_MIN_ZOOM`, no
handlers: MapPage binds only per-layer delegates, and Mapbox GL JS 3.23 delegates query only their own
layers, so a circle can never take a click (never `e.features[0]`). One table (`PING_COLOR_BY_ACTION`)
now drives both the ping dot and its circle. Polygons, not a `circle` layer, because circle layers clip
at the tile buffer past about 128 px. On the web the zoom and the circle viewport come from their own
`onRingView` handler, never from the bbox handler or the fetch box: that handler skips every move before
the first auto-fit and every move that stays inside the last padded fetch box, which every zoom-in does
([`MapPage.jsx`](../client/src/pages/MapPage.jsx) `:793-807`), so a zoom recorded there would stay at the
overview and no circle would ever draw at street zoom. `onRingView` is bound to every `moveend`, ungated
(the auto-fit's included, which fires synchronously), and called once in `load`; it records
`map.getZoom()` beside `padBounds(map.getBounds())`, and the builder culls to that box. Tests:
`accuracyRing.test.js`, `mapRender.test.js` (a fake map recording layer order asserts the circles sit
below every ping, flag and house layer, and a fake map driven through the auto-fit and two zoom-ins
inside the padded box shows the circle input getting each new zoom and a smaller viewport), and a smoke
render of both panels.

**H.5 The phone (after the server).** `admin/map.jsx`'s ping sheet uses `farRowOf`/`farLabelState`/
`gpsAccuracyText`/`farDowngradeLines`, with `colors.dangerFg` (8.31:1) for the far label instead of
`colors.danger` (3.76:1). `FlaggedEntryCard` gains the pin line (`warnFg`) and the Weak GPS distance; its
correction lines move from `textMuted` (2.54:1) to `textSecondary` (4.83:1). Degrades gracefully against
an older server. The mobile co-presence test lands here, with §H.5: it fails if circle text appears in
`mobile/lib/flags.js`, `admin/map.jsx` or `FlaggedEntryCard.jsx` while `admin/map.jsx` lacks the
`admin-accuracy-rings` source; §H.6 keeps it green.

**H.6 Phone circles (after the owner has seen the web).** The same module feeds an always-mounted
`ShapeSource` `admin-accuracy-rings` with Fill and Line layers anchored
`belowLayerID="admin-approx-ring"`, `minZoomLevel={ACCURACY_RING_MIN_ZOOM}` as the render guard, and no
`onPress`. A layer's zoom limit hides circles without keeping their polygons off the bridge, so the
builder also takes a boolean, `ringsZoomOk = state?.properties?.zoom >= ACCURACY_RING_MIN_ZOOM`, read
from the `MapState` that `onMapIdle` already receives (Android can send an empty payload before the map
is ready) and set synchronously at the top of `handleMapIdle`, before its `await getVisibleBounds()`, its
`!mapQ.data` return and its two other early returns (the unarmed camera and the 5 % gate,
`admin/map.jsx:1050-1080`), so a small pinch across the floor still registers and zoom jitter at idle
can't rebuild the circles; below the floor the memo returns one shared empty collection. rnmapbox
hit-tests only sources with a press listener (`ShapeSource.tsx:308`; `RNMBXMapView.kt:451-461`;
`RNMBXMapView.swift:1301-1303`), so circles are invisible to tap routing. Structural tests pin "no
onPress on the circle source", "no circle layer inside a pressable source", and that `ringsZoomOk` is set
before the early returns and is the memo's dependency. Under the layer toggles, like the overlap review
row, a withheld set shows `RINGS_WITHHELD_NOTE`. The same commit brings the phone's circle text: the
caption under the accuracy line on the ping sheet and `FlaggedEntryCard`, the circle sentence in the
phone's `FLAG_LEGEND_FOOTER` (the Audit tab shows it too), and "Too wide to draw on the map" on the ping
sheet and `FlaggedEntryCard` (with `onMap`). Up to 500 circles at about 1.5 KB each can cross the bridge
on a 20 s live poll, so §O.7 checks a low-end Android; if panning hitches or a poll paints slower than
about 300 ms, the phone passes a lower `cap`.

**H.7** The add-person route comment at `canvass.js:1006` ("the GPS stamp evidences the visit") becomes
true: required, not stored (F-23).

## I. Server: the stamp

**I.1 Validation (D20, D21, F-09, F-26).** One world-bounds predicate `isValidLatLng` in
[`utils/stateBounds.js`](../server/src/utils/stateBounds.js) (finite, |lat| ≤ 90, |lng| ≤ 180) feeds
`missingLocation()` in two parts, each answered with the existing `400 LOCATION_REQUIRED` before any
write on all three stamped routes (dispositions, survey, add person), which the phone already maps to its
alert:

- **Non-finite values (F-26), always.** No app can send one (JSON writes infinity as null, and a null
  already fails), and today such a request deletes the earlier entry for that door and then fails.
- **Finite values off the Earth, only if the count (§I.3), run before this deploy, finds none ever
  stored.** Otherwise this part waits until M1's `isUsableFix`, which refuses out-of-range fixes on the
  phone, has been in production long enough for the fleet to take it, because a queued offline knock
  refused with a 4xx is deleted from the phone's queue without a trace
  ([`offlineQueue.js`](../mobile/lib/offlineQueue.js) `:120-125`). Apple doesn't document
  `kCLLocationCoordinate2DInvalid`'s value, and expo-location never checks a fix's coordinates, so an old
  iPhone sending such a sentinel can't be ruled out from source. This part is kept as its own small patch,
  W1-offEarth, outside the shared folder (§N rule 1), applied only if the night's count is clean; held,
  it becomes M2s.

A zod `.refine` with the same predicate guards future reuse; the pin-move service calls the same
predicate. A zod `.transform(usableAccuracy)` on `locationSchema.accuracy` and the pin route's
`locationCorrectionSchema` stores zero, negative and non-finite accuracies as `null`;
`buildReplacedSnapshot` copies prior accuracies through the same function. No future-timestamp clamp
(refuted: a stale offline replay would out-rank a fast-clock phone's newer action).

**I.2 The clamp (D22).** `effectiveMeters(meters, accuracy) = max(0, meters − max(0, accuracy ?? 0))`,
exported from `flagDetection.js`, replaces the subtraction at all four places: `flagDetection.js:271`,
`:293` and `:319` (`farAssessment`'s three checks) and `buildReplacedSnapshot` in
[`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) `:213` (the snapshot's nearest
pick), which imports it. Today a stored negative accuracy adds distance, which breaks the premise of
[`farKpi.js`](../server/src/services/audit/farKpi.js)'s raw-distance prefilter, so the audit page and the
per-canvasser Far count can disagree (verified: 70 m at −10 is Far in the detector and 0 in the KPI). The
clamp is identical for null, zero and positive accuracies; for a negative one it can only lower a flag,
end a far reason, or allow a downgrade that a negative denies today. If PROPOSAL_PLACEHOLDER_PINS.md
lands first, the clamp is written on top of its `farAssessment`, and the count script (§I.3), a direct
caller, builds its rows from `FAR_ROW_FIELDS` in both its runs, with and without the clamp, so it
measures the far rule the server actually runs.

**I.3 The count script (D23).** **New** `server/src/migrations/auditGpsStamps.js`, root-proxied as
`"audit:gps-stamps": "npm --prefix server run audit:gps-stamps --"` and run from the Heroku dashboard →
More → Run console as `npm run audit:gps-stamps`, or with `-- --since=<time>` (both rehearsed from the
repo root before hand-over). `--since` takes a full time with its UTC offset, for example
`--since=2026-10-13T23:45-05:00` (Central daylight time; `-06:00` from 2026-11-01), or a bare date read
as 00:00 UTC; a time without an offset is refused, so a late-evening US deploy, already the next day in
UTC, can't be miscounted. Parsing is strict: the shape `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM`, with optional
seconds and fraction, followed by `Z` or `±HH:MM`; a round-trip check of the date parts, so `2026-02-30`
or `T24:00` is refused instead of rolled forward; and no time later than now. The script prints the
instant it parsed, in UTC and in the given offset, and how many rows it scanned since then, so "0 of 0"
can't read as a clean result. It ships first, in its own deploy (W0), and runs before W1. One aggregation
per ledger counts negative, zero and non-finite accuracies (zero accuracies split by the mocked flag and
by month, so the owner sees who sends them), off-Earth coordinates, exact (0, 0) and snapshot sentinels.
For the clamp, it runs `farAssessment` with and without it, with each row's `buildPinFixMap` entry, on
every row whose own or snapshot-nearest accuracy is negative (the only rows the clamp can change), so the
honest-correction and pin-downgrade paths count too. It prints aggregates only: rows whose severity
drops, audit far reasons removed, the change in the KPI's far count and in "forgiven", and how many
canvassers are affected; never a coordinate, name or id; never writes. Mongoose's query cast rejects
`NaN` inside `$in`, so it uses aggregates. Fingerprint-neutral (root package.json is outside the mobile
project). Each ledger costs one collection scan, so it runs out of hours. It is re-run immediately before
W1's deploy, and the off-Earth decision comes from that run; afterwards it runs as `-- --since=<the
deploy's finish time, with its offset>`. Expected after-result: zero negative, zero and non-finite
accuracies and zero non-finite coordinates on rows created after the deploy; off-Earth rows still allowed
if that part was held; exact (0, 0) allowed, since D24 leaves it alone; the unknock-chunk ledger judged
by the stored rows' own dates, because a chunk frozen after the deploy holds older rows verbatim. The
before numbers go into W1's §C10 stamp and GPS_ACCURACY.md, the after numbers into a small docs commit
after the `--since` run (§L), and item 27 cites them.

**I.4 Compatibility.** `npm run audit:mobile-api` flags `canvass.js` and `households.js` (both
mobile-facing), lists changed services only as "check by hand", and doesn't see `utils/` or `migrations/`
at all. Read by hand: `flagDetection.js` and `farKpi.js` (they feed `/admin/reports/flags` and the
canvasser `summary` and `quality` endpoints the phone calls), the pin-move service and
`utils/stateBounds.js`. Only impossible values are tightened. Two response changes, both additive: `far`
on map activities (§H.2), and `coordConfidence` and `locationConfirmedAt` on flag-entry households
(§H.3). The clamp can change the severities those endpoints serve, only downward and only on the rows the
count finds. The stamped routes never echo the stamp. No client-version bump; both values stay 1. No
migration, no index.

Tests: 8 new cases in `locationGate.int.test.js` (6 fail on today's code), 6 new unit cases in
`flagDetection.test.js` (5 fail today), `auditGpsStamps.int.test.js`; the prototype passed all 28
integration suites that reach these files and the 441 unit tests.

## J. The native build cycle

Everything here needs new binaries: four builds (iOS and Android × staging and production) from one
commit, in one cycle. Nothing else in this plan waits on it. The native-cycle workstream measured the
fingerprint effects on scratch replicas with the Expo config loaded, ran React Native 0.81.5's codegen on
the patched spec, applied the draft patch to a clean copy of the installed library, and typechecked the
CoreLocation calls in isolation against the iOS SDK (stand-ins for Expo's module wrapper and for
MapboxMaps); those results are cited below. The Swift, Kotlin and Objective-C++ hunks are first compiled
for real by J.10 step 5's local release builds. Every `eas` command is the owner's to run.

**J.1 What rides the cycle.** The accuracy circle (§F.2, D2); the iOS "precise once" purpose key (J.4,
D25); **Try again** asking iOS for precise location once (J.5, D30); the permission-string refresh (J.6,
D26); and only if their device tests say so, the foreground-pause fix (J.7, §O.6) and a fused-provider
puck on Android (J.8, §O.8). One tooling change lands on `main` before the cycle starts (J.10 step 1).

**J.2 The vehicle: `patch-package` (D29).** [`mobile/package.json`](../mobile/package.json) gains
`"postinstall": "patch-package --error-on-fail"` and the devDependency `patch-package` (^8.0.1), and pins
`@rnmapbox/maps` from `^10.3.0` to exactly `10.3.0` (the lockfile already resolves 10.3.0; a patch is
version-specific); [`mobile/package-lock.json`](../mobile/package-lock.json) is regenerated by `npm
install` in `mobile/` and committed with it, because `npm ci`, locally and on EAS (`npm ci
--include=dev`), refuses a lockfile missing a dependency. The patch is
`mobile/patches/@rnmapbox+maps+10.3.0.patch`, generated by editing under `node_modules` and running `npx
patch-package @rnmapbox/maps` from `mobile/`, only from a fresh `npm ci` with the edits re-applied (or
with `--exclude '^(package\.json|android/build/.*)$'`): a local Android build leaves Gradle output in
`node_modules/@rnmapbox/maps/android/build`, and patch-package would record it silently, binaries as
empty file creations. Measured with `expo-updates fingerprint:generate`:

| Edit to a replica of `mobile/` | iOS and Android fingerprints |
|---|---|
| `postinstall` script + `patch-package` devDependency | unchanged (`fingerprint.config.js:29` skips every npm script) |
| a `patches/` directory | both move |
| one line inside `node_modules/@rnmapbox/maps` | both move |
| an `ios.infoPlist` key in `app.json` | both move |

So the runtime version moves exactly when the patch or the patched package changes, and `ota:check`
refuses a publish from any tree not patched the way the newest build was: an unpatched bundle can never
reach a patched binary, or the reverse. EAS installs dependencies, running `postinstall`, before `expo
prebuild` and `pod install` on both platforms (Expo build reference, "Remote steps"), so codegen, the
native compile, the embedded bundle and every later `eas update` see the same files. `--error-on-fail`
turns a patch that no longer applies (an rnmapbox or Expo SDK bump) into a failed install, never a
silently unpatched binary.

Rejected: an Expo config plugin rewriting `node_modules` at prebuild (prebuild never runs for `eas
update`, so OTA bundles would lose the prop from the JS view config; and it would change `node_modules`
after eas-cli computed the build's runtime version locally, the drift `fingerprint.config.js` exists to
prevent); a fork consumed as a git dependency (npm runs rnmapbox's `prepare` script, `yarn bob build`,
with its whole devDependency tree on every install); a vendored tarball (`*.tgz` is gitignored,
`/.gitignore:59`, so EAS would never receive it); waiting for upstream (the newest release, 10.3.5 of
2026-07-22, has no such prop and moves the Mapbox SDK to 11.23.1; GitHub shows no issue or PR for it).
This supersedes GPS_ACCURACY.md §F F-01's "never patch-package" note, whose premise (a
`mobile/package.json` script moves the fingerprint) stopped being true on 2026-07-28; the cascade dates
the correction.

The developer consequence goes into a new "Native patches" section of mobile/README.md and one line in
CLAUDE.md: run `npm ci` in `mobile/` after crossing the native commit in either direction, or `ota:check`
refuses the tree (a plain `npm install` leaves the package patched on the way back, because npm doesn't
re-extract an installed package of the same version), and `eas build` fails on the worker, which
recomputes the runtime version and throws on a mismatch. If EAS ever installed without devDependencies
the build would fail at install, loudly (the fix: move `patch-package` to dependencies).

**J.3 The ring patch.** Six files in `@rnmapbox/maps` 10.3.0. A 155-line draft applies cleanly to the
installed copy (re-checked 2026-10-03) and leaves both spec copies identical:

- **Both spec copies** declare `type AccuracyRing = { isEnabled?, color?, borderColor? }` and
  `accuracyRing?: UnsafeMixed<AccuracyRing>` after `pulsing`. `src/specs/` feeds native codegen and
  `lib/module/specs/` is what Metro bundles into the JS view config, so a prop missing from either never
  reaches the other side. Codegen on the patched spec emits `folly::dynamic accuracyRing` in `Props.h`, a
  required Android `setAccuracyRing(view, Dynamic)` and `accuracyRing: true` in the view config.
- **iOS**: `RNMBX_OPTIONAL_PROP_NSDictionary(accuracyRing)` in the Fabric component view's `updateProps`,
  and an `accuracyRing` property in `RNMBXNativeUserLocation.swift` applied to the `Puck2DConfiguration`
  just before `location.options.puckType = .puck2D(configuration)`: `showsAccuracyRing` from `isEnabled`,
  colours only when given, through the `RCTConvert.uiColor` the pulsing code already uses.
- **Android**: `@ReactProp(name = "accuracyRing") setAccuracyRing` in the view manager (the regenerated
  interface requires it), and in `RNMBXNativeUserLocation.kt` `location2.showAccuracyRing = visible &&
  isEnabled`, colours only when given. The SDK's individual setters re-apply only on change
  (`LocationComponentSettingsBase.kt:105-114`), unlike `updateSettings`, which always re-applies, so no
  comparison guard is needed; `visible &&` keeps a hidden puck from drawing an orphan ring.

JS passes no colours, so both SDKs keep their identical default (#89CFF0 at 30 %) and nothing is
hard-coded; the colour keys stay in the prop for a later over-the-air change, passed through
`processColor` at the call site (§F.2). An old binary ignores the unknown prop on both platforms
(Android's fallback setter is a no-op; iOS's generated props read only declared keys), and the JS that
passes it rides only bundles built from the patched tree anyway. The JS side is §F.2.

Tests read tracked files, because CI's mobile step has no install. **New**
`mobile/lib/locationPuck.test.js`, written against the merged component (§F.1's `FeedAwarePuck` and the
plain Books puck in one file): every map screen renders exactly one puck, never `visible={false}`; every
`accuracyRing` expression ends in `RING_ON` or `RING_OFF` behind `ACCURACY_RING_ENABLED`; any ring colour
goes through `processColor`; the ring comes from the prop, never a JS `CircleLayer`, `FillLayer` or
`ShapeSource` (comments stripped); only `map.jsx` and `books.jsx` opt in, detected by attribute in any
order; the patch carries all six hunks and its `diff --git` paths are exactly those six files, so stray
build output fails CI; `@rnmapbox/maps` is pinned exactly and the patch file name matches the pin;
`postinstall` and the devDependency exist; a local install has the patch applied (skipped where
`mobile/node_modules` is absent, as in CI). `privacyGrep.test.js` (§D.7) extends its walk to
`mobile/patches/` and `mobile/plugins/`. The prototype (7 pass, 1 skipped; the install case fails on an
unpatched install and passes on the patched copy) ran on a tree without §F.1, where two of its pins fail
against the merged component, so the pins above are rewritten and re-run once §F.1 is in the tree.

**J.4 The iOS "precise location once" prompt (D25).** Mapbox's `AppleLocationProvider` asks iOS for
temporary full accuracy, with the hard-coded purpose key `LocationAccuracyAuthorizationDescription`, when
authorization changes while it is updating and the app has only reduced accuracy (v11.18.2
`AppleLocationProvider.swift:295-304`). Apple fails that request with `promptDeclined` when the
Info.plist has no entry for the key, and Mapbox passes no completion, so today it fails silently. The
change is one `app.json` key, merged into Info.plist at prebuild:

```json
"NSLocationTemporaryUsageDescriptionDictionary": {
  "LocationAccuracyAuthorizationDescription": "Doorline can't record a door from an approximate location. Your precise location puts you at the right house: it is shown on your own phone and sent to Doorline only when you record a door or correct a house's map pin."
}
```

That copy is the recommendation; the owner edits it freely, keeping both uses (the on-phone display and
the recording) and the pin clause. PRIVACY_VERIFICATION §C9(c) forbids the shorter "only when you record
a door": every pin correction sends the phone's location too, even a drag (the server ignores it there),
and the sheet can appear on any map that draws the dot, admin maps included. A granted pass lasts the
session and also draws the dot, so the copy must not read as if precise location were used only at a
knock. It stays inside the permission strings (`app.json:15, :38`) and `privacy.html:94`. When iOS shows
the sheet: the provider is created at map init and rnmapbox applies the puck after style load, so a plain
map open should not prompt (inference; J.10 step 9 confirms it). It does prompt when the canvasser
answers the first location question with Precise switched off while a map is open, and when Precise is
switched off in Settings and the app returns to a map showing the dot. A granted pass covers every
location client in the app (dot, feed and knock gate) until the app stops being used; after that there is
no automatic prompt and the red notice applies again, unless D30 ships. Android: nothing (Approximate is
a separate permission there).

**New** `mobile/lib/permissionStrings.test.js` reads `app.json`: the dictionary's only key is the one the
SDK asks for and its copy names both the recording and the on-phone display. (The background and
always-on checks live in `privacyGrep.test.js`, §D.7, from M1.) Risk: if iOS delivered the creation-time
callback after the puck starts observing, a Precise-off phone would see the sheet on every map open;
staging decides, and the only lever is removing the key in a later build. Not reversible over the air.

**J.5 Try again asks for precise location once (D30, iOS).** Without it, the J.4 sheet appears only at an
authorization change while a map is open, and a canvasser who leaves Precise off is refused at every door
and never offered it again. Apple's guidance is to ask when the action needs it, which is the tap. A
second patch, `mobile/patches/expo-location+19.0.8.patch` (with `expo-location` pinned from `~19.0.8` to
`19.0.8`), adds one method to expo-location's iOS module, inserted after `getProviderStatusAsync` so the
hunk's context lines carry none of the §C9(a) grep terms:

```swift
AsyncFunction("requestTemporaryFullAccuracyAsync") { (purposeKey: String, promise: Promise) in
  let manager = CLLocationManager()
  if manager.accuracyAuthorization == .fullAccuracy { promise.resolve(true); return }
  manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: purposeKey) { _ in
    promise.resolve(manager.accuracyAuthorization == .fullAccuracy)
  }
}.runOnQueue(.main)
```

The manager never starts updates; it exists only to ask. `location.js` reaches the method through
`requireOptionalNativeModule('ExpoLocation')` (re-exported by `expo`), outside `acquire()` so the
ladder's structural pin is untouched: `canAskPreciseOnce()` (iOS, and the method exists in this binary)
and `requestPreciseOnce()` (resolves `false` on any failure, never throws). When `canAskPreciseOnce()`,
`locationBlockedAlert`'s iOS `PRECISE_OFF` branch (§D.6) makes **Try again** run
`requestPreciseOnce().then((ok) => (ok ? onRetry() : onCancel()))`, and its message gains the clause "Try
again can also ask to use your precise location just this once." Android, and an old binary without the
method, keep the plain retry. No new button: when Precise is already on (the warm-up case §D.6 names) the
method resolves `true` at once, so Try again behaves exactly as today. Declining the sheet cancels rather
than retrying into the same refusal. The gate order is unchanged, and the red notice's tap stays the
lasting fix (Settings).

Tests in `locationGate.test.js`: the purpose key in `location.js` equals the dictionary's only key;
iOS-only, guarded, can't throw; absent from the `acquire()` slice; the iOS branch calls it before
`onRetry`, and Android's buttons stay `[cancel, openSettings, retry]`. `locationPuck.test.js`: the patch
adds the method on the main queue. Its CoreLocation calls typecheck in isolation against the iOS 26 SDK
(Expo's module wrapper was a stand-in); the first real compile is J.10 step 5, and the rest is checked on
device (J.10 step 9). Requires J.4: without the key iOS refuses. Known case: right after **Allow Once**,
if the fresh read times out (a porch, a cold GPS), the gate's capped step can stamp the last-known fix,
which can still be the pre-grant approximate one, and the same alert shows again; a second Try again
resolves at once and usually records, which the alert's existing "tap Try again" line already covers.
J.10 step 9 checks it under a porch. Rollback over the air: an update that drops the iOS branch; the
native method stays, unused.

**J.6 Permission strings (D26).** Both iOS strings (`app.json:15`, and the expo-location plugin's copy at
`:38`, identical today) gain one sentence: *"While a map is open, your live position is shown on your own
phone to help you navigate and is not sent to us."* The second sentence stays byte for byte, so
LOCK_SCREEN_AND_DIRECTIONS.md:325's quote of "never tracked continuously or in the background" stays
true; the first changes only if the owner adopts the pin-fix clause below (no tracked file quotes it).
Found while designing: the strings say Doorline records location "only at the moment you log a knock or
submit a survey", but a lead's or admin's GPS pin fix also records the phone's position, as the house's
new pin with its accuracy (`HouseholdLocationChange`, `source: 'gps'`; PRIVACY_VERIFICATION §C9(c)
already lists the pin-correction endpoint). The refresh is the moment to name it, in the owner's words,
for example "…when you log a knock, submit a survey, or fix a house's map pin". Whatever D26 decides,
B0's dated §C9(a) stamp already records the mismatch (drag fixes send a GPS fix but never store it, so
"records" is false only for GPS pin fixes). `permissionStrings.test.js` keeps the two copies identical
and pins the second sentence. PRIVACY_VERIFICATION gets a dated stamp under §C9(a) quoting the new
strings, and one in §H16(c), which quotes an older permission string. Not reversible over the air.

**J.7 Only if §O.6 confirms a foreground pause (F-17, D31).** If the dot keeps moving after 25 still
minutes, no code: the measurement goes into GPS_ACCURACY.md §F F-17 and §I, and F-17 closes. If it froze,
two halves ship together:

- **expo-location**: a hunk in the J.5 patch sets `pausesLocationUpdatesAutomatically = false` in
  `BaseLocationProvider.swift`'s init, after `allowsBackgroundLocationUpdates = false`; every foreground
  requester and streamer subclasses it. The lesser half: the feed's watchdog already rebuilds a paused
  stream within about 30 s.
- **The puck**: Mapbox's `AppleLocationProvider` is final, keeps its manager private and has no such
  option, and the MapboxMaps pod is built from source by CocoaPods outside `node_modules`, so only a
  Podfile step can reach it. **New** `mobile/plugins/withMapboxNoAutoPause.js`, a config plugin
  (`withDangerousMod('ios')`), inserts once after the Podfile's `post_install do |installer|` a Ruby step
  that adds `(locationManager as? CLLocationManager)?.pausesLocationUpdatesAutomatically = false` after
  the single line `self.locationManager.delegate = locationManagerDelegateProxy` in the pod's
  `AppleLocationProvider.swift`. It raises if the anchor is missing, so an SDK bump fails the build
  loudly, and a second run changes nothing. `app.json`'s plugins list gains
  `"./plugins/withMapboxNoAutoPause"` after the `@rnmapbox/maps` entry (an unlisted config plugin never
  runs; the entry moves both fingerprints, so it belongs in the native commit). It covers the map's
  default provider and rnmapbox's shared one used while the camera follows. Rejected: a native
  replacement provider (about 150 lines that would still miss the map's default) and rnmapbox's
  `CustomLocationProvider` (fed from JS, against the ruling).

Foreground only: `allowsBackgroundLocationUpdates` stays false and no `UIBackgroundModes` appears, so the
§C9(a) terms stay at zero; because it touches the collection mechanism it still gets a dated §C9(a)
stamp. Tests: the plugin's anchor, inserted line, idempotence guard and raise; `app.json` lists the
plugin whenever the plugin file exists; the patch's line and no background switch. The plugin prototype
inserted once beside rnmapbox's own post_install block on the SDK 54 template Podfile, and a second run
changed nothing; the anchor occurs exactly once in v11.18.2. A §O.6 result that arrives after the cycle
is cut waits for the next one.

**J.8 Only if §O.8 shows the platform providers.** Give the Android puck a location provider backed by
Google's `FusedLocationProviderClient` (Mapbox v11's location component accepts a custom provider;
confirm the API against 11.18.2 before building), so the dot and the stamp share Google's fused
corrections. Same patch vehicle; owner decision then.

**J.9 Upstream, not shipped here (D32).** Two pull requests to rnmapbox from the owner's GitHub account
(public library code, no customer data):

- **The `accuracyRing` prop**: the six files plus `LocationPuck.tsx` (docs and a `processColor` step) and
  an example toggle, so the local patch can be deleted at the first release that carries it.
- **The Android lifecycle drop (F-12)**: `LocationComponentManager.update()` commits its new state even
  when it skipped the apply because the map view was detached (lifecycle `CREATED` after
  `onDetachedFromWindow`), and nothing re-applies on re-attach, so a `showNativeUserLocation(true)`
  issued under a covering screen never enables the puck. Fix sketch: a pending-apply flag replayed from
  `onAttachedToWindow`. No local patch unless an Android report matches: the dot missing entirely (not
  misplaced) after returning from a door, building or survey screen, fixed only by leaving and
  re-entering the map. Then the change folds into the patch at the next cycle.

Not in scope: open upstream issue #4225 (one fused-location provider leaked per map destroy on Android,
reported on 10.3.1 with Expo 54). The iOS simulated-location flag (F-13) waits for expo upstream.

**J.10 The cycle, step by step.** The native change is built, tested and submitted from a separate copy
of the repository on its own branch, so `main` and the shared folder keep the installed app's fingerprint
until both stores approve (step 11): once `main` carries the native change, plain phone updates stop
reaching the app version people have installed. The copy is made once, at step 4: `git clone "$(git -C
~/Desktop/canvass-app remote get-url origin)" ~/Desktop/canvass-native`, then `cd
~/Desktop/canvass-native` and `git switch -c gps-native`. Nothing else is ever in that folder, so your
usual `git add -A`, commit and `git push -u origin gps-native` (the first time; `git push` after) are safe
there. Every `eas build` and `eas submit` for N1 runs in that copy's `mobile/`, where `npm ci` must show
patch-package's ✔ line for each patch (`@rnmapbox/maps@10.3.0`, and `expo-location@19.0.8` once §J.5
ships).

1. **Tooling, on `main` before the freeze** (`mobile/scripts` is not a fingerprint input).
   [`mobile/scripts/ota-check.mjs`](../mobile/scripts/ota-check.mjs) gains `--build-ids=<id>[,<id>]`,
   exclusive with `--build-profile`: it compares the tree with those exact finished builds (`eas
   build:view <id> --json`) instead of each platform's newest build of a profile. Default behaviour is
   unchanged, and the script now exits 1 on any flag it doesn't know, so an older copy can never silently
   drop `--build-ids`. Its self-test: on today's `main` with the current production build ids it must
   print ✓ for both platforms, and one wrong id must exit 1. The same commit puts on `main` what anyone
   refused by plain `ota:*` in steps 6-11 needs, because the native commit's docs stay off `main` until
   step 11: mobile/README.md's "Publishing to the previous fleet" section (the `--build-ids` routine,
   never `OTA_ALLOW_MISMATCH`) and a replacement for that README's `OTA_ALLOW_MISMATCH=1` advice
   (`:227-228`) pointing to it. Step 3's tag line and hotfix row follow in a small docs commit on `main`
   before step 6.
2. **Publish everything the current fleet should get first** (M1 and M2 in production, each rollout at
   100 % on both platforms, or no longer listed as a rollout, in `eas update:list --branch production
   --json`, or reverted). After the native commit joins `main`, `main`'s bundles reach only the new
   binaries; an update published later reaches only phones that took the store update.
3. **Freeze what the old fleet actually runs.** Take the old runtime's newest production group from `eas
   update:list --branch production --json` and read its commit with `eas update:view <group id> --json`
   (`gitCommitHash`; the list has no commit field). From the shared folder: `git tag
   fleet-2026-11-pre-ring <the frozen commit>`, `git branch fleet-2026-11-hotfix <the frozen commit>`,
   then `git push origin fleet-2026-11-pre-ring fleet-2026-11-hotfix` (neither changes your working
   files). Make the hotfix copy now either way (§J.11's two commands, then `npm ci` in its `mobile/`). If
   `git merge-base --is-ancestor <step 1's commit> <the frozen commit> && echo PASS || echo STOP` prints
   STOP, cherry-pick step 1's commit there and `git push`; on PASS it is already there (`mobile/scripts`
   is neither bundled nor a fingerprint input). From here on, the old fleet is published only from the
   hotfix copy (§J.11), even before step 6 makes plain `ota:*` from `main` refuse: a publish from `main`
   would hand those phones every phone commit `main` gained since the freeze, untested, and leave the
   hotfix branch behind it. Ordinary phone updates wait until step 11; an urgent fix goes out from the
   hotfix copy. Record the four builds the old fleet
   runs now, before step 6 makes them no longer the newest of their profiles: `eas build:list --platform
   <ios|android> --build-profile <production|staging> --status finished --limit 1 --json`, each id with
   its runtime version, in the hotfix branch's README row; step 1's self-test, §J.11 and the abort path
   use those ids. Run step 1's self-test in the hotfix copy against them. The tag is recorded in
   mobile/README.md's frozen-ref table and in CLAUDE.md's frozen-refs paragraph, which then counts three;
   the hotfix branch gets its own README row, because it moves, but only by §J.11 cherry-picks, each
   logged with both group ids and its commit. The CLI can't show whether a publish was dirty, so this
   relies on rule 2's clean check at M2's publish (§N).
4. **The native commit, in the separate copy** (made now, as above): J.2-J.6 as decided; J.7 only if §O.6
   confirmed a pause and the owner said yes (D31); J.8 only with the owner's decision; the Part 2 docs;
   the regenerated `mobile/package-lock.json`; and `app.json` `expo.version` 1.0.1 → 1.0.2
   (mobile/README.md:161-168; `ExpoConfigVersions` keeps it out of the fingerprint). No Help edits in
   this commit.
5. **Local pre-flight, no EAS minutes**, in the copy: `npm ci` in `mobile/` (both ✔ lines), and the
   gitignored `mobile/.env.local` copied in from the shared folder's `mobile/` (`git status` stays
   empty). Unlike
   `eas` commands, local builds need it: it carries the token Gradle uses to download the Mapbox SDK and
   the map's public token, and without them the Android build fails in a way that looks like a patch
   error. Set `EXPO_PUBLIC_API_BASE_URL` to the production API too if the circle should actually be seen;
   otherwise this step proves compile and launch only. Then `npm run test:mobile` from its root, then
   `npx expo run:ios --configuration Release --device` and `npx expo run:android --variant release` on
   real phones (prebuild writes the gitignored `mobile/ios` and `mobile/android`). This is the first real
   compile of the patch's Swift, Kotlin and Objective-C++. A compile error is fixed in the patch, never
   worked around: the hard-coded variant has no over-the-air off switch, can't hide while grey, and would
   draw the circle on every map, admin maps included, because all four share one puck, so it goes back to
   the owner as a D2 change before any build, and if chosen the rollback lines here and in §N change with
   it. Expected: `npm run ota:check` now fails with FINGERPRINT MISMATCH on both platforms, proof the
   native change is seen.
6. **Four builds from the copy, production pair first and staging pair last** (`autoIncrement`
   assigns version codes as builds start; out of order hands Play internal testers the production build):
   `eas build --profile production --platform ios`, then `--platform android`, then the same two with
   `--profile staging`. The native commit stays off `main` until step 11, so `main` keeps the fleet's
   fingerprint; but the newest builds of each profile are now the unreleased ones, so plain
   `ota:production` and `ota:staging` from `main` refuse, and any fleet publish in this window goes
   out from the hotfix copy through `--build-ids` with the fleet's ids, as in §J.11.
7. **Submit the staging builds by id** (`eas build:list --limit 4` gives ids and runtime versions): `eas
   submit --profile staging --platform android --id <id>`. For iOS, upload the production build first, so
   the two 1.0.2 builds reach App Store Connect in build-number order, as mobile/README.md's submit list
   already does: `eas submit --profile production --platform ios --id <production id>` only uploads it,
   and nothing goes to review until step 10; then `eas submit --profile staging --platform ios --id
   <staging id> --groups "Team (Expo)" --what-to-test "<the circle, the precise-once sheet, Try again,
   the permission text>"`. Never `--latest`. Confirm that staging and production show the same runtime
   version per platform; if they don't, every build-currency step below lists both.
8. **Widen the build-currency vars** once TestFlight has processed the staging build and Play internal
   serves it: Heroku dashboard → the API app → Settings → Reveal Config Vars →
   `MOBILE_CURRENT_RUNTIME_IOS` and `MOBILE_CURRENT_RUNTIME_ANDROID` set to `<old>,<new>`. Check `GET
   /api/build-status?platform=…&runtimeVersion=…` reads `ok` for both runtimes on both platforms;
   otherwise the new builds nag themselves through the staging checks.
9. **Staging device checks** on TestFlight and Play internal. The circle: hidden under open sky, wide on
   a porch, moves with the dot without lag, house pins tappable through it, right on Satellite and
   Hybrid, survives a base-map switch and a map remount, absent on the admin maps, hidden while grey; the
   status pins under 50 m and 100 m discs still read correctly on Street and Satellite, and again after a
   grey/fresh flip on Android (whether the disc draws over the pins is the SDK's default, §F.2). The
   sheet: with a map open, switch Precise off in Settings and return, see our text, **Allow Once**, a
   door records, force-quit, approximate again; no sheet on a plain map open with Precise already off;
   Try again's sheet (J.5), including Allow Once under a porch followed by Try again. The new permission
   text under Settings → Doorline → Location. §O.6 again if J.7 shipped.
10. **Production submits, iOS first.** Both iOS builds sit in App Store Connect under 1.0.2, so attach
    the right one to the App Store version: the build whose Build number `eas build:view <production iOS
    id>` prints with Profile production, identified only that way (the staging build would ship an app
    that reads the staging channel). Set the version to **Manually release this version** and submit it
    for review. Only after App Review approves 1.0.2, `eas submit --profile production --platform android
    --id <id>`; Play releases it to production users as soon as its review accepts it (`releaseStatus:
    completed`), and then 1.0.2 is released in App Store Connect. So no store serves an N1 binary unless
    both stores have approved it.
11. **Merge into `main`** only after App Review has approved 1.0.2 and Play production has accepted the
    build, as the Play relaunch did. In the shared folder: `git fetch origin`, then `git merge --no-edit
    origin/gps-native` and `git push origin main`. If git refuses because a file the native change
    touches (its docs) has uncommitted edits, commit that work in its own commit first (rule 1), then
    merge; if the merge stops with CONFLICT, `git merge --abort` and follow rule 4. JS-only
    commits that reached `main` meanwhile don't move the fingerprint, so the builds stay valid for the
    merged tree. Then run `npm ci` in the shared folder's `mobile/`, which applies the patches there (tell
    the other sessions, since it reinstalls that folder's packages), and check with `npm run ota:check`.
    From here, updates from `main` reach only the new binaries, and the copy can be deleted.
12. **Narrow the build-currency vars** once the App Store has released the build and Play production
    serves it: both vars set to `<new>` only (D33); check that the new runtime reads `ok` and the old one
    `outdated`. `MOBILE_UPDATE_MODE` stays `soft`; `MOBILE_STORE_URL_ANDROID` stays set and
    `MOBILE_STORE_URL_IOS` unset. `MOBILE_UPDATE_NOTE` is one global value that the legacy
    `com.canvassapp.mobile` app shows too, and mobile/README.md reserves it for that app's "open Doorline
    once on wifi to sync, then install the new app" migration copy, because knocks still queued in the
    old app are lost if people stop opening it. So read the current note in the dashboard first; while
    the legacy fleet exists, keep that copy (or one sentence that still says to sync first), and
    otherwise leave the note unset.
13. **Post-release commit**: the Part 1 docs and Help copy for the circle, the sheet and Try again, out
    with the next server deploy from `main`. From step 11 on, Help about any phone change links
    `app-says-update-available`, not `app-asks-to-restart`, because updates no longer reach older apps.

**Abort path.** If staging, App Review or Play's review fails, the native branch stays off `main`, and by
step 10's order no store serves an N1 binary. Until N1 binaries are in the stores, every publish to the
fleet goes out from the hotfix copy (§J.11) with `node scripts/ota-check.mjs --build-ids=<the fleet's
ids>` before `eas update`, never with `OTA_ALLOW_MISMATCH`. If the native change somehow reached `main`
before a rejection, revert it on `main` (rule 4: `git revert --no-edit -m 1 <merge commit>`, or each of
its commits, newest first, if it arrived without a merge) and run `npm ci` in `mobile/`, so `main`
matches the fleet again. If N1 is abandoned, the unreleased builds remain the newest of their profiles,
so `--build-ids` stays in use until a superseding build exists; when publishing from `main` resumes, redo
step 3 before any retry. Should a store ever serve an N1 binary while the native change is still off
`main`, an emergency fix goes out twice: to the old fleet from the hotfix copy as in §J.11, and from the
native copy after `git fetch origin` and `git cherry-pick <fix>` there, with `--build-ids=<the N1
production ids>`, where `git log --oneline <the N1 builds' commit>..HEAD -- .`, run in the copy's
`mobile/`, must list exactly the fix; this holds until the native change is merged.

**J.11 The old fleet during the transition (D34).** Once the native commit joins `main`, updates from
`main` reach only the new binaries. A JS fix the old fleet must have goes out from a second separate
copy, kept for this: once, `git clone "$(git -C ~/Desktop/canvass-app remote get-url origin)"
~/Desktop/canvass-hotfix`, then in it `git switch fleet-2026-11-hotfix`. For each fix: `git fetch
origin`, then `git cherry-pick <fix>` there, so each publish carries the earlier fixes too (a branch's
newest update replaces the whole bundle), `git show --stat HEAD` listing only the fix's files (on
CONFLICT, `git cherry-pick --abort` and rule 4), `git push`, `npm ci` in its `mobile/` (the old lockfile,
so `node_modules` is unpatched) and an empty `git status --short`; the Commit line the publish prints
must equal the branch tip. Staging first when a test device still runs the old staging build: `node
scripts/ota-check.mjs --build-ids=<old ios staging id>,<old android staging id> && eas update --branch
staging --environment production`. Then production: `node scripts/ota-check.mjs --build-ids=<old ios
production id>,<old android production id> && eas update --branch production --environment production`.
Going straight to production, when no old-build test device exists, is a stated exception to the
staging-first rule, for emergencies only. Each publish makes one group per platform; both group ids and
the commit go into mobile/README.md. Never `OTA_ALLOW_MISMATCH`: it waves a wrong tree through as readily
as the right one, while `--build-ids` still compares real fingerprints. Rolling back after N1
republishes, for each platform, only a group whose runtime version matches the fleet being rolled back.
The soft nag moves everyone else; the tag and the branch retire once the old install base is near zero,
and until then Help keeps a line describing anything older apps still show (the interim readout, if D27
was chosen).

Rollback: the circle has an over-the-air off switch (`ACCURACY_RING_ENABLED = false`), and Try again's
request goes with an update too. The purpose key, the permission strings and J.7 wait for the next cycle.
The build-currency vars revert instantly in the dashboard, and the endpoint fails open.

## K. Docs and Help Center cascade

Every user-facing change updates its docs and, from Part 1 only, the Help Center. Help ships with any
server deploy, so each article is committed only after the production phone update it describes is
offered to every phone (§N rule 5: a staged rollout at 100 % on both platforms, the update seen on a
phone of each), and goes out with the next deploy.

| Change | docs/ (Part 1 and Part 2) | Help Center |
|---|---|---|
| Dialog fix + amber notice + No GPS alert (§C) | CANVASSER_APP.md (an amber notice is advice; the banner paragraph rewritten with both channels), GPS_ACCURACY.md (Part 1 cause 5 and What to check, §B, a new §F F-25 row, §G item 3, §I, §J) | faq/why-location-required.md (amber paragraph, saying the setting is optional and lets Google use nearby Wi-Fi and cell signals to locate the phone; Android paths; Turn on sentence), guides/canvasser-map.md, faq/blue-dot-not-where-i-am.md, getting-started/canvasser-first-day.md, faq/canvasser-dot-off-will-it-flag.md (lead) |
| F-25 notice fix + honest Precise copy (§C.3, §D.6) | CANVASSER_APP.md (red-notice bullets), GPS_ACCURACY.md §F | faq/why-location-required.md (iPhone wording; the Try again label is already corrected in B0), guides/canvasser-dispositions.md |
| Getting your location (§D.4) | CANVASSER_APP.md At the door, SURVEYS.md, GPS_ACCURACY.md Part 1 | guides/canvasser-dispositions.md, guides/canvasser-door-survey.md, faq/blue-dot-not-where-i-am.md |
| Precise early warning (§E.4) | CANVASSER_APP.md Part 2 constants; GPS_ACCURACY.md §F F-11 verdict and §G item 7 (it ships before the device log: 3 readings, 45 s span, 60 s gap); Part 1 timing after the device log | faq/why-location-required.md timing sentence, after the log |
| Grey dot (§F.1) | GPS_ACCURACY.md Part 1 (short answer, what the dot is, Google/Apple comparison), CANVASSER_APP.md, MAPS.md | faq/blue-dot-not-where-i-am.md (new bullet "The dot is grey"), guides/canvasser-map.md, faq/_INBOX.md. The copy uses Part 1's timings (a few seconds after you unlock or open the map, about half a minute otherwise), never the design draft's "about 15 seconds"; if §O.6 confirms F-17 it adds that a blue dot which stops following you can still be stale (step into the open or reopen the map) |
| Interim readout, only if D27 (§F.3) | GPS_ACCURACY.md Part 1, CANVASSER_APP.md | faq/blue-dot-not-where-i-am.md, guides/canvasser-map.md; reduced in N1's post-release commit to one line for older app versions, removed when the hotfix branch retires (§J.11) |
| Porch latency decision (§D.5), with M2 | GPS_ACCURACY.md Part 1 (the "about 65 feet" sentence) and §A, §D, §E (the 20 m reuse bar); AUDIT.md §B.6 ("cached ≤ 15 s/≤ 20 m"); MAPS.md §C and §J ("≤ 20 m"); CANVASSER_APP.md Part 2 (the gate's constants); Location check's `doorTapSentence` follows by import, and its copy ("at once" / "may wait up to N seconds") is checked against the chosen option | none (no article states the 65 ft bar; checked by grep) |
| Invalid-fix refusal and the error restart (§D.1, §E.3) | GPS_ACCURACY.md §A, §B, §D (a negative accuracy no longer passes; the 30 s restart floor gains the error exception), and §G item 4 and §F F-08 (a zero accuracy is stamped as unknown, never refused, and in practice comes from a mock-location app or an emulator), Part 2 only | none |
| Accuracy circle (§F.2) | GPS_ACCURACY.md Part 1 (circle bullet, "on the latest app version"), CANVASSER_APP.md, MAPS.md | faq/blue-dot-not-where-i-am.md, guides/canvasser-map.md, faq/canvasser-dot-off-will-it-flag.md — after both stores serve the build |
| iPhone precise-once sheet and Try again (§J.4, §J.5) | GPS_ACCURACY.md Part 1 What to check (iPhone), §B iOS, §F F-14; CANVASSER_APP.md Part 1 (Precise Location bullets, "If you tap anyway"), Part 2 The precise-location gate | faq/why-location-required.md (the one-time pass, Try again) — after both stores serve the build |
| Permission strings (§J.6) | CANVASSER_APP.md (what it asks for on first run), GPS_ACCURACY.md (What the blue dot is) | none |
| Patch vehicle, build cycle, old fleet (§J.2, §J.10, §J.11) | on `main` before step 6: mobile/README.md's Publishing to the previous fleet section and the replacement for its `OTA_ALLOW_MISMATCH=1` advice (with step 1's tooling), then the frozen-ref table's tag line, the hotfix branch's row and CLAUDE.md's frozen-ref count, now three (a small docs commit after step 3); with the native commit: mobile/README.md's new Native patches section and Where things stood, CLAUDE.md (`mobile/patches/`, and `mobile/plugins/` if J.7 ships, added to the hashed inputs; one line: run `npm ci` in `mobile/` after crossing the native commit), GPS_ACCURACY.md (§F F-01 dated note; §H ruling: the circle is the engine's, drawn through the patch, and editing the patch is a four-build change; §G items 16-18 with build ids; §J) | none |
| Foreground-pause fix, if it ships (§J.7) | GPS_ACCURACY.md §B iOS, §F F-17, §I.1; PERFORMANCE.md (one sentence) | none |
| Location check (§G) | CANVASSER_APP.md (menu list incl. the missing Help center row, Location is required, new Checking your location section; Part 2 The Location check screen), GPS_ACCURACY.md (§G item 19, §I protocol), ADMIN_APP.md, MAPS.md, PERFORMANCE.md, README.md, mobile/README.md | **new** faq/check-my-location.md (canvasser, order 79), and a "Reading a Location check report" section in the lead FAQ canvasser-dot-off-will-it-flag (each verdict and what to tell the canvasser: Google Location Accuracy off, turn it on; Precise off, open Settings; several "No GPS reading" blocks, step off the porch and try again; feed Lost, reopen the map; and when to forward the report to Doorline), pointers in blue-dot, why-location-required, canvasser-dot-off-will-it-flag (lead → canvasser link is allowed), canvasser-map, faq/_INBOX.md |
| Panels and web circles, pin precision (§H.1-H.4, W1) | AUDIT.md Part 1 (drift paragraph, two places), §B.7, §D, §E, §F invariants; MAPS.md Part 1, §C, §D, §E, §I (incl. the `MapFilters.jsx` copy and the withheld note); GPS_ACCURACY.md | guides/audit.md, guides/maps.md, pages/page-audit.md, pages/page-map.md, faq/canvasser-dot-off-will-it-flag.md, saying "on the web map"; each carries the caption's point: the circle is a guide, not a boundary; one line in page-map and guides/audit says the web now labels distance after allowing for GPS accuracy, the phone's admin map keeps the older label until its next update (removed with the Help of whichever step brings §H.5), and older entries' labels changed while their flags did not |
| Phone admin labels (§H.5, M1 or M2) and phone circles (§H.6, M2) | MAPS.md, AUDIT.md §E (the phone's ping sheet and flag card) | with that step's Help (M1h or M2's): the phone's far labels; after M2: "the mobile admin map shows the same circles", added to the same articles |
| Server validation + clamp (§I) | GPS_ACCURACY.md Part 1 and §E formula, a new §F F-26 row; AUDIT.md §B, §B.5, §B.6 (three write paths, not two), §F; EXPORTS.md (the "GPS accuracy (m)" cell is blank for an invalid accuracy) | guides/audit.md and faq/canvasser-dot-off-will-it-flag.md: "A stamp whose phone reported no usable estimate gets no allowance." |
| Count script (§I.3) | OPERATIONS.md read-only audit table: `npm run audit:gps-stamps` and the `-- --since=<time>` form (a full time with its UTC offset, or a date read as 00:00 UTC) | none |
| Release rules (§N rules 2-4 and 7, D36) | CLAUDE.md, a short release section (the owner's routine of `git add -A`, commit, push, then deploy or publish; look at what a phone update or deploy carries; release what was tested; roll back by revert and redeploy; one step's device tests on the staging channel at a time; and the `--build-ids` rule while an app-store build is out, §J.10), in its own docs commit when the owner approves; CLAUDE.md's "Two release lanes" lines (staging published "normally from a feature branch", production "from `main`") reworded to that routine; mobile/README.md's publishing steps and OPERATIONS.md's publish, deploy and rollback steps point to it | none |

Copy that describes a phone change says "in the latest version of the app" and links
`app-asks-to-restart` (OTA) or `app-says-update-available` (N1), both audience `all`. From N1's merge on,
every phone change links `app-says-update-available`, because updates no longer reach older apps.
Version-tolerant wording is a backstop, not the gate: each step's Help is a post-release commit (§N),
because committing Help publishes it with the next server deploy.

Corrections folded in: GPS_ACCURACY.md §G item 13 and §J call the two `flags.js` files byte-identical
(they are hand mirrors, now test-pinned); `flagThresholds.js:5` names a client mirror file that doesn't
exist (the mirror is `FLAG_THRESHOLDS` inside [`client/src/lib/flags.js`](../client/src/lib/flags.js));
CANVASSER_APP.md's menu list omits Help center. Every new or edited article keeps `helpLinks.test.js`
green (no dead slugs, no link to a narrower audience).

## L. Privacy

Said out loud as the repo requires. Nothing reaches Doorline that didn't before, no subprocessor is
added, and the published Privacy Policy, ToS and DPA stay true (`privacy.html:94` and `:106`). One
consolidated v6 item 27 in PRIVACY_VERIFICATION.md, after item 26 under "Remaining honest gaps (v3)" (27
is the next free number today; whoever writes it takes the next free one), with dated stamps. Like items
17-26, it ends with "Owner to confirm before the production deploy". It is created by the first step that
adds a line to it (W1 or M1, whichever is applied first), and each step that adds or changes lines needs
the owner's confirmation of those lines before its production deploy or publish (W1, M1, M2, M2s, N1),
with the prompt and string wording confirmed again before N1. Each stamp ships with the step that makes
it true:

| Change | Class | Where it is recorded | Step |
|---|---|---|---|
| Today's permission strings (found in design) | they say location is recorded only for knocks and surveys; a GPS pin fix by a lead or admin records it too | a §C9(a) stamp, already written | B0 |
| One-shot reads stop raising Google's dialog; the notice reads provider switches and "a fused fix exists"; the amber notice recommends a Google device setting (§C) | none in substance; two new foreground in-memory reads; Google's setting runs under Google's own consent, and the involuntary dialogs drop | §C9(b) stamp; item 27 reconciles the nudge with `privacy.html:106` and with DPA §6, whose Google entry names only app distribution (an older gap; the owner rules on the DPA wording, §R) | M1 |
| The amber notice's dismissal (§C.3) | one short string in app storage, the advisory code and a day, `used` or `always` (for example `NETWORK_OFF 2026-10-03`), no personal data; it outlives sign-out (a Later's day becomes `used`), since it records a phone setting, not a person | §C9(d) catalogue of on-device stores | M1 |
| Feed health store (§E) | memory only, no coordinate and no mock bit (test-pinned); shown on Location check, and only its aggregates ride the optional share text, never the per-minute history or the restart ring; both rings, the history and the last readings cleared at sign-out | §C9(b) stamp naming the third in-memory reader | M1 |
| Gate log (§D.3) | new memory-only record of gate outcomes, incl. blocked taps that leave zero trace in data today; no coordinate, no mock bit; cleared at sign-out | §C9(d) stamp (not a store: never persisted) | M1 |
| Location check (§G) | own data on own phone. On Android, a cached-fix read when the screen gains focus, once after each fix action on the screen and once when the poll sees location or permission turn on (never on every tick), and only until one of them has found a fix this session, used only as "a fused fix exists", the coordinate discarded inside `location.js`; it can happen with no map open, for any role. The test tap: a user-tapped run of the knock ladder (up to three OS location reads, the permission prompt if permission was never granted, the stamp discarded on the phone; it writes the gate log and can raise the red notice). One user-initiated text share through the OS share sheet, carrying settings verdicts, accuracy in feet and its band, how long ago it updated, the freshness word, readings per minute, each tap's time, outcome, step, wait, accuracy and fix age, the refused reading's accuracy and age, the fresh-read time and whether it timed out, whether a test ran with the map closed, on iPhone the approximate-readings count, the report time, the app build and update id, and the phone's make, model and OS version (with the Android API level); with technical details open also the seconds from the last return to the first new reading, how many times freshness read lost, readings since the map opened, GPS starts and restarts and the longest gap; never a coordinate, an address, voter data, the per-minute history or the restart ring | item 27; §C9(b), (c), (d) stamps | M1 |
| Grey dot, accuracy circle (§F) | display-only, computed on the phone | item 27 line; no new stamp needed | M2, N1 |
| Admin circles, labels, pin precision, ping verdict (§H) | same data to the same roles; `correctedBy` / `locationConfirmedBy` explicitly excluded | item 27 line; optional §C10 note that the admin maps draw each stamp's accuracy | W1 (web); the phone's labels with M1, or with M2 if W1 was late; the phone circles with M2 |
| Invalid-fix refusal (§D.1) | precision bookkeeping: the same 15 s / 20 m reuse bar, now `isFastPathFix` in JS, plus the `isUsableFix` refusal of a negative accuracy (an iPhone's invalid coordinate); a zero accuracy (an Android fix with no estimate) is stamped as unknown, as the server stores it; the `getLastKnownPositionAsync({ maxAge: 15000, requiredAccuracy: 20 })` call that the 2026-10-03 stamp quotes no longer exists | §C10 stamp | M1 |
| Stamp validation, accuracy sanitising, clamp (§I) | stores less, never more; §C10's "accepts any z.number()" clause and its "assigns location verbatim" clause become false for accuracy | §C10 stamp with the count's before numbers; a small docs commit after W1's `--since` run adds the after numbers | W1; the off-Earth refusal's line with W1-offEarth or M2s, whichever carries it |
| Porch latency, if it ships (§D.5) | which OS fix can be reused at once; still the OS's own unrounded fix, at most 15 s old on this path and 2 min on any path. A: "cached-fix reuse bar ≤ 40 m for door and survey stamps; pin fixes keep 20 m". B: "a cached fix ≤ 50 m shortens the fresh read to 2 s and is stamped when the fresh read is not tighter" | §C10 stamp with the chosen text | M2 |
| iOS purpose key and Try again's request (§J.4, §J.5) | an OS consent prompt through which a canvasser who chose approximate location can grant precise location for one app session, so doors refused today can be recorded with a precise stamp; no new field, recipient, retention or audience; the owner approves the wording and confirms no policy edit | item 27 quotes the string and walks the triggers; §C9(a) stamp before the build | N1 |
| Permission strings (§J.6) | wording only: the on-phone live position made explicit (as `privacy.html:94` already says) and GPS pin fixes named | §C9(a) stamp quoting the new strings; a stamp in §H16(c), which quotes an older permission string | N1 |
| Foreground-pause fix, if it ships (§J.7) | none in substance (foreground only), but it touches the collection mechanism | §C9(a) stamp | N1 |
| The patch files (§J.2) | build-time only; `privacyGrep.test.js` walks `mobile/patches/` and `mobile/plugins/` | covered by the tracked-file grep below | N1 |
| The grep contract | now test-enforced (`privacyGrep.test.js`), including the expo-location plugin's background flags | §C9(a) stamp; the comment count drops from 2 to 1 once §E.3 rewords `useLocationFeed.js:74` | M1 |

The v3 watchlist gains one entry: *"We collect location only at the time an action is recorded"* and
*"…that live position is not transmitted to us unless an action is recorded"* stay true while the one
foreground watcher feeds nothing off the phone (`privacyGrep.test.js`) and Location check shows no
coordinate and shares only `buildShareText`, which is test-pinned to carry none.

The §C9(a) grep is run over tracked files only (`git ls-files mobile | xargs grep`), because the
gitignored `mobile/dist/` source maps match every term.

## M. Tests

| Suite | New or changed | What it pins |
|---|---|---|
| [`mobile/lib/locationGate.test.js`](../mobile/lib/locationGate.test.js) | changed | the rewritten acquire pins (stampFrom behind guards), the pin-fix ladder, every one-shot passes the dialog flag (the site list: three today, two after §D.1; the watcher named only through fragments), the advisory is never consulted inside a ladder, tap outcomes force-notify, gate log on both paths, `beginGateWait`/`finally`, Precise copy split, the No GPS alert's branches and buttons, probe constants and cadence replay, `isUsableFix` (a negative accuracy refused, a zero accuracy stamped as `null`); `getLocationAdvisory()` never destructured and its `catch` returning `undefined`; in N1, `requestPreciseOnce` keyed by the declared purpose key, iOS-only, outside the ladder |
| `mobile/lib/locationBanner.test.js` | new | notice precedence, dismissal and its stored code and day or `always` (midnight, the load race and the `hydrated` event, a changed code; `always` never expiring by date and kept at sign-out; a past-day Later, or one turned into `used` at sign-out, offering Don't remind me; a poll that sees the setting fixed clearing a stored `always` through `rearmAdvisoryDismissal`), the Settings fallback (`shouldOpenSettingsAfterPrompt`), `locationAdvisoryFor`, the remembered block never `NO_FIX` (a precise fix clears the notice after a `NO_FIX`; a remount restores `PRECISE_OFF`; subscribers still get `NO_FIX`) |
| `mobile/lib/locationHealth.test.js` | new | the fold, freshness table (every case also read from a tick's published snapshot, so an unanswered restart publishes `lost` on the next tick with no other event, with `lostSinceMount` and `answeredInTime` set), which events open a window (mount, the grant, `active` after `background`; never `background`), a dot lost at `background` staying lost through `active`, `greyAtBackground` held until a new fix, the time step on every event (`lost` entered on a background or an error event counted once; two restarts 5 s apart each `answeredInTime: false` at their own 15 s; a restart pending at lock `abandoned` after the unlock; a one-day clock jump writing at most 60 rows), no coordinate and no `mocked` key, single writer, single mount, the history (closing passed minutes as zero rows, background seconds split, an iOS `inactive` minute in its own row), `firstNewFixAt` and the restart ring, `resetLocationHealthHistory` clearing everything a person could read but the mount counters |
| [`mobile/lib/locationFeed.test.js`](../mobile/lib/locationFeed.test.js) | changed | error-restart policy, backwards clock, one watcher call inside `subscribe()`, every restart removes before subscribing, the writer-wiring pin (delivery, app state, mount, unmount, attempt, tick, and permission at both grant sites; mutation-tested) |
| `mobile/lib/gateLog.test.js`, `gateSlow.test.js`, `gateSlowWiring.test.js` | new | trace shape and safety (no coordinate, door id or `mocked`), `signOut()` clears the log, slow-label timing and keys |
| `mobile/lib/puckLook.test.js` | new | grey mapping (`isGreyDot` with `awaitingResume`: a lock never greys; grey only 5 s after a return for a phone not lost at lock; a dot grey at lock, lost or reacquiring, stays grey with no flip), image props per platform, scale per density, PNG sizes and colours, no `visible={false}` |
| `mobile/lib/locationCheck.test.js`, `buildInfo.test.js` | new | every derivation (fixed bands with no speed claims, `doorTapSentence` at a 20 and a 40 m bar, for a reading older than 15 s and for a `null` and a `0` accuracy, "Accuracy unknown" in the hero, the freshness word and the return-to-first-reading figure, `gateRunRow` and the share text in full form incl. "map closed", the settings row following the polled flags while `hasFusedFix` is held), the share text's two forms pinned line by line, no coordinate and never the per-minute history, background seconds or the restart ring, `hasFusedFixAsync` staying true after location goes off and on (the row reads Off, not Unknown), screen pins (exactly one `getCanvassLocation` call with `source: 'test'`, the button disabled while a run is in progress, the gate subscriber ignoring `NO_FIX`, no other location, submit or queue import, no `mocked`) |
| `mobile/lib/flags.test.js`, `accuracyRing.test.js` | new | phone helpers (M1 or M2, §H.1); byte-identical circle module; no circle above 250 m and none below `ACCURACY_RING_MIN_ZOOM` (an empty set at overview zooms); one withheld-note string; no onPress on the circle source and no circle layer inside a pressable source; the co-presence pin (lands with §H.5): circle text on the phone only alongside the `admin-accuracy-rings` source; `ringsZoomOk` set before `handleMapIdle`'s early returns and the circles memo's zoom dependency |
| `mobile/lib/privacyGrep.test.js` | new (M1; extended in N1) | one watcher, zero background terms, across `app/`, `components/`, `lib/` (tests included) and `app.json`, and from N1 `patches/` and `plugins/`; the expo-location plugin's background flags off and both Always options `false` |
| `mobile/lib/locationPuck.test.js` | new (N1) | written against the merged component: one puck per screen; every ring expression ends in `RING_ON`/`RING_OFF` behind the kill switch; ring colours only through `processColor`; the ring only through the prop, never a JS layer; field maps only, by attribute in any order; the patch's six hunks and exactly six `diff --git` paths; the exact pin, `postinstall` and devDependency; the installed patch (skipped in CI); the expo-location method on the main queue; the pause plugin and its `app.json` entry if it ships |
| `mobile/lib/permissionStrings.test.js` | new (N1) | the two strings identical and keeping the quoted clause; the purpose key exactly the SDK's |
| `server/test/flagsMirror.test.js` | new | W1: the web label = the server rule on 192 cases, incl. "Too imprecise to judge the distance" above 100 m; the phone-helper step (M1, or M2 if W1 was late) adds the phone mirror: identical text from every shared helper; the `hasUsableAccuracy` pin between `geo.js` and the web copy lands with whichever of W1 and M1 comes second; the legend footers: the web one equals the phone's plus the circle sentence until §H.6, identical after; thresholds equal the server's |
| `server/test/mapPingVerdict.int.test.js` | new | ping verdict = audit verdict (incl. the honest-correction door, which fails if the projection drops `replaced`); self-move not forgiven; whitelist |
| [`server/test/locationGate.int.test.js`](../server/test/locationGate.int.test.js) | changed | non-finite coordinates refused before any write (incl. 1e400 keeping the earlier entry); off-Earth ones refused only when W1-offEarth ships, its cases in that patch; accuracy sanitised on both ledgers and the snapshot; pin route; flag entry household keys |
| [`server/test/flagDetection.test.js`](../server/test/flagDetection.test.js) | changed | clamp at all four sites, zero = null, downgrades no longer denied by a negative, KPI and detector agree, `farVerdictForWire` |
| `server/test/auditGpsStamps.int.test.js` | new | every category counted (zero accuracies split by the mocked flag and by month), the clamp's aggregate deltas (severity drops, far reasons removed, KPI far count, forgiven, canvassers affected), `--since` with an offset time and with a bare date, a time without an offset, a malformed or rolled-over date and a future time each refused, the parsed instant and the rows scanned printed, no name or id printed, read-only |
| `client/src/lib/accuracyRing.test.js`, `mapRender.test.js`, `flagPanelsRender.smoke.test.js` | new | geometry, the 250 m limit, layer order, the circle input taking each new zoom and a smaller viewport after the auto-fit and two zoom-ins inside the padded box (`onRingView`), panel rendering incl. the caption and the "Too wide to draw" line |

Baselines today: `npm run test:mobile` 164 pass; server `npm test` 441 pass; `npm --prefix client test`
493 pass; `helpLinks.test.js` 3 pass.

## N. Rollout, gates and compatibility

**How you ship, and what this plan adds.** You ship the way you always have: `git add -A`, `git commit -m
"…"`, `git push origin main`, then Deploy → `main` in the Heroku dashboard for the server and web, and
`npm run ota:staging` or `npm run ota:production` in `mobile/` for the phone. This plan keeps that
routine and adds a few checks around it, because a phone update can't be taken back from a phone that
already has it, and Election Day is close. Every hand-off gives the exact commands in order.

**Before building:** commit today's GPS docs and Help change (B0, below), so every doc edit here applies
to committed text. Other sessions have uncommitted work in the same folder (on 2026-10-05: the
lead-survey-locks change and the placeholder-pins plan,
[PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md)); your usual `git add -A` commits it too, so
commit that work on its own first when it is ready, or use the hand-off's commands to commit the GPS
files alone (rule 1).

**Standing release rules.** Rules 2-4 and rule 7 are the ones every session needs, so they go into
CLAUDE.md (D36), in their own docs commit as soon as the owner approves and before D28's production
publish. Rules 1, 5, 6 and 8 are this plan's own.

1. **GPS work stays out of the shared folder until its step ships.** `git add -A` commits everything in
   the folder, so the session building a step keeps it, and tests it, in its own clone at
   `~/Desktop/canvass-gps` (never under `/tmp`, which macOS empties of files untouched for three days),
   saves each finished step as a patch file in `~/Desktop/canvass-gps-patches/` (`W1.patch`,
   `W1-offEarth.patch`, `M1.patch` and so on, each named in its hand-off), and applies it to the shared
   folder only in the sitting where you ship it (for a phone update, the sitting
   where it goes to staging). An ordinary commit for other work can then never carry a GPS step early.
   W1's off-Earth refusal is kept as its own small patch, W1-offEarth: on W1's night it is applied along
   with W1 only if the count re-run found no off-Earth rows; otherwise it waits, unchanged, as M2s. A
   step's commit holds that step alone, because every rollback here reverts it and rule 2 reads commit
   lists: other ready work is committed first, in its own commit (and, before a server step, deployed),
   and if some of it isn't ready, the hand-off's commands commit the step's files alone instead of `git
   add -A`. Before committing a step, `git status --short` should list only the files the hand-off
   names; for a file another session also edited (PRIVACY_VERIFICATION.md, README.md, `faq/_INBOX.md`),
   the hand-off stages only the step's lines (`git apply --cached <step>.patch`). After the commit, `git
   show --stat HEAD` must list only the step's files. When W1-offEarth goes out on W1's night, it is a
   second commit after W1's.
2. **Before any publish or deploy, look at what goes out.** Run every `npm run ota:*` and every other
   `eas` command in `mobile/`, never in the repository root (where eas offers to create a new project).
   Before a phone publish, `git status --short .` in `mobile/` must print nothing: eas sends the files on
   disk, so an uncommitted edit there would ship too. Then `git log --oneline <last production
   commit>..HEAD -- .`, also in `mobile/`, lists every phone change the update carries; for anything the
   hand-off didn't name, check with the session that made it first. The last production commit is the
   Commit line the previous `npm run ota:production` printed, or `gitCommitHash` in `eas update:view
   <group id> --json`; leave off a trailing `*` when you paste it (it only means some file elsewhere in
   the folder was uncommitted). If `git log --oneline <last production commit>..HEAD -- package-lock.json`
   (also in `mobile/`) prints anything, run `npm ci` in `mobile/` first (tell the other sessions; it
   reinstalls that folder's packages). After N1, the last production commit comes from the newest
   production group whose runtime is the new one, never from a §J.11 hotfix publish. Before a server
   deploy, `git log --oneline <deployed commit>..HEAD` from the repository root lists everything the
   deploy carries (the deployed commit is in the dashboard's Activity tab), and `npm run audit:mobile-api
   -- <deployed commit>` names the changed server files the phone calls.
3. **Release what was tested.** When you publish to staging, note the Commit line it prints (leave off a
   trailing `*`; if it wasn't noted, as for D28, read `gitCommitHash` from `eas update:view <staging group
   id> --json`). Before the
   production publish, from the repository root, `git diff --stat <that commit> HEAD -- mobile/
   ':(exclude)mobile/README.md' ':(exclude)mobile/scripts' ':(exclude)mobile/**/*.test.js'` must print
   nothing, so the app you release is the app you tested (the README, scripts and test files aren't part
   of it). If it prints anything, publish staging again and redo the checks the change could affect (a
   change only to `GATE_SLOW_MS` repeats §O.9 alone). From a step's staging publish until its production
   publish, nobody publishes a production phone update for anything else, because it would carry the
   untested step; an urgent one first takes the step back out (rule 4). So D28, the phone code already on
   `main`, goes to production before M1 is applied, and ships without it.
4. **Roll back with a revert.** For the server, Activity → the entry just below the bad deploy → Roll
   back to here is instant, but only when nothing above that entry is a config-var or add-on change,
   because Roll back restores that entry's config vars and would silently undo `OPT_IN_OUTCOMES`, the
   build-currency vars or a rotated `REDIS_URL`; then revert the commit on `main` so the next deploy
   doesn't bring it back. Otherwise revert and redeploy. To revert, `git revert --no-edit <commit>`, then
   `git push origin main`. If git refuses ("your local changes would be overwritten"), nothing changed:
   something is staged, or a file the commit touched has another session's uncommitted edits; that
   session commits or sets its edit aside first, or the hand-off gives you a ready revert to apply
   instead. If git stops with CONFLICT, run `git revert --abort` (or `git merge --abort`, or `git
   cherry-pick --abort`, whichever started it), and the folder goes back exactly as it was; a session
   then prepares the resolved change for you. Never `git add -A` or commit while `git status` says a
   revert, merge or cherry-pick is in progress, and never `git stash` in this folder, which would take
   every session's work. To pull W1 when W1-offEarth also went out, revert W1-offEarth's commit first,
   then W1's. A merge (§J.10 step 11) is reverted with `git revert --no-edit -m 1 <merge commit>`. A
   reverted step goes back in later by reverting the revert (`git revert --no-edit <revert commit>`). For
   the phone, republish the previous production update, once per platform (`eas update:republish --group
   <previous group id>`), or for a staged rollout `eas update:revert-update-rollout --group <group id>`
   (rule 6); then revert the step's commit so no later publish carries it. A phone rollback lands at each
   phone's next cold start or accepted Restart, and the restart banner shows on the map, never on door or
   survey screens.
5. **Help after the update is offered to every phone.** Each step's Help (M1h, M2's, N1's) is committed
   only after its production update is offered to every phone (for a staged rollout, once both
   platforms' groups are at 100 %, or no longer listed as a rollout, in `eas update:list --branch
   production --json`) and a production phone on each platform shows the new update in its Profile build
   stamp, whose `update` value is the first 8 characters of that platform's update ID (not the group ID).
6. **Stage the knock-gate changes.** An update that changes the knock gate (M1, and M2 when it carries
   §D.5's A or B) goes to production with `npm run ota:production -- --rollout-percentage=20`; note the
   two "Update group ID" lines it prints (for `update:edit`, `update:insights` and a revert) and the
   "Android update ID" and "iOS update ID" lines (what each platform's Profile stamp shows, rule 5). Hold
   at 20 % for at least one full field day on both platforms. Watch with instruments that can see a
   blocked tap: three to five named canvassers or leads whose Profile stamp shows the update report every
   blocked or slow tap and share a Location check report right after it, and once more at the end of the
   day (the log keeps only the newest taps, in memory); each group's failed launches and crash rate
   against the previous production group's (`eas update:insights <group id>`, once per platform); and, as
   supporting evidence only, since GOTV volumes swing week to week, each campaign's knocks on its
   Timeline page against the same weekday a week earlier. Back out on any rise in failed launches, or on
   repeated No GPS or Precise-off blocks on a Precise-on phone where doors normally record. Raise with
   `eas update:edit <group id> --rollout-percentage 100`, once per platform; back out with `eas
   update:revert-update-rollout --group <group id>`, once per platform, then revert the step's commit
   (rule 4). An open rollout blocks every other production publish for that runtime, so an emergency fix
   first raises or reverts it. Before republishing M1's groups to roll back M2, check in `eas update:list
   --branch production --json` that they show no rollout; otherwise publish M1's state again after
   reverting M2's commit, provided rule 2's list since M2's production commit shows nothing else; if it
   does, check with those sessions and revert those commits too before this publish. A rollback publish
   skips rule 3's staging comparison and this rule's 20 % stage, and goes to 100 % at once.
7. **The staging channel is shared.** While a step's device tests run on its staging build (the §O tests
   on M1's, §O.7 on M2's), nobody else publishes to staging, or the testers lose the build under test.
   M1's staging publish waits until D28's production publish is out. If M1 misses its cutoff, its commit
   is first reverted on `main` (rule 8); then §O pauses and staging returns to the other sessions until
   after the election.
8. **Election-season gate (D35).** Election Day is 2026-11-03. From 2026-10-27 through 2026-11-04 nothing
   from this plan is published or deployed except an emergency fix or a rollback; a rollout revert counts
   as a rollback, a rollout raise as a publish. "After the election" in this plan always means from
   2026-11-05. B0 goes into a commit now. W0 deploys by about 2026-10-08, and its count runs that night.
   W1 ships as soon as it is ready and no later than 2026-10-23, so a bad W1 isn't found in GOTV week.
   M1's contents are fixed by about 2026-10-13 (it carries §H.1's phone mirror and §H.5 only if W1 is on
   `main` by then; otherwise they move to M2, so W1 never holds M1 back), and M1 is applied, committed
   and published to staging in one sitting (rule 1). A redeploy reverts W1's code, but not a knock it
   already refused from an offline queue, so W1's and M2s's deploy sittings each run late in the evening,
   after the last crew in any time zone has stopped, and each includes a phone smoke test on the demo org
   (one online door result, one survey save, one Add a person, and one door recorded in airplane mode and
   replayed after reconnecting, each confirmed on the web map); the next morning's first queue flushes
   are watched in the dashboard's More → View logs for 400s on `/api/mobile/` routes. M1's dated
   checkpoints: D28 in production by about 2026-10-12, M1 on staging by about 10-14, §O.9 (run first),
   §O.1 and §O.2 passed by 10-20, 20 % by 10-21, 100 % by 10-23, M1h committed and deployed by 10-26. If
   §O.9, §O.1 and §O.2 haven't passed by 10-20, or 100 % isn't reached by 10-23, M1 comes out that day:
   any open rollout is reverted (rule 6), M1's commit is reverted on `main` and pushed (rule 4), and
   staging is published again from `main`; then M1 goes back in from 2026-11-05 by reverting that revert,
   with its own staging check and 20 % publish. M2, M2s and N1 come from 2026-11-05. The count script
   runs late in the evening, after the last crew in any time zone has stopped.

| Step | Contents | Ship | Gate |
|---|---|---|---|
| B0 | today's GPS_ACCURACY.md and its README row, the doc corrections, the two new FAQs, the edits to six Help articles, two `faq/_INBOX.md` lines and three privacy-record stamps (already written; one records the permission-string mismatch now); this plan and its own README row go in their own commit after approval | commit and push now (the hand-off's commands); it needs no approval of this plan, and it goes live with the next server deploy, whoever makes it (its Help is true on every phone today) | `helpLinks.test.js` and `npm --prefix server test`, run on a fresh copy before the hand-off |
| W0 | the read-only count script (§I.3), its root proxy, its OPERATIONS.md row and `auditGpsStamps.int.test.js` | applied, committed, pushed and deployed in one sitting (rule 1), by about 2026-10-08 | `npm --prefix server test`; `auditGpsStamps.int.test.js` through `test:int`; both console forms rehearsed from the repo root (§I.3); rule 2's look at what the deploy carries; then `npm run audit:gps-stamps` in the Run console, late evening |
| W1 | W1: §I.1-I.2 (validation without the finite off-Earth refusal; the clamp), §H.1-H.4 and H.7 (web panels, ping verdict, pin precision, web circles) and the web-only lead Help copy; and the separate W1-offEarth patch, the off-Earth refusal with its cases; nothing under `mobile/` | applied, committed, pushed and deployed in one late-evening sitting (rule 1), no later than 2026-10-23; W1-offEarth applied with it only if that night's count re-run found no off-Earth rows, otherwise it waits as M2s | the count re-run immediately before applying, which decides W1-offEarth; the owner's confirmation of the item 27 lines W1 adds (§L); rule 2's look at what the deploy carries, `npm run audit:mobile-api -- <deployed commit>` and the hand reading in §I.4; `npm --prefix server test`; the `test:int` marathon, with and without W1-offEarth; `npm --prefix client test` and build; browser walk (circles sized against a street and drawn after zooming in from the overview, clicks inside circles, basemap switch, the caption and "Too wide" lines); the phone smoke test and next-morning log watch (rule 8); afterwards `npm run audit:gps-stamps -- --since=<the deploy's finish time>` (§I.3) |
| M1 | §C, §D.1-D.4, D.6-D.7, §E.1-E.4, §G, §F.4 comments; §H.1's phone mirror and §H.5 only if W1 is on `main` when M1's contents are fixed (rule 8) | applied after D28's production publish, committed and pushed; `npm run ota:staging`; device checks; `npm run ota:production -- --rollout-percentage=20`; the raise to 100 % (rule 6) | D28 out first; D35's dated checkpoints; `npm run test:mobile`; `npm --prefix server test` (the phone half of `flagsMirror.test.js` when M1 carries §H.5); `npx expo export` parse smoke (output outside the tree); rules 2 and 3; the Profile build stamp shows the new update ID, not the group ID (rule 5), before any device check; §O.9 first, then §O.1 (with the Android 7-8 phone, or the owner's recorded waiver of that check, if D10 is approved) and §O.2 pass; the owner's confirmation of the item 27 lines M1 adds (§L) |
| M1h | Help copy for M1 | post-release commit, then a server deploy | M1's rollout at 100 % on both platforms and the update confirmed on a phone of each (rule 5) |
| — | device tests on Location check | — | §O protocol; results recorded in GPS_ACCURACY.md §I |
| M2 | §F.1 grey dot, §H.6 phone circles and their text, §H.1's phone mirror and §H.5 if M1 went without them, §D.5 decision, §E.4's span to 60 s if §O.3 tripped it, §E.5's distance filter if needed, the interim readout if D27 chooses it | from 2026-11-05 (D35): applied, committed, staging, then production, with rule 6's 20 % rollout when it carries §D.5's A or B; Help (including the Precise timing sentence) as a post-release commit | D1, with §F.1 only if §E.5's grey-dot test passed; the owner has seen the web circles; §O.7 (incl. the phone-circle performance check); the §O results; the owner's confirmation of the item 27 lines M2 adds (§L); M1's mechanical gates: `npm run test:mobile`, `npm --prefix server test`, `npm --prefix client test`, the parse smoke, rules 2 and 3, the Profile build stamp |
| M2s | W1-offEarth, if it was held | from 2026-11-05 (D35): applied, committed, pushed and deployed in one late-evening sitting | the old bundles have left the fleet: per platform, for every production group on that runtime whose commit (`gitCommitHash` in `eas update:view <group id> --json`) does not contain M1's final commit (`git merge-base --is-ancestor <M1's commit> <group commit> && echo PASS \|\| echo STOP` prints STOP), which covers D28's group, any older one and any copy a rollout revert republished, `eas update:insights <group id> --days 7` shows no unique users (or as few as the owner accepts), while a group containing it shows users; a phone still on a store build's own bundle is counted by no group, so it stays in the residual risk (a knock queued offline before a phone took M1, replayed later and dropped, since the queue never expires items), which is the owner's call; `npm run audit:gps-stamps -- --since=<the publish time of M1's final commit>` shows zero off-Earth rows; W1's server gates: rule 2's look and `npm run audit:mobile-api -- <deployed commit>` with the §I.4 reading of `canvass.js`, `npm --prefix server test`, the `test:int` marathon, the phone smoke test and next-morning log watch (rule 8), the owner's confirmation of the item 27 line it changes, and the `--since` count afterwards |
| N1 | §F.2 circle, §J.2-J.6, J.7 only with D31's yes, J.8 only with the owner's decision; `ota-check --build-ids`, the freeze and the old fleet's build ids first (§J.10 steps 1-3) | from 2026-11-05 (D35): built in a separate copy of the repo on the `gps-native` branch (§J.10), the four builds, the staging pair submitted (after the production iOS upload), the build-currency vars widened, staging checks, the iOS production build to App Review and the Android one only after its approval, iOS released once Play has accepted, merged into `main`, vars narrowed | D2, D25, D26, D29, D30, D33 and D34 (and D31 when §O.6 confirmed a pause); D35; privacy wording approved, with the owner's confirmation of the item 27 lines N1 adds; M1 and M2 already in production, each rollout at 100 % on both platforms or reverted; local release builds launch on both platforms; `ota:check` refuses before the builds and passes after; Help as a post-release commit after both stores serve the build |

Once N1's native change joins `main`, every update from `main` reaches only the new binaries, so N1 comes
after M2 (§J.10 step 2); a fix the old fleet still needs goes out under §J.11. Before M1's staging publish
(rule 7), the phone code already on `main` (5cb42b2 scripted surveys; 4d1276a's two `mobile/lib` files,
6d3ca94 and 44ca37e Not a target voter; confirm with rule 2's `git log` before the publish) is released to
production on its own (D28), which waits on the owner's scripted-survey device checks and on
PRIVACY_VERIFICATION item 25 being confirmed (item 26's confirmation is recorded, 2026-10-03).

Every step is additive for an already-shipped phone; no client-version bump anywhere. W1 changes nothing
under `mobile/`, but once the phone mirror ships (M1 or M2), reverting W1 conflicts on
`server/test/flagsMirror.test.js`, so the revert also takes out the phone-vs-web checks, and the server
suite runs before the redeploy. The circle has an over-the-air off switch (`ACCURACY_RING_ENABLED =
false`), and full removal waits for the next cycle. After any agent-assisted build, the building session
reconciles its scratch copy's `git status` against the step before handing it over.

## O. Device tests (mostly on the Location check screen)

Run on the M1 staging build unless a test says otherwise, §O.9 first: if it moves `GATE_SLOW_MS`, staging
is re-published at once, before the other checks. Record results in GPS_ACCURACY.md §I.

1. **Android device-only mode** (Android 12+ with Play services; name the phones before M1 is built, a
   Pixel and a Samsung if possible): Google Location Accuracy off → no Google box at map open, mid-knock
   under a porch, or in a pin fix; the amber notice appears; `Later` hides it across Books, lock/unlock
   and a force-stop, and it returns the next day or after sign-out; after one Later, **Don't remind me on
   this phone** keeps it hidden across days and it comes back when the setting changes; the notice's tap
   raises Google's box, "No thanks" does not then open Settings, "Turn on" clears it; Location check's
   row behaves the same; location fully off swaps in the red notice. Confirms the `NETWORK_PROVIDER`
   mapping per OEM and that Google's dialog pauses the host. If D10 is approved, also an Android 7-8
   phone in Battery saving mode: the amber `GPS_OFF` notice, and on a No GPS alert (forced with no
   network fix, since network location usually answers), **Open Settings** opens the Location page; with
   no such phone on hand, the owner's recorded waiver of this check.
2. **iPhone F-25**: Precise off, tap a door → blocked alert and the red notice; lock and unlock → the
   notice STAYS; switch to Books and back → it STAYS; a **Test a door tap** deep indoors that times out
   (a "No GPS reading" result) → it STAYS; Precise back on → it clears within seconds of a fix.
3. **iPhone Precise-off cadence (F-11)**: force-quit, open the houses map with Precise off, two minutes,
   technical details open. Equal "readings since the map opened" and "GPS starts" means one coarse fix
   per subscription; the time the red notice appeared decides the Help timing sentence. Then the
   false-alarm check: Precise ON, Location Services off for a minute and back on, indoors away from
   windows, force-quit, open the map, two minutes; the retuned rule must not trip (§E.4).
4. **Porch latency (F-15)**: at about 20 porches on an iPhone (a non-Pro model if possible; covered
   porches, eaves and open stoops; for 5 of them lock the phone while walking up and tap within 2 s of
   unlocking), stop at the door, wait 3-5 s, then **Test a door tap**, with Location check opened from
   the houses map (drawer or `Details ›`) so the map stays mounted underneath; share the report after
   every
   10. Plus 10 Android taps (two at each of 5 porches) to confirm nothing regresses. Apply §D.5's rule.
5. **Still phone (the grey dot's go, and F-19)**: open the houses map fresh, then three minutes flat on a
   table indoors, technical details on; record readings per minute, restarts, the restart ring (each
   restart's first answer and whether a current fix answered it within 15 s) and `lostSinceMount`; then
   lock 60 s, unlock without moving, and read the seconds from the return to the first new reading. Apply
   §E.5's rule.
6. **Foreground pause (F-17)**: iPhone unplugged, Low Power Mode off, Auto-Lock set to Never (restore it
   after), a still spot with sky view, 25 minutes untouched with the map open — once with follow off and
   once on. Then walk 100 m watching the dot, switch to List and watch the nearest-first order, and read
   the per-minute history. The dot froze → F-17 confirmed: §J.7 enters N1, and the grey dot can't cover
   that case (the feed restarts itself and stays fresh while the puck's own manager is paused). The dot
   moved and the feed never went quiet → F-17 closed.
7. **Grey dot and circles (M2 staging build)**: parity with the Books dot, never grey at lock or on a
   quick unlock, a dot already grey in a dead spot, or grey after a slow unlock, staying grey through a
   lock and unlock until a reading, never grey under Google's dialog or the permission dialog on Android,
   never grey with the phone still for 3 minutes outdoors and again under a porch, never grey after 60 s
   locked at a door and unlocked without moving, grey in a basement within the stated time, a 60 fps
   screen recording of ~20 flips for a vanished frame, base-map switch while grey, Android sizes on three
   densities; phone admin circles under houses, taps inside circles open the right item. Phone circle
   performance: Pings on, All time, zoom 15, the densest campaign, a low-end Android; panning shows no
   visible hitch and a poll paints within about 300 ms, or the phone gets a lower cap (§H.6).

8. **Which provider draws the Android dot (GPS_ACCURACY.md §I.6)**, read-only over USB: with the phone
   plugged into a Mac and USB debugging on, open Doorline → Books (the puck runs there with no feed),
   wait 30 s and run `adb shell dumpsys location`; repeat on the houses map. If `com.doorline.app`
   appears under the platform `gps` or `network` providers on Books, the Android dot isn't using Google's
   fused provider and can disagree with the stamp near buildings by more than the glide; that triggers
   §J.8. If it appears only under fused, or only through Play services, the question is closed. (Claude
   can run this command if the phone is connected to this Mac; it changes nothing.)
9. **Warm-tap label (M1)**: on the crew's lowest-end Android, 20 **Test a door tap** runs on the houses
   map while the dot is current, technical details on (they print waits in milliseconds), sharing the
   report after every 10. If the 95th percentile of `elapsedMs` for step `recent` is about 300 ms or
   more, `GATE_SLOW_MS` becomes 600 before the production publish, so "Getting your location…" never
   flashes on a warm tap.

## P. Traps this plan guards against

- A second location watcher, or a comment that spells the watcher's name: `privacyGrep.test.js`.
- A coordinate leaking into a new readout or the shared report: tests on every store and on
  `buildShareText`.
- The knock gate reading the feed, its health or the advisory: structural pins.
- A populated `userId` silently forgiving a canvasser's own pin move: `mapPingVerdict.int.test.js`.
- A circle layer stealing clicks or taps: layer-order and no-onPress pins on web and phone.
- A refused offline replay silently deleting a knock: accuracy is nulled, never refused, and a finite
  off-Earth coordinate is refused only after the count shows no phone sends one (§I.1).
- The map's ping query losing `replaced`, which silently disables the honest-correction downgrade:
  `mapPingVerdict.int.test.js`'s honest-correction door.
- The Android mock bit reaching a canvasser-facing readout (the ruling: mock detection stays invisible in
  the app): `mocked` is a forbidden key in both stores, and no Location check derivation reads it.
- The feed's writer line dropped or mis-passed in a merge, greying every dot for good: the wiring pin in
  `locationFeed.test.js` (§E.1).
- A background switch arriving through the expo-location plugin's options, invisible to a grep:
  `privacyGrep.test.js` parses them (§D.7).

- The structural pins' slice markers (`'async function acquire('`, `'// Best-effort read'`) disappearing
  in a merge.
- An iOS image prop going back to `undefined`, which iOS ignores, keeping the old image: both dot states
  always name the same image props.
- A dictionary prop omitted instead of `{ isEnabled: false }`: rnmapbox's existing `pulsing` setter on
  Android ignores null and keeps the last value, so the puck never relies on omission and always passes
  `RING_ON` or `RING_OFF` (the patched `accuracyRing` setter clears on null on both platforms, §F.2).
- A ring colour passed as a plain string, which both platforms silently ignore: only `processColor`
  output reaches native code (`locationPuck.test.js`).
- The grey dot flashing at every lock because `resumedAt` is stale: `isGreyDot` ignores `reacquiring`
  while awaiting a resume (§F.1).
- A `NO_FIX` outcome becoming the remembered block and leaving the Precise notice stuck, or lost on a
  remount: `NO_FIX` is never stored (§C.3).
- A `Date.now()` inside a health-store selector looping `useSyncExternalStore`: time-window figures are
  derived during render (§E.1).
- Half-built GPS work, or another session's uncommitted phone edits, riding a publish or a build: GPS
  steps stay out of the shared folder until they ship (§N rule 1), `mobile/` must be clean before a phone
  publish (§N rule 2), and the app-store builds come from a separate copy (§J.10).
- A Heroku rollback silently restoring old config vars: Roll back only to the entry just below the bad
  deploy, and only when no config var changed after it; otherwise revert and redeploy (§N rule 4).
- Help for a phone feature going live before the feature: post-release Help commits, after the rollout
  reaches 100 % (§N rule 5).
- A phone with no accuracy estimate (an Android zero, including a mock-location app) blocked at every
  door, which would also hide it from the audit: a zero accuracy is stamped as unknown (§D.1).
- The shared report turning into a record of when a canvasser's phone was locked: the per-minute history
  and the restart ring never leave the screen (§G.2).
- An untested step riding another publish: nothing else goes to production during a step's staging
  window, and the released app must match the tested one (§N rule 3).
- An older `ota-check` silently ignoring `--build-ids` on the hotfix branch: the tool is cherry-picked
  there, and it now exits on any unknown flag (§J.10 steps 1 and 3).
- An unpatched tree publishing to patched binaries, or the reverse: the patch is a fingerprint input, so
  `ota:check` refuses; `--error-on-fail` stops a build that silently skipped the patch.
- The two rnmapbox spec copies drifting apart, so the prop reaches native code but not JS or the reverse:
  `locationPuck.test.js` checks both hunks.
- Publishing to the old fleet with the safety check switched off: `ota-check --build-ids`, never
  `OTA_ALLOW_MISMATCH` (§J.11).
- Builds started out of order, handing Play testers the production build: production pair first.

## Q. Effort

Rough sizes, for scheduling: §C medium; §D medium-large; §E medium; §F.1 medium; §F.2 large (native, plus
the build cycle); §G large; §H large; §I medium; §J large (mostly the build cycle's fixed toll).

## R. Open questions for the owner

1. The decisions in §A, especially D1 (grey dot), D2 (circle), D4-D8 (Location check), D14 (porch rule),
   D31 (the foreground-pause fix), D35 (timing against Election Day) and D36 (release rules for every
   session).
2. The wording for the iOS "precise once" prompt (§J.4), the permission strings including the pin-fix
   sentence (§J.6), and whether Try again asks for precise location once (§J.5).
3. Whether to also draw circles on the per-canvasser path maps (`admin/canvasser/[id]/map.jsx`,
   `day/[date].jsx`). Not designed; the same module would serve them.
4. Two pre-existing contrast failures found along the way, outside this plan: `FlagReasonBadges` and some
   `MapFilters` notes use `text-fg-subtle` (2.54:1), and `EntitlementBanner` hard-codes its tints.
   Separate sweep?
5. Is version 1.0.2 unused on the App Store (the native commit bumps `expo.version` to it)? And is an
   Expo SDK upgrade planned for the next native cycle (SDK 54 now gets critical fixes only)? If so, N1
   folds into it and the patch is regenerated against the rnmapbox version that upgrade installs.
6. Android's counterpart to D30: Try again on Android's Precise-off alert could re-request precise
   permission, which on Android 12+ offers the system's change-to-precise choice. Over the air; not
   designed here.
7. DPA §6 lists Google only for app distribution, while the Privacy Policy (`privacy.html:106`) also
   names Google's location services, and the amber notice recommends a Google setting. Should DPA §6's
   Google entry carry the policy's location-services clause? That edit is yours, not a side effect of
   code; this plan doesn't make the DPA newly false.
8. Drag pin corrections send a GPS fix that the server ignores (PRIVACY_VERIFICATION §C9(c)). Stop
   sending it? A small over-the-air change that sends less; the prompt copy could then say "…or a GPS pin
   fix". Not designed here.

## S. Review rounds

Each round: reviewers with different lenses read the whole plan and the code it names; in rounds 1-3 a
second reviewer per lens tried to refute every finding against the code before it counted (the later rows
say how theirs were checked).

| Round | Lenses | Findings | Confirmed | What it changed |
|---|---|---|---|---|
| 1 | mechanisms, consistency, pre-mortem, rulings and privacy (§J and §N excluded, still being written) | 55 (17 major) | 54 (one refuted) | the off-Earth refusal now waits for a count run first; Location check's cached-fix read moved from every 5 s to once per focus and into the privacy record; a wiring pin for the feed's writes; a still-phone rule before the grey dot ships; the iOS prompt copy matches the privacy record's safe wording; the admin circles carry a "guide, not a boundary" caption; the 820 ft cap and its notes got a mechanism; fixed Location check bands; the GPS_OFF alert opens Settings; a Help sentence in today's change that was false on iPhone; the count script now counts every path the clamp touches; Test a door tap's screen pins and privacy row; the 164 to 220 figure scoped to feed-health; the interim readout shown only when unsure and deleted in N1; a cascade row for the porch decision; item 27's §C10 stamps and the v3 watchlist line |
| 2 | native build cycle, release sequencing, the surfaces round 1's rewrites introduced, whole-document consistency and owner readability | 66 (1 blocker, 22 major) | 66 | every publish and build from a clean, committed tree, lanes built in separate worktrees (the blocker: a routine publish would have shipped half-built code); a timing decision against the 2026-11-03 election; the native commit merged only after its test builds pass, with an abort path; build-currency vars widened at the staging builds, not only after release; the legacy app's update note kept; Heroku rollbacks done by redeploy, since a rollback restores old config vars; Help committed only after its phone update is live; W1 kept off the phone and phone circle text tied to phone circles; the grey dot no longer flashing at lock; the Precise notice no longer stuck after a failed reading; a split still-phone rule and the screen readings it needs; the circle's colour lever needing a colour conversion; the hard-coded circle never a silent fallback; the forbidden prompt draft removed; the porch rule and the pause fix put in front of the owner; plain-language fixes in Part 1; M2 given M1's publish checks and its server change W1's; a check of what else is on `main` before every production publish and server deploy; the old fleet frozen at the commit it actually runs, with one long-lived hotfix branch |
| 3 | audit of round 2's fixes, the mechanisms they added, a second pre-mortem, fresh-eyes readability | 67 (21 major) | 67 | the release rules rewritten as one model, after round 2's version proved self-contradictory (commit-hash checks that couldn't hold when a lane lands as a new commit, a repo-wide dirty flag, rollout steps that named one of two per-platform update groups) and made repo-wide (D36); dated election checkpoints, so a staged rollout can't be left half-done at the freeze; the rollout watch given instruments that can see a blocked tap; the hotfix branch given the tool it needs; merge only after App Review; a zero Android accuracy recorded as unknown instead of blocking the door (it would have hidden mock-location taps from the audit); the shared report kept from becoming a record of when a canvasser's phone was locked; privacy stamps assigned to lanes, the permission-text mismatch recorded now in B0; a dot already grey staying grey through an unlock; the tick publishing the "lost" verdict on time; sign-out clearing everything a next user could read; Help committed only once a staged rollout is at 100 % on both platforms; W1 given a 2026-10-23 cutoff, a phone smoke test with an offline replay and a next-morning log watch, because a redeploy can't undo a knock it refused from an offline queue; a lane kept on its branch until its production publish follows at once, with an overlap-aware landing procedure; the interim readout's condition tied to the gap between M2 and N1, both after the election |
| 4 | solo: an end-to-end walkthrough of the release as the owner would run it, plus spot checks of round 3's mechanisms and readability (run while the independent reviewers' usage limit was exhausted) | 11 (3 major) | 11 | today's docs separated from the count script, which isn't written yet (B0 now, W0 later); the landing rule given the case of work already sitting in the shared folder; N1's merge given a fallback when the shared folder has overlapping edits; the count's fleet check compared with a window before M1, not after; a zero accuracy kept off the fast path; a stale rule number; Part 1's list fixed so the open-questions line doesn't render inside item 18 |
| 5 | four independent reviewers: an end-to-end walkthrough of every release step as the owner would run it, an audit of rounds 3 and 4's fixes, round 3's mechanisms against the code, and fresh-eyes readability. Their second reviewers ran out of session, so the plan's author re-checked every finding against the plan and the code instead | 69 (1 blocker and 17 major as filed; 47 distinct, the blocker found by all four) | 69 | the blocker: round 4's own B0/W0 split had landed in the privacy table, so the release table still put the unwritten count script in B0 and had no W0; W1's off-Earth refusal frozen as its own commit, so the night's count can leave it out; M2s given W1's full gates, smoke test and log watch included, and a fleet check that can be met after the election; the staging rule made repo-wide; M1 no longer waits on W1 (the phone's admin labels ride M1 only if W1 is already out); the landing procedure given a dry run, an undo, its commit step and a three-dot diff; B0 made the named exception to the landing and deploy checks, which now run before the push and cover the Procfile and lockfile; item 27's confirmation put in every lane that adds to it, W1 first; the app-store submits ordered so no store serves the new build until both have approved it; the old fleet's build ids recorded before new builds bury them; hotfix cherry-picks made on the branch itself; the web circles given their own view handler, since the fetch handler never sees a zoom-in; the advisory's return kept bare, with a sticky "a fused fix exists"; rules for the "always" dismissal, kept across sign-out; a dot grey at lock for either reason staying grey; the door-tap sentence on the gate's own predicate; the count's `--since` given a time zone; dates pinned (W0 by about 10-08, "after the election" meaning from 11-05) and the owner's own D28 date put in Part 1; the overlapping placeholder-pins plan named |
| 6 | three independent reviewers on round 5's changes only: a walkthrough of every release step with scratch git repos and the installed eas-cli, the new mechanisms against the code with simulations, and consistency plus coverage of round 5's 69 findings. The plan's author re-checked every finding against the plan and the code, reproducing the two git findings and reading the eas-cli source for the third | 24 (4 major, 20 minor) and 5 notes | 24 | a `git revert` refuses whenever another session has any edit in a file the lane touched, so rollbacks now use a reverse patch; a reverted lane lands again by reverting the revert, because a rebase silently drops a commit already on `main`; the abort path's second emergency publish now actually carries the fix; Location check's settings row would have read Unknown on every Android phone (the status reader lacked the location-on flag); sign-out no longer erases that Later was used, so Don't remind me reaches phones signed out every shift, and one module owns the stored dismissal; the No GPS alert names Google Location Accuracy only after a live read; every eas command runs from `mobile/`, and `update:list` names its branch; the deploy check reads local `main` and stops on anything unexpected after the push, and B0 is pushed; the release-rules commit lands before D28's publish, and the old-fleet publishing docs reach `main` before new builds exist; silent checks print PASS or STOP; gates run in the lane's own worktree; strict `--since` parsing; item 17 as a dated list, and Part 1 names each step's privacy confirmation |
| 7 | the release section rewritten around the owner's own routine (`git add -A`, commit, push, then deploy or publish), then two independent reviewers on the rewrite only, under a rule that they run no git write; the plan's author re-checked every finding, reading the eas-cli source for the Commit line's dirty marker and the republish flag, and confirming the macOS temp cleaner on this Mac | 19 (6 major, 13 minor) | 19 | a step already on `main` after a missed 10-20 checkpoint now comes out that day; a step's commit holds that step alone, with checks for files other sessions also edit, because every rollback reverts it; Heroku's Roll back only to the entry just below the bad deploy; what to do when git stops with CONFLICT (abort, never commit or stash) or refuses; held steps saved under `~/Desktop`, since macOS empties `/tmp`; the old fleet published only from the hotfix copy from the freeze on; the trailing `*` on eas's Commit line; a fetch before each cherry-pick; a merge reverted with `-m 1`; leftover wording from the branch design |
