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

- **Left — what to print.** Published books, grouped by round, plus your saved searches. Tick
  as many books as you like; each one becomes its own stapled packet.
- **Middle — the packet.** This is not a mock-up. It is the actual PDF, rebuilt about a
  quarter-second after you change anything, shown exactly as it will print. What you download
  is the same file you are looking at.
- **Right — the design.** Layout, how many lines to write on, and what extras to include. The
  page count updates as you turn each knob, because paper is the cost that matters.

## Two layouts

| | **Survey packet** | **Field list** |
|---|---|---|
| Questions on the page | Every one, with options to circle | None |
| Doors per page | About 2 | About 4 |
| A 200-door book | ~133 pages / 67 sheets | ~50 pages / 25 sheets |
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

Every sheet carries a **header band** — campaign, organisation, book name, round, door count,
who it's assigned to, and a **packet code** like `R2-B07` in a red box. Under that is a coloured
stripe matching the book's colour on the Turf Cutting map, so a dozen packets face-down on a
folding table are sortable at a glance.

Each door has:

- A **numbered red circle** — its place in the walk order. **Solid** means a new door;
  **hollow** means this door carried over from the previous page.
- The **address**, largest thing on the block, then city/state/ZIP and unit.
- **Last round's result** as a small outlined pill, on doors that were already visited.
- **Who lives there** — name, party, age.
- **What happened** — Not home · Refused · Wrong address · Surveyed (or "Spoke with" on the
  field list) · Restricted.
- **Lines to write on.**

Every packet also gets a **cover** with the packet code in large type, the streets it covers,
a tally box, and how many doors were held back. If you print more than one book at once you
also get a **hand-out sheet** at the front: one line per packet, with ruled Out/In cells so a
field director can sign packets out on the table where the packets actually are.

## What prints, and what never does

**Prints:** name, party, age, address, walk-order number, and last round's result.

**Off unless you turn it on:** phone numbers. They're useless at a door and they can't be
recalled once they're on paper.

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

- **Print the morning of.** A packet freezes the moment it's built. Someone who asks to be left
  alone on Thursday is still in a Wednesday printout. Phones re-learn that within minutes;
  paper can't.
- **Give the paper doors their own book, assigned to nobody.** A book with no one assigned to it
  is invisible to every app canvasser, so nobody walks the same street twice.
- **Staple by packet code** and hand them out against the sheet at the front.
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

**`GET /sources`** → `{ cap, hasSurvey, rounds: [{ id, name, roundNumber, status, books: [{ id, name, doorCount, assignedTo }] }], walkLists: [{ id, name, doorCount, voterCount }] }`

Published books on `active`/`draft` rounds only — a book on an archived round is not offered.
`doorCount` is the cut-time count, so the picker labels it as approximate; the live knockable
count is resolved at generation.

**`GET /data?turfIds=a,b | walkListId=x [&includePhone=1]`** → the packet payload:

```js
{
  campaign: { id, name, type },
  organization: { name },
  generatedAt,                       // ISO; stamped on every page
  books: [{
    id, name, code,                  // code = `R{roundNumber}-B{nn}`
    colorIndex, passId, passName, roundNumber, assignedTo,
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
