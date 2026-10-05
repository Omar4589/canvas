# Release 1: homes that share a map spot — placed by address when a file is imported

> **Status: BUILT 2026-10-05 (uncommitted at time of writing), to the plan and design the owner approved the
> same day. A server deploy plus the web build — nothing ships to phones. Where the build differs from the plan
> is listed in "F. As built", at the end.** This is the release the owner chose: get the Nye campaign right,
> starting fresh, and leave existing campaigns for later. It is cut down from
> [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md) (revision 7, six review rounds), which stays the
> reference for the detailed rules (cited below as "the reference, §X") and for the later work.
>
> Canvassing on Nye starts when this release is live. The owner has set `GEOCODE_ENABLED=true`.

---

# Part 1 — For everyone

## The problem

A voter-file vendor that can't place a home gives it the middle of its ZIP+4 block instead, so several
different houses get the identical map coordinate. Doorline then draws them as one apartment building, and the
tools that trust "same spot means same building" get them wrong. On the Nye file, 122 map spots hold more than
one street address (484 homes); the ten houses at 5001–5096 E Monte Penne Way show as one "10-unit building".

## What this release does

- **When a file is imported, Doorline finds the homes that share a map spot with a different street address,
  and looks each one up by its own address.** Units of one street address (Apt 1, Apt 2…) are a real building
  and are left alone.
- **It moves a home only when the answer passes every check:**
  - it is an exact rooftop, not a street-level guess;
  - it is in the address's own ZIP and state;
  - no other address got the same answer (that would mean the lookup is guessing too);
  - the pin isn't one a person already moved or confirmed.
- **Homes it can't place stay where they are, marked "No exact map spot", and are listed in Pin Fixes.** A lead
  drags each one onto its house, or marks it "Looks right" if it really is there.
- **"Whole building" pin moves** (web and phone) move only the units of that one street address, never the other
  houses on the spot.
- **Remove apartments takes real apartments only:** a street address with N or more units on its spot, or a door
  whose address names a unit on a spot holding N or more doors. A separate house is never held out because it
  shares a spot.
- **The import says what happened,** for example: "Map pins: 412 placed by address · 9 confirmed at their spot ·
  60 without an exact spot (Pin Fixes)".
- **This applies to every import from now on,** in every campaign and organization, not only Nye. Older homes
  already in a campaign are left as they are until a file containing them is imported again.

## What waits for release 2 (right after canvassing starts)

The "N homes" marker and lists on the web map, in Turf Cutting and on phones, and the phone's Fix pin changes.
Until then, a home Doorline couldn't place still looks like part of a building on the maps; it is fixed from Pin
Fixes. Once the leads have worked through Pin Fixes, no two different addresses share a spot on Nye, so phones
need no update to canvass it.

## What is left for later (not scheduled)

- Existing campaigns. They are fixed when they next import a file, or later with a cleanup tool.
- Forgiving "Far" GPS flags at homes still on a shared spot. Until a lead moves such a pin, knocks there are judged
  as they are today; once the pin is moved, the audit already forgives knocks made at the real house.
- Street-level estimates. Only exact rooftops are used.
- Two imports placing pins in one campaign at the same time. The second marks its homes and says to import it
  again.

## How it ships

0. **Owner, before deploying:**
   - confirm the privacy note below;
   - in the Heroku dashboard → Settings → Config Vars, check `GEOCODE_ENABLED` is `true` (done) and
     `GEOCODIO_API_KEY` is set.
1. **Server deploy** (web included), from `main` as usual.
2. **Heroku dashboard → More → Run console:** `npm run migrate:build-indexes -- --apply`. One new index; production
   builds indexes by hand.
3. **Import the Nye file again** into the Nye campaign. It updates the same homes in place (no duplicates), looks
   up the ones that share a spot, and adds the homes with no coordinates that an import with lookups off skipped.
   Read the "Map pins" line it shows.
4. **Leads work through Pin Fixes** until nothing is left for Nye.
5. If Remove apartments was already used on Nye, click **Re-include** (before publishing), then run Remove
   apartments again.
