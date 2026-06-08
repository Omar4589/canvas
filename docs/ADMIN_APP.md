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

---

# Part 1 — For everyone

An admin lands on the **bottom-tab** app (super admins get here by tapping an org on the platform
dashboard). Five tabs:

- **Overview** — the org dashboard: active campaigns, cumulative knocks/surveys/connection, coverage.
- **Insights** — the numbers per canvasser (performance, compare, overlap warnings).
- **Map** — live household status + optional canvasser pings.
- **Books** — **assign/unassign books** (turf) to canvassers for the active round (see below).
- **More** — everything else (a hub).

### The Books tab
Pick a **campaign** (and **effort**, if there's more than one — segmented for ≤3, a dropdown at 4+). It
works the effort's **active round**, with a "Round 1 · 340/600 doors done" line and a "N books · M
unassigned" count. A segmented toggle switches between:
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

### The More hub
- **Manage:** Users; Switch to canvass mode. (More management screens — Campaigns, Efforts, Walk
  lists, Voters, Surveys — are coming.)
- **On the web:** CSV import, Early voting, Turf cutting — these open a short note (managed on the web
  dashboard; file uploads / turf drawing aren't mobile-friendly).
- **Appearance**, and **Account** (Platform view for super admins, Switch organization, Sign out).

---

# Part 2 — Technical reference

## Navigation
[app/(app)/admin/_layout.jsx](../mobile/app/(app)/admin/_layout.jsx) is a `Tabs` navigator: visible
tabs `index` (Overview), `canvassers` (labeled **Insights** — route unchanged), `map`, `books`, `more`;
all detail screens are `href:null` (pushed). The router gate sends `role==='admin' || isSuperAdmin` to
`/(app)/admin`, so super admins share these screens in-org.

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

## Roadmap (Phase 2+)
Campaigns (CRUD) · Efforts & assignments · Walk lists · Voters (search) · Surveys (builder) — each adds
a row to the More hub when shipped.
