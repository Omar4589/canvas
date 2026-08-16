# Admin app (mobile) — navigation + book assignment

How the mobile app is laid out for an **admin** (and a **super admin** drilled into an org — they use
the same screens). This covers the bottom-tab navigation, the "More" hub, and the **Books** screen for
assigning turf to canvassers. Setup-heavy tools (turf *drawing*, CSV import, survey building) stay on
the web dashboard.

- **Part 1 — For everyone** is plain language: the tabs and what each does.
- **Part 2 — Technical reference** is for developers (and Claude): nav config, the Books screen's data
  flow + endpoints, and the prerequisites.

Related: [CANVASSER_APP.md](CANVASSER_APP.md) (the field app), [PASSES_AND_TURF.md](PASSES_AND_TURF.md)
(rounds + turf/books that this assigns), [EFFORTS.md](EFFORTS.md) (efforts own the rounds),
[METRICS.md](METRICS.md) (the numbers on the Insights/Overview tabs).

The web-dashboard admin tools this doc references for depth: [SURVEYS.md](SURVEYS.md) (the survey
builder — conditional questions, option scripts, "Other (specify)", tags — and the survey report),
[WALKLISTS.md](WALKLISTS.md) (saved searches, by-tag filtering, CSV export), [METRICS.md](METRICS.md)
(the **Refused** door outcome and the **contactRate** / "Reached a person" math).

---

# Part 1 — For everyone

An admin lands on the **bottom-tab** app (super admins get here by tapping an org on the platform
dashboard). Five tabs:

- **Overview** — the org dashboard: active campaigns, cumulative knocks/surveys/connection, coverage.
- **Timeline** — the live per-canvasser dashboard: hourly knock grid, leaderboard tools
  (search/sort/compare/CSV), overlap warnings. (Replaced the old **Insights** tab; its
  leaderboard folded in here.)
- **Map** — live household status + optional canvasser pings.
- **Books** — **assign/unassign books** (turf) to canvassers for the active round (see below).
- **More** — everything else (a hub).

### The Books tab
Pick a **campaign** (and **effort**, if there's more than one — segmented for ≤3, a dropdown at 4+). It
works the effort's **active round** — a read-only **"Pass N · active"** chip under the pickers names it
(custom round names append: "Pass 2 · GOTV sweep · active"), so the silent swap to a newly activated
round is visible; there is deliberately no round switcher (drafts are cut on web, archived rounds are
read-only). Below it, a "Round 1 · 340/600 doors done" line and a "N books · M unassigned" count. A segmented toggle switches between:
- **By book** — books are sorted by name; each row shows doors, a **knocked/total** progress bar, and
  who's assigned. **Tap a book → its map detail** (see below). An **"Unassigned only"** filter finds
  books with nobody. **Select** turns on checkboxes (+ Select all) → a bottom bar **"Assign N books →"**
  opens a canvasser multi-select with **Distribute** (split across people) or **Everyone** (all to each),
  optionally replacing existing assignments. The same bar offers **Unassign all**, which takes every
  canvasser off the selected books in one action so you can hand them to someone else — it appears only
  when somebody actually holds one of them, and confirms first. Nothing is destroyed: every door those
  canvassers knocked still counts, and they stay on the campaign team. Anyone out walking keeps the
  books on their phone until their app reloads the campaign, and anything they record before then still
  counts (see [Changes not showing in the field](../server/src/content/help/faq/changes-not-showing-in-field.md)).
- **By canvasser** — each canvasser shows their book count; tap to expand and give/remove their books.

By-book view also has a **Map** chip: the whole round drawn as book outlines (green = assigned, gray =
not, red = selected) over a neutral dot for every door, so you can see *where* the unassigned turf
actually sits before handing it out. Tap a book to promote it — its own doors color by status and its
sheet offers the same assign actions (and **Mark restricted…**, below). This view stays smooth at any
campaign size — a round of **100k+ doors** renders without freezing the phone, and every door stays an
individual dot (nothing is clustered).

Tapping a book opens a **map detail**: the book's homes color-coded by status (with its outline, framed
to the area), tap a house for its address/status/voters, and assign/unassign canvassers right there.

Only canvassers **assigned to the campaign** can be assigned books (they need the campaign to see
them) — if someone's missing, there's a link to Campaign assignments. Canvassers see changes on their
next sync.

### The campaign screen's Activity group

**Part 1 — For everyone.** Open a campaign and the first thing you see is **Activity** for the date
range you picked — the range is named right under the heading, so a number is never undated. Knocks
leads as the big number; beneath it, one row each for Survey doors, Surveys taken, Voters surveyed, and the
Connection rate. Small grey words under two of them (`houses`, `people`) say what's being counted,
because a house can hold several voters and those two numbers are deliberately different. The
connection rate carries a colored badge and a plain-English verdict — *On target · 986 of 4,136
doors* — so you can check the percentage against the two numbers printed right above it.

Nothing has a little **ⓘ** button any more. Instead there's one line at the bottom of the group,
**How these are counted**, that slides up a panel explaining every number in the group with your
actual figures in it, plus what the rate's colors mean and where the green line sits (20%). A grey
sentence under the group repeats the headline rule without any tapping at all. Coverage and Top
canvassers work the same way.

**Part 2 — Technical reference.** The block is an inset grouped list, not a tile row:
`components/InsetGroup.jsx` exports `InsetGroup` (card + hairlines interleaved *after* the child
list is flattened — a conditional row that renders `false` on a lit-drop campaign is dropped by
`Children.toArray`, so no separator is left stranded), `InsetHeroRow`, `InsetRow`, `InsetActionRow`
and `GroupFooter`. This shape is load-bearing,
not cosmetic: an N-column grid converts a long label into a *narrower column* until it
character-breaks (four tiles across a 375pt phone left **17.25pt** for a label needing 62.51pt, and
the 20pt value overflowed its 53.25pt box too), whereas a row list converts the same overflow into a
*taller row*. Don't reintroduce a multi-column variant.

**Three row kinds, discriminated by the value column** — not by how the tap "feels":

| kind | when | affordance |
|---|---|---|
| `InsetRow` | inert; a number you read | none |
| `InsetNavRow` | the row shows a value another surface owns (a pushed screen) | chevron + press wash |
| `InsetActionRow` | a verb with an **empty** value column (explain, export) | tinted label, never a chevron |

In one sentence: *if the row displays a value that the thing behind it changes, it's
`InsetNavRow`; if it's a verb with an empty value column, it's `InsetActionRow`.* An earlier
version of this doc said data rows never navigate — that described the first two groups
converted, not a rule about the app: a survey answer that drills into the voters who gave it is
a data row that navigates, and with no kind for it, it was forced into a hand-rolled card whose
label truncated. Add a fourth kind only if it is genuinely a fourth *answer* to "what does a tap
here do"; a new visual treatment is not one.

