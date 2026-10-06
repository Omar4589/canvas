# Release 2: homes that share a map spot — the "N homes" marker and lists, and the phone's Fix pin

> **Status: BUILT 2026-10-05 (uncommitted at time of writing), to this plan and design, which the owner approved
> the same day ("fix it then lets do release 2"). A server deploy, then the phone update over the air (staging,
> then production). Where the build differs from the plan is listed in "F. As built", at the end.** Release 1
> ([PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md)) is deployed. This release is cut
> from [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md) (revision 7): its Screens 3–8, §J and §K, cited
> below as "the reference". Only what Release 1's data supports is in; the rest is listed under "Not in this
> release".

---

# Part 1 — For everyone

## Why

Release 1 puts most homes that shared a coordinate on their own house, and lists the rest in Pin Fixes as "No
exact map spot". But every map still draws a shared spot the old way: the web Map and Turf Cutting show an
apartment building ("8 doors"), and the phone shows "8 units · 2 done" with one address. So a canvasser can still
be sent to a dot that isn't a house, and only Pin Fixes knows better.

This release makes every map and list say what the spot really is, and lets leads fix those homes from anywhere.

**Nye doesn't need it.** Once the leads clear Pin Fixes for Nye, no two addresses share a spot there, so Nye can
be canvassed on today's apps. This release is for every import after that.

## What changes

**Web Map page**
- A spot of different homes gets its own marker, captioned **"N homes"**. A real building keeps "N doors".
- Clicking it opens **"N homes at one map spot"**: a note, then each home's full address, status and **Move pin**.
  Units of one address sit together under it.
- A home left alone on a shared spot gets the amber ring and a **"No exact map spot"** badge.
- Homes Doorline moved say **"Placed by address (Oct 5)"**; homes the lookup found on their own spot say **"The
  address lookup confirms this spot"**.
- **Move pin on a unit whose address has other units on the spot** asks "Just this unit" or "Whole building
  (N units)". N comes from the server, so it counts every unit, not just the ones today's date filter shows.

**Turf Cutting**
- The same "N homes" marker. Its pop-up lists each home with **Move pin**, **Mark restricted…** and **Move to
  book…**; units of one address are grouped with **Move these N units**; the spot has **Move all to book…** and
  **Mark all N restricted…**. It has no "Move building pin", because these aren't one building.
- A house's pop-up shows the "No exact map spot" badge.

**Pin Fixes** — its map shows the same "N homes" marker.

**Phones (an over-the-air update, no store build)**
- **Canvassers**
  - The marker reads **"N homes · N done"**.
  - Tapping it opens a homes screen: each home with its status, the one-tap action and **its own Directions**,
    sorted by street and house number. Directions always go to the address, never to the dot.
  - A door on a shared spot says **"No exact map spot — use Directions."**
  - In the list view these homes show no distance (it would be measured to the wrong place). Under "Nearest" they
    go in their own "No exact map spot" section at the end.
- **Leads**
  - **Fix pin location** on one of these homes opens at your location when you're nearby. Save stays off until the
    pin is clearly off the shared spot. If you're standing on the spot itself, it says so and points you to Looks
    right in Pin Fixes. If the server moved nothing, it says so.
  - It asks "Just this unit / Whole building" only when other units of the **same address** share the spot, and
    the buttons are in the right order on Android (today Cancel sits in the highlighted slot).
  - The **admin map's** list of stacked homes groups them by address; its Move pin asks the same question with the
    server's unit count, won't save while the crosshair is still on the spot, and says "Moved N units" after a
    whole-building move.

**What stays the same:** real apartment buildings and parks look exactly as they do today. The GPS audit doesn't
change (your decision on 2026-10-05). Nothing new is collected.

## Design — the screens this release changes

Everything reuses today's components, spacing and tokens; only the words and the new states are new.

