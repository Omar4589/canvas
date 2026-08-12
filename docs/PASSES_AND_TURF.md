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

  **Where we hold road data for the area, "close" means close ON FOOT.** Two houses either side of a
  canal can be 150 m apart on the map and 3 km apart along the streets; measuring in straight lines
  put them in the same book and sent a canvasser across a bridge for one door. With road data the cut
  follows real streets instead, and so does the order the doors are walked. It needs no setting and
  no drawing — where we have the data it is simply on, and where we don't the cut behaves exactly as
  it always has. See Part 2 §B.3.
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
**Restricted access** in the field (gated / locked / inaccessible — see [METRICS.md](METRICS.md)), the
home stays in the campaign, fully counted and visible. But when you cut the **next** round, you usually
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
  surfaces share one prompt flow in `mobile/lib/restrictBooks.js`; the reached-inclusive scope always
  takes a second explicit confirm there, mobile's analogue of web's type-"restrict" gate, and every
  mobile request sends its scope explicitly rather than relying on the server default). It's the case
  where only the untouched remainder of a book is gated.
- **`incomplete`** (the request default when `scope` is omitted) — mark **every door not yet done**,
  including the reached-but-unfinished ones. Use when the whole book is inaccessible. On a fully
  untouched book the two scopes are identical.

