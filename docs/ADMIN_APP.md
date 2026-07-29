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
  optionally replacing existing assignments.
- **By canvasser** — each canvasser shows their book count; tap to expand and give/remove their books.

Tapping a book opens a **map detail**: the book's homes color-coded by status (with its outline, framed
to the area), tap a house for its address/status/voters, and assign/unassign canvassers right there.

Only canvassers **assigned to the campaign** can be assigned books (they need the campaign to see
them) — if someone's missing, there's a link to Campaign assignments. Canvassers see changes on their
next sync.

### The campaign screen's Activity group

**Part 1 — For everyone.** Open a campaign and the first thing you see is **Activity** for the date
range you picked — the range is named right under the heading, so a number is never undated. Knocks
leads as the big number; beneath it, one row each for Survey doors, Surveyed voters, and the
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

**The conversion is complete.** Every admin screen now speaks the grammar: More,
response-details, Notes, answer-voters, Users (list), GPS audit, Overlaps, Timeline's scrollable
body (its ~100 lines of pinned control chrome — stepper, metric toggle, search/sort, compare —
deliberately stay as controls, not rows), and both canvasser sub-screens (index KPIs/highlights/
quality rows, quality tab). **`KpiTile`/`KpiGrid` are deleted** — the grid idiom is retired,
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

### Scoping a campaign to one walk list (the pill row)

Once a campaign has **two or more walk lists**, a pill row — **All walk lists · North · South …** —
appears in the filter area of several admin screens (a single-list campaign shows nothing; a
"Main ·" prefix everywhere would be noise). Where it lives and what it scopes:

- **The campaign screen** — picking a walk list scopes **Activity**, the **By pass** group,
  **Coverage** (its subtitle flips to *All-time walk-list progress*), and **Top canvassers**
  together, so the By-pass rows still reconcile against the Knocks number above them. Picking a walk
  list also clears any selected survey **pass chip**: those chips draw from the (now filtered)
  By-pass rows, so a pass from another walk list would otherwise keep scoping the survey numbers
  with no visible chip saying so.
- **Timeline → a canvasser's profile.** Timeline's own pill row (pre-existing) now **follows you
  into the drill-in**: open a canvasser from a filtered Timeline and the profile, every sub-screen
  (days, single-day detail, activity feed, answers, quality, households, surveys taken, notes, the
  territory map), the CSV export, and **Compare** all stay inside that walk list. The profile's
  "Showing:" line appends *· walk list: North*, Compare appends *· one walk list* to its range line
  — and the **vs-team deltas** on both then compare against the walk list's canvassers, not the
  whole campaign's.
- **GPS audit** — the same pill row scopes the KPI totals, the per-canvasser table, and the entries
  list alike ([AUDIT.md](AUDIT.md)).
- **The Map tab** — a **walk-list chip** in the filter row opens a picker. Picking a walk list
  clears any pass/import deep-link scope (a pass belongs to ONE walk list, so a stale pass scope
  would silently zero out the map); with the chip present, the "Scoped to …" row only announces
  pass/import scopes and its ✕ leaves the picked walk list alone ([MAPS.md](MAPS.md)).

One deletion rides along: Timeline's reconciliation footer claiming the coordinator filter wasn't
applied to its overlap totals is gone — the crew filter is applied server-side, so the
reconciliation reflects the full selection (campaign, walk list, range, AND crew).

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

