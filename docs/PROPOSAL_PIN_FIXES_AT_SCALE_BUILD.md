# Build plan: Pin Fixes at scale

> **Status: BUILT 2026-10-10 (uncommitted at time of writing), S1–S12, to this plan's revision 7; the owner
> accepted the eight departures under "Changes from the approved design" with "build it". The build record —
> tests, the browser check, and what the build found and changed beyond this plan — closes §R. S13 is the
> owner's release.** Plan history: revision 7 (2026-10-10), ready to build after six adversarial review
> rounds against the code (§R), for the approved design
> [PROPOSAL_PIN_FIXES_AT_SCALE.md](PROPOSAL_PIN_FIXES_AT_SCALE.md) (revision 4, decisions D1–D15 approved by the
> owner 2026-10-10). Every file, function and line below was read in the current tree (commit
> `cd1829c` plus the uncommitted session-expiry work of another session, which this plan never touches).

---

# Part 1 — For everyone

## What gets built

The approved design, in one server-and-web change: the import refuses coordinates that can't be real and
catches pins far from their street; the address lookup uses one answer rule everywhere and recognises
condo complexes; homes nobody can place are parked and flagged instead of dropped or left in the ocean;
Pin Fixes groups its work by cause with *Look up by address*, *Place along the street* and *Set aside*; the
cut leaves flagged homes out unless told otherwise; the GPS audit stays fair at estimated pins and at
complexes. The phones need nothing new to render any of it; a later over-the-air update only changes words.

## In what order

Server utilities first (pure functions with their own tests), then the schema and the shared predicates,
then the import pipeline and the placement pass, then the routes, then the web pages, then the operator
script, then docs and the Help Center. Each step leaves the test suites green on its own, so the build can
pause between steps without leaving the tree broken. The web steps can start as soon as the routes exist.

## What you will do at release

Read two Heroku config vars (both already set), deploy server and web from `main`, run the one-time
measurement command from the Run console (about thirty cents of lookups), then open Pin Fixes on Fairfield
and click *Look up by address* on the shared-spot card. Details in §Q.

---

# Part 2 — The build, step by step

**Conventions.** Plain JavaScript, arrow functions for new code, each file's neighbours matched. One owner per
mechanism (the proposal's §B); no inline copies of a rule that has an owner. `grep -a` for the three
NUL-bearing files. Unit tests run with `node --test` from `server/` and `client/`; integration tests with
`npm run test:int` from `server/` (one `before()` per file, no `await import` between `test()` definitions).
Every step names what it changes, where, and the test that proves it. "Done when" is the exit condition.

**Vocabulary.** *Kind* = a `pinSuspect` value: `placeholder`, `stray` (today), `far`, `unlocated`, `complex`
(new). *Class* = where an answer or a pin sits on the ladder: answers are `exact` / `estimate` / `street` /
`none`; pins are class 0 (no usable coordinate: `unlocated`, refused), 1 (`far`), 2 (`placeholder`/`stray`),
3 (an ordinary pin — never a lookup candidate). *Spot* = a ~1.1 m building key
([`utils/buildingKey.js`](../server/src/utils/buildingKey.js)). *Base* = `stackBaseOf(addressLine1)`, the
street address with its unit stripped ([`utils/streetName.js`](../server/src/utils/streetName.js)).

**The precedence ladder** (new, stated once here, used by S6 and S4): a door's stored `unlocated` or `complex`
beats any spot verdict; a spot verdict (`placeholder`/`stray`) beats `far`; `far` is recomputed from the
cohort on every pass and never sticks; a person's move or vouch beats everything and is never relabelled.

## Step map

| Step | What | Where | Depends on |
|---|---|---|---|
| S1 | Pure utilities: file-coordinate plausibility, cohort outliers, the answer ladder and complex verdict, the bare-unit parser rule | `utils/`, `services/households/pinTrust.js` | — |
| S2 | Geocode service: one classifier for import-time answers; accuracy travels | `services/import/geocode/geocodeService.js` | S1 |
| S3 | Schema, pin state and the queue predicates | `models/`, `services/households/pinState.js`, `confirmHouseholdLocation.js` | — |
| S4 | Import: refused coordinates survive; preview counts; the write builder | `services/import/csvImporter.js`, `computeImportDiff.js` | S1, S3 |
| S5 | Import worker: holding spot, lookups-off path, the `pin_lookup` job | `services/import/importProcessor.js`, `holdingSpot.js` (new) | S3, S4, S6 |
| S6 | The placement pass: far marks, the ladder, complexes, tallies | `services/households/placeStackedPins.js` | S1, S3 |
| S7 | Set aside, the spot-scope vouch, the writers that clear set-aside | `services/households/setAsidePin.js` (new), `updateHouseholdLocation.js`, `confirmHouseholdLocation.js` | S3 |
| S8 | Routes: Pin Fixes payload, pin lookup, set aside, cut toggle, Re-include guard, undo guard, knock stamps, audit | `routes/admin/*`, `routes/mobile/canvass.js`, `services/audit/*`, `services/reports/*` | S3, S5, S7 |
| S9 | Operator scripts: the measurement run; the repair script shares the cohort rule | `migrations/`, both `package.json` files | S1 |
| S10 | Web: Pin Fixes cards and modes, Turf toggle, Import copy, badges, markers, setup step | `client/src/` | S8 |
| S11 | Tests (the full list) | `server/src/**/*.test.js`, `server/test/*.int.test.js`, `client/src/lib/*.test.js` | each step |
| S12 | Docs, Help Center, privacy record | `docs/`, `server/src/content/help/` | S10 |
| S13 | Release | Heroku dashboard, Run console | all |

## Changes from the approved design, and why

Three things the code made clear once every line was read. Each is a smaller change than the design asked
for, in the same direction; none changes what the owner sees.

1. **D15 (bare unit numbers) moves out of the address parser and into the stack logic.** The design said
   "a trailing bare number after a street word is a unit", in `stripUnits`, mirrored to web and phone. Two
   facts stop that: the drift test's own fixtures end in a street word plus a number that is the *road's*
   number ("5001 Hwy 160", "1644 County Rd 78", "1101 S Nevada Highway 160"), and walk packets never used
   `stripUnits` (they read `UNIT_SUFFIX` and `streetOf`), so the "shared parser" premise was wrong. Instead,
   a pure `baseFamily(base)` in [`utils/streetName.js`](../server/src/utils/streetName.js) folds "533 BLACK
   ROCK TPKE 3" onto "533 BLACK ROCK TPKE" **only where a street address is compared with another on one
   spot** — the pass's spot verdict, the lookup's collision test, the preview's counts. `stackBaseOf`,
   `homeKeyOf`, packets and both mirrors are untouched. The two homes stay two doors; they stop being two
   *addresses* in the one place that mattered. The owner sees exactly what D15 promised.
2. **The far downgrades are frozen on the knock row, and that is the whole rule.** `farAssessment` reads
   nothing about the household (by design — [`flagDetection.js:52-54`](../server/src/services/audit/flagDetection.js)),
   so for an *estimated* pin "until a lead confirms or moves the pin" means: knocks recorded *after* the
   confirm carry no stamp; knocks recorded before keep theirs. A *complex* stamp survives a vouch on purpose
   (D14: the dot is the complex, vouched or not), so knocks there stay forgiven within 300 m. Nothing is
   re-derived.
3. **The setup-guide step never blocks "setup complete".** Approximate pins exist in most campaigns, so a
   step that demanded an empty queue would make every campaign read unfinished. The step is *done* when the
   queue is empty, *current* before books are cut while homes wait, and *skipped* once books are cut with
   homes still waiting.

4. **Today's phones treat a complex member like any flagged home in two places that are behaviour, not
   wording:** the canvasser's list files it under "No exact map spot" with no distance
   (`mobile/lib/listEntries.js:40-70`), and the map's camera framing leaves it out (`map.jsx:452`). The map
   marker and per-home Directions are right. The OTA fixes the list and the framing; S13.5 says so.
5. **The ZIP-boundary rule is the design's (same city), not a ZIP3 shortcut.** `zipMatches` accepts a
   ZIP5 mismatch only when the matched city equals the address's city, and — when a street cohort exists —
   the point is not an outlier against it. The matched city is read from the answer's formatted address,
   the way the matched ZIP already is, so cached answers get the same rule.

6. **One ladder, two confidence floors, chosen by what the home has.** An estimate that *fills* a home with
   no usable coordinate (class 0) needs Geocodio's existing floor (`GEOCODE_MIN_ACCURACY`, 0.5), exactly as
   coordinate-less files have always been placed; an estimate that *replaces* a spot that is roughly right
   (classes 1–2) needs the measured floor (`PIN_INTERP_MIN_ACCURACY`, 0.8) and the cohort test. The design's
   "a floor we measure once" is the second; parking a home over a 0.6-confidence block-level answer would be
   worse than placing it flagged.
7. **The "Couldn't be found by address" card offers *Look up by address* after all.** A provider outage parks
   homes with nothing cached, so the card is the retry path; when nothing changed, cached refusals answer
   for free and the toast says so.
8. **A complex converges on Geocodio's exact point, even at class 2.** The design said a complex keeps the
   vendor's spot unless that spot was no spot at all. Keeping it would make the complex's identity depend on
   which file arrived first and would strand a member re-judged alone (its own exact point holds no complex
   door, so it would be placed there by itself and leave the complex). Converging on the exact point gives
   every complex one canonical key across files and makes "an exact answer landing on a complex joins it" a
   single rule. On Fairfield the two points coincide, so nothing visible changes there.

Everything else is built as approved. Where a mechanism's name in the proposal does not exist in the code
(`FAR_ROW_FIELDS`, `canonStreetTokens`, `repairPolicy`, `services/reports/farKpi.js`), the step below names
the real one.

## S1 — Pure utilities

**Goal.** Every rule the pipeline needs, as pure functions with unit tests, before any behaviour changes.

### S1.1 File-coordinate plausibility — [`utils/stateBounds.js`](../server/src/utils/stateBounds.js)

- Add `export const OFF_WORLD_EPSILON = 1e-5;` and
  `export const isOffWorld = (lat, lng) => Math.abs(lat) < OFF_WORLD_EPSILON && Math.abs(lng) < OFF_WORLD_EPSILON;`
- Add `export const fileCoordRefusal = ({ lat, lng, state }) =>` returning `'offworld'` when `isOffWorld`,
  `'outside_state'` when `!inStateBounds(state, lat, lng)` (keeps failing open on an unknown state code,
  [`:36-41`](../server/src/utils/stateBounds.js)), else `null`. The range test stays in `mapRow`
  (`isValidLatLng` is unchanged).
- Tests, new `utils/stateBounds.test.js`: Null Island; ±0.000005; a CT house; a CT pair swapped
  (`-73.25, 41.17` → `outside_state`); an unknown state code with an absurd point → `null`; `isValidLatLng`
  untouched cases.

### S1.2 Cohort outliers — new `utils/pinCohorts.js`

- Move `median`, `medoidOf` and the body of `streetOutliers` out of
  [`migrations/repairImportPins.js:153-216`](../server/src/migrations/repairImportPins.js) into a pure module:
  ```js
  export const COHORT_DEFAULTS = Object.freeze({ minMeters: 250, minCohort: 3, outlierFactor: 4, zipMinMeters: 3000 });
  export const cohortOutliers = (points, opts) => Map<id, { distance, cohortSize, cohort: 'street' | 'zip' }>
  export const cohortThreshold = (centre, points, { minMeters, outlierFactor }) => number
  export const isCohortOutlier = (point, cohortPoints, opts) => boolean
  ```
  `points` are `{ id, lat, lng, street, zip5, spotKey }` — **every door**; the centre and spread of a cohort
  are computed over one point per `spotKey` (a tower is one opinion), and then **every door** past the
  threshold is flagged, exactly today's `for (const m of members)` at
  [`repairImportPins.js:208-210`](../server/src/migrations/repairImportPins.js). Street cohorts key on
  `${street}|${zip5}` and keep the medoid centre (streets are small). **ZIP fallback:** a point whose street cohort has fewer than `minCohort` spots is judged against its
  `zip5` cohort with `zipMinMeters` as the floor; a ZIP cohort under `minCohort` judges nothing. A ZIP cohort
  can hold tens of thousands of spots, so its centre is the **coordinate-wise median** (median latitude,
  median longitude — robust, O(k log k)), never the O(k²) medoid, and its spread is the median distance to
  that centre. `cohortSummary(points, kind)` returns `{ centre, threshold }` for one cohort — the medoid
  (streets) or the coordinate-wise median (ZIPs), and `threshold = max(minMeters, outlierFactor × median(dists.filter((d) => d > 0)))`
  exactly as today (`repairImportPins.js:207-208`) — and `isCohortOutlier(point, summary)` is
  `haversineMeters(point, summary.centre) > summary.threshold`. The pass builds every summary **once** and
  `cohortFor(c)` hands back the candidate's street summary (or its ZIP summary when the street has fewer than
  `minCohort` spots); nothing is recomputed per candidate.
- `repairImportPins.js` imports `cohortOutliers` and maps its households to points with
  `street: streetOf(h.addressLine1)`, `zip5`, `spotKey: buildingKeyForCoords(...)`, `minMeters: MIN_METERS`
  (the `--min-meters` flag, [`:131`](../server/src/migrations/repairImportPins.js)), `zipFallback: false`, so
  its output is byte-for-byte today's (signal 2 unchanged). Its local `median`/`medoidOf`/`streetOutliers`
  are deleted; `coordsOf` stays (`:261`, `:278`, `:412` read it).
- Tests, new `utils/pinCohorts.test.js`: the 4×-spread threshold with the 250 m floor; a long road is not
  flagged for being long; a 74-mile outlier is; a cohort of two judges nothing; the ZIP fallback catches a
  lone far home and leaves a lone near one; a building collapsed to one point; the ZIP centre is the
  coordinate-wise median and a 20,000-point ZIP cohort runs in well under a second; `isCohortOutlier` agrees
  with `cohortOutliers` on the same data.

### S1.3 The answer ladder, the complex verdict — [`services/households/pinTrust.js`](../server/src/services/households/pinTrust.js)

Keep `CLAIM_TYPES`, `zipOfMatched`, `isPointClaim`, `answerKey` (`placeStackedPins.js:14` and
`pinTrust.test.js` use them; the repair script has its own copies). Add:

- `export const ANSWER_CLASS = Object.freeze({ rooftop: 'exact', point: 'exact', range_interpolation: 'estimate', street_center: 'street', nearest_rooftop_match: 'street' });`
  `export const answerClass = (a) => ANSWER_CLASS[a?.accuracyType] || 'none';`
- `export const pinClass = ({ pinSuspect, coordSource, off }) =>` `0` for `pinSuspect` `unlocated`, for
  `coordSource: 'holding'`, or for `off` (the caller's `fileCoordRefusal({ lat, lng, state })` on the door's own
  coordinate — the pass passes its compact's `off`, so the legacy Fairfield doors still sitting at 0,0 with
  `coordSource: 'file'` are class 0 and any answer beats them), `1`
  for `far`, `2` for `placeholder`/`stray`/`complex` (a complex member is on a shared spot; a scoped lookup
  may re-judge it and its own exact point re-joins the complex, below), `3` otherwise.