6. Cut turf, publish and canvass.

Release 2 then ships as a second server deploy plus a phone update (`npm run ota:staging`, device checks,
`npm run ota:production`).

## Privacy — said out loud

**This affects what our privacy record says about Geocodio.** Today Doorline sends Geocodio only addresses that
arrive *without* coordinates (plus the repair script, which a person runs by hand). After this release, an import
also sends the addresses that share a map spot with another address, even though the file gave coordinates.
- Same service, same purpose, same fields: line 1 as the file gave it, city, state and ZIP. Never line 2, never a
  name.
- No published sentence changes (privacy.html only says we send the street address, never a name), and it is not
  a new subprocessor, so no DPA §6 notice.
- `docs/PRIVACY_VERIFICATION.md` gets the dated notes from the reference, §O, trimmed to what this release
  builds: Changes 1–5 and 7, and Change 6 for `pinSuspect` only (there is no `knockPin` in this release). The
  notes drop what isn't built (the follow-up job, `pins:check`, the repair-script peek). **The owner confirms
  them before the deploy.**
- Cost: about $1 per 1,000 new lookups (internal estimate); about $0.50 for Nye. Each import looks up at most
  25,000 homes.

## Design — the screens this release changes

Everything below reuses today's components, spacing and tokens; only the words and the new states are new.

**1. Import preview** — today's amber "Doors imported with a suspect map pin" block gets new words:

```
▸ 481 homes share a map spot with other addresses
  These homes were all given the same coordinate, so they can't each be on the map.
  After import, Doorline looks each one up by its address. Any it can't place keep
  that spot and are listed in Pin Fixes.
  1 home sits on an apartment building's or park's spot but has a different address.
```

With lookups off, the second sentence becomes "Doorline marks them, and they're listed in Pin Fixes." The last line
shows only when there are such homes.

