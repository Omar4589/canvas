# Passes, books & turf-cutting

How a campaign is broken into rounds (**passes**) and walkable territories (**books**), how those
books are generated and re-generated (**turf-cutting** / **recutting**), and how all of this feeds
the numbers.

- **Part 1 — For everyone** is plain language: the pieces, the rules, and the common "I uploaded
  new voters — now what?" scenario.
- **Part 2 — Technical reference** is for developers (and Claude): models, the generation pipeline,
  the lifecycle routes, and where passes do (and don't) affect aggregation.

Related: [EFFORTS.md](EFFORTS.md) (the layer above — see banner), [METRICS.md](METRICS.md) (a pass is
the billing unit), [TURF_RUNBOOK.md](../TURF_RUNBOOK.md) (operational runbook),
[SURVEYS.md](SURVEYS.md) (one survey per voter per pass), [VOTERS.md](VOTERS.md),
[MAPS.md](MAPS.md) (how books/turf show on the map), [WALK_PACKETS.md](WALK_PACKETS.md) (printing a
book on paper for volunteers who aren't using the app).

> **Updated — a "pass" lives inside a walk list.** The user-facing term is **Pass** again (Pass 1,
> Pass 2, …; the `Pass` model stores the counter as `roundNumber`). A campaign is split into **walk
> lists** (efforts — areas or teams), and each pass belongs to **one walk list** (still the
> cut/assign/billing unit) — you manage passes *inside* the walk list, not on a top-level page. For
> the pass **lifecycle, numbering, auto Pass 1, and where they're managed**, see the dedicated
> **[PASSES.md](PASSES.md)**. The **turf-cutting** mechanics below — generating books, accept/discard,
> move/merge/split, supplemental books — are unchanged and apply **per pass**. What also changed:
> (1) a campaign can have **several active passes at once** (one per active walk list), not one;
> (2) a pass's door-set comes from its **walk list's owned doors** (`Household.effortId`);
> (3) knock attribution is **deterministic by door → book → walk list**, not the `activatedAt`
> time-window; (4) new-address imports go to **Intake** until assigned to a walk list. See
> [EFFORTS.md](EFFORTS.md) and [IMPORTS.md](IMPORTS.md).

---

# Part 1 — For everyone

## The pieces: campaign → walk list → pass → book → households

```
Campaign
  └─ Walk list       a parallel operation (an area or a team) — owns its own disjoint set of doors
       └─ Pass       one sweep of that walk list's doors (Pass 1, Pass 2, …)
            └─ Book  a walkable, ordered slice of households (a canvasser's turf)
                 └─ Households → Voters
```

A **campaign** is the whole effort, split into one or more **walk lists** — each owning its own
doors, with no door ever in two lists (a new address waits in **Intake** until assigned to one —
see [EFFORTS.md](EFFORTS.md)). Inside each walk list you run one or more **passes**. Each pass is
cut into **books**, and each book is an ordered list of households for one person to walk.

## What a pass is

A **pass** is a single planned sweep of one **walk list** — Pass 1, Pass 2, and so on. It has a
pass number (counted **per walk list**, so every walk list has its own Pass 1), a name, and a
status that only moves **one way**:

**draft → active → archived.** An archived pass is never reopened — you make a new pass instead.

A pass's doors are its **walk list's owned doors** — the full set by default, or, on a follow-up
round, just the doors that still need work via the optional **Target doors** filter (knock status
and/or survey answers — see *Targeted follow-up rounds* below).

## What a book is

A **book** (called a "turf" in the code) is a walkable, ordered set of households **inside one
pass**. It's what a canvasser is actually assigned. A book belongs to exactly one pass; the same
geography in Round 2 is a *new* book in the Round-2 pass, not the same object reused.

## Cutting turf (making books)

**Turf-cutting** is generating the books for a pass. Three ways:

- **Geometric** — the default; groups households into **compact, walkable** books by location. The
  door count you set is an **approximate target**, not a hard cap — books flex in size so a house is
  never stranded far from the rest of its book just to hit an exact number (i.e. no driving across the
  area for one or two stray doors). Compactness is prioritized over even book sizes. A **Tight /
  Balanced / Compact** control sets how much book sizes may flex (Compact by default — the least
  driving). See Part 2 §B.1.
- **Attribute** — one book per precinct / county / city / ZIP / district, etc. Before you cut, the
  page **previews each group's door count** so you can set a smart cap (oversized groups are split).
  The grouping values are the household's denormalized district/precinct/ZIP/county fields, derived
  from the imported **voters'** data.
- **Manual** — draw one or more areas on the map; **each area becomes a book**. As you draw, the panel
  shows the **houses + voters inside each area** (live), you can remove an area (✕) or **Clear all**,
  and an optional **"split areas over N doors"** geometrically sub-cuts a big area into ~N-door
  walkable books instead of one giant book. **Overlapping areas: the first area drawn wins** — a house
  only ever lands in one book, and the live counts reflect that while you draw (a second area that
  overlaps the first shows fewer houses).

Cuts only include **knockable** doors — already-voted (fully-voted) doors are skipped, and you can also
**remove apartments** (any building with **N+ units at one address**, default 4 — but note it keys on
*coordinate stacking*, so a vendor placeholder pin holding collapsed single-family homes from many
streets reads as a "building" and gets excluded too; the import preview and the admin map's door panel
both call these out, and `repair:import-pins` fixes them — see [IMPORTS.md](IMPORTS.md) →
*Fixing pins that came in wrong*): those doors are
persistently excluded from cutting, book door counts, printed packets, and the canvasser list — exactly
like already-voted doors — until you re-include them. **Not from the admin map:** that map is the record
of what exists and what was worked, so an excluded door stays visible there, is counted in its own
"doors excluded from books" chip, and can be dimmed or hidden with a per-viewer toggle
(see [MAPS.md](MAPS.md) §I). Before cutting, the panel shows the **knockable door count** (and a
rough book estimate), so you know what you're cutting (see [EARLY_VOTING.md](EARLY_VOTING.md) for the
shared exclusion mechanism).

**Excluding restricted-access homes from a later round (admin-reviewed).** When a canvasser marks a home
**Restricted access** in the field (gated / locked / inaccessible — see [METRICS.md](METRICS.md)) — or an
admin marks it from the desk, a whole book or a single home (both below) — the home stays in the
campaign, fully counted and visible. But when you cut the **next** round, you usually
don't want to send someone back to a door nobody could reach. So the Turf Cutting page shows an
**"Exclude N restricted-access homes"** toggle whenever any exist (**on by default**). Leaving it on
skips those homes from **that round's books only** — it's **non-destructive** (the homes stay in the
campaign, still counted and shown on the coverage bar as their own slate segment) and **overridable**
(re-disposition a door in the field and it re-enters scope on the next cut). This is **opt-in per cut**,
never automatic: turn it off to include them (e.g. if access has since opened up). It's the second-pass
counterpart to the field marker — the field records "can't get in," the admin decides per round whether
to keep trying.

**Excluding no-soliciting homes from a later round.** The exact same mechanism, for the pink
**No soliciting** disposition: a separate **"Exclude N no-soliciting homes"** toggle (also on by
default) appears whenever any exist. It is independent of the restricted toggle — tick either, both,
or neither — and the two are folded into one `status: { $nin: [...] }` on the cut, so ticking both
really does drop both sets.

The difference worth knowing: a restricted home was never *reached*, while a no-soliciting home was
knocked and billed like any other door. Excluding it is purely about not sending a volunteer back to a
door the campaign has decided to honor — it changes nothing about how the door was counted. See
[METRICS.md](METRICS.md).

Excluding them from the cut doesn't remove them from the **cut map**, though — like every door a cut leaves
out of a book (already-worked doors a targeted cut skipped, restricted homes, voters added since the cut),
they stay visible as gray *loose* dots, which pad the density so a round looks bigger than the walk. A single
**Not in a book (N)** checkbox in the map's Layers box hides them all — every loose door, restricted ones
included. It is **hidden by default** (so the map opens showing only the cut's booked doors) and appears only
when the cut left doors loose. "In a book" is judged against **this round's own books**, not `Household.turfId`
being set — `turfId` is a single global pointer that only the doors a cut *selects* get re-pointed to, so a
door a targeted round skipped still carries an earlier round's book id yet is loose here. (Before any cut
there are no books, so nothing hides — the pre-cut map still shows the full universe gray.) Doors that are *inside* a book — including one a canvasser marked restricted
mid-round — keep their book color and stay on the map, so an active-round audit never loses worked doors.

**Marking a book restricted (bulk).** When part or all of a book is inaccessible (a gated community),
select it on the Turf Cutting page, or on mobile open its **⋯** menu (the Books map's promoted-book
sheet, or the book detail screen reached from List view) — **Mark restricted…** —
`POST .../turfs/restrict-bulk { turfIds[], scope? }` creates a real restricted activity row per
targeted door (`via: 'bulk'`, the acting admin's user, the house's own coordinates, the book's round),
so canvassers see the slate doors **immediately** in their round view and the excludeRestricted toggle
above catches them on the next cut.

**Two scopes, because a book is often only *partly* inaccessible.** If the crew already worked some of
the book, you usually don't want to relabel the doors they reached:

- **`unknocked`** — mark **only the doors nobody has touched this round**. Every door the crew reached
  (not-home / refused / wrong-address) keeps its status and its knock. This is the default in the UI
  **whenever there are any reached doors — on web and on every mobile entry point** (the three mobile
  **book-level** entry points share one scope-aware prompt flow in `mobile/lib/restrictBooks.js` — the
  two single-home ones below use that module's plain one-confirm door prompts; for book-level, the
  reached-inclusive scope always takes a second explicit confirm there, mobile's analogue of web's
  type-"restrict" gate, and every mobile request sends its scope explicitly rather than relying on the
  server default). It's the case where only the untouched remainder of a book is gated.
- **`incomplete`** (the request default when `scope` is omitted) — mark **every door not yet done**,
  including the reached-but-unfinished ones. Use when the whole book is inaccessible. On a fully
  untouched book the two scopes are identical.

Both scopes always **skip doors completed this round** (they keep their result) and **already-restricted
doors** (idempotent); field rows are never deleted — a canvasser can still re-disposition any door,
which supersedes the bulk mark. The response's `skipped` breakdown carries `{ completed,
alreadyRestricted, ineligible, reached }` — `reached` counts the doors left alone under `unknocked`.
**Unmark restricted (N)** (`POST .../turfs/unrestrict-bulk`) deletes only the desk-created rows and
recomputes statuses; field marks survive. Since single-home marks (next section) are the same row, a
book's Unmark removes **every desk mark on the doors currently in that book for that round** — book-level
or single-home, whenever it was made (pre-acceptance, after a move, after a snapshot restore) — and
**N counts rows**, so the prompt, the toast and the Books list all print the same number. Available on
web for the whole selection, and on mobile from the same menus as Mark plus an **Unmark (N)** button on
the multi-select bar (so several books' desk marks clear in one action there too). Desk rows — bulk or
single-home — are excluded from per-canvasser stats and the GPS audit — see [METRICS.md](METRICS.md).

**Marking a single home restricted (one door, from the desk).** One locked gate, one building nobody
can get into — you don't have to mark the whole book. Click the house on the Turf Cutting map and its
popup offers **Mark restricted…** (a building's popup offers **Mark building restricted…** for every
unit at that pin, and **Unmark restricted (N restricted · desk marks only)** — N counts the units
restricted this round, desk or field; the action removes only the desk rows); on the web **Map** page
the door panel has a **Restricted access** section with the same action; and on the phone the admin
**Map** tab's door sheet has a **Mark restricted** row above **Move pin**, and the house pop-up inside a
book (Books → List → book → tap a house) has the same. It is the **same mark** as the book-level one —
`POST .../turfs/restrict-doors { householdIds[], passId? }` writes the same restricted activity row
(`via: 'bulk'`, the acting admin, the house's own pin, the round it belongs to), so everything above
about desk marks applies: canvassers see the door slate in their round view immediately, it stays out
of every rate and knock count, it never bills, and the **Exclude N restricted-access homes** toggle
picks it up on the next cut. One plain confirm, **no note or reason field**. Together the two are the
campaign's **desk marks — a whole book or a single home.**

- **Allowed any time the house is on the page** — in a draft book, an accepted book, or as a loose dot no
  book holds (the book-level action refuses drafts; the single-home one doesn't). Before you accept a cut
  it shapes the cut; after, canvassers see slate. Loose dots are hidden once a cut exists — tick **Not in
  a book** under **Layers** first.
- **Which round it lands on.** The Turf Cutting page always marks the round you have selected. The Map
  page and the mobile admin map have no selected round, so the server picks: the door's walk list's
  **active** round, else its **single** draft round, else the web Map page asks you to pick one (the
  phone's map has no picker — open the door from inside its book instead, which always marks that book's
  round). So on a walk list with an active Round 1 and a draft Round 2 being cut, a Map-page mark lands on
  **Round 1** — mark from the Turf Cutting page to aim at the draft. An **archived round is refused**
  (phones never receive archived-round books, so the mark would flip the door's color without any
  canvasser seeing it). A door still in **Intake** (no walk list) can't be marked at all — rounds belong
  to walk lists, so no round could own the mark; assign the door to a walk list first.
- **Skips, same as a book:** a door **completed this round** (surveyed / lit dropped) keeps its result and
  isn't marked; a door **already restricted** is left alone; a **reached** door (not home / refused / no
  soliciting / wrong address) *is* marked — this round's result becomes Restricted and the canvasser's
  knock stays counted.
- **A desk mark is a note, not a lock.** It predicts that nobody can get in; it does not stop anyone.
  The door is still cut into books, still sent to phones, and every outcome button on it still works —
  a canvasser who gets through the gate records normally and **their result supersedes the mark**
  (pinned server-side by `bulkRestrict.int.test.js` — *"field re-disposition overrides a bulk mark"*).
  That is deliberate: the person at the door knows more than the map. What the canvasser now sees is a
  **Marked restricted by the office** card above the outcome buttons — informational, nothing disabled,
  driven by the additive per-round `restrictedFrom` field (`'desk' | 'field' | null`).
- **Superseded marks.** The canvasser's write does **not** delete the admin's row (the server's
  `deleteMany` is scoped to the recording canvasser's own `userId`), so the row stays on file, keeps
  counting in `Unmark restricted (N)`, in `activityCount` and in exports. Every per-door surface now
  reports that state — *Desk mark by … — no longer in effect* plus **Remove desk mark** — and the book
  says how many of its marks the crew has worked past. Removing a superseded mark changes nothing about
  the door (the field result already governs); it clears the record. **This is the signal worth acting
  on:** one reachable home in a gated block usually means the rest are reachable too.
- **Unmark removes desk marks only.** Open the same popup: a desk-marked door reads *Marked from the
  desk by … · date* and offers **Unmark restricted** (`POST .../turfs/unrestrict-doors`); a door a
  canvasser marked restricted in the field reads *Recorded at the door by …* and offers **no desk
  action** — only a canvasser re-knocking it changes it. A book's **Unmark restricted (N)** also removes
  single-home marks on its current doors (above); since 2026-08-24 that button is shown on a **draft**
  book too — only *marking* a book is published-only (`restrict-bulk` 409s on a draft), and hiding the
  undo with it left a draft cut's single-home marks reachable from the door pop-up alone. One caveat
  remains: a mark on a **loose** dot has only the per-door undo (no book to count it under).
- **Door status switches on.** The first desk mark on a draft cut gives the round progress, so the map
  flips from book colors to status colors — uncheck **Door status** under **Layers** to go back.
- **Side effects worth knowing.** A desk mark is a row on the round, so the round is no longer
  "untouched": the **Discard** dialog counts it among its "N knocks already recorded" and asks for the
  typed confirm; a draft round holding a desk mark **blocks deleting its walk list** until you unmark
  (archiving still works — [EFFORTS.md](EFFORTS.md)); and the round-archive guard's knock count includes
  it. Re-cutting, discarding drafts, or deleting a draft book does **not** undo a single-home mark — the
  mark follows the **door** and counts under whatever book the door lands in next. Deleting a draft
  **round** does remove that round's desk marks (there would be no book left to undo them from).

**Marking many homes at once — "Select doors" on the map.** A fence line, a cul-de-sac behind one gate, a
block the contractors closed off: forty homes shouldn't mean forty popups, and a whole book is the wrong
size. Both **web** maps — the Turf Cutting page and the **Map** page — carry a **Select doors** pill in the
map's top-left controls, beside the fullscreen button (and it survives fullscreen). It expands into a small
panel with a **Pan | Lasso** toggle, a **Done** button and the gestures; while the mode is on the map
belongs to the doors — no popup or detail panel opens, and on Turf Cutting book selection and manual area
drawing stand down so nothing fights the drag.

- **Picking.** **Drag a lasso** around the homes you mean — draw another shape somewhere else and it adds
  to the first, so three streets take three drags. **Click a dot** to toggle one home; **click a building**
  and every unit on that pin toggles together, the same rule its popup already uses. **⌥-drag** (Option /
  Alt) takes the doors inside the shape back out. **Hold Space** — or pick **Pan** — to move the map without
  leaving the mode. **Esc** cancels a drag you're in the middle of; press it again, or hit **Done**, to
  leave (which clears the selection).
- **You can only pick what the map is drawing.** Whatever your filters, the **Layers** toggles and the
  book-status chips are already hiding is not selectable — if you can't see it you can't catch it, and a
  lasso over it takes nothing. Turn the **Houses** layer off on Turf Cutting and nothing is selectable at
  all; the bar says so. Doors a **target-filter preview** merely *fades* are still drawn, so they are still
  caught — the bar counts them and tells you.
- **Buildings come as a whole.** Units at one pin share a rounded location, but the icon is drawn at the
  first unit's exact spot, so a lasso edge can slice a stack. If the shape catches any unit at a pin it
  takes them all — you meant the building.
- **1,000 doors per action, and an over-size lasso is refused whole.** Nothing is silently trimmed to "the
  first thousand": the bar tells you how many that shape would have made it, and the selection stays as it
  was. Zoom in and take a smaller stretch, or act on what you have and lasso the rest after.
- **The bar along the bottom does the counting.** "**1,284 doors selected**" over a breakdown — how many
  **will be marked**, how many are **already restricted**, how many were **completed this round**, how many
  **can't be marked** — with an **ⓘ** that spells each number out. On the map every selected door gets a
  ring: **blue** where the action would mark it, **slate** where it would be skipped.
- **It always asks before it writes.** Up to 25 doors the confirm is a second tap in the bar itself; above
  that it's the same dialog the whole-book action uses, **typed `restrict`** gate included (the typing is
  for **marking**; Unmark asks in the same dialog without it). Whatever the
  size, if the selection holds doors your crew already **reached** you get the whole-book flow's **scope
  choice** — *Only unknocked doors* (the default, which leaves every not-home and refusal exactly as it is)
  or *Every door not yet done* — because a lasso must never quietly relabel the crew's work. The counts and
  the door list are **frozen when the confirm opens**, so a live refresh can't move the number under a
  typed gate.
- **Doors that can't be marked are dropped before the request, not silently failed.** A door still in
  **Intake**, one held out of books by **Remove apartments**, and one flagged **do-not-contact** are never
  sent; the bar counts them under "can't be marked" and names the reason. (A single Intake door in the
  payload would refuse the whole batch — no walk list, so no round could own the mark.) **Unmark** is the
  other way round: it sends everything that could still be carrying a desk mark — including doors excluded
  from books after they were marked — because that undo is the only way left to reach them.
- **Unmark restricted…** removes **desk** marks only: every one on the selected doors for that round,
  including marks made earlier and by someone else. Marks canvassers recorded at the door are kept. It is
  offered whenever the selection holds a door that could be carrying one.
- **After it runs**, the result lands in the page's usual result line — *"Marked 842 of 1,284 doors
  restricted · 210 already restricted · 232 completed this round"* — and the **selection is kept**: the
  rings flip from blue to slate in front of you as the map refreshes. There is no Undo link, because
  unmarking would also strip the marks that were already there; **Unmark restricted…** stays in the bar as
  a deliberate second action instead.
- **What clears a selection.** Leaving the mode (**Done**, **Esc**, the **✕**), **Clear**, switching the
  round or the campaign, a cut finishing, and — on the Map page — changing any filter, the date window or
  the scope. A door that simply leaves the map (a refetch drops it, a chip hides it) falls out of the
  selection on its own, so it is neither counted nor sent.

On **Turf Cutting** the mode always speaks for the round in the **Pass** dropdown, so every per-round number
in the bar is exact. The **Map** page can be looking at the whole campaign instead, and is careful to print
only what that view can answer — see [MAPS.md](MAPS.md). The mode is **web-only**; the phone marks one home
at a time.

Books are first created as **drafts** — nothing reaches canvassers until you **accept** them (drafts →
published). Re-cut freely until then; a **Discard** snapshots the layout so it's always recoverable.
A pass needs accepted (published) books before it can be activated.

## Assigning books to canvassers

Select one or more books (in the list or on the map) and add people. For several books at once there
are three modes: **Even books** (round-robin — each person gets a similar *book* count), **Even doors**
(greedy — spreads the *door* count evenly, since books vary in size), and **Everyone** (every selected
person on every selected book). A **Crew load** summary shows each person's books + doors so you can
see the balance, and a **search** box finds a book by name or assigned canvasser. **Only accepted
(published) books can be assigned** — assigning a draft is blocked (a re-cut would wipe it), so Accept
first.

Taking books back works the same way, from either client. On **web**, the selected-books panel lists
everyone assigned across the selection with an **Unassign** button each, plus **Unassign all (N)** to
clear the whole selection at once (it asks to confirm in place). On the **phone**, Select mode's action
bar has **Unassign all**, shown only when somebody actually holds one of the selected books. Both leave
the campaign team untouched — people keep their access to the campaign, they just stop being pointed at
those books — and neither touches a single recorded knock. Because assignment changes write nothing to
`Household`, a canvasser already out walking keeps the books on their phone until their app reloads the
campaign, and anything they record before then still counts.

## Printing a book on paper

A book can also be handed out as a **printed packet** for volunteers who aren't using the app —
**Campaign → Print Packets**, or the **Print this book on paper** link in the assignment panel.
Two layouts: a **survey packet** with the campaign's questions laid out to circle, and a **field
list** with just addresses, residents, and lines to write on. The packet walks the book in the same
order the cut produced, and honours the same suppression rules the app does — do-not-contact
residents are dropped when the PDF is built, checked live at that moment.

**It is print-only.** Nothing written on the paper comes back, so a book walked on paper keeps
reading as **0 knocked** here, on the map, and in every report — and a later targeted round will
re-cut those doors as untouched. If you're running a paper day alongside app canvassers, give the
paper doors their own book and assign it to **nobody**: an unassigned book is invisible to every app
canvasser, so the same street never gets walked twice. Full detail, including what prints and what
never does, is in [WALK_PACKETS.md](WALK_PACKETS.md).

## Watching a round on the cut map

Once a round has been worked, the Turf Cutting map stops being only a cutting tool and starts
answering *"how is this round going?"* — without leaving the page.

- **Each house is colored by what happened at it this round** — surveyed, not home, refused,
  restricted, or still unknocked — using the same colors as the Map page. Around each house sits a
  **ring in its book's color**, so you can read "this one is a not-home *and* it's in Book 4" at a
  glance. That's two facts on one dot.
- **The shape agrees with the ring.** Every house sits inside its book's outline (see *Every house
  is inside its book's shape* below), so the shape a dot sits in and the ring around it always name
  the same book.
- **Book labels count the work**: `Book 4 · 23/65` — 23 of its 65 houses done.
- **Book shading tracks completion**: an untouched book is pale, a finished one is solid. Spot the
  book nobody has started from across the map without reading a single number.
- **A coverage bar** across the top gives the whole round's mix — how many surveyed, not home,
  refused, still unknocked — and doubles as the map's color key.
- **Click a house** for its status, who knocked it, when, and any survey answers recorded there this
  round, alongside the usual "move to another book".
- **Apartment buildings** show `5/12 hit` instead of `12 units` once the round is underway.
- **Big campaigns don't drown the map.** Building markers exist only for the part of the map you're
  looking at, and past ~300 buildings in view they stand down behind a chip — *"N buildings in view —
  zoom in for building markers"* — while every building stays visible **and clickable** as a dot at
  any zoom. Zoom in and the markers come back. Nothing is ever clustered.
- **More room for the map.** The chevron on the *Generate books* header collapses that panel so the map
  fills the width (a floating button top-left of the map brings it back; the collapsed state is remembered);
  the top-left **fullscreen** button blows the map up to cover the whole screen (**Esc** or the button exits).

This appears **automatically once the round has knocks**. While you're still cutting, houses stay
colored by book exactly as before — a fresh cut has no status to show, and coloring every dot the same
gray would only make the cut harder to see. A **Door status** checkbox in the map's Layers box forces
it either way, and a **Not in a book** checkbox there (shown only when the cut left doors loose, hidden by
default) hides every loose dot — see *Excluding restricted-access homes from a later round* above.

**It does not auto-refresh.** The page shows the round as of when you opened it; reload to update.

## Every house is inside its book's shape

The shaded outline around a book **contains every one of the book's houses**, and outlines still
**never overlap**. The book itself remains its list of houses — the outline is drawn *from* that
list, and it always agrees with it.

One shape follows from that guarantee: a **pocket**. When a book owns a house that sits in the middle
of another book's houses (which the size-balancing cut legitimately produces), the map draws a small
island of the owning book's color right around that house, and the surrounding book's shape carries a
matching hole. A pocket isn't an error — it's the map telling you, at a glance, "this door belongs to
that other book." The house's ring color and its popup say the same thing.

The guarantee survives a **pin correction**, too. When someone moves a house pin (see *Fixing a
mis-placed pin* below), the house's own book is redrawn around the new spot — and so is any other
live book whose shape happened to cover that spot, so the dot never ends up sitting inside a
neighbour's shape. Only the drawn outline changes: the book's houses, their walk order, and their
statuses are exactly what they were.

## Recutting (changing the books)

If you don't like the books, or the underlying voter list changed, you **recut**. Two situations:

- The books are still **drafts** → just generate again; the old drafts are replaced automatically.
- The books are **accepted/published** → you must **Discard** them first, then generate again.
  Discard snapshots the current layout (so it can be undone), removes the books, and — if the pass
  was active — drops it back to **draft** (a live campaign can't be left with an active pass that
  has no books). Then you cut fresh and re-accept.

**Drafts-only discard.** When a pass has *both* accepted books and drafts (an "Add as new book" you
regret, say), the Discard dialog offers **Drafts only**: it removes just the unaccepted drafts and
leaves the accepted books, assignments, and knock history completely untouched — no confirmation
typing, because drafts never reached anyone. You can also select individual **draft** books in the
list and delete just those.

**Discarding a worked round is guarded.** If the round already has knocks recorded, the Discard dialog
names the **effort · round** in its title, shows how many knocks exist, and requires **typing
`discard`** to confirm (the server refuses without the explicit confirmation too) — so you can't wipe
the wrong effort's worked books by accident.

**What discard does — and doesn't — touch.** Discard deletes the **books** and **canvasser
assignments** and unlinks doors from their books. It does **not** delete knock history, survey
responses, door statuses, or the doors themselves (unless you explicitly check *clear knock history* —
and even then the cleared knocks go into the snapshot). The auto-saved **snapshot stores the books AND
the assignments**: **Restore** (Undo / snapshots) re-creates both exactly, then you just re-activate
the round on the Passes page — canvassers see their books again with all prior progress intact.
(Restore is blocked while the pass has live books — discard those first.)

There is **no "add just the new houses to the existing books"** option. Recutting is all-or-nothing
for a pass: replace that pass's whole book set.

## Editing books after the cut (move doors, merge, split)

Sometimes you don't need a full recut — you just want to reshape a book or two. These edits live in
the books editor on the Turf Cutting page and work on drafts and **published** books alike.

> **The rule that makes all of this safe: knocks follow the _door_, not the _book_.** A knock is
> recorded against a household (door) + pass — never against a book — so moving a door to another
> book, merging books, or splitting a book **never changes coverage or billable counts**, and an
> already-knocked door keeps its status wherever it lands. And a **billable knock is one distinct
> (door, pass)**: if two canvassers on the same book knock the same door in the same pass, it bills
> **once** (a new pass counts again). Overlap can never double-bill.

- **Move a door to another book.** Pulls the house out of its current book and into the target,
  re-numbering both books' walk order. A door can only move between books **in the same walk list**
  (walk lists own disjoint doors). You can also move **every unit of one building** at once.
- **Move many doors at once.** The **Select doors** lasso has a **Move to book…** action: lasso up to
  1,000 doors (across any number of books — loose doors too) and send them to an existing book **or a
  brand-new one** named on the spot. A new book made mid-round — on a pass that already has accepted
  books — is **born published**, instantly assignable; during cutting it's born draft and rides Accept
  with the rest. If the move takes a donor book's **last** doors, the page asks whether to delete the
  now-empty book (deleting also removes any leftover assignments on it) — nothing is deleted on its own.
- **Move whole books.** Select books and choose **Move doors to…** on the panel: everything they hold
  moves into the target book (a merge under the hood — you name the survivor), or into one **new** book
  combining them. The emptied source books are removed as part of the move.
- **Merge two or more books** (same pass) into one. One of the selected books is kept (the Move flow
  lets you pick which; plain Merge picks for you); the others' doors move into it and the emptied books
  are removed. **Assignments are folded in:** if the books were assigned to the _same_ person, they
  stay assigned once; if to _different_ people, **both stay assigned to the merged book** — on purpose
  (you _can_ put two canvassers on one book, and billing won't double-count if they overlap). Reassign
  afterward if you want a single owner.
- **Split a book** — peel a subset of doors out into a **new** book. Heads-up: the new book comes out
  **unassigned** (a merge can fold assignments; a split can't guess who should get the new book), so
  **assign it** or its doors drop off the original canvasser's list.

**Two things to know, by design:**
- **A merge can't be undone** (unlike Discard, it takes no snapshot). Merging already-worked books is
  safe for the counts, but you can't un-merge — recut the pass if you need the old split back.
- **Fixing a pin ≠ moving the door's book.** Correcting a mis-placed pin (below) moves the _dot_ only;
  the door stays in whatever book the cut put it in. If a pin was so wrong it sat in the wrong area,
  fix the pin **and** use _Move door_ to put it in the right book.

## Fixing a mis-placed pin

A house pin in the wrong spot can be dragged to its correct location — an admin does it on the web
**Map** page (**"Move pin"**) or **right here on the Turf Cutting page** (click the house, choose
**Move pin →** in its popup, drag the blue marker, **Save location**; an apartment building's popup has
**Move building pin →**, which moves every unit at that pin together), and a **team lead can do it in
the field** (**"Fix pin location,"** including "use my current GPS"). **Canvassers can't move pins** — a
correction is a data change with an audit trail, so it is lead/admin-only ([MAPS.md](MAPS.md)); a
canvasser who spots a bad pin tells their lead. Whichever way it's done, it corrects **only the
coordinates** (with an audit trail); it does **not** change the book, the walk order, the door's status,
or any count, and it **needs no recut**. Canvassers see the corrected spot on their **next sync (within
~30s** — see below). Full mechanics: [MAPS.md → Coordinate provenance & pin correction](MAPS.md).
(What you _can't_ do in-app is edit the address _text_ or re-run geocoding on a single door — the pin
drag is the tool.)

**The book outline follows the dot.** Because every house sits inside its book's shape (above), a
moved pin redraws the shapes it affects: the house's own book, plus any other live book whose drawn
shape happened to contain the new spot — so the dot doesn't sit inside a neighbour's outline. That's a
redraw, not a re-cut: membership and walk order are untouched, and it happens for every live round the
door is booked in. Three things to know:

- **It's best-effort.** The pin is saved first, then the outlines are redrawn; if the redraw fails for
  any reason the pin stays corrected and the outline catches up on the next cut or edit (or ask your
  Doorline contact to run the outline repair, which redraws outlines only — never membership).
- **Very large rounds skip the redraw.** A round with more than about 60,000 booked doors keeps its old
  outlines after a pin move (redrawing one would take too long inside a single request); the pin is
  still corrected, and the same outline repair redraws it.
- **Landing exactly on another book's pin** (coordinate for coordinate) — rare outside apartment stacks
  — means two books share one spot, and only one of them can draw it; the house's ring color and its
  popup still name its real book.

A pin that was so wrong the house sat in the wrong *area* usually wants both fixes: move the pin,
**and** use _Move door_ to put it in the right book.

## How field phones get these edits — and when

The field app is **pull-only** (no live push). Two refresh layers decide _when_ a canvasser sees an
admin change:

| What you changed | When the canvasser sees it |
|---|---|
| A **pin move**, a door's **status**, or a door going **excluded/voted** | **Live — within ~30s.** A background delta patches their map in place. |
| A door's **book** (move / merge / split / supplemental) or **who's assigned** a book | **Next full refresh** — pull-to-refresh, reopening/switching the campaign, a round activating, or a cold app start. |

So a **pin fix is near-live**, but **reshuffling books or reassigning people is not** — the phone keeps
showing the old books until a full refresh. Nothing is lost or miscounted in the meantime (a door
briefly visible in two places still bills once per pass), but if you move work between canvassers
**mid-shift, tell them to pull-to-refresh** so the losing canvasser drops the door and the new one
picks it up. Plumbing behind both layers is in [MAPS.md](MAPS.md); the field flow is in
[CANVASSER_APP.md](CANVASSER_APP.md). Technical details in Part 2 §G.

## Targeted follow-up rounds (cut over only the doors that still need work)

A new round normally cuts the effort's **whole** door universe. For a **follow-up round** you can cut
over only a **subset** — open **Target doors** on the Turf Cutting page and pick any mix of:
- **knock status** — e.g. *unknocked* (never reached), *not-home* (re-try); and
- **survey answers** — e.g. *Undecided* (persuasion), *Support / Likely* (GOTV).

Combine with **OR** (the union — "unknocked **or** supporters") or **AND** ("not-home **and** supporters").
The panel shows a live door/voter count, and the cut produces books over just those doors — scoped to
**this effort only** (it never pulls another effort's doors). Recut without a target = the full universe,
unchanged.

Below it sits **Exclude doors** — the NOT side. Doors matching **any** of its conditions (status or
survey answers) are **removed from the cut, even when they match the target above**; the AND/OR choice
never applies to it, and an exclusion can only ever shrink the cut. The canonical use is a **sign-drop
pass**: target *unknocked + not-home + Support/Likely/Undecided*, exclude *Yard Sign Delivered* — go
back to everyone persuadable-or-better whose yard isn't already converted, without re-knocking the doors
that took a sign (a sibling option like *Candidate Follow-Up* stays in). Exclusion is **door-level**:
one household member with a matching answer removes the whole door, and it matches answers from **any**
round. The count line reads "*N* doors · *V* voters · *M* excluded", where *M* counts only doors the cut
would otherwise have walked. A malformed exclusion (one with no valid conditions) refuses to cut rather
than silently walking the doors you removed.

## Each round is its own pass — door status is per-round

Crucially, **a round is an independent billable pass.** A door's "done/not-done" that the canvasser
sees is **per the round they're working** — so a supporter you surveyed in Round 1 shows up **fresh**
in a Round-2 GOTV book, the canvasser re-contacts it, and that counts as a **new billable knock**
(billing already counts one knock per *door × round*). What carries across rounds is **coverage** —
the campaign-wide "have we ever reached this door" picture (`Household.status`) — which a re-knock
updates without double-counting. So: **per-round** for what the canvasser works; **global** for
coverage/reporting. (First/only rounds look exactly as before — the difference only shows once a Round 2
exists.)

A canvasser's per-round status is resolved from **their assigned book's round** (not a door's global
book pointer), so you can **cut/prep the next round at any time** — even while the current round is still
being walked — without disturbing the active round's canvassers. (Activating the new round still archives
the old one and needs its own book assignments — a new round is a fresh assignment.)

**The round-fresh presentation goes all the way down to the voter.** On the canvasser's wire,
three fields are rewritten to the round of their assigned book: the door's
`status`, its `lastActionAt` (a round-fresh door shows **no** "Last visit", not "Unknocked · Last
visit 3 weeks ago"), and each voter's `surveyStatus` — 'surveyed' means *surveyed in this round*, so
a Round-1 supporter presents "Take survey", not a "Surveyed" badge with a "Re-survey" button.
That wire has **four** lanes, and every one must speak per-round: the bootstrap, the `/changes`
delta, `me.js` ("Remaining"), and the **action responses** — the body a disposition/survey POST
returns, which the client's reconcile reads (`response.household.status`) and re-arms its
optimistic overlay with (`toWireHousehold` in
[canvass.js](../server/src/routes/mobile/canvass.js), pinned by
[actionResponsePerRound.int.test.js](../server/test/actionResponsePerRound.int.test.js)). The
action lane was the one missed when the wire went per-round: it echoed the stored **sticky**
global status, so recording *not home* on a prior-round-surveyed door flipped the pin back to
"surveyed" and the overlay defended the lie against correct deltas until app restart — the
pass-3 field bug of 2026-07-31. The
stored fields stay campaign-global for admin/reports. This is deliberate integrity design, not just
cosmetics: a canvasser who can see who answered last round can "confirm" a knock without a
conversation. The same principle gates the mobile voter profile (full cross-round answers, DOB,
phone) to **leads/admins only** — see [VOTERS.md](VOTERS.md). The one voter-level marker that stays
visible across rounds is the ✓ voted flag (and DNC, which never resets — it's consent, not
progress). The trade-off, chosen deliberately: a canvasser at a revisited door gets no hint anyone
was there before, so a voter may say "you already asked me this." Per-round wire helpers:
`doorStateFromDoorPass` / `surveyedVotersFromDoorPass` in
[passStatus.js](../server/src/services/passes/passStatus.js), pinned by
[perRoundVoterView.int.test.js](../server/test/perRoundVoterView.int.test.js).

**Seeing it as an admin.** The **Passes page** shows a **Knocks** count per round (the billable
`door × round` figure) next to the books + progress. The **audit map** (Passes → *Audit →*) is
**pass-scoped**: with a round selected it shows *that round's* door status + activity, not the global
latest — and the door detail has a **History by round** section, so a door worked in Round 1 *and*
Round 2 shows both. The **Turf Cutting page** is pass-scoped the same way (see *Watching a round on
the cut map* below): pick a round in its dropdown and the house colors, the per-book progress and the
coverage bar all re-scope to that round.

**Archiving a round is one-way + guarded.** A round goes draft → active → archived and is **never
reopened** (you make a new round). Archiving a **live or already-worked** round therefore needs a
confirmation (knocks are kept either way); only the *auto*-archive when you activate the next round is
silent.

## One active pass per walk list

Each **walk list** runs **one active pass at a time** — activating a pass archives the other active
pass *in that same walk list*, but other walk lists keep theirs. So a campaign can have **several active
passes at once** (one per active walk list — see the banner above and [EFFORTS.md](EFFORTS.md)).
Canvassers only ever see an **active** pass, and within it only the **books assigned to them**; passes
sitting in draft or archived are never shown in the field.

## How the numbers add up across passes

- Every knock and every survey is stamped with the pass it happened in.
- **Dashboard totals add up across all passes.** If Round 1 had 100 knocks and Round 2 had 80, the
  dashboard shows **180**. (Only the per-pass progress view is scoped to a single pass.)
- A knock counts **once per (house, pass)** — re-knocking a house in the *same* pass doesn't add a
  knock; knocking it again in a *new* pass does. This is the billing unit.
- **Coverage / "homes knocked" is different** — it's based on each household's *current* status,
  campaign-wide, and is **not** pass-aware. One house has one status no matter how many passes hit
  it. So running another pass (or recutting) adds **knocks**, but doesn't change **coverage**.

See [METRICS.md](METRICS.md) for the exact definitions.

## Adding new voters after a pass exists (worked scenario)

A walk list's pass is underway, then you import **new voters at new addresses**. What happens?

- The new addresses land in **Intake** — owned by **no walk list** ([EFFORTS.md](EFFORTS.md)) — so
  they're in no book and no cut can reach them yet. Canvassers on the active pass **won't see
  them**, and existing books are **not** auto-updated. (A new voter at a door a walk list *already
  owns* simply rides along — same physical door, nothing to do.)

**First, claim the new doors into a walk list** — on the Walk Lists page, assign the Intake doors
to the walk list that should work them (or make a new one). Then get them into books:

1. **Add them to the live pass as a supplemental book (recommended).** On the Turf page, when there
   are doors "not in any book," click **Add as new book** — the walk list's unassigned households
   are cut into new draft book(s) on the *current* pass without touching the existing books or
   knocks. The cut runs in the background with the same progress bar as Generate (a big add can take
   a few minutes — safe to leave the page and come back). Then **Accept** and **assign** them like
   any other book. No recut, no archive; canvassers
   see the new doors on their next refresh. → keeps the round running. On a **targeted** round, both
   the "not in any book" count and the supplemental cut respect the pass's own target filter —
   doors the target skipped or the **Exclude doors** panel removed are bookless *on purpose*, so
   they're never counted or re-introduced (a genuinely new door still flows in: it's unknocked and
   has no survey answers).
2. **Recut the same pass.** Discard its books (this resets the pass to draft), then generate again.
   Regeneration pulls from the walk list's **current** owned doors, so the newly claimed addresses
   are **included**. → the "remove all existing books and recut" path; use when you also want the
   whole pass re-balanced.
3. **Create a new pass** in the walk list and cut fresh books there. The old pass and its knocks
   stay exactly as they were. → the "keep them and make a new pass" path.
4. **Manually** move the new households into existing books one at a time (see **Editing books after
   the cut** above). Fine for a few; impractical for a bulk import.

> **The gotcha moved.** Passes used to be able to bind a *frozen* walk-list snapshot that a recut
> would replay, silently skipping new addresses. Passes no longer freeze anything — every cut pulls
> from the walk list's **current** owned doors — so the thing to remember now is the claim step
> above: a new address sits in **Intake** until you assign it to a walk list, and until then **no**
> recut or supplemental book can see it.

### New voters at homes you've **already worked**

A different, rarer case: an import drops a **new target voter into a home you've already knocked or
surveyed**. The new voter is attached to the existing home (no duplicate door), but the door's status
is **per-household** and already reads "done," and the home is **not** in Intake — it's still owned by
whatever book worked it. So by default nothing surfaces the new voter for a revisit.

We deliberately do **not** reopen the door in place: a re-knock in the *same* pass dedupes to one knock
per house×pass, so it wouldn't **bill** the revisit, and rewriting a completed door's status back to
"unknocked" would muddle the first knock's history.

> **Both reasons invert when the first knock is fraudulent or mistaken** — that case has its own
> tool, **Unknock** on the Door Outcomes page (docs/CAMPAIGNS.md §Unknock, 2026-08-26). It
> *deletes* the bad entries, so the emptied house×pass pair bills the re-knock exactly once as the
> first real knock, and the "history" being removed is fabricated — preserved as evidence on the
> run, not as billable work. The rejection above is about *honest* first knocks; don't reach for a
> new pass to clean up a dishonest one, because the new pass makes round 1 read as completed work.

Instead, the **voter import has an opt-in checkbox — "Revisit already-worked homes that gain a new
voter."** When it's on and the import lands new target voters in already-worked homes, those homes are
collected into an auto-generated **saved search** ("New voters — <file>", `source: 'import'`). From
the import summary, **Create revisit walk list →** deep-links to the Walk Lists page with that saved
search preselected as the new list's door source: name it and **Create walk list**, and because those
homes are already owned, the app **re-carves** them into the new list for you (pulling them from their
old books). Then cut books and walk. Because it's a **new pass**, the revisit **bills as its own
knock**, and the first knock stays intact in its original pass. Brand-new addresses from the same
import still go to **Intake** as usual; to walk both together, claim Intake + this list into the one
walk list. "Already worked" = the home's sticky status is a completion (`surveyed` for survey
campaigns, `lit_dropped` for lit-drop), so it holds even if the completing round is archived.

---

# Part 2 — Technical reference

Authoring/lifecycle: [`server/src/routes/admin/passes.js`](../server/src/routes/admin/passes.js) and
[`server/src/routes/admin/turfs.js`](../server/src/routes/admin/turfs.js). Generation:
[`server/src/services/turf/generateTurf.js`](../server/src/services/turf/generateTurf.js) (runs in a
BullMQ worker). Operational steps live in [TURF_RUNBOOK.md](../TURF_RUNBOOK.md).

## A. Data model

| Model | File | Fields that matter |
|---|---|---|
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `effortId` (the walk list whose owned doors are the round's universe), `roundNumber` (unique **per walk list**, never reused), `name`, `targetFilter` (optional walk-list-shaped filter for a targeted follow-up round; may carry an `exclude` NOT-branch — see [WALKLISTS.md](WALKLISTS.md) §B), `walkListId` (**deprecated** — null on new rounds; the door-set comes from the effort), `status` (`draft`/`active`/`archived`), `activatedAt` (set on activation; knock attribution is now door→book→walk-list, not this timestamp — see the banner), `archivedAt`, `recutLock{lockedAt,lockedBy,token}` (`token` = the holding job's id, letting a long claim/supplemental job RENEW its own lock past the 5-min staleness window — [recutLock.js](../server/src/services/turf/recutLock.js)). Unique index `{effortId, roundNumber}` ([Pass.js:58](../server/src/models/Pass.js#L58)). |
| `Turf` (= "book") | [models/Turf.js](../server/src/models/Turf.js) | `passId` (required), `campaignId`, `name`, `mode` (`attribute`/`geometric`/`manual`), `params`, `householdIds[]` (**ordered** = walk sequence), `doorCount`, `boundary`/`centroid` (GeoJSON, **display-only**, not geo-indexed), `status` (`draft`/`published`/`archived`), `generationJobId`, `generatedBy`. |
| Active passes (derived) | [services/passes/activePasses.js](../server/src/services/passes/activePasses.js) | `activePassIds(campaignId)` derives the live passes from `Pass.status==='active'` — **one per active walk list** (a campaign can have several at once). There is **no** `Campaign.activePassId` field. |
| `Household.turfId` / `walkOrder` | [models/Household.js](../server/src/models/Household.js) | Denormalized mirror of "which book + position" for the household; `null` until assigned by a cut. |
| `TurfAssignment` | [models/TurfAssignment.js](../server/src/models/TurfAssignment.js) | Which user is assigned which book on which pass (`{userId, campaignId, passId, turfId}`); drives the mobile bootstrap's per-canvasser scoping. |
| `SavedSearch` | [models/SavedSearch.js](../server/src/models/SavedSearch.js) | Frozen `householdIds[]` snapshot a **walk list** seeds/claims its doors from (`Effort.seededFromWalkListId` — see [EFFORTS.md](EFFORTS.md)); **immutable** w.r.t. later imports. No longer targeted by passes (that was the deprecated `Pass.walkListId`). (Formerly `WalkList`.) |

## B. Generation pipeline

`generateTurf({ campaignId, passId, mode, params })`
([generateTurf.js](../server/src/services/turf/generateTurf.js)):

1. **Load households** ([:75-81](../server/src/services/turf/generateTurf.js#L75-L81)) — the result is
   sorted by `_id` through the `byId` helper, in JS rather than with a Mongo `.sort({_id:1})`: no
   `Household` index ends in `_id`, so the server would fall back to a **blocking in-memory sort** on
   exactly the largest campaigns, and prod runs with `autoIndex` off. The cut already materializes
   every document, so the JS sort is free. Base filter
   = `{ campaignId, isActive: true, effortId: pass.effortId, 'location.coordinates': {$exists,$ne:null} }`
   — a round cuts only its **effort's** owned doors (see [EFFORTS.md](EFFORTS.md)). When
   `params.excludeRestricted` is set, the base filter also gets the exclusion clauses from
   **`cutExclusionFilter`** ([generateTurf.js](../server/src/services/turf/generateTurf.js)), so
   inaccessible homes are dropped from **that** cut's books (opt-in; non-destructive — the homes are
   untouched in the DB). `addSupplementalBooks` and the `/preview` route take the same option and call
   the same builder, so a preview count equals what the cut produces.

   **Why it is no longer a bare `status` clause (fixed 2026-08-24).** `cutStatusExclusion` filtered on
   `Household.status`, which is resolved across **all** rounds with a **sticky completion**
   ([statusPrecedence.js](../server/src/utils/statusPrecedence.js)): one survey, in any round, ever,
   pins it to `'surveyed'` permanently. So a gated home surveyed once in Round 1 and then desk-marked
   in Round 2 had a live, counted, console-visible mark **and** a global status of `'surveyed'` — and
   the toggle cut it straight back into Round 3. The published promise that the toggle "picks it up on
   the next cut" was false in exactly that case, and nothing covered it. `cutExclusionFilter` now
   unions the old global-status clause with `restrictedDoorIdsForEffort` — doors that still read
   `restricted` in **the round holding their own newest restricted row**, desk marks and field marks
   alike. That "own round" wording is load-bearing: marks normally sit on the **active** round while the
   round being cut is a fresh draft with no activity at all, so judging by *the effort's latest round*
   would inspect the empty draft, find nothing, and re-open the very hole this closes (pinned by case
   10b in [deskMarkSuperseded.int.test.js](../server/test/deskMarkSuperseded.int.test.js)). Bounded by
   the restricted ROWS — one aggregate over `{campaignId, passId ∈ non-archived rounds,
   actionType:'restricted'}` sorted newest-first and grouped per door, then one status resolve over
   that set — never by the effort's door count; no new index.

   It returns **`$and` clauses, never a spread `_id`**: two of the three cut filters already own an
   `_id` key (`addSupplementalBooks`' `$nin: alreadyBooked`, the preview route's `$in: householdIds`),
   so a spread would silently clobber one of them — the same hazard the two-`status`-spreads comment
   warns about, one key over. A door whose mark a canvasser **superseded** is deliberately cut back in:
   the crew got in, so the home is reachable.
2. **Cut** by mode: `attributeCut` ([attributeCut.js](../server/src/services/turf/attributeCut.js)) —
   group by a denormalized cut column (precinct/county/city/zip/districts), optional `capN`
   geometric subdivision; `geometricCut` ([geometricCut.js](../server/src/services/turf/geometricCut.js))
   → `balancedKMeans` ([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) —
   **compactness-first** clustering with `maxDoors` as a soft target (§B.1); `manual` — households
   within `params.polygon`.
3. **Wipe prior drafts** (`wipeDraftBooks` in
   [generateTurf.js](../server/src/services/turf/generateTurf.js)) — delete the pass's existing
   `draft` Turfs + their `TurfAssignment`s and clear the household mirror, so a re-run is idempotent.
   (Published books are *not* touched here — the `/generate` route blocks when published books exist;
   see §C.) The same helper backs the **drafts-only Discard scope** (§C), so the endpoint can never
   drift from what the cut itself does.
4. **Per book**: compute walk order, centroid, boundary (concave hull → Voronoi-clipped territory),
   insert as `status: 'draft'`, and **mirror** `turfId`/`walkOrder` back onto each household.

The route enqueues this as an async job and returns a `jobId` to poll
([turfs.js `/generate`](../server/src/routes/admin/turfs.js), poll at `/jobs/:jobId`). The TURF queue
carries **three job kinds**, dispatched on `job.name` in
[turfProcessor.js](../server/src/services/turf/turfProcessor.js): `generate` (this cut — and the
default for unrecognized names, so pre-deploy jobs drain), `supplemental` (the add-books flow), and
`claim` (walk-list door moves — [EFFORTS.md](EFFORTS.md) §B). Worker concurrency 1 serializes all
three against each other; the per-pass `recutLock` (with a job `token` + periodic renewal —
[recutLock.js](../server/src/services/turf/recutLock.js)) fences the web-side discard/restore off
from a running job. `/jobs/:jobId` polls any of the three.

## B.1 The geometric cut (compactness-first)

`balancedKMeans(items, maxDoors, { tolerance = 0.4 })`
([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) makes books as **tight and walkable**
as possible, treating `maxDoors` as an **approximate target**, not a hard equal cap. (The old
capacity-balanced cut forced near-equal sizes, which exiled boundary houses into far books — a canvasser
driving across the area for one door.)

It is **async and chunked at scale** (2026-08 stall incident): one assign pass is n×k distance work,
and at 26.5k doors that ran for minutes of unbroken synchronous CPU — the BullMQ lock-renewal timer
never fired, the job stalled, re-ran, and reported *"job stalled more than allowable limit"* while
both runs' writes landed. Two mechanisms fix it: an awaited `setImmediate` between every k-means
iteration and polish sweep (so the lock timer can always fire), and — above `CHUNK_THRESHOLD`
(default 8 000 doors; env `TURF_KMEANS_CHUNK_THRESHOLD`) — a **pre-split of the Hilbert-sorted array
into contiguous ~6 000-door runs**, each clustered independently and concatenated in chunk order
(~40× less work per iteration at 250k doors; a book simply can't span a run boundary, the same class
of compromise the soft cap already accepts). Sub-threshold cuts take the exact single-run path they
always did. `computeTerritories` yields per book for the same reason; the single `turf.voronoi` call
stays sync (seconds even at 250k, covered by the TURF worker's 90s `lockDuration` —
[worker.js](../server/src/worker.js)).

Everything runs on Hilbert-projected meters and is fully
**deterministic** — but the absence of `Math.random` is only half of why. Seeds are chosen by
**position** in the Hilbert-sorted array and equally-placed doors break ties by **index**, so the
order the doors arrive in reaches book membership. Chunk boundaries are a pure function of
`(n, threshold)` over that deterministic order, so the chunked path re-runs identically too. Mongo
guarantees no document order, so
`generateTurf` sorts every cut-feeding load by `_id` (the `byId` helper) before anything touches it,
and `hilbertSort`'s comparator is a total order (`h`, then `x`, then `y`). Both are load-bearing:
without them a re-run or a retried worker job could produce different books:

- **k & soft band:** `k = ceil(n / maxDoors)` books; `softMax = ceil(maxDoors·(1+tolerance))` (initial
  balance), `hardMax = ceil(maxDoors·(1+1.5·tolerance))` (true ceiling), `softMin = floor(maxDoors·(1−tolerance))`.
- **Seed + assign (Lloyd loop):** centroids seeded evenly along the Hilbert curve; each house goes to its
  **nearest** book still under `softMax`, and overflow picks the **nearest book with room** — never a
  distance-blind "book with the most space" (the old stray source).
- **Relocation polish:** move any house to a strictly-nearer book that has room — single-point, so it
  relocates a *lone* stray (which a count-preserving swap cannot).
- **Swap polish:** trade boundary pairs between two full books (count-preserving, lowers total distance).
- **Tiny-book merge:** fold a sub-`softMin` book into an adjacent one if the result fits under `softMax`;
  a genuinely **isolated** small cluster is left alone (don't drag a remote hamlet across town).
- **`hardMax` rescue (the finisher):** a house still stuck far from its cluster joins its **nearest** book
  even slightly over target (up to `hardMax`) instead of driving away — compactness beats the count.

### Book outlines: containment AND non-overlap — both, via door-level Voronoi

`computeBoundary` ([boundary.js](../server/src/services/turf/boundary.js)) walks a relaxing `maxEdge`
ladder (0.4 → 0.6 → 1.2 km) and **each rung must contain every one of the book's houses**, falling
back to `turf.convex` (which contains all input points by construction). It used to return on the
first rung that produced a `Polygon` — but `turf.concave` triangulates away outlying points and still
returns a valid Polygon, so hulls were accepted that visibly excluded their own doors and the ladder
never got its chance (measured: **1 of 13 houses outside at maxEdge 0.4, 0 at 1.2**).

`computeTerritories` builds each stored outline as

```
territory_i = hull_i ∩ union(Voronoi cells of book i's OWN doors)
```

with the Voronoi diagram seeded by **every booked door of the pass** — not one seed per book. Every
door is inside its own cell by definition and inside its hull (verified above), so it is inside the
intersection; cells are disjoint across books, so territories never overlap. **Both properties hold
simultaneously.** An earlier revision of this section claimed that was impossible and pinned the loss
as by-design — that held only for the previous construction (each hull clipped to a *single* cell
seeded at the book's centroid), under which a door nearer a neighbour's centroid fell outside its own
outline (measured then: 7 of 24 doors lost from a street book). The door-level union retires that
trade-off. Measured at production scale (16.5k doors / 128 books): **~1.5s full recompute, 0 doors
outside, 0 m² overlap**, ~95 KB total geometry. Deterministic — worker re-runs reproduce identical
shapes, because the books are handed in `_id` order (`byId`) and the first-book-wins dedupe below
therefore always picks the same owner. Duplicate coordinates (apartment stacks) are deduped first-book-wins; a coordinate genuinely
split across two books can only be strictly inside one of two disjoint shapes, so the minority units
rely on the ring/popup (the one honest residual). Contract pinned by `test/turfBoundary.test.js`.

Two shape consequences, both intended: a door surrounded by another book's houses gets a **pocket
island** (the territory becomes a `MultiPolygon`; the surrounding book carries a matching hole), and
`Turf.boundary` therefore accepts **`Polygon` or `MultiPolygon`** — safe because boundary is
display-only and never geo-queried (see the model comment; Mapbox on web and mobile renders both
natively, and the canvasser bootstrap never ships boundary at all).

**Edit-time cost is bounded by `onlyTurfIds`.** `recomputePassTerritories(passId, { onlyTurfIds,
withCentroid })` still seeds the diagram with the whole pass (seams depend on every door) but re-unions
only the books an edit touched (~110ms at 16k doors vs ~1.5s for all 128). Correct because a door's
**book** move doesn't change the diagram — the seeds are the same points, only cell ownership flips, so
untouched books' stored shapes stay exactly right — and a door *removal* (the effort claim path) only
grows the remaining cells, so untouched shapes stay strictly inside their new entitlement: still
disjoint, still containing. A **coordinate** move (a pin correction) is the one edit that *does* change
the diagram: a seed moves, so the cells around both the old and the new spot change. The pin-move
caller ([rehullAfterPinMove.js](../server/src/services/turf/rehullAfterPinMove.js), §G) therefore
passes the door's own book(s) **plus every live book whose stored shape contains the new point**
(`booleanPointInPolygon`): inserting a seed only *shrinks* the neighbours' cells, so any book whose
shape covered the new spot would otherwise overlap the moved door's new cell, while books around the
old spot only *grow* and stay contained (an un-drawn notch at worst, never an overlap). The residual —
the new cell ∩ a Voronoi-adjacent book's stored shape that did *not* contain the point — is lot-scale
at most (0 m² in 7 of 8 synthetic cases, 0.94 m² in the adversarial one) and is healed by the full
recompute below. `withCentroid: true` (default `false`, so the seven pre-existing callers and the
migration's "writes only `Turf.boundary`" promise are byte-identical) also rewrites `Turf.centroid`
from the moved member set — display-only, like `boundary`. `recomputeTurf` writes the **unclipped**
hull and must always be followed by `recomputePassTerritories` — every call site does (move-door,
move-doors, merge, split, the effort door-claim path in [efforts.js](../server/src/routes/admin/efforts.js)),
each passing the books it changed. The pin-move re-hull
([rehullAfterPinMove.js](../server/src/services/turf/rehullAfterPinMove.js)) calls `recomputePassTerritories`
directly — no `recomputeTurf`, because walk order is never recomputed mid-round. Outlines cut before this change are healed
in place by `npm run recompute:territories -- --apply` (see [OPERATIONS.md](OPERATIONS.md)) — it rewrites
only `Turf.boundary`, so it is safe mid-round.

`tolerance` is surfaced on the Turf Cutting page as a **Tight / Balanced / Compact** toggle
(`0.15 / 0.25 / 0.4`; default **Compact = 0.4**), sent through `params.tolerance` (the `/generate` route
passes `params` straight through). Lower → tighter, more even books; higher → more size flex for
compactness. On a synthetic benchmark vs. the old cut, the farthest house from its book center dropped
from ~5 km to ~1 km, and "misplaced" doors (a closer book exists) from ~100 to 0–7. The same engine
powers `geometricSubdivide` (attribute mode, default flex) and `addSupplementalBooks`.

## C. Lifecycle & routes

**Passes** ([passes.js](../server/src/routes/admin/passes.js)):

| Route | Behavior |
|---|---|
| `POST /campaigns/:campaignId/passes` | Create a round **within a walk list**: body `{ effortId, name? }` — `effortId` required (400 without; 404 if not this campaign's), blank `name` auto-labels "Pass {roundNumber}". `roundNumber` auto-increments **per walk list** (`createNextPass`; 409 if a number can't be allocated); starts `draft`. |
| `POST /passes/:id/activate` ([:111](../server/src/routes/admin/passes.js#L111)) | 409 if archived ([:115-116](../server/src/routes/admin/passes.js#L115-L116)); 400 if no published books; **archives other active rounds of the same walk list only** ([:127-132](../server/src/routes/admin/passes.js#L127-L132)) — other walk lists keep their active rounds; sets `activatedAt` once ([:134](../server/src/routes/admin/passes.js#L134)). No campaign-level pointer is written — active rounds are **derived** (see the data-model table). |
| `POST /passes/:id/archive` | **409 `archive-confirm-required`** `{ knockCount, isActive }` when the round is active **or** has knocks and `confirmArchive` isn't set (one-way + canvassers lose it — knocks kept). Else archive (`status:'archived'` + `archivedAt`, [:163-164](../server/src/routes/admin/passes.js#L163-L164)). |
| `GET /campaigns/:campaignId/passes` | Each pass row carries `turfCount` **and `knockCount`** (distinct `(household, pass)` over `KNOCK_ACTIONS`) for the Passes page. |
| `GET /admin/households/:householdId/activity` | A door's `CanvassActivity` + `SurveyResponse` across all rounds, grouped by round (`{ currentPassId, rounds: [{ passId, roundNumber, name, status, entries }] }`) — powers the door-detail "History by round". Each knock entry carries **`via`** (`'bulk'` for a desk mark, `null` for a field row; survey entries carry none), each round its Pass **`status`**, and the top-level **`currentPassId`** (string \| null) is the round a desk mark with no explicit `passId` resolves to for THIS door (the door's effort's active round → its single non-archived round → null; Intake → null). The rounds list holds **only rounds with entries** (plus a `passId: null` "Before passes" pseudo-round for legacy null-pass rows), which is why the desk-mark UIs key on `scopePassId \|\| currentPassId` and never guess "newest/active". Full shape in [MAPS.md](MAPS.md) §D. |
| `DELETE /passes/:id` ([passes.js](../server/src/routes/admin/passes.js)) | Draft-only. Since 2026-08-21 it also sweeps the round's **desk marks** — `{ passId, actionType:'restricted', via:'bulk' }` via `removeDeskRestrict` ([deskRestrict.js](../server/src/services/canvass/deskRestrict.js)) — so single-home marks made on a draft round (allowed, see the Books table) don't orphan: global status would otherwise stay restricted with no book-level undo left. |

**Books / turf** ([turfs.js](../server/src/routes/admin/turfs.js)):

| Route | Behavior |
|---|---|
| `GET .../turfs/attribute-preview?passId=&attribute=` | Group-sizes preview for attribute mode: knockable doors per `ATTR_COLUMN[attribute]` group (same cut base filter), `{ groups: [{ name, doorCount }] }` desc. |
| `POST .../turfs/manual-preview` `{ passId, polygons }` | Per-area preview for manual mode: cuttable houses (`$geoWithin`, same cut base filter) + their `Voter` count inside each drawn polygon → `{ areas: [{ doorCount, voterCount }] }` index-aligned. Manual `generate` takes `params.polygons[]` (one book each) + optional `subCutN` (geometric split of big areas). **Overlap dedup is first-area-wins** in both the preview and the cut (a `claimed` Set across the polygon loop), so a house is never double-assigned/double-counted. |
| `POST .../turfs/assign-bulk` | Bulk-assign selected books to selected people. `mode`: `distribute` (round-robin, even **books**), `balance` (greedy by eligible door count, even **doors**), `everyone` (all on all); `replace` clears existing first. **409 `not-accepted`** if any selected book is still a draft (per-book `POST /:turfId/assignments` enforces the same). |
| `POST .../turfs/exclude-apartments` `{ passId, threshold }` | Group the effort's doors by rounded geocode; set `Household.excludedFromTurf:true` on members of clusters ≥ threshold → they skip cutting/book-counts/packets/canvasser everywhere via `KNOCKABLE_DOOR_FILTER` (mirrors `fullyVoted`), but **stay on the admin map**, which surfaces them as a count + Show/Dim/Hide toggle ([MAPS.md](MAPS.md) §I). The read is UNSCOPED, so exclusion is campaign-wide and provenance-free — the stamp records no effort/pass/actor. `POST .../turfs/include-apartments` clears it, but only for the doors the **named effort currently owns**: a door returned to Intake (`effortId: null`) can't be reached by any endpoint, since `Pass.effortId` is required. |
| `POST .../turfs/generate` ([:45](../server/src/routes/admin/turfs.js#L45)) | Enqueue generation; **409 `has-published-books`** if the pass already has published books ([:59-65](../server/src/routes/admin/turfs.js#L59-L65)) — Discard is the path to re-cut. Skips fully-voted doors. Passes `params` straight through, so **`params.excludeRestricted`** reaches `generateTurf` and skips `status:'restricted'` doors for that cut (the "Exclude restricted-access homes" toggle; default on when any exist). |
| `POST .../turfs/accept` ([:99](../server/src/routes/admin/turfs.js#L99)) | Draft → published for the pass. |
| `POST .../turfs/add-supplemental` | **Non-destructive add, ENQUEUED** (`202 { jobId }`; poll `/jobs/:jobId`; **503 `queue-unavailable`** when Redis is unreachable). The old inline run outlived Heroku's 30s router timeout at 26.5k doors (client saw a bare 503 while the books appeared anyway — 2026-08 incident). The job cuts the pass's currently-unassigned households (`turfId:null`, same base filter as generation) into new **draft** book(s) via `geometricCut`, mirrors `turfId`/`walkOrder`, `recomputePassTerritories`. Works on an active/published pass (unlike `/generate`). Body `{ passId, name?, maxDoors?, excludeRestricted? }` (`excludeRestricted` adds `status: { $ne: 'restricted' }` to the base filter); the result `{ added, bookCount, bookIds }` — including `added: 0` — lands in the job's `returnvalue`. The route does an advisory `recutLock` pre-check (immediate 409); the **binding** acquire/renew/release happens inside the job ([turfProcessor.js](../server/src/services/turf/turfProcessor.js)). **Target-aware:** when `Pass.targetFilter` is active, the candidate set is constrained to `resolveWalkList(campaign, pass.targetFilter)` — exclude branch included — so a supplemental book can never re-introduce doors the target skipped or the exclusion removed. The `GET /turfs?passId=` rollup returns the matching `supplementalDoorCount`/`supplementalRestrictedCount`, which is what the web console's "not in any book" nag renders. Service: `addSupplementalBooks` in [generateTurf.js](../server/src/services/turf/generateTurf.js). |
| `POST .../turfs/discard` | **409 `active-pass-confirm-required`** (with `knockCount`/`assignmentCount`/`isActive`) when the pass is active **or has recorded knocks** and `confirmActive` isn't set — the client's typed-confirm dialog supplies it. Then: snapshot (for undo) → delete the pass's books + assignments + clear household mirror; if the pass was active, revert it to `draft`; optional `clearKnocks` wipes that pass's `CanvassActivity`/`SurveyResponse` (captured in the snapshot). Serialized by `Pass.recutLock`. **`scope: 'drafts'`** wipes ONLY the pass's draft books (`wipeDraftBooks` — the undo for a bad supplemental add): no snapshot, no confirm gate (drafts carry no assignments — both assign routes 409 `not-accepted` — and no **field** history; single-home desk marks may carry a draft book's id as `turfId` provenance only — nothing reads it for counts/undo, and those marks survive the wipe as loose-door marks that count under the door's next book), never reverts a live pass, and `clearKnocks` with it is a 400. The turfs `GET /` also returns `knockCount` for the selected pass (drives the dialog's warning) — and a desk row has a non-null `passId`, so **single-home desk marks count in every pass/effort-keyed "has this been worked?" gate**: this `knockCount` (DiscardModal's "N knocks already recorded" + the typed `discard` / `confirmActive`), the POST /discard 409, the walk-list delete `has-history` ([EFFORTS.md](EFFORTS.md)) and the pass-archive gate. Gates deliberately left as-is (2026-08-21); unmark first. |
| `DELETE .../turfs/:turfId` ([:1630](../server/src/routes/admin/turfs.js#L1630)) | Delete a **single DRAFT book** (surgical cleanup — e.g. one unwanted supplemental book) — or an **accepted book a bulk move has EMPTIED**: a published book deletes iff it holds **zero members**, probed live off `householdIds` (`$slice: 1`), never the denormalized `doorCount` (with no doors there is no field history to strand; its dead-weight `TurfAssignment`s are cleared — this is the "delete the emptied book?" prompt after a lasso move). Clears the household mirror and deletes the doc. Never touches `CanvassActivity` — a single-home desk mark made while the door sat in this draft keeps its row and counts under the door's next book. **409 `not-draft`** for every other accepted book (Discard is their only removal path) and for archived stubs. Brief `recutLock` hold so a supplemental/claim job can't race the delete. **No re-tessellation** — removing a book's doors only grows the neighbors' Voronoi entitlement, so every stored shape stays disjoint and containing. |
| `POST .../turfs/restore-snapshot` | Re-create books + assignments from a snapshot (blocked if live books exist; does not auto-reactivate the pass). |
| `POST .../turfs/move-door` `{ householdId, fromTurfId?, toTurfId }` ([:1358](../server/src/routes/admin/turfs.js#L1358)) | Move one door between books in the same pass. Pulls it from its current book, pushes into `toTurfId`, `recomputeTurf` on both (re-mirrors `Household.turfId`/`walkOrder`) + `recomputePassTerritories`. **409** if the door's `effortId` ≠ the target book's effort (disjointness). Does **not** touch `CanvassActivity`. Body ids are tagged as `AccessLog` subjects (they bypass the `:householdId` param hook). |
| `POST .../turfs/move-doors` `{ householdIds[] (1–1000), toTurfId? \| newBook: { passId, name? } }` ([:1412](../server/src/routes/admin/turfs.js#L1412)) | Bulk move — every unit of a building, or the web lasso's whole selection. **Exactly one target**: an existing book (`toTurfId`, archived stubs 404) or a **new book** made from the moved doors (`newBook`; `mode:'manual'`, name defaulting to `New book`, **born `published` iff the pass already has a published book** — the born-live rule — else `draft`). Pulls the ids out of every other book in the pass, appends/creates, one `recomputeTurf` per changed book + one `recomputePassTerritories`. Guards: same effort 409; **409 `pass-archived`**; ids are capped 1–1000 via `parseHouseholdIds` (refused WHOLE over cap, same rationale as restrict-doors) and **verified against the campaign** — a foreign campaign's id silently drops, so `recomputeTurf`'s unscoped mirror write can never touch another tenant (all-foreign → 404). Response (additive): `to` gains `name`/`status`/`created`; **`from[]`** lists every donor that lost doors as `{ id, name, doorCount, emptied }` — the client's "delete the emptied book?" prompt reads `emptied`; **nothing is deleted server-side**. Body ids tagged as `AccessLog` subjects. Pinned by `moveDoorsBulk.int.test.js`. |
| `POST .../turfs/merge` `{ turfIds[], primaryTurfId? }` ([:1517](../server/src/routes/admin/turfs.js#L1517)) | Merge ≥2 books of the **same pass** into one survivor. **`primaryTurfId`** (additive, must be one of `turfIds` else 400) names the survivor — the "move these books into that one" flow; omitted, survivor = `turfs[0]` = **DB order of the `$in`, not request order** (fine when any survivor will do — the panel's plain Merge). Archived stubs are excluded from the `$in` (their stale `householdIds` would steal doors from live books). Union the doors onto the survivor; **fold assignments** (`findOneAndUpdate` upsert on `{turfId:survivor, userId}` → same-user dedups, different-users **both survive**); **hard-delete** the absorbed `Turf`s + their `TurfAssignment`s; `recomputeTurf`/`recomputePassTerritories`. **No snapshot → irreversible.** |
| `POST .../turfs/:turfId/split` `{ householdIds[], name? }` ([:970](../server/src/routes/admin/turfs.js#L970)) | Peel `householdIds` out of the book into a **new** `Turf` (same pass/mode/params, `status` copied). `recomputeTurf` on both. **Creates no `TurfAssignment`** — the split-off book comes out unassigned. |
| `POST .../turfs/unassign-bulk` `{ turfIds[], userIds[] }` ([:170](../server/src/routes/admin/turfs.js#L170)) | Campaign-scoped `TurfAssignment.deleteMany` for the given (book, user) pairs — powers both "unassign everywhere" (one person, many books) and "Unassign all" (everyone on the selected books). Touches no `Household`, no `CampaignAssignment` and no `CanvassActivity`. **Both arrays are required**: empty `userIds` is a **400**, never an "everyone" wildcard, so callers enumerate — and because `turfIds` alone pins the blast radius (re-scoped by campaign, then a turf × user cross-product delete), the clients deliberately send the **pass-wide** user set rather than a possibly-stale per-selection union. `deleted` counts **pairs**, not people. Guards + blast radius: `server/test/unassignBulk.int.test.js`. |
| `POST .../turfs/restrict-bulk` `{ turfIds[], scope? }` | **Book-level desk mark.** 409 `not-accepted` if any book is a draft. Per book, `planDeskRestrict` ([services/canvass/deskRestrict.js](../server/src/services/canvass/deskRestrict.js) — the ONE desk-mark writer, shared with `restrict-doors`) builds one `CanvassActivity { actionType:'restricted', via:'bulk' }` row per eligible door (`KNOCKABLE_DOOR_FILTER` + coords; the acting admin as `userId`, `coordinatorId:null`, the house's own pin with `accuracy:null` / `distanceFromHouseMeters:0`, `passId` = the book's round, `turfId` = the book as provenance, `effortId` from the door), skipping `completed` (surveyed / lit_dropped this round), `alreadyRestricted`, `ineligible`, and — under `scope:'unknocked'` — `reached`; `scope:'incomplete'` (the default) marks reached doors too, leaving the field row in place. One `commitDeskRestrict`: `insertMany` → `recomputeHouseholdStatusesBatched` ([status.js](../server/src/services/canvass/status.js) — 500-door chunks, 2 round trips per chunk and one `bulkWrite`, not the per-document `…ByIds`: a map lasso hands this 1,000 doors in one request and serial saves sat at the edge of Heroku's 30 s router timeout; same answer, since `resolveStatus` is pure and `Household` declares no save hooks) → `Household.updateMany $set lastActionAt` (the delta-poll touch — a recomputed status can be unchanged, e.g. a door restricted in a PRIOR pass, and `/mobile/changes` filters on `updatedAt`; `lastActionBy` deliberately NOT set) → `recomputeCampaignStats`. Ignores `Campaign.disabledOutcomes`. → `{ marked, skipped:{ completed, alreadyRestricted, ineligible, reached }, perTurf }`. Pinned by [bulkRestrict.int.test.js](../server/test/bulkRestrict.int.test.js) / [bulkRestrictScope.int.test.js](../server/test/bulkRestrictScope.int.test.js). |
| `POST .../turfs/unrestrict-bulk` `{ turfIds[] }` | One `removeDeskRestrict` call whose filter is the `$or` of each book's `deskMarkFilterForBook(turf)` (a plain filter for one book) = delete `{ campaignId, passId: turf.passId, householdId: { $in: turf.householdIds }, actionType:'restricted', via:'bulk' }` per book → one recompute of statuses → `$currentDate updatedAt` → `recomputeCampaignStats` (one delete across the books, so `households` stays a DISTINCT door count across books and the recompute/stats pass runs once). **Re-keyed by `(passId, current book membership)`, not the stamped `turfId`** (2026-08-21): a single-home mark written while the book was a draft points at a `turfId` that dies on re-cut/discard, `move-door` leaves rows on the old book, snapshot restore and merge mint fresh ids — under `turfId` keying all of those marks vanished from the count and the undo; keyed by membership, a desk mark on a door in Book 4 counts under — and falls to — Book 4's Unmark whenever it was made. `GET /turfs` `bulkRestrictedCount` comes from one aggregate (`deskMarkCountsForPasses` — bounded by `{ campaignId, passId ∈ the non-archived books' rounds }`, not a 250k-id `$in`) grouped by `{passId, householdId}`, `n` summed over each non-archived book's `householdIds` (`countDeskMarksByBook`; archived books → 0); `GET /:turfId/households` `turf.bulkRestrictedCount` comes from **the same primitive** since 2026-08-24 (it was a second `countDocuments` implementation of "same keying as `GET /`", held together only by a comment, and it could not see superseded marks at all). **Counts are ROWS everywhere** (`$sum:1` / `countDocuments` / `deletedCount`): two desk rows on one (pass, door) are reachable (mark → canvasser knock → mark again; two admins racing; no unique index), and an **inert** desk row under a newer field knock stays on file — in `Unmark (N)`, `activityCount`, exports — until a book-level undo, same as bulk re-runs. **`bulkRestrictedSupersededCount`** (additive, 2026-08-24) names that inert subset — desk rows whose round no longer resolves to `restricted` — so the book chip can explain why its number exceeds the map's slate doors **without** re-defining `bulkRestrictedCount`, which must keep equalling what the delete removes (the confirm's "N marks will be removed" reconciles with the toast's `deletedCount`). Built by `deskMarkStateForPasses` = `deskMarkCountsForPasses` + one `getPassStatusMapMulti` over **only the doors that have desk rows**; above `DESK_MARK_STATE_MAX` (20 000 (pass, door) pairs) the status half is skipped and the field is **OMITTED**, never sent as a wrong `0`. → `{ unmarked (rows), households (distinct doors) }`. Field rows never match. **No new index** — the filters ride `{campaignId, passId, householdId}` + `actionType_1`. Behavior change pinned by the move-door case in `bulkRestrict.int.test.js`. |
| `POST .../turfs/restrict-doors` `{ householdIds[] (1–1000), passId?, scope? }` | **Door-level desk mark** — one home, every unit at one pin, or a whole lassoed map selection (the web "Select doors" mode; mobile still sends exactly one id and no `scope`). Same row, same writer, same skip ladder, **no draft refusal** (allowed on draft books, accepted books and loose doors alike) and no `disabledOutcomes` check. **`passId` resolution** when omitted: the door's own effort's **active** round (`activePassIdForEffort`) → else the effort's **single** non-archived (draft) round → else `400 { code:'PASS_REQUIRED', unresolved:[{ id, reason:'intake' \| 'no-round' }] }` (all-or-nothing). An explicit `passId` must belong to the campaign (**404**) and must not be archived (**409 `pass-archived`** — phones only receive active-pass books, so an archived-round mark would flip global status while invisible to every canvasser). **Intake doors (`effortId:null`) can never be marked** — `Pass.effortId` is required, so no round can own them (reason `'intake'`, short-circuited before any query). A door whose `effortId` ≠ the pass's effort is `skipped.ineligible`. **`scope`** (added 2026-08-22 for the map selection, parsed by the identical line `restrict-bulk` uses — `req.body?.scope === 'unknocked' ? 'unknocked' : 'incomplete'`): omitted, null, unknown (`'sideways'`) and the literal `'incomplete'` all mean **`'incomplete'`**, i.e. byte-for-byte what this route did before the param existed, so no shipped client had to change; only the exact string `'unknocked'` switches ladders, marking the never-touched doors and leaving each **reached** door alone (no desk row, per-round status and field row intact) in `skipped.reached`. The ladder itself is unchanged — `planDeskRestrict` always understood both scopes; the route simply stopped hard-coding one. `turfId` on the row = the door's book in that pass at write time (draft or published; `null` for a loose dot) — **provenance only**, nothing reads it for counts/undo. Desk rows always carry a non-null `passId` (the module throws otherwise — `getPassStatusMap` matches `passId` exactly, so a null-pass row would flip global status but be invisible on every phone) and only ever `actionType:'restricted'` (a `via:'bulk'` row on a KNOCK action is contractually billable — `knocksByPass.int.test.js`). → `{ marked, skipped:{ completed, alreadyRestricted, ineligible, reached }, passId, passIds }` — **shape unchanged**; `reached` (always 0 from this route before) now carries a real count under `scope:'unknocked'`, and a client that ignores it is unaffected. Archived campaign → 409 (router-wide). Tagged as an `AccessLog` subject per door. **One request, cap 1,000, never chunked** — the batch is refused WHOLE over the cap, never truncated (neither map payload is sorted, so "the first 1,000" would be an arbitrary, unrepeatable subset), and chunking would pay `recomputeCampaignStats`' whole-ledger recompute once per chunk; cost is otherwise fixed + O(pass groups), ~3 queries per walk list in the per-pass-group loop. Pinned by [restrictDoors.int.test.js](../server/test/restrictDoors.int.test.js) (19–20 the two scopes, 21 the default parse, 22 the 1000/1001 cap). |
| `POST .../turfs/unrestrict-doors` `{ householdIds[], passId? }` | One `removeDeskRestrict` call over the `$or` of per-round filters `{ passId, householdId:{ $in } }` (a plain filter for one round) — **no knockable filter, no effort guard, no pass-status and no pass-existence check**: it deletes for whatever `passId` the client sends (the mark's own round, from `/activity`), so a mark whose draft round was later deleted or whose door was re-housed can always be removed. Omitted `passId` → the same resolution as mark. Field rows never match (`unmarked:0`, door stays restricted). **Takes no `scope` and ignores one if sent.** Because of the missing guards, an unmark payload must be filtered differently from a mark payload: drop only `effortId === null` (Intake) doors, and only when no `passId` is sent — a door desk-marked in March and excluded from books in April is still unmarkable today, and filtering it out on the knockable rule would strand its mark forever. → `{ unmarked, households, passId, passIds }`. The clients' **Unmark** is offered only for a desk mark (`via:'bulk'` on the round's latest entry); a field-recorded Restricted shows who/when and no desk action. |
| `GET .../turfs/doors?passId=&withStatus=1` | The effort's knockable doors with coordinates, each tagged with its book (`turfId`) or `null`. **`withStatus=1`** (opt-in) adds **`passStatus`** — the door's status *for this round*, from `getPassStatusMap`. Distinct from the always-present `status`, which is `Household.status` (latest across **all** rounds). Opt-in because the mobile assign map (`slim=1`) colors by book and would pay an aggregate + a string per door across a 16k-door effort for nothing. Drives **dot color only, never a count**. **`format=geojson`** (additive — without it the response is byte-identical) returns the same doors as a `FeatureCollection`, for the mobile Books map's file-backed `ShapeSource` (see [ADMIN_APP.md](ADMIN_APP.md) → *The Books screen*). |
| `GET .../turfs/progress?passId=` | **The single count oracle for the cut page.** Per book: `{ turfId, total, knocked, statusCounts }` over eligible doors (`KNOCKABLE_DOOR_FILTER`), from one `getPassStatusMap` sliced per turf. `statusCounts` (via `statusCountsFromMap`) sums to `total` by construction, and Σ over books is the round total — so the book status chips, the map labels, the completion tint and the coverage bar cannot drift apart. `passStatus` above resolves from the same map over the same pass, so a dot's color can't contradict what it contributes. Also read by the mobile books screen, which ignores `statusCounts`. |
| `GET .../turfs/household/:householdId` | One door's address + members for the map popup. **Record-level audited**: a `router.param('householdId')` hook tags the household as an `AccessLog` subject, matching `/admin/households` and `/admin/voters` (this router previously had none). The popup's *round* detail — status/who/when and survey answers — comes from `/admin/households/:householdId/{activity,surveys}` instead, which are already lead-accessible, campaign-gated and subject-tagged. **Since 2026-08-22 the household object also carries `location` (`{ lng, lat }` \| null), `coordSource`, `coordConfidence` and `correctedAt`** (each `\|\| null`) — additive, so the mobile book map's call is unaffected — which is what the Turf Cutting popup's *Pin corrected · Aug 22* / *Approximate location* line and its **Move pin →** action read (the move itself is the existing `PATCH /admin/campaigns/:campaignId/households/:householdId/location`, §G). |

## D. Why new households are unassigned after import

CSV import upserts households on `{campaignId, normalizedAddress}`
([csvImporter.js](../server/src/services/import/csvImporter.js)); the post-import processor
([importProcessor.js](../server/src/services/import/importProcessor.js)) recomputes cut attributes and
early-voting flags but performs **no walk-list or book assignment**. New households therefore carry
`effortId: null` (**Intake** — owned by no walk list; [EFFORTS.md](EFFORTS.md)) and `turfId: null`.
Every cut's base filter is `{ effortId: pass.effortId, … }` (§B), so a new address is invisible to
canvassers — and unreachable by any recut or supplemental book — until it's claimed into a walk
list and a (re)cut assigns it. See the Part 1 scenario.

## E. Aggregation: pass-aware vs campaign-wide

| Concern | Pass-aware? | Where |
|---|---|---|
| **Knocks** (billable) | **Yes** — grouped by `(householdId, passId)` | `knocksPipeline` in [reports.js](../server/src/routes/admin/reports.js); `CanvassActivity.passId` |
| **Surveys / surveyed voters** | Tagged with `passId`; one survey per `(voterId, passId)` | `SurveyResponse.passId` ([models/SurveyResponse.js](../server/src/models/SurveyResponse.js)) |
| **Overlap detection** | **Yes** — `(householdId, passId)` with 2+ distinct canvassers | `/overlaps` in reports.js |
| **Coverage / homes-knocked** | **No** — current `Household.status`, campaign-wide | `Household.aggregate` in reports.js |
| **Dashboard totals** | Sum **across all** passes (no `passId` filter) | `/overview`, `/campaign-rollup` |
| **`bookId` (turfId)** | **Not used in reporting at all** | books are operational, not accounting |

So recutting or running another pass **adds knocks** (new `(house, pass)` buckets) but leaves
**coverage** unchanged (one house, one status). See the worked example in [METRICS.md](METRICS.md).

## F. Offline pass attribution

A knock submitted offline carries its original timestamp, but pass attribution is no longer
time-based. At submission the server resolves attribution **from the door**: `resolveAttribution`
([routes/mobile/canvass.js:72-82](../server/src/routes/mobile/canvass.js#L72-L82)) finds the
**published book containing the household** among the campaign's currently-active rounds and stamps
that book's `passId`/`turfId` (plus the door owner's `effortId`) on the activity row. `activatedAt`
is still kept monotonic and preserved across recuts (per-round reporting depends on its half-open
windows — [Pass.js:45](../server/src/models/Pass.js#L45)), and archived passes still own their
historical knocks because activity rows keep their original `passId`.

## G. Post-cut book edits & field-app propagation

The move/merge/split routes in §C are **pure book-membership operations**: they rewrite
`Turf.householdIds` and its `Household.turfId`/`walkOrder` mirror (via `recomputeTurf`,
[generateTurf.js:352](../server/src/services/turf/generateTurf.js#L352)), then re-tessellate the pass
(`recomputePassTerritories`, [:393](../server/src/services/turf/generateTurf.js#L393)). **None of them
writes `CanvassActivity`.** That is what makes them count-safe:

- **Knocks key on `(householdId, passId)`, never on a book** — see `CanvassActivity`
  ([models/CanvassActivity.js:26,46-58](../server/src/models/CanvassActivity.js#L26)) and its
  `{passId, householdId}` status indexes. Per-round door status is **derived** from that pair
  (`getPassStatusMap` / `statusesFromDoorPass`, [passStatus.js](../server/src/services/passes/passStatus.js)),
  so a moved/merged/split door keeps its status wherever it lands, and book progress recomputes over
  the new membership.
- **`CanvassActivity.turfId` is a write-only stamp** — set at knock time, **not** re-written by these
  edits, so historical rows keep pointing at the book the door was in when knocked. Harmless: nothing
  in reporting reads it (§E — "`bookId` not used in reporting at all"); book attribution always goes
  through the _live_ `Turf.householdIds`. **Do not** add a report that groups knocks by
  `CanvassActivity.turfId` without back-filling these edits first.

**A pin move is the mirror image: a pure coordinate operation that re-draws, never re-members.**
Every pin correction — web Map page, Turf Cutting popup (house = `scope:'unit'`, building =
`scope:'building'`), mobile admin map, mobile FixPinModal, and the `repair:import-pins` script — goes
through the ONE writer `updateHouseholdLocation`
([services/households/updateHouseholdLocation.js](../server/src/services/households/updateHouseholdLocation.js)),
which, after every coordinate + `HouseholdLocationChange` row is committed, calls
`rehullBooksForMovedHouseholds({ campaignId, householdIds, point })` in
[services/turf/rehullAfterPinMove.js](../server/src/services/turf/rehullAfterPinMove.js) (opt-out
`rehull: false`, which only the repair script uses — it re-hulls its touched passes itself once at the
end of the run). It never touches `Turf.householdIds`, `Household.turfId`/`walkOrder`/`status`, or
`CanvassActivity` (the module must not import it — [AUDIT.md](AUDIT.md) §B.7 stays literally true). Per
call: live passes (`Pass.status ≠ 'archived'` — explicit, because archiving a pass leaves its books
`published`) → the moved doors' own draft/published books per pass (`{passId, householdIds}` index) →
**scale guard first** (Σ `doorCount` over the pass's books; over `TURF_REHULL_INLINE_MAX_DOORS`, default
**60 000**, read at call time → `console.warn('[pin-move] skipped re-hull: pass <id> has N booked
doors')` and that pass is left alone — the fixed cost is the whole-pass `turf.voronoi` move-door already
pays inline, and the guard keeps the PATCH under Heroku's 30 s router on a 250k-door pass; no queue job,
so the pin write never depends on Redis) → neighbour expansion (the pass's other books whose stored
`boundary` contains the new point, §B.1) → `recomputePassTerritories(passId, { onlyTurfIds,
withCentroid: true })`, per-pass try/catch (`console.error('[pin-move] re-hull failed for pass …')`).
**Best-effort by contract**: the service returns `{ updated, turfsRecomputed }` and never throws from the
re-hull, so the pin is corrected even when the outline isn't; both routes —
`PATCH /admin/campaigns/:campaignId/households/:householdId/location` and
`POST /mobile/households/:householdId/location` — ship **`turfsRecomputed: string[]`** (additive) beside
`moved`. A pass over the cap or one whose re-hull failed is healed by `npm run recompute:territories --
--apply`. Concurrency follows move-door/merge/split: no `recutLock`, no 409 — the `$set` is
deterministic from then-current data and a later claim/generate rewrite wins. A loose dot (no book) has
nothing to re-hull. Out of scope by design: a re-import of an **un-corrected** door rewrites `location`
(`csvImporter.js` `$set`) with no re-hull — the outline follows on the next cut / recompute; corrected
doors are shielded from re-import ([IMPORTS.md](IMPORTS.md)). Pinned by
[pinMoveRehull.int.test.js](../server/test/pinMoveRehull.int.test.js) (nudge inside a book; move into a
neighbour's grid → containment + overlap < 1 m²; archived pass untouched; `Turf.find` throwing → pin still
200 with `turfsRecomputed: []`; building scope; the `GET /turfs/household/:id` fields; the mobile route;
the env cap).

**Field-app propagation.** A canvasser's doors are resolved **live** per request from
`TurfAssignment → Turf.householdIds` (`canvasserBooks` / `canvasserScopeWithPasses`,
[canvasserScope.js](../server/src/services/canvass/canvasserScope.js)) in `GET /mobile/bootstrap` — there
is no server-side snapshot, so a full bootstrap always reflects current membership + assignment. But
the app **does not** refetch bootstrap on remount (`staleTime 30s`, `refetchOnMount:false`,
[map.jsx:310-337](../mobile/app/(app)/map.jsx#L310)); between full fetches it relies on the **30s delta**
`GET /mobile/changes` ([map.jsx:489-556](../mobile/app/(app)/map.jsx#L489)), which returns households whose
`updatedAt > since` **within the caller's current scope** and patches only `status` + `location` (pin) +
archival on **already-cached** doors. Voters ride the delta on **two tracks, unioned**
([routes/mobile/bootstrap.js](../server/src/routes/mobile/bootstrap.js)): **(1)** ALL voters of each
changed household — not only docs whose own `updatedAt` moved, because marking a voter voted writes a
`VotedVoter` row, not the Voter doc (the recompute bumps the household, so its door is already in the
delta); **(2)** voters whose **own `updatedAt` moved** — a pure identity edit (admin correction, Person
propagation, re-import reconcile) touches only the Voter doc, never the household, so track 1 alone
would strand it until a cold re-bootstrap. Same cost class either way: index seeks over the
canvasser's own book scope, projected to the bootstrap's identity-cache fields. Consequences:

- **Pin moves & status changes propagate in ~30s** (they bump `Household.updatedAt` and stay in scope).
  The redrawn **outline** is a different story: `Turf.boundary` is never shipped to canvassers (the web
  cut map and the mobile admin Books map re-read it on their next fetch), and the rewritten
  `Turf.centroid` — the canvasser Books-overview marker — rides the bootstrap only, so it moves on the
  next **full** bootstrap, not the delta.
- **Voter identity edits propagate in ~30s too** (track 2) — a corrected name/party reaches phones
  without a pull-to-refresh. (One projection caveat: the delta ships the identity-cache fields only —
  `phone` isn't among them, so a phone-only correction reaches the profile screen live but the cached
  delta copy carries no phone until a full bootstrap.)
- **A move/merge/split is _not_ reflected by the delta**: it never adds a door, never changes book
  membership, and carries no removal signal — so a door that moved _out_ of a canvasser's book lingers
  on their cached map, and one that moved _in_ doesn't appear, until a full bootstrap.
- **A reassignment is invisible to the delta entirely** — `TurfAssignment` writes touch no `Household`,
  so nothing bumps `updatedAt`. The new/losing canvasser updates only on a full bootstrap.
- **Full-bootstrap triggers:** pull-to-refresh (campaigns/stats screens invalidate `['bootstrap']`),
  campaign switch (`clearBootstrap`), a round change detected by the delta (`activePassIds` differs →
  invalidate), or cold start. This is deliberate — a naive refetch-on-mount would revert an optimistic
  recolor — so liveness is "delta + manual refresh," not auto-refetch.

Bottom line: **membership/assignment edits are eventually-consistent on the client, reconciled at the
next full bootstrap; billing stays correct throughout** because it dedups per `(household, pass)` (§E).

## H. Cut-map rendering at scale (building markers + building dots)

Building markers on the Turf Cutting map ([TurfsPage.jsx](../client/src/pages/TurfsPage.jsx)) are
**HTML DOM overlays** (`mapboxgl.Marker`) — they have to be, to render the `5/12 hit` badge. At 107k
doors a campaign can hold ~3,100 stacked-coordinate buildings; creating a DOM node for every one, and
tearing them **all** down on every toggle change, is what made the cut map jank. Two mechanisms fix
it, both in [client/src/lib/buildingMarkers.js](../client/src/lib/buildingMarkers.js) (pure helpers +
unit test):

- **Viewport culling with diff-sync.** Only markers inside the viewport **padded 20% per side**
  exist (`inBoundsWithMargin` — slow pans hit pre-created markers instead of pop-in), re-synced on
  `moveend`. The sync **diffs** the wanted set against what's already on the map (`diffMarkers`,
  keyed by building + a render signature `markerSig(color, badgeText, dimmed, dark)`), so a marker is
  rebuilt only when something it *draws* changed — a toggle flip reuses everything still visible.
- **A stand-down ceiling.** Past `MAX_DOM_MARKERS` (**300**) in view, the DOM layer stands down
  entirely behind the *"N buildings in view — zoom in for building markers"* chip. What keeps every
  building visible and clickable at any zoom is the always-on **`building-dots`** GPU circle layer
  (its own `buildings` GeoJSON source, one book-colored feature per building, drawn slightly larger
  than a door dot); the map's click handler falls through to it, so a building is tappable even with
  no DOM marker, and it honors the book-narrowing chips via a layer filter. **Nothing is clustered
  anywhere** — the dots merge visually when zoomed out and separate when zoomed in, which is the
  honest version of density.

**SUPERSEDED desk marks: `kind` and `deskRows` answer different questions.** A canvasser who works a
desk-marked door wins — designed behavior, pinned by `bulkRestrict.int.test.js`'s *"field re-disposition
overrides a bulk mark"* — and the server does **not** delete the admin's row when they do
([canvass.js](../server/src/routes/mobile/canvass.js) `recordHouseholdAction`'s `deleteMany` is scoped
to `{ userId, householdId, passId }`, the RECORDING canvasser's own id). So the row on disk and the
door's status come apart, and every surface has to report both:

| question | answered by | used for |
|---|---|---|
| Is the door restricted **right now**? | `kind` (`'desk' \| 'field' \| 'none'`) | the status line, the pin color |
| How many rows would the undo **delete**? | `deskRows` / `bulkRestrictedCount` | the button's N, the confirm, the toast |
| Is a row on file that no longer holds? | `superseded` / `bulkRestrictedSupersededCount` | the *no longer in effect* notice |

Before 2026-08-24 the clients collapsed these into `kind` alone: `roundMarkFromEntries` returned `null`
the moment the round held a completion, so the per-door **Unmark** disappeared from all four surfaces
while `bulkRestrictedCount` kept counting the row — the book chip disagreeing with its own status chips.
Three further gates keyed the undo on **status** rather than rows and hid it the same way: the
BuildingPopup (`restrictedN`, [TurfsPage.jsx](../client/src/pages/TurfsPage.jsx)), the selection bar
(`canUnmarkSelection`), and the mobile book sheet — whose `/activity` query was `enabled` only for
`status === 'restricted'`, so no client fix on that screen could have worked. All six now key on rows.
`client/src/lib/restrictMark.js` returns an **object always** (never `null`); `isRestricted(mark)` is the
replacement for the old `!mark` truthiness test, and
[HouseholdDetailPanel.jsx](../client/src/components/HouseholdDetailPanel.jsx)'s `reached` was the one
live site that had it. `mobile/lib/restrictBooks.js` `doorMarkState` gained the same fields, plus the
completion-sticky rule it was missing (a survey anywhere in the round beat a newer restricted row on the
web and the server but not on the phone). Per-door row counts ride two additive fields: `deskMarks` on
`GET /:turfId/households` rows and on `GET /turfs/doors?withStatus=1` doors, both **omitted when zero**.

**`restrictedFrom` — the FIFTH per-round wire field.** `'desk' | 'field' | null`, derived in
`getPassStatusMap` from one `latestVia: { $first: '$via' }` accumulator on the `$sort` the pipeline
already performs (zero extra documents scanned), and carried through `doorStateFromDoorPass` → the
bootstrap, `/changes`, and `toWireHousehold`'s action responses. It powers the canvasser's **Marked
restricted by the office** card. Note `doorStateFromDoorPass` REBUILDS its entry field by field, so
anything added to `getPassStatusMap`'s shape must be named there too or it is silently dropped before it
reaches any wire. The card is deliberately **not** the do-not-contact `Alert` pattern
(`mobile/app/(app)/household/[id].jsx`): that Alert exists because the server refuses the write, and
this has no such refusal by design. Every outcome button stays enabled; `canCanvass` remains the only
gate. Neutral tokens (`colors.sunken`), never the danger palette — red is reserved for the GPS audit,
which makes allegations about a person, and this is a fact about a gate.

**"Select doors": the lasso catches WHAT IS DRAWN.** The desk-restrict selection mode (Part 1) hit-tests
the **door array the page is drawing**, never `queryRenderedFeatures` — a rendered query can't see a door
just off-screen and can't tell a markable door from a completed one. On the cut map that array is
`drawnCutDoors` in [client/src/lib/cutMapDoors.js](../client/src/lib/cutMapDoors.js), because **three** of
this page's visibility mechanisms decide it and two of them live in Mapbox layer state where no memo can
see them: `visibleCutDoors` (this pass's books + the *Not in a book* toggle), the **book-status chips**
(`setFilter` on `doors` by `turfId` — and a loose door's `turfId` property is the empty string, so every
loose dot is hidden the moment any chip is on), and the **Houses** layer's `visibility` (off ⇒ nothing is
selectable at all). The chip filter is applied per **building**, not per door: stacked units are drawn as
one pin whose `turfId` is the first unit's, so a mixed-book stack is drawn — or hidden — as a unit, and
judging each unit on its own `turfId` would let the lasso catch a door whose pin isn't on screen. Pinned by
[cutMapDoors.test.js](../client/src/lib/cutMapDoors.test.js).

The rest of the mode is shared with the admin Map page and lives in
[client/src/lib/lassoSelect.js](../client/src/lib/lassoSelect.js) (`pointInRing` / `ringBBox` /
`doorsInRing` / `snapBuildings` / `applySelection` / `planDoorSelection`, `SELECTION_CAP = 1000`, no
dependencies — the point-in-polygon is a hand-rolled even-odd ray cast, and the `@turf/*` packages under
`client/node_modules` are transitive via `mapbox-gl-draw` and must never be imported),
[client/src/lib/useLassoDraw.js](../client/src/lib/useLassoDraw.js) (the pointer drag and the rubber band),
[DoorSelectionBar.jsx](../client/src/components/DoorSelectionBar.jsx) (the bar, the ≤25 inline confirm and
the `RestrictDoorsModal` typed-`restrict` + scope dialog) and
[MapSelectModeControl.jsx](../client/src/components/MapSelectModeControl.jsx) (the pill and mode panel).
See [MAPS.md](MAPS.md) §K for the shared rules — the drawn-array hit test, the building snap, the
refused-whole cap and the per-page honesty rule.

**Wrong Address** is one of the `KNOCK_ACTIONS` ([aggregations.js:8](../server/src/services/reports/aggregations.js#L8)) —
a real **billable knock that counts as coverage**, non-sticky in `Household.status` (`resolveStatus`
makes only survey/lit sticky, [statusPrecedence.js](../server/src/utils/statusPrecedence.js)). A canvasser
can flag it and drop a note, but **cannot edit the address string or move the pin** — both are
admin/lead data changes.
