# Proposal: Pin Fixes at scale — refuse impossible coordinates, catch wrong-town pins, use street-level answers, fix the rest together

> **Status: BUILT 2026-10-10 (uncommitted at time of writing), server and web, to the build plan
> [PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md](PROPOSAL_PIN_FIXES_AT_SCALE_BUILD.md) revision 7, including its eight
> disclosed departures, which the owner accepted with "build it". What differs from this design is under
> "As built" below; the phones need nothing to render it, and a later over-the-air update only changes words
> and two list behaviours.** Design history: plan and design revision 4 (2026-10-10), approved by the owner
> 2026-10-10 (D1–D15 as recommended). Revision 2 plus the owner's import line and the repair script's two dry runs on the live campaign (§O), which added the complex rule (§4), the bare-unit-number fix (D15) and the ZIP-boundary refinement to D3. One adversarial review round against the code so far (§P). Written after measuring the Fairfield
> file (`FairfieldRSwings24_2458.csv`, 43,666 rows, imported 2026-10-09) against the import and Pin Fixes
> code. It extends the placeholder-pins work ([PROPOSAL_PLACEHOLDER_PINS.md](PROPOSAL_PLACEHOLDER_PINS.md),
> releases [1](PROPOSAL_PLACEHOLDER_PINS_RELEASE1.md) and [2](PROPOSAL_PLACEHOLDER_PINS_RELEASE2.md)) and
> reuses its machinery everywhere it can. Related: [IMPORTS.md](IMPORTS.md), [MAPS.md](MAPS.md),
> [PASSES_AND_TURF.md](PASSES_AND_TURF.md), [AUDIT.md](AUDIT.md).

## As built (2026-10-10)

Built as designed, with these differences. The first eight are the build plan's disclosed departures
(its "Changes from the approved design"); the rest were found while building and checking it.

1. **Bare unit numbers (D15)** are folded only where two street addresses on one spot are compared
   (`baseFamily`), not in the address parser: road numbers like "Hwy 160" end in a street word plus a number.
2. **The two far downgrades are frozen on the knock** (`CanvassActivity.knockPin`): knocks after a lead
   confirms an estimate are judged in full; a complex stays forgiven within 300 m even once vouched.
3. **The setup step never blocks "setup complete"**: skipped once books are cut.
4. **Today's phones** list complex members under "No exact map spot" and leave them out of the camera
   framing until the next over-the-air update.
5. **The ZIP-boundary rule** is "same city, and among the street's homes" (read from the answer's formatted
   address), not a ZIP3 shortcut.
6. **Two confidence floors**: 0.5 to fill a home with no usable coordinate, 0.8 (measured) to replace a
   shared or far pin.
7. **The "Couldn't be found by address" card offers Look up by address** — the retry after a provider outage.
8. **A complex moves to Geocodio's exact point** even when the vendor's spot was a real one, so a complex has
   one key across files.
9. **A home a later file geocodes onto a complex's point joins the complex** instead of being flagged as a
   shared spot (a gap found while writing the tests).
10. **The far rule's evidence is every door with a real location**, not only the doors it judges; its
    judged set is as designed. The far end of a long, unevenly built road can be flagged; a lookup that
    agrees with the pin clears it.
11. **A cached answer in the wrong ZIP is refused when it is read**, so `repair:import-pins` prints a few
    fewer "refuted" lines than before.
12. **Look up by address runs** appear on the Import page as *Pin lookup · N homes* with no menu (nothing to
    view or undo) and on the super-admin Imports page; the Exports page's and the phone's "export from an
    import" pickers never offer one.
13. **No map's first view opens on the ocean**: the Map page, Turf Cutting, Pin Fixes and the server's
    door extent skip a home still at 0,0 (found in the browser check, which showed Turf Cutting framing the
    Atlantic).