**2. Import list** — a new stage while it works, then one line under the file name (like today's "geocoded N"):

```
When        File                          Status
10/5 4:12p  NCDC(Data)(NyeCounty)…csv     ● Checking map pins

10/5 4:13p  NCDC(Data)(NyeCounty)…csv     ✓ Completed
            geocoded 14
            Map pins: 412 placed by address · 9 confirmed at their spot · 60 without an exact spot (Pin Fixes →)
```

Parts that are zero are left out. The two other endings:

```
            Map pins weren't placed: another import was placing pins in this campaign. Import the file again to place them.
            Map pins weren't checked this time. Import the file again to try again.
```

**3. Pin Fixes** — the list, the card and the keyboard:

```
Pin Fixes
These homes need a pin check. Some were placed from the street address (the amber
rings); others have no exact map spot, because their coordinate was shared with
other addresses. Click a pin or a row, then drag it onto the real house, or confirm
it if it's already right. Switch the map to Hybrid for satellite imagery.
61 doors to review

E MONTE PENNE WAY
  5016 E Monte Penne Way
  No exact map spot · Pahrump, NV 89061
  5021 E Monte Penne Way
  No exact map spot · Pahrump, NV 89061
MAIN ST
  4 units at 100 Main St
  No exact map spot · Pahrump, NV 89048
```

Units of one street address on one spot share a row; separate homes never do.

```
┌──────────────────────────────────────────────────────────────┐
│ 5016 E Monte Penne Way                                     ✕ │
│ No exact map spot · Pahrump, NV 89061                        │
│ Its coordinate was shared with other addresses.              │
│ [Move pin]  [Looks right — the home is here]  [Google Maps ↗]│
│ ←                     3 of 61 pins                         → │
│ ← → next / prev · G maps · Esc close                         │
└──────────────────────────────────────────────────────────────┘
```

- On these rows **Enter does nothing** and the hint drops "Enter confirm" (the owner's decision). Arrow keys work
  as today. Approximate-geocode rows keep "Looks right — confirm" and Enter, as today.
- **Looks right asks once:** "This home's map spot was shared with other addresses. Confirm the home is really
  here?" [Cancel] [Confirm].
- **Move pin:** Save stays off until the pin is dragged more than 1.5 m (about 5 ft) off the spot. If the server
  answers that nothing moved: "Nothing moved — drag the pin onto the house", and the card stays open.
- **If the pin changed since the page loaded** (another lead, or an import): "This pin changed since the page
  loaded — reloading." The list reloads.
- The empty state adds "…and every home that shared a map spot has been placed or confirmed." The sidebar badge
  reads "N pins to fix".

**4. Turf Cutting** — the Remove apartments line counts what the button will really take:

```
Remove apartments  [ 4 ] units or more
Holds out 441 homes on 61 spots (4+ units at one address, or a unit address on a spot of 4+)   [Remove apartments]
```

**5. Super-admin Imports page** — the cost column adds the pin lookups, and a row badge shows a pin check that
failed, was busy, or hit the 25,000 ceiling, with the full cause ("HTTP 401", "timeout", "busy…").

---

# Part 2 — Technical reference

Section numbers refer to [the reference](PROPOSAL_PLACEHOLDER_PINS.md). Where a row says "as specified", the
reference's text is the spec, including the fixes its six review rounds made.

## A. What is built, and how it differs from the reference

| Piece | Spec | Release-1 differences |
|---|---|---|
| Address key: `stripUnits`, `stackBaseOf`, `isUnitAddress`, `homeKeyOf` in `server/src/utils/streetName.js`; `stripUnits` + `stackBaseOf` in `client/src/lib/streetName.js` | §D; the reference implementation `stackbase7.mjs` (130 `stackBaseOf` cases, 55 `isUnitAddress` cases, 25 `homeKeyOf` pairs) | `UNIT_SUFFIX` is not changed and packets are not touched (D5 waits). The mobile mirror waits for release 2. The drift test covers server and web. |
| `Household.pinSuspect`, `pinPlacement`, `pinDistrustedKeys`; the `{ campaignId, pinSuspect }` partial index | §C | `pinPlacement.accuracyType` is only ever `rooftop` or `point`. |
| `Campaign.pinPass` lease | §C | Taken only by an import whose lookups are allowed. |
| ImportJob fields and `ORG_HIDDEN_IMPORT_FIELDS` | §C, §F | Kept: `strayPinDoors`, `pinsPlacedExact`, `pinsConfirmedInPlace`, `pinsStillUnplaced`, `pinLookupsNew/Cached/OverCap`, `pinProbedIds`, `keptPlacements`, `pinPassError`, `pinPassCause`. Not built: `pinStackHomes`, `pinsPlacedApprox`, `pinPendingIds`, `pinFollowUp`. |
| The pass, `services/households/placeStackedPins.js`, import mode only | §E steps 1–7, 9, 10 | See B. No `check` mode, `dryRun`, `overrides` or `repairCollapseReverts`; no step 8 (freeze) or 11 (run modes). |
| `pinTrust.js` with `stackPolicy` and `isPointClaim` | §E step 6 | `range_interpolation` is always refused (no calibration, so `PIN_PLACEMENT_MAX_INTERP_M` and the street-outlier test are not built). `repairPolicy` is not built: the repair script is unchanged. |
| `applyImport` placement rules (prefetch, first test, the rows table) | §F | As specified, so a later refresh of Nye keeps placed pins and lets a real vendor change win. |
| Import wiring: phase `pins`, `STATUS_LABEL.pins`, the heartbeat helper, non-fatal failure | §F `importProcessor.js` | No follow-up job. The recovery for a busy or failed pass is importing the file again. |
| Preview: `finish()` per home, `strayPinDoors` at every hop, the copy | §F | Copy as in Part 1, Design 1. |
| `updateHouseholdLocation`: `sameAddressDoors`, one pipeline write, the no-op cases, the cast | §G | As specified. The mobile response's `locationConfirmedAt` waits for release 2. |
| `confirmHouseholdLocation`: unplaced allowed, `expectedCoordinates`, `PIN_CHANGED`, conditional writes, address fan-out, undo by stamp | §G | As specified. |
| Pin Fixes: `UNPLACED_PIN`, two-query list and count, rows by key and `stackBaseOf`, `enterAction` / `popupKeyAction` / `popupHint`, the Save gate, "Nothing moved", `PIN_CHANGED` refetch, copy | §I, §J (web Move pin) | No `estimatedPlacement` (there are no street-level placements). |
| Remove apartments: `services/turf/apartmentStacks.js`, `POST …/exclude-apartments`, `GET …/turfs/apartment-preview` | §H | The preview returns `{ candidates: { ids, takenUpTo, spot }, … }` without `nonApartmentExcluded`; no "M of them are in this cut", no restricted-ids query, no "Re-include those" button, no `supplementalDoorFilter` change. |
| Import page and super-admin Imports page | §J | No `importsPollInterval` (no follow-up to wait for). |
| Docs, Help Center, privacy record | §N, §O | Only the rows for what this release builds (C below). |

## B. The pass in this release

The order is the reference's, minus the freeze: lease → load → classify → sort → marks → look up → gate → write →
outlines → tally.

- **Lease (§C).** Taken before step 1 when lookups are allowed (`GEOCODE_ENABLED === 'true'` and a key), renewed on
  its own 30 s timer, re-checked before the marks and before every write batch, released in `finally`, with a
  per-run owner token and a 90 s stale takeover. **If it is held** by another import in the campaign, this import
  still marks its homes and writes its tally, buys nothing, and sets `pinPassError` to "Map pins weren't placed:
  another import was placing pins in this campaign. Import the file again to place them." and `pinPassCause` to
  "busy". With lookups off, the pass marks only and never touches the lease.
- **Load (§E step 1)** — the per-home model as specified: active and inactive doors, one member per home by
  `homeKeyOf`, emptied homes voting, departures from `pinPlacement.from` (never an in-place `from`) proving their
  address wrong, shared-spot history, a re-keyed door inheriting its old door's mark. **Not built:** repair-script
  departures and piles (step 1b). Both exist only in campaigns from before this release; there, a spot those
  touched reads as it does today.
- **Classify and sort (§E steps 2–3)** as specified, without the pile bullet.
- **Marks (step 4), look up (step 5), gate (step 6), write (step 7)** as specified: this file's candidates only, in
  a fixed order; the 25,000-home ceiling with its probed-id ledger; null-coordinate probes through `resolve()`; the
  stop on the first failed provider chunk, with the fixed cause mapping; the three deletion re-checks before each
  chunk; the `geocodeBatch` test seam; the collapse set and the claims-only rule; a previous placement reverted
  and both keys distrusted on a collision; conditional filters on every write.
- **Outlines (step 9)** as specified: a live round whose book holds a door this run placed or reverted is redrawn
  once.
- **Tally (step 10)**, import mode, over this file's homes: placed in place → `pinsConfirmedInPlace`; rooftop or point
  → `pinsPlacedExact`; still unplaced → `pinsStillUnplaced`.

**What the dropped freeze costs, and why it is safe now:** the freeze stamped knocks recorded before a home was
marked. On a campaign that starts fresh, every home is marked and placed at import, before anyone knocks, so there
is nothing to stamp, and the GPS audit is unchanged from today. The one later gap is a refresh that puts a new home
on the spot of a home already knocked; those older knocks are judged as they are today.

## C. Files, docs and Help Center

- **Server:** `utils/streetName.js`, `utils/normalizeAddress.js` (export `STREET_WORDS`), `models/Household.js`,
  `models/Campaign.js`, `models/ImportJob.js`, `services/households/pinTrust.js` (new),
  `services/households/placeStackedPins.js` (new), `services/import/csvImporter.js`, `services/import/importProcessor.js`,
  `services/import/geocode/geocodeService.js` (the `geocodeBatch` option is already injectable),
  `services/households/updateHouseholdLocation.js`, `services/households/confirmHouseholdLocation.js`,
  `services/reports/campaignSummaries.js`, `services/turf/apartmentStacks.js` (new), `routes/admin/imports.js`,
  `routes/admin/campaignHouseholds.js`, `routes/admin/turfs.js`, `routes/mobile/canvass.js` (report `moved` and the
  effective flag on the location POST), `routes/superAdmin/imports.js`, `migrations/buildIndexes.js` if the index
  list needs it.
- **Web:** `lib/streetName.js`, `lib/pinFixes.js`, `lib/movePin.js`, `lib/useMovePin.js`, `components/MovePinCard.jsx`,
  `pages/PinFixesPage.jsx`, `pages/ImportPage.jsx`, `pages/TurfsPage.jsx` (the Remove apartments line only),
  `pages/SuperAdminImportsPage.jsx`, `components/Layout.jsx` (the sidebar tooltip).
- **Docs** (Part 1 plain, Part 2 technical, per `docs/README.md`): IMPORTS.md (placement at import, the summary line,
  the recovery), MAPS.md (Pin Fixes, Looks right, Enter, the Save gate), PASSES_AND_TURF.md (Remove apartments),
  OPERATIONS.md (`GEOCODE_ENABLED`, the index gate, "import again" as the recovery), PRIVACY_VERIFICATION.md (§O
  stamps).
- **Help Center:** guides/voter-imports.md, pages/page-voter-import.md, pages/page-pin-fixes.md,
  guides/fix-pin-location.md, guides/turf-and-books.md, pages/page-turf-cutting.md; "Why are several houses on one
  dot?" goes to faq/_INBOX.md first.
- **Shared folder:** the GPS session is editing `updateHouseholdLocation.js` and other files in the same folder.
  Release-1 edits are kept to their own lines, and the owner commits only when neither piece of work is half done,
  because `git add -A` takes both.

## D. Tests

From the reference's §P, the cases for what this release builds:
- `pinTrust.test.js` (type, ZIP, state, distrusted keys, collapse, claims, the stray tier) and `isPointClaim`;
- `streetNameDrift.test.js` (130 cases on server and web; the 55 and 25 on the server);
- `importPlaceholderPins.int.test.js`: outcomes, scope, no dropped door, re-runs and re-imports, the stacks-and-spots
  cases (re-keyed strays placed twice, re-keyed neighbours, a building losing units, two records of one home, an
  in-place placement then a one-unit move, a later unit of a flagged building, a neighbour's
  `nearest_rooftop_match`, collapses across files), lookups off, the ceiling, the ledger, the outage stop and cause
  mapping, the deletion stops, the lease (a second import marks only and says so; a stale lease is taken over;
  the timer keeps a slow pass's lease), the tally, the outline redraw;
- `pinFixes.int.test.js` cases from the reference (queue, confirm and Undo, `PIN_CHANGED`, building moves and
  confirms, the no-ops, test 5 rewritten), and the routes' `pinSuspect`;
- `apartmentStacks.int.test.js`: the shape, the GET counts equal the POST at N, the rules, Monte Penne never taken;
- `orgImportFields.int.test.js`: the hidden fields;
- client: `pinFixes.test.js` (rows, `enterAction`, `popupKeyAction`, `popupHint`, `confirmErrorMessage`),
  `movePin.test.js` (the no-op), `streetName.test.js`.

**Before the production re-import,** the Nye file goes through a local import with the provider mocked, to check
the marks, the counts and the summary line on the real file (counts only; the file is PII).

## E. Effort

About half of the reference's 28 days, on the same one-person yardstick, including tests:

| Workstream | Days |
|---|---|
| Server: address key 0.75, model and index 0.5, the pass with its lease, lookup and gate 3.5, `applyImport` rules 1, import wiring and preview 1, the two pin writers 1.75, Pin Fixes queue 0.5, Remove apartments 0.75 | about 9.75 |
| Web: Pin Fixes page 1, Import and super-admin pages 0.5, the Turf Cutting line 0.25 | about 1.75 |
| Docs, Help Center, privacy record | about 1 |
| Tests and verification, including the local Nye run | about 2 |
| **Release 1** | **about 14.5** |

Release 2 (the map and phone screens) is about 5 more.

## F. As built (2026-10-05)

Built as planned: everything in A–C. Where the build differs, or adds something the plan didn't name:

1. **`pinLookupsNew` counts the addresses the provider answered** — what Geocodio bills, matched or not —
   counted at the provider call. `resolve()`'s `geocodedNew` counts matched *doors*, so it missed every
   unmatched address (on the Nye rehearsal it read 427 where 482 were sent). Pinned by test 3 of
   `importPlaceholderPins.int.test.js`. The same undercount exists, unchanged, in ordinary import geocoding's
   `geocodedNew`, which the super-admin cost also reads; not touched here.
2. **The import preview keeps ties in their own block.** "Doors imported with a suspect map pin" now holds only
   rows that disagreed about a house's pin; the shared-spot homes get the new block, counting placeholder and
   stray doors together (the homes the pass will mark). The geocoding panel's "The import is now free (cached)"
   is qualified when homes share a spot.
3. **Pin Fixes map clicks on a shared spot.** The map still draws one glyph per spot, and rows now split a spot by
   address, so a glyph click selects the spot's first row and each further click the next (`spotRowKeys`,
   `pickSpotRow` in `client/src/lib/pinFixes.js`). Without it a click on such a glyph selected nothing.
4. **Turf Cutting's Move building pin** counts the same address's units in its card, and a door alone at its
   address on a shared spot moves as one door, so the card never says "moves all 6 units" for six separate
   houses. The Map page's stack panel note now points at Pin Fixes instead of the pin repair.
5. **The sidebar tooltip** reads "N pins to fix" (both kinds); the super-admin "New lookups" card includes pin
   lookups (its hint gives the pin share) and its CSVs gain Pin lookups (and, per import, Pin check) columns.
6. **Tests.** Built: `pinTrust.test.js`, `streetNameDrift.test.js`, `importPlaceholderPins.int.test.js` (14:
   outcomes, buildings and strays, refusals, re-import, vendor change, lookups off, a person's pin, outage and
   cause, the lease, the ceiling, a re-spelled stray, a later unit of a flagged address, the outline redraw, the
   deletion stop), `placeholderPinWriters.int.test.js` (10), `pinFixes.int.test.js` (9, test 5 rewritten),
   `apartmentStacks.int.test.js` (5), `orgImportFields.int.test.js` (4), and on the web `pinFixes.test.js`,
   `movePin.test.js`, `importPins.test.js`, `apartmentPreview.test.js`. **Not written as their own tests:** the
   lease heartbeat keeping a slow pass alive, a building losing units, re-keyed neighbours, an in-place placement
   followed by a one-unit move, collapses across two files, and a retried job reusing its ledger. The rules behind
   them were checked by the planning replay (49 of 49 scenarios), not by tests in the repo.
7. **Verification.** Web 553 of 553; server unit 474 pass, 0 fail; the whole database suite 1,358 pass, 0 fail,
   before the last additions, which then passed on their own (`importPlaceholderPins` 14 of 14,
   `apartmentStacks` 5 of 5, `orgImportFields` 4 of 4, `help` 3 of 3). `npm run migrate:build-indexes -- --apply`
   was run from the repo root against a throwaway database and built `{ campaignId: 1, pinSuspect: 1 }`.
8. **The Nye rehearsal** (the real file, a throwaway database, Geocodio faked: 70% own rooftop, 10%
   range_interpolation, 10% no match, 10% one shared answer). Counts only:
   - 14,141 rows, 8,543 homes, 0 doors lost; the preview counts 481 placeholder doors on 121 spots plus 1 stray.
   - A fresh import: 337 placed, 145 left for Pin Fixes, 482 lookups bought, 46 doors refused for a shared answer
     and remembering it; every minority door left on a mixed spot is flagged. About 11 seconds.
   - The same file again: nothing bought, 337 placements kept, the line reads "Map pins: 145 without an exact spot".
   - The production path (imported first with lookups off, then again with them on): the same 337 / 145, and the
     14 homes with no coordinates join on the second import.
   - Remove apartments at 4: 441 doors before placement, 429 after.
   The fake's split is invented; the real split depends on Geocodio's answers for Nye.
