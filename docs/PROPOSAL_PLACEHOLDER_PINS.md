# Proposal: Homes on a vendor placeholder pin — place them by address, and stop calling them buildings

> **Status: PLAN, revision 7, 2026-10-05. Review complete. Release 1 — the cut the owner chose for the Nye
> campaign — was BUILT 2026-10-05 (see [PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md),
> "F. As built"); everything this plan lists beyond that release is not built.** It answers a
> report on the Nye County, Nevada L2 file (`NCDC(Data)(NyeCounty)(AllExtended)(2026-10-01)(RepsPahrumpDistricts3-5).csv`):
> different homes that share one latitude/longitude, such as 5001 and 5011 E Monte Penne Way in Pahrump,
> are drawn and treated as one apartment building. **That is confirmed** (Part 1, "Is it true?").
>
> How it was made:
> - Eight read-only maps of every subsystem the fix touches came first.
> - Every voter-file number was measured by running the importer's own parser and the server's
>   placeholder code over the real files: Nye, the FL-22 i360 walk universe and Tyler, TX.
> - The plan then went through adversarial review rounds. A skeptic re-checked every finding against the code.
>   - **Round 1:** 101 findings, 4 of them blockers. No finding was refuted, and revision 2 rewrote the core.
>   - **Round 2:** 44 findings: no blockers, 16 major, 28 minor. Again none was refuted, and revision 3 fixed
>     all of them.
>   - **Round 3:** 38 findings: no blockers, 6 major, 32 minor. None was refuted, and revision 4 fixed all of
>     them.
>   - **Round 4:** 31 findings, about 24 once duplicates merge: no blockers, 2 distinct majors, the rest minor.
>     None was refuted, and revision 5 fixed all of them.
>   - **Round 5:** 33 findings: no blockers, 6 major, 27 minor. None was refuted, and revision 6 fixed all of
>     them. One of them found that an earlier measurement had read a 166,738-row file as empty; every number
>     here is re-measured with that file read properly.
>   - **Round 6, the last round:** 29 findings: no blockers, 4 major, 25 minor. None was refuted, and this
>     revision fixes all of them. Its evidence fixes were checked by replaying every round-6 failure history,
>     and revision 6's own cases, through the new rules with the real classifier (49 of 49 as intended), and on
>     every building spot of the four located files (no wrong flag or freeze left).
>
> **The review is complete.** The owner agreed that round 6 would be the last review round. §U records what
> each round caught.
>
> **What is being built first:** [PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md)
> (2026-10-05). The owner chose to start fresh with the Nye campaign and leave existing campaigns for later, so
> release 1 builds the import-time lookup, Pin Fixes and Remove apartments parts of this plan; release 2 adds the
> map and phone screens. Everything else here (the backfill, the freeze, piles, the repair script, street-level
> estimates, the GPS audit change, the follow-up job) is later work, and this document stays its reference.

What this covers: what is going wrong and how big it is, what changes for whom, the decisions that are yours,
how it ships, and — in Part 2 — the data model, the one module that owns each mechanism, every file that
changes, the GPS audit rules this touches, the backfill for existing campaigns, the privacy record, the docs
and Help Center cascade, the tests and the release order.

Related: [IMPORTS.md](IMPORTS.md) (the importer, the placeholder warning, the repair script),
[MAPS.md](MAPS.md) (building grouping, Pin Fixes, Move pin), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(Remove apartments, book outlines), [AUDIT.md](AUDIT.md) (the Far and One spot rules),
[WALK_PACKETS.md](WALK_PACKETS.md) (Skip apartments), [CANVASSER_APP.md](CANVASSER_APP.md),
[OPERATIONS.md](OPERATIONS.md) (console scripts), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
(the Geocodio claims this changes), [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md) (unbuilt; edits the
same audit code — see §L).

---

# Part 1 — For everyone

## The problem in one paragraph

Voter-file vendors give every home a map coordinate. When a vendor cannot place a home, it does not leave
the coordinate blank: it stamps the middle of the home's ZIP+4 block (or ZIP code) instead, so every
unplaceable home on that block gets the **identical** coordinate. Doorline already keeps each address as
its own door, so nothing is merged in the database. But every map, and several tools, decide "these doors
are one apartment building" purely because they share an exact map spot. So ten separate houses on
E Monte Penne Way — 5001, 5011, 5016 … 5096, spread along the street — show up as one "10-unit
building", and everything that trusts "same spot means same building" gets them wrong.

## Is it true? Yes. What the files show

**Nye County.** All figures come through the importer's own parser.

- **The file:** 8,529 homes on 7,605 distinct map spots.
- **Shared spots:** 122 spots hold more than one street address, with 484 homes on them. Every map draws
  each of them as an apartment building.
- **The detector already warns, then gets ignored.** Doorline has had a detector for this since August,
  and it warns in the import preview. After the warning, though, the homes are saved on the shared spot and
  drawn as a building anyway.
  - On this file it flags 140 spots and 694 homes.
- **19 of those spots are mobile-home parks.** They hold 213 homes, written like "1801 Crawford Way
  Spc 205". The address reader knows "Apt", "Unit", "Lot" and "Trlr" but not "Spc", so it reads each space
  as a different address.
  - With the reader fixed (§D), **121 spots holding 481 homes are genuine vendor placeholders**.
  - One more home sits on a building's spot with a different address. This plan calls that a "stray".
- **Monte Penne specifically:** 27 homes, 26 of them on shared spots.
  - 4906–4987 (13 homes), 5001–5096 (10) and 5101–5106 (2) sit on three spots about 280 to 850 feet apart.
  - 4993 sits on a spot 1.8 miles away, shared with homes from other streets.
  - Only 4896 has a coordinate of its own.
- **The spots are ZIP+4 centroids.** All ten homes at 5001–5096 are ZIP+4 89061-1001, and 4906–4987 are
  89061-1000. Most placeholder spots hold exactly one ZIP+4.

**It is not just Nye.**
- **FL-22** (the i360 walk universe, 8,278 homes): 139 placeholder spots holding 560 homes, plus 23 strays.
- **FL-22's master target file** (106,958 homes): 1,050 placeholder spots holding 10,889 homes, plus 483
  strays.
- **Tyler, TX** (49,021 homes): 374 placeholder spots holding 965 homes, plus 9 strays.

## What it costs today

- **The map:** a building glyph reading "10 units". On the phone it opens a "building" screen whose one
  Directions button goes to the first unit's address.
- **Remove apartments (Turf Cutting).** At the default of 4 or more units per spot, it would hold out
  **710 homes in 61 stacks** on the Nye file.
  - **269 of those are separate houses** on placeholder spots, never cut into books, sent to phones or
    printed.
  - FL-22: 166. FL-22's master file: 4,960. Tyler: 202.
- **The GPS audit gets it wrong both ways.**
  - An honest canvasser who walks to the real house is measured against the shared spot. In a sample of 12
    placeholder homes whose true position could be estimated from placed neighbours, a knock at the door
    would read **Far** (medium or high) in 8.
  - A cheater parked at the spot can record every home in the stack with no flag at all.
- **Books.** Turf cutting treats a stack as one point, so a street's homes can split between crews.
- **Fixing it by hand is a trap.**
  - Pin Fixes never lists these homes. It lists only addresses the geocoder placed approximately.
  - On the phone, "Fix pin location → Whole building" moves all the houses on that spot (10, for
    5011 E Monte Penne Way) to one new spot and marks each one hand-corrected. That hides them from every
    later check.
- **The only real repair** is an operator script, `npm run repair:import-pins`, that nobody runs by default.

## What changes, by who notices it

### When you import a file (leads and admins)

- **The preview warns with the corrected count.**
  - With address lookup switched on: "481 homes share a map spot with other addresses. Doorline will look
    each one up by its address."
  - With lookup switched off: "Doorline marks them, and they're listed in Pin Fixes."
- **A new stage** appears while it works: **Checking map pins**.
- **When the import finishes**, the summary adds one line about **this file's homes**. For example:
  "Map pins: 380 placed by address · 12 confirmed at their spot · 41 still without an exact spot (in Pin
  Fixes)". Homes from earlier files are counted on the Pin Fixes badge, not here.
- **Two imports into one campaign at once:** the second marks its homes right away. With address lookup on,
  it places them by address as soon as the first finishes its check, and its summary says "placing by address
  shortly" until then.
  - **Undoing that second import stops it placing.** If it hasn't started, it never does. If it is already
    looking homes up, it stops before its next batch of lookups and moves no further pin; at most the batch
    already sent to the address service finishes.
- **Never:**
  - A home is never dropped. A home the lookup can't place keeps the file's coordinate and is marked.
  - The lookup never moves a pin your team moved by hand or confirmed.
- **Street-level estimates come later.** At first, only exact (rooftop) answers place a home. Estimates
  along the street ("placed approximately") are switched on after a calibration run (D2).

### On the web maps

- **A spot holding different homes no longer looks like an apartment building.**
  - It gets its own marker labelled "N homes". It is not the building glyph and not a numbered bubble.
  - Its panel says these homes share one map spot, lists each full address, and gives each its own
    **Move pin**.
- **A home left alone on such a spot** after its neighbours were placed or fixed gets the amber ring and a
  "No exact map spot" badge.
- **Homes Doorline moved by address** say "Placed by address".
- **A home whose address lookup lands on the very spot it already had** says "The address lookup confirms
  this spot", when no other address's building or confirmed home shares that spot. It wasn't moved, so it
  isn't counted as placed.
- **A home that shares its spot with another address's building, or with a home a lead confirmed,** keeps "No
  exact map spot" even when the lookup agrees, because two addresses can't both be on one point. Looks right is
  the way out.
- **One street address with many units** (an apartment building or a park) looks exactly as before.
- **Several different street addresses on one spot** are shown as separate addresses and looked up, even
  when they are real buildings (two towers sharing one geocode). Each then gets its own pin.
- **Clicking two overlapping houses** still opens a small "pick one" list, as today.

### Pin Fixes

- **Every home without an exact spot is listed.** Separate homes are never folded into one row. Units of one
  street address on the same spot share a row ("4 units at 100 Main St"), because they are one building.
- **Move pin moves that home, or that address's units together.** On a home without an exact spot, Save
  stays off until you drag the pin clearly off the spot. If nothing moved, the page says so and stays on
  the row.
- **"Looks right — the home is here"** confirms the home really is at that spot.
  - It asks once first, because the home's coordinate was shared with other addresses.
  - The home then shows "Location confirmed". Neither an import nor the address lookup will flag or move it
    again, unless a later re-import is run with "Overwrite hand edits", which clears the confirmation, as it
    does today.
  - **What a confirm switches back on:** knocks at that home are judged by their distance to that spot again,
    at full Far. Use it only when the home really is there.
  - **The Enter key** still confirms an approximate pin from the import's own geocoding, as today. On a home
    without an exact spot, or one the address lookup placed only approximately, it does nothing.
  - **A home the lookup placed only approximately:** confirming it with the button, or saving its pin without
    moving it, makes later knocks there count at full Far against that estimate.
- **The sidebar count** reads "N pins to fix".

### Turf Cutting

- **Remove apartments takes real apartments.** That means two kinds of door:
  - doors at a street address that has N or more units on its spot;
  - any door whose address names a unit (Apt, Unit, Spc, #…) on a spot holding N or more doors.

  A separate house is never taken because of the shared spot; a home whose address names a unit can be. The
  preview numbers (homes and spots) now match what the button does, which today they don't always.
- **Re-including houses held out by mistake.** If Remove apartments already held out houses that aren't
  apartments, a line lists them: "N of them are separate houses on a shared map spot — **Re-include
  those**". You see the addresses before you click.
  - The line also shows on rounds whose books are already published, which is where most of these houses
    are today.
  - Re-included houses then appear under "N doors not in any book · Add as new book" on that round. On a
    targeted follow-up round they appear only if they match its target (a "Not home" follow-up won't match
    houses nobody knocked); the confirmation says how many matched, and the rest are cut into the next
    untargeted round.
  - That line now counts the same doors the button adds, including homes restricted in another live round,
    which on a later round it didn't.
- **The pop-up for a spot of separate homes** lists each home with Move pin, "Mark restricted…" and
  "Move to book…". Units of one street address are grouped, with "Move these N units". It has no "Move
  building pin".

### On the phone (after the app update)

- **Canvassers.**
  - The marker reads "N homes".
  - Tapping it lists the homes sorted by street and house number. Each row has the status, the one-tap
    actions and its own **Directions**, which always go to the address and never to the pin.
  - The door screen says "No exact map spot — use Directions".
  - In the list view these homes show no distance, which would be measured to a shared spot. Under
    "Nearest" they sit in their own "No exact map spot" section. A real building keeps its distance, even if
    one odd address sits on its spot.
- **Leads.**
  - "Fix pin location" on one of these homes moves that home. Only when other units of the same street
    address share the spot does it ask "Just this unit" or "Whole building", and "Whole building" moves only
    those units.
  - Save stays off until you drag the pin clearly off the spot, or tap "Use my current location" while
    standing at the house. If your location is that same spot, Save stays off and the app points you to
    Looks right instead. On every other door, Fix pin works exactly as today.
  - If the server reports that nothing moved, the app says so.
  - The admin map's Move pin gets the same check: saving one of these homes without moving the map says
    "Nothing moved" instead of closing. There too, units of one street address can be moved together: Move
    pin on a unit asks "Just this unit" or "Whole building (N units)". N counts every unit of that address on
    the spot, not only the ones the map's date filter shows, and after a whole-building move the bar says how
    many moved. The web Map page asks the same way.
  - Older app versions that still ask "Whole building" are quietly limited by the server to units at the
    same street address.

### GPS audit

- **Far.**
  - A knock measured against a shared spot no longer reads Far (medium or high). It shows as **low**, with
    the reason "this knock was measured against a map spot shared with other addresses, so the distance
    can't be relied on".
  - The same applies while a home sits at a street-level estimate that nobody has checked yet (D3b), with
    its own reason. A lead confirming that pin, or saving it without moving it, ends this for later knocks.
  - The verdict is recorded on the knock itself, so nothing that happens later can change it back.
- **One spot.** Those same knocks no longer count toward the "the houses are spread out" test. This can only
  remove flags, never add one, and later pin fixes can't create a One spot flag on them.
  - The cost: someone recording these homes from one parked spot gets low on Far and no One spot flag. Only
    Rapid can still catch them (D3).
  - A second, smaller cost: homes are marked before any lookup, so the one home that really is at a shared
    spot is marked too. Its knocks from before it was placed read low on Far, from any distance, for good.
- **Reviews.** A flag you reviewed before its pin was recognised as a shared spot says so on the review
  panel.

## What stays the same

- **One street address with many units** (apartment buildings, parks) groups as before, and Remove
  apartments still takes it.
- **Printed packets: "Skip apartments"** skips a home only because its address names a unit (Apt, Unit,
  Spc, Rear, #…), never because it shares a map spot.
  - It now also recognises "Spc", PH, Rear, Frnt, Uppr, Lowr, Bsmt, Lbby, Ofc, Dept, Hngr, a spaced "# 4",
    a marina "Slip 12", a unit with two ids ("Apt 5 B") and a unit written before the house number ("#5 412
    Elm St") as units (D5). Units glued with a hyphen or slash ("Apt-B", "Ste/5") were already skipped, and
    still are.
  - Across the eleven voter files we could read, it misses one unit line today's check catches: a unit word
    followed by a street word ("… 9th Apt St").
- **No clustering, no spreading, no invented positions.** A home without an exact spot stays on the file's
  coordinate and is marked as such.
- **No home is ever dropped.**
- **Hand-moved and confirmed pins are never moved by an address lookup.** "Overwrite hand edits" on a
  re-import still lets the file win, as it does today.
- **Book membership and walk order don't change** when a pin moves. On a campaign whose books are already
  cut, the round's book outlines are redrawn. The books themselves change only when you re-cut.
- **The share link.**
  - Its code is unchanged: it shows each reached door, and a stack as a status tally.
  - Reports published or republished after placement show placed homes at their own spots.
  - Snapshots already published don't change.

## Decisions for you

| # | Question | Recommendation |
|---|---|---|
| D1 | Should imports automatically look up their own homes on shared spots by address, buying the ones Doorline hasn't seen? | **Yes**, whenever address lookup is switched on (`GEOCODE_ENABLED=true`). **Scope:** only the file's own homes; older homes wait for D8. **Cost:** roughly $1 per 1,000 homes (internal estimate), about $0.50 for Nye. **Ceiling:** 25,000 homes looked up per import, counted once per home across retries; anything over it is reported. **Failures:** if the address service fails partway, that run places nothing and only marks homes. |
| D2 | When the lookup can only place a home "street-level" (estimated along the street), use it? | **Yes, for placeholder homes only, after calibration.** It ships switched off. A calibration run on Nye (How it ships, step 4) compares the estimates with where canvassers' phones actually were at those doors, and sets the distance ceiling. Then it is switched on. These homes show "Approximate location" and appear in Pin Fixes. Strays get rooftop answers only. |
| D3 | A knock measured against a shared spot: downgrade Far to low, and leave it out of One spot? | **Yes.** This is a deliberate exception to "approximate pins never forgive a Far". A shared spot isn't approximate: it is provably *not* the house for all but one of its homes. The flag stays visible as low, with its reason. **The cost:** someone recording these homes from one parked spot gets low on Far and no One spot flag, before or after the pins are placed. Only Rapid can catch them. **And:** marking runs before any lookup, so the one home really at a shared spot is marked like the rest. Its knocks from before placement read low on Far, from any distance, permanently. The same happens when a refresh renumbers a home or re-spells it in a way the address reader can't fold ("County Road 5" to "CR 5"): its old record counts as a different address on the spot, and the knocks recorded on that old record are forgiven too. These are misses, never false flags. |
| D3b | The same while a home sits at an unchecked street-level estimate? | **Yes, until a lead confirms or moves that pin.** It is the same downgrade with its own reason, and the same cost. Without it, a placement on the wrong end of a long rural lot would turn a knock that read low into Far high. **Note:** confirming that pin with Looks right, or saving it without moving it, ends the downgrade for later knocks, which then count at full Far against the estimate. **Decided (2026-10-05): the Enter shortcut does nothing on these rows**, so a confirm always takes the explicit click. An open question asks whether to extend the downgrade to every other unchecked street-level pin (§T). |
| D4 | Remove apartments by street address, and a button to re-include houses it wrongly held out? | **Yes.** On the measured files the new rule loses 2 real-building units, both marina slips named with a word rather than a number (D5). Re-including is always a button with the addresses shown, never automatic. It also works on rounds that are already published. On a targeted follow-up round, re-included houses join that round only if they match its target; the button says how many did. |
| D5 | Unit designators in packets and apartment tests | **Yes:** "Spc" everywhere; PH, Rear, Frnt, Uppr, Lowr, Bsmt, Lbby, Ofc, Dept, Hngr and "# 4". "Side", "Sp", "Space" and "Slip" count only when a unit id follows them ("Slip 12"), and never when that would leave only a house number ("100 Slip 5"). FL-22's master file has two marinas, 24 slips, written "Slip 12". "Pier" and "Stop" are **not** units, because those words are often the street itself ("100 Pier A"). A slip named with a word ("Slip ABC") is a known limit: 2 doors in that file. |
| D6 | What do canvassers see? | **The "N homes" marker and list, with per-home Directions**, as above. |
| D7 | Can a lead mark an unplaced home "Looks right" in Pin Fixes? | **Yes.** It is the escape hatch when the spot really is the home. The vouch stays on record and shows as "Location confirmed". **What it switches back on:** later knocks there are judged at full Far against that spot, and the lookup never places the home. So the button asks once, saying the home's coordinate was shared with other addresses, and the Enter shortcut never vouches for one of these homes. |
| D8 | Existing campaigns: when do the backfill steps run? | **Marking** runs free for every campaign right after the deploy: it flags these homes and freezes the verdict on their past knocks. It **moves no pin**. **Placement** runs per campaign or organization, when you choose, with `--geocode`. Answers Doorline already has are free; new ones are bought. Active campaigns first. |
| D9 | Stacks already piled onto one spot by a past "Whole building" fix-pin: mark them? | **Yes.** They are different houses moved together by mistake. Marking them gives them rows in Pin Fixes and the Far downgrade, for knocks made both before and after the pile move. A real two-address building moved this way is marked too; a lead clears it with Looks right. |

## How it ships

0. **Before anything**, in the Heroku dashboard → Settings → Config Vars:
   - Read `GEOCODE_ENABLED`. D1 depends on it. With it on, imports place rooftop answers from deploy day.
   - **Confirm the privacy record** (§O): the new stamps on "EXCEPTION 2" and DPA §4.
1. **Server deploy (web included), outside field hours.**
   - Everything in it is additive.
   - Help Center copy ships with this deploy, except copy about the new phone screens, which waits for
     step 7.
2. **Heroku dashboard → More → Run console:** `npm run migrate:build-indexes -- --apply`. This is a gate:
   there is one new index, and production builds indexes by hand.
3. **Run console:** `npm run pins:check`, a dry run across every campaign. Then `npm run pins:check -- --apply`.
   - It marks every unplaced home and freezes the verdict on their past knocks. It moves no pin and costs
     nothing.
   - Run it right after step 2, before field hours.
4. **Calibrate street-level estimates (D2).**
   - Run `npm run pins:check -- --campaign=<a Nye campaign id> --geocode`. It buys and saves answers but
     moves nothing.
   - For each home it prints the answer type, the distance from the shared spot, the distance to where
     canvassers' phones were when they knocked there, and the distance to the position its placed neighbours
     on the same street suggest. It also prints how many of those knocks would read Far against the estimate.
   - From that, set `PIN_PLACEMENT_MAX_INTERP_M` (Heroku dashboard → Settings → Config Vars). Until it is set,
     street-level answers are refused.
5. **For each campaign (or organization) you choose:** first `npm run pins:check -- --campaign=<id>`, a dry
   run that prints what it would place and the price. Then `npm run pins:check -- --campaign=<id> --geocode --apply`.
6. **A test campaign for the device checks** in an internal organization (§Q). Then, on your computer, in
   `mobile/`:
   1. `npm run ota:staging`, which checks the build fingerprint itself;
   2. the device checks;
   3. `npm run ota:production` from `main`.

   There is no new app-store build and no client-version bump. Staging builds talk to the production
   server, so steps 1–5 come first.
7. **A second server deploy** carrying the phone-screen Help copy, once the production update is out.

## Screens (behavior and wording the design must carry)

The copy below never says *who* put a home on a shared spot. The same marks also cover the geocoder's own
collapses on files without coordinates, so "the voter file did this" would be false for those.

1. **Import preview.** This is today's amber block; it currently says "other streets", and that becomes
   "other addresses".
   - Title: "N homes share a map spot with other addresses".
   - Body, lookup on: "These homes were all given the same coordinate, so they can't each be on the map.
     After import, Doorline looks each one up by its address. Any it can't place keep that spot and are
     listed in Pin Fixes."
   - Body, lookup off: "…Doorline marks them, and they're listed in Pin Fixes."
   - Strays, only when there are any: "N homes sit on an apartment building's or park's spot but have a
     different address."
2. **Import progress and summary.**
   - Stage label: "Checking map pins".
   - Summary line, about this file's homes only: "Map pins: N placed by address · N placed approximately ·
     N confirmed at their spot · N without an exact spot (Pin Fixes)". Parts that are zero are left out.
   - While another pin check in the same campaign holds the lookup back: "… · placing by address shortly".
     The line updates when that finishes.
   - If the check didn't finish, the line reads "Map pins weren't checked this time".
3. **Web map, spot of separate homes.**
   - Marker: the new "homes" glyph, captioned "N homes" (a real building keeps "N doors"), in the same three
     roll-up colours.
   - Panel title: "N homes at one map spot".
   - Panel note: "These are different homes that share one map spot. Move each pin to its house, or mark it
     Looks right in Pin Fixes if it really is here."
   - Rows: the full address, status, and Move pin. Units of one street address sit together under that
     address.
   - **Move pin on a unit whose address has other units on the spot** asks "Just this unit" or "Whole building
     (N units)". N comes from the server and counts every unit of that address on the spot in the campaign,
     because the Map page's date filter (Today by default) shows only the doors knocked in that window. After a
     whole-building move the toast reads "Moved N units", from the server's count.
   - When the panel was opened by clicking overlapping houses, the note instead reads "N doors near here —
     pick one", and after picking one the Back bar reads "Back to all N doors near here".
4. **Web map, a home without an exact spot, and placed homes.**
   - **Lone home:** the amber ring; the badge "No exact map spot"; the panel line "This home has no exact map
     spot; its coordinate was shared with other addresses." (Present tense, "share", is used only on the
     grouped panel, where it is true.)
   - **Placed homes**, while the lookup's pin is still in place: "Placed by address (date). Its earlier spot
     was shared with N other homes." When the record holds no count (the spot's other homes had already
     left), it reads "…Its earlier spot was shared with other addresses."
   - **Homes the lookup found on their own spot:** "The address lookup confirms this spot (date)."
   - **Confirmed homes:** "Location confirmed", including a confirmed home on a shared spot.
5. **Pin Fixes.** One row per home: the address and "No exact map spot". Units of one street address on one
   spot share a row: "N units at <address>".
   - Buttons: Move pin and "Looks right — the home is here".
     - Move pin's Save stays off until the pin is dragged more than 1.5 m (about 5 ft) off the spot.
     - If the server reports nothing moved: "Nothing moved — drag the pin onto the house". The card stays
       open and the page doesn't advance.
     - Looks right asks once: "This home's map spot was shared with other addresses. Confirm the home is
       really here?"
     - If the pin changed after the page loaded: "This pin changed since the page loaded — reloading." The
       list reloads.
   - **Keyboard:** Enter does nothing on these rows, nor on rows the lookup placed only approximately, and
     their footer hint drops "Enter confirm". Arrow keys work as today.
   - Clicking the spot on the map selects its first home in house-number order.
   - Sidebar tooltip: "N pins to fix".
   - Intro: "These homes need a pin check. Some were placed from the street address; others have no exact
     map spot, because their coordinate was shared with other addresses. Several at one spot show as one 'N
     homes' marker; one on its own in this list has an amber ring."
   - The empty state also mentions shared spots.
6. **Turf Cutting.**
   - **Pop-up for a spot of separate homes:** "N homes at one map spot" and the same note.
     - Rows have Move pin, "Mark restricted…" (or Unmark) and "Move to book…".
     - Units of one street address are grouped under it, with "Move these N units".
     - The spot also has "Move all to book…" and "Mark all N restricted…". It has no "Move building pin".
   - **A real building's pop-up:** "Move building pin" moves only units at that street address, and its copy
     names that count.
   - **Remove apartments preview:** "Holds out N homes on N spots (4+ units at one address, or a unit address
     on a spot of 4+)", plus "· M of them are in this cut" (M follows the page's target and exclusion
     settings).
   - **When exclusions exist,** on any round, published or not:
     - "N of them are separate houses on a shared map spot · Re-include those", showing the addresses before
       you click;
     - after the click on a targeted round: "N re-included · M match this round's target and are listed
       under 'not in any book'; the rest are cut into the next untargeted round";
     - plus today's "N homes excluded · Re-include" line, which stays pre-publish only;
     - when every door in the walk list is held out, the empty-round banner says the doors are held out as
       apartments.
   - **"N doors not in any book":** its note changes from "Voters added since this pass was cut" to "Doors
     in this round's walk list that no book holds: voters added since the cut, or homes you re-included.
     Add them as new book(s) without recutting, then Accept and assign as usual."
7. **Phone, canvasser.**
   - Marker label: "N homes · N done".
   - **The homes screen:**
     - Header: "N homes — no exact map spot".
     - Note: "These homes share one spot on the map. Use each home's Directions."
     - Rows: sorted by street, then house number; each has the address, a status pill, the quick actions
       and Directions.
   - Door screen card: "No exact map spot — use Directions."
   - List view: no distance on these homes. A spot of separate homes is one row titled "N homes at one map
     spot", reading "N homes · M done". The Address sort files it under its lowest house number on its
     street (for example with "4906 E Monte Penne Way"), among the other numbered homes. Under "Nearest"
     these rows get a "No exact map spot" section after the sorted homes. A real building with one odd address
     keeps its distance.