**1. Web Map — the marker and its panel**
```
   ┌────┐                     ┌────────────────────────────────────────────────┐
   │ ⌂⌂ │  5 homes            │ 5 homes at one map spot                     ✕ │
   └────┘                     │ Pahrump, NV 89061                              │
 (new "homes" glyph, same     │ These are different homes that share one map   │
  grey/amber/green roll-up)   │ spot. Move each pin to its house, or mark it   │
                              │ Looks right in Pin Fixes if it really is here. │
   ┌────┐                     │────────────────────────────────────────────────│
   │ ▦  │  12 doors           │ 5016 E Monte Penne Way   ● Not home  Move pin │
   └────┘  (real building,    │ 5021 E Monte Penne Way   ○ Unknocked Move pin │
           unchanged)         │ 100 Main St                                    │
                              │   Apt 1                  ○ Unknocked Move pin │
                              │   Apt 2                  ● Surveyed  Move pin │
                              └────────────────────────────────────────────────┘
```
Clicking two overlapping houses still opens a "pick one" list; its note reads "N doors near here — pick one".

**2. Web Map — Move pin on a unit whose address has other units on the spot**
```
┌──────────────────────────────────────────────┐
│ Move which pins?                              │
│ 100 Main St has 4 units on this map spot.     │
│ [Just this unit]  [Whole building (4 units)]  │
│                                     [Cancel]  │
└──────────────────────────────────────────────┘
```
After a whole-building move the toast reads "Building pin moved · 4 units", with the server's count.

**3. Web door panel — the pin line (the first that applies)**
```
● No exact map spot      This home has no exact map spot; its coordinate was shared with other addresses.
● Location confirmed · Oct 5
● Pin corrected · Oct 5
● Approximate location
  ...and under the badge, when it applies:
  Placed by address (Oct 5). Its earlier spot was shared with 4 other homes.
  The address lookup confirms this spot (Oct 5).
```

**4. Turf Cutting — the pop-up for a spot of separate homes**
```
┌──────────────────────────────────────────┐
│ ⌂⌂ 5 homes at one map spot            ✕ │
│ Pahrump, NV 89061                        │
│ These are different homes that share one │
│ map spot. Move each pin to its house.    │
│ [Move all to book… ▾] [Mark all 5 restricted…] │
│──────────────────────────────────────────│
│ 5016 E Monte Penne Way   Book 3 ●        │
│   Move pin · Mark restricted… · Move to book… ▾ │
│ 100 Main St (2 units)    Move these 2 units │
│   Apt 1  Move pin · Mark restricted… · …  │
│   Apt 2  Move pin · Mark restricted… · …  │
└──────────────────────────────────────────┘
```

**5. Phone — the marker and the homes screen**
```
  ┌────┐                      ‹ Map
  │ ⌂⌂ │ 5 homes · 2 done     ┌──────────────────────────────────────┐
  └────┘                      │ 5 homes — no exact map spot          │
                              │ These homes share one spot on the    │
                              │ map. Use each home's Directions.     │
                              └──────────────────────────────────────┘
                              5016 E Monte Penne Way
                              ● Not home        [Not home] [Directions]
                              5021 E Monte Penne Way
                              ○ Unknocked       [Not home] [Directions]
                              100 Main St Apt 1
                              ○ Unknocked       [Not home] [Directions]
```

**6. Phone — the list view**
```
Nearest
  4880 E Monte Penne Way        ● Not home · 120 ft      [Not home]
  4896 E Monte Penne Way        ○ Unknocked · 240 ft     [Not home]
  ...
No exact map spot
  5 homes at one map spot       5 homes · 2 done                 ›
  5100 Calvada Blvd             ○ Unknocked              [Not home]
```
Under "Address A–Z" the group sits with its lowest house number on its street.

**7. Phone — the door screen**
```
┌───────────────────────────────────────────────┐
│ ⚠ No exact map spot — use Directions.          │
│ This home's coordinate was shared with other   │
│ addresses, so its pin isn't on the house.      │
└───────────────────────────────────────────────┘
```

