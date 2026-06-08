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
Pick a **campaign** (and **effort**, if there's more than one). It works the effort's **active round**.
A toggle switches between:
- **By book** — each book shows its doors + who's on it; tap to assign/unassign canvassers. An
  "Unassigned" filter finds books with nobody, and **Bulk assign** can split the visible books across
  several canvassers ("Distribute") or give them all to each ("Everyone").
- **By canvasser** — each canvasser shows their book count; tap to give/remove their books.

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
[app/(app)/admin/books.jsx](../mobile/app/(app)/admin/books.jsx) — assign/unassign the active round's
books. **No server changes** — it uses the same `/admin/*` endpoints as the web book-assignment panel.

- Context: `CampaignChip` + `EffortPicker`. Efforts come from `GET /admin/campaigns/:id/efforts`, whose
  rows include `activeRound` — so the active **pass** is `effort.activeRound._id` (no extra passes call).
- Data (active pass): books `GET /admin/campaigns/:id/turfs?passId=` (assignment is limited to
  **published** books — `canvasserBooks` doesn't filter status, so assigning a draft book would expose
  it); assignments `GET /admin/campaigns/:id/turfs/assignments?passId=` (one call, pivoted client-side
  for both views); roster = campaign-assigned canvassers from `GET /admin/campaigns/:id/assignments` ∩
  active canvassers from `GET /admin/memberships`; optional round progress
  `GET /admin/campaigns/:id/passes/:passId/progress`.
- Actions: assign `POST /admin/campaigns/:id/turfs/:turfId/assignments {userIds}` (idempotent upsert);
  unassign `DELETE …/:turfId/assignments/:userId`; bulk `POST /admin/campaigns/:id/turfs/assign-bulk
  {turfIds,userIds,mode:'distribute'|'everyone',replace}`. All invalidate the assignments query.
- Reuses the campaign-assignments row/search pattern, `CampaignChip`, `EffortPicker`, `TabSwitcher`.
- Edge states: no active round / no published books / no campaign-assigned canvassers / no campaign —
  each shows guidance (and a link to Campaign assignments where relevant).

**Prerequisite:** a canvasser sees a book only if assigned to the **campaign** *and* the **book**, so
book assignment alone is a no-op until they're on the campaign — hence the campaign-assigned roster.

## Roadmap (Phase 2+)
Campaigns (CRUD) · Efforts & assignments · Walk lists · Voters (search) · Surveys (builder) — each adds
a row to the More hub when shipped.