- `export const cityOfMatched = (s) =>` the segment before the state-and-ZIP tail of a formatted address
  (`/,\s*([^,]+),\s*[A-Za-z]{2}\s+\d{5}(?:-\d{4})?$/` → "…, Norwalk, CT 06854" → "Norwalk"), the sibling of
  `zipOfMatched`; `null` when absent.
- `export const zipMatches = ({ matchedZip, matchedCity }, door, cohort) =>` — **one rule, every caller**:
  `true` when `matchedZip === zip5(door.zipCode)`; else `true` when `matchedCity` and `door.city` normalise
  equal (trim, lower-case, collapse spaces) **and** either no `cohort` is given or
  `!isCohortOutlier(answer, cohort.points, cohort.opts)`; else `false`. A missing matched ZIP → `false`. The
  caller derives the two fields from the answer's formatted address with `zipOfMatched`/`cityOfMatched`
  (the pass already does for the ZIP, [`placeStackedPins.js:359`](../server/src/services/households/placeStackedPins.js);
  `evaluate()` does the same from `r.matchedAddress`). The import-time caller has no cohort, so the same city
  alone carries a ZIP-boundary road there; the pass applies the cohort when the street has one.
- `export const answerBeats = (answer, door, { cohort, minAccuracy = PIN_INTERP_MIN_ACCURACY() }) =>`:
  `zipMatches(answer, door, cohort)` and `inStateBounds(door.state, lat, lng)` first; then by class — `exact` beats classes 0–2;
  `estimate` beats class 0 when `(answer.accuracy ?? 1) >= GEOCODE_MIN_ACCURACY` (0.5, the floor
  coordinate-less files have always had) and beats classes 1–2 when `>= minAccuracy` **and** (no cohort, or not
  a cohort outlier); `street` beats 0–1 only; `none` beats nothing (change #6).
  Both floors live in a new tiny module `services/import/geocode/geocodeFloors.js` —
  `GEOCODE_MIN_ACCURACY = () => num(process.env.GEOCODE_MIN_ACCURACY, 0.5)` (moved from `geocodeService.js:18`)
  and `PIN_INTERP_MIN_ACCURACY = () => num(process.env.PIN_INTERP_MIN_ACCURACY, 0.8)` — imported by both
  `pinTrust.js` and `geocodeService.js`, so the import graph stays acyclic (`geocodeService` → `pinTrust`,
  never back) and `pinTrust.test.js` keeps loading no model or provider.
- `export const lookupPolicy = ({ cands, answers, doorsOnKey, cohortFor }) =>` — `stackPolicy`
  ([`:52-112`](../server/src/services/households/pinTrust.js)) generalised; `stackPolicy` stays exported as
  `lookupPolicy` with no `cohortFor` and with the old shapes defaulted — `pinClass ?? 2`, `fam ?? base`,
  `accuracy ?? 1`, `city ?? null` — so `pinTrust.test.js`'s existing cases (`ans`/`cand` at `:11-12` carry
  none of the new fields) keep passing unchanged. Differences:
  1. A candidate carries `pinClass`, `fam` (its `baseFamily`) and `loc` (its current `[lng, lat]`); an answer
     carries `accuracy`, `matchedZip` and `matchedCity`. The `stackPolicy` alias defaults `loc` to `null`, and a
     null `loc` skips item 6.
  2. The claim test is `answerBeats(a, c, { cohort: cohortFor?.(c) })` instead of `isPointClaim`; the refusal
     reasons gain `'does not beat the current pin'` and `'an estimate outside its street'`.
  3. **Complex verdict**, after classing and **before the distrusted-key test** (`pinTrust.js:84-87`, today
     the head of the second loop) and before collisions. Two ways in: (a) group `exact` answers by
     `${c.key}|${answerKey(a)}` (vendor spot × answer point) — a group holding two or more distinct
     **addresses by the `sameAddress` rule** (different `fam` *and* not served by one `cacheKey`,
     `pinTrust.js:88`: two spellings of one address are one address) is a complex; (b) an `exact` answer whose key already holds a door marked `complex`
     (`doorsOnKey(k)` entries carry `complex: d.ps === 'complex'`) **joins** that complex. Members are returned
     as `complex: [{ id, key: answerKey, spotKey: c.key, moveTo: key !== c.key }]` — the complex **converges
     on the exact point** (change #8): a member already on it has `moveTo` false; a member on a vendor spot
     ~1.1 m or more away, a parked or far home, or a newly imported home whose exact point is the complex
     moves to it, and `pinComplexKey` is always the exact point's key — never `refused`, never `distrust`ed,
     and removed from the collision pool (their shared point is *the* point). **A door already marked
     `complex` on a key is never a collision victim and never a victim's accomplice:** in the `doorsOnKey`
     loop (`pinTrust.js:93-103`) a `d.complex` entry sets `collides = true` and `continue`s — tested **right
     after the same-address skip at `:94` and before the `d.placed` revert rule at `:95-99`**, because a moved
     member is also `placedByLookup` and the later rule would revert it — so the claimant (by then necessarily
     an `estimate`/`street` answer, since exact ones joined in (b)) is refused and distrusted as any colliding
     claimant is, and the complex door is neither reverted nor distrusted. So a later file can
     never send a complex's members back to a holding spot, and no estimate is ever placed onto a complex. A
     group whose answers are `estimate`/`street` is not a complex and goes through the ladder as today.
     **Why the verdict must precede the distrust test:** the release-1 pass already ran on Fairfield with
     lookups, refused every one of its collapses as "another address claims this point", and `$addToSet`
     that very key into each member's `pinDistrustedKeys` (`placeStackedPins.js:446-454`). With the
     distrust test first, the cached, free re-lookup would refuse all 46 Rowayton Woods members as "a point
     already distrusted for this home" and no complex would ever form. So a complex member **ignores a
     distrusted key equal to its own exact point** (that distrust is the old gate's record of the collapse
     that defines the complex); a distrusted key still refuses a *lone* claimant exactly as today.
  4. `sameAddress(o)` compares `fam`, not `base`, besides the `cacheKey` test — in **both** loops:
     `doorsOnKey` entries carry `fam` and the same-address skip at `:94` compares it, or a unit placed
     earlier ("857 POST ROAD 146" at X) would be reverted when "857 POST ROAD" claims X from a later file
     (change #1 covers the whole collision test, not half of it).
  5. Return `{ place, complex, refused, distrust, revert }`.
  6. **A far door whose answer agrees with its pin is confirmed in place.** For a class-1 candidate, an
     answer of class `exact`, or `estimate` at or above the 0.5 floor, within `COHORT_DEFAULTS.minMeters`
     (250 m) of the current pin — measured as `haversineMeters(c.loc[1], c.loc[0], a.lat, a.lng) <= COHORT_DEFAULTS.minMeters`,
     tested after `zipMatches`/`inStateBounds` and before the cohort test — is a `place` with `inPlace: true`
     and `near: true` and **no move**: the vendor pin stands (the write keeps `d.loc`, S6), the flag clears,
     and the write sets `coordSource: 'geocodio'`, so the door is no longer `fileish` and 2b never
     re-flags it — the repair script's "refuted: the address geocodes to where the pin already is" (228 on
     Fairfield). Without this a legitimately remote rural home could stay `far` for ever: an estimate near its
     true spot is itself a ZIP-cohort outlier and would be refused as a replacement.
- Tests, extend `pinTrust.test.js`: `answerClass` for every type; `pinClass` for every kind; `cityOfMatched`
  on Geocodio's formats; `zipMatches` — ZIP5 equal, same city with no cohort (accepted), same city inside the
  cohort (accepted), same city outside the cohort (refused), different city (refused), missing matched ZIP
  (refused); `answerBeats` truth table (4 classes × 4 pin classes), the accuracy floor, an estimate that is a
  cohort outlier, out of state; `lookupPolicy`: a complex of
  3 bases on one spot and one exact point → `complex` with `moveTo` false when the point is the spot and true
  otherwise (class 0 always moves); a single existing member re-judged alone gets `complex` again (joins its
  own key, no `inPlace` placement); an estimate aimed at a complex key is refused and the complex untouched;
  a new home from a later file whose exact point is an existing complex's key joins it instead of colliding,
  and no member is reverted; two bases sharing one `estimate` → both refused; a member with its own distinct
  rooftop placed alone; the bare-unit pair ("533 Black Rock Tpke" / "533 Black Rock Tpke 3") is one `fam`, so
  a shared exact answer is a placement, not a collision; a 0.6-confidence estimate fills a class-0 home but
  does not replace a class-2 spot; a far door whose rooftop or estimate lies within 250 m of its pin is
  confirmed in place and the flag clears; members carrying a legacy `pinDistrustedKeys` entry equal to their
  exact point still form a complex. Two existing cases are **rewritten, not kept**, because they are the
  Fairfield pattern: `pinTrust.test.js:37` ("two different addresses claiming one point are both refused, and
  both remember the key") becomes "…form a complex and neither remembers the key", and `:92` ("a distrusted
  key refuses its door but still counts against others") keeps its lone-door half and gains "…but not a
  complex group's own point". Every other existing `stackPolicy` case passes through `lookupPolicy` unchanged.

### S1.4 Base families — [`utils/streetName.js`](../server/src/utils/streetName.js)

- `export const NUMBERED_ROAD_WORDS = new Set(['HWY', 'HIGHWAY', 'RTE', 'ROUTE', 'RT', 'CR', 'SR', 'FM', 'RR', 'US', 'LOOP', 'SPUR']);`
  `export const ROAD_PREFIX_WORDS = new Set(['COUNTY', 'STATE', 'FARM', 'RANCH', 'TOWNSHIP', 'FOREST', 'FIRE', 'TOWN']);`
- `export const baseFamily = (base) =>`: on a `stackBaseOf` result, strip one trailing `\d{1,5}[A-Z]?` token
  when the previous token is in `STREET_TYPE` ([`:52`](../server/src/utils/streetName.js); keys, long forms
  and `EXTRA_STREET_TYPES`, directionals excluded), is **not** in `NUMBERED_ROAD_WORDS`, the token before it
  is **not** in `ROAD_PREFIX_WORDS`, **the name between the house number and the type holds at least one
  token that is not a directional** ("1000 WEST ROAD 36" is the numbered road "Road 36", not a unit), and at
  least three tokens remain. Otherwise return `base`. "857 POST ROAD 146" → "857 POST ROAD"; "533 BLACK ROCK
  TPKE 3" → "533 BLACK ROCK TPKE" (TPKE is not a `STREET_WORDS` key, so `stackBaseOf` leaves it as is);
  "1644 COUNTY RD 78", "5001 HIGHWAY 160", "1000 WEST ROAD 36", "1234 RM 2222", "100 SLIP 5", "100 PIER A",
  "10A BLOOMFIELD DR" → unchanged. Server only; no mirror, because only server code compares addresses on a
  spot.
- Tests, extend `server/test/streetNameDrift.test.js` with a `baseFamily` table (the ten above) and assert that
  `baseFamily` leaves **every** existing `stackBaseOf` fixture unchanged (none ends in a bare unit: the ones
  ending in a number are highways, "RM 2222" and "SLIP 5", none of which is a `STREET_TYPE` word), and that
  `stripUnits`, `stackBaseOf`, `homeKeyOf`, `UNIT_SUFFIX` are byte-for-byte what they were (the mirrors'
  equality checks already do this).

**Done when** `cd server && node --test` is green with the four new/extended test files and the repair script
imports `pinCohorts` (no behaviour change: `npm run repair:import-pins -- --campaign=<id>` on a test campaign
prints the same shortlist as before, checked by a `pinCohorts.test.js` oracle case: the old `streetOutliers`
body inlined in the test as the oracle, asserted equal to `cohortOutliers(points, { zipFallback: false, minMeters })`
on a fixture — there is no repair-script test to lean on, and none is added).

## S2 — Geocode service: one classifier, accuracy travels

[`services/import/geocode/geocodeService.js`](../server/src/services/import/geocode/geocodeService.js)

- `evaluate(r, h)` ([`:73-87`](../server/src/services/import/geocode/geocodeService.js)): replace the
  `ACCEPTED_TYPES` test with `answerClass(r) === 'none'` → `geocode_low_confidence`; keep the
  `GEOCODE_MIN_ACCURACY` (0.5) and `inStateBounds` tests; add the ZIP test for class-0 placements:
  `zipMatches({ matchedZip: zipOfMatched(r.matchedAddress), matchedCity: cityOfMatched(r.matchedAddress) }, h)`
  with no cohort (ZIP5 equal, or the same city). A refusal → new code `geocode_wrong_zip`, detail
  `Matched in ZIP X, but the address says Y.` `confidenceFor` becomes
  `answerClass(r) === 'exact' ? 'exact' : 'interpolated'`. `ACCEPTED_TYPES`/`ROOFTOP_TYPES` are deleted
  (`:53-54` and `:77` are their only readers; no test names them).
  **Behaviour change, disclosed in Part 1 §3 of the proposal:** a `nearest_rooftop_match` now imports as
  `'interpolated'` (flagged Approximate) instead of `'exact'`; an answer in another town is refused and the
  home is parked (S5.2).
- **The cache-hit path applies the same rule.** `fillFrom(h, entry)` ([`:164-174`](../server/src/services/import/geocode/geocodeService.js))
  recomputes the confidence from `entry.accuracyType` (`answerClass`; the stored `confidence` is the fallback
  for a row without a type) and runs `zipMatches` on `entry.matchedAddress`. A cached answer that fails the
  ZIP rule is **not filled and not re-bought**: the home goes into `unmatched` with code `geocode_wrong_zip`
  (`stats.geocodeUnmatched += 1`), no provider call is made, and the cache row is left as it is — it is
  Geocodio's answer for that address string and will not change until the address does, which makes a new
  cache key. Otherwise a `nearest_rooftop_match` cached before this change would still fill `'exact'`. Both fills add `h.geocodeAccuracy = entry.accuracy ?? null`
  (`d.accuracy` on the new-answer path, [`:244-249`](../server/src/services/import/geocode/geocodeService.js)).
  Never persisted on a Household, exactly like `geocodeAccuracyType`. `fillFrom`'s two callers
  (`:181`, `:190`) learn to skip a refused hit.
- `cacheOp` already stores `accuracy`; `peek`-style readers are unaffected.
- `fillFrom` is hoisted out of `resolve()` to module scope, and `evaluate`, `confidenceFor`, `fillFrom` are
  exported (today all three are module-private, `:52`, `:73`, `:164`); the module loads under `node --test`
  without a database (the model and provider imports have no top-level effects, as `csvImporter.test.js`
  already relies on).
- Tests, new `services/import/geocode/geocodeService.test.js` (pure parts only): `evaluate` for each
  accuracy type; the same-city acceptance and the other-town refusal; the accuracy floor; out of state;
  `confidenceFor`; `fillFrom` on a cache row with `accuracy_type: 'nearest_rooftop_match'` and stored
  confidence `'exact'` fills `'interpolated'`, and on a wrong-town row fills nothing. (`resolve()` is covered by
  the integration tests in S11.)

**Done when** unit tests are green and `importPlaceholderPins.int.test.js` still passes unchanged (its
answers are rooftops in their own ZIP).

## S3 — Schema, pin state, queue predicates

### S3.1 Models

| Model | Change |
|---|---|
| [`Household.js`](../server/src/models/Household.js) `:80` | `pinSuspect` enum → `['placeholder', 'stray', 'far', 'unlocated', 'complex']`, with the semantics comment from the proposal §C (far recomputed; unlocated and complex sticky; complex is not unplaced). |
| `Household.js` after `:88` | `pinComplexKey: { type: String }` (no default; `$unset` with `pinSuspect`). Comment: the ~1.1 m key of the complex's spot; the one field the Pin Fixes complexes list, the sidebar count and the spot vouch group on. |
| `Household.js` `:14-26` | `pinPlacementSchema.kind` enum → the five kinds; add `answer: { type: String, enum: ['exact', 'estimate', 'street'] }` with the comment "the answer class the lookup placed with; never written into `pinSuspect`". |
| `Household.js` after `:88` | `pinSetAside: { type: new Schema({ at: Date, by: ObjectId ref User }, { _id: false }), default: undefined }` — presence tested on `.at`, the `pinPlacement` pattern. |
| `Household.js` `:57` comment | `coordSource` gains `'holding'` in the comment (the field has no enum). |
| [`ImportJob.js`](../server/src/models/ImportJob.js) `:146` | `kind` enum += `'pin_lookup'`. |
| `ImportJob.js` after `:68` | `offWorldDoors`, `outsideStateDoors`, `farPinDoors`, `unlocatableDoors` (Number, default 0) — preview-time, file-scoped counts; after `:74`: `pinsPlacedApprox`, `pinsUnlocated`, `pinsComplex`, `pinsFarMarked` (Number, default 0 — `far` marks this pass set anywhere in the campaign, so the line can say "N homes flagged far — look them up"); after `:82`: `pinLookupTargets: { type: [String], default: undefined }` (ids of a `pin_lookup` job's targets; hidden from organisations with the other ledgers). |
| [`CanvassActivity.js`](../server/src/models/CanvassActivity.js) | `knockPin: { type: String, enum: ['estimated', 'complex'] }` (no default). Strict mode would otherwise drop the stamp silently — this line is a gate for S8.6. |
| [`HouseholdLocationChange.js`](../server/src/models/HouseholdLocationChange.js) `:32` | `scope` enum += `'spot'`. |

No new index: `UNPLACED_PIN` keeps its `$type: 'string'` term (S3.3) so the partial index at
[`Household.js:193-194`](../server/src/models/Household.js) still matches; `pinComplexKey` distincts and the
set-aside term are residual filters on small sets. `npm run migrate:build-indexes` (dry run) must report
nothing new at release.

### S3.2 Pin state — [`services/households/pinState.js`](../server/src/services/households/pinState.js)

```js
export const UNPLACED_KINDS = Object.freeze(['placeholder', 'stray', 'far', 'unlocated']);
export const isComplex = (h) => h?.pinSuspect === 'complex';
export const isPinUnplaced = (h) => UNPLACED_KINDS.includes(h?.pinSuspect) && !h?.locationConfirmedAt;
export const isPinFlaggedUnvouched = (h) => !!h?.pinSuspect && !h?.locationConfirmedAt; // any kind, complex included
export const effectivePinSuspect = (h) => (isComplex(h) || isPinUnplaced(h) ? h.pinSuspect : null);
export const knockPinOf = (h) => (isComplex(h) ? 'complex' : h?.coordConfidence === 'interpolated' && !h?.locationConfirmedAt ? 'estimated' : null);
```
`pinWireFields`'s `pinPlaced` gains `kind: pp.kind` so the web's placement line can say "It had no location
in the file" for a home placed off a holding spot instead of "its earlier spot was shared with N other homes";
`isPlacedByLookup` unchanged. The two **server
save gates** that today read `isPinUnplaced` switch to `isPinFlaggedUnvouched`, so a complex member saved
on its own spot is still refused as "nothing moved": `updateHouseholdLocation.js:96` (`savedOnItsOwnPin`) and
the `sameAddress.unplaced` field at [`routes/admin/households.js:881`](../server/src/routes/admin/households.js)
(the web Save gate reads it). The clients already gate on `!!pinSuspect`. The header comment says why
`complex` is sent whether or not a lead has vouched: every map needs the fact, and the phones already render
any flagged stack as homes with per-home Directions.

### S3.3 Queue predicates — [`confirmHouseholdLocation.js`](../server/src/services/households/confirmHouseholdLocation.js)

```js
export const NEEDS_PIN_FIX = { isActive: true, coordConfidence: 'interpolated', locationConfirmedAt: null, 'pinSetAside.at': null };
export const UNPLACED_PIN = { isActive: true, pinSuspect: { $type: 'string', $ne: 'complex' }, locationConfirmedAt: null, coordConfidence: { $ne: 'interpolated' }, 'pinSetAside.at': null };
export const COMPLEX_TO_REVIEW = { isActive: true, pinSuspect: { $type: 'string', $eq: 'complex' }, locationConfirmedAt: null, 'pinSetAside.at': null }; // $type spelled out so the planner keeps the partial index
export const isConfirmable = (h) => h?.coordConfidence === 'interpolated' || (isPinUnplaced(h) && h.pinSuspect !== 'unlocated') || isComplex(h);
```
A parked home is never confirmable: its holding spot is by definition not the home, so "Looks right" there
would vouch for a point nobody saw (the route answers `400 NOT_APPROXIMATE` as it does for any ineligible
door). `needsVouch` unchanged (`pinSuspect` truthy covers complex; a parked sibling of a vouched complex is
not on a complex key, so the question never arises). The comment above `UNPLACED_PIN` explains the
two terms on one field (the `$type` term is what lets the planner use the partial index).

### S3.4 The cut's "unplaced now" clause — [`services/turf/generateTurf.js`](../server/src/services/turf/generateTurf.js)

```js
export const CUTTABLE_PIN = { $or: [{ pinSuspect: { $exists: false } }, { pinSuspect: 'complex' }, { locationConfirmedAt: { $ne: null } }] };
```
beside `cutStatusExclusion` *(superseded 2026-10-13: the status clause became the targeting-ladder `_id: $nin` in `cutExclusionParts`, see PASSES_AND_TURF.md)*; `cutExclusionFilter({ …, excludeUnplaced })` pushes it into `$and` when
`excludeUnplaced` is true. A complex cuts; a vouched home cuts; everything flagged and unvouched is left out.

**Done when** `node --test` is green (pinState has no test today; add `services/households/pinState.test.js`
with `isPinUnplaced`/`effectivePinSuspect`/`knockPinOf` tables) and the existing int tests pass with one
deliberate update: `pinWire.int.test.js:143-144` and `:167` `deepStrictEqual` the `pinPlaced` object as
`{ at, inPlace, stackSize }` and gain `kind` (S3.2); `pinFixes.int.test.js`, `placeholderPinWriters.int.test.js`
pass unchanged.

## S4 — Import: refused coordinates survive, the preview counts, the write builder

[`services/import/csvImporter.js`](../server/src/services/import/csvImporter.js) and
[`computeImportDiff.js`](../server/src/services/import/computeImportDiff.js).

### S4.1 `mapRow` ([`:95-114`](../server/src/services/import/csvImporter.js))

```js
const inRange = lat != null && lng != null && isValidLatLng(lat, lng);
const coordRefused = inRange ? fileCoordRefusal({ lat, lng, state: get('state') }) : null;
const hasValidCoords = inRange && !coordRefused;
// household: latitude/longitude as today (null when refused), coordsProvided as today, plus
coordRefused,          // 'offworld' | 'outside_state' | null — the row asserted a coordinate that can't be real
```
`isValidLatLng`/`fileCoordRefusal` come from `utils/stateBounds.js`. State is a required column
(`missingRequired`, [`:119-128`](../server/src/services/import/csvImporter.js)), so no campaign fallback.

### S4.2 The validator ([`:305-319`](../server/src/services/import/csvImporter.js))

```js
if (mapped.household.latitude == null || mapped.household.longitude == null) {
  const refused = !!mapped.household.coordRefused;
  if (!refused && (mapped.household.coordsProvided || !geocodeEnabled)) { /* bad_coords, as today */ return; }
}
```
A refused row survives to grouping in both modes. Malformed coordinates and, with lookups off, missing
coordinate columns are skipped exactly as today. The comment above the branch gains one sentence saying so.

### S4.3 Grouping ([`:331-347`](../server/src/services/import/csvImporter.js))

Unchanged, plus: in the "a later row FILLS a missing pin" branch, `existing.coordRefused = null` — one good
row outranks a sibling row's zero. (`coordRefused` reaches the household object through the existing
`...mapped.household` spread.)

### S4.4 `finish()` ([`:352-402`](../server/src/services/import/csvImporter.js))

- The stack classification's `street` becomes `baseFamily(stackBaseOf(h.addressLine1))` (S1.4), so the
  preview counts what the pass will judge.
- New counts, per home (one per `homeKeyOf`), door-weighted like the stack counts:
  - `offWorldDoors`, `outsideStateDoors` — homes whose coordinates are null **and** `coordRefused` is set;
  - `unlocatableDoors` — homes whose `addressLine1` does not start with a digit, or whose ZIP5 is `00000`
    (reported; nothing is looked up for them at import — the geocoder refuses a bad ZIP anyway);
  - `farPinDoors` — `cohortOutliers` over the placed homes (`street: streetOf`, `zip5`, `spotKey: pinKey`,
    `zipFallback: true`); file-scoped, by construction the same number apply saves.
- Return them beside `placeholderPins`, `placeholderPinDoors`, `strayPinDoors`.

### S4.5 `computeImportDiff` ([`:93`](../server/src/services/import/computeImportDiff.js), `:299-309`)

Signature gains `offWorldDoors = 0, outsideStateDoors = 0, farPinDoors = 0, unlocatableDoors = 0`;
`rowIssues` carries them. Both preview paths pass them: `importProcessor.js:101` destructures them from
`buildImportRows` for the queued preview (`:146`) and the apply tally (S5.3), and the synchronous small-file
preview at [`routes/admin/imports.js:277-280`](../server/src/routes/admin/imports.js) does the same (its own
comment says the two previews must tell one story; built literally without it, small files would show none of
the four new lines).

### S4.6 The write builder (`applyImport`, [`:820-907`](../server/src/services/import/csvImporter.js))

- **Prefetch** (beside the pin-state prefetch at `:795-809`, whose projection gains `state`): `holdingAddresses`
  = the `normalizedAddress` of every household with `h.coordSource === 'holding'` that already exists in the
  campaign **with a real location** — loaded with `location` and `state`
  (`Household.find({ campaignId, normalizedAddress: { $in }, location: { $ne: null } }, { normalizedAddress: 1, location: 1, state: 1 })`)
  and kept only when `fileCoordRefusal({ lat, lng, state })` is `null`: a prior at 0,0 or outside its state
  is **not** a real pin (the legacy Fairfield doors), and must not be protected from the holding spot. For a
  kept prior, `keepLocation = true` and no flag. **Position in the chain:** a standalone branch between the
  corrected/confirmed shield (`:857-861`, so `keptPins`/`keptConfirmed` still count) and the pinState
  `else if` at `:862`.
- **The "nothing new to say" branch** ([`:869-873`](../server/src/services/import/csvImporter.js)) becomes
  `!human && !priorRefused && (newKey === curKey || (h.coordSource === 'holding' && prior.coordSource === 'holding') || (h.coordSource === 'geocodio' && prior.coordSource !== 'holding'))`,
  with `priorRefused = !!fileCoordRefusal({ lat, lng, state })` on the prior's own location. Walk the cases:
  a re-import that still can't place a parked home repeats its holding spot (`holding`/`holding`, and
  `newKey === curKey` through the per-ZIP reuse) → kept, flag stands; a re-import whose geocode now
  **succeeds** for a parked home is not swallowed by the "the geocoder filled it" clause (the guard sits on
  that clause alone) and falls through to the flagged-door branch at `:884-895`, where the file wins and
  `pinPlacement { kind: 'unlocated', by: 'file' }` is written; a door the lookup placed earlier whose file
  now gives no coordinate → kept, as today; **a legacy prior at 0,0** (flagged `placeholder`, `coordSource:
  'file'`) is never kept — whether the geocoder now finds it (it falls through to the flagged-door branch and
  the answer wins) or it is parked (same branch; see the next bullet) — so S13.4's "the remaining 0,0 homes
  leave the ocean" holds on a re-import as well as through *Look up by address*.
- **A holding-sourced row never unsets a flag.** After the chain: `if (h.coordSource === 'holding' && !keepLocation) { delete unset.pinSuspect; set.pinSuspect = 'unlocated'; unset.pinComplexKey = 1; }`
  — the flagged-door branch (`:884-895`) and the released-placement branch (`:874-883`) write `unset.pinSuspect`
  for a door the file moves; a door moving **onto a holding spot** is moving from one flagged state to another
  and keeps `pinPlacement { from, to: holding, kind: <prior kind>, by: 'file' }`. (This is the flag write; there
  is no other.)
- **Both `unset.pinSuspect = 1` branches** (`:882`, `:894`) also set `unset.pinComplexKey = 1`: a vendor
  change that moves a flagged door off its spot also takes it out of its complex.
- `pinPlacement.kind: prior.pinSuspect` at `:890` now writes any of the five kinds (enum widened in S3.1).

### S4.7 Tests — extend `csvImporter.test.js`

Under `node --test`, `GEOCODE_ENABLED` is unset, so both modes are exercised by toggling `process.env`
inside the test: a `0,0` row survives the validator and lands in `householdMap` with null coordinates and
`coordRefused: 'offworld'`, in both modes; a `-73.25, 41.17` CT swap → `'outside_state'`; `'abc'`
coordinates are still `bad_coords`; a sibling row with a real pin fills and clears `coordRefused`; the
four new counts on a small fixture (two off-world homes, one far home on a six-home street, one `00000`,
one `Fairfield University No Know`); the bare-unit pair is one address in the preview count (so it is not a
placeholder); `validRows + errors + dupRows === totalRows` still holds. One existing case is **rewritten**:
`:141-147` ("an out-of-state candidate loses to an in-state one even at 1-1") asserted a recorded conflict;
under S4.1 the Colorado row is refused before grouping and the Florida row fills, so it becomes "an
out-of-state coordinate is refused before the vote; the in-state row fills; no conflict is recorded". The write
builder's branches are integration-tested in S11 (they need a database).

**Order within the step.** S4.2 (the validator lets refused rows through) is the **last** edit of S4 and
lands only after S5.2 (the park step) exists: in between, a refused row would reach `applyImport` with null
coordinates under `GEOCODE_ENABLED` unset — the state every test runs in — and be written with
`location: null` (`:834-836`).

**Done when** `csvImporter.test.js` is green and `importHandEdits.int.test.js`, `orgImportFields.int.test.js`
still pass; `importZeroGate.int.test.js` passes after its fixture change (S11: its rows all carry Atlanta
coordinates under whichever state the row names, `:36`, so its Nebraska and Ohio rows would now be refused as
`outside_state` and, with lookups off and no home to derive a spot from, dropped — the fixture gives each
state's rows in-state coordinates).

## S5 — Import worker: holding spot, lookups-off path, the `pin_lookup` job

[`services/import/importProcessor.js`](../server/src/services/import/importProcessor.js) and new
`services/import/holdingSpot.js`.

### S5.1 The `pin_lookup` job — dispatched before the upload is loaded

After the organisation-deleting guard ([`:70-76`](../server/src/services/import/importProcessor.js)) and
**before** the `status: 'parsing'` write at `:79`:
```js
if (importJob.kind === 'pin_lookup') return processPinLookupJob({ job, importJob, campaign });
```
`processPinLookupJob` (same file, beside `processImportJob`): sets
`{ status: 'importing', phase: 'pins', startedAt, heartbeatAt, progress: 0, queueJobId }` (the client's
`isCheckingPins` reads `phase === 'pins' && status === 'importing'`); loads the targets
(`Household.find({ _id: { $in: importJob.pinLookupTargets }, campaignId }, { normalizedAddress: 1 })`);
starts the same 30-second heartbeat `setInterval` the apply path uses ([`:407-410`](../server/src/services/import/importProcessor.js));
calls `placeStackedPins({ campaign, importJob, paidScope: new Set(targets' normalizedAddress), tallyIds: targets' ids, allowPaid })`
inside the same try/catch shape as `:411-424`; then `$set { status: 'completed', completedAt, progress: 100, ...pinTally }`
and returns `{ ok: true, kind: 'pin_lookup', importJobId }`. The two org-visible sentences are lookup-kind:
`PIN_LOOKUP_BUSY` ("Another pin check is running in this campaign — click Look up by address again in a
minute.") and `PIN_LOOKUP_FAILED` ("The lookup couldn't finish — click Look up by address to try again."),
chosen in `processPinLookupJob` from the pass's `pinPassCause` (the pass's own sentences say "import the file
again", which is wrong advice here). Marks written by a busy or failed run stand; the ledger and ceiling are
per ImportJob document, so a retry buys nothing twice. No raw file, no spill, no `deleteRawImport`.
A throw marks the job failed with the cause and rethrows, so the worker's `'failed'` listener behaves as for
any import. The stale sweep treats it like any `importing` job (heartbeat every 30 s).

### S5.2 After geocoding: park, don't drop ([`:175-207`](../server/src/services/import/importProcessor.js) and the spill loop `:236-243`)

- `holdingSpot.js` exports `createHoldingSpots({ campaignId, householdMap })` returning `{ assign(h) }`:
  - `spotForZip5(zip5)` (only for a `zipEligible` ZIP; otherwise `null`), memoised per run, tries in order:
    (1) an existing parked door in the campaign for that ZIP5 — read **once per run** with
    `Household.find({ campaignId, isActive: true, pinSuspect: { $type: 'string', $eq: 'unlocated' } }, { location: 1, zipCode: 1 })`
    (the `pinSuspect` partial index; `$type` spelled out so the planner keeps it) and grouped by ZIP5 — the
    first five characters of the stored `zipCode`, which may be ZIP+4 — in memory, so every import reuses one spot per ZIP per
    campaign (strictly, per *serial* import: with `IMPORT_JOB_CONCURRENCY` 2, two imports of one campaign
    racing can each derive a spot for the same ZIP — harmless, a parked home keeps whichever it got) and a
    complex member that left the holding spot (S6 sets its `coordSource` to `'geocodio'`) can never be
    mistaken for it; (2) the arithmetic mean of the file's placed homes in that ZIP5; (3) the mean of
    the file's placed homes in the same city; (4) the mean of the campaign's active doors in that ZIP5
    (`Household.aggregate` with `$avg` over the coordinate pair); else `null`.
  - A new spot is **nudged** north by `0.0005°` (about 55 m) until no active door sits within 1.5 m
    (`$geoWithin: { $centerSphere: [[lng, lat], 1.5 / 6378137] }`, the `sameAddressDoors` radius pattern)
    and no placed home in the file shares its building key; twenty tries, then the point stands.
  - `assign(h)` sets `h.latitude`, `h.longitude`, `h.coordSource = 'holding'`, `h.coordConfidence = null` and
    returns `true`, or returns `false` when no spot could be derived.
- **Lookups on.** After `geocodeResolve`, for every `normAddr` in `unmatched`: `assign(h)`; if it returns
  `false`, drop the home exactly as today (row errors with the original geocode code). Otherwise the home
  stays in `householdMap` and its rows stay in `validRows`/the spill. The `unmatched` map is still passed
  to the spill loop, which now **keeps** rows whose household was parked (it drops only the rows of homes
  `assign` could not park). `geocode_failed` (a provider error) is parked too: nothing is cached for it, so a
  later *Look up by address* retries for free.
- **Lookups off.** Before the linking stage, every household with `coordRefused` and null coordinates is
  passed through `assign(h)` (same fallbacks; the lookup never ran). When `assign` returns `false` the home
  and its rows are dropped with a `bad_coords` error ("No usable coordinate, and no holding spot could be
  derived") — in memory by splicing `validRows`, in spill mode through the same drop set the spill loop uses
  for lookups-on unmatched rows (a `Map` of dropped addresses, whichever mode produced it). Nothing reaches
  `applyImport` with null coordinates. Rows without coordinate columns were skipped by the validator, as
  today.
- No informational entries are pushed onto `errors` (that array means "skipped rows" to every reader);
  the outcome reaches the owner through the pass tally (`pinsUnlocated`) and the import line (S10).
- `householdsWithFileCoords` and `geoStats` are unchanged; the Recent imports geocode line's word for
  `geocodeUnmatched` changes in S10 ("kept at a holding spot").

### S5.3 Tallies ([`:455-470`](../server/src/services/import/importProcessor.js))

Add `offWorldDoors, outsideStateDoors, farPinDoors, unlocatableDoors` (from S4.4) and
`pinsPlacedApprox, pinsUnlocated, pinsComplex, pinsFarMarked` (from the pass, S6) to the completion `$set`, under the same
`$max`-on-retry discipline as the existing pin counts.

**Done when** `importPlaceholderPins.int.test.js` passes with its new cases (S11) and a `pin_lookup` job
runs end to end in `pinFixes.int.test.js` with no upload on the job.

## S6 — The placement pass

[`services/households/placeStackedPins.js`](../server/src/services/households/placeStackedPins.js).

| Where | Change |
|---|---|
| `fileish` `:61` | `d.cs === 'file' \|\| d.cs == null \|\| d.cs === 'holding'`. |
| `compact` `:66-88` and the projection `:198-201` | Load and keep `zipCode` (as `z5`), `state`, `coordConfidence` (`cc`), `pinSetAside` (`sa: !!h.pinSetAside?.at`), `pinComplexKey` (`ck`); derive `st: streetOf(h.addressLine1)`, `fam: baseFamily(baseOf(hk))` and `off: !!fileCoordRefusal({ lat, lng, state })` (a legacy 0,0 door is class 0 for the gate and is excluded from every cohort). |
| `judge()` `:95-123` | Frequencies, `provenWrong`, the `classifyStackedPins` street and `propagate` key on `fam`, not `base` (the home map still keys on `hk`). `propagate` (`:258-264`) skips `d.sa` doors, so a set-aside unit keeps whatever kind it had. |
| Classify `:222-266`, **new first rules** | For every door on a judged spot: `if (d.sa) { next.set(d.id, { ps: d.ps, candidate: false }); continue; }` (a set-aside door keeps whatever kind it had — a set-aside `far` home must still read "far" when it is brought back — and is never looked up); then `if (d.ps === 'unlocated' \|\| d.ps === 'complex') { next.set(d.id, { ps: d.ps, candidate: !humanOwned(d) && d.inScope }); continue; }`. **And `far` is never a stored spot flag:** `const spotFlag = (v) => (v && v !== 'far' ? v : null); const stored = spotFlag(d.ps) \|\| spotFlag(twin?.ps) \|\| null;` at `:235`, so a lone door carrying `far` reaches the `verdict === 'none'` rule with `stored = null`, gets `ps: null`, and `propagate` (`:243-246`, `:258-264`) can never spread `far` to a building's units as if it were a spot verdict. |
| **Step 2b — far** (after the loop) | Points = every active door with `fileish(d) && !humanOwned(d) && !placedByLookup(d) && !d.sa && !d.off && d.cs !== 'holding'` whose `next` entry is absent or has `ps` null (a spot verdict wins over the cohort), as `{ id, lat, lng, street: d.st, zip5: d.z5, spotKey: d.k }`; `cohortOutliers(points, { zipFallback: true })`. Outliers → `next.set(id, { ps: 'far', candidate: d.inScope })`; `out.pinsFarMarked` counts the ones whose stored flag was not already `far`. Every other point whose stored `d.ps === 'far'` → `next.set(id, { ps: null, candidate: false })`, so the marks step unsets it: `far` is recomputed from the cohort alone, never sticky. Marking is campaign-wide on every pass (a scoped lookup included), as the design says; the line and the toast carry the count so the far card's *Look up by address* is the obvious next click. |
| Marks `:267-283` | Unchanged — the conditional filter and the `(n.ps \|\| null) === (d.ps \|\| null)` skip are value-agnostic. A cleared `far` is an `$unset`. |
| Candidates `:285-304` | Every `next` entry with `candidate && ps && d.inScope`, so `far`, `unlocated` and (for a scoped lookup job) `complex` doors are looked up; the ledger and ceiling are unchanged. |
| Answers `:353-363` | Add `accuracy: p.geocodeAccuracy ?? null`, `matchedCity: cityOfMatched(p.geocodeMatchedAddress)` and `city: p.city` (the probe docs already load `city`, `:330`). |
| Gate `:380-388` | `cands` gain `pinClass: pinClass({ pinSuspect: d.ps, coordSource: d.cs, off: d.off })`, `fam: d.fam` and `city: a.city` (so `zipMatches`' same-city rule can fire in the pass — without it every ZIP-boundary answer is refused); `doorsOnKey` entries gain `complex: d.ps === 'complex'` and `fam: d.fam`; `cohortFor(c)` returns the street cohort (then ZIP) from cohorts **built once per pass** over the loaded active doors that are *not* flagged, as `pinCohorts` points; `lookupPolicy({ cands, answers, doorsOnKey, cohortFor })`. |
| Place writes `:391-417` | `coordConfidence: answerClass(a) === 'exact' ? 'exact' : 'interpolated'`; `pinPlacement.answer: answerClass(a)`; `$unset: { pinSuspect: 1, pinComplexKey: 1 }`; `location` and `pinPlacement.to` are `p.near ? d.loc : [a.lng, a.lat]` — a far door confirmed within 250 m (S1.3 item 6) keeps its own pin (today's same-key `inPlace` writes the answer's point, `:400`, which is the same point to ~1.1 m), with `coordSource: 'geocodio'` and `pinPlacement { from: d.loc, to: d.loc }`. |
| Revert writes `:422-445` | `coordSource: d.pp.kind === 'unlocated' ? 'holding' : 'file'` instead of the hard-coded `'file'` (`:431`): a parked home the lookup placed and a later file's claimant collides with goes back to the holding spot **as a holding-spot door**, so S4.6's "the geocoder filled it" clause does not swallow its next successful geocode and S5.2's reuse query stays true. (`'complex'` is never reverted — the `d.complex` test precedes the `d.placed` rule.) |
| **Complex writes** (new, after place) | Per `complex` entry: filter as a place write; `$set { pinSuspect: 'complex', pinComplexKey: moveTo ? key : spotKey, pinPlacement: { from: d.loc, to: moveTo ? [a.lng, a.lat] : d.loc, at: now, kind: next.get(d.id).ps, by: 'lookup', answer: 'exact', accuracyType: a.accuracyType, stackSize: Math.max(0, (facts.get(d.k)?.size \|\| 1) - 1) } }` (`kind` from `next`, as the place write does at `:407`). **A member already on the exact key with
`d.ck === key` is a no-op re-judge and gets no write at all** — every re-import of the file re-probes complex
members (cached, free: `inScope` is true for every door in the file), and rewriting `pinPlacement` on each
would erase the vendor-spot departure (`from`) the field exists to record and make the tally count a moved
member as "confirmed at its spot" on every later import; when `moveTo` also `location`, `coordSource: 'geocodio'`, `coordConfidence: 'exact'` (a member that leaves the holding spot is a geocoded door, never a `'holding'` one). `movedId` set when `moveTo`. A complex member is never `distrust`ed. |
| Landed count `:461-478` | `kind === 'complex'` ops count `out.complexMarked` when `pinPlacement.at === now`. |
| Tally `:503-519` | The projection at `:510` adds `coordConfidence`. Per tallied door, **`pinSuspect === 'complex' && !locationConfirmedAt` → `pinsComplex` is tested first** (a moved member is also lookup-placed and must not count as placed again); then lookup-placed since `since` → `pinsConfirmedInPlace` (in place **and** `coordConfidence === 'exact'`), `pinsPlacedApprox` (`'interpolated'`, in place or not — a far door confirmed by an estimate sits in the approximate queue, so the line says "check them"), or `pinsPlacedExact`; `pinSuspect === 'unlocated' && !locationConfirmedAt` → `pinsUnlocated`; `isPinUnplaced(h)` (now excluding complex) → `pinsStillUnplaced`. `pinsUnlocated` is a subset of `pinsStillUnplaced`; the import line says both. |
| Header comment `:17-32` | The order gains "2b far", the precedence ladder, the holding spot and complex rules, and a pointer to this plan. |

Outlines (`:485-500`) and the lease are unchanged. `stackPolicy`'s only caller moves to `lookupPolicy`.

**Done when** `importPlaceholderPins.int.test.js` passes with the S11 cases, including: an off-world home
placed by an estimate ends `interpolated` with `answer: 'estimate'` and `kind: 'unlocated'`, listed under
`NEEDS_PIN_FIX`; a far home confirmed in place leaves the queue (the stored flag stays under the vouch, the
`Household.js:79-80` pattern, and `effectivePinSuspect` sends nothing); a lone `far` door is cleared when its
cohort stops flagging it; a set-aside `far` door keeps `far` through a pass; a parked home keeps `unlocated` through the pass that runs on the same import; three bases on one
spot sharing one exact point become `complex`, stay when the exact point is their spot and move together onto
it otherwise, whatever their class; a second run buys nothing.

## S7 — Set aside, the spot-scope vouch, and the writers that clear set-aside

### S7.1 New `services/households/setAsidePin.js` (the ONE set-aside writer)

```js
export const setAsidePins = async ({ campaignId, householdIds, byUserId }) => Household.updateMany(
  { _id: { $in: ids }, campaignId, isActive: true, $or: [{ pinSuspect: { $type: 'string' } }, { coordConfidence: 'interpolated' }] }, // only a door the queue could show
  { $set: { excludedFromTurf: true, pinSetAside: { at: new Date(), by: byUserId } } });
export const bringBackPins = async ({ campaignId, householdIds }) => Household.updateMany(
  { _id: { $in: ids }, campaignId, 'pinSetAside.at': { $ne: null } },
  { $set: { excludedFromTurf: false }, $unset: { pinSetAside: 1 } });
```
Both return `{ updated: modifiedCount }`. The stamp is the record (who, when); set-aside is not a location
change, so no `HouseholdLocationChange` row. The header says why `excludedFromTurf` is reused (every cut,
count, phone and packet already honours it) and why Re-include must skip the stamp (S8.2).

### S7.2 `updateHouseholdLocation` ([`:116-143`](../server/src/services/households/updateHouseholdLocation.js))

In the pipeline `$set`, add
`excludedFromTurf: { $cond: [{ $ifNull: ['$pinSetAside.at', false] }, false, '$excludedFromTurf'] }`
(a person's move brings a set-aside home back; a Remove-apartments exclusion is left alone), and the
`$unset` becomes `['pinSuspect', 'pinComplexKey', 'pinSetAside']` (a moved door leaves its complex).
`pinPlacement.kind: '$pinSuspect'` keeps working for every kind.

### S7.3 `confirmHouseholdLocation` ([`:69-139`](../server/src/services/households/confirmHouseholdLocation.js))

- `scope: 'spot'`: when `household.pinComplexKey` is set, `targets = [household, ...siblings]` with
  `siblings = Household.find({ campaignId, isActive: true, pinComplexKey: household.pinComplexKey, _id: { $ne } })`
  filtered by `needsVouch`. Without a key, `'spot'` behaves as `'unit'`.
- After each successful stamp, a second conditional write brings a set-aside door back:
  `updateOne({ _id, 'pinSetAside.at': { $ne: null } }, { $set: { excludedFromTurf: false }, $unset: { pinSetAside: 1 } })`.
  The audit row's `scope` is whatever the caller passed (`'spot'` included; enum widened in S3.1).
- Undo is unchanged: same-stamp siblings are cleared, which covers a spot vouch.

**Done when** `placeholderPinWriters.int.test.js` and `pinFixes.int.test.js` pass with the S11 cases (set
aside leaves the queue and the badge; bring back; a move and a confirm each clear set-aside; a spot vouch
stamps all members and its undo clears them all).

## S8 — Routes, the cut, the audit

### S8.1 [`routes/admin/campaignHouseholds.js`](../server/src/routes/admin/campaignHouseholds.js)

The router's chain (`requireAuth, orgContext, requireCampaignManager`, then `requireActiveCampaign()` with no
read-only exemption, [`:29-31`](../server/src/routes/admin/campaignHouseholds.js)) gates every new POST the
same way the PATCH is gated; leads with a campaign grant are in, as for Move pin.

| Route | Change |
|---|---|
| `GET /pin-fixes` `:85-140` | Projection `:102` adds `pinPlacement pinSetAside pinComplexKey`. Two more queries beside the two sets: `complexes` over `{ ...scopeFilter, ...COMPLEX_TO_REVIEW }` (grouped in memory by `pinComplexKey` into `[{ key, lat, lng, count, streets: [distinct streetOf], rows }]`, sorted by count desc) and `setAside` over `{ ...scopeFilter, isActive: true, 'pinSetAside.at': { $ne: null } }`, both under the same cap. Every row gains `...pinWireFields(h)`, `spotKey: buildingKeyForCoords(...)`, `complexKey: h.pinComplexKey \|\| null`, `setAside: !!h.pinSetAside?.at`. Response adds `complexes`, `complexCount: complexes.length`, `setAside`. `total` and `truncated` keep meaning the street rows (approximate + unplaced); a capped complexes or set-aside list is a `truncatedExtra: true` flag the page mentions in the banner — in practice unreachable, the cap is 10,000. |
| `POST /pin-lookup` (new) | Body `z.object({ group: z.enum(['shared', 'far', 'unlocated', 'complexes']).optional(), householdIds: z.array(z.string()).max(cap).optional() })`, exactly one of the two. Lookups off (`GEOCODE_ENABLED !== 'true' \|\| !GEOCODIO_API_KEY`) → `409 { error: 'Address lookups are switched off for now.', code: 'LOOKUPS_OFF' }`. Targets, **every variant spread over the route's `scopeFilter` (`{ organizationId, campaignId }`, `:102-106`)**: `shared` → `{ ...scopeFilter, ...UNPLACED_PIN, pinSuspect: { $type: 'string', $in: ['placeholder', 'stray'] } }`; `far`, `unlocated` → `{ ...scopeFilter, ...UNPLACED_PIN, pinSuspect: { $type: 'string', $eq: <kind> } }`; `complexes` → `{ ...scopeFilter, ...COMPLEX_TO_REVIEW }`; ids → `{ ...scopeFilter, _id: { $in }, isActive: true, pinSuspect: { $type: 'string' } }` (built literally without the scope, a group would sweep every tenant's flagged doors into `pinLookupTargets`). None → `400 'Nothing to look up.'`. Creates `ImportJob { organizationId, campaignId, uploadedBy: req.user._id, status: 'pending', kind: 'pin_lookup', pinLookupTargets: ids, totalRows: ids.length }` and enqueues `getQueue(QUEUE_NAMES.IMPORT).add('pin-lookup', { importJobId }, { jobId: importJobId })` under `queueOp` (moved from `turfs.js:64-68` to an export of [`queues/index.js`](../server/src/queues/index.js) as `queueOp(promise, ms)` with its `TURF_ENQUEUE_TIMEOUT_MS` default renamed `QUEUE_ENQUEUE_TIMEOUT_MS` and the old name still read; turfs.js imports it). → `202 { jobId }`. A rejected or timed-out enqueue marks the ImportJob `failed` and answers `503 { code: 'queue-unavailable' }`, the exports route's pattern (`routes/admin/exports.js`; the int harness has no Redis, so its tests accept `[202, 503]`). `addAuditSubjects(res, 'household', id)` for each target. |
| `POST /set-aside`, `POST /bring-back` (new) | Body `{ householdIds: z.array(z.string()).min(1).max(cap) }` → `setAsidePins` / `bringBackPins` → `{ updated }`; audit subjects per id. |
| `POST /:householdId/confirm-location` `:184-248` | `scope: z.enum(['unit', 'building', 'spot'])`. The `expectedCoordinates` test and the `isConfirmable` check are unchanged (complex members are confirmable since S3.3). |

### S8.2 The cut — [`routes/admin/turfs.js`](../server/src/routes/admin/turfs.js), [`services/turf/generateTurf.js`](../server/src/services/turf/generateTurf.js), [`services/turf/turfProcessor.js`](../server/src/services/turf/turfProcessor.js)

| Where | Change |
|---|---|
| `generateTurf` `:163-175` | `cutExclusionFilter({ …, excludeUnplaced: params.excludeUnplaced })` — `params` already passes through `/generate` unvalidated (`turfs.js:264-272`) and the TURF worker (`turfProcessor.js:70-81`). |
| `addSupplementalBooks` `:330`, `:351-365` | New named arg `excludeUnplaced = false`, passed to `cutExclusionFilter`. `POST /add-supplemental` (`turfs.js:331-368`) reads it from the body and puts it in the job data beside the other two flags; `turfProcessor.js:37-68` destructures and forwards it. |
| `POST /target-preview` `:814-869` | Body gains `excludeUnplaced`; passed to `cutExclusionFilter`. Response adds `unplacedCount`: the doors the clause would remove — `countDocuments({ _id: { $in: householdIds }, ...cutBaseWithoutUnplaced, pinSuspect: { $type: 'string', $ne: 'complex' }, locationConfirmedAt: null })` — the actual delta, the pattern `excludedDoorCount` uses at `:846-852`. |
| `GET /attribute-preview` `:874-907` (GET, query) and `POST /manual-preview` `:774-806` | Accept `excludeUnplaced` (`?excludeUnplaced=1` / body) and add `CUTTABLE_PIN` to their `$match`/base when set. (They apply neither restricted toggle today; that pre-existing drift is out of scope and noted in PASSES_AND_TURF.md.) |
| `GET /` summary `:585-708` | Adds `unplacedDoorCount = countDocuments({ ...base, ...KNOCKABLE_DOOR_FILTER, pinSuspect: { $type: 'string', $ne: 'complex' }, locationConfirmedAt: null })` — what an untargeted cut would leave out. `excludedApartmentCount` (`:662`) adds `'pinSetAside.at': null`. |
| `POST /include-apartments` `:756-770` | The `updateMany` filter adds `'pinSetAside.at': null`. |

### S8.3 Undo — [`routes/admin/imports.js`](../server/src/routes/admin/imports.js) `:572-646`

A pre-read `ImportJob.findOne({ _id, organizationId }, { kind: 1 })`; `kind === 'pin_lookup'` →
`400 { error: 'A pin lookup has nothing to undo.', code: 'NOTHING_TO_UNDO' }`. The atomic claim also gains
`kind: { $ne: 'pin_lookup' }` so a race cannot claim one. The list (`:425`) already returns the new kind;
`ORG_HIDDEN_IMPORT_FIELDS` (`:455-461`) adds `pinLookupTargets: 0`.

### S8.4 Sidebar count — [`services/reports/campaignSummaries.js`](../server/src/services/reports/campaignSummaries.js) `:61-67`, `:115-116`, `:146`

A third aggregate: `$match { organizationId, campaignId: { $in }, ...COMPLEX_TO_REVIEW }` →
`$group { _id: { c: '$campaignId', k: '$pinComplexKey' } }` → `$group { _id: '$_id.c', n: { $sum: 1 } }`.
`pinsToFix` = approximate + unplaced + complexes (a complex is one thing to look at); the summary also emits
`complexCount`. The badge in `Layout.jsx:111` and `BottomNav.jsx:66` reads `pinsToFix` and needs no change.

### S8.5 The setup guide — [`services/reports/setupSteps.js`](../server/src/services/reports/setupSteps.js) `:20-96`, [`routes/admin/setupStatus.js`](../server/src/routes/admin/setupStatus.js) `:52-73`, `campaignSummaries.js:125`

`deriveSetupSteps` calls `def.skipped?.(campaign)` with the campaign alone (`:105`, `:113`) while
`satisfied`, `value` and `warn` get `counts` (`:106`, `:116`, `:119`, `:124`). Both `skipped` calls gain
`counts` as a second argument (additive; the existing `survey` def ignores it), and the new def between
`roundCreated` and `booksCut` reads it:
```js
{ key: 'pinsChecked', label: 'Check map pins', route: '/pin-fixes',
  satisfied: (c) => (c.pinsToFix || 0) === 0,
  skipped: (_campaign, c) => (c.pinsToFix || 0) > 0 && (c.publishedTurfs || 0) > 0,
  value: (c) => (c.pinsToFix || 0) === 0 ? 'All pins checked' : (c.publishedTurfs || 0) > 0 ? `${c.pinsToFix} still to look at — books were cut` : `${c.pinsToFix} to look at`,
  warn: (c) => (c.pinsToFix || 0) > 0 && (c.publishedTurfs || 0) === 0 ? 'Homes without a reliable spot land in the wrong book' : null, warnRoute: '/pin-fixes' }
```
Both callers add `pinsToFix` to `counts` (the summaries already compute it; `setupStatus.js` adds the three
aggregates). `client/src/components/SetupProgress.jsx:16` adds `'/pin-fixes'` to `CAMPAIGN_SCOPED`. The
unit test (S11) covers all three states, including "skipped" on a campaign with published books.

### S8.6 Knock stamps — [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js)

Both writers already hold the full household document and compute the distance from it (`:371`, `:801`):
```js
const knockPin = knockPinOf(household); // beside `distance`
…
CanvassActivity.create({ …, distanceFromHouseMeters: distance, ...(knockPin ? { knockPin } : {}) })   // :436-452 and :933-950
```
An offline replay stamps at flush time, like `distanceFromHouseMeters` does. The schema field from S3.1 is
the gate. **Run `npm run audit:mobile-api` before deploy** — this route is mobile-facing (additive: no
client-version bump).

### S8.7 The audit — [`services/audit/flagDetection.js`](../server/src/services/audit/flagDetection.js), [`services/audit/farKpi.js`](../server/src/services/audit/farKpi.js), [`services/audit/flagThresholds.js`](../server/src/services/audit/flagThresholds.js)

- `flagThresholds.js`: `export const COMPLEX_FAR_M = 300;` as its own export, **outside** `FLAG_THRESHOLDS`
  (the mirror tests compare that object web-to-phone; this constant is server-only).
- `farAssessment` (`:282-350`), after the effective distance is known: `row.knockPin === 'complex'` →
  `effective <= COMPLEX_FAR_M` returns `null` (not far), else severity `'low'` with `detail.complexPin = true`;
  `row.knockPin === 'estimated'` and the ladder says `med`/`high` → `'low'` with `detail.estimatedPin = true`.
  The existing chain and pin downgrades run as today.
- The five far-row readers add `knockPin` to their projections: `flagDetection.js:39`, `farKpi.js:88`,
  [`routes/admin/households.js:550`](../server/src/routes/admin/households.js),
  [`migrations/auditGpsStamps.js:182`](../server/src/migrations/auditGpsStamps.js); `reports.js:4031` has no
  projection and needs nothing.
- `farKpi.js:47-53`: `farForgivenByPinCount` counts `detail.pinDowngraded || detail.estimatedPin || detail.complexPin`
  (METRICS.md and AUDIT.md say so in S12); `farVerdictForWire` (`:60-75`) forwards the two new keys for the map pings
  (its only reader, `routes/admin/households.js:683`); the Audit rows already receive the full `detail`.
- Web sentences: [`client/src/lib/flags.js`](../client/src/lib/flags.js) `:249-257` gains two —
  "Recorded at an estimated pin — counted as low severity until a lead checks the pin." and "Recorded at a
  complex; the pin is the complex, not the door." — and `FlaggedEntryList.jsx:107-113` shows the suffix for
  them. The phone mirror (`mobile/lib/flags.js:159-191`) follows with the OTA.

**Done when** `flagDetection.test.js`, `farKpi.int.test.js`, `flagsMirror.test.js`, `pinFixes.int.test.js`,
`turfBookStatus.int.test.js`, `turfCutDeterminism.int.test.js`, `actionResponsePerRound.int.test.js` and
`canvassCorrection.int.test.js` pass with the S11 cases, and `npm run audit:mobile-api` has been read.

## S9 — Operator scripts

### S9.1 `npm run pins:measure-estimates` (new)

`server/src/migrations/measureEstimates.js`, registered in `server/package.json` and proxied in the root
`package.json` as `"pins:measure-estimates": "npm --prefix server run pins:measure-estimates --"` (the
dashboard's Run console starts at the repo root). Flags: `--campaign=<id>` (required), `--sample=<n>`
(default 300), `--seed=<n>`. **Usage is printed and the process exits 1 before `connectDb` when
`--campaign` is missing**, so the proxy is verifiable from the repo root without a database.

What it does: samples `n` active doors with `coordSource: 'file'`, no `pinSuspect`, no `locationConfirmedAt`
(a seeded shuffle of ids), probes them through `resolve()` with null-coordinate copies (the pass's probe
pattern at [`placeStackedPins.js:331-340`](../server/src/services/households/placeStackedPins.js); cached
answers are free, new ones are bought at the usual rate and the price is printed first), and prints per
answer class: count, median and 90th-percentile distance from the vendor's pin — **and, for
`range_interpolation`, the same two distances over the subset with `accuracy >= PIN_INTERP_MIN_ACCURACY`**, which
is the number S13.3's rule reads — plus the share at or above the floor and the share the cohort test would
refuse. The design's §L sampled "6-decimal" vendor pins; coordinates are floats once imported, so that filter
cannot be applied here and the sample is simply unflagged, unvouched vendor pins (a disclosed difference).
Writes no household. Its
header says the two side effects (`GeocodeCache` rows and `lastUsedAt` touches), as the repair script's does.

### S9.2 `repair:import-pins`

Imports `cohortOutliers` from `utils/pinCohorts.js` (S1.2) with `zipFallback: false`; everything else is
unchanged. It loads `coordSource: 'file'` doors only, so parked (`'holding'`) doors are never its
candidates.

**Done when** `npm run pins:measure-estimates` from the repo root prints the usage line and exits 1, and
the `pinCohorts.test.js` oracle case (S1) shows the repair script's shortlist unchanged.

## S10 — Web

Everything reuses the page's components, tokens and patterns; no new dependency.

### S10.1 Groups — [`client/src/lib/pinFixes.js`](../client/src/lib/pinFixes.js)

- `rowCause(row)` → `'shared' | 'far' | 'unlocated' | 'approx'` from `row.door.pinSuspect` /
  `row.door.coordConfidence` (a building row reads its first unit). `UNPLACED_SUB` (`:27`) becomes
  `causeSub(cause)`: "No exact map spot" (shared), "Pinned far from its street" (far), "Couldn't be found by
  address" (unlocated), `null` (approx). `confirmPrompt(row)` wraps `UNPLACED_CONFIRM_PROMPT` with the cause's
  own sentence; `confirmLabel` unchanged for shared/far/approx and **`null` for `unlocated`** — the row and
  popup show no "Looks right" at all (a holding spot is not the home; the server refuses the vouch too, S3.3),
  only Move pin, Place along the street through its card, Google Maps and Set aside. `enterAction` already
  returns `null` for any `unplaced` row.
- `buildGroups({ households, complexes, setAside })` (new, pure) → `{ cards: [{ kind, title, count, spots, rowKeys, actions }], setAside }`
  with kinds `shared`, `far`, `unlocated`, `approx` (from the street rows, by `rowCause`) and `complexes`
  (one entry per spot from the payload's list: `{ key, lat, lng, count, streets, rowKeys }`). `actions` is a
  list of action ids the page renders: shared → `lookup`, `place`, `setAside`; far → `lookup`, `setAside`;
  unlocated → `lookup`, `place`, `setAside` (change #7: the retry path after a provider outage; cached
  refusals make a repeat free, and the toast says "0 placed" when nothing changed); approx → `check`;
  complexes → `vouchSpot`, `spread`. Cards with zero rows are omitted. `buildGroups` also returns
  `complexRows`: one pseudo-row per spot, `rowKey 'c:<key>'`, `kind: 'complex'`, with `lng/lat`, `count`,
  `streets` and `memberRowKeys` — the page merges these into `rowsByKey` and `spotRowKeys` (S10.2) so a marker
  click and the stale-selection effect resolve them like any row. It also returns `complexMemberRows`: the
  members of each complex run through `buildStreetGroups` on their own (so the units of one address stay one
  `scope: 'building'` row), merged into `rowsByKey`/`idToRowKey` but **not** into the street list — these rows,
  with their `target`s, are what *Spread on the map* arms (`memberRowKeys` names them).
- `buildStreetGroups` unchanged except that complex rows (`row.door.pinSuspect === 'complex'`) are **not**
  in the street list — they arrive in the `complexes` list and render under their card.
- Tests, extend `pinFixes.test.js`: `rowCause` for every kind; `buildGroups` from a mixed payload (counts,
  ordering, omitted empties); the complexes card from the list; `confirmPrompt` per cause.

### S10.2 The page — [`client/src/pages/PinFixesPage.jsx`](../client/src/pages/PinFixesPage.jsx)

- **Data.** `listQ` unchanged; the page reads `households`, `complexes`, `setAside`, `complexCount` from
  the payload (`:196`). `groups = useMemo(() => buildGroups(...))`.
- **Cards block** between the header's closing `</div>` (`:631`) and the list ternary (`:633`), inside the
  scrolling section: one card per `groups.cards`, the proposal's Part 1 §6 layout, with the action buttons
  below. `Set aside (N) ▸` is a `<details>` at the bottom of the cards with one row per set-aside home and a
  **Bring back** button each.
- **Look up by address** → `POST …/households/pin-lookup { group }` → `202 { jobId }` → page state
  `lookupJob = { id, group }`; a `useQuery` on `GET /admin/imports/${id}` with `refetchInterval: 1500` while
  `status` is active (the Import page's polling pattern, `ImportPage.jsx:549-556`); on `completed` →
  toast built by `importPinLine(job)` ("Map pins: 231 placed by address · 19 placed on the street (check
  them) · 3 without an exact spot") and the queue invalidations (`confirmInvalidationKeys` +
  `movePinInvalidationKeys`); on `failed` or `pinPassError` → the job's sentence as a toast (the lookup-kind sentences of S5.1, which
  end "click Look up by address again"); a busy or failed lookup is simply clicked again — marks stand and
  the per-job ledger means nothing is bought twice. `409 LOOKUPS_OFF` → its sentence. The card's button reads
  "Looking up…" while a job runs; one job at a time.
- **Start checking** (approx card) → `scope = { kind: 'approx', rowKeys }`; the list shows only those
  rows, the header reads "Checking approximate pins · N left · Show all", and the first row opens in popup
  mode (`goToKey`), so Enter / arrows / auto-advance work as today over the scoped `rowKeys`:
  `rowKeysRef` holds the scoped list while a scope is set, and `advanceAfterAction`'s fallback
  (`:317-319`, which re-derives from the full cache) filters by the scope's row set, so an exhausted scope
  ends with "All checked" instead of opening an out-of-scope row.
- **Set aside…** → `window.confirm` ("Set aside N homes? They leave the queue and every book cut until
  brought back.") → `POST …/households/set-aside { householdIds }` → toast with **Undo** →
  `POST …/bring-back`. **Bring back** on a set-aside row → the same route. Both handlers, and the spot
  vouch below, invalidate `movePinInvalidationKeys(campaignId)` (`movePin.js:53-62` already lists the Pin
  Fixes list, the sidebar's `['admin','campaigns']`, the turf summary and apartment preview — set-aside flips
  `excludedFromTurf`, so those counts move too); window-focus refetch is off, so without this the set-aside
  row would stay on screen and the badge would go stale.
- **Complexes card**: one row per spot — "`<streets>` — a complex of N homes" with **Looks right — it's a
  complex** → `POST …/households/${firstRowId}/confirm-location { scope: 'spot', expectedCoordinates: [lng, lat] }`
  → toast "Confirmed N homes at the complex" with **Undo** (`confirmed: false, scope: 'spot'`); **Spread on
  the map** → Place along the street over the spot's rows (S10.3); **Google Maps ↗** for the first row.
- **Map.** The complexes' member rows join the GeoJSON push (`:439-454`) so each complex draws as one homes
  marker (S10.5). `rowsByKey` (`:224-228`) and `spotRowKeysRef` (`:181`) are built from the street groups
  **plus** `complexRows`, so `onPinClick` (`:377-389`) resolves a complex marker through `pickSpotRow` to
  `c:<key>`, and the effect at `:248-250` that drops a selection whose row left the list keeps it. Selecting
  `c:<key>` highlights the card's row and flies there; the popup for a complex shows the card's actions. The
  amber ring filter is unchanged (complex members are stacked, so never ringed).
- **Popup** (`PinFixPopup`, `:44-148`): the hard-coded sentence at `:69-71` becomes `causeSub(rowCause(row))`
  plus `pinLine(row.door)` (S10.4); the confirm button at `:105-112` and the inline one at `:692` render only
  when `confirmLabel(row)` is non-null (an unlocated row has none). Header count (`:604-608`): "N doors to review · M complexes" when
  `complexCount > 0`.
- **Explainer** (`:596-603`): one sentence per card kind, in the proposal's words.

### S10.3 Place along the street — [`client/src/lib/useMovePin.js`](../client/src/lib/useMovePin.js), the page

- The hook gains a second arming mode: `startClick(target)` (no marker; `clickTarget` state **mirrored into a
  render-assigned `clickTargetRef`**, the `armedRef` pattern at `:35-36`; `armedRef.current = !!target || !!clickTarget`,
  so every once-bound page handler keeps sitting out), `placeAt({ lng, lat })` (reads `clickTargetRef.current`,
  never the closed-over state — the page binds the map click once, and `save`'s closure over `target` at
  `:95-121` would otherwise PATCH the first row again on the second click; same PATCH body, the target's
  `scope`; `moved === 0` → `NOTHING_MOVED` error; success → the same invalidations and `onSaved`), and
  `cancel` clears both modes (Esc already calls it). `copy` for click mode: "Click the roof of <address>."
- The page: `placeMode = { rowKeys, index, placed: [] }`; entering it switches the basemap to Hybrid through
  `useMapStyle().setStyle('hybrid')` (`client/src/lib/mapStyles.js:29-46`; the page holds the hook at `:167`), flies to the first row at zoom ≥ 17 — for an **off-world row** (`isOffWorld(lat, lng)`, a new pure helper in `client/src/lib/pinFixes.js` with the server's argument order: both coordinates within 1e-5 of zero; an outside-state point is still on a map, so 0,0 is the only case that needs the detour) it flies to the median of its street group's other rows, else to the campaign's centre, never to the Gulf of Guinea — sets `canvas.style.cursor = 'crosshair'`
  (the select-mode pattern, `MapPage.jsx:1173-1181`), arms `startClick(row.target)`, and registers one
  `map.on('click', onPlaceClick)` that calls `movePin.placeAt(e.lngLat)` when `clickArmedRef.current`.
  `onSaved` records `{ rowKey, from: target }` on `placed`, advances `index`, arms the next row. The sidebar
  replaces the list with a rail: "Placing · <street> · 3 of 42", the rows in order with the current one
  highlighted, **Skip**, **Back** (re-arms the previous row for a fresh click — "Click the right roof for
  <address>" — so a mis-click is fixed by clicking again; it moves nothing back, because a save back onto the
  spot a flagged door just left is refused by the server's `backOntoTheSpotItLeft` rule,
  [`updateHouseholdLocation.js:97-103`](../server/src/services/households/updateHouseholdLocation.js), and
  the app has no "undo a pin move" today), **Exit**. Rows are the street group's rows, so a multi-unit row
  carries `scope: 'building'` and one click places all its units (the row model already decided; the page
  never asks "Just this unit").
- A campaign switch while in place mode exits it: the page's `[campaignId]` effect (`:416-418`, the fit reset)
  also calls `movePin.cancel()` and clears `placeMode`, so a map click bound under one campaign can never PATCH
  a door of another (the hook's `campaignId` is a closed-over argument).
- **Neighbours**: while in place mode, `GET /admin/households/map` with `buildQuery({ campaignId, bbox })` (the
  Map page's call at `MapPage.jsx:398-446`; viewport-bounded, lead-scoped) feeds a `neighbour-numbers` symbol
  layer: a small label with the leading house number of `addressLine1` for every door **not** in the queue,
  refreshed on `moveend`. Entering place mode switches the style, and `map.setStyle` drops every custom
  source and layer, so the layer is (re)added from the `styleEpoch` effect the page already uses to re-push
  its data after a style load (`:420-434`, `:439-454`), not once on entry. Removed on exit.
- Tests: `movePin.test.js` — `placeAt`'s request body and the `NOTHING_MOVED` path (pure helpers);
  `pinFixesRender.smoke.test.js` renders the cards and the rail.

### S10.4 Badges and sentences — [`client/src/lib/pinBadges.js`](../client/src/lib/pinBadges.js)

- `pinBadge` (`:10-17`): `pinSuspect === 'complex'` → `{ kind: 'complex', label: 'Complex', tone: 'brand' }`
  before the generic `pinSuspect` match; the rest unchanged.
- `pinLine` (`:22-31`): the `pinSuspect` branch switches on the value — shared (today's sentence), far
  ("This home's pin sits far from the rest of its street, and the address lookup couldn't settle it."),
  unlocated ("Doorline couldn't find this address. The pin is a holding spot in its ZIP, not the home."),
  complex ("A complex: several homes share this spot. Directions go to each home's address."). The placement
  line reads `pinPlaced.kind`: `'unlocated'` → "Placed by address (date). It had no location in the file.";
  otherwise today's "Its earlier spot was shared with N other homes".
- Tests, extend `pinBadges.test.js` for the four sentences and the complex badge.

### S10.5 Stacks, markers, panels

| File | Change |
|---|---|
| [`client/src/lib/buildings.js`](../client/src/lib/buildings.js) `:34-39` | `stackKind`: every member `'complex'` → `'complex'`; every member `'far'` **and** one `stackBaseOf` → `'building'` (a mis-pinned real building); otherwise today's rule. `buildingLabel` (`:99-105`): `'complex'` → "N homes at a complex". `groupHouseholds` passes `kind` through as today. |
| [`client/src/lib/mapRender.js`](../client/src/lib/mapRender.js) `:281-302`, `:539-575` | `buildingsToGeoJSON` adds `homes: b.kind !== 'building'` and `complex: b.kind === 'complex'`; the icon `case` and the caption test read `homes` instead of `unplaced` (the two-house glyph and " homes" for both kinds). |
| [`client/src/lib/buildingMarkers.js`](../client/src/lib/buildingMarkers.js) `:28-35` | `markerLabel`/`markerSig`: `'complex'` renders like `'unplaced'` ("N homes", the homes signature). |
| [`client/src/pages/TurfsPage.jsx`](../client/src/pages/TurfsPage.jsx) `:216-221`, `:1229`, `:1246-1262`, `:4002` | The two-house SVG for `kind !== 'building'`; `separateHomes = kind !== 'building' \|\| !movePlan`; the pop-up header for a complex reads "N homes · a complex" and its note "The file and the address lookup agree these homes share this spot. Each home has its own Directions on the phone." with **no** Pin Fixes link; the per-home actions and the no-building-move gate are unchanged. |
| [`client/src/components/DoorStackPanel.jsx`](../client/src/components/DoorStackPanel.jsx) `:54-57`, `:125-129` | `kind === 'complex'` → heading "N homes at a complex", the explainer above, the address groups and per-row Move pin as for `unplaced`. |
| `MapPage.jsx:914-926` | `stackCounts` counts a `'complex'` stack with the buildings (it is a place); the pill text is unchanged. `MapFilters.jsx:430-436` is unchanged (it counts `unplaced` only). |
| Tests | `buildings.test.js` (complex kind; far building; today's cases), `mapRender.test.js` (the complex glyph and caption), `buildingMarkers.test.js`, `stackPanelsRender.smoke.test.js` (complex panel). |

### S10.6 The cut toggle — [`client/src/pages/TurfsPage.jsx`](../client/src/pages/TurfsPage.jsx)

- State `const [excludeUnplaced, setExcludeUnplaced] = useState(true)` beside `:1551-1552`.
- Count: `targetActive ? targetPreviewQ.data?.unplacedCount : turfsQ.data?.unplacedDoorCount`.
- Checkbox after the no-soliciting one (`:3466-3479`), rendered when the count is above zero: "Leave out N
  homes without a reliable map spot" with the sub-sentence from the proposal and a **Fix in Pin Fixes →** link
  to `/campaigns/:id/pin-fixes`.
- Sent as `excludeUnplaced: true` only when ticked and the count is above zero (the pattern at
  `:1830-1836`, `:2260-2261`, `:2552`): the `generate` params, the `target-preview` body and query key, the
  `add-supplemental` body, the `attribute-preview` query and the `manual-preview` body.
- After a cut (`:3504-3515`, beside the voted and do-not-knock skip lines): "N homes left out — fix their
  pins in Pin Fixes, then **Add as new book**." when the toggle was on and the count was above zero.
- A pure `unplacedToggleCopy(count)` in new `client/src/lib/turfUnplacedToggle.js` with a test, so the words
  are pinned.

### S10.7 Import copy — [`client/src/pages/ImportPage.jsx`](../client/src/pages/ImportPage.jsx), [`client/src/lib/importPins.js`](../client/src/lib/importPins.js)

- Preview (`:225-275`): four more `SampleList`s, each rendered when its count is above zero, reading
  `rowIssues.offWorldDoors` ("Homes with no location in the file (0,0)"), `outsideStateDoors` ("Homes
  whose coordinate is outside their state"), `farPinDoors` ("Homes pinned far from their street"),
  `unlocatableDoors` ("Homes with no street address") — with the sentences from the proposal's Part 1 §10,
  branching on `diff.geocoding?.enabled` like the shared-spot block (`:262-264`). "Rows skipped" (`:232`)
  keeps "missing/invalid coordinates" — refused rows are no longer skipped, so that count drops on its own.
- Recent imports geocode line (`:1173-1179`): "N unplaced" → "N not found by address" (it counts every
  unmatched address, bad ZIPs included); the parked count is the pin line's `pinsUnlocated`, "N kept at a
  holding spot".
- `importPinLine` (`importPins.js:13-25`): parts gain `pinsPlacedApprox` → "N placed on the street (check
  them)", `pinsComplex` → "N in complexes", `pinsUnlocated` → "N kept at a holding spot", `pinsFarMarked` →
  "N flagged far from their street — look them up" (the first lookup on a campaign imported before this shipped
  can mark hundreds; the sentence is what makes the far card the next click); the Pin Fixes link
  shows when `pinsStillUnplaced > 0 || pinsPlacedApprox > 0`. A `pin_lookup` row (`j.kind === 'pin_lookup'`,
  `filename` null) renders "Pin lookup · N homes" (`totalRows`) in the file column; the **Undo import** menu
  item is hidden for it (`:1235-1241`). Tests: `importPins.test.js` for every new part and the lookup label.

### S10.8 Small wiring

- `client/src/components/SetupProgress.jsx:16`: `CAMPAIGN_SCOPED` += `'/pin-fixes'` (S8.5).
- `client/src/lib/flags.js:249-257` + `FlaggedEntryList.jsx:107-113`: the two far sentences (S8.7).
- Help copy is server-served; nothing to build on the client for it.

**Done when** `cd client && npm test` is green and the three pages behave as Part 1 of the proposal
describes on a local campaign seeded with the S11 fixture shapes (checked by hand before the hand-over, with
what was checked written into §R).

## S11 — Tests

One fixture shape, in miniature, carries most of the server cases: a six-home street with one home at 0,0,
one home 30 km away, one with a `00000` ZIP; a three-address condo spot whose exact answers are one point;
a two-row bare-unit pair; an apartment building of four units; and a human-corrected door. Answers come from
the existing fake geocoder (`importPlaceholderPins.int.test.js:43-62`), keyed by address string. **Its
`answer()` helper is extended** to `answer(address, lat, lng, type = 'rooftop', { accuracy = 1, matched = address } = {})`
and the response reads `accuracy` and `formatted_address: matched` from the stored answer, so a test can set
a 0.6 estimate or return another town's formatted address; today the fake hard-codes `accuracy: 1` and echoes
the sent string, which no new case could use.

| File | New or extended cases |
|---|---|
| `utils/stateBounds.test.js` (new) | S1.1 |
| `utils/pinCohorts.test.js` (new) | S1.2 |
| `services/households/pinTrust.test.js` | S1.3, including the two rewritten cases (`:37`, `:92`) and the legacy-distrusted-key complex |
| `server/test/streetNameDrift.test.js` | S1.4: the `baseFamily` table; every existing fixture unchanged |
| `services/import/geocode/geocodeService.test.js` (new) | S2 |
| `services/households/pinState.test.js` (new) | S3.2 tables |
| `services/import/csvImporter.test.js` | S4.7 |
| `server/test/importPlaceholderPins.int.test.js` | Refused `0,0` rows import and are looked up; an unplaceable one lands on the holding spot as `coordSource: 'holding'`, `pinSuspect: 'unlocated'`, in `UNPLACED_PIN`, and keeps `unlocated` through the same import's pass; the holding spot is one per ZIP and reused by a second import; an existing real pin is never replaced by a holding spot; an estimate places an off-world home as `interpolated` with `pinPlacement.answer: 'estimate'`, `kind: 'unlocated'`, listed in `NEEDS_PIN_FIX`; a `nearest_rooftop_match` imports as `interpolated` on a coordinate-less file; an answer in another town (different city, different ZIP5) parks the home; a same-city, other-ZIP5 answer on the street places it, and the same answer off the street's cohort is refused in the pass; a 0.6-confidence estimate fills a 0,0 home but does not replace a shared spot; a far home with a rooftop on its street moves; a far home whose rooftop is where the pin is is cleared; a lone `far` door is cleared when its cohort stops flagging it; a set-aside `far` door keeps its flag; three bases on one spot with one exact point become `complex` (`pinComplexKey` = the exact point's key; the members stay when the point is their spot and move together onto it otherwise, with `coordSource: 'geocodio'`); a legacy door at 0,0 with `coordSource: 'file'` is class 0 and is placed by an estimate, and on re-import is never kept at 0,0; a second file's new home whose exact point is that complex joins it and no member is reverted; members carrying a legacy `pinDistrustedKeys` entry equal to their exact point (the release-1 pass's record of the collapse) still form the complex; a sparse rural ZIP fixture — four homes miles apart — where a legitimately remote home with a rooftop at its pin, and one with an estimate within 250 m of its pin, are confirmed in place and lose `far`, while a home whose rooftop is 20 km away moves; a still-unplaceable parked home keeps `unlocated` through a re-import and a now-placeable one is placed by the file; a bare-unit pair is one address and places; **its existing test 3 (`:176-197`, "two addresses on one answer all stay flagged") is rewritten** — 22 and 24 Ash St are the Fairfield pattern and now form a two-home complex moved to the point (`pinSuspect: 'complex'`, `coordSource: 'geocodio'`, no distrusted key), while 18 and 20 Ash St stay flagged, `pinsStillUnplaced: 2`, `pinsComplex: 2`; the tallies (`pinsPlacedApprox`, `pinsUnlocated`, `pinsComplex`) match the state; a second run buys nothing; the `$set`/`$unset` path conflict never happens (a re-import of a still-unplaceable parked home writes cleanly). |
| `server/test/pinFixes.int.test.js` | The payload's `complexes`, `setAside`, `complexCount` and per-row `complexKey`/`setAside`; the badge test at `:165-187` becomes `pinsToFix === total + complexCount` once the fixture holds a complex (`total` keeps meaning approximate + unplaced); `POST /pin-lookup` by group and by ids (the route answers `202` or, with no Redis in the harness and `QUEUE_ENQUEUE_TIMEOUT_MS` set short, `503` with the ImportJob marked `failed`; the test asserts `[202, 503]`, reads the ImportJob doc — `kind`, `pinLookupTargets`, null `filename` — then runs `processImportJob` directly on it: the tally lands, `status` reads `completed`), lookups off → 409, nothing to look up → 400; its undo → 400 `NOTHING_TO_UNDO`; set-aside leaves both queues and the badge, `include-apartments` leaves it excluded and `excludedApartmentCount` does not count it; bring-back; a move and a confirm each clear set-aside; `scope: 'spot'` vouches every member and its undo clears them; a lead with a grant can do all of it, a canvasser cannot. |
| `server/test/placeholderPinWriters.int.test.js` | A person's move unsets `pinComplexKey` and `pinSetAside`; `pinPlacement.kind` for the new kinds. |
| `server/test/importZeroGate.int.test.js` | Fixture only: its rows all carry Atlanta coordinates (`:36`) whatever state the row names; the Nebraska and Ohio rows get in-state coordinates so S4.1 does not refuse them. No assertion changes. |
| `server/test/pinWire.int.test.js` | The three `pinPlaced` `deepStrictEqual`s (`:143-144`, `:167`) gain `kind`; `effectivePinSuspect` sends `'complex'` for a vouched complex member; sends nothing for a vouched `far`/`unlocated` member; bootstrap and `/changes` carry it. |
| `server/test/turfCutDeterminism.int.test.js` or a new `turfUnplacedToggle.int.test.js` | `excludeUnplaced` leaves flagged homes out of a geometric cut, a manual cut and a supplemental add; a complex and a vouched home cut; `/target-preview`'s `unplacedCount` equals the delta; `GET /turfs` `unplacedDoorCount`; `attribute-preview`/`manual-preview` honour the flag. |
| `server/test/flagDetection.test.js`, `farKpi.int.test.js`, `flagsMirror.test.js` | S8.7: `knockPin: 'estimated'` caps at low with `estimatedPin`; `'complex'` within 300 m is not far, beyond is low with `complexPin`; the KPI bucket; the wire forwards the keys; the mirror test still passes (the constant is outside `FLAG_THRESHOLDS`). |
| `server/test/actionResponsePerRound.int.test.js` or `canvassCorrection.int.test.js` | Both knock writers stamp `knockPin` when the door is an unconfirmed estimate or a complex member, and neither otherwise. |
| `server/test/setupSteps`-style unit (new `services/reports/setupSteps.test.js`) | The `pinsChecked` step's three states. |
| `client/src/lib/*.test.js` | `pinFixes`, `movePin`, `pinBadges`, `buildings`, `mapRender`, `buildingMarkers`, `importPins`, `turfUnplacedToggle` (new), `pinFixesRender.smoke`, `stackPanelsRender.smoke` — as listed in S10. |

Integration tests run from `server/` (`npm run test:int -- test/<file>`); the runner boots its own
`mongod`. No test touches production and no test spends: the fake geocoder answers every call.

## S12 — Docs, Help Center, privacy record

- [IMPORTS.md](IMPORTS.md): Part 1 "Coordinate-less files" (parked, not dropped), new "Coordinates the import
  refuses", "Homes that share a map spot" (the answer rule, complexes), "Fixing pins that came in wrong"
  (the script's place now), the known-gaps list (the "accepted as-is" item goes); Part 2 §H and the
  `placeStackedPins` section (the order with 2b, the ladder, the holding spot, the complex verdict, the new
  ImportJob fields and the `pin_lookup` kind).
- [MAPS.md](MAPS.md): "Approximate pins, and fixing them" and "The Pin Fixes page" (cards, Look up by
  address, Place along the street, Set aside, complexes), Part 2 provenance (`pinSuspect` kinds,
  `pinComplexKey`, `pinSetAside`, `coordSource: 'holding'`), the badge chain.
- [PASSES_AND_TURF.md](PASSES_AND_TURF.md): the toggle and the after-cut line; the previews' pre-existing
  restricted drift noted. [AUDIT.md](AUDIT.md) and [METRICS.md](METRICS.md): the estimated-pin and complex
  rules and the widened "forgiven by pin" bucket. [CAMPAIGNS.md](CAMPAIGNS.md): the setup step.
  [OPERATIONS.md](OPERATIONS.md): `pins:measure-estimates`, and the Nye runbook's step 4 updated.
  `server/.env.example` gains `# PIN_INTERP_MIN_ACCURACY=0.8` beside `GEOCODE_MIN_ACCURACY` (`:40`).
- [PROPOSAL_PIN_FIXES_AT_SCALE.md](PROPOSAL_PIN_FIXES_AT_SCALE.md): status line to "BUILT", an "As built"
  section listing this plan's three design changes. [README.md](README.md): both rows.
- Help Center: `pages/page-pin-fixes.md` (the cards, each action, complexes, set aside, keyboard),
  `guides/fix-pin-location.md` (Place along the street; what a complex is), `guides/voter-imports.md` (the
  refused coordinates, parked homes, the new preview and import lines), `pages/page-voter-import.md` (the
  lines and the Pin lookup row), `guides/maps.md` and `pages/page-map.md` (the complex marker and panel),
  `pages/page-turf-cutting.md` (the toggle), `faq/canvasser-dot-off-will-it-flag.md`
  (estimated pins and complexes), `guides/audit.md:50` and `pages/page-audit.md:16` (the two new far
  sentences and the wider "forgiven by pin" number), `guides/canvasser-map.md:34` (a shared spot may now be a
  complex — a right spot — or a holding spot — Doorline's spot, not the home), a new
  `faq/homes-in-the-ocean-or-on-one-dot.md` (audience lead) replacing the `_INBOX.md` item of 2026-10-05, and
  the FbTime-style release note pattern is not needed (nothing is gated on a config var).
- Stale sentences in older plans: [PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md)
  `:202` ("`range_interpolation` is always refused") and its status header, and the reference
  [PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md)'s status line and D2 row (`:455`) get a
  one-line "superseded by Pin Fixes at scale" note.
- [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md): a v7 stamp on item 28 — (a) the new lookup triggers
  (refused coordinates, far homes, the lead-initiated job; same fields to Geocodio, no new subprocessor, no
  DPA §6 notice); (b) retention unchanged; (c) `pinLookupTargets` hidden from organisations; (d) the new
  fields (`pinSuspect` kinds, `pinComplexKey`, `pinSetAside` with a staff user id like `correctedBy`,
  `pinPlacement.answer`, `knockPin`, `coordSource: 'holding'`) and the holding spot as a Doorline-derived
  point that is deliberately not the home. "GEOCODIO — the loud one" and EXCEPTION 1 get the same stamp. The
  owner reads the stamps before deploy; no published policy sentence changes.

## S13 — Release

0. **Heroku dashboard → Settings → Config Vars:** `GEOCODE_ENABLED` is `true` and `GEOCODIO_API_KEY` is set
   (both confirmed 2026-10-09). Optional: `PIN_INTERP_MIN_ACCURACY` (default 0.8), `COMPLEX_FAR_M` is a code
   constant (300).
1. The owner commits (`add -A`, commit, push) and deploys server and web from `main`, outside field hours.
   Everything is additive: no client-version bump, no store build.
2. **Run console:** `npm run migrate:build-indexes` (dry run) must report nothing new. Nothing to apply.
3. **Run console:** `npm run pins:measure-estimates -- --campaign=6ac933c75c0e9dd8e73153b7 --sample=300`.
   About thirty cents. If the 90th-percentile error of `range_interpolation` at accuracy ≥ 0.8 is above
   ~60 m, set `PIN_INTERP_MIN_ACCURACY` higher in the dashboard; otherwise the default stands.
4. **Fairfield, in Pin Fixes:** *Look up by address* on the shared-spot card — the complexes become one row
   each, and every 0,0 home with an answer leaves the ocean (the pass never parks; the dozen with no answer
   stay until a re-import parks them or *Place along the street* places them). That first lookup also marks
   `far` campaign-wide, so the far card may fill at once; its toast says how many — click *Look up by address*
   there next. Then *Start checking* the approximate card; *Place along the street* for what remains; *Set
   aside* the dorms. Then Turf Cutting with the toggle on.
5. **Phones:** the complex caption, the per-cause sentences, the two far sentences, `stackKind`'s
   refinement, and two behaviours — the canvasser list files complex members under "No exact map spot" with
   no distance (`mobile/lib/listEntries.js:40-70`) and the map's framing leaves them out (`map.jsx:452`) —
   ride the next OTA (`ota:staging` from the branch, `ota:production` from `main` after the device checks).
   Not a gate: today's phones draw every new kind as "N homes" with per-home Directions, and the list's
   section is a nuisance, not a wrong send.
6. Watch for a week: the Pin Fixes queue sizes per campaign (`pinsToFix`, `complexCount`), the import lines
   of the next files, the super-admin Imports page's lookup counts (`pin_lookup` rows appear there with no
   filename), and the Audit page's low-severity far rows with the two new sentences.

## R. Review log

**Round 1 (2026-10-10, adversarial, against the code).** Three blockers, all confirmed and fixed in place:
(1) `zipMatches` was specified two ways (ZIP3 in S2, ZIP3-plus-cohort in S1.3), took the provider's shape
(`matchedAddress`) where the pass has `matchedZip`, and had silently replaced the design's same-city rule
with a ZIP3 shortcut — now one rule, one shape, the city read from the formatted address like the ZIP, and
change #5 above; (2) "far is recomputed, never sticky" could not happen: a stored `far` re-entered the
classify loop as a spot flag and 2b excluded it — now `far` is never a stored spot flag and 2b owns it;
(3) the setup step's `skipped` def received the campaign document, not the counts, so it would never skip
and would break "setup complete" everywhere — both call sites now pass counts. Risks taken in: a complex
member moved off the holding spot keeps `'holding'` as its source (now `'geocodio'`/`'exact'`), and the
holding-spot reuse query is one indexed read of `pinSuspect: 'unlocated'` per run instead of a regex per
ZIP; the widened "nothing new to say" branch would swallow a parked home's successful re-geocode (now
`prior.coordSource !== 'holding'`); the cache-hit path bypassed the new classifier (now `fillFrom`
recomputes); the ZIP cohort's O(k²) medoid (now the coordinate-wise median); `isPinUnplaced`'s narrowing
removed the server's "nothing moved" backstop for complex members (now `isPinFlaggedUnvouched` at the two
save gates); the S4→S5 order window (now stated); the phone list's behaviour for complexes (change #4);
the neighbour layer wiped by the style swap (now re-added per `styleEpoch`). Wrong claims fixed: the
drift fixtures (none change under `baseFamily`); the repair script does not import `pinTrust`; a no-op
`$setOnInsert` bullet deleted; `minMeters` and `coordsOf` in S1.2; the directional-only name case in
`baseFamily` ("1000 WEST ROAD 36"); six anchors. Verified correct by the round: every other anchor in
S1–S13, the import-cycle question (none), the partial-index use of `{ $type: 'string', $ne: 'complex' }`,
the no-defaults behaviour of a `default: undefined` sub-schema on bulk upsert, the pipeline-update shape of
`updateHouseholdLocation`, the `$and`/`$or` validity of the cut clause, and that no new index is declared.

**Round 2 (2026-10-10, adversarial, fresh reviewer).** Three blockers, confirmed and fixed: (1) round 1's
rewrite of the "nothing new to say" branch guarded the whole clause, so a still-parked home lost its flag on
every re-import — the guard now sits on the geocoder clause alone and the `holdingAddresses` keep is stated
to run first; (2) *Undo last* in Place along the street would have hit the server's `backOntoTheSpotItLeft`
refusal — it is now *Back* (re-arm the previous row), and the plan says why; (3) round 1's same-city rule
could never fire in the pass because the answers map and the candidates carried no `city` — both do now.
Risks taken in: complexes made durable across files (`pinClass(complex) = 2`, `doorsOnKey.complex`, a
join-the-complex path, no reverts of complex members); set-aside doors frozen in the classify loop; the
lookups-off path drops a home `assign` cannot park instead of writing `location: null`; two confidence
floors by pin class, disclosed as change #6; `fillFrom`'s refusal defined (no re-buy, cache row untouched,
counted unmatched); *Look up by address* on the unlocated card (change #7); complex pseudo-rows in
`rowsByKey`/`spotRowKeys` so marker clicks resolve; the *Start checking* fallback scoped; the fake geocoder
helper extended for accuracy and matched address; the complex write's `kind` from `next`; the tally's
`coordConfidence` projection; `$type` spelled on the two new equality predicates; `pinPlaced.kind` on the
wire for an honest placement line; the setup step's null-safe counts and skipped wording; two wording nits.
Verified by the round: every round-1 fix except the two above, the job dispatch point and the worker's
failed listener, `slim` keeping the summary counts, the supplemental signature, the far branches' safety for
`summarize`/`farKpiForRows`, no new index, the exclusion projection, `coordSource` having no enum, and that
`GeocodeCache.matchedAddress` has been stored since the first geocode commit.

**Round 3 (2026-10-10, adversarial, fresh reviewer, end-to-end walk).** One blocker: the complex rule
said both "moveTo when the answer key differs" and "a class-2 complex never moves" — now it converges on
the exact point (change #8), with the three test sentences fixed. Two wrong claims: `pinTrust.test.js`'s
old shapes would fail under `lookupPolicy` (now defaulted in the alias); `pinWire.int.test.js` deep-equals
`pinPlaced` (now updated in S3 and S11). Risks taken in: legacy priors at 0,0 were protected by both
"keep the prior" branches (now `fileCoordRefusal` on the prior skips both, the pass's `compact` carries
`state`/`off`, `pinClass` makes them class 0, and a holding-sourced row never unsets a flag); complex doors
in the collision loop now refuse the claimant rather than being skipped (no estimate is ever placed onto a
complex); the once-bound place-click handler read a stale closure (now a render-assigned `clickTargetRef`);
a circular import between `pinTrust` and `geocodeService` (now `geocodeFloors.js`); change #2 rewritten for
complexes (the stamp survives a vouch by design); the holding keep's position in the chain (after the
shield, so `keptPins` still counts); lookup-kind busy/failed sentences and "click again" in the page; the
geocode line's count renamed; `propagate` skips set-aside doors; an off-world row's fly-to. Verified by the
round: every round-2 fix (the branch walk's five cases, the join path's coherence under change #8, Back's
second click not refused, `isConfirmable` users, `fillFrom`'s `continue`, the 0.5 floor), the mental build
(worker dispatch, null filename, lead-readable polling, stale expiry, `$and`, `skipped` call sites, undo of
parked doors), no 2b false positives on existing fixtures, scenarios C, E, F and G.

**Round 4 (2026-10-10, adversarial, fresh reviewer).** Nothing above nit level. Fixed: S6's exit condition
still carried the pre-#8 "do not move at class 2" sentence; the complex write would have re-stamped
`pinPlacement` on every re-import (now a no-op when the member already sits on the key, and the tally tests
`complex` first); the client had no off-world test (now a one-line `isOffWorld` in `pinFixes.js`); set-aside,
bring-back and the spot vouch named no cache invalidation (now `movePinInvalidationKeys`); `pinClass`'s input
shape; the complex-door test's position in the collision loop (before the `placed` revert rule); place mode
exits on a campaign switch; `truncated` semantics for the extra lists. Verified by the round: change #8's
consequences (re-import of a moved member, outline redraws, the departure trace for a leftover unit — not
stranded), the S4.6 chain walk for six cases including the legacy 0,0 prior, `MIN_ACCURACY`'s single reader,
the once-bound handlers' ref discipline, the busy-cause test, the vouched-member filter, the badge test's
right edit, the legacy ocean doors landing in the `shared` group as class 0, 2b on every pass including a
scoped lookup, and that no stale vocabulary remains outside §R and the Changes list.

**Round 5 (2026-10-10, adversarial, fresh reviewer; angles: legacy data, concurrency, failure modes, scale,
exposure, test feasibility, docs cascade).** One blocker: Fairfield's complex members already carry
`pinDistrustedKeys` equal to their exact point (the release-1 pass's record of refusing the collapse), so
the complex verdict had to run before the distrusted-key test and ignore that one key — otherwise the free
re-lookup would have refused all of them and no complex would have formed. Wrong claims fixed: two
`pinTrust.test.js` cases are the complex pattern and are rewritten, not kept; the group lookup's target
filters and the complexes query now spread the route's campaign scope (built literally they would have swept
other tenants' flagged doors into the job); `evaluate`/`confidenceFor`/`fillFrom` are hoisted and exported
for the unit test; the measurement script prints the 90th percentile for the at-or-above-floor subset the
decision rule reads, and discloses that the design's "6-decimal" sample filter cannot survive import. Risks
taken in: `doorsOnKey` entries carry `fam` so the bare-unit fold covers both collision loops; a far door
whose answer agrees with its pin within 250 m is confirmed in place (otherwise a remote rural home could stay
`far` for ever), with a sparse-ZIP fixture; the pass counts `pinsFarMarked` and the line and toast say "N
flagged far — look them up", since the first lookup on an existing campaign marks campaign-wide; the Help
cascade gains the Audit pages, the canvasser map guide and the two older plans' stale sentences; S13.4 says
which 0,0 homes the lookup cannot move; the holding spot's serial-only uniqueness; the client `isOffWorld`
takes the server's argument order. Verified by the round: every round-4 fix; that no `fileish` door can be
`interpolated` (so 2b never marks one); legacy records with null `pinPlacement.kind`/`answer`; concurrent
marks are idempotent under the conditional filters; partial provider failure parks only that chunk and
retries for free; the third summaries aggregate rides the partial index; the exposure of every new field;
the unit tests' import graphs load without a database; the int fixture's state and city; the privacy stamp
list.

**Round 6 (2026-10-10, builder's dry run, fresh reviewer).** One spec gap at blocker level: the far
in-place rule had nothing to measure 250 m with — candidates carried only the ~1.1 m key; they now carry
`loc`, the rule is placed and measured, and the write keeps the door's own coordinates. Five wrong claims
about existing tests and call sites, each now named with its rewrite: `importZeroGate`'s fixture (Atlanta
coordinates under every state), `csvImporter.test.js:141` (the out-of-state candidate is refused before the
vote), `importPlaceholderPins` test 3 (the Fairfield pattern becomes a complex), the pin-lookup route's
`[202, 503]` in a Redis-less harness with the failed-job 503 path stated, and the synchronous small-file
preview call site. Risks taken in: *Spread on the map* had no rows to arm (complex member rows now exist
outside the street list); a reverted parked home kept `coordSource: 'file'` (now `'holding'`); `cohortFor`
now hands back a precomputed centre and threshold; Set aside is restricted to doors the queue could show; the
repair-script "unchanged" claims now rest on a `pinCohorts` oracle test. Nits: `.env.example`; an
estimate-confirmed far door counts as approximate. Verified by the round: every round-5 fix; the no-op
complex re-judge writes nothing; `'complex'` is never reverted; the lookups-off park step's place in the
processor; the fake geocoder's additive options; the knock writers; the in-state import fixtures.

**Ready to build** once the owner rules on the eight changes from the approved design (top of Part 2). Six
rounds found 3, 3, 1, 0, 1 and 1 blocker-level items; each is fixed in place above.

**Build record (2026-10-10).** The owner said "build it". Built S1–S12 in the working tree (uncommitted,
beside another session's uncommitted session-expiry work, which this build does not touch).

- **Tests.** In the working tree: web `npm test` 638 pass; server unit (`node --test`) 564 pass, the
  integration suites skipping without a database; integration (`npm run test:int`, 129 suites on a throwaway
  mongod) all pass after the last edit, including the new `pinFixesAtScale.int.test.js` (18 tests). On the
  last commit plus this change alone (the hand-over patch): web 627, server unit 555, and all 128 integration
  suites pass, and the web build passes — the differences are the other session's own tests. One earlier full
  run reported a failing suite whose name was cut from a truncated log; the complete re-run passed.
- **Browser check** (headless Chrome over the DevTools protocol, the real server code on a throwaway
  mongod serving the production web build, Geocodio faked, the import queue run in-process; a Fairfield-like
  fixture: three homes on one vendor spot, a far home, two at 0,0, one at a holding spot, a three-address
  complex, two estimates, placed neighbours). 32 checks pass on Pin Fixes: the five cards and counts;
  *Start checking* → Enter confirms and advances → *All checked*; the complex vouch and its Undo; Set aside
  (the prompt, *Set aside (1)*) and Bring back; *Look up by address* → *Looking up…* → the polled job's toast
  *"Map pins: 2 placed by address · 3 without an exact spot"*; *Place along the street* → Hybrid, crosshair,
  the street's house numbers labelled, a click on the old spot says *Nothing moved*, a click on a roof places
  it and arms the next, the 0,0 home's camera goes to the queue's middle, *Back* re-arms, Esc exits and
  restores the basemap. Also: the Import page's *Pin lookup · 5 homes* row, and Turf Cutting's *Leave out 7
  homes without a reliable map spot*, ticked by default. Screenshots read by eye.
- **Found and fixed by the browser check:** (1) a pre-existing race — the stale-selection effect could
  clear the auto-advance's new selection when the refetch committed first (now a guarded update); (2) Esc
  only paused placing (the hook's Esc re-rendered mid-event and dropped the page's re-bound listener; now
  bound once per session through a ref); (3) at zoom 18 a laptop-width map spans ~170 m and the numbered
  neighbours fell outside it (now zoom 17, the plan's floor); (4) Turf Cutting (and the Map page) framed
  the Atlantic around 0,0 homes — first views now skip 0,0, server extent included; (5) the lookup row's
  menu offered *View on map* for a run that inserts nothing — no menu now.
- **Beyond the plan, found while building:** an import-geocoded exact home on a complex's point joins it;
  the far rule's evidence set is every real-location door; wrong-ZIP cached answers are refused at fill;
  `GET /admin/imports` hides `pin_lookup` jobs unless `includeLookups=1` (the Exports page and the phone
  read it for their import pickers); Turf Cutting's building move is gated to `kind === 'building'`; the
  super-admin Imports page labels lookup runs. The proposal's "As built" lists all of them.
- **Not done here, by design:** the phone's words and its two list behaviours (S13.5, the next OTA); the
  owner's release steps (S13).