### The More hub
- **Manage:** **Users — the one people surface** (all roles incl. team leads, who see it scoped to
  their campaigns): a campaign filter chip scopes the list; the old standalone campaign Team screen
  merged in here, so a campaign's "Team" tile lands pre-filtered. Rows open a member sheet —
  campaign KPIs, a **Coordinator dropdown**, recent doors (each taps through to the live map, "See
  all" opens the paged activity screen), temp password, assign/unassign (admins), deactivate/
  reactivate. The Add sheet creates a canvasser straight onto the selected campaign with an optional
  **coordinator** picked at birth. **GPS audit** ([AUDIT.md](AUDIT.md)) — defaults to Today, each
  entry has "View on map"; **Notes** — the campaign Notes hub ([NOTES.md](NOTES.md)); **Overlaps** —
  entries open a detail screen with a map of the house and "Open on live map"; Voter search; Switch
  to canvass mode.
- **On the web:** CSV import, Early voting, Turf cutting — these open a short note (managed on the web
  dashboard; file uploads / turf drawing aren't mobile-friendly).
- **Appearance**, and **Account** (Platform view for super admins, Switch organization, Sign out).

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
web Turf Cutting page has the same actions on the selected-books panel. All three mobile entry points
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
all detail screens are `href:null` (pushed). The router gate sends `isConsoleRole(role) || isSuperAdmin`
to `/(app)/admin` — i.e. admins **and team leads** (see [ROLES.md](ROLES.md)) — so super admins share
these screens in-org. `isConsoleRole` lives in [lib/role.js](../mobile/lib/role.js) alongside the
`isOrgAdmin` (unscoped org authority; **excludes** `lead`) vs `isConsoleUser` (may see the admin app;
**includes** `lead`) split. Gate admin *entry points* on `isConsoleUser` — the canvasser drawer's "Admin
dashboard" row was gated on `isOrgAdmin`, which left a lead who tapped "Switch to canvass mode" with no
way back short of restarting the app.

## The Books screen
[app/(app)/admin/books.jsx](../mobile/app/(app)/admin/books.jsx) — the active round's books, assignable
by book or by canvasser.

- Context: `CampaignChip` + `EffortPicker`. Efforts come from `GET /admin/campaigns/:id/efforts`, whose
  rows include `activeRound` — so the active **pass** is `effort.activeRound._id` (no extra passes call).
- Data (active pass): books `GET /admin/campaigns/:id/turfs?passId=` (**published** only — `canvasserBooks`
  doesn't filter status, so assigning a draft book would expose it); assignments
  `GET …/turfs/assignments?passId=`; **per-book progress** `GET …/turfs/progress?passId=` →
  `{progress:[{turfId,total,knocked}]}` (the round header sums these, so it always reconciles with the
  cards — same eligible-door population); roster = campaign-assigned canvassers
  (`GET …/campaigns/:id/assignments` ∩ active canvassers from `GET /admin/memberships`). Books sorted by
  name (numeric-aware).
- Actions: assign `POST …/turfs/:turfId/assignments {userIds}`; unassign `DELETE …/:turfId/assignments/:userId`;
  bulk `POST …/turfs/assign-bulk {turfIds,userIds,mode:'distribute'|'everyone',replace}` from the
  **Select-mode** action bar (explicit book selection). All invalidate the assignments + efforts queries.
- Tap a book (outside Select mode) → the **book detail** screen.
- Edge states: no active round / no published books / no campaign-assigned canvassers / no campaign.

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
| [admin/campaign/[campaignId].jsx](../mobile/app/(app)/admin/campaign/[campaignId].jsx) | `goVoters` passes `surveyTemplateId` (from `survey-results`' `surveyTemplate.id`) so the drill stays template-scoped when a campaign has answers under more than one survey. Also hosts the **By pass** card (`GET /admin/reports/knocks-by-pass` via the screen's shared `rangeParams()` — carries `campaignId`, satisfying the lead gate) and the **walk-list pill row** (Timeline's `TabSwitcher` pattern, rendered with 2+ efforts from `GET /admin/campaigns/:id/efforts`): it threads `effortId` server-side into the overview / campaign-rollup / canvassers / knocks-by-pass queries and clears `surveyPassId` on change (the pass chips draw from the now-filtered By-pass rows). |
| [admin/answer-voters.jsx](../mobile/app/(app)/admin/answer-voters.jsx) | **Voters \| By canvasser** `TabSwitcher` (`GET /admin/reports/answer-canvassers` — rank, count, "% of their answers on this question", last entry; tap a row → sets the filter, flips to Voters), a canvasser `FilterChip` dropdown (only canvassers with entries, plus All), enriched `VoterRow`s (campaign-tz exact time, note/Offline badges from `wasOfflineSubmission`), and **View on map** (saves the active campaign, then pushes the map with the one-shot seed params `{ questionKey, optionId, alabel, surveyTemplateId, userId, from, to, scid, seedAt }`). |
| [admin/map.jsx](../mobile/app/(app)/admin/map.jsx) | Consumes the seed one-shot (nonce + wait-for-`scid`), applies answer + canvasser + range, clears status/scope narrowing, re-frames the camera, then strips the params. The answer filter is dual-read (option text alongside `optionId`) and **template-scoped** — it carries `templateId` (seeded, or stamped from the current survey's `surveyTemplate.id` when an option is picked) and sends it as `surveyTemplateId` on the households query ([MAPS.md](MAPS.md) §D). |
| [admin/response-details.jsx](../mobile/app/(app)/admin/response-details.jsx) | *"Edited by X · <time>"* (from `editedBy`/`editedAt`), a **Synced** row (`syncedAt`) for offline submissions, exact times in the campaign tz, distance in ft/mi. |

Every fetch carries `campaignId` (the reports router 403s a lead without a managed one). All of this
is JS-only — ships via OTA, no native build.

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