8. **Phone, lead.**
   - **Fix pin location on an unplaced home:**
     - It asks "Just this unit" or "Whole building" only when other units of the same street address share
       the spot. Otherwise it asks nothing.
     - The pin and the map open at the lead's current location (or at the spot if there is no fix yet).
     - Save stays off until the pin is dragged more than 1.5 m off the spot, or "Use my current location" is
       tapped somewhere more than 1.5 m from it.
     - Note: "Drag the pin to the house, or tap Use my current location while standing at it."
     - If the current location is the spot itself: "You're at this home's map spot. If the home really is
       here, mark it Looks right in Pin Fixes."
     - If the server answers that nothing moved: "Nothing moved — the pin is still on its old spot."
   - **On every other door** Fix pin opens on the door's pin, and Save works without a drag, as today.
   - **On a real building** it still asks "Just this unit" or "Whole building", with the button order fixed
     on Android. Today Cancel sits in the emphasised slot.
   - **Admin map:** tapping a stack of homes opens a chooser of its homes, with units of one street address
     grouped under their address. Move pin on a unit whose address has other units on the spot asks "Just this
     unit" or "Whole building (N units)", with N from the server, as on the web Map page; after a whole-building
     move the bar shows "Moved N units" before it closes. Move pin on an unplaced home won't save while the
     crosshair is still on the spot: "Nothing moved — drag the map so the crosshair sits on the house."
9. **Audit (web and phone flag detail).**
   - Far on a shared spot: "Low — this knock was measured against a map spot shared with other addresses, so
     the distance can't be relied on."
   - Far on a street-level estimate: "Low — this home's pin is a street-level estimate nobody has checked
     yet, so the distance doesn't count."
   - On the panel and the ping panels, the distance reads "N ft from the shared spot", or "N ft from a
     street-level estimate", never "from house — far".
   - The tiles count these as "forgiven".

---

# Part 2 — Technical reference

## A. Decisions

| # | Question | Recommendation | Alternatives considered |
|---|---|---|---|
| D1 | Paid lookups at import | Only when `GEOCODE_ENABLED==='true'` and a key is set, and only for candidates at this file's addresses. Capped at `PIN_PLACEMENT_MAX_HOMES` (default 25,000) **distinct** homes per import, tracked in a probed-id set that survives retries. A failed provider batch makes the run mark-only. | Campaign-wide spend at import: breaks D8. Cache-only placement: makes the outcome depend on the cache (§O). |
| D2 | Which answers may move a door | Placeholder: `rooftop` or `point`. `range_interpolation` only once `PIN_PLACEMENT_MAX_INTERP_M` is set, within it, and not an outlier against the street's placed pins. Stray: `rooftop` or `point` only. Never `nearest_rooftop_match` or `street_center`. | Rooftop-only forever: leaves more homes on the dot. Interpolation from day one: uncalibrated. |
| D3 | Far and One spot on knocks measured against a shared spot | Far downgrades to `low`, read from the frozen row stamp `knockPin: 'shared'`. The door is left out of One spot's spread. | A live derivation from household fields: flips back when later writes erase them (the round-1 blockers). |
| D3b | Far and One spot against an unchecked street-level placement | `knockPin: 'estimated'`, with the same treatment until the pin is confirmed or moved. A confirm, or a save that leaves the pin where it was, ends it for later knocks; that is disclosed in D3b and Part 1. Enter never confirms one (the owner's decision). | Full Far against an estimate. Enter-to-confirm on these rows: one keystroke per row would end the downgrade for a whole list. |
| D4 | Remove apartments | `apartmentStacks.js`: (spot, `stackBaseOf`) groups of N+, plus unit-addressed doors on N+ spots. Re-include only doors whose address names no unit and has no other door anywhere in the campaign, from a button that works on published rounds too, and reports how many of the lifted houses this round's target takes. | Spot-only (today): takes houses. (Spot, base) only: loses unit-addressed buildings whose lines don't normalize. |
| D5 | Unit designators | `UNIT_SUFFIX` += `spc`, for packets' street bands. `isUnitAddress` (packets' Skip apartments, apartment tests) is true exactly when line 2 is set, line 1 has a `#` unit, or `stackBaseOf`'s own strip step removed something. Both share one strip helper. | Extending `UNIT_SUFFIX` with every USPS word: chops street names. A separate unit regex: drifts from the key (round 3 found eight such divergences). |
| D6 | Phone presentation | Group kind `unplaced`: a homes list with per-row Directions. | No phone change. |
| D7 | Confirm on unplaced homes | Allowed, from an explicit click that asks once; never from Enter. `locationConfirmedAt` is the vouch; `pinSuspect` is kept under it. "Location confirmed" outranks "Pin corrected" in the badge chain, so a confirmed pile reads as confirmed. | Hidden: false positives sit in the queue forever. Enter-to-confirm: one keystroke per row would vouch a whole shared spot. |
| D8 | Backfill | Free marking and freezing everywhere. Placement only in scoped `--geocode` runs. | Free cache-only placement: a per-address cache signal, and pins moved in live campaigns without a choice. |
| D9 | Past "Whole building" piles | Marked by the pass, and knocks from before the pile move are frozen too (§E steps 1b and 8). | Leave them: they stay invisible to every check. |

## B. One owner per mechanism