**8. Phone — Fix pin location on a home with no exact spot (leads)**
```
┌──────────────────────────────────────────────┐
│ Fix pin location                             │
│ Drag the pin to the house, or tap Use my     │
│ current location while standing at it.       │
│ ┌──────────────────────────────────────────┐ │
│ │      (map, opened at your location;      │ │
│ │       grey ring = the shared spot)       │ │
│ └──────────────────────────────────────────┘ │
│ [ Use my current location ]                  │
│ You're at this home's map spot. If the home  │   ← only when your fix is on the spot
│ really is here, mark it Looks right in Pin   │
│ Fixes.                                       │
│ [Cancel]                        [Save] (off) │
└──────────────────────────────────────────────┘
```
If the server moved nothing: "Nothing moved — the pin is still on its old spot."

**9. Phone — admin map**
```
Stacked homes                     Move bar
┌─────────────────────────────┐   ┌──────────────────────────────────────────┐
│ 5 homes at one map spot     │   │ Drag the map so the crosshair sits on    │
│ 5016 E Monte Penne Way    › │   │ the house.              [Cancel] [Save]  │
│ 100 Main St                 │   │ Nothing moved — drag the map so the      │ ← Save on the spot
│   Apt 1                   › │   │ crosshair sits on the house.             │
│   Apt 2                   › │   │ Moved 4 units                            │ ← after a building move
└─────────────────────────────┘   └──────────────────────────────────────────┘
```

## How it ships

1. **Server and web** deploy from `main`. The new payload fields are additions, so phones on today's app ignore
   them. No index build, no migration, no client-version bump.
2. **Phones**, over the air: `npm run ota:staging` first, checked on a test phone, then `npm run ota:production`.
   The new marker images are JavaScript assets; `ota:check` confirms no store build is needed.
3. **One thing to decide first:** the GPS work's next phone step edits three of the same phone files (the Fix pin
   pop-up, the admin map and the canvasser map). Two sessions changing them at once means `git add -A` ships
   whichever is half done. **Recommended:** build the server and web part now (no overlap), and the phone part
   after the GPS phone step is committed, or the other way round if you'd rather have these screens first.

## Privacy — said out loud

This touches **who sees what**, in a small way: phones now receive whether a home has "no exact map spot", a
data-quality mark about its pin (not personal data), sent only to people who already see that home's address and
pin. The web Map and Turf routes return the placement date to the same admin roles that see the pin today. No new
collection, no new recipient, no published sentence changes. `docs/PRIVACY_VERIFICATION.md` item 28 gets a dated
stamp.

## Not in this release

- The GPS audit change (forgiving "Far" at a shared spot): left out by your decision.
- "Re-include those" for houses that Remove apartments held out by mistake, and "M of them are in this cut": they
  matter for campaigns imported before Release 1. Nye starts fresh.
- "Placed approximately": Release 1 places only on exact rooftops.

## Effort

About 5 working days: server payloads 0.5, web Map and panels 1.5, Turf Cutting 0.75, phone canvasser screens
1.25, phone lead and admin screens 1, tests, docs, Help Center and privacy 1.

---

# Part 2 — Technical reference

Section and Screen numbers are the reference's; where a row says "as specified", the reference's text is the
spec.

## A. Server

| Change | Where | Notes |
|---|---|---|
| Effective `pinSuspect` on every household row that carries a pin | `routes/admin/households.js` (`/map` mapper), `routes/admin/turfs.js` (`/doors`, the drill), `routes/mobile/bootstrap.js` (bootstrap per-door loop and **every** door in `/changes`) | `effectivePinSuspect(h)`; the field is left out when null, so a vouched home never reaches a client flagged (§J, §K). Bootstrap and `/changes` share one `HOUSEHOLD_PIN_PROJECTION` that adds `pinSuspect`. |
| Placement summary | `/households/map` rows and the turf drill | `pinPlaced: { at, inPlace, stackSize }` only while the lookup's pin is current (`isPlacedByLookup`); `inPlace` when `from` and `to` share a key. |
| `sameAddress: { count, unplaced }` | `GET /admin/households/:householdId/activity` | Counts active doors at the door's key with its `stackBaseOf` (the `sameAddressDoors` set), and whether any is unplaced now. Drives "Whole building (N units)" and its Save gate on the web Map and the phone admin map (§G). |