Both scopes always **skip doors completed this round** (they keep their result) and **already-restricted
doors** (idempotent); field rows are never deleted — a canvasser can still re-disposition any door,
which supersedes the bulk mark. The response's `skipped` breakdown carries `{ completed,
alreadyRestricted, ineligible, reached }` — `reached` counts the doors left alone under `unknocked`.
**Unmark restricted (N)** (`POST .../turfs/unrestrict-bulk`) deletes only the bulk-created rows and
recomputes statuses; field marks survive. Available on web for the whole selection, and on mobile from
the same menus as Mark plus an **Unmark (N)** button on the multi-select bar (so several books' bulk
marks clear in one action there too). Bulk rows are excluded from per-canvasser stats and the GPS
audit — see [METRICS.md](METRICS.md).

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

## Recutting (changing the books)

If you don't like the books, or the underlying voter list changed, you **recut**. Two situations:

- The books are still **drafts** → just generate again; the old drafts are replaced automatically.
- The books are **accepted/published** → you must **Discard** them first, then generate again.
  Discard snapshots the current layout (so it can be undone), removes the books, and — if the pass
  was active — drops it back to **draft** (a live campaign can't be left with an active pass that
  has no books). Then you cut fresh and re-accept.

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

## Editing books after the cut (move a door, merge, split)

Sometimes you don't need a full recut — you just want to reshape a book or two. These edits live in
the books editor on the Turf Cutting page and apply to a pass's **published** books.

> **The rule that makes all of this safe: knocks follow the _door_, not the _book_.** A knock is
> recorded against a household (door) + pass — never against a book — so moving a door to another
> book, merging books, or splitting a book **never changes coverage or billable counts**, and an
> already-knocked door keeps its status wherever it lands. And a **billable knock is one distinct
> (door, pass)**: if two canvassers on the same book knock the same door in the same pass, it bills
> **once** (a new pass counts again). Overlap can never double-bill.

- **Move a door to another book.** Pulls the house out of its current book and into the target,
  re-numbering both books' walk order. A door can only move between books **in the same walk list**
  (walk lists own disjoint doors). You can also move **every unit of one building** at once.
- **Merge two or more books** (same pass) into one. The first book is kept; the others' doors move
  into it and the emptied books are removed. **Assignments are folded in:** if the books were assigned
  to the _same_ person, they stay assigned once; if to _different_ people, **both stay assigned to the
  merged book** — on purpose (you _can_ put two canvassers on one book, and billing won't double-count
  if they overlap). Reassign afterward if you want a single owner.
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

A house pin in the wrong spot can be dragged to its correct location — an admin does it on the web map
(**"Move pin"**), and a **team lead can do it in the field** (**"Fix pin location,"** including "use my
current GPS"). **Canvassers can't move pins** — a correction is a data change with an audit trail, so it
is lead/admin-only ([MAPS.md](MAPS.md)); a canvasser who spots a bad pin tells their lead. Either way it corrects **only the coordinates** (with an audit trail); it does **not**
change the book, the walk order, the door's status, or any count, and it **needs no recut**. Canvassers
see the corrected spot on their **next sync (within ~30s** — see below). Full mechanics:
[MAPS.md → Coordinate provenance & pin correction](MAPS.md). (What you _can't_ do in-app is edit the
address _text_ or re-run geocoding on a single door — the pin drag is the tool.)

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
   knocks. Then **Accept** and **assign** them like any other book. No recut, no archive; canvassers
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
| `Pass` | [models/Pass.js](../server/src/models/Pass.js) | `effortId` (the walk list whose owned doors are the round's universe), `roundNumber` (unique **per walk list**, never reused), `name`, `targetFilter` (optional walk-list-shaped filter for a targeted follow-up round; may carry an `exclude` NOT-branch — see [WALKLISTS.md](WALKLISTS.md) §B), `walkListId` (**deprecated** — null on new rounds; the door-set comes from the effort), `status` (`draft`/`active`/`archived`), `activatedAt` (set on activation; knock attribution is now door→book→walk-list, not this timestamp — see the banner), `archivedAt`, `recutLock{lockedAt,lockedBy}`. Unique index `{effortId, roundNumber}` ([Pass.js:58](../server/src/models/Pass.js#L58)). |
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
   `params.excludeRestricted` is set, the base filter also gets **`status: { $ne: 'restricted' }`**, so
   inaccessible homes are dropped from **that** cut's books (opt-in; non-destructive — the homes are
   untouched in the DB). `addSupplementalBooks` takes the same `excludeRestricted` option.
2. **Cut** by mode: `attributeCut` ([attributeCut.js](../server/src/services/turf/attributeCut.js)) —
   group by a denormalized cut column (precinct/county/city/zip/districts), optional `capN`
   geometric subdivision; `geometricCut` ([geometricCut.js](../server/src/services/turf/geometricCut.js))
   → `balancedKMeans` ([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) —
   **compactness-first** clustering with `maxDoors` as a soft target (§B.1); `manual` — households
   within `params.polygon`.
3. **Wipe prior drafts** ([:72-78](../server/src/services/turf/generateTurf.js#L72-L78)) — delete the
   pass's existing `draft` Turfs + their `TurfAssignment`s and clear the household mirror, so a
   re-run is idempotent. (Published books are *not* touched here — the `/generate` route blocks when
   published books exist; see §C.)
4. **Per book**: compute walk order, centroid, boundary (concave hull → Voronoi-clipped territory),
   insert as `status: 'draft'`, and **mirror** `turfId`/`walkOrder` back onto each household.

The route enqueues this as an async job and returns a `jobId` to poll
([turfs.js `/generate`:45](../server/src/routes/admin/turfs.js#L45), poll at `/jobs/:jobId`).

## B.1 The geometric cut (compactness-first)

> **Metric note.** This section describes the STRAIGHT-LINE cut, which is what runs wherever we hold
> no road data for the area. Where we do, the same capacity/tolerance semantics apply but distance is
> measured along streets by a different algorithm — see **§B.3**.

`balancedKMeans(items, maxDoors, { tolerance = 0.4 })`
([balancedKMeans.js](../server/src/services/turf/balancedKMeans.js)) makes books as **tight and walkable**
as possible, treating `maxDoors` as an **approximate target**, not a hard equal cap. (The old
capacity-balanced cut forced near-equal sizes, which exiled boundary houses into far books — a canvasser
driving across the area for one door.) Everything runs on Hilbert-projected meters and is fully
**deterministic** — but the absence of `Math.random` is only half of why. Seeds are chosen by
**position** in the Hilbert-sorted array and equally-placed doors break ties by **index**, so the
order the doors arrive in reaches book membership. Mongo guarantees no document order, so
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

**Edit-time cost is bounded by `onlyTurfIds`.** `recomputePassTerritories(passId, { onlyTurfIds })`
still seeds the diagram with the whole pass (seams depend on every door) but re-unions only the books
an edit touched (~110ms at 16k doors vs ~1.5s for all 128). Correct because a door *move* doesn't
change the diagram — only cell ownership flips, so untouched books' stored shapes stay exactly right —
and a door *removal* (the effort claim path) only grows the remaining cells, so untouched shapes stay
strictly inside their new entitlement: still disjoint, still containing. `recomputeTurf` writes the
**unclipped** hull and must always be followed by `recomputePassTerritories` — every call site does
(move-door, move-doors, merge, split, and the effort door-claim path in
[efforts.js](../server/src/routes/admin/efforts.js)), each passing the books it changed. Outlines cut
before this change are healed in place by `npm run recompute:territories -- --apply`
(see [OPERATIONS.md](OPERATIONS.md)) — it rewrites only `Turf.boundary`, so it is safe mid-round.

`tolerance` is surfaced on the Turf Cutting page as a **Tight / Balanced / Compact** toggle
(`0.15 / 0.25 / 0.4`; default **Compact = 0.4**), sent through `params.tolerance` (the `/generate` route
passes `params` straight through). Lower → tighter, more even books; higher → more size flex for
compactness. On a synthetic benchmark vs. the old cut, the farthest house from its book center dropped
from ~5 km to ~1 km, and "misplaced" doors (a closer book exists) from ~100 to 0–7. The same engine
powers `geometricSubdivide` (attribute mode, default flex) and `addSupplementalBooks`.

## B.3 The road-aware cut (walking distance)

**The problem.** Straight-line distance cannot see water, because water is the ABSENCE of something.
On barrier-island geography this is not a rounding error. Measured on the real Collier voter file
(`FL-22-Door-Walk-Universe-i360`, 25,942 households): **11% of door pairs within 150 m of each other
are more than 400 m apart on foot**, median detour 1.32×, worst 32×. Concretely, Treasure Ct ↔
Lighthouse Ct on Marco Island are **140 m apart and 2.86 km apart on foot**. The straight-line cut put
pairs like that in one book and the printed route walked between them.

**What was rejected first**, so nobody re-proposes it:

- *Inferring barriers from the door cloud* (prune long edges from a neighbour graph, cluster the
  connected components). Beautiful on invented geometry, dead on real plats: catching every Collier
  canal needs a prune factor below **1.27**, while keeping Golden Gate Estates in one piece needs
  above **1.52**. Empty intersection — a rural street link and a Marco canal crossing are
  geometrically identical. It also collapses on targeted rounds, where thinning the doors drops the
  canal signal from 1.50 to 0.75.
- *Admin-drawn no-cross zones.* Mechanically fine; rejected because Marco Island has dozens of finger
  canals and tracing them by hand is worse than the problem.
- *A routing API (Mapbox Directions/Matrix).* Out on scale (the Matrix API caps at 25 coordinates
  against millions of lookups per cut) and against the written ruling in
  [PRIVACY_VERIFICATION.md](PRIVACY_VERIFICATION.md) that household coordinates do not go in a vendor
  URL.

**What ships.** A road network, held as committed data, with distance measured along it.

| Piece | File | Job |
|---|---|---|
| Shapefile readers | [roads/shapefile.js](../server/src/services/turf/roads/shapefile.js) | Hand-rolled `.shp` (PolyLine) + `.dbf` readers — **no new dependency**. Filters to walkable `MTFCC` classes. |
| Artifact format | [roads/artifact.js](../server/src/services/turf/roads/artifact.js) | Delta-encoded integer micro-degrees. Collier: 2.97 MB as plain floats → **1.15 MB**. A micro-degree is ~11 cm, finer than any geocode we hold. |
| Graph | [roads/graph.js](../server/src/services/turf/roads/graph.js) | Joins disjoint TIGER segments on coincident coordinates (99.2% of Collier lands in one component), subdivides long spans every 25 m, and answers the one query the cut needs — `nearestSources`, ONE multi-source Dijkstra returning each node's M nearest book-centres. |
| The cut | [roads/roadCut.js](../server/src/services/turf/roads/roadCut.js) | Capacity-balanced k-**medoids**. Not k-means: a mean AVERAGES coordinates, and the average of two doors on opposite banks sits in the water, which has no position on a road graph. Centres are real doors. |
| Loader | [roads/loadRoadGraph.js](../server/src/services/turf/roads/loadRoadGraph.js) | Picks artifacts by **door bounding-box overlap** — never `Household.countyValue`, which comes from the import file and defaults to null. LRU-caches the built graph per county set. |

**Source: TIGER/Line ROADS, committed per county** under `server/src/data/roads/{fips}.json`, built
offline by [`fetchCountyRoads.js`](../server/src/utils/roadData/fetchCountyRoads.js) — the same
fetch-offline-commit-the-artifact pattern as `utils/demoData/fetchDemoAddresses.js`. TIGER is a US
federal government work, so it is **public domain**: no attribution, no share-alike. **Nothing hits
the network at cut time**, so census.gov is not a subprocessor and DPA §6 is untouched. (OpenStreetMap
maps these streets in more detail — measured, it finds ~2× the detours TIGER does on the same bounding
box — but carries ODbL share-alike, which is why TIGER is the default.)

**Default ON, opt-out, never fatal.** Dispatch is one line in
[geometricCut.js](../server/src/services/turf/geometricCut.js): `opts.roadGraph ? roadCut : balancedKMeans`.
`params.roadAware === false` turns it off. Every way it can fail to apply — no artifact covers the
doors, too few doors near a street, an unreadable artifact — falls through to the straight-line cut
with a reason recorded on **`Turf.params.road`** and returned by the job, so a book can always explain
its own provenance. A campaign in a county with no artifact behaves **exactly** as it did before.

**Walk order too.** [walkOrder.js](../server/src/services/turf/walkOrder.js) takes an optional
`roadGraph` and injects road distance into the same bounded 2-opt. Fixing the grouping without the
order would leave a book that correctly wraps a canal being *walked* back and forth across it.

**Measured on the real Collier file** (65-door target):

| | books | total spread | worst book | books >1.5 km | walk order |
|---|---|---|---|---|---|
| Marco Island — straight-line | 39 | 83.9 km | 7.16 km | 23/39 | 371.9 km |
| Marco Island — road-aware | 41 | **55.4 km** | **5.64 km** | **12/41** | **238.3 km (−35.9%)** |
| Naples — straight-line | 147 | 603.0 km | 15.39 km | 136/147 | 2,168 km |
| Naples — road-aware | 151 | **337.5 km** | **7.86 km** | **97/151** | **1,383.9 km (−36.2%)** |

**Cost, and the two traps that decide it.** Marco 0.5 s → 4.2 s; Naples 5.7 s → 23 s; all three
counties at once (25,942 doors, 891k-node graph) 88.8 s. Both traps are the same mistake:

1. **Never run an unbounded shortest-path sweep for a local question.** Refining one book's medoid or
   building its distance matrix only needs its own neighbourhood. Bounding the search to ~4× the
   book's diagonal took a Naples cut from **386 s to 23 s**, and a per-book distance matrix from
   2,537 ms to **53 ms**, with zero unreachable pairs either way.
2. **Never run one sweep per book-centre.** `nearestSources` labels every node with its M nearest
   centres in a single pass; the per-centre version measured 521 s against 1.8 s on the same data.

**Memory is the real ceiling at scale.** The worker runs with `--max-old-space-size=384`. Three
Florida counties peak right at it; Los Angeles County alone peaks at ~525 MB building its graph.
**Clipping road lines to the doors' bounding box before building is required before trusting this
beyond a handful of counties**, and is not implemented yet.

**Not road-aware:** `computeBoundary` / `computeTerritories` (book outlines are display-only, and a
road-aware book that legitimately wraps a canal will draw a shape that spans water), and the
`streetGroupedOrder` alternative in the printed packet — though the *comparison* between it and the
route is now scored with the road metric. See [WALK_PACKETS.md](WALK_PACKETS.md).

## C. Lifecycle & routes

**Passes** ([passes.js](../server/src/routes/admin/passes.js)):

| Route | Behavior |
|---|---|
| `POST /campaigns/:campaignId/passes` | Create a round **within a walk list**: body `{ effortId, name? }` — `effortId` required (400 without; 404 if not this campaign's), blank `name` auto-labels "Pass {roundNumber}". `roundNumber` auto-increments **per walk list** (`createNextPass`; 409 if a number can't be allocated); starts `draft`. |
| `POST /passes/:id/activate` ([:111](../server/src/routes/admin/passes.js#L111)) | 409 if archived ([:115-116](../server/src/routes/admin/passes.js#L115-L116)); 400 if no published books; **archives other active rounds of the same walk list only** ([:127-132](../server/src/routes/admin/passes.js#L127-L132)) — other walk lists keep their active rounds; sets `activatedAt` once ([:134](../server/src/routes/admin/passes.js#L134)). No campaign-level pointer is written — active rounds are **derived** (see the data-model table). |
| `POST /passes/:id/archive` | **409 `archive-confirm-required`** `{ knockCount, isActive }` when the round is active **or** has knocks and `confirmArchive` isn't set (one-way + canvassers lose it — knocks kept). Else archive (`status:'archived'` + `archivedAt`, [:163-164](../server/src/routes/admin/passes.js#L163-L164)). |
| `GET /campaigns/:campaignId/passes` | Each pass row carries `turfCount` **and `knockCount`** (distinct `(household, pass)` over `KNOCK_ACTIONS`) for the Passes page. |
| `GET /admin/households/:householdId/activity` | A door's `CanvassActivity` + `SurveyResponse` across all rounds, grouped by round (`{ rounds: [{ passId, roundNumber, name, entries }] }`) — powers the door-detail "History by round". |
| `DELETE /passes/:id` ([:145](../server/src/routes/admin/passes.js#L145)) | Draft-only. |

**Books / turf** ([turfs.js](../server/src/routes/admin/turfs.js)):

| Route | Behavior |
|---|---|
| `GET .../turfs/attribute-preview?passId=&attribute=` | Group-sizes preview for attribute mode: knockable doors per `ATTR_COLUMN[attribute]` group (same cut base filter), `{ groups: [{ name, doorCount }] }` desc. |
| `POST .../turfs/manual-preview` `{ passId, polygons }` | Per-area preview for manual mode: cuttable houses (`$geoWithin`, same cut base filter) + their `Voter` count inside each drawn polygon → `{ areas: [{ doorCount, voterCount }] }` index-aligned. Manual `generate` takes `params.polygons[]` (one book each) + optional `subCutN` (geometric split of big areas). **Overlap dedup is first-area-wins** in both the preview and the cut (a `claimed` Set across the polygon loop), so a house is never double-assigned/double-counted. |
| `POST .../turfs/assign-bulk` | Bulk-assign selected books to selected people. `mode`: `distribute` (round-robin, even **books**), `balance` (greedy by eligible door count, even **doors**), `everyone` (all on all); `replace` clears existing first. **409 `not-accepted`** if any selected book is still a draft (per-book `POST /:turfId/assignments` enforces the same). |
| `POST .../turfs/exclude-apartments` `{ passId, threshold }` | Group the effort's doors by rounded geocode; set `Household.excludedFromTurf:true` on members of clusters ≥ threshold → they skip cutting/book-counts/packets/canvasser everywhere via `KNOCKABLE_DOOR_FILTER` (mirrors `fullyVoted`), but **stay on the admin map**, which surfaces them as a count + Show/Dim/Hide toggle ([MAPS.md](MAPS.md) §I). The read is UNSCOPED, so exclusion is campaign-wide and provenance-free — the stamp records no effort/pass/actor. `POST .../turfs/include-apartments` clears it, but only for the doors the **named effort currently owns**: a door returned to Intake (`effortId: null`) can't be reached by any endpoint, since `Pass.effortId` is required. |
| `POST .../turfs/generate` ([:45](../server/src/routes/admin/turfs.js#L45)) | Enqueue generation; **409 `has-published-books`** if the pass already has published books ([:59-65](../server/src/routes/admin/turfs.js#L59-L65)) — Discard is the path to re-cut. Skips fully-voted doors. Passes `params` straight through, so **`params.excludeRestricted`** reaches `generateTurf` and skips `status:'restricted'` doors for that cut (the "Exclude restricted-access homes" toggle; default on when any exist). |
| `POST .../turfs/accept` ([:99](../server/src/routes/admin/turfs.js#L99)) | Draft → published for the pass. |
| `POST .../turfs/add-supplemental` | **Non-destructive add.** Cut the pass's currently-unassigned households (`turfId:null`, same base filter as generation) into new **draft** book(s) via `geometricCut`, mirror `turfId`/`walkOrder`, `recomputePassTerritories`. Works on an active/published pass (unlike `/generate`); serialized by `Pass.recutLock`. New books then use Accept + Assign. Body `{ passId, name?, maxDoors?, excludeRestricted? }` (`excludeRestricted` adds `status: { $ne: 'restricted' }` to the base filter) → `{ added, bookCount, bookIds }`. **Target-aware:** when `Pass.targetFilter` is active, the candidate set is constrained to `resolveWalkList(campaign, pass.targetFilter)` — exclude branch included — so a supplemental book can never re-introduce doors the target skipped or the exclusion removed. The `GET /turfs?passId=` rollup returns the matching `supplementalDoorCount`/`supplementalRestrictedCount`, which is what the web console's "not in any book" nag renders. Service: `addSupplementalBooks` in [generateTurf.js](../server/src/services/turf/generateTurf.js). |
| `POST .../turfs/discard` | **409 `active-pass-confirm-required`** (with `knockCount`/`assignmentCount`/`isActive`) when the pass is active **or has recorded knocks** and `confirmActive` isn't set — the client's typed-confirm dialog supplies it. Then: snapshot (for undo) → delete the pass's books + assignments + clear household mirror; if the pass was active, revert it to `draft` ([turfs.js:366-372](../server/src/routes/admin/turfs.js#L366-L372)); optional `clearKnocks` wipes that pass's `CanvassActivity`/`SurveyResponse` (captured in the snapshot). Serialized by `Pass.recutLock`. The turfs `GET /` also returns `knockCount` for the selected pass (drives the dialog's warning). |
| `POST .../turfs/restore-snapshot` | Re-create books + assignments from a snapshot (blocked if live books exist; does not auto-reactivate the pass). |
| `POST .../turfs/move-door` `{ householdId, fromTurfId?, toTurfId }` ([:851](../server/src/routes/admin/turfs.js#L851)) | Move one door between books in the same pass. Pulls it from its current book, pushes into `toTurfId`, `recomputeTurf` on both (re-mirrors `Household.turfId`/`walkOrder`) + `recomputePassTerritories`. **409** if the door's `effortId` ≠ the target book's effort (disjointness). Does **not** touch `CanvassActivity`. |
| `POST .../turfs/move-doors` `{ householdIds[], toTurfId }` ([:892](../server/src/routes/admin/turfs.js#L892)) | Bulk move (e.g. every unit of a building) — pulls the ids out of every other book in the pass, adds to `toTurfId`, one `recomputeTurf`/`recomputePassTerritories`. Same effort guard. |
| `POST .../turfs/merge` `{ turfIds[] }` ([:930](../server/src/routes/admin/turfs.js#L930)) | Merge ≥2 books of the **same pass** into `turfs[0]` (survivor). Union the doors onto the survivor; **fold assignments** (`findOneAndUpdate` upsert on `{turfId:survivor, userId}` → same-user dedups, different-users **both survive**); **hard-delete** the absorbed `Turf`s + their `TurfAssignment`s; `recomputeTurf`/`recomputePassTerritories`. **No snapshot → irreversible.** Survivor = DB order of the `$in`, not request order. |
| `POST .../turfs/:turfId/split` `{ householdIds[], name? }` ([:970](../server/src/routes/admin/turfs.js#L970)) | Peel `householdIds` out of the book into a **new** `Turf` (same pass/mode/params, `status` copied). `recomputeTurf` on both. **Creates no `TurfAssignment`** — the split-off book comes out unassigned. |
| `POST .../turfs/unassign-bulk` `{ turfIds[], userIds[] }` ([:170](../server/src/routes/admin/turfs.js#L170)) | Campaign-scoped `TurfAssignment.deleteMany` for the given (book, user) pairs — powers both "unassign everywhere" (one person, many books) and "Unassign all" (everyone on the selected books). Touches no `Household`, no `CampaignAssignment` and no `CanvassActivity`. **Both arrays are required**: empty `userIds` is a **400**, never an "everyone" wildcard, so callers enumerate — and because `turfIds` alone pins the blast radius (re-scoped by campaign, then a turf × user cross-product delete), the clients deliberately send the **pass-wide** user set rather than a possibly-stale per-selection union. `deleted` counts **pairs**, not people. Guards + blast radius: `server/test/unassignBulk.int.test.js`. |
| `GET .../turfs/doors?passId=&withStatus=1` | The effort's knockable doors with coordinates, each tagged with its book (`turfId`) or `null`. **`withStatus=1`** (opt-in) adds **`passStatus`** — the door's status *for this round*, from `getPassStatusMap`. Distinct from the always-present `status`, which is `Household.status` (latest across **all** rounds). Opt-in because the mobile assign map (`slim=1`) colors by book and would pay an aggregate + a string per door across a 16k-door effort for nothing. Drives **dot color only, never a count**. **`format=geojson`** (additive — without it the response is byte-identical) returns the same doors as a `FeatureCollection`, for the mobile Books map's file-backed `ShapeSource` (see [ADMIN_APP.md](ADMIN_APP.md) → *The Books screen*). |
| `GET .../turfs/progress?passId=` | **The single count oracle for the cut page.** Per book: `{ turfId, total, knocked, statusCounts }` over eligible doors (`KNOCKABLE_DOOR_FILTER`), from one `getPassStatusMap` sliced per turf. `statusCounts` (via `statusCountsFromMap`) sums to `total` by construction, and Σ over books is the round total — so the book status chips, the map labels, the completion tint and the coverage bar cannot drift apart. `passStatus` above resolves from the same map over the same pass, so a dot's color can't contradict what it contributes. Also read by the mobile books screen, which ignores `statusCounts`. |
| `GET .../turfs/household/:householdId` | One door's address + members for the map popup. **Record-level audited**: a `router.param('householdId')` hook tags the household as an `AccessLog` subject, matching `/admin/households` and `/admin/voters` (this router previously had none). The popup's *round* detail — status/who/when and survey answers — comes from `/admin/households/:householdId/{activity,surveys}` instead, which are already lead-accessible, campaign-gated and subject-tagged. |

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
[generateTurf.js:245](../server/src/services/turf/generateTurf.js#L245)), then re-tessellate the pass
(`recomputePassTerritories`, [:270](../server/src/services/turf/generateTurf.js#L270)). **None of them
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

**Wrong Address** is one of the `KNOCK_ACTIONS` ([aggregations.js:8](../server/src/services/reports/aggregations.js#L8)) —
a real **billable knock that counts as coverage**, non-sticky in `Household.status` (`resolveStatus`
makes only survey/lit sticky, [statusPrecedence.js](../server/src/utils/statusPrecedence.js)). A canvasser
can flag it and drop a note, but **cannot edit the address string or move the pin** — both are
admin/lead data changes.