| Mechanism | Owner | Callers |
|---|---|---|
| Building key (~1.1 m) | [`utils/buildingKey.js`](../server/src/utils/buildingKey.js) | The pass, `apartmentStacks.js` (replacing the inline copy at `routes/admin/turfs.js:728`), the import's `coordKeyOf` (`csvImporter.js:187`, replaced), the pin writers. Web and mobile copies stay mirrors under the drift test (§P). |
| Same-street-address key | `stackBaseOf` in [`utils/streetName.js`](../server/src/utils/streetName.js) (new) | The classifier, the `pinTrust` collapse gate, `apartmentStacks.js`, the move and confirm fan-outs, Pin Fixes rows and `buildingMovePrimary` (web mirror), the unplaced panels' per-address groups (web mirror), the phone's `siblingCount` (mobile mirror). |
| Unit-address test | `isUnitAddress` in `utils/streetName.js` (new; server only). It and `stackBaseOf` share one internal strip helper, `stripUnits`, so they cannot disagree. | `apartmentStacks.js`; packets' Skip apartments (`buildPacket.js:71-73` becomes a call). |
| Street words | `STREET_WORDS` + `canonStreetTokens` exported from [`utils/normalizeAddress.js`](../server/src/utils/normalizeAddress.js) | `looseAddressKey` (the geocode cache key) and `stackBaseOf`, so they cannot drift apart on the server. The client and mobile copies are pinned by the drift test (§P). |
| Stack verdict | [`utils/stackedPins.js`](../server/src/utils/stackedPins.js) `classifyStackedPins` (rule unchanged) | Import preview counts, the pass. **The web's inline mirror in `DoorStackPanel.jsx:28-42` is deleted.** |
| Answer gates | `services/households/pinTrust.js` (new; pure). Two policies: `stackPolicy` (the pass) and `repairPolicy` (the repair script's exact current rules) | The pass; the repair script. |
| Placement (classify, mark, look up, gate, write, freeze) | `services/households/placeStackedPins.js` (new) | The import job; `pins:check`; the repair script's post-revert re-mark. |
| One placing pass per campaign at a time | The lease `Campaign.pinPass`: taken, renewed, re-checked and released only inside `placeStackedPins`, on its own timer | The passes that may place: imports with lookups allowed, the pins-only follow-up job, and `pins:check --geocode --apply`. Marking passes (lookups-off imports, the unscoped backfill, the repair script's post-revert pass) never take it or wait for it (§C). |
| The follow-up job's queue calls | `services/households/pinFollowUpQueue.js` (new): `enqueue`, `promoteOrRecreate` and `remove` for `pins-<importJobId>`, each bounded by the repo's `queueOp` timeout and never throwing | The busy pass, the lease holder's `finally`, the undo route, the nightly import sweep. Tests inject a fake with the same three calls (§P). |
| One home on a key | `homeKeyOf(h)` in `utils/streetName.js` (new; server only), built on the same `stripUnits` | The pass's member count (one member per home, §E step 1), the import preview's counts (§F), the twin rule. |
| A claim to a point | `isPointClaim(answer, door)` in `pinTrust.js`: `rooftop` or `point`, matched ZIP5 equal to the address ZIP5, in state | `stackPolicy`'s collapse set (§E step 6); the repair script's collapse pool (§M). |
| The freeze's proof and write | `freezeRows({ householdId, spot, from, to })`, exported from `placeStackedPins.js` | The pass's step 8; the repair script's revert loop, for its collapse reverts (§M). |
| Reading the cache without touching it | `peekCache(households)` in `geocodeService.js` (new): `resolve()`'s own cache-read step, factored out, with no `lastUsedAt` touch | The repair script's peek; `pins:check`'s dry run (§E step 11). |
| One address's units on a spot | `sameAddressDoors({ campaignId, location, addressLine1 })`, extracted from `updateHouseholdLocation`'s building fan-out | The move fan-out; the confirm fan-out; the `sameAddress` count on the door activity route (§G). |
| "Unplaced now" | `isPinUnplaced(h)` = `pinSuspect && !locationConfirmedAt`; `effectivePinSuspect(h)` for payloads; `isEstimatedPlacement(h)` for D3b | Knock-time stamp, every payload (including the bootstrap and `/mobile/changes` loops, §K), `UNPLACED_PIN`. |
| "Doors no book of this round holds" | `supplementalDoorFilter({ campaign, pass, bookedIds })`, extracted from `addSupplementalBooks` (`services/turf/generateTurf.js:340-381`). Its exclusion slices come from the existing `restrictedDoorIdsForEffort` (`:85-104`), the set the job's `cutExclusionFilter` drops. | `addSupplementalBooks`; the "N doors not in any book" counts in `GET …/turfs`; the round count `include-non-apartments` reports (§H). |
| Human / repair pin moves | [`services/households/updateHouseholdLocation.js`](../server/src/services/households/updateHouseholdLocation.js) | Web PATCH, mobile POST, repair `--apply`. |
| Apartment groups and re-include | `services/turf/apartmentStacks.js` (new) | `POST …/exclude-apartments`, `GET …/apartment-preview`, `POST …/include-non-apartments`, `pins:check`. |
| Pin Fixes queue | `NEEDS_PIN_FIX` + new `UNPLACED_PIN` + `listPinsToFix` / `countPinsToFix`, in [`services/households/confirmHouseholdLocation.js`](../server/src/services/households/confirmHouseholdLocation.js) | The Pin Fixes list; the `pinsToFix` rollup ([`services/reports/campaignSummaries.js`](../server/src/services/reports/campaignSummaries.js)). |
| Far rule | [`services/audit/flagDetection.js`](../server/src/services/audit/flagDetection.js) `farAssessment`, plus the new `FAR_ROW_FIELDS` constant for every row projection | `computeReasons`, `farKpiForRows`. |
| Web stack panel | `stackDoors({ stackKey, stackIds, … })` (new, pure) | `MapPage.jsx`. |
| Phone list entries | `buildListEntries` in `mobile/lib/` (new, pure) | `map.jsx`'s list view. |

## C. Data model

### Household

These fields go after the pin fields at [`models/Household.js`](../server/src/models/Household.js):35-55.

**`pinSuspect: { type: String, enum: ['placeholder', 'stray'] }`**
- **No default.** Mongoose writes schema defaults into bulk upsert inserts (`castBulkWrite.js:137-146`).
- **Meaning.** The door's current coordinate was judged to be a home on a shared spot (`placeholder`), or a
  different address on a building's spot (`stray`). Nothing has positively cleared it since.
- **It is sticky.**
  - Only a writer that moves the door off the spot clears it (§G).
  - The pass also clears it, but only on positive evidence (§E step 3).
  - A shrinking stack is never evidence: a deactivated door keeps counting toward its spot exactly as it did
    while it was active, and a home that left keeps its place there as a departure (§E step 1). The one shrink
    that can clear is an import undo, which deletes that import's doors, so the spot reads as it did before the
    import.
- **A confirm keeps it.** "Unplaced now" is `isPinUnplaced(h)` = `pinSuspect && !locationConfirmedAt`.
  Every payload carries `effectivePinSuspect(h)` in the `pinSuspect` field (the routes overwrite the raw
  value before sending, §J and §K), so an Undo of the confirm restores the door exactly.
- **Corrected doors** get it only through the pile rule (§E step 1b, D9).

**`pinPlacement`: the record of the latest time this door left a judged spot.**
- **Declared as** a nested sub-schema (`_id: false`) with `{ type: PinPlacementSchema, default: undefined }`,
  and `from` / `to` as `{ type: [Number], default: undefined }`.
  - A plain nested path would give every document `from: []`; this was verified with the repo's mongoose.
- **Presence** is always tested on `pinPlacement.at`.
- **Fields:**
  - `from` and `to`: [lng, lat];
  - `at`;
  - `kind`;
  - `by`: `'lookup'`, `'person'` or `'file'`;
  - `accuracyType`: lookup only;
  - `stackSize`: the classifier's member count on the spot at that moment, minus the door's own home: present,
    emptied and departed homes alike (§E step 1), the same set that made it a shared spot. It can be 0 for a
    door flagged earlier whose spot-mates have all left; the copy then names no number (Screens 4);
  - `releasedAt`: the time the door last left `to` for another pin without a person moving it. That is a
    later file coordinate replacing the placed or corrected pin (§F), or the collapse gate reverting a
    placement (§E step 6). The freeze uses it in its arrival rule (§E step 8).
- **Written by:**
  - the pass, when it places a door (`by: 'lookup'`), and `releasedAt` when it reverts one;
  - `updateHouseholdLocation`, when a person moves a door that carries `pinSuspect` (`by: 'person'`);
  - `applyImport`, when the file gives a flagged door a different coordinate (`by: 'file'`, released at
    once), and `releasedAt` alone when the file replaces the pin of any other door that carries
    `pinPlacement.at`.
- **It is never `$unset`.**
- **"Currently placed by the lookup"** means `by === 'lookup' && !releasedAt && coordSource === 'geocodio'`.
  - Every later location writer changes `coordSource`: to `'corrected'` by hand, or to `'file'` on a vendor
    change.
  - A re-import that merely echoes the placed point leaves the door untouched (§F, first test).
- **"Placed in place"** means currently placed by the lookup with `from` and `to` on one building key: the
  lookup found the home on the spot it already had. It reads "The address lookup confirms this spot", is
  counted apart from placed homes, and the freeze never proves its rows against `from` (§E step 8).

**`pinDistrustedKeys: [String]`** (`default: undefined`; `$addToSet` only; never unset)
- These are building keys the gate has distrusted for this door. A later answer landing on one of them is
  refused (§E step 6).

**Index:** `{ campaignId: 1, pinSuspect: 1 }` with `partialFilterExpression: { pinSuspect: { $type: 'string' } }`.
- Its key pattern is distinct from the existing `{ campaignId: 1, locationConfirmedAt: 1 }` partial index,
  because `buildIndexes.js:49-50` dedupes by key pattern alone.
- Deploy gate: `npm run migrate:build-indexes -- --apply`. Production `autoIndex` is off.

### CanvassActivity

**`knockPin: { type: String, enum: ['shared', 'estimated'] }`**
- No default. Never written as anything else. Never unset.
- **`shared`:** the distance on this row was measured against a shared spot (placeholder or stray). It is
  written in one of two ways:
  - at knock time, when `isPinUnplaced(h)` holds for the household loaded at receipt;
  - later, by the pass's **freeze** (§E step 8), from an exact distance match.
- **`estimated`:** measured against a lookup's street-level placement that no person had checked
  (`isEstimatedPlacement(h)`, below). Written at knock time only.

`isEstimatedPlacement(h)` is all of:
- currently placed by the lookup;
- `pinPlacement.accuracyType === 'range_interpolation'`;
- `!locationConfirmedAt`.

**Stamp sites.** Both knock routes already load the full household (`canvass.js:316`, `:735`):
- `routes/mobile/canvass.js:348` is stored at `:425`;
- `:772` is stored on the CanvassActivity at `:917`.

**`knockPinAt: Date`**
- The **server's** receipt time at knock time, or the freeze time.
- It is never the phone's tap time: the review cue compares it with a server time (§L).

**SurveyResponse is not stamped.** The Far rule reads CanvassActivity only (`flagDetection.js:8-16`). The
survey response drawers keep "N ft from the house" for such answers, a known cosmetic limit (§T).

### Campaign

**`pinPass: { owner: String, heartbeatAt: Date }`** (`default: undefined`): the lease that lets one placing
pass run per campaign at a time (§E, "One pass at a time"). Everything below happens inside `placeStackedPins`,
so every caller gets it.
- **Only a pass that may place takes it:** an import with lookups allowed, `pins:check --geocode --apply`, and
  the follow-up job. A pass that can only mark (lookups off, the unscoped backfill, the repair script's
  post-revert pass) places and reverts nothing, so it neither takes nor waits for the lease. Its marks are
  conditional writes, and its freeze re-reads each batch's doors just before it stamps and judges them as they
  are then, not as it loaded them (§E step 8), so it is safe beside a placing pass.
- **`owner`** is a random token made per pass run, never a job id. A BullMQ redelivery of a stalled job is a
  new run with a new token, so it can't "already own" the lease of a run that is still alive.
- **Taken** with one conditional `findOneAndUpdate` on the campaign's `_id`: it matches when there is no
  lease, or when the lease is stale (`heartbeatAt` more than 90 s old, three missed beats).
- **Renewed** by the pass's own 30 s `setInterval` (with `unref`), started as soon as the lease is taken:
  `updateOne({ _id, 'pinPass.owner': owner }, { $set: { 'pinPass.heartbeatAt': now } })`. This is
  `deleteCampaignProcessor.js:69-77`'s pattern. A renewal that matches nothing sets `lost`.
- **Re-checked** before step 4 and before every step-7 batch with the same owner filter. A pass that has lost
  the lease skips its placements and reverts, still runs the freeze and the tally (they move no pin), and
  records "busy". A follow-up job that can't take the lease, or loses it, instead throws a retryable error,
  so BullMQ runs it again in 60 s (§E, "One pass at a time").
- **Released** in `finally` by an `updateOne` filtered on the owner, after the interval is cleared.
- **A dry run reads the lease to report "busy" and never writes it.**
- Every lease write uses `timestamps: false`, so it never moves the campaign's `updatedAt`.
- It holds no personal data.

### ImportJob

The schema is strict, so every new field is declared.

| Group | Fields | How written |
|---|---|---|
| Preview (file-scoped) | `placeholderPins`, `placeholderPinDoors` (placeholder only), and new `strayPinDoors` | as today |
| Outcome for this file's homes | `pinStackHomes`, `pinsPlacedExact`, `pinsPlacedApprox`, `pinsConfirmedInPlace`, `pinsStillUnplaced` | `$set` at the end, from state (§E step 10). A follow-up job `$set`s them again: every home of `pinPendingIds` is re-read from state, and homes the busy tally had already counted as placed keep that count (§E, "One pass at a time"). It never `$inc`s, so a re-run can't count twice. |
| Follow-up | `pinPendingIds` | taken at the busy pass's tally, from the same cursor as its counts: this file's homes still without an exact spot at that moment, at most `PIN_PLACEMENT_MAX_HOMES` ids. The follow-up job's scope. |
|  | `pinFollowUp: { status, at, baseline }` | `status` is `'queued'`, `'done'`, `'failed'` (the follow-up ran but its lookup degraded or threw; `pinPassCause` keeps why), `'gave_up'` (it never got the lease, or BullMQ gave up on it; the worker's failed listener writes this) or `'cancelled'` (the import was undone). `at` is the busy tally's time. `baseline` holds the busy tally's counts. It drives the summary's "placing by address shortly", and it is visible to organizations. A busy pass writes it only when no follow-up is already queued for the import (§E). |
| Spend | `pinLookupsNew` | `$inc` after each provider chunk |
|  | `pinLookupsCached`, `pinLookupsOverCap` | final `$set` (an `$inc` would double-count cache hits on a retry) |
| Ceiling | `pinProbedIds` | `$addToSet` per chunk; the ceiling's ledger, so a retry never charges the same home twice |
| Other | `keptPlacements` | `$max`, beside `keptPins` / `keptConfirmed` |
|  | `pinPassError` | short and generic, the only failure text organizations see: "Map pins weren't checked this time" |
|  | `pinPassCause` (`String`, default `null`) | the full cause, for the super-admin page only: a provider cause from the fixed mapping in §E step 5 ("HTTP 401", "timeout", "network: ENOTFOUND", "bad response (not JSON)", or the error's name), "busy: another pin check is running in this campaign", or a thrown non-provider message. Never a provider error's message, which embeds up to 200 characters of the response body, and never the request URL, which carries the API key. Never written to `lastError`, which organizations can read. |

**Hidden from organization users** through one `ORG_HIDDEN_IMPORT_FIELDS` object (§F): `pinProbedIds`,
`pinPendingIds`, `pinLookupsNew`, `pinLookupsCached`, `pinLookupsOverCap` and `pinPassCause`.

## D. The address key and the stack verdict

**`UNIT_SUFFIX` gains `spc`** (`utils/streetName.js:9` and its client mirror).
- `streetOf` / `baseAddressOf`, and so packets' street bands, read "Spc 205" as a unit.
- **The repair script is a third consumer.** Its signal-2 cohorts key on `streetOf(line1)|ZIP5`
  (`repairImportPins.js:183-199`), and its collapse gate and self-revert build base sets with `baseAddressOf`
  (`:371-396`, `:545-553`). So "Spc" now behaves like "Lot" there, matching the script's own design for park
  lots (`:366-368`). On Nye, 133 of the 186 "Spc" homes join a testable street cohort, and park spaces that
  share one answer stop reading as "N different addresses" (§M).
- Nothing else is added to that regex. It strips a designator plus any one token, so "side", "pier" or
  "stop" there would chop "Lake Side Dr", "Pier Ave" and "Stop Rd".

**New `stackBaseOf(line1)`** is the one "same street address" key. The reference implementation is
checked in with the tests as the spec, and this prose is written from it. Steps:

1. **Clean up.**
   - Upper-case.
   - A with-id designator (step 3's list) joined to its id by `#`, `-`, `/` or a dot loses the joiner: "Apt
     #5", "Apt#5", "Apt-B", "Suite-200", "Ste/5" and "Apt.-5" all read like "Apt 5", so step 3 strips them.
     Every such joiner on the line is rewritten (the reference's regex carries the `g` flag), so "Bldg-3 Apt-B"
     loses both designators, as today's packet test treats it.
   - Drop any other `#…` tail, spaced or glued (`St # 4`, `St#4`), when something comes before the `#`. A line
     that starts with `#` ("#5 412 Elm St") keeps its text, as today's code does.
   - Turn every character outside `A–Z`, `0–9`, `/`, `½`, `-` and the space into a space, then collapse
     whitespace. That includes accented letters: "Peña" reads "PE A". The key is only compared within one
     spot, so this matters only if one address is spelled both with and without the accent on one spot.
2. **Hyphen house-number letter.**
   - `12-A` and `12 - A` become `12A`. Only a single letter counts, so Queens-style `123-45` is untouched.
   - A bare `12 A` is never folded, because "12 A St" is a street.
3. **Strip unit tails, one at a time, until nothing changes.** Every strip must leave at least two words,
   so a line that is only a house number plus a designator-like word ("1234 RM 2222", "100 Lot Rd") is a
   street.
   - **A designator that always carries an id** (`APT APARTMENT UNIT STE SUITE BLDG BUILDING LOT TRLR TRAILER
     RM ROOM FL FLOOR SPC DEPT HNGR`), then any one token of letters, digits, `/` or `-` (`5`, `PH2`,
     `B2-104`, `UPPER`, `9/9`), then optionally one more unit id ("Apt 5 B").
     - A street-type word is never an id, so "100 Forest Floor Dr" and "100 Lake Lot Dr" keep their street.
       Directionals can be ids ("Apt N").
     - The one exception: when what precedes the designator already ends in a street-type word and has at
       least three words, a street-type id is accepted ("… NW 5th Ln Apt Pt", "… Mill Way Fl Way"). Three
       such lines are in FL-22's master file.
   - **The same designators bare at the end** ("… St Apt"), when the remainder ends like a street or with a
     standalone word ("… St Rear Apt", which then loses "Rear" too). `FL` or `FLOOR` after an ordinal is
     stripped together with it when what precedes ends like a street ("… St 2nd Floor").
   - **Glued digit forms:** `APT`, `UNIT`, `STE`, `SPC`, `LOT` or `BLDG` followed directly by digits and an
     optional letter (`APT5`, `UNIT3B`). A glued letter never counts, so "100 Unity" and "100 Cedar Fls" are
     untouched. (A hyphen, slash or dot after any designator is handled in step 1.)
   - **How this differs from today's `UNIT_SUFFIX`,** which takes a designator plus an empty or any
     non-space token: here the id follows a space or one of step 1's joiners, it is letters, digits, `/` or
     `-`, it is never a street-type word (but for the exception above), and at least two words must remain.
     Across the eleven readable files on disk, exactly one unit line today's code catches is missed (Known
     limits).
   - **`SIDE`, `SP`, `SPACE` and `SLIP`,** only when a unit id follows. `SLIP` joined this list in revision 6:
     FL-22's master file has two marinas, 24 slips, written "Slip 12". Its two-word rule keeps "100 Slip 5"
     a street, and "Pier" and "Stop" stay off the list.
   - **A standalone designator** (`PH PENTHOUSE UPPR UPPER LOWR LOWER REAR FRNT FRONT BSMT BASEMENT LBBY LOBBY
     OFC OFFICE`):
     - followed by a unit id, it is stripped ("100 Broadway PH 2");
     - bare at the end, only when the remainder ends like a street: a number, or a word on the street-ending
       list below. That leaves "200 Ocean Front", "100 Front" and "5B Lake Front" intact.
   - **A unit id**, where a rule above asks for one, is digit-led (`5`, `5B`, `12-3`), letter-plus-digits
     (`B12`, `K25`, `B-2`), or a single letter.
   - **The street-ending list** is every `STREET_WORDS` key and value (the directionals included), plus
     `WAY LOOP PATH ROW RUN PIKE ALY ALLEY CV COVE XING CROSSING BND BEND TRCE TRACE WALK PLZ PLAZA EXPY
     EXPRESSWAY FWY FREEWAY TPKE TURNPIKE`.
     - The extra words are road types only. Natural-feature words (Lake, Bay, River, Park) stay off,
       because "Lake Front" is a street name.
     - `STREET_WORDS` itself is not widened, because it is also the geocode cache key's table.
     - The same list without the directionals is the set of street-type words never accepted as an id.
4. **Fold a glued house-number suffix:** `123A`, `123 1/2` and `123½` all become `123`.
5. **Map each token through `STREET_WORDS`.**

**One strip helper.** `stripUnits(line1)` runs steps 1–3 and returns `{ s, stripped, unit }`, where
`stripped` means step 3 removed something and `unit` is the text it removed, followed by any `#…` tail step 1
dropped. `stackBaseOf` finishes steps 4–5 on `s`, and `isUnitAddress` reads `stripped`. Neither fold counts as
a strip, so "123A Ocean Front" is neither a unit nor a different address from "123 Ocean Front".

**New `homeKeyOf(h)`: one home, whatever its records say.** The pass counts homes, not door records (§E step
1), because a refresh can leave one home with two records on one spot: a re-spelled address ("St" to
"Street"), or a unit moved between line 1 and line 2, inserts a new door and empties the old one
(`importProcessor.js:382-394`). `homeKeyOf(h)` is `stackBaseOf(line1)`, a `|`, and the home's unit, read as runs
of letters or digits joined by `-`:
- the unit is the house number's glued suffix that step 4 folds (`123A`, `123 1/2`), then `stripUnits`'
  `unit`, then line 2;
- the with-id and guarded designator words are dropped, so "Apt 5", "Unit 5", "# 5", "Apt-5" and line 2
  "Apt 5" are all `5`, and "Bldg 1-101" and "Bldg 1 Apt 101" are both `1-101`;
- standalone words are kept, because "100 Main St Rear" is a different home from "100 Main St";
- so Apt A and Apt B, 12-A and 12-B, 123 and 123 1/2, and "Lot 1-23" and "Lot 12-3" stay different homes.

It is server-only, like `isUnitAddress`, and shares `stripUnits`, so a home never spans two street addresses.
The reference passes 25 pairs: 14 that must read as one home and 11 that must read as two.

**New `isUnitAddress(h)`** is true exactly when:
- line 2 has any non-space text;
- line 1 contains `#` followed by a letter or digit (spaced or not); or
- `stripUnits(line1).stripped`.

Two notes on the arms:
- **Why the `#` arm matters:** the four coordinate-less files on disk that use `#` all write it spaced
  ("# 4"), which today's packet test misses.
- **Why line 2 matters:** every unit in the Tyler file is in "Address Line 2": 8,912 homes (Apt 7,103,
  Trlr 874, Unit 570, Lot 255…). Skip apartments catches them only through this arm.

**Probe table.** The reference passes 130 `stackBaseOf` cases and 55 `isUnitAddress` cases. Revision 3's 46
and 16 are among them; one changed on purpose in revision 6: `100 Harbor Dr Slip 12` is now a unit. Round 2's
other probes keep their answers: `12-A` / `12-B Oak Ct` are one address; `123-45 Main St` and `12 A St` are
untouched; `100 W Side`, `100 Cedar Fls`, `100 Unity`, `100 Front` and `100 Pier Ave` keep their streets. New
in revisions 4 to 7:

| Probe | Intended answer |
|---|---|
| `… Apt Upper`, `Apt PH2`, `Unit AB12`, `Unit 9/9`, `Lot AB`, `Apt 104AB`, `Apt B2-104`, `Unit 104-1-A`, `Apt 12C1`, `Apt N` | a unit, stripped, as in today's code |
| `1234 RM 2222`, `100 Lot Rd` | a street, not a unit |
| `100 Forest Floor Dr`, `100 Elbow Room Rd`, `100 Lake Lot Dr Apt 5` | the street kept; only `Apt 5` is a unit |
| one probe per with-id word and per glued form; `123½ Main St`; `100 Main St., Apt. 5` | a unit, stripped |
| `123A Ocean Front`, `12-A Ocean Front`, `123 1/2 Ocean Front`, `123½ Ocean Front`, `5B Lake Front`, `100A Front`, `5B Lower`, `5B Penthouse` | not a unit; only the house number folds |
| `123A Main St Rear`, `100 Cedar Loop Rear` | a unit |
| `100 Broadway PH 2` | `100 BROADWAY`, a unit |
| `200 Ocean Front 5` | `200 OCEAN` (a known limit, below) |
| `123 Calle Peña Apt 5` | `123 CALLE PE A` (the character class) |
| line 1 `100 Main St` with line 2 `Apt 4`; with line 2 only spaces | a unit; not a unit |
| `Apt #5`, `Apt#5`, `Apt # 5`, `Unit #3`, `Ste #200`, `Lot #12`, `Spc #205` | a unit, stripped, as today |
| a bare trailing `Apt`; `Apt-5`; `Rear Apt`; `2nd Floor`; `3rd Fl` | a unit, stripped |
| `100 Ocean Front Apt` | `100 OCEAN FRONT`, a unit |
| `100 Parking Lot`, `100 County Lot`, `100 Lot` | a street, not a unit |
| `Apt-B`, `Unit-A`, `Bldg-C`, `Lot-A12`, `Suite-200`, `Trlr-5`, `Rm-5`, `Fl-2`, `Apartment-5`, `Apt-12-3`, `Apt-12-B`, `Apt/5`, `Ste/5`, `Apt.-5` | a unit, stripped, as today |
| `1234 NW 5th Ln Apt Pt`, `1234 NW 5th Ct Apt Ct`, `1234 Old Mill Way Fl Way` | a unit (the street-type id exception) |
| `1234 SW 9th Apt St` | not a unit (a known limit, below) |
| `#5 412 Elm St` | the line kept as written, as today; a unit by the `#` rule, which is new (today's packet test needs a space before the `#`) |
| `100 Main St Bldg-3 Apt-B`, `100 Main St Bldg-C Unit-A` | `100 MAIN STREET`, a unit (every joiner is rewritten; revision 7) |
| `200 Harbor Dr Slip 12` | `200 HARBOR DRIVE`, a unit |
| `100 Slip 5`, `100 Truck Stop Rd`, `100 Pier A` | a street, not a unit |

**Re-measured, on every file on disk.** There are twelve. The importer refuses one (Shaheen D66: over its
300,000-row limit), so the eleven it reads are measured, through its own parser, with coordinate-less rows kept
for the count and no network: 267,065 homes.
- **One file was silently missing until round 5.** FL-22's master target file (166,738 rows, 106,958 homes)
  names its voter-id column `CSP_ID`, which the importer's auto-mapping doesn't recognise, so every row failed
  as missing a required field and earlier scripts counted 0 homes from it. It is now mapped by hand, as the
  import screen would require. Every measuring script now stops with an error when a file yields 0 homes or a
  required field is unmapped.
- **Nye and Tyler:** every published number is unchanged.
- **FL-22 i360:** the two homes written "… Dr Slip N" are now units of one marina address, so its placeholder
  count goes from 140 spots / 562 homes to 139 / 560. Nothing else changes.
- **Revision 7 re-measured every file again.** The `g` flag moves no number (no line on disk has two joined
  designators). Counting one member per home (§E step 1) moves only FL-22's master file: two of its spots each
  held one home written two ways ("Unit A" and "Apt A"; "Lot 12A" and "Lot 12 A"), and counted per record that
  duplicate made a 2-unit address and a 4-lot park look like the majority. Counted per home they are
  placeholders: 1,048 → 1,050 spots, 10,875 → 10,889 homes, strays 489 → 483. Nye, FL-22 i360 and Tyler are
  unchanged. The import preview counts the same way (§F).
- **Today's unit check vs the new one,** across all eleven files: today's catches 37,883 unit lines; the new check
  misses 1 of them (the "9th Apt St" shape below). It adds 427: "Spc" 190 (Nye's parks, D5), PH 78, a spaced
  "#" 76, a designator with two ids ("Apt 5 B") 31, "Slip" plus an id 26, Frnt/Lowr/Rear plus an id 19, and
  Dept/Hngr/Side 7. Every one is a real unit.
- **Revision 3's regression stays fixed:** it missed 39 unit lines on these files, which would have split 18
  real buildings.

**Known limits.**
- **A unit word followed by a street word, after a street that doesn't end in one** ("1234 SW 9th Apt St"):
  the street-type guard keeps "Apt St" in the key, so it is neither a unit nor the same address as "1234 SW
  9th St". One line in FL-22's master file.
- **A slip named with a word** ("Slip ABC"): not a unit, because a guarded word needs a unit id. Two doors in
  FL-22's master file, at two marinas: Remove apartments releases them and Re-include lists them as separate
  houses.
- **A street whose name ends in a standalone word, written with a bare unit number** ("200 Ocean Front 5"):
  keys without that word. Its units still group with each other; a door written with no unit number would
  read as a stray and be looked up like any other stray.
- **A ranch road written with a directional first** ("1234 N RM 620"): still reads as a room, as it does in
  today's `UNIT_SUFFIX`.
- **A unit written before the house number** ("#5 412 Elm St"): keys apart from the building's other units,
  as today.
- The last three shapes occur in none of the eleven files (checked line by line with the exact rules).

**Mirrors and the drift test.**
- **Mirrors:** `client/src/lib/streetName.js` gains `stackBaseOf` with `stripUnits`, and a new
  `mobile/lib/streetName.js` carries both.
- **The test:** `server/test/streetNameDrift.test.js` imports the server, web and mobile copies (the
  `metricHelp.test.js:12-14` pattern). It checks:
  - `deepEqual` on the three `STREET_WORDS` tables and on step 3's word lists;
  - the source of every regex `stripUnits` uses;
  - every tier's output on the 130-case table, plus one probe per `STREET_WORDS` abbreviation.
- **The 55 `isUnitAddress` cases and the 25 `homeKeyOf` pairs run on the server tier only,** because those two
  exist only there.

**The verdict.** `classifyStackedPins` is unchanged:
- one street address holding an outright majority (> 50%) is a building, and any others are strays;
- no majority is a placeholder.

**Homes, not doors** (§E step 1). The classifier is given one member per home on a key (`homeKeyOf`), whatever
form the home's records take there: an active door, an emptied (inactive) door, or a departure (the `from` a
door left behind when it was moved off the spot).
- A home with an active door, or only emptied doors, votes for its street address, so emptying a door never
  changes a verdict.
- A departed home never votes: it is passed with a street token unique to it, so it counts toward the stack's
  size and distinct addresses only.
- A departure also proves its street address wrong on that key. Example: if 5001 was placed and a later file
  adds "5001 E Monte Penne Way Apt B" on the old spot, that unit must not make the spot "5001's building".

**Two towers that split one geocode 50/50** are a placeholder. Each is looked up and gets its own rooftop.
Remove apartments still takes both.

**Measured** with the reference key, today → new:

| File | Placeholder spots / homes | Strays | Same-street-address homes wrongly suspected (judged independently, by house number and street) |
|---|---|---|---|
| Nye | 140 / 694 → 121 / 481 | 3 → 1 | 220 → 5 |
| FL-22 i360 | 142 / 567 → 139 / 560 | 28 → 23 | 103 → 91* |
| FL-22 master file | 1,072 / 11,009 → 1,050 / 10,889 | 520 → 483 | 4,563 → 4,406* |
| Tyler, TX | 374 / 965 → 374 / 965 | 9 → 9 | 51 → 51* |

\* These are units of one street address that the vendor put on one point together with other addresses.
Grouped by the new key:
- **Tyler:** 11 addresses, 51 homes. The largest is a 23-unit address on a 64-door spot that holds 31
  addresses.
- **FL-22 i360:** 43 addresses, 91 homes, 2 to 4 units each.
- **FL-22 master file:** 1,278 addresses, 4,353 homes, from 2 to 37 units each. Florida condo complexes often
  share one point across several buildings. That is the largest group of these the plan has measured, and the
  reason a whole address's units move, and are confirmed, together (§G).
- **Nye:** 2 addresses, 5 homes.

Looking each address up gives every building its own rooftop, which is an improvement, so they are
deliberately left as suspects. Until the lookup places them, a lead moves each address's units together
(§G).

## E. The placement pass — `services/households/placeStackedPins.js`

```
placeStackedPins({ campaignId, mode, allowPaid, paidScope, paidScopeIds, tallyIds, job, dryRun, overrides, heartbeat, onChunk, geocodeBatch, followUpQueue })
```

- **`mode: 'import'`.** Lookups only when `allowPaid`, and only for candidates in `paidScope` (this file's
  `normalizedAddress` set), or in `paidScopeIds` for the follow-up job below.
- **`overrides`** (dry run only) replaces loaded doors' location and `coordSource`, for the repair script's
  preview of its own reverts (§M).
- **`mode: 'check'`** is `pins:check`. It looks up only with `--geocode`, and then only in a scoped run.
- **There is no cache-only placement anywhere.** An outcome therefore never depends on which addresses
  happened to be in the cache, apart from the provider-failure case recorded in §O.

**One pass at a time per campaign.** Two passes can otherwise overlap: `IMPORT_JOB_CONCURRENCY` defaults to 2
(`worker.js:21`), the upload route has no per-campaign guard (`routes/admin/imports.js:206-249`), and
`pins:check` can run beside an import. Each pass gates answers against its own load, so two overlapping passes
could each accept a different address onto one key, and nothing would re-gate them.
- **The lease:** `Campaign.pinPass` (§C), taken before step 1, renewed on the pass's own timer, re-checked
  before step 4 and before every step-7 batch, and released in `finally`. **Only a pass that may place takes
  it** (§C). The marking backfill, lookups-off imports and the repair script's post-revert pass never wait for
  it, so the deploy-day backfill can't make a single import busy.
- **An import that may place but can't take the lease never waits in its worker slot.** One import queue, at
  concurrency 2, serves every organization's imports, previews and geocode checks, and a job left pending for
  2 minutes is expired as failed on the next poll (`sweepStaleImports.js:24`, `routes/admin/imports.js:470-475`).
  - It runs steps 1–4, 8 and 10 at once: marks, the freeze and the tally. They move no pin, so they can't
    break the collapse rule.
  - **At that tally** it stores `pinPendingIds` (this file's homes still without an exact spot at that moment)
    and `pinFollowUp = { status: 'queued', at: now, baseline: <the tally's counts> }`, and records "busy" in
    `pinPassCause`. The ids and the baseline come from one cursor over `tallyIds`, so a placement landing
    between two reads can't be counted twice or not at all. `pinPassError` stays empty while a follow-up is
    queued. If `pinPendingIds` is empty there is nothing to place, and no follow-up is queued.
    - **That write is conditional:** it matches only when `pinFollowUp.status` is not already `'queued'`. A
      redelivered import job that goes busy against its own running follow-up therefore leaves the queued
      follow-up's `at`, baseline and ids alone; rewriting `at` would make the running follow-up's final write
      match nothing and leave the line "queued" for good.
  - **It enqueues a pins-only follow-up job** on the import queue, through `pinFollowUpQueue.enqueue` (§B):
    name `pins-followup`, data `{ followUpOf: importJobId }`, jobId `pins-<importJobId>`, with
    `removeOnComplete: true` and `removeOnFail: true`. It enqueues even when a follow-up was already queued:
    BullMQ ignores an add whose jobId exists, and when the old job is gone the add recreates it, so a
    `'queued'` status always has a job behind it after a busy run.
    - The removal options matter: the queue's defaults keep finished jobs for 7 to 30 days
      (`queues/index.js:36-41`), and an add whose jobId still exists would otherwise queue nothing.
    - The data key matters too: today's processor reads `importJobId`, so after a rollback the old worker
      finds no import, throws before writing anything, and the finished import stays finished (§Q, rollback).
    - It first runs after 60 s and is retried every 60 s while the lease is held, up to 30 times. The lease
      holder's `finally` calls `pinFollowUpQueue.promoteOrRecreate` for each of its campaign's `ImportJob`s with
      `pinFollowUp.status: 'queued'`: a delayed job is promoted; a missing one (a rolled-back worker failed it,
      or Redis lost it) is added again. So the follow-up usually runs as soon as the lease frees, and an
      orphaned `'queued'` line is picked up by the next placing pass in its campaign.
    - **Every queue call is bounded.** The shared Redis client retries forever (`maxRetriesPerRequest: null`,
      `queues/connection.js:16-22`), so each of the three calls runs under the repo's `queueOp` timeout
      (`routes/admin/turfs.js:59-66`). A timeout, a "locked" job, or BullMQ's `JobNotInState` from `promote()`
      on a job that is no longer delayed counts as "not done", and nothing throws out of the lease `finally`.
      The follow-up's own checks below, its 60 s retries, the next placing pass and the nightly sweep (§F) are
      the backstop.
  - **What the follow-up does.** `processImportJob` routes it by name before its status re-claim
    (`importProcessor.js:78-88`), so the finished import stays done, and it applies the import's campaign and
    organization deletion guards. It exits at once, setting `'cancelled'`, if the import has been undone. It
    then runs the full pass with `paidScopeIds` and `tallyIds` set to `pinPendingIds`, against the same
    ImportJob's ceiling ledger.
    - **If it can't take the lease, or loses it mid-run,** it throws a retryable error, so BullMQ runs it again
      in 60 s. It writes no count and no end state on the way out.
    - **It watches for an undo for the whole run,** not only at its start. Step 5's per-chunk re-check and the
      check before each step-7 batch also re-read the ImportJob's `undone` flag and `pinFollowUp.status`. On
      `undone`, or a status other than `'queued'`, it stops buying, writes no further placement or revert,
      still runs the freeze, writes no counts, and sets `'cancelled'` (compare-and-set from `'queued'`). At
      most the provider chunk already sent completes.
  - **How it writes the counts, idempotently.** At its end it re-reads, from state, every door of
    `pinPendingIds`, whoever changed it since the busy tally (this pass, the lease holder, a lead's Move pin or
    Looks right, a vendor coordinate in a later file). In one `updateOne` filtered on
    `{ 'pinFollowUp.status': 'queued', 'pinFollowUp.at': at }` it writes:
    - each placed counter as `baseline` plus the pending doors now currently placed by the lookup in that
      category (step 10's split);
    - `pinsStillUnplaced` as `baseline.pinsStillUnplaced` − |`pinPendingIds`| + the pending doors with
      `isPinUnplaced` true now. A pending home a lead fixed or confirmed meanwhile therefore leaves the count,
      as it leaves Pin Fixes;
    - `status: 'done'`, and `pinPassCause` cleared.

    A redelivery or a second run matches nothing and changes nothing. Homes the busy tally had already counted
    as placed keep that count; every home it counted as unplaced is re-read.
  - **Its other end states:**
    - `'failed'`: it got the lease but its lookup degraded or threw (§E step 5). It keeps `pinPassCause`, sets
      `pinPassError`, and writes the same recount under the same filter, so the summary still shows what was
      placed.
    - `'gave_up'`: BullMQ gave up on it, after 30 attempts without the lease or a second stall. The import
      worker's failed listener writes it (§F), compare-and-set from `'queued'`, with `pinPassError`; today that
      listener returns at once for a job without `data.importJobId` (`worker.js:175-176`), so the branch is new.

    The recovery for both is the usual `pins:check` placement run.
  - **Any later pass of the same import that isn't busy** (a retried import job that wins the lease) `$set`s
    the counters from state as usual, clears `pinPendingIds` and sets `pinFollowUp.status` to `'done'`, so a
    stale follow-up exits without counting.
  - **Undo.** The undo route cancels the follow-up after the undo succeeds, and removes its job if it is still
    queued (§F). A follow-up already running stops at its next check, as above.
- **`pins:check`** skips a busy campaign for placement and lists it at the end, to re-run.
- **The repair script's post-revert pass** marks and freezes only, so it never waits for the lease.

**Execution order** (one pass): 0 lease → 1 load → 1b piles → 2 classify → 3 sort → 4 write marks → 5 look up
→ 6 gate → 7 write placements → 8 freeze → 9 outlines → 10 tally.

It is deterministic and idempotent:
- a retry or redelivery re-runs from the start;
- the ledger stops it re-spending;
- placed doors are never candidates again.

**1. Load.**
- **The stream:** the campaign's active, located households through a lean cursor, kept as compact tuples
  (about 300–410 bytes per door, roughly 75–120 MB at 250–300k doors) and bucketed by `buildingKeyForCoords`.
  - Ids are hex strings, the key string doubles as the Map key, and single-door buckets keep no arrays.
  - Each tuple keeps the door's `homeKeyOf` in place of its `stackBaseOf`, which is that key's prefix, so the
    unit suffix is the only addition. §Q.11's heap measurement covers it.
  - The import job releases `householdMap` first, keeping only its key Set and the `destHouseholds` id Set.
- **Inactive doors.** A second lean cursor streams the campaign's **inactive** located households with
  `location`, `addressLine1`, `addressLine2`, `coordSource`, `locationConfirmedAt`, `pinSuspect`, `correctedAt`,
  `correctedBy` and the whole `pinPlacement`. `recomputeHouseholdActive` deactivates doors whose voters a newer
  file re-housed and keeps their location (`recomputeHouseholdActive.js:34-38`), so their evidence must not
  vanish: that would be a shrinking stack, which must never clear a flag.
- **Departures.** The `from` a door left behind on another key. They join that key's composition and are never
  written. A door's departures, active or inactive:
  - **its `pinPlacement.from`,** when its key differs from both the door's current key and the key of
    `pinPlacement.to`. A `from` on the key of its own `to` is an in-place placement: the lookup verified the
    house there, whether the door is still placed, was since moved by a person (a unit-scope move of an
    unflagged door keeps its `pinPlacement`, §G), or was released by a vendor change. It is never a departure;
  - **a standing repair move's `from`:** the `from` of the latest `HouseholdLocationChange` row, for doors that
    are `coordSource: 'corrected'` now and whose latest row is `import_repair`. That is `findOwnRepairs`'
    selection, run here over inactive doors as well, because a house the repair moved off a spot must keep that
    spot shared after it is deactivated. A reverted door is `'file'` again, so it never qualifies. The repair
    script adjudicated that door's own address answer (rooftop or point only, `repairImportPins.js:316`,
    `:403-435`), which is address evidence like a lookup's, so it counts the same way;
  - **a pile member's pile-row `from`** (step 1b), active or inactive.
- **One member per home.** On each key, every active door, inactive door and departure is grouped by
  `homeKeyOf` (§D), and each group is **one member**, however many records it has. So one home never counts
  twice: not a re-spelled house whose old door was emptied on the same coordinate, not a placed stray whose
  re-keyed twin came back to the spot (whether or not the twin is later placed too), and not two records of one
  home written two ways in the same file. A home on a key is:
  - **present** when it has an active door there;
  - **departed** when it has no active door there but has a departure there;
  - **emptied** otherwise (inactive doors only).
- **Who votes.** Present and emptied homes vote for their `stackBaseOf`, exactly as they would if every door
  were active, so emptying a door never changes a verdict: a duplex with a placed stray stays a building when
  one unit, or both, are emptied, and a vacated building is still a building. A departed home never votes: it
  is passed with a street token unique to it, so it counts toward the stack's size and distinct addresses only.
- **Proven wrong.** An address with a departure on a key is **proven wrong on that key**: the lookup, a person,
  the vendor or the repair script moved that address away from it. Every present or emptied home of that
  address on the key is then a suspect (step 2). That keeps the "5001 Apt B" case (§D), and it flags a
  re-keyed stray's new door, or a repaired building that a refresh re-keys back onto its wrong lot.
- **Shared-spot history.** A key has history when it holds a departed home or an address proven wrong there.
  Step 3 never clears a stored flag on such a key.
- **A re-keyed door inherits its old door's mark.** When an active door carries no `pinSuspect`, is not
  human-owned and is not currently placed by the lookup, and an inactive door of the same home on the same key
  carries an effective `pinSuspect` (its own, not one held under a vouch or on a `'corrected'` door), step 3
  treats that flag as the active door's stored flag, and step 4 writes it. A refresh that re-spells a whole
  building therefore doesn't drop its units' flags with their old doors.
- **Inactive doors are classification evidence only.** They are never compared by the collapse gate (§E step
  6), because nobody draws them on any map.
- **Renumbering** ("123 Oak St" to "125 Oak St"), or a re-spelling `homeKeyOf` can't fold ("County Road 5" to
  "CR 5", "Mt" to "Mount"), leaves the old record as a different home with a different address on the spot.
  The renumbered home is flagged once and looked up (the lookup usually places it in place), and the old
  record's knocks are frozen as shared-spot knocks. Both are misses only, disclosed in D3.
- **Checked by replay.** Every round-6 failure history (a re-keyed stray placed twice, by the lookup or by
  hand; re-keyed neighbours returning to a flagged building's spot, with lookups on and off, and a whole-file
  re-key; a building with a stray's trace losing one unit or all of them, and the deploy-day variant; a
  repaired building re-keyed back onto its lot; an in-place placement followed by a one-unit move; the shared
  flag beside a lookup-placed or vouched unit; an emptied pile member) and revision 6's own evidence cases
  were replayed through these rules with the real `classifyStackedPins` and `buildingKeyForCoords`: 49 of 49
  as intended. The same histories replayed on every building spot with strays in the four located files
  (Nye 1, FL-22 i360 17, Tyler 6, FL-22 master 124) leave no building unit wrongly flagged or frozen, where
  revision 6 flagged up to 77 and froze up to 999 on the master file.

**1b. Piles (D9).**
- **Which doors:** unconfirmed, `coordSource: 'corrected'` doors, **active or inactive**, whose latest
  `HouseholdLocationChange` row is a human move (`gps`/`drag`/`admin_drag`) with `scope: 'building'`. The
  latest-row query already runs over inactive corrected doors for repair departures, and the inactive cursor
  carries `correctedAt` and `correctedBy`, so a pile house emptied before its first pass is still recognised.
- **Grouping:** by (current key, `correctedAt`, `correctedBy`). One fan-out writes one shared timestamp
  (`updateHouseholdLocation.js:60`).
- **Classification:** each group of 2+ homes, active and inactive members together, is classified like a
  stack. The active members it marks get `pinSuspect`; the inactive ones it marks are covered by the freeze's
  pile row.
  - The rows' `from` points are departures at the old spot (step 1).
  - The freeze also proves those doors' rows against that `from` (step 8).
- **Ending:** a later per-home Move pin writes a `'unit'` row, which ends pile membership.

**2. Classify** every key with 2 or more homes (present, emptied and departed alike, one member each). Then
apply step 1's proven-wrong rule: every home of an address proven wrong on its key is a suspect, a stray if
another address holds the majority, otherwise a placeholder. When the majority's own address is proven wrong
there, the key has no majority, and every home on it is a placeholder.

**3. Sort each real member** (each active door, with its home's verdict). The first bullet that matches
decides. A door's **stored flag** is its own `pinSuspect`, or the mark it inherits from an inactive twin
(step 1).
- **Currently placed by the lookup:** never flagged and never a candidate. Only step 6's collapse check can
  revert it.
- **A key with fewer than two homes:** no verdict, and the stored flag is left alone.
  - A lone flagged door with `coordSource` `'file'`/null that is not human-owned stays a candidate of its
    stored kind.
- **In the street-address majority of a key with no shared-spot history** (no departed home, no address proven
  wrong): clear a stored `pinSuspect`. A key holding one street address counts as all majority, unless that
  address is proven wrong there (step 2).
  - A departure proves the spot was a shared spot. So a building's units left on a vendor's ZIP+4 spot never
    become "the majority" once its houses are placed or moved by hand, and re-keyed houses coming back to the
    spot don't clear it either: their old `from`s prove their addresses wrong there.
  - This is how an import **undo** clears: it deletes that import's doors outright, so the spot reads as it
    did before the import. Knocks stamped in between stay stamped (misses only).
- **In the majority of a key with shared-spot history, with a stored flag:** the flag stays. The door stays a
  candidate of its stored kind when its `coordSource` is `'file'`/null and it is not human-owned, so a later
  `--geocode` run still tries it.
  - **Its address's other units on the key take the same flag,** so a unit a later file adds to a flagged
    building is flagged with it. The flag passes only from a unit whose flag is effective (unplaced now, not
    held under a vouch), and only to a unit that the lookup doesn't currently place and no person owns. A
    unit the lookup placed in place stays placed (the first bullet), and a vouched building stays a building:
    its raw flags, kept under the vouch, never pass to a new unit.
- **A pile suspect (step 1b):** flagged, but never a candidate and never moved. A person fixes it per home in
  Pin Fixes.
- **Any other human-owned suspect** (`'corrected'`, or `locationConfirmedAt` set): never flagged or moved, and
  its stored flag is left alone.
- **A suspect with `coordSource` `'file'` or null:** flagged, and a candidate.
- **A suspect with `coordSource: 'geocodio'`** (the geocoder's own collapse): flagged only.

**4. Write the marks:** every `pinSuspect` set or clear from step 3, inherited marks included, with the
conditional filters of step 7.
- A knock that arrives after this write is stamped at knock time.

**5. Look up.** Candidates are taken in deterministic order (spot key, then normalized address).
- **Before each chunk:** re-check three things: `Campaign.deletion.requestedAt`;
  `Organization.deletion.requestedAt`, which is set only once a deletion executes (`orgDeletionState.js:4-12`);
  and an `OrgDeletionRequest` with `{ organizationId, status: 'scheduled' }`, the customer's filed request,
  which waits up to the 30-day SLA before it runs (`superAdmin/access.js:379-381`). If any is set, stop buying
  and keep the marks. If a scheduled request is cancelled, a scoped `pins:check --geocode --apply` places the
  homes.
  - **A follow-up job also re-checks its import** here: `ImportJob.undone`, and `pinFollowUp.status` still
    `'queued'`. Either one failing stops it buying (see "One pass at a time").
- **Budget:** `PIN_PLACEMENT_MAX_HOMES` minus the size of `job.pinProbedIds`. Only ids not already in the
  set are charged, so a retry never pays for a home twice.
- **Chunks:** `GEOCODE_BATCH_SIZE`. Each chunk is probed as copies with null coordinates (the repair script's
  pattern, so a real door is never touched and `unmatched` never reaches a drop path), then sent to
  `resolve(probe)`. `onChunk` then `$addToSet`s the ids and `$inc`s `pinLookupsNew`.
- **Over the budget:** candidates past the budget stay flagged and are counted as over the ceiling.
- **Degraded:** on the first chunk that comes back `geocode_failed` (no key, outage, timeout, 429, network),
  the run **stops buying**. It skips the remaining chunks and steps 6–7, keeps its marks, runs the freeze and
  the tally, and writes `pinPassError` and the cause.
  - Each hung batch can wait 180 s (`geocodeService.js:17`), and one import slot is shared with every other
    organization, so carrying on through an outage would hold that slot for chunks × 180 s for answers that
    would never be applied. The unprobed candidates stay flagged for the `pins:check` recovery, and each
    address is still bought only once.
  - A genuine no-match comes back as unmatched, not `geocode_failed`, so it never degrades a run.
  - **The cause.** `resolve()` catches every provider throw and keeps only a generic detail
    (`geocodeService.js:221-231`). So the pass calls `resolve(probe, { geocodeBatch: wrapped })`, using the
    existing injectable option (`:114`, `:120`). `wrapped` calls the provider and, on the first throw, keeps
    a cause from this fixed mapping before re-throwing:
    - `/^Geocodio HTTP (\d{3})/` on the message → "HTTP nnn" (the provider error carries no status property,
      `geocodioProvider.js:33-36`);
    - an `AbortError` → "timeout";
    - a `TypeError` with a `cause` (undici's "fetch failed": DNS, refused or reset connections) →
      "network: <cause.code>", the code only;
    - a `SyntaxError` (a 200 that isn't JSON, such as a maintenance page) → "bad response (not JSON)";
    - anything else → the error's `name` only.
  - A provider error's message is never stored: it embeds up to 200 characters of the response body. The
    request URL is never stored either, because it carries the API key (`geocodioProvider.js:22`).
  - **Test seams.** `placeStackedPins` takes an optional `geocodeBatch`, which `wrapped` delegates to and
    which defaults to the real provider, so the integration tests can fail a batch without touching the
    network. It likewise takes an optional `followUpQueue`, defaulting to `pinFollowUpQueue` (§B), so the
    integration tests, which run without Redis, can drive the follow-up's enqueue, promotion and removal; the
    undo route takes the same adapter.
- **What reaches Geocodio** is exactly today's `addressString()` (`geocodeService.js:64-70`):
  - line 1 as the file gave it, including any unit the vendor wrote there;
  - city, state and ZIP5;
  - never line 2, and never a name.

**6. Gate each answer** (`pinTrust.stackPolicy`, pure). It fails closed.
- **Type:** judged on `accuracyType`, never `confidence`.
  - Placeholder: `rooftop` or `point`. Also `range_interpolation`, but only while `PIN_PLACEMENT_MAX_INTERP_M`
    is set.
  - Stray: `rooftop` or `point`.
  - A null type is refused.
- **ZIP:** the matched ZIP5 must equal the address ZIP5. A missing matched address refuses.
- **In state:** `inStateBounds`. Cache hits skip `evaluate()`, so it is re-checked here.
- **Distrusted keys:** an answer landing on one of the door's `pinDistrustedKeys` is refused.
- **Collapse:** the answer's key must not be shared with a different `stackBaseOf`. The comparison set is:
  - every other answer in this pass, the door's own bucket included;
  - every door currently placed by the lookup on that key, own bucket included, because a previous pass may
    have placed one in place;
  - every other door currently on that key, except own-bucket members that are flagged, unvouched
    candidates. Their answers are either in the first set now or will meet this door in a later pass's
    second set. Inactive doors are never compared (step 1).
    - So a vouched, corrected, pile or `'geocodio'` member, and an unflagged member of a different address,
      is always compared. None of them is ever looked up.
    - **A stray whose rooftop lands on its own building's key is therefore refused.** Its address resolves
      to another address's point, which is the collapse this gate exists for, and a wrong acceptance would
      judge its knocks at full Far against someone else's building. A corner building with two street
      addresses stays flagged, and Looks right is its escape hatch.

  Three more rules:
  - **Only answers that are claims to the point count** (`isPointClaim`, exported from `pinTrust.js` for the
    repair script too, §M). An answer refused for its type, its ZIP or its state
    never enters the comparison set and never triggers a revert. A `nearest_rooftop_match` is, by
    definition, another address's roof: Geocodio couldn't find the house, so it returned a neighbour's. Counting
    it would refuse that neighbour's own correct rooftop, or revert it and distrust its key for good. An answer
    refused only because its key is on that door's `pinDistrustedKeys` still counts, because it is a real
    claim to a known collapse point.
  - Answers served by the same `GeocodeCache` entry are one address. The probe keeps each answer's cache key
    for this.
  - **When the other door is one a previous pass placed** (currently placed by the lookup), both are
    distrusted. That door goes back to `pinPlacement.from` (`coordSource 'file'`, `pinSuspect` set to its
    kind, `releasedAt: now`). Both doors then `$addToSet` the answer's key into `pinDistrustedKeys`, so a
    later re-import can't put either back on it. One file and two files therefore end the same way.
- **Street-level ceiling.** A `range_interpolation` answer is refused if it lands more than
  `PIN_PLACEMENT_MAX_INTERP_M` from the spot, or if it is an outlier against the non-suspect pins on the
  same street and ZIP5. That outlier test is the repair script's street-outlier rule (medoid, at least 3
  neighbours, more than 4× their spread), moved into `pinTrust.js`.
- **Distance.** Every accepted answer is a placement with a record, even one within 25 m of the spot.
  - A door whose exact answer lands on its own key is **placed in place** (§C). It reads "The address lookup
    confirms this spot", is counted apart, and is never re-flagged (step 3) unless step 6 reverts it.
  - An interpolated answer within 25 m of the spot carries no information, so the door stays flagged.

**7. Write placements and reverts** in `bulkWrite` batches of 1,000.
- Every filter pins the loaded state (`_id`, `location.coordinates`, `coordSource`, `locationConfirmedAt: null`),
  so a human move or confirm that lands mid-pass wins. The confirm writer is conditional too (§G), so that
  race is closed from both sides.
- Before each batch the pass re-checks that it still holds the lease (§C). If it has lost it, it writes no
  more placements or reverts and finishes with the freeze and the tally. A follow-up job also re-checks its
  import's `undone` flag and `pinFollowUp.status` there, and stops the same way.

| Outcome | Write |
|---|---|
| Placed | `$set location, coordSource 'geocodio', coordConfidence 'exact'/'interpolated', pinPlacement {from, to, at, kind, by:'lookup', accuracyType, stackSize}`, plus `$unset pinSuspect` |
| Reverted | as in step 6 |

- `updatedAt` moves, so phones get the change through `/mobile/changes`.
- No `HouseholdLocationChange` rows are written; `pinPlacement` is the record.

**8. Freeze** the audit evidence. It runs at the end of **every** pass, and it is idempotent, because it
only touches rows that still have no `knockPin`.

**It judges each door as it is now, not as the pass loaded it.** Right before it selects a batch's rows, it
re-reads that batch's households (`location`, `coordSource`, `pinSuspect`, `locationConfirmedAt`,
`pinPlacement`, `isActive`) and applies the table and the arrival rule below to that state. Idempotence alone
isn't enough: a marking pass runs beside a placing pass by design (§C), and a busy import that loaded door D on
its shared spot S could otherwise stamp a far knock recorded after the lease holder placed D in place. That
knock got no knock-time stamp (D was no longer flagged) and was measured against the placed pin, which sits in
S's 1.1 m key cell, so it would prove against S. Re-read, D is "placed in place" and nothing is proved. A Looks
right made during the pass is honoured the same way: the door is no longer unplaced now.

**The doors, the spots it proves their rows against, and which rows.** Every time below is a server time:
a row's `createdAt`, and `pinPlacement.at` is the step-7 write time. `grace` is 5 minutes. It covers the
knock route's awaits between loading the household (`canvass.js:316`) and inserting the row (`:413`), slow
requests included.

| Door | Proved against | Rows considered |
|---|---|---|
| Unplaced now | its current pin | those created after it arrived on that pin (the arrival rule below) |
| Inactive, and it would be unplaced now if it were active: its home on that key is a suspect (a placeholder, a stray, or an address proven wrong there), or its address has a present unit there that ends this pass unplaced (a kept, inherited or shared flag). Never one that was vouched, hand-corrected (a pile member is the pile row's), currently placed by the lookup, or placed in place. | its current pin | the same arrival rule, with its own `pinPlacement` fields. An emptied unit of an unflagged building on its own spot is the building's own unit at its correct coordinate, so it is not covered, and a vacated building is still a building (step 1). |
| Carries `pinPlacement.at`, with `from` and `to` on different keys | `pinPlacement.from` | those created up to `pinPlacement.at` + grace. A row that also proves against `to` is skipped while that placement is trusted (by the lookup, rooftop or point, and its key not distrusted): it fits the verified house as well as the spot. |
| Placed in place (`from` and `to` on one key) | nothing | none. `from` is the verified house, so nothing measured there needs forgiving. |
| Reverted by the collapse gate (the key of `to` is in its own `pinDistrustedKeys`) | `pinPlacement.to` | those created from `pinPlacement.at` to `releasedAt` + grace. Two addresses claimed that answer, so it was a shared spot too. |
| Pile, active or inactive (step 1b) | the pile row's `from` | those created up to the pile row + grace. Its rows after the pile move are proved against the pile spot through the arrival rule (rule 1), as for any pile suspect. |

**The repair script's collapse reverts are stamped by the script itself,** not by this table. When its
self-revert sends a door back to its file pin for the collapse reason ("N different addresses get this
identical spot"), it calls `freezeRows` (§B) in the revert loop, before it saves the revert: the rows created
from the repair row to now + grace that prove against the repair row's `to`. Two addresses claimed that answer,
so it was a shared spot too. Stamping first makes the evidence durable at once: the revert leaves no
`pinPlacement`, no distrusted key and no reason on its history row, and once the door is `'file'` again the
script never loads it, so a later pass could not re-derive it, and a run cut off before its post-revert pass
would have lost it. Since the script's collapse pool admits only claims to the point (§M), such a revert always
rests on two real claims.

**The arrival rule:** when a door arrived on its current pin. The first that applies wins.
1. A pile: the pile row's time.
2. On the key of `pinPlacement.to`, where `to` and `from` are on different keys: `pinPlacement.at`. A
   placement or a file change brought it there (§F's flagged-door row writes `at` and `releasedAt` together).
3. Off the key of `to`, with `releasedAt` set: `releasedAt`. A later file coordinate, or a collapse revert of
   a placement on another key, brought it there.
4. Otherwise, all rows. That covers a door with no `pinPlacement`, and a door reverted from an in-place
   placement, which never left its key, so its rows from before the placement are stamped too.

**The proof** (`freezeRows`, the one implementation for the pass and the repair script):
- **The test:** `|Math.round(haversineMeters(spotLat, spotLng, row.location.lat, row.location.lng)) − row.distanceFromHouseMeters| ≤ 1`.
  That is `distanceFromHouse`'s own formula and argument order (`canvass.js:190-194`).
- **The write:**
  - `$set knockPin: 'shared', knockPinAt: now`;
  - via `updateMany` per batch, on the `{ householdId: 1, timestamp: -1 }` index, filtered on
    `knockPin: { $exists: false }`;
  - with `timestamps: false`.
- **In a dry run** it counts the rows it would stamp and writes nothing.
- **What it never does:** write `false`, or unset anything.

**What this guarantees.**
- **Every knock measured against a shared spot is stamped:** at knock time once the door is marked, or by
  the freeze for rows inserted before the mark. That includes:
  - knocks between the deploy and the backfill;
  - knocks after a failed import pass;
  - knocks before a stack formed, and before a pile move;
  - knocks against an answer the collapse gate, or the repair script's self-revert, later distrusted;
  - knocks on a door that was deactivated before it was ever marked, a pile house included, before and after
    its pile move;
  - in-flight stragglers (the next pass catches them);
  - rows restored verbatim with their original `createdAt` (unknock revert, re-cut snapshot restore).
- **A knock measured against a trusted placed pin is not stamped by the freeze.** A rooftop or point
  placement's own rows also prove against `to` and are skipped, and an unchecked street-level placement's
  rows already carry `estimated` from knock time.
- **What it cannot rule out:** a door that came onto a shared spot through a plain vendor change has no
  recorded arrival time, so its older rows are tested against the spot too. A row whose distance matches by
  coincidence (round 2 measured 0.2–3.7% of far rows, falling with distance) gets its Far lowered. That is a
  miss, never a flag.

**9. Outlines.**
- **The redraw:** for each live round where a draft or published book holds a door this run placed or
  reverted, call `recomputePassTerritories(passId, { withCentroid: true })` once for the whole round, with
  no `onlyTurfIds`. That is the repair script's actual call (`repairImportPins.js:646-670`).
  - Doors placed in place, or reverted from an in-place placement, didn't move, so they never trigger a
    redraw.
- **Failures:** best effort per round; a failed round is named, with the pointer to
  `npm run recompute:territories -- --apply`.
- **Unchanged:** membership, walk order and `doorCount`.

**10. Tally.**
- **Import:** only the doors in `tallyIds` (this file's `destHouseholds`).
- **Check:** every door.
- **Placed counts come from state,** over doors **currently placed by the lookup** (§C) whose
  `pinPlacement.at` is at or after the job's `createdAt` (for `pins:check`, the run's start):
  - placed in place → `pinsConfirmedInPlace`;
  - rooftop or point → `pinsPlacedExact`;
  - `range_interpolation` → `pinsPlacedApprox`.
- **Nothing else counts as placed:** a vendor's own fix (`by: 'file'`), a person's move during the import,
  and a placement since released or reverted.
- **A follow-up job** (see "One pass at a time") re-reads every door of its `pinPendingIds` from state: the
  placed counters become the stored baseline plus the pending doors now placed by the lookup, whoever placed
  them, and `pinsStillUnplaced` becomes the baseline minus the pending count plus the pending doors still
  unplaced now. It writes them in one `$set` guarded by the queued status. It never `$inc`s, so a redelivery, a
  second run, homes the lease holder placed meanwhile, or homes a lead fixed meanwhile can't be counted twice or
  leave `pinsStillUnplaced` wrong.

**11. The three run modes** of `pins:check` (and the pass's `dryRun`).
- **Dry run** (no `--apply`, no `--geocode`). It reads the cache through `peekCache()` (§B, §M), so it buys
  nothing, refreshes no `lastUsedAt`, and writes nothing. (`forecast()` can't serve here: it returns only
  counts, and it skips every household that already has coordinates, which every candidate does,
  `geocodeService.js:271-301`.) It prints:
  - marks;
  - candidates, split into cached (free) and to buy, and the price;
  - the rows it would freeze;
  - the Audit after-effects: Far flags it lowers, and how many of those carry a review;
  - piles;
  - excluded houses that aren't apartments;
  - campaigns with a published live round, and campaigns that are busy. It reads the lease and never takes
    it.
- **Calibration** (`--geocode` without `--apply`; How it ships, step 4). It calls `resolve()`, which buys,
  caches and refreshes `lastUsedAt` for every candidate, and it writes no household and no activity row.
  Per candidate, it prints:
  - the household id, never an address;
  - `accuracyType`;
  - the distance from the spot;
  - the distance to the nearest knock GPS at that door;
  - the distance to the position its neighbours suggest: interpolated by house number between the nearest
    lower- and higher-numbered non-suspect doors on the same street and ZIP5, and blank without both.

  In total, it prints how many at-the-door knocks would read Far against the answer.
- **Apply** (`--apply`, with `--geocode` for placement). The pass itself.

## F. Import pipeline

**`finish()`** (`csvImporter.js:351-388`): it classifies with `stackBaseOf`, one member per home
(`homeKeyOf`, §D) as the pass does, and returns `placeholderPins`, `placeholderPinDoors` (placeholder only) and
`strayPinDoors`, counted per door.
- `strayPinDoors` must be added at every named-field hop, or it arrives as `undefined`:
  - `csvImporter.js:385-386`;
  - `routes/admin/imports.js:278-280`;
  - `importProcessor.js:100`, `:145` and `:426-427`;
  - `computeImportDiff.js:93` and `:306-307`;
  - `models/ImportJob.js:64-65`;
  - `ImportPage.jsx:239-253`.
- The preview stays file-scoped by design.

**Preview copy** (`ImportPage.jsx:239-258`):
- "other streets" becomes "other addresses";
- the body branches on `diff.geocoding.enabled`, which both preview paths already carry;
- `:434` ("The import is now free (cached)") is qualified.

**`applyImport`** (`csvImporter.js:757-842`)

- **A second, unconditional prefetch.** The shield's own prefetch is skipped under `overwriteHandEdits`
  (`:759`), so a separate one is needed. It runs over the incoming addresses, finds doors with
  `pinPlacement.at` or `pinSuspect`, and projects `location coordSource locationConfirmedAt pinPlacement pinSuspect`.
- **First test.** It applies to every door that carries `pinSuspect` or `pinPlacement.at` and is not
  human-owned, when either:
  - the incoming coordinate's key equals the door's current key; or
  - the incoming coordinate was filled by the geocoder because the file had none: the householdMap entry's
    `coordSource === 'geocodio'`, which the geocoder stamps on every fill (`geocodeService.js:167`, `:246`).
    - Not `coordsProvided: false`. That comes from the address's first row only, so an entry whose later row
      brought a file coordinate would read as geocoder-filled, and the vendor's real coordinate would be
      ignored (`csvImporter.js:112`, `:333-343`).

  In those cases the location trio moves to `$setOnInsert`, and `pinSuspect` and `pinPlacement` are left
  alone.
  - An echo of a placed point (re-importing Doorline's own voter-file export, for example) keeps the
    placement and D3b.
  - A coordinate-less re-import of an unplaced home leaves it on its spot for the pass to judge.
- **Then, in order:**

| Stored state | Incoming file coordinate | Write |
|---|---|---|
| `coordSource: 'corrected'` or `locationConfirmedAt`, and not `overwriteHandEdits` | any | Today's shield. |
| Currently placed by the lookup | same key as `pinPlacement.from` | **Keep the placed pin.** Only the location trio goes to `$setOnInsert`; `pinPlacement` goes in neither. Count `keptPlacements`. This applies under `overwriteHandEdits` too, because a placement is not a hand edit. A placed-then-hand-moved door is `'corrected'` and never matches this row. |
| Currently placed by the lookup | different | The vendor changed it. `$set` the file coordinate (`coordSource 'file'`), `$set pinPlacement.releasedAt: now`, and `$unset pinSuspect`. |
| Carries `pinSuspect` | different | `$set` the file coordinate. In the same write, `$set pinPlacement {from: <current spot>, to: <new>, at: now, kind, by:'file', releasedAt: now}`, then `$unset pinSuspect`. |
| Anything else | any | Today's behavior, including today's `overwriteHandEdits` release. When this moves a door that carries `pinPlacement.at` onto a different key, the same write `$set`s `pinPlacement.releasedAt: now`, so the freeze knows when it arrived (§E step 8). |

**`importProcessor.js`**

- **Placement.** The pass runs after `recomputeHouseholdActive` (around `:389`) and before
  `collectRevisitHomes`.
- **Phase.** `phase: 'pins'`, with `status` left at `'importing'`. `STATUS_LABEL.pins = 'Checking map pins'`.
  - `StatusBadge` (`ImportPage.jsx:52-70`) shows `STATUS_LABEL[job.phase] || STATUS_LABEL[job.status]` while
    active. That's needed because preview and geocode-check jobs are not in the list, so today the apply
    job's badge never shows a phase.
- **Liveness.** One interval-heartbeat helper writes `ImportJob.heartbeatAt` every 30 s and clears itself in
  `finally`. It wraps the pass and **both** existing `resolve()` call sites, the geocode-check one
  (`:110-118`) and the apply one (`:178-206`). Today's heartbeats ride progress writes only (`:84`, `:116`,
  `:187`, `:322`). The campaign lease has its own timer inside the pass (§C).
- **The follow-up job** (§E, "One pass at a time"). `processImportJob` recognises the `pins-followup` job
  name first, before its status re-claim (`:78-88`), reads the import's id from `data.followUpOf`, and runs
  the pins-only path with the same deletion guards as an import (`:60-75`). It exits as `'cancelled'` if the
  import is undone, at its start or at any later chunk or batch check.
- **The worker's failed listener gains a `followUpOf` branch** (`worker.js:175-197`). Today it returns at once
  for a job without `data.importJobId`, and `removeOnFail` then deletes the job, so nothing would ever close a
  follow-up that BullMQ gave up on. The branch uses the listener's own final-failure test (attempts exhausted,
  which includes the deferred failure of a job that stalled twice: the import worker sets no
  `maxStalledCount`, so BullMQ's default of 1 applies) and compare-and-sets `pinFollowUp.status` from
  `'queued'` to `'gave_up'`, with `pinPassError`.
- **The nightly import sweep closes what nothing else can** (`sweepStaleImports.js`, maintenance queue). Today
  it looks only at active statuses (`:33-34`). It also finds `ImportJob`s whose `pinFollowUp.status` has been
  `'queued'` for more than 40 minutes (the follow-up's 30 retries plus a margin) and calls
  `pinFollowUpQueue.promoteOrRecreate` for each, so a follow-up orphaned by a rollback or a lost Redis key runs
  again; one that then fails for good is closed by the failed listener.
- **Failure.**
  - A thrown error is non-fatal. It writes the generic `pinPassError` and the full `pinPassCause` (§C), and
    the import completes with its marks. Nothing about the pass is written to `lastError`, which
    organizations can read.
  - An out-of-memory abort is fatal, as it is for every step (§Q measures this).
  - **Recovery** for the operator: `npm run pins:check -- --campaign=<id>` (the dry run, which prints the
    price), then `npm run pins:check -- --campaign=<id> --geocode --apply`.
- **Concurrency.** The campaign lease (§E, "One pass at a time") is what protects the collapse rule, and only
  placing passes take it; the conditional writes protect each door from human edits. A busy import never
  sleeps in its worker slot; its follow-up job places its homes once the lease frees. Spend is bounded by each
  import's own ceiling, which the follow-up shares.

**Who sees which counters.** `ORG_HIDDEN_IMPORT_FIELDS` is spread into:
- the list projection (`routes/admin/imports.js:436`, keeping `errors: 0`), together with
  `IMPORT_DETAIL_PROJECTION`, so the list stops shipping `insertedHouseholdIds`, `insertedVoterIds`,
  `sourceHouseholdIds` and `duplicateStateVoterIds`. Today only the detail route drops them (`:450-455`), and the
  list ships them on every poll; no web or phone file reads them (checked two ways: `grep -rna`, and
  `find | xargs grep -la`). That mattered little during today's short 1.5 s polls of an active import, but the new 15 s
  poll of a queued follow-up (§J) can run for half an hour, and on FL-22's master file the arrays come to about
  7 MB per poll;
- `IMPORT_DETAIL_PROJECTION` (`:450-455`);
- the **cancel** route's load (`:495-498`), which today returns the whole document for a terminal job.

**Undo** keeps verdicts and placements on pre-existing doors, consistent with undo never reverting updates to
existing records. One addition, in the undo route (`routes/admin/imports.js:576-628`):
- **After `undoFileImport` returns,** outside the `try` whose `catch` resets `undone` (`:620-627`), the route
  compare-and-sets `pinFollowUp.status` from `'queued'` to `'cancelled'`, for the clicked job and for every
  same-file sibling `undoFileImport` marked undone (`undoImport.js:224-233`).
- **Then it removes the job,** best effort: `pinFollowUpQueue.remove('pins-<importJobId>')`, a bounded
  `Queue.remove`, which returns 0 for a job a worker holds (`bullmq/dist/cjs/classes/queue.js:478-492`) and
  never fails the request. `Job.remove()` is not used: it throws on a locked job (`job.js:417-427`), and inside
  the `try` that throw would roll the undo's claim back after its doors were already deleted.
- **The guarantee comes from the follow-up itself,** not from the removal: a queued follow-up is gone or exits
  at its start; a running one re-checks the import before every provider chunk and every placement batch
  (§E steps 5 and 7). After an undo, at most the one provider chunk already sent completes, and no placement
  is written for that import.

**Unchanged:**
- `seedDemoOrg.js` (its fixture has no shared spots);
- `runImport`.

## G. Pin writers and what each keeps true

| Writer | `location` | `pinSuspect` | `pinPlacement` |
|---|---|---|---|
| `applyImport` | the file coordinate unless shielded, guarded or first-tested | per §F | per §F (never unset) |
| The pass | the answer coordinate, or a revert | set or unset (step 3) | set on placement; `releasedAt` on revert |
| `updateHouseholdLocation` (web, mobile, repair `--apply`) | new coordinate, `'corrected'` | **unset on every moved door, in the same single write** | written `by:'person'` when the door carried `pinSuspect` at write time |
| Repair-script revert (`repairImportPins.js:605-631`) | back to the HLC `from` (`'file'`); for the collapse reason it first stamps that door's repaired-period rows (§E step 8, §M) | re-marked by running the pass afterwards (§M) | untouched |
| `confirmHouseholdLocation` | unchanged; the write is conditional on the loaded pin | **kept**; the vouch is `locationConfirmedAt` | untouched |
| Mobile optimistic layer (`recordAction.js`) | local, with `locationConfirmedAt: null` as the server's real move writes; the reconcile (`reconcileLocationResponse`, §K) takes the location trio (`location`, `coordSource`, `coordConfidence`) and `locationConfirmedAt` from the response, so `moved: 0` restores them | unset locally; the reconcile takes `pinSuspect` from the response | — |

### `updateHouseholdLocation`

**Building fan-out** (`:43-57`): **same key and same `stackBaseOf`, whatever the flags.** The query moves into
`sameAddressDoors({ campaignId, location, addressLine1 })` (§B), which the confirm fan-out and the door activity
route's count (below) call too, so the number a lead is shown is the set the server moves.
- The address rule alone keeps separate houses and strays out.
- Units of one address move together even when every one of them is flagged. That is what lets a lead fix
  a real building sitting on a shared spot, instead of splitting it into one pin per unit, which would also
  stop Remove apartments from taking it. Round 3 measured such addresses in every file (§D's footnote).
- A primary with no same-address sibling moves alone.
- **It never answers 4xx.** Old apps and queued offline replays send `'building'`.

**The write: one pipeline update per target, replacing `h.save()`** (`:73`). It is
`findOneAndUpdate({ _id }, [stage1, stage2], { new: true })`:
- **Stage 1, `$set`:**
  - `pinPlacement`: a `$cond` on `{ $eq: [{ $type: '$pinSuspect' }, 'string'] }`. When true it writes
    `{ from: '$location.coordinates', to, at: now, kind: '$pinSuspect', by: 'person' }`. Otherwise it keeps
    `'$pinPlacement'`, which leaves it as it was, or absent.
  - `location`, `coordSource: 'corrected'`, `coordConfidence: null`.
  - `correctedBy`, `correctedAt`, `previousLocation: '$location'`.
  - `locationConfirmedBy` and `locationConfirmedAt` set to null.
  - Every expression in one `$set` stage reads the document as it was before the stage, so `from` and
    `previousLocation` are the old spot.
  - **The service casts caller values itself,** because Mongoose validates a pipeline's shape but never
    casts its values (`castUpdate.js:54-61`, `:171-198`). `correctedBy` is
    `new mongoose.Types.ObjectId(String(byUserId))`. Without it, the repair script's `--user` argument, a raw
    string (`repairImportPins.js:130`, `:581`), would be stored as a string in an ObjectId path, where
    `h.save()` cast it before.
- **Stage 2:** `{ $unset: 'pinSuspect' }`. Checked with the repo's Mongoose 8.23.1:
  - this stage form is the one accepted;
  - the operator form `{ $unset: { pinSuspect: 1 } }` throws inside a pipeline;
  - mixing an operator update with a pipeline throws too.
- **`updatedAt` still moves.** Mongoose appends an `updatedAt` stage to pipeline updates
  (`applyTimestampsToUpdate.js`), so `/mobile/changes` still fires.
- **Built from the returned document:** the HLC row and the route's response. So the response carries no
  `pinSuspect` for a door the lead just fixed, and the new phone's reconcile doesn't re-badge it.

**Why one write, not a save plus a clear:**
- With the repo's Mongoose, setting a field to `undefined` on a document loaded without it sends no `$unset`,
  so a mark written between the route's load and its save would survive.
- Two writes are not atomic. A failure between them would leave a corrected door flagged for good, because
  step 3 never clears a human-owned door's flag.

**No-op cases.** The service writes nothing and returns `{ updated: [door], moved: 0, unchanged: true }`
when the primary either:
- is unplaced now, and the requested point is within 1.5 m of its pin (a save without a real drag). For
  `scope: 'building'`, the same test runs on **every** target: if any same-address unit is unplaced now and
  the point is within 1.5 m of its pin, the whole request is a no-op. Otherwise a no-drag "Whole building"
  from an unflagged unit would carry its flagged siblings onto the shared spot as hand-corrected; or
- carries `pinPlacement.at` with `from` and `to` on different keys, is no longer on the key of `from`, and
  the requested point is within 1.5 m of `from`.
  - A move back onto the exact shared spot a door left is never a correction.
  - A placement in place is exempt: its `from` is the verified house, so a lead who moved such a home away
    and drags it back onto its rooftop must be able to.
  - This is what stops an old phone's stale save from putting a placed home back on the shared spot as
    hand-corrected. The old `FixPinModal` seeds its pin once, at mount (`FixPinModal.jsx:21`). The household
    screen keeps it mounted (`household/[id].jsx:362-369`). The offline queue replays the stored body
    verbatim (`offlineQueue.js:97-103`). And every phone is old during How it ships steps 3–5, while the
    backfill and imports place homes.
  - An old phone's `'building'` replay is a no-op the same way, so the whole address doesn't go back either.

Either way: no `'corrected'`, no HLC row, and `pinSuspect` kept.

**Both routes** report the service's `moved` (`routes/mobile/canvass.js:516-533`,
`routes/admin/campaignHouseholds.js:133-148`) and send `effectivePinSuspect`. The mobile route's response also
gains `locationConfirmedAt` (additive), so the phone's reconcile can restore a vouch the server kept on
`moved: 0`, and clear it on a real move (§K).

**The door activity route** (`GET /admin/households/:householdId/activity`, `routes/admin/households.js:763`),
which both the web Map page's door panel (`HouseholdDetailPanel.jsx:506`) and the phone's admin map sheet already
load for the selected door, gains an additive `sameAddress: { count, unplaced }`: how many active doors
`sameAddressDoors` returns for it, and whether any of them is unplaced now. Both map pages filter their door
payload by date (Today by default) and by canvasser or answer (`households.js:320-335`), so a count taken from
the payload would miss the units nobody knocked in that window.

**New clients keep Save off** for an unplaced target, or a building move with an unplaced unit, until the
point, dragged or from GPS, is more than 1.5 m from the spot (§J, §K). So a new client never sends the first kind of no-op. The second kind (a placed
home dragged back onto the spot it left) is refused by the server, and every client says "Nothing moved"
when an online save answers `moved: 0`. What old phones show is in §K's Compatibility; the data is safe either
way.

### `confirmHouseholdLocation`

**Route guard** (`campaignHouseholds.js:182-187`): accepts interpolated **or** unplaced-now doors.
- **Expected coordinates.** `confirmSchema` gains an optional `expectedCoordinates: [lng, lat]`, the pin Pin
  Fixes displayed.
  - It is compared **before** the eligibility guard. Otherwise a home placed after the page loaded would get
    today's 400 `NOT_APPROXIMATE` instead.
  - When it is sent and its building key differs from the door's current key, the route answers **409 with
    code `PIN_CHANGED`** and stamps nothing.
  - Pin Fixes is the route's only caller (`PinFixesPage.jsx:475`, `:494`), so this needs no client-version
    gate.
  - Undo doesn't send it.
- **One code for both refusals.** This router already answers 409 for an archived or deleting campaign
  (`campaign-archived`, `campaign-deleting`; `campaignWritable.js:32-49`), and `confirmErrorMessage` maps
  every 409 to "This campaign is archived" (`pinFixes.js:110-117`). So both new refusals carry
  `code: 'PIN_CHANGED'` and one sentence, "This pin changed since the page loaded — reloading", and the client
  checks that code before its bare-409 branch (§I).

**The writer** stamps `locationConfirmedBy/At` and leaves `pinSuspect` alone.
- **Each target gets a conditional `findOneAndUpdate`,** replacing `h.save()` (`confirmHouseholdLocation.js:63-79`),
  whose filter is `_id` alone. The filter is:
  - `_id`;
  - the loaded `location.coordinates` and the loaded `coordSource`;
  - `locationConfirmedAt: null`;
  - `pinSuspect` as loaded, or `{ $exists: false }`.
- **When the primary doesn't match:** 409 `PIN_CHANGED`. A placement landing between the route's load and the
  stamp therefore fails loudly. It never vouches for a pin nobody saw, which would also switch off D3b on an
  estimate.
- **When a sibling doesn't match:** it is skipped, and `updated` reports the count actually stamped.
- **The HLC row** is written from the returned document.
- **Undo** works the same way, filtered on the stamp.
- **On a corrected door,** which is only possible for a pile, it writes **no** `'confirm'` HLC row. That
  keeps the rule "no confirm row on a corrected door" (`:21-26`).

**Building fan-out** (`:45-59`).
- **The sibling set:** same key, same `stackBaseOf`, and needing a vouch (interpolated, or carrying
  `pinSuspect`), whatever the primary's flag. It is the move fan-out's address rule, so a building confirm
  vouches exactly the units of that address on that spot.
- **Direction stays per door, as today:** confirm skips stamped doors; undo skips unstamped ones.
- **Undo** additionally touches only siblings whose `locationConfirmedAt` equals the primary's stamp. The
  confirm writes one `now` for every target, so a building Undo restores every unit it confirmed, and a
  sibling vouched separately stays vouched.
- Interpolated strays from a `street_center` collapse have a different address, so a building confirm never
  vouches for them.

**`repairImportPins.js`** skips vouched doors (and flagged doors) as repair candidates after its audit load
(§M); the audit's query at `:241-249` is unchanged, so vouched `'file'` doors still count in signal 2's
street cohorts.

## H. Remove apartments and Re-include

**`services/turf/apartmentStacks.js`** owns the rule. Over the effort's active, located doors, a door is
taken when:

1. at least N doors at its spot share its `stackBaseOf`; **or**
2. its address names a unit (`isUnitAddress`) and its spot holds at least N doors.

- N is clamped as today, with `Math.max(2, parseInt(threshold) || 4)`.
- The classifier is not consulted.

**What changes in practice:**
- Strays and separate houses are released.
- A building whose main door is written without a unit is split: its unit-addressed doors stay taken.
- Unit-addressed triplexes on a shared spot of 4+ are still taken.

**Measured at N=4:**

| File | Today | New rule | Released | Real-building homes lost |
|---|---|---|---|---|
| Nye | 61 stacks / 710 homes | 441 homes | 269, every one a house on a placeholder spot | 0 |
| FL-22 | 99 stacks / 659 homes | 493 homes | 166 | 0 |
| FL-22 master file | 17,343 homes in stacks of 4+ | 12,350 homes | 4,993 (4,960 placeholder, 32 strays, 1 other) | 2: marina slips named with a word ("Slip ABC", D5) |
| Tyler | 300 stacks / 8,625 homes | 8,418 homes | 207 (202 placeholder, 4 strays, 1 other) | 0 |

**Endpoints:**

- **`POST …/turfs/exclude-apartments`** (`turfs.js:711-743`) calls the helper. It returns
  `{ excluded, buildings }`, where `buildings` means spots with any taken door.
- **New `GET …/turfs/apartment-preview?passId`.**
  - **What it returns:**
    `{ candidates: { ids: [], takenUpTo: [], spot: [] }, nonApartmentExcluded: { count, homes: [{ id, address }] } }`.
    - The candidates are parallel arrays, so the field names aren't repeated per door.
    - `takenUpTo = max(baseGroupSize, isUnit ? spotSize : 0)`. A door is taken **iff N ≤ takenUpTo**: it is
      the largest N that still takes it.
    - `spot` is an integer index per building key, local to the response.
    - So one response serves every N, and the threshold input never refetches.
    - `nonApartmentExcluded` is computed only when the effort's indexed `excludedFromTurf` count is above 0
      (below). Otherwise it is `{ count: 0, homes: [] }`.
  - **The client** derives "holds out N homes on N spots" for the current N: candidates with
    `takenUpTo ≥ N`, and their distinct `spot`s. The spots must come from the server, because the take
    population includes voted, DNC and do-not-knock doors that `/turfs/doors` never sends
    (`turfs.js:1145-1150`).
  - "M of them are in this cut" intersects with the page's target set and the restricted / no-soliciting
    checkboxes, which are page state the server never sees before Generate. On an untargeted round it also
    leaves out the candidates in the restricted-door-ids list under the gate Generate uses,
    `excludeRestricted && restrictedDoorCount > 0` (`TurfsPage.jsx:2097`); a targeted round's set already
    excludes them, because target-preview applies `cutExclusionFilter` (`turfs.js:818-835`).
  - **Size:** the per-object shape `{ id, takenUpTo, spot }` measured 1.3–2.8 MB of JSON at 250k doors; the
    parallel arrays save the repeated names. §Q.11 measures the final shape.
  - **Why a GET:** on archived campaigns only POSTs ending `-preview` are allowed (`turfs.js:101`), and
    read-only orgs get 402 on other POSTs.
  - **When it loads:** before publish (the threshold block), and on any round whose
    `excludedApartmentCount > 0` (the Re-include line). It is never part of `GET …/turfs`, which runs on every
    Turf page load, every PassManager pass (`PassManager.jsx:124-128`) and the phone's admin Books
    (`books.jsx:193-197`).
  - **Its query key** is `['apartment-preview', cid, passId]`, outside the `['turfs', cid]` prefix that
    `invalidateCut` (`TurfsPage.jsx:1579-1582`) and every single-home restrict (`:1589-1590`) refetch. A
    restrict can't change which doors are taken (`takenUpTo` and `spot`); what a restrict does change, the
    restricted list, lives in the small query below.
    - It is invalidated by exclude, include and include-non-apartments, and by every pin move: the plan adds
      `['apartment-preview', campaignId]` to `movePinInvalidationKeys` (`movePin.js:53-61`), which
      `useMovePin` applies for Turf Cutting, Pin Fixes and the Map page alike (`useMovePin.js:102`), and
      updates `movePin.test.js`'s exact-list assertion (`:63-76`). A pin move can change a door's spot and so
      its `takenUpTo`. Only an open Turf Cutting page pays for the refetch.
    - After an import it is simply refetched when Turf Cutting mounts: the client sets no `staleTime`
      (`main.jsx:21-25`).
- **New `GET …/turfs/restricted-door-ids?passId`** returns `{ ids: [] }`: `restrictedDoorIdsForEffort` for the
  round's effort (one call, bounded by restricted rows). These are homes restricted in a live round, which the
  cut drops under Exclude restricted even when their global status is a sticky "surveyed". It is its own small
  query, not part of the preview, because a restrict changes it: a desk restrict on the round being cut inserts
  a `'restricted'` row (`deskRestrict.js:145-152`) while the door's global status can stay "surveyed"
  (`generateTurf.js:65-70`). Its query key, `['turfs', cid, 'restricted-door-ids', passId]`, sits under the
  prefix that `invalidateCut` and every restrict and Unmark already refetch (`TurfsPage.jsx:1579-1600`), so a
  click refreshes this small list and never re-streams the preview's candidate arrays.
- **`nonApartmentExcluded` and its addresses** come from a lean cursor over the effort's `excludedFromTurf`
  doors. The rule is: those whose address names no unit, and whose `stackBaseOf` belongs to **no other active
  door in the campaign**, in any effort and at any spot.
  - A unit moved alone by hand, or claimed into another effort, still shares its address, so it stays held
    out.
  - Measured: 267 Nye houses, 166 FL-22 i360 houses and 4,967 houses in FL-22's master file would be lifted.
    The only real-building units among them are the master file's 2 word-named marina slips (D5).
- **New `POST …/turfs/include-non-apartments?passId`.** It lifts exactly that set, re-checking
  `excludedFromTurf: true` in its filter. It leaves the `Household.turfId` mirror alone.
  - It returns `{ lifted, inThisRound }`. `inThisRound` counts the lifted doors under this round's
    `supplementalDoorFilter`, so on a targeted round the confirmation can say how many match (Screens 6).
    Houses nobody knocked rarely match a "Not home" or answer-based target; they are cut into the next
    untargeted round.
- **"N doors not in any book" counts what "Add as new book" adds.**
  - **The bug today:** `GET …/turfs` counts `turfId: null` (`turfs.js:668-674`), while `addSupplementalBooks`
    selects the doors that none of this pass's own non-archived books holds (`generateTurf.js:340-357`).
    - The mirror follows the latest cut anywhere in the campaign. Nothing resets it for doors a later round
      leaves out: cuts write only their own members (`generateTurf.js:313`, `:417`, `:448`), and
      activating or archiving a round changes only the Pass (`passes.js:149-154`, `:164-191`).
    - So a house booked in round 1, held out before round 2 and re-included on published round 2 keeps
      its round-1 `turfId`. The count reads 0, the line and its button never render, and Generate is 409 on
      a published round. Yet the job would book it. A sift replay with the real `KNOCKABLE_DOOR_FILTER`
      reproduced this.
  - **The fix is one owner.** `supplementalDoorFilter({ campaign, pass, bookedIds })` is extracted from
    `addSupplementalBooks`, and both callers use it:
    - effort, knockable and located;
    - `_id: { $nin: bookedIds }`, where `bookedIds` is this pass's non-archived books' `householdIds`
      (the route already has those books loaded);
    - on a targeted round, `_id: { $in: target ids minus booked }`, composed as `generateTurf.js:376-381`
      already does, so neither condition overwrites the other.
    - The job then adds its `cutExclusionFilter`, as today.
  - **The exclusion slices must match what the job drops.** With Exclude restricted, `cutExclusionFilter`
    drops global `status: 'restricted'` **and** `restrictedDoorIdsForEffort`: doors whose newest restricted row
    is in a live round, even when their global status is a sticky "surveyed" (`generateTurf.js:65-128`).
    - Under today's `turfId: null` count those doors never showed, because their mirror still pointed at an
      earlier round's book. Under the new filter they would, and the count would read 1 while the button
      adds 0 ("No eligible doors to add") — or, once the restricting round is archived, add a locked gate the
      cut left out on purpose.
    - So the route calls `restrictedDoorIdsForEffort` (bounded by restricted rows) and runs one aggregate on
      the filter, grouped by `status` and by membership in those ids. It returns:
      - the total;
      - `supplementalRestrictedCount`: `status: 'restricted'` or an id in the set;
      - `supplementalNoSolicitingCount`: `status: 'no_soliciting'` and not in the set;
      - `supplementalNoSolicitingRestrictedCount`: `status: 'no_soliciting'` and in the set.
    - **The client** (`TurfsPage.jsx:1546-1551`) subtracts under the same gates the button sends
      (`:2389`): with `r = excludeRestricted && restrictedDoorCount > 0` and
      `n = excludeNoSoliciting && noSolicitingDoorCount > 0`, shown = total − (r ? restricted : 0) −
      (n ? noSoliciting : 0) − (n && !r ? noSolicitingRestricted : 0).
  - Clearing a stale `turfId` instead would not be harmless: `claimDoors.js:91-93` counts `lostByTurf` from it.

**UI:**
- **"N of them are separate houses … Re-include those"** renders whenever `excludedApartmentCount > 0`, on
  any round. Lifted houses then appear under "N doors not in any book · Add as new book" (`TurfsPage.jsx:3392-3406`),
  whose note is reworded for them (Screens 6).
- **Today's lift-everything Re-include** stays pre-publish only, so real apartments are never pushed into a
  live round.
- **The emptied-round case:** the threshold block renders when `passId && publishedCount === 0 && (!hasNoDoors || excludedApartmentCount > 0)`,
  and the empty-round banners say the doors are held out as apartments.

**Packets.**
- `isApartment` becomes `isUnitAddress` (D5).
- `buildPacket.js`' omitted count is fixed on the way. The suppression list is derived from the knockable
  read only, so a door skipped as an apartment is never also counted as "other" (`:246-261`, `:340`).

## I. Pin Fixes and the queue

- **`NEEDS_PIN_FIX` stays.**
- **New `UNPLACED_PIN`:** `{ isActive: true, pinSuspect: { $type: 'string' }, locationConfirmedAt: null, coordConfidence: { $ne: 'interpolated' } }`.
  It is disjoint from `NEEDS_PIN_FIX` by construction.
- **`listPinsToFix` / `countPinsToFix`** run two queries and merge them; there is no `$or`.
  - `pinsToFix` (`services/reports/campaignSummaries.js:27, 112, 142`) becomes the sum of two aggregates.
  - Both plans are asserted with `explain()`.
- **List route** (`campaignHouseholds.js:80-123`): both sets. The cap applies to the sum, and
  `effectivePinSuspect` is projected. So is `estimatedPlacement: true` for a door where
  `isEstimatedPlacement(h)` holds, which needs `pinPlacement.by`, `releasedAt` and `accuracyType` in the
  projection; `/pin-fixes` carries no placement fields today (`:95`).
- **`pinFixes.js` `buildStreetGroups`.**
  - **Rows are the confirm fan-out's own set,** with the web mirror: doors needing a fix, grouped by (key,
    `stackBaseOf`).
    - A group of two or more is a building row ("N units at <address>") with `scope: 'building'`, whether
      its units are interpolated or flagged.
    - A group of one is a `door` row with `scope: 'unit'`.
    - Separate homes on one spot therefore get a row each, and one address's units share a row, so Move pin
      and Looks right act on exactly the set the server's fan-outs act on.
  - A new `keyToRowKey` maps a clicked spot to its first row.
- **The keyboard** (`PinFixesPage.jsx:515-546`).
  - A pure `enterAction(row)` returns `'confirm'` only for a row whose doors are neither unplaced now nor an
    unchecked street-level placement (`estimatedPlacement`), and null otherwise. Auto-advance would otherwise
    vouch a whole spot, or end D3b for a whole list, one keystroke per row. The second case is the owner's
    decision of 2026-10-05.
  - The handler dispatches through a pure `popupKeyAction(key, row)` in `pinFixes.js`, which calls
    `enterAction`, and the footer hint (`:137`) comes from a pure `popupHint(row)`, which drops "Enter
    confirm" on those rows. Both are tested directly, because the render smoke harness can't reach them:
    it renders with `renderToString`, so effects never attach the key listener, and the popup renders only
    after a map selection (`:695`).
- **Looks right on an unplaced row** opens a one-line confirmation: "This home's map spot was shared with
  other addresses. Confirm the home is really here?" It names no count: the page loads only the queue, so a
  stray's building units and a spot's vouched homes aren't in it to be counted. It then sends
  `expectedCoordinates` (§G).
- **A no-op or a refusal.**
  - When the move answers `moved: 0` or `unchanged`, the page toasts "Nothing moved — drag the pin onto the
    house", keeps the card armed and skips `advanceAfterAction`. Today `movePinToast` says "Pin moved."
    whatever `moved` is (`movePin.js:64-65`).
  - `confirmErrorMessage` checks `code === 'PIN_CHANGED'` before its bare-409 branch (`pinFixes.js:110-117`),
    and keeps "This campaign is archived" for `campaign-archived` and `campaign-deleting` only. On
    `PIN_CHANGED`, and on today's 400 `NOT_APPROXIMATE`, the page refetches the list; today's catch path
    never refetches (`PinFixesPage.jsx:482-484`), and window-focus refetch is off.
- **Copy:** as in Screens 5. `Layout.jsx:142` changes to "pins to fix". Only the comment at `BottomNav.jsx:64`
  changes.

## J. Web clients

**Server payloads** are additive, and each field is emitted only when set. Each route below sets its
outgoing `pinSuspect` to `effectivePinSuspect(h)`, leaving it out when that is null, so a vouched home never
reaches a client flagged. The routes:
- `routes/admin/households.js:475` and its mapper near `:648`;
- `routes/admin/turfs.js:1165-1166` and `:1207-1229`;
- the household drill (`:1261-1282`);
- `routes/admin/campaignHouseholds.js:95, :102-115`.

The placement fields (`pinPlacement.at`, `accuracyType`, `stackSize`, and "is currently placed") go on the
drill and on `/households/map` only.

**The ping panels' data.**
- `/households/map` activities gain `knockPin` and `knockPinAt` in the projection (`households.js:540-546`)
  and in the mapper (`:655-671`).
- So does the activity detail (`routes/admin/activities.js:50-61`).
- Without these, both ping panels keep the red "— far".

**Grouping kind, the one rule on web and mobile:**
- A coordinate group is **`unplaced`** when any member is `'placeholder'`, or when no member is free of
  `pinSuspect`.
- Otherwise it is a **`building`**.
- Strays stay in `units`, `total` and `stackedIds`. Labels keep counting `total` and `done` over every door,
  so the roll-ups stay whole.
- The building screen separates strays into "Not part of this building".
- A building's header address and header Directions come from its **first non-stray member**.

**Files:**

- **`client/src/lib/buildings.js`.**
  - `groupHouseholds` gains `kind` and `strays`.
  - **`buildingMovePrimary(units)`** returns the first member whose `stackBaseOf` is the group's majority
    base. When no base holds more than half, Move building pin isn't offered.
    - The card counts that address's units in this page's door payload. The server moves every active door
      in the campaign at that key and address, voted and do-not-knock doors included, so the two can
      differ. The toast reports the server's `moved`, as today (`movePin.js:64-67`).
  - **`addressGroups(units)`** (new) groups an unplaced spot's members by `stackBaseOf`, for display on every
    surface. On Turf Cutting, whose door payload is the cut's doors, a group of two or more also gets "Move
    these N units", which sends `scope: 'building'` with any member as the primary. Its Save gate is the
    group's: it stays off near the spot while any unit in the group is unplaced, so a flagged unit can't be
    carried along by an unflagged primary (§G's building no-op is the server's backstop). The Map page doesn't
    offer the group button: its payload is date-filtered, so it asks per door instead (below).
  - `buildingLabel` gains "N homes".
- **`client/src/lib/mapRender.js`.**
  - `householdsToGeoJSON` (`:178-203`) adds `pinSuspect: h.pinSuspect || ''`.
  - `buildingsToGeoJSON` adds `unplaced`.
  - `registerLayers` gains the canvas images `unplaced-{none,partial,done}`.
  - `building-symbols` keeps its id. Its `icon-image` becomes a `case` on `to-boolean(get unplaced)`, and so
    does its `text-field` (`:472`): "N homes" for an unplaced group, "N doors" otherwise, with the zoom step
    kept. MapPage, Pin Fixes and `AnswerMiniMap` all draw from this layer.
  - The ring filter becomes
    `['all', ['any', ['all', ['==',['get','coordConfidence'],'interpolated'], ['!',['to-boolean',['get','locationConfirmed']]]], ['to-boolean',['get','pinSuspect']]], ['!=',['get','stacked'],true]]`.
- **`client/src/pages/MapPage.jsx`: two panel sources.**
  - **`stackKey`:** a glyph click, or the selected door's building. When the key is missing, reuse cached
    doors only if they left the payload, and drop any that moved; close below 2.
  - **`stackIds`:** a multi-hit on overlapping houses at different keys. It keeps today's `lastStackRef`
    guard.
  - **The Back bar restores whichever source opened the list.**
    - With `stackIds` set, it keeps them and clears `selected`, as today (`:1672-1683`). A multi-hit is single
      doors at different keys, so a key-based Back would find no group and close, losing the other house.
    - Otherwise it sets `stackKey` to the selected door's building key.
    - Its copy reads "Back to all N doors near here" for the multi-hit source, and today's "at this pin"
      otherwise.
  - Both sources go through the pure `stackDoors` helper.
  - The header pill counts buildings and "N homes without an exact spot" separately.
- **`client/src/components/DoorStackPanel.jsx`.**
  - The verdict comes from the flag; the inline classifier is deleted.
  - There are three notes: building, homes, and the multi-hit "N doors near here — pick one".
  - Unplaced rows show line 1 plus line 2, and one address's units sit together under `addressGroups`.
- **The Map page's Move pin on a single door** runs from that door's panel (`HouseholdDetailPanel.jsx`, which
  already loads `/admin/households/:id/activity` at `:506`); a stack row's Move pin selects the door first. It
  reads that route's new `sameAddress` (§G). When `count ≥ 2` it asks "Just this unit" or "Whole building (N
  units)" before arming the card, and sends `scope: 'building'` for the second. The building Save gate uses
  `sameAddress.unplaced`, so it stays off near the spot while any unit of that address is unplaced, even one
  the date filter hides. The toast after a building move reports the server's `moved`, as today.
- **Badge chain** on every site: `HouseholdDetailPanel.jsx:600-613`, Turf `HousePopup` (`TurfsPage.jsx:1082-1100`),
  the phone door screen and the phone admin map (§K). The first that applies wins:
  1. "No exact map spot": unplaced now, piles included;
  2. "Location confirmed": any door with `locationConfirmedAt`, including a confirmed home on a shared spot
     and a confirmed pile;
  3. "Pin corrected";
  4. "Approximate location".
  - The panel line, not a badge: "Placed by address (date)…" while the pin is currently placed by the
    lookup, or "The address lookup confirms this spot (date)" when it was placed in place.
- **`client/src/pages/TurfsPage.jsx`.**
  - `groupDoors` carries the kind.
  - **Markers:** a pure `markerLabel({ kind, count, badgeText })` in `buildingMarkers.js` feeds both the
    element and `markerSig`.
  - **The unplaced `BuildingPopup`** follows Screens 6. Its rows call the existing
    `onRestrict([u.id])` / `onUnrestrict([u.id])`, and its address groups get "Move these N units".
  - **"Move building pin"** uses `buildingMovePrimary`.
  - **Remove apartments** moves to the GET, and the Re-include line is added.
  - **The "not in any book" note** is reworded (Screens 6; `:3397-3398`).
- **Web Move pin** (`useMovePin.js`, `MovePinCard.jsx`).
  - On an unplaced target, Save stays disabled until the dragged point is more than 1.5 m from the spot.
    Mapbox starts a marker drag only past its 3 px click tolerance, about 1.45 m at Pin Fixes' zoom 17 in
    Pahrump, so a minimal nudge would otherwise enable Save and no-op.
  - Every caller treats `moved: 0` or `unchanged` as "Nothing moved — drag the pin onto the house" and keeps
    the card armed.
- **`client/src/components/CanvasserPingPanel.jsx`** (`:35-36`, `:85-86`): the distance label branches on
  `knockPin`.
- **`client/src/components/AnswerMiniMap.jsx`.**
  - `:89-98` reads all hits.
  - The `DoorCard` reads "N homes at one map spot" for unplaced groups.
- **`client/src/pages/ImportPage.jsx`:** preview copy, summary line, `STATUS_LABEL.pins`, `StatusBadge`.
  - **The list keeps polling for a queued follow-up.** Today it polls every 1.5 s only while some job's status
    is active (`:35`, `:529-536`), window-focus refetch is off (`main.jsx:23`), and a busy import is already
    "completed" while its follow-up waits. A pure `importsPollInterval(jobs, now)` in `client/src/lib` returns
    1500 while any job is active, 15000 while any job has `pinFollowUp.status === 'queued'` with
    `pinFollowUp.at` less than 40 minutes old (the follow-up's 30 retries plus a margin), and `false`
    otherwise. That way "placing by address shortly" turns into the real counts, or "weren't checked", on an
    open page, and a follow-up stuck past its window (the nightly sweep re-runs it, §F) doesn't keep an open
    page polling for good.
- **`server/src/routes/superAdmin/imports.js` + `client/src/pages/SuperAdminImportsPage.jsx`.**
  - `shape()`, `GROUP_SUMS`, `shapeGroup` and the default totals gain `pinLookupsNew/Cached/OverCap`,
    `pinPassError` and `pinPassCause`.
  - The list query (`superAdmin/imports.js:144-158`, up to 500 jobs) projects `pinProbedIds` out. `shape()`
    never returns it.
  - `costCents = geocodeCostCents(geocodedNew + pinLookupsNew)`, and `sort=cost` becomes an aggregate on the
    sum.
  - CSV columns are added.
  - **Row badges:** one for over-ceiling, one for a failed pin pass and one for a queued or abandoned
    follow-up. Each carries the recovery commands from §F.
  - The list query also projects `pinPendingIds` out.
  - **Copy:** "with coordinates = free" gains "unless the file put them on a shared spot". The page says
    console-script lookups are printed by the script, not shown here.
- **Unchanged:**
  - `ClientReportMap`: a per-door snapshot, with stacks summarised as a tally.
  - `cutMapDoors.js` and `lassoSelect.js`.

## K. Mobile (over the air)

**Server.** One shared `HOUSEHOLD_PIN_PROJECTION` (`location coordSource coordConfidence locationConfirmedAt pinSuspect`)
is used by both the bootstrap (`:306-320`) and `/mobile/changes` (`:471-484`).
- **Neither route has a household mapper.** The bootstrap sends its lean docs after an in-place per-round
  loop (`:332-354`, sent at `:421`). `/changes` returns `households: changedHouseholds` (`:550`), and its loop
  (`:489-499`) touches only doors with a per-round entry.
- **So the step is named:** in the bootstrap's per-door loop, and in a `/changes` loop over **every** changed
  door, set `h.pinSuspect = effectivePinSuspect(h)`, deleting the field when that is null. Otherwise the raw
  flag would ship, and a home the organization vouched would keep reading "No exact map spot" on phones.

**App.**

- **`mobile/lib/buildings.js`**
  - It applies the §J kind and strays rule, with the header taken from the first non-stray member.
  - Roll-ups are guarded against an empty unit list.
  - New `mobile/lib/buildings.test.js`. (There is no phone caller for `buildingMovePrimary`: "Whole building"
    runs from the door's own Fix pin.)
- **New `mobile/lib/streetName.js`:** the `stackBaseOf` mirror, used by `siblingCount`.
- **New pure `buildListEntries` in `mobile/lib/`.**
  - Distance is null, and the entry goes in the "No exact map spot" section, only for a single entry whose own
    door is unplaced, or a group of kind `unplaced`. A `building` entry keeps its distance.
  - **An unplaced group's entry is marked as such.** Today `map.jsx:747-756` sends every group through
    `DoorListRow`'s building branch, titled with one member's `addressLine1` and reading "{total} units ·
    {done} done" (`DoorListRow.jsx:19`, `:23`). That is the "10-unit building" the report is about.
    - `DoorListRow` gets an unplaced-group branch: title "N homes at one map spot", meta "N homes · M done",
      no distance.
    - The Address sort compares each entry's whole line with numeric `localeCompare` (`map.jsx:766-768`), so
      it runs house-number-first across streets. The group's sort key is therefore its lowest member's house
      number plus that member's street ("4906 E Monte Penne Way"), the same shape as every other entry, so it
      files among the numbered homes. A street-only key would sort after every numbered entry.
  - The section header is a `section` entry kind, handled first in `DoorListRow.jsx` (`:13-51`).
  - Tested on: a building plus a stray, an unplaced group (its title, meta and sort key), a lone stray, and a
    strays-only group.
- **New pure `foldDeltaHouseholds(prev, delta)`, added to the existing `lib/deltaFold.js`** (which already
  holds `foldDeltaVoters` and `changesPath`).
  - It folds status, `lastActionAt`, `restrictedFrom`, `locationConfirmedAt`, `pinSuspect` (`?? null`) and
    the location trio.
  - **It keeps today's drop:** a delta door with `isActive` false, or `fullyVoted`, `fullyDnc` or
    `doNotKnock` true, is left out of the result (`map.jsx:574-582`, then `filter(Boolean)` at `:597`). That is
    how a door suppressed mid-shift, say a do-not-contact request, leaves running phones before their next
    bootstrap.
  - It imports nothing outside `mobile/lib`.
  - The reconcile wrappers stay in `map.jsx`.
  - It ships together with the two projections.
- **`app/(app)/map.jsx`:**
  - the unplaced PNGs in `Mapbox.Images`;
  - the layer matches on kind;
  - the label reads "N homes · N done";
  - the list view uses `buildListEntries`;
  - the camera fit skips unplaced doors.
- **`app/(app)/building.jsx`: the unplaced variant from Screens 7.**
  - per-row `DirectionsButton`;
  - sorted by street, then house number;
  - no header Directions;
  - for real buildings, a "Not part of this building" section, with the header from the first non-stray
    member.
- **`app/(app)/household/[id].jsx`:**
  - the full badge chain (§J), with "No exact map spot" first, so a pile door doesn't read "Pin corrected";
  - an explainer card;
  - `siblingCount` counts same-key, same-`stackBaseOf` siblings, whatever their flags, matching the server's
    fan-out. So an unplaced unit with same-address siblings gets the "Just this unit / Whole building"
    question, and a lone home on a shared spot gets none.
- **`components/FixPinModal.jsx`.**
  - For every door: `coords`, `source` and `accuracy` reset each time `visible` turns true. The modal stays
    mounted (`household/[id].jsx:363`), so today it keeps whatever it seeded at mount.
  - **Only when the door, or a same-address sibling on its key, is unplaced now** (the payload's
    `pinSuspect`; `siblingCount` already loads the siblings):
    - the modal opens on the spot, and moves the pin and camera to the lead's GPS fix (shown, not counted as
      placed) when one arrives, but only while `source` is still null and the fix is within 500 m of the
      spot. The household screen has no live location stream, so the seed comes from `getCurrentLocation`,
      which can take up to 6 s (`location.js:190-212`). A ref and an ignore flag, cleared in the effect's
      cleanup, drop a fix that lands after a drag, after "Use my current location", or after the modal
      closes. A late seed would otherwise overwrite a dragged pin while `source` stays `'drag'`, and save the
      lead's own position as hand-corrected. A lead working far away isn't dropped at their own location;
    - Save is enabled only when `source` is set, by a drag or by "Use my current location", **and** the point
      is more than 1.5 m from the spot. A GPS fix on the spot itself keeps Save off with "You're at this
      home's map spot. If the home really is here, mark it Looks right in Pin Fixes."
  - **Every other door** keeps today's behavior: it opens on the door's pin (`:21`, `:86`, `:100`), and Save
    works without a drag (`:145`). Nudging an approximate pin is the common case.
  - **"Nothing moved" after an online save.** The modal keeps the promise `recordLocationCorrection` returns
    (today it discards it, `:46-55`). That promise resolves to the offline queue's `{ ok, queued, response }`
    (`offlineQueue.js:186-189`). When `ok && response.moved === 0`, the modal, which stays mounted
    (`household/[id].jsx:363`), shows an alert: "Nothing moved — the pin is still on its old spot." A queued
    save stays silent, as Compatibility discloses.
  - The remaining prompt uses `androidAlertOrder`.
- **`lib/recordAction.js`.**
  - The optimistic layer clears `pinSuspect` and sets `locationConfirmedAt: null`, as the server's real move
    does (`updateHouseholdLocation.js:71-72`). Without that, the new badge order (§J: "Location confirmed"
    above "Pin corrected") would show "Location confirmed" on a vouched pin the lead just moved: nothing else
    refetches the door screen, and the `/changes` fold that would fix it is paused while the door screen
    covers the map (`useFocusedPoll.js:16-19`, `map.jsx:543`).
  - **The reconcile is a pure helper,** `reconcileLocationResponse(prev, householdId, response)`, added to
    `lib/deltaFold.js`, which node already loads in the mobile tests; `recordAction.js` itself can't be
    imported there (it pulls in react-native, expo-location and the cache, `:1-7`; `locationGate.test.js:158-162`
    says so). It returns the patched bootstrap, taking `location`, `coordSource`, `coordConfidence`,
    `pinSuspect` and `locationConfirmedAt` from the response in every case: a real move keeps the null stamp,
    and `moved: 0`, where the server changed nothing, restores the whole trio, the flag and the stamp. It writes
    them directly, not through `setHouseholdLocation`, which forces `coordConfidence: null` (`:39-47`) and would
    drop an "Approximate location" badge until the next full bootstrap. `recordLocationCorrection` calls it, and
    on `moved: 0` also clears the pending location (that side effect stays in `recordAction.js`).
- **`app/(app)/admin/map.jsx`.**
  - Hits are deduplicated and grouped by key, and a chooser opens only for a group of 2+ at the tap. The
    chooser lists members under their address by the mobile `stackBaseOf` mirror (`addressLine1` is already in
    the payload, `:1954`).
  - **Moving an address's units together takes its size from the server, not the payload.** The map opens on
    Today (`:332-336`), and `/households/map` then sends only the doors knocked in that window
    (`households.js:320-335`), so a payload-built group would miss the address's other units, and a flagged
    address with one unit knocked today would get no group at all. The sheet already loads
    `/admin/households/:id/activity` for the selected door (`:378`); its new `sameAddress` (§G) drives the move
    bar: with `count ≥ 2`, Move pin asks "Just this unit" or "Whole building (N units)" (the button order from
    `androidAlertOrder`), as `FixPinModal` does, and the second PATCHes `scope: 'building'`. Today the bar sends
    no scope (`:985-992`), so the server treats every move as one unit, and fixing a flagged 23-unit address
    there would split it across 23 keys.
  - `householdsToFeatures` adds `pinSuspect`, and the ring gets the `to-boolean` term.
  - The badge chain is the full one.
  - The ping sheet (`:2300-2363`) branches its distance label on `knockPin`.
  - **The move bar is the third caller of the location endpoint** (`:983-992`, beside `useMovePin.js:96` and
    `recordAction.js:542`).
    - `enterMoveMode` centres the camera on the door's own pin (`:1097-1112`), and `saveMovedPin` posts the
      map centre (`:1115-1125`).
    - For a target that is unplaced now, or a building move whose `sameAddress.unplaced` is true, Save location
      compares the centre with the door's spot. Within 1.5 m it shows "Nothing moved — drag the map so the
      crosshair sits on the house" and posts nothing.
    - `onSuccess` keeps the bar open with the same note when `moved` is 0. After a building move it shows the
      server's count, "Moved N units", before closing; today it closes silently whatever moved.
- **Audit renderers:**
  - `components/FlaggedEntryCard.jsx` and `components/ActivityRow.jsx`;
  - the tiles at `admin/canvasser/[id]/quality.jsx:118-134` and `index.jsx:550-560`;
  - `quality.jsx:173`, where "forgiven = pin corrected later" becomes "forgiven = the pin was moved later,
    or was a shared spot".
- **`scripts/genMarkerIcons.js`:** a name filter. In a scratch run, adding the PNGs left both fingerprint
  hashes unchanged.

**Compatibility.**
- Old apps ignore the field, so there is no `CLIENT_API_VERSION` bump.
- "Whole building", the Save-on-spot and a stale save onto the spot a placed home left are made safe by the
  server (§G). Old apps' admin move bar closes silently on a no-op, which is safe on the server.
- **Display limits, data safe:**
  - **An old app's on-spot save** shows "Pin corrected" until the next full bootstrap.
  - **An old app's stale save** (the home was placed at P after the modal opened, and the modal sends the
    shared spot S) shows the placed home back on S, as corrected. The old reconcile writes P as
    "corrected" (`recordAction.js:546-552`), then the pending overlay still holding S is re-applied to every
    delta fold for its 5-minute TTL (`:149-166`; `map.jsx:569-571`), and after that the cache keeps S. It
    lasts until a full bootstrap more than 5 minutes after the save, or the door's next change on the server.
  - **The offline queue drops replay responses** (`offlineQueue.js:97-103`), so a queued fix that the server
    no-ops is never reconciled, on any app version: the pending overlay lasts its TTL, and the optimistic
    patch until the next full bootstrap, because a no-op moves no `updatedAt`.
  - **A new app** sends a no-op only by moving a placed home back onto the spot it left, the one move the
    server refuses; its Save gate (drag and GPS alike) stops every other one before it is sent.
- The generic "forgiven" count explains the tile drop on old phones.

## L. GPS audit

**Inputs.** `FAR_ROW_FIELDS` (`userId householdId timestamp location distanceFromHouseMeters replaced knockPin knockPinAt`)
builds both CanvassActivity scans:
- `detectFlags` (`flagDetection.js:37-40`);
- `computeFarKpi` (`farKpi.js:65-68`).

The list annotations at `reports.js:4061` and `:4498` read the **verdict**, never the raw field.

**Far** (`farAssessment`) reads only the row:

```js
// inside `if (farSev)` — downgrade only, never upgrade or suppress:
if (row.knockPin) { farSev = 'low'; detail.pinUnplaced = row.knockPin; detail.knockPinAt = row.knockPinAt; }
```

- **There is no live derivation from household fields,** which was the root of four round-1 findings.
  - A stamp is only ever added, at knock time or by the freeze.
  - So once a knock is known to have been measured against a shared spot or an unchecked estimate, it stays
    low forever. Nothing else can lower a flag.
- **Three consequences, disclosed in D3, D3b and D7:**
  - Marking runs before any lookup, so the one home really at a shared spot is marked like the rest. Its
    knocks from before placement are stamped and read low, from any distance, permanently. Its rows after an
    in-place placement are never stamped (§E step 8), so they keep their real Far.
  - A vouch (Looks right) ends knock-time stamping for that home. Its later knocks are judged at full Far
    against the vouched spot.
  - The same goes for a street-level placement: a confirm (the button; Enter does nothing there) or a save
    that leaves the pin where it was ends `estimated` stamping, and later knocks are judged at full Far
    against the estimate.
    Today neither action changes Far, because approximate pins are never forgiven
    (`flagDetection.js:312`).
- **The counts.**
  - `farKpiForRows` counts `detail.pinUnplaced` into `farForgivenByPinCount`.
  - The list annotations set `pinForgiven` and `pinUnplaced`.
- **Copy branches on the kind:** "shared spot" versus "street-level estimate" (Screens 9).
  - **Helpers:** `isPlaceholderPin` / `placeholderPinText` in both `flags.js` mirrors.
  - **Branches:** in `FlaggedEntryList.jsx` (after `:108`), `FlaggedEntryCard.jsx` (after `:114`) and
    `FlaggedEntryPanel.jsx` (`:93-129`, with the distance relabelled).
  - **Elsewhere:** `reasonDetailText`'s far case, the legends in both mirrors (`:39-42`), the phone
    `ActivityRow` badge, and both ping panels.
- **Raw by design,** with their raw numbers kept, as `AUDIT.md` records: the `flaggedOnly` superset, the
  histogram, average distance, `/path` and the CSV exports.

**Review cue.**
- `pinStatusChangedAfterReview(entry) = detail.knockPinAt > review.reviewedAt`. Both are server times.
- Copy: "Reviewed before this pin was found to be a shared map spot", on the web panel, the web list and the
  mobile card.
- FlagReview is never written.

**One spot** (`detectOneSpot`): today's rule, current pins and all.
- **The one change:** doors whose row in the cluster carries `knockPin` (either kind) are left out of the
  spread (`housePinSpread`).
- **Monotone.** Leaving doors out can only lower the spread, so the rule can only remove flags compared
  with today. With fewer than two pins left, the cluster cannot fire.
- **Rows stay in the cluster.** Leaving rows out of the cluster instead created flags in a round-1
  simulation.
- **What this fixes:**
  - **W2:** an honest canvasser stood at a shared spot, and the pins were later spread out.
  - **M1:** rowhouse knocks next to a door whose shared spot is far away.
- **Why `estimated` is left out too:** an unchecked estimate can be off by up to the calibrated ceiling, and
  that would spread an honest rowhouse cluster. The cost is disclosed in D3/D3b.
- **Verified with the real `computeReasons`:**
  - The W2 case reads medium today and clear under this rule.
  - A rejected alternative judged clusters at the pins as they stood at the first knock. It flagged an honest
    canvasser (5 rows, medium) whose building a lead later corrected onto one spot, a case that is clear
    today. That is why this plan keeps the live rule.

**The stored input, said plainly.**
- `AUDIT.md` today says flags are derived and nothing about them is stored (`:248-252`, and the invariant at
  `:612-615`).
- This plan adds one stored, downgrade-only, never-unset input, `knockPin` / `knockPinAt`. It has two
  writers: the knock route and the pass's freeze.
- Flags are still computed live.

**Sequencing with [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md)** (unbuilt).
- It edits the same projection and Far arithmetic, and adds a third caller (`/admin/households/map`).
- Whichever lands second rebases, and every caller's row projection comes from `FAR_ROW_FIELDS`.
- Its `pinPrecisionText` gains the "No exact map spot" state.

## M. Backfill (`pins:check`) and the repair script

### `pins:check`

- **Where it lives:** `server/src/migrations/checkStackedPins.js`, registered in `server/package.json` and
  proxied in the root `package.json` as `"pins:check": "npm --prefix server run pins:check --"`.
- **Flags:** `--campaign=<id>`, `--org=<slug>`, `--apply`, `--geocode`, `--max-new=<n>`.
- **Argument validation** copies `repairImportPins.js:102-138`.
- **What each form does:**
  - **Unscoped `--apply`:** marks and freezes. It never moves a pin.
  - **Placement:** only with `--geocode`, which must be scoped (`--campaign` or `--org`; refused otherwise).
    Cached answers are free, and new ones are bought.
  - **`--geocode` without `--apply`:** the calibration and price run. It calls `resolve()`, which buys,
    caches and refreshes `lastUsedAt`; prints the per-candidate report, neighbour estimate included (§E step
    11); and writes no household and no activity row.
  - **No flags:** the read-only dry run (§E step 11).
- **Budget:** `--max-new` (default `PIN_PLACEMENT_MAX_HOMES`) is one budget for the whole run, counted down
  across campaigns. The price is printed before any lookup is bought.
- **Skips:**
  - campaigns with `deletion.requestedAt`;
  - organizations with `deletion.requestedAt`, or with an `OrgDeletionRequest` in `status: 'scheduled'`;
  - for a placement run (`--geocode --apply`) only: campaigns whose lease another placing pass holds
    ("busy"), listed at the end to re-run. Marking never needs the lease.
- **Queued follow-ups.** A placement run holds each campaign's lease, so its `finally` promotes or re-creates
  that campaign's queued follow-ups like any lease holder's (§E). That is also how a follow-up orphaned by a
  rollback gets run (§Q).
- **Spend:** printed per organization at the end.
- **It exits on its own.** A promote opens the shared Redis connection (`getQueue` → `getSharedRedis`,
  `queues/index.js:50-62`), which would keep a console process alive after its work is done; a scratch run of
  `getQueue(...).getJob()` stayed up past 8 s and exited with code 0 only after `closeQueues()`. So the script
  ends with `mongoose.disconnect()`, then `closeQueues()` under the same bounded timeout, then
  `process.exit(0)`. The finished command is run from the repo root, as the dashboard's Run console runs it,
  before it is handed over.

### `repair:import-pins`

- **Gates:** it imports them from `pinTrust.repairPolicy`, its current rules, with one deliberate change to its
  collapse pool (below).
- **It drops signal 3** (stacked pins) and prints a pointer to `pins:check`.
- **It skips doors with `pinSuspect` or `locationConfirmedAt` as repair candidates,** applied after the audit's
  load, not in its query. A door that merely carries `pinPlacement.at` is no longer skipped: after §F's
  vendor-change rows it is an ordinary vendor pin again (`'file'`, no flag), and signals 1, 2, 4 and 5 are the
  only checks a lone vendor coordinate gets. Current lookup placements and person moves are excluded anyway,
  because the audit loads only `coordSource: 'file'` doors (`repairImportPins.js:241-249`).
- **One collapse pool for both of its decisions.** Today one pool,
  `collectBasesByPoint(byId, sus.answers, past.answers)`, decides both adjudicate's collapse test and the
  every-run self-revert (`:536-553`). With signal 3 gone and flagged doors skipped, a flagged or lookup-placed
  door B at another address would leave that pool. Then a repair candidate D whose answer equals B's could be
  repaired onto it on one run and reverted on the next, for ever, each flip writing a row, moving `updatedAt`
  and toggling D's Far downgrade.
  - So the script builds one pool from `sus.answers`, `past.answers` and `peek.answers`, and uses it for
    adjudicate and the self-revert alike. `peek` holds the cached answers of the campaign's flagged and
    lookup-placed doors, read through `peekCache()` (§B).
  - **The pool admits only claims to the point** (`isPointClaim` from `pinTrust.js`, §B): `rooftop` or `point`,
    matched ZIP5 equal to the address ZIP5, in state, the same predicate the pass's collapse gate uses.
    `collectBasesByPoint` counts every answer that has coordinates, whatever its type (`:371-384`), and
    `resolve()` caches a `nearest_rooftop_match`, `range_interpolation` or `street_center` answer as `matched`
    (`geocodeService.js:24`, `:237-243`; a `nearest_rooftop_match` even gets confidence `'exact'`). The pass
    buys an answer for every flagged home and refuses those types, but they stay in the cache, so without the
    filter the peek would feed them to the pool on every later repair run. A flagged neighbour's
    `nearest_rooftop_match` (Geocodio's "nearest roof I know") landing on door A's own rooftop would then
    revert A's correct repair: back to `'file'` with `correctedAt` cleared, which takes away the pin-corrected
    Far downgrade from A's pre-repair knocks, so their false Far flags against honest canvassers come back
    (`flagDetection.js:312`, `:400-414`), and A could never be repaired again while that neighbour stays
    flagged. The filter applies to `sus` and `past` answers as well. Fewer answers in the pool can only mean
    fewer addresses at a point, so it can only remove a revert or a distrust from what today's rule decides,
    never add one, and each one it removes rested on an answer that isn't a claim to that point. It is the one
    change to the script's decisions.
  - **`peekCache()` is `resolve()`'s own cache-read step,** factored into a read-only helper that both share,
    not `forecast()`: `forecast()` returns only counts and skips every household that has coordinates
    (`:271-301`), and every flagged or lookup-placed door has them. The helper takes null-coordinate copies (the
    probe pattern, `repairImportPins.js:330-338`), looks up the full cache key and then the unit-less key
    exactly as `resolve()` does (`:187-192`; a unit served from its building's entry writes no entry of its own),
    projects `location`, `accuracyType`, `confidence` and `matchedAddress`, and returns the probe's answer shape
    (`{ lat, lng, confidence, accuracyType, matchedZip }`). The `lastUsedAt` touch stays in `resolve()` only.
  - The peeked doors are loaded with all five address fields (line 1, line 2, city, state and ZIP: the cache key
    needs them) and merged into the door map passed to `collectBasesByPoint`. Today it skips any answer whose
    door isn't in `byId` (`:375-376`), and lookup-placed doors are never in it. They are never repair
    candidates themselves.
  - **What the peek can't see:** flagged homes nobody has looked up yet have no cache entry. Today
    `repair --geocode` would buy them through signal 3; under the plan they wait for a `pins:check --geocode`
    run. That is a residual, not a regression in what gets repaired.
- **"Spc" changes two of its rules** through `UNIT_SUFFIX` (§D): signal 2's street cohorts and the collapse
  gate's base sets treat park spaces like lots, so spaces sharing one answer are applied, not distrusted,
  and an earlier repair of one is judged the same way.
- **A collapse revert stamps its own evidence first.** In the revert loop, before `doc.save()`, a door reverted
  for the collapse reason ("N different addresses get this identical spot") has its repaired-period rows
  stamped through `freezeRows` (§E step 8): the rows from the repair row's time to now + grace that prove
  against the repair row's `to`. By the plan's own reasoning, two addresses claiming one answer make it a shared
  spot, and the claims-only pool makes sure two real claims are behind it. A dry run counts them through the
  same helper and writes nothing. Stamping before the save makes the evidence durable: nothing the revert
  writes would let a later pass re-derive it (§E step 8).
- **After its revert loop,** for each campaign that had reverts, it runs
  `placeStackedPins({ campaignId, mode: 'check', dryRun: !APPLY, overrides })` without `--geocode`, so it marks
  and freezes only, and never waits for the lease (§C). Each campaign's call is wrapped in its own `try`/`catch`,
  so one campaign's failure is named and the others still run; today a throw there reaches `main().catch` and
  `process.exit(1)` (`:724-727`) and skips the rest.
  - **What a run without `--apply` writes.** The script's header says such a run writes nothing at all
    (`repairImportPins.js:34`, `:91`). That holds for households, activity rows and location history, and the
    post-revert pass must keep it, so it gets `dryRun`: the revert loop runs on every run, skipping only its
    own writes (`:602`), and without `dryRun` a routine preview would write marks, which move `updatedAt` on
    phones, and permanent `knockPin` stamps. It does not hold for the geocode cache: the script's suspect and
    past-repair probes go through `resolve()`, whose sliding-TTL touch writes `lastUsedAt` on every entry read
    before its cache-only return (`geocodeService.js:155-162`, `:203`), dry runs included. That is today's
    behavior, unchanged; the header comment is corrected (§N) and the privacy record lists it (§O, Change 2).
  - **In a dry run, `overrides` carries the planned reverts:** each such door's location becomes its HLC
    `from`, its `coordSource` `'file'`, and it loses its repair departure. So the printed would-mark and
    would-freeze counts include exactly the doors the apply would revert, instead of leaving them out.
- **Unchanged:** signals 1, 4 and 5.

## N. Docs and Help Center cascade

Part 1 of each doc is the source for Help Center copy; Part 2 is never shown to users.

**Shared files.** At build time, run `git status --porcelain -- docs server/src/content/help`. Every cascade
target showing M or ?? carries another session's edits, so it goes into the one frozen patch.
- **Docs, today:** AUDIT, CANVASSER_APP, ADMIN_APP, MAPS, PRIVACY_VERIFICATION, README, GPS_ACCURACY,
  CAMPAIGNS, ROLES, SURVEYS.
- **Help Center, today:** `guides/audit.md`, `guides/canvasser-map.md`, `faq/_INBOX.md` and the two GPS
  FAQs.

| Change | docs/ | Help Center |
|---|---|---|
| Imports place placeholder homes by address | IMPORTS.md 137-143, 169-194, 278-279, 337-341, 376-383, 791-807, 825-831, 859-873 (D2 is a scoped exception to "true rooftop only", gated by calibration), 898-913, 939-981 (the cost formula becomes `(geocodedNew + pinLookupsNew) / 1000 × …`); OPERATIONS.md 707-739 (new `pins:check` rows and the calibration step; the repair rows lose signal 3 and the "--geocode on the FIRST apply" note; the pins-only follow-up job, its super-admin badge, and the rollback note from §Q); PLATFORM.md 170-179 | guides/voter-imports.md 44, 46, 48, 59; pages/page-voter-import.md 20 plus the shared-spot block; faq/import-taking-long.md 16, 20 |
| Unplaced homes are not buildings | MAPS.md 95-137, 196-199, 671-690, 978-1000; CANVASSER_APP.md 142-148, 350-354; LOCK_SCREEN_AND_DIRECTIONS.md 117-120, 347; ADMIN_APP.md 499-501 | guides/maps.md 30-46, 98, 111, 113; pages/page-map.md 14, 22, 26; guides/canvasser-map.md 30, 34 and faq/directions-to-a-house.md 12 (these go with the OTA, step 7) |
| Pin Fixes rows per home and per address; confirm allowed (asks once, never on Enter, re-arms Far) and badged; confirming or saving-in-place a street-level placement re-arms Far (D3b); address-based fan-outs; the stale-save no-op | MAPS.md 339-371, 434-500, 594-604, 943-957, 1104-1116 | pages/page-pin-fixes.md 8-39 (with the intro's new wording: shared-spot homes show as "N homes" markers, and only a lone one has an amber ring), 44 ("Enter confirms" holds only for approximate pins from the import's geocoding; it does nothing on homes without an exact spot or on estimates the lookup placed, and confirming one of those with the button re-arms Far), 68-69; guides/fix-pin-location.md 12-21, 42-48 |
| Remove apartments by street address; Re-include houses on any round (and what a targeted round does with them); restrict one home on an unplaced spot; "not in any book" counts what "Add as new book" adds, live-round restrictions included | PASSES_AND_TURF.md 89-96, 193-200, 277-279, 432-448 and 1056-1088, 524-527, 696-703, 980, 983 (it says the job selects `turfId:null`, which is already stale); MAPS.md 1037-1041 | guides/turf-and-books.md 22, 40, 43; pages/page-turf-cutting.md 35-37, 73-79, 105-106, 130, 167-179, 189; faq/mark-one-home-restricted.md 16 |
| Unit designators (D5) | WALK_PACKETS.md (street bands, Skip apartments) | pages/page-print-packets.md: the new shapes are the list in Part 1 ("Spc", PH, Rear …, "Apt 5 B", "#5 412 Elm St"); hyphen and slash forms ("Apt-B", "Ste/5") are already skipped and must not be announced as new |
| Far / One spot / review cue / the stored input | AUDIT.md 52, 57-59, 70-72, 87-97, 248-252 and 612-615 (the "flags are derived, not stored" invariant gains the one stored input), 305, 309, 327-338, 375-377, 382-436, 484-494, 626-635; METRICS.md 910-911; GPS_ACCURACY.md 95-99, 161-164 | guides/audit.md 19, 21, 24, 46; faq/canvasser-dot-off-will-it-flag.md 18-19; faq/blue-dot-not-where-i-am.md 21 |
| New question | — | "Why are several houses on one dot?" goes to `faq/_INBOX.md` first, per the routine |

Line numbers are those of today's working tree. Edits to files another session has changed are anchored by
quoted text at build time.

**Code comments that become false:**

| File | Lines |
|---|---|
| `stackedPins.js` | 17-34 |
| `csvImporter.js` | 352-360 |
| `geocodeService.js` | 6-9, 37-39 |
| `importProcessor.js` | 163-177 |
| `repairImportPins.js` | 21-67, 34 and 91 ("writes nothing at all": a dry run's probes still refresh `lastUsedAt`, §M), 441-443, 615-617, 710-716 |
| `confirmHouseholdLocation.js` | 5-26 |
| `updateHouseholdLocation.js` | 19-20 |
| `HouseholdLocationChange.js` | 25-30 |
| `Household.js` | 46-53, 147-152 |
| `routes/admin/households.js` | 646-647 |
| `campaignHouseholds.js` | 76-78, 168-171, 180-181, 199-200 |
| `campaignSummaries.js` | 58-63 |
| `PinFixesPage.jsx` | 137, 418-419 |
| `mapRender.js` | 171-173, 489-492 |
| `buildings.js` (web and mobile) | 1-5 |
| `TurfsPage.jsx` | 158-164, 1308-1309, 1540-1545, 1566-1567, 3397-3398, 3814-3815 |
| `turfs.js` | 663-667, 723 |
| `generateTurf.js` | 340-345 (moves with `supplementalDoorFilter`) |
| `movePin.js` | 11; and `movePinInvalidationKeys` (`:53-61`) gains `['apartment-preview', campaignId]` (a code change, with `movePin.test.js:63-76`) |
| `farKpi.js` | 14-17 |

**Drift to fix on the way:**
- `MAPS.md:713` says AnswerMiniMap has no click handler; it has one.
- "Different streets" wording becomes "different addresses".
- `helpLinks.test.js:8-14`: canvasser articles must not link to lead-only articles.

## O. Privacy

**Said out loud, as the repo requires: this change is privacy-affecting.** It changes *when* customer data
goes to an existing subprocessor. Every record edit below is anchored by heading and quoted text, because
the file is being edited by another session.

**Change 1 — addresses that arrived *with* coordinates now go to Geocodio when the file put them on a shared
spot, or on a building's spot with a different address.**
- **When:**
  - automatically at import, for the file's own homes, when `GEOCODE_ENABLED` is on and a key is set,
    including by that import's pins-only follow-up job, which looks up only the same file's still-unplaced
    homes and stops when the import is undone: a queued follow-up is cancelled, a running one stops before
    its next batch of lookups and writes no further pin, and at most the one batch already sent completes
    (§F, Undo);
  - by `pins:check --geocode` (key plus the explicit flag, and a scope).
- **Class:** sharing with the same subprocessor, for the same purpose. The fields are line 1 **as the file
  gave it, including any unit written there**, city, state and ZIP5. Line 2 and names are never sent.
- **Recorded in PRIVACY_VERIFICATION, section "GEOCODIO — the loud one":** a new dated stamp goes directly
  after the v4 2026-08-08 repair-script stamp. It corrects:
  - "Only households MISSING coordinates are sent";
  - the v4 stamp's "narrow, operator-initiated exception";
  - "unit … deliberately omitted" (omitted from line 2 only).

  It also states the gates (import: `GEOCODE_ENABLED` plus key; both scripts: key plus `--geocode`), and that
  `repair:import-pins` no longer checks shared spots.
- **Plus a new numbered item**, taking the next free number at write time.

**Change 2 — GeocodeCache holds those addresses too.**
- **Retention:** same 18-month disuse TTL.
- **What refreshes the clock:**
  - runs that buy cache every answer they buy, applied or not (imports, `--geocode`, the calibration run);
  - the import pass and its follow-up job refresh every cached answer they probe;
  - the repair script's suspect and past-repair probes refresh every entry they read, dry runs included, as
    they do today (`resolve()`'s touch runs before its cache-only return, `geocodeService.js:155-162`, `:203`);
  - `pins:check`'s dry run and the repair script's new `peekCache()` read the cache without touching it, so
    they refresh nothing.
- **Deletion:** the pass and `pins:check` stop buying, re-checked before every chunk, on any of three
  signals:
  - `Campaign.deletion.requestedAt`;
  - `Organization.deletion.requestedAt`, set only once a deletion executes;
  - an `OrgDeletionRequest` with `{ organizationId, status: 'scheduled' }`: the customer's filed request,
    which waits up to the 30-day SLA and can be cancelled until then.

  Checking only the first two, as the existing import guard does (`importProcessor.js:69`), would keep
  buying for up to 30 days after a customer asked for deletion.
- **Recorded:** a line on "EXCEPTION 1 — Household street addresses survive organization deletion" that
  names all three signals. Note that `organizations.js:686-688` says running imports are failed on those
  paths, and nothing implements that. The gap predates this plan.

**Change 3 — the cache as a cross-customer signal.**
- **What the plan does:**
  - Placement never happens from the cache alone, at import or in `pins:check`: every placing run looks
    every in-budget candidate up.
  - The over-ceiling cutoff is by position, not by cache state.
  - The lookup counters, the probed-id ledger, the follow-up's `pinPendingIds` and `pinPassCause` are hidden
    on the three org routes. The provider cause is never written to the org-visible `lastError`.
- **Residual signals, recorded honestly:**
  - During a provider failure, an import whose in-budget homes were all cached still places them. One with a
    miss places nothing, and its org-visible line reads "Map pins weren't checked this time".
  - The existing `repair:import-pins` cache-only `--apply` is an operator-run, per-address signal. It
    predates this plan.
- **Precedent:** the org-visible `geocodedCached` count already answers "was this address cached" for a
  one-row file.
- **Recorded:** a dated stamp on "EXCEPTION 2 — GeocodeCache is a global, cross-customer address cache".
  It also carries an assessment against DPA §4 (tenant isolation) and privacy.html:105, for **the owner to
  confirm at How it ships step 0**.

**Change 4 — `pinPlacement.from` / `to` and `pinDistrustedKeys` kept on the household.**
- **Class:** coordinates the household already had. They are deleted with the household (campaign and org
  deletion cascade; undo deletes inserted doors).
- **Recorded:** a note in the new item.

**Change 5 — confirm extended to unplaced homes.**
- **Class:** who vouched. Item 15's "which staff user vouched an approximate geocode" now also covers
  shared-spot pins.
- **Recorded:** a stamp on item 15.

**Change 6 — `knockPin` / `knockPinAt` on activity rows, and `pinSuspect` on households.**
- **Class:** a data-quality fact about a pin, not personal data. No document promises immutable activity
  rows (`PRIVACY_VERIFICATION.md:1148-1149`).
- **Recorded:** the AUDIT.md invariant passages (§N).

**Change 7 — reports published after placement show placed homes at their own spots, and exports' Latitude/
Longitude carry placed pins.**
- **Class:** more accurate, not a new exposure.
- **Recorded:** a dated stamp under PRIVACY_VERIFICATION §D11.

**What stays true:**
- **No published sentence changes.** `privacy.html:106` reads "Geocodio, which converts street addresses
  into map coordinates so each home appears in the right place on the map (we send only the street address —
  never anyone's name)". It says nothing about only addresses missing coordinates.
- `privacy.html:85` and `terms.html:91` (we process customer data only to provide the service) stay true.
- `privacy.html:122`'s "Cached address-to-coordinate lookups, which contain no names, expire automatically
  after 18 months of disuse" stays true: the TTL is unchanged at 540 days of disuse (`GeocodeCache.js:55`), the
  cache holds no names, and every refresh is a real use of the entry: a run that buys or probes it for
  placement, or the repair script reading it, as it does today (Change 2).
- **This is not a DPA §6 notice event:** same subprocessor, same data, same purpose.

## P. Tests

### New

- **`server/src/services/households/pinTrust.test.js`** (pure):
  - both policies;
  - type, ZIP and in-state checks;
  - distrusted keys;
  - collapse: against answers and existing doors; the own-bucket exclusion, which leaves out only flagged,
    unvouched candidates; a lookup-placed own-bucket door is compared; a vouched own-bucket member of another
    address refuses an in-place answer; a stray whose rooftop lands on its own building's key is refused;
    the same cache entry; two members within 25 m on one key;
  - the street-level ceiling (refused while unset) and the outlier rule;
  - the stray tier;
  - `isPointClaim`: a `nearest_rooftop_match`, a `range_interpolation`, a `street_center`, a wrong-ZIP
    rooftop and an out-of-state rooftop are not claims; a rooftop and a point in the address's ZIP and state
    are.
- **`server/test/streetNameDrift.test.js`:**
  - the 130-case `stackBaseOf` table against every tier;
  - the 55 `isUnitAddress` cases and the 25 `homeKeyOf` pairs on the server tier only, line-2 cases included;
  - `deepEqual` on the `STREET_WORDS` tables and step 3's word lists;
  - regex sources compared;
  - one probe per abbreviation;
  - the building key across the tiers.
- **`client/src/lib/mapRender.test.js`:** `householdsToGeoJSON` plus the ring filter through mapbox-gl's
  `featureFilter`; the `text-field` case reads "N homes" for an unplaced group and "N doors" otherwise.
- **`client/src/lib/stackDoors.test.js`:** the glyph, selected-door and multi-hit openers; Back after
  glyph → select reopens the building, and Back after multi-hit → select keeps the hit list.
- **`server/test/importPlaceholderPins.int.test.js`.**
  - **Setup:**
    - The fixture is a Monte Penne file plus a 5-unit building, a Spc park, a "Bldg N Apt M" complex, a
      two-number duplex, a "12-A/12-B" duplex, a stray, St/Street twins, two towers and a "# 4" unit.
    - The cache is seeded and there is one `before()`. For the seeded-cache cases, `fetch` is mocked and
      asserted never called. The provider cases use the pass's `geocodeBatch` seam instead, and the 401 case
      mocks a 401 whose body echoes the request.
  - **Outcomes:**
    - every outcome;
    - only in-scope suspects are probed;
    - no door is dropped.
  - **Re-runs and re-imports:**
    - an idempotent re-run;
    - a partial re-import keeps the placed pin;
    - an echo of a placed interpolated pin keeps D3b and its Pin Fixes row;
    - a coordinate-less re-import of an unplaced home leaves it on its spot;
    - a household whose first row has no coordinates and a later row brings a different file coordinate
      still reaches §F's vendor-change rows;
    - a changed vendor coordinate wins and is recorded.
  - **Stacks and spots:**
    - a second file joining an old spot is caught, including "5001 Apt B";
    - two towers over two passes stay placed;
    - a home placed on its own key is never re-flagged by a later import of a different file, or by an
      unscoped `--apply`;
    - **a re-keyed stray:** a duplex plus a placed stray; a refresh re-keys only the stray, then the whole file,
      then part of the stray's household. Each time the duplex stays unflagged and unstamped, and the stray's
      new door is flagged as a stray (its address is proven wrong on that key). **Then a second pass after
      that new door is placed**, by the lookup and, separately, by a lead's Move pin with lookups off, in all
      three variants: the duplex still stays unflagged and unstamped (the two `from`s are one home);
    - **re-keyed neighbours coming back:** a building flagged beside two houses that were placed (and,
      separately, moved by hand) and then gained a third unit, so it is the majority on a key with history; a
      refresh re-keys the houses back onto the spot, and separately re-keys the whole file. With lookups off
      and on, across two passes, the building stays flagged (in the whole-file variant its new doors inherit
      the old doors' flags), and a later far knock there is stamped;
    - **a building with a stray's trace loses units:** a duplex beside a placed stray loses one unit, then both;
      and the deploy-day variant, one unit and an unplaced stray emptied. The duplex is never flagged and its
      units are never stamped; the emptied stray's knocks are. Beside it, 3 active units of one address and 4
      vacated units of another keep the 3 flagged;
    - **two records of one home in one file** ("Unit A" and "Apt A" on one coordinate, beside another address's
      single unit) count as one home, so the spot is a placeholder, not a building;
    - **a repaired building re-keyed onto its old lot:** five units the repair script moved off a wrong lot, then
      re-keyed ("Dr" to "Drive") back onto it, are flagged and become candidates;
    - **an in-place placement, then a one-unit move:** a building placed in place, with units a later file
      added; one unit moved by a lead, and separately one released by a vendor change. The added units stay
      unflagged and unstamped;
    - **a later unit of a flagged building** takes its siblings' flag, and a no-drag "Whole building" from it
      is a no-op. A unit the lookup placed in place beside a flagged sibling stays unflagged when a third unit
      makes the address the majority, and a vouched two-unit building plus a new unit stays a building;
    - **a neighbour's `nearest_rooftop_match`:** 4920's rooftop R and 4925's `nearest_rooftop_match` R in one
      pass places 4920; 4920 placed in pass 1 and 4925's answer in pass 2 leaves 4920 placed, with no
      distrusted key written; a departed (inactive) house on the key doesn't refuse an in-place answer;
    - **an in-place collapse across files:** file 1 places A in place, and file 2 brings B (another address)
      with the same answer. A is reverted, the key is added to both doors' `pinDistrustedKeys`, and B is
      refused, which is the same end state as one file. A variant has B flagged on the key but out of scope
      in pass 1;
    - the sticky sequences (hand move, vendor fix);
    - **deactivation:** a building's units and three houses share a spot, and the houses are deactivated.
      The units' flags stay, and they stay candidates;
    - **same-address inactive doors are not evidence:** a re-spelled house ("St" to "Street") whose old door
      is inactive on the same coordinate is never flagged, probed or stamped; a re-spelled 6-unit building
      likewise; a 10-unit building with 10 vacated units stays a building;
    - **a door deactivated before it was ever marked,** on a placeholder spot: its pre-deploy knock is
      stamped by the freeze;
    - **undo:** undoing the import that brought the houses clears the units' flags on the next pass, and so
      does undo on a spot whose only inactive doors share the building's address;
    - **inactive-only spots:** a vacated duplex is still a building and is never stamped; a re-spelled house
      whose new record was also emptied is one home with no verdict and is never stamped; several different
      houses all deactivated still read shared;
    - **inactive doors and the freeze:** an in-place home and a vouched home, each deactivated after a far
      knock, keep that knock's Far; houses the repair script moved off a spot, later deactivated, keep the
      units' flags;
    - a pile is marked, never probed, keeps `coordSource: 'corrected'`, and a pre-move knock is frozen; a pile
      member emptied before the backfill has its pre-move and post-move knocks stamped;
    - a collapse across two files is reverted, and file 1 → file 2 → file 1 leaves it reverted.
  - **Lookups, ceiling and failures:**
    - lookups off places nothing;
    - a vendor fix (§F's flagged-door row) with lookups off reports 0 placed;
    - a throwing provider batch places nothing, sets the generic `pinPassError` and the full `pinPassCause`,
      and leaves `lastError` alone; a mocked 401 puts exactly "HTTP 401" in `pinPassCause`, with no body text
      and no `api_key`; a "fetch failed" `TypeError` gives "network: <code>" and a non-JSON 200 gives "bad
      response (not JSON)";
    - a provider that fails chunk 1 of 3 is called once, and the unprobed candidates stay flagged;
    - with a small ceiling, exactly the first N candidates are looked up whatever is cached;
    - a redelivery charges each home once (the ledger equals the number of unique candidates);
    - a campaign deletion, an executed organization deletion and a **scheduled** `OrgDeletionRequest`
      mid-pass each stop buying.
  - **The lease and the follow-up** (the queue through an injected fake `pinFollowUpQueue`, since the
    integration runner starts no Redis, `server/scripts/test-int.sh`):
    - only placing passes take it: a lookups-off import and the unscoped backfill never wait;
    - a second import that may place runs marks, the freeze and the tally at once, stores `pinPendingIds` and
      its baseline, queues its follow-up job (data `{ followUpOf }`, removed on completion) and never sleeps;
    - the follow-up places those homes once the lease frees (the holder's `finally` promotes it), `$set`s the
      counters from the recount, and clears the cause; one whose lookup degrades sets `'failed'`, keeps the
      cause and still writes the recount; one that can't take the lease throws to retry, and the failed
      listener sets `'gave_up'` with `pinPassError` only on its final attempt;
    - **the counts stay right:** the lease holder places some pending homes before the busy tally and some
      after; a lead moves some pending homes and confirms others before the follow-up runs; the follow-up is
      redelivered after its write; the import's own retry wins the lease first. In each, the counters equal a
      fresh tally and `pinsStillUnplaced` never goes below 0;
    - a follow-up that completed, then the same import going busy again, still runs a new follow-up;
    - **an import job redelivered while its follow-up runs** goes busy, leaves `pinFollowUp.at` and the ids
      alone, and the running follow-up's final write still lands;
    - **an orphaned follow-up** (`'queued'` with no job behind it, as after a rollback) is re-created by the next
      placing pass's `finally` and by the nightly sweep, and then completes;
    - undoing a busy import whose follow-up is still queued removes the job and sets `'cancelled'`, with no
      lookup bought; same-file sibling imports' follow-ups are cancelled too;
    - **undoing it while the follow-up is mid-lookup** (a slow `geocodeBatch` seam, the fake queue reporting
      the job as locked): the route answers 2xx, the follow-up buys no chunk after the boundary, writes no
      placement, writes no counts and ends `'cancelled'`;
    - every queue call times out cleanly against a fake that never answers, and nothing throws out of the
      lease's `finally`;
    - a pass held past 90 s by a slow mocked provider keeps its lease (its own timer renews it), and a
      competing import can't take it;
    - a lease whose heartbeat is more than 90 s old is taken over, and the pass that lost it writes no
      further placement;
    - a dry run never writes the lease.
  - **The tally:** an in-place placement counts in `pinsConfirmedInPlace`, never in `pinsPlacedExact`.
  - **Outlines:** a placed door inside a neighbouring book's shape gets the whole round redrawn; an in-place
    placement triggers no redraw.
  - **The freeze:**
    - a pre-deploy knock is stamped and stays low after the writers run;
    - a post-placement knock is never stamped, and one that fits a rooftop `to` as well as `from` inside the
      grace is skipped;
    - a far knock 3 minutes after an **in-place** placement stays Far, while that home's pre-placement
      knocks stay stamped;
    - a straggler inside the grace on an ordinary placement is stamped;
    - a door placed at R, knocked far from R, then reverted by a second file: those rows read low before any
      lead edit, stamped through `to`, never through the current pin;
    - a door alone at S, knocked far, placed in place by file 1 and reverted by file 2: its pre-placement
      knocks read low (the arrival rule's "all rows");
    - **the freeze re-reads its doors:** a busy import whose freeze runs after the lease holder placed one of
      its loaded doors in place leaves a far knock recorded after that placement unstamped; a Looks right made
      between a pass's load and its freeze leaves a later far knock at full Far.
- **`server/src/services/households/pinFollowUpQueue.test.js`** (pure, against an in-memory stand-in with
  BullMQ's documented behavior): an add whose jobId exists is ignored and an add after removal recreates it;
  removing a locked job returns 0 and never throws; `promoteOrRecreate` promotes a delayed job, re-adds a
  missing one, and treats `JobNotInState` as done.
- **`server/test/apartmentStacks.int.test.js`:**
  - the response shape: parallel `ids` / `takenUpTo` / `spot` arrays plus `nonApartmentExcluded`, and the
    restricted-door-ids route's `{ ids }`;
  - on an untargeted round holding a surveyed-then-restricted apartment unit, M equals the number of apartment
    doors the cut actually includes; restricting a round-1-surveyed apartment unit on an untargeted
    pre-publish round lowers M by 1 after the restricted-door-ids refetch, and Unmark raises it by 1;
  - with a fully-voted building in the fixture, the GET-derived home and spot counts equal the POST's
    `excluded` and `buildings` at N;
  - a real building and a unit-addressed misnormalized building are taken;
  - a building whose units are all in line 2 is taken by rule 2;
  - a "# N" complex is taken and never lifted;
  - Monte Penne and the duplex are never taken;
  - two towers are both taken;
  - the lift set:
    - a hand-moved unit and units split across efforts are not lifted;
    - the lift works on a published round, and the doors appear under "not in any book";
    - **two rounds:** round 1 books a house; Remove apartments runs before round 2; round 2 is published;
      the lift on round 2 makes `supplementalDoorCount` include the house, its `turfId` is untouched, and
      Add as new book books it;
    - **a targeted round:** on a published round targeted at Not home, the lift reports `inThisRound: 0`;
      a round targeted at "unknocked" counts and books them;
  - **the restricted slice:** surveyed in round 1, restricted in round 2, round 3 cut with Exclude
    restricted: the shown count equals what Add as new book adds (0); after round 2 is archived, both are 1.
    Also the no-soliciting-and-restricted overlap with each checkbox combination;
  - the emptied-round block.
- **`server/test/pinsCheck.int.test.js`:**
  - refusals (unscoped `--geocode`, a bad id);
  - the dry run writes nothing;
  - an unscoped `--apply` marks and freezes but moves nothing;
  - a scoped `--geocode --apply` places;
  - a budget shared across two campaigns;
  - a busy campaign is skipped and listed;
  - the calibration run writes no household and no activity row, and its report includes the neighbour
    estimate (blank without neighbours on both sides);
  - the dry run's cached and to-buy counts come from `peekCache()` (non-zero on a seeded cache) and touch no
    `lastUsedAt`;
  - a placement run re-creates its campaign's orphaned follow-up;
  - the script exits with code 0 on its own after a run whose `finally` promoted a follow-up (spawned as a
    child process).
- **`server/test/orgImportFields.int.test.js`:**
  - the hidden fields are absent from the org list, detail and cancel responses, and the list carries none of
    the four id arrays;
  - `/super-admin/imports` returns the three lookup counters, `pinPassError` and `pinPassCause`;
  - `pinProbedIds` and `pinPendingIds` are absent from every response, the super-admin list included.
- **Far parity, end to end** (extending `farKpi.int.test.js`): stamped rows on doors whose household state
  disagrees agree across `/flags`, `/summary`, `/quality`, `/activities`, the quality list, and
  `/households/map` activities.
- **Mobile, new:** `buildings.test.js` and `buildListEntries.test.js` (an unplaced group's title and meta, and
  its Address-sort key filing it among its street's numbered homes).

### Extended

- **Server unit tests.**
  - `stackedPins.test.js`: the probe shapes, plus one member per home, with departed homes on unique tokens.
  - `csvImporter.test.js:204-283`: the split counts.
  - `flagDetection.test.js`:
    - Far downgrade for both kinds, and the review cue (server times);
    - One spot: stamped doors leave the spread (W2, M1, the parked recorder of both kinds);
    - a lead's later correction of a wrongly spread building stays clear, as today;
    - a randomized never-creates check;
    - the existing "70 km from five identical pins" case.
- **Server integration tests.**
  - `pinFixes.int.test.js`:
    - the queue set and `explain()`;
    - the list projects `estimatedPlacement` for a lookup-placed street-level door, and not for an import's
      own interpolated geocode;
    - confirm on a suspect, and Undo;
    - a **building** confirm then Undo restores every sibling, and a separately confirmed sibling stays
      confirmed;
    - a building confirm next to an interpolated stray leaves the stray unvouched;
    - a building confirm on a flagged address vouches that address's units on the spot and no other
      address;
    - a confirm with `expectedCoordinates` on another key answers 409 `PIN_CHANGED` and stamps nothing, even
      when the door is no longer eligible (the comparison runs before the guard);
    - a door the pass places between the confirm's load and its stamp answers 409 `PIN_CHANGED`, with no
      stamp and no HLC row;
    - **test 5 is rewritten** (`:193-206`, and its header at `:10-11`): today it asserts that "2 Approx Way"
      and "3 Approx Way" are vouched together, which the address-based sibling set no longer does. h2 and h3
      become two units of one address, h4 and h5 stay the ineligible siblings, and a different-address
      interpolated door on the same pin is asserted unvouched, with the confirm-row and queue counts updated;
    - a same-spot PATCH **and** mobile POST return 2xx with `moved: 0` and the flag kept;
    - a placed door receiving a PATCH or POST of its `from` (unit or building scope) returns 2xx with
      `moved: 0` and keeps its placement;
    - a door placed **in place**, moved away by a person, can be PATCHed back to within 1.5 m of `from` and
      gets `moved: 1`;
    - a 3-unit address on a placeholder spot moves together through the PATCH and the mobile POST, and the
      spot's other addresses stay;
    - a confirmed same-address unit moves with its building, and a confirmed primary's Whole building
      moves its same-address siblings;
    - the PATCH and POST responses for a moved suspect door carry no `pinSuspect`;
    - a no-drag "Whole building" from an unflagged unit whose same-address siblings are flagged returns
      `moved: 0` and leaves the siblings flagged and uncorrected, through the PATCH and the mobile POST;
    - a mark written between a move's load and its write is cleared.
  - `pinMoveRehull.int.test.js` (e) and `mobilePinRole.int.test.js:239`: placeholder-shaped fixtures are
    rewritten to same-address units; `mobilePinRole` also gets the 3-unit flagged address.
  - **The mobile routes:** a confirmed suspect arrives without `pinSuspect` on both the bootstrap and
    `/mobile/changes`, including a changed door with no per-round entry; the location POST's response
    carries `locationConfirmedAt`.
  - **The door activity route:** `sameAddress.count` equals what a building move then reports as `moved`, for
    a flagged address with one unit knocked today, and `sameAddress.unplaced` is true when only an unknocked
    unit is flagged.
  - New `repairImportPins.int.test.js`:
    - a repair dry run leaves Household and CanvassActivity unchanged, with no `pinSuspect`, no `knockPin`
      and `updatedAt` untouched, and its would-mark count includes a planned revert onto a shared spot;
    - `--apply --user=<id>` stores `correctedBy` with `$type` `'objectId'`;
    - A was repaired onto X, and B is flagged with a cached **rooftop** answer at X: the next run reverts A, and
      `peekCache()` refreshes no `lastUsedAt`;
    - D, a signal-2 suspect whose answer equals flagged B's cached rooftop answer, is distrusted on run 1, and
      two consecutive `--apply` runs leave D untouched;
    - **a neighbour's `nearest_rooftop_match` is not a claim:** flagged B's cached `nearest_rooftop_match`
      lands on A's rooftop X. It neither reverts past repair A nor distrusts a candidate D whose answer is X;
      D stays repaired on run 2, and no row is stamped;
    - **the merged door map:** C is placed by the pass at X. A, a signal-4 candidate whose answer is X, is
      distrusted on run 1 because of C's peeked answer (C is `'geocodio'`, outside the audit's load), and is
      still untouched on run 2. A staged race variant writes A's repair onto X directly while C is placed; the
      next run reverts A;
    - a placed unit whose answer was served from its building's unit-less cache entry is still in the pool;
    - an out-of-state door that a `by: 'file'` vendor change moved is shortlisted;
    - a door reverted for the collapse reason has its repaired-period knocks stamped through the repair
      row's `to`, **before** the revert is saved: a run stopped right after the revert loop (the post-revert
      pass made to throw) keeps the stamps, and a throw in one campaign's post-revert pass leaves the next
      campaign's pass running;
    - park spaces sharing one rooftop answer are applied, not distrusted, and an earlier repair of one is
      not reverted.
  - `importHandEdits.int.test.js`:
    - case 10;
    - placed, then corrected, then a default re-import / an overwrite re-import;
    - placed, then an overwrite re-import (`keptPlacements`).
  - `importStress.int.test.js`: `errorCount` and `householdsWithFileCoords` are unchanged, and the pass
    completes.
  - `superAdminImports.int.test.js`: cost columns, totals, sort and the pin-pass badge.
  - `packet.int.test.js:485`:
    - a different-house-number stack still prints;
    - Spc, PH, "# 4", "Apt 5 B" and "#5 412 Elm St" homes are skipped, and "Bldg-3 Apt-B" still is;
    - a home with line 2 "Apt 4" is skipped, and one whose line 2 is only spaces prints;
    - `omitted.total` is right, with no "other" for skipped apartments.
- **Client tests:**
  - `buildings.test.js`: `buildingMovePrimary` with a flagged, an unflagged and a confirmed stray first;
    `addressGroups`.
  - `buildingMarkers.test.js` and `streetName.test.js`.
  - `pinFixes.test.js`:
    - rows group one address's units and never separate homes;
    - `enterAction` and `popupKeyAction` return no confirm for an unplaced row or an `estimatedPlacement`
      row, and `popupHint` drops "Enter confirm" for both;
    - the badge chain reads "Location confirmed" on a confirmed pile;
    - `confirmErrorMessage` tells `PIN_CHANGED` apart from `campaign-archived` and `campaign-deleting`.
  - `movePin.test.js`: a `moved: 0` answer gives "Nothing moved…" and no advance; the exact invalidation list
    now includes `['apartment-preview', campaignId]`; the Map page's building question is offered only when
    `sameAddress.count` is 2 or more, and its Save gate follows `sameAddress.unplaced` (a pure helper in
    `movePin.js`, since the smoke harness can't click).
  - New `importsPoll.test.js`: `importsPollInterval` returns 1500 while a job is active, 15000 while a
    follow-up is queued and less than 40 minutes old, and `false` otherwise, including for an older queued
    follow-up.
  - The render smoke harness gets no Enter or hint assertion: under `renderToString` they would pass
    without testing anything.
- **Mobile, extended:** `deltaFold.test.js` (it exists, with 8 tests): `foldDeltaHouseholds`; one case per
  dropped flag (`isActive` false, `fullyVoted`, `fullyDnc`, `doNotKnock`); a delta door without `pinSuspect`
  folds to null while an untouched door keeps its own.
- **Mobile, the reconcile,** also in `deltaFold.test.js`, on `reconcileLocationResponse`: a `moved: 0` response
  restores `coordConfidence: 'interpolated'` along with the location and `coordSource`, and restores a vouch's
  `locationConfirmedAt`; a real move keeps `locationConfirmedAt` null, so a vouched door just moved reads "Pin
  corrected".

**How to run them:** `npm test` in `server/` and `client/`; mobile tests from the repo root; integration
tests from `server/` with `cd server && npm run test:int -- test/<file>`. Temporary probes live in the session
scratchpad, never under `server/test/`.

## Q. Rollout, gates and compatibility

1. **Step 0:** read `GEOCODE_ENABLED`, and confirm the privacy record (§O).
2. **One server deploy, outside field hours.**
   - Additive throughout.
   - Run `npm run audit:mobile-api` first. Its helper-built paths (`/turfs/doors`,
     `/mobile/households/:id/location`, `/mobile/changes`) must be checked by hand.
   - The Far, One spot and stamp changes ship in this deploy, before any pin moves.
   - **If this deploy is rolled back** (Heroku dashboard → Activity → Roll back): a queued pins-only follow-up
     job reaches today's worker, which reads `data.importJobId`, finds none in `{ followUpOf }`, and throws
     before writing anything, so the finished import stays finished and keeps its Undo. Today's failed
     listener returns early for that job and `removeOnFail` deletes it, so the import's line keeps saying
     "placing by address shortly" with no job behind it. After rolling forward, the next placing pass in that
     campaign re-creates the follow-up (its lease `finally`, §E), as does the nightly import sweep (§F); to
     do it at once, the operator runs `npm run pins:check -- --campaign=<id> --geocode --apply` in the Run
     console. The follow-up then places the homes and the line shows the real counts. OPERATIONS.md gets this
     note.
3. **Gate:** `npm run migrate:build-indexes -- --apply`.
4. **Marking:** `pins:check` (dry run), then `pins:check -- --apply`, everywhere. It is free, and it marks
   and freezes.
5. **Calibration:** `pins:check -- --campaign=<Nye id> --geocode`, with no `--apply`.
   - Read the report. Per home it carries both references: the knock GPS, and the position the placed
     same-street neighbours suggest (§E step 11). No separate script is needed.
   - Set `PIN_PLACEMENT_MAX_INTERP_M` in Heroku dashboard → Settings → Config Vars.
6. **Placement per campaign:** the dry run, then `--geocode --apply`.
7. **Device-check campaign**, in an internal organization. Never the demo campaign, never a customer.
   - **The fixture** is a small CSV with file coordinates and synthetic names. **Every stacked address sits
     on a street that cannot geocode:**
     - six house numbers on one coordinate, in mixed case;
     - a two-home stack;
     - a 2-unit address sharing one coordinate with two houses (no majority, so all four are flagged);
     - a 5-unit building plus one stray;
     - a Spc park.
   - **Expected pin line:** nothing placed, and 13 without an exact spot.
   - Clean up with `npm run cleanup:test-campaigns -- --ids=<id> --apply`.
8. **Mobile OTA, from `mobile/`:** `npm run ota:staging`, then the device checks, then
   `npm run ota:production` from `main`.
   - No client-version change and no native build.
   - `ota:production` publishes all of `main`.
9. **Device checks:**
   - the homes list, sorted, with per-row Directions;
   - the list view: the six-home stack is one row, "6 homes at one map spot · 6 homes · 0 done", with no
     distance, filed under Address beside its lowest house number on that street;
   - a building with a stray keeps its distance in the list;
   - a lone unplaced door shows the badge;
   - Fix pin on a lone unplaced home asks nothing, keeps Save off until the pin is 1.5 m off the spot, and
     moves one home; "Use my current location" while standing on the spot itself keeps Save off and points
     to Looks right;
   - Fix pin on one unit of the flagged 2-unit address asks "Just this unit / Whole building", and Whole
     building moves those two units and neither house;
   - Fix pin on an approximate door that isn't flagged opens on its pin and saves without a drag, as today;
   - Fix pin on an unplaced home with no GPS fix yet: drag at once, and the pin stays where it was dragged
     when the fix arrives;
   - on the admin map, with the date filter on **All time**, Move pin on one unit of the flagged 2-unit address
     asks "Just this unit / Whole building (2 units)", and Whole building moves both units and neither house;
     the bar then says "Moved 2 units";
   - the same on the default **Today** view after knocking only one of those two units: the question still
     says "2 units", and both move;
   - "Whole building" on the real building moves the units and not the stray;
   - the Android button order;
   - the admin chooser opens on the stack, not on neighbours;
   - the admin map's move bar on an unplaced home: Save with the crosshair still on the spot says "Nothing
     moved…" and posts nothing;
   - a moved door loses its badge within 30 s, and the other door keeps it;
   - the audit detail line, and the ping sheet's label;
   - on the web, Move pin one home out of the six-home stack, and the cut-map badge reads 5.
10. **Second server deploy** with the phone-screen Help copy.
11. **Measured before sign-off:**
    - pass heap: a synthetic 300k-door campaign, overlapping another job's `recomputeCutAttributesForCampaign`,
      under the 384 MB worker cap;
    - pass time on Nye;
    - whole-round redraw time at 250k inside the import worker (BullMQ's default 30 s lock);
    - the apartment-preview GET's time, heap and payload size at 250k on the **web** dyno, which has no heap
      cap, and its refetches on an open Turf Cutting page (exclude, include and pin moves only);
    - `GET …/turfs?passId` at 250k with the supplemental aggregate, its `$nin` of booked ids and the
      `restrictedDoorIdsForEffort` call;
    - the import queue while one campaign's pass holds the lease: a second import into it finishes without
      holding a worker slot, and another organization's preview is never expired as unclaimed;
    - `explain()` on both Pin Fixes queries.

## R. Traps this plan guards against

**The audit and the freeze**
- **The Far rule reads only the frozen row stamp,** and every scan projects it through `FAR_ROW_FIELDS`. The
  `/households/map` activities and the activity detail project it too, for the ping panels.
- **Never stamp `false`; never unset a stamp.**
- **The freeze runs at the end of every pass, by its table, on each door as it is now** (§E step 8): it
  re-reads each batch's doors before it stamps, because a marking pass runs beside a placing pass.
  - unplaced doors against their current pin, from the time they arrived on it (the arrival rule; a
    reverted in-place placement never left, so all its rows count);
  - inactive doors that would be unplaced now if they were active, the same way, but never one that was
    vouched, hand-corrected or placed; an emptied unit of an unflagged building is never covered;
  - placed doors against `from`, up to `at` + 5 minutes, skipping rows that fit a trusted rooftop `to`;
  - placed-in-place doors never;
  - reverted placements against the distrusted `to`;
  - piles, active or inactive, against the pile row's `from`.
- **The repair script stamps its own collapse reverts, before it saves them,** through the same `freezeRows`.
  Nothing the revert writes would let a later pass re-derive that evidence.
- **One spot keeps today's live rule and only leaves stamped doors out of the spread.** A "pins at knock
  time" rule is not monotone.
- **`knockPinAt` is a server time.**

**Flags, placements and stacks**
- **One home, one member** (`homeKeyOf`), whatever form its records take on a key: an active door, an emptied
  door, a departure. Otherwise one home counts twice and flips its building: a re-keyed stray placed twice, a
  re-spelled house beside its emptied old door, or one home written two ways in one file.
- **Emptying a door never changes a verdict.** Emptied homes vote as if active; departed homes never vote. A
  re-spelled or emptied unit must never turn its own building, or its own re-spelled house, into a
  placeholder, and a building that loses units beside a stray's trace stays a building.
- **A departure proves its address wrong on its key,** whether a lookup, a person, a vendor change or the
  repair script moved it. An in-place placement's `from` is the verified house, never a departure.
- **A key of one home is no verdict.** Clearing by majority only happens on keys with no shared-spot history
  (no departed home, no address proven wrong), so neither a deactivation nor re-keyed neighbours coming back
  clears a flag.
- **A home placed by the lookup is never re-flagged** unless the collapse gate reverts it, not even by its
  address's shared flag. There is no placement without a record.
- **The collapse comparison includes lookup-placed doors in the door's own bucket.** Only the spot's
  flagged, unvouched candidates and its inactive doors are left out; vouched, corrected, pile, `'geocodio'`
  and different-address members are always compared.
- **Only answers that are claims to the point count as collisions** (`isPointClaim`), in the pass and in the
  repair script's collapse pool. A `nearest_rooftop_match`, or any answer refused for its type, ZIP or state,
  never refuses or reverts another door's rooftop.
- **One address's units on one key share an effective flag.** It passes only from a unit unplaced now, and
  never to a unit the lookup placed or a person owns; a re-keyed door inherits its old door's mark.
- **Distrusted answer keys are kept,** so a re-import can't re-place a door onto a distrusted point.
- **One placing pass per campaign at a time,** through the `Campaign.pinPass` lease. The pass renews it on its
  own timer with a per-run owner token, and checks it before every write batch. Marking-only passes never
  take it.
- **A busy import never sleeps in its worker slot.** It marks now and leaves placement to its follow-up job,
  whose counts are re-read from state against a baseline, never `$inc`ed, and which is removed on completion,
  harmless to a rolled-back worker, and re-created when orphaned.
- **An undo stops a running follow-up too.** The follow-up re-checks its import before every provider chunk
  and every placement batch; the route cancels after the undo succeeds, outside the `try` that rolls the undo
  back, and removes the job with `Queue.remove`, never `Job.remove()`, which throws on a running job.
- **A queued status always has a way out:** a busy pass never rewrites an existing queued follow-up, a lost
  lease retries, BullMQ's final failure is closed by the failed listener, and an orphan is re-created.
- **Every follow-up queue call is time-bounded and injectable,** and `pins:check` closes its Redis connection
  so the console command exits.
- **Only doors currently placed by the lookup count as placed** in the tally.

**Imports and writes**
- **Never null a real door's coordinates;** probes are copies.
- **Judge answers by `accuracyType`, never `confidence`.**
- **`resolve()` pays whenever the key is set.**
- **No cache-only placement anywhere.**
- **The first test keys on the entry's `coordSource === 'geocodio'`,** never `coordsProvided`, and keeps the
  location trio too. An echo of a placed pin must not demote it to `'file'`.
- **`pinPlacement` is a sub-schema with `default: undefined`,** tested on `.at`, and never `$unset`.
- **Clear `pinSuspect` in the move's own single pipeline write,** with the stage form
  `{ $unset: 'pinSuspect' }`. `h.save()` sends nothing for a field the document was loaded without, and a
  second write isn't atomic with the first.
- **Pipeline values are never cast,** so the service casts `correctedBy` to an ObjectId itself.
- **Interpolated placement is off until calibrated.**
- **The ceiling is a set of probed homes, not a running count.**
- **`overwriteHandEdits` skips the shield prefetch,** so the placement guard has its own.
- **Three deletion signals,** the scheduled `OrgDeletionRequest` included, stop buying.
- **A provider failure stops buying at once.** Carrying on would hold a shared import slot for 180 s a batch.
- **The full pass error goes to `pinPassCause`,** never to the org-visible `lastError`, and only through the
  fixed cause mapping: never a provider message (it embeds the response body) or the request URL with its API
  key.
- **The repair script's post-revert pass gets `dryRun: !APPLY`,** with the planned reverts as `overrides`.
  Adjudicate and the self-revert share one collapse pool, peeked answers and door map included, so a door
  can't be repaired and reverted on alternate runs. The peek reads the cache through `resolve()`'s own lookup
  (full key, then unit-less key), never through `forecast()`.

**Server routes and phones**
- **The building fan-outs are same key and same street address, whatever the flags, and never answer
  4xx.**
  - The same-spot no-op returns the door with `moved: 0`, and for a building it tests every target.
  - So does a save onto the spot a placed home left, which is how an old phone's stale save is stopped,
    except after a placement in place, whose `from` is the verified house.
- **The confirm writer is conditional** on the loaded pin, and Pin Fixes sends the pin it showed. A changed
  pin answers 409 with its own code, `PIN_CHANGED`. The route compares the pin before its eligibility guard,
  and the client checks the code before its archived-campaign branch.
- **Building-confirm Undo is matched by the confirm's own timestamp.**
- **Payloads carry `effectivePinSuspect` in the `pinSuspect` field.** The mobile routes have no mapper, so
  their loops overwrite it, `/changes` for every changed door.
- **The delta fold and both projections change together.**
- **New ImportJob fields reach organizations unless hidden on the list, detail and cancel routes,** and the
  list drops the import's id arrays, which a long poll would otherwise re-ship every 15 s.
- **"Not in any book" and "Add as new book" share `supplementalDoorFilter`.** The `turfId` mirror is not
  that set, and the restricted slice includes `restrictedDoorIdsForEffort`, exactly as the job drops it.
- **The apartment preview lives outside the `['turfs', cid]` query prefix,** so restrict clicks don't
  re-stream it; the restricted list, which a restrict does change, is its own small query inside that prefix.
- **A building's size on a date-filtered map comes from the server** (`sameAddress`), never from the payload.
- **The phone's reconcile is a pure helper in `deltaFold.js`,** because `recordAction.js` can't be loaded
  under node, and it takes the vouch stamp from the response along with the location trio.

**Clients and indexes**
- **The multi-hit panel keeps its own id-list source,** and Back restores whichever source opened it.
- **Enter never vouches for an unplaced home or confirms a street-level placement,** and the key dispatch and
  hint are pure helpers, because the smoke harness can't reach them.
- **Save stays off near the spot** on every pin-move surface: web Move pin, `FixPinModal` for unplaced doors
  (drag and GPS alike), and the admin map's move bar.
- **The delta fold keeps today's mid-shift drop** of inactive, voted, DNC and do-not-knock doors.
- **`isUnitAddress`, `stackBaseOf` and `homeKeyOf` share `stripUnits`,** and its joiner rewrite is global.
- **No `$or` in the Pin Fixes count.** A new index needs a distinct key pattern.
- **`markerSig` must carry the drawn label,** and the map layer's `text-field` reads "N homes" for unplaced
  groups.
- **Redraw the whole round after placement,** except for in-place placements, which move nothing.

**Process**
- **Shared tree:** hand over one frozen patch via `git apply --cached`.
- **Help copy goes live with the server deploy,** so phone-screen copy rides the second deploy.

## S. Effort

Roughly, for one person, including tests:

| Workstream | Size |
|---|---|
| Address key (reference + mirrors + drift test, `homeKeyOf`), `pinTrust` (with `isPointClaim`), the pass (lease with its own timer and fencing, stickiness, one member per home with departures, the proven-wrong rule and twin inheritance, piles active and inactive, marks, freeze table with its re-read and arrival rule, ceiling set, distrusted keys, outage stop and cause mapping), the follow-up job (recounted counts, the bounded queue adapter, promote-or-recreate, undo checks, the failed-listener branch and nightly sweep, rollback safety), import wiring, model, index | about 8.5 days |
| Pin writers (one pipeline write, both no-op cases, address fan-out), confirm (conditional write, expected coordinates, `PIN_CHANGED`, address sets, undo by stamp), Pin Fixes queue and rows | about 2 days |
| Remove apartments helper, the preview GET with spots and its carrier, Re-include on any round with its round count, `supplementalDoorFilter` and the restricted slice, packets | about 2.5 days |
| GPS audit (stamps, `FAR_ROW_FIELDS`, Far, One spot, review cue, renderers, ping panels) | about 2 days |
| Web (maps, two-source stack panel and Back, address groups, the Map page's server-counted building move, panels, Turf Cutting and its restricted-ids query, Pin Fixes keyboard and no-op handling, import and super-admin pages) | about 3.5 days |
| Mobile (grouping, homes screen, list builder and row, door screen, Fix pin, admin chooser and server-counted move bar, fold and the pure reconcile helper, route loops, icons, audit renderers) | about 3 days |
| `pins:check` (including the calibration report, neighbour estimate and clean exit), repair-script changes (one claims-only collapse pool with `peekCache()` and its door map, dry-run overrides, collapse reverts stamped before save, per-campaign isolation, the Spc effect) | about 3 days |
| Docs, Help Center, privacy record | about 1.5 days |
| Verification (integration runs, heap/redraw/web measurements, calibration, device checks) | about 2 days |

## T. Open questions for the owner

1. **Is `GEOCODE_ENABLED` set to `true` in production?** It can't be read from the repo (step 0).
2. **The look of the "N homes" marker** (a design-step item). It must not be the building glyph and must not
   be a numbered bubble. It uses the three roll-up colours and is drawn on canvas with `addImage`.
3. **D3b scope.** Every *other* unchecked street-level pin (coordinate-less addresses geocoded at import) is
   still judged at full Far, as today. Extend the same downgrade to them? That is broader, and it overlaps
   [PROPOSAL_GPS_UPGRADES.md](PROPOSAL_GPS_UPGRADES.md).
4. **A stack spanning several books.** Turf Cutting colours the glyph by the first unit's book. Keep that?
5. **Survey response drawers** keep "N ft from the house" for answers recorded at a shared spot. Fix later
   with a display-time check?
6. **Invoice reconciliation.** `pins:check` spend is printed, not stored. Add a small spend record that the
   super-admin page sums?

## U. Review rounds

| Round | Lenses | Findings | Confirmed | What it changed |
|---|---|---|---|---|
| 1 (2026-10-03/04) | State machine; import pipeline and scale; web console; mobile and old phones; GPS audit under the false-positive veto; Remove apartments, queue and counts; privacy, docs and ops; pre-mortem. Each finding then went to a skeptic told to refute it. The first attempt ran out of usage partway; ten findings salvaged from its transcripts went in before the rerun. | 101 (4 blockers, 36 major, 61 minor after re-grading) | 101 (0 refuted) | Far reads a frozen row stamp; the flag is sticky; virtual members never vote; piles are marked; confirm keeps the flag under the vouch; imports pay only for the file's homes; the address key handles unit and street-word variants; Remove apartments uses street address plus unit addresses; narrowed fan-outs and a same-spot no-op; whole-round redraws; every number re-measured through the importer on three files. |
| 2 (2026-10-04/05) | Audit and pass mechanics; address key and apartments; import, ops and privacy; web and mobile clients; a fix-by-fix audit of all 101 round-1 findings plus internal consistency; a pre-mortem in each lens. One skeptic per lens. A first attempt hit a session limit; four findings salvaged from it went in before the smaller rerun. | 44 (0 blockers, 16 major, 28 minor) | 44 (0 refuted) | "Confirmed in place" became an ordinary placement with a record, so a later pass can't re-flag and re-freeze it. The pass got one exact order, with marks before lookups and the freeze last; the freeze proves placed doors against `from` (pre-placement rows only) and piles against their pre-move spot. Street-level placement ships off until a calibration step that now exists and prints its data. "Re-include those" works on published rounds. `isUnitAddress` catches "# 4". The address-key spec now *is* the measured reference (46 + 16 cases, with the five prose/prototype divergences decided). The first test keeps the location. Ping panels get the stamp. A race-free flag clear and a no-op return contract. Building-confirm Undo by timestamp. Two-source stack panel. The move primary follows the majority address. The phone list keeps a building's distance. Distrusted keys stop flip-flops. The ceiling is a probed-home set. Deletion re-checks per chunk. Server-time review cue. Neutral wording. Pier/Slip/Stop dropped from D5. One spot's `estimated` exclusion disclosed. The rejected knock-time One spot rule was verified non-monotone with the real `computeReasons`. |
| 3 (2026-10-05) | The pass, freeze and ledger; import and the pin writers; the address key and apartments (revision 3); the web and mobile clients (revision 3); a fix-by-fix audit of round 2 plus consistency and privacy. Five lenses and five batched skeptics. | 38 (0 blockers, 6 major, 32 minor) | 38 (0 refuted) | The collapse check now sees a home a previous pass placed in place, so one file and two files end the same. Units of one street address move together even when flagged, so fixing a real building on a shared spot no longer splits it into one pin per unit. A stale save onto the spot a placed home left is a no-op, and confirm is conditional on the pin it saw (409 otherwise). "Not in any book" now counts what "Add as new book" adds, on any round. The address key accepts the unit ids revision 3 had narrowed away (revision 3 would have split 18 real buildings on the files on disk), and `isUnitAddress` shares its strip step, so the two can't disagree; 89 + 37 cases, numbers unchanged. Enter can no longer vouch a shared spot, and a vouch's Far effect is disclosed. Freeze windows: in-place placements never re-proved, reverted placements stamped through the distrusted answer, arrival times bound the current-pin proof. One pass per campaign (a lease). Inactive doors keep their evidence. Copy in the past tense where the present was false; "N homes" on the web marker and the phone list row. Named mechanisms for the mobile payload, the error cause field, the deletion signals, the calibration report and the repair dry run. |
| 4 (2026-10-05) | The pass, freeze and lease; the pin writers and confirm; the address key and Turf Cutting; the web and mobile clients; a fix-by-fix audit of round 3 plus consistency and privacy. Five lenses and five batched skeptics; the audit agents were re-checked for writes afterwards (none outside the scratchpad). | 31, about 24 distinct (0 blockers, 2 distinct majors, the rest minor) | 31 (0 refuted) | Inactive doors now count as evidence only when they are a different address, so a re-spelled house or a building with vacated units no longer reads as a shared spot. "Not in any book" subtracts exactly what the button drops, including homes restricted in another live round. The lease renews itself inside the pass with a per-run token and fences every write batch, and a busy import marks at once and hands placement to a follow-up job instead of sleeping in a shared worker slot. The freeze gained an arrival rule (a reverted in-place placement's old knocks count) and a row for doors deactivated before they were marked. The collapse gate compares vouched and other never-looked-up members, so a vouched home and an in-place placement can't become a building. Pipeline values are cast by the service. The stale-save no-op exempts in-place placements. Confirm refusals carry `PIN_CHANGED`. The key handles "Apt #5", "Apt-5", a bare "Apt", "Rear Apt" and "2nd Floor" (105 + 45 cases, numbers unchanged). Smaller fixes: targeted-round re-include copy, the preview's carrier and query key, the payload shape, the Address sort key, the GPS-path Save gate, the provider error cause, the repair script's dry-run counts and collapse pool, the Spc effect on the repair script, the delta fold's drop, testable key helpers, and the D3b disclosure for confirming or saving an estimate. |
| 5 (2026-10-05) | The pass, lease, follow-up job and freeze; write paths, confirm and the repair script; the address key and Turf Cutting; the web and mobile clients; a fix-by-fix audit of round 4 plus consistency and privacy. Five lenses and five batched skeptics; the agents were re-checked for writes afterwards (none outside the scratchpad). | 33 (0 blockers, 6 major, 27 minor) | 33 (0 refuted) | **A measurement gap:** FL-22's 166,738-row master file had been read as empty (its voter-id column isn't one the auto-mapper knows), so every on-disk count is re-measured with it and the scripts now fail on an empty file. Read properly it added one address-reader exception, marina "Slip 12" as a unit, and its numbers to the tables. **The follow-up job** counts from state against a baseline instead of adding, so redeliveries and the lease holder's own placements can't double-count; it is removed on completion, promoted when the lease frees, cancelled by an undo, given end states, harmless to a rolled-back worker, and polled by the Imports page. **Only placing passes take the lease**, so the backfill never makes an import busy. **Evidence rules:** a `from` of an active door's own address marks that address proven wrong instead of counting twice; inactive-only spots count each address once; inactive doors are never compared by the collapse gate, nor frozen when vouched or placed; answers refused for type, ZIP or state no longer count as collisions; one address's units share their flag. **Repair script:** one collapse pool for both decisions (it had alternated forever), the peeked door map, vendor-moved doors back in the audit, collapse reverts frozen. **Pin writers and clients:** a building no-op tests every target; the GPS seed can't overwrite a drag; "Nothing moved" has a real path to the screen; the reconcile restores `coordConfidence`; the admin map moves an address's units together; the preview refreshes on pin moves and drops live-round restrictions from M; the outage stop and cause mapping; the Pin Fixes intro; a test seam; privacy anchors corrected. |
| 6 (2026-10-05), the last round | Revision 6's changes only: the evidence and freeze rules; the follow-up job, lease and imports; the repair script, the address key and the measurements; client consistency plus a fix-by-fix audit of round 5. Four reviewers and four skeptics; the agents were re-checked for writes afterwards (none outside the scratchpad). | 29 (0 blockers, 4 major, 25 minor) | 29 (0 refuted; 3 judged partly right) | **One home, one member.** Round 6 showed that revision 6's evidence rules still counted one home twice once a re-keyed stray's new door was placed too (round 6 counted 54 of the master file's 126 building spots with strays as exposed), let a building with a stray's trace become a placeholder as it lost units (and freeze every unit's history), cleared a flagged building's marks when re-keyed neighbours came back, ignored repair moves, treated an in-place placement's verified rooftop as proof against its own address, passed a shared flag to lookup-placed and vouched units, and missed emptied pile houses. Revision 7 replaces the per-door rules with one principle: each home on a key is one member by `homeKeyOf`, whatever records it has there; emptied homes vote as if active; departures (placement, person, vendor, repair and pile `from`s, never an in-place `from`) never vote and prove their address wrong; history blocks clearing; a re-keyed door inherits its old door's mark; the shared flag passes only between effective, unowned units. Replayed through the real classifier: 49 of 49 scenarios as intended, and no wrong flag or freeze on any building spot of the four located files. Counting per home also moved two master-file spots where one home was written two ways (1,048 → 1,050). **The follow-up job:** an undo now stops a running follow-up (re-checked before every chunk and batch; the route cancels after the undo, outside its rollback, and removes the job with `Queue.remove`); a queued status always has an end (no rewrite by a redelivery, retry on a lost lease, a failed-listener branch, re-creation of orphans by the next placing pass and the nightly sweep, which also makes the rollback note true); the unplaced count is re-read from state; queue calls are bounded and injectable, and `pins:check` exits. **The freeze** re-reads its doors before stamping, so a marking pass beside a placing pass can't forgive a knock made after an in-place placement or a Looks right. **The repair script:** its collapse pool admits only claims to the point, so a neighbour's `nearest_rooftop_match` can no longer revert a correct repair (and bring back false Far flags); collapse reverts stamp their evidence before saving; `peekCache()` is `resolve()`'s own read step, not `forecast()`. **Smaller:** the joiner rewrite is global ("Bldg-3 Apt-B"); Part 1 no longer announces hyphen and slash units as new and does name "Apt 5 B" and "#5 412 Elm St"; §B's lease row; §G's vouch-skip placement; the repair dry run's cache touch is recorded; the map pages take a building's size from the server; the import list stops shipping its id arrays; the preview's restricted list is its own small query; the phone clears and restores the vouch stamp through a testable reconcile helper. |