## B. Web

| File | Change |
|---|---|
| `client/src/lib/buildings.js` | `groupHouseholds` gains `kind` (`unplaced` when any member is `'placeholder'` or no member is free of `pinSuspect`, else `building`) and `strays`; new `addressGroups(units)` and `buildingMovePrimary(units)`; `buildingLabel` "N homes" (§J). |
| `client/src/lib/mapRender.js` | `householdsToGeoJSON` adds `pinSuspect`; `buildingsToGeoJSON` adds `unplaced`; canvas images `unplaced-{none,partial,done}`; `building-symbols` icon and text `case` on `unplaced`; the ring filter adds the `pinSuspect` term (§J). |
| `client/src/pages/MapPage.jsx` | Two panel sources (`stackKey`, `stackIds`), the Back bar restoring whichever opened the list, the header pill counting "N homes without an exact spot" (§J). |
| `client/src/components/DoorStackPanel.jsx` | Verdict from the flags (the inline classifier goes), three notes (building, homes, near-here), address groups (Screen 3). |
| `client/src/components/HouseholdDetailPanel.jsx` | The badge chain and the placement lines (Screen 4); Move pin reads `sameAddress` and asks "Just this unit / Whole building (N units)"; the building Save gate uses `sameAddress.unplaced`. |
| `client/src/pages/TurfsPage.jsx` + `lib/buildingMarkers.js` | `groupDoors` carries `kind`; a pure `markerLabel({ kind, count, badgeText })` feeds the element and `markerSig`; the unplaced `BuildingPopup` (Screen 6) with per-row Move pin, Mark restricted… / Unmark, Move to book…, "Move these N units" per address group, "Move all to book…", "Mark all N restricted…"; `HousePopup` badge chain. |
| `client/src/components/AnswerMiniMap.jsx` | `DoorCard` reads "N homes at one map spot" for an unplaced group. |
| `client/src/pages/PinFixesPage.jsx` | Intro mentions the "N homes" marker; the spot click already selects through `pickSpotRow`. |

## C. Mobile (over the air)