Supporting members that are **not** kinds: `InsetHeroRow` (the group's headline number),
`InsetTitleRow` (an h3 inside the card, for a group that owns its heading — a survey question),
`InsetBlockRow` (a padded slot for a child that isn't a label/value pair, e.g. `CoverageBar`),
`InsetNoteRow` (a one-line loading/error/empty state so a section keeps its silhouette rather
than becoming a different card when the network hiccups), `InsetSwitchRow` (the switch is the
actor; the row isn't pressable), and `RowBar` (a proportional share bar, used as an
`InsetNavRow` `accessory` so it gets full row width — a squeezed proportional bar loses data).

`InsetActionRow` opens `components/MetricSheet.jsx` — a `Modal` bottom sheet. Two things about
it are load-bearing and were each a shipped bug: it wraps its content in its **own**
`GestureHandlerRootView` (a `Modal` is a separate native window, so the app's root one doesn't
reach it and the grabber's pan silently never fires), and the height cap lives on the **sheet**
(`maxHeight: '90%'`), never on the ScrollView. RN already gives every ScrollView
`flexShrink: 1`; capping the scroller instead excludes the grabber and the Done button from the
bound, and leaves the sheet unbounded so it grows past the window instead of the body
scrolling. It must also **not** set `statusBarTranslucent` — that strips `fitsSystemWindows`
off the modal's content frame, so the dialog goes edge-to-edge over the Android nav bar while
`useSafeAreaInsets()` still reports the *activity* window and returns 0.

The screen renders **one** `MetricSheet` fed by `useState`, and both Activity and Top canvassers
open it. Its `items` come from the same `activityMetrics` array the rows render from, so a label
can never sit beside another metric's definition; `help` is `lib/metricHelp.js` verbatim, so no copy
is restated here to drift from the web's. The tier ladder is generated from `RATE_TIERS` in
`lib/rates.js` — the same constant that picks the chip color, so words and color cannot disagree.

Rate tinting is a ~50×22pt chip rather than a flooded tile: a fully-tinted red rectangle reads as a
validation error, not a low rate. Small text on a tint uses `makeRateColors(...).deep`, never `fg`
(`success` on `successBg` is only 3.00:1) — see [THEMING.md](THEMING.md).

### The grammar across the admin screens

The inset-group grammar now spans the campaign screen and the three screens one tap from it, so
the vocabulary holds across a whole journey rather than changing shape at each transition:

- **Overview** (`admin/index.jsx`) — org totals are an inset group with the *same*
  `MetricSheet` affordance the campaign screen uses, so "How these are counted" means the same
  thing at both levels. Each campaign is an `InsetNavRow`: its coverage bar is the row's
  accessory (full width), the mock-GPS nudge is the standard badge, and the connection rate is
  the tier-colored accent. Archived campaigns sit behind an `InsetActionRow` reveal.
- **Canvasser detail** (`admin/canvasser/[id]/index.jsx`) — the "Drill down" tile grid is a menu
  of destinations, so it becomes a group of `InsetNavRow`s. **`Export CSV` is now an
  `InsetActionRow`**: it does not navigate, and as a tile it carried a chevron that lied.
- **Header treatment** — the campaign and canvasser screens stack a back link over a
  `type.title` name (two lines, full width) instead of centering a `type.h3` between two magic
  spacers (`width: 64` and `width: 80`, both deleted); a long campaign name no longer truncates.
  Timeline takes the same left-aligned title without a back link, since it is a tab root.

**The conversion is complete — and it now covers the canvasser drawer too.** Every admin screen
speaks the grammar: More, response-details, Notes, answer-voters, Users (list), GPS audit, Overlaps,
Timeline's scrollable
body (its pinned control chrome — stepper, metric toggle, search/sort — deliberately stays as
controls, not rows; the sort button's sheet is now **"View options"** and also holds the three
secondary tools whose own header row was retired: the **Hide inactive** switch, **Compare
canvassers**, and **Export CSV**. Compare's *exit* lives on the compare bar itself — the bar the
mode puts on screen — and LiveStatus + the tz label sit in the title row, which is what lets the
stepper/metric row fit on one line again), and both canvasser sub-screens (index KPIs/highlights/
quality rows, quality tab). **Three menus that were *claimed* as converted were actually private
forks and are now real** — the super-admin More tab
([super-admin/more.jsx](../mobile/app/(app)/super-admin/more.jsx)) and the canvasser drawer
([CanvasserDrawer.jsx](../mobile/components/CanvasserDrawer.jsx)) each carried a **verbatim copy of
the admin More's old local `Row`**, so a comment saying "matches the admin More exactly" was a claim
about a fork, not about shared code — and it went stale the moment that screen was converted. Both
forks and their ~28 orphaned styles are deleted; all three menus render `InsetGroup` now, so the row
look changes in one file or in none. (`CanvasserDrawer`'s `last` prop went with them: `InsetGroup`
interleaves the separators itself, so a stranded trailing hairline is no longer expressible.)
**`KpiTile`/`KpiGrid` are deleted** — the grid idiom is retired,
because a grid turns every extra character into a narrower column (the label-truncation bug that
started this redesign) while a row list turns the same overflow into a taller row. Specifics
worth knowing:

- The canvasser screen's **team deltas** render as the row's sub-line accent (`▲ 1.4h vs team`,
  `success` when ahead, muted otherwise) — the retired tile's semantics in the row idiom.
  `InsetHeroRow` grew the same `subAccent`/`accentColor` pair so the headline metric keeps its
  delta too.
- **Timeline's KPI group** ends in the same "How these are counted" → `MetricSheet` affordance
  as Overview and the campaign screen — one vocabulary at all three levels. Its roster is one
  group of `bare` `CanvasserCard`s; audit's flag list is one group of `bare`
  `FlaggedEntryCard`s (both cards keep their chrome everywhere else — `map.jsx` renders
  FlaggedEntryCard as a standalone card).
- **Overlaps** (both the Overlaps screen and Timeline's section) collapsed to one summary row
  per house — `N canvassers · M passes · latest ⏱` with a brand-tinted count badge. The
  Overlaps screen's rows navigate to the per-house drill-in; Timeline's stay inert because its
  payload (`computeOverlaps`) isn't the drill-in's shape.
- Retry lives inside the grammar: a failed group is an `InsetNoteRow` (message) followed by an
  `InsetActionRow` ("Try again") — no bespoke retry buttons remain.

### The grammar grew four opt-in members (a menu is not a data list)

Converting the three menus surfaced a real gap: the grammar could express a **list of numbers**
beautifully and a **list of destinations** only flatly. A settings menu wants a heavier label (the row
*is* the content, not a caption on a number), a quiet all-caps section title, and one prominent
identity row at the top. Four additions cover that, **all opt-in and all defaulting to today's
behavior**, so no converted screen moved:

| addition | where | what it does |
|---|---|---|
| `emphasis` | `InsetNavRow` only | a three-step typographic scale: default (a datum you read) · `'menu'` (15/600 labels — the two More tabs, the drawer) · `'hero'` (`type.h3`, taller row, 22pt chevron — the one account row a menu opens with) |
| `leading` | `InsetActionRow` | the glyph slot the other two kinds already had. Without it an action row inside a group of icon rows starts its label **36pt to the left** of every neighbour's — x=16 (the row's padding) against 16 + a 24pt glyph + a 12pt gap = **52**. That jog is what "Sign out" looked like |
| `RowEmoji` | exported from `InsetGroup` | the fixed-24pt glyph box itself, so the three menus can't each re-derive it. The **fixed width** is the whole point: every label in a group starts at the same x |
| `caption` | `SectionHeader` | swaps the `type.h3` title for a small ALL-CAPS caption. A 16pt semibold heading competes with the row labels beneath it when those rows are destinations rather than data |

Two constraints on those, both learned the hard way:

- **`emphasis` is threaded through `InsetNavRow` and nothing else.** It is a typographic weight, not a
  fourth row kind — the tap still answers "navigates", so the three-kinds table above is untouched.
  Confining it to that one kind makes the metric rows on every converted screen *structurally* unable
  to change weight — the property that let three menus be restyled without re-reviewing the rest.
- **`caption` uses `textSecondary`, not `textMuted`.** `type.micro` defaults to `textMuted`, which is
  **2.54:1** — the look this restores originally shipped *with* that bug. Don't "restore" it further;
  see [THEMING.md](THEMING.md).

### The More screens are MENUS again (inside the grammar)

The conversion had flattened the two More tabs and the drawer into what read as data lists: no emoji,
no grey sub-line, `h3` section headings, plain-weight labels, and a bordered `ThemeToggle` nested
inside a bordered card (`sunken` on `card` is 1.10:1 — a second outline buying no separation). All of
that is back, now expressed in the shared vocabulary rather than a local `Row`: `emphasis="menu"` rows
with `RowEmoji` leading glyphs under `caption` headers, the account row as `emphasis="hero"`, and
**`ThemeToggle` standing bare** between its caption and the next group.

Two details a future reader will want to "fix" back, and shouldn't:

- **The three "On the web" rows are `InsetNavRow` BY RULE**, even though they open a modal note rather
  than pushing a screen. The grammar's discriminator is the **value column**, not the destination:
  "CSV import" is a **noun naming a feature** and the row **prints a value** ("Manage on the web")
  that the sheet behind it elaborates — whereas `InsetActionRow` is a **verb with an empty value
  column** ("Export CSV", "Try again"). Classifying them as action rows is what produced three
  chevron-less red lines in a row where a menu section belonged.
- **The account row's fallback label is `name || email || 'Your account'`, never the literal
  `'Account'`.** `user` is `null` until the cache read resolves, so the old fallback spent the first
  frame calling the signed-in person a generic noun.

One dead branch went with the restoration: `admin/more.jsx` was loading memberships and the active org
solely to compute an `isLead` flag that gated nothing (the Users hub is lead-scoped server-side). The
state and both cache reads are gone — the screen now reads only `loadCurrentUser()`.

### The campaign screen's "By pass" card
On a campaign's detail screen, between the Activity group and Coverage, a **By pass** group lists
one row per walk-list pass (walk list name over the pass label, e.g. "Pass 2 · GOTV") with the
pass's knocks in the value column and a "Conn N%" fragment ("Lit N%" on a lit-drop campaign)
tier-colored in the row's sub-line — over the same date range as the Activity group. Keeping the
rate in the sub-line leaves the right-hand column exactly one tabular number per row. The rows are
counted exactly like the web dashboard's **By pass** table, so they always sum to the same Knocks
headline — a footer under the group now says so — and knocks recorded before passes existed show as
a "Legacy / no pass" row. Full counting model + the invoice-ready CSV export (web-only) in
[METRICS.md](METRICS.md).

### One filter row: value-showing chips (2026-08)

The admin screens used to stack their filters as separate scrolling **pill rows** — a
`DateRangeBar` plus one to three `TabSwitcher`s, roughly 40pt each. On the GPS audit that was four
rows, ~165pt of chrome above the first number on a phone. They are now a single row of chips, one
per filter, each labelled with **its current value** and opening a dropdown:

```
[Today ▾] [All walk lists ▾] [All crews ▾]
```

Three things this fixed beyond the height. A chip states what is filtered **at rest** — with pill
rows the active pill could be scrolled off the right edge, so the only way to learn the state was
to swipe. A chip tints (brand tint, not a solid fill — several can be applied at once and three
solid red pills read as an alarm) whenever its selection is not the first, neutral "All …" option.
And it matches the **web console**, which has always used dropdowns in one header row; mobile was
the outlier. The accepted cost is two taps to change a filter instead of one.

One component, [components/FilterBar.jsx](../mobile/components/FilterBar.jsx), owns all of it,
including the custom-range modal (six screens needed identical wiring, and six copies is six
chances to drift). Its open menu renders **below the whole row at full width**, not anchored under
its chip: the row is a horizontal ScrollView and a menu inside it would be clipped, reliably so on
Android. An optional `trailing` slot holds a non-filter control that should share the row — the
audit's `LiveStatus` pill, pinned right outside the scroller so it stays reachable.

Converted: the campaign screen, Timeline, GPS audit, Notes, Duplicate surveys, and a canvasser's
activity + territory-map sub-screens. `DateRangeBar` and `TabSwitcher` both remain for their other
callers (date-only canvasser sub-screens, the Map's control row, Help, Overlaps, answer-voters).

### Scoping a campaign to one walk list

Once a campaign has **two or more walk lists**, a **walk-list chip** — *All walk lists* until you
pick one — appears in the filter row of several admin screens (a single-list campaign shows
nothing; a "Main ·" prefix everywhere would be noise). Where it lives and what it scopes:

- **The campaign screen** — picking a walk list scopes **Activity**, the **By pass** group,
  **Coverage** (its subtitle flips to *All-time walk-list progress*), and **Top canvassers**
  together, so the By-pass rows still reconcile against the Knocks number above them. Picking a walk
  list also clears any selected survey **pass chip**: those chips draw from the (now filtered)
  By-pass rows, so a pass from another walk list would otherwise keep scoping the survey numbers
  with no visible chip saying so.
- **Timeline → a canvasser's profile.** Timeline's own walk-list filter (pre-existing) now
  **follows you into the drill-in**: open a canvasser from a filtered Timeline and the profile, every sub-screen
  (days, single-day detail, activity feed, answers, quality, households, surveys taken, notes, the
  territory map), the CSV export, and **Compare** all stay inside that walk list. The profile's
  "Showing:" line appends *· walk list: North*, Compare appends *· one walk list* to its range line
  — and the **vs-team deltas** on both then compare against the walk list's canvassers, not the
  whole campaign's.
- **GPS audit** — the same chip scopes the KPI totals, the per-canvasser table, and the entries
  list alike ([AUDIT.md](AUDIT.md)).
- **The Map tab** — a **walk-list chip** in the filter row opens a picker. Picking a walk list
  clears any pass/import deep-link scope (a pass belongs to ONE walk list, so a stale pass scope
  would silently zero out the map); with the chip present, the "Scoped to …" row only announces
  pass/import scopes and its ✕ leaves the picked walk list alone ([MAPS.md](MAPS.md)).

One deletion rides along: Timeline's reconciliation footer claiming the coordinator filter wasn't
applied to its overlap totals is gone — the crew filter is applied server-side, so the
reconciliation reflects the full selection (campaign, walk list, range, AND crew).

### Filters live in the FIXED header — a control that can empty a screen is never inside it

**Part 1 — For everyone.** Picking a crew on **Timeline** used to be able to trap you. Pick a crew
that hasn't knocked anything in the range you're looking at, or the **No coordinator** pill, and the
screen emptied — *including the crew row itself*, which was the only thing that could put it back.
The only ways out were switching campaigns or force-quitting the app. And the message left behind
blamed the wrong control: it talked about the walk list and the date range, never mentioning the crew
filter that had actually emptied the screen.

The filters now sit — as one chip row — in the **fixed header**, above everything that can change. They stay put
through an empty result, a first-load error, an invalid date range, and the loading spinner. When a
crew filter is what emptied the screen, the message says so **and names the way out by its on-screen
label** — *"Tap 'All' in the crew row above to see everyone, or pick another range."* The same fix is
in on the **GPS audit**'s by-canvasser row and on the survey answer drill's canvasser filter.

**Part 2 — Technical reference.** The bug is one shape, and it is worth recognizing on sight: **the
control was gated on the very payload it filters.** On
[admin/timeline.jsx](../mobile/app/(app)/admin/timeline.jsx) the crew `TabSwitcher` was gated
`rows.length > 0`, but `rows` **is** the `?coordinatorId`-filtered server response (the crew filter is
applied server-side — it has to be, since the billable door count is deduped by house×round *across*
canvassers). So the act of filtering could unmount the filter. The gate is now
`coordinatorOptions.length > 0 || coordinatorId`: no `rows` term at all, and the `|| coordinatorId`
arm keeps an escape even for a coordinator who has left **both** the ledger and the roster — the one
case `coordinatorOptions` can't cover, since it is built from those two sources. The web console
sidesteps the trap structurally rather than by luck: its picker is fed by a **separate, unfiltered**
query (`/admin/reports/team-breakdown`, which never carries `coordinatorId`), so on web the act of
filtering cannot remove the filter
([client/src/pages/TimelinePage.jsx](../client/src/pages/TimelinePage.jsx)).

The **campaign home** now carries the same crew filter on both platforms, built the same safe way:
web [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) feeds its coordinator `<select>` from
its own campaign-scoped, never-filtered `/team-breakdown` query (so the `ready:false` pre-backfill
gate hides the picker for free), and the mobile campaign screen reuses the Timeline chip strip and
gate verbatim. Every activity surface on the page (Activity KPIs, By pass + its CSV, Survey results
+ drills, the canvasser leaderboard + responses modal) takes the filter server-side; **Coverage
deliberately does not** — doors don't belong to a crew — and its caption says so while a crew is
selected.

Both strips (walk list *and* crew) also moved **out of the `ScrollView`** and above the
`rangeInvalid` / error / loading branches, so no state of the screen can take them away.

**The layout rule that move demands** (it has now bitten four screens — Help center, Books,
Timeline, and Notes when its filters moved up into the header): React Native puts `flexGrow: 1, flexShrink: 1` on *every* `ScrollView`, and a vertical
scroller with no `style` prop keeps `flexBasis: auto` — so its **content height enters the column's
flex base sum**, and once the column overflows, Yoga shares the deficit out *scaled by flexBasis*
across every shrinkable sibling. The 42pt pill strips (also ScrollViews, also shrinkable) got crushed
to ~13pt the moment a date had data, shearing their labels off — while an empty date rendered them
perfectly, which is what made the bug look data-dependent. So: **any vertical `ScrollView` that is a
sibling in a screen's flex column carries `style={{ flex: 1 }}`** (flexBasis 0 → its content height
never enters the base sum → no deficit exists). `TabSwitcher` itself deliberately does **not** set
`flexShrink: 0`: flexShrink is main-axis only, and in row contexts (the canvasser map's control row)
shrinking is load-bearing — the full reasoning lives at the top of
[components/TabSwitcher.jsx](../mobile/components/TabSwitcher.jsx).
**`FilterBar` inherits this contract exactly** — its chip row is a horizontal ScrollView in the same
position, so every screen converted to it carries the same `flex: 1` on its vertical sibling, and
the warning is repeated at the top of that file rather than cross-referenced.

The crew empty-state was **unreachable dead code** for the same reason: it tested
`coordRows.length === 0`, and `const coordRows = rows` — so the generic `rows.length === 0` branch
above it always won, and an emptied screen blamed the walk list or the range. The crew case is now
tested on `coordinatorId` and ordered **first**.

Two sibling fixes, same shape:

- **[admin/audit.jsx](../mobile/app/(app)/admin/audit.jsx)** — the by-canvasser strip is built from a
  `byCanvasser` payload that `?userId` has already filtered, so it could not offer the pill that
  produced it (narrow the range after picking somebody and it came back empty). A **sticky pill**
  fixes it: the picked canvasser's `name` is captured **at pick time** (`pickedName`) and appended to
  `canvasserTabs` whenever the payload no longer carries them, labelled `Name (0)` — and the `0` is
  *true*, they have zero flags in this scope. The strip is gated on `canvasserTabs.length > 1`, which
  by construction always holds while a filter is applied, and it moved into the fixed header beside
  the walk-list strip.
- **[admin/answer-voters.jsx](../mobile/app/(app)/admin/answer-voters.jsx)** — the canvasser
  `FilterChip` is gated `canvasserRows.length > 0 || canvasserId`, so a background refetch that empties
  the rows can't strand the filter.

### The Users list is campaign-scoped, not just campaign-annotated

**Part 1 — For everyone.** On **Users**, picking a campaign used to only *label* people — every member
of the org stayed in one long list, with "assigned" or "not assigned" printed on each row. Now the
question the chip asks ("who is on this campaign?") is the answer you get:

- **On this campaign (N)** — first, expanded.
- **Not on this campaign (N)** — a collapsed section with a **"Show N not on this campaign"** line;
  tap to reveal them, and **Assign all shown** appears *inside* that section, only while it's open.

Search, the role/status filters and the sort all still work across everyone — they just order people
*within* each section. Nobody's visible set changed: a team lead sees exactly the same people as
before, regrouped.

**Part 2 — Technical reference.** [admin/users.jsx](../mobile/app/(app)/admin/users.jsx). Purely
client-side — the roster was already on the client from the assignments query, so there is **no new
request and no server change**, and the visible set is byte-identical (this **narrows** presentation,
never widens access).

- The old code tagged each user with `assigned` and then ran a **stable partition** to float the
  campaign's people. The sections do that job by construction: one pass over the already-sorted
  `visibleUsers` splits it on `rosterByUser.has(id)`, which preserves the chosen sort inside each half
  (the exact property the stable partition existed to protect) and drops an object copy per user per
  render. `visibleUsers`' own memo no longer depends on `cId`/`rosterByUser` at all.
- `userMeta` lost its `'assigned'`/`'not assigned'` words — the section header states it once instead
  of every row restating it, which is the noise that one quiet meta line exists to prevent.
- **Bulk assign moved inside the collapsed section and is gated on it being open.** "Assign all
  shown" must mean a set the reader can actually see; it could previously fire against dozens of
  people who were never on screen. Every row in that section is unassigned **by construction**, so
  the section *is* the predicate and no per-row filter is needed. It stays admin-only (`!isLead`).
- The reveal is an `InsetActionRow`, not a nav row — the same idiom as the archived-campaigns reveal
  on `admin/index.jsx`. One shared `userRow` renderer serves both sections *and* the unscoped org
  view, so a row cannot drift between them; the org view is still one flat list.

### Drilling into a survey answer (campaign screen)
On a campaign's detail screen, the survey results list each answer with its count — **tap a count**
to open the entries behind it. That screen now has a **Voters | By canvasser** toggle (who *recorded*
this answer, ranked, with what share of their own answers it is), a **canvasser filter** pill, rows
showing the exact campaign-time timestamp plus note/Offline badges, and a **View on map** action that
opens the admin Map pre-filtered to the same answer, canvasser, and date window. Tapping an entry
opens the **response detail**, which now shows an *"Edited by …"* line when an admin changed it and a
*"Synced"* line for offline submissions. Same tool as the web **Survey Explorer** — see
[SURVEYS.md](SURVEYS.md) (Part 1 → *Auditing answers*).

### The Map tab's door detail (now at web parity)
Tapping a house on the mobile admin **Map** opens a bottom sheet that now matches the web console's
door panel: the **status + address** header, **Last action**, a **History by pass** list (every round
the door was worked, so a door knocked in Round 1 *and* Round 2 shows both — the survey line names the
voter, and it's **de-duped** so a survey never lists twice), its **voters**, and its **surveys** with
the answers **lazy-loaded** on open (they don't ride the map's live refetch). Two overlap surfaces ride
along, mirroring the web map:
- **A door's ⚠ Overlap badge.** If **more than one canvasser knocked the door in the same pass**, the
  sheet flags it and **names the others** ("Also worked by …") — a turf collision worth a look. This is
  computed straight from the door's own history (no extra fetch), pass-by-pass.
- **An opt-in Overlaps map toggle.** Turn it on and every door worked by 2+ canvassers in the same pass
  gets an **amber ring** beneath its pin — the same pass-wide, day-agnostic set as the web map (it
  catches collisions even across different days). Off by default; **no clustering**, ever.

Filtering the mobile admin map to a **single canvasser** also recolors each door by **that canvasser's
own disposition** (green only where *they* surveyed, etc.), exactly like the web map — see
[MAPS.md](MAPS.md).

### Duplicate surveys — and the one thing you can delete from the phone
**More → Duplicate surveys** lists voters with **more than one survey response** — the reason a
campaign's *Surveys* can read higher than its *Surveyed voters*. It is the voter-unit twin of
Overlaps: one says the same door was knocked twice, this says the same person was surveyed twice.

Each voter starts **collapsed**, showing only what you need to triage: the name, the address, and
the badges — a **count**, plus up to three kinds in severity order: **Same round · overwritten**
(a second canvasser's same-round submit **replaced** the first's answers — the earlier response is
**preserved**, not lost), **Same canvasser · same day** (a double-submit or mis-tap) and
**Different canvassers · later round** (usually a legitimate revisit). A voter can carry more than
one badge when three or more responses are involved. Tap the voter to open who surveyed them, when
and in which round; tap a response for its full detail, or **Open voter** for the profile. An
overwritten (preserved) row shows an **Overwritten** badge and "replaced by {name}"; instead of
Delete it reads **Preserved**, and its response-detail screen carries an admin-only **Restore** —
the lossless swap that makes the earlier answers current again while preserving the ones they
displace ([SURVEYS.md](SURVEYS.md) §F).

Same three filters as the web page — duplicate type, canvasser (departed canvassers included, since
their work is still on the report), dates (opens on **All time**; it's a history report) — and
**Load more** at the bottom.

**An org admin can delete the extra response here**, which is the whole reason the screen earns its
place: on the web the fix path is Open voter → profile → delete, and the mobile voter profile is
read-only, so without an in-place delete the phone would only ever be able to *find* the problem.
Confirming names the canvasser, the round and the time, and says plainly what is lost (the answers,
permanently) and what is not (the knock stays on the timeline, the door still reads surveyed, only
the Surveys total moves). **Team leads see the whole report and no Delete or Restore** — the row
explains why, and the server refuses a lead's delete or restore regardless of what the app shows.

### The campaign chip (how a More screen knows which campaign you mean)

The web console puts the campaign in the address bar. A phone has none, so every campaign-scoped
admin screen — **GPS audit, Notes, Exports, Overlaps, Duplicate surveys, Timeline, Books** and the
**Map** — carries a **campaign chip** at the top instead. Tap it, pick one, and the pick is
**remembered across all of them**: switch campaign on Notes and the Map is on that campaign too.

- **It opens on an active campaign, never an archived one.** With nothing picked yet the chip
  seats you in your first active campaign. That default is deliberately active-only — you are
  never quietly dropped into finished work.
- **Archived campaigns are in the list**, under an **Archived · read-only** divider at the bottom.
  Picking one is a deliberate act, and it's how you read a finished campaign's notes, maps and
  reports from your phone. Before this, the chip hid them entirely — so an org whose campaigns had
  all finished offered nothing to pick, and every one of these screens sat on its empty state with
  no way forward.
- **An archived campaign is read-only, and the screen says so.** An **Archived — read-only** banner
  appears and the actions that would change the field come off: assigning books and turf, the
  Select/bulk bar, the restrict actions, adding or removing people, moving a pin, deleting a
  duplicate survey, restoring a replaced response. That isn't the app being shy — the server
  refuses those writes on an archived campaign, on the web dashboard too (see
  [CAMPAIGNS.md](CAMPAIGNS.md) → *Archive vs. delete*).
- **Exports stay fully enabled**, with a second banner line saying so. An export is a read, and a
  finished race's data still being yours is the whole point of archiving rather than deleting.
  **Reviewing a GPS flag** stays enabled for the same reason — it records a decision about work
  already done.
- **Opening a screen from a campaign's own page scopes it to that campaign.** Every Quick-action
  tile seats the campaign before it navigates, so drilling in and tapping **Notes** gives you
  *that* campaign's notes rather than whichever one the chip was last left on.

### The More hub
It reads as a **settings menu**: your name and email in a prominent row at the very top (it opens the
profile screen), then small all-caps section captions over rows that each carry an icon, a label and
where relevant a grey line of explanation.

- **Manage:** **Users — the one people surface** (all roles incl. team leads, who see it scoped to
  their campaigns): a campaign filter chip splits the list into **On this campaign** and a collapsed
  **Not on this campaign** (above); the old standalone campaign Team screen
  merged in here, so a campaign's "Team" tile lands pre-filtered. Rows open a member sheet —
  campaign KPIs, a **Coordinator dropdown**, recent doors (each taps through to the live map, "See
  all" opens the paged activity screen), temp password, assign/unassign (admins), deactivate/
  reactivate. The Add sheet creates a canvasser straight onto the selected campaign with an optional
  **coordinator** picked at birth. Every screen in this group works the campaign named in its **campaign chip** (above).
**GPS audit** ([AUDIT.md](AUDIT.md)) — defaults to Today, each
  entry has "View on map"; **Notes** — the campaign Notes hub ([NOTES.md](NOTES.md)); **Exports** —
  queues the everyday CSV types with a live row-count preview, and keeps working on an archived
  campaign ([EXPORTS.md](EXPORTS.md));
  **History** — who changed this campaign's settings (the door goal, the key dates, the invoice
  policy, archiving) plus team reassignments, read-only, campaign chip and all
  ([CAMPAIGNS.md](CAMPAIGNS.md) → *Change history*); it is reached from the campaign screen's
  Quick actions rather than the More hub, since it answers a question you have while looking at a
  campaign's numbers;
  **App customization** — which outcome buttons this campaign's canvassers see, a stack of
  switches (the inset grammar's `InsetSwitchRow`, its first use) with an always-available list
  below; reached from the campaign screen's Quick actions like History, edits save on flip, and
  every flip lands in History ([CAMPAIGNS.md](CAMPAIGNS.md) → *Door outcomes*);
  **Overlaps** — now carries the same campaign chip (it used to take the cached pick with no
  picker at all, so an empty cache dead-ended it); entries open a detail screen with a map of the
  house and "Open on live map";
  **Duplicate surveys** — voters with more than one response, where an admin deletes the extra one
  (below; Delete is hidden on an archived campaign); Voter search; Switch to canvass mode.
- **On the web:** CSV import, Early voting, Turf cutting — these open a short note (managed on the web
  dashboard; file uploads / turf drawing aren't mobile-friendly).
- **Support:** Help center.
- **Appearance** — the theme toggle, standing on its own rather than boxed inside a card.
- **Account:** Platform view (super admins), Switch organization, Sign out.

The **super admin**'s own More tab ([super-admin/more.jsx](../mobile/app/(app)/super-admin/more.jsx))
and the **canvasser's slide-out drawer** ([CANVASSER_APP.md](CANVASSER_APP.md)) are the same menu in a
different set of rows — one shared implementation now, not three lookalikes.

---

# Part 1b — On the web dashboard (admin capabilities)

The mobile app above is for in-the-field admin work (assigning books, watching the numbers).
**Setup and analysis live on the web dashboard** — and several of those tools grew capabilities worth
knowing about. The depth lives in the linked docs; here's what an admin can now do and where it shows
up. (Mobile is unchanged by all of this — the survey builder, the survey report, walk lists, and tags
are web-only; the only field-app change is the new **Refused** button covered in
[CANVASSER_APP.md](CANVASSER_APP.md).)

### The survey builder does more than plain questions
On the **Surveys** page, beyond wording/type/required/options, a question can now carry:
- **Conditional display ("Show only if…")** — show a question only when an **earlier** answer matches
  (Match ALL / Match ANY over rules). Branch, skip, and skip-to-end all come from this one control.
- **Read-aloud option scripts** — a per-option line the canvasser sees the moment they pick that
  option (guidance only; doesn't change counts).
- **"Other (specify)"** — a toggle that adds an **Other** choice with a free-text box at the door.
- **Tags** — a short label (e.g. "Supporter") you stick on an answer **option**, via a pick-or-create
  combobox that suggests tags already used in this survey. Tags are **case-insensitive** and group
  options **across questions**, so anyone who picked any tagged option counts once. Tags are
  **admin-only** metadata for reporting and list-building — canvassers never see them.

> These are the same builder features described in full in [SURVEYS.md](SURVEYS.md) (including the now
> much more permissive "edit a survey that already has answers" rules). The only hard block is changing
> a question's **answer type** once it has responses.

### The survey report now rolls up by tag
The campaign's **survey results** (on the campaign dashboard, below the per-question charts) gained a
**Tags** panel: one bar per tag showing **how many distinct voters** carry it (counted once even if
they hit the tag in several questions). Click a tag to see which options feed it and to drill into the
**list of voters** reached. See [SURVEYS.md](SURVEYS.md) §I.

### Saved searches filter by tag and export to CSV
On the **Saved Searches** page (the walk-list builder), the answer-filter panel now has a **By tag**
row: pick "Supporter" and the resulting saved search is **every door with someone who matched that tag
in any question** — a cross-question reach the per-question answer filters can't express. The door
**status** filter also lists **Refused** and **Restricted** alongside the other dispositions. From the Saved Searches
list, **Export CSV** downloads that saved search's voters (Voter ID, name, party, age, phone, precinct,
address) for a re-canvass, phone bank, or mail house. See [WALKLISTS.md](WALKLISTS.md) and
[SURVEYS.md](SURVEYS.md) §I.

### The "Refused" door outcome in admin numbers
On **survey campaigns**, a door can be recorded as **Refused** — someone answered but declined to
participate. It's a **billable knock** and counts as a **contact**, but it is **not** a survey; it sits
in its own amber bucket (color `#F59E0B` everywhere). Where it shows up for an admin:
- **Coverage** — the all-time coverage bar (Overview and each campaign dashboard) has its own amber
  **Refused** segment beside Surveyed / Not home / Wrong address.
- **A new "Reached a person" rate** — `contactRate = (surveyed + refused) ÷ knocks` — measures how
  often a knock reached a live person. It's **separate from** the existing Connection/Survey rate,
  which is unchanged (refusals don't count as surveys there).
- **Per-canvasser CSV** — the leaderboard export gains a **Refused** column.
- **Client reports** — the door-outcome breakdown labels it **"Declined to participate."**

> The Refused metric math (`refusedKnocks`, `contactRate`) and the field-app button live in
> [METRICS.md](METRICS.md) and [CANVASSER_APP.md](CANVASSER_APP.md). The mobile admin Overview/Timeline
> tabs render the coverage bar (so the Refused segment shows there too) but currently surface the rate
> set as Knocks / Surveys / Surveyed voters / Connection rate — the dedicated "Reached a person" card
> is not in that group today. (Contact rate *is* explained in the campaign screen's Top-canvassers
> "How these are counted" sheet, since it's a column there.)

### The "Restricted access" disposition in admin numbers
Available on **all** campaign types (not just survey), a door can be marked **Restricted access** —
the home is inaccessible (gated, locked, no legal access; color slate `#475569`). It's the **inverse of
Refused**: recorded and shown, but deliberately **not a billable knock**. For an admin it appears as its
own slate **Restricted** segment on the coverage bar and as a separate **Restricted** count on the
leaderboard, the canvassers CSV, and the canvasser timeline — but it enters **no** rate and is **not** in
"houses knocked." The Turf Cutting page can also **exclude restricted homes** from a later round's books
(see [PASSES_AND_TURF.md](PASSES_AND_TURF.md)). Full counting model in [METRICS.md](METRICS.md).

**Marking a whole book restricted (gated communities).** On the mobile **Books** screen, Map view's
tapped-book sheet has a **⋯** button beside its ✕ close — opening it shows **Mark book restricted…**
(or **Unmark restricted (N)** once bulk-marked), kept off the roster's scroll path so it can't be
tapped by accident; List view reaches the same action via the **⋯** in the book detail screen's
header. Either **⋯** menu closes by tapping anywhere off it (or re-tapping the **⋯**), and it never
carries over to the next book you open. Select mode's action bar has **Restrict…** for several books at
once — plus **Unmark (N)** when the selection holds bulk marks, clearing them all in one action — and the
web Turf Cutting page has the same actions on the selected-books panel. (The bar stacks its
"N books selected" label above a **wrapping** button row: label + three buttons in one line needed
~451pt on a ~370pt screen, which pushed *Assign to…* off the right edge with no way to reach it. With
**Unassign all** the row is now up to four buttons, so the bar **measures itself** with `onLayout` and
hands the list its real height — `ACTION_BAR_CLEARANCE` is only the starting estimate. Nothing in
`mobile/` disables font scaling, so at large accessibility text every button becomes its own row and no
fixed constant could be right; an under-estimate occludes the last book card.) All three mobile entry points
share one scope-aware flow (`mobile/lib/restrictBooks.js`): when the crew has already reached doors
(not-home / refused / wrong-address) you choose **Only unknocked** (the safe default, listed first) or
**Every unfinished**, which takes a second confirm before it also marks the reached doors — matching the
web modal's default and its type-"restrict" gate. Canvassers see the slate doors immediately, doors
already completed this round keep their result, and **Unmark restricted (N)** reverses it (field-recorded
marks are never touched). Bulk marks never appear in per-canvasser stats or the GPS audit — see
[METRICS.md](METRICS.md).

---

# Part 2 — Technical reference

## Navigation
[app/(app)/admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) is a `Tabs` navigator: visible
tabs `index` (Overview), `timeline` (Timeline), `map`, `books`, `more`;
all detail screens are `href:null` (pushed). **A new file under `(app)/admin/` MUST get its own
`<Tabs.Screen name="…" options={{ href: null }} />` line** — expo-router auto-discovers it, and
without the entry it materializes as a visible tab. (`history` is the most recent addition.) The router gate sends `isConsoleRole(role) || isSuperAdmin`
to `/(app)/admin` — i.e. admins **and team leads** (see [ROLES.md](ROLES.md)) — so super admins share
these screens in-org. `isConsoleRole` lives in [lib/role.js](../mobile/lib/role.js) alongside the
`isOrgAdmin` (unscoped org authority; **excludes** `lead`) vs `isConsoleUser` (may see the admin app;
**includes** `lead`) split. Gate admin *entry points* on `isConsoleUser` — the canvasser drawer's "Admin
dashboard" row was gated on `isOrgAdmin`, which left a lead who tapped "Switch to canvass mode" with no
way back short of restarting the app.

## The Books screen
[app/(app)/admin/books.jsx](../mobile/app/(app)/admin/books.jsx) — the active round's books, assignable
by book or by canvasser.

- Context: `CampaignChip` (archived campaigns selectable — see *The campaign chip* above) +
  `EffortPicker`. It also re-syncs the cached campaign on FOCUS like its sibling chip screens;
  without that, this always-mounted tab kept whatever the chip seated on first mount, so drilling
  into another campaign elsewhere and coming back showed one campaign's banner over another
  campaign's Assign buttons. Efforts come from `GET /admin/campaigns/:id/efforts`, whose
  rows include `activeRound` — so the active **pass** is `effort.activeRound._id` (no extra passes call).
- Data (active pass): books `GET /admin/campaigns/:id/turfs?passId=` (**published** only — `canvasserBooks`
  doesn't filter status, so assigning a draft book would expose it); assignments
  `GET …/turfs/assignments?passId=`; **per-book progress** `GET …/turfs/progress?passId=` →
  `{progress:[{turfId,total,knocked}]}` (the round header sums these, so it always reconciles with the
  cards — same eligible-door population); roster = campaign-assigned canvassers
  (`GET …/campaigns/:id/assignments` ∩ active canvassers from `GET /admin/memberships`). Books sorted by
  name (numeric-aware).
- Actions: assign `POST …/turfs/:turfId/assignments {userIds}`; unassign `DELETE …/:turfId/assignments/:userId`;
  bulk `POST …/turfs/assign-bulk {turfIds,userIds,mode:'distribute'|'everyone',replace}` and
  `POST …/turfs/unassign-bulk {turfIds,userIds}` from the **Select-mode** action bar (explicit book
  selection). All invalidate the assignments + efforts queries.
- **Unassign all resolves WHO from the server, not from the cached assignment map.** `unassign-bulk`
  has no "everyone" wildcard (empty `userIds` is a 400, deliberately — see
  `server/test/unassignBulk.int.test.js`), so the client must enumerate. That query has no
  `refetchInterval` and `refetchOnWindowFocus` is off, so a screen left open can be a shift stale and a
  cached union would silently leave the newest assignee holding the books. The mutation therefore
  re-reads `GET …/turfs/assignments?passId=` and sends the **pass-wide** user set — safe because the
  server pins the blast radius to `turfIds` (re-scoped by campaign, then a turf × user cross-product
  delete), so a wider user list can only ever match books already selected. Assignment rows only: the
  `CampaignAssignment` roster row and every `CanvassActivity` survive.
- The bar is the only place these errors can surface: `assignError` otherwise renders just in the map
  sheet and the bulk modal, neither of which is open when the bar fires, so a 402 (paused org) or 409
  (archived) used to fail silently for **Restrict/Unmark** too. One `barBusy` gate now disables all four
  buttons during any write — *Assign to…* previously had none and could open on top of an in-flight restrict.
- Tap a book (outside Select mode) → the **book detail** screen.
- **Map view's round-wide door dots are a FILE-backed GeoJSON source**
  ([mobile/lib/doorDots.js](../mobile/lib/doorDots.js) + unit test). `doorDotsRequest(campaignId,
  passId, epoch)` names both the request — `GET …/turfs/doors?passId=&slim=1&format=geojson` (the
  `format` param is additive; the plain response is byte-identical without it) — and a cache filename;
  the response is downloaded with `FileSystem.downloadAsync` to `cacheDirectory` and the `ShapeSource`
  gets the **`file://` URL**, so the native map SDK fetches and parses it **off the JS thread**. The
  old flow — `api()` `JSON.parse` on the JS thread, 100k feature objects, `shape={…}` serialized
  across the RN bridge — froze the phone at 106k doors. A `ShapeSource` refetches only when its URL
  *changes*, so invalidation bumps `doorEpoch`, which is baked into the filename → native refetches
  and the previous epoch's file is deleted. `doorDotFilterExpr` filters in the layer: a cheap
  to-boolean test when no chip narrows (never a ~3k-id literal `in` against 100k features for a
  no-op), the literal `in` only when chips narrow, and the promoted book excluded (its doors come from
  the status-colored layer). Camera fit + promoted density read `promotedQ` (the tapped book's own
  households) — the round-wide feed never enters JS. JS-only change → OTA-safe.
- Edge states: no active round / no published books / no campaign-assigned canvassers / no campaign
  / **archived campaign** — banner, and every assign path suppressed (Select mode and the bulk bar,
  including **Unassign all**; the map sheet's `⋯` restrict menu, both `AssignRow` buttons; the rows
  stay, so who held which book is still readable). The server refuses independently with a 409
  `campaign-archived` — covered for this route in `server/test/archivedCampaign.int.test.js`.

## The book detail screen
[app/(app)/admin/book/[turfId].jsx](../mobile/app/(app)/admin/book/[turfId].jsx) — a Mapbox map of one
book's homes for assignment in context. Hidden route, pushed from the Books list with `campaignId` param.

- Data: `GET /admin/campaigns/:id/turfs/:turfId/households` → `{ turf:{name,boundary,centroid,passId},
  households:[{id,lng,lat,status,addressLine1,city,state}] }` (eligible homes; status via
  `getPassStatusMap`). Assignees from `GET …/turfs/:turfId/assignments` (populated `userId`). Roster as
  on the list.
- Map (SymbolLayer, not MarkerView): status→house-icon pins, optional boundary `FillLayer`+`LineLayer`,
  selected-pin halo; camera `fitBounds` to the homes (fallback `centroid`).
- Tap a house → bottom sheet (address/status + voters via the existing
  `GET …/turfs/household/:householdId`). An **Assign** sheet lists the roster with Assign/Unassign
  (`POST/DELETE …/turfs/:turfId/assignments`), invalidating the list's queries.

### Server (v2 additions in [turfs.js](../server/src/routes/admin/turfs.js), reuse `passStatus.js`)
- `GET …/turfs/progress?passId=` — per-book eligible total + knocked (one status map, sliced per turf).
- `GET …/turfs/:turfId/households` — one book's homes (location+status) + boundary/centroid for the map.

**Prerequisite:** a canvasser sees a book only if assigned to the **campaign** *and* the **book**, so
book assignment alone is a no-op until they're on the campaign — hence the campaign-assigned roster.

## The survey answer drill (mobile)

The mobile end of the answer drill-in — the endpoints, counting contract, and web counterpart live
in [SURVEYS.md](SURVEYS.md) §J; the map seed-param spec in [MAPS.md](MAPS.md).

| Screen | What changed |
|---|---|
| [admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | `goVoters` passes `surveyTemplateId` (from `survey-results`' `surveyTemplate.id`) so the drill stays template-scoped when a campaign has answers under more than one survey — plus `coordinatorId` when a crew is picked, so the drill's total matches the count tapped. Also hosts the **By pass** card (`GET /admin/reports/knocks-by-pass` via the screen's shared `rangeParams()` — carries `campaignId`, satisfying the lead gate), the **walk-list chip** (a `FilterBar` filter, rendered with 2+ efforts from `GET /admin/campaigns/:id/efforts`): it threads `effortId` server-side into the overview / campaign-rollup / canvassers / knocks-by-pass queries and clears `surveyPassId` on change (the pass chips draw from the now-filtered By-pass rows) — and the **crew chip** (Timeline's options verbatim: options = ledger rows ∪ roster, gate `coordinatorOptions.length > 0 \|\| coordinatorId` with no `rows` term; threads `coordinatorId` server-side into campaign-rollup / canvassers / knocks-by-pass / survey-results, **never** `/overview` — Coverage is campaign-wide and its subtitle says so when a crew is picked). |
| [admin/answer-voters.jsx](../mobile/app/(app)/admin/answer-voters.jsx) | **Voters \| By canvasser** `TabSwitcher` (`GET /admin/reports/answer-canvassers` — rank, count, "% of their answers on this question", last entry; tap a row → sets the filter, flips to Voters), a canvasser `FilterChip` dropdown (only canvassers with entries, plus All), enriched `VoterRow`s (campaign-tz exact time, note/Offline badges from `wasOfflineSubmission`), and **View on map** (saves the active campaign, then pushes the map with the one-shot seed params `{ questionKey, optionId, alabel, surveyTemplateId, userId, from, to, scid, seedAt }`). |
| [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Consumes the seed one-shot (nonce + wait-for-`scid`), applies answer + canvasser + range, clears status/scope narrowing, re-frames the camera, then strips the params. The answer filter is dual-read (option text alongside `optionId`) and **template-scoped** — it carries `templateId` (seeded, or stamped from the current survey's `surveyTemplate.id` when an option is picked) and sends it as `surveyTemplateId` on the households query ([MAPS.md](MAPS.md) §D). |
| [admin/response-details.jsx](../mobile/app/(app)/admin/response-details.jsx) | *"Edited by X · <time>"* (from `editedBy`/`editedAt`), a **Synced** row (`syncedAt`) for offline submissions, exact times in the campaign tz, distance in ft/mi. |

Every fetch carries `campaignId` (the reports router 403s a lead without a managed one). All of this
is JS-only — ships via OTA, no native build.

## The Duplicate surveys screen

[admin/duplicate-surveys.jsx](../mobile/app/(app)/admin/duplicate-surveys.jsx) reads
`GET /admin/reports/duplicate-surveys` (`campaignId`, `from`/`to`, `kind`, `userId`, `skip`/`limit`
— see [METRICS.md](METRICS.md) §Surveys) and deletes via the shipped
`DELETE /admin/voters/:voterId/surveys/:responseId`. **The screen is no longer server-untouched**
(this doc used to say "No server changes" — true at launch, false since the overwrite-preservation
release): the report gained a third kind, `sameRoundOverwritten` — preserved same-round overwrites
join via `$unionWith` from `SurveyResponseArchive` and sort first — and `admin/voters.js` gained
the **restore** (`POST …/surveys/:archiveId/restore`) and **archive-erase**
(`DELETE …/surveys/archive/:archiveId`) routes, both org-admin-only; the mobile response-details
screen hosts the Restore ([SURVEYS.md](SURVEYS.md) §F). Three things are worth
knowing before editing it:

- **The read/write split.** The report router allows `admin` **and** `lead`, so a team lead reaches
  this screen legitimately. `admin/voters.js` is `requireOrgRole('admin')` router-wide, so the
  delete is admin-only. The client mirrors that with `useConsoleRole()` in the **positive** form
  (`role === 'admin' || role === 'super'`) — the hook returns `undefined` while it reads the cache,
  so a `!== 'lead'` test would flash a Delete button at a lead for one frame. Leads get an inline
  caption instead. The button is gated for honesty, not security.
- **`admin/voters.js` is now MOBILE-FACING** — this screen is its first mobile caller, so that file
  (voter identity PATCH, notes, DNC, the Person edit-proposal flow, and now the survey
  restore/archive-erase routes) now shows up in
  `npm run audit:mobile-api`. That is the tool working; read the flagged diffs against the shipped
  bundle rather than assuming a web-only edit is safe.
- **The paged fetch is written inline, not through [useInfinitePaged](../mobile/lib/useInfinitePaged.js).**
  Deliberate: the audit script finds mobile's dependencies by grepping for literal paths at `api()`
  call sites, and that helper builds its URL internally — endpoints consumed through it are
  invisible to the audit (`/super-admin/users` and `/super-admin/emails` are missing from `--list`
  today). An audit surface should not hide from the audit. The helper now carries a comment saying so.

Deleting (and restoring) **invalidates** rather than splicing the row out locally:
`sameRoundOverwritten` / `sameCanvasserSameDay` /
`differentCanvassers` are computed server-side, so a 3→2 delete can
leave a wrong badge on the one screen whose entire job is those badges — and re-deriving them client
side would duplicate the aggregation `duplicateSurveys.int.test.js` exists to protect. The route's
response (a full rebuilt voter profile, richer than the screen shows) is discarded rather than
seeded, which also keeps the extra PII out of the cache. The decisions that can be tested without a
device — the badge set, the confirm copy, the error wording — live in
[lib/duplicateSurveys.js](../mobile/lib/duplicateSurveys.js) and are pinned by `npm run test:mobile`.

## The admin Map screen — door detail + overlaps

[admin/map.jsx](../mobile/app/(app)/admin/map.jsx) also hosts the tapped-door **bottom sheet at web
parity** and the **Overlaps** overlay (Part 1 above). Both reuse the shipped server shapes, so this is
client-only:

- **Door sheet:** lazy-loads `GET /admin/households/:householdId/activity` (the per-round history,
  de-duped server-side to one entry per survey) and `GET /admin/households/:householdId/surveys` (answers
  on open only) — the same two endpoints the web `HouseholdDetailPanel` uses. The inline **⚠ Overlap**
  badge is derived from the loaded `rounds` (2+ distinct canvassers among real knock + survey entries in
  a pass), naming the others.
- **Overlaps toggle:** an opt-in query to `GET /admin/reports/overlap-doors` (carrying
  `campaignId` + `effortId`/`passId`), folded into the map's live-poll pill; rings the loaded overlap
  doors beneath the pins (`admin-overlaps` `ShapeSource` + `CircleLayer`).
- **Per-canvasser coloring** is automatic from the server `status` field (`?userId` now returns that
  canvasser's own disposition).
- **Walk-list scope:** a `FilterChip` + menu (rendered with 2+ efforts, from the shared
  `['admin','efforts', cId]` query) sets the same `effortId` the deep-link scope params use; picking
  a walk list clears `passId`/`importId`, and the "Scoped to …" row + its ✕ then cover pass/import
  scopes only ([MAPS.md](MAPS.md) §D).

The full server/data/render depth for all three lives in [MAPS.md](MAPS.md) (§D endpoints, §E render,
§J file map) and [METRICS.md](METRICS.md) §D (the two overlap surfaces) — not duplicated here.

## Web-dashboard admin surfaces (file map)
These tools are web-only (the mobile More hub links out to the web for them). Listed here so the file
map is complete; full server/data depth is in the linked docs, not duplicated.

| Capability | Client | Server / data | Doc |
|---|---|---|---|
| Survey builder: conditions, option scripts, "Other (specify)", **tag** combobox + palette | [SurveysPage.jsx](../client/src/pages/SurveysPage.jsx) (`SurveyForm`, `OptionRow`, `ConditionEditor`; `tagPalette` → `tags`; shared `<datalist id="survey-tags">`) | [routes/admin/surveys.js](../server/src/routes/admin/surveys.js) (`canonicalizeTags`, `validateVisibleIfIntegrity`, soft-retire reconcile); `SurveyTemplate.tags` / `option.tag` / `option.script` / `question.visibleIf` / `question.otherOption` | [SURVEYS.md](SURVEYS.md) §B/§D/§I |
| Survey report **Tags** rollup + voters-by-tag drill | [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) renders `<TagResults>` from `surveyResultsQ.data.tags`; `QuestionResults.jsx` `TagResults` | `GET /admin/reports/survey-results` `tags[]` (distinct voters per tag via `answerTagClause`) + `GET /admin/reports/voters-by-answer?tag=&surveyTemplateId=` ([routes/admin/reports.js](../server/src/routes/admin/reports.js)) | [SURVEYS.md](SURVEYS.md) §I |
| Saved searches: **By tag** filter + status filter incl. **Refused** / **Restricted** + **Export CSV** | [WalkListsPage.jsx](../client/src/pages/WalkListsPage.jsx) (`AnswerFilters` `answerTagFilters`; `STATUSES` includes `'refused'`/`'restricted'`; `exportCsv` authenticated blob download) | `filter.answerTagFilters` ([resolveWalkList.js](../server/src/services/walklist/resolveWalkList.js)) + `GET /admin/campaigns/:id/walklists/:id/export.csv` ([routes/admin/walklists.js](../server/src/routes/admin/walklists.js)) | [WALKLISTS.md](WALKLISTS.md), [SURVEYS.md](SURVEYS.md) §I |
| **Refused** door outcome in admin numbers | [CoverageBar.jsx](../client/src/components/CoverageBar.jsx) amber `refused` segment; [DashboardPage.jsx](../client/src/pages/DashboardPage.jsx) / [OverviewPage.jsx](../client/src/pages/OverviewPage.jsx) coverage; [reportDerive.js](../client/src/lib/reportDerive.js) `CONTACT_LABELS.refused = 'Declined to participate'` | `refused` (coverage + events), `refusedKnocks`, `contactRate` on `/overview` · `/campaign-rollup` · `/canvassers`; `Refused` column in `/admin/reports/canvassers.csv` ([routes/admin/reports.js](../server/src/routes/admin/reports.js)) | [METRICS.md](METRICS.md) |
| **Restricted access** door outcome (all campaign types; **not** billable) | [CoverageBar.jsx](../client/src/components/CoverageBar.jsx) slate `restricted` segment; [statusColors.js](../client/src/lib/statusColors.js) `restricted: '#475569'`; [CanvasserSummaryTable.jsx](../client/src/components/CanvasserSummaryTable.jsx) `dayRestricted` column | `restricted` (coverage + events + per-canvasser tally), excluded from `KNOCK_ACTIONS`/`homesKnocked`/rates; `Restricted` column in `/admin/reports/canvassers.csv`; `dayRestricted` on `/canvasser-timeline`; `excludeRestricted` cut option ([turfs.js](../server/src/routes/admin/turfs.js) → [generateTurf.js](../server/src/services/turf/generateTurf.js)) | [METRICS.md](METRICS.md), [PASSES_AND_TURF.md](PASSES_AND_TURF.md) |

> Note — what is **not** in the survey builder: there is **no per-question "Refused to answer" option**
> (`question.refusalOption` is reserved and unwired). "Refused" is a **door-level disposition** on
> survey campaigns, recorded from the field app, not a survey answer. See [SURVEYS.md](SURVEYS.md) §A.

## Roadmap (Phase 2+)
Campaigns (CRUD) · Efforts & assignments · Walk lists · Voters (search) · Surveys (builder) — each adds
a row to the More hub when shipped.