14. **Turf Cutting offers Move building pin only for a real building**, never a complex.
15. **The import line** says the parked homes inside the unplaced count (*"60 without an exact spot, 5 of
    them kept at a holding spot"*) and links Pin Fixes when it reports far marks too.
16. **Place along the street flies to zoom 17** (the design's floor), so the street's numbered neighbours are
    in view; **Esc** leaves the mode; and a pre-existing race on the Pin Fixes page — Enter sometimes closed
    the popup instead of opening the next pin — is fixed. All three came out of the browser check.

---

# Part 1 — For everyone

## The problem in one paragraph

A voter file arrives with a latitude and longitude on every row, and Doorline trusts them. Most are right.
Some are the vendor's way of saying "I couldn't place this": a zero where the coordinate should be, one spot
stamped on a whole street, a pin in the wrong town. Today the import accepts every one of those as a real
place. The homes land in the ocean, or forty to a dot, or two towns over, and the only way out is Pin Fixes,
one drag per home. On a 40,000-voter file that is hundreds of drags, before a single book can be cut.

## What the Fairfield file actually contains

Measured on the file itself (the method is in Part 2 §O, so it can be re-run on any file):

| What | How many | What it looks like |
|---|---|---|
| Voter rows | 43,666 | Stamford 18,009 · Norwalk 14,281 · Fairfield 11,375 |
| Homes (address + unit) | 39,045 | 30,967 street addresses; 1,321 of them have more than one unit |
| **Homes at latitude 0, longitude 0** | **253** (279 rows) | 158 Mayfair Rd, 15 Barton Rd, 680 Jennings Rd… ordinary houses with a blank vendor quality code. 0,0 is the Gulf of Guinea, off West Africa — the "ocean" pins. 197 of the 253 carry the vendor's own "deliverable address" mark, so an address lookup will find almost all of them. |
| **Homes sharing one spot with a *different* street address** | **678** on 278 spots | 42 different house numbers on Foxboro Dr, Norwalk, at one point. These are the "76 on one coordinate, drag each one" cases — and the repair script's dry run shows what most of them are: **condo complexes on private drives**, where Geocodio's exact answer for every unit is the same point the vendor used (Rowayton Woods Dr 46, Foxboro Dr 39, Ledgebrook Dr and Gillies Ln 29, Glenrock 19, 162 New Canaan Ave 14…). |
| **What the import did with them** (your Recent imports line) | 1,374 looked up: **520 placed by address · 28 confirmed · 826 left** | The 826 are mostly complexes (above), plus 76 doors from 70 addresses still at 0,0 whose answers were street-level or a neighbour's roof, plus one-building pairs like "533 Black Rock Tpke" and "533 Black Rock Tpke 3" that the address key reads as two addresses (§4). |
| **Homes pinned far from everything else in their ZIP** | **129** more than 5 miles out; 57 more than 10 | 27 Tracey St, Norwalk sits 74 miles away; 237 Crest Ter, Fairfield 74 miles; 29 Malibu Rd, Stamford 52 miles. 24 of them the vendor itself marked as lower-quality (its MapCode 7 and below); the rest it marked as good. |
| Homes with no street address to look up | 12 | "Fairfield University No Know", ZIP 00000; a blank line. Nobody can place these. |
| Apartment towers (one address, many units, one spot) | ~465 spots of 5+ units | 880 Pacific St, Stamford: 86 units. **Correct as one building.** The maps already show these as "N units" and nothing here changes that. |
| Coordinates rounded to about 110 m by the vendor | 247 | Fine for finding the street, a house or two off for the door. Not worth a lookup on its own. |

The vendor's quality column (`MapCode`) and its delivery-point column are in the file, but Doorline doesn't
read them, and shouldn't need to: every row above is detectable from the coordinates and addresses alone,
which works for every vendor.

## Why today's tools make this a slog

- **The import accepts any number inside the world.** It rejects a coordinate only when it isn't a number or
  is beyond ±90 / ±180. 0,0 is inside the world. A pin in the wrong state is checked only when two rows of
  the *same* house disagree. ([IMPORTS.md](IMPORTS.md) lists this as a known gap.)
- **The automatic lookup places exact rooftops only.** Since release 1, each import looks up the homes that
  share a spot with other addresses, but moves a home only when the answer is an exact rooftop in its own
  ZIP. A street-level answer ("somewhere along this block") is refused, even though it is far better than
  the shared dot — and even though a file that arrives *without* coordinates has always accepted exactly
  those answers, marked "Approximate location". So after the Fairfield import, every home whose answer was
  "on the street" stayed on the shared dot or in the ocean, and became a drag.
- **A complex is refused for being a complex.** The lookup never places an answer that another address also
  claims — the right guard against a geocoder's own placeholder, but a condo complex *is* one point with
  forty addresses. The 46 homes on Rowayton Woods Dr each got an exact answer, all identical, all refused,
  all left as 46 drags whose only honest destination is the spot they are already on.
- **A bare unit number on the street line splits one building in two.** "533 Black Rock Tpke" and "533 Black
  Rock Tpke 3" are one house; the address key strips "Apt 3" but not a trailing "3", so they read as two
  addresses, collide on their own roof, and both stay flagged.
- **Wrong-town pins aren't caught at all.** The only check for "this pin is nowhere near its street" lives in
  an operator script nobody runs by default (`repair:import-pins`). The import never looks.
- **There is no "look these up again."** The only way to re-run the lookup is to upload the file again.
- **Pin Fixes is one decision per home.** It lists every pin by street, with a drag, a confirm, satellite
  imagery and keyboard keys. Good for thirty homes. For eight hundred there is no "do these together", no
  way to see *why* a home is in the queue, and no click-to-place.
- **Nothing warns at cut time.** The sidebar badge counts pins to fix; Generate cuts regardless, and the
  homes land in whichever book covers their wrong spot.

## What changes

In order of how much work it saves, biggest first.

### 1. The import refuses coordinates that can't be real

A file coordinate is used only when it is a plausible place for that address:

- **not 0,0** (or within a metre of it);
- **inside the home's own state** (the row's State column, which every row must carry).

A refused coordinate counts as *no coordinate*: the home is kept, looked up by its address at import (when
lookups are on), and parked at the holding spot of §5 if the lookup finds nothing — or straight away, when
lookups are off. It is never dropped and never left in the ocean. The preview says so before anything is
written: *"253 homes have no location in the file (0,0) — Doorline will place them by address."*

### 2. The import catches pins that are far from their street

The repair script's rule becomes part of every import: a home whose pin is far from the other homes on its
street (in its ZIP) is suspect — "far" scales with how spread out that street already is, so a long rural
road isn't flagged for being long. Streets with too few homes to judge fall back to the ZIP: a home miles
from everything else in its ZIP is suspect too. Suspect homes are looked up by address like shared-spot
homes are today. A pin the lookup agrees with is cleared on the spot. On this file it would catch the 74-mile
outliers and roughly 130–500 homes in between, nearly all of which the lookup can settle.

### 3. Street-level answers are used — honestly

One rule for every answer the lookup gives, wherever it comes from: **an answer may replace a pin only when
it beats what the home has.**

| The answer | What it means | What it may replace |
|---|---|---|
| Exact rooftop | Geocodio knows this house | anything |
| Along the street (range interpolation) | the right block, position estimated | a shared spot, a wrong-town pin, a missing coordinate — shown as **Approximate location** (amber ring), listed in Pin Fixes for a quick confirm |
| Middle of the street | only the street is known | only a missing coordinate or a wrong-town pin — also Approximate |
| Nearest known roof | the roof of a *nearby* address | only a missing coordinate or a wrong-town pin — Approximate, never a shared spot (two homes on one dot would both be sent to the same neighbour) |
| City / county / state centroid | not a placement | nothing, ever |
| Any answer in a different ZIP than the address | usually the wrong place, however exact | nothing — unless the answer is in the same city and sits among that street's other homes (3499 and 3585 Black Rock Tpke: the file says 06825, the house is in 06824, both Fairfield; the ZIP line runs down that road) |

An along-the-street answer also has to pass the same "far from its street" test as everything else, so an
estimate on the wrong end of town is refused, and it has to carry Geocodio's own confidence score at or above
a floor we measure once (Part 2 §L: three hundred of this file's known-good rooftops cost about thirty cents
to check Geocodio's estimates against). This replaces the never-built calibration variable from the earlier
plan with a rule the data itself calibrates.

**One rule means a change for files that arrive without coordinates, too.** Today such a file's homes take
a *nearest known roof* answer as an exact, unflagged pin, and take an answer in another ZIP as long as it is
in the state. Under this plan the first arrives flagged **Approximate location** (it is a neighbour's roof)
and the second is refused and parked (§5). A few more homes wait in Pin Fixes; none sits on the wrong roof
pretending to be exact.

**What this does to the Fairfield numbers.** Every home the lookup can put on the right block stops being a
drag and becomes a two-second "Looks right" (or a short nudge) in Pin Fixes, with the pin already on the
right street in satellite view.

### 4. A condo complex is one spot, and that is the right answer

When the lookup gives **the same exact point to two or more different addresses that already share the
vendor's spot**, the vendor and Geocodio agree: these homes are one place — a complex. Instead of refusing
every answer and flagging every home, Doorline marks the spot a **complex**:

- On every map it reads **"46 homes · a complex"**, with each home listed and **its own Directions**, exactly
  as the "N homes" screens built in release 2 already work. Canvassers walk the complex; the app sends them
  to each unit's address, never to the dot.
- It is **not** "No exact map spot": nothing is unplaced, so it is not one of the 826, it is cut into books as
  one point with 46 doors (as a tower is today), and nothing nags.
- In Pin Fixes it is one row under **Complexes (N)**, not 46: **Looks right — it's a complex** vouches all of
  them in one click (a re-import can't undo the vouch), **Spread on the map** opens *Place along the street*
  for anyone who wants the units on their actual buildings in satellite view, and that is the escape hatch
  if a "complex" turns out to be separate houses. The sidebar count treats a complex as one thing to look at.
- The complex keeps the vendor's spot. It moves to Geocodio's point only when the vendor's spot was no spot
  at all (0,0 or the wrong town).
- Only exact answers can make a complex. Two homes that merely share a street-level answer are a geocoder
  that gave up, not a complex, and stay flagged as today.

The same rule quietly fixes the bare-unit-number pairs: "533 Black Rock Tpke" and "533 Black Rock Tpke 3"
share one exact roof, so they become a two-home complex on it, flagged no more. And the address key learns
the pattern itself (a trailing bare number after a street word is a unit), so future imports read them as one
building in the first place. Units written into the house number — "10A Bloomfield Dr" beside "10 Bloomfield
Dr # A", "2A" and "2B Bethel St" — are left to the complex rule on purpose: "10A" is a real house number on
plenty of streets, so the parser must not touch it.

On Fairfield, the complexes named in the dry run alone account for well over two hundred of the 826, and the
printout was cut off before it finished listing them.

### 5. A home nobody can place is kept, flagged, and never left in the ocean

When the file gave no usable coordinate *and* the address lookup finds nothing, the home is not dropped and
not left at 0,0. It is parked at a **holding spot** — the middle of its ZIP's other homes — and flagged
**"Couldn't be found by address."** It shows on every map as part of an "N homes" marker, it is listed in
Pin Fixes under its own heading, it is left out of book cuts unless you say otherwise (§9), and the
canvasser app, if it ever gets one, already says "No exact map spot — use Directions." Nothing is lost and
nothing is guessed silently: the flag is the whole point.

The same rule applies to files that arrive without coordinates at all, when lookups are on: today a home
the lookup can't place is dropped with its voters and listed in an error list no screen reads. Under this
plan it is kept at the holding spot and flagged instead. Losing a house is worse than a flagged pin. (With
lookups off, a file without coordinates is skipped row by row and counted, exactly as today — it cannot be
imported without lookups; that is a Doorline setting, not something the file can fix.)

The holding spot is one point per ZIP, deliberately: the homes parked there form a single "N homes" marker
that reads as what it is, and one *Set aside all* clears them together.

### 6. Pin Fixes works by cause, with "do these together"

The page keeps everything it has — the street list, the map, drag, Looks right, Google Maps, auto-advance,
the keyboard — and gains a **Fix together** section at the top. Each card is a group of homes with one
cause and one set of actions:

```
Pin Fixes · Fairfield R Swings                                   312 doors to review
────────────────────────────────────────────────────────────────────────────────────
FIX TOGETHER

┌ Share one spot with other addresses ─────────────── 86 homes · 9 spots ──────────┐
│ The file gave these homes one coordinate. 42 are on Foxboro Dr, Norwalk;          │
│ 9 on Thomas Pl… Doorline looked them up by address on Oct 9 and placed 592.       │
│ [ Look up by address ]  [ Place along the street ]  [ Set aside… ]   Show homes ▾ │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Pinned far from their street ──────────────────────────────── 19 homes ───────────┐
│ Each pin sits miles from the rest of its street. The lookup couldn't settle these. │
│ [ Look up by address ]  [ Set aside… ]                               Show homes ▾ │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Couldn't be found by address ──────────────────────────────── 13 homes ───────────┐
│ No location in the file, and the address lookup found nothing. Parked at a        │
│ holding spot; left out of book cuts until placed.                                 │
│ [ Place along the street ]  [ Set aside all 13 ]                     Show homes ▾ │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Complexes ────────────────────────────────────────── 212 homes · 11 spots ────────┐
│ Each spot is one complex: the file and the address lookup agree every home on it   │
│ is here. Rowayton Woods Dr (46) · Foxboro Dr (39) · Ledgebrook Dr (29) …           │
│ [ Looks right — it's a complex ]  [ Spread on the map ]              Show spots ▾  │
└───────────────────────────────────────────────────────────────────────────────────┘
┌ Placed on the street, not the house ──────────────────────── 194 homes ───────────┐
│ The lookup put these on the right block. Check each one on satellite:             │
│ Enter = Looks right, or drag it onto the roof.                                    │
│ [ Start checking ]                                                   Show homes ▾ │
└───────────────────────────────────────────────────────────────────────────────────┘
Set aside (4) ▸

BY STREET  (everything above, in the list you know)
Foxboro Dr, Norwalk 06851 ………………………………………………………………… 42
  1002 Foxboro Dr  · No exact map spot ·  [Move pin] [Looks right — the home is here] [Google Maps ↗]
  …
```

- **Look up by address** runs the same lookup the import runs, on just that group (or just the homes you
  tick), with the answer rule in §3. It is for campaigns imported before this ships, for an import whose
  pin check was busy or failed (today's advice is "import the file again"), and for anything over the
  per-import ceiling. The page shows progress and ends with *"Placed 231 on the house · 19 on the street ·
  3 still without a spot."* Each address looked up is one lookup at the usual rate, Doorline's cost, never
  shown to the organization — exactly as the import's lookups are today.
- **Place along the street** is the hand-fix accelerator (§7).
- **Set aside** is for homes nobody can place (§8). The "Couldn't be found" card offers no lookup: the
  address service's "not found" is remembered for 30 days, so asking again inside that window answers
  nothing. A refreshed file with a corrected address is looked up again as a matter of course.
- **Start checking** is today's quick-confirm flow — satellite, Enter, auto-advance — scoped to that group.

Each card opens into its homes grouped by street, which is the list the page has today.

### 7. Place along the street: click, not drag

Pick a group or a street and the map flies there in Hybrid view, zoomed to the block. The street's homes
that *are* placed appear with their **house numbers** as labels, so the numbering direction and the odd/even
side are visible. The homes to place are listed in house-number order in a rail; the first is highlighted.

**Click the roof. The pin is saved and the next home lights up.** One click per home, about two seconds
each; forty-two homes on Foxboro Dr is a couple of minutes. **Undo** steps back one. **Skip** leaves a home
for later. A home whose address has other units on the spot asks once, "Just this unit / Whole building
(N units)", exactly as Move pin does. Every click is the same pin move as a drag — the same writer, the same
audit row, the same book-outline redraw — so nothing about what a pin fix *means* changes; only how many
gestures it takes.

Doorline never places two homes for one click, and never interpolates between two homes you placed by hand:
that is the lookup's job, with real address ranges behind it.

### 8. Set aside: for homes nobody can place

"Fairfield University No Know, 00000" is not going to get a pin. **Set aside** takes a home (or a whole
"Couldn't be found" group) out of the Pin Fixes queue and out of every book cut, and lists it under a
collapsed **Set aside (N)** heading with **Bring back**. It is the same hold that *Remove apartments* uses,
with a note of who set it aside and when — and *Re-include apartments* never brings a set-aside home back,
nor counts it as an apartment. Fixing the pin later (a move or a Looks right) brings the home back on its
own. Set-aside homes stay on the admin map, flagged, under the same **Dim / Hide** treatment the map already
gives doors removed from books, and the map's counts include them, because that map is the record of what
exists. A set-aside home that was already in a published book leaves its canvasser's list, as *Remove
apartments* does.

### 9. The cut asks before it buries them

On Turf Cutting, the Generate panel shows a line whenever the round has homes without a reliable spot:

```
☑ Leave out 32 homes without a reliable map spot          Fix in Pin Fixes →
   They share a spot with other addresses, sit far from their street, or couldn't be
   found by address — cut as they are, they land in the wrong book.
```

It is on by default. Homes left out appear after the cut under *"N doors not in any book"* once their pins
are fixed, where **Add as new book** and the spot pop-up's **Move to book…** already take them. Untick it and
the cut behaves exactly as today. Approximate pins (on the right block) are never left out — they cut fine.
The campaign's setup guide gains a **Check map pins (N)** step ahead of *Cut books* for the same reason.

### 10. The import tells you what it did, in plain numbers

Before: *"Map pins from your file: 38,100 · 253 have no location (0,0) · 129 are pinned far from their
street · 678 share a spot with other addresses — Doorline looks these up by address after import · 12 have
no street address and can't be looked up."*

After: *"Map pins: 1,012 placed by address · 41 placed on the street (check them) · 9 confirmed at their
spot · 18 without an exact spot (Pin Fixes →)."*

### 11. The GPS audit stays fair at an estimated pin

A canvasser who walks to the real house while its pin sits on an estimate a few doors down would otherwise
collect a "far from house" flag for being right. A knock recorded at a pin that is *approximate and not yet
confirmed* reads **low** on Far, with the reason shown, until a lead confirms or moves that pin — the same
treatment the earlier plan designed for shared spots (which you chose not to apply there; §A D10 asks you
again for estimates only, where the case is different: an estimate is a real guess at *this* house). On the
audit's summary tile these knocks count under the existing "forgiven by pin" number.

A complex (§4) is the other case where the dot is honest but not the door: a canvasser at unit 46 can be
a few hundred feet from the complex's pin. A knock at a complex home within about 1,000 ft of its spot is
not "far"; beyond that it is judged as today. This is a decision for you (D14).

## What stays the same

- Real apartment buildings: "N units", Move building pin, Whole building. Untouched.
- Who can fix pins: team leads and admins. Canvassers see the badges and nothing more.
- Every pin move is one writer, one audit row, one outline redraw; books are never re-cut by a pin fix.
- A pin a person moved or confirmed is never moved or flagged by an import or a lookup.
- Costs: the same lookups, the same internal rate (about a dollar per thousand), Doorline's, invisible to
  organizations. This whole file is about 1,100 lookups — just over a dollar.
- The phones: nothing new to install. New kinds of flagged home show as "No exact map spot" today; the
  per-cause wording comes with the next over-the-air update.

## What it means for the Fairfield campaign right now

**What the import did (your Recent imports line):** 1,374 homes looked up · 520 placed by address · 28
confirmed at their spot · **826 without an exact spot.**

**What the dry run found** (`npm run repair:import-pins -- --campaign=6ac933c75c0e9dd8e73153b7`, cache-only,
no writes): 1,276 suspect doors. From answers already in the cache it could fix **21** — thirteen homes still
at 0,0 (131 Beach Rd, 345 Reef Rd, 300 Soundview Ave…), five wrong-town singles the import never looks for
(28 Summit Pl 27 miles off, 60 Woodledge Rd 23 miles, 19 Avon Ln 20 miles, 109 Saint Charles Ave 4 miles,
1 Greyrock Pl 4.5 miles) and three strays. **19** were refuted (the address geocodes to where the pin is).
Everything else it refused, and the refusals are the point: nearly all read *"geocoder placeholder — N
different addresses get this identical spot"*, which, because the script checks the answer type first, means
**exact rooftop answers that Geocodio gave to a whole complex** — the §4 case, with a tail of one-building
pairs split by a bare unit number. A handful were *nearest rooftop* answers (1 Chestnut St Apt 609, 1116
Stillview Rd, 43 Rowayton Woods Dr) and one a ZIP mismatch (1B River Rd), which §3 turns into approximate
placements or a parked home.

**What the paid dry run found** (`--geocode`, 2026-10-10): it bought 472 answers (about 47 cents) and
can now fix **196** doors — the thirteen 0,0 homes with rooftops, and some 180 wrong-town singles the import
never looks for, many of them absurdly far (130 Tresser Blvd Apt 812 at 127 km, 237 Crest Ter 119 km,
2057 Kings Hwy 100 km, 27 Plymouth Ave 99 km, 9 Cottontail Rd 99 km, 140 Grace St 91 km, 102 Keeler Ave
88 km, 29 Malibu Rd 86 km) and the rest 1–60 km. It **refuted 228** suspects: their rooftop answer is where
the pin already is, so the street rule's doubt was unfounded and nothing moves. Still refused: the complexes
and bare-unit pairs (§4), three nearest-roof answers, and two ZIP-boundary cases (3499 and 3585 Black Rock
Tpke, file ZIP 06825, house in 06824) that D3's same-city refinement now covers.

**What you can do today, before anything ships:**

1. **Apply it:** `npm run repair:import-pins -- --campaign=6ac933c75c0e9dd8e73153b7 --geocode --apply --user=<an admin user's id>`
   (your own account's 24-character id, from the address bar on Super admin → All Users → your account).
   It moves the 196 to their rooftops, writes an audit row per door, marks each "Pin corrected" so no
   re-import undoes it, and redraws nothing you've cut yet. Lookups are cached from the dry run, so this run
   buys nothing new. It cannot touch the complexes or the street-level answers, by its own (correct, for its
   era) rules.
2. For the complexes, the honest interim is **leave them where they are** — the pin is the complex, and the
   release-2 phone screens already give each home its own Directions. Don't drag 46 pins onto roofs you'd be
   guessing at. Cut books; a complex cuts as one point with its doors, like a tower.
3. The ~57 addresses still at 0,0 after step 1 and the handful of refused singles are the only ones worth
   hand-placing now; Pin Fixes with Hybrid imagery and the Google Maps key handles that many.

**Once this ships:** the complexes leave the queue on their own, *Look up by address* with the new answer
rule clears most of 0,0, *Start checking* confirms the approximate ones, *Place along the street* takes the
rest, *Set aside* the dorms, cut with the box ticked.

## Decisions for you

| # | Question | Recommendation |
|---|---|---|
| D1 | Refuse 0,0 and out-of-state file coordinates at import, and look those homes up by address? | **Yes.** Zero risk: a coordinate that fails these tests is wrong for certain. |
| D2 | Flag pins far from their street at import, campaign-wide, and look them up? | **Yes.** Suspicion costs a lookup (a tenth of a cent); nothing moves without an answer that beats the pin. |
| D3 | Accept along-the-street answers as "Approximate location" wherever they beat the current pin — under one answer rule that also tightens coordinate-less imports (a nearest-roof answer arrives flagged; a wrong-ZIP answer is refused)? | **Yes.** It is the bar coordinate-less files have always had for street-level answers, and the single biggest saver of drags. Shipped with the floor measured on this file's own rooftops (§L) and the far-from-street test on every estimate. |
| D4 | Park an unplaceable home at a holding spot in its ZIP, flagged, instead of dropping it or leaving it at 0,0 — for coordinate-less files too? | **Yes, both.** Keeps the house and its voters; the flag, the Pin Fixes card and the cut toggle make it impossible to miss. |
| D5 | *Look up by address* from Pin Fixes, run through the import worker? | **Yes.** Same lookup, same cost rules, same history row under Recent imports. |
| D6 | Pin Fixes grouped by cause with group actions, on top of today's street list? | **Yes.** |
| D7 | Click-to-place with neighbours' house numbers shown? | **Yes.** No interpolation between hand-placed homes. |
| D8 | Set aside, reusing the *Remove apartments* hold plus a who/when note; fixing the pin brings it back? | **Yes.** |
| D9 | Leave flagged homes out of the cut by default, with the line and the link? | **Yes.** Default on; untick to cut as today. |
| D10 | Knocks at an unconfirmed estimated pin read low on Far until the pin is confirmed or moved? | **Yes, for estimates only.** You declined this for shared spots; an estimate is a guess at this very house, so a 60-foot miss is the estimate's error, not the canvasser's. Your call either way; the rest of the plan doesn't depend on it. |
| D11 | Read the vendor's quality columns (MapCode, DPV)? | **No.** Vendor-specific; the coordinate and address rules above find the same rows for any vendor. |
| D12 | Verify every pin against the address (about $31 for this file)? | **Not now.** It would also *create* work: file and lookup disagreeing by a house-width needs a person. Later, as a super-admin run, if a file turns out untrustworthy. |
| D13 | Recognise a complex automatically — two or more different addresses on one vendor spot whose exact answers are one identical point — and treat it as a place, not as unplaced? | **Yes.** Two independent sources agree. One row in Pin Fixes (Looks right / Spread on the map), per-home Directions on phones (already built), cut as one point. Only exact answers qualify; a shared street-level answer stays flagged. |
| D14 | A knock at a complex home within about 1,000 ft of its spot is not "far"? | **Yes.** The dot is the complex, not the door; the earlier shared-spot question was about spots that were provably *not* the home, this one is about spots that provably are. Your call; D13 stands without it. |
| D15 | Teach the address key that a trailing bare number after a street word is a unit ("533 Black Rock Tpke 3" → "533 Black Rock Tpke")? | **Yes, narrowly.** Only after a recognised street word, only one trailing token, mirrored to web and phone under the existing drift test. Walk-packet street bands share the parser, so the change is tested there too. |

---

# Part 2 — Technical reference

## A. Decisions (technical form)

| # | Decision | Mechanism |
|---|---|---|
| D1 | Off-world and out-of-state file coordinates are refused in `mapRow` | `isUsableFileCoord({ lat, lng, state })` in [`utils/stateBounds.js`](../server/src/utils/stateBounds.js): false when `Math.abs(lat) < 1e-5 && Math.abs(lng) < 1e-5` (Null Island, within ~1 m) or `!inStateBounds(state, lat, lng)`; `state` is the row's own State column (`missingRequired` already requires it, [`csvImporter.js:120-128`](../server/src/services/import/csvImporter.js), so no campaign fallback is needed). `inStateBounds` keeps failing open on unknown codes. The row keeps `coordsProvided: true` and gains `coordRefused: 'offworld' \| 'outside_state'`; `latitude/longitude` are null so `needsGeocode(h)` is true. **The validator must let it through:** today the `bad_coords` branch ([`csvImporter.js:305-319`](../server/src/services/import/csvImporter.js)) drops every null-coordinate row that `coordsProvided` or that arrives with lookups off; it becomes `if ((coordsProvided && !coordRefused) \|\| (!coordRefused && !geocodeEnabled))` — a refused row survives to grouping whether or not lookups are on, and with lookups off it goes straight to the holding spot (D4). |
| D2 | Street/ZIP outliers are classified in the pass and counted in the preview | `streetOutliers` leaves [`migrations/repairImportPins.js`](../server/src/migrations/repairImportPins.js) for a shared pure module `utils/pinCohorts.js` (`cohortOutliers({ doors, byStreet: true })`, then a ZIP-cohort fallback for cohorts under `MIN_COHORT`). Same constants: `MIN_METERS 250`, `MIN_COHORT 3`, `OUTLIER_FACTOR 4`; ZIP cohorts use `ZIP_MIN_METERS 3000`. The script imports it. |
| D3 | One answer ladder, two gates, one classifier | `pinTrust.js`: `answerClass(answer)` (`rooftop`/`point` → `exact`; `range_interpolation` → `estimate`; `street_center` and `nearest_rooftop_match` → `street`; `place`, `county`, `state`, none → `none`), `zipMatches(answer, door, cohort)` (matched ZIP5 equals the address ZIP5, **or** the matched city equals the address city and the point is not an outlier against the street's placed homes by `pinCohorts` — the 3499 / 3585 Black Rock Tpke case, where a ZIP line runs down the road; a missing matched address refuses) and `pinClass(door)` (`unlocated`/refused → 0, `far` → 1, `placeholder`/`stray` → 2). `answerBeats(a, door)`: `zipMatches` and `inStateBounds`, then class `exact` beats everything; `estimate` beats 0–2 when `accuracy >= PIN_INTERP_MIN_ACCURACY` (default 0.8) and the point is not a cohort outlier for its street/ZIP; `street` beats 0–1 only. **Gate 1, the pass:** `stackPolicy` becomes `lookupPolicy`, taking the class into account; the collision rules are unchanged; `CLAIM_TYPES` stays for the collapse pool (`isPointClaim`). **Gate 2, import-time placement of class-0 homes:** `evaluate()` in [`geocodeService.js:73-87`](../server/src/services/import/geocode/geocodeService.js) uses `answerClass` and `zipMatches` instead of `ACCEPTED_TYPES`/`ROOFTOP_TYPES`, so a `nearest_rooftop_match` becomes `'interpolated'` (today `'exact'`) and a wrong-ZIP answer is refused (today accepted if in state); `confidenceFor` maps `exact` → `'exact'`, `estimate`/`street` → `'interpolated'`. **Accuracy must travel:** `fillFrom` and the new-answer fill ([`geocodeService.js:164-174`](../server/src/services/import/geocode/geocodeService.js), `:244-249`) set `h.geocodeAccuracy`, and the pass's answers map ([`placeStackedPins.js:353-363`](../server/src/services/households/placeStackedPins.js)) reads it as `accuracy`. |
| D4 | Holding spot | `services/import/holdingSpot.js`: `holdingSpotFor(zip5, placedHomes)` = arithmetic mean of the file's placed homes in that ZIP5 (fallback: same city; fallback: the campaign's existing active doors in that ZIP; else the home is dropped and listed with the geocode error codes the processor uses today, [`importProcessor.js:193-200`](../server/src/services/import/importProcessor.js)), then nudged north by 0.0005° until `buildingKeyForCoords` matches no active door in the campaign. **One spot per ZIP5** — every parked home in a ZIP shares it, so they render as one "N homes" marker. Written with `pinSuspect: 'unlocated'`, **`coordSource: 'holding'`** (a new value: a Doorline-derived point must not masquerade as the vendor's; `fileish` in the pass accepts `'file'`, `null` and `'holding'`; the cohort rule and the repair script exclude it; the importer's vendor-change rules treat it like `'file'` — a later file with a usable coordinate replaces it), `coordConfidence: null`. **Precedence:** a stored `unlocated` is never overwritten by a spot verdict (the holding spot is a `placeholder` by shape; today's classify loop would relabel it at [`placeStackedPins.js:250-253`](../server/src/services/households/placeStackedPins.js) — the new first rule in step 2–3 keeps the more specific kind and still makes the door a candidate). |
| D5 | *Look up by address* job | `ImportJob.kind` += `'pin_lookup'`; `POST /admin/campaigns/:id/households/pin-lookup { householdIds?: [], group?: 'shared' \| 'far' \| 'unlocated' }` enqueues it on the import queue. `processImportJob` branches on the kind **before** `loadRawImport` ([`importProcessor.js:99`](../server/src/services/import/importProcessor.js) loads the upload first today, so a file-less job must be dispatched above it, after the campaign and deletion guards) to a small `processPinLookupJob` that skips the spill setup, sets `status: 'importing', phase: 'pins'` (so the Status column reads "Checking map pins" through the client's existing `isCheckingPins`) with the same 30-second heartbeat, then calls `placeStackedPins({ campaign, importJob, paidScope: <normalizedAddress set of the targets>, tallyIds: <their ids>, allowPaid })`, saves the tally and marks the job `completed`. The row shows in Recent imports with the same `importPinLine`; **Undo** is refused server-side for the kind (`undoFileImport` has nothing to undo) and hidden by the client. |
| D6 | Groups | Client-side from the existing payload: `buildGroups(rows)` in [`client/src/lib/pinFixes.js`](../client/src/lib/pinFixes.js) keyed on `pinSuspect` kind and `coordConfidence`. The route adds `pinPlaced` (via `pinWireFields`) and `setAside` to each row and returns `setAside` rows in a second list. |
| D7 | Click-to-place | `useMovePin` gains `placeByClick(target, onPlaced)`; the map's click handler saves through the existing `PATCH …/location` and advances. Neighbours come from the existing viewport-bounded `GET /admin/households/map` for the current bbox, drawn as a labelled symbol layer (house number from `addressLine1`). |
| D8 | Set aside | `services/households/setAsidePin.js` (ONE writer): `setAsidePin` sets `excludedFromTurf: true` and `pinSetAside: { at, by }`; `bringBackPin` clears both. `updateHouseholdLocation` and `confirmHouseholdLocation` clear both when `pinSetAside.at` is set. `NEEDS_PIN_FIX` and `UNPLACED_PIN` gain `'pinSetAside.at': null`. **Re-include must not sweep them:** `POST …/turfs/include-apartments` clears every `excludedFromTurf` door in the effort today ([`turfs.js:762-765`](../server/src/routes/admin/turfs.js)); it and the "N apartment doors excluded" count (`excludedApartmentCount`, [`turfs.js:662`](../server/src/routes/admin/turfs.js)) add `'pinSetAside.at': null`. The admin map keeps showing set-aside doors (it never filters `excludedFromTurf`; the client's Dim/Hide treatment in [`client/src/lib/excludedDoors.js`](../client/src/lib/excludedDoors.js) applies) and its counts include them. |
| D9 | Cut toggle | `cutExclusionFilter({ excludeUnplaced })` pushes `{ $or: [{ pinSuspect: { $exists: false } }, { locationConfirmedAt: { $ne: null } }] }` into its `$and`. Today's callers — `generateTurf` ([`generateTurf.js:168`](../server/src/services/turf/generateTurf.js)), `addSupplementalBooks` (`:358`) and `/target-preview` ([`turfs.js:830`](../server/src/routes/admin/turfs.js)) — pass `excludeUnplaced` through `params` like `excludeRestricted`; `/attribute-preview` and `/manual-preview` use `KNOCKABLE_DOOR_FILTER` alone today and gain the same clause so their counts equal the cut's; manual mode honours the toggle (a drawn area's flagged homes are left out). `TurfsPage` sends it (default true when the round's count > 0). The label's count is the **actual delta**, the pattern `/target-preview` already uses ([`turfs.js:846-852`](../server/src/routes/admin/turfs.js)): flagged homes that would otherwise be cut (`UNPLACED_PIN` ∩ the cut's base filter), not the raw flagged population. |
| D10 | Far downgrade at an estimate | `knockPin: 'estimated'` stamped on `CanvassActivity` at knock time when the door is `coordConfidence === 'interpolated' && !locationConfirmedAt` — at **both** writers, the door outcome ([`canvass.js:436`](../server/src/routes/mobile/canvass.js)) and the survey submission (`:933`); the schema field on [`CanvassActivity.js`](../server/src/models/CanvassActivity.js) is a gate (strict mode drops an unknown path silently). An offline replay stamps at flush time, the same freeze `distanceFromHouseMeters` has (`:210-213`, `:448`). `farAssessment` ([`flagDetection.js:282-350`](../server/src/services/audit/flagDetection.js)) returns `low` with reason `estimatedPin` when set; the summary tile (`farKpi.js`) counts these rows under the existing "forgiven by pin" bucket. The stamp is frozen on the row, never re-derived (the reference's D3b and its round-1 blockers). |
| D13 | Complex verdict | In `lookupPolicy` (pure): after classing, group the *exact*-class answers of one vendor spot's candidates by `answerKey`; a key claimed by ≥ 2 different `stackBaseOf` bases (not the same `cacheKey`) is a **complex claim**. Its claimants are returned as `complex: [{ id, key, spotKey }]` instead of `refused`; the pass writes `pinSuspect: 'complex'`, `pinComplexKey: <the vendor spot's building key>` and `pinPlacement.answer: 'exact'`, keeps the location when the spot's `pinClass` is 2, and moves the whole set to the answer key when it is 0 or 1 (0,0 or far). Members whose answers differ (a real house wrongly stacked) are placed as today; `estimate`/`street` answers follow the ladder. A key claimed by several bases with *non*-exact answers is refused as today. |
| D14 | Far at a complex | `knockPin: 'complex'` stamped at both knock writers when the door's effective `pinSuspect` is `'complex'`; `farAssessment` treats a distance under `COMPLEX_FAR_M` (default 300) as not far and reads `low` with reason `complexPin` beyond it until a lead confirms or moves the pin. Same freeze rules as D10. |
| D15 | Bare unit number | `stripUnits` in [`utils/streetName.js`](../server/src/utils/streetName.js) (shared by `stackBaseOf`, `homeKeyOf`, `isUnitAddress`) strips one trailing `\d+[A-Z]?` token when the token before it is a `STREET_WORDS` member ("533 Black Rock Tpke 3" → "533 Black Rock Tpke"; "857 Post Rd 146" → "857 Post Rd"; never "100 Pier A" — "Pier" is not a street word by D5 of the reference). Web (`client/src/lib/buildings.js`) and phone (`mobile/lib/streetName.js`) mirrors under `server/test/streetNameDrift.test.js`; `buildPacket.js`'s street bands get a fixture with the pattern. |

## B. One owner per mechanism

| Mechanism | Owner | Callers |
|---|---|---|
| File-coordinate plausibility | `isUsableFileCoord` in [`utils/stateBounds.js`](../server/src/utils/stateBounds.js) | `mapRow` ([`csvImporter.js:95-114`](../server/src/services/import/csvImporter.js)) only. `updateHouseholdLocation`'s own guards (`isValidLatLng`, `inStateBounds`) stay as they are. |
| Street / ZIP cohort outliers | `utils/pinCohorts.js` (new; pure) | The pass (step 2b), the preview's `finish()`, `repair:import-pins`, the `estimate` gate in `answerBeats`. |
| Answer classes | `answerClass`, `zipMatches` in [`pinTrust.js`](../server/src/services/households/pinTrust.js) | `evaluate()` in `geocodeService.js` (import-time placement of homes with no usable coordinate) and `lookupPolicy` (the pass) — one classifier, two gates. |
| Answer ladder (the pass) | `pinClass`, `answerBeats`, `lookupPolicy` in `pinTrust.js` | The pass only. `repair:import-pins` keeps its own gate (`adjudicate` with `OVERRULE_TYPES = ['rooftop', 'point']`, [`repairImportPins.js:316, 388-440`](../server/src/migrations/repairImportPins.js)), unchanged. |
| Answer evidence on a household object | `fillFrom` and the new-answer fill in [`geocodeService.js`](../server/src/services/import/geocode/geocodeService.js) set `geocodeAccuracyType`, `geocodeMatchedAddress` and (new) `geocodeAccuracy` | The pass's answers map; the repair script's probes. Never persisted on the Household document. |
| Holding spot | `services/import/holdingSpot.js` | `importProcessor.js` after `geocodeService.resolve()` and for `coordRefused` rows the lookup didn't place. |
| Placement (classify, mark, look up, gate, write, outlines, tally) | [`placeStackedPins.js`](../server/src/services/households/placeStackedPins.js) | The apply import; the `pin_lookup` job. |
| Pin-lookup job | `processImportJob` kind branch | `POST …/households/pin-lookup`. |
| Set aside / bring back | `services/households/setAsidePin.js` | `POST …/households/set-aside`, `POST …/households/bring-back`; the move and confirm writers (auto bring-back). |
| Cut exclusion | `cutExclusionFilter` in [`generateTurf.js`](../server/src/services/turf/generateTurf.js) | `/generate`, `/target-preview`, `/attribute-preview`, `addSupplementalBooks`. |
| Human pin moves | [`updateHouseholdLocation.js`](../server/src/services/households/updateHouseholdLocation.js) | Web PATCH (drag **and** click-to-place), mobile POST, repair `--apply`. Unchanged signature. |
| Pin Fixes queue predicates | `NEEDS_PIN_FIX`, `UNPLACED_PIN` in [`confirmHouseholdLocation.js`](../server/src/services/households/confirmHouseholdLocation.js) | The list route, the `pinsToFix` rollup, the cut toggle's count. |
| Complex verdict | `lookupPolicy` in `pinTrust.js` (the only place an answer shared by several addresses is judged) | The pass. `repair:import-pins` keeps refusing collapses (it is rooftop-and-unique by design and is not changed). |
| Complex vouch | `confirmHouseholdLocation(household, { scope: 'spot' })`: fan-out to every active door on the primary's `pinComplexKey` that `needsVouch`; one `HouseholdLocationChange` row per door with `scope: 'spot'` | `POST …/confirm-location { scope: 'spot' }` from the Complexes row. |
| "Unplaced now" vs "shares a spot" | `isPinUnplaced(h)` = `pinSuspect` in `{placeholder, stray, far, unlocated}` and no vouch; `effectivePinSuspect(h)` sends the value while unplaced now **or** while `'complex'` (a complex is a fact every map needs, not a flag a vouch removes); `isComplex(h)` new | Every payload, the queue predicates, the knock stamps, `stackKind` on both clients. |
| Group model (web) | `buildGroups` in [`client/src/lib/pinFixes.js`](../client/src/lib/pinFixes.js) | `PinFixesPage.jsx`. |
| Pin badge wording per cause | [`client/src/lib/pinBadges.js`](../client/src/lib/pinBadges.js) | Map panel, Turf pop-ups, Pin Fixes rows. Mobile mirror with the next OTA. |

## C. Data model

### Household ([`models/Household.js`](../server/src/models/Household.js))

| Field | Change |
|---|---|
| `pinSuspect` | enum `['placeholder', 'stray', 'far', 'unlocated', 'complex']`. Semantics: `far` = outlier against its street/ZIP cohort, fileish, nobody has vouched — **recomputed by every pass** (set when the cohort flags the door, cleared when it no longer does), unlike the sticky spot kinds; `unlocated` = parked at a holding spot, sticky; `complex` = the vendor spot and an exact lookup answer agree this home shares one point with other addresses — **not unplaced**, sticky until a writer moves the door off the spot. `isPinUnplaced` excludes `complex`. |
| `pinComplexKey` | new, string: the ~1.1 m key of the complex's spot, set with `pinSuspect: 'complex'`, `$unset` with it. Lets the Pin Fixes row, the `pinsToFix` rollup (`distinct` per campaign) and the spot-scope vouch find the set without a geo query. |
| `coordSource` | gains `'holding'` (D4) beside `'file'`, `'geocodio'`, `'corrected'`. |
| `pinPlacement.kind` | enum widened to the four flag values: it records the flag the door *left*, and the revert path writes it back into `pinSuspect` ([`placeStackedPins.js:434`](../server/src/services/households/placeStackedPins.js)), as do `updateHouseholdLocation` and the importer. |
| `pinPlacement.answer` | **new**: `'exact' \| 'estimate' \| 'street'`, the answer class the lookup placed with. Kept apart from `kind` so a collision revert can never write an answer class into `pinSuspect`. |
| `pinSetAside` | new sub-schema `{ at: Date, by: ObjectId }`, `default: undefined`, presence tested on `.at` (the `pinPlacement` pattern). |

No new index. `UNPLACED_PIN` becomes `{ isActive: true, pinSuspect: { $type: 'string', $ne: 'complex' }, locationConfirmedAt: null, coordConfidence: { $ne: 'interpolated' }, 'pinSetAside.at': null }` — the `$type` term is what lets the planner match the existing partial index, the `$ne` narrows it; the set-aside term is a residual filter on a small set. The `pinsToFix` rollup adds a third number: `distinct('pinComplexKey')` over unvouched complex members, so a complex counts once.

### ImportJob ([`models/ImportJob.js`](../server/src/models/ImportJob.js))

| Field | Meaning |
|---|---|
| `kind` | += `'pin_lookup'` |
| `offWorldDoors`, `outsideStateDoors` | preview/apply counts of refused file coordinates (D1) |
| `farPinDoors` | the **file-scoped** count of cohort outliers from the preview's `finish()`, re-saved at apply from the same function (so preview equals apply by construction); the pass's campaign-wide `far` marks are logged, not shown |
| `unlocatableDoors` | homes with no house number / ZIP 00000 / blank line 1 — reported, not looked up |
| `pinsPlacedApprox` | the pass's `estimate`/`street` placements (D3); `pinsPlacedExact` keeps its meaning |
| `pinsUnlocated` | homes written to a holding spot by this import (D4) |
| `pinLookupTargets` | `pin_lookup` only: the ids the job was asked to look up |

### CanvassActivity

| Field | Meaning |
|---|---|
| `knockPin` | `'estimated'` when recorded at an unconfirmed interpolated pin (D10); `'complex'` when recorded at a complex member (D14). Absent otherwise. |

### HouseholdLocationChange

| Field | Change |
|---|---|
| `scope` | enum += `'spot'` (the complex vouch, [`HouseholdLocationChange.js:32`](../server/src/models/HouseholdLocationChange.js)). |

### Wire

`pinSuspect` on every payload keeps its "only while unplaced now" rule (`effectivePinSuspect`), now with four
possible strings, plus `'complex'`, which is sent whether or not a lead has vouched. Both clients test it
for truth in the badge chain and for `=== 'placeholder'` / `=== 'stray'` in `stackKind`; a stack of
`unlocated` homes is "every member flagged" → `unplaced`, a lone `far` home gets the badge, and a complex is
"every member flagged" → `unplaced` → the "N homes" marker with per-home Directions — which is exactly the
rendering a complex needs. So existing phones render correctly; only the explanatory sentence lags until the
OTA ("No exact map spot — use Directions" is still true advice at a complex). New row fields on
`/pin-fixes`: `pinPlaced`, `setAside` (boolean), `spotKey`, `complexKey`.

## D. Import pipeline

1. **`mapRow`** ([`csvImporter.js:95-114`](../server/src/services/import/csvImporter.js)): after `parseCoord`, `hasValidCoords` becomes `isUsableFileCoord({ lat, lng, state: get('state') })`. A refused pair sets `coordRefused` and nulls the coordinates; `coordsProvided` stays true. **The validator's `bad_coords` branch** ([`csvImporter.js:305-319`](../server/src/services/import/csvImporter.js)) keeps dropping malformed and (lookups-off) missing coordinates, but lets a `coordRefused` row through to grouping in both modes — otherwise the 253 Fairfield homes would be lost with their voters, which is worse than today. No campaign state is threaded anywhere (`makeRowValidator`/`mapRow` take no campaign, and State is a required column).
2. **`finish()`** ([`csvImporter.js:352-400`](../server/src/services/import/csvImporter.js)): keeps the stack classification; adds `cohortOutliers` over the file's placed homes (one point per home key, as the stack code does) → `farPinDoors`; counts `offWorldDoors`, `outsideStateDoors` from `coordRefused`; counts `unlocatableDoors` (no house number in `addressLine1`, ZIP `00000`, or blank line 1).
3. **`computeImportDiff`** surfaces the four counts under `rowIssues`; `ImportPage.jsx`'s preview renders the §9 "before" sentence (one `SampleList` per non-zero count, same component as the shared-spot warning at [`ImportPage.jsx:255-275`](../client/src/pages/ImportPage.jsx)).
4. **Geocoding** ([`importProcessor.js:164-207`](../server/src/services/import/importProcessor.js)): unchanged call; `needsGeocode` is true for refused rows too, and `evaluate()` now applies the answer classes (D3). **Unplaceable homes are no longer dropped (lookups on):** instead of pushing a row error and removing the household, the processor assigns `holdingSpotFor(zip5, placed)`, `coordSource: 'holding'` and `pinSuspect: 'unlocated'`; the error list keeps one informational entry per home (`geocode_unlocated`, "Kept at a holding spot; see Pin Fixes") so the Errors column still tells the story. The spill path ([`:236-243`](../server/src/services/import/importProcessor.js)) does the same. **Lookups off:** refused rows go to the holding spot without a lookup; rows with no coordinate columns are skipped as `bad_coords` exactly as today.
5. **Write** ([`csvImporter.js:855-907`](../server/src/services/import/csvImporter.js)): `pinSuspect: 'unlocated'` goes into the op **only in the branch that actually lands the holding spot** (`set.location` is the holding spot and `set.coordSource === 'holding'`), never on a path that also has `unset.pinSuspect` (a `$set`/`$unset` of one field in one op is a MongoDB path conflict, and that op would fail inside the unordered `bulkWrite`); `keepLocation` adds `pinSuspect` to the fields it moves to `$setOnInsert`, so a human-corrected or vouched door the new file can't place keeps its pin and gains no flag. A re-imported file that still can't place a parked home repeats its holding spot (`newKey === curKey` → `keepLocation`, the existing rule). The model has no default for `pinSuspect`, so other rows write nothing for it.
6. **The pass** runs as today with `paidScope` = this file's addresses, and now also looks up `far` and `unlocated` candidates (§E).
7. **Tally** ([`importProcessor.js:455-470`](../server/src/services/import/importProcessor.js)) saves the new counts; `importPinLine` renders the §9 "after" sentence.

**Re-import.** A refreshed file that now carries a real coordinate for a holding-spot home replaces it through the existing vendor-change path (`pinPlacement.by: 'file'` rules, [`csvImporter.js:855-907`](../server/src/services/import/csvImporter.js)); the `unlocated` flag is unset by that write like `placeholder` is today. A hand-placed or confirmed home is shielded exactly as today.

## E. The placement pass

Order stays `lease → load → classify → sort → marks → look up → gate → write → outlines → tally`, with:

- **Load** adds `addressLine1` number, `zipCode`, `state`, `coordConfidence` and `pinSetAside.at` to the compact record (a few bytes per door; the 250k-door budget holds).
- **Classify 2–3, new first rule:** a door whose stored flag is `unlocated` keeps it whatever its spot's verdict (today's `else { ps = h.verdict }` at [`:250-253`](../server/src/services/households/placeStackedPins.js) would relabel the whole holding spot `placeholder` on the very import that parked it), and is a candidate when `inScope`.
- **Classify 2b (far):** after the spot classification, `cohortOutliers` runs over every active door that is `fileish` (`'file'`, `null` — not `'holding'`), not `humanOwned`, not `placedByLookup`, and has no spot verdict. Outliers get `ps: 'far'`, `candidate: inScope`; a door whose stored flag is `far` but which the cohort no longer flags gets `ps: null` — `far` is **recomputed**, not sticky, because its evidence is the cohort (today a stored flag on a lone door would otherwise survive for ever through the `verdict === 'none' → ps = stored` rule at `:240`). Holding-spot doors are excluded from the cohorts and from the outlier set. A whole building that is far from its street is flagged unit by unit, and the lookup places its units together (one address, one answer).
- **Candidates** include `far` and `unlocated` doors in `paidScope`. For a `pin_lookup` job, `paidScope` is the targets' addresses and `tallyIds` their ids; the per-job ledger (`pinProbedIds`) and ceiling work as today.
- **Gate:** `lookupPolicy({ cands, answers, doorsOnKey })` — each candidate carries `pinClass`; `answerBeats` decides; collisions as in `stackPolicy`, **except** the complex verdict (D13): exact answers of one vendor spot that collapse onto one key across ≥ 2 bases are returned under `complex`, not `refused`, and never feed `distrust`. Refusal reasons gain `'does not beat the current pin'` and `'an estimate outside its street'`.
- **Write:** `exact` answers as today (`coordConfidence: 'exact'`); `estimate`/`street` answers write `coordConfidence: 'interpolated'`, unset `pinSuspect` — the door moves from `UNPLACED_PIN` to `NEEDS_PIN_FIX` (approximate), where Enter may confirm it (it is no longer an unplaced row). Every placement writes `pinPlacement.answer` with the class and keeps `pinPlacement.kind` for the flag the door left (`far`/`unlocated` included). An estimate that lands on a point another address claims is refused and distrusted exactly as a rooftop would be.
- **Complex write:** members get `pinSuspect: 'complex'`, `pinComplexKey`, `pinPlacement { answer: 'exact', kind: <the flag they carried>, by: 'lookup', stackSize }`; `location` unchanged for a class-2 spot, set to the answer point for a class-0/1 spot (one `bulkWrite` per set, outlines redrawn as for any move). A later pass sees `'complex'` as stored and keeps it (the precedence rule covers it: a stored `complex`, like `unlocated`, is never relabelled by a spot verdict; it is re-judged only if a member is looked up again, which the cache makes free).
- **A door the lookup can't improve** keeps its flag and its spot (a `far` door keeps the vendor pin; an `unlocated` door keeps the holding spot).
- **Tally** counts `pinsPlacedApprox` and `pinsUnlocated` beside the existing three.

`repair:import-pins` keeps its own gate (`adjudicate`, `OVERRULE_TYPES = ['rooftop', 'point']`) and drops
nothing else; its signal 2 now calls `pinCohorts` so the two cannot drift, and its `coordSource: 'file'` load
leaves holding-spot doors alone.

## F. Routes ([`routes/admin/campaignHouseholds.js`](../server/src/routes/admin/campaignHouseholds.js) unless noted)

| Route | Change |
|---|---|
| `GET …/households/pin-fixes` | The projection ([`campaignHouseholds.js:102`](../server/src/routes/admin/campaignHouseholds.js)) adds `pinPlacement` and `pinSetAside`, so rows can carry `pinPlaced` (from `pinWireFields`), `spotKey` (`buildingKeyForCoords`), and `setAside: true` for set-aside rows, which come back in a separate `setAside` array and are excluded from `total`. The two queue queries add `'pinSetAside.at': null`. |
| `POST …/households/pin-lookup` | Body `{ householdIds?: string[], group?: 'shared' \| 'far' \| 'unlocated' }` (one of the two; ids capped at `PIN_FIX_LIST_CAP`). Resolves the targets inside the campaign's `UNPLACED_PIN` set, creates an `ImportJob { kind: 'pin_lookup', pinLookupTargets }`, enqueues it, returns `202 { jobId }`. Refused with `409 LOOKUPS_OFF` when `GEOCODE_ENABLED !== 'true'` or no key, with a plain sentence. Gate: `requireCampaignManager` + `requireActiveCampaign()` like the PATCH. |
| `GET /admin/imports/:id` (existing) | Polled by the page for `phase`, `status`, and the pin tally. |
| `POST …/households/set-aside`, `POST …/households/bring-back` | Body `{ householdIds }`; each through `setAsidePin.js`; return `{ updated }`. |
| `POST …/households/:id/confirm-location` | `scope` gains `'spot'` (D13): the primary must be a complex member; the fan-out is the `pinComplexKey` set; `expectedCoordinates` guards the primary as today; Undo clears the same-timestamp stamps across the set. |
| `GET …/households/pin-fixes` (complexes) | A third list, `complexes: [{ key, lat, lng, count, streets, rows }]` — unvouched complex members grouped by `pinComplexKey` — beside `households` and `setAside`; they are not in `total`, and the response's `complexCount` is what the sidebar adds. |
| `PATCH …/households/:id/location` | Unchanged. Click-to-place sends the same body. |
| [`routes/admin/turfs.js`](../server/src/routes/admin/turfs.js) `/generate`, `/target-preview`, `/attribute-preview`, `/manual-preview`, `/include-apartments`, the `excludedApartmentCount` summary | The first four read `excludeUnplaced` and apply the clause (D9); `/target-preview` also returns `unplacedCount` (the actual delta) for the toggle's label; `GET …/turfs` summary gains `unplacedDoors` for the round; `/include-apartments` and `excludedApartmentCount` add `'pinSetAside.at': null` (D8). |
| [`routes/admin/imports.js`](../server/src/routes/admin/imports.js) undo | `undoFileImport` refuses `kind: 'pin_lookup'` with a plain sentence; the list keeps returning the kind (the super-admin cost review wants it). |
| [`routes/mobile/canvass.js`](../server/src/routes/mobile/canvass.js) knock recording | Stamps `knockPin: 'estimated'` (D10). The per-round action-response wire is untouched: no door state changes. |

Every new route is additive; `npm run audit:mobile-api` is run before deploy (the knock route is mobile-facing).

## G. Web

| File | Change |
|---|---|
| [`client/src/lib/pinFixes.js`](../client/src/lib/pinFixes.js) | `buildGroups(rows)` → `[{ kind, title, count, spots, rows, actions }]` with kinds `shared`, `far`, `unlocated`, `approx`, `setAside`; `buildStreetGroups` unchanged for the list; `popupKeyAction` unchanged. Pure, tested. |
| [`client/src/pages/PinFixesPage.jsx`](../client/src/pages/PinFixesPage.jsx) | The *Fix together* cards above the list; group actions wired to the three new routes and the job poll; *Start checking* = today's popup mode scoped to the group's `rowKeys`; *Place along the street* mode: a rail of the group's rows in house-number order, `placeByClick` armed on the first, neighbours layer from `/admin/households/map` for the viewport (labels: house number), Undo (a second PATCH back to `previousLocation`, which the payload gains for this session only), Skip. Progress header counts clicks as "cleared". |
| [`client/src/lib/useMovePin.js`](../client/src/lib/useMovePin.js) | `placeByClick(target, { onPlaced })`: a crosshair cursor, one map click → `PATCH` with the clicked lng/lat and the target's scope; the "Just this unit / Whole building" question reuses `needsScopeQuestion` ([`pinBadges.js:36`](../client/src/lib/pinBadges.js)). |
| [`client/src/lib/pinBadges.js`](../client/src/lib/pinBadges.js) | Badge stays "No exact map spot"; the explanatory sentence at `:22-24` (today "its coordinate was shared with other addresses" for any flag) reads the cause: shared / far from its street / couldn't be found by address. |
| [`client/src/lib/buildings.js`](../client/src/lib/buildings.js) | `stackKind`: a stack whose members are all `'complex'` is kind `complex` (marker "N homes · a complex", building tone, the homes panel with per-home Move pin and a "Spread on the map" link); a stack whose members are all flagged `far` **and** share one base address stays `building`; everything else as today. |
| [`client/src/lib/pinFixes.js`](../client/src/lib/pinFixes.js) (complexes) | `buildGroups` adds the `complexes` group from the route's third list: one row per spot, label "<street(s)> — a complex of N homes", actions *Looks right — it's a complex* (`confirm-location { scope: 'spot' }`), *Spread on the map* (Place along the street over the spot's rows), *Google Maps*. |
| [`client/src/pages/TurfsPage.jsx`](../client/src/pages/TurfsPage.jsx) | The §8 toggle in the Generate panel (next to *Remove apartments*), sent as `excludeUnplaced`; the after-cut line *"N homes left out (Pin Fixes →)"*. |
| [`client/src/pages/ImportPage.jsx`](../client/src/pages/ImportPage.jsx) + [`client/src/lib/importPins.js`](../client/src/lib/importPins.js) | Preview sentences for the four new counts; `importPinLine` adds *"N placed on the street (check them)"*; the Recent imports row renders a `pin_lookup` job as *"Pin lookup · N homes"* with no **Undo** button (today every completed job gets one, `:1235-1239`). |
| Campaign setup-progress hub | A *Check map pins (N)* step when `pinsToFix > 0`, linking to Pin Fixes, ahead of *Cut books*. |
| [`client/src/lib/mapCounts.js`](../client/src/lib/mapCounts.js), [`excludedDoors.js`](../client/src/lib/excludedDoors.js) | No change: set-aside doors are `excludedFromTurf`, so the admin map's existing Dim/Hide treatment and its counts (which deliberately include excluded doors) apply as they are. |

## H. Mobile

Nothing in this plan requires a phone update. The next OTA carries: the per-cause sentence on the door
screen (`household/[id].jsx:323-328`, today the shared-spot sentence for any flag) and the admin map's stack
chooser, and the `stackKind` refinement above in `mobile/lib/buildings.js` (the mirror). Until then one rare
case reads oddly on phones: a whole real building flagged `far` that the lookup could not settle renders as
"N homes" rather than "N units" — flagged correctly, labelled loosely. A complex renders on today's phones as
"N homes · N done" with per-home Directions, which is the right screen; the OTA only changes its caption to
"a complex" and the door card's sentence. Directions keep going to the address.

## I. Docs and Help Center cascade (at build time)

- [IMPORTS.md](IMPORTS.md): "Coordinate-less files" (homes are kept at a holding spot, not dropped), a new "Coordinates the import refuses", "Homes that share a map spot" (the answer ladder), the known-gaps list (remove the "accepted as-is" item), Part 2 pipeline.
- [MAPS.md](MAPS.md): "Approximate pins, and fixing them", "The Pin Fixes page" (Fix together, Place along the street, Set aside), Part 2 provenance (`pinSuspect` kinds, `pinSetAside`).
- [PASSES_AND_TURF.md](PASSES_AND_TURF.md): the cut toggle. [AUDIT.md](AUDIT.md): the estimated-pin rule (D10). [OPERATIONS.md](OPERATIONS.md): the Nye runbook step 4 and the measurement script (§L).
- Help Center: `pages/page-pin-fixes.md`, `guides/fix-pin-location.md`, `guides/voter-imports.md`, `pages/page-voter-import.md`, `faq/canvasser-dot-off-will-it-flag.md` (D10), and a new FAQ "Why are some homes in the ocean / all on one dot?" via `faq/_INBOX.md`.
- [README.md](README.md): this proposal's row (added now), status updates as it ships.

## J. Privacy

Said out loud, as the repo invariant requires: **this changes *when* customer data goes to an existing
subprocessor, not where it goes.** More addresses reach Geocodio — refused-coordinate homes, far-from-street
homes, and whatever a lead ticks under *Look up by address* — with the same fields as today (line 1 as the
file gave it, city, state, ZIP5; never line 2, never a name). Not a new subprocessor, not a new data category,
not a new export or link: **no DPA §6 notice.** At build time [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
item 28 gets a stamp for (a) the new triggers, including the lead-initiated job; (b) unchanged retention
(the same `GeocodeCache` TTL; the pass's deletion signals); (c) the job's counters hidden from organizations
like the import's (`ORG_HIDDEN_IMPORT_FIELDS`); (d) the new fields — `pinSuspect` values and `pinSetAside`
are data-quality marks on a door, `pinSetAside.by` and `knockPin` are staff-attribution stamps like
`correctedBy`, and a holding spot is a Doorline-derived coordinate that is deliberately *not* the home's
location. No change to the published Privacy Policy, ToS or DPA text.

## K. Tests

- `utils/stateBounds.test.js`: `isUsableFileCoord` — Null Island, ±1 m of it, a swapped CT pair (`41.17, -73.25` vs `-73.25, 41.17`), unknown state fails open, campaign-state fallback.
- `utils/pinCohorts.test.js`: the script's existing cohort cases moved over, plus the ZIP fallback and the "holding-spot doors are excluded" rule.
- `pinTrust.test.js`: `answerClass`, `pinClass`, `answerBeats` truth table (every class × every current kind), the estimate accuracy floor, the estimate-outlier refusal, collisions between an estimate and a rooftop claim; the complex verdict — ≥ 2 bases, one exact key, one vendor spot → `complex`; the same with `estimate` answers → refused; a complex at a class-0 spot moves, at a class-2 spot stays; a member with its own distinct rooftop is placed alone.
- `streetName.test.js` + `streetNameDrift.test.js`: D15's trailing-number rule on both mirrors; "100 Pier A" and "857 Post Rd 146" as the two edges; `buildPacket` street bands unchanged for every existing fixture.
- `holdingSpot.test.js`: mean per ZIP, fallbacks, the nudge off an occupied key.
- `csvImporter.test.js`: a refused coordinate survives the validator in both modes, nulls its coordinates and counts; a malformed one is still `bad_coords`; `unlocatableDoors`; preview counts equal apply counts (the preview == cut precedent); the op builder writes `pinSuspect: 'unlocated'` only with a holding-spot location and never beside `$unset`; a corrected door the file can't place keeps its pin and gains no flag.
- `geocodeService.test.js`: `evaluate()` through the classes — `nearest_rooftop_match` → `'interpolated'`; a wrong-ZIP rooftop refused; `geocodeAccuracy` filled on both paths.
- `importPlaceholderPins.int.test.js` (extended): an off-world home placed by an estimate ends `interpolated`, `pinPlacement.answer 'estimate'`, `pinPlacement.kind 'unlocated'`, in `NEEDS_PIN_FIX`, not `UNPLACED_PIN`; a far home confirmed in place loses the flag; a lone `far` door is cleared when its cohort stops flagging it; an unplaceable home lands on the holding spot flagged `unlocated`, is not dropped, and keeps `unlocated` through the pass that runs on the same import; a collision revert of an estimate writes the flag kind, never the answer class, into `pinSuspect`; a re-run buys nothing.
- `pinFixes.int.test.js` (extended): `pin_lookup` job end to end with the fake provider (no upload on the job); its undo is refused; a complex of 46 shows as one row, `scope: 'spot'` vouches all 46 and Undo clears all 46, `pinsToFix` counts it once; set-aside rows leave the queue and the badge; bring-back; a move clears set-aside; `include-apartments` leaves set-aside doors excluded and `excludedApartmentCount` does not count them; the cut toggle's clause with `excludeRestricted` in the same `$and`, and the label count equals the doors the cut actually leaves out; `pinsToFix` equals list `total`.
- `client/src/lib/pinFixes.test.js`: `buildGroups` from a mixed payload; `pinFixesRender.smoke.test.js` renders the cards.
- `flagDetection` unit: `knockPin 'estimated'` → low with reason; unchanged otherwise; `farKpi` buckets it under forgiven-by-pin (D10). Mobile route int test: both knock writers stamp it when the door is an unconfirmed estimate, neither otherwise.
- `server/test/streetNameDrift.test.js` unchanged (no new mirror).

One `before()` per integration file; no `await import` between `test()` definitions; integration tests run from `server/`.

## L. Rollout

0. **Heroku dashboard → Settings → Config Vars:** read `GEOCODE_ENABLED` and whether `GEOCODIO_API_KEY` is set (the plan's lookups depend on them; with them off, refused coordinates still leave the ocean for the holding spot, and nothing is looked up). Optional: `PIN_INTERP_MIN_ACCURACY` (default 0.8).
1. **Server deploy (web included), outside field hours.** Additive routes and fields; no client-version bump (nothing removed or renamed).
2. **No index build.** The dry run `npm run migrate:build-indexes` is run anyway and must report nothing new.
3. **Measure the estimate floor once** (`npm run pins:measure-estimates -- --campaign=<Fairfield id> --sample=300`, proxied in the root `package.json`): takes 300 of the campaign's `coordSource: 'file'`, 6-decimal, unflagged homes, looks them up through `resolve()` (about $0.30 of new lookups; cached ones free), and prints per answer type the distance between Geocodio's answer and the vendor's rooftop (median, 90th percentile) and the share of estimates that the cohort test would refuse. If the 90th percentile for `range_interpolation` at accuracy ≥ 0.8 is under ~60 m, the default stands; otherwise raise `PIN_INTERP_MIN_ACCURACY` in the dashboard. Writes no household.
4. **Fairfield:** Pin Fixes → *Look up by address* on each card; *Start checking*; *Place along the street*; *Set aside*; then cut with the toggle on.
5. **Phones:** the per-cause wording rides the next OTA (`ota:staging` from the branch, `ota:production` from `main` after device checks). Not a gate.
6. **Docs/Help** ship with the server deploy; the phone wording's Help copy with step 5.

## M. Effort

About 11 working days: import plausibility, cohorts, holding spot and preview counts 2; answer ladder and pass changes 2; `pin_lookup` job, set-aside, cut toggle and routes 1.5; Pin Fixes cards, Place along the street, neighbours layer 2.5; Turf and Import copy, setup-hub step 0.5; D10 0.5; tests, docs, Help, privacy record 2. Reviewed in adversarial rounds before hand-over, per the house rule for plans this size.

## N. Open questions for the owner

1. The Fairfield import's *"Map pins: …"* line (Recent imports), and whether `GEOCODE_ENABLED` is `true` in production (the reference's open question 1, still unreadable from the repo).
2. D10 — the estimated-pin Far downgrade.
3. D4 — keep unplaceable homes from coordinate-less files too (recommended), or only from files that carried bad coordinates.
4. Whether *Look up by address* should be admin-only or also team leads with a campaign grant (recommended: the same people who can move a pin, i.e. both).
5. D3's tightening of coordinate-less imports (a nearest-roof answer flagged Approximate instead of exact; a wrong-ZIP answer parked instead of placed) — recommended, and a behaviour change for every file without coordinates.
6. D14 — the complex Far tolerance (300 m default) — and D15's parser change, which touches walk-packet street bands.

## O. Measurements (reproducible)

Run on the file with Python's `csv` module; one home = (house number, street, city, ZIP5) plus unit where present; one spot = coordinates as written.

- Rows 43,666 · homes 39,045 · street addresses 30,967 · distinct spots 30,781.
- `Latitude == 0 and Longitude == 0`: 279 rows, 253 homes, every one with a house number; DPV `Y` 197, `S` 26, blank 16, `N` 9, `D` 5; MapCode blank for all.
- Spots shared by ≥ 2 **different** street addresses (0,0 excluded): 278 spots, 678 addresses; ≥ 5 addresses: 10 spots; the largest 42 (Foxboro Dr, Norwalk, `41.159, -73.416`).
- Spots shared by units of **one** address (real buildings): 1,518 spots with ≥ 2 homes, 465 with ≥ 5, 110 with ≥ 20; the largest 86 units (880 Pacific St, Stamford).
- Distance from the median point of the home's ZIP5 (ZIPs with ≥ 20 homes): > 2 mi 4,118 · > 3 mi 1,041 · > 5 mi 129 · > 10 mi 57. The > 3 mi set is MapCode 9 in 1,012 cases, 7 in 24, 6 in 2, 8/5/1 one each.
- Distance from the median point of the home's own street (streets with ≥ 4 homes): > 0.5 mi 1,878 · > 1 mi 577 · > 2 mi 219 (a long road inflates these; the cohort rule's 4× spread is what the code uses).
- Source precision (max decimals across lat/lng, per home): 2 → 1 · 3 → 247 · 4 → 21,085 · 5 → 89 · 6 → 9,336 · 7 → 65.
- MapCode: 9 → 42,936 · 7 → 407 · blank → 280 · 8 → 15 · 6 → 12 · 4 → 8 · 3 → 4 · 5 → 3 · 1 → 1. Every MapCode-7 row has an in-range coordinate; samples sit 2–15 miles from their address.
- Unplaceable addresses (no house number, ZIP 00000, "No Know"): 12.
- Lookup cost under this plan at $1 per 1,000: 253 + 678 + ~130 + the 12 that will fail ≈ 1,100 lookups ≈ $1.10; the §L sample ≈ $0.30.

**From the live campaign (owner-supplied, 2026-10-09):**

- Recent imports: *Map pins: 520 placed by address · 28 confirmed at their spot · 826 without an exact spot*; 43,665 voters, 39,044 homes. `GEOCODE_ENABLED` is `true` in production.
- `repair:import-pins --campaign=6ac933c75c0e9dd8e73153b7` (cache-only dry run): 1,276 suspects, 21 confirmable, 19 refuted. The 0,0 spot now holds 76 doors from 70 addresses. Confirmable singles include 28 Summit Pl (43,199 m off), 60 Woodledge Rd (36,337 m), 19 Avon Ln (31,459 m), 1 Greyrock Pl Apt 2145 (7,253 m), 109 Saint Charles Ave (6,433 m). Refusals are dominated by *"geocoder placeholder — N different addresses get this identical spot"* with N of 46 (Rowayton Woods Dr), 39 (Foxboro Dr), 29 (Ledgebrook Dr / Gillies Ln), 19 (Glenrock), 14 (162 New Canaan Ave), 9 (1571 Stratfield Rd), 8 (Thomas Pl; 122 Palmers Hill Rd), 7 (71 Osborne Ave; Clarmore Dr / Prospect Ave; 32 Haviland St), 6 (14 Fairview Ave; 9 Glenwood Ave; 83 Washington St; Fawn Ridge Ln), 5 (Sunrise Hill Ln; 500 West Ave; 3 E Wall St; 1 Broad St) and many pairs of the form "X" / "X <unit>". Because `distrustReason` tests `OVERRULE_TYPES` before the collapse pool ([`repairImportPins.js:388-402`](../server/src/migrations/repairImportPins.js)), every one of those is an exact rooftop/point answer. Three refusals were `nearest_rooftop_match`, one a ZIP mismatch (1B River Rd: matched 06854, address 06850). The printout was truncated at the Foxboro Dr entries.
- `repair:import-pins --campaign=6ac933c75c0e9dd8e73153b7 --geocode` (2026-10-10, paid dry run): *geocoded 472/472 unique addresses*; **196 confirmed, 228 refuted** (the address geocodes to where the pin already is). The confirmed set is 13 at 0,0 plus street-outlier singles with the vendor pin 261 m – 127,715 m from the rooftop (130 Tresser Blvd Apt 812 127,715 m; 237 Crest Ter 118,658 m; 2057 Kings Hwy 100,315 m; 27 Plymouth Ave 99,272 m; 9 Cottontail Rd 98,531 m; 140 Grace St 91,263 m; 102 Keeler Ave 87,656 m; 29 Malibu Rd 86,363 m; …), two placeholder pairs (2 Rowayton Woods Dr 135 m; 29 Brodwood Dr 95 m) and one stray (133 Tresser Blvd Apt 11F 98 m). New refusal kinds: ZIP-boundary (3499 and 3585 Black Rock Tpke, matched 06824, address 06825), and unit-in-house-number pairs (10A / 10 # A Bloomfield Dr; 2A / 2B Bethel St; 16 Woodbury Ave Rear 2 / Rear 3). The collapse counts grew where the paid answers landed on the same points (500 West Ave 13, 515 West Ave 19, 1571 Stratfield Rd 10, 30 Orchard St 4). Internal cost of the run ≈ $0.47.

## P. Review log

**Round 1 (2026-10-09, adversarial, against the code).** Four blockers, all confirmed and folded in:
(1) the validator dropped a refused-coordinate row as `bad_coords` before the lookup could see it — D1 now
changes the validator; (2) the pass relabelled a holding spot `placeholder` on the import that parked it —
the precedence rule in §E; (3) `processImportJob` loads the upload before any kind branch — D5 dispatches
`pin_lookup` above it; (4) Re-include apartments cleared set-aside homes back into cuts — D8 adds the
set-aside term to that route and its count. Wrong claims fixed: the accuracy score never reached the pass
(`geocodeAccuracy` now travels); the import-time `evaluate()` gate was outside the ladder (one classifier,
two gates, with the coordinate-less behaviour change disclosed in Part 1 §3); `pinPlacement.kind` could not
hold an answer class (`pinPlacement.answer`); the admin map does not exclude `excludedFromTurf` doors (Part 1
§7 and §G corrected); `campaignState` plumbing was new and unnecessary (State is required); the repair
script's gate is `adjudicate`, not `repairPolicy`; the pin-fixes projection lacked `pinPlacement`. Risks
taken in: `coordSource: 'holding'` instead of a false `'file'`; `far` recomputed each pass; the toggle's
count as an actual delta; the two knock writers and the KPI bucket for D10; `farPinDoors` defined
file-scoped; Undo hidden on pin-lookup rows; the 30-day negative cache disclosed on the "Couldn't be found"
card; the `stackKind` refinement for a far building and its phone lag.

**Revision 3 (2026-10-09, owner data).** The import line and the dry run (§O) showed the residue is mostly
complexes and bare-unit-number pairs, not street-level answers; added §4 / D13–D15, the `complex` kind, the
spot-scope vouch, the complexes list and count, the Far tolerance question, and rewrote the Fairfield section
with the real numbers and the interim steps. Not yet re-reviewed against the code; the build plan's review
rounds will cover it.

**Revision 4 (2026-10-10, owner data).** The paid dry run (§O): 196 fixable, 228 refuted. Added the
same-city-plus-cohort refinement to `zipMatches` (D3) for ZIP-boundary roads, the unit-in-house-number note
under §4, and the apply step for Fairfield.