| File | Change |
|---|---|
| `mobile/lib/streetName.js` (new) | The `stackBaseOf` mirror; `server/test/streetNameDrift.test.js` gains the mobile copy. |
| `mobile/lib/buildings.js` | `kind` and `strays` as on the web; roll-ups guarded against an empty list; new `buildings.test.js`. |
| `mobile/lib/listEntries.js` (new, pure) | `buildListEntries`: no distance and the "No exact map spot" section for an unplaced door or an unplaced group; the group's sort key is its lowest house number on its street; a `section` entry kind (§K). |
| `mobile/lib/deltaFold.js` | `foldDeltaHouseholds(prev, delta)` (folds `pinSuspect` and the location trio, keeps today's suppression drop) and `reconcileLocationResponse(prev, id, response)` (§K). |
| `mobile/app/(app)/map.jsx` + `scripts/genMarkerIcons.js` | Unplaced PNGs, the layer matching on kind, "N homes · N done", the list via `buildListEntries`, the camera fit skipping unplaced doors. |
| `mobile/app/(app)/building.jsx` | The unplaced variant (Screen 7): per-row Directions, street-then-number order, no header Directions; a real building lists strays under "Not part of this building". |
| `mobile/app/(app)/household/[id].jsx` | The badge chain with "No exact map spot" first, the explainer card, `siblingCount` by key and `stackBaseOf`. |
| `mobile/components/FixPinModal.jsx` | Reset on open; for an unplaced door (or same-address sibling): open on the spot, seed at the lead's fix within 500 m with a ref and an ignore flag cleared in cleanup, Save only after a drag or "Use my current location" more than 1.5 m off the spot, the on-spot note, "Nothing moved" after an online `moved: 0`; `androidAlertOrder` for the scope prompt (§K). |
| `mobile/lib/recordAction.js` | The optimistic patch clears `pinSuspect` and the confirm stamp; the reconcile goes through `reconcileLocationResponse`; `moved: 0` clears the pending location. |
| `mobile/app/(app)/admin/map.jsx` | Hits grouped by key and address in the chooser; Move pin's scope question from `sameAddress`; the move bar's Save gate on an unplaced target; "Moved N units"; `householdsToFeatures` adds `pinSuspect` and the ring term; the badge chain. |

**Compatibility:** old apps ignore the new fields; the server already limits "Whole building" to one street
address and no-ops a save onto the spot (Release 1). No `CLIENT_API_VERSION` bump.

## D. Tests

- Web: `buildings.test.js` (kind, strays, `addressGroups`, `buildingMovePrimary`), `buildingMarkers.test.js`
  (`markerLabel`), `mapRender.test.js` (the ring filter and the unplaced case), render smokes for the Map panel and
  the Turf pop-up.
- Mobile: `buildings.test.js`, `listEntries.test.js` (a building plus a stray, an unplaced group's title, meta and
  sort key, a lone stray, a strays-only group), `deltaFold.test.js` (`foldDeltaHouseholds`,
  `reconcileLocationResponse`), the street-name drift test.
- Server: the payload fields per route (left out when vouched), `sameAddress` counts, `/changes` carrying the flag
  on a door with no per-round entry.

## E. Docs and Help Center

MAPS.md (the marker, panels, badges, the Map Move pin question), PASSES_AND_TURF.md (the pop-up), CANVASSER_APP.md
and ADMIN_APP.md (the phone screens), the privacy stamp; Help Center: guides/maps.md, pages/page-map.md,
pages/page-turf-cutting.md, guides/canvasser-map.md, guides/fix-pin-location.md.

## F. As built (2026-10-05)

Built as planned: A–E. Where the build differs, or adds something the plan didn't name:

1. **The order question resolved itself:** the GPS phone step was already committed (`d2903dc`), so the server,
   web and phone parts were built together in one clean folder.
2. **The phone admin map had no stack chooser at all** — a tap opened whichever pin was on top
   (`e.features[0]`). It now gathers every door at the tapped pin's key (`stackForTap`) and lists them by
   address (`addressGroupsOf`). The web survey mini-map (`AnswerMiniMap`) likewise reads every hit now.
3. **A stack row's Move pin on the web Map** opens that door and starts its move once the server's
   `sameAddress` is known (`HouseholdDetailPanel` `autoMove`), so the "Whole building (N units)" question always
   uses the server's count. The panel's Move pin waits for that count.
4. **The phone's pin POST answers `locationConfirmedAt`** as well, so `reconcileLocationResponse` restores the
   whole pin state after a no-op. The pending-location overlay clears the flag and the stamp the same way the
   optimistic move does.
5. **Turf per-home Mark restricted…** asks with a one-line confirm per home; **Unmark** shows only on homes with
   desk marks.
6. **Help Center** articles say which phone parts arrive with the app update, because help copy goes live with
   the server deploy.
7. **Tests.** Server: `pinWire.int.test.js` (4), the phone copy added to `streetNameDrift.test.js`. Web:
   `buildings.test.js` (+3), `pinBadges.test.js` (3), `mapRender.test.js` (+1), `buildingMarkers.test.js` (+1),
   `stackPanelsRender.smoke.test.js` (3). Phone: `buildings.test.js` (6), `listEntries.test.js` (3),
   `deltaFold.test.js` (+3), `fixPin.test.js` (4), `pinBadge.test.js` (1). **Not covered by automated tests:**
   the Turf pop-up's render (the component is internal to the page) and the phone screens themselves — their
   logic lives in the tested `mobile/lib` helpers, the screens were checked by a parse and an undefined-name
   pass, and they need a run on a test phone in the staging lane before production.
8. **Verification.** Web 565 of 565 and the build; server unit 477 pass, 0 fail; all 121 database suites, 1,375
   tests, 0 fail; phone 181 of 181;
   `npm run ota:check` matched the latest production and staging builds on both platforms (the new PNGs are
   JavaScript assets).
