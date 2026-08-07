# Printable walk packets

Paper packets for volunteers who aren't using the app. An admin picks books, watches the real
PDF build on screen, and downloads it to print.

**The one thing to understand: this is print-only, permanently.** Nothing written on the paper
comes back into Doorline. That is a deliberate product decision, not a missing half — see
[Why nothing comes back](#why-nothing-comes-back) for what it costs and why it is still the
right shape.

- **Part 1 — For everyone** is plain language: what the paper looks like, what the knobs do,
  and what a paper day costs you in the app.
- **Part 2 — Technical reference** is for developers (and Claude): the endpoint contract, the
  ordering rule, the suppression rules, and the renderer's pagination invariant.

Related: [PASSES_AND_TURF.md](PASSES_AND_TURF.md) (cutting the books a packet prints),
[WALKLISTS.md](WALKLISTS.md) (saved searches, the other door source), [SURVEYS.md](SURVEYS.md)
(the questions that appear on the survey layout), [EXPORTS.md](EXPORTS.md) (the CSV/ZIP Export
Center, which this is deliberately *not* part of), [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md)
(the code-verified record of what leaves the system).

---

# Part 1 — For everyone

## Where it lives

**Campaign → Print Packets.** There are also two shortcuts in: the **Print this book on paper**
link inside a book's assignment panel on Turf Cutting, and a **Print packet** action on each
saved search. Both open the studio with that source already selected.

Anyone who can manage the campaign can print — the same people who can already export a walk
list to CSV.

## The screen

Three panes:

- **Left — what to print.** Books grouped **walk list → round → book**, plus your saved
  searches. A campaign runs several walk lists at once and each has its own rounds, so a bare
  "Pass 3" wouldn't say which operation it belongs to. Tick as many books as you like; each one
  becomes its own stapled packet. A running total at the bottom shows packets, doors, and
  sheets, and warns before you cross the door limit rather than after.
- **Middle — two tabs.**
  - **Packet** is not a mock-up. It is the actual PDF, rebuilt about a quarter-second after you
    change anything. What you download is the same file you are looking at.
  - **Map** shows where the books actually are. Click a shape to add or drop it from the print
    run. Only one round is drawn at a time — rounds re-cover the same streets, so stacking them
    would be unreadable and ambiguous to click.
- **Right — the design.** Layout, how many lines to write on, and what extras to include. The
  page count updates as you turn each knob, because paper is the cost that matters.

A book is the **same colour** everywhere — on the Turf Cutting map, in this picker, on the
studio map, and as the stripe on the printed page.

## Two layouts

| | **Survey packet** | **Field list** |
|---|---|---|
| Questions on the page | Every one, with options to circle | None |
| Doors per page | About 2 | About 3 |
| A 200-door book | ~122 pages / 61 sheets | ~68 pages / 34 sheets |
| Use it when | You want the answers back | You just want the doors walked |

**Survey packet** prints the campaign's questions beside each door. Pick-one questions are
**outlined pills you circle**; pick-any questions are **squares you tick**; free-text questions
are **dashed lines you write on**. Conditional questions print as an indented block with the
condition in plain English above it, and the question before the run gets a skip instruction
("→ If not "Definitely" or "Probably", skip to Q5").

**Field list** drops the questions entirely: address, who lives there, what happened, and lines
to write on. It works even if the campaign has no survey set up at all — and if you pick the
survey layout for a campaign without a survey, you get the field list rather than a packet full
of blanks.

## What's on a page

Every sheet carries a **header band** — campaign and organisation on the left, book name,
round and door count on the right — then a coloured stripe matching the book's colour on the
Turf Cutting map, so a dozen packets face-down on a folding table are sortable at a glance,
and a **Walked by / Date** line for whoever is carrying this sheet.

Each door has:

- A **numbered red circle** — its place in the walk order. **Solid** means a new door;
  **hollow** means this door carried over from the previous page.
- The **address**, largest thing on the block, then city/state/ZIP and unit.
- **Last round's result** as a small outlined pill, on doors that were already visited.
- **Who lives there** — name, party, age.
- **What happened** — Not home · Refused · Wrong address · Surveyed (or "Spoke with" on the
  field list) · Restricted.
- **Lines to write on.**

Every packet also gets a **cover**, led by the **race name** — the biggest, boldest thing on
the page, with your organisation under it. Below that sits the book's own identity: its name,
round, and door and resident counts, then the book's colour bar so the cover matches the stripe
on every page behind it. One rule, not two — the book's colour bar is the only line. Then a **Walked by / Date** line, the
streets it covers **in alphabetical order** (you scan this list for a name, so findability beats
ranking by size), a tally box, and how many doors were held back.

On a very large book the street list is **capped to what fits** and ends with "+ N more streets"
— the cover doesn't run onto a second sheet, and every address is listed inside anyway.
If you print more than one book at once you also get a **hand-out sheet** at the front: one line
per packet — book name, doors, page range — with ruled **Walked by / Out / In** cells so a field
director can sign packets out on the table where the packets actually are.

**No canvasser name is ever printed.** A packet goes to whoever picks it up, which is rarely who
the app thinks holds the book — so the carrier writes their own name on the cover. The in-app
assignment still shows in the picker on screen, to help you choose what to print.

## What order the doors are in

Not alphabetical — **street by street**, in the order the book's route reaches each street,
and within a street up one side and back down the other.

The books themselves are cut as a shortest-path route, which is right for the app because the
phone draws that route on a map and walks you along it. On paper there's no map, and a route
that saves a few metres by cutting between two parallel streets reads as nonsense — two houses
on Birch, six on Cedar, back to Birch. So the packet regroups the doors so each street is
walked in one go.

It only does that when it **doesn't make the walk longer**. On a normal grid, grouping is about
7% shorter *and* tidier, so it's used. On cul-de-sacs, a winding road, or a rural route where
the same street name recurs miles apart, grouping would add anywhere from 11% to eighteen times
the distance — so the book's own route is kept instead. That decision is made per book, from
the actual door coordinates.

None of this changes the app: the phone still walks the book's stored route.

**The cover says which order the packet is in** — "street by street" or "follows the walking
route" — because both orders look mis-sorted to anyone expecting A-Z. The route note also
explains that the **city name is postal**: in places where a ZIP boundary cuts through a
neighborhood (San Antonio 33576 against Dade City 33525, for instance), the city column
alternates mid-route while the walk never leaves the area. That's the address label, not the
order being wrong.

## What prints, and what never does

**Prints:** name, party, age, address, walk-order number, and last round's result.

**Off unless you turn it on:** phone numbers. They're useless at a door and they can't be
recalled once they're on paper.

**Skip apartments** drops every door in a multi-unit building — a locked lobby or a call box is
a door a paper volunteer can't work. Off by default; the count that came out is shown on screen
so it never looks like a suppression you didn't ask for. Whether apartments were in the book at
all is still decided when the book is cut; this only removes them from the printout.

**Never, at any setting:**

- **Date of birth.** The packet prints an age instead. Same trade the app makes on a
  canvasser's phone.
- **Anyone marked do-not-contact.** They're dropped when the PDF is built, checked live at that
  moment — never from a book's saved contents. If one person at a three-person door is flagged,
  the door still prints and that person doesn't.
- **Any mark showing someone was removed.** A "withheld" note on paper tells whoever holds it
  that somebody at that address opted out. There's no marker, no gap, no count.

Doors also drop out if everyone there has already voted, the door was excluded from turf, or
it's inactive. The cover tells you the total held back; the reasons show on screen only.

**Restricted doors DO print.** "Restricted" is what happened at a door — a gate, a guard, a
locked lobby — not an instruction to stay away.

## Printing more than about 1,200 doors

The studio refuses, and tells you the real number and roughly how many sheets it would be.
It does **not** print as much as it can and stop. A packet that quietly ran short would send
nobody to the doors it dropped, and because paper reports nothing, no report would ever catch it.
Deselect a few books and print the rest separately.

## Why nothing comes back

A volunteer's marks stay on the paper. Nothing is keyed back in, and there is no screen for
typing it in later. What that costs:

- **The book reads 0 of 41 forever.** Coverage bars, book chips, the map, the timeline, and the
  campaign home all come from recorded knocks. A round walked only on paper renders as entirely
  unknocked.
- **A later round will re-cut every door you walked.** Targeting "doors nobody has touched"
  reads the same records, which still say unknocked.
- **Nobody gets credit.** No canvasser hours, no team numbers, no survey answers.

It does **not** change what you're billed — billing is a flat rate per campaign per month and
doesn't count knocks.

## Practical notes for a paper day

- **Print the morning of.** Every page is stamped with the date it was printed (the date only —
  the hour told nobody anything). A packet freezes the moment it's built. Someone who asks to be left
  alone on Thursday is still in a Wednesday printout. Phones re-learn that within minutes;
  paper can't.
- **Give the paper doors their own book, assigned to nobody.** A book with no one assigned to it
  is invisible to every app canvasser, so nobody walks the same street twice.
- **Staple by book** and hand them out against the sheet at the front — each packet's name and
colour stripe are on every page.
- **Collect the packets at the end of the day and shred them when the race is over.** Paper has
  no sign-out and no remote wipe.
- **A campaign logo isn't possible yet.** "Branded" means the Doorline mark plus your campaign
  and organisation names — there's no place to upload a logo in the product today.
- **Unusual names may print simplified.** The PDF uses Helvetica, which can't render every
  alphabet. The studio counts affected names and warns you before you print.

---

# Part 2 — Technical reference

## Shape

```
client/src/pages/PrintPacketsPage.jsx        the studio (three panes, full-bleed)
  components/packet/SourcePicker.jsx         books by round + saved searches
  components/packet/DesignPanel.jsx          layout + knobs + page/sheet count
  components/packet/PaperPreview.jsx         the real PDF blob in an <iframe>
  lib/packet/packetPdf.js                    the renderer
  lib/packet/packetTheme.js                  ink, type scale, page geometry, the pin
  lib/packet/surveyPrintModel.js             survey -> printable questions + skip logic
  lib/packet/packetSettings.js               defaults, layouts, per-campaign persistence
  lib/pdfText.js                             asciiSafe / countUnprintable / scanUnprintableNames

server/src/routes/admin/packets.js           GET /sources, GET /data
server/src/services/packet/buildPacket.js    assembly: order, suppression, survey, age
server/test/packet.int.test.js               the only coverage this feature has
client/src/lib/packet/packetPdf.test.js      pagination + survey-model invariants
```

Mounted at `/admin/campaigns/:campaignId/packets` in `routes/index.js`, after
`requireEntitlement` and `accessLog` like every other path that returns voter data. Gate is
`requireAuth, orgContext, requireCampaignManager` — the same one on `routes/admin/walklists.js`.

## Endpoints

**`GET /sources`** → `{ cap, hasSurvey, rounds: [{ id, name, roundNumber, status, effortId, effortName, books: [{ id, name, doorCount, colorIndex, assignedTo, boundary, centroid }] }], walkLists: [{ id, name, doorCount, voterCount }] }`

Published books on `active`/`draft` rounds only — a book on an archived round is not offered.
Draft rounds are deliberate: a pass cannot be activated until its books are published, so
"print the night before launch" IS the draft-pass / published-books state. `doorCount` is the
cut-time count, so the picker labels it as approximate; the live knockable count is resolved at
generation. `boundary`/`centroid` are display-only geometry for the studio map — `boundary` is
Polygon **or** MultiPolygon (a book that owns a door surrounded by another book grows pocket
islands), which any bounding-box maths must flatten.

Rounds are sorted **walk list first** (`Effort`, by creation), then by `roundNumber` — sorting
on `roundNumber` alone interleaves parallel walk lists into an unreadable list. `effortName`
falls back to `'Walk list'` when a pass has no effort.

**`GET /data?turfIds=a,b | walkListId=x [&includePhone=1]`** → the packet payload:

```js
{
  campaign: { id, name, type },
  organization: { name },
  generatedAt,                       // ISO; stamped on every page
  books: [{
    id, name, code,                  // code = `R{roundNumber}-B{nn}`
    colorIndex, passId, passName, roundNumber,
    doorCount, voterCount,
    streets: [{ name, count }],      // cover orientation list, derived from addressLine1
    omitted: { total, reasons: { doNotContact, alreadyVoted, excluded, inactive, missing } },
    orderProvenance: 'book' | 'computed',
    survey: { id, name, intro, closing, questions: [...] } | null,
    doors: [{
      id, seq, addressLine1, addressLine2, city, state, zipCode,
      status, lastActionAt,          // PER-ROUND, via getPassStatusMap
      voters: [{ id, name, lastName, firstName, party, gender, age, phone, voted }]
    }]
  }],
  totals: { books, doors, voters, omitted },
  warnings: []
}
```

Over `PACKET_DOOR_CAP` (1200) the route answers **409** `{ error: 'packet-too-large', doorCount,
cap, message }`. The count runs before the voter join, so an over-cap selection is refused
cheaply. **Never truncate** — a short packet is doors nobody knocks and no report can catch it,
because paper produces no coverage.

## The ordering rule

`Turf.householdIds` **is** the walk sequence (`services/turf/walkOrder.js` computes it at cut
time — Hilbert sort seeded into a bounded 2-opt — and persists it in that order).

A `$in` **does not preserve argument order.** `buildPacket.loadDoors` therefore re-sorts the
query result back onto the caller's ordered id list. `routes/admin/turfs.js:1071` has the
original bug — it feeds `turf.householdIds` into an unsorted `$in` and throws the sequence away —
and `packet.int.test.js` stamps `Household.walkOrder` in the *reverse* sequence specifically so
a regression to "just sort by walkOrder" fails.

A **saved search has no persisted order** — it is a set, not a route. `buildFromWalkList` calls
`computeWalkOrder(..., { optimize: true })` for that printout only and does not write it back, so
co-located units (stacked apartments sharing one geocode) can reorder between reprints.
`orderProvenance: 'computed'` and a `warnings` entry say so rather than implying a stable route.

## The print order

`Turf.householdIds` is a **shortest-path route** (`services/turf/walkOrder.js` — Hilbert sort
seeded into a bounded 2-opt). `buildPacket.orderForPrint` may regroup it for paper:

1. `streetGroupedOrder` buckets doors by street, orders the **streets by where the route first
   reaches them** (not alphabetically — that could send a volunteer across the book and back),
   and within a street runs odds ascending then evens descending. A street with only one parity
   falls back to plain ascending, so a one-sided street doesn't zigzag.
2. Both orders are measured with `walkLength` over the door coordinates, and the grouped one is
   used **only if it is not longer**.

Measured on four synthetic shapes (`scratchpad/shapes.mjs`, throwaway):

| shape | book route | street-grouped | chosen |
|---|---:|---:|---|
| 6-street grid | 3.02 km, 12 street changes | 2.82 km, 5 | **grouped** (7% shorter) |
| curving road | 1.14 km | 1.27 km | route |
| 5 cul-de-sacs | 2.21 km | 3.89 km | route |
| rural, repeating names | 8.45 km | 159 km | route |

That last row is why blanket grouping is wrong: `ROUTE 12` recurring every thirty doors makes
"group by street name" teleport a volunteer across the county. Pinned by two integration tests —
a zigzag book must regroup, a rural book must not.

`printOrder` (`'street' | 'route'`) rides on each book in the payload so the reason is visible.
Doors without coordinates, and books under 3 doors, keep the stored order. **`Turf.householdIds`
is never rewritten** — this is a print-time view, so the app is unaffected.

## The cover map

`client/src/lib/packet/packetMapImage.js` fetches one basemap image per packet from Mapbox's
Static Images API and `packetPdf.drawCoverMap` draws the walk over it — the route line, a dot
per door, and **A**/**B** markers on the first and last.

**The request carries a centre, a zoom and a size. Nothing else.** Mapbox's static API accepts
an overlay polyline, and using it would have put every household coordinate in a third party's
URL and access log. Instead the basemap comes back plain and the route is projected locally in
PDF vector ops — which also prints sharper than a rasterised line and keeps the URL short
enough that a 1,200-door book can't hit the API's length limit.

Door coordinates reach the browser only when the map is on: `GET /packets/data?includeGeo=1`
adds `lng`/`lat` per door and the default payload is unchanged. See the 2026-08-07 amendment in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md).

Details that matter:

- **The projection must match the image.** Mapbox GL styles use 512px tiles, so the world is
  `512 · 2^zoom` — `fitView`/`makeProjector` use that constant, and the tests pin it by asserting
  the origin lands dead centre at zoom 0. Get it wrong and the route floats off the streets.
- **The line is order, not directions.** It runs door to door in a straight line; we hold the
  doors, not a routing engine. The caption says so, because a line over a street map looks like
  turn-by-turn guidance and isn't.
- **It fails open, always.** No token, no geometry, no network, no DOM → `fetchCoverMap` returns
  `null` and the packet prints without it. A test asserts the page count is identical either way.
- **Fetches are memoised** per book and image size, so turning a knob re-renders the PDF without
  re-hitting Mapbox; a failure is cached too, so a dead token isn't retried on every keystroke.
- **Attribution and the logo stay on** — Mapbox's terms require them on a static image.
- The PNG Mapbox returns is re-encoded to JPEG (quality 0.82) before embedding; a print run
  carries one of these per book.

## Street bands and the unit suffix

Each contiguous run of one street gets a band naming it and the doors it covers. Two rules make
that honest:

- The range is the **contiguous run**, not the street's first-to-last appearance in the book. On
  a route-ordered book a street is walked in several chunks, and the old first..last range
  printed `Corbin Ridge St · doors 12-28` over a run that ended at 16. A street the route
  returns to later is marked `· back later`.
- `streetOf` strips the **unit suffix** (`Apt`, `Unit`, `Ste`, `Bldg`, `Lot`, `#`…) before
  grouping. Without that a forty-door building listed nineteen separate
  "Bay Harbor Blvd Apt NNN" entries on the cover and banded a fresh street on every single door.
  The same helper backs `isApartment`, which is what **Skip apartments** filters on.

## The colour rule

`colorIndex` is assigned **by the server**, once, in `GET /sources` and again in
`buildPacket.buildFromBooks`: a book's colour is its position **within its own pass, in
creation order** — identical to `TurfsPage`'s `colorByTurf`. Every surface reads that number
instead of using its own array position.

This matters because three surfaces previously each had their own rule — the picker used its
index within a name-sorted round, the map its index within a `createdAt`-sorted pass, and the
paper its index within the *selection in click order*. They agreed only by luck, and diverged
the moment a book was renamed or a partial selection was printed. `packet.int.test.js` pins it:
printing the second book **alone** must still colour it `1`.

The ranking query deliberately includes **draft** siblings (`status: { $ne: 'archived' }`), or
every colour would shift the instant a draft book was accepted. And `packetTheme.BOOK_COLORS` is
now the same twelve hues in the same order as `TurfsPage.jsx:34` — it previously was not, despite
a comment claiming otherwise, so the on-screen swatch and the printed stripe were different
colours even when the index agreed.

## Suppression

- `KNOCKABLE_DOOR_FILTER` is spread into the door query — never re-implemented in JS. The
  omission *reasons* come from a second read over the ids that didn't survive, so the predicate
  has exactly one definition and the reasons are descriptive only.
- Do-not-contact is joined **live and per voter** (`'doNotContact.flagged': { $ne: true }`), not
  from `Household.fullyDnc` alone — that flag only fires when *every* resident is flagged
  (`services/dnc/recomputeFullyDnc.js`), so a partially-flagged door would otherwise leak the
  flagged person. Same reasoning as `routes/admin/walklists.js:276`.
- **No withheld marker, ever.** `services/export/exportScope.js:14` forbids it for CSVs; on
  paper it is strictly worse, because a volunteer standing at the door can see the gap.
- `restricted` is a `Household.status` value, not a suppression — restricted doors print.

## Age, never DOB

`ageOf()` in `buildPacket.js` derives an integer and `dateOfBirth` is dropped before the payload
is returned — the server-side twin of `routes/mobile/bootstrap.js`'s `toWireVoter`.
`packet.int.test.js` asserts the raw date string appears **nowhere** in `JSON.stringify(payload)`,
the same assertion shape as `voterPrivacy.int.test.js:155`.

## Survey resolution

Per book, because two books can sit on passes belonging to different efforts:
`pass.effortId → Effort.surveyTemplateId`, falling back to `Campaign.surveyTemplateId`. A
`lit_drop` campaign resolves to `null` (the model nulls `surveyTemplateId` for that type), so it
gets the field layout. Retired questions and retired options are filtered out; `otherOption` and
`refusalOption` are flags on the question, not rows in `options`, so `surveyPrintModel` has to
materialise them or the paper offers fewer choices than the app.

Conditional logic is printable **because** `routes/admin/surveys.js:157` guarantees every
`visibleIf` rule references a strictly earlier non-retired question. That makes the graph a DAG
in authoring order, so the form is one top-to-bottom column and a skip instruction can only ever
point forward. A skip line is emitted only for a run of **2+** consecutive questions sharing one
condition, and only when the question directly above the run is the one the rule references —
otherwise "if not" is ambiguous about which answer it means.

## The renderer

Client-side jsPDF, lazily imported so it stays out of the initial bundle. **Not** a 9th Export
Center type: `contentKind` there is closed to `csv|zip`, builders run on the worker dyno where a
browser library doesn't exist, artifacts land in GridFS behind a 7-day TTL, and the UI is
queue → poll → download with no preview at all.

Two invariants:

1. **Measure and paint are one code path.** Every draw helper takes a `paint` flag and returns
   the height it consumed. Two implementations would drift, and the symptom — text sliding under
   the footer — surfaces on page 40 of a print run.
2. **Nothing is taller than a page.** A door is decomposed into question-sized segments, so the
   packer never meets a block it cannot place. `lib/reportPdf.js`'s `ensure()` is deliberately
   **not** reused: it adds a page and then draws the block anyway, silently running long blocks
   off the bottom.

**The Walked by / Date line is on EVERY page, not just the cover.** One book routinely gets
torn in half and handed to two volunteers, and a cover-only line leaves half the packet
unattributable. It is drawn inside the 54pt header band (deepest ink at `y+52`), so `BODY_TOP`
and the usable height are untouched and putting it on every page costs no extra paper —
`packetPdf.test.js` pins the page count for a fixed payload to catch anyone moving it into the
body.

**The in-app assignee is deliberately not printed.** `TurfAssignment` is not read by
`buildPacket.js` at all and `assignedTo` is absent from the packet payload — the cover carries a
**Walked by** write-in instead, and the hand-out sheet a matching ruled column. Printing the app's
assignee would be wrong more often than right on a paper day, and wrong in a way nobody can fix
with a pen. `GET /sources` still returns `assignedTo` per book, because the on-screen picker uses
it to show what a book is currently attached to.

A page break inside a door reprints the address with `(cont.)` and a **hollow** sequence badge;
a break inside one person's block reprints their name with `(cont.)` so answers below are never
attributed to whoever lands at the top of the next page. Page numbers are **per book** ("Book C ·
Page 7 of 12") and written in a second pass over `doc.setPage()`; the hand-out sheet carries
absolute ranges so a director can reprint by range.

Other renderer traps:

- `doc.path()` emits geometry only and **ignores its `style` argument** — the Doorline pin needs
  an explicit `doc.internal.write('f')` after it or nothing renders.
- Always `setLineDashPattern([], 0)` after a dashed write-in rule; a pattern left set leaks into
  every later stroke on the page.
- `PAGE` is frozen, so derived values are spelled out in the literal — a late `PAGE.X = …` throws.
- Do **not** copy `reportPdf.js`'s `ACCENT_HEX.brand`; it is `#4f46e5` (indigo), predating the red
  brand. The neutrals in that block are correct and are mirrored in `packetTheme.js`.

## The map

`client/src/components/packet/PacketMap.jsx` — self-contained, modelled on `AnswerMiniMap.jsx`,
because there is **no** reusable "draw these turfs" helper (TurfsPage inlines its own layer
setup; `lib/mapRender.js` is household-pin machinery only). It reuses the boundaries already on
`/sources` rather than calling `GET /admin/campaigns/:id/turfs`, which has no projection and
would ship every book's full `householdIds` array.

Traps it has to respect, all of them learned by TurfsPage first:

- A basemap `setStyle()` **wipes every custom source and layer** — they are re-registered on
  `style.load`, guarded by `if (map.getSource(…)) return`, and a pending handler is removed in
  the effect cleanup or two styles both re-register.
- The click handler is bound **once** and reads the toggle through a ref; a handler closing over
  `selection` goes stale after the first toggle.
- **A click on bare map does not clear the selection** — an accidental blank click wiping a
  built-up print run is a failure this repo already had once.
- Bounding boxes must flatten `MultiPolygon` one extra level or the fit lands on `NaN`.
- The camera fits **once per round**, keyed on the book-id signature, so toggling a book never
  yanks the view.
- The map mounts only while its tab is open — a Mapbox canvas built inside a `display:none`
  container comes up zero-sized. The preview stays mounted and merely hidden, so switching back
  doesn't re-render the PDF.
- Basemap dark ≠ app dark. Label ink flips on `useMapStyle().dark`, not `useTheme()` — the map
  can be light while the console is dark, by design.
- `mapboxgl` comes from `lib/mapboxInit.js`, never `'mapbox-gl'` directly: the wrapper carries
  the usage-beacon mute and the subprocessor-disclosure ruling.

## Fonts

jsPDF's built-in faces are WinAnsi/cp1252 only, and `@fontsource-variable/inter` ships woff2,
which jsPDF cannot parse — so the document is **Helvetica**, not the console's Inter. `pdfText.js`
folds typographic characters to printable equivalents (`’ → '`, `— → -`) and counts what cannot
be folded; `scanUnprintableNames` surfaces the count in the design panel. Without the fold,
`O’Brien` renders as `OBrien` with no error anywhere.

## Measured cost

Real `jsPDF` renders, US Letter, 4-question survey, avg 1.67 voters/door, `compress: true`:

| Doors | Survey layout | Field layout | Field size | Render |
|---:|---:|---:|---:|---:|
| 50 | 50 pg | 33 pg | 115 KB | 56 ms |
| 200 | 133 pg | 45–50 pg | 77 KB | 38 ms |
| 500 | 333 pg | 111 pg | — | 401 ms |
| 1200 (cap) | 800 pg | — | 2.7 MB | 955 ms |

Under a second at the cap, so no worker and no progress bar. `compress: true` is a ~5× size win
(2.3 MB → 453 KB at 200 doors) for ~10% more time. Field-list page counts vary with the note-line
setting: 2 lines → 45 pg, 4 lines (the default) → 50 pg.

## Audit and privacy

`addAuditSubjects(res, 'voter', …)` tags the voters actually printed, post-suppression. That
writes an `AccessLog` row **only** when Doorline staff are reaching in under a support grant; a
customer admin reading their own data logs nothing, by design (`middleware/accessLog.js`).

The packet is **not a new privacy exposure**: same gate as `voters-filtered` (which already emits
raw DOB, cellPhone and household coordinates), a strictly narrower field set than
`walklists.js:294`, rendered in the admin's own browser with no artifact stored and no third party
involved — so no DPA §6 subprocessor event. Recorded as a negative stamp in
[PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md). The one honest asymmetry is that paper has no
sign-out, no TTL and no purge — the same position an already-downloaded CSV is in today.
